-- =====================================================
-- BACKFILL: quem se cadastrou enquanto o cadastro estava quebrado
-- =====================================================
-- Cole no SQL Editor do Supabase, no projeto de PRODUCAO, DEPOIS da migration
-- 003 (que ja esta aplicada desde 21/09). Rodar antes do 003 nao adianta: sem
-- ela o proprio INSERT abaixo seria revertido pelo mesmo bug.
--
-- POR QUE ISTO EXISTE
-- -------------------
-- Enquanto os triggers estavam em SECURITY INVOKER, todo cadastro novo revertia
-- a criacao da linha em `profiles`. O usuario ficava em `auth.users` SEM
-- profile -- e, por consequencia, sem `user_subscriptions` e sem
-- `user_usage_limits`, porque as duas nascem de um trigger AFTER INSERT ON
-- profiles. A migration 003 faz o fluxo voltar a funcionar daqui para frente;
-- ela NAO repara quem ja passou por ali. Este arquivo repara.
--
-- POR QUE NAO E UMA MIGRATION
-- ---------------------------
-- Nao muda schema: e conserto de dado, uma vez so. Uma migration tambem roda no
-- banco de validacao do CI, onde `auth.users` e um arquivo de mentirinha com
-- tres colunas (`database/tests/00_supabase_shim.sql`) -- o backfill nao teria o
-- que reparar la, e o step verde nao provaria nada.
--
-- POR QUE E SEGURO RODAR AS TRES PARTES DE UMA VEZ
-- ------------------------------------------------
-- A PARTE 2 e um `INSERT ... WHERE NOT EXISTS`: com zero orfaos ela grava zero
-- linhas. Rodar duas vezes tambem nao duplica nada, pela mesma razao. Se voce
-- preferir olhar antes de escrever, rode so a PARTE 1 -- ela e somente-leitura.
--
-- DUAS COISAS QUE PARECEM RISCO E NAO SAO
-- ---------------------------------------
-- 1. RLS. `profiles` tem RLS ligada, mas NAO tem FORCE ROW LEVEL SECURITY, e o
--    papel `postgres` -- o do SQL Editor -- tem `rolbypassrls`. O INSERT passa.
--    (Conferido em producao em 29/09; se algum dia isso mudar, o sintoma e
--    "0 linhas inseridas" com a PARTE 3 continuando a acusar orfaos.)
-- 2. Colisao com assinatura que ja exista. Nao e possivel:
--    `user_subscriptions.user_id` e `user_usage_limits.user_id` sao FK para
--    `profiles(id)`. Sem profile nao pode haver assinatura, entao os INSERT
--    incondicionais que o trigger faz nao tem com o que conflitar.
--
-- O QUE O BACKFILL GRAVA
-- ----------------------
-- As mesmas tres colunas que o cadastro grava hoje (`lib/ensure-profile.ts`):
-- `id`, `email` e `full_name`. O nome sai de `raw_user_meta_data->>'full_name'`,
-- que e para onde o `signUp` manda o que a pessoa digitou no formulario. Nome
-- em branco vira NULL e nao string vazia -- e o que a coluna espera, e e o que
-- o app grava no caminho normal.
--
-- Contas apagadas ficam de fora (`deleted_at IS NULL`): o apagar do Supabase e
-- logico, a linha continua em `auth.users`, e criar perfil para ela seria
-- ressuscitar conta que alguem mandou apagar.
--
-- A UNICA COISA AQUI QUE NAO FOI CONFERIDA CONTRA PRODUCAO
-- --------------------------------------------------------
-- As colunas `deleted_at` e `raw_user_meta_data`. O papel `paperclip_ro` nao le
-- o schema `auth` (as tabelas sao do `supabase_auth_admin`), entao nao deu para
-- confirmar que elas existem neste projeto -- sao colunas padrao do GoTrue, mas
-- "padrao" nao e "verificado". Se o SQL Editor responder `column ... does not
-- exist`, nada foi gravado (as tres partes falham antes de escrever): apague as
-- duas linhas `deleted_at IS NULL` e troque a expressao do nome por `NULL`, e o
-- backfill continua correto -- so para de distinguir conta apagada e de
-- aproveitar o nome do formulario.
--
-- COMO ESTE ARQUIVO FOI TESTADO
-- -----------------------------
-- Num Postgres 17 local, sobre `00_supabase_shim.sql` + migrations 001 a 004, e
-- colado como UM buffer unico (`psql -c "$(cat ...)"`, que e o que reproduz o
-- SQL Editor -- `psql -f` aceita coisa que o Editor recusa). Quatro usuarios:
-- um ja com perfil e nome editado na tela, dois orfaos, um orfao apagado.
-- Resultado: os dois orfaos ganharam perfil, o nome editado NAO foi
-- sobrescrito, nome so de espacos virou NULL, a conta apagada ficou de fora,
-- cada perfil novo saiu com exatamente uma assinatura e um limite de uso, e a
-- segunda execucao gravou `INSERT 0 0`.


-- -----------------------------------------------------------------
-- PARTE 1 -- MEDIR (somente leitura)
-- -----------------------------------------------------------------
-- Se `orfaos` der 0, acabou: nao ha nada a reparar e as PARTES 2 e 3 nao
-- mudam nada. `total_usuarios` esta junto de proposito, para a resposta nao ser
-- so um zero sem contexto -- zero orfaos em zero usuarios e outra conversa.
SELECT
  (SELECT count(*) FROM auth.users WHERE deleted_at IS NULL) AS total_usuarios,
  (SELECT count(*) FROM public.profiles)                     AS total_perfis,
  count(*)                                                   AS orfaos
FROM auth.users u
WHERE u.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);


-- -----------------------------------------------------------------
-- PARTE 2 -- REPARAR
-- -----------------------------------------------------------------
-- `create_user_subscription_trigger` dispara AFTER INSERT ON profiles e cria a
-- assinatura gratuita e os limites de uso sozinho, um par por linha inserida
-- aqui. Popular as outras duas tabelas na mao seria errado: geraria conflito
-- com o que o trigger acabou de gravar.
INSERT INTO public.profiles (id, email, full_name)
SELECT
  u.id,
  u.email,
  NULLIF(btrim(COALESCE(u.raw_user_meta_data ->> 'full_name', '')), '')
FROM auth.users u
WHERE u.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);


-- -----------------------------------------------------------------
-- PARTE 3 -- CONFERIR
-- -----------------------------------------------------------------
-- As quatro contagens tem que bater. `orfaos_restantes` e a coluna que importa:
-- ela tem que ser 0. As outras tres batendo entre si mostram que o trigger
-- realmente correu atras de cada perfil novo -- se `perfis` subiu e `assinaturas`
-- nao, o 003 nao esta aplicado neste banco e o INSERT acima foi revertido.
SELECT
  (SELECT count(*) FROM auth.users WHERE deleted_at IS NULL) AS usuarios,
  (SELECT count(*) FROM public.profiles)                     AS perfis,
  (SELECT count(*) FROM public.user_subscriptions)           AS assinaturas,
  (SELECT count(*) FROM public.user_usage_limits)            AS limites,
  (
    SELECT count(*)
    FROM auth.users u
    WHERE u.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
  ) AS orfaos_restantes;
