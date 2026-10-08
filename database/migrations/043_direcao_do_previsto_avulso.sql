-- =============================================================================
-- PULODOGATO - A DIRECAO DO PREVISTO AVULSO EM planned_vs_actual (HMO-256)
-- =============================================================================
-- Aplicar no SQL Editor do Supabase, de uma vez. ADITIVA E IDEMPOTENTE: ela
-- troca a EXPRESSAO de duas agregacoes de uma view. Nenhuma coluna entra ou
-- sai, nenhuma tabela e tocada, nenhum dado e reescrito.
--
-- SEGURO DE APLICAR COM A `main` VELHA NO AR. O codigo em producao le esta view
-- pela rota de orcamento e so consome `planned_expense` / `planned_income`, que
-- continuam existindo com o mesmo tipo e no mesmo lugar. O que muda e o VALOR:
-- a receita prevista avulsa para de entrar em `planned_expense` e passa a
-- entrar em `planned_income`. Isso e o conserto, e ele vale com qualquer versao
-- do app.
--
-- =============================================================================
-- O DEFEITO
-- =============================================================================
-- `planned_vs_actual` decidia a direcao de cada conta prevista por
--
--     COALESCE(r.transaction_type, 'expense')
--
-- -- o tipo da REGRA de recorrencia, com 'expense' no fim. E previsao AVULSA
-- nao tem regra: `r.transaction_type` vem NULL pelo LEFT JOIN, e a linha cai
-- em 'expense'. Toda receita prevista avulsa era contada como conta a pagar.
--
-- A coluna que responde a pergunta certa -- `scheduled_transactions
-- .transaction_type`, a direcao da PROPRIA ocorrencia -- existe desde a
-- migration 027, e a view nunca a leu. A tela de cadastro grava ali desde a
-- HMO-188 (a checkbox "ainda nao recebi").
--
-- MEDIDO EM PRODUCAO, 04/10/2026, conta de teste da HMO-255, outubro/2026:
--
--     planned_expense  1.365,00   <- inclui o bonus de 50,00, que e RECEITA
--     planned_income   2.700,00   <- sem o bonus
--
-- O erro e DUPLO na mesma linha: o valor soma no lado errado E deixa de somar
-- no certo. Um bonus de R$ 50,00 move R$ 100,00 de distancia entre os dois
-- numeros, e `expense_variance` -- que a tela imprime como "gastou mais do que
-- previa" -- se desloca com ele.
--
-- =============================================================================
-- O CONSERTO: A VIEW DA AGENDA, E NAO UM SEGUNDO COALESCE
-- =============================================================================
-- O LATERAL do previsto passa a ler `scheduled_transactions_effective` em vez
-- da tabela, e a filtrar por `s.direction`.
--
-- Escrever `COALESCE(s.transaction_type, r.transaction_type, 'expense')` aqui
-- daria o MESMO numero e foi recusado de proposito: seria a terceira copia da
-- precedencia no repositorio. A 027 criou `scheduled_transactions_effective`
-- justamente para que a precedencia tivesse UMA copia, e escreveu no cabecalho
-- dela que "a copia esquecida em uma das tres rotas de leitura seria justamente
-- uma receita prevista aparecendo como conta a pagar". Foi o que aconteceu --
-- tres vezes, e esta view e a terceira. Ler a coluna `direction` e o que faz a
-- proxima mudanca de precedencia alcancar este lugar sozinha.
--
-- O `LEFT JOIN public.recurring_rules` SAI: a view ja faz esse join por dentro,
-- e manter o nosso aqui deixaria `r` sem uso nenhum -- um convite a reescrever
-- o criterio antigo por cima.
--
-- O `chaves` CTE CONTINUA LENDO A TABELA, e isso nao e descuido: ele so precisa
-- de `user_id`, `group_id`, `due_date` e `currency` para montar a chave do mes.
-- Direcao nao entra na chave, e a tabela e o caminho mais curto.
--
-- =============================================================================
-- O QUE ESTA MIGRATION *NAO* MUDA
-- =============================================================================
--   * `pending_count` e `overdue_count` continuam contando TODA linha pendente,
--     receita incluida. Eles respondem "quantas linhas da agenda estao em
--     aberto", nao "quanto eu devo", e mexer neles aqui mudaria dois numeros de
--     tela sem nenhuma issue pedindo. A receita prevista vencida continua
--     aparecendo como pendente -- e ela esta mesmo pendente.
--   * `s.status <> 'cancelled'` fica. Cancelada nunca foi previsao de verdade.
--   * O recorte de moeda e o `IS NOT DISTINCT FROM` do `group_id` ficam
--     identicos. O segundo e o que faz o lado pessoal casar (`group_id` e NULL
--     na maioria das linhas, e `NULL = NULL` nao e verdadeiro); trocar por `=`
--     mostraria previsto e realizado em meses separados, cada um com o outro
--     lado zerado. O caso 5 do teste da 022 guarda o LATERAL contra a
--     duplicacao por moeda, e continua valendo.
--
-- =============================================================================
-- POR QUE `CREATE OR REPLACE` BASTA AQUI
-- =============================================================================
-- A lista de colunas nao muda -- mesmos nomes, mesma ordem, mesmos tipos --,
-- entao o REPLACE e aceito. (A 027 precisou de DROP + CREATE porque LA a view
-- GANHAVA coluna no meio, e `CREATE OR REPLACE` so aceita acrescentar no fim.)
--
-- AVISO PARA A PROXIMA MIGRATION QUE MEXER NESTA VIEW
-- ---------------------------------------------------
-- `CREATE OR REPLACE VIEW` exige a definicao INTEIRA. Quem mexer em qualquer
-- parte de `planned_vs_actual` daqui para frente recola os dois FILTER do
-- previsto junto -- e recolar a versao ANTIGA
-- (`COALESCE(r.transaction_type, 'expense')`) reverte esta migration sem
-- conflito de git, sem erro e sem sintoma: os dois numeros continuam
-- plausiveis.
--
-- ISSO NAO E HIPOTETICO. Enquanto esta issue estava aberta, a branch da HMO-258
-- (`043_realizado_de_grupo_no_previsto_x_realizado.sql`, nao mergeada) ja
-- carregava a definicao completa com o criterio velho nos dois FILTER.
-- Rebaseando aquela branch: trocar o `FROM` do LATERAL do previsto por
-- `public.scheduled_transactions_effective` e os dois FILTER por `s.direction`.
--
-- Quem avisa e o step "A receita prevista AVULSA continua fora de
-- planned_expense no fim da cadeia" do db-verify, que re-roda o teste desta
-- migration DEPOIS de todas as outras.
--
-- `security_invoker` e REPOSTO no fim mesmo em teoria sendo preservado pelo
-- REPLACE. Sem ele a view roda com os direitos do DONO, a RLS de
-- `scheduled_transactions` e de `financial_transactions` deixa de valer, e a
-- view devolve o previsto e o realizado de TODOS os usuarios para qualquer um
-- logado. Repetir o ALTER e barato; descobrir que a preservacao nao valia, nao.
-- O `view_security_invoker_test.sql` cobra isso de todas as views.
-- =============================================================================

