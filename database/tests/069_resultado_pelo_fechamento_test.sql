-- =====================================================
-- Teste do Resultado do mes pelo fechamento do grupo (069)
-- =====================================================
-- O exemplo da RN018 (grupo Casa, R$ 2.000 no periodo, contas de +500, -100
-- e -400) atravessando a leitura de dinheiro, e prova:
--
--   1. no grupo que fecha, a parte de quem NAO pagou nao conta no Resultado
--      (RN018.9); quem pagou conta a despesa inteira; o grupo que nao fecha
--      continua contando a parte pelo rateio;
--   2. a conta do fechamento em aberto nao e realizado;
--   3. quitada pelo acerto, ela entra no realizado de quem a tem, no mes do
--      fechamento -- "Pagamento ao grupo" em Despesas, "A receber do grupo"
--      em Receitas (RN017.6), e a conta parcialmente quitada continua fora;
--   4. o Resultado de cada membro fecha na responsabilidade dele, e a soma
--      fecha no total do periodo (RN018.10);
--   5. quem nao e dono nao le a conta do fechamento do outro;
--   6. tirar o dia de fechamento nao devolve ao Resultado a parte de despesa
--      ja fechada;
--   7. no grupo que fecha, a conta prevista do grupo paga por um membro esta
--      paga para todos (`my_status`); no grupo que nao fecha, a 055 continua.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 069:
--   psql "$DB_URL" -f database/tests/069_resultado_pelo_fechamento_test.sql
--
-- Qualquer FALHA lanca excecao e aborta. Tudo roda numa transacao com ROLLBACK.
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

-- O Resultado de um mes, como o painel o le no modo mes: receita menos
-- despesa de `personal_monthly_cash_flow`, na sessao do proprio usuario.
-- plpgsql para o corpo so ser lido na chamada.
CREATE OR REPLACE FUNCTION pg_temp.resultado(p_mes date)
RETURNS NUMERIC LANGUAGE plpgsql AS $$
BEGIN
  RETURN (SELECT COALESCE(SUM(f.income) - SUM(f.expense), 0)
            FROM public.personal_monthly_cash_flow f
           WHERE f.user_id = auth.uid() AND f.month = p_mes);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.despesa(p_mes date)
RETURNS NUMERIC LANGUAGE plpgsql AS $$
BEGIN
  RETURN (SELECT COALESCE(SUM(f.expense), 0)
            FROM public.personal_monthly_cash_flow f
           WHERE f.user_id = auth.uid() AND f.month = p_mes);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.receita(p_mes date)
RETURNS NUMERIC LANGUAGE plpgsql AS $$
BEGIN
  RETURN (SELECT COALESCE(SUM(f.income), 0)
            FROM public.personal_monthly_cash_flow f
           WHERE f.user_id = auth.uid() AND f.month = p_mes);
END $$;

