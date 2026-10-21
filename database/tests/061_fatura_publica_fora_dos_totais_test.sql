-- =====================================================
-- HMO-459 -- a fatura publica `include_in_total` (061)
-- =====================================================
-- Roda no db-verify contra o banco que as migrations constroem do zero, na
-- POSICAO da 061 -- com a 061 ja aplicada DUAS vezes (a segunda e o step de
-- idempotencia). Essa ordem e o que faz a SECAO 4 valer tambem para o re-run:
-- `CREATE OR REPLACE VIEW` apaga a reloption, entao medir `security_invoker`
-- DEPOIS da segunda colagem e medir que o ALTER do fim do arquivo rodou nas
-- duas.
--
-- O QUE A 061 ENTREGA
-- -------------------
--   (a) `include_in_total` na PROJECAO de `public.card_invoice_lines`,
--       repassada da tabela sem filtro;
--   (b) o `security_invoker` de volta na view recolada.
--
-- E O QUE ELA DE PROPOSITO **NAO** ENTREGA: o filtro. O total da fatura soma a
-- linha desmarcada -- Opcao A da HMO-455, decidida pelo Helio (interaction
-- `1a40529a`, 2026-10-21), porque a fatura do app tem de bater com a do banco.
-- A SECAO 3 e a que fixa isso em numero, e ela e a diferenca entre esta
-- migration e a 060: lendo so o diff, acrescentar `AND t.include_in_total` ao
-- WHERE parece a continuacao obvia do trabalho da 060. E a SECAO 3 reprova.
--
-- POR QUE "A COLUNA APARECE NA VIEW" NAO PROVA ESTA MIGRATION
-- -----------------------------------------------------------
-- `SELECT include_in_total FROM public.card_invoice_lines` compilar fica VERDE
-- para todas estas migrations diferentes:
--
--   - `t.include_in_total` no fim da projecao             <- a certa
--   - `true AS include_in_total`                          (selo nunca acende)
--   - `NOT t.include_in_total AS include_in_total`        (selo invertido)
--   - `t.include_in_total::text`                          (a tela compara com
--                                                          booleano e o botao
--                                                          nasce no estado errado)
--   - a certa, mas com `AND t.include_in_total` no WHERE  (a fatura encolhe e
--                                                          deixa de bater com
--                                                          o banco)
--   - a certa, mas sem o ALTER de `security_invoker`      (a fatura de todos
--                                                          os usuarios vai
--                                                          para qualquer um
--                                                          logado)
--
-- As quatro primeiras entregam uma tela que mente; a quinta custa dinheiro na
-- mao da pessoa que paga o boleto; a sexta e um vazamento. TODAS passam numa
-- assercao de existencia de coluna.
--
-- O que este arquivo fixa, na ordem:
--
--   (1) A FORMA DA COLUNA NA VIEW: ela existe e e `boolean` -- mata o mutante
--       do `::text`, que e o unico dos seis que nao da erro em lugar nenhum e
--       chega na tela como a string "false", que em TypeScript e verdadeira;
--   (2) ELA CARREGA O VALOR DA LINHA, nos DOIS sentidos. A compra desmarcada
--       chega `false` e a marcada chega `true`, no MESMO cartao e na MESMA
--       fatura. Sao duas assercoes porque uma so nao distingue: o `true`
--       cravado passa na segunda, e o `NOT` invertido passa nas duas se elas
--       estiverem no mesmo sentido;
--   (3) O TOTAL DA FATURA CONTINUA INTEIRO. A feature, e a decisao do Helio.
--       A linha desmarcada APARECE na view e SOMA no total. Medido pelo
--       `SUM(invoice_amount)` do cartao e pela contagem de linhas -- as duas,
--       porque um filtro no FILTER em vez de no WHERE erra o total sem errar a
--       contagem, e um `GROUP BY` a mais erra a contagem sem errar o total;
--   (4) `security_invoker` ESTA LIGADA, com as DUAS metades: a opcao no
--       catalogo e a LINHA que volta para cada dono. A opcao sozinha nao prova
--       comportamento; o comportamento sozinho nao distingue "a RLS pegou" de
--       "a view quebrou e nao devolve nada para ninguem" -- por isso o
--       controle positivo no fim da secao. E o `anon` continua sem privilegio
--       nenhum sobre a view;
--   (5) A 041 E A 035 SOBREVIVERAM AO REPLACE. `CREATE OR REPLACE VIEW` exige
--       o corpo inteiro, entao recolar este objeto a partir de uma versao
--       antiga REVERTE as migrations anteriores sem sintoma
--       (`create-or-replace-view-de-pr-aberto-reverte-migration-mergeada`). O
--       guard forte disso e o step que re-roda o teste da 041 depois da 061;
--       esta secao e a medida LOCAL, para a falha aparecer com o nome da 061 em
--       vez de num step tres posicoes abaixo.
--
-- CONTROLE NEGATIVO (fora deste arquivo, e MEDIDO): contra um banco que para na
-- 060 este teste fica VERMELHO na SECAO 1, com esta mensagem exata --
--
--   FALHA: card_invoice_lines.include_in_total: existe e e boolean
--          -> esperado "boolean", obtido "(a view NAO publica a coluna)"
--
-- e e o que prova que ele mede a 061 e nao o estado basal do banco. A assercao
-- e sobre `information_schema.columns` e nao sobre um SELECT, de proposito: um
-- `SELECT include_in_total FROM card_invoice_lines` num banco sem a coluna
-- aborta o arquivo com 42703 antes de qualquer assercao, e erro de sintaxe nao
-- e a mesma coisa que teste vermelho.
--
-- Rodar na POSICAO da 061, que e o que o db-verify faz -- a migration colada
-- DUAS vezes, e so depois o teste. O banco tem de vir da cadeia, nao de um
-- schema completo (`teste-de-migration-roda-na-posicao-dele`):
--
--   # a cadeia ate a 060, extraida do proprio workflow
--   node -e 'const y=require("yaml"),f=require("fs");
--     const d=y.parse(f.readFileSync(".github/workflows/db-verify.yml","utf8"));
--     for (const s of d.jobs.migrations.steps) { const r=String(s.run||"");
--       if (/DROP DATABASE|CREATE DATABASE|_drift/.test(r)) continue;
--       for (const m of r.matchAll(/\$PSQL -f (\S+)/g)) console.log(m[1]); }' \
--     | sed -n '1,195p' | while read -r f; do psql -v ON_ERROR_STOP=1 -q -f "$f"; done
--
--   psql "$DB_URL" -f database/migrations/061_fatura_publica_fora_dos_totais.sql
--   psql "$DB_URL" -f database/migrations/061_fatura_publica_fora_dos_totais.sql
--   psql "$DB_URL" -f database/tests/061_fatura_publica_fora_dos_totais_test.sql
--
-- O `195` e a POSICAO do teste da 060 na lista e NAO e estavel -- cada
-- migration nova empurra o numero. Confira com
-- `grep -n 060_lancamento_fora_dos_totais_test` na saida antes de cortar. E NAO
-- pare a lista no segundo `00_supabase_shim` como manda a receita antiga: a
-- fronteira do shim CORTA os blocos da 056/057/058, que ficam DEPOIS dos steps
-- de deriva (`bloco-de-migration-que-cria-coluna-vai-antes-do-check-de-schema-columns`).
--
-- Esse mesmo banco (o da posicao 195, SEM a 061) e o template dos 9 mutantes
-- registrados no bloco da 061 em `db-verify.yml`. Um template com a 061 dentro
-- faz todo mutante virar no-op, e o sinal de que isso aconteceu e o teste
-- PASSAR contra o template cru (`mutantes-e-controle-negativo`).
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
    RAISE EXCEPTION 'FALHA: % -> esperado "%", obtido "%"', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_bool(label TEXT, got BOOLEAN, want BOOLEAN)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %',
      label, want, coalesce(got::text, '<NULL>');
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

