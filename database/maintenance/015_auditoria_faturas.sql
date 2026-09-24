-- =====================================================
-- AUDITORIA: faturas de cartao pagas pelo caminho torto (HMO-149)
-- =====================================================
-- SOMENTE LEITURA. Nao altera nada, nao precisa de transacao, pode rodar em
-- producao a qualquer hora. Nenhum INSERT, UPDATE, DELETE nem DDL.
--
-- POR QUE ISTO EXISTE
-- -------------------
-- Ate o conserto do HMO-149, dar baixa na fatura do cartao lancava UMA
-- transacao negativa na conta do PROPRIO cartao. O trigger
-- `update_account_balance` soma NEW.amount na conta indicada, entao o cartao
-- ficava mais negativo pelo valor da fatura e a conta de onde o dinheiro
-- realmente saiu nao se mexia:
--
--   depois da compra de 1.000  | corrente 5.000 | cartao -1.000 | patrimonio 4.000
--   depois de pagar a fatura   | corrente 5.000 | cartao -2.000 | patrimonio 3.000
--
-- O certo e 4.000 nos dois momentos: a despesa aconteceu na compra, nao no
-- pagamento. Nada quebrava -- o patrimonio ficava menor, plausivel, com duas
-- casas decimais.
--
-- A migration 015 conserta o codigo E desfaz as baixas tortas que encontrar.
-- Este arquivo e o que se roda ANTES dela, para ver o tamanho do estrago e
-- decidir com a informacao na mao. A 015 escreve; este aqui so mostra.
--
-- LEIA ISTO ANTES DE CONFIAR NUM RESULTADO VAZIO
-- -----------------------------------------------
-- Rode como DONO DO SCHEMA (SQL Editor do Supabase), nunca com a credencial
-- `paperclip_ro`. Aquela credencial nao tem BYPASSRLS, e a RLS de
-- `scheduled_transactions` filtra por `auth.uid()`, que fora do app e NULL:
-- toda consulta abaixo devolve zero linhas independentemente do conteudo real
-- da tabela. Zero linhas lido por `paperclip_ro` NAO significa zero faturas
-- tortas -- significa que a consulta nao enxergou nada.
--
-- COMO RODAR
-- ----------
--   psql "$URL" -f database/maintenance/015_auditoria_faturas.sql
--   (ou colar no SQL Editor do Supabase)
-- =====================================================

-- ---------------------------------------------------------------------
-- 1. As baixas tortas, uma linha por fatura paga
-- ---------------------------------------------------------------------
-- A deteccao e pela CHAVE canonica em `notes`, nunca pelo tipo da conta --
-- exatamente como em lib/card-invoice.ts e na funcao de reparo da 015.
-- Assinatura cobrada no cartao tambem e uma conta prevista com `account_id`
-- do cartao, e pagar aquela conta COM o cartao e despesa de verdade. Quem
-- varresse por `account_type = 'credit_card'` listaria toda assinatura de
-- cartao ja paga como estrago, e o reparo apagaria despesa legitima.
--
-- A regex e ancorada nas duas pontas pelo mesmo motivo: sem o `$`, uma nota
-- escrita a mao como "fatura:2026-09-01:<uuid> paguei no debito" entraria.
--
--   valor_lancado     o que a baixa gravou (negativo)
--   correcao_no_cartao quanto o saldo do cartao volta quando a 015 desfazer
-- ---------------------------------------------------------------------
SELECT
  p.full_name                                  AS dono,
  a.name                                       AS cartao,
  substring(s.notes from '^fatura:(\d{4}-\d{2}-\d{2}):')::date
                                               AS mes_da_fatura,
  s.description                                AS conta_prevista,
  s.amount                                     AS valor_da_fatura,
  s.paid_date                                  AS pago_em,
  t.amount                                     AS valor_lancado,
  t.transaction_type                           AS tipo_lancado,
  -- Apagar a transacao faz o trigger devolver (current_balance - OLD.amount).
  -- OLD.amount e negativo, entao a correcao e positiva: o cartao sobe.
  (-t.amount)::numeric(15,2)                   AS correcao_no_cartao,
  s.id                                         AS scheduled_id,
  t.id                                         AS transaction_id
FROM public.scheduled_transactions s
JOIN public.financial_transactions t ON t.id = s.transaction_id
JOIN public.financial_accounts a ON a.id = t.account_id
LEFT JOIN public.profiles p ON p.id = s.user_id
WHERE s.status = 'paid'
  AND s.notes ~ '^fatura:\d{4}-\d{2}-\d{2}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  -- a transacao da baixa caiu no PROPRIO cartao da chave: e a baixa antiga
  AND t.account_id = (substring(s.notes from '^fatura:\d{4}-\d{2}-\d{2}:(.+)$'))::uuid
  -- a baixa nova grava duas pernas 'transfer' e jamais entra aqui
  AND t.transaction_type IS DISTINCT FROM 'transfer'
