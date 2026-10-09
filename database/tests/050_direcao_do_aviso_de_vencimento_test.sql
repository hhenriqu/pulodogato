-- =====================================================
-- Teste da direcao do aviso de vencimento (050)
-- =====================================================
-- HMO-350. Roda no db-verify contra o banco que as migrations constroem do
-- zero, DEPOIS da 050 -- a posicao importa duas vezes:
--
--   * antes da 050 toda assercao de direcao veria a view da 047 e o caso 1
--     reprovaria (que e o controle NEGATIVO deste arquivo: `PGDATABASE` parado
--     na 049 deixa a secao 1 vermelha);
--   * e a 050 e a UNICA migration que faz `bill_alerts` ler a direcao da
--     ocorrencia. Qualquer migration futura que recole a view carrega a
--     definicao inteira e pode reverter isto em silencio -- por isso este
--     arquivo e re-rodado no FIM da cadeia pelo db-verify.
--
-- O QUE ESTE ARQUIVO PRENDE
-- -------------------------
-- 1. RECEITA PREVISTA AVULSA SAI COMO CONTA A PAGAR. O defeito da issue, com
--    o controle positivo que isola a causa: receita COM regra sempre acertou
--    (a view lia `recurring_rules.transaction_type`), e e a receita SEM regra
--    que errava. Se as duas sairem iguais num mundo e iguais no outro, o teste
--    nao distingue "conserto" de "cenario nao montado".
--
-- 2. DESPESA AVULSA ACERTAVA POR ACASO, e tem que continuar acertando. E a
--    maioria das linhas de producao: um conserto que inverta ESTE caso troca
--    um defeito pequeno por um grande, e o `COALESCE` velho tambem passaria
--    nele -- entao ele sozinho nao prova nada e junto com o caso 1 prova tudo.
--
-- 3. A DIRECAO NAO ENTRA NO WHERE. Receita prevista continua gerando aviso: o
--    conserto e o ROTULO, nao a lista. Um `WHERE s.direction <> 'income'` daria
--    verde no caso 1 por apagar a linha -- a secao 2 conta as linhas.
--
-- 4. `transfer` SOBREVIVE. A view tem que devolver os tres valores do enum. Um
--    conserto escrito como `CASE WHEN ... THEN 'income' ELSE 'expense' END`
--    apagaria `transfer` e a frase do app perderia a unica informacao que
--    distingue uma transferencia agendada de uma conta.
--
-- 5. A 047 CONTINUA DE PE. A 050 recola `bill_alerts` INTEIRA: `notify_email`,
--    o `COALESCE` dela, o `security_invoker` e os 13 nomes/ordem de coluna
--    podem todos ter sido perdidos no caminho. A secao 4 le o catalogo.
--
-- 6. A VIEW CONTINUA VENDO O VENCIDO. A 050 troca o `FROM` por
--    `scheduled_transactions_effective`, que tem `effective_status` -- e essa
--    coluna envelhece a linha para 'overdue' sozinha. Filtrar por ela em vez
--    de `status` apagaria da view TODA conta vencida, que e metade do que ela
--    avisa. A secao 3 exige a linha vencida presente, com `kind = 'overdue'`.
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

