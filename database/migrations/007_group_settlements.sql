-- =====================================================
-- PULODOGATO - ACERTO DE CONTAS DO GRUPO
-- =====================================================
-- Migration: 007_group_settlements
-- Gerado em: 2026-09-22  (HMO-137, Fase 3 da evolucao do produto)
--
-- O QUE ESTE ARQUIVO ADICIONA
-- ---------------------------
--   public.group_settlements       cada pagamento de um membro para outro
--   public.group_member_balances   quanto cada membro deve ou tem a receber (view)
--   correcao de public.update_account_balance()  -- ver AVISO abaixo
--   correcao de public.calculate_equal_split()   -- ver AVISO abaixo
--   backfill de financial_transactions.group_id
--
-- AVISO: ESTE ARQUIVO CORRIGE UM BUG DE DINHEIRO QUE JA ESTA EM PRODUCAO
-- ---------------------------------------------------------------------
-- `update_account_balance()` roda em AFTER INSERT OR UPDATE OR DELETE e, no
-- ramo de UPDATE, soma NEW.amount no saldo sem estornar OLD.amount. O efeito
-- e que QUALQUER edicao de lancamento desconta o valor uma segunda vez --
-- inclusive uma edicao que nao encosta no valor, como trocar a descricao.
--
--   saldo 1000, lanca despesa de 300  -> 700   (certo)
--   edita a descricao dessa despesa   -> 400   (errado, e sem erro nenhum)
--
-- Reproduzido num Postgres 17 com a cadeia 001->006, e alcancavel hoje pelo
-- app: app/api/personal-finance/transactions/[id] (PUT) e a tela de lancamentos
-- fazem exatamente esse UPDATE. A SECAO 3a conserta a funcao.
--
-- `calculate_equal_split()` rateia pela porcentagem arredondada em duas casas:
-- uma despesa de R$ 300 dividida por tres vira tres partes de R$ 99,99, e
-- R$ 0,03 somem. Numa viagem inteira isso vira um saldo residual que pagamento
-- nenhum zera. Pior: o trigger nao olha o split_type, entao reescreve TODO
-- rateio como igualitario -- divisao 70/30 combinada com a esposa era gravada
-- 50/50. A SECAO 3b conserta as duas coisas.
--
-- Saldos que JA derivaram nao sao corrigidos por este arquivo. Recalcular
-- current_balance a partir das transacoes apagaria o saldo inicial de quem
-- cadastrou a conta com um valor de abertura -- seria trocar um erro por
-- outro, em cima de dinheiro. Para medir a deriva antes de decidir, rode a
-- consulta somente-leitura de database/maintenance/007_auditoria_saldos.sql.
--
-- O BURACO QUE ELE FECHA
-- ----------------------
-- O app ja calculava o saldo do grupo e ja sugeria as transferencias
-- ("Helio paga R$ 120 para Ana"), em dois lugares diferentes:
-- app/api/expense-groups/[groupId]/balances e .../transfers. Faltava o unico
-- passo que fazia a sugestao valer alguma coisa: **registrar que ela foi
-- paga**. Sem isso a sugestao nunca sumia -- depois de acertar a viagem
-- inteira, o app continuava dizendo que Helio devia R$ 120, para sempre. E o
-- caminho de escape seria apagar as despesas do grupo, isto e, perder o
-- historico da viagem para calar um aviso.
--
-- POR QUE UMA TABELA SO PARA ISSO
-- -------------------------------
-- A alternativa era lancar o acerto como duas financial_transactions (uma
-- despesa em quem paga, uma receita em quem recebe). Rejeitada por duas razoes:
--
--   1) current_balance e mantido por TRIGGER (update_account_balance). Um
--      acerto de grupo passaria a mexer no saldo das contas pessoais de dois
--      usuarios -- exatamente a familia de risco que a Fase 2 contornou com a
--      fatura de cartao, e desta vez sobre a conta de OUTRA pessoa.
--   2) O acerto nao e uma despesa nova. O dinheiro ja foi gasto quando alguem
--      pagou o hotel; o acerto so move quem e o dono daquele buraco. Lancar
--      como despesa contaria o hotel duas vezes em qualquer relatorio por
--      categoria -- inclusive no consumo de orcamento que o 006 acabou de
--      criar.
--
-- Entao o acerto e um livro proprio, que so a view de saldo le. Quem quiser
-- ver o dinheiro sair da conta corrente lanca a transferencia normalmente:
-- sao fatos diferentes e continuam separados.
--
-- COMO RODAR
-- ----------
--   psql "$URL" -v ON_ERROR_STOP=1 -f database/migrations/007_group_settlements.sql
--
-- Aplicar depois de 001 -> 002 -> 003 -> 004 -> 005 -> 006. O preflight aborta
-- a transacao inteira listando tudo que falta de uma vez.
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0: O ARQUIVO CABE NESTE BANCO?
-- =====================================================
DO $$
DECLARE
  v_faltando TEXT;
