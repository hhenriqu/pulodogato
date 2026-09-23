-- =====================================================
-- PULODOGATO - METAS E RELATORIOS
-- =====================================================
-- Migration: 008_goals_and_reports
-- Gerado em: 2026-09-22  (HMO-137, Fase 4 da evolucao do produto)
--
-- O QUE ESTE ARQUIVO ADICIONA
-- ---------------------------
--   public.financial_goals           a meta ("Reserva de emergencia, R$ 15.000")
--   public.goal_contributions        cada aporte feito para uma meta
--   public.goal_progress             quanto ja juntou, quanto falta, quanto por mes (view)
--   public.category_monthly_totals   entrada/saida por categoria e por mes (view)
--   public.monthly_cash_flow         entrada/saida por mes (view, rollup da anterior)
--   public.planned_vs_actual         previsto x realizado por mes (view)
--   public.net_worth_history         evolucao do patrimonio mes a mes (view)
--
-- Nenhuma funcao de producao e alterada aqui. Ao contrario do 007, este
-- arquivo so acrescenta: as quatro views sao leitura pura e as duas tabelas
-- sao novas.
--
-- A TELA DE METAS ERA UM MOCK
-- ---------------------------
-- app/(dashboard)/dashboard/goals/page.tsx tinha duas metas escritas no
-- codigo ("Reserva de Emergencia", "Viagem Europa") com um TODO em cima. O
-- usuario via barras de progresso que nunca mudavam, nao havia onde cadastrar
-- e o botao "Nova Meta" nao fazia nada. A tela de Relatorios era do mesmo
-- tipo: quatro cartoes com um botao "Gerar" que nao chamava nada.
--
-- POR QUE O PROGRESSO E SOMA DE APORTES, E NAO O SALDO DA CONTA
-- -------------------------------------------------------------
-- A tentacao e ligar a meta a uma financial_account e dizer que o progresso e
-- o current_balance dela. Rejeitado por tres razoes, em ordem de gravidade:
--
--   1) current_balance e mantido por TRIGGER e, ate o 007 ser aplicado em
--      producao, ele derivou a cada edicao de lancamento. A meta herdaria a
--      deriva e diria que voce juntou dinheiro que nao existe -- ou o
--      contrario. Ver database/maintenance/007_auditoria_saldos.sql.
--   2) A conta poupanca costuma guardar dinheiro de mais de uma meta ao mesmo
--      tempo (a reserva E a viagem). Duas metas lendo o mesmo saldo mostrariam
--      as duas cheias com o dinheiro de uma so.
--   3) Aporte e um fato datado: "em marco eu botei R$ 500". Saldo e um numero
--      do presente, sem historia. Sem os aportes nao da para desenhar a
--      evolucao da meta nem responder "no ritmo atual eu chego?".
--
-- Entao goal_contributions e a fonte da verdade do progresso, e account_id na
-- meta e so uma anotacao de ONDE o dinheiro esta guardado. Quem quiser ver o
-- dinheiro sair da conta corrente lanca a transferencia normalmente: sao
-- fatos diferentes, como o acerto de grupo do 007.
--
-- O SINAL DO VALOR, DE NOVO
-- -------------------------
-- Despesa e gravada NEGATIVA em financial_transactions. Foi o que quase passou
-- na Fase 2 (SUM cru no consumo de orcamento daria -800 para quem gastou 800).
-- As views deste arquivo somam com ABS() e filtram por transaction_type, nunca
-- pelo sinal, e o teste tem controle negativo para as duas coisas.
--
-- 'transfer' NAO E NEM ENTRADA NEM SAIDA
-- --------------------------------------
-- O ENUM transaction_financial_type tem tres valores, nao dois. Transferir
-- R$ 1.000 da conta corrente para a poupanca nao e renda nem gasto: somar
-- transfer na entrada faria o fluxo de caixa mostrar uma receita de mil reais
-- que ninguem recebeu, e o mes fecharia positivo sem nenhum dinheiro novo.
-- category_monthly_totals ignora transfer de proposito.
--
-- Em net_worth_history e o oposto: transfer ENTRA na conta, porque o trigger
-- update_account_balance mexe no saldo em QUALQUER tipo. A view espelha
-- exatamente o que o trigger faz -- ver a SECAO 8.
--
-- COMO RODAR
-- ----------
--   psql "$URL" -v ON_ERROR_STOP=1 -f database/migrations/008_goals_and_reports.sql
--
-- Aplicar depois de 001 -> 002 -> 003 -> 004 -> 005 -> 006 -> 007. O preflight
-- aborta a transacao inteira listando tudo que falta de uma vez.
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0: O ARQUIVO CABE NESTE BANCO?
-- =====================================================
DO $$
DECLARE
  v_faltando TEXT;
