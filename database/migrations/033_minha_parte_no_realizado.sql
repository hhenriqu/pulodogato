-- 033_minha_parte_no_realizado.sql
--
-- HMO-202, quarta parte da HMO-201: "Lancamento vindo de grupos deveriam ser
-- contabilizados como previsto e realizado no financas pessoais quanto no
-- dashboard."
--
-- O PREVISTO ja conta so a minha parte desde a HMO-177 (lib/parte-do-grupo.ts).
-- Esta migration e o REALIZADO.
--
-- ===========================================================================
-- O BURACO, MEDIDO
-- ===========================================================================
-- `/api/reports/cash-flow` sem `groupId` filtra `group_id IS NULL`, e e ele que
-- alimenta o bloco de realizado do painel. Num Postgres local com a cadeia
-- 001 -> 032, grupo "Viagem" de DUAS pessoas, hotel de R$ 400 lancado pela Ana:
--
--   quem                              realizado pessoal (expense)
--   Ana (PAGOU os 400)                      0,00
--   Bia (deve 200 do rateio)                0,00
--
-- Os dois zeros sao o defeito. O dinheiro existe, o rateio existe
-- (`group_expense_splits`, duas linhas de R$ 200,00), e o painel pessoal de
-- ninguem o enxerga.
--
-- ===========================================================================
-- POR QUE O FILTRO `group_id IS NULL` NAO FOI SIMPLESMENTE REMOVIDO
-- ===========================================================================
-- Esta escrito no cabecalho de app/api/reports/cash-flow/route.ts desde a fase
-- dos relatorios, e a razao e concreta. Sem o filtro:
--
--   * a Ana passaria a ver R$ 400 -- o hotel INTEIRO, incluindo os R$ 200 que a
--     Bia ja devolveu. O mes pessoal dela fecharia no vermelho por causa de
--     dinheiro que nao e dela;
--   * a Bia continuaria vendo ZERO, porque a linha de `financial_transactions`
--     e da Ana. Quem nao pagou nao ganharia despesa nenhuma.
--
-- Trocar um numero FALTANDO por um numero ERRADO e pior: o faltando a pessoa
-- percebe.
--
-- O conserto e contar A MINHA PARTE, o mesmo criterio que o previsto ja usa.
-- Para a Ana isso substitui o valor cheio pela parte dela; para a Bia
-- acrescenta a parte dela. A soma entre os membros continua sendo a despesa
-- inteira -- e e por isso que "a minha parte" e a unica leitura que fecha para
-- os dois lados ao mesmo tempo:
--
--   Ana 200,00  +  Bia 200,00  =  400,00  = o hotel
--
-- ===========================================================================
-- A PARTE E LIDA, NUNCA RECALCULADA
-- ===========================================================================
-- `group_expense_splits.amount` ja esta gravado: quem escreve e
-- `calculate_equal_split` (001, corrigido no 007) pelo metodo do maior resto --
-- centavos inteiros, resto distribuido pela ordem de `group_members.id` --, e a
-- 024 passou a refazer essas partes quando a despesa e editada.
--
-- Recalcular aqui (`ABS(t.amount) / n_membros`) criaria a SEGUNDA implementacao
-- de divisao deste banco. Ela empataria com a primeira na maioria dos casos e
-- divergiria exatamente nos que doem: divisao que nao fecha em duas casas
-- (R$ 300 por 3), rateio `percentage`/`custom` combinado fora do igualitario, e
-- membro que entrou no grupo DEPOIS da despesa. O sintoma seria o realizado
-- pessoal discordando do saldo do grupo (`group_member_balances`, 007) por
-- centavos que ninguem consegue explicar.
--
-- Entao: `SUM(es.amount)` cru, a mesma expressao que a view de saldo do 007 usa
-- para o "devido". Se um dia a divisao mudar, os dois numeros mudam juntos.
--
-- ===========================================================================
-- AS QUATRO DECISOES QUE ESTA MIGRATION TOMA, E O QUE CADA UMA EVITA
-- ===========================================================================
--
-- 1. `es.status NOT IN ('rejected', 'expired')` -- copiado do 007, de proposito.
--
--    Nao e `= 'approved'`: hoje o app cria TODO rateio como 'pending' e nada
--    nunca os aprova (ver app/api/expense-groups/[groupId]/transactions). Com
--    'approved' o realizado de grupo sairia ZERO para todo mundo -- o mesmo
--    defeito que esta migration existe para consertar, vestido de rigor. E sem
--    filtro nenhum, o membro que RECUSOU a divisao veria no painel pessoal um
--    gasto que ele se negou a assumir.
--
--    Esta e a mesma regra do saldo do grupo, e tem que ser: as duas telas falam
--    do mesmo dinheiro.
--
-- 2. `t.transaction_type = 'expense'`.
--
--    Divisao de grupo existe para DESPESA. `refazer_rateio_do_grupo` (024) so
--    rateia `amount < 0`, e a view de "pago" do 007 tambem exige 'expense' --
--    receita lancada no grupo nao e alguem pagando a conta do restaurante.
--
--    O filtro e EXPLICITO e nao herdado do rateio: nada no schema impede uma
--    linha de `group_expense_splits` pendurada numa receita (o proprio
--    database/tests/024_... insere uma a mao, e um import ou uma rota antiga
--    pode fazer o mesmo). Sem ele, essa linha entraria no realizado como
--    DESPESA -- dinheiro que entrou aparecendo como dinheiro que saiu.
--
-- 3. A moeda vem de `t.currency`, e entra na CHAVE.
--
--    `group_expense_splits` nao tem coluna de moeda: a parte esta na moeda da
--    despesa. Somar as partes de um grupo em dolar junto com as de um grupo em
--    real daria `1000 + 180 = 1180`, que nao esta em moeda nenhuma -- o defeito
--    exato que a 022 foi a producao tirar das views. A 026 acrescentou
--    `exchange_rate`, mas as views de fluxo de caixa NAO convertem (quem
--    converte e o saldo do grupo); aqui a moeda fica no grao, como no 022.
--
-- 4. O mes e `date_trunc('month', t.transaction_date)` -- a data da DESPESA.
--
--    Nao `es.created_at`. Editar uma despesa antiga refaz as partes (024), e
--    com `created_at` o hotel de setembro migraria para o mes da edicao: o mes
--    fechado mudaria de valor depois de fechado.
--
-- ===========================================================================
-- POR QUE VIEWS, E NAO SOMA NO JAVASCRIPT
-- ===========================================================================
-- O modo mes de `/api/reports/cash-flow` e `/api/reports/categories` sai do
-- banco hoje, e precisa continuar saindo: o total do fluxo e a soma das
-- categorias tem que vir da MESMA definicao, senao a pizza do painel para de
-- fechar em 100% e o usuario fica com dois numeros e nenhum criterio para
-- escolher. Mesma razao pela qual `monthly_cash_flow` e um rollup de
-- `category_monthly_totals` em vez de uma segunda consulta.
--
-- Sao quatro views, em camadas, e cada camada existe por um motivo:
--
--   group_share_entries                    1 linha por parte minha (grao de LINHA)
--   group_share_category_monthly_totals    rollup mensal dela
--   personal_category_monthly_totals       pessoal + minha parte, por categoria
--   personal_monthly_cash_flow             rollup da anterior
--
-- `group_share_entries` existe porque o modo INTERVALO (15/09 a 20/10) nao tem
-- rollup mensal que responda e soma as linhas cruas no JavaScript. Com a view
-- de linha, os dois modos leem a MESMA definicao de "minha parte" -- sem ela, o
-- intervalo teria uma segunda copia da regra de status e de tipo, em outra
-- linguagem, e as duas divergiriam no primeiro rateio recusado.
--
-- ===========================================================================
-- O QUE ESTA MIGRATION NAO TOCA
-- ===========================================================================
-- `category_monthly_totals`, `monthly_cash_flow`, `planned_vs_actual`,
-- `budget_consumption` e as outras views do 008/022 ficam EXATAMENTE como
-- estao. As novas sao aditivas.
--
-- Isso e deliberado: `monthly_cash_flow` tem `group_id` no grao e e o que o
-- painel DO GRUPO le (`?groupId=`), onde o numero certo e o valor CHEIO da
-- viagem, de todos os membros. Mudar aquela view para "minha parte" quebraria a
-- tela do grupo para consertar a pessoal. E ela tambem alimenta
-- `planned_vs_actual` e o consumo de orcamento, que nao estao no pedido.
--
-- ===========================================================================
-- COMO RODAR
-- ===========================================================================
--   psql "$URL" -v ON_ERROR_STOP=1 -f database/migrations/033_minha_parte_no_realizado.sql
--
-- Aplicar depois de 001 -> ... -> 032. O preflight aborta listando o que falta.
-- Re-executavel: so tem CREATE OR REPLACE VIEW, COMMENT, GRANT e ALTER VIEW.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Preflight
-- ---------------------------------------------------------------------------
-- Sem isto a migration aplicaria PELA METADE num banco que nao tem a 022: as
-- views nasceriam sem `currency` no grao e o erro apareceria meses depois, como
-- um total em moeda nenhuma.
DO $$
DECLARE
  v_faltando TEXT;