-- =====================================================
-- Fixture: dois donos, um cartao cada
-- =====================================================
-- `closing_day = 20` e `due_day = 5` nos dois cartoes, igual a fixture da 041 e
-- pelo mesmo motivo: o vencimento vem ANTES do fechamento, que e o caso em que
-- `card_invoice_due_date` empurra para o mes SEGUINTE. E o que faz o vencimento
-- da fatura escolhida (05/01/2027) ser diferente do vencimento da fatura da
-- data (05/11/2026) na SECAO 5 -- sem essa diferenca, uma reversao que deixasse
-- o `COALESCE` so no `invoice_month` passaria.
--
-- `is_public = FALSE` nos dois perfis NAO e decoracao: com `TRUE`, a policy
-- `profiles_select_own_or_public` deixa um dono ver o outro por motivo
-- legitimo, e o controle de RLS da SECAO 4 passaria a verde sem provar nada.
--
-- As linhas da fixture da 060 ja estao comitadas neste banco. Por isso TODA
-- contagem e TODA soma abaixo recorta por `account_id` ou por `user_id` -- um
-- `count(*)` solto sobre a view mediria o horizonte inteiro e mudaria de valor
-- a cada fixture nova na cadeia.
INSERT INTO auth.users (id, email) VALUES
  ('f6100000-0000-0000-0000-0000000000c1', 'cris-459@teste.local'),
  ('f6100000-0000-0000-0000-0000000000d1', 'davi-459@teste.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('f6100000-0000-0000-0000-0000000000c1', 'Cris 459', FALSE),
  ('f6100000-0000-0000-0000-0000000000d1', 'Davi 459', FALSE);

INSERT INTO public.financial_accounts
  (id, user_id, name, account_type, current_balance, closing_day, due_day)
VALUES
  ('a6100000-0000-0000-0000-0000000000c1', 'f6100000-0000-0000-0000-0000000000c1',
   'Cartao Cris 459', 'credit_card', 0, 20, 5),
  ('a6100000-0000-0000-0000-0000000000d1', 'f6100000-0000-0000-0000-0000000000d1',
   'Cartao Davi 459', 'credit_card', 0, 20, 5);

-- A GELADEIRA: compra normal, dentro dos totais. `include_in_total` NAO e
-- escrito aqui de proposito -- quem o poe como `true` e o DEFAULT da 060, e e
-- esse caminho que a tela real exercita em toda compra.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type)
VALUES
  ('c6100000-0000-0000-0000-000000000001',
   'f6100000-0000-0000-0000-0000000000c1',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
   'a6100000-0000-0000-0000-0000000000c1',
   'Geladeira da Cris 459', -1200.00, DATE '2026-10-15', 'expense');

