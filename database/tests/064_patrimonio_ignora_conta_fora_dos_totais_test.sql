-- =====================================================
-- 064: o patrimonio mes a mes ignora a conta fora dos totais (HMO-441)
-- =====================================================
-- Roda DEPOIS de `064_contas_antes_da_064.sql` (que comita a fixture) e DEPOIS
-- da `064_patrimonio_ignora_conta_fora_dos_totais.sql`.
--
-- O QUE CADA SECAO EXISTE PARA PEGAR
-- ----------------------------------
--   (1) A DEPENDENCIA DA 058 esta no banco, com a POLARIDADE certa (`NOT NULL
--       DEFAULT true`). Sem isto todo o resto mede o proprio engano: uma coluna
--       anulavel faria `FILTER (WHERE a.include_in_total)` descartar NULL, e o
--       patrimonio de quem nunca tocou a configuracao iria a zero;
--   (2) A FIXTURE EXISTE E O TRIGGER ANDOU. `current_balance` e produzido pelo
--       `update_account_balance_trigger`, nao escrito a mao. Esta secao e o que
--       separa "a view esta certa" de "nao havia dinheiro nenhum para a view
--       errar" -- as secoes 3 a 8 ficariam verdes num banco vazio com o filtro
--       APAGADO;
--   (3) O `saldo_hoje` HONRA O FLAG, e a assercao e a propria frase da issue: o
--       ULTIMO PONTO DA SERIE E IGUAL AO CONSOLIDADO. O consolidado nao esta
--       cravado -- ele e RECALCULADO aqui da mesma forma que `/api/net-worth` o
--       calcula, e as duas leituras tem de dar o mesmo numero. E o unico
--       formato de assercao que mede "as duas telas concordam" em vez de medir
--       dois numeros escritos por mim;
--   (4) O `movimento` HONRA O FLAG, mes a mes, com o numero de hoje REFUTADO
--       explicitamente;
--   (5) O LANCAMENTO fora dos totais CONTINUA CONTANDO -- a ressalva 1 do
--       cabecalho da 060, re-medida DEPOIS desta recolagem. Esta e a secao que
--       reprova o "conserto" zeloso, e ela e tao importante quanto a 3: as duas
--       colunas se chamam `include_in_total` e quem le rapido acha que a 064
--       esqueceu a outra;
--   (6) A CHAVE DO MES SOBREVIVE. Julho so tem movimentacao na conta desligada
--       e tem de aparecer com `net_change = 0`. E esta secao -- e so ela -- que
--       mata a implementacao com `WHERE a.include_in_total` (e a com
--       `NOT IN (desligadas)`): as duas dao os mesmos numeros das secoes 3 a 5
--       e fazem julho DESAPARECER do grafico;
--   (7) O LANCAMENTO SEM CONTA continua fora. Agosto so tem lancamento de
--       `account_id IS NULL` e NAO pode ter linha. Mede o
--       `WHERE t.account_id IS NOT NULL` da 008, que a recolagem tinha de
--       preservar;
--   (8) O USUARIO DE CONTAS TODAS DESLIGADAS tem SERIE DE ZEROS, nao serie
--       nenhuma. Separa `FILTER` de `WHERE` no `saldo_hoje`: com `WHERE` a tela
--       dele fica VAZIA, e tela vazia se le como "o sistema nao sabe";
--   (9) `security_invoker` ESTA LIGADA, COM CONTROLE POSITIVO. `CREATE OR
--       REPLACE VIEW` apaga as reloptions, e sem o ALTER a view vira DEFINER e
--       devolve o patrimonio de TODOS os usuarios. Num banco de teste a falha
--       nao muda numero nenhum -- por isso a medida e no catalogo;
--  (10) A ACL sobreviveu: `anon` sem privilegio, `authenticated` com SELECT;
--  (11) O COMMENT nomeia AS DUAS politicas. E a sonda de colagem em prod, e um
--       COMMENT que nao diga qual das duas colunas a view honra manda o proximo
--       leitor medir no corpo da view.
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
    RAISE EXCEPTION 'FALHA: % -> esperado "%", obtido "%"', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.refute_num(label TEXT, got NUMERIC, forbidden NUMERIC, porque TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got = forbidden THEN
    RAISE EXCEPTION 'FALHA: % -> obtido justamente o numero proibido % (%)', label, forbidden, porque;
  END IF;
  RAISE NOTICE 'ok: % nao e % (%)', label, forbidden, porque;
END $$;

-- =====================================================
-- 1. A dependencia da 058, com a polaridade medida
-- =====================================================
SELECT pg_temp.expect_txt('financial_accounts.include_in_total existe (058)',
  (SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'financial_accounts'
      AND column_name = 'include_in_total'),
  'boolean');

-- NOT NULL e o que torna `FILTER (WHERE a.include_in_total)` seguro: com a
-- coluna anulavel, a conta de quem nunca abriu a configuracao sairia do
-- patrimonio (`coluna-booleana-anulavel-not-is-false`).
SELECT pg_temp.expect_txt('include_in_total e NOT NULL',
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'financial_accounts'
      AND column_name = 'include_in_total'),
  'NO');

