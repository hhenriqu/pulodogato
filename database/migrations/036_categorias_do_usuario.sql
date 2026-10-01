-- 036_categorias_do_usuario.sql
--
-- HMO-216: "Todas as categorias devem poder ser personalizadas pelo usuario.
-- ao selecionar uma categoria, ele tem a opcao de criar uma nova categoria, e
-- as categorias agora devem contar com uma subcategoria. Por padrao toda
-- categoria tem a subcategoria 'Outros'."
--
-- ===========================================================================
-- O PONTO DE PARTIDA: `transaction_categories` E UMA TABELA GLOBAL
-- ===========================================================================
-- Hoje a tabela nao tem `user_id`. As 12 categorias que o app mostra sao SEED
-- do 001_baseline, iguais para todas as contas, e a unica policy de escrita
-- que existe e... nenhuma. O 002 deu a `authenticated` o GRANT de DML
-- (`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES`, SECAO 2), mas nunca
-- criou policy de INSERT/UPDATE/DELETE para esta tabela -- entao toda escrita
-- morre na RLS com 42501. Foi exatamente isso que quebrou a transferencia
-- entre contas por dias em producao (ver o cabecalho da 023).
--
-- Abrir essa porta do jeito obvio -- uma policy de INSERT para `authenticated`
-- sem mais nada -- entregaria a cada portador de sessao uma caneta que escreve
-- na tela de TODOS os usuarios do app. A tabela e global; nao existe "minha
-- categoria" sem uma coluna que diga de quem ela e.
--
-- ===========================================================================
-- O RISCO QUE ESTA MIGRATION FECHA DE PROPOSITO (LEIA ANTES DE "SIMPLIFICAR")
-- ===========================================================================
-- A policy de leitura que esta em producao desde o 002 e:
--
--     CREATE POLICY transaction_categories_read ON public.transaction_categories
--       FOR SELECT TO anon, authenticated USING (is_active = TRUE);
--
-- Nao ha filtro de usuario nenhum -- e nao havia porque nao havia dono. No
-- instante em que `user_id` passa a existir, essa MESMA policy, sem uma linha
-- de codigo nova, publica a categoria de cada pessoa para o app inteiro: a
-- lista de categorias de alguem conta onde a pessoa gasta ("Advogado",
-- "Tratamento", "Pensao"). E a familia de defeito de
-- `profiles_select_own_or_public` (ver 032) e da `coluna nova em profiles`.
--
-- Por isso a SECAO 2 APERTA a policy existente para `user_id IS NULL` (o
-- catalogo) e adiciona uma segunda, estreita, para a propria. Policies do
-- mesmo comando sao OR, entao o catalogo continua visivel para todo mundo e
-- cada pessoa ganha so as suas.
--
-- Se alguem reverter o aperto, o teste
-- `database/tests/hmo216_categorias_do_usuario_test.sql` reprova na assercao
-- (4) -- o controle negativo do estranho.
--
-- ===========================================================================
-- POR QUE SUBCATEGORIA E TABELA PROPRIA, E NAO `parent_id` AQUI
-- ===========================================================================
-- `ALTER TABLE transaction_categories ADD COLUMN parent_id` e uma linha, e
-- custaria caro: QUATRO tabelas apontam para `transaction_categories`
-- (`financial_transactions`, `transaction_installments`, `recurring_rules`,
-- `scheduled_transactions`), e nenhum dos consumidores -- os seletores das
-- telas, `/api/reports/categories`, os orcamentos, as regras de
-- categorizacao, as views do 008 -- sabe filtrar `parent_id IS NULL`. Todos
-- eles passariam a listar subcategoria COMO categoria no mesmo seletor, e o
-- total de cada categoria nos relatorios se partiria em duas linhas sem que
-- ninguem tocasse num SELECT.
--
-- Tabela separada e aditiva para todos eles: quem nao conhece
-- `transaction_subcategories` continua lendo exatamente o que lia.
--
-- ===========================================================================
-- A SUBCATEGORIA NAO PODE PERTENCER A OUTRA CATEGORIA (FK COMPOSTA)
-- ===========================================================================
-- Um `subcategory_id` solto em `financial_transactions` aceitaria "Mercado"
-- (de Alimentacao) dentro de Transporte -- um bug de tela viraria dado
-- gravado, e o relatorio por categoria ficaria certo enquanto o detalhe
-- mentiria. CHECK nao resolve: a regra olha OUTRA tabela.
--
-- A trava e uma FK COMPOSTA sobre `(category_id, subcategory_id)`. Ela e
-- declarativa, nao e trigger (nenhuma linha nova de plpgsql na tabela de
-- dinheiro), e o `MATCH SIMPLE` do Postgres -- o default -- faz exatamente o
-- que a feature precisa: se QUALQUER coluna da FK for NULL a restricao passa.
-- Como `subcategory_id` e nulavel e `category_id` e NOT NULL, lancamento sem
-- subcategoria passa, e lancamento COM subcategoria e obrigado a usar uma
-- subcategoria DAQUELA categoria.
--
-- Residual conhecido e deliberado: a verificacao de FK roda com privilegio do
-- sistema, fora da RLS, entao um cliente malicioso consegue apontar para a
-- subcategoria de OUTRA pessoa que esteja sob a mesma categoria do catalogo.
-- Isso nao vaza nada -- a policy de SELECT nao devolve aquela linha, e a tela
-- mostra o lancamento sem subcategoria. O teste fixa esse comportamento na
-- assercao (11), para que ninguem leia como vazamento depois.
--
-- ===========================================================================
-- "POR PADRAO TODA CATEGORIA TEM A SUBCATEGORIA 'OUTROS'"
-- ===========================================================================
-- Isso e invariante, nao uma linha de codigo na rota de criar categoria. Se
-- morasse na rota, toda categoria nascida por outro caminho (a 023 criou uma
-- por migration; a proxima migration vai criar outra) nasceria sem "Outros", e
-- a tela cairia no caso que nunca foi desenhado: seletor de subcategoria
-- vazio, com a categoria ja escolhida.
--
-- Entao e TRIGGER (SECAO 5) + BACKFILL (SECAO 6).
--
-- O trigger e SECURITY INVOKER de proposito, e isso e o contrario do padrao
-- das funcoes do 002. Funciona porque os dois unicos jeitos de uma categoria
-- nascer satisfazem a policy de INSERT da subcategoria por conta propria:
--
--   * usuario criando a propria categoria -> a subcategoria nasce com o mesmo
--     `user_id`, que e `auth.uid()`, e a policy passa;
--   * migration/SQL Editor criando categoria do catalogo -> quem roda e
--     `postgres`, que tem `rolbypassrls`.
--
-- SECURITY DEFINER aqui seria pior: com `FORCE ROW LEVEL SECURITY` ligado na
-- tabela (e esta), nem o dono escapa da policy em sessao normal, entao o
-- DEFINER nao compraria nada e esconderia de quem le que a escrita e do
-- usuario.
--
-- ===========================================================================
-- "TODAS AS CATEGORIAS DEVEM PODER SER PERSONALIZADAS"
-- ===========================================================================
-- Categoria PROPRIA: a pessoa edita a linha (policy de UPDATE, SECAO 2).
--
-- Categoria do CATALOGO: a linha e compartilhada por todo mundo, entao editar
-- ela mesma e impossivel sem mudar a tela dos outros. A personalizacao mora em
-- `transaction_category_prefs` (SECAO 3): nome, icone, cor e "esconder", por
-- usuario e por categoria. O valor efetivo e `COALESCE(pref, linha)` -- a
-- regra esta em `lib/categorias.ts`, testada sem banco.
--
-- Por que nao "copiar a categoria do catalogo para o usuario na primeira
-- edicao": os lancamentos ja gravados apontam para o id do catalogo. A copia
-- deixaria o historico numa categoria e o futuro na outra, com o mesmo nome na
-- tela, e nenhum relatorio somaria os dois.
--
-- ===========================================================================
-- IDEMPOTENTE, E COLAVEL NO SQL EDITOR
-- ===========================================================================
-- Producao nao tem runner de migration: alguem cola este arquivo no SQL Editor
-- do Supabase. Rodar duas vezes tem que ser inofensivo, e nenhuma linha pode
-- ser meta-comando do psql (`\...`) -- uma so reprova o arquivo INTEIRO.
--
-- Nao se usa `ON CONFLICT` em nenhum lugar aqui: as unicidades desta migration
-- sao INDICES PARCIAIS (por causa do `user_id IS NULL` do catalogo), e indice
-- parcial nao serve de arbitro de `ON CONFLICT`. Todo seed e
-- `INSERT ... WHERE NOT EXISTS`, como na 023.

