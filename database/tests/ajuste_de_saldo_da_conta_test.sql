-- =====================================================
-- HMO-409: o ajuste de saldo tambem para contas, nao so para cartao
-- =====================================================
-- A feature nao tem migration: o ajuste e um lancamento comum em
-- `financial_transactions`, e a categoria reservada e criada pela propria rota
-- usando o `user_id` que a 036 acrescentou a `transaction_categories`.
--
-- E JUSTAMENTE POR NAO TER MIGRATION QUE ESTE TESTE EXISTE. Tudo o que faz o
-- ajuste de conta funcionar e comportamento de coisas que JA estao no banco, e
-- nada disso esta escrito no codigo da feature:
--
--   - `update_account_balance` (001:833, reescrito em 007:350) somando
--     `NEW.amount` CRU em `current_balance`, em qualquer tipo de lancamento. E
--     esse trigger, e nao a rota, que faz a conta fechar no numero digitado. Se
--     ele mudar, a rota continua gravando a linha certa e o saldo para de
--     bater -- sem nada vermelho em TypeScript, que nao tem trigger para medir;
--
--   - o mesmo trigger ESTORNANDO `OLD.amount` antes de somar `NEW.amount` no
--     UPDATE. A rota TROCA o ajuste em vez de criar outro, e sem o estorno cada
--     alteracao cobraria a diferenca de novo no saldo;
--
--   - `net_worth_history` (008:455) reconstruindo o patrimonio DE TRAS PARA
--     FRENTE a partir do saldo de hoje. E esta view que decide que o ajuste tem
--     de ser um LANCAMENTO e nao um UPDATE em `current_balance` -- e e a unica
--     coisa no sistema que sabe a diferenca entre os dois. Nenhuma assercao de
--     TypeScript alcanca isso;
--
--   - `auto_create_group_transaction` (001:143) rateando TODO lancamento
--     negativo que chegue com `group_id` preenchido. E o motivo de o INSERT da
--     rota escrever `group_id: null` literal;
--
--   - as policies da 036, sem as quais o INSERT da categoria reservada volta
--     42501 e NENHUM ajuste e gravado. Foi isso que aconteceu com a
--     transferencia (HMO-162): 500 em producao por semanas, CI verde, porque os
--     testes de la eram sobre funcao pura.
--
-- O que ele fixa, na ordem:
--
--   (1)  FIXTURE: tres meses de movimento deixam `current_balance` em R$ 2.430
--        e `net_worth_history` com uma linha por mes;
--   (2)  O NUMERO QUE A ISSUE COBRA: depois do ajuste, `current_balance` e
--        EXATAMENTE o saldo que a pessoa digitou. Pelo trigger, sem UPDATE
--        nenhum em `financial_accounts`;
--   (3)  O OUTRO NUMERO QUE A ISSUE COBRA: os meses ANTERIORES de
--        `net_worth_history` nao se mexem;
--   (4)  CONTRAFACTUAL de (3), e sem ele (3) nao mede nada: corrigir
--        `current_balance` direto -- o desenho que a issue recusa -- MOVE os
--        dois meses anteriores, pelo valor do ajuste;
--   (5)  o sinal NAO e invertido: `amount = diferenca`. Com a inversao do
--        cartao o saldo erra pelo DOBRO;
--   (6)  TROCAR o ajuste nao cobra duas vezes (o estorno de OLD.amount);
--        e a troca para o outro lado tambem fecha;
--   (7)  REMOVER o ajuste devolve o saldo ao de antes;
--   (8)  a chave por DIA: o ajuste de hoje nao encosta no de ontem, e os dois
--        convivem na mesma conta;
--   (9)  `group_id` NULO nao e detalhe de estilo -- CONTRAFACTUAL com
--        SAVEPOINT: o MESMO ajuste com `group_id` preenchido vira despesa do
--        grupo, dividida com todo mundo;
--   (10) a sessao `authenticated` cria a categoria reservada "Ajuste de saldo"
--        no proprio nome...
--   (11) ...ela fica fora do seletor de categorias...
--   (12) ...e um estranho autenticado NAO a ve, mas VE o catalogo (prova de que
--        (12) nao e "ninguem ve nada").
--
-- Rodar num banco limpo, depois das migrations ate a ultima:
--   psql "$DB_URL" -f database/tests/ajuste_de_saldo_da_conta_test.sql
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

