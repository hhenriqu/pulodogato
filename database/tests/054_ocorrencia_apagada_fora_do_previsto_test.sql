-- =====================================================
-- HMO-402 -- a ocorrencia apagada sai do Previsto x Realizado (054)
-- =====================================================
-- Roda no db-verify, contra o banco que as migrations constroem do zero, na
-- posicao DELE na cadeia: depois da 054.
--
-- O QUE A 054 ENTREGA
-- -------------------
-- O previsto de `planned_vs_actual` somava com `s.status <> 'cancelled'`, e
-- `skipped` passava. Apagar a ocorrencia de um mes de uma conta FIXA grava
-- exatamente `status = 'skipped'` (a linha fica na tabela de proposito, para
-- nao ressuscitar na agenda), entao a conta que o usuario apagou continuava
-- somada no previsto daquele mes -- so neste relatorio, porque toda outra
-- leitura do previsto filtra `status = 'pending'` e exclui `skipped` de graca.
--
-- POR QUE "O NUMERO BAIXOU" NAO PROVA ESTA MIGRATION
-- --------------------------------------------------
-- O conserto e tirar linhas de uma soma, e o jeito mais facil de errar e tirar
-- DEMAIS. Um filtro que excluisse tudo, ou que excluisse `paid`, ou que
-- excluisse a linha inteira em vez de so a apagada, daria numeros menores e
-- igualmente plausiveis. Por isso as secoes 1 e 2 vem em par com a secao 3:
--
--   SECAO 1  O LADO DA RECEITA. A ocorrencia `skipped` de uma receita fixa sai
--            de `planned_income`. O caso da issue.
--
--   SECAO 2  O LADO DA DESPESA, que a issue marcou como "li no SQL e nao medi".
--            Os dois `SUM(...) FILTER` estao sob o MESMO `WHERE`, entao o
--            defeito e simetrico -- e aqui ele e pior, porque `expense_variance`
--            fica NEGATIVA e a tela le isso como "gastou menos do que previu".
--            A assercao e sobre a variancia, e nao so sobre o total, porque e a
--            variancia que o relatorio mostra.
--
--   SECAO 3  O CONTROLE POSITIVO, e e ele que torna as duas primeiras uma
--            medida. `pending` e `paid` CONTINUAM contando. Sem esta secao, uma
--            view que devolvesse zero para tudo passaria as secoes 1 e 2 com
--            louvor -- e e exatamente o defeito que um `NOT IN` escrito errado
--            produz.
--
--   SECAO 4  `cancelled` continua fora. Era a unica exclusao antes da 054, e
--            recolar a definicao inteira (`CREATE OR REPLACE VIEW` exige)
--            poderia ter perdido ela. Nada mais no arquivo pegaria isso.
--
--   SECAO 5  A CATRACA DO ENUM, e e o conserto da causa-raiz. O filtro e uma
--            lista por EXCLUSAO, e foi assim que o `skipped` entrou nesta soma
--            sozinho: ele nasceu no enum depois do 008 e ninguem revisitou o
--            `<> 'cancelled'`. Esta secao enumera `scheduled_status` e exige
--            que todo valor esteja classificado de proposito. Um
--            `ALTER TYPE ... ADD VALUE` futuro reprova o db-verify com o NOME
--            do estado novo, em vez de entrar no previsto de graca.
--
--   SECAO 6  O CONTROLE NEGATIVO, no desenho do caso 3 do
--            `043_direcao_do_previsto_avulso_test.sql`: reproduz o filtro
--            ANTIGO sobre a fixture nova e EXIGE o numero errado. Ele falha no
--            dia em que a fixture deixar de conter o caso -- e nesse dia as
--            secoes 1 e 2 param de medir sem avisar. Reintroduzir o filtro
--            antigo na view tem de deixar este arquivo vermelho, e e esta
--            secao mais a 1 e a 2 que garantem isso pelos dois lados.
--
--   SECAO 7  A linha da view nao se contradiz: `pending_count = 0` com
--            `planned_income > 0` era o sintoma visivel do defeito dentro da
--            MESMA linha (os contadores sempre filtraram `pending`). A
--            assercao e relacional e nao depende de valor cravado.
--
--   SECAO 8  CONTROLE NEGATIVO DA RLS. `CREATE OR REPLACE VIEW` APAGA as
--            reloptions e `security_invoker` e uma reloption: a 054 troca a
--            definicao, entao sem o `ALTER VIEW` reaplicado a view volta a
--            rodar como o DONO. Sem esta secao, todo o resto do arquivo estaria
--            medindo superusuario e passaria verde com a RLS furada.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 054:
--   psql "$DB_URL" -f database/tests/054_ocorrencia_apagada_fora_do_previsto_test.sql
--
-- Qualquer FALHA lanca excecao e aborta.
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect_num(label TEXT, got NUMERIC, want NUMERIC)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % = %', label, got;
END $$;

