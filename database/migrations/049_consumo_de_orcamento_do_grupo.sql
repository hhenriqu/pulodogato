-- ===========================================================================
-- 049 -- O CONSUMO DE ORCAMENTO CONTA A DESPESA DE GRUPO (HMO-347)
-- ===========================================================================
-- `budget_consumption` responde "quanto do meu orcamento eu ja gastei" e
-- IGNORAVA despesa de grupo inteira. Medido num banco com a cadeia 001 -> 048 e
-- a fixture de maio/2026 da conta A da HMO-255 (mercado 500 so dela,
-- combustivel 400 so dela, jantar de 90 pago por ela e dividido por 3, mercado
-- de 60 pago pela B e dividido por 3), com um teto PESSOAL de 700,00 na
-- categoria de mercado:
--
--                                         antes da 049   depois dela
--   spent ..............................     500,00       610,00
--   consumed_ratio .....................     0,7143       0,8714
--   consumption_status .................     ok           alert   <-- a barra
--
-- Os 90 que ela PAGOU e os 20 que ela DEVE do mercado da B nao entravam em
-- numero nenhum: a barra ficava verde num mes em que o teto ja estourou os 80%.
--
-- ESTE E O SEGUNDO DOS DOIS LEITORES QUE A 033 ANOTOU
-- --------------------------------------------------
-- A 033 escreveu, em "O QUE ESTA MIGRATION NAO TOCA": *"tambem alimenta
-- `planned_vs_actual` e o consumo de orcamento, que nao estao no pedido."* A
-- HMO-258 fechou o primeiro (045 aponta o lado pessoal da `planned_vs_actual`
-- para `personal_monthly_cash_flow`; 046 unificou o criterio). Este arquivo
-- fecha o segundo, e a frase da 033 deixa de ter divida pendente.
--
-- O CRITERIO E O MESMO, E ELE JA ESTAVA DECIDIDO
-- ---------------------------------------------
-- Em 08/10/2026, na interaction da HMO-258, o Helio escolheu **bruto +
-- reembolso**: INTEIRO quando EU paguei, MINHA PARTE quando OUTRO pagou. E o
-- criterio da HMO-275 em Financas Pessoais e, desde a 046, o do painel e dos
-- relatorios. Nenhuma decisao nova e tomada aqui.
--
-- Vale dizer por que a pergunta do orcamento NAO podia entrar na HMO-258 junto
-- com a variancia: "gastou mais do que previu" nao dependia da decisao de
-- produto -- ZERO esta errado sob qualquer criterio. "Quanto do meu orcamento
-- eu gastei" depende: ha leitura defensavel em que o orcamento e de CAIXA (so o
-- que saiu da conta, 590 aqui) em vez de CUSTO (610). A decisao de 08/10 e de
-- custo, e e ela que vale -- a leitura de caixa continua existindo, com rotulo
-- proprio, em `/api/movimentacoes/resumo` e em `net_worth_history`.
--
-- ===========================================================================
-- O QUE MUDA, EXATAMENTE -- DUAS LINHAS, E ELAS SO FUNCIONAM JUNTAS
-- ===========================================================================
-- O LATERAL de `budget_consumption` vira a soma de DUAS pernas, nos mesmos dois
-- movimentos da 046 -- e cada um sem o outro e um defeito ja medido:
--
--   1. A perna do VALOR CHEIO perde o `AND t.group_id IS NULL` do ramo pessoal.
--      Com ele, a despesa de grupo que EU paguei nunca era contada: 500 em vez
--      de 590.
--
--   2. Entra uma perna de REEMBOLSO: a minha parte do que OUTRO pagou, de
--      `group_share_entries` com `NOT paguei_eu`. Sem o `NOT`, a minha parte de
--      30 do jantar viria SOMADA aos 90 da perna 1 -- 120 de uma despesa de 90,
--      a mesma dupla contagem que a 046 descreve.
--
-- O ramo de teto de GRUPO (`b.group_id IS NOT NULL`) fica IDENTICO: ele ja
-- somava o gasto de todos os membros por `t.group_id = b.group_id`, e continua
-- somando, pelo valor cheio. A perna 2 e explicitamente desligada ali
-- (`b.group_id IS NULL`): um teto de viagem que somasse "a minha parte" por
-- cima do valor cheio da viagem contaria a mesma despesa duas vezes, e a barra
-- da viagem subiria a cada membro novo.
--
-- POR QUE A MESMA DESPESA PODE APARECER EM DOIS TETOS
-- --------------------------------------------------
-- Com um teto pessoal de mercado e um teto da Casa na mesma categoria e mes, o
-- jantar de 90 que eu paguei entra nos DOIS. Isso nao e dupla contagem: sao
-- duas perguntas diferentes, com dois donos diferentes, e a 006 ja dizia isso
-- ("sao dois bolsos diferentes"). Somar os dois num numero so e o bug que
-- `lib/orcamento-de-grupo.ts` existe inteiro para impedir -- e continua
-- impedindo, porque a separacao dele e por `b.group_id`, que nao muda aqui.
--
-- POR QUE NAO LER `personal_category_monthly_totals`, QUE JA TEM O CRITERIO
-- ------------------------------------------------------------------------
-- Ela e a dona do criterio desde a 046, e o grao dela (usuario, mes, categoria)
-- e exatamente o grao de um teto. Era a leitura obvia -- e ela PERDERIA a
-- conversao de moeda que a 026 trouxe para ca.
--
-- `personal_category_monthly_totals` tem `currency` no GRAO e os valores na
-- moeda de cada lancamento, nao em BRL (foi a 022 que decidiu isso, e esta
-- certa: "gastei 1.000 reais e 180 dolares" e a resposta certa de um relatorio
-- pessoal). `budgets.amount_limit` e um numero em REAIS digitado por uma
-- pessoa. Para comparar, a 026 converte cada linha pela cotacao congelada
-- naquela linha -- e ler a view agregada obrigaria a escolher entre somar reais
-- com dolares (errado em silencio) e filtrar `currency = 'BRL'` (que apagaria
-- do teto a despesa da viagem ao exterior, de novo em silencio).
--
-- Entao a perna 2 le `group_share_entries`, que e a UNICA definicao de "minha
-- parte" e tem grao de LINHA -- e e nesse grao que a cotacao existe. O que esta
-- migration escreve a mao nao e o criterio de rateio (esse continua so na 033);
-- e so o `NOT paguei_eu` e a conversao, os dois visiveis em uma linha cada.
--
-- O JOIN COM `financial_transactions` NA PERNA 2 NAO FILTRA NADA
-- -------------------------------------------------------------
-- Ele existe por UM motivo: `group_share_entries` expoe `currency` mas nao
-- `exchange_rate`, e sem a cotacao a parte de uma despesa em dolar entraria no
-- teto em reais pelo numero errado. O JOIN e por `t.id = e.transaction_id` (FK
-- para a PK, 1:1, nao duplica) e nao pode descartar linha: a propria
-- `group_share_entries` ja junta essa mesma transacao la dentro, entao uma
-- linha invisivel pela RLS nunca chegaria aqui para ser filtrada.
--
-- A alternativa era APENDAR `exchange_rate` em `group_share_entries`. Ficaria
-- mais bonito e foi descartado de proposito: aquela view e da 033, tem a suite
-- e o runner de mutante da 033 e da 046 pendurados nela, e recolar a definicao
-- inteira por causa de uma coluna e exatamente o movimento que ja reverteu
-- migration irma neste repositorio.
--
-- O QUE ESTA MIGRATION NAO TOCA
-- -----------------------------
--   * `group_member_balances` (quem deve a quem) -- outra pergunta.
--   * o ramo de teto de GRUPO, acima.
--   * `lib/orcamento-de-grupo.ts` e `/api/budgets`. Conferido: a rota NAO
--     filtra `group_id IS NULL` em lugar nenhum (ela so aplica o `.eq` quando a
--     tela do grupo pede UM grupo), e a separacao pessoal/grupo da tela e por
--     `b.group_id`, que continua certo. Ou seja: ao contrario da
--     `planned_vs_actual`, onde o defeito estava na view E na rota, aqui ele
--     esta so na view -- consertar a view muda o numero na tela.
--   * a RECEITA do reembolso. O que os outros me devem do jantar nao e receita
--     deste mes; e um credito a receber, e orcamento e teto de DESPESA.
--
-- Idempotente: pode rodar duas vezes seguidas sem erro.
-- Cola como lote unico no SQL Editor (nenhum meta-comando de psql aqui).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Preflight -- o que esta migration PRECISA achar no banco
-- ---------------------------------------------------------------------------
-- Mesmo desenho do preflight da 045/046, e pela mesma razao: aplicada fora de
-- ordem no SQL Editor, esta migration recolaria `budget_consumption` sem a
-- perna 2 (se `group_share_entries` nao existisse o CREATE falharia, isso sim)
-- ou sem a conversao (se `exchange_rate` nao existisse). O erro de uma coluna
-- faltando sai como "column does not exist" no meio de um CREATE VIEW, que nao
-- diz qual migration falta.
DO $$
DECLARE
  v_faltando TEXT;
