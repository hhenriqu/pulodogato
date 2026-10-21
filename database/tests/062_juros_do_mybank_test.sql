-- =====================================================
-- HMO-445 -- os juros do MyBank (062), filha F1 da HMO-444
-- =====================================================
-- Roda no db-verify contra o banco que as migrations constroem do zero, com a
-- 062 ja aplicada DUAS vezes (a segunda e o step de idempotencia) e com a
-- fixture `062_emprestimo_antes_da_062.sql` ja comitada.
--
-- O QUE A 062 ENTREGA
-- -------------------
--   * `mybank_loans_interest_rate_fase_1` SOLTA -- a trava que a 053 instalou
--     para que a fase 1 so aceitasse juro 0;
--   * `interest_kind text NOT NULL DEFAULT 'total_simples'`, com catraca de UM
--     valor -- a convencao de juro gravada na LINHA (decisao D2);
--   * `mybank_loans_interest_rate_check` reescrita com piso E teto
--     (`0 <= interest_rate <= 10`);
--   * os COMENTARIOS de `principal`, `interest_rate` e `interest_kind`
--     reescritos.
-- Nada mais: nenhuma view, nenhuma trigger, nenhum backfill.
--
-- POR QUE "O INSERT COM JURO PASSA" NAO PROVA ESTA MIGRATION
-- ---------------------------------------------------------
-- Essa assercao sozinha fica VERDE tambem contra:
--
--   - uma 062 VAZIA, num banco onde a trava de fase nunca tivesse sido colada --
--     nada teria afirmado que havia trava para soltar. Quem fecha esse buraco e
--     a metade (2) de `062_emprestimo_antes_da_062.sql`, que PROVA a recusa
--     ANTES, com o nome da constraint na mensagem;
--   - uma 062 que soltasse a trava e NAO pusesse o teto -> `interest_rate = 300`
--     (30000%) entra;
--   - uma 062 sem `interest_kind` -> no dia do juro composto, todo emprestimo
--     velho passa a mostrar outro total, sem ninguem editar nada;
--   - uma 062 com a catraca larga (`IN ('total_simples','total_composto')`) -> o
--     app grava hoje uma convencao que nenhuma funcao deste repositorio sabe
--     calcular;
--   - uma 062 sem os `COMMENT ON` -> o comentario de `principal` continua
--     afirmando que a soma das parcelas fecha com ele. Isso e documentacao
--     mentindo sobre dinheiro, e e o convite para alguem escrever depois uma
--     guarda "consertando" a soma -- que apagaria o juro de todo emprestimo.
--
-- As cinco erradas custam dinheiro, e as cinco passam numa assercao de
-- aceitacao. Por isso a secao 1 afirma a FORMA no catalogo, as secoes 3 a 5
-- medem COMPORTAMENTO com aceitacao E recusa, a 6 mede o MODELO NOVO de
-- dinheiro, e a 7 mede o TEXTO dos comentarios nas duas direcoes (o novo entrou,
-- o antigo saiu).
--
-- E nem isso basta: o catalogo nao diz o que aconteceu com as linhas que JA
-- EXISTIAM. E o que a secao 2 mede, com o emprestimo plantado antes da migration
-- (ver o cabecalho da fixture).
--
-- CONTROLE NEGATIVO (fora deste arquivo, e medido): contra um banco parado na
-- 059 este teste fica VERMELHO na secao 1, na primeira assercao -- a trava de
-- fase ainda existe. E o que prova que ele mede a 062, e nao o estado basal do
-- banco.
--
-- Rodar num banco limpo, na POSICAO da 062 -- a ordem dos quatro passos nao e
-- negociavel, e o porque esta no cabecalho da fixture:
--   psql "$DB_URL" -f database/tests/062_emprestimo_antes_da_062.sql
--   psql "$DB_URL" -f database/migrations/062_juros_do_mybank.sql
--   psql "$DB_URL" -f database/migrations/062_juros_do_mybank.sql
--   psql "$DB_URL" -f database/tests/062_juros_do_mybank_test.sql
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
    RAISE EXCEPTION 'FALHA: % -> esperado "%", obtido "%"', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- Dinheiro e taxa sao `numeric`, e `expect` recebe BIGINT: comparar
