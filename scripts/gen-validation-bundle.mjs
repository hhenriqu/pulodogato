#!/usr/bin/env node
// =====================================================
// PULODOGATO - GERADOR DO BUNDLE DE VALIDACAO (SQL Editor)
// =====================================================
// Gera database/validation/*.sql: a mesma validacao do
// scripts/db-validate-supabase.sh, so que em arquivos que o dono do projeto
// cola no SQL Editor do Supabase e devolve o resultado.
//
//   node scripts/gen-validation-bundle.mjs           # reescreve os arquivos
//   node scripts/gen-validation-bundle.mjs --check   # so confere se estao em dia (CI)
//
// POR QUE ESTE CAMINHO EXISTE, SE JA HA O db-validate-supabase.sh
// ---------------------------------------------------------------
// O script precisa da senha do Postgres do projeto descartavel. Em 2026-09-21
// essa senha custou duas idas e voltas e continuou sem bater -- o pooler acha
// o tenant e recusa a credencial. O SQL Editor nao usa senha nenhuma: o dono
// ja esta logado no painel. Entao este bundle troca "me passe uma credencial
// que eu nao consigo testar antes de voce mandar" por "cole dois arquivos e
// me devolva a tabela que sair". Mesmas assercoes, sem segredo no meio.
//
// O que o bundle NAO cobre, de proposito: o drill de restauracao de backup
// (passo 5/5 do script), que depende de ler um .gpg do disco. Esse continua
// exercitado a cada push pelo job db-verify.
//
// POR QUE E GERADO, E NAO ESCRITO A MAO
// -------------------------------------
// Um bundle copiado a mao vira uma segunda copia do schema -- exatamente o
// defeito que a HMO-117 existe para corrigir. Aqui os arquivos sao montados a
// partir de database/migrations/*.sql e database/tests/rls_isolation_test.sql,
// e o CI roda --check: se alguem mexer nas migrations sem regerar, o job fecha.
// =====================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = join(REPO, 'database/validation');

// A cadeia inteira, na ordem em que producao a recebeu. O 004 estava faltando
// aqui ate 2026-09-22: o bundle validava uma cadeia que nao era a de producao,
// e sairia verde mesmo assim.
const MIGRATIONS = [
  '001_baseline',
  '002_rls_lockdown',
  '003_fix_trigger_privileges',
  '004_fix_remaining_trigger_privileges',
  '005_recurring_and_scheduled',
  '006_budgets_and_card_invoices',
  '007_group_settlements',
  '008_goals_and_reports',
  '009_statements_alerts_receipts',
  '010_user_connections',
];
const TESTE_RLS = 'database/tests/rls_isolation_test.sql';
const TESTE_AGENDA = 'database/tests/scheduled_rls_test.sql';
const TESTE_ORCAMENTO = 'database/tests/budget_invoice_test.sql';
const TESTE_ACERTO = 'database/tests/group_settlement_test.sql';
const TESTE_METAS = 'database/tests/goals_reports_test.sql';
const TESTE_EXTRATO = 'database/tests/statements_alerts_test.sql';
const TESTE_CONEXOES = 'database/tests/user_connections_test.sql';

const ler = (rel) => readFileSync(join(REPO, rel), 'utf8');

// ---------------------------------------------------------------------------
// O SQL Editor nao e o psql
// ---------------------------------------------------------------------------
// Ele manda o texto inteiro para o servidor; meta-comando de psql (\set, \i,
// \echo) chega no parser como SQL e vira erro de sintaxe. As migrations hoje
// nao tem nenhum -- mas se um dia tiverem, o bundle sairia quebrado e so o
// Helio descobriria, colando. Melhor falhar aqui.
function semMetaComandos(sql, origem) {
  const linhas = sql.split('\n');
  const ruins = [];
  linhas.forEach((linha, i) => {
    if (/^\s*\\[a-zA-Z]/.test(linha)) ruins.push(`${origem}:${i + 1}: ${linha.trim()}`);
  });
  if (ruins.length) {
    console.error('ERRO: meta-comando de psql nao roda no SQL Editor do Supabase:');
    for (const r of ruins) console.error(`  ${r}`);
    console.error('\nTire o meta-comando do .sql ou ensine o gerador a traduzi-lo.');
    process.exit(1);
  }
  return sql;
}

