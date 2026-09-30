-- 027_previsto_e_realizado_no_lancamento.sql
--
-- HMO-188: "Despesas e Receitas devem ter o dia do lancamento, o dia previsto
-- para ser realizado, e assim como o usuario vai em uma despesa e confirma que
-- pagou, a receita ele deve confirmar que recebeu, se nao ela fica como
-- prevista."
--
-- Tres coisas, e uma delas e o conserto de um caminho de perda silenciosa que
-- ja existe hoje no banco.
--
-- ===========================================================================
-- ONDE O "PREVISTO" MORA, E POR QUE ELE NAO VAI MORAR EM financial_transactions
-- ===========================================================================
-- A leitura obvia do pedido seria: poe um `status` em `financial_transactions`,
-- 'previsto' enquanto ninguem confirmou, 'realizado' depois. Nao e o que esta
-- aqui, e a razao e concreta:
--
--   TODA linha de `financial_transactions` mexe no saldo da conta, no instante
--   do INSERT, por `update_account_balance_trigger` (001_baseline). E toda
--   linha entra em `monthly_cash_flow`, `budget_consumption`,
--   `group_member_balances`, `planned_vs_actual`, `net_worth` -- o universo
--   inteiro do REALIZADO.
--
-- Uma linha 'previsto' ali dentro sairia gastando dinheiro que nao saiu. Fechar
-- isso exigiria um `WHERE status = 'realizado'` em cada uma dessas views e um
-- trigger de saldo que soubesse a transicao -- ou seja: cada view esquecida
-- viraria um numero errado, plausivel, sem erro nenhum. E o app JA TEM o
-- universo do previsto, com confirmacao e estorno testados:
-- `scheduled_transactions` (005) + `POST /api/scheduled-transactions/{id}/pay`.
--
-- Entao a divisao fica: o que ainda nao aconteceu e uma linha de
-- `scheduled_transactions`; confirmar cria a linha de `financial_transactions`.
-- E exatamente o caminho que a despesa fixa e a fatura de cartao ja usam. O que
-- esta migration acrescenta e (a) a direcao, que falta, e (b) as duas datas, que
-- precisam SOBREVIVER a confirmacao.
--
-- ===========================================================================
-- O DEFEITO QUE A SECAO 1 FECHA: A PREVISAO NAO SABE PARA QUE LADO APONTA
-- ===========================================================================
-- `scheduled_transactions.amount` tem `CHECK (amount > 0)`: a ocorrencia nao
-- guarda sinal. Quem diz se aquilo entra ou sai e
-- `recurring_rules.transaction_type` -- da REGRA, nao da ocorrencia. E a rota de
-- baixa le assim:
--
--     conta.recurring_rule?.transaction_type ?? "expense"
--
-- Uma previsao AVULSA (`recurring_rule_id IS NULL`) nao tem regra. Ela cai no
-- `?? "expense"` e a baixa grava `valorComSinal(valor, 'expense')`, ou seja
-- NEGATIVO. Hoje isso nao machuca porque a unica tela que cria avulsa e
-- /dashboard/bills, e la toda avulsa e um boleto.
--
-- No minuto em que a tela de receita puder criar uma receita prevista avulsa --
-- que e literalmente o que a HMO-188 pede -- confirmar o recebimento de
-- R$ 7.000 gravaria `-7000`. O salario entraria TIRANDO dinheiro da conta, com
-- o valor certo, a descricao certa, a categoria certa e nenhum erro. A tela
-- mostraria "Receita confirmada". Mesma familia de
-- `transaction_type` NULL em `group_expense_splits` (HMO-182): a direcao perdida
-- no meio do caminho, e o saldo continuando plausivel.
--
-- Por isso a coluna vem ANTES do codigo que a precisa, e nao junto dele.
--
-- ===========================================================================
-- AS DUAS DATAS, E POR QUE `created_at` NAO BASTAVA
-- ===========================================================================
-- `created_at` e o instante em que a LINHA nasceu, e para o historico ele e
-- mesmo o dia do lancamento -- e dele que sai o backfill. Mas ele nao e
-- editavel e nao deve ser: quem edita `created_at` mente sobre a linha. O dia
-- do lancamento e um dado do usuario ("anotei isso no dia 28"), entao ele e
-- coluna propria.
--
-- `expected_date` nasce NULL e o NULL quer dizer "nao havia previsao separada":
-- o lancamento aconteceu no dia em que se esperava, ou ninguem registrou
-- expectativa. Preencher o historico com `transaction_date` seria inventar um
-- dado -- todo lancamento antigo passaria a afirmar que foi realizado
-- exatamente no dia previsto, e um relatorio de atraso sairia com zero atrasos
-- e cara de verdade.
--
-- NAO HA CHECK CRUZANDO AS DATAS, DE PROPOSITO
-- --------------------------------------------
-- Um `CHECK (expected_date >= launch_date)` parece higiene e e uma armadilha:
-- ele recusaria o caso comum de anotar hoje uma conta que venceu semana passada
-- ("esqueci de lancar o aluguel do dia 5"). E pior, ele quebraria a EDICAO de
-- qualquer linha antiga no dia em que alguem preenchesse `expected_date` nela,
-- porque `launch_date` daquela linha e a data em que ela foi criada. Migration
-- aditiva com CHECK cruzado e o jeito conhecido de derrubar o app que esta no
-- ar: o INSERT que funcionava ontem passa a voltar 23514 hoje.
--
-- ===========================================================================
-- COMO APLICAR
-- ===========================================================================
-- Producao nao tem runner de migration. Quem aplica e uma pessoa, colando este
-- arquivo INTEIRO no SQL Editor do Supabase. Por isso nao ha nenhum
-- meta-comando de psql (`\set`, `\i`) aqui: uma unica linha com barra invertida
-- reprova o arquivo todo no SQL Editor.
--
-- Re-executavel: rodar duas vezes nao muda nada.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. A direcao da previsao
-- ---------------------------------------------------------------------------
-- NULL nao e "sem direcao": e "pergunte a regra". Isso mantem a leitura atual
-- exatamente como ela e para as ocorrencias geradas por `recurring_rules`, onde
-- a regra e a fonte de verdade e continua sendo -- editar a regra de "despesa"
-- para "receita" tem que reapontar as ocorrencias futuras dela, e uma copia
-- gravada em cada ocorrencia congelaria a direcao antiga.
--
-- A precedencia, que o codigo tem que respeitar na mesma ordem:
--
--     COALESCE(s.transaction_type, r.transaction_type, 'expense')
--
-- O 'expense' no fim e o que a rota de baixa ja faz hoje. Ele fica -- mas
-- passa a ser alcancavel so por linha antiga, porque o backfill abaixo
-- preenche as avulsas que existem e o codigo novo sempre manda a direcao.

