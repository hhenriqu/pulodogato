-- =====================================================
-- Ativos plantados ANTES da 059 (HMO-432, fase 1)
-- =====================================================
-- Este arquivo nao testa nada. Ele existe para que a 059 tenha em que morder.
--
-- POR QUE ELE E NECESSARIO
-- ------------------------
-- A metade interessante da 059 nao e que `investment_assets.account_id` passa a
-- existir -- e que TODO ATIVO QUE JA EXISTIA fica `NULL`, isto e, solto, porque
-- a migration NAO ADIVINHA conta nenhuma.
--
-- Num banco construido do ZERO (que e o que o db-verify faz) essa metade nao
-- tem como ser medida: quando a 059 roda, os unicos ativos do banco sao os que
-- as outras suites criaram dentro das transacoes delas, e todos ja sumiram no
-- ROLLBACK. `SELECT count(*) FROM investment_assets WHERE account_id IS NULL`
-- daria ZERO linhas, e zero de zero passa em qualquer assercao sobre "nenhum
-- ativo antigo foi atrelado" -- o vacuo que
-- `prod-vazia-invalida-prova-por-efeito-colateral` descreve.
--
-- Sem este arquivo, um `UPDATE investment_assets SET account_id = (SELECT id
-- FROM financial_accounts WHERE user_id = investment_assets.user_id AND
-- account_type = 'investment' LIMIT 1)` -- o backfill "de limpeza", que parece
-- zelo -- SOBREVIVERIA a suite inteira, porque nao haveria linha pre-existente
-- para delatar o valor inventado. E esse mutante e dinheiro: ele poe a posicao
-- da corretora A dentro da corretora B, e a tela da Fase 2 mostra os dois
-- numeros errados sem nenhuma linha do banco estar invalida.
--
-- AS DUAS CONTAS DE INVESTIMENTO SAO DUAS DE PROPOSITO
-- ----------------------------------------------------
-- E o caso normal de quem pediu esta feature: mais de uma corretora. Com UMA
-- conta so, um backfill adivinhado acertaria por sorte e o mutante morreria
-- sem que ninguem soubesse que o acerto foi acidente. Com duas, nao existe
-- resposta certa para a maquina dar -- que e exatamente o argumento do
-- cabecalho da migration.
--
-- OS DOIS ATIVOS TEM PAPEIS DIFERENTES, e por isso sao dois:
--
--   - `...a1` NUNCA e tocado depois da migration. Ele prova que a migration nao
--     atrelou o que ja existia (secao 2 do teste), e mata o backfill
--     adivinhado;
--   - `...a2` e atrelado a conta 1 por `059_ativo_ligado_a_conta.sql`, DEPOIS
--     da migration e ANTES do re-run dela. Ele prova que re-colar o arquivo nao
--     SOLTA o ativo que a pessoa atrelou (secao 5) -- e mata o mutante oposto,
--     um `UPDATE ... SET account_id = NULL` de "limpeza", que o ativo `...a1`
--     nao delataria (NULL continua NULL).
--
-- ELE COMITA, DE PROPOSITO
-- ------------------------
-- Sem COMMIT a 059 (que roda no passo seguinte, noutra sessao) nao veria nada.
-- As linhas ficam no banco do CI para o teste da 059 conferir.
--
-- E AQUI ISSO EXIGE CUIDADO: o bloco da 059 NAO fica no fim do job -- ele roda
-- logo depois do bloco da 058 e ANTES do step `schema-columns.json em dia`,
-- porque esta migration CRIA COLUNA (ver
-- `bloco-de-migration-que-cria-coluna-vai-antes-do-check-de-schema-columns`).
-- Entao estas linhas ficam visiveis para todo step dali para baixo. Medido que
-- nenhum deles se incomoda: os passos de RLS e de `anon` leem CATALOGO e nao
-- linha; os de deriva e o drill de backup constroem banco proprio; o teste da
-- 056 conta contas recortando pelo `user_id` DELE (`a0560000-...`), o da 058
-- pelo dele (`a0580000-...`), e o usuario deste arquivo e outro
-- (`a0590000-...`).
--
-- `is_public = FALSE` EXPLICITO, e nao pelo default: `profiles.is_public` tem
-- DEFAULT true e a policy `profiles_select_own_or_public` deixa qualquer
-- usuario logado ler um perfil publico. Como este arquivo COMITA, um perfil
-- publico a mais no banco do CI derruba o controle de
-- `view_security_invoker_test.sql` (que roda mais abaixo, depois da 057) -- a
-- mesma armadilha documentada no cabecalho de `056_contas_antes_da_056.sql` e
-- de `058_contas_antes_da_058.sql`.
--
-- Rodar ENTRE o bloco da 058 e a 059:
--   psql "$DB_URL" -f database/tests/059_ativos_antes_da_059.sql
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a0590000-0000-0000-0000-000000000099', 'antes-da-059@teste.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name, is_public) VALUES
  ('a0590000-0000-0000-0000-000000000099', 'antes-da-059@teste.local',
   'Carteira anterior a 059', FALSE)
ON CONFLICT (id) DO NOTHING;

-- DUAS contas de investimento (as duas corretoras) e UMA conta corrente. A
-- conta corrente nao e enfeite: ela e o que o teste usa para provar que a trava
-- recusa conta do tipo errado DO PROPRIO DONO -- sem ela, a recusa poderia
-- estar vindo do dono e nao do tipo.
INSERT INTO public.financial_accounts
  (id, user_id, name, account_type, icon, color_hex, current_balance) VALUES
  ('f0590000-0000-0000-0000-000000000001',
   'a0590000-0000-0000-0000-000000000099', 'Corretora A', 'investment',
   'trending-up', '#8B5CF6', 50000.00),
  ('f0590000-0000-0000-0000-000000000002',
   'a0590000-0000-0000-0000-000000000099', 'Corretora B', 'investment',
   'trending-up', '#6366F1', 12000.00),
  ('f0590000-0000-0000-0000-000000000003',
   'a0590000-0000-0000-0000-000000000099', 'Conta Corrente de antes da 059', 'checking',
   'building', '#10B981', 800.00)
ON CONFLICT (id) DO NOTHING;

-- Os dois ativos, do jeito que eles estao no banco de quem cadastrou a carteira
-- antes desta migration: SEM a coluna `account_id`, que ainda nao existe neste
-- ponto da cadeia. E justamente por isso que o INSERT nao a menciona -- se ele
-- a mencionasse, este arquivo nao rodaria antes da 059 e deixaria de medir o
-- que foi feito para medir.
--
-- `symbol` em MAIUSCULA pela constraint `investment_assets_symbol_maiusculo` do
-- 021, e `type` entre os quatro valores que o `investment_assets_type_check`
-- aceita.
INSERT INTO public.investment_assets
  (id, user_id, symbol, name, type, currency) VALUES
  ('a5590000-0000-0000-0000-0000000000a1',
   'a0590000-0000-0000-0000-000000000099', 'PETR4',
   'Ativo solto de antes da 059', 'stock', 'BRL'),
  ('a5590000-0000-0000-0000-0000000000a2',
   'a0590000-0000-0000-0000-000000000099', 'HGLG11',
   'Ativo que vai ser atrelado', 'fii', 'BRL')
ON CONFLICT (id) DO NOTHING;

COMMIT;
