-- 052_drop_de_transaction_installments.sql
--
-- HMO-225 / HMO-359: `transaction_installments` ficou orfa -- linhas de
-- producao que nenhuma tela le. A HMO-358 (PR anterior, ja na `main`) apagou o
-- leitor: o GET da colecao e a rota `[id]` inteira. Esta migration apaga o
-- schema.
--
-- Sai daqui:
--
--     public.transaction_installments            (tabela, folha: 4 FKs de saida)
--     public.create_installments(...)            (RPC, 001 -- escrevia na tabela)
--     public.pay_installment(uuid, date)         (RPC, 001)
--
-- ===========================================================================
-- O PREFLIGHT E O CORACAO DESTA MIGRATION, NAO ENFEITE
-- ===========================================================================
-- A contagem que a HMO-225 fez em producao e READ-ONLY E CEGA POR RLS:
-- `count(*) = 0` pela credencial `paperclip_ro` NAO VALE COMO PROVA. A unica
-- policy da tabela, `transaction_installments_own` (002, linha 486), e para
-- `{authenticated}`, e o RO nao tem `BYPASSRLS` -- ele le zero linha porque a
-- policy o filtra, nao porque a tabela esteja vazia.
--
-- O que ha de solido em prod, de `pg_stat_user_tables`:
--
--     n_live_tup = 0    n_dead_tup = 3    n_tup_ins/upd/del = 2/1/2
--     heap de UMA pagina, autovacuum NUNCA rodado
--
-- A aritmetica fecha (as 3 versoes escritas estao mortas), e com autovacuum
-- nunca rodado a pagina unica de hoje e o ponto alto VITALICIO: teto de ~36
-- linhas em toda a vida da tabela. Isso e TETO, nao zero provado.
--
-- No SQL Editor a colagem roda como `postgres`, que BYPASSA RLS -- la a
-- contagem e a verdadeira. E por isso que a contagem vive DENTRO da migration:
-- ninguem precisa confiar na estimativa read-only. Se o preflight achar linha,
-- a migration ABORTA sem apagar nada, e a HMO-225 volta para a escolha
-- (a) migrar / (b) tela de legado / (c) descartar, com a contagem real. ESSA
-- DECISAO E DO DONO DO DADO. Nao troque o `RAISE EXCEPTION` por um `NOTICE`.
--
-- Tres detalhes do bloco que nao sao estilo:
--
--   * `is_active IS NOT FALSE`, nao `= true`. A coluna e nullable (001); com
--     `= true` uma linha com `is_active` NULL seria descartada da contagem de
--     ativas EM SILENCIO -- e linha NULL e linha de dinheiro igual.
--   * O `RAISE NOTICE` sai NO CAMINHO BOM tambem. Se der zero, quem cola ve
--     `0 linha(s), 0 ativa(s)` na tela do SQL Editor -- esse NOTICE E o
--     "mostrar ao dono o que vai embora" que a HMO-225 exigia.
--   * Funcoes antes da tabela, `IF EXISTS` nas tres: a migration tem de ser
--     re-executavel, porque pode ser colada depois de uma tentativa abortada.
--
-- ===========================================================================
-- POR QUE O DROP E SEGURO NESTA POSICAO
-- ===========================================================================
-- A tabela e FOLHA: as 4 FKs dela sao de SAIDA (`user_id`, `account_id`,
-- `category_id`, `group_id`) e nenhuma aponta para ca. Nenhuma view, trigger ou
-- FK a referencia, e nenhuma migration a recria depois da 036. Nada reverte
-- este DROP por ordem de colagem.
--
-- O 000_preflight_inventory (linha 146) afirma que
-- `transaction_installments.user_id` existe, e o 002 (linhas 83 e 485) cria a
-- policy dela. OS DOIS FICAM COMO ESTAO -- sao historicos, e a cadeia replaya
-- em ordem (000 -> 002 -> ... -> este DROP), onde nos dois pontos a tabela
-- ainda existe. MEDIDO (2026-10-09) que nenhuma guarda do `db-verify` roda o
-- 000 ou a auditoria de RLS isoladamente contra o ESTADO FINAL: o step "Deriva
-- de schema" roda os dois, mas num banco proprio (`pulodogato_schemadrift`) que
-- tem apenas o shim e o 001_baseline -- la a tabela existe. Era a unica maneira
-- plausivel de esta migration quebrar o job.
--
-- `public.verify_system_setup()` (001, linha 983) conta 8 funcoes customizadas
-- e reporta `OK` se `>= 8`; duas delas saem aqui, o que a deixaria em 6 e
-- `INCOMPLETE`. Ela NAO TEM CHAMADOR NENHUM -- nem no app, nem em teste, nem em
-- step de workflow (conferido por grep na arvore inteira) -- entao o relatorio
-- degradado nao e lido por ninguem. Fica registrado aqui porque quem rodar a
-- funcao a mao no futuro vai ver `INCOMPLETE` e precisa saber que e esperado.
--
-- ===========================================================================
-- BONUS: 2 DAS 6 FUNCOES ANONIMO-CHAMAVEIS DA HMO-346 SAEM JUNTO
-- ===========================================================================
-- `create_installments` e `pay_installment` sao `SECURITY DEFINER` com
-- `EXECUTE` para `anon`, e sao 2 das 6 funcoes da HMO-346. Como NENHUMA das
-- duas tem chamador no app, o DROP as elimina sem precisar decidir entre
-- `REVOKE`, `search_path` fixo ou checagem de `auth.uid()` no corpo -- que e a
-- discussao que mantem a HMO-346 parada. O placar dela cai para 3 de 6.

