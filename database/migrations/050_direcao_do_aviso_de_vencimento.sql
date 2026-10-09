-- ===========================================================================
-- 050 -- A DIRECAO DO AVISO DE VENCIMENTO (HMO-350)
-- ===========================================================================
-- O QUARTO LUGAR do defeito que a HMO-256 fechou em tres. `bill_alerts` decide
-- a direcao do previsto pelo tipo da REGRA de recorrencia:
--
--     COALESCE(r.transaction_type, 'expense') AS transaction_type
--     FROM public.scheduled_transactions s
--     LEFT JOIN public.recurring_rules r ON r.id = s.recurring_rule_id
--
-- Previsao AVULSA nao tem regra: o LEFT JOIN devolve NULL e a linha cai em
-- 'expense'. Toda receita prevista avulsa sai da view como conta a PAGAR.
--
-- MEDIDO EM PRODUCAO em 09/10/2026, conta A da HMO-255, com `days_before`
-- alargado para 25 e `GET /api/notifications` -- controle positivo e negativo
-- na MESMA resposta, que e o que isola a causa no COALESCE da regra:
--
--   descricao                           tem regra?  tipo real  a view disse
--   ----------------------------------  ----------  ---------  ------------
--   Bonus (previsto) R$ 50,00, 29/10    NAO         receita    expense  <-- X
--   Aluguel recebido (fixa) R$ 2.000    sim         receita    income
--   Bolsa de estudos (fixa) R$ 700      sim         receita    income
--   Plano de saude (fixa) R$ 1.000      sim         despesa    expense
--   Energia (prevista) R$ 70,00, 28/10  NAO         despesa    expense
--
-- As duas receitas COM regra acertam e a unica receita SEM regra erra. A
-- ultima linha e a que explica por que isto passou meses invisivel: previsao
-- avulsa de DESPESA acerta por acaso, e ela e a maioria.
--
-- Reproduzido tambem em banco local com a cadeia 001 -> 049:
-- `Bonus (previsto)` de 50,00 como `transaction_type = 'income'` em
-- `scheduled_transactions`, sem `recurring_rule_id`, sai da view como
-- `expense`.
--
-- ===========================================================================
-- POR QUE ISTO E CARO AGORA, E NAO SO FEIO
-- ===========================================================================
-- A 047 (ja colada em producao) ligou o canal de E-MAIL deste mesmo aviso. A
-- frase sai da view e vai para a caixa de entrada: com o defeito de pe, o app
-- manda e-mail cobrando o usuario por dinheiro que ele vai RECEBER. No caso
-- vencido fica pior -- `kind = 'overdue'` vira "venceu ha N dias", e uma
-- receita que atrasou e anunciada como cobranca.
--
-- ===========================================================================
-- O CONSERTO: LER `direction`, NAO ESCREVER UM QUARTO COALESCE
-- ===========================================================================
-- O `FROM` passa a ser `scheduled_transactions_effective` e a coluna passa a
-- ser `s.direction`. E o mesmo movimento que a 043 fez na `planned_vs_actual`,
-- pela mesma razao, escrita no cabecalho da 027 quando a view nasceu:
--
--   *"a copia esquecida em uma das tres rotas de leitura seria justamente uma
--   receita prevista aparecendo como conta a pagar"*
--
-- Foi o que aconteceu QUATRO vezes. `direction` resolve a precedencia
-- ocorrencia -> regra -> 'expense' UMA vez, no 027; a 043 e a 045 ja a
-- consomem. Escrever `COALESCE(s.transaction_type, r.transaction_type,
-- 'expense')` aqui daria o mesmo numero hoje e seria a quarta copia do
-- criterio -- o quinto lugar a esquecer na proxima mudanca de precedencia.
--
-- O `LEFT JOIN public.recurring_rules` SAI. A view ja faz esse join por
-- dentro, e deixar `r` aqui sem nenhum uso e um convite a reescrever o
-- criterio velho por cima.
--
-- O `LEFT JOIN public.notification_preferences` FICA: ele e sobre preferencia
-- de aviso, nao sobre direcao, e a view da agenda nao sabe nada dele.
--
-- ===========================================================================
-- O QUE ESTA MIGRATION *NAO* MUDA
-- ===========================================================================
--   * A LISTA de avisos. `direction` nao entra no WHERE: receita prevista
--     continua gerando aviso, e deve -- "o seu bonus entra em 2 dias" e um
--     aviso bom. O que muda e o ROTULO, que e o que estava mentindo.
--   * `notify_email` e o `COALESCE(p.notify_email, true)` da 047 -- repostos
--     identicos, inclusive a posicao 13 e o fato de nao entrarem no WHERE.
--   * `days_before`, `notify_due_soon`, `notify_overdue` e o recorte de
--     `status = 'pending'`: identicos ao 009.
--   * A lista de colunas: 13 colunas, mesmos nomes, mesma ordem, mesmos tipos.
--     `bill_alerts.transaction_type` JA era `transaction_financial_type` (o
--     tipo de `recurring_rules.transaction_type`, herdado pelo COALESCE) e
--     `scheduled_transactions_effective.direction` e o MESMO tipo -- conferido
--     no catalogo de um banco com a cadeia 001 -> 049. E por isso que
--     `CREATE OR REPLACE` basta: ele recusaria mudanca de tipo de coluna.
--
-- O TEXTO da frase NAO mora aqui. `textoDoAviso` (lib/services/notifications.ts)
-- declarava `transaction_type` e nunca o lia -- a frase era sempre de conta a
-- pagar. Consertar so esta view deixaria o sintoma inteiro de pe: a coluna nao
-- tinha leitor. As duas metades vao juntas, e o leitor entra no mesmo PR.
--
-- ===========================================================================
-- O NUMERO 050 E LOAD-BEARING: ELE TEM QUE SER MAIOR QUE 047
-- ===========================================================================
-- A 047 recola `bill_alerts` INTEIRA (o corpo do 009 mais `notify_email`). Uma
-- migration de conserto com numero MENOR, colada antes dela, seria revertida
-- em silencio -- sem conflito de git, sem erro, e com a view voltando a dizer
-- `expense`. E o acidente que a 045 quase causou na 043 (ver o cabecalho da
-- 045). Se este arquivo for renumerado, o numero novo tem de continuar depois
-- da 047, e o step dela no `db-verify.yml` tem de continuar ANTES deste.
--
-- E a regra vale para frente tambem: QUEM MEXER EM `bill_alerts` DAQUI PARA
-- A FRENTE carrega a definicao inteira junto, e recolar a versao com
-- `COALESCE(r.transaction_type, 'expense')` reverte este conserto sem sintoma.
-- Quem avisa e o step "A receita prevista AVULSA nao sai mais como conta a
-- pagar no fim da cadeia" do db-verify, que re-roda o teste deste arquivo
-- depois de todas as outras migrations.
--
-- ===========================================================================
-- ADITIVA, IDEMPOTENTE E SEM META-COMANDO
-- ===========================================================================
-- `CREATE OR REPLACE VIEW` + `COMMENT` + `ALTER VIEW` + `GRANT`. Nenhuma
-- coluna entra ou sai, nenhuma tabela e tocada, nenhum dado e reescrito.
-- Rodar duas vezes e inofensivo. Nenhuma linha comeca com `\` -- uma unica
-- delas reprovaria o arquivo INTEIRO no SQL Editor do Supabase, que e como
-- producao recebe migration (nao ha runner; ver a nota no topo do 015).
--
-- SEGURA DE APLICAR COM A `main` VELHA NO AR. O codigo em producao le
-- `bill_alerts` com `select("*")` em dois lugares (o sino e o cron) e nenhum
-- deles le `transaction_type` hoje -- e por isso que a frase esta errada. Com
-- a coluna consertada e o app velho, a frase continua como esta (errada, nada
-- piora); com o app novo, ela fica certa. Nao existe ordem ruim entre colar e
-- deployar.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Preflight -- o que esta migration PRECISA achar no banco
-- ---------------------------------------------------------------------------
-- Mesmo desenho do preflight da 045/046/049. Aplicada fora de ordem no SQL
-- Editor, esta migration recolaria `bill_alerts` SEM `notify_email` (se a 047
-- nao tivesse passado) ou falharia no meio de um CREATE VIEW com
-- "column direction does not exist" (se a 027 nao tivesse passado) -- e esse
-- erro nao diz qual migration falta.
DO $$
DECLARE
  v_faltando TEXT;
BEGIN
  SELECT string_agg(msg, E'\n') INTO v_faltando
  FROM (
    SELECT '  - view public.bill_alerts (vem do 009, recolada pela 047)' AS msg
    WHERE to_regclass('public.bill_alerts') IS NULL
    UNION ALL
    SELECT '  - view public.scheduled_transactions_effective (vem do 005, refeita pela 027)'
    WHERE to_regclass('public.scheduled_transactions_effective') IS NULL
    UNION ALL
    -- A coluna que ESTA migration existe para ler. Sem ela nao ha conserto, e
    -- `CREATE OR REPLACE` falharia com um erro que nao nomeia a 027.
    SELECT '  - coluna direction em public.scheduled_transactions_effective (vem do 027)'
    WHERE to_regclass('public.scheduled_transactions_effective') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'scheduled_transactions_effective'
           AND column_name = 'direction'
      )
    UNION ALL
    -- Sem esta, o CREATE OR REPLACE abaixo reprovaria por numero de colunas
    -- (13 contra 12) -- mas o erro diria "cannot drop columns from view", que
    -- se le como defeito DESTE arquivo em vez de "a 047 nao foi colada".
    SELECT '  - coluna notify_email em public.bill_alerts (vem da 047)'
    WHERE to_regclass('public.bill_alerts') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'bill_alerts'
           AND column_name = 'notify_email'
      )
  ) f;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'050 nao pode ser aplicada: faltam objetos no banco.\n%\nAplique as migrations anteriores em ordem antes desta.', v_faltando;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. A view
-- ---------------------------------------------------------------------------
-- Diferencas em relacao a 047, e sao so estas duas:
--
--   * `FROM public.scheduled_transactions_effective s` (era
--     `public.scheduled_transactions s` + LEFT JOIN em `recurring_rules`);
--   * `s.direction AS transaction_type` (era
--     `COALESCE(r.transaction_type, 'expense')`).
--
-- Todo o resto e copia literal, porque `CREATE OR REPLACE VIEW` exige a
-- definicao inteira.

CREATE OR REPLACE VIEW public.bill_alerts AS
  SELECT
    s.id AS scheduled_transaction_id,
    s.user_id,
    s.group_id,
    s.account_id,
    s.description,
    s.amount,
    s.due_date,
    (s.due_date - CURRENT_DATE) AS days_until,
    CASE WHEN s.due_date < CURRENT_DATE THEN 'overdue' ELSE 'due_soon' END AS kind,
    COALESCE(p.days_before, 3) AS days_before,
    -- O CONSERTO, em uma linha. `direction` e a precedencia da 027 ja
    -- resolvida: ocorrencia -> regra -> 'expense'. Previsao avulsa de receita
    -- cai na PRIMEIRA e sai como `income`; previsao avulsa de despesa continua
    -- caindo no 'expense' do fim, como sempre.
    s.direction AS transaction_type,
    EXISTS (
      SELECT 1 FROM public.bill_notifications n
      WHERE n.scheduled_transaction_id = s.id
        AND n.kind = (CASE WHEN s.due_date < CURRENT_DATE THEN 'overdue' ELSE 'due_soon' END)
        AND n.reference_date = s.due_date
    ) AS already_notified,
    -- Da 047, intocada: ausencia de linha significa "sim", pelo mesmo COALESCE
    -- de `days_before` e `notify_due_soon`.
    COALESCE(p.notify_email, true) AS notify_email
  FROM public.scheduled_transactions_effective s
  LEFT JOIN public.notification_preferences p ON p.user_id = s.user_id
  WHERE s.status = 'pending'
    AND (
      (s.due_date < CURRENT_DATE AND COALESCE(p.notify_overdue, true))
      OR (s.due_date >= CURRENT_DATE
          AND COALESCE(p.notify_due_soon, true)
          AND s.due_date - CURRENT_DATE <= COALESCE(p.days_before, 3))
    );

-- `s.status = 'pending'` e NAO `s.effective_status = 'pending'`, de proposito.
-- `effective_status` envelhece a linha para 'overdue' sozinho quando a data
-- passa (027/005), entao filtrar por ele apagaria da view toda conta VENCIDA
-- -- que e metade do que ela existe para avisar (`kind = 'overdue'`). O recorte
-- do 009 e sobre o estado GRAVADO, e e esse que fica.

COMMENT ON VIEW public.bill_alerts IS
  'Contas que merecem aviso hoje, com already_notified e a preferencia de canal '
  'notify_email. Uma definicao para o cron e para o sino do app. A direcao vem '
  'de scheduled_transactions_effective.direction (050): receita prevista AVULSA '
  'sai como income, nao como conta a pagar.';

COMMENT ON COLUMN public.bill_alerts.transaction_type IS
  'income, expense ou transfer -- a direcao da OCORRENCIA, nao da regra. Vem de '
  'scheduled_transactions_effective.direction, que resolve ocorrencia -> regra '
  '-> expense uma vez (027). Quem monta a frase do aviso LE esta coluna: sem '
  'isso, receita prevista e anunciada como conta vencendo (HMO-350).';

-- ---------------------------------------------------------------------------
-- 2. O security_invoker, de volta -- E QUEM PROTEGE A LINHA MUDOU DE LUGAR
-- ---------------------------------------------------------------------------
-- `security_invoker` e um reloption e NAO sobrevive ao CREATE OR REPLACE
-- acima -- medido, nao suposto (ver o cabecalho da 047). O ALTER abaixo e
-- obrigatorio em toda migration que recria esta view.
--
-- O QUE A 047 ESCREVE AQUI DEIXA DE SER VERDADE COM ESTA MIGRATION, e vale
-- dizer em voz alta em vez de herdar a frase. A 047 diz que sem o ALTER "o
-- sino de cada pessoa passa a listar as contas a vencer de TODO MUNDO". Era
-- verdade quando a view lia a TABELA `scheduled_transactions`. Agora ela le
-- `scheduled_transactions_effective`, que tem `security_invoker` proprio desde
-- a 027 -- e `security_invoker=false` so troca o dono para as relacoes que a
-- view referencia DIRETAMENTE.
--
-- MEDIDO num Postgres 17 com a cadeia 001 -> 050, dois usuarios sem grupo em
-- comum, o B contando as linhas do A:
--
--   bill_alerts invoker, effective invoker ....... 0   (o estado desta migration)
--   bill_alerts DEFINER, effective invoker ....... 0   <-- NAO vaza mais
--   bill_alerts invoker, effective DEFINER ....... 1   <-- vaza
--   as duas DEFINER ............................... 1
--
-- Ou seja: depois da 050 quem protege a lista de vencimentos e o
-- `security_invoker` de `scheduled_transactions_effective`, nao o desta view.
-- O ALTER abaixo fica por duas razoes que nao sao "o vazamento de hoje":
-- uniformidade da cadeia (o `view_security_invoker_test.sql` cobra de todas as
-- views) e o dia em que alguem fizer esta view tocar uma tabela direto de
-- novo -- o que reabriria o furo em silencio.
--
-- CONSEQUENCIA PRATICA, E E A QUE ENGANA: o controle negativo da SECAO 9 do
-- `statements_alerts_test.sql` (apaga a flag desta view e exige que o B passe
-- a ver) deixa de medir depois desta migration. Ele roda na POSICAO dele, muito
-- antes da 050, e continua certo la. O que mede isto no fim da cadeia e o teste
-- desta migration, lendo os DOIS reloptions do catalogo e vazando pelo lado
-- certo -- ver o step dela no `db-verify.yml`.
ALTER VIEW public.bill_alerts SET (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 3. Os GRANTs
-- ---------------------------------------------------------------------------
-- `CREATE OR REPLACE VIEW` PRESERVA os GRANTs (ao contrario dos reloptions), e
-- o 009 ja deu SELECT a `authenticated`. Reposto de qualquer forma, pelo mesmo
-- motivo do ALTER acima: repetir e barato, descobrir que a preservacao nao
-- valia nao e. `anon` nunca teve e continua sem.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.bill_alerts FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT ON public.bill_alerts TO authenticated';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Sonda: a view ficou com security_invoker?
-- ---------------------------------------------------------------------------
-- NOTICE e nao EXCEPTION, no mesmo tom da 042/045/046/049: quem reprova isso
-- de verdade e o teste desta migration e o `view_security_invoker_test.sql`.
-- Esta linha existe para quem aplica a mao no SQL Editor e nao roda teste.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.bill_alerts'::regclass
       AND COALESCE(reloptions @> ARRAY['security_invoker=true'], FALSE)
  ) THEN
    RAISE NOTICE '050: bill_alerts ficou SEM security_invoker (furando a RLS)';
  END IF;
END $$;

COMMIT;
