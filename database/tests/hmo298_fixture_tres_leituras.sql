-- =====================================================
-- HMO-298 -- O FIXTURE DAS TRES LEITURAS (7/10 do plano da HMO-279)
-- =====================================================
-- Este arquivo NAO afirma nada. Ele so monta o cenario minimo em que os
-- quatro mecanismos que incham o "Total de contas" do modo Papel de Pao
-- acendem ao mesmo tempo. Quem mede e scripts/medicao-hmo298.mjs; quem
-- compara as tres leituras e a tabela que ele imprime.
--
-- Rodar num banco limpo, depois do shim e de 001 -> 041:
--   psql "$DB_URL" -f database/tests/hmo298_fixture_tres_leituras.sql
--
-- POR QUE CADA PECA ESTA AQUI
-- ---------------------------
-- Cada linha abaixo existe para acender UM mecanismo. Uma peca a menos e uma
-- coluna da tabela que sai igual em todas as leituras -- e tabela toda verde
-- aqui nao e boa noticia, e defeito de fixture (o controle da issue).
--
--   (a) transferencia prevista   -> `Reserva na poupanca`, direction 'transfer'
--   (b) fatura em dois lugares   -> `Pagar fatura Nubank` digitada na CONTA
--                                   CORRENTE + compras reais no cartao, que a
--                                   view card_invoice_lines sintetiza de novo
--   (c) grupo dividido IGUAL     -> grupo Casa 70/30 com percentage gravado
--   (d) as duas telas discordam  -> uma conta de grupo do OUTRO membro e uma
--                                   MINHA, as duas com group_id
--   (6) controle da HMO-286      -> uma receita prevista FORA de 'Salário'
--   (7) custo fixo de grupo      -> uma REGRA RECORRENTE de grupo (HMO-303), o
--                                   unico caminho que nao passa por ocorrencia
--
-- A DATA E EXPLICITA, E ISSO NAO E ESTILO
-- ---------------------------------------
-- Tudo vence em marco de 2026 e o relogio da medicao e congelado em
-- 2026-03-10. A janela do painel e MENSAL e este repositorio ja perdeu um dia
-- inteiro para isso: a sandbox roda em America/Sao_Paulo e o CI em UTC, e um
-- `today()` lido do relogio poe as linhas do dia 1 ou do dia 31 dentro ou fora
-- da janela dependendo de onde a suite rodou.
--
-- O `user_id` DE CADA LINHA E LOAD-BEARING
-- ----------------------------------------
-- A diferenca entre as duas telas do modulo e EXATAMENTE quem assina a linha:
-- /api/papel-de-pao/painel nao filtra por `user_id` (so a RLS filtra) e
-- /api/movimentacoes/resumo filtra. Trocar o dono de uma linha aqui apaga o
-- mecanismo (d) sem quebrar nada.
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

-- =====================================================
-- As duas pessoas
-- =====================================================
-- EU   = quem abre o painel. O caso da issue: participa de grupo e cadastrou
--        pouca coisa propria. Tem 30% do grupo -- a ponta que o rateio igual
--        aperta.
-- OUTRO = o outro membro, com 70%. E ele quem lanca o aluguel.
INSERT INTO auth.users (id, email) VALUES
  ('e0000000-0000-0000-0000-0000000000e1', 'eu@hmo298.local'),
  ('b0000000-0000-0000-0000-0000000000b1', 'outro@hmo298.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('e0000000-0000-0000-0000-0000000000e1', 'Eu (30%)', FALSE),
  ('b0000000-0000-0000-0000-0000000000b1', 'Outro membro (70%)', FALSE);

-- =====================================================
-- As contas
-- =====================================================
-- O cartao precisa de `closing_day` e `due_day`: sem os dois a view
-- `card_invoice_lines` devolve `invoice_due_date` NULL e
-- `sintetizarFaturasAbertas` manda a fatura para `semVencimento` em vez de
-- para a agenda -- o mecanismo (b) nao acenderia.
INSERT INTO public.financial_accounts
  (id, user_id, name, account_type, closing_day, due_day, current_balance) VALUES
  ('c0000000-0000-0000-0000-0000000000c1', 'e0000000-0000-0000-0000-0000000000e1',
   'Conta Corrente', 'checking', NULL, NULL, 2000.00),
  ('c0000000-0000-0000-0000-0000000000ca', 'e0000000-0000-0000-0000-0000000000e1',
   'Nubank', 'credit_card', 28, 10, 0),
  ('c0000000-0000-0000-0000-0000000000c2', 'b0000000-0000-0000-0000-0000000000b1',
   'Conta do Outro', 'checking', NULL, NULL, 5000.00);

-- =====================================================
-- O grupo Casa, 70/30
-- =====================================================
-- Criado pelo OUTRO: o trigger `add_group_creator` ja o poe como admin ativo.
-- O `percentage` gravado e o que a HMO-269/270/271 introduziu e o que
-- `ratearPorPeso` vai cobrar de verdade no fechamento. `parteDoMembro` nao
-- olha para esta coluna -- e esse e o mecanismo (c).
INSERT INTO public.expense_groups (id, name, created_by) VALUES
  ('a0000000-0000-0000-0000-00000000ca5a', 'Casa',
   'b0000000-0000-0000-0000-0000000000b1');

UPDATE public.group_members
   SET percentage = 70.00
 WHERE group_id = 'a0000000-0000-0000-0000-00000000ca5a'
   AND user_id  = 'b0000000-0000-0000-0000-0000000000b1';

INSERT INTO public.group_members (group_id, user_id, role, status, percentage) VALUES
  ('a0000000-0000-0000-0000-00000000ca5a', 'e0000000-0000-0000-0000-0000000000e1',
   'member', 'active', 30.00);

-- =====================================================
-- A AGENDA DE MARCO DE 2026
-- =====================================================
-- `amount` e sempre POSITIVO: o CHECK do 005 exige, e quem diz a direcao e
-- `transaction_type` (a view do 027 resolve para a coluna `direction`).

-- (d) + (c) -- A conta de grupo do OUTRO membro.
-- EU enxergo esta linha pela policy do 005 (`group_id IS NOT NULL AND
-- is_group_member(group_id)`), mesmo sem ter cadastrado nada. O painel do modo
-- soma metade dela; a tela de Despesas, que filtra por `user_id`, nao lista
-- nenhuma parte dela. Mesmo mes, duas telas, dois numeros.
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, account_id, group_id, description, amount,
   due_date, status, transaction_type)
