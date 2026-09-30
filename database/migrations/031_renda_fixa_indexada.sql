-- 031_renda_fixa_indexada.sql
--
-- HMO-192 (entrega 2 da HMO-141): onde mora "110% do CDI".
--
-- O tipo `fixed_income` existe no CHECK de `investment_assets` desde a 021, mas
-- a unica coisa que a 021 sabe guardar de um ativo e `current_price` -- o preco
-- que o USUARIO digita. Para acao isso e uma limitacao aceitavel (ele abre o
-- home broker e le o numero). Para um CDB de 110% do CDI e diferente: nao existe
-- "cotacao" para ele consultar em lugar nenhum. O valor de hoje e uma CONTA --
-- principal, indexador, percentual, dias corridos desde a aplicacao -- e o app
-- tem todos os ingredientes menos os quatro que esta migration acrescenta.
--
-- Sem isto, renda fixa no PuloDoGato so funciona se a pessoa reabrir a tela todo
-- mes e reescrever o valor na mao. Que e exatamente o trabalho que ela esperava
-- nao ter mais ao cadastrar o ativo.
--
-- ===========================================================================
-- POR QUE SAO DUAS COLUNAS DE TAXA, E NAO UMA
-- ===========================================================================
-- `index_percentage` e `spread_annual` parecem redundantes e nao sao. Renda fixa
-- brasileira remunera de tres formas que NAO cabem no mesmo numero:
--
--   CDB 110% do CDI       -> percentual DO INDICE   (index_percentage = 110)
--   Tesouro IPCA+ 6%      -> indice MAIS um spread  (spread_annual     = 6)
--   CDB prefixado 13% a.a -> taxa absoluta, sem indice (spread_annual  = 13)
--
-- Uma coluna `rate` unica guardaria 110 e 13 lado a lado com significados
-- diferentes. O erro que isso produz nao e um erro: e um CDB prefixado rendendo
-- 110% de um indice que ele nao acompanha -- 13 vezes o rendimento real, sem
-- nenhuma linha vermelha em lugar nenhum. Duas colunas com CHECK cruzado tornam
-- a combinacao sem sentido impossivel de gravar.
--
-- ===========================================================================
-- POR QUE `applied_date` NAO E SO DECORACAO
-- ===========================================================================
-- E ela que decide a ALIQUOTA DE IR. A tabela do IR de renda fixa e regressiva e
-- contada em dias CORRIDOS desde a aplicacao:
--
--   ate 180 dias   22,5%
--   181 a 360      20,0%
--   361 a 720      17,5%
--   acima de 720   15,0%
--
-- Sem a data de aplicacao gravada, o liquido estimado da tela seria um chute com
-- cara de numero. Com ela, e uma conta. E quando ela for NULA (ativo cadastrado
-- antes desta migration), a tela mostra o BRUTO e diz que nao sabe o liquido --
-- ver lib/renda-fixa.ts. Nao inventa 22,5%.
--
-- ===========================================================================
-- `fixed_income_product`: O CAMPO QUE EVITA COBRAR IR DE QUEM E ISENTO
-- ===========================================================================
-- A issue pede quatro campos (indexador, percentual, aplicacao, vencimento) e
-- esta migration acrescenta um quinto, de proposito: o PRODUTO.
--
-- LCI, LCA, CRI, CRA, debenture incentivada e poupanca sao ISENTAS de IR para
-- pessoa fisica. Nelas o liquido e IGUAL ao bruto, e descontar 22,5% mostraria
-- a pessoa um rendimento menor do que ela vai receber de verdade -- errando
-- contra ela, no unico numero que ela abriu a tela para ver.
--
-- E a isencao NAO da para derivar do indexador: uma LCI de 95% do CDI e um CDB
-- de 95% do CDI tem o mesmo indexador, o mesmo percentual, o mesmo prazo, e
-- aliquotas diferentes. Sem esta coluna, o requisito "LCI e LCA sao isentas" da
-- propria issue seria impossivel de cumprir com o dado que existe no banco.
--
-- `outro` existe para nao travar quem tem um papel que nao esta na lista. O
-- codigo trata `outro` e NULO como TRIBUTADOS -- e o lado seguro do erro:
-- subestima o liquido de um isento (e a pessoa recebe mais do que a tela
-- prometeu) em vez de prometer um liquido que o Leao vai cortar.
--
-- ===========================================================================
-- O QUE ESTA MIGRATION NAO FAZ
-- ===========================================================================
-- Nao cria tabela de historico do CDI. A serie 12 do Banco Central e publica,
-- de graca e sem cadastro (ver lib/cdi.ts); cachear em tabela propria seria uma
-- segunda fonte de verdade para manter sincronizada em troca de milissegundos.
--
-- Nao torna nenhum campo OBRIGATORIO para `fixed_income`. Ha linhas de renda
-- fixa cadastradas em producao desde a 021, todas sem estes campos, e um NOT
-- NULL aqui quebraria a tela delas na hora em que este arquivo fosse colado no
-- SQL Editor. O preenchimento e progressivo: quem editar o ativo ganha o
-- rendimento automatico, quem nao editar continua com o preco na mao.
--
-- Idempotente: pode rodar duas vezes seguidas sem erro.
-- Cola como lote unico no SQL Editor (nenhum meta-comando de psql aqui).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. As colunas
-- ---------------------------------------------------------------------------
-- Todas NULAVEIS, e o ADD COLUMN vem antes de qualquer CHECK -- a ordem importa
-- para a re-execucao: um CHECK que cite coluna que ainda nao existe aborta o
-- lote inteiro, e no SQL Editor "lote inteiro" e o arquivo.

