-- ===========================================================================
-- 055 -- O "PAGO" DE UMA CONTA DE GRUPO E DA PESSOA, NAO DO GRUPO (HMO-407/410)
-- ===========================================================================
-- Parte 1 (a metade de BANCO) do plano aprovado da HMO-407. O codigo de app --
-- as oito leituras, a rota do gesto do membro e as duas telas -- esta na
-- issue-irma, que esta bloqueada por esta. Esta migration nao tem leitor
-- nenhum ainda, por desenho: ela e ADITIVA, e colar com a `main` "velha" e
-- inofensivo (ver o fim deste cabecalho).
--
-- Medida nesta cadeia local (001 -> ... -> 054) antes de ser escrita.
--
-- O SINTOMA, EM DUAS LINHAS
-- -------------------------
--   1. o Helio paga a conta do grupo Casa e ela DESAPARECE do «a pagar» da
--      Lais e da Ana, que nao pagaram nada;
--   2. a Lais nao tem como dizer que pagou: `POST .../{id}/pay` filtra
--      `.eq("user_id", user.id)` e responde 404 para quem nao e o dono.
--
-- A CAUSA, PARA O CONSERTO NAO VIRAR INVENCAO
-- -------------------------------------------
-- `scheduled_transactions` tem **uma** coluna `status`
-- (`005_recurring_and_scheduled.sql:197`) e **um** `user_id`. Uma conta do grupo
-- Casa e UMA linha, do dono dela. A policy de LEITURA libera o grupo inteiro
-- (`005:310-316`):
--
--     USING ( user_id = auth.uid()
--             OR (group_id IS NOT NULL AND public.is_group_member(group_id)) )
--
-- e a de ESCRITA nao (`005:321-325`): `USING (user_id = auth.uid())`.
--
-- Dessas duas linhas saem os DOIS sintomas, e os dois sao a MESMA causa: um
-- status so, compartilhado, que e o status do DONO. Nao ha defeito de dinheiro
-- aqui -- o rateio (`group_share_entries`) ja esta certo. O que falta e um
-- estado POR PESSOA.
--
-- E o GRUPO nao ganha status nenhum, e isso esta certo: a aba de previstas do
-- grupo le `.neq("status","paid")` porque a baixa cria a transacao real e o
-- rateio, e a conta passa a aparecer na aba de despesas.
--
-- O MOLDE JA EXISTE: O MYBANK (053)
-- ---------------------------------
-- A HMO-369/386 resolveu "a parcela que eu devo a outra pessoa" com
-- `pending -> reported -> paid`, e com DUAS pecas prendendo o lado de quem deve:
-- a policy (`053:662-668`) e uma trigger de trava (`053:536-569`). Este arquivo
-- copia as duas. A secao 4 abaixo diz por que a trigger NAO e redundante AQUI
-- -- o argumento da 053 (`amount`) nao se aplica a esta tabela, e o que a
-- substitui e outro, concreto e medido.
--
-- O QUE ENTRA
-- -----------
--   SECAO 1  preflight: o que esta migration precisa encontrar de pe
--   SECAO 2  a tabela `group_bill_payments`
--   SECAO 3  RLS: as quatro policies
--   SECAO 4  a trigger de trava (e por que a policy sozinha nao basta)
--   SECAO 5  a view ganha `my_status` e `my_effective_status` NO FIM
--   SECAO 6  grants
--
-- LINHA AUSENTE = `pending`, E ISSO E O DESENHO
-- ---------------------------------------------
-- Nenhum backfill semeia esta tabela. Ela nasce VAZIA, com as contas de grupo
-- todas em producao, e tem de funcionar assim: a view resolve a ausencia com
-- `COALESCE(p.status, 'pending')`, igual ao `COALESCE(p.days_before, 3)` do
-- `bill_alerts` (`047_aviso_por_email.sql:158`). Sem esse COALESCE a feature
-- "funciona" -- SQL valido, nenhum erro -- entregando NULL para toda conta de
-- grupo que ninguem tocou, e as telas leriam NULL como "nao e pendente".
--
-- POR QUE `CREATE OR REPLACE VIEW` E NAO `DROP VIEW` (a 027 precisou do DROP)
-- --------------------------------------------------------------------------
-- As duas colunas entram NO FIM. `CREATE OR REPLACE VIEW` so aceita acrescentar
-- coluna no fim, e a 027 precisou de `DROP` porque o `SELECT s.*` do 005 tinha
-- sido EXPANDIDO na criacao e a coluna nova cairia no meio. A 027 enumerou as
-- colunas uma a uma; por isso aqui o REPLACE basta. E `DROP` nao serve: ONZE
-- consultas dependem desta view (`bill_alerts` da 050 e `planned_vs_actual` da
-- 054 entre elas), e o DROP ... CASCADE as levaria embora.
--
-- O PASSO HUMANO: ESTA MIGRATION E ADITIVA
-- ----------------------------------------
-- Ela cria uma tabela nova e ACRESCENTA duas colunas no fim de uma view. Nao
-- altera, nao apaga e nao renomeia nada que exista. O codigo que esta em
-- producao hoje nao le `group_bill_payments` nem as duas colunas novas --
-- nenhum leitor existe ainda, nem neste PR --, entao colar este SQL com a
-- `main` "velha" nao muda uma linha do que o app faz. A ordem nao importa.
-- ===========================================================================