-- ---------------------------------------------------------------------------
-- As sondas
-- ---------------------------------------------------------------------------

-- A chave canonica, escrita AQUI com o mesmo formato de `chaveAjusteDeSaldo`
-- em lib/ajuste-de-saldo-da-conta.ts. As duas copias existem porque este teste
-- nao executa TypeScript; a assercao (7) e o que as amarra -- se o formato
-- divergir, o DELETE daqui nao acha a linha que o INSERT daqui gravou.
CREATE OR REPLACE FUNCTION pg_temp.chave_ajuste_de_saldo(p_dia DATE, p_conta UUID)
RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT 'ajuste-de-saldo:' || to_char(p_dia, 'YYYY-MM-DD') || ':' || p_conta::text;
$$;

-- O QUE A ROTA GRAVA. `p_diferenca` e a diferenca como ela sai de
-- `ajusteParaOSaldoFicarEm` (positivo = entrou dinheiro), e o `amount` recebe
-- ELA MESMA -- sem inversao. Essa ausencia de `-` e a assercao (5), e e a
-- diferenca entre esta funcao e a `grava_ajuste` de ajuste_de_fatura_test.sql.
--
-- `group_id` e `is_shared` vao escritos, como no INSERT da rota: e o que a
-- secao (9) mede com o contrafactual.
CREATE OR REPLACE FUNCTION pg_temp.grava_ajuste_de_saldo(
  p_dono UUID, p_conta UUID, p_categoria UUID, p_dia DATE, p_diferenca NUMERIC,
  p_grupo UUID DEFAULT NULL)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_servico UUID;
BEGIN
  SELECT id INTO v_servico FROM public.financial_services WHERE name = 'personal_finance';
  INSERT INTO public.financial_transactions
    (user_id, service_id, category_id, account_id, description, amount,
     transaction_date, transaction_type, notes, group_id, is_shared)
  VALUES (p_dono, v_servico, p_categoria, p_conta,
          'Ajuste de saldo da conta', p_diferenca, p_dia,
          (CASE WHEN p_diferenca > 0 THEN 'income' ELSE 'expense' END)::public.transaction_financial_type,
          pg_temp.chave_ajuste_de_saldo(p_dia, p_conta), p_grupo, FALSE);
  RETURN 'gravou';
EXCEPTION
  WHEN insufficient_privilege THEN RETURN 'ERRO:42501';
  WHEN check_violation        THEN RETURN 'ERRO:23514';
  WHEN not_null_violation     THEN RETURN 'ERRO:23502';
END $$;

-- O que o POST faz quando JA existe ajuste naquele dia: UPDATE pela chave.
CREATE OR REPLACE FUNCTION pg_temp.troca_ajuste_de_saldo(
  p_conta UUID, p_dia DATE, p_diferenca NUMERIC)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE v_linhas BIGINT;
BEGIN
  UPDATE public.financial_transactions
     SET amount = p_diferenca,
         transaction_type = (CASE WHEN p_diferenca > 0 THEN 'income' ELSE 'expense' END)::public.transaction_financial_type
   WHERE notes = pg_temp.chave_ajuste_de_saldo(p_dia, p_conta);
  GET DIAGNOSTICS v_linhas = ROW_COUNT;
  RETURN v_linhas;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.remove_ajuste_de_saldo(p_conta UUID, p_dia DATE)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE v_linhas BIGINT;
BEGIN
  DELETE FROM public.financial_transactions
   WHERE notes = pg_temp.chave_ajuste_de_saldo(p_dia, p_conta);
  GET DIAGNOSTICS v_linhas = ROW_COUNT;
  RETURN v_linhas;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.saldo(p_conta UUID)
RETURNS NUMERIC LANGUAGE SQL AS $$
  SELECT current_balance FROM public.financial_accounts WHERE id = p_conta;
$$;

/** O patrimonio daquele mes, pela VIEW -- e nao por soma a mao. */
CREATE OR REPLACE FUNCTION pg_temp.patrimonio(p_dono UUID, p_mes DATE)
RETURNS NUMERIC LANGUAGE SQL AS $$
  SELECT net_worth FROM public.net_worth_history
   WHERE user_id = p_dono AND month = date_trunc('month', p_mes)::date;
$$;

