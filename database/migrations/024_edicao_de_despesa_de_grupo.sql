-- 024_edicao_de_despesa_de_grupo.sql
--
-- HMO-176: editar uma despesa que ja esta num grupo nao refaz a divisao.
--
-- ===========================================================================
-- OS DOIS ESTRAGOS, MEDIDOS
-- ===========================================================================
-- Reproduzidos num Postgres 17 local com as migrations reais (001 -> 023), em
-- cima da fixture de `database/tests/group_settlement_test.sql` -- o hotel de
-- R$ 300 num grupo de tres pessoas:
--
--   1. MUDAR O VALOR DEIXA AS PARTES VELHAS.
--      `UPDATE financial_transactions SET amount = -600` devolve:
--
--          grupo  | partes | soma_das_partes | valor_da_despesa
--          Viagem |      3 |          300.00 |           600.00
--
--      A soma dos saldos do grupo -- que tem que ser exatamente zero, e e o
--      que o teste do 007 afirma -- vai para R$ 300,00. O grupo para de
--      fechar, o acerto simplificado nunca termina, e a tela do grupo so avisa
--      do residuo DEPOIS do fato.
--
--   2. TROCAR O GRUPO COBRA NOS DOIS.
--      `UPDATE financial_transactions SET group_id = <Casa>` devolve:
--
--          grupo  | partes | soma_das_partes
--          Casa   |      1 |          600.00
--          Viagem |      3 |          300.00
--
--      A mesma despesa passa a ser cobrada duas vezes, e a cobranca velha fica
--      pendurada em gente que nem viajou junto. Nenhum erro e levantado.
--
-- ===========================================================================
-- POR QUE ACONTECE
-- ===========================================================================
-- `auto_create_group_transaction()` (001_baseline.sql:143) ja e
-- AFTER INSERT OR UPDATE, entao ele RODA na edicao. O que ele nao faz e
-- trabalho nenhum: o guard
--
--     IF NOT EXISTS (SELECT 1 FROM group_transactions
--                     WHERE transaction_id = NEW.id AND group_id = NEW.group_id)
--
-- acha a linha e ele sai. No caso 2 o par (tx, grupo NOVO) nao existe, entao
-- ele insere a segunda divisao -- e nao tem uma linha sequer sobre o grupo
-- antigo. `calculate_equal_split_trigger` e BEFORE **INSERT** only em
-- `group_expense_splits`, logo tambem nao ajuda numa edicao.
--
-- E O TRIGGER GEMEO, QUE E O DETALHE QUE ENGANA
-- ---------------------------------------------
-- `sync_transaction_with_group()` (001_baseline.sql:762) e uma copia quase
-- identica, no MESMO evento, e ela TEM a limpeza do grupo antigo:
--
--     ELSIF TG_OP = 'UPDATE' AND OLD.group_id IS NOT NULL
--           AND (NEW.group_id IS NULL OR NEW.group_id != OLD.group_id) THEN
--         DELETE FROM group_transactions WHERE ... group_id = OLD.group_id;
--
-- So que ela e um ELSIF do `IF NEW.group_id IS NOT NULL AND NEW.amount < 0`.
-- Mover de Viagem para Casa satisfaz o IF (Casa nao e nulo, o valor continua
-- negativo), entao o fluxo entra no primeiro ramo e a limpeza NUNCA e
-- alcancada. Ela so roda quando o grupo e ESVAZIADO. O codigo do conserto
-- estava escrito no baseline e morto desde o primeiro dia.
--
-- Os dois triggers juntos tambem sao a razao de "removi o trigger e nada
-- mudou" ser uma conclusao errada e facil de tirar aqui: cada um desiste
-- quando o outro ja agiu. Esta migration acaba com a duplicidade -- um so
-- trigger, com uma so definicao de comportamento.
--
-- ===========================================================================
-- A DECISAO DE PRODUTO: OPCAO (b)
-- ===========================================================================
-- O que acontece com uma parte que alguem JA respondeu quando o valor muda?
-- As opcoes postas na issue eram (a) recalcular tudo e devolver todo mundo
-- para `pending`, (b) recalcular so o que ninguem aprovou e TRAVAR a edicao
-- quando ja houver parte aprovada, (c) proibir editar e exigir estorno.
-- O dono do projeto declarou (b) como padrao. Implementado aqui assim:
--
--   * existe parte 'approved'  -> a edicao e RECUSADA, com ERRCODE 'PDG01' e
--     uma mensagem que diz o que fazer. Recalcular por cima apagaria a
--     conferencia de quem ja olhou a despesa e concordou com o numero;
--
--   * so ha 'pending' / 'rejected' / 'expired' -> recalcula.
--
-- UMA DECISAO A MAIS, QUE E MINHA E ESTA AQUI PARA SER VETADA
-- ----------------------------------------------------------
-- Parte 'rejected' ou 'expired' volta para 'pending' (e `approved_at` volta a
-- NULL) quando o valor muda. Recusar e uma resposta sobre um NUMERO: manter
-- "recusado" colado num valor que nao existe mais e a mesma familia de defeito
-- que um rotulo que mente -- a tela mostraria uma recusa de R$ 100 sobre uma
-- parte de R$ 200, sem erro nenhum. Voltando para 'pending', a pessoa e
-- perguntada de novo sobre o valor novo. 'approved' nao chega aqui: ela trava
-- antes.
--
-- ===========================================================================
-- POR QUE SECURITY DEFINER (E NAO E ZELO EXCESSIVO)
-- ===========================================================================
-- `auto_create_group_transaction` e SECURITY INVOKER, e a RLS das tabelas de
-- grupo NAO deixa o dono da despesa mexer nas partes dos outros:
--
--     group_expense_splits_delete  USING (... is_group_admin(gt.group_id))
--     group_expense_splits_update  USING (owns_group_member(member_id) OR admin)
--
-- Quem edita a propria despesa num grupo em que NAO e admin conseguiria
-- reescrever apenas a propria parte. As outras ficariam com o valor velho, sem
-- erro -- o comando "funciona", 0 linhas atingidas, e o grupo continua sem
-- fechar. Exatamente o mesmo formato de falha que esta migration existe para
-- matar. Por isso o recalculo mora numa funcao SECURITY DEFINER, no mesmo
-- molde de `calculate_split_amount()`, que o 004 marcou assim pela razao
-- gemea ("recalcula o valor lendo a despesa do dono").
--
-- ===========================================================================
-- IDEMPOTENTE
-- ===========================================================================
-- Tudo e CREATE OR REPLACE / DROP TRIGGER IF EXISTS. Rodar duas vezes seguidas
-- e o mesmo que rodar uma -- o CI aplica cada migration duas vezes de
-- proposito.

