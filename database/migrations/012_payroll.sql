-- =====================================================
-- PULODOGATO - CONTRACHEQUE: SALARIO BRUTO E DESCONTOS
-- =====================================================
-- Migration: 012_payroll
-- Gerado em: 2026-09-22  (HMO-145)
--
-- O QUE ESTE ARQUIVO ADICIONA
-- ---------------------------
--   public.payroll_entries       o contracheque do mes: bruto e de quem
--   public.payroll_deductions    INSS, IRRF e os demais descontos em folha
--   public.payroll_entry_totals  view: bruto, total descontado e LIQUIDO
--   public.register_payroll()    grava o contracheque inteiro numa transacao
--
-- Como o 010 e o 011, este arquivo so ACRESCENTA: nenhuma funcao, tabela,
-- policy ou trigger que ja esta em producao e alterada.
--
-- POR QUE O LANCAMENTO E O LIQUIDO, E NAO O BRUTO
-- ------------------------------------------------
-- O caminho obvio seria gravar o bruto como receita e cada desconto como
-- despesa. Ele esta errado de um jeito que nao falha em lugar nenhum: o
-- dinheiro do INSS e do IRRF NUNCA passou pela conta do usuario. Gravando
-- assim, o fluxo de caixa do 008 mostraria uma receita que ele nao recebeu e
-- uma despesa que ele nao pagou, as duas infladas pelo mesmo valor. O saldo
-- final fecharia certo -- o que torna o erro invisivel --, mas "quanto eu
-- ganho" e "quanto eu gasto" ficariam ambos maiores que a verdade, e sao esses
-- dois numeros que a tela de relatorios existe para responder.
--
-- Entao: UMA transacao de receita, com o valor LIQUIDO, que e o que de fato
-- caiu na conta. O bruto e os descontos vivem aqui, e sao a memoria de como se
-- chegou naquele liquido.
--
-- POR QUE ISTO NAO E UMA CATEGORIA DE TRANSACAO
-- ----------------------------------------------
-- Descontos em folha nao sao lancamentos: eles nao tem data propria, nao
-- afetam saldo de conta nenhuma e nao existem fora do contracheque que os
-- gerou. Modelados como transacao, precisariam de conta (nao tem) e entrariam
-- em todo relatorio de gasto (nao sao gasto do usuario).
--
-- O FGTS NAO ESTA NA LISTA DE PROPOSITO
-- --------------------------------------
-- FGTS nao e desconto: o empregador deposita por fora e o bruto nao diminui
-- por causa dele. Inclui-lo entre os `kind` faria o liquido calculado ficar
-- ~8% abaixo do que a pessoa recebeu, todo mes, e o erro seria copiado do
-- proprio contracheque impresso, onde o FGTS aparece na mesma coluna.
--
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0: pre-requisitos
-- =====================================================
-- Sem isto as tabelas nascem e so o USO descobre que financial_transactions
-- nao tem a forma que register_payroll() espera.
DO $$
DECLARE
  faltando text;
BEGIN
  SELECT string_agg(msg, E'\n') INTO faltando
  FROM (
    SELECT CASE
             WHEN to_regclass('public.financial_transactions') IS NULL
               THEN '  - tabela public.financial_transactions nao existe'
             WHEN NOT EXISTS (
                    SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.financial_transactions')
                      AND a.attname = r.coluna
                      AND a.attnum > 0 AND NOT a.attisdropped)
               THEN format('  - coluna public.financial_transactions.%s nao existe', r.coluna)
           END AS msg
    FROM (VALUES
      ('id'), ('user_id'), ('service_id'), ('category_id'), ('account_id'),
      ('description'), ('amount'), ('transaction_date'), ('transaction_type')
    ) AS r(coluna)
  ) t
  WHERE msg IS NOT NULL;

  IF to_regclass('public.financial_accounts') IS NULL THEN
    faltando := concat_ws(E'\n', faltando, '  - tabela public.financial_accounts nao existe');
  END IF;

  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION E'012 nao pode ser aplicado neste banco:\n%', faltando;
  END IF;