-- =====================================================
-- Fixture
-- =====================================================
--   Helio a1, Lais b1, Leticia c1, Bia e1 (fora da Casa)
--   grupo Casa d1 (fecha no dia 9), grupo Outro d2 (nao fecha)
--   servico  8730cd96-d656-4c48-863e-673e1016a832  (personal_finance)
--   Moradia  b61d7949-2abc-430d-9bd0-02a146c1d9d8  (despesa, do seed)
INSERT INTO auth.users (id, email) VALUES
  ('a0690000-0000-0000-0000-0000000000a1', 'helio@resultado.local'),
  ('a0690000-0000-0000-0000-0000000000b1', 'lais@resultado.local'),
  ('a0690000-0000-0000-0000-0000000000c1', 'leticia@resultado.local'),
  ('a0690000-0000-0000-0000-0000000000e1', 'bia@resultado.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('a0690000-0000-0000-0000-0000000000a1', 'Helio', FALSE),
  ('a0690000-0000-0000-0000-0000000000b1', 'Lais', FALSE),
  ('a0690000-0000-0000-0000-0000000000c1', 'Leticia', FALSE),
  ('a0690000-0000-0000-0000-0000000000e1', 'Bia', FALSE);

INSERT INTO public.expense_groups (id, name, created_by, group_code, closing_day) VALUES
  ('a0690000-0000-0000-0000-0000000000d1', 'Casa', 'a0690000-0000-0000-0000-0000000000a1', 'RESU69', 9),
  ('a0690000-0000-0000-0000-0000000000d2', 'Outro', 'a0690000-0000-0000-0000-0000000000e1', 'OUTR69', NULL);
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('a0690000-0000-0000-0000-0000000000d1', 'a0690000-0000-0000-0000-0000000000b1', 'member', 'active'),
  ('a0690000-0000-0000-0000-0000000000d1', 'a0690000-0000-0000-0000-0000000000c1', 'member', 'active'),
  ('a0690000-0000-0000-0000-0000000000d2', 'a0690000-0000-0000-0000-0000000000b1', 'member', 'active');

-- As despesas de outubro. O trigger do 024/042 cria `group_transactions` e o
-- rateio de cada uma.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, group_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0690000-0000-0000-0000-0000000000f1', 'a0690000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0690000-0000-0000-0000-0000000000d1', 'Aluguel', -1500.00, DATE '2026-10-12', 'expense'),
  ('a0690000-0000-0000-0000-0000000000f2', 'a0690000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0690000-0000-0000-0000-0000000000d1', 'Mercado', -500.00, DATE '2026-10-20', 'expense'),
  -- No grupo que NAO fecha: a Bia paga R$ 90 e a Lais fica com R$ 45.
  ('a0690000-0000-0000-0000-0000000000f3', 'a0690000-0000-0000-0000-0000000000e1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0690000-0000-0000-0000-0000000000d2', 'Pizza', -90.00, DATE '2026-10-15', 'expense');

-- =====================================================
-- SECAO 1: antes do fechamento, a parte de quem nao pagou nao conta
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0690000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect('Lais: nenhuma parte do que OUTRO pagou na Casa',
  (SELECT count(*) FROM public.group_share_entries
    WHERE user_id = auth.uid()
      AND group_id = 'a0690000-0000-0000-0000-0000000000d1'
      AND NOT paguei_eu), 0);
SELECT pg_temp.expect('Lais: a linha do que ela mesma pagou na Casa fica',
  (SELECT count(*) FROM public.group_share_entries
    WHERE user_id = auth.uid()
      AND group_id = 'a0690000-0000-0000-0000-0000000000d1'
      AND paguei_eu), 1);
SELECT pg_temp.expect_num('Lais: no grupo que nao fecha a parte continua (R$ 45)',
  (SELECT SUM(amount) FROM public.group_share_entries
    WHERE user_id = auth.uid()
      AND group_id = 'a0690000-0000-0000-0000-0000000000d2'
      AND NOT paguei_eu), 45.00);
SELECT pg_temp.expect_num('Lais: outubro e o Mercado inteiro mais a Pizza do Outro',
  pg_temp.despesa(DATE '2026-10-01'), 545.00);
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0690000-0000-0000-0000-0000000000c1';
-- Controle: pelo rateio, a Leticia teria um terco das duas despesas da Casa.
SELECT pg_temp.expect_num('Leticia: nao pagou nada e outubro fica zerado',
  pg_temp.despesa(DATE '2026-10-01'), 0);
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0690000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect_num('Helio: o Aluguel inteiro, porque saiu da conta dele',
  pg_temp.despesa(DATE '2026-10-01'), 1500.00);
RESET ROLE;

-- =====================================================
-- SECAO 2: o fechamento gera as contas, e conta aberta nao e realizado
-- =====================================================
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.sub = '';
SELECT public.registrar_fechamento_do_grupo(
  'a0690000-0000-0000-0000-0000000000d1', DATE '2026-10-10', DATE '2026-11-09', $json$
{ "total": 2000.00,
  "membros": [
    { "user_id": "a0690000-0000-0000-0000-0000000000a1", "percentual": 50, "pago": 1500.00, "acertos": 0, "responsabilidade": 1000.00, "saldo": 500.00 },
    { "user_id": "a0690000-0000-0000-0000-0000000000b1", "percentual": 30, "pago": 500.00, "acertos": 0, "responsabilidade": 600.00, "saldo": -100.00 },
    { "user_id": "a0690000-0000-0000-0000-0000000000c1", "percentual": 20, "pago": 0, "acertos": 0, "responsabilidade": 400.00, "saldo": -400.00 }
  ],
  "itens": [
    { "kind": "despesa", "transaction_id": "a0690000-0000-0000-0000-0000000000f1", "from_user_id": "a0690000-0000-0000-0000-0000000000a1", "amount": 1500.00, "item_date": "2026-10-12", "description": "Aluguel" },
    { "kind": "despesa", "transaction_id": "a0690000-0000-0000-0000-0000000000f2", "from_user_id": "a0690000-0000-0000-0000-0000000000b1", "amount": 500.00, "item_date": "2026-10-20", "description": "Mercado" }
  ],
  "contas": [
    { "user_id": "a0690000-0000-0000-0000-0000000000a1", "tipo": "income", "valor": 500.00 },
    { "user_id": "a0690000-0000-0000-0000-0000000000b1", "tipo": "expense", "valor": 100.00 },
    { "user_id": "a0690000-0000-0000-0000-0000000000c1", "tipo": "expense", "valor": 400.00 }
  ] }
$json$::jsonb);
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0690000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect('Lais: a conta do fechamento em aberto nao e realizado',
  (SELECT count(*) FROM public.group_closing_entries), 0);
SELECT pg_temp.expect_num('Lais: novembro sem nada realizado ainda',
  pg_temp.despesa(DATE '2026-11-01'), 0);
SELECT pg_temp.expect_text('Lais: a conta dela e previsao comum, de R$ 100, a pagar',
  (SELECT amount::text || '/' || direction::text || '/' || my_status
     FROM public.scheduled_transactions_effective
    WHERE user_id = auth.uid() AND description = 'Pagamento ao grupo Casa'),
  '100.00/expense/pending');
RESET ROLE;

-- =====================================================
-- SECAO 3: quitada pelo acerto, a conta entra no realizado
-- =====================================================
-- A Lais manda R$ 100 ao Helio: a conta dela fica quitada inteira, e a dele
-- quitada em R$ 100 de R$ 500.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0690000-0000-0000-0000-0000000000b1';
INSERT INTO public.group_settlements
  (id, group_id, from_user_id, to_user_id, amount, settled_on, created_by)
VALUES
  ('a0690000-0000-0000-0000-000000000051', 'a0690000-0000-0000-0000-0000000000d1',
   'a0690000-0000-0000-0000-0000000000b1', 'a0690000-0000-0000-0000-0000000000a1',
   100.00, DATE '2026-11-10', 'a0690000-0000-0000-0000-0000000000b1');

SELECT pg_temp.expect_text('Lais: o Pagamento ao grupo quitado e realizado, no dia do fechamento',
  (SELECT transaction_type::text || '/' || amount::text || '/' || transaction_date::text || '/' || descricao
     FROM public.group_closing_entries WHERE user_id = auth.uid()),
  'expense/100.00/2026-11-09/Pagamento ao grupo Casa');
SELECT pg_temp.expect_num('Lais: novembro tem a despesa de R$ 100',
  pg_temp.despesa(DATE '2026-11-01'), 100.00);
SELECT pg_temp.expect('Lais: e ela saiu da previsao (paga)',
  (SELECT count(*) FROM public.scheduled_transactions_effective
    WHERE user_id = auth.uid() AND description = 'Pagamento ao grupo Casa'
      AND my_status = 'pending'), 0);
-- O previsto x realizado do mes: a conta e o previsto, a baixa e o realizado.
SELECT pg_temp.expect_text('Lais: previsto x realizado de novembro, R$ 100 nos dois lados',
  (SELECT planned_expense::text || '/' || actual_expense::text
     FROM public.planned_vs_actual
    WHERE user_id = auth.uid() AND group_id IS NULL AND month = DATE '2026-11-01'),
  '100.00/100.00');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0690000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect('Helio: a conta quitada pela metade ainda nao e realizado',
  (SELECT count(*) FROM public.group_closing_entries WHERE user_id = auth.uid()), 0);
SELECT pg_temp.expect_num('Helio: novembro sem receita ainda',
  pg_temp.receita(DATE '2026-11-01'), 0);
RESET ROLE;

-- A Leticia manda os R$ 400 em DEZEMBRO. A conta do Helio fica quitada, e a
-- receita dele cai em NOVEMBRO, o mes do fechamento -- nao no mes do Pix.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0690000-0000-0000-0000-0000000000c1';
INSERT INTO public.group_settlements
  (id, group_id, from_user_id, to_user_id, amount, settled_on, created_by)
VALUES
  ('a0690000-0000-0000-0000-000000000052', 'a0690000-0000-0000-0000-0000000000d1',
   'a0690000-0000-0000-0000-0000000000c1', 'a0690000-0000-0000-0000-0000000000a1',
   400.00, DATE '2026-12-02', 'a0690000-0000-0000-0000-0000000000c1');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0690000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect_text('Helio: o A receber do grupo quitado e realizado, em novembro',
  (SELECT transaction_type::text || '/' || amount::text || '/' || month::text
     FROM public.group_closing_entries WHERE user_id = auth.uid()),
  'income/500.00/2026-11-01');
SELECT pg_temp.expect_num('Helio: novembro tem a receita de R$ 500',
  pg_temp.receita(DATE '2026-11-01'), 500.00);
SELECT pg_temp.expect_num('Helio: dezembro nao tem nada',
  pg_temp.receita(DATE '2026-12-01'), 0);

-- =====================================================
-- SECAO 4: o Resultado fecha na responsabilidade (RN018.10)
-- =====================================================
SELECT pg_temp.expect_num('Helio: outubro + novembro = -R$ 1.000, os 50%',
  pg_temp.resultado(DATE '2026-10-01') + pg_temp.resultado(DATE '2026-11-01'), -1000.00);

-- =====================================================
-- SECAO 5: a conta do fechamento e so do dono
-- =====================================================
SELECT pg_temp.expect('Helio: nao le a conta do fechamento da Lais',
  (SELECT count(*) FROM public.group_closing_entries
    WHERE user_id = 'a0690000-0000-0000-0000-0000000000b1'), 0);
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0690000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect_num('Lais: outubro + novembro, sem o Outro = -R$ 600, os 30%',
  pg_temp.resultado(DATE '2026-10-01') + pg_temp.resultado(DATE '2026-11-01') + 45.00, -600.00);
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0690000-0000-0000-0000-0000000000c1';
SELECT pg_temp.expect_num('Leticia: outubro + novembro = -R$ 400, os 20%',
  pg_temp.resultado(DATE '2026-10-01') + pg_temp.resultado(DATE '2026-11-01'), -400.00);
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0690000-0000-0000-0000-0000000000e1';
SELECT pg_temp.expect('Bia: fora da Casa, nenhuma conta do fechamento',
  (SELECT count(*) FROM public.group_closing_entries), 0);
RESET ROLE;

SELECT pg_temp.expect_text('group_closing_entries roda com a RLS de quem le',
  (SELECT array_to_string(reloptions, ',') FROM pg_class
    WHERE oid = 'public.group_closing_entries'::regclass),
  'security_invoker=true');

-- =====================================================
-- SECAO 6: tirar o dia de fechamento nao devolve a parte ja fechada
-- =====================================================
UPDATE public.expense_groups SET closing_day = NULL
 WHERE id = 'a0690000-0000-0000-0000-0000000000d1';

-- Uma despesa nova da Casa, depois do fechamento: ela nao foi fechada.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, group_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0690000-0000-0000-0000-0000000000f4', 'a0690000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0690000-0000-0000-0000-0000000000d1', 'Luz', -300.00, DATE '2026-11-20', 'expense');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0690000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect('Lais: o Aluguel ja fechado continua fora, sem o dia de fechamento',
  (SELECT count(*) FROM public.group_share_entries
    WHERE user_id = auth.uid()
      AND transaction_id = 'a0690000-0000-0000-0000-0000000000f1'), 0);
