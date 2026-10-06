-- =====================================================
-- HMO-253: o ajuste de saldo da fatura do cartao
-- =====================================================
-- A feature nao tem migration: o ajuste e um lancamento comum em
-- `financial_transactions`, e a categoria reservada e criada pela propria rota
-- usando o `user_id` que a 036 acrescentou a `transaction_categories`.
--
-- E JUSTAMENTE POR NAO TER MIGRATION QUE ESTE TESTE EXISTE. Tudo o que faz o
-- ajuste funcionar e comportamento de coisas que JA estao no banco, e nenhuma
-- delas esta escrita na feature:
--
--   - `card_invoice_month(date, closing_day)` mapeando o dia 1 para a fatura do
--     PROPRIO mes, para qualquer `closing_day`. O codigo da feature escolhe o
--     dia 1 apoiado nesse mapeamento e nao o reimplementa (a regra tem de ter
--     fonte unica). Se ele mudar, o ajuste de outubro passa a somar na fatura de
--     novembro -- com o valor certo, as duas faturas plausiveis, e nada vermelho
--     em nenhum teste de TypeScript, que nao tem como medir aritmetica do
--     Postgres sem repeti-la (e duas copias erradas concordam);
--
--   - `(-t.amount) AS invoice_amount` na view. A inversao do sinal e a unica
--     coisa que faz um `amount` negativo AUMENTAR a fatura. Uma mudanca ali
--     inverte todo ajuste do app;
--
--   - as policies da 036, que permitem a uma sessao `authenticated` criar a
--     categoria reservada no proprio nome. Sem elas a rota volta 42501 e nenhum
--     ajuste jamais e gravado -- que e exatamente o que aconteceu com a
--     transferencia na HMO-162, e passou por todo o CI porque os testes de lá
--     eram sobre funcao pura;
--
--   - `update_account_balance` no UPDATE, que estorna `OLD.amount` antes de
--     somar `NEW.amount` (007). A rota TROCA o ajuste em vez de criar outro, e
--     sem o estorno cada alteracao cobraria o valor de novo no saldo do cartao.
--
-- O que ele fixa, na ordem:
--
--   (1)  o dia 1 cai na fatura do PROPRIO mes para closing_day NULL, 1, 15, 28
--        e 31, em janeiro, fevereiro, outubro e dezembro;
--   (2)  CONTROLE POSITIVO do mapeamento: uma compra DEPOIS do fechamento cai no
--        mes seguinte. Sem isto, (1) passaria verde com
--        `card_invoice_month` virando `date_trunc('month', $1)` -- uma funcao
--        que ignora o fechamento acerta todo dia 1 e erra todo o resto;
--   (3)  o ajuste positivo na fatura AUMENTA SUM(invoice_amount) no exato valor;
--   (4)  o ajuste negativo ABATE -- e nao aumenta, que e o que `ABS` faria;
--   (5)  a sessao `authenticated` cria a categoria reservada no proprio nome;
--   (6)  CONTROLE NEGATIVO: um estranho autenticado NAO ve a categoria
--        reservada da outra pessoa;
--   (7)  ...e ve o catalogo na mesma consulta -- prova de que (6) nao e
--        "ninguem ve nada";
--   (8)  a categoria reservada fica fora do seletor: a consulta do catalogo
--        (`is_active = TRUE AND user_id IS NULL`) nao a traz nem para o dono;
--   (9)  o saldo do cartao anda com o ajuste, e TROCAR o ajuste nao cobra duas
--        vezes;
--   (10) remover o ajuste devolve a fatura ao total de antes E devolve o saldo;
--   (11) o ajuste de UM cartao nao aparece na fatura de OUTRO cartao do mesmo
--        dono.
--
-- Rodar num banco limpo, depois das migrations ate a ultima:
--   psql "$DB_URL" -f database/tests/ajuste_de_fatura_test.sql
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