BEGIN;

-- ===========================================================================
-- 1. Ha parte aprovada nesta despesa de grupo?
-- ===========================================================================
-- SECURITY DEFINER pelo motivo do cabecalho: `group_expense_splits_select` deixa
-- o membro ler as partes do proprio grupo, mas esta funcao tambem e chamada
-- para o grupo ANTIGO numa troca, e nada garante que quem edita ainda enxerga
-- tudo dali. Uma trava que nao ve a parte aprovada nao trava -- e liberar por
-- cegueira e pior que nao ter trava, porque o log fica limpo.
CREATE OR REPLACE FUNCTION public.group_split_tem_aprovada(p_group_transaction_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_expense_splits es
     WHERE es.group_transaction_id = p_group_transaction_id
       AND es.status = 'approved'
  );
$$;

COMMENT ON FUNCTION public.group_split_tem_aprovada(uuid) IS
  'Alguma parte desta despesa de grupo ja foi aprovada? Trava a edicao do valor (HMO-176, opcao b).';

REVOKE EXECUTE ON FUNCTION public.group_split_tem_aprovada(uuid) FROM PUBLIC;

-- ===========================================================================
-- 2. O recalculo das partes
-- ===========================================================================
-- Reparte `ABS(ft.amount)` entre as partes que JA EXISTEM, na proporcao da
-- `percentage` gravada em cada uma. Duas coisas importantes na escolha:
--
--   * o CONJUNTO de partes nao muda. Recalcular pela lista de membros ativos de
--     hoje (que e o que um INSERT novo faria) mudaria QUEM paga durante uma
--     edicao de VALOR -- alguem que entrou no grupo depois passaria a dever uma
--     despesa anterior a entrada dele, sem ninguem ter pedido. Deriva de
--     quadro societario nao e assunto desta issue;
--
--   * a proporcao sai da `percentage`, nao de `1/n`. Por isso o rateio
--     combinado sobrevive: 70/30 continua 70/30 depois de a despesa dobrar. Um
--     recalculo igualitario achataria a divisao personalizada em silencio, que
--     e precisamente o segundo defeito que o 007 consertou em
--     `calculate_equal_split` -- nao vale reintroduzi-lo pela porta da edicao.
--
-- A aritmetica e a MESMA do 007: centavos inteiros e metodo do maior resto,
-- para a soma das partes bater no centavo com o valor da despesa. Sem isso o
-- acerto de contas nao fecha e a tela diz "voce ainda deve R$ 0,03" para
-- sempre. Empate de resto e desfeito por `member_id` -- arbitrario, mas
-- ESTAVEL, igual ao 007.
--
-- Conferencia: com R$ 100 por 3, as partes igualitarias saem 33,34 / 33,33 /
-- 33,33 -- identicas ao que `calculate_equal_split` produz num INSERT novo.
CREATE OR REPLACE FUNCTION public.rerratear_despesa_de_grupo(p_group_transaction_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total_cents BIGINT;
  v_soma_pct    NUMERIC;
  v_atingidas   INTEGER;
BEGIN
  SELECT ROUND(ABS(ft.amount) * 100)::bigint
    INTO v_total_cents
    FROM public.financial_transactions ft
    JOIN public.group_transactions gt ON gt.transaction_id = ft.id
   WHERE gt.id = p_group_transaction_id;

  IF v_total_cents IS NULL OR v_total_cents = 0 THEN
    RETURN 0;
  END IF;

  SELECT sum(es.percentage)
    INTO v_soma_pct
    FROM public.group_expense_splits es
   WHERE es.group_transaction_id = p_group_transaction_id;

  -- Sem partes, ou partes que somam zero: nao ha proporcao que signifique
  -- algo. Devolver 0 e melhor que dividir por zero ou inventar um rateio.
  IF v_soma_pct IS NULL OR v_soma_pct <= 0 THEN
    RETURN 0;
  END IF;

  WITH base AS (
    SELECT
      es.id,
      es.member_id,
      -- O piso em centavos, e o resto fracionario que decide quem recebe o
      -- centavo sobrando. Os dois saem da MESMA divisao, senao a soma escapa.
      div(  (v_total_cents * es.percentage)::numeric, v_soma_pct )::bigint AS piso,
      mod(  (v_total_cents * es.percentage)::numeric, v_soma_pct )         AS resto
      FROM public.group_expense_splits es
     WHERE es.group_transaction_id = p_group_transaction_id
  ),
  ordenadas AS (
    SELECT
      b.*,
      row_number() OVER (ORDER BY b.resto DESC, b.member_id) AS posicao,
      v_total_cents - sum(b.piso) OVER () AS centavos_sobrando
      FROM base b
  )
  UPDATE public.group_expense_splits es
     SET amount = ((o.piso
                    + CASE WHEN o.posicao <= o.centavos_sobrando THEN 1 ELSE 0 END
                   )::numeric) / 100,
         -- Responder 'recusado' ou deixar expirar foi uma resposta sobre um
         -- valor que nao existe mais: a pessoa e perguntada de novo. Ver o
         -- cabecalho -- 'approved' nao chega aqui, a trava do item 3 barra.
         status = CASE WHEN es.status IN ('rejected', 'expired')
                       THEN 'pending' ELSE es.status END,
         approved_at = CASE WHEN es.status IN ('rejected', 'expired')
                            THEN NULL ELSE es.approved_at END,
         updated_at = now()
    FROM ordenadas o
   WHERE es.id = o.id;

  GET DIAGNOSTICS v_atingidas = ROW_COUNT;
  RETURN v_atingidas;
END;
$$;

COMMENT ON FUNCTION public.rerratear_despesa_de_grupo(uuid) IS
  'Reparte o valor atual da despesa entre as partes existentes, na proporcao gravada, em centavos inteiros (maior resto). Usado quando o valor de uma despesa de grupo e editado (HMO-176).';

REVOKE EXECUTE ON FUNCTION public.rerratear_despesa_de_grupo(uuid) FROM PUBLIC;

-- ===========================================================================
-- 3. O trigger, agora com o caminho da EDICAO
-- ===========================================================================
-- A parte de INSERT e a do baseline, de proposito: ela funciona, o teste do 007
-- a afirma, e trocar a criacao de rateio nao e o assunto desta issue. O que
-- entra e o ramo de UPDATE, em tres casos que antes nao existiam.
CREATE OR REPLACE FUNCTION public.auto_create_group_transaction()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  member_count INTEGER;
  split_amount DECIMAL(10,2);
  gt_id        UUID;
  v_gt_antigo  UUID;
  v_gt_atual   UUID;
  v_virou_receita BOOLEAN;
BEGIN
  -- ---------------------------------------------------------------------
  -- EDICAO: desfazer o que deixou de valer, ANTES de criar o que passou a
  -- valer. A ordem importa -- criar primeiro e o que fazia a despesa existir
  -- nos dois grupos ao mesmo tempo.
  -- ---------------------------------------------------------------------
  IF TG_OP = 'UPDATE' THEN
    -- `amount >= 0` quer dizer que isto nao e mais uma despesa (virou estorno,
    -- receita, perna de transferencia). Nao existe parte a cobrar de ninguem.
    v_virou_receita := NEW.amount >= 0;

    -- CASO 2: o grupo mudou, ou saiu de cena, ou o valor deixou de ser
    -- despesa. Em todos, a divisao do grupo ANTIGO tem que morrer. Era isto
    -- que vivia num ELSIF inalcancavel de `sync_transaction_with_group`.
    IF OLD.group_id IS NOT NULL
       AND (NEW.group_id IS DISTINCT FROM OLD.group_id OR v_virou_receita) THEN

      SELECT gt.id INTO v_gt_antigo
        FROM public.group_transactions gt
       WHERE gt.transaction_id = NEW.id AND gt.group_id = OLD.group_id;

      IF v_gt_antigo IS NOT NULL THEN
        IF public.group_split_tem_aprovada(v_gt_antigo) THEN
          RAISE EXCEPTION
            'Esta despesa ja foi aprovada por alguem no grupo anterior; tirar ela de la apagaria essa aprovacao. Estorne a despesa e lance de novo no grupo certo.'
            USING ERRCODE = 'PDG01';
        END IF;

        -- CASCADE em group_expense_splits_group_transaction_id_fkey leva as
        -- partes junto.
        DELETE FROM public.group_transactions WHERE id = v_gt_antigo;
      END IF;
    END IF;

    -- CASO 1: mesmo grupo, valor diferente. A comparacao e em CENTAVOS
    -- INTEIROS: `amount` e numeric(15,2) e -300.00 nao e -300.000 para
    -- `IS DISTINCT FROM`, entao comparar o numeric cru dispararia recalculo em
    -- reescrita que nao mudou dinheiro nenhum.
    IF NEW.group_id IS NOT NULL
       AND NOT v_virou_receita
       AND NEW.group_id = OLD.group_id
       AND ROUND(ABS(NEW.amount) * 100) IS DISTINCT FROM ROUND(ABS(OLD.amount) * 100) THEN

      SELECT gt.id INTO v_gt_atual
        FROM public.group_transactions gt
       WHERE gt.transaction_id = NEW.id AND gt.group_id = NEW.group_id;

      IF v_gt_atual IS NOT NULL THEN
        IF public.group_split_tem_aprovada(v_gt_atual) THEN
          RAISE EXCEPTION
            'Esta despesa ja foi aprovada por alguem do grupo; mudar o valor agora apagaria essa aprovacao. Estorne a despesa e lance de novo com o valor certo.'
            USING ERRCODE = 'PDG01';
        END IF;

        PERFORM public.rerratear_despesa_de_grupo(v_gt_atual);
      END IF;
    END IF;
  END IF;

  -- ---------------------------------------------------------------------
  -- CRIACAO: o caminho do baseline, intacto. Vale para INSERT e para a edicao
  -- que acabou de apontar a despesa para um grupo novo.
  -- ---------------------------------------------------------------------
  IF NEW.group_id IS NOT NULL AND NEW.amount < 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.group_transactions
       WHERE transaction_id = NEW.id AND group_id = NEW.group_id
    ) THEN
      INSERT INTO public.group_transactions (group_id, transaction_id, split_type, created_by)
      VALUES (NEW.group_id, NEW.id, 'equal', NEW.user_id)
      RETURNING id INTO gt_id;

      SELECT COUNT(*) INTO member_count
        FROM public.group_members
       WHERE group_id = NEW.group_id AND status = 'active';

      IF member_count > 0 THEN
        -- O valor aqui e provisorio: `calculate_equal_split_trigger` e BEFORE
        -- INSERT e reescreve cada parte em centavos inteiros. Quem manda no
        -- numero final e o 007, nao esta divisao.
        split_amount := ABS(NEW.amount) / member_count;

        INSERT INTO public.group_expense_splits
          (group_transaction_id, member_id, amount, status)
        SELECT gt_id, gm.id, split_amount, 'pending'
          FROM public.group_members gm
         WHERE gm.group_id = NEW.group_id AND gm.status = 'active';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.auto_create_group_transaction() IS
  'Despesa com group_id: cria a linha de grupo e um rateio por membro ativo no INSERT, e na edicao refaz a divisao -- recalcula quando o valor muda, apaga a do grupo antigo quando o grupo muda, e recusa quando alguma parte ja foi aprovada (HMO-176).';