CREATE OR REPLACE FUNCTION pg_temp.cria_categoria_reservada(p_dono UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_servico UUID;
BEGIN
  SELECT id INTO v_servico FROM public.financial_services WHERE name = 'personal_finance';
  INSERT INTO public.transaction_categories
    (service_id, user_id, name, description, icon, color_hex, is_expense, is_active)
  VALUES (v_servico, p_dono, 'Ajuste de saldo',
          'Reservada para o ajuste de saldo das contas.',
          'scale', '#6B7280', FALSE, FALSE);
  RETURN 'criou';
EXCEPTION
  WHEN insufficient_privilege THEN RETURN 'ERRO:42501';
  WHEN unique_violation       THEN RETURN 'ERRO:23505';
  WHEN check_violation        THEN RETURN 'ERRO:23514';
END $$;

-- Quantas categorias com este nome a sessao corrente CONSEGUE LER. Uma sonda
-- unica para (12) e a metade dele: e ela que faz "o estranho nao ve a minha" e
-- "o estranho ve o catalogo" serem a MESMA medicao com entradas diferentes --
-- sem isso, uma policy `USING (FALSE)` passaria pelo controle negativo.
CREATE OR REPLACE FUNCTION pg_temp.categorias_visiveis(p_nome TEXT)
RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM public.transaction_categories WHERE name = p_nome;
$$;

-- O que `GET /api/personal-finance/categories` traz: o filtro do SELECT, nao so
-- a RLS. E ele que mantem a reservada fora do seletor.
CREATE OR REPLACE FUNCTION pg_temp.categorias_do_seletor(p_nome TEXT)
RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM public.transaction_categories
   WHERE name = p_nome AND is_active = TRUE;
$$;

-- =====================================================
-- (1) FIXTURE: tres meses de movimento numa conta corrente
-- =====================================================
-- DATAS CRAVADAS, e nao CURRENT_DATE: `net_worth_history` agrupa por
-- `date_trunc('month', transaction_date)`, e a assercao central e sobre MESES
-- ANTERIORES. Com `CURRENT_DATE - interval '1 month'` o teste mudaria de
-- resposta sozinho na virada do mes -- e passaria a medir um mes que nao tem
-- movimento nenhum, onde "o patrimonio nao mudou" e verdade por vacuidade.
INSERT INTO auth.users (id, email) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'dona-do-saldo@test.local'),
  ('d1000000-0000-0000-0000-000000000002', 'socia@test.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'Dona do Saldo', TRUE),
  ('d1000000-0000-0000-0000-000000000002', 'Sócia',         TRUE);

-- Comecam em ZERO: todo centavo do saldo vai ser posto pelo trigger, a partir
-- dos lancamentos abaixo. Semear `current_balance` a mao deixaria o nivel de
-- `net_worth_history` dependendo de um numero escrito aqui, e a assercao (2)
-- -- "o saldo termina no que foi digitado" -- passaria verde mesmo com o
-- trigger desligado.
INSERT INTO public.financial_accounts
  (id, user_id, name, account_type, current_balance)
VALUES
  ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001',
   'Conta corrente', 'checking', 0.00),
  ('d2000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001',
   'Poupança', 'savings', 0.00);

INSERT INTO public.financial_transactions
  (user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type)
SELECT
  'd1000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
  (SELECT id FROM public.transaction_categories
    WHERE name = 'Alimentação' AND user_id IS NULL),
  'd2000000-0000-0000-0000-000000000001',
  v.descricao, v.valor, v.dia, v.tipo::public.transaction_financial_type
FROM (VALUES
  ('Salário de agosto',  3000.00, DATE '2026-08-05', 'income'),
  ('Mercado de agosto',  -1000.00, DATE '2026-08-20', 'expense'),
  ('Salário de setembro', 3000.00, DATE '2026-09-05', 'income'),
  ('Mercado de setembro', -1200.00, DATE '2026-09-20', 'expense'),
  ('Mercado de outubro',  -1370.00, DATE '2026-10-10', 'expense')
) AS v(descricao, valor, dia, tipo);

SELECT pg_temp.expect_num('fixture: o trigger deixou a conta em R$ 2.430',
  pg_temp.saldo('d2000000-0000-0000-0000-000000000001'), 2430.00);