-- A negacao. `expect_num` fica vermelho quando o numero muda, mas nao diz QUAL
-- numero errado apareceu -- e os numeros errados desta issue foram medidos um
-- por um, em producao e nesta cadeia.
CREATE OR REPLACE FUNCTION pg_temp.refute_num(label TEXT, got NUMERIC, forbidden NUMERIC, porque TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS NOT DISTINCT FROM forbidden THEN
    RAISE EXCEPTION 'FALHA: % -> obtido %, que e exatamente %', label, forbidden, porque;
  END IF;
  RAISE NOTICE 'ok: % (nao e %)', label, forbidden;
END $$;

-- ---------------------------------------------------------------------------
-- A FIXTURE
-- ---------------------------------------------------------------------------
-- Outubro/2026, um usuario, e as linhas escolhidas para que cada total seja
-- ATRIBUIVEL -- nenhum subconjunto soma o mesmo que outro, entao um numero
-- errado nao se faz passar por certo:
--
--   RECEITAS                                       valor   status apos apagar
--     Salario fixo (ocorrencia de REGRA)         5.000,00   skipped   <- o caso
--     Bonus fixo   (ocorrencia de REGRA)           700,00   pending   <- controle +
--     Premio fixo  (ocorrencia de REGRA)           900,00   cancelled <- secao 4
--
--   DESPESAS
--     Aluguel fixo (ocorrencia de REGRA)         1.700,00   skipped   <- o caso
--     Internet     (ocorrencia de REGRA)           130,00   pending   <- controle +
--     Luz          (ocorrencia de REGRA)            11,00   paid      <- controle +
--
-- Depois da 054 o previsto do mes tem de ser:
--   planned_income  =   700,00  (so o bonus pending)
--   planned_expense =   141,00  (130 internet + 11 luz paga)
--
-- Antes da 054 era:
--   planned_income  = 5.700,00  (o salario apagado voltando)
--   planned_expense = 1.841,00  (o aluguel apagado voltando)
--
-- Os quatro numeros sao distintos e nenhum e redondo por acidente. A luz de
-- 11,00 esta `paid` de proposito: `paid` TEM de continuar no previsto (a conta
-- foi prevista e aconteceu), e um `NOT IN` escrito como `IN ('pending')`
-- derrubaria ela -- 130,00 em vez de 141,00, que a secao 3 nega pelo nome.
--
-- O REALIZADO do mes e 11,00, e so: a unica transacao e a que a luz PAGA exige
-- (o CHECK `scheduled_transactions_paid_check` nao deixa `status = 'paid'` sem
-- `transaction_id`). Entao `expense_variance = 11 - 141 = -130,00`, e antes da
-- 054 era `11 - 1841 = -1.830,00`.
--
-- Realizado pequeno e de proposito: `expense_variance = actual - planned`,
-- entao a variancia fica dominada pelo previsto e o defeito da secao 2 aparece
-- no SINAL -- sem eu montar um cenario de realizado que esta fora desta issue.

INSERT INTO auth.users (id, email) VALUES
  ('40200000-0000-0000-0000-000000000001', 'hmo402@example.com'),
  -- A Dora nao tem relacao nenhuma com a conta acima: e o controle negativo da
  -- RLS na secao 8, e ela tem lancamento PROPRIO porque numa conta vazia ela
  -- veria zero de qualquer jeito e o controle seria vacuo.
  ('40200000-0000-0000-0000-0000000000d1', 'dora402@example.com');

INSERT INTO public.profiles (id, email, full_name, is_public) VALUES
  ('40200000-0000-0000-0000-000000000001', 'hmo402@example.com', 'HMO 402', FALSE),
  ('40200000-0000-0000-0000-0000000000d1', 'dora402@example.com', 'Dora 402', FALSE);

-- A categoria vem das SEMEADAS pela cadeia: `transaction_categories.service_id`
-- e NOT NULL e nao e desta issue. Criar categoria aqui acoplaria o teste ao
-- cadastro de servicos -- mesma escolha do teste da 043.
-- `service_id` vem junto porque `financial_transactions.service_id` e NOT NULL
-- e a luz PAGA abaixo precisa de uma transacao de verdade.
CREATE TEMP TABLE cat AS
  SELECT id, service_id FROM public.transaction_categories WHERE is_expense LIMIT 1;

-- As REGRAS. Todas as seis ocorrencias sao de regra, porque e a ocorrencia DE
-- FIXA que o DELETE marca como `skipped` -- previsao avulsa o DELETE apaga de
-- verdade, e linha apagada sai de qualquer soma sem precisar de migration.
-- (Essa e a razao de a avulsa ser o controle negativo da medicao em producao, e
-- a razao de ela NAO servir de fixture aqui.)
INSERT INTO public.recurring_rules
  (id, user_id, category_id, description, amount, transaction_type, frequency,
   interval_count, start_date, reminder_days, auto_post, is_active)
SELECT v.id, '40200000-0000-0000-0000-000000000001', cat.id, v.descricao, v.valor,
       v.tipo, 'monthly', 1, '2026-10-01', 3, false, true
FROM cat, (VALUES
  ('40200000-0000-0000-0000-000000000a1a'::uuid, 'Salario', 5000::numeric, 'income'::public.transaction_financial_type),
  ('40200000-0000-0000-0000-000000000a2a'::uuid, 'Bonus',    700::numeric, 'income'),
  ('40200000-0000-0000-0000-000000000a3a'::uuid, 'Premio',   900::numeric, 'income'),
  ('40200000-0000-0000-0000-000000000a4a'::uuid, 'Aluguel', 1700::numeric, 'expense'),
  ('40200000-0000-0000-0000-000000000a5a'::uuid, 'Internet', 130::numeric, 'expense'),
  ('40200000-0000-0000-0000-000000000a6a'::uuid, 'Luz',       11::numeric, 'expense')
) AS v(id, descricao, valor, tipo);

-- As ocorrencias de outubro. `transaction_type` NULO nas seis de proposito: a
-- direcao vem da REGRA pelo degrau do `s.direction` (027/043), que e a forma
-- que a base instalada tem. Se eu cravasse o tipo na ocorrencia, o teste
-- deixaria de exercitar aquele degrau.
--
-- `status` entra ja no estado final, e nao via UPDATE: o que esta sendo medido e
-- a LEITURA de cada estado, nao a transicao. A rota que escreve `skipped` tem
-- teste proprio.
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, recurring_rule_id, description, amount, due_date,
   status, transaction_type)
