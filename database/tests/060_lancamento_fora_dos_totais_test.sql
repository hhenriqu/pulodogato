-- =====================================================
-- HMO-443 -- o lancamento que nao soma nos totais (060)
-- =====================================================
-- Roda no db-verify contra o banco que as migrations constroem do zero, com a
-- 060 ja aplicada DUAS vezes (a segunda e o step de idempotencia) e com as duas
-- fixtures da 060 ja comitadas.
--
-- O QUE A 060 ENTREGA
-- -------------------
--   (a) `financial_transactions.include_in_total boolean NOT NULL DEFAULT true`;
--   (b) `AND t.include_in_total` no WHERE de `category_monthly_totals`, que e o
--       UNICO ponto de entrada de uma cadeia de cinco views;
--   (c) o `security_invoker` de volta na view recolada.
--
-- POR QUE "A COLUNA EXISTE" NAO PROVA ESTA MIGRATION
-- --------------------------------------------------
-- `SELECT ... FROM information_schema.columns WHERE column_name =
-- 'include_in_total'` devolvendo 1 linha fica VERDE para todas estas migrations
-- diferentes:
--
--   - `ADD COLUMN include_in_total boolean NOT NULL DEFAULT true`  <- a certa
--   - `ADD COLUMN include_in_total boolean`                        (3 estados)
--   - `ADD COLUMN include_in_total boolean DEFAULT false`          (tudo some)
--   - `ADD COLUMN include_in_total text`                           (soma quebra)
--   - a certa, mas SEM o WHERE na view                             (flag inerte)
--   - a certa, mas sem o ALTER de `security_invoker`               (vazamento)
--
-- As quatro primeiras custam dinheiro na tela, a quinta entrega um checkbox que
-- nao faz nada, e a sexta vaza o gasto de todos os usuarios. TODAS passam numa
-- assercao de existencia de coluna.
--
-- O que ele fixa, na ordem:
--
--   (1) A FORMA DA COLUNA NO CATALOGO: `boolean`, `NOT NULL`, `DEFAULT true`,
--       numa string unica -- mata os quatro mutantes de declaracao;
--   (2) O LANCAMENTO PRE-EXISTENTE VEIO `true`. As linhas de
--       `060_lancamentos_antes_da_060.sql` foram criadas ANTES de a coluna
--       existir. Sao a unica prova de que a migration nao tirou dos relatorios
--       o que ja estava neles -- o mutante `DEFAULT false` sobrevive a secao 1
--       inteira se o default for lido so no catalogo de uma tabela vazia;
--   (3) `category_monthly_totals` CONTA SO O NAO MARCADO. A feature. O lado
--       marcado e o nao marcado estao no MESMO MES e na MESMA categoria de
--       proposito: e a unica forma de a assercao medir o `WHERE` em vez do
--       `GROUP BY`;
--   (4) AS QUATRO VIEWS DE CIMA HERDAM o filtro -- MEDIDAS UMA A UMA. Que elas
--       sejam rollup de `category_monthly_totals` e um argumento; o db-verify
--       guarda medidas. Se alguem recolar qualquer uma delas lendo
--       `financial_transactions` direto, a cadeia se rompe sem erro nenhum e e
--       aqui que aparece;
--   (5) `net_worth_history` CONTA AS DUAS. Esta secao prova que o flag e de
--       RELATORIO e nao de SALDO, e ela reprova se alguem "consertar" a
--       omissao: o dinheiro do ajuste entrou mesmo na conta, e tirar a linha do
--       patrimonio faria a tela de Contas discordar do patrimonio;
--   (6) `security_invoker` ESTA LIGADA, COM CONTROLE POSITIVO. `CREATE OR
--       REPLACE VIEW` apaga as reloptions, e sem o ALTER a view vira DEFINER e
--       devolve o gasto por categoria de TODOS os usuarios. Num banco de um
--       usuario so a falha nao muda numero nenhum -- por isso a medida e no
--       catalogo;
--   (7) O RE-RUN NAO RE-SOMA o que foi desmarcado, e as linhas desmarcadas
--       CONTINUAM EXISTINDO. Mata o `UPDATE ... SET include_in_total = true` de
--       backfill, que e inobservavel em qualquer banco novo;
--   (8) `NULL` E RECUSADO -- o terceiro estado nao tem dono;
--   (9) O `COMMENT` ESTA NA COLUNA e cita a issue. E a sonda de colagem em
--       producao (`migration-049-colada-md5-do-comment-prova`).
--
-- CONTROLE NEGATIVO (fora deste arquivo, e medido): num banco que para na 059
-- este teste fica VERMELHO na secao 1, com a string do catalogo vazia. E o que
-- prova que ele mede a 060 e nao o estado basal do banco.
--
-- Rodar num banco limpo, na POSICAO da 060 -- a ordem dos quatro passos nao e
-- negociavel, e o porque esta no cabecalho de `060_lancamento_fora_do_total.sql`:
--   psql "$DB_URL" -f database/tests/060_lancamentos_antes_da_060.sql
--   psql "$DB_URL" -f database/migrations/060_lancamento_fora_dos_totais.sql
--   psql "$DB_URL" -f database/tests/060_lancamento_fora_do_total.sql
--   psql "$DB_URL" -f database/migrations/060_lancamento_fora_dos_totais.sql
--   psql "$DB_URL" -f database/tests/060_lancamento_fora_dos_totais_test.sql
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
-- O TRIPLO numa string unica, e nao tres assercoes separadas: os mutantes de
-- declaracao do cabecalho erram UM dos tres campos cada, e uma string so faz a
-- mensagem de falha mostrar qual.
--
-- `coalesce` para que a AUSENCIA de default apareca como '(sem default)' na
-- mensagem, em vez de a string inteira virar NULL e a falha dizer "obtido
-- <NULL>" sem apontar qual dos tres campos cedeu.
SELECT pg_temp.expect_txt('include_in_total: tipo, nulabilidade e default',
  (SELECT data_type || ' / '
            || CASE WHEN is_nullable = 'NO' THEN 'NOT NULL' ELSE 'NULAVEL' END
            || ' / ' || coalesce(column_default, '(sem default)')
     FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'financial_transactions'
      AND column_name = 'include_in_total'),
  'boolean / NOT NULL / true');