CREATE OR REPLACE FUNCTION pg_temp.expect_txt(label TEXT, got TEXT, want TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_bool(label TEXT, got BOOLEAN, want BOOLEAN)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- =====================================================
-- Fixture: a da PROVA da issue, reduzida ao que distingue
-- =====================================================
-- Uma pessoa, `days_before` alargado para 25 -- pelo mesmo motivo pratico da
-- sonda de producao: com o default de 3 dias as linhas de teste cairiam fora
-- da janela e a view voltaria VAZIA, o que deixaria todas as assercoes de
-- direcao vacuamente verdes (0 = 0).
--
-- Cinco linhas, e cada par existe para separar uma causa da outra:
--
--   descricao                  regra?  tipo da ocorrencia  o que prova
--   -------------------------  ------  ------------------  -----------------
--   Bonus (previsto)           NAO     income              o DEFEITO
--   Aluguel recebido (fixa)    sim     NULL (vem da regra) o controle +
--   Energia (prevista)         NAO     NULL                acerto por acaso
--   Plano de saude (fixa)      sim     NULL (regra expense) despesa com regra
--   PIX para a poupanca        NAO     transfer            o terceiro valor
--
-- O "Aluguel recebido" nasce com `transaction_type` NULO de proposito: e assim
-- que a materializacao de regra grava, e e o caso em que `direction` tem que
-- cair para a REGRA. Se a fixture gravasse 'income' na ocorrencia tambem, o
-- teste passaria com uma 050 que ignorasse a regra por completo.

INSERT INTO auth.users (id, email) VALUES
  ('5a000000-0000-0000-0000-000000000350', 'hmo350@teste.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('5a000000-0000-0000-0000-000000000350', 'Conta 350', FALSE);

INSERT INTO public.notification_preferences (user_id, days_before, notify_due_soon, notify_overdue)
VALUES ('5a000000-0000-0000-0000-000000000350', 25, TRUE, TRUE);

-- Duas contas: a segunda e exigida pelo CHECK `scheduled_transactions_destino_check`
-- (038), que obriga transferencia prevista a ter destino DIFERENTE da origem.
INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance) VALUES
  ('5b000000-0000-0000-0000-000000000350', '5a000000-0000-0000-0000-000000000350', 'Conta 350', 'checking', 1000),
  ('5b000000-0000-0000-0000-000000000351', '5a000000-0000-0000-0000-000000000350', 'Poupanca 350', 'savings', 500);

-- As duas regras. `transaction_type` da regra e o que a view ANTIGA lia, e e
-- por isso que receita COM regra sempre acertou.
INSERT INTO public.recurring_rules
  (id, user_id, account_id, category_id, description, amount, frequency, start_date, transaction_type)
SELECT '5c000000-0000-0000-0000-000000000351', '5a000000-0000-0000-0000-000000000350',
       '5b000000-0000-0000-0000-000000000350', c.id, 'Aluguel recebido (fixa)', 2000.00,
       'monthly', CURRENT_DATE - 60, 'income'
  FROM public.transaction_categories c WHERE NOT c.is_expense LIMIT 1;

INSERT INTO public.recurring_rules
  (id, user_id, account_id, category_id, description, amount, frequency, start_date, transaction_type)
SELECT '5c000000-0000-0000-0000-000000000352', '5a000000-0000-0000-0000-000000000350',
       '5b000000-0000-0000-0000-000000000350', c.id, 'Plano de saude (fixa)', 1000.00,
       'monthly', CURRENT_DATE - 60, 'expense'
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

-- `amount` POSITIVO nas cinco: `scheduled_transactions` tem CHECK (amount > 0)
-- e a direcao nunca morou no sinal.

-- 1. O DEFEITO: receita AVULSA, sem regra nenhuma.
INSERT INTO public.scheduled_transactions
  (id, user_id, account_id, category_id, description, amount, due_date, status, transaction_type)
SELECT '5d000000-0000-0000-0000-000000000351', '5a000000-0000-0000-0000-000000000350',
       '5b000000-0000-0000-0000-000000000350', c.id, 'Bonus (previsto)', 50.00,
       CURRENT_DATE + 20, 'pending', 'income'
  FROM public.transaction_categories c WHERE NOT c.is_expense LIMIT 1;

-- 2. O CONTROLE POSITIVO: receita COM regra, ocorrencia sem tipo proprio.
INSERT INTO public.scheduled_transactions
  (id, user_id, account_id, category_id, recurring_rule_id, description, amount, due_date, status, transaction_type)
SELECT '5d000000-0000-0000-0000-000000000352', '5a000000-0000-0000-0000-000000000350',
       '5b000000-0000-0000-0000-000000000350', c.id, '5c000000-0000-0000-0000-000000000351',
       'Aluguel recebido (fixa)', 2000.00, CURRENT_DATE + 16, 'pending', NULL
  FROM public.transaction_categories c WHERE NOT c.is_expense LIMIT 1;

-- 3. O ACERTO POR ACASO: despesa avulsa, sem tipo e sem regra -> 'expense' pelo
--    fim da precedencia. E a maioria das linhas de producao.
INSERT INTO public.scheduled_transactions
  (id, user_id, account_id, category_id, description, amount, due_date, status, transaction_type)
SELECT '5d000000-0000-0000-0000-000000000353', '5a000000-0000-0000-0000-000000000350',
       '5b000000-0000-0000-0000-000000000350', c.id, 'Energia (prevista)', 70.00,
       CURRENT_DATE + 19, 'pending', NULL
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

-- 4. Despesa COM regra.
INSERT INTO public.scheduled_transactions
  (id, user_id, account_id, category_id, recurring_rule_id, description, amount, due_date, status, transaction_type)
SELECT '5d000000-0000-0000-0000-000000000354', '5a000000-0000-0000-0000-000000000350',
       '5b000000-0000-0000-0000-000000000350', c.id, '5c000000-0000-0000-0000-000000000352',
       'Plano de saude (fixa)', 1000.00, CURRENT_DATE + 11, 'pending', NULL
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

-- 5. O TERCEIRO VALOR do enum.
INSERT INTO public.scheduled_transactions
  (id, user_id, account_id, destination_account_id, category_id, description, amount, due_date, status, transaction_type)
SELECT '5d000000-0000-0000-0000-000000000355', '5a000000-0000-0000-0000-000000000350',
       '5b000000-0000-0000-0000-000000000350', '5b000000-0000-0000-0000-000000000351',
       c.id, 'PIX para a poupanca', 100.00,
       CURRENT_DATE + 18, 'pending', 'transfer'
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

-- 6. A RECEITA VENCIDA -- o caso em que a frase errada fica pior (a view diz
--    `overdue` e o app dizia "venceu ha N dias" sobre dinheiro a receber).
INSERT INTO public.scheduled_transactions
  (id, user_id, account_id, category_id, description, amount, due_date, status, transaction_type)
SELECT '5d000000-0000-0000-0000-000000000356', '5a000000-0000-0000-0000-000000000350',
       '5b000000-0000-0000-0000-000000000350', c.id, 'Freela atrasado (previsto)', 800.00,
       CURRENT_DATE - 4, 'pending', 'income'
  FROM public.transaction_categories c WHERE NOT c.is_expense LIMIT 1;

-- =====================================================
-- SECAO 1: a direcao de cada linha
-- =====================================================
-- A ASSERCAO DA ISSUE. Sozinha ela nao distingue conserto de acidente -- e por
-- isso que as cinco abaixo vem juntas.

SELECT pg_temp.expect_txt(
  'receita prevista AVULSA sai como income (era expense -- O DEFEITO)',
  (SELECT transaction_type::text FROM public.bill_alerts
    WHERE scheduled_transaction_id = '5d000000-0000-0000-0000-000000000351'),
  'income');

SELECT pg_temp.expect_txt(
  'receita COM regra continua income (o controle positivo: isto ja acertava)',
  (SELECT transaction_type::text FROM public.bill_alerts
    WHERE scheduled_transaction_id = '5d000000-0000-0000-0000-000000000352'),
  'income');

SELECT pg_temp.expect_txt(
  'despesa AVULSA continua expense (acertava por acaso, e tem que seguir certa)',
  (SELECT transaction_type::text FROM public.bill_alerts
    WHERE scheduled_transaction_id = '5d000000-0000-0000-0000-000000000353'),
  'expense');

SELECT pg_temp.expect_txt(
  'despesa COM regra continua expense',
  (SELECT transaction_type::text FROM public.bill_alerts
    WHERE scheduled_transaction_id = '5d000000-0000-0000-0000-000000000354'),
  'expense');

-- O terceiro valor do enum sobrevive. Sem esta linha, uma 050 escrita como
-- `CASE WHEN s.direction = 'income' THEN 'income' ELSE 'expense' END` passaria
-- em todas as outras -- e a transferencia agendada viraria uma despesa a mais
-- na frase do aviso.
SELECT pg_temp.expect_txt(
  'transferencia prevista sai como transfer, e nao achatada em expense',
  (SELECT transaction_type::text FROM public.bill_alerts
    WHERE scheduled_transaction_id = '5d000000-0000-0000-0000-000000000355'),
  'transfer');

-- A OCORRENCIA VENCE A REGRA, e isto nao e redundante com as de cima: ali as
-- duas fontes concordavam. Aqui elas DISCORDAM -- uma linha gerada pela regra
-- de receita, repontada para despesa na ocorrencia. A precedencia da 027 diz
-- ocorrencia primeiro; a view ANTIGA respondia pela regra e devolveria
-- 'income'. Sem este caso, uma 050 que lesse `r.transaction_type` com
-- `COALESCE` na ordem invertida passaria verde.
UPDATE public.scheduled_transactions
   SET transaction_type = 'expense'
 WHERE id = '5d000000-0000-0000-0000-000000000352';

SELECT pg_temp.expect_txt(
  'a OCORRENCIA vence a regra quando as duas discordam (precedencia da 027)',
  (SELECT transaction_type::text FROM public.bill_alerts
    WHERE scheduled_transaction_id = '5d000000-0000-0000-0000-000000000352'),
  'expense');

UPDATE public.scheduled_transactions
   SET transaction_type = NULL
 WHERE id = '5d000000-0000-0000-0000-000000000352';

-- =====================================================
-- SECAO 2: a direcao NAO entra no WHERE
-- =====================================================
-- O conserto e o ROTULO, nao a lista: "o seu bonus entra em 20 dias" e um
-- aviso bom e tem que continuar saindo. Um `WHERE s.direction <> 'income'`
-- deixaria a secao 1 inteira vacuamente verde (NULL IS DISTINCT FROM 'income'
-- reprovaria, mas um `AND` mais esperto nao) -- esta contagem e o que fecha
-- essa porta.

SELECT pg_temp.expect(
  'as SEIS linhas pendentes continuam na view (a direcao nao filtra nada)',
  (SELECT count(*) FROM public.bill_alerts
    WHERE user_id = '5a000000-0000-0000-0000-000000000350'),
  6);

SELECT pg_temp.expect(
  'e as tres receitas estao entre elas',
  (SELECT count(*) FROM public.bill_alerts
    WHERE user_id = '5a000000-0000-0000-0000-000000000350'
      AND transaction_type = 'income'),
  3);

-- =====================================================
-- SECAO 3: o vencido continua vindo
-- =====================================================
-- A 050 troca o `FROM` por `scheduled_transactions_effective`, que expoe
-- `effective_status` -- e essa coluna vira 'overdue' sozinha quando a data
-- passa. Filtrar por ela em vez de `status` nao daria erro nenhum: apagaria da
-- view toda conta VENCIDA, em silencio, e o aviso que mais importa (`kind =
-- 'overdue'`) pararia de sair.

SELECT pg_temp.expect(
  'a receita vencida continua na view (o FROM novo nao filtrou pelo effective_status)',
  (SELECT count(*) FROM public.bill_alerts
    WHERE scheduled_transaction_id = '5d000000-0000-0000-0000-000000000356'),
  1);

SELECT pg_temp.expect_txt(
  'e ela vem como overdue, com a direcao certa',
  (SELECT kind || '/' || transaction_type::text FROM public.bill_alerts
    WHERE scheduled_transaction_id = '5d000000-0000-0000-0000-000000000356'),
  'overdue/income');

SELECT pg_temp.expect(
  'days_until da vencida e negativo (-4), que e o que vira "ha 4 dias" na frase',
  (SELECT days_until FROM public.bill_alerts
    WHERE scheduled_transaction_id = '5d000000-0000-0000-0000-000000000356'),
  -4);

-- Paga nao merece aviso, e cancelada nunca foi previsao de verdade. O recorte
-- `status = 'pending'` do 009 fica: sem esta assercao, um `FROM` novo sem
-- WHERE de status encheria o sino de contas ja pagas -- e a view da agenda, ao
-- contrario da tabela, nao tem recorte de status nenhum por dentro.
--
-- A baixa vai pelo caminho de verdade: `scheduled_transactions_paid_check`
-- (005) exige `paid_date` E `transaction_id` juntos quando o status e 'paid',
-- entao nao da para forjar a baixa com um UPDATE de uma coluna.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, account_id, category_id, description, amount, transaction_date, transaction_type)
SELECT '5e000000-0000-0000-0000-000000000353', '5a000000-0000-0000-0000-000000000350',
       s.id, '5b000000-0000-0000-0000-000000000350', c.id, 'Energia (prevista)', -70.00,
       CURRENT_DATE, 'expense'
  FROM public.transaction_categories c, public.financial_services s
 WHERE c.is_expense LIMIT 1;

