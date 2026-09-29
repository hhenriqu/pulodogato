-- =====================================================
-- HMO-171 -- a moeda entra no grao, e o total para de misturar
-- =====================================================
--
-- Roda no db-verify, contra o banco que as migrations constroem do zero.
--
-- "A coluna existe" nao prova nada aqui. O que a 022 entrega e a promessa de que
-- NENHUM numero de relatorio mistura moedas -- e essa promessa vive nas views,
-- nao nas colunas. Um `ALTER TABLE ADD COLUMN` que passa verde com as views
-- antigas intactas seria o pior resultado possivel: o app ganharia o seletor de
-- moeda e o fluxo de caixa passaria a somar dolar com real, calado.
--
-- O caso que justifica o arquivo e o 4 (previsto x realizado). Ele nao se ve
-- lendo a 022: `planned_vs_actual` nao ganhou requisito nenhum nesta issue, e o
-- que a quebra e um `LEFT JOIN LATERAL` sem agregado no 008, que devolvia uma
-- linha enquanto `monthly_cash_flow` tinha uma linha por mes. Com a moeda no
-- grao ele devolve uma por moeda e MULTIPLICA a linha do mes. O caso 5 e o
-- controle negativo dele: reproduz o LATERAL antigo sobre a view nova e exige
-- que o previsto apareca DOBRADO -- se um dia o casamento por moeda sair da
-- view, o caso 4 fica vermelho e o 5 diz por que.

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

-- --- cenario ---------------------------------------------------------------
-- Um mes, um usuario, duas moedas. Os valores sao escolhidos para que a soma
-- errada seja RECONHECIVEL: 1000 reais de gasto e 180 dolares de gasto. Um SUM
-- cego devolve 1180, que nao e nem o gasto em reais nem o gasto em dolares.

INSERT INTO auth.users (id, email) VALUES
  ('e1e1e1e1-0000-0000-0000-000000000001', 'moeda-a@teste.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name) VALUES
  ('e1e1e1e1-0000-0000-0000-000000000001', 'moeda-a@teste.local', 'Pessoa Moeda')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.financial_services (id, name) VALUES
  ('e1000000-0000-0000-0000-00000000f001', 'Servico Moeda')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.transaction_categories (id, service_id, name, is_expense) VALUES
  ('e1000000-0000-0000-0000-00000000c001', 'e1000000-0000-0000-0000-00000000f001', 'Gasto Moeda', true),
  ('e1000000-0000-0000-0000-00000000c002', 'e1000000-0000-0000-0000-00000000f001', 'Renda Moeda', false)
ON CONFLICT (id) DO NOTHING;

-- Duas contas: uma em real, uma em dolar. A moeda da CONTA e so o padrao que o
-- formulario sugere; quem manda no relatorio e a moeda do lancamento.
INSERT INTO public.financial_accounts (id, user_id, name, account_type, currency) VALUES
  ('e1000000-0000-0000-0000-00000000a001', 'e1e1e1e1-0000-0000-0000-000000000001', 'Conta Real', 'checking', 'BRL'),
  ('e1000000-0000-0000-0000-00000000a002', 'e1e1e1e1-0000-0000-0000-000000000001', 'Conta Dolar', 'checking', 'USD');

-- =====================================================
-- CASO 1: lancamento que ja existia continua em BRL  ("ficam-brl")
-- =====================================================
-- A decisao do Helio foi nao reescrever historico. Aqui isso e testavel do jeito
-- mais direto: um INSERT que NAO menciona moeda -- exatamente o INSERT que todo
-- codigo anterior a esta issue faz -- tem de resultar em BRL. Se o default
-- mudasse para "a moeda oficial do perfil", todo lancamento antigo do app
-- passaria a ser lido em outra moeda de uma vez.
INSERT INTO public.financial_transactions
  (user_id, service_id, category_id, account_id, description, amount, transaction_date, transaction_type)
VALUES
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'e1000000-0000-0000-0000-00000000f001', 'e1000000-0000-0000-0000-00000000c001',
   'e1000000-0000-0000-0000-00000000a001', 'Gasto antigo sem moeda', -400.00, '2026-03-10', 'expense');