-- A COLUNA HOMONIMA DA 058 CONTINUA ONDE ESTAVA. As duas tem o mesmo nome de
-- proposito (a mesma pergunta em dois niveis), e esta assercao e o que impede
-- que alguem "resolva" a homonimia MOVENDO ou renomeando a da 058 -- o que
-- deixaria a tela de Contas sem o checkbox dela sem reprovar em mais nada aqui.
SELECT pg_temp.expect_txt('a include_in_total de financial_accounts (058) continua la',
  (SELECT data_type || ' / '
            || CASE WHEN is_nullable = 'NO' THEN 'NOT NULL' ELSE 'NULAVEL' END
            || ' / ' || coalesce(column_default, '(sem default)')
     FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'financial_accounts'
      AND column_name = 'include_in_total'),
  'boolean / NOT NULL / true');

-- =====================================================
-- 2. O LANCAMENTO PRE-EXISTENTE VEIO `true`
-- =====================================================
-- Os lancamentos `...0001` e `...0002` de `060_lancamentos_antes_da_060.sql`
-- nasceram ANTES de a coluna existir e ninguem os tocou depois. Se o
-- `ADD COLUMN` tivesse sido escrito sem default -- ou com `DEFAULT false` --, e
-- AQUI que aparece.
--
-- O `amount` vai na mesma assercao de proposito: ele prova que estas sao as
-- linhas plantadas, e nao linhas quaisquer que outra suite deixou com o mesmo
-- id. Sem ele, uma fixture que nao rodou daria `NULL` no `include_in_total` e a
-- falha falaria de default, mandando depurar a migration certa.
SELECT pg_temp.expect_txt('a despesa de antes da 060 soma nos relatorios',
  (SELECT include_in_total || ' / ' || amount
     FROM public.financial_transactions
    WHERE id = '60600000-0000-0000-0000-000000000001'),
  'true / -40.00');

