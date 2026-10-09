-- =============================================================================
-- MEDIDOR DA HMO-258: quantas respostas o app da para "quanto eu gastei em maio?"
-- =============================================================================
-- Reproduz o mes de maio da conta A da HMO-255 num banco do zero e pergunta o
-- MESMO mes a cada leitura, com a consulta que a rota daquela leitura faz.
--
-- Nao assere nada: IMPRIME. O que a issue precisa saber primeiro e quantos
-- numeros diferentes existem hoje, e nenhum deles levanta erro.
--
-- ESTADO AO ENTRAR NA MAIN (045 e 046 mergeadas): as cinco leituras dao DUAS
-- respostas -- 990,00 (fluxo de caixa: o que saiu da minha conta) e 1.010,00
-- (custo pessoal: bruto + reembolso). Antes da 045/046 eram quatro: 990, 950,
-- 900 e 1010. O "respostas_distintas" no fim imprime 2 em vez de 4, e e esse
-- numero que diz se a issue continua fechada.
--
-- A SEXTA LINHA E DE OUTRA PERGUNTA (HMO-347, migration 049). As cinco de cima
-- perguntam "quanto a A gastou em maio?"; a sexta pergunta "quanto do TETO de
-- mercado ela consumiu?", que recorta UMA categoria. Ela entra aqui porque o
-- criterio e o mesmo e o defeito era o mesmo da `planned_vs_actual`: despesa de
-- grupo ignorada por inteiro.
--
--   antes da 049 .....  500,00  e 'ok'     (os 90 que ela pagou e os 20 que
--                                           ela deve nao contavam)
--   depois da 049 ....  610,00  e 'alert'
--
-- Ela NAO entra no `respostas_distintas` -- ver o comentario na CTE
-- `orcamento`.
--
-- Os ROTULOS de cada linha dizem a FONTE, nao o numero: a proxima migration que
-- mexer nessas views muda os valores, e um rotulo escrito como "950" viraria
-- mentira no dia do merge com o medidor continuando a imprimir bonito.
--
-- Rodar:  psql -d <banco com as 46 migrations> -f scripts/medidor-hmo258.sql

\set QUIET on
\pset border 2
SET client_min_messages = WARNING;

-- -----------------------------------------------------------------------------
-- Fixture: maio/2026 da conta A -- tres membros no grupo, duas despesas de grupo
-- -----------------------------------------------------------------------------
-- Os valores sao os da issue, e sao escolhidos para que cada convencao de um
-- numero DISTINGUIVEL: 990, 950, 900 e 1010 nao se confundem entre si. Isso
-- continua valendo depois da 045/046 -- e justamente por isso que da para ver
-- que as linhas 2 e 3 sairam do 950/900 e foram para o 1010.
--
--   mercado      500,00  so da A
--   combustivel  400,00  so da A
--   jantar        90,00  pago pela A, grupo de 3  -> a parte dela e 30,00
--   mercado grupo 60,00  pago pela B, grupo de 3  -> a parte dela e 20,00

INSERT INTO auth.users (id, email) VALUES
  ('a5800000-0000-0000-0000-0000000000a1', 'a-258@teste.local'),
  ('a5800000-0000-0000-0000-0000000000b1', 'b-258@teste.local'),
  ('a5800000-0000-0000-0000-0000000000c1', 'c-258@teste.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('a5800000-0000-0000-0000-0000000000a1', 'A 258', FALSE),
  ('a5800000-0000-0000-0000-0000000000b1', 'B 258', FALSE),
  ('a5800000-0000-0000-0000-0000000000c1', 'C 258', FALSE);

INSERT INTO public.expense_groups (id, name, created_by) VALUES
  ('95800000-0000-0000-0000-000000000001', 'Casa 258',
   'a5800000-0000-0000-0000-0000000000a1');

-- A entra como admin pelo trigger add_group_creator; B e C entram aqui.
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('95800000-0000-0000-0000-000000000001',
   'a5800000-0000-0000-0000-0000000000b1', 'member', 'active'),
  ('95800000-0000-0000-0000-000000000001',
   'a5800000-0000-0000-0000-0000000000c1', 'member', 'active');

INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance) VALUES
  ('f5800000-0000-0000-0000-0000000000a1', 'a5800000-0000-0000-0000-0000000000a1',
   'Conta A', 'checking', 10000),
  ('f5800000-0000-0000-0000-0000000000b1', 'a5800000-0000-0000-0000-0000000000b1',
   'Conta B', 'checking', 10000);