UPDATE public.scheduled_transactions
   SET status = 'paid', paid_date = CURRENT_DATE,
       transaction_id = '5e000000-0000-0000-0000-000000000353'
 WHERE id = '5d000000-0000-0000-0000-000000000353';

SELECT pg_temp.expect(
  'conta PAGA sai da view (o recorte status = pending do 009 continua)',
  (SELECT count(*) FROM public.bill_alerts
    WHERE scheduled_transaction_id = '5d000000-0000-0000-0000-000000000353'),
  0);

UPDATE public.scheduled_transactions
   SET status = 'cancelled', paid_date = NULL, transaction_id = NULL
 WHERE id = '5d000000-0000-0000-0000-000000000353';

SELECT pg_temp.expect(
  'conta CANCELADA tambem sai da view',
  (SELECT count(*) FROM public.bill_alerts
    WHERE scheduled_transaction_id = '5d000000-0000-0000-0000-000000000353'),
  0);

UPDATE public.scheduled_transactions
   SET status = 'pending'
 WHERE id = '5d000000-0000-0000-0000-000000000353';

-- =====================================================
-- SECAO 4: o que a 047 colocou na view nao pode ter ido embora
-- =====================================================
-- `CREATE OR REPLACE VIEW` carrega a definicao INTEIRA: a 050 reescreveu as 13
-- colunas, e cada uma delas pode ter sido perdida no caminho sem erro nenhum.
-- Esta secao e a mesma vigilancia que a 045 montou sobre a 043, na direcao
-- 047 -> 050.

