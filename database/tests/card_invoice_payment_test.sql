-- =====================================================
-- Teste do pagamento de fatura de cartao (015 / HMO-149)
-- =====================================================
-- Responde o que o 015 sozinho nao prova:
--   1. a reproducao do bug acontece mesmo neste schema (controle positivo:
--      sem ela, o teste do conserto passaria verde num banco onde o bug nunca
--      existiu, e nao provaria nada);
--   2. o reparo desfaz a baixa torta E devolve o saldo do cartao;
--   3. o reparo NAO toca na assinatura cobrada no cartao -- o caso que um
--      reparo por `account_type` destruiria em silencio;
--   4. o reparo NAO toca no pagamento novo (duas pernas 'transfer');
--   5. o pagamento novo deixa o patrimonio IGUAL, quita o cartao, e nao
--      aparece nem no fluxo de caixa nem na fatura do mes seguinte;
--   6. o elo entre as pernas resiste a auto-referencia e a id inexistente;
--   7. a funcao de reparo nao esta publicada como RPC para o app.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 015:
--   psql "$DB_URL" -f database/tests/card_invoice_payment_test.sql
--
-- Qualquer FALHA lanca excecao e aborta.
--
-- POR QUE ESTE TESTE E EM SQL E NAO SO EM TYPESCRIPT
-- --------------------------------------------------
-- lib/card-invoice.ts prova a aritmetica das duas pernas. O que ele NAO
-- alcanca e o trigger `update_account_balance`, que e quem de fato move o
-- saldo, e as views do 008 e do 006, que decidem se aquele movimento vira
-- despesa no relatorio. O bug do HMO-149 vivia exatamente nessa junta: a
-- aritmetica do valor estava certa (era `-Math.abs`, como toda despesa), a
-- conta que recebia o lancamento e que estava errada.
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

