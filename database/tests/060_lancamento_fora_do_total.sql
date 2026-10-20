-- =====================================================
-- Dois lancamentos TIRADOS do total, entre a 060 e o re-run dela (HMO-443)
-- =====================================================
-- Este arquivo nao testa nada. Ele tem DOIS papeis, e os dois dependem da
-- POSICAO dele na cadeia:
--
--   (a) e o unico jeito de provar que a 060 NAO TEM BACKFILL;
--   (b) e ele que cria o lado MARCADO que as secoes 3 e 4 da suite comparam
--       com o lado nao marcado -- sem ele, `category_monthly_totals` devolveria
--       os quatro lancamentos e nao haveria nada que distinguisse uma view
--       filtrada de uma view sem filtro.
--
-- O QUE O PAPEL (a) FECHA
-- -----------------------
-- A 060 cria a coluna com `DEFAULT true` e nada mais. A versao "obvia" que
-- alguem escreve ao ler o cabecalho e a mesma coisa mais um
--
--     UPDATE public.financial_transactions SET include_in_total = true
--      WHERE include_in_total IS NULL;
--
-- ou, pior, sem o WHERE. Num banco onde a coluna acabou de nascer isso e um
-- no-op perfeito: toda linha ja vale `true`, o UPDATE toca zero linhas (ou
-- reescreve o valor que ja estava la), e NENHUMA assercao sobre o estado final
-- de um banco novo distingue as duas versoes da migration.
--
-- O estrago aparece na SEGUNDA colagem, que neste repositorio e um evento
-- normal e nao um acidente: as migrations sao coladas a mao no SQL Editor (ver
-- `deploy-ships-code-not-schema`), e o step "060 e idempotente" do db-verify
-- existe porque re-colar o arquivo tem de ser seguro. Com o UPDATE sem WHERE,
-- a segunda colagem RE-SOMA todo lancamento que o usuario tirou dos totais --
-- os ajustes de saldo voltam para dentro do fluxo de caixa calados, sem
-- ninguem tocar na tela, e o sintoma ("minha receita de marco subiu sozinha")
-- chega semanas depois sem nada que o ligue a uma colagem de SQL.
--
-- ENTAO A ORDEM DOS QUATRO PASSOS IMPORTA, e e esta:
--
--   1. `060_lancamentos_antes_da_060.sql`  -> planta 4 lancamentos SEM a coluna
--   2. `060_lancamento_fora_dos_totais.sql`-> a migration; os 4 viram `true`
--   3. ESTE ARQUIVO                        -> desmarca DOIS deles, e COMITA
--   4. `060_lancamento_fora_dos_totais.sql`-> o re-run (step "e idempotente")
--
-- E so depois disso a suite roda. Posto em qualquer outra posicao da cadeia,
-- este arquivo nao mede nada: antes do 2 ele nem compila (a coluna nao existe),
-- e depois do 4 o re-run que ele existe para vigiar ja aconteceu. Mover o step
-- do re-run para antes deste arquivo deixa a secao 7 da suite VERDE e sem
-- controlar nada -- o modo de falha de
-- `guarda-de-ancora-verde-nao-prova-que-o-mutante-morre`.
--
-- ELE COMITA, DE PROPOSITO: o re-run da migration roda noutra sessao, e um
-- UPDATE em transacao aberta seria invisivel para ele -- o passo 4 encontraria
-- os lancamentos ainda `true` e o controle passaria verde vacuo.
--
-- Os dois sao o `...0003` e o `...0004` de `060_lancamentos_antes_da_060.sql`.
-- O `WHERE` nomeia os ids em vez de usar um criterio por valor ou `LIMIT` para
-- que este arquivo nao possa desmarcar o lancamento de outra suite se a ordem
-- da cadeia mudar.
--
-- Rodar ENTRE a 060 e o re-run dela:
--   psql "$DB_URL" -f database/tests/060_lancamento_fora_do_total.sql
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

UPDATE public.financial_transactions
   SET include_in_total = FALSE
 WHERE id IN ('60600000-0000-0000-0000-000000000003',
              '60600000-0000-0000-0000-000000000004');

-- O UPDATE tem de ter achado as DUAS linhas. Sem esta guarda, um id trocado (ou
-- uma fixture que nao rodou) deixaria zero lancamentos desmarcados, e as
-- secoes 3, 4 e 7 da suite passariam a afirmar coisas sobre um lado marcado que
-- nao existe: "a view conta so 40,00" ficaria verde porque a view conta
-- TUDO e tudo seria 40,00 -- um controle vacuo, que e o modo de falha que
-- `suite-vermelha-faz-todo-controle-negativo-passar-vacuo` descreve.
--
-- Confere `= FALSE` e nao so a contagem dos ids: um `UPDATE` que achasse as
-- linhas e gravasse o valor errado passaria num `count(*)` dos ids.
DO $$
DECLARE
  desmarcados INTEGER;
BEGIN
  SELECT count(*) INTO desmarcados
    FROM public.financial_transactions
   WHERE id IN ('60600000-0000-0000-0000-000000000003',
                '60600000-0000-0000-0000-000000000004')
     AND include_in_total = FALSE;

  IF desmarcados <> 2 THEN
    RAISE EXCEPTION
      'FALHA: os lancamentos 60600000-...-003/004 nao foram desmarcados (obtido % de 2). A fixture 060_lancamentos_antes_da_060.sql rodou?',
      desmarcados;
  END IF;
END $$;

COMMIT;