SELECT pg_temp.expect(
  'a view continua com 13 colunas, nos mesmos nomes e na mesma ordem',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bill_alerts'
      AND (ordinal_position, column_name) IN (
        (1,'scheduled_transaction_id'), (2,'user_id'), (3,'group_id'),
        (4,'account_id'), (5,'description'), (6,'amount'), (7,'due_date'),
        (8,'days_until'), (9,'kind'), (10,'days_before'),
        (11,'transaction_type'), (12,'already_notified'), (13,'notify_email')
      )),
  13);

-- O tipo e load-bearing: `transaction_type` tem que continuar sendo o ENUM. Se
-- ele virasse `text`, a 050 teria funcionado por acaso -- e `CREATE OR REPLACE`
-- recusaria mudanca de tipo, entao esta assercao e o que prova que `direction`
-- e o mesmo tipo que o `COALESCE` antigo produzia, e nao uma coincidencia de
-- valores.
SELECT pg_temp.expect_txt(
  'transaction_type continua sendo o enum transaction_financial_type',
  (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
    WHERE attrelid = 'public.bill_alerts'::regclass AND attname = 'transaction_type'),
  'transaction_financial_type');

-- Lido do CATALOGO, nao do arquivo: `CREATE OR REPLACE VIEW` APAGA os
-- reloptions (medido). Sem o `ALTER VIEW` de volta, a view roda como o DONO, a
-- RLS de `scheduled_transactions` deixa de valer, e o sino de cada pessoa
-- lista as contas a vencer de TODO MUNDO -- com numeros plausiveis e nenhum
-- erro.
SELECT pg_temp.expect(
  'bill_alerts tem security_invoker=true no catalogo depois da 050',
  (SELECT count(*) FROM pg_class
    WHERE oid = 'public.bill_alerts'::regclass
      AND reloptions @> ARRAY['security_invoker=true']),
  1);

