-- ===========================================================================
-- 068 -- O ACERTO QUE DA BAIXA (RN019, fase 3 do modelo novo)
-- ===========================================================================
-- Metade de BANCO da fase 3 de "o modelo das movimentacoes" (PRD 2.1, RN019).
-- A 067 gerou, no fechamento do grupo, "Pagamento ao grupo" para quem deve e
-- "A receber do grupo" para quem tem a receber. Esta migration faz o acerto (o
-- Pix entre dois membros, `group_settlements`) QUITAR essas contas, nos dois
-- lados, no mesmo INSERT que registra o acerto.
--
-- O QUE ESTA MIGRATION FAZ
-- ------------------------
--   SECAO 1  preflight
--   SECAO 2  `group_settlement_allocations`: quanto de cada acerto quitou
--            quanto de cada conta
--   SECAO 3  a conta gerada pode estar paga sem lancamento proprio
--   SECAO 4  a trava da conta gerada fica mais estreita: ela so se quita pelo
--            acerto, e nao se apaga
--   SECAO 5  a baixa: `alocar_acerto_nas_contas` e os triggers do acerto, e a
--            compensacao de quem deve e tem a receber do mesmo grupo
--   SECAO 6  o acerto que ja entrou num fechamento nao se edita nem se desfaz
--   SECAO 7  o fechamento leva do acerto so o que sobrou da baixa
--   SECAO 8  `contas_em_aberto_do_grupo`: o que cada membro ainda deve ou tem a
--            receber, para a tela sugerir os pares (RN019.5)
--   SECAO 9  RLS e grants
--
-- A BAIXA E SIMETRICA, E E ISSO QUE MANTEM AS CONTAS SOMANDO ZERO
-- --------------------------------------------------------------
-- Um acerto de Lais para Helio quita a conta a pagar da Lais E a conta a
-- receber do Helio, pelo MESMO valor:
--
--     baixa = menor de (valor do acerto,
--                       o que a Lais ainda deve ao grupo,
--                       o que o Helio ainda tem a receber do grupo)
--
-- As contas de um fechamento somam zero (a 067 confere). Dar baixa do mesmo
-- valor dos dois lados mantem a soma do que esta EM ABERTO em zero. Uma baixa
-- diferente em cada lado -- quitar os R$ 150 inteiros da conta de R$ 500 do
-- Helio quando a Lais so devia R$ 100 -- deixaria o grupo devendo R$ 50 a
-- alguem que ninguem mais cobra.
--
-- O que passa da baixa (a Lais mandou R$ 150 e devia R$ 100) continua sendo um
-- acerto como os de antes da 068: entra no PROXIMO fechamento como acerto, e
-- o saldo da Lais naquele periodo sobe R$ 50. A SECAO 7 garante que o
-- fechamento leva so essa sobra, nunca o valor cheio.
--
-- POR QUE A CONTA FICA PAGA SEM `transaction_id` (SECAO 3)
-- -------------------------------------------------------
-- `scheduled_transactions_paid_check` (005) exige um lancamento em toda conta
-- paga. A conta gerada nao tem UM lancamento: ela e quitada por um ou mais
-- acertos (RN019.4, acerto parcial), e o registro da quitacao e a linha em
-- `group_settlement_allocations`. E mais: o acerto e registrado por UM lado,
-- e a perna do OUTRO lado so existe quando ele a lanca na conta dele, na
-- sessao dele -- a objecao 1 da 007 continua de pe, ninguem lanca na conta de
-- outra pessoa. A baixa nao pode esperar essa perna (RN019.3).
--
-- Entao o CHECK aceita `paid` sem lancamento SO na conta gerada pelo
-- fechamento. Efeito colateral medido no teste: apagar um fechamento cuja
-- conta ja foi quitada e recusado (o ON DELETE SET NULL da 067 deixaria uma
-- conta paga sem lancamento e sem fechamento). E o comportamento certo: esse
-- fechamento ja virou dinheiro.
--
-- O ACERTO CONTINUA SENDO TRANSFERENCIA
-- -----------------------------------
-- Nada aqui mexe nas pernas de `financial_transactions`. O acerto continua
-- gravando a perna de quem registra como `transfer` (a rota de settlements),
-- e a contraparte continua lancando a dela pela rota da perna. RN019.2: o
-- acerto nao e receita nem despesa nova. Quem entra em Despesas e Receitas na
-- fase 4 sao as contas geradas, quitadas ou nao.
--
-- O PASSO HUMANO
-- --------------
-- Colar no SQL Editor do Supabase depois do merge, DEPOIS da 067. E aditiva
-- para todo grupo sem fechamento -- que e todo grupo de producao ate a fase 4
-- ligar o cron: sem conta gerada, a baixa e zero e o acerto se comporta
-- exatamente como antes. Re-executavel.
-- ===========================================================================