BEGIN;

-- =====================================================
-- SECAO 1: A CATEGORIA GANHA DONO
-- =====================================================

-- NULL = catalogo (as 12 do 001 + a reservada da 023). Nao-NULL = de uma
-- pessoa. Nulavel e o que torna esta migration aditiva: as linhas que ja
-- existem continuam sendo catalogo sem backfill nenhum.
ALTER TABLE public.transaction_categories
  ADD COLUMN IF NOT EXISTS user_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'transaction_categories_user_id_fkey'
       AND conrelid = 'public.transaction_categories'::regclass
  ) THEN
    ALTER TABLE public.transaction_categories
      ADD CONSTRAINT transaction_categories_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

COMMENT ON COLUMN public.transaction_categories.user_id IS
  'NULL = categoria do catalogo, visivel a todos. Nao-NULL = categoria da '
  'pessoa, visivel so a ela (036). A policy de leitura DEPENDE disso.';

-- ---------------------------------------------------------------------------
-- A unicidade tem de virar DUAS, e por isso a antiga sai
-- ---------------------------------------------------------------------------
-- `unique_category_per_service UNIQUE (service_id, name)` (001) e global. Com
-- dono, ela proibiria a segunda pessoa do app de ter uma categoria chamada
-- "Pets" porque a primeira ja tem -- e o erro apareceria na tela como 23505
-- sobre um nome que ela nunca viu.
--
-- Trocamos por dois indices parciais que cobrem exatamente o que importa:
-- nome unico DENTRO do catalogo, e nome unico DENTRO de cada pessoa. Um
-- `UNIQUE (service_id, name, user_id)` sozinho nao serviria: em indice unico o
-- NULL nao colide com NULL, entao o catalogo deixaria de ser protegido e duas
-- "Alimentação" globais poderiam coexistir.
--
-- `DROP CONSTRAINT IF EXISTS` e seguro aqui: nenhuma FK referencia
-- (service_id, name) -- as quatro tabelas que apontam para esta usam o `id`.
ALTER TABLE public.transaction_categories
  DROP CONSTRAINT IF EXISTS unique_category_per_service;