-- E a view de onde a 050 passou a ler precisa da opcao TAMBEM: sem ela a RLS
-- do leitor nao atravessa o FROM novo, e a 050 teria aberto um furo que a 047
-- nao tinha. Duas views na cadeia, duas assercoes.
SELECT pg_temp.expect(
  'scheduled_transactions_effective tambem tem security_invoker (o FROM novo)',
  (SELECT count(*) FROM pg_class
    WHERE oid = 'public.scheduled_transactions_effective'::regclass
      AND reloptions @> ARRAY['security_invoker=true']),
  1);

-- A preferencia de canal da 047, pelo COALESCE: esta pessoa TEM linha em
-- notification_preferences e nunca disse nada sobre e-mail -> a coluna nasceu
-- `true` pelo DEFAULT. Se a 050 tivesse deixado a coluna cair, o
-- `information_schema` acima ja reprovaria; esta linha prova que ela tem o
-- VALOR certo, que e coisa diferente.
SELECT pg_temp.expect_bool(
  'notify_email da 047 sobreviveu a 050, com o valor certo',
  (SELECT notify_email FROM public.bill_alerts
    WHERE scheduled_transaction_id = '5d000000-0000-0000-0000-000000000351'),
  TRUE);

-- E o valor FALSO, que e o unico que distingue "a view le a preferencia" de "a
-- view devolve `true`". Sem este par, um `true AS notify_email` cru passaria
-- nas duas assercoes de cima e o canal de e-mail deixaria de ser desligavel.
UPDATE public.notification_preferences
   SET notify_email = FALSE
 WHERE user_id = '5a000000-0000-0000-0000-000000000350';