SELECT pg_temp.expect('lancamento sem moeda declarada nasce BRL',
  (SELECT count(*) FROM public.financial_transactions
    WHERE description = 'Gasto antigo sem moeda' AND currency = 'BRL'), 1);

-- =====================================================
-- CASO 2: o CHECK recusa moeda que o app nao conhece
-- =====================================================
-- `moedaPorCodigo` (lib/dinheiro.ts) cai no padrao quando o codigo e estranho.
-- Isso e certo na LEITURA -- um jsonb mexido na mao nao pode deixar a tela
-- branca -- e e exatamente por isso que a ESCRITA tem de recusar: um lancamento
-- gravado em 'CZK' apareceria na tela como se fosse em reais, com o simbolo R$ na
-- frente, sem erro nenhum.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.financial_transactions
      (user_id, service_id, category_id, account_id, description, amount, transaction_date, transaction_type, currency)
    VALUES
      ('e1e1e1e1-0000-0000-0000-000000000001',
       'e1000000-0000-0000-0000-00000000f001', 'e1000000-0000-0000-0000-00000000c001',
       'e1000000-0000-0000-0000-00000000a001', 'Moeda inventada', -10.00, '2026-03-10', 'expense', 'CZK');
    RAISE EXCEPTION 'FALHA: o banco aceitou moeda fora do catalogo';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: moeda fora do catalogo recusada pelo CHECK';
  END;
END $$;

-- A conta tambem recusa, e nao so o lancamento: e a conta que sugere a moeda, e
-- uma conta em moeda desconhecida contaminaria todo lancamento novo dela.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.financial_accounts (user_id, name, account_type, currency)
    VALUES ('e1e1e1e1-0000-0000-0000-000000000001', 'Conta Marciana', 'checking', 'XXX');
    RAISE EXCEPTION 'FALHA: o banco aceitou conta em moeda fora do catalogo';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: conta em moeda fora do catalogo recusada pelo CHECK';
  END;
END $$;

-- =====================================================
-- CASO 3: o mes com duas moedas vira DUAS linhas, cada uma pura
-- =====================================================
-- O coracao da parte 3 da issue. O lancamento em dolar mora na conta em dolar, e
-- ha um lancamento em dolar numa conta de REAL de proposito (a sobreposicao que
-- a resposta "os-dois" pede): se a view lesse a moeda da CONTA por JOIN em vez
-- da moeda do LANCAMENTO, esse ultimo cairia no balde errado.

INSERT INTO public.financial_transactions
  (user_id, service_id, category_id, account_id, description, amount, transaction_date, transaction_type, currency)
VALUES
  -- reais: 600 de gasto (+ os 400 do caso 1 = 1000) e 3000 de renda
  ('e1e1e1e1-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000f001',
   'e1000000-0000-0000-0000-00000000c001', 'e1000000-0000-0000-0000-00000000a001',
   'Mercado', -600.00, '2026-03-12', 'expense', 'BRL'),
  ('e1e1e1e1-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000f001',
   'e1000000-0000-0000-0000-00000000c002', 'e1000000-0000-0000-0000-00000000a001',
   'Salario', 3000.00, '2026-03-05', 'income', 'BRL'),
  -- dolares: 100 na conta em dolar + 80 numa conta em REAL (a sobreposicao)
  ('e1e1e1e1-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000f001',
   'e1000000-0000-0000-0000-00000000c001', 'e1000000-0000-0000-0000-00000000a002',
   'Assinatura em dolar', -100.00, '2026-03-14', 'expense', 'USD'),
  ('e1e1e1e1-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000f001',
   'e1000000-0000-0000-0000-00000000c001', 'e1000000-0000-0000-0000-00000000a001',
   'Compra em dolar no cartao BRL', -80.00, '2026-03-15', 'expense', 'USD');

SELECT pg_temp.expect('marco tem duas linhas em monthly_cash_flow, uma por moeda',
  (SELECT count(*) FROM public.monthly_cash_flow
    WHERE user_id = 'e1e1e1e1-0000-0000-0000-000000000001' AND month = '2026-03-01'), 2);

