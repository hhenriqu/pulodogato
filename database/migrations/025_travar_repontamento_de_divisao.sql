-- 025_travar_repontamento_de_divisao.sql
--
-- HMO-130: `expense_splits_update` nao congela `transaction_id` nem
-- `percentage`. Sai da HMO-125. Nao e regressao do 004 -- o buraco ja existia;
-- o 004 so tirou o acidente que o mascarava.
--
-- ===========================================================================
-- O QUE ESTA ABERTO
-- ===========================================================================
-- A policy de UPDATE de `expense_splits` (002, linha 660) e a mesma dos dois
-- lados:
--
--     USING      (participant_id = auth.uid() OR <e dono da transacao>)
--     WITH CHECK (participant_id = auth.uid() OR <e dono da transacao>)
--
-- Ela diz QUAIS LINHAS o participante alcanca, e nao QUAIS COLUNAS ele pode
-- mexer -- policy de RLS nao compara OLD com NEW, entao "esta coluna nao muda"
-- e uma frase que policy nenhuma consegue dizer. O participante alcanca a
-- propria linha inteira.
--
-- O vazamento sai do BEFORE trigger `calculate_split_amount` (001), que o 004
-- passou para SECURITY DEFINER -- e precisa ser DEFINER, senao aprovar divisao
-- quebra, que foi a HMO-125:
--
--     SELECT ABS(amount) * (NEW.percentage / 100.0) INTO NEW.amount
--     FROM financial_transactions WHERE id = NEW.transaction_id;
--
-- Esse SELECT roda SEM RLS. Entao o participante que der
--
--     PATCH /rest/v1/expense_splits?id=eq.<a divisao dele>
--     { "transaction_id": "<despesa alheia>", "percentage": 100 }
--
-- recebe em `amount` o valor exato da despesa alheia, e le de volta pela
-- policy de SELECT da propria linha. Nao precisa de grupo, nao precisa ser
-- dono de nada: a linha continua sendo dele o tempo todo.
--
-- O `percentage` vaza sozinho, sem repontar. Numa divisao 1-para-1 o
-- participante NAO enxerga a transacao: `financial_transactions_select` e
-- `user_id = auth.uid() OR (group_id IS NOT NULL AND is_group_member(...))`,
-- e despesa pessoal dividida nao tem grupo. Ele so conhece a parte DELE.
-- Subir a propria porcentagem para 100 faz o trigger devolver o total da
-- despesa do outro. Por isso as duas colunas entram aqui, e nao so uma.
--
-- ALCANCE: e leitura de valor por alvo conhecido, nao porta aberta. O UUID
-- alvo e v4 e nao da para enumerar, e nao vazam descricao, categoria nem dono
-- -- so o numero. Gravidade baixa. Mas e alcancavel HOJE, pela chave anon com
-- uma sessao comum: o 002 deu `GRANT ... UPDATE ON ALL TABLES ... TO
-- authenticated` (linha 382) e o PostgREST expoe a tabela. Nao e estado que so
-- se forja por dentro do banco.
--
-- Antes do 004 nao dava, mas por acidente: o SELECT do trigger voltava vazio
-- sob RLS, `NEW.amount` virava NULL e o NOT NULL derrubava a transacao. A
-- protecao era efeito colateral de um bug, e foi embora junto com o bug.
--
-- ===========================================================================
-- POR QUE TRIGGER, E NAO POLICY
-- ===========================================================================
-- A HMO-130 listou duas saidas: (1) trigger BEFORE UPDATE, (2) tirar o UPDATE
-- direto do participante e mover aprovar/rejeitar para uma funcao DEFINER
-- (`approve_split`), com a rota chamando RPC. Esta migration faz a (1).
--
-- A (2) e mais limpa a longo prazo, mas troca o contrato de
-- `app/api/personal-finance/splits/route.ts` e so se paga quando a rota for
-- mexida de qualquer jeito. A (1) e contida e nao pede deploy: a rota atual
-- so escreve `status`, `approved_at`, `rejection_reason` e `updated_at`, que
-- e exatamente o que continua passando.
--
-- Quebrar `expense_splits_update` em duas policies (uma do participante, uma
-- do dono), como o esboco da issue sugeria, NAO ajuda e nao esta aqui: duas
-- policies permissivas sao OR entre si, entao o par teria o mesmo predicado
-- efetivo que a policy unica de hoje. Seria renomear, nao consertar. A policy
-- do 002 fica como esta.
--
-- ===========================================================================
-- O QUE ESTA MIGRATION NAO CONGELA, DE PROPOSITO
-- ===========================================================================
--   * `participant_id`: a policy ja o prende para o participante (mudar para
--     terceiro reprova no WITH CHECK, que exige `participant_id = auth.uid()`
--     na linha NOVA). Para o dono nao prende -- mas o dono ja pode criar a
--     divisao apontando para quem quiser, porque `expense_splits_insert` so
--     exige que a transacao seja dele. Congelar aqui nao tiraria poder nenhum
--     de ninguem: seria trava sobre estado que ja e alcancavel por outra
--     porta.
--
--   * `amount`: e coluna DERIVADA. `calculate_split_amount_trigger` e BEFORE
--     INSERT OR UPDATE e reescreve `NEW.amount` em toda passada, a partir de
--     `percentage` e `transaction_id`. Com as duas travadas, o valor escrito
--     a mao e descartado antes de chegar na tabela -- e nao ha ordem de
--     trigger que mude isso, porque nenhum outro trigger escreve `amount`.
--     A SECAO 5 do teste cobre essa transitividade.
--
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A guarda
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER explicito e `search_path` fixo, como a `categorization_rules_guard`
-- do 014. INVOKER e o certo aqui, ao contrario do 003/004: aquelas funcoes
-- precisavam de DEFINER porque ESCREVEM em tabela derivada que a RLS do 002
-- fecha. Esta so LE, e o predicado que ela avalia
-- (`ft.user_id = auth.uid()`) e mais estreito que a policy de SELECT da
-- tabela lida -- entao DEFINER nao compraria resposta nenhuma que INVOKER nao
-- da, e compraria um caminho sem RLS que ninguem precisa.
--
-- `auth.uid() IS NULL` passa direto. Quem chega assim e `service_role`, cron
-- ou psql direto -- backend nosso, que precisa poder corrigir divisao. Nao e
-- brecha para o app: `anon` levou REVOKE ALL da tabela no 002, e um
-- `authenticated` sem claim `sub` teria `participant_id = NULL` na policy de
-- UPDATE, que e NULL, que nao e TRUE -- a RLS nao lhe entrega linha nenhuma
-- para este trigger julgar.
CREATE OR REPLACE FUNCTION public.expense_splits_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dono BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Vale para todo mundo, dono inclusive. Mover uma divisao de uma despesa
  -- para outra nao e edicao, e troca de fato gerador: o saldo ja lancado passa
  -- a referenciar despesa que nunca o produziu. Quem quer dividir outra
  -- despesa cria outra divisao.
  IF NEW.transaction_id IS DISTINCT FROM OLD.transaction_id THEN
    RAISE EXCEPTION
      'divisao nao muda de despesa: apague esta e crie outra (era %, veio %)',
      OLD.transaction_id, NEW.transaction_id
      USING ERRCODE = '42501';
  END IF;

  IF NEW.percentage IS DISTINCT FROM OLD.percentage THEN
    SELECT EXISTS (
      SELECT 1 FROM public.financial_transactions ft
      WHERE ft.id = OLD.transaction_id AND ft.user_id = auth.uid()
    ) INTO v_dono;

    IF NOT v_dono THEN
      RAISE EXCEPTION
        'so o dono da despesa muda a porcentagem da divisao'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expense_splits_guard ON public.expense_splits;
