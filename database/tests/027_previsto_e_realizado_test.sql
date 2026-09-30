-- =====================================================
-- Teste do previsto x realizado no lancamento (027)
-- =====================================================
-- HMO-188. Roda no db-verify, contra o banco que as migrations constroem do
-- zero.
--
-- "A coluna existe" nao prova nada aqui, e neste caso a armadilha e pior que de
-- costume: as tres colunas da 027 podem existir, com o tipo certo, e a feature
-- continuar gravando dinheiro para o lado errado. O que a 027 entrega e a
-- promessa de que uma previsao SABE para que lado aponta -- e essa promessa vive
-- na view, na precedencia do COALESCE e no backfill, nao nas colunas.
--
-- O DEFEITO QUE ESTE ARQUIVO EXISTE PARA PRENDER
-- ----------------------------------------------
-- `scheduled_transactions.amount` tem `CHECK (amount > 0)`: a ocorrencia nao
-- guarda sinal. Antes da 027 a direcao saia SO da regra, e uma previsao avulsa
-- (sem regra) caia no `?? 'expense'` da rota de baixa. Confirmar o recebimento
-- de um salario de R$ 7.000 lancado como previsao avulsa gravaria -7000: o
-- dinheiro entraria SAINDO da conta, com o valor certo, a descricao certa, a
-- categoria certa e nenhum erro em lugar nenhum.
--
-- OS NUMEROS SAO OS DE PRODUCAO, DE PROPOSITO
-- -------------------------------------------
-- 7.000 de receita, 2.500 de despesa e um boleto avulso de 88,50 sao os mesmos
-- valores medidos na conta de teste em producao na HMO-186, onde o bloco
-- "A vencer" anunciou R$ 9.588,50 a vencer quando o que ia sair eram
-- R$ 2.588,50. A SECAO 2 exige os dois numeros separados E nega o 9.588,50 --
-- porque a soma cega e o resultado que o app produz hoje, e ela nao da erro.
--
-- OS CONTROLES
-- ------------
--   * SECAO 2 tem CONTROLE POSITIVO: reproduz a leitura CEGA (somar `amount`
--     sem olhar direcao) sobre os mesmos dados e exige 9588.50. Sem ele este
--     arquivo poderia estar provando que uma agenda de uma direcao so continua
--     certa.
--   * SECAO 1 tem a leitura ANTIGA reproduzida (`COALESCE(r.transaction_type,
--     'expense')`) e exige que ela responda 'expense' para a receita avulsa --
--     o nome do defeito, ao lado da assercao que o prende.
--   * SECAO 4 refaz o backfill de `launch_date` sobre uma linha com
--     `created_at` de 40 dias atras e exige a data ANTIGA de volta. Um backfill
--     escrito como `CURRENT_DATE` passaria em qualquer assercao que so olhasse
--     "nao e NULL".
--   * SECAO 5 exige que a data prevista possa ser ANTERIOR ao lancamento. E a
--     assercao que fica vermelha no dia em que alguem achar que um
--     `CHECK (expected_date >= launch_date)` e higiene.
--   * SECAO 6 e o controle da view refeita: DROP + CREATE perde
--     `security_invoker` e perde os GRANTs se alguem esquecer de repo-los, e o
--     sintoma disso e cada usuario vendo a agenda de todos.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 027:
--   psql "$DB_URL" -f database/tests/027_previsto_e_realizado_test.sql
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

