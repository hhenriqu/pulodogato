-- =====================================================
-- PULODOGATO - EXTRATO, AVISOS DE VENCIMENTO E COMPROVANTES
-- =====================================================
-- Migration: 009_statements_alerts_receipts
-- Gerado em: 2026-09-22  (HMO-137, Fase 5 da evolucao do produto)
--
-- O QUE ESTE ARQUIVO ADICIONA
-- ---------------------------
--   public.statement_imports        um arquivo de extrato enviado (OFX ou CSV)
--   public.statement_entries        cada linha lida do arquivo, antes de virar lancamento
--   public.notification_preferences quantos dias antes avisar, e se avisa
--   public.push_subscriptions       os aparelhos que aceitaram receber push
--   public.bill_notifications       o que ja foi avisado  (e o que impede repetir)
--   public.bill_alerts              o que vence, com quantos dias faltam (view)
--   public.receipts                 comprovante anexado a um lancamento
--
-- Como o 008, este arquivo so ACRESCENTA: nenhuma funcao, tabela ou trigger de
-- producao e alterada. As tabelas sao novas e a unica view e leitura pura.
--
-- POR QUE O EXTRATO NAO ENTRA DIRETO EM financial_transactions
-- -------------------------------------------------------------
-- A tentacao e ler o OFX e dar INSERT em financial_transactions direto. Foi
-- rejeitado por quatro razoes, em ordem de gravidade:
--
--   1) financial_transactions.category_id e NOT NULL e o extrato do banco NAO
--      traz categoria. Sem uma area de espera, ou o import falha na primeira
--      linha, ou inventa uma categoria "Outros" e o orcamento por categoria do
--      006 passa a mentir em silencio -- que e pior.
--   2) O INSERT dispara update_account_balance. Importar duas vezes o mesmo
--      arquivo mexeria no saldo duas vezes, e o 007 mostrou o que custa uma
--      linha de trigger que mexe em dinheiro sem ninguem ver.
--   3) Metade do extrato JA ESTA lancado a mao. Sem conciliacao, o usuario
--      importa e ve o mes dobrado de tamanho -- cada almoco aparece duas vezes.
--   4) O arquivo do banco e a fonte de um fato bruto e imutavel; o lancamento
--      e uma coisa editavel que pertence ao usuario. Misturar os dois tira a
--      possibilidade de reconferir "o que o banco realmente mandou".
--
-- Entao statement_entries e uma AREA DE ESPERA: o arquivo entra inteiro, a
-- conciliacao marca o que ja existe, e o usuario decide linha a linha. So
-- quando ele decide e que nasce a financial_transaction -- e a entrada guarda
-- o transaction_id para nunca mais oferecer a mesma linha.
--
-- O SINAL DO VALOR, MAIS UMA VEZ
-- -------------------------------
-- Despesa e gravada NEGATIVA em financial_transactions, e o <TRNAMT> do OFX ja
-- vem negativo num debito. statement_entries.amount guarda o sinal EXATAMENTE
-- como o banco mandou, sem ABS e sem normalizar: e desse sinal que sai o
-- transaction_type na hora de criar o lancamento (negativo -> expense,
-- positivo -> income). Um ABS() aqui faria toda despesa importada virar
-- receita, e os quatro relatorios do 008 passariam a mostrar um mes de lucro
-- onde houve um mes de gasto -- sem nenhum erro aparecer. O teste tem controle
-- negativo para isso.
--
-- POR QUE A DEDUPLICACAO E UM `fingerprint`, E NAO O FITID
-- --------------------------------------------------------
-- O OFX traz <FITID>, um id unico do banco por lancamento. O CSV nao traz
-- nada. Duas regras de deduplicacao diferentes viram duas versoes da mesma
-- regra, e a segunda para de acompanhar a primeira. Entao ha uma coluna so,
-- `fingerprint`, calculada no TypeScript (lib/statement.ts):
--
--   com FITID:  'fitid:' || fit_id
--   sem FITID:  'h:' || data || '|' || valor || '|' || descricao || '|#' || n
--
-- O `#n` e o que impede um falso positivo caro: dois cafes de R$ 8,00 no mesmo
-- dia e na mesma cafeteria sao dois fatos, nao um repetido. O n e a ordem da
-- linha DENTRO do arquivo entre as linhas identicas, entao reimportar o mesmo
-- arquivo devolve exatamente os mesmos fingerprints (e nao duplica), enquanto
-- dois cafes de verdade recebem #1 e #2 e entram os dois.
--
-- POR QUE bill_notifications EXISTE
-- ----------------------------------
-- Sem um registro do que ja foi avisado, o cron que roda de manha manda "o
-- aluguel vence em 3 dias" TODO dia ate o aluguel ser pago. Tres notificacoes
-- da mesma conta e o usuario desliga o aviso -- e ai o produto perde a unica
-- funcionalidade desta secao. A chave unica inclui reference_date de proposito:
-- mudar a data de vencimento e um fato novo e merece um aviso novo.
--
-- COMO RODAR
-- ----------
--   psql "$URL" -v ON_ERROR_STOP=1 -f database/migrations/009_statements_alerts_receipts.sql
--
-- Aplicar depois de 001 -> ... -> 008. O preflight aborta a transacao inteira
-- listando tudo que falta de uma vez.
--
-- A SECAO 9 (bucket de comprovantes) SO RODA NUM SUPABASE de verdade: ela
-- depende do schema `storage`, que num Postgres cru nao existe. Num Postgres
-- cru ela e pulada com um NOTICE, e o resto do arquivo aplica normalmente --
-- e por isso que o CI consegue provar as outras oito secoes.
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0: O ARQUIVO CABE NESTE BANCO?
-- =====================================================
DO $$
DECLARE
  v_faltando TEXT;