BEGIN;

-- ===========================================================================
-- SECAO 1: PREFLIGHT
-- ===========================================================================
DO $$
DECLARE
  v_faltando text := '';
BEGIN
  IF to_regclass('public.group_closings') IS NULL THEN
    v_faltando := v_faltando || E'\n  - tabela public.group_closings (vem da 067)';
  END IF;

  IF to_regclass('public.group_closing_items') IS NULL THEN
    v_faltando := v_faltando || E'\n  - tabela public.group_closing_items (vem da 067)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'scheduled_transactions'
       AND column_name  = 'group_closing_id'
  ) THEN
    v_faltando := v_faltando || E'\n  - coluna scheduled_transactions.group_closing_id (vem da 067)';
  END IF;

  IF to_regprocedure('public.scheduled_transactions_trava_do_fechamento()') IS NULL THEN
    v_faltando := v_faltando || E'\n  - funcao public.scheduled_transactions_trava_do_fechamento() (vem da 067)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_transactions_paid_check'
  ) THEN
    v_faltando := v_faltando || E'\n  - constraint scheduled_transactions_paid_check (vem do 005)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'group_settlements'
       AND column_name  = 'exchange_rate'
  ) THEN
    v_faltando := v_faltando || E'\n  - coluna group_settlements.exchange_rate (vem da 026)';
  END IF;

  IF v_faltando <> '' THEN
    RAISE EXCEPTION E'068 nao pode ser aplicado neste banco. Faltando:%\n\nRode 001 -> ... -> 067 antes.', v_faltando;
  END IF;
END $$;