CREATE OR REPLACE FUNCTION pg_temp.expect_text(label TEXT, got TEXT, want TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_date(label TEXT, got DATE, want DATE)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- A negacao. `expect_num` sozinho fica vermelho quando o numero muda, mas nao
-- diz QUAL numero errado apareceu -- e o numero errado desta feature e sempre o
-- mesmo: o da soma cega da agenda, que ja foi medido em producao.
CREATE OR REPLACE FUNCTION pg_temp.refute_num(label TEXT, got NUMERIC, forbidden NUMERIC)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS NOT DISTINCT FROM forbidden THEN
    RAISE EXCEPTION 'FALHA: % -> obtido %, que e exatamente o resultado da soma CEGA da agenda (receita prevista contada como conta a pagar)', label, forbidden;
  END IF;
  RAISE NOTICE 'ok: % (nao e %)', label, forbidden;
END $$;

-- --- cenario ---------------------------------------------------------------

INSERT INTO auth.users (id, email) VALUES
  ('a7000000-0000-0000-0000-0000000000a1', 'ana-previsto@teste.local'),
  ('a7000000-0000-0000-0000-0000000000b1', 'bia-previsto@teste.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name) VALUES
  ('a7000000-0000-0000-0000-0000000000a1', 'ana-previsto@teste.local', 'Ana Previsto'),
  ('a7000000-0000-0000-0000-0000000000b1', 'bia-previsto@teste.local', 'Bia Previsto')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance) VALUES
  ('f7000000-0000-0000-0000-0000000000a1', 'a7000000-0000-0000-0000-0000000000a1', 'Conta Ana', 'checking', 0);

-- Uma categoria de DESPESA e uma de RECEITA. A de receita importa: a previsao
-- de salario tem que apontar para uma categoria que nao e de gasto, senao o
-- cenario seria coerente por acidente.
CREATE TEMP TABLE cat27 AS
  SELECT id, service_id, is_expense FROM public.transaction_categories
   WHERE is_expense LIMIT 1;
INSERT INTO cat27
  SELECT id, service_id, is_expense FROM public.transaction_categories
   WHERE NOT is_expense LIMIT 1;

SELECT pg_temp.expect('o banco tem as duas categorias do cenario (1 despesa, 1 receita)',
  (SELECT COUNT(DISTINCT is_expense) FROM cat27), 2);

-- O grupo existe so para a SECAO 6: uma previsao de GRUPO, gerada por uma regra
-- de grupo, e o caso em que a direcao do outro membro depende de ele conseguir
-- LER a regra atraves da RLS.
INSERT INTO public.expense_groups (id, name, created_by) VALUES
  ('97000000-0000-0000-0000-000000000001', 'Casa Previsto', 'a7000000-0000-0000-0000-0000000000a1');

INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('97000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-0000000000b1', 'member', 'active');

SELECT pg_temp.expect('o grupo tem 2 membros ativos',
  (SELECT COUNT(*) FROM public.group_members
    WHERE group_id = '97000000-0000-0000-0000-000000000001' AND status = 'active'), 2);

-- As duas regras fixas do mes: salario (receita) e aluguel (despesa).
INSERT INTO public.recurring_rules
  (id, user_id, category_id, description, amount, transaction_type, due_day)
SELECT '17000000-0000-0000-0000-000000000001',
       'a7000000-0000-0000-0000-0000000000a1', c.id,
       'Salario', 7000.00, 'income', 5
  FROM cat27 c WHERE NOT c.is_expense;

INSERT INTO public.recurring_rules
  (id, user_id, category_id, description, amount, transaction_type, due_day)
SELECT '17000000-0000-0000-0000-000000000002',
       'a7000000-0000-0000-0000-0000000000a1', c.id,
       'Aluguel', 2500.00, 'expense', 10
  FROM cat27 c WHERE c.is_expense;

-- Regra de RECEITA do grupo (um aluguel que o grupo recebe de um inquilino, por
-- exemplo). E de receita de proposito: se a direcao do grupo se perdesse, o
-- sintoma seria o outro membro ver dinheiro que ENTRA na coluna do que vai sair.
INSERT INTO public.recurring_rules
  (id, user_id, group_id, category_id, description, amount, transaction_type, due_day)
SELECT '17000000-0000-0000-0000-000000000003',
       'a7000000-0000-0000-0000-0000000000a1',
       '97000000-0000-0000-0000-000000000001', c.id,
       'Aluguel recebido da casa', 900.00, 'income', 15
  FROM cat27 c WHERE NOT c.is_expense;

-- As ocorrencias. `transaction_type` fica NULL nas que tem regra: a regra manda
-- nelas, e e essa precedencia que a SECAO 1 prova.
INSERT INTO public.scheduled_transactions
  (id, user_id, recurring_rule_id, category_id, account_id, description, amount, due_date, status)
SELECT '27000000-0000-0000-0000-000000000001',
       'a7000000-0000-0000-0000-0000000000a1',
       '17000000-0000-0000-0000-000000000001', c.id,
       'f7000000-0000-0000-0000-0000000000a1',
       'Salario', 7000.00, CURRENT_DATE + 5, 'pending'
  FROM cat27 c WHERE NOT c.is_expense;

INSERT INTO public.scheduled_transactions
  (id, user_id, recurring_rule_id, category_id, account_id, description, amount, due_date, status)
SELECT '27000000-0000-0000-0000-000000000002',
       'a7000000-0000-0000-0000-0000000000a1',
       '17000000-0000-0000-0000-000000000002', c.id,
       'f7000000-0000-0000-0000-0000000000a1',
       'Aluguel', 2500.00, CURRENT_DATE + 10, 'pending'
  FROM cat27 c WHERE c.is_expense;

-- O boleto avulso: sem regra e sem `transaction_type`. E a linha que a rota de
-- baixa sempre leu como despesa pelo `?? 'expense'`, e ela tem que continuar
-- lendo assim -- o fallback e o que impede as linhas antigas de virarem receita
-- de um dia para o outro.
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, account_id, description, amount, due_date, status)
SELECT '27000000-0000-0000-0000-000000000003',
       'a7000000-0000-0000-0000-0000000000a1', c.id,
       'f7000000-0000-0000-0000-0000000000a1',
       'IPTU avulso', 88.50, CURRENT_DATE + 20, 'pending'
  FROM cat27 c WHERE c.is_expense;