BEGIN
  SELECT string_agg(msg, E'\n') INTO v_faltando FROM (
    SELECT '  - tabela public.group_expense_splits (vem do 001)' AS msg
    WHERE to_regclass('public.group_expense_splits') IS NULL
    UNION ALL
    SELECT '  - tabela public.group_transactions (vem do 001)'
    WHERE to_regclass('public.group_transactions') IS NULL
    UNION ALL
    SELECT '  - view public.category_monthly_totals (vem do 008)'
    WHERE to_regclass('public.category_monthly_totals') IS NULL
    UNION ALL
    SELECT '  - coluna financial_transactions.currency (vem do 022)'
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'financial_transactions'
         AND column_name = 'currency'
    )
    UNION ALL
    SELECT '  - coluna currency no grao de category_monthly_totals (vem do 022)'
    WHERE to_regclass('public.category_monthly_totals') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'category_monthly_totals'
           AND column_name = 'currency'
      )
  ) AS checks
  WHERE msg IS NOT NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'033 nao pode ser aplicado neste banco. Faltando:\n%\n\nRode 001 -> ... -> 032 antes.', v_faltando;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. group_share_entries -- a minha parte, no grao de LINHA
-- ---------------------------------------------------------------------------
-- UMA linha por (parte, membro). Esta e a unica definicao de "minha parte de
-- uma despesa de grupo" no lado do realizado; tudo abaixo e agregacao dela.
--
-- `amount` sai POSITIVO porque e assim que `group_expense_splits` grava (medido:
-- 200.00 para uma despesa de -400.00) e e assim que as views de relatorio
-- expoem despesa (`ABS()` no 008/022). Quem le isto NAO deve aplicar ABS de
-- novo nem inverter o sinal.
--
-- A JUNCAO COM group_members E POR `es.member_id`, E ISSO IMPORTA
-- --------------------------------------------------------------
-- A parte aponta para a LINHA DE PARTICIPACAO, nao para o usuario. Quem saiu do
-- grupo e voltou tem duas linhas em `group_members`, e a parte antiga continua
-- na velha -- entao `em.user_id` e o unico jeito de reencontrar o historico
-- dessa pessoa. A juncao e 1:1 (a FK aponta para a PK), logo nao duplica.
--
-- E NAO HA FILTRO POR `em.status`: a parte de uma despesa de maio continua sendo
-- dinheiro que a pessoa gastou em maio, mesmo que ela tenha saido do grupo em
-- junho. Filtrar por 'active' aqui faria o historico pessoal dela ser reescrito
-- para tras no dia em que ela sai -- e o mes fechado mudaria de valor. (A view
-- de saldo do 007 filtra, e esta certa: la a pergunta e "quem ainda acerta com
-- quem HOJE", que e outra pergunta.)
--
-- `transaction_type` e uma COLUNA, copiada da transacao, e nao o literal
-- 'expense'. A rota que soma o modo intervalo repassa esse campo para o mesmo
-- agregador que ja usa no caminho pessoal; se algum dia o filtro do WHERE
-- afrouxar, a rota acompanha sozinha em vez de continuar afirmando 'expense'
-- sobre uma linha que nao e mais despesa.
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
    (t.user_id = em.user_id)                          AS paguei_eu
  FROM public.group_expense_splits es
  JOIN public.group_members em        ON em.id = es.member_id
  JOIN public.group_transactions gt   ON gt.id = es.group_transaction_id
  JOIN public.financial_transactions t ON t.id = gt.transaction_id
  WHERE es.status NOT IN ('rejected', 'expired')
    AND t.transaction_type = 'expense';

COMMENT ON VIEW public.group_share_entries IS
  'A MINHA parte de cada despesa de grupo, uma linha por parte. amount POSITIVO, na moeda da despesa, lido de group_expense_splits (nunca recalculado). Rateio rejected/expired fica fora, igual a group_member_balances. Nao tem filtro por user_id: quem le PRECISA filtrar, senao a RLS de grupo devolve a parte dos OUTROS membros tambem.';

-- ---------------------------------------------------------------------------
-- 2. group_share_category_monthly_totals -- rollup mensal da minha parte
-- ---------------------------------------------------------------------------
-- Mesmo formato de `category_monthly_totals`, para a camada de cima poder somar
-- os dois lados sem converter nada.
--
-- `income` e zero por construcao e nao por acaso: a view de baixa so tem
-- despesa. A coluna existe para o UNION ALL da SECAO 3 nao precisar inventar
-- colunas.
--
-- `transaction_count` conta as PARTES, e isso e load-bearing. A rota divide o
-- total pelos meses COM movimento para dar a media; com a contagem em zero, a
-- Bia -- que nao pagou nada -- veria `total_expense = 200` e
-- `average_expense = 0` no mesmo bloco, e `months_with_activity = 0` apagaria o
-- mes dela da media.
-- NAO TEM COLUNA `net`, ao contrario de `category_monthly_totals`.
--
-- Seria `- SUM(e.amount)` e estaria certa, e por isso mesmo nao esta aqui: a
-- camada de cima RECALCULA o net de `income - expense`, entao esta coluna nao
-- teria leitor nenhum -- seria uma segunda definicao do mesmo numero, dormindo
-- ate alguem usa-la e descobrir que ela discorda da primeira. Uma prova de
-- mutacao confirmou: inverter o sinal dela nao muda resultado nenhum do app.
CREATE OR REPLACE VIEW public.group_share_category_monthly_totals AS
  SELECT
    e.user_id,
    e.group_id,
    e.month,
    e.category_id,
    SUM(e.amount)::numeric(15,2)        AS expense,
    0::numeric(15,2)                    AS income,
    COUNT(*)                            AS transaction_count,
    e.currency
  FROM public.group_share_entries e
  GROUP BY e.user_id, e.group_id, e.month, e.category_id, e.currency;

COMMENT ON VIEW public.group_share_category_monthly_totals IS
  'Rollup mensal de group_share_entries, no formato de category_monthly_totals. Despesa POSITIVA, income sempre 0. Sem coluna net de proposito: quem agrega recalcula de income - expense, e uma segunda definicao do net seria um numero sem leitor esperando para discordar. Uma linha por (usuario, grupo, mes, categoria, moeda).';

-- ---------------------------------------------------------------------------
-- 3. personal_category_monthly_totals -- pessoal + a minha parte dos grupos
-- ---------------------------------------------------------------------------
-- O que o painel pessoal e o relatorio por categoria devem ler.
--
-- O lado pessoal sai de `category_monthly_totals` com `group_id IS NULL`, e NAO
-- de uma segunda consulta a `financial_transactions`: ali mora a unica
-- definicao de como o sinal e tratado e de que `transfer` fica fora (inclusive
-- da contagem). Reescrever isso aqui faria as duas pernas de uma transferencia
-- e de um pagamento de fatura virarem receita e despesa de verdade -- o total
-- continuaria certo porque elas se anulam, mas "quanto entrou" e "quanto saiu"
-- inflariam os dois juntos.
--
-- NAO HA DUPLA CONTAGEM A EVITAR, e vale dizer por que: a despesa de grupo tem
-- `group_id IS NOT NULL`, entao ela JA esta fora do lado pessoal -- foi isso
-- que produziu o zero medido no cabecalho. O UNION ALL e puramente aditivo, e a
-- parte de quem pagou substitui o valor cheio porque o valor cheio nunca
-- esteve aqui.
--
-- `net` e RECALCULADO de `income - expense` em vez de somado das duas pernas.
-- Somar o `net` que cada lado trouxe daria o mesmo numero hoje; recalcular
-- garante que ele nao POSSA discordar das outras duas colunas da propria linha.
--
-- Sem `group_id` nas colunas, de proposito: esta view e o lado PESSOAL, onde
-- group_id nao e uma dimensao -- a despesa da Viagem e da Casa somam na mesma
-- categoria do mesmo mes, que e o que o painel pessoal mostra. Quem quer o
-- recorte por grupo le `monthly_cash_flow`, que continua intacta.
CREATE OR REPLACE VIEW public.personal_category_monthly_totals AS
  WITH tudo AS (
    SELECT
      c.user_id, c.month, c.category_id,
      c.expense, c.income, c.transaction_count, c.currency
    FROM public.category_monthly_totals c
    WHERE c.group_id IS NULL

    UNION ALL

    SELECT
      g.user_id, g.month, g.category_id,
      g.expense, g.income, g.transaction_count, g.currency
    FROM public.group_share_category_monthly_totals g
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
  'Entrada e saida por categoria, mes e MOEDA no painel PESSOAL: o que e so meu (group_id IS NULL) mais A MINHA PARTE das despesas de grupo. Ignora transfer. Quem le precisa filtrar user_id -- sem isso a RLS de grupo devolve a parte dos outros membros.';

-- ---------------------------------------------------------------------------
-- 4. personal_monthly_cash_flow -- o realizado do painel
-- ---------------------------------------------------------------------------
-- Rollup da SECAO 3, pela mesma razao que `monthly_cash_flow` e rollup de
-- `category_monthly_totals`: para o total do fluxo e a soma das categorias
-- nunca serem dois numeros diferentes. Uma pizza que nao fecha em 100% e o
-- sintoma de ter duas definicoes.
CREATE OR REPLACE VIEW public.personal_monthly_cash_flow AS
  SELECT
    p.user_id,
    p.month,
    SUM(p.income)::numeric(15,2)  AS income,
    SUM(p.expense)::numeric(15,2) AS expense,
    SUM(p.net)::numeric(15,2)     AS net,
    SUM(p.transaction_count)      AS transaction_count,
    p.currency
  FROM public.personal_category_monthly_totals p
  GROUP BY p.user_id, p.month, p.currency;

COMMENT ON VIEW public.personal_monthly_cash_flow IS
  'Entrada, saida e resultado por mes e MOEDA no painel PESSOAL, incluindo a minha parte das despesas de grupo. Rollup de personal_category_monthly_totals para nao ter duas versoes do mesmo numero. Um mes com duas moedas tem DUAS linhas.';

-- ---------------------------------------------------------------------------
-- 5. security_invoker e GRANTs
-- ---------------------------------------------------------------------------
-- VIEW SEM `security_invoker` RODA COMO O DONO E FURA A RLS.
--
-- Nao e teoria neste repositorio: e exatamente o que o 008 anotou ao criar
-- `monthly_cash_flow`, e o sintoma seria cada usuario vendo o gasto mensal de
-- TODOS os outros. Em `personal_monthly_cash_flow` seria pior do que no 008,
-- porque esta view atravessa quatro tabelas de grupo: um unico SELECT sem
-- filtro devolveria o rateio de gente que nao divide grupo nenhum com quem
-- perguntou.
--
-- As quatro precisam do ajuste: `security_invoker` nao e herdado. Uma view
-- INVOKER lendo uma view DEFINER le com o privilegio da de baixo, e a camada de
-- cima nao conserta isso.
ALTER VIEW public.group_share_entries                 SET (security_invoker = true);
ALTER VIEW public.group_share_category_monthly_totals SET (security_invoker = true);
ALTER VIEW public.personal_category_monthly_totals    SET (security_invoker = true);
ALTER VIEW public.personal_monthly_cash_flow          SET (security_invoker = true);

-- `anon` nao le relatorio de ninguem. REVOKE explicito porque no Supabase o
-- grant de `PUBLIC` em objeto novo ja alcanca anon.
--
-- ISTO E HIGIENE, E NAO E O QUE PROTEGE O DADO. Medido: com SELECT concedido a
-- anon nas quatro views, a leitura AINDA falha --
-- `permission denied for table group_expense_splits` em `group_share_entries`,
-- `permission denied for view category_monthly_totals` nas de cima. Porque as
-- views sao `security_invoker` e o 002 ja revogou as tabelas-base de anon. Quem
-- fecha essa porta e o 002, uma camada abaixo; estas linhas so evitam que a
-- view apareca como legivel para quem inspeciona privilegios.
REVOKE ALL ON public.group_share_entries                 FROM anon;
REVOKE ALL ON public.group_share_category_monthly_totals FROM anon;
REVOKE ALL ON public.personal_category_monthly_totals    FROM anon;
REVOKE ALL ON public.personal_monthly_cash_flow          FROM anon;

-- Somente SELECT: sao views de relatorio e nao ha o que escrever nelas.
GRANT SELECT ON public.group_share_entries                 TO authenticated;
GRANT SELECT ON public.group_share_category_monthly_totals TO authenticated;
GRANT SELECT ON public.personal_category_monthly_totals    TO authenticated;
GRANT SELECT ON public.personal_monthly_cash_flow          TO authenticated;
