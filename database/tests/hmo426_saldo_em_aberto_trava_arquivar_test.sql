-- =====================================================
-- A travessa de arquivar o grupo mede SALDO, nao status de parte (HMO-426)
-- =====================================================
-- `lib/services/expense-groups.ts` -> `saldoEmAbertoNoGrupo` recusa arquivar o
-- grupo quando alguem tem saldo diferente de zero. Os dois chamadores sao
-- arquivar o grupo (`DELETE /api/expense-groups/{id}`) e sair como ULTIMO
-- membro (`POST /api/expense-groups/{id}/leave`).
--
-- O criterio ANTERIOR era `group_expense_splits.status = 'pending'` em alguma
-- parte do grupo. A HMO-425 tirou do app o aprovar/recusar a propria parte, e
-- nenhum caminho nosso escreve mais nada naquela coluna: toda parte nasce
-- 'pending' e fica. Grupo com qualquer despesa lancada nao podia mais ser
-- arquivado nem apagado, para sempre.
--
-- O QUE ESTE ARQUIVO PROVA, E QUE A SUITE DE TS NAO ALCANCA
-- --------------------------------------------------------
-- `npm run test:travessa-de-arquivar` chama os dois route handlers com um duble
-- e mede o que a ROTA faz em cima da resposta da view. Ela nao mede a resposta:
-- os fixtures dela sao numeros escritos a mao. Aqui as perguntas sao as outras
-- tres, e nenhuma delas se responde sem um Postgres de verdade:
--
--   1. a view PRODUZ zero num grupo acertado e valor em aberto num grupo
--      devendo -- com as partes todas 'pending' NOS DOIS CASOS. E a secao 2:
--      no mesmo instante, no mesmo grupo, os dois criterios DISCORDAM, e o
--      antigo nao tem saida;
--   2. quem pergunta ENXERGA o saldo dos outros. A view e `security_invoker`;
--      se a RLS recortasse so a linha de quem le, um grupo em que apenas OUTRA
--      pessoa tem saldo em aberto responderia "acertado" e seria arquivado;
--   3. a leitura tem de vir ANTES da escrita. A view tem `WHERE m.status =
--      'active'`, e a secao 5 mede o que ela responde depois do UPDATE que
--      arquiva os membros: NADA -- isto e, "nao ha saldo em aberto", sempre.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 057:
--   psql "$DB_URL" -f database/tests/hmo426_saldo_em_aberto_trava_arquivar_test.sql
--
-- CONTROLE NEGATIVO EXTERNO: contra um banco parado antes da 007 (sem a view) o
-- arquivo reprova na primeira consulta, com `relation
-- "public.group_member_balances" does not exist`. Contra um banco parado antes
-- da 026 ele ainda passa, de proposito -- as colunas de cambio nao mudam o
-- criterio, e exigir a 026 aqui faria o arquivo medir a migration errada.
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

/**
 * A PERGUNTA DA TRAVESSA, ESCRITA UMA VEZ.
 *
 * E o equivalente SQL do que `saldoEmAbertoNoGrupo` manda ao PostgREST:
 *
 *     .from("group_member_balances").select("user_id")
 *     .eq("group_id", groupId).neq("net_balance", 0).limit(1)
 *
 * `> 0` em vez de `= 1` porque o `limit(1)` da travessa e economia de bytes, e
 * nao parte do criterio: a pergunta e de existencia. Repetir o predicado em
 * cada assercao deixaria cada uma livre para divergir dele, que e exatamente o
 * jeito de um teste continuar verde medindo outra coisa.
 */
CREATE OR REPLACE FUNCTION pg_temp.ha_saldo_em_aberto(p_group UUID)
RETURNS BOOLEAN LANGUAGE sql AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_member_balances
     WHERE group_id = p_group AND net_balance <> 0
  );
$$;

/** O criterio ANTIGO, para os dois poderem ser medidos no mesmo instante. */
CREATE OR REPLACE FUNCTION pg_temp.ha_parte_pendente(p_group UUID)
RETURNS BOOLEAN LANGUAGE sql AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_expense_splits es
      JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
     WHERE gt.group_id = p_group AND es.status = 'pending'
  );
$$;

