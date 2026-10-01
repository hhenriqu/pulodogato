-- =====================================================
-- Teste da minha parte no realizado (033)
-- =====================================================
-- HMO-202. Roda no db-verify, contra o banco que as migrations constroem do
-- zero.
--
-- "A view existe e devolve um numero" nao prova nada aqui. Esta migration mexe
-- no dinheiro do painel principal, e quase todo jeito errado de escreve-la
-- devolve um numero plausivel: o valor cheio em vez da parte, zero para quem
-- nao pagou, a parte de TODOS os membros somada na conta de um, o rateio
-- recusado cobrado de quem recusou. Nenhum desses da erro.
--
-- O DEFEITO QUE ESTE ARQUIVO EXISTE PARA PRENDER
-- ----------------------------------------------
-- Medido num Postgres local com a cadeia 001 -> 032, ANTES da 033: grupo de
-- duas pessoas, hotel de R$ 400 lancado pela Ana, realizado pessoal pelas views
-- que a rota le:
--
--   Ana (PAGOU os 400)        0,00
--   Bia (deve 200 do rateio)  0,00
--
-- E o conserto errado -- tirar o filtro `group_id IS NULL` da rota -- produz
-- 400,00 para a Ana e continua 0,00 para a Bia. Os dois numeros errados estao
-- NEGADOS explicitamente aqui (SECAO 1), porque os dois sao plausiveis e
-- silenciosos.
--
-- OS CONTROLES
-- ------------
--   * SECAO 1 nega 400 para quem pagou e nega 0 para quem nao pagou, alem de
--     exigir 200 nos dois. Exigir 200 sozinho ficaria vermelho se o numero
--     mudasse, mas nao diria QUAL defeito voltou -- e aqui os dois numeros
--     errados ja foram medidos.
--   * SECAO 1 tambem exige que a SOMA entre os membros seja a despesa inteira.
--     E a assercao que distingue "minha parte" de qualquer outra divisao que
--     acerte um dos lados: metade para um e metade para o outro fecha; valor
--     cheio para o pagador e zero para o outro tambem somaria 400, e e por isso
--     que a soma vem ACOMPANHADA das duas pernas.
--   * SECAO 2 tem CONTROLE POSITIVO da RLS: reproduz a leitura SEM filtro de
--     `user_id` e exige 400 -- a parte da Bia caindo na conta da Ana. Sem esse
--     controle, o teste nao provaria que o filtro da rota e load-bearing, e o
--     dia em que alguem o remover passaria verde. (Mesma familia do vazamento
--     que a HMO-177 achou no previsto: as policies de grupo tem `OR`, e consulta
--     sem `user_id` devolve a linha dos OUTROS.)
--   * SECAO 2 tem CONTROLE NEGATIVO: quem nao e do grupo ve zero E nao enxerga
--     linha nenhuma de parte. Se isso falhar, as views estao furando a RLS
--     (view sem `security_invoker` roda como o DONO) e todo o resto do arquivo
--     estaria medindo superusuario, nao usuario.
--   * SECAO 3 exige 'pending' CONTANDO. Um `status = 'approved'` zeraria o
--     realizado de grupo de todo mundo -- o defeito que a 033 conserta, vestido
--     de rigor -- e passaria em qualquer assercao que so olhasse 'rejected'.
--   * SECAO 5 nega a soma MISTURADA das moedas (1000 + 180 = 1180), que e o
--     numero que uma view sem a moeda no grao produz.
--   * SECAO 7 exige que o total do fluxo seja IGUAL a soma das categorias. Uma
--     pizza que nao fecha em 100% e o sintoma de duas definicoes do mesmo
--     numero, e e o risco de ter acrescentado a parte de grupo em so uma delas.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 033:
--   psql "$DB_URL" -f database/tests/033_minha_parte_no_realizado_test.sql
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