BEGIN
  SELECT string_agg(msg, E'\n') INTO v_faltando
  FROM (
    SELECT '  - view public.budget_consumption (vem do 006, reescrita pela 026)' AS msg
    WHERE to_regclass('public.budget_consumption') IS NULL
    UNION ALL
    SELECT '  - view public.group_share_entries (vem do 033)'
    WHERE to_regclass('public.group_share_entries') IS NULL
    UNION ALL
    -- A coluna que carrega "quem pagou". Sem ela a perna 2 nao tem como
    -- descartar o que eu mesma paguei, e o resultado seria dupla contagem.
    SELECT '  - coluna paguei_eu em public.group_share_entries (vem do 033)'
    WHERE to_regclass('public.group_share_entries') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'group_share_entries'
           AND column_name = 'paguei_eu'
      )
    UNION ALL
    -- A cotacao congelada da 026. Sem ela as duas pernas somariam reais com
    -- dolares num teto que e em reais.
    SELECT '  - coluna exchange_rate em public.financial_transactions (vem do 026)'
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'financial_transactions'
         AND column_name = 'exchange_rate'
    )
  ) AS checks
  WHERE msg IS NOT NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'049 nao pode ser aplicado neste banco. Faltando:\n%\n\nRode 001 -> ... -> 048 antes.', v_faltando;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. budget_consumption -- bruto + reembolso