BEGIN
  SELECT string_agg(DISTINCT msg, E'\n' ORDER BY msg) INTO v_faltando
  FROM (
    SELECT CASE
             WHEN to_regclass('public.' || quote_ident(r.tabela)) IS NULL
               THEN format('  - tabela public.%s nao existe', r.tabela)
             WHEN NOT EXISTS (
                    SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.' || quote_ident(r.tabela))
                      AND a.attname = r.coluna
                      AND a.attnum > 0
                      AND NOT a.attisdropped)
               THEN format('  - coluna public.%s.%s nao existe', r.tabela, r.coluna)
           END AS msg
    FROM (VALUES
      ('financial_accounts', 'current_balance'),
      ('financial_accounts', 'is_active'),
      ('financial_transactions', 'transaction_type'),
      ('financial_transactions', 'group_id'),
      ('transaction_categories', 'is_expense'),
      ('expense_groups', 'id'),
      -- do 005: previsto x realizado le a agenda de contas previstas
      ('scheduled_transactions', 'due_date'),
      ('scheduled_transactions', 'status'),
      ('recurring_rules', 'transaction_type'),
      ('schema_migrations', 'version')
    ) AS r(tabela, coluna)

    UNION ALL
    SELECT format('  - funcao public.%s nao existe', f.nome)
    FROM (VALUES
      ('update_updated_at_column()'),
      ('is_group_member(uuid)')
    ) AS f(nome)
    WHERE to_regprocedure('public.' || f.nome) IS NULL

    UNION ALL
    SELECT format('  - role %s nao existe', r.rolname)
    FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
    WHERE NOT EXISTS (SELECT 1 FROM pg_roles p WHERE p.rolname = r.rolname)
  ) AS checks
  WHERE msg IS NOT NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'008 nao pode ser aplicado neste banco. Faltando:\n%\n\nRode 001 -> 002 -> 003 -> 004 -> 005 -> 006 -> 007 antes.', v_faltando;
  END IF;
END $$;

