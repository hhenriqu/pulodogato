-- ===========================================================================
-- 059 -- O ELO CONTA DE INVESTIMENTO <-> ATIVO (HMO-432, fase 1 de 6)
-- ===========================================================================
-- "adicionar meus investimentos atrelados a Conta Investimento".
--
-- O PROBLEMA, LITERAL: `investment_assets` nao tem `account_id`. A carteira de
-- investimentos (021) e as contas de `financial_accounts` com
-- `account_type = 'investment'` sao dois mundos que nunca se falam. Da para
-- cadastrar PETR4 e da para cadastrar uma conta "Clear", mas nao ha nenhuma
-- coluna no banco que diga que aquele PETR4 esta NAQUELA conta -- entao o
-- pedido da issue-mae e, hoje, impossivel de atender.
--
-- O QUE ESTA MIGRATION FAZ, E SO ISSO: a coluna, a FK, a trava e o indice.
-- Nenhuma view e recolada, nenhum valor de dinheiro muda, nenhum backfill.
-- Quem le `account_id` e o codigo do app, num PR que vem DEPOIS deste.
--
-- ===========================================================================
-- POR QUE A COLUNA E NULAVEL -- E POR QUE NAO HA BACKFILL
-- ===========================================================================
-- Nulavel nao e preguica: e o que deixa os ativos que JA existem em producao
-- continuarem validos. `NOT NULL` aqui exigiria um valor para cada ativo ja
-- cadastrado, e esse valor teria de ser adivinhado.
--
-- E adivinhar aqui MOVE DINHEIRO DE LUGAR SEM NENHUM SINTOMA. Um backfill do
-- tipo "aponte todo ativo para a primeira conta de investimento do dono" sai
-- com codigo 0, nao emite um aviso, e no dia em que a Fase 2 subir a tela mostra
-- o saldo da corretora A dentro da corretora B. Quem tem DUAS contas de
-- investimento -- que e o caso normal de quem pediu esta feature -- recebe um
-- numero errado em cada uma das duas, e nenhuma linha do banco esta "invalida"
-- para alguem notar.
--
-- `NULL` quer dizer "ativo solto": existe na carteira, soma no patrimonio pelo
-- caminho que ja existe, e nao esta atrelado a conta nenhuma. E o estado de
-- TODO ativo de producao no instante em que este arquivo e colado, e ele e um
-- estado legitimo e permanente -- nao um "pendente de migracao". Quem atrela e
-- a pessoa, na tela da Fase 3.
--
-- Isso faz da coluna uma booleana de tres estados? Nao -- e a armadilha de
-- `coluna-booleana-anulavel-not-is-false`, e ela nao se aplica: `account_id` nao
-- e um sinalizador de sim/nao, e uma referencia. `NULL` tem UM significado
-- ("sem conta"), nao dois, e todo leitor da Fase 2 recorta por
-- `account_id = <uuid>`, que descarta o `NULL` pelo caminho certo.
--
-- ===========================================================================
-- A TRAVA E TRIGGER, E NAO CHECK
-- ===========================================================================
-- A regra e "a conta tem de ser do MESMO DONO e ter
-- `account_type = 'investment'`". As duas metades sao subconsulta -- elas vivem
-- noutra tabela --, e CHECK nao aceita subconsulta. Precedente pronto no repo:
-- `mybank_loans_trava` (053) trava exatamente esta mesma condicao para o
-- MyBank, e este arquivo copia a forma dela.
--
-- POR QUE A FK NAO FAZ A METADE DO DONO SOZINHA
-- ---------------------------------------------
-- A tentacao e uma FK COMPOSTA para `financial_accounts (id, user_id)`: ela
-- travaria o mesmo-dono declarativamente, sem trigger. Nao da, e a razao e o
-- `ON DELETE SET NULL`: numa FK composta ele zera TODAS as colunas da
-- referencia, inclusive `user_id` -- que e `NOT NULL`. Apagar uma conta de
-- investimento passaria a estourar `23502` em vez de soltar o ativo. A FK e
-- simples, para `financial_accounts (id)`, e quem confere o dono e a trigger.
--
-- POR QUE A TRIGGER TOLERA `NULL`, E ISSO NAO E FROUXIDAO
-- ------------------------------------------------------
-- O `ON DELETE SET NULL` dispara a trigger: apagar a conta vira um UPDATE de
-- `investment_assets` que grava `account_id = NULL`. Uma trava que exigisse
-- conta valida nesse instante recusaria o proprio UPDATE do `SET NULL` e o
-- `DELETE` da conta ficaria impossivel -- a pessoa nao conseguiria mais apagar
-- uma conta de investimento, com erro de `check_violation` vindo de uma tabela
-- que ela nem mencionou. Por isso o `IS NULL` sai PRIMEIRO na funcao, antes de
-- qualquer consulta.
--
-- POR QUE `SECURITY DEFINER`
-- --------------------------
-- `financial_accounts` tem RLS. Com direitos de invocador, a trava responderia
-- "esta conta nao existe" para toda linha que a RLS esconde do escritor do
-- momento -- e o risco aqui e de recusa FALSA, nao de aceitacao falsa: um
-- caminho de servidor (ou uma cadeia de trigger rodando por outro usuario)
-- levaria `check_violation` num elo legitimo. O mesmo cuidado de
-- `is_group_member` e de `mybank_loans_trava`.
--
-- E isso NAO abre a porta para atrelar o ativo a conta de outra pessoa: a
-- consulta exige `a.user_id = NEW.user_id`, e `NEW.user_id` ja esta preso a
-- `auth.uid()` pelas policies `investment_assets_insert` e
-- `investment_assets_update` do 021 -- as duas, e a de UPDATE nos dois lados
-- (`USING` e `WITH CHECK`), que e o que impede trocar o dono da linha. A trava
-- compara a conta com o dono DA LINHA, nunca com `auth.uid()`; e por isso que
-- ela continua certa quando quem escreve nao e o dono.
--
-- A funcao e revogada de `PUBLIC`, `anon` e `authenticated` no fim do arquivo:
-- funcao `SECURITY DEFINER` alcancavel por `anon` e
-- `funcao-do-baseline-sem-revoke-roda-por-anon`.
--
-- ===========================================================================
-- O INDICE E CHEIO, NAO PARCIAL
-- ===========================================================================
-- A Fase 2 recorta por `account_id = <uuid>`, e um indice parcial
-- `WHERE account_id IS NOT NULL` serviria. Fica cheio de proposito: a mesma
-- Fase 2 precisa da lista dos ativos SOLTOS (`account_id IS NULL`) para a tela
-- oferecer "atrelar", e o B-tree do Postgres indexa `NULL` -- um indice parcial
-- deixaria justamente essa leitura sem suporte. Ele tambem nao e arbitro de
-- nenhum `ON CONFLICT` (ver `indice-parcial-nao-arbitra-on-conflict`), entao
-- nao ha o segundo motivo para ser cheio; o primeiro basta.
--
-- ===========================================================================
-- IDEMPOTENTE
-- ===========================================================================
-- Re-rodar o arquivo inteiro e no-op. Cada objeto tem o seu par:
--   - a coluna, por `ADD COLUMN IF NOT EXISTS`;
--   - a FK, por `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` (nao existe
--     `ADD CONSTRAINT IF NOT EXISTS` no Postgres);
--   - o indice, por `CREATE INDEX IF NOT EXISTS`;
--   - a funcao, por `CREATE OR REPLACE`;
--   - a trigger, por `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`.
--
-- E nada neste arquivo ESCREVE em `investment_assets`. Nao ha `UPDATE`, entao
-- re-colar o arquivo nao pode mexer no elo que a pessoa escolheu nem religar o
-- que ela desligou. Producao recebe migration por colagem a mao e colar duas
-- vezes acontece; aqui o re-run tem um segundo papel, que e alimentar as secoes
-- 5 e 6 da suite.
--
-- ===========================================================================
-- ADITIVA: COLAR ESTE ARQUIVO COM O CODIGO DE HOJE NO AR E INOFENSIVO
-- ===========================================================================
-- Nenhum arquivo do repositorio nomeia `investment_assets.account_id` no
-- momento em que esta migration vai para a `main` -- ela vai SOZINHA, na frente
-- do codigo, que e o que `migration-tem-que-ir-para-main-sozinha` exige.
--
-- A direcao INVERSA e que e perigosa, e e o bloqueador da Fase 2: uma rota que
-- nomeie `account_id` num `.select()` ANTES da colagem derruba a rota inteira
-- com `42703` e HTTP 500 -- nao degrada, nao devolve campo vazio. Ver
-- `select-que-nomeia-coluna-nova-derruba-a-rota-antes-da-colagem`.
--
-- Consequencias de colar antes do codigo:
--   - `SELECT *` na carteira passa a devolver um campo a mais, sempre `NULL`.
--     O cliente ignora campo que nao conhece, e o tipo `InvestmentAsset` ainda
--     nao o declara.
--   - Nenhuma view depende de `investment_assets` (medido no catalogo), entao
--     nao ha `CREATE OR REPLACE VIEW` aqui e nenhum `reloptions`/
--     `security_invoker` corre risco de ser apagado.
--   - A RLS nao precisa de nada: `investment_assets` ja tem as quatro policies
--     por `user_id` (021), e policy vale para a linha inteira, nao por coluna.
--
-- ===========================================================================
-- CONFERENCIA EM PRODUCAO, DEPOIS DE COLAR
-- ===========================================================================
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'investment_assets'
--      AND column_name = 'account_id';
--   -- uma linha: account_id / uuid / YES
--
--   SELECT conname, confdeltype FROM pg_constraint
--    WHERE conname = 'investment_assets_account_id_fkey';
--   -- confdeltype = 'n'  (SET NULL)
--
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.investment_assets'::regclass
--      AND NOT tgisinternal;
--   -- inclui investment_assets_conta_trava
--
--   SELECT md5(prosrc) FROM pg_proc WHERE proname = 'investment_assets_conta_trava';
--
--   SELECT count(*) FROM public.investment_assets WHERE account_id IS NOT NULL;
--   -- tem de dar 0 logo depois da colagem: esta migration nao atrela nada.
--
-- As quatro primeiras leem o CATALOGO, entao funcionam pela credencial RO
-- (catalogo nao tem RLS). A ultima NAO funciona por ela -- `investment_assets`
-- tem RLS e a RO nao tem BYPASSRLS, e `count(*)` sairia 0 tanto pela migration
-- estar certa quanto pela RLS estar escondendo tudo
-- (`count-pela-credencial-ro-le-zero-onde-a-rls-esconde`). Rode-a pelo SQL
-- Editor, que e superusuario.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. PREFLIGHT: do que esta migration depende
-- ---------------------------------------------------------------------------
-- Tudo antes do primeiro ALTER, para a colagem morrer com uma frase em vez de
-- um erro de FK no meio. Nenhum item aqui e decorativo: os dois sao
-- referenciados abaixo.
DO $$
DECLARE
  problemas text := '';