SELECT pg_temp.expect_bool(
  'quem DESLIGOU o e-mail e respeitado pela view (e nao apagado dela)',
  (SELECT notify_email FROM public.bill_alerts
    WHERE scheduled_transaction_id = '5d000000-0000-0000-0000-000000000351'),
  FALSE);

-- `notify_email` e preferencia de CANAL: a conta continua na view, porque e
-- dela que sai o sino do app -- o canal que a pessoa NAO desligou. Esta e a
-- SECAO 4 do teste da 047, repetida aqui porque a 050 recola o WHERE junto.
SELECT pg_temp.expect(
  'e a conta de quem desligou o e-mail CONTINUA na view (o sino nao e o e-mail)',
  (SELECT count(*) FROM public.bill_alerts
    WHERE scheduled_transaction_id = '5d000000-0000-0000-0000-000000000351'),
  1);

UPDATE public.notification_preferences
   SET notify_email = TRUE
 WHERE user_id = '5a000000-0000-0000-0000-000000000350';

-- `days_before` tem que devolver o que a pessoa ESCOLHEU, e nao o default. Sem
-- esta linha um `3 AS days_before` cru passaria na assercao do COALESCE mais
-- abaixo, e a tela de Avisos mostraria 3 para quem configurou 25.
SELECT pg_temp.expect(
  'days_before devolve os 25 que a pessoa escolheu, nao o default',
  (SELECT days_before FROM public.bill_alerts
    WHERE scheduled_transaction_id = '5d000000-0000-0000-0000-000000000351'),
  25);

-- E o COALESCE propriamente dito, exercitado pelo unico estado em que ele
-- aparece: SEM linha de preferencia. Tirar a linha reduz a janela ao default
-- de 3 dias, entao a conta usada aqui e a VENCIDA -- vencido nao depende de
-- `days_before`.
DELETE FROM public.notification_preferences
 WHERE user_id = '5a000000-0000-0000-0000-000000000350';

SELECT pg_temp.expect_bool(
  'quem nao tem linha de preferencia recebe e-mail (COALESCE da 047 intacto)',
  (SELECT notify_email FROM public.bill_alerts
    WHERE scheduled_transaction_id = '5d000000-0000-0000-0000-000000000356'),
  TRUE);

-- E o `days_before` volta a responder 3 pelo COALESCE -- o mesmo caminho, na
-- coluna do 009. Com a linha apagada, a janela encolhe e as previsoes de 11 a
-- 20 dias saem da view: sobra a vencida, sozinha. Isso prova que `days_before`
-- continua recortando de verdade, e nao que ele existe.
SELECT pg_temp.expect(
  'sem linha de preferencia a janela volta a 3 dias e sobra so a vencida',
  (SELECT count(*) FROM public.bill_alerts
    WHERE user_id = '5a000000-0000-0000-0000-000000000350'),
  1);

SELECT pg_temp.expect(
  'e days_before responde 3 pelo COALESCE',
  (SELECT days_before FROM public.bill_alerts
    WHERE scheduled_transaction_id = '5d000000-0000-0000-0000-000000000356'),
  3);

