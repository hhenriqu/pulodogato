-- =====================================================
-- Teste do MyBank -- emprestimo e parcelas (053)
-- =====================================================
-- HMO-369. Roda no db-verify, na POSICAO dele da cadeia -- contra o banco que
-- 001 -> ... -> 053 constroem do zero.
--
-- O QUE ESTE ARQUIVO AFIRMA
-- -------------------------
--   1. a trava da CONTA CREDORA: recusa conta corrente, recusa conta de outra
--      pessoa, e ACEITA a conta de investimento do proprio credor
--   2. a trava do DEVEDOR: recusa quem nao e conexao `accepted`, e ACEITA o
--      proprio credor (o auto-emprestimo, que e o caso principal da issue)
--   3. a janela do UPDATE: desfazer a conexao NAO impede encerrar a divida
--   4. o devedor leva `pending -> reported` e NAO consegue mexer no `amount`
--   5. a UNIQUE (loan_id, installment_number)
--   6. a view: `security_invoker` pelo catalogo, o devedor vendo a divida dele,
--      NAO vendo a de outro, e o auto-emprestimo FORA dela
--   7. `anon` sem alcance nenhum
--
-- POR QUE A SECAO 4 TEM DUAS ASSERCOES E NAO UMA
-- ----------------------------------------------
-- A issue pede "o devedor conseguindo pending -> reported e falhando ao mudar
-- amount". As duas coisas tem guardas DIFERENTES, e e isso que o arquivo
-- precisa separar:
--
--   * quem deixa o devedor CHEGAR na linha e a policy `mybank_installments_
--     update` (USING + WITH CHECK);
--   * quem o impede de REESCREVER O VALOR e a trigger `mybank_installments_
--     trava_do_devedor`, porque policy NAO consegue comparar NEW com OLD --
--     `USING` ve OLD, `WITH CHECK` ve NEW, nenhuma ve as duas. Com a policy
--     sozinha o devedor grava `amount = 0.01, status = 'reported'` num UPDATE
--     unico e passa pelas duas metades.
--
-- Por isso a SECAO 4 exige os DOIS SQLSTATEs: 42501 da trigger no caso do
-- `amount`, e sucesso no caso do aviso. Soltar o WITH CHECK mata uma; apagar a
-- trigger mata a outra. Nenhuma das duas e redundante.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 053:
--   psql "$DB_URL" -f database/tests/053_mybank_emprestimo_e_parcelas_test.sql
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