-- DEFAULT true e a POLARIDADE: a coluna e positiva ("entra nos totais"), e a
-- conta que ninguem configurou entra. Um `DEFAULT false` inverteria o
-- patrimonio de todo mundo sem mudar uma linha desta view.
SELECT pg_temp.expect_txt('include_in_total tem DEFAULT true',
  (SELECT column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'financial_accounts'
      AND column_name = 'include_in_total'),
  'true');

-- =====================================================
-- 2. A fixture existe e o TRIGGER produziu os saldos
-- =====================================================
-- Se esta secao reprovar, NADA abaixo dela significa coisa alguma: o resto da
-- suite estaria medindo um banco sem dinheiro do lado desligado, onde o filtro
-- apagado tambem passa.
SELECT pg_temp.expect_num('saldo da conta que SOMA (trigger: 1000 + 50 + 200)',
  (SELECT current_balance FROM public.financial_accounts
    WHERE id = 'f0640000-0000-0000-0000-000000000001'),
  1250.00);

SELECT pg_temp.expect_num('saldo da conta FORA dos totais (trigger: 7000 + 300 + 400)',
  (SELECT current_balance FROM public.financial_accounts
    WHERE id = 'f0640000-0000-0000-0000-000000000002'),
  7700.00);

SELECT pg_temp.expect('a conta FORA dos totais esta mesmo desligada',
  (SELECT count(*) FROM public.financial_accounts
    WHERE id = 'f0640000-0000-0000-0000-000000000002'
      AND include_in_total = FALSE),
  1);

-- =====================================================
-- 3. O ULTIMO PONTO DA SERIE = O CONSOLIDADO. A frase da issue.
-- =====================================================
-- O consolidado NAO esta cravado aqui: ele e recalculado como `/api/net-worth`
-- o calcula (soma de `current_balance` das contas que somam). Cravar os dois
-- lados seria eu conferindo a minha propria aritmetica
-- (`conferidor-com-o-mesmo-extrator-nos-dois-lados-passa-vacuo`); recalcular o
-- outro lado mede o que a tela mede -- as duas leituras concordando.
SELECT pg_temp.expect_num(
  'o ultimo ponto da serie e IGUAL ao consolidado das contas que somam',
  (SELECT net_worth FROM public.net_worth_history
    WHERE user_id = 'a0640000-0000-0000-0000-000000000099'
    ORDER BY month DESC LIMIT 1),
  (SELECT COALESCE(SUM(current_balance), 0)::numeric(15,2)
     FROM public.financial_accounts
    WHERE user_id = 'a0640000-0000-0000-0000-000000000099'
      AND include_in_total));