BEGIN
  IF to_regclass('public.investment_assets') IS NULL THEN
    problemas := problemas || E'\n  - public.investment_assets nao existe (021); e a tabela que recebe a coluna';
  END IF;

  IF to_regclass('public.financial_accounts') IS NULL THEN
    problemas := problemas || E'\n  - public.financial_accounts nao existe (001); e o destino da FK e da trava';
  END IF;

  -- A trava compara com o literal 'investment'. Se o enum `account_type` nao
  -- tiver esse valor, a comparacao estoura `22P02` dentro da trigger -- no
  -- INSERT de um ativo, e nao aqui. Melhor morrer na colagem.
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
     WHERE t.typname = 'account_type' AND e.enumlabel = 'investment'
  ) THEN
    problemas := problemas || E'\n  - o enum account_type nao tem o valor ''investment''; a trava desta migration o compara';
  END IF;

  IF problemas <> '' THEN
    RAISE EXCEPTION 'A migration 059 nao pode ser aplicada neste banco:%', problemas;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. A COLUNA
-- ---------------------------------------------------------------------------
-- Sem `DEFAULT` e sem `NOT NULL`: toda linha existente fica `NULL`, que e
-- "ativo solto" -- o estado correto para quem nunca escolheu conta. Ver o
-- bloco "POR QUE A COLUNA E NULAVEL" no cabecalho.
ALTER TABLE public.investment_assets
    ADD COLUMN IF NOT EXISTS account_id uuid;

