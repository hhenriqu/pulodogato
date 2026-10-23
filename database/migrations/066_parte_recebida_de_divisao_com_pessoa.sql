-- ===========================================================================
-- 066 -- A PARTE DA DIVISAO COM PESSOA CHEGA A QUEM A RECEBE
-- ===========================================================================
-- O sintoma, medido em producao em 22/10/2026: a Lais lancou "Agropecuaria"
-- R$ 79,86 e dividiu com o Helio "como pessoa" (sem grupo), 90% dele. A parte
-- do Helio esta gravada (`expense_splits`, R$ 71,87, `pending`) e ele nao a ve
-- em tela nenhuma nem em total nenhum.
--
-- A CAUSA
-- -------
-- O app tem dois mecanismos de divisao. O de GRUPO chega ao realizado de cada
-- membro por `group_share_entries` (033), que alimenta o painel, os relatorios
-- e a lista da Financas Pessoais. O de PESSOA (`expense_splits`, sem
-- `group_id`) era recebido pela tela de aprovacao, que saiu na HMO-425 -- e
-- nenhuma leitura de realizado le `expense_splits` do lado do participante.
--
-- Decisao de produto (Helio, 22/10/2026, "A ajustada"): a divisao com pessoa
-- FICA, inclusive entre quem tem grupo em comum (a familia divide coisas entre
-- os tres no grupo Casa e coisas so em par), e a parte recebida aparece para
-- quem a recebe, no mesmo formato da parte de grupo, e entra nos totais dele.
--
-- O CONSERTO: `group_share_entries` GANHA A PERNA DA PESSOA
-- --------------------------------------------------------
-- A view continua sendo a UNICA definicao de "a minha parte do que outro
-- pagou" -- o argumento do cabecalho da 033 contra uma segunda definicao vale
-- igual aqui. Com a perna nova, todo leitor que ja soma a parte de grupo passa
-- a somar a parte recebida de pessoa, sem codigo novo em cada um:
-- `group_share_category_monthly_totals` -> `personal_category_monthly_totals`
-- -> `personal_monthly_cash_flow` (painel e relatorios no modo mes), o modo
-- intervalo de `/api/reports/cash-flow` e `/categories`, e a lista da Financas
-- Pessoais.
--
-- A linha da perna nova tem `group_id` NULO e `paguei_eu` FALSO. As leituras
-- de GRUPO (orcamento de grupo, acerto) recortam por `group_id` e nao a veem.
--
-- POR QUE UMA FUNCAO SECURITY DEFINER, E NAO UM JOIN NA VIEW
-- ---------------------------------------------------------
-- A view e `security_invoker`, e a despesa e uma linha PESSOAL de quem pagou:
-- a policy de SELECT de `financial_transactions` (002) e `user_id = auth.uid()
-- OR (group_id IS NOT NULL AND is_group_member(group_id))`, entao o Helio nao
-- le a "Agropecuaria" da Lais e o JOIN nao devolveria nada. Abrir a policy
-- para o participante faria a linha INTEIRA da Lais aparecer em toda consulta
-- de lancamentos que confia na RLS sem filtrar `user_id` -- a despesa dela na
-- lista dele como se fosse dele. E a policy de `expense_splits` ja le
-- `financial_transactions`, entao a volta criaria recursao de policy.
--
-- A funcao entrega SO o que a linha da parte precisa (data, categoria, tipo,
-- moeda, a parte, quem pagou, a descricao e o valor cheio) e SO as partes de
-- `auth.uid()`. Ela nao tem parametro: nao ha como pedir a parte de outra
-- pessoa. Sem sessao (`service_role`), `auth.uid()` e nulo e ela nao devolve
-- nada -- o mesmo comportamento das colunas `my_*` da 055.
--
-- AS QUATRO REGRAS DA PERNA, E O QUE CADA UMA EVITA
-- -------------------------------------------------
--   1. `t.group_id IS NULL`: despesa de grupo entra pela perna do grupo. Se uma
--      linha tiver as duas divisoes, a parte entraria duas vezes.
--   2. `t.user_id <> es.participant_id`: quem pagou ja conta a despesa pela
--      perna pessoal (046, "INTEIRO quando EU paguei"). Um `expense_splits` dele
--      mesmo somaria por cima.
--   3. `t.transaction_type = 'expense'` e `es.status NOT IN ('rejected',
--      'expired')`: as mesmas duas regras da perna do grupo (033).
--   4. `t.include_in_total` NAO e filtrado aqui, de proposito: a perna do grupo
--      tambem nao filtra, e quem honra o flag sao os leitores (060). As duas
--      pernas tem de se comportar igual.
--
-- AS TRES COLUNAS NOVAS NO FIM: `pago_por`, `descricao`, `valor_total`
-- --------------------------------------------------------------------
-- `CREATE OR REPLACE VIEW` so aceita coluna nova no FIM. A lista da Financas
-- Pessoais lia descricao, quem pagou e o valor cheio numa segunda consulta a
-- `financial_transactions` -- que para a parte de pessoa a RLS nao responde.
-- Na perna do grupo as tres sao as mesmas colunas que aquela consulta ja lia.
--
-- O PASSO HUMANO
-- --------------
-- Colar no SQL Editor do Supabase depois do merge. Aditiva e re-executavel
-- (`CREATE OR REPLACE`, `ALTER VIEW ... SET`, `GRANT`). Com a `main` velha ela
-- nao quebra nada: as colunas novas estao no fim e a perna nova so acrescenta
-- linhas que hoje nao chegam a ninguem.
-- ===========================================================================

-- ===========================================================================
-- SECAO 1: PREFLIGHT
-- ===========================================================================
DO $$
DECLARE
  v_faltando text := '';