-- ===========================================================================
-- SECAO 1: PREFLIGHT
-- ===========================================================================
-- A view e recolada INTEIRA aqui (obrigacao do `CREATE OR REPLACE`), partindo
-- da definicao da 027. Se o banco estiver numa posicao anterior a 027 este
-- arquivo RECUARIA a view -- apagando `direction`, `transaction_type` e
-- `currency` -- e o `planned_vs_actual` da 043/045/054 quebraria junto, porque
-- os dois `SUM(...) FILTER` dele leem `s.direction`. Abortar aqui e mais barato
-- do que descobrir depois.
DO $$
DECLARE
  v_faltando text := '';
BEGIN
  IF to_regclass('public.scheduled_transactions_effective') IS NULL THEN
    v_faltando := v_faltando || E'\n  - view public.scheduled_transactions_effective (vem do 005, refeita pela 027)';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'scheduled_transactions_effective'
       AND column_name  = 'direction'
  ) THEN
    v_faltando := v_faltando || E'\n  - coluna direction em public.scheduled_transactions_effective (vem do 027)';
  END IF;

  IF to_regclass('public.scheduled_transactions') IS NULL THEN
    v_faltando := v_faltando || E'\n  - tabela public.scheduled_transactions (vem do 005)';
  END IF;

  IF to_regclass('public.group_members') IS NULL THEN
    v_faltando := v_faltando || E'\n  - tabela public.group_members (vem do 001)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'is_group_member'
  ) THEN
    v_faltando := v_faltando || E'\n  - funcao public.is_group_member (vem do 002)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column'
  ) THEN
    v_faltando := v_faltando || E'\n  - funcao public.update_updated_at_column (vem do 001)';
  END IF;

  IF v_faltando <> '' THEN
    RAISE EXCEPTION E'055 ABORTADA -- o banco nao esta na posicao esperada (001 -> ... -> 054). Falta:%s', v_faltando;
  END IF;
END $$;

