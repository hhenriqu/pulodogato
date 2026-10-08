-- ===========================================================================
-- 046 -- UM CRITERIO SO PARA O CUSTO PESSOAL (HMO-258)
-- ===========================================================================
-- A HMO-258 mediu cinco leituras do mesmo mes dando quatro respostas para
-- "quanto a A gastou em maio?". A 045 tirou uma resposta errada de circulacao
-- (o 900 da `planned_vs_actual`, que apagava despesa de grupo inteira). Sobrou
-- a pergunta de produto que a issue dizia vir ANTES do codigo:
--
--   "quando eu pago 90 por tres pessoas, a minha despesa do mes e 90 ou 30?"
--
-- ELA FOI RESPONDIDA. Em 08/10/2026, na interaction da issue, com quatro
-- opcoes medidas na mesa: **1.010,00 -- igual a Financas Pessoais (bruto +
-- reembolso)**. Ou seja, o criterio que a HMO-275 ja aprovou para uma tela
-- passa a valer para o painel e para os relatorios:
--
--   INTEIRO quando EU paguei          (o jantar de 90 conta 90)
--   MINHA PARTE quando OUTRO pagou    (o mercado de 60 da B conta 20)
--
-- A fixture de maio da conta A da HMO-255 -- mercado 500 e combustivel 400 so
-- dela, jantar de 90 pago por ela e dividido por 3, mercado de 60 pago pela B e
-- dividido por 3 --, medida por `scripts/medidor-hmo258.sql`:
--
--                                                     antes (045)   depois (046)
--   /dashboard/despesas (fluxo de caixa) .........      990,00        990,00
--   painel + reports/cash-flow + categories ......      950,00      1.010,00  <--
--   reports/planned-vs-actual ....................      950,00      1.010,00  <--
--   reports/net-worth (|net_change|) .............      990,00        990,00
--   /dashboard/personal-finance (HMO-275) ........    1.010,00      1.010,00
--
-- Cinco leituras, DUAS respostas -- e as duas sao pontas decididas, cada uma
-- com rotulo na tela: 990 e "o que saiu da minha conta" (o cabecalho de
-- `app/api/movimentacoes/resumo/route.ts` explica por que a fracao do que outro
-- pagou fica de fora ali, e a legenda da tela de Despesas diz isso em uma
-- linha); 1.010 e "o que me custou". O 950 era uma TERCEIRA convencao, sem
-- rotulo em tela nenhuma, e e ela que sai daqui.
--
-- POR QUE O PATRIMONIO (990) NAO ENTRA NA UNIFICACAO
-- -------------------------------------------------
-- `net_worth_history` nao e uma leitura de custo, e uma leitura de SALDO: o
-- `net_change` do mes tem de fechar com o que entrou e saiu das contas, senao o
-- patrimonio deixa de bater com o extrato. A minha parte de uma despesa que
-- outro pagou nao tirou dinheiro da minha conta -- enquanto eu nao transferir,
-- ela e uma DIVIDA, nao uma saida. Contar os 20 ali faria o patrimonio cair
-- duas vezes pelo mesmo evento: agora, e de novo quando eu pagasse a B.
--
-- Isto nao e uma excecao ao "um criterio so": e o reconhecimento de que ha duas
-- perguntas diferentes, e a issue previu isso ("as duas respostas sao legitimas
-- -- fluxo de caixa x custo pessoal"). A unificacao pedida e dentro de CADA
-- pergunta; o que nao podia continuar era ter tres respostas para a MESMA.
--
-- ===========================================================================
-- O QUE MUDA, EXATAMENTE -- DUAS LINHAS, E ELAS SO FUNCIONAM JUNTAS
-- ===========================================================================
-- Na `personal_category_monthly_totals` (033):
--
--   1. A perna PESSOAL perde o `WHERE c.group_id IS NULL`. Com ele, a despesa
--      de grupo que EU paguei nunca chegava inteira -- `category_monthly_totals`
--      tem `group_id` no grao, entao o jantar de 90 vivia numa linha de
--      `group_id` nao-nulo e era descartado.
--
--   2. A perna do GRUPO ganha `WHERE NOT g.paguei_eu`. Sem ela, a parte de 30
--      que e minha no jantar viria SOMADA aos 90 da perna 1: 120 de uma despesa
--      de 90. Dupla contagem.
--
-- PARA A PERNA 2 PODER FILTRAR, `group_share_category_monthly_totals` GANHA
-- `paguei_eu` NO GRAO (coluna apendada no fim, que e o que
-- `CREATE OR REPLACE VIEW` permite). A alternativa era a perna 2 ler
-- `group_share_entries` direto com um GROUP BY proprio -- e isso criaria uma
-- SEGUNDA definicao do rollup, que e exatamente o que o cabecalho da 033
-- argumenta contra. `group_share_entries` continua sendo a unica definicao de
-- "minha parte", e `paguei_eu` ja era coluna dela desde a 033.
--
-- ATENCAO AO MUTANTE 2 DE `scripts/mutantes-minha-parte-no-realizado.mjs`
-- ---------------------------------------------------------------------
-- Ele tira exatamente o filtro do item 1 e se chama "o conserto ERRADO ...
-- valor cheio + parte, dupla contagem". Ele continua CERTO e continua medindo:
-- aquele runner monta a cadeia 001 -> 032 e aplica a 033 mutada, SEM a 046, e
-- na 033 sozinha tirar o filtro de fato produz os 120. O que a 046 faz nao e
-- "aplicar o mutante 2": e aplicar o item 1 **junto com** o item 2. Um sem o
-- outro e o defeito que aquele mutante descreve -- e e por isso que o teste
-- desta migration tem um controle negativo para cada metade separada.
--
-- O EFEITO QUE NAO DEPENDE DE CRITERIO NENHUM: RATEIO RECUSADO
-- -----------------------------------------------------------
-- Medido nos dois estados, com o jantar de 90 da A e TODOS os rateios dele
-- `rejected`:
--
--   antes (045)   painel da A = 920,00
--   depois (046)  painel da A = 1.010,00
--
-- Os 920 sao 500 + 400 + 20. Os 90 que sairam da conta DELA desaparecem do
-- painel DELA. `group_share_entries` exclui rateio `rejected`/`expired` (certo,
-- e deliberado na 033), e o filtro do item 1 ja tinha jogado a despesa fora do
-- lado pessoal -- entao ninguem conta.
--
-- Isso nao e uma terceira convencao perdendo para uma quarta: dinheiro que eu
-- gastei e que ninguem vai me devolver e minha despesa sob QUALQUER um dos tres
-- criterios que a issue colocou na mesa. Era defeito, do mesmo tipo do 900 que
-- a 045 consertou, e estava escondido atras de uma pergunta de produto.
--
-- A PROPRIEDADE QUE E PRECISO SABER: A SOMA ENTRE PESSOAS PASSA DO GASTO REAL
-- --------------------------------------------------------------------------
-- No mes da fixture, somando o painel dos tres membros: 1.010 (A) + 90 (B) +
-- 50 (C) = 1.150, contra 1.050 de dinheiro que realmente saiu de contas.
--
-- Os 100 de diferenca sao as partes que A e B ainda vao receber de volta. Isto
-- NAO e um erro de aritmetica: e o que "bruto + reembolso" quer dizer, e a
-- propria opcao escolhida avisava ("conta como meu gasto dinheiro que vai
-- voltar" era o custo listado da opcao de fluxo de caixa, e vale aqui com sinal
-- trocado). `personal_monthly_cash_flow` e uma leitura POR PESSOA do que o mes
-- custou a ela; ela nunca foi, e nao passa a ser, um livro-caixa do grupo.
-- Quem quer o total do grupo le `monthly_cash_flow` com `group_id`, que esta
-- intacta.
--
-- ===========================================================================
-- QUEM LE PRECISA FILTRAR user_id -- E ISSO FICOU MAIS AFIADO AQUI
-- ===========================================================================
-- A policy de SELECT de `financial_transactions` (002) e
-- `user_id = auth.uid() OR (group_id IS NOT NULL AND is_group_member(group_id))`.
-- Com o `group_id IS NULL` da perna 1 no lugar, as linhas dos OUTROS membros
-- eram descartadas de graca -- uma despesa pessoal de outra pessoa nunca e
-- visivel para mim. Sem o filtro, `category_monthly_totals` devolve tambem as
-- despesas de grupo DELES, cada uma na linha do `user_id` de quem pagou.
--
-- Isso nao vaza nada que a RLS ja nao permitisse (quem divide grupo comigo pode
-- ler aquelas linhas desde a 002, e e assim que a tela do grupo funciona), e nao
-- entra no MEU total enquanto o leitor filtrar `user_id`. Os tres leitores
-- filtram, e o codigo diz que isso e load-bearing:
--
--   app/api/reports/cash-flow/route.ts   (`eq("user_id")`, comentado na linha 438)
--   app/api/reports/categories/route.ts  (`eq("user_id")`, comentado na linha 284)
--   public.planned_vs_actual             (`pf.user_id = k.user_id` no LATERAL, 045)
--
-- A perna 2 ja tinha essa propriedade desde a 033 ("Nao tem filtro por user_id:
-- quem le PRECISA filtrar"), entao o que muda e o alcance do aviso, nao a
-- natureza dele. O teste tem um controle negativo que le a view SEM filtrar
-- user_id e mostra o total do outro membro aparecendo -- para que a proxima
-- pessoa que escrever um leitor novo veja o sintoma antes de causa-lo.
--
-- ===========================================================================
-- O QUE ESTA MIGRATION NAO TOCA
-- ===========================================================================
-- `monthly_cash_flow` e `category_monthly_totals` -- as views com `group_id` no
-- grao, que a tela DO GRUPO le e onde o numero certo e o valor cheio de todos
-- os membros. A 033 defendeu essa fronteira e a 045 a reafirmou; a 046 nao a
-- atravessa. `net_worth_history` tampouco, pela razao da secao de cima.
--
-- `personal_monthly_cash_flow` nao e redefinida: ela e `SUM` da
-- `personal_category_monthly_totals` e acompanha sozinha. Nao sendo tocada por
-- `CREATE OR REPLACE`, ela tambem nao perde `security_invoker` -- so as duas
-- views realmente substituidas aqui precisam do `ALTER` de volta.
--
-- `budget_consumption` CONTINUA FORA, e agora a divida tem numero: ela le
-- `monthly_cash_flow` e portanto ignora despesa de grupo no consumo de
-- orcamento. A 033 ja a citou, a 045 repetiu e esta repete -- com a decisao
-- tomada, ela virou trabalho mecanico em vez de pergunta aberta, e cabe numa
-- issue propria em vez de pegar carona numa migration que ja mexe em duas
-- views.
--
-- ===========================================================================
-- COMO RODAR
-- ===========================================================================
--   psql "$URL" -v ON_ERROR_STOP=1 -f database/migrations/046_um_criterio_de_custo_pessoal.sql
--
-- Aplicar depois de 001 -> ... -> 045. O preflight aborta listando o que falta.
-- Re-executavel: so tem CREATE OR REPLACE VIEW, COMMENT, GRANT e ALTER VIEW.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Preflight
-- ---------------------------------------------------------------------------
-- As duas views substituidas vem da 033, e a coluna `paguei_eu` que a perna 2
-- passa a filtrar tambem. Sem o preflight o erro seria "column does not exist",
-- que diz o objeto e nao a migration -- e "qual migration falta" e a pergunta
-- que a pessoa tem na mao na hora.
DO $$
DECLARE
  v_faltando TEXT;
BEGIN
  SELECT string_agg(msg, E'\n') INTO v_faltando FROM (
    SELECT '  - view public.group_share_entries (vem do 033)' AS msg
    WHERE to_regclass('public.group_share_entries') IS NULL
    UNION ALL
    SELECT '  - view public.group_share_category_monthly_totals (vem do 033)'
    WHERE to_regclass('public.group_share_category_monthly_totals') IS NULL
    UNION ALL
    SELECT '  - view public.personal_category_monthly_totals (vem do 033)'
    WHERE to_regclass('public.personal_category_monthly_totals') IS NULL
    UNION ALL
    SELECT '  - view public.category_monthly_totals (vem do 008)'
    WHERE to_regclass('public.category_monthly_totals') IS NULL
    UNION ALL
    -- O criterio inteiro depende deste booleano: ele e o unico campo que separa
    -- "eu paguei" de "outro pagou".
    SELECT '  - coluna paguei_eu em public.group_share_entries (vem do 033)'
    WHERE to_regclass('public.group_share_entries') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'group_share_entries'
           AND column_name = 'paguei_eu'
      )
    UNION ALL
    -- A 022 poe `currency` no grao destas views. Sem ela as duas pernas do
    -- UNION ALL somariam reais com dolares.
    SELECT '  - coluna currency no grao de public.personal_category_monthly_totals (vem do 022/033)'
    WHERE to_regclass('public.personal_category_monthly_totals') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'personal_category_monthly_totals'
           AND column_name = 'currency'
      )
  ) AS checks
  WHERE msg IS NOT NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'046 nao pode ser aplicado neste banco. Faltando:\n%\n\nRode 001 -> ... -> 045 antes.', v_faltando;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. group_share_category_monthly_totals -- `paguei_eu` entra no grao
