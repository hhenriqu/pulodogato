-- =====================================================
-- Historico plantado ANTES da 027 (HMO-188)
-- =====================================================
-- Este arquivo nao testa nada. Ele existe para que os tres UPDATEs de backfill
-- da 027 tenham em que morder.
--
-- POR QUE ELE E NECESSARIO
-- ------------------------
-- O db-verify constroi o banco do ZERO: quando a 027 roda, `financial_transactions`
-- e `scheduled_transactions` estao vazias. Os backfills dela -- o `launch_date`
-- que sai de `created_at`, a direcao 'expense' das previsoes avulsas -- tocam
-- ZERO linhas, e nenhuma assercao sobre o estado final consegue distinguir um
-- backfill correto de um backfill errado, ou de um backfill ausente.
--
-- Medido: com o banco vazio, TRES mutantes da 027 sobreviveram ao arquivo de
-- teste inteiro --
--
--   1. `SET launch_date = CURRENT_DATE` em vez de `created_at::date`
--      (reescreve o historico como se tudo tivesse sido anotado no dia em que a
--      migration rodou);
--   2. o backfill da direcao das avulsas REMOVIDO
--      (toda previsao antiga fica sem direcao gravada);
--   3. `UPDATE ... SET expected_date = transaction_date`
--      (inventa uma previsao para cada lancamento do passado, e um relatorio de
--      atraso passa a sair com zero atrasos e cara de verdade).
--
-- Os tres passam verde num banco sem historico. Com as duas linhas deste
-- arquivo plantadas antes, os tres morrem.
--
-- ELE COMITA, DE PROPOSITO
-- ------------------------
-- Sem COMMIT a 027 (que roda no passo seguinte, noutra sessao) nao veria nada.
-- As duas linhas ficam no banco do CI para o teste da 027 conferir, e sao
-- escopadas num usuario proprio: nenhum outro teste da cadeia conta linhas
-- globalmente, e nenhum deles usa estes ids.
--
-- Rodar ENTRE a 026 e a 027:
--   psql "$DB_URL" -f database/tests/027_historico_antes_da_027.sql
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a7900000-0000-0000-0000-000000000099', 'historico-188@teste.local')
ON CONFLICT (id) DO NOTHING;

-- `is_public = FALSE` EXPLICITO, e nao pelo default.
--
-- `profiles.is_public` tem DEFAULT true, e a policy `profiles_select_own_or_public`
-- deixa QUALQUER usuario logado ler um perfil publico. Como este arquivo COMITA
-- (ao contrario dos testes, que fazem ROLLBACK), um perfil publico a mais no
-- banco do CI derrubou o controle de `view_security_invoker_test.sql`, que roda
-- depois e exige que o usuario dele veja exatamente 1 perfil:
--
--   Controle falhou: profiles devolveu 2 linha(s) para o usuario C, esperado 1.
--
-- E a armadilha de plantar dado que sobrevive a transacao: o teste que quebra e
-- outro, num arquivo que nada tem a ver com esta feature, e a mensagem fala de
-- RLS.
INSERT INTO public.profiles (id, email, full_name, is_public) VALUES
  ('a7900000-0000-0000-0000-000000000099', 'historico-188@teste.local', 'Historico 188', FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance) VALUES
  ('f7900000-0000-0000-0000-000000000099',
   'a7900000-0000-0000-0000-000000000099', 'Conta do historico', 'checking', 0)
ON CONFLICT (id) DO NOTHING;

-- O LANCAMENTO ANTIGO
--
-- `created_at` de 40 dias atras e `transaction_date` de 45: as duas datas
-- DIFERENTES entre si e diferentes de hoje. E o que separa os tres candidatos a
-- backfill -- `created_at::date`, `transaction_date` e `CURRENT_DATE` produzem
-- tres respostas distintas nesta linha, e so uma delas e a certa.
--
-- Sem os 5 dias de diferenca entre anotar e acontecer, um backfill escrito
-- `SET launch_date = transaction_date` daria o mesmo numero que o correto.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, description, amount,
   transaction_date, transaction_type, created_at)
SELECT '77900000-0000-0000-0000-000000000099',
       'a7900000-0000-0000-0000-000000000099',
       'f7900000-0000-0000-0000-000000000099',
       c.service_id, c.id,
       'Lancamento anterior a 027', -123.45,
       CURRENT_DATE - 45, 'expense', now() - INTERVAL '40 days'
  FROM public.transaction_categories c
 WHERE c.is_expense
 LIMIT 1
ON CONFLICT (id) DO NOTHING;

-- A PREVISAO AVULSA ANTIGA
--
-- Sem regra: e a linha que a rota de baixa sempre leu pelo `?? 'expense'`
-- implicito. A 027 tem que GRAVAR 'expense' nela -- nao apenas deixar o
-- COALESCE da view responder 'expense', que e o que o mutante sem backfill
-- tambem faria.
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, account_id, description, amount, due_date, status)
SELECT '27900000-0000-0000-0000-000000000099',
       'a7900000-0000-0000-0000-000000000099', c.id,
       'f7900000-0000-0000-0000-000000000099',
       'Boleto anterior a 027', 77.00, CURRENT_DATE + 30, 'pending'
  FROM public.transaction_categories c
 WHERE c.is_expense
 LIMIT 1
ON CONFLICT (id) DO NOTHING;

-- E uma ocorrencia COM regra, para provar o outro lado do backfill: ela tem que
-- ficar com `transaction_type` NULL. Um backfill sem o `recurring_rule_id IS
-- NULL` no WHERE marcaria esta linha como 'expense' e congelaria a direcao --
-- editar a regra para "receita" deixaria de reapontar a ocorrencia.
INSERT INTO public.recurring_rules
  (id, user_id, category_id, description, amount, transaction_type, due_day)
SELECT '17900000-0000-0000-0000-000000000099',
       'a7900000-0000-0000-0000-000000000099', c.id,
       'Salario anterior a 027', 4200.00, 'income', 5
  FROM public.transaction_categories c
 WHERE NOT c.is_expense
 LIMIT 1
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.scheduled_transactions
  (id, user_id, recurring_rule_id, category_id, account_id, description, amount, due_date, status)
SELECT '27900000-0000-0000-0000-000000000098',
       'a7900000-0000-0000-0000-000000000099',
       '17900000-0000-0000-0000-000000000099', c.id,
       'f7900000-0000-0000-0000-000000000099',
       'Salario anterior a 027', 4200.00, CURRENT_DATE + 5, 'pending'
  FROM public.transaction_categories c
 WHERE NOT c.is_expense
 LIMIT 1
ON CONFLICT (id) DO NOTHING;

-- Confere que o cenario e o que ele diz ser, ANTES de a 027 rodar. Sem isto, um
-- INSERT que nao acontecesse (categoria ausente, ON CONFLICT engolindo) deixaria
-- as assercoes da 027 sem sujeito e elas falhariam falando de outra coisa.
DO $$
DECLARE
  n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.financial_transactions
   WHERE id = '77900000-0000-0000-0000-000000000099';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FALHA: o lancamento antigo do historico nao foi plantado';
  END IF;

  SELECT COUNT(*) INTO n FROM public.scheduled_transactions
   WHERE id IN ('27900000-0000-0000-0000-000000000099',
                '27900000-0000-0000-0000-000000000098');
  IF n <> 2 THEN
    RAISE EXCEPTION 'FALHA: as previsoes antigas do historico nao foram plantadas (% de 2)', n;
  END IF;

  RAISE NOTICE 'ok: historico plantado (1 lancamento de 40 dias, 2 previsoes)';
END $$;

COMMIT;