-- ===========================================================================
-- SECAO 2: QUANTO DE CADA ACERTO QUITOU QUANTO DE CADA CONTA
-- ===========================================================================
-- Uma linha por (acerto, conta). O que falta pagar numa conta gerada e
-- `amount - soma das linhas dela`; o que sobrou de um acerto para o proximo
-- fechamento e `valor em reais - soma das linhas dele do lado de quem pagou`.
--
-- `user_id` e o dono da conta, e `group_id` repete o do acerto: e por ele que a
-- RLS deixa o membro ler (o membro nao le a conta prevista do outro, mas le
-- quanto do acerto ja quitou -- e o que a tela do grupo precisa).
--
-- Sem policy de escrita: quem grava e `alocar_acerto_nas_contas`, chamada pelo
-- trigger do acerto. Apagar o acerto apaga as linhas dele (CASCADE), e o
-- trigger da SECAO 5 reabre as contas que elas tinham quitado.
CREATE TABLE IF NOT EXISTS public.group_settlement_allocations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL DEFAULT 'acerto',
  settlement_id uuid
    REFERENCES public.group_settlements(id) ON DELETE CASCADE,
  scheduled_id  uuid NOT NULL
    REFERENCES public.scheduled_transactions(id) ON DELETE CASCADE,
  group_id      uuid NOT NULL
    REFERENCES public.expense_groups(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  amount        numeric(15,2) NOT NULL CHECK (amount > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_settlement_allocations_kind_check
    CHECK (kind IN ('acerto', 'compensacao')),
  -- O acerto tem acerto; a compensacao (SECAO 5) nao tem.
  CONSTRAINT group_settlement_allocations_origem_check
    CHECK ((kind = 'acerto') = (settlement_id IS NOT NULL)),
  CONSTRAINT group_settlement_allocations_settlement_scheduled_key
    UNIQUE (settlement_id, scheduled_id)
);

CREATE INDEX IF NOT EXISTS group_settlement_allocations_scheduled_idx
  ON public.group_settlement_allocations (scheduled_id);
CREATE INDEX IF NOT EXISTS group_settlement_allocations_group_idx
  ON public.group_settlement_allocations (group_id);

COMMENT ON TABLE public.group_settlement_allocations IS
  'Quanto de cada conta gerada pelo fechamento do grupo ja foi quitado, e por que (068, RN019): por um acerto (kind acerto, settlement_id) ou pela compensacao entre a conta a pagar e a conta a receber do mesmo membro (kind compensacao). Escrita so pelas funcoes da 068. Membro do grupo le.';

-- ===========================================================================
-- SECAO 3: A CONTA GERADA PODE ESTAR PAGA SEM LANCAMENTO PROPRIO
-- ===========================================================================
-- Ver o cabecalho. Refeito inteiro porque CHECK nao se edita. A metade de
-- "nao paga" fica igual: conta aberta nunca tem lancamento nem data de baixa.
ALTER TABLE public.scheduled_transactions
  DROP CONSTRAINT IF EXISTS scheduled_transactions_paid_check;
ALTER TABLE public.scheduled_transactions
  ADD CONSTRAINT scheduled_transactions_paid_check CHECK (
    (status = 'paid'
       AND paid_date IS NOT NULL
       AND (transaction_id IS NOT NULL OR group_closing_id IS NOT NULL))
    OR (status <> 'paid' AND paid_date IS NULL AND transaction_id IS NULL)
  );

-- ===========================================================================
-- SECAO 4: A TRAVA DA CONTA GERADA, MAIS ESTREITA
-- ===========================================================================
-- A 067 deixava o dono dar baixa na conta gerada como em qualquer conta
-- prevista: status, paid_date, transaction_id e account_id livres. Com a fase
-- 3 isso vira um furo. A Lais que marcasse "Pagamento ao grupo" como paga pelo
-- botao comum quitaria a conta DELA e deixaria a do Helio esperando um
-- dinheiro que ja saiu -- o lado de la nunca saberia. Agora a conta gerada so
-- muda de status pela baixa do acerto, e nao se apaga.
--
-- A baixa do acerto e reconhecida por `pulodogato.baixa_do_acerto = 'on'`,
-- ligado por `alocar_acerto_nas_contas` e pelo reabrir da SECAO 5 so durante
-- as escritas delas (set_config local da transacao, desligado ao final). O app
-- nao alcanca esse parametro: o PostgREST nao expoe `set_config`, e nenhuma
-- funcao do schema public o liga com valor vindo de fora.
--
-- O resto da 067 fica igual: `auth.uid() IS NULL` passa (cron, colagem), a
-- conta com elo so nasce no fechamento, valor/tipo/dono/vencimento nao mudam,
-- e o elo cai para NULL so quando o fechamento deixou de existir.
CREATE OR REPLACE FUNCTION public.scheduled_transactions_trava_do_fechamento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR current_setting('pulodogato.baixa_do_acerto', true) = 'on'
  THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.group_closing_id IS NOT NULL THEN
      RAISE EXCEPTION 'Conta gerada pelo fechamento do grupo nao se apaga: ela se quita pelo acerto no grupo (RN019)'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.group_closing_id IS NOT NULL THEN
      RAISE EXCEPTION 'Conta de fechamento de grupo so nasce no fechamento'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.group_closing_id IS NULL THEN
    IF NEW.group_closing_id IS NOT NULL THEN
      RAISE EXCEPTION 'Conta de fechamento de grupo so nasce no fechamento'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.group_closing_id IS DISTINCT FROM OLD.group_closing_id
     AND NOT (
       NEW.group_closing_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.group_closings c
                        WHERE c.id = OLD.group_closing_id)
     )
  THEN
    RAISE EXCEPTION 'O elo da conta com o fechamento do grupo nao se edita'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.amount                 IS DISTINCT FROM OLD.amount
     OR NEW.transaction_type    IS DISTINCT FROM OLD.transaction_type
     OR NEW.user_id             IS DISTINCT FROM OLD.user_id
     OR NEW.due_date            IS DISTINCT FROM OLD.due_date
     OR NEW.currency            IS DISTINCT FROM OLD.currency
     OR NEW.group_id            IS DISTINCT FROM OLD.group_id
     OR NEW.recurring_rule_id   IS DISTINCT FROM OLD.recurring_rule_id
  THEN
    RAISE EXCEPTION 'Conta gerada pelo fechamento do grupo nao muda de valor, tipo, dono nem vencimento (RN018.12)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A conta de pagamento pode cair para NULL: e o ON DELETE da FK de
  -- `account_id`, se um dia ela tiver um. Escolher uma conta nao: a conta
  -- gerada nao e paga por conta escolhida, e pelo acerto.
  IF NEW.status                 IS DISTINCT FROM OLD.status
     OR NEW.paid_date           IS DISTINCT FROM OLD.paid_date
     OR NEW.transaction_id      IS DISTINCT FROM OLD.transaction_id
     OR (NEW.account_id IS DISTINCT FROM OLD.account_id AND NEW.account_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'Conta gerada pelo fechamento do grupo se quita pelo acerto no grupo, nao pela baixa da conta (RN019)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.scheduled_transactions_trava_do_fechamento() IS
  'Prende a conta gerada pelo fechamento do grupo (067, RN018.12; 068, RN019). Sessao do app nao cria conta com group_closing_id, nao a apaga, e nao muda valor, tipo, dono, vencimento, moeda, grupo, elo, status nem baixa dela: a conta gerada se quita pelo acerto no grupo. Passam direto: auth.uid() IS NULL (cron, colagem) e a baixa do acerto (pulodogato.baixa_do_acerto = on). O elo cai para NULL so quando o fechamento deixou de existir.';

DROP TRIGGER IF EXISTS scheduled_transactions_trava_do_fechamento ON public.scheduled_transactions;
CREATE TRIGGER scheduled_transactions_trava_do_fechamento
  BEFORE INSERT OR UPDATE OR DELETE ON public.scheduled_transactions
  FOR EACH ROW EXECUTE FUNCTION public.scheduled_transactions_trava_do_fechamento();

-- ===========================================================================
-- SECAO 5: A BAIXA
-- ===========================================================================
-- `alocar_acerto_nas_contas(acerto)` reparte o acerto pelas contas geradas em
-- aberto deste grupo, das mais antigas para as mais novas, pelo mesmo valor
-- dos dois lados (ver o cabecalho). A conta que chega a zero vira `paid`, com
-- a data do acerto.
--
-- Roda no trigger do acerto, na transacao do INSERT: registrar o acerto e dar
-- baixa nas duas contas e UMA operacao do banco (RN019.3). Se a baixa falhar,
-- o acerto tambem nao fica.
--
-- `FOR UPDATE` nas contas: dois acertos ao mesmo tempo contra a mesma conta
-- esperam um pelo outro, e o segundo ve o que o primeiro ja quitou. Sem isso
-- os dois leriam R$ 100 em aberto e quitariam R$ 200.
--
-- Acerto que ja entrou num fechamento (como acerto antigo, RN018.11) nao
-- quita conta nenhuma: ele ja abateu o saldo daquele fechamento, e quitar uma
-- conta com ele contaria o mesmo dinheiro duas vezes.
CREATE OR REPLACE FUNCTION public.alocar_acerto_nas_contas(p_settlement_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.group_settlements%ROWTYPE;
  v_valor numeric(15,2);
  v_aberto_de_quem_paga numeric(15,2);
  v_aberto_de_quem_recebe numeric(15,2);
  v_baixa numeric(15,2);
  v_resto numeric(15,2);
  v_parte numeric(15,2);
  v_lado record;
  r record;
BEGIN
  SELECT * INTO s FROM public.group_settlements WHERE id = p_settlement_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  IF EXISTS (SELECT 1 FROM public.group_closing_items i WHERE i.settlement_id = s.id)
     OR EXISTS (SELECT 1 FROM public.group_settlement_allocations a WHERE a.settlement_id = s.id)
  THEN
    RETURN 0;
  END IF;

  -- Em reais, pela mesma conta do fechamento (`valorDoFechamento`).
  v_valor := round(abs(s.amount) * COALESCE(s.exchange_rate, 1), 2);

  PERFORM 1
     FROM public.scheduled_transactions st
     JOIN public.group_closings c ON c.id = st.group_closing_id
    WHERE c.group_id = s.group_id
      AND st.user_id IN (s.from_user_id, s.to_user_id)
      AND st.status IN ('pending', 'overdue')
    FOR UPDATE OF st;

  SELECT
    COALESCE(SUM(x.aberto) FILTER (WHERE x.user_id = s.from_user_id AND x.transaction_type = 'expense'), 0),
    COALESCE(SUM(x.aberto) FILTER (WHERE x.user_id = s.to_user_id   AND x.transaction_type = 'income'), 0)
    INTO v_aberto_de_quem_paga, v_aberto_de_quem_recebe
    FROM (
      SELECT st.user_id, st.transaction_type,
             st.amount - COALESCE((SELECT SUM(a.amount)
                                     FROM public.group_settlement_allocations a
                                    WHERE a.scheduled_id = st.id), 0) AS aberto
        FROM public.scheduled_transactions st
        JOIN public.group_closings c ON c.id = st.group_closing_id
       WHERE c.group_id = s.group_id
         AND st.status IN ('pending', 'overdue')
    ) x;

  v_baixa := LEAST(v_valor, v_aberto_de_quem_paga, v_aberto_de_quem_recebe);
  IF v_baixa <= 0 THEN
    RETURN 0;
  END IF;

  PERFORM set_config('pulodogato.baixa_do_acerto', 'on', true);

  FOR v_lado IN
    SELECT s.from_user_id AS user_id, 'expense'::public.transaction_financial_type AS tipo
    UNION ALL
    SELECT s.to_user_id, 'income'::public.transaction_financial_type
  LOOP
    v_resto := v_baixa;
    FOR r IN
      SELECT st.id,
             st.amount - COALESCE((SELECT SUM(a.amount)
                                     FROM public.group_settlement_allocations a
                                    WHERE a.scheduled_id = st.id), 0) AS aberto
        FROM public.scheduled_transactions st
        JOIN public.group_closings c ON c.id = st.group_closing_id
       WHERE c.group_id = s.group_id
         AND st.user_id = v_lado.user_id
         AND st.transaction_type = v_lado.tipo
         AND st.status IN ('pending', 'overdue')
       ORDER BY st.due_date, st.created_at, st.id
    LOOP
      EXIT WHEN v_resto <= 0;
      CONTINUE WHEN r.aberto <= 0;

      v_parte := LEAST(r.aberto, v_resto);

      INSERT INTO public.group_settlement_allocations
        (settlement_id, scheduled_id, group_id, user_id, amount)
      VALUES (s.id, r.id, s.group_id, v_lado.user_id, v_parte);

      IF v_parte = r.aberto THEN
        UPDATE public.scheduled_transactions
           SET status = 'paid', paid_date = s.settled_on
         WHERE id = r.id;
      END IF;

      v_resto := v_resto - v_parte;
    END LOOP;
  END LOOP;

  PERFORM set_config('pulodogato.baixa_do_acerto', '', true);
  RETURN v_baixa;
END $$;

COMMENT ON FUNCTION public.alocar_acerto_nas_contas(uuid) IS
  'Da baixa do acerto nas contas geradas pelo fechamento do grupo (068, RN019): o mesmo valor nos dois lados -- o menor entre o acerto em reais, o que quem pagou deve e o que quem recebeu tem a receber --, das contas mais antigas para as mais novas. Conta que zera vira paid na data do acerto. Acerto que ja entrou num fechamento, ou que ja foi alocado, nao aloca. Devolve o valor da baixa.';

REVOKE ALL ON FUNCTION public.alocar_acerto_nas_contas(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.alocar_acerto_nas_contas(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.alocar_acerto_nas_contas(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.alocar_acerto_nas_contas(uuid) TO service_role;

-- O trigger do acerto. INSERT aloca; UPDATE que mexe no valor, na cotacao, nas
-- pessoas, no grupo ou na data desfaz a baixa e aloca de novo. A RLS da 007
-- deixa quem registrou editar o acerto pela API, e um acerto de R$ 100 editado
-- para R$ 10 nao pode continuar quitando R$ 100.
CREATE OR REPLACE FUNCTION public.group_settlements_da_baixa()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.amount            IS NOT DISTINCT FROM OLD.amount
       AND NEW.exchange_rate IS NOT DISTINCT FROM OLD.exchange_rate
       AND NEW.from_user_id  IS NOT DISTINCT FROM OLD.from_user_id
       AND NEW.to_user_id    IS NOT DISTINCT FROM OLD.to_user_id
       AND NEW.group_id      IS NOT DISTINCT FROM OLD.group_id
       AND NEW.settled_on    IS NOT DISTINCT FROM OLD.settled_on
    THEN
      RETURN NEW;
    END IF;
    DELETE FROM public.group_settlement_allocations WHERE settlement_id = NEW.id;
  END IF;

  PERFORM public.alocar_acerto_nas_contas(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS group_settlements_da_baixa ON public.group_settlements;
CREATE TRIGGER group_settlements_da_baixa
  AFTER INSERT OR UPDATE ON public.group_settlements
  FOR EACH ROW EXECUTE FUNCTION public.group_settlements_da_baixa();

-- A COMPENSACAO: QUEM DEVE AO GRUPO E TEM A RECEBER DO MESMO GRUPO
-- ----------------------------------------------------------------
-- O Helio ficou com "A receber" de R$ 500 em dezembro, ninguem pagou, e em
-- janeiro o fechamento gera para ele "Pagamento ao grupo" de R$ 300. As duas
-- contas em aberto ao mesmo tempo nao fecham nunca: nenhum acerto quita uma
-- conta do Helio contra outra do Helio (`group_settlements_parties_differ`), e
-- a tela sugeriria ele pagar a si mesmo. O grupo deve R$ 500 a ele e ele deve
-- R$ 300 ao grupo: o certo e compensar, e ficar so R$ 200 a receber.
--
-- `compensar_contas_do_membro` faz isso, pelo mesmo desenho da baixa: o menor
-- dos dois lados em aberto, das contas mais antigas para as mais novas, uma
-- linha `compensacao` em cada conta. Nenhum dinheiro se move -- e nenhum
-- lancamento nasce. Cada conta continua no mes dela (a fase 4 le dezembro com
-- R$ 500 de receita e janeiro com R$ 300 de despesa); so o que falta pagar
-- muda.
--
-- Roda quando nasce uma conta gerada (o trigger abaixo, dentro do fechamento) e
-- quando uma conta reabre (acerto desfeito), que sao os dois momentos em que um
-- membro pode passar a ter os dois lados em aberto.
CREATE OR REPLACE FUNCTION public.compensar_contas_do_membro(
  p_group_id uuid,
  p_user_id uuid,
  p_data date
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_a_pagar numeric(15,2);
  v_a_receber numeric(15,2);
  v_compensa numeric(15,2);
  v_resto numeric(15,2);
  v_parte numeric(15,2);
  v_tipo public.transaction_financial_type;
  r record;
BEGIN
  PERFORM 1
     FROM public.scheduled_transactions st
     JOIN public.group_closings c ON c.id = st.group_closing_id
    WHERE c.group_id = p_group_id
      AND st.user_id = p_user_id
      AND st.status IN ('pending', 'overdue')
    FOR UPDATE OF st;

  SELECT
    COALESCE(SUM(x.aberto) FILTER (WHERE x.transaction_type = 'expense'), 0),
    COALESCE(SUM(x.aberto) FILTER (WHERE x.transaction_type = 'income'), 0)
    INTO v_a_pagar, v_a_receber
    FROM (
      SELECT st.transaction_type,
             st.amount - COALESCE((SELECT SUM(a.amount)
                                     FROM public.group_settlement_allocations a
                                    WHERE a.scheduled_id = st.id), 0) AS aberto
        FROM public.scheduled_transactions st
        JOIN public.group_closings c ON c.id = st.group_closing_id
       WHERE c.group_id = p_group_id
         AND st.user_id = p_user_id
         AND st.status IN ('pending', 'overdue')
    ) x;

  v_compensa := LEAST(v_a_pagar, v_a_receber);
  IF v_compensa <= 0 THEN
    RETURN 0;
  END IF;

  PERFORM set_config('pulodogato.baixa_do_acerto', 'on', true);

  FOREACH v_tipo IN ARRAY ARRAY['expense', 'income']::public.transaction_financial_type[]
  LOOP
    v_resto := v_compensa;
    FOR r IN
      SELECT st.id,
             st.amount - COALESCE((SELECT SUM(a.amount)
                                     FROM public.group_settlement_allocations a
                                    WHERE a.scheduled_id = st.id), 0) AS aberto
        FROM public.scheduled_transactions st
        JOIN public.group_closings c ON c.id = st.group_closing_id
       WHERE c.group_id = p_group_id
         AND st.user_id = p_user_id
         AND st.transaction_type = v_tipo
         AND st.status IN ('pending', 'overdue')
       ORDER BY st.due_date, st.created_at, st.id
    LOOP
      EXIT WHEN v_resto <= 0;
      CONTINUE WHEN r.aberto <= 0;

      v_parte := LEAST(r.aberto, v_resto);

      INSERT INTO public.group_settlement_allocations
        (kind, settlement_id, scheduled_id, group_id, user_id, amount)
      VALUES ('compensacao', NULL, r.id, p_group_id, p_user_id, v_parte);

      IF v_parte = r.aberto THEN
        UPDATE public.scheduled_transactions
           SET status = 'paid', paid_date = p_data
         WHERE id = r.id;
      END IF;

      v_resto := v_resto - v_parte;
    END LOOP;
  END LOOP;

  PERFORM set_config('pulodogato.baixa_do_acerto', '', true);
  RETURN v_compensa;
END $$;

COMMENT ON FUNCTION public.compensar_contas_do_membro(uuid, uuid, date) IS
  'Compensa a conta a pagar e a conta a receber do mesmo membro no mesmo grupo (068): o menor dos dois lados em aberto, das contas mais antigas para as mais novas, sem acerto e sem lancamento. A conta que zera vira paid na data dada. Devolve o valor compensado.';

REVOKE ALL ON FUNCTION public.compensar_contas_do_membro(uuid, uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compensar_contas_do_membro(uuid, uuid, date) FROM anon;
REVOKE ALL ON FUNCTION public.compensar_contas_do_membro(uuid, uuid, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.compensar_contas_do_membro(uuid, uuid, date) TO service_role;

-- A conta que nasce no fechamento compensa com o que o mesmo membro ja tinha
-- do outro lado. AFTER, e por linha: o INSERT do fechamento grava as contas de
-- todos de uma vez, e cada uma compensa as do proprio dono.
CREATE OR REPLACE FUNCTION public.scheduled_transactions_compensa_do_fechamento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_group_id uuid;
BEGIN
  SELECT c.group_id INTO v_group_id
    FROM public.group_closings c WHERE c.id = NEW.group_closing_id;
  IF v_group_id IS NOT NULL THEN
    PERFORM public.compensar_contas_do_membro(v_group_id, NEW.user_id, NEW.due_date);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS scheduled_transactions_compensa_do_fechamento ON public.scheduled_transactions;
CREATE TRIGGER scheduled_transactions_compensa_do_fechamento
  AFTER INSERT ON public.scheduled_transactions
  FOR EACH ROW
  WHEN (NEW.group_closing_id IS NOT NULL)
  EXECUTE FUNCTION public.scheduled_transactions_compensa_do_fechamento();

-- Reabrir: a linha de baixa que some (acerto desfeito, ou editado e realocado)
-- devolve a conta a `pending` se ela tinha sido quitada, e a conta reaberta
-- compensa com o outro lado do mesmo membro, se houver. A conta que ja nao
-- existe (apagada junto) simplesmente nao casa com o UPDATE.
CREATE OR REPLACE FUNCTION public.group_settlement_allocations_reabre()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reabertas integer;
BEGIN
  PERFORM set_config('pulodogato.baixa_do_acerto', 'on', true);
  UPDATE public.scheduled_transactions
     SET status = 'pending', paid_date = NULL
   WHERE id = OLD.scheduled_id
     AND status = 'paid'
     AND group_closing_id IS NOT NULL;
  GET DIAGNOSTICS v_reabertas = ROW_COUNT;
  PERFORM set_config('pulodogato.baixa_do_acerto', '', true);

  IF v_reabertas > 0 AND OLD.kind = 'acerto' THEN
    PERFORM public.compensar_contas_do_membro(OLD.group_id, OLD.user_id, CURRENT_DATE);
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS group_settlement_allocations_reabre ON public.group_settlement_allocations;
CREATE TRIGGER group_settlement_allocations_reabre
  AFTER DELETE ON public.group_settlement_allocations
  FOR EACH ROW EXECUTE FUNCTION public.group_settlement_allocations_reabre();

-- ===========================================================================
-- SECAO 6: O ACERTO QUE JA ENTROU NUM FECHAMENTO NAO SE EDITA NEM SE DESFAZ
-- ===========================================================================
-- Um acerto antigo que entrou num fechamento (RN018.11) ja abateu as contas
-- que aquele fechamento gerou. Desfaze-lo depois deixaria as contas menores do
-- que a divida, e nada as corrigiria. Quem registrou ainda pode desfazer o
-- acerto que so deu baixa (as contas reabrem) ou que nao entrou em fechamento
-- nenhum -- que e todo acerto de producao ate a fase 4.
CREATE OR REPLACE FUNCTION public.group_settlements_trava_do_fechamento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF EXISTS (SELECT 1 FROM public.group_closing_items i WHERE i.settlement_id = OLD.id) THEN
    RAISE EXCEPTION 'Este acerto ja entrou no fechamento do grupo e nao se edita nem se desfaz (RN018.12)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS group_settlements_trava_do_fechamento ON public.group_settlements;
CREATE TRIGGER group_settlements_trava_do_fechamento
  BEFORE UPDATE OR DELETE ON public.group_settlements
  FOR EACH ROW EXECUTE FUNCTION public.group_settlements_trava_do_fechamento();

-- ===========================================================================
-- SECAO 7: O FECHAMENTO LEVA DO ACERTO SO O QUE SOBROU DA BAIXA
-- ===========================================================================
-- `registrar_fechamento_do_grupo` (067) confere que o acerto e do grupo e das
-- pessoas certas, mas nao o valor. Com a baixa, o valor certo de um acerto no
-- fechamento e o que sobrou dela, e levar o valor cheio contaria duas vezes o
-- que ja quitou conta. Um trigger nos itens confere isso sem reescrever a
-- funcao da 067: o item errado aborta o fechamento inteiro, como as outras
-- conferencias.
--
-- So no INSERT: o item nao se edita (nao ha policy de escrita), e o UPDATE que
-- existe e o ON DELETE SET NULL de `settlement_id`, quando o grupo inteiro e
-- apagado -- conferir ali barraria a exclusao do grupo.
CREATE OR REPLACE FUNCTION public.group_closing_items_confere_acerto()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sobra numeric(15,2);
BEGIN
  IF NEW.kind <> 'acerto' THEN
    RETURN NEW;
  END IF;

  SELECT round(abs(s.amount) * COALESCE(s.exchange_rate, 1), 2)
         - COALESCE((SELECT SUM(a.amount)
                       FROM public.group_settlement_allocations a
                      WHERE a.settlement_id = s.id
                        AND a.user_id = s.from_user_id), 0)
    INTO v_sobra
    FROM public.group_settlements s
   WHERE s.id = NEW.settlement_id;

  IF v_sobra IS NULL OR NEW.amount IS DISTINCT FROM v_sobra THEN
    RAISE EXCEPTION 'Fechamento: o acerto % entra pelo que sobrou da baixa (%), nao por %',
      NEW.settlement_id, v_sobra, NEW.amount;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS group_closing_items_confere_acerto ON public.group_closing_items;
CREATE TRIGGER group_closing_items_confere_acerto
  BEFORE INSERT ON public.group_closing_items
  FOR EACH ROW EXECUTE FUNCTION public.group_closing_items_confere_acerto();

-- ===========================================================================
-- SECAO 8: O QUE CADA MEMBRO AINDA DEVE OU TEM A RECEBER
-- ===========================================================================
-- A conta gerada e do membro, e a RLS do 005 so deixa o dono le-la. A tela do
-- grupo precisa do que esta em aberto de TODOS para sugerir quem paga quem
-- (RN019.5) -- o mesmo numero que a foto do fechamento ja mostra a todos os
-- membros, menos o que foi quitado. Esta funcao devolve isso, e so para quem
-- e membro: para os outros, nenhuma linha.
CREATE OR REPLACE FUNCTION public.contas_em_aberto_do_grupo(p_group_id uuid)
RETURNS TABLE (
  closing_id  uuid,
  period_end  date,
  user_id     uuid,
  tipo        text,
  valor       numeric,
  quitado     numeric,
  aberto      numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.period_end, st.user_id, st.transaction_type::text,
         st.amount,
         COALESCE(q.quitado, 0),
         st.amount - COALESCE(q.quitado, 0)
    FROM public.group_closings c
    JOIN public.scheduled_transactions st ON st.group_closing_id = c.id
    LEFT JOIN LATERAL (
      SELECT SUM(a.amount) AS quitado
        FROM public.group_settlement_allocations a
       WHERE a.scheduled_id = st.id
    ) q ON TRUE
   WHERE c.group_id = p_group_id
     AND public.is_group_member(p_group_id)
     AND st.status IN ('pending', 'overdue')
     AND st.amount - COALESCE(q.quitado, 0) > 0
   ORDER BY c.period_end, st.user_id;
$$;

COMMENT ON FUNCTION public.contas_em_aberto_do_grupo(uuid) IS
  'As contas geradas pelo fechamento do grupo que ainda tem valor em aberto (068, RN019.5): de quem, de que tipo, quanto foi quitado por acerto e quanto falta. So para membro do grupo; para os outros, nenhuma linha.';

REVOKE ALL ON FUNCTION public.contas_em_aberto_do_grupo(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contas_em_aberto_do_grupo(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.contas_em_aberto_do_grupo(uuid) TO authenticated, service_role;

-- ===========================================================================
-- SECAO 9: RLS E GRANTS
-- ===========================================================================
ALTER TABLE public.group_settlement_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS group_settlement_allocations_select ON public.group_settlement_allocations;
CREATE POLICY group_settlement_allocations_select ON public.group_settlement_allocations
  FOR SELECT TO authenticated
  USING (public.is_group_member(group_id));

REVOKE ALL ON public.group_settlement_allocations FROM anon;
REVOKE ALL ON public.group_settlement_allocations FROM authenticated;
GRANT SELECT ON public.group_settlement_allocations TO authenticated;
GRANT ALL ON public.group_settlement_allocations TO service_role;

COMMIT;