CREATE UNIQUE INDEX IF NOT EXISTS unique_categoria_do_catalogo
  ON public.transaction_categories (service_id, name)
  WHERE user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS unique_categoria_do_usuario
  ON public.transaction_categories (service_id, user_id, name)
  WHERE user_id IS NOT NULL;

-- O seletor de cada tela lista "catalogo + as minhas". Sem este indice isso e
-- um seq scan na tabela por abertura de formulario.
CREATE INDEX IF NOT EXISTS idx_transaction_categories_user
  ON public.transaction_categories (user_id)
  WHERE user_id IS NOT NULL;

-- Nome em branco e o caso que a tela nao sabe desenhar: um item de seletor com
-- zero pixels de altura, que da para escolher sem ver. E o teto de 60 impede
-- que a categoria vire um paragrafo dentro do `SelectItem`.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'transaction_categories_nome_utilizavel'
       AND conrelid = 'public.transaction_categories'::regclass
  ) THEN
    ALTER TABLE public.transaction_categories
      ADD CONSTRAINT transaction_categories_nome_utilizavel
      CHECK (length(btrim(name)) > 0 AND length(name) <= 60);
  END IF;
END $$;

-- =====================================================
-- SECAO 2: RLS DA CATEGORIA
-- =====================================================

-- ---------------------------------------------------------------------------
-- 2a. O APERTO (a parte que fecha o vazamento descrito no cabecalho)
-- ---------------------------------------------------------------------------
-- A policy do 002 nao muda de nome: ela continua sendo "o catalogo e publico",
-- e agora diz isso com precisao. `anon` continua lendo o catalogo -- o
-- formulario de cadastro monta o seletor antes de resolver a sessao.
DROP POLICY IF EXISTS transaction_categories_read ON public.transaction_categories;
CREATE POLICY transaction_categories_read ON public.transaction_categories
  FOR SELECT TO anon, authenticated
  USING (is_active = TRUE AND user_id IS NULL);