END $$;

-- =====================================================
-- SECAO 1: o contracheque
-- =====================================================
CREATE TABLE IF NOT EXISTS public.payroll_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,

    -- Sempre o dia 1: o contracheque e do MES, nao de uma data. O CHECK abaixo
    -- e o que impede duas linhas do mesmo mes (dia 1 e dia 5) escaparem do
    -- UNIQUE da SECAO 3 e a renda do mes aparecer dobrada.
    reference_month date NOT NULL,

    -- Quem paga. NOT NULL com default porque ele entra no UNIQUE, e em coluna
    -- anulavel o UNIQUE deixa de valer justamente para quem nao preencheu.
    employer text NOT NULL DEFAULT 'Principal',

    -- POSITIVO. Salario e receita; a convencao de sinal negativo deste banco e
    -- so para despesa em financial_transactions.
    gross_amount numeric(15,2) NOT NULL,

    -- Onde o liquido cai, e o lancamento que ele gerou. O lancamento pode ser
    -- apagado pela tela de transacoes sem levar o contracheque junto: por isso
    -- SET NULL, e por isso a tela sabe mostrar "sem lancamento".
    account_id uuid,
    transaction_id uuid,

    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),

    CONSTRAINT payroll_entries_pkey PRIMARY KEY (id),

    CONSTRAINT payroll_entries_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,

    CONSTRAINT payroll_entries_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.financial_accounts(id) ON DELETE SET NULL,

    CONSTRAINT payroll_entries_transaction_id_fkey
      FOREIGN KEY (transaction_id) REFERENCES public.financial_transactions(id) ON DELETE SET NULL,

    CONSTRAINT payroll_entries_gross_positive_check
      CHECK (gross_amount > 0),

    -- Ver o comentario de reference_month.
    CONSTRAINT payroll_entries_reference_month_is_first_check
      CHECK (date_trunc('month', reference_month)::date = reference_month),

    CONSTRAINT payroll_entries_employer_not_blank_check
      CHECK (btrim(employer) <> '')
);

COMMENT ON TABLE public.payroll_entries IS
  'Contracheque do mes: o salario BRUTO e de quem. O liquido nao e coluna -- sai da view payroll_entry_totals, para nao existir em dois lugares.';
COMMENT ON COLUMN public.payroll_entries.gross_amount IS
  'Positivo. O sinal negativo deste banco e convencao de despesa em financial_transactions, e salario nao e despesa.';
COMMENT ON COLUMN public.payroll_entries.transaction_id IS
  'O lancamento de receita com o valor LIQUIDO. NULL significa que o contracheque existe mas nao virou dinheiro em conta nenhuma.';

-- =====================================================
-- SECAO 2: os descontos
-- =====================================================
CREATE TABLE IF NOT EXISTS public.payroll_deductions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payroll_entry_id uuid NOT NULL,

    -- Lista fechada. INSS e IRRF sao nomeados porque sao os dois que todo
    -- contracheque brasileiro tem e os dois que o usuario pediu por nome; o
    -- resto cai em OTHER com descricao livre.
    --
    -- FGTS nao esta aqui de proposito -- ver o cabecalho.
    kind text NOT NULL,

    description text,

    -- POSITIVO. O desconto e uma subtracao feita pela view; gravar o valor ja
    -- negativo faria a subtracao virar soma e o liquido ficar MAIOR que o
    -- bruto, sem nada falhar.
    amount numeric(15,2) NOT NULL,

    created_at timestamp with time zone DEFAULT now(),

    CONSTRAINT payroll_deductions_pkey PRIMARY KEY (id),

    CONSTRAINT payroll_deductions_entry_fkey
      FOREIGN KEY (payroll_entry_id) REFERENCES public.payroll_entries(id) ON DELETE CASCADE,

    CONSTRAINT payroll_deductions_kind_check
      CHECK (kind IN ('INSS', 'IRRF', 'PENSION', 'HEALTH', 'UNION', 'ADVANCE', 'OTHER')),

    CONSTRAINT payroll_deductions_amount_positive_check
      CHECK (amount > 0)
);

