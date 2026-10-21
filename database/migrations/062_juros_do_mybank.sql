-- 062_juros_do_mybank.sql
--
-- HMO-445, filha F1 da HMO-444: SO O SCHEMA. Solta a trava de juro zero que a
-- 053 instalou de proposito, grava a CONVENCAO de juro na linha, e reescreve o
-- comentario que, com juros, passa a MENTIR sobre dinheiro.
--
-- Nenhum leitor sobe com esta migration: nao ha `lib/`, rota nem tela neste PR.
-- O `JUROS_DA_FASE_1 = 0` de `lib/emprestimo-do-mybank.ts` continua de pe
-- depois dela -- quem o tira e a F3.
--
-- ===========================================================================
-- A 053 DEIXOU ESTE DIA PREPARADO, E EM UMA LINHA
-- ===========================================================================
-- A 053 (ja colada em prod) criou a coluna e a trava de fase no mesmo CREATE
-- TABLE, e escreveu no proprio arquivo que a trava nasceu COM NOME PROPRIO para
-- ser solta em uma linha quando os juros entrassem:
--
--   interest_rate numeric(9,6) DEFAULT 0 NOT NULL
--   CONSTRAINT mybank_loans_interest_rate_fase_1 CHECK (interest_rate = 0)
--
-- Esta migration e esse dia. A coluna NAO e criada aqui; ela existe desde a
-- 053, em prod, com todas as linhas valendo 0 -- que e o que a propria trava
-- garantiu.
--
-- ===========================================================================
-- ESTADO DE PROD (REMEDIDO 2026-10-21, pelo PostgREST na credencial anon)
-- ===========================================================================
-- Prod esta na 061 e A FILA DE COLAGEM ESTA VAZIA: esta migration e a proxima.
-- A sonda foi existencia de coluna pelo PostgREST, que distingue os dois casos
-- em codigos diferentes -- `42501` (a coluna existe, a RLS/grant barra a
-- leitura) contra `42703` (a coluna nao existe):
--
--   mybank_loans.principal ................. 42501  (controle POSITIVO, 053)
--   mybank_loans.coluna_que_nao_existe_xyz . 42703  (controle NEGATIVO)
--   mybank_loans.interest_rate ............. 42501  (053, a base desta)
--   mybank_installments.amount ............. 42501  (053)
--   financial_transactions.include_in_total  42501  (060, HMO-443: COLADA)
--   card_invoice_lines.include_in_total .... 42501  (061, fatura publica)
--   mybank_loans.interest_kind ............. 42703  (ESTA: ainda nao colada)
--
-- OS DOIS CONTROLES SAO O QUE TORNA A MEDIDA LEGIVEL. Sem o positivo, um
-- `42501` generico poderia ser credencial errada em tudo; sem o negativo, um
-- `42703` confirmaria um typo meu em vez da ausencia da coluna. As duas pontas
-- responderam o esperado na mesma rodada, entao as cinco leituras do meio sao
-- as colunas e nao a credencial.
--
-- RESSALVA SOBRE A LINHA DA 061: `card_invoice_lines` e VIEW, e o que esta
-- medido ali e que a view em prod EXPOE a coluna -- nao que o corpo dela seja
-- byte a byte o do arquivo da 061. Para ESTA migration isso nao muda nada: ela
-- depende so da 053, e o preflight diz exatamente isso. A ressalva esta escrita
-- para quem vier medir deriva de view depois, e nao para esta colagem.
--
-- O NUMERO ERA 060, DEPOIS 061, E SO AGORA E 062. A issue HMO-445 pedia
-- `060_juros_do_mybank.sql`, com a nota de pre-voo "prod esta na 059 e a fila
-- esta vazia (medido 2026-10-20)" -- e aquilo era verdade quando a issue foi
-- escrita. Desde entao DUAS migrations de outras branches passaram na frente: a
-- HMO-443 mergeou o PR #343 com `060_lancamento_fora_dos_totais.sql`, e a
-- fatura publica levou a `061_fatura_publica_fora_dos_totais.sql`. As duas
-- foram COLADAS (medido acima) enquanto esta esperava.
--
-- Duas branches podem reivindicar o MESMO numero sem conflito de git -- os
-- nomes de arquivo sao diferentes, e nada no merge reclama. So o
-- `check-migrations-in-ci` ou a cadeia do `db-verify` mostram o estrago. Dai o
-- 062, remedido contra `origin/main` imediatamente antes de abrir o PR, e nao
-- no comeco do run.
--
-- A renumeracao levou tambem os uuids das fixtures (`a0600000-...` ->
-- `a0620000-...`). Isso NAO e enfeite: a fixture da HMO-443 usa
-- `a0600000-...`/`f0600000-...`, as duas COMITAM no banco do CI, e o
-- `ON CONFLICT (id) DO NOTHING` teria feito a minha reusar a linha DELA calada
-- -- com o tipo de conta que ela escolheu, que nao e de investimento, e a trava
-- 1 da 053 recusaria o emprestimo por um motivo que nao esta escrito em lugar
-- nenhum. A fixture da 061 usa `a6100000-...`, que nao colide com nenhuma das
-- duas (conferido).
--
-- `public.schema_migrations` continua VAZIA em prod e NAO serve de livro-caixa
-- da colagem: quem quiser saber o que entrou le o catalogo (coluna, constraint,
-- `col_description`). Depois de colar esta, a sonda e uma linha:
--
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'public.mybank_loans'::regclass AND contype = 'c';
--   -- `mybank_loans_interest_rate_fase_1` NAO pode mais aparecer;
--   -- `mybank_loans_interest_kind_check` tem de aparecer.
--
--   SELECT col_description('public.mybank_loans'::regclass, attnum)
--     FROM pg_attribute
--    WHERE attrelid = 'public.mybank_loans'::regclass AND attname = 'principal';
--   -- nao pode mais conter "tem de fechar com ele"
--
-- As tres leem CATALOGO, entao funcionam pela credencial RO (catalogo nao tem
-- RLS) -- diferente de qualquer contagem de linha nestas tabelas.
--
-- ===========================================================================
-- ORDEM COM A F3 (A ROTA/TELA DOS JUROS): A COLAGEM VEM PRIMEIRO
-- ===========================================================================
-- A colagem em prod e do Helio; a credencial do agente em prod e RO. **A F3 nao
-- pode ser mergeada antes da confirmacao da colagem desta migration.** Com o
-- codigo da F3 no ar e a 062 ainda nao colada, um `interest_rate` diferente de
-- zero volta `check_violation` da trava de fase e a rota devolve 500 "erro
-- interno" para um emprestimo legitimo.
--
-- No sentido inverso nao ha risco: esta migration e aditiva para o codigo que
-- esta em prod HOJE. Nada no ar nomeia `interest_kind`, e nada no ar grava
-- `interest_rate` diferente de 0 (a constante `JUROS_DA_FASE_1`). Colar com a
-- `main` "velha" e inofensivo.
--
-- ===========================================================================
-- POR QUE A CONVENCAO VAI GRAVADA NA LINHA (`interest_kind`) -- DECISAO D2
-- ===========================================================================
-- Hoje existe UMA aritmetica: `total = principal x (1 + interest_rate)`, com a
-- taxa valendo para o EMPRESTIMO INTEIRO (nao ao mes). A tentacao e nao gravar
-- nada e deixar a aritmetica implicita no codigo.
--
-- O preco disso aparece no dia em que entrar juro composto: as linhas antigas
-- seriam reinterpretadas pela aritmetica NOVA, e todo emprestimo velho passaria
-- a mostrar outro total -- sem nenhuma linha do banco estar invalida, sem erro
-- em lugar nenhum, e sem ninguem ter editado nada. E a mesma licao da HMO-439 (o
-- aporte de renda fixa, cuja unidade foi gravada em vez de inferida do nome da
-- coluna) e da HMO-440 (a convencao da taxa anual).
--
-- Entao a convencao e DADO, nao convencao: `interest_kind` nasce com um unico
-- valor possivel, e juro composto entrara como valor NOVO do mesmo CHECK --
-- deixando as linhas antigas lidas pela aritmetica DELAS.
--
-- O OUTRO LADO DO PAR JA ESTA NA MAIN, e os dois nomes tem de continuar iguais:
-- a F2 (HMO-446, PR #342) entregou `lib/juros-do-emprestimo.ts` com
-- `CONVENCAO_DO_JURO = "total_simples"` e `TAXA_MAXIMA = 10`, citando esta
-- migration. A string e o teto desta migration foram conferidos contra aquele
-- arquivo -- `taxa > TAXA_MAXIMA` recusa la, que e o mesmo `<= 10` inclusivo
-- daqui. Se um dia um dos dois lados mudar sozinho, o sintoma e uma linha que o
-- banco aceita e a tela recusa (ou pior, o contrario, e a rota devolve 500).
--
-- ===========================================================================
-- O TETO DE SANIDADE
-- ===========================================================================
-- A 053 trouxe `mybank_loans_interest_rate_check CHECK (interest_rate >= 0)` --
-- so o piso. Com a trava de fase solta, esse piso sozinho aceita
-- `interest_rate = 300` (30000% do emprestimo) sem pestanejar.
--
-- Esta migration REESCREVE aquela constraint com os dois lados,
-- `0 <= interest_rate <= 10`, em vez de acrescentar uma segunda: o dominio da
-- coluna fica em UM nome, e nao espalhado em dois que se sobrepoem. 10 e 1000%
-- sobre o emprestimo todo -- dedo escorregado, nao negocio. Validar a
-- constraint nova e de graca em prod: todas as linhas valem 0.
--
-- ===========================================================================
-- O ITEM PERIGOSO DESTA MIGRATION NAO E DDL -- E O `COMMENT ON principal`
-- ===========================================================================
-- O comentario que a 053 deixou na coluna afirma:
--
--   "O valor emprestado, POSITIVO. A soma de mybank_installments.amount tem de
--    fechar com ele."
--
-- Com juros isso vira FALSO. Doze parcelas de R$ 100 de um emprestimo de
-- R$ 1.000 a 20% somam R$ 1.200, e a soma das parcelas deixa de fechar com o
-- principal PORQUE ESTA CERTA.
--
-- E essa invariante NAO E CONSTRAINT NEM TRIGGER: a 053 nao tem nenhum `SUM()`.
-- Ela vive so naquele comentario. O risco, portanto, nao e o banco recusar --
-- e documentacao mentindo sobre dinheiro, e alguem escrever depois uma guarda
-- "consertando" a soma, que apagaria o juro de todo emprestimo do sistema.
--
-- O modelo que entra no lugar, e que o comentario novo tem de dizer:
--
--   mybank_loans.principal          o que SAIU da conta de investimento
--   SUM(mybank_installments.amount) o que VOLTA (principal + juro)
--   SUM(amount) - principal         o JURO do emprestimo
--
-- O posflight da SECAO 6 confere que o comentario novo esta na coluna E que a
-- frase antiga saiu: comentario e a unica sonda de colagem desta migration, e
-- um `COMMENT ON` perdido num merge deixaria a afirmacao falsa em pe sem
-- nenhum sintoma.
--
-- ===========================================================================
-- RE-EXECUTAVEL
-- ===========================================================================
-- Producao recebe migration por colagem a mao, e colar duas vezes acontece:
--   - `DROP CONSTRAINT IF EXISTS` nas tres (a de fase, a do dominio da taxa, a
--     de `interest_kind`) -- nao existe `ADD CONSTRAINT IF NOT EXISTS` no
--     Postgres, entao o par DROP + ADD e a forma idempotente;
--   - `ADD COLUMN IF NOT EXISTS` na coluna nova;
--   - `COMMENT ON`, idempotente por natureza.
-- NENHUM `UPDATE`: nao ha backfill nesta migration, e isso e decisao. O
-- `DEFAULT 'total_simples'` do `ADD COLUMN` ja grava o valor certo nas linhas
-- que existiam -- elas foram criadas sob a aritmetica `total_simples` com taxa
-- 0, que e justamente o que esse valor significa. Um `UPDATE ... SET
-- interest_kind = <...>` de "limpeza" reescreveria, na segunda colagem, a
-- convencao de emprestimos que ja tivessem outra.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. PREFLIGHT: do que esta migration depende
-- ---------------------------------------------------------------------------
-- Tudo antes do primeiro ALTER, para a colagem morrer com uma frase em vez de
-- um erro de catalogo no meio. Nenhum item aqui e decorativo.
DO $$
DECLARE
  problemas text := '';
  v_fora    bigint;
BEGIN
  IF to_regclass('public.mybank_loans') IS NULL THEN
    problemas := problemas || E'\n  - public.mybank_loans nao existe (053); esta migration solta uma trava DELA';
  ELSE
    -- A coluna NAO e criada aqui -- ela vem da 053. Sem este item, um banco
    -- parado antes da 053 morreria no `DROP CONSTRAINT IF EXISTS` (que nao
    -- reclama de nada) e so depois no CHECK, com uma mensagem que nao diz qual
    -- migration esta faltando.
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'mybank_loans'
                     AND column_name = 'interest_rate') THEN
      problemas := problemas || E'\n  - mybank_loans.interest_rate nao existe (053); e a coluna que esta migration LIBERA, nao a que ela cria';
    END IF;

    -- O teto novo e validado contra as linhas que ja existem. Em prod todas
    -- valem 0 (a trava de fase garantiu), mas um banco de desenvolvimento onde
    -- alguem soltou a trava a mao morreria aqui com `23514` e a mensagem do
    -- Postgres nomeia a constraint, nao a linha. Contar antes custa uma
    -- consulta e troca o erro por uma frase.
    SELECT count(*) INTO v_fora
      FROM public.mybank_loans
     WHERE interest_rate < 0 OR interest_rate > 10;

    IF v_fora > 0 THEN
      problemas := problemas || E'\n  - ha ' || v_fora || ' emprestimo(s) com interest_rate fora de [0, 10]; o teto de sanidade desta migration os recusaria. Corrija as linhas antes de colar';
    END IF;
  END IF;

  -- A SECAO 5 reescreve o comentario de `principal` falando da soma de
  -- `mybank_installments.amount`. Sem a tabela, aquele comentario apontaria
  -- para o nada.
  IF to_regclass('public.mybank_installments') IS NULL THEN
    problemas := problemas || E'\n  - public.mybank_installments nao existe (053); e a soma que o comentario novo de principal descreve';
  END IF;

  IF problemas <> '' THEN
    RAISE EXCEPTION '062 nao pode ser aplicada neste banco:%', problemas;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. A TRAVA DE FASE SAI
