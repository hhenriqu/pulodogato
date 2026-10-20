-- =====================================================
-- Lancamentos plantados ANTES da 060 (HMO-443)
-- =====================================================
-- Este arquivo nao testa nada. Ele existe para que a 060 tenha em que morder.
--
-- POR QUE ELE E NECESSARIO
-- ------------------------
-- A metade interessante do `ADD COLUMN include_in_total boolean NOT NULL
-- DEFAULT true` nao e que a coluna passa a existir -- e que TODO LANCAMENTO QUE
-- JA EXISTIA passa a valer `true`, isto e, continua somando nos relatorios
-- exatamente como antes da migration.
--
-- Num banco construido do ZERO (que e o que o db-verify faz) essa metade nao
-- tem como ser medida: quando a 060 roda, quase todo lancamento do banco foi
-- criado dentro da transacao de alguma suite e ja sumiu no ROLLBACK dela.
-- `SELECT count(*) FROM financial_transactions WHERE include_in_total` daria
-- quase nada, e zero de zero passa em qualquer assercao sobre "todo lancamento
-- antigo veio true" -- o vacuo que
-- `prod-vazia-invalida-prova-por-efeito-colateral` descreve.
--
-- Sem este arquivo, um mutante que trocasse o `DEFAULT true` por `DEFAULT
-- false` -- ou que adicionasse a coluna anulavel, sem default nenhum --
-- SOBREVIVERIA a suite inteira, porque nao haveria linha pre-existente para
-- delatar o valor errado. E esse mutante e dinheiro: no dia em que o codigo que
-- le a coluna subir, ele esvazia o fluxo de caixa, o total por categoria, o
-- previsto x realizado, o painel e os quatro CSVs de TODOS os usuarios de uma
-- vez -- e esvazia para MENOS, que e o lado de que se reclama tarde.
--
-- OS QUATRO LANCAMENTOS, E POR QUE SAO QUATRO
-- -------------------------------------------
-- Todos no MESMO MES (2026-03) e na MESMA conta, que e o que a issue exige: a
-- unica forma de provar que a view separa marcado de nao marcado e ter os dois
-- dentro do mesmo grupo de agregacao. Se estivessem em meses diferentes, uma
-- view SEM filtro nenhum tambem devolveria "40,00 em marco" -- e a assercao
-- ficaria verde medindo o `GROUP BY`, nao o `WHERE`.
--
--   ...0001  despesa  -40,00     NUNCA e tocado depois da migration. Com o
--   ...0002  receita  +250,00    ...0002, prova o default sobre linha
--                                pre-existente (secao 2 do teste) e forma o
--                                lado NAO MARCADO das secoes 3 e 4.
--
--   ...0003  despesa  -100,00    sao DESMARCADOS por
--   ...0004  receita  +1000,00   `060_lancamento_fora_do_total.sql`, DEPOIS da
--                                migration e ANTES do re-run dela. Formam o
--                                lado MARCADO, e provam na secao 7 que re-colar
--                                o arquivo nao re-soma o que a pessoa tirou --
--                                a razao pela qual a 060 nao tem UPDATE de
--                                backfill.
--
-- OS VALORES SAO DISTINGUIVEIS DE PROPOSITO. 40 e 250 do lado que fica, 100 e
-- 1000 do lado que sai: nenhuma soma parcial errada cai por acidente no valor
-- certo. Uma view sem o filtro devolve 140,00 / 1250,00 em vez de 40,00 /
-- 250,00, e a mensagem de falha mostra exatamente quanto vazou.
--
-- O SINAL segue a convencao do app -- despesa NEGATIVA, receita positiva --
-- porque `net_worth_history` soma `amount` cru, e e a secao 5 do teste (a que
-- prova que o flag e de relatorio e nao de saldo) que depende desse sinal. As
-- views de relatorio usam `ABS()` com FILTER por `transaction_type` e nao
-- notariam a diferenca; a do patrimonio nota.
--
-- A CONTA e `investment` e a categoria e `Investimentos` porque o caso que
-- originou a HMO-443 e literalmente esse: "adicionei um ajuste na minha conta
-- investimento, ela entrou como uma receita de ajuste". Nao muda nenhuma
-- assercao -- nenhuma view deste teste olha tipo de conta --, mas faz a fixture
-- descrever o caso real em vez de um caso generico.
--
-- ELE COMITA, DE PROPOSITO
-- ------------------------
-- Sem COMMIT a 060 (que roda no passo seguinte, noutra sessao) nao veria nada.
-- As linhas ficam no banco do CI para o teste da 060 conferir.
--
-- `is_public = FALSE` EXPLICITO, e nao pelo default: `profiles.is_public` tem
-- DEFAULT true e a policy `profiles_select_own_or_public` deixa qualquer
-- usuario logado ler um perfil publico. Como este arquivo COMITA, um perfil
-- publico a mais no banco do CI derruba o controle de
-- `view_security_invoker_test.sql` -- a mesma armadilha documentada no
-- cabecalho de `058_contas_antes_da_058.sql`, de `056_contas_antes_da_056.sql`
-- e de `027_historico_antes_da_027.sql`.
--
-- O usuario e proprio deste arquivo (`a0600000-...`) e nenhum outro teste da
-- cadeia o usa -- o da 056 e `a0560000-...`, o da 058 `a0580000-...`, o da 059
-- `a0590000-...`. Isso importa mais aqui do que nas outras fixtures: estas
-- quatro linhas COMITAM em `financial_transactions`, e varias suites contam
-- lancamentos. Elas contam os DELAS, por `user_id`; nenhuma conta a tabela
-- inteira (conferido ao escrever este arquivo, e re-conferido rodando a cadeia
-- completa do db-verify com esta fixture dentro).
--
-- Rodar ENTRE a 059 e a 060:
--   psql "$DB_URL" -f database/tests/060_lancamentos_antes_da_060.sql
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a0600000-0000-0000-0000-000000000099', 'antes-da-060@teste.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name, is_public) VALUES
  ('a0600000-0000-0000-0000-000000000099', 'antes-da-060@teste.local',
   'Cadastro anterior a 060', FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.financial_accounts
  (id, user_id, name, account_type, icon, color_hex, current_balance) VALUES
  ('f0600000-0000-0000-0000-000000000001',
   'a0600000-0000-0000-0000-000000000099', 'Investimento de antes da 060',
   'investment', 'trending-up', '#8B5CF6', 0)
ON CONFLICT (id) DO NOTHING;

-- Os quatro lancamentos, do jeito que eles estao no banco de quem lancou antes
-- desta migration: SEM a coluna `include_in_total`, que ainda nao existe neste
-- ponto da cadeia. E justamente por isso que o INSERT nao a menciona -- se ele
-- a mencionasse, este arquivo nao compilaria antes da 060 e deixaria de medir
-- o que foi feito para medir.
--
-- `service_id` e `category_id` sao os literais do seed do 001_baseline
-- (`personal_finance` e `Investimentos`), que sao fixos no arquivo e nao
-- sorteados -- conferido. As duas colunas sao NOT NULL, entao nao ha como
-- omiti-las.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id,
   description, amount, transaction_date, transaction_type) VALUES
  ('60600000-0000-0000-0000-000000000001',
   'a0600000-0000-0000-0000-000000000099',
   '8730cd96-d656-4c48-863e-673e1016a832',
   '8269d16f-f5c3-42c4-9ec8-dbcdcb823a61',
   'f0600000-0000-0000-0000-000000000001',
   'Taxa de custodia (fica no total)', -40.00, '2026-03-10', 'expense'),
  ('60600000-0000-0000-0000-000000000002',
   'a0600000-0000-0000-0000-000000000099',
   '8730cd96-d656-4c48-863e-673e1016a832',
   '8269d16f-f5c3-42c4-9ec8-dbcdcb823a61',
   'f0600000-0000-0000-0000-000000000001',
   'Dividendo de verdade (fica no total)', 250.00, '2026-03-20', 'income'),
  ('60600000-0000-0000-0000-000000000003',
   'a0600000-0000-0000-0000-000000000099',
   '8730cd96-d656-4c48-863e-673e1016a832',
   '8269d16f-f5c3-42c4-9ec8-dbcdcb823a61',
   'f0600000-0000-0000-0000-000000000001',
   'Ajuste de saldo para baixo (vai sair do total)', -100.00, '2026-03-11', 'expense'),
  ('60600000-0000-0000-0000-000000000004',
   'a0600000-0000-0000-0000-000000000099',
   '8730cd96-d656-4c48-863e-673e1016a832',
   '8269d16f-f5c3-42c4-9ec8-dbcdcb823a61',
   'f0600000-0000-0000-0000-000000000001',
   'Ajuste de saldo para cima (vai sair do total)', 1000.00, '2026-03-21', 'income')
ON CONFLICT (id) DO NOTHING;

COMMIT;