CREATE OR REPLACE FUNCTION pg_temp.expect_bool(label TEXT, got BOOLEAN, want BOOLEAN)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- =====================================================
-- Fixture: uma viagem de duas pessoas, do jeito que o app grava
-- =====================================================
-- Helio paga o hotel (R$ 200) e Lais nao paga nada. O trigger
-- `auto_create_group_transaction` rateia igualmente entre os ativos, e grava as
-- duas partes como 'pending' -- que e o unico valor que o app produz desde a
-- HMO-425.
--
--   Helio  pagou 200, deve 100  ->  +100
--   Lais   pagou   0, deve 100  ->  -100
--
-- E e ESSA a propriedade do fixture que importa: o grupo esta devendo E as
-- partes estao pendentes. E o unico estado em que os dois criterios podem ser
-- distinguidos, e e o estado em que todo grupo do app nasce.
INSERT INTO auth.users (id, email) VALUES
  ('26000000-0000-0000-0000-0000000000a1', 'helio@hmo426.local'),
  ('26000000-0000-0000-0000-0000000000b1', 'lais@hmo426.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('26000000-0000-0000-0000-0000000000a1', 'Helio', FALSE),
  ('26000000-0000-0000-0000-0000000000b1', 'Lais',  FALSE);

INSERT INTO public.expense_groups (id, name, created_by) VALUES
  ('26000000-0000-0000-0000-00000000e001', 'Viagem HMO-426',
   '26000000-0000-0000-0000-0000000000a1');

-- O trigger `add_group_creator` ja inseriu Helio como admin; falta a Lais.
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('26000000-0000-0000-0000-00000000e001', '26000000-0000-0000-0000-0000000000b1',
   'member', 'active');

SELECT pg_temp.expect('a viagem tem 2 membros ativos',
  (SELECT count(*) FROM public.group_members
    WHERE group_id = '26000000-0000-0000-0000-00000000e001' AND status = 'active'), 2);

INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance) VALUES
  ('26000000-0000-0000-0000-0000000000c1', '26000000-0000-0000-0000-0000000000a1',
   'Conta Helio', 'checking', 1000);

-- amount NEGATIVO, como o app grava.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type)
SELECT '26000000-0000-0000-0000-0000000000d1',
       '26000000-0000-0000-0000-0000000000a1',
       '26000000-0000-0000-0000-0000000000c1',
       c.service_id, c.id, '26000000-0000-0000-0000-00000000e001',
       'Hotel', -200.00, CURRENT_DATE, 'expense'
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

SELECT pg_temp.expect('o trigger ligou a despesa ao grupo',
  (SELECT count(*) FROM public.group_transactions
    WHERE group_id = '26000000-0000-0000-0000-00000000e001'), 1);

SELECT pg_temp.expect('e criou as 2 partes',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.group_id = '26000000-0000-0000-0000-00000000e001'), 2);

-- A premissa do fixture, medida e nao suposta: NENHUMA parte nasce aprovada.
-- Se um dia o trigger passar a gravar outro valor, as secoes 1 e 2 deixam de
-- medir a diferenca entre os dois criterios e e aqui que isso aparece.
SELECT pg_temp.expect('as 2 partes nascem pending',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.group_id = '26000000-0000-0000-0000-00000000e001'
      AND es.status = 'pending'), 2);

-- =====================================================
-- 1. GRUPO DEVENDO: a travessa recusa, e os dois criterios CONCORDAM
-- =====================================================
SELECT pg_temp.expect_num('Helio tem R$ 100 a receber',
  (SELECT net_balance FROM public.group_member_balances
    WHERE group_id = '26000000-0000-0000-0000-00000000e001'
      AND user_id = '26000000-0000-0000-0000-0000000000a1'), 100.00);

SELECT pg_temp.expect_num('Lais deve R$ 100',
  (SELECT net_balance FROM public.group_member_balances
    WHERE group_id = '26000000-0000-0000-0000-00000000e001'
      AND user_id = '26000000-0000-0000-0000-0000000000b1'), -100.00);

SELECT pg_temp.expect_bool('criterio NOVO: ha saldo em aberto -> recusa arquivar',
  pg_temp.ha_saldo_em_aberto('26000000-0000-0000-0000-00000000e001'), TRUE);

SELECT pg_temp.expect_bool('criterio ANTIGO: ha parte pendente -> tambem recusava',
  pg_temp.ha_parte_pendente('26000000-0000-0000-0000-00000000e001'), TRUE);

