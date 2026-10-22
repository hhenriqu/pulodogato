-- ===========================================================================
-- 065 -- APAGAR O LANCAMENTO QUE QUITOU A PREVISTA DEVOLVE A PREVISTA
-- ===========================================================================
-- Metade de BANCO do conserto da despesa contada duas vezes no dashboard. A
-- metade de app e a rota `POST /api/scheduled-transactions/{id}/vincular`, que
-- marca a conta prevista `paid` apontando para um lancamento que JA EXISTE (o
-- aluguel que a pessoa lancou a mao antes de dar baixa). Ver
-- lib/vinculo-da-prevista.ts para a regra.
--
-- O QUE FALTAVA NO BANCO
-- ----------------------
-- `scheduled_transactions.transaction_id` e FK com ON DELETE SET NULL
-- (005:217), e `scheduled_transactions_paid_check` (005:208) exige
-- `transaction_id` NAO NULO quando `status = 'paid'`. Juntas, as duas fazem o
-- DELETE do lancamento que quitou uma prevista FALHAR: o SET NULL produz a linha
-- que o check proibe. Ate aqui isso so alcancava quem apagava o lancamento
-- criado pelo `/pay` por fora do estorno -- raro. Com o vinculo, o lancamento
-- quitante e um lancamento COMUM, que a pessoa apaga pela lista como qualquer
-- outro, e o erro de constraint chegaria na cara dela.
--
-- O conserto e o mesmo molde do extrato (009, secao 3,
-- `statement_entry_release_on_transaction_delete`): um trigger BEFORE DELETE
-- que devolve a prevista para `pending` antes da FK agir. BEFORE e nao AFTER
-- pelo motivo escrito la: o SET NULL roda junto com o DELETE, e um AFTER
-- encontraria `transaction_id` ja nulo.
--
-- O QUE FICA DE FORA, DE PROPOSITO: TRANSFERENCIA
-- -----------------------------------------------
-- Fatura de cartao, transferencia prevista e parcela do MyBank dao baixa com
-- DUAS pernas `transfer`, e a prevista aponta para a de saida. O estorno delas
-- e o `DELETE .../pay`, que apaga as duas pernas na ordem certa e devolve a
-- parcela do MyBank. Soltar a prevista quando so UMA perna e apagada deixaria a
-- outra no saldo e a parcela `paid` -- pior do que a recusa de hoje. Entao o
-- trigger so age em lancamento que NAO e `transfer`; para esses, o DELETE
-- continua recusado pelo check, exatamente como antes desta migration. A rota
-- de vincular tambem recusa fatura e transferencia, entao nenhum vinculo novo
-- cai nesse caso.
--
-- O PASSO HUMANO
-- --------------
-- Colar no SQL Editor do Supabase depois do merge. A migration e ADITIVA (uma
-- funcao e um trigger) e re-executavel. Antes de colar, o `/vincular` funciona;
-- so o "apagar o lancamento vinculado" e que responde erro de constraint ate a
-- colagem.
-- ===========================================================================

-- ===========================================================================
-- SECAO 1: PREFLIGHT
-- ===========================================================================
DO $$
DECLARE
  v_faltando text := '';
BEGIN
  IF to_regclass('public.scheduled_transactions') IS NULL THEN
    v_faltando := v_faltando || E'\n  - tabela public.scheduled_transactions (vem do 005)';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'scheduled_transactions_paid_check'
       AND conrelid = 'public.scheduled_transactions'::regclass
  ) THEN
    v_faltando := v_faltando || E'\n  - constraint scheduled_transactions_paid_check (vem do 005)';
  END IF;

  IF to_regclass('public.financial_transactions') IS NULL THEN
    v_faltando := v_faltando || E'\n  - tabela public.financial_transactions (vem do 001)';
  END IF;

  IF v_faltando <> '' THEN
    RAISE EXCEPTION E'065 nao pode ser aplicado neste banco. Faltando:%\n\nRode 001 -> ... -> 064 antes.', v_faltando;
  END IF;
END $$;

-- ===========================================================================
-- SECAO 2: A FUNCAO E O TRIGGER
-- ===========================================================================
-- SECURITY DEFINER e search_path fixo pelo mesmo motivo do 009: o trigger roda
-- como `authenticated`, e a prevista de grupo pode ter sido criada pela regra do
-- dono -- a policy de UPDATE do 005 e `user_id = auth.uid()`. Quem apaga o
-- lancamento e o dono dele, e a rota de vincular so aceita lancamento do mesmo
-- dono da prevista; o DEFINER garante que o trigger nao depende disso.
CREATE OR REPLACE FUNCTION public.scheduled_release_on_transaction_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.transaction_type IS DISTINCT FROM 'transfer' THEN
    UPDATE public.scheduled_transactions
       SET status = 'pending',
           paid_date = NULL,
           transaction_id = NULL
     WHERE transaction_id = OLD.id
       AND status = 'paid';
  END IF;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.scheduled_release_on_transaction_delete() IS
  'Apagou o lancamento que quitou uma conta prevista? A prevista volta para pending (065). Transferencia fica de fora: o estorno dela e o DELETE de /pay, que desfaz as duas pernas.';

DROP TRIGGER IF EXISTS release_scheduled_transaction ON public.financial_transactions;
CREATE TRIGGER release_scheduled_transaction
  BEFORE DELETE ON public.financial_transactions
  FOR EACH ROW EXECUTE FUNCTION public.scheduled_release_on_transaction_delete();
