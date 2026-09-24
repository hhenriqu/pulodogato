-- =====================================================
-- PULODOGATO - PAGAMENTO DE FATURA: ELO ENTRE AS PERNAS E REPARO DO DADO TORTO
-- =====================================================
-- Migration: 015_card_invoice_payment
-- Gerado em: 2026-09-24  (HMO-149)
--
-- O BUG
-- -----
-- Pagar a fatura do cartao contava a mesma despesa DUAS vezes.
--
-- `app/api/card-invoices/close` cria a conta a pagar da fatura com
-- `account_id` do proprio cartao, e `app/api/scheduled-transactions/[id]/pay`
-- dava baixa inserindo UMA transacao negativa nesse mesmo `account_id`. O
-- trigger `update_account_balance` soma `NEW.amount` na conta indicada, entao:
--
--   momento                  | conta corrente |  cartao  | patrimonio
--   -------------------------+----------------+----------+-----------
--   depois da compra de 1000 |        5000.00 | -1000.00 |    4000.00
--   depois de pagar a fatura |        5000.00 | -2000.00 |    3000.00
--
-- O cartao ficava MAIS negativo pelo valor da fatura e a conta de onde o
-- dinheiro realmente saiu nao se mexia. O patrimonio certo e 4000 nos dois
-- momentos: a despesa aconteceu na compra, nao no pagamento.
--
-- Nada quebrava. Nao havia excecao, 500 nem tela vazia -- havia um patrimonio
-- 25% menor, plausivel, com duas casas decimais.
--
-- O CONSERTO, QUE E METADE CODIGO E METADE ESTE ARQUIVO
-- -----------------------------------------------------
-- No codigo (lib/card-invoice.ts): a baixa da fatura passa a gravar DUAS
-- pernas com `transaction_type = 'transfer'` -- `-total` na conta pagadora e
-- `+total` na conta do cartao. 'transfer' e o que faz as views fecharem: o
-- fluxo de caixa do 008 filtra `('expense','income')` e ignora as duas pernas
-- (a despesa continua contada uma vez, na compra); `net_worth_history` soma
-- qualquer tipo, espelhando o trigger de saldo, e la as duas se anulam; e
-- `card_invoice_lines` tambem filtra ('expense','income'), entao a perna de
-- entrada nao aparece como credito abatendo a fatura do mes SEGUINTE.
--
-- (A nota da SECAO 4 do 006 diz que o pagamento da fatura "entra como income
-- na conta do cartao". Era a intencao antiga e estava errada por dois motivos:
-- income infla a receita do mes, e a linha abateria a fatura seguinte. Estorno
-- de compra continua sendo income; pagamento e transferencia.)
--
-- Aqui, duas coisas que o TypeScript nao alcanca:
--
--   1. `counterpart_transaction_id`: o elo entre as duas pernas, para que o
--      ESTORNO da baixa apague as duas sem adivinhar por valor e data.
--   2. o reparo do dado que ja entrou torto em producao.
--
-- POR QUE O REPARO DEVOLVE A CONTA PARA 'pending' EM VEZ DE CORRIGIR
-- ------------------------------------------------------------------
-- Para corrigir seria preciso saber DE QUAL CONTA o dinheiro saiu, e essa
-- informacao nunca foi gravada -- a baixa antiga so registrava o cartao.
-- Escolher uma conta ("a primeira conta corrente") lancaria dinheiro saindo de
-- uma conta que o usuario nao escolheu: trocaria um erro visivel no patrimonio
-- por um saldo errado em duas contas, que e pior porque ninguem procura.
--
-- Entao o reparo desfaz: apaga a transacao errada (o trigger devolve o saldo
-- do cartao no mesmo movimento) e devolve a conta prevista para 'pending'. A
-- fatura volta para a agenda e o usuario da baixa de novo, agora escolhendo a
-- conta pagadora. O `paid_date` original de cada uma sai no RAISE NOTICE --
-- guarde a saida antes de fechar o SQL Editor.
--
-- O reparo e uma FUNCAO, nao um bloco solto, por dois motivos: o teste
-- (database/tests/card_invoice_payment_test.sql) precisa criar uma baixa torta
-- e chamar o reparo para provar que ele repara, e quem rodar a migration duas
-- vezes tem que poder confiar que a segunda nao faz nada. A funcao fica no
-- schema depois, sem EXECUTE para anon nem para authenticated.
--
-- ORDEM DAS OPERACOES NO REPARO (nao e arbitraria)
-- ------------------------------------------------
-- Solta a conta prevista ANTES de apagar a transacao. A constraint
-- `scheduled_transactions_paid_check` do 005 exige que `paid_date` e
-- `transaction_id` saiam junto com o status, e o FK e ON DELETE SET NULL:
-- apagar a transacao primeiro tentaria deixar a linha em 'paid' com
-- `transaction_id` NULL, exatamente o estado que a constraint existe para
-- impedir -- e o DELETE falharia. E a mesma ordem do DELETE /pay.
--
-- ESTE ARQUIVO SO ACRESCENTA: nenhuma funcao, view, policy ou trigger de
-- producao e alterada. A unica escrita em dado existente e o reparo, e ele so
-- alcanca linha que casa a chave canonica da fatura.
--
-- SEM META-COMANDO DE psql AQUI -- ESTE ARQUIVO E COLADO NO SQL EDITOR
-- ---------------------------------------------------------------------
-- Producao nao tem runner de migration: quem aplica e uma pessoa, colando o
-- arquivo no SQL Editor do Supabase, que fala Postgres e NAO e o psql. Uma
-- linha comecando com barra invertida vira `syntax error at or near "\"` na
-- PRIMEIRA linha executavel -- e como o erro e no topo, NADA e aplicado. O
-- arquivo parece rodado e o banco nao mudou. Foi o que aconteceu na primeira
-- tentativa de aplicar esta migration (HMO-149, 2026-09-24).
--
-- Nenhuma das migrations 000-014 usa meta-comando; esta era a unica. O CI ja
-- passa ON_ERROR_STOP pela linha de comando (`psql -v ON_ERROR_STOP=1`), entao
-- declara-lo aqui dentro nao acrescentava nada la.
--
-- E a seguranca nao dependia dele: o arquivo inteiro esta num BEGIN/COMMIT.
-- Erro no meio aborta a transacao, todo comando seguinte falha com "current
-- transaction is aborted" e o COMMIT final vira ROLLBACK. Aplicar pela metade
-- continua sendo impossivel -- e a SECAO 4 ainda confere objeto por objeto e
-- da RAISE EXCEPTION se faltar alguma coisa.
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 1: o elo entre as duas pernas
-- =====================================================
-- Uma direcao so: a perna de ENTRADA (a que quita o cartao) aponta para a
-- perna de SAIDA (a que tirou o dinheiro da conta, e a que
-- `scheduled_transactions.transaction_id` referencia). Apontar nos dois
-- sentidos exigiria um UPDATE depois dos dois INSERTs -- um terceiro passo
-- para falhar no meio, sem nada em troca: o estorno procura pela entrada a
-- partir da saida, nunca o contrario.
ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS counterpart_transaction_id uuid;

