-- =====================================================
-- HMO-431 -- a conta que nao soma nos totais (058)
-- =====================================================
-- Roda no db-verify contra o banco que as migrations constroem do zero, com a
-- 058 ja aplicada DUAS vezes (a segunda e o step de idempotencia) e com as
-- duas fixtures da 058 ja comitadas.
--
-- O QUE A 058 ENTREGA
-- -------------------
-- `financial_accounts.include_in_total boolean NOT NULL DEFAULT true`. Nada
-- mais: nenhuma view recolada, nenhum trigger, nenhum CHECK, nenhum backfill.
--
-- POR QUE "A COLUNA EXISTE" NAO PROVA ESTA MIGRATION
-- --------------------------------------------------
-- Esta e a armadilha deste arquivo. `SELECT ... FROM information_schema.columns
-- WHERE column_name = 'include_in_total'` devolvendo 1 linha fica VERDE para
-- todas estas migrations diferentes:
--
--   - `ADD COLUMN include_in_total boolean NOT NULL DEFAULT true`  <- a certa
--   - `ADD COLUMN include_in_total boolean`                        (3 estados)
--   - `ADD COLUMN include_in_total boolean DEFAULT false`          (total zerado)
--   - `ADD COLUMN include_in_total text`                           (soma quebra)
--
-- As tres erradas custam dinheiro na tela, e as tres passam numa assercao de
-- existencia. Por isso a secao 1 afirma o TRIPLO (tipo + nulabilidade +
-- default) numa string unica, e nao a presenca da coluna.
--
-- E nem o triplo basta sozinho: ele le o CATALOGO, e o catalogo nao diz o que
-- aconteceu com as linhas que ja existiam. E o que as secoes 2 e 5 medem, com
-- dado plantado antes da migration (ver os cabecalhos das duas fixtures).
--
-- O que ele fixa, na ordem:
--
--   (1) A FORMA DA COLUNA NO CATALOGO: `boolean`, `NOT NULL`, `DEFAULT true`.
--       E a secao que mata os tres mutantes de declaracao listados acima;
--   (2) A LINHA PRE-EXISTENTE VEIO `true`. A conta de
--       `058_contas_antes_da_058.sql` foi criada ANTES da coluna existir e
--       nunca foi tocada depois. Ela e a unica prova de que a migration nao
--       tirou do total quem ja estava nele -- o mutante `DEFAULT false`
--       sobrevive a secao 1 inteira se o default for lido so no catalogo de
--       uma tabela vazia;
--   (3) CONTROLE POSITIVO DO DEFAULT EM LINHA NOVA: um INSERT que NAO menciona
--       a coluna nasce `true`. E o caminho de `create_default_accounts` e do
--       POST da tela, que nao foram editados por esta migration e nao podem
--       precisar ser;
--   (4) O VALOR `false` GRAVA E VOLTA. A feature propriamente dita: sem esta
--       secao, uma coluna `GENERATED ALWAYS AS (true)` passaria em (1), (2) e
--       (3) e o checkbox da tela nao teria efeito nenhum;
--   (5) O RE-RUN NAO RELIGA A CONTA DESLIGADA. A conta foi desligada entre a
--       primeira e a segunda colagem da 058 (ver
--       `058_conta_desligada_do_total.sql`), e continua desligada. E a secao
--       que mata o `UPDATE ... SET include_in_total = true` de backfill, que e
--       inobservavel em qualquer banco novo;
--   (6) `NULL` E RECUSADO. O `NOT NULL` fecha o terceiro estado -- uma conta
--       com `NULL` aqui sairia dos DOIS lados da conta (`WHERE include_in_total`
--       a descarta, `WHERE NOT include_in_total` tambem), e seria dinheiro
--       invisivel nas duas telas que existem para encontra-lo. Ver
--       `coluna-booleana-anulavel-not-is-false`;
--   (7) O `COMMENT` ESTA NA COLUNA e cita a issue. Nao e enfeite: o comentario
--       e como se prova, por `psql` contra producao, que a 058 foi colada --
--       `migration-049-colada-md5-do-comment-prova`. Sem o COMMENT nao ha
--       sonda possivel para a colagem desta migration, porque ela nao cria
--       funcao nem view cujo `prosrc`/`viewdef` se possa medir.
--
-- CONTROLE NEGATIVO (fora deste arquivo, e medido): num banco que para na 057
-- este teste fica VERMELHO na secao 1, com a string do catalogo vazia. E o que
-- prova que ele mede a 058 e nao o estado basal do banco.
--
-- Rodar num banco limpo, na POSICAO da 058 -- a ordem dos quatro passos nao e
-- negociavel, e o porque esta no cabecalho de `058_conta_desligada_do_total.sql`:
--   psql "$DB_URL" -f database/tests/058_contas_antes_da_058.sql
--   psql "$DB_URL" -f database/migrations/058_conta_fora_dos_totais.sql
--   psql "$DB_URL" -f database/tests/058_conta_desligada_do_total.sql
--   psql "$DB_URL" -f database/migrations/058_conta_fora_dos_totais.sql
--   psql "$DB_URL" -f database/tests/058_conta_fora_dos_totais_test.sql
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
    RAISE EXCEPTION 'FALHA: % -> esperado "%", obtido "%"', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- =====================================================