-- =====================================================
-- SECAO 1: financial_goals  (a meta)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.financial_goals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    -- meta de grupo: a viagem que a familia inteira esta juntando dinheiro
    -- para fazer. NULL = meta pessoal. Mesmo desenho das tabelas do 005/006.
    group_id uuid,
    title text NOT NULL,
    description text,
    target_amount numeric(15,2) NOT NULL,
    -- prazo opcional: "juntar 15 mil" e uma meta valida sem data. Quando tem
    -- data, goal_progress calcula quanto falta por mes.
    target_date date,
    -- ONDE o dinheiro esta guardado. Anotacao, nao fonte do progresso -- ver o
    -- cabecalho. ON DELETE SET NULL: apagar a conta nao pode apagar a meta
    -- nem, pior, zerar o que ja foi juntado.
    account_id uuid,
    status text NOT NULL DEFAULT 'active',
    color_hex text DEFAULT '#8B5CF6'::text,
    icon text DEFAULT 'target'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT financial_goals_pkey PRIMARY KEY (id),
    -- meta de R$ 0 quebraria a divisao do percentual em goal_progress, do
    -- mesmo jeito que amount_limit > 0 protege budget_consumption no 006.
    CONSTRAINT financial_goals_target_check CHECK (target_amount > (0)::numeric),
    CONSTRAINT financial_goals_status_check CHECK (status IN ('active', 'completed', 'paused', 'cancelled')),
    CONSTRAINT financial_goals_title_check CHECK (length(btrim(title)) > 0),
    CONSTRAINT financial_goals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT financial_goals_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.expense_groups(id) ON DELETE CASCADE,
    CONSTRAINT financial_goals_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.financial_accounts(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.financial_goals IS
  'Metas de economia. O progresso NAO fica aqui: e a soma de goal_contributions, lida em goal_progress.';
COMMENT ON COLUMN public.financial_goals.account_id IS
  'Onde o dinheiro esta guardado. Anotacao: o progresso vem dos aportes, nao do saldo da conta.';

CREATE INDEX IF NOT EXISTS idx_financial_goals_user ON public.financial_goals(user_id, status);
CREATE INDEX IF NOT EXISTS idx_financial_goals_group ON public.financial_goals(group_id) WHERE group_id IS NOT NULL;

-- =====================================================
-- SECAO 2: goal_contributions  (cada aporte)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.goal_contributions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    goal_id uuid NOT NULL,
    -- QUEM aportou. Numa meta de grupo cada membro aporta o seu, e a tela
    -- mostra quanto cada um ja botou. Nao e redundante com financial_goals
    -- .user_id, que e quem CRIOU a meta.
    user_id uuid NOT NULL,
    amount numeric(15,2) NOT NULL,
    contributed_at date NOT NULL DEFAULT CURRENT_DATE,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT goal_contributions_pkey PRIMARY KEY (id),
    -- Aporte e sempre positivo. Tirar dinheiro da meta se registra apagando o
    -- aporte, nao lancando um negativo: um aporte negativo passaria despercebido
    -- na soma e o historico mentiria sobre quanto cada um contribuiu.
    CONSTRAINT goal_contributions_amount_check CHECK (amount > (0)::numeric),
    CONSTRAINT goal_contributions_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.financial_goals(id) ON DELETE CASCADE,
    CONSTRAINT goal_contributions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.goal_contributions IS
  'Aportes para uma meta. Fonte da verdade do progresso; sempre positivo.';

CREATE INDEX IF NOT EXISTS idx_goal_contributions_goal ON public.goal_contributions(goal_id, contributed_at DESC);
CREATE INDEX IF NOT EXISTS idx_goal_contributions_user ON public.goal_contributions(user_id);

-- =====================================================
-- SECAO 3: updated_at
-- =====================================================
DROP TRIGGER IF EXISTS set_financial_goals_updated_at ON public.financial_goals;
CREATE TRIGGER set_financial_goals_updated_at
  BEFORE UPDATE ON public.financial_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- SECAO 4: goal_progress  (quanto ja juntou)
-- =====================================================
-- O `saved` sai de goal_contributions, nunca do saldo da conta -- ver o
-- cabecalho do arquivo.
--
-- `monthly_required` responde "no ritmo de quanto por mes eu chego no prazo?".
-- A divisao usa GREATEST(months_left, 1): sem isso, uma meta que vence neste
-- mes daria divisao por zero e a tela inteira quebraria com erro 500 no dia do
-- vencimento -- o unico dia em que o usuario mais quer olhar para ela.
CREATE OR REPLACE VIEW public.goal_progress AS
  SELECT
    g.id,
    g.user_id,
    g.group_id,
    g.account_id,
    g.title,
    g.description,
    g.target_amount,
    g.target_date,
    g.status,
    g.color_hex,
    g.icon,
    g.created_at,
    g.updated_at,
    COALESCE(c.saved, 0)::numeric(15,2) AS saved,
    -- nunca negativo: quem passou da meta ve "faltam R$ 0,00", nao um valor
    -- negativo que a tela formataria como "-R$ 300,00 restantes".
    GREATEST(g.target_amount - COALESCE(c.saved, 0), 0)::numeric(15,2) AS remaining,
    -- 4 casas; a tela arredonda. O CHECK garante target_amount > 0.
    ROUND(COALESCE(c.saved, 0) / g.target_amount, 4) AS progress_ratio,
    COALESCE(c.contribution_count, 0) AS contribution_count,
    c.last_contribution_at,
    d.months_left,
    CASE
      WHEN g.target_date IS NULL THEN NULL
      WHEN COALESCE(c.saved, 0) >= g.target_amount THEN 0::numeric(15,2)
      ELSE ROUND(
        (g.target_amount - COALESCE(c.saved, 0)) / GREATEST(d.months_left, 1),
        2)::numeric(15,2)
    END AS monthly_required,
    -- Estado calculado na leitura, separado de g.status (que o usuario controla
    -- ao pausar ou cancelar). 'reached' aparece sozinho quando os aportes
    -- alcancam o alvo: sem isso a meta ficaria "em andamento" com barra cheia
    -- ate alguem lembrar de marcar como concluida na mao.
    CASE
      WHEN g.status IN ('paused', 'cancelled') THEN g.status
      WHEN COALESCE(c.saved, 0) >= g.target_amount THEN 'reached'
      WHEN g.target_date IS NOT NULL AND g.target_date < CURRENT_DATE THEN 'overdue'
      ELSE 'on_track'
    END AS progress_status
  FROM public.financial_goals g
  LEFT JOIN LATERAL (
    SELECT SUM(gc.amount) AS saved,
           COUNT(*) AS contribution_count,
           MAX(gc.contributed_at) AS last_contribution_at
    FROM public.goal_contributions gc
    WHERE gc.goal_id = g.id
  ) AS c ON TRUE
  -- meses cheios entre o mes corrente e o mes do prazo, NULL sem prazo.
  -- Calculado uma vez num LATERAL porque monthly_required precisa do mesmo
  -- numero: duplicar a expressao e como duas versoes da mesma regra, e a
  -- segunda deixa de acompanhar a primeira na primeira vez que alguem mexer.
  -- O ::integer nao e cosmetico -- date_part() devolve double precision, e
  -- ROUND(double, int) nao existe no Postgres: a view nem chega a ser criada.
  LEFT JOIN LATERAL (
    SELECT CASE
             WHEN g.target_date IS NULL THEN NULL
             ELSE GREATEST(
               (date_part('year',  g.target_date) - date_part('year',  CURRENT_DATE)) * 12
                 + (date_part('month', g.target_date) - date_part('month', CURRENT_DATE)),
               0)::integer
           END AS months_left
  ) AS d ON TRUE;

COMMENT ON VIEW public.goal_progress IS
  'Metas com o juntado, o que falta e o ritmo mensal necessario, calculados na leitura.';

-- =====================================================
-- SECAO 5: category_monthly_totals  (gasto por categoria)
-- =====================================================
-- Grao: (user_id, group_id, mes, categoria). Cada transacao pertence a
-- exatamente um par (user_id, group_id), entao somar todas as linhas de um
-- usuario da o total dele, sem dupla contagem.
--
-- O relatorio pessoal le group_id IS NULL; o da viagem le um group_id fixo, e
-- ai aparece uma linha por membro -- que e exatamente "quem gastou o que na
-- viagem".
--
-- ABS() + filtro por transaction_type, nunca pelo sinal: despesa e gravada
-- negativa e um SUM cru devolveria -800 para quem gastou 800. Foi o erro que
-- quase passou na Fase 2.
--
-- 'transfer' fica de fora das duas colunas de proposito: mover dinheiro entre
-- as proprias contas nao e renda nem gasto.
CREATE OR REPLACE VIEW public.category_monthly_totals AS
  SELECT
    t.user_id,
    t.group_id,
    date_trunc('month', t.transaction_date)::date AS month,
    t.category_id,
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.transaction_type = 'expense'), 0)::numeric(15,2) AS expense,
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.transaction_type = 'income'), 0)::numeric(15,2) AS income,
    (COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.transaction_type = 'income'), 0)
     - COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.transaction_type = 'expense'), 0))::numeric(15,2) AS net,
    COUNT(*) FILTER (WHERE t.transaction_type IN ('expense', 'income')) AS transaction_count
  FROM public.financial_transactions t
  WHERE t.transaction_type IN ('expense', 'income')
  GROUP BY t.user_id, t.group_id, date_trunc('month', t.transaction_date)::date, t.category_id;

