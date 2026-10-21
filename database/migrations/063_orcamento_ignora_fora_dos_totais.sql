-- ===========================================================================
-- 063 -- O TETO DA CATEGORIA IGNORA O LANCAMENTO FORA DOS TOTAIS
--        (HMO-453, F3 da HMO-443)
-- ===========================================================================
-- SO SQL. Nenhum TypeScript, nenhuma tela -- as sete somas em JavaScript da F3
-- vem num PR proprio, e nenhuma delas le esta view
-- (`migration-tem-que-ir-para-main-sozinha`).
--
-- O QUE MUDA
-- ----------
-- UMA linha no `WHERE` da perna 1 de `public.budget_consumption`:
-- `AND t.include_in_total`. Nada mais. Nenhuma coluna nova, nenhuma coluna
-- removida, nenhuma mudanca de nome, tipo ou ordem -- a assinatura da view e a
-- da 049, byte a byte, entao nenhum `.select()` do app precisa saber desta
-- migration.
--
-- POR QUE ELA EXISTE -- A DECISAO B DA HMO-443
-- --------------------------------------------
-- O plano `plan` da HMO-443 fez quatro perguntas ao Helio, e a B era: "despesa
-- fora dos totais consome o orcamento da categoria?". A recomendacao era NAO, e
-- foi aceita em 2026-10-20 junto com o plano (revisao 1, secao 6):
--
--   se nao e despesa de verdade para o relatorio, nao e para o teto.
--
-- Sem esta colagem, desmarcar um lancamento produz um par de numeros que se
-- contradiz na MESMA tela de orcamento: a barra de consumo conta a linha e o
-- total por categoria logo ao lado (que sai de `category_monthly_totals`, ja
-- filtrada pela 060 e ja em producao) nao conta. Dois numeros certos pela
-- propria regra, discordando sem nada que arbitre -- a forma exata de
-- `fontes-consistentes-que-discordam`.
--
-- Esta e a UNICA das oito somas da F3 que nao esta em JavaScript: a view tem o
-- `SUM` dela proprio sobre `financial_transactions` e por isso nao herda nada
-- da cadeia que a 060 filtrou. Levantar leitores pelo NOME da coluna nova acha
-- `app/` e `lib/` e perde exatamente esta -- ela nao cita `include_in_total` e
-- nao roda em JS. O inventario da HMO-443 foi feito pela TABELA
-- (`git grep -l financial_transactions` nas duas metades) justamente por isso.
--
-- ===========================================================================
-- A PERNA 2 **NAO** E FILTRADA, E ISSO E A DECISAO -- NAO UM ESQUECIMENTO
-- ===========================================================================
-- `budget_consumption` tem duas pernas (049), e esta migration toca SO a
-- primeira:
--
--   perna 1  o que EU lancei, pelo valor cheio      ->  FILTRADA aqui
--   perna 2  a minha parte do que OUTRO pagou       ->  INTOCADA
--
-- Quem ler o diff vai estranhar a assimetria. Ela sai da secao 3c do plano e da
-- decisao D, as duas aceitas no mesmo dia: `group_share_entries`,
-- `group_member_balances` e os acertos NAO honram o flag, porque **o que eu
-- devo a alguem nao muda porque eu escondi a linha do meu relatorio**. A perna
-- 2 e exatamente essa divida -- ela le `group_share_entries` -- e o flag da
-- linha e de quem a LANCOU, nao meu: se a B pagasse o mercado do grupo e
-- desmarcasse a linha dela, a minha parte continuaria sendo dinheiro que eu
-- tenho de devolver, e um teto que a esconde me deixa estourar o mes achando
-- que sobrou.
--
-- A perna 1, ao contrario, e RELATORIO DE GASTO -- e e dela que a decisao B
-- fala. O teto nao e divida com ninguem.
--
-- O TETO DE GRUPO HONRA O FLAG, pela mesma razao: a perna 1 e a MESMA subquery
-- nos dois casos (o `CASE` ali so troca quem e o dono do recorte), e um teto de
-- grupo tambem e relatorio de gasto. Nao ha ramo condicional por
-- `b.group_id` aqui de proposito: `AND (b.group_id IS NOT NULL OR
-- t.include_in_total)` seria um quarto criterio de dinheiro em producao sem
-- tela que o explicasse, e o estado que ele separa (um lancamento de grupo
-- desmarcado pelo proprio pagador) nao tem rotulo em lugar nenhum do app.
-- A secao 2 do teste prende as duas metades disto.
--
-- ===========================================================================
-- O CORPO E O DA 049, PALAVRA POR PALAVRA, MAIS UMA LINHA
-- ===========================================================================
-- A 049 e a ultima a tocar esta view -- conferido com
-- `grep -rn "VIEW public.budget_consumption" database/migrations/`, que acha
-- 006, 026 e 049, nesta ordem. O corpo abaixo e o da 049: as duas pernas, o
-- `ABS()` da despesa negativa, a conversao por `exchange_rate` congelada na
-- linha (026), o `NOT e.paguei_eu` da perna 2, o `LEFT JOIN LATERAL ... ON
-- TRUE` que mantem na lista o teto sem gasto, e os quatro campos derivados
-- (`remaining`, `consumed_ratio`, `consumption_status`).
--
-- Ele e repetido INTEIRO porque `CREATE OR REPLACE VIEW` nao tem forma
-- incremental -- e e justamente essa obrigacao que faz migration de view
-- REVERTER migration de view sem sintoma
-- (`create-or-replace-view-de-pr-aberto-reverte-migration-mergeada`). Por isso
-- o db-verify re-roda o teste da 049 DEPOIS deste arquivo: se alguem recolar
-- este corpo a partir da versao da 026, a despesa de grupo que eu paguei
-- desaparece do meu teto e o numero cai de 610 para 500, calado.
--
-- `t.include_in_total` cru, sem `= true` e sem `IS TRUE`: a coluna e NOT NULL
-- (060), entao os tres sao equivalentes aqui, e a forma nua e a que a 060 ja
-- usa no `WHERE` de `category_monthly_totals`. O filtro fica na perna 1 e
-- nao num `FILTER (WHERE ...)` porque a perna 1 nao tem nenhum: ela e um
-- `SUM` so.
--
-- ===========================================================================
-- `security_invoker`: O ALTER DO FIM NAO E REDUNDANTE
-- ===========================================================================
-- `CREATE OR REPLACE VIEW` **APAGA as reloptions** da view -- medido no
-- Postgres 17 e registrado na 035, na 041, na 046, na 060 e na 061
-- (`create-or-replace-view-apaga-reloptions`). Aqui o sintoma e o da 049, e ele
-- vale dinheiro e privacidade ao mesmo tempo: sem o ALTER, `budget_consumption`
-- roda com os direitos do DONO, a RLS do 006 para de valer, e **qualquer
-- logado passa a listar o orcamento de todo mundo**. A falha e CALADA -- num
-- banco de um usuario so, uma view DEFINER devolve exatamente as mesmas linhas
-- que uma view INVOKER, nenhum numero muda e nenhuma suite fica vermelha por
-- conta propria.
--
-- E a quarta vez que a mesma linha e reafirmada nesta mesma view (006, 026,
-- 049, e agora a 063). Ela NAO e precaucao, e load-bearing, e quem a apagar
-- por "isso ja esta ligado" reabre o furo.
--
-- **O ALTER E A ULTIMA INSTRUCAO DO LOTE, DE PROPOSITO.** Como o REPLACE apaga
-- a opcao, ler `security_invoker=true` **junto com** o filtro novo no corpo da
-- view so e possivel se a execucao passou da ultima linha: se a colagem tiver
-- parado no meio, a view existe completa e *sem* a opcao. Um sinal, dois fatos
-- -- "chegou ao fim" e "o furo nao esta aberto" -- e mais forte que sondar um
-- COMMENT, que se faltar e so cosmetico
-- (`migration-colada-pela-metade-e-invisivel`).
--
-- ===========================================================================
-- IDEMPOTENTE, E SEM BACKFILL NENHUM
-- ===========================================================================
-- `CREATE OR REPLACE VIEW`, `COMMENT`, `REVOKE`, `GRANT`,
-- `ALTER VIEW ... SET` e o `INSERT ... ON CONFLICT DO NOTHING` sao todos
-- re-aplicaveis. Re-rodar o arquivo inteiro e no-op.
--
-- **NAO HA `UPDATE` NENHUM AQUI, E NAO PODE HAVER.** Uma view nao guarda dado;
-- o unico `UPDATE` imaginavel seria um "religar quem esta desmarcado" de
-- limpeza, que e o mutante que a 060 descreve no cabecalho dela: ele
-- desfaria, calado, toda escolha que o usuario tivesse feito na tela, na
-- proxima vez que alguem recolasse um arquivo desta familia. A secao 5 do teste
-- e o que impede esse `UPDATE` de aparecer aqui.
--
-- ===========================================================================
-- ESTA COLAGEM **MUDA NUMERO NA TELA**, E A ORDEM E LIVRE
-- ===========================================================================
-- Diferente da 060 e da 061, esta migration NAO e aditiva no sentido de "nada
-- muda": ela muda `spent`, e com ele `remaining`, `consumed_ratio` e
-- `consumption_status` de todo teto que tenha, no mes, um lancamento
-- desmarcado. E essa mudanca e o proposito -- a barra que contava a linha para
-- de conta-la.
--
-- Mas a ORDEM em relacao ao deploy e livre, nos dois sentidos, e por um motivo
-- so: **nenhum codigo precisa mudar para esta colagem funcionar**. A
-- assinatura da view e identica, o app le as mesmas colunas, e nenhum `.select()`
-- nomeia coluna nova -- entao nao ha a janela de
-- `select-que-nomeia-coluna-nova-derruba-a-rota-antes-da-colagem`. Colar antes
-- do PR das somas em JS deixa o orcamento certo e as outras sete somas ainda
-- contando a linha; colar depois deixa o contrario. Nenhum dos dois estados
-- quebra tela nenhuma.
--
-- Num banco em que ninguem desmarcou nada, a colagem nao move um centavo:
-- `include_in_total` nasce `true` para toda linha, velha e nova (DEFAULT da
-- 060), e `AND t.include_in_total` nao descarta nada.
--
-- Cola como lote unico no SQL Editor (nenhum meta-comando de psql aqui).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Preflight: a cadeia que esta view precisa
-- ---------------------------------------------------------------------------
-- EXCEPTION e nao NOTICE, e as tres colunas sao as que fazem o corpo abaixo
-- compilar OU somar errado:
--
--   * `include_in_total` (060) e a coluna que esta migration existe para
--     filtrar. Sem ela o `CREATE OR REPLACE VIEW` falha com
--     `42703 column t.include_in_total does not exist` -- o que ja seria
--     barulhento --, mas a mensagem nao diz QUAL migration falta, e quem cola a
--     mao no SQL Editor fica com um erro de coluna sem saber que o arquivo
--     anterior e a 060;
--   * `paguei_eu` em `group_share_entries` (033) e `exchange_rate` em
--     `financial_transactions` (026) sao as duas da perna 2 e da conversao, e
--     estao aqui pelo mesmo motivo que a 049 as checa: este arquivo recola o
--     corpo DELA, entao herda as dependencias DELA.
DO $$
DECLARE
  v_faltando TEXT;