-- ---------------------------------------------------------------------------
-- 2b. As minhas, inclusive as desativadas
-- ---------------------------------------------------------------------------
-- Sem `is_active` de proposito, e isso e diferente do catalogo: a tela de
-- gerenciar categorias precisa mostrar o que a pessoa desativou para ela poder
-- reativar. Desativar e o caminho normal de "apagar" uma categoria que ja tem
-- lancamento apontando para ela (a FK e RESTRICT por omissao, e tem de ser:
-- apagar a categoria de 300 lancamentos nao e o que a pessoa pediu ao clicar
-- em "excluir").
DROP POLICY IF EXISTS transaction_categories_read_own ON public.transaction_categories;
CREATE POLICY transaction_categories_read_own ON public.transaction_categories
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS transaction_categories_insert_own ON public.transaction_categories;
CREATE POLICY transaction_categories_insert_own ON public.transaction_categories
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- O que este policy protege, alem do obvio, e MOVER a propria categoria para
-- outro `user_id` ou para o CATALOGO (`user_id = NULL`) -- que seria publicar
-- "Pensão da Ana" no seletor de todo mundo. O `WITH CHECK` e quem barra isso:
-- `user_id = auth.uid()` e falso quando `user_id` e NULL.
--
-- Vale lembrar (medido na 032) que num `UPDATE ... WHERE ...` quem barra de
-- fato e a policy de SELECT, nao esta; o `USING` daqui importa no `UPDATE` sem
-- WHERE, que nao le nada antes de escrever.
DROP POLICY IF EXISTS transaction_categories_update_own ON public.transaction_categories;
CREATE POLICY transaction_categories_update_own ON public.transaction_categories
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS transaction_categories_delete_own ON public.transaction_categories;
CREATE POLICY transaction_categories_delete_own ON public.transaction_categories
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- O GRANT de DML para `authenticated` nesta tabela JA EXISTE desde o 002
-- (SECAO 2, `GRANT ... ON ALL TABLES`). Repetido aqui porque a migration tem
-- de ser legivel sozinha, e porque e o unico jeito de alguem que leia so este
-- arquivo nao concluir que falta um GRANT.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transaction_categories TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.transaction_categories FROM anon;

-- =====================================================
-- SECAO 3: PERSONALIZACAO DO CATALOGO
-- =====================================================

CREATE TABLE IF NOT EXISTS public.transaction_category_prefs (
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- CASCADE: se a categoria deixar de existir, a preferencia sobre ela nao tem
  -- do que falar. Nao ha risco do efeito descrito em
  -- `on-delete-set-null-dispara-check` aqui, porque isto APAGA a linha em vez
  -- de reescrever uma linha de dinheiro.
  category_id uuid NOT NULL REFERENCES public.transaction_categories(id) ON DELETE CASCADE,

  -- Os tres sao NULAVEIS, e o NULL e significativo: "nao personalizei este
  -- campo, use o do catalogo". Gravar uma copia do valor do catalogo em vez de
  -- NULL congelaria o nome: se o catalogo corrigir "Alimentacão" para
  -- "Alimentação", quem tiver pref nunca ve a correcao.
  name        text,
  icon        text,
  color_hex   text,

  -- "Nao quero ver esta categoria no meu seletor." E a unica forma honesta de
  -- "apagar" uma categoria do catalogo: a linha e dos outros tambem, e pode
  -- haver lancamento meu antigo apontando para ela -- que continua aparecendo
  -- no historico, com o nome certo.
  is_hidden   boolean NOT NULL DEFAULT FALSE,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- Uma preferencia por (pessoa, categoria). PK composta em vez de id proprio:
  -- nao existe pergunta neste sistema que comece com "qual preferencia?" sem
  -- dizer de quem e sobre o que.
  PRIMARY KEY (user_id, category_id),

  -- Mesmos limites da coluna que ele sobrescreve. Nome em branco aqui seria
  -- pior que na categoria: a linha do catalogo continua certa e a tela mostra
  -- vazio, o que se le como bug de carregamento.
  CONSTRAINT transaction_category_prefs_nome_utilizavel
    CHECK (name IS NULL OR (length(btrim(name)) > 0 AND length(name) <= 60)),

  -- `color_hex` entra em `style`/`className` na tela. O formato fechado aqui e
  -- o que impede que a cor da categoria seja um vetor de injecao no CSS.
  CONSTRAINT transaction_category_prefs_cor_hex
    CHECK (color_hex IS NULL OR color_hex ~ '^#[0-9A-Fa-f]{6}$'),

  CONSTRAINT transaction_category_prefs_icone_utilizavel
    CHECK (icon IS NULL OR (length(btrim(icon)) > 0 AND length(icon) <= 40))
);