COMMENT ON COLUMN public.financial_transactions.counterpart_transaction_id IS
  'Perna oposta de uma transferencia entre contas proprias (hoje: pagamento de fatura). A perna de entrada aponta para a de saida.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.financial_transactions'::regclass
      AND conname = 'financial_transactions_counterpart_fkey'
  ) THEN
    -- ON DELETE SET NULL, nao CASCADE: apagar a perna de saida nao pode
    -- apagar a perna de entrada em silencio. Quem apaga as duas e o estorno,
    -- explicitamente, para que a rota possa avisar se a segunda falhar.
    ALTER TABLE public.financial_transactions
      ADD CONSTRAINT financial_transactions_counterpart_fkey
      FOREIGN KEY (counterpart_transaction_id)
      REFERENCES public.financial_transactions(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.financial_transactions'::regclass
      AND conname = 'financial_transactions_counterpart_not_self'
  ) THEN
    -- Uma perna apontando para si mesma passaria por par valido e o estorno
    -- apagaria uma linha so, deixando metade da transferencia no saldo.
    ALTER TABLE public.financial_transactions
      ADD CONSTRAINT financial_transactions_counterpart_not_self
      CHECK (counterpart_transaction_id IS NULL OR counterpart_transaction_id <> id);
  END IF;
END $$;

