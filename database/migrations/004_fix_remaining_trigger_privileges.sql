-- =====================================================
-- 004 - O RESTO DA QUEDA DO 002: MAIS DOIS TRIGGERS
-- =====================================================
-- Encontrado em 2026-09-21 (HMO-125), rodando os fluxos quebrados como
-- `authenticated` de verdade no projeto de validacao. O HMO-123 tinha provado
-- a cadeia por catalogo; o papel `paperclip_ro` e so-leitura e nao deixa rodar
-- um INSERT de teste. Com o `postgres` do projeto de validacao deu para
-- executar, e a execucao mostrou duas coisas que a leitura de catalogo nao
-- mostrou.
--
-- 1. O 003 NAO conserta a aprovacao de divisao.
--
--    `update_user_balances` e um AFTER trigger. Antes dele roda
--    `calculate_split_amount`, um BEFORE INSERT OR UPDATE na mesma tabela,
--    tambem em SECURITY INVOKER. Ele faz:
--
--        SELECT ABS(amount) * (NEW.percentage / 100.0) INTO NEW.amount
--        FROM financial_transactions WHERE id = NEW.transaction_id;
--
--    Quem aprova a divisao e o PARTICIPANTE, e a policy de SELECT de
--    `financial_transactions` so mostra a despesa para o dono dela (ou para
--    membro do grupo, mas despesa pessoal nao tem grupo). O SELECT ... INTO
--    nao acha linha, deixa NEW.amount NULL, e a aprovacao morre no NOT NULL
--    de `expense_splits.amount` -- 23502, nao 42501.
--
--    Ou seja: com so o 003 aplicado, aprovar divisao continua dando 500. O
--    erro muda de codigo e o sintoma fica igual.
--
-- 2. Criar grupo de despesa tambem esta quebrado, e o 003 nem encosta nisso.
--
--    `add_group_creator` (AFTER INSERT em `expense_groups`) insere o criador
--    em `group_members` como admin. A policy de INSERT de `group_members` exige
--    `is_group_admin(group_id)`, que consulta `group_members`. No instante em
--    que o trigger roda o criador ainda nao e membro, entao a checagem e
--    circular e sempre falha: 42501, "new row violates row-level security
--    policy for table group_members".
--
-- Os outros triggers em SECURITY INVOKER foram testados no mesmo lote e
-- passaram -- `set_group_code`, `auto_create_group_transaction`,
-- `sync_transaction_with_group`, `calculate_equal_split`,
-- `update_account_balance` e `update_updated_at_column`. Escrevem em tabelas
-- onde o proprio usuario tem grant e policy que da certo. Ficam como estao.
--
-- Reproducao: scripts/hmo125-prove-003.sql e scripts/hmo125-audit-triggers.sql.
-- Os dois rodam dentro de uma transacao que termina em ROLLBACK.
--
-- PRE-REQUISITO: aplicar o 003 antes deste.

BEGIN;

-- 1. Aprovacao/rejeicao de divisao: recalcula o valor lendo a despesa do dono.
--    Precisa enxergar `financial_transactions` de quem nao e o chamador.
ALTER FUNCTION public.calculate_split_amount()
  SECURITY DEFINER
  SET search_path = public, pg_temp;

-- 2. Criacao de grupo: insere o criador como admin antes de ele ser membro.
--    Nao ha risco de forjar dono aqui: a policy de INSERT de `expense_groups`
--    tem WITH CHECK (created_by = auth.uid()), entao quando o trigger roda o
--    NEW.created_by ja esta preso ao chamador. O SECURITY DEFINER so cobre a
--    checagem circular de `group_members`, nao afrouxa quem pode criar grupo.
ALTER FUNCTION public.add_group_creator()
  SECURITY DEFINER
  SET search_path = public, pg_temp;

-- Sao chamadas so por trigger; ninguem precisa de EXECUTE direto.
-- Vale a mesma ressalva do 003: isto tira PUBLIC, nao os grants explicitos que
-- o Supabase da a `anon`/`authenticated`/`service_role`. Quem impede a chamada
-- direta e o tipo de retorno `trigger`. Detalhe completo no 003.
REVOKE EXECUTE ON FUNCTION public.calculate_split_amount() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_group_creator() FROM PUBLIC;

COMMIT;

-- =====================================================
-- VERIFICACAO (rodar depois do COMMIT)
-- =====================================================
--   SELECT p.proname, p.prosecdef, p.proconfig
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('calculate_split_amount', 'add_group_creator');
--
-- As duas com prosecdef = true e search_path setado.
--
-- =====================================================
-- O QUE ESTA MIGRATION NAO RESOLVE
-- =====================================================
-- `expense_splits_update` deixa o participante dar UPDATE na propria linha sem
-- travar `transaction_id` nem `percentage`. Com `calculate_split_amount` em
-- SECURITY DEFINER, um participante que ADIVINHE o UUID de uma despesa alheia
-- pode repontar a divisao para ela e ler o valor recalculado em NEW.amount.
-- O UUID e v4 e nao da para enumerar, entao nao e porta aberta -- mas a policy
-- deveria congelar essas duas colunas. Fica como issue separada: e mudanca de
-- policy, nao de privilegio de funcao, e nao cabe no escopo deste fix.