-- =====================================================
-- 2. O ACERTO ZERA O SALDO E AS PARTES CONTINUAM 'pending'
-- =====================================================
-- E a assercao central desta issue. Lais paga os R$ 100 que deve para o Helio,
-- pelo mesmo caminho que o app usa (`POST /api/expense-groups/{id}/settlements`
-- grava em `group_settlements`). Depois disso:
--
--   criterio NOVO    -> nao ha saldo em aberto: o grupo PODE ser arquivado;
--   criterio ANTIGO  -> ha parte pendente: o grupo NAO pode, e nunca mais
--                       podera, porque o aprovar/recusar que mudava essa coluna
--                       saiu do app na HMO-425.
--
-- Os dois criterios discordando no MESMO instante e sobre o MESMO grupo e o que
-- torna este arquivo capaz de reprovar o codigo de antes do conserto. Uma suite
-- que so medisse "grupo acertado pode ser arquivado" passaria verde tambem num
-- fixture sem parte pendente nenhuma -- isto e, num estado que o app nao
-- produz.
INSERT INTO public.group_settlements
  (group_id, from_user_id, to_user_id, amount, created_by, note)
VALUES
  ('26000000-0000-0000-0000-00000000e001',
   '26000000-0000-0000-0000-0000000000b1',
   '26000000-0000-0000-0000-0000000000a1',
   100.00, '26000000-0000-0000-0000-0000000000b1', 'Pix da viagem');

SELECT pg_temp.expect_num('Helio recebeu e ZEROU',
  (SELECT net_balance FROM public.group_member_balances
    WHERE group_id = '26000000-0000-0000-0000-00000000e001'
      AND user_id = '26000000-0000-0000-0000-0000000000a1'), 0.00);

SELECT pg_temp.expect_num('Lais pagou e ZEROU',
  (SELECT net_balance FROM public.group_member_balances
    WHERE group_id = '26000000-0000-0000-0000-00000000e001'
      AND user_id = '26000000-0000-0000-0000-0000000000b1'), 0.00);

SELECT pg_temp.expect('as partes continuam TODAS pending depois do acerto',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.group_id = '26000000-0000-0000-0000-00000000e001'
      AND es.status = 'pending'), 2);

SELECT pg_temp.expect_bool('criterio NOVO: grupo acertado LIBERA o arquivamento',
  pg_temp.ha_saldo_em_aberto('26000000-0000-0000-0000-00000000e001'), FALSE);

SELECT pg_temp.expect_bool('criterio ANTIGO: travaria este grupo para sempre',
  pg_temp.ha_parte_pendente('26000000-0000-0000-0000-00000000e001'), TRUE);

-- =====================================================
-- 3. QUEM PERGUNTA ENXERGA O SALDO DOS OUTROS (security_invoker + RLS)
-- =====================================================
-- A travessa roda com o client de SESSAO, sob RLS, e quem a dispara e quem esta
-- saindo ou arquivando. Se a RLS recortasse a view a linha de quem le, um grupo
-- em que apenas OUTRA pessoa tem saldo em aberto responderia "acertado" -- e
-- seria arquivado levando o registro da divida embora. Falha ABERTA, do mesmo
-- tipo que a HMO-145, por um caminho diferente.
--
-- Por isso o acerto e desfeito aqui: volta a haver divida, e ela e de OUTRA
-- pessoa do ponto de vista de quem pergunta.
DELETE FROM public.group_settlements
 WHERE group_id = '26000000-0000-0000-0000-00000000e001';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '26000000-0000-0000-0000-0000000000b1';

SELECT pg_temp.expect('a Lais enxerga as 2 linhas de saldo do grupo',
  (SELECT count(*) FROM public.group_member_balances
    WHERE group_id = '26000000-0000-0000-0000-00000000e001'), 2);

SELECT pg_temp.expect_num('e enxerga os R$ 100 que o HELIO tem a receber',
  (SELECT net_balance FROM public.group_member_balances
    WHERE group_id = '26000000-0000-0000-0000-00000000e001'
      AND user_id = '26000000-0000-0000-0000-0000000000a1'), 100.00);

SELECT pg_temp.expect_bool('a travessa disparada pela Lais ve o saldo em aberto',
  pg_temp.ha_saldo_em_aberto('26000000-0000-0000-0000-00000000e001'), TRUE);

RESET ROLE;
RESET request.jwt.claim.sub;

