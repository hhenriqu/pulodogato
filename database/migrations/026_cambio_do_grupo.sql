-- 026_cambio_do_grupo.sql
--
-- HMO-138, item 3: multimoeda da viagem. Moeda do GRUPO, o cambio do dia da
-- compra GRAVADO no lancamento, e o acerto de contas convergindo para uma
-- moeda so.
--
-- As duas decisoes do Helio (interaction respondida em 2026-09-29T18:59Z):
--
--   "completo"        -- moeda do grupo + cambio do dia gravado no lancamento,
--                        e o acerto de contas converte tudo para uma moeda.
--   "ptax_editavel"   -- a cotacao vem da PTAX do Banco Central e a pessoa pode
--                        corrigir. Por isso o cambio e uma COLUNA comum, e nao
--                        uma tabela de cotacoes: o numero que vale e o que ela
--                        confirmou na hora, nao o que a API devolveria hoje.
--
-- A 022 (HMO-171) ja trouxe a moeda da conta, a do lancamento e a moeda no grao
-- das tres views de relatorio. Ela resolveu o problema dela -- "nao somar dolar
-- com real" -- MOSTRANDO SEPARADO, porque o app nao tinha cotacao nenhuma.
-- Aqui passa a ter, e isso muda o que e possivel: grupo nao pode mostrar
-- separado. Um acerto de contas em duas colunas nao e um acerto de contas.
--
-- ===========================================================================
-- O QUE ESTA MIGRATION EXISTE PARA FECHAR
-- ===========================================================================
-- Duas views somam dinheiro SEM saber de moeda, e as duas ficam erradas no
-- minuto em que existir uma despesa de grupo em dolar. Nenhuma das duas da
-- erro, nenhuma devolve NULL, e as duas erram para o lado de que ninguem
-- reclama:
--
--   1) `group_member_balances` (007). `SUM(ABS(t.amount))` do que o membro
--      pagou, `SUM(es.amount)` do que ele deve. Um jantar de US$ 180 entra como
--      180 ao lado de um mercado de R$ 1.000, e o `net_balance` sai em moeda
--      nenhuma. A tela de acerto le exatamente essa coluna e sugere
--      transferencias com ela: a viagem inteira em dolar seria acertada como se
--      fosse em real, cobrando de cada um cerca de um quinto do que ele deve.
--      Quem pagou os dolares perde a diferenca, e a conta FECHA -- soma zero,
--      residual zero, nada para uma assercao de consistencia pegar.
--
--   2) `budget_consumption` (006). O teto de grupo da Fase 3 (PR #92) le essa
--      view. `SUM(ABS(t.amount))` sobre um teto em reais: a barra da viagem ao
--      exterior marcaria 18% de US$ 180 num teto de R$ 1.000 e ficaria verde
--      durante toda a viagem.
--
-- Agora que existe cotacao por linha, as duas convertem para BRL e cada numero
-- que sai delas esta em BRL. O grao por moeda do 022 continua valendo onde ele
-- resolve o problema (relatorio pessoal: "gastei 1.000 reais e 180 dolares" e a
-- resposta certa); o grupo converte, porque a pergunta dele e "quem deve
-- quanto a quem", e essa pergunta tem uma unica resposta.
--
-- POR QUE O DENOMINADOR E BRL, E NAO A MOEDA DO GRUPO
-- ---------------------------------------------------
-- Converter para a moeda do grupo dentro do banco exigiria, para cada despesa,
-- a cotacao da moeda DO GRUPO no dia DAQUELA despesa -- um numero que ninguem
-- gravou, porque o lancamento em real de uma viagem em dolar nao tem cotacao
-- nenhuma para gravar. So uma tabela de cotacoes diarias completa daria isso, e
-- ela teria que ser preenchida para todo dia de toda viagem, inclusive os dias
-- em que a PTAX nao existe (fim de semana e feriado).
--
-- Com BRL como denominador, a conversao de cada linha usa a cotacao que ESTA na
-- propria linha: exata, sem consulta, e imune a qualquer coisa que aconteca
-- depois. O valor do passado nao muda sozinho -- que e literalmente o pedido da
-- issue.
--
-- `expense_groups.currency` continua sendo o que a decisao pediu, e serve as
-- duas coisas para as quais uma moeda de grupo serve de verdade: ser a moeda
-- SUGERIDA a cada despesa da viagem, e ser a moeda em que a tela APRESENTA o
-- saldo. A segunda e conversao de apresentacao de UM numero do presente (a
-- divida que voce vai pagar agora), feita na tela, ao cambio de hoje e dizendo
-- que e de hoje. Isso nao e o valor do passado mudando: e o mesmo R$ 267,50 de
-- sempre, escrito em dolar.
--
-- POR QUE `exchange_rate = 1` E PROIBIDO FORA DO BRL
-- --------------------------------------------------
-- Ver a SECAO 2. E a parte menos obvia do arquivo e a que protege dinheiro.
--
-- Idempotente: pode rodar duas vezes seguidas sem erro.
-- Cola como lote unico no SQL Editor (nenhum meta-comando de psql aqui).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Moeda do grupo
-- ---------------------------------------------------------------------------
-- Mesma lista fechada de 13 codigos da 022, pela mesma razao: a fonte de
-- verdade e `MOEDAS` em lib/dinheiro.ts, e um codigo que o app nao conhece
-- viraria uma linha que nenhuma tela sabe formatar (`moedaPorCodigo` cai no
-- padrao, ou seja: uma viagem em CZK apareceria em reais, sem aviso).
--
-- O ultimo caso de scripts/test-dinheiro.mjs le ESTE arquivo tambem: ele acha
-- todo CHECK de moeda nas migrations e compara codigo por codigo com `MOEDAS`.
-- Uma lista nova aqui, esquecida la, fica vermelha no mesmo PR.

ALTER TABLE public.expense_groups
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'BRL';

COMMENT ON COLUMN public.expense_groups.currency IS
  'Moeda desta viagem/grupo (ISO 4217). E a moeda SUGERIDA a cada despesa do grupo e a moeda em que a tela apresenta o saldo. Nao e o denominador do saldo: group_member_balances devolve BRL. Todo grupo que ja existia e BRL.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expense_groups_currency_check'
  ) THEN
    ALTER TABLE public.expense_groups
      ADD CONSTRAINT expense_groups_currency_check
      CHECK (currency IN ('BRL','USD','EUR','GBP','CHF','CAD','AUD','ARS','CLP','UYU','PYG','JPY','CNY'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. O cambio do dia da compra, no lancamento
-- ---------------------------------------------------------------------------
-- Quantos REAIS vale UMA unidade de `currency` no dia `transaction_date`.
-- USD a 5,35 grava 5.35000000. BRL grava 1.
--
-- 8 casas porque o guarani e o peso chileno vivem na terceira casa a direita do
-- zero (PYG ~ 0,00073) e a conta precisa sobreviver a um valor de seis digitos
-- multiplicado por isso sem perder centavo.
--
-- NOT NULL DEFAULT 1: e o backfill do historico, nao uma reescrita dele. Todo
-- lancamento que existe hoje e BRL (default da 022), e a cotacao correta de BRL
-- e exatamente 1 -- entao nao existe, em nenhum instante, linha com cotacao
-- ausente ou errada.
--
-- OS DOIS CHECKS, E POR QUE O SEGUNDO E O IMPORTANTE
-- --------------------------------------------------
-- `exchange_rate > 0` e higiene: cotacao zero zeraria o valor em real de uma
-- despesa (a despesa desapareceria do saldo do grupo em vez de dar erro), e
-- negativa inverteria o sinal do dinheiro.
--
-- O outro CHECK e o que fecha o unico caminho de perda silenciosa que sobra
-- nesta feature. O DEFAULT 1 tem que existir para o backfill; mas DEFAULT 1 num
-- lancamento em DOLAR e uma cotacao errada com cara de cotacao. Uma rota antiga
-- que grave `currency: 'USD'` e esqueca o cambio -- ou o campo editavel enviado
-- vazio, ou a fila offline montada antes desta migration -- gravaria US$ 180
-- valendo R$ 180. A tela mostra "US$ 180,00" corretamente, o saldo do grupo
-- fecha, ninguem ve nada, e o erro e de 80% para menos.
--
-- Por isso: cotacao 1 se e somente se BRL. O caminho do esquecimento passa a
-- devolver 23514 na cara da rota, em vez de gravar dinheiro errado.
--
-- O preco: uma moeda estrangeira que valesse exatamente R$ 1,00000000 nao
-- poderia ser gravada na paridade exata (usa-se 1.00000001, um erro de um
-- centesimo de centavo em dez mil reais). Nenhuma das 12 moedas estrangeiras da
-- lista esta perto de 1 real -- a mais proxima e o peso uruguaio, na casa dos
-- 0,13 -- e se um dia uma estiver, o preco continua sendo esse. E uma troca
-- deliberada: um arredondamento invisivel numa moeda hipotetica, em troca de
-- fechar um erro de 80% numa moeda real.

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(18,8) NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.financial_transactions.exchange_rate IS
  'Quantos reais vale 1 unidade de currency no dia transaction_date (PTAX, editavel). Congelado: e a cotacao do dia da COMPRA, e nunca e recalculada. amount * exchange_rate = o valor em BRL. Vale 1 se e somente se currency = BRL.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'financial_transactions_exchange_rate_check'
  ) THEN
    ALTER TABLE public.financial_transactions
      ADD CONSTRAINT financial_transactions_exchange_rate_check
      CHECK (exchange_rate > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'financial_transactions_rate_matches_currency'
  ) THEN
    ALTER TABLE public.financial_transactions
      ADD CONSTRAINT financial_transactions_rate_matches_currency
      CHECK ((currency = 'BRL') = (exchange_rate = 1));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. O cambio do acerto
-- ---------------------------------------------------------------------------
-- `group_settlements` (007) registra um pagamento de um membro para outro, e
-- guarda `amount` sem moeda nenhuma. Na viagem ao exterior esse pagamento
-- acontece em dolar, e o pagamento entra na MESMA soma que as despesas:
-- `group_member_balances` cruza pago, devido e acertos. Um acerto de US$ 50
-- lido como R$ 50 nao zera a divida de quem pagou -- ele abate um quinto dela,
-- e a tela continua pedindo o resto depois de o dinheiro ter sido pago.
--
-- Cambio congelado no dia do pagamento (`settled_on`) pelo mesmo motivo do
-- lancamento, e com os dois mesmos CHECKs pela mesma razao.

ALTER TABLE public.group_settlements
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'BRL';

COMMENT ON COLUMN public.group_settlements.currency IS
  'Moeda em que este pagamento foi feito de verdade (ISO 4217). Pode diferir da moeda do grupo: na viagem se paga no que se tem.';

ALTER TABLE public.group_settlements
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(18,8) NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.group_settlements.exchange_rate IS
  'Quantos reais vale 1 unidade de currency no dia settled_on. Congelado. amount * exchange_rate = o valor em BRL que este pagamento abateu. Vale 1 se e somente se currency = BRL.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'group_settlements_currency_check'
  ) THEN
    ALTER TABLE public.group_settlements
      ADD CONSTRAINT group_settlements_currency_check
      CHECK (currency IN ('BRL','USD','EUR','GBP','CHF','CAD','AUD','ARS','CLP','UYU','PYG','JPY','CNY'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'group_settlements_exchange_rate_check'
  ) THEN
    ALTER TABLE public.group_settlements
      ADD CONSTRAINT group_settlements_exchange_rate_check
      CHECK (exchange_rate > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'group_settlements_rate_matches_currency'
  ) THEN
    ALTER TABLE public.group_settlements
      ADD CONSTRAINT group_settlements_rate_matches_currency
      CHECK ((currency = 'BRL') = (exchange_rate = 1));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. O saldo do grupo, em BRL
-- ---------------------------------------------------------------------------
-- Identica a versao do 007 em TODO o resto -- de proposito. O ABS() com filtro
-- por `transaction_type` (despesa e gravada negativa neste banco), o `expense`
-- sozinho no lado do pago, o `status NOT IN ('rejected','expired')` no lado do
-- devido, o sinal invertido dos acertos (quem PAGA tem o saldo AUMENTADO), a
-- juncao por `user_id` e nao por `member_id`: cada uma dessas linhas tem uma
-- razao escrita no 007 e um teste que a trava. A unica diferenca aqui e o
-- `* exchange_rate`. Reescrever mais do que isso seria mudar dois numeros ao
-- mesmo tempo sem saber qual deles quebrou.
--
-- A multiplicacao entra DENTRO do SUM, por linha, e nao fora dele: fora, ela
-- aplicaria a cotacao de uma linha ao total de todas -- o que da o numero certo
-- exatamente enquanto todas as linhas tiverem a mesma moeda, ou seja, passa em
-- todo teste que nao misture moedas de proposito.
--
-- O lado do DEVIDO precisa de um JOIN novo. `group_expense_splits` nao tem
-- moeda nem cotacao propria, e nao deve ter: a parte de cada um e uma fracao da
-- despesa e esta na moeda DELA. A cotacao correta para a divisao e a da despesa
-- que a originou, entao o LATERAL passa por `financial_transactions`. Dar
-- cotacao propria a divisao permitiria divergencia entre a parte e o todo --
-- 100 dolares divididos em duas partes de 50 que somam 900 reais numa despesa
-- de 535.
--
-- O cast final para numeric(15,2) e onde o arredondamento acontece, uma vez, no
-- fim: e onde o 007 ja arredondava. Arredondar linha por linha antes de somar
-- afastaria os dois lados da conta em centavos e deixaria residual que nenhum
-- pagamento zera.
CREATE OR REPLACE VIEW public.group_member_balances AS
  SELECT
    m.group_id,
    m.user_id,
    m.id                                        AS member_id,
    COALESCE(p.paid, 0)::numeric(15,2)          AS total_paid,
    COALESCE(o.owed, 0)::numeric(15,2)          AS total_owed,
    COALESCE(s.paid_out, 0)::numeric(15,2)      AS settlements_paid,
    COALESCE(s.received, 0)::numeric(15,2)      AS settlements_received,
    (COALESCE(p.paid, 0)
     - COALESCE(o.owed, 0)
     + COALESCE(s.paid_out, 0)
     - COALESCE(s.received, 0))::numeric(15,2)  AS net_balance,
    COALESCE(p.paid_count, 0)                   AS paid_count,
    COALESCE(o.owed_count, 0)                   AS owed_count,
    -- As duas colunas novas vao no FIM porque `CREATE OR REPLACE VIEW` so
    -- aceita coluna nova no fim; mudar a posicao de uma existente exigiria
    -- DROP, e um DROP CASCADE aqui levaria os GRANTs e o security_invoker
    -- junto, mais o que eu nao listei.
    --
    -- `amount_currency` e uma constante, e existe justamente por isso: as sete
    -- colunas de dinheiro acima nao dizem em que moeda estao, e agora ha duas
    -- moedas em jogo na mesma tela. Quem consome a view nao precisa descobrir
    -- lendo este arquivo, e o dia em que o denominador mudar, muda aqui.
    'BRL'::text                                 AS amount_currency,
    -- A moeda da VIAGEM. Nao e a moeda dos numeros acima -- e a moeda em que a
    -- tela deve apresenta-los, convertendo no cliente, ao cambio de hoje e
    -- dizendo que e de hoje.
    eg.currency                                 AS group_currency
  FROM public.group_members m
  JOIN public.expense_groups eg ON eg.id = m.group_id

  -- o que este usuario pagou pelo grupo
  LEFT JOIN LATERAL (
    SELECT SUM(ABS(t.amount) * t.exchange_rate) AS paid, COUNT(*) AS paid_count
    FROM public.group_transactions gt
    JOIN public.financial_transactions t ON t.id = gt.transaction_id
    WHERE gt.group_id = m.group_id
      AND t.user_id = m.user_id
      AND t.transaction_type = 'expense'
  ) AS p ON TRUE

  -- a parte que cabe a ele nas despesas do grupo, na cotacao da despesa
  LEFT JOIN LATERAL (
    SELECT SUM(es.amount * t.exchange_rate) AS owed, COUNT(*) AS owed_count
    FROM public.group_expense_splits es
    JOIN public.group_members em ON em.id = es.member_id
    JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    JOIN public.financial_transactions t ON t.id = gt.transaction_id
    WHERE gt.group_id = m.group_id
      AND em.user_id = m.user_id
      AND es.status NOT IN ('rejected', 'expired')
  ) AS o ON TRUE

  -- os acertos ja registrados, nas duas direcoes, na cotacao do dia do pagamento
  LEFT JOIN LATERAL (
    SELECT
      SUM(CASE WHEN gs.from_user_id = m.user_id THEN gs.amount * gs.exchange_rate ELSE 0 END) AS paid_out,
      SUM(CASE WHEN gs.to_user_id   = m.user_id THEN gs.amount * gs.exchange_rate ELSE 0 END) AS received
    FROM public.group_settlements gs
    WHERE gs.group_id = m.group_id
      AND (gs.from_user_id = m.user_id OR gs.to_user_id = m.user_id)
  ) AS s ON TRUE

  WHERE m.status = 'active';

COMMENT ON VIEW public.group_member_balances IS
  'Saldo de cada membro ativo, sempre em BRL (coluna amount_currency): pago - devido + acertos pagos - acertos recebidos, cada parcela convertida pela cotacao congelada da propria linha. Negativo = deve. group_currency e a moeda da viagem, para a tela apresentar.';

-- O JOIN com expense_groups e novo e muda quem a view devolve: membro cujo
-- grupo desapareceu deixa de aparecer. Isso nao e alcancavel -- group_members
-- tem FK para expense_groups -- e o DELETE de grupo do 020 arquiva em vez de
-- apagar. E um JOIN, e nao LEFT JOIN, porque `group_currency` NULL seria pior:
-- a tela cairia no padrao BRL e mostraria uma viagem em dolar em reais.

-- ---------------------------------------------------------------------------
-- 5. A barra do orcamento, em BRL
-- ---------------------------------------------------------------------------
-- `budget_consumption` (006) compara gasto com `amount_limit`, e o teto e um
-- numero em reais digitado por uma pessoa. Converter o gasto e o que torna a
-- comparacao uma comparacao.
--
-- Unica diferenca em relacao ao 006: o `* t.exchange_rate` dentro do SUM. O
-- resto -- o ABS() pela despesa negativa, a janela de mes por `>= month` e
-- `< month + 1 mes`, o CASE que separa teto de grupo (por `group_id`) de teto
-- pessoal (por `user_id` com `group_id IS NULL`) -- e identico de proposito.
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
    SELECT SUM(ABS(t.amount) * t.exchange_rate) AS spent
    FROM public.financial_transactions t
    WHERE t.category_id = b.category_id
      AND t.transaction_type = 'expense'
      AND t.transaction_date >= b.month
      AND t.transaction_date < (b.month + INTERVAL '1 month')::date
      AND CASE
            WHEN b.group_id IS NOT NULL THEN t.group_id = b.group_id
            ELSE t.user_id = b.user_id AND t.group_id IS NULL
          END
  ) AS g ON TRUE;

