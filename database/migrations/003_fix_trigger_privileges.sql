-- =====================================================
-- 003 - CORRIGE OS TRIGGERS QUEBRADOS PELA RLS DO 002
-- =====================================================
-- Encontrado em 2026-09-21 (HMO-123) lendo o banco de producao pela primeira
-- vez, com o papel de leitura `paperclip_ro`.
--
-- O 002 ligou RLS nas tabelas derivadas e deu a elas SO policy de SELECT.
-- A intencao estava certa: user_balances, user_subscriptions, user_usage_limits
-- e subscription_history sao escritas pelo sistema, nunca pelo usuario.
--
-- O que passou batido e que quem faz essa escrita sao TRIGGERS, e os triggers
-- rodam com os privilegios de quem disparou a instrucao -- `authenticated`.
-- Entao eles batem na RLS da propria tabela que deveriam manter e derrubam a
-- transacao inteira do usuario.
--
-- Duas quebras confirmadas, ambas alcancaveis pelo app hoje:
--
--   1. Cadastro de usuario. `lib/hooks/useAuth.ts:101` insere em `profiles`
--      com o JWT do usuario -> trigger `create_user_subscription_trigger` ->
--      `create_free_subscription` tenta INSERT em `user_subscriptions`, onde
--      `authenticated` nao tem nem o grant de INSERT -> "permission denied".
--      A transacao inteira reverte: o usuario fica em auth.users mas sem
--      profile, sem assinatura e sem limites. E `useAuth.ts:106` so faz
--      console.error, entao o cadastro ainda parece ter dado certo na tela.
--
--   2. Aprovar uma divisao de despesa. `app/api/personal-finance/splits/route.ts:173`
--      faz UPDATE em `expense_splits` para status='approved' -> trigger
--      `update_balances_trigger` -> `update_user_balances` tenta INSERT em
--      `user_balances`, que so tem policy de SELECT -> violacao de RLS -> 500.
--
-- Uma terceira funcao tem o mesmo defeito mas nao esta quebrada hoje:
-- `update_usage_limits_on_plan_change` so dispara em UPDATE de
-- `user_subscriptions`, e `authenticated` nao tem grant de UPDATE ali -- so o
-- `service_role` muda plano, e ele tem BYPASSRLS. Fica corrigida junto porque
-- o dia em que existir troca de plano self-service ela quebra igual, e porque
-- o UPDATE dela em `user_usage_limits` falha do jeito pior: sob RLS um UPDATE
-- sem policy nao da erro, so afeta zero linhas. Os limites ficariam
-- silenciosamente errados.
--
-- A correcao e SECURITY DEFINER, nao policy de escrita nova: abrir INSERT/UPDATE
-- dessas tabelas para `authenticated` desfaria exatamente o que o 002 quis
-- fazer -- um usuario poderia forjar o proprio saldo ou o proprio plano.
-- SECURITY DEFINER mantem a tabela fechada para o usuario e deixa so o codigo
-- do trigger escrever.
--
-- `SET search_path` em cada funcao e obrigatorio junto com SECURITY DEFINER:
-- sem isso um objeto plantado num schema que venha antes no search_path do
-- chamador seria executado com os privilegios do dono da funcao.

BEGIN;

-- 1. Cadastro: cria assinatura free e limites de uso.
ALTER FUNCTION public.create_free_subscription()
  SECURITY DEFINER
  SET search_path = public, pg_temp;

-- 2. Aprovacao de divisao: mantem o saldo entre credor e devedor.
ALTER FUNCTION public.update_user_balances()
  SECURITY DEFINER
  SET search_path = public, pg_temp;

-- 3. Troca de plano: ajusta limites e grava o historico.
ALTER FUNCTION public.update_usage_limits_on_plan_change()
  SECURITY DEFINER
  SET search_path = public, pg_temp;

-- SECURITY DEFINER faz a funcao rodar como o dono dela. Estas sao chamadas
-- so por trigger, entao ninguem precisa de EXECUTE direto: revogar de PUBLIC
-- evita que virem uma porta para escrever nas tabelas derivadas fora do fluxo
-- do trigger.
REVOKE EXECUTE ON FUNCTION public.create_free_subscription() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_user_balances() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_usage_limits_on_plan_change() FROM PUBLIC;

COMMIT;

-- =====================================================
-- VERIFICACAO (rodar depois do COMMIT)
-- =====================================================
-- Deve voltar as tres funcoes com prosecdef = true:
--
--   SELECT p.proname, p.prosecdef, p.proconfig
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('create_free_subscription', 'update_user_balances',
--                       'update_usage_limits_on_plan_change');
--
-- E `scripts/db-introspect.sh` (passo 7/7) deve voltar a imprimir
-- "ok: nenhum trigger escrevendo em tabela sem policy de escrita".
--
-- =====================================================
-- O QUE ESTA MIGRATION NAO RESOLVE
-- =====================================================
-- Os usuarios que se cadastraram enquanto o bug estava em producao ficaram
-- sem profile/assinatura/limites. Corrigir os triggers nao cria essas linhas
-- retroativamente -- isso e backfill e esta separado, na issue filha do HMO-123,
-- porque precisa primeiro medir quantos usuarios em auth.users nao tem profile.
