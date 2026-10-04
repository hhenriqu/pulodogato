-- =====================================================
-- HMO-269 -- o que PUT /api/expense-groups/{id}/split-config depende do banco
-- =====================================================
--
-- Roda no db-verify, contra o banco que as migrations constroem do zero.
--
-- Esta fase (F3 da HMO-245) nao tem migration: ela e uma rota. Mas a rota faz
-- quatro afirmacoes sobre o comportamento do Postgres, e todas as quatro
-- decidem dinheiro -- `group_members.percentage` e o peso com que o fechamento
-- do mes rateia a conta da casa. Nenhuma delas e verificavel lendo o TypeScript,
-- e todas falham de um jeito que parece sucesso:
--
--   1. um admin consegue escrever a `percentage` dos OUTROS membros. Se a RLS
--      nao deixasse, o PostgREST devolveria 200 com as linhas que passaram e a
--      configuracao ficaria pela metade;
--   2. um membro comum NAO consegue. `group_members_update` tem
--      `user_id = auth.uid() OR is_group_admin(group_id)`, e policy nao compara
--      OLD com NEW nem restringe coluna;
--   3. o lote e ATOMICO. E a razao de a rota mandar um `upsert` so em vez de um
--      UPDATE por membro: falhar no terceiro de quatro deixaria a configuracao
--      somando 70%, e nenhum CHECK conserta isso depois (o
--      `group_members_percentage_check` confere LINHA, nao conjunto);
--   4. `group_id`/`user_id` precisam ir no payload do upsert, por dois motivos
--      independentes -- e nenhum dos dois e obvio, porque nenhuma linha nova
--      chega a ser criada.
--
-- O CASO 5 e sobre o tipo da coluna: `numeric(5,2)` arredonda CALADO. E a razao
-- de a rota gravar o numero normalizado em centesimos, e nao o que veio no
-- corpo.
--
-- Sem o `SET LOCAL ROLE authenticated` dos casos 1, 2 e 4a isto rodaria como
-- superusuario, que ignora RLS, e os casos passariam sem provar nada.

BEGIN;

-- --- cenario ---------------------------------------------------------------
-- Tres membros, e o INATIVO nao e enfeite: a rota exige que o corpo liste
-- exatamente os ATIVOS, e nao pode tocar em quem saiu do grupo.

