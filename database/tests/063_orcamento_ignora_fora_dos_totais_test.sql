-- =====================================================
-- Teste do teto que ignora o lancamento fora dos totais (063)
-- =====================================================
-- HMO-453, F3 da HMO-443. Roda no db-verify, contra o banco que as migrations
-- constroem do zero, na posicao da 063 na cadeia
-- (`teste-de-migration-roda-na-posicao-dele`).
--
-- A 063 acrescenta UMA linha ao `WHERE` da perna 1 de `budget_consumption`:
-- `AND t.include_in_total`. Decisao B da HMO-443, aceita em 2026-10-20 -- se
-- nao e despesa de verdade para o relatorio, nao e para o teto.
--
-- O QUE ESTE ARQUIVO MEDE QUE "A VIEW DEVOLVE 550" NAO MEDE
-- ---------------------------------------------------------
-- A 063 pode errar de QUATRO jeitos, e os quatro produzem um numero plausivel.
-- Na fixture de maio (teto pessoal de 700,00 da A na Alimentacao) eles sao
-- distinguiveis de proposito:
--
--    550,00  o criterio da 063: a perna 1 filtra, a perna 2 NAO.
--    750,00  a 063 nao colou -- o `AND t.include_in_total` nao esta na perna 1.
--            E o estado de hoje em producao, e e ele que faz a barra marcar
--            107% de um teto que na verdade esta em 79%.
--    520,00  o filtro VAZOU para a perna 2: a minha parte do que a B pagou e
--            desmarcou desaparece do meu teto. E a decisao D sendo violada --
--            o que eu devo nao muda porque QUEM LANCOU escondeu a linha do
--            relatorio dele --, e e o erro mais facil de cometer, porque a
--            perna 2 ja faz JOIN com `financial_transactions` (ela precisa da
--            cotacao) e acrescentar o filtro ali nao quebra nada.
--    720,00  o filtro vazou para a perna 2 E nao entrou na perna 1 -- as duas
--            metades trocadas. Nenhuma suite que meca so "o numero mudou"
--            separa isto do 750.
--    500,00  a perna 2 desligada inteira (a regressao da 026, que a 049
--            consertou). Esta aqui porque a 063 recola o corpo da 049, e
--            `create-or-replace-view-de-pr-aberto-reverte-migration-mergeada`
--            e o jeito de ela voltar sem sintoma.
--
-- Cada um tem um `refute_num`. Exigir 550 sozinho ficaria vermelho se o numero
-- mudasse, mas nao diria QUAL metade da migration caiu.
--
-- AS SECOES, E POR QUE CADA UMA
-- -----------------------------
--   * SECAO 1 e o teto PESSOAL: exige 550,00 e nega os cinco numeros acima.
--     Leva tambem o `consumption_status`, porque e ele que a pessoa ve -- o
--     MESMO mes sai 'exceeded' antes da 063 e 'ok' depois dela, e uma barra
--     vermelha de estouro por causa de um ajuste de saldo e literalmente o
--     relato que abriu a HMO-443.
--   * SECAO 2 e o teto de GRUPO, e ele TAMBEM honra o flag -- a perna 1 e a
--     mesma subquery nos dois casos. A assercao existe porque a secao 3c do
--     plano tira os NUMEROS DE GRUPO do alcance do flag, e e preciso dizer, com
--     uma medida, que o teto de grupo nao e um deles: teto e relatorio de
--     gasto, divida e `group_share_entries`.
--   * SECAO 3 e a perna 2 ISOLADA, e e a assercao mais importante do arquivo.
--     Um teto pessoal de Transporte em que a UNICA coisa que existe e a minha
--     parte de uma linha que OUTRO pagou e desmarcou. Aqui nao ha valor cheio
--     nenhum para mascarar o resultado: se o filtro vazar para a perna 2, o
--     numero vai a ZERO. Na secao 1 o mesmo defeito so tira 30 de 550, que e a
--     diferenca que passa por revisao.
--   * SECAO 4 e o teto que ficou SO com linha desmarcada: `spent` = 0 e a linha
--     do teto CONTINUA NA LISTA. Sao dois fatos e o segundo e o `LEFT JOIN
--     LATERAL ... ON TRUE` -- um teto que desaparece da tela quando o gasto
--     dele e descartado seria pior que o numero errado, porque a pessoa nao tem
--     onde clicar para entender (`linha-zerada-nas-views-do-008`).
--   * SECAO 5 e o NAO-BACKFILL: as linhas desmarcadas da fixture continuam
--     `include_in_total = false` depois da colagem. A 063 nao tem `UPDATE`
--     nenhum e nao pode ter -- um "religar quem esta desmarcado" de limpeza
--     desfaria, calado, toda escolha que o usuario fez na tela.
--   * SECAO 6 e o CONTROLE NEGATIVO da RLS, mais a assercao SEPARADA sobre as
--     `reloptions` (porque `CREATE OR REPLACE VIEW` as apaga e o controle pela
--     RLS nao pega isso sozinho -- medido na 046), mais o CONTROLE POSITIVO de
--     `pg_get_viewdef`: sem ele, "a view nao cita a tabela" e indistinguivel de
--     "a view nao tem nada a ver com a tabela", e uma sonda que so procura o
--     nome da coluna confirmaria o proprio typo.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 063:
--   psql "$DB_URL" -f database/tests/063_orcamento_ignora_fora_dos_totais_test.sql
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