-- A RECEITA PREVISTA AVULSA: a linha que a HMO-188 cria e que nao existia.
-- Sem a coluna nova ela seria indistinguivel do boleto de cima.
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, account_id, description, amount, due_date, status, transaction_type)
SELECT '27000000-0000-0000-0000-000000000004',
       'a7000000-0000-0000-0000-0000000000a1', c.id,
       'f7000000-0000-0000-0000-0000000000a1',
       'Freela combinado', 1500.00, CURRENT_DATE + 7, 'pending', 'income'
  FROM cat27 c WHERE NOT c.is_expense;

-- Ocorrencia de uma regra de DESPESA com a direcao sobrescrita na propria
-- ocorrencia. Existe para provar a PRECEDENCIA: a ocorrencia ganha da regra.
-- Sem esta linha, um COALESCE escrito na ordem inversa (regra primeiro) passaria
-- em todas as outras assercoes deste arquivo.
INSERT INTO public.scheduled_transactions
  (id, user_id, recurring_rule_id, category_id, account_id, description, amount, due_date, status, transaction_type)
SELECT '27000000-0000-0000-0000-000000000005',
       'a7000000-0000-0000-0000-0000000000a1',
       '17000000-0000-0000-0000-000000000002', c.id,
       'f7000000-0000-0000-0000-0000000000a1',
       'Aluguel estornado este mes', 2500.00, CURRENT_DATE + 11, 'cancelled', 'income'
  FROM cat27 c WHERE c.is_expense;

-- A ocorrencia do grupo, gerada pela regra de receita do grupo.
INSERT INTO public.scheduled_transactions
  (id, user_id, recurring_rule_id, group_id, category_id, description, amount, due_date, status)
SELECT '27000000-0000-0000-0000-000000000006',
       'a7000000-0000-0000-0000-0000000000a1',
       '17000000-0000-0000-0000-000000000003',
       '97000000-0000-0000-0000-000000000001', c.id,
       'Aluguel recebido da casa', 900.00, CURRENT_DATE + 15, 'pending'
  FROM cat27 c WHERE NOT c.is_expense;

-- =====================================================
-- 1. A direcao, e a precedencia ocorrencia -> regra -> expense
-- =====================================================
SELECT pg_temp.expect_text('ocorrencia de regra de receita herda income da regra',
  (SELECT direction::TEXT FROM public.scheduled_transactions_effective
    WHERE id = '27000000-0000-0000-0000-000000000001'), 'income');

SELECT pg_temp.expect_text('ocorrencia de regra de despesa herda expense da regra',
  (SELECT direction::TEXT FROM public.scheduled_transactions_effective
    WHERE id = '27000000-0000-0000-0000-000000000002'), 'expense');

SELECT pg_temp.expect_text('avulsa sem direcao continua sendo lida como despesa',
  (SELECT direction::TEXT FROM public.scheduled_transactions_effective
    WHERE id = '27000000-0000-0000-0000-000000000003'), 'expense');

-- A assercao central da migration.
SELECT pg_temp.expect_text('a RECEITA prevista avulsa e lida como income',
  (SELECT direction::TEXT FROM public.scheduled_transactions_effective
    WHERE id = '27000000-0000-0000-0000-000000000004'), 'income');

SELECT pg_temp.expect_text('a direcao da ocorrencia GANHA da direcao da regra',
  (SELECT direction::TEXT FROM public.scheduled_transactions_effective
    WHERE id = '27000000-0000-0000-0000-000000000005'), 'income');

-- O NOME DO DEFEITO, AO LADO DA ASSERCAO QUE O PRENDE
-- ---------------------------------------------------
-- A leitura ANTIGA, reproduzida sobre os MESMOS dados: so a regra, com
-- 'expense' no fim. Ela responde 'expense' para a receita avulsa de R$ 1.500 --
-- e e exatamente por isso que confirmar aquele freela gravaria -1500.
--
-- Esta assercao pode falhar de verdade: se a linha 004 do cenario ganhasse uma
-- regra por descuido, a leitura antiga acertaria e o controle ficaria vermelho,
-- avisando que o cenario deixou de exercitar o caso avulso.
SELECT pg_temp.expect_text(
  'CONTROLE: a leitura antiga (so a regra) chama a receita avulsa de expense',
  (SELECT COALESCE(r.transaction_type, 'expense'::public.transaction_financial_type)::TEXT
     FROM public.scheduled_transactions s
     LEFT JOIN public.recurring_rules r ON r.id = s.recurring_rule_id
    WHERE s.id = '27000000-0000-0000-0000-000000000004'), 'expense');

