-- ===========================================================================
-- 075 -- A CONTA FIXA E A PREVISTA DIVIDIDAS COM UMA CONEXAO (RN020.8 a RN020.11)
-- ===========================================================================
-- O pedido (Helio, 27/10/2026, testando entre a conta dele e a da Lais):
-- "Conexoes devem funcionar assim como grupos: quando lancar contas, ficar
-- registrado na conexao, aparecer pra quem vai receber como receita prevista e
-- pra quem paga como despesa, pra saber o quanto tem que pagar por mes."
--
-- O QUE FALTAVA
-- -------------
-- A 070 fez a divisao com pessoa funcionar no LANCAMENTO avulso: a despesa ja
-- paga gera "A receber de <pessoa>" para quem pagou e "Pagamento a <pessoa>"
-- para o outro. Mas o formulario oferece "Dividir esta despesa" tambem na
-- despesa FIXA (vira `recurring_rules`), na PREVISTA (vira
-- `scheduled_transactions`) e na compra PARCELADA -- e nos tres a divisao com
-- pessoa era descartada em silencio. O aluguel dividido com a Lais virava uma
-- conta so do Helio, e a Lais nao via nada. No grupo isso funciona porque a
-- conta do grupo tem `group_id`, e a 067 cuida do resto.
--
-- O QUE ESTA MIGRATION FAZ
-- ------------------------
--   SECAO 1  preflight
--   SECAO 2  `recurring_rule_splits` e `scheduled_splits`: a parte de cada
--            conexao na regra fixa e na conta prevista
--   SECAO 3  `scheduled_transactions.scheduled_split_id`, o elo da conta gerada
--            com a parte, e `contraparte_id`, a outra pessoa de toda conta
--            gerada por divisao com pessoa (070 e 075) -- e por ela que a tela
--            da conexao junta o que esta registrado entre os dois
--   SECAO 4  a trava da conta gerada (o molde da 070)
--   SECAO 5  `refazer_contas_da_prevista_dividida` e os triggers: a parte nasce,
--            muda ou sai; a conta prevista muda de valor, data ou status; a
--            ocorrencia da regra nasce; a parte da regra muda
--   SECAO 6  o `contraparte_id` das contas que a 070 ja gerou
--
-- COMO FICA, NO EXEMPLO
-- ---------------------
-- O Helio lanca "Aluguel" fixo de R$ 2.000, todo dia 10, dividido 40% com a
-- Lais. A cada mes da agenda:
--   * o Helio tem a conta "Aluguel" de R$ 2.000 (despesa prevista, inteira:
--     quem paga conta a despesa inteira, como na RN020.2);
--   * o Helio tem "A receber de Lais — Aluguel" de R$ 800 (receita prevista);
--   * a Lais tem "Pagamento a Helio — Aluguel" de R$ 800 (despesa prevista).
-- As tres vencem no dia 10. Quitadas, o Resultado do Helio e -R$ 1.200 e o da
-- Lais e -R$ 800. Cada lado quita a propria conta com a baixa de sempre
-- (RN020.6), e o Helio pagar o aluguel nao quita a parte da Lais.
--
-- A OCORRENCIA DA REGRA HERDA A PARTE
-- -----------------------------------
-- A agenda e materializada pelo app (`materializarAgenda`), com o upsert do
-- indice (recurring_rule_id, due_date). O trigger AFTER INSERT da SECAO 5 copia
-- as partes da regra para cada ocorrencia nova, e a ocorrencia gera as contas
-- dos dois lados. Mudar a parte da regra muda a das ocorrencias em aberto de
-- hoje em diante; a vencida em aberto e a paga ficam como estao, como o valor
-- da regra (HMO-228).
--
-- QUANDO A CONTA PREVISTA NAO VALE MAIS
-- -------------------------------------
-- Pular ou cancelar a conta (ou a regra ser encerrada) tira as duas contas
-- geradas. Pagar a conta mantem as duas: a divida da Lais continua ate ela
-- pagar a dela. Se uma conta gerada ja foi paga e a conta prevista mudou de
-- valor ou de data, ou foi pulada, o banco recusa -- o mesmo criterio da
-- RN020.3. Quem precisa mudar desfaz a baixa antes.
--
-- O PASSO HUMANO
-- --------------
-- Colar no SQL Editor do Supabase depois do merge, DEPOIS da 074.
-- Re-executavel. Nao cria conta nenhuma sozinha: as contas fixas que ja existem
-- nao tinham parte gravada (o formulario a descartava), entao quem quer dividir
-- um aluguel que ja esta na agenda edita a regra e escolhe a pessoa.
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
     WHERE table_schema = 'public' AND table_name = 'scheduled_transactions'
       AND column_name = 'expense_split_id'
  ) THEN
    v_faltando := v_faltando || E'\n  - coluna scheduled_transactions.expense_split_id (vem da 070)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.transaction_categories
     WHERE id IN ('546f8740-14f1-42bd-a202-870f0f444874',
                  '6c2e165e-a0ef-4a1a-90fb-c607b4e872e0')
    HAVING count(*) = 2
  ) THEN
    v_faltando := v_faltando || E'\n  - categorias Pagamento a pessoa / Recebimento de pessoa (vem da 070)';
  END IF;

  IF to_regclass('public.user_connections') IS NULL THEN
    v_faltando := v_faltando || E'\n  - tabela public.user_connections (vem da 010)';
  END IF;

  IF v_faltando <> '' THEN
    RAISE EXCEPTION E'075 nao pode ser aplicado neste banco. Faltando:%\n\nRode 001 -> ... -> 074 antes.', v_faltando;
  END IF;