SELECT v.id, '40200000-0000-0000-0000-000000000001', cat.id, v.regra, v.descricao,
       v.valor, DATE '2026-10-17', v.st, NULL
FROM cat, (VALUES
  -- O CASO DA ISSUE, nos dois lados.
  ('40200000-0000-0000-0000-000000000b1b'::uuid, '40200000-0000-0000-0000-000000000a1a'::uuid, 'Salario out', 5000::numeric, 'skipped'::public.scheduled_status),
  ('40200000-0000-0000-0000-000000000b4b'::uuid, '40200000-0000-0000-0000-000000000a4a'::uuid, 'Aluguel out', 1700::numeric, 'skipped'),
  -- O CONTROLE POSITIVO: estes TEM de continuar no previsto.
  ('40200000-0000-0000-0000-000000000b2b'::uuid, '40200000-0000-0000-0000-000000000a2a'::uuid, 'Bonus out',    700::numeric, 'pending'),
  ('40200000-0000-0000-0000-000000000b5b'::uuid, '40200000-0000-0000-0000-000000000a5a'::uuid, 'Internet out', 130::numeric, 'pending'),
  -- `cancelled`, que ja saia antes da 054 (secao 4).
  ('40200000-0000-0000-0000-000000000b3b'::uuid, '40200000-0000-0000-0000-000000000a3a'::uuid, 'Premio out',   900::numeric, 'cancelled')
) AS v(id, regra, descricao, valor, st);

-- A luz PAGA entra separada: o CHECK `scheduled_transactions_paid_check` exige
-- `paid_date` e `transaction_id` NAO NULOS quando `status = 'paid'`, entao ela
-- precisa de uma transacao de verdade. Vale a pena justamente por isso -- e o
-- unico estado do enum que carrega linha realizada, e e o que um filtro escrito
-- como `IN ('pending')` derrubaria.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, description, amount, transaction_date,
   transaction_type)
SELECT '40200000-0000-0000-0000-000000000c6c', '40200000-0000-0000-0000-000000000001',
       cat.service_id, cat.id, 'Luz out paga', -11.00, DATE '2026-10-17', 'expense'
FROM cat;

INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, recurring_rule_id, description, amount, due_date,
   status, transaction_type, paid_date, transaction_id)
SELECT '40200000-0000-0000-0000-000000000b6b', '40200000-0000-0000-0000-000000000001',
       cat.id, '40200000-0000-0000-0000-000000000a6a', 'Luz out', 11.00,
       DATE '2026-10-17', 'paid', NULL, DATE '2026-10-17',
       '40200000-0000-0000-0000-000000000c6c'
FROM cat;

-- A Dora, para a secao 8.
INSERT INTO public.scheduled_transactions
  (user_id, category_id, description, amount, due_date, status, transaction_type)
SELECT '40200000-0000-0000-0000-0000000000d1', cat.id, 'Faculdade da Dora',
       77.00, DATE '2026-10-20', 'pending', 'expense'
FROM cat;

-- ---------------------------------------------------------------------------
-- A FIXTURE DA SECAO 9: um grupo, e uma despesa de NOVEMBRO paga pelo OUTRO
-- ---------------------------------------------------------------------------
-- Isto nao mede a 054. Mede as duas afirmacoes da 045 que a 054 RECOLA e que
-- nenhum outro step protege nesta posicao da cadeia -- a suite da 045 nao pode
-- ser re-rodada aqui (ela exige 950,00, que a 046 trocou por 1.010,00; ver o
-- comentario do step no db-verify).
--
-- NOVEMBRO de proposito, e nao outubro: em novembro este usuario nao tem NADA
-- -- nenhuma `scheduled_transactions`, nenhuma `financial_transactions` dele.
-- A unica coisa que pode produzir a chave de novembro e a TERCEIRA ORIGEM do
-- `UNION` (`group_share_entries`), que foi o que a 045 acrescentou. Sem ela o
-- mes nao vem como zero: vem AUSENTE -- e um mes ausente le-se na tela como
-- "nao houve movimento", que e o pior sintoma possivel, silencioso e plausivel.
--
-- Quem PAGA e o Bruno, nao eu. Se eu pagasse, a minha propria
-- `financial_transactions` ja geraria a chave pela segunda origem do UNION e a
-- secao seria vacua -- passaria verde com a terceira origem apagada.
INSERT INTO auth.users (id, email) VALUES
  ('40200000-0000-0000-0000-0000000000b0', 'bruno402@example.com');