const cabecalho = (titulo, corpo) => `-- =====================================================
-- PULODOGATO -- ${titulo}
-- =====================================================
-- GERADO por scripts/gen-validation-bundle.mjs. Nao edite este arquivo:
-- a fonte e database/migrations/*.sql e ${TESTE_RLS}.
--
${corpo.split('\n').map((l) => `-- ${l}`.trimEnd()).join('\n')}
-- =====================================================

`;

// ---------------------------------------------------------------------------
// Arquivo 1: guarda + migrations + relatorio
// ---------------------------------------------------------------------------
// A guarda roda ANTES de qualquer DDL, em bloco proprio, e aborta por excecao.
// Ela repete as checagens da SECAO 0 do db-validate-supabase.sh e existe pelo
// mesmo motivo: se o alvo nao for um Supabase de verdade, ou se public ja
// tiver tabela, o relatorio sairia verde para um teste que nao testou nada.
const GUARDA = `-- ---------------------------------------------------------------------------
-- 0. Guarda: o alvo e mesmo um Supabase descartavel e vazio?
-- ---------------------------------------------------------------------------
DO $guarda$
DECLARE
  faltando TEXT[] := '{}';
  ja_existe BIGINT;
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL THEN
    faltando := faltando || 'funcao auth.uid()'::TEXT;
  END IF;
  IF to_regclass('auth.users') IS NULL THEN
    faltando := faltando || 'tabela auth.users'::TEXT;
  END IF;
  IF (SELECT count(*) FROM pg_roles
       WHERE rolname IN ('anon', 'authenticated', 'service_role')) <> 3 THEN
    faltando := faltando || 'roles anon/authenticated/service_role'::TEXT;
  END IF;
  -- O 00_supabase_shim.sql do CI tambem cria auth.uid() e as roles. O que ele
  -- NAO tem e o auth.users do GoTrue (3 colunas contra ~30). Sem esta linha,
  -- um Postgres cru + shim passaria na guarda e a validacao viraria uma copia
  -- mais lenta do CI -- justamente o item que ela existe para fechar.
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'auth' AND table_name = 'users'
         AND column_name IN ('encrypted_password', 'raw_app_meta_data')) <> 2 THEN
    faltando := faltando || 'auth.users do GoTrue (o alvo parece um Postgres cru)'::TEXT;
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname = 'supabase_auth_admin') <> 1 THEN
    faltando := faltando || 'role supabase_auth_admin'::TEXT;
  END IF;

  IF array_length(faltando, 1) IS NOT NULL THEN
    RAISE EXCEPTION E'O alvo nao parece um projeto Supabase. Faltou: %\\n\\nRode este arquivo no SQL Editor do projeto Supabase descartavel.',
      array_to_string(faltando, ', ');
  END IF;

  SELECT count(*) INTO ja_existe
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r';
  IF ja_existe > 0 THEN
    RAISE EXCEPTION E'O schema public ja tem % tabela(s); a validacao precisa comecar do zero.\\n\\nSe este e mesmo o projeto DESCARTAVEL (nunca o de producao), limpe com:\\n  DROP SCHEMA public CASCADE; CREATE SCHEMA public;\\ne rode este arquivo de novo.',
      ja_existe;
  END IF;
END
$guarda$;
`;

