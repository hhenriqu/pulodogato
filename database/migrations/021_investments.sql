-- 021_investments.sql
--
-- HMO-169: a tela de investimentos. Quatro componentes de components/ estao
-- escritos e sem importador desde a HMO-163 porque a TELA deles nao existe, e a
-- tela nao existia porque nao ha de onde o dado vir. Esta migration cria de
-- onde.
--
-- DECISAO DE ESCOPO (HMO-141, item 1 e 2): carteira MANUAL, sem cotacao
-- automatica.
--
--   O "acompanhamento de investimentos" que a pagina de Planos vende pode ser
--   duas coisas de tamanhos muito diferentes: carteira lancada a mao, ou
--   integracao com corretora. A segunda depende de contrato, chave e termo de
--   uso de uma fonte de preco (B3/brapi/Alpha Vantage) -- decisao de produto com
--   custo, nao de codigo. A primeira nao depende de ninguem e ja entrega o
--   numero que o usuario quer ver.
--
--   Por isso o preco atual mora numa COLUNA desta tabela
--   (`investment_assets.current_price`), informada pelo usuario, com a data em
--   que ele informou (`current_price_at`). Quando houver fonte de cotacao, ela
--   passa a escrever nessa mesma coluna e nada mais muda -- o calculo da
--   carteira le a coluna, nao a origem dela.
--
--   O que NAO entra aqui: `/dashboard/trading` ("sinais de trading em tempo
--   real"). Recomendacao de investimento tem implicacao regulatoria (CVM) e
--   continua no EmDesenvolvimento de proposito -- ver HMO-141, item 3.
--
-- SINAL DOS VALORES -- LEIA ANTES DE SOMAR QUALQUER COISA
-- ------------------------------------------------------
-- Em `financial_transactions` a despesa e gravada NEGATIVA, e o sinal carrega o
-- significado. Aqui e o OPOSTO: `quantity`, `unit_price` e `fees` sao sempre
-- POSITIVOS (ha CHECK para os tres), e quem carrega a direcao e a coluna `kind`.
-- Uma venda nao e "quantidade negativa": e `kind = 'sell'` com quantidade
-- positiva.
--
-- A escolha e deliberada. Preco medio e o numero central desta tela, e ele e uma
-- media PONDERADA de compras; misturar venda na ponderacao pelo sinal daria um
-- preco medio errado sem erro nenhum aparecer. Com `kind`, a compra pondera, a
-- venda abate quantidade e o provento nem entra no custo.
--
-- Consequencia pratica para quem escrever consulta nova: um `SUM(quantity)`
-- cru nesta tabela nao e a posicao do usuario -- ele soma compra, venda e
-- provento no mesmo balde. A posicao sai de lib/investments.ts, que e onde o
-- `kind` e lido, e tem suite propria no db-verify.
--
-- Idempotente: pode rodar duas vezes seguidas sem erro.
-- Cola como lote unico no SQL Editor (nenhum meta-comando de psql aqui).

BEGIN;

-- =====================================================
-- SECAO 1: investment_assets -- o ativo que o usuario acompanha
-- =====================================================
--
-- POR USUARIO, e nao catalogo global como `transaction_categories`.
--
-- Catalogo global exigiria manter a lista de tickers da B3 dentro do
-- repositorio e uma migration a cada IPO -- e a primeira acao que faltasse
-- deixaria o usuario sem poder lancar o que ele tem. O custo de ser por usuario
-- e a mesma PETR4 existir em N linhas; como ninguem cruza carteira de usuarios
-- diferentes neste app, esse custo nao compra nada de volta.

CREATE TABLE IF NOT EXISTS public.investment_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Guardado em MAIUSCULA, com o CHECK garantindo. Sem isso "petr4" e "PETR4"
  -- sao duas linhas para o UNIQUE abaixo, e a carteira mostra o mesmo ativo
  -- duas vezes com metade da posicao em cada.
  symbol text NOT NULL,
  name text NOT NULL,

  -- Os quatro tipos sao os que components/PortfolioTable.tsx sabe rotular e os
  -- que components/charts/AssetAllocationChart.tsx sabe colorir. Acrescentar um
  -- quinto valor aqui sem tocar nos dois componentes produz badge com o nome
  -- cru e fatia cinza no grafico -- sem erro.
  type text NOT NULL,
  currency text NOT NULL DEFAULT 'BRL',

  -- Preco informado pelo usuario. NULL = nunca informou, e isso NAO e zero:
  -- ver o cabecalho de lib/investments.ts para o que a tela faz nesse caso.
  current_price numeric(20,8),
  current_price_at timestamp with time zone,

  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT investment_assets_symbol_maiusculo
    CHECK (symbol = upper(symbol) AND btrim(symbol) = symbol AND length(symbol) BETWEEN 1 AND 16),
  CONSTRAINT investment_assets_name_nao_vazio
    CHECK (length(btrim(name)) > 0),
  CONSTRAINT investment_assets_type_check
    CHECK (type IN ('stock', 'fii', 'fixed_income', 'international')),
  CONSTRAINT investment_assets_currency_check
    CHECK (currency = upper(currency) AND length(currency) = 3),
  CONSTRAINT investment_assets_current_price_positivo
    CHECK (current_price IS NULL OR current_price > 0),

  -- Preco e data do preco andam juntos nas duas direcoes. Um preco sem data e
  -- um numero que o usuario nao sabe de quando e -- e ele vai tomar decisao
  -- olhando o "Valor Atual" que sai dai. Uma data sem preco nao significa nada.
  CONSTRAINT investment_assets_preco_par_check
    CHECK ((current_price IS NULL) = (current_price_at IS NULL))
);