-- O NOTEBOOK DO TRABALHO: a compra que a pessoa DESMARCOU. Mesmo cartao, mesma
-- fatura de outubro, mesma categoria -- e so assim que a SECAO 3 mede o WHERE
-- da view em vez do GROUP BY, e a SECAO 2 mede a coluna em vez do mes.
--
-- O caso e real e e o que justifica a Opcao A: a empresa vai reembolsar, entao
-- a compra nao e gasto meu para efeito de RELATORIO -- mas a operadora do
-- cartao vai cobrar os R$ 500 no boleto de qualquer jeito. Uma fatura que
-- esconde esta linha mostra R$ 1.200 onde o banco cobra R$ 1.700.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type, include_in_total)
VALUES
  ('c6100000-0000-0000-0000-000000000002',
   'f6100000-0000-0000-0000-0000000000c1',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
   'a6100000-0000-0000-0000-0000000000c1',
   'Notebook do trabalho 459', -500.00, DATE '2026-10-16', 'expense', FALSE);

-- A CADEIRA ESCOLHIDA: comprada em 10/10 (cairia na fatura de OUTUBRO pela
-- regra da 006) e jogada pela pessoa para a fatura de DEZEMBRO. Existe para a
-- SECAO 5, e e desmarcada tambem -- assim ela prova de uma vez que a coluna
-- nova e o COALESCE da 041 convivem.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type, invoice_month_override, include_in_total)
VALUES
  ('c6100000-0000-0000-0000-000000000003',
   'f6100000-0000-0000-0000-0000000000c1',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
   'a6100000-0000-0000-0000-0000000000c1',
   'Cadeira escolhida 459', -800.00, DATE '2026-10-10', 'expense',
   DATE '2026-12-01', FALSE);

