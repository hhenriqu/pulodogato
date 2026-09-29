-- =====================================================
-- HMO-169 -- A 021 recusa a linha errada e aceita a certa
-- =====================================================
--
-- Roda no db-verify, contra o banco que as migrations constroem do zero.
--
-- "A tabela existe" nao prova esta migration. O que ela entrega e um conjunto de
-- REGRAS, e regra que nao recusa nada nao existe. Cada bloco abaixo tenta gravar
-- a linha proibida dentro de um savepoint e EXIGE excecao; se a gravacao passar,
-- o teste levanta erro e o job fica vermelho.
--
-- O caso 1 e o coracao desta migration, e o unico que nao se ve lendo o codigo
-- da rota: a politica de INSERT (`user_id = auth.uid()`) olha a coluna user_id
-- da LINHA NOVA, que o atacante preenche corretamente com a propria identidade.
-- Nada nela olha de QUEM e o asset_id. Sem a FK composta, o usuario A grava
-- lancamento dentro da carteira do usuario B -- e a soma de proventos de B muda
-- sem B fazer nada.

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

-- --- cenario ---------------------------------------------------------------

INSERT INTO auth.users (id, email) VALUES
  ('c1c1c1c1-0000-0000-0000-000000000001', 'inv-a@teste.local'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'inv-b@teste.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name) VALUES
  ('c1c1c1c1-0000-0000-0000-000000000001', 'inv-a@teste.local', 'Investidor A'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'inv-b@teste.local', 'Investidor B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.investment_assets (id, user_id, symbol, name, type) VALUES
  ('d1000000-0000-0000-0000-0000000000a1', 'c1c1c1c1-0000-0000-0000-000000000001', 'PETR4', 'Petrobras PN', 'stock'),
  ('d2000000-0000-0000-0000-0000000000b1', 'c2c2c2c2-0000-0000-0000-000000000002', 'MXRF11', 'Maxi Renda FII', 'fii');

-- A linha certa passa: compra, venda e provento no ativo do proprio dono.
INSERT INTO public.investment_transactions
  (user_id, asset_id, kind, quantity, unit_price, fees, trade_date) VALUES
  ('c1c1c1c1-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-0000000000a1', 'buy',      100, 30.00, 5.90, '2026-01-10'),
  ('c1c1c1c1-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-0000000000a1', 'sell',      40, 34.00, 5.90, '2026-03-10'),
  ('c1c1c1c1-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-0000000000a1', 'dividend',  60,  0.85,    0, '2026-04-10');

SELECT pg_temp.expect('tres lancamentos validos aceitos',
  (SELECT count(*) FROM public.investment_transactions
    WHERE asset_id = 'd1000000-0000-0000-0000-0000000000a1'), 3);

-- =====================================================
-- 1. Lancamento no ativo de OUTRO dono e recusado
-- =====================================================
-- O A preenche user_id com a propria identidade (o que satisfaz a RLS) e
-- aponta asset_id para o ativo do B.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.investment_transactions
      (user_id, asset_id, kind, quantity, unit_price, trade_date)
    VALUES ('c1c1c1c1-0000-0000-0000-000000000001',
            'd2000000-0000-0000-0000-0000000000b1', 'dividend', 1000, 9.99, '2026-05-01');
    RAISE EXCEPTION 'FALHA: gravou lancamento no ativo de outro usuario';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'ok: lancamento cruzado recusado pela FK composta';
  END;
END $$;

-- =====================================================
-- 2. Valores negativos e zero sao recusados
-- =====================================================
-- Aqui esta a diferenca de convencao com `financial_transactions`, onde a
-- despesa e gravada NEGATIVA. Nesta tabela o sinal nao carrega significado:
-- quem tentar representar venda como quantidade negativa bate no CHECK em vez
-- de produzir preco medio errado em silencio.
DO $$
DECLARE
  caso RECORD;
BEGIN
  FOR caso IN
    SELECT * FROM (VALUES
      ('quantidade negativa', -10::numeric,  30.00::numeric, 0::numeric),
      ('quantidade zero',       0::numeric,  30.00::numeric, 0::numeric),
      ('preco negativo',       10::numeric, -30.00::numeric, 0::numeric),
      ('preco zero',           10::numeric,      0::numeric, 0::numeric),
      ('taxa negativa',        10::numeric,  30.00::numeric, -1::numeric)
    ) AS t(rotulo, q, p, f)
  LOOP
    BEGIN
      INSERT INTO public.investment_transactions
        (user_id, asset_id, kind, quantity, unit_price, fees, trade_date)
      VALUES ('c1c1c1c1-0000-0000-0000-000000000001',
              'd1000000-0000-0000-0000-0000000000a1', 'buy', caso.q, caso.p, caso.f, '2026-05-01');
      RAISE EXCEPTION 'FALHA: aceitou %', caso.rotulo;
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'ok: % recusado', caso.rotulo;
    END;
  END LOOP;
END $$;

-- =====================================================
-- 3. kind fora do dominio e recusado
-- =====================================================
DO $$
BEGIN
  BEGIN
    INSERT INTO public.investment_transactions
      (user_id, asset_id, kind, quantity, unit_price, trade_date)
    VALUES ('c1c1c1c1-0000-0000-0000-000000000001',
            'd1000000-0000-0000-0000-0000000000a1', 'split', 10, 1.00, '2026-05-01');
    RAISE EXCEPTION 'FALHA: aceitou kind fora do dominio';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: kind fora do dominio recusado';
  END;
END $$;

-- =====================================================
-- 4. Data futura e recusada
-- =====================================================
-- Erro de digitacao no ano contamina o grafico de evolucao com uma barra
-- solitaria anos a frente, e o eixo inteiro se achata para caber nela.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.investment_transactions
      (user_id, asset_id, kind, quantity, unit_price, trade_date)
    VALUES ('c1c1c1c1-0000-0000-0000-000000000001',
            'd1000000-0000-0000-0000-0000000000a1', 'buy', 10, 1.00,
            (now() AT TIME ZONE 'UTC')::date + 30);
    RAISE EXCEPTION 'FALHA: aceitou lancamento no futuro';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: data futura recusada';
  END;
END $$;

-- =====================================================
-- 5. Preco atual e data do preco andam em par
-- =====================================================
-- Um preco sem data e um numero que o usuario nao sabe de quando e -- e e nele
-- que ele vai olhar para decidir se vende.
DO $$
BEGIN
  BEGIN
    UPDATE public.investment_assets
       SET current_price = 31.50
     WHERE id = 'd1000000-0000-0000-0000-0000000000a1';
    RAISE EXCEPTION 'FALHA: aceitou preco sem data';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: preco sem data recusado';
  END;

  BEGIN
    UPDATE public.investment_assets
       SET current_price_at = now()
     WHERE id = 'd1000000-0000-0000-0000-0000000000a1';
    RAISE EXCEPTION 'FALHA: aceitou data sem preco';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: data sem preco recusada';
  END;
END $$;

UPDATE public.investment_assets
   SET current_price = 31.50, current_price_at = now()
 WHERE id = 'd1000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect('preco COM data aceito',
  (SELECT count(*) FROM public.investment_assets
    WHERE id = 'd1000000-0000-0000-0000-0000000000a1' AND current_price = 31.50), 1);

-- O trigger de updated_at carimbou.
--
-- `updated_at > created_at` NAO serve de assercao aqui: `now()` e o instante de
-- inicio da TRANSACAO, e este teste roda tudo numa transacao so -- os dois
-- carimbos sairiam iguais e o teste reprovaria um trigger que funciona. O que
-- prova o trigger e ele DESCARTAR um valor que o cliente mandou.
UPDATE public.investment_assets
   SET updated_at = '2000-01-01T00:00:00Z'
 WHERE id = 'd1000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect('trigger sobrescreve o updated_at que o cliente mandou',
  (SELECT count(*) FROM public.investment_assets
    WHERE id = 'd1000000-0000-0000-0000-0000000000a1' AND updated_at = now()), 1);