-- ---------------------------------------------------------------------------
-- As colunas e a ordem delas sao as da 026, inalteradas: `CREATE OR REPLACE
-- VIEW` so aceita APENDAR, e nada aqui precisa de coluna nova. O que muda e o
-- `spent` -- e, por consequencia, `remaining`, `consumed_ratio` e
-- `consumption_status`, que saem dele.
--
-- `spent` NUNCA e NULL agora (as duas pernas vem com COALESCE), e o
-- `COALESCE(g.spent, 0)` de fora continua escrito mesmo assim: o LEFT JOIN
-- LATERAL e quem garante que um teto SEM gasto nenhum nao desapareca da lista,
-- e tirar aquele COALESCE o deixaria depender de um detalhe do subquery. O teto
-- recem-criado do mes que vem e o caso -- `budget_invoice_test.sql` prende ele.
CREATE OR REPLACE VIEW public.budget_consumption AS
  SELECT
    b.id,
    b.user_id,
    b.category_id,
    b.group_id,
    b.month,
    b.amount_limit,
    b.alert_threshold,
    b.carry_forward,
    b.notes,
    b.created_at,
    b.updated_at,
    COALESCE(g.spent, 0)::numeric(15,2) AS spent,
    (b.amount_limit - COALESCE(g.spent, 0))::numeric(15,2) AS remaining,
    ROUND(COALESCE(g.spent, 0) / b.amount_limit, 4) AS consumed_ratio,
    CASE
      WHEN COALESCE(g.spent, 0) >= b.amount_limit THEN 'exceeded'
      WHEN COALESCE(g.spent, 0) >= b.amount_limit * b.alert_threshold THEN 'alert'
      ELSE 'ok'
    END AS consumption_status
  FROM public.budgets b
  LEFT JOIN LATERAL (
    SELECT COALESCE(cheio.v, 0) + COALESCE(reembolso.v, 0) AS spent
    FROM
      -- PERNA 1 -- TUDO O QUE EU LANCEI, pelo valor CHEIO, inclusive a despesa
      -- de grupo que eu paguei. A janela de mes, o ABS() da despesa negativa e
      -- a conversao pela cotacao da propria linha sao os da 026, intocados.
      --
      -- O `AND t.group_id IS NULL` do ramo pessoal SAIU (049): era ele que
      -- apagava do meu teto o que eu mesma paguei pelo grupo. Isto so esta
      -- correto porque a perna 2 descarta `paguei_eu`.
      (
        SELECT SUM(ABS(t.amount) * t.exchange_rate) AS v
        FROM public.financial_transactions t
        WHERE t.category_id = b.category_id
          AND t.transaction_type = 'expense'
          AND t.transaction_date >= b.month
          AND t.transaction_date < (b.month + INTERVAL '1 month')::date
          AND CASE
                WHEN b.group_id IS NOT NULL THEN t.group_id = b.group_id
                ELSE t.user_id = b.user_id
              END
      ) AS cheio,

      -- PERNA 2 -- O REEMBOLSO QUE EU DEVO: a minha parte do que OUTRO pagou.
      --
      -- `b.group_id IS NULL` desliga a perna inteira no teto de GRUPO, onde a
      -- perna 1 ja somou a viagem inteira. `NOT e.paguei_eu` tira o que eu
      -- paguei, que a perna 1 ja trouxe cheio.
      --
      -- `e.month` e `date_trunc('month', transaction_date)` desde a 033, e
      -- `b.month` e sempre dia 1 (CHECK do 006): a igualdade recorta o mesmo mes
      -- que a janela da perna 1.
      --
      -- `e.amount` e POSITIVO por construcao (a 033 e explicita: "quem le isto
      -- NAO deve aplicar ABS de novo nem inverter o sinal"), entao aqui nao ha
      -- ABS -- um ABS inofensivo esconderia o dia em que aquela convencao
      -- mudasse.
      (
        SELECT SUM(e.amount * t.exchange_rate) AS v
        FROM public.group_share_entries e
        JOIN public.financial_transactions t ON t.id = e.transaction_id
        WHERE b.group_id IS NULL
          AND e.user_id = b.user_id
          AND e.category_id = b.category_id
          AND e.month = b.month
          AND NOT e.paguei_eu
      ) AS reembolso
  ) AS g ON TRUE;

COMMENT ON VIEW public.budget_consumption IS
  'budgets com o consumido, o que resta e o status (ok/alert/exceeded) calculados na leitura. O consumido de um teto PESSOAL e CUSTO, nao caixa: bruto + reembolso -- valor cheio do que EU lancei (inclusive despesa de grupo que eu paguei) mais A MINHA PARTE do que OUTRO pagou. Criterio escolhido na HMO-258 em 08/10/2026, o mesmo da HMO-275 e da 046. O teto de GRUPO continua somando o valor cheio gasto por todos os membros, e a perna do reembolso fica desligada nele. Gasto convertido para BRL pela cotacao congelada de cada lancamento, que e a moeda de amount_limit.';

-- ---------------------------------------------------------------------------
-- 2. security_invoker e GRANTs
-- ---------------------------------------------------------------------------
-- `CREATE OR REPLACE VIEW` APAGA as reloptions da view, e `security_invoker` e
-- uma reloption. Aqui isso vale dinheiro e privacidade ao mesmo tempo, e o
-- sintoma e MAIOR do que era na 026: a view passou a ler `group_share_entries`,
-- que a 033 deixou SEM filtro de user_id de proposito ("quem le PRECISA
-- filtrar"). A perna 2 filtra (`e.user_id = b.user_id`), entao o teto nao
-- mistura pessoas -- mas `budget_consumption` sem `security_invoker` roda com
-- os direitos do DONO, a RLS do 006 para de valer, e qualquer logado passa a
-- listar o orcamento de TODO MUNDO.
ALTER VIEW public.budget_consumption SET (security_invoker = true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.budget_consumption FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT ON public.budget_consumption TO authenticated';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Sonda: a view ficou com security_invoker?
-- ---------------------------------------------------------------------------
-- NOTICE e nao EXCEPTION, no mesmo tom da 042/045/046: quem reprova isso de
-- verdade e o teste desta migration (que mede PELA RLS, com dois usuarios) e o
-- `view_security_invoker_test.sql`. Esta linha existe para quem aplica a mao no
-- SQL Editor e nao roda teste.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.budget_consumption'::regclass
       AND COALESCE(reloptions @> ARRAY['security_invoker=true'], FALSE)
  ) THEN
    RAISE NOTICE '049: budget_consumption ficou SEM security_invoker (furando a RLS)';
  END IF;
END $$;

COMMIT;
