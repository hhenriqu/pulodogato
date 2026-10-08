-- =====================================================
-- HMO-256 -- a receita prevista AVULSA sai de planned_expense
-- =====================================================
--
-- Roda no db-verify, contra o banco que as migrations constroem do zero, na
-- posicao DELE na cadeia: depois da 043.
--
-- O QUE A 043 ENTREGA, E POR QUE SO O POSTGRES PEGA
-- ------------------------------------------------
-- `planned_vs_actual` decidia a direcao do previsto por
-- `COALESCE(r.transaction_type, 'expense')` -- o tipo da REGRA de recorrencia.
-- Previsao AVULSA nao tem regra, entao a receita avulsa caia em 'expense'.
--
-- Nenhum teste de TypeScript le view. A rota de orcamento recebe
-- `planned_expense` e `planned_income` como dois numeros, os dois no formato
-- certo e os dois plausiveis -- o erro so aparece comparando com a agenda, que
-- e justamente o que ninguem faz a mao. E ele erra para o lado que nao gera
-- reclamacao: o app diz que a pessoa tem MENOS do que tem.
--
-- O CASO 3 E O QUE JUSTIFICA O ARQUIVO (o controle negativo)
-- ---------------------------------------------------------
-- Os casos 1 e 2 sozinhos nao distinguem "a 043 funciona" de "o cenario nunca
-- exercitou o defeito": se a fixture nao tivesse receita avulsa, os dois
-- passariam verdes sobre a view ANTIGA. O caso 3 reproduz o FILTER antigo sobre
-- a fixture nova e EXIGE o numero errado (350,00) -- ele falha no dia em que o
-- cenario deixar de conter o caso, e ai os casos 1 e 2 param de medir sem
-- avisar. Mesmo desenho do caso 5 do `022_currency_test.sql`.
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect(label TEXT, got NUMERIC, want NUMERIC)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % = %', label, got;
END;
$$;

-- ---------------------------------------------------------------------------
-- A FIXTURE
-- ---------------------------------------------------------------------------
-- Quatro linhas em outubro/2026, escolhidas para que CADA uma meca uma coisa e
-- para que os totais sejam atribuiveis -- nao um numero redondo que varias
-- combinacoes produziriam:
--
--   1. BONUS 50,00  -- receita AVULSA (`transaction_type='income'`, sem regra).
--      O caso da issue. Antes da 043 ele somava em `planned_expense`.
--   2. LUZ 100,00   -- despesa avulsa com `transaction_type` NULO. E a base
--      instalada: toda linha criada antes da 027. Ela TEM de continuar
--      despesa, e e o que prova que a 043 nao trocou o default.
--   3. SALARIO 2.700 -- ocorrencia de uma REGRA de receita, com
--      `transaction_type` nulo na ocorrencia. Prova que o degrau da regra
--      continua valendo: quem nao tem a coluna propria cai nela.
--   4. INTERNET 200,00 -- despesa com `transaction_type='expense'` explicito.
--
-- Os quatro valores sao distintos e nao somam entre si por acidente: 50, 100,
-- 200 e 2700 nao tem dois subconjuntos com a mesma soma, entao um total errado
-- nao se faz passar por certo.
INSERT INTO auth.users (id, email) VALUES
  ('d2560000-0000-0000-0000-000000000001', 'hmo256@example.com');
INSERT INTO public.profiles (id, email, full_name) VALUES
  ('d2560000-0000-0000-0000-000000000001', 'hmo256@example.com', 'HMO 256');

-- A categoria vem das SEMEADAS pela cadeia: `transaction_categories.service_id`
-- e NOT NULL e nao e desta issue. Criar categoria aqui acoplaria o teste ao
-- cadastro de servicos.
CREATE TEMP TABLE cat AS
  SELECT id FROM public.transaction_categories WHERE is_expense LIMIT 1;

INSERT INTO public.recurring_rules
  (id, user_id, category_id, description, amount, transaction_type, frequency,
   interval_count, start_date, reminder_days, auto_post, is_active)
SELECT 'd2560000-0000-0000-0000-0000000000a1',
       'd2560000-0000-0000-0000-000000000001', cat.id, 'Salario', 2700,
       'income', 'monthly', 1, '2026-10-01', 3, false, true
FROM cat;

INSERT INTO public.scheduled_transactions
  (user_id, category_id, recurring_rule_id, description, amount, due_date,
   status, transaction_type)
SELECT 'd2560000-0000-0000-0000-000000000001', cat.id, r.regra, r.descricao,
       r.valor, r.vence, 'pending', r.tipo
FROM cat, (VALUES
  (NULL::uuid,                                      'Bonus (previsto)',  50::numeric, '2026-10-29'::date, 'income'::public.transaction_financial_type),
  (NULL::uuid,                                      'Conta de luz',     100,          '2026-10-20',       NULL),
  ('d2560000-0000-0000-0000-0000000000a1'::uuid,    'Salario',         2700,          '2026-10-05',       NULL),
  (NULL::uuid,                                      'Internet',         200,          '2026-10-15',       'expense')
) AS r(regra, descricao, valor, vence, tipo);