-- O LEFT JOIN nao pode descartar linha. Uma previsao avulsa nao tem regra, e um
-- INNER JOIN aqui fez a agenda perder TODO boleto lancado a mao -- a tela
-- abriria com a lista mais curta e nenhum erro.
SELECT pg_temp.expect('a view devolve as 6 previsoes do cenario, nenhuma perdida no JOIN',
  (SELECT COUNT(*) FROM public.scheduled_transactions_effective
    WHERE user_id = 'a7000000-0000-0000-0000-0000000000a1'), 6);

SELECT pg_temp.expect('e a tabela tem as mesmas 6',
  (SELECT COUNT(*) FROM public.scheduled_transactions
    WHERE user_id = 'a7000000-0000-0000-0000-0000000000a1'), 6);

-- A 022 pos `currency` na tabela e a view do 005 nunca a expos (o `s.*` foi
-- expandido na criacao). As rotas fazem select("*") na view, entao a moeda da
-- previsao nao chegava a tela nenhuma.
SELECT pg_temp.expect_text('a view expoe a moeda da previsao',
  (SELECT currency FROM public.scheduled_transactions_effective
    WHERE id = '27000000-0000-0000-0000-000000000003'), 'BRL');

-- O status derivado nao pode ter se perdido na recriacao da view: 'overdue'
-- nunca e gravado, ele e calculado. Esta assercao e do 005 e continua sendo
-- dele -- ela esta aqui porque a 027 refez a view, e o que a recriacao pode
-- perder e justamente o que ninguem reescreve olhando.
SELECT pg_temp.expect('nenhuma linha GRAVA o status overdue',
  (SELECT COUNT(*) FROM public.scheduled_transactions
    WHERE status = 'overdue'), 0);

UPDATE public.scheduled_transactions
   SET due_date = CURRENT_DATE - 5
 WHERE id = '27000000-0000-0000-0000-000000000003';

SELECT pg_temp.expect_text('a view ainda calcula overdue depois de ser refeita',
  (SELECT effective_status::TEXT FROM public.scheduled_transactions_effective
    WHERE id = '27000000-0000-0000-0000-000000000003'), 'overdue');

SELECT pg_temp.expect('e days_until_due continua negativo na vencida',
  (SELECT days_until_due FROM public.scheduled_transactions_effective
    WHERE id = '27000000-0000-0000-0000-000000000003')::BIGINT, -5);

-- =====================================================
-- 2. A agenda separada em a pagar / a receber
-- =====================================================
-- Os numeros de producao (HMO-186): 7.000 de receita, 2.500 + 88,50 de despesa.
-- A linha 004 (freela, 1.500) e a 005 (cancelada) ficam FORA desta conta: a
-- primeira porque ela entra na assercao seguinte, a segunda porque 'cancelled'
-- nao faz parte da promessa do mes. O recorte por status e o mesmo de
-- STATUS_FORA_DO_PREVISTO em lib/previsto-x-realizado.ts.
CREATE TEMP VIEW agenda27 AS
  SELECT direction, amount, status
    FROM public.scheduled_transactions_effective
   WHERE user_id = 'a7000000-0000-0000-0000-0000000000a1'
     AND group_id IS NULL
     AND status NOT IN ('skipped', 'cancelled');

SELECT pg_temp.expect_num('a receber = 7.000 do salario + 1.500 do freela',
  (SELECT COALESCE(SUM(amount), 0) FROM agenda27 WHERE direction = 'income'), 8500.00);

SELECT pg_temp.expect_num('a pagar = 2.500 do aluguel + 88,50 do IPTU',
  (SELECT COALESCE(SUM(amount), 0) FROM agenda27 WHERE direction = 'expense'), 2588.50);

-- CONTROLE POSITIVO: a soma CEGA, que e o que /api/scheduled-transactions/
-- summary faz hoje em `total_pending`. Ela devolve 11.088,50 neste cenario --
-- e em producao devolveu 9.588,50 quando o que ia sair eram 2.588,50.
--
-- Sem este controle, este arquivo poderia estar rodando num banco onde
-- `direction` devolvesse sempre a mesma coisa e as duas assercoes acima
-- continuariam plausiveis.
SELECT pg_temp.expect_num(
  'CONTROLE: a soma cega da agenda da 11.088,50 (receita contada como conta a pagar)',
  (SELECT COALESCE(SUM(amount), 0) FROM agenda27), 11088.50);

SELECT pg_temp.refute_num('e o a pagar NAO e a soma cega',
  (SELECT COALESCE(SUM(amount), 0) FROM agenda27 WHERE direction = 'expense'), 11088.50);

-- =====================================================
-- 3. O CHECK da direcao: fecha transfer, e nao fecha mais que isso
-- =====================================================
-- Transferencia entre contas proprias e duas pernas que se anulam. Uma previsao
-- de transferencia nao muda patrimonio nenhum, e aceitar o valor aqui criaria um
-- terceiro caso que toda soma de agenda teria de tratar -- o tratamento
-- esquecido seria contar a perna de saida como despesa prevista.
DO $$
BEGIN
  INSERT INTO public.scheduled_transactions
    (user_id, category_id, description, amount, due_date, transaction_type)
  SELECT 'a7000000-0000-0000-0000-0000000000a1', c.id,
         'Transferencia prevista', 100.00, CURRENT_DATE, 'transfer'
    FROM cat27 c WHERE c.is_expense;
  RAISE EXCEPTION 'FALHA: o banco aceitou uma previsao com direcao transfer';