-- ---------------------------------------------------------------------------
-- A linha que a 053 escreveu para ser escrita aqui. `IF EXISTS` para a segunda
-- colagem nao estourar `42704` -- depois da primeira, a constraint ja nao
-- existe.
ALTER TABLE public.mybank_loans
    DROP CONSTRAINT IF EXISTS mybank_loans_interest_rate_fase_1;

-- ---------------------------------------------------------------------------
-- 3. A CONVENCAO DE JURO, GRAVADA NA LINHA
-- ---------------------------------------------------------------------------
-- `NOT NULL DEFAULT 'total_simples'` na propria instrucao: o default ja grava o
-- valor nas linhas que existem, entao nao ha janela entre "a coluna existe
-- nula" e "o backfill rodou" -- e nao ha backfill. Ver o cabecalho para o
-- porque de NAO haver `UPDATE` nenhum nesta migration.
ALTER TABLE public.mybank_loans
    ADD COLUMN IF NOT EXISTS interest_kind text NOT NULL DEFAULT 'total_simples';

-- A catraca do enum. Par DROP + ADD porque nao existe `ADD CONSTRAINT IF NOT
-- EXISTS` no Postgres.
--
-- UM UNICO VALOR, e isso e o ponto: juro composto entra como valor NOVO desta
-- lista, numa migration futura, e as linhas antigas continuam dizendo
-- `total_simples` -- lidas pela aritmetica DELAS. Um CHECK que ja aceitasse
-- `total_composto` hoje deixaria o app gravar uma convencao que nenhuma funcao
-- deste repositorio sabe calcular.
ALTER TABLE public.mybank_loans
    DROP CONSTRAINT IF EXISTS mybank_loans_interest_kind_check;