COMMENT ON TABLE public.payroll_deductions IS
  'Descontos em folha de um contracheque. Nao sao transacoes: nao tem data propria, nao mexem em saldo e nao existem fora do contracheque.';
COMMENT ON COLUMN public.payroll_deductions.amount IS
  'Positivo. A view subtrai; valor negativo aqui faria o liquido passar do bruto.';

CREATE INDEX IF NOT EXISTS idx_payroll_deductions_entry
  ON public.payroll_deductions (payroll_entry_id);

-- =====================================================
-- SECAO 3: um contracheque por empregador por mes
-- =====================================================
-- Lancar o mesmo contracheque duas vezes dobraria a renda do mes. Quem tem
-- dois empregos continua podendo lancar dois, porque o empregador entra na
-- chave.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payroll_entries_user_month_employer
  ON public.payroll_entries (user_id, reference_month, employer);

-- =====================================================
-- SECAO 4: o desconto nao pode passar do bruto
-- =====================================================
-- Isto e um CHECK entre tabelas, que o Postgres nao tem -- por isso trigger.
--
-- Ele nao calcula dinheiro nenhum: so recusa. Um IRRF digitado como 5000 em
-- vez de 500 produziria liquido NEGATIVO, e o liquido negativo seria gravado
-- como transacao de receita com valor negativo -- que as views do 008 leem
-- como DESPESA, por causa da convencao de sinal. O mes apareceria com renda
-- zero e uma despesa que ninguem fez, e nada teria falhado.
CREATE OR REPLACE FUNCTION public.payroll_deductions_within_gross()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry uuid := COALESCE(NEW.payroll_entry_id, OLD.payroll_entry_id);
  v_gross numeric(15,2);
  v_total numeric(15,2);
BEGIN
  SELECT gross_amount INTO v_gross
  FROM public.payroll_entries WHERE id = v_entry;

  -- A entrada sumiu no mesmo comando (DELETE em cascata): nao ha o que checar.
  IF v_gross IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_total
  FROM public.payroll_deductions WHERE payroll_entry_id = v_entry;

  IF v_total > v_gross THEN
    RAISE EXCEPTION
      'Os descontos (%) passam do salario bruto (%) neste contracheque',
      v_total, v_gross
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;

COMMENT ON FUNCTION public.payroll_deductions_within_gross() IS
  'Recusa desconto que faria o liquido ficar negativo. SECURITY INVOKER de proposito: ele so le linhas que o proprio usuario acabou de gravar.';

DROP TRIGGER IF EXISTS trg_payroll_deductions_within_gross ON public.payroll_deductions;
CREATE TRIGGER trg_payroll_deductions_within_gross
  AFTER INSERT OR UPDATE ON public.payroll_deductions
  FOR EACH ROW EXECUTE FUNCTION public.payroll_deductions_within_gross();

-- IMEDIATO, e nao CONSTRAINT TRIGGER DEFERRED. A tentacao e adiar para o
-- commit "porque os descontos entram um a um e a soma parcial nao vale". Mas
-- soma parcial de parcelas POSITIVAS nunca passa da soma final: se a parcial
-- ja estourou o bruto, a final tambem estoura. Adiar so tiraria o erro do
-- comando que o causou -- e, pior, um trigger adiado nao dispara dentro do
-- bloco EXCEPTION do plpgsql, entao o UPDATE que infla um desconto ja gravado
-- pareceria ter passado.
--
-- Nao dispara em DELETE de proposito: apagar desconto so diminui o total.