-- O patrimonio de cada mes, ANTES do ajuste. Estes tres numeros sao a linha de
-- base de (3) e (4).
--
--   agosto:   2430 - (1800 + (-1370)) = 2000
--   setembro: 2430 - (-1370)          = 3800
--   outubro:  2430                    = 2430
SELECT pg_temp.expect_num('fixture: patrimonio de agosto',
  pg_temp.patrimonio('d1000000-0000-0000-0000-000000000001', DATE '2026-08-01'), 2000.00);
SELECT pg_temp.expect_num('fixture: patrimonio de setembro',
  pg_temp.patrimonio('d1000000-0000-0000-0000-000000000001', DATE '2026-09-01'), 3800.00);
SELECT pg_temp.expect_num('fixture: patrimonio de outubro',
  pg_temp.patrimonio('d1000000-0000-0000-0000-000000000001', DATE '2026-10-01'), 2430.00);

-- =====================================================
-- (10) e (11) A SESSAO DO USUARIO CRIA A CATEGORIA RESERVADA
-- =====================================================
-- A assercao que a HMO-162 nao tinha. Lá o INSERT da categoria voltava 42501 em
-- 100% das chamadas e NENHUMA transferencia jamais foi gravada -- e o CI ficou
-- verde por semanas, porque os testes eram sobre funcao pura.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'd1000000-0000-0000-0000-000000000001';

SELECT pg_temp.expect_txt('a sessao da dona cria a categoria "Ajuste de saldo" no proprio nome',
  pg_temp.cria_categoria_reservada('d1000000-0000-0000-0000-000000000001'), 'criou');

SELECT pg_temp.expect('e a dona consegue LE-LA depois (read_own nao filtra is_active)',
  pg_temp.categorias_visiveis('Ajuste de saldo'), 1::BIGINT);

-- (11) ...e ela NAO entra no seletor. Se nascesse ativa, "Ajuste de saldo"
-- apareceria como categoria escolhivel em todo lancamento.
SELECT pg_temp.expect('a reservada fica fora do seletor de categorias',
  pg_temp.categorias_do_seletor('Ajuste de saldo'), 0::BIGINT);

-- (12) O CONTROLE NEGATIVO, e o positivo que o torna uma medicao.
SET LOCAL request.jwt.claim.sub = 'd1000000-0000-0000-0000-000000000002';

SELECT pg_temp.expect('um estranho NAO ve a categoria reservada da dona',
  pg_temp.categorias_visiveis('Ajuste de saldo'), 0::BIGINT);

SELECT pg_temp.expect('...e ve o catalogo na mesma consulta (nao e "ninguem ve nada")',
  pg_temp.categorias_visiveis('Alimentação'), 1::BIGINT);

RESET ROLE;

-- =====================================================
-- (2) e (5) O AJUSTE FECHA A CONTA NO NUMERO DIGITADO
-- =====================================================
-- O app diz R$ 2.430,00 e o banco diz R$ 2.380,00. A diferenca e -50, e o
-- `amount` recebe ELA MESMA -- sem a inversao do cartao.
--
-- Com `amount = +50` (a inversao de `lancamentoDoAjuste`), a conta terminaria
-- em R$ 2.480: R$ 100 longe do banco, pelo numero que a pessoa digitou certo.
SELECT pg_temp.expect_txt('a dona grava um ajuste de -R$ 50 hoje',
  pg_temp.grava_ajuste_de_saldo(
    'd1000000-0000-0000-0000-000000000001',
    'd2000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.transaction_categories
      WHERE name = 'Ajuste de saldo'
        AND user_id = 'd1000000-0000-0000-0000-000000000001'),
    DATE '2026-10-16', -50.00),
  'gravou');

-- O NUMERO QUE A ISSUE COBRA. Pelo trigger, e sem UPDATE nenhum em
-- `financial_accounts`: o unico comando que esta funcao executa e um INSERT em
-- `financial_transactions`.
SELECT pg_temp.expect_num('O SALDO DEPOIS DO AJUSTE E EXATAMENTE O DIGITADO',
  pg_temp.saldo('d2000000-0000-0000-0000-000000000001'), 2380.00);

-- =====================================================
-- (3) O OUTRO NUMERO: OS MESES ANTERIORES NAO SE MEXEM
-- =====================================================
-- `net_worth_history` faz `saldo_de_hoje - (tudo que se moveu DEPOIS do mes)`.
-- Com um lancamento datado, as duas pontas andam juntas: o saldo de hoje cai 50
-- e o movimento de outubro tambem, e a subtracao devolve o MESMO numero para
-- agosto e setembro. A historia fica certa a partir da data do ajuste, e
-- intacta antes dela.
SELECT pg_temp.expect_num('agosto nao se mexeu com o ajuste',
  pg_temp.patrimonio('d1000000-0000-0000-0000-000000000001', DATE '2026-08-01'), 2000.00);
