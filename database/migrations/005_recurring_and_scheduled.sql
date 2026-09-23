-- =====================================================
-- PULODOGATO - GASTOS FIXOS E CONTAS PREVISTAS
-- =====================================================
-- Migration: 005_recurring_and_scheduled
-- Gerado em: 2026-09-22  (HMO-137, Fase 1 da evolucao do produto)
--
-- O QUE ESTE ARQUIVO ADICIONA
-- ---------------------------
--   public.recurring_rules        regra de repeticao (gasto/receita fixo)
--   public.scheduled_transactions ocorrencia prevista, com vencimento e status
--
-- A separacao entre "regra" e "ocorrencia" e o que os apps grandes (Mobills,
-- Organizze, YNAB) fazem: a regra guarda "aluguel, todo dia 10, R$ 2.500" e a
-- ocorrencia guarda "aluguel de outubro/2026, vence 10/10, ainda nao pago".
-- Editar a regra nao reescreve o passado; cada ocorrencia tem vida propria,
-- pode ter valor diferente (conta de luz), ser adiada ou cancelada sozinha.
--
-- POR QUE A GERACAO NAO E UMA FUNCAO SQL
-- --------------------------------------
-- A materializacao das ocorrencias vive em lib/recurrence.ts, no app. As
-- migrations 003 e 004 existiram justamente para consertar triggers que
-- gravavam em tabela derivada sem SECURITY DEFINER; repetir esse padrao aqui
-- para calcular datas nao paga o risco. O unico trigger criado abaixo e o
-- update_updated_at_column, que so escreve em NEW.
--
-- RELACAO COM transaction_installments
-- ------------------------------------
-- Parcelamento (12x no cartao) continua em transaction_installments: e uma
-- divida fechada, com total conhecido. `scheduled_transactions` e a conta que
-- se repete sem fim definido (aluguel, escola, streaming) ou o lancamento
-- avulso que ainda vai vencer. As duas convivem.
--
-- COMO RODAR
-- ----------
--   psql "$URL" -v ON_ERROR_STOP=1 -f database/migrations/005_recurring_and_scheduled.sql
--
-- Aplicar em producao depois de 001 -> 002 -> 003 -> 004. O bloco de preflight
-- abaixo aborta a transacao inteira se faltar qualquer pre-requisito, listando
-- tudo de uma vez - o Postgres reporta um erro por vez e cada ida e volta com
-- producao custa um dia.
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
      ('profiles', 'id'),
      ('financial_accounts', 'id'),
      ('transaction_categories', 'id'),
      ('financial_transactions', 'id'),
      ('expense_groups', 'id'),
      ('group_members', 'group_id'),
      ('schema_migrations', 'version')
    ) AS r(tabela, coluna)

    UNION ALL
    -- o ENUM que as duas tabelas reusam
    SELECT '  - tipo public.transaction_financial_type nao existe'
    WHERE to_regtype('public.transaction_financial_type') IS NULL

    UNION ALL
    -- funcoes de que as policies e o trigger dependem
    SELECT format('  - funcao public.%s nao existe', f.nome)
    FROM (VALUES
      ('update_updated_at_column()'),
      ('is_group_member(uuid)')
    ) AS f(nome)
    WHERE to_regprocedure('public.' || f.nome) IS NULL

    UNION ALL
    -- roles do Supabase
    SELECT format('  - role %s nao existe', r.rolname)
    FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
    WHERE NOT EXISTS (SELECT 1 FROM pg_roles p WHERE p.rolname = r.rolname)
  ) AS checks
  WHERE msg IS NOT NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'005 nao pode ser aplicado neste banco. Faltando:\n%\n\nRode 001 -> 002 -> 003 -> 004 antes.', v_faltando;
  END IF;
END $$;

