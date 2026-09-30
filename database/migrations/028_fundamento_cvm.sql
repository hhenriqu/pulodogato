-- 028_fundamento_cvm.sql
--
-- HMO-194 (entrega 4 da HMO-141): onde mora o fundamento de acao brasileira que
-- vem da DFP anual da CVM, para os crivos da entrega 5 terem de onde ler.
--
-- Esta migration nao tem tela. Ela cria tres tabelas e uma view.
--
-- ===========================================================================
-- POR QUE ISTO NAO E "user data", E O QUE ISSO MUDA NA RLS
-- ===========================================================================
-- O balanco da Petrobras nao pertence a ninguem: e o mesmo numero para todo
-- usuario do PuloDoGato, publicado pelo regulador. Entao estas tabelas seguem o
-- desenho de `transaction_categories` e `financial_services` (002_rls_lockdown),
-- nao o de `financial_transactions`:
--
--   - sem `user_id`, sem coluna de dono;
--   - RLS LIGADA com policy de SELECT para `authenticated`;
--   - GRANT de SELECT e nada mais. Nao ha policy de INSERT/UPDATE/DELETE para
--     papel de aplicacao NENHUM, porque quem escreve aqui e o ingestor, com a
--     service role, que passa por cima da RLS.
--
-- A consequencia esta documentada e vale de aviso para a entrega 5: uma rota que
-- tentar gravar aqui com o cliente normal do Supabase leva 42501 e o erro chega
-- como 500 dentro de um catch. Nao e bug da policy -- e o desenho.
--
-- ===========================================================================
-- A PONTE ticker -> CNPJ E UMA TABELA, NAO UMA FUNCAO
-- ===========================================================================
-- A CVM indexa por CNPJ e codigo CVM e nao sabe o que e um ticker. A ponte vem
-- da consulta aberta da B3, que busca SUBSTRING NO NOME da empresa, ordenada por
-- nome -- e por isso o primeiro resultado de `PETR4` e ACU PETROLEO S.A., o de
-- `VALE3` e ADECOAGRO VALE DO EVINHEMA e o de `RANI3` e GLOBAL X URANIUM ETF
-- (medido em 2026-09-30, 3 erros em 15 tickers).
--
-- O que torna isso perigoso: a empresa errada EXISTE, tem CNPJ valido e tem
-- balanco na CVM. Gravar o par errado nao produz erro nem linha vazia -- produz
-- o ROE de outra empresa. Por isso a ponte e material, auditavel e unica por
-- ticker (`cvm_ponte_ticker`), com a regra de casamento gravada na linha
-- (`criterio`): da para olhar depois e saber COMO cada par foi decidido.
--
-- E o ticker que nao casa por igualdade exata nao entra na ponte: vai para
-- `cvm_tickers_sem_fundamento`, que e o "para e registra" da issue. Espaco em
-- branco honesto na tela, em vez do numero da empresa parecida.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. A ponte ticker -> empresa da CVM
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cvm_ponte_ticker (
  ticker            text PRIMARY KEY,
  -- O radical de 4 letras que a B3 devolve em `issuingCompany` (`PETR4` -> `PETR`).
  radical           text        NOT NULL,
  codigo_cvm        text        NOT NULL,
  -- So digitos, como a B3 devolve. Os CSVs da CVM usam a mascara; o ingestor formata.
  cnpj              text        NOT NULL,
  denominacao       text        NOT NULL,
  -- COMO este par foi decidido. Hoje sempre 'issuing_company_exato'; existe para
  -- que afrouxar a regra no futuro seja visivel linha por linha, em vez de virar
  -- uma mudanca de codigo que nao deixa rastro no dado que ela contaminou.
  criterio          text        NOT NULL DEFAULT 'issuing_company_exato',
  resolvido_em      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cvm_ponte_ticker_ticker_formato CHECK (ticker ~ '^[A-Z]{4}[0-9]{1,2}F?$'),
  CONSTRAINT cvm_ponte_ticker_radical_formato CHECK (radical ~ '^[A-Z]{4}$'),
  -- O radical TEM que ser o prefixo do ticker. Esta e a regra da issue escrita
  -- como constraint: sem ela, um ingestor com bug poderia pendurar o codigo CVM
  -- da Acu Petroleo no ticker PETR4 e o banco aceitaria calado.
  CONSTRAINT cvm_ponte_ticker_radical_do_ticker CHECK (left(ticker, 4) = radical),
  CONSTRAINT cvm_ponte_ticker_cnpj_formato CHECK (cnpj ~ '^[0-9]{14}$'),
  CONSTRAINT cvm_ponte_ticker_codigo_cvm_formato CHECK (codigo_cvm ~ '^[0-9]{1,8}$')
);