-- ===========================================================================
-- 4. O trigger gemeo sai de cena
-- ===========================================================================
-- Manter os dois e o que produziu o caso 2. Eles concordam na criacao (o
-- primeiro age, o segundo desiste no `IF NOT EXISTS`) e DISCORDAM na edicao,
-- e como a ordem de disparo e alfabetica -- `trigger_auto_...` antes de
-- `trigger_sync_...` -- quem chega depois encontra o trabalho feito e nunca
-- alcanca a propria limpeza.
--
-- Isto nao muda o comportamento de criacao: `trigger_auto_create_group_transaction`
-- roda primeiro e ja fazia tudo, inclusive o `created_by` que o gemeo nem
-- preenchia. O teste do 007 (secao 7) continua afirmando a criacao inteira.
DROP TRIGGER IF EXISTS trigger_sync_transaction_group ON public.financial_transactions;

-- A funcao fica, sem trigger, e passa a recusar uso: se alguem religar o
-- trigger por engano -- restaurando um dump antigo, ou colando o 001 por cima
-- --, o comportamento antigo volta em silencio e a despesa passa a ser cobrada
-- em dois grupos de novo. Falhar alto e a unica forma de isso aparecer.
CREATE OR REPLACE FUNCTION public.sync_transaction_with_group()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'sync_transaction_with_group() foi substituida por auto_create_group_transaction() no 024 (HMO-176). Este trigger nao deve existir: com os dois ligados, editar o grupo de uma despesa a cobra nos dois.'
    USING ERRCODE = 'PDG01';