SELECT pg_temp.expect_txt('a receita de antes da 060 soma nos relatorios',
  (SELECT include_in_total || ' / ' || amount
     FROM public.financial_transactions
    WHERE id = '60600000-0000-0000-0000-000000000002'),
  'true / 250.00');

-- =====================================================
-- 3. `category_monthly_totals` CONTA SO O NAO MARCADO
-- =====================================================
-- A FEATURE. Os quatro lancamentos estao no mesmo mes (2026-03), na mesma
-- conta, na mesma categoria e na mesma moeda -- entao eles caem todos no MESMO
-- grupo de agregacao, e a unica coisa que pode separa-los e o `WHERE`.
--
-- Fica        : despesa  40,00 (`...0001`) + receita   250,00 (`...0002`)
-- Desmarcado  : despesa 100,00 (`...0003`) + receita 1.000,00 (`...0004`)
--
-- Sem o `AND t.include_in_total` a view devolve `140.00 / 1250.00 / 1110.00 / 4`
-- e a mensagem de falha mostra exatamente quanto vazou. Os valores sao
-- distinguiveis de proposito: nenhuma soma parcial errada cai por acidente no
-- valor certo.
--
-- `transaction_count` entra na assercao porque o filtro esta no `WHERE` e nao
-- em cada `FILTER (WHERE ...)`: a linha desmarcada tem de sair TAMBEM da
-- contagem. Um mutante que pusesse o filtro so nos dois `FILTER` de dinheiro
-- acertaria `expense` e `income` e erraria SO o contador -- e a tela diria "4
-- lancamentos" ao lado do total de dois.
SELECT pg_temp.expect_txt('category_monthly_totals ignora o lancamento desmarcado',
  (SELECT expense || ' / ' || income || ' / ' || net || ' / ' || transaction_count
     FROM public.category_monthly_totals
    WHERE user_id = 'a0600000-0000-0000-0000-000000000099'
      AND month = '2026-03-01'),
  '40.00 / 250.00 / 210.00 / 2');

-- E ha UMA linha so, nao duas. Um mutante que trocasse o `WHERE` por um
-- `GROUP BY ... , t.include_in_total` deixaria o marcado numa linha PROPRIA:
-- os valores da assercao de cima sairiam certos, e o total da tela -- que soma
-- as linhas da view -- continuaria errado. Esta e a assercao que o pega.
SELECT pg_temp.expect('e ha uma linha so no mes (o desmarcado nao vira linha propria)',
  (SELECT count(*) FROM public.category_monthly_totals
    WHERE user_id = 'a0600000-0000-0000-0000-000000000099'
      AND month = '2026-03-01'), 1);

-- =====================================================
-- 4. AS QUATRO VIEWS DE CIMA HERDAM -- MEDIDAS UMA A UMA
-- =====================================================
-- Elas sao rollup de `category_monthly_totals`, entao herdam POR CONSTRUCAO.
-- Isso e um argumento, e argumento nao reprova o CI. Se alguem recolar
-- qualquer uma delas lendo `financial_transactions` direto -- que e exatamente
-- o que a 046 fez com a perna de grupo --, a cadeia se rompe sem erro nenhum,
-- sem reprovar em nenhum outro teste, e o numero volta a inchar calado.
--
-- Medir as quatro custa quatro SELECTs e e o que transforma a cadeia desenhada
-- no cabecalho da migration numa medida (`teste-de-migration-roda-na-posicao-dele`).

-- 4.1 `monthly_cash_flow` (022) -- rollup direto, por mes e moeda.
SELECT pg_temp.expect_txt('monthly_cash_flow herda o filtro',
  (SELECT income || ' / ' || expense || ' / ' || net || ' / ' || transaction_count
     FROM public.monthly_cash_flow
    WHERE user_id = 'a0600000-0000-0000-0000-000000000099'
      AND month = '2026-03-01'),
  '250.00 / 40.00 / 210.00 / 2');

