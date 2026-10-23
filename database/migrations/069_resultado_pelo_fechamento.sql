-- ===========================================================================
-- 069 -- O RESULTADO DO MES PELO FECHAMENTO DO GRUPO (RN016 a RN018, fase 4)
-- ===========================================================================
-- Metade de BANCO da fase 4 de "o modelo das movimentacoes" (PRD 2.1). As
-- fases 2 e 3 fizeram o grupo FECHAR (067: o saldo de cada membro no periodo
-- vira "Pagamento ao grupo" ou "A receber do grupo") e o acerto QUITAR essas
-- contas (068). Ate aqui nenhuma leitura de dinheiro olhava para elas: o
-- Resultado de cada membro continuava contando a parte de cada despesa pelo
-- rateio do lancamento (033/046). Esta migration troca a leitura, e so para o
-- grupo que fecha.
--
-- O QUE MUDA, NO GRUPO COM DIA DE FECHAMENTO
-- ------------------------------------------
--   * quem pagou continua contando a despesa INTEIRA (RN018.1) -- isso ja era
--     assim desde a 046, pela perna pessoal, e nao muda;
--   * a parte de quem NAO pagou deixa de contar (RN018.9). E o que ele deve
--     entra pela conta do fechamento;
--   * a conta do fechamento entra no Resultado de quem a tem: "Pagamento ao
--     grupo" em Despesas, "A receber do grupo" em Receitas (RN017.1, RN017.5),
--     prevista ate ser quitada e realizada quando quitada (RN017.6);
--   * a conta prevista DO GRUPO (o aluguel que um membro lanca para todos) sai
--     da previsao de todo mundo quando alguem a paga. Nao ha mais "a minha
--     baixa" por membro (055): o que cada um deve dela vai para o fechamento.
--
-- O grupo SEM dia de fechamento (`closing_day IS NULL`, todo grupo que existe
-- hoje) continua exatamente como antes: a parte de cada despesa conta pelo
-- rateio, e a 055 vale. Ligar o fechamento num grupo e o que o passa para a
-- leitura nova. As suites da 033, 045, 046, 049, 054, 055 e 066 continuam
-- verdes sobre esta migration por isso -- os grupos delas nao fecham.
--
-- O QUE ESTA MIGRATION FAZ
-- ------------------------
--   SECAO 1  preflight
--   SECAO 2  `group_share_entries`: a parte de quem nao pagou sai do grupo que
--            fecha, e da despesa que ja entrou num fechamento
--   SECAO 3  `group_closing_entries`: a conta do fechamento ja quitada, o lado
--            REALIZADO dela
--   SECAO 4  `personal_category_monthly_totals` ganha a terceira perna, e com
--            ela `personal_monthly_cash_flow`, `planned_vs_actual` e os
--            relatorios no modo mes
--   SECAO 5  `scheduled_transactions_effective`: no grupo que fecha, o
--            `my_status` da conta do grupo e o status dela
--   SECAO 6  security_invoker e grants
--
-- POR QUE A CONTA SO VIRA REALIZADO QUANDO QUITADA INTEIRA
-- -------------------------------------------------------
-- O acerto parcial existe (RN019.4): a Leticia manda R$ 150 de uma conta de
-- R$ 400. A baixa fica registrada em `group_settlement_allocations` e a tela do
-- grupo mostra o que falta. No RESULTADO, porem, a conta e uma linha so, como
-- toda conta prevista do app: prevista enquanto nao foi quitada, realizada
-- quando foi. Partir a linha em R$ 150 realizados e R$ 250 previstos obrigaria
-- `scheduled_transactions_effective.amount` a mentir o valor da conta para as
-- onze leituras que dependem dela -- e as que perguntam "o que o mes
-- prometia" (`planned_vs_actual`, o previsto x realizado do painel) passariam a
-- ler R$ 250 numa conta de R$ 400. O dinheiro do Pix ja aparece no Saldo de
-- contas pela perna do acerto (transferencia); o que espera a quitacao inteira
-- e so a linha de Despesa ou Receita.
--
-- A DATA DA CONTA E O DIA DO FECHAMENTO, MESMO QUITADA DEPOIS
-- ----------------------------------------------------------
-- A conta realizada entra no mes do VENCIMENTO, que e o dia do fechamento
-- (decisao D3), e nao no mes do Pix. E o que a 068 ja escreveu sobre a
-- compensacao ("cada conta continua no mes dela") e o que faz a RN018.10
-- valer: a soma dos meses fecha na responsabilidade, e um mes nao muda de
-- Resultado porque alguem pagou o grupo no dia 3 do mes seguinte.
--
-- O PASSO HUMANO
-- --------------
-- Colar no SQL Editor do Supabase depois do merge, DEPOIS da 067 e da 068.
-- Re-executavel (`CREATE OR REPLACE`, `ALTER VIEW ... SET`, `GRANT`). Num banco
-- sem grupo com dia de fechamento ela nao muda numero nenhum.
-- ===========================================================================