CREATE OR REPLACE FUNCTION pg_temp.expect_text(label TEXT, got TEXT, want TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- A negacao. `expect_num` fica vermelho quando o numero muda, mas nao diz QUAL
-- numero errado apareceu -- e os numeros errados desta feature foram medidos em
-- banco, um por um (ver o cabecalho).
CREATE OR REPLACE FUNCTION pg_temp.refute_num(label TEXT, got NUMERIC, forbidden NUMERIC, porque TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS NOT DISTINCT FROM forbidden THEN
    RAISE EXCEPTION 'FALHA: % -> obtido %, que e exatamente %', label, forbidden, porque;
  END IF;
  RAISE NOTICE 'ok: % (nao e %)', label, forbidden;
END $$;

-- =====================================================
-- Fixture
-- =====================================================
-- MAIO/2026, tres pessoas (A, B, C) e UM grupo de tres. Cada despesa de grupo
-- e rateada pelo trigger do 001/042 -- nada aqui escreve rateio --, entao a
-- parte de cada um e um terco.
--
-- ALIMENTACAO, o teto PESSOAL da A (700,00):
--
--   Mercado                -500,00  A, sem grupo, SOMA      -> 500,00 perna 1
--   Ajuste de saldo        -200,00  A, sem grupo, DESMARCADO -> 0 (063)
--   Mercado do grupo        -60,00  B, grupo,     SOMA      ->  20,00 perna 2
--   Padaria do grupo        -90,00  B, grupo,     DESMARCADO ->  30,00 perna 2
--
--   550,00 de 700,00 = 78,57%, logo 'ok' (o limiar padrao e 0,800).
--   Antes da 063: 750,00, 107,14%, 'exceeded'.
--
-- O ajuste de saldo de 200,00 nao e um numero decorativo: ele e o CASO REAL da
-- HMO-443 ("adicionei um ajuste na minha conta investimento, ela entrou como
-- uma receita de ajuste mas nao quero que ela fique somada nos totais"), aqui
-- do lado da despesa, que e o lado que o teto ve.
--
-- O teto de 700 tambem nao e folgado de proposito: com um teto grande as duas
-- versoes da view dariam 'ok' e a secao 1 mediria so o `spent`.
--
-- ALIMENTACAO, o teto de GRUPO da Casa (100,00): a perna 1 soma o que o grupo
-- inteiro gastou e a perna 2 fica desligada. 60,00 -- a padaria desmarcada sai.
--
-- TRANSPORTE, o teto PESSOAL da A (100,00): SO a parte de uma linha que a B
-- pagou e desmarcou. 20,00 -- e a secao 3.
--
-- LAZER, o teto PESSOAL da A (400,00): SO uma linha desmarcada da propria A.
-- 0,00 -- e a secao 4.
--
-- Os ids de servico e categoria sao os do seed de referencia do 001_baseline,
-- escritos por extenso pelo mesmo motivo do teste do 006 e do 049: o bundle do
-- SQL Editor so traduz o \set ON_ERROR_STOP.
--   servico      8730cd96-d656-4c48-863e-673e1016a832  (personal_finance)
--   Alimentacao  b9db286c-ce4f-4fbe-b0bf-f3133185f90f
--   Transporte   49d97f81-6f07-4e6d-9822-75167b8426b2
--   Lazer        57726de2-7a27-493b-b010-04814a7475c4

INSERT INTO auth.users (id, email) VALUES
  ('a6300000-0000-0000-0000-0000000000a1', 'a-063@teste.local'),
  ('a6300000-0000-0000-0000-0000000000b1', 'b-063@teste.local'),
  ('a6300000-0000-0000-0000-0000000000c1', 'c-063@teste.local');

-- `is_public = FALSE` de proposito: o `view_security_invoker_test.sql` roda
-- depois e perde o controle dele com perfil publico -- a armadilha que o
-- cabecalho de `056_contas_antes_da_056.sql` registra.
INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('a6300000-0000-0000-0000-0000000000a1', 'A 063', FALSE),
  ('a6300000-0000-0000-0000-0000000000b1', 'B 063', FALSE),
  ('a6300000-0000-0000-0000-0000000000c1', 'C 063', FALSE);

INSERT INTO public.expense_groups (id, name, created_by, currency) VALUES
  ('96300000-0000-0000-0000-000000000001', 'Casa 063',
   'a6300000-0000-0000-0000-0000000000a1', 'BRL');

-- A entra como admin pelo trigger add_group_creator; B e C entram aqui.
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('96300000-0000-0000-0000-000000000001',
   'a6300000-0000-0000-0000-0000000000b1', 'member', 'active'),
  ('96300000-0000-0000-0000-000000000001',
   'a6300000-0000-0000-0000-0000000000c1', 'member', 'active');

INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance) VALUES
  ('f6300000-0000-0000-0000-0000000000a1', 'a6300000-0000-0000-0000-0000000000a1',
   'Conta A 063', 'checking', 100000),
  ('f6300000-0000-0000-0000-0000000000b1', 'a6300000-0000-0000-0000-0000000000b1',
   'Conta B 063', 'checking', 100000);

-- ATENCAO AO SINAL: despesa entra NEGATIVA neste banco. Com valores positivos
-- na fixture, um `SUM(t.amount)` sem ABS na perna 1 passaria por este arquivo e
-- devolveria consumo negativo no app, onde o alerta de estouro nunca dispara.
--
-- `include_in_total` e escrito EXPLICITAMENTE em toda linha, inclusive nas que
-- valem `true` -- que e o DEFAULT. Deixar o default implicito faria toda
-- fixture tocada ter so linha marcada OU so linha nao marcada por acidente, que
-- e o caso em que o filtro pode ser APAGADO e o teste continua verde
-- (`guarda-de-ancora-verde-nao-prova-que-o-mutante-morre`).
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type, include_in_total)
VALUES
  -- ALIMENTACAO / MAIO -- a perna 1 da A
  ('76300000-0000-0000-0000-000000000001',
   'a6300000-0000-0000-0000-0000000000a1', 'f6300000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   NULL, 'Mercado', -500.00, DATE '2026-05-05', 'expense', TRUE),

  -- O CASO DA ISSUE: o ajuste de saldo, desmarcado. Ele e o que a 063 tira.
  ('76300000-0000-0000-0000-000000000002',
   'a6300000-0000-0000-0000-0000000000a1', 'f6300000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   NULL, 'Ajuste de saldo', -200.00, DATE '2026-05-08', 'expense', FALSE),

  -- ALIMENTACAO / MAIO -- a B pagou pelo grupo, SOMANDO. A parte da A e 20,00.
  ('76300000-0000-0000-0000-000000000003',
   'a6300000-0000-0000-0000-0000000000b1', 'f6300000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   '96300000-0000-0000-0000-000000000001', 'Mercado do grupo',
   -60.00, DATE '2026-05-12', 'expense', TRUE),

  -- ALIMENTACAO / MAIO -- a B pagou pelo grupo e DESMARCOU a linha dela.
  -- A parte da A (30,00) CONTINUA no teto da A: e divida, nao relatorio.
  ('76300000-0000-0000-0000-000000000004',
   'a6300000-0000-0000-0000-0000000000b1', 'f6300000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   '96300000-0000-0000-0000-000000000001', 'Padaria do grupo',
   -90.00, DATE '2026-05-18', 'expense', FALSE),

  -- TRANSPORTE / MAIO -- a secao 3. A B pagou 60 pelo grupo e desmarcou; a
  -- parte da A e 20,00, e e a UNICA coisa no teto de Transporte dela.
  ('76300000-0000-0000-0000-000000000005',
   'a6300000-0000-0000-0000-0000000000b1', 'f6300000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', '49d97f81-6f07-4e6d-9822-75167b8426b2',
   '96300000-0000-0000-0000-000000000001', 'Uber do grupo',
   -60.00, DATE '2026-05-22', 'expense', FALSE),

  -- LAZER / MAIO -- a secao 4. SO uma linha desmarcada da propria A.
  ('76300000-0000-0000-0000-000000000006',
   'a6300000-0000-0000-0000-0000000000a1', 'f6300000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', '57726de2-7a27-493b-b010-04814a7475c4',
   NULL, 'Ajuste de fatura', -300.00, DATE '2026-05-25', 'expense', FALSE);

INSERT INTO public.budgets (id, user_id, category_id, group_id, month, amount_limit) VALUES
  -- 1. o teto PESSOAL da A na Alimentacao
  ('b6300000-0000-0000-0000-000000000001',
   'a6300000-0000-0000-0000-0000000000a1', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   NULL, DATE '2026-05-01', 700.00),
  -- 2. o teto de GRUPO da Casa na Alimentacao
  ('b6300000-0000-0000-0000-000000000002',
   'a6300000-0000-0000-0000-0000000000a1', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   '96300000-0000-0000-0000-000000000001', DATE '2026-05-01', 100.00),
  -- 3. o teto PESSOAL da A no Transporte -- so a perna 2
  ('b6300000-0000-0000-0000-000000000003',
   'a6300000-0000-0000-0000-0000000000a1', '49d97f81-6f07-4e6d-9822-75167b8426b2',
   NULL, DATE '2026-05-01', 100.00),
  -- 4. o teto PESSOAL da A no Lazer -- so linha desmarcada
  ('b6300000-0000-0000-0000-000000000004',
   'a6300000-0000-0000-0000-0000000000a1', '57726de2-7a27-493b-b010-04814a7475c4',
   NULL, DATE '2026-05-01', 400.00);

-- A fixture entrou como superusuario; as assercoes leem PELA RLS, como o app.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a6300000-0000-0000-0000-0000000000a1';

-- =====================================================
-- 1. O teto PESSOAL: 550,00, e os cinco numeros errados negados
-- =====================================================
SELECT pg_temp.expect_num('teto pessoal de maio: 550,00 (500 cheio + 20 + 30 de parte)',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b6300000-0000-0000-0000-000000000001'), 550.00);

SELECT pg_temp.refute_num('o ajuste de saldo desmarcado NAO consome o teto',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b6300000-0000-0000-0000-000000000001'),
  750.00, 'a view SEM o AND t.include_in_total na perna 1 -- a 063 nao colou');

SELECT pg_temp.refute_num('o filtro NAO vazou para a perna do reembolso',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b6300000-0000-0000-0000-000000000001'),
  520.00, 'a perna 2 filtrada tambem -- a minha divida de 30,00 desaparecida (decisao D violada)');

SELECT pg_temp.refute_num('as duas metades nao estao trocadas',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b6300000-0000-0000-0000-000000000001'),
  720.00, 'o filtro na perna 2 e nenhum na perna 1');

SELECT pg_temp.refute_num('a perna do reembolso nao foi desligada pela recolagem',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b6300000-0000-0000-0000-000000000001'),
  500.00, 'o corpo da 026 de volta -- a 049 revertida pelo CREATE OR REPLACE desta migration');

-- O `remaining` e o `consumed_ratio` saem do `spent`, mas valem assercao
-- propria: eles sao o que a BARRA da tela desenha, e um `spent` certo com uma
-- subtracao errada e um defeito que nenhuma das linhas acima pega.
SELECT pg_temp.expect_num('o que resta do teto: 150,00',
  (SELECT remaining FROM public.budget_consumption
    WHERE id = 'b6300000-0000-0000-0000-000000000001'), 150.00);

SELECT pg_temp.expect_num('a fracao consumida: 0,7857',
  (SELECT consumed_ratio FROM public.budget_consumption
    WHERE id = 'b6300000-0000-0000-0000-000000000001'), 0.7857);

-- O STATUS E A ASSERCAO QUE O USUARIO VE. Sem a 063 este mesmo mes marca
-- 'exceeded' por causa de um ajuste de saldo, que e o relato da HMO-443.
SELECT pg_temp.expect_text('o status do mes: ok (e nao exceeded, como antes da 063)',
  (SELECT consumption_status FROM public.budget_consumption
    WHERE id = 'b6300000-0000-0000-0000-000000000001'), 'ok');

-- =====================================================
-- 2. O teto de GRUPO TAMBEM honra o flag
-- =====================================================
-- A perna 1 e a MESMA subquery do teto pessoal (o `CASE` ali so troca quem e o
-- dono do recorte), e nao ha ramo condicional por `b.group_id` no filtro novo.
-- Isto nao contradiz a secao 3c do plano: o que fica fora do alcance do flag
-- sao as DIVIDAS de grupo (`group_share_entries`, `group_member_balances`, os
-- acertos), e um teto e relatorio de gasto, nao divida.
SELECT pg_temp.expect_num('teto de grupo de maio: 60,00 -- a padaria desmarcada sai',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b6300000-0000-0000-0000-000000000002'), 60.00);

SELECT pg_temp.refute_num('o teto de grupo nao conta a linha desmarcada',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b6300000-0000-0000-0000-000000000002'),
  150.00, 'a padaria de 90,00 somada -- o filtro condicionado a b.group_id IS NULL');

-- A perna 2 continua DESLIGADA no teto de grupo (049). Se ela vazasse para ca,
-- a parte de cada membro entraria por cima do valor cheio e a conta subiria a
-- cada membro novo.
SELECT pg_temp.refute_num('a perna do reembolso continua desligada no teto de grupo',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b6300000-0000-0000-0000-000000000002'),
  80.00, 'o valor cheio de 60 mais a parte de 20 da propria A');

-- =====================================================
-- 3. A perna 2 ISOLADA -- a assercao mais importante do arquivo
-- =====================================================
-- O teto de Transporte da A nao tem valor cheio NENHUM: a unica coisa nele e a
-- parte da A de uma linha que a B pagou e DESMARCOU. Se o filtro novo vazar
-- para a perna 2, este numero vai a zero -- e zero e o que nao se nota.
--
-- Na secao 1 o mesmo defeito tira 30 de 550; aqui ele tira tudo. Era por isso
-- que valia plantar um teto so para ele.
SELECT pg_temp.expect_num('teto de Transporte: 20,00 -- a minha parte da linha desmarcada de outro',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b6300000-0000-0000-0000-000000000003'), 20.00);

SELECT pg_temp.refute_num('a divida nao desapareceu porque QUEM LANCOU desmarcou',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b6300000-0000-0000-0000-000000000003'),
  0.00, 'a perna 2 filtrada pelo include_in_total da linha de outra pessoa');

SELECT pg_temp.refute_num('entra a MINHA PARTE, nao o valor cheio de quem pagou',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b6300000-0000-0000-0000-000000000003'),
  60.00, 'o valor cheio da linha da B dentro do teto da A');

SELECT pg_temp.expect_text('e o teto de Transporte esta em ok, com 20 de 100',
  (SELECT consumption_status FROM public.budget_consumption
    WHERE id = 'b6300000-0000-0000-0000-000000000003'), 'ok');

-- =====================================================
-- 4. O teto que ficou SO com linha desmarcada: zero, E CONTINUA NA LISTA
-- =====================================================
-- Dois fatos, e o segundo e o `LEFT JOIN LATERAL ... ON TRUE`. Um teto que
-- desaparece da tela quando o gasto dele e descartado e pior que um numero
-- errado: a pessoa nao tem onde clicar para entender o que aconteceu.
SELECT pg_temp.expect('o teto so-com-desmarcado CONTINUA na lista',
  (SELECT count(*) FROM public.budget_consumption
    WHERE id = 'b6300000-0000-0000-0000-000000000004'), 1);

SELECT pg_temp.expect_num('e ele consumiu 0,00',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b6300000-0000-0000-0000-000000000004'), 0.00);

SELECT pg_temp.refute_num('o ajuste de fatura de 300,00 nao entrou',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b6300000-0000-0000-0000-000000000004'),
  300.00, 'a linha desmarcada consumindo o teto inteiro de Lazer');

SELECT pg_temp.expect_num('e o teto inteiro continua disponivel: 400,00',
  (SELECT remaining FROM public.budget_consumption
    WHERE id = 'b6300000-0000-0000-0000-000000000004'), 400.00);

-- =====================================================
-- 5. NAO-BACKFILL: a 063 nao religa o que a pessoa desmarcou
-- =====================================================
-- A 063 e so view e nao tem `UPDATE` nenhum. Esta secao e o que impede um
-- "religar quem esta desmarcado" de limpeza de aparecer nela depois -- ele
-- desfaria, calado, toda escolha feita na tela, e o sintoma seria um teto que
-- volta a estourar sozinho.
--
-- A COBAIA E A LINHA DA FIXTURE DA 060, E NAO A DESTE ARQUIVO. Medido: com um
-- `UPDATE financial_transactions SET include_in_total = true` acrescentado ao
-- fim da 063, uma assercao sobre as linhas desta fixture fica VERDE -- o
-- UPDATE da migration roda em outra sessao, ANTES de a fixture daqui existir,
-- e so pega o que ja estava no banco. O mutante sobreviveu assim na primeira
-- medicao.
--
-- As duas linhas abaixo sao as que `060_lancamento_fora_do_total.sql` desmarcou
-- e COMITOU, bem antes deste passo do job, e sao elas que um backfill pegaria.
-- Elas estao no banco do CI de verdade: medido com
-- `SELECT id, description FROM financial_transactions WHERE NOT include_in_total`
-- contra a cadeia 001 -> 062 montada do zero, que devolve exatamente estas duas.
RESET ROLE;

SELECT pg_temp.expect('as duas linhas desmarcadas pela fixture da 060 (commitadas) continuam desmarcadas',
  (SELECT count(*) FROM public.financial_transactions
    WHERE id IN ('60600000-0000-0000-0000-000000000003',
                 '60600000-0000-0000-0000-000000000004')
      AND include_in_total = FALSE), 2);

-- O CONTROLE POSITIVO da assercao de cima: as duas linhas EXISTEM. Sem ele,
-- apagar a fixture da 060 (ou renumerar os ids dela) deixaria o `count` dar 0,
-- a comparacao daria `0 = 0`... nao: daria `0 <> 2` e ficaria vermelha. O risco
-- real e o inverso -- alguem "consertar" o 2 para 0 quando a fixture mudar.
-- Esta linha diz, em separado, que o alvo e dois registros e nao um conjunto
-- vazio (`guarda-de-ancora-verde-nao-prova-que-o-mutante-morre`).
SELECT pg_temp.expect('CONTROLE POSITIVO: as duas linhas da fixture da 060 existem no banco',
  (SELECT count(*) FROM public.financial_transactions
    WHERE id IN ('60600000-0000-0000-0000-000000000003',
                 '60600000-0000-0000-0000-000000000004')), 2);

-- E as linhas desta fixture tambem, que e o controle de que a 063 nao mexe em
-- dado NENHUM -- nem no antigo nem no que nasce depois dela.
SELECT pg_temp.expect('as quatro linhas desmarcadas desta fixture continuam desmarcadas',
  (SELECT count(*) FROM public.financial_transactions
    WHERE id IN ('76300000-0000-0000-0000-000000000002',
                 '76300000-0000-0000-0000-000000000004',
                 '76300000-0000-0000-0000-000000000005',
                 '76300000-0000-0000-0000-000000000006')
      AND include_in_total = FALSE), 4);

SELECT pg_temp.expect('e as duas marcadas continuam marcadas',
  (SELECT count(*) FROM public.financial_transactions
    WHERE id IN ('76300000-0000-0000-0000-000000000001',
                 '76300000-0000-0000-0000-000000000003')
      AND include_in_total = TRUE), 2);

-- =====================================================
-- 6. A RLS, as reloptions e o CONTROLE POSITIVO do corpo da view
-- =====================================================
-- A view le `group_share_entries`, que a 033 deixou SEM filtro de user_id de
-- proposito ("quem le PRECISA filtrar"). Quem segura o orcamento alheio fora da
-- lista e a RLS do 006 -- e ela so vale porque a view e `security_invoker`, que
-- e justamente a reloption que o `CREATE OR REPLACE VIEW` desta migration
-- apaga.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a6300000-0000-0000-0000-0000000000c1';

-- A C nao tem teto nenhum e divide o grupo com a A. Ela ve o teto de GRUPO (a
-- RLS do 006 permite, de proposito: e o teto da casa dela tambem) e NENHUM teto
-- pessoal de outra pessoa.
SELECT pg_temp.expect('a C nao ve teto PESSOAL de ninguem',
  (SELECT count(*) FROM public.budget_consumption
    WHERE group_id IS NULL
      AND id IN ('b6300000-0000-0000-0000-000000000001',
                 'b6300000-0000-0000-0000-000000000003',
                 'b6300000-0000-0000-0000-000000000004')), 0);

SELECT pg_temp.expect('a C ve o teto de GRUPO da Casa, que e dela tambem',
  (SELECT count(*) FROM public.budget_consumption
    WHERE id = 'b6300000-0000-0000-0000-000000000002'), 1);

RESET ROLE;

-- A assercao SEPARADA sobre as reloptions. Medido na 046: um controle negativo
-- pela RLS NAO pega a perda do `security_invoker` quando a view so le outras
-- views -- e `budget_consumption` le `budgets`, que TEM RLS, entao aqui pega.
-- As duas existem porque medem coisas diferentes: esta fica vermelha mesmo num
-- banco sem a segunda pessoa para comparar.
SELECT pg_temp.expect('budget_consumption tem security_invoker=true no catalogo',
  (SELECT count(*) FROM pg_class
    WHERE oid = 'public.budget_consumption'::regclass
      AND reloptions @> ARRAY['security_invoker=true']), 1);

-- O `anon` -- e esta assercao SO MEDE ALGO porque
-- `063_anon_com_grant_antes_da_063.sql` roda antes e CONCEDE o privilegio.
-- Medido: num banco em que ninguem concedeu nada, `anon` ja chega sem
-- privilegio nenhum (a 049 revogou e `CREATE OR REPLACE VIEW` preserva ACL),
-- entao esta linha fica verde com o `REVOKE` da 063 APAGADO -- foi assim que o
-- mutante M8 sobreviveu na primeira rodada. O arquivo de fixture existe para
-- transformar esta linha de enfeite em medida.
SELECT pg_temp.expect('anon nao tem privilegio em budget_consumption',
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'budget_consumption'
      AND grantee = 'anon'), 0);

-- O CONTROLE POSITIVO, e ele e o par obrigatorio das duas linhas abaixo: sem
-- ele, "o corpo da view nao cita `include_in_total`" e indistinguivel de "esta
-- view nao tem nada a ver com `financial_transactions`" -- um renomear de
-- tabela, um DROP seguido de recriacao a partir de outra fonte, ou um typo na
-- propria sonda passariam verdes. Ver
-- `sonda-de-coluna-inventada-confirma-o-proprio-typo`.
SELECT pg_temp.expect('CONTROLE POSITIVO: o corpo de budget_consumption cita financial_transactions',
  (SELECT count(*) WHERE pg_get_viewdef('public.budget_consumption'::regclass)
     ILIKE '%financial_transactions%'), 1);

SELECT pg_temp.expect('o corpo de budget_consumption cita include_in_total',
  (SELECT count(*) WHERE pg_get_viewdef('public.budget_consumption'::regclass)
     ILIKE '%include_in_total%'), 1);

-- E ele aparece UMA vez so: a perna 1 filtra, a perna 2 nao. Duas ocorrencias
-- sao a decisao D violada; zero e a 063 nao colada. O numero EXATO e o que
-- separa os dois estados, e nenhum `ILIKE` sozinho faz isso.
SELECT pg_temp.expect('e UMA vez so -- a perna 1 filtra, a perna 2 nao',
  (SELECT count(*) FROM regexp_matches(
     pg_get_viewdef('public.budget_consumption'::regclass),
     'include_in_total', 'g')), 1);

DO $$ BEGIN RAISE NOTICE '063: todas as assercoes passaram'; END $$;

ROLLBACK;
