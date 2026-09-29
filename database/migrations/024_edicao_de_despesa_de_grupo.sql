-- 024_edicao_de_despesa_de_grupo.sql
--
-- HMO-176: editar uma despesa que ja esta num grupo nao refaz a divisao.
--
-- Os dois estragos, reproduzidos num Postgres 17 com a cadeia 001 -> 023 em
-- cima da fixture de database/tests/group_settlement_test.sql:
--
--   1. MUDAR O VALOR DEIXA AS PARTES VELHAS.
--      Hotel de R$ 300 num grupo de 3 vira R$ 600. As partes continuam R$ 100
--      cada, e a soma dos saldos do grupo -- que TEM que ser zero -- vai para
--      R$ 300. O grupo para de fechar. Medido antes desta migration:
--          soma dos saldos = 300.00
--
--   2. TROCAR O GRUPO COBRA NOS DOIS.
--      Mover o hotel de "Viagem" para "Casa" cria a divisao no grupo novo e
--      NAO apaga a do velho. Medido antes desta migration:
--          Casa   1 parte  / R$ 600
--          Viagem 3 partes / R$ 300
--      A mesma despesa passa a ser cobrada duas vezes, de gente que nem
--      viajou junto.
--
-- A CAUSA
-- -------
-- `auto_create_group_transaction` (001_baseline.sql:143) ja e
-- AFTER INSERT OR UPDATE, entao ele RODA na edicao. So que o corpo inteiro
-- esta dentro de
--
--     IF NOT EXISTS (SELECT 1 FROM group_transactions
--                     WHERE transaction_id = NEW.id AND group_id = NEW.group_id)
--
-- Na edicao de valor esse par existe, ele sai sem fazer nada, e as partes
-- velhas ficam (caso 1). Na troca de grupo o par (transacao, grupo NOVO) nao
-- existe, entao ele insere a segunda divisao -- e deixa a primeira em paz
-- (caso 2). A constraint `unique_transaction_per_group` e (group_id,
-- transaction_id): ela impede a mesma despesa duas vezes no MESMO grupo, e
-- permite a mesma despesa em dois grupos diferentes.
--
-- `calculate_equal_split` e BEFORE **INSERT** de group_expense_splits, entao
-- ele nunca ve uma edicao: quem nao insere parte nova nao passa por ele.
--
-- A DECISAO DE PRODUTO (opcao "b", escolhida por H. Moraes na HMO-176)
-- -------------------------------------------------------------------
-- O que fazer com uma parte que alguem JA aprovou quando o valor muda:
--   a) recalcular tudo e devolver todo mundo para 'pending'  -- apaga a
--      conferencia de quem ja aprovou, sem avisar;
--   b) recalcular so as 'pending' e TRAVAR a edicao quando ja houver parte
--      aprovada;                                              <-- esta aqui
--   c) proibir editar despesa de grupo e exigir estornar e relancar.
--
-- Entao: parte aprovada e um fato que o banco nao apaga sozinho. A edicao que
-- precisaria apagar ou reescrever uma parte aprovada FALHA, com SQLSTATE
-- proprio (PDG01) para a tela dizer o que aconteceu em vez de "erro ao
-- gravar".
--
-- Hoje NENHUMA rota aprova rateio de grupo (ver o comentario da view
-- group_member_balances, na 007), entao na pratica esta trava nao vai disparar
-- para ninguem ainda. Ela existe para o dia em que a aprovacao for ligada --
-- que e exatamente o dia em que ninguem lembraria desta ordem de eventos.
--
-- O QUE A EDICAO PASSA A FAZER
-- ----------------------------
--   * valor mudou       -> as partes 'pending' sao recalculadas sobre o valor
--                          novo, entre os membros ATIVOS de hoje;
--   * grupo mudou       -> a divisao do grupo antigo e apagada (CASCADE leva
--                          as partes) e a do grupo novo e criada;
--   * saiu do grupo     -> a divisao some (group_id = NULL);
--   * virou receita     -> idem: divisao so existe para despesa (amount < 0);
--   * qualquer parte ja aprovada em algo que seria apagado ou reescrito
--                       -> a edicao inteira falha com PDG01.
--
-- Parte 'rejected' e 'expired' NAO e recalculada e NAO trava a edicao: ela ja
-- esta fora do saldo (a view do 007 exclui as duas), entao o valor gravado ali
-- e decorativo. Recalcular seria ressuscitar uma recusa.
--
-- O GEMEO QUE SAI DE CENA
-- -----------------------
-- Havia DOIS triggers quase identicos fazendo esse trabalho desde o baseline:
-- `trigger_auto_create_group_transaction` e `trigger_sync_transaction_group`.
-- Cada um so agia se o outro ainda nao tivesse agido (pelo mesmo IF NOT
-- EXISTS), o que torna "e so mexer no trigger" uma conclusao errada e facil de
-- tirar -- desligar UM nao muda nada, e foi isso que a HMO-175 registrou.
-- Consertar os dois em paralelo seria criar a proxima deriva. Esta migration
-- deixa UM caminho: o trabalho vira uma funcao normal
-- (`refazer_rateio_do_grupo`), `auto_create_group_transaction` passa a ser uma
-- casca que a chama, e o gemeo e dropado.
--
-- POR QUE SECURITY DEFINER (e o que isso NAO abre)
-- ------------------------------------------------
-- Quem edita a despesa e o dono dela, que quase nunca e admin do grupo. E as
-- policies da 002 dizem:
--   * DELETE em group_expense_splits  -> so is_group_admin;
--   * UPDATE em group_expense_splits  -> so a propria parte, ou admin;
--   * DELETE em group_transactions    -> so created_by = auth.uid() ou admin,
--     e as linhas criadas pelo gemeo e pela rota antiga tem created_by NULL.
-- Em SECURITY INVOKER o conserto nao falharia: ele afetaria ZERO linhas, em
-- silencio, e so para quem nao e admin. Verde no teste rodado como postgres,
-- quebrado para o usuario de verdade -- a armadilha que a 003 e a 004 ja
-- pegaram neste banco.
--
-- O que impede o abuso do DEFINER, ja que a funcao (ao contrario de um trigger)
-- e chamavel direto pelo PostgREST:
--   1. ela le user_id, group_id e amount da PROPRIA transacao -- nao aceita
--      valor por parametro, entao nao da para mandar rateio de R$ 10.000 numa
--      despesa de R$ 10;
--   2. ela exige auth.uid() = dono da transacao (auth.uid() nulo = trigger
--      rodando por service_role/psql);
--   3. EXECUTE revogado de PUBLIC, anon e authenticated -- os tres, porque no
--      Supabase revogar so de PUBLIC nao tira o grant explicito que anon e
--      authenticated ja tem.
-- Os parametros que sobram (grupo e valor ANTIGOS) so servem para detectar o
-- que mudou; mentir neles no maximo forca um recalculo que chega no mesmo
-- resultado.
--
-- REPARO DOS DADOS QUE JA ESTAO ERRADOS
-- -------------------------------------
-- A SECAO 4 desfaz as duas sujeiras que as edicoes ja feitas deixaram: divisao
-- em grupo que contradiz o group_id da transacao (a cobranca dupla) e partes
-- que nao somam o valor da despesa. Ela pula tudo que tenha parte aprovada --
-- a mesma regra da opcao (b) -- e nao inventa linha nenhuma onde nao havia
-- divisao.
--
-- Idempotente: pode rodar duas vezes seguidas sem erro.
-- Cola como lote unico no SQL Editor (nenhum meta-comando de psql aqui).

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Pre-requisitos
-- ---------------------------------------------------------------------------
-- Falhar aqui, com nome, e melhor do que falhar la embaixo com "relation does
-- not exist" no meio de um CREATE FUNCTION de 100 linhas.
DO $$
DECLARE
  v_faltando TEXT;
