-- =====================================================
-- Teste da trava de repontamento de divisao (025)
-- =====================================================
-- A HMO-130 descreve leitura do valor de uma despesa ALHEIA: o participante da
-- uma divisao reaponta `transaction_id` para o UUID de uma despesa que nao e
-- dele, poe `percentage = 100`, e o BEFORE trigger `calculate_split_amount` --
-- SECURITY DEFINER desde o 004, e precisa ser -- devolve em `amount` o total
-- daquela despesa, que ele le de volta pela policy de SELECT da propria linha.
--
-- Este arquivo responde, como `authenticated` de verdade (rodar so como
-- `postgres` faria tudo passar por bypass de RLS, que e o defeito classico
-- desta casa):
--
--   1. o valor da despesa alheia e mesmo segredo para o participante? (sem
--      isto, "ele leu 777,77" nao prova vazamento -- ele poderia ja poder ler)
--   2. CONTROLE POSITIVO: sem o trigger do 025, o ataque funciona e devolve o
--      numero exato? Se esta secao passasse mesmo sem vazamento, o teste
--      inteiro seria decorativo -- ele estaria provando que um ataque
--      impossivel continua impossivel. Ela roda com o trigger DERRUBADO dentro
--      da transacao, e exige o valor no centavo;
--   3. com o trigger de volta, o mesmo UPDATE e RECUSADO;
--   4. o participante tambem nao mexe na propria `percentage` -- que vaza
--      sozinho, sem repontar, porque numa divisao 1-para-1 ele nao enxerga a
--      transacao e `percentage = 100` lhe entrega o total;
--   5. e a trava nao pegou o fluxo real: aprovar e rejeitar, que e o que a
--      rota `app/api/personal-finance/splits/route.ts` escreve, continuam
--      passando. Uma trava que tranca o vazamento e o produto junto nao serve;
--   6. o dono CONTINUA podendo remanejar a porcentagem, e o `amount` recalcula;
--   7. nem o dono reaponta a divisao para outra despesa;
--   8. `amount` escrito a mao e descartado -- e derivado, nao ha o que travar.
--
-- Rodar depois de 001 -> ... -> 025:
--   psql "$DB_URL" -f database/tests/025_travar_repontamento_de_divisao_test.sql
--
-- Qualquer FALHA lanca excecao e aborta.
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect(label TEXT, got TEXT, want TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- =====================================================
-- Fixture: A e dono, B e participante
-- =====================================================
INSERT INTO auth.users (id, email) VALUES
  ('e1e1e1e1-0000-0000-0000-00000000000a', 'dono@split.local'),
  ('e1e1e1e1-0000-0000-0000-00000000000b', 'parte@split.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('e1e1e1e1-0000-0000-0000-00000000000a', 'Usuario A', FALSE),
  ('e1e1e1e1-0000-0000-0000-00000000000b', 'Usuario B', FALSE);

INSERT INTO public.financial_accounts (id, user_id, name, account_type) VALUES
  ('e1000000-0000-0000-0000-0000000000a1', 'e1e1e1e1-0000-0000-0000-00000000000a',
   'Conta do A', 'checking');

-- Duas despesas do A. A primeira e dividida com o B -- entao o B conhece a
-- PARTE dele. A segunda nunca e dividida com ninguem: e o alvo do ataque, e o
-- valor dela e o segredo que o teste persegue. 777,77 e um numero que nao
-- aparece em nenhum outro lugar do fixture, para que encontra-lo em `amount`
-- so possa ter vindo dali.
--
-- Valor NEGATIVO: despesa e gravada negativa neste schema, e o
-- `calculate_split_amount` usa ABS(). Fixture positiva passaria verde
-- escondendo um erro de sinal.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, amount, transaction_date, description) VALUES
  ('e1000000-0000-0000-0000-0000000000d1', 'e1e1e1e1-0000-0000-0000-00000000000a',
   'e1000000-0000-0000-0000-0000000000a1', '8730cd96-d656-4c48-863e-673e1016a832',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', -100.00, '2026-01-01', 'Jantar dividido'),
  ('e1000000-0000-0000-0000-0000000000d2', 'e1e1e1e1-0000-0000-0000-00000000000a',
   'e1000000-0000-0000-0000-0000000000a1', '8730cd96-d656-4c48-863e-673e1016a832',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', -777.77, '2026-01-02', 'Despesa que o B nao pode ver');

-- A divisao do B na primeira despesa: 30%. O `calculate_split_amount` escreve
-- o `amount` sozinho, no BEFORE INSERT.
INSERT INTO public.expense_splits
  (id, transaction_id, participant_id, percentage, amount, status) VALUES
  ('e1000000-0000-0000-0000-0000000000f1', 'e1000000-0000-0000-0000-0000000000d1',
   'e1e1e1e1-0000-0000-0000-00000000000b', 30.00, 0, 'pending');

SELECT pg_temp.expect(
  'o trigger de divisao calculou a parte do B',
  (SELECT amount::TEXT FROM public.expense_splits
   WHERE id = 'e1000000-0000-0000-0000-0000000000f1'),
  '30.00');

-- =====================================================
-- 1. O valor da despesa alvo e segredo para o B
-- =====================================================
-- Sem esta secao, "o B leu 777,77" nao provaria nada: se ele ja pudesse ler a
-- transacao, o vazamento pelo `amount` seria irrelevante.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'e1e1e1e1-0000-0000-0000-00000000000b';

SELECT pg_temp.expect(
  'B nao enxerga a despesa alvo do A',
  (SELECT count(*)::TEXT FROM public.financial_transactions
   WHERE id = 'e1000000-0000-0000-0000-0000000000d2'),
  '0');

SELECT pg_temp.expect(
  'B enxerga a propria divisao',
  (SELECT count(*)::TEXT FROM public.expense_splits
   WHERE id = 'e1000000-0000-0000-0000-0000000000f1'),
  '1');

RESET ROLE;
-- O claim sobrevive ao RESET ROLE: limpar aqui, senao a proxima secao roda sob
-- a identidade do B sem dizer que roda.
SET LOCAL request.jwt.claim.sub = '';

-- =====================================================
-- 2. CONTROLE POSITIVO: sem o trigger, o ataque funciona
-- =====================================================
-- DDL e transacional no Postgres, entao da para derrubar o trigger, provar que
-- o buraco e real, e recria-lo -- tudo dentro da transacao que termina em
-- ROLLBACK. Sem esta secao o teste nao distingue "a trava funciona" de "nunca
-- houve o que travar", e as duas coisas saem verdes.
DROP TRIGGER trg_expense_splits_guard ON public.expense_splits;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'e1e1e1e1-0000-0000-0000-00000000000b';

UPDATE public.expense_splits
   SET transaction_id = 'e1000000-0000-0000-0000-0000000000d2',
       percentage     = 100.00
 WHERE id = 'e1000000-0000-0000-0000-0000000000f1';

SELECT pg_temp.expect(
  'SEM a trava, o B le o valor da despesa alheia',
  (SELECT amount::TEXT FROM public.expense_splits
   WHERE id = 'e1000000-0000-0000-0000-0000000000f1'),
  '777.77');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

-- Desfaz o estrago e repoe a trava, para as secoes seguintes rodarem no banco
-- que a 025 realmente produz.
UPDATE public.expense_splits
   SET transaction_id = 'e1000000-0000-0000-0000-0000000000d1',
       percentage     = 30.00
 WHERE id = 'e1000000-0000-0000-0000-0000000000f1';

CREATE TRIGGER trg_expense_splits_guard
  BEFORE UPDATE ON public.expense_splits
  FOR EACH ROW EXECUTE FUNCTION public.expense_splits_guard();

SELECT pg_temp.expect(
  'a divisao voltou ao estado original',
  (SELECT percentage::TEXT || '/' || amount::TEXT FROM public.expense_splits
   WHERE id = 'e1000000-0000-0000-0000-0000000000f1'),
  '30.00/30.00');

-- =====================================================
-- 3. COM a trava, o mesmo UPDATE e recusado
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'e1e1e1e1-0000-0000-0000-00000000000b';

DO $$
BEGIN
  UPDATE public.expense_splits
     SET transaction_id = 'e1000000-0000-0000-0000-0000000000d2',
         percentage     = 100.00
   WHERE id = 'e1000000-0000-0000-0000-0000000000f1';
  RAISE EXCEPTION 'FALHA: B repontou a divisao para a despesa do A';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: B bloqueado ao repontar transaction_id';
END $$;

-- Repontar sem mexer na porcentagem tambem nao vale: o alvo poderia ser uma
-- despesa de valor parecido, e 30% dela ja e informacao.
DO $$
BEGIN
  UPDATE public.expense_splits
     SET transaction_id = 'e1000000-0000-0000-0000-0000000000d2'
   WHERE id = 'e1000000-0000-0000-0000-0000000000f1';
  RAISE EXCEPTION 'FALHA: B repontou a divisao mantendo a porcentagem';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: B bloqueado ao repontar sem mexer na porcentagem';
END $$;

-- =====================================================
-- 4. O participante nao mexe na propria porcentagem
-- =====================================================
-- Este e o vazamento que NAO precisa de repontamento: o B nao enxerga a
-- transacao (secao 1), so conhece a parte dele. Subir para 100% faria o
-- trigger devolver o total da despesa do A.
DO $$
BEGIN
  UPDATE public.expense_splits
     SET percentage = 100.00
   WHERE id = 'e1000000-0000-0000-0000-0000000000f1';
  RAISE EXCEPTION 'FALHA: B mudou a propria porcentagem e leria o total do A';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: B bloqueado ao mudar a propria porcentagem';
END $$;

-- Reduzir tambem nao: "so para baixo" seria uma trava pela metade, e pagar
-- menos do que se deve e o lado do abuso que nao vaza nada e custa dinheiro.
DO $$
BEGIN
  UPDATE public.expense_splits
     SET percentage = 1.00
   WHERE id = 'e1000000-0000-0000-0000-0000000000f1';
  RAISE EXCEPTION 'FALHA: B reduziu a propria porcentagem';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: B bloqueado ao reduzir a propria porcentagem';
END $$;

SELECT pg_temp.expect(
  'depois das tentativas, a divisao do B esta intacta',
  (SELECT percentage::TEXT || '/' || amount::TEXT FROM public.expense_splits
   WHERE id = 'e1000000-0000-0000-0000-0000000000f1'),
  '30.00/30.00');

-- =====================================================
-- 5. O fluxo real da rota continua passando
-- =====================================================
-- `splits/route.ts` escreve status, approved_at, rejection_reason e
-- updated_at. Se a trava pegasse aqui, ela teria trocado um vazamento de baixa
-- gravidade por aprovar divisao quebrado -- que e exatamente a HMO-125 de novo.
UPDATE public.expense_splits
   SET status      = 'approved',
       approved_at = now(),
       updated_at  = now()
 WHERE id = 'e1000000-0000-0000-0000-0000000000f1';

SELECT pg_temp.expect(
  'B aprova a propria divisao, como a rota faz',
  (SELECT status FROM public.expense_splits
   WHERE id = 'e1000000-0000-0000-0000-0000000000f1'),
  'approved');

UPDATE public.expense_splits
   SET status           = 'rejected',
       rejection_reason = 'nao participei desse jantar',
       updated_at       = now()
 WHERE id = 'e1000000-0000-0000-0000-0000000000f1';

SELECT pg_temp.expect(
  'B rejeita com motivo, como a rota faz',
  (SELECT status || '/' || rejection_reason FROM public.expense_splits
   WHERE id = 'e1000000-0000-0000-0000-0000000000f1'),
  'rejected/nao participei desse jantar');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

-- =====================================================
-- 6. O dono remaneja a porcentagem, e o valor recalcula
-- =====================================================
-- A trava e sobre QUEM, nao sobre A COLUNA: quem e dono da despesa continua
-- mandando na divisao dela. Sem esta secao, congelar `percentage` para todo
-- mundo passaria no teste e tiraria do dono um poder que ele tem.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'e1e1e1e1-0000-0000-0000-00000000000a';

UPDATE public.expense_splits
   SET percentage = 50.00
 WHERE id = 'e1000000-0000-0000-0000-0000000000f1';

SELECT pg_temp.expect(
  'o dono muda para 50% e o amount recalcula sobre os 100 reais',
  (SELECT percentage::TEXT || '/' || amount::TEXT FROM public.expense_splits
   WHERE id = 'e1000000-0000-0000-0000-0000000000f1'),
  '50.00/50.00');

-- =====================================================
-- 7. Nem o dono reaponta a divisao para outra despesa
-- =====================================================
-- As duas despesas sao DO MESMO dono aqui, entao nao ha segredo em jogo: o que
-- a trava recusa e trocar o fato gerador de um saldo ja lancado.
DO $$
BEGIN
  UPDATE public.expense_splits
     SET transaction_id = 'e1000000-0000-0000-0000-0000000000d2'
   WHERE id = 'e1000000-0000-0000-0000-0000000000f1';
  RAISE EXCEPTION 'FALHA: o dono repontou a divisao para outra despesa';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: nem o dono reaponta transaction_id';
END $$;

-- =====================================================
-- 8. `amount` e derivado: escrever a mao nao adianta
-- =====================================================
-- O 025 nao congela `amount` de proposito. Esta secao e a prova de que nao
-- precisa: `calculate_split_amount` reescreve a coluna em toda passada. Se um
-- dia ele deixar de fazer isso, o participante passa a poder baixar a propria
-- divida na mao -- e este teste e quem avisa.
RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'e1e1e1e1-0000-0000-0000-00000000000b';

UPDATE public.expense_splits
   SET amount = 0.01
 WHERE id = 'e1000000-0000-0000-0000-0000000000f1';

SELECT pg_temp.expect(
  'o amount escrito a mao pelo B foi descartado pelo recalculo',
  (SELECT amount::TEXT FROM public.expense_splits
   WHERE id = 'e1000000-0000-0000-0000-0000000000f1'),
  '50.00');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

-- =====================================================
-- 9. A trava nao alcanca o backend
-- =====================================================
-- `auth.uid() IS NULL` passa direto, de proposito: service_role, cron e psql
-- precisam poder corrigir divisao. Sem esta secao, um backfill futuro morreria
-- com um erro que ninguem liga a este arquivo.
UPDATE public.expense_splits
   SET percentage = 40.00
 WHERE id = 'e1000000-0000-0000-0000-0000000000f1';

SELECT pg_temp.expect(
  'sem auth.uid(), o backend remaneja a divisao',
  (SELECT percentage::TEXT || '/' || amount::TEXT FROM public.expense_splits
   WHERE id = 'e1000000-0000-0000-0000-0000000000f1'),
  '40.00/40.00');

ROLLBACK;