COMMENT ON TABLE public.transaction_category_prefs IS
  'Personalizacao por usuario de uma categoria do catalogo (036). Valor '
  'efetivo = COALESCE(pref, transaction_categories). Ver lib/categorias.ts.';

DROP TRIGGER IF EXISTS update_transaction_category_prefs_updated_at
  ON public.transaction_category_prefs;
CREATE TRIGGER update_transaction_category_prefs_updated_at
  BEFORE UPDATE ON public.transaction_category_prefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.transaction_category_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_category_prefs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transaction_category_prefs_own ON public.transaction_category_prefs;
CREATE POLICY transaction_category_prefs_own ON public.transaction_category_prefs
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- O `GRANT ... ON ALL TABLES` do 002 e uma fotografia do momento em que ele
-- rodou: nao alcanca tabela criada depois. Sem este bloco a tabela nasce sem
-- GRANT nenhum e toda leitura volta 42501, com cara de RLS (ver 032).
REVOKE ALL ON public.transaction_category_prefs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transaction_category_prefs TO authenticated;

-- =====================================================
-- SECAO 4: A SUBCATEGORIA
-- =====================================================

CREATE TABLE IF NOT EXISTS public.transaction_subcategories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  category_id uuid NOT NULL REFERENCES public.transaction_categories(id) ON DELETE CASCADE,

  -- Mesma convencao da categoria: NULL = do catalogo (o "Outros" que o
  -- backfill cria para cada categoria global), nao-NULL = de uma pessoa.
  --
  -- Subcategoria PROPRIA sob categoria do CATALOGO e o caso principal da
  -- feature: "quero 'Mercado' e 'Restaurante' dentro de Alimentação, sem
  -- inventar uma categoria".
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,

  name        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT TRUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT transaction_subcategories_nome_utilizavel
    CHECK (length(btrim(name)) > 0 AND length(name) <= 60)
);

COMMENT ON TABLE public.transaction_subcategories IS
  'Subcategoria de uma categoria (036). Toda categoria tem "Outros" por '
  'invariante -- trigger criar_subcategoria_outros + backfill da 036.';

-- A UNIQUE que torna possivel a FK composta da SECAO 7. `id` ja e PK, entao
-- esta nao restringe nada de novo -- ela existe porque o Postgres exige que o
-- lado referenciado de uma FK seja coberto por um indice unico EXATAMENTE
-- sobre aquelas colunas, nessa ordem.
CREATE UNIQUE INDEX IF NOT EXISTS unique_subcategoria_na_categoria
  ON public.transaction_subcategories (category_id, id);

-- Nome unico dentro de (categoria, dono). Duas pessoas podem ter "Mercado" sob
-- Alimentação; a mesma pessoa, nao. Dois indices pelo mesmo motivo da SECAO 1:
-- NULL nao colide com NULL.
CREATE UNIQUE INDEX IF NOT EXISTS unique_subcategoria_do_catalogo
  ON public.transaction_subcategories (category_id, name)
  WHERE user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS unique_subcategoria_do_usuario
  ON public.transaction_subcategories (category_id, user_id, name)
  WHERE user_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_transaction_subcategories_updated_at
  ON public.transaction_subcategories;
CREATE TRIGGER update_transaction_subcategories_updated_at
  BEFORE UPDATE ON public.transaction_subcategories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.transaction_subcategories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_subcategories FORCE ROW LEVEL SECURITY;

-- Leitura: o catalogo (que inclui todo "Outros" global) e as minhas. Mesma
-- forma da categoria, e pelo mesmo motivo -- "Terapia" dentro de Saúde conta
-- sobre a pessoa tanto quanto uma categoria chamada "Terapia".
--
-- `anon` NAO ENTRA AQUI, e isto e diferente de transaction_categories.
--
-- A primeira versao desta migration dava `GRANT SELECT` a `anon` por simetria
-- com a tabela de categorias, e o db-verify reprovou -- com razao. O guard
-- "anon so pode ler as tabelas de referencia" existe porque a chave `anon` vai
-- EMBUTIDA no bundle JS publico: privilegio dela e dado aberto na internet.
--
-- `transaction_categories` e tabela de REFERENCIA de verdade -- as 13 linhas
-- sao as mesmas para todo mundo, e o formulario de cadastro monta o seletor
-- antes de resolver a sessao. Esta tabela nao e: ela guarda linha de usuario na
-- mesma relacao. Que a policy filtre `user_id IS NULL` nao muda o que o GRANT
-- diz, e um GRANT a `anon` numa tabela com dado de usuario e exatamente a
-- forma de erro que aquele guard foi escrito para pegar.
--
-- Nao se perde nada: subcategoria so e lida na tela de lancamento, que exige
-- sessao.
DROP POLICY IF EXISTS transaction_subcategories_read ON public.transaction_subcategories;
CREATE POLICY transaction_subcategories_read ON public.transaction_subcategories
  FOR SELECT TO authenticated
  USING (is_active = TRUE AND user_id IS NULL);