-- `SUM(amount) - principal` por aqui perderia os centavos no cast. A comparacao
-- e por `IS DISTINCT FROM` em `numeric`, entao `0.200000 = 0.2` e verdade (o
-- `=` de numeric compara valor, nao escala) -- que e o que se quer, porque
-- `interest_rate` e `numeric(9,6)` e a tela digita `0.2`.
CREATE OR REPLACE FUNCTION pg_temp.expect_num(label TEXT, got NUMERIC, want NUMERIC)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- O que RECUSA, com o SQLSTATE certo. Conferir o codigo e nao so "deu erro"
-- importa: um erro de digitacao no uuid tambem "da erro", e com a assercao larga
-- a trava poderia nunca ter sido chamada.
CREATE OR REPLACE FUNCTION pg_temp.expect_recusa(label TEXT, sql TEXT, sqlstate_esperado TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> sqlstate_esperado THEN
      RAISE EXCEPTION 'FALHA: % -> recusou com % e nao com % (%)', label, SQLSTATE, sqlstate_esperado, SQLERRM;
    END IF;
    RAISE NOTICE 'ok: % (recusado com %)', label, sqlstate_esperado;
    RETURN;
  END;
  RAISE EXCEPTION 'FALHA: % -> o banco ACEITOU, e devia recusar com %', label, sqlstate_esperado;
END $$;

-- O que PASSA. Existe porque "nao deu erro" precisa ser afirmado tambem: uma
-- trava escrita larga demais fica verde em todo teste que so mede recusa -- e
-- aqui o inverso e o risco principal, porque esta migration SOLTA uma trava.
CREATE OR REPLACE FUNCTION pg_temp.expect_aceita(label TEXT, sql TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RAISE NOTICE 'ok: % (aceito)', label;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FALHA: % -> o banco RECUSOU (% %), e devia aceitar', label, SQLSTATE, SQLERRM;
END $$;

-- =====================================================
-- 1. A FORMA NO CATALOGO
-- =====================================================
-- A PRIMEIRA assercao do arquivo e a entrega da migration: a trava de fase
-- SAIU. Ela e a que fica vermelha no controle negativo (banco parado na 059).
SELECT pg_temp.expect('a trava de fase mybank_loans_interest_rate_fase_1 NAO existe mais',
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.mybank_loans'::regclass
      AND conname = 'mybank_loans_interest_rate_fase_1'), 0);

-- O TRIO tipo + nulabilidade + default numa string unica, e nao tres assercoes
-- separadas: a mensagem de falha mostra qual dos tres cedeu. O default e
-- afirmado porque e ele que grava a convencao nas linhas que ja existiam -- sem
-- ele, `NOT NULL` faria a propria colagem morrer em prod (onde ha linha), e num
-- banco do zero passaria.
SELECT pg_temp.expect_txt('interest_kind: tipo, nulabilidade e default',
  (SELECT data_type
            || ' / ' || CASE WHEN is_nullable = 'NO' THEN 'NOT NULL' ELSE 'NULAVEL' END
            || ' / ' || coalesce(column_default, '(sem default)')
     FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mybank_loans'
      AND column_name = 'interest_kind'),
  'text / NOT NULL / ''total_simples''::text');

-- A catraca do enum, pela DEFINICAO e nao por "existe": uma catraca que ja
-- aceitasse `total_composto` passaria em qualquer assercao de existencia, e
-- deixaria o app gravar hoje uma convencao que nenhuma funcao deste repositorio
-- sabe calcular.
SELECT pg_temp.expect_txt('a catraca de interest_kind aceita SO total_simples',
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid = 'public.mybank_loans'::regclass
      AND conname = 'mybank_loans_interest_kind_check'),
  'CHECK ((interest_kind = ''total_simples''::text))');