-- ===========================================================================
-- SECAO 1: PREFLIGHT
-- ===========================================================================
DO $$
DECLARE
  v_faltando text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'group_share_entries'
       AND column_name = 'valor_total'
  ) THEN
    v_faltando := v_faltando || E'\n  - coluna valor_total em public.group_share_entries (vem da 066)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'scheduled_transactions_effective'
       AND column_name = 'my_effective_status'
  ) THEN
    v_faltando := v_faltando || E'\n  - coluna my_effective_status em public.scheduled_transactions_effective (vem da 055)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'expense_groups'
       AND column_name = 'closing_day'
  ) THEN
    v_faltando := v_faltando || E'\n  - coluna expense_groups.closing_day (vem da 067)';
  END IF;

  IF to_regclass('public.group_closing_items') IS NULL THEN
    v_faltando := v_faltando || E'\n  - tabela public.group_closing_items (vem da 067)';
  END IF;

  IF to_regclass('public.group_settlement_allocations') IS NULL THEN
    v_faltando := v_faltando || E'\n  - tabela public.group_settlement_allocations (vem da 068)';
  END IF;

  IF v_faltando <> '' THEN
    RAISE EXCEPTION E'069 nao pode ser aplicado neste banco. Faltando:%\n\nRode 001 -> ... -> 068 antes.', v_faltando;
  END IF;
END $$;

-- ===========================================================================
-- SECAO 2: A PARTE DE QUEM NAO PAGOU SAI DO GRUPO QUE FECHA (RN018.9)
-- ===========================================================================
-- A view continua sendo a unica definicao de "a minha parte do que outro
-- pagou", e por isso o corte e AQUI: todo leitor dela -- o rollup do modo mes
-- (046), o modo intervalo de /api/reports/cash-flow e /categories, a lista da
-- Financas Pessoais, `budget_consumption` e `planned_vs_actual` -- passa a
-- descontar a parte do grupo que fecha sem uma linha de codigo nova em cada
-- um.
--
-- A linha de quem NAO pagou sai por qualquer uma de duas razoes:
--
--   1. o grupo tem dia de fechamento. Inclusive a despesa de antes do
--      primeiro fechamento: ela entra nele (RN018.3), e contar a parte aqui e
--      a conta do fechamento la seria a divida duas vezes;
--   2. a despesa ja entrou num fechamento (`group_closing_items`). Sem esta,
--      tirar o dia de fechamento do grupo devolveria ao Resultado a parte de
--      toda despesa ja fechada -- com a conta gerada por ela ainda la.
--
-- A linha de QUEM PAGOU fica: ela nunca contou como custo (a 046 a descarta
-- por `paguei_eu`), e a despesa inteira dele vem pela perna pessoal.
--
-- As duas subconsultas leem pela RLS de quem consulta (a view e
-- security_invoker). Membro le o grupo (002) e os itens do fechamento (067). Quem
-- saiu do grupo ja nao le `group_transactions` (002), entao nao tem linha
-- nenhuma aqui para o corte decidir.
--
-- A perna da PESSOA (066) nao muda: divisao com pessoa e a fase 5.
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
    -- 069 (RN018.9): ver o bloco acima.
    AND (
      t.user_id = em.user_id
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.expense_groups g
           WHERE g.id = gt.group_id
             AND g.closing_day IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.group_closing_items i
           WHERE i.transaction_id = t.id
        )
      )
    )
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
  'A minha parte do que foi DIVIDIDO, uma linha por parte (033, perna de pessoa na 066). Perna do grupo: group_expense_splits, todos os membros -- quem le PRECISA filtrar user_id. No grupo com dia de fechamento, e na despesa que ja entrou num fechamento, so fica a linha de quem PAGOU: a parte de quem nao pagou sai do Resultado e o que ele deve entra pela conta do fechamento (069, RN018.9). Perna da pessoa: expense_splits sem grupo, so as partes de auth.uid(), com group_id NULL e paguei_eu FALSE. Exclui rateio rejected/expired e o que nao e expense. pago_por/descricao/valor_total sao de quem pagou, para a lista nao depender de ler a despesa dele.';