ALTER TABLE public.mybank_loans
    ADD CONSTRAINT mybank_loans_interest_kind_check
      CHECK (interest_kind IN ('total_simples'));

-- ---------------------------------------------------------------------------
-- 4. O DOMINIO DA TAXA: O PISO DA 053 MAIS O TETO DE SANIDADE
-- ---------------------------------------------------------------------------
-- A 053 trouxe `CHECK (interest_rate >= 0)`. Com a trava de fase solta, so o
-- piso aceita 30000%. A constraint e REESCRITA (e nao duplicada por uma segunda
-- com outro nome) para o dominio da coluna morar em um lugar so.
ALTER TABLE public.mybank_loans
    DROP CONSTRAINT IF EXISTS mybank_loans_interest_rate_check;

ALTER TABLE public.mybank_loans
    ADD CONSTRAINT mybank_loans_interest_rate_check
      CHECK (interest_rate >= 0 AND interest_rate <= 10);

-- ---------------------------------------------------------------------------
-- 5. OS COMENTARIOS -- A PARTE QUE MEXE COM DINHEIRO
-- ---------------------------------------------------------------------------
-- Ver o cabecalho: a invariante "a soma das parcelas fecha com o principal" nao
-- e constraint nem trigger neste banco; ela vive SO neste comentario, e com
-- juros ela e falsa. Reescrever o texto e a entrega, nao o enfeite.
COMMENT ON COLUMN public.mybank_loans.principal IS
  'O que SAIU da conta de investimento (o valor emprestado), POSITIVO. A partir da HMO-444 a soma de mybank_installments.amount NAO fecha mais com ele, e isso esta CERTO: a soma e o que VOLTA (principal + juro), e SUM(amount) - principal E O JURO do emprestimo. Com interest_kind = total_simples, SUM(amount) = principal x (1 + interest_rate), com a ultima parcela absorvendo o centavo da divisao. NAO existe constraint nem trigger exigindo que a soma feche -- a invariante antiga (053) morava so neste comentario, e quem escrever depois uma guarda "consertando" a soma vai estar apagando o juro de todo emprestimo do sistema.';