EXCEPTION
  WHEN check_violation THEN
    RAISE NOTICE 'ok: previsao com direcao transfer recusada pelo CHECK';
END $$;

-- O CONTRAPESO: uma trava que recusasse TUDO tambem passaria na assercao de
-- cima. As duas direcoes legitimas e o NULL ("pergunte a regra") tem que
-- entrar.
-- Cada direcao e testada no seu proprio bloco para que a mensagem diga QUAL
-- delas o CHECK recusou. Um `EXCEPTION WHEN check_violation` por volta das tres
-- juntas diria so "alguma", e a recusa de 'income' (a que a HMO-188 precisa) e
-- indistinguivel da recusa de 'expense' (que quebraria o app que ja esta no ar).
DO $$
DECLARE
  cat UUID;
BEGIN
  SELECT id INTO cat FROM cat27 WHERE is_expense;

  BEGIN
    INSERT INTO public.scheduled_transactions
      (user_id, category_id, description, amount, due_date, transaction_type)
    VALUES ('a7000000-0000-0000-0000-0000000000a1', cat, 'Positivo expense', 1, CURRENT_DATE, 'expense');
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'FALHA: o CHECK da direcao recusou expense -- a trava e larga demais e quebra a conta a pagar que ja existe';
  END;

  BEGIN
    INSERT INTO public.scheduled_transactions
      (user_id, category_id, description, amount, due_date, transaction_type)
    VALUES ('a7000000-0000-0000-0000-0000000000a1', cat, 'Positivo income', 1, CURRENT_DATE, 'income');
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'FALHA: o CHECK da direcao recusou income -- e income e exatamente o que a HMO-188 precisa gravar';
  END;

  BEGIN
    INSERT INTO public.scheduled_transactions
      (user_id, category_id, description, amount, due_date, transaction_type)
    VALUES ('a7000000-0000-0000-0000-0000000000a1', cat, 'Positivo null', 1, CURRENT_DATE, NULL);
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'FALHA: o CHECK da direcao recusou NULL -- NULL e "pergunte a regra", e toda ocorrencia gerada por regra usa isso';
  END;

  RAISE NOTICE 'ok: income, expense e NULL passam (a trava nao e larga demais)';
END $$;

-- Desfeitas: as tres linhas do contrapeso nao podem contaminar a SECAO 6.
DELETE FROM public.scheduled_transactions
 WHERE description IN ('Positivo expense', 'Positivo income', 'Positivo null');

-- =====================================================
-- 3b. O BACKFILL, sobre o historico plantado antes da 027
-- =====================================================
-- As linhas conferidas aqui foram criadas por
-- database/tests/027_historico_antes_da_027.sql, que roda ENTRE a 026 e a 027.
-- Elas existem porque o db-verify constroi o banco do zero: sem historico, os
-- UPDATEs de backfill da 027 tocam zero linhas e NENHUMA assercao consegue
-- distinguir um backfill correto de um ausente. Medido: tres mutantes da 027
-- sobreviveram ao arquivo inteiro antes deste bloco existir.
--
-- A previsao avulsa antiga tem que ter a direcao GRAVADA, e nao apenas resolvida
-- pelo COALESCE da view. A diferenca e o que separa esta assercao da SECAO 1: a
-- view responderia 'expense' para ela mesmo que o backfill nunca tivesse
-- rodado.
SELECT pg_temp.expect_text('o backfill GRAVOU expense na previsao avulsa antiga',
  (SELECT transaction_type::TEXT FROM public.scheduled_transactions
    WHERE id = '27900000-0000-0000-0000-000000000099'), 'expense');

-- E o outro lado: a ocorrencia COM regra tem que ter ficado NULL. Um backfill
-- sem o `recurring_rule_id IS NULL` no WHERE congelaria a direcao aqui, e
-- editar a regra deixaria de reapontar a ocorrencia.
SELECT pg_temp.expect('a ocorrencia antiga COM regra ficou sem direcao propria',
  (SELECT COUNT(*) FROM public.scheduled_transactions
    WHERE id = '27900000-0000-0000-0000-000000000098'
      AND transaction_type IS NULL), 1);

-- ...e a direcao dela ainda resolve para income, pela regra.
SELECT pg_temp.expect_text('e a direcao dela sai da regra: income',
  (SELECT direction::TEXT FROM public.scheduled_transactions_effective
    WHERE id = '27900000-0000-0000-0000-000000000098'), 'income');