BEGIN;

-- ---------------------------------------------------------------------------
-- PREFLIGHT: esta migration se recusa a apagar dinheiro.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_total  bigint;
  v_ativas bigint;
BEGIN
  -- Se a tabela ja nao existe, a migration ja rodou: nao ha o que contar.
  -- (Idempotencia; o `IF EXISTS` dos DROPs abaixo cuida do resto.)
  IF to_regclass('public.transaction_installments') IS NULL THEN
    RAISE NOTICE 'HMO-225: transaction_installments ja nao existe; nada a apagar';
    RETURN;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE is_active IS NOT FALSE)
    INTO v_total, v_ativas
    FROM public.transaction_installments;

  RAISE NOTICE 'HMO-225: transaction_installments tem % linha(s), % ativa(s)',
    v_total, v_ativas;

  IF v_total > 0 THEN
    RAISE EXCEPTION
      'HMO-225 ABORTADA: % linha(s) em transaction_installments. '
      'Nao apague: leve a contagem para a issue e decida migrar x descartar.',
      v_total;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.pay_installment(uuid, date);

DROP FUNCTION IF EXISTS public.create_installments(
  uuid, uuid, uuid, text, numeric, integer, date,
  transaction_financial_type, uuid, text, text);

DROP TABLE IF EXISTS public.transaction_installments;

-- ---------------------------------------------------------------------------
-- Prova: os tres objetos sairam, e a policy saiu com a tabela.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  problemas text := '';
BEGIN
  IF to_regclass('public.transaction_installments') IS NOT NULL THEN
    problemas := problemas || E'\n  - a tabela transaction_installments continua de pe';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('create_installments', 'pay_installment')
  ) THEN
    problemas := problemas || E'\n  - create_installments/pay_installment continuam de pe';
  END IF;

  -- A policy cai junto com a tabela; conferir e barato e fecha o buraco da
  -- HMO-346 pelos dois lados (objeto e permissao).
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'transaction_installments'
  ) THEN
    problemas := problemas || E'\n  - sobrou policy em transaction_installments';
  END IF;

  IF problemas <> '' THEN
    RAISE EXCEPTION '052 nao ficou completa:%', problemas;
  END IF;

  RAISE NOTICE '052 ok: transaction_installments, create_installments e pay_installment sairam';
END $$;

COMMIT;