BEGIN
  SELECT string_agg(msg, E'\n') INTO v_faltando
  FROM (
    SELECT '  - tabela public.group_transactions' AS msg
    WHERE to_regclass('public.group_transactions') IS NULL
    UNION ALL
    SELECT '  - tabela public.group_expense_splits'
    WHERE to_regclass('public.group_expense_splits') IS NULL
    UNION ALL
    SELECT '  - funcao public.calculate_equal_split() (vem do 001, corrigida no 007)'
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'calculate_equal_split'
    )
  ) AS checks
  WHERE msg IS NOT NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'024 nao pode ser aplicado neste banco. Faltando:\n%\n\nRode 001 -> ... -> 007 antes.', v_faltando;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. recalcular_partes_pendentes() -- a conta do dinheiro, num lugar so
-- ---------------------------------------------------------------------------
-- Rateio igualitario: APAGA as partes pendentes e insere de novo, para que o
-- BEFORE INSERT `calculate_equal_split` (corrigido no 007) faca a conta. Isso
-- e de proposito: o metodo do maior resto -- centavos inteiros, o resto
-- distribuido pela ordem de group_members.id -- e a unica implementacao de
-- divisao deste banco, e copiar a formula para ca criaria a segunda, que um
-- dia discordaria da primeira em algum centavo.
--
-- As colunas percentage e amount vao com valor de fachada (100 e 0) no INSERT:
-- as duas sao NOT NULL, e o BEFORE INSERT troca as duas antes de o NOT NULL ser
-- avaliado. E o mesmo truque que o trigger do baseline ja usava para percentage.
--
-- Rateio combinado (percentage / custom / proporcional a renda): NAO pode
-- virar divisao igual -- foi exatamente isso que a 007 consertou. Aqui a parte
-- pendente e reescalada pela porcentagem que ficou gravada, que e o que
-- "combinamos 70/30" quer dizer quando a conta muda de tamanho.
--
-- Parte que nao esta 'pending' nao e tocada nos dois caminhos.
CREATE OR REPLACE FUNCTION public.recalcular_partes_pendentes(p_group_transaction_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_split_type TEXT;
  v_total NUMERIC;
  v_partes INTEGER := 0;
BEGIN
  SELECT gt.split_type, ABS(ft.amount)
    INTO v_split_type, v_total
    FROM public.group_transactions gt
    JOIN public.financial_transactions ft ON ft.id = gt.transaction_id
   WHERE gt.id = p_group_transaction_id;

  -- Ligacao orfa (a transacao sumiu no meio do caminho): nao ha valor para
  -- dividir, e inventar zero seria pior do que nao fazer nada.
  IF v_total IS NULL THEN
    RETURN 0;
  END IF;

  IF v_split_type = 'equal' THEN
    DELETE FROM public.group_expense_splits
     WHERE group_transaction_id = p_group_transaction_id
       AND status = 'pending';

    -- Membro ativo que JA tem parte aqui (recusada ou expirada) nao ganha uma
    -- segunda linha: a recusa dele continua valendo, e o saldo do grupo ja
    -- conta a ausencia dela.
    INSERT INTO public.group_expense_splits
      (group_transaction_id, member_id, percentage, amount, status)
    SELECT p_group_transaction_id, gm.id, 100, 0, 'pending'
      FROM public.group_members gm
      JOIN public.group_transactions gt ON gt.group_id = gm.group_id
     WHERE gt.id = p_group_transaction_id
       AND gm.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM public.group_expense_splits es
          WHERE es.group_transaction_id = p_group_transaction_id
            AND es.member_id = gm.id
       );

    GET DIAGNOSTICS v_partes = ROW_COUNT;
  ELSE
    UPDATE public.group_expense_splits es
       SET amount = ROUND(v_total * (es.percentage / 100.0), 2),
           updated_at = now()
     WHERE es.group_transaction_id = p_group_transaction_id
       AND es.status = 'pending';

    GET DIAGNOSTICS v_partes = ROW_COUNT;
  END IF;

  RETURN v_partes;
