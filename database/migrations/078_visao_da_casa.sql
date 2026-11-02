-- ===========================================================================
-- 078 -- A VISAO DA CASA: o mes da familia somado, conta conjunta e dependente
-- ===========================================================================
-- Item 2 do plano em docs/MAPA-DO-PROJETO.md ("Financas da familia"). A 076
-- deu nome a familia (`expense_groups.group_kind = 'casa'`); esta migration da
-- a ela o que o mapa lista como faltando:
--
--   * VISAO DA CASA. Cada membro so le o proprio mes (RLS). A casa precisa de
--     uma leitura que some o Resultado de todos, sem abrir a tabela de
--     lancamentos de um para o outro.
--   * CONTA CONJUNTA. `financial_accounts.user_id` e um dono so. A conta do
--     casal passa a poder ser marcada como conjunta de uma casa: os membros
--     ativos dela veem a conta, o saldo e o extrato, e lancam nela.
--   * DEPENDENTE SEM LOGIN. O filho, ou quem nao vai instalar o app. E o
--     "membro sem conta" de group_members (user_id nulo + display_name), o
--     MESMO modelo do participante sem conta do grupo de evento, que e dono da
--     077. A SECAO 2 repete os tres passos da 077 de forma idempotente para as
--     duas migrations poderem ser coladas em qualquer ordem.
--
-- O QUE CADA MEMBRO MOSTRA E ESCOLHA DELE
-- ---------------------------------------
-- Entrar na casa nao abre o mes de ninguem. `group_members.compartilha_com_a_casa`
-- nasce FALSE, e so o proprio membro o liga (trigger da SECAO 3: nem o admin
-- muda o de outro). Quem nao compartilha aparece na visao como membro, sem
-- numero. O que e compartilhado e o TOTAL do mes (entrou, saiu, resultado) e o
-- total do saldo das contas de dinheiro -- nunca a lista de lancamentos
-- pessoais. A lista so existe para a conta conjunta, que e da casa.
--
-- POR QUE A SOMA DA CASA NAO E SO A SOMA DOS RESULTADOS
-- -----------------------------------------------------
-- O Resultado de cada um (`personal_monthly_cash_flow`, o mesmo criterio de
-- lib/services/resultado-do-mes.ts) e escrito do ponto de vista de UMA pessoa.
-- Somar o de dois membros da casa conta duas vezes o que um deve ao outro:
--
--   grupo da casa SEM dia de fechamento: Ana paga o mercado de 100 e o grupo
--   divide 50/50. Ana tem -100 (perna 1, quem pagou conta inteiro) e Beto -50
--   (perna 2, a parte dele do que OUTRO pagou). Soma: -150. A casa gastou 100.
--
-- Os 50 do Beto sao uma divida dentro da casa, nao dinheiro que saiu dela. Por
-- isso `resultado_da_casa` devolve, ao lado do Resultado de cada membro, o
-- `interno`: a perna 2 dele cujo pagador TAMBEM compartilha com a casa. A casa
-- e  soma(resultado) - soma(interno)  (lib/resultado-da-casa.ts).
--
-- O grupo da casa COM dia de fechamento ja fecha sozinho: a parte de quem nao
-- pagou sai da perna 2 (069) e a divida vira "Pagamento ao grupo" de um lado e
-- "A receber do grupo" do outro, que se anulam na soma quando os dois
-- compartilham. A divisao com conexao (070) e igual: "Pagamento a" e "A receber
-- de" se anulam.
--
-- LIMITE CONHECIDO: se so um dos dois lados compartilha, a divida interna dele
-- aparece na soma (ex.: so a Ana compartilha e o "A receber do grupo" dela
-- entra como receita da casa). E o preco de nao ler o mes de quem nao deixou.
--
-- A CONTA CONJUNTA
-- ----------------
-- `financial_accounts.casa_id` aponta a casa. Regras (trigger da SECAO 4):
--   * so grupo `casa`, ativo, de que o dono e membro ativo;
--   * cartao de credito nao (a fatura e por pessoa: 041/072);
--   * quem nao e o dono so muda o saldo -- e o `update_account_balance` (007)
--     rodando na sessao dele quando ele lanca na conta. Nome, tipo, dono e a
--     propria marca de conjunta continuam do dono.
-- O lancamento na conta conjunta continua sendo de quem lancou (`user_id`), e
-- por isso entra no Resultado de quem lancou, como qualquer outro.
--
-- Os membros ganham SELECT e UPDATE na conta pela policy nova. NAO ganham
-- SELECT nos lancamentos dos outros: a tabela `financial_transactions` tem
-- leitores que somam sem filtrar `user_id`, e abrir a policy deles mudaria
-- numero em tela que nao tem nada a ver com a casa. O extrato vem pela funcao
-- `extrato_da_conta_conjunta`, que so devolve as linhas daquela conta.
--
-- O PASSO HUMANO
-- --------------
-- Colar no SQL Editor do Supabase depois da 076. Pode vir antes ou depois da
-- 077 (membro sem conta). Re-executavel.
-- ===========================================================================