-- As quatro despesas. `amount` NEGATIVO, como o app grava
-- (pulodogato-amount-sign-convention). O trigger do 001/042 cria as tres partes
-- de cada despesa de grupo sozinho -- nada aqui escreve rateio.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type)
VALUES
  ('75800000-0000-0000-0000-000000000001',
   'a5800000-0000-0000-0000-0000000000a1', 'f5800000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   NULL, 'Mercado', -500.00, DATE '2026-05-05', 'expense'),
  ('75800000-0000-0000-0000-000000000002',
   'a5800000-0000-0000-0000-0000000000a1', 'f5800000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', '49d97f81-6f07-4e6d-9822-75167b8426b2',
   NULL, 'Combustivel', -400.00, DATE '2026-05-08', 'expense'),
  ('75800000-0000-0000-0000-000000000003',
   'a5800000-0000-0000-0000-0000000000a1', 'f5800000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   '95800000-0000-0000-0000-000000000001', 'Jantar do grupo',
   -90.00, DATE '2026-05-12', 'expense'),
  ('75800000-0000-0000-0000-000000000004',
   'a5800000-0000-0000-0000-0000000000b1', 'f5800000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   '95800000-0000-0000-0000-000000000001', 'Mercado do grupo',
   -60.00, DATE '2026-05-20', 'expense');

-- A SEXTA LEITURA (HMO-347) precisa de um TETO para ter o que consumir, e as
-- outras cinco nao precisavam de nada alem das despesas.
--
-- 700,00 na categoria do mercado, em maio. O numero nao e arbitrario: ele e o
-- unico da fixture que faz o STATUS mudar junto com o valor. Pelo criterio
-- ANTERIOR a 049 o consumo e 500,00 (71% -> 'ok'); pelo dela, 610,00 (87% ->
-- 'alert',
-- porque o limiar padrao e 0,800). Com um teto folgado as duas migrations
-- imprimiriam 'ok' e o medidor mostraria so um numero mudando de lugar.
INSERT INTO public.budgets (id, user_id, category_id, month, amount_limit) VALUES
  ('b5800000-0000-0000-0000-000000000001',
   'a5800000-0000-0000-0000-0000000000a1',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', DATE '2026-05-01', 700.00);

\set QUIET off
\echo ''
\echo '--- A fixture nasceu com rateio? (se nao, todo zero abaixo e "o trigger nao rodou") ---'
SELECT t.description,
       t.amount                               AS valor_cheio,
       count(es.id)                           AS partes,
       max(es.amount) FILTER (WHERE em.user_id = 'a5800000-0000-0000-0000-0000000000a1')
                                              AS parte_da_A
  FROM public.financial_transactions t
  JOIN public.group_transactions gt    ON gt.transaction_id = t.id
  JOIN public.group_expense_splits es  ON es.group_transaction_id = gt.id
  JOIN public.group_members em         ON em.id = es.member_id
 WHERE t.group_id IS NOT NULL
 GROUP BY t.description, t.amount
 ORDER BY t.description;

\echo ''
\echo '=== "QUANTO A GASTOU EM MAIO/2026?" -- uma linha por leitura do app ==='

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a5800000-0000-0000-0000-0000000000a1';

WITH
-- 1. /api/movimentacoes/resumo (tela /dashboard/despesas). Os filtros sao os da
--    consulta 2 da rota: user_id, service_id de personal_finance, o periodo. Sem
--    group_share_entries -- o cabecalho da rota diz que isso e de proposito.
resumo AS (
  SELECT COALESCE(SUM(ABS(amount)), 0) AS v
    FROM public.financial_transactions
   WHERE user_id = 'a5800000-0000-0000-0000-0000000000a1'
     AND service_id = '8730cd96-d656-4c48-863e-673e1016a832'
     AND transaction_type = 'expense'
     AND transaction_date BETWEEN DATE '2026-05-01' AND DATE '2026-05-31'
),
-- 2. /api/reports/cash-flow e /api/reports/categories no modo MES: rollup da 033.
painel AS (
  SELECT COALESCE(SUM(expense), 0) AS v
    FROM public.personal_monthly_cash_flow
   WHERE user_id = 'a5800000-0000-0000-0000-0000000000a1'
     AND month = DATE '2026-05-01'
),
-- 3. /api/reports/planned-vs-actual. A rota filtra `group_id IS NULL` quando o
--    relatorio e pessoal (route.ts:56).
pva AS (
  SELECT COALESCE(SUM(actual_expense), 0) AS v
    FROM public.planned_vs_actual
   WHERE user_id = 'a5800000-0000-0000-0000-0000000000a1'
     AND group_id IS NULL
     AND month = DATE '2026-05-01'
),
-- 4. /api/reports/net-worth. net_change e entrada menos saida: negativo num mes
--    sem receita. Comparavel em modulo com as outras linhas.
patrimonio AS (
  SELECT COALESCE(SUM(ABS(net_change)), 0) AS v
    FROM public.net_worth_history
   WHERE user_id = 'a5800000-0000-0000-0000-0000000000a1'
     AND month = DATE '2026-05-01'
),
-- 5. /dashboard/personal-finance, cartao "Despesas" (HMO-275, o criterio
--    APROVADO): bruto + reembolso -- inteiro quando eu paguei, minha parte
--    quando outro pagou. E `resumoComPartesDeGrupo` quem soma, no JavaScript.
custo AS (
  SELECT (SELECT v FROM resumo)
       + COALESCE((SELECT SUM(amount) FROM public.group_share_entries
                    WHERE user_id = 'a5800000-0000-0000-0000-0000000000a1'
                      AND month = DATE '2026-05-01'
                      AND NOT paguei_eu), 0) AS v
),
-- 6. /dashboard/budget e a barra da tela do grupo (HMO-347). Esta linha nao e
--    "quanto eu gastei no mes": e quanto de UM TETO foi consumido, e por isso o
--    valor dela e sempre menor que os outros cinco (o teto e de UMA categoria,
--    a do mercado -- 500 + 90 + 20 = 610, sem o combustivel de 400).
--
--    ELA FICA FORA DO `respostas_distintas` NO FIM, de proposito: aquele
--    contador responde "quantos numeros diferentes o app da para a MESMA
--    pergunta", e esta e outra pergunta. Somada la, ela inflaria o contador
--    para 3 e o medidor passaria a acusar divergencia onde nao ha nenhuma.
orcamento AS (
  SELECT spent AS v, consumption_status AS status
    FROM public.budget_consumption
   WHERE id = 'b5800000-0000-0000-0000-000000000001'
)
SELECT * FROM (
  SELECT 1 AS n, '/dashboard/despesas (movimentacoes/resumo)' AS tela,
         (SELECT v FROM resumo) AS valor, 'grupo INTEGRAL (90), ignora o da B' AS convencao
  UNION ALL SELECT 2, 'painel + reports/cash-flow + categories',
         -- O ROTULO DIZ A FONTE, NAO O NUMERO, de proposito: as linhas 2 e 3
         -- sao as duas que as migrations 045/046 mudam, e um rotulo escrito
         -- como "MINHA PARTE: 30 + 20" virou mentira no dia do merge sem
         -- ninguem reparar -- o medidor continuaria imprimindo bonito.
         (SELECT v FROM painel), 'le personal_monthly_cash_flow (033: minha parte; 046: bruto + reembolso)'
  UNION ALL SELECT 3, 'reports/planned-vs-actual (actual_expense)',
         (SELECT v FROM pva), 'le monthly_cash_flow c/ group_id IS NULL (008); personal_ apos a 045/046'
  UNION ALL SELECT 4, 'reports/net-worth (|net_change|)',
         (SELECT v FROM patrimonio), 'grupo integral'
  UNION ALL SELECT 5, '/dashboard/personal-finance (HMO-275)',
         (SELECT v FROM custo), 'bruto + reembolso -- o criterio APROVADO'
  UNION ALL SELECT 6, 'budget_consumption (teto de 700 no mercado)',
         (SELECT v FROM orcamento),
         'le budget_consumption; so a categoria do teto. status: '
           || (SELECT status FROM orcamento)
) x ORDER BY n;
COMMIT;

\echo ''
\echo '--- quantas respostas diferentes? ---'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a5800000-0000-0000-0000-0000000000a1';
SELECT count(DISTINCT v) AS respostas_distintas
  FROM (
    SELECT COALESCE(SUM(ABS(amount)), 0) AS v FROM public.financial_transactions
     WHERE user_id = 'a5800000-0000-0000-0000-0000000000a1'
       AND service_id = '8730cd96-d656-4c48-863e-673e1016a832'
       AND transaction_type = 'expense'
       AND transaction_date BETWEEN DATE '2026-05-01' AND DATE '2026-05-31'
    UNION ALL
    SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
     WHERE user_id = 'a5800000-0000-0000-0000-0000000000a1' AND month = DATE '2026-05-01'
    UNION ALL
    SELECT COALESCE(SUM(actual_expense), 0) FROM public.planned_vs_actual
     WHERE user_id = 'a5800000-0000-0000-0000-0000000000a1'
       AND group_id IS NULL AND month = DATE '2026-05-01'
    UNION ALL
    SELECT COALESCE(SUM(ABS(net_change)), 0) FROM public.net_worth_history
     WHERE user_id = 'a5800000-0000-0000-0000-0000000000a1' AND month = DATE '2026-05-01'
  ) t;
COMMIT;