END;
$$;

COMMENT ON FUNCTION public.sync_transaction_with_group() IS
  'APOSENTADA no 024 (HMO-176): era copia de auto_create_group_transaction com a limpeza do grupo antigo presa num ELSIF inalcancavel. Levanta excecao de proposito, para que religar o trigger apareca.';

COMMIT;

-- ===========================================================================
-- VERIFICACAO
-- ===========================================================================
-- Falha alto se o schema nao ficou como este arquivo diz. Roda depois do
-- COMMIT, para que o relatorio saia mesmo quando a migration ja estava
-- aplicada.
DO $$
DECLARE
  v_triggers INTEGER;
  v_definer  INTEGER;
BEGIN
  SELECT count(*) INTO v_triggers
    FROM pg_trigger
   WHERE tgrelid = 'public.financial_transactions'::regclass
     AND NOT tgisinternal
     AND tgname IN ('trigger_auto_create_group_transaction',
                    'trigger_sync_transaction_group');

  IF v_triggers <> 1 THEN
    RAISE EXCEPTION
      '024: esperava UM trigger de grupo em financial_transactions, achei %. Com dois, editar o grupo cobra nos dois.',
      v_triggers;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.financial_transactions'::regclass
       AND tgname = 'trigger_auto_create_group_transaction'
  ) THEN
    RAISE EXCEPTION '024: o trigger que sobrou nao e o certo.';
  END IF;

  -- Sem SECURITY DEFINER, quem nao e admin do grupo reescreve so a propria
  -- parte e o recalculo mente com 0 linhas atingidas.
  SELECT count(*) INTO v_definer
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('rerratear_despesa_de_grupo', 'group_split_tem_aprovada')
     AND p.prosecdef;

  IF v_definer <> 2 THEN
    RAISE EXCEPTION
      '024: as duas funcoes do recalculo precisam de SECURITY DEFINER, achei % com ele.',
      v_definer;
  END IF;

  RAISE NOTICE '024 conferido: um unico trigger de grupo, recalculo e trava em SECURITY DEFINER.';
END $$;
