-- =====================================================
-- Um ativo e atrelado a Corretora A, ANTES do re-run da 059 (HMO-432, fase 1)
-- =====================================================
-- Este arquivo nao testa nada. Ele e o passo 3 de quatro, e a POSICAO dele e a
-- unica coisa que importa nele.
--
-- A ORDEM, QUE NAO E NEGOCIAVEL
-- -----------------------------
--   1. `059_ativos_antes_da_059.sql`     -- dois ativos soltos, e COMITA;
--   2. a migration 059                   -- a coluna nasce, os dois ficam NULL;
--   3. ESTE ARQUIVO                      -- atrela o `...a2` a Corretora A, e COMITA;
--   4. a migration 059 DE NOVO           -- idempotencia;
--   5. `hmo432_conta_investimento_test.sql`
--
-- So nessa ordem a secao 5 da suite mede o que ela existe para medir: que
-- re-colar o arquivo NAO SOLTA o ativo que a pessoa atrelou. Mover o passo 4
-- para antes do 3 deixa a secao 5 VERDE e sem controlar nada -- exatamente o
-- modo de falha de `guarda-de-ancora-verde-nao-prova-que-o-mutante-morre`.
--
-- O MUTANTE QUE SO ELE MATA
-- -------------------------
-- `UPDATE public.investment_assets SET account_id = NULL` acrescentado ao fim da
-- migration -- o backfill "de limpeza" na direcao oposta ao do cabecalho de
-- `059_ativos_antes_da_059.sql`. Aquele arquivo nao o delata: o ativo `...a1`
-- nasce `NULL` e continuaria `NULL`, e a assercao dele passaria. Este delata,
-- porque o `...a2` tem elo ESCOLHIDO no momento do re-run, e um `SET NULL`
-- apaga a escolha da pessoa calado.
--
-- E um mutante caro: em producao a migration e colada a mao, e colar duas vezes
-- acontece (`colagem-em-prod-pode-vir-sem-aviso-meca-primeiro`). A segunda
-- colagem desatrelaria toda a carteira, e o sintoma seria "meus investimentos
-- sumiram da Conta Investimento" sem nenhum erro em nenhum log.
--
-- POR QUE O UPDATE AQUI PASSA PELA TRAVA
-- --------------------------------------
-- A Corretora A (`f0590000-...0001`) e conta `account_type = 'investment'` do
-- MESMO dono do ativo (`a0590000-...0099`), que e exatamente o que a trigger
-- `investment_assets_conta_trava` exige. Se este arquivo falhar com
-- `check_violation`, o defeito nao esta aqui -- esta na trava, que ficou larga
-- demais ao contrario e esta recusando o caminho felizes.
--
-- ELE COMITA, pela mesma razao do passo 1: a migration do passo 4 e o teste do
-- passo 5 rodam noutras sessoes.
--
-- Rodar ENTRE as duas colagens da 059:
--   psql "$DB_URL" -f database/tests/059_ativo_ligado_a_conta.sql
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

UPDATE public.investment_assets
   SET account_id = 'f0590000-0000-0000-0000-000000000001'
 WHERE id = 'a5590000-0000-0000-0000-0000000000a2';

-- Que o UPDATE acima tenha ENCONTRADO a linha. Sem isto, um erro de digitacao
-- no uuid deixaria este arquivo verde tendo atualizado zero linhas, e a secao 5
-- da suite passaria a comparar NULL com NULL -- verde, e vazia.
DO $$
DECLARE
  v_conta uuid;
BEGIN
  SELECT account_id INTO v_conta
    FROM public.investment_assets
   WHERE id = 'a5590000-0000-0000-0000-0000000000a2';

  IF v_conta IS DISTINCT FROM 'f0590000-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'A fixture nao atrelou o ativo: account_id ficou %', v_conta;
  END IF;
END $$;

COMMIT;