-- E o numero de HOJE, recusado pelo nome. 8.950,00 = 1.250,00 + 7.700,00: o
-- consolidado mais o saldo inteiro da conta desligada. E literalmente o que o
-- grafico de producao desenha hoje ao lado de um numero grande que diz
-- 1.250,00.
SELECT pg_temp.refute_num('o ultimo ponto nao e mais o total COM a conta desligada',
  (SELECT net_worth FROM public.net_worth_history
    WHERE user_id = 'a0640000-0000-0000-0000-000000000099'
    ORDER BY month DESC LIMIT 1),
  8950.00,
  'e o patrimonio somando a conta fora dos totais -- o defeito da HMO-441');

SELECT pg_temp.expect_num('e o valor dele, cravado',
  (SELECT net_worth FROM public.net_worth_history
    WHERE user_id = 'a0640000-0000-0000-0000-000000000099'
    ORDER BY month DESC LIMIT 1),
  1250.00);

-- =====================================================
-- 4. O `movimento` honra o flag, mes a mes
-- =====================================================
-- MAIO: 1.000,00 (conta que soma) + 50,00 (idem, lancamento desmarcado) =
-- 1.050,00. Os 7.000,00 do aporte na conta desligada ficam fora.
SELECT pg_temp.expect_num('net_change de maio ignora o aporte da conta desligada',
  (SELECT net_change FROM public.net_worth_history
    WHERE user_id = 'a0640000-0000-0000-0000-000000000099'
      AND month = '2026-05-01'),
  1050.00);

SELECT pg_temp.refute_num('net_change de maio nao soma os 7.000 da conta desligada',
  (SELECT net_change FROM public.net_worth_history
    WHERE user_id = 'a0640000-0000-0000-0000-000000000099'
      AND month = '2026-05-01'),
  8050.00,
  'e maio com a conta desligada dentro');

-- JUNHO: 200,00 da conta que soma; os 300,00 da desligada ficam fora.
SELECT pg_temp.expect_num('net_change de junho ignora a conta desligada',
  (SELECT net_change FROM public.net_worth_history
    WHERE user_id = 'a0640000-0000-0000-0000-000000000099'
      AND month = '2026-06-01'),
  200.00);

-- O NIVEL de cada mes, e nao so a variacao: a janela sem `ORDER BY` da 008 e a
-- parte do calculo que uma recolagem erra calado. Maio = 1.250,00 - 200,00.
SELECT pg_temp.expect_num('net_worth de maio (o nivel, nao a variacao)',
  (SELECT net_worth FROM public.net_worth_history
    WHERE user_id = 'a0640000-0000-0000-0000-000000000099'
      AND month = '2026-05-01'),
  1050.00);

SELECT pg_temp.expect_num('net_worth de junho',
  (SELECT net_worth FROM public.net_worth_history
    WHERE user_id = 'a0640000-0000-0000-0000-000000000099'
      AND month = '2026-06-01'),
  1250.00);

-- =====================================================
-- 5. O LANCAMENTO fora dos totais CONTINUA contando (ressalva da 060)
-- =====================================================
-- A 060 escreveu isto por extenso: `financial_transactions.include_in_total` e
-- de RELATORIO, nao de SALDO. O dinheiro do ajuste entrou mesmo na conta, o
-- `update_account_balance_trigger` ja mexeu no `current_balance`, e tirar a
-- linha do patrimonio faria a tela de Contas discordar do patrimonio.
--
-- Os 50,00 de 13/05 estao com `include_in_total = FALSE` NO LANCAMENTO e dentro
-- de uma conta que SOMA. Se alguem "consertar" a omissao, maio vira 1.000,00 e
-- esta secao reprova -- que e o ponto. A secao 5 do
-- `060_lancamento_fora_dos_totais_test.sql` guarda a mesma propriedade na
-- posicao DELA; esta guarda na posicao de DEPOIS da recolagem da 064, que e a
-- unica em que "a 064 atropelou a 060" e observavel.
SELECT pg_temp.refute_num('o patrimonio NAO filtra o lancamento desmarcado',
  (SELECT net_change FROM public.net_worth_history
    WHERE user_id = 'a0640000-0000-0000-0000-000000000099'
      AND month = '2026-05-01'),
  1000.00,
  'e maio SEM os 50,00 do ajuste -- o flag do LANCAMENTO e de relatorio, e o patrimonio e saldo');