BEGIN;

-- ===========================================================================
-- SECAO 1: PREFLIGHT
-- ===========================================================================
DO $$
DECLARE
  v_faltando text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'expense_groups'
       AND column_name = 'group_kind'
  ) THEN
    v_faltando := v_faltando || E'\n  - expense_groups.group_kind (vem da 076)';
  END IF;

  IF to_regclass('public.personal_monthly_cash_flow') IS NULL THEN
    v_faltando := v_faltando || E'\n  - view public.personal_monthly_cash_flow (vem da 033)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'group_share_entries'
       AND column_name = 'pago_por'
  ) THEN
    v_faltando := v_faltando || E'\n  - coluna group_share_entries.pago_por (vem da 066)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'financial_accounts'
       AND column_name = 'include_in_total'
  ) THEN
    v_faltando := v_faltando || E'\n  - coluna financial_accounts.include_in_total (vem da 058)';
  END IF;

  IF v_faltando <> '' THEN
    RAISE EXCEPTION E'A 078 nao pode ser aplicada neste banco. Faltando:%', v_faltando;
  END IF;
END $$;

-- ===========================================================================
-- SECAO 2: O MEMBRO SEM CONTA (os tres passos da 077, idempotentes)
-- ===========================================================================
-- Mesmos nomes da 077, combinados entre as duas entregas. Quem chegar primeiro
-- cria; quem chegar depois nao muda nada.
ALTER TABLE public.group_members ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.group_members ADD COLUMN IF NOT EXISTS display_name text;

ALTER TABLE public.group_members DROP CONSTRAINT IF EXISTS group_members_quem_e_check;
ALTER TABLE public.group_members
  ADD CONSTRAINT group_members_quem_e_check
  CHECK (user_id IS NOT NULL OR length(btrim(display_name)) > 0);

-- ===========================================================================
-- SECAO 3: O MEMBRO DIZ SE MOSTRA O MES PARA A CASA
-- ===========================================================================
ALTER TABLE public.group_members
  ADD COLUMN IF NOT EXISTS compartilha_com_a_casa boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.group_members.compartilha_com_a_casa IS
  'O membro mostra para a casa o TOTAL do mes dele (entrou, saiu, resultado) e o total do saldo das contas de dinheiro (078). Nasce false; so o proprio membro muda (trg_compartilha_com_a_casa_so_o_membro). Nao abre a lista de lancamentos.';

-- A policy `group_members_update` (002) deixa o ADMIN atualizar a linha de
-- qualquer membro. Para o percentual e o papel isso e o certo (040); para o
-- consentimento, nao: o admin ligaria o mes de outra pessoa.
CREATE OR REPLACE FUNCTION public.compartilha_com_a_casa_so_o_membro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;  -- service role / manutencao
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.compartilha_com_a_casa AND NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'so o proprio membro decide mostrar o mes dele para a casa'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.compartilha_com_a_casa IS DISTINCT FROM OLD.compartilha_com_a_casa
     AND OLD.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'so o proprio membro decide mostrar o mes dele para a casa'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compartilha_com_a_casa_so_o_membro ON public.group_members;
CREATE TRIGGER trg_compartilha_com_a_casa_so_o_membro
  BEFORE INSERT OR UPDATE ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.compartilha_com_a_casa_so_o_membro();

-- ===========================================================================
-- SECAO 4: A CONTA CONJUNTA
-- ===========================================================================
ALTER TABLE public.financial_accounts
  ADD COLUMN IF NOT EXISTS casa_id uuid
  REFERENCES public.expense_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS financial_accounts_casa_id_idx
  ON public.financial_accounts (casa_id) WHERE casa_id IS NOT NULL;

