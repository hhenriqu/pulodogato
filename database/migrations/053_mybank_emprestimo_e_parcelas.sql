-- 053_mybank_emprestimo_e_parcelas.sql
--
-- HMO-369, primeira fase do MyBank (HMO-368): SO O SCHEMA. Duas tabelas, duas
-- travas de trigger, a RLS das duas, e a view que a F2/F4 vai unir em Contas a
-- Pagar. NENHUM leitor sobe com esta migration -- nao ha `lib/`, rota nem tela
-- nesta fase, de proposito: migration presa na branch da feature nao existe
-- para quem cola SQL olhando a `main`.
--
-- ===========================================================================
-- DEPENDENCIA DE PROD: A 050 E A 052 **JA ESTAO COLADAS** (remedido 2026-10-10 23:32Z)
-- ===========================================================================
-- A HMO-369 nasceu dizendo o contrario -- "a 050 e a 052 ainda nao estao
-- coladas" --, e isso era verdade quando a issue foi escrita, mais cedo no
-- mesmo dia. FOI REMEDIDO antes de escrever este arquivo, pela credencial RO, e
-- as duas entraram no intervalo:
--
--   transaction_installments existe .............. false  (a 052 apagou a tabela)
--   create_installments + pay_installment vivas .. 0      (a 052 apagou as duas RPCs)
--   bill_alerts le scheduled_transactions_effective  true (a 050 entrou)
--   restore_archived_group(uuid) existe .......... true   (a 051 entrou)
--   objetos `mybank%` ............................ 0      (a 053 e a proxima)
--
-- E o md5 do `pg_get_viewdef(bill_alerts, true)` em prod e BYTE A BYTE o da
-- cadeia 001 -> 053 montada do zero num Postgres 17 local:
--
--   4830bf17592506098568072d76687f48   (prod == local)
--
-- Isso e mais forte que "a 050 entrou": prova que o que esta em prod e a 050
-- DESTE repositorio, e nao uma variante colada a mao. Catalogo nao tem RLS, por
-- isso as cinco leituras acima funcionam pela credencial RO -- diferente de
-- qualquer contagem de linha nestas tabelas, que a RO nao enxerga.
--
-- CONSEQUENCIA PRATICA: nao ha mais ordem a respeitar antes desta migration.
-- Prod esta na 052 e a 053 e a proxima da fila.
--
-- `public.schema_migrations` continua VAZIA em prod, e isso nao mudou: ela NAO
-- serve de livro-caixa da colagem. Quem quiser saber o que ja entrou tem de
-- olhar o catalogo (coluna, viewdef, `pg_proc.prosrc`), nunca essa tabela -- foi
-- assim que o retrato acima foi levantado.
--
-- ===========================================================================
-- AS DECISOES QUE VEM DA HMO-368 E QUE ESTA MIGRATION NAO REABRE
-- ===========================================================================
--   1. auto-emprestimo (devedor = credor) e gravado como TRANSFERENCIA para a
--      conta de investimento, e aparece em Despesas/Contas a Pagar com selo
--      MyBank. A linha dele mora em `scheduled_transactions`, NAO aqui -- e e
--      por isso que a view da SECAO 8 EXCLUI o auto-emprestimo (ver la: e a
--      diferenca entre mostrar a parcela e contar a parcela DUAS VEZES).
--   2. o "a receber" aparece como reembolso previsto em Receitas (HMO-364).
--   3. o que a conexao me deve fica FORA do patrimonio na fase 1.
--   4. juros 0% na fase 1, com a coluna ja no banco.
--   5. sem gate de plano.
--
-- ===========================================================================
-- POR QUE AS DUAS TRAVAS SAO TRIGGER, E NAO CHECK
-- ===========================================================================
-- As duas perguntam por OUTRA TABELA:
--
--   1. `lender_account_id` e conta do proprio `lender_user_id` E de
--      `account_type = 'investment'`?  -> pergunta a `financial_accounts`
--   2. `borrower_user_id` e o proprio credor OU tem conexao `accepted` com
--      ele?                            -> pergunta a `user_connections`
--
-- CHECK nao aceita subconsulta (0A000). Nao e questao de estilo: o Postgres
-- recusa o DDL. Entao viram uma trigger `BEFORE INSERT OR UPDATE`.
--
-- E A FUNCAO E `SECURITY DEFINER` COM `search_path` FIXO
-- -----------------------------------------------------
-- A trigger roda dentro da sessao `authenticated` de quem esta criando o
-- emprestimo, e as duas tabelas que ela le TEM RLS. Como INVOKER:
--
--   * `financial_accounts` -> a policy e `user_id = auth.uid()`, e o credor
--     e o proprio dono, entao essa passaria;
--   * `user_connections`   -> a policy e `requester_id = auth.uid() OR
--     requested_id = auth.uid()`, e aqui tambem o credor e um dos dois.
--
-- Ou seja: hoje, no caminho feliz, INVOKER funcionaria -- e e exatamente por
-- isso que DEFINER importa. A trava precisa valer tambem quando quem escreve
-- NAO e o credor (uma funcao de servico, um backfill, a F2 criando a serie de
-- parcelas por RPC), e nesses caminhos a RLS da tabela lida ESCONDE A LINHA e a
-- trava recusa um emprestimo legitimo com uma mensagem que acusa a pessoa
-- errada. Linha invisivel e linha ausente para quem le: o mesmo `NOT EXISTS`
-- responde "nao tem conexao" para "nao posso ver a conexao". E o mesmo cuidado
-- de `is_group_member` (002).
--
-- `SET search_path = public, pg_temp` porque DEFINER sem search_path fixo e
-- escalada de privilegio: quem puder criar um `pg_temp.user_connections` passa
-- a decidir o que a trava responde.
--
-- A TRAVA SO RE-VALIDA QUANDO AS COLUNAS DELA MUDAM, E ISSO NAO E PREGUICA
-- ---------------------------------------------------------------------------
-- No UPDATE a trigger confere os tres campos (`lender_user_id`,
-- `lender_account_id`, `borrower_user_id`) SO SE algum deles mudou, com
-- `IS DISTINCT FROM`. Se ela re-validasse sempre, desfazer uma conexao
-- transformaria todo emprestimo daquela pessoa em linha IMPOSSIVEL DE FECHAR:
-- o credor nao conseguiria mais marcar `settled` nem `cancelled`, porque o
-- UPDATE do status cairia na trava da conexao que ja nao existe. A divida
-- ficaria eternamente `active` e a unica saida seria mexer no banco a mao.
-- Conexao e requisito para CRIAR a divida, nao para encerra-la.
--
-- `IS DISTINCT FROM` e nao `<>` porque `<>` com NULL de um lado vale NULL, que
-- nao e TRUE -- a mudanca passaria batida justo no caso em que a coluna foi
-- esvaziada.
--
-- ===========================================================================
-- O FURO QUE A RLS SOZINHA **NAO** FECHA: `WITH CHECK` NAO VE A LINHA ANTIGA
-- ===========================================================================
-- A HMO-369 pede que o devedor so possa levar a parcela de `pending` para
-- `reported`, e nomeia o risco certo: "sem o WITH CHECK o devedor reescreve o
-- `amount` da parcela". O WITH CHECK entra (SECAO 7) e e necessario -- mas ele
-- NAO BASTA, e o motivo e do Postgres:
--
--   * `USING`      e avaliado sobre a linha ANTIGA (OLD);
--   * `WITH CHECK` e avaliado sobre a linha NOVA   (NEW).
--
-- Nenhuma das duas ve as duas. Uma policy NAO CONSEGUE dizer
-- "NEW.amount = OLD.amount", porque nao existe expressao de policy com os dois
-- lados ao alcance. Logo:
--
--   * `USING` sozinho (o WITH CHECK de UPDATE, quando omitido, repete o USING)
--     deixa o devedor gravar `amount = 0.01` mantendo `status = 'pending'`;
--   * com o WITH CHECK exigindo `status = 'reported'`, ele nao consegue mais
--     isso -- mas consegue `amount = 0.01, status = 'reported'` NUM SO UPDATE,
--     que satisfaz USING (era pending, sou o devedor) e WITH CHECK (ficou
--     reported, continuo o devedor).
--
-- O valor da divida continuaria reescrevivel por quem deve. Por isso a SECAO 6
-- acrescenta uma SEGUNDA trigger, `mybank_installments_trava_do_devedor`, que
-- compara OLD com NEW -- a unica coisa no Postgres que consegue -- e deixa o
-- devedor mexer em DOIS campos e mais nenhum: `status` (so pending -> reported)
-- e `reported_at`. A policy e o porteiro; a trigger e o que prende o valor.
--
-- As duas sao necessarias e nenhuma e redundante: sem a policy, qualquer
-- usuario logado alcanca a linha; sem a trigger, o devedor que a policy deixou
-- entrar reescreve o dinheiro. O teste desta migration mata os dois mutantes
-- separadamente.
--
-- ===========================================================================
-- CONFERENCIA EM PRODUCAO, DEPOIS DE COLAR
-- ===========================================================================
--   SELECT relname, relrowsecurity
--     FROM pg_class
--    WHERE relname IN ('mybank_loans', 'mybank_installments');
--   -- as duas com relrowsecurity = true
--
--   SELECT pg_get_viewdef('public.mybank_due_entries'::regclass, true);
--   SELECT reloptions FROM pg_class WHERE relname = 'mybank_due_entries';
--   -- tem de sair {security_invoker=true}
--
-- As tres leem o CATALOGO, entao funcionam pela credencial RO (catalogo nao tem
-- RLS). Contagem de linha nas tabelas novas NAO funciona por ela -- elas tem
-- RLS e a RO nao tem BYPASSRLS --, mas nesta fase as duas nascem vazias e nao
-- ha o que contar.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. PREFLIGHT: do que esta migration depende
-- ---------------------------------------------------------------------------
-- Tudo o que vem antes do CREATE, para a colagem morrer com uma frase em vez de
-- um erro de FK no meio. Cada item aqui e referenciado mais abaixo; nenhum e
-- decorativo.
DO $$
DECLARE
  problemas text := '';
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    problemas := problemas || E'\n  - public.profiles nao existe (001); as duas pontas do emprestimo apontam para ela';
  END IF;

  IF to_regclass('public.financial_accounts') IS NULL THEN
    problemas := problemas || E'\n  - public.financial_accounts nao existe (001); e a conta credora';
  END IF;

  IF to_regclass('public.financial_transactions') IS NULL THEN
    problemas := problemas || E'\n  - public.financial_transactions nao existe (001); e o elo de paid_transaction_id';
  END IF;

  -- A trava 2 inteira mora nesta tabela. Sem a 010 o MyBank nao tem como
  -- distinguir "a Lais, com quem eu me conectei" de qualquer id de usuario.
  IF to_regclass('public.user_connections') IS NULL THEN
    problemas := problemas || E'\n  - public.user_connections nao existe (010); e a trava que amarra o MyBank as conexoes';
  ELSE
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'user_connections'
                     AND column_name = 'requester_id') THEN
      problemas := problemas || E'\n  - user_connections.requester_id nao existe';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'user_connections'
                     AND column_name = 'requested_id') THEN
      problemas := problemas || E'\n  - user_connections.requested_id nao existe';
    END IF;
  END IF;

  -- `investment` e o valor do enum que a trava 1 exige. Se ele nao existir, a
  -- comparacao `account_type = 'investment'` morreria em 22P02 -- mas so no
  -- primeiro disparo da trigger, porque plpgsql nao valida o corpo na criacao.
  -- Ou seja: sem este item a migration ficaria VERDE e a falha apareceria no
  -- clique do usuario.
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'account_type' AND e.enumlabel = 'investment'
  ) THEN
    problemas := problemas || E'\n  - o enum public.account_type nao tem o valor ''investment''; a trava 1 nao teria o que exigir';
  END IF;

  -- O carimbo de updated_at reusa a funcao que o 001 deixou no banco. Nao vale
  -- escrever uma segunda copia dela aqui.
  IF to_regprocedure('public.update_updated_at_column()') IS NULL THEN
    problemas := problemas || E'\n  - public.update_updated_at_column() nao existe (001); e o carimbo de updated_at';
  END IF;

  IF problemas <> '' THEN
    RAISE EXCEPTION '053 nao pode ser aplicada neste banco:%', problemas;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. mybank_loans -- o emprestimo
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mybank_loans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,

    -- quem empresta. Sempre o dono da conta de investimento; a trava 1 amarra
    -- os dois.
    lender_user_id uuid NOT NULL,

    -- a conta de investimento credora. NAO e `investment_assets` (a carteira de
    -- ativos) -- e `financial_accounts` com `account_type = 'investment'`.
    lender_account_id uuid NOT NULL,

    -- quem paga. IGUAL ao lender no auto-emprestimo, e e esse caso que faz esta
    -- coluna NOT NULL em vez de nullable: "emprestimo para mim mesmo" fica
    -- explicito na linha, e nenhuma leitura precisa tratar NULL como "eu".
    borrower_user_id uuid NOT NULL,

    description text NOT NULL,
    principal numeric(15,2) NOT NULL,
    installment_count integer NOT NULL,
    first_due_date date NOT NULL,

    -- Reservada para a fase de juros. Ja nasce no banco para a tabela nao ter
    -- de ser alterada depois, e com a trava de fase (abaixo) para nao existir
    -- linha com juro que nenhuma aritmetica deste momento sabe calcular.
    interest_rate numeric(9,6) DEFAULT 0 NOT NULL,

    status text DEFAULT 'active' NOT NULL,

    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,

    CONSTRAINT mybank_loans_pkey PRIMARY KEY (id),

    CONSTRAINT mybank_loans_principal_check
      CHECK (principal > 0),

    -- 360 = 30 anos. O teto existe para um dedo escorregado nao materializar
    -- uma serie de dez mil parcelas na F2.
    CONSTRAINT mybank_loans_installment_count_check
      CHECK (installment_count BETWEEN 1 AND 360),

    CONSTRAINT mybank_loans_status_check
      CHECK (status IN ('active', 'settled', 'cancelled')),

    CONSTRAINT mybank_loans_interest_rate_check
      CHECK (interest_rate >= 0),

    -- A TRAVA DE FASE, E ELA TEM NOME PROPRIO PARA PODER SER SOLTA EM UMA LINHA
    -- -------------------------------------------------------------------------
    -- A fase 1 aceita so juro 0. A coluna existe, o default e 0, e sem esta
    -- amarra nada impediria a tela de gravar 0.015 -- e a F2 passaria a somar
    -- parcelas que nenhuma funcao deste repositorio sabe calcular, sem erro
    -- nenhum no caminho. Quando os juros entrarem, a migration daquela fase faz
    --
    --   ALTER TABLE public.mybank_loans
    --     DROP CONSTRAINT mybank_loans_interest_rate_fase_1;
    --
    -- e nada mais. E uma linha para soltar, contra um numero de dinheiro errado
    -- para achar depois.
    CONSTRAINT mybank_loans_interest_rate_fase_1
      CHECK (interest_rate = 0),

    CONSTRAINT mybank_loans_lender_user_id_fkey
      FOREIGN KEY (lender_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,

    -- RESTRICT e nao CASCADE: apagar a conta de investimento nao pode apagar em
    -- silencio a divida que alguem tem comigo. Quem quiser apagar a conta
    -- encerra o emprestimo primeiro.
    CONSTRAINT mybank_loans_lender_account_id_fkey
      FOREIGN KEY (lender_account_id) REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,

    CONSTRAINT mybank_loans_borrower_user_id_fkey
      FOREIGN KEY (borrower_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.mybank_loans IS
  'MyBank (HMO-368/369): um emprestimo que sai de uma conta de investimento minha. borrower_user_id = lender_user_id e o auto-emprestimo, e nesse caso as parcelas vivem tambem em scheduled_transactions como transferencia prevista -- a view mybank_due_entries EXCLUI esse caso justamente para a parcela nao ser contada duas vezes. As duas travas (conta de investimento do proprio credor; devedor conectado) sao a trigger mybank_loans_trava, e nao CHECK, porque CHECK nao aceita subconsulta.';

COMMENT ON COLUMN public.mybank_loans.lender_account_id IS
  'Conta de investimento credora, em financial_accounts (account_type = investment) -- nao investment_assets. A trigger mybank_loans_trava exige que seja conta DO PROPRIO lender_user_id: sem isso o MyBank empresta da conta de outra pessoa.';
COMMENT ON COLUMN public.mybank_loans.borrower_user_id IS
  'Quem paga. Igual ao lender no auto-emprestimo. A trigger exige ser o proprio credor OU ter conexao accepted com ele em user_connections -- a conexao e requisito para CRIAR, e a trigger NAO a re-exige no UPDATE que so mexe no status, senao desfazer uma conexao deixaria a divida impossivel de encerrar.';
COMMENT ON COLUMN public.mybank_loans.interest_rate IS
  'Reservada para a fase de juros; a fase 1 aceita so 0, pela constraint mybank_loans_interest_rate_fase_1 -- que tem nome proprio para a migration dos juros solta-la em uma linha.';
COMMENT ON COLUMN public.mybank_loans.principal IS
  'O valor emprestado, POSITIVO. A soma de mybank_installments.amount tem de fechar com ele: a ultima parcela absorve o centavo da divisao, que e o que valorGravado de lib/lancamento.ts ja faz -- a F2 importa aquela aritmetica em vez de reescrever.';

-- ---------------------------------------------------------------------------
-- 3. mybank_installments -- as parcelas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mybank_installments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    loan_id uuid NOT NULL,

    -- "parcela 3 de 24" -- os dois numeros que a issue pede na tela. O total
    -- fica repetido aqui (e nao so em loans.installment_count) porque a view e
    -- a tela leem a PARCELA, e um JOIN a mais em cada leitura para buscar um
    -- numero que nunca muda nao se paga.
    installment_number integer NOT NULL,
    installment_total integer NOT NULL,

    amount numeric(15,2) NOT NULL,
    due_date date NOT NULL,

    status text DEFAULT 'pending' NOT NULL,

    -- Quando o devedor avisou que pagou. Fica gravado DEPOIS de o credor
    -- confirmar tambem: e o carimbo de um evento, nao o espelho do status. Por
    -- isso nao ha CHECK amarrando-o a `status = 'reported'`.
    reported_at timestamp with time zone,

    paid_date date,

    -- A perna de entrada, quando houver. Nullable de proposito: no caso B (a
    -- conexao me paga) a entrada e uma transferencia na minha conta de
    -- investimento; no auto-emprestimo o elo que importa esta em
    -- scheduled_transactions.
    paid_transaction_id uuid,

    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,

    CONSTRAINT mybank_installments_pkey PRIMARY KEY (id),

    -- A UNIQUE QUE EXISTE POR CAUSA DE DINHEIRO
    -- -----------------------------------------
    -- Duas parcelas "7 de 24" no mesmo emprestimo e a mesma divida contada duas
    -- vezes: aparece duas vezes em Contas a Pagar, e a soma das parcelas deixa
    -- de fechar com o principal sem que nenhuma linha esteja errada sozinha.
    CONSTRAINT mybank_installments_loan_id_installment_number_key
      UNIQUE (loan_id, installment_number),

    CONSTRAINT mybank_installments_amount_check
      CHECK (amount > 0),

    CONSTRAINT mybank_installments_number_check
      CHECK (installment_number BETWEEN 1 AND installment_total),

    CONSTRAINT mybank_installments_total_check
      CHECK (installment_total BETWEEN 1 AND 360),

    CONSTRAINT mybank_installments_status_check
      CHECK (status IN ('pending', 'reported', 'paid', 'cancelled')),

    -- paga SE E SOMENTE SE tem data de pagamento. A forma e a do
    -- `scheduled_transactions_paid_check` (005), e o `=` entre os dois
    -- predicados pega os dois lados de uma vez: parcela `paid` sem data, e data
    -- de pagamento em parcela que nao esta paga.
    CONSTRAINT mybank_installments_paid_check
      CHECK ((status = 'paid') = (paid_date IS NOT NULL)),

    CONSTRAINT mybank_installments_loan_id_fkey
      FOREIGN KEY (loan_id) REFERENCES public.mybank_loans(id) ON DELETE CASCADE,

    -- SET NULL e nao CASCADE: apagar o lancamento da perna de entrada nao pode
    -- apagar a PARCELA. A divida continua existindo; o que se perdeu foi o elo.
    CONSTRAINT mybank_installments_paid_transaction_id_fkey
      FOREIGN KEY (paid_transaction_id) REFERENCES public.financial_transactions(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.mybank_installments IS
  'As parcelas de um emprestimo do MyBank. UNIQUE (loan_id, installment_number) porque duas parcelas 7/24 no mesmo emprestimo e dinheiro contado duas vezes. O devedor so consegue levar status de pending para reported: a policy mybank_installments_update e o porteiro, e a trigger mybank_installments_trava_do_devedor e o que prende o amount -- policy nao consegue comparar NEW com OLD.';

COMMENT ON COLUMN public.mybank_installments.status IS
  'pending -> reported (o devedor avisou que pagou) -> paid (o credor confirmou). Quem ve o dinheiro chegar e quem confirma, igual a HMO-366. cancelled sai de qualquer um dos tres.';
COMMENT ON COLUMN public.mybank_installments.reported_at IS
  'Carimbo de quando o devedor avisou. Sobrevive a confirmacao (nao e zerado quando vira paid), por isso NAO ha CHECK amarrando-o ao status.';
COMMENT ON COLUMN public.mybank_installments.installment_total IS
  'Repetido de mybank_loans.installment_count de proposito: a tela e a view leem a parcela, e o "3 de 24" nao deve custar um JOIN por leitura.';

-- ---------------------------------------------------------------------------
-- 4. Indices
-- ---------------------------------------------------------------------------
-- As duas pontas da RLS de SELECT (`lender = eu OR borrower = eu`) e as duas
-- consultas que a F2/F4 fazem: "as parcelas deste emprestimo, por vencimento" e
-- "o que eu devo".
CREATE INDEX IF NOT EXISTS idx_mybank_loans_lender
  ON public.mybank_loans (lender_user_id, status);
CREATE INDEX IF NOT EXISTS idx_mybank_loans_borrower
  ON public.mybank_loans (borrower_user_id, status);
CREATE INDEX IF NOT EXISTS idx_mybank_loans_lender_account
  ON public.mybank_loans (lender_account_id);
CREATE INDEX IF NOT EXISTS idx_mybank_installments_loan_due
  ON public.mybank_installments (loan_id, due_date);
CREATE INDEX IF NOT EXISTS idx_mybank_installments_due
  ON public.mybank_installments (due_date)
  WHERE status IN ('pending', 'reported');

-- ---------------------------------------------------------------------------
-- 5. A trigger das duas travas do emprestimo
-- ---------------------------------------------------------------------------
-- Ver o cabecalho para o porque de ser trigger (CHECK nao aceita subconsulta),
-- de ser DEFINER (a RLS da tabela lida esconderia a linha e a trava recusaria
-- emprestimo legitimo) e de so re-validar quando as colunas dela mudam
-- (senao desfazer uma conexao deixa a divida impossivel de encerrar).
CREATE OR REPLACE FUNCTION public.mybank_loans_trava()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta_ok boolean;
BEGIN
  -- No UPDATE que nao mexe em nenhuma das tres colunas das travas, nada a
  -- conferir. `IS DISTINCT FROM` e nao `<>`: com NULL de um lado, `<>` vale
  -- NULL (que nao e TRUE) e a mudanca passaria batida.
  IF TG_OP = 'UPDATE'
     AND NEW.lender_user_id    IS NOT DISTINCT FROM OLD.lender_user_id
     AND NEW.lender_account_id IS NOT DISTINCT FROM OLD.lender_account_id
     AND NEW.borrower_user_id  IS NOT DISTINCT FROM OLD.borrower_user_id
  THEN
    RETURN NEW;
  END IF;

  -- TRAVA 1: a conta credora e conta DO PROPRIO credor e e de investimento.
  --
  -- As duas condicoes numa consulta so, e a mensagem de erro nao distingue
  -- "nao e sua" de "nao e de investimento" de proposito: dizer "a conta
  -- <uuid> nao e sua" para um id que existe e de outra pessoa confirmaria a
  -- existencia daquela conta para quem chutou o uuid.
  SELECT EXISTS (
    SELECT 1 FROM public.financial_accounts a
     WHERE a.id = NEW.lender_account_id
       AND a.user_id = NEW.lender_user_id
       AND a.account_type = 'investment'
  ) INTO v_conta_ok;

  IF NOT v_conta_ok THEN
    RAISE EXCEPTION 'MyBank: a conta credora tem de ser uma conta de investimento do proprio credor (conta %)', NEW.lender_account_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- TRAVA 2: o devedor e o proprio credor (auto-emprestimo) ou e conexao
  -- `accepted` dele.
  --
  -- O auto-emprestimo sai PRIMEIRO e sem consultar nada: `user_connections` tem
  -- `CHECK (requester_id <> requested_id)`, entao ninguem e conexao de si
  -- mesmo, e sem este desvio o caso A -- o principal da issue -- seria recusado
  -- pela propria trava.
  IF NEW.borrower_user_id IS DISTINCT FROM NEW.lender_user_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_connections uc
       WHERE uc.status = 'accepted'
         AND ( (uc.requester_id = NEW.lender_user_id   AND uc.requested_id = NEW.borrower_user_id)
            OR (uc.requested_id = NEW.lender_user_id   AND uc.requester_id = NEW.borrower_user_id) )
    ) THEN
      RAISE EXCEPTION 'MyBank: so e possivel emprestar para si mesmo ou para uma conexao aceita'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.mybank_loans_trava() IS
  'As duas travas de mybank_loans: conta credora de investimento do proprio credor, e devedor igual ao credor ou conexao accepted dele. Trigger e nao CHECK porque CHECK nao aceita subconsulta; SECURITY DEFINER com search_path fixo porque a RLS de financial_accounts/user_connections esconderia a linha de um escritor que nao e o credor e a trava recusaria emprestimo legitimo (mesmo cuidado de is_group_member). No UPDATE so re-valida se uma das tres colunas mudou: conexao e requisito para criar a divida, nao para encerra-la.';

DROP TRIGGER IF EXISTS mybank_loans_trava ON public.mybank_loans;
CREATE TRIGGER mybank_loans_trava
  BEFORE INSERT OR UPDATE ON public.mybank_loans
  FOR EACH ROW EXECUTE FUNCTION public.mybank_loans_trava();

DROP TRIGGER IF EXISTS mybank_loans_touch_updated_at ON public.mybank_loans;
CREATE TRIGGER mybank_loans_touch_updated_at
  BEFORE UPDATE ON public.mybank_loans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 6. A trava do devedor nas parcelas -- o que a policy nao consegue fazer
-- ---------------------------------------------------------------------------
-- ESTA E A TRIGGER QUE PRENDE O VALOR DA DIVIDA. Ver o cabecalho: `USING` ve
-- OLD, `WITH CHECK` ve NEW, e nenhuma policy ve os dois -- entao nenhuma policy
-- consegue exigir `NEW.amount = OLD.amount`. Sem esta trigger, o devedor que a
-- policy deixou entrar grava `amount = 0.01, status = 'reported'` num UPDATE so
-- e a divida dele encolhe.
--
-- Quem e "o devedor" aqui e `auth.uid()`, e nao o dono da transacao: a funcao e
-- DEFINER, mas `auth.uid()` le o claim da SESSAO (nao o role), entao ela
-- continua respondendo quem clicou.
--
-- `auth.uid() IS NULL` passa direto: e a sessao que NAO e do app -- a colagem no
-- SQL Editor, um backfill, a funcao de servico que a F2 vai usar para
-- materializar a serie. Travar esse caminho faria a propria migration nao
-- conseguir semear uma linha, e nao e dele que esta trava trata.
CREATE OR REPLACE FUNCTION public.mybank_installments_trava_do_devedor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lender   uuid;
  v_borrower uuid;
  v_quem     uuid := auth.uid();
BEGIN
  IF v_quem IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT l.lender_user_id, l.borrower_user_id
    INTO v_lender, v_borrower
    FROM public.mybank_loans l
   WHERE l.id = NEW.loan_id;

  -- O credor manda na parcela dele. No auto-emprestimo ele e tambem o devedor,
  -- e este desvio e o que faz o caso A nao cair na trava.
  IF v_quem IS NOT DISTINCT FROM v_lender THEN
    RETURN NEW;
  END IF;

  IF v_quem IS NOT DISTINCT FROM v_borrower THEN
    -- Os DOIS unicos campos que o devedor mexe.
    IF NEW.status IS DISTINCT FROM 'reported'
       OR OLD.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'MyBank: o devedor so pode marcar uma parcela pendente como reported (tentou % -> %)', OLD.status, NEW.status
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- E mais nenhum. A lista e explicita (e nao "tudo menos status") para que
    -- uma coluna NOVA nesta tabela nasca FECHADA para o devedor: quem a
    -- acrescentar tem de vir aqui decidir, em vez de descobrir depois que ela
    -- sempre foi escrivel por quem deve.
    IF NEW.id                  IS DISTINCT FROM OLD.id
       OR NEW.loan_id             IS DISTINCT FROM OLD.loan_id
       OR NEW.installment_number  IS DISTINCT FROM OLD.installment_number
       OR NEW.installment_total   IS DISTINCT FROM OLD.installment_total
       OR NEW.amount              IS DISTINCT FROM OLD.amount
       OR NEW.due_date            IS DISTINCT FROM OLD.due_date
       OR NEW.paid_date           IS DISTINCT FROM OLD.paid_date
       OR NEW.paid_transaction_id IS DISTINCT FROM OLD.paid_transaction_id
    THEN
      RAISE EXCEPTION 'MyBank: o devedor nao pode alterar valor, vencimento, numero nem o elo de pagamento da parcela -- so avisar que pagou'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN NEW;
  END IF;

  -- Nem credor nem devedor. A RLS ja teria barrado; isto e a rede por baixo
  -- dela, para o caso de uma policy futura afrouxar sem querer.
  RAISE EXCEPTION 'MyBank: so o credor ou o devedor mexem numa parcela'
    USING ERRCODE = 'insufficient_privilege';
END $$;

COMMENT ON FUNCTION public.mybank_installments_trava_do_devedor() IS
  'Prende o valor da parcela do lado do devedor. Existe porque policy de UPDATE nao consegue comparar NEW com OLD (USING ve OLD, WITH CHECK ve NEW): com a policy sozinha o devedor gravaria amount = 0.01 junto com status = reported num UPDATE so. Deixa o devedor mexer em status (pending -> reported) e reported_at, e em mais nada. auth.uid() IS NULL passa direto -- e a sessao que nao e do app (colagem, backfill, funcao de servico).';

DROP TRIGGER IF EXISTS mybank_installments_trava_do_devedor ON public.mybank_installments;
CREATE TRIGGER mybank_installments_trava_do_devedor
  BEFORE UPDATE ON public.mybank_installments
  FOR EACH ROW EXECUTE FUNCTION public.mybank_installments_trava_do_devedor();

DROP TRIGGER IF EXISTS mybank_installments_touch_updated_at ON public.mybank_installments;
CREATE TRIGGER mybank_installments_touch_updated_at
  BEFORE UPDATE ON public.mybank_installments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.mybank_loans        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mybank_installments ENABLE ROW LEVEL SECURITY;

-- SELECT: os DOIS lados veem a linha.
--
-- E isto que faz o devedor ver a divida dele sem ver o resto da minha vida
-- financeira -- ele alcanca ESTA tabela, e nao `financial_transactions`. Mesma
-- forma do `group_settlements_select` (007), que e `USING (is_group_member(
-- group_id))` e por isso deixa os dois lados do acerto verem a linha.
DROP POLICY IF EXISTS mybank_loans_select ON public.mybank_loans;
CREATE POLICY mybank_loans_select ON public.mybank_loans
  FOR SELECT TO authenticated
  USING (lender_user_id = auth.uid() OR borrower_user_id = auth.uid());

-- INSERT: so em nome proprio. Ninguem cria divida no nome de outro.
--
-- O `borrower` NAO e conferido aqui: quem o confere e a trigger da SECAO 5, que
-- precisa de subconsulta. A policy e o "sou eu o credor"; a trigger e o "e o
-- devedor pode ser este".
DROP POLICY IF EXISTS mybank_loans_insert ON public.mybank_loans;
CREATE POLICY mybank_loans_insert ON public.mybank_loans
  FOR INSERT TO authenticated
  WITH CHECK (lender_user_id = auth.uid());

-- UPDATE: so o credor, e ele nao pode transferir o emprestimo para outro
-- credor enquanto edita (`lender_user_id = auth.uid()` nos dois lados).
DROP POLICY IF EXISTS mybank_loans_update ON public.mybank_loans;
CREATE POLICY mybank_loans_update ON public.mybank_loans
  FOR UPDATE TO authenticated
  USING (lender_user_id = auth.uid())
  WITH CHECK (lender_user_id = auth.uid());

-- DELETE: so o credor, e so emprestimo SEM PARCELA PAGA.
--
-- O `NOT EXISTS` e o que impede apagar historico de dinheiro: parcela `paid` ja
-- tem (ou teve) uma perna em `financial_transactions`, e o ON DELETE CASCADE de
-- `loan_id` levaria a parcela junto com o emprestimo. Emprestimo que andou se
-- encerra com `status = 'cancelled'`, nao com DELETE.
DROP POLICY IF EXISTS mybank_loans_delete ON public.mybank_loans;
CREATE POLICY mybank_loans_delete ON public.mybank_loans
  FOR DELETE TO authenticated
  USING (
    lender_user_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.mybank_installments i
       WHERE i.loan_id = mybank_loans.id
         AND i.status = 'paid'
    )
  );

-- As parcelas: a autorizacao mora no emprestimo, alcancado por EXISTS.
DROP POLICY IF EXISTS mybank_installments_select ON public.mybank_installments;
CREATE POLICY mybank_installments_select ON public.mybank_installments
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.mybank_loans l
     WHERE l.id = mybank_installments.loan_id
       AND (l.lender_user_id = auth.uid() OR l.borrower_user_id = auth.uid())
  ));

