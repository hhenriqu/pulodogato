-- =====================================================
-- O emprestimo plantado ANTES da 062, e a prova de que a trava de fase ESTAVA
-- TRAVANDO (HMO-445, filha F1 da HMO-444)
-- =====================================================
-- Este arquivo faz DUAS coisas, e as duas tem de ser aqui porque este e o unico
-- ponto da cadeia em que a trava `mybank_loans_interest_rate_fase_1` da 053
-- ainda existe:
--
--   1. PLANTA um emprestimo com as parcelas fechando com o principal -- o mundo
--      de antes dos juros --, e COMITA. E nele que as secoes 2 e 7 da suite
--      medem o que acontece com as linhas QUE JA EXISTIAM;
--   2. PROVA que `interest_rate = 0.2` era RECUSADO neste ponto.
--
-- POR QUE A METADE (2) NAO PODE MORAR NA SUITE
-- --------------------------------------------
-- A prova que importa nesta migration e um par: o mesmo INSERT **falha antes** e
-- **passa depois**. A suite roda DEPOIS da 062, onde a trava ja nao existe --
-- lá o INSERT so pode ser medido pelo lado do "passa". Sem este arquivo, a
-- assercao de aceitacao da suite ficaria verde tambem contra uma 062 VAZIA (um
-- arquivo que nao solta nada, num banco onde a trava nunca tivesse sido colada),
-- porque nada teria afirmado que havia trava para soltar. E o modo de falha de
-- `guarda-de-ancora-verde-nao-prova-que-o-mutante-morre`.
--
-- O SQLSTATE SOZINHO NAO BASTA, E POR ISSO A ASSERCAO LE A MENSAGEM
-- ----------------------------------------------------------------
-- A trigger `mybank_loans_trava` da 053 tambem levanta `check_violation`
-- (`23514`) -- e com um uuid de conta errado na fixture, o INSERT seria recusado
-- por ELA e a assercao de "recusou com 23514" ficaria verde sem a trava de fase
-- ter sido consultada. Entao a assercao exige o NOME da constraint na mensagem.
--
-- POR QUE O EMPRESTIMO PLANTADO E UM AUTO-EMPRESTIMO
-- --------------------------------------------------
-- `borrower_user_id = lender_user_id` dispensa `user_connections`: a trava 2 da
-- 053 sai pelo desvio do auto-emprestimo antes de consultar a tabela de
-- conexoes. Uma conexao `accepted` a mais no banco do CI seria linha comitada
-- que nenhum step daqui para baixo pediu -- e esta fixture ja comita o que
-- precisa, nada mais.
--
-- ELE COMITA, DE PROPOSITO
-- ------------------------
-- Sem COMMIT a 062 (que roda no passo seguinte, noutra sessao) nao veria nada, e
-- o `ADD COLUMN interest_kind NOT NULL DEFAULT 'total_simples'` nao teria
-- nenhuma linha em que gravar o default. Num banco construido do ZERO essa
-- metade da migration e inobservavel: todo emprestimo que as outras suites criam
-- morre no ROLLBACK delas, `SELECT count(*) FROM mybank_loans` da zero, e zero de
-- zero passa em qualquer assercao sobre "as linhas antigas" -- o vacuo de
-- `prod-vazia-invalida-prova-por-efeito-colateral`. Com a linha plantada:
--
--   * um `DEFAULT` ausente no `ADD COLUMN` faz a PROPRIA COLAGEM morrer
--     ("column interest_kind contains null values");
--   * um `UPDATE ... SET interest_kind = ...` de "limpeza" aparece na secao 2.
--
-- E AQUI ISSO EXIGE CUIDADO: o bloco da 062 NAO fica no fim do job -- ele roda
-- logo depois do bloco da 061 e ANTES do step `schema-columns.json em dia`,
-- porque esta migration CRIA COLUNA (ver
-- `bloco-de-migration-que-cria-coluna-vai-antes-do-check-de-schema-columns`).
-- Entao estas linhas ficam visiveis para todo step dali para baixo. Medido que
-- nenhum deles se incomoda: os passos de RLS e de `anon` leem CATALOGO e nao
-- linha; os de deriva e o drill de backup constroem banco proprio; o teste da
-- 056 conta contas recortando pelo `user_id` DELE (`a0560000-...`), o da 058
-- pelo dele (`a0580000-...`), o da 059 pelo dele (`a0590000-...`), o da 060 pelo
-- dele (`a0600000-...`), o da 061 pelo dele (`a6100000-...`), e o usuario deste
-- arquivo e outro (`a0620000-...`). A suite da 053 roda MUITO acima (na posicao
-- dela), entao nao ve estas linhas.
--
-- O `a0620000-...` NAO E ENFEITE DE NUMERACAO: esta fixture nasceu `a0600000-...`
-- e a da HMO-443 usa o MESMO prefixo. As duas comitam, e o
-- `ON CONFLICT (id) DO NOTHING` abaixo teria reusado a linha DELA em silencio
-- -- com a conta que ela criou, que nao e de investimento, e a trava 1 da 053
-- recusaria o emprestimo desta fixture por um motivo que nao esta escrito em
-- lugar nenhum. A fixture da 061 usa `a6100000-...`, conferido como terceiro
-- prefixo distinto.
--
-- `is_public = FALSE` EXPLICITO, e nao pelo default: `profiles.is_public` tem
-- DEFAULT true e a policy `profiles_select_own_or_public` deixa qualquer usuario
-- logado ler um perfil publico. Como este arquivo COMITA, um perfil publico a
-- mais no banco do CI derruba o controle de `view_security_invoker_test.sql`
-- (que roda mais abaixo, depois da 057) -- a mesma armadilha documentada no
-- cabecalho de `056_contas_antes_da_056.sql`, de `058_contas_antes_da_058.sql` e
-- de `059_ativos_antes_da_059.sql`.
--
-- Rodar ENTRE o bloco da 061 e a 062:
--   psql "$DB_URL" -f database/tests/062_emprestimo_antes_da_062.sql
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a0620000-0000-0000-0000-000000000099', 'antes-da-062@teste.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name, is_public) VALUES
  ('a0620000-0000-0000-0000-000000000099', 'antes-da-062@teste.local',
   'Emprestimo anterior a 062', FALSE)