-- ===========================================================================
-- SECAO 3: A CONTA DO FECHAMENTO QUITADA, O LADO REALIZADO DELA
-- ===========================================================================
-- Uma linha por conta gerada pelo fechamento (067) que ja foi quitada inteira
-- (068), no formato que as leituras de realizado ja sabem somar: `amount`
-- POSITIVO, o sinal em `transaction_type`, igual a `group_share_entries`.
-- Quem soma converte pela mesma `partesComoTransacoes`
-- (lib/parte-do-grupo-realizada.ts), que repassa `transaction_type`.
--
-- O lado PREVISTO da mesma conta nao precisa de view nova: ela e uma linha de
-- `scheduled_transactions` do proprio membro, sem `group_id`, e toda leitura
-- de previsto ja a soma enquanto ela esta `pending`. Quitada, ela vira `paid`,
-- sai do previsto e entra aqui -- troca de lado, nunca fica nos dois.
--
-- A data e o vencimento (o dia do fechamento), e nao a do Pix: ver o
-- cabecalho.
--
-- `LEFT JOIN` no fechamento, e nao `JOIN`: a conta e do membro, e quem saiu do
-- grupo deixa de ler `group_closings` (067), mas a conta dele continua sendo
-- dinheiro dele. Sem o LEFT a linha sumiria do Resultado de quem saiu.
CREATE OR REPLACE VIEW public.group_closing_entries AS
  SELECT
    st.id                                             AS id,
    st.user_id                                        AS user_id,
    c.group_id                                        AS group_id,
    st.group_closing_id                               AS closing_id,
    st.due_date                                       AS transaction_date,
    date_trunc('month', st.due_date)::date            AS month,
    st.category_id                                    AS category_id,
    st.transaction_type                               AS transaction_type,
    st.currency                                       AS currency,
    st.amount                                         AS amount,
    st.description                                    AS descricao
  FROM public.scheduled_transactions st
  LEFT JOIN public.group_closings c ON c.id = st.group_closing_id
  WHERE st.group_closing_id IS NOT NULL
    AND st.status = 'paid';

COMMENT ON VIEW public.group_closing_entries IS
  'As contas geradas pelo fechamento do grupo (067) ja quitadas inteiras pelo acerto ou pela compensacao (068): o lado REALIZADO do "Pagamento ao grupo" (expense) e do "A receber do grupo" (income), RN017.6. amount POSITIVO, sinal em transaction_type, data e mes do VENCIMENTO (o dia do fechamento), nao do Pix. Enquanto pending a conta e previsao comum em scheduled_transactions; quitada, ela sai de la e entra aqui. A RLS de scheduled_transactions entrega so as contas do proprio usuario (069).';

-- ===========================================================================
-- SECAO 4: A TERCEIRA PERNA DO CUSTO PESSOAL
-- ===========================================================================
-- As duas pernas da 046 ficam byte a byte. A terceira e a conta do fechamento
-- quitada, por categoria (as duas reservadas da 067) e mes.
--
-- `transaction_count` conta a conta como UM lancamento: a rota de categorias
-- divide o total pelos meses com movimento, e um mes cuja unica linha e o
-- "Pagamento ao grupo" tem movimento.
--
-- `personal_monthly_cash_flow` e rollup desta view (033) e nao precisa ser
-- recolada: ela soma o que esta aqui. `planned_vs_actual` le
-- `personal_monthly_cash_flow` no realizado pessoal, e a conta gerada ja esta
-- no previsto dela por ser uma linha de `scheduled_transactions` -- entao o
-- mes da conta passa a ter os dois lados.
CREATE OR REPLACE VIEW public.personal_category_monthly_totals AS
  WITH tudo AS (
    -- PERNA 1 -- TUDO O QUE EU LANCEI, pelo valor CHEIO (046).
    SELECT
      c.user_id, c.month, c.category_id,
      c.expense, c.income, c.transaction_count, c.currency
    FROM public.category_monthly_totals c

    UNION ALL

    -- PERNA 2 -- A MINHA PARTE DO QUE OUTRO PAGOU (046). Desde a 069 ela nao
    -- traz mais nada de grupo que fecha: ver a SECAO 2.
    SELECT
      g.user_id, g.month, g.category_id,
      g.expense, g.income, g.transaction_count, g.currency
    FROM public.group_share_category_monthly_totals g
    WHERE NOT g.paguei_eu

    UNION ALL

    -- PERNA 3 (069) -- A CONTA DO FECHAMENTO QUITADA: o que eu paguei ao
    -- grupo em Despesas, o que recebi dele em Receitas.
    SELECT
      f.user_id, f.month, f.category_id,
      CASE WHEN f.transaction_type = 'expense' THEN f.amount ELSE 0 END::numeric(15,2),
      CASE WHEN f.transaction_type = 'income'  THEN f.amount ELSE 0 END::numeric(15,2),
      1::bigint,
      f.currency
    FROM public.group_closing_entries f
  )
  SELECT
    tudo.user_id,
    tudo.month,
    tudo.category_id,
    SUM(tudo.expense)::numeric(15,2) AS expense,
    SUM(tudo.income)::numeric(15,2)  AS income,
    (SUM(tudo.income) - SUM(tudo.expense))::numeric(15,2) AS net,
    SUM(tudo.transaction_count)      AS transaction_count,
    tudo.currency
  FROM tudo
  GROUP BY tudo.user_id, tudo.month, tudo.category_id, tudo.currency;