-- O controle positivo da secao: o lancamento esta mesmo desmarcado. Sem isto o
-- `refute` acima passaria vacuo num banco onde a 060 nunca marcou nada.
SELECT pg_temp.expect('o lancamento de 13/05 esta mesmo fora dos totais',
  (SELECT count(*) FROM public.financial_transactions
    WHERE id = '64640000-0000-0000-0000-000000000002'
      AND include_in_total = FALSE),
  1);

-- =====================================================
-- 6. A CHAVE DO MES SOBREVIVE -- julho existe, com ZERO
-- =====================================================
-- Julho so tem movimentacao na conta desligada. O mes tem de APARECER, com
-- `net_change = 0`: um mes que sai do meio do grafico deixa um buraco no eixo
-- que ninguem pediu, e mudar o conjunto de meses que o relatorio enumera e
-- outra mudanca, com outro risco (a mesma escolha que a 060 fez no CTE `chaves`
-- de `planned_vs_actual`).
--
-- E ESTA E A SECAO QUE MATA AS DUAS IMPLEMENTACOES ERRADAS: `WHERE
-- a.include_in_total` no corpo do CTE e `NOT IN (desligadas)` dao exatamente os
-- mesmos numeros das secoes 3, 4 e 5 -- e as duas fazem julho desaparecer.
SELECT pg_temp.expect('julho continua na serie (a chave nao se perde)',
  (SELECT count(*) FROM public.net_worth_history
    WHERE user_id = 'a0640000-0000-0000-0000-000000000099'
      AND month = '2026-07-01'),
  1);

SELECT pg_temp.expect_num('julho veio com net_change ZERO, e nao com os 400 da conta desligada',
  (SELECT net_change FROM public.net_worth_history
    WHERE user_id = 'a0640000-0000-0000-0000-000000000099'
      AND month = '2026-07-01'),
  0.00);

-- E o nivel de julho e o consolidado: nada que conte se moveu depois de junho.
SELECT pg_temp.expect_num('o nivel de julho e o mesmo de junho',
  (SELECT net_worth FROM public.net_worth_history
    WHERE user_id = 'a0640000-0000-0000-0000-000000000099'
      AND month = '2026-07-01'),
  1250.00);

-- =====================================================
-- 7. O lancamento SEM CONTA continua fora -- agosto nao existe
-- =====================================================
-- Agosto so tem o lancamento de `account_id IS NULL`, que nunca entrou nesta
-- soma (sem conta, o trigger nao mexe em saldo nenhum -- razao escrita na 008)
-- e continua fora. A assercao e pela AUSENCIA da linha, que e o que distingue a
-- recolagem fiel de uma que tenha mexido no `WHERE t.account_id IS NOT NULL`
-- ao acrescentar o `LEFT JOIN`.
SELECT pg_temp.expect('agosto NAO tem linha (lancamento sem conta nao cria mes)',
  (SELECT count(*) FROM public.net_worth_history
    WHERE user_id = 'a0640000-0000-0000-0000-000000000099'
      AND month = '2026-08-01'),
  0);

-- E a serie tem exatamente TRES meses: maio, junho, julho. Fecha o conjunto,
-- para que nem um mes a mais nem um a menos passe calado.
SELECT pg_temp.expect('a serie tem exatamente 3 meses',
  (SELECT count(*) FROM public.net_worth_history
    WHERE user_id = 'a0640000-0000-0000-0000-000000000099'),
  3);