-- O estorno busca a perna de entrada por counterpart_transaction_id. Sem
-- indice isso e um seq scan na tabela que mais cresce no banco.
CREATE INDEX IF NOT EXISTS idx_financial_transactions_counterpart
  ON public.financial_transactions (counterpart_transaction_id)
  WHERE counterpart_transaction_id IS NOT NULL;

-- =====================================================
-- SECAO 2: o reparo
-- =====================================================
-- A chave canonica que `POST /api/card-invoices/close` grava em
-- `scheduled_transactions.notes` e `fatura:YYYY-MM-01:<uuid do cartao>`.
--
-- A deteccao e pela CHAVE, nunca pelo tipo da conta. Assinatura cobrada no
-- cartao e cadastrada como conta prevista com `account_id` do cartao, e pagar
-- aquela conta COM o cartao e despesa de verdade: quem varresse por
-- `account_type = 'credit_card'` apagaria o lancamento de toda assinatura de
-- cartao ja paga e faria a despesa desaparecer do relatorio.
--
-- A regex e ancorada nas duas pontas pelo mesmo motivo que em
-- lib/card-invoice.ts: sem o `$`, uma nota escrita a mao pelo usuario entraria
-- no reparo.
CREATE OR REPLACE FUNCTION public.reparar_pagamentos_de_fatura()
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_total integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT
      s.id            AS scheduled_id,
      s.transaction_id,
      s.user_id,
      s.description,
      s.paid_date,
      t.amount,
      t.account_id
    FROM public.scheduled_transactions s
    JOIN public.financial_transactions t ON t.id = s.transaction_id
    WHERE s.status = 'paid'
      AND s.notes ~ '^fatura:\d{4}-\d{2}-\d{2}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      -- a transacao da baixa caiu no PROPRIO cartao da chave: e a baixa antiga
      AND t.account_id = (substring(s.notes from '^fatura:\d{4}-\d{2}-\d{2}:(.+)$'))::uuid
      -- cinto e suspensorio: a baixa nova grava 'transfer' e jamais entra aqui
      AND t.transaction_type IS DISTINCT FROM 'transfer'
  LOOP
    -- Ordem inversa da baixa. Ver a nota no cabecalho: soltar a conta depois
    -- do DELETE violaria scheduled_transactions_paid_check.
    UPDATE public.scheduled_transactions
       SET status = 'pending', paid_date = NULL, transaction_id = NULL
     WHERE id = r.scheduled_id;

    -- O trigger update_account_balance devolve o saldo do cartao aqui
    -- (current_balance - OLD.amount), no mesmo comando.
    DELETE FROM public.financial_transactions WHERE id = r.transaction_id;

    v_total := v_total + 1;

    RAISE NOTICE
      'reparada: "%" (usuario %, paga em %, valor %) -> voltou para pending; o saldo do cartao % foi devolvido em %',
      r.description, r.user_id, r.paid_date, r.amount, r.account_id, abs(r.amount);
  END LOOP;

  RETURN v_total;
END $$;

COMMENT ON FUNCTION public.reparar_pagamentos_de_fatura() IS
  'Desfaz baixas de fatura lancadas no proprio cartao (bug HMO-149): apaga a transacao e devolve a conta prevista para pending. Idempotente.';