SELECT pg_temp.expect('Lais: a Luz, que nao fechou, volta a contar pelo rateio',
  (SELECT count(*) FROM public.group_share_entries
    WHERE user_id = auth.uid()
      AND transaction_id = 'a0690000-0000-0000-0000-0000000000f4'), 1);
RESET ROLE;

UPDATE public.expense_groups SET closing_day = 9
 WHERE id = 'a0690000-0000-0000-0000-0000000000d1';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0690000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect('Lais: com o dia de volta, a Luz sai de novo (vai para o proximo fechamento)',
  (SELECT count(*) FROM public.group_share_entries
    WHERE user_id = auth.uid()
      AND transaction_id = 'a0690000-0000-0000-0000-0000000000f4'), 0);
RESET ROLE;

-- =====================================================
-- SECAO 7: a conta prevista do grupo que fecha e paga para todos
-- =====================================================
INSERT INTO public.scheduled_transactions
  (id, user_id, group_id, category_id, description, amount, due_date, status, transaction_type)
VALUES
  ('a0690000-0000-0000-0000-0000000000a7', 'a0690000-0000-0000-0000-0000000000a1',
   'a0690000-0000-0000-0000-0000000000d1', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'Internet', 120.00, DATE '2026-11-25', 'pending', 'expense'),
  ('a0690000-0000-0000-0000-0000000000a8', 'a0690000-0000-0000-0000-0000000000e1',
   'a0690000-0000-0000-0000-0000000000d2', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'Gas', 60.00, DATE '2026-11-25', 'pending', 'expense');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0690000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect_text('Lais: a Internet da Casa, antes de alguem pagar, esta a pagar',
  (SELECT my_status FROM public.scheduled_transactions_effective
    WHERE id = 'a0690000-0000-0000-0000-0000000000a7'), 'pending');
