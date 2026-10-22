-- =====================================================
-- Contas e lancamentos ANTES da 064 (HMO-441)
-- =====================================================
-- Este arquivo nao testa nada. Ele planta o estado que a 064 tem de mudar.
--
-- POR QUE ELE E NECESSARIO
-- ------------------------
-- Num banco montado do zero nao existe conta nenhuma com `include_in_total =
-- false`, e por isso TODA assercao sobre "a conta desligada sai do patrimonio"
-- ficaria verde com o filtro da 064 APAGADO -- zero de zero passa em qualquer
-- assercao (`prod-vazia-invalida-prova-por-efeito-colateral`). O filtro da 064
-- so e load-bearing se houver dinheiro do lado desligado, e e esse dinheiro que
-- este arquivo planta: R$ 7.700,00 numa conta fora dos totais, que e
-- exatamente a diferenca que hoje aparece entre o grafico e o numero grande.
--
-- Mesma familia de `060_lancamentos_antes_da_060.sql`,
-- `063_anon_com_grant_antes_da_063.sql`, `058_contas_antes_da_058.sql` e
-- `056_contas_antes_da_056.sql`.
--
-- ELE COMITA, DE PROPOSITO
-- ------------------------
-- A 064 roda no passo seguinte, noutra sessao: sem COMMIT ela nao veria nada, e
-- a suite da 064 (que e `BEGIN`/`ROLLBACK`) tampouco.
--
-- O `is_public = FALSE` dos dois perfis NAO e enfeite: perfil plantado com
-- `is_public = TRUE` reprova a suite de RLS ~17 steps abaixo neste mesmo job,
-- e a causa aparece longe da causa (HMO-458, f6aa720).
--
-- O SALDO DAS CONTAS NAO E ESCRITO A MAO
-- -------------------------------------
-- `current_balance` nasce 0 nas tres contas e quem o move e o
-- `update_account_balance_trigger`, somando `amount`. Escrever o saldo final a
-- mao faria a fixture concordar com a view por construcao, e a secao 2 da suite
-- -- que confere o saldo ANTES de olhar o patrimonio -- deixaria de medir o
-- trigger. Os numeros que o trigger produz estao na suite, nao aqui.
--
-- OS DOIS USUARIOS, E POR QUE SAO DOIS
-- ------------------------------------
--   ...0099 tem UMA conta que soma e UMA que nao soma. E o caso da tela: o
--           numero grande e o grafico tem de fechar.
--   ...0098 tem SO conta desligada. E o caso que separa `FILTER` de `WHERE` no
--           CTE `saldo_hoje`: com `WHERE` este usuario sai do CTE, o `JOIN`
--           final mata a serie dele inteira e a tela fica VAZIA em vez de
--           zerada. Sem este segundo usuario esse defeito nao tem assercao
--           que o distinga.
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a0640000-0000-0000-0000-000000000099', 'antes-da-064@teste.local'),
  ('a0640000-0000-0000-0000-000000000098', 'antes-da-064-so-desligada@teste.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name, is_public) VALUES
  ('a0640000-0000-0000-0000-000000000099', 'antes-da-064@teste.local',
   'Patrimonio anterior a 064', FALSE),
  ('a0640000-0000-0000-0000-000000000098', 'antes-da-064-so-desligada@teste.local',
   'So conta desligada, anterior a 064', FALSE)
ON CONFLICT (id) DO NOTHING;

-- A conta que SOMA e a conta que NAO SOMA, do mesmo usuario. `include_in_total`
-- vem explicito nas duas: na que soma para que a fixture nao dependa do DEFAULT
-- (um mutante `DEFAULT false` na 058 mudaria o lado certo sem ninguem ver), e
-- na que nao soma porque e a feature.
INSERT INTO public.financial_accounts
  (id, user_id, name, account_type, icon, color_hex, current_balance, include_in_total) VALUES
  ('f0640000-0000-0000-0000-000000000001',
   'a0640000-0000-0000-0000-000000000099', 'Corrente que entra no patrimonio',
   'checking', 'wallet', '#2563EB', 0, TRUE),
  ('f0640000-0000-0000-0000-000000000002',
   'a0640000-0000-0000-0000-000000000099', 'Poupanca FORA do patrimonio',
   'savings', 'piggy-bank', '#F59E0B', 0, FALSE),
  ('f0640000-0000-0000-0000-000000000003',
   'a0640000-0000-0000-0000-000000000098', 'A unica conta, e ela e desligada',
   'savings', 'piggy-bank', '#F59E0B', 0, FALSE)
ON CONFLICT (id) DO NOTHING;

-- MAIO tem as duas contas; JUNHO tem as duas; JULHO tem SO a desligada (a chave
-- do mes que nao pode desaparecer); AGOSTO tem SO lancamento sem conta (o mes
-- que nao pode APARECER).
--
-- O `include_in_total = FALSE` do lancamento de 13/05 e do flag da 060, que e
-- de RELATORIO: ele CONTINUA contando no patrimonio, e a secao 5 da suite
-- existe para que "consertar" essa omissao reprove aqui em vez de em producao.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id,
   description, amount, transaction_date, transaction_type, include_in_total) VALUES
  ('64640000-0000-0000-0000-000000000001',
   'a0640000-0000-0000-0000-000000000099',
   '8730cd96-d656-4c48-863e-673e1016a832',
   '8269d16f-f5c3-42c4-9ec8-dbcdcb823a61',
   'f0640000-0000-0000-0000-000000000001',
   'Salario na conta que soma', 1000.00, '2026-05-10', 'income', TRUE),
  ('64640000-0000-0000-0000-000000000002',
   'a0640000-0000-0000-0000-000000000099',
   '8730cd96-d656-4c48-863e-673e1016a832',
   '8269d16f-f5c3-42c4-9ec8-dbcdcb823a61',
   'f0640000-0000-0000-0000-000000000001',
   'Ajuste de saldo: fora do RELATORIO, dentro do PATRIMONIO', 50.00, '2026-05-13', 'income', FALSE),
  ('64640000-0000-0000-0000-000000000003',
   'a0640000-0000-0000-0000-000000000099',
   '8730cd96-d656-4c48-863e-673e1016a832',
   '8269d16f-f5c3-42c4-9ec8-dbcdcb823a61',
   'f0640000-0000-0000-0000-000000000002',
   'Aporte grande na conta FORA dos totais', 7000.00, '2026-05-11', 'income', TRUE),
  ('64640000-0000-0000-0000-000000000004',
   'a0640000-0000-0000-0000-000000000099',
   '8730cd96-d656-4c48-863e-673e1016a832',
   '8269d16f-f5c3-42c4-9ec8-dbcdcb823a61',
   'f0640000-0000-0000-0000-000000000001',
   'Entrada de junho na conta que soma', 200.00, '2026-06-12', 'income', TRUE),
  ('64640000-0000-0000-0000-000000000005',
   'a0640000-0000-0000-0000-000000000099',
   '8730cd96-d656-4c48-863e-673e1016a832',
   '8269d16f-f5c3-42c4-9ec8-dbcdcb823a61',
   'f0640000-0000-0000-0000-000000000002',
   'Entrada de junho na conta FORA dos totais', 300.00, '2026-06-10', 'income', TRUE),
  ('64640000-0000-0000-0000-000000000006',
   'a0640000-0000-0000-0000-000000000099',
   '8730cd96-d656-4c48-863e-673e1016a832',
   '8269d16f-f5c3-42c4-9ec8-dbcdcb823a61',
   'f0640000-0000-0000-0000-000000000002',
   'JULHO so tem este, e ele nao conta', 400.00, '2026-07-05', 'income', TRUE),
  ('64640000-0000-0000-0000-000000000007',
   'a0640000-0000-0000-0000-000000000099',
   '8730cd96-d656-4c48-863e-673e1016a832',
   '8269d16f-f5c3-42c4-9ec8-dbcdcb823a61',
   NULL,
   'AGOSTO so tem este, e ele nao tem conta', 500.00, '2026-08-07', 'income', TRUE),
  ('64640000-0000-0000-0000-000000000008',
   'a0640000-0000-0000-0000-000000000098',
   '8730cd96-d656-4c48-863e-673e1016a832',
   '8269d16f-f5c3-42c4-9ec8-dbcdcb823a61',
   'f0640000-0000-0000-0000-000000000003',
   'O unico lancamento do usuario de uma conta so', 900.00, '2026-05-15', 'income', TRUE)
ON CONFLICT (id) DO NOTHING;

COMMIT;