-- 1. A FORMA DA COLUNA NO CATALOGO: boolean, NOT NULL, DEFAULT true
-- =====================================================
-- O TRIPLO numa string unica, e nao tres assercoes separadas: as tres
-- migrations erradas do cabecalho erram UM dos tres campos cada, e uma string
-- so faz a mensagem de falha mostrar qual.
--
-- `is_nullable` e `column_default` vem como texto do information_schema;
-- `column_default` de um booleano com DEFAULT true e literalmente 'true'.
-- `coalesce` para que a AUSENCIA de default apareca como '(sem default)' na
-- mensagem, em vez de a string inteira virar NULL e a falha dizer "obtido
-- <NULL>" sem apontar qual dos tres campos cedeu.
SELECT pg_temp.expect_txt('include_in_total: tipo, nulabilidade e default',
  (SELECT data_type || ' / '
            || CASE WHEN is_nullable = 'NO' THEN 'NOT NULL' ELSE 'NULAVEL' END
            || ' / ' || coalesce(column_default, '(sem default)')
     FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'financial_accounts'
      AND column_name = 'include_in_total'),
  'boolean / NOT NULL / true');

-- =====================================================
-- 2. A LINHA PRE-EXISTENTE VEIO `true`
-- =====================================================
-- A conta `...001` de `058_contas_antes_da_058.sql` nasceu ANTES de a coluna
-- existir e ninguem a tocou depois. Se o `ADD COLUMN` tivesse sido escrito sem
-- default -- ou com `DEFAULT false` --, e AQUI que aparece: ela teria vindo
-- `NULL` (e o `NOT NULL` da secao 1 nem seria aplicavel) ou `false`.
--
-- O `current_balance` vai na mesma assercao de proposito: ele prova que esta e
-- a conta plantada, e nao uma linha qualquer que algum outro teste da cadeia
-- deixou com o mesmo id. Sem ele, uma fixture que nao rodou daria `NULL` no
-- `include_in_total` e a falha falaria de default, mandando depurar a
-- migration certa.
SELECT pg_temp.expect_txt('a conta de antes da 058 soma nos totais',
  (SELECT include_in_total || ' / ' || current_balance
     FROM public.financial_accounts
    WHERE id = 'f0580000-0000-0000-0000-000000000001'),
  'true / 1234.56');

-- =====================================================
-- 3. CONTROLE POSITIVO: linha NOVA que nao menciona a coluna nasce `true`
-- =====================================================
-- E o caminho de `create_default_accounts` (001/056) e do POST de
-- `/api/financial-accounts`, que esta migration nao editou. Se o default
-- valesse so para as linhas antigas -- um backfill em vez de um DEFAULT de
-- catalogo --, toda conta criada depois da migration nasceria fora dos totais.
INSERT INTO auth.users (id, email) VALUES
  ('a0580000-0000-0000-0000-000000000001', 'depois-da-058@test.local');

INSERT INTO public.financial_accounts
  (id, user_id, name, account_type, current_balance) VALUES
  ('f0580000-0000-0000-0000-00000000000a',
   'a0580000-0000-0000-0000-000000000001', 'Conta nova', 'checking', 500.00);

SELECT pg_temp.expect_txt('conta nova nasce somando nos totais',
  (SELECT include_in_total::text FROM public.financial_accounts
    WHERE id = 'f0580000-0000-0000-0000-00000000000a'),
  'true');

-- =====================================================
-- 4. O VALOR `false` GRAVA E VOLTA
-- =====================================================
-- A feature propriamente dita. Sem esta secao, uma coluna
-- `GENERATED ALWAYS AS (true) STORED` passa em (1), (2) e (3) -- e o checkbox
-- da tela nao faria nada, com o POST respondendo 200.
UPDATE public.financial_accounts
   SET include_in_total = FALSE
 WHERE id = 'f0580000-0000-0000-0000-00000000000a';