COMMENT ON COLUMN public.mybank_loans.interest_rate IS
  'A taxa de juro DO EMPRESTIMO INTEIRO, nao ao mes e nao ao ano: com interest_kind = total_simples, o total a devolver e principal x (1 + interest_rate). 0.2 = 20% sobre o emprestimo todo. A trava de fase 1 da 053 (que exigia exatamente 0) foi SOLTA pela 062/HMO-444; o que restou e o dominio da coluna, em mybank_loans_interest_rate_check: 0 <= interest_rate <= 10, onde 10 e 1000% -- dedo escorregado, nao negocio.';

COMMENT ON COLUMN public.mybank_loans.interest_kind IS
  'A convencao de juro GRAVADA NA LINHA (HMO-444, decisao D2), e nao inferida do nome da coluna nem da versao do codigo que leu a linha. Hoje o unico valor e total_simples: total = principal x (1 + interest_rate), taxa do emprestimo inteiro. Juro composto entrara como valor NOVO de mybank_loans_interest_kind_check, e as linhas antigas continuarao lidas pela aritmetica delas -- sem esta coluna, a aritmetica nova reinterpretaria todo emprestimo velho e o total mostrado na tela mudaria sozinho, sem ninguem editar nada. Mesma licao da HMO-439/440.';

-- ---------------------------------------------------------------------------
-- 6. POSFLIGHT: a 062 ficou completa?
-- ---------------------------------------------------------------------------
-- Dentro da transacao, para a colagem pela metade nao existir. O que se confere
-- aqui e o que NAO da erro quando falta: uma constraint que nao foi solta, um
-- CHECK que ficou com um lado so, e -- o mais importante -- um `COMMENT ON`
-- perdido, que deixaria a afirmacao FALSA sobre a soma das parcelas em pe sem
-- nenhum sintoma.
DO $$
DECLARE
  problemas text := '';
  v_def     text;
  v_com     text;