ALTER TABLE public.investment_assets
  ADD COLUMN IF NOT EXISTS fixed_income_product text,
  ADD COLUMN IF NOT EXISTS index_kind           text,
  ADD COLUMN IF NOT EXISTS index_percentage     numeric(8,4),
  ADD COLUMN IF NOT EXISTS spread_annual        numeric(8,4),
  ADD COLUMN IF NOT EXISTS applied_date         date,
  ADD COLUMN IF NOT EXISTS maturity_date        date;

-- ---------------------------------------------------------------------------
-- 2. As constraints
-- ---------------------------------------------------------------------------
-- Todas tem nome fixo, entao o par `DROP CONSTRAINT IF EXISTS` + `ADD
-- CONSTRAINT` e o que torna o arquivo re-executavel. (A 021 documenta o caso em
-- que esse par NAO serve: quando um indice de constraint tem dependente, o DROP
-- falha com "other objects depend on it". Nenhuma destas tem dependente.)

-- Os indexadores que lib/renda-fixa.ts sabe projetar. Acrescentar valor aqui sem
-- tocar naquele arquivo produz um ativo que a tela mostra sem rendimento e sem
-- explicar por que -- o CHECK e o que mantem os dois lados juntos.
ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_index_kind_check;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_index_kind_check
  CHECK (index_kind IS NULL OR index_kind IN ('cdi', 'selic', 'ipca', 'igpm', 'prefixado', 'poupanca'));

ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_fixed_income_product_check;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_fixed_income_product_check
  CHECK (fixed_income_product IS NULL OR fixed_income_product IN (
    -- Tributados pela tabela regressiva.
    'cdb', 'rdb', 'lc', 'debenture',
    -- Isentos de IR para pessoa fisica.
    'lci', 'lca', 'cri', 'cra', 'debenture_incentivada', 'poupanca',
    -- Escape: tratado como TRIBUTADO pelo codigo.
    'outro'
  ));

-- 110% do CDI e 110; 0% nao e investimento e negativo nao existe. O teto de
-- 1000% nao pretende ser uma regra de mercado -- e um limite de digitacao: sem
-- ele, "11000" no lugar de "110" projeta um rendimento cem vezes maior e a tela
-- mostra isso com toda a confianca.
ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_index_percentage_check;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_index_percentage_check
  CHECK (index_percentage IS NULL OR (index_percentage > 0 AND index_percentage <= 1000));

-- Spread em pontos percentuais ao ano. Zero e valido (IPCA puro, sem juro real);
-- negativo, nao -- papel que rende menos que a inflacao nao e vendido assim, e
-- um sinal invertido aqui viraria rendimento negativo silencioso.
ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_spread_annual_check;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_spread_annual_check
  CHECK (spread_annual IS NULL OR (spread_annual >= 0 AND spread_annual <= 100));

-- "110% de que?" -- percentual sem indexador nao tem significado nenhum.
ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_percentual_exige_indexador;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_percentual_exige_indexador
  CHECK (index_percentage IS NULL OR index_kind IS NOT NULL);

