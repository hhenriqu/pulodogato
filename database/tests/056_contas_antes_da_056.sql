-- =====================================================
-- Contas plantadas ANTES da 056 (HMO-412)
-- =====================================================
-- Este arquivo nao testa nada. Ele existe para que a 056 tenha em que NAO
-- morder.
--
-- POR QUE ELE E NECESSARIO
-- ------------------------
-- A decisao da HMO-412 tem duas metades, e so uma delas se prova num banco
-- construido do zero:
--
--   1. o usuario NOVO passa a receber duas contas  -- o teste da 056 mede isso
--      sozinho, chamando a funcao;
--   2. NAO HA BACKFILL: quem ja tem uma conta PIX ou um cartao criados pelo
--      cadastro CONTINUA com eles -- e esta metade nao tem como ser medida sem
--      que exista, no banco, uma conta dessas de ANTES.
--
-- O db-verify constroi o banco do ZERO. Quando a 056 roda, as unicas contas
-- PIX e `credit_card` do banco sao as que os outros testes criaram dentro das
-- transacoes deles, e todas ja sumiram no ROLLBACK. Um `DELETE FROM
-- financial_accounts WHERE account_type IN ('credit_card','digital')` dentro
-- da 056 tocaria ZERO linhas, e nenhuma assercao sobre o estado final
-- distinguiria "nao tem backfill" de "tem um backfill que nao achou nada".
--
-- MEDIDO, e e por isso que este arquivo existe: num Postgres 17 local, com a
-- cadeia 001 -> 054, o mutante `backfill_apaga_pix_e_cartao` (a 056 mais aquele
-- DELETE) SOBREVIVEU ao arquivo de teste inteiro -- 13 dos 14 mutantes morriam
-- e esse ficava verde. Com as duas contas deste arquivo plantadas antes, ele
-- morre na secao 5.
--
-- E o mutante nao e academico: e a implementacao que alguem escreve de boa fe
-- ao ler "agora so existem duas contas padrao" como "entao limpe as outras".
-- O cartao plantado abaixo tem um lancamento de R$ 150,00 pendurado nele --
-- `financial_transactions.account_id` --, que e o dinheiro que esse DELETE
-- levaria junto.
--
-- ELE COMITA, DE PROPOSITO
-- ------------------------
-- Sem COMMIT a 056 (que roda no passo seguinte, noutra sessao) nao veria nada.
-- As linhas ficam no banco do CI para o teste da 056 conferir.
--
-- `is_public = FALSE` EXPLICITO, e nao pelo default: `profiles.is_public` tem
-- DEFAULT true e a policy `profiles_select_own_or_public` deixa qualquer
-- usuario logado ler um perfil publico. Como este arquivo COMITA, um perfil
-- publico a mais no banco do CI derruba o controle de
-- `view_security_invoker_test.sql` -- ver o cabecalho de
-- `027_historico_antes_da_027.sql`, onde essa armadilha ja custou um vermelho
-- que falava de RLS num arquivo sem relacao nenhuma com a feature.
--
-- Os ids sao proprios deste arquivo e nenhum outro teste da cadeia os usa. O
-- bloco inteiro da 056 roda no FIM do job, depois de toda suite que conta
-- linhas, justamente para que plantar dado que sobrevive a transacao nao possa
-- alcancar ninguem.
--
-- Rodar ENTRE a 054 e a 056:
--   psql "$DB_URL" -f database/tests/056_contas_antes_da_056.sql
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a0560000-0000-0000-0000-000000000099', 'antes-da-056@teste.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name, is_public) VALUES
  ('a0560000-0000-0000-0000-000000000099', 'antes-da-056@teste.local',
   'Cadastro anterior a 056', FALSE)
ON CONFLICT (id) DO NOTHING;

-- As DUAS contas que a 056 deixa de criar, do jeito que o cadastro as criava:
-- mesmo nome, mesmo `account_type`, mesmo icone e mesma cor do 001. E assim
-- que elas estao no banco de producao de quem se cadastrou antes desta
-- migration, e e exatamente esse par que um backfill "de limpeza" miraria.
INSERT INTO public.financial_accounts
  (id, user_id, name, account_type, icon, color_hex, current_balance, credit_limit) VALUES
-- O cartao nasce ZERADO aqui de proposito: quem move o saldo e o
-- `update_account_balance_trigger` do 001, quando o lancamento abaixo entra.
-- Cravar -150,00 nesta linha E inserir o lancamento deixaria a conta em
-- -300,00 -- o dinheiro contado duas vezes, e a assercao da secao 5 passaria a
-- fixar um numero que o banco nunca produz sozinho.
  ('f0560000-0000-0000-0000-000000000001',
   'a0560000-0000-0000-0000-000000000099', 'Cartão de Crédito', 'credit_card',
   'credit-card', '#EF4444', 0, 3000.00),
  ('f0560000-0000-0000-0000-000000000002',
   'a0560000-0000-0000-0000-000000000099', 'PIX', 'digital',
   'smartphone', '#8B5CF6', 0, NULL)
ON CONFLICT (id) DO NOTHING;

-- O DINHEIRO PENDURADO NO CARTAO
--
-- E ele que torna "nao ha backfill" uma decisao com custo, e nao uma
-- preferencia: `financial_transactions.account_id` aponta para a conta, entao
-- apagar a conta apaga (ou orfana) o lancamento. A secao 5 do teste da 056
-- confere as duas coisas -- que a conta sobreviveu E que o lancamento
-- continua amarrado nela.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, description, amount,
   transaction_date, transaction_type)
SELECT '70560000-0000-0000-0000-000000000001',
       'a0560000-0000-0000-0000-000000000099',
       'f0560000-0000-0000-0000-000000000001',
       c.service_id, c.id,
       'Compra no cartao anterior a 056', -150.00,
       CURRENT_DATE - 10, 'expense'
  FROM public.transaction_categories c
 WHERE c.is_expense AND c.user_id IS NULL
 ORDER BY c.name
 LIMIT 1
ON CONFLICT (id) DO NOTHING;

COMMIT;
