-- =====================================================
-- PULODOGATO - RECORRENCIAS DETECTADAS
-- =====================================================
-- Migration: 011_detected_recurrences
-- Gerado em: 2026-09-22  (HMO-145)
--
-- O QUE ESTE ARQUIVO ADICIONA
-- ---------------------------
--   public.detected_recurrences   a assinatura que o app INFERIU do extrato,
--                                 e o que o usuario decidiu sobre ela
--
-- Como o 010, este arquivo so ACRESCENTA: nenhuma funcao, tabela, policy ou
-- trigger de producao e alterada.
--
-- POR QUE ESTA TABELA NAO E A `recurring_rules`
-- ----------------------------------------------
-- A `recurring_rules` (migration 005, ainda na pilha) guarda o gasto fixo que
-- o USUARIO cadastrou: ele digita "aluguel, dia 10, mensal" e o app projeta os
-- vencimentos. Esta tabela e o caminho contrario -- o app le o extrato e
-- descobre a cobranca que o usuario nao cadastrou, que e justamente a que ele
-- esqueceu que assinou. As duas convivem: a primeira e declaracao, a segunda e
-- observacao, e confundi-las faria o detector apagar o que o usuario digitou.
--
-- O QUE O JOB PODE E O QUE ELE NAO PODE SOBRESCREVER
-- ---------------------------------------------------
-- O detector roda de novo a cada importacao. Ele recalcula valor medio, data
-- da ultima cobranca e proxima prevista -- esses campos sao observacao e
-- precisam acompanhar o extrato. Mas `status` e DECISAO DO USUARIO: se ele
-- marcou "ignorar", a proxima importacao nao pode devolver a linha para
-- DETECTED e fazer a assinatura reaparecer na tela que ele acabou de limpar.
--
-- A amarra disso e o UNIQUE (user_id, merchant_key) da SECAO 2 somado ao
-- `ON CONFLICT DO UPDATE` que NAO lista `status` entre as colunas atualizadas.
-- Esta escrito aqui, no schema, e nao so na rota, porque uma segunda rota que
-- esqueca a regra reintroduz o bug sem que nada falhe.
--
-- POR QUE NAO HA TABELA DE ALERTA
-- --------------------------------
-- Os dois alertas do criterio de aceite (preco subiu, cobrou depois de
-- cancelada) sao DERIVADOS: dao para calcular na leitura a partir desta tabela
-- mais as transacoes, e calcular e mais barato que manter sincronizado. O que
-- exigiria persistencia e "ja avisei este usuario sobre este alerta" -- e esse
-- estado pertence a `alerts` da migration 009, que ainda esta na pilha. Quando
-- o 009 entrar, o disparo de notificacao pendura nele; ate la o alerta aparece
-- na tela, que e onde o criterio 3 ja pede que ele apareca.
--
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0: pre-requisitos
-- =====================================================
-- Sem isto a tabela nasce e so o USO descobre que financial_transactions nao
-- tem a forma que o detector espera.
DO $$
DECLARE
  faltando text;
BEGIN
  SELECT string_agg(msg, E'\n') INTO faltando
  FROM (
    SELECT CASE
             WHEN to_regclass('public.financial_transactions') IS NULL
               THEN '  - tabela public.financial_transactions nao existe'
             WHEN NOT EXISTS (
                    SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.financial_transactions')
                      AND a.attname = r.coluna
                      AND a.attnum > 0 AND NOT a.attisdropped)
               THEN format('  - coluna public.financial_transactions.%s nao existe', r.coluna)
           END AS msg
    FROM (VALUES ('id'), ('user_id'), ('description'), ('amount'), ('transaction_date')) AS r(coluna)
  ) t
  WHERE msg IS NOT NULL;

  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION E'011 nao pode ser aplicado neste banco:\n%', faltando;
  END IF;
END $$;