-- ---------------------------------------------------------------------------
-- CASO 1. A receita avulsa esta no lado de RECEBER, e nao no de pagar
-- ---------------------------------------------------------------------------
-- AS DUAS FACES NA MESMA ASSERCAO, de proposito. Medir so `planned_expense`
-- aprovaria uma view que simplesmente DESCARTASSE a linha de receita -- ela
-- daria os mesmos 300,00 e esconderia R$ 50,00 que a pessoa vai receber. O
-- `planned_income` e a metade que a subtracao nao prova.
SELECT pg_temp.expect(
  'planned_expense sem a receita avulsa (100 luz + 200 internet)',
  (SELECT planned_expense FROM public.planned_vs_actual
   WHERE user_id = 'd2560000-0000-0000-0000-000000000001' AND month = '2026-10-01'),
  300.00
);
SELECT pg_temp.expect(
  'planned_income com o bonus avulso (2700 salario + 50 bonus)',
  (SELECT planned_income FROM public.planned_vs_actual
   WHERE user_id = 'd2560000-0000-0000-0000-000000000001' AND month = '2026-10-01'),
  2750.00
);

-- `expense_variance` e o numero que a tela imprime como "gastou mais do que
-- previa". Sem realizado nenhum ele e -planned_expense, e ele se deslocava
-- junto com o defeito: com o bonus do lado errado dava -350,00.
SELECT pg_temp.expect(
  'expense_variance acompanha o planned_expense consertado',
  (SELECT expense_variance FROM public.planned_vs_actual
   WHERE user_id = 'd2560000-0000-0000-0000-000000000001' AND month = '2026-10-01'),
  -300.00
);

-- ---------------------------------------------------------------------------
-- CASO 2. O QUE A 043 NAO MUDOU
-- ---------------------------------------------------------------------------
-- `pending_count` conta LINHA EM ABERTO, nao divida: as quatro continuam
-- pendentes, receita incluida. Uma 043 que "consertasse" isto tambem tiraria a
-- receita prevista da contagem de pendencias da tela, sem issue nenhuma
-- pedindo -- e a receita que nao caiu esta mesmo pendente.
SELECT pg_temp.expect(
  'pending_count continua contando as quatro linhas, receita incluida',
  (SELECT pending_count FROM public.planned_vs_actual
   WHERE user_id = 'd2560000-0000-0000-0000-000000000001' AND month = '2026-10-01'),
  4
);

-- A despesa avulsa com `transaction_type` NULO -- a base instalada inteira --
-- tem de continuar despesa. E o degrau final do COALESCE da view da agenda, e
-- o lado seguro: se a 043 tivesse invertido o default, toda conta a pagar
-- anterior a 027 viraria receita prevista e o orcamento prometeria dinheiro.
SELECT pg_temp.expect(
  'a linha SEM transaction_type e sem regra continua despesa',
  (SELECT COUNT(*) FROM public.scheduled_transactions_effective
   WHERE user_id = 'd2560000-0000-0000-0000-000000000001'
     AND description = 'Conta de luz' AND direction = 'expense'),
  1
);

-- ---------------------------------------------------------------------------
-- CASO 3. O CONTROLE NEGATIVO: o criterio ANTIGO sobre a fixture NOVA
-- ---------------------------------------------------------------------------
-- Reproduz `COALESCE(r.transaction_type, 'expense')` -- o FILTER que a 043
-- aposentou -- sobre as mesmas quatro linhas, e EXIGE o numero errado.
--
-- Ele e o que impede este arquivo de ficar vacuo. Enquanto ele devolver 350,00
-- a fixture contem o defeito, e os casos 1 e 2 estao medindo a correcao. No dia
-- em que alguem mexer na fixture e tirar a receita avulsa, ESTE caso falha
-- primeiro e diz por que -- em vez de os outros ficarem verdes por nao ter mais
-- o que exercitar.
SELECT pg_temp.expect(
  'CONTROLE NEGATIVO: o criterio antigo (tipo da REGRA) poe o bonus nas despesas',
  (SELECT SUM(s.amount) FILTER (WHERE COALESCE(r.transaction_type, 'expense') = 'expense')
   FROM public.scheduled_transactions s
   LEFT JOIN public.recurring_rules r ON r.id = s.recurring_rule_id
   WHERE s.user_id = 'd2560000-0000-0000-0000-000000000001'
     AND date_trunc('month', s.due_date)::date = '2026-10-01'
     AND s.status <> 'cancelled'),
  350.00
);
-- E a outra metade do controle: o criterio antigo tambem PERDIA os 50,00 do
-- lado de receber. A distancia entre os dois criterios e 2 x 50,00, e e por
-- isso que o defeito valia o dobro do que a soma de despesas sugeria.
SELECT pg_temp.expect(
  'CONTROLE NEGATIVO: o criterio antigo deixava planned_income sem o bonus',
  (SELECT SUM(s.amount) FILTER (WHERE COALESCE(r.transaction_type, 'expense') = 'income')
   FROM public.scheduled_transactions s
   LEFT JOIN public.recurring_rules r ON r.id = s.recurring_rule_id
   WHERE s.user_id = 'd2560000-0000-0000-0000-000000000001'
     AND date_trunc('month', s.due_date)::date = '2026-10-01'
     AND s.status <> 'cancelled'),
  2700.00
);