-- O dominio da taxa com os DOIS lados. A 053 tinha `>= 0` sozinho; com a trava
-- de fase solta, aquele piso aceita 30000%.
SELECT pg_temp.expect_txt('o dominio de interest_rate tem piso E teto',
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid = 'public.mybank_loans'::regclass
      AND conname = 'mybank_loans_interest_rate_check'),
  'CHECK (((interest_rate >= (0)::numeric) AND (interest_rate <= (10)::numeric)))');

-- UM so CHECK sobre `interest_rate`, e nao dois. A migration REESCREVE a
-- constraint da 053 em vez de acrescentar uma segunda: com duas, o dominio da
-- coluna fica espalhado em dois nomes que se sobrepoem, e soltar um deles no
-- futuro nao faria efeito visivel -- o que leva a soltar os dois.
--
-- Esta assercao tambem e a da IDEMPOTENCIA: um `ADD CONSTRAINT` com nome
-- gerado pelo Postgres (ou diferente a cada passada) criaria a segunda
-- constraint calado na segunda colagem, e so esta linha a ve.
SELECT pg_temp.expect('UM so CHECK sobre interest_rate em mybank_loans',
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.mybank_loans'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%interest_rate%'), 1);

SELECT pg_temp.expect('UM so CHECK sobre interest_kind em mybank_loans',
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.mybank_loans'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%interest_kind%'), 1);

-- =====================================================
-- 2. O EMPRESTIMO QUE JA EXISTIA
-- =====================================================
-- A linha de `062_emprestimo_antes_da_062.sql` nasceu ANTES de `interest_kind`
-- existir, e a 062 ja foi colada DUAS vezes sobre ela. As tres afirmacoes:
--
--   * a linha esta VIVA -- sem isso, as duas seguintes passariam por vacuo, que
--     e o modo de falha de `prod-vazia-invalida-prova-por-efeito-colateral`;
--   * a taxa continua 0: a migration nao mexeu em dinheiro de ninguem;
--   * a convencao foi gravada pelo DEFAULT, e nao adivinhada -- e continua
--     `total_simples` depois do re-run (um `UPDATE ... SET interest_kind` de
--     "limpeza" na migration apareceria aqui).
SELECT pg_temp.expect('o emprestimo pre-existente esta VIVO',
  (SELECT count(*) FROM public.mybank_loans
    WHERE id = 'd0620000-0000-0000-0000-000000000001'), 1);

SELECT pg_temp.expect_num('o emprestimo pre-existente continua com juro 0',
  (SELECT interest_rate FROM public.mybank_loans
    WHERE id = 'd0620000-0000-0000-0000-000000000001'), 0);

SELECT pg_temp.expect_txt('o emprestimo pre-existente ficou total_simples pelo DEFAULT, e o re-run nao o reescreveu',
  (SELECT interest_kind FROM public.mybank_loans
    WHERE id = 'd0620000-0000-0000-0000-000000000001'),
  'total_simples');

-- E o modelo novo CONTINUA VALENDO para ele: com juro 0, `principal x (1 + 0)`
-- e a soma das parcelas, entao a soma fecha. O mundo antigo nao deixou de fazer
-- sentido -- ele e o caso `interest_rate = 0` do mundo novo. Ver a secao 6 para
-- o caso com juro, onde a soma NAO fecha.
SELECT pg_temp.expect_num('no emprestimo pre-existente (juro 0) a soma das parcelas AINDA fecha com o principal',
  (SELECT sum(i.amount) - l.principal
     FROM public.mybank_installments i
     JOIN public.mybank_loans l ON l.id = i.loan_id
    WHERE l.id = 'd0620000-0000-0000-0000-000000000001'
    GROUP BY l.principal), 0);