-- =====================================================
-- 4. A VIEW SO VE MEMBRO ATIVO -- POR ISSO A LEITURA VEM ANTES DA ESCRITA
-- =====================================================
-- `group_member_balances` termina em `WHERE m.status = 'active'` (026). As duas
-- rotas que consultam a travessa arquivam os membros (`status = 'archived'`)
-- logo depois de passar por ela. Esta secao mede o que a travessa responderia
-- se fosse consultada DEPOIS dessa escrita: o grupo continua devendo os mesmos
-- R$ 100, e a resposta vira "nao ha saldo em aberto".
--
-- Nao e hipotese de laboratorio: e a ordem em que o codigo FICARIA se alguem
-- movesse a checagem para depois do UPDATE achando que a ordem era estetica. O
-- numero abaixo e o que essa troca custaria.
UPDATE public.group_members
   SET status = 'archived'
 WHERE group_id = '26000000-0000-0000-0000-00000000e001';

SELECT pg_temp.expect('membro arquivado desaparece da view',
  (SELECT count(*) FROM public.group_member_balances
    WHERE group_id = '26000000-0000-0000-0000-00000000e001'), 0);

SELECT pg_temp.expect_bool(
  'a travessa consultada DEPOIS de arquivar os membros responderia "nao ha"',
  pg_temp.ha_saldo_em_aberto('26000000-0000-0000-0000-00000000e001'), FALSE);

-- E a divida continua existindo embaixo: o que mudou foi so quem a view mostra.
SELECT pg_temp.expect_num('a despesa de R$ 200 nao foi a lugar nenhum',
  (SELECT SUM(ABS(t.amount)) FROM public.financial_transactions t
    WHERE t.group_id = '26000000-0000-0000-0000-00000000e001'), 200.00);

UPDATE public.group_members
   SET status = 'active'
 WHERE group_id = '26000000-0000-0000-0000-00000000e001';

-- =====================================================
-- 5. O TRAVAMENTO QUE FICA DE PROPOSITO: saldo que nao soma zero
-- =====================================================
-- Acerto nenhum zera um grupo cujos saldos nao somam zero -- despesa lancada e
-- nunca rateada, rateio que nao cobre 100% do valor, parte no nome de quem ja
-- saiu (ver `residual` em lib/settlement.ts). Nesses grupos a travessa recusa
-- indefinidamente, e a recusa esta CERTA: alguem pagou pelo grupo e nao foi
-- reembolsado.
--
-- A porta de saida ai nao e o botao de acerto, e consertar a despesa -- e esta
-- secao mede as duas metades: que o travamento existe, e que ele TEM saida.
-- Esta anotado aqui, com medida, porque e a unica consequencia conhecida do
-- criterio novo que nao e obvia lendo a issue.
DELETE FROM public.group_expense_splits es
 USING public.group_transactions gt
 WHERE gt.id = es.group_transaction_id
   AND gt.group_id = '26000000-0000-0000-0000-00000000e001';

SELECT pg_temp.expect_num('sem rateio, quem pagou fica com os 200 inteiros a receber',
  (SELECT net_balance FROM public.group_member_balances
    WHERE group_id = '26000000-0000-0000-0000-00000000e001'
      AND user_id = '26000000-0000-0000-0000-0000000000a1'), 200.00);

SELECT pg_temp.expect_num('e a soma do grupo deixa de ser zero: acerto nao fecha isso',
  (SELECT SUM(net_balance) FROM public.group_member_balances
    WHERE group_id = '26000000-0000-0000-0000-00000000e001'), 200.00);

SELECT pg_temp.expect_bool('a travessa recusa, e e o comportamento desejado',
  pg_temp.ha_saldo_em_aberto('26000000-0000-0000-0000-00000000e001'), TRUE);

-- A SAIDA: apagar a despesa sem rateio. Quem lancou pode faze-lo
-- (`financial_transactions_delete` e `USING (user_id = auth.uid())`), entao o
-- grupo nao fica preso -- o caminho so nao e o botao de acerto.
DELETE FROM public.financial_transactions
 WHERE id = '26000000-0000-0000-0000-0000000000d1';

SELECT pg_temp.expect_bool('apagada a despesa orfa, o grupo volta a ser arquivavel',
  pg_temp.ha_saldo_em_aberto('26000000-0000-0000-0000-00000000e001'), FALSE);

ROLLBACK;