CREATE TRIGGER trg_expense_splits_guard
  BEFORE UPDATE ON public.expense_splits
  FOR EACH ROW EXECUTE FUNCTION public.expense_splits_guard();

-- Sem REVOKE, de proposito, e vale registrar o porque para ninguem "consertar"
-- a ausencia depois:
--
--   1. no Supabase, `REVOKE ... FROM PUBLIC` nao fecha nada. O Supabase concede
--      EXECUTE a `anon`/`authenticated`/`service_role` EXPLICITAMENTE, por
--      ALTER DEFAULT PRIVILEGES, e revogar de PUBLIC nao mexe em concessao
--      nominal -- o `proacl` continua com `authenticated=X/postgres` depois do
--      revoke. Foi o que o 003 e o 004 shiparam achando que estavam fechando;
--      os dois ja carregam a correcao em comentario. Para fechar de verdade e
--      preciso nomear os tres papeis;
--
--   2. e aqui nao ha o que fechar: a funcao devolve `trigger`, e o Postgres
--      recusa chamada direta a funcao de trigger (`can only be called as a
--      trigger`). O PostgREST tambem nao expoe esse tipo de retorno como RPC.
--
-- Revogar mesmo assim seria ruido que parece protecao. O que o trigger PRECISA
-- e que ninguem revogue o EXECUTE de `authenticated` mais tarde achando que e
-- endurecimento: a checagem de EXECUTE de funcao de trigger acontece na CRIACAO
-- do trigger, nao no disparo, mas a regra so vale enquanto o corpo nao chamar
-- outra funcao com `PERFORM` -- e este nao chama.