-- Sem EXECUTE para os papeis do app. A funcao escreve em dinheiro e existe
-- para manutencao; deixar o EXECUTE default (PUBLIC) a publicaria como RPC em
-- /rest/v1/rpc para qualquer usuario logado.
--
-- REVOKE de PUBLIC nao basta neste banco: o Supabase concede explicitamente a
-- anon e authenticated, e um grant explicito sobrevive ao REVOKE de PUBLIC --
-- a mesma armadilha do 002. Por isso os tres REVOKEs.
REVOKE ALL ON FUNCTION public.reparar_pagamentos_de_fatura() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.reparar_pagamentos_de_fatura() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.reparar_pagamentos_de_fatura() FROM authenticated;
  END IF;
END $$;

-- =====================================================
-- SECAO 3: roda o reparo uma vez
-- =====================================================
DO $$
DECLARE
  v_total integer;
BEGIN
  v_total := public.reparar_pagamentos_de_fatura();
  IF v_total = 0 THEN
    RAISE NOTICE '015: nenhuma baixa de fatura torta encontrada.';
  ELSE
    RAISE NOTICE '015: % baixa(s) de fatura desfeita(s). As faturas voltaram para a agenda em Contas Previstas -- de baixa de novo escolhendo a conta pagadora.', v_total;
  END IF;
END $$;

-- =====================================================
-- SECAO 4: prova
-- =====================================================
-- Aborta se qualquer metade nao pegou. O motivo de existir e o mesmo do 014: a
-- migration e colada a mao num SQL Editor, e um erro no meio de um script
-- longo passa despercebido entre os NOTICEs.
DO $$
DECLARE
  problemas text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'financial_transactions'
      AND column_name = 'counterpart_transaction_id'
  ) THEN
    problemas := problemas || E'\n  - falta a coluna counterpart_transaction_id';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.financial_transactions'::regclass
      AND conname = 'financial_transactions_counterpart_fkey'
  ) THEN
    problemas := problemas || E'\n  - falta o FK da perna oposta';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.financial_transactions'::regclass
      AND conname = 'financial_transactions_counterpart_not_self'
  ) THEN
    problemas := problemas || E'\n  - falta o CHECK que impede a perna apontar para si mesma';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'reparar_pagamentos_de_fatura'
  ) THEN
    problemas := problemas || E'\n  - falta a funcao de reparo';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     AND has_function_privilege('authenticated', 'public.reparar_pagamentos_de_fatura()', 'EXECUTE') THEN
    problemas := problemas || E'\n  - authenticated ainda pode executar o reparo (RPC aberta)';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND has_function_privilege('anon', 'public.reparar_pagamentos_de_fatura()', 'EXECUTE') THEN
    problemas := problemas || E'\n  - anon ainda pode executar o reparo (RPC aberta)';
  END IF;

  -- Nenhuma baixa de fatura pode ter sobrado apontando para o proprio cartao.
  IF EXISTS (
    SELECT 1
    FROM public.scheduled_transactions s
    JOIN public.financial_transactions t ON t.id = s.transaction_id
    WHERE s.status = 'paid'
      AND s.notes ~ '^fatura:\d{4}-\d{2}-\d{2}:[0-9a-fA-F-]{36}$'
      AND t.account_id = (substring(s.notes from '^fatura:\d{4}-\d{2}-\d{2}:(.+)$'))::uuid
      AND t.transaction_type IS DISTINCT FROM 'transfer'
  ) THEN
    problemas := problemas || E'\n  - sobrou baixa de fatura lancada no proprio cartao';
  END IF;

  IF problemas <> '' THEN
    RAISE EXCEPTION E'015 aplicou parcialmente:%', problemas;
  END IF;

  RAISE NOTICE '015 conferido: coluna, FK, CHECK, indice, funcao de reparo fechada para anon/authenticated, e nenhuma baixa torta restante.';
END $$;

-- =====================================================
-- SECAO 5: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('015', '015_card_invoice_payment',
        'Elo entre as pernas da transferencia e reparo das baixas de fatura lancadas no proprio cartao - HMO-149', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