BEGIN
  SELECT string_agg(DISTINCT msg, E'\n' ORDER BY msg) INTO v_faltando
  FROM (
    SELECT CASE
             WHEN to_regclass('public.' || quote_ident(r.tabela)) IS NULL
               THEN format('  - tabela public.%s nao existe', r.tabela)
             WHEN NOT EXISTS (
                    SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.' || quote_ident(r.tabela))
                      AND a.attname = r.coluna
                      AND a.attnum > 0
                      AND NOT a.attisdropped)
               THEN format('  - coluna public.%s.%s nao existe', r.tabela, r.coluna)
           END AS msg
    FROM (VALUES
      ('financial_accounts', 'user_id'),
      ('financial_transactions', 'amount'),
      ('financial_transactions', 'transaction_date'),
      ('financial_transactions', 'account_id'),
      -- do 005: o aviso de vencimento le a agenda de contas previstas
      ('scheduled_transactions', 'due_date'),
      ('scheduled_transactions', 'status'),
      ('recurring_rules', 'transaction_type'),
      -- do 007: o comprovante tambem serve para o acerto de grupo
      ('group_settlements', 'id'),
      ('schema_migrations', 'version')
    ) AS r(tabela, coluna)

    UNION ALL
    SELECT format('  - funcao public.%s nao existe', f.nome)
    FROM (VALUES
      ('update_updated_at_column()'),
      ('is_group_member(uuid)')
    ) AS f(nome)
    WHERE to_regprocedure('public.' || f.nome) IS NULL

    UNION ALL
    SELECT format('  - role %s nao existe', r.rolname)
    FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
    WHERE NOT EXISTS (SELECT 1 FROM pg_roles p WHERE p.rolname = r.rolname)
  ) AS checks
  WHERE msg IS NOT NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'009 nao pode ser aplicado neste banco. Faltando:\n%\n\nRode 001 -> 002 -> 003 -> 004 -> 005 -> 006 -> 007 -> 008 antes.', v_faltando;
  END IF;
END $$;

