-- =====================================================
-- AUDITORIA: quanto o saldo das contas derivou
-- =====================================================
-- SOMENTE LEITURA. Nao altera nada, nao precisa de transacao, pode rodar em
-- producao a qualquer hora.
--
-- POR QUE ISTO EXISTE
-- -------------------
-- Ate a migration 007, `update_account_balance()` somava NEW.amount no saldo a
-- cada UPDATE sem nunca estornar OLD.amount. Toda edicao de lancamento --
-- inclusive trocar so a descricao -- descontava o valor uma segunda vez da
-- conta, em silencio.
--
-- A 007 conserta a funcao, mas NAO mexe no estrago ja feito. Recalcular
-- current_balance a partir das transacoes seria destrutivo: quem cadastrou uma
-- conta com saldo de abertura (o comum -- ninguem lanca a vida inteira de
-- extrato) veria esse valor virar zero. Trocaria um erro por outro, em cima de
-- dinheiro real.
--
-- Entao a decisao de corrigir, e como, e de quem conhece as contas. Esta
-- consulta e o que da a informacao para decidir.
--
-- COMO LER O RESULTADO
-- --------------------
--   saldo_atual      o que a coluna current_balance diz hoje
--   soma_lancamentos a soma de todas as transacoes daquela conta
--   diferenca        saldo_atual - soma_lancamentos
--
-- `diferenca` NAO e a deriva. Ela e a deriva MAIS o saldo de abertura da conta,
-- que nunca foi lancado como transacao. Ou seja: uma conta aberta com
-- R$ 5.000 e sem nenhuma edicao mostra diferenca de 5.000 e esta certa.
--
-- O que denuncia o bug e a diferenca NEGATIVA, ou positiva de um valor que nao
-- corresponde a nenhum saldo inicial plausivel. Cada edicao de despesa deixou
-- a diferenca mais negativa pelo valor da despesa.
--
-- COMO RODAR
-- ----------
--   psql "$URL" -f database/maintenance/007_auditoria_saldos.sql
--   (ou colar no SQL Editor do Supabase)
-- =====================================================

SELECT
  a.id,
  p.full_name                              AS dono,
  a.name                                   AS conta,
  a.account_type                           AS tipo,
  a.current_balance                        AS saldo_atual,
  COALESCE(t.soma, 0)::numeric(15,2)       AS soma_lancamentos,
  (a.current_balance - COALESCE(t.soma, 0))::numeric(15,2) AS diferenca,
  COALESCE(t.quantos, 0)                   AS qtd_lancamentos,
  -- Conta com lancamento mas com diferenca negativa e o caso suspeito: nao ha
  -- saldo de abertura negativo comum, e cada edicao empurrava para baixo.
  CASE
    WHEN COALESCE(t.quantos, 0) = 0 THEN 'sem lancamento - diferenca e o saldo de abertura'
    WHEN (a.current_balance - COALESCE(t.soma, 0)) < 0 THEN 'SUSPEITO: diferenca negativa'
    ELSE 'compativel com saldo de abertura'
  END AS leitura
FROM public.financial_accounts a
LEFT JOIN public.profiles p ON p.id = a.user_id
LEFT JOIN LATERAL (
  SELECT SUM(ft.amount) AS soma, COUNT(*) AS quantos
    FROM public.financial_transactions ft
   WHERE ft.account_id = a.id
) AS t ON TRUE
ORDER BY (a.current_balance - COALESCE(t.soma, 0)) ASC;

-- ---------------------------------------------------------------------
-- Quantas transacoes foram editadas alguma vez. Cada uma dessas edicoes
-- cobrou o valor uma segunda vez da conta, enquanto a 007 nao estava aplicada.
--
-- `updated_at > created_at` subestima: varias edicoes da mesma transacao
-- contam uma vez so aqui, e cada uma delas descontou de novo. O numero abaixo
-- e o PISO do estrago, nao o total.
-- ---------------------------------------------------------------------
SELECT
  count(*) FILTER (WHERE ft.updated_at > ft.created_at + INTERVAL '1 second')
                                            AS transacoes_editadas,
  count(*)                                  AS transacoes_no_total,
  SUM(ABS(ft.amount)) FILTER (WHERE ft.updated_at > ft.created_at + INTERVAL '1 second')
                                            AS valor_das_editadas
FROM public.financial_transactions ft;