END $$;

-- ===========================================================================
-- SECAO 2: A PARTE DA CONEXAO NA REGRA FIXA E NA CONTA PREVISTA
-- ===========================================================================
-- O molde e `expense_splits` (001): uma linha por pessoa, com o percentual. So
-- que sem `amount` nem `status`: o valor sai da conta prevista na hora (o
-- aluguel que sobe muda a parte sem ninguem regravar nada), e a parte nao tem
-- aprovacao -- a conexao aceita e o consentimento (RN010.1).
CREATE TABLE IF NOT EXISTS public.recurring_rule_splits (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  recurring_rule_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  percentage numeric(5,2) NOT NULL,
  created_at timestamp with time zone DEFAULT now(),

  CONSTRAINT recurring_rule_splits_pkey PRIMARY KEY (id),
  CONSTRAINT recurring_rule_splits_percentage_check
    CHECK (percentage > 0 AND percentage <= 100),
  CONSTRAINT recurring_rule_splits_rule_participant_key
    UNIQUE (recurring_rule_id, participant_id),
  CONSTRAINT recurring_rule_splits_rule_fkey
    FOREIGN KEY (recurring_rule_id) REFERENCES public.recurring_rules(id) ON DELETE CASCADE,
  CONSTRAINT recurring_rule_splits_participant_fkey
    FOREIGN KEY (participant_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.recurring_rule_splits IS
  'A parte de uma conexao numa despesa fixa (075, RN020.8). Cada ocorrencia nova da regra herda as partes em scheduled_splits; mudar a parte da regra muda a das ocorrencias em aberto de hoje em diante.';

CREATE TABLE IF NOT EXISTS public.scheduled_splits (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  scheduled_transaction_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  percentage numeric(5,2) NOT NULL,
  created_at timestamp with time zone DEFAULT now(),

  CONSTRAINT scheduled_splits_pkey PRIMARY KEY (id),
  CONSTRAINT scheduled_splits_percentage_check
    CHECK (percentage > 0 AND percentage <= 100),
  CONSTRAINT scheduled_splits_scheduled_participant_key
    UNIQUE (scheduled_transaction_id, participant_id),
  CONSTRAINT scheduled_splits_scheduled_fkey
    FOREIGN KEY (scheduled_transaction_id) REFERENCES public.scheduled_transactions(id) ON DELETE CASCADE,
  CONSTRAINT scheduled_splits_participant_fkey
    FOREIGN KEY (participant_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.scheduled_splits IS
  'A parte de uma conexao numa conta prevista (075, RN020.8). Gera, por refazer_contas_da_prevista_dividida, A receber de <pessoa> para o dono da conta e Pagamento a <pessoa> para a conexao, pela parte, no vencimento da conta.';

CREATE INDEX IF NOT EXISTS idx_recurring_rule_splits_participant
  ON public.recurring_rule_splits (participant_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_splits_participant
  ON public.scheduled_splits (participant_id);

-- RLS: o dono da regra/conta escreve, e so com uma conexao ACEITA que nao seja
-- ele mesmo (RN010.1). A conexao le a propria parte.
ALTER TABLE public.recurring_rule_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_splits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recurring_rule_splits_select ON public.recurring_rule_splits;
CREATE POLICY recurring_rule_splits_select ON public.recurring_rule_splits
  FOR SELECT TO authenticated
  USING (
    participant_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.recurring_rules r
                WHERE r.id = recurring_rule_id AND r.user_id = auth.uid())
  );

DROP POLICY IF EXISTS recurring_rule_splits_write ON public.recurring_rule_splits;
CREATE POLICY recurring_rule_splits_write ON public.recurring_rule_splits
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.recurring_rules r
             WHERE r.id = recurring_rule_id AND r.user_id = auth.uid())
  )
  WITH CHECK (
    participant_id <> auth.uid()
    AND EXISTS (SELECT 1 FROM public.recurring_rules r
                 WHERE r.id = recurring_rule_id AND r.user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_connections c
       WHERE c.status = 'accepted'
         AND ((c.requester_id = auth.uid() AND c.requested_id = participant_id)
           OR (c.requested_id = auth.uid() AND c.requester_id = participant_id))
    )
  );

DROP POLICY IF EXISTS scheduled_splits_select ON public.scheduled_splits;
CREATE POLICY scheduled_splits_select ON public.scheduled_splits
  FOR SELECT TO authenticated
  USING (
    participant_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.scheduled_transactions st
                WHERE st.id = scheduled_transaction_id AND st.user_id = auth.uid())
  );

DROP POLICY IF EXISTS scheduled_splits_write ON public.scheduled_splits;
CREATE POLICY scheduled_splits_write ON public.scheduled_splits
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.scheduled_transactions st
             WHERE st.id = scheduled_transaction_id AND st.user_id = auth.uid())
  )
  WITH CHECK (
    participant_id <> auth.uid()
    AND EXISTS (SELECT 1 FROM public.scheduled_transactions st
                 WHERE st.id = scheduled_transaction_id AND st.user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_connections c
       WHERE c.status = 'accepted'
         AND ((c.requester_id = auth.uid() AND c.requested_id = participant_id)
           OR (c.requested_id = auth.uid() AND c.requester_id = participant_id))
    )
  );