CREATE OR REPLACE FUNCTION pg_temp.expect_txt(label TEXT, got TEXT, want TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_date(label TEXT, got DATE, want DATE)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- ---------------------------------------------------------------------------
-- As sondas
-- ---------------------------------------------------------------------------

-- A chave canonica, escrita AQUI com o mesmo formato de `chaveAjuste` em
-- lib/ajuste-de-fatura.ts. As duas copias existem porque este teste nao executa
-- TypeScript; a assercao (10) e o que amarra as duas -- se o formato divergir, o
-- DELETE daqui nao acha a linha que o INSERT daqui gravou.
CREATE OR REPLACE FUNCTION pg_temp.chave_ajuste(p_mes DATE, p_cartao UUID)
RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT 'ajuste-de-fatura:' || to_char(p_mes, 'YYYY-MM-DD') || ':' || p_cartao::text;
$$;

-- O que a rota grava: o ajuste como lancamento, no dia 1 do mes da fatura.
--
-- `p_valor_na_fatura` e o valor COMO A FATURA O VE (positivo aumenta), e o
-- `-p_valor_na_fatura` abaixo e a mesma inversao que `lancamentoDoAjuste` faz.
-- Escrita aqui de proposito: e ela que a assercao (3)/(4) mede atraves da view.
CREATE OR REPLACE FUNCTION pg_temp.grava_ajuste(
  p_dono UUID, p_cartao UUID, p_categoria UUID, p_mes DATE, p_valor_na_fatura NUMERIC)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_servico UUID;
BEGIN
  SELECT id INTO v_servico FROM public.financial_services WHERE name = 'personal_finance';
  INSERT INTO public.financial_transactions
    (user_id, service_id, category_id, account_id, description, amount,
     transaction_date, transaction_type, notes)
  VALUES (p_dono, v_servico, p_categoria, p_cartao,
          'Ajuste de saldo da fatura', -p_valor_na_fatura,
          date_trunc('month', p_mes)::date,
          (CASE WHEN p_valor_na_fatura > 0 THEN 'expense' ELSE 'income' END)::public.transaction_financial_type,
          pg_temp.chave_ajuste(date_trunc('month', p_mes)::date, p_cartao));
  RETURN 'gravou';
EXCEPTION
  WHEN insufficient_privilege THEN RETURN 'ERRO:42501';
  WHEN check_violation        THEN RETURN 'ERRO:23514';
END $$;

-- O que o POST faz quando JA existe ajuste naquele mes: UPDATE pela chave.
CREATE OR REPLACE FUNCTION pg_temp.troca_ajuste(
  p_cartao UUID, p_mes DATE, p_valor_na_fatura NUMERIC)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE v_linhas BIGINT;
BEGIN
  UPDATE public.financial_transactions
     SET amount = -p_valor_na_fatura,
         transaction_type = (CASE WHEN p_valor_na_fatura > 0 THEN 'expense' ELSE 'income' END)::public.transaction_financial_type
   WHERE notes = pg_temp.chave_ajuste(date_trunc('month', p_mes)::date, p_cartao);
  GET DIAGNOSTICS v_linhas = ROW_COUNT;
  RETURN v_linhas;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.remove_ajuste(p_cartao UUID, p_mes DATE)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE v_linhas BIGINT;
BEGIN
  DELETE FROM public.financial_transactions
   WHERE notes = pg_temp.chave_ajuste(date_trunc('month', p_mes)::date, p_cartao);
  GET DIAGNOSTICS v_linhas = ROW_COUNT;
  RETURN v_linhas;
END $$;

/** O total da fatura daquele cartao naquele mes, pela VIEW -- nao por soma a mao. */
CREATE OR REPLACE FUNCTION pg_temp.total_da_fatura(p_cartao UUID, p_mes DATE)
RETURNS NUMERIC LANGUAGE SQL AS $$
  SELECT COALESCE(SUM(invoice_amount), 0)
    FROM public.card_invoice_lines
   WHERE account_id = p_cartao
     AND invoice_month = date_trunc('month', p_mes)::date;
$$;

CREATE OR REPLACE FUNCTION pg_temp.saldo(p_conta UUID)
RETURNS NUMERIC LANGUAGE SQL AS $$
  SELECT current_balance FROM public.financial_accounts WHERE id = p_conta;
$$;

CREATE OR REPLACE FUNCTION pg_temp.cria_categoria_reservada(p_dono UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_servico UUID;
BEGIN
  SELECT id INTO v_servico FROM public.financial_services WHERE name = 'personal_finance';
  INSERT INTO public.transaction_categories
    (service_id, user_id, name, description, icon, color_hex, is_expense, is_active)
  VALUES (v_servico, p_dono, 'Ajuste de fatura',
          'Reservada para o ajuste de saldo da fatura do cartão.',
          'scale', '#6B7280', TRUE, FALSE);
  RETURN 'criou';
EXCEPTION
  WHEN insufficient_privilege THEN RETURN 'ERRO:42501';
  WHEN unique_violation       THEN RETURN 'ERRO:23505';
  WHEN check_violation        THEN RETURN 'ERRO:23514';
END $$;

-- Quantas categorias com este nome a sessao corrente CONSEGUE LER. Uma sonda
-- unica para (6) e (7): e ela que faz "o estranho nao ve a minha" e "o estranho
-- ve o catalogo" serem a MESMA medicao com entradas diferentes -- sem isso, uma
-- policy `USING (FALSE)` passaria pelo controle negativo.
CREATE OR REPLACE FUNCTION pg_temp.categorias_visiveis(p_nome TEXT)
RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM public.transaction_categories WHERE name = p_nome;
$$;

-- O que `GET /api/personal-finance/categories` traz: o filtro do SELECT, nao so
-- a RLS. E ele que mantem a reservada fora do seletor.
CREATE OR REPLACE FUNCTION pg_temp.categorias_do_seletor(p_nome TEXT)
RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM public.transaction_categories
   WHERE name = p_nome AND is_active = TRUE;
$$;

-- =====================================================
-- (1) e (2) O MAPEAMENTO DA DATA -- a pedra em que a feature se apoia
-- =====================================================
-- Afirmado sobre a FUNCAO, e nao atraves de um lancamento, porque o que se mede
-- aqui e a regra: ela e `IMMUTABLE` e depende so dos argumentos. Fevereiro entra
-- porque e onde o `LEAST(closing_day, ultimo dia do mes)` da 006 importa -- com
-- fechamento dia 31 e sem o LEAST, NENHUMA compra de fevereiro fecharia.
DO $$
DECLARE
  v_mes   DATE;
  v_dia   INTEGER;
BEGIN
  FOREACH v_mes IN ARRAY ARRAY[
    DATE '2026-01-01', DATE '2026-02-01', DATE '2026-10-01', DATE '2026-12-01',
    DATE '2024-02-01'  -- ano bissexto
  ]
  LOOP
    FOREACH v_dia IN ARRAY ARRAY[1, 15, 28, 31]
    LOOP
      IF public.card_invoice_month(v_mes, v_dia) IS DISTINCT FROM v_mes THEN
        RAISE EXCEPTION
          'FALHA: dia 1 de % com fechamento dia % caiu na fatura de % -- o ajuste iria para o mes errado',
          v_mes, v_dia, public.card_invoice_month(v_mes, v_dia);
      END IF;
    END LOOP;

    -- Cartao sem fechamento configurado: a linha e da fatura do proprio mes.
    IF public.card_invoice_month(v_mes, NULL) IS DISTINCT FROM v_mes THEN
      RAISE EXCEPTION 'FALHA: dia 1 de % sem closing_day caiu em %',
        v_mes, public.card_invoice_month(v_mes, NULL);
    END IF;
  END LOOP;
  RAISE NOTICE 'ok: o dia 1 cai na fatura do proprio mes em 5 meses x 5 fechamentos';
END $$;

-- (2) CONTROLE POSITIVO. Sem ele, (1) continuaria verde se
-- `card_invoice_month` virasse `date_trunc('month', $1)`: uma funcao que ignora
-- o fechamento acerta TODO dia 1. A assercao de (1) seria vacua, e o ajuste
-- continuaria indo para o lugar certo por acidente -- enquanto toda COMPRA
-- depois do fechamento passaria a cair no mes errado.
SELECT pg_temp.expect_date('compra depois do fechamento cai no mes SEGUINTE',
  public.card_invoice_month(DATE '2026-10-20', 5), DATE '2026-11-01');

SELECT pg_temp.expect_date('compra no dia do fechamento ainda e do proprio mes',
  public.card_invoice_month(DATE '2026-10-05', 5), DATE '2026-10-01');

-- =====================================================
-- FIXTURE
-- =====================================================
-- DONA tem dois cartoes (para (11)) e um estranho divide o app com ela.
INSERT INTO auth.users (id, email) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'dona-ajuste@test.local'),
  ('a1000000-0000-0000-0000-000000000002', 'estranho-ajuste@test.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'Dona do Ajuste', TRUE),
  ('a1000000-0000-0000-0000-000000000002', 'Estranho',       TRUE);

INSERT INTO public.financial_accounts
  (id, user_id, name, account_type, current_balance, closing_day, due_day)
VALUES
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
   'Nubank', 'credit_card', 0.00, 5, 15),
  ('a2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001',
   'Visa', 'credit_card', 0.00, 20, 28);

-- A compra que forma a fatura de outubro: dia 3, fechamento dia 5, entao ela e
-- de outubro. R$ 200 de despesa -> R$ 200 na fatura.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type)
SELECT
  'a3000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
  (SELECT id FROM public.transaction_categories
    WHERE name = 'Alimentação' AND user_id IS NULL),
  'a2000000-0000-0000-0000-000000000001',
  'Mercado do mes', -200.00, DATE '2026-10-03', 'expense';