-- Nenhuma OUTRA ocorrencia com regra pode ter ganhado direcao propria. O
-- `<> 005` exclui a linha que este arquivo criou de proposito para provar a
-- precedencia.
SELECT pg_temp.expect('nenhuma ocorrencia COM regra ganhou direcao propria no backfill',
  (SELECT COUNT(*) FROM public.scheduled_transactions
    WHERE recurring_rule_id IS NOT NULL
      AND transaction_type IS NOT NULL
      AND id <> '27000000-0000-0000-0000-000000000005'), 0);

-- O LANCAMENTO DE 40 DIAS ATRAS: as tres datas candidatas dao tres respostas
-- diferentes nesta linha, e so uma delas e a certa.
--
--   created_at::date   = hoje - 40   <- o backfill correto
--   transaction_date   = hoje - 45
--   CURRENT_DATE       = hoje
SELECT pg_temp.expect_date('launch_date do lancamento antigo saiu de created_at',
  (SELECT launch_date FROM public.financial_transactions
    WHERE id = '77900000-0000-0000-0000-000000000099'),
  (now() - INTERVAL '40 days')::date);

SELECT pg_temp.refute_num('e NAO e hoje (o backfill nao reescreveu o historico)',
  (SELECT launch_date FROM public.financial_transactions
    WHERE id = '77900000-0000-0000-0000-000000000099') - CURRENT_DATE, 0);

SELECT pg_temp.refute_num('e NAO e transaction_date (anotar e acontecer sao coisas diferentes)',
  (SELECT launch_date - transaction_date FROM public.financial_transactions
    WHERE id = '77900000-0000-0000-0000-000000000099'), 0);

-- E `expected_date` tem que ter ficado NULL: copiar `transaction_date` aqui
-- faria o lancamento antigo AFIRMAR que saiu no dia previsto, e um relatorio de
-- atraso sairia com zero atrasos.
SELECT pg_temp.expect('expected_date do lancamento antigo ficou NULL',
  (SELECT COUNT(*) FROM public.financial_transactions
    WHERE id = '77900000-0000-0000-0000-000000000099'
      AND expected_date IS NULL), 1);

SELECT pg_temp.expect('nenhum lancamento anterior a 027 ganhou data prevista inventada',
  (SELECT COUNT(*) FROM public.financial_transactions
    WHERE expected_date IS NOT NULL
      AND created_at < now() - INTERVAL '1 day'), 0);

-- =====================================================
-- 4. launch_date: o dia do lancamento
-- =====================================================
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, description, amount,
   transaction_date, transaction_type, created_at)
SELECT '77000000-0000-0000-0000-000000000001',
       'a7000000-0000-0000-0000-0000000000a1',
       'f7000000-0000-0000-0000-0000000000a1',
       c.service_id, c.id, 'Aluguel de 40 dias atras', -2500.00,
       CURRENT_DATE - 40, 'expense', now() - INTERVAL '40 days'
  FROM cat27 c WHERE c.is_expense;

-- O DEFAULT: toda rota que ja existe hoje NAO manda a coluna, e o que ela grava
-- e hoje -- que e a verdade sobre quando a linha foi anotada, mesmo que o
-- dinheiro tenha andado em outro dia.
SELECT pg_temp.expect_date('sem mandar a coluna, launch_date e hoje',
  (SELECT launch_date FROM public.financial_transactions
    WHERE id = '77000000-0000-0000-0000-000000000001'), CURRENT_DATE);

SELECT pg_temp.expect_date('e transaction_date continua sendo o dia em que o dinheiro andou',
  (SELECT transaction_date FROM public.financial_transactions
    WHERE id = '77000000-0000-0000-0000-000000000001'), CURRENT_DATE - 40);

SELECT pg_temp.expect('nenhuma linha ficou com launch_date NULL',
  (SELECT COUNT(*) FROM public.financial_transactions WHERE launch_date IS NULL), 0);

DO $$
BEGIN
  INSERT INTO public.financial_transactions
    (user_id, account_id, service_id, category_id, description, amount,
     transaction_date, transaction_type, launch_date)
  SELECT 'a7000000-0000-0000-0000-0000000000a1',
         'f7000000-0000-0000-0000-0000000000a1',
         c.service_id, c.id, 'Sem dia de lancamento', -1.00,
         CURRENT_DATE, 'expense', NULL
    FROM cat27 c WHERE c.is_expense;
  RAISE EXCEPTION 'FALHA: o banco aceitou lancamento sem launch_date';
EXCEPTION
  WHEN not_null_violation THEN
    RAISE NOTICE 'ok: launch_date NULL recusado';
END $$;