VALUES
  ('5c000000-0000-0000-0000-00000000a111', 'b0000000-0000-0000-0000-0000000000b1',
   'b61d7949-2abc-430d-9bd0-02a146c1d9d8', NULL,
   'a0000000-0000-0000-0000-00000000ca5a', 'Aluguel da casa', 3000.00,
   '2026-03-05', 'pending', 'expense');

-- (d) -- A MINHA conta de grupo.
-- Esta as duas telas enxergam, e e por isso que ela e a peca que separa os
-- dois defeitos de (d): o painel a divide por membros ativos e a tela de
-- Despesas a soma CHEIA, porque o `select` dela nem traz `group_id`.
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, account_id, group_id, description, amount,
   due_date, status, transaction_type)
VALUES
  ('5c000000-0000-0000-0000-00000000173e', 'e0000000-0000-0000-0000-0000000000e1',
   '499636db-7c96-4dae-a807-f95011b3ae8c', NULL,
   'a0000000-0000-0000-0000-00000000ca5a', 'Internet da casa', 1000.00,
   '2026-03-08', 'pending', 'expense');

-- (a) -- A transferencia prevista.
-- Guardar na poupanca todo mes. `direcaoDaAgenda` so separa 'income' do resto,
-- entao isto entra no "Total de contas" como se fosse boleto. A tela de
-- Despesas nao a lista: `linhaPrevista` manda 'transfer' para a TELA de
-- transferencia.
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, account_id, destination_account_id, description,
   amount, due_date, status, transaction_type)
VALUES
  ('5c000000-0000-0000-0000-0000000000b0', 'e0000000-0000-0000-0000-0000000000e1',
   '3f2d1c4a-9b6e-4d80-a1f5-2c7e8b30d941', 'c0000000-0000-0000-0000-0000000000c1',
   'c0000000-0000-0000-0000-0000000000ca', 'Reserva na poupanca', 500.00,
   '2026-03-05', 'pending', 'transfer');

-- (b) -- "Pagar fatura Nubank", DIGITADA A MAO.
-- A conta e a CORRENTE, e nao o cartao: `previsaoApareceNaAgenda` so descarta a
-- linha cuja conta e cartao de credito, entao esta FICA. E `notes` nao carrega
-- a chave canonica `fatura:AAAA-MM-01:<uuid>` que o POST /api/card-invoices/
-- close grava -- so quem tem a chave de-duplica contra a fatura sintetizada.
-- Resultado: a mesma divida em dois lugares.
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, account_id, description, amount, due_date,
   status, notes, transaction_type)
VALUES
  ('5c000000-0000-0000-0000-0000000000fa', 'e0000000-0000-0000-0000-0000000000e1',
   'ef656abf-50f0-4cd7-8e96-15cbe4eaac26', 'c0000000-0000-0000-0000-0000000000c1',
   'Pagar fatura Nubank', 800.00, '2026-03-10', 'pending',
   'anotei pra nao esquecer', 'expense');