REVOKE ALL ON public.recurring_rule_splits FROM anon;
REVOKE ALL ON public.scheduled_splits FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_rule_splits TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_splits TO authenticated;

-- ===========================================================================
-- SECAO 3: O ELO DA CONTA GERADA, E A CONTRAPARTE
-- ===========================================================================
ALTER TABLE public.scheduled_transactions
  ADD COLUMN IF NOT EXISTS scheduled_split_id uuid,
  ADD COLUMN IF NOT EXISTS contraparte_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'scheduled_transactions_scheduled_split_id_fkey'
  ) THEN
    ALTER TABLE public.scheduled_transactions
      ADD CONSTRAINT scheduled_transactions_scheduled_split_id_fkey
      FOREIGN KEY (scheduled_split_id)
      REFERENCES public.scheduled_splits(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'scheduled_transactions_contraparte_id_fkey'
  ) THEN
    ALTER TABLE public.scheduled_transactions
      ADD CONSTRAINT scheduled_transactions_contraparte_id_fkey
      FOREIGN KEY (contraparte_id)
      REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.scheduled_transactions.scheduled_split_id IS
  'A parte da conta prevista que gerou esta conta (075, RN020.8): A receber de <pessoa> para o dono da conta prevista, Pagamento a <pessoa> para a conexao. Valor, tipo, dono, vencimento, descricao e categoria vem da conta prevista e ficam travados por scheduled_transactions_trava_da_prevista_dividida; a baixa e livre.';
