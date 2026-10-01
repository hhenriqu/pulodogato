-- 034_moeda_da_conta_prevista.sql
--
-- HMO-184. `scheduled_transactions.currency` existe desde a 022, o app NUNCA a
-- escreve, e nao existe `exchange_rate` nenhuma para converte-la. Esta migration
-- nao da moeda a conta prevista: ela TRANCA a coluna em 'BRL' e passa a dizer a
-- verdade sobre o que a conta prevista e.
--
-- ===========================================================================
-- POR QUE TRANCAR, E NAO COMPLETAR
-- ===========================================================================
-- A leitura obvia da issue era a oposta -- "a coluna existe pela metade, logo
-- complete-a": grave `currency` no INSERT e acrescente `exchange_rate` com os
-- tres CHECKs da 026. Essa leitura nao sobrevive a tres fatos que ja estao no
-- repositorio, e o terceiro e decisivo.
--
--   1. A COTACAO DE UMA DATA FUTURA NAO EXISTE. A PTAX de 15/12 nao esta
--      publicada em 01/10. Uma `exchange_rate` na conta prevista seria uma
--      coluna NOT NULL cujo unico valor honesto e "ninguem sabe" -- e o DEFAULT
--      1 que a 026 usou como backfill aqui nao seria backfill de nada: seria o
--      numero errado nascendo em toda linha nova.
--
--   2. A DECISAO JA FOI TOMADA E JA ESTA NO AR. A HMO-188 fechou exatamente
--      esta pergunta em lib/lancamento.ts, e a resposta e uma frase que o
--      usuario ja le hoje:
--
--        "Em USD nao da para deixar previsto: a cotacao de uma data futura
--         ainda nao existe. Lance no dia em que pagar, com a cotacao do dia."
--
--      Ou seja: o produto JA decidiu que previsao e em real. O que falta nao e
--      a decisao -- e o banco concordar com ela.
--
--   3. A BAIXA NAO SABE DE MOEDA, E ESSE E O FURO DE VERDADE.
--      app/api/scheduled-transactions/[id]/pay/route.ts insere em
--      `financial_transactions` SEM mandar `currency` nem `exchange_rate`: as
--      duas caem no DEFAULT do banco, (BRL, 1).
--
--      Repare no que isso faz com a sugestao "grave a moeda na previsao e
--      converta na baixa". Uma previsao de US$ 180 daria baixa como R$ 180 --
--      e o CHECK `(currency = 'BRL') = (exchange_rate = 1)` da 026 NAO PEGA,
--      porque a rota nao manda nenhuma das duas colunas e o par (BRL, 1) e
--      perfeitamente consistente consigo mesmo. O 23514 que protege o
--      lancamento manual nao protege este caminho. Seria um erro de 80% para
--      menos, sem erro em lugar nenhum -- a MESMA perda silenciosa que a SECAO
--      2 da 026 existe para fechar, entrando pela porta que ela nao cobre.
--
-- Entao a ordem certa e esta: primeiro o banco garante que previsao e BRL
-- (aqui), e so DEPOIS -- se um dia a previsao em moeda estrangeira for pedida
-- de verdade -- alguem reescreve a baixa para carregar moeda e cotacao, e
-- derruba este CHECK no mesmo PR. Trancar agora nao fecha aquela porta: deixa
-- o cadeado num lugar onde quem for abri-lo PRECISA ver a baixa primeiro.
--
-- ===========================================================================
-- O QUE ESTE CHECK PROTEGE, JA QUE NINGUEM ESCREVE A COLUNA
-- ===========================================================================
-- Hoje toda linha nasce no DEFAULT 'BRL' porque os tres unicos INSERTs que
-- existem omitem a coluna:
--
--   app/api/scheduled-transactions/route.ts      (conta avulsa)
--   app/api/card-invoices/close/route.ts         (fatura fechada vira a pagar)
--   lib/services/scheduled.ts                    (materializacao das regras)
--
-- ...e o PATCH de [id]/route.ts monta o patch por lista fechada de campos, sem
-- `currency`. Esta correto HOJE, e correto POR ACIDENTE: nada no banco impede
-- a quarta rota de gravar 'USD'. No instante em que uma gravar, TODO somador de
-- conta prevista passa a somar dolar com real sem erro e sem conversao --
-- /api/scheduled-transactions/summary, /api/safe-to-spend, /api/cash-flow,
-- /api/projection e a secao "Previstas" da tela do grupo --, e todos erram para
-- MENOS. Custo fixo subestimado e o insumo do safe-to-spend: o app passaria a
-- dizer que sobra dinheiro que nao sobra.
--
-- O CHECK troca esse futuro silencioso por um 23514 na cara da rota nova.
--
-- ===========================================================================
-- POR QUE A COLUNA NAO E SIMPLESMENTE REMOVIDA
-- ===========================================================================
-- Porque `planned_vs_actual` (022) usa `s.currency` como parte da chave que
-- casa previsto com realizado:
--
--     AND s.currency IS NOT DISTINCT FROM k.currency
--
-- Dropar a coluna quebraria a view. E, mais importante, a coluna CONTINUA
-- fazendo trabalho ali mesmo trancada em 'BRL': ela e o lado "previsto" do
-- cruzamento, e e o que mantem o previsto em real pareado com o realizado em
-- real quando existe tambem um realizado em dolar no mesmo mes.
--
-- O EFEITO COLATERAL QUE ISTO DEIXA DE PE, E POR QUE ELE NAO E DESTA MIGRATION
-- ----------------------------------------------------------------------------
-- Com previsto sempre em BRL, um realizado em USD gera em `planned_vs_actual`
-- uma linha (mes, 'USD') com `planned_expense = 0` e `expense_variance` igual
-- ao gasto inteiro -- o "gastou 180 sem ter previsto nada" que a issue mandou
-- vigiar. Esse numero NAO e inventado por esta migration: ele e verdade. Nao
-- havia previsao em dolar, porque o app recusa cria-la (HMO-188). A linha diz
-- exatamente o que aconteceu, no grao de moeda que a 022 escolheu de proposito
-- ("gastei 1.000 reais e 180 dolares" e a resposta certa num relatorio
-- PESSOAL). Mascarar isso seria somar moeda com moeda de novo.
--
-- Idempotente: pode rodar duas vezes seguidas sem erro.
-- Cola como lote unico no SQL Editor (nenhum meta-comando de psql aqui).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. A trava
-- ---------------------------------------------------------------------------
-- O catalogo de 13 codigos da 022 FICA. Esta migration so ACRESCENTA um segundo
-- CHECK, mais estreito, ao lado dele.
--
-- POR QUE ADITIVA, E NAO "TROCAR O CATALOGO POR 'BRL'"
-- ----------------------------------------------------
-- Substituir seria mais limpo de ler e teria um custo escondido no dia em que
-- alguem destrancar. Destrancar e, naturalmente, "derrube o CHECK que so aceita
-- BRL" -- e se esse fosse o UNICO CHECK da coluna, a tabela ficaria sem
-- validacao NENHUMA de moeda: 'CZK' passaria a entrar, e `moedaPorCodigo`
-- (lib/dinheiro.ts) cai no padrao em codigo desconhecido, ou seja uma previsao
-- em coroa tcheca apareceria em REAIS, sem aviso. Esse e o defeito que o CHECK
-- da 022 existe para impedir, e ele nao deve morrer junto com a trava.
--
-- Com os dois empilhados, a semantica fica certa nos dois estados: hoje vale a
-- intersecao (so 'BRL'), e no dia em que a trava cair sobra o catalogo da 022,
-- que e exatamente o lugar certo para pousar.
--
-- `ALTER TABLE ... ADD CONSTRAINT ... CHECK` VALIDA as linhas que ja existem.
-- Se houvesse uma unica conta prevista em moeda estrangeira em producao, esta
-- migration ABORTARIA aqui, e o BEGIN/COMMIT faz o arquivo inteiro voltar
-- atras. Isso e deliberado: uma linha dessas seria dinheiro ja gravado errado,
-- e descobrir isso por uma migration que recusa colar e MUITO melhor do que por
-- um `UPDATE ... SET currency = 'BRL'` que apaga a evidencia.
--
-- Medido em producao antes de escrever este arquivo: `pg_class.relpages = 0`
-- para `scheduled_transactions` -- a tabela esta vazia, entao nao ha linha
-- alguma para a validacao reprovar. (A contagem por `SELECT` nao serviria de
-- prova: o papel `paperclip_ro` nao tem `rolbypassrls` e a RLS devolveria
-- `0 rows` tanto para "tabela vazia" quanto para "tabela cheia que eu nao
-- posso ler". `relpages` nao passa pela RLS.)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_transactions_currency_brl'
  ) THEN
    ALTER TABLE public.scheduled_transactions
      ADD CONSTRAINT scheduled_transactions_currency_brl
      CHECK (currency = 'BRL');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. O comentario que mentia
-- ---------------------------------------------------------------------------
-- A 022 escreveu:
--
--   'Moeda desta conta prevista (ISO 4217). Herdada da conta na criacao.
--    Casa com financial_transactions.currency no previsto x realizado.'
--
-- "Herdada da conta na criacao" descreve um comportamento que NUNCA foi
-- implementado -- nenhum INSERT le `financial_accounts.currency`. Um comentario
-- de schema que descreve codigo inexistente e pior que nenhum: foi ele que
-- sustentou a leitura de que faltava "so" terminar a feature. A segunda frase
-- era e continua verdadeira, e fica.

COMMENT ON COLUMN public.scheduled_transactions.currency IS
  'Sempre BRL: ha CHECK. Previsao neste app e em real -- a cotacao de uma data futura nao existe, e por isso o app recusa deixar moeda estrangeira prevista (HMO-188, lib/lancamento.ts). A coluna fica porque planned_vs_actual casa previsto x realizado por moeda. Para destrancar: a baixa ([id]/pay) precisa ANTES passar a gravar currency e exchange_rate em financial_transactions -- hoje ela omite as duas e cai no DEFAULT (BRL, 1), que e perda silenciosa. Ver 034.';

COMMIT;
