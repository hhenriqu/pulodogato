-- 023_categoria_de_transferencia.sql
--
-- HMO-162: destrava a transferencia entre contas, que esta 500 em producao
-- desde que a tela subiu (HMO-164).
--
-- ===========================================================================
-- O QUE ESTA QUEBRADO
-- ===========================================================================
-- `financial_transactions.category_id` e NOT NULL, e transferencia entre
-- contas proprias nao tem categoria. A HMO-164 resolveu isso criando uma
-- categoria reservada SOB DEMANDA, no primeiro uso, de dentro da rota:
--
--     SELECT id FROM transaction_categories WHERE name = 'Transferência entre contas'
--     -- nao achou? entao:
--     INSERT INTO transaction_categories (...) VALUES (...)
--
-- As duas metades falham, e falham para sempre:
--
--   1. o INSERT nao tem como acontecer. `transaction_categories` e tabela de
--      REFERENCIA: o 002_rls_lockdown so deu `GRANT SELECT` a anon, e a unica
--      policy da tabela e `transaction_categories_read`, FOR SELECT. Nao ha
--      GRANT de INSERT nem policy de INSERT para `authenticated` -- de
--      proposito, porque a tabela e global, e uma escrita ali apareceria na
--      tela de TODO mundo. O insert volta 42501, nao 23505, entao nem o ramo
--      de "outro pedido criou primeiro" pega;
--
--   2. o SELECT tambem nao acharia a linha se ela existisse, porque a policy
--      de leitura e `USING (is_active = TRUE)` e a categoria reservada nasce
--      `is_active = FALSE` -- justamente para ficar fora dos seletores.
--
-- Resultado: `categoriaDaTransferencia` devolve NULL em 100% das chamadas, a
-- rota responde 500 "Não foi possível registrar a transferência", e nenhuma
-- transferencia jamais foi gravada. Medido em producao em 2026-09-29, com a
-- conta de teste, pela rota publicada.
--
-- Por que passou por todo o CI: os testes da HMO-164 sao sobre
-- `pernasDaTransferencia` -- funcao pura, que devolve as duas pernas certas e
-- continua devolvendo. O defeito nao esta na aritmetica; esta na permissao de
-- uma tabela que nenhum teste de unidade toca. So um POST de verdade contra o
-- banco de verdade encontra isso.
--
-- ===========================================================================
-- O CONSERTO
-- ===========================================================================
-- A categoria reservada vira SEED, como as outras doze do 001_baseline, e uma
-- segunda policy de leitura a torna visivel. A rota passa a so LER.
--
-- Por que nao abrir INSERT para `authenticated` em vez disso: a tabela nao tem
-- `user_id`. Quem escreve nela escreve para todos os usuarios do app. Dar essa
-- caneta a qualquer portador de sessao para resolver um problema de seed
-- trocaria um 500 honesto por uma porta que ninguem ia lembrar de fechar.
--
-- Por que a policy nova em vez de afrouxar a que existe: `is_active = TRUE` e o
-- que mantem categoria desativada fora do app inteiro. A policy nova adiciona
-- exatamente as linhas reservadas -- `is_active = FALSE` E o nome exato -- e
-- policies do mesmo comando sao OR, entao nada mais muda de visibilidade.
--
-- E a linha continua fora dos seletores: `/api/personal-finance/categories`
-- filtra `is_active = TRUE` no proprio SELECT, nao confia so na RLS.
-- =====================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A categoria reservada
-- ---------------------------------------------------------------------------
-- Id fixo para que o teste e qualquer auditoria futura tenham onde ancorar.
-- O `WHERE NOT EXISTS` olha (service_id, name), que e a UNIQUE da tabela
-- (`unique_category_per_service`): um `ON CONFLICT (id)` sozinho deixaria a
-- segunda passada estourar por nome duplicado se a linha ja existisse com
-- outro id -- e e isso que torna esta migration re-executavel.
INSERT INTO public.transaction_categories
  (id, service_id, name, description, icon, color_hex, is_expense, is_active)
SELECT
  '3f2d1c4a-9b6e-4d80-a1f5-2c7e8b30d941',
  '8730cd96-d656-4c48-863e-673e1016a832',
  'Transferência entre contas',
  'Reservada para as duas pernas de uma transferência. Não aparece nos seletores.',
  'arrow-right-left',
  '#0EA5E9',
  FALSE,
  FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM public.transaction_categories
   WHERE service_id = '8730cd96-d656-4c48-863e-673e1016a832'
     AND name = 'Transferência entre contas'
);

-- ---------------------------------------------------------------------------
-- A policy que torna a linha legivel para quem esta logado
-- ---------------------------------------------------------------------------
-- Estritamente aditiva: o predicado exige `is_active = FALSE`, entao ela nao
-- tem intersecao com `transaction_categories_read` (`is_active = TRUE`).
--
-- `anon` fica de fora. A tela de transferencia exige sessao, e a tabela de
-- referencia so e lida sem login para montar seletor -- onde esta linha nao
-- entra.
DROP POLICY IF EXISTS transaction_categories_read_reservada
  ON public.transaction_categories;

CREATE POLICY transaction_categories_read_reservada
  ON public.transaction_categories
  FOR SELECT TO authenticated
  USING (is_active = FALSE AND name = 'Transferência entre contas');

COMMIT;

-- =====================================================
-- DEPOIS DE APLICAR
-- =====================================================
-- A transferencia volta a funcionar com o codigo que ja esta no ar: a rota
-- procura a categoria por (service_id, name), passa a achar, e nunca chega no
-- INSERT que nao tem permissao. Nao ha deploy a esperar.
-- =====================================================