CREATE OR REPLACE FUNCTION pg_temp.expect_date(label TEXT, got DATE, want DATE)
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
-- Fixture: a Viagem de duas, mais uma pessoa de fora
-- =====================================================
-- Ana cria o grupo (e entra como admin pelo trigger add_group_creator). Bia
-- entra como membro comum. Cora NAO entra em grupo nenhum: e o controle
-- negativo, e o unico jeito de saber se as views respeitam a RLS ou se estao
-- rodando como o dono.
--
-- Os valores sao escolhidos para que os numeros errados sejam DISTINGUIVEIS:
-- R$ 400 em duas partes da 200/200, e 400 (valor cheio) nao se confunde com
-- 200 (a parte) nem com 0.
INSERT INTO auth.users (id, email) VALUES
  ('a2000000-0000-0000-0000-0000000000a1', 'ana-202@teste.local'),
  ('a2000000-0000-0000-0000-0000000000b1', 'bia-202@teste.local'),
  ('a2000000-0000-0000-0000-0000000000c1', 'cora-202@teste.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('a2000000-0000-0000-0000-0000000000a1', 'Ana 202',  FALSE),
  ('a2000000-0000-0000-0000-0000000000b1', 'Bia 202',  FALSE),
  ('a2000000-0000-0000-0000-0000000000c1', 'Cora 202', FALSE);

INSERT INTO public.expense_groups (id, name, created_by) VALUES
  ('92000000-0000-0000-0000-000000000001', 'Viagem 202', 'a2000000-0000-0000-0000-0000000000a1');

INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('92000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-0000000000b1', 'member', 'active');

INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance) VALUES
  ('f2000000-0000-0000-0000-0000000000a1', 'a2000000-0000-0000-0000-0000000000a1', 'Conta Ana', 'checking', 5000),
  ('f2000000-0000-0000-0000-0000000000b1', 'a2000000-0000-0000-0000-0000000000b1', 'Conta Bia', 'checking', 5000);

-- O hotel: R$ 400 pago pela ANA, no grupo. `amount` NEGATIVO, como o app grava.
-- O trigger do 001/024 cria a linha de group_transactions e as DUAS partes de
-- R$ 200 sozinho -- o app nao escreve nada disso.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type)
SELECT '72000000-0000-0000-0000-0000000000a1',
       'a2000000-0000-0000-0000-0000000000a1',
       'f2000000-0000-0000-0000-0000000000a1',
       c.service_id, c.id, '92000000-0000-0000-0000-000000000001',
       'Hotel', -400.00, DATE '2026-09-10', 'expense'
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

-- A fixture so vale se o rateio existir de verdade. Sem isto, todo zero deste
-- arquivo poderia ser "o trigger nao rodou" em vez de "a view nao conta".
SELECT pg_temp.expect('o hotel nasceu com 2 partes',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '72000000-0000-0000-0000-0000000000a1'), 2);

SELECT pg_temp.expect_num('cada parte e 200,00 e esta POSITIVA',
  (SELECT DISTINCT es.amount FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '72000000-0000-0000-0000-0000000000a1'), 200.00);