-- O PNEU DO DAVI: outro dono, tambem DESMARCADO, na mesma fatura de outubro.
-- E o controle de RLS da SECAO 4: se a view perder o `security_invoker`, ele
-- aparece para a Cris -- com o selo "fora dos totais" e tudo.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type, include_in_total)
VALUES
  ('c6100000-0000-0000-0000-000000000004',
   'f6100000-0000-0000-0000-0000000000d1',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
   'a6100000-0000-0000-0000-0000000000d1',
   'Pneu do Davi 459', -600.00, DATE '2026-10-10', 'expense', FALSE);

-- =====================================================
-- SECAO 1: a coluna existe na view, e e boolean
-- =====================================================
-- Pelo CATALOGO, e nao por um SELECT. Num banco que para na 060 a coluna nao
-- existe e `SELECT include_in_total FROM card_invoice_lines` aborta o arquivo
-- com 42703 na primeira linha -- o controle negativo precisa de um teste
-- VERMELHO, com a mensagem dizendo o que faltou, nao de um erro de sintaxe.
--
-- O tipo esta na mesma assercao porque o mutante `::text` e o unico dos seis do
-- cabecalho que nao quebra nada em SQL: a view compila, a RLS continua de pe,
-- os numeros ficam iguais, e o `false` chega na tela como a string "false" --
-- que e VERDADEIRA em TypeScript. O selo acenderia em todas as linhas e nunca
-- em nenhuma, dependendo do lado da comparacao.
-- O `coalesce` vai FORA da subconsulta, de proposito: com ele dentro do SELECT
-- a ausencia da coluna devolve zero linhas e a subconsulta inteira vira NULL --
-- a falha diria `obtido "<NULL>"`, que se le como "a coluna existe e esta
-- vazia". Fora, ela diz o que de fato aconteceu.
SELECT pg_temp.expect_txt('card_invoice_lines.include_in_total: existe e e boolean',
  coalesce((SELECT data_type
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'card_invoice_lines'
               AND column_name = 'include_in_total'),
           '(a view NAO publica a coluna)'),
  'boolean');

-- =====================================================
-- SECAO 2: a coluna carrega o valor da LINHA, nos dois sentidos
-- =====================================================
-- As duas assercoes sao sobre o MESMO cartao e a MESMA fatura, e sao duas
-- porque nenhuma delas sozinha separa os mutantes:
--
--   `true AS include_in_total`  passa na da geladeira e reprova na do notebook;
--   `NOT t.include_in_total`    reprova nas duas -- e reprovaria em UMA SO se
--                               as duas estivessem no mesmo sentido, que e o
--                               motivo de a fixture ter os dois valores.
SELECT pg_temp.expect_bool('a geladeira (dentro dos totais) chega true na view',
  (SELECT include_in_total FROM public.card_invoice_lines
    WHERE transaction_id = 'c6100000-0000-0000-0000-000000000001'),
  TRUE);

SELECT pg_temp.expect_bool('o notebook DESMARCADO chega false na view',
  (SELECT include_in_total FROM public.card_invoice_lines
    WHERE transaction_id = 'c6100000-0000-0000-0000-000000000002'),
  FALSE);