COMMENT ON VIEW public.category_monthly_totals IS
  'Entrada e saida por categoria e por mes. Ignora transfer: mover dinheiro entre contas proprias nao e renda nem gasto.';

-- =====================================================
-- SECAO 6: monthly_cash_flow  (fluxo de caixa)
-- =====================================================
-- Rollup de category_monthly_totals de proposito, em vez de uma segunda
-- consulta sobre financial_transactions: duas definicoes do mesmo numero saem
-- de sincronia na primeira vez que alguem mexer no tratamento de sinal, e o
-- relatorio por categoria deixaria de somar o total do fluxo de caixa sem que
-- nada acusasse.
CREATE OR REPLACE VIEW public.monthly_cash_flow AS
  SELECT
    c.user_id,
    c.group_id,
    c.month,
    SUM(c.income)::numeric(15,2) AS income,
    SUM(c.expense)::numeric(15,2) AS expense,
    SUM(c.net)::numeric(15,2) AS net,
    SUM(c.transaction_count) AS transaction_count
  FROM public.category_monthly_totals c
  GROUP BY c.user_id, c.group_id, c.month;

COMMENT ON VIEW public.monthly_cash_flow IS
  'Entrada, saida e resultado por mes. Rollup de category_monthly_totals para nao ter duas versoes do mesmo numero.';

