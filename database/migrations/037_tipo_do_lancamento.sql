-- 037_tipo_do_lancamento.sql
--
-- HMO-181: "POST /api/personal-finance/transactions grava despesa POSITIVA e
-- sem transaction_type (a linha desaparece das views)."
--
-- ===========================================================================
-- O QUE ESTA MIGRATION CONSERTA, E O QUE ELA DE PROPOSITO NAO FAZ
-- ===========================================================================
-- O POST de /api/personal-finance/transactions nunca listou `transaction_type`
-- no INSERT. Toda linha criada por ele -- e e a rota do botao "Novo
-- lancamento" -- nasceu com a coluna NULA.
--
-- Isso nao e cosmetico. As tres views da 008 filtram:
--
--     WHERE t.transaction_type IN ('expense', 'income')
--
--   monthly_cash_flow        o fluxo de caixa do mes
--   category_monthly_totals  o relatorio por categoria
--   planned_vs_actual        previsto x realizado (o orcamento)
--
-- Uma linha sem tipo fica FORA das tres. Ela continua aparecendo na lista de
-- lancamentos -- `classificarMovimentacao` em lib/movimentacoes.ts cai para
-- `category.is_expense` e ate acerta o rotulo -- e desaparece do fluxo de
-- caixa, dos relatorios e do orcamento. Sem erro, sem aviso, e com a lista
-- provando que o lancamento existe. O defeito foi achado em 2026-09-29
-- sondando a rota de export em producao: o CSV trouxe a coluna Tipo vazia.
--
-- O conserto da ROTA vai em codigo (o INSERT passou a gravar a coluna, e o
-- sinal passou a sair do tipo em vez de o tipo sair do sinal). Esta migration
-- cuida do que ja esta gravado: as linhas que nasceram sem tipo continuam
-- invisiveis nas tres views enquanto ninguem as preencher.
--
-- O QUE ELA NAO FAZ, E POR QUE
-- ----------------------------
-- Nao poe `NOT NULL` nem CHECK em `transaction_type`. Esta migration e
-- aplicada A MAO, no SQL Editor, ANTES de o codigo novo chegar a producao --
-- e o codigo que esta no ar neste momento e justamente o que grava NULL. Uma
-- trava aqui derrubaria em 23502/23514 todo lancamento criado pela tela, entre
-- a colagem do SQL e o deploy. A trava e uma migration POSTERIOR, depois de o
-- codigo estar no ar; ate la quem guarda a coluna sao os 13 mutantes de
-- `npm run mutantes:tipo-e-sinal`.
--
-- Esta migration e, portanto, ADITIVA e inofensiva para o codigo velho: ela
-- so preenche coluna que estava nula. Aplicar com a `main` "velha" nao quebra
-- nada.
--
-- ===========================================================================
-- COMO O TIPO E DEDUZIDO, EM TRES DEGRAUS
-- ===========================================================================
-- 1. PERNA DE TRANSFERENCIA, PRIMEIRO DE TODOS. Uma transferencia e gravada em
--    DUAS pernas que se anulam (015), ligadas por `counterpart_transaction_id`
--    -- e o elo e de UMA VIA so: quem grava a coluna e a perna de ENTRADA.
--    Por isso o degrau olha os dois lados do elo. Classificar uma perna como
--    despesa ou receita e o erro caro deste backfill: as duas entrariam na
--    conta do mes e o pagamento de uma fatura de R$ 1.000 somaria R$ 1.000 em
--    Receitas E R$ 1.000 em Despesas -- com o SALDO continuando certo, porque
--    as duas se anulam. Nao haveria erro para ninguem procurar, so um mes que
--    pareceria mais movimentado do que foi (e a HMO-162 ja pagou para aprender
--    isso uma vez).
--
--    Na pratica toda perna gravada por /api/movimentacoes/transferencia ja tem
--    `transaction_type = 'transfer'` e nao chega aqui. O degrau existe para a
--    linha anterior aquela rota, e por ser o unico erro deste backfill que nao
--    teria sintoma.
--
-- 2. A CATEGORIA. `transaction_categories.is_expense` e o criterio que a tela
--    usa hoje para rotular a linha sem tipo. Deduzir por ela e o que faz o
--    backfill CONCORDAR com o que o usuario ja viu na lista: um backfill que
--    rotulasse diferente mudaria o passado dele na tela.
--
-- 3. O SINAL, so no fim. Linha sem categoria (a categoria pode ter sido
--    apagada) nao tem criterio melhor. Ele erra no estorno -- que chega
--    positivo e e de categoria de despesa --, e por isso vem depois da
--    categoria, nao antes.
--
-- Nenhum degrau devolve NULL: o pior resultado possivel aqui e deixar a linha
-- como estava, porque "deixei como estava" e indistinguivel de "nao rodei".
--
-- ===========================================================================
-- POR QUE O BACKFILL E UMA FUNCAO, E NAO UM UPDATE SOLTO
-- ===========================================================================
-- Um UPDATE escrito direto aqui nao tem como ser testado: o db-verify constroi
-- o banco DO ZERO e aplica as migrations em ordem, entao quando a 037 roda nao
-- existe nenhuma linha antiga para ela preencher. O teste passaria verde sobre
-- zero linhas -- que e exatamente a forma de verificacao vazia que ja mordeu
-- este repositorio antes.
--
-- Com a regra dentro de uma funcao, o teste da 037 planta as linhas ruins,
-- chama a MESMA funcao que a migration chama, e confere o resultado. Nao ha
-- copia da regra no teste.
--
-- A funcao tambem fica no banco como ferramenta de reparo: se outro caminho de
-- escrita voltar a gravar NULL, `SELECT public.backfill_tipo_do_lancamento();`
-- devolve quantas linhas consertou.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. A regra, como funcao
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER (o padrao): ela e chamada por quem aplica a migration e pelo
-- teste, os dois como dono do banco. Nao ha caminho do app ate aqui, e o
-- REVOKE abaixo garante que nao passe a haver por descuido -- uma funcao que
-- reescreve `transaction_type` em massa, exposta a `authenticated`, seria
-- limitada pela RLS da tabela mas ainda assim daria a qualquer portador de
-- sessao um botao de "reclassifique meus lancamentos todos".
CREATE OR REPLACE FUNCTION public.backfill_tipo_do_lancamento()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_linhas integer;
BEGIN
  UPDATE public.financial_transactions t
     SET transaction_type = (
           CASE
             -- Degrau 1: perna de transferencia, pelos DOIS lados do elo.
             WHEN t.counterpart_transaction_id IS NOT NULL
               OR EXISTS (
                    SELECT 1
                      FROM public.financial_transactions o
                     WHERE o.counterpart_transaction_id = t.id
                  )
               THEN 'transfer'
             -- Degrau 2: a categoria, que e o que a tela ja mostra.
             WHEN (SELECT c.is_expense
                     FROM public.transaction_categories c
                    WHERE c.id = t.category_id) IS TRUE
               THEN 'expense'
             WHEN (SELECT c.is_expense
                     FROM public.transaction_categories c
                    WHERE c.id = t.category_id) IS FALSE
               THEN 'income'
             -- Degrau 3: o sinal. Zero nao existe (`amount <> 0` e CHECK
             -- desde o 001), entao o ELSE so alcanca valor positivo.
             WHEN t.amount < 0 THEN 'expense'
             ELSE 'income'
           END
         )::public.transaction_financial_type
   WHERE t.transaction_type IS NULL;

  GET DIAGNOSTICS v_linhas = ROW_COUNT;
  RETURN v_linhas;
