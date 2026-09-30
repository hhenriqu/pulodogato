-- =====================================================
-- Teste: fundamento da CVM (028) -- HMO-194
-- =====================================================
-- Prova, sobre o banco reconstruido do zero, as tres coisas que a 028 afirma e
-- que nenhum teste de TypeScript alcanca:
--
--   1. as tabelas sao de REFERENCIA: quem esta logado le e nao escreve, e `anon`
--      nao chega nem a ler;
--   2. as constraints recusam o par ticker/empresa incoerente -- a regra da ponte
--      escrita no banco, nao so no ingestor;
--   3. a view `cvm_indicadores` deriva cada indicador de UMA fonte e devolve NULO
--      onde a conta nao existe, em vez de um numero plausivel.
--
-- Rodar num banco limpo, depois da cadeia 001 -> 028:
--   psql "$DB_URL" -f database/tests/hmo194_fundamento_cvm_test.sql
--
-- Qualquer FALHA lanca excecao e aborta.
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

-- =====================================================
-- PARTE 1: tabela de referencia -- le, nao escreve
-- =====================================================
-- O desenho copia `transaction_categories` (002): RLS ligada, policy de SELECT,
-- e NENHUMA policy de escrita para papel de aplicacao. Quem grava e o ingestor,
-- com a service role, que passa por cima da RLS.
--
-- Isto e conferido pelo CATALOGO e por COMPORTAMENTO. So pelo catalogo nao
-- bastaria: um GRANT sobrando de outra migration nao apareceria na lista de
-- policies. So por comportamento tambem nao: o `postgres` tem `rolbypassrls`, e
-- um INSERT que funciona como `postgres` nao diz nada sobre `authenticated`.

DO $$
DECLARE
  faltando text;
BEGIN
  -- As tres tabelas tem que estar com RLS LIGADA.
  SELECT string_agg(t, ', ') INTO faltando
    FROM unnest(ARRAY['cvm_ponte_ticker', 'cvm_tickers_sem_fundamento', 'cvm_fundamentos']) AS t
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity
   );
  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION 'Tabela de fundamento sem RLS: %', faltando;
  END IF;

  -- E nenhuma delas pode ter policy de escrita.
  SELECT string_agg(tablename || '.' || policyname || ' (' || cmd || ')', ', ') INTO faltando
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('cvm_ponte_ticker', 'cvm_tickers_sem_fundamento', 'cvm_fundamentos')
     AND cmd <> 'SELECT';
  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION
      'Policy de escrita em tabela de fundamento: %. Quem grava e o ingestor com service role; abrir escrita para authenticated deixaria o usuario editar o balanco da Petrobras.',
      faltando;
  END IF;

  -- `anon` nao pode ter privilegio nenhum: a chave anon vai embutida no bundle
  -- JS publico. Fundamento e conteudo de produto, nao de pagina publica.
  SELECT string_agg(table_name || ':' || privilege_type, ', ') INTO faltando
    FROM information_schema.role_table_grants
   WHERE grantee = 'anon' AND table_schema = 'public'
     AND table_name IN ('cvm_ponte_ticker', 'cvm_tickers_sem_fundamento',
                        'cvm_fundamentos', 'cvm_indicadores');
  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION 'anon tem privilegio em tabela de fundamento: %', faltando;
  END IF;
END $$;

-- Semente, gravada como dono (o ingestor usa service role).
INSERT INTO public.cvm_ponte_ticker (ticker, radical, codigo_cvm, cnpj, denominacao)
VALUES ('PETR4', 'PETR', '9512', '33000167000101', 'PETROLEO BRASILEIRO S.A. PETROBRAS'),
       ('PETR3', 'PETR', '9512', '33000167000101', 'PETROLEO BRASILEIRO S.A. PETROBRAS');

INSERT INTO public.cvm_fundamentos (
  codigo_cvm, ano_exercicio, cnpj, data_base,
  receita_liquida, custo, lucro_liquido, patrimonio_liquido,
  divida_curto_prazo, divida_longo_prazo, caixa, aplicacoes_financeiras,
  dividendos_distribuidos, quantidade_acoes)
VALUES ('9512', 2025, '33000167000101', '2025-12-31',
        497549000000, -260551000000, 110605000000, 417587000000,
        67253000000, 316772000000, 35608000000, 15000000000,
        42423000000, 12888732761);

