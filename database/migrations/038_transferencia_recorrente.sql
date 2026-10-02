-- 038_transferencia_recorrente.sql
--
-- HMO-172. Uma transferencia recorrente ("todo dia 5 mando R$ 1.000 para a
-- poupanca") nao cabia no banco, e o jeito como ela NAO cabia e o defeito:
-- `recurring_rules` e `scheduled_transactions` tem UMA `account_id` cada.
--
-- ===========================================================================
-- POR QUE UMA COLUNA, E NAO DUAS REGRAS
-- ===========================================================================
-- A leitura obvia e "transferencia sao duas pernas, logo sao duas regras": uma
-- de saida na origem e uma de entrada no destino. Ela nao sobrevive ao primeiro
-- mes.
--
-- Duas regras independentes sao duas linhas que NADA obriga a andar juntas.
-- Editar o valor de uma (a tela de gastos fixos edita uma regra por vez) deixa
-- a outra no valor velho, e o resultado e uma transferencia que tira 1.200 de
-- uma conta e poe 1.000 na outra -- R$ 200 desaparecidos por mes, sem erro em
-- lugar nenhum. Apagar uma deixa a outra gerando metade de transferencia para
-- sempre. E os dois estragos tem a MESMA assinatura do defeito que esta issue
-- existe para fechar (`net_worth_history` soma os dois tipos e fecha em zero;
-- `monthly_cash_flow` e `category_monthly_totals` filtram income/expense e nem
-- olham), ou seja: nenhum agregado acusa.
--
-- Uma regra com DOIS destinos e indivisivel por construcao. O par de pernas
-- nasce na baixa, de `pernasDaTransferencia` (lib/transferencia.ts), que e o
-- unico lugar do app que conhece a regra de sinal.
--
-- ===========================================================================
-- O CHECK DO 027 ERA DELIBERADO, E ESTA MIGRATION RESPONDE O MOTIVO DELE
-- ===========================================================================
-- A 027 escreveu, ao criar `scheduled_transactions.transaction_type`:
--
--     'transfer' esta fora. [...] Aceitar o valor aqui criaria um terceiro caso
--     que toda soma de agenda teria de tratar, e o tratamento esquecido seria
--     contar a perna de saida como despesa prevista.
--
-- A objecao estava certa, e o que mudou nao foi a opiniao: foi o codigo. As
-- duas perguntas que a agenda faz hoje tem dono, e as DUAS ja tratam
-- transferencia de proposito:
--
--   `direcaoDaAgenda`  (lib/previsto-x-realizado.ts) -- "quanto ainda vai sair
--      da conta neste mes". Transferencia CONTA: a perna agendada e uma saida
--      datada da conta corrente, e esconde-la prometeria uma folga que nao
--      existe.
--
--   `direcaoNoPainel`  (lib/realizado-e-previsao.ts) -- "quanto vou gastar no
--      periodo". Transferencia NAO conta (devolve NULL): mover dinheiro entre
--      contas proprias nao e gasto.
--
-- Ou seja: o terceiro caso que a 027 temia ja existe e ja esta tratado nos dois
-- sentidos. Alargar o CHECK agora nao abre a porta que ela trancou -- ela foi
-- aberta, com cuidado, pela HMO-187 e pela HMO-215.
--
-- ===========================================================================
-- POR QUE O CHECK CRUZADO, E O QUE ELE IMPEDE
-- ===========================================================================
-- `destination_account_id` sozinha e uma coluna opcional que nao promete nada.
-- Os tres estados que ela precisa tornar impossiveis:
--
--   1. transfer SEM destino. E a regra que materializa UMA perna -- o defeito
--      inteiro da issue, agora gravavel. Sem o CHECK, uma rota que esqueca o
--      campo grava a regra, a agenda gera a ocorrencia, e a baixa descobre que
--      nao tem para onde mandar o dinheiro no pior momento possivel: depois de
--      ja ter lancado a perna de saida.
--   2. transfer com destino IGUAL a origem. As duas pernas cairiam na mesma
--      conta, -total e +total se anulariam, e a tela diria "transferido" sem
--      que nada tivesse se movido. E o bug do HMO-149 com outra roupa, e
--      `validarContasDaTransferencia` ja o recusa no app -- aqui fica o cinto.
--   3. despesa ou receita COM destino. Uma transferencia disfarcada: a baixa le
--      o tipo, nao a coluna, entao ela gravaria UMA perna e a coluna ficaria
--      ali dizendo que havia um destino que ninguem honrou.
--
-- O estado 3 e o que faz o CHECK ser um `CASE` e nao um `OR`: a forma
-- permissiva ("destino NULL OU tipo = transfer") deixa passar o 1.
--
-- SEGURO NUM BANCO NO AR. `destination_account_id` acaba de nascer, entao toda
-- linha existente tem NULL ali e cai no ramo ELSE, que exige exatamente NULL.
-- O unico jeito de uma linha existente violar o CHECK e ja ter
-- `transaction_type = 'transfer'`, e o bloco de guarda abaixo prova que nao ha
-- nenhuma antes de tentar criar a constraint -- com mensagem que diz o que
-- fazer, em vez do 23514 cru que nao diz qual linha nem por que.

-- ---------------------------------------------------------------------------
-- 1. A guarda: nenhuma regra de transferencia pode PRE-EXISTIR
-- ---------------------------------------------------------------------------
-- `recurring_rules.transaction_type` e o enum `transaction_financial_type`, que
-- tem 'transfer' desde o 001_baseline, e NUNCA houve CHECK ali. Nada no banco
-- impediu uma regra de transferencia de ser criada -- o que impediu foi o app
-- nao ter tela. Se uma existir (importacao, SQL Editor, rota futura), ela e por
-- definicao uma regra de meia transferencia, e e justamente o que esta issue
-- conserta: ela precisa de destino antes de a constraint entrar.
--
-- Falhar aqui e o comportamento certo. A alternativa -- criar a constraint como
-- NOT VALID e seguir -- deixaria a linha quebrada no banco e a migration verde,
-- que e o modo de falha mais caro: ninguem volta a olhar.
DO $$
DECLARE
  n_regras integer;
  n_ocorrencias integer;
BEGIN
  SELECT count(*) INTO n_regras
    FROM public.recurring_rules
   WHERE transaction_type = 'transfer';

  SELECT count(*) INTO n_ocorrencias
    FROM public.scheduled_transactions
   WHERE transaction_type = 'transfer';

  IF n_regras > 0 OR n_ocorrencias > 0 THEN
    RAISE EXCEPTION
      'HMO-172: ha % regra(s) e % ocorrencia(s) com transaction_type = ''transfer'' sem destino. Preencha destination_account_id nelas (ou desative-as) antes de aplicar a 038: elas sao transferencias de UMA perna.',
      n_regras, n_ocorrencias;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Para onde o dinheiro vai
-- ---------------------------------------------------------------------------
ALTER TABLE public.recurring_rules
  ADD COLUMN IF NOT EXISTS destination_account_id uuid;

ALTER TABLE public.scheduled_transactions
  ADD COLUMN IF NOT EXISTS destination_account_id uuid;

COMMENT ON COLUMN public.recurring_rules.destination_account_id IS
  'Para qual conta a transferencia recorrente manda o dinheiro (HMO-172). Preenchida SOMENTE quando transaction_type = ''transfer'', e nesse caso obrigatoria e diferente de account_id - ver o CHECK recurring_rules_destino_check. account_id continua sendo a ORIGEM. Uma regra com os dois lados e indivisivel: duas regras independentes divergiriam na primeira edicao e a transferencia passaria a tirar de uma conta mais do que poe na outra.';

COMMENT ON COLUMN public.scheduled_transactions.destination_account_id IS
  'Copia do destino da regra, por ocorrencia (HMO-172). A baixa monta as duas pernas a partir de account_id (origem) e desta coluna (destino), por pernasDaTransferencia - sem ela a baixa lancaria UMA perna e os saldos das duas contas ficariam errados em direcoes opostas, com o total geral certo e nenhum agregado acusando.';

-- As FKs vao sem ON DELETE: `account_id` tambem vai (005), e pelo mesmo motivo.
-- Apagar uma conta que e destino de uma regra ativa tem de ser recusado pelo
-- banco -- um SET NULL aqui transformaria a regra em transferencia sem destino
-- (o estado 1 acima) e ainda violaria o CHECK na escrita seguinte, numa linha
-- que ninguem tocou. O 23503 chega na hora em que a pessoa ainda entende o que
-- pediu.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recurring_rules_destination_account_id_fkey'
  ) THEN
    ALTER TABLE public.recurring_rules
      ADD CONSTRAINT recurring_rules_destination_account_id_fkey
      FOREIGN KEY (destination_account_id)
      REFERENCES public.financial_accounts(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scheduled_transactions_destination_account_id_fkey'
  ) THEN
    ALTER TABLE public.scheduled_transactions
      ADD CONSTRAINT scheduled_transactions_destination_account_id_fkey
      FOREIGN KEY (destination_account_id)
      REFERENCES public.financial_accounts(id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. O CHECK do 027, alargado
-- ---------------------------------------------------------------------------
-- Tem de ser DROP + ADD, e nao um `IF NOT EXISTS` como o da 027: a constraint
-- JA EXISTE com o texto estreito. Um bloco que so cria quando falta nao faria
-- nada aqui, a migration ficaria verde, e a primeira transferencia prevista
-- levaria 23514 -- uma migration "aplicada" que nao mudou o que prometeu.
--
-- `IF EXISTS` no DROP mantem a migration re-executavel, inclusive num banco
-- onde a 027 nunca rodou.
ALTER TABLE public.scheduled_transactions
  DROP CONSTRAINT IF EXISTS scheduled_transactions_transaction_type_check;

ALTER TABLE public.scheduled_transactions
  ADD CONSTRAINT scheduled_transactions_transaction_type_check
  CHECK (
    transaction_type IS NULL
    OR transaction_type IN ('income', 'expense', 'transfer')
  );

COMMENT ON COLUMN public.scheduled_transactions.transaction_type IS
  'Para que lado esta previsao aponta: income (vou receber), expense (vou pagar) ou transfer (vou mover entre contas minhas, HMO-172). NULL quer dizer "pergunte a recurring_rules.transaction_type da regra que gerou esta ocorrencia". A baixa le COALESCE(este, o da regra, ''expense''), e e ele que decide o SINAL do lancamento criado - e, em transfer, que ha DUAS pernas em vez de uma. A ocorrencia de transferencia grava ''transfer'' explicitamente (nao herda da regra): o CHECK do destino precisa do tipo na propria linha para poder exigir destination_account_id.';

-- ---------------------------------------------------------------------------
-- 4. O CHECK cruzado: o destino e obrigatorio em transfer e proibido fora dele
-- ---------------------------------------------------------------------------
-- Em `scheduled_transactions` o ramo ELSE alcanca `transaction_type IS NULL`
-- (ocorrencia que herda a direcao da regra, o caso normal de despesa fixa) e
-- exige destino NULL -- correto, e a razao pela qual a materializacao GRAVA
-- 'transfer' na ocorrencia em vez de deixar NULL: sem o tipo na linha, o banco
-- nao teria como saber que aquele destino e legitimo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recurring_rules_destino_check'
  ) THEN
    ALTER TABLE public.recurring_rules
      ADD CONSTRAINT recurring_rules_destino_check
      CHECK (
        CASE WHEN transaction_type = 'transfer'
          THEN destination_account_id IS NOT NULL
               AND account_id IS NOT NULL
               AND destination_account_id <> account_id
          ELSE destination_account_id IS NULL
        END
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_transactions_destino_check'
  ) THEN
    ALTER TABLE public.scheduled_transactions
      ADD CONSTRAINT scheduled_transactions_destino_check
      CHECK (
        CASE WHEN transaction_type = 'transfer'
          THEN destination_account_id IS NOT NULL
               AND account_id IS NOT NULL
               AND destination_account_id <> account_id
          ELSE destination_account_id IS NULL
        END
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. A view do 027 continua entregando `direction`
-- ---------------------------------------------------------------------------
-- `scheduled_transactions_effective` e `SELECT ... COALESCE(s.transaction_type,
-- r.transaction_type, 'expense') AS direction`, e `direction` ja e do tipo
-- `transaction_financial_type` -- que tem 'transfer' desde o 001. Entao a view
-- passa a devolver 'transfer' sozinha, sem ser recriada.
--
-- E DE PROPOSITO QUE ELA NAO E RECRIADA AQUI. `CREATE OR REPLACE VIEW` apaga
-- `reloptions`, e com ele o `security_invoker = true` que a 004 colocou -- a
-- view voltaria a rodar como o DONO dela e furaria a RLS de todo mundo, para
-- consertar uma coluna que nao precisava de conserto. O teste abaixo afirma as
-- duas coisas: que a view entrega direction = 'transfer', e que
-- security_invoker continua ligado.
--
-- `destination_account_id` NAO entra na view. Quem da a baixa le a TABELA (a
-- rota de pay faz `select("*")`), e acrescentar coluna a view exigiria recria-la
-- -- o furo acima -- em troca de nada.

COMMENT ON CONSTRAINT scheduled_transactions_destino_check
  ON public.scheduled_transactions IS
  'HMO-172: transferencia prevista tem destino obrigatorio e diferente da origem; qualquer outro tipo (inclusive NULL, que herda a direcao da regra) tem de ter destino NULL. Impede os tres estados que perdem dinheiro em silencio: transfer sem destino (materializa UMA perna), transfer com destino = origem (as pernas se anulam e a tela diz "transferido"), e income/expense com destino (transferencia disfarcada que a baixa grava como perna unica).';
