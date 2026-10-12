-- ===========================================================================
-- 054 -- A OCORRENCIA APAGADA SAI DO PREVISTO x REALIZADO (HMO-402)
-- ===========================================================================
-- Achado pela validacao larga da HMO-400 (PR #299), medido em PRODUCAO no
-- commit `dacb1ad` e isolado com controle negativo. Remedido local nesta
-- cadeia (001 -> ... -> 053) antes de escrever esta migration.
--
-- O SINTOMA, EM UMA LINHA
-- -----------------------
-- Apagar a ocorrencia de um mes de uma conta FIXA a tira do Fluxo de Caixa, da
-- agenda, do painel e do resumo -- e o Relatorio Previsto x Realizado continua
-- contando ela.
--
-- A MEDICAO QUE ISOLA, E POR QUE O CONTROLE NEGATIVO E O QUE PROVA
-- ---------------------------------------------------------------
-- `scripts/medicao-receita-apagada-no-relatorio.mjs`, em producao:
--
--                             base       com    depois
--   avulsa apagada            5000   5777,77      5000   LIMPOU
--   ocorrencia de fixa        5000   5777,77   5777,77   NAO LIMPOU
--
-- A avulsa e o CONTROLE NEGATIVO: mesma rota de DELETE, mesmo mes, mesma
-- leitura, e ela limpa. Sem ela, "o numero nao mudou" se leria como janela da
-- sonda ou parametro errado. Com ela, o defeito esta provado no que o DELETE
-- faz por tras -- e sao tres escritas diferentes para o mesmo gesto:
--
--   forma                          o DELETE grava      a view
--   prevista avulsa                a linha e APAGADA   limpa
--   ocorrencia de fixa             status='skipped'    CONTA      <-- o defeito
--   serie inteira (todas)          status='cancelled'  limpa
--
-- `skipped` e deliberado e nao e para mudar: a ocorrencia apagada precisa ficar
-- na tabela para nao RESSUSCITAR na agenda no proximo materializador. O defeito
-- nao e a escrita, e a leitura.
--
-- A CAUSA, E POR QUE SO ESTA LEITURA ERRA
-- --------------------------------------
-- O previsto desta view soma com `AND s.status <> 'cancelled'`. `skipped` passa.
--
-- Toda OUTRA leitura do previsto no sistema filtra `status = 'pending'`, que
-- exclui `skipped` de graca. Esta e a unica escrita como "tudo que nao foi
-- cancelado" -- lista por EXCLUSAO em vez de por inclusao. E por isso que o
-- `skipped`, que entrou no enum depois, entrou sozinho nesta soma e em nenhuma
-- outra.
--
-- O comentario que a linha ja carregava desde o 008 ("cancelada nunca foi
-- previsao de verdade") descreve exatamente o mesmo caso: uma ocorrencia que o
-- usuario apagou nao vai acontecer. O conserto e o que aquele comentario ja
-- dizia, aplicado ao estado que faltava.
--
-- O LADO DA DESPESA TEM O MESMO DEFEITO -- E AGORA ESTA MEDIDO
-- -----------------------------------------------------------
-- A HMO-402 registrou isto como "li no SQL e nao medi". Medido nesta cadeia
-- local, em outubro/2026, com salario fixo de 5.000 e aluguel fixo de 1.700,
-- apagando a ocorrencia dos dois:
--
--                     planned_income  planned_expense  pending_count  expense_variance
--   base (pending)           5300,00          1820,00              4
--   depois de apagar         5000,00          1700,00              0         -1700,00
--
-- (os 300 e os 120 que somem sao as avulsas do controle negativo, que o DELETE
-- de verdade apaga)
--
-- `planned_expense` e `planned_income` sao dois `SUM(...) FILTER` sob o MESMO
-- `WHERE`, entao o defeito e simetrico. No lado da despesa o estrago e pior do
-- que um total alto, porque o relatorio e de VARIANCIA: `expense_variance`
-- ficou **-1.700,00**, que a tela le como "gastou 1.700 menos do que previu".
-- O relatorio parabeniza por uma economia que nao houve, por causa de uma linha
-- que o usuario apagou.
--
-- `pending_count` = 0 COM `planned_income` = 5.000 NA MESMA LINHA
-- --------------------------------------------------------------
-- Os dois contadores (`pending_count`, `overdue_count`) filtram
-- `status = 'pending'`, entao eles sempre estiveram certos. O resultado e uma
-- linha da view que se contradiz: "0 lancamentos em aberto" ao lado de
-- "R$ 5.000 previstos". Nenhuma das duas metades e nova; o que esta migration
-- faz e por as duas de acordo. O teste prende essa concordancia, porque ela e o
-- jeito mais barato de pegar a regressao sem saber o valor esperado.
--
-- O QUE MUDA: UMA LINHA
-- --------------------
--   -      AND s.status <> 'cancelled'
--   +      AND s.status NOT IN ('cancelled', 'skipped')
--
-- E POR QUE NAO A FORMA POSITIVA (`status IN ('pending','paid')`)
-- --------------------------------------------------------------
-- A forma por inclusao seria imune ao proximo estado novo, que e a causa-raiz
-- desta issue, e eu considerei trocar. Nao troquei por um motivo medido: o enum
-- `scheduled_status` tem cinco valores (`pending`, `paid`, `overdue`, `skipped`,
-- `cancelled`) e `overdue` NAO e escrito na coluna por ninguem -- ele e
-- derivado, mora em `scheduled_transactions_effective.effective_status` e vem
-- de um CASE sobre `due_date`. Conferido: nenhuma rota, nenhum trigger e nenhuma
-- migration grava `status = 'overdue'` na tabela.
--
-- Entao hoje as duas formas dao o mesmo numero, e a positiva mudaria o
-- comportamento de uma linha `overdue` crua se alguma passar a existir --
-- silenciosamente tirando do previsto uma conta que VENCEU e continua a pagar,
-- que e um defeito pior do que o que estou consertando, e fora do pedido.
--
-- A protecao contra o proximo estado novo vai no TESTE, nao na view: a secao 5
-- do `054_..._test.sql` enumera `scheduled_status` e exige que todo valor esteja
-- classificado de proposito. Um `ALTER TYPE ... ADD VALUE` futuro reprova o
-- db-verify com o nome do estado novo, em vez de entrar na soma do previsto de
-- graca -- que foi exatamente como o `skipped` chegou aqui.
--
-- ESTE ARQUIVO CARREGA A 043 E A 045 INTEIRAS, E ISSO NAO E DETALHE
-- ----------------------------------------------------------------
-- `CREATE OR REPLACE VIEW` exige a definicao INTEIRA. O cabecalho da 043 pediu
-- por escrito que quem mexesse nesta view recolasse os dois `FILTER` do
-- previsto (`s.direction`), e a 045 quase reverteu a 043 em silencio por nao ter
-- feito isso -- SQL valido, nenhuma suite reclamando, e toda receita prevista
-- AVULSA de volta a ser contada como conta a pagar.
--
-- Esta migration reproduz a definicao da 045 BYTE A BYTE com a unica excecao da
-- linha do filtro. O que vem de antes e esta aqui so por obrigacao do REPLACE:
--
--   * os dois `SUM(...) FILTER (WHERE s.direction = ...)` ............ 043
--   * a terceira origem de `chaves` (`group_share_entries`) ......... 045
--   * o realizado em duas pernas mutuamente exclusivas por group_id .. 045
--   * o casamento de moeda nos dois LATERAL ......................... 022/034
--
-- O db-verify re-roda as suites da 043 e da 045 DEPOIS desta migration, que e o
-- que prova que o recolar nao reverteu nenhuma das duas. Sem esses dois steps,
-- este arquivo e exatamente a forma de acidente que a 045 documentou.
--
-- O QUE ESTA MIGRATION NAO TOCA
-- -----------------------------
-- A rota de DELETE continua REBAIXANDO `cancelled` para `skipped`: mandar
-- `{alcance:"apenas_esta"}` numa ocorrencia JA cancelada responde 200 e a
-- reescreve como `skipped` (medido em producao, HMO-400). Antes desta migration
-- isso era um caminho que FAZIA O VALOR VOLTAR ao relatorio -- apagar a serie
-- inteira limpava, apagar uma ocorrencia de novo recriava o fantasma.
--
-- Depois desta migration os dois estados estao fora do previsto, entao o
-- rebaixamento para de custar dinheiro em qualquer leitura: `skipped` e
-- `cancelled` passam a ser indistinguiveis para todas elas. O que sobra e um
-- soft delete nao-monotonico (escreve estado fixo em vez de respeitar estado
-- final ja alcancado), que e conserto de ROTA -- TypeScript, nao SQL -- e nao
-- pode vir aqui: migration vai para a main sozinha, sem `lib/`, rota ou tela.
-- Fica numa issue filha.
--
-- Na mesma linha, `database/migrations/022_currency.sql` e a 043 e a 045 ficam
-- com a definicao antiga nos ARQUIVOS, como sempre -- a cadeia e historica e
-- reescrever migration colada e que seria o erro. Quem le a view de hoje le
-- este arquivo.
--
-- COMO RODAR
-- ----------
--   psql "$URL" -v ON_ERROR_STOP=1 -f database/migrations/054_ocorrencia_apagada_fora_do_previsto.sql
--
-- Aplicar depois de 001 -> ... -> 053. O preflight aborta listando o que falta.
-- Re-executavel: so tem CREATE OR REPLACE VIEW, COMMENT, GRANT e ALTER VIEW.
--
-- APLICAR COM A MAIN "VELHA" E INOFENSIVO: nenhum codigo em producao muda de
-- comportamento por causa desta migration. Ela tira linhas de uma SOMA de uma
-- view que o app ja le -- as colunas, os tipos e o contrato continuam os
-- mesmos. Nao ha ordem a respeitar entre esta colagem e deploy nenhum.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Preflight
-- ---------------------------------------------------------------------------
-- Esta migration recola a definicao da 045, que atravessa objetos de quatro
-- migrations anteriores. Sem eles o `CREATE OR REPLACE` falharia com "relation
-- does not exist" -- erro honesto, mas que responde "qual objeto" quando a
-- pergunta de quem esta colando e "qual migration falta".
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
    -- Da 027, e a 043 e quem passou a LE-LA aqui. Sem a coluna `direction` a
    -- tentacao seria recolar o `COALESCE(r.transaction_type, ...)` antigo, que
    -- compila e reverte a 043 -- o acidente que a 045 documentou.
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
    UNION ALL
    -- A 022 poe `currency` no GRAO das views de relatorio, e as tres chaves do
    -- UNION casam por moeda. Sem ela a view somaria reais com dolares.
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
    UNION ALL
    -- O estado que esta migration passa a excluir precisa EXISTIR no enum,
    -- senao o `NOT IN` abaixo falha com "invalid input value for enum" e o erro
    -- aponta para a linha do filtro em vez de para a migration que falta.
    SELECT '  - valor ''skipped'' no enum public.scheduled_status (vem do 005)'
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'scheduled_status' AND e.enumlabel = 'skipped'
    )
  ) AS checks
  WHERE msg IS NOT NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'054 nao pode ser aplicado neste banco. Faltando:\n%\n\nRode 001 -> ... -> 053 antes.', v_faltando;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. planned_vs_actual -- a ocorrencia apagada sai do previsto