-- =====================================================
-- SECAO 7: planned_vs_actual  (previsto x realizado)
-- =====================================================
-- A armadilha desta view e o JOIN. O grao e (user_id, group_id, mes) e
-- group_id e NULL na maioria absoluta das linhas -- e em SQL, `NULL = NULL` e
-- NULL, nao verdadeiro. Um FULL OUTER JOIN ingenuo entre previsto e realizado
-- nao casaria NENHUMA linha pessoal: a tela mostraria previsto e realizado em
-- meses separados, cada um com o outro lado zerado, como se o usuario nunca
-- tivesse pago nada do que planejou.
--
-- Por isso as chaves saem de um UNION (que trata NULL como igual, ao contrario
-- do `=`) e os dois lados entram por LATERAL com IS NOT DISTINCT FROM. O teste
-- tem controle negativo: trocando por `=`, ele fica vermelho.
--
-- scheduled_transactions.amount e sempre POSITIVO (CHECK do 005) e a tabela
-- nao tem transaction_type -- o tipo mora na regra. COALESCE(r.transaction_type,
-- 'expense') espelha exatamente o que a rota de baixa faz ao criar a transacao
-- real (app/api/scheduled-transactions/[id]/pay). Se os dois discordassem, uma
-- conta prevista de receita entraria como despesa prevista e viraria receita
-- realizada ao ser paga: o previsto x realizado acusaria um estouro que nao
-- houve.
--
-- Contar a conta paga nos DOIS lados e correto e nao e dupla contagem: previsto
-- e o que estava na agenda, realizado e o que saiu da conta. Sao eixos
-- diferentes do mesmo mes, e a diferenca entre eles e justamente o relatorio.
CREATE OR REPLACE VIEW public.planned_vs_actual AS
  WITH chaves AS (
    SELECT s.user_id, s.group_id, date_trunc('month', s.due_date)::date AS month
    FROM public.scheduled_transactions s
    UNION
    SELECT t.user_id, t.group_id, date_trunc('month', t.transaction_date)::date AS month
    FROM public.financial_transactions t
    WHERE t.transaction_type IN ('expense', 'income')
  )
  SELECT
    k.user_id,
    k.group_id,
    k.month,
    COALESCE(p.planned_expense, 0)::numeric(15,2) AS planned_expense,
    COALESCE(p.planned_income, 0)::numeric(15,2)  AS planned_income,
    COALESCE(a.income, 0)::numeric(15,2)  AS actual_income,
    COALESCE(a.expense, 0)::numeric(15,2) AS actual_expense,
    -- positivo = gastou mais do que tinha previsto
    (COALESCE(a.expense, 0) - COALESCE(p.planned_expense, 0))::numeric(15,2) AS expense_variance,
    COALESCE(p.pending_count, 0) AS pending_count,
    COALESCE(p.overdue_count, 0) AS overdue_count
  FROM chaves k
  LEFT JOIN LATERAL (
    SELECT
      SUM(s.amount) FILTER (WHERE COALESCE(r.transaction_type, 'expense') = 'expense') AS planned_expense,
      SUM(s.amount) FILTER (WHERE COALESCE(r.transaction_type, 'expense') = 'income')  AS planned_income,
      COUNT(*) FILTER (WHERE s.status = 'pending') AS pending_count,
      COUNT(*) FILTER (WHERE s.status = 'pending' AND s.due_date < CURRENT_DATE) AS overdue_count
    FROM public.scheduled_transactions s
    LEFT JOIN public.recurring_rules r ON r.id = s.recurring_rule_id
    WHERE s.user_id = k.user_id
      AND s.group_id IS NOT DISTINCT FROM k.group_id
      AND date_trunc('month', s.due_date)::date = k.month
      -- cancelada nunca foi previsao de verdade
      AND s.status <> 'cancelled'
  ) AS p ON TRUE
  LEFT JOIN LATERAL (
    SELECT f.income, f.expense
    FROM public.monthly_cash_flow f
    WHERE f.user_id = k.user_id
      AND f.group_id IS NOT DISTINCT FROM k.group_id
      AND f.month = k.month
  ) AS a ON TRUE;