COMMENT ON COLUMN public.financial_accounts.casa_id IS
  'Conta conjunta da casa (078): os membros ativos do grupo casa veem a conta, o saldo e o extrato (extrato_da_conta_conjunta) e lancam nela. NULL = conta so do dono. Cartao de credito nao pode ser conjunto.';

-- E a casa ainda e uma casa, ativa, e as duas pessoas sao membros ativos dela?
-- DEFINER porque quem pergunta pode nao ler a linha de group_members do dono
-- (e le: e membro do mesmo grupo -- mas a policy e uma, e esta funcao e usada
-- tambem dentro da propria policy de financial_accounts, onde uma subconsulta
-- INVOKER em group_members reentraria na RLS dela).
CREATE OR REPLACE FUNCTION public.conta_conjunta_alcanca(p_casa_id uuid, p_dono uuid, p_quem uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_casa_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.expense_groups g
        WHERE g.id = p_casa_id AND g.group_kind = 'casa' AND g.is_active
     )
     AND EXISTS (
       SELECT 1 FROM public.group_members m
        WHERE m.group_id = p_casa_id AND m.user_id = p_dono AND m.status = 'active'
     )
     AND EXISTS (
       SELECT 1 FROM public.group_members m
        WHERE m.group_id = p_casa_id AND m.user_id = p_quem AND m.status = 'active'
     );
$$;