CREATE OR REPLACE FUNCTION pg_temp.expect_text(label TEXT, got TEXT, want TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- O que ERRA, com o SQLSTATE no contrato: sem ele a assercao viraria "deu
-- erro?", e aqui a diferenca entre 23514 (a trava do emprestimo), 42501 (a
-- trava do devedor / a RLS) e 23505 (a UNIQUE) e a propria decisao de desenho.
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
-- trava escrita larga demais fica verde em todo teste que so mede recusa.
CREATE OR REPLACE FUNCTION pg_temp.expect_aceita(label TEXT, sql TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RAISE NOTICE 'ok: % (aceito)', label;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FALHA: % -> o banco RECUSOU (% %), e devia aceitar', label, SQLSTATE, SQLERRM;
END $$;

-- =====================================================
-- Fixture
-- =====================================================
--   A = o credor            (conta de investimento + conta corrente)
--   B = conexao ACEITA de A (o caso B da issue: eu empresto, ela me paga)
--   C = SEM conexao com A   (o controle da trava 2)
--
-- C tem conexao `pending` com A, e nao "nenhuma linha": sem conexao alguma, a
-- trava passaria pelo `NOT EXISTS` mesmo se o `status = 'accepted'` tivesse
-- sido esquecido na consulta. E o `pending` que distingue "nao tem conexao" de
-- "tem conexao que ainda nao vale".
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-00000000369a', 'a369@ci.local'),
  ('b0000000-0000-0000-0000-00000000369b', 'b369@ci.local'),
  ('c0000000-0000-0000-0000-00000000369c', 'c369@ci.local'),
  ('d0000000-0000-0000-0000-00000000369d', 'd369@ci.local');

INSERT INTO public.profiles (id, full_name) VALUES
  ('a0000000-0000-0000-0000-00000000369a', 'A, a credora'),
  ('b0000000-0000-0000-0000-00000000369b', 'B, a conexao aceita'),
  ('c0000000-0000-0000-0000-00000000369c', 'C, sem conexao'),
  ('d0000000-0000-0000-0000-00000000369d', 'D, a conexao aceita DO OUTRO LADO');

INSERT INTO public.financial_accounts (id, user_id, name, account_type) VALUES
  -- a conta credora legitima
  ('ac000000-0000-0000-0000-0000000369a1', 'a0000000-0000-0000-0000-00000000369a', 'Investimento do A', 'investment'),
  -- a conta corrente do MESMO dono: o controle da metade "account_type" da trava 1
  ('ac000000-0000-0000-0000-0000000369a2', 'a0000000-0000-0000-0000-00000000369a', 'Corrente do A',     'checking'),
  -- conta de investimento de OUTRA pessoa: o controle da metade "dono" da trava 1.
  -- As duas metades precisam de controle proprio, senao uma trava que confere
  -- so uma delas fica verde.
  ('ac000000-0000-0000-0000-0000000369b1', 'b0000000-0000-0000-0000-00000000369b', 'Investimento do B', 'investment');

-- A -> B aceita: o credor e o REQUESTER.
INSERT INTO public.user_connections (requester_id, requested_id, status, responded_at) VALUES
  ('a0000000-0000-0000-0000-00000000369a', 'b0000000-0000-0000-0000-00000000369b', 'accepted', now());

-- D -> A aceita: o credor e o REQUESTED, e e o MESMO par de pessoas conectadas.
-- A conexao nao tem lado -- quem pediu nao e quem empresta --, mas a consulta da
-- trava TEM de olhar os dois sentidos, e uma escrita so com
-- `requester_id = lender AND requested_id = borrower` fica VERDE em todo o resto
-- deste arquivo. E o unico fixture que distingue as duas.
INSERT INTO public.user_connections (requester_id, requested_id, status, responded_at) VALUES
  ('d0000000-0000-0000-0000-00000000369d', 'a0000000-0000-0000-0000-00000000369a', 'accepted', now());

-- A -> C PENDENTE, e nao "nenhuma linha": sem conexao alguma, a trava passaria
-- pelo `NOT EXISTS` mesmo se o `status = 'accepted'` tivesse sido esquecido na
-- consulta. E o `pending` que distingue "nao tem conexao" de "tem conexao que
-- ainda nao vale".
INSERT INTO public.user_connections (requester_id, requested_id, status) VALUES
  ('a0000000-0000-0000-0000-00000000369a', 'c0000000-0000-0000-0000-00000000369c', 'pending');

-- =====================================================
-- SECAO 1: a trava da conta credora
-- =====================================================
-- Fora de qualquer sessao de app (postgres): o que se mede aqui e a TRIGGER, nao
-- a RLS. As duas sao travas diferentes e o teste nao as mistura -- se estas
-- recusas dependessem da RLS, apagar a trigger continuaria verde.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('a conta CORRENTE nao empresta', $sql$
  INSERT INTO public.mybank_loans
         (lender_user_id, lender_account_id, borrower_user_id, description,
          principal, installment_count, first_due_date)
  VALUES ('a0000000-0000-0000-0000-00000000369a',
          'ac000000-0000-0000-0000-0000000369a2',
          'a0000000-0000-0000-0000-00000000369a',
          'moto pela conta corrente', 24000.00, 24, '2026-11-10')
$sql$, '23514'); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_recusa('a conta de investimento de OUTRO nao empresta', $sql$
  INSERT INTO public.mybank_loans
         (lender_user_id, lender_account_id, borrower_user_id, description,
          principal, installment_count, first_due_date)
  VALUES ('a0000000-0000-0000-0000-00000000369a',
          'ac000000-0000-0000-0000-0000000369b1',
          'a0000000-0000-0000-0000-00000000369a',
          'moto pela conta do B', 24000.00, 24, '2026-11-10')
$sql$, '23514'); END $$;

-- =====================================================
-- SECAO 2: a trava do devedor
-- =====================================================
DO $$ BEGIN PERFORM pg_temp.expect_recusa('devedor SEM conexao accepted e recusado', $sql$
  INSERT INTO public.mybank_loans
         (lender_user_id, lender_account_id, borrower_user_id, description,
          principal, installment_count, first_due_date)
  VALUES ('a0000000-0000-0000-0000-00000000369a',
          'ac000000-0000-0000-0000-0000000369a1',
          'c0000000-0000-0000-0000-00000000369c',
          'moto para o C', 24000.00, 24, '2026-11-10')
$sql$, '23514'); END $$;

-- O CASO PRINCIPAL DA ISSUE: emprestar para si mesmo.
--
-- Esta assercao e a que impede a trava 2 de ser escrita como "tem de haver
-- conexao accepted", sem o desvio do auto-emprestimo. `user_connections` tem
-- `CHECK (requester_id <> requested_id)`, ou seja ninguem e conexao de si
-- mesmo: uma trava sem o desvio recusaria justamente o caso A da HMO-368 --
-- "a moto que eu pago para mim mesmo" --, e as tres recusas acima continuariam
-- verdes.
DO $$ BEGIN PERFORM pg_temp.expect_aceita('borrower = lender (auto-emprestimo) e ACEITO', $sql$
  INSERT INTO public.mybank_loans
         (id, lender_user_id, lender_account_id, borrower_user_id, description,
          principal, installment_count, first_due_date)
  VALUES ('10000000-0000-0000-0000-000000000369',
          'a0000000-0000-0000-0000-00000000369a',
          'ac000000-0000-0000-0000-0000000369a1',
          'a0000000-0000-0000-0000-00000000369a',
          'Moto eletrica (eu pago para mim)', 24000.00, 24, '2026-11-10')
$sql$); END $$;

-- E o caso B: a conexao aceita.
DO $$ BEGIN PERFORM pg_temp.expect_aceita('emprestimo para conexao ACCEPTED e aceito', $sql$
  INSERT INTO public.mybank_loans
         (id, lender_user_id, lender_account_id, borrower_user_id, description,
          principal, installment_count, first_due_date)
  VALUES ('20000000-0000-0000-0000-000000000369',
          'a0000000-0000-0000-0000-00000000369a',
          'ac000000-0000-0000-0000-0000000369a1',
          'b0000000-0000-0000-0000-00000000369b',
          'Moto da B (ela me paga em 24x)', 24000.00, 24, '2026-11-10')
$sql$); END $$;

-- E A CONEXAO VALE NOS DOIS SENTIDOS. D pediu, A aceitou -- A continua podendo
-- emprestar para D. Sem esta assercao, uma trava escrita so com
-- `requester_id = lender AND requested_id = borrower` passaria em todo o resto
-- do arquivo e recusaria metade das conexoes reais do app, dependendo so de
-- quem clicou em "conectar" primeiro.
DO $$ BEGIN PERFORM pg_temp.expect_aceita('a conexao vale tambem quando o CREDOR foi o requested', $sql$
  INSERT INTO public.mybank_loans
         (id, lender_user_id, lender_account_id, borrower_user_id, description,
          principal, installment_count, first_due_date)
  VALUES ('30000000-0000-0000-0000-000000000369',
          'a0000000-0000-0000-0000-00000000369a',
          'ac000000-0000-0000-0000-0000000369a1',
          'd0000000-0000-0000-0000-00000000369d',
          'Emprestimo para o D (ele pediu a conexao)', 1200.00, 12, '2026-11-10')
$sql$); END $$;

-- Repontar o emprestimo para a conta corrente DEPOIS de criado tambem bate na
-- trava: o UPDATE e conferido, e nao so o INSERT.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('repontar para a conta corrente no UPDATE e recusado', $sql$
  UPDATE public.mybank_loans
     SET lender_account_id = 'ac000000-0000-0000-0000-0000000369a2'
   WHERE id = '20000000-0000-0000-0000-000000000369'
$sql$, '23514'); END $$;

-- A trava de fase dos juros.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('juro diferente de 0 e recusado na fase 1', $sql$
  UPDATE public.mybank_loans SET interest_rate = 0.015
   WHERE id = '20000000-0000-0000-0000-000000000369'
$sql$, '23514'); END $$;

-- =====================================================
-- SECAO 3: desfazer a conexao NAO tranca a divida
-- =====================================================
-- A trigger so re-valida quando `lender_user_id`, `lender_account_id` ou
-- `borrower_user_id` mudam. Sem essa janela, desfazer uma conexao transformaria
-- todo emprestimo daquela pessoa em linha impossivel de encerrar: o credor nao
-- conseguiria marcar `settled` nem `cancelled`, a divida ficaria eternamente
-- `active` e a unica saida seria mexer no banco a mao.
--
-- Esta e a assercao que distingue a trava certa da trava larga, e ela e a razao
-- de o `IS DISTINCT FROM` da migration existir.
DELETE FROM public.user_connections
 WHERE requester_id = 'a0000000-0000-0000-0000-00000000369a'
   AND requested_id = 'b0000000-0000-0000-0000-00000000369b';

DO $$ BEGIN PERFORM pg_temp.expect_aceita('sem a conexao, o credor ainda ENCERRA a divida', $sql$
  UPDATE public.mybank_loans SET status = 'settled'
   WHERE id = '20000000-0000-0000-0000-000000000369'
$sql$); END $$;

-- Mas criar uma divida NOVA para ela ja nao da: a conexao e requisito para
-- CRIAR. Sem esta, a assercao de cima teria provado que a trava nao vale mais
-- nada depois do DELETE.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('sem a conexao, nao nasce divida nova', $sql$
  INSERT INTO public.mybank_loans
         (lender_user_id, lender_account_id, borrower_user_id, description,
          principal, installment_count, first_due_date)
  VALUES ('a0000000-0000-0000-0000-00000000369a',
          'ac000000-0000-0000-0000-0000000369a1',
          'b0000000-0000-0000-0000-00000000369b',
          'divida depois do desfazimento', 100.00, 1, '2026-12-10')
$sql$, '23514'); END $$;

-- Reata a conexao e devolve o emprestimo para `active`: as secoes seguintes
-- medem a divida viva da B.
INSERT INTO public.user_connections (requester_id, requested_id, status, responded_at)
VALUES ('a0000000-0000-0000-0000-00000000369a', 'b0000000-0000-0000-0000-00000000369b', 'accepted', now());
UPDATE public.mybank_loans SET status = 'active'
 WHERE id = '20000000-0000-0000-0000-000000000369';

-- =====================================================
-- SECAO 4: as parcelas, a UNIQUE, e o que o devedor consegue
-- =====================================================
-- Duas parcelas em cada emprestimo: a 1 e a 2 de 24.
INSERT INTO public.mybank_installments
       (id, loan_id, installment_number, installment_total, amount, due_date)
VALUES ('f1000000-0000-0000-0000-000000000369', '20000000-0000-0000-0000-000000000369', 1, 24, 1000.00, '2026-11-10'),
       ('f2000000-0000-0000-0000-000000000369', '20000000-0000-0000-0000-000000000369', 2, 24, 1000.00, '2026-12-10'),
       ('f3000000-0000-0000-0000-000000000369', '10000000-0000-0000-0000-000000000369', 1, 24, 1000.00, '2026-11-10');

-- A UNIQUE DE DINHEIRO. Duas parcelas "1 de 24" no mesmo emprestimo apareceriam
-- duas vezes em Contas a Pagar, e a soma das parcelas deixaria de fechar com o
-- principal sem que nenhuma linha estivesse errada sozinha.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('a parcela 1/24 repetida no MESMO emprestimo e recusada', $sql$
  INSERT INTO public.mybank_installments
         (loan_id, installment_number, installment_total, amount, due_date)
  VALUES ('20000000-0000-0000-0000-000000000369', 1, 24, 1000.00, '2026-11-10')
$sql$, '23505'); END $$;

-- ...e o controle: a mesma parcela 1/24 no OUTRO emprestimo entra. Sem ele, uma
-- UNIQUE escrita so em `(installment_number)` -- sem o `loan_id` -- passaria na
-- assercao de cima.
DO $$ BEGIN PERFORM pg_temp.expect('a parcela 1/24 existe nos DOIS emprestimos',
  (SELECT count(*) FROM public.mybank_installments WHERE installment_number = 1), 2); END $$;

-- ---------------------------------------------------------------------------
-- O devedor, sob RLS
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000369b';

-- Ela ve a divida dela -- e so a dela. As duas parcelas do emprestimo dela, e
-- nenhuma das do auto-emprestimo do A.
DO $$ BEGIN PERFORM pg_temp.expect('a devedora ve as 2 parcelas dela',
  (SELECT count(*) FROM public.mybank_installments), 2); END $$;
DO $$ BEGIN PERFORM pg_temp.expect('a devedora ve 1 emprestimo (o dela), nao os 2',
  (SELECT count(*) FROM public.mybank_loans), 1); END $$;

-- O QUE ELA CONSEGUE: avisar que pagou.
DO $$ BEGIN PERFORM pg_temp.expect_aceita('a devedora leva pending -> reported', $sql$
  UPDATE public.mybank_installments
     SET status = 'reported', reported_at = now()
   WHERE id = 'f1000000-0000-0000-0000-000000000369'
$sql$); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_text('a parcela ficou reported',
  (SELECT status FROM public.mybank_installments WHERE id = 'f1000000-0000-0000-0000-000000000369'),
  'reported'); END $$;

-- O QUE ELA NAO CONSEGUE, E ESTA E A ASSERCAO CENTRAL DO ARQUIVO
-- --------------------------------------------------------------
-- Reescrever o valor da divida. Num UPDATE UNICO, junto com o aviso -- que e a
-- forma que passa pela policy: `USING` ve a linha antiga (era pending, sou a
-- devedora: ok) e `WITH CHECK` ve a nova (ficou reported, continuo a devedora:
-- ok). As duas metades da policy aprovam. Quem recusa e a TRIGGER, que e a
-- unica coisa no Postgres que ve OLD e NEW ao mesmo tempo.
--
-- Soltar o `WITH CHECK` da policy NAO mata esta assercao (a trigger continua
-- pegando), e apagar a trigger NAO mata a de cima. Sao duas guardas com dois
-- mutantes, e nenhuma cobre a outra.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('a devedora NAO reescreve o amount junto com o aviso', $sql$
  UPDATE public.mybank_installments
     SET status = 'reported', reported_at = now(), amount = 0.01
   WHERE id = 'f2000000-0000-0000-0000-000000000369'
$sql$, '42501'); END $$;

DO $$ BEGIN PERFORM pg_temp.expect('o amount da parcela 2 continua 1000.00',
  (SELECT (amount * 100)::bigint FROM public.mybank_installments
    WHERE id = 'f2000000-0000-0000-0000-000000000369'), 100000); END $$;

-- Nem o vencimento, nem dar-se por paga.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('a devedora NAO empurra o vencimento', $sql$
  UPDATE public.mybank_installments
     SET status = 'reported', reported_at = now(), due_date = '2027-12-10'
   WHERE id = 'f2000000-0000-0000-0000-000000000369'
$sql$, '42501'); END $$;

-- `paid` e do credor: quem ve o dinheiro chegar e quem confirma (HMO-366).
-- A policy ja barra esta (o WITH CHECK exige `reported`), e a trigger tambem --
-- as duas respondem 42501 e a assercao nao distingue qual delas falou. Ela esta
-- aqui pelo ESTADO, nao pelo mecanismo: o que nao pode e a parcela ficar paga
-- por decisao de quem deve.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('a devedora NAO marca a parcela como paga', $sql$
  UPDATE public.mybank_installments
     SET status = 'paid', paid_date = current_date
   WHERE id = 'f2000000-0000-0000-0000-000000000369'
$sql$, '42501'); END $$;

-- E ela nao cria divida nenhuma, nem para si mesma.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('a devedora NAO cria emprestimo no nome do credor', $sql$
  INSERT INTO public.mybank_loans
         (lender_user_id, lender_account_id, borrower_user_id, description,
          principal, installment_count, first_due_date)
  VALUES ('a0000000-0000-0000-0000-00000000369a',
          'ac000000-0000-0000-0000-0000000369a1',
          'b0000000-0000-0000-0000-00000000369b',
          'divida que a devedora inventou', 1.00, 1, '2026-11-10')
$sql$, '42501'); END $$;

-- =====================================================
-- SECAO 4.1: o caminho em que a TRIGGER e a unica guarda
-- =====================================================
-- Tudo da SECAO 4 foi medido com a RLS ligada, e nesse caminho a policy e a
-- trigger se sobrepoem: a policy exige `OLD.status = 'pending'` no USING, entao
-- a devedora nunca alcanca uma parcela que nao esteja pendente, e a conferencia
-- de transicao da trigger nunca e o que fala. Medido: com a conferencia de
-- transicao da trigger apagada, TODA a SECAO 4 continua verde.
--
-- O caminho onde ela e a UNICA guarda e o de uma funcao `SECURITY DEFINER` --
-- que e exatamente o que a F2 vai usar para materializar a serie de parcelas.
-- Dentro dela a RLS NAO se aplica (o dono da tabela bypassa as policies), mas
-- `auth.uid()` continua devolvendo quem clicou, porque le o claim da SESSAO e
-- nao o role. Uma RPC assim, escrita sem cuidado, passaria o pedido da devedora
-- direto para o UPDATE e as policies nao estariam la para recusar.
--
-- Reproduzido aqui do jeito mais honesto disponivel: o role volta a ser o dono
-- das tabelas (RLS fora do caminho) e o claim CONTINUA sendo o da devedora.
RESET ROLE;

-- A DEVEDORA NAO CANCELA A PROPRIA PARCELA.
--
-- Esta e a assercao que isola a conferencia de TRANSICAO da trigger, e ela
-- precisou ser procurada: as outras tentativas da devedora mexem num campo que
-- o pin de colunas ja protege (`paid_date` para se dar por paga, `amount`,
-- `due_date`), entao todas continuam vermelhas mesmo com a transicao apagada --
-- e o mutante `transicao-do-devedor` SOBREVIVIA a suite inteira.
--
-- `cancelled` nao toca nenhuma coluna pinada: muda so o `status`. Sem a
-- conferencia de transicao, a devedora apaga a divida mudando uma palavra --
-- a parcela sai de Contas a Pagar dela E do "a receber" do credor, sem que
-- ninguem tenha pago nada. E o unico caminho em que essa conferencia e a unica
-- coisa entre o pedido e o banco.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('sem RLS no caminho, a devedora NAO cancela a propria parcela', $sql$
  UPDATE public.mybank_installments
     SET status = 'cancelled'
   WHERE id = 'f2000000-0000-0000-0000-000000000369'
$sql$, '42501'); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_recusa('sem RLS no caminho, a devedora ainda NAO se da por paga', $sql$
  UPDATE public.mybank_installments
     SET status = 'paid', paid_date = current_date
   WHERE id = 'f2000000-0000-0000-0000-000000000369'
$sql$, '42501'); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_recusa('sem RLS no caminho, a devedora ainda NAO reescreve o amount', $sql$
  UPDATE public.mybank_installments
     SET status = 'reported', reported_at = now(), amount = 0.01
   WHERE id = 'f2000000-0000-0000-0000-000000000369'
$sql$, '42501'); END $$;

-- E o controle que prova que as duas recusas acima sao a TRIGGER e nao a RLS
-- (que aqui nao esta no caminho): com o claim do CREDOR, o mesmo UPDATE passa.
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000369a';
DO $$ BEGIN PERFORM pg_temp.expect_aceita('e com o claim do CREDOR o mesmo UPDATE passa', $sql$
  UPDATE public.mybank_installments SET amount = 1000.00
   WHERE id = 'f2000000-0000-0000-0000-000000000369'
$sql$); END $$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000369b';

-- =====================================================
-- SECAO 5: a view do devedor
-- =====================================================
-- A devedora ve as duas parcelas dela na view (a `reported` CONTINUA
-- aparecendo: ela avisou e o credor ainda nao confirmou, e sumir da tela nesse
-- intervalo faria a conta parecer paga).
DO $$ BEGIN PERFORM pg_temp.expect('a view devolve as 2 parcelas da devedora',
  (SELECT count(*) FROM public.mybank_due_entries), 2); END $$;

DO $$ BEGIN PERFORM pg_temp.expect('a view mostra a parcela reported tambem',
  (SELECT count(*) FROM public.mybank_due_entries WHERE status = 'reported'), 1); END $$;

-- O "3 de 24" e o credor, que e o que a issue pede na tela.
DO $$ BEGIN PERFORM pg_temp.expect_text('a view diz de quem e a divida e qual parcela',
  (SELECT installment_number || ' de ' || installment_total || ' para ' || lender_user_id::text
     FROM public.mybank_due_entries WHERE installment_number = 2),
  '2 de 24 para a0000000-0000-0000-0000-00000000369a'); END $$;

RESET ROLE;
RESET request.jwt.claim.sub;

-- ---------------------------------------------------------------------------
-- O AUTO-EMPRESTIMO FICA FORA DA VIEW, E ISSO E SOBRE DINHEIRO
-- ---------------------------------------------------------------------------
-- A parcela do auto-emprestimo ja e uma TRANSFERENCIA PREVISTA em
-- `scheduled_transactions` (decisao 1 da HMO-368) e ja aparece em Contas a
-- Pagar pelo caminho que existe. Se a view a devolvesse tambem, a F2 uniria as
-- duas fontes e a MESMA parcela apareceria duas vezes na tela e contaria duas
-- vezes no total.
--
-- O A tem uma parcela (`f3...`) e e credor E devedor dela. A view tem de
-- devolver ZERO para ele -- e o `expect` de baixo e o unico lugar do
-- repositorio que afirma isso.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000369a';

DO $$ BEGIN PERFORM pg_temp.expect('o AUTO-emprestimo nao aparece na view (nao contar duas vezes)',
  (SELECT count(*) FROM public.mybank_due_entries), 0); END $$;

-- ...e o controle que prova que o zero acima nao e a view quebrada: o credor
-- ENXERGA a parcela na TABELA. Sem esta linha, `security_invoker` mal escrito
-- ou um JOIN que descarta tudo dariam o mesmo zero.
DO $$ BEGIN PERFORM pg_temp.expect('mas o credor ve as 3 parcelas na tabela',
  (SELECT count(*) FROM public.mybank_installments), 3); END $$;

-- O credor confirma o pagamento: e dele o `paid`.
DO $$ BEGIN PERFORM pg_temp.expect_aceita('o credor confirma a parcela (reported -> paid)', $sql$
  UPDATE public.mybank_installments
     SET status = 'paid', paid_date = current_date
   WHERE id = 'f1000000-0000-0000-0000-000000000369'
$sql$); END $$;

-- E com uma parcela paga o emprestimo nao se apaga mais: o DELETE levaria a
-- parcela junto pelo CASCADE, e aquela parcela e historico de dinheiro.
-- Emprestimo que andou se encerra com `status = 'cancelled'`.
-- `GET DIAGNOSTICS` e nao um `DELETE ... RETURNING` dentro de subconsulta: o
-- Postgres recusa CTE que escreve fora do nivel de cima. E e ROW_COUNT, e nao
-- "deu erro", porque a RLS NAO ERRA num DELETE que nao casa -- ela devolve
-- sucesso com zero linha. Um `expect_recusa` aqui ficaria vermelho sobre um
-- banco certo (e verde sobre um errado, se a policy desaparecesse).
DO $$
DECLARE
  v_apagados integer;
BEGIN
  DELETE FROM public.mybank_loans WHERE id = '20000000-0000-0000-0000-000000000369';
  GET DIAGNOSTICS v_apagados = ROW_COUNT;
  PERFORM pg_temp.expect('com parcela paga, o DELETE do emprestimo nao alcanca linha',
                         v_apagados::bigint, 0::bigint);
END $$;

RESET ROLE;
RESET request.jwt.claim.sub;

DO $$ BEGIN PERFORM pg_temp.expect('o emprestimo com parcela paga continua la',
  (SELECT count(*) FROM public.mybank_loans
    WHERE id = '20000000-0000-0000-0000-000000000369'), 1); END $$;

-- =====================================================
-- SECAO 6: o catalogo -- security_invoker e o alcance do anon
-- =====================================================
-- A view SEM `security_invoker` roda com o privilegio do DONO e fura a RLS das
-- duas tabelas: ela passaria a devolver a divida de todo mundo para qualquer
-- um que a consultasse. O `WHERE borrower_user_id = auth.uid()` nao substitui
-- isso.
--
-- Esta assercao e de CATALOGO porque o comportamento dela, neste banco, e
-- indistinguivel: o dono das tabelas aqui e o `postgres`, que ja bypassa RLS
-- por ser superusuario, entao um teste so de comportamento ficaria VERDE com a
-- view furada. `reloptions` e o unico lugar onde a diferenca aparece -- e
-- `CREATE OR REPLACE VIEW` APAGA reloptions, que e o caminho real pelo qual
-- isto se perde.
DO $$ BEGIN PERFORM pg_temp.expect('mybank_due_entries tem security_invoker=true',
  (SELECT count(*) FROM pg_class
    WHERE oid = to_regclass('public.mybank_due_entries')
      AND reloptions @> ARRAY['security_invoker=true']), 1); END $$;

-- O `pg_get_viewdef` da view, provando que o filtro do devedor e a exclusao do
-- auto-emprestimo estao na DEFINICAO -- e nao numa versao anterior do arquivo.
DO $$
DECLARE
  v_def text := pg_get_viewdef('public.mybank_due_entries'::regclass, true);
BEGIN
  IF v_def NOT LIKE '%borrower_user_id = auth.uid()%' THEN
    RAISE EXCEPTION 'FALHA: a view nao filtra borrower_user_id = auth.uid(); viewdef: %', v_def;
  END IF;
  IF v_def NOT LIKE '%IS DISTINCT FROM%' THEN
    RAISE EXCEPTION 'FALHA: a view nao exclui o auto-emprestimo (borrower IS DISTINCT FROM lender); viewdef: %', v_def;
  END IF;
  -- JOIN com financial_accounts na view security_invoker DESCARTARIA a linha
  -- para o devedor (a conta e do credor, e a RLS dela e user_id = auth.uid()) e
  -- a view ficaria vazia sem erro nenhum.
  IF v_def LIKE '%financial_accounts%' THEN
    RAISE EXCEPTION 'FALHA: a view passou a ler financial_accounts; a RLS da conta do CREDOR descartaria a linha e a view ficaria vazia para o devedor. viewdef: %', v_def;
  END IF;
  RAISE NOTICE 'ok: o viewdef filtra o devedor, exclui o auto-emprestimo e nao toca financial_accounts';
END $$;

-- `anon` nao alcanca nada do MyBank. O 002 rodou `GRANT ... ON ALL TABLES`
-- antes destas tabelas existirem, e ALL TABLES e uma fotografia do momento --
-- entao isto nao e automatico, e o REVOKE da migration e que responde.
DO $$ BEGIN PERFORM pg_temp.expect('anon nao le mybank_loans',
  (SELECT count(*) FROM (SELECT has_table_privilege('anon', 'public.mybank_loans', 'SELECT') AS p) s
    WHERE p), 0); END $$;
DO $$ BEGIN PERFORM pg_temp.expect('anon nao le mybank_installments',
  (SELECT count(*) FROM (SELECT has_table_privilege('anon', 'public.mybank_installments', 'SELECT') AS p) s
    WHERE p), 0); END $$;
DO $$ BEGIN PERFORM pg_temp.expect('anon nao le mybank_due_entries',
  (SELECT count(*) FROM (SELECT has_table_privilege('anon', 'public.mybank_due_entries', 'SELECT') AS p) s
    WHERE p), 0); END $$;

-- As funcoes das travas sao DEFINER: `anon` com EXECUTE nelas seria rodar
-- codigo com o privilegio do dono a partir de uma sessao nao autenticada. O
-- Postgres concede EXECUTE a PUBLIC por default, entao so o `REVOKE ... FROM
-- PUBLIC` da migration e que tira isto -- um revoke apenas do `anon` nao tira
-- nada, porque o privilegio dele e herdado.
DO $$ BEGIN PERFORM pg_temp.expect('anon nao executa mybank_loans_trava',
  (SELECT count(*) FROM (SELECT has_function_privilege('anon',
     'public.mybank_loans_trava()', 'EXECUTE') AS p) s WHERE p), 0); END $$;
DO $$ BEGIN PERFORM pg_temp.expect('anon nao executa mybank_installments_trava_do_devedor',
  (SELECT count(*) FROM (SELECT has_function_privilege('anon',
     'public.mybank_installments_trava_do_devedor()', 'EXECUTE') AS p) s WHERE p), 0); END $$;

ROLLBACK;