BEGIN
  SELECT string_agg(DISTINCT msg, E'\n' ORDER BY msg) INTO v_faltando
  FROM (
    SELECT CASE
             WHEN to_regclass('public.' || quote_ident(r.tabela)) IS NULL
               THEN format('  - tabela public.%s nao existe', r.tabela)
             WHEN NOT EXISTS (
                    SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.' || quote_ident(r.tabela))
                      AND a.attname = r.coluna
                      AND a.attnum > 0
                      AND NOT a.attisdropped)
               THEN format('  - coluna public.%s.%s nao existe', r.tabela, r.coluna)
           END AS msg
    FROM (VALUES
      ('expense_groups', 'id'),
      ('group_members', 'user_id'),
      ('group_members', 'status'),
      ('group_transactions', 'transaction_id'),
      ('group_expense_splits', 'member_id'),
      ('group_expense_splits', 'status'),
      ('financial_transactions', 'transaction_type'),
      ('schema_migrations', 'version')
    ) AS r(tabela, coluna)

    UNION ALL
    SELECT format('  - funcao public.%s nao existe', f.nome)
    FROM (VALUES
      ('update_updated_at_column()'),
      ('is_group_member(uuid)')
    ) AS f(nome)
    WHERE to_regprocedure('public.' || f.nome) IS NULL

    UNION ALL
    SELECT format('  - role %s nao existe', r.rolname)
    FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
    WHERE NOT EXISTS (SELECT 1 FROM pg_roles p WHERE p.rolname = r.rolname)
  ) AS checks
  WHERE msg IS NOT NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'007 nao pode ser aplicado neste banco. Faltando:\n%\n\nRode 001 -> 002 -> 003 -> 004 -> 005 -> 006 antes.', v_faltando;
  END IF;
END $$;

