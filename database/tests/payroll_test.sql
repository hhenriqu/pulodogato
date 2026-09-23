-- =====================================================
-- Teste do contracheque: bruto, descontos e liquido (012)
-- =====================================================
-- Responde o que o 012 sozinho nao prova:
--
--   1. O LANCAMENTO E O LIQUIDO, e e POSITIVO. Esta e a assercao central. Se
--      `register_payroll` gravasse o bruto, o fluxo de caixa do 008 mostraria
--      uma receita que o usuario nunca recebeu; se gravasse o liquido com
--      sinal trocado, as views do 008 leriam o salario como DESPESA, por causa
--      da convencao de sinal deste banco. Nos dois casos o saldo da conta
--      continuaria fechando, que e o que torna o erro invisivel.
--   2. O liquido da view e bruto - descontos, e ele NAO e coluna gravada.
--   3. Desconto maior que o bruto e RECUSADO. Sem isso, um IRRF digitado com
--      um zero a mais produz receita negativa -- que vira despesa nos
--      relatorios, silenciosamente.
--   4. Dois contracheques do mesmo mes e empregador nao coexistem (a renda do
--      mes dobraria), mas dois empregadores no mesmo mes coexistem.
--   5. O dia da referencia e sempre o dia 1: duas datas do mesmo mes nao
--      escapam do UNIQUE.
--   6. A view respeita a RLS da tabela base (security_invoker). Sem isso ela
--      roda com o privilegio do dono e devolve o salario de TODO MUNDO.
--   7. Um desconto nao se pendura no contracheque de outro usuario.
--   8. `anon` nao tem privilegio nas duas tabelas.
--
-- Tem DOIS CONTROLES NEGATIVOS no fim: o security_invoker da view e o trigger
-- do teto sao removidos e as falhas tem que reaparecer. Sem eles, uma protecao
-- que parasse de valer deixaria este arquivo verde do mesmo jeito.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 011 -> 012:
--   psql "$DB_URL" -f database/tests/payroll_test.sql
--
-- Qualquer FALHA lanca excecao e aborta.
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect(label TEXT, got BIGINT, want BIGINT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_num(label TEXT, got NUMERIC, want NUMERIC)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_text(label TEXT, got TEXT, want TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_erro(label TEXT, sql TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ok: % (barrado: %)', label, left(SQLERRM, 70);
    RETURN;
  END;
  RAISE EXCEPTION 'FALHA: % -> o comando PASSOU e deveria ter sido barrado', label;
END $$;

-- =====================================================
-- Fixture
-- =====================================================
--   H  o assalariado
--   Z  um terceiro, que nao pode ver o contracheque de H
INSERT INTO auth.users (id, email) VALUES
  ('11111111-0000-0000-0000-000000000012', 'h@folha.local'),
  ('22222222-0000-0000-0000-000000000012', 'z@folha.local');

INSERT INTO public.profiles (id, full_name) VALUES
  ('11111111-0000-0000-0000-000000000012', 'Helio'),
  ('22222222-0000-0000-0000-000000000012', 'Zeca');

INSERT INTO public.financial_accounts (id, user_id, name, account_type) VALUES
  ('aacc0000-0000-0000-0000-000000000012',
   '11111111-0000-0000-0000-000000000012', 'Conta Salario', 'checking'),
  ('aacc0000-0000-0000-0000-000000000099',
   '22222222-0000-0000-0000-000000000012', 'Conta do Zeca', 'checking');

-- service + categoria de receita, que a transacao do liquido exige.
INSERT INTO public.financial_services (id, name, description)
VALUES ('ff000000-0000-0000-0000-000000000012', 'personal_finance', 'Financas Pessoais')
ON CONFLICT DO NOTHING;

INSERT INTO public.transaction_categories (id, service_id, name, is_expense)
VALUES ('cc000000-0000-0000-0000-000000000012',
        (SELECT id FROM public.financial_services WHERE name = 'personal_finance' LIMIT 1),
        'Salario', FALSE)
ON CONFLICT DO NOTHING;

-- =====================================================
-- SECAO 1: o caminho feliz -- 5000 bruto, 1000 de desconto
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '11111111-0000-0000-0000-000000000012';

DO $$
DECLARE
  v_id uuid;
BEGIN
  v_id := public.register_payroll(
    '2026-03-01'::date,
    'H. Moraes Tecnologia',
    5000.00,
    'aacc0000-0000-0000-0000-000000000012',
    'cc000000-0000-0000-0000-000000000012',
    (SELECT id FROM public.financial_services WHERE name = 'personal_finance' LIMIT 1),
    '[{"kind":"INSS","amount":550.00},
      {"kind":"IRRF","amount":300.00},
      {"kind":"HEALTH","description":"Plano de saude","amount":150.00}]'::jsonb,
    NULL
  );
  PERFORM set_config('pg_temp.entry', v_id::text, TRUE);
END $$;

DO $$ BEGIN PERFORM pg_temp.expect_num('bruto gravado',
  (SELECT gross_amount FROM public.payroll_entries
    WHERE id = current_setting('pg_temp.entry')::uuid), 5000.00); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_num('total descontado',
  (SELECT total_deductions FROM public.payroll_entry_totals
    WHERE id = current_setting('pg_temp.entry')::uuid), 1000.00); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_num('liquido = bruto - descontos',
  (SELECT net_amount FROM public.payroll_entry_totals
    WHERE id = current_setting('pg_temp.entry')::uuid), 4000.00); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_num('INSS sai separado para a tela',
  (SELECT inss_amount FROM public.payroll_entry_totals
    WHERE id = current_setting('pg_temp.entry')::uuid), 550.00); END $$;

-- A ASSERCAO CENTRAL. Se isto virar 5000, o app passa a mostrar uma receita
-- que nunca existiu; se virar -4000, os relatorios do 008 leem salario como
-- despesa. Nos dois casos o saldo da conta continua fechando.
DO $$ BEGIN PERFORM pg_temp.expect_num('o lancamento e o LIQUIDO, positivo',
  (SELECT t.amount FROM public.financial_transactions t
    JOIN public.payroll_entries e ON e.transaction_id = t.id
   WHERE e.id = current_setting('pg_temp.entry')::uuid), 4000.00); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_text('o lancamento e receita',
  (SELECT t.transaction_type::text FROM public.financial_transactions t
    JOIN public.payroll_entries e ON e.transaction_id = t.id
   WHERE e.id = current_setting('pg_temp.entry')::uuid), 'income'); END $$;

-- O liquido nao e coluna: se alguem o materializar, esta consulta acha.
DO $$ BEGIN PERFORM pg_temp.expect('liquido NAO e coluna gravada',
  (SELECT COUNT(*) FROM pg_attribute
    WHERE attrelid = 'public.payroll_entries'::regclass
      AND attname IN ('net_amount', 'net', 'liquido')
      AND attnum > 0 AND NOT attisdropped), 0); END $$;

-- =====================================================
-- SECAO 2: o dia da referencia e sempre o dia 1
-- =====================================================
DO $$ BEGIN PERFORM pg_temp.expect_text('mes guardado no dia 1',
  (SELECT reference_month::text FROM public.payroll_entries
    WHERE id = current_setting('pg_temp.entry')::uuid), '2026-03-01'); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_erro('data que nao e dia 1 e barrada', $sql$
  INSERT INTO public.payroll_entries (user_id, reference_month, employer, gross_amount)
  VALUES ('11111111-0000-0000-0000-000000000012', '2026-04-15', 'Outro', 1000)
$sql$); END $$;

-- =====================================================
-- SECAO 3: o mesmo contracheque nao entra duas vezes
-- =====================================================
-- Sem o UNIQUE, lancar de novo dobraria a renda de marco.
DO $$ BEGIN PERFORM pg_temp.expect_erro('mesmo mes + mesmo empregador e barrado', $sql$
  SELECT public.register_payroll(
    '2026-03-20'::date, 'H. Moraes Tecnologia', 5000.00,
    'aacc0000-0000-0000-0000-000000000012',
    'cc000000-0000-0000-0000-000000000012',
    (SELECT id FROM public.financial_services WHERE name = 'personal_finance' LIMIT 1),
    '[]'::jsonb, NULL)
$sql$); END $$;

-- Mas quem tem dois empregos continua podendo lancar os dois.
DO $$
DECLARE v_id uuid;
BEGIN
  v_id := public.register_payroll(
    '2026-03-01'::date, 'Segundo Emprego', 1200.00,
    'aacc0000-0000-0000-0000-000000000012',
    'cc000000-0000-0000-0000-000000000012',
    (SELECT id FROM public.financial_services WHERE name = 'personal_finance' LIMIT 1),
    '[]'::jsonb, NULL);
  PERFORM pg_temp.expect('dois empregadores no mesmo mes coexistem',
    (SELECT COUNT(*) FROM public.payroll_entries
      WHERE user_id = '11111111-0000-0000-0000-000000000012'
        AND reference_month = '2026-03-01'), 2);
END $$;

-- =====================================================
-- SECAO 4: desconto nao passa do bruto
-- =====================================================
-- Um IRRF com um zero a mais produziria liquido negativo. Como receita
-- negativa, as views do 008 o leem como DESPESA: o mes apareceria com renda
-- zero e um gasto que ninguem fez.
DO $$ BEGIN PERFORM pg_temp.expect_erro('desconto maior que o bruto e recusado', $sql$
  SELECT public.register_payroll(
    '2026-05-01'::date, 'H. Moraes Tecnologia', 5000.00,
    'aacc0000-0000-0000-0000-000000000012',
    'cc000000-0000-0000-0000-000000000012',
    (SELECT id FROM public.financial_services WHERE name = 'personal_finance' LIMIT 1),
    '[{"kind":"IRRF","amount":5500.00}]'::jsonb, NULL)
$sql$); END $$;

-- E tambem por UPDATE depois, que e o caminho que a funcao nao cobre.
DO $$ BEGIN PERFORM pg_temp.expect_erro('inflar um desconto existente e recusado', $sql$
  UPDATE public.payroll_deductions SET amount = 9000
   WHERE payroll_entry_id = current_setting('pg_temp.entry')::uuid
     AND kind = 'IRRF'
$sql$); END $$;

-- Valor negativo tambem nao entra: ele faria a subtracao virar soma.
DO $$ BEGIN PERFORM pg_temp.expect_erro('desconto negativo e barrado', $sql$
  INSERT INTO public.payroll_deductions (payroll_entry_id, kind, amount)
  VALUES (current_setting('pg_temp.entry')::uuid, 'OTHER', -100)
$sql$); END $$;

-- FGTS nao e desconto: ele nao diminui o bruto.
DO $$ BEGIN PERFORM pg_temp.expect_erro('FGTS nao e um kind valido', $sql$
  INSERT INTO public.payroll_deductions (payroll_entry_id, kind, amount)
  VALUES (current_setting('pg_temp.entry')::uuid, 'FGTS', 400)
$sql$); END $$;

-- =====================================================
-- SECAO 5: isolamento entre usuarios
-- =====================================================
SET LOCAL request.jwt.claim.sub = '22222222-0000-0000-0000-000000000012';

DO $$ BEGIN PERFORM pg_temp.expect('Z nao ve o contracheque de H',
  (SELECT COUNT(*) FROM public.payroll_entries
    WHERE user_id = '11111111-0000-0000-0000-000000000012'), 0); END $$;

-- A view e o ponto fragil: sem security_invoker ela roda com o privilegio do
-- dono e devolve o salario de todo mundo.
DO $$ BEGIN PERFORM pg_temp.expect('Z nao ve o LIQUIDO de H pela view',
  (SELECT COUNT(*) FROM public.payroll_entry_totals
    WHERE user_id = '11111111-0000-0000-0000-000000000012'), 0); END $$;

DO $$ BEGIN PERFORM pg_temp.expect('Z nao ve os descontos de H',
  (SELECT COUNT(*) FROM public.payroll_deductions), 0); END $$;

-- Pendurar um desconto no contracheque alheio mudaria o liquido alheio.
DO $$ BEGIN PERFORM pg_temp.expect_erro('Z nao pendura desconto no contracheque de H', $sql$
  INSERT INTO public.payroll_deductions (payroll_entry_id, kind, amount)
  VALUES (current_setting('pg_temp.entry')::uuid, 'OTHER', 100)
$sql$); END $$;

-- =====================================================
-- SECAO 6: anon nao tem nada
-- =====================================================
RESET ROLE;

DO $$ BEGIN PERFORM pg_temp.expect('anon sem privilegio em payroll_entries',
  (SELECT COUNT(*) FROM information_schema.role_table_grants
    WHERE grantee = 'anon' AND table_schema = 'public'
      AND table_name = 'payroll_entries'), 0); END $$;

DO $$ BEGIN PERFORM pg_temp.expect('anon sem privilegio em payroll_deductions',
  (SELECT COUNT(*) FROM information_schema.role_table_grants
    WHERE grantee = 'anon' AND table_schema = 'public'
      AND table_name = 'payroll_deductions'), 0); END $$;

-- =====================================================
-- CONTROLE NEGATIVO 1: sem security_invoker, a view vaza
-- =====================================================
ALTER VIEW public.payroll_entry_totals SET (security_invoker = false);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '22222222-0000-0000-0000-000000000012';

DO $$
DECLARE n BIGINT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.payroll_entry_totals
   WHERE user_id = '11111111-0000-0000-0000-000000000012';
  IF n = 0 THEN
    RAISE EXCEPTION 'FALHA no controle negativo 1: sem security_invoker a view deveria vazar, e nao vazou -- o teste de isolamento acima nao prova nada.';
  END IF;
  RAISE NOTICE 'ok: controle negativo 1 -- sem security_invoker, Z enxerga % contracheque(s) de H', n;
END $$;

RESET ROLE;
ALTER VIEW public.payroll_entry_totals SET (security_invoker = true);

-- =====================================================
-- CONTROLE NEGATIVO 2: sem o trigger, o liquido fica negativo
-- =====================================================
DROP TRIGGER trg_payroll_deductions_within_gross ON public.payroll_deductions;

INSERT INTO public.payroll_deductions (payroll_entry_id, kind, amount)
VALUES (current_setting('pg_temp.entry')::uuid, 'OTHER', 99000);

DO $$
DECLARE v_net NUMERIC;
BEGIN
  SELECT net_amount INTO v_net FROM public.payroll_entry_totals
   WHERE id = current_setting('pg_temp.entry')::uuid;
  IF v_net >= 0 THEN
    RAISE EXCEPTION 'FALHA no controle negativo 2: sem o trigger o liquido deveria ficar negativo, e ficou % -- o teste do teto acima nao prova nada.', v_net;
  END IF;
  RAISE NOTICE 'ok: controle negativo 2 -- sem o trigger, o liquido vira % e seria gravado como receita negativa', v_net;
END $$;

-- =====================================================
DO $$ BEGIN RAISE NOTICE 'CONTRACHEQUE: TUDO OK -- liquido, teto do desconto, mes unico e isolamento conferidos'; END $$;

ROLLBACK;