-- ===========================================================================
-- SECAO 2: A TABELA
-- ===========================================================================
-- Uma linha por (conta prevista, pessoa). A UNIQUE nao e so higiene: a view da
-- SECAO 5 entra num LEFT JOIN com esta tabela, e e a UNIQUE que garante que o
-- join nao MULTIPLIQUE a linha da agenda. Sem ela, duas linhas de pagamento da
-- mesma conta dobrariam toda conta prevista de grupo nas onze consultas que
-- leem a view -- e o sintoma seria dinheiro contado duas vezes, nao erro.
--
-- `status` e `text` com CHECK, e nao um enum novo, pelo mesmo motivo da 053:
-- `pending -> reported -> paid` e a maquina de estados DESTA tabela, e nao tem
-- relacao com `scheduled_status` (que tem `skipped`, `cancelled` e `overdue` e
-- nao tem `reported`). Enfiar `reported` no enum existente mudaria o dominio da
-- coluna `status` de `scheduled_transactions` e de todo CHECK que a le.
CREATE TABLE IF NOT EXISTS public.group_bill_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scheduled_transaction_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    reported_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT group_bill_payments_pkey PRIMARY KEY (id),
    -- a chave de verdade; ver o paragrafo acima
    CONSTRAINT group_bill_payments_unico UNIQUE (scheduled_transaction_id, user_id),
    CONSTRAINT group_bill_payments_status_check
      CHECK (status IN ('pending', 'reported', 'paid')),
    -- Os carimbos acompanham o estado, no molde do
    -- `scheduled_transactions_paid_check` do 005. Isto e o que impede
    -- `status = 'reported'` sem `reported_at` -- a tela do grupo mostra "a Lais
    -- avisou que pagou" COM a data, e uma linha sem carimbo viraria "avisou em
    -- --/--/----". `paid` nao exige `reported_at`: o dono pode dar a parte de
    -- alguem por paga sem que a pessoa tenha avisado.
    CONSTRAINT group_bill_payments_carimbos_check CHECK (
         (status = 'pending'  AND reported_at IS NULL     AND confirmed_at IS NULL)
      OR (status = 'reported' AND reported_at IS NOT NULL AND confirmed_at IS NULL)
      OR (status = 'paid'     AND confirmed_at IS NOT NULL)
    ),
    CONSTRAINT group_bill_payments_scheduled_fkey
      FOREIGN KEY (scheduled_transaction_id)
      REFERENCES public.scheduled_transactions(id) ON DELETE CASCADE,
    CONSTRAINT group_bill_payments_user_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.group_bill_payments IS
  'O estado de pagamento de UMA conta prevista de grupo POR PESSOA (HMO-407). scheduled_transactions tem um status so, e ele e do DONO: quando o dono paga, a conta saia do «a pagar» de todo mundo. LINHA AUSENTE = pending, resolvido por COALESCE em scheduled_transactions_effective.my_status -- a tabela nasce vazia e nenhum backfill a semeia. pending -> reported -> paid no molde de mybank_installments (053): o membro so leva pending -> reported, e quem prende isso sao a policy MAIS a trigger group_bill_payments_trava_do_membro.';

COMMENT ON COLUMN public.group_bill_payments.status IS
  'pending (ou linha ausente) = nao pagou; reported = o membro avisou que pagou; paid = o dono da conta prevista confirmou. Nao e public.scheduled_status: aquele enum nao tem reported, e tem skipped/cancelled/overdue, que nao se aplicam a parte de uma pessoa.';

COMMENT ON COLUMN public.group_bill_payments.confirmed_at IS
  'Quando o DONO da conta prevista confirmou. So o dono escreve isto -- a trigger pina a coluna do lado do membro, e e por isso que reported -> paid nao e alcancavel por quem avisou.';

-- O join da view e por (scheduled_transaction_id, user_id), que a UNIQUE ja
-- indexa. Este indice e para o outro sentido -- "as minhas linhas" --, que e o
-- que a tela do membro e a policy de SELECT percorrem.
CREATE INDEX IF NOT EXISTS idx_group_bill_payments_user
  ON public.group_bill_payments (user_id, status);

DROP TRIGGER IF EXISTS group_bill_payments_touch_updated_at ON public.group_bill_payments;
CREATE TRIGGER group_bill_payments_touch_updated_at
  BEFORE UPDATE ON public.group_bill_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===========================================================================
-- SECAO 3: RLS
-- ===========================================================================
ALTER TABLE public.group_bill_payments ENABLE ROW LEVEL SECURITY;