SELECT pg_temp.expect_num('a fatura de outubro comeca em R$ 200',
  pg_temp.total_da_fatura('a2000000-0000-0000-0000-000000000001', DATE '2026-10-01'),
  200.00);

-- =====================================================
-- (5) A SESSAO DO USUARIO CRIA A CATEGORIA RESERVADA
-- =====================================================
-- A assercao que a HMO-162 nao tinha. Lá o INSERT da categoria voltava 42501 em
-- 100% das chamadas e NENHUMA transferencia jamais foi gravada -- e o CI ficou
-- verde por semanas, porque os testes eram sobre funcao pura. Esta linha e o que
-- impede a mesma historia aqui: se as policies da 036 forem apertadas, o ajuste
-- para de existir e este teste fica vermelho.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a1000000-0000-0000-0000-000000000001';

SELECT pg_temp.expect_txt('a sessao da dona cria a categoria reservada no proprio nome',
  pg_temp.cria_categoria_reservada('a1000000-0000-0000-0000-000000000001'), 'criou');

SELECT pg_temp.expect('e a dona consegue LE-LA depois (a policy read_own nao filtra is_active)',
  pg_temp.categorias_visiveis('Ajuste de fatura'), 1);

-- (8) ...e ela NAO entra no seletor. O filtro `is_active = TRUE` da rota de
-- categorias e o que a mantem fora -- se ela nascesse ativa, "Ajuste de fatura"
-- apareceria como categoria escolhivel em todo lancamento.
SELECT pg_temp.expect('a reservada fica fora do seletor de categorias',
  pg_temp.categorias_do_seletor('Ajuste de fatura'), 0);