-- =====================================================
-- SECAO 1: group_settlements  (quem pagou quem)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.group_settlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    -- quem PAGOU. Nao referencia group_members: um membro pode sair do grupo
    -- e a divida que ele quitou continua tendo acontecido. Apontar para a
    -- linha de participacao faria o ON DELETE levar o pagamento junto, e o
    -- saldo de quem RECEBEU voltaria a subir sozinho meses depois.
    from_user_id uuid NOT NULL,
    -- quem RECEBEU.
    to_user_id uuid NOT NULL,
    -- sempre positivo: a direcao esta nas duas colunas acima, nao no sinal.
    -- (O resto do banco grava despesa negativa; aqui isso seria ambiguo.)
    amount numeric(15,2) NOT NULL,
    settled_on date NOT NULL DEFAULT CURRENT_DATE,
    note text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT group_settlements_pkey PRIMARY KEY (id),
    CONSTRAINT group_settlements_amount_check CHECK (amount > (0)::numeric),
    -- pagar a si mesmo zeraria o proprio saldo em qualquer direcao e nao
    -- corresponde a nada no mundo.
    CONSTRAINT group_settlements_parties_differ CHECK (from_user_id <> to_user_id),
    CONSTRAINT group_settlements_group_id_fkey FOREIGN KEY (group_id)
      REFERENCES public.expense_groups(id) ON DELETE CASCADE,
    CONSTRAINT group_settlements_from_user_id_fkey FOREIGN KEY (from_user_id)
      REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT group_settlements_to_user_id_fkey FOREIGN KEY (to_user_id)
      REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT group_settlements_created_by_fkey FOREIGN KEY (created_by)
      REFERENCES auth.users(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.group_settlements IS
  'Pagamento de um membro do grupo para outro, para zerar o saldo. Nao mexe em financial_transactions.';
COMMENT ON COLUMN public.group_settlements.amount IS
  'Sempre positivo. A direcao do dinheiro esta em from_user_id -> to_user_id.';
COMMENT ON COLUMN public.group_settlements.settled_on IS
  'Data em que o pagamento aconteceu, que pode ser anterior ao registro.';

CREATE INDEX IF NOT EXISTS idx_group_settlements_group
  ON public.group_settlements (group_id, settled_on DESC);
CREATE INDEX IF NOT EXISTS idx_group_settlements_from
  ON public.group_settlements (from_user_id);
CREATE INDEX IF NOT EXISTS idx_group_settlements_to
  ON public.group_settlements (to_user_id);

DROP TRIGGER IF EXISTS update_group_settlements_updated_at ON public.group_settlements;
CREATE TRIGGER update_group_settlements_updated_at
  BEFORE UPDATE ON public.group_settlements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Nao ha indice unico aqui, de proposito: dois pagamentos identicos no mesmo
-- dia sao um fato possivel (duas parcelas de R$ 50 para a mesma pessoa). A
-- protecao contra clique duplo e a idempotencia da rota, nao o banco.

-- =====================================================
-- SECAO 2: group_member_balances  (quanto cada um deve)
-- =====================================================
-- Ate aqui o saldo era calculado em TypeScript, duas vezes, com regras
-- ligeiramente diferentes -- balances/route.ts refazia a consulta uma vez por
-- membro e ignorava o status do rateio; transfers/route.ts fazia numa consulta
-- so. Duas respostas possiveis para "quanto eu devo" na mesma tela.
--
-- A view e a terceira implementacao e a unica que fica: as duas rotas passam a
-- le-la. Tres regras, cada uma com uma razao:
--
--  1) PAGO = SUM(ABS(amount)) das despesas do grupo lancadas por aquele
--     usuario. ABS porque despesa e gravada NEGATIVA neste banco (a mesma
--     armadilha que a Fase 2 pegou na view de consumo de orcamento). Somente
--     'expense': uma receita lancada no grupo nao e alguem pagando a conta do
--     restaurante, e conta-la como pagamento daria credito a quem recebeu
--     dinheiro.
--
--  2) DEVE = SUM(amount) dos rateios em que o membro aparece, EXCETO os
--     rejeitados e os expirados. Hoje o app cria todo rateio como 'pending' e
--     nada nunca os aprova (ver app/api/expense-groups/[groupId]/transactions),
--     entao filtrar por 'approved' zeraria o saldo de todo mundo -- seria
--     "consertar" a regra quebrando o produto. Contar 'rejected' era o bug
--     oposto, e e o que as duas rotas antigas faziam: o membro que recusou a
--     divisao continuava devendo.
--
--  3) ACERTOS entram com o sinal INVERTIDO em relacao a intuicao de quem le
--     rapido: quem PAGA tem o saldo AUMENTADO. O saldo negativo significa "deve",
--     e pagar e justamente o ato de sair do negativo em direcao ao zero. Somar
--     no receptor e subtrair no pagador -- o erro simetrico -- faria a divida
--     DOBRAR a cada acerto registrado, e a tela mostraria a sugestao de
--     transferencia crescendo depois de cada pagamento. O teste
--     database/tests/group_settlement_test.sql trava esse sinal.
--
-- A juncao com group_members e por user_id (nao por group_members.id) porque
-- quem sai e volta ganha uma linha de participacao nova, e o rateio antigo
-- continua apontando para a linha velha. Por user_id o historico dele se
-- reencontra; por member_id ele apareceria como duas pessoas.
CREATE OR REPLACE VIEW public.group_member_balances AS
  SELECT
    m.group_id,
    m.user_id,
    m.id                                        AS member_id,
    COALESCE(p.paid, 0)::numeric(15,2)          AS total_paid,
    COALESCE(o.owed, 0)::numeric(15,2)          AS total_owed,
    COALESCE(s.paid_out, 0)::numeric(15,2)      AS settlements_paid,
    COALESCE(s.received, 0)::numeric(15,2)      AS settlements_received,
    (COALESCE(p.paid, 0)
     - COALESCE(o.owed, 0)
     + COALESCE(s.paid_out, 0)
     - COALESCE(s.received, 0))::numeric(15,2)  AS net_balance,
    COALESCE(p.paid_count, 0)                   AS paid_count,
    COALESCE(o.owed_count, 0)                   AS owed_count
  FROM public.group_members m

  -- o que este usuario pagou pelo grupo
  LEFT JOIN LATERAL (
    SELECT SUM(ABS(t.amount)) AS paid, COUNT(*) AS paid_count
    FROM public.group_transactions gt
    JOIN public.financial_transactions t ON t.id = gt.transaction_id
    WHERE gt.group_id = m.group_id
      AND t.user_id = m.user_id
      AND t.transaction_type = 'expense'
  ) AS p ON TRUE

  -- a parte que cabe a ele nas despesas do grupo
  LEFT JOIN LATERAL (
    SELECT SUM(es.amount) AS owed, COUNT(*) AS owed_count
    FROM public.group_expense_splits es
    JOIN public.group_members em ON em.id = es.member_id
    JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.group_id = m.group_id
      AND em.user_id = m.user_id
      AND es.status NOT IN ('rejected', 'expired')
  ) AS o ON TRUE

  -- os acertos ja registrados, nas duas direcoes
  LEFT JOIN LATERAL (
    SELECT
      SUM(CASE WHEN gs.from_user_id = m.user_id THEN gs.amount ELSE 0 END) AS paid_out,
      SUM(CASE WHEN gs.to_user_id   = m.user_id THEN gs.amount ELSE 0 END) AS received
    FROM public.group_settlements gs
    WHERE gs.group_id = m.group_id
      AND (gs.from_user_id = m.user_id OR gs.to_user_id = m.user_id)
  ) AS s ON TRUE

  WHERE m.status = 'active';