-- =====================================================
-- SECAO 5: a view do liquido
-- =====================================================
-- O liquido NAO e coluna. Como coluna, ele seria uma terceira copia de um
-- numero que ja esta em dois lugares (bruto e descontos) e passaria a divergir
-- no primeiro desconto editado sem recalculo.
DROP VIEW IF EXISTS public.payroll_entry_totals;
CREATE VIEW public.payroll_entry_totals
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.user_id,
  e.reference_month,
  e.employer,
  e.gross_amount,
  e.account_id,
  e.transaction_id,
  e.notes,
  COALESCE(d.total_deductions, 0)::numeric(15,2) AS total_deductions,
  (e.gross_amount - COALESCE(d.total_deductions, 0))::numeric(15,2) AS net_amount,
  COALESCE(d.inss, 0)::numeric(15,2) AS inss_amount,
  COALESCE(d.irrf, 0)::numeric(15,2) AS irrf_amount,
  e.created_at,
  e.updated_at
FROM public.payroll_entries e
LEFT JOIN (
  SELECT
    payroll_entry_id,
    sum(amount) AS total_deductions,
    sum(amount) FILTER (WHERE kind = 'INSS') AS inss,
    sum(amount) FILTER (WHERE kind = 'IRRF') AS irrf
  FROM public.payroll_deductions
  GROUP BY payroll_entry_id
) d ON d.payroll_entry_id = e.id;

-- security_invoker: sem ele a view roda com o privilegio do DONO e devolve o
-- contracheque de TODO MUNDO para qualquer usuario logado -- a RLS da tabela
-- base nao alcanca view comum. Mesmo motivo das views do 006 e do 008.
COMMENT ON VIEW public.payroll_entry_totals IS
  'Contracheque com total descontado e LIQUIDO calculados. security_invoker: a RLS de payroll_entries e quem filtra.';

-- =====================================================
-- SECAO 6: RLS
-- =====================================================
ALTER TABLE public.payroll_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_entries_select ON public.payroll_entries;
CREATE POLICY payroll_entries_select ON public.payroll_entries
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS payroll_entries_insert ON public.payroll_entries;
CREATE POLICY payroll_entries_insert ON public.payroll_entries
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS payroll_entries_update ON public.payroll_entries;
CREATE POLICY payroll_entries_update ON public.payroll_entries
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS payroll_entries_delete ON public.payroll_entries;
CREATE POLICY payroll_entries_delete ON public.payroll_entries
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

ALTER TABLE public.payroll_deductions ENABLE ROW LEVEL SECURITY;

-- O desconto nao tem user_id proprio: quem manda e o dono do contracheque. O
-- EXISTS abaixo e o que impede alguem pendurar um desconto no contracheque de
-- outro -- e desconto alheio mudaria o liquido alheio.
DROP POLICY IF EXISTS payroll_deductions_select ON public.payroll_deductions;
CREATE POLICY payroll_deductions_select ON public.payroll_deductions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.payroll_entries e
    WHERE e.id = payroll_deductions.payroll_entry_id AND e.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS payroll_deductions_insert ON public.payroll_deductions;
CREATE POLICY payroll_deductions_insert ON public.payroll_deductions
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.payroll_entries e
    WHERE e.id = payroll_deductions.payroll_entry_id AND e.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS payroll_deductions_update ON public.payroll_deductions;
CREATE POLICY payroll_deductions_update ON public.payroll_deductions
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.payroll_entries e
    WHERE e.id = payroll_deductions.payroll_entry_id AND e.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.payroll_entries e
    WHERE e.id = payroll_deductions.payroll_entry_id AND e.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS payroll_deductions_delete ON public.payroll_deductions;
CREATE POLICY payroll_deductions_delete ON public.payroll_deductions
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.payroll_entries e
    WHERE e.id = payroll_deductions.payroll_entry_id AND e.user_id = auth.uid()
  ));

-- =====================================================
-- SECAO 6b: GRANTS
-- =====================================================
-- O 002 rodou GRANT ... ON ALL TABLES antes destas tabelas existirem, e ALL
-- TABLES nao alcanca o futuro. Sem isto a RLS esta certa e o usuario leva
-- "permission denied" -- que nao se parece nada com um problema de policy.
REVOKE ALL ON public.payroll_entries FROM anon;
REVOKE ALL ON public.payroll_deductions FROM anon;
REVOKE ALL ON public.payroll_entry_totals FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_deductions TO authenticated;
GRANT SELECT ON public.payroll_entry_totals TO authenticated;

