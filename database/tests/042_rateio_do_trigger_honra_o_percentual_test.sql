-- =====================================================
-- 042 -- o rateio do trigger honra o percentual do membro
-- =====================================================
-- HMO-304. Roda no db-verify, contra o banco que as migrations constroem do
-- zero, NA POSICAO da 042 (depois de 001..041).
--
-- O defeito que a 042 fecha: num grupo 70/30, a mesma conta valia R$ 300 como
-- PREVISTA (o fechamento do mes, que rateia por `ratearPorPeso` desde a
-- HMO-270) e R$ 500 depois de PAGA -- porque a SECAO 2c de
-- `refazer_rateio_do_grupo` gravava `split_type = 'equal'` fixo e o
-- `calculate_equal_split` (007) achatava tudo para partes iguais.
--
-- O QUE ESTE ARQUIVO PROVA
-- ------------------------
--   1. o caso da issue: 70/30 numa despesa de R$ 1.000 grava 700 / 300, e a
--      ligacao nasce `split_type = 'percentage'`;
--   2. grupo SEM divisao configurada (`percentage` 0.00, o default) continua
--      dividindo IGUAL -- e o caso que impede esta migration de mexer no
--      dinheiro de todo grupo que existe hoje;
--   3. `percentage` NULL (a coluna e NULLABLE) cai no mesmo degrau do 0/0 e
--      tambem divide igual -- um caminho proprio, porque `SUM` de NULL e NULL
--      e nao zero, e sem o COALESCE a comparacao `> 0` daria falso por acidente
--      em vez de por decisao;
--   4. soma que NAO fecha 100 (70/27) rateia pela SOMA dos pesos e o total
--      fecha EXATO -- a decisao registrada no cabecalho da 042;
--   5. o membro de peso ZERO entre pesos positivos recebe R$ 0,00 e a linha
--      CONTINUA existindo (`percentage` com piso de 0,01, senao o CHECK da
--      coluna derrubaria o lancamento inteiro);
--   6. maior resto: tres pesos iguais em R$ 100 dao 33,34 / 33,33 / 33,33 e
--      somam exatamente o total -- a mesma aritmetica do caminho igual;
--   7. previsto == realizado: os numeros do caso 1 sao os MESMOS que
--      `ratearPorPeso` produz para o lado previsto. Esta e a razao de ser da
--      issue, e por isso e assercao e nao comentario;
--   8. REGRESSAO -- as duas travas PDG01 e o recalculo da 024 continuam de pe.
--      A 042 faz `CREATE OR REPLACE` do corpo INTEIRO de
--      `refazer_rateio_do_grupo`, entao o teste da 024 (que roda ANTES dela na
--      cadeia) nao prova mais nada sobre a funcao que esta em producao. Sem
--      estes casos, apagar uma trava nesta migration passaria verde.
--
-- O CONTROLE NEGATIVO: sem a 042 aplicada, o CASO 1 reprova (ele mede 700/300
-- onde a cadeia 001..041 grava 500/500). E o que detecta este arquivo rodando
-- na posicao errada da cadeia.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 042:
--   psql "$DB_URL" -f database/tests/042_rateio_do_trigger_honra_o_percentual_test.sql
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

CREATE OR REPLACE FUNCTION pg_temp.expect_num(label TEXT, got NUMERIC, want NUMERIC)
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

-- A parte de um membro numa despesa, pelo nome do perfil. Encurta as assercoes
-- e deixa cada uma dizer so o que esta medindo.
CREATE OR REPLACE FUNCTION pg_temp.parte(p_tx uuid, p_nome TEXT)
RETURNS NUMERIC LANGUAGE sql AS $$
  SELECT es.amount
    FROM public.group_expense_splits es
    JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    JOIN public.group_members gm ON gm.id = es.member_id
    JOIN public.profiles p ON p.id = gm.user_id
   WHERE gt.transaction_id = p_tx AND p.full_name = p_nome;
$$;

