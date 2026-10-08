-- =====================================================
-- Teste do realizado de grupo no previsto x realizado (045)
-- =====================================================
-- HMO-258. Roda no db-verify, contra o banco que as migrations constroem do
-- zero, na posicao do 045 na cadeia.
--
-- "A view devolve 950" nao prova esta migration. Quase todo jeito errado de
-- escreve-la devolve um numero plausivel, e este arquivo nega um por um os
-- cinco que eu consegui medir:
--
--   900,00  o defeito da issue -- a despesa de grupo fora do realizado
--   990,00  trocar `personal_monthly_cash_flow` por `monthly_cash_flow` sem o
--           filtro de `group_id`: entra o valor CHEIO do que eu paguei
--   1100,00 as DUAS pernas do LATERAL casando na mesma chave (pessoal + grupo)
--   MES AUSENTE  a terceira origem de `chaves` esquecida: o mes em que a minha
--           unica despesa foi paga por outro membro desaparece do relatorio
--   PREVISTO DOBRADO  a chave virando duas linhas, o que dobra o previsto
--
-- OS CONTROLES, E POR QUE CADA UM
-- -------------------------------
--   * SECAO 1 exige 950 E nega 900 e 990. Exigir 950 sozinho ficaria vermelho
--     se o numero mudasse, mas nao diria QUAL defeito voltou -- e os dois
--     numeros errados ja foram medidos em `main`.
--   * SECAO 2 mede o relatorio DO GRUPO no mesmo mes e exige o valor CHEIO.
--     "A leitura pessoal ficou certa" e "a do grupo continuou certa" sao duas
--     afirmacoes diferentes, e a 033 escolheu nao mexer na segunda. Sem esta
--     secao, consertar a pessoal quebrando a do grupo passaria verde.
--   * SECAO 3 conta LINHAS, nao dinheiro. As duas pernas do LATERAL do
--     realizado precisam ser mutuamente exclusivas: se as duas casassem, a
--     chave viraria duas linhas e o relatorio contaria o PREVISTO duas vezes --
--     um numero dobrado, plausivel, sem erro. Nenhuma assercao sobre
--     `actual_expense` pega isso, porque o valor de cada linha continuaria
--     certo.
--   * SECAO 4 e o mes SO com despesa de outro membro. Ele prova a terceira
--     origem de `chaves`: sem ela o mes nao vem como zero, vem AUSENTE -- e um
--     mes ausente le-se na tela como "nao houve movimento".
--   * SECAO 5 e o CONTROLE NEGATIVO da RLS: quem nao divide grupo com ninguem
--     ve zero. `CREATE OR REPLACE VIEW` apaga as reloptions, e `security_invoker`
--     e uma reloption -- quem trocar a definicao da view sem reaplicar o ALTER
--     deixa ela rodando como o DONO, e esta view agora atravessa
--     `group_share_entries`, que chega em quatro tabelas de grupo. Sem esta
--     secao, todo o resto do arquivo estaria medindo superusuario.
--   * SECAO 6 exige que o realizado da view seja IGUAL ao de
--     `personal_monthly_cash_flow`. E a assercao que impede as duas leituras da
--     pagina de relatorios de divergirem DE NOVO, que e a reclamacao da
--     HMO-258: um numero certo hoje nao e o mesmo que um numero amarrado.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 045:
--   psql "$DB_URL" -f database/tests/045_realizado_de_grupo_no_previsto_x_realizado_test.sql
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