COMMENT ON COLUMN public.investment_assets.account_id IS
    'HMO-432: a conta de investimento (financial_accounts, account_type = investment) em que este ativo esta custodiado. NULAVEL de proposito -- NULL e "ativo solto", um estado legitimo e permanente, e e como fica todo ativo que ja existia quando esta migration foi colada. Nao ha backfill: adivinhar a conta de quem tem duas corretoras move dinheiro de lugar sem nenhum sintoma. A trigger investment_assets_conta_trava exige conta do MESMO dono e de investimento -- trigger e nao CHECK porque CHECK nao aceita subconsulta. Ver o cabecalho da migration 059.';

-- ---------------------------------------------------------------------------
-- 3. A FK, COM `ON DELETE SET NULL`
-- ---------------------------------------------------------------------------
-- `SET NULL` e nao `CASCADE`: apagar a conta tem de SOLTAR o ativo, nunca
-- apaga-lo. O ativo carrega o historico de movimentacoes (`investment_transactions`,
-- pela FK composta do 021) e e dele que sai o preco medio -- `CASCADE` aqui
-- apagaria a posicao e o historico de quem so quis arrumar a lista de contas.
--
-- Par idempotente: nao existe `ADD CONSTRAINT IF NOT EXISTS` no Postgres, e o
-- `DROP ... IF EXISTS` antes e o que deixa o arquivo re-executavel. O nome e
-- cravado (e nao deixado ao gerador do Postgres) para que o `DROP` encontre
-- exatamente a constraint que este arquivo criou.
ALTER TABLE public.investment_assets
    DROP CONSTRAINT IF EXISTS investment_assets_account_id_fkey;

