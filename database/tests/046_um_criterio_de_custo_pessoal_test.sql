-- =====================================================
-- Teste do criterio unico de custo pessoal (046)
-- =====================================================
-- HMO-258. Roda no db-verify, contra o banco que as migrations constroem do
-- zero, na posicao do 046 na cadeia.
--
-- O criterio escolhido na issue em 08/10/2026 e "bruto + reembolso": INTEIRO
-- quando eu paguei, MINHA PARTE quando outro pagou. Na fixture de maio da conta
-- A isso da 1.010,00 -- e "a view devolve 1010" nao prova esta migration.
--
-- A 046 e feita de DUAS mudancas que so funcionam juntas, e cada metade sozinha
-- produz um numero plausivel que ja foi medido em banco:
--
--    920,00  so a metade 2 (perna do grupo filtra paguei_eu, perna pessoal
--            mantem o `group_id IS NULL` da 033): a despesa que EU paguei
--            desaparece inteira -- 500 + 400 + 20
--   1040,00  so a metade 1 (perna pessoal perde o filtro, perna do grupo nao
--            filtra paguei_eu): valor cheio MAIS a minha parte dele -- a dupla
--            contagem que o mutante 2 de mutantes-minha-parte-no-realizado.mjs
--            descreve
--    950,00  a 033 intacta -- "minha parte" dos dois lados, a TERCEIRA
--            convencao sem rotulo que esta issue existe para remover
--    990,00  a perna do grupo descartada -- fluxo de caixa, que e o criterio
--            CERTO de outra leitura (movimentacoes/resumo) e errado aqui
--   1020,00  a polaridade de `paguei_eu` invertida (`WHERE g.paguei_eu`):
--            valor cheio + a minha parte do que eu mesma paguei, e a parte do
--            que a B pagou fora
--
-- Os cinco sao distinguiveis de proposito, e cada um tem um `refute_num`.
--
-- AS SECOES, E POR QUE CADA UMA
-- -----------------------------
--   * SECAO 1 e o criterio na conta A: exige 1.010 e nega os cinco numeros
--     acima. Exigir 1.010 sozinho ficaria vermelho se o numero mudasse, mas nao
--     diria QUAL metade da migration caiu.
--   * SECAO 2 conta transacoes, nao dinheiro. A despesa de grupo que eu paguei
--     muda de perna (saia da perna 2 pela minha parte, passa a vir da perna 1
--     pelo valor cheio) e a contagem tem de ficar IGUAL -- 4. Se as duas pernas
--     a contarem, sai 5, e nenhuma assercao sobre `expense` pega isso: o VALOR
--     de 1.040 e o que denuncia a dupla contagem no dinheiro, mas a contagem
--     tem defeito proprio -- ela divide o total para dar a media mensal.
--   * SECAO 3 mede os OUTROS DOIS membros no mesmo mes. `paguei_eu` e por
--     MEMBRO, nao por despesa, e so um segundo pagador prova isso: a B pagou
--     60 e deve 30 do jantar (90,00); a C nao pagou nada e deve as duas partes
--     (50,00). A inversao de polaridade zera a C, e a secao 1 sozinha nao a
--     distingue bem.
--   * SECAO 4 e o RATEIO RECUSADO, e e o unico defeito deste arquivo que nao
--     depende do criterio escolhido: eu pago 200,00 pelo grupo, todo mundo
--     recusa a parte, ninguem me devolve nada -- e no estado anterior a 046 o
--     meu painel mostrava ZERO daquele mes. `group_share_entries` exclui rateio
--     rejected/expired (certo, e deliberado na 033) e o `group_id IS NULL`
--     jogava a despesa fora do lado pessoal: ninguem contava.
--   * SECAO 5 exige que a soma das CATEGORIAS seja igual ao total do mes. A
--     pagina de relatorios mostra uma pizza por categoria e um total; os dois
--     saem de views diferentes (`personal_category_monthly_totals` e
--     `personal_monthly_cash_flow`), e uma pizza que nao fecha no total e o
--     sintoma de ter duas definicoes do mesmo numero.
--   * SECAO 6 e o CONTROLE NEGATIVO da RLS, e ele vale MAIS na 046 do que nas
--     migrations anteriores: a perna pessoal perdeu o `group_id IS NULL`, que
--     antes descartava de graca as linhas dos outros membros -- agora e a RLS, e
--     so ela, que as mantem fora. Sem esta secao todo o resto do arquivo poderia
--     estar medindo superusuario. Ela vem com uma assercao SEPARADA sobre as
--     `reloptions`, e a propria secao explica por que as duas nao sao
--     redundantes: medido, este controle NAO pega a perda do `security_invoker`
--     das views da 046.
--   * SECAO 7 prova que o `eq("user_id")` dos leitores e LOAD-BEARING. Depois
--     da 046 a view devolve, para quem divide grupo comigo, tambem as linhas
--     DELE -- e a RLS permite isso desde a 002. A assercao fixa o sintoma para
--     quem escrever o proximo leitor: sem filtrar user_id o total vem MAIOR.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 046:
--   psql "$DB_URL" -f database/tests/046_um_criterio_de_custo_pessoal_test.sql
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
-- numero errado apareceu -- e os numeros errados desta feature foram medidos em
-- banco, um por um.
CREATE OR REPLACE FUNCTION pg_temp.refute_num(label TEXT, got NUMERIC, forbidden NUMERIC, porque TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS NOT DISTINCT FROM forbidden THEN
    RAISE EXCEPTION 'FALHA: % -> obtido %, que e exatamente %', label, forbidden, porque;
  END IF;
  RAISE NOTICE 'ok: % (nao e %)', label, forbidden;
END $$;

-- Comparacao "maior que", para a secao 7. O numero exato do vazamento nao
-- importa e nao deve ser travado: o que precisa ficar preso e a DIRECAO.
CREATE OR REPLACE FUNCTION pg_temp.expect_maior(label TEXT, got NUMERIC, piso NUMERIC)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS NULL OR got <= piso THEN
    RAISE EXCEPTION 'FALHA: % -> esperado MAIOR que %, obtido %', label, piso, got;
  END IF;
  RAISE NOTICE 'ok: % (% > %)', label, got, piso;
END $$;

-- =====================================================
-- Fixture: maio/2026 da conta A da HMO-255, tres membros
-- =====================================================
--   mercado       500,00  so da A
--   combustivel   400,00  so da A
--   jantar         90,00  pago pela A, grupo de 3  -> a parte dela e 30,00
--   mercado grupo  60,00  pago pela B, grupo de 3  -> a parte dela e 20,00
--
-- Pelo criterio da 046 a A fecha 500 + 400 + 90 + 20 = 1.010,00; a B fecha
-- 60 + 30 = 90,00; a C, que nao pagou nada, fecha 30 + 20 = 50,00.
--
-- E JULHO, que e a secao 4: a A paga 200,00 pelo grupo e os tres rateios sao
-- recusados. Mes separado de proposito -- recusar o rateio do jantar mudaria os
-- numeros da secao 1 e as duas medicoes ficariam amarradas uma na outra.

INSERT INTO auth.users (id, email) VALUES
  ('a4600000-0000-0000-0000-0000000000a1', 'a-046@teste.local'),
  ('a4600000-0000-0000-0000-0000000000b1', 'b-046@teste.local'),
  ('a4600000-0000-0000-0000-0000000000c1', 'c-046@teste.local'),
  -- Dora NAO entra em grupo nenhum: e o controle negativo da secao 6.
  ('a4600000-0000-0000-0000-0000000000d1', 'dora-046@teste.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('a4600000-0000-0000-0000-0000000000a1', 'A 046',    FALSE),
  ('a4600000-0000-0000-0000-0000000000b1', 'B 046',    FALSE),
  ('a4600000-0000-0000-0000-0000000000c1', 'C 046',    FALSE),
  ('a4600000-0000-0000-0000-0000000000d1', 'Dora 046', FALSE);

INSERT INTO public.expense_groups (id, name, created_by) VALUES
  ('94600000-0000-0000-0000-000000000001', 'Casa 046',
   'a4600000-0000-0000-0000-0000000000a1');

-- A entra como admin pelo trigger add_group_creator; B e C entram aqui.
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('94600000-0000-0000-0000-000000000001',
   'a4600000-0000-0000-0000-0000000000b1', 'member', 'active'),
  ('94600000-0000-0000-0000-000000000001',
   'a4600000-0000-0000-0000-0000000000c1', 'member', 'active');

INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance) VALUES
  ('f4600000-0000-0000-0000-0000000000a1', 'a4600000-0000-0000-0000-0000000000a1',
   'Conta A', 'checking', 10000),
  ('f4600000-0000-0000-0000-0000000000b1', 'a4600000-0000-0000-0000-0000000000b1',
   'Conta B', 'checking', 10000),
  ('f4600000-0000-0000-0000-0000000000d1', 'a4600000-0000-0000-0000-0000000000d1',
   'Conta Dora', 'checking', 10000);

-- `amount` NEGATIVO, como o app grava. O trigger do 001/042 cria as tres partes
-- de cada despesa de grupo sozinho -- nada aqui escreve rateio.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type)
SELECT v.id, v.user_id, v.account_id, c.service_id, c.id, v.group_id,
       v.description, v.amount, v.transaction_date, 'expense'
  FROM (VALUES
    ('74600000-0000-0000-0000-000000000001'::uuid,
     'a4600000-0000-0000-0000-0000000000a1'::uuid,
     'f4600000-0000-0000-0000-0000000000a1'::uuid,
     NULL::uuid, 'Mercado', -500.00::numeric, DATE '2026-05-05'),
    ('74600000-0000-0000-0000-000000000002',
     'a4600000-0000-0000-0000-0000000000a1',
     'f4600000-0000-0000-0000-0000000000a1',
     NULL, 'Combustivel', -400.00, DATE '2026-05-08'),
    ('74600000-0000-0000-0000-000000000003',
     'a4600000-0000-0000-0000-0000000000a1',
     'f4600000-0000-0000-0000-0000000000a1',
     '94600000-0000-0000-0000-000000000001', 'Jantar do grupo',
     -90.00, DATE '2026-05-12'),
    ('74600000-0000-0000-0000-000000000004',
     'a4600000-0000-0000-0000-0000000000b1',
     'f4600000-0000-0000-0000-0000000000b1',
     '94600000-0000-0000-0000-000000000001', 'Mercado do grupo',
     -60.00, DATE '2026-05-20'),
    -- JULHO, a SECAO 4: a A paga 200,00 pelo grupo e ninguem aceita a parte.
    ('74600000-0000-0000-0000-000000000005',
     'a4600000-0000-0000-0000-0000000000a1',
     'f4600000-0000-0000-0000-0000000000a1',
     '94600000-0000-0000-0000-000000000001', 'Conserto do telhado (julho)',
     -200.00, DATE '2026-07-09'),
    -- A Dora gasta sozinha, para o controle negativo medir uma conta VIVA. Uma
    -- conta vazia veria zero de qualquer jeito, e o controle seria vacuo.
    ('74600000-0000-0000-0000-000000000006',
     'a4600000-0000-0000-0000-0000000000d1',
     'f4600000-0000-0000-0000-0000000000d1',
     NULL, 'Farmacia da Dora', -77.00, DATE '2026-05-14')
  ) AS v(id, user_id, account_id, group_id, description, amount, transaction_date),
  LATERAL (SELECT tc.id, tc.service_id FROM public.transaction_categories tc
            WHERE tc.is_expense ORDER BY tc.id LIMIT 1) AS c;