CREATE OR REPLACE FUNCTION pg_temp.expect_null(label TEXT, got TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA: % -> esperado NULL, obtido %', label, got;
  END IF;
  RAISE NOTICE 'ok: % (NULL)', label;
END $$;

-- =====================================================
-- Fixture: a reproducao da HMO-149, valor por valor
-- =====================================================
--   conta corrente  5.000,00
--   cartao         -1.000,00  (uma compra de 1.000 ja lancada)
--   patrimonio      4.000,00
--
-- Os UUIDs de servico e categoria sao os do seed que o 001_baseline carrega,
-- escritos por extenso pelo mesmo motivo dos outros testes (o bundle do SQL
-- Editor so traduz o \set ON_ERROR_STOP):
--   servico   8730cd96-d656-4c48-863e-673e1016a832  (personal_finance)
--   categoria b9db286c-ce4f-4fbe-b0bf-f3133185f90f
INSERT INTO auth.users (id, email) VALUES
  ('caaaaaaa-0000-0000-0000-0000000000a0', 'a@fatura.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('caaaaaaa-0000-0000-0000-0000000000a0', 'Usuario da fatura', FALSE);

-- O cartao comeca em ZERO e chega a -1.000 pela propria compra, com o trigger
-- ligado -- em vez de nascer com -1.000 na fixture. Prova mais: se
-- `update_account_balance` nao estivesse fazendo o que o resto do teste assume,
-- os numeros nao fechariam nem no ponto de partida, e o teste do conserto
-- estaria medindo outra coisa.
INSERT INTO public.financial_accounts
  (id, user_id, name, account_type, current_balance, closing_day, due_day) VALUES
  ('c0000000-0000-0000-0000-0000000000d1', 'caaaaaaa-0000-0000-0000-0000000000a0',
   'Conta Corrente', 'checking', 6000.00, NULL, NULL),
  ('c0000000-0000-0000-0000-0000000000d2', 'caaaaaaa-0000-0000-0000-0000000000a0',
   'Cartao', 'credit_card', 0.00, 28, 5),
  -- Segundo cartao: existe para provar que o reparo nao confunde um cartao com
  -- o outro ao ler a chave da fatura.
  ('c0000000-0000-0000-0000-0000000000d3', 'caaaaaaa-0000-0000-0000-0000000000a0',
   'Outro Cartao', 'credit_card', 0.00, 10, 20);

-- Dois lancamentos, um em cada conta: o aluguel leva a corrente de 6.000 para
-- os 5.000 do relato, e a compra leva o cartao de 0 para -1.000. O aluguel nao
-- e enfeite -- ele e a despesa que TEM que continuar aparecendo no fluxo de
-- caixa depois do conserto, e sem ele a assercao de 2.000 no fim passaria
-- tambem num codigo que simplesmente para de contar despesa nenhuma.
INSERT INTO public.financial_transactions
  (user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type)
VALUES
  ('caaaaaaa-0000-0000-0000-0000000000a0', '8730cd96-d656-4c48-863e-673e1016a832',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'c0000000-0000-0000-0000-0000000000d1',
   'Aluguel', -1000.00, date_trunc('month', CURRENT_DATE)::date + 1, 'expense'),
  ('caaaaaaa-0000-0000-0000-0000000000a0', '8730cd96-d656-4c48-863e-673e1016a832',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'c0000000-0000-0000-0000-0000000000d2',
   'Compra no cartao', -1000.00, date_trunc('month', CURRENT_DATE)::date + 2, 'expense');

SELECT pg_temp.expect_num('ponto de partida: conta corrente 5.000',
  (SELECT current_balance FROM public.financial_accounts
    WHERE id = 'c0000000-0000-0000-0000-0000000000d1'), 5000.00);

SELECT pg_temp.expect_num('ponto de partida: cartao -1.000',
  (SELECT current_balance FROM public.financial_accounts
    WHERE id = 'c0000000-0000-0000-0000-0000000000d2'), -1000.00);

SELECT pg_temp.expect_num('ponto de partida: patrimonio 4.000',
  (SELECT SUM(current_balance) FROM public.financial_accounts
    WHERE user_id = 'caaaaaaa-0000-0000-0000-0000000000a0'), 4000.00);

-- =====================================================
-- 1. A baixa ANTIGA reproduz o bug  (controle positivo)
-- =====================================================
-- Sem esta secao, o teste do conserto passaria num banco onde o bug nunca
-- existiu -- e nao provaria que o conserto conserta nada.
--
-- A fatura fechada: conta prevista com a chave canonica e account_id do
-- proprio cartao, exatamente como /api/card-invoices/close grava.
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, account_id, description, amount, due_date, status, notes)
VALUES
  ('c0000000-0000-0000-0000-0000000000f1', 'caaaaaaa-0000-0000-0000-0000000000a0',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'c0000000-0000-0000-0000-0000000000d2',
   'Fatura Cartao', 1000.00, CURRENT_DATE, 'pending',
   'fatura:' || to_char(date_trunc('month', CURRENT_DATE), 'YYYY-MM-DD')
     || ':c0000000-0000-0000-0000-0000000000d2');

-- A baixa velha: UMA transacao negativa no PROPRIO cartao.
WITH nova AS (
  INSERT INTO public.financial_transactions
    (user_id, service_id, category_id, account_id, description, amount,
     transaction_date, transaction_type, notes)
  VALUES
    ('caaaaaaa-0000-0000-0000-0000000000a0', '8730cd96-d656-4c48-863e-673e1016a832',
     'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'c0000000-0000-0000-0000-0000000000d2',
     'Fatura Cartao', -1000.00, CURRENT_DATE, 'expense',
     (SELECT notes FROM public.scheduled_transactions
       WHERE id = 'c0000000-0000-0000-0000-0000000000f1'))
  RETURNING id
)
UPDATE public.scheduled_transactions s
   SET status = 'paid', paid_date = CURRENT_DATE, transaction_id = nova.id
  FROM nova
 WHERE s.id = 'c0000000-0000-0000-0000-0000000000f1';

SELECT pg_temp.expect_num('bug reproduzido: cartao ficou -2.000',
  (SELECT current_balance FROM public.financial_accounts
    WHERE id = 'c0000000-0000-0000-0000-0000000000d2'), -2000.00);

SELECT pg_temp.expect_num('bug reproduzido: a conta de onde o dinheiro saiu nao se mexeu',
  (SELECT current_balance FROM public.financial_accounts
    WHERE id = 'c0000000-0000-0000-0000-0000000000d1'), 5000.00);

-- O numero do relato: 3.000 onde o certo e 4.000.
SELECT pg_temp.expect_num('bug reproduzido: patrimonio caiu para 3.000',
  (SELECT SUM(current_balance) FROM public.financial_accounts
    WHERE user_id = 'caaaaaaa-0000-0000-0000-0000000000a0'), 3000.00);

-- E a despesa contada duas vezes no fluxo de caixa: 1.000 da compra + 1.000
-- da fatura + 1.000 do aluguel = 3.000 num mes em que o usuario gastou 2.000.
SELECT pg_temp.expect_num('bug reproduzido: fluxo de caixa acusa 3.000 de despesa',
  (SELECT SUM(expense) FROM public.monthly_cash_flow
    WHERE user_id = 'caaaaaaa-0000-0000-0000-0000000000a0'
      AND month = date_trunc('month', CURRENT_DATE)::date), 3000.00);

-- =====================================================
-- 2. Casos que o reparo NAO pode tocar
-- =====================================================
-- (a) Assinatura cobrada no cartao, cadastrada como conta prevista com
--     account_id do cartao e JA PAGA. Pagar isso com o cartao e despesa de
--     verdade: e a compra. Um reparo que varresse por `account_type` apagaria
--     este lancamento e faria a despesa desaparecer do relatorio -- sem erro
--     nenhum, so um numero menor.
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, account_id, description, amount, due_date, status, notes)
VALUES
  ('c0000000-0000-0000-0000-0000000000f2', 'caaaaaaa-0000-0000-0000-0000000000a0',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'c0000000-0000-0000-0000-0000000000d2',
   'Netflix', 55.90, CURRENT_DATE, 'pending', 'assinatura do streaming');

