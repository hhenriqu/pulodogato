-- =====================================================
-- HMO-184: a conta prevista e em real, e o banco garante
-- =====================================================
-- A 034 troca o catalogo de 13 moedas da 022, em `scheduled_transactions`, por
-- `CHECK (currency = 'BRL')`. Este teste e o que impede alguem de desfazer isso
-- sem ler o que esta sendo aberto.
--
-- O QUE ESTA EM JOGO (e por que uma trava, e nao uma feature)
-- -----------------------------------------------------------
-- Nenhum INSERT do app escreve `currency` em `scheduled_transactions`, e nao
-- existe `exchange_rate` ali. Toda soma de conta prevista -- o `summary`, o
-- safe-to-spend, o fluxo de caixa, a projecao e a secao "Previstas" da tela do
-- grupo -- soma `amount` sem olhar moeda. Isso esta certo enquanto tudo for
-- BRL, e certo POR ACIDENTE: a primeira rota que gravar 'USD' faz todas elas
-- somarem dolar com real, sem erro, e sempre para MENOS. Custo fixo
-- subestimado e insumo do safe-to-spend -- o app passaria a dizer que sobra
-- dinheiro que nao sobra.
--
-- E a saida "grave a moeda e converta na baixa" nao existe hoje:
-- app/api/scheduled-transactions/[id]/pay/route.ts insere em
-- `financial_transactions` sem mandar `currency` NEM `exchange_rate`, entao as
-- duas caem no DEFAULT (BRL, 1) -- um par consistente consigo mesmo, que o
-- CHECK `(currency='BRL') = (exchange_rate=1)` da 026 NAO reprova. Uma previsao
-- de US$ 180 daria baixa como R$ 180, calada. Ver o cabecalho da 034.
--
-- O que este teste fixa:
--
--   (1) a trava recusa 'USD' no INSERT;
--   (2) a trava recusa 'USD' no UPDATE -- e por onde um PATCH novo entraria;
--   (3) CONTROLE POSITIVO: 'BRL' explicito e aceito. Sem esta assercao, um
--       mutante `CHECK (false)` -- a trava larga demais, que recusa TUDO --
--       passaria em (1) e em (2) e seria dado como morto sem ser;
--   (4) CONTROLE POSITIVO: o INSERT que OMITE a coluna (o unico que o app faz
--       de verdade, nas tres rotas) continua funcionando e cai em 'BRL';
--   (5) a trava e so da conta prevista: `financial_accounts` e
--       `financial_transactions` CONTINUAM aceitando as 13 moedas da 022. Mata
--       o mutante que aplica o cadeado na tabela errada -- que, sem esta
--       assercao, passaria em (1)-(4) inteirinho;
--   (6) a trava tem a FORMA certa (`currency = 'BRL'`, e nao o catalogo de volta
--       sob o nome novo), e o CHECK de catalogo da 022 CONTINUA embaixo dela --
--       a 034 e aditiva de proposito, para que destrancar caia no catalogo e
--       nao em validacao nenhuma;
--   (7) o efeito ACEITO em `planned_vs_actual`: um realizado em USD aparece em
--       linha propria, com previsto ZERO. Esta assercao nao protege a trava --
--       ela DOCUMENTA, de forma executavel, a consequencia que a issue mandou
--       vigiar ("gastou 180 sem ter previsto nada"), para que quem a encontrar
--       na tela saiba que e esperada e nao um defeito novo.
--
-- Rodar num banco limpo, depois das migrations ate 034:
--   psql "$DB_URL" -f database/tests/hmo184_moeda_da_conta_prevista_test.sql
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

