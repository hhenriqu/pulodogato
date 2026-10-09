-- =====================================================
-- Teste do consumo de orcamento com despesa de grupo (049)
-- =====================================================
-- HMO-347. Roda no db-verify, contra o banco que as migrations constroem do
-- zero, na posicao do 049 na cadeia.
--
-- A 049 aplica a `budget_consumption` o criterio que a HMO-258 decidiu em
-- 08/10/2026 -- bruto + reembolso: INTEIRO quando EU paguei, MINHA PARTE quando
-- OUTRO pagou. Na fixture de maio da conta A, com um teto PESSOAL de 700,00 na
-- categoria do mercado, isso da 610,00 -- e "a view devolve 610" nao prova esta
-- migration.
--
-- A 049 e feita de DUAS mudancas que so funcionam juntas, e cada metade sozinha
-- produz um numero plausivel, medido em banco:
--
--    500,00  a view como a 026 a deixou: despesa de grupo inteira de fora -- o
--            defeito da issue. A barra marca 71% num mes em que o teto ja
--            passou de 80%.
--    590,00  so a metade 1 (a perna do valor cheio perde o group_id IS NULL, e
--            nao existe perna de reembolso): e a leitura de CAIXA, defensavel
--            como pergunta e nao a que foi escolhida.
--    520,00  so a metade 2 (entra o reembolso, a perna cheia continua filtrando
--            group_id IS NULL): a despesa que EU paguei desaparece inteira.
--    640,00  a perna 2 sem o `NOT paguei_eu`: valor cheio MAIS a minha parte
--            dele -- 120 de um jantar de 90, a dupla contagem que a 046 descreve.
--    620,00  a polaridade de `paguei_eu` invertida (`WHERE e.paguei_eu`): entra
--            a minha parte do que eu mesma paguei, sai a do mercado da B.
--    550,00  "minha parte" dos dois lados -- a TERCEIRA convencao, sem rotulo em
--            tela nenhuma, que a 046 tirou de circulacao no painel.
--
-- Os seis sao distinguiveis de proposito, e cada um tem um `refute_num`. Exigir
-- 610 sozinho ficaria vermelho se o numero mudasse, mas nao diria QUAL metade
-- da migration caiu.
--
-- AS SECOES, E POR QUE CADA UMA
-- -----------------------------
--   * SECAO 1 e o criterio no teto PESSOAL: exige 610,00 e nega os seis numeros
--     acima. Leva tambem o `consumption_status`, porque e ele que a pessoa ve --
--     o mesmo mes sai 'ok' na 047 e 'alert' na 049, e um teto que estourou os
--     80% com a barra verde e o relato da issue.
--   * SECAO 2 e o teto de GRUPO, que a 049 NAO muda. Ele soma a viagem inteira
--     (90 + 60 = 150) e a perna do reembolso fica desligada nele: 170 e 180 sao
--     os dois numeros que apareceriam se ela vazasse para ca, e a conta de um
--     teto de grupo que soma "a minha parte" por cima do valor cheio sobe a cada
--     membro novo.
--   * SECAO 3 e a MOEDA, e ela mede as DUAS pernas separadamente. A 026 trouxe a
--     conversao para esta view porque `amount_limit` e um numero em reais; a
--     perna 2 e nova e precisa da mesma conversao, e a cotacao dela vem do JOIN
--     com `financial_transactions`. Uma viagem em dolar com uma despesa paga por
--     mim e outra paga pela B distingue os quatro mundos: 600 (certo), 200 (so a
--     perna 2 converte), 520 (so a perna 1 converte) e 120 (nenhuma).
--   * SECAO 4 sao os RECORTES da perna 2 -- categoria, mes e usuario. Sem eles a
--     perna nova e larga demais e o sintoma e um teto que consome gasto de outra
--     categoria, de outro mes ou de outra pessoa. Cada um tem a sua linha
--     plantada de proposito, fora do recorte.
--   * SECAO 5 e o RATEIO RECUSADO, nos dois sentidos. A parte que eu recusei
--     deixa de ser minha e sai do meu teto; a despesa que EU paguei e que todo
--     mundo recusou continua INTEIRA no meu teto, porque ninguem vai me devolver
--     nada. Os dois saem da mesma linha de codigo (`group_share_entries` exclui
--     rejected/expired) e tem sinais opostos no numero final.
--   * SECAO 6 e o CONTROLE NEGATIVO da RLS, e ele vale mais na 049 do que valia
--     na 026: a view passou a ler `group_share_entries`, que a 033 deixou sem
--     filtro de user_id de proposito. Vem com uma assercao SEPARADA sobre as
--     `reloptions`, porque `CREATE OR REPLACE VIEW` as apaga e o controle pela
--     RLS nao pega isso sozinho (medido na 046).
--
-- Rodar num banco limpo, depois de 001 -> ... -> 049:
--   psql "$DB_URL" -f database/tests/049_consumo_de_orcamento_do_grupo_test.sql
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
-- banco, um por um.
CREATE OR REPLACE FUNCTION pg_temp.refute_num(label TEXT, got NUMERIC, forbidden NUMERIC, porque TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS NOT DISTINCT FROM forbidden THEN
    RAISE EXCEPTION 'FALHA: % -> obtido %, que e exatamente %', label, forbidden, porque;
  END IF;
  RAISE NOTICE 'ok: % (nao e %)', label, forbidden;
END $$;

-- Comparacao "maior que", para a secao 6. O numero exato do vazamento nao
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
-- Fixture
-- =====================================================
-- MAIO/2026, a fixture da conta A da HMO-255 (a mesma do
-- scripts/medidor-hmo258.sql), na categoria Alimentacao:
--
--   mercado       500,00  so da A
--   jantar         90,00  pago pela A, grupo de 3  -> a parte dela e 30,00
--   mercado grupo  60,00  pago pela B, grupo de 3  -> a parte dela e 20,00
--
-- Teto PESSOAL da A: 700,00. Pelo criterio da 049 ela consumiu
-- 500 + 90 + 20 = 610,00 -- 87,14% de 700, logo 'alert' (o limiar padrao e
-- 0,800). Na 047 isso dava 500,00 e 'ok'.
--
-- O teto de 700 nao e decorativo: ele e o que faz o STATUS mudar junto com o
-- numero. Com um teto folgado as duas migrations dariam 'ok' e a secao 1
-- mediria so o `spent`.
--
-- JUNHO/2026 e a secao 3: uma viagem em DOLAR, categoria Lazer.
-- JULHO/2026 e a secao 5: o rateio recusado, categoria Transporte.
--
-- Os ids de servico e categoria sao os do seed de referencia do 001_baseline,
-- escritos por extenso pelo mesmo motivo do teste do 006: o bundle do SQL
-- Editor so traduz o \set ON_ERROR_STOP.
--   servico      8730cd96-d656-4c48-863e-673e1016a832  (personal_finance)
--   Alimentacao  b9db286c-ce4f-4fbe-b0bf-f3133185f90f
--   Transporte   49d97f81-6f07-4e6d-9822-75167b8426b2
--   Lazer        57726de2-7a27-493b-b010-04814a7475c4

INSERT INTO auth.users (id, email) VALUES
  ('a4800000-0000-0000-0000-0000000000a1', 'a-049@teste.local'),
  ('a4800000-0000-0000-0000-0000000000b1', 'b-049@teste.local'),
  ('a4800000-0000-0000-0000-0000000000c1', 'c-049@teste.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('a4800000-0000-0000-0000-0000000000a1', 'A 049', FALSE),
  ('a4800000-0000-0000-0000-0000000000b1', 'B 049', FALSE),
  ('a4800000-0000-0000-0000-0000000000c1', 'C 049', FALSE);

-- Dois grupos: a Casa em BRL e a Viagem em USD. A moeda do grupo e a SUGERIDA
-- a cada despesa (026); o que converte de verdade e a cotacao da linha.
INSERT INTO public.expense_groups (id, name, created_by, currency) VALUES
  ('94800000-0000-0000-0000-000000000001', 'Casa 049',
   'a4800000-0000-0000-0000-0000000000a1', 'BRL'),
  ('94800000-0000-0000-0000-000000000002', 'Viagem 049',
   'a4800000-0000-0000-0000-0000000000a1', 'USD');

-- A entra como admin pelo trigger add_group_creator; B e C entram aqui.
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('94800000-0000-0000-0000-000000000001',
   'a4800000-0000-0000-0000-0000000000b1', 'member', 'active'),
  ('94800000-0000-0000-0000-000000000001',
   'a4800000-0000-0000-0000-0000000000c1', 'member', 'active'),
  ('94800000-0000-0000-0000-000000000002',
   'a4800000-0000-0000-0000-0000000000b1', 'member', 'active'),
  ('94800000-0000-0000-0000-000000000002',
   'a4800000-0000-0000-0000-0000000000c1', 'member', 'active');

INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance) VALUES
  ('f4800000-0000-0000-0000-0000000000a1', 'a4800000-0000-0000-0000-0000000000a1',
   'Conta A', 'checking', 100000),
  ('f4800000-0000-0000-0000-0000000000b1', 'a4800000-0000-0000-0000-0000000000b1',
   'Conta B', 'checking', 100000);

-- ATENCAO AO SINAL: despesa entra NEGATIVA neste banco, e o trigger do 001/042
-- cria as tres partes de cada despesa de grupo sozinho -- nada aqui escreve
-- rateio. Com valores positivos na fixture, um `SUM(t.amount)` sem ABS na perna
-- 1 passaria por este arquivo e devolveria consumo negativo no app, onde o
-- alerta de estouro nunca dispara.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type)
VALUES
  -- MAIO, Alimentacao: o que e so da A
  ('74800000-0000-0000-0000-000000000001',
   'a4800000-0000-0000-0000-0000000000a1', 'f4800000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   NULL, 'Mercado', -500.00, DATE '2026-05-05', 'expense'),
  -- MAIO, Alimentacao: a A pagou pelo grupo -- entra INTEIRA no teto dela
  ('74800000-0000-0000-0000-000000000002',
   'a4800000-0000-0000-0000-0000000000a1', 'f4800000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   '94800000-0000-0000-0000-000000000001', 'Jantar do grupo',
   -90.00, DATE '2026-05-12', 'expense'),
  -- MAIO, Alimentacao: a B pagou -- entra so a PARTE da A (20,00)
  ('74800000-0000-0000-0000-000000000003',
   'a4800000-0000-0000-0000-0000000000b1', 'f4800000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   '94800000-0000-0000-0000-000000000001', 'Mercado do grupo',
   -60.00, DATE '2026-05-20', 'expense'),

  -- SECAO 4, OS TRES RECORTES DA PERNA 2. Cada linha e paga pela B num grupo de
  -- 3 (parte da A = 10,00) e esta FORA de um dos recortes do teto de maio:
  --   categoria errada (Transporte, mesmo mes)
  ('74800000-0000-0000-0000-000000000004',
   'a4800000-0000-0000-0000-0000000000b1', 'f4800000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', '49d97f81-6f07-4e6d-9822-75167b8426b2',
   '94800000-0000-0000-0000-000000000001', 'Uber do grupo (outra categoria)',
   -30.00, DATE '2026-05-22', 'expense'),
  --   mes errado (Alimentacao, abril)
  ('74800000-0000-0000-0000-000000000005',
   'a4800000-0000-0000-0000-0000000000b1', 'f4800000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   '94800000-0000-0000-0000-000000000001', 'Mercado do grupo em abril',
   -30.00, DATE '2026-04-20', 'expense');

-- JUNHO, Lazer, a viagem em DOLAR. A cotacao vai na LINHA (026), e o CHECK
-- `(currency = 'BRL') = (exchange_rate = 1)` obriga a informar as duas.
--   100 USD a 5,00 pagos pela A  -> 500,00 BRL INTEIROS no teto dela
--    60 USD a 5,00 pagos pela B  -> a parte dela e 20 USD = 100,00 BRL
-- Teto de junho: 2.000,00. Esperado: 600,00.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type, currency, exchange_rate)
VALUES
  ('74800000-0000-0000-0000-000000000011',
   'a4800000-0000-0000-0000-0000000000a1', 'f4800000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', '57726de2-7a27-493b-b010-04814a7475c4',
   '94800000-0000-0000-0000-000000000002', 'Hotel (A pagou)',
   -100.00, DATE '2026-06-10', 'expense', 'USD', 5.00000000),
  ('74800000-0000-0000-0000-000000000012',
   'a4800000-0000-0000-0000-0000000000b1', 'f4800000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', '57726de2-7a27-493b-b010-04814a7475c4',
   '94800000-0000-0000-0000-000000000002', 'Museu (B pagou)',
   -60.00, DATE '2026-06-15', 'expense', 'USD', 5.00000000);