-- INSERT de parcela: so o credor. A serie nasce do lado de quem emprestou.
DROP POLICY IF EXISTS mybank_installments_insert ON public.mybank_installments;
CREATE POLICY mybank_installments_insert ON public.mybank_installments
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.mybank_loans l
     WHERE l.id = mybank_installments.loan_id
       AND l.lender_user_id = auth.uid()
  ));

-- UPDATE de parcela: o credor em qualquer campo; o devedor SO levando
-- `pending -> reported`.
--
-- O `USING` ve a linha ANTIGA e o `WITH CHECK` a NOVA -- as duas sao precisas, e
-- MESMO ASSIM elas nao prendem o `amount`, porque nenhuma das duas ve os dois
-- lados. Quem prende e a trigger da SECAO 6. Ver o cabecalho; esta e a parte
-- da issue que precisou de mais do que o que ela pedia.
DROP POLICY IF EXISTS mybank_installments_update ON public.mybank_installments;
CREATE POLICY mybank_installments_update ON public.mybank_installments
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.mybank_loans l
     WHERE l.id = mybank_installments.loan_id
       AND ( l.lender_user_id = auth.uid()
          OR (l.borrower_user_id = auth.uid() AND mybank_installments.status = 'pending') )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.mybank_loans l
     WHERE l.id = mybank_installments.loan_id
       AND ( l.lender_user_id = auth.uid()
          OR (l.borrower_user_id = auth.uid()
              AND mybank_installments.status = 'reported'
              AND mybank_installments.reported_at IS NOT NULL) )
  ));