-- Prefixado NAO acompanha indice: os 13% dele sao a taxa inteira, e moram em
-- `spread_annual`. Um `index_percentage` preenchido aqui seria percentual de um
-- indice que nao existe na linha -- exatamente o erro que as duas colunas
-- existem para impedir.
ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_prefixado_sem_percentual;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_prefixado_sem_percentual
  CHECK (index_kind IS DISTINCT FROM 'prefixado' OR index_percentage IS NULL);

-- Vencimento depois da aplicacao. Igual tambem nao serve: prazo zero divide por
-- zero em qualquer projecao de rendimento.
ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_vencimento_depois_da_aplicacao;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_vencimento_depois_da_aplicacao
  CHECK (applied_date IS NULL OR maturity_date IS NULL OR maturity_date > applied_date);

-- Aplicacao no futuro e erro de digitacao no ano, e ela nao e um campo qualquer:
-- e o inicio da contagem do IR. Uma data em 2027 devolve prazo negativo e, com
-- ele, aliquota de 22,5% sobre um rendimento que a conta nem deveria ter
-- produzido. O `+ 1` acompanha o CHECK de `trade_date` da 021 -- fuso do cliente
-- adiantado em relacao ao UTC do servidor.
ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_applied_date_nao_futura;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_applied_date_nao_futura
  CHECK (applied_date IS NULL OR applied_date <= (now() AT TIME ZONE 'UTC')::date + 1);

-- Os seis campos so fazem sentido em `fixed_income`. Uma PETR4 com indexador nao
-- e recusada por nenhum CHECK acima e apareceria na tela como acao rendendo CDI
-- todo dia, por cima da variacao de preco: o rendimento apareceria DUAS vezes.
--
-- Este CHECK nao pode reprovar nenhuma linha existente no momento em que este
-- arquivo e colado: as seis colunas nasceram nulas duas secoes acima, e o
-- ALTER TABLE valida a tabela inteira -- se houvesse UMA linha violando, o lote
-- abortaria e nada seria aplicado. Ele so barra escrita NOVA, que e o que se
-- quer barrar.
ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_renda_fixa_so_em_fixed_income;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_renda_fixa_so_em_fixed_income
  CHECK (
    type = 'fixed_income'
    OR (
      fixed_income_product IS NULL
      AND index_kind        IS NULL
      AND index_percentage  IS NULL
      AND spread_annual     IS NULL
      AND applied_date      IS NULL
      AND maturity_date     IS NULL
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Documentacao no catalogo
-- ---------------------------------------------------------------------------
-- Quem abrir a tabela no Supabase Studio ve seis colunas novas sem tela. Estes
-- comentarios sao o que impede a proxima pessoa de inferir o significado errado
-- de `index_percentage` (que e a armadilha inteira desta migration).

COMMENT ON COLUMN public.investment_assets.fixed_income_product IS
  'Produto de renda fixa (cdb, lci, lca, ...). Decide a ISENCAO de IR, que nao da para derivar do indexador: LCI e CDB de 95% do CDI so diferem aqui. NULO e "outro" contam como tributados - HMO-192.';
COMMENT ON COLUMN public.investment_assets.index_kind IS
  'Indexador: cdi, selic, ipca, igpm, prefixado, poupanca. Os valores que lib/renda-fixa.ts sabe projetar - HMO-192.';
COMMENT ON COLUMN public.investment_assets.index_percentage IS
  'Percentual DO INDICE, nao taxa: 110 = "110% do CDI". Para taxa absoluta ou spread use spread_annual. Proibido com index_kind = prefixado (CHECK) - HMO-192.';
COMMENT ON COLUMN public.investment_assets.spread_annual IS
  'Pontos percentuais ao ano SOMADOS ao indice (IPCA + 6 -> 6), ou a taxa inteira quando prefixado (13% a.a. -> 13) - HMO-192.';
COMMENT ON COLUMN public.investment_assets.applied_date IS
  'Data da aplicacao. E dela que sai a ALIQUOTA de IR (tabela regressiva 22,5% -> 15% por dias corridos), por isso e guardada e nao inferida. NULA = a tela mostra o bruto e nao estima o liquido - HMO-192.';
COMMENT ON COLUMN public.investment_assets.maturity_date IS
  'Vencimento do papel. NULA para liquidez diaria (poupanca, CDB com liquidez) - HMO-192.';

COMMIT;