-- =====================================================
-- SECAO 1: a tabela
-- =====================================================
CREATE TABLE IF NOT EXISTS public.detected_recurrences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,

    -- Chave normalizada do estabelecimento ("netflix"). E o que AGRUPA, e sai
    -- de normalizeMerchant() em lib/recurrence-detector.ts. Nao e para a tela.
    merchant_key text NOT NULL,
    -- O que a tela mostra ("Netflix"). Vem da descricao original mais recente.
    display_name text NOT NULL,

    -- POSITIVOS. financial_transactions.amount grava despesa NEGATIVA, mas
    -- aqui o numero responde "quanto custa", e a soma da tela e um total de
    -- custo. O CHECK abaixo e o que impede o sinal cru de entrar: sem ele, um
    -- job que esqueca o modulo grava -39,90, o total mensal vira negativo e
    -- nada falha.
    avg_amount numeric(15,2) NOT NULL,
    last_amount numeric(15,2) NOT NULL,
    -- Quanto pesa por mes. Existe como coluna para somar semanal, mensal e
    -- anual na mesma consulta, sem a tela ter que saber converter.
    monthly_cost numeric(15,2) NOT NULL,

    frequency text NOT NULL,
    occurrences integer NOT NULL,

    last_charge_date date NOT NULL,
    next_expected_date date NOT NULL,

    status text NOT NULL DEFAULT 'DETECTED',
    -- Quando o status virou o que e hoje. E a data a partir da qual uma
    -- cobranca nova conta como "cobrou depois de cancelada" (criterio 4) --
    -- sem ela, a propria cobranca que motivou o cancelamento dispararia o
    -- alerta no mesmo instante do clique.
    status_changed_at timestamp with time zone,

    -- As transacoes que sustentam a recorrencia. Array, e nao tabela de
    -- ligacao, porque a lista e sempre lida inteira junto com a linha e nunca
    -- consultada pelo lado da transacao.
    transaction_ids uuid[] NOT NULL DEFAULT '{}',

    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),

    CONSTRAINT detected_recurrences_pkey PRIMARY KEY (id),

    CONSTRAINT detected_recurrences_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,

    CONSTRAINT detected_recurrences_frequency_check
      CHECK (frequency IN ('WEEKLY', 'MONTHLY', 'YEARLY')),

    CONSTRAINT detected_recurrences_status_check
      CHECK (status IN ('DETECTED', 'CONFIRMED', 'IGNORED', 'CANCELLED')),

    -- Ver o comentario das colunas de valor.
    CONSTRAINT detected_recurrences_amounts_positive_check
      CHECK (avg_amount > 0 AND last_amount > 0 AND monthly_cost > 0),

    -- O criterio de aceite 2 pede no minimo 3 ocorrencias. Gravar uma linha
    -- com 2 significa que o detector foi contornado.
    CONSTRAINT detected_recurrences_occurrences_check
      CHECK (occurrences >= 3),

    -- A proxima cobranca prevista e sempre DEPOIS da ultima observada. Uma
    -- linha que viole isso mostra na tela uma "proxima cobranca" no passado.
    CONSTRAINT detected_recurrences_next_after_last_check
      CHECK (next_expected_date > last_charge_date),

    -- Status diferente de DETECTED e resultado de uma acao do usuario, e acao
    -- tem data. Sem esta amarra, uma linha CANCELLED sem carimbo faz o alerta
    -- do criterio 4 nao ter a partir de quando comparar -- e ele
    -- silenciosamente nunca dispara.
    CONSTRAINT detected_recurrences_status_changed_at_check
      CHECK ((status = 'DETECTED') = (status_changed_at IS NULL))
);

COMMENT ON TABLE public.detected_recurrences IS
  'Assinatura/cobranca recorrente inferida do extrato pelo detector, e a decisao do usuario sobre ela. Nao confundir com recurring_rules, que e o gasto fixo que o usuario cadastrou.';
COMMENT ON COLUMN public.detected_recurrences.merchant_key IS
  'Chave normalizada do estabelecimento. Sai de normalizeMerchant() em lib/recurrence-detector.ts -- mudar a normalizacao muda o agrupamento das linhas ja gravadas.';
COMMENT ON COLUMN public.detected_recurrences.status IS
  'DETECTED e do detector; os outros tres sao decisao do usuario. O job NAO sobrescreve este campo -- ver o cabecalho.';
COMMENT ON COLUMN public.detected_recurrences.avg_amount IS
  'Positivo (modulo). A despesa e negativa em financial_transactions; aqui o numero e custo.';