INSERT INTO auth.users (id, email)
VALUES
  ('d0000000-0000-0000-0000-00000000000a', 'hmo269-admin@teste.local'),
  ('d0000000-0000-0000-0000-00000000000b', 'hmo269-membro@teste.local'),
  ('d0000000-0000-0000-0000-00000000000c', 'hmo269-inativo@teste.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name)
VALUES
  ('d0000000-0000-0000-0000-00000000000a', 'hmo269-admin@teste.local', 'Admin'),
  ('d0000000-0000-0000-0000-00000000000b', 'hmo269-membro@teste.local', 'Membro'),
  ('d0000000-0000-0000-0000-00000000000c', 'hmo269-inativo@teste.local', 'Inativo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.expense_groups (id, name, group_code, created_by, is_active)
VALUES ('e0000000-0000-0000-0000-000000000001', 'Casa HMO-269', 'HMO269',
        'd0000000-0000-0000-0000-00000000000a', true);

-- O trigger do baseline ja poe o criador como admin; so fixamos o id da linha
-- dele para os casos abaixo poderem referencia-la.
UPDATE public.group_members SET id = 'f0000000-0000-0000-0000-00000000000a'
 WHERE group_id = 'e0000000-0000-0000-0000-000000000001'
   AND user_id = 'd0000000-0000-0000-0000-00000000000a';

INSERT INTO public.group_members (id, group_id, user_id, role, status, percentage)
VALUES
  ('f0000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-00000000000b', 'member', 'active',   0.00),
  ('f0000000-0000-0000-0000-00000000000c', 'e0000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-00000000000c', 'member', 'inactive', 0.00);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.group_members
       WHERE group_id = 'e0000000-0000-0000-0000-000000000001') <> 3 THEN
    RAISE EXCEPTION 'cenario: esperava 3 linhas de membro';
  END IF;
  -- Se o DEFAULT da coluna deixar de ser 0.00, os casos abaixo passam a medir
  -- outra coisa: "ficou 70" deixaria de distinguir "foi gravado" de "ja era".
  IF (SELECT count(*) FROM public.group_members
       WHERE group_id = 'e0000000-0000-0000-0000-000000000001'
         AND percentage <> 0.00) > 0 THEN
    RAISE EXCEPTION 'cenario: algum membro nao nasceu em 0.00';
  END IF;
  RAISE NOTICE 'CENARIO OK: 3 membros (2 ativos, 1 inativo), todos em 0.00';
END $$;


-- --- 1. o ADMIN grava a porcentagem de TODO MUNDO, num statement so --------
-- Este e o INSERT ... ON CONFLICT que o supabase-js monta a partir do
-- `.upsert([...], { onConflict: "id" })` da rota.

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'd0000000-0000-0000-0000-00000000000a';

INSERT INTO public.group_members (id, group_id, user_id, percentage)
VALUES
  ('f0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-00000000000a', 70.00),
  ('f0000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-00000000000b', 30.00)
ON CONFLICT (id) DO UPDATE
  SET group_id   = excluded.group_id,
      user_id    = excluded.user_id,
      percentage = excluded.percentage;

RESET ROLE;

DO $$
DECLARE pa numeric; pb numeric; pc numeric;
BEGIN
  SELECT percentage INTO pa FROM public.group_members WHERE id = 'f0000000-0000-0000-0000-00000000000a';
  SELECT percentage INTO pb FROM public.group_members WHERE id = 'f0000000-0000-0000-0000-00000000000b';
  SELECT percentage INTO pc FROM public.group_members WHERE id = 'f0000000-0000-0000-0000-00000000000c';
  IF pa <> 70.00 OR pb <> 30.00 THEN
    RAISE EXCEPTION 'CASO 1: releitura deu A=% B=% (esperado 70/30)', pa, pb;
  END IF;
  IF pc <> 0.00 THEN
    RAISE EXCEPTION 'CASO 1: o membro INATIVO foi tocado (ficou %)', pc;
  END IF;
  RAISE NOTICE 'CASO 1 OK: admin gravou 70/30 num statement; inativo intacto em 0.00';
END $$;


-- --- 2. o membro comum NAO reescreve a linha do outro ----------------------
-- O ponto que vale o teste nao e so "e barrado": e que ele e barrado com ERRO.
-- Num UPDATE simples a clausula USING da RLS so FILTRA, e a chamada volta
-- "sucesso, 0 linhas" -- que o PostgREST entrega como 200 e a rota leria como
-- gravacao feita. Aqui a recusa estoura, e e por isso que a rota pode confiar
-- no `error` do upsert (alem de conferir a contagem de linhas devolvidas).

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'd0000000-0000-0000-0000-00000000000b';

DO $$
BEGIN
  INSERT INTO public.group_members (id, group_id, user_id, percentage)
  VALUES
    ('f0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001',
     'd0000000-0000-0000-0000-00000000000a',  1.00),
    ('f0000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-000000000001',
     'd0000000-0000-0000-0000-00000000000b', 99.00)
  ON CONFLICT (id) DO UPDATE
    SET group_id   = excluded.group_id,
        user_id    = excluded.user_id,
        percentage = excluded.percentage;
  RAISE EXCEPTION 'CASO 2: membro comum conseguiu reescrever a linha do admin';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'CASO 2 OK: nao-admin recusado com ERRO pela RLS (%)', SQLERRM;
END $$;

RESET ROLE;

DO $$
DECLARE pa numeric; pb numeric;
BEGIN
  SELECT percentage INTO pa FROM public.group_members WHERE id = 'f0000000-0000-0000-0000-00000000000a';
  SELECT percentage INTO pb FROM public.group_members WHERE id = 'f0000000-0000-0000-0000-00000000000b';
  IF pa <> 70.00 OR pb <> 30.00 THEN
    RAISE EXCEPTION 'CASO 2: a tentativa do nao-admin gravou alguma coisa (A=% B=%)', pa, pb;
  END IF;
  RAISE NOTICE 'CASO 2b OK: nada do nao-admin ficou gravado -- ainda 70/30';
END $$;


-- --- 3. o lote e ATOMICO ---------------------------------------------------
-- Uma linha reprovada derruba as outras do mesmo statement. E o que autoriza a
-- rota a nao ter rollback entre membros: nao existe estado intermediario.

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'd0000000-0000-0000-0000-00000000000a';

DO $$
BEGIN
  INSERT INTO public.group_members (id, group_id, user_id, percentage)
  VALUES
    ('f0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001',
     'd0000000-0000-0000-0000-00000000000a',  10.00),
    ('f0000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-000000000001',
     'd0000000-0000-0000-0000-00000000000b', 150.00)
  ON CONFLICT (id) DO UPDATE
    SET percentage = excluded.percentage;
  RAISE EXCEPTION 'CASO 3: o CHECK 0..100 aceitou 150';
EXCEPTION
  WHEN check_violation THEN
    RAISE NOTICE 'CASO 3 OK: lote recusado pelo CHECK (%)', SQLERRM;
END $$;

RESET ROLE;

DO $$
DECLARE pa numeric; pb numeric;
BEGIN
  SELECT percentage INTO pa FROM public.group_members WHERE id = 'f0000000-0000-0000-0000-00000000000a';
  SELECT percentage INTO pb FROM public.group_members WHERE id = 'f0000000-0000-0000-0000-00000000000b';
  -- A assercao que importa e sobre o membro A: o valor dele (10.00) era VALIDO
  -- e vinha ANTES na lista. Se o lote nao fosse atomico, ele teria gravado.
  IF pa <> 70.00 OR pb <> 30.00 THEN
    RAISE EXCEPTION 'CASO 3: gravacao PARCIAL -- A=% B=% (esperado 70/30 intactos)', pa, pb;
  END IF;
  RAISE NOTICE 'CASO 3b OK: ATOMICO -- a linha VALIDA do lote tambem nao gravou';
END $$;


-- --- 4. por que group_id/user_id vao no payload do upsert ------------------
-- Dois motivos independentes, e nenhum deles e visivel no TypeScript. Cada um
-- e isolado no seu caso: 4a com a RLS no caminho, 4b sem ela.

-- 4a. a policy de INSERT e avaliada mesmo quando a linha ja existe e so vai ser
--     ATUALIZADA. Sem `group_id` ela chama `is_group_admin(NULL)`.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'd0000000-0000-0000-0000-00000000000a';

DO $$
BEGIN
  INSERT INTO public.group_members (id, percentage)
  VALUES ('f0000000-0000-0000-0000-00000000000a', 50.00)
  ON CONFLICT (id) DO UPDATE SET percentage = excluded.percentage;
  RAISE EXCEPTION
    'CASO 4a: upsert sem group_id passou pela RLS -- o payload da rota pode encolher, e este teste esta desatualizado';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'CASO 4a OK: a policy de INSERT reprova a tupla proposta (%)', SQLERRM;
END $$;

RESET ROLE;

-- 4b. e, com a RLS fora do caminho (superusuario), o NOT NULL estoura sozinho.
--     Os dois motivos valem por si: consertar um nao dispensaria o outro.
DO $$
BEGIN
  INSERT INTO public.group_members (id, percentage)
  VALUES ('f0000000-0000-0000-0000-00000000000a', 50.00)
  ON CONFLICT (id) DO UPDATE SET percentage = excluded.percentage;
  RAISE EXCEPTION
    'CASO 4b: NOT NULL nao disparou em linha que conflita -- este teste esta desatualizado';
EXCEPTION
  WHEN not_null_violation THEN
    RAISE NOTICE 'CASO 4b OK: NOT NULL de group_id estoura mesmo com conflito garantido (%)', SQLERRM;
END $$;

DO $$
DECLARE pa numeric;
BEGIN
  SELECT percentage INTO pa FROM public.group_members WHERE id = 'f0000000-0000-0000-0000-00000000000a';
  IF pa <> 70.00 THEN
    RAISE EXCEPTION 'CASO 4: alguma das duas tentativas gravou (A=%)', pa;
  END IF;
  RAISE NOTICE 'CASO 4c OK: nenhuma das duas tentativas gravou -- A ainda 70.00';
END $$;


-- --- 5. numeric(5,2) arredonda CALADO --------------------------------------
-- Por isso a rota grava `paraPercentual(dePercentual(x))` e nao o numero do
-- corpo: tres membros com 33.333 somam 99.999 no corpo (que arredonda para
-- "100" em qualquer conferencia de float) e 99.99 no banco -- um residual que
-- pagamento nenhum zera.

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'd0000000-0000-0000-0000-00000000000a';

INSERT INTO public.group_members (id, group_id, user_id, percentage)
VALUES ('f0000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-000000000001',
        'd0000000-0000-0000-0000-00000000000b', 33.333)
ON CONFLICT (id) DO UPDATE SET percentage = excluded.percentage;

RESET ROLE;

DO $$
DECLARE pb numeric;
BEGIN
  SELECT percentage INTO pb FROM public.group_members WHERE id = 'f0000000-0000-0000-0000-00000000000b';
  IF pb <> 33.33 THEN
    RAISE EXCEPTION 'CASO 5: 33.333 virou % (esperava 33.33)', pb;
  END IF;
  RAISE NOTICE 'CASO 5 OK: 33.333 gravou 33.33, sem erro e sem aviso';
END $$;

ROLLBACK;