-- JULHO, Transporte, o rateio recusado. Mes separado de proposito: recusar o
-- rateio do jantar mudaria os numeros da secao 1 e as duas medicoes ficariam
-- amarradas uma na outra.
--   200,00 pagos pela A, TODAS as partes recusadas -> continua INTEIRA no teto
--                                                    dela (ninguem lhe devolve)
--    99,00 pagos pela B, a parte da A recusada      -> NAO entra no teto dela
-- Teto de julho: 1.000,00. Esperado: 200,00.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type)
VALUES
  ('74800000-0000-0000-0000-000000000021',
   'a4800000-0000-0000-0000-0000000000a1', 'f4800000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', '49d97f81-6f07-4e6d-9822-75167b8426b2',
   '94800000-0000-0000-0000-000000000001', 'Pedagio que o grupo recusou',
   -200.00, DATE '2026-07-10', 'expense'),
  ('74800000-0000-0000-0000-000000000022',
   'a4800000-0000-0000-0000-0000000000b1', 'f4800000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', '49d97f81-6f07-4e6d-9822-75167b8426b2',
   '94800000-0000-0000-0000-000000000001', 'Estacionamento que a A recusou',
   -99.00, DATE '2026-07-12', 'expense');

-- As recusas. `group_share_entries` exclui rejected/expired (033), e e esse
-- unico filtro que produz os dois efeitos opostos da secao 5.
UPDATE public.group_expense_splits es SET status = 'rejected'
  FROM public.group_transactions gt
 WHERE gt.id = es.group_transaction_id
   AND gt.transaction_id = '74800000-0000-0000-0000-000000000021';