-- A negacao. `expect_num` fica vermelho quando o numero muda, mas nao diz QUAL
-- numero errado apareceu -- e os numeros errados desta feature ja foram
-- medidos, um por um.
CREATE OR REPLACE FUNCTION pg_temp.refute_num(label TEXT, got NUMERIC, forbidden NUMERIC, porque TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS NOT DISTINCT FROM forbidden THEN
    RAISE EXCEPTION 'FALHA: % -> obtido %, que e exatamente %', label, forbidden, porque;
  END IF;
  RAISE NOTICE 'ok: % (nao e %)', label, forbidden;
END $$;

-- =====================================================
-- Fixture: maio/2026 da conta A da HMO-255, tres membros
-- =====================================================
-- Os valores sao os da issue, e sao escolhidos para que cada defeito possivel
-- de um numero DISTINGUIVEL: 900, 950, 990 e 1100 nao se confundem.
--
--   mercado       500,00  so da A
--   combustivel   400,00  so da A
--   jantar         90,00  pago pela A, grupo de 3  -> a parte dela e 30,00
--   mercado grupo  60,00  pago pela B, grupo de 3  -> a parte dela e 20,00
--
-- A soma pelo criterio da pagina de relatorios ("minha parte", 033) e
-- 500 + 400 + 30 + 20 = 950,00.
--
-- E uma conta PREVISTA de 700,00 em maio, para que `expense_variance` tenha
-- valor e o previsto dobrado (secao 3) seja visivel como numero, nao so como
-- contagem de linhas.

INSERT INTO auth.users (id, email) VALUES
  ('a4300000-0000-0000-0000-0000000000a1', 'a-045r@teste.local'),
  ('a4300000-0000-0000-0000-0000000000b1', 'b-045r@teste.local'),
  ('a4300000-0000-0000-0000-0000000000c1', 'c-045r@teste.local'),
  -- Dora NAO entra em grupo nenhum: e o controle negativo da secao 5, e o
  -- unico jeito de saber se a view respeita a RLS ou roda como o dono.
  ('a4300000-0000-0000-0000-0000000000d1', 'dora-045r@teste.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('a4300000-0000-0000-0000-0000000000a1', 'A 045r',    FALSE),
  ('a4300000-0000-0000-0000-0000000000b1', 'B 045r',    FALSE),
  ('a4300000-0000-0000-0000-0000000000c1', 'C 045r',    FALSE),
  ('a4300000-0000-0000-0000-0000000000d1', 'Dora 045', FALSE);

INSERT INTO public.expense_groups (id, name, created_by) VALUES
  ('94300000-0000-0000-0000-000000000001', 'Casa 045',
   'a4300000-0000-0000-0000-0000000000a1');

-- A entra como admin pelo trigger add_group_creator; B e C entram aqui.
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('94300000-0000-0000-0000-000000000001',
   'a4300000-0000-0000-0000-0000000000b1', 'member', 'active'),
  ('94300000-0000-0000-0000-000000000001',
   'a4300000-0000-0000-0000-0000000000c1', 'member', 'active');

INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance) VALUES
  ('f4300000-0000-0000-0000-0000000000a1', 'a4300000-0000-0000-0000-0000000000a1',
   'Conta A', 'checking', 10000),
  ('f4300000-0000-0000-0000-0000000000b1', 'a4300000-0000-0000-0000-0000000000b1',
   'Conta B', 'checking', 10000),
  ('f4300000-0000-0000-0000-0000000000d1', 'a4300000-0000-0000-0000-0000000000d1',
   'Conta Dora', 'checking', 10000);

-- `amount` NEGATIVO, como o app grava. O trigger do 001/042 cria as tres partes
-- de cada despesa de grupo sozinho -- nada aqui escreve rateio.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type)
SELECT v.id, v.user_id, v.account_id, c.service_id, c.id, v.group_id,
       v.description, v.amount, v.transaction_date, 'expense'
  FROM (VALUES
    ('74300000-0000-0000-0000-000000000001'::uuid,
     'a4300000-0000-0000-0000-0000000000a1'::uuid,
     'f4300000-0000-0000-0000-0000000000a1'::uuid,
     NULL::uuid, 'Mercado', -500.00::numeric, DATE '2026-05-05'),
    ('74300000-0000-0000-0000-000000000002',
     'a4300000-0000-0000-0000-0000000000a1',
     'f4300000-0000-0000-0000-0000000000a1',
     NULL, 'Combustivel', -400.00, DATE '2026-05-08'),
    ('74300000-0000-0000-0000-000000000003',
     'a4300000-0000-0000-0000-0000000000a1',
     'f4300000-0000-0000-0000-0000000000a1',
     '94300000-0000-0000-0000-000000000001', 'Jantar do grupo',
     -90.00, DATE '2026-05-12'),
    ('74300000-0000-0000-0000-000000000004',
     'a4300000-0000-0000-0000-0000000000b1',
     'f4300000-0000-0000-0000-0000000000b1',
     '94300000-0000-0000-0000-000000000001', 'Mercado do grupo',
     -60.00, DATE '2026-05-20'),
    -- JUNHO, e a SECAO 4: a unica despesa que toca a A neste mes foi paga pela
    -- B. A A nao tem linha nenhuma em financial_transactions em junho.
    ('74300000-0000-0000-0000-000000000005',
     'a4300000-0000-0000-0000-0000000000b1',
     'f4300000-0000-0000-0000-0000000000b1',
     '94300000-0000-0000-0000-000000000001', 'Faxina do grupo (junho)',
     -300.00, DATE '2026-06-10'),
    -- A Dora gasta sozinha, para o controle negativo medir uma conta VIVA. Uma
    -- conta vazia veria zero de qualquer jeito, e o controle seria vacuo.
    ('74300000-0000-0000-0000-000000000006',
     'a4300000-0000-0000-0000-0000000000d1',
     'f4300000-0000-0000-0000-0000000000d1',
     NULL, 'Farmacia da Dora', -77.00, DATE '2026-05-14')
  ) AS v(id, user_id, account_id, group_id, description, amount, transaction_date),
  LATERAL (SELECT tc.id, tc.service_id FROM public.transaction_categories tc
            WHERE tc.is_expense ORDER BY tc.id LIMIT 1) AS c;