-- O numero que importa: o gasto em reais e 1000, nao 1180. Se a moeda saisse do
-- GROUP BY, esta asercao pegaria 1180 na linha unica.
SELECT pg_temp.expect_num('gasto de marco em BRL = 1000 (nao 1180)',
  (SELECT expense FROM public.monthly_cash_flow
    WHERE user_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      AND month = '2026-03-01' AND currency = 'BRL'), 1000.00);

SELECT pg_temp.expect_num('gasto de marco em USD = 180, e inclui o lancamento na conta BRL',
  (SELECT expense FROM public.monthly_cash_flow
    WHERE user_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      AND month = '2026-03-01' AND currency = 'USD'), 180.00);

-- A renda nao vaza para a linha da outra moeda. Sem a moeda no grao haveria uma
-- linha so, e o resultado do mes em dolar herdaria o salario em reais -- "sobrou
-- dinheiro em dolar" para quem so gastou em dolar.
SELECT pg_temp.expect_num('nao ha renda em USD em marco',
  (SELECT income FROM public.monthly_cash_flow
    WHERE user_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      AND month = '2026-03-01' AND currency = 'USD'), 0.00);

SELECT pg_temp.expect_num('resultado de marco em USD = -180',
  (SELECT net FROM public.monthly_cash_flow
    WHERE user_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      AND month = '2026-03-01' AND currency = 'USD'), -180.00);

-- `transfer` continua fora das duas colunas. Uma transferencia ENTRE MOEDAS e o
-- caso novo: as duas pernas nao se anulam mais (1000 reais saem, 180 dolares
-- entram), e e correto que nao se anulem -- houve cambio. O que nao pode e ela
-- virar renda ou gasto de alguma das duas moedas.
INSERT INTO public.financial_transactions
  (user_id, service_id, category_id, account_id, description, amount, transaction_date, transaction_type, currency)
VALUES
  ('e1e1e1e1-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000f001',
   'e1000000-0000-0000-0000-00000000c001', 'e1000000-0000-0000-0000-00000000a001',
   'Cambio: saida em real', -1000.00, '2026-03-20', 'transfer', 'BRL'),
  ('e1e1e1e1-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000f001',
   'e1000000-0000-0000-0000-00000000c001', 'e1000000-0000-0000-0000-00000000a002',
   'Cambio: entrada em dolar', 180.00, '2026-03-20', 'transfer', 'USD');

SELECT pg_temp.expect_num('o cambio nao mexeu no gasto em BRL',
  (SELECT expense FROM public.monthly_cash_flow
    WHERE user_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      AND month = '2026-03-01' AND currency = 'BRL'), 1000.00);

SELECT pg_temp.expect_num('o cambio nao virou renda em USD',
  (SELECT income FROM public.monthly_cash_flow
    WHERE user_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      AND month = '2026-03-01' AND currency = 'USD'), 0.00);

-- =====================================================
-- CASO 4: previsto x realizado NAO duplica o mes
-- =====================================================
-- Uma conta prevista em reais, no mesmo mes que tem gasto nas duas moedas.

INSERT INTO public.scheduled_transactions
  (user_id, category_id, account_id, description, amount, due_date, status, currency)
VALUES
  ('e1e1e1e1-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000c001',
   'e1000000-0000-0000-0000-00000000a001', 'Aluguel previsto', 900.00, '2026-03-05', 'pending', 'BRL');

SELECT pg_temp.expect('marco aparece uma vez por moeda em planned_vs_actual',
  (SELECT count(*) FROM public.planned_vs_actual
    WHERE user_id = 'e1e1e1e1-0000-0000-0000-000000000001' AND month = '2026-03-01'), 2);

-- O previsto e em reais. Ele tem de aparecer INTEIRO na linha de BRL e ZERO na
-- linha de USD -- e nao 900 nas duas, que e o que o LATERAL sem moeda daria.
SELECT pg_temp.expect_num('previsto de marco em BRL = 900',
  (SELECT planned_expense FROM public.planned_vs_actual
    WHERE user_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      AND month = '2026-03-01' AND currency = 'BRL'), 900.00);

SELECT pg_temp.expect_num('nao ha previsto em USD em marco',
  (SELECT planned_expense FROM public.planned_vs_actual
    WHERE user_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      AND month = '2026-03-01' AND currency = 'USD'), 0.00);