COMMENT ON VIEW public.group_member_balances IS
  'Saldo de cada membro ativo: pago - devido + acertos pagos - acertos recebidos. Negativo = deve.';

-- =====================================================
-- SECAO 3a: update_account_balance() -- o UPDATE que cobrava duas vezes
-- =====================================================
-- Ver o AVISO no cabecalho. A versao de producao faz, no ramo de UPDATE:
--
--     current_balance = current_balance + NEW.amount
--
-- sem nunca estornar OLD.amount. Toda edicao de lancamento tira o valor do
-- saldo de novo, e trocar a conta do lancamento deixa o valor nas DUAS contas.
--
-- Este arquivo precisa da correcao por um motivo proprio, alem do bug: a
-- SECAO 4 abaixo faz um UPDATE de manutencao em financial_transactions. Com a
-- funcao velha, a migration destruiria o saldo de todas as contas com despesa
-- de grupo -- uma migration que corrompe dinheiro para consertar um join.
-- Corrigida a funcao, o mesmo UPDATE estorna o valor antigo e reaplica o novo:
-- resultado liquido zero, como tem que ser.
--
-- Fica SECURITY INVOKER de proposito: a 004 auditou esta funcao e concluiu que
-- ela escreve em tabela onde o proprio usuario ja tem grant e policy. O que
-- muda e so a aritmetica. O `SET search_path` entra porque a funcao referencia
-- `financial_accounts` sem qualificar o schema.
CREATE OR REPLACE FUNCTION public.update_account_balance() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.account_id IS NOT NULL THEN
            UPDATE public.financial_accounts
               SET current_balance = current_balance + NEW.amount, updated_at = NOW()
             WHERE id = NEW.account_id;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- Estorna o efeito antigo e aplica o novo. Os dois passos sao
        -- separados porque a conta pode ter mudado na edicao: um unico UPDATE
        -- com o delta so funcionaria quando OLD.account_id = NEW.account_id, e
        -- falharia em silencio justamente no caso de mover o lancamento de
        -- conta -- que e quando o saldo das duas contas depende disso.
        IF OLD.account_id IS NOT NULL THEN
            UPDATE public.financial_accounts
               SET current_balance = current_balance - OLD.amount, updated_at = NOW()
             WHERE id = OLD.account_id;
        END IF;
        IF NEW.account_id IS NOT NULL THEN
            UPDATE public.financial_accounts
               SET current_balance = current_balance + NEW.amount, updated_at = NOW()
             WHERE id = NEW.account_id;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD.account_id IS NOT NULL THEN
            UPDATE public.financial_accounts
               SET current_balance = current_balance - OLD.amount, updated_at = NOW()
             WHERE id = OLD.account_id;
        END IF;
        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.update_account_balance() IS
  'Mantem financial_accounts.current_balance. No UPDATE estorna OLD.amount antes de somar NEW.amount.';