WITH nova AS (
  INSERT INTO public.financial_transactions
    (user_id, service_id, category_id, account_id, description, amount,
     transaction_date, transaction_type, notes)
  VALUES
    ('caaaaaaa-0000-0000-0000-0000000000a0', '8730cd96-d656-4c48-863e-673e1016a832',
     'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'c0000000-0000-0000-0000-0000000000d2',
     'Netflix', -55.90, CURRENT_DATE, 'expense', 'assinatura do streaming')
  RETURNING id
)
UPDATE public.scheduled_transactions s
   SET status = 'paid', paid_date = CURRENT_DATE, transaction_id = nova.id
  FROM nova
 WHERE s.id = 'c0000000-0000-0000-0000-0000000000f2';

-- (b) Uma nota escrita a mao que PARECE a chave canonica, com texto colado no
--     fim. A regex e ancorada nas duas pontas nos dois lados (aqui e em
--     lib/card-invoice.ts) exatamente para que o texto livre do usuario nao
--     entre no reparo.
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, account_id, description, amount, due_date, status, notes)
VALUES
  ('c0000000-0000-0000-0000-0000000000f3', 'caaaaaaa-0000-0000-0000-0000000000a0',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'c0000000-0000-0000-0000-0000000000d2',
   'Anuidade', 300.00, CURRENT_DATE, 'pending',
   'fatura:' || to_char(date_trunc('month', CURRENT_DATE), 'YYYY-MM-DD')
     || ':c0000000-0000-0000-0000-0000000000d2 paguei no debito');