-- 4.2 `personal_category_monthly_totals` (046) -- a PERNA 1 dela sai de
-- `category_monthly_totals`. A perna 2 (minha parte do que outro pagou) sai de
-- `group_share_entries` e NAO herda o filtro; aqui ela esta vazia porque este
-- usuario nao tem grupo, entao esta assercao mede a perna 1 limpa. A ressalva
-- da perna 2 esta escrita no cabecalho da migration e e divida declarada, nao
-- defeito escondido.
SELECT pg_temp.expect_txt('personal_category_monthly_totals herda o filtro',
  (SELECT expense || ' / ' || income || ' / ' || net || ' / ' || transaction_count
     FROM public.personal_category_monthly_totals
    WHERE user_id = 'a0600000-0000-0000-0000-000000000099'
      AND month = '2026-03-01'),
  '40.00 / 250.00 / 210.00 / 2');

-- 4.3 `personal_monthly_cash_flow` (033) -- rollup de 4.2.
SELECT pg_temp.expect_txt('personal_monthly_cash_flow herda o filtro',
  (SELECT income || ' / ' || expense || ' / ' || net || ' / ' || transaction_count
     FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a0600000-0000-0000-0000-000000000099'
      AND month = '2026-03-01'),
  '250.00 / 40.00 / 210.00 / 2');

-- 4.4 `planned_vs_actual` (054), perna do REALIZADO -- ela le
-- `personal_monthly_cash_flow` no LATERAL quando `group_id IS NULL`.
--
-- O `planned_*` sai 0.00 porque este usuario nao tem nenhuma
-- `scheduled_transactions` -- e justamente por isso a linha e util: o REALIZADO
-- aqui e 250,00/40,00 e nao 1.250,00/140,00.
SELECT pg_temp.expect_txt('planned_vs_actual herda o filtro no realizado',
  (SELECT actual_income || ' / ' || actual_expense || ' / ' || planned_income || ' / ' || planned_expense
     FROM public.planned_vs_actual
    WHERE user_id = 'a0600000-0000-0000-0000-000000000099'
      AND month = '2026-03-01'
      AND group_id IS NULL),
  '250.00 / 40.00 / 0.00 / 0.00');

-- A CHAVE DO MES CONTINUA EXISTINDO, e isso esta DECIDIDO, nao esquecido. O CTE
-- `chaves` de `planned_vs_actual` le `financial_transactions` DIRETO para
-- enumerar os meses, e nao foi tocado por esta migration -- entao um mes cuja
-- unica movimentacao fosse desmarcada apareceria como linha de ZEROS em vez de
-- sumir.
--
-- Esta assercao fixa a escolha para que ela nao mude por acidente nos dois
-- sentidos: quem filtrar o `chaves` tambem faz esta linha sumir e reprova aqui,
-- e tera de vir ler o cabecalho da migration antes de mudar o conjunto de meses
-- que o relatorio enumera. Ver `linha-zerada-nas-views-do-008`.
SELECT pg_temp.expect('o mes continua aparecendo em planned_vs_actual',
  (SELECT count(*) FROM public.planned_vs_actual
    WHERE user_id = 'a0600000-0000-0000-0000-000000000099'
      AND month = '2026-03-01'
      AND group_id IS NULL), 1);

-- =====================================================
-- 5. `net_worth_history` CONTA AS DUAS -- o flag e de RELATORIO, nao de SALDO
-- =====================================================
-- ESTA E A SECAO QUE PROVA O QUE A 060 **NAO** FAZ, e ela e tao importante
-- quanto a secao 3.
--
-- `net_change` e `SUM(t.amount)` cru sobre `financial_transactions` com
-- `account_id IS NOT NULL` -- sem passar por `category_monthly_totals`, e
-- portanto sem o filtro:
--
--   -40,00  +  250,00  +  (-100,00)  +  1.000,00  =  1.110,00
--
-- Os quatro, inclusive os dois desmarcados. Se fossem so os dois marcados daria
-- 210,00, e esse e o numero que esta assercao existe para recusar.
--
-- POR QUE ISSO E O CERTO: o dinheiro do ajuste entrou mesmo na conta. O
-- `update_account_balance_trigger` ja mexeu no `current_balance`, e o
-- patrimonio e saldo-de-hoje-menos-o-que-se-moveu-depois. Filtrar aqui faria o
-- saldo da tela de Contas discordar do patrimonio -- duas telas, o mesmo
-- dinheiro, dois numeros, sem nada que diga qual esta certo.
--
-- Quem "consertar" a omissao reprova aqui e vem ler o cabecalho da migration.
SELECT pg_temp.expect_txt('net_worth_history conta o lancamento desmarcado tambem',
  (SELECT net_change::text
     FROM public.net_worth_history
    WHERE user_id = 'a0600000-0000-0000-0000-000000000099'
      AND month = '2026-03-01'),
  '1110.00');