ALTER TABLE public.investment_assets
    ADD CONSTRAINT investment_assets_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES public.financial_accounts (id)
    ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 4. A TRAVA: conta do mesmo dono, e de investimento
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.investment_assets_conta_trava()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- `NULL` = ativo solto, e e ACEITO. Esta clausula sai primeiro de proposito:
  -- e por ela que passa o UPDATE que o `ON DELETE SET NULL` gera quando a conta
  -- e apagada. Sem ela, apagar uma conta de investimento seria impossivel.
  IF NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- No UPDATE que nao mexe em nenhuma das duas colunas da trava, nada a
  -- conferir. `IS NOT DISTINCT FROM` e nao `=`: com `NULL` de um lado, `=` vale
  -- `NULL` (que nao e TRUE) e a mudanca passaria batida.
  --
  -- A janela existe para que mexer no preco, no nome ou na data de vencimento
  -- de um ativo ja atrelado nao re-pergunte nada ao catalogo -- e, mais que
  -- isso, para que um ativo atrelado a uma conta que DEIXOU de ser de
  -- investimento continue editavel: sem ela, trocar o tipo da conta trancaria
  -- todo ativo pendurado nela, e a unica saida seria mexer no banco a mao. E a
  -- mesma janela que o `mybank_loans_trava` abre, e pela mesma razao.
  IF TG_OP = 'UPDATE'
     AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id
     AND NEW.user_id    IS NOT DISTINCT FROM OLD.user_id
  THEN
    RETURN NEW;
  END IF;

  -- As duas condicoes numa consulta so, e a mensagem de erro nao distingue
  -- "nao e sua" de "nao e de investimento" de proposito: dizer "a conta <uuid>
  -- nao e sua" para um id que existe e e de outra pessoa confirmaria a
  -- existencia daquela conta para quem chutou o uuid.
  IF NOT EXISTS (
    SELECT 1 FROM public.financial_accounts a
     WHERE a.id = NEW.account_id
       AND a.user_id = NEW.user_id
       AND a.account_type = 'investment'
  ) THEN
    RAISE EXCEPTION 'Investimentos: a conta do ativo tem de ser uma conta de investimento do proprio dono (conta %)', NEW.account_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.investment_assets_conta_trava() IS
    'HMO-432: a conta de investment_assets.account_id tem de ser do MESMO dono do ativo e ter account_type = investment. Trigger e nao CHECK porque CHECK nao aceita subconsulta. Tolera NULL (ativo solto) na PRIMEIRA clausula, e e por ela que passa o UPDATE do ON DELETE SET NULL -- sem isso, apagar uma conta de investimento seria impossivel. SECURITY DEFINER com search_path fixo porque a RLS de financial_accounts esconderia a conta de um escritor que nao e o dono e a trava recusaria um elo legitimo; nao afrouxa nada, porque a consulta compara com NEW.user_id (preso a auth.uid() pelas policies do 021) e nunca com auth.uid(). No UPDATE so re-valida se account_id ou user_id mudou. Ver o cabecalho da migration 059.';

DROP TRIGGER IF EXISTS investment_assets_conta_trava ON public.investment_assets;
CREATE TRIGGER investment_assets_conta_trava
    BEFORE INSERT OR UPDATE ON public.investment_assets
    FOR EACH ROW EXECUTE FUNCTION public.investment_assets_conta_trava();

-- Funcao `SECURITY DEFINER` nao pode ficar alcancavel pela chave publica.
-- A trigger a chama pelo dono da tabela, e nao pelo privilegio de quem
-- escreve, entao revogar nao a desliga -- ver `trigger-invoker-nao-chama-funcao-revogada`
-- para o caso em que isso IMPORTA (funcao chamada direto).
REVOKE ALL ON FUNCTION public.investment_assets_conta_trava() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. O INDICE
-- ---------------------------------------------------------------------------
-- A Fase 2 recorta a carteira por conta. Cheio, nao parcial: ver o cabecalho.
CREATE INDEX IF NOT EXISTS investment_assets_account_id_idx
    ON public.investment_assets (account_id);

COMMIT;