-- =====================================================
-- Fixture das secoes 3 a 6 (dentro da transacao -- some no ROLLBACK)
-- =====================================================
-- Auto-emprestimo (`borrower = lender`) para dispensar `user_connections`: a
-- trava 2 da 053 sai pelo desvio do auto-emprestimo antes de consultar a tabela
-- de conexoes. A conta `checking` nao e enfeite -- a secao 8 usa ela para provar
-- que a trava 1 da 053 continua armada depois desta migration.
INSERT INTO auth.users (id, email) VALUES
  ('b4450000-0000-0000-0000-0000000445aa', 'x445@ci.local');

INSERT INTO public.profiles (id, email, full_name, is_public) VALUES
  ('b4450000-0000-0000-0000-0000000445aa', 'x445@ci.local', 'X, o credor', FALSE);

INSERT INTO public.financial_accounts
  (id, user_id, name, account_type, icon, color_hex, current_balance) VALUES
  ('c4450000-0000-0000-0000-00000445aa01', 'b4450000-0000-0000-0000-0000000445aa',
   'Corretora do X',      'investment', 'trending-up', '#8B5CF6', 50000.00),
  ('c4450000-0000-0000-0000-00000445aa02', 'b4450000-0000-0000-0000-0000000445aa',
   'Conta Corrente do X', 'checking',   'building',    '#10B981',  1000.00);

-- =====================================================
-- 3. A PROVA QUE IMPORTA: O JURO ENTRA
-- =====================================================
-- O MESMO INSERT que `062_emprestimo_antes_da_062.sql` provou ser RECUSADO
-- antes desta migration. O par (falha antes / passa depois) e a entrega da
-- HMO-445; nenhuma das duas metades sozinha prova nada.
--
-- Ele NAO menciona `interest_kind`, de proposito: e o caminho da rota da F3
-- antes de ela aprender a coluna, e o DEFAULT tem de responder.
DO $$ BEGIN PERFORM pg_temp.expect_aceita('DEPOIS da 062, interest_rate = 0.2 e ACEITO', $sql$
  INSERT INTO public.mybank_loans
    (id, lender_user_id, lender_account_id, borrower_user_id,
     description, principal, installment_count, first_due_date, interest_rate)
  VALUES
    ('d4450000-0000-0000-0000-00000445aa01',
     'b4450000-0000-0000-0000-0000000445aa',
     'c4450000-0000-0000-0000-00000445aa01',
     'b4450000-0000-0000-0000-0000000445aa',
     'Emprestimo de R$ 1.000 a 20%', 1000.00, 12, '2026-11-10', 0.2)
$sql$); END $$;

-- A taxa esta GRAVADA, e nao arredondada para zero por um `numeric` de escala
-- errada. `numeric(9,6)` guarda `0.200000`, e `expect_num` compara valor.
SELECT pg_temp.expect_num('a taxa de 20% ficou gravada na linha',
  (SELECT interest_rate FROM public.mybank_loans
    WHERE id = 'd4450000-0000-0000-0000-00000445aa01'), 0.2);

SELECT pg_temp.expect_txt('o INSERT que NAO menciona interest_kind recebe total_simples pelo DEFAULT',
  (SELECT interest_kind FROM public.mybank_loans
    WHERE id = 'd4450000-0000-0000-0000-00000445aa01'),
  'total_simples');

-- Nomear a convencao explicitamente tambem entra: e o caminho da F3 depois de
-- ela aprender a coluna.
DO $$ BEGIN PERFORM pg_temp.expect_aceita('nomear interest_kind = total_simples explicitamente e ACEITO', $sql$
  INSERT INTO public.mybank_loans
    (lender_user_id, lender_account_id, borrower_user_id,
     description, principal, installment_count, first_due_date,
     interest_rate, interest_kind)
  VALUES
    ('b4450000-0000-0000-0000-0000000445aa',
     'c4450000-0000-0000-0000-00000445aa01',
     'b4450000-0000-0000-0000-0000000445aa',
     'Emprestimo com a convencao nomeada', 500.00, 6, '2026-11-10', 0.1, 'total_simples')
$sql$); END $$;