-- Dois tickers da MESMA empresa e normal e esperado (PETR3/PETR4, ITUB3/ITUB4),
-- entao `codigo_cvm` nao e unico. O que precisa ser rapido e o caminho inverso:
-- dado o codigo CVM, quais tickers dependem dele.
CREATE INDEX IF NOT EXISTS cvm_ponte_ticker_codigo_cvm_idx
  ON public.cvm_ponte_ticker (codigo_cvm);

-- ---------------------------------------------------------------------------
-- 2. O ticker que a ponte RECUSOU
-- ---------------------------------------------------------------------------
-- Sem esta tabela, "a PETR4 nao tem fundamento" e indistinguivel de "ninguem
-- tentou importar a PETR4" -- e as duas situacoes pedem acoes opostas.
CREATE TABLE IF NOT EXISTS public.cvm_tickers_sem_fundamento (
  ticker        text PRIMARY KEY,
  motivo        text        NOT NULL,
  -- Quantos resultados a B3 devolveu. `0` = nao existe nesse registro (o caso do
  -- FII: HGLG11, MXRF11 e KNRI11 voltam zero, porque fundo imobiliario nao e
  -- companhia listada e nao entrega DFP). `>0` = existe gente com o radical no
  -- nome, mas nenhuma casou por igualdade -- o caso perigoso.
  candidatos    integer     NOT NULL DEFAULT 0,
  tentado_em    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cvm_tickers_sem_fundamento_motivo CHECK (
    motivo IN ('ticker_fora_do_padrao', 'sem_casamento_exato', 'casamento_ambiguo',
               'sem_codigo_cvm', 'sem_dfp_no_pacote', 'dado_inconsistente')
  ),
  CONSTRAINT cvm_tickers_sem_fundamento_candidatos CHECK (candidatos >= 0)
);