-- ---------------------------------------------------------------------------
-- Prova
-- ---------------------------------------------------------------------------
-- O arquivo aborta se algo nao pegou. Sem isto, rodar a migration num banco
-- onde uma metade falhou em silencio sai verde, e o vazamento continua de pe
-- com um "aplicado" no historico.
DO $$
DECLARE
  problemas text := '';
BEGIN
  IF to_regprocedure('public.expense_splits_guard()') IS NULL THEN
    RAISE EXCEPTION '025 nao criou public.expense_splits_guard()';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = to_regclass('public.expense_splits')
      AND tgname = 'trg_expense_splits_guard'
      AND NOT tgisinternal
  ) THEN
    problemas := problemas || E'\n  - o trigger trg_expense_splits_guard nao ficou em expense_splits';
  END IF;

  -- INVOKER e parte do desenho, nao detalhe: DEFINER aqui faria a funcao ler
  -- financial_transactions sem RLS, que e a mesma porta que o 004 abriu no
  -- calculate_split_amount e que esta migration existe para trancar.
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = to_regprocedure('public.expense_splits_guard()') AND prosecdef
  ) THEN
    problemas := problemas || E'\n  - expense_splits_guard ficou SECURITY DEFINER; tem que ser INVOKER';
  END IF;

  IF (SELECT proconfig FROM pg_proc
      WHERE oid = to_regprocedure('public.expense_splits_guard()')) IS NULL THEN
    problemas := problemas || E'\n  - expense_splits_guard ficou sem search_path fixo';
  END IF;

  -- O trigger so vale se a tabela ainda tiver RLS: sem ela, a policy de UPDATE
  -- nem limita as linhas, e travar coluna vira consolo.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = to_regclass('public.expense_splits') AND relrowsecurity
  ) THEN
    problemas := problemas || E'\n  - expense_splits esta sem RLS';
  END IF;

  -- A premissa do vazamento. Se um dia o calculate_split_amount deixar de ser
  -- DEFINER, esta migration continua correta -- mas a nota de cima passa a
  -- descrever um banco que nao existe mais, e quem ler aqui merece saber.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = to_regprocedure('public.calculate_split_amount()') AND prosecdef
  ) THEN
    RAISE NOTICE '025: calculate_split_amount nao e mais SECURITY DEFINER -- reler a nota do topo';
  END IF;

  IF problemas <> '' THEN
    RAISE EXCEPTION '025 nao pegou:%', problemas;
  END IF;

  RAISE NOTICE '025 ok: trg_expense_splits_guard ativo, INVOKER, search_path fixo';
END $$;

COMMIT;

-- =====================================================
-- DEPOIS DE APLICAR
-- =====================================================
-- Nao ha deploy a esperar. A rota de divisoes que esta no ar
-- (app/api/personal-finance/splits/route.ts) escreve `status`, `approved_at`,
-- `rejection_reason` e `updated_at` -- nenhuma das colunas travadas -- entao
-- aprovar e rejeitar continuam funcionando exatamente como hoje.
--
-- O que muda: um PATCH direto no PostgREST que tente repontar `transaction_id`
-- ou mexer em `percentage` sem ser dono passa a voltar 403 em vez de gravar.
-- =====================================================