SELECT pg_temp.expect_num('setembro nao se mexeu com o ajuste',
  pg_temp.patrimonio('d1000000-0000-0000-0000-000000000001', DATE '2026-09-01'), 3800.00);

-- E outubro MUDA, que e o ponto: o ajuste e de outubro. Sem esta linha, (3)
-- passaria verde com `net_worth_history` devolvendo um numero fixo -- ou com o
-- ajuste nao tendo entrado em lugar nenhum.
SELECT pg_temp.expect_num('outubro SIM: o ajuste e dele',
  pg_temp.patrimonio('d1000000-0000-0000-0000-000000000001', DATE '2026-10-01'), 2380.00);

-- =====================================================
-- (4) CONTRAFACTUAL: O DESENHO QUE A ISSUE RECUSA
-- =====================================================
-- Sem esta secao, (3) nao mede nada. "O patrimonio de agosto continua 2000" e
-- verdade em dois mundos muito diferentes: naquele em que o ajuste e um
-- lancamento datado (o certo) e naquele em que o ajuste nao existe. O que
-- distingue os dois e mostrar que a OUTRA implementacao -- corrigir
-- `current_balance` direto, que e o caminho obvio e o que a issue proibe --
-- MOVE os meses anteriores.
SAVEPOINT saldo_corrigido_direto;

-- O ajuste "do jeito errado": tira-se o lancamento e escreve-se o saldo.
SELECT pg_temp.remove_ajuste_de_saldo(
  'd2000000-0000-0000-0000-000000000001', DATE '2026-10-16');

UPDATE public.financial_accounts
   SET current_balance = 2380.00
 WHERE id = 'd2000000-0000-0000-0000-000000000001';

SELECT pg_temp.expect_num('CONTRAFACTUAL: corrigir o saldo direto DESLOCA agosto',
  pg_temp.patrimonio('d1000000-0000-0000-0000-000000000001', DATE '2026-08-01'), 1950.00);
SELECT pg_temp.expect_num('CONTRAFACTUAL: ...e desloca setembro tambem',
  pg_temp.patrimonio('d1000000-0000-0000-0000-000000000001', DATE '2026-09-01'), 3750.00);

ROLLBACK TO SAVEPOINT saldo_corrigido_direto;

SELECT pg_temp.expect_num('depois do rollback, agosto voltou ao lugar',
  pg_temp.patrimonio('d1000000-0000-0000-0000-000000000001', DATE '2026-08-01'), 2000.00);
SELECT pg_temp.expect_num('e o saldo continua no numero digitado',
  pg_temp.saldo('d2000000-0000-0000-0000-000000000001'), 2380.00);

-- =====================================================
-- (6) TROCAR O AJUSTE NAO COBRA DUAS VEZES
-- =====================================================
-- O banco agora diz R$ 2.400. A base e o saldo SEM ajuste (2380 - (-50) =
-- 2430), entao a diferenca e -30 e ela SUBSTITUI os -50 pela chave canonica.
--
-- E `update_account_balance` no UPDATE que faz isso fechar: ele estorna
-- `OLD.amount` (-50) antes de somar `NEW.amount` (-30). Sem o estorno, a conta
-- iria para 2350 -- cada alteracao do ajuste cobrando a diferenca de novo.
SELECT pg_temp.expect('a troca atinge UMA linha (a chave canonica)',
  pg_temp.troca_ajuste_de_saldo(
    'd2000000-0000-0000-0000-000000000001', DATE '2026-10-16', -30.00),
  1::BIGINT);

SELECT pg_temp.expect_num('depois da TROCA o saldo e o novo digitado, e nao a soma dos dois',
  pg_temp.saldo('d2000000-0000-0000-0000-000000000001'), 2400.00);

SELECT pg_temp.expect('e continua havendo UM ajuste no dia, nao dois',
  (SELECT count(*) FROM public.financial_transactions
    WHERE notes = pg_temp.chave_ajuste_de_saldo(
      DATE '2026-10-16', 'd2000000-0000-0000-0000-000000000001')),
  1::BIGINT);