WITH nova AS (
  INSERT INTO public.financial_transactions
    (user_id, service_id, category_id, account_id, description, amount,
     transaction_date, transaction_type)
  VALUES
    ('caaaaaaa-0000-0000-0000-0000000000a0', '8730cd96-d656-4c48-863e-673e1016a832',
     'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'c0000000-0000-0000-0000-0000000000d2',
     'Anuidade', -300.00, CURRENT_DATE, 'expense')
  RETURNING id
)
UPDATE public.scheduled_transactions s
   SET status = 'paid', paid_date = CURRENT_DATE, transaction_id = nova.id
  FROM nova
 WHERE s.id = 'c0000000-0000-0000-0000-0000000000f3';

-- =====================================================
-- 3. O reparo
-- =====================================================
SELECT pg_temp.expect('o reparo desfez exatamente UMA baixa',
  public.reparar_pagamentos_de_fatura()::bigint, 1::bigint);

-- Os 1.000 da fatura voltaram para o cartao. O saldo esperado nao e -1.000
-- porque a assinatura e a anuidade dos controles negativos (secao 2) tambem
-- estao no cartao e continuam la -- e justamente isso que se quer.
SELECT pg_temp.expect_num('reparado: o cartao recuperou os 1.000 da fatura (compra + os dois controles)',
  (SELECT current_balance FROM public.financial_accounts
    WHERE id = 'c0000000-0000-0000-0000-0000000000d2'), -1000.00 - 55.90 - 300.00);

SELECT pg_temp.expect_text('reparado: a fatura voltou para pending',
  (SELECT status::text FROM public.scheduled_transactions
    WHERE id = 'c0000000-0000-0000-0000-0000000000f1'), 'pending');

SELECT pg_temp.expect_null('reparado: paid_date saiu junto',
  (SELECT paid_date::text FROM public.scheduled_transactions
    WHERE id = 'c0000000-0000-0000-0000-0000000000f1'));

SELECT pg_temp.expect_null('reparado: transaction_id saiu junto',
  (SELECT transaction_id::text FROM public.scheduled_transactions
    WHERE id = 'c0000000-0000-0000-0000-0000000000f1'));

SELECT pg_temp.expect('reparado: a transacao da fatura nao existe mais',
  (SELECT COUNT(*) FROM public.financial_transactions
    WHERE user_id = 'caaaaaaa-0000-0000-0000-0000000000a0'
      AND description = 'Fatura Cartao'), 0::bigint);

-- O que NAO foi tocado. Estas duas assercoes valem mais que as de cima: elas
-- provam que o reparo nao e um "apague as despesas do cartao".
SELECT pg_temp.expect_text('intocada: a assinatura do cartao continua paga',
  (SELECT status::text FROM public.scheduled_transactions
    WHERE id = 'c0000000-0000-0000-0000-0000000000f2'), 'paid');

SELECT pg_temp.expect('intocada: o lancamento da assinatura continua la',
  (SELECT COUNT(*) FROM public.financial_transactions
    WHERE user_id = 'caaaaaaa-0000-0000-0000-0000000000a0'
      AND description = 'Netflix'), 1::bigint);

SELECT pg_temp.expect_text('intocada: a nota que so PARECE chave canonica continua paga',
  (SELECT status::text FROM public.scheduled_transactions
    WHERE id = 'c0000000-0000-0000-0000-0000000000f3'), 'paid');

-- Idempotente: a segunda passada nao acha mais nada.
SELECT pg_temp.expect('o reparo e idempotente: a segunda passada repara 0',
  public.reparar_pagamentos_de_fatura()::bigint, 0::bigint);