CREATE OR REPLACE FUNCTION pg_temp.pct(p_tx uuid, p_nome TEXT)
RETURNS NUMERIC LANGUAGE sql AS $$
  SELECT es.percentage
    FROM public.group_expense_splits es
    JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    JOIN public.group_members gm ON gm.id = es.member_id
    JOIN public.profiles p ON p.id = gm.user_id
   WHERE gt.transaction_id = p_tx AND p.full_name = p_nome;
$$;

CREATE OR REPLACE FUNCTION pg_temp.soma(p_tx uuid)
RETURNS NUMERIC LANGUAGE sql AS $$
  SELECT COALESCE(SUM(es.amount), 0)
    FROM public.group_expense_splits es
    JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
   WHERE gt.transaction_id = p_tx;
$$;

CREATE OR REPLACE FUNCTION pg_temp.tipo(p_tx uuid)
RETURNS TEXT LANGUAGE sql AS $$
  SELECT gt.split_type FROM public.group_transactions gt
   WHERE gt.transaction_id = p_tx;
$$;

-- Lanca uma despesa de grupo do jeito que o app lanca: `amount` NEGATIVO e
-- `group_id` preenchido no proprio INSERT, que e o que dispara a SECAO 2c.
CREATE OR REPLACE FUNCTION pg_temp.lancar(
  p_id uuid, p_dono uuid, p_conta uuid, p_grupo uuid, p_desc TEXT, p_valor NUMERIC
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.financial_transactions
    (id, user_id, account_id, service_id, category_id, group_id, description,
     amount, transaction_date, transaction_type)
  SELECT p_id, p_dono, p_conta, c.service_id, c.id, p_grupo, p_desc,
         p_valor, CURRENT_DATE, 'expense'
    FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;
END $$;

-- =====================================================
-- Fixture: quatro pessoas e cinco grupos, um por caso
-- =====================================================
-- Helio cria todos os grupos (e entra como admin pelo trigger
-- add_group_creator, com `percentage` no DEFAULT 0.00 -- cada caso ajusta a
-- dele). Lais entra em todos; Ivo e Nara so onde o caso precisa de um terceiro.
INSERT INTO auth.users (id, email) VALUES
  ('a3040000-0000-0000-0000-0000000000a1', 'helio304@teste.local'),
  ('a3040000-0000-0000-0000-0000000000b1', 'lais304@teste.local'),
  ('a3040000-0000-0000-0000-0000000000c1', 'ivo304@teste.local'),
  ('a3040000-0000-0000-0000-0000000000d1', 'nara304@teste.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('a3040000-0000-0000-0000-0000000000a1', 'Helio-304', FALSE),
  ('a3040000-0000-0000-0000-0000000000b1', 'Lais-304',  FALSE),
  ('a3040000-0000-0000-0000-0000000000c1', 'Ivo-304',   FALSE),
  ('a3040000-0000-0000-0000-0000000000d1', 'Nara-304',  FALSE);

INSERT INTO public.expense_groups (id, name, created_by) VALUES
  ('b3040000-0000-0000-0000-000000000001', 'Casa 70/30',   'a3040000-0000-0000-0000-0000000000a1'),
  ('b3040000-0000-0000-0000-000000000002', 'Legado 0/0',   'a3040000-0000-0000-0000-0000000000a1'),
  ('b3040000-0000-0000-0000-000000000003', 'Nulo',         'a3040000-0000-0000-0000-0000000000a1'),
  ('b3040000-0000-0000-0000-000000000004', 'Soma 97',      'a3040000-0000-0000-0000-0000000000a1'),
  ('b3040000-0000-0000-0000-000000000005', 'Tres iguais',  'a3040000-0000-0000-0000-0000000000a1');

INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance) VALUES
  ('c3040000-0000-0000-0000-0000000000a1', 'a3040000-0000-0000-0000-0000000000a1', 'Conta Helio', 'checking', 50000);

-- --- grupo 1: 70/30, o caso da issue ---------------------------------------
UPDATE public.group_members SET percentage = 70.00
 WHERE group_id = 'b3040000-0000-0000-0000-000000000001';
INSERT INTO public.group_members (group_id, user_id, role, status, percentage) VALUES
  ('b3040000-0000-0000-0000-000000000001', 'a3040000-0000-0000-0000-0000000000b1', 'member', 'active', 30.00);

-- --- grupo 2: ninguem configurou nada (o DEFAULT 0.00 do criador fica) ------
INSERT INTO public.group_members (group_id, user_id, role, status, percentage) VALUES
  ('b3040000-0000-0000-0000-000000000002', 'a3040000-0000-0000-0000-0000000000b1', 'member', 'active', 0.00);

-- --- grupo 3: percentage NULL nas DUAS linhas -------------------------------
UPDATE public.group_members SET percentage = NULL
 WHERE group_id = 'b3040000-0000-0000-0000-000000000003';
INSERT INTO public.group_members (group_id, user_id, role, status, percentage) VALUES
  ('b3040000-0000-0000-0000-000000000003', 'a3040000-0000-0000-0000-0000000000b1', 'member', 'active', NULL);

-- --- grupo 4: 70 + 27 = 97, a soma que nao fecha ----------------------------
UPDATE public.group_members SET percentage = 70.00
 WHERE group_id = 'b3040000-0000-0000-0000-000000000004';
INSERT INTO public.group_members (group_id, user_id, role, status, percentage) VALUES
  ('b3040000-0000-0000-0000-000000000004', 'a3040000-0000-0000-0000-0000000000b1', 'member', 'active', 27.00);

-- --- grupo 5: tres pesos iguais, mais um membro de peso ZERO e um INATIVO ---
-- O inativo nao e enfeite: ele nao pode entrar nem na soma dos pesos nem no
-- rateio. Se entrasse na soma, as partes dos tres encolheriam sem que nenhuma
-- assercao de "a linha dele nao existe" percebesse.
UPDATE public.group_members SET percentage = 10.00
 WHERE group_id = 'b3040000-0000-0000-0000-000000000005';
INSERT INTO public.group_members (group_id, user_id, role, status, percentage) VALUES
  ('b3040000-0000-0000-0000-000000000005', 'a3040000-0000-0000-0000-0000000000b1', 'member', 'active',   10.00),
  ('b3040000-0000-0000-0000-000000000005', 'a3040000-0000-0000-0000-0000000000c1', 'member', 'active',   10.00),
  ('b3040000-0000-0000-0000-000000000005', 'a3040000-0000-0000-0000-0000000000d1', 'member', 'inactive', 55.00);

-- =====================================================
-- CASO 1: o caso da issue -- 70/30 em R$ 1.000
-- =====================================================
SELECT pg_temp.lancar(
  'd3040000-0000-0000-0000-000000000001', 'a3040000-0000-0000-0000-0000000000a1',
  'c3040000-0000-0000-0000-0000000000a1', 'b3040000-0000-0000-0000-000000000001',
  'Aluguel', -1000.00);

SELECT pg_temp.expect_txt('a ligacao 70/30 nasce split_type = percentage',
  pg_temp.tipo('d3040000-0000-0000-0000-000000000001'), 'percentage');

-- O NUMERO DA ISSUE. Antes da 042 isto media 500.00.
SELECT pg_temp.expect_num('quem tem 30% deve R$ 300, e nao R$ 500',
  pg_temp.parte('d3040000-0000-0000-0000-000000000001', 'Lais-304'), 300.00);

SELECT pg_temp.expect_num('quem tem 70% deve R$ 700',
  pg_temp.parte('d3040000-0000-0000-0000-000000000001', 'Helio-304'), 700.00);

SELECT pg_temp.expect_num('e as duas partes somam a despesa inteira',
  pg_temp.soma('d3040000-0000-0000-0000-000000000001'), 1000.00);

-- A `percentage` gravada tambem passa a dizer a verdade: ela e o que o ramo
-- ELSE de `recalcular_partes_pendentes` usa quando o valor da despesa muda
-- (CASO 8c). Gravar o valor certo com a porcentagem de fachada deixaria a
-- primeira edicao de valor voltar a cobrar 50/50.
SELECT pg_temp.expect_num('a porcentagem gravada e 30, nao 50',
  pg_temp.pct('d3040000-0000-0000-0000-000000000001', 'Lais-304'), 30.00);

-- =====================================================
-- CASO 2: grupo legado, sem divisao configurada -> IGUAL
-- =====================================================
-- O caso que garante que esta migration nao mexe no dinheiro de nenhum grupo
-- que exista hoje.
SELECT pg_temp.lancar(
  'd3040000-0000-0000-0000-000000000002', 'a3040000-0000-0000-0000-0000000000a1',
  'c3040000-0000-0000-0000-0000000000a1', 'b3040000-0000-0000-0000-000000000002',
  'Mercado', -1000.00);

SELECT pg_temp.expect_txt('sem divisao configurada a ligacao continua equal',
  pg_temp.tipo('d3040000-0000-0000-0000-000000000002'), 'equal');

SELECT pg_temp.expect_num('e cada um paga metade (o calculate_equal_split fez a conta)',
  pg_temp.parte('d3040000-0000-0000-0000-000000000002', 'Lais-304'), 500.00);

SELECT pg_temp.expect_num('somando a despesa inteira',
  pg_temp.soma('d3040000-0000-0000-0000-000000000002'), 1000.00);

-- =====================================================
-- CASO 3: percentage NULL -> tambem IGUAL
-- =====================================================
-- Caminho proprio porque `SUM(NULL)` e NULL, nao zero: sem o COALESCE da 042 a
-- comparacao `v_soma_pesos > 0` daria NULL (nem verdadeiro nem falso), o IF
-- cairia no ramo igual por acidente e o caso 4 passaria pelo motivo errado.
SELECT pg_temp.lancar(
  'd3040000-0000-0000-0000-000000000003', 'a3040000-0000-0000-0000-0000000000a1',
  'c3040000-0000-0000-0000-0000000000a1', 'b3040000-0000-0000-0000-000000000003',
  'Luz', -500.00);

SELECT pg_temp.expect_txt('percentage NULL cai no degrau do 0/0 e fica equal',
  pg_temp.tipo('d3040000-0000-0000-0000-000000000003'), 'equal');

SELECT pg_temp.expect_num('com percentage NULL cada um paga metade',
  pg_temp.parte('d3040000-0000-0000-0000-000000000003', 'Lais-304'), 250.00);

-- =====================================================
-- CASO 4: a soma que NAO fecha 100 (70 + 27)
-- =====================================================
-- A decisao registrada no cabecalho da 042: `percentage` e PESO, e o rateio
-- divide pela SOMA. 70/97 de 1000 = 721,649... e 27/97 = 278,350...
-- O total fecha EXATO -- que e o invariante que o saldo do grupo depende.
SELECT pg_temp.lancar(
  'd3040000-0000-0000-0000-000000000004', 'a3040000-0000-0000-0000-0000000000a1',
  'c3040000-0000-0000-0000-0000000000a1', 'b3040000-0000-0000-0000-000000000004',
  'Internet', -1000.00);

SELECT pg_temp.expect_num('peso 70 de uma soma 97 da 721,65 (e nao 700)',
  pg_temp.parte('d3040000-0000-0000-0000-000000000004', 'Helio-304'), 721.65);

SELECT pg_temp.expect_num('peso 27 de uma soma 97 da 278,35 (e nao 270)',
  pg_temp.parte('d3040000-0000-0000-0000-000000000004', 'Lais-304'), 278.35);

-- A assercao que separa esta decisao da outra: tratar 70 como "70 de 100"
-- deixaria R$ 30 sem dono e esta soma daria 970.
SELECT pg_temp.expect_num('e a soma e a despesa INTEIRA -- nenhum real sem dono',
  pg_temp.soma('d3040000-0000-0000-0000-000000000004'), 1000.00);

-- =====================================================
-- CASO 5 e 6: maior resto, peso zero e o membro inativo
-- =====================================================
-- Tres pesos de 10 (soma 30) em R$ 100: 33,34 / 33,33 / 33,33. A Nara esta
-- INATIVA com peso 55 -- se ela entrasse na soma, as partes cairiam para
-- 11,76 e pouco.
SELECT pg_temp.lancar(
  'd3040000-0000-0000-0000-000000000005', 'a3040000-0000-0000-0000-0000000000a1',
  'c3040000-0000-0000-0000-0000000000a1', 'b3040000-0000-0000-0000-000000000005',
  'Jantar', -100.00);

SELECT pg_temp.expect('o jantar tem 3 partes -- a inativa nao recebe nenhuma',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = 'd3040000-0000-0000-0000-000000000005'), 3);