-- O BACKFILL, REFEITO SOBRE UMA LINHA DE 40 DIAS ATRAS
-- ----------------------------------------------------
-- Esta e a unica forma honesta de provar o backfill num banco construido do
-- zero: no db-verify a 027 roda num banco sem historico nenhum, entao o UPDATE
-- dela nao toca em linha alguma e uma assercao de "nao e NULL" passaria verde
-- sem exercitar nada.
--
-- Aqui a coluna e solta, a linha e zerada e o MESMO comando da migration roda de
-- novo. O que ele tem que devolver e a data ANTIGA (40 dias atras), e nao hoje:
-- um backfill escrito `SET launch_date = CURRENT_DATE` passaria em qualquer
-- assercao que so olhasse "nao e NULL", e teria reescrito o historico inteiro
-- como se tudo tivesse sido anotado no dia em que a migration rodou.
--
-- O DDL e transacional no Postgres: o ROLLBACK do fim desfaz o DROP NOT NULL.
ALTER TABLE public.financial_transactions ALTER COLUMN launch_date DROP NOT NULL;

UPDATE public.financial_transactions
   SET launch_date = NULL
 WHERE id = '77000000-0000-0000-0000-000000000001';

SELECT pg_temp.expect('a linha esta zerada antes do backfill',
  (SELECT COUNT(*) FROM public.financial_transactions WHERE launch_date IS NULL), 1);

UPDATE public.financial_transactions
   SET launch_date = COALESCE(created_at::date, CURRENT_DATE)
 WHERE launch_date IS NULL;

SELECT pg_temp.expect_date('o backfill recupera o dia de created_at, e nao hoje',
  (SELECT launch_date FROM public.financial_transactions
    WHERE id = '77000000-0000-0000-0000-000000000001'), (now() - INTERVAL '40 days')::date);

SELECT pg_temp.refute_num('e esse dia NAO e hoje (senao o backfill reescreveria o historico)',
  (SELECT launch_date FROM public.financial_transactions
    WHERE id = '77000000-0000-0000-0000-000000000001') - CURRENT_DATE, 0);

ALTER TABLE public.financial_transactions ALTER COLUMN launch_date SET NOT NULL;

-- =====================================================
-- 5. expected_date: o dia previsto, e a ausencia dele
-- =====================================================
-- NULL quer dizer "nao havia previsao separada", e nao "previsto para hoje".
-- Copiar `transaction_date` no backfill faria todo lancamento antigo AFIRMAR que
-- saiu no dia previsto, e um relatorio de atraso sairia com zero atrasos e cara
-- de verdade.
SELECT pg_temp.expect('lancamento que nao declarou previsao fica com expected_date NULL',
  (SELECT COUNT(*) FROM public.financial_transactions
    WHERE id = '77000000-0000-0000-0000-000000000001'
      AND expected_date IS NULL), 1);

-- O CASO QUE PROIBE O CHECK CRUZADO
-- ---------------------------------
-- "Esqueci de lancar o aluguel do dia 5": anotado hoje, previsto para uma data
-- JA PASSADA. Um `CHECK (expected_date >= launch_date)` recusaria isso -- e
-- recusaria tambem toda edicao de linha antiga em que alguem preenchesse a data
-- prevista, porque `launch_date` daquela linha e o dia em que ela nasceu.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, description, amount,
   transaction_date, transaction_type, launch_date, expected_date)
SELECT '77000000-0000-0000-0000-000000000002',
       'a7000000-0000-0000-0000-0000000000a1',
       'f7000000-0000-0000-0000-0000000000a1',
       c.service_id, c.id, 'Aluguel esquecido do dia 5', -2500.00,
       CURRENT_DATE, 'expense', CURRENT_DATE, CURRENT_DATE - 25
  FROM cat27 c WHERE c.is_expense;

SELECT pg_temp.expect_date('data prevista ANTERIOR ao lancamento e aceita',
  (SELECT expected_date FROM public.financial_transactions
    WHERE id = '77000000-0000-0000-0000-000000000002'), CURRENT_DATE - 25);

-- E o caso normal: previsto para depois.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, description, amount,
   transaction_date, transaction_type, launch_date, expected_date)
SELECT '77000000-0000-0000-0000-000000000003',
       'a7000000-0000-0000-0000-0000000000a1',
       'f7000000-0000-0000-0000-0000000000a1',
       c.service_id, c.id, 'Salario de outubro', 7000.00,
       CURRENT_DATE, 'income', CURRENT_DATE, CURRENT_DATE + 5
  FROM cat27 c WHERE NOT c.is_expense;

SELECT pg_temp.expect_date('data prevista POSTERIOR tambem e aceita',
  (SELECT expected_date FROM public.financial_transactions
    WHERE id = '77000000-0000-0000-0000-000000000003'), CURRENT_DATE + 5);

-- As tres datas de uma mesma linha sao independentes: nenhuma delas e derivada
-- de outra. Esta assercao e o que fica vermelha se alguem puser um trigger de
-- "carimbo" sincronizando duas delas.
SELECT pg_temp.expect('as tres datas do lancamento esquecido sao distintas entre si',
  (SELECT COUNT(DISTINCT d) FROM (
     SELECT launch_date AS d FROM public.financial_transactions
       WHERE id = '77000000-0000-0000-0000-000000000002'
     UNION ALL
     SELECT expected_date FROM public.financial_transactions
       WHERE id = '77000000-0000-0000-0000-000000000002'
     UNION ALL
     SELECT transaction_date - 1 FROM public.financial_transactions
       WHERE id = '77000000-0000-0000-0000-000000000002'
   ) t), 3);

