-- ===========================================================================
-- 057 -- O AVISO DE VENCIMENTO DA CONTA DE GRUPO VAI PARA CADA MEMBRO (HMO-414)
-- ===========================================================================
--
-- ESTA MIGRATION TEM DE SER COLADA *DEPOIS* DO DEPLOY DO CODIGO. LEIA ISTO
-- ANTES DE COLAR.
-- ---------------------------------------------------------------------------
-- Quase toda migration desta base e aditiva e pode ser colada com a `main`
-- velha no ar -- a 050 escreve isso em voz alta ("nao existe ordem ruim entre
-- colar e deployar") e a 055 tambem. **AQUI NAO.**
--
-- A SECAO 2 TROCA a UNIQUE de `bill_notifications`. O cron de vencimento grava
-- com `upsert(..., { onConflict: "<lista de colunas>" })`, e o PostgREST exige
-- um indice unico que CASE com essa lista -- senao a resposta e erro, nao
-- "ignorei o conflito". Entao:
--
--   * colar ANTES do deploy: o cron da `main` velha manda a lista de 3 colunas,
--     o indice de 3 colunas nao existe mais, e o job responde erro TODO DIA
--     ate o deploy sair. Ninguem e avisado de nada nesse periodo;
--   * colar DEPOIS do deploy: o codigo novo manda a lista de 4 colunas, que
--     ainda nao existe -- mesmo erro, mas a janela e so o tempo entre o deploy
--     e a colagem, e ela esta na sua mao.
--
-- A segunda e a ordem escolhida, e ela e a UNICA das duas que se encurta.
--
-- A alternativa de tres embarques (acrescentar a UNIQUE larga -> deployar ->
-- dropar a estreita) nao tem janela de ERRO, mas tambem nao entrega a feature
-- no meio: enquanto a UNIQUE estreita existir o fan-out continua recusado
-- (medicao 4 abaixo), e o preco e um PR virar tres. Ficou de fora de proposito.
--
-- MANTER A UNIQUE ESTREITA NAO E OPCAO: enquanto ela existir, o aviso do
-- segundo destinatario e descartado em silencio.
--
-- ===========================================================================
-- O DEFEITO, MEDIDO
-- ===========================================================================
-- `bill_alerts` nasceu no 009, ganhou `notify_email` na 047 e passou a ler
-- `scheduled_transactions_effective` na 050. Em todas as tres versoes o
-- destinatario e `s.user_id` -- o DONO da linha. Conta prevista de grupo e UMA
-- linha, do dono. Entao o aviso de vencimento de uma conta da casa sai so para
-- quem a cadastrou; os outros membros veem a conta na tela e nao recebem aviso
-- nenhum.
--
-- Medido num Postgres 17 com a cadeia 001 -> 056 colada do zero, grupo `Casa`
-- com o dono (Helio) e dois membros ativos (Lais, Ana), uma conta do grupo
-- vencendo em 2 dias e uma conta pessoal do dono no mesmo dia como controle.
-- Cada leitura feita DUAS vezes: como o cron (`service_role`, RLS desligada) e
-- como o membro (`SET ROLE authenticated` + `request.jwt.claim.sub`).
--
--   1. destinatarios da conta do grupo, como o cron le .......... 1 (o dono)
--      membros ativos do grupo ..................................... 3
--   2. a Lais ve a conta no sino, com `user_id` do HELIO; e
--      `select count(*) from bill_notifications` como ela ....... 0
--   3. com so o dono avisado, `already_notified` lido pelo cron ... true
--      -- a conta sai da varredura de amanha PARA TODOS
--   4. gravado o aviso do dono, o aviso da Lais:
--        INSERT cru ............................ duplicate key (a UNIQUE)
--        INSERT ... ON CONFLICT DO NOTHING ..... INSERT 0 0, sem erro
--      (a rota usa `ignoreDuplicates: true`, que e o segundo caso)
--   5. a preferencia e do DONO: com a Lais pedindo 7 dias e o dono nos 3 do
--      default, a conta que vence em 5 dias NAO entra na lista de ninguem --
--      `days_before` esta no WHERE, entao o "me avise mais cedo" dela nunca e
--      consultado
--   6. o dono que SAIU do grupo (soft delete, `status = 'inactive'`) continua
--      recebendo hoje, porque a conta continua sendo dele
--
-- As quatro primeiras sao acopladas: mexer so no destinatario da view entrega
-- um PR que passa em revisao e nao manda UM e-mail a mais, porque a 3 tira a
-- conta da varredura e a 4 descarta a segunda linha calada.
--
-- ===========================================================================
-- A DECISAO: QUEM RECEBE
-- ===========================================================================
-- A issue oferecia dois critérios. Medidos no mesmo fixture:
--
--   A -- membros ATIVOS do grupo (`is_group_member`) ....... 3 destinatarios
--   B -- membros ativos com `percentage > 0` ............... 0 destinatarios
--       (soma dos pesos do grupo: 0)
--
-- **B manda o aviso para NINGUEM, e nao por azar do fixture.**
-- `group_members.percentage` e `numeric DEFAULT 0.00` e nulavel: grupo que
-- nunca passou pela tela de divisao tem peso zero em todos. A 042 trata esse
-- estado como o caminho NORMAL -- o `IF v_soma_pesos > 0` dela existe para
-- cair em divisao igual justamente nele. Sob B o aviso desapareceria tambem
-- para o DONO, que recebe hoje: B nao e a opcao conservadora, e regressao.
--
-- Escolhido (aprovado na issue em 17/10/2026):
--
--   DESTINATARIO = os membros ATIVOS do grupo, MAIS o dono da conta prevista.
--
-- O `UNION` com o dono nao e enfeite: ele cobre a medicao 6 e da a invariante
-- que faz esta mudanca revisavel -- **ninguem que recebe aviso hoje para de
-- receber.** Para conta que nao e de grupo o conjunto e `{s.user_id}` e nada
-- muda, nem o numero de linhas.
--
-- `status = 'active'` e o mesmo recorte de `public.is_group_member` (002/051):
-- saida de grupo e soft delete e deixa a linha com `inactive`. A funcao nao e
-- usada aqui porque ela responde sobre `auth.uid()`, e esta view precisa do
-- conjunto INTEIRO -- o cron roda sem usuario nenhum.
--
-- ===========================================================================
-- O QUE ESTA MIGRATION *NAO* MUDA
-- ===========================================================================
--   * A LISTA DE COLUNAS. 13 colunas, mesmos nomes, mesma ordem, mesmos tipos
--     -- e por isso que `CREATE OR REPLACE VIEW` basta (ele recusaria tirar,
--     renomear ou mudar o tipo de qualquer uma).
--   * `transaction_type` continua vindo de `s.direction` (050), `days_before`,
--     `notify_due_soon`, `notify_overdue`, `notify_email` e o recorte
--     `s.status = 'pending'` continuam identicos. NADA entra no WHERE que nao
--     estivesse la.
--   * A direcao do aviso (050) e a frase (`textoDoAviso`): intocadas.
--   * Cartao e transferencia prevista: nada aqui os alcanca.
--   * `scheduled_transactions_effective` (055) NAO e recriada. Esta migration
--     so a LE -- e so colunas que nao dependem de `auth.uid()`
--     (`my_status` desaba para `pending` no cliente de service_role, e por isso
--     nao e usada aqui).
--
-- O QUE FICA DE FORA, DECLARADO: nao cobrar quem ja esta `reported`/`paid` em
-- `group_bill_payments` (055), e o rotulo "a sua parte de R$ 100,00" em vez do
-- valor cheio. Os dois dependem de `my_status` ter leitor (HMO-411) e sao
-- refinamento do WHERE e do TEXTO, nao do destinatario.
--
-- ===========================================================================
-- IDEMPOTENTE E SEM META-COMANDO
-- ===========================================================================
-- Producao recebe migration por colagem no SQL Editor do Supabase (nao ha
-- runner -- ver a nota no topo do 015). Nenhuma linha comeca com `\`: uma
-- unica delas reprovaria o arquivo INTEIRO.
--
-- Rodar duas vezes e inofensivo: a troca da UNIQUE confere a LISTA DE COLUNAS
-- do indice antes de mexer (um `DROP ... IF EXISTS` + `ADD` solto reprovaria na
-- segunda colagem com "constraint already exists"), e o resto e
-- `CREATE OR REPLACE VIEW` + `COMMENT` + `ALTER VIEW` + `GRANT`.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Preflight -- o que esta migration PRECISA achar no banco
-- ---------------------------------------------------------------------------
-- Mesmo desenho do preflight da 045/046/049/050. Aplicada fora de ordem, esta
-- migration recolaria `bill_alerts` SEM `notify_email` (se a 047 nao tivesse
-- passado) ou falharia no meio do CREATE VIEW com "column direction does not
-- exist" (sem a 027) -- e nenhum desses erros diz qual migration falta.
DO $$
DECLARE
  v_faltando TEXT;
BEGIN
  SELECT string_agg(msg, E'\n') INTO v_faltando
  FROM (
    SELECT '  - view public.bill_alerts (vem do 009, recolada pela 047 e pela 050)' AS msg
    WHERE to_regclass('public.bill_alerts') IS NULL
    UNION ALL
    SELECT '  - tabela public.bill_notifications (vem do 009)'
    WHERE to_regclass('public.bill_notifications') IS NULL
    UNION ALL
    SELECT '  - view public.scheduled_transactions_effective (vem do 005, refeita pela 027 e pela 055)'
    WHERE to_regclass('public.scheduled_transactions_effective') IS NULL
    UNION ALL
    SELECT '  - tabela public.group_members (vem do 001)'
    WHERE to_regclass('public.group_members') IS NULL
    UNION ALL
    -- A coluna da 027 que a 050 passou a ler. Sem ela o CREATE OR REPLACE
    -- abaixo falha com um erro que nao nomeia nenhuma migration.
    SELECT '  - coluna direction em public.scheduled_transactions_effective (vem do 027)'
    WHERE to_regclass('public.scheduled_transactions_effective') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'scheduled_transactions_effective'
           AND column_name = 'direction'
      )
    UNION ALL
    -- Sem esta, o CREATE OR REPLACE reprovaria por numero de colunas (13
    -- contra 12), e o erro diria "cannot drop columns from view" -- que se le
    -- como defeito DESTE arquivo em vez de "a 047 nao foi colada".
    SELECT '  - coluna notify_email em public.bill_alerts (vem da 047)'
    WHERE to_regclass('public.bill_alerts') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'bill_alerts'
           AND column_name = 'notify_email'
      )
    UNION ALL
    -- `status` em group_members vem do 001 e e o recorte de membro ATIVO. Sem
    -- ela o conjunto de destinatarios incluiria quem saiu do grupo.
    SELECT '  - coluna status em public.group_members (vem do 001)'
    WHERE to_regclass('public.group_members') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'group_members'
           AND column_name = 'status'
      )
  ) f;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'057 nao pode ser aplicada: faltam objetos no banco.\n%\nAplique as migrations anteriores em ordem antes desta.', v_faltando;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. A UNIQUE de bill_notifications passa a incluir o destinatario
-- ---------------------------------------------------------------------------
-- O 009 escreveu `UNIQUE (scheduled_transaction_id, kind, reference_date)` e
-- chamou de "a linha que impede o aplicativo de virar spam". Ela continua
-- impedindo -- so que agora POR PESSOA. Sem `user_id` ali, o aviso da Lais
-- sobre a conta da casa colide com o do Helio sobre a MESMA conta, e o
-- `ON CONFLICT DO NOTHING` do cron o descarta sem erro (medicao 4).
--
-- `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` solto NAO seria idempotente
-- (a segunda colagem reprovaria com "already exists"). O DO abaixo compara a
-- LISTA DE COLUNAS do que existe com a desejada e so mexe se divergir -- entao
-- colar duas vezes e inofensivo, e colar num banco que ja esta certo nao
-- derruba e nem recria indice de producao a esmo.
--
-- A ORDEM das colunas na UNIQUE nao e load-bearing para o `ON CONFLICT`: o
-- Postgres infere o indice pelo CONJUNTO de colunas, nao pela ordem. O que e
-- load-bearing e o conjunto ter QUATRO colunas, e `user_id` ser uma delas.
-- A LISTA DE COLUNAS APARECE UMA VEZ SO, no `v_add` abaixo -- de proposito, e
-- isso custou uma medicao: na primeira versao deste arquivo os dois ramos
-- (`IF` e `ELSIF`) carregavam a lista escrita a mao, e um mutante que estragou
-- a lista do PRIMEIRO ramo SOBREVIVEU a suite inteira -- porque num banco que
-- tem a UNIQUE do 009 esse ramo nunca roda. Duas copias de uma lista de
-- colunas sao uma divida silenciosa: a proxima mudanca corrige a que o olho
-- acha primeiro.
--
-- `v_quero` e a MESMA lista em outra forma (ordenada alfabeticamente, que e
-- como o catalogo responde) e serve para comparar, nao para criar. As duas tem
-- de concordar, e quem reprova se discordarem e a assercao de catalogo da
-- SECAO 3 do teste desta migration.
DO $$
DECLARE
  v_cols TEXT;
  v_quero CONSTANT TEXT := 'kind,reference_date,scheduled_transaction_id,user_id';
  v_add   CONSTANT TEXT :=
    'ALTER TABLE public.bill_notifications'
    || ' ADD CONSTRAINT bill_notifications_unique'
    || ' UNIQUE (scheduled_transaction_id, user_id, kind, reference_date)';
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY a.attname)
    INTO v_cols
    FROM pg_constraint c
    CROSS JOIN LATERAL unnest(c.conkey) AS k(attnum)
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
   WHERE c.conrelid = 'public.bill_notifications'::regclass
     AND c.conname  = 'bill_notifications_unique'
     AND c.contype  = 'u';

  IF v_cols IS NULL THEN
    -- Nao existe (banco onde alguem a dropou a mao): cria na forma nova.
    EXECUTE v_add;
    RAISE NOTICE '057: bill_notifications_unique criada com user_id';

  ELSIF v_cols <> v_quero THEN
    -- A forma do 009 (tres colunas). Troca.
    --
    -- Alargar uma UNIQUE NUNCA conflita com os dados: toda linha que era unica
    -- pelas tres colunas continua unica pelas quatro. Nao ha backfill nem
    -- NOT VALID a considerar.
    ALTER TABLE public.bill_notifications
      DROP CONSTRAINT bill_notifications_unique;
    EXECUTE v_add;
    RAISE NOTICE '057: bill_notifications_unique passou a incluir user_id (era %)', v_cols;

  ELSE
    RAISE NOTICE '057: bill_notifications_unique ja inclui user_id, nada a fazer';
  END IF;
END $$;

COMMENT ON TABLE public.bill_notifications IS
  'Avisos de vencimento ja emitidos. A UNIQUE (conta, PESSOA, tipo, data) e o '
  'que impede repetir o mesmo aviso todo dia -- e desde a 057 ela e por '
  'PESSOA: conta prevista de grupo rende um aviso por membro, e sem user_id na '
  'chave o segundo era descartado em silencio pelo ON CONFLICT DO NOTHING do '
  'cron (HMO-414).';

-- ---------------------------------------------------------------------------
-- 2. bill_alerts: uma linha POR DESTINATARIO
-- ---------------------------------------------------------------------------
-- `CREATE OR REPLACE VIEW` exige a definicao inteira. Diferencas em relacao a
-- 050, e sao so estas quatro:
--
--   * o `CROSS JOIN LATERAL` novo, que produz o conjunto de destinatarios;
--   * `d.user_id` na posicao 2 (era `s.user_id`);
--   * o `EXISTS` de `already_notified` correlacionado tambem por
--     `n.user_id = d.user_id`;
--   * o `LEFT JOIN notification_preferences` em `d.user_id` (era `s.user_id`).
--
-- Todo o resto e copia literal da 050. **QUEM RECOLAR ESTA VIEW DAQUI PARA A
-- FRENTE CARREGA O LATERAL JUNTO**: recolar a versao da 050 por cima reverte
-- este conserto sem erro, sem log e sem sintoma na tela -- o aviso volta a sair
-- so para o dono. Quem avisa e o step que re-roda o teste deste arquivo no fim
-- da cadeia, no `db-verify.yml`.
--
-- POR QUE `LATERAL ... UNION` E NAO UM `LEFT JOIN group_members`:
-- com `LEFT JOIN` a conta PESSOAL (sem `group_id`) continuaria em uma linha,
-- mas a conta de grupo cujo dono NAO e mais membro ativo (medicao 6) sairia com
-- o dono de fora -- e um grupo sem nenhum membro ativo apagaria a conta da
-- view. O `UNION` resolve as duas de uma vez e dedupe o dono que tambem e
-- membro (que e o caso normal: a trigger do 001 inscreve o criador).
CREATE OR REPLACE VIEW public.bill_alerts AS
  SELECT
    s.id AS scheduled_transaction_id,
    -- O DESTINATARIO, e nao mais o dono. Toda a issue esta nesta coluna.
    d.user_id,
    s.group_id,
    s.account_id,
    s.description,
    s.amount,
    s.due_date,
    (s.due_date - CURRENT_DATE) AS days_until,
    CASE WHEN s.due_date < CURRENT_DATE THEN 'overdue' ELSE 'due_soon' END AS kind,
    COALESCE(p.days_before, 3) AS days_before,
    s.direction AS transaction_type,
    EXISTS (
      SELECT 1 FROM public.bill_notifications n
      WHERE n.scheduled_transaction_id = s.id
        -- A segunda metade do conserto, e a que faz a primeira valer: sem ela
        -- o aviso ja gravado de UMA pessoa tira a conta da varredura de todas
        -- as outras -- o cron le com a RLS desligada e enxerga o aviso de
        -- qualquer um (medicao 3).
        AND n.user_id = d.user_id
        AND n.kind = (CASE WHEN s.due_date < CURRENT_DATE THEN 'overdue' ELSE 'due_soon' END)
        AND n.reference_date = s.due_date
    ) AS already_notified,
    COALESCE(p.notify_email, true) AS notify_email
  FROM public.scheduled_transactions_effective s
  CROSS JOIN LATERAL (
    -- O dono SEMPRE. E a invariante "ninguem que recebe hoje para de receber".
    SELECT s.user_id AS user_id
    UNION
    -- Mais os membros ATIVOS, quando a conta e de grupo. `status = 'active'` e
    -- o recorte de `is_group_member`: sair do grupo e soft delete (051).
    --
    -- `s.group_id IS NOT NULL` e REDUNDANTE e fica de proposito. Medido: um
    -- mutante que o apaga SOBREVIVE a suite, e esta certo -- com `group_id`
    -- nulo a igualdade da linha de baixo ja nao casa com nada (`gm.group_id =
    -- NULL` e NULL, nao TRUE), entao a conta pessoal continua rendendo uma
    -- linha com ou sem ele. Fica escrito porque e a regra em prosa ("so conta
    -- de grupo tem outros destinatarios") no lugar onde ela vale, e porque
    -- `IS NOT NULL` tambem e o que diz ao planejador que o ramo e vazio para a
    -- maioria das linhas. Mutante sobrevivente DOCUMENTADO nao e divida; o que
    -- seria divida e descobrir isto daqui a seis meses e nao saber se a linha
    -- importava.
    SELECT gm.user_id
      FROM public.group_members gm
     WHERE s.group_id IS NOT NULL
       AND gm.group_id = s.group_id
       AND gm.status = 'active'
  ) d
  -- A PREFERENCIA E DE QUEM RECEBE, nao de quem cadastrou (medicao 5). Isto
  -- muda a LISTA e nao so o rotulo: `days_before` esta no WHERE abaixo, entao
  -- so com este join em `d.user_id` o "me avise com 7 dias" de um membro passa
  -- a ser consultado.
  LEFT JOIN public.notification_preferences p ON p.user_id = d.user_id
  WHERE s.status = 'pending'
    AND (
      (s.due_date < CURRENT_DATE AND COALESCE(p.notify_overdue, true))
      OR (s.due_date >= CURRENT_DATE
          AND COALESCE(p.notify_due_soon, true)
          AND s.due_date - CURRENT_DATE <= COALESCE(p.days_before, 3))
    );

-- `s.status = 'pending'` e NAO `s.effective_status`, nem `s.my_status` (055),
-- de proposito e pelos dois motivos:
--
--   * `effective_status` envelhece a linha para 'overdue' sozinho quando a data
--     passa (027/005), entao filtrar por ele apagaria da view toda conta
--     VENCIDA -- que e metade do que ela existe para avisar (`kind =
--     'overdue'`). O recorte do 009 e sobre o estado GRAVADO, e e esse que fica;
--   * `my_status` responde sobre `auth.uid()`, e o cron roda com service_role
--     e sem usuario: para ele a coluna desaba para a CONSTANTE `pending` --
--     filtrar por ela daria verde no app e nao recortaria nada no cron. Nao
--     cobrar quem ja avisou que pagou e refinamento desta view, e depende de
--     `my_status` passar a ser lido por destinatario (HMO-411), nao por
--     `auth.uid()`.

COMMENT ON VIEW public.bill_alerts IS
  'Contas que merecem aviso hoje, UMA LINHA POR DESTINATARIO (057), com '
  'already_notified e notify_email dessa pessoa. Conta prevista de grupo e uma '
  'linha so, do dono -- e por isso o aviso saia so para ele (HMO-414); aqui ela '
  'rende uma linha para cada membro ATIVO do grupo, mais o dono. Conta pessoal '
  'continua rendendo uma linha. Uma definicao para o cron e para o sino do app; '
  'o sino filtra user_id = o usuario logado, senao o membro ve a mesma conta '
  'uma vez por pessoa do grupo (a RLS de group_members mostra o grupo inteiro).';

COMMENT ON COLUMN public.bill_alerts.user_id IS
  'O DESTINATARIO do aviso, nao o dono da conta prevista (057). Para conta de '
  'grupo ha uma linha por membro ativo mais o dono; quem quer o dono le '
  'scheduled_transactions.user_id. E a coluna que o cron grava em '
  'bill_notifications.user_id, e e por isso que a UNIQUE de la precisou dela.';

COMMENT ON COLUMN public.bill_alerts.already_notified IS
  'Se ESTA pessoa ja foi avisada desta conta nesta data (057). Antes era '
  'global: o cron le com a RLS desligada, entao o aviso de um membro fazia a '
  'conta sair da varredura de todos os outros.';

COMMENT ON COLUMN public.bill_alerts.notify_email IS
  'A preferencia de canal do DESTINATARIO (057), nao a do dono da conta. Vale '
  'tambem para days_before, notify_due_soon e notify_overdue, que estao no '
  'WHERE: e por isso que trocar este join muda a LISTA, e nao so o rotulo.';

-- ---------------------------------------------------------------------------
-- 3. O security_invoker, de volta
-- ---------------------------------------------------------------------------
-- `security_invoker` e reloption e NAO sobrevive ao `CREATE OR REPLACE` acima
-- (medido na 047, repetido na 050). Obrigatorio em toda migration que recria
-- esta view.
--
-- O QUE EU ESPERAVA ESCREVER AQUI E O QUE A MEDICAO DISSE
-- -------------------------------------------------------
-- A 050 mediu que esta view nao vaza linha nem como DEFINER: lendo so
-- `scheduled_transactions_effective` (que tem invoker proprio desde a 027),
-- `security_invoker=false` nao alcanca nada, porque ele so troca o dono para as
-- relacoes referenciadas DIRETAMENTE. E ela previu em voz alta o dia em que
-- isso mudaria -- *"o dia em que alguem fizer esta view tocar uma tabela direto
-- de novo"*. O `LATERAL` desta migration faz exatamente isso: referencia
-- `public.group_members` DIRETO.
--
-- Entao a frase natural aqui seria "o furo reabriu e o ALTER o fecha". **MEDIDO
-- NUM POSTGRES 17 COM A CADEIA 001 -> 057, E E FALSO.** Um usuario fora do
-- grupo, contando as linhas da conta da casa:
--
--   bill_alerts invoker (o estado desta migration) ........ 0 linhas
--   bill_alerts DEFINER ................................... 0 linhas
--
-- Continua nao vazando, e por dois motivos independentes:
--
--   * o portao e o `FROM` de fora. Sem nenhuma linha de
--     `scheduled_transactions_effective` visivel, o LATERAL nunca e avaliado --
--     nao ha o que correlacionar;
--   * e para quem JA ve a conta o LATERAL nao acrescenta nada: a policy
--     `group_members_select` (002) e `user_id = auth.uid() OR
--     is_group_member(group_id)`, ou seja membro ja ve o grupo inteiro. Medido:
--     a Lais ve as 3 linhas de `group_members` da Casa com a RLS LIGADA.
--
-- O ALTER FICA -- pelas razoes que a 050 ja deu, e nao pela que eu ia escrever:
-- uniformidade da cadeia (o `view_security_invoker_test.sql` cobra de TODAS as
-- views) e o dia em que o `FROM` de fora deixar de ser uma view protegida.
--
-- CONSEQUENCIA PARA QUEM ESCREVE TESTE: um controle negativo que apaga esta
-- flag e exige vazamento PASSA VAZIO aqui. O teste desta migration mede o
-- reloption pelo CATALOGO, que e o que de fato mudaria se o ALTER sumisse.
ALTER VIEW public.bill_alerts SET (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 4. Os GRANTs
-- ---------------------------------------------------------------------------
-- `CREATE OR REPLACE VIEW` PRESERVA GRANTs (ao contrario dos reloptions), e o
-- 009 ja deu SELECT a `authenticated`. Reposto porque repetir e barato e
-- descobrir que a preservacao nao valia nao e. `anon` nunca teve e continua sem.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.bill_alerts FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT ON public.bill_alerts TO authenticated';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Sondas para quem cola a mao e nao roda teste
-- ---------------------------------------------------------------------------
-- NOTICE e nao EXCEPTION, no mesmo tom da 042/045/046/049/050: quem reprova
-- isto de verdade e o teste desta migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.bill_alerts'::regclass
       AND COALESCE(reloptions @> ARRAY['security_invoker=true'], FALSE)
  ) THEN
    RAISE NOTICE '057: bill_alerts ficou SEM security_invoker (furando a RLS)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    CROSS JOIN LATERAL unnest(c.conkey) AS k(attnum)
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.conrelid = 'public.bill_notifications'::regclass
       AND c.conname = 'bill_notifications_unique'
       AND a.attname = 'user_id'
  ) THEN
    RAISE NOTICE '057: bill_notifications_unique ficou SEM user_id (o fan-out sera descartado em silencio)';
  END IF;

  -- O LATERAL esta na definicao? Conferir pelo catalogo e barato e pega a
  -- colagem parcial (o arquivo inteiro aplicado menos a secao 2, por exemplo
  -- um copiar-colar cortado no meio -- ver 'migration-colada-pela-metade').
  IF (SELECT pg_get_viewdef('public.bill_alerts'::regclass)) NOT LIKE '%group_members%' THEN
    RAISE NOTICE '057: bill_alerts nao menciona group_members -- o aviso continua saindo so para o dono';
  END IF;
END $$;

COMMIT;
