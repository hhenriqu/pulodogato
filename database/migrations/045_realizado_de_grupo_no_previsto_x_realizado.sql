-- ===========================================================================
-- 045 -- O REALIZADO DE GRUPO ENTRA NO PREVISTO x REALIZADO (HMO-258)
-- ===========================================================================
-- Medido em `main` (01a7306) por scripts/medidor-hmo258.sql, no mes de maio da
-- conta A da HMO-255 -- mercado 500 e combustivel 400 so dela, jantar de grupo
-- de 90 pago por ela e dividido por 3, mercado de grupo de 60 pago pela B e
-- dividido por 3:
--
--   painel + reports/cash-flow + reports/categories ....... 950,00
--   reports/planned-vs-actual (actual_expense) ............ 900,00   <--
--
-- As duas leituras vivem na MESMA pagina (/dashboard/reports) e discordam em
-- 50,00, que e exatamente a minha parte das duas despesas de grupo do mes
-- (30 do jantar + 20 do mercado da B).
--
-- POR QUE 900 E DEFEITO, E NAO UMA TERCEIRA CONVENCAO LEGITIMA
-- -----------------------------------------------------------
-- A pergunta aberta da HMO-258 e "quando eu pago 90 por tres pessoas, a minha
-- despesa do mes e 90 ou 30?". Ela tem tres respostas defensaveis -- 90 (fluxo
-- de caixa, a tela de Despesas), 30 (minha parte, a 033) e 90 + a parte do que
-- outro pagou (custo com reembolso, HMO-275). Nenhuma delas e ZERO.
--
-- A `planned_vs_actual` responde zero: a despesa de grupo desaparece inteira do
-- lado REALIZADO, qualquer que seja o criterio que a issue venha a escolher. E
-- por isso este conserto NAO depende da decisao de produto que falta na
-- HMO-258 -- ele tira uma das respostas erradas de circulacao sem escolher
-- entre as tres certas.
--
-- O estrago e maior do que um total baixo, porque o relatorio e de VARIANCIA:
-- `expense_variance = actual_expense - planned_expense` existe para dizer
-- "gastou mais do que previu". Com o realizado menor do que qualquer criterio
-- admite, ele parabeniza por uma economia que nao houve -- e faz isso no mesmo
-- /dashboard/reports onde o grafico ao lado mostra 950.
--
-- ISTO E A DIVIDA QUE A 033 DEIXOU ANOTADA, E ELA ANOTOU DE PROPOSITO
-- ------------------------------------------------------------------
-- O cabecalho da 033, em "O QUE ESTA MIGRATION NAO TOCA":
--
--   "`monthly_cash_flow` [...] tambem alimenta `planned_vs_actual` e o consumo
--    de orcamento, que nao estao no pedido."
--
-- Ou seja: a 033 criou `personal_monthly_cash_flow` (o realizado pessoal COM a
-- minha parte de grupo), apontou as outras duas leituras da pagina de
-- relatorios para ela, e deixou a `planned_vs_actual` para tras com a razao
-- escrita. Esta migration e o resgate dessa linha.
--
-- O QUE MUDA, EXATAMENTE
-- ----------------------
-- Duas coisas, e as duas so no lado PESSOAL (`group_id IS NULL`):
--
--   1. O LADO REALIZADO passa a sair de `personal_monthly_cash_flow` em vez de
--      `monthly_cash_flow`. A primeira ja soma a minha parte de grupo; a
--      segunda tem `group_id` no grao, e uma despesa de grupo nunca cai na
--      linha de `group_id IS NULL`.
--
--   2. AS CHAVES ganham uma terceira origem: `group_share_entries`. Sem isso o
--      item 1 nao bastaria -- um mes em que a MINHA unica despesa foi um
--      mercado que a B pagou nao tem linha nenhuma em
--      `financial_transactions` com `user_id = eu`, entao o `UNION` de `chaves`
--      nao produz chave, e o mes simplesmente NAO APARECE no relatorio. Um mes
--      ausente le-se como "nao houve movimento", que e o pior dos sintomas
--      possiveis aqui: silencioso e plausivel.
--
-- O RELATORIO DO GRUPO (`?groupId=`) NAO MUDA
-- -------------------------------------------
-- Quando `k.group_id IS NOT NULL` o realizado continua saindo de
-- `monthly_cash_flow` filtrada por aquele `group_id`, onde o numero certo e o
-- valor CHEIO da despesa, de todos os membros. E a mesma fronteira que a 033
-- defendeu: consertar a leitura pessoal nao pode quebrar a do grupo. A secao 2
-- do teste mede os dois lados no mesmo mes, justamente porque "a pessoal ficou
-- certa" e "a do grupo continuou certa" sao duas afirmacoes diferentes.
--
-- A chave nova de `group_share_entries` entra com `group_id = NULL` DE
-- PROPOSITO: a minha parte de uma despesa da Casa pertence ao meu relatorio
-- PESSOAL, nao ao relatorio da Casa.
--
-- Com o `group_id` real ali, o efeito medido no membro que SO DEVE parte (nao
-- pagou nada no mes) e este:
--
--   group_id = NULL (certo)  -> uma linha PESSOAL de 50,00, a parte dele
--   group_id real (errado)   -> uma linha DO GRUPO de 0,00, e nenhuma pessoal
--
-- A chave com o `group_id` real nao casa com linha nenhuma de
-- `monthly_cash_flow` daquele membro -- ele nao lancou nada --, entao o
-- realizado dele vem zero. O mes inteiro dele sai do relatorio pessoal e vira
-- uma linha inutil no do grupo.
--
-- Vale registrar o erro: a primeira versao deste comentario dizia "dobraria o
-- realizado do grupo". Medir o mutante mostrou que nao dobra nada -- a despesa
-- do membro DESAPARECE. As duas metades estao presas na secao 2b do teste.
--
-- O QUE ESTA MIGRATION NAO TOCA, E A DIVIDA QUE SOBRA
-- --------------------------------------------------
-- `budget_consumption` -- a outra leitura que a 033 citou na mesma frase --
-- continua lendo `monthly_cash_flow` e portanto continua ignorando despesa de
-- grupo no consumo de orcamento. Nao entra aqui porque "quanto do meu orcamento
-- eu gastei" depende do criterio que a HMO-258 vai escolher de um jeito que a
-- variancia nao depende: um orcamento de categoria pode legitimamente querer so
-- o que e meu, so o que saiu da conta, ou o custo com reembolso. Fica anotado
-- aqui, como a 033 anotou isto.
--
-- ELA CARREGA A 043 INTEIRA, E ISSO NAO E DETALHE
-- ----------------------------------------------
-- `CREATE OR REPLACE VIEW` exige a definicao INTEIRA, entao esta migration
-- reproduz tambem o lado PREVISTO -- e o previsto mudou na 043 (HMO-256)
-- enquanto este arquivo estava em revisao. A versao original daqui carregava a
-- forma anterior, `COALESCE(r.transaction_type, 'expense')`, e teria revertido
-- a 043 em silencio: SQL valido, nenhuma suite do 008 reclamando, e toda
-- receita prevista AVULSA de volta a ser contada como conta a pagar.
--
-- O cabecalho da 043 previu exatamente isto e pediu por escrito que quem mexesse
-- na view recolasse os dois FILTER. Foi o que esta versao faz, e e o unico
-- motivo pelo qual o numero deste arquivo e 045 e nao 043.
--
-- COMO RODAR
-- ----------
--   psql "$URL" -v ON_ERROR_STOP=1 -f database/migrations/045_realizado_de_grupo_no_previsto_x_realizado.sql
--
-- Aplicar depois de 001 -> ... -> 044. O preflight aborta listando o que falta.
-- Re-executavel: so tem CREATE OR REPLACE VIEW, COMMENT, GRANT e ALTER VIEW.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Preflight
-- ---------------------------------------------------------------------------
-- As duas views que esta migration passa a ler vem da 033. Sem elas o
-- CREATE OR REPLACE abaixo falharia com "relation does not exist", o que ja
-- seria um erro honesto -- o preflight existe para dizer QUAL migration falta
-- em vez de qual objeto, que e a pergunta que a pessoa tem na hora.
DO $$
DECLARE
  v_faltando TEXT;