-- =====================================================
-- SECAO 3: O TOTAL DA FATURA CONTINUA INTEIRO (a Opcao A)
-- =====================================================
-- A decisao do Helio, em numero. A fatura de outubro do cartao da Cris tem as
-- DUAS linhas e soma as DUAS: R$ 1.200 + R$ 500 = R$ 1.700, que e o que o banco
-- vai cobrar. `invoice_amount` e `-amount` (a 006 inverte o sinal para a compra
-- somar e o estorno abater), entao o total e positivo.
--
-- Esta e a secao que o mutante `AND t.include_in_total` no WHERE derruba -- e
-- ele e o mutante PROVAVEL, nao um exotico: a 060 fez exatamente isso com a
-- mesma coluna na view dela, e quem ler os dois diffs lado a lado vai achar que
-- aqui ficou pela metade. Se a decisao de produto mudar, muda-se ESTA secao com
-- a issue na mao.
--
-- As tres assercoes medem coisas que se separam:
--   * a SOMA pega o filtro no WHERE (1200.00 em vez de 1700.00);
--   * a CONTAGEM pega um filtro escrito no FILTER em vez do WHERE, que erra o
--     total e acerta a contagem, e pega tambem o `GROUP BY` a mais, que faz a
--     linha desmarcada virar linha propria;
--   * a soma FILTRADA pelo proprio `include_in_total` prova que os R$ 500 que
--     estao no total sao os da linha desmarcada, e nao R$ 500 de outro lugar.
SELECT pg_temp.expect_num('a fatura de outubro soma as duas linhas (1.200 + 500)',
  (SELECT SUM(invoice_amount) FROM public.card_invoice_lines
    WHERE account_id = 'a6100000-0000-0000-0000-0000000000c1'
      AND invoice_month = DATE '2026-10-01'),
  1700.00);

SELECT pg_temp.expect('e ela tem DUAS linhas, nao uma',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE account_id = 'a6100000-0000-0000-0000-0000000000c1'
      AND invoice_month = DATE '2026-10-01'),
  2);

SELECT pg_temp.expect_num('os 500 que estao no total sao os da linha DESMARCADA',
  (SELECT SUM(invoice_amount) FILTER (WHERE NOT include_in_total)
     FROM public.card_invoice_lines
    WHERE account_id = 'a6100000-0000-0000-0000-0000000000c1'
      AND invoice_month = DATE '2026-10-01'),
  500.00);

-- =====================================================
-- SECAO 4: security_invoker DEPOIS do REPLACE, com as duas metades
-- =====================================================
-- MEDIDO (Postgres 17.11, registrado na 035, 041 e 060): `CREATE OR REPLACE
-- VIEW` APAGA as reloptions. A 061 recola a `card_invoice_lines` e nao fala de
-- permissao em lugar nenhum a nao ser no ALTER do fim do arquivo -- sem ele a
-- view devolve a fatura de todo mundo para qualquer usuario logado, e num banco
-- de um usuario so nenhum numero muda.
--
-- Como o db-verify cola a migration DUAS vezes antes de chegar aqui, esta
-- secao mede as duas colagens de uma vez: se o ALTER faltasse na segunda, a
-- reloption estaria vazia agora.

SELECT pg_temp.expect('card_invoice_lines tem security_invoker depois do REPLACE da 061',
  (SELECT count(*) FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'card_invoice_lines'
      AND EXISTS (SELECT 1 FROM unnest(coalesce(c.reloptions, '{}')) AS o(opt)
                   WHERE o.opt ILIKE 'security_invoker=%true%')), 1);

-- O `anon` continua sem privilegio. O REVOKE/GRANT da 061 e declarativo, mas um
-- REPLACE que mexesse no ACL da view nao daria sintoma nenhum.
SELECT pg_temp.expect('anon nao tem privilegio sobre card_invoice_lines',
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'card_invoice_lines'
      AND grantee = 'anon'), 0);