-- SELECT: o dono da LINHA e o dono da CONTA PREVISTA. Mais ninguem -- nem os
-- outros membros do grupo.
--
-- Nao se escreve isto com `is_group_member(s.group_id)`: a policy de SELECT de
-- `scheduled_transactions` usa esse OR, e copiar a forma aqui entregaria a linha
-- de pagamento de QUALQUER membro a qualquer outro. Quem precisa ver o estado do
-- grupo inteiro e o dono da conta -- e e por isso que a tela "Helio pagou · Lais
-- avisou que pagou · Ana pendente" e do dono.
DROP POLICY IF EXISTS group_bill_payments_select ON public.group_bill_payments;
CREATE POLICY group_bill_payments_select ON public.group_bill_payments
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.scheduled_transactions s
       WHERE s.id = group_bill_payments.scheduled_transaction_id
         AND s.user_id = auth.uid()
    )
  );

-- INSERT: so a propria linha, so numa conta prevista de GRUPO de que eu sou
-- membro ATIVO (`is_group_member` ja exige `status = 'active'`, 002:226), e so
-- nascendo em `pending` ou `reported`.
--
-- A conferencia de pertencimento esta aqui e nao so na RLS de leitura porque o
-- `scheduled_transaction_id` e um uuid que o cliente manda: sem ela, qualquer
-- autenticado cria uma linha apontando para a conta prevista de um estranho, e o
-- estranho ve "esta pessoa avisou que pagou a minha conta" na tela do grupo.
--
-- `status = 'paid'` NAO cabe aqui: quem da uma parte por paga e o dono da conta
-- prevista, e ele chega por UPDATE numa linha que ja existe.
DROP POLICY IF EXISTS group_bill_payments_insert ON public.group_bill_payments;
CREATE POLICY group_bill_payments_insert ON public.group_bill_payments
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status IN ('pending', 'reported')
    AND EXISTS (
      SELECT 1 FROM public.scheduled_transactions s
       WHERE s.id = group_bill_payments.scheduled_transaction_id
         AND s.group_id IS NOT NULL
         AND public.is_group_member(s.group_id)
    )
  );

-- UPDATE: duas metades OR-adas.
--
--   * o MEMBRO, so na propria linha e so `pending -> reported`. O `USING` ve a
--     linha ANTIGA (exige `pending`) e o `WITH CHECK` a NOVA (exige `reported`
--     com carimbo), e esse par JA prende a transicao -- diferente da 053, onde
--     a transicao precisou da trigger;
--   * o DONO da conta prevista, em qualquer campo. E ele que confirma
--     (`reported -> paid`, gravando `confirmed_at`) e que pode dar a parte de
--     alguem por paga direto. Sem esta metade `paid` seria um estado que o CHECK
--     aceita e ninguem consegue escrever -- uma coluna (`confirmed_at`) sem
--     escritor, que nesta base e o mesmo que nao existir.
DROP POLICY IF EXISTS group_bill_payments_update ON public.group_bill_payments;
CREATE POLICY group_bill_payments_update ON public.group_bill_payments
  FOR UPDATE TO authenticated
  USING (
    (user_id = auth.uid() AND status = 'pending')
    OR EXISTS (
      SELECT 1 FROM public.scheduled_transactions s
       WHERE s.id = group_bill_payments.scheduled_transaction_id
         AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    (user_id = auth.uid() AND status = 'reported' AND reported_at IS NOT NULL)
    OR EXISTS (
      SELECT 1 FROM public.scheduled_transactions s
       WHERE s.id = group_bill_payments.scheduled_transaction_id
         AND s.user_id = auth.uid()
    )
  );

-- DELETE: a propria linha, enquanto o dono nao confirmou.
--
-- E o DESFAZER, e ele existe por causa do COALESCE da view: apagar a linha e
-- voltar para `pending`, porque linha ausente E `pending`. Sem esta policy, o
-- membro que clicou "avisar que paguei" por engano fica em `reported` para
-- sempre -- a policy de UPDATE exige `pending` no `USING`, entao nao ha volta --
-- e ninguem no app consegue desfazer. Depois do `paid` quem manda e o dono.
DROP POLICY IF EXISTS group_bill_payments_delete ON public.group_bill_payments;
CREATE POLICY group_bill_payments_delete ON public.group_bill_payments
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND status <> 'paid');