-- =====================================================
-- 4. O PISO E O TETO CONTINUAM
-- =====================================================
-- Soltar a trava de fase nao pode ter aberto a coluna inteira. Juro NEGATIVO e o
-- credor devolvendo dinheiro para quem pegou emprestado -- nao existe tela para
-- isso, e a linha ficaria contando valor errado nas duas pontas.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('interest_rate = -0.1 continua RECUSADO', $sql$
  INSERT INTO public.mybank_loans
    (lender_user_id, lender_account_id, borrower_user_id,
     description, principal, installment_count, first_due_date, interest_rate)
  VALUES
    ('b4450000-0000-0000-0000-0000000445aa',
     'c4450000-0000-0000-0000-00000445aa01',
     'b4450000-0000-0000-0000-0000000445aa',
     'Juro negativo', 1000.00, 12, '2026-11-10', -0.1)
$sql$, '23514'); END $$;

-- 11 = 1100% sobre o emprestimo todo. E o teto de sanidade: dedo escorregado,
-- nao negocio.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('interest_rate = 11 (1100%) e RECUSADO pelo teto', $sql$
  INSERT INTO public.mybank_loans
    (lender_user_id, lender_account_id, borrower_user_id,
     description, principal, installment_count, first_due_date, interest_rate)
  VALUES
    ('b4450000-0000-0000-0000-0000000445aa',
     'c4450000-0000-0000-0000-00000445aa01',
     'b4450000-0000-0000-0000-0000000445aa',
     'Juro de 1100%', 1000.00, 12, '2026-11-10', 11)
$sql$, '23514'); END $$;

-- A BORDA, nos dois lados do 10 -- e o que distingue `<= 10` de `< 10` e de
-- `<= 100`. Um teto escrito com o comparador errado passa nas duas assercoes de
-- cima.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('interest_rate = 10.000001 e RECUSADO (a borda de cima)', $sql$
  INSERT INTO public.mybank_loans
    (lender_user_id, lender_account_id, borrower_user_id,
     description, principal, installment_count, first_due_date, interest_rate)
  VALUES
    ('b4450000-0000-0000-0000-0000000445aa',
     'c4450000-0000-0000-0000-00000445aa01',
     'b4450000-0000-0000-0000-0000000445aa',
     'Um passo acima do teto', 1000.00, 12, '2026-11-10', 10.000001)
$sql$, '23514'); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_aceita('interest_rate = 10 e ACEITO (o teto e inclusivo)', $sql$
  INSERT INTO public.mybank_loans
    (lender_user_id, lender_account_id, borrower_user_id,
     description, principal, installment_count, first_due_date, interest_rate)
  VALUES
    ('b4450000-0000-0000-0000-0000000445aa',
     'c4450000-0000-0000-0000-00000445aa01',
     'b4450000-0000-0000-0000-0000000445aa',
     'Exatamente o teto', 1000.00, 12, '2026-11-10', 10)
$sql$); END $$;

-- E o dominio vale no UPDATE tambem. Nao e redundante com o INSERT por acidente
-- de implementacao: se alguem trocar o CHECK por uma trigger `BEFORE INSERT`
-- (que e o que a 053 fez para as outras duas travas, porque elas precisam de
-- subconsulta), o INSERT continua recusando e o UPDATE passa a aceitar -- e o
-- caminho do app para editar um emprestimo e justamente um UPDATE.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('subir a taxa para 11 num UPDATE e RECUSADO', $sql$
  UPDATE public.mybank_loans SET interest_rate = 11
   WHERE id = 'd4450000-0000-0000-0000-00000445aa01'
$sql$, '23514'); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_aceita('mudar a taxa de 0.2 para 0.3 num UPDATE e ACEITO', $sql$
  UPDATE public.mybank_loans SET interest_rate = 0.3
   WHERE id = 'd4450000-0000-0000-0000-00000445aa01'
$sql$); END $$;