SELECT pg_temp.expect_num('tres pesos iguais em R$ 100 somam exatamente 100',
  pg_temp.soma('d3040000-0000-0000-0000-000000000005'), 100.00);

-- O centavo que sobra vai para UMA parte so, pelo maior resto. Aqui os tres
-- restos empatam, e o desempate e o menor `gm.id`: a assercao mede a FORMA
-- (uma parte de 33,34 e duas de 33,33), que e o que o maior resto garante,
-- sem depender de qual uuid o gen_random_uuid sorteou.
SELECT pg_temp.expect('uma parte de 33,34',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = 'd3040000-0000-0000-0000-000000000005'
      AND es.amount = 33.34), 1);

SELECT pg_temp.expect('e duas de 33,33',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = 'd3040000-0000-0000-0000-000000000005'
      AND es.amount = 33.33), 2);

-- --- o membro de peso ZERO entre pesos positivos ---------------------------
-- O Ivo vai a zero e o jantar seguinte sai 50/50 entre os outros dois. A linha
-- dele CONTINUA existindo, com R$ 0,00: `group_expense_splits_percentage_check`
-- exige `percentage > 0`, entao gravar 0,00 na coluna de display derrubaria o
-- INSERT inteiro -- e com ele o lancamento.
UPDATE public.group_members SET percentage = 0.00
 WHERE group_id = 'b3040000-0000-0000-0000-000000000005'
   AND user_id = 'a3040000-0000-0000-0000-0000000000c1';