-- A conta prevista de maio, para a variancia ter valor.
INSERT INTO public.scheduled_transactions
  (user_id, category_id, description, amount, due_date, status)
SELECT 'a4300000-0000-0000-0000-0000000000a1', c.id,
       'Aluguel previsto', 700.00, DATE '2026-05-10', 'pending'
  FROM public.transaction_categories c WHERE c.is_expense ORDER BY c.id LIMIT 1;

-- A fixture so vale se o rateio existir de verdade. Sem isto, todo numero deste
-- arquivo poderia ser "o trigger nao rodou" em vez de "a view nao conta".
SELECT pg_temp.expect('o jantar nasceu com 3 partes',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '74300000-0000-0000-0000-000000000003'), 3);

SELECT pg_temp.expect_num('a parte da A no jantar e 30,00 e esta POSITIVA',
  (SELECT es.amount FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
     JOIN public.group_members em ON em.id = es.member_id
    WHERE gt.transaction_id = '74300000-0000-0000-0000-000000000003'
      AND em.user_id = 'a4300000-0000-0000-0000-0000000000a1'), 30.00);

SELECT pg_temp.expect_num('a parte da A no mercado da B e 20,00',
  (SELECT es.amount FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
     JOIN public.group_members em ON em.id = es.member_id
    WHERE gt.transaction_id = '74300000-0000-0000-0000-000000000004'
      AND em.user_id = 'a4300000-0000-0000-0000-0000000000a1'), 20.00);

-- =====================================================
-- SECAO 1: o realizado pessoal inclui a minha parte de grupo
-- =====================================================
-- A assercao central da issue. Medida como a A, pela RLS dela, e pela MESMA
-- view que a rota le, com o MESMO filtro da rota
-- (app/api/reports/planned-vs-actual/route.ts: `.is("group_id", null)`).

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a4300000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect_num('o realizado de maio e 950,00 (500 + 400 + 30 + 20)',
  (SELECT COALESCE(SUM(actual_expense), 0) FROM public.planned_vs_actual
    WHERE user_id = 'a4300000-0000-0000-0000-0000000000a1'
      AND group_id IS NULL
      AND month = DATE '2026-05-01'), 950.00);

-- O DEFEITO DA ISSUE, negado. 900 = 500 + 400: a despesa de grupo fora inteira,
-- que e o que a view fazia lendo `monthly_cash_flow` com `group_id IS NULL`.
SELECT pg_temp.refute_num('o realizado NAO e 900,00',
  (SELECT COALESCE(SUM(actual_expense), 0) FROM public.planned_vs_actual
    WHERE user_id = 'a4300000-0000-0000-0000-0000000000a1'
      AND group_id IS NULL
      AND month = DATE '2026-05-01'),
  900.00, 'o defeito da HMO-258: a despesa de grupo fora do realizado');