-- Trocar para o OUTRO LADO. Sem este caso, um `amount` que perdesse o sinal
-- (um `ABS`, um `-` a mais) ainda fecharia a conta acima, porque -50 e -30 tem
-- o mesmo sinal. A base e 2430; o banco diz 2500; a diferenca e +70.
SELECT pg_temp.expect('a troca para entrada atinge a mesma linha',
  pg_temp.troca_ajuste_de_saldo(
    'd2000000-0000-0000-0000-000000000001', DATE '2026-10-16', 70.00),
  1::BIGINT);

SELECT pg_temp.expect_num('trocar de saida para ENTRADA fecha a conta no numero novo',
  pg_temp.saldo('d2000000-0000-0000-0000-000000000001'), 2500.00);

SELECT pg_temp.expect_txt('e o tipo acompanhou o sinal',
  (SELECT transaction_type::text FROM public.financial_transactions
    WHERE notes = pg_temp.chave_ajuste_de_saldo(
      DATE '2026-10-16', 'd2000000-0000-0000-0000-000000000001')),
  'income');

-- =====================================================
-- (7) REMOVER O AJUSTE DEVOLVE O SALDO
-- =====================================================
-- O DELETE e de verdade, e nao soft delete: o trigger so estorna o saldo no
-- DELETE. Marcar a linha como inativa deixaria os +70 somados em
-- `current_balance` para sempre.
SELECT pg_temp.expect('o DELETE pela chave canonica acha a linha que o INSERT gravou',
  pg_temp.remove_ajuste_de_saldo(
    'd2000000-0000-0000-0000-000000000001', DATE '2026-10-16'),
  1::BIGINT);

SELECT pg_temp.expect_num('removido o ajuste, a conta volta ao saldo dos lancamentos',
  pg_temp.saldo('d2000000-0000-0000-0000-000000000001'), 2430.00);

SELECT pg_temp.expect_num('e o patrimonio de agosto nunca se mexeu em nenhum passo',
  pg_temp.patrimonio('d1000000-0000-0000-0000-000000000001', DATE '2026-08-01'), 2000.00);

-- =====================================================
-- (8) A CHAVE E POR DIA
-- =====================================================
-- Com chave por MES -- a do cartao --, o ajuste de hoje reescreveria o de
-- ontem, e a diferenca que apareceu no meio sumiria do extrato sem nada
-- explicando a mudanca de saldo.
SELECT pg_temp.expect_txt('um ajuste de ontem (-R$ 20)',
  pg_temp.grava_ajuste_de_saldo(
    'd1000000-0000-0000-0000-000000000001',
    'd2000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.transaction_categories
      WHERE name = 'Ajuste de saldo'
        AND user_id = 'd1000000-0000-0000-0000-000000000001'),
    DATE '2026-10-15', -20.00),
  'gravou');

SELECT pg_temp.expect_txt('e um ajuste de hoje (-R$ 50)',
  pg_temp.grava_ajuste_de_saldo(
    'd1000000-0000-0000-0000-000000000001',
    'd2000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.transaction_categories
      WHERE name = 'Ajuste de saldo'
        AND user_id = 'd1000000-0000-0000-0000-000000000001'),
    DATE '2026-10-16', -50.00),
  'gravou');

SELECT pg_temp.expect('os DOIS ajustes convivem na mesma conta',
  (SELECT count(*) FROM public.financial_transactions
    WHERE account_id = 'd2000000-0000-0000-0000-000000000001'
      AND notes LIKE 'ajuste-de-saldo:%'),
  2::BIGINT);

SELECT pg_temp.expect_num('e os dois contam no saldo: 2430 - 20 - 50',
  pg_temp.saldo('d2000000-0000-0000-0000-000000000001'), 2360.00);

-- Remover o de hoje deixa o de ontem onde estava.
SELECT pg_temp.expect('remover o de hoje atinge UMA linha',
  pg_temp.remove_ajuste_de_saldo(
    'd2000000-0000-0000-0000-000000000001', DATE '2026-10-16'),
  1::BIGINT);

SELECT pg_temp.expect_num('o ajuste de ONTEM continua no saldo',
  pg_temp.saldo('d2000000-0000-0000-0000-000000000001'), 2410.00);