BEGIN
  SELECT string_agg(msg, E'\n') INTO v_faltando FROM (
    SELECT '  - view public.planned_vs_actual (vem do 008)' AS msg
    WHERE to_regclass('public.planned_vs_actual') IS NULL
    UNION ALL
    SELECT '  - view public.personal_monthly_cash_flow (vem do 033)'
    WHERE to_regclass('public.personal_monthly_cash_flow') IS NULL
    UNION ALL
    SELECT '  - view public.group_share_entries (vem do 033)'
    WHERE to_regclass('public.group_share_entries') IS NULL
    UNION ALL
    SELECT '  - view public.monthly_cash_flow (vem do 008)'
    WHERE to_regclass('public.monthly_cash_flow') IS NULL
    UNION ALL
    -- Da 027, e a 043 e quem passou a LE-LA aqui. O previsto desta view sai de
    -- `scheduled_transactions_effective.direction`; sem ela o CREATE OR REPLACE
    -- falharia com "relation does not exist" e a tentacao seria recolar o
    -- `COALESCE(r.transaction_type, ...)` antigo -- que compila e reverte a 043.
    SELECT '  - view public.scheduled_transactions_effective (vem do 027)'
    WHERE to_regclass('public.scheduled_transactions_effective') IS NULL
    UNION ALL
    SELECT '  - coluna direction em public.scheduled_transactions_effective (vem do 027/043)'
    WHERE to_regclass('public.scheduled_transactions_effective') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'scheduled_transactions_effective'
           AND column_name = 'direction'
      )
    -- A 022 poe `currency` no GRAO das views de relatorio, e as tres chaves do
    -- UNION abaixo casam por moeda. Sem a 022 a view nasceria somando reais com
    -- dolares -- um total que nao esta em moeda nenhuma.
    UNION ALL
    SELECT '  - coluna currency no grao de public.planned_vs_actual (vem do 022/034)'
    WHERE to_regclass('public.planned_vs_actual') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'planned_vs_actual'
           AND column_name = 'currency'
      )
    UNION ALL
    SELECT '  - coluna currency em public.group_share_entries (vem do 033)'
    WHERE to_regclass('public.group_share_entries') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'group_share_entries'
           AND column_name = 'currency'
      )
  ) AS checks
  WHERE msg IS NOT NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'045 nao pode ser aplicado neste banco. Faltando:\n%\n\nRode 001 -> ... -> 044 antes.', v_faltando;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. planned_vs_actual -- o realizado pessoal passa a incluir a minha parte