-- =====================================================
-- 6. `security_invoker` ESTA LIGADA, COM CONTROLE POSITIVO
-- =====================================================
-- `CREATE OR REPLACE VIEW` APAGA as reloptions
-- (`create-or-replace-view-apaga-reloptions`). Sem o `ALTER VIEW ... SET
-- (security_invoker = true)` da secao 3 da migration, esta view roda com os
-- direitos do DONO, a RLS de `financial_transactions` nao se aplica, e ela
-- devolve o gasto por categoria de TODOS os usuarios -- e as outras quatro
-- views da cadeia junto.
--
-- A falha e SILENCIOSA: num banco de um usuario so, uma view DEFINER devolve
-- exatamente os mesmos numeros que uma view INVOKER, entao nenhuma das secoes
-- 3, 4 e 5 a nota. Por isso a medida e no CATALOGO.
SELECT pg_temp.expect_txt('category_monthly_totals roda com os direitos de quem consulta',
  (SELECT CASE WHEN EXISTS (
            SELECT 1 FROM pg_class c
             WHERE c.oid = 'public.category_monthly_totals'::regclass
               AND c.reloptions @> ARRAY['security_invoker=true'])
          THEN 'true' ELSE 'false' END),
  'true');

-- O FILTRO ESTA NO CORPO DA VIEW, **COM CONTROLE POSITIVO**.
--
-- A segunda metade da string e o controle, e sem ela esta assercao nao vale
-- nada: "o viewdef nao cita `include_in_total`" e INDISTINGUIVEL de "o viewdef
-- nao tem nada a ver com `financial_transactions`" -- uma view recolada por
-- engano sobre outra tabela, ou um `regclass` que resolveu noutro schema,
-- daria o mesmo `false` e mandaria depurar o filtro em vez do alvo. Ver
-- `mutantes-e-controle-negativo`.
--
-- Esta assercao e tambem a SONDA DE COLAGEM em producao: ao contrario da 058,
-- a 060 deixa um `viewdef` no catalogo, e ele se le pela credencial RO.
SELECT pg_temp.expect_txt('o viewdef tem o filtro E fala da tabela certa',
  (SELECT (pg_get_viewdef('public.category_monthly_totals'::regclass) ILIKE '%include_in_total%')::text
            || ' / '
            || (pg_get_viewdef('public.category_monthly_totals'::regclass) ILIKE '%financial_transactions%')::text),
  'true / true');

-- `anon` nao le esta view. O REVOKE da migration e reafirmacao, mas a
-- reafirmacao so vale se alguem a medir: a chave `anon` vai embutida no bundle
-- JS publico.
SELECT pg_temp.expect('anon nao tem privilegio nenhum em category_monthly_totals',
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'category_monthly_totals'
      AND grantee = 'anon'), 0);

SELECT pg_temp.expect('authenticated continua lendo category_monthly_totals',
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'category_monthly_totals'
      AND grantee = 'authenticated'
      AND privilege_type = 'SELECT'), 1);

-- =====================================================
-- 7. O RE-RUN NAO RE-SOMA, E A LINHA DESMARCADA CONTINUA EXISTINDO
-- =====================================================
-- Os lancamentos `...0003` e `...0004` foram desmarcados por
-- `060_lancamento_fora_do_total.sql` ENTRE as duas colagens da 060. Se a
-- migration tivesse um `UPDATE ... SET include_in_total = true` de backfill, a
-- segunda colagem os teria re-somado -- e no app isso e "minha receita de marco
-- subiu sozinha" semanas depois, sem nada que ligue o sintoma a uma colagem de
-- SQL.
--
-- ESTA SECAO DEPENDE DA POSICAO DOS STEPS no db-verify. Se o step do re-run for
-- movido para antes da fixture que desmarca, estas assercoes continuam VERDES e
-- param de controlar -- o modo de falha de
-- `guarda-de-ancora-verde-nao-prova-que-o-mutante-morre`. O cabecalho de
-- `060_lancamento_fora_do_total.sql` registra a ordem exigida.
SELECT pg_temp.expect('os dois lancamentos desmarcados continuam desmarcados depois do re-run',
  (SELECT count(*) FROM public.financial_transactions
    WHERE id IN ('60600000-0000-0000-0000-000000000003',
                 '60600000-0000-0000-0000-000000000004')
      AND include_in_total = FALSE), 2);