BEGIN
  IF to_regclass('public.group_share_entries') IS NULL THEN
    v_faltando := v_faltando || E'\n  - view public.group_share_entries (vem do 033)';
  END IF;
  IF to_regclass('public.group_share_category_monthly_totals') IS NULL THEN
    v_faltando := v_faltando || E'\n  - view public.group_share_category_monthly_totals (vem do 033)';
  END IF;
  IF to_regclass('public.expense_splits') IS NULL THEN
    v_faltando := v_faltando || E'\n  - tabela public.expense_splits (vem do 001)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'financial_transactions'
       AND column_name = 'currency'
  ) THEN
    v_faltando := v_faltando || E'\n  - coluna financial_transactions.currency (vem do 022)';
  END IF;

  IF v_faltando <> '' THEN
    RAISE EXCEPTION E'066 nao pode ser aplicado neste banco. Faltando:%\n\nRode 001 -> ... -> 064 antes.', v_faltando;
  END IF;
END $$;

-- ===========================================================================
-- SECAO 2: AS MINHAS PARTES DE DIVISAO COM PESSOA
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.minhas_partes_de_divisao_com_pessoa()
RETURNS TABLE (
  id               uuid,
  user_id          uuid,
  transaction_id   uuid,
  transaction_date date,
  category_id      uuid,
  transaction_type public.transaction_financial_type,
  currency         text,
  amount           numeric(15,2),
  split_status     text,
  pago_por         uuid,
  descricao        text,
  valor_total      numeric(15,2)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    es.id,
    es.participant_id,
    t.id,
    t.transaction_date,
    t.category_id,
    t.transaction_type,
    t.currency,
    es.amount,
    es.status,
    t.user_id,
    t.description,
    t.amount
  FROM public.expense_splits es
  JOIN public.financial_transactions t ON t.id = es.transaction_id
  WHERE es.participant_id = auth.uid()
    AND t.group_id IS NULL
    AND t.user_id <> es.participant_id
    AND t.transaction_type = 'expense'
    AND es.status NOT IN ('rejected', 'expired');
$$;

COMMENT ON FUNCTION public.minhas_partes_de_divisao_com_pessoa() IS
  'As partes de expense_splits (divisao com pessoa, sem grupo) em que EU sou o participante e outra pessoa pagou (066). SECURITY DEFINER porque a despesa e linha pessoal de quem pagou e a RLS de financial_transactions nao a entrega ao participante; sem parametro e filtrada por auth.uid(), entao ninguem le a parte de outra pessoa. E a perna de pessoa de group_share_entries.';

REVOKE ALL ON FUNCTION public.minhas_partes_de_divisao_com_pessoa() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.minhas_partes_de_divisao_com_pessoa() FROM anon;
GRANT EXECUTE ON FUNCTION public.minhas_partes_de_divisao_com_pessoa() TO authenticated;

-- ===========================================================================
-- SECAO 3: group_share_entries COM AS DUAS PERNAS
-- ===========================================================================
-- A perna do GRUPO e o corpo da 033 sem mudanca nenhuma, mais as tres colunas
-- no fim. A perna da PESSOA vem da funcao acima.
CREATE OR REPLACE VIEW public.group_share_entries AS
  SELECT
    es.id                                             AS id,
    em.user_id                                        AS user_id,
    gt.group_id                                       AS group_id,
    t.id                                              AS transaction_id,
    t.transaction_date                                AS transaction_date,
    date_trunc('month', t.transaction_date)::date     AS month,
    t.category_id                                     AS category_id,
    t.transaction_type                                AS transaction_type,
    t.currency                                        AS currency,
    es.amount                                         AS amount,
    es.status                                         AS split_status,
    (t.user_id = em.user_id)                          AS paguei_eu,
    t.user_id                                         AS pago_por,
    t.description                                     AS descricao,
    t.amount                                          AS valor_total
  FROM public.group_expense_splits es
  JOIN public.group_members em        ON em.id = es.member_id
  JOIN public.group_transactions gt   ON gt.id = es.group_transaction_id
  JOIN public.financial_transactions t ON t.id = gt.transaction_id
  WHERE es.status NOT IN ('rejected', 'expired')
    AND t.transaction_type = 'expense'
  UNION ALL
  SELECT
    p.id,
    p.user_id,
    NULL::uuid,
    p.transaction_id,
    p.transaction_date,
    date_trunc('month', p.transaction_date)::date,
    p.category_id,
    p.transaction_type,
    p.currency,
    -- O cast devolve o typmod que o retorno de funcao perde: sem ele o UNION
    -- resolve a coluna como `numeric` cru e o REPLACE e recusado.
    p.amount::numeric(15,2),
    p.split_status,
    FALSE,
    p.pago_por,
    p.descricao,
    p.valor_total::numeric(15,2)
  FROM public.minhas_partes_de_divisao_com_pessoa() p;

COMMENT ON VIEW public.group_share_entries IS
  'A minha parte do que foi DIVIDIDO, uma linha por parte (033, perna de pessoa na 066). Perna do grupo: group_expense_splits, todos os membros -- quem le PRECISA filtrar user_id. Perna da pessoa: expense_splits sem grupo, so as partes de auth.uid(), com group_id NULL e paguei_eu FALSE. Exclui rateio rejected/expired e o que nao e expense. pago_por/descricao/valor_total sao de quem pagou, para a lista nao depender de ler a despesa dele.';

-- `CREATE OR REPLACE VIEW` apaga os reloptions (ver o cabecalho da 064).
ALTER VIEW public.group_share_entries SET (security_invoker = true);
REVOKE ALL ON public.group_share_entries FROM anon;
GRANT SELECT ON public.group_share_entries TO authenticated;