-- =====================================================
-- PARTE 2: comportamento como `authenticated`
-- =====================================================
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  n integer;
BEGIN
  -- Le a ponte e o fundamento.
  SELECT count(*) INTO n FROM public.cvm_indicadores;
  IF n <> 2 THEN
    RAISE EXCEPTION 'authenticated deveria ver 2 tickers na view, viu %', n;
  END IF;

  -- Nao escreve em nenhuma das duas tabelas legiveis.
  BEGIN
    INSERT INTO public.cvm_fundamentos (codigo_cvm, ano_exercicio, cnpj, data_base, lucro_liquido)
    VALUES ('9999', 2025, '11111111111111', '2025-12-31', 1);
    RAISE EXCEPTION 'authenticated conseguiu INSERIR fundamento -- o balanco ficou editavel pelo usuario';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE public.cvm_fundamentos SET lucro_liquido = 1 WHERE codigo_cvm = '9512';
    RAISE EXCEPTION 'authenticated conseguiu ALTERAR o lucro liquido';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    DELETE FROM public.cvm_ponte_ticker WHERE ticker = 'PETR4';
    RAISE EXCEPTION 'authenticated conseguiu APAGAR a ponte de um ticker';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- E a tabela de diagnostico nao e legivel: ela existe para operacao, nao para
  -- a tela. RLS ligada sem policy nenhuma nega tudo.
  BEGIN
    SELECT count(*) INTO n FROM public.cvm_tickers_sem_fundamento;
    RAISE EXCEPTION 'authenticated leu cvm_tickers_sem_fundamento (% linhas)', n;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

RESET ROLE;

-- =====================================================
-- PARTE 3: as constraints que guardam a regra da ponte
-- =====================================================
-- A regra "o radical e o ticker sem os digitos" mora no ingestor E no banco. No
-- banco porque um ingestor com defeito poderia pendurar o codigo CVM da Acu
-- Petroleo no ticker PETR4 -- e sem a constraint o banco aceitaria calado, que e
-- exatamente o modo de falhar que a HMO-194 existe para fechar.
DO $$
BEGIN
  -- Ticker NOVO de proposito, e so `check_violation` aceito.
  --
  -- A primeira versao deste bloco usava 'PETR4', que a semente ja inseriu: o
  -- INSERT levantava `unique_violation` e o teste passava mesmo com o CHECK
  -- REMOVIDO da migration (medido -- o mutante sobreviveu). A chave primaria
  -- roubava o controle negativo, e o teste afirmava uma regra que nao estava
  -- sendo exercitada.
  BEGIN
    INSERT INTO public.cvm_ponte_ticker (ticker, radical, codigo_cvm, cnpj, denominacao)
    VALUES ('ACPE4', 'PETR', '916986', '21778678000170', 'ACU PETROLEO S.A.');
    RAISE EXCEPTION 'o banco aceitou um radical que nao e o prefixo do ticker (ACPE4 -> PETR)';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.cvm_ponte_ticker (ticker, radical, codigo_cvm, cnpj, denominacao)
    VALUES ('PETROBRAS4', 'PETR', '9512', '33000167000101', 'X');
    RAISE EXCEPTION 'o banco aceitou ticker fora do formato da B3';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.cvm_ponte_ticker (ticker, radical, codigo_cvm, cnpj, denominacao)
    VALUES ('ABCD3', 'ABCD', '1', '191', 'CNPJ CURTO S.A.');
    RAISE EXCEPTION 'o banco aceitou CNPJ sem os 14 digitos -- o zero a esquerda da B3 tem que ser reposto antes de gravar';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- A data-base tem que pertencer ao exercicio. Este e o erro que a referencia da
  -- issue trazia: o dividendo de R$ 101,2 bi e de 2024, citado junto com o lucro
  -- de 2025. Balanco de um ano na linha de outro passa despercebido -- os dois
  -- numeros sao plausiveis.
  BEGIN
    INSERT INTO public.cvm_fundamentos (codigo_cvm, ano_exercicio, cnpj, data_base, lucro_liquido)
    VALUES ('4170', 2025, '33592510000154', '2024-12-31', 1);
    RAISE EXCEPTION 'o banco aceitou data_base de 2024 na linha do exercicio 2025';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Distribuicao negativa nao existe: o ingestor ja inverteu o sinal da DMPL.
  BEGIN
    INSERT INTO public.cvm_fundamentos (codigo_cvm, ano_exercicio, cnpj, data_base, lucro_liquido, dividendos_distribuidos)
    VALUES ('4170', 2025, '33592510000154', '2025-12-31', 1, -5);
    RAISE EXCEPTION 'o banco aceitou dividendo distribuido negativo';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Linha sem conta nenhuma seria um card vazio com data-base, com cara de dado
  -- importado. Mesma razao do CHECK que faltou nas views do 008.
  BEGIN
    INSERT INTO public.cvm_fundamentos (codigo_cvm, ano_exercicio, cnpj, data_base)
    VALUES ('4170', 2025, '33592510000154', '2025-12-31');
    RAISE EXCEPTION 'o banco aceitou linha de fundamento com todas as contas nulas';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- =====================================================
