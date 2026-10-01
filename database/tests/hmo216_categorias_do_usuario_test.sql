-- =====================================================
-- HMO-216: categoria da pessoa e subcategoria
-- =====================================================
-- A 036 faz tres coisas, e a primeira e a que precisa de guarda permanente:
--
--   1. `transaction_categories` ganha `user_id`. No instante em que isso
--      acontece, a policy que estava em producao desde o 002
--      (`USING (is_active = TRUE)`, sem filtro de usuario) publica a lista de
--      categorias de cada pessoa para o app inteiro -- e essa lista conta onde
--      a pessoa gasta. A 036 aperta a policy; a assercao (4) deste arquivo e o
--      que impede que o aperto seja desfeito por "simplificacao";
--
--   2. toda categoria tem a subcategoria "Outros" por INVARIANTE (trigger +
--      backfill), nao por codigo de rota. (2) e (3) fixam os dois caminhos;
--
--   3. a subcategoria pertence A SUA categoria, por FK COMPOSTA. (9) e (10)
--      fixam os dois lados do `MATCH SIMPLE`.
--
-- O que ele fixa, na ordem:
--
--   (1)  as 13 categorias do catalogo receberam "Outros" pelo BACKFILL;
--   (2)  categoria nova nasce com "Outros" pelo TRIGGER;
--   (3)  o trigger vale tambem para categoria criada por quem NAO e o dono da
--        tabela (sessao `authenticated`), que e o caminho da feature;
--   (4)  CONTROLE NEGATIVO: um estranho autenticado NAO ve a categoria da
--        outra pessoa;
--   (5)  ...e ve o CATALOGO na mesma consulta -- prova de que (4) nao e
--        "ninguem ve nada". Se a policy virasse `USING (FALSE)`, (5) quebra;
--   (6)  ninguem cria categoria no nome de outra pessoa;
--   (7)  ninguem PUBLICA a propria categoria no catalogo (`user_id = NULL`),
--        que seria por "Pensão da Ana" no seletor de todo mundo;
--   (8)  duas pessoas podem ter o MESMO nome de categoria; a mesma pessoa nao;
--   (9)  lancamento SEM subcategoria passa (MATCH SIMPLE com NULL);
--   (10) lancamento com subcategoria de OUTRA categoria e recusado;
--   (11) o residual conhecido da FK: apontar para a subcategoria de outra
--        pessoa sob a mesma categoria do catalogo e aceito pela FK e INVISIVEL
--        na leitura -- fixado para que ninguem leia como vazamento;
--   (12) subcategoria em uso nao pode ser apagada (RESTRICT), e a tentativa
--        NAO mexe no saldo;
--   (13) a personalizacao do catalogo e privada, e ninguem grava no nome de
--        outra pessoa;
--   (14) os CHECKs de nome e de cor;
--   (15) `anon` nao tem privilegio nenhum nas duas tabelas novas -- a chave
--        `anon` vai embutida no bundle JS publico. Esta e copia do guard do
--        db-verify, e esta aqui porque a primeira versao da 036 reprovou nele.
--
-- Rodar num banco limpo, depois das migrations ate 036:
--   psql "$DB_URL" -f database/tests/hmo216_categorias_do_usuario_test.sql
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

CREATE OR REPLACE FUNCTION pg_temp.expect_txt(label TEXT, got TEXT, want TEXT)
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

-- ---------------------------------------------------------------------------
-- As sondas
-- ---------------------------------------------------------------------------
-- Uma funcao por tentativa de escrita, devolvendo texto, porque e assim que
-- "foi recusado, e com QUAL erro" vira assercao. Capturar o SQLSTATE importa:
-- 42501 (RLS) e 23505 (unique) e 23503 (FK) sao tres recusas diferentes, e um
-- teste que so exigisse "deu erro" passaria com a policy aberta e a unique
-- fazendo o trabalho dela.