ON CONFLICT (id) DO NOTHING;

-- A conta credora. `investment` pela trava 1 da 053: a conta tem de ser conta de
-- investimento DO PROPRIO credor.
INSERT INTO public.financial_accounts
  (id, user_id, name, account_type, icon, color_hex, current_balance) VALUES
  ('f0620000-0000-0000-0000-000000000001',
   'a0620000-0000-0000-0000-000000000099', 'Corretora de antes da 062',
   'investment', 'trending-up', '#8B5CF6', 20000.00)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------
-- O emprestimo do mundo de ANTES dos juros
-- -----------------------------------------------------
-- Duas parcelas de R$ 500 para um principal de R$ 1.000: a soma FECHA com o
-- principal, que era a invariante que o comentario da 053 afirmava. Esta linha e
-- o controle da secao 7 da suite -- com juro 0, `principal x (1 + 0)` continua
-- sendo a soma das parcelas, e o modelo novo tem de continuar valendo para ela.
--
-- `interest_rate` NAO e mencionado: e o INSERT que o codigo em prod faz hoje, e
-- ele nao pode precisar de edicao por causa desta migration. O DEFAULT 0 da 053
-- responde.
INSERT INTO public.mybank_loans
  (id, lender_user_id, lender_account_id, borrower_user_id,
   description, principal, installment_count, first_due_date) VALUES
  ('d0620000-0000-0000-0000-000000000001',
   'a0620000-0000-0000-0000-000000000099',
   'f0620000-0000-0000-0000-000000000001',
   'a0620000-0000-0000-0000-000000000099',
   'Emprestimo sem juro, de antes da 062', 1000.00, 2, '2026-11-10')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.mybank_installments
  (id, loan_id, installment_number, installment_total, amount, due_date) VALUES
  ('e0620000-0000-0000-0000-000000000001',
   'd0620000-0000-0000-0000-000000000001', 1, 2, 500.00, '2026-11-10'),
  ('e0620000-0000-0000-0000-000000000002',
   'd0620000-0000-0000-0000-000000000001', 2, 2, 500.00, '2026-12-10')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------
-- A METADE (2): a trava de fase ESTA TRAVANDO neste ponto
-- -----------------------------------------------------
-- O bloco `EXCEPTION` do plpgsql e uma subtransacao: o INSERT recusado volta ao
-- savepoint e o COMMIT la embaixo continua levando as linhas plantadas acima.
--
-- As tres coisas afirmadas, nesta ordem de severidade:
--   * o banco RECUSOU (se aceitou, nao ha trava para a 062 soltar e o par
--     antes/depois da suite nao prova nada);
--   * recusou com `23514`;
--   * e foi a trava DE FASE -- o nome dela aparece na mensagem. Sem este item, a
--     recusa poderia estar vindo da trigger `mybank_loans_trava` por um uuid
--     errado nesta propria fixture.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.mybank_loans
      (lender_user_id, lender_account_id, borrower_user_id,
       description, principal, installment_count, first_due_date, interest_rate)
    VALUES
      ('a0620000-0000-0000-0000-000000000099',
       'f0620000-0000-0000-0000-000000000001',
       'a0620000-0000-0000-0000-000000000099',
       'Emprestimo com 20% de juro, ANTES da 062', 1000.00, 12, '2026-11-10', 0.2);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '23514' THEN
      RAISE EXCEPTION 'FALHA: interest_rate = 0.2 antes da 062 -> recusou com % e nao com 23514 (%)', SQLSTATE, SQLERRM;
    END IF;
    IF SQLERRM NOT LIKE '%mybank_loans_interest_rate_fase_1%' THEN
      RAISE EXCEPTION 'FALHA: interest_rate = 0.2 antes da 062 -> recusado com 23514, mas NAO pela trava de fase (%)', SQLERRM;
    END IF;
    RAISE NOTICE 'ok: antes da 062, interest_rate = 0.2 e recusado pela mybank_loans_interest_rate_fase_1';
    RETURN;
  END;
  RAISE EXCEPTION 'FALHA: interest_rate = 0.2 foi ACEITO ANTES da 062 -- a trava de fase da 053 nao esta neste banco, e a 062 nao tem o que soltar';
END $$;

COMMIT;
