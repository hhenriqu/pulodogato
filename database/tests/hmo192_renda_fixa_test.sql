-- =====================================================
-- HMO-192 -- a 031 guarda "110% do CDI" e recusa a combinacao sem sentido
-- =====================================================
--
-- Roda no db-verify, contra o banco que as migrations constroem do zero.
--
-- "As colunas existem" nao prova esta migration: `ADD COLUMN` sozinho nunca
-- falha. O que a 031 entrega sao REGRAS, e regra que nao recusa nada nao existe.
-- Cada bloco abaixo tenta gravar a linha proibida dentro de um bloco de excecao
-- e EXIGE erro; se a gravacao passar, o teste levanta e o job fica vermelho.
--
-- Os dois casos que ninguem ve lendo o codigo da rota:
--
--   SECAO 3  acao com indexador. Nenhum CHECK de valor barra uma PETR4 com
--            `index_kind = 'cdi'`, e a tela somaria o rendimento do CDI POR CIMA
--            da variacao de preco: o mesmo ganho contado duas vezes.
--
--   SECAO 4  prefixado com percentual. `index_percentage = 110` num papel
--            prefixado de 13% a.a. le-se como "110% de um indice" que a linha
--            nao tem -- e projeta 13 vezes o rendimento real sem erro nenhum.
--
-- Rodar num banco limpo, depois da cadeia 001 -> 031:
--   psql "$DB_URL" -f database/tests/hmo192_renda_fixa_test.sql
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

-- --- cenario ---------------------------------------------------------------