-- A SECAO 4 depende disto: o conserto do telhado nasce com tres partes
-- 'pending' (o trigger) e aqui TODAS passam a 'rejected'. Nenhuma delas conta
-- em `group_share_entries`, que exclui rejected/expired.
UPDATE public.group_expense_splits es SET status = 'rejected'
 WHERE es.group_transaction_id IN (
   SELECT gt.id FROM public.group_transactions gt
    WHERE gt.transaction_id = '74600000-0000-0000-0000-000000000005');

-- A fixture so vale se o rateio existir de verdade. Sem isto, todo numero deste
-- arquivo poderia ser "o trigger nao rodou" em vez de "a view nao conta".
SELECT pg_temp.expect('o jantar nasceu com 3 partes',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '74600000-0000-0000-0000-000000000003'), 3);

SELECT pg_temp.expect_num('a parte da A no jantar e 30,00 e esta POSITIVA',
  (SELECT es.amount FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
     JOIN public.group_members em ON em.id = es.member_id
    WHERE gt.transaction_id = '74600000-0000-0000-0000-000000000003'
      AND em.user_id = 'a4600000-0000-0000-0000-0000000000a1'), 30.00);

SELECT pg_temp.expect_num('a parte da A no mercado da B e 20,00',
  (SELECT es.amount FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
     JOIN public.group_members em ON em.id = es.member_id
    WHERE gt.transaction_id = '74600000-0000-0000-0000-000000000004'
      AND em.user_id = 'a4600000-0000-0000-0000-0000000000a1'), 20.00);