-- ---------------------------------------------------------------------------
-- A coluna vai no FIM da lista, e nao perto de `user_id` onde ela se leria
-- melhor: `CREATE OR REPLACE VIEW` so aceita APENDAR coluna. Inserir no meio
-- exigiria DROP, e um DROP aqui derrubaria em cascata
-- `personal_category_monthly_totals` -- que e justamente a view que a proxima
-- secao precisa ter de pe para substituir.
--
-- O GRAO FICA MAIS FINO: um mes em que eu paguei uma despesa da Casa e devo
-- parte de outra, as duas na mesma categoria, passa de uma linha para DUAS.
-- Isso e seguro porque esta view tem um unico leitor no repositorio
-- (`personal_category_monthly_totals`, logo abaixo, que soma) -- conferido com
-- grep em `.ts`, `.tsx` e `.sql`. Quem agregava continua agregando; o que antes
-- era impossivel e agora da, e distinguir as duas origens.
--
-- `income` continua 0 por construcao: `group_share_entries` filtra
-- `transaction_type = 'expense'`. A coluna existe para o UNION ALL da secao 2
-- nao precisar inventar colunas, e o comentario da 033 ja dizia isso.
CREATE OR REPLACE VIEW public.group_share_category_monthly_totals AS
  SELECT
    e.user_id,
    e.group_id,
    e.month,
    e.category_id,
    SUM(e.amount)::numeric(15,2)        AS expense,
    0::numeric(15,2)                    AS income,
    COUNT(*)                            AS transaction_count,
    e.currency,
    -- A 046 acrescenta esta coluna. TRUE = a despesa e minha e o valor cheio
    -- dela ja esta no lado pessoal; quem soma custo pessoal tem de descartar
    -- estas linhas, ou conta a mesma despesa duas vezes.
    e.paguei_eu
  FROM public.group_share_entries e
  GROUP BY e.user_id, e.group_id, e.month, e.category_id, e.currency, e.paguei_eu;