-- =====================================================
-- SECAO 1: os dois lados, e a soma que fecha
-- =====================================================
-- A assercao central da issue. Medida como cada usuario, pela RLS dele, e pela
-- MESMA view que a rota le.

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a2000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect_num('quem PAGOU ve a parte dele no realizado pessoal',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000a1'), 200.00);

-- O conserto errado: tirar o filtro `group_id IS NULL` da rota. A Ana veria o
-- hotel INTEIRO, incluindo os R$ 200 que a Bia devolve, e o mes dela fecharia
-- no vermelho por dinheiro que nao e dela.
SELECT pg_temp.refute_num('quem pagou NAO ve o valor cheio',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000a1'),
  400.00, 'o valor CHEIO do hotel -- o resultado de remover o filtro group_id IS NULL');

SET LOCAL request.jwt.claim.sub = 'a2000000-0000-0000-0000-0000000000b1';

SELECT pg_temp.expect_num('quem NAO pagou ve a parte dele no realizado pessoal',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1'), 200.00);

-- O defeito de antes da 033, do lado de quem nao pagou: a despesa e da Ana,
-- entao a Bia nao via nada -- nem com o filtro, nem sem ele.
SELECT pg_temp.refute_num('quem nao pagou NAO ve zero',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1'),
  0, 'o buraco que a 033 conserta: quem deve a parte nao via despesa nenhuma');

-- A soma entre os membros e a despesa inteira. Vem DEPOIS das duas pernas de
-- proposito: 400 para a Ana e 0 para a Bia tambem somaria 400.
RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

SELECT pg_temp.expect_num('a soma das partes dos dois membros e a despesa inteira',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id IN ('a2000000-0000-0000-0000-0000000000a1',
                      'a2000000-0000-0000-0000-0000000000b1')), 400.00);

-- E o painel DO GRUPO nao mudou: la o numero certo e o valor cheio da viagem.
-- Se esta assercao cair, a 033 consertou a tela pessoal quebrando a do grupo.
SELECT pg_temp.expect_num('o painel do grupo continua vendo o valor CHEIO',
  (SELECT COALESCE(SUM(expense), 0) FROM public.monthly_cash_flow
    WHERE group_id = '92000000-0000-0000-0000-000000000001'), 400.00);

-- =====================================================
-- SECAO 2: a RLS -- o controle positivo e o negativo
-- =====================================================

-- CONTROLE POSITIVO. As policies de grupo tem `OR is_group_member(...)`: a Ana
-- consegue LER a parte da Bia. Entao a consulta sem `user_id` devolve 400 na
-- conta pessoal da Ana, e e por isso que o filtro na rota e load-bearing. Esta
-- assercao fica vermelha no dia em que alguem decidir que o filtro e redundante.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a2000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect_num('SEM filtro de user_id a parte do OUTRO membro entra (o filtro da rota e obrigatorio)',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow), 400.00);

-- CONTROLE NEGATIVO. Cora nao divide grupo com ninguem. Se ela vir qualquer
-- coisa, alguma das quatro views perdeu `security_invoker` e esta rodando como
-- o dono -- e todo o resto deste arquivo estaria medindo superusuario.
SET LOCAL request.jwt.claim.sub = 'a2000000-0000-0000-0000-0000000000c1';

SELECT pg_temp.expect_num('quem nao e do grupo ve zero no realizado',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000c1'), 0);

SELECT pg_temp.expect('quem nao e do grupo nao enxerga linha de parte nenhuma',
  (SELECT count(*) FROM public.group_share_entries), 0);

SELECT pg_temp.expect('quem nao e do grupo nao enxerga rollup de parte nenhum',
  (SELECT count(*) FROM public.group_share_category_monthly_totals), 0);

-- Nem mesmo sem filtro: a Cora lendo a view pessoal inteira nao pode ver a
-- despesa de gente que ela nao conhece.
SELECT pg_temp.expect('a view pessoal inteira, para quem nao tem nada, vem vazia',
  (SELECT count(*) FROM public.personal_monthly_cash_flow), 0);

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

-- `anon` nao le relatorio de ninguem.
SET LOCAL ROLE anon;
DO $$
BEGIN
  PERFORM 1 FROM public.personal_monthly_cash_flow;
  RAISE EXCEPTION 'FALHA: anon conseguiu ler personal_monthly_cash_flow';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: anon nao le personal_monthly_cash_flow';
END $$;
RESET ROLE;

-- As quatro views sao security_invoker. A checagem direta no catalogo existe
-- porque um `CREATE OR REPLACE` futuro pode perder a opcao sem que nenhuma
-- consulta mude de resultado NESTA fixture -- o vazamento apareceria em
-- producao, onde ha mais de um grupo.
SELECT pg_temp.expect('as 4 views novas sao security_invoker',
  (SELECT count(*) FROM pg_class
    WHERE relname IN ('group_share_entries',
                      'group_share_category_monthly_totals',
                      'personal_category_monthly_totals',
                      'personal_monthly_cash_flow')
      AND relnamespace = 'public'::regnamespace
      AND reloptions @> ARRAY['security_invoker=true']), 4);

-- =====================================================
-- SECAO 3: o status do rateio
-- =====================================================
-- `group_member_balances` (007) ja resolveu isso e a 033 copia a regra: fora
-- 'rejected' e 'expired', dentro todo o resto. As duas pernas importam.

-- 'pending' CONTA. O app cria todo rateio como 'pending' e nada nunca os
-- aprova; com `status = 'approved'` o realizado de grupo sairia zero para todo
-- mundo -- o defeito que a 033 conserta, vestido de rigor.
SELECT pg_temp.expect('a fixture inteira esta em pending (e e assim que o app grava)',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '72000000-0000-0000-0000-0000000000a1'
      AND es.status = 'pending'), 2);