SELECT pg_temp.expect('as tres partes do telhado de julho estao rejected',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '74600000-0000-0000-0000-000000000005'
      AND es.status = 'rejected'), 3);

-- `paguei_eu` entrou no GRAO do rollup (secao 1 da migration). Sem esta
-- assercao, a perna 2 filtrando uma coluna que nao existe seria erro de SQL --
-- mas a coluna existindo com o grao ERRADO (agregada antes de filtrar) passaria
-- calada, e e esse o estado que precisa ficar preso.
SELECT pg_temp.expect('group_share_category_monthly_totals tem a coluna paguei_eu',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'group_share_category_monthly_totals'
      AND column_name = 'paguei_eu'), 1);

-- =====================================================
-- SECAO 1: o criterio escolhido, na conta A
-- =====================================================
-- 500 (mercado) + 400 (combustivel) + 90 (jantar que ELA pagou, INTEIRO)
-- + 20 (a parte dela do mercado que a B pagou) = 1.010,00.

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a4600000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect_num('o custo pessoal da A em maio e 1.010,00',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a4600000-0000-0000-0000-0000000000a1'
      AND month = DATE '2026-05-01'), 1010.00);

SELECT pg_temp.refute_num('o custo pessoal da A em maio',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a4600000-0000-0000-0000-0000000000a1'
      AND month = DATE '2026-05-01'), 920.00,
  'a metade 1 da 046 nao aplicada: o jantar que ELA pagou desapareceu (500+400+20)');