END;
$$;

COMMENT ON FUNCTION public.backfill_tipo_do_lancamento() IS
  'Preenche financial_transactions.transaction_type onde ele e NULO (HMO-181). Tres degraus: perna de transferencia (pelos dois lados de counterpart_transaction_id), depois transaction_categories.is_expense, depois o sinal do valor. Devolve quantas linhas foram consertadas. Idempotente: a segunda chamada devolve 0. Linha sem tipo fica fora de monthly_cash_flow, category_monthly_totals e planned_vs_actual, e continua aparecendo na lista de lancamentos.';

-- A porta fechada por padrao. `authenticated` tem GRANT amplo neste banco
-- (002, SECAO 2), e EXECUTE em funcao nova e dado a PUBLIC pelo Postgres sem
-- ninguem pedir.
REVOKE ALL ON FUNCTION public.backfill_tipo_do_lancamento() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. O backfill em si
-- ---------------------------------------------------------------------------
-- Idempotente pelo `WHERE transaction_type IS NULL` de dentro da funcao: a
-- segunda aplicacao desta migration consertou 0 linhas, e isso e sucesso.
--
-- O NOTICE existe para a aplicacao A MAO: quem cola isto no SQL Editor nao tem
-- como saber se o backfill alcancou alguma coisa, e "rodou sem erro" e
-- indistinguivel de "nao tinha o que fazer". O numero diz qual dos dois foi.
--
-- Os tres triggers de UPDATE de `financial_transactions` foram conferidos
-- contra este UPDATE antes de ele ser escrito:
--
--   update_account_balance_trigger  subtrai OLD.amount e soma NEW.amount na
--                                   mesma conta. `amount` nao muda aqui, entao
--                                   o efeito liquido no saldo e zero.
--   trigger_auto_create_group_transaction  chama refazer_rateio_do_grupo com
--                                   OLD.group_id e OLD.amount. Os dois ficam
--                                   iguais, entao `v_mudou_grupo` e
--                                   `v_mudou_valor` sao falsos e as duas travas
--                                   de PDG01 nao disparam -- uma despesa de
--                                   grupo com parte JA APROVADA passa por este
--                                   backfill sem recusar. (Se disparassem, a
--                                   migration morreria no meio, no banco do
--                                   Helio e em nenhum outro.)
--   release_statement_entry         so em DELETE.
DO $$
DECLARE
  v_linhas integer;