-- O CONSERTO ERRADO, negado. 990 = 500 + 400 + os 90 INTEIROS do jantar: o
-- resultado de ler `monthly_cash_flow` sem o filtro de `group_id` em vez de ler
-- `personal_monthly_cash_flow`. Ele conta os 60,00 que B e C devolvem como
-- gasto da A, e ainda perde a parte dela no mercado da B.
SELECT pg_temp.refute_num('o realizado NAO e 990,00',
  (SELECT COALESCE(SUM(actual_expense), 0) FROM public.planned_vs_actual
    WHERE user_id = 'a4300000-0000-0000-0000-0000000000a1'
      AND group_id IS NULL
      AND month = DATE '2026-05-01'),
  990.00, 'o valor CHEIO do que a A pagou -- ler monthly_cash_flow sem o filtro de group_id');

-- E a variancia, que e o que o relatorio existe para mostrar. 950 - 700 = 250.
-- Com o defeito ela era 200,00 -- e o relatorio dizia que a pessoa estourou o
-- previsto em 50,00 MENOS do que estourou.
SELECT pg_temp.expect_num('a variancia de maio e 250,00 (950 - 700)',
  (SELECT COALESCE(SUM(expense_variance), 0) FROM public.planned_vs_actual
    WHERE user_id = 'a4300000-0000-0000-0000-0000000000a1'
      AND group_id IS NULL
      AND month = DATE '2026-05-01'), 250.00);

SELECT pg_temp.refute_num('a variancia NAO e 200,00',
  (SELECT COALESCE(SUM(expense_variance), 0) FROM public.planned_vs_actual
    WHERE user_id = 'a4300000-0000-0000-0000-0000000000a1'
      AND group_id IS NULL
      AND month = DATE '2026-05-01'),
  200.00, 'a variancia com a despesa de grupo fora -- 50,00 de estouro escondido');

-- =====================================================
-- SECAO 2: o relatorio DO GRUPO nao mudou
-- =====================================================
-- A fronteira que a 033 defendeu, e que esta migration tem de respeitar: no
-- lado do grupo o numero e o valor CHEIO da despesa, nao a parte de ninguem.
--
-- O FILTRO DE `user_id` TEM DE ESTAR AQUI, e a primeira versao desta secao
-- esquecia dele -- passava verde medindo outra coisa. A rota filtra `user_id`
-- SEMPRE, nos dois modos (route.ts: `.eq("user_id", user.id)` vem ANTES do
-- `groupId ? ... : ...`). Entao o grao do relatorio de grupo e POR PAGADOR: a
-- A ve os 90,00 do jantar que ELA lancou, e nao os 150,00 do grupo todo. Uma
-- assercao de 150,00 sem o filtro soma as linhas da A e da B e fecha por
-- acidente -- ela ficaria verde mesmo se a view passasse a dar a parte de cada
-- um, porque 30 + 60 tambem nao e 150, mas 90 + 60 e.
--
-- (Que o relatorio DO GRUPO mostre so o que eu paguei, em vez do total do
-- grupo, e uma oddidade anterior a esta migration e fora do escopo dela. Esta
-- secao documenta o comportamento de hoje para que o 045 nao o mude por
-- acidente, nao o aprova.)
--
-- Se esta secao cair, o 045 consertou a leitura pessoal quebrando a do grupo.

SELECT pg_temp.expect_num('no lado do grupo a A ve o valor CHEIO do que ela pagou (90,00)',
  (SELECT COALESCE(SUM(actual_expense), 0) FROM public.planned_vs_actual
    WHERE user_id = 'a4300000-0000-0000-0000-0000000000a1'
      AND group_id = '94300000-0000-0000-0000-000000000001'
      AND month = DATE '2026-05-01'), 90.00);

SELECT pg_temp.refute_num('o lado do grupo NAO virou a minha parte',
  (SELECT COALESCE(SUM(actual_expense), 0) FROM public.planned_vs_actual
    WHERE user_id = 'a4300000-0000-0000-0000-0000000000a1'
      AND group_id = '94300000-0000-0000-0000-000000000001'
      AND month = DATE '2026-05-01'),
  30.00, 'a parte da A no jantar -- a view do grupo passou a mostrar parte em vez do cheio');