-- =====================================================
-- 6. Simbolo duplicado, minusculo e com espaco sao recusados
-- =====================================================
-- O duplicado e o que a tela sente: sem o UNIQUE, "petr4" e "PETR4" viram duas
-- linhas e a carteira mostra o mesmo ativo duas vezes, cada uma com metade da
-- posicao -- os dois numeros parecem plausiveis e nenhum esta certo.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.investment_assets (user_id, symbol, name, type)
    VALUES ('c1c1c1c1-0000-0000-0000-000000000001', 'PETR4', 'Petrobras de novo', 'stock');
    RAISE EXCEPTION 'FALHA: aceitou simbolo duplicado do mesmo usuario';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ok: simbolo duplicado recusado';
  END;

  BEGIN
    INSERT INTO public.investment_assets (user_id, symbol, name, type)
    VALUES ('c1c1c1c1-0000-0000-0000-000000000001', 'petr4', 'Petrobras minuscula', 'stock');
    RAISE EXCEPTION 'FALHA: aceitou simbolo minusculo';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: simbolo minusculo recusado';
  END;

  BEGIN
    INSERT INTO public.investment_assets (user_id, symbol, name, type)
    VALUES ('c1c1c1c1-0000-0000-0000-000000000001', ' VALE3', 'Vale com espaco', 'stock');
    RAISE EXCEPTION 'FALHA: aceitou simbolo com espaco na borda';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: simbolo com espaco recusado';
  END;

  BEGIN
    INSERT INTO public.investment_assets (user_id, symbol, name, type)
    VALUES ('c1c1c1c1-0000-0000-0000-000000000001', 'VALE3', '   ', 'stock');
    RAISE EXCEPTION 'FALHA: aceitou nome vazio';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: nome vazio recusado';
  END;

  BEGIN
    INSERT INTO public.investment_assets (user_id, symbol, name, type)
    VALUES ('c1c1c1c1-0000-0000-0000-000000000001', 'VALE3', 'Vale', 'criptomoeda');
    RAISE EXCEPTION 'FALHA: aceitou tipo fora do dominio';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: tipo fora do dominio recusado';
  END;