-- =====================================================
-- SECAO 2: uma linha por estabelecimento por usuario
-- =====================================================
-- E o que torna o job idempotente: rodar a mesma importacao duas vezes atualiza
-- a linha em vez de criar a segunda. Sem isto, cada importacao acrescenta uma
-- Netflix a tela e o total mensal cresce sozinho.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_detected_recurrences_user_merchant
  ON public.detected_recurrences (user_id, merchant_key);

COMMENT ON INDEX public.uniq_detected_recurrences_user_merchant IS
  'Alvo do ON CONFLICT do job. E o que faz reimportar o mesmo extrato nao duplicar a assinatura.';

-- =====================================================
-- SECAO 3: indice de leitura
-- =====================================================
-- A tela abre em uma consulta: as recorrencias do usuario que nao foram
-- ignoradas, da mais cara por mes para a mais barata.
CREATE INDEX IF NOT EXISTS idx_detected_recurrences_user_status
  ON public.detected_recurrences (user_id, status, monthly_cost DESC);

-- =====================================================
-- SECAO 4: RLS
-- =====================================================
ALTER TABLE public.detected_recurrences ENABLE ROW LEVEL SECURITY;

-- Ver: so o dono.
DROP POLICY IF EXISTS detected_recurrences_select ON public.detected_recurrences;
CREATE POLICY detected_recurrences_select ON public.detected_recurrences
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Gravar: so em nome proprio, e so como DETECTED.
--
-- O `status = 'DETECTED'` no WITH CHECK nao e formalidade. Quem escreve aqui e
-- o detector, e detector nao decide -- ele observa. Sem a amarra, um cliente
-- poderia inserir a linha ja como CONFIRMED e pular a unica etapa em que o
-- usuario olha para a cobranca e diz o que ela e.
DROP POLICY IF EXISTS detected_recurrences_insert ON public.detected_recurrences;
CREATE POLICY detected_recurrences_insert ON public.detected_recurrences
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'DETECTED'
    AND status_changed_at IS NULL
  );

-- Atualizar: so o dono, e sem trocar de dono nem de estabelecimento.
--
-- O merchant_key preso no WITH CHECK fecha um buraco silencioso: trocar a
-- chave de uma linha existente a faz colidir com outra assinatura do mesmo
-- usuario (ou escapar do UNIQUE e virar uma segunda Netflix), e os
-- transaction_ids gravados passam a apontar para cobrancas de outro lojista.
DROP POLICY IF EXISTS detected_recurrences_update ON public.detected_recurrences;
CREATE POLICY detected_recurrences_update ON public.detected_recurrences
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Apagar: so o dono. Apagar aqui nao perde nada de verdade -- a proxima
-- passada do detector reencontra a cobranca no extrato. O que se perde e a
-- decisao (o "ignorar"), e por isso a tela oferece IGNORED em vez de DELETE.
DROP POLICY IF EXISTS detected_recurrences_delete ON public.detected_recurrences;
CREATE POLICY detected_recurrences_delete ON public.detected_recurrences
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- =====================================================
-- SECAO 5: carimbo do updated_at
-- =====================================================
-- Funcao propria, e nao a `update_updated_at_column()` legada do 001: as
-- migrations 003 e 004 existiram inteiras para consertar trigger que gravava
-- sem privilegio suficiente sob a RLS do 002. Esta nasce ja com
-- SECURITY INVOKER explicito e search_path fixo -- ela so toca a linha que a
-- transacao ja esta gravando, entao nao precisa de privilegio nenhum alem do
-- de quem chamou.
CREATE OR REPLACE FUNCTION public.detected_recurrences_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_detected_recurrences_touch ON public.detected_recurrences;
CREATE TRIGGER trg_detected_recurrences_touch
  BEFORE UPDATE ON public.detected_recurrences
  FOR EACH ROW EXECUTE FUNCTION public.detected_recurrences_touch_updated_at();

-- =====================================================
-- SECAO 6: GRANTS
-- =====================================================
-- O 002 rodou GRANT ... ON ALL TABLES antes desta tabela existir, e ALL TABLES
-- e uma fotografia do momento -- nao alcanca objeto criado depois.
REVOKE ALL ON public.detected_recurrences FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.detected_recurrences TO authenticated;

-- =====================================================
-- SECAO 7: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('011', '011_detected_recurrences',
        'Tabela detected_recurrences: assinaturas inferidas do extrato - HMO-145', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