ALTER TABLE public.scheduled_transactions
  ADD COLUMN IF NOT EXISTS transaction_type public.transaction_financial_type;

COMMENT ON COLUMN public.scheduled_transactions.transaction_type IS
  'Para que lado esta previsao aponta: income (vou receber) ou expense (vou pagar). NULL quer dizer "pergunte a recurring_rules.transaction_type da regra que gerou esta ocorrencia". A baixa le COALESCE(este, o da regra, ''expense''), e e ele que decide o SINAL do lancamento criado - sem ele toda receita prevista avulsa seria confirmada como despesa negativa.';

-- 'transfer' esta fora. Transferencia entre contas proprias e duas pernas que
-- se anulam (023/HMO-149), e uma previsao de transferencia nao tem valor para
-- "a vencer" nem para "a receber": ela nao muda patrimonio nenhum. Aceitar o
-- valor aqui criaria um terceiro caso que toda soma de agenda teria de tratar,
-- e o tratamento esquecido seria contar a perna de saida como despesa prevista.
--
-- Este CHECK e seguro num banco no ar porque a coluna acabou de nascer: nenhuma
-- linha existente pode viola-lo (todas sao NULL, ou 'expense' pelo backfill), e
-- nenhum INSERT que ja roda hoje manda a coluna. O teste prova a recusa sobre
-- VALUES, sem INSERT, e prova tambem que income e expense PASSAM -- uma trava
-- que recusa tudo tambem passaria na assercao de recusa.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scheduled_transactions_transaction_type_check'
  ) THEN
    ALTER TABLE public.scheduled_transactions
      ADD CONSTRAINT scheduled_transactions_transaction_type_check
      CHECK (transaction_type IS NULL OR transaction_type IN ('income', 'expense'));
  END IF;
END $$;