-- ===========================================================================
-- SECAO 4: A TRIGGER DE TRAVA -- E POR QUE A POLICY SOZINHA NAO BASTA
-- ===========================================================================
-- A 053 justificou a trigger dela com o `amount`: policy de UPDATE nao compara
-- NEW com OLD, entao o devedor gravava `amount = 0.01, status = 'reported'` num
-- UPDATE so. **Esse argumento NAO vale aqui**, e repeti-lo seria um comentario
-- que mente: `group_bill_payments` nao tem coluna de dinheiro nenhuma. O valor
-- mora em `scheduled_transactions`, e o membro nao alcanca aquela tabela por
-- escrita (`005:321-325` exige `user_id = auth.uid()`).
--
-- O buraco que esta trigger fecha e OUTRO, e ele e desta tabela:
--
--     UPDATE public.group_bill_payments
--        SET scheduled_transaction_id = '<uma conta prevista MINHA>',
--            status = 'paid',
--            confirmed_at = now()
--      WHERE id = '<a minha linha, hoje pending>';
--
-- Esse comando passa pelas DUAS metades da policy da SECAO 3, e nao por engano:
-- o `USING` ve a linha ANTIGA e aprova pela primeira metade (e minha e esta
-- `pending`); o `WITH CHECK` ve a linha NOVA e aprova pela SEGUNDA metade,
-- porque depois do repontamento eu SOU o dono da conta prevista apontada.
-- Nenhuma das duas metades ve os dois lados ao mesmo tempo, e e exatamente
-- essa a limitacao que a 053 descreve. O resultado: o membro se da por PAGO,
-- com `confirmed_at` forjado, sem que o dono tenha confirmado nada -- e a conta
-- sai do «a pagar» dele.
--
-- A SEGUNDA razao e o pin EXPLICITO de colunas, copiado da 053 e pelo mesmo
-- motivo: a lista e "estas colunas, nominalmente" e nao "tudo menos status",
-- para que uma coluna NOVA nesta tabela nasca FECHADA para o membro. Quem a
-- acrescentar tem de vir aqui decidir, em vez de descobrir depois que ela
-- sempre foi escrivel por quem avisou que pagou.
--
-- `auth.uid() IS NULL` passa direto: e a sessao que NAO e do app -- a colagem no
-- SQL Editor, um backfill, uma funcao de servico. Travar esse caminho faria a
-- propria migration nao conseguir semear uma linha.
--
-- Quem e "o membro" aqui e `auth.uid()`, e nao o dono da transacao: a funcao e
-- DEFINER, mas `auth.uid()` le o claim da SESSAO (nao o role), entao ela
-- continua respondendo quem clicou.
CREATE OR REPLACE FUNCTION public.group_bill_payments_trava_do_membro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_quem uuid := auth.uid();
  v_dono uuid;