SELECT pg_temp.refute_num('o custo pessoal da A em maio',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a4600000-0000-0000-0000-0000000000a1'
      AND month = DATE '2026-05-01'), 1040.00,
  'a metade 2 da 046 nao aplicada: valor cheio MAIS a minha parte dele (dupla contagem)');

SELECT pg_temp.refute_num('o custo pessoal da A em maio',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a4600000-0000-0000-0000-0000000000a1'
      AND month = DATE '2026-05-01'), 950.00,
  'a 033 intacta -- "minha parte" dos dois lados, a terceira convencao sem rotulo');

SELECT pg_temp.refute_num('o custo pessoal da A em maio',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a4600000-0000-0000-0000-0000000000a1'
      AND month = DATE '2026-05-01'), 990.00,
  'a perna do grupo descartada -- fluxo de caixa, que e o criterio de OUTRA leitura');

SELECT pg_temp.refute_num('o custo pessoal da A em maio',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a4600000-0000-0000-0000-0000000000a1'
      AND month = DATE '2026-05-01'), 1020.00,
  'a polaridade de paguei_eu invertida: a parte do que a B pagou ficou de fora');

-- =====================================================
-- SECAO 2: a CONTAGEM nao muda -- quatro transacoes
-- =====================================================
-- A despesa de grupo que a A pagou troca de perna: saia da perna 2 (pela parte
-- de 30) e passa a vir da perna 1 (pelos 90 cheios). A contagem tem de ficar
-- em 4 -- mercado, combustivel, jantar e a parte do mercado da B.
--
-- Isto tem defeito PROPRIO, que o dinheiro nao denuncia: a rota divide o total
-- pelos meses com movimento para dar a media mensal. A 033 registrou o caso --
-- um membro que nao pagou nada com a contagem em zero teria o mes dele apagado
-- da media.

SELECT pg_temp.expect('a A tem 4 transacoes contadas em maio',
  (SELECT COALESCE(SUM(transaction_count), 0)::bigint FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a4600000-0000-0000-0000-0000000000a1'
      AND month = DATE '2026-05-01'), 4);

-- =====================================================
-- SECAO 3: os outros dois membros -- `paguei_eu` e por MEMBRO
-- =====================================================
-- A B pagou o mercado de 60 (conta INTEIRO para ela) e deve 30 do jantar: 90,00.
-- A C nao pagou nada e deve as duas partes: 30 + 20 = 50,00.
--
-- So um segundo pagador prova que `paguei_eu` e por MEMBRO e nao por despesa.
-- E a C e quem distingue a inversao de polaridade: com `WHERE g.paguei_eu` ela
-- iria a zero, e a secao 1 sozinha nao separa isso tao bem.

SET LOCAL request.jwt.claim.sub = 'a4600000-0000-0000-0000-0000000000b1';

SELECT pg_temp.expect_num('a B paga o mercado dela inteiro e deve o jantar: 90,00',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a4600000-0000-0000-0000-0000000000b1'
      AND month = DATE '2026-05-01'), 90.00);

SELECT pg_temp.refute_num('o custo pessoal da B em maio',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a4600000-0000-0000-0000-0000000000b1'
      AND month = DATE '2026-05-01'), 50.00,
  'a parte dela no proprio mercado (20) em vez dos 60 que sairam da conta dela');

