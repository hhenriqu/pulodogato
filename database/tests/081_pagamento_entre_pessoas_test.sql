-- =====================================================
-- 081 -- o pagamento entre pessoas chega a quem recebe
-- =====================================================
-- Roda no db-verify contra o banco que as migrations constroem do zero, com a
-- 081 ja aplicada. Tudo num BEGIN com ROLLBACK.
--
-- Personagens: Ana paga, Beto recebe (os dois na casa), Caio fora da casa.
--
-- O que ele fixa:
--   (1) Ana cria o pagamento a partir da propria despesa, para o Beto;
--   (2) os dois leem a linha, o Caio nao; a lista traz o nome do outro lado
--       e a situacao de cada um;
--   (3) nao paga para quem nao divide grupo, nem com lancamento alheio, nem
--       com valor diferente, nem com entrada no lugar da saida;
--   (4) Beto confirma com a PROPRIA receita do mesmo valor; com a receita de
--       outro valor, ou com lancamento da Ana, e recusado;
--   (5) Beto nao muda valor nem data; Ana nao confirma por ele;
--   (6) Beto apagando a receita volta para "a lancar"; Ana apagando a despesa
--       leva o pagamento junto e a receita do Beto fica;
--   (7) recusar: Beto marca recusado; Ana nao recusa por ele.
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect_text(label TEXT, got TEXT, want TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, veio %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: %', label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_erro_com(label TEXT, sql TEXT, trecho TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(trecho IN SQLSTATE || ' ' || SQLERRM) = 0 THEN
      RAISE EXCEPTION 'FALHA: % -> barrado, mas por outro motivo: % %', label, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'ok: % (barrado: %)', label, left(SQLERRM, 80);
    RETURN;
  END;
  RAISE EXCEPTION 'FALHA: % -> o comando PASSOU e deveria ter sido barrado', label;
END $$;

INSERT INTO auth.users (id, email) VALUES
  ('a0810000-0000-0000-0000-0000000000a1', 'ana@pag081.local'),
  ('a0810000-0000-0000-0000-0000000000b1', 'beto@pag081.local'),
  ('a0810000-0000-0000-0000-0000000000c1', 'caio@pag081.local');
INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('a0810000-0000-0000-0000-0000000000a1', 'Ana', FALSE),
  ('a0810000-0000-0000-0000-0000000000b1', 'Beto', FALSE),
  ('a0810000-0000-0000-0000-0000000000c1', 'Caio', FALSE)
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, is_public = EXCLUDED.is_public;

INSERT INTO public.expense_groups (id, name, created_by, group_code, group_kind) VALUES
  ('a0810000-0000-0000-0000-0000000000e1', 'Casa', 'a0810000-0000-0000-0000-0000000000a1', 'PAG811', 'casa');
INSERT INTO public.group_members (group_id, user_id, role, status)
SELECT 'a0810000-0000-0000-0000-0000000000e1', 'a0810000-0000-0000-0000-0000000000b1', 'member', 'active'
 WHERE NOT EXISTS (SELECT 1 FROM public.group_members
                    WHERE group_id = 'a0810000-0000-0000-0000-0000000000e1'
                      AND user_id = 'a0810000-0000-0000-0000-0000000000b1');
INSERT INTO public.group_members (group_id, user_id, role, status)
SELECT 'a0810000-0000-0000-0000-0000000000e1', 'a0810000-0000-0000-0000-0000000000a1', 'admin', 'active'
 WHERE NOT EXISTS (SELECT 1 FROM public.group_members
                    WHERE group_id = 'a0810000-0000-0000-0000-0000000000e1'
                      AND user_id = 'a0810000-0000-0000-0000-0000000000a1');

-- Os lancamentos (como dono da tabela: so o que interessa aqui e o pagamento).
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, description, amount, transaction_date, transaction_type)
VALUES
  -- Ana: a despesa do pagamento, uma segunda despesa, e uma receita.
  ('a0810000-0000-0000-0000-000000000101', 'a0810000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'Pagamento para Beto', -607.95, DATE '2026-11-03', 'expense'),
  ('a0810000-0000-0000-0000-000000000102', 'a0810000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'Outra despesa', -50.00, DATE '2026-11-03', 'expense'),
  ('a0810000-0000-0000-0000-000000000103', 'a0810000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'Receita da Ana', 607.95, DATE '2026-11-03', 'income'),
  -- Beto: a receita certa e uma de valor errado.
  ('a0810000-0000-0000-0000-000000000201', 'a0810000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'Recebido da Ana', 607.95, DATE '2026-11-03', 'income'),
  ('a0810000-0000-0000-0000-000000000202', 'a0810000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'Valor errado', 600.00, DATE '2026-11-03', 'income'),
  ('a0810000-0000-0000-0000-000000000203', 'a0810000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'Despesa do Beto', -607.95, DATE '2026-11-03', 'expense');

-- =====================================================
-- SECAO 1 e 3: quem cria, e o que e recusado
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0810000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect_text('Ana pode pagar so para o Beto',
  (SELECT string_agg(nome, ',') FROM public.pessoas_para_pagamento()), 'Beto');

SELECT pg_temp.expect_erro_com('nao paga para quem nao divide grupo',
  $sql$INSERT INTO public.pagamentos_entre_pessoas (pagador_id, recebedor_id, valor, data, lancamento_do_pagador)
       VALUES ('a0810000-0000-0000-0000-0000000000a1', 'a0810000-0000-0000-0000-0000000000c1',
               607.95, DATE '2026-11-03', 'a0810000-0000-0000-0000-000000000101')$sql$,
  '42501');
SELECT pg_temp.expect_erro_com('nao cria em nome de outra pessoa',
  $sql$INSERT INTO public.pagamentos_entre_pessoas (pagador_id, recebedor_id, valor, data, lancamento_do_pagador)
       VALUES ('a0810000-0000-0000-0000-0000000000b1', 'a0810000-0000-0000-0000-0000000000a1',
               607.95, DATE '2026-11-03', 'a0810000-0000-0000-0000-000000000203')$sql$,
  '42501');
SELECT pg_temp.expect_erro_com('valor diferente do lancamento e recusado',
  $sql$INSERT INTO public.pagamentos_entre_pessoas (pagador_id, recebedor_id, valor, data, lancamento_do_pagador)
       VALUES ('a0810000-0000-0000-0000-0000000000a1', 'a0810000-0000-0000-0000-0000000000b1',
               607.95, DATE '2026-11-03', 'a0810000-0000-0000-0000-000000000102')$sql$,
  'PDG81');
SELECT pg_temp.expect_erro_com('entrada no lugar da saida e recusada',
  $sql$INSERT INTO public.pagamentos_entre_pessoas (pagador_id, recebedor_id, valor, data, lancamento_do_pagador)
       VALUES ('a0810000-0000-0000-0000-0000000000a1', 'a0810000-0000-0000-0000-0000000000b1',
               607.95, DATE '2026-11-03', 'a0810000-0000-0000-0000-000000000103')$sql$,
  'PDG81');

INSERT INTO public.pagamentos_entre_pessoas
  (id, pagador_id, recebedor_id, valor, data, descricao, lancamento_do_pagador)
VALUES
  ('a0810000-0000-0000-0000-0000000000f1', 'a0810000-0000-0000-0000-0000000000a1',
   'a0810000-0000-0000-0000-0000000000b1', 607.95, DATE '2026-11-03',
   'Pagamento para Beto', 'a0810000-0000-0000-0000-000000000101');
SELECT pg_temp.expect_text('Ana cria o pagamento para o Beto',
  (SELECT situacao || ':' || outra_pessoa FROM public.meus_pagamentos_entre_pessoas()), 'a_lancar:Beto');

SELECT pg_temp.expect_erro_com('o mesmo lancamento nao vira dois pagamentos',
  $sql$INSERT INTO public.pagamentos_entre_pessoas (pagador_id, recebedor_id, valor, data, lancamento_do_pagador)
       VALUES ('a0810000-0000-0000-0000-0000000000a1', 'a0810000-0000-0000-0000-0000000000b1',
               607.95, DATE '2026-11-03', 'a0810000-0000-0000-0000-000000000101')$sql$,
  '23505');

-- =====================================================
-- SECAO 2: quem le
-- =====================================================
SET LOCAL request.jwt.claim.sub = 'a0810000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect_text('Beto ve "Ana te pagou", a lancar',
  (SELECT papel || ':' || outra_pessoa || ':' || valor::text || ':' || situacao
     FROM public.meus_pagamentos_entre_pessoas()), 'recebi:Ana:607.95:a_lancar');
SELECT pg_temp.expect_text('Beto nao recebe o id da despesa da Ana',
  (SELECT (lancamento_do_pagador IS NULL)::text FROM public.meus_pagamentos_entre_pessoas()), 'true');

SET LOCAL request.jwt.claim.sub = 'a0810000-0000-0000-0000-0000000000c1';
SELECT pg_temp.expect_text('Caio nao ve nada',
  (SELECT count(*)::text FROM public.pagamentos_entre_pessoas), '0');
SELECT pg_temp.expect_text('nem pela lista',
  (SELECT count(*)::text FROM public.meus_pagamentos_entre_pessoas()), '0');
SELECT pg_temp.expect_text('e o Caio nao tem para quem pagar',
  (SELECT count(*)::text FROM public.pessoas_para_pagamento()), '0');

-- =====================================================
-- SECAO 4 e 5: a confirmacao
-- =====================================================
SET LOCAL request.jwt.claim.sub = 'a0810000-0000-0000-0000-0000000000a1';
-- A RLS esconde a linha do UPDATE da Ana: 0 linhas, e a situacao nao muda.
UPDATE public.pagamentos_entre_pessoas
   SET lancamento_do_recebedor = 'a0810000-0000-0000-0000-000000000103'
 WHERE id = 'a0810000-0000-0000-0000-0000000000f1';
SELECT pg_temp.expect_text('Ana nao confirma pelo Beto',
  (SELECT situacao FROM public.meus_pagamentos_entre_pessoas()), 'a_lancar');

SET LOCAL request.jwt.claim.sub = 'a0810000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect_erro_com('Beto nao muda o valor',
  $sql$UPDATE public.pagamentos_entre_pessoas SET valor = 1 WHERE id = 'a0810000-0000-0000-0000-0000000000f1'$sql$,
  '42501');
SELECT pg_temp.expect_erro_com('Beto nao confirma com receita de outro valor',
  $sql$UPDATE public.pagamentos_entre_pessoas SET lancamento_do_recebedor = 'a0810000-0000-0000-0000-000000000202'
        WHERE id = 'a0810000-0000-0000-0000-0000000000f1'$sql$,
  'PDG81');
SELECT pg_temp.expect_erro_com('Beto nao confirma com lancamento da Ana',
  $sql$UPDATE public.pagamentos_entre_pessoas SET lancamento_do_recebedor = 'a0810000-0000-0000-0000-000000000103'
        WHERE id = 'a0810000-0000-0000-0000-0000000000f1'$sql$,
  'PDG81');

UPDATE public.pagamentos_entre_pessoas
   SET lancamento_do_recebedor = 'a0810000-0000-0000-0000-000000000201'
 WHERE id = 'a0810000-0000-0000-0000-0000000000f1';
SELECT pg_temp.expect_text('Beto confirma com a propria receita',
  (SELECT situacao FROM public.meus_pagamentos_entre_pessoas()), 'lancado');

SET LOCAL request.jwt.claim.sub = 'a0810000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect_text('Ana ve que o Beto lancou',
  (SELECT situacao FROM public.meus_pagamentos_entre_pessoas()), 'lancado');

-- =====================================================
-- SECAO 6: apagar de cada lado
-- =====================================================
RESET ROLE;
DELETE FROM public.financial_transactions WHERE id = 'a0810000-0000-0000-0000-000000000201';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0810000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect_text('Beto apagou a receita: volta a lancar',
  (SELECT situacao FROM public.meus_pagamentos_entre_pessoas()), 'a_lancar');

-- =====================================================
-- SECAO 7: recusar
-- =====================================================
SET LOCAL request.jwt.claim.sub = 'a0810000-0000-0000-0000-0000000000a1';
UPDATE public.pagamentos_entre_pessoas SET recusado_em = now()
 WHERE id = 'a0810000-0000-0000-0000-0000000000f1';
SELECT pg_temp.expect_text('Ana nao recusa pelo Beto',
  (SELECT situacao FROM public.meus_pagamentos_entre_pessoas()), 'a_lancar');

SET LOCAL request.jwt.claim.sub = 'a0810000-0000-0000-0000-0000000000b1';
UPDATE public.pagamentos_entre_pessoas SET recusado_em = now()
 WHERE id = 'a0810000-0000-0000-0000-0000000000f1';
SELECT pg_temp.expect_text('Beto recusa',
  (SELECT situacao FROM public.meus_pagamentos_entre_pessoas()), 'recusado');
DELETE FROM public.pagamentos_entre_pessoas
 WHERE id = 'a0810000-0000-0000-0000-0000000000f1';
SELECT pg_temp.expect_text('Beto nao apaga o pagamento da Ana',
  (SELECT count(*)::text FROM public.meus_pagamentos_entre_pessoas()), '1');

-- Ana apaga a despesa: o pagamento vai junto.
RESET ROLE;
DELETE FROM public.financial_transactions WHERE id = 'a0810000-0000-0000-0000-000000000101';
SELECT pg_temp.expect_text('Ana apagou a despesa: o pagamento foi junto',
  (SELECT count(*)::text FROM public.pagamentos_entre_pessoas
    WHERE id = 'a0810000-0000-0000-0000-0000000000f1'), '0');

ROLLBACK;