DROP POLICY IF EXISTS transaction_subcategories_read_own ON public.transaction_subcategories;
CREATE POLICY transaction_subcategories_read_own ON public.transaction_subcategories
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS transaction_subcategories_insert_own ON public.transaction_subcategories;
CREATE POLICY transaction_subcategories_insert_own ON public.transaction_subcategories
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS transaction_subcategories_update_own ON public.transaction_subcategories;
CREATE POLICY transaction_subcategories_update_own ON public.transaction_subcategories
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS transaction_subcategories_delete_own ON public.transaction_subcategories;
CREATE POLICY transaction_subcategories_delete_own ON public.transaction_subcategories
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.transaction_subcategories FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transaction_subcategories TO authenticated;

-- =====================================================
-- SECAO 5: O INVARIANTE "TODA CATEGORIA TEM 'OUTROS'"
-- =====================================================

-- O nome vive em uma constante so, aqui, porque ele e lido em tres lugares
-- (este trigger, o backfill da SECAO 6 e `lib/categorias.ts`) e um erro de
-- digitacao em um deles produziria DUAS subcategorias "Outros"/"outros" sem
-- erro nenhum -- o indice unico e sensivel a caixa.
CREATE OR REPLACE FUNCTION public.criar_subcategoria_outros()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- `WHERE NOT EXISTS` em vez de `ON CONFLICT`: as unicidades da tabela sao
  -- indices PARCIAIS, e indice parcial nao arbitra `ON CONFLICT`.
  INSERT INTO public.transaction_subcategories (category_id, user_id, name)
  SELECT NEW.id, NEW.user_id, 'Outros'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.transaction_subcategories s
     WHERE s.category_id = NEW.id
       AND s.user_id IS NOT DISTINCT FROM NEW.user_id
       AND s.name = 'Outros'
  );
  RETURN NULL;  -- AFTER trigger: o valor de retorno e ignorado.
END $$;

COMMENT ON FUNCTION public.criar_subcategoria_outros() IS
  'HMO-216: "por padrao toda categoria tem a subcategoria Outros". E trigger e '
  'nao codigo de rota para que categoria criada por migration tambem tenha.';

-- SECURITY INVOKER, entao NAO ha o problema de ACL das funcoes do 002: nada
-- aqui e avaliado dentro de policy. A funcao so e alcancavel pelo trigger.
DROP TRIGGER IF EXISTS criar_subcategoria_outros_trg ON public.transaction_categories;
CREATE TRIGGER criar_subcategoria_outros_trg
  AFTER INSERT ON public.transaction_categories
  FOR EACH ROW EXECUTE FUNCTION public.criar_subcategoria_outros();

-- =====================================================
-- SECAO 6: BACKFILL
-- =====================================================
-- O trigger da SECAO 5 so vale para categoria criada DEPOIS dele. As 13 que ja
-- existem (12 do 001 + a reservada da 023) precisam do "Outros" agora, senao a
-- tela abre com o seletor de subcategoria vazio para todas elas -- que e 100%
-- dos casos no dia do deploy.
--
-- Nao ha `WHERE user_id IS NULL`: se producao tiver categoria de usuario
-- criada entre esta migration e a anterior (nao tem como, mas o arquivo nao
-- deve depender disso), ela tambem recebe.
--
-- NOTA PARA QUEM FOR TESTAR: ao contrario do backfill da 027, ESTE e visivel
-- em banco criado do zero, e por um motivo especifico -- o trigger da SECAO 5
-- nasce nesta migration, DEPOIS das 13 linhas de seed do 001/023. Entao na
-- cadeia 001 -> ... -> 036 o backfill e o unico caminho para aquelas 13, e
-- apagar este bloco reprova o teste em banco limpo (medido: mutante
-- `sem_backfill` em scripts/mutantes-categorias.sh). Nao ha fixture
-- "antes da 036" a escrever: nao da para plantar categoria de usuario antes
-- desta migration, porque e ela que cria a coluna `user_id`.
INSERT INTO public.transaction_subcategories (category_id, user_id, name)
SELECT c.id, c.user_id, 'Outros'
  FROM public.transaction_categories c
 WHERE NOT EXISTS (
   SELECT 1 FROM public.transaction_subcategories s
    WHERE s.category_id = c.id
      AND s.user_id IS NOT DISTINCT FROM c.user_id
      AND s.name = 'Outros'
 );