SELECT pg_temp.lancar(
  'd3040000-0000-0000-0000-000000000006', 'a3040000-0000-0000-0000-0000000000a1',
  'c3040000-0000-0000-0000-0000000000a1', 'b3040000-0000-0000-0000-000000000005',
  'Jantar sem o Ivo', -100.00);

SELECT pg_temp.expect('o membro de peso zero ainda tem linha de rateio',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
     JOIN public.group_members gm ON gm.id = es.member_id
    WHERE gt.transaction_id = 'd3040000-0000-0000-0000-000000000006'
      AND gm.user_id = 'a3040000-0000-0000-0000-0000000000c1'), 1);

SELECT pg_temp.expect_num('e ela vale R$ 0,00',
  pg_temp.parte('d3040000-0000-0000-0000-000000000006', 'Ivo-304'), 0.00);

SELECT pg_temp.expect_num('com a percentage no piso de 0,01 que o CHECK exige',
  pg_temp.pct('d3040000-0000-0000-0000-000000000006', 'Ivo-304'), 0.01);

SELECT pg_temp.expect_num('e os outros dois dividem os R$ 100 inteiros',
  pg_temp.parte('d3040000-0000-0000-0000-000000000006', 'Lais-304'), 50.00);

SELECT pg_temp.expect_num('a soma continua exata com um peso zero no meio',
  pg_temp.soma('d3040000-0000-0000-0000-000000000006'), 100.00);