COMMENT ON VIEW public.group_share_category_monthly_totals IS
  'Rollup mensal de group_share_entries, no formato de category_monthly_totals. Despesa POSITIVA, income sempre 0. Sem coluna net de proposito: quem agrega recalcula de income - expense. Uma linha por (usuario, grupo, mes, categoria, moeda, paguei_eu) -- o paguei_eu entrou no grao na 046, porque quem soma CUSTO PESSOAL conta o valor cheio do que eu paguei pelo lado pessoal e so pode somar daqui a parte do que OUTRO pagou.';

-- ---------------------------------------------------------------------------
-- 2. personal_category_monthly_totals -- o criterio escolhido
-- ---------------------------------------------------------------------------
-- As duas mudancas da 046 estao nas duas pernas do UNION ALL, e cada uma sem a
-- outra e um defeito conhecido:
--
--   perna 1 sem perna 2  ->  valor cheio + minha parte = 120 de um jantar de 90
--   perna 2 sem perna 1  ->  o 950 de antes (minha parte dos dois lados)
--
-- O teste da 046 tem um controle negativo para cada uma, separadamente.
--
-- `transaction_count` continua certo sem precisar de ajuste, e vale dizer por
-- que: uma despesa de grupo que eu paguei era contada uma vez pela perna 2 (a
-- minha parte) e passa a ser contada uma vez pela perna 1 (a despesa). A
-- contagem nao muda -- o que muda e o VALOR. Isso importa porque a rota divide
-- o total pelos meses com movimento para dar a media, e a 033 registrou que uma
-- contagem zerada apagaria o mes do membro que nao pagou nada.
--
-- `net` segue RECALCULADO de `income - expense`, e nao somado das pernas, para
-- nao PODER discordar das outras duas colunas da propria linha.
CREATE OR REPLACE VIEW public.personal_category_monthly_totals AS
  WITH tudo AS (
    -- PERNA 1 -- TUDO O QUE EU LANCEI, inclusive o que e de grupo, pelo valor
    -- CHEIO. Sai de `category_monthly_totals` e nao de uma consulta nova a
    -- `financial_transactions` porque ali mora a unica definicao de como o
    -- sinal e tratado e de que `transfer` fica fora (inclusive da contagem) --
    -- reescrever isso aqui faria as duas pernas de uma transferencia e de um
    -- pagamento de fatura virarem receita e despesa de verdade.
    --
    -- O `WHERE c.group_id IS NULL` da 033 SAIU (046): era ele que apagava do
    -- meu custo a despesa de grupo que eu mesma paguei. Note que isto so esta
    -- correto porque a perna 2 descarta `paguei_eu`.
    SELECT
      c.user_id, c.month, c.category_id,
      c.expense, c.income, c.transaction_count, c.currency
    FROM public.category_monthly_totals c

    UNION ALL

    -- PERNA 2 -- O REEMBOLSO QUE EU DEVO: a minha parte do que OUTRO pagou.
    -- `NOT g.paguei_eu` entrou na 046. O que eu paguei ja veio inteiro pela
    -- perna 1; somar a minha parte dele aqui contaria a despesa duas vezes.
    SELECT
      g.user_id, g.month, g.category_id,
      g.expense, g.income, g.transaction_count, g.currency
    FROM public.group_share_category_monthly_totals g
    WHERE NOT g.paguei_eu
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
  'CUSTO PESSOAL por categoria, mes e MOEDA: tudo o que EU lancei pelo valor cheio (inclusive despesa de grupo que eu paguei) mais A MINHA PARTE do que OUTRO pagou. Criterio escolhido na HMO-258 em 08/10/2026, o mesmo da HMO-275 em Financas Pessoais. Ignora transfer. NAO e fluxo de caixa: a parte do que outro pagou ainda nao saiu da minha conta -- para "o que saiu da conta" existe movimentacoes/resumo e net_worth_history. Quem le PRECISA filtrar user_id: sem isso a RLS de grupo devolve tambem as despesas de grupo dos OUTROS membros, cada uma no user_id de quem pagou.';

-- ---------------------------------------------------------------------------
-- 3. security_invoker e GRANTs
-- ---------------------------------------------------------------------------
-- `CREATE OR REPLACE VIEW` APAGA AS reloptions DA VIEW, e `security_invoker` e
-- uma reloption. Sem o ALTER de volta, as duas views acima voltam a ser
-- DEFINER, e as duas precisam dele uma a uma: `security_invoker` nao e herdado.
--
-- MAS O SINTOMA NAO E O QUE AS MIGRATIONS IRMAS DESCREVEM, E ISSO FOI MEDIDO.
--
-- A 033 e a 045 dizem, com razao no caso delas, que perder o `security_invoker`
-- faria "cada pessoa ver o dado de todas as outras". Aqui nao faz. Medido num
-- banco com a cadeia inteira, com um usuario que nao divide grupo com ninguem:
--
--   so personal_category_monthly_totals como DEFINER ......... 0 linhas do outro
--   ela E category_monthly_totals (008) como DEFINER .......... 1 linha do outro
--
-- A razao e que nenhuma das duas views desta migration toca uma tabela com RLS:
-- as duas leem outras VIEWS (`category_monthly_totals` do 008 e
-- `group_share_entries` da 033), e e nessas que `financial_transactions`
-- aparece. Uma view DEFINER troca o dono para a checagem das relacoes que ELA
-- referencia; quando a de baixo e INVOKER, a RLS la embaixo volta a ser avaliada
-- com o usuario da sessao. Quem protege a linha, aqui, e o `security_invoker`
-- das views de BAIXO.
--
-- Entao por que reaplicar o ALTER? Por duas razoes que nao sao "o vazamento de
-- hoje": manter a cadeia inteira uniforme (uma unica view DEFINER no meio e uma
-- armadilha para quem, amanha, fizer uma destas ler
-- `financial_transactions` direto -- e ai o vazamento passa a existir), e nao
-- deixar o schema divergir do que a 033 estabeleceu para as mesmas quatro views.
--
-- Isso tem uma consequencia no TESTE, e ela esta escrita la: o controle negativo
-- da RLS NAO pega esta reloption. Quem pega e a assercao direta sobre
-- `reloptions`. As duas existem e medem coisas diferentes.
ALTER VIEW public.group_share_category_monthly_totals SET (security_invoker = true);
ALTER VIEW public.personal_category_monthly_totals    SET (security_invoker = true);