SET LOCAL request.jwt.claim.sub = 'a4600000-0000-0000-0000-0000000000c1';

SELECT pg_temp.expect_num('a C nao pagou nada e deve as duas partes: 50,00',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a4600000-0000-0000-0000-0000000000c1'
      AND month = DATE '2026-05-01'), 50.00);

SELECT pg_temp.refute_num('o custo pessoal da C em maio',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a4600000-0000-0000-0000-0000000000c1'
      AND month = DATE '2026-05-01'), 0.00,
  'a polaridade de paguei_eu invertida: quem nao pagou nada perde o mes inteiro');

SELECT pg_temp.expect('a C tem 2 transacoes contadas em maio',
  (SELECT COALESCE(SUM(transaction_count), 0)::bigint FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a4600000-0000-0000-0000-0000000000c1'
      AND month = DATE '2026-05-01'), 2);

-- =====================================================
-- SECAO 4: rateio RECUSADO -- o unico defeito que nao depende do criterio
-- =====================================================
-- Em julho a A pagou 200,00 pelo grupo e os tres rateios foram recusados:
-- ninguem lhe devolve nada, logo os 200,00 sao integralmente dela.
--
-- No estado anterior a 046 o painel dela mostrava ZERO naquele mes.
-- `group_share_entries` exclui rateio rejected/expired -- deliberado na 033, e
-- certo -- e o `group_id IS NULL` da perna pessoal jogava a despesa fora do
-- outro lado. As duas decisoes, cada uma defensavel, apagavam dinheiro que saiu
-- da conta dela.
--
-- Isto nao e uma convencao perdendo para outra: dinheiro que eu gastei e que
-- ninguem vai me devolver e minha despesa sob QUALQUER um dos tres criterios
-- que a issue colocou na mesa.

SET LOCAL request.jwt.claim.sub = 'a4600000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect_num('o telhado recusado de julho conta 200,00 para quem pagou',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a4600000-0000-0000-0000-0000000000a1'
      AND month = DATE '2026-07-01'), 200.00);

SELECT pg_temp.refute_num('o telhado recusado de julho',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a4600000-0000-0000-0000-0000000000a1'
      AND month = DATE '2026-07-01'), 0.00,
  'o defeito anterior a 046: rateio recusado apaga do painel o dinheiro de quem pagou');

-- E o outro lado da mesma moeda: quem RECUSOU a parte nao deve nada, e julho
-- dele tem de ficar vazio. Sem esta assercao, "conta para quem pagou" poderia
-- estar contando para todo mundo.
SET LOCAL request.jwt.claim.sub = 'a4600000-0000-0000-0000-0000000000c1';

SELECT pg_temp.expect_num('quem recusou a parte nao tem custo em julho',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a4600000-0000-0000-0000-0000000000c1'
      AND month = DATE '2026-07-01'), 0.00);

-- =====================================================
-- SECAO 5: a pizza fecha no total
-- =====================================================
-- A pagina de relatorios mostra o total do mes e a quebra por categoria, e os
-- dois saem de views diferentes -- `personal_monthly_cash_flow` e
-- `personal_category_monthly_totals`. Uma pizza que nao fecha no total e o
-- sintoma de ter duas definicoes do mesmo numero, e a 046 mexeu nas DUAS.

SET LOCAL request.jwt.claim.sub = 'a4600000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect_num('a soma das categorias e igual ao total do mes',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_category_monthly_totals
    WHERE user_id = 'a4600000-0000-0000-0000-0000000000a1'
      AND month = DATE '2026-05-01')
  - (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
      WHERE user_id = 'a4600000-0000-0000-0000-0000000000a1'
        AND month = DATE '2026-05-01'), 0.00);

