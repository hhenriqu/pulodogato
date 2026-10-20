-- =====================================================
-- HMO-432 -- o elo conta de investimento <-> ativo (059)
-- =====================================================
-- Roda no db-verify contra o banco que as migrations constroem do zero, com a
-- 059 ja aplicada DUAS vezes (a segunda e o step de idempotencia) e com as duas
-- fixtures da 059 ja comitadas.
--
-- O QUE A 059 ENTREGA
-- -------------------
-- `investment_assets.account_id uuid` NULAVEL, FK para `financial_accounts (id)`
-- com `ON DELETE SET NULL`, a trigger `investment_assets_conta_trava` (conta do
-- mesmo dono e de investimento, tolerando `NULL`) e um indice em `account_id`.
-- Nada mais: nenhuma view recolada, nenhum backfill.
--
-- POR QUE "A COLUNA EXISTE" NAO PROVA ESTA MIGRATION
-- --------------------------------------------------
-- `SELECT ... FROM information_schema.columns WHERE column_name = 'account_id'`
-- devolvendo 1 linha fica VERDE para todas estas migrations diferentes:
--
--   - a certa;
--   - a mesma SEM a trigger          -> o ativo atrela na conta de QUALQUER UM;
--   - a mesma com `ON DELETE CASCADE` -> apagar a conta APAGA a carteira;
--   - a mesma com a trigger exigindo conta valida sempre (sem o `IS NULL`)
--                                     -> a conta de investimento fica
--                                        impossivel de apagar;
--   - a mesma com um backfill adivinhado -> a posicao da corretora A aparece
--                                        dentro da corretora B.
--
-- As quatro erradas custam dinheiro ou funcao, e as quatro passam numa assercao
-- de existencia. Por isso a secao 1 afirma a FORMA (tipo, nulabilidade,
-- `confdeltype` da FK, presenca da trigger e do indice) e as secoes 3 e 4 medem
-- COMPORTAMENTO, com recusa E aceitacao.
--
-- E nem isso basta: o catalogo nao diz o que aconteceu com as linhas que ja
-- existiam. E o que as secoes 2 e 5 medem, com dado plantado antes da migration
-- (ver os cabecalhos das duas fixtures).
--
-- O que ele fixa, na ordem:
--
--   (1) A FORMA NO CATALOGO: `uuid`, NULAVEL, FK com `SET NULL`, a trigger
--       `BEFORE INSERT OR UPDATE`, e o indice. Cada item mata um mutante de
--       declaracao da lista acima;
--   (2) O ATIVO PRE-EXISTENTE CONTINUA SOLTO. O `...a1` de
--       `059_ativos_antes_da_059.sql` foi criado ANTES da coluna existir e nunca
--       foi tocado depois, com DUAS contas de investimento disponiveis para um
--       backfill adivinhar. E a secao que mata o `UPDATE ... SET account_id =
--       (SELECT ... LIMIT 1)`, inobservavel em qualquer banco novo;
--   (3) AS RECUSAS DA TRAVA: conta de OUTRO DONO, conta `checking` do proprio
--       dono, e conta que nao existe -- no INSERT e no UPDATE. Sem a conta
--       `checking` DO PROPRIO dono, a recusa poderia estar vindo do dono e nao
--       do tipo, e uma trava que esquecesse o `account_type` ficaria verde;
--   (4) AS ACEITACOES, que e o que distingue a trava certa da trava larga ao
--       contrario: `NULL` entra, a conta de investimento do proprio dono entra,
--       e APAGAR A CONTA deixa o ativo VIVO e SOLTO. Esta ultima e a mais
--       importante do arquivo: ela prova o `SET NULL` (contra `CASCADE`, que
--       apagaria a carteira) E prova que a trigger tolera o `NULL` que o proprio
--       `SET NULL` grava (contra a trava sem o `IS NULL`, que trancaria o
--       `DELETE` da conta);
--   (5) O RE-RUN NAO SOLTA O ATIVO ATRELADO. O `...a2` foi atrelado entre a
--       primeira e a segunda colagem da 059 (ver `059_ativo_ligado_a_conta.sql`)
--       e continua na Corretora A. E a secao que mata o `UPDATE ... SET
--       account_id = NULL` de "limpeza", que o `...a1` da secao 2 nao delataria;
--   (6) A IDEMPOTENCIA NAO DUPLICOU OBJETO: uma FK e uma trigger, nao duas. O
--       par `DROP ... IF EXISTS` + `ADD` tem de ser exatamente isso;
--   (7) O `COMMENT` ESTA NA COLUNA e cita a issue. Nao e enfeite: o comentario
--       e como se prova, por `psql` contra producao, que a 059 foi colada --
--       `migration-049-colada-md5-do-comment-prova`.
--
-- CONTROLE NEGATIVO (fora deste arquivo, e medido): num banco que para na 058
-- este teste fica VERMELHO na secao 1, com a string do catalogo vazia. E o que
-- prova que ele mede a 059 e nao o estado basal do banco.
--
-- Rodar num banco limpo, na POSICAO da 059 -- a ordem dos quatro passos nao e
-- negociavel, e o porque esta no cabecalho de `059_ativo_ligado_a_conta.sql`:
--   psql "$DB_URL" -f database/tests/059_ativos_antes_da_059.sql
--   psql "$DB_URL" -f database/migrations/059_conta_do_ativo_de_investimento.sql
--   psql "$DB_URL" -f database/tests/059_ativo_ligado_a_conta.sql
--   psql "$DB_URL" -f database/migrations/059_conta_do_ativo_de_investimento.sql
--   psql "$DB_URL" -f database/tests/hmo432_conta_investimento_test.sql
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