-- =====================================================
-- SECAO 3b: calculate_equal_split() -- os centavos que sumiam
-- =====================================================
-- Sem esta correcao o acerto de contas que este arquivo introduz NAO FECHA, e
-- e por isso que ela entra aqui e nao numa migration futura.
--
-- A versao de producao rateia pela PORCENTAGEM, arredondada para duas casas:
--
--     equal_percentage := 100.0 / 3          -> 33.33  (DECIMAL(5,2))
--     NEW.amount := 300 * (33.33 / 100.0)    -> 99.99
--
-- Tres vezes 99,99 e 299,97. A despesa foi de R$ 300: somem R$ 0,03 a cada
-- divisao por 3, R$ 0,01 por 6, e por ai vai -- toda divisao cujo resultado
-- nao tem duas casas exatas. O dinheiro nao volta: quem pagou fica credor de
-- uma sobra que rateio nenhum atribuiu a ninguem.
--
-- Numa viagem com trinta contas isso vira alguns centavos de saldo residual
-- que NENHUM pagamento zera -- a tela diria "voce ainda deve R$ 0,07" para
-- sempre, e o acerto simplificado nunca terminaria. Essa foi a razao de
-- descobrir: o teste do acerto exige que a soma dos saldos do grupo seja zero.
--
-- A correcao e o metodo do maior resto: divide em centavos inteiros e
-- distribui o que sobra, um centavo para cada um dos primeiros restos. Com
-- R$ 300 por 3 da 100,00 para cada; com R$ 100 por 3 da 33,34 / 33,33 / 33,33,
-- que soma exatamente 100,00. Qual membro recebe o centavo a mais e decidido
-- pela ordem de group_members.id -- arbitraria, mas ESTAVEL: cada linha calcula
-- a propria parte sem saber das outras, e mesmo assim o total bate.
--
-- E O SEGUNDO DEFEITO, QUE E MAIOR
-- --------------------------------
-- O trigger e BEFORE INSERT em group_expense_splits SEM clausula WHEN, e a
-- funcao nao olha o split_type. Ou seja: ela reescreve TODO rateio como
-- igualitario, inclusive o personalizado. O app oferece divisao por
-- porcentagem, custom e proporcional a renda (ha ate um endpoint
-- /expense-groups/proportions para calcular esta ultima) -- e o banco achatava
-- as tres para "cada um paga o mesmo", em silencio, na hora do INSERT. Quem
-- combinasse 70/30 com a esposa via 50/50 gravado.
--
-- Agora a funcao so calcula quando o rateio E igualitario e quem inseriu nao
-- trouxe valor proprio. Nos outros casos ela devolve NEW intacto.
CREATE OR REPLACE FUNCTION public.calculate_equal_split() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_split_type TEXT;
    v_total_cents BIGINT;
    v_n INTEGER;
    v_rank INTEGER;
    v_base BIGINT;
    v_resto BIGINT;