// As mesmas assercoes da SECAO 2 do db-validate-supabase.sh, numa consulta so.
// Uma consulta so porque o SQL Editor mostra apenas o resultado da ULTIMA
// instrucao: qualquer verificacao que ficasse de fora dela seria invisivel.
// A linha VEREDITO fecha o relatorio para nao depender de leitura linha a linha.
const RELATORIO = `-- ---------------------------------------------------------------------------
-- 4. Relatorio -- ESTA e a tabela para copiar de volta na issue
-- ---------------------------------------------------------------------------
WITH sem_rls AS (
  SELECT coalesce(string_agg(c.relname, ', ' ORDER BY c.relname), '') AS v
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
), anon_extra AS (
  -- A chave anon vai embutida no bundle JS publico: privilegio dela alem das
  -- duas tabelas de referencia e dado aberto na internet.
  SELECT coalesce(string_agg(DISTINCT table_name, ', '), '') AS v
    FROM information_schema.role_table_grants
   WHERE grantee = 'anon' AND table_schema = 'public'
     AND table_name NOT IN ('financial_services', 'transaction_categories')
), sem_definer AS (
  SELECT coalesce(string_agg(p.proname, ', ' ORDER BY p.proname), '') AS v
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND NOT p.prosecdef
     AND p.proname IN ('create_free_subscription', 'update_user_balances',
                       'update_usage_limits_on_plan_change')
), contagem AS (
  SELECT
    (SELECT count(*) FROM public.financial_services)      AS servicos,
    (SELECT count(*) FROM public.transaction_categories)  AS categorias,
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r')     AS tabelas,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policies,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public')                         AS funcoes,
    (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal) AS triggers
), linhas AS (
  SELECT r.*
    FROM sem_rls, anon_extra, sem_definer, contagem,
    LATERAL (VALUES
      (1, 'todas as tabelas de public com RLS ligada',
          CASE WHEN sem_rls.v = '' THEN 'OK' ELSE 'FALHA' END,
          coalesce(nullif(sem_rls.v, ''), 'nenhuma tabela sem RLS')),
      (2, 'anon limitada as 2 tabelas de referencia',
          CASE WHEN anon_extra.v = '' THEN 'OK' ELSE 'FALHA' END,
          coalesce(nullif(anon_extra.v, ''), 'nenhum privilegio sobrando')),
      (3, 'seed financial_services = 3',
          CASE WHEN contagem.servicos = 3 THEN 'OK' ELSE 'FALHA' END,
          contagem.servicos::text),
      (4, 'seed transaction_categories = 12',
          CASE WHEN contagem.categorias = 12 THEN 'OK' ELSE 'FALHA' END,
          contagem.categorias::text),
      (5, 'as 3 funcoes de trigger com SECURITY DEFINER (003)',
          CASE WHEN sem_definer.v = '' THEN 'OK' ELSE 'FALHA' END,
          coalesce(nullif(sem_definer.v, ''), 'as 3 estao SECURITY DEFINER')),
      (6, 'inventario do que subiu', 'INFO',
          contagem.tabelas || ' tabelas, ' || contagem.policies || ' policies, ' ||
          contagem.funcoes || ' funcoes, ' || contagem.triggers || ' triggers')
    ) AS r(ord, verificacao, status, detalhe)
)
SELECT ord AS "#", verificacao, status, detalhe FROM linhas
UNION ALL
SELECT 9, 'VEREDITO (migrations)',
       CASE WHEN count(*) FILTER (WHERE status = 'FALHA') = 0 THEN 'TUDO OK' ELSE 'FALHOU' END,
       count(*) FILTER (WHERE status = 'FALHA')::text || ' falha(s) em ' ||
       count(*) FILTER (WHERE status <> 'INFO')::text || ' verificacoes'
  FROM linhas
ORDER BY 1;
`;

const partes = [
  cabecalho(
    'VALIDACAO PASSO 1: schema do zero',
    `Cole este arquivo inteiro no SQL Editor do projeto Supabase DESCARTAVEL e
rode. Ele aplica 001 -> 002 -> 003 -> 004 -> 005 -> 006 -> 007 -> 008 -> 009 num banco vazio e termina imprimindo uma
tabela de verificacoes.

O QUE FAZER COM O RESULTADO: copie a tabela final (ou tire um print) e cole na
issue HMO-117. Se aparecer erro em vermelho, cole o texto do erro -- e ele que
diz qual migration nao sobe num Supabase de verdade.

NUNCA rode isto no projeto de producao (odxqjvtxsioksguuevqm): as migrations
criam objetos. A guarda abaixo recusa qualquer banco que ja tenha tabelas em
public, o que ja barra producao.

Depois deste, rode o 02_isolamento_rls.sql.`
  ),
  GUARDA,
];

MIGRATIONS.forEach((nome, i) => {
  const sql = semMetaComandos(ler(`database/migrations/${nome}.sql`), `${nome}.sql`);
  partes.push(`
-- ---------------------------------------------------------------------------
-- ${i + 1}. ${nome}.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
${sql.trimEnd()}
`);
});

partes.push('\n' + RELATORIO);