-- =====================================================
-- 4. O pagamento NOVO: duas pernas 'transfer'
-- =====================================================
-- E o que a rota de baixa grava depois do conserto. Escrito aqui na mao porque
-- o SQL nao chama a rota; o que importa provar e o efeito no saldo e nas
-- views, que e justamente o que o teste de TypeScript nao alcanca.
--
-- Para isolar os numeros, primeiro desfazemos os dois lancamentos que existem
-- so como controle negativo do reparo (assinatura e anuidade). O que sobra e a
-- reproducao limpa: corrente 5.000, cartao -1.000.
UPDATE public.scheduled_transactions
   SET status = 'pending', paid_date = NULL, transaction_id = NULL
 WHERE id IN ('c0000000-0000-0000-0000-0000000000f2',
              'c0000000-0000-0000-0000-0000000000f3');

DELETE FROM public.financial_transactions
 WHERE user_id = 'caaaaaaa-0000-0000-0000-0000000000a0'
   AND description IN ('Netflix', 'Anuidade');

SELECT pg_temp.expect_num('limpo: cartao -1.000 de novo',
  (SELECT current_balance FROM public.financial_accounts
    WHERE id = 'c0000000-0000-0000-0000-0000000000d2'), -1000.00);

WITH saida AS (
  INSERT INTO public.financial_transactions
    (user_id, service_id, category_id, account_id, description, amount,
     transaction_date, transaction_type, notes)
  VALUES
    ('caaaaaaa-0000-0000-0000-0000000000a0', '8730cd96-d656-4c48-863e-673e1016a832',
     'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'c0000000-0000-0000-0000-0000000000d1',
     'Fatura Cartao', -1000.00, CURRENT_DATE, 'transfer',
     (SELECT notes FROM public.scheduled_transactions
       WHERE id = 'c0000000-0000-0000-0000-0000000000f1'))
  RETURNING id
), entrada AS (
  INSERT INTO public.financial_transactions
    (user_id, service_id, category_id, account_id, description, amount,
     transaction_date, transaction_type, counterpart_transaction_id)
  SELECT
    'caaaaaaa-0000-0000-0000-0000000000a0', '8730cd96-d656-4c48-863e-673e1016a832',
    'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'c0000000-0000-0000-0000-0000000000d2',
    'Pagamento — Fatura Cartao', 1000.00, CURRENT_DATE, 'transfer', saida.id
  FROM saida
  RETURNING id
)
UPDATE public.scheduled_transactions s
   SET status = 'paid', paid_date = CURRENT_DATE,
       transaction_id = (SELECT id FROM saida)
  FROM entrada
 WHERE s.id = 'c0000000-0000-0000-0000-0000000000f1';

-- O coracao do conserto.
SELECT pg_temp.expect_num('pago: o dinheiro saiu da conta corrente (4.000)',
  (SELECT current_balance FROM public.financial_accounts
    WHERE id = 'c0000000-0000-0000-0000-0000000000d1'), 4000.00);

SELECT pg_temp.expect_num('pago: o cartao foi quitado (0)',
  (SELECT current_balance FROM public.financial_accounts
    WHERE id = 'c0000000-0000-0000-0000-0000000000d2'), 0.00);

SELECT pg_temp.expect_num('pago: o patrimonio e o MESMO de antes do pagamento (4.000)',
  (SELECT SUM(current_balance) FROM public.financial_accounts
    WHERE user_id = 'caaaaaaa-0000-0000-0000-0000000000a0'), 4000.00);

-- A despesa continua contada UMA vez: 1.000 do aluguel + 1.000 da compra.
SELECT pg_temp.expect_num('pago: o fluxo de caixa volta a 2.000 de despesa',
  (SELECT SUM(expense) FROM public.monthly_cash_flow
    WHERE user_id = 'caaaaaaa-0000-0000-0000-0000000000a0'
      AND month = date_trunc('month', CURRENT_DATE)::date), 2000.00);