BEGIN
  IF v_quem IS NULL THEN
    RETURN NEW;
  END IF;

  -- O dono da conta prevista ANTIGA. E a antiga de proposito: perguntar pela
  -- NOVA e justamente o que o repontamento acima explora.
  SELECT s.user_id INTO v_dono
    FROM public.scheduled_transactions s
   WHERE s.id = OLD.scheduled_transaction_id;

  IF v_quem IS NOT DISTINCT FROM v_dono THEN
    -- O dono da conta prevista manda no estado de todo mundo. So nao reponta a
    -- linha: mudar `scheduled_transaction_id` ou `user_id` moveria o "pagou" de
    -- uma pessoa para outra, ou de uma conta para outra.
    IF NEW.scheduled_transaction_id IS DISTINCT FROM OLD.scheduled_transaction_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
    THEN
      RAISE EXCEPTION 'Conta de grupo: nem o dono reponta uma linha de pagamento para outra conta prevista ou outra pessoa -- apague e crie'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF v_quem IS NOT DISTINCT FROM OLD.user_id THEN
    -- A unica transicao do membro.
    IF NEW.status IS DISTINCT FROM 'reported'
       OR OLD.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'Conta de grupo: o membro so pode avisar que pagou (pending -> reported); tentou % -> %', OLD.status, NEW.status
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- E mais nenhum campo. Lista explicita, nominal -- ver o cabecalho desta
    -- secao. `reported_at` fica de FORA da lista: e o carimbo do aviso, e e o
    -- unico campo, junto com `status`, que o membro escreve.
    IF NEW.id                       IS DISTINCT FROM OLD.id
       OR NEW.scheduled_transaction_id IS DISTINCT FROM OLD.scheduled_transaction_id
       OR NEW.user_id                  IS DISTINCT FROM OLD.user_id
       OR NEW.confirmed_at             IS DISTINCT FROM OLD.confirmed_at
       OR NEW.created_at               IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'Conta de grupo: o membro nao reponta a linha nem confirma o proprio pagamento -- so avisa que pagou'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN NEW;
  END IF;

  -- Nem o dono da conta prevista nem o dono da linha. A RLS ja teria barrado;
  -- isto e a rede por baixo dela, para o caso de uma policy futura afrouxar sem
  -- querer.
  RAISE EXCEPTION 'Conta de grupo: so o dono da conta prevista ou o proprio membro mexem numa linha de pagamento'
    USING ERRCODE = 'insufficient_privilege';
END $$;

COMMENT ON FUNCTION public.group_bill_payments_trava_do_membro() IS
  'Prende o lado do membro em group_bill_payments. Existe porque policy de UPDATE nao compara NEW com OLD (USING ve OLD, WITH CHECK ve NEW): com a policy sozinha o membro reponta scheduled_transaction_id para uma conta prevista DELE e grava status = paid com confirmed_at forjado no mesmo UPDATE -- o USING aprova pela metade do membro e o WITH CHECK pela metade do dono. Deixa o membro mexer em status (pending -> reported) e reported_at, e em mais nada. auth.uid() IS NULL passa direto -- e a sessao que nao e do app (colagem, backfill, funcao de servico).';

DROP TRIGGER IF EXISTS group_bill_payments_trava_do_membro ON public.group_bill_payments;
CREATE TRIGGER group_bill_payments_trava_do_membro
  BEFORE UPDATE ON public.group_bill_payments
  FOR EACH ROW EXECUTE FUNCTION public.group_bill_payments_trava_do_membro();