-- E o lado do grupo nao pode ganhar linha. O grao aqui e UMA linha por
-- (pagador, grupo, mes, moeda).
SELECT pg_temp.expect('o lado do grupo da A em maio e UMA linha so',
  (SELECT count(*) FROM public.planned_vs_actual
    WHERE user_id = 'a4300000-0000-0000-0000-0000000000a1'
      AND group_id = '94300000-0000-0000-0000-000000000001'
      AND month = DATE '2026-05-01'), 1);

-- =====================================================
-- SECAO 2b: o membro que SO DEVE parte -- a C
-- =====================================================
-- A C e do grupo, deve 30,00 do jantar e 20,00 do mercado, e nao pagou nada:
-- zero linhas em `financial_transactions`, zero na agenda. Ela e a prova mais
-- limpa da terceira origem de `chaves`, porque TUDO o que ela tem no mes vem de
-- `group_share_entries`.
--
-- E ela e quem mede o `group_id = NULL` da chave nova. Medido com o mutante que
-- poe o `group_id` REAL ali (o erro que o comentario da migration descreve):
--
--   certo    -> uma linha PESSOAL de 50,00
--   mutante  -> uma linha DO GRUPO de 0,00, e nenhuma pessoal
--
-- Ou seja: o mes inteiro da C sai do relatorio dela e vira uma linha inutil no
-- relatorio do grupo. Nao e "uma linha a mais" nem "o valor dobrado" -- e a
-- despesa dela desaparecendo. As duas assercoes abaixo prendem as duas metades.

SELECT pg_temp.expect_num('a C ve 50,00 no relatorio PESSOAL dela (30 + 20)',
  (SELECT COALESCE(SUM(actual_expense), 0) FROM public.planned_vs_actual
    WHERE user_id = 'a4300000-0000-0000-0000-0000000000c1'
      AND group_id IS NULL
      AND month = DATE '2026-05-01'), 50.00);

SELECT pg_temp.expect('a C nao tem linha nenhuma do lado do GRUPO',
  (SELECT count(*) FROM public.planned_vs_actual
    WHERE user_id = 'a4300000-0000-0000-0000-0000000000c1'
      AND group_id = '94300000-0000-0000-0000-000000000001'), 0);

-- =====================================================
-- SECAO 3: UMA linha por chave -- as duas pernas sao exclusivas
-- =====================================================
-- Conta LINHAS, nao dinheiro, e e a unica secao que pega este defeito.
--
-- O realizado sai de um LEFT JOIN LATERAL com UNION ALL de duas pernas,
-- guardadas por `k.group_id IS NULL` e `k.group_id IS NOT NULL`. Se as duas
-- pudessem casar na mesma chave, o LATERAL devolveria duas linhas, a chave
-- viraria duas linhas da view, e o relatorio somaria o PREVISTO duas vezes:
-- 1400,00 de um aluguel de 700,00. Cada linha teria `actual_expense` certo, e
-- nenhuma assercao sobre o realizado ficaria vermelha.

SELECT pg_temp.expect('maio/2026 pessoal da A e UMA linha so',
  (SELECT count(*) FROM public.planned_vs_actual
    WHERE user_id = 'a4300000-0000-0000-0000-0000000000a1'
      AND group_id IS NULL
      AND month = DATE '2026-05-01'
      AND currency = 'BRL'), 1);

SELECT pg_temp.expect_num('o previsto de maio nao dobrou (700,00)',
  (SELECT COALESCE(SUM(planned_expense), 0) FROM public.planned_vs_actual
    WHERE user_id = 'a4300000-0000-0000-0000-0000000000a1'
      AND group_id IS NULL
      AND month = DATE '2026-05-01'), 700.00);

SELECT pg_temp.refute_num('o previsto de maio NAO e 1400,00',
  (SELECT COALESCE(SUM(planned_expense), 0) FROM public.planned_vs_actual
    WHERE user_id = 'a4300000-0000-0000-0000-0000000000a1'
      AND group_id IS NULL
      AND month = DATE '2026-05-01'),
  1400.00, 'o previsto contado duas vezes -- as duas pernas do LATERAL casando na mesma chave');

-- =====================================================
-- SECAO 4: o mes em que SO outro membro pagou
-- =====================================================
-- Junho: a unica despesa que toca a A e a faxina de 300,00 que a B pagou, com a
-- parte dela em 100,00. A A nao tem linha nenhuma em `financial_transactions`
-- em junho, e nenhuma conta prevista.
--
-- E esta a secao que prova a terceira origem de `chaves`. Sem ela a chave
-- (A, NULL, junho) nao existe e o mes nao aparece como zero: ele some do
-- relatorio. Um mes ausente le-se na tela como "nao houve movimento" -- o
-- sintoma mais silencioso desta familia.