-- O indice e PARCIAL de proposito (a coluna e NULL na maioria das linhas). Fica
-- registrado aqui porque indice parcial NAO serve de arbitro de ON CONFLICT:
-- quem um dia escrever um upsert por data prevista precisa saber disso antes de
-- levar o erro.
SELECT pg_temp.expect('o indice de data prevista existe e e parcial',
  (SELECT COUNT(*) FROM pg_index i
     JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'idx_transactions_expected_date'
      AND i.indpred IS NOT NULL), 1);

-- =====================================================
-- 6. A view refeita nao perdeu a RLS nem os GRANTs
-- =====================================================
-- DROP + CREATE joga fora `security_invoker` e o ACL. Sem eles a view roda com o
-- privilegio do DONO e devolve a agenda INTEIRA para qualquer usuario logado --
-- o furo que o 005 fechou, reaberto por uma migration que so queria acrescentar
-- uma coluna.
SELECT pg_temp.expect('a view esta com security_invoker ligado',
  (SELECT COUNT(*) FROM pg_class
    WHERE relname = 'scheduled_transactions_effective'
      AND reloptions @> ARRAY['security_invoker=true']), 1);

-- O ACL, LIDO DIRETO DO CATALOGO
-- ------------------------------
-- A assercao de comportamento la embaixo ("anon nao le a view") NAO pega um
-- GRANT sobrando para anon, e isso foi medido: um mutante que trocava
-- `REVOKE ... FROM anon` por `GRANT SELECT ... TO authenticated, anon`
-- sobreviveu ao arquivo inteiro. O motivo e que `security_invoker` faz a view
-- ler a tabela BASE como anon, e a tabela base ja recusa -- entao o
-- comportamento fica certo por um segundo motivo, e a primeira linha de defesa
-- pode cair sem sintoma nenhum. O dia em que alguem relaxar o grant da tabela,
-- a view estaria aberta.
SELECT pg_temp.expect('anon NAO aparece no ACL da view',
  (SELECT COUNT(*) FROM pg_class c
     CROSS JOIN LATERAL aclexplode(c.relacl) a
     JOIN pg_roles r ON r.oid = a.grantee
    WHERE c.relname = 'scheduled_transactions_effective'
      AND r.rolname = 'anon'), 0);

SELECT pg_temp.expect('e authenticated aparece com SELECT (senao a agenda some da tela)',
  (SELECT COUNT(*) FROM pg_class c
     CROSS JOIN LATERAL aclexplode(c.relacl) a
     JOIN pg_roles r ON r.oid = a.grantee
    WHERE c.relname = 'scheduled_transactions_effective'
      AND r.rolname = 'authenticated'
      AND a.privilege_type = 'SELECT'), 1);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a7000000-0000-0000-0000-0000000000b1';

SELECT pg_temp.expect('B NAO ve as previsoes pessoais da A pela view',
  (SELECT COUNT(*) FROM public.scheduled_transactions_effective
    WHERE group_id IS NULL), 0);

-- ...mas ve a do grupo de que participa, e COM a direcao certa. A direcao dela
-- sai da regra, e a regra e de grupo -- a policy `recurring_rules_select` deixa
-- o membro le-la. Se a regra fosse invisivel para B, o LEFT JOIN devolveria NULL
-- e o COALESCE cairia para 'expense': B veria dinheiro que ENTRA na coluna do
-- que vai sair.
SELECT pg_temp.expect('B ve a previsao do grupo',
  (SELECT COUNT(*) FROM public.scheduled_transactions_effective
    WHERE id = '27000000-0000-0000-0000-000000000006'), 1);

SELECT pg_temp.expect_text('e para B a direcao dela ainda e income, nao expense',
  (SELECT direction::TEXT FROM public.scheduled_transactions_effective
    WHERE id = '27000000-0000-0000-0000-000000000006'), 'income');

RESET ROLE;

-- O claim do JWT SOBREVIVE ao RESET ROLE: sem limpar, `auth.uid()` continuaria
-- devolvendo a B nas secoes seguintes e o teste que quebrasse seria outro,
-- centenas de linhas depois.
SET LOCAL request.jwt.claim.sub = '';

SET LOCAL ROLE anon;

DO $$
BEGIN
  PERFORM 1 FROM public.scheduled_transactions_effective;
  RAISE EXCEPTION 'FALHA: anon leu a view de contas previstas depois da recriacao';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: anon sem privilegio na view refeita';
END $$;

RESET ROLE;

ROLLBACK;