-- Backfill das AVULSAS, e so delas.
--
-- Toda previsao avulsa que existe hoje foi criada por /dashboard/bills, que so
-- cadastra conta a pagar, e toda baixa dela caiu no `?? "expense"`. Gravar
-- 'expense' aqui nao muda comportamento nenhum -- muda o fato de a linha
-- AFIRMAR o que o codigo estava assumindo. O `IS NULL` no WHERE e o que torna a
-- migration re-executavel sem reescrever uma direcao que alguem corrigiu depois.
--
-- As ocorrencias com regra ficam NULL: a regra continua mandando nelas.
UPDATE public.scheduled_transactions
   SET transaction_type = 'expense'
 WHERE recurring_rule_id IS NULL
   AND transaction_type IS NULL;

-- ---------------------------------------------------------------------------
-- 2. O dia do lancamento e o dia previsto, no lancamento
-- ---------------------------------------------------------------------------
-- Duas colunas em `financial_transactions`, e tres datas por linha no total:
--
--   launch_date       quando foi ANOTADO         (default: hoje)
--   expected_date     quando era esperado         (NULL = nao havia previsao)
--   transaction_date  quando ACONTECEU           (o que ja existia, e o que
--                                                 todo relatorio soma)
--
-- `transaction_date` nao muda de significado, e isso e deliberado: ele e a data
-- que `monthly_cash_flow`, `budget_consumption` e os relatorios do 008 usam
-- para dizer em que mes o dinheiro entrou ou saiu. Mexer no significado dele
-- reclassificaria o historico inteiro de mes.

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS launch_date date;

-- Backfill antes do NOT NULL. `created_at` tem DEFAULT now() desde o
-- 001_baseline, entao ele nao e NULL em nenhuma linha -- o COALESCE com
-- CURRENT_DATE existe para a linha teoricamente possivel em que alguem gravou
-- NULL explicito, que sem ele derrubaria o SET NOT NULL logo abaixo com uma
-- mensagem que nao diz qual linha.
UPDATE public.financial_transactions
   SET launch_date = COALESCE(created_at::date, CURRENT_DATE)
 WHERE launch_date IS NULL;

ALTER TABLE public.financial_transactions
  ALTER COLUMN launch_date SET DEFAULT CURRENT_DATE;

ALTER TABLE public.financial_transactions
  ALTER COLUMN launch_date SET NOT NULL;

COMMENT ON COLUMN public.financial_transactions.launch_date IS
  'O dia em que este lancamento foi ANOTADO (HMO-188). Nao e quando o dinheiro andou - isso e transaction_date, e e ele que todo relatorio soma. DEFAULT CURRENT_DATE: toda rota que nao manda a coluna grava hoje, que e a verdade. O historico foi preenchido de created_at::date.';

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS expected_date date;

COMMENT ON COLUMN public.financial_transactions.expected_date IS
  'O dia em que se esperava que este lancamento fosse realizado (HMO-188). NULL quer dizer "nao havia previsao separada", e nao "previsto para hoje" - o historico ficou NULL de proposito, porque copiar transaction_date aqui faria todo lancamento antigo AFIRMAR que saiu no dia previsto e um relatorio de atraso sairia com zero atrasos. Quando a linha nasceu da baixa de uma conta prevista, aqui fica o due_date dela.';

-- Quem lista lancamento por dia previsto precisa do indice; quem soma por mes
-- continua indo por `transaction_date`, que ja tem o seu. Parcial porque a
-- coluna e NULL na esmagadora maioria das linhas -- e um indice cheio gastaria
-- entrada para cada uma delas.
CREATE INDEX IF NOT EXISTS idx_transactions_expected_date
  ON public.financial_transactions (user_id, expected_date)
  WHERE expected_date IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. A view da agenda passa a dizer a direcao (e a moeda)
-- ---------------------------------------------------------------------------
-- `scheduled_transactions_effective` e de onde as tres rotas de leitura da
-- agenda leem. Ela precisa ser REFEITA, e nao `CREATE OR REPLACE`-ada, por um
-- detalhe do Postgres: o `SELECT s.*` do 005 foi EXPANDIDO na criacao, entao a
-- view nao ganha coluna nova sozinha, e `CREATE OR REPLACE` so aceita
-- acrescentar coluna no FIM -- com `s.*` a coluna nova entraria no meio (antes
-- de `effective_status`) e o comando falharia com "cannot change name of view
-- column". Nada depende desta view no banco (nenhuma outra view, nenhuma
-- funcao): o DROP e local.
--
-- Duas coisas entram:
--
--   * `transaction_type` e `direction`. A primeira e o que esta gravado na
--     ocorrencia; a segunda e a precedencia JA RESOLVIDA, para que nenhuma tela
--     precise refazer o COALESCE -- e a copia esquecida em uma das tres rotas
--     de leitura seria justamente uma receita prevista aparecendo como conta a
--     pagar. O LEFT JOIN nunca descarta linha: previsao avulsa nao tem regra, e
--     nesse caso as colunas da regra vem NULL e o COALESCE cai para a coluna
--     propria.
--
--   * `currency`. A 022 acrescentou a coluna em `scheduled_transactions` e esta
--     view nunca a expos, pelo mesmo `s.*` congelado -- as rotas fazem
--     `select("*")` e a moeda da previsao nunca chegou a tela nenhuma. Ela entra
--     aqui porque a view esta sendo refeita de qualquer forma, e porque uma
--     previsao em dolar exibida sem moeda se le como reais.
--
-- `security_invoker` e reposto no fim. Sem ele a view roda com o privilegio do
-- DONO e a RLS de `scheduled_transactions` deixa de valer: cada usuario veria a
-- agenda de todos. O teste tem controle negativo para isso.