-- De volta a 0.2: a secao 6 conta em cima desta taxa.
UPDATE public.mybank_loans SET interest_rate = 0.2
 WHERE id = 'd4450000-0000-0000-0000-00000445aa01';

-- =====================================================
-- 5. A CATRACA DA CONVENCAO
-- =====================================================
-- `total_composto` e o valor que a proxima fase vai querer, e e exatamente o que
-- NAO pode entrar hoje: nenhuma funcao deste repositorio sabe calcular juro
-- composto, e uma linha com essa convencao seria dinheiro que ninguem sabe
-- somar. Ele entra no dia em que a aritmetica entrar, como valor NOVO do mesmo
-- CHECK.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('interest_kind = total_composto e RECUSADO hoje', $sql$
  INSERT INTO public.mybank_loans
    (lender_user_id, lender_account_id, borrower_user_id,
     description, principal, installment_count, first_due_date,
     interest_rate, interest_kind)
  VALUES
    ('b4450000-0000-0000-0000-0000000445aa',
     'c4450000-0000-0000-0000-00000445aa01',
     'b4450000-0000-0000-0000-0000000445aa',
     'Juro composto, antes da aritmetica', 1000.00, 12, '2026-11-10', 0.2, 'total_composto')
$sql$, '23514'); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_recusa('interest_kind vazio e RECUSADO', $sql$
  INSERT INTO public.mybank_loans
    (lender_user_id, lender_account_id, borrower_user_id,
     description, principal, installment_count, first_due_date,
     interest_rate, interest_kind)
  VALUES
    ('b4450000-0000-0000-0000-0000000445aa',
     'c4450000-0000-0000-0000-00000445aa01',
     'b4450000-0000-0000-0000-0000000445aa',
     'Convencao vazia', 1000.00, 12, '2026-11-10', 0.2, '')
$sql$, '23514'); END $$;

-- `NULL` sai como `23502` (not-null violation) e nao como `23514`: e o `NOT
-- NULL` da coluna que responde, nao o CHECK -- um CHECK `IN (...)` com NULL
-- vale NULL, que NAO e FALSE, e passaria. A assercao fixa qual dos dois pega
-- este caso: sem o `NOT NULL`, este INSERT entraria com a convencao em branco.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('interest_kind NULL e RECUSADO pelo NOT NULL, nao pelo CHECK', $sql$
  INSERT INTO public.mybank_loans
    (lender_user_id, lender_account_id, borrower_user_id,
     description, principal, installment_count, first_due_date,
     interest_rate, interest_kind)
  VALUES
    ('b4450000-0000-0000-0000-0000000445aa',
     'c4450000-0000-0000-0000-00000445aa01',
     'b4450000-0000-0000-0000-0000000445aa',
     'Convencao nula', 1000.00, 12, '2026-11-10', 0.2, NULL)
$sql$, '23502'); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_recusa('trocar interest_kind para total_composto num UPDATE e RECUSADO', $sql$
  UPDATE public.mybank_loans SET interest_kind = 'total_composto'
   WHERE id = 'd4450000-0000-0000-0000-00000445aa01'
$sql$, '23514'); END $$;