-- =====================================================
-- (3) O AJUSTE POSITIVO AUMENTA A FATURA
-- =====================================================
-- A fatura do app fecha em R$ 200 e a do banco diz R$ 250. O ajuste de +50 tem
-- de levar a view a 250 -- e e aqui que a inversao de sinal e medida de ponta a
-- ponta: a funcao grava `amount = -50` e a view publica `invoice_amount = +50`.
SELECT pg_temp.expect_txt('a dona grava um ajuste de +R$ 50 em outubro',
  pg_temp.grava_ajuste(
    'a1000000-0000-0000-0000-000000000001',
    'a2000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.transaction_categories
      WHERE name = 'Ajuste de fatura'
        AND user_id = 'a1000000-0000-0000-0000-000000000001'),
    DATE '2026-10-01', 50.00),
  'gravou');

SELECT pg_temp.expect_num('a fatura de outubro passou a R$ 250',
  pg_temp.total_da_fatura('a2000000-0000-0000-0000-000000000001', DATE '2026-10-01'),
  250.00);

-- E a linha caiu na fatura de OUTUBRO, nao na de setembro nem na de novembro.
-- Esta e a assercao que (1) prova em teoria e esta mede no dado real.
SELECT pg_temp.expect('o ajuste esta na fatura de outubro, e so nela',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE account_id = 'a2000000-0000-0000-0000-000000000001'
      AND invoice_month = DATE '2026-10-01'
      AND description = 'Ajuste de saldo da fatura'), 1);