INSERT INTO public.profiles (id, email, full_name, is_public) VALUES
  ('40200000-0000-0000-0000-0000000000b0', 'bruno402@example.com', 'Bruno 402', FALSE);

-- Eu entro como admin pelo trigger `add_group_creator`; o Bruno entra na mao.
INSERT INTO public.expense_groups (id, name, created_by) VALUES
  ('40200000-0000-0000-0000-00000000e001'::uuid, 'Casa 402',
   '40200000-0000-0000-0000-000000000001');
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('40200000-0000-0000-0000-00000000e001', '40200000-0000-0000-0000-0000000000b0',
   'member', 'active');

INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance)
VALUES ('40200000-0000-0000-0000-00000000ac01'::uuid,
        '40200000-0000-0000-0000-0000000000b0', 'Conta Bruno', 'checking', 10000);

-- `amount` NEGATIVO, como o app grava. O trigger do 001/042 cria a linha de
-- `group_transactions` e as duas partes sozinho -- nada aqui escreve rateio.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type)
SELECT '40200000-0000-0000-0000-00000000fb01', '40200000-0000-0000-0000-0000000000b0',
       '40200000-0000-0000-0000-00000000ac01', cat.service_id, cat.id,
       '40200000-0000-0000-0000-00000000e001', 'Mercado de novembro do Bruno',
       -80.00, DATE '2026-11-10', 'expense'
FROM cat;

-- As assercoes rodam como `authenticated`, e nao como o dono: ver a secao 8.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '40200000-0000-0000-0000-000000000001';

-- =====================================================
-- SECAO 1: o lado da RECEITA -- o caso da issue
-- =====================================================
-- A ocorrencia `skipped` do salario (5.000) sai do previsto. Sobra o bonus
-- `pending` (700).

SELECT pg_temp.expect_num(
  'planned_income de out/2026 e 700,00 (so o bonus em aberto)',
  (SELECT COALESCE(SUM(planned_income), 0) FROM public.planned_vs_actual
    WHERE user_id = '40200000-0000-0000-0000-000000000001'
      AND group_id IS NULL AND month = DATE '2026-10-01'), 700.00);

-- O DEFEITO DA ISSUE, negado pelo numero. 5.700 = 700 + os 5.000 do salario que
-- o usuario apagou. Era o valor que a view devolvia antes da 054.
SELECT pg_temp.refute_num(
  'planned_income NAO e 5.700,00',
  (SELECT COALESCE(SUM(planned_income), 0) FROM public.planned_vs_actual
    WHERE user_id = '40200000-0000-0000-0000-000000000001'
      AND group_id IS NULL AND month = DATE '2026-10-01'),
  5700.00, 'o salario apagado (skipped) de volta no previsto -- o defeito da HMO-402');

-- E negado pelo OUTRO lado: 6.600 = 5.700 + os 900 do premio cancelado. Esse
-- numero aparece se alguem "consertar" o filtro tirando-o inteiro.
SELECT pg_temp.refute_num(
  'planned_income NAO e 6.600,00',
  (SELECT COALESCE(SUM(planned_income), 0) FROM public.planned_vs_actual
    WHERE user_id = '40200000-0000-0000-0000-000000000001'
      AND group_id IS NULL AND month = DATE '2026-10-01'),
  6600.00, 'o filtro de status removido por inteiro (skipped E cancelled contando)');

-- =====================================================
-- SECAO 2: o lado da DESPESA -- medido, nao lido
-- =====================================================
-- A HMO-402 registrou este lado como "li no SQL e nao medi". Os dois
-- `SUM(...) FILTER` estao sob o MESMO `WHERE`, entao o defeito e simetrico.
--
-- Aqui ele e PIOR do que um total alto. O relatorio e de VARIANCIA, e com o
-- realizado em zero a variancia e o previsto negado: antes da 054 ela era
-- -1.841,00, que a tela le como "gastou 1.841 menos do que previu" -- um elogio
-- por uma economia que nao houve, vinda de uma linha que o usuario apagou.

SELECT pg_temp.expect_num(
  'planned_expense de out/2026 e 141,00 (130 internet + 11 luz paga)',
  (SELECT COALESCE(SUM(planned_expense), 0) FROM public.planned_vs_actual
    WHERE user_id = '40200000-0000-0000-0000-000000000001'
      AND group_id IS NULL AND month = DATE '2026-10-01'), 141.00);