-- =====================================================
-- 8. Contas TODAS desligadas -> serie de ZEROS, nao serie nenhuma
-- =====================================================
-- O usuario ...0098 tem uma conta so, e ela e desligada. Com `WHERE
-- a.include_in_total` no `saldo_hoje` ele sairia do CTE, o `JOIN` final mataria
-- a serie dele e a tela ficaria VAZIA -- que se le como "o sistema nao sabe". O
-- sistema sabe: e zero.
SELECT pg_temp.expect('o usuario de contas todas desligadas AINDA tem serie',
  (SELECT count(*) FROM public.net_worth_history
    WHERE user_id = 'a0640000-0000-0000-0000-000000000098'),
  1);

SELECT pg_temp.expect_num('e o patrimonio dele e ZERO',
  (SELECT net_worth FROM public.net_worth_history
    WHERE user_id = 'a0640000-0000-0000-0000-000000000098'),
  0.00);

SELECT pg_temp.refute_num('nao e os 900 da conta desligada',
  (SELECT net_worth FROM public.net_worth_history
    WHERE user_id = 'a0640000-0000-0000-0000-000000000098'),
  900.00,
  'e o saldo da unica conta, que esta fora dos totais');

SELECT pg_temp.expect_num('e a variacao do mes dele tambem e ZERO',
  (SELECT net_change FROM public.net_worth_history
    WHERE user_id = 'a0640000-0000-0000-0000-000000000098'),
  0.00);

-- =====================================================
-- 9. `security_invoker` esta ligada, com controle positivo
-- =====================================================
-- A medida e no CATALOGO porque a falha nao muda numero nenhum num banco de um
-- usuario so: a view vira DEFINER e passa a devolver o patrimonio de todos.
SELECT pg_temp.expect('net_worth_history tem security_invoker = true',
  (SELECT count(*) FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'net_worth_history'
      AND c.reloptions @> ARRAY['security_invoker=true']),
  1);

-- CONTROLE POSITIVO da sonda acima: ela sabe ler `reloptions` de uma view que
-- NAO tem a opcao. Sem isto, uma sonda que devolvesse 0 para tudo (nome de
-- relacao errado, por exemplo) ficaria verde no dia em que a opcao sumisse.
SELECT pg_temp.expect('a sonda de reloptions sabe dizer NAO (controle positivo)',
  (SELECT count(*) FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'net_worth_history'
      AND c.reloptions @> ARRAY['security_invoker=false']),
  0);

-- =====================================================
-- 10. A ACL sobreviveu a recolagem
-- =====================================================
-- `anon` e a chave que vai no bundle JS publico, e esta view e o patrimonio da
-- pessoa.
SELECT pg_temp.expect('anon nao tem privilegio nenhum em net_worth_history',
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'net_worth_history'
      AND grantee = 'anon'),
  0);

SELECT pg_temp.expect('authenticated continua com SELECT',
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'net_worth_history'
      AND grantee = 'authenticated' AND privilege_type = 'SELECT'),
  1);

-- =====================================================
-- 11. O COMMENT, a sonda de colagem, nomeia AS DUAS politicas
-- =====================================================
-- Um COMMENT que diga "ignora include_in_total" sem dizer QUAL das duas colunas
-- manda o proximo leitor medir no corpo da view -- e e justamente a confusao
-- que esta migration existe para desfazer.
SELECT pg_temp.expect('o COMMENT diz que a CONTA desligada sai',
  (SELECT count(*) FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'net_worth_history'
      AND obj_description(c.oid, 'pg_class') LIKE '%financial_accounts.include_in_total%'),
  1);

SELECT pg_temp.expect('o COMMENT diz que o LANCAMENTO desmarcado FICA',
  (SELECT count(*) FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'net_worth_history'
      AND obj_description(c.oid, 'pg_class') LIKE '%financial_transactions.include_in_total%'),
  1);

ROLLBACK;