-- ===========================================================================
-- SECAO 5: A VIEW GANHA my_status E my_effective_status, NO FIM
-- ===========================================================================
-- A definicao abaixo e a da 027 (`027_previsto_e_realizado_no_lancamento.sql:244`)
-- reproduzida byte a byte, mais um LEFT JOIN, um LATERAL e duas colunas no fim.
-- `CREATE OR REPLACE VIEW` exige a definicao INTEIRA, e o que vem de antes e
-- esta aqui so por obrigacao do REPLACE:
--
--   * `transaction_type` e `direction` (a precedencia resolvida) .......... 027
--   * `currency`, que o `s.*` congelado do 005 nunca expos ................ 027
--   * `effective_status` e `days_until_due` ............................... 005
--
-- AS DUAS COLUNAS, E POR QUE PARA LINHA QUE NAO E DE GRUPO ELAS NAO MUDAM NADA
-- ---------------------------------------------------------------------------
-- `my_status` = o meu estado nesta conta:
--
--   * se a conta e MINHA (sou o dono da linha), e o `status` dela. Identico ao
--     que ja existe;
--   * se nao e, e o estado da MINHA linha de pagamento, e `pending` quando ela
--     nao existe.
--
-- Conta que nao e de grupo e sempre do proprio dono que a le, entao `my_status`
-- = `status::text` e `my_effective_status` = `effective_status::text` para toda
-- linha pessoal. E ISSO e o que permite as oito leituras do app trocarem
-- `status` por `my_status` SEM NENHUMA MUDAR DE NUMERO -- a troca e inocua fora
-- do grupo, e e so dentro dele que o valor passa a ser o certo.
--
-- `text` E NAO `public.scheduled_status`, E A CONSEQUENCIA PARA QUEM FOR LER
-- -------------------------------------------------------------------------
-- `reported` nao existe no enum `scheduled_status` (`005:123-129`), e nao vai
-- entrar nele: `ALTER TYPE ... ADD VALUE` mudaria o dominio da coluna `status`
-- de `scheduled_transactions` e de todo CHECK que a le, por causa de um estado
-- que e de OUTRA tabela. Entao as duas colunas novas sao `text`. Quem comparar
-- `my_status` com `status` tem de castar (`status::text`), e a secao 2 do teste
-- prende a igualdade nessa forma.
--
-- `AND p.user_id = auth.uid()` NO JOIN E OBRIGATORIO, POR DOIS MOTIVOS
-- -------------------------------------------------------------------
--   1. a policy de SELECT da SECAO 3 entrega ao DONO da conta prevista as
--      linhas de TODOS os membros. Sem o filtro, `my_status` do dono viraria o
--      estado de um membro qualquer -- o do primeiro que o planejador
--      devolvesse;
--   2. e a linha da agenda MULTIPLICARIA: uma conta de grupo com tres membros
--      que avisaram apareceria tres vezes nas onze consultas que leem esta
--      view, e o sintoma seria dinheiro contado em triplo, sem erro nenhum. A
--      UNIQUE da SECAO 2 mais este filtro e que fazem o join devolver no maximo
--      uma linha; a secao 1 do teste prende a contagem com DOIS pagamentos na
--      mesma conta justamente para que a guarda meca algo.
--
-- O LATERAL existe para `my_status` ser escrito UMA vez. Repetir o CASE inteiro
-- dentro do CASE do `my_effective_status` daria o mesmo resultado e duas copias
-- do criterio para divergirem depois. `CROSS JOIN LATERAL` de um SELECT sem
-- FROM devolve sempre exatamente uma linha, entao ele nao descarta nem duplica
-- nada.
--
-- `overdue` SO SOBRE `pending`, e isso e deliberado: quem avisou que pagou
-- (`reported`) e esta esperando o dono confirmar NAO esta em atraso, mesmo
-- depois do vencimento. A regra e a mesma do `effective_status` do 005/027 --
-- vencida e uma PERGUNTA sobre a data, nao um estado gravado --, aplicada ao
-- estado da pessoa.
CREATE OR REPLACE VIEW public.scheduled_transactions_effective AS
  SELECT
    s.id,
    s.user_id,
    s.recurring_rule_id,
    s.category_id,
    s.account_id,
    s.group_id,
    s.description,
    s.amount,
    s.due_date,
    s.status,
    s.paid_date,
    s.transaction_id,
    s.notes,
    s.created_at,
    s.updated_at,
    s.currency,
    s.transaction_type,
    -- Vencida e uma PERGUNTA, nao um estado gravado: quem gravasse 'overdue'
    -- precisaria de um cron a meia-noite para envelhecer a linha, e o dia em
    -- que o cron nao rodasse a conta apareceria em dia. Igual ao 005.
    CASE
      WHEN s.status = 'pending' AND s.due_date < CURRENT_DATE
        THEN 'overdue'::public.scheduled_status
      ELSE s.status
    END AS effective_status,
    (s.due_date - CURRENT_DATE) AS days_until_due,
    -- A precedencia, resolvida uma vez: ocorrencia, regra, e por fim o
    -- 'expense' historico que a rota de baixa sempre teve.
    COALESCE(
      s.transaction_type,
      r.transaction_type,
      'expense'::public.transaction_financial_type
    ) AS direction,
    -- HMO-407: as duas colunas novas, no fim.
    meu.status AS my_status,
    CASE
      WHEN meu.status = 'pending' AND s.due_date < CURRENT_DATE
        THEN 'overdue'
      ELSE meu.status
    END AS my_effective_status
  FROM public.scheduled_transactions s
  LEFT JOIN public.recurring_rules r ON r.id = s.recurring_rule_id
  LEFT JOIN public.group_bill_payments p
         ON p.scheduled_transaction_id = s.id
        AND p.user_id = auth.uid()
  CROSS JOIN LATERAL (
    SELECT CASE
             WHEN s.user_id = auth.uid() THEN s.status::text
             ELSE COALESCE(p.status, 'pending')
           END AS status
  ) meu;