SELECT pg_temp.refute_num(
  'planned_expense NAO e 1.841,00',
  (SELECT COALESCE(SUM(planned_expense), 0) FROM public.planned_vs_actual
    WHERE user_id = '40200000-0000-0000-0000-000000000001'
      AND group_id IS NULL AND month = DATE '2026-10-01'),
  1841.00, 'o aluguel apagado (skipped) de volta no previsto -- o lado da despesa');

-- A VARIANCIA, que e o que o relatorio MOSTRA. O total certo com a variancia
-- errada seria incoerente, mas a assercao sobre a variancia e a que fala a
-- lingua da tela.
SELECT pg_temp.expect_num(
  'expense_variance de out/2026 e -130,00 (realizado 11 - previsto 141)',
  (SELECT COALESCE(SUM(expense_variance), 0) FROM public.planned_vs_actual
    WHERE user_id = '40200000-0000-0000-0000-000000000001'
      AND group_id IS NULL AND month = DATE '2026-10-01'), -130.00);

SELECT pg_temp.refute_num(
  'expense_variance NAO e -1.830,00',
  (SELECT COALESCE(SUM(expense_variance), 0) FROM public.planned_vs_actual
    WHERE user_id = '40200000-0000-0000-0000-000000000001'
      AND group_id IS NULL AND month = DATE '2026-10-01'),
  -1830.00, '"gastou 1.830 menos do que previu" por causa de uma linha apagada');

-- =====================================================
-- SECAO 3: CONTROLE POSITIVO -- pending e paid continuam contando
-- =====================================================
-- E esta secao que torna as secoes 1 e 2 uma medida. O conserto tira linhas de
-- uma soma; uma view que devolvesse zero para tudo passaria as duas primeiras.
--
-- Os dois numeros abaixo tambem separam `paid` de `pending`: um filtro escrito
-- como `IN ('pending')` deixaria o previsto em 130,00 e a receita em 700,00 --
-- a receita continuaria certa e so a despesa cairia, que e o tipo de defeito
-- meio-certo que passa despercebido.

SELECT pg_temp.refute_num(
  'o previsto do mes NAO e zero -- a view nao esvaziou a soma',
  (SELECT COALESCE(SUM(planned_income + planned_expense), 0) FROM public.planned_vs_actual
    WHERE user_id = '40200000-0000-0000-0000-000000000001'
      AND group_id IS NULL AND month = DATE '2026-10-01'),
  0, 'um filtro que excluiu TUDO -- as secoes 1 e 2 passariam vacuas');

SELECT pg_temp.expect_num(
  'a luz PAGA (11,00) continua no previsto -- prevista e aconteceu',
  (SELECT COALESCE(SUM(planned_expense), 0) FROM public.planned_vs_actual
    WHERE user_id = '40200000-0000-0000-0000-000000000001'
      AND group_id IS NULL AND month = DATE '2026-10-01')
  - 130.00, 11.00);

SELECT pg_temp.refute_num(
  'planned_expense NAO e 130,00',
  (SELECT COALESCE(SUM(planned_expense), 0) FROM public.planned_vs_actual
    WHERE user_id = '40200000-0000-0000-0000-000000000001'
      AND group_id IS NULL AND month = DATE '2026-10-01'),
  130.00, 'o filtro escrito como IN (''pending''), que derruba a conta JA PAGA');

-- =====================================================
-- SECAO 4: `cancelled` continua fora
-- =====================================================
-- Era a UNICA exclusao antes da 054. `CREATE OR REPLACE VIEW` exige a definicao
-- inteira, entao recolar o arquivo poderia ter perdido ela -- e nada mais neste
-- teste pegaria isso: tirar `cancelled` do filtro deixa as secoes 1, 2 e 3
-- verdes e so muda o total, que nenhuma delas soma por inteiro.
-- O premio cancelado e de 900,00 e nao aparece em nenhum total acima.

SELECT pg_temp.expect_num(
  'o premio CANCELADO (900,00) esta fora do previsto',
  (SELECT COALESCE(SUM(planned_income), 0) FROM public.planned_vs_actual
    WHERE user_id = '40200000-0000-0000-0000-000000000001'
      AND group_id IS NULL AND month = DATE '2026-10-01')
  - 700.00, 0.00);