-- E ELES CONTINUAM NA TABELA. O COMMENT da coluna promete que o flag tira a
-- linha das SOMAS e nao da existencia dela: o extrato continua completo e a
-- lista de lancamentos continua mostrando a linha. Um "conserto" que virasse
-- isto num soft-delete (ou um filtro que vazasse para a listagem) passaria em
-- todas as secoes acima -- todas elas medem views de SOMA -- e seria descoberto
-- pelo usuario, que perderia o lancamento de vista.
SELECT pg_temp.expect('e os dois continuam existindo na tabela (nao e soft-delete)',
  (SELECT count(*) FROM public.financial_transactions
    WHERE id IN ('60600000-0000-0000-0000-000000000003',
                 '60600000-0000-0000-0000-000000000004')), 2);

-- =====================================================
-- 8. `NULL` E RECUSADO
-- =====================================================
-- O terceiro estado nao tem dono: `NULL` nao e `true` nem `false`, entao
-- `WHERE t.include_in_total` DESCARTA a linha e `WHERE NOT t.include_in_total`
-- tambem a descarta. Um lancamento com `NULL` aqui nao somaria nos relatorios E
-- nao apareceria numa eventual lista de "lancamentos fora do total" -- dinheiro
-- invisivel nas duas telas que existem para encontra-lo. Ver
-- `coluna-booleana-anulavel-not-is-false`.
--
-- O UPDATE roda num bloco com EXCEPTION para que a recusa seja o resultado
-- ESPERADO sem abortar a transacao do arquivo. `not_null_violation` e 23502.
DO $$
DECLARE
  recusou BOOLEAN := FALSE;
BEGIN
  BEGIN
    UPDATE public.financial_transactions
       SET include_in_total = NULL
     WHERE id = '60600000-0000-0000-0000-000000000001';
  EXCEPTION WHEN not_null_violation THEN
    recusou := TRUE;
  END;

  IF NOT recusou THEN
    RAISE EXCEPTION
      'FALHA: o banco aceitou include_in_total = NULL -- a coluna tem tres estados e o lancamento some dos dois lados da conta';
  END IF;

  RAISE NOTICE 'ok: NULL e recusado (23502)';
END $$;

-- =====================================================
-- 9. O `COMMENT` ESTA NA COLUNA E CITA A ISSUE
-- =====================================================
-- Junto com o `viewdef` da secao 6, e como se prova por `psql` contra producao
-- que a 060 foi colada -- `migration-049-colada-md5-do-comment-prova`.
-- `position(... in ...) > 0` em vez do texto inteiro: fixar o comentario byte a
-- byte faria qualquer melhoria de redacao reprovar o CI.
SELECT pg_temp.expect('o COMMENT da coluna cita a HMO-443',
  (SELECT count(*)
     FROM pg_description d
     JOIN pg_class c ON c.oid = d.objoid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid
    WHERE n.nspname = 'public'
      AND c.relname = 'financial_transactions'
      AND a.attname = 'include_in_total'
      AND position('HMO-443' in d.description) > 0), 1);

DO $$ BEGIN RAISE NOTICE '060: todas as assercoes passaram'; END $$;

ROLLBACK;

-- =====================================================
-- O ROLLBACK devolve o banco ao estado em que ele entrou. Este arquivo nao
-- INSERE nada -- ele so le, e o unico UPDATE dele (a secao 8) e o que o banco
-- recusa --, entao o ROLLBACK aqui e cinto de seguranca e nao limpeza. As
-- quatro linhas das fixtures seguem comitadas, como as fixtures as deixaram.
-- =====================================================