// ---------------------------------------------------------------------------
// Arquivo 2: isolamento de RLS
// ---------------------------------------------------------------------------
// O teste inteiro roda dentro de BEGIN/ROLLBACK e nao deixa rastro. Ele reporta
// por excecao: qualquer assercao que falhe aborta o lote. O detalhe que importa
// aqui e o SELECT depois do ROLLBACK -- o SQL Editor so mostra o resultado da
// ultima instrucao, e o ROLLBACK nao devolve linha nenhuma. Sem ele, "passou"
// apareceria como uma tela vazia, indistinguivel de "nao rodou". Como o SELECT
// vem DEPOIS do ROLLBACK, ele so e alcancado se nada tiver abortado antes.
function prepararTeste(sql, origem, veredito) {
  // O \set ON_ERROR_STOP e do psql; no SQL Editor o lote ja aborta sozinho no
  // primeiro erro, entao a linha some sem mudar o comportamento.
  const semSet = sql.replace(/^\s*\\set\s+ON_ERROR_STOP\s+on\s*$/m, '');
  if (!/^\s*ROLLBACK\s*;\s*$/m.test(semSet)) {
    console.error(`ERRO: ${origem} nao termina em ROLLBACK;`);
    console.error('      O bundle depende disso para nao deixar fixture no banco.');
    process.exit(1);
  }
  return semSet.trimEnd() + `

-- Se esta linha aparecer, nenhuma assercao acima abortou o lote: o teste passou.
-- Ela roda DEPOIS do ROLLBACK, ou seja, fora da transacao que foi desfeita.
SELECT '${veredito}' AS resultado;
`;
}

// A checagem de meta-comando roda no arquivo ja preparado: o unico \set
// conhecido e tratado acima, e qualquer outro tem que estourar.
const testeRls = semMetaComandos(
  prepararTeste(
    ler(TESTE_RLS),
    TESTE_RLS,
    'ISOLAMENTO DE RLS: TUDO OK -- nenhuma assercao falhou, e os fixtures foram desfeitos pelo ROLLBACK',
  ),
  'rls_isolation_test.sql (preparado)',
);

const testeAgenda = semMetaComandos(
  prepararTeste(
    ler(TESTE_AGENDA),
    TESTE_AGENDA,
    'CONTAS PREVISTAS: TUDO OK -- isolamento, view e invariantes de dinheiro conferidos',
  ),
  'scheduled_rls_test.sql (preparado)',
);

const testeOrcamento = semMetaComandos(
  prepararTeste(
    ler(TESTE_ORCAMENTO),
    TESTE_ORCAMENTO,
    'ORCAMENTO E FATURA: TUDO OK -- consumo, isolamento, views e aritmetica de fatura conferidos',
  ),
  'budget_invoice_test.sql (preparado)',
);

const testeAcerto = semMetaComandos(
  prepararTeste(
    ler(TESTE_ACERTO),
    TESTE_ACERTO,
    'ACERTO DE CONTAS: TUDO OK -- sinal do acerto, rateio em centavos, isolamento e o trigger de saldo conferidos',
  ),
  'group_settlement_test.sql (preparado)',
);

const testeMetas = semMetaComandos(
  prepararTeste(
    ler(TESTE_METAS),
    TESTE_METAS,
    'METAS E RELATORIOS: TUDO OK -- progresso, sinal do gasto, previsto x realizado e patrimonio conferidos',
  ),
  'goals_reports_test.sql (preparado)',
);

const testeExtrato = semMetaComandos(
  prepararTeste(
    ler(TESTE_EXTRATO),
    TESTE_EXTRATO,
    'EXTRATO, AVISOS E COMPROVANTES: TUDO OK -- deduplicacao, sinal, janela de aviso e isolamento conferidos',
  ),
  'statements_alerts_test.sql (preparado)',
);

const testeConexoes = semMetaComandos(
  prepararTeste(
    ler(TESTE_CONEXOES),
    TESTE_CONEXOES,
    'CONEXOES: TUDO OK -- consentimento, par unico nos dois sentidos, bloqueio duravel e isolamento conferidos',
  ),
  'user_connections_test.sql (preparado)',
);