CREATE OR REPLACE VIEW public.planned_vs_actual AS
  WITH chaves AS (
    SELECT s.user_id, s.group_id, date_trunc('month', s.due_date)::date AS month, s.currency
    FROM public.scheduled_transactions s
    UNION
    SELECT t.user_id, t.group_id, date_trunc('month', t.transaction_date)::date AS month, t.currency
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
    COALESCE(p.overdue_count, 0) AS overdue_count,
    k.currency
  FROM chaves k
  LEFT JOIN LATERAL (
    -- `s.direction` (HMO-256): a precedencia ocorrencia -> regra -> 'expense',
    -- resolvida UMA vez, na 027. Antes era COALESCE(r.transaction_type,
    -- 'expense') -- o tipo da REGRA --, e previsao avulsa nao tem regra.
    SELECT
      SUM(s.amount) FILTER (WHERE s.direction = 'expense') AS planned_expense,
      SUM(s.amount) FILTER (WHERE s.direction = 'income')  AS planned_income,
      -- Contagem de linha EM ABERTO, e nao de divida: receita prevista entra
      -- nos dois contadores, igual a antes desta migration.
      COUNT(*) FILTER (WHERE s.status = 'pending') AS pending_count,
      COUNT(*) FILTER (WHERE s.status = 'pending' AND s.due_date < CURRENT_DATE) AS overdue_count
    FROM public.scheduled_transactions_effective s
    WHERE s.user_id = k.user_id
      AND s.group_id IS NOT DISTINCT FROM k.group_id
      AND date_trunc('month', s.due_date)::date = k.month
      AND s.currency IS NOT DISTINCT FROM k.currency
      -- cancelada nunca foi previsao de verdade
      AND s.status <> 'cancelled'
  ) AS p ON TRUE
  LEFT JOIN LATERAL (
    SELECT f.income, f.expense
    FROM public.monthly_cash_flow f
    WHERE f.user_id = k.user_id
      AND f.group_id IS NOT DISTINCT FROM k.group_id
      AND f.month = k.month
      AND f.currency IS NOT DISTINCT FROM k.currency
  ) AS a ON TRUE;

COMMENT ON VIEW public.planned_vs_actual IS
  'Previsto x realizado por mes e MOEDA. A direcao do previsto sai de scheduled_transactions_effective.direction (HMO-256): previsao AVULSA de receita entrava em planned_expense porque o criterio era o transaction_type da REGRA, e avulsa nao tem regra. O LATERAL casa a moeda tambem: sem isso um mes com duas moedas duplicaria a linha e repetiria o previsto inteiro em cada uma.';

-- A RLS desta view depende DISTO. Ver o cabecalho.
ALTER VIEW public.planned_vs_actual SET (security_invoker = true);

-- `CREATE OR REPLACE VIEW` nao mexe em privilegio, mas repetir o GRANT deixa a
-- migration completa para quem a aplicar num banco reconstruido do zero.
REVOKE ALL ON public.planned_vs_actual FROM anon;
GRANT SELECT ON public.planned_vs_actual TO authenticated;
