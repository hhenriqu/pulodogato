-- =====================================================
-- HMO-156 - OS CRONS DISPARARAM?
-- =====================================================
--   psql "$SUPABASE_DB_URL_RO" -f scripts/hmo156-prove-crons.sql
--
-- Responde DUAS perguntas separadas, nesta ordem, porque a segunda so tem
-- sentido depois da primeira:
--
--   1. a 019 esta no banco?          (senao nao ha onde os crons registrarem)
--   2. o que cada cron registrou?
--
-- Misturar as duas e o erro classico aqui: "nenhuma execucao" quando a tabela
-- nao existe e "nenhuma execucao" quando a Vercel nao chamou a rota sao a mesma
-- frase e causas opostas.
-- =====================================================

\echo ''
\echo '=== 1. A 019 ESTA NO BANCO? ==='

-- Objeto por objeto, no catalogo: o ledger `schema_migrations` nao e legivel
-- com esta credencial (RLS com zero policies devolve zero linhas SEM erro), e
-- confiar nele ja produziu uma conclusao errada neste projeto.
SELECT
  to_regclass('public.cron_runs') IS NOT NULL                       AS tabela_existe,
  (SELECT relrowsecurity FROM pg_class
    WHERE oid = to_regclass('public.cron_runs'))                    AS rls_ligada,
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid = to_regclass('public.cron_runs')
      AND contype = 'c')                                            AS checks,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cron_runs')        AS policies,
  EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cron_runs'
      AND policyname = 'cron_runs_auditoria_leitura')               AS policy_de_leitura;

-- A policy de leitura e o que separa "o livro-razao esta vazio" de "eu nao
-- consigo ver o livro-razao". Sem ela, TUDO abaixo devolve zero linhas e
-- nenhum erro -- e a conclusao errada parece uma prova.
\echo ''
\echo 'Se policy_de_leitura vier f, PARE: as consultas abaixo mentem (zero linhas por RLS).'

\echo ''
\echo '=== 2. A ULTIMA EXECUCAO DE CADA JOB ==='

-- LEFT JOIN a partir da lista fixa de jobs: um job que nunca rodou precisa
-- aparecer como LINHA com nulos, nao sumir do resultado. Um GROUP BY sobre
-- cron_runs sozinho omitiria exatamente o caso que estamos procurando.
WITH jobs(job, horario_utc) AS (
  VALUES
    ('recurrence-scan',   '09:00'),
    ('recurrence-alerts', '09:30'),
    ('bill-alerts',       '11:00'),
    ('monthly-summary',   '12:00 (dia 1)')
),
ultima AS (
  SELECT DISTINCT ON (job) job, started_at, status, http_status, duration_ms, result, error
    FROM public.cron_runs
   ORDER BY job, started_at DESC
)
SELECT
  j.job,
  j.horario_utc,
  CASE
    WHEN u.job IS NULL THEN 'NUNCA REGISTROU'
    ELSE to_char(u.started_at AT TIME ZONE 'UTC', 'DD/MM HH24:MI') || ' UTC'
  END                                              AS ultima_execucao,
  u.status,
  u.http_status,
  u.duration_ms,
  u.result,
  u.error
FROM jobs j
LEFT JOIN ultima u ON u.job = j.job
ORDER BY j.horario_utc;

\echo ''
\echo '=== 3. AS ULTIMAS 24 HORAS, EXECUCAO POR EXECUCAO ==='
\echo '(no plano Hobby o disparo tem +-59min de folga, entao a ordem entre'
\echo ' 09:00 e 09:30 nao e garantida -- duas execucoes no mesmo dia sao'
\echo ' evento real, nao bug, e por isso nao ha indice unico na tabela)'

SELECT
  to_char(started_at AT TIME ZONE 'UTC', 'DD/MM HH24:MI:SS') AS inicio_utc,
  job,
  status,
  http_status,
  duration_ms,
  result,
  error
FROM public.cron_runs
WHERE started_at > now() - interval '24 hours'
ORDER BY started_at DESC;

\echo ''
\echo '=== 4. COMO LER ISTO ==='
\echo ''
\echo '  linha com status ok e contadores zerados'
\echo '     -> o cron RODOU e nao tinha trabalho. E o caso normal hoje:'
\echo '        detected_recurrences, bill_notifications e scheduled_transactions'
\echo '        estao fisicamente vazias (0 paginas), entao nenhum job tem o que'
\echo '        fazer. Isto e SUCESSO.'
\echo ''
\echo '  NUNCA REGISTROU, com a 019 aplicada ha mais de um ciclo'
\echo '     -> a Vercel nao chamou a rota. Confira Project > Cron Jobs.'
\echo ''
\echo '  status error'
\echo '     -> a rota foi chamada e quebrou. A coluna error tem a causa;'
\echo '        http_status separa "falha ao ler" (500) de outras.'
\echo ''
\echo '  ATENCAO: o caminho 503 (falta variavel de ambiente) NAO aparece aqui'
\echo '  e nao tem como aparecer -- gravar exige a service_role, que e uma das'
\echo '  variaveis que faltam nesse caso. Para esse, rode:'
\echo '     npm run verify:crons -- https://pulodogato-theta.vercel.app'
\echo ''