INSERT INTO auth.users (id, email) VALUES
  ('e1000000-0000-0000-0000-0000000000a1', 'rf-a@teste.local'),
  ('e2000000-0000-0000-0000-0000000000b1', 'rf-b@teste.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name) VALUES
  ('e1000000-0000-0000-0000-0000000000a1', 'rf-a@teste.local', 'Rendinha A'),
  ('e2000000-0000-0000-0000-0000000000b1', 'rf-b@teste.local', 'Rendinha B')
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- SECAO 1: as formas de remuneracao que existem no mercado cabem no schema
-- =====================================================
-- Cinco linhas, cinco maneiras diferentes de um papel render. Se alguma delas
-- nao couber, renda fixa continua sendo "digite o valor na mao" para aquele
-- caso -- que e o problema que a 031 existe para resolver.

INSERT INTO public.investment_assets
  (id, user_id, symbol, name, type, fixed_income_product, index_kind,
   index_percentage, spread_annual, applied_date, maturity_date) VALUES
  -- O caso da issue: CDB de 110% do CDI.
  ('e1a00000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-0000000000a1',
   'CDB-BANCO-X', 'CDB Banco X 110% CDI', 'fixed_income', 'cdb', 'cdi',
   110, NULL, '2026-01-15', '2028-01-15'),
  -- Isento: LCI. O produto e a UNICA coluna que distingue esta linha de um CDB
  -- de 95% do CDI -- e e ela que decide se a tela desconta IR.
  ('e1a00000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-0000000000a1',
   'LCI-BANCO-Y', 'LCI Banco Y 95% CDI', 'fixed_income', 'lci', 'cdi',
   95, NULL, '2026-03-01', '2027-03-01'),
  -- Indice MAIS spread: IPCA + 6% a.a.
  ('e1a00000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-0000000000a1',
   'CDB-IPCA', 'CDB IPCA + 6', 'fixed_income', 'cdb', 'ipca',
   NULL, 6, '2026-02-10', '2031-02-10'),
  -- Prefixado: a taxa inteira, sem indice.
  ('e1a00000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-0000000000a1',
   'CDB-PRE', 'CDB prefixado 13% a.a.', 'fixed_income', 'cdb', 'prefixado',
   NULL, 13, '2026-04-01', '2029-04-01'),
  -- Poupanca: sem percentual, sem spread e SEM vencimento (liquidez diaria).
  ('e1a00000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-0000000000a1',
   'POUPANCA', 'Poupanca', 'fixed_income', 'poupanca', 'poupanca',
   NULL, NULL, '2025-06-01', NULL);

SELECT pg_temp.expect('as cinco formas de remuneracao foram aceitas',
  (SELECT count(*) FROM public.investment_assets
    WHERE user_id = 'e1000000-0000-0000-0000-0000000000a1'), 5);

-- =====================================================
-- SECAO 2: o ativo de ANTES da 031 continua valido
-- =====================================================
-- Ha renda fixa cadastrada em producao desde a 021, toda com as seis colunas
-- nulas. Se qualquer CHECK desta migration exigisse preenchimento, colar o
-- arquivo no SQL Editor abortaria -- e uma tela que funcionava pararia de
-- aceitar cadastro novo. Este bloco e o que mantem a 031 ADITIVA.
INSERT INTO public.investment_assets (id, user_id, symbol, name, type) VALUES
  ('e1a00000-0000-0000-0000-000000000009', 'e1000000-0000-0000-0000-0000000000a1',
   'CDB-ANTIGO', 'CDB cadastrado antes da 031', 'fixed_income');

SELECT pg_temp.expect('renda fixa sem nenhum campo novo continua aceita',
  (SELECT count(*) FROM public.investment_assets
    WHERE id = 'e1a00000-0000-0000-0000-000000000009'), 1);

-- E uma acao segue entrando sem nada disso, que e como a rota de ativos grava
-- hoje.
INSERT INTO public.investment_assets (id, user_id, symbol, name, type) VALUES
  ('e1a00000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-0000000000a1',
   'PETR4', 'Petrobras PN', 'stock');

SELECT pg_temp.expect('acao sem campo de renda fixa continua aceita',
  (SELECT count(*) FROM public.investment_assets
    WHERE id = 'e1a00000-0000-0000-0000-00000000000a'), 1);

-- =====================================================
-- SECAO 3: campo de renda fixa em ativo que NAO e renda fixa e recusado
-- =====================================================
-- No INSERT...
DO $$
DECLARE
  caso RECORD;
BEGIN
  FOR caso IN
    SELECT * FROM (VALUES
      ('acao com indexador',    'index_kind'),
      ('acao com produto',      'fixed_income_product'),
      ('acao com aplicacao',    'applied_date'),
      ('acao com vencimento',   'maturity_date'),
      ('acao com spread',       'spread_annual')
    ) AS t(rotulo, coluna)
  LOOP
    BEGIN
      EXECUTE format(
        'INSERT INTO public.investment_assets (user_id, symbol, name, type, %I)
         VALUES (%L, %L, %L, %L, %L)',
        caso.coluna,
        'e1000000-0000-0000-0000-0000000000a1',
        'X' || upper(left(md5(caso.rotulo), 6)), 'Acao de teste', 'stock',
        CASE caso.coluna
          WHEN 'index_kind'           THEN 'cdi'
          WHEN 'fixed_income_product' THEN 'cdb'
          WHEN 'applied_date'         THEN '2026-01-15'
          WHEN 'maturity_date'        THEN '2030-01-15'
          ELSE '6'
        END);
      RAISE EXCEPTION 'FALHA: aceitou %', caso.rotulo;
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'ok: % recusado', caso.rotulo;
    END;
  END LOOP;
END $$;

-- ...e no UPDATE, que e por onde isso chegaria de verdade: a tela de edicao
-- manda o formulario inteiro, e um campo de renda fixa deixado preenchido ao
-- trocar o tipo para `stock` entraria por aqui. CHECK vale nas duas escritas;
-- policy de RLS nao valeria (nao existe OLD em policy) -- e esta e a razao de a
-- regra morar num CHECK.
DO $$
BEGIN
  BEGIN
    UPDATE public.investment_assets
       SET index_kind = 'cdi', index_percentage = 110
     WHERE id = 'e1a00000-0000-0000-0000-00000000000a';
    RAISE EXCEPTION 'FALHA: UPDATE pos indexador numa acao';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: UPDATE que poe indexador em acao recusado';
  END;
END $$;

-- O contrario tambem tem que ser barrado: virar `stock` carregando os campos de
-- renda fixa. Sem isto, a linha da SECAO 1 viraria uma acao rendendo CDI.
DO $$
BEGIN
  BEGIN
    UPDATE public.investment_assets
       SET type = 'stock'
     WHERE id = 'e1a00000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'FALHA: virou acao carregando indexador, percentual e datas';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: trocar o tipo para acao sem limpar os campos e recusado';
  END;
END $$;

-- =====================================================
-- SECAO 4: as combinacoes sem sentido entre as duas colunas de taxa
-- =====================================================
DO $$
DECLARE
  caso RECORD;
BEGIN
  FOR caso IN
    SELECT * FROM (VALUES
      -- "110% de que?"
      ('percentual sem indexador',      NULL,          110::numeric, NULL::numeric),
      -- Percentual de um indice que a linha nao acompanha.
      ('prefixado com percentual',      'prefixado',   110::numeric, 13::numeric),
      -- Indexador que lib/renda-fixa.ts nao sabe projetar. O valor abaixo e o
      -- erro real: quem preenche confunde PRODUTO com INDEXADOR.
      ('indexador fora do dominio',     'cdb',         100::numeric, NULL::numeric),
      ('indexador em maiuscula',        'CDI',         100::numeric, NULL::numeric),
      -- Digitacao: um zero a mais e um rendimento dez vezes maior.
      ('percentual acima do teto',      'cdi',        1100::numeric, NULL::numeric),
      ('percentual zero',               'cdi',           0::numeric, NULL::numeric),
      ('percentual negativo',           'cdi',        -110::numeric, NULL::numeric),
      ('spread negativo',               'ipca',       NULL::numeric, -2::numeric),
      ('spread acima do teto',          'ipca',       NULL::numeric, 101::numeric)
    ) AS t(rotulo, indexador, percentual, spread)
  LOOP
    BEGIN
      INSERT INTO public.investment_assets
        (user_id, symbol, name, type, index_kind, index_percentage, spread_annual)
      VALUES ('e1000000-0000-0000-0000-0000000000a1',
              'T' || upper(left(md5(caso.rotulo), 6)), 'Papel de teste', 'fixed_income',
              caso.indexador, caso.percentual, caso.spread);
      RAISE EXCEPTION 'FALHA: aceitou %', caso.rotulo;
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'ok: % recusado', caso.rotulo;
    END;
  END LOOP;
END $$;

-- Dois zeros a mais nao chegam ao CHECK: `numeric(8,4)` cabe no maximo
-- 9999,9999, e 11000 e recusado pelo TIPO, com outro SQLSTATE. Esta assercao
-- existe para que a linha continue sendo recusada quando alguem afrouxar o teto
-- de 1000 achando que o tipo aguenta -- e para nao deixar a impressao de que o
-- CHECK e o que barra este caso.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.investment_assets
      (user_id, symbol, name, type, index_kind, index_percentage)
    VALUES ('e1000000-0000-0000-0000-0000000000a1',
            'TOVERFL', 'Papel de teste', 'fixed_income', 'cdi', 11000);
    RAISE EXCEPTION 'FALHA: aceitou percentual de 11000';
  EXCEPTION WHEN numeric_value_out_of_range THEN
    RAISE NOTICE 'ok: percentual de 11000 recusado pelo tipo numeric(8,4)';
  END;
END $$;

-- Produto fora do dominio. Ele nao esta no laco acima porque o erro que importa
-- e especifico: um produto ISENTO escrito de um jeito que o codigo nao reconhece
-- (`LCI` em maiuscula, `lci_iptu`) cairia no caminho generico e a tela
-- descontaria 22,5% de quem nao paga IR nenhum.
DO $$
DECLARE
  caso text;
BEGIN
  FOREACH caso IN ARRAY ARRAY['LCI', 'lci ', 'tesouro_ipca', 'bitcoin']
  LOOP
    BEGIN
      INSERT INTO public.investment_assets
        (user_id, symbol, name, type, fixed_income_product)
      VALUES ('e1000000-0000-0000-0000-0000000000a1',
              'P' || upper(left(md5(caso), 6)), 'Papel de teste', 'fixed_income', caso);
      RAISE EXCEPTION 'FALHA: aceitou produto %', caso;
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'ok: produto % recusado', caso;
    END;
  END LOOP;
END $$;

-- =====================================================
-- SECAO 5: as datas
-- =====================================================
-- A data de aplicacao nao e um campo de tela qualquer: e o inicio da contagem
-- do IR. Uma aplicacao no futuro produz prazo negativo, e com ele a aliquota
-- maxima sobre um rendimento que nem deveria existir.
DO $$
DECLARE
  caso RECORD;
BEGIN
  FOR caso IN
    SELECT * FROM (VALUES
      ('aplicacao no futuro',        ((now() AT TIME ZONE 'UTC')::date + 30), NULL::date),
      ('vencimento antes da aplicacao', '2026-05-01'::date, '2026-04-01'::date),
      ('vencimento igual a aplicacao',  '2026-05-01'::date, '2026-05-01'::date)
    ) AS t(rotulo, aplicacao, vencimento)
  LOOP
    BEGIN
      INSERT INTO public.investment_assets
        (user_id, symbol, name, type, applied_date, maturity_date)
      VALUES ('e1000000-0000-0000-0000-0000000000a1',
              'D' || upper(left(md5(caso.rotulo), 6)), 'Papel de teste', 'fixed_income',
              caso.aplicacao, caso.vencimento);
      RAISE EXCEPTION 'FALHA: aceitou %', caso.rotulo;
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'ok: % recusado', caso.rotulo;
    END;
  END LOOP;
END $$;

-- Vencimento no PASSADO e aceito de proposito: papel que venceu e o usuario nao
-- resgatou continua na carteira, e recusar a linha impediria de cadastrar
-- historico. Quem decide o que mostrar e a tela, nao o banco.
INSERT INTO public.investment_assets
  (id, user_id, symbol, name, type, fixed_income_product, index_kind,
   index_percentage, applied_date, maturity_date) VALUES
  ('e1a00000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-0000000000a1',
   'CDB-VENCIDO', 'CDB que ja venceu', 'fixed_income', 'cdb', 'cdi',
   102, '2024-01-10', '2025-01-10');

SELECT pg_temp.expect('papel vencido no passado continua aceito',
  (SELECT count(*) FROM public.investment_assets
    WHERE id = 'e1a00000-0000-0000-0000-00000000000b'), 1);

-- =====================================================
-- SECAO 6: as colunas novas nao furam a RLS
-- =====================================================
-- A entrega 2 acrescenta um caminho de ESCRITA (a tela de edicao passa a mandar
-- indexador, percentual e datas). Vale conferir com o usuario logado de verdade
-- que esse caminho continua preso ao dono: policy de UPDATE olha a LINHA, e uma
-- coluna nova entra por ela sem ninguem reescrever nada -- mas "entra sem
-- ninguem reescrever" e uma hipotese, e esta secao e o que a torna um fato.

INSERT INTO public.investment_assets
  (id, user_id, symbol, name, type, fixed_income_product, index_kind, index_percentage, applied_date)
VALUES
  ('e2a00000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-0000000000b1',
   'CDB-DO-B', 'CDB do usuario B', 'fixed_income', 'cdb', 'cdi', 105, '2026-01-02');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

DO $$
DECLARE
  v_proprios   integer;
  v_afetadas   integer;
  v_percentual numeric;
BEGIN
  -- Controle: a RLS de SELECT funciona neste banco. Sem este numero, um zero na
  -- assercao seguinte nao distingue "protegido" de "tabela vazia".
  SELECT count(*) INTO v_proprios FROM public.investment_assets;
  IF v_proprios < 1 THEN
    RAISE EXCEPTION
      'Controle falhou: o usuario A nao ve nenhum ativo proprio, entao esta secao nao consegue isolar nada.';
  END IF;

  -- O A tenta trocar o percentual do papel do B -- o ataque realista aqui: o id
  -- do ativo vai no corpo do PATCH, e adivinhar um uuid nao e o ponto (um id
  -- vazado por qualquer outra tela serve).
  UPDATE public.investment_assets
     SET index_percentage = 1000
   WHERE id = 'e2a00000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS v_afetadas = ROW_COUNT;

  IF v_afetadas <> 0 THEN
    RAISE EXCEPTION
      'O usuario A alterou % linha(s) do ativo de renda fixa do B.', v_afetadas;
  END IF;

  RAISE NOTICE 'ok: UPDATE do percentual no ativo de outro dono nao alcanca nenhuma linha';
END $$;

RESET ROLE;
-- O claim do JWT NAO cai com o RESET ROLE: sem esta linha, tudo daqui para
-- baixo continuaria rodando como o usuario A e a leitura abaixo veria a RLS.
RESET request.jwt.claims;

-- E o valor no banco nao mudou. O ROW_COUNT = 0 acima e a prova de que a policy
-- filtrou; esta leitura, feita por fora da RLS, e a prova de que nada foi
-- escrito por outro caminho.
SELECT pg_temp.expect('o percentual do ativo do B segue 105',
  (SELECT (index_percentage)::bigint FROM public.investment_assets
    WHERE id = 'e2a00000-0000-0000-0000-000000000001'), 105);

ROLLBACK;
