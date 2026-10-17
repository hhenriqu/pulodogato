-- =============================================================================
-- MEDIDOR DA HMO-258: quantas respostas o app da para "quanto eu gastei em maio?"
-- =============================================================================
-- Reproduz o mes de maio da conta A da HMO-255 num banco do zero e pergunta o
-- MESMO mes a cada leitura, com a consulta que a rota daquela leitura faz.
--
-- Nao assere nada: IMPRIME. O que a issue precisa saber primeiro e quantos
-- numeros diferentes existem hoje, e nenhum deles levanta erro.
--
-- ESTADO MEDIDO EM 17/10/2026, com a cadeia 001->057 e os filtros da HMO-418 no
-- ramo de intervalo da rota: DUAS respostas.
--
--   990,00  fluxo de caixa -- o que saiu da minha conta  (decidido, com rotulo)
--   1010,00 custo pessoal -- bruto + reembolso           (decidido, com rotulo)
--
-- ESTADO ANTERIOR, medido em 16/10/2026 na main d7a4c8a com a cadeia 001->056
-- (HMO-413): TRES respostas. A terceira era
--
--   950,00  "so a minha parte" -- O PAINEL PRINCIPAL     (RECUSADO em 08/10,
--                                                         e sem rotulo na tela)
--
-- O 950 era a convencao que o Helio descartou ao escolher 1.010,00 na
-- interaction da HMO-258, e ela viveu nove dias na tela mais aberta do app. A
-- 046 nao a removeu: ela mudou as VIEWS, e o painel nao le view nenhuma
-- (linha 2b). Quem a removeu foi a HMO-418, nos dois filtros da ROTA.
--
-- POR QUE ESTE MEDIDOR IMPRIMIA 2 E DIZIA QUE ESTAVA TUDO BEM
-- ----------------------------------------------------------
-- A linha do painel media `personal_monthly_cash_flow` debaixo do rotulo
-- "painel + reports/cash-flow + categories". A view responde ao modo MES; o
-- painel pergunta pelo modo INTERVALO (`&cartao=fatura`) e nunca a consulta.
-- Entao o medidor mediu a view, imprimiu 1.010,00 no lugar do painel, e a 046
-- pos no proprio cabecalho "painel ... 950,00 -> 1.010,00" apoiada nisso.
-- O contador de respostas e a conferencia da issue -- e ele estava medindo a
-- correcao, nao a tela.
--
-- Antes da 045/046 eram quatro respostas (990, 950, 900, 1010); depois dela,
-- tres; depois da HMO-418, DUAS. O "respostas_distintas" no fim imprime 2 -- e
-- 2 e o piso: as duas que sobraram sao perguntas diferentes, cada uma com
-- rotulo na tela, e nao uma divergencia a consertar.
--
-- A ULTIMA LINHA E DE OUTRA PERGUNTA (HMO-347, migration 049). As seis de cima
-- perguntam "quanto a A gastou em maio?"; a ultima pergunta "quanto do TETO de
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
-- 2. /api/reports/cash-flow e /api/reports/categories no modo MES (`?months=N`):
--    rollup da 033. Quem pergunta assim e a TELA DE RELATORIOS
--    (app/(dashboard)/dashboard/reports/page.tsx monta `?months=${meses}`).
--    O PAINEL PRINCIPAL NAO -- ver a linha 2b.
relatorios AS (
  SELECT COALESCE(SUM(expense), 0) AS v
    FROM public.personal_monthly_cash_flow
   WHERE user_id = 'a5800000-0000-0000-0000-0000000000a1'
     AND month = DATE '2026-05-01'
),
-- 2b. O PAINEL PRINCIPAL, QUE NAO LE VIEW NENHUMA (HMO-413).
--
-- Esta linha nasceu porque a linha 2 estava rotulada "painel + reports/
-- cash-flow + categories" e media uma view que O PAINEL NUNCA CONSULTA. O
-- painel chama `/api/reports/cash-flow?de=&ate=&cartao=fatura`
-- (app/(dashboard)/dashboard/page.tsx:441), e `cartao=fatura` cai no ramo
-- `periodo.modo === "intervalo" || cartaoPelaFatura` da rota -- que soma as
-- linhas CRUAS no JavaScript, mesmo quando o periodo e um mes inteiro. O
-- parametro nao e opcional naquela tela (o comentario de la diz isso), entao
-- NAO EXISTE caminho em que o painel leia `personal_monthly_cash_flow`.
--
-- Consequencia que custou uma migration: a 046 mudou as VIEWS e declarou, no
-- proprio cabecalho, "painel ... 950,00 -> 1.010,00". O commit dela (b9fb8c4)
-- nao toca um unico arquivo de `app/`, e o painel continuou em 950,00 -- a
-- TERCEIRA convencao, a que o Helio recusou em 08/10 ao escolher 1.010,00. O
-- medidor certificou a correcao porque media a view pelo nome do painel.
--
-- OS DOIS FILTROS ABAIXO SAO OS DA ROTA, E A HMO-418 TROCOU OS DOIS. O que cada
-- um fazia, e o numero que cada combinacao da nesta fixture:
--
--   `financial_transactions` com `group_id IS NULL`  -- o jantar de 90 que a A
--      pagou ficava FORA inteiro (a linha dele tem `group_id` preenchido). SAIU.
--   `group_share_entries` sem filtro de `paguei_eu`  -- voltava a parte da A nos
--      DOIS rateios: 30 (do que ela pagou) + 20 (do que a B pagou). Agora so o
--      segundo, por `NOT paguei_eu`.
--
--   os dois filtros antigos ......   950,00  (a convencao RECUSADA)
--   so o primeiro trocado ........ 1.040,00  (valor cheio + a minha parte dele)
--   so o segundo trocado .........   920,00  (a despesa que eu paguei sai)
--   os dois trocados ............. 1.010,00  <- o criterio aprovado, e o de hoje
--
-- Os quatro numeros sao distintos de proposito: este medidor nao assere nada, e
-- um deles no lugar do outro e a unica coisa que denuncia meia correcao. Quem
-- assere e scripts/test-criterio-do-painel.mjs, chamando a rota.
painel AS (
  SELECT COALESCE((
           SELECT SUM(ABS(amount))
             FROM public.financial_transactions
            WHERE user_id = 'a5800000-0000-0000-0000-0000000000a1'
              AND transaction_type = 'expense'
              AND transaction_date BETWEEN DATE '2026-05-01' AND DATE '2026-05-31'
         ), 0)
       + COALESCE((
           SELECT SUM(ABS(amount))
             FROM public.group_share_entries
            WHERE user_id = 'a5800000-0000-0000-0000-0000000000a1'
              AND NOT paguei_eu
              AND transaction_type = 'expense'
              AND transaction_date BETWEEN DATE '2026-05-01' AND DATE '2026-05-31'
         ), 0) AS v
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
  UNION ALL SELECT 2, 'tela de Relatorios (?months=N)',
         -- O ROTULO DIZ A FONTE, NAO O NUMERO, de proposito: as linhas 2 e 3
         -- sao as duas que as migrations 045/046 mudam, e um rotulo escrito
         -- como "MINHA PARTE: 30 + 20" virou mentira no dia do merge sem
         -- ninguem reparar -- o medidor continuaria imprimindo bonito.
         --
         -- E O ROTULO TEM DE DIZER *QUEM PERGUNTA*, nao so a view (HMO-413).
         -- Este dizia "painel + reports/cash-flow + categories" e media a view
         -- do modo MES; o painel pergunta pelo modo INTERVALO e nunca viu este
         -- numero. A guarda escrita acima cobria o rotulo-que-cita-o-NUMERO e
         -- nao cobriu o rotulo-que-cita-a-TELA, que e o que apodreceu.
         (SELECT v FROM relatorios), 'le personal_monthly_cash_flow (033: minha parte; 046: bruto + reembolso)'
  UNION ALL SELECT 3, 'PAINEL principal (?de=&ate=&cartao=fatura)',
         (SELECT v FROM painel),
         'soma as linhas cruas na rota: tudo o que EU lancei + a parte do que OUTRO pagou (418) -- NAO le view'
  UNION ALL SELECT 4, 'reports/planned-vs-actual (actual_expense)',
         (SELECT v FROM pva), 'le monthly_cash_flow c/ group_id IS NULL (008); personal_ apos a 045/046'
  UNION ALL SELECT 5, 'reports/net-worth (|net_change|)',
         (SELECT v FROM patrimonio), 'grupo integral'
  UNION ALL SELECT 6, '/dashboard/personal-finance (HMO-275)',
         (SELECT v FROM custo), 'bruto + reembolso -- o criterio APROVADO'
  UNION ALL SELECT 7, 'budget_consumption (teto de 700 no mercado)',
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
    -- O PAINEL PRINCIPAL ENTRA AQUI (HMO-413). Sem ele este contador imprimia
    -- 2 -- "duas pontas decididas, as duas com rotulo" -- enquanto a tela mais
    -- aberta do app mostrava um TERCEIRO numero sem rotulo nenhum. Era o
    -- contador que dizia que a 046 tinha terminado o servico.
    --
    -- COM OS FILTROS DA HMO-418 ele e 1.010,00 e o contador caiu para 2. ESTA
    -- COPIA TEM DE ACOMPANHAR A CTE `painel` ACIMA: sao os mesmos dois filtros
    -- escritos duas vezes (a CTE imprime a linha, esta soma o distinct), e uma
    -- delas parada no criterio antigo faria o contador acusar divergencia que
    -- nao existe -- ou, pior, esconder uma que existe.
    SELECT COALESCE((
             SELECT SUM(ABS(amount)) FROM public.financial_transactions
              WHERE user_id = 'a5800000-0000-0000-0000-0000000000a1'
                AND transaction_type = 'expense'
                AND transaction_date BETWEEN DATE '2026-05-01' AND DATE '2026-05-31'
           ), 0)
         + COALESCE((
             SELECT SUM(ABS(amount)) FROM public.group_share_entries
              WHERE user_id = 'a5800000-0000-0000-0000-0000000000a1'
                AND NOT paguei_eu
                AND transaction_type = 'expense'
                AND transaction_date BETWEEN DATE '2026-05-01' AND DATE '2026-05-31'
           ), 0)
    UNION ALL
    SELECT COALESCE(SUM(actual_expense), 0) FROM public.planned_vs_actual
     WHERE user_id = 'a5800000-0000-0000-0000-0000000000a1'
       AND group_id IS NULL AND month = DATE '2026-05-01'
    UNION ALL
    SELECT COALESCE(SUM(ABS(net_change)), 0) FROM public.net_worth_history
     WHERE user_id = 'a5800000-0000-0000-0000-0000000000a1' AND month = DATE '2026-05-01'
  ) t;
COMMIT;