-- ---------------------------------------------------------------------------
-- O previsto (`p`) nao muda UMA LINHA em relacao a versao do 008/027/034/037.
-- Esta migration mexe em duas coisas so: a terceira origem de `chaves` e o
-- LATERAL do realizado (`a`). O resto esta reproduzido igual de proposito --
-- `CREATE OR REPLACE VIEW` exige a definicao inteira, e um "pequeno ajuste de
-- passagem" no previsto viria junto sem teste nenhum por cima dele.
CREATE OR REPLACE VIEW public.planned_vs_actual AS
  WITH chaves AS (
    SELECT s.user_id, s.group_id,
           date_trunc('month', s.due_date)::date AS month,
           s.currency
      FROM public.scheduled_transactions s
    UNION
    SELECT t.user_id, t.group_id,
           date_trunc('month', t.transaction_date)::date AS month,
           t.currency
      FROM public.financial_transactions t
     WHERE t.transaction_type IN ('expense', 'income')
    UNION
    -- A TERCEIRA ORIGEM (045). `group_id` NULL: a minha parte de uma despesa da
    -- Casa e do meu relatorio PESSOAL. Sem esta chave, o mes em que a minha
    -- unica despesa foi paga por outro membro nao apareceria no relatorio --
    -- nao como zero, mas AUSENTE.
    SELECT gse.user_id, NULL::uuid AS group_id,
           gse.month,
           gse.currency
      FROM public.group_share_entries gse
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
    -- O PREVISTO E O DA 043, RECOLADO LINHA POR LINHA -- e o cabecalho dela
    -- pediu isto por escrito: "quem mexer em qualquer parte de
    -- `planned_vs_actual` daqui para frente recola os dois FILTER do previsto; a
    -- forma antiga (`COALESCE(r.transaction_type, 'expense')`) reverte esta
    -- migration sem [ninguem reparar]".
    --
    -- Esta migration foi escrita contra a definicao ANTERIOR a 043 e carregava
    -- exatamente aquela forma antiga. Mergeada assim, teria revertido a 043 em
    -- SILENCIO: `CREATE OR REPLACE VIEW` exige a definicao inteira, o SQL
    -- continuaria valido, nenhuma suite do 008 reclamaria, e toda receita
    -- prevista AVULSA voltaria a ser contada como conta a pagar.
    --
    -- `s.direction` (043/HMO-256) resolve a precedencia ocorrencia -> regra ->
    -- 'expense' UMA vez, na 027. O criterio antigo era o `transaction_type` da
    -- REGRA, e previsao avulsa nao tem regra -- por isso ela caia toda em
    -- `planned_expense`.
    SELECT
      SUM(s.amount) FILTER (WHERE s.direction = 'expense') AS planned_expense,
      SUM(s.amount) FILTER (WHERE s.direction = 'income')  AS planned_income,
      -- Contagem de linha EM ABERTO, e nao de divida: receita prevista entra
      -- nos dois contadores, igual a antes da 043.
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
  -- O REALIZADO, EM DUAS FONTES MUTUAMENTE EXCLUSIVAS (045).
  --
  -- As duas pernas do UNION ALL sao guardadas por `k.group_id IS NULL` e
  -- `k.group_id IS NOT NULL`, entao no maximo UMA produz linha para cada chave.
  -- Isso importa: se as duas pudessem casar, o LATERAL devolveria duas linhas,
  -- a chave viraria duas linhas da view e o relatorio contaria o previsto
  -- DUAS VEZES -- um numero dobrado, plausivel, sem erro nenhum.
  --
  -- E por isso que o `k.group_id IS NULL` esta DENTRO de cada perna e nao num
  -- CASE por fora: a exclusao mutua tem de ser uma propriedade do WHERE, nao
  -- uma leitura atenta de quem vier depois.
  LEFT JOIN LATERAL (
    -- PESSOAL: `personal_monthly_cash_flow` (033) ja soma a minha parte de
    -- grupo junto com o que e so meu. Ela nao tem `group_id` -- nem poderia: no
    -- relatorio pessoal a Casa e a Viagem somam na mesma linha.
    SELECT pf.income, pf.expense
      FROM public.personal_monthly_cash_flow pf
     WHERE k.group_id IS NULL
       AND pf.user_id = k.user_id
       AND pf.month = k.month
       AND pf.currency IS NOT DISTINCT FROM k.currency
    UNION ALL
    -- GRUPO: inalterado desde o 008. Aqui o numero certo e o valor CHEIO da
    -- despesa, de todos os membros.
    SELECT f.income, f.expense
      FROM public.monthly_cash_flow f
     WHERE k.group_id IS NOT NULL
       AND f.user_id = k.user_id
       AND f.group_id IS NOT DISTINCT FROM k.group_id
       AND f.month = k.month
       AND f.currency IS NOT DISTINCT FROM k.currency
  ) AS a ON TRUE;

COMMENT ON VIEW public.planned_vs_actual IS
  'Previsto (agenda do 005) contra realizado por mes e MOEDA. A direcao do PREVISTO sai de scheduled_transactions_effective.direction (043): previsao AVULSA de receita entrava em planned_expense porque o criterio era o transaction_type da REGRA, e avulsa nao tem regra. Chaves por UNION de tres origens: agenda, transacoes e a minha parte de grupo (045). O realizado PESSOAL sai de personal_monthly_cash_flow (033, inclui a minha parte de grupo); o do GRUPO sai de monthly_cash_flow (valor cheio). As duas pernas do realizado sao mutuamente exclusivas por group_id. O LATERAL casa a moeda tambem: sem isso um mes com duas moedas duplicaria a linha e repetiria o previsto inteiro em cada uma.';

-- ---------------------------------------------------------------------------
-- 2. security_invoker e GRANTs
-- ---------------------------------------------------------------------------
-- `CREATE OR REPLACE VIEW` APAGA AS reloptions DA VIEW, e `security_invoker` e
-- uma reloption. Quem so troca a definicao e nao reaplica o ALTER deixa a view
-- rodando como o DONO -- e esta view agora atravessa `group_share_entries`, que
-- chega em quatro tabelas de grupo. O sintoma seria cada pessoa vendo a
-- variancia mensal de todas as outras, sem erro nenhum no caminho.
--
-- E a razao de o teste medir isso como um usuario SEM grupo (controle negativo)
-- em vez de so conferir a reloption: a reloption certa com a RLS furada uma
-- camada abaixo tambem passaria.
ALTER VIEW public.planned_vs_actual SET (security_invoker = true);

-- Os mesmos GRANTs do 008, reafirmados porque o REPLACE pode vir de um banco
-- onde eles nunca foram dados.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.planned_vs_actual FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT ON public.planned_vs_actual TO authenticated';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Sonda: a view ficou com security_invoker?
-- ---------------------------------------------------------------------------
-- NOTICE e nao EXCEPTION, no mesmo tom da sonda da 042: o teste do 045 e quem
-- reprova isso de verdade, medindo pela RLS. Esta linha existe para quem aplica
-- a migration a mao no SQL Editor e nao roda o teste.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.planned_vs_actual'::regclass
       AND reloptions @> ARRAY['security_invoker=true']
  ) THEN
    RAISE NOTICE '045: planned_vs_actual ficou SEM security_invoker -- ela esta furando a RLS';
  END IF;
END $$;