SELECT pg_temp.expect_txt('a conta pode sair dos totais',
  (SELECT include_in_total::text FROM public.financial_accounts
    WHERE id = 'f0580000-0000-0000-0000-00000000000a'),
  'false');

-- E volta a somar: o checkbox e de duas vias. Um CHECK ou trigger que so
-- aceitasse o caminho de desligar passaria na assercao de cima.
UPDATE public.financial_accounts
   SET include_in_total = TRUE
 WHERE id = 'f0580000-0000-0000-0000-00000000000a';

SELECT pg_temp.expect_txt('e pode voltar a somar',
  (SELECT include_in_total::text FROM public.financial_accounts
    WHERE id = 'f0580000-0000-0000-0000-00000000000a'),
  'true');

-- =====================================================
-- 5. O RE-RUN DA MIGRATION NAO RELIGA A CONTA DESLIGADA
-- =====================================================
-- A conta `...002` foi desligada por `058_conta_desligada_do_total.sql` ENTRE
-- as duas colagens da 058. Se a migration tivesse um `UPDATE ... SET
-- include_in_total = true` de backfill, a segunda colagem a teria religado --
-- e no app isso e "meu patrimonio subiu sozinho" semanas depois, sem nada que
-- ligue o sintoma a uma colagem de SQL.
--
-- ESTA SECAO E A UNICA QUE MEDE ISSO, e ela depende da POSICAO dos steps no
-- db-verify. Se o step do re-run for movido para antes da fixture que desliga
-- a conta, esta assercao continua VERDE e para de controlar -- o modo de falha
-- de `guarda-de-ancora-verde-nao-prova-que-o-mutante-morre`. O cabecalho de
-- `058_conta_desligada_do_total.sql` registra a ordem exigida.
SELECT pg_temp.expect_txt('a conta desligada continua fora do total depois do re-run',
  (SELECT include_in_total::text FROM public.financial_accounts
    WHERE id = 'f0580000-0000-0000-0000-000000000002'),
  'false');

-- =====================================================
-- 6. `NULL` E RECUSADO
-- =====================================================
-- O terceiro estado nao tem dono: `NULL` nao e `true` nem `false`, entao
-- `WHERE include_in_total` DESCARTA a linha e `WHERE NOT include_in_total`
-- tambem a descarta. Uma conta com `NULL` aqui nao somaria nos totais E nao
-- apareceria na lista de contas fora do total.
--
-- O UPDATE roda num bloco com EXCEPTION para que a recusa seja o resultado
-- ESPERADO sem abortar a transacao do arquivo. `not_null_violation` e 23502.
DO $$
DECLARE
  recusou BOOLEAN := FALSE;
BEGIN
  BEGIN
    UPDATE public.financial_accounts
       SET include_in_total = NULL
     WHERE id = 'f0580000-0000-0000-0000-00000000000a';
  EXCEPTION WHEN not_null_violation THEN
    recusou := TRUE;
  END;

  IF NOT recusou THEN
    RAISE EXCEPTION
      'FALHA: o banco aceitou include_in_total = NULL -- a coluna tem tres estados e o total perde a conta nos dois lados';
  END IF;

  RAISE NOTICE 'ok: NULL e recusado (23502)';
END $$;

-- =====================================================
-- 7. O `COMMENT` ESTA NA COLUNA E CITA A ISSUE
-- =====================================================
-- E a sonda de colagem desta migration em producao: a 058 nao cria funcao nem
-- view, entao nao ha `prosrc` nem `viewdef` para medir, e o comentario e a
-- unica coisa que ela deixa no catalogo alem da coluna.
-- `position(... in ...) > 0` em vez do texto inteiro: fixar o comentario byte a
-- byte faria qualquer melhoria de redacao reprovar o CI.
SELECT pg_temp.expect('o COMMENT da coluna cita a HMO-431',
  (SELECT count(*)
     FROM pg_description d
     JOIN pg_class c ON c.oid = d.objoid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid
    WHERE n.nspname = 'public'
      AND c.relname = 'financial_accounts'
      AND a.attname = 'include_in_total'
      AND position('HMO-431' in d.description) > 0), 1);

DO $$ BEGIN RAISE NOTICE '058: todas as assercoes passaram'; END $$;

ROLLBACK;

-- =====================================================
-- O ROLLBACK devolve o banco ao estado em que ele entrou: o usuario e a conta
-- das secoes 3/4/6 desaparecem. As duas contas das fixtures (`...001` e
-- `...002`) NAO sao tocadas por este arquivo e seguem comitadas, como as
-- fixtures as deixaram.
-- =====================================================