-- UNIQUE CHEIO, nao parcial, e de proposito: e ele que serve de arbitro do
-- ON CONFLICT quando a rota faz upsert de ativo. Indice parcial nao serve --
-- o supabase-js nao manda o predicado e o upsert quebra em 100% das chamadas.
CREATE UNIQUE INDEX IF NOT EXISTS investment_assets_user_symbol_unico
  ON public.investment_assets (user_id, symbol);

-- Chave alternativa (id, user_id). Ela existe para a FK COMPOSTA da secao 2 --
-- ver la o buraco que ela fecha.
--
-- NAO da para usar o `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` que o resto
-- deste arquivo usa para ficar re-executavel: a FK da secao 2 DEPENDE do indice
-- desta constraint, e o DROP falha com "other objects depend on it" na segunda
-- passada. Um `DROP ... CASCADE` derrubaria a FK junto e a recriaria so por
-- sorte de ordem -- e uma migration que apaga a propria protecao no meio do
-- caminho e pior do que uma que nao e idempotente. Entao: cria se faltar.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.investment_assets'::regclass
       AND conname = 'investment_assets_id_user_unico'
  ) THEN
    ALTER TABLE public.investment_assets
      ADD CONSTRAINT investment_assets_id_user_unico UNIQUE (id, user_id);
  END IF;
END $$;

COMMENT ON TABLE public.investment_assets IS
  'Ativo que o usuario acompanha na carteira. Por usuario, nao catalogo global - HMO-169.';
COMMENT ON COLUMN public.investment_assets.current_price IS
  'Preco atual informado A MAO pelo usuario (nao ha fonte de cotacao contratada - HMO-141 item 2). NULL = sem preco: a tela mostra a posicao pelo custo e avisa, em vez de fingir lucro zero.';
COMMENT ON COLUMN public.investment_assets.current_price_at IS
  'Quando o preco foi informado. Anda em par com current_price (CHECK).';

-- =====================================================
-- SECAO 2: investment_transactions -- compra, venda e provento
-- =====================================================