-- ---------------------------------------------------------------------------
-- 3. As contas, por empresa e por exercicio
-- ---------------------------------------------------------------------------
-- So as poucas contas que os crivos usam -- nao o arquivo inteiro. Tudo em
-- REAIS: o ingestor ja aplicou `ESCALA_MOEDA` (MIL ou UNIDADE, as duas ocorrem
-- no mesmo pacote), porque guardar o numero cru deixaria a escala como um campo
-- que alguem precisa lembrar de multiplicar.
--
-- Valor NULO significa "a empresa nao publicou esta conta", que e diferente de
-- zero. Banco nao tem `3.02 Custo dos Bens Vendidos`; gravar 0 ali faria a
-- margem bruta de um banco valer 100%.
CREATE TABLE IF NOT EXISTS public.cvm_fundamentos (
  codigo_cvm        text    NOT NULL,
  ano_exercicio     integer NOT NULL,
  cnpj              text    NOT NULL,
  -- `DT_FIM_EXERC` do balanco de onde as contas sairam. E a data-base que a tela
  -- da entrega 5 mostra: sem ela, dois indicadores de datas diferentes ficam
  -- lado a lado parecendo do mesmo dia.
  data_base         date    NOT NULL,

  receita_liquida         numeric(20, 2),
  custo                   numeric(20, 2),
  lucro_liquido           numeric(20, 2),
  patrimonio_liquido      numeric(20, 2),
  divida_curto_prazo      numeric(20, 2),
  divida_longo_prazo      numeric(20, 2),
  caixa                   numeric(20, 2),
  aplicacoes_financeiras  numeric(20, 2),
  -- Dividendo + JCP, positivo, da coluna 'Patrimonio Liquido Consolidado' da
  -- DMPL. A coluna importa: a DMPL tem uma linha por componente do patrimonio, e
  -- somar todas conta o mesmo dividendo junto com os totais que ja o contem --
  -- medido na PETR4/2025, R$ 127,2 bi contra R$ 42,4 bi de verdade (3,00x).
  dividendos_distribuidos numeric(20, 2),

  -- Publicada como o arquivo publica, e sem escala declarada: `composicao_capital`
  -- NAO tem coluna de escala e as empresas divergem -- em 2025 a PETR4 declara
  -- 12.888.732.761 (unidades) e a VALE3 declara 4.539.007 (milhares). Guardamos
  -- para nao perder o dado, mas NENHUM indicador "por acao" sai daqui. Ver o
  -- comentario da view.
  quantidade_acoes        numeric(20, 0),

  importado_em      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (codigo_cvm, ano_exercicio),

  CONSTRAINT cvm_fundamentos_cnpj_formato CHECK (cnpj ~ '^[0-9]{14}$'),
  CONSTRAINT cvm_fundamentos_codigo_cvm_formato CHECK (codigo_cvm ~ '^[0-9]{1,8}$'),
  -- 2010 e o primeiro ano do portal de dados abertos da CVM.
  CONSTRAINT cvm_fundamentos_ano_plausivel CHECK (ano_exercicio BETWEEN 2010 AND 2100),
  -- A data-base tem que ser DO exercicio. Balanco de 2024 gravado na linha de
  -- 2025 e o erro que produz "lucro de 2025" com numero de 2024 -- e foi
  -- exatamente o erro que a referencia da issue trazia (o dividendo de R$ 101,2
  -- bi citado como 2025 e o de 2024; o de 2025 e R$ 42,4 bi).
  CONSTRAINT cvm_fundamentos_data_base_do_exercicio
    CHECK (extract(year FROM data_base) = ano_exercicio),
  -- Distribuicao negativa nao existe: o ingestor ja inverteu o sinal da DMPL.
  -- Se isto disparar, a conta 5.04.06 veio positiva e a empresa merece
  -- inspecao, nao um yield negativo na tela.
  CONSTRAINT cvm_fundamentos_dividendos_nao_negativos
    CHECK (dividendos_distribuidos IS NULL OR dividendos_distribuidos >= 0),
  CONSTRAINT cvm_fundamentos_acoes_positivas
    CHECK (quantidade_acoes IS NULL OR quantidade_acoes > 0),
  -- Uma linha em que TODA conta e nula nao e fundamento -- e uma linha que a
  -- view transformaria em card vazio com data-base, parecendo dado importado.
  -- Mesma razao do CHECK sobre `amount` que faltou nas views do 008.
  CONSTRAINT cvm_fundamentos_tem_alguma_conta CHECK (
    receita_liquida IS NOT NULL OR lucro_liquido IS NOT NULL
      OR patrimonio_liquido IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS cvm_fundamentos_ano_idx
  ON public.cvm_fundamentos (ano_exercicio DESC);

-- ---------------------------------------------------------------------------
-- 4. A view que o app le: ticker -> indicador
-- ---------------------------------------------------------------------------
-- O app pensa em ticker; o banco guarda por codigo CVM. A view faz a juncao e
-- deriva os indicadores, cada um por UMA fonte declarada.
--
-- Por que a derivacao esta aqui e nao no TypeScript: a regra "uma fonte por
-- indicador" so vale se houver UM lugar que a implemente. Duas implementacoes
-- (uma na view, uma no cliente) e como os tres P/L da PETR4 nascem -- a mesma
-- PETR4 tinha 4,79, 5,77 e 6,00 no mesmo dia, todos defensaveis, e um crivo
-- "P/L abaixo de 6" aprova ou reprova conforme quem calculou.
--
-- O que esta view NAO tem, de proposito: P/L, dividend yield e lucro por acao.
-- Os tres precisam de preco ou valor de mercado, que nao e CVM (vem da brapi, na
-- entrega 5), e os dois ultimos precisariam dividir por `quantidade_acoes`, cuja
-- escala o arquivo nao declara. Os indicadores daqui sao todos RAZAO entre dois
-- valores monetarios da mesma empresa no mesmo arquivo, e por isso imunes a
-- escala: o fator 1000 cancela em cima e embaixo.
DROP VIEW IF EXISTS public.cvm_indicadores;

CREATE VIEW public.cvm_indicadores AS
SELECT
  p.ticker,
  p.denominacao,
  f.codigo_cvm,
  f.cnpj,
  f.ano_exercicio,
  f.data_base,

  f.lucro_liquido,
  f.receita_liquida,
  f.patrimonio_liquido,

  -- ROE = lucro liquido (DRE con 3.11) / patrimonio liquido (BPP con 2.03).
  --
  -- O patrimonio tem que ser POSITIVO, nao apenas diferente de zero. Empresa com
  -- passivo a descoberto tem patrimonio negativo, e -50 de prejuizo sobre -100
  -- de patrimonio daria "ROE de 50%" -- que um crivo de rentabilidade aprovaria
  -- como se fosse a empresa mais lucrativa da lista. Quando o denominador troca
  -- de sinal a razao troca de significado, e nao existe leitura correta de
  -- "retorno sobre patrimonio" onde nao ha patrimonio.
  CASE WHEN f.patrimonio_liquido > 0
       THEN f.lucro_liquido / f.patrimonio_liquido END AS roe,

  CASE WHEN f.receita_liquida <> 0
       THEN f.lucro_liquido / f.receita_liquida END AS margem_liquida,

  -- `custo` vem NEGATIVO da DRE (3.02), entao soma-se para achar o lucro bruto.
  CASE WHEN f.receita_liquida <> 0 AND f.custo IS NOT NULL
       THEN (f.receita_liquida + f.custo) / f.receita_liquida END AS margem_bruta,

  -- Divida liquida = (curto + longo) - caixa - aplicacoes. `coalesce` nos quatro
  -- termos, mas so depois de exigir que exista ALGUMA das duas pernas de divida:
  -- sem isso, empresa que nao publicou divida nenhuma apareceria com divida
  -- liquida negativa igual ao caixa, parecendo caixa liquido de quem so nao
  -- reportou.
  CASE WHEN f.divida_curto_prazo IS NOT NULL OR f.divida_longo_prazo IS NOT NULL
       THEN coalesce(f.divida_curto_prazo, 0) + coalesce(f.divida_longo_prazo, 0)
            - coalesce(f.caixa, 0) - coalesce(f.aplicacoes_financeiras, 0)
       END AS divida_liquida,

  CASE WHEN f.patrimonio_liquido > 0
         AND (f.divida_curto_prazo IS NOT NULL OR f.divida_longo_prazo IS NOT NULL)
       THEN (coalesce(f.divida_curto_prazo, 0) + coalesce(f.divida_longo_prazo, 0)
             - coalesce(f.caixa, 0) - coalesce(f.aplicacoes_financeiras, 0))
            / f.patrimonio_liquido
       END AS divida_liquida_sobre_patrimonio,

  f.dividendos_distribuidos,
  f.quantidade_acoes,
  f.importado_em
FROM public.cvm_fundamentos f
JOIN public.cvm_ponte_ticker p ON p.codigo_cvm = f.codigo_cvm;

-- Sem `security_invoker` a view roda com o privilegio de quem a CRIOU (o dono do
-- schema), e nao de quem consulta -- furando a RLS das tabelas de baixo. Aqui as
-- duas tabelas sao publicas para `authenticated`, entao o efeito pratico seria
-- pequeno; a regra vale de qualquer forma, porque quem herdar esta view nao vai
-- reauditar as tabelas antes de acrescentar uma que tenha dono.
ALTER VIEW public.cvm_indicadores SET (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 5. RLS e privilegio
-- ---------------------------------------------------------------------------
ALTER TABLE public.cvm_ponte_ticker            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cvm_tickers_sem_fundamento  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cvm_fundamentos             ENABLE ROW LEVEL SECURITY;

-- Leitura para quem esta logado. `anon` fica de fora: fundamento e conteudo de
-- produto, nao de pagina publica, e `transaction_categories` so abriu para
-- `anon` porque o formulario de cadastro precisa da lista antes do login.
DROP POLICY IF EXISTS cvm_ponte_ticker_read ON public.cvm_ponte_ticker;
CREATE POLICY cvm_ponte_ticker_read ON public.cvm_ponte_ticker
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS cvm_fundamentos_read ON public.cvm_fundamentos;
CREATE POLICY cvm_fundamentos_read ON public.cvm_fundamentos
  FOR SELECT TO authenticated USING (TRUE);

-- `cvm_tickers_sem_fundamento` e diagnostico de ingestao, nao conteudo: a tela
-- mostra espaco em branco, nao o motivo. Fica sem policy nenhuma -- RLS ligada
-- e nenhuma policy nega tudo para papel de aplicacao, e a service role do
-- ingestor passa por cima. Ligar a RLS sem policy e proposital, nao esquecimento.

REVOKE ALL ON public.cvm_ponte_ticker           FROM anon, authenticated;
REVOKE ALL ON public.cvm_tickers_sem_fundamento FROM anon, authenticated;
REVOKE ALL ON public.cvm_fundamentos            FROM anon, authenticated;
REVOKE ALL ON public.cvm_indicadores            FROM anon, authenticated;

GRANT SELECT ON public.cvm_ponte_ticker TO authenticated;
GRANT SELECT ON public.cvm_fundamentos  TO authenticated;
GRANT SELECT ON public.cvm_indicadores  TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. O que NAO entra aqui, e por que
-- ---------------------------------------------------------------------------
-- ITR (trimestral) nao entra. A DFP e anual; o numero entre dois balancos vem de
-- outro pacote, no mesmo portal e no mesmo formato, e precisaria de outra chave
-- (ano + trimestre) nesta tabela. Fazer a chave "quase certa" agora obrigaria
-- uma migration de PRIMARY KEY depois, com dado dentro.
--
-- FII nao entra, e nao e limitacao de codigo: HGLG11, MXRF11 e KNRI11 voltam
-- ZERO resultados na B3 porque fundo imobiliario nao e companhia listada e nao
-- entrega DFP. ROE, margem e divida nao existem para FII por esta via -- o
-- informe mensal e outro regime e outro formato. Os tres caem em
-- `cvm_tickers_sem_fundamento` com `candidatos = 0`, que e a resposta honesta.
-- A decisao de o que mostrar para FII esta pendente com o Helio (HMO-141).
--
-- Valor de mercado, preco e P/L nao entram. Nao sao CVM. A mistura de fonte por
-- indicador e o defeito que a entrega 5 tem que evitar, e ela fica mais facil de
-- evitar se esta tabela simplesmente nao tiver onde guardar preco.

INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('028', '028_fundamento_cvm',
        'Fundamento anual da CVM (DFP): ponte ticker->CNPJ por igualdade exata, contas que os crivos usam e view de indicadores com fonte unica por indicador - HMO-194', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
