-- =====================================================
-- PULODOGATO -- 064: o patrimonio mes a mes ignora a conta fora dos totais
-- =====================================================
-- HMO-441. A 058 (HMO-431) deu a toda conta um `include_in_total`, e QUATRO
-- leituras de SALDO ja o honram: `/api/net-worth`, `/api/reports/net-worth`,
-- `/api/safe-to-spend` e `/api/projection`.
--
-- A LINHA DO TEMPO nao honrava. `net_worth_history` (008:453) lia
-- `financial_accounts` sem filtro nenhum, e o resultado era visivel na MESMA
-- TELA de Patrimonio, com uma conta desligada:
--
--   * o numero grande (consolidado) EXCLUI a conta  -- certo
--   * o grafico ao lado INCLUI a conta              -- e o ultimo ponto da
--     serie nao bate com o numero grande logo acima dele
--
-- Duas leituras do mesmo dinheiro discordando na mesma tela e pior que as duas
-- estarem erradas do mesmo jeito: quem confere a mao nao sabe qual acreditar.
-- Medido em prod pela credencial RO em 2026-10-19:
--
--   pg_get_viewdef('public.net_worth_history') ILIKE '%include_in_total%' -> FALSO
--   pg_get_viewdef('public.net_worth_history') ILIKE '%financial_accounts%' -> VERDADEIRO
--
-- O segundo e o que importa: a view ALCANCA a tabela, entao o filtro cabe ali.
-- Nao era um caso de "a view nao tem como saber".
--
-- Sai de graca no CSV tambem: `/api/reports/export` (linha ~416) exporta esta
-- mesma view, e passa a exportar o numero certo sem tocar a rota.
--
-- ===========================================================================
-- O PRINCIPIO DESTE ARQUIVO, EM UMA FRASE
-- ===========================================================================
-- **O filtro muda a SOMA, nunca o conjunto de CHAVES.** Os dois CTEs usam
-- `FILTER (WHERE ...)` dentro do agregado em vez de `WHERE` no corpo, e e essa
-- escolha que faz o resto do arquivo ser seguro. Duas consequencias, as duas
-- deliberadas e as duas medidas no teste:
--
--   * um mes cuja UNICA movimentacao foi na conta desligada CONTINUA
--     aparecendo na serie, com `net_change = 0` em vez de desaparecer. Um mes
--     que sai do meio do grafico deixa um buraco no eixo que ninguem pediu, e
--     mudar o conjunto de meses que o relatorio enumera e outra mudanca, com
--     outro risco. E exatamente a escolha que a 060 fez no CTE `chaves` de
--     `planned_vs_actual`, e pela mesma razao (ver `linha-zerada-nas-views-do-008`);
--   * o usuario cuja UNICA conta esta desligada continua tendo serie, com
--     `net_worth = 0`. Com `WHERE a.include_in_total` no `saldo_hoje` ele
--     sairia do CTE inteiro, o `JOIN` final mataria todos os meses dele e a
--     tela ficaria VAZIA em vez de zerada -- uma tela vazia se le como "o
--     sistema nao sabe", e o sistema sabe: e zero.
--
-- ===========================================================================
-- O QUE ESTE ARQUIVO **NAO** FAZ, E E A PARTE QUE SE LE ERRADO
-- ===========================================================================
-- Existem DUAS colunas `include_in_total` neste banco, com o mesmo nome em
-- tabelas diferentes, e elas tem POLITICAS OPOSTAS nesta view:
--
--   * `financial_accounts.include_in_total` (058, HMO-431) e de SALDO. **Esta
--     migration passa a honra-la.** A conta esta fora do patrimonio.
--   * `financial_transactions.include_in_total` (060, HMO-443) e de RELATORIO.
--     **Esta migration continua IGNORANDO-A, de proposito.** O cabecalho da
--     060 diz isso por extenso na ressalva 1, e a secao 5 do
--     `060_lancamento_fora_dos_totais_test.sql` REPROVA quem "consertar" a
--     omissao: o dinheiro do ajuste de saldo entrou mesmo na conta, o
--     `update_account_balance_trigger` ja mexeu no `current_balance`, e tirar a
--     linha do patrimonio faria a tela de Contas discordar do patrimonio.
--
-- Nao e contradicao, e a mesma regra aplicada duas vezes: **o patrimonio segue
-- o SALDO.** Uma conta fora dos totais nao tem saldo que conte; um lancamento
-- fora dos totais tem -- ele mexeu no saldo da conta de verdade.
--
-- A 046 ja havia escrito o criterio (046:39): "`net_worth_history` nao e uma
-- leitura de custo, e uma leitura de SALDO". Este arquivo e essa frase aplicada
-- a 058.
--
-- A secao 4 do teste desta migration re-mede a ressalva da 060 DEPOIS desta
-- recolagem, e o db-verify re-roda a suite inteira da 060 logo abaixo do step
-- desta: e a unica posicao da cadeia em que "a 064 nao atropelou a 060" e
-- observavel.
--
-- ===========================================================================
-- RECEITA/DESPESA CONTINUA CONTANDO A CONTA DESLIGADA, E ISSO E OUTRA ISSUE
-- ===========================================================================
-- Os relatorios de fluxo, categorias, resumo mensal e anomalias continuam
-- contando o lancamento da conta desligada. A cadeia inteira deles sai de
-- `category_monthly_totals` (022:165), que **nao tem `account_id` na view**:
-- nao existe caminho dali ate `financial_accounts`. Honrar o campo lá significa
-- re-cortar a view-base e decidir o que fazer com lancamento de
-- `account_id IS NULL` (legitimo hoje) -- e precisa de decisao antes de codigo.
-- "A conta sai do patrimonio" e "o gasto daquela conta sai do meu relatorio de
-- gastos" sao dois pedidos diferentes.
--
-- ===========================================================================
-- `NOT IN (desligadas)` ESTA PROIBIDO AQUI
-- ===========================================================================
-- Excluir a conta desligada e "somar as contas que somam", nunca "nao somar as
-- desligadas". A segunda forma, escrita como `t.account_id NOT IN (SELECT id
-- ... WHERE NOT include_in_total)`, descarta CALADO todo lancamento de
-- `account_id IS NULL` (`NULL NOT IN (...)` nao e verdadeiro), e lancamento sem
-- conta e legitimo neste banco. O `FILTER` sobre o `LEFT JOIN` nao tem como
-- cair nessa: ele soma o que casou e ignora o que nao casou, sem negacao
-- nenhuma. A secao 5 do teste planta um lancamento sem conta so para medir
-- isso.
--
-- ===========================================================================
-- `security_invoker` DE VOLTA -- O PASSO QUE SE ESQUECE
-- ===========================================================================
-- `CREATE OR REPLACE VIEW` APAGA as `reloptions`. Sem o `ALTER VIEW` do fim
-- deste arquivo a view volta a rodar como DONA, e o patrimonio de um usuario
-- passa a misturar as contas de todos os outros -- sem erro, com numeros
-- plausiveis, e invisivel num banco de teste de um usuario so. Por isso a
-- medida da secao 7 do teste e no CATALOGO (`pg_class.reloptions`) e nao num
-- numero. Mesmo desenho da secao 3 da 060 e da secao 6 da 063.
--
-- O corpo da view abaixo foi recolado LINHA POR LINHA a partir da 008 -- que e
-- a UNICA a tocar esta view (conferido em `origin/main`: so 008:453 tem
-- `CREATE OR REPLACE VIEW net_worth_history`; a 015, 038, 046 e 049 apenas a
-- citam em comentario) -- com os dois `FILTER` e NADA MAIS. A janela sem
-- `ORDER BY`, a reconstrucao de tras para frente, o `::numeric(15,2)` e o
-- `WHERE t.account_id IS NOT NULL` estao identicos de proposito: um corpo
-- escrito a partir da versao errada REVERTERIA a 008 sem sintoma nenhum
-- (`create-or-replace-view-de-pr-aberto-reverte-migration-mergeada`), e o
-- db-verify re-roda `goals_reports_test.sql` depois desta migration exatamente
-- para pegar isso.

-- ---------------------------------------------------------------------------
-- 0. PREFLIGHT: a 058 tem de estar neste banco
-- ---------------------------------------------------------------------------
-- A view abaixo NOMEIA `a.include_in_total`. Num banco parado antes da 058 o
-- `CREATE OR REPLACE` morreria com `column a.include_in_total does not exist`,
-- que manda depurar a view em vez de mandar rodar a migration que falta. A
-- diferenca entre as duas mensagens e a unica razao de este bloco existir.
--
-- A ordem desta feature e colagem-depois-deploy e ela JA ESTA SATISFEITA: a 058
-- esta em prod desde 2026-10-19 (md5 do `COMMENT ON COLUMN` =
-- 489172c0f2d83bea5b327e2284db809c, igual ao literal do arquivo). O preflight
-- protege o banco novo e o banco parado, nao a producao.
DO $$
DECLARE
  v_faltando TEXT;
BEGIN
  SELECT string_agg(msg, E'\n') INTO v_faltando
  FROM (
    SELECT '  - coluna include_in_total em public.financial_accounts (vem do 058)' AS msg
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'financial_accounts'
         AND column_name = 'include_in_total'
    )
    UNION ALL
    SELECT '  - view public.net_worth_history (vem do 008)'
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'net_worth_history'
         AND c.relkind = 'v'
    )
  ) AS checks
  WHERE msg IS NOT NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'064 nao pode ser aplicado neste banco. Faltando:\n%\n\nRode 001 -> ... -> 063 antes.', v_faltando;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. net_worth_history, recolada a partir da 008 com DOIS `FILTER` a mais
-- ---------------------------------------------------------------------------
-- Os comentarios de dentro do corpo sao os da 008, preservados: eles explicam
-- a janela sem `ORDER BY`, que e a parte do calculo que ninguem acerta de
-- memoria.
--
-- Contas INATIVAS continuam entrando (a conta encerrada com saldo residual
-- continua sendo patrimonio -- razao escrita na 008). `include_in_total` e
-- outra pergunta: ela diz "este dinheiro e meu patrimonio?", e nao "esta conta
-- esta em uso?".
CREATE OR REPLACE VIEW public.net_worth_history AS
  WITH saldo_hoje AS (
    -- `FILTER` e nao `WHERE`: o usuario de contas todas desligadas tem de
    -- continuar no CTE, com total ZERO. Com `WHERE` ele sairia daqui, o `JOIN`
    -- final mataria a serie dele inteira e a tela ficaria vazia em vez de
    -- zerada.
    SELECT
      a.user_id,
      COALESCE(SUM(a.current_balance) FILTER (WHERE a.include_in_total), 0)::numeric(15,2) AS total
    FROM public.financial_accounts a
    GROUP BY a.user_id
  ),
  movimento AS (
    -- `LEFT JOIN` + `FILTER`, nunca `NOT IN`: ver o bloco do cabecalho. O
    -- `WHERE t.account_id IS NOT NULL` e o da 008, intacto -- lancamento sem
    -- conta nao mexe em saldo nenhum, entao nunca entrou nesta soma e continua
    -- fora. O `LEFT JOIN` nao muda isso; ele so traz a coluna do filtro.
    --
    -- `t.include_in_total` NAO aparece aqui, de proposito: o flag do LANCAMENTO
    -- e de relatorio e o patrimonio segue o saldo. Ver o cabecalho.
    SELECT
      t.user_id,
      date_trunc('month', t.transaction_date)::date AS month,
      COALESCE(SUM(t.amount) FILTER (WHERE a.include_in_total), 0)::numeric(15,2) AS net
    FROM public.financial_transactions t
    LEFT JOIN public.financial_accounts a ON a.id = t.account_id
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

-- ---------------------------------------------------------------------------
-- 2. O COMMENT, que e a sonda de colagem
-- ---------------------------------------------------------------------------
-- md5 do literal abaixo, para conferir a colagem em prod sem precisar do
-- arquivo (`SELECT md5(obj_description('public.net_worth_history'::regclass, 'pg_class'))`):
--
--   a9871ef762cdab9093af0aebcb6636bd
--
-- MEDIDO, e nao calculado a mao: o valor acima saiu de um Postgres 17 local com
-- a cadeia 001 -> 064 colada, lendo o `obj_description` depois da colagem. Ele
-- tem de ser re-medido contra prod DEPOIS da colagem lá
-- (`colagem-em-prod-pode-vir-sem-aviso-meca-primeiro`), e um md5 diferente
-- significa COMMENT editado no SQL Editor -- tipicamente CRLF
-- (`funcao-colada-no-sql-editor-guarda-crlf-no-prosrc`).
COMMENT ON VIEW public.net_worth_history IS
  'Patrimonio mes a mes, reconstruido de tras para frente a partir do saldo de hoje. A variacao e exata; o nivel herda a deriva de current_balance. Ignora a CONTA fora dos totais (financial_accounts.include_in_total = false, HMO-431/058) nas duas pontas -- no saldo de hoje e na movimentacao do mes -- para fechar com /api/net-worth, que e o numero grande da mesma tela (HMO-441/064). NAO ignora o LANCAMENTO fora dos totais (financial_transactions.include_in_total = false, HMO-443/060): aquele flag e de RELATORIO, este patrimonio e SALDO, e o dinheiro do ajuste entrou mesmo na conta. O filtro muda a SOMA e nao o conjunto de CHAVES: o mes sem movimentacao que conte aparece com net_change = 0, e o usuario de contas todas desligadas tem serie de zeros em vez de serie nenhuma.';

-- ---------------------------------------------------------------------------
-- 3. `security_invoker` DE VOLTA
-- ---------------------------------------------------------------------------
-- Ver o bloco homonimo do cabecalho. Sem este ALTER o patrimonio de um usuario
-- mistura as contas de outro, calado.
ALTER VIEW public.net_worth_history SET (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 4. ACL reafirmada
-- ---------------------------------------------------------------------------
-- `CREATE OR REPLACE VIEW` PRESERVA privilegios, entao as duas linhas abaixo
-- sao as da 008 (573 e 581) repetidas. "Preserva" e justamente o que separa
-- este arquivo de uma view ilegivel para o app (ou legivel para `anon`, cuja
-- chave vai no bundle JS publico). Repetir e barato; descobrir em producao nao
-- e.
REVOKE ALL ON public.net_worth_history FROM anon;
GRANT SELECT ON public.net_worth_history TO authenticated;