BEGIN
    SELECT gt.split_type INTO v_split_type
      FROM public.group_transactions gt
     WHERE gt.id = NEW.group_transaction_id;

    -- Rateio que nao e igualitario: o valor veio de quem inseriu e manda quem
    -- inseriu. Antes, este era o caminho que apagava a divisao combinada.
    IF v_split_type IS NOT NULL AND v_split_type <> 'equal' THEN
        RETURN NEW;
    END IF;

    SELECT ROUND(ABS(ft.amount) * 100)::bigint INTO v_total_cents
      FROM public.financial_transactions ft
      JOIN public.group_transactions gt ON gt.transaction_id = ft.id
     WHERE gt.id = NEW.group_transaction_id;

    IF v_total_cents IS NULL THEN
        RETURN NEW;
    END IF;

    -- Quantos membros ativos, e em que posicao esta o desta linha. As duas
    -- consultas tem que enxergar o MESMO conjunto, senao os restos nao somam.
    SELECT count(*) INTO v_n
      FROM public.group_members gm
      JOIN public.group_transactions gt ON gt.group_id = gm.group_id
     WHERE gt.id = NEW.group_transaction_id
       AND gm.status = 'active';

    IF v_n IS NULL OR v_n = 0 THEN
        RETURN NEW;
    END IF;

    SELECT posicao INTO v_rank
      FROM (
        SELECT gm.id, row_number() OVER (ORDER BY gm.id) - 1 AS posicao
          FROM public.group_members gm
          JOIN public.group_transactions gt ON gt.group_id = gm.group_id
         WHERE gt.id = NEW.group_transaction_id
           AND gm.status = 'active'
      ) AS r
     WHERE r.id = NEW.member_id;

    -- Membro inativo (ou de outro grupo) recebendo rateio: nao esta na
    -- ordenacao, entao nao ha parte justa a calcular. Deixa como veio, em vez
    -- de inventar um valor.
    IF v_rank IS NULL THEN
        RETURN NEW;
    END IF;

    v_base  := v_total_cents / v_n;
    v_resto := v_total_cents - (v_base * v_n);

    NEW.amount := ((v_base + CASE WHEN v_rank < v_resto THEN 1 ELSE 0 END)::numeric) / 100;

    -- A porcentagem vira DISPLAY: com R$ 100 por 3, as partes em dinheiro sao
    -- 33,34 / 33,33 / 33,33 e nenhuma porcentagem de duas casas descreve as
    -- duas coisas ao mesmo tempo. Quem manda e o valor. O CHECK da coluna
    -- exige > 0, entao o GREATEST cobre o grupo grande demais (mais de 10 mil
    -- membros arredondaria para 0,00 e derrubaria o INSERT).
    NEW.percentage := GREATEST(ROUND(100.0 / v_n, 2), 0.01);

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.calculate_equal_split() IS
  'Rateio igualitario em centavos inteiros (maior resto), somando exatamente o valor da despesa. Nao toca em rateio custom/percentage/proporcional.';

-- =====================================================
-- SECAO 4: backfill de financial_transactions.group_id
-- =====================================================
-- A despesa lancada pela tela do grupo
-- (app/api/expense-groups/[groupId]/transactions) grava a transacao SEM
-- group_id -- so cria a linha de ligacao em group_transactions. E a policy de
-- SELECT de financial_transactions, escrita pela 002, libera a transacao de
-- outro membro exatamente por essa coluna:
--
--     user_id = auth.uid() OR (group_id IS NOT NULL AND is_group_member(group_id))
--
-- Ou seja: hoje cada membro so enxerga o que ELE MESMO pagou. A tela de saldos
-- do grupo ja mostra, para cada um, que todos os outros pagaram zero -- dois
-- membros abrem a mesma viagem e leem numeros diferentes, sem nenhum erro
-- aparecer. A view da SECAO 2 herdaria o mesmo buraco, porque e security_invoker.
--
-- O consumo de orcamento de grupo que a Fase 2 criou depende da MESMA coluna
-- (budget_consumption casa t.group_id = b.group_id), entao sem este backfill o
-- teto da viagem leria zero para sempre.
--
-- Daqui para a frente quem grava a coluna e a rota, corrigida no mesmo commit.
-- Este bloco so alcanca o que ja existe.
--
-- Transacao ligada a DOIS grupos fica de fora: nao ha resposta certa para qual
-- deles vai na coluna, e escolher um calado seria mover a despesa de grupo sem
-- avisar. O NOTICE reporta quantas foram.
DO $$
DECLARE
  v_saldo_antes  numeric;
  v_saldo_depois numeric;
  v_corrigidas   integer;
  v_ambiguas     integer;