-- =====================================================
-- SECAO 5: A CATRACA DO ENUM -- o conserto da causa-raiz
-- =====================================================
-- O filtro da view e uma lista por EXCLUSAO, e foi exatamente assim que o
-- `skipped` chegou a esta soma: ele entrou no enum `scheduled_status` depois do
-- 008, e ninguem revisitou o `<> 'cancelled'`. Toda outra leitura do previsto
-- filtra por INCLUSAO (`status = 'pending'`) e por isso nenhuma delas errou.
--
-- Esta secao fecha a porta para o PROXIMO estado novo. Ela nao mede a 054 --
-- mede a decisao que a 054 precisou tomar, e exige que ela seja tomada de novo
-- de proposito. Um `ALTER TYPE public.scheduled_status ADD VALUE 'x'` reprova o
-- db-verify nomeando `x`, em vez de deixa-lo entrar no previsto de graca.
--
-- Nao e uma assercao sobre o TEXTO da view: ela compara o enum com a lista de
-- estados que este arquivo declara ter pensado. Quem adicionar um estado tem de
-- vir aqui, decidir se ele e previsao, e dizer isso por escrito.
DO $$
DECLARE
  -- Os cinco estados de hoje, cada um com a decisao e o porque.
  v_classificados TEXT[] := ARRAY[
    'pending',    -- E previsao: esta em aberto e vai acontecer.
    'paid',       -- E previsao: foi prevista e aconteceu. Sai do previsto so
                  -- quem NAO vai acontecer -- esta aconteceu.
    'overdue',    -- E previsao: venceu e continua a pagar. NAO e escrito na
                  -- coluna por ninguem hoje (e derivado, mora em
                  -- `effective_status`), e por isso a 054 manteve a forma por
                  -- exclusao em vez de `IN ('pending','paid')` -- a positiva
                  -- derrubaria esta linha se ela passar a existir.
    'skipped',    -- NAO e previsao (054): o usuario apagou esta ocorrencia.
    'cancelled'   -- NAO e previsao (008): a serie foi encerrada.
  ];
  v_novos TEXT;
BEGIN
  SELECT string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) INTO v_novos
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'scheduled_status'
     AND NOT (e.enumlabel = ANY (v_classificados));

  IF v_novos IS NOT NULL THEN
    RAISE EXCEPTION
      E'FALHA: estado(s) novo(s) em scheduled_status sem decisao sobre o previsto: %\n'
       'O previsto de planned_vs_actual filtra por EXCLUSAO '
       '(NOT IN (''cancelled'', ''skipped'')), entao um estado novo entra na soma '
       'SOZINHO -- foi assim que o `skipped` virou a HMO-402. Decida se ele e '
       'previsao, ajuste o filtro da view numa migration nova se nao for, e '
       'acrescente o estado com o porque na lista da secao 5 deste arquivo.',
      v_novos;
  END IF;

  -- O outro lado da catraca: a lista nao pode ter estado que o enum nao tem.
  -- Sem isto, um `ALTER TYPE ... RENAME VALUE` deixaria a lista com um nome
  -- morto e a catraca passaria a aceitar o nome novo como "classificado".
  SELECT string_agg(c, ', ') INTO v_novos
    FROM unnest(v_classificados) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'scheduled_status' AND e.enumlabel = c
   );

  IF v_novos IS NOT NULL THEN
    RAISE EXCEPTION
      'FALHA: a secao 5 classifica estado(s) que nao existem mais no enum: %. '
      'Renomear ou remover valor de scheduled_status exige revisitar o filtro '
      'de status de planned_vs_actual.', v_novos;
  END IF;

  RAISE NOTICE 'ok: os % estados de scheduled_status estao todos classificados',
    array_length(v_classificados, 1);
END $$;

-- =====================================================
-- SECAO 6: CONTROLE NEGATIVO -- o filtro antigo sobre a fixture nova
-- =====================================================
-- Mesmo desenho do caso 3 do `043_direcao_do_previsto_avulso_test.sql` e do
-- caso 5 do `022_currency_test.sql`: reproduz o criterio ANTIGO sobre esta
-- fixture e EXIGE o numero errado.
--
-- Para que serve, ja que as secoes 1 e 2 negam os mesmos numeros: elas provam
-- que a VIEW mudou; esta prova que a FIXTURE ainda contem o caso. No dia em que
-- alguem mexer nos dados de cima e tirar a linha `skipped`, as secoes 1 e 2
-- continuam verdes medindo nada -- e esta fica vermelha dizendo por que.
--
-- Ela e o inverso de um mutante: em vez de estragar a view e exigir vermelho,
-- ela roda o SQL antigo ao lado do novo e exige que os dois DISCORDEM.
SELECT pg_temp.expect_num(
  'CONTROLE NEGATIVO: com o filtro antigo (<> ''cancelled'') a receita volta a 5.700,00',
  (SELECT COALESCE(SUM(s.amount) FILTER (WHERE s.direction = 'income'), 0)
     FROM public.scheduled_transactions_effective s
    WHERE s.user_id = '40200000-0000-0000-0000-000000000001'
      AND s.group_id IS NULL
      AND date_trunc('month', s.due_date)::date = DATE '2026-10-01'
      AND s.status <> 'cancelled'),      -- <- o criterio de ANTES da 054
  5700.00);

SELECT pg_temp.expect_num(
  'CONTROLE NEGATIVO: com o filtro antigo a despesa volta a 1.841,00',
  (SELECT COALESCE(SUM(s.amount) FILTER (WHERE s.direction = 'expense'), 0)
     FROM public.scheduled_transactions_effective s
    WHERE s.user_id = '40200000-0000-0000-0000-000000000001'
      AND s.group_id IS NULL
      AND date_trunc('month', s.due_date)::date = DATE '2026-10-01'
      AND s.status <> 'cancelled'),
  1841.00);