-- A perna de entrada nao pode virar linha de fatura: se virasse, abateria o
-- total da fatura SEGUINTE e o usuario pagaria 1.000 a menos do que deve.
SELECT pg_temp.expect('pago: a quitacao nao aparece como linha de fatura',
  (SELECT COUNT(*) FROM public.card_invoice_lines
    WHERE user_id = 'caaaaaaa-0000-0000-0000-0000000000a0'
      AND account_id = 'c0000000-0000-0000-0000-0000000000d2'), 1::bigint);

SELECT pg_temp.expect_num('pago: a fatura do mes continua valendo 1.000',
  (SELECT SUM(invoice_amount) FROM public.card_invoice_lines
    WHERE user_id = 'caaaaaaa-0000-0000-0000-0000000000a0'
      AND account_id = 'c0000000-0000-0000-0000-0000000000d2'), 1000.00);

-- net_worth_history soma QUALQUER tipo (espelha o trigger), e e por isso que
-- as duas pernas tem que se anular la. A variacao do mes tem que ser a soma
-- das despesas reais, sem o pagamento: -2.000.
SELECT pg_temp.expect_num('pago: a variacao do mes no patrimonio ignora a transferencia',
  (SELECT net_change FROM public.net_worth_history
    WHERE user_id = 'caaaaaaa-0000-0000-0000-0000000000a0'
      AND month = date_trunc('month', CURRENT_DATE)::date), -2000.00);

-- E o reparo nao pode achar esta baixa: ela e correta.
SELECT pg_temp.expect('o reparo nao toca no pagamento novo',
  public.reparar_pagamentos_de_fatura()::bigint, 0::bigint);

-- =====================================================
-- 5. O elo entre as pernas
-- =====================================================
SELECT pg_temp.expect('a perna de entrada aponta para a de saida',
  (SELECT COUNT(*) FROM public.financial_transactions e
    JOIN public.financial_transactions s ON s.id = e.counterpart_transaction_id
   WHERE e.user_id = 'caaaaaaa-0000-0000-0000-0000000000a0'
     AND e.account_id = 'c0000000-0000-0000-0000-0000000000d2'
     AND s.account_id = 'c0000000-0000-0000-0000-0000000000d1'), 1::bigint);

-- Auto-referencia: passaria por par valido e o estorno apagaria uma perna so,
-- deixando metade da transferencia no saldo.
DO $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.financial_transactions
   WHERE user_id = 'caaaaaaa-0000-0000-0000-0000000000a0'
     AND transaction_type = 'transfer' LIMIT 1;

  BEGIN
    UPDATE public.financial_transactions SET counterpart_transaction_id = v_id WHERE id = v_id;
    RAISE EXCEPTION 'FALHA: o CHECK aceitou a perna apontando para si mesma';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: o CHECK recusa a perna apontando para si mesma';
  END;

  BEGIN
    UPDATE public.financial_transactions
       SET counterpart_transaction_id = '00000000-0000-0000-0000-00000000dead'
     WHERE id = v_id;
    RAISE EXCEPTION 'FALHA: o FK aceitou uma perna oposta inexistente';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'ok: o FK recusa uma perna oposta inexistente';
  END;
END $$;

-- =====================================================
-- 6. A funcao de reparo nao e RPC do app
-- =====================================================
-- Ela escreve em dinheiro. Com o EXECUTE default (PUBLIC) ela apareceria em
-- /rest/v1/rpc/reparar_pagamentos_de_fatura para qualquer usuario logado.
SELECT pg_temp.expect('authenticated nao executa o reparo',
  (SELECT COUNT(*) FROM (SELECT 1 WHERE has_function_privilege(
     'authenticated', 'public.reparar_pagamentos_de_fatura()', 'EXECUTE')) x), 0::bigint);

SELECT pg_temp.expect('anon nao executa o reparo',
  (SELECT COUNT(*) FROM (SELECT 1 WHERE has_function_privilege(
     'anon', 'public.reparar_pagamentos_de_fatura()', 'EXECUTE')) x), 0::bigint);

ROLLBACK;