REVOKE ALL ON FUNCTION public.conta_conjunta_alcanca(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_conjunta_alcanca(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.trava_da_conta_conjunta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Quem nao e o dono so mexe no saldo (o trigger de saldo rodando na sessao
  -- de quem lancou). Compara a linha inteira menos as duas colunas que ele
  -- pode mudar: uma coluna nova na tabela fica travada sem ninguem lembrar
  -- de por aqui.
  IF TG_OP = 'UPDATE' AND auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM OLD.user_id THEN
    IF (to_jsonb(NEW) - 'current_balance' - 'updated_at')
       IS DISTINCT FROM (to_jsonb(OLD) - 'current_balance' - 'updated_at') THEN
      RAISE EXCEPTION 'na conta conjunta, so o dono muda os dados da conta; os outros membros so lancam nela'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.casa_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- So valida quando a marca nasce ou muda: uma conta conjunta antiga cujo
  -- dono saiu da casa continua editavel pelo dono (ela so para de aparecer
  -- para a casa, pela policy).
  IF TG_OP = 'UPDATE'
     AND NEW.casa_id IS NOT DISTINCT FROM OLD.casa_id
     AND NEW.account_type IS NOT DISTINCT FROM OLD.account_type THEN
    RETURN NEW;
  END IF;

  IF NEW.account_type = 'credit_card' THEN
    RAISE EXCEPTION 'cartao de credito nao pode ser conta conjunta: a fatura e de quem tem o cartao'
      USING ERRCODE = '23514';
  END IF;

  IF NOT public.conta_conjunta_alcanca(NEW.casa_id, NEW.user_id, NEW.user_id) THEN
    RAISE EXCEPTION 'a conta conjunta tem de ser de um grupo do tipo casa, ativo, de que o dono e membro ativo'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trava_da_conta_conjunta ON public.financial_accounts;
CREATE TRIGGER trg_trava_da_conta_conjunta
  BEFORE INSERT OR UPDATE ON public.financial_accounts
  FOR EACH ROW EXECUTE FUNCTION public.trava_da_conta_conjunta();

-- As duas policies novas somam as do dono (`financial_accounts_own`, 002):
-- policies permissivas sao OU.
DROP POLICY IF EXISTS financial_accounts_conjunta_select ON public.financial_accounts;
CREATE POLICY financial_accounts_conjunta_select ON public.financial_accounts
  FOR SELECT TO authenticated
  USING (casa_id IS NOT NULL AND public.conta_conjunta_alcanca(casa_id, user_id, auth.uid()));

-- O UPDATE existe para o `update_account_balance` (007, SECURITY INVOKER)
-- conseguir mexer no saldo quando OUTRO membro lanca na conta. Sem ele o
-- lancamento gravaria e o saldo ficaria parado, calado. O resto da linha esta
-- travado pelo trigger acima.
DROP POLICY IF EXISTS financial_accounts_conjunta_update ON public.financial_accounts;
CREATE POLICY financial_accounts_conjunta_update ON public.financial_accounts
  FOR UPDATE TO authenticated
  USING (casa_id IS NOT NULL AND public.conta_conjunta_alcanca(casa_id, user_id, auth.uid()))
  WITH CHECK (casa_id IS NOT NULL AND public.conta_conjunta_alcanca(casa_id, user_id, auth.uid()));

-- Quem lanca numa conta conjunta tem de ser da casa. Sem isto, o ex-membro que
-- edita ou apaga um lancamento antigo dele na conta passaria pela RLS do
-- lancamento (e dele) e o trigger de saldo nao alcancaria a conta (ja nao e
-- membro): o saldo ficaria errado sem erro nenhum. Melhor recusar com motivo.
-- So olha conta conjunta: o comportamento de toda outra conta fica igual.
CREATE OR REPLACE FUNCTION public.lancamento_na_conta_conjunta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta record;
  v_linha record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_linha := OLD;
  ELSE
    v_linha := NEW;
  END IF;

  IF v_linha.account_id IS NULL THEN
    RETURN v_linha;
  END IF;

  SELECT a.user_id, a.casa_id INTO v_conta
    FROM public.financial_accounts a WHERE a.id = v_linha.account_id;

  IF v_conta.casa_id IS NULL OR v_conta.user_id = v_linha.user_id THEN
    RETURN v_linha;
  END IF;

  IF NOT public.conta_conjunta_alcanca(v_conta.casa_id, v_conta.user_id, v_linha.user_id) THEN
    RAISE EXCEPTION 'so os membros da casa lancam na conta conjunta (e mexem nos lancamentos dela)'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_linha;
END;
$$;

REVOKE ALL ON FUNCTION public.lancamento_na_conta_conjunta() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_lancamento_na_conta_conjunta ON public.financial_transactions;
CREATE TRIGGER trg_lancamento_na_conta_conjunta
  BEFORE INSERT OR UPDATE OR DELETE ON public.financial_transactions
  FOR EACH ROW EXECUTE FUNCTION public.lancamento_na_conta_conjunta();

-- ===========================================================================
-- SECAO 5: AS LEITURAS DA CASA
-- ===========================================================================
-- Todas SECURITY DEFINER: elas leem o que a RLS nao deixaria quem pergunta ler
-- (o mes dos outros membros). Por isso cada uma comeca checando que quem
-- pergunta e membro ATIVO de uma casa ATIVA, e so devolve o que o membro
-- escolheu mostrar.

-- Quem pergunta pode ler esta casa? Erro com motivo em vez de lista vazia: a
-- tela diferencia "nao e casa" de "casa sem movimento".
CREATE OR REPLACE FUNCTION public.exige_membro_da_casa(p_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'sem sessao' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.expense_groups g
     WHERE g.id = p_group_id AND g.group_kind = 'casa' AND g.is_active
  ) THEN
    RAISE EXCEPTION 'este grupo nao e uma casa ativa' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members m
     WHERE m.group_id = p_group_id AND m.user_id = auth.uid() AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'so os membros da casa veem a casa' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.exige_membro_da_casa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exige_membro_da_casa(uuid) TO authenticated;

-- 5.1 Os membros, com nome. O nome vem daqui porque `profiles` so e legivel
-- para o proprio, para perfil publico e para conexao (002/010): o membro da
-- casa que nao e conexao apareceria sem nome.
DROP FUNCTION IF EXISTS public.membros_da_casa(uuid);
CREATE FUNCTION public.membros_da_casa(p_group_id uuid)
RETURNS TABLE (
  member_id uuid,
  user_id uuid,
  nome text,
  role text,
  dependente boolean,
  compartilha boolean,
  sou_eu boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.exige_membro_da_casa(p_group_id);

  RETURN QUERY
  SELECT m.id,
         m.user_id,
         COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(m.display_name), ''), 'Membro')::text,
         m.role::text,
         (m.user_id IS NULL),
         (m.user_id IS NOT NULL AND m.compartilha_com_a_casa),
         (m.user_id IS NOT DISTINCT FROM auth.uid())
    FROM public.group_members m
    LEFT JOIN public.profiles p ON p.id = m.user_id
   WHERE m.group_id = p_group_id
     AND m.status = 'active'
   ORDER BY (m.user_id IS NULL), (m.role <> 'admin'), 3, m.id;
END;
$$;

REVOKE ALL ON FUNCTION public.membros_da_casa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.membros_da_casa(uuid) TO authenticated;

-- 5.2 O Resultado de cada membro que compartilha, mes a mes, e o interno.
--
-- `resultado`: a linha de `personal_monthly_cash_flow` do membro -- o mesmo
-- numero que ele ve no painel dele (lerResultadoPorMes, #415).
-- `interno`: a perna 2 dele (group_share_entries, NOT paguei_eu) cujo pagador
-- tambem compartilha com esta casa. E exatamente o recorte que a perna 2 da
-- `personal_category_monthly_totals` (072) soma, restrito ao pagador da casa.
DROP FUNCTION IF EXISTS public.resultado_da_casa(uuid, date, date);
CREATE FUNCTION public.resultado_da_casa(p_group_id uuid, p_desde date, p_ate date)
RETURNS TABLE (
  user_id uuid,
  month date,
  currency text,
  income numeric,
  expense numeric,
  net numeric,
  transaction_count bigint,
  interno_expense numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.exige_membro_da_casa(p_group_id);

  RETURN QUERY
  WITH quem AS (
    SELECT m.user_id
      FROM public.group_members m
     WHERE m.group_id = p_group_id
       AND m.status = 'active'
       AND m.user_id IS NOT NULL
       AND m.compartilha_com_a_casa
  ),
  resultado AS (
    SELECT r.user_id, r.month, r.currency,
           r.income, r.expense, r.net, r.transaction_count
      FROM public.personal_monthly_cash_flow r
     WHERE r.user_id IN (SELECT q.user_id FROM quem q)
       AND r.month >= date_trunc('month', p_desde)::date
       AND r.month <= p_ate
  ),
  interno AS (
    SELECT e.user_id, e.month, e.currency,
           SUM(e.amount)::numeric(15,2) AS expense
      FROM public.group_share_entries e
     WHERE NOT e.paguei_eu
       AND e.user_id IN (SELECT q.user_id FROM quem q)
       AND e.pago_por IN (SELECT q.user_id FROM quem q)
       AND e.month >= date_trunc('month', p_desde)::date
       AND e.month <= p_ate
     GROUP BY e.user_id, e.month, e.currency
  )
  SELECT COALESCE(r.user_id, i.user_id),
         COALESCE(r.month, i.month),
         COALESCE(r.currency, i.currency)::text,
         COALESCE(r.income, 0)::numeric(15,2),
         COALESCE(r.expense, 0)::numeric(15,2),
         COALESCE(r.net, 0)::numeric(15,2),
         COALESCE(r.transaction_count, 0)::bigint,
         COALESCE(i.expense, 0)::numeric(15,2)
    FROM resultado r
    FULL JOIN interno i
      ON i.user_id = r.user_id AND i.month = r.month AND i.currency = r.currency
   ORDER BY 2, 1, 3;
END;
$$;

REVOKE ALL ON FUNCTION public.resultado_da_casa(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resultado_da_casa(uuid, date, date) TO authenticated;

-- 5.3 Onde o dinheiro da casa esta, hoje.
--   tipo 'conjunta': uma linha por conta conjunta desta casa (de dono ainda
--                    membro), com nome e saldo -- a conta e da casa;
--   tipo 'pessoal':  uma linha por membro que compartilha e moeda, com o TOTAL
--                    das contas de dinheiro dele (ativas, que somam nos totais,
--                    fora cartao e fora as conjuntas desta casa, que ja vieram
--                    acima). O mesmo recorte do saldo do painel
--                    (lib/saldo-em-conta.ts: contas que somam, sem cartao).
DROP FUNCTION IF EXISTS public.saldos_da_casa(uuid);
CREATE FUNCTION public.saldos_da_casa(p_group_id uuid)
RETURNS TABLE (
  tipo text,
  account_id uuid,
  nome_da_conta text,
  account_type text,
  user_id uuid,
  currency text,
  saldo numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.exige_membro_da_casa(p_group_id);

  RETURN QUERY
  SELECT 'conjunta'::text,
         a.id,
         a.name::text,
         a.account_type::text,
         a.user_id,
         COALESCE(a.currency, 'BRL')::text,
         COALESCE(a.current_balance, 0)::numeric(15,2)
    FROM public.financial_accounts a
   WHERE a.casa_id = p_group_id
     AND a.is_active IS NOT FALSE
     AND public.conta_conjunta_alcanca(a.casa_id, a.user_id, auth.uid())

  UNION ALL

  SELECT 'pessoal'::text,
         NULL::uuid,
         NULL::text,
         NULL::text,
         a.user_id,
         COALESCE(a.currency, 'BRL')::text,
         SUM(COALESCE(a.current_balance, 0))::numeric(15,2)
    FROM public.financial_accounts a
    JOIN public.group_members m
      ON m.group_id = p_group_id
     AND m.user_id = a.user_id
     AND m.status = 'active'
     AND m.compartilha_com_a_casa
   WHERE a.is_active IS NOT FALSE
     AND a.include_in_total IS NOT FALSE
     AND a.account_type <> 'credit_card'
     AND a.casa_id IS DISTINCT FROM p_group_id
   GROUP BY a.user_id, COALESCE(a.currency, 'BRL')

   ORDER BY 1, 3, 5;
END;
$$;

REVOKE ALL ON FUNCTION public.saldos_da_casa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saldos_da_casa(uuid) TO authenticated;

-- 5.4 O extrato da conta conjunta: os lancamentos daquela conta, de quem quer
-- que tenha lancado, no periodo. So para o dono e para os membros da casa.
DROP FUNCTION IF EXISTS public.extrato_da_conta_conjunta(uuid, date, date);
CREATE FUNCTION public.extrato_da_conta_conjunta(p_account_id uuid, p_desde date, p_ate date)
RETURNS TABLE (
  id uuid,
  transaction_date date,
  description text,
  amount numeric,
  transaction_type text,
  user_id uuid,
  quem text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_conta record;
BEGIN
  SELECT a.user_id, a.casa_id INTO v_conta
    FROM public.financial_accounts a WHERE a.id = p_account_id;

  IF NOT FOUND
     OR v_conta.casa_id IS NULL
     OR NOT (
       v_conta.user_id = auth.uid()
       OR public.conta_conjunta_alcanca(v_conta.casa_id, v_conta.user_id, auth.uid())
     ) THEN
    RAISE EXCEPTION 'conta conjunta nao encontrada' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT t.id,
         t.transaction_date::date,
         t.description::text,
         t.amount::numeric(15,2),
         t.transaction_type::text,
         t.user_id,
         COALESCE(NULLIF(btrim(p.full_name), ''), 'Membro')::text
    FROM public.financial_transactions t
    LEFT JOIN public.profiles p ON p.id = t.user_id
   WHERE t.account_id = p_account_id
     AND t.transaction_date >= p_desde
     AND t.transaction_date <= p_ate
   ORDER BY t.transaction_date DESC, t.created_at DESC NULLS LAST, t.id;
END;
$$;

REVOKE ALL ON FUNCTION public.extrato_da_conta_conjunta(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.extrato_da_conta_conjunta(uuid, date, date) TO authenticated;

-- 5.5 Ligar e desligar o proprio mes. Por funcao, e nao UPDATE direto, para a
-- tela receber erro com motivo ("voce nao e membro desta casa") em vez de
-- "0 linhas atualizadas".
CREATE OR REPLACE FUNCTION public.compartilhar_com_a_casa(p_group_id uuid, p_compartilha boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.exige_membro_da_casa(p_group_id);

  UPDATE public.group_members
     SET compartilha_com_a_casa = COALESCE(p_compartilha, false)
   WHERE group_id = p_group_id
     AND user_id = auth.uid()
     AND status = 'active';

  RETURN COALESCE(p_compartilha, false);
END;
$$;

REVOKE ALL ON FUNCTION public.compartilhar_com_a_casa(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compartilhar_com_a_casa(uuid, boolean) TO authenticated;

-- ===========================================================================
-- SECAO 6: REGISTRO
-- ===========================================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('078', '078_visao_da_casa',
        'Visao da casa: compartilha_com_a_casa, conta conjunta (financial_accounts.casa_id), membro sem conta (display_name) e as leituras resultado_da_casa, saldos_da_casa, membros_da_casa, extrato_da_conta_conjunta', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
