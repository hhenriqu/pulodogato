-- =====================================================
-- Teste da divisao combinada de despesa de grupo (HMO-190)
-- =====================================================
-- "Verifique se as opcoes de divisao dos grupos estao funcionando
-- corretamente." Nao estavam: escolher "Por Percentual", "Customizada",
-- "Divisao Proporcional" ou a sugestao historica gravava CINQUENTA POR CENTO
-- PARA CADA UM, sem erro nenhum na tela.
--
-- A 007 ja tinha consertado o banco: `calculate_equal_split` devolve NEW
-- intacto quando `group_transactions.split_type <> 'equal'`. O defeito que
-- sobrou e inteiro da camada do app, e tem DOIS lados -- este arquivo prova os
-- dois pelo lado do banco, que e onde o dinheiro errado fica gravado:
--
--   SECAO 1  O estado em que o trigger deixa a despesa: split_type = 'equal'
--            e partes iguais. E deste estado que o app parte.
--
--   SECAO 2  O SINTOMA. Gravar 70/30 SEM antes trocar o split_type -- que e o
--            que o app fazia, porque `temSplitsCustomizados` lia `body.splits`
--            e o cliente mandava `custom_splits`, entao o bloco inteiro era
--            pulado -- deixa 50/50. O `calculate_equal_split` reescreve a
--            parte no BEFORE INSERT. Ninguem ve erro.
--
--   SECAO 3  O OUTRO LADO, independente do primeiro: os tipos que a tela
--            oferece nao cabem na coluna. `split-suggestions` devolve
--            `equal | proportional | historical`, e o CHECK de
--            group_transactions aceita so `equal | percentage | custom`.
--            Entao, mesmo com o nome do campo certo, "Divisao Proporcional"
--            tomaria 23514 no UPDATE -- que a rota nao conferia -- e cairia no
--            sintoma da SECAO 2 de novo.
--
--   SECAO 4  O CONTROLE POSITIVO: trocar o split_type ANTES de inserir grava
--            70/30 de verdade. E o que prova que o banco sempre soube fazer a
--            divisao combinada, e que a correcao e a da camada do app
--            (lib/divisao-do-grupo.ts + a rota de transacoes do grupo).
--
--   SECAO 5  A soma tem que fechar: 70/30 de R$ 300 soma R$ 300. Divisao que
--            nao soma o total deixa saldo residual que pagamento nenhum zera
--            (a mesma familia de defeito da SECAO 3b da 007), e e por isso que
--            `partesParaGravar` recusa 70/20 ANTES de gravar.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 032:
--   psql "$DB_URL" -f database/tests/hmo190_divisao_combinada_test.sql
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

-- =====================================================
-- Fixture: a Casa de dois, que e o caso do relato
-- =====================================================
-- Helio e Leticia dividem a Casa. Dois membros e de proposito: com dois, a
-- divisao igual da 50/50, e 50/50 e visivelmente diferente de 70/30 -- o
-- sintoma fica legivel na assercao. Com tres o arredondamento entraria na
-- conversa e nao e disso que este arquivo trata.
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-1900-0000-0000-00000000a001', 'helio@casa.local'),
  ('bbbbbbbb-1900-0000-0000-00000000b001', 'leticia@casa.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('aaaaaaaa-1900-0000-0000-00000000a001', 'Helio',   FALSE),
  ('bbbbbbbb-1900-0000-0000-00000000b001', 'Leticia', FALSE);

-- `default_split_type = 'percentage'` no GRUPO: o relato e de quem configurou
-- a divisao e viu partes iguais. Esta coluna nunca chegou a importar para o
-- rateio -- quem manda e `group_transactions.split_type` -- e e exatamente
-- essa a armadilha que a tela escondia.
INSERT INTO public.expense_groups (id, name, created_by, default_split_type) VALUES
  ('99999999-1900-0000-0000-000000000001', 'Casa', 'aaaaaaaa-1900-0000-0000-00000000a001', 'percentage');

INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('99999999-1900-0000-0000-000000000001', 'bbbbbbbb-1900-0000-0000-00000000b001', 'member', 'active');

INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance) VALUES
  ('f1900000-0000-0000-0000-0000000000a1', 'aaaaaaaa-1900-0000-0000-00000000a001', 'Conta Helio', 'checking', 5000);