-- O salario previsto. E a referencia do painel, e o que torna a inflacao do
-- "Total de contas" legivel em reais.
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, account_id, description, amount, due_date,
   status, transaction_type)
VALUES
  ('5c000000-0000-0000-0000-00000005a1a0', 'e0000000-0000-0000-0000-0000000000e1',
   'd93a6d01-3b70-4c54-af08-e8b56b09fb9e', 'c0000000-0000-0000-0000-0000000000c1',
   'Salario', 5000.00, '2026-03-05', 'pending', 'income');

-- (6) -- O CONTROLE DA HMO-286: uma receita prevista FORA de 'Salário'.
-- Sem ela, uma leitura que somasse o `expected_income` agregado em vez de
-- peneirar pela categoria daria o MESMO numero que a correta, e a tabela
-- ficaria verde sobre um codigo errado.
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, account_id, description, amount, due_date,
   status, transaction_type)
VALUES
  ('5c000000-0000-0000-0000-0000000000a2', 'e0000000-0000-0000-0000-0000000000e1',
   'bdb788d6-f1fa-48d0-94ee-b97beca29064', 'c0000000-0000-0000-0000-0000000000c1',
   'Aluguel recebido', 1200.00, '2026-03-20', 'pending', 'income');

-- =====================================================
-- A REGRA RECORRENTE DE GRUPO -- HMO-303
-- =====================================================
-- Ela nao gera linha nenhuma na agenda deste fixture, e por isso NAO mexe em
-- nenhum numero da tabela da medicao. Ela existe para acender a UNICA leitura
-- que nao passa por ocorrencia: `custoFixoMensalDaMinhaParte` roda sobre
-- `recurring_rules`, e sem uma regra de grupo aqui a mudanca do `summary` na
-- HMO-303 passaria sem medicao nenhuma -- a tabela ficaria verde sobre um
-- caminho de codigo que o fixture nao exercita.
--
-- O DONO E O OUTRO MEMBRO, E ISSO E O PONTO. A consulta de
-- /api/scheduled-transactions/summary nao filtra por `user_id` (so a RLS
-- filtra), e a policy do 005 me entrega a regra de grupo dele. Sem dividir, EU
-- via R$ 600,00 de custo fixo mensal saido de uma regra que nao e minha
-- (HMO-177); com a divisao IGUAL eu via R$ 300,00; com o percentual configurado
-- eu vejo R$ 180,00 -- 30% de R$ 600,00, que e o que o grupo cobra.
--
-- `frequency` fica no default ('monthly') de proposito: `monthlyCost` nao
-- normaliza nada no caso mensal, entao o numero medido e o da DIVISAO e nao o da
-- normalizacao. Uma regra anual aqui misturaria os dois mecanismos num numero so.
INSERT INTO public.recurring_rules
  (id, user_id, group_id, category_id, description, amount, transaction_type,
   due_day, start_date)
VALUES
  ('7e000000-0000-0000-0000-00000000f1ca', 'b0000000-0000-0000-0000-0000000000b1',
   'a0000000-0000-0000-0000-00000000ca5a',
   'b61d7949-2abc-430d-9bd0-02a146c1d9d8', 'Condominio da casa', 600.00,
   'expense', 15, '2026-01-15');

-- =====================================================
-- (b), a outra metade: as COMPRAS REAIS no cartao
-- =====================================================
-- Sao elas que fazem `card_invoice_lines` existir. Somam R$ 800,00 -- o mesmo
-- valor da previsao digitada a mao acima, de proposito: e assim que uma pessoa
-- anota "a fatura veio 800, pago dia 10". A fatura sintetizada vence em
-- 2026-03-10 (`due_day` = 10), dentro da janela.
--
-- `transaction_date` em fevereiro: com `closing_day` = 28, a compra de
-- fevereiro cai na fatura cujo vencimento e 10/03.
--
-- Despesa e gravada NEGATIVA em financial_transactions -- a convencao oposta a
-- de scheduled_transactions.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, account_id, category_id, description, amount,
   transaction_date, transaction_type)
VALUES
  ('f0000000-0000-0000-0000-00000000fe01', 'e0000000-0000-0000-0000-0000000000e1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'c0000000-0000-0000-0000-0000000000ca',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'Mercado', -500.00,
   '2026-02-10', 'expense'),
  ('f0000000-0000-0000-0000-00000000fa02', 'e0000000-0000-0000-0000-0000000000e1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'c0000000-0000-0000-0000-0000000000ca',
   'c962941b-1aa5-4ae9-9103-d3e5ab8c98e5', 'Farmacia', -300.00,
   '2026-02-12', 'expense');

COMMIT;