-- =====================================================
-- SECAO 7: O LANCAMENTO APONTA PARA A SUBCATEGORIA
-- =====================================================
-- Tres tabelas, porque as tres sao caminhos pelos quais a MESMA tela grava:
-- despesa avulsa e no cartao vao para `financial_transactions`; despesa fixa
-- vira `recurring_rules` + `scheduled_transactions`. Deixar qualquer uma de
-- fora faria a tela aceitar a subcategoria e descartar em silencio.
--
-- `transaction_installments` fica de fora e isso e consciente: aquela tabela
-- nao tem leitor nenhum hoje (nada no app exibe parcela de la) e esta sendo
-- mexida pela HMO-211. Fica registrado como divida, nao como esquecimento.
--
-- ON DELETE SET NULL em `financial_transactions` seria uma ESCRITA na linha de
-- dinheiro -- dispararia `update_account_balance` e os triggers de grupo (ver
-- `on-delete-set-null-dispara-check`). Por isso o default (RESTRICT): apagar
-- subcategoria em uso e barrado, e o caminho de "excluir" na tela e
-- `is_active = FALSE`, que nao toca em lancamento nenhum.

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS subcategory_id uuid;
ALTER TABLE public.recurring_rules
  ADD COLUMN IF NOT EXISTS subcategory_id uuid;
ALTER TABLE public.scheduled_transactions
  ADD COLUMN IF NOT EXISTS subcategory_id uuid;

-- A FK COMPOSTA (o porque esta no cabecalho). Em loop sobre as tres tabelas
-- para que a definicao exista uma vez so: tres copias divergem na primeira vez
-- que alguem ajustar uma.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['financial_transactions', 'recurring_rules', 'scheduled_transactions']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = t || '_subcategoria_da_categoria'
         AND conrelid = ('public.' || t)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I '
        'FOREIGN KEY (category_id, subcategory_id) '
        'REFERENCES public.transaction_subcategories (category_id, id)',
        t, t || '_subcategoria_da_categoria'
      );
    END IF;

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (subcategory_id) '
      'WHERE subcategory_id IS NOT NULL',
      'idx_' || t || '_subcategory', t
    );
  END LOOP;
END $$;

COMMENT ON COLUMN public.financial_transactions.subcategory_id IS
  'Subcategoria do lancamento (036). NULL = sem subcategoria. A FK composta '
  'com category_id garante que ela pertence AQUELA categoria.';

COMMIT;

-- =====================================================
-- DEPOIS DE APLICAR
-- =====================================================
-- Confira as quatro coisas que importam (cole no SQL Editor):
--
--   -- 1. toda categoria tem "Outros"  -> esperado: 0
--   SELECT count(*) FROM transaction_categories c
--    WHERE NOT EXISTS (SELECT 1 FROM transaction_subcategories s
--                       WHERE s.category_id = c.id AND s.name = 'Outros');
--
--   -- 2. o aperto da policy entrou    -> esperado: contem 'user_id IS NULL'
--   SELECT qual FROM pg_policies
--    WHERE tablename = 'transaction_categories' AND policyname = 'transaction_categories_read';
--
--   -- 3. a FK composta esta VALIDADA  -> esperado: 3 linhas, convalidated = t
--   SELECT conrelid::regclass, convalidated FROM pg_constraint
--    WHERE conname LIKE '%_subcategoria_da_categoria';
--
--   -- 4. as tabelas novas tem GRANT   -> esperado: 4 linhas para authenticated
--   SELECT table_name, privilege_type FROM information_schema.role_table_grants
--    WHERE grantee = 'authenticated'
--      AND table_name IN ('transaction_subcategories', 'transaction_category_prefs');
--
-- O codigo que le isso e o da HMO-216; sem o deploy, a aplicacao desta
-- migration e inofensiva (colunas nulaveis, tabelas sem leitor).
-- =====================================================