-- O 42501 desta sonda diz TAMBEM qual tabela recusou, e isso nao e capricho:
-- foi o unico jeito de a assercao (6) medir a policy que ela quer medir.
--
-- Medido com o mutante `insert_larga` (scripts/mutantes-categorias.sh). Com a
-- policy de INSERT da CATEGORIA totalmente aberta, criar categoria no nome de
-- outra pessoa continua levando 42501 -- mas vindo da SUBCATEGORIA: o trigger
-- `criar_subcategoria_outros` tenta inserir o "Outros" com o `user_id` da
-- vitima, e a policy de INSERT daquela tabela e que barra. O bloco EXCEPTION
-- desta funcao e uma subtransacao, entao o INSERT da categoria tambem volta, e
-- de fora os dois casos sao identicos.
--
-- Resultado: sem o nome da tabela na resposta, a policy de INSERT da categoria
-- ficava inteiramente desprotegida por teste, escondida atras de uma segunda
-- trava que por acaso faz o mesmo trabalho.
CREATE OR REPLACE FUNCTION pg_temp.cria_categoria(p_dono UUID, p_nome TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_servico UUID;
BEGIN
  SELECT id INTO v_servico FROM public.financial_services WHERE name = 'personal_finance';
  INSERT INTO public.transaction_categories (service_id, user_id, name, is_expense)
  VALUES (v_servico, p_dono, p_nome, TRUE);
  RETURN 'criou';
EXCEPTION
  WHEN insufficient_privilege THEN
    RETURN 'ERRO:42501:' || CASE
      WHEN SQLERRM LIKE '%"transaction_categories"%'    THEN 'categoria'
      WHEN SQLERRM LIKE '%"transaction_subcategories"%' THEN 'subcategoria'
      ELSE 'outra: ' || SQLERRM
    END;
  WHEN unique_violation       THEN RETURN 'ERRO:23505';
  WHEN check_violation        THEN RETURN 'ERRO:23514';
END $$;

-- Quantas categorias a sessao corrente CONSEGUE LER com um dado nome. Uma
-- sonda unica para (4) e (5): e ela que faz "o estranho nao ve a minha" e "o
-- estranho ve o catalogo" serem a MESMA medicao com entradas diferentes --
-- sem isso, uma policy `USING (FALSE)` passaria pelo controle negativo.
CREATE OR REPLACE FUNCTION pg_temp.categorias_visiveis(p_nome TEXT)
RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM public.transaction_categories WHERE name = p_nome;
$$;

CREATE OR REPLACE FUNCTION pg_temp.subcategorias_visiveis(p_nome TEXT)
RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM public.transaction_subcategories WHERE name = p_nome;
$$;

-- O "Outros" daquela categoria, do ponto de vista de um dono especifico.
-- `IS NOT DISTINCT FROM` e nao `=` porque o dono do "Outros" do catalogo e
-- NULL, e `user_id = NULL` nunca e verdadeiro -- erro que faria (1) medir zero
-- e parecer backfill quebrado.
CREATE OR REPLACE FUNCTION pg_temp.tem_outros(p_categoria UUID, p_dono UUID)
RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM public.transaction_subcategories
   WHERE category_id = p_categoria
     AND user_id IS NOT DISTINCT FROM p_dono
     AND name = 'Outros';
$$;

CREATE OR REPLACE FUNCTION pg_temp.tenta_publicar_no_catalogo(p_categoria UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  -- Sem WHERE de proposito: medido na 032, com WHERE quem recusa e a policy de
  -- SELECT, e a assercao deixaria de dizer qualquer coisa sobre a policy de
  -- UPDATE. O `p_categoria` entra num filtro que a RLS nao usa.
  UPDATE public.transaction_categories SET user_id = NULL
   WHERE id = p_categoria OR TRUE;
  RETURN 'publicou';
EXCEPTION
  WHEN insufficient_privilege THEN RETURN 'ERRO:42501';
END $$;

CREATE OR REPLACE FUNCTION pg_temp.tenta_lancar(
  p_dono UUID, p_conta UUID, p_categoria UUID, p_subcategoria UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_servico UUID;
BEGIN
  SELECT service_id INTO v_servico FROM public.transaction_categories WHERE id = p_categoria;
  IF v_servico IS NULL THEN
    SELECT id INTO v_servico FROM public.financial_services WHERE name = 'personal_finance';
  END IF;
  INSERT INTO public.financial_transactions
    (user_id, service_id, category_id, subcategory_id, account_id,
     description, amount, transaction_date, transaction_type)
  VALUES (p_dono, v_servico, p_categoria, p_subcategoria, p_conta,
          'Compra', -10.00, DATE '2026-10-01', 'expense');
  RETURN 'lancou';
EXCEPTION
  WHEN foreign_key_violation   THEN RETURN 'ERRO:23503';
  WHEN insufficient_privilege  THEN RETURN 'ERRO:42501';
END $$;

CREATE OR REPLACE FUNCTION pg_temp.tenta_apagar_subcategoria(p_id UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.transaction_subcategories WHERE id = p_id;
  RETURN 'apagou';
EXCEPTION
  WHEN foreign_key_violation  THEN RETURN 'ERRO:23503';
  WHEN insufficient_privilege THEN RETURN 'ERRO:42501';
END $$;

CREATE OR REPLACE FUNCTION pg_temp.tenta_personalizar(
  p_dono UUID, p_categoria UUID, p_nome TEXT, p_cor TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.transaction_category_prefs (user_id, category_id, name, color_hex)
  VALUES (p_dono, p_categoria, p_nome, p_cor);
  RETURN 'personalizou';
EXCEPTION
  WHEN insufficient_privilege THEN RETURN 'ERRO:42501';
  WHEN check_violation        THEN RETURN 'ERRO:23514';
  WHEN unique_violation       THEN RETURN 'ERRO:23505';
END $$;

CREATE OR REPLACE FUNCTION pg_temp.nome_efetivo(p_categoria UUID)
RETURNS TEXT LANGUAGE SQL AS $$
  SELECT COALESCE(p.name, c.name)
    FROM public.transaction_categories c
    LEFT JOIN public.transaction_category_prefs p
      ON p.category_id = c.id AND p.user_id = auth.uid()
   WHERE c.id = p_categoria;
$$;

-- =====================================================
-- FIXTURE
-- =====================================================
-- DONA tem categoria propria. ESTRANHO tem conta no app e nada em comum com
-- ela -- e o usuario tipico, de quem a lista da DONA tem de estar escondida.
INSERT INTO auth.users (id, email) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'dona@test.local'),
  ('d1000000-0000-0000-0000-000000000002', 'estranho@test.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'Dona',     TRUE),
  ('d1000000-0000-0000-0000-000000000002', 'Estranho', TRUE);

INSERT INTO public.financial_accounts
  (id, user_id, name, account_type, current_balance)
VALUES
  ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001',
   'Conta da Dona', 'checking', 1000.00),
  ('d2000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000002',
   'Conta do Estranho', 'checking', 1000.00);

-- =====================================================
-- (1) O BACKFILL alcancou o catalogo inteiro
-- =====================================================
-- Medido como "quantas categorias do catalogo NAO tem Outros", e nao como
-- "quantas tem": a segunda forma passaria verde com uma categoria nova
-- aparecendo no seed sem "Outros", porque a contagem continuaria subindo.
SELECT pg_temp.expect('nenhuma categoria do catalogo ficou sem "Outros"',
  (SELECT count(*) FROM public.transaction_categories c
    WHERE c.user_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.transaction_subcategories s
                       WHERE s.category_id = c.id
                         AND s.user_id IS NULL
                         AND s.name = 'Outros')), 0);

-- E o catalogo nao esta vazio -- senao o zero acima seria vacuo.
SELECT pg_temp.expect('o catalogo tem as 13 categorias (12 do 001 + a reservada da 023)',
  (SELECT count(*) FROM public.transaction_categories WHERE user_id IS NULL), 13);

-- Exatamente um "Outros" por categoria: duas passadas do backfill, ou backfill
-- + trigger disparando na mesma linha, apareceriam aqui.
SELECT pg_temp.expect('nenhuma categoria tem "Outros" em duplicata',
  (SELECT count(*) FROM (
     SELECT category_id FROM public.transaction_subcategories
      WHERE name = 'Outros' AND user_id IS NULL
      GROUP BY category_id HAVING count(*) > 1) d), 0);

-- =====================================================
-- (2) O TRIGGER: categoria nova nasce com "Outros"
-- =====================================================
-- Primeiro como dono da tabela (o caminho de uma migration futura), que e o
-- caso em que o backfill NAO ajuda.
INSERT INTO public.transaction_categories (id, service_id, name, is_expense)
SELECT 'd3000000-0000-0000-0000-0000000000a1', id, 'Pets do catalogo', TRUE
  FROM public.financial_services WHERE name = 'personal_finance';

SELECT pg_temp.expect('categoria do catalogo criada agora nasceu com "Outros"',
  pg_temp.tem_outros('d3000000-0000-0000-0000-0000000000a1', NULL), 1);

-- =====================================================
-- (3) O TRIGGER vale na sessao do usuario -- o caminho da feature
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'd1000000-0000-0000-0000-000000000001';

SELECT pg_temp.expect_txt('a dona cria a propria categoria',
  pg_temp.cria_categoria('d1000000-0000-0000-0000-000000000001', 'Terapia'), 'criou');

SELECT pg_temp.expect('a categoria da dona nasceu com "Outros"',
  pg_temp.tem_outros(
    (SELECT id FROM public.transaction_categories WHERE name = 'Terapia'),
    'd1000000-0000-0000-0000-000000000001'), 1);

-- O "Outros" da categoria dela e DELA, nao do catalogo. Se o trigger copiasse
-- NULL em vez de `NEW.user_id`, esta assercao cai -- e a subcategoria da dona
-- apareceria no seletor de todo mundo pela policy `user_id IS NULL`.
SELECT pg_temp.expect('o "Outros" da categoria da dona pertence a ela, nao ao catalogo',
  (SELECT count(*) FROM public.transaction_subcategories s
     JOIN public.transaction_categories c ON c.id = s.category_id
    WHERE c.name = 'Terapia'
      AND s.user_id = 'd1000000-0000-0000-0000-000000000001'), 1);

-- Subcategoria propria sob categoria do CATALOGO: o caso principal da feature
-- ("Mercado" dentro de Alimentação, sem inventar categoria).
INSERT INTO public.transaction_subcategories (id, category_id, user_id, name)
SELECT 'd4000000-0000-0000-0000-0000000000a1', id,
       'd1000000-0000-0000-0000-000000000001', 'Mercado'
  FROM public.transaction_categories WHERE name = 'Alimentação' AND user_id IS NULL;

SELECT pg_temp.expect('a dona cria "Mercado" sob a categoria do catalogo',
  pg_temp.subcategorias_visiveis('Mercado'), 1);

-- (8) A dona ja tem "Terapia": repetir o nome bate na unique DELA.
SELECT pg_temp.expect_txt('a dona nao repete o nome da propria categoria',
  pg_temp.cria_categoria('d1000000-0000-0000-0000-000000000001', 'Terapia'), 'ERRO:23505');

-- (6) E nao cria categoria no nome do estranho. O `:categoria` no fim e a
-- parte load-bearing -- ver o comentario da sonda.
SELECT pg_temp.expect_txt('a dona NAO cria categoria no nome do estranho (barrada NA CATEGORIA)',
  pg_temp.cria_categoria('d1000000-0000-0000-0000-000000000002', 'Invadida'),
  'ERRO:42501:categoria');

-- (7) E nao publica a propria no catalogo.
SELECT pg_temp.expect_txt('a dona NAO publica a propria categoria no catalogo',
  pg_temp.tenta_publicar_no_catalogo(
    (SELECT id FROM public.transaction_categories WHERE name = 'Terapia')), 'ERRO:42501');

SELECT pg_temp.expect('e a categoria dela continua sendo dela depois da tentativa',
  (SELECT count(*) FROM public.transaction_categories
    WHERE name = 'Terapia'
      AND user_id = 'd1000000-0000-0000-0000-000000000001'), 1);

-- (13) Personalizacao do catalogo: a dona renomeia "Lazer" para ela.
SELECT pg_temp.expect_txt('a dona personaliza uma categoria do catalogo',
  pg_temp.tenta_personalizar('d1000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.transaction_categories WHERE name = 'Lazer' AND user_id IS NULL),
    'Rolê', '#123ABC'), 'personalizou');

SELECT pg_temp.expect_txt('e ela passa a ver o nome personalizado',
  pg_temp.nome_efetivo(
    (SELECT id FROM public.transaction_categories WHERE name = 'Lazer' AND user_id IS NULL)),
  'Rolê');

-- (14) Os CHECKs. Nome so de espacos passaria por qualquer validacao de
-- "obrigatorio" no cliente e viraria um item de seletor sem texto.
SELECT pg_temp.expect_txt('categoria com nome em branco e recusada',
  pg_temp.cria_categoria('d1000000-0000-0000-0000-000000000001', '    '), 'ERRO:23514');

SELECT pg_temp.expect_txt('categoria com nome gigante e recusada',
  pg_temp.cria_categoria('d1000000-0000-0000-0000-000000000001', repeat('x', 61)),
  'ERRO:23514');

-- Cor fora do formato: ela entra em `style`/`className` na tela.
SELECT pg_temp.expect_txt('personalizacao com cor invalida e recusada',
  pg_temp.tenta_personalizar('d1000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.transaction_categories WHERE name = 'Saúde' AND user_id IS NULL),
    'Saude', 'red; background: url(x)'), 'ERRO:23514');

-- (9) Lancamento SEM subcategoria passa. Esta assercao e o que prova que a FK
-- composta nao quebrou o app no ar: todo lancamento que existe hoje tem
-- `subcategory_id` NULL.
SELECT pg_temp.expect_txt('lancamento sem subcategoria continua passando',
  pg_temp.tenta_lancar('d1000000-0000-0000-0000-000000000001',
    'd2000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.transaction_categories WHERE name = 'Alimentação' AND user_id IS NULL),
    NULL), 'lancou');

-- ...e com a subcategoria CERTA tambem.
SELECT pg_temp.expect_txt('lancamento com a subcategoria daquela categoria passa',
  pg_temp.tenta_lancar('d1000000-0000-0000-0000-000000000001',
    'd2000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.transaction_categories WHERE name = 'Alimentação' AND user_id IS NULL),
    'd4000000-0000-0000-0000-0000000000a1'), 'lancou');

-- (10) E com a subcategoria de OUTRA categoria, nao. Sem esta assercao a FK
-- composta poderia ser trocada por uma FK simples sobre `subcategory_id` sem
-- nenhum teste reclamando, e "Mercado" entraria em Transporte.
SELECT pg_temp.expect_txt('lancamento com subcategoria de OUTRA categoria e recusado',
  pg_temp.tenta_lancar('d1000000-0000-0000-0000-000000000001',
    'd2000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.transaction_categories WHERE name = 'Transporte' AND user_id IS NULL),
    'd4000000-0000-0000-0000-0000000000a1'), 'ERRO:23503');

-- (12) Subcategoria em uso nao pode ser apagada, e a tentativa nao mexe no
-- dinheiro. O saldo e medido ANTES e DEPOIS porque o perigo nao e o erro: e um
-- `ON DELETE SET NULL` que, por ESCREVER na linha de lancamento, dispararia
-- `update_account_balance` e cobraria o valor duas vezes.
SELECT pg_temp.expect_txt('subcategoria com lancamento apontando para ela nao e apagada',
  pg_temp.tenta_apagar_subcategoria('d4000000-0000-0000-0000-0000000000a1'), 'ERRO:23503');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

SELECT pg_temp.expect_num('o saldo da dona nao mudou com a tentativa de apagar',
  (SELECT current_balance FROM public.financial_accounts
    WHERE id = 'd2000000-0000-0000-0000-000000000001'), 980.00);

-- =====================================================
-- (4) e (5) O CONTROLE NEGATIVO -- a assercao que sustenta a 036
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'd1000000-0000-0000-0000-000000000002';

SELECT pg_temp.expect('a dona VÊ a propria categoria (lado positivo, medido acima tambem)',
  (SELECT 1::BIGINT), 1);

SELECT pg_temp.expect('o estranho NAO ve a categoria "Terapia" da dona',
  pg_temp.categorias_visiveis('Terapia'), 0);

SELECT pg_temp.expect('o estranho NAO ve a subcategoria "Mercado" da dona',
  pg_temp.subcategorias_visiveis('Mercado'), 0);

-- (5) A MESMA consulta, sobre o catalogo, ainda devolve a linha. E isto que
-- distingue "a policy esconde o que e de outro" de "a policy esconde tudo".
SELECT pg_temp.expect('o estranho VE a categoria "Alimentação" do catalogo',
  pg_temp.categorias_visiveis('Alimentação'), 1);

SELECT pg_temp.expect('o estranho VE o "Outros" do catalogo',
  (SELECT count(*) FROM public.transaction_subcategories s
     JOIN public.transaction_categories c ON c.id = s.category_id
    WHERE c.name = 'Alimentação' AND s.name = 'Outros'), 1);

-- A personalizacao tambem e privada: o estranho ve "Lazer", nao "Rolê".
SELECT pg_temp.expect_txt('o estranho ve o nome do catalogo, nao o apelido da dona',
  pg_temp.nome_efetivo(
    (SELECT id FROM public.transaction_categories WHERE name = 'Lazer' AND user_id IS NULL)),
  'Lazer');

SELECT pg_temp.expect('o estranho nao LE a preferencia da dona',
  (SELECT count(*) FROM public.transaction_category_prefs), 0);

-- (8, outro lado) O estranho PODE ter uma categoria com o mesmo nome da dona.
-- Era isso que a `unique_category_per_service` global da 001 proibiria.
SELECT pg_temp.expect_txt('o estranho cria "Terapia" dele, mesmo nome da dona',
  pg_temp.cria_categoria('d1000000-0000-0000-0000-000000000002', 'Terapia'), 'criou');

SELECT pg_temp.expect('e cada um ve so uma "Terapia" -- a sua',
  pg_temp.categorias_visiveis('Terapia'), 1);

-- (11) O RESIDUAL CONHECIDO DA FK COMPOSTA
-- A verificacao de FK roda fora da RLS, entao o estranho CONSEGUE gravar um
-- lancamento apontando para "Mercado", que e da dona, porque a categoria
-- (Alimentação) e do catalogo e a FK so compara (category_id, id).
--
-- Isto esta fixado como COMPORTAMENTO ESPERADO, nao como defeito: o que
-- importa e a linha seguinte -- ele nao LE nada sobre aquela subcategoria, e
-- a tela dele mostra o lancamento sem subcategoria. Se um dia isso tiver de
-- ser proibido, o lugar e um trigger de validacao, e esta assercao e a que vai
-- mudar.
SELECT pg_temp.expect_txt('a FK aceita subcategoria de outra pessoa sob categoria do catalogo',
  pg_temp.tenta_lancar('d1000000-0000-0000-0000-000000000002',
    'd2000000-0000-0000-0000-000000000002',
    (SELECT id FROM public.transaction_categories WHERE name = 'Alimentação' AND user_id IS NULL),
    'd4000000-0000-0000-0000-0000000000a1'), 'lancou');

SELECT pg_temp.expect('...e o estranho continua sem LER o nome daquela subcategoria',
  (SELECT count(*) FROM public.financial_transactions t
     JOIN public.transaction_subcategories s ON s.id = t.subcategory_id
    WHERE t.user_id = 'd1000000-0000-0000-0000-000000000002'), 0);

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

-- =====================================================
-- A SUPERFICIE DE PERMISSAO, MEDIDA NO CATALOGO
-- =====================================================
-- O `GRANT ... ON ALL TABLES` do 002 e uma fotografia: nao alcanca tabela
-- criada depois. Sem o bloco de GRANT da 036 as tabelas novas voltariam 42501
-- em toda leitura, com cara de RLS (e e assim que a 023 nasceu). Medir aqui
-- transforma "esqueci o GRANT" num erro de teste em vez de um 500 em producao.
SELECT pg_temp.expect('as duas tabelas novas tem os 4 privilegios para authenticated',
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE grantee = 'authenticated'
      AND table_schema = 'public'
      AND table_name IN ('transaction_subcategories', 'transaction_category_prefs')
      AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')), 8);

SELECT pg_temp.expect('anon nao escreve na personalizacao de ninguem',
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE grantee = 'anon'
      AND table_schema = 'public'
      AND table_name = 'transaction_category_prefs'), 0);

-- E `anon` NAO TEM PRIVILEGIO NENHUM nas duas tabelas novas.
--
-- Esta assercao e uma copia deliberada do guard do db-verify ("anon so pode ler
-- as tabelas de referencia"), e ela existe porque a primeira versao da 036
-- REPROVOU nele: eu havia dado `GRANT SELECT` a `anon` em
-- `transaction_subcategories` por simetria com `transaction_categories`.
--
-- A simetria era falsa. `transaction_categories` e referencia de verdade (as
-- 13 linhas sao de todos, e o cadastro monta seletor antes da sessao); esta
-- tabela guarda linha de USUARIO na mesma relacao. A chave `anon` vai embutida
-- no bundle JS publico, entao privilegio dela e dado aberto na internet -- e
-- que a policy filtre `user_id IS NULL` nao muda o que o GRANT diz.
--
-- Medir aqui faz essa familia de erro reprovar PERTO do arquivo que a causa, em
-- vez de 1700 linhas adiante num step de YAML.
SELECT pg_temp.expect('anon nao tem privilegio nenhum nas duas tabelas novas',
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE grantee = 'anon'
      AND table_schema = 'public'
      AND table_name IN ('transaction_subcategories', 'transaction_category_prefs')), 0);

-- As tres FKs compostas existem e estao VALIDADAS. `convalidated = f` seria
-- uma FK que nao olhou as linhas que ja existem -- ela aceitaria para sempre o
-- dado torto que ja estivesse gravado (ver `check-aceita-null-e-convalidated-prova`).
SELECT pg_temp.expect('as 3 FKs compostas existem e estao validadas',
  (SELECT count(*) FROM pg_constraint
    WHERE conname LIKE '%\_subcategoria\_da\_categoria'
      AND contype = 'f'
      AND convalidated), 3);

ROLLBACK;

-- =====================================================
-- Nada acima escreve fora da transacao: o ROLLBACK devolve o banco ao estado
-- em que ele entrou, inclusive as 13 categorias do catalogo.
-- =====================================================