CREATE TABLE IF NOT EXISTS public.investment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL,

  -- 'buy'      -- quantidade entra na posicao e pondera o preco medio
  -- 'sell'     -- quantidade sai da posicao; NAO mexe no preco medio (custo
  --               medio e o metodo usado no Brasil)
  -- 'dividend' -- nao mexe em quantidade nem em custo; soma em proventos.
  --               Para provento, `quantity` e a quantidade de cotas que
  --               receberam e `unit_price` e o valor POR COTA, entao o total
  --               continua sendo quantity * unit_price como nos outros dois.
  kind text NOT NULL,

  quantity numeric(20,8) NOT NULL,
  unit_price numeric(20,8) NOT NULL,

  -- Corretagem e emolumentos. Entram no custo na compra e saem do valor
  -- recebido na venda -- nunca somam na posicao.
  fees numeric(14,2) NOT NULL DEFAULT 0,

  trade_date date NOT NULL,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),

  -- Ver o cabecalho do arquivo: os tres sao POSITIVOS. O sinal nao carrega
  -- significado nesta tabela.
  CONSTRAINT investment_transactions_kind_check
    CHECK (kind IN ('buy', 'sell', 'dividend')),
  CONSTRAINT investment_transactions_quantity_positiva
    CHECK (quantity > 0),
  CONSTRAINT investment_transactions_unit_price_positivo
    CHECK (unit_price > 0),
  CONSTRAINT investment_transactions_fees_nao_negativa
    CHECK (fees >= 0),

  -- Lancamento no futuro e quase sempre erro de digitacao no ano, e ele
  -- contamina o grafico de evolucao com uma barra solitaria em 2035.
  CONSTRAINT investment_transactions_trade_date_nao_futura
    CHECK (trade_date <= (now() AT TIME ZONE 'UTC')::date + 1),

  -- FK COMPOSTA, e aqui esta a razao de existir o UNIQUE (id, user_id) acima.
  --
  -- Com uma FK simples para investment_assets(id), a politica de INSERT abaixo
  -- (user_id = auth.uid()) NAO impediria o usuario A de pendurar um lancamento
  -- no asset_id do usuario B: o WITH CHECK olha a coluna user_id da LINHA NOVA,
  -- que esta correta, e a FK so exige que o ativo exista. A RLS de SELECT
  -- esconde o ativo de B, mas esconder na leitura nao impede a escrita -- A
  -- gravaria linha de dentro da carteira de B, e a soma de proventos de B
  -- mudaria sem B fazer nada.
  --
  -- A FK composta resolve isso de forma declarativa: o par (asset_id, user_id)
  -- tem que existir junto na tabela de ativos. Trigger faria o mesmo, mas
  -- trigger sob RLS foi exatamente o que as migrations 003 e 004 existiram para
  -- consertar.
  CONSTRAINT investment_transactions_asset_do_mesmo_dono
    FOREIGN KEY (asset_id, user_id)
    REFERENCES public.investment_assets (id, user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_investment_transactions_user_asset_data
  ON public.investment_transactions (user_id, asset_id, trade_date);

-- O grafico de evolucao le a carteira inteira em ordem de data.
CREATE INDEX IF NOT EXISTS idx_investment_transactions_user_data
  ON public.investment_transactions (user_id, trade_date);

COMMENT ON TABLE public.investment_transactions IS
  'Compra, venda e provento de um ativo. Valores SEMPRE positivos: a direcao esta em kind, nao no sinal - HMO-169.';
COMMENT ON COLUMN public.investment_transactions.quantity IS
  'Sempre positiva. Em kind=dividend e a quantidade de cotas que recebeu o provento.';
COMMENT ON COLUMN public.investment_transactions.unit_price IS
  'Sempre positivo. Em kind=dividend e o valor POR COTA.';

-- =====================================================
-- SECAO 3: RLS
-- =====================================================

ALTER TABLE public.investment_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investment_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS investment_assets_select ON public.investment_assets;
CREATE POLICY investment_assets_select ON public.investment_assets
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS investment_assets_insert ON public.investment_assets;
CREATE POLICY investment_assets_insert ON public.investment_assets
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Sem troca de dono na atualizacao: o USING olha a linha velha e o WITH CHECK a
-- nova, e exigir auth.uid() nos dois e o que impede mover o ativo (com todo o
-- historico pendurado nele pela FK composta) para outra conta.
DROP POLICY IF EXISTS investment_assets_update ON public.investment_assets;
CREATE POLICY investment_assets_update ON public.investment_assets
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS investment_assets_delete ON public.investment_assets;
CREATE POLICY investment_assets_delete ON public.investment_assets
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS investment_transactions_select ON public.investment_transactions;
CREATE POLICY investment_transactions_select ON public.investment_transactions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS investment_transactions_insert ON public.investment_transactions;
CREATE POLICY investment_transactions_insert ON public.investment_transactions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS investment_transactions_update ON public.investment_transactions;
CREATE POLICY investment_transactions_update ON public.investment_transactions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS investment_transactions_delete ON public.investment_transactions;
CREATE POLICY investment_transactions_delete ON public.investment_transactions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- =====================================================
-- SECAO 4: carimbo do updated_at
-- =====================================================
-- SECURITY INVOKER e search_path fixo, no padrao da 011 -- e nao a
-- `update_updated_at_column()` legada do 001, que foi a familia de trigger que
-- as migrations 003 e 004 consertaram.

CREATE OR REPLACE FUNCTION public.investment_assets_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_investment_assets_touch ON public.investment_assets;
CREATE TRIGGER trg_investment_assets_touch
  BEFORE UPDATE ON public.investment_assets
  FOR EACH ROW EXECUTE FUNCTION public.investment_assets_touch_updated_at();

-- =====================================================
-- SECAO 5: GRANTS
-- =====================================================
-- O 002 rodou GRANT ... ON ALL TABLES antes destas tabelas existirem, e
-- ALL TABLES e uma fotografia do momento -- nao alcanca objeto criado depois.
REVOKE ALL ON public.investment_assets FROM anon;
REVOKE ALL ON public.investment_transactions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.investment_assets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.investment_transactions TO authenticated;

-- =====================================================
-- SECAO 6: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('021', '021_investments',
        'Carteira de investimentos manual: investment_assets + investment_transactions - HMO-169', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