-- E o fecho: o criterio NOVO, escrito a mao aqui, tem de dar o mesmo que a VIEW
-- devolve. Se alguem recolar a view com o filtro antigo, este par discorda.
SELECT pg_temp.expect_num(
  'o criterio da 054 escrito a mao concorda com a view (receita)',
  (SELECT COALESCE(SUM(s.amount) FILTER (WHERE s.direction = 'income'), 0)
     FROM public.scheduled_transactions_effective s
    WHERE s.user_id = '40200000-0000-0000-0000-000000000001'
      AND s.group_id IS NULL
      AND date_trunc('month', s.due_date)::date = DATE '2026-10-01'
      AND s.status NOT IN ('cancelled', 'skipped'))
  - (SELECT COALESCE(SUM(planned_income), 0) FROM public.planned_vs_actual
      WHERE user_id = '40200000-0000-0000-0000-000000000001'
        AND group_id IS NULL AND month = DATE '2026-10-01'),
  0.00);

-- =====================================================
-- SECAO 7: a linha da view nao se contradiz
-- =====================================================
-- `pending_count` e `overdue_count` sempre filtraram `status = 'pending'`,
-- entao eles nunca tiveram o defeito. O resultado era uma linha que se
-- contradizia: em producao, "0 lancamentos em aberto" ao lado de "R$ 5.000
-- previstos", na MESMA linha.
--
-- A assercao e RELACIONAL de proposito -- nao depende de valor cravado, entao
-- ela continua medindo quando a fixture mudar: se nao ha linha em aberto e nada
-- foi pago, nao pode haver previsto. A fixture tem `pending_count = 2` (bonus e
-- internet), e e isso que faz o lado esquerdo ser verdade por medida e nao por
-- vacuidade.

SELECT pg_temp.expect_num(
  'pending_count de out/2026 e 2 (bonus e internet) -- a assercao abaixo nao e vacua',
  (SELECT COALESCE(SUM(pending_count), 0) FROM public.planned_vs_actual
    WHERE user_id = '40200000-0000-0000-0000-000000000001'
      AND group_id IS NULL AND month = DATE '2026-10-01'), 2);

DO $$
DECLARE
  v_linhas INT;
BEGIN
  SELECT count(*) INTO v_linhas
    FROM public.planned_vs_actual v
   WHERE v.pending_count = 0
     AND (v.planned_income + v.planned_expense) > 0
     -- `paid` legitimamente da previsto com zero em aberto, entao o mes que tem
     -- linha paga nao e contradicao. Exclui-se esse caso pela tabela.
     AND NOT EXISTS (
       SELECT 1 FROM public.scheduled_transactions s
        WHERE s.user_id = v.user_id
          AND s.group_id IS NOT DISTINCT FROM v.group_id
          AND date_trunc('month', s.due_date)::date = v.month
          AND s.status = 'paid'
     );

  IF v_linhas > 0 THEN
    RAISE EXCEPTION 'FALHA: % linha(s) da view com previsto > 0 e NENHUM lancamento '
      'em aberto nem pago -- previsto fantasma (o sintoma da HMO-402)', v_linhas;
  END IF;
  RAISE NOTICE 'ok: nenhuma linha da view tem previsto sem lancamento em aberto ou pago';
END $$;

-- =====================================================
-- SECAO 9: o que a 054 RECOLA da 045, re-afirmado nesta posicao
-- =====================================================
-- Esta secao nao mede a 054. Ela existe porque a suite da 045 NAO PODE ser
-- re-rodada depois deste arquivo: a secao 1 dela exige 950,00, que e o custo
-- pessoal pelo criterio da 033, e a 046 trocou o criterio para
-- "bruto + reembolso" -- o mesmo mes passou a valer 1.010,00. Eu tentei
-- re-rodar e ela reprovou com `esperado 950.00, obtido 1010.00`. Aquele arquivo
-- esta certo na posicao DELE, e nao existe fixture que passe nas duas.
--
-- Mas a 054 faz `CREATE OR REPLACE VIEW`, que exige a definicao INTEIRA, entao
-- ela carrega a definicao da 045 junto -- e sem esta secao essa parte ficaria
-- protegida so por um teste que roda ANTES deste arquivo. E exatamente o buraco
-- pelo qual a primeira versao da 045 reverteu a 043 em silencio.
--
-- O QUE MUDA EM RELACAO A 045: nenhuma assercao de DINHEIRO. Foi cravar o valor
-- que tornou a suite dela irreprodutivel aqui, e o valor depende de um criterio
-- de produto que ja mudou uma vez. As duas afirmacoes abaixo sao estruturais e
-- sobrevivem a proxima troca de criterio.

-- 9a. A TERCEIRA ORIGEM DE `chaves` (`group_share_entries`).
-- Em novembro este usuario nao tem NADA proprio -- nenhuma linha na agenda,
-- nenhuma transacao dele. A unica coisa capaz de produzir a chave de novembro e
-- a terceira perna do UNION. Sem ela o mes nao vem zero: vem AUSENTE, e um mes
-- ausente le-se na tela como "nao houve movimento".
SELECT pg_temp.expect_num(
  'o mes em que so o OUTRO membro gastou APARECE no meu relatorio pessoal',
  (SELECT count(*) FROM public.planned_vs_actual
    WHERE user_id = '40200000-0000-0000-0000-000000000001'
      AND group_id IS NULL AND month = DATE '2026-11-01'), 1);