CREATE OR REPLACE FUNCTION pg_temp.expect_txt(label TEXT, got TEXT, want TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- Roda um comando e devolve o SQLSTATE, ou '00000' se ele passou. E a sonda das
-- assercoes de recusa E das de aceitacao: as duas chamam a MESMA funcao e
-- comparam com valores diferentes, entao nao existe o caso "a assercao de
-- aceitacao usa um caminho mais frouxo que a de recusa".
CREATE OR REPLACE FUNCTION pg_temp.sqlstate_de(cmd TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE cmd;
  RETURN '00000';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $$;

-- =====================================================
-- Fixture
-- =====================================================
INSERT INTO auth.users (id, email) VALUES
  ('a1840000-0000-0000-0000-000000000001', 'moeda@prevista.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('a1840000-0000-0000-0000-000000000001', 'Usuario 184', FALSE);

INSERT INTO public.financial_accounts (id, user_id, name, account_type) VALUES
  ('a1840000-0000-0000-0000-0000000000c1', 'a1840000-0000-0000-0000-000000000001', 'Conta 184', 'checking');

-- b9db286c-... e a categoria do seed de referencia do 001_baseline.sql, a mesma
-- usada pelo scheduled_rls_test. Repetida por extenso em vez de um \set porque
-- o bundle do SQL Editor so traduz o \set ON_ERROR_STOP.

-- =====================================================
-- (1) a trava recusa 'USD' no INSERT
-- =====================================================
-- 23514 = check_violation. Conferir o SQLSTATE, e nao "deu erro", importa: um
-- `not_null_violation` ou um `foreign_key_violation` por fixture errada tambem
-- "da erro", e passaria por uma assercao frouxa dizendo que a trava funciona
-- quando quem recusou foi outra coisa.
SELECT pg_temp.expect_txt(
  'INSERT com currency=USD e recusado com 23514',
  pg_temp.sqlstate_de($cmd$
    INSERT INTO public.scheduled_transactions
      (id, user_id, category_id, account_id, description, amount, due_date, currency)
    VALUES
      ('a1840000-0000-0000-0000-0000000000d1', 'a1840000-0000-0000-0000-000000000001',
       'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'a1840000-0000-0000-0000-0000000000c1',
       'Hotel em Santiago', 180.00, CURRENT_DATE + 30, 'USD')
  $cmd$),
  '23514'
);

-- =====================================================
-- (4) CONTROLE POSITIVO: o INSERT que o app faz de verdade
-- =====================================================
-- As tres rotas que criam conta prevista (conta avulsa, fatura fechada,
-- materializacao das regras) OMITEM a coluna. Se a trava quebrasse este
-- caminho, o app pararia de criar conta prevista nenhuma -- e e por isso que
-- esta assercao vem antes das outras: ela e a que diz que o cadeado nao
-- trancou a casa inteira.
SELECT pg_temp.expect_txt(
  'INSERT que omite currency passa',
  pg_temp.sqlstate_de($cmd$
    INSERT INTO public.scheduled_transactions
      (id, user_id, category_id, account_id, description, amount, due_date)
    VALUES
      ('a1840000-0000-0000-0000-0000000000d2', 'a1840000-0000-0000-0000-000000000001',
       'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'a1840000-0000-0000-0000-0000000000c1',
       'Aluguel', 2500.00, date_trunc('month', CURRENT_DATE)::date + 5)
  $cmd$),
  '00000'
);

SELECT pg_temp.expect_txt(
  'e cai no DEFAULT BRL',
  (SELECT currency FROM public.scheduled_transactions
    WHERE id = 'a1840000-0000-0000-0000-0000000000d2'),
  'BRL'
);

-- =====================================================
-- (3) CONTROLE POSITIVO: 'BRL' explicito e aceito
-- =====================================================
-- Esta e a assercao que separa `CHECK (currency = 'BRL')` de `CHECK (false)`.
-- Sem ela a trava larga demais passa por morta: ela recusa 'USD' em (1) e no
-- UPDATE de (2) exatamente como a trava certa, e a diferenca so aparece quando
-- alguem tenta gravar a moeda PERMITIDA.
SELECT pg_temp.expect_txt(
  'INSERT com currency=BRL explicito passa',
  pg_temp.sqlstate_de($cmd$
    INSERT INTO public.scheduled_transactions
      (id, user_id, category_id, account_id, description, amount, due_date, currency)
    VALUES
      ('a1840000-0000-0000-0000-0000000000d3', 'a1840000-0000-0000-0000-000000000001',
       'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'a1840000-0000-0000-0000-0000000000c1',
       'Internet', 120.00, date_trunc('month', CURRENT_DATE)::date + 7, 'BRL')
  $cmd$),
  '00000'
);

-- =====================================================
-- (2) a trava recusa 'USD' no UPDATE
-- =====================================================
-- O INSERT nao e a unica porta. Um PATCH que passasse a aceitar `currency` --
-- ou um backfill de migration futura -- entraria por aqui, sobre uma linha que
-- ja nasceu BRL. Um CHECK cobre os dois caminhos, mas so a assercao prova que
-- ele foi escrito como CHECK e nao como DEFAULT ou trigger de INSERT.
SELECT pg_temp.expect_txt(
  'UPDATE para currency=USD e recusado com 23514',
  pg_temp.sqlstate_de($cmd$
    UPDATE public.scheduled_transactions
       SET currency = 'USD'
     WHERE id = 'a1840000-0000-0000-0000-0000000000d2'
  $cmd$),
  '23514'
);

SELECT pg_temp.expect_txt(
  'e a linha continua BRL depois da recusa',
  (SELECT currency FROM public.scheduled_transactions
    WHERE id = 'a1840000-0000-0000-0000-0000000000d2'),
  'BRL'
);

-- =====================================================
-- (6) a forma da trava, e o catalogo que fica embaixo dela
-- =====================================================
-- A trava e ADITIVA: o CHECK de catalogo da 022 continua na tabela, e o da 034
-- entra ao lado. Hoje vale a intersecao (so 'BRL'); no dia em que alguem
-- destrancar -- o gesto natural e derrubar o CHECK que so aceita BRL -- sobra o
-- catalogo da 022, em vez de sobrar coluna nenhuma validando. Ver a SECAO 1 da
-- 034.
SELECT pg_temp.expect_txt(
  'a trava da 034 e exatamente CHECK (currency = BRL)',
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid = 'public.scheduled_transactions'::regclass
      AND conname = 'scheduled_transactions_currency_brl'),
  'CHECK ((currency = ''BRL''::text))'
);

-- A rede embaixo da trava. Sem esta assercao, um "simplificar a 034" que troque
-- o catalogo pela trava passa em TODAS as outras -- o comportamento de hoje e
-- identico -- e so cobra o preco meses depois, quando alguem destrancar e a
-- coluna ficar aceitando qualquer texto de 3 letras.
SELECT pg_temp.expect(
  'o catalogo de moedas da 022 CONTINUA na tabela, debaixo da trava',
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.scheduled_transactions'::regclass
      AND conname = 'scheduled_transactions_currency_check'
      AND pg_get_constraintdef(oid) ~ 'USD'),
  1
);

-- =====================================================
-- (5) CONTROLE NEGATIVO: a trava e SO da conta prevista
-- =====================================================
-- O jeito mais facil de escrever a 034 errado e trancar a tabela vizinha: os
-- nomes de constraint da 022 sao quase iguais nas tres tabelas. Um cadeado em
-- `financial_transactions` passaria em (1)-(4) e em (6) sem ninguem notar, e
-- quebraria a feature de multimoeda inteira -- justamente a que a 026 acabou de
-- entregar. Estas duas assercoes sao o que separa um caso do outro.
SELECT pg_temp.expect_txt(
  'financial_accounts AINDA aceita USD',
  pg_temp.sqlstate_de($cmd$
    INSERT INTO public.financial_accounts (id, user_id, name, account_type, currency)
    VALUES ('a1840000-0000-0000-0000-0000000000c2', 'a1840000-0000-0000-0000-000000000001',
            'Conta em dolar', 'checking', 'USD')
  $cmd$),
  '00000'
);

-- Com cotacao: o CHECK `(currency='BRL') = (exchange_rate=1)` da 026 continua
-- valendo aqui, e mandar so a moeda cairia num 23514 que esta assercao leria
-- como "a 034 trancou a tabela errada" -- um falso positivo que apontaria para
-- o lugar errado.
--
-- `service_id` sai de uma subconsulta sobre a categoria do seed em vez de um
-- UUID digitado: a coluna e NOT NULL sem default, e um valor inventado aqui
-- devolveria 23502 (not_null) ou 23503 (FK) -- os dois lidos por uma assercao
-- frouxa como "a 034 trancou a tabela errada", apontando a investigacao para o
-- arquivo que esta certo. Foi o que aconteceu na primeira execucao deste teste.
SELECT pg_temp.expect_txt(
  'financial_transactions AINDA aceita USD com cotacao',
  pg_temp.sqlstate_de($cmd$
    INSERT INTO public.financial_transactions
      (id, user_id, service_id, account_id, category_id, description, amount,
       transaction_date, transaction_type, currency, exchange_rate)
    VALUES
      ('a1840000-0000-0000-0000-0000000000e1', 'a1840000-0000-0000-0000-000000000001',
       (SELECT service_id FROM public.transaction_categories
         WHERE id = 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f'),
       'a1840000-0000-0000-0000-0000000000c1', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
       'Jantar em Santiago', -180.00, CURRENT_DATE, 'expense', 'USD', 5.35)
  $cmd$),
  '00000'
);

-- =====================================================
-- (7) o efeito aceito em planned_vs_actual
-- =====================================================
-- A issue mandou vigiar isto: "mexer na moeda de um lado sem o outro faz
-- aparecer 'gastou 180 sem ter previsto nada'". A linha APARECE mesmo -- e e
-- correta. Nao havia previsao em dolar porque o app recusa cria-la (HMO-188), e
-- a 034 agora garante que o banco tambem recusa. O que a assercao fixa e que a
-- linha em USD nao CONTAMINA a linha em BRL: o previsto em real continua
-- inteiro na linha dele, que e o que o `IS NOT DISTINCT FROM` da moeda faz na
-- view. Se alguem tirar a moeda do cruzamento, o previsto de 2.620 passa a
-- aparecer tambem na linha de USD e a tela mostra previsao em dolar que
-- ninguem fez.
SELECT pg_temp.expect(
  'o realizado em USD vira linha propria, com previsto zero',
  (SELECT COALESCE(planned_expense, -1)::bigint FROM public.planned_vs_actual
    WHERE user_id = 'a1840000-0000-0000-0000-000000000001'
      AND currency = 'USD'
      AND month = date_trunc('month', CURRENT_DATE)::date),
  0
);

-- 2500 + 120 = 2620, as duas previstas em BRL de (3) e (4). O numero e cravado
-- de proposito: um "> 0" aqui passaria mesmo que a linha de BRL tivesse perdido
-- metade do previsto para a linha de USD.
SELECT pg_temp.expect(
  'e o previsto em BRL continua inteiro na linha de BRL',
  (SELECT COALESCE(planned_expense, -1)::bigint FROM public.planned_vs_actual
    WHERE user_id = 'a1840000-0000-0000-0000-000000000001'
      AND currency = 'BRL'
      AND month = date_trunc('month', CURRENT_DATE)::date),
  2620
);

ROLLBACK;