-- =====================================================
-- 6. O MODELO NOVO DE DINHEIRO: A SOMA DAS PARCELAS NAO FECHA MAIS, E ESTA CERTA
-- =====================================================
-- Esta e a secao que corresponde ao `COMMENT ON principal` reescrito, e ela e a
-- razao pela qual aquele comentario nao e cosmetico.
--
-- Doze parcelas de R$ 100 para um principal de R$ 1.000 a 20%: a soma e
-- R$ 1.200, ela NAO fecha com o principal, e o banco ACEITA -- porque a
-- invariante antiga nunca foi constraint nem trigger neste banco (a 053 nao tem
-- nenhum `SUM()`), ela vivia so no comentario.
--
-- O `expect_aceita` aqui e um controle negativo de uma guarda que NAO EXISTE: se
-- alguem escrever depois um trigger "consertando" a soma -- que e o convite que
-- o comentario antigo fazia --, esta assercao fica vermelha. E a unica coisa no
-- repositorio que delata aquela guarda antes de ela apagar o juro de todo
-- emprestimo do sistema.
DO $$ BEGIN PERFORM pg_temp.expect_aceita('12 parcelas de R$ 100 num principal de R$ 1.000 (soma R$ 1.200) sao ACEITAS', $sql$
  INSERT INTO public.mybank_installments
    (loan_id, installment_number, installment_total, amount, due_date)
  SELECT 'd4450000-0000-0000-0000-00000445aa01', n, 12, 100.00,
         (DATE '2026-11-10' + ((n - 1) * INTERVAL '1 month'))::date
    FROM generate_series(1, 12) AS n
$sql$); END $$;

SELECT pg_temp.expect_num('o que VOLTA (a soma das parcelas) e 1200.00',
  (SELECT sum(amount) FROM public.mybank_installments
    WHERE loan_id = 'd4450000-0000-0000-0000-00000445aa01'), 1200.00);

-- `SUM(amount) - principal` E O JURO. E a leitura que o comentario novo declara,
-- e a que a F3/F4 vai usar na tela.
SELECT pg_temp.expect_num('SUM(amount) - principal e o JURO do emprestimo (200.00)',
  (SELECT sum(i.amount) - l.principal
     FROM public.mybank_installments i
     JOIN public.mybank_loans l ON l.id = i.loan_id
    WHERE l.id = 'd4450000-0000-0000-0000-00000445aa01'
    GROUP BY l.principal), 200.00);

-- E a aritmetica fecha com a convencao gravada na linha: com
-- `interest_kind = total_simples`, `SUM(amount) = principal x (1 + interest_rate)`.
-- Sem esta assercao, "200.00" acima seria so um numero que bate por coincidencia
-- com a fixture; aqui ele e amarrado a taxa que esta na coluna.
SELECT pg_temp.expect_num('com total_simples, SUM(amount) = principal x (1 + interest_rate)',
  (SELECT sum(i.amount) - (l.principal * (1 + l.interest_rate))
     FROM public.mybank_installments i
     JOIN public.mybank_loans l ON l.id = i.loan_id
    WHERE l.id = 'd4450000-0000-0000-0000-00000445aa01'
    GROUP BY l.principal, l.interest_rate), 0);

-- =====================================================
-- 7. OS COMENTARIOS -- A PARTE PERIGOSA, NAS DUAS DIRECOES
-- =====================================================
-- Esta migration nao cria view nem funcao, entao o comentario e a UNICA sonda de
-- colagem dela em producao (`migration-049-colada-md5-do-comment-prova`). E, mais
-- do que sonda, aqui ele e a propria entrega: a invariante que ele afirmava era
-- o unico lugar do banco onde "a soma fecha com o principal" existia.
--
-- Por isso as DUAS direcoes. So afirmar que o texto novo entrou deixaria passar
-- um `COMMENT ON` que rodasse e ainda carregasse a frase antiga; so afirmar que
-- a frase antiga saiu ficaria verde se o comentario tivesse sido APAGADO.
SELECT pg_temp.expect('o COMMENT de principal NAO afirma mais que a soma das parcelas fecha com ele',
  (SELECT count(*) FROM pg_description d
     JOIN pg_class c     ON c.oid = d.objoid
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid
    WHERE c.relname = 'mybank_loans'
      AND a.attname = 'principal'
      AND d.description LIKE '%tem de fechar com ele%'), 0);

SELECT pg_temp.expect('o COMMENT de principal declara o modelo novo (o que sai, o que volta, e o juro)',
  (SELECT count(*) FROM pg_description d
     JOIN pg_class c     ON c.oid = d.objoid
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid
    WHERE c.relname = 'mybank_loans'
      AND a.attname = 'principal'
      AND d.description LIKE '%HMO-444%'
      AND d.description LIKE '%SUM(amount) - principal%'
      AND d.description LIKE '%NAO existe constraint nem trigger%'), 1);