-- ---------------------------------------------------------------------------
-- Identica a definicao da 045, com UMA linha diferente (o filtro de status, no
-- LATERAL do previsto). Todo o resto esta reproduzido de proposito, porque
-- `CREATE OR REPLACE VIEW` exige a definicao inteira e um "pequeno ajuste de
-- passagem" aqui viria sem teste nenhum por cima dele.
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
    -- `s.direction` (043/HMO-256) resolve a precedencia ocorrencia -> regra ->
    -- 'expense' UMA vez, na 027. O criterio antigo era o `transaction_type` da
    -- REGRA, e previsao avulsa nao tem regra -- por isso ela caia toda em
    -- `planned_expense`.
    SELECT
      SUM(s.amount) FILTER (WHERE s.direction = 'expense') AS planned_expense,
      SUM(s.amount) FILTER (WHERE s.direction = 'income')  AS planned_income,
      -- Contagem de linha EM ABERTO, e nao de divida: receita prevista entra
      -- nos dois contadores, igual a antes da 043.
      --
      -- Estes dois contadores filtram `status = 'pending'`, entao eles nunca
      -- tiveram o defeito da 054 -- e e isso que fazia a linha da view se
      -- contradizer: "0 em aberto" ao lado de "R$ 5.000 previstos".
      COUNT(*) FILTER (WHERE s.status = 'pending') AS pending_count,
      COUNT(*) FILTER (WHERE s.status = 'pending' AND s.due_date < CURRENT_DATE) AS overdue_count
    FROM public.scheduled_transactions_effective s
    WHERE s.user_id = k.user_id
      AND s.group_id IS NOT DISTINCT FROM k.group_id
      AND date_trunc('month', s.due_date)::date = k.month
      AND s.currency IS NOT DISTINCT FROM k.currency
      -- A LINHA DA 054. Nenhum dos dois estados vai acontecer, e e por isso que
      -- nenhum dos dois e previsao:
      --
      --   `cancelled` -- a serie foi encerrada (DELETE {alcance:"todas"}).
      --                  Ja estava excluido desde o 008, com o comentario
      --                  "cancelada nunca foi previsao de verdade".
      --   `skipped`   -- o usuario apagou ESTA ocorrencia
      --                  (DELETE {alcance:"apenas_esta"}). A linha fica na
      --                  tabela de proposito, para nao ressuscitar na agenda --
      --                  mas ela saiu do Fluxo de Caixa, do painel e do resumo,
      --                  e tem de sair daqui tambem.
      --
      -- Lista por EXCLUSAO, e foi assim que o `skipped` entrou nesta soma
      -- sozinho. A secao 5 do teste enumera `scheduled_status` e reprova o
      -- db-verify se um estado novo aparecer sem ser classificado -- e o que
      -- impede o proximo de entrar de graca. Nao troquei pela forma positiva
      -- (`IN ('pending','paid')`) porque ela tiraria do previsto uma linha
      -- `overdue` crua, que venceu e continua a pagar; ver o cabecalho.
      AND s.status NOT IN ('cancelled', 'skipped')
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
  'Previsto (agenda do 005) contra realizado por mes e MOEDA. O previsto EXCLUI cancelled E skipped (054): nenhum dos dois vai acontecer -- skipped e a ocorrencia que o usuario apagou (DELETE apenas_esta), que fica na tabela so para nao ressuscitar na agenda, e ate a 054 era a unica leitura do previsto que ainda a contava. A direcao do PREVISTO sai de scheduled_transactions_effective.direction (043): previsao AVULSA de receita entrava em planned_expense porque o criterio era o transaction_type da REGRA, e avulsa nao tem regra. Chaves por UNION de tres origens: agenda, transacoes e a minha parte de grupo (045). O realizado PESSOAL sai de personal_monthly_cash_flow (033, inclui a minha parte de grupo); o do GRUPO sai de monthly_cash_flow (valor cheio). As duas pernas do realizado sao mutuamente exclusivas por group_id. O LATERAL casa a moeda tambem: sem isso um mes com duas moedas duplicaria a linha e repetiria o previsto inteiro em cada uma.';