SELECT pg_temp.expect('nada do ajuste vazou para setembro ou novembro',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE account_id = 'a2000000-0000-0000-0000-000000000001'
      AND invoice_month IN (DATE '2026-09-01', DATE '2026-11-01')), 0);

-- (11) E nao apareceu na fatura do OUTRO cartao da mesma dona. O vinculo e
-- `account_id`; um ajuste que vazasse entre cartoes somaria duas vezes no
-- patrimonio e a tela mostraria o total certo nos dois lugares.
SELECT pg_temp.expect_num('o outro cartao da dona continua com fatura zerada',
  pg_temp.total_da_fatura('a2000000-0000-0000-0000-000000000002', DATE '2026-10-01'),
  0.00);

-- (9) O saldo do cartao andou com o ajuste: -200 da compra, -50 do ajuste.
SELECT pg_temp.expect_num('o saldo do cartao reflete compra + ajuste',
  pg_temp.saldo('a2000000-0000-0000-0000-000000000001'), -250.00);

-- =====================================================
-- (9) TROCAR O AJUSTE NAO COBRA DUAS VEZES
-- =====================================================
-- A rota faz UPDATE pela chave canonica, e nao um INSERT novo. O que se mede
-- aqui e o `update_account_balance` do 007: sem o estorno de `OLD.amount`, cada
-- alteracao somaria o valor de novo e o saldo do cartao viraria -300, -370...
-- A fatura ficaria certa (a view soma a linha uma vez) e o patrimonio liquido,
-- errado -- as duas telas discordando sem nada explodir.
SELECT pg_temp.expect('a troca encontra a linha pela chave canonica',
  pg_temp.troca_ajuste('a2000000-0000-0000-0000-000000000001', DATE '2026-10-01', 70.00), 1);

SELECT pg_temp.expect_num('a fatura passou a R$ 270 -- trocou, nao somou',
  pg_temp.total_da_fatura('a2000000-0000-0000-0000-000000000001', DATE '2026-10-01'),
  270.00);

SELECT pg_temp.expect_num('e o saldo acompanhou a troca sem cobrar duas vezes',
  pg_temp.saldo('a2000000-0000-0000-0000-000000000001'), -270.00);

SELECT pg_temp.expect('e continua existindo UMA linha de ajuste, nao duas',
  (SELECT count(*) FROM public.financial_transactions
    WHERE notes = pg_temp.chave_ajuste(DATE '2026-10-01',
                                       'a2000000-0000-0000-0000-000000000001')), 1);

