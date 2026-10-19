-- =====================================================
-- Uma conta DESLIGADA do total, entre a 058 e o re-run dela (HMO-431)
-- =====================================================
-- Este arquivo nao testa nada. Ele e o unico jeito de provar a decisao mais
-- facil de errar da 058: que ela NAO TEM BACKFILL.
--
-- O QUE ELE FECHA
-- ---------------
-- A 058 e `ADD COLUMN IF NOT EXISTS ... DEFAULT true`, e nada mais. A versao
-- "obvia" que alguem escreve ao ler o cabecalho e a mesma coisa mais um
--
--     UPDATE public.financial_accounts SET include_in_total = true
--      WHERE include_in_total IS NULL;
--
-- ou, pior, sem o WHERE. Num banco onde a coluna acabou de nascer isso e um
-- no-op perfeito: toda linha ja vale `true`, o UPDATE toca zero linhas (ou
-- reescreve o valor que ja estava la), e NENHUMA assercao sobre o estado final
-- de um banco novo distingue as duas versoes da migration.
--
-- O estrago aparece na SEGUNDA colagem, que neste repositorio e um evento
-- normal e nao um acidente: as migrations sao coladas a mao no SQL Editor (ver
-- `deploy-ships-code-not-schema`), e o step "058 e idempotente" do db-verify
-- existe porque re-colar o arquivo tem de ser seguro. Com o UPDATE sem WHERE,
-- a segunda colagem RELIGA todas as contas que o usuario desligou -- as contas
-- voltam para dentro dos totais caladas, sem ninguem tocar na tela, e o
-- sintoma ("meu patrimonio subiu sozinho") chega semanas depois sem nada que o
-- ligue a uma colagem de SQL.
--
-- ENTAO A ORDEM DOS QUATRO PASSOS IMPORTA, e e esta:
--
--   1. `058_contas_antes_da_058.sql`   -> planta duas contas SEM a coluna
--   2. `058_conta_fora_dos_totais.sql` -> a migration; as duas viram `true`
--   3. ESTE ARQUIVO                    -> desliga UMA delas, e COMITA
--   4. `058_conta_fora_dos_totais.sql` -> o re-run (step "e idempotente")
--
-- E so depois disso a suite roda e exige, na secao 5, que a conta desligada
-- CONTINUE desligada. Posto em qualquer outra posicao da cadeia, este arquivo
-- nao mede nada: antes do 2 ele nem compila (a coluna nao existe), e depois do
-- 4 o re-run que ele existe para vigiar ja aconteceu.
--
-- ELE COMITA, DE PROPOSITO: o re-run da migration roda noutra sessao, e um
-- UPDATE em transacao aberta seria invisivel para ele -- o passo 4 encontraria
-- a conta ainda `true` e o controle passaria verde vacuo.
--
-- A conta e a `...002` de `058_contas_antes_da_058.sql`. O `WHERE` nomeia o id
-- em vez de usar `LIMIT 1` para que este arquivo nao possa desligar a conta de
-- outra suite se a ordem da cadeia mudar.
--
-- Rodar ENTRE a 058 e o re-run dela:
--   psql "$DB_URL" -f database/tests/058_conta_desligada_do_total.sql
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

UPDATE public.financial_accounts
   SET include_in_total = FALSE
 WHERE id = 'f0580000-0000-0000-0000-000000000002';

-- O UPDATE tem de ter achado a linha. Sem esta guarda, um id trocado (ou uma
-- fixture que nao rodou) deixaria zero linhas desligadas, e a secao 5 da suite
-- passaria a afirmar "continua FALSE" sobre uma conta que nunca foi FALSE --
-- um controle negativo vacuo, que e o modo de falha que
-- `suite-vermelha-faz-todo-controle-negativo-passar-vacuo` descreve.
DO $$
DECLARE
  desligadas INTEGER;
BEGIN
  SELECT count(*) INTO desligadas
    FROM public.financial_accounts
   WHERE id = 'f0580000-0000-0000-0000-000000000002'
     AND include_in_total = FALSE;

  IF desligadas <> 1 THEN
    RAISE EXCEPTION
      'FALHA: a conta f0580000-...-002 nao foi desligada (obtido % linhas). A fixture 058_contas_antes_da_058.sql rodou?',
      desligadas;
  END IF;
END $$;

COMMIT;