-- =====================================================
-- SECAO 6: CONTROLE NEGATIVO da RLS
-- =====================================================
-- A Dora nao divide grupo com ninguem e gastou 77,00 em maio. Ela tem de ver os
-- 77,00 dela e NADA da A.
--
-- Esta secao vale MAIS na 046 do que nas migrations anteriores: a perna pessoal
-- perdeu o `group_id IS NULL`, que antes descartava de graca as linhas de
-- `category_monthly_totals` dos outros. Agora e a RLS -- e so ela -- que mantem
-- o dado de quem nao e do grupo fora daqui.
--
-- A Dora tem gasto PROPRIO de proposito: numa conta vazia ela veria zero de
-- qualquer jeito e o controle seria vacuo.
--
-- O QUE ESTE CONTROLE NAO PEGA, E E PRECISO DIZER
-- ----------------------------------------------
-- Ele NAO pega a perda do `security_invoker` das duas views da 046. Medido:
-- com `personal_category_monthly_totals` como DEFINER, a Dora continua vendo
-- zero -- porque nenhuma das duas views desta migration toca tabela com RLS,
-- as duas leem outras views (`category_monthly_totals` do 008 e
-- `group_share_entries` da 033), que sao INVOKER e e onde a RLS e avaliada. O
-- vazamento so aparece quando a view de BAIXO tambem perde a reloption.
--
-- Por isso a assercao sobre `reloptions` logo abaixo nao e redundante com este
-- controle: as duas medem coisas diferentes, e so a segunda reprova o ALTER
-- apagado. Escrever "o controle negativo cobre a reloption" aqui -- como as
-- migrations irmas podem dizer com razao nos casos delas -- seria duas guardas
-- supostamente redundantes deixando o defeito passar pelas duas.

SET LOCAL request.jwt.claim.sub = 'a4600000-0000-0000-0000-0000000000d1';

SELECT pg_temp.expect_num('a Dora ve o gasto dela (77,00) -- a conta esta viva',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a4600000-0000-0000-0000-0000000000d1'
      AND month = DATE '2026-05-01'), 77.00);

SELECT pg_temp.expect('a Dora nao ve linha nenhuma da A no custo pessoal',
  (SELECT count(*) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a4600000-0000-0000-0000-0000000000a1'), 0);

SELECT pg_temp.expect('a Dora nao ve linha nenhuma da A por categoria',
  (SELECT count(*) FROM public.personal_category_monthly_totals
    WHERE user_id = 'a4600000-0000-0000-0000-0000000000a1'), 0);

SELECT pg_temp.expect('a Dora nao ve parte de rateio do grupo Casa 046',
  (SELECT count(*) FROM public.group_share_category_monthly_totals
    WHERE group_id = '94600000-0000-0000-0000-000000000001'), 0);

-- As reloptions, conferidas direto. O controle negativo acima e quem prova que
-- a RLS funciona de ponta a ponta; esta assercao diz QUAL das duas views caiu
-- quando ele reprovar.
RESET ROLE;

SELECT pg_temp.expect('as duas views da 046 tem security_invoker',
  (SELECT count(*) FROM pg_class c
    WHERE c.oid IN ('public.group_share_category_monthly_totals'::regclass,
                    'public.personal_category_monthly_totals'::regclass)
      AND c.reloptions @> ARRAY['security_invoker=true']), 2);

-- =====================================================
-- SECAO 7: o `eq("user_id")` do leitor e LOAD-BEARING
-- =====================================================
-- Depois da 046 a perna pessoal nao filtra mais `group_id`, e a policy de
-- SELECT de `financial_transactions` (002) e `user_id = auth.uid() OR (group_id
-- IS NOT NULL AND is_group_member(group_id))`. Entao, para quem divide grupo
-- comigo, a view devolve tambem as despesas de GRUPO dele -- cada uma na linha
-- do `user_id` de quem pagou.
--
-- Isso nao vaza nada que a RLS ja nao permitisse (e assim que a tela do grupo
-- funciona desde a 002) e nao entra no meu total enquanto o leitor filtrar
-- user_id. Os tres leitores filtram, e o codigo diz que isso e load-bearing.
--
-- A assercao fixa o SINTOMA para quem escrever o proximo leitor: sem o filtro o
-- total vem MAIOR. O valor exato do vazamento nao e travado de proposito -- ele
-- depende de quantos membros o grupo tem, e travar o numero faria esta assercao
-- quebrar ao mudar a fixture em vez de ao mudar a regra.

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a4600000-0000-0000-0000-0000000000c1';

SELECT pg_temp.expect_num('a C, FILTRANDO user_id, ve o custo dela: 50,00',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a4600000-0000-0000-0000-0000000000c1'
      AND month = DATE '2026-05-01'), 50.00);

SELECT pg_temp.expect_maior('a C, SEM filtrar user_id, soma tambem o dos outros',
  (SELECT COALESCE(SUM(expense), 0) FROM public.personal_monthly_cash_flow
    WHERE month = DATE '2026-05-01'), 50.00);

RESET ROLE;

DO $$ BEGIN RAISE NOTICE '046: todas as assercoes passaram'; END $$;

ROLLBACK;