COMMENT ON COLUMN public.scheduled_transactions.contraparte_id IS
  'A outra pessoa da conta gerada por divisao com pessoa (070 ou 075). Calculada pelo banco a partir do elo (scheduled_transactions_contraparte); nula em toda outra conta. E por ela que a tela da conexao junta o que esta registrado entre os dois.';

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_transactions_scheduled_split_user_key
  ON public.scheduled_transactions (scheduled_split_id, user_id)
  WHERE scheduled_split_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scheduled_contraparte
  ON public.scheduled_transactions (user_id, contraparte_id, due_date)
  WHERE contraparte_id IS NOT NULL;

-- A contraparte sai do elo, sempre. O que a sessao mandar na coluna e
-- sobrescrito: ela nao e um campo do app, e uma conta comum nunca tem
-- contraparte.
CREATE OR REPLACE FUNCTION public.scheduled_transactions_contraparte()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_outro uuid;
BEGIN
  IF NEW.expense_split_id IS NOT NULL THEN
    SELECT CASE WHEN t.user_id = NEW.user_id THEN es.participant_id ELSE t.user_id END
      INTO v_outro
      FROM public.expense_splits es
      JOIN public.financial_transactions t ON t.id = es.transaction_id
     WHERE es.id = NEW.expense_split_id;
  ELSIF NEW.scheduled_split_id IS NOT NULL THEN
    SELECT CASE WHEN p.user_id = NEW.user_id THEN ss.participant_id ELSE p.user_id END
      INTO v_outro
      FROM public.scheduled_splits ss
      JOIN public.scheduled_transactions p ON p.id = ss.scheduled_transaction_id
     WHERE ss.id = NEW.scheduled_split_id;
  END IF;

  NEW.contraparte_id := v_outro;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.scheduled_transactions_contraparte() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS scheduled_transactions_contraparte ON public.scheduled_transactions;
CREATE TRIGGER scheduled_transactions_contraparte
  BEFORE INSERT OR UPDATE ON public.scheduled_transactions
  FOR EACH ROW EXECUTE FUNCTION public.scheduled_transactions_contraparte();

-- ===========================================================================
-- SECAO 4: A TRAVA DA CONTA GERADA
-- ===========================================================================
-- O molde e o da 070, com o elo novo. Passam direto: `auth.uid() IS NULL` e a
-- escrita de `refazer_contas_da_prevista_dividida`, reconhecida por
-- `pulodogato.contas_da_prevista = 'on'`.
CREATE OR REPLACE FUNCTION public.scheduled_transactions_trava_da_prevista_dividida()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR current_setting('pulodogato.contas_da_prevista', true) = 'on'
  THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.scheduled_split_id IS NOT NULL THEN
      RAISE EXCEPTION 'Conta da divisao com pessoa sai junto com a conta dividida: edite a conta ou tire a pessoa dela (RN020.10)'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.scheduled_split_id IS NOT NULL THEN
      RAISE EXCEPTION 'Conta da divisao com pessoa so nasce da conta dividida'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.scheduled_split_id IS NULL THEN
    IF NEW.scheduled_split_id IS NOT NULL THEN
      RAISE EXCEPTION 'Conta da divisao com pessoa so nasce da conta dividida'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.scheduled_split_id     IS DISTINCT FROM OLD.scheduled_split_id
     OR NEW.amount              IS DISTINCT FROM OLD.amount
     OR NEW.transaction_type    IS DISTINCT FROM OLD.transaction_type
     OR NEW.user_id             IS DISTINCT FROM OLD.user_id
     OR NEW.due_date            IS DISTINCT FROM OLD.due_date
     OR NEW.currency            IS DISTINCT FROM OLD.currency
     OR NEW.group_id            IS DISTINCT FROM OLD.group_id
     OR NEW.recurring_rule_id   IS DISTINCT FROM OLD.recurring_rule_id
     OR NEW.description         IS DISTINCT FROM OLD.description
     OR NEW.category_id         IS DISTINCT FROM OLD.category_id
  THEN
    RAISE EXCEPTION 'Conta da divisao com pessoa muda pela conta dividida: edite o valor, a data ou a parte la (RN020.10)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.scheduled_transactions_trava_da_prevista_dividida() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS scheduled_transactions_trava_da_prevista_dividida ON public.scheduled_transactions;