-- =====================================================
-- SECAO 1: ENUMS
-- =====================================================
-- CREATE TYPE nao aceita IF NOT EXISTS; o DO torna o arquivo re-executavel.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recurrence_frequency'
                   AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.recurrence_frequency AS ENUM (
      'weekly',      -- semanal
      'biweekly',    -- quinzenal
      'monthly',     -- mensal
      'bimonthly',   -- bimestral
      'quarterly',   -- trimestral
      'semiannual',  -- semestral
      'annual'       -- anual
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'scheduled_status'
                   AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.scheduled_status AS ENUM (
      'pending',    -- prevista, ainda nao venceu
      'paid',       -- paga/recebida, virou financial_transaction
      'overdue',    -- venceu e nao foi paga (derivado; ver SECAO 5)
      'skipped',    -- pulada neste mes, sem cancelar a regra
      'cancelled'   -- cancelada de vez
    );
  END IF;
END $$;

-- =====================================================
-- SECAO 2: recurring_rules  (gastos e receitas fixos)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.recurring_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    category_id uuid NOT NULL,
    account_id uuid,
    group_id uuid,
    description text NOT NULL,
    amount numeric(15,2) NOT NULL,
    transaction_type public.transaction_financial_type NOT NULL DEFAULT 'expense',
    frequency public.recurrence_frequency NOT NULL DEFAULT 'monthly',
    -- de quantos em quantos periodos: frequency='monthly' + interval_count=3
    -- equivale a trimestral, e existe para o caso que o ENUM nao cobre.
    interval_count integer NOT NULL DEFAULT 1,
    -- dia do vencimento. Em mes curto, o app fixa no ultimo dia do mes
    -- (dia 31 em fevereiro vira 28/29) - ver lib/recurrence.ts.
    due_day integer,
    start_date date NOT NULL DEFAULT CURRENT_DATE,
    end_date date,
    -- quantas ocorrencias no total; NULL = sem fim definido
    max_occurrences integer,
    -- quantos dias antes avisar (usado pela tela de proximos vencimentos)
    reminder_days integer NOT NULL DEFAULT 3,
    -- se true, a ocorrencia vencida vira transacao sozinha quando o usuario
    -- confirmar em lote; nunca lanca dinheiro sem acao humana.
    auto_post boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT recurring_rules_pkey PRIMARY KEY (id),
    CONSTRAINT recurring_rules_amount_check CHECK (amount > (0)::numeric),
    CONSTRAINT recurring_rules_interval_check CHECK (interval_count > 0 AND interval_count <= 60),
    CONSTRAINT recurring_rules_due_day_check CHECK (due_day IS NULL OR (due_day >= 1 AND due_day <= 31)),
    CONSTRAINT recurring_rules_reminder_check CHECK (reminder_days >= 0 AND reminder_days <= 90),
    CONSTRAINT recurring_rules_end_check CHECK (end_date IS NULL OR end_date >= start_date),
    CONSTRAINT recurring_rules_max_occurrences_check CHECK (max_occurrences IS NULL OR max_occurrences > 0),
    CONSTRAINT recurring_rules_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT recurring_rules_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.transaction_categories(id),
    CONSTRAINT recurring_rules_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.financial_accounts(id),
    CONSTRAINT recurring_rules_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.expense_groups(id)
);

COMMENT ON TABLE public.recurring_rules IS
  'Gastos e receitas fixos: a regra de repeticao. As ocorrencias ficam em scheduled_transactions.';