-- E o realizado de cada linha e o da propria moeda.
SELECT pg_temp.expect_num('realizado de marco em USD = 180',
  (SELECT actual_expense FROM public.planned_vs_actual
    WHERE user_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      AND month = '2026-03-01' AND currency = 'USD'), 180.00);

-- =====================================================
-- CASO 5: controle negativo do caso 4
-- =====================================================
-- Reproduz o LATERAL do 008 -- o mesmo, sem o `AND f.currency IS NOT DISTINCT
-- FROM k.currency` -- e EXIGE que ele erre. Um teste que so afirma o valor certo
-- nao distingue "a correcao funciona" de "o cenario nunca exercitou o bug"; este
-- bloco prova que o cenario acima exercita mesmo.
--
-- Sem o casamento por moeda, a chave de marco casa com as DUAS linhas de
-- monthly_cash_flow, e o mes sai duplicado com o previsto repetido em cada
-- copia: 900 previstos viram 1800 no relatorio.
DO $$
DECLARE
  linhas BIGINT;
  previsto_total NUMERIC;
BEGIN
  WITH chaves AS (
    SELECT s.user_id, s.group_id, date_trunc('month', s.due_date)::date AS month
    FROM public.scheduled_transactions s
    WHERE s.user_id = 'e1e1e1e1-0000-0000-0000-000000000001'
  ),
  antigo AS (
    SELECT k.month, COALESCE(p.planned_expense, 0) AS planned_expense
    FROM chaves k
    LEFT JOIN LATERAL (
      SELECT SUM(s.amount) AS planned_expense
      FROM public.scheduled_transactions s
      WHERE s.user_id = k.user_id
        AND s.group_id IS NOT DISTINCT FROM k.group_id
        AND date_trunc('month', s.due_date)::date = k.month
        AND s.status <> 'cancelled'
    ) AS p ON TRUE
    -- o LATERAL do 008, sem moeda: devolve uma linha por MOEDA da view nova
    LEFT JOIN LATERAL (
      SELECT f.income, f.expense
      FROM public.monthly_cash_flow f
      WHERE f.user_id = k.user_id
        AND f.group_id IS NOT DISTINCT FROM k.group_id
        AND f.month = k.month
    ) AS a ON TRUE
  )
  SELECT count(*), SUM(planned_expense) INTO linhas, previsto_total FROM antigo;

  IF linhas <> 2 THEN
    RAISE EXCEPTION
      'FALHA (controle negativo): o LATERAL sem moeda devolveu % linhas; o cenario nao exercita a duplicacao, entao o caso 4 nao prova nada', linhas;
  END IF;

  IF previsto_total <> 1800.00 THEN
    RAISE EXCEPTION
      'FALHA (controle negativo): o previsto duplicado deu % e nao 1800', previsto_total;
  END IF;

  RAISE NOTICE 'ok: controle negativo -- sem casar a moeda, marco duplica e o previsto vai a 1800';
END $$;

-- =====================================================
-- CASO 6: as tres views continuam com security_invoker
-- =====================================================
-- `CREATE OR REPLACE VIEW` preserva reloptions, entao a 022 poderia ter omitido
-- os ALTER. Este caso e o que transforma essa crenca em fato: sem
-- security_invoker a view roda como o DONO, a RLS de financial_transactions nao
-- se aplica, e monthly_cash_flow devolve a renda de todos os usuarios do app
-- para qualquer um logado. Tabela limpa nao prova schema limpo.
SELECT pg_temp.expect('as tres views de relatorio tem security_invoker',
  (SELECT count(*) FROM pg_class
    WHERE relname IN ('category_monthly_totals', 'monthly_cash_flow', 'planned_vs_actual')
      AND relnamespace = 'public'::regnamespace
      AND reloptions @> ARRAY['security_invoker=true']), 3);

-- E a RLS de verdade, pela view, com a role de aplicacao. `SET LOCAL` so vale
-- DENTRO de transacao -- fora dela o Postgres apenas avisa, e o teste sairia
-- verde lendo como superusuario.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'e1e1e1e1-0000-0000-0000-000000000001';

SELECT pg_temp.expect('o dono ve as duas linhas de moeda de marco',
  (SELECT count(*) FROM public.monthly_cash_flow WHERE month = '2026-03-01'), 2);

RESET ROLE;

ROLLBACK;