-- ---------------------------------------------------------------------------
-- CASO 4. A MOEDA CONTINUA NO GRAO -- o mes nao duplica o previsto
-- ---------------------------------------------------------------------------
-- ESTE CASO ESTA AQUI PORQUE O GUARDA ORIGINAL NAO ALCANCA A 043. Os casos 4 e
-- 5 do `022_currency_test.sql` guardam exatamente isto, mas aquele arquivo roda
-- na POSICAO dele (antes da 026) e NAO e re-executavel depois: medido, ele morre
-- em `financial_transactions_rate_matches_currency`, porque a fixture em dolar
-- dele nasceu antes daquele CHECK existir. Entao a 043 reescreve um LATERAL que
-- aquele arquivo nunca vai exercitar, e a cobertura tem de vir para ca.
--
-- O QUE PODE QUEBRAR: a 043 trocou o `FROM` do LATERAL do previsto (tabela ->
-- view). O casamento por moeda (`s.currency IS NOT DISTINCT FROM k.currency`)
-- continua lado a lado com ele, e sem esse casamento um mes com duas moedas
-- devolveria DUAS linhas repetindo o previsto inteiro em cada uma -- o previsto
-- apareceria dobrado.
--
-- `scheduled_transactions` e BRL por CHECK (`scheduled_transactions_currency_brl`),
-- entao a segunda moeda so pode entrar no `chaves` pelo lado REALIZADO. E por
-- isso que o cenario e um lancamento em dolar no mesmo mes.
INSERT INTO public.financial_transactions
  (user_id, service_id, category_id, description, amount, transaction_date,
   transaction_type, currency, exchange_rate)
SELECT 'd2560000-0000-0000-0000-000000000001',
       '8730cd96-d656-4c48-863e-673e1016a832', cat.id,
       'Assinatura em dolar', -30, '2026-10-10', 'expense', 'USD', 5.40
FROM cat;

-- DUAS linhas no mes, uma por moeda -- e nao uma linha so nem quatro.
SELECT pg_temp.expect(
  'o mes com duas moedas rende duas linhas',
  (SELECT COUNT(*) FROM public.planned_vs_actual
   WHERE user_id = 'd2560000-0000-0000-0000-000000000001' AND month = '2026-10-01'),
  2
);

-- A linha de BRL mantem o previsto INTEIRO e inalterado pela chegada do dolar.
SELECT pg_temp.expect(
  'a linha BRL nao duplicou o previsto (2750, nao 5500)',
  (SELECT planned_income FROM public.planned_vs_actual
   WHERE user_id = 'd2560000-0000-0000-0000-000000000001'
     AND month = '2026-10-01' AND currency = 'BRL'),
  2750.00
);

-- E a linha de USD nao herda previsto nenhum: nao existe previsto em dolar.
-- Sem o casamento por moeda ela carregaria os mesmos 2.750,00, e a tela somaria
-- 5.500,00 de receita prevista onde ha 2.750,00.
SELECT pg_temp.expect(
  'a linha USD nao herda o previsto em reais',
  (SELECT planned_income FROM public.planned_vs_actual
   WHERE user_id = 'd2560000-0000-0000-0000-000000000001'
     AND month = '2026-10-01' AND currency = 'USD'),
  0.00
);

-- ---------------------------------------------------------------------------
-- CASO 5. A RLS DE VERDADE, PELA VIEW, COM A ROLE DE APLICACAO
-- ---------------------------------------------------------------------------
-- A 043 faz `CREATE OR REPLACE VIEW`, e e exatamente o comando que ja apagou
-- `reloptions` neste repositorio. Sem `security_invoker` a view roda com os
-- direitos do DONO, a RLS de `scheduled_transactions` deixa de valer, e
-- `planned_vs_actual` devolve o previsto de TODOS os usuarios para qualquer um
-- logado. O `view_security_invoker_test.sql` cobra a reloption; este caso cobra
-- o EFEITO dela, que e o que importa.
--
-- `SET LOCAL` so vale dentro desta transacao, e o ROLLBACK no fim desfaz tudo.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'd2560000-0000-0000-0000-000000000001';

-- `currency = 'BRL'` recorta a linha: o caso 4 acrescentou a do dolar, e sem o
-- recorte a subconsulta devolve DUAS linhas e morre em "more than one row".
SELECT pg_temp.expect(
  'o dono ve o proprio previsto pela view, com a RLS ligada',
  (SELECT planned_income FROM public.planned_vs_actual
   WHERE month = '2026-10-01' AND currency = 'BRL'),
  2750.00
);

SET LOCAL request.jwt.claim.sub = 'd2560000-0000-0000-0000-00000000dead';

SELECT pg_temp.expect(
  'OUTRO usuario nao ve linha nenhuma do previsto alheio',
  (SELECT COUNT(*) FROM public.planned_vs_actual
   WHERE user_id = 'd2560000-0000-0000-0000-000000000001'),
  0
);

RESET ROLE;

ROLLBACK;