-- Os mesmos GRANTs da 033, reafirmados porque o REPLACE pode vir de um banco
-- onde eles nunca foram dados.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.group_share_category_monthly_totals FROM anon';
    EXECUTE 'REVOKE ALL ON public.personal_category_monthly_totals FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT ON public.group_share_category_monthly_totals TO authenticated';
    EXECUTE 'GRANT SELECT ON public.personal_category_monthly_totals TO authenticated';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Sonda: as duas views ficaram com security_invoker?
-- ---------------------------------------------------------------------------
-- NOTICE e nao EXCEPTION, no mesmo tom da 042 e da 045: quem reprova isso de
-- verdade e o teste desta migration (que mede PELA RLS, com dois usuarios) e o
-- `view_security_invoker_test.sql`, que roda depois de todas as migrations.
-- Esta linha existe para quem aplica a mao no SQL Editor e nao roda teste.
DO $$
DECLARE
  v_sem TEXT;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO v_sem
    FROM pg_class c
   WHERE c.oid IN ('public.group_share_category_monthly_totals'::regclass,
                   'public.personal_category_monthly_totals'::regclass)
     AND NOT COALESCE(c.reloptions @> ARRAY['security_invoker=true'], FALSE);

  IF v_sem IS NOT NULL THEN
    RAISE NOTICE '046: ficou SEM security_invoker (furando a RLS): %', v_sem;
  END IF;
END $$;