-- ---------------------------------------------------------------------------
-- 2. security_invoker e GRANTs
-- ---------------------------------------------------------------------------
-- `CREATE OR REPLACE VIEW` APAGA AS reloptions DA VIEW, e `security_invoker` e
-- uma reloption (medido no PG 17.11). Quem so troca a definicao e nao reaplica
-- o ALTER deixa a view rodando como o DONO -- e esta view atravessa
-- `group_share_entries`, que chega em quatro tabelas de grupo. O sintoma seria
-- cada pessoa vendo a variancia mensal de todas as outras, sem erro nenhum no
-- caminho, so com linhas a mais.
--
-- Esta linha e load-bearing, e nao precaucao: o diff desta migration nao fala
-- de permissao em lugar nenhum e tem toda a cara de ser "so um filtro a mais".
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
-- 3. Sondas para quem cola a mao no SQL Editor
-- ---------------------------------------------------------------------------
-- NOTICE e nao EXCEPTION, no mesmo tom das sondas da 042 e da 045: o teste do
-- 054 e quem reprova isso de verdade. Estas linhas existem para quem aplica a
-- migration a mao e nao roda o db-verify.
--
-- A primeira e tambem o MARCADOR DE FIM DE ARQUIVO: como o REPLACE acima APAGA
-- a reloption, ler `security_invoker=true` junto com o filtro novo so e
-- possivel se a execucao passou do ALTER da secao 2. Colagem que parou no meio
-- deixaria a view completa e SEM a opcao.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.planned_vs_actual'::regclass
       AND reloptions @> ARRAY['security_invoker=true']
  ) THEN
    RAISE NOTICE '054: planned_vs_actual ficou SEM security_invoker -- ela esta furando a RLS';
  END IF;

  -- A segunda sonda confere o que esta migration EXISTE para fazer, lendo a
  -- definicao que o Postgres guardou -- nao o arquivo. Pega o caso de alguem
  -- colar a versao da 045 por engano achando que colou esta.
  IF position('skipped' IN pg_get_viewdef('public.planned_vs_actual', true)) = 0 THEN
    RAISE NOTICE '054: a view NAO exclui skipped -- a ocorrencia apagada continua no previsto';
  ELSE
    RAISE NOTICE '054: ok -- planned_vs_actual exclui cancelled e skipped do previsto';
  END IF;
END $$;