COMMENT ON VIEW public.personal_category_monthly_totals IS
  'CUSTO PESSOAL por categoria, mes e MOEDA: tudo o que EU lancei pelo valor cheio (inclusive despesa de grupo que eu paguei), mais A MINHA PARTE do que OUTRO pagou nos grupos que nao fecham e na divisao com pessoa, mais a conta do fechamento do grupo ja quitada (069): Pagamento ao grupo em expense, A receber do grupo em income. Criterio da HMO-258 (046) com o modelo novo da RN018 para o grupo com dia de fechamento. Ignora transfer. Quem le PRECISA filtrar user_id: sem isso a RLS de grupo devolve tambem as despesas de grupo dos OUTROS membros, cada uma no user_id de quem pagou.';

-- ===========================================================================
-- SECAO 5: NO GRUPO QUE FECHA, A CONTA DO GRUPO E PAGA PARA TODOS
-- ===========================================================================
-- A definicao da 055 recolada inteira (obrigacao do `CREATE OR REPLACE`), com
-- UM ramo novo no LATERAL de `my_status`.
--
-- A 055 deu a cada membro um estado proprio na conta do grupo: o Helio paga o
-- aluguel, e a parte da Lais continua "a pagar" ate ela dizer que passou o
-- dinheiro a ele. No grupo que fecha isso conta a divida duas vezes: quando o
-- Helio paga, a despesa entra no periodo aberto e a parte da Lais vai para a
-- estimativa do fechamento (RN018.7) e depois para a conta dele (RN018.5). Se
-- o aluguel continuasse "a pagar" no `my_status` dela, a previsao e a agenda
-- dela teriam a mesma parte duas vezes.
--
-- Entao, no grupo com dia de fechamento, `my_status` e o status da conta: ela
-- esta paga para todos quando alguem a pagou. A rota de "a minha baixa"
-- recusa a conta desse grupo (a divida vai pelo fechamento). Fora dele nada
-- muda, e e por isso que `my_status = status::text` continua valendo para toda
-- linha pessoal -- a premissa que deixou as leituras do app trocarem uma
-- coluna pela outra.
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
             -- 069: no grupo que fecha nao ha baixa por membro. Ver acima.
             WHEN s.group_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.expense_groups g
                WHERE g.id = s.group_id
                  AND g.closing_day IS NOT NULL
             ) THEN s.status::text
             ELSE COALESCE(p.status, 'pending')
           END AS status
  ) meu;

COMMENT ON VIEW public.scheduled_transactions_effective IS
  'scheduled_transactions com o status vencido calculado na hora (nunca gravado), a DIRECAO resolvida (HMO-188) e o estado DA PESSOA que esta lendo (HMO-407). direction = COALESCE(transaction_type da ocorrencia, transaction_type da regra, expense). my_status = o status da linha quando ela e minha, e COALESCE(group_bill_payments.status, pending) da MINHA linha de pagamento quando nao e -- linha ausente vale pending, e o join filtra auth.uid() para o dono nao herdar o estado de um membro e para a linha nao multiplicar. No grupo com dia de fechamento (069) my_status e o status da conta para todos os membros: a parte de cada um vai pelo fechamento, nao por baixa propria. Para conta que nao e de grupo my_status = status::text e my_effective_status = effective_status::text, sempre: e isso que permite as leituras do app trocarem uma pela outra sem mudar de numero. As duas sao text porque reported nao existe em scheduled_status.';

-- ===========================================================================
-- SECAO 6: security_invoker E GRANTS
-- ===========================================================================
-- `CREATE OR REPLACE VIEW` APAGA os reloptions (medido na 047 e na 064), e
-- `security_invoker` e um deles. Sem estas linhas as quatro views acima
-- rodariam com o privilegio do dono -- e `group_closing_entries` devolveria a
-- conta do fechamento de todo mundo.
ALTER VIEW public.group_share_entries              SET (security_invoker = true);
ALTER VIEW public.group_closing_entries            SET (security_invoker = true);
ALTER VIEW public.personal_category_monthly_totals SET (security_invoker = true);
ALTER VIEW public.scheduled_transactions_effective SET (security_invoker = true);

REVOKE ALL ON public.group_share_entries              FROM anon;
REVOKE ALL ON public.group_closing_entries            FROM anon;
REVOKE ALL ON public.personal_category_monthly_totals FROM anon;
REVOKE ALL ON public.scheduled_transactions_effective FROM anon;

GRANT SELECT ON public.group_share_entries              TO authenticated;
GRANT SELECT ON public.group_closing_entries            TO authenticated;
GRANT SELECT ON public.personal_category_monthly_totals TO authenticated;
GRANT SELECT ON public.scheduled_transactions_effective TO authenticated;