COMMENT ON VIEW public.scheduled_transactions_effective IS
  'scheduled_transactions com o status vencido calculado na hora (nunca gravado), a DIRECAO resolvida (HMO-188) e o estado DA PESSOA que esta lendo (HMO-407). direction = COALESCE(transaction_type da ocorrencia, transaction_type da regra, expense). my_status = o status da linha quando ela e minha, e COALESCE(group_bill_payments.status, pending) da MINHA linha de pagamento quando nao e -- linha ausente vale pending, e o join filtra auth.uid() para o dono nao herdar o estado de um membro e para a linha nao multiplicar. Para conta que nao e de grupo my_status = status::text e my_effective_status = effective_status::text, sempre: e isso que permite as leituras do app trocarem uma pela outra sem mudar de numero. As duas sao text porque reported nao existe em scheduled_status.';

-- ===========================================================================
-- `CREATE OR REPLACE VIEW` APAGA OS reloptions -- A 047 MEDIU ISSO
-- ===========================================================================
-- `security_invoker` e um reloption, e ele NAO sobrevive ao CREATE OR REPLACE
-- acima. Sem a linha abaixo esta view volta a rodar com os privilegios do DONO,
-- a RLS de `scheduled_transactions` deixa de ser aplicada, e a agenda de cada
-- usuario passa a listar as contas previstas de TODO MUNDO -- sem erro, sem
-- aviso e com os numeros parecendo plausiveis. Pior aqui do que em 2026-09:
-- `my_status` tambem deixaria de valer, porque o LEFT JOIN com
-- `group_bill_payments` passaria a ver as linhas de pagamento de todos.
--
-- Esta linha e identica a do 005:348, a do 027:285 e a do 047:178, e e
-- obrigatoria em toda migration que recria esta view.
-- `view_security_invoker_test.sql` tem o controle negativo pelo catalogo.
ALTER VIEW public.scheduled_transactions_effective SET (security_invoker = true);

-- ===========================================================================
-- SECAO 6: GRANTS
-- ===========================================================================
-- O 002 rodou `GRANT ... ON ALL TABLES` antes desta tabela existir, e ALL
-- TABLES nao alcanca o futuro -- entao os privilegios dela sao os daqui.
REVOKE ALL ON public.group_bill_payments FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_bill_payments TO authenticated;

-- `REVOKE ... FROM anon` sozinho nao tira nada quando o privilegio vem de
-- PUBLIC: o default de EXECUTE em funcao e `PUBLIC`, e `anon` o herda por ali.
-- E por isso que o REVOKE da funcao cita `PUBLIC` tambem.
REVOKE ALL ON FUNCTION public.group_bill_payments_trava_do_membro() FROM PUBLIC, anon, authenticated;

-- A view e recriada pelo `CREATE OR REPLACE`, o que PRESERVA os GRANTs
-- existentes (ao contrario dos reloptions). O 005:338-342 ja fez
-- `REVOKE ALL ... FROM anon` e `GRANT SELECT ... TO authenticated`; nada a
-- refazer aqui.