-- =====================================================
-- CASO 7: previsto == realizado, que e a razao da issue
-- =====================================================
-- O lado PREVISTO e `ratearPorPeso` (lib/fechamento-do-grupo.ts), em
-- TypeScript, e nao da para chama-lo daqui. O que da -- e o que importa -- e
-- afirmar a conta que ele faz, escrita de forma independente: piso de
-- `total * peso / soma` em centavos inteiros, mais o centavo que sobra para o
-- maior resto.
--
-- Se os dois lados discordarem, esta assercao falha mesmo com todos os casos
-- acima passando: ela compara o que o BANCO gravou com a conta do APP, em vez
-- de comparar o banco consigo mesmo.
DO $$
DECLARE
  v_total_cents BIGINT := 100000;   -- R$ 1.000,00, a despesa do CASO 1
  v_previsto_lais BIGINT;
  v_realizado_lais NUMERIC;
BEGIN
  -- A conta do lado previsto, com os pesos 70 e 30 (soma 100).
  v_previsto_lais := (v_total_cents * 30) / 100;

  SELECT ROUND(pg_temp.parte('d3040000-0000-0000-0000-000000000001', 'Lais-304') * 100)
    INTO v_realizado_lais;

  IF v_realizado_lais IS DISTINCT FROM v_previsto_lais::numeric THEN
    RAISE EXCEPTION 'FALHA: previsto e realizado discordam na mesma conta -> previsto % centavos, realizado %',
      v_previsto_lais, v_realizado_lais;
  END IF;
  RAISE NOTICE 'ok: previsto e realizado dizem o mesmo numero (% centavos)', v_previsto_lais;