SELECT pg_temp.expect('o COMMENT de interest_kind explica o que total_simples significa',
  (SELECT count(*) FROM pg_description d
     JOIN pg_class c     ON c.oid = d.objoid
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid
    WHERE c.relname = 'mybank_loans'
      AND a.attname = 'interest_kind'
      AND d.description LIKE '%HMO-444%'
      AND d.description LIKE '%total_simples%'
      AND d.description LIKE '%principal x (1 + interest_rate)%'), 1);

-- O comentario de `interest_rate` nao pode continuar descrevendo a coluna como
-- "reservada para a fase de juros" nem mandando o leitor procurar a trava de
-- fase -- que esta migration acabou de apagar. Um comentario que nomeia uma
-- constraint inexistente faz quem for conferir a colagem em prod concluir que a
-- migration NAO foi colada.
SELECT pg_temp.expect('o COMMENT de interest_rate foi reescrito (nao descreve mais uma coluna reservada)',
  (SELECT count(*) FROM pg_description d
     JOIN pg_class c     ON c.oid = d.objoid
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid
    WHERE c.relname = 'mybank_loans'
      AND a.attname = 'interest_rate'
      AND d.description LIKE '%HMO-444%'
      AND d.description NOT LIKE '%Reservada para a fase de juros%'), 1);

-- =====================================================
-- 8. A 062 NAO AFROUXOU NADA DA 053
-- =====================================================
-- Esta migration faz tres `DROP CONSTRAINT IF EXISTS` nesta tabela. `IF EXISTS`
-- nao reclama de nome que nao existe, entao um nome ERRADO num daqueles DROP --
-- ou um DROP a mais, escrito por engano -- apaga uma trava da 053 em silencio e
-- nenhuma assercao das secoes de cima percebe.
--
-- As quatro travas da 053 que continuam sendo exigidas, pelo nome:
SELECT pg_temp.expect('as 4 constraints da 053 em mybank_loans continuam vivas',
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.mybank_loans'::regclass
      AND conname IN ('mybank_loans_principal_check',
                      'mybank_loans_installment_count_check',
                      'mybank_loans_status_check',
                      'mybank_loans_pkey')), 4);

-- E elas continuam TRAVANDO, e nao so existindo: principal <= 0 e emprestimo
-- que nao e emprestimo.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('principal = 0 continua RECUSADO depois da 062', $sql$
  INSERT INTO public.mybank_loans
    (lender_user_id, lender_account_id, borrower_user_id,
     description, principal, installment_count, first_due_date, interest_rate)
  VALUES
    ('b4450000-0000-0000-0000-0000000445aa',
     'c4450000-0000-0000-0000-00000445aa01',
     'b4450000-0000-0000-0000-0000000445aa',
     'Emprestimo de zero reais', 0, 12, '2026-11-10', 0.2)
$sql$, '23514'); END $$;

-- E a trava 1 da 053 (a conta credora tem de ser conta de investimento do
-- proprio credor) continua armada: a conta `checking` DO PROPRIO dono e
-- recusada. Sem esta assercao, um `DROP TRIGGER` perdido nesta migration nao
-- apareceria em lugar nenhum da suite.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('a trava da conta de investimento (053) continua armada depois da 062', $sql$
  INSERT INTO public.mybank_loans
    (lender_user_id, lender_account_id, borrower_user_id,
     description, principal, installment_count, first_due_date, interest_rate)
  VALUES
    ('b4450000-0000-0000-0000-0000000445aa',
     'c4450000-0000-0000-0000-00000445aa02',
     'b4450000-0000-0000-0000-0000000445aa',
     'Emprestando da conta corrente', 1000.00, 12, '2026-11-10', 0.2)
$sql$, '23514'); END $$;

ROLLBACK;