COMMENT ON VIEW public.budget_consumption IS
  'budgets com o consumido, o que resta e o status (ok/alert/exceeded) calculados na leitura. Gasto convertido para BRL pela cotacao congelada de cada lancamento, que e a moeda de amount_limit.';

-- ---------------------------------------------------------------------------
-- 6. security_invoker e GRANTs, de novo, nas duas
-- ---------------------------------------------------------------------------
-- `CREATE OR REPLACE VIEW` preserva reloptions e GRANTs, entao em teoria o que
-- o 006 e o 007 concederam continua valendo. Esta secao existe porque "em
-- teoria" e o que separa esta migration de um vazamento: sem
-- `security_invoker`, a view roda com os direitos do DONO, a RLS nao se aplica,
-- e `group_member_balances` devolve o saldo de todos os grupos do app para
-- qualquer um logado. Repetir o ALTER e barato; descobrir que a preservacao nao
-- valia, nao. database/tests/view_security_invoker_test.sql tambem cobre isso.

ALTER VIEW public.group_member_balances SET (security_invoker = true);
ALTER VIEW public.budget_consumption SET (security_invoker = true);

REVOKE ALL ON public.group_member_balances FROM anon;
REVOKE ALL ON public.budget_consumption FROM anon;

GRANT SELECT ON public.group_member_balances TO authenticated;
GRANT SELECT ON public.budget_consumption TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. O que NAO entra aqui, e por que
-- ---------------------------------------------------------------------------
-- `scheduled_transactions` nao ganha cotacao. Ela e a conta PREVISTA, e a 022
-- ja resolveu o risco dela pelo outro caminho: `planned_vs_actual` tem a moeda
-- no grao e casa previsto com realizado por moeda, entao nao ha soma de moedas
-- diferentes para fechar. Uma cotacao numa data futura tambem nao existe: a
-- PTAX de uma conta que vence em marco nao esta disponivel hoje, e inventar uma
-- seria gravar chute com a mesma cara de cotacao confirmada.
--
-- Nao ha tabela de cotacoes diarias. A PTAX de uma data passada nunca muda,
-- entao ela seria um cache legitimo -- mas o cache que importa e a propria
-- coluna `exchange_rate` da linha, que e o unico numero que precisa sobreviver.
-- Uma tabela de referencia aqui custaria RLS e GRANT proprios e traria de volta
-- a armadilha de `transaction_categories`: tabela com GRANT SELECT sozinho, em
-- que o app tenta criar a linha que falta e leva 42501 para sempre.

INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('026', '026_cambio_do_grupo',
        'Moeda do grupo e cambio do dia da compra congelado no lancamento; saldo de grupo e consumo de orcamento convertidos para BRL - HMO-138 item 3', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