-- Agora a Bia RECUSA a parte dela. O gasto tem que sair do painel dela.
UPDATE public.group_expense_splits es
   SET status = 'rejected'
 WHERE es.id = (
   SELECT es2.id FROM public.group_expense_splits es2
     JOIN public.group_members em ON em.id = es2.member_id
     JOIN public.group_transactions gt ON gt.id = es2.group_transaction_id
    WHERE gt.transaction_id = '72000000-0000-0000-0000-0000000000a1'
      AND em.user_id = 'a2000000-0000-0000-0000-0000000000b1');

SELECT pg_temp.expect_num('rateio RECUSADO sai do realizado de quem recusou',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1'), 0);

-- E nao vai para a conta de quem pagou: a Ana continua com a parte DELA.
-- Sem esta assercao, uma view que descartasse a parte recusada jogando-a no
-- pagador passaria -- e o pagador voltaria a ver 400.
SELECT pg_temp.expect_num('a parte recusada nao migra para quem pagou',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000a1'), 200.00);

-- 'expired' tambem fica fora (o 007 trata os dois juntos).
UPDATE public.group_expense_splits es
   SET status = 'expired'
 WHERE es.id = (
   SELECT es2.id FROM public.group_expense_splits es2
     JOIN public.group_members em ON em.id = es2.member_id
     JOIN public.group_transactions gt ON gt.id = es2.group_transaction_id
    WHERE gt.transaction_id = '72000000-0000-0000-0000-0000000000a1'
      AND em.user_id = 'a2000000-0000-0000-0000-0000000000b1');

SELECT pg_temp.expect_num('rateio EXPIRADO tambem sai do realizado',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1'), 0);

-- 'approved' CONTA. Junto com a assercao de 'pending' acima, isto fecha a
-- regra: o filtro e por rejected/expired, nunca uma lista de permitidos.
UPDATE public.group_expense_splits es
   SET status = 'approved'
 WHERE es.id = (
   SELECT es2.id FROM public.group_expense_splits es2
     JOIN public.group_members em ON em.id = es2.member_id
     JOIN public.group_transactions gt ON gt.id = es2.group_transaction_id
    WHERE gt.transaction_id = '72000000-0000-0000-0000-0000000000a1'
      AND em.user_id = 'a2000000-0000-0000-0000-0000000000b1');

SELECT pg_temp.expect_num('rateio APROVADO conta',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1'), 200.00);

-- Volta para 'pending', que e o estado real do app, para as secoes seguintes.
UPDATE public.group_expense_splits es
   SET status = 'pending'
 WHERE es.id = (
   SELECT es2.id FROM public.group_expense_splits es2
     JOIN public.group_members em ON em.id = es2.member_id
     JOIN public.group_transactions gt ON gt.id = es2.group_transaction_id
    WHERE gt.transaction_id = '72000000-0000-0000-0000-0000000000a1'
      AND em.user_id = 'a2000000-0000-0000-0000-0000000000b1');

-- =====================================================
-- SECAO 4: receita lancada no grupo nao vira despesa
-- =====================================================
-- O trigger so rateia `amount < 0`, mas nada no schema impede uma parte
-- pendurada numa RECEITA -- o proprio teste da 024 insere uma a mao, e um
-- import ou uma rota antiga pode fazer o mesmo. Sem o filtro
-- `transaction_type = 'expense'`, essa linha entraria no realizado como DESPESA:
-- dinheiro que ENTROU aparecendo como dinheiro que SAIU.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type)
SELECT '72000000-0000-0000-0000-0000000000d1',
       'a2000000-0000-0000-0000-0000000000a1',
       'f2000000-0000-0000-0000-0000000000a1',
       c.service_id, c.id, '92000000-0000-0000-0000-000000000001',
       'Reembolso do hotel', 90.00, DATE '2026-09-12', 'income'
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

INSERT INTO public.group_transactions (group_id, transaction_id, split_type, created_by)
VALUES ('92000000-0000-0000-0000-000000000001',
        '72000000-0000-0000-0000-0000000000d1', 'equal',
        'a2000000-0000-0000-0000-0000000000a1');

INSERT INTO public.group_expense_splits (group_transaction_id, member_id, percentage, amount, status)
SELECT gt.id, em.id, 50.00, 45.00, 'pending'
  FROM public.group_transactions gt
  JOIN public.group_members em ON em.group_id = gt.group_id
 WHERE gt.transaction_id = '72000000-0000-0000-0000-0000000000d1'
   AND em.user_id = 'a2000000-0000-0000-0000-0000000000b1';

SELECT pg_temp.expect('a parte pendurada na receita existe de verdade na fixture',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '72000000-0000-0000-0000-0000000000d1'), 1);

SELECT pg_temp.expect_num('parte pendurada em RECEITA nao vira despesa no realizado',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1'), 200.00);

SELECT pg_temp.refute_num('a despesa da Bia nao ganhou os 45 do reembolso',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1'),
  245.00, 'a parte da RECEITA contada como despesa (filtro transaction_type ausente)');

-- E a receita de grupo tambem nao entra como RECEITA dela: o pedido e sobre a
-- parte das DESPESAS, e creditar 45 de entrada para quem nao recebeu nada
-- inflaria o "quanto entrou" do mes.
SELECT pg_temp.expect_num('a receita de grupo nao vira entrada de quem nao recebeu',
  (SELECT COALESCE(SUM(income), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1'), 0);

-- =====================================================
-- SECAO 5: a moeda fica no GRAO
-- =====================================================
-- O grupo pode estar em outra moeda (026). Somar a parte em dolar junto com a
-- parte em real daria um numero que nao esta em moeda nenhuma -- o defeito que
-- a 022 foi a producao tirar das views, e que volta por esta porta se a chave
-- for so (usuario, mes).
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type, currency, exchange_rate)
SELECT '72000000-0000-0000-0000-0000000000e1',
       'a2000000-0000-0000-0000-0000000000a1',
       'f2000000-0000-0000-0000-0000000000a1',
       c.service_id, c.id, '92000000-0000-0000-0000-000000000001',
       'Jantar em Miami', -60.00, DATE '2026-09-20', 'expense', 'USD', 5.40
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

SELECT pg_temp.expect_num('a parte em dolar e 30,00 USD',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1' AND currency = 'USD'), 30.00);

SELECT pg_temp.expect_num('a parte em real continua 200,00 BRL, sem o dolar dentro',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1' AND currency = 'BRL'), 200.00);

SELECT pg_temp.expect('o mes da Bia tem DUAS linhas, uma por moeda',
  (SELECT count(*) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1'
      AND month = DATE '2026-09-01'), 2);

SELECT pg_temp.refute_num('as moedas nao sao somadas juntas',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1'
      AND month = DATE '2026-09-01' AND currency = 'BRL'),
  230.00, 'reais + dolares na mesma linha (moeda fora do grao)');

-- =====================================================
-- SECAO 6: o mes e o da DESPESA, nao o da criacao da parte
-- =====================================================
-- A 024 refaz as partes quando a despesa e editada, entao `es.created_at` e
-- SEMPRE recente. Usar isso como mes faria uma despesa de julho migrar para o
-- mes da edicao: um mes fechado mudando de valor depois de fechado.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type)
SELECT '72000000-0000-0000-0000-0000000000f1',
       'a2000000-0000-0000-0000-0000000000a1',
       'f2000000-0000-0000-0000-0000000000a1',
       c.service_id, c.id, '92000000-0000-0000-0000-000000000001',
       'Gasolina de julho', -100.00, DATE '2026-07-05', 'expense'
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

-- E, no MESMO mes, uma despesa so da Bia -- nada de grupo. Ela existe para a
-- SECAO 6b poder provar que a 033 SOMOU os dois lados em vez de trocar um pelo
-- outro.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, description,
   amount, transaction_date, transaction_type)
SELECT '72000000-0000-0000-0000-00000000000b',
       'a2000000-0000-0000-0000-0000000000b1',
       'f2000000-0000-0000-0000-0000000000b1',
       c.service_id, c.id,
       'Mercado da Bia (so dela)', -70.00, DATE '2026-07-20', 'expense'
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

SELECT pg_temp.expect_num('a parte de julho cai em JULHO',
  (SELECT COALESCE(SUM(expense), 0) FROM public.group_share_category_monthly_totals
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1'
      AND month = DATE '2026-07-01'), 50.00);

-- O mes da linha vem de `transaction_date`, dito diretamente.
SELECT pg_temp.expect_date('o mes da parte vem da data da DESPESA',
  (SELECT e.month FROM public.group_share_entries e
    WHERE e.transaction_id = '72000000-0000-0000-0000-0000000000f1'
      AND e.user_id = 'a2000000-0000-0000-0000-0000000000b1'), DATE '2026-07-01');

-- O CONTROLE que torna a assercao acima nao-vazia: a parte foi CRIADA agora,
-- num mes diferente de julho. Sem ele, `created_at` no lugar de
-- `transaction_date` passaria verde num banco em que as duas datas coincidem.
SELECT pg_temp.expect('a parte de julho foi criada FORA de julho (senao a assercao acima nao distingue nada)',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_members em ON em.id = es.member_id
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '72000000-0000-0000-0000-0000000000f1'
      AND em.user_id = 'a2000000-0000-0000-0000-0000000000b1'
      AND date_trunc('month', es.created_at)::date <> DATE '2026-07-01'), 1);

-- E setembro continua valendo 200,00: os 50 de julho nao vazaram para ca. Com o
-- mes saindo de `created_at`, esta linha viria 250,00.
SELECT pg_temp.refute_num('os 50 de julho nao somam tambem no mes corrente',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1'
      AND month = DATE '2026-09-01' AND currency = 'BRL'),
  250.00, 'os 50 de julho somados num mes que nao e o da despesa (mes vindo de created_at)');

SELECT pg_temp.expect_num('setembro continua exatamente 200,00 em BRL',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1'
      AND month = DATE '2026-09-01' AND currency = 'BRL'), 200.00);

-- =====================================================
-- SECAO 6b: a 033 SOMA os dois lados, nao troca um pelo outro
-- =====================================================
-- Julho tem as duas coisas na conta da Bia: a parte de R$ 50 da gasolina do
-- grupo e o mercado de R$ 70 que e so dela. O realizado pessoal e 120.
--
-- As duas negacoes sao os dois jeitos de errar, e os dois produzem um numero
-- plausivel: 70 e o lado pessoal sozinho (a parte de grupo nunca entrou -- o
-- defeito de antes da 033), e 50 e a parte sozinha (o UNION ALL perdeu a perna
-- pessoal e TODA despesa pessoal do app desapareceu do painel).
SELECT pg_temp.expect_num('julho = a parte do grupo MAIS a despesa pessoal',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1'
      AND month = DATE '2026-07-01' AND currency = 'BRL'), 120.00);