CREATE TRIGGER scheduled_transactions_trava_da_prevista_dividida
  BEFORE INSERT OR UPDATE OR DELETE ON public.scheduled_transactions
  FOR EACH ROW EXECUTE FUNCTION public.scheduled_transactions_trava_da_prevista_dividida();

-- ===========================================================================
-- SECAO 5: AS DUAS CONTAS, REFEITAS A PARTIR DA CONTA PREVISTA
-- ===========================================================================
-- `refazer_contas_da_prevista_dividida(parte)` e a irma da
-- `refazer_contas_da_divisao` (070), com a conta prevista no lugar do
-- lancamento:
--
--   * a parte vale quando a conta prevista e despesa SEM grupo (com grupo vale
--     o grupo, RN020.4), nao e ela mesma uma conta gerada (de divisao, de
--     fechamento), a pessoa nao e o dono, e a conta esta em aberto ou paga
--     (pulada e cancelada nao vao acontecer);
--   * o valor e |amount| x percentual, ao centavo (a conta prevista e so em
--     BRL desde a 034);
--   * as duas vencem no vencimento da conta prevista.
CREATE OR REPLACE FUNCTION public.refazer_contas_da_prevista_dividida(p_split_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  ss public.scheduled_splits%ROWTYPE;
  p  public.scheduled_transactions%ROWTYPE;
  v_tipo public.transaction_financial_type;
  v_vale boolean := false;
  v_valor numeric(15,2);
  v_nome_dono text;
  v_nome_participante text;
  v_detalhe text;
  v_lado record;
  v_conta public.scheduled_transactions%ROWTYPE;
BEGIN
  SELECT * INTO ss FROM public.scheduled_splits WHERE id = p_split_id;
  IF FOUND THEN
    SELECT * INTO p FROM public.scheduled_transactions WHERE id = ss.scheduled_transaction_id;
    IF FOUND THEN
      -- Na ocorrencia de regra o tipo e NULL e quer dizer "pergunte a regra"
      -- (027). A mesma leitura de `scheduled_transactions_effective`.
      v_tipo := COALESCE(
        p.transaction_type,
        (SELECT r.transaction_type FROM public.recurring_rules r WHERE r.id = p.recurring_rule_id),
        'expense'
      );
      v_vale := p.group_id IS NULL
        AND v_tipo = 'expense'
        AND p.user_id <> ss.participant_id
        AND p.expense_split_id IS NULL
        AND p.scheduled_split_id IS NULL
        AND p.group_closing_id IS NULL
        AND p.status IN ('pending', 'overdue', 'paid');
    END IF;
  END IF;

  IF v_vale THEN
    v_valor := round(abs(p.amount) * ss.percentage / 100, 2);
    v_vale := v_valor > 0;
  END IF;

  -- A conta paga que a conta prevista ja nao sustenta.
  IF EXISTS (
    SELECT 1 FROM public.scheduled_transactions st
     WHERE st.scheduled_split_id = p_split_id
       AND st.status = 'paid'
       AND NOT (
         v_vale
         AND st.amount = v_valor
         AND st.due_date = p.due_date
         AND (
           (st.user_id = p.user_id AND st.transaction_type = 'income')
           OR (st.user_id = ss.participant_id AND st.transaction_type = 'expense')
         )
       )
  ) THEN
    RAISE EXCEPTION 'Esta conta dividida ja foi paga por um dos lados: desfaca a baixa na agenda antes de mudar o valor, a data, a pessoa, pular ou apagar a conta (RN020.10)'
      USING ERRCODE = 'PDG02';
  END IF;

  PERFORM set_config('pulodogato.contas_da_prevista', 'on', true);

  DELETE FROM public.scheduled_transactions st
   WHERE st.scheduled_split_id = p_split_id
     AND (
       NOT v_vale
       OR NOT (
         (st.user_id = p.user_id AND st.transaction_type = 'income')
         OR (st.user_id = ss.participant_id AND st.transaction_type = 'expense')
       )
     );

  IF NOT v_vale THEN
    PERFORM set_config('pulodogato.contas_da_prevista', '', true);
    RETURN;
  END IF;

  SELECT COALESCE(NULLIF(btrim(pr.full_name), ''), NULLIF(btrim(pr.nickname), ''))
    INTO v_nome_dono
    FROM public.profiles pr WHERE pr.id = p.user_id;
  SELECT COALESCE(NULLIF(btrim(pr.full_name), ''), NULLIF(btrim(pr.nickname), ''))
    INTO v_nome_participante
    FROM public.profiles pr WHERE pr.id = ss.participant_id;
  v_nome_dono := COALESCE(v_nome_dono, 'sua conexão');
  v_nome_participante := COALESCE(v_nome_participante, 'sua conexão');
  v_detalhe := CASE WHEN NULLIF(btrim(p.description), '') IS NULL THEN ''
                    ELSE ' — ' || btrim(p.description) END;

  FOR v_lado IN
    SELECT p.user_id AS user_id,
           'income'::public.transaction_financial_type AS tipo,
           '6c2e165e-a0ef-4a1a-90fb-c607b4e872e0'::uuid AS categoria,
           'A receber de ' || v_nome_participante || v_detalhe AS descricao,
           p.account_id AS conta_preferida
    UNION ALL
    SELECT ss.participant_id,
           'expense'::public.transaction_financial_type,
           '546f8740-14f1-42bd-a202-870f0f444874'::uuid,
           'Pagamento a ' || v_nome_dono || v_detalhe,
           NULL::uuid
  LOOP
    SELECT * INTO v_conta
      FROM public.scheduled_transactions st
     WHERE st.scheduled_split_id = p_split_id
       AND st.user_id = v_lado.user_id
     FOR UPDATE;

    IF FOUND THEN
      IF v_conta.status <> 'paid' THEN
        UPDATE public.scheduled_transactions
           SET amount = v_valor,
               due_date = p.due_date,
               description = v_lado.descricao,
               category_id = v_lado.categoria
         WHERE id = v_conta.id
           AND (amount, due_date, description, category_id)
               IS DISTINCT FROM (v_valor, p.due_date, v_lado.descricao, v_lado.categoria);
      END IF;
    ELSE
      INSERT INTO public.scheduled_transactions
        (user_id, category_id, account_id, description, amount, due_date, status,
         transaction_type, currency, scheduled_split_id)
      VALUES (
        v_lado.user_id,
        v_lado.categoria,
        -- A mesma escolha da 070 (RN020.6): a conta da conta prevista para o
        -- dono, quando ela nao e cartao, senao a primeira conta corrente ativa.
        -- Ninguem escolhe conta de outra pessoa.
        (SELECT a.id FROM public.financial_accounts a
          WHERE a.user_id = v_lado.user_id
            AND a.is_active IS NOT FALSE
            AND a.account_type IN ('checking', 'digital', 'savings', 'cash')
          ORDER BY (a.id = v_lado.conta_preferida) IS TRUE DESC,
                   CASE a.account_type WHEN 'checking' THEN 0 WHEN 'digital' THEN 1
                                       WHEN 'savings' THEN 2 ELSE 3 END,
                   (a.include_in_total IS FALSE),
                   a.created_at, a.id
          LIMIT 1),
        v_lado.descricao,
        v_valor,
        p.due_date,
        'pending',
        v_lado.tipo,
        'BRL',
        p_split_id
      );
    END IF;
  END LOOP;

  PERFORM set_config('pulodogato.contas_da_prevista', '', true);
END $$;

COMMENT ON FUNCTION public.refazer_contas_da_prevista_dividida(uuid) IS
  'Deixa as contas da conta prevista dividida com uma conexao iguais a ela (075, RN020.8): A receber de <pessoa> para o dono e Pagamento a <pessoa> para a conexao, pela parte, no vencimento. Conta de grupo, de receita, gerada, pulada ou cancelada nao tem conta. A conta em aberto e atualizada no lugar; a paga nao e refeita, e a funcao recusa a mudanca que a contradiria. Chamada so pelos triggers.';

REVOKE ALL ON FUNCTION public.refazer_contas_da_prevista_dividida(uuid) FROM PUBLIC, anon, authenticated;

-- A parte nasce ou muda: as contas acompanham.
CREATE OR REPLACE FUNCTION public.scheduled_splits_refaz_contas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.refazer_contas_da_prevista_dividida(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS scheduled_splits_refaz_contas ON public.scheduled_splits;
CREATE TRIGGER scheduled_splits_refaz_contas
  AFTER INSERT OR UPDATE ON public.scheduled_splits
  FOR EACH ROW EXECUTE FUNCTION public.scheduled_splits_refaz_contas();

-- A parte sai (ou a conta prevista e apagada, pelo CASCADE): as contas saem
-- com ela, menos quando uma ja foi paga. BEFORE, pelo mesmo motivo da 070.
CREATE OR REPLACE FUNCTION public.scheduled_splits_apaga_contas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.scheduled_transactions st
     WHERE st.scheduled_split_id = OLD.id AND st.status = 'paid'
  ) THEN
    RAISE EXCEPTION 'Esta conta dividida ja foi paga por um dos lados: desfaca a baixa na agenda antes de apagar a conta ou tirar a pessoa dela (RN020.10)'
      USING ERRCODE = 'PDG02';
  END IF;

  PERFORM set_config('pulodogato.contas_da_prevista', 'on', true);
  DELETE FROM public.scheduled_transactions WHERE scheduled_split_id = OLD.id;
  PERFORM set_config('pulodogato.contas_da_prevista', '', true);
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS scheduled_splits_apaga_contas ON public.scheduled_splits;
CREATE TRIGGER scheduled_splits_apaga_contas
  BEFORE DELETE ON public.scheduled_splits
  FOR EACH ROW EXECUTE FUNCTION public.scheduled_splits_apaga_contas();

-- A conta prevista muda: valor, vencimento, descricao, status, tipo ou grupo
-- refazem as contas de cada parte dela. As contas geradas tambem passam por
-- aqui quando mudam, mas nao tem parte nenhuma: o laco nao acha nada.
CREATE OR REPLACE FUNCTION public.scheduled_transactions_refaz_contas_da_prevista()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_split uuid;
BEGIN
  FOR v_split IN
    SELECT ss.id FROM public.scheduled_splits ss WHERE ss.scheduled_transaction_id = NEW.id
  LOOP
    PERFORM public.refazer_contas_da_prevista_dividida(v_split);
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS scheduled_transactions_refaz_contas_da_prevista ON public.scheduled_transactions;
CREATE TRIGGER scheduled_transactions_refaz_contas_da_prevista
  AFTER UPDATE ON public.scheduled_transactions
  FOR EACH ROW
  WHEN (
    NEW.amount IS DISTINCT FROM OLD.amount
    OR NEW.due_date IS DISTINCT FROM OLD.due_date
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.transaction_type IS DISTINCT FROM OLD.transaction_type
    OR NEW.group_id IS DISTINCT FROM OLD.group_id
  )
  EXECUTE FUNCTION public.scheduled_transactions_refaz_contas_da_prevista();

-- A ocorrencia nova da regra herda as partes da regra.
CREATE OR REPLACE FUNCTION public.scheduled_transactions_herda_parte_da_regra()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.scheduled_splits (scheduled_transaction_id, participant_id, percentage)
  SELECT NEW.id, rs.participant_id, rs.percentage
    FROM public.recurring_rule_splits rs
   WHERE rs.recurring_rule_id = NEW.recurring_rule_id
  ON CONFLICT (scheduled_transaction_id, participant_id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS scheduled_transactions_herda_parte_da_regra ON public.scheduled_transactions;
CREATE TRIGGER scheduled_transactions_herda_parte_da_regra
  AFTER INSERT ON public.scheduled_transactions
  FOR EACH ROW
  WHEN (NEW.recurring_rule_id IS NOT NULL)
  EXECUTE FUNCTION public.scheduled_transactions_herda_parte_da_regra();

-- A parte da regra muda: as ocorrencias em aberto de hoje em diante acompanham.
-- A vencida em aberto e a paga ficam como estao, como o valor da regra
-- (HMO-228): elas ja sao o que aconteceu.
CREATE OR REPLACE FUNCTION public.recurring_rule_splits_propaga()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_regra uuid := COALESCE(NEW.recurring_rule_id, OLD.recurring_rule_id);
BEGIN
  DELETE FROM public.scheduled_splits ss
   USING public.scheduled_transactions st
   WHERE st.id = ss.scheduled_transaction_id
     AND st.recurring_rule_id = v_regra
     AND st.status = 'pending'
     AND st.due_date >= CURRENT_DATE
     AND NOT EXISTS (
       SELECT 1 FROM public.recurring_rule_splits rs
        WHERE rs.recurring_rule_id = v_regra
          AND rs.participant_id = ss.participant_id
     );

  INSERT INTO public.scheduled_splits (scheduled_transaction_id, participant_id, percentage)
  SELECT st.id, rs.participant_id, rs.percentage
    FROM public.scheduled_transactions st
    JOIN public.recurring_rule_splits rs ON rs.recurring_rule_id = st.recurring_rule_id
   WHERE st.recurring_rule_id = v_regra
     AND st.status = 'pending'
     AND st.due_date >= CURRENT_DATE
  ON CONFLICT (scheduled_transaction_id, participant_id)
  DO UPDATE SET percentage = EXCLUDED.percentage
   WHERE public.scheduled_splits.percentage IS DISTINCT FROM EXCLUDED.percentage;

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS recurring_rule_splits_propaga ON public.recurring_rule_splits;
CREATE TRIGGER recurring_rule_splits_propaga
  AFTER INSERT OR UPDATE OR DELETE ON public.recurring_rule_splits
  FOR EACH ROW EXECUTE FUNCTION public.recurring_rule_splits_propaga();

REVOKE ALL ON FUNCTION public.scheduled_splits_refaz_contas() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scheduled_splits_apaga_contas() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scheduled_transactions_refaz_contas_da_prevista() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scheduled_transactions_herda_parte_da_regra() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recurring_rule_splits_propaga() FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- SECAO 6: A CONTRAPARTE DAS CONTAS QUE A 070 JA GEROU
-- ===========================================================================
-- O trigger da SECAO 3 calcula a coluna; tocar a linha basta. Sem sessao
-- (`auth.uid()` nulo) as travas deixam passar. Na segunda colagem nada muda.
UPDATE public.scheduled_transactions
   SET contraparte_id = NULL
 WHERE expense_split_id IS NOT NULL
   AND contraparte_id IS NULL;

COMMIT;