DROP VIEW IF EXISTS public.scheduled_transactions_effective;

CREATE VIEW public.scheduled_transactions_effective AS
  SELECT
    s.id,
    s.user_id,
    s.recurring_rule_id,
    s.category_id,
    s.account_id,
    s.group_id,
    s.description,
    s.amount,
    s.due_date,
    s.status,
    s.paid_date,
    s.transaction_id,
    s.notes,
    s.created_at,
    s.updated_at,
    s.currency,
    s.transaction_type,
    -- Vencida e uma PERGUNTA, nao um estado gravado: quem gravasse 'overdue'
    -- precisaria de um cron a meia-noite para envelhecer a linha, e o dia em
    -- que o cron nao rodasse a conta apareceria em dia. Igual ao 005.
    CASE
      WHEN s.status = 'pending' AND s.due_date < CURRENT_DATE
        THEN 'overdue'::public.scheduled_status
      ELSE s.status
    END AS effective_status,
    (s.due_date - CURRENT_DATE) AS days_until_due,
    -- A precedencia, resolvida uma vez: ocorrencia, regra, e por fim o
    -- 'expense' historico que a rota de baixa sempre teve.
    COALESCE(
      s.transaction_type,
      r.transaction_type,
      'expense'::public.transaction_financial_type
    ) AS direction
  FROM public.scheduled_transactions s
  LEFT JOIN public.recurring_rules r ON r.id = s.recurring_rule_id;

COMMENT ON VIEW public.scheduled_transactions_effective IS
  'scheduled_transactions com o status vencido calculado na hora (nunca gravado) e a DIRECAO resolvida (HMO-188): direction = COALESCE(transaction_type da ocorrencia, transaction_type da regra, expense). Toda tela que separa "a pagar" de "a receber" le direction e nao refaz o COALESCE.';

ALTER VIEW public.scheduled_transactions_effective SET (security_invoker = true);

REVOKE ALL ON public.scheduled_transactions_effective FROM anon;
GRANT SELECT ON public.scheduled_transactions_effective TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. O que NAO entra aqui, e por que
-- ---------------------------------------------------------------------------
-- `scheduled_transactions` nao ganha `exchange_rate`. A 026 recusou isso com a
-- razao certa e ela continua valendo: a cotacao de uma data FUTURA nao existe, e
-- gravar um chute teria a mesma cara de uma cotacao confirmada. A consequencia
-- pratica, que o codigo tem que dizer na tela: um lancamento em moeda
-- estrangeira nao pode ficar "previsto" -- ele se lanca no dia em que a pessoa
-- confirma, que e o dia em que existe cotacao para congelar. Sem essa recusa, a
-- baixa de uma previsao em dolar cairia no DEFAULT (BRL, 1) e US$ 180 entrariam
-- como R$ 180.
--
-- `total_pending` de /api/scheduled-transactions/summary continua somando
-- receita prevista junto com despesa prevista num unico numero positivo -- o
-- bloco "A vencer" do painel anuncia R$ 9.588,50 quando o que vai sair sao
-- R$ 2.588,50 (medido em producao na HMO-186). Esta migration entrega o que
-- FALTAVA para consertar aquilo (`direction` na view), mas nao muda a rota:
-- dois consumidores leem `total_pending` e trocar o significado dele calado
-- substituiria um numero errado por outro. E issue propria.

INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('027', '027_previsto_e_realizado_no_lancamento',
        'Dia do lancamento e dia previsto em financial_transactions; direcao (income/expense) na conta prevista, para a baixa de receita nao gravar despesa negativa - HMO-188', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