-- DELETE de parcela: so o credor, e so parcela nao paga.
DROP POLICY IF EXISTS mybank_installments_delete ON public.mybank_installments;
CREATE POLICY mybank_installments_delete ON public.mybank_installments
  FOR DELETE TO authenticated
  USING (
    mybank_installments.status <> 'paid'
    AND EXISTS (
      SELECT 1 FROM public.mybank_loans l
       WHERE l.id = mybank_installments.loan_id
         AND l.lender_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 8. A view do devedor
-- ---------------------------------------------------------------------------
-- O 002 rodou `GRANT ... ON ALL TABLES` antes destas tabelas existirem, e ALL
-- TABLES e uma fotografia do momento -- nao alcanca objeto criado depois.
REVOKE ALL ON public.mybank_loans        FROM anon;
REVOKE ALL ON public.mybank_installments FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mybank_loans        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mybank_installments TO authenticated;

-- As funcoes das travas sao DEFINER: `anon` com EXECUTE nelas seria executar
-- codigo com o privilegio do dono a partir de uma sessao nao autenticada. Elas
-- sao chamadas pela TRIGGER, que nao precisa de EXECUTE de ninguem.
--
-- O `FROM PUBLIC` E O QUE FAZ ESTE REVOKE VALER
-- ---------------------------------------------
-- O Postgres concede EXECUTE a PUBLIC em toda funcao nova, por default. Um
-- `REVOKE ... FROM anon` sozinho nao tira nada: o privilegio do `anon` nao e
-- dele, e herdado de PUBLIC -- e `has_function_privilege('anon', ...)`
-- continua TRUE depois do revoke. Isto nao foi deduzido: o posflight da SECAO
-- 9 reprovou esta migration com `anon ficou com EXECUTE` na primeira rodada,
-- com as duas funcoes, exatamente neste ponto. E o mesmo default que deixou
-- funcoes do baseline executaveis por `anon`.
REVOKE ALL ON FUNCTION public.mybank_loans_trava()                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mybank_installments_trava_do_devedor() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8.1 mybank_due_entries -- a divida, no formato que Contas a Pagar une
-- ---------------------------------------------------------------------------
-- NENHUM LEITOR NESTA FASE. A view nasce para a F2/F4, e e a forma do
-- `group_share_entries` (033): uma linha por parcela, `amount` POSITIVO, sem
-- agregacao -- quem le soma.
--
-- POR QUE ELA EXCLUI O AUTO-EMPRESTIMO (`borrower <> lender`)
-- -----------------------------------------------------------
-- Esta e a linha mais importante do arquivo, e ela e sobre dinheiro contado
-- duas vezes. Pela decisao 1 da HMO-368, a parcela do AUTO-emprestimo ja e uma
-- TRANSFERENCIA PREVISTA em `scheduled_transactions` -- ela aparece em Contas a
-- Pagar pelo caminho que ja existe. Se esta view a devolvesse tambem, a F2
-- uniria as duas fontes e a mesma parcela apareceria DUAS VEZES na tela e
-- contaria DUAS VEZES no total.
--
-- O filtro esta na VIEW e nao numa coluna-sinalizadora que o leitor "deve"
-- conferir, de proposito: coluna de aviso que o leitor esquece de ler e um
-- numero errado em producao, e a F2 e escrita por quem nao escreveu isto. O que
-- esta view responde e exatamente "a divida que NAO tem linha minha em
-- scheduled_transactions" -- as outras parcelas nao estao faltando, elas estao
-- do outro lado.
--
-- POR QUE NAO HA JOIN COM financial_accounts NEM COM profiles
-- -----------------------------------------------------------
-- A view e `security_invoker`, logo as policies valem COM O USUARIO QUE LE --
-- que aqui e o DEVEDOR. `financial_accounts` tem RLS `user_id = auth.uid()`, e
-- a conta credora e do CREDOR: o JOIN nao devolveria nulo, ele DESCARTARIA A
-- LINHA, e a view ficaria VAZIA para o devedor sem erro nenhum. Mesma armadilha
-- do embed descartado pela RLS. Entao:
--
--   * moeda: NAO esta aqui. Contas a Pagar e BRL-only hoje -- quem garante e o
--     CHECK `scheduled_transactions_currency_brl` --, e `mybank_loans` nao tem
--     coluna de moeda. No dia em que o emprestimo tiver moeda, a coluna entra
--     em `mybank_loans` (que o devedor LE) e aqui, nunca por JOIN na conta;
--   * nome do credor: NAO esta aqui. Quem precisar dele faz o embed de
--     `profiles` pelo `lender_user_id` -- o devedor alcanca aquele perfil pela
--     `profiles_select_connected` (010), que e justamente a policy que a trava
--     da conexao garante existir.
--
-- `security_invoker = true` nao e detalhe: view sem ele roda com o privilegio
-- do DONO e fura a RLS das duas tabelas -- a view passaria a devolver a divida
-- de todo mundo para qualquer um que a consultasse. O `WHERE borrower_user_id =
-- auth.uid()` nao substitui isso: ele filtra, mas quem o avalia tem de ser uma
-- sessao sujeita a RLS, senao basta uma leitura mais criativa para contornar.
CREATE OR REPLACE VIEW public.mybank_due_entries AS
  SELECT
    i.id                      AS id,
    i.loan_id                 AS loan_id,
    l.borrower_user_id        AS user_id,
    l.lender_user_id          AS lender_user_id,
    l.description             AS description,
    i.amount                  AS amount,
    i.due_date                AS due_date,
    i.status                  AS status,
    i.installment_number      AS installment_number,
    i.installment_total       AS installment_total,
    i.reported_at             AS reported_at
  FROM public.mybank_installments i
  JOIN public.mybank_loans l ON l.id = i.loan_id
  WHERE l.borrower_user_id = auth.uid()
    -- o auto-emprestimo ja esta em scheduled_transactions; ver o cabecalho
    AND l.borrower_user_id IS DISTINCT FROM l.lender_user_id
    AND l.status = 'active'
    -- `reported` CONTINUA aparecendo: o devedor avisou e o credor ainda nao
    -- confirmou, e sumir da tela nesse intervalo faria a conta parecer paga.
    -- E a convencao da HMO-366.
    AND i.status IN ('pending', 'reported');

ALTER VIEW public.mybank_due_entries SET (security_invoker = true);

COMMENT ON VIEW public.mybank_due_entries IS
  'O que EU devo no MyBank, uma linha por parcela, amount POSITIVO -- no formato que Contas a Pagar une, a forma do group_share_entries. EXCLUI o auto-emprestimo (borrower = lender) porque aquela parcela ja e uma transferencia prevista em scheduled_transactions: devolve-la aqui faria a mesma parcela aparecer duas vezes na tela e contar duas vezes no total. security_invoker = true; sem isso a view roda com o privilegio do dono e devolve a divida de todo mundo. NAO fazer JOIN com financial_accounts (a conta e do credor, a RLS descartaria a linha e a view ficaria vazia para o devedor). Sem leitor na fase 1: nasce para a F2/F4.';

REVOKE ALL ON public.mybank_due_entries FROM anon;
GRANT SELECT ON public.mybank_due_entries TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. POSFLIGHT: a 053 ficou completa?
-- ---------------------------------------------------------------------------
-- Dentro da transacao, para a colagem pela metade nao existir. O que se confere
-- aqui e o que NAO da erro quando falta: RLS desligada, `security_invoker`
-- perdido num `CREATE OR REPLACE VIEW`, DEFINER virando INVOKER, `anon` com
-- privilegio. Nenhum desses aparece como erro de SQL -- os quatro aparecem como
-- dado vazando ou trava que nao trava.
DO $$
DECLARE
  problemas text := '';
  v_oid     oid;
BEGIN
  -- RLS nas duas tabelas.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.mybank_loans')) THEN
    problemas := problemas || E'\n  - mybank_loans ficou sem ROW LEVEL SECURITY';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.mybank_installments')) THEN
    problemas := problemas || E'\n  - mybank_installments ficou sem ROW LEVEL SECURITY';
  END IF;

  -- As 8 policies.
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'mybank_loans') <> 4 THEN
    problemas := problemas || E'\n  - mybank_loans nao ficou com as 4 policies (select/insert/update/delete)';
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'mybank_installments') <> 4 THEN
    problemas := problemas || E'\n  - mybank_installments nao ficou com as 4 policies (select/insert/update/delete)';
  END IF;

  -- O WITH CHECK da policy de UPDATE das parcelas. Sem ele o Postgres repete o
  -- USING sobre a linha nova, e o devedor mantem a parcela em `pending` com o
  -- valor que quiser. `with_check IS NULL` e exatamente esse estado, e ele NAO
  -- da erro em lugar nenhum.
  IF (SELECT with_check FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'mybank_installments'
         AND policyname = 'mybank_installments_update') IS NULL THEN
    problemas := problemas || E'\n  - mybank_installments_update ficou SEM WITH CHECK; o devedor reescreveria a parcela';
  END IF;

  -- As duas funcoes de trava: DEFINER, com search_path, e sem EXECUTE para anon.
  FOREACH v_oid IN ARRAY ARRAY[
    to_regprocedure('public.mybank_loans_trava()'),
    to_regprocedure('public.mybank_installments_trava_do_devedor()')
  ] LOOP
    IF v_oid IS NULL THEN
      problemas := problemas || E'\n  - uma das funcoes de trava nao foi criada';
    ELSE
      IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_oid AND prosecdef) THEN
        problemas := problemas || E'\n  - ' || v_oid::regprocedure::text || ' ficou SECURITY INVOKER; a RLS da tabela lida esconderia a linha e a trava recusaria emprestimo legitimo';
      END IF;
      IF (SELECT proconfig FROM pg_proc WHERE oid = v_oid) IS NULL THEN
        problemas := problemas || E'\n  - ' || v_oid::regprocedure::text || ' ficou sem search_path fixo (DEFINER sem search_path e escalada de privilegio)';
      END IF;
      IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
        problemas := problemas || E'\n  - anon ficou com EXECUTE em ' || v_oid::regprocedure::text;
      END IF;
    END IF;
  END LOOP;

  -- As duas triggers estao ARMADAS. Funcao criada e trigger ausente e uma trava
  -- que existe no banco e nunca dispara -- e `pg_get_functiondef` continuaria
  -- mostrando o codigo dela para quem fosse conferir.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = to_regclass('public.mybank_loans')
                    AND tgname = 'mybank_loans_trava' AND NOT tgisinternal) THEN
    problemas := problemas || E'\n  - a trigger mybank_loans_trava nao esta armada';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = to_regclass('public.mybank_installments')
                    AND tgname = 'mybank_installments_trava_do_devedor' AND NOT tgisinternal) THEN
    problemas := problemas || E'\n  - a trigger mybank_installments_trava_do_devedor nao esta armada';
  END IF;

  -- A UNIQUE de dinheiro.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = to_regclass('public.mybank_installments')
                    AND contype = 'u'
                    AND conname = 'mybank_installments_loan_id_installment_number_key') THEN
    problemas := problemas || E'\n  - a UNIQUE (loan_id, installment_number) nao ficou; duas parcelas 7/24 contariam o dinheiro duas vezes';
  END IF;

  -- `security_invoker` da view. `CREATE OR REPLACE VIEW` APAGA reloptions, e
  -- este item e o que pega uma 05x futura que recrie a view sem o ALTER.
  IF to_regclass('public.mybank_due_entries') IS NULL THEN
    problemas := problemas || E'\n  - a view mybank_due_entries nao foi criada';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = to_regclass('public.mybank_due_entries')
       AND reloptions @> ARRAY['security_invoker=true']
  ) THEN
    problemas := problemas || E'\n  - mybank_due_entries ficou SEM security_invoker=true; ela furaria a RLS e devolveria a divida de todo mundo';
  END IF;

  -- `anon` nas tabelas e na view.
  IF has_table_privilege('anon', 'public.mybank_loans', 'SELECT')
     OR has_table_privilege('anon', 'public.mybank_installments', 'SELECT')
     OR has_table_privilege('anon', 'public.mybank_due_entries', 'SELECT') THEN
    problemas := problemas || E'\n  - anon ficou com SELECT no MyBank';
  END IF;

  IF problemas <> '' THEN
    RAISE EXCEPTION '053 nao ficou completa:%', problemas;
  END IF;

  RAISE NOTICE '053 ok: mybank_loans e mybank_installments com RLS e 4 policies cada, as duas travas armadas em funcao DEFINER com search_path, a UNIQUE (loan_id, installment_number), e mybank_due_entries com security_invoker=true e sem leitor.';
END $$;

COMMIT;