const arquivos = {
  '01_migrations.sql': partes.join('\n'),
  '02_isolamento_rls.sql':
    cabecalho(
      'VALIDACAO PASSO 2: um usuario le os dados do outro?',
      `Rode DEPOIS do 01_migrations.sql, no mesmo projeto descartavel.

Cria dois usuarios de mentira, poe dados em cada um e tenta ler os dados de A
com a identidade de B (o mesmo claim que auth.uid() le). Tudo dentro de uma
transacao que termina em ROLLBACK: nao fica nada no banco.

O QUE ESPERAR: uma unica linha "ISOLAMENTO DE RLS: TUDO OK". Se em vez dela vier
erro em vermelho, copie o texto na issue -- a mensagem ja diz qual assercao
falhou e o que era esperado.`
    ) + testeRls,
  '03_contas_previstas.sql':
    cabecalho(
      'VALIDACAO PASSO 3: contas previstas e gastos fixos (005)',
      `Rode DEPOIS do 01_migrations.sql, no mesmo projeto descartavel.

Confere o que o 005 sozinho nao prova: que um usuario nao ve a agenda de contas
do outro, que a view scheduled_transactions_effective respeita a RLS da tabela
base (view comum rodaria com o privilegio do dono e devolveria a agenda inteira)
e que o banco recusa conta marcada como paga sem transacao e ocorrencia
duplicada da mesma regra. Tudo dentro de BEGIN/ROLLBACK.

O QUE ESPERAR: uma unica linha "CONTAS PREVISTAS: TUDO OK".`
    ) + testeAgenda,
  '04_orcamento_fatura.sql':
    cabecalho(
      'VALIDACAO PASSO 4: orcamento e fatura de cartao (006)',
      `Rode DEPOIS do 01_migrations.sql, no mesmo projeto descartavel.

Confere o que o 006 sozinho nao prova: que o consumo do teto soma as transacoes
certas -- e so elas (despesa e gravada NEGATIVA neste banco, entao um SUM cru
daria consumo negativo e o alerta de estouro nunca dispararia), que o teto
pessoal e o do grupo nao se confundem, que budget_consumption e
card_invoice_lines respeitam a RLS das tabelas base, e que a aritmetica da
fatura acerta fechamento dia 31 em fevereiro e a virada de ano. Tudo dentro de
BEGIN/ROLLBACK.

O QUE ESPERAR: uma unica linha "ORCAMENTO E FATURA: TUDO OK".`
    ) + testeOrcamento,
  '05_acerto_grupo.sql':
    cabecalho(
      'VALIDACAO PASSO 5: acerto de contas do grupo (007)',
      `Rode DEPOIS do 01_migrations.sql, no mesmo projeto descartavel.

Confere o que o 007 sozinho nao prova. A assercao central e o SINAL do acerto:
registrar um pagamento tem que APROXIMAR o saldo de zero. O erro simetrico
dobra a divida a cada pagamento registrado, e a tela passaria a sugerir uma
transferencia MAIOR depois de cada Pix -- sem erro nenhum aparecer.

Confere tambem que o rateio soma exatamente o valor da despesa (dividir R$ 100
por tres perdia um centavo, e era esse centavo que impedia o grupo de fechar),
que a divisao personalizada nao e achatada para partes iguais, que os dois
membros do mesmo grupo leem o MESMO saldo, que quem nao e parte no pagamento
nao consegue registra-lo, e que editar um lancamento nao desconta o valor duas
vezes do saldo da conta. Tudo dentro de BEGIN/ROLLBACK.

O QUE ESPERAR: uma unica linha "ACERTO DE CONTAS: TUDO OK".`
    ) + testeAcerto,
  '06_metas_relatorios.sql':
    cabecalho(
      'VALIDACAO PASSO 6: metas e relatorios (008)',
      `Rode DEPOIS do 01_migrations.sql, no mesmo projeto descartavel.

Confere o que o 008 sozinho nao prova. A assercao central e de novo o SINAL:
despesa e gravada NEGATIVA neste banco, e um SUM cru nas views de relatorio
devolveria gasto negativo -- a tela desenharia a barra para baixo e diria
"voce economizou" onde houve gasto. Mesma familia do erro que quase passou no
006.

Confere tambem que o progresso da meta sai dos APORTES e nao do saldo da conta
(o saldo derivou ate o 007 entrar), que a meta sem prazo nao inventa um ritmo
mensal, que transferencia entre contas proprias nao vira receita nem despesa no
fluxo de caixa mas CONTA no patrimonio, que o previsto x realizado casa o mes
pessoal (onde group_id e NULL dos dois lados, e NULL = NULL nao casa), que o
patrimonio reconstruido de tras para frente fecha com o saldo de hoje, e que um
usuario nao enxerga a renda, o gasto nem o patrimonio de outro. Tudo dentro de
BEGIN/ROLLBACK.

O QUE ESPERAR: uma unica linha "METAS E RELATORIOS: TUDO OK".`
    ) + testeMetas,
  '07_extrato_avisos.sql':
    cabecalho(
      'VALIDACAO PASSO 7: extrato, avisos de vencimento e comprovantes (009)',
      `Rode DEPOIS do 01_migrations.sql, no mesmo projeto descartavel.

Confere o que o 009 sozinho nao prova. A assercao central e a DEDUPLICACAO do
extrato: ela e por CONTA, e o teste prova as duas metades -- reimportar o mesmo
arquivo nao duplica nada, e a mesma linha em outra conta entra normalmente. Sem
a primeira metade, cada reimportacao dobraria o mes; sem a segunda, o extrato da
poupanca perderia lancamentos que existiram de verdade.

Confere tambem que o SINAL do extrato sobrevive (debito importado continua
NEGATIVO, e portanto continua sendo despesa nas views do 008), que uma linha nao
consegue ficar marcada como importada sem lancamento -- invisivel para sempre
sem nunca ter virado dinheiro --, que apagar o lancamento DEVOLVE a linha para
pendente, que quem nunca abriu a tela de preferencias recebe aviso assim mesmo
(o default de 3 dias sai de um COALESCE; um INNER JOIN zeraria a view e o cron
nao avisaria ninguem, sem erro nenhum), que o mesmo aviso nao sai duas vezes mas
adiar a conta merece um aviso novo, e que um usuario nao enxerga o extrato, o
vencimento nem o comprovante de outro. Tudo dentro de BEGIN/ROLLBACK.

O QUE ESPERAR: uma unica linha "EXTRATO, AVISOS E COMPROVANTES: TUDO OK".

A secao 11 do 009 (bucket de comprovantes) SO roda num Supabase de verdade --
num Postgres cru ela se pula sozinha com um NOTICE. Neste bundle, que roda num
Supabase descartavel, ela roda.`
    ) + testeExtrato,
  '08_conexoes.sql':
    cabecalho(
      'VALIDACAO PASSO 8: conexoes entre usuarios (010)',
      `Rode DEPOIS do 01_migrations.sql, no mesmo projeto descartavel.

Confere o que o 010 sozinho nao prova. A assercao central e o CONSENTIMENTO:
quem pede uma conexao nao pode aceita-la sozinho -- nem por UPDATE, nem gravando
a linha ja como 'accepted' de saida. Conexao aceita e o que habilita puxar
alguem para o rateio de uma despesa, entao uma conexao que nasce aceita e uma
pessoa entrando na vida financeira de outra sem ter clicado em nada.

Confere tambem que o par e unico NOS DOIS SENTIDOS (senao A->B e B->A viram dois
pedidos pendentes, e aceitar um deixa o outro pendente para sempre), que o
bloqueio dura -- quem foi recusado nao apaga a propria linha de bloqueio para
pedir de novo --, que um terceiro nao enxerga nem apaga a conexao alheia, que
uma conexao ja respondida nao volta para pendente, que os NOMES das duas
foreign keys existem (a PostgREST resolve o embed do perfil pelo nome da
constraint; com nome diferente a tabela existe e a tela continua quebrada), e
que anon nao tem privilegio nenhum. Tudo dentro de BEGIN/ROLLBACK.

O teste tem DOIS CONTROLES NEGATIVOS no fim: ele reintroduz as duas regras
quebradas e exige que o defeito volte a acontecer. Se eles nao dispararem, o
arquivo nao esta medindo o que diz medir.

O QUE ESPERAR: uma unica linha "CONEXOES: TUDO OK".`
    ) + testeConexoes,
};

// ---------------------------------------------------------------------------
// Escrita / --check
// ---------------------------------------------------------------------------
const conferir = process.argv.includes('--check');
mkdirSync(DESTINO, { recursive: true });

let desatualizados = 0;
for (const [nome, conteudo] of Object.entries(arquivos)) {
  const caminho = join(DESTINO, nome);
  if (conferir) {
    let atual = null;
    try {
      atual = readFileSync(caminho, 'utf8');
    } catch {
      /* nao existe */
    }
    if (atual !== conteudo) {
      console.error(`DESATUALIZADO: database/validation/${nome}`);
      desatualizados++;
    }
    continue;
  }
  writeFileSync(caminho, conteudo);
  console.log(`escrito: database/validation/${nome} (${conteudo.split('\n').length} linhas)`);
}

if (conferir) {
  if (desatualizados) {
    console.error(`\n${desatualizados} arquivo(s) fora de sincronia com database/migrations/.`);
    console.error('Rode: node scripts/gen-validation-bundle.mjs');
    process.exit(1);
  }
  console.log('bundle de validacao em dia com as migrations.');
}