SELECT pg_temp.refute_num('julho nao e so o lado pessoal',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1'
      AND month = DATE '2026-07-01' AND currency = 'BRL'),
  70.00, 'a despesa pessoal sozinha -- a parte de grupo nao entrou (o buraco de antes da 033)');

SELECT pg_temp.refute_num('julho nao e so a parte do grupo',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1'
      AND month = DATE '2026-07-01' AND currency = 'BRL'),
  50.00, 'a parte de grupo sozinha -- a perna PESSOAL do UNION ALL desapareceu');

-- O `net` tem sinal, e ele e o numero que o painel pinta de vermelho ou verde.
-- Uma despesa com net POSITIVO vira "voce economizou" onde houve gasto.
SELECT pg_temp.expect_num('o net de julho e NEGATIVO (so saiu dinheiro)',
  (SELECT COALESCE(SUM(net), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1'
      AND month = DATE '2026-07-01' AND currency = 'BRL'), -120.00);

-- =====================================================
-- SECAO 6c: a parte e LIDA do banco, nunca recalculada
-- =====================================================
-- A tentacao e calcular `ABS(t.amount) / n_membros` ou
-- `ABS(t.amount) * es.percentage / 100` na propria view. As duas empatam com o
-- valor gravado na maioria dos casos e divergem exatamente onde doi -- e o caso
-- que divide mal e justamente o que o 007 foi a producao consertar:
--
--   R$ 300 por 3, pelo metodo do maior resto (o do banco):  100,00 / 100,00 / 100,00
--   R$ 300 por 3, pela PORCENTAGEM arredondada:              99,99 /  99,99 /  99,99
--
-- Os R$ 0,03 que somem sao o saldo residual que pagamento nenhum zera. Com a
-- view recalculando, o realizado pessoal passaria a discordar do saldo do grupo
-- (`group_member_balances`, 007) por centavos que ninguem consegue explicar.
INSERT INTO auth.users (id, email) VALUES
  ('a2000000-0000-0000-0000-0000000000d1', 'caio-202@teste.local');
INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('a2000000-0000-0000-0000-0000000000d1', 'Caio 202', FALSE);
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('92000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-0000000000d1', 'member', 'active');

INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type)
SELECT '72000000-0000-0000-0000-0000000000a9',
       'a2000000-0000-0000-0000-0000000000a1',
       'f2000000-0000-0000-0000-0000000000a1',
       c.service_id, c.id, '92000000-0000-0000-0000-000000000001',
       'Pousada de junho (3 pessoas)', -300.00, DATE '2026-06-08', 'expense'
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