BEGIN
  SELECT COALESCE(SUM(current_balance), 0) INTO v_saldo_antes
    FROM public.financial_accounts;

  SELECT count(*) INTO v_ambiguas
    FROM (SELECT gt.transaction_id
            FROM public.group_transactions gt
            JOIN public.financial_transactions t ON t.id = gt.transaction_id
           WHERE t.group_id IS NULL
           GROUP BY gt.transaction_id
          HAVING count(DISTINCT gt.group_id) > 1) AS x;

  WITH unico AS (
    SELECT gt.transaction_id, MIN(gt.group_id::text)::uuid AS group_id
      FROM public.group_transactions gt
      JOIN public.financial_transactions t ON t.id = gt.transaction_id
     WHERE t.group_id IS NULL
     GROUP BY gt.transaction_id
    HAVING count(DISTINCT gt.group_id) = 1
  )
  UPDATE public.financial_transactions t
     SET group_id = u.group_id
    FROM unico u
   WHERE t.id = u.transaction_id;

  GET DIAGNOSTICS v_corrigidas = ROW_COUNT;

  SELECT COALESCE(SUM(current_balance), 0) INTO v_saldo_depois
    FROM public.financial_accounts;

  -- A rede de seguranca: se a correcao da SECAO 3 nao tivesse pegado, este
  -- UPDATE teria mexido no saldo e a migration inteira volta atras aqui, em
  -- vez de deixar producao com dinheiro errado e sair verde.
  IF v_saldo_antes IS DISTINCT FROM v_saldo_depois THEN
    RAISE EXCEPTION
      'ABORTADO: o backfill de group_id mudou o saldo das contas (% -> %). Nenhuma alteracao foi gravada.',
      v_saldo_antes, v_saldo_depois;
  END IF;

  RAISE NOTICE 'backfill de group_id: % transacoes ligadas ao grupo, % ambiguas deixadas como estavam, saldo total inalterado (%).',
    v_corrigidas, v_ambiguas, v_saldo_depois;
END $$;

-- =====================================================
-- SECAO 5: RLS
-- =====================================================
ALTER TABLE public.group_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS group_settlements_select ON public.group_settlements;
CREATE POLICY group_settlements_select ON public.group_settlements
  FOR SELECT TO authenticated
  USING (public.is_group_member(group_id));

-- Quem registra tem que ser membro E uma das duas partes. Um terceiro membro
-- registrando "A pagou B" apagaria uma divida que nao e dele -- seria o botao
-- de perdoar a divida alheia, disponivel para qualquer um do grupo.
DROP POLICY IF EXISTS group_settlements_insert ON public.group_settlements;
CREATE POLICY group_settlements_insert ON public.group_settlements
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.is_group_member(group_id)
    AND (from_user_id = auth.uid() OR to_user_id = auth.uid())
  );

-- Corrigir o valor digitado errado: so quem registrou, e sem poder transformar
-- o registro num acerto entre outras duas pessoas.
DROP POLICY IF EXISTS group_settlements_update ON public.group_settlements;
CREATE POLICY group_settlements_update ON public.group_settlements
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() AND public.is_group_member(group_id))
  WITH CHECK (
    created_by = auth.uid()
    AND (from_user_id = auth.uid() OR to_user_id = auth.uid())
  );

DROP POLICY IF EXISTS group_settlements_delete ON public.group_settlements;
CREATE POLICY group_settlements_delete ON public.group_settlements
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() AND public.is_group_member(group_id));

-- =====================================================
-- SECAO 6: GRANTS
-- =====================================================
-- O 002 rodou GRANT ... ON ALL TABLES antes destes objetos existirem, e ALL
-- TABLES nao alcanca o futuro.
REVOKE ALL ON public.group_settlements FROM anon;
REVOKE ALL ON public.group_member_balances FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_settlements TO authenticated;
GRANT SELECT ON public.group_member_balances TO authenticated;

-- Sem security_invoker a view roda com o privilegio do dono e a RLS das
-- tabelas base nao vale: group_member_balances devolveria o saldo de todos os
-- grupos do sistema para qualquer usuario logado -- quanto cada casal gasta e
-- com quem cada um viaja. Mesma pegadinha do 005 e do 006.
ALTER VIEW public.group_member_balances SET (security_invoker = true);

-- =====================================================
-- SECAO 7: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('007', '007_group_settlements',
        'Acerto de contas do grupo (group_settlements) e saldo por membro (view) - HMO-137 Fase 3', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