BEGIN
  v_linhas := public.backfill_tipo_do_lancamento();

  IF v_linhas = 0 THEN
    RAISE NOTICE '037: nenhuma linha sem transaction_type (ou o backfill ja rodou).';
  ELSE
    RAISE NOTICE '037: % linha(s) de financial_transactions ganharam transaction_type e voltaram para monthly_cash_flow, category_monthly_totals e planned_vs_actual.', v_linhas;
  END IF;
END $$;

COMMIT;

-- ===========================================================================
-- CONFERENCIA, PARA RODAR DEPOIS (E A MESMA ANTES, PARA SABER O TAMANHO)
-- ===========================================================================
-- Esta consulta tem o DENOMINADOR junto de proposito. "Quantas linhas estao
-- erradas?" sozinha responde 0 tanto quando esta tudo certo quanto quando a
-- sessao nao enxerga a tabela -- e `financial_transactions` tem RLS, entao uma
-- credencial que nao seja o dono (nem `postgres`) le zero linha e a conferencia
-- passa VAZIA, parecendo a resposta boa.
--
--   SELECT count(*) AS total,
--          count(*) FILTER (WHERE transaction_type IS NULL) AS sem_tipo,
--          count(*) FILTER (WHERE transaction_type = 'expense' AND amount > 0)
--            AS despesa_com_sinal_trocado
--     FROM public.financial_transactions;
--
-- Depois da 037, `sem_tipo` tem de ser 0 com `total` > 0.
--
-- `despesa_com_sinal_trocado` e o OUTRO estrago da HMO-181, e esta migration
-- NAO o conserta: ela nao inverte sinal de linha nenhuma. O motivo e que um
-- valor positivo em categoria de despesa tambem e o que um ESTORNO legitimo
-- parece, e nao ha no banco nada que distinga os dois -- trocar o sinal em
-- massa transformaria estorno em despesa e tiraria dinheiro do saldo de quem
-- lancou certo. Se a consulta acima devolver linhas aqui, elas sao poucas e
-- identificaveis uma a uma pela descricao; a correcao e pela tela.