END $$;

-- =====================================================
-- CASO 8: REGRESSAO -- o que a 024 provava continua de pe
-- =====================================================
-- A 042 reescreve o corpo INTEIRO de `refazer_rateio_do_grupo`. O teste da 024
-- roda ANTES dela na cadeia, entao daqui em diante quem prova as travas e este
-- bloco. Sem ele, apagar uma trava PDG01 na 042 passaria verde.

-- --- 8a. mudar o VALOR com parte aprovada -> PDG01 -------------------------
UPDATE public.group_expense_splits es SET status = 'approved', approved_at = now()
 WHERE es.group_transaction_id = (
   SELECT gt.id FROM public.group_transactions gt
    WHERE gt.transaction_id = 'd3040000-0000-0000-0000-000000000001')
   AND es.member_id = (
   SELECT gm.id FROM public.group_members gm
    WHERE gm.group_id = 'b3040000-0000-0000-0000-000000000001'
      AND gm.user_id = 'a3040000-0000-0000-0000-0000000000b1');

DO $$
DECLARE v_sqlstate TEXT;
BEGIN
  BEGIN
    UPDATE public.financial_transactions SET amount = -2000.00
     WHERE id = 'd3040000-0000-0000-0000-000000000001';
  EXCEPTION WHEN OTHERS THEN
    v_sqlstate := SQLSTATE;
  END;

  IF v_sqlstate IS DISTINCT FROM 'PDG01' THEN
    RAISE EXCEPTION 'FALHA: mudar o valor com parte aprovada devia falhar com PDG01, veio %',
      COALESCE(v_sqlstate, 'nenhum erro');
  END IF;
  RAISE NOTICE 'ok: a trava PDG01 do valor sobreviveu a 042';
END $$;

-- --- 8b. trocar de GRUPO com parte aprovada -> PDG01 -----------------------
DO $$
DECLARE v_sqlstate TEXT;
BEGIN
  BEGIN
    UPDATE public.financial_transactions
       SET group_id = 'b3040000-0000-0000-0000-000000000002'
     WHERE id = 'd3040000-0000-0000-0000-000000000001';
  EXCEPTION WHEN OTHERS THEN
    v_sqlstate := SQLSTATE;
  END;

  IF v_sqlstate IS DISTINCT FROM 'PDG01' THEN
    RAISE EXCEPTION 'FALHA: trocar de grupo com parte aprovada devia falhar com PDG01, veio %',
      COALESCE(v_sqlstate, 'nenhum erro');
  END IF;
  RAISE NOTICE 'ok: a trava PDG01 do grupo sobreviveu a 042';
END $$;

-- E nada ficou gravado pela metade: a trava recusa ANTES de qualquer escrita.
SELECT pg_temp.expect_num('o valor da despesa continua -1000 depois das duas recusas',
  (SELECT amount FROM public.financial_transactions
    WHERE id = 'd3040000-0000-0000-0000-000000000001'), -1000.00);