-- O controle que torna a assercao seguinte nao-vazia: a porcentagem gravada e
-- de fato 33.33, entao o caminho errado produziria 99,99 de verdade.
SELECT pg_temp.expect_num('a porcentagem gravada e 33.33 (o caminho errado produziria 99,99)',
  (SELECT DISTINCT es.percentage FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '72000000-0000-0000-0000-0000000000a9'), 33.33);

SELECT pg_temp.expect_num('a parte de 300 por 3 e 100,00 -- o valor GRAVADO',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1'
      AND month = DATE '2026-06-01' AND currency = 'BRL'), 100.00);

SELECT pg_temp.refute_num('a parte NAO vem da porcentagem arredondada',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1'
      AND month = DATE '2026-06-01' AND currency = 'BRL'),
  99.99, 'a divisao pela porcentagem arredondada -- o bug de centavo que o 007 consertou');

-- E a soma dos TRES membros e a pousada inteira. E a mesma invariante da SECAO
-- 1, agora num caso em que a divisao nao e exata.
--
-- O `group_id` no WHERE nao e decoracao: este arquivo roda no db-verify contra o
-- MESMO banco que as outras suites, na posicao dele na cadeia. Uma soma recortada
-- so por mes e moeda somaria a despesa de grupo de qualquer fixture anterior que
-- tenha dado COMMIT, e a assercao passaria a depender da ordem dos steps.
SELECT pg_temp.expect_num('a soma das tres partes e a pousada inteira',
  (SELECT COALESCE(SUM(expense), 0) FROM public.group_share_category_monthly_totals
    WHERE group_id = '92000000-0000-0000-0000-000000000001'
      AND month = DATE '2026-06-01' AND currency = 'BRL'), 300.00);

