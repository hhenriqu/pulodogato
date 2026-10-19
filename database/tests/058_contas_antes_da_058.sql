-- =====================================================
-- Contas plantadas ANTES da 058 (HMO-431)
-- =====================================================
-- Este arquivo nao testa nada. Ele existe para que a 058 tenha em que morder.
--
-- POR QUE ELE E NECESSARIO
-- ------------------------
-- A 058 so faz uma coisa: `ADD COLUMN include_in_total boolean NOT NULL
-- DEFAULT true`. A metade interessante dela nao e que a coluna passa a existir
-- -- e que TODA CONTA QUE JA EXISTIA passa a valer `true`, isto e, continua
-- somando nos totais exatamente como antes da migration.
--
-- Num banco construido do ZERO (que e o que o db-verify faz) essa metade nao
-- tem como ser medida: quando a 058 roda, as unicas contas do banco sao as que
-- as outras suites criaram dentro das transacoes delas, e todas ja sumiram no
-- ROLLBACK. `SELECT count(*) FROM financial_accounts WHERE include_in_total`
-- daria ZERO linhas, e zero de zero passa em qualquer assercao sobre "todas as
-- contas antigas vieram true" -- o vacuo que
-- `prod-vazia-invalida-prova-por-efeito-colateral` descreve.
--
-- Sem este arquivo, um mutante que trocasse o `DEFAULT true` por `DEFAULT
-- false` -- ou que adicionasse a coluna anulavel, sem default nenhum --
-- SOBREVIVERIA a suite inteira, porque nao haveria linha pre-existente para
-- delatar o valor errado. E esse mutante e dinheiro: ele tira todas as contas
-- de todos os totais no dia em que o codigo que le a coluna sobe.
--
-- AS DUAS CONTAS TEM PAPEIS DIFERENTES, e por isso sao duas:
--
--   - a PRIMEIRA nunca e tocada depois da migration. Ela prova o default sobre
--     linha pre-existente (secao 2 do teste);
--   - a SEGUNDA e desligada por `058_conta_desligada_do_total.sql`, DEPOIS da
--     migration e ANTES do re-run dela. Ela prova que re-colar o arquivo nao
--     religa uma conta que a pessoa desligou (secao 5) -- a razao pela qual a
--     058 nao tem `UPDATE` de backfill.
--
-- ELE COMITA, DE PROPOSITO
-- ------------------------
-- Sem COMMIT a 058 (que roda no passo seguinte, noutra sessao) nao veria nada.
-- As linhas ficam no banco do CI para o teste da 058 conferir.
--
-- `is_public = FALSE` EXPLICITO, e nao pelo default: `profiles.is_public` tem
-- DEFAULT true e a policy `profiles_select_own_or_public` deixa qualquer
-- usuario logado ler um perfil publico. Como este arquivo COMITA, um perfil
-- publico a mais no banco do CI derruba o controle de
-- `view_security_invoker_test.sql` -- a mesma armadilha documentada no
-- cabecalho de `056_contas_antes_da_056.sql` e de `027_historico_antes_da_027.sql`.
--
-- Os ids sao proprios deste arquivo e nenhum outro teste da cadeia os usa. O
-- bloco inteiro da 058 roda no FIM do job, depois de toda suite que conta
-- linhas, justamente para que plantar dado que sobrevive a transacao nao possa
-- alcancar ninguem.
--
-- Rodar ENTRE a 057 e a 058:
--   psql "$DB_URL" -f database/tests/058_contas_antes_da_058.sql
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a0580000-0000-0000-0000-000000000099', 'antes-da-058@teste.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name, is_public) VALUES
  ('a0580000-0000-0000-0000-000000000099', 'antes-da-058@teste.local',
   'Cadastro anterior a 058', FALSE)
ON CONFLICT (id) DO NOTHING;

-- As duas contas, do jeito que elas estao no banco de quem se cadastrou antes
-- desta migration: SEM a coluna `include_in_total`, que ainda nao existe neste
-- ponto da cadeia. E justamente por isso que o INSERT nao a menciona -- se ele
-- a mencionasse, este arquivo nao compilaria antes da 058 e deixaria de medir
-- o que foi feito para medir.
--
-- Nenhuma das duas e `credit_card`: o escopo de cartao soma por `Math.abs` e
-- tem a propria tela, e misturar os dois escopos aqui faria a assercao de
-- "todas vieram true" depender de qual soma as le. As duas sao conta corrente
-- e dinheiro, que e o par que o cadastro cria hoje (056).
INSERT INTO public.financial_accounts
  (id, user_id, name, account_type, icon, color_hex, current_balance) VALUES
  ('f0580000-0000-0000-0000-000000000001',
   'a0580000-0000-0000-0000-000000000099', 'Conta de antes da 058', 'checking',
   'building', '#10B981', 1234.56),
  ('f0580000-0000-0000-0000-000000000002',
   'a0580000-0000-0000-0000-000000000099', 'Conta que vai sair do total', 'savings',
   'piggy-bank', '#84CC16', 7000.00)
ON CONFLICT (id) DO NOTHING;

COMMIT;
