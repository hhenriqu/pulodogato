-- ===========================================================================
-- 056 -- A CONTA PADRAO DO USUARIO NOVO: SO CONTA CORRENTE E DINHEIRO (HMO-412)
-- ===========================================================================
-- Parte 3b do plano aprovado da HMO-407 (documento `plan`, revisao 1).
-- Decisao D2, aprovada: das quatro contas que o cadastro cria hoje, ficam DUAS.
--
-- Medido no commit `54c0ab7` da main, num Postgres 17 local com a cadeia
-- 001 -> 054 aplicada, chamando a funcao num usuario recem-criado:
--
--     ANTES (4 linhas)                       DEPOIS (2 linhas)
--     -----------------------------------    --------------------------------
--     Cartão de Crédito  credit_card         Conta Corrente  checking
--     Conta Corrente     checking            Dinheiro        cash
--     Dinheiro           cash
--     PIX                digital
--
-- POR QUE SAEM AS DUAS, E NAO SO O PIX
-- ------------------------------------
-- A leitura literal de "somente conta corrente e dinheiro" tira o PIX E o
-- Cartao de Credito. O cartao nao e so uma conta a menos na lista: ele se
-- cadastra em `/dashboard/cartoes`, que e onde ele ganha limite e dia de
-- fechamento. O cartao que o cadastro criava nascia sem nenhum dos dois, e um
-- cartao sem fechamento nao tem fatura -- entao ele aparecia no seletor de
-- lancamento sem conseguir fazer a unica coisa que um cartao faz aqui.
--
-- NAO HA BACKFILL, E ISSO E DELIBERADO
-- ------------------------------------
-- Quem ja tem uma conta PIX ou um Cartao de Credito criados pelo cadastro
-- CONTINUA com eles, inclusive vazios. Apagar conta que ja existe apagaria
-- lancamento junto (`financial_transactions.account_id`), e nao ha como
-- distinguir, depois do fato, a conta que o cadastro criou e ninguem usou da
-- conta que a pessoa adotou como a dela. O custo de deixar e uma conta a mais
-- na lista de quem ja se cadastrou; o custo de apagar e dinheiro lancado.
--
-- ADITIVA DO PONTO DE VISTA DO APP NO AR
-- --------------------------------------
-- `create_default_accounts` e chamada de UM lugar so --
-- `app/api/financial-accounts/route.ts`, no GET, e somente quando a pessoa
-- ainda nao tem conta nenhuma. Ela nao e chamada por trigger, por cron nem por
-- outra funcao do banco (nenhuma outra referencia no repositorio fora o
-- inventario de nomes do 001). Colar este arquivo com o codigo "velho" no ar e
-- inofensivo: quem ja tem conta nunca chega na funcao, e quem nao tem passa a
-- receber duas em vez de quatro, que e exatamente o que esta sendo pedido.
--
-- IDEMPOTENTE: `CREATE OR REPLACE FUNCTION`, nada mais. Re-rodar substitui a
-- funcao pela mesma definicao. Nao ha ALTER de tabela, CHECK novo nem backfill,
-- entao o re-run nao precisa de guarda.
--
-- A definicao abaixo e a do 001 (`001_baseline.sql`, linhas 350-366) com as
-- duas linhas do INSERT removidas. A assinatura, o `RETURNS void`, o
-- `LANGUAGE plpgsql`, o `SECURITY DEFINER` e a guarda de "ja tem conta" sao
-- identicos de proposito: `CREATE OR REPLACE FUNCTION` so substitui a funcao de
-- assinatura igual, e mudar qualquer parte dela deixaria a antiga viva ao lado
-- da nova (ver `database/tests/legacy_function_drift_test.sql`).
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.create_default_accounts(p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    -- Verificar se o usuário já tem contas
    IF EXISTS (SELECT 1 FROM financial_accounts WHERE user_id = p_user_id) THEN
        RETURN;
    END IF;

    -- Criar contas padrão: somente Conta Corrente e Dinheiro (HMO-412).
    -- Cartão de Crédito sai porque ele se cadastra em /dashboard/cartoes, que
    -- é onde ele ganha limite e fechamento; PIX sai porque é forma de
    -- pagamento da conta corrente, e não uma conta com saldo próprio.
    INSERT INTO financial_accounts (user_id, name, account_type, icon, color_hex) VALUES
    (p_user_id, 'Conta Corrente', 'checking', 'building', '#10B981'),
    (p_user_id, 'Dinheiro', 'cash', 'banknote', '#84CC16');
END;
$$;

COMMENT ON FUNCTION public.create_default_accounts(uuid) IS
  'HMO-412: cria as contas padrao do usuario novo -- somente Conta Corrente e '
  'Dinheiro. Chamada pelo GET /api/financial-accounts quando a pessoa ainda '
  'nao tem conta nenhuma; nao faz nada se ja houver qualquer conta.';