SELECT pg_temp.expect('junho/2026 EXISTE no relatorio pessoal da A',
  (SELECT count(*) FROM public.planned_vs_actual
    WHERE user_id = 'a4300000-0000-0000-0000-0000000000a1'
      AND group_id IS NULL
      AND month = DATE '2026-06-01'), 1);

SELECT pg_temp.expect_num('o realizado de junho e a parte da A na faxina (100,00)',
  (SELECT COALESCE(SUM(actual_expense), 0) FROM public.planned_vs_actual
    WHERE user_id = 'a4300000-0000-0000-0000-0000000000a1'
      AND group_id IS NULL
      AND month = DATE '2026-06-01'), 100.00);

-- =====================================================
-- SECAO 5: CONTROLE NEGATIVO da RLS
-- =====================================================
-- A Dora nao divide grupo com ninguem e gastou 77,00 em maio. Ela tem de ver os
-- 77,00 dela e NADA da A -- nem o realizado, nem a linha do grupo.
--
-- `CREATE OR REPLACE VIEW` apaga as reloptions, e `security_invoker` e uma
-- reloption: trocar a definicao da view sem reaplicar o `ALTER VIEW` a deixa
-- rodando como o DONO. Esta view agora atravessa `group_share_entries`, que
-- chega em quatro tabelas de grupo -- o vazamento seria a variancia mensal de
-- todo mundo. Sem esta secao, todo o resto do arquivo mediria superusuario.
--
-- A Dora tem gasto PROPRIO de proposito: numa conta vazia ela veria zero de
-- qualquer jeito e o controle seria vacuo.

SET LOCAL request.jwt.claim.sub = 'a4300000-0000-0000-0000-0000000000d1';

SELECT pg_temp.expect_num('a Dora ve o gasto dela (77,00) -- a conta esta viva',
  (SELECT COALESCE(SUM(actual_expense), 0) FROM public.planned_vs_actual
    WHERE user_id = 'a4300000-0000-0000-0000-0000000000d1'
      AND group_id IS NULL
      AND month = DATE '2026-05-01'), 77.00);

SELECT pg_temp.expect('a Dora nao ve linha nenhuma da A',
  (SELECT count(*) FROM public.planned_vs_actual
    WHERE user_id = 'a4300000-0000-0000-0000-0000000000a1'), 0);

SELECT pg_temp.expect('a Dora nao ve linha nenhuma do grupo Casa 045',
  (SELECT count(*) FROM public.planned_vs_actual
    WHERE group_id = '94300000-0000-0000-0000-000000000001'), 0);

-- =====================================================
-- SECAO 6: a pagina de relatorios fala UM numero
-- =====================================================
-- A reclamacao da HMO-258 nao e "o numero esta errado", e "duas telas lado a
-- lado mostram numeros diferentes e a pessoa nao sabe em qual acreditar".
-- Entao o realizado desta view tem de ser IGUAL ao de
-- `personal_monthly_cash_flow`, que e o que os outros dois cartoes da MESMA
-- pagina leem (/api/reports/cash-flow e /api/reports/categories no modo mes).
--
-- Esta assercao e a que amarra as duas leituras. Sem ela, as duas podem voltar
-- a divergir no proximo conserto de uma delas -- que e exatamente a historia
-- que levou a esta issue.

SET LOCAL request.jwt.claim.sub = 'a4300000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect_num('o realizado da view e IGUAL ao de personal_monthly_cash_flow',
  (SELECT COALESCE(SUM(actual_expense), 0) FROM public.planned_vs_actual
    WHERE user_id = 'a4300000-0000-0000-0000-0000000000a1'
      AND group_id IS NULL
      AND month = DATE '2026-05-01')
  - (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
      WHERE user_id = 'a4300000-0000-0000-0000-0000000000a1'
        AND month = DATE '2026-05-01'), 0);

RESET ROLE;

DO $$ BEGIN RAISE NOTICE '045: todas as assercoes passaram'; END $$;

ROLLBACK;