BEGIN
  -- A trava de fase SAIU. E a entrega desta migration.
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = to_regclass('public.mybank_loans')
                AND conname = 'mybank_loans_interest_rate_fase_1') THEN
    problemas := problemas || E'\n  - mybank_loans_interest_rate_fase_1 AINDA EXISTE; os juros continuam recusados';
  END IF;

  -- A coluna nova, com a forma inteira: tipo, nulabilidade e default. Um
  -- default perdido deixaria a proxima linha sem convencao gravada, que e
  -- exatamente o que esta migration existe para impedir.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'mybank_loans'
                   AND column_name = 'interest_kind'
                   AND data_type = 'text'
                   AND is_nullable = 'NO'
                   AND column_default = '''total_simples''::text') THEN
    problemas := problemas || E'\n  - mybank_loans.interest_kind nao ficou text NOT NULL DEFAULT ''total_simples'' (obtido: '
                 || coalesce((SELECT data_type || ' / ' || is_nullable || ' / ' || coalesce(column_default, '(sem default)')
                                FROM information_schema.columns
                               WHERE table_schema = 'public' AND table_name = 'mybank_loans'
                                 AND column_name = 'interest_kind'), '(coluna ausente)') || ')';
  END IF;

  -- A catraca do enum existe e e EXATAMENTE de um valor.
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = to_regclass('public.mybank_loans')
     AND conname = 'mybank_loans_interest_kind_check';

  IF v_def IS NULL THEN
    problemas := problemas || E'\n  - mybank_loans_interest_kind_check nao ficou; qualquer texto entraria em interest_kind';
  ELSIF v_def NOT LIKE '%total_simples%' OR v_def LIKE '%composto%' THEN
    problemas := problemas || E'\n  - mybank_loans_interest_kind_check nao aceita so total_simples: ' || v_def;
  END IF;

  -- O dominio da taxa com os DOIS lados. Um `>= 0` sozinho (o que a 053 tinha)
  -- passaria por "a constraint existe".
  --
  -- A COMPARACAO E SOBRE O TEXTO NORMALIZADO, e isso nao e preciosismo: o
  -- `pg_get_constraintdef` devolve `(interest_rate >= (0)::numeric)`, com
  -- parenteses e cast que o autor da migration nao escreveu -- um
  -- `LIKE '%>= 0%'` ingenuo reprova a migration CERTA (medido, nesta propria
  -- migration, na primeira rodada da cadeia local). Tirando espacos e
  -- parenteses sobra `interest_rate>=0::numeric`, e o `::` no fim do padrao e o
  -- que impede `<= 100` de passar por `<= 10`.
  SELECT replace(replace(replace(pg_get_constraintdef(oid), ' ', ''), '(', ''), ')', '')
    INTO v_def
    FROM pg_constraint
   WHERE conrelid = to_regclass('public.mybank_loans')
     AND conname = 'mybank_loans_interest_rate_check';

  IF v_def IS NULL THEN
    problemas := problemas || E'\n  - mybank_loans_interest_rate_check nao ficou; a taxa nao teria piso nem teto';
  ELSIF v_def NOT LIKE '%interest_rate>=0::%' OR v_def NOT LIKE '%interest_rate<=10::%' THEN
    problemas := problemas || E'\n  - mybank_loans_interest_rate_check nao ficou com piso 0 E teto 10: ' || v_def;
  END IF;

  -- O COMENTARIO DE `principal`. As duas direcoes: o texto novo entrou E a
  -- frase antiga saiu. Sem a segunda metade, um `COMMENT ON` que nao rodasse
  -- deixaria a afirmacao falsa sobre dinheiro em pe -- e e ela que convida a
  -- guarda que apagaria o juro.
  v_com := col_description(to_regclass('public.mybank_loans'),
             (SELECT attnum FROM pg_attribute
               WHERE attrelid = to_regclass('public.mybank_loans')
                 AND attname = 'principal'));

  IF v_com IS NULL THEN
    problemas := problemas || E'\n  - o COMMENT de mybank_loans.principal ficou VAZIO';
  ELSE
    IF v_com LIKE '%tem de fechar com ele%' THEN
      problemas := problemas || E'\n  - o COMMENT de mybank_loans.principal AINDA afirma que a soma das parcelas fecha com ele; com juros isso e falso e convida uma guarda que apagaria o juro';
    END IF;
    IF v_com NOT LIKE '%HMO-444%' THEN
      problemas := problemas || E'\n  - o COMMENT de mybank_loans.principal nao cita a HMO-444; o comentario e a sonda de colagem desta migration';
    END IF;
  END IF;

  -- O comentario de `interest_kind`: sem ele, `total_simples` e uma string sem
  -- significado declarado em lugar nenhum do banco.
  v_com := col_description(to_regclass('public.mybank_loans'),
             (SELECT attnum FROM pg_attribute
               WHERE attrelid = to_regclass('public.mybank_loans')
                 AND attname = 'interest_kind'));

  IF v_com IS NULL OR v_com NOT LIKE '%total_simples%' THEN
    problemas := problemas || E'\n  - o COMMENT de mybank_loans.interest_kind nao explica o que total_simples significa';
  END IF;

  -- O comentario de `interest_rate` nao pode continuar mandando o leitor
  -- procurar uma trava que esta migration acabou de apagar.
  v_com := col_description(to_regclass('public.mybank_loans'),
             (SELECT attnum FROM pg_attribute
               WHERE attrelid = to_regclass('public.mybank_loans')
                 AND attname = 'interest_rate'));

  IF v_com IS NULL OR v_com NOT LIKE '%HMO-444%' THEN
    problemas := problemas || E'\n  - o COMMENT de mybank_loans.interest_rate nao foi reescrito; ele ainda descreve a coluna como reservada para a fase de juros';
  END IF;

  IF problemas <> '' THEN
    RAISE EXCEPTION '062 nao ficou completa:%', problemas;
  END IF;

  RAISE NOTICE '062 ok: mybank_loans_interest_rate_fase_1 SOLTA, interest_kind text NOT NULL DEFAULT total_simples com catraca de um valor, interest_rate com piso 0 e teto 10, e os tres COMMENT reescritos -- a soma das parcelas passa a ser principal + juro, e nao ha constraint nenhuma exigindo que ela feche.';
END $$;

COMMIT;