-- =====================================================
-- 1. De onde o app parte: o trigger ja deixou 50/50
-- =====================================================
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type)
SELECT '71900000-0000-0000-0000-0000000000a1',
       'aaaaaaaa-1900-0000-0000-00000000a001',
       'f1900000-0000-0000-0000-0000000000a1',
       c.service_id, c.id, '99999999-1900-0000-0000-000000000001',
       'Aluguel', -300.00, CURRENT_DATE, 'expense'
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

SELECT pg_temp.expect_text('o trigger grava split_type = equal, e nao o do grupo',
  (SELECT gt.split_type FROM public.group_transactions gt
    WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000a1'), 'equal');

SELECT pg_temp.expect('o aluguel nasceu com 2 partes',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000a1'), 2);

SELECT pg_temp.expect_num('e cada parte e de R$ 150 (50/50)',
  (SELECT DISTINCT es.amount FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000a1'), 150.00);

-- =====================================================
-- 2. O SINTOMA: 70/30 gravado sem trocar o split_type volta 50/50
-- =====================================================
-- Esta e a sequencia que a rota executava quando o cliente mandava
-- `custom_splits`: o `if` nao entrava, entao o split_type ficava 'equal'. Aqui
-- a sequencia esta escrita com o DELETE e o INSERT acontecendo (o caso em que
-- so o UPDATE do split_type falta), porque e o resultado em dinheiro que
-- interessa: mesmo gravando 210/90 explicitamente, o BEFORE INSERT achata.
DELETE FROM public.group_expense_splits es
 USING public.group_transactions gt
 WHERE gt.id = es.group_transaction_id
   AND gt.transaction_id = '71900000-0000-0000-0000-0000000000a1';

INSERT INTO public.group_expense_splits
  (group_transaction_id, member_id, percentage, amount, status)
SELECT gt.id, gm.id,
       CASE WHEN gm.user_id = 'aaaaaaaa-1900-0000-0000-00000000a001' THEN 70 ELSE 30 END,
       CASE WHEN gm.user_id = 'aaaaaaaa-1900-0000-0000-00000000a001' THEN 210.00 ELSE 90.00 END,
       'pending'
  FROM public.group_transactions gt
  JOIN public.group_members gm ON gm.group_id = gt.group_id
 WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000a1'
   AND gm.status = 'active';

SELECT pg_temp.expect('o 70/30 pedido sumiu: nenhuma parte de R$ 210',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000a1'
      AND es.amount = 210.00), 0);

SELECT pg_temp.expect('e as duas partes voltaram a ser iguais',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000a1'
      AND es.amount = 150.00), 2);

-- =====================================================
-- 3. O outro lado: os tipos da tela nao cabem na coluna
-- =====================================================
-- `/api/expense-groups/[groupId]/split-suggestions` devolve
-- `type: 'equal' | 'proportional' | 'historical'`, e era esse valor que ia
-- cru para o UPDATE do split_type. Provado sobre VALUES, sem precisar de uma
-- linha ruim no banco: quem recusa e o CHECK.
SELECT pg_temp.expect_text('proportional NAO cabe no split_type',
  (SELECT CASE WHEN 'proportional' = ANY (ARRAY['equal','percentage','custom'])
               THEN 'cabe' ELSE 'recusado' END), 'recusado');

SELECT pg_temp.expect_text('historical NAO cabe no split_type',
  (SELECT CASE WHEN 'historical' = ANY (ARRAY['equal','percentage','custom'])
               THEN 'cabe' ELSE 'recusado' END), 'recusado');

-- E o CHECK de verdade, na tabela de verdade: 23514. Sem o bloco EXCEPTION o
-- teste inteiro abortaria aqui -- o que se quer e provar que ele ABORTA.
DO $$
DECLARE
  v_erro TEXT := 'nenhum';
BEGIN
  BEGIN
    UPDATE public.group_transactions
       SET split_type = 'proportional'
     WHERE transaction_id = '71900000-0000-0000-0000-0000000000a1';
  EXCEPTION WHEN check_violation THEN
    v_erro := SQLSTATE;
  END;

  IF v_erro <> '23514' THEN
    RAISE EXCEPTION 'FALHA: UPDATE para proportional deveria dar 23514, deu %', v_erro;
  END IF;
  RAISE NOTICE 'ok: o UPDATE para proportional da 23514 (CHECK da coluna)';
END $$;

SELECT pg_temp.expect_text('e o split_type continua equal depois do 23514',
  (SELECT gt.split_type FROM public.group_transactions gt
    WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000a1'), 'equal');

-- =====================================================
-- 4. CONTROLE POSITIVO: na ordem certa, o 70/30 sobrevive
-- =====================================================
-- A unica diferenca em relacao a SECAO 2 e o UPDATE vir ANTES do INSERT, com
-- um valor que cabe na coluna ('percentage', que e onde `proportional` e
-- `historical` precisam ser traduzidos). Sem esta secao, o teste provaria que
-- a divisao combinada e impossivel -- e ela nao e.
UPDATE public.group_transactions
   SET split_type = 'percentage'
 WHERE transaction_id = '71900000-0000-0000-0000-0000000000a1';

DELETE FROM public.group_expense_splits es
 USING public.group_transactions gt
 WHERE gt.id = es.group_transaction_id
   AND gt.transaction_id = '71900000-0000-0000-0000-0000000000a1';

INSERT INTO public.group_expense_splits
  (group_transaction_id, member_id, percentage, amount, status)
SELECT gt.id, gm.id,
       CASE WHEN gm.user_id = 'aaaaaaaa-1900-0000-0000-00000000a001' THEN 70 ELSE 30 END,
       CASE WHEN gm.user_id = 'aaaaaaaa-1900-0000-0000-00000000a001' THEN 210.00 ELSE 90.00 END,
       'pending'
  FROM public.group_transactions gt
  JOIN public.group_members gm ON gm.group_id = gt.group_id
 WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000a1'
   AND gm.status = 'active';

SELECT pg_temp.expect_num('quem combinou 70% paga R$ 210',
  (SELECT es.amount FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
     JOIN public.group_members gm ON gm.id = es.member_id
    WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000a1'
      AND gm.user_id = 'aaaaaaaa-1900-0000-0000-00000000a001'), 210.00);

SELECT pg_temp.expect_num('e quem combinou 30% paga R$ 90',
  (SELECT es.amount FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
     JOIN public.group_members gm ON gm.id = es.member_id
    WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000a1'
      AND gm.user_id = 'bbbbbbbb-1900-0000-0000-00000000b001'), 90.00);

-- A NEGACAO explicita: nao sobrou nenhuma parte igual. Sem esta assercao, uma
-- correcao que gravasse 210/90 E TAMBEM deixasse as partes velhas de R$ 150
-- passaria nas duas assercoes acima.
SELECT pg_temp.expect('e nao sobrou parte de R$ 150 nenhuma',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000a1'
      AND es.amount = 150.00), 0);

-- =====================================================
-- 5. A soma das partes e o valor da despesa
-- =====================================================
-- O que `partesParaGravar` recusa antes de gravar. Aqui a assercao e sobre o
-- estado BOM (70/30 soma 300): e o invariante que o acerto de contas do grupo
-- precisa para fechar em zero.
SELECT pg_temp.expect_num('as partes somam a despesa inteira',
  (SELECT SUM(es.amount) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000a1'), 300.00);

SELECT pg_temp.expect_num('e as porcentagens somam 100',
  (SELECT SUM(es.percentage) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000a1'), 100.00);

-- =====================================================
-- 6. A RLS: por que a ordem de escrita da rota teve que mudar
-- =====================================================
-- As secoes acima rodaram como superusuario, que fura a RLS. A divisao
-- combinada e lancada por QUALQUER membro, e a Leticia do relato nao e admin
-- do grupo -- quem criou a Casa foi o Helio. E a policy de DELETE de
-- group_expense_splits exige is_group_admin:
--
--   group_expense_splits_delete  USING (EXISTS (... is_group_admin(gt.group_id)))
--
-- Entao a sequencia "deixa o trigger criar o rateio igual, depois APAGA e
-- insere o combinado" -- que e a que a rota tinha escrita -- nao apaga nada
-- para quem nao e admin. E DELETE barrado por RLS nao da erro: afeta zero
-- linhas, em silencio. O INSERT seguinte ACRESCENTA as partes combinadas as
-- partes iguais que continuaram la, e a despesa passa a ser cobrada duas
-- vezes.
--
-- A SECAO 6a mede esse dobro, e a 6b prova a ordem nova (grupo entra DEPOIS,
-- num UPDATE), que nunca precisa apagar parte nenhuma e por isso funciona com
-- a RLS de um membro comum.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-1900-0000-0000-00000000b001';

SELECT pg_temp.expect_text('a Leticia NAO e admin da Casa',
  (SELECT CASE WHEN public.is_group_admin('99999999-1900-0000-0000-000000000001')
               THEN 'admin' ELSE 'membro comum' END), 'membro comum');

-- ---------------------------------------------------------------
-- 6a. A ORDEM ANTIGA, pela RLS dela: cobranca em dobro
-- ---------------------------------------------------------------
-- Mercado de R$ 200 lancado pela Leticia COM group_id, como a rota fazia.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type, is_shared)
SELECT '71900000-0000-0000-0000-0000000000b1',
       'bbbbbbbb-1900-0000-0000-00000000b001',
       c.service_id, c.id, '99999999-1900-0000-0000-000000000001',
       'Mercado', -200.00, CURRENT_DATE, 'expense', TRUE
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

SELECT pg_temp.expect('o trigger ja criou as 2 partes iguais do mercado',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000b1'), 2);

-- O DELETE que a rota fazia. Sem erro, e sem efeito.
DELETE FROM public.group_expense_splits es
 USING public.group_transactions gt
 WHERE gt.id = es.group_transaction_id
   AND gt.transaction_id = '71900000-0000-0000-0000-0000000000b1';

SELECT pg_temp.expect('o DELETE da rota apagou ZERO partes (RLS, sem erro)',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000b1'), 2);

UPDATE public.group_transactions SET split_type = 'percentage'
 WHERE transaction_id = '71900000-0000-0000-0000-0000000000b1';

INSERT INTO public.group_expense_splits
  (group_transaction_id, member_id, percentage, amount, status)
SELECT gt.id, gm.id,
       CASE WHEN gm.user_id = 'bbbbbbbb-1900-0000-0000-00000000b001' THEN 80 ELSE 20 END,
       CASE WHEN gm.user_id = 'bbbbbbbb-1900-0000-0000-00000000b001' THEN 160.00 ELSE 40.00 END,
       'pending'
  FROM public.group_transactions gt
  JOIN public.group_members gm ON gm.group_id = gt.group_id
 WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000b1'
   AND gm.status = 'active';

SELECT pg_temp.expect('a ordem antiga deixa 4 partes onde cabem 2',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000b1'), 4);

-- O numero que importa: a despesa foi de R$ 200 e o grupo cobra R$ 400.
SELECT pg_temp.expect_num('e cobra R$ 400 de uma despesa de R$ 200',
  (SELECT SUM(es.amount) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000b1'), 400.00);

-- ---------------------------------------------------------------
-- 6b. A ORDEM NOVA: grupo por ultimo, nenhum DELETE
-- ---------------------------------------------------------------
-- 1) a despesa nasce SEM group_id, entao refazer_rateio_do_grupo ve v_alvo
--    NULL e nao cria rateio nenhum;
-- 2) a rota cria a ligacao com o split_type ja certo (policy de INSERT pede
--    created_by = auth.uid() e ser membro -- as duas valem para a Leticia);
-- 3) insere as partes combinadas (o BEFORE INSERT devolve NEW intacto porque
--    split_type <> 'equal');
-- 4) so entao grava o group_id. O trigger de UPDATE roda, acha a ligacao que
--    ja existe e nao recria nem recalcula nada -- v_mudou_valor e falso.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, description,
   amount, transaction_date, transaction_type, is_shared)
SELECT '71900000-0000-0000-0000-0000000000b2',
       'bbbbbbbb-1900-0000-0000-00000000b001',
       c.service_id, c.id, 'Farmacia',
       -200.00, CURRENT_DATE, 'expense', TRUE
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

SELECT pg_temp.expect('sem group_id, o trigger nao criou ligacao nenhuma',
  (SELECT count(*) FROM public.group_transactions gt
    WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000b2'), 0);

INSERT INTO public.group_transactions (group_id, transaction_id, split_type, created_by)
VALUES ('99999999-1900-0000-0000-000000000001',
        '71900000-0000-0000-0000-0000000000b2', 'percentage',
        'bbbbbbbb-1900-0000-0000-00000000b001');

INSERT INTO public.group_expense_splits
  (group_transaction_id, member_id, percentage, amount, status)
SELECT gt.id, gm.id,
       CASE WHEN gm.user_id = 'bbbbbbbb-1900-0000-0000-00000000b001' THEN 80 ELSE 20 END,
       CASE WHEN gm.user_id = 'bbbbbbbb-1900-0000-0000-00000000b001' THEN 160.00 ELSE 40.00 END,
       'pending'
  FROM public.group_transactions gt
  JOIN public.group_members gm ON gm.group_id = gt.group_id
 WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000b2'
   AND gm.status = 'active';

UPDATE public.financial_transactions
   SET group_id = '99999999-1900-0000-0000-000000000001'
 WHERE id = '71900000-0000-0000-0000-0000000000b2';

SELECT pg_temp.expect('a ordem nova deixa exatamente 2 partes',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000b2'), 2);

SELECT pg_temp.expect_num('e elas somam a despesa, nao o dobro dela',
  (SELECT SUM(es.amount) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000b2'), 200.00);

SELECT pg_temp.expect_num('quem combinou 80% paga R$ 160, pela RLS de membro comum',
  (SELECT es.amount FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
     JOIN public.group_members gm ON gm.id = es.member_id
    WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000b2'
      AND gm.user_id = 'bbbbbbbb-1900-0000-0000-00000000b001'), 160.00);

SELECT pg_temp.expect_num('e o outro membro paga os 20% restantes',
  (SELECT es.amount FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
     JOIN public.group_members gm ON gm.id = es.member_id
    WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000b2'
      AND gm.user_id = 'aaaaaaaa-1900-0000-0000-00000000a001'), 40.00);

-- A NEGACAO que separa "funcionou" de "ficou igual": nenhuma parte de R$ 100,
-- que e o que a divisao igual de R$ 200 entre dois teria gravado.
SELECT pg_temp.expect('e nao ha parte de R$ 100 (a divisao igual nao venceu)',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000b2'
      AND es.amount = 100.00), 0);

SELECT pg_temp.expect_text('e o split_type gravado e percentage',
  (SELECT gt.split_type FROM public.group_transactions gt
    WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000b2'), 'percentage');

-- Uma ligacao so: a ordem nova nao pode deixar duas linhas em
-- group_transactions para a mesma despesa (nao ha indice unico que impeca, e
-- duas ligacoes cobrariam a despesa duas vezes por outro caminho).
SELECT pg_temp.expect('e UMA ligacao de grupo, nao duas',
  (SELECT count(*) FROM public.group_transactions gt
    WHERE gt.transaction_id = '71900000-0000-0000-0000-0000000000b2'), 1);

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

ROLLBACK;