COMMENT ON VIEW public.planned_vs_actual IS
  'Previsto (agenda do 005) contra realizado (transacoes) por mes. Chaves por UNION: group_id e NULL e NULL = NULL nao casa.';

-- =====================================================
-- SECAO 8: net_worth_history  (evolucao do patrimonio)
-- =====================================================
-- O banco nao guarda historico de saldo: financial_accounts.current_balance e
-- um numero do presente, mantido por trigger. Entao o patrimonio de um mes
-- passado e reconstruido ANDANDO PARA TRAS a partir de hoje:
--
--   patrimonio(mes M) = saldo de hoje - (tudo que entrou e saiu depois de M)
--
-- Duas consequencias que precisam estar ditas, porque a tela nao tem como
-- adivinhar:
--
--   1) A VARIACAO mes a mes e exata -- ela sai so das transacoes.
--   2) O NIVEL herda qualquer erro que exista hoje em current_balance. Ate o
--      007 ser aplicado em producao, o saldo derivou a cada edicao de
--      lancamento, e a curva inteira sobe ou desce junto com essa deriva. Nao
--      da para corrigir aqui: seria adivinhar qual parte do saldo e abertura
--      de conta e qual e erro. Rode database/maintenance/007_auditoria_saldos.sql.
--
-- Por que 'transfer' ENTRA aqui e fica de fora do fluxo de caixa: a view tem
-- que espelhar o que o trigger update_account_balance faz, e ele soma
-- NEW.amount em QUALQUER tipo. Ignorar transfer aqui faria a conta de tras
-- para frente nao fechar com o saldo de hoje -- e o erro so apareceria para
-- quem usa transferencia, isto e, para quem tem poupanca.
--
-- Pelo mesmo motivo a soma so olha transacoes com account_id NOT NULL: sem
-- conta, o trigger nao mexe em saldo nenhum.
--
-- Contas inativas entram no saldo de hoje. Uma conta encerrada com saldo
-- residual continua sendo patrimonio, e exclui-la faria o patrimonio cair de
-- degrau no mes em que alguem arquivou a conta, sem nenhuma transacao
-- explicando a queda.
CREATE OR REPLACE VIEW public.net_worth_history AS
  WITH saldo_hoje AS (
    SELECT a.user_id, COALESCE(SUM(a.current_balance), 0)::numeric(15,2) AS total
    FROM public.financial_accounts a
    GROUP BY a.user_id
  ),
  movimento AS (
    SELECT
      t.user_id,
      date_trunc('month', t.transaction_date)::date AS month,
      SUM(t.amount)::numeric(15,2) AS net
    FROM public.financial_transactions t
    WHERE t.account_id IS NOT NULL
    GROUP BY t.user_id, date_trunc('month', t.transaction_date)::date
  )
  SELECT
    m.user_id,
    m.month,
    m.net AS net_change,
    -- saldo de hoje menos tudo que se moveu DEPOIS deste mes. A janela nao tem
    -- ORDER BY porque precisa da soma de todas as linhas seguintes, nao de um
    -- acumulado parcial; SUM() OVER (PARTITION BY ...) sem ORDER BY soma a
    -- particao inteira, e por isso o "depois" e feito subtraindo o acumulado
    -- ate o mes corrente do acumulado total.
    (s.total
     - (SUM(m.net) OVER (PARTITION BY m.user_id)
        - SUM(m.net) OVER (PARTITION BY m.user_id ORDER BY m.month
                           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))
    )::numeric(15,2) AS net_worth
  FROM movimento m
  JOIN saldo_hoje s ON s.user_id = m.user_id;

COMMENT ON VIEW public.net_worth_history IS
  'Patrimonio mes a mes, reconstruido de tras para frente a partir do saldo de hoje. A variacao e exata; o nivel herda a deriva de current_balance.';

-- =====================================================
-- SECAO 9: RLS
-- =====================================================
-- Mesmo desenho do 002, 005, 006 e 007: nega por padrao, libera o dono e - nas
-- linhas de grupo - os membros. Sem policy para anon: a chave anon vai no
-- bundle JS publico.
ALTER TABLE public.financial_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_contributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS financial_goals_select ON public.financial_goals;
CREATE POLICY financial_goals_select ON public.financial_goals
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (group_id IS NOT NULL AND public.is_group_member(group_id))
  );