UPDATE public.group_expense_splits es SET status = 'rejected'
 WHERE es.group_transaction_id IN (
         SELECT gt.id FROM public.group_transactions gt
          WHERE gt.transaction_id = '74800000-0000-0000-0000-000000000022')
   AND es.member_id IN (
         SELECT em.id FROM public.group_members em
          WHERE em.user_id = 'a4800000-0000-0000-0000-0000000000a1');

-- Os tetos. Tres pessoais da A (maio/junho/julho) e UM de grupo, na mesma
-- categoria e mes do pessoal de maio -- sao dois bolsos diferentes, e e esse
-- par que a secao 2 compara.
INSERT INTO public.budgets (id, user_id, group_id, category_id, month, amount_limit) VALUES
  ('b4800000-0000-0000-0000-000000000001', 'a4800000-0000-0000-0000-0000000000a1',
   NULL, 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', DATE '2026-05-01', 700.00),
  ('b4800000-0000-0000-0000-000000000002', 'a4800000-0000-0000-0000-0000000000a1',
   '94800000-0000-0000-0000-000000000001',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', DATE '2026-05-01', 1000.00),
  ('b4800000-0000-0000-0000-000000000003', 'a4800000-0000-0000-0000-0000000000a1',
   NULL, '57726de2-7a27-493b-b010-04814a7475c4', DATE '2026-06-01', 2000.00),
  ('b4800000-0000-0000-0000-000000000004', 'a4800000-0000-0000-0000-0000000000a1',
   NULL, '49d97f81-6f07-4e6d-9822-75167b8426b2', DATE '2026-07-01', 1000.00),
  -- O teto da B, para o recorte de USUARIO da secao 4. Ele nasce AQUI, e nao na
  -- secao, porque a RLS do 006 recusa `INSERT` de teto alheio -- um teto da B
  -- criado na pele da A estoura "new row violates row-level security policy", o
  -- que se le como defeito da 049 e e a policy do 006 funcionando.
  ('b4800000-0000-0000-0000-000000000007', 'a4800000-0000-0000-0000-0000000000b1',
   NULL, 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', DATE '2026-05-01', 500.00);

-- A fixture nasceu com rateio? Sem isto, todo zero deste arquivo se le como
-- "a view esta errada" quando o trigger e que nao rodou -- e um teste que mede
-- um banco sem rateio fica verde afirmando o contrario do que diz.
SELECT pg_temp.expect('a fixture tem as 3 partes do jantar de 90',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '74800000-0000-0000-0000-000000000002'), 3);

SELECT pg_temp.expect_num('a parte da A no mercado de 60 da B e 20,00',
  (SELECT es.amount FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
     JOIN public.group_members em      ON em.id = es.member_id
    WHERE gt.transaction_id = '74800000-0000-0000-0000-000000000003'
      AND em.user_id = 'a4800000-0000-0000-0000-0000000000a1'), 20.00);

-- Tudo o que segue roda como `authenticated`, na pele da A. Sem isto o arquivo
-- mediria superusuario, e a secao 6 nao teria do que ser controle.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a4800000-0000-0000-0000-0000000000a1';

-- =====================================================
-- 1. O teto PESSOAL: bruto + reembolso
-- =====================================================
SELECT pg_temp.expect_num('teto pessoal de maio consumiu 610,00 (500 + 90 que EU paguei + 20 da parte do mercado da B)',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000001'), 610.00);

SELECT pg_temp.refute_num('nao e o 500 de antes da 049',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000001'),
  500.00, 'a despesa de grupo inteira de fora -- o defeito da HMO-347');

SELECT pg_temp.refute_num('nao e 590 (so a metade 1: a leitura de caixa)',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000001'),
  590.00, 'o valor cheio sem a perna do reembolso');

SELECT pg_temp.refute_num('nao e 520 (so a metade 2: a perna cheia ainda filtra group_id IS NULL)',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000001'),
  520.00, 'a despesa que EU paguei desaparecendo inteira');

SELECT pg_temp.refute_num('nao e 640 (perna 2 sem o NOT paguei_eu)',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000001'),
  640.00, 'o valor cheio MAIS a minha parte dele -- 120 de um jantar de 90');

SELECT pg_temp.refute_num('nao e 620 (polaridade de paguei_eu invertida)',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000001'),
  620.00, 'a minha parte do que EU paguei entrando, e a do mercado da B saindo');

SELECT pg_temp.refute_num('nao e 550 (minha parte dos dois lados)',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000001'),
  550.00, 'a TERCEIRA convencao, sem rotulo em tela nenhuma, que a 046 removeu');

-- O que a pessoa ve. 610/700 = 87,14%, acima do limiar padrao de 0,800: a barra
-- que na 047 estava VERDE acende. Esta assercao e a issue inteira em uma linha.
SELECT pg_temp.expect_num('consumed_ratio de maio e 0,8714',
  (SELECT consumed_ratio FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000001'), 0.8714);

SELECT pg_temp.expect_text('o status de maio e alert (antes da 049 era ok)',
  (SELECT consumption_status FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000001'), 'alert');

SELECT pg_temp.expect_num('remaining de maio e 90,00',
  (SELECT remaining FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000001'), 90.00);

-- =====================================================
-- 2. O teto de GRUPO nao muda, e a perna do reembolso fica desligada nele
-- =====================================================
-- 90 (a A pagou) + 60 (a B pagou) = 150,00. Nenhuma parte entra aqui: o teto da
-- Casa pergunta quanto a CASA gastou, e as partes ja somam o valor cheio.
SELECT pg_temp.expect_num('teto da Casa soma a viagem inteira: 150,00',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000002'), 150.00);

SELECT pg_temp.refute_num('a perna do reembolso nao vazou para o teto de grupo (170)',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000002'),
  170.00, 'o valor cheio mais a parte da A no que a B pagou');

SELECT pg_temp.refute_num('a perna do reembolso nao vazou SEM filtro de paguei_eu (180)',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000002'),
  180.00, 'o valor cheio mais as duas partes da A -- a barra da viagem subindo a cada membro');

-- =====================================================
-- 3. A MOEDA: as duas pernas convertem, cada uma pela cotacao da sua linha
-- =====================================================
-- 100 USD a 5,00 que a A pagou = 500,00 BRL inteiros.
--  20 USD de parte no que a B pagou = 100,00 BRL.
SELECT pg_temp.expect_num('teto de junho em BRL: 600,00 de uma viagem em dolar',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000003'), 600.00);

SELECT pg_temp.refute_num('a perna 1 converte (senao 200)',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000003'),
  200.00, '100 USD contados como 100 BRL, com a perna 2 convertendo certo');

SELECT pg_temp.refute_num('a perna 2 converte (senao 520)',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000003'),
  520.00, '20 USD de parte contados como 20 BRL, com a perna 1 convertendo certo');

SELECT pg_temp.refute_num('nenhuma das duas esquece a cotacao (senao 120)',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000003'),
  120.00, 'a viagem inteira somada em dolar dentro de um teto em reais');

-- =====================================================
-- 4. Os RECORTES da perna 2: categoria, mes e usuario
-- =====================================================
-- As tres linhas plantadas para isto valem 10,00 de parte cada uma, e nenhuma
-- pode aparecer no teto de maio. Elas nao se somam a nada: se qualquer recorte
-- cair, o `spent` de maio deixa de ser 610 -- e por isso a secao 1 ja as
-- cobriria no agregado. O que estas assercoes acrescentam e dizer QUAL recorte
-- caiu, em vez de so "o numero mudou".
SELECT pg_temp.expect_num('a parte do Uber (outra categoria) nao entra no teto de Alimentacao',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000001'), 610.00);

-- O recorte de CATEGORIA, medido do outro lado: um teto de Transporte em maio
-- ve a parte do Uber (10,00) e NAO ve nada de Alimentacao.
INSERT INTO public.budgets (id, user_id, category_id, month, amount_limit) VALUES
  ('b4800000-0000-0000-0000-000000000005', 'a4800000-0000-0000-0000-0000000000a1',
   '49d97f81-6f07-4e6d-9822-75167b8426b2', DATE '2026-05-01', 100.00);

SELECT pg_temp.expect_num('teto de Transporte em maio ve so a parte do Uber: 10,00',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000005'), 10.00);

-- O recorte de MES, medido do outro lado: um teto de Alimentacao em ABRIL ve
-- so a parte do mercado de abril (10,00).
INSERT INTO public.budgets (id, user_id, category_id, month, amount_limit) VALUES
  ('b4800000-0000-0000-0000-000000000006', 'a4800000-0000-0000-0000-0000000000a1',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', DATE '2026-04-01', 100.00);

SELECT pg_temp.expect_num('teto de Alimentacao em abril ve so a parte de abril: 10,00',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000006'), 10.00);

-- O recorte de USUARIO. A B tambem tem parte nas despesas da Casa, e o teto da
-- A nao pode consumi-la. Um teto da B na mesma categoria e mes consome a conta
-- DELA: 60 que ela pagou (cheio) + 30 do jantar da A + 10 do Uber da propria B?
-- Nao -- o Uber a B PAGOU, entao ele ja esta no cheio dela. A conta da B e
-- 60 + 30 + 30 (o Uber e o mercado de abril que ela pagou nao entram: abril e
-- outro mes) ... a aritmetica por extenso:
--     cheio   60,00 (mercado do grupo, Alimentacao, maio, ela pagou)
--     parte   30,00 (jantar de 90 da A)
--     total   90,00
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a4800000-0000-0000-0000-0000000000b1';

SELECT pg_temp.expect_num('o teto da B consome a conta DELA: 90,00 (60 que ela pagou + 30 de parte)',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000007'), 90.00);

SELECT pg_temp.refute_num('o teto da B nao consome o da A',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000007'),
  610.00, 'o consumo da A dentro do teto da B');

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a4800000-0000-0000-0000-0000000000a1';

-- =====================================================
-- 5. O rateio RECUSADO, nos dois sentidos
-- =====================================================
-- Julho: a A pagou 200 e todo mundo recusou; a B pagou 99 e a A recusou.
-- A conta da A e 200,00 -- e os dois lados disso saem do MESMO filtro.
SELECT pg_temp.expect_num('teto de julho: 200,00 -- o que EU paguei continua inteiro, o que eu recusei nao entra',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000004'), 200.00);

SELECT pg_temp.refute_num('a parte recusada no estacionamento da B nao entra (233)',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000004'),
  233.00, 'a parte de 33 que a A RECUSOU somada ao pedagio dela');

SELECT pg_temp.refute_num('o pedagio que o grupo recusou NAO sai do teto de quem pagou (0)',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000004'),
  0.00, 'o mes inteiro da A desaparecendo porque o grupo recusou o rateio dela');

-- =====================================================
-- 6. CONTROLE NEGATIVO: a RLS, e a reloption que ela nao pega
-- =====================================================
-- A view passou a ler `group_share_entries`, que a 033 deixou sem filtro de
-- user_id de proposito. Quem segura o orcamento alheio fora da lista e a RLS do
-- 006 -- e ela so vale porque a view e `security_invoker`.
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a4800000-0000-0000-0000-0000000000c1';

-- A C nao tem teto nenhum e divide os dois grupos com a A. Ela ve os tetos de
-- GRUPO (a RLS do 006 permite, de proposito: e o teto da viagem dela tambem) e
-- NENHUM teto pessoal de outra pessoa.
SELECT pg_temp.expect('a C nao ve teto PESSOAL de ninguem',
  (SELECT count(*) FROM public.budget_consumption WHERE group_id IS NULL), 0);

SELECT pg_temp.expect('a C ve o teto de GRUPO da Casa, que e dela tambem',
  (SELECT count(*) FROM public.budget_consumption
    WHERE id = 'b4800000-0000-0000-0000-000000000002'), 1);

RESET ROLE;

-- A assercao SEPARADA sobre as reloptions. Medido na 046: um controle negativo
-- pela RLS NAO pega a perda do `security_invoker` quando a view so le outras
-- views -- e `budget_consumption` le `budgets`, que TEM RLS, entao aqui pega.
-- As duas existem porque elas medem coisas diferentes: esta fica vermelha
-- mesmo num banco sem a segunda pessoa para comparar.
SELECT pg_temp.expect('budget_consumption tem security_invoker=true no catalogo',
  (SELECT count(*) FROM pg_class
    WHERE oid = 'public.budget_consumption'::regclass
      AND reloptions @> ARRAY['security_invoker=true']), 1);

SELECT pg_temp.expect('anon nao tem privilegio em budget_consumption',
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'budget_consumption'
      AND grantee = 'anon'), 0);

DO $$ BEGIN RAISE NOTICE '049: todas as assercoes passaram'; END $$;

ROLLBACK;