BEGIN
  SELECT string_agg(msg, E'\n') INTO v_faltando
  FROM (
    SELECT '  - coluna include_in_total em public.financial_transactions (vem do 060)' AS msg
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'financial_transactions'
         AND column_name = 'include_in_total'
    )
    UNION ALL
    SELECT '  - coluna exchange_rate em public.financial_transactions (vem do 026)'
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'financial_transactions'
         AND column_name = 'exchange_rate'
    )
    UNION ALL
    SELECT '  - coluna paguei_eu em public.group_share_entries (vem do 033)'
    WHERE to_regclass('public.group_share_entries') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'group_share_entries'
           AND column_name = 'paguei_eu'
      )
  ) AS checks
  WHERE msg IS NOT NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'063 nao pode ser aplicado neste banco. Faltando:\n%\n\nRode 001 -> ... -> 062 antes.', v_faltando;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. budget_consumption -- a perna 1 passa a ignorar o desmarcado
-- ---------------------------------------------------------------------------
-- As colunas e a ordem delas sao as da 049, inalteradas. O que muda e o
-- `spent` da perna 1 -- e, por consequencia, `remaining`, `consumed_ratio` e
-- `consumption_status`, que saem dele.
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
      --
      -- 063: `AND t.include_in_total` -- o lancamento que a pessoa tirou dos
      -- relatorios tambem nao consome o teto da categoria (decisao B da
      -- HMO-443). E a perna 2 NAO ganha o mesmo filtro, de proposito: ver o
      -- bloco "A PERNA 2 NAO E FILTRADA" no cabecalho.
      (
        SELECT SUM(ABS(t.amount) * t.exchange_rate) AS v
        FROM public.financial_transactions t
        WHERE t.category_id = b.category_id
          AND t.transaction_type = 'expense'
          AND t.include_in_total
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
      --
      -- SEM `t.include_in_total` AQUI (063). O JOIN com
      -- `financial_transactions` existe para pegar a COTACAO da linha, e nao
      -- para herdar o flag dela: o flag e de quem LANCOU, e a minha parte
      -- continua sendo dinheiro que eu devo. Decisao D / secao 3c da HMO-443,
      -- e a secao 3 do teste e quem prende isto.
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
  'budgets com o consumido, o que resta e o status (ok/alert/exceeded) calculados na leitura. O consumido de um teto PESSOAL e CUSTO, nao caixa: bruto + reembolso -- valor cheio do que EU lancei (inclusive despesa de grupo que eu paguei) mais A MINHA PARTE do que OUTRO pagou. Criterio escolhido na HMO-258 em 08/10/2026, o mesmo da HMO-275 e da 046. O teto de GRUPO continua somando o valor cheio gasto por todos os membros, e a perna do reembolso fica desligada nele. Gasto convertido para BRL pela cotacao congelada de cada lancamento, que e a moeda de amount_limit. HMO-443/063: a perna do valor cheio IGNORA o lancamento desmarcado (financial_transactions.include_in_total = false) -- se nao e despesa de verdade para o relatorio, nao e para o teto (decisao B). A perna do REEMBOLSO nao honra o flag de proposito: o que eu devo a alguem nao muda porque quem lancou escondeu a linha do relatorio dele (decisao D).';

-- ---------------------------------------------------------------------------
-- 2. `security_invoker` DE VOLTA -- o passo que se esquece
-- ---------------------------------------------------------------------------
-- Ver o bloco homonimo no cabecalho. `CREATE OR REPLACE VIEW` apaga as
-- reloptions; sem este ALTER a view acima vira DEFINER e vaza o orcamento de
-- todos os usuarios, calado, sem mudar numero nenhum num banco de teste de um
-- usuario so.
ALTER VIEW public.budget_consumption SET (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 3. GRANTs reafirmados
-- ---------------------------------------------------------------------------
-- Mesma razao da secao 2: a 006, a 026 e a 049 ja concederam e
-- `CREATE OR REPLACE` preserva os privilegios -- mas "preserva" e o que separa
-- este arquivo de uma view ilegivel para o app (ou legivel para `anon`).
-- Repetir e barato. Os dois dentro de `DO` porque os papeis `anon` e
-- `authenticated` nao existem num Postgres sem o shim do Supabase, e a 049 ja
-- resolveu assim.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.budget_consumption FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT ON public.budget_consumption TO authenticated';
  END IF;
END $$;

INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('063', '063_orcamento_ignora_fora_dos_totais',
        'budget_consumption ignora o lancamento com include_in_total = false na perna do valor cheio - HMO-453/HMO-443', now())
ON CONFLICT (version) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Posflight: a view ficou com security_invoker, e o filtro entrou?
-- ---------------------------------------------------------------------------
-- NOTICE e nao EXCEPTION, no mesmo tom da 042/045/046/049: quem reprova isso de
-- verdade e o teste desta migration (que mede PELA RLS, com dois usuarios) e o
-- `view_security_invoker_test.sql`. Estas linhas existem para quem aplica a mao
-- no SQL Editor e nao roda teste.
--
-- A SEGUNDA SONDA LE O CORPO DA VIEW, e nao um COMMENT: `pg_get_viewdef`
-- devolve o SQL que o Postgres guardou, entao `include_in_total` aparecendo
-- nele prova que o REPLACE desta migration pegou -- e nao que o arquivo foi
-- aberto. Um COMMENT presente com corpo velho e exatamente o estado que
-- `migration-colada-pela-metade-e-invisivel` descreve. A sonda nao distingue a
-- perna 1 da perna 2 (as duas citam `financial_transactions`), e nao e ela que
-- prende a assimetria: isso e a secao 3 do teste.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.budget_consumption'::regclass
       AND COALESCE(reloptions @> ARRAY['security_invoker=true'], FALSE)
  ) THEN
    RAISE NOTICE '063: budget_consumption ficou SEM security_invoker (furando a RLS)';
  END IF;

  IF pg_get_viewdef('public.budget_consumption'::regclass) NOT LIKE '%include_in_total%' THEN
    RAISE NOTICE '063: o corpo de budget_consumption NAO cita include_in_total -- a colagem nao pegou';
  END IF;
END $$;

COMMIT;