-- E ele nao aparece vazio: a minha parte do mercado do Bruno esta la. Sem valor
-- cravado de proposito -- `<> 0` continua valendo qualquer que seja o criterio.
SELECT pg_temp.refute_num(
  'e o realizado desse mes NAO e zero (a minha parte do gasto do Bruno)',
  (SELECT COALESCE(SUM(actual_expense), 0) FROM public.planned_vs_actual
    WHERE user_id = '40200000-0000-0000-0000-000000000001'
      AND group_id IS NULL AND month = DATE '2026-11-01'),
  0, 'o mes presente mas VAZIO -- a chave veio e o LATERAL do realizado nao casou');

-- 9b. AS DUAS PERNAS DO REALIZADO SAO MUTUAMENTE EXCLUSIVAS.
-- Conta LINHAS, nao dinheiro. Se as duas pernas do `UNION ALL` pudessem casar na
-- mesma chave, o LATERAL devolveria duas linhas, a chave viraria duas linhas da
-- view e o relatorio contaria o PREVISTO DUAS VEZES -- um numero dobrado,
-- plausivel, sem erro nenhum. Nenhuma assercao sobre `actual_expense` pega isso:
-- o valor de cada linha continuaria certo.
--
-- A assercao varre a view INTEIRA e nao so a minha fixture: a chave e
-- (user_id, group_id, month, currency), e ela tem de ser unica por construcao.
DO $$
DECLARE
  v_dup INT;
BEGIN
  SELECT count(*) INTO v_dup FROM (
    SELECT user_id, group_id, month, currency
      FROM public.planned_vs_actual
     GROUP BY 1, 2, 3, 4
    HAVING count(*) > 1
  ) AS d;

  IF v_dup > 0 THEN
    RAISE EXCEPTION 'FALHA: % chave(s) com mais de uma linha em planned_vs_actual -- '
      'as duas pernas do LATERAL do realizado deixaram de ser mutuamente '
      'exclusivas, e o previsto esta sendo contado duas vezes', v_dup;
  END IF;
  RAISE NOTICE 'ok: nenhuma chave de planned_vs_actual produz linha duplicada';
END $$;

-- =====================================================
-- SECAO 8: CONTROLE NEGATIVO da RLS
-- =====================================================
-- A 054 faz `CREATE OR REPLACE VIEW`, que APAGA as reloptions -- e
-- `security_invoker` e uma reloption (medido no PG 17.11). Sem o `ALTER VIEW`
-- reaplicado, a view volta a rodar como o DONO, a RLS das tabelas de baixo nao
-- se aplica, e cada pessoa passa a ver a variancia mensal de todas as outras.
--
-- Sem esta secao TODO o resto do arquivo estaria medindo superusuario: as somas
-- acima filtram por `user_id` na mao, entao elas dariam os mesmos numeros com a
-- RLS furada.
--
-- A Dora tem lancamento PROPRIO (77,00) de proposito: numa conta vazia ela
-- veria zero por falta de dados e o controle seria vacuo.

SET LOCAL request.jwt.claim.sub = '40200000-0000-0000-0000-0000000000d1';

SELECT pg_temp.expect_num(
  'a Dora ve o previsto DELA (77,00) -- a conta esta viva, o controle nao e vacuo',
  (SELECT COALESCE(SUM(planned_expense), 0) FROM public.planned_vs_actual
    WHERE user_id = '40200000-0000-0000-0000-0000000000d1'
      AND group_id IS NULL AND month = DATE '2026-10-01'), 77.00);

SELECT pg_temp.expect_num(
  'a Dora NAO ve nenhuma linha da conta da HMO-402 (security_invoker de pe)',
  (SELECT count(*) FROM public.planned_vs_actual
    WHERE user_id = '40200000-0000-0000-0000-000000000001'), 0);

RESET ROLE;

-- A reloption em si, como segunda rede. A secao acima mede o EFEITO (que e o
-- que importa) e esta mede o MECANISMO -- as duas porque a reloption certa com
-- a RLS furada uma camada abaixo tambem passaria na de cima, e porque esta aqui
-- aponta o conserto direto.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.planned_vs_actual'::regclass
       AND reloptions @> ARRAY['security_invoker=true']
  ) THEN
    RAISE EXCEPTION 'FALHA: planned_vs_actual esta SEM security_invoker -- o '
      'CREATE OR REPLACE VIEW da 054 apagou a reloption e o ALTER VIEW nao foi '
      'reaplicado';
  END IF;
  RAISE NOTICE 'ok: planned_vs_actual tem security_invoker = true';
END $$;

DO $$ BEGIN RAISE NOTICE '054: todas as assercoes passaram'; END $$;

ROLLBACK;
