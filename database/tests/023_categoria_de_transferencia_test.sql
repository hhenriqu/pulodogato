-- =====================================================
-- Teste da categoria reservada de transferencia (023)
-- =====================================================
-- A HMO-164 passou por todo o CI com a transferencia 100% quebrada em
-- producao. Os testes dela eram sobre `pernasDaTransferencia`, funcao pura:
-- ela devolvia as duas pernas certas, e continua devolvendo. O defeito estava
-- na PERMISSAO de `transaction_categories` -- tabela que nenhum teste de
-- unidade toca -- e so aparece quando alguem tenta gravar de verdade.
--
-- Este arquivo e o oraculo que faltava. Ele responde, como `authenticated`:
--
--   1. a categoria reservada existe, uma so, e esta desativada?
--   2. quem esta logado CONSEGUE le-la? (era isso que faltava: a policy
--      antiga e `USING (is_active = TRUE)`, e a linha nasce FALSE)
--   3. a policy nova e ESTREITA -- outra categoria desativada continua
--      invisivel? (controle: sem ele, "consigo ler" tambem passaria com uma
--      policy que expusesse toda a tabela)
--   4. `authenticated` continua SEM poder escrever na tabela? (foi a tentativa
--      de escrever ali que virou o 500; abrir a escrita seria o conserto
--      errado, e este teste recusa esse conserto)
--   5. com a categoria em maos, as duas pernas de uma transferencia de verdade
--      entram -- que e o unico enunciado que o usuario percebe.
--
-- Rodar depois de 001 -> ... -> 023:
--   psql "$DB_URL" -f database/tests/023_categoria_de_transferencia_test.sql
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

-- =====================================================
-- Fixture
-- =====================================================
INSERT INTO auth.users (id, email) VALUES
  ('d1d1d1d1-0000-0000-0000-000000000001', 'a@transf.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('d1d1d1d1-0000-0000-0000-000000000001', 'Usuario A', FALSE);

INSERT INTO public.financial_accounts (id, user_id, name, account_type) VALUES
  ('d1000000-0000-0000-0000-0000000000a1', 'd1d1d1d1-0000-0000-0000-000000000001',
   'Conta Corrente', 'checking'),
  ('d1000000-0000-0000-0000-0000000000a2', 'd1d1d1d1-0000-0000-0000-000000000001',
   'PIX', 'digital');

-- O CONTROLE da pergunta 3: uma segunda categoria desativada, com outro nome.
-- Se a policy nova fosse larga ("inativa e legivel"), esta linha apareceria
-- junto -- e a leitura da reservada deixaria de provar qualquer coisa.
INSERT INTO public.transaction_categories
  (id, service_id, name, description, is_expense, is_active)
VALUES
  ('d1000000-0000-0000-0000-0000000000c9', '8730cd96-d656-4c48-863e-673e1016a832',
   'Categoria aposentada', 'Desativada, e para continuar invisivel', TRUE, FALSE);

-- =====================================================
-- 1. A linha de seed
-- =====================================================
SELECT pg_temp.expect('a categoria reservada existe uma unica vez',
  (SELECT count(*) FROM public.transaction_categories
    WHERE service_id = '8730cd96-d656-4c48-863e-673e1016a832'
      AND name = 'Transferência entre contas'), 1);

SELECT pg_temp.expect('e ela nasce desativada (fora dos seletores)',
  (SELECT count(*) FROM public.transaction_categories
    WHERE name = 'Transferência entre contas' AND is_active = FALSE), 1);

-- =====================================================
-- 2, 3 e 4: como `authenticated`
-- =====================================================
-- `SET LOCAL` so vale DENTRO de transacao -- fora dela o Postgres apenas avisa
-- e nada e aplicado, e o teste sairia verde lendo como superusuario.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'd1d1d1d1-0000-0000-0000-000000000001';

-- O enunciado exato que estava falso em producao: a rota procura por
-- (service_id, name) e tem que achar.
SELECT pg_temp.expect('logado LE a categoria reservada',
  (SELECT count(*) FROM public.transaction_categories
    WHERE service_id = '8730cd96-d656-4c48-863e-673e1016a832'
      AND name = 'Transferência entre contas'), 1);

SELECT pg_temp.expect('a policy e estreita: outra inativa continua invisivel',
  (SELECT count(*) FROM public.transaction_categories
    WHERE name = 'Categoria aposentada'), 0);

SELECT pg_temp.expect('as ativas continuam todas visiveis',
  (SELECT count(*) FROM public.transaction_categories WHERE is_active = TRUE), 12);

-- A tabela e global: uma escrita ali apareceria para todo mundo. O 500 nasceu
-- de tentar exatamente isto, e o conserto NAO foi abrir a porta.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.transaction_categories
      (service_id, name, is_expense, is_active)
    VALUES ('8730cd96-d656-4c48-863e-673e1016a832', 'Categoria pirata', TRUE, TRUE);
    RAISE EXCEPTION 'FALHA: usuario logado escreveu na tabela de categorias';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: escrita em transaction_categories recusada';
  END;
END $$;

-- =====================================================
-- 5. As duas pernas, com a categoria que ele agora enxerga
-- =====================================================
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type)
VALUES
  ('d1000000-0000-0000-0000-0000000000f1',
   'd1d1d1d1-0000-0000-0000-000000000001',
   '8730cd96-d656-4c48-863e-673e1016a832',
   (SELECT id FROM public.transaction_categories
     WHERE name = 'Transferência entre contas'),
   'd1000000-0000-0000-0000-0000000000a1', 'Transferencia', -100.00,
   CURRENT_DATE, 'transfer');

INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type, counterpart_transaction_id)
VALUES
  ('d1000000-0000-0000-0000-0000000000f2',
   'd1d1d1d1-0000-0000-0000-000000000001',
   '8730cd96-d656-4c48-863e-673e1016a832',
   (SELECT id FROM public.transaction_categories
     WHERE name = 'Transferência entre contas'),
   'd1000000-0000-0000-0000-0000000000a2', 'Transferencia', 100.00,
   CURRENT_DATE, 'transfer', 'd1000000-0000-0000-0000-0000000000f1');

SELECT pg_temp.expect('as duas pernas entraram',
  (SELECT count(*) FROM public.financial_transactions
    WHERE transaction_type = 'transfer'), 2);

RESET ROLE;

-- O dinheiro andou: saiu de uma conta e entrou na outra, sem criar nem
-- destruir nada. Os saldos sao derivados por trigger (001_baseline), entao
-- esta assercao tambem cobre a soma, e nao so a existencia das linhas.
SELECT pg_temp.expect('saiu 100 da origem (centavos)',
  (SELECT (current_balance * 100)::BIGINT FROM public.financial_accounts
    WHERE id = 'd1000000-0000-0000-0000-0000000000a1'), -10000::BIGINT);

SELECT pg_temp.expect('entrou 100 no destino (centavos)',
  (SELECT (current_balance * 100)::BIGINT FROM public.financial_accounts
    WHERE id = 'd1000000-0000-0000-0000-0000000000a2'), 10000::BIGINT);

ROLLBACK;