END;
$$;

COMMENT ON FUNCTION public.recalcular_partes_pendentes(uuid) IS
  'Refaz as partes pendentes de uma divisao sobre o valor atual da despesa. Igualitaria: apaga e reinsere, para o calculate_equal_split fazer a conta em centavos. Combinada: reescala pela porcentagem gravada. Nao toca em parte aprovada, recusada ou expirada.';

REVOKE EXECUTE ON FUNCTION public.recalcular_partes_pendentes(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. refazer_rateio_do_grupo() -- o que a edicao faz, inteiro
-- ---------------------------------------------------------------------------
-- Recebe a transacao e o estado ANTIGO (grupo e valor). Le o estado novo da
-- propria linha -- ver a nota sobre SECURITY DEFINER no cabecalho.
CREATE OR REPLACE FUNCTION public.refazer_rateio_do_grupo(
  p_transaction_id uuid,
  p_group_id_antigo uuid DEFAULT NULL,
  p_valor_antigo numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_group_id uuid;
  v_amount NUMERIC;
  v_alvo uuid;
  v_alvo_antigo uuid;
  v_mudou_grupo BOOLEAN;
  v_mudou_valor BOOLEAN;
  v_gt uuid;
BEGIN
  SELECT ft.user_id, ft.group_id, ft.amount
    INTO v_user_id, v_group_id, v_amount
    FROM public.financial_transactions ft
   WHERE ft.id = p_transaction_id;

  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Chamada DIRETA (fora de trigger) por alguem que nao e o dono da despesa
  -- nao passa. Dentro de trigger a checagem nao se repete, e isso e
  -- deliberado: para o trigger disparar, o comando em financial_transactions
  -- ja passou pela RLS daquela tabela, que so deixa o dono escrever. Repetir a
  -- checagem ali quebraria toda escrita feita com um claim que nao e o do dono
  -- -- o backfill de uma migration, uma manutencao por psql numa sessao que
  -- ainda tem `request.jwt.claim.sub` de outra pessoa -- com um erro que nao
  -- tem nada a ver com o que a pessoa estava fazendo.
  IF pg_trigger_depth() = 0 AND auth.uid() IS NOT NULL AND auth.uid() <> v_user_id THEN
    RAISE EXCEPTION 'so o dono do lancamento pode refazer o rateio dele'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Divisao de grupo existe para DESPESA lancada num grupo. Receita no grupo
  -- nao e alguem pagando a conta do restaurante (a view do 007 ja faz essa
  -- distincao para o "pago"), e valor zero nao tem o que dividir.
  v_alvo        := CASE WHEN v_group_id        IS NOT NULL AND v_amount       < 0 THEN v_group_id        END;
  v_alvo_antigo := CASE WHEN p_group_id_antigo IS NOT NULL AND p_valor_antigo < 0 THEN p_group_id_antigo END;

  v_mudou_grupo := v_alvo IS DISTINCT FROM v_alvo_antigo;
  v_mudou_valor := p_valor_antigo IS NOT NULL AND p_valor_antigo IS DISTINCT FROM v_amount;

  -- ------------------------------------------------------------------
  -- 2a. As duas travas da opcao (b), ANTES de qualquer escrita
  -- ------------------------------------------------------------------
  IF v_mudou_grupo AND EXISTS (
       SELECT 1
         FROM public.group_expense_splits es
         JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
        WHERE gt.transaction_id = p_transaction_id
          AND (v_alvo IS NULL OR gt.group_id <> v_alvo)
          AND es.status = 'approved'
     ) THEN
    RAISE EXCEPTION 'Alguem ja aprovou a parte desta despesa no grupo atual. Tirar ela dali apagaria essa aprovacao: estorne e relance, ou peca para reabrir a aprovacao.'
      USING ERRCODE = 'PDG01';
  END IF;

  IF v_mudou_valor AND v_alvo IS NOT NULL AND EXISTS (
       SELECT 1
         FROM public.group_expense_splits es
         JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
        WHERE gt.transaction_id = p_transaction_id
          AND gt.group_id = v_alvo
          AND es.status = 'approved'
     ) THEN
    RAISE EXCEPTION 'Alguem ja aprovou a parte desta despesa no grupo. Mudar o valor mudaria o que essa pessoa aprovou: estorne e relance, ou peca para reabrir a aprovacao.'
      USING ERRCODE = 'PDG01';
  END IF;

  -- ------------------------------------------------------------------
  -- 2b. Tirar a despesa dos grupos onde ela nao esta mais
  -- ------------------------------------------------------------------
  -- Condicionado a v_mudou_grupo de proposito. Sem isso, uma edicao de
  -- descricao apagaria a ligacao de uma despesa POSITIVA de grupo -- que a
  -- rota da tela de grupo cria pela rede de seguranca dela, e que nenhum
  -- trigger recriaria depois.
  IF v_mudou_grupo THEN
    DELETE FROM public.group_transactions gt
     WHERE gt.transaction_id = p_transaction_id
       AND (v_alvo IS NULL OR gt.group_id <> v_alvo);
  END IF;

  IF v_alvo IS NULL THEN
    RETURN;
  END IF;

  SELECT gt.id INTO v_gt
    FROM public.group_transactions gt
   WHERE gt.transaction_id = p_transaction_id
     AND gt.group_id = v_alvo;

  -- ------------------------------------------------------------------
  -- 2c. Grupo novo (ou despesa nova): cria a ligacao e as partes
  -- ------------------------------------------------------------------
  IF v_gt IS NULL THEN
    INSERT INTO public.group_transactions (group_id, transaction_id, split_type, created_by)
    VALUES (v_alvo, p_transaction_id, 'equal', v_user_id)
    RETURNING id INTO v_gt;

    INSERT INTO public.group_expense_splits
      (group_transaction_id, member_id, percentage, amount, status)
    SELECT v_gt, gm.id, 100, 0, 'pending'
      FROM public.group_members gm
     WHERE gm.group_id = v_alvo
       AND gm.status = 'active';

    RETURN;
  END IF;

  -- ------------------------------------------------------------------
  -- 2d. Mesmo grupo, valor novo: refaz as partes pendentes
  -- ------------------------------------------------------------------
  IF v_mudou_valor THEN
    PERFORM public.recalcular_partes_pendentes(v_gt);
  END IF;
END;
$$;

COMMENT ON FUNCTION public.refazer_rateio_do_grupo(uuid, uuid, numeric) IS
  'Poe a divisao de uma despesa em dia com o grupo e o valor atuais dela: cria, move, apaga e recalcula. Falha com SQLSTATE PDG01 quando a edicao precisaria apagar ou reescrever uma parte ja aprovada.';

REVOKE EXECUTE ON FUNCTION public.refazer_rateio_do_grupo(uuid, uuid, numeric) FROM PUBLIC;

-- Revogar so de PUBLIC nao basta no Supabase: anon e authenticated recebem
-- EXECUTE explicito por default (ALTER DEFAULT PRIVILEGES do projeto), e grant
-- explicito nao e alcancado por REVOKE ... FROM PUBLIC. Nomear os dois e o que
-- fecha a porta. O DO cobre o banco local, onde esses roles podem nao existir.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.recalcular_partes_pendentes(uuid) FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.refazer_rateio_do_grupo(uuid, uuid, numeric) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.recalcular_partes_pendentes(uuid) FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.refazer_rateio_do_grupo(uuid, uuid, numeric) FROM authenticated';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. O trigger que sobra, e o gemeo que sai
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER tambem aqui, e nao por causa das tabelas: a casca precisa
-- CHAMAR refazer_rateio_do_grupo(), e o EXECUTE dessa funcao foi revogado de
-- authenticated logo acima. Em SECURITY INVOKER a casca roda como o usuario da
-- sessao e bate em "permission denied for function refazer_rateio_do_grupo" na
-- primeira despesa de grupo -- o teste 024 pegou exatamente isso. Como DEFINER
-- ela roda como o dono, que tem o EXECUTE.
--
-- Isto muda o que a 004 registrou sobre esta funcao ("fica como esta", em
-- SECURITY INVOKER). O que a 004 auditou foi o acesso as TABELAS; o motivo
-- novo e a chamada de funcao. Chamar a casca direto continua impossivel pelo
-- tipo de retorno `trigger`, e a regra de quem pode mexer em que rateio esta
-- dentro de refazer_rateio_do_grupo(), que checa auth.uid() contra o dono da
-- transacao -- e auth.uid() le o JWT, que SECURITY DEFINER nao troca.
CREATE OR REPLACE FUNCTION public.auto_create_group_transaction() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.refazer_rateio_do_grupo(NEW.id, NULL, NULL);
  ELSE
    PERFORM public.refazer_rateio_do_grupo(NEW.id, OLD.group_id, OLD.amount);
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.auto_create_group_transaction() IS
  'Casca do trigger de financial_transactions: passa o estado antigo para refazer_rateio_do_grupo(). A regra inteira mora la.';

-- O gemeo. Nao ha rota nem cron que o chame -- so comentarios no codigo, que
-- esta migration acompanha. Dropar o trigger antes da funcao, senao o DROP
-- falha por dependencia.
DROP TRIGGER IF EXISTS trigger_sync_transaction_group ON public.financial_transactions;
DROP FUNCTION IF EXISTS public.sync_transaction_with_group();

-- O trigger que fica. Recriado por nome para o caso de um banco onde ele nao
-- exista (ou exista com outro escopo de evento).
DROP TRIGGER IF EXISTS trigger_auto_create_group_transaction ON public.financial_transactions;
CREATE TRIGGER trigger_auto_create_group_transaction
  AFTER INSERT OR UPDATE ON public.financial_transactions
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_group_transaction();

-- ---------------------------------------------------------------------------
-- 4. Reparo do que as edicoes ja quebraram
-- ---------------------------------------------------------------------------
-- Idempotente e conservador: nao cria divisao onde nao havia, nao mexe em nada
-- que tenha parte aprovada, e nao encosta em transacao sem group_id (essa
-- coluna e a fonte da verdade desde o backfill da SECAO 4 da 007).
--
-- A ordem importa nas duas pontas: a cobranca dupla tem que sumir ANTES do
-- recalculo (senao recalcularia partes de uma ligacao que vai ser apagada em
-- seguida) e antes do indice unico da SECAO 5, que nao nasce enquanto houver
-- despesa em dois grupos.
DO $$
DECLARE
  v_duplas INTEGER := 0;
  v_recalculadas INTEGER := 0;
  v_pulou_aprovada INTEGER := 0;
  r RECORD;
BEGIN
  -- 4a. Divisao num grupo que nao e o grupo da despesa.
  WITH alvo AS (
    SELECT gt.id
      FROM public.group_transactions gt
      JOIN public.financial_transactions ft ON ft.id = gt.transaction_id
     WHERE ft.group_id IS NOT NULL
       AND gt.group_id <> ft.group_id
       AND NOT EXISTS (
         SELECT 1 FROM public.group_expense_splits es
          WHERE es.group_transaction_id = gt.id AND es.status = 'approved'
       )
  ), apagadas AS (
    DELETE FROM public.group_transactions gt
     USING alvo WHERE gt.id = alvo.id
     RETURNING 1
  )
  SELECT count(*) INTO v_duplas FROM apagadas;

  -- 4b. Partes que nao somam o valor da despesa.
  --     So quando TODAS as partes sao pendentes: com uma recusada, a soma
  --     menor e o estado correto, nao a sobra do caso 1.
  FOR r IN
    SELECT gt.id
      FROM public.group_transactions gt
      JOIN public.financial_transactions ft ON ft.id = gt.transaction_id
      JOIN public.group_expense_splits es ON es.group_transaction_id = gt.id
     WHERE ft.amount < 0
     GROUP BY gt.id, ft.amount
    HAVING count(*) FILTER (WHERE es.status <> 'pending') = 0
       AND SUM(es.amount) <> ABS(ft.amount)
  LOOP
    PERFORM public.recalcular_partes_pendentes(r.id);
    v_recalculadas := v_recalculadas + 1;
  END LOOP;

  -- 4c. O que ficou de fora, para aparecer no log de quem aplicar.
  SELECT count(DISTINCT gt.id) INTO v_pulou_aprovada
    FROM public.group_transactions gt
    JOIN public.financial_transactions ft ON ft.id = gt.transaction_id
    JOIN public.group_expense_splits es ON es.group_transaction_id = gt.id
   WHERE es.status = 'approved'
     AND (gt.group_id IS DISTINCT FROM ft.group_id
          OR (ft.amount < 0 AND (SELECT SUM(x.amount)
                                   FROM public.group_expense_splits x
                                  WHERE x.group_transaction_id = gt.id) <> ABS(ft.amount)));

  RAISE NOTICE '024 reparo: % cobranca(s) dupla apagada(s), % divisao(oes) recalculada(s), % pulada(s) por ter parte aprovada.',
    v_duplas, v_recalculadas, v_pulou_aprovada;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Uma despesa mora em UM grupo
-- ---------------------------------------------------------------------------
-- `unique_transaction_per_group` e (group_id, transaction_id): ela impede a
-- mesma despesa duas vezes no MESMO grupo e permite a mesma despesa em dois
-- grupos diferentes -- que e exatamente a forma do caso 2. A coluna
-- financial_transactions.group_id e singular, entao o indice que descreve a
-- realidade e por transaction_id.
--
-- Indice CHEIO, nao parcial: indice parcial nao serve de arbitro de
-- ON CONFLICT pelo supabase-js, que nao manda o predicado junto.
--
-- A constraint antiga fica: ela e mais fraca que este indice, nao conflita com
-- ele, e derruba-la exigiria conferir quem depende do indice dela.
--
-- O indice NAO e condicao do conserto -- quem impede a cobranca dupla e a
-- SECAO 2b. Ele e a rede embaixo. Por isso, se sobrar alguma despesa em dois
-- grupos que a SECAO 4 nao pode desfazer (parte ja aprovada dos dois lados),
-- esta migration avisa em vez de abortar: abortar deixaria o banco sem o
-- conserto por causa da rede.
DO $$
DECLARE
  v_duplicadas INTEGER;
  v_lista TEXT;
BEGIN
  SELECT count(*), string_agg(transaction_id::text, ', ')
    INTO v_duplicadas, v_lista
    FROM (
      SELECT transaction_id
        FROM public.group_transactions
       GROUP BY transaction_id
      HAVING count(*) > 1
    ) AS d;

  IF v_duplicadas > 0 THEN
    RAISE WARNING E'024: % despesa(s) continuam divididas em mais de um grupo e o indice unico NAO foi criado.\nResolva a mao (a parte aprovada e que trava o reparo automatico) e rode depois:\n  CREATE UNIQUE INDEX uniq_group_transactions_transaction ON public.group_transactions (transaction_id);\nDespesas: %',
      v_duplicadas, v_lista;
  ELSE
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uniq_group_transactions_transaction ON public.group_transactions (transaction_id)';
    EXECUTE $c$COMMENT ON INDEX public.uniq_group_transactions_transaction IS 'Uma despesa so pode estar dividida em um grupo. Sem isto, editar o grupo de uma despesa a cobra nos dois (HMO-176).'$c$;
  END IF;
END $$;

COMMIT;

-- =====================================================
-- VERIFICACAO (rodar depois do COMMIT)
-- =====================================================
-- 1. So um trigger de grupo em financial_transactions:
--
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.financial_transactions'::regclass AND NOT tgisinternal;
--
--   Nao pode haver `trigger_sync_transaction_group` na lista.
--
-- 2. As duas funcoes novas, em SECURITY DEFINER e com search_path preso:
--
--   SELECT proname, prosecdef, proconfig FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND proname IN ('refazer_rateio_do_grupo', 'recalcular_partes_pendentes');
--
-- 3. Nenhuma despesa dividida em dois grupos (tem que voltar 0 linhas):
--
--   SELECT transaction_id, count(*) FROM public.group_transactions
--    GROUP BY transaction_id HAVING count(*) > 1;
--
-- 4. Toda divisao so-pendente somando o valor da despesa (0 linhas):
--
--   SELECT gt.id, ABS(ft.amount) AS despesa, SUM(es.amount) AS partes
--     FROM public.group_transactions gt
--     JOIN public.financial_transactions ft ON ft.id = gt.transaction_id
--     JOIN public.group_expense_splits es ON es.group_transaction_id = gt.id
--    WHERE ft.amount < 0
--    GROUP BY gt.id, ft.amount
--   HAVING count(*) FILTER (WHERE es.status <> 'pending') = 0
--      AND SUM(es.amount) <> ABS(ft.amount);
--
-- O teste automatizado e database/tests/024_edicao_de_despesa_de_grupo_test.sql.