RESET ROLE;

-- O Helio paga a Internet e a Bia paga o Gas, cada um com o lancamento.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, group_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0690000-0000-0000-0000-0000000000f5', 'a0690000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0690000-0000-0000-0000-0000000000d1', 'Internet', -120.00, DATE '2026-11-25', 'expense'),
  ('a0690000-0000-0000-0000-0000000000f6', 'a0690000-0000-0000-0000-0000000000e1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0690000-0000-0000-0000-0000000000d2', 'Gas', -60.00, DATE '2026-11-25', 'expense');
UPDATE public.scheduled_transactions
   SET status = 'paid', paid_date = DATE '2026-11-25',
       transaction_id = 'a0690000-0000-0000-0000-0000000000f5'
 WHERE id = 'a0690000-0000-0000-0000-0000000000a7';
UPDATE public.scheduled_transactions
   SET status = 'paid', paid_date = DATE '2026-11-25',
       transaction_id = 'a0690000-0000-0000-0000-0000000000f6'
 WHERE id = 'a0690000-0000-0000-0000-0000000000a8';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0690000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect_text('Lais: o Helio pagou a Internet da Casa, e ela esta paga para ela tambem',
  (SELECT my_status || '/' || my_effective_status FROM public.scheduled_transactions_effective
    WHERE id = 'a0690000-0000-0000-0000-0000000000a7'), 'paid/paid');
-- Controle: no grupo que nao fecha, a parte dela continua a pagar ate ela
-- dar a baixa dela (055).
SELECT pg_temp.expect_text('Lais: o Gas do Outro, pago pela Bia, continua a pagar para ela',
  (SELECT my_status FROM public.scheduled_transactions_effective
    WHERE id = 'a0690000-0000-0000-0000-0000000000a8'), 'pending');
-- E a conta pessoal continua com my_status = status (a premissa das leituras).
SELECT pg_temp.expect('Lais: em toda conta dela, my_status = status',
  (SELECT count(*) FROM public.scheduled_transactions_effective
    WHERE user_id = auth.uid() AND my_status IS DISTINCT FROM status::text), 0);
RESET ROLE;

ROLLBACK;