-- A outra metade: a LINHA que volta para cada dono. `SET LOCAL` fora de
-- transacao so emite WARNING e nao aplica -- estamos dentro do BEGIN do
-- arquivo, e o `current_user` abaixo e a confirmacao.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'f6100000-0000-0000-0000-0000000000c1';

SELECT pg_temp.expect_txt('o papel da sessao e authenticated (senao a secao mede o dono)',
  current_user, 'authenticated');

SELECT pg_temp.expect('a Cris ve as duas linhas da fatura de outubro dela',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE account_id = 'a6100000-0000-0000-0000-0000000000c1'
      AND invoice_month = DATE '2026-10-01'), 2);

SELECT pg_temp.expect('a Cris NAO ve o pneu do Davi, que tambem esta desmarcado',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE transaction_id = 'c6100000-0000-0000-0000-000000000004'), 0);

SET LOCAL request.jwt.claim.sub = 'f6100000-0000-0000-0000-0000000000d1';

SELECT pg_temp.expect('o Davi ve o pneu dele, e com o false',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE transaction_id = 'c6100000-0000-0000-0000-000000000004'
      AND include_in_total = FALSE), 1);

SELECT pg_temp.expect('o Davi NAO ve o notebook da Cris',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE transaction_id = 'c6100000-0000-0000-0000-000000000002'), 0);

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

-- CONTROLE POSITIVO DA RLS: sem filtro de dono, as quatro linhas da fixture
-- estao todas na view. Sem ele, uma view quebrada -- que nao devolve nada para
-- ninguem -- passaria nas duas negacoes acima.
SELECT pg_temp.expect('sem RLS, as quatro linhas da fixture estao na view (as negacoes acima sao load-bearing)',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE account_id IN ('a6100000-0000-0000-0000-0000000000c1',
                         'a6100000-0000-0000-0000-0000000000d1')), 4);

-- =====================================================
-- SECAO 5: a 041 e a 035 sobreviveram ao REPLACE
-- =====================================================
-- `CREATE OR REPLACE VIEW` exige o corpo INTEIRO, entao esta migration carrega
-- uma copia da definicao da 041 -- e e assim que migration de view reverte
-- migration de view sem sintoma nenhum
-- (`create-or-replace-view-de-pr-aberto-reverte-migration-mergeada`). O guard
-- forte e o step que re-roda `041_fatura_escolhida_no_lancamento_test.sql`
-- DEPOIS desta migration; esta secao e a medida local, para a falha aparecer
-- com o nome da 061.
--
-- As DUAS datas da mesma linha, que e o que separa os dois jeitos de reverter:
-- com o `COALESCE` so no `invoice_month`, a cadeira aparece na fatura de
-- dezembro com o vencimento da fatura de OUTUBRO (05/11/2026) -- a tela fica
-- certa e o "fechar fatura" da 015 emite o boleto com data de outro mes.
SELECT pg_temp.expect_date('a cadeira escolhida cai na fatura de dezembro (COALESCE do invoice_month, 041)',
  (SELECT invoice_month FROM public.card_invoice_lines
    WHERE transaction_id = 'c6100000-0000-0000-0000-000000000003'),
  DATE '2026-12-01');

SELECT pg_temp.expect_date('e vence com a fatura de dezembro, nao com a de outubro (COALESCE do invoice_due_date, 041)',
  (SELECT invoice_due_date FROM public.card_invoice_lines
    WHERE transaction_id = 'c6100000-0000-0000-0000-000000000003'),
  DATE '2027-01-05');

-- As duas colunas de parcela da 035 continuam na projecao. NULL nas duas em
-- compra avulsa -- o que se mede aqui e que elas EXISTEM e sao lidas da
-- tabela; uma reversao para o corpo pre-035 as tiraria da view e esta assercao
-- aborta com 42703 no proprio arquivo da 061.
SELECT pg_temp.expect('as colunas de parcela da 035 continuam na view',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'card_invoice_lines'
      AND column_name IN ('installment_number', 'installment_total')), 2);

-- =====================================================
ROLLBACK;