-- =====================================================
-- SECAO 7: gravar o contracheque inteiro de uma vez
-- =====================================================
-- Contracheque, descontos e lancamento sao tres escritas que so fazem sentido
-- juntas. Feitas em tres chamadas HTTP, uma falha no meio deixa o estado
-- errado de um jeito que ninguem ve: contracheque sem desconto tem liquido =
-- bruto, e a renda do mes aparece maior do que foi.
--
-- SECURITY INVOKER (o padrao): a funcao escreve em nome do usuario e a RLS das
-- SECOES 6 continua valendo dentro dela. SECURITY DEFINER aqui recriaria o
-- problema que o 003 e o 004 passaram duas migrations consertando.
CREATE OR REPLACE FUNCTION public.register_payroll(
  p_reference_month date,
  p_employer text,
  p_gross_amount numeric,
  p_account_id uuid,
  p_category_id uuid,
  p_service_id uuid,
  p_deductions jsonb DEFAULT '[]'::jsonb,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry_id uuid;
  v_total numeric(15,2);
  v_net numeric(15,2);
  v_transaction_id uuid;
BEGIN
  INSERT INTO public.payroll_entries (
    user_id, reference_month, employer, gross_amount, account_id, notes
  ) VALUES (
    auth.uid(),
    date_trunc('month', p_reference_month)::date,
    COALESCE(NULLIF(btrim(p_employer), ''), 'Principal'),
    p_gross_amount,
    p_account_id,
    p_notes
  )
  RETURNING id INTO v_entry_id;

  INSERT INTO public.payroll_deductions (payroll_entry_id, kind, description, amount)
  SELECT
    v_entry_id,
    d->>'kind',
    NULLIF(btrim(COALESCE(d->>'description', '')), ''),
    (d->>'amount')::numeric
  FROM jsonb_array_elements(COALESCE(p_deductions, '[]'::jsonb)) AS d;

  SELECT COALESCE(sum(amount), 0) INTO v_total
  FROM public.payroll_deductions WHERE payroll_entry_id = v_entry_id;

  v_net := p_gross_amount - v_total;

  -- O trigger da SECAO 4 ja barrou desconto MAIOR que o bruto. Falta o caso do
  -- igual: desconto exatamente igual ao bruto passa pelo trigger e deixaria
  -- liquido zero, que viraria uma transacao de receita de R$ 0,00 -- uma linha
  -- no extrato que nao e dinheiro nenhum.
  IF v_net <= 0 THEN
    RAISE EXCEPTION
      'Os descontos (%) deixam o liquido em % -- confira os valores',
      v_total, v_net
      USING ERRCODE = 'check_violation';
  END IF;

  -- POSITIVO e transaction_type = 'income': e o liquido que caiu na conta.
  -- Ver o cabecalho para por que nao e o bruto.
  IF p_account_id IS NOT NULL AND p_category_id IS NOT NULL AND p_service_id IS NOT NULL THEN
    INSERT INTO public.financial_transactions (
      user_id, service_id, category_id, account_id,
      description, amount, transaction_date, transaction_type, notes
    ) VALUES (
      auth.uid(), p_service_id, p_category_id, p_account_id,
      format('Salário %s', to_char(date_trunc('month', p_reference_month), 'MM/YYYY')),
      v_net,
      date_trunc('month', p_reference_month)::date,
      'income',
      p_notes
    )
    RETURNING id INTO v_transaction_id;

    UPDATE public.payroll_entries
      SET transaction_id = v_transaction_id, updated_at = now()
      WHERE id = v_entry_id;
  END IF;

  RETURN v_entry_id;
END $$;

COMMENT ON FUNCTION public.register_payroll IS
  'Grava contracheque + descontos + o lancamento do LIQUIDO numa transacao so. SECURITY INVOKER: a RLS continua valendo dentro dela.';

COMMIT;