SELECT pg_temp.expect_num('e as partes continuam 700/300',
  pg_temp.soma('d3040000-0000-0000-0000-000000000001'), 1000.00);

-- --- 8c. mudar o valor SEM parte aprovada reescala pela porcentagem --------
-- O ramo ELSE de `recalcular_partes_pendentes`, agora alimentado pela
-- porcentagem de VERDADE que a 042 grava. Antes dela, esta despesa teria
-- 50/50 gravado e a edicao reescalaria 50/50 -- a prova de que a porcentagem
-- gravada no CASO 1 nao e enfeite.
SELECT pg_temp.lancar(
  'd3040000-0000-0000-0000-000000000007', 'a3040000-0000-0000-0000-0000000000a1',
  'c3040000-0000-0000-0000-0000000000a1', 'b3040000-0000-0000-0000-000000000001',
  'Conta para editar', -1000.00);

UPDATE public.financial_transactions SET amount = -2000.00
 WHERE id = 'd3040000-0000-0000-0000-000000000007';

SELECT pg_temp.expect_num('dobrar a despesa 70/30 leva a parte de 30% para 600',
  pg_temp.parte('d3040000-0000-0000-0000-000000000007', 'Lais-304'), 600.00);

SELECT pg_temp.expect_num('e a de 70% para 1400',
  pg_temp.parte('d3040000-0000-0000-0000-000000000007', 'Helio-304'), 1400.00);

SELECT pg_temp.expect_num('somando a despesa nova inteira',
  pg_temp.soma('d3040000-0000-0000-0000-000000000007'), 2000.00);

-- --- 8d. tirar a despesa do grupo apaga a ligacao --------------------------
UPDATE public.financial_transactions SET group_id = NULL
 WHERE id = 'd3040000-0000-0000-0000-000000000007';

SELECT pg_temp.expect('despesa sem grupo nao tem ligacao',
  (SELECT count(*) FROM public.group_transactions gt
    WHERE gt.transaction_id = 'd3040000-0000-0000-0000-000000000007'), 0);

-- --- 8e. continua havendo UM trigger de grupo, nao dois -------------------
-- O gemeo `sync_transaction_with_group` foi dropado pela 024. Se ele voltasse,
-- cada despesa de grupo ganharia um SEGUNDO jogo de partes e todo mundo
-- passaria a dever o dobro -- sem erro nenhum aparecer.
SELECT pg_temp.expect('um unico trigger chamando auto_create_group_transaction',
  (SELECT count(*) FROM pg_trigger t
    WHERE t.tgrelid = 'public.financial_transactions'::regclass
      AND NOT t.tgisinternal
      AND t.tgfoid = to_regprocedure('public.auto_create_group_transaction()')), 1);

SELECT pg_temp.expect('e o gemeo sync_transaction_with_group continua inexistente',
  (SELECT count(*) FROM pg_proc
    WHERE oid = to_regprocedure('public.sync_transaction_with_group()')), 0);

-- =====================================================
-- CASO 9: a receita de grupo continua sem rateio
-- =====================================================
-- `v_alvo` so e preenchido para `amount < 0`. Vale repetir aqui porque a 042
-- mexeu na secao que decide o que criar: um rateio por peso numa RECEITA
-- cobraria do grupo um dinheiro que entrou.
SELECT pg_temp.lancar(
  'd3040000-0000-0000-0000-000000000008', 'a3040000-0000-0000-0000-0000000000a1',
  'c3040000-0000-0000-0000-0000000000a1', 'b3040000-0000-0000-0000-000000000001',
  'Reembolso', 500.00);

SELECT pg_temp.expect('receita no grupo 70/30 nao cria ligacao nem rateio',
  (SELECT count(*) FROM public.group_transactions gt
    WHERE gt.transaction_id = 'd3040000-0000-0000-0000-000000000008'), 0);

ROLLBACK;