-- PARTE 4: a view -- uma fonte por indicador, e NULO onde nao da para calcular
-- =====================================================
DO $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM public.cvm_indicadores WHERE ticker = 'PETR4';

  -- Os numeros conferidos no arquivo da CVM (ver scripts/test-fundamento-cvm.mjs).
  IF round(r.roe * 100, 2) <> 26.49 THEN
    RAISE EXCEPTION 'ROE da PETR4 deu %, esperado 26.49', round(r.roe * 100, 2);
  END IF;
  IF round(r.divida_liquida_sobre_patrimonio, 2) <> 0.80 THEN
    RAISE EXCEPTION 'divida liquida / patrimonio deu %, esperado 0.80',
      round(r.divida_liquida_sobre_patrimonio, 2);
  END IF;
  IF round(r.margem_bruta * 100, 2) <> 47.63 THEN
    RAISE EXCEPTION 'margem bruta deu %, esperado 47.63 (o custo vem NEGATIVO da DRE e se SOMA)',
      round(r.margem_bruta * 100, 2);
  END IF;
  -- A data-base tem que estar na view: sem ela dois indicadores de datas
  -- diferentes ficam lado a lado parecendo do mesmo dia.
  IF r.data_base <> DATE '2025-12-31' THEN
    RAISE EXCEPTION 'a view perdeu a data-base do balanco';
  END IF;

  -- Dois tickers da mesma empresa leem a MESMA linha de fundamento -- a ponte nao
  -- duplica balanco.
  IF (SELECT count(DISTINCT roe) FROM public.cvm_indicadores WHERE codigo_cvm = '9512') <> 1 THEN
    RAISE EXCEPTION 'PETR3 e PETR4 deram ROE diferente para a mesma empresa';
  END IF;
END $$;

-- Patrimonio NEGATIVO: o ROE tem que ser NULO, nao positivo.
--
-- -50 de prejuizo sobre -100 de patrimonio daria "ROE 50%", e um crivo de
-- rentabilidade aprovaria a empresa mais quebrada da lista como a melhor da
-- lista. Quando o denominador troca de sinal a razao troca de significado.
INSERT INTO public.cvm_fundamentos (codigo_cvm, ano_exercicio, cnpj, data_base,
  lucro_liquido, patrimonio_liquido, divida_curto_prazo)
VALUES ('4170', 2025, '33592510000154', '2025-12-31', -50000000, -100000000, 10000000);

INSERT INTO public.cvm_ponte_ticker (ticker, radical, codigo_cvm, cnpj, denominacao)
VALUES ('VALE3', 'VALE', '4170', '33592510000154', 'EMPRESA COM PASSIVO A DESCOBERTO');

DO $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM public.cvm_indicadores WHERE ticker = 'VALE3';

  IF r.roe IS NOT NULL THEN
    RAISE EXCEPTION
      'ROE com patrimonio negativo deu % -- tinha que ser NULO; do contrario o prejuizo sobre patrimonio negativo aparece como rentabilidade positiva',
      r.roe;
  END IF;
  IF r.divida_liquida_sobre_patrimonio IS NOT NULL THEN
    RAISE EXCEPTION 'alavancagem com patrimonio negativo deveria ser NULA, deu %',
      r.divida_liquida_sobre_patrimonio;
  END IF;
END $$;

-- Empresa que nao publicou divida nenhuma: `divida_liquida` tem que ser NULA, e
-- nao o negativo do caixa. Sem isso um banco sem as contas de emprestimo
-- apareceria com "caixa liquido" igual ao caixa, parecendo quem so nao reportou.
INSERT INTO public.cvm_fundamentos (codigo_cvm, ano_exercicio, cnpj, data_base,
  lucro_liquido, patrimonio_liquido, caixa)
VALUES ('19348', 2025, '60872504000123', '2025-12-31', 45849000000, 215076000000, 30000000000);

INSERT INTO public.cvm_ponte_ticker (ticker, radical, codigo_cvm, cnpj, denominacao)
VALUES ('ITUB4', 'ITUB', '19348', '60872504000123', 'ITAU UNIBANCO HOLDING S.A.');

DO $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM public.cvm_indicadores WHERE ticker = 'ITUB4';

  IF r.divida_liquida IS NOT NULL THEN
    RAISE EXCEPTION
      'divida liquida sem nenhuma perna de divida deu % -- tinha que ser NULA, senao vira "caixa liquido" inventado',
      r.divida_liquida;
  END IF;
  IF r.margem_bruta IS NOT NULL THEN
    RAISE EXCEPTION 'margem bruta sem receita nem custo deveria ser NULA, deu %', r.margem_bruta;
  END IF;
  -- Mas o ROE existe: banco tem lucro e patrimonio.
  IF round(r.roe * 100, 2) <> 21.32 THEN
    RAISE EXCEPTION 'ROE do banco deu %, esperado 21.32', round(r.roe * 100, 2);
  END IF;
END $$;

ROLLBACK;