-- =====================================================
-- SECAO 5: a RLS atravessa o FROM novo -- e por QUAL flag
-- =====================================================
-- As duas assercoes de `reloptions` acima provam que a opcao ESTA nas views.
-- Elas nao provam que ela faz alguma coisa. Esta secao mede a RLS com dois
-- usuarios, e mede o controle NEGATIVO pelo lado certo -- que a 050 mudou.
--
-- O QUE MUDOU, MEDIDO (001 -> 050, dois usuarios sem grupo em comum):
--
--   bill_alerts invoker, effective invoker ..... 0 linhas do outro
--   bill_alerts DEFINER, effective invoker ..... 0   <-- NAO vaza mais
--   bill_alerts invoker, effective DEFINER ..... 1   <-- vaza
--
-- Antes da 050 a view lia a TABELA `scheduled_transactions`, e apagar a flag
-- DELA vazava -- e e isso que a SECAO 9 do `statements_alerts_test.sql` mede,
-- na posicao dela. Depois da 050 ela le `scheduled_transactions_effective`, e
-- `security_invoker=false` so troca o dono para as relacoes referenciadas
-- DIRETAMENTE: quem protege a linha passou a ser a flag da view DE BAIXO.
--
-- Escrever o controle negativo no `bill_alerts` aqui daria uma guarda VERDE
-- com o furo aberto -- a armadilha que a 046 pisou e anotou. Entao ele e
-- escrito onde o vazamento acontece de verdade.

-- A conta de outra pessoa, para haver o que vazar.
INSERT INTO auth.users (id, email) VALUES
  ('5a000000-0000-0000-0000-000000000351', 'hmo350-vizinho@teste.local');
INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('5a000000-0000-0000-0000-000000000351', 'Vizinho 350', FALSE);

-- Controle POSITIVO da RLS: o vizinho nao ve nada do dono.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '5a000000-0000-0000-0000-000000000351';

DO $$
DECLARE v BIGINT;
BEGIN
  SELECT count(*) INTO v FROM public.bill_alerts
   WHERE user_id = '5a000000-0000-0000-0000-000000000350';
  IF v <> 0 THEN
    RAISE EXCEPTION 'FALHA: o vizinho ve % vencimento(s) de outra pessoa pela bill_alerts', v;
  END IF;
  RAISE NOTICE 'ok: o vizinho nao ve os vencimentos de outra pessoa (0)';
END $$;

RESET ROLE;
RESET request.jwt.claim.sub;

-- CONTROLE NEGATIVO, na flag que importa depois da 050. Se isto NAO vazar, a
-- assercao de cima esta verde por outro motivo (fixture fora da janela, view
-- vazia, claim errado) e nao esta medindo RLS nenhuma.
ALTER VIEW public.scheduled_transactions_effective SET (security_invoker = false);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '5a000000-0000-0000-0000-000000000351';

DO $$
DECLARE v BIGINT;
BEGIN
  SELECT count(*) INTO v FROM public.bill_alerts
   WHERE user_id = '5a000000-0000-0000-0000-000000000350';
  IF v = 0 THEN
    RAISE EXCEPTION 'FALHA (controle negativo): com scheduled_transactions_effective como DEFINER o vizinho CONTINUOU sem ver nada. A assercao de RLS acima nao esta medindo a flag.';
  END IF;
  RAISE NOTICE 'ok: controle negativo da RLS (sem a flag de baixo vazariam % linhas)', v;
END $$;

RESET ROLE;
RESET request.jwt.claim.sub;

ALTER VIEW public.scheduled_transactions_effective SET (security_invoker = true);

-- E o outro lado da medicao, que e o achado desta issue e precisa ficar
-- escrito num lugar que roda: apagar a flag da PROPRIA `bill_alerts` NAO vaza
-- mais. Quem escrever o controle negativo ali no futuro tera uma guarda que
-- passa verde com o furo aberto -- esta assercao e o aviso, e ela falha no dia
-- em que alguem fizer a view tocar uma tabela com RLS direto de novo (que e
-- justamente quando o ALTER dela volta a ser load-bearing).
ALTER VIEW public.bill_alerts SET (security_invoker = false);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '5a000000-0000-0000-0000-000000000351';

DO $$
DECLARE v BIGINT;
BEGIN
  SELECT count(*) INTO v FROM public.bill_alerts
   WHERE user_id = '5a000000-0000-0000-0000-000000000350';
  IF v <> 0 THEN
    RAISE EXCEPTION 'FALHA: bill_alerts como DEFINER passou a vazar % linha(s) -- a view voltou a tocar relacao com RLS direto, e o controle negativo desta suite tem de mudar de lugar junto', v;
  END IF;
  RAISE NOTICE 'ok: bill_alerts como DEFINER nao vaza (quem protege e a flag da view de baixo)';
END $$;

RESET ROLE;
RESET request.jwt.claim.sub;

ALTER VIEW public.bill_alerts SET (security_invoker = true);

ROLLBACK;