-- =====================================================
-- SECAO 1: statement_imports  (o arquivo enviado)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.statement_imports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    -- NOT NULL de proposito: um extrato sem conta nao pode ser conciliado nem
    -- deduplicado (o fingerprint e unico POR CONTA). "Importar e escolher a
    -- conta depois" produziria linhas que nao casam com nada.
    account_id uuid NOT NULL,
    file_name text NOT NULL,
    file_format text NOT NULL,
    -- periodo coberto pelo arquivo, lido do proprio conteudo. Serve para a tela
    -- dizer "este extrato vai de 01/09 a 30/09" antes de o usuario confirmar --
    -- e para ele perceber que mandou o arquivo do mes errado.
    period_start date,
    period_end date,
    entry_count integer NOT NULL DEFAULT 0,
    -- quantas linhas o arquivo tinha a mais do que entraram: o que foi
    -- descartado por ja existir. Sem este numero o usuario manda o arquivo de
    -- novo, ve "0 lancamentos novos" e acha que o import quebrou.
    duplicate_count integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'open',
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT statement_imports_pkey PRIMARY KEY (id),
    CONSTRAINT statement_imports_format_check CHECK (file_format IN ('ofx', 'csv')),
    CONSTRAINT statement_imports_status_check CHECK (status IN ('open', 'done', 'discarded')),
    CONSTRAINT statement_imports_counts_check CHECK (entry_count >= 0 AND duplicate_count >= 0),
    -- periodo invertido e sinal de parser quebrado, nao de extrato estranho
    CONSTRAINT statement_imports_period_check CHECK (
      period_start IS NULL OR period_end IS NULL OR period_start <= period_end
    ),
    CONSTRAINT statement_imports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT statement_imports_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.financial_accounts(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.statement_imports IS
  'Um arquivo de extrato enviado. As linhas ficam em statement_entries; nada entra direto em financial_transactions.';
COMMENT ON COLUMN public.statement_imports.duplicate_count IS
  'Linhas do arquivo que ja existiam (mesmo fingerprint). Sem este numero, reimportar parece um import quebrado.';

CREATE INDEX IF NOT EXISTS idx_statement_imports_user ON public.statement_imports(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_statement_imports_account ON public.statement_imports(account_id);

-- =====================================================
-- SECAO 2: statement_entries  (cada linha do arquivo)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.statement_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    import_id uuid NOT NULL,
    user_id uuid NOT NULL,
    -- repetida do import de proposito: o indice unico da deduplicacao e por
    -- CONTA e precisa alcancar linhas de arquivos diferentes. Buscar a conta
    -- pelo import dentro de um indice nao e possivel.
    account_id uuid NOT NULL,
    fit_id text,
    fingerprint text NOT NULL,
    posted_at date NOT NULL,
    -- SINAL PRESERVADO. Ver o cabecalho: e daqui que sai o transaction_type.
    amount numeric(15,2) NOT NULL,
    description text NOT NULL,
    memo text,
    status text NOT NULL DEFAULT 'pending',
    -- o lancamento que nasceu desta linha ('imported') ou o lancamento que ja
    -- existia e a conciliacao encontrou ('linked'). Nos dois casos a linha para
    -- de ser oferecida.
    transaction_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT statement_entries_pkey PRIMARY KEY (id),
    -- lancamento de R$ 0,00 nao existe em extrato: e linha de cabecalho ou de
    -- saldo que o parser leu errado.
    CONSTRAINT statement_entries_amount_check CHECK (amount <> 0),
    CONSTRAINT statement_entries_status_check CHECK (status IN ('pending', 'imported', 'linked', 'ignored')),
    -- Paridade status <-> transaction_id, no mesmo espirito do
    -- scheduled_transactions_paid_check do 005: 'imported' e 'linked' EXIGEM um
    -- lancamento, 'pending' e 'ignored' nao podem ter nenhum. Sem isto, uma
    -- linha marcada como importada sem transacao ficaria invisivel para sempre
    -- sem nunca ter virado dinheiro nenhum.
    CONSTRAINT statement_entries_link_check CHECK (
      (status IN ('imported', 'linked') AND transaction_id IS NOT NULL)
      OR (status IN ('pending', 'ignored') AND transaction_id IS NULL)
    ),
    CONSTRAINT statement_entries_import_id_fkey FOREIGN KEY (import_id) REFERENCES public.statement_imports(id) ON DELETE CASCADE,
    CONSTRAINT statement_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT statement_entries_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.financial_accounts(id) ON DELETE CASCADE,
    -- SET NULL e nao CASCADE: apagar o lancamento nao pode apagar o registro de
    -- que o banco mandou aquela linha. Mas ai a paridade acima seria violada,
    -- entao a trigger da SECAO 3 devolve a linha para 'pending' -- e ela volta
    -- a ser oferecida, que e exatamente o certo.
    CONSTRAINT statement_entries_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.financial_transactions(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.statement_entries IS
  'Linhas do extrato em area de espera. amount guarda o SINAL do banco: negativo = saida.';
COMMENT ON COLUMN public.statement_entries.fingerprint IS
  'Chave de deduplicacao, calculada em lib/statement.ts. fitid:<id> no OFX, hash da linha + ordinal no CSV.';

-- A deduplicacao inteira mora neste indice. Reimportar o mesmo arquivo nao
-- duplica nada porque o ON CONFLICT DO NOTHING da rota bate exatamente aqui.
CREATE UNIQUE INDEX IF NOT EXISTS idx_statement_entries_fingerprint
  ON public.statement_entries(account_id, fingerprint);

CREATE INDEX IF NOT EXISTS idx_statement_entries_import ON public.statement_entries(import_id, posted_at);
CREATE INDEX IF NOT EXISTS idx_statement_entries_pending
  ON public.statement_entries(user_id, posted_at DESC) WHERE status = 'pending';

-- =====================================================
-- SECAO 3: a linha volta a ser oferecida se o lancamento sumir
-- =====================================================
-- Sem esta funcao, apagar um lancamento que nasceu de um import violaria
-- statement_entries_link_check e o DELETE falharia com um erro de constraint na
-- cara do usuario -- ou, se o check nao existisse, deixaria uma linha
-- 'imported' apontando para o nada, invisivel para sempre.
--
-- SECURITY DEFINER e SET search_path pelo mesmo motivo do 003 e do 004: o
-- trigger roda como `authenticated`, que nao tem privilegio direto de UPDATE
-- garantido em toda tabela, e sem o search_path fixo um schema no caminho do
-- usuario poderia sequestrar o nome.
CREATE OR REPLACE FUNCTION public.statement_entry_release_on_transaction_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.statement_entries
     SET status = 'pending',
         transaction_id = NULL
   WHERE transaction_id = OLD.id;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.statement_entry_release_on_transaction_delete() IS
  'Apagou o lancamento? A linha do extrato volta para pending e e oferecida de novo.';

-- BEFORE DELETE e nao AFTER: o ON DELETE SET NULL da FK roda junto com o
-- DELETE, e um AFTER encontraria transaction_id ja NULL -- o UPDATE nao acharia
-- nenhuma linha e a entrada ficaria 'imported' com transaction_id NULL, que e
-- justamente o estado que o check proibe.
DROP TRIGGER IF EXISTS release_statement_entry ON public.financial_transactions;
CREATE TRIGGER release_statement_entry
  BEFORE DELETE ON public.financial_transactions
  FOR EACH ROW EXECUTE FUNCTION public.statement_entry_release_on_transaction_delete();

DROP TRIGGER IF EXISTS set_statement_imports_updated_at ON public.statement_imports;
CREATE TRIGGER set_statement_imports_updated_at
  BEFORE UPDATE ON public.statement_imports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- SECAO 4: notification_preferences  (avisar quando?)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.notification_preferences (
    user_id uuid NOT NULL,
    -- 3 dias e o default porque e o prazo que ainda da para agir: ver a conta
    -- no dia do vencimento nao evita a multa se o banco ja fechou.
    days_before integer NOT NULL DEFAULT 3,
    notify_due_soon boolean NOT NULL DEFAULT true,
    notify_overdue boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT notification_preferences_pkey PRIMARY KEY (user_id),
    -- 0 = so no dia. Acima de 30 o aviso deixa de ser aviso e vira ruido de
    -- fundo; e o limite tambem protege a varredura do cron.
    CONSTRAINT notification_preferences_days_check CHECK (days_before BETWEEN 0 AND 30),
    CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.notification_preferences IS
  'Quantos dias antes avisar. Linha ausente = o default de 3 dias, aplicado por COALESCE em bill_alerts.';

DROP TRIGGER IF EXISTS set_notification_preferences_updated_at ON public.notification_preferences;
CREATE TRIGGER set_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- SECAO 5: push_subscriptions  (os aparelhos)
-- =====================================================
-- Um usuario tem varios: o celular, o notebook, o tablet. Cada um e um
-- endpoint distinto do servico de push do navegador.
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    -- as duas chaves da assinatura. Sem elas nao da para cifrar o payload, e o
    -- servico de push recusa a entrega.
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    last_success_at timestamp with time zone,
    -- o navegador devolve 404/410 quando o usuario desinstalou o PWA ou limpou
    -- os dados. Contar a falha permite parar de tentar em vez de acumular
    -- endpoints mortos para sempre.
    failure_count integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id),
    -- UNIQUE no endpoint sozinho, sem o user_id: o mesmo navegador reassinando
    -- gera o mesmo endpoint, e duas linhas iguais mandariam a notificacao em
    -- duplicata para o mesmo aparelho.
    CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint),
    CONSTRAINT push_subscriptions_failure_check CHECK (failure_count >= 0),
    CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.push_subscriptions IS
  'Aparelhos que aceitaram push. endpoint e UNIQUE global: o mesmo navegador reassinando nao vira duas linhas.';

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions(user_id);

-- =====================================================
-- SECAO 6: bill_notifications  (o que ja foi avisado)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.bill_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    scheduled_transaction_id uuid NOT NULL,
    kind text NOT NULL,
    -- o due_date que originou o aviso. Faz parte da chave unica: adiar a conta
    -- e um fato novo e merece um aviso novo. Ver o cabecalho.
    reference_date date NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    -- entregue por push, ou so no sino do app? 'inapp' e o que acontece quando
    -- o usuario nao assinou push, ou quando o VAPID nao esta configurado no
    -- servidor -- e continua sendo um aviso util.
    channel text NOT NULL DEFAULT 'inapp',
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT bill_notifications_pkey PRIMARY KEY (id),
    CONSTRAINT bill_notifications_kind_check CHECK (kind IN ('due_soon', 'overdue')),
    CONSTRAINT bill_notifications_channel_check CHECK (channel IN ('inapp', 'push')),
    -- ESTA e a linha que impede o aplicativo de virar spam. Ver o cabecalho.
    CONSTRAINT bill_notifications_unique UNIQUE (scheduled_transaction_id, kind, reference_date),
    CONSTRAINT bill_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT bill_notifications_scheduled_id_fkey FOREIGN KEY (scheduled_transaction_id) REFERENCES public.scheduled_transactions(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.bill_notifications IS
  'Avisos de vencimento ja emitidos. A UNIQUE (conta, tipo, data) e o que impede repetir o mesmo aviso todo dia.';

CREATE INDEX IF NOT EXISTS idx_bill_notifications_user
  ON public.bill_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bill_notifications_unread
  ON public.bill_notifications(user_id) WHERE read_at IS NULL;

-- =====================================================
-- SECAO 7: bill_alerts  (o que vence, e ja foi avisado?)
-- =====================================================
-- Uma definicao so, usada por dois consumidores: o cron, que filtra
-- `already_notified = false` e manda; e o sino do app, que mostra tudo. Duas
-- consultas separadas sairiam de sincronia na primeira vez que alguem mudasse
-- a janela de dias, e o usuario veria no sino uma conta que o push nunca
-- mandou (ou o contrario).
--
-- `status = 'pending'` e o filtro central: conta paga ou cancelada nao gera
-- aviso. O CHECK do 005 garante que 'paid' tem paid_date e transaction_id,
-- entao nao ha estado ambiguo aqui.
--
-- COALESCE(p.days_before, 3) e o que faz a view funcionar para quem nunca
-- abriu a tela de preferencias -- que e todo mundo, no dia em que isto sobe.
-- Um INNER JOIN em notification_preferences daria uma view vazia e o cron
-- silenciosamente nao avisaria ninguem, sem erro nenhum.
CREATE OR REPLACE VIEW public.bill_alerts AS
  SELECT
    s.id AS scheduled_transaction_id,
    s.user_id,
    s.group_id,
    s.account_id,
    s.description,
    s.amount,
    s.due_date,
    (s.due_date - CURRENT_DATE) AS days_until,
    CASE WHEN s.due_date < CURRENT_DATE THEN 'overdue' ELSE 'due_soon' END AS kind,
    COALESCE(p.days_before, 3) AS days_before,
    -- o tipo mora na regra, nao na ocorrencia; sem regra e despesa. Mesmo
    -- COALESCE de planned_vs_actual no 008 e da rota de baixa -- as tres
    -- precisam concordar ou uma conta prevista de receita vira despesa.
    COALESCE(r.transaction_type, 'expense') AS transaction_type,
    EXISTS (
      SELECT 1 FROM public.bill_notifications n
      WHERE n.scheduled_transaction_id = s.id
        AND n.kind = (CASE WHEN s.due_date < CURRENT_DATE THEN 'overdue' ELSE 'due_soon' END)
        AND n.reference_date = s.due_date
    ) AS already_notified
  FROM public.scheduled_transactions s
  LEFT JOIN public.notification_preferences p ON p.user_id = s.user_id
  LEFT JOIN public.recurring_rules r ON r.id = s.recurring_rule_id
  WHERE s.status = 'pending'
    -- vencida entra sempre que o usuario quiser ver vencidas; a vencer, so
    -- dentro da janela dele.
    AND (
      (s.due_date < CURRENT_DATE AND COALESCE(p.notify_overdue, true))
      OR (s.due_date >= CURRENT_DATE
          AND COALESCE(p.notify_due_soon, true)
          AND s.due_date - CURRENT_DATE <= COALESCE(p.days_before, 3))
    );

COMMENT ON VIEW public.bill_alerts IS
  'Contas que merecem aviso hoje, com already_notified. Uma definicao para o cron e para o sino do app.';

-- =====================================================
-- SECAO 8: receipts  (o comprovante)
-- =====================================================
-- financial_transactions.attachment_url ja existe no 001 e e um texto livre --
-- qualquer URL, sem dono, sem tamanho, sem tipo. Ela continua onde esta e NAO e
-- alterada por este arquivo: mexer nela migraria dados de producao as cegas.
-- `receipts` e o caminho novo, com arquivo de verdade no Storage, e aceita mais
-- de um comprovante por lancamento (a nota fiscal E o boleto).
CREATE TABLE IF NOT EXISTS public.receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    -- exatamente UM dos tres. Um comprovante solto nao tem a que se referir, e
    -- um comprovante ligado a dois lugares apareceria duas vezes no total.
    transaction_id uuid,
    scheduled_transaction_id uuid,
    settlement_id uuid,
    -- caminho dentro do bucket 'receipts', sempre '<user_id>/<uuid>.<ext>'. A
    -- policy do Storage (SECAO 9) le a primeira pasta do caminho para decidir
    -- o dono, entao o prefixo nao e cosmetico.
    storage_path text NOT NULL,
    file_name text NOT NULL,
    mime_type text NOT NULL,
    byte_size integer NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT receipts_pkey PRIMARY KEY (id),
    CONSTRAINT receipts_storage_path_key UNIQUE (storage_path),
    CONSTRAINT receipts_target_check CHECK (
      num_nonnulls(transaction_id, scheduled_transaction_id, settlement_id) = 1
    ),
    -- 10 MB. Foto de boleto pelo celular da 2-4 MB; acima de 10 e video ou PDF
    -- digitalizado em 600dpi, e o plano gratuito do Storage some em uma semana.
    CONSTRAINT receipts_size_check CHECK (byte_size > 0 AND byte_size <= 10485760),
    CONSTRAINT receipts_mime_check CHECK (
      mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf')
    ),
    CONSTRAINT receipts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT receipts_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.financial_transactions(id) ON DELETE CASCADE,
    CONSTRAINT receipts_scheduled_id_fkey FOREIGN KEY (scheduled_transaction_id) REFERENCES public.scheduled_transactions(id) ON DELETE CASCADE,
    CONSTRAINT receipts_settlement_id_fkey FOREIGN KEY (settlement_id) REFERENCES public.group_settlements(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.receipts IS
  'Comprovante no Storage. O arquivo em si NAO e apagado pelo CASCADE -- ver a nota da SECAO 9.';
COMMENT ON COLUMN public.receipts.storage_path IS
  'Sempre <user_id>/<uuid>.<ext>: a policy do Storage decide o dono pela primeira pasta do caminho.';

CREATE INDEX IF NOT EXISTS idx_receipts_transaction ON public.receipts(transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receipts_scheduled ON public.receipts(scheduled_transaction_id) WHERE scheduled_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receipts_settlement ON public.receipts(settlement_id) WHERE settlement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receipts_user ON public.receipts(user_id, created_at DESC);

-- =====================================================
-- SECAO 9: RLS
-- =====================================================
-- Mesmo desenho do 002, 005, 006, 007 e 008: nega por padrao, libera o dono e
-- - nas linhas de grupo - os membros. Sem policy para anon: a chave anon vai no
-- bundle JS publico.
ALTER TABLE public.statement_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.statement_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;

-- Extrato e sempre pessoal, mesmo quando a conta e usada para gastos de grupo:
-- o arquivo do banco traz TUDO que passou na conta, inclusive o que nao tem
-- nada a ver com a viagem. Nenhuma policy de grupo aqui, de proposito.
DROP POLICY IF EXISTS statement_imports_all ON public.statement_imports;
CREATE POLICY statement_imports_all ON public.statement_imports
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS statement_entries_all ON public.statement_entries;
CREATE POLICY statement_entries_all ON public.statement_entries
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS notification_preferences_all ON public.notification_preferences;
CREATE POLICY notification_preferences_all ON public.notification_preferences
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS push_subscriptions_all ON public.push_subscriptions;
CREATE POLICY push_subscriptions_all ON public.push_subscriptions
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- O usuario le e marca como lido; quem CRIA o aviso e o cron, com a
-- service_role, que passa por cima de RLS. Sem policy de INSERT para
-- authenticated de proposito: nada no navegador deveria poder fabricar um
-- aviso de vencimento.
DROP POLICY IF EXISTS bill_notifications_select ON public.bill_notifications;
CREATE POLICY bill_notifications_select ON public.bill_notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS bill_notifications_update ON public.bill_notifications;
CREATE POLICY bill_notifications_update ON public.bill_notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS bill_notifications_delete ON public.bill_notifications;
CREATE POLICY bill_notifications_delete ON public.bill_notifications
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- O comprovante do acerto de grupo o grupo inteiro precisa ver: e a prova de
-- que o pagamento aconteceu, e foi por isso que o acerto existiu no 007. Os
-- outros dois alvos sao pessoais.
DROP POLICY IF EXISTS receipts_select ON public.receipts;
CREATE POLICY receipts_select ON public.receipts
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (settlement_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.group_settlements gs
          WHERE gs.id = receipts.settlement_id
            AND public.is_group_member(gs.group_id)
        ))
  );

DROP POLICY IF EXISTS receipts_insert ON public.receipts;
CREATE POLICY receipts_insert ON public.receipts
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS receipts_delete ON public.receipts;
CREATE POLICY receipts_delete ON public.receipts
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- =====================================================
-- SECAO 10: GRANTS
-- =====================================================
-- O 002 rodou GRANT ... ON ALL TABLES antes destes objetos existirem, e ALL
-- TABLES nao alcanca o futuro.
REVOKE ALL ON public.statement_imports FROM anon;
REVOKE ALL ON public.statement_entries FROM anon;
REVOKE ALL ON public.notification_preferences FROM anon;
REVOKE ALL ON public.push_subscriptions FROM anon;
REVOKE ALL ON public.bill_notifications FROM anon;
REVOKE ALL ON public.receipts FROM anon;
REVOKE ALL ON public.bill_alerts FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.statement_imports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.statement_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT SELECT, UPDATE, DELETE ON public.bill_notifications TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.receipts TO authenticated;
GRANT SELECT ON public.bill_alerts TO authenticated;

-- Sem security_invoker a view roda com o privilegio do DONO e a RLS das tabelas
-- base nao vale: bill_alerts devolveria as contas a vencer de TODOS os usuarios
-- do sistema -- descricao, valor e data -- para qualquer um logado. Mesma
-- pegadinha do 005, 006, 007 e 008, e o teste tem controle negativo para ela.
ALTER VIEW public.bill_alerts SET (security_invoker = true);

-- =====================================================
-- SECAO 11: bucket de comprovantes  (SO NO SUPABASE)
-- =====================================================
-- Num Postgres cru o schema `storage` nao existe e este bloco e pulado inteiro
-- com um NOTICE -- e por isso que o CI consegue provar as dez secoes acima.
--
-- O bucket e PRIVADO. Publico seria uma URL adivinhavel com a foto do boleto de
-- alguem: nome, CPF parcial, valor e codigo de barras. A leitura sai por URL
-- assinada, gerada pela rota com o usuario ja autenticado.
--
-- A policy decide o dono por (storage.foldername(name))[1] -- a primeira pasta
-- do caminho. E por isso que storage_path e sempre '<user_id>/<uuid>.<ext>'.
--
-- O ARQUIVO NAO E APAGADO PELO CASCADE: apagar o lancamento apaga a linha de
-- `receipts`, mas o objeto continua no bucket ocupando espaco. Isso e
-- deliberado -- um trigger que apaga arquivo e irreversivel e roda fora da
-- transacao. A rota DELETE /api/receipts/[id] apaga os dois na ordem certa; o
-- que sobra e o orfao de quem apagou o lancamento direto pela tela de
-- lancamentos, e isso fica como divida anotada aqui.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE '009: schema storage ausente (Postgres cru) - bucket de comprovantes PULADO. Num Supabase esta secao roda.';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('receipts', 'receipts', false, 10485760,
          ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
  ON CONFLICT (id) DO UPDATE
    SET public = false,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

  EXECUTE $pol$ DROP POLICY IF EXISTS receipts_objects_select ON storage.objects $pol$;
  EXECUTE $pol$
    CREATE POLICY receipts_objects_select ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'receipts'
             AND (storage.foldername(name))[1] = auth.uid()::text)
  $pol$;

  EXECUTE $pol$ DROP POLICY IF EXISTS receipts_objects_insert ON storage.objects $pol$;
  EXECUTE $pol$
    CREATE POLICY receipts_objects_insert ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'receipts'
                  AND (storage.foldername(name))[1] = auth.uid()::text)
  $pol$;

  EXECUTE $pol$ DROP POLICY IF EXISTS receipts_objects_delete ON storage.objects $pol$;
  EXECUTE $pol$
    CREATE POLICY receipts_objects_delete ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'receipts'
             AND (storage.foldername(name))[1] = auth.uid()::text)
  $pol$;

  RAISE NOTICE '009: bucket receipts criado/atualizado (privado) com as tres policies.';
END $$;

-- =====================================================
-- SECAO 12: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('009', '009_statements_alerts_receipts',
        'Importacao de extrato com conciliacao, avisos de vencimento e comprovantes - HMO-137 Fase 5', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