ORDER BY p.full_name, a.name, mes_da_fatura;

-- ---------------------------------------------------------------------
-- 2. A correcao de saldo por cartao
-- ---------------------------------------------------------------------
-- Uma linha por cartao afetado: o que o saldo diz hoje, e o que ele passa a
-- dizer depois que a 015 desfizer as baixas. A diferenca e a soma dos valores
-- das faturas pagas por aquele caminho.
--
-- `saldo_depois_do_reparo` NAO e o saldo "certo" em definitivo: e o saldo
-- como se aquelas faturas nunca tivessem sido baixadas. E o ponto: elas voltam
-- para 'pending' em Contas Previstas e o usuario da baixa de novo, agora
-- escolhendo a conta pagadora. So depois dessa segunda baixa o dinheiro que
-- saiu do banco fica registrado -- a 015 sozinha nao adivinha de qual conta
-- ele saiu, porque essa informacao nunca foi gravada.
-- ---------------------------------------------------------------------
SELECT
  p.full_name                                  AS dono,
  a.name                                       AS cartao,
  a.current_balance                            AS saldo_hoje,
  count(*)                                     AS faturas_tortas,
  SUM(-t.amount)::numeric(15,2)                AS correcao_total,
  (a.current_balance + SUM(-t.amount))::numeric(15,2)
                                               AS saldo_depois_do_reparo,
  min(s.paid_date)                             AS primeira_baixa,
  max(s.paid_date)                             AS ultima_baixa
FROM public.scheduled_transactions s
JOIN public.financial_transactions t ON t.id = s.transaction_id
JOIN public.financial_accounts a ON a.id = t.account_id
LEFT JOIN public.profiles p ON p.id = s.user_id
WHERE s.status = 'paid'
  AND s.notes ~ '^fatura:\d{4}-\d{2}-\d{2}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND t.account_id = (substring(s.notes from '^fatura:\d{4}-\d{2}-\d{2}:(.+)$'))::uuid
  AND t.transaction_type IS DISTINCT FROM 'transfer'
GROUP BY p.full_name, a.id, a.name, a.current_balance
ORDER BY SUM(-t.amount) DESC;

-- ---------------------------------------------------------------------
-- 3. O que a varredura NAO vai tocar, e deve mesmo ficar de fora
-- ---------------------------------------------------------------------
-- Um reparo que erra para o outro lado apaga despesa boa, e isso e pior:
-- ninguem procura por dinheiro que sumiu do relatorio. Estas duas contagens
-- existem para conferir o escopo antes de rodar a 015.
--
--   assinaturas_no_cartao  conta prevista paga COM o cartao que NAO e fatura
--                          (assinatura, anuidade). Despesa de verdade; o saldo
--                          do cartao tem que descer mesmo. Fica de fora porque
--                          a deteccao e pela chave, nao pelo account_type.
--   notas_parecidas        `notes` que comeca com 'fatura:' mas nao casa a
--                          chave canonica inteira. Texto do usuario, nao regra
--                          de negocio. Se este numero for > 0, vale olhar as
--                          linhas antes de rodar a 015.
--   baixas_novas           faturas ja pagas pelo caminho certo (duas pernas
--                          'transfer'). A 015 nao as toca; se ela rodar duas
--                          vezes, a segunda passada nao desfaz nenhuma.
-- ---------------------------------------------------------------------
SELECT
  -- `notes IS NULL OR notes !~ ...`, e nao so o `!~`: com notes NULL o `!~`
  -- devolve NULL, o FILTER descarta a linha, e a assinatura sem anotacao --
  -- o caso mais comum -- sumiria justamente da contagem que existe para
  -- garantir que ela NAO sera tocada. Undercount aqui le como "nao ha nada a
  -- proteger", que e o contrario do que o numero deve dizer.
  count(*) FILTER (
    WHERE t.account_id = s.account_id
      AND a.account_type = 'credit_card'
      AND (s.notes IS NULL
           OR s.notes !~ '^fatura:\d{4}-\d{2}-\d{2}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
  )                                            AS assinaturas_no_cartao,
  count(*) FILTER (
    WHERE s.notes LIKE 'fatura:%'
      AND s.notes !~ '^fatura:\d{4}-\d{2}-\d{2}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  )                                            AS notas_parecidas,
  count(*) FILTER (
    WHERE s.notes ~ '^fatura:\d{4}-\d{2}-\d{2}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      AND t.transaction_type = 'transfer'
  )                                            AS baixas_novas
FROM public.scheduled_transactions s
JOIN public.financial_transactions t ON t.id = s.transaction_id
LEFT JOIN public.financial_accounts a ON a.id = t.account_id
WHERE s.status = 'paid';