SELECT pg_temp.expect('a chave de ONTEM nao foi tocada',
  (SELECT count(*) FROM public.financial_transactions
    WHERE notes = pg_temp.chave_ajuste_de_saldo(
      DATE '2026-10-15', 'd2000000-0000-0000-0000-000000000001')),
  1::BIGINT);

-- =====================================================
-- (9) `group_id` NULO NAO E DETALHE DE ESTILO
-- =====================================================
-- `auto_create_group_transaction` (001:143) ve `group_id IS NOT NULL AND
-- amount < 0` e rateia a linha entre os membros ativos. Um ajuste de -R$ 50
-- numa conta corrente viraria DESPESA NOVA DO GRUPO, dividida com todo mundo,
-- e cada membro passaria a dever a parte dele de um dinheiro que ninguem
-- gastou -- em silencio, sem erro nenhum.
--
-- O SAVEPOINT existe para medir isso e desfazer: sem o contrafactual, "o ajuste
-- nao criou parte nenhuma" e verdade tambem num banco onde o trigger foi
-- removido, e a linha `group_id: null` do INSERT da rota ficaria sem medida.
INSERT INTO public.expense_groups (id, name, created_by) VALUES
  ('d9000000-0000-0000-0000-000000000001', 'Apartamento',
   'd1000000-0000-0000-0000-000000000001');

-- A dona entra pelo trigger de criacao do grupo; `unique_user_per_group`
-- recusa a segunda insercao dela.
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('d9000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-000000000002', 'member', 'active');

SELECT pg_temp.expect('ANTES: o grupo nao tem parte nenhuma',
  (SELECT count(*) FROM public.group_expense_splits), 0::BIGINT);

-- O ajuste como a rota o grava: `group_id` NULO.
SELECT pg_temp.expect_txt('o ajuste de saldo e gravado com group_id nulo',
  pg_temp.grava_ajuste_de_saldo(
    'd1000000-0000-0000-0000-000000000001',
    'd2000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.transaction_categories
      WHERE name = 'Ajuste de saldo'
        AND user_id = 'd1000000-0000-0000-0000-000000000001'),
    DATE '2026-10-16', -50.00),
  'gravou');

SELECT pg_temp.expect('com group_id NULO, o ajuste nao vira despesa do grupo',
  (SELECT count(*) FROM public.group_expense_splits), 0::BIGINT);

-- O CONTRAFACTUAL: o MESMO ajuste, com o grupo preenchido.
SAVEPOINT ajuste_com_grupo;

SELECT pg_temp.remove_ajuste_de_saldo(
  'd2000000-0000-0000-0000-000000000001', DATE '2026-10-16');

SELECT pg_temp.expect_txt('o mesmo ajuste, agora com group_id (o erro)',
  pg_temp.grava_ajuste_de_saldo(
    'd1000000-0000-0000-0000-000000000001',
    'd2000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.transaction_categories
      WHERE name = 'Ajuste de saldo'
        AND user_id = 'd1000000-0000-0000-0000-000000000001'),
    DATE '2026-10-16', -50.00,
    'd9000000-0000-0000-0000-000000000001'),
  'gravou');

SELECT pg_temp.expect('com group_id, o ajuste vira despesa rateada entre os 2 membros',
  (SELECT count(*) FROM public.group_expense_splits), 2::BIGINT);

-- O ajuste de -R$ 50 vira R$ 50 de despesa do grupo, dividida em duas partes
-- de R$ 25: a socia passa a dever R$ 25 de um dinheiro que ninguem gastou.
SELECT pg_temp.expect_num('as partes somam os R$ 50 do ajuste',
  (SELECT SUM(amount) FROM public.group_expense_splits), 50.00);

SELECT pg_temp.expect_num('e a parte da socia e R$ 25',
  (SELECT s.amount FROM public.group_expense_splits s
     JOIN public.group_members m ON m.id = s.member_id
    WHERE m.user_id = 'd1000000-0000-0000-0000-000000000002'), 25.00);

ROLLBACK TO SAVEPOINT ajuste_com_grupo;

SELECT pg_temp.expect('depois do rollback, o grupo volta a nao ter parte nenhuma',
  (SELECT count(*) FROM public.group_expense_splits), 0::BIGINT);

-- =====================================================
ROLLBACK;

\echo 'ajuste_de_saldo_da_conta_test.sql: todas as assercoes passaram.'
