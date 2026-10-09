-- 048_trava_de_tipo_do_lancamento.sql
--
-- HMO-232: "Travar transaction_type no banco (NOT NULL), depois que o conserto
-- da HMO-181 estiver em producao."
--
-- ===========================================================================
-- ESTA E A SEGUNDA METADE DA 037, E A DEMORA FOI DE PROPOSITO
-- ===========================================================================
-- A 037 preencheu `financial_transactions.transaction_type` onde ele era nulo e
-- NAO pos trava nenhuma na coluna -- escrito no cabecalho dela, com o motivo:
-- migration aqui e colada a mao no SQL Editor ANTES de o codigo subir, e o
-- codigo que estava no ar naquele momento era justamente o que gravava NULL.
-- Um NOT NULL ali teria derrubado em 23502 todo lancamento feito pela tela
-- entre a colagem do SQL e o deploy.
--
-- Esse motivo venceu. O conserto das rotas (PR #139, `f8de98b`) esta na `main`
-- desde 2026-10-02, bem antes da 039, e deploy aqui leva CODIGO sem pedir
-- licenca -- o que fica para tras e schema, nunca o inverso. Entao o que esta
-- em producao hoje grava a coluna em todo caminho de escrita.
--
-- ATENCAO, PORQUE ESTA MIGRATION E A EXCECAO DA CASA: quase toda migration
-- deste repositorio e ADITIVA e por isso inofensiva de colar com a `main`
-- "velha" (coluna com default, view recriada -- o codigo em producao nem sabe
-- que existe). Esta nao. Ela e uma TRAVA, e trava colada antes do codigo
-- quebra o app no ar. Ela so pode ser colada porque o codigo JA chegou, e nao
-- apesar disso.
--
-- ===========================================================================
-- A AUDITORIA DOS ESCRITORES, REFEITA NA `main` DE 2026-10-08
-- ===========================================================================
-- A HMO-232 nasceu com uma tabela de nove escritores, levantada em 02/10. De
-- entao para ca a arvore andou da 039 para a 047 e apareceram TRES caminhos de
-- escrita novos, nenhum deles na lista original. A tabela abaixo e a nova, e
-- ela e o que autoriza a trava -- a de outubro/02 sozinha nao autorizava mais:
--
--   escritor                                            grava o tipo
--   --------------------------------------------------- -----------------------
--   POST   /api/personal-finance/transactions           sim  (`tipo`, HMO-181)
--   PATCH  /api/personal-finance/transactions/[id]      sim  (regrava SEMPRE)
--   POST   /api/movimentacoes/transferencia             sim  ('transfer', as 2)
--   POST   /api/scheduled-transactions/[id]/pay         sim  (as duas pernas)
--   POST   /api/statements/entries/[id]                 sim  (`tipoPeloSinal`)
--   POST   /api/financial-installments                  sim  ('expense')
--   POST   /api/expense-groups/[groupId]/transactions   sim  ('expense')
--   POST   /api/card-invoices/ajuste                    sim  <- NOVO (HMO-292)
--   POST   /api/expense-groups/[groupId]/settlements    sim  <- NOVO (HMO-245)
--   POST   .../settlements/[id]/perna                   sim  <- NOVO (HMO-306)
--   public.register_payroll (012)                       sim  ('income')
--   public.pay_installment (001)                        sim
--
-- As duas funcoes do banco foram conferidas no CATALOGO e nao no arquivo da
-- migration (`pg_proc.prosrc`, buscando `INSERT INTO ... financial_
-- transactions`): sao as duas UNICAS funcoes de `public` que inserem nesta
-- tabela, e as duas listam a coluna. O rateio de grupo nao aparece aqui porque
-- ele nao insere em `financial_transactions` -- ele escreve em
-- `group_transactions` / `expense_splits`.
--
-- O PATCH merece uma linha propria, porque e o unico que poderia gravar NULL
-- sem um INSERT novo. Ele nao pode: `updateData.transaction_type` sai de
-- `normalizarLancamento`, que ou devolve `ok: false` (e a rota responde 400) ou
-- devolve `tipo` vindo de `classificarMovimentacao`, cujo retorno e
-- `'income' | 'expense' | 'transfer'` -- nunca nulo, nem no caminho em que o
-- usuario troca a categoria e o tipo e re-derivado.
--
-- ===========================================================================
-- POR QUE NOT NULL, E NAO CHECK
-- ===========================================================================
-- A pergunta estava aberta no escopo da issue, e ela tem uma resposta so:
-- **CHECK aceita NULL**. `CHECK (transaction_type IN ('income','expense',
-- 'transfer'))` parece a trava e nao e nenhuma: para a linha sem tipo o
-- predicado vale NULL, que nao e FALSE, e o Postgres ACEITA a linha. Seria uma
-- trava que passa em toda revisao de codigo, aparece no `\d+` da tabela, e deixa
-- entrar exatamente a unica linha que ela existia para barrar.
--
-- O ENUM `transaction_financial_type` ja barra valor inventado desde o 001 --
-- 'expence' volta 22P02 --, entao nao sobra nada para um CHECK fazer aqui
-- alem do que o NOT NULL faz. A trava real mora no NOT NULL, e o SQLSTATE que
-- o teste desta migration exige e o dele: **23502**.
--
-- (Um `CHECK (transaction_type IS NOT NULL)` barraria o NULL de verdade, com
-- 23514. Ficaria certo e seria pior: `is_nullable` continuaria 'YES' no
-- catalogo, e todo mundo que olhasse a coluna -- `\d`, o Supabase Studio, o
-- gerador de tipos, `scripts/gen-schema-columns.mjs` -- continuaria lendo
-- "aceita nulo". Dois desses dois mutantes estao em
-- `scripts/mutantes-trava-de-tipo.mjs` justamente porque os dois sao
-- plausiveis e os dois sao errados.)
--
-- ===========================================================================
-- O QUE ESTA TRAVA NAO RESOLVE
-- ===========================================================================
-- O SEGUNDO estrago da HMO-181 continua de pe: despesa gravada com o sinal
-- POSITIVO. Nao ha CHECK nem NOT NULL possivel ali, porque uma linha positiva
-- em categoria de despesa e indistinguivel de um ESTORNO legitimo -- e o
-- estorno e um lancamento que o usuario tem direito de fazer. Quem guarda esse
-- lado sao os 13 mutantes de `npm run mutantes:tipo-e-sinal`, e eles continuam
-- sendo a unica guarda dele depois desta migration.
--
-- ===========================================================================
-- CONFERENCIA EM PRODUCAO, PARA RODAR ANTES DE COLAR
-- ===========================================================================
-- COM O DENOMINADOR JUNTO, e nao so o numerador. "Quantas linhas estao sem
-- tipo?" sozinha responde 0 tanto quando esta tudo certo quanto quando a sessao
-- nao enxerga a tabela -- `financial_transactions` tem RLS, e a credencial
-- `paperclip_ro` le ZERO LINHA dela. A conferencia passa VAZIA, parecendo a
-- resposta boa. Quem roda isto e o Helio, no SQL Editor:
--
--   SELECT count(*) AS total,
--          count(*) FILTER (WHERE transaction_type IS NULL) AS sem_tipo
--     FROM public.financial_transactions;
--
-- `sem_tipo` = 0 com `total` > 0 e o retrato esperado (a 037 ja rodou).
--
-- Se `sem_tipo` > 0, colar esta migration NAO estoura: o passo 1 abaixo chama o
-- backfill da 037 de novo e a trava do passo 2 encontra a coluna cheia. Mas o
-- NUMERO precisa chegar de volta na issue, porque com toda rota gravando a
-- coluna um `sem_tipo` > 0 so pode ser (a) linha anterior ao PR #139 que a 037
-- nunca alcancou -- ou seja, a 037 nao foi colada --, ou (b) um escritor que a
-- auditoria acima nao achou. O (b) e o caso em que a trava vai comecar a
-- devolver 23502 para gente de verdade, e ai o conserto e no escritor.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. O backfill da 037, de novo, para a trava nao poder falhar na colagem
-- ---------------------------------------------------------------------------
-- Nao e desconfianca da 037: e que SET NOT NULL varre a tabela inteira e aborta
-- a migration se achar UMA linha nula, e o unico lugar do mundo onde isso pode
-- acontecer e o banco do Helio -- onde ninguem pode medir antes por causa da
-- RLS (ver a CONFERENCIA acima). A funcao e idempotente pelo
-- `WHERE transaction_type IS NULL` de dentro dela, entao no caso esperado este
-- passo e um no-op que custa um scan.
--
-- A funcao e a MESMA da 037 -- `public.backfill_tipo_do_lancamento()`, deixada
-- no banco por aquela migration como ferramenta de reparo, com os tres degraus
-- (perna de transferencia pelos DOIS lados do elo, depois
-- `transaction_categories.is_expense`, depois o sinal). Nao ha copia da regra
-- aqui, e por isso nao ha como as duas divergirem.
--
-- O NOTICE existe para a colagem A MAO: "rodou sem erro" e indistinguivel de
-- "nao tinha o que fazer", e aqui a diferenca entre os dois e justamente o
-- diagnostico que a issue pede.
DO $$
DECLARE
  v_linhas integer;
BEGIN
  v_linhas := public.backfill_tipo_do_lancamento();

  IF v_linhas = 0 THEN
    RAISE NOTICE '048: nenhuma linha sem transaction_type -- era o esperado, a trava vai entrar sobre a coluna ja limpa.';
  ELSE
    RAISE NOTICE '048: ATENCAO -- % linha(s) ainda estavam sem transaction_type e acabaram de ser preenchidas. A trava vai entrar, mas ESTE NUMERO PRECISA VOLTAR PARA A HMO-232: com todas as rotas gravando a coluna, ele significa que a 037 nao foi colada OU que existe um escritor fora da auditoria -- e nesse segundo caso a trava vai passar a devolver 23502 para o usuario.', v_linhas;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. A trava
-- ---------------------------------------------------------------------------
-- Re-executavel: SET NOT NULL numa coluna que ja e NOT NULL e um no-op no
-- Postgres (nao e erro, nao reescreve a tabela). E o que faz o passo "048 e
-- idempotente" do db-verify passar sem nenhum `IF NOT EXISTS` em volta.
ALTER TABLE public.financial_transactions
  ALTER COLUMN transaction_type SET NOT NULL;

COMMENT ON COLUMN public.financial_transactions.transaction_type IS
  'income | expense | transfer. NOT NULL desde a 048 (HMO-232), e a trava mora aqui e nao num CHECK porque CHECK aceita NULL. Antes dela a linha sem tipo ficava fora de monthly_cash_flow, category_monthly_totals e planned_vs_actual e continuava aparecendo na lista de lancamentos -- aparecia como lancamento e desaparecia do fluxo de caixa, dos relatorios e do orcamento (HMO-181). O sinal de `amount` NAO e derivado desta coluna pelo banco: despesa positiva continua sendo um valor aceito, porque e indistinguivel de estorno legitimo, e quem guarda esse lado sao os mutantes de npm run mutantes:tipo-e-sinal.';

COMMIT;

-- ===========================================================================
-- DEPOIS DE COLAR, EM PRODUCAO
-- ===========================================================================
--   SELECT is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name   = 'financial_transactions'
--      AND column_name  = 'transaction_type';
--
-- Tem de sair 'NO'. Esta consulta funciona pela credencial RO: ela le o
-- catalogo, nao a tabela, e catalogo nao tem RLS -- diferente da conferencia de
-- `sem_tipo` ali em cima, que precisa do Helio.