-- =====================================================
-- SECAO 7: a pizza fecha -- fluxo = soma das categorias
-- =====================================================
-- O total do fluxo e a soma das categorias saem de definicoes DIFERENTES na
-- rota (duas views, dois endpoints). Se a parte de grupo entrar em so uma
-- delas, o painel mostra dois totais e o usuario nao tem como escolher.
SELECT pg_temp.expect_num('fluxo de caixa = soma das categorias, em BRL',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1' AND currency = 'BRL')
  - (SELECT COALESCE(SUM(expense), 0) FROM public.personal_category_monthly_totals
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1' AND currency = 'BRL'), 0);

SELECT pg_temp.expect_num('fluxo de caixa = soma das categorias, em USD',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1' AND currency = 'USD')
  - (SELECT COALESCE(SUM(expense), 0) FROM public.personal_category_monthly_totals
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1' AND currency = 'USD'), 0);

-- E a view de LINHA, que o modo intervalo le, fecha com o rollup mensal. Sem
-- isto, "de 01/09 a 30/09" e "setembro" dariam numeros diferentes para o mesmo
-- periodo -- dois caminhos da mesma rota discordando.
SELECT pg_temp.expect_num('a view de linha fecha com o rollup mensal (modo intervalo = modo mes)',
  (SELECT COALESCE(SUM(amount), 0) FROM public.group_share_entries
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1'
      AND currency = 'BRL'
      AND transaction_date BETWEEN DATE '2026-09-01' AND DATE '2026-09-30')
  - (SELECT COALESCE(SUM(expense), 0) FROM public.group_share_category_monthly_totals
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1'
      AND currency = 'BRL' AND month = DATE '2026-09-01'), 0);

-- =====================================================
-- SECAO 8: a contagem, que e o que faz a MEDIA existir
-- =====================================================
-- A rota divide o total pelos meses COM movimento. Com `transaction_count = 0`,
-- a Bia -- que nao pagou nada -- veria `total_expense = 200` e
-- `average_expense = 0` no mesmo bloco, e `months_with_activity = 0` apagaria o
-- mes dela da media. Dois numeros plausiveis que se contradizem na mesma tela.
SELECT pg_temp.expect('quem nao pagou tem mes COM movimento (senao a media sai zero)',
  (SELECT COALESCE(SUM(transaction_count), 0)::bigint FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1'
      AND month = DATE '2026-09-01' AND currency = 'BRL'), 1);

-- =====================================================
-- SECAO 9: quem saiu do grupo nao perde o historico
-- =====================================================
-- A parte de uma despesa de setembro continua sendo dinheiro gasto em setembro,
-- mesmo que a pessoa saia do grupo em outubro. Um filtro por `em.status =
-- 'active'` aqui reescreveria o passado da pessoa no dia em que ela sai -- e um
-- mes fechado mudaria de valor. (A view de saldo do 007 filtra, e esta certa:
-- la a pergunta e "quem acerta com quem HOJE".)
UPDATE public.group_members
   SET status = 'removed'
 WHERE group_id = '92000000-0000-0000-0000-000000000001'
   AND user_id = 'a2000000-0000-0000-0000-0000000000b1';

SELECT pg_temp.expect_num('quem saiu do grupo mantem a parte das despesas antigas',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000b1'
      AND month = DATE '2026-09-01' AND currency = 'BRL'), 200.00);

ROLLBACK;