CREATE INDEX IF NOT EXISTS idx_recurring_rules_user ON public.recurring_rules (user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_recurring_rules_group ON public.recurring_rules (group_id) WHERE group_id IS NOT NULL;

-- =====================================================
-- SECAO 3: scheduled_transactions  (contas previstas)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.scheduled_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    recurring_rule_id uuid,
    category_id uuid NOT NULL,
    account_id uuid,
    group_id uuid,
    description text NOT NULL,
    amount numeric(15,2) NOT NULL,
    due_date date NOT NULL,
    status public.scheduled_status NOT NULL DEFAULT 'pending',
    paid_date date,
    -- transacao real criada quando a conta foi paga; e o elo que impede
    -- contar a mesma despesa duas vezes (uma prevista + uma realizada).
    transaction_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT scheduled_transactions_pkey PRIMARY KEY (id),
    CONSTRAINT scheduled_transactions_amount_check CHECK (amount > (0)::numeric),
    -- status 'paid' exige data e transacao; o resto nao pode ter nenhuma das duas
    CONSTRAINT scheduled_transactions_paid_check CHECK (
      (status = 'paid' AND paid_date IS NOT NULL AND transaction_id IS NOT NULL)
      OR (status <> 'paid' AND paid_date IS NULL AND transaction_id IS NULL)
    ),
    CONSTRAINT scheduled_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT scheduled_transactions_rule_id_fkey FOREIGN KEY (recurring_rule_id) REFERENCES public.recurring_rules(id) ON DELETE CASCADE,
    CONSTRAINT scheduled_transactions_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.transaction_categories(id),
    CONSTRAINT scheduled_transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.financial_accounts(id),
    CONSTRAINT scheduled_transactions_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.expense_groups(id),
    CONSTRAINT scheduled_transactions_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.financial_transactions(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.scheduled_transactions IS
  'Contas previstas (a pagar e a receber). Uma linha por vencimento.';

-- A geracao roda varias vezes sobre o mesmo periodo (toda vez que a tela abre).
-- Este indice e o que torna isso idempotente: a mesma regra nao materializa o
-- mesmo vencimento duas vezes.
--
-- Nao e indice parcial (WHERE recurring_rule_id IS NOT NULL) por dois motivos.
-- Primeiro, nao precisa: no Postgres dois NULL nunca colidem num indice unico,
-- entao lancamento avulso continua podendo repetir no mesmo dia - duas contas
-- de luz com o mesmo vencimento sao legitimas. Segundo, um indice parcial
-- quebraria o upsert: o ON CONFLICT (recurring_rule_id, due_date) que o
-- PostgREST monta nao consegue inferir um indice com predicado e estoura 42P10
-- "no unique or exclusion constraint matching the ON CONFLICT specification".
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_rule_due_unique
  ON public.scheduled_transactions (recurring_rule_id, due_date);

CREATE INDEX IF NOT EXISTS idx_scheduled_user_due ON public.scheduled_transactions (user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_scheduled_status ON public.scheduled_transactions (user_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_scheduled_group ON public.scheduled_transactions (group_id, due_date) WHERE group_id IS NOT NULL;

-- =====================================================
-- SECAO 4: updated_at
-- =====================================================
DROP TRIGGER IF EXISTS update_recurring_rules_updated_at ON public.recurring_rules;
CREATE TRIGGER update_recurring_rules_updated_at
  BEFORE UPDATE ON public.recurring_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_scheduled_transactions_updated_at ON public.scheduled_transactions;
CREATE TRIGGER update_scheduled_transactions_updated_at
  BEFORE UPDATE ON public.scheduled_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- SECAO 5: visao de vencidas
-- =====================================================
-- 'overdue' nao e gravado: seria um status que envelhece sozinho e exigiria um
-- job diario so para virar a chave a meia-noite. A conta esta vencida quando
-- due_date < hoje e status = 'pending' - isso e uma pergunta, nao um estado.
-- A view existe para que a resposta seja a mesma no app, no SQL e no relatorio.
CREATE OR REPLACE VIEW public.scheduled_transactions_effective AS
  SELECT
    s.*,
    CASE
      WHEN s.status = 'pending' AND s.due_date < CURRENT_DATE THEN 'overdue'::public.scheduled_status
      ELSE s.status
    END AS effective_status,
    (s.due_date - CURRENT_DATE) AS days_until_due
  FROM public.scheduled_transactions s;

COMMENT ON VIEW public.scheduled_transactions_effective IS
  'scheduled_transactions com o status vencido calculado na hora (nunca gravado).';

-- =====================================================
-- SECAO 6: RLS
-- =====================================================
-- Mesmo desenho do 002: nega por padrao, libera o dono e - para linhas de
-- grupo - os membros do grupo. Sem policy para anon: a chave anon vai no
-- bundle publico.
-- Sem FORCE ROW LEVEL SECURITY, igual as 18 tabelas do 002: o app nunca conecta
-- como dono da tabela, e ligar FORCE so nestas duas criaria uma diferenca em
-- relforcerowsecurity que a Q1 do 000_preflight_inventory.sql leria como deriva.
ALTER TABLE public.recurring_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_transactions ENABLE ROW LEVEL SECURITY;

-- ---------- recurring_rules ----------
DROP POLICY IF EXISTS recurring_rules_select ON public.recurring_rules;
CREATE POLICY recurring_rules_select ON public.recurring_rules
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (group_id IS NOT NULL AND public.is_group_member(group_id))
  );

DROP POLICY IF EXISTS recurring_rules_insert ON public.recurring_rules;
CREATE POLICY recurring_rules_insert ON public.recurring_rules
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS recurring_rules_update ON public.recurring_rules;
CREATE POLICY recurring_rules_update ON public.recurring_rules
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS recurring_rules_delete ON public.recurring_rules;
CREATE POLICY recurring_rules_delete ON public.recurring_rules
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ---------- scheduled_transactions ----------
DROP POLICY IF EXISTS scheduled_transactions_select ON public.scheduled_transactions;
CREATE POLICY scheduled_transactions_select ON public.scheduled_transactions
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (group_id IS NOT NULL AND public.is_group_member(group_id))
  );

DROP POLICY IF EXISTS scheduled_transactions_insert ON public.scheduled_transactions;
CREATE POLICY scheduled_transactions_insert ON public.scheduled_transactions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS scheduled_transactions_update ON public.scheduled_transactions;
CREATE POLICY scheduled_transactions_update ON public.scheduled_transactions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS scheduled_transactions_delete ON public.scheduled_transactions;
CREATE POLICY scheduled_transactions_delete ON public.scheduled_transactions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- =====================================================
-- SECAO 7: GRANTS
-- =====================================================
-- O 002 rodou GRANT ... ON ALL TABLES antes destas tabelas existirem, e
-- ALL TABLES nao alcanca o futuro. Sem estas linhas, as tabelas novas ficam
-- invisiveis para o app mesmo com as policies certas.
REVOKE ALL ON public.recurring_rules FROM anon;
REVOKE ALL ON public.scheduled_transactions FROM anon;
REVOKE ALL ON public.scheduled_transactions_effective FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_transactions TO authenticated;
GRANT SELECT ON public.scheduled_transactions_effective TO authenticated;

-- A view roda com os privilegios do dono (security definer por padrao no
-- Postgres < 15 e ainda o default em 15+). O RLS da tabela base so vale para a
-- view se ela for security_invoker - sem isto, a view devolve a agenda de
-- todo mundo para qualquer usuario logado.
ALTER VIEW public.scheduled_transactions_effective SET (security_invoker = true);

-- =====================================================
-- SECAO 8: registro
-- =====================================================
-- A coluna e `executed_at`, nao `applied_at`; e o ON CONFLICT depende da
-- constraint schema_migrations_version_key, conferida na SECAO 0.
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('005', '005_recurring_and_scheduled',
        'Gastos fixos (recurring_rules) e contas previstas (scheduled_transactions) - HMO-137', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