END $$;

-- O MESMO simbolo na carteira de OUTRO usuario tem que passar: o UNIQUE e por
-- usuario, e PETR4 na carteira do B nao e duplicata de nada.
INSERT INTO public.investment_assets (user_id, symbol, name, type)
VALUES ('c2c2c2c2-0000-0000-0000-000000000002', 'PETR4', 'Petrobras PN', 'stock');

SELECT pg_temp.expect('mesmo simbolo em carteiras diferentes aceito',
  (SELECT count(*) FROM public.investment_assets WHERE symbol = 'PETR4'), 2);

-- =====================================================
-- 7. Apagar o ativo apaga o historico dele
-- =====================================================
-- Sem o CASCADE na FK composta, apagar o ativo deixaria lancamento orfao ou a
-- exclusao falharia -- e a tela ofereceria um botao que nunca funciona.
DELETE FROM public.investment_assets WHERE id = 'd1000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect('lancamentos do ativo apagado sumiram',
  (SELECT count(*) FROM public.investment_transactions
    WHERE asset_id = 'd1000000-0000-0000-0000-0000000000a1'), 0);

-- =====================================================
-- 8. RLS: um investidor nao ve a carteira do outro
-- =====================================================
-- O caso 7 apagou o unico ativo do A. Sem recriar um aqui, "B nao ve ativo do A"
-- passaria por AUSENCIA de dado em vez de por isolamento -- a assercao mais
-- convincente que existe, e a que nao prova nada.
INSERT INTO public.investment_assets (user_id, symbol, name, type)
VALUES ('c1c1c1c1-0000-0000-0000-000000000001', 'ITUB4', 'Itau Unibanco PN', 'stock');

SELECT pg_temp.expect('como superusuario, tres ativos no banco',
  (SELECT count(*) FROM public.investment_assets), 3);

-- `SET LOCAL` so vale DENTRO de transacao -- fora dela o Postgres apenas avisa e
-- nada e aplicado, e o teste sairia verde lendo como superusuario.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'c2c2c2c2-0000-0000-0000-000000000002';

SELECT pg_temp.expect('B ve apenas os proprios ativos',
  (SELECT count(*) FROM public.investment_assets), 2);

SELECT pg_temp.expect('B nao ve ativo do A',
  (SELECT count(*) FROM public.investment_assets
    WHERE user_id = 'c1c1c1c1-0000-0000-0000-000000000001'), 0);

-- Gravar em nome de outro e recusado pela politica de INSERT.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.investment_assets (user_id, symbol, name, type)
    VALUES ('c1c1c1c1-0000-0000-0000-000000000001', 'ITUB4', 'Itau do A', 'stock');
    RAISE EXCEPTION 'FALHA: B gravou ativo em nome do A';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: escrita em nome de outro recusada pela RLS';
  END;
END $$;

RESET ROLE;

ROLLBACK;