-- O que RECUSA, com o SQLSTATE certo. Conferir o codigo e nao so "deu erro"
-- importa: um erro de digitacao no uuid tambem "da erro", e com a assercao
-- larga a trava poderia nunca ter sido chamada.
CREATE OR REPLACE FUNCTION pg_temp.expect_recusa(label TEXT, sql TEXT, sqlstate_esperado TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> sqlstate_esperado THEN
      RAISE EXCEPTION 'FALHA: % -> recusou com % e nao com % (%)', label, SQLSTATE, sqlstate_esperado, SQLERRM;
    END IF;
    RAISE NOTICE 'ok: % (recusado com %)', label, sqlstate_esperado;
    RETURN;
  END;
  RAISE EXCEPTION 'FALHA: % -> o banco ACEITOU, e devia recusar com %', label, sqlstate_esperado;
END $$;

-- O que PASSA. Existe porque "nao deu erro" precisa ser afirmado tambem: uma
-- trava escrita larga demais fica verde em todo teste que so mede recusa.
CREATE OR REPLACE FUNCTION pg_temp.expect_aceita(label TEXT, sql TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RAISE NOTICE 'ok: % (aceito)', label;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FALHA: % -> o banco RECUSOU (% %), e devia aceitar', label, SQLSTATE, SQLERRM;
END $$;

-- =====================================================
-- 1. A FORMA NO CATALOGO
-- =====================================================
-- O PAR tipo + nulabilidade numa string unica, e nao duas assercoes separadas:
-- a mensagem de falha mostra qual dos dois cedeu. `NULAVEL` e afirmado, e nao
-- assumido -- um `NOT NULL` aqui exigiria backfill e e o defeito que o
-- cabecalho da migration argumenta contra.
SELECT pg_temp.expect_txt('account_id: tipo e nulabilidade',
  (SELECT data_type || ' / '
            || CASE WHEN is_nullable = 'NO' THEN 'NOT NULL' ELSE 'NULAVEL' END
     FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'investment_assets'
      AND column_name = 'account_id'),
  'uuid / NULAVEL');

-- A FK e o `SET NULL` dela. `confdeltype` vem do catalogo: 'n' = SET NULL,
-- 'c' = CASCADE, 'a' = NO ACTION, 'r' = RESTRICT. O mutante `CASCADE` apaga a
-- carteira de quem apagou uma conta, e a assercao de "existe FK" nao o ve.
-- `confrelid` junto, para que a FK apontar para a tabela errada apareca aqui.
SELECT pg_temp.expect_txt('a FK aponta para financial_accounts e e ON DELETE SET NULL',
  -- `confdeltype::text` explicito: a coluna e do tipo `"char"` (1 byte, nao
  -- `text`), e `text || "char"` deixa o Postgres sem candidato unico de
  -- operador -- erro 42725, nao assercao vermelha.
  (SELECT confrelid::regclass::text || ' / ' || confdeltype::text
     FROM pg_constraint
    WHERE conrelid = 'public.investment_assets'::regclass
      AND conname = 'investment_assets_account_id_fkey'),
  'financial_accounts / n');

-- A trigger, com o MOMENTO e os EVENTOS dela. `BEFORE` importa: uma trigger
-- `AFTER` tambem recusaria (a excecao desfaz a transacao), mas `BEFORE` e o que
-- a faz correr antes da checagem da FK -- e por isso que um uuid inexistente sai
-- como `23514` da trava e nao como `23503` da FK, que e o que a secao 3 afirma.
-- `tgtype` e um bitmap: bit 0 = ROW, bit 1 = BEFORE, bit 2 = INSERT,
-- bit 4 = UPDATE. ROW+BEFORE+INSERT+UPDATE = 1+2+4+16 = 23.
SELECT pg_temp.expect_txt('a trigger e BEFORE INSERT OR UPDATE, FOR EACH ROW',
  (SELECT tgtype::int::text
     FROM pg_trigger
    WHERE tgrelid = 'public.investment_assets'::regclass
      AND tgname = 'investment_assets_conta_trava'
      AND NOT tgisinternal),
  '23');

-- A funcao da trava e `SECURITY DEFINER` com `search_path` fixo, e nao
-- alcancavel por `anon`/`authenticated`. Os tres numa string: `prosecdef`, o
-- `proconfig`, e se sobrou privilegio de execucao para as duas roles publicas.
SELECT pg_temp.expect_txt('a funcao da trava e SECURITY DEFINER, search_path fixo e sem EXECUTE publico',
  (SELECT CASE WHEN p.prosecdef THEN 'definer' ELSE 'invoker' END
            || ' / ' || coalesce(array_to_string(p.proconfig, ','), '(sem proconfig)')
            || ' / execute=' || (
                 has_function_privilege('anon',          p.oid, 'EXECUTE')::text
                 || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'investment_assets_conta_trava'),
  'definer / search_path=public, pg_temp / execute=falsefalse');

-- O indice que a Fase 2 vai usar, CHEIO (sem `indpred`): um indice parcial
-- `WHERE account_id IS NOT NULL` nao serve a leitura dos ativos SOLTOS, que e
-- a outra metade da tela da Fase 3. Ver o cabecalho da migration.
SELECT pg_temp.expect_txt('o indice de account_id existe e e cheio',
  (SELECT i.indexrelid::regclass::text || ' / '
            || CASE WHEN i.indpred IS NULL THEN 'cheio' ELSE 'parcial' END
     FROM pg_index i
    WHERE i.indrelid = 'public.investment_assets'::regclass
      AND i.indexrelid::regclass::text = 'investment_assets_account_id_idx'),
  'investment_assets_account_id_idx / cheio');

-- =====================================================
-- 2. O ATIVO PRE-EXISTENTE CONTINUA SOLTO
-- =====================================================
-- O `...a1` de `059_ativos_antes_da_059.sql` nasceu ANTES de a coluna existir e
-- ninguem o tocou depois -- com DUAS contas de investimento do mesmo dono no
-- banco, prontas para um backfill adivinhar. Se a migration tivesse um
-- `UPDATE ... SET account_id = (SELECT ... LIMIT 1)`, e AQUI que aparece.
--
-- Afirma as DUAS coisas: que a linha esta viva (1) e que o elo e `NULL`. Sem a
-- primeira, um `DELETE` acidental na migration deixaria a segunda verde por
-- vacuo -- zero linhas nao tem `account_id` errado.
SELECT pg_temp.expect('o ativo ...a1 pre-existente esta VIVO',
  (SELECT count(*) FROM public.investment_assets
    WHERE id = 'a5590000-0000-0000-0000-0000000000a1'), 1);

SELECT pg_temp.expect_txt('o ativo ...a1 pre-existente continua SOLTO (sem backfill adivinhado)',
  (SELECT coalesce(account_id::text, 'NULL') FROM public.investment_assets
    WHERE id = 'a5590000-0000-0000-0000-0000000000a1'),
  'NULL');

-- =====================================================
-- Fixture das secoes 3 e 4 (dentro da transacao -- some no ROLLBACK)
-- =====================================================
--   X = o dono do ativo   (uma conta de investimento + uma conta corrente)
--   Y = outra pessoa      (uma conta de investimento -- o controle do dono)
--
-- Y tem conta de investimento, e nao "nenhuma conta": com uma conta corrente,
-- a recusa da secao 3 poderia estar vindo do `account_type` e nao do dono, e
-- uma trava que esquecesse `a.user_id = NEW.user_id` ficaria verde.
INSERT INTO auth.users (id, email) VALUES
  ('b4320000-0000-0000-0000-0000000432aa', 'x432@ci.local'),
  ('b4320000-0000-0000-0000-0000000432bb', 'y432@ci.local');

INSERT INTO public.profiles (id, email, full_name, is_public) VALUES
  ('b4320000-0000-0000-0000-0000000432aa', 'x432@ci.local', 'X, o dono do ativo', FALSE),
  ('b4320000-0000-0000-0000-0000000432bb', 'y432@ci.local', 'Y, a outra pessoa',   FALSE);

INSERT INTO public.financial_accounts
  (id, user_id, name, account_type, icon, color_hex, current_balance) VALUES
  ('c4320000-0000-0000-0000-00000432aa01', 'b4320000-0000-0000-0000-0000000432aa',
   'Corretora do X',      'investment', 'trending-up', '#8B5CF6', 1000.00),
  ('c4320000-0000-0000-0000-00000432aa02', 'b4320000-0000-0000-0000-0000000432aa',
   'Conta Corrente do X', 'checking',   'building',    '#10B981',  500.00),
  ('c4320000-0000-0000-0000-00000432bb01', 'b4320000-0000-0000-0000-0000000432bb',
   'Corretora do Y',      'investment', 'trending-up', '#6366F1', 2000.00);

-- =====================================================
-- 3. AS RECUSAS DA TRAVA
-- =====================================================
-- Conta de OUTRO DONO. O caso que faz a feature inteira ser sobre dinheiro: sem
-- esta trava, um ativo meu fica custodiado na corretora de outra pessoa.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('conta de OUTRO DONO e recusada no INSERT', $sql$
  INSERT INTO public.investment_assets (user_id, symbol, name, type, account_id)
  VALUES ('b4320000-0000-0000-0000-0000000432aa', 'VALE3', 'Vale', 'stock',
          'c4320000-0000-0000-0000-00000432bb01')
$sql$, '23514'); END $$;

-- Conta `checking` DO PROPRIO DONO. E o controle que separa as duas metades da
-- trava: aqui o dono esta certo e so o tipo esta errado.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('conta checking do PROPRIO dono e recusada no INSERT', $sql$
  INSERT INTO public.investment_assets (user_id, symbol, name, type, account_id)
  VALUES ('b4320000-0000-0000-0000-0000000432aa', 'VALE3', 'Vale', 'stock',
          'c4320000-0000-0000-0000-00000432aa02')
$sql$, '23514'); END $$;

-- Conta que NAO EXISTE. Sai como `23514` da trava, e nao como `23503` da FK,
-- porque a trigger e `BEFORE` -- ela corre antes da checagem da constraint. A
-- assercao fixa isso: se alguem trocar a trigger para `AFTER`, este codigo
-- muda para 23503 e o teste delata.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('conta INEXISTENTE e recusada pela trava, antes da FK', $sql$
  INSERT INTO public.investment_assets (user_id, symbol, name, type, account_id)
  VALUES ('b4320000-0000-0000-0000-0000000432aa', 'VALE3', 'Vale', 'stock',
          'c4320000-0000-0000-0000-00000000dead')
$sql$, '23514'); END $$;

-- O ativo que vai servir ao UPDATE e a secao 4: nasce SOLTO.
--
-- Vai dentro de `expect_aceita` e nao como INSERT cru de proposito. Ele e o
-- PRIMEIRO `account_id = NULL` do arquivo, entao e nele que a trava sem a
-- clausula `IS NULL` morre -- e um INSERT cru morreria com a mensagem da
-- trigger em vez de com uma `FALHA:` rotulada, mandando quem for ler o vermelho
-- procurar defeito na fixture em vez de na trava.
DO $$ BEGIN PERFORM pg_temp.expect_aceita('o ativo de apoio nasce SOLTO (account_id NULL)', $sql$
  INSERT INTO public.investment_assets (id, user_id, symbol, name, type, account_id)
  VALUES ('d4320000-0000-0000-0000-0000000432a1',
          'b4320000-0000-0000-0000-0000000432aa', 'ITUB4', 'Itau', 'stock', NULL)
$sql$); END $$;

-- Repontar para a conta corrente DEPOIS de criado tambem bate na trava: o
-- UPDATE e conferido, e nao so o INSERT. Sem esta assercao, uma trava so de
-- INSERT ficaria verde em todas as de cima -- e o caminho do app e justamente
-- um UPDATE (a tela da Fase 3 atrela um ativo que ja existe).
DO $$ BEGIN PERFORM pg_temp.expect_recusa('repontar para a conta corrente no UPDATE e recusado', $sql$
  UPDATE public.investment_assets
     SET account_id = 'c4320000-0000-0000-0000-00000432aa02'
   WHERE id = 'd4320000-0000-0000-0000-0000000432a1'
$sql$, '23514'); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_recusa('repontar para a conta de OUTRO DONO no UPDATE e recusado', $sql$
  UPDATE public.investment_assets
     SET account_id = 'c4320000-0000-0000-0000-00000432bb01'
   WHERE id = 'd4320000-0000-0000-0000-0000000432a1'
$sql$, '23514'); END $$;

-- =====================================================
-- 4. AS ACEITACOES
-- =====================================================
-- `account_id = NULL` entra. E o estado de todo ativo de producao depois da
-- colagem, e o caminho de quem cadastra ativo sem escolher conta -- que e o
-- unico caminho que existe no app ate a Fase 3.
-- O id e cravado: este ativo (solto) e reusado mais abaixo, na assercao de que
-- re-atrelar a uma conta que deixou de ser `investment` e recusado.
DO $$ BEGIN PERFORM pg_temp.expect_aceita('account_id NULL e ACEITO no INSERT', $sql$
  INSERT INTO public.investment_assets (id, user_id, symbol, name, type, account_id)
  VALUES ('d4320000-0000-0000-0000-0000000432a2',
          'b4320000-0000-0000-0000-0000000432aa', 'BBAS3', 'BB', 'stock', NULL)
$sql$); END $$;

-- Nem mencionar a coluna tambem entra: e o INSERT que o POST da carteira faz
-- hoje, e ele nao pode precisar ser editado por esta migration.
DO $$ BEGIN PERFORM pg_temp.expect_aceita('INSERT que NAO MENCIONA account_id e ACEITO', $sql$
  INSERT INTO public.investment_assets (user_id, symbol, name, type)
  VALUES ('b4320000-0000-0000-0000-0000000432aa', 'WEGE3', 'Weg', 'stock')
$sql$); END $$;

-- O CAMINHO FELIZES, e o que a issue-mae pede: conta de investimento do proprio
-- dono. Sem esta assercao, uma trava escrita ao contrario (que recusasse tudo)
-- ficaria verde na secao 3 inteira.
DO $$ BEGIN PERFORM pg_temp.expect_aceita('conta de investimento do PROPRIO dono e ACEITA no UPDATE', $sql$
  UPDATE public.investment_assets
     SET account_id = 'c4320000-0000-0000-0000-00000432aa01'
   WHERE id = 'd4320000-0000-0000-0000-0000000432a1'
$sql$); END $$;

SELECT pg_temp.expect_txt('depois do UPDATE aceito, o elo esta gravado',
  (SELECT account_id::text FROM public.investment_assets
    WHERE id = 'd4320000-0000-0000-0000-0000000432a1'),
  'c4320000-0000-0000-0000-00000432aa01');

-- Voltar para `NULL` -- desatrelar pela tela -- tambem entra.
DO $$ BEGIN PERFORM pg_temp.expect_aceita('desatrelar (voltar para NULL) no UPDATE e ACEITO', $sql$
  UPDATE public.investment_assets SET account_id = NULL
   WHERE id = 'd4320000-0000-0000-0000-0000000432a1'
$sql$); END $$;

-- Mexer em OUTRA coluna de um ativo atrelado nao re-pergunta nada: e a janela
-- do `IS NOT DISTINCT FROM` da trigger. Para medi-la, o ativo e atrelado de
-- novo e o UPDATE seguinte so toca o preco.
UPDATE public.investment_assets
   SET account_id = 'c4320000-0000-0000-0000-00000432aa01'
 WHERE id = 'd4320000-0000-0000-0000-0000000432a1';

DO $$ BEGIN PERFORM pg_temp.expect_aceita('editar o preco de um ativo ATRELADO e ACEITO', $sql$
  UPDATE public.investment_assets
     SET current_price = 33.70, current_price_at = now()
   WHERE id = 'd4320000-0000-0000-0000-0000000432a1'
$sql$); END $$;

-- E a janela vale mesmo quando a conta DEIXOU de ser de investimento. Este e o
-- caso que o cabecalho da migration usa para justificar o
-- `IS NOT DISTINCT FROM`, e sem esta assercao aquela justificativa seria uma
-- afirmacao nao medida: uma trigger que re-validasse todo UPDATE trancaria o
-- ativo pendurado numa conta cujo tipo mudou, e a unica saida seria mexer no
-- banco a mao. Nenhuma outra assercao deste arquivo a delata -- com a conta
-- ainda `investment`, a re-validacao passa e o mutante sobrevive.
UPDATE public.financial_accounts SET account_type = 'checking'
 WHERE id = 'c4320000-0000-0000-0000-00000432aa01';

DO $$ BEGIN PERFORM pg_temp.expect_aceita('a conta deixou de ser investment, e o ativo dela segue EDITAVEL', $sql$
  UPDATE public.investment_assets
     SET current_price = 34.10, current_price_at = now()
   WHERE id = 'd4320000-0000-0000-0000-0000000432a1'
$sql$); END $$;

-- Mas ATRELAR de novo a essa conta ja nao da: o tipo e requisito para escolher
-- a conta, nao para continuar editando o ativo. As duas assercoes juntas sao o
-- que fixa a largura exata da janela.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('re-atrelar a uma conta que deixou de ser investment e recusado', $sql$
  UPDATE public.investment_assets
     SET account_id = 'c4320000-0000-0000-0000-00000432aa01'
   WHERE id = 'd4320000-0000-0000-0000-0000000432a2'
$sql$, '23514'); END $$;

-- De volta a `investment`, para que a secao 4.1 apague de fato uma conta DE
-- INVESTIMENTO -- que e o cenario que ela afirma medir.
UPDATE public.financial_accounts SET account_type = 'investment'
 WHERE id = 'c4320000-0000-0000-0000-00000432aa01';

-- -----------------------------------------------------
-- 4.1 APAGAR A CONTA DEIXA O ATIVO VIVO E SOLTO
-- -----------------------------------------------------
-- A assercao mais importante do arquivo, e ela mata DOIS mutantes de uma vez:
--
--   * `ON DELETE CASCADE` em vez de `SET NULL` -> o `DELETE` e ACEITO e o ativo
--     DESAPARECE junto com a conta. A carteira de quem so quis arrumar a lista
--     de contas vai embora, com o historico de movimentacoes pendurado nela;
--   * a trava SEM a clausula `IS NULL` -> o `DELETE` e RECUSADO com `23514`,
--     porque o UPDATE que o `SET NULL` gera bate na propria trava. A conta de
--     investimento fica impossivel de apagar, com um erro vindo de uma tabela
--     que a pessoa nem mencionou.
--
-- Por isso sao tres afirmacoes, e nao uma: o DELETE passa, a linha do ativo
-- SOBREVIVE, e o elo virou `NULL`.
DO $$ BEGIN PERFORM pg_temp.expect_aceita('apagar a conta de investimento e ACEITO', $sql$
  DELETE FROM public.financial_accounts
   WHERE id = 'c4320000-0000-0000-0000-00000432aa01'
$sql$); END $$;

SELECT pg_temp.expect('depois do DELETE da conta, o ativo esta VIVO',
  (SELECT count(*) FROM public.investment_assets
    WHERE id = 'd4320000-0000-0000-0000-0000000432a1'), 1);

SELECT pg_temp.expect_txt('depois do DELETE da conta, o ativo esta SOLTO',
  (SELECT coalesce(account_id::text, 'NULL') FROM public.investment_assets
    WHERE id = 'd4320000-0000-0000-0000-0000000432a1'),
  'NULL');

-- =====================================================
-- 5. O RE-RUN NAO SOLTA O ATIVO ATRELADO
-- =====================================================
-- O `...a2` foi atrelado a Corretora A por `059_ativo_ligado_a_conta.sql`, ENTRE
-- as duas colagens da 059 (ver o cabecalho daquele arquivo para a ordem). A
-- segunda colagem ja aconteceu quando este teste roda.
--
-- Esta e a secao que mata o `UPDATE ... SET account_id = NULL` de "limpeza" no
-- fim da migration. Em producao a migration e colada a mao e colar duas vezes
-- acontece: aquele mutante desatrelaria a carteira inteira na segunda colagem,
-- calado.
SELECT pg_temp.expect_txt('o re-run da 059 NAO soltou o ativo ...a2 atrelado',
  (SELECT coalesce(account_id::text, 'NULL') FROM public.investment_assets
    WHERE id = 'a5590000-0000-0000-0000-0000000000a2'),
  'f0590000-0000-0000-0000-000000000001');

-- E nao e que o re-run "nao escreve nada": o `...a1` da secao 2 continua `NULL`
-- e o `...a2` continua na Corretora A. As duas direcoes estao afirmadas, cada
-- uma por uma linha diferente -- um mutante que escrevesse em uma delas nao
-- pode se esconder na outra.

-- =====================================================
-- 6. A IDEMPOTENCIA NAO DUPLICOU OBJETO
-- =====================================================
-- Uma FK e uma trigger, nao duas. O `ADD CONSTRAINT` sem o `DROP ... IF EXISTS`
-- antes estouraria `42710` na segunda colagem (o step de idempotencia ficaria
-- vermelho antes de chegar aqui), mas um `ADD CONSTRAINT` com nome DIFERENTE a
-- cada passada -- ou deixado ao gerador do Postgres -- criaria a segunda FK
-- calado, e so esta secao a ve.
SELECT pg_temp.expect('UMA so FK de account_id em investment_assets',
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.investment_assets'::regclass
      AND contype = 'f'
      AND confrelid = 'public.financial_accounts'::regclass), 1);

SELECT pg_temp.expect('UMA so trigger de trava em investment_assets',
  (SELECT count(*) FROM pg_trigger
    WHERE tgrelid = 'public.investment_assets'::regclass
      AND NOT tgisinternal
      AND tgname = 'investment_assets_conta_trava'), 1);

-- =====================================================
-- 7. O COMMENT, QUE E A SONDA DE COLAGEM EM PRODUCAO
-- =====================================================
-- Esta migration nao cria view, e a funcao dela e nova -- entao a maneira de
-- provar por `psql` que ela foi colada em producao e o comentario da coluna.
-- Sem ele nao ha sonda possivel. Ver
-- `migration-049-colada-md5-do-comment-prova`.
SELECT pg_temp.expect('o COMMENT da coluna account_id existe e cita a HMO-432',
  (SELECT count(*) FROM pg_description d
     JOIN pg_class c      ON c.oid = d.objoid
     JOIN pg_attribute a  ON a.attrelid = c.oid AND a.attnum = d.objsubid
    WHERE c.relname = 'investment_assets'
      AND a.attname = 'account_id'
      AND d.description LIKE '%HMO-432%'), 1);

SELECT pg_temp.expect('o COMMENT da funcao da trava existe e cita a HMO-432',
  (SELECT count(*) FROM pg_description d
     JOIN pg_proc p ON p.oid = d.objoid
    WHERE p.proname = 'investment_assets_conta_trava'
      AND d.description LIKE '%HMO-432%'), 1);

ROLLBACK;