-- =====================================================
-- (4) O AJUSTE NEGATIVO ABATE
-- =====================================================
-- A fatura do banco veio MENOR que a do app. O ajuste vira 'income' na conta do
-- cartao -- o formato de um estorno -- e tem de DIMINUIR o total. `ABS` na view
-- faria o abatimento AUMENTAR o que se deve, que e o modo de falha que a nota de
-- sinal da 006 descreve nominalmente.
SELECT pg_temp.expect('a troca para -R$ 30 encontra a mesma linha',
  pg_temp.troca_ajuste('a2000000-0000-0000-0000-000000000001', DATE '2026-10-01', -30.00), 1);

SELECT pg_temp.expect_num('a fatura caiu para R$ 170 (200 - 30)',
  pg_temp.total_da_fatura('a2000000-0000-0000-0000-000000000001', DATE '2026-10-01'),
  170.00);

SELECT pg_temp.expect_txt('e a linha virou income -- continua dentro da view',
  (SELECT transaction_type::text FROM public.card_invoice_lines
    WHERE account_id = 'a2000000-0000-0000-0000-000000000001'
      AND invoice_month = DATE '2026-10-01'
      AND description = 'Ajuste de saldo da fatura'), 'income');

SELECT pg_temp.expect_num('o saldo do cartao subiu com o abatimento',
  pg_temp.saldo('a2000000-0000-0000-0000-000000000001'), -170.00);

-- =====================================================
-- (10) REMOVER DEVOLVE A FATURA E O SALDO
-- =====================================================
-- A chave usada pelo DELETE e a mesma do INSERT: se os dois formatos
-- divergirem, remover responde "nao havia ajuste" sobre um ajuste que esta na
-- tela, e alterar passa a criar um segundo -- acumulando.
SELECT pg_temp.expect('remover acha e apaga exatamente uma linha',
  pg_temp.remove_ajuste('a2000000-0000-0000-0000-000000000001', DATE '2026-10-01'), 1);

SELECT pg_temp.expect_num('a fatura voltou aos R$ 200 das compras',
  pg_temp.total_da_fatura('a2000000-0000-0000-0000-000000000001', DATE '2026-10-01'),
  200.00);

SELECT pg_temp.expect_num('e o saldo voltou a -R$ 200',
  pg_temp.saldo('a2000000-0000-0000-0000-000000000001'), -200.00);

SELECT pg_temp.expect('remover de novo nao acha nada (e e isso que vira 404)',
  pg_temp.remove_ajuste('a2000000-0000-0000-0000-000000000001', DATE '2026-10-01'), 0);

-- =====================================================
-- (6) e (7) O CONTROLE NEGATIVO
-- =====================================================
-- `request.jwt.claim.sub` sobrevive ao RESET ROLE: sem zerar, a troca de sessao
-- abaixo nao aconteceria e o "estranho" leria como a dona.
RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a1000000-0000-0000-0000-000000000002';

SELECT pg_temp.expect('o estranho NAO ve a categoria reservada da dona',
  pg_temp.categorias_visiveis('Ajuste de fatura'), 0);

-- E ve o catalogo na mesma consulta. Sem esta linha, uma policy `USING (FALSE)`
-- passaria pelo controle negativo acima -- "ninguem ve nada" nao e isolamento.
SELECT pg_temp.expect('e ve o catalogo na mesma consulta (o zero acima nao e vacuo)',
  pg_temp.categorias_visiveis('Alimentação'), 1);

-- E nao ve a fatura dela.
SELECT pg_temp.expect_num('o estranho nao ve a fatura do cartao da dona',
  pg_temp.total_da_fatura('a2000000-0000-0000-0000-000000000001', DATE '2026-10-01'),
  0.00);

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

ROLLBACK;

-- =====================================================
-- Se chegou aqui sem excecao, as onze assercoes passaram.
-- =====================================================