DROP POLICY IF EXISTS financial_goals_insert ON public.financial_goals;
CREATE POLICY financial_goals_insert ON public.financial_goals
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (group_id IS NULL OR public.is_group_member(group_id))
  );

-- Editar e apagar ficam so com quem criou, inclusive na meta de grupo: mudar o
-- alvo de uma meta coletiva e uma decisao de quem propos, e apagar levaria
-- junto (ON DELETE CASCADE) os aportes de todo mundo.
DROP POLICY IF EXISTS financial_goals_update ON public.financial_goals;
CREATE POLICY financial_goals_update ON public.financial_goals
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS financial_goals_delete ON public.financial_goals;
CREATE POLICY financial_goals_delete ON public.financial_goals
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Aportes: quem enxerga a meta enxerga os aportes dela (numa meta de grupo,
-- ver quanto cada um ja botou e o ponto). Mas so da para aportar em SEU nome,
-- e so em meta que voce enxerga.
DROP POLICY IF EXISTS goal_contributions_select ON public.goal_contributions;
CREATE POLICY goal_contributions_select ON public.goal_contributions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.financial_goals g
      WHERE g.id = goal_contributions.goal_id
        AND (g.user_id = auth.uid()
             OR (g.group_id IS NOT NULL AND public.is_group_member(g.group_id)))
    )
  );

DROP POLICY IF EXISTS goal_contributions_insert ON public.goal_contributions;
CREATE POLICY goal_contributions_insert ON public.goal_contributions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.financial_goals g
      WHERE g.id = goal_contributions.goal_id
        AND (g.user_id = auth.uid()
             OR (g.group_id IS NOT NULL AND public.is_group_member(g.group_id)))
    )
  );

DROP POLICY IF EXISTS goal_contributions_update ON public.goal_contributions;
CREATE POLICY goal_contributions_update ON public.goal_contributions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS goal_contributions_delete ON public.goal_contributions;
CREATE POLICY goal_contributions_delete ON public.goal_contributions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- =====================================================
-- SECAO 10: GRANTS
-- =====================================================
-- O 002 rodou GRANT ... ON ALL TABLES antes destes objetos existirem, e ALL
-- TABLES nao alcanca o futuro.
REVOKE ALL ON public.financial_goals FROM anon;
REVOKE ALL ON public.goal_contributions FROM anon;
REVOKE ALL ON public.goal_progress FROM anon;
REVOKE ALL ON public.category_monthly_totals FROM anon;
REVOKE ALL ON public.monthly_cash_flow FROM anon;
REVOKE ALL ON public.planned_vs_actual FROM anon;
REVOKE ALL ON public.net_worth_history FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_goals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.goal_contributions TO authenticated;
GRANT SELECT ON public.goal_progress TO authenticated;
GRANT SELECT ON public.category_monthly_totals TO authenticated;
GRANT SELECT ON public.monthly_cash_flow TO authenticated;
GRANT SELECT ON public.planned_vs_actual TO authenticated;
GRANT SELECT ON public.net_worth_history TO authenticated;

-- Sem security_invoker a view roda com o privilegio do DONO e a RLS das
-- tabelas base nao vale. Aqui isso seria o pior vazamento do projeto ate agora:
-- monthly_cash_flow devolveria a renda e o gasto mensal de TODOS os usuarios do
-- sistema para qualquer um que estivesse logado, e net_worth_history devolveria
-- o patrimonio de cada um. Mesma pegadinha do 005, do 006 e do 007 -- e o teste
-- tem controle negativo para ela.
ALTER VIEW public.goal_progress SET (security_invoker = true);
ALTER VIEW public.category_monthly_totals SET (security_invoker = true);
ALTER VIEW public.monthly_cash_flow SET (security_invoker = true);
ALTER VIEW public.planned_vs_actual SET (security_invoker = true);
ALTER VIEW public.net_worth_history SET (security_invoker = true);

-- =====================================================
-- SECAO 11: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('008', '008_goals_and_reports',
        'Metas com aportes (financial_goals, goal_contributions) e as views dos relatorios - HMO-137 Fase 4', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
