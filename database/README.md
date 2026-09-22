# Banco de dados

Projeto Supabase: `odxqjvtxsioksguuevqm`.

```
database/
├── migrations/
│   ├── 000_preflight_inventory.sql  inventario somente leitura, roda antes
│   ├── 001_baseline.sql             schema + seed de referencia  (GERADO)
│   ├── 002_rls_lockdown.sql         RLS, privilegios e RPCs  (OBRIGATORIO)
│   ├── 003_fix_trigger_privileges.sql  SECURITY DEFINER nos triggers
│   ├── 004_fix_remaining_trigger_privileges.sql  os triggers que sobraram
│   ├── 005_recurring_and_scheduled.sql  gastos fixos + contas previstas
│   └── 006_budgets_and_card_invoices.sql  orcamento por categoria + fatura de cartao
├── seed/
│   └── reference_data.sql           financial_services + transaction_categories
├── tests/
│   ├── 00_supabase_shim.sql             auth.uid() e roles, so para Postgres cru
│   ├── rls_isolation_test.sql           prova que um usuario nao le dados de outro
│   ├── scheduled_rls_test.sql           agenda de contas: isolamento e invariantes
│   ├── legacy_policy_drift_test.sql     policy antiga de producao tem que sumir
│   └── legacy_function_drift_test.sql   funcao antiga de producao tem que sumir
└── README.md
```

Ordem: `001`, `002`, `003`, `004`, `005`, `006`. Rodar `001` sozinho deixa o banco aberto.

Os `005` e `006` sao **re-executaveis de proposito** (`CREATE TABLE IF NOT EXISTS`, ENUM em
bloco `DO`, `DROP POLICY IF EXISTS`): depois que ele entrar em producao, o `001`
regenerado ja vai trazer as tabelas dele, e a cadeia precisa continuar subindo
do zero mesmo assim.

`001_baseline.sql` **nao se edita a mao** — e gerado por
`node scripts/gen-baseline.mjs` a partir de um `pg_dump --schema-only` de
producao. Para mudar o schema, crie uma migration nova (`004_...`), aplique, e
regenere o baseline. O seed vive em `seed/reference_data.sql` porque o
`pg_dump` roda como `paperclip_ro`, que esta sujeita a RLS e enxerga as duas
tabelas de referencia vazias.

### Validado num banco limpo

```bash
# so em Postgres cru (CI, docker). Num projeto Supabase o shim se recusa a rodar.
psql "$DB_URL" -v ON_ERROR_STOP=1 -f database/tests/00_supabase_shim.sql

psql "$DB_URL" -v ON_ERROR_STOP=1 -f database/migrations/001_baseline.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f database/migrations/002_rls_lockdown.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f database/migrations/003_fix_trigger_privileges.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f database/migrations/004_fix_remaining_trigger_privileges.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f database/migrations/005_recurring_and_scheduled.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f database/migrations/006_budgets_and_card_invoices.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f database/tests/rls_isolation_test.sql  # da ROLLBACK no fim
psql "$DB_URL" -v ON_ERROR_STOP=1 -f database/tests/scheduled_rls_test.sql  # idem
```

Executado do zero num Postgres 17 vazio: 18 tabelas, 18 com RLS, 40 policies, as
21 asserções de isolamento passando e a role `anon` sem privilegio fora das duas
tabelas de referencia. O mesmo roda no CI (`.github/workflows/db-verify.yml`) a
cada PR que toca `database/`.

### Validado num projeto Supabase limpo

> **Executado em 2026-09-21**, no projeto descartavel `vccfpqazgtwtymmrphxd`
> (PostgreSQL 17.6, pelo Session Pooler). Resultado: **8 verificacoes, todas
> OK** — `001` → `002` → `003` sobem num `public` vazio, as 21 assercoes de
> isolamento de RLS passam, o seed carrega (3 + 12) e o inventario fecha em
> 18 tabelas, 40 policies, 28 funcoes e 21 triggers. O drill de desastre
> (`pg_dump` pelo pooler → `DROP SCHEMA` → restauracao) rodou em seguida com
> dado sintetico: R$ 1.234,56 atravessou o ciclo e o saldo derivado ficou em
> R$ 1.234,56, sem dobrar. Foi essa execucao que achou o defeito da
> restauracao por cima de contas existentes, corrigido abaixo.

O bloco acima roda num Postgres cru mais o `00_supabase_shim.sql` — e o shim e
uma imitacao. Ele nao traz as extensoes do schema `extensions`, o `auth.users`
do GoTrue, as roles de servico, nem o fato de que pelo pooler voce conecta como
`postgres.<ref>`, que **nao** e superusuario. Um backup que restaura no CI e
falha num Supabase de verdade continua sendo um backup que nao restaura.

```bash
# URI do Session Pooler de um projeto DESCARTAVEL (Connect -> Session pooler)
export VALIDATION_DB_URL='postgresql://postgres.<ref>:<senha>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres'
./scripts/db-validate-supabase.sh

# para exercitar tambem o ciclo de desastre (apaga o public do alvo):
BACKUP_DIR=./backups BACKUP_PASSPHRASE=... ./scripts/db-validate-supabase.sh
```

O script recusa rodar contra producao, recusa um `public` que ja tenha tabelas
(sem `RESET_PUBLIC=sim`) e — o mais importante — **recusa um alvo que nao seja
Supabase de verdade**, inclusive um Postgres com o shim aplicado. Sem essa
ultima recusa o relatorio sairia "VALIDACAO OK" para exatamente o item que o
script existe para fechar.

As verificacoes independentes rodam todas e o relatorio sai junto no fim, em vez
de parar na primeira: so o dono do projeto consegue criar o ambiente e passar a
credencial, entao uma ida e volta por defeito custaria um dia cada.

### O mesmo, sem precisar de credencial: `database/validation/`

O script acima depende da senha do Postgres do projeto descartavel — e quem tem
o painel nao e quem roda o script, entao cada senha errada custa uma ida e
volta inteira (na HMO-117 custou duas, sem nunca conectar). O SQL Editor do
Supabase nao pede senha: quem esta no painel ja esta autenticado.

Por isso as mesmas assercoes existem tambem como dois arquivos para colar la:

| Arquivo | O que faz | O que voce devolve |
|---|---|---|
| `database/validation/01_migrations.sql` | guarda + `001` → `002` → `003` → `004` → `005` → `006` + relatorio | a tabela final (7 linhas, termina em `VEREDITO`) |
| `database/validation/02_isolamento_rls.sql` | o teste de isolamento, dentro de `ROLLBACK` | a linha `ISOLAMENTO DE RLS: TUDO OK`, ou o erro |
| `database/validation/03_contas_previstas.sql` | a agenda do `005`: isolamento, view e invariantes de dinheiro | a linha `CONTAS PREVISTAS: TUDO OK`, ou o erro |
| `database/validation/04_orcamento_fatura.sql` | o `006`: consumo do teto, sinal do valor, isolamento das duas views e aritmetica da fatura | a linha `ORCAMENTO E FATURA: TUDO OK`, ou o erro |

Os dois sao **gerados** por `node scripts/gen-validation-bundle.mjs` a partir de
`migrations/` e `tests/rls_isolation_test.sql` — nunca editados a mao. Uma copia
do schema que sai de sincronia e pior do que nao ter copia: validaria um schema
que nao e mais o nosso, e o relatorio sairia verde. O job `db-verify` roda
`--check` e fecha se alguem mexer nas migrations sem regerar.

A guarda do `01` e a mesma do script: recusa um `public` que ja tenha tabelas e
recusa um alvo que nao seja Supabase de verdade (a checagem que separa o
`auth.users` do GoTrue, ~30 colunas, do shim do CI, 3 colunas).

O que o bundle **nao** cobre: o drill de restauracao de backup, que precisa ler
um `.gpg` do disco. Esse continua rodando a cada push no `db-verify`.

### Prova de que o baseline reproduz producao

O `001` + `002` foram aplicados num Postgres 17 vazio, o resultado foi extraido
com `pg_dump` e comparado com o dump de producao. **A diferenca e de tres
linhas, todas de forma e nenhuma de conteudo:**

- `schema_migrations_status_check` — o Postgres re-imprime o mesmo `CHECK` com
  o cast do array por fora em vez de por elemento.
- as duas policies de tabela de referencia listam `anon, authenticated` em vez
  de `authenticated, anon` (o `pg_dump` ordena por OID da role, e os OIDs
  diferem entre um banco e outro).

Para refazer a conferencia:

```bash
pg_dump "$SUPABASE_DB_URL_RO" --schema-only --schema=public \
  --no-owner --no-privileges > /tmp/prod.sql
pg_dump "$DB_URL" --schema-only --schema=public \
  --no-owner --no-privileges > /tmp/local.sql

norm(){ sed -E 's/[[:space:]]+$//' "$1" \
  | grep -vE '^(--|\\(un)?restrict|SET |SELECT pg_catalog\.set_config)' \
  | grep -vE '^$'; }
diff <(norm /tmp/prod.sql) <(norm /tmp/local.sql)
```

O teste depende de `auth.users`, `auth.uid()` e das roles `anon`/`authenticated`,
que num projeto Supabase ja existem; `00_supabase_shim.sql` recria esse minimo
num Postgres cru — e aborta se detectar que o banco e um Supabase de verdade,
onde sobrescrever `auth.uid()` quebraria a autenticacao inteira.

Ressalva que continua de pe: validado em Postgres puro, **nao** num projeto
Supabase limpo de verdade. Extensoes, roles extras e o GoTrue nao foram
exercitados.

### Deriva de producao

Banco limpo nao e producao. Producao tem objeto que nunca passou por este
repositorio, e cada variedade ja quebrou a aplicacao uma vez:

```bash
# policy criada pelo painel do Supabase, com outro nome (USING (true) vaza
# dados entre usuarios logados e a auditoria anonima passa verde)
psql "$DB_URL" -f database/tests/legacy_policy_drift_test.sql

# funcao auxiliar de outra safra, com assinatura diferente: o CREATE OR REPLACE
# nao a substitui e as policies param com 42725 "function is not unique"
psql "$DB_URL" -f database/tests/legacy_function_drift_test.sql
```

Os dois plantam a deriva num banco que tem so o `001` e exigem que o `002` a
elimine — por isso rodam **sem** o `002` aplicado antes. A SECAO 0 do `002` e
quem faz essa limpeza, e nela a ordem e obrigatoria: policies primeiro, funcoes
depois (policy que usa a funcao antiga e dependencia e travaria o DROP).

---

## Estado atual: o que esta resolvido e o que nao esta

Antes deste diretorio, a unica copia do schema era o proprio banco de producao.
O unico SQL versionado (`docs/database-setup.sql`) descrevia **outro produto**
(portfolios/ativos/dividendos) e foi removido — esta no historico do git, em
`cf4b210`, se alguem precisar.

**Resolvido:** existe um schema executavel do zero, com o seed junto, uma
auditoria de RLS repetivel, e — desde 2026-09-21 — o baseline e extraido com
`pg_dump` do banco de producao, nao mais reconstruido pela API.

### A lacuna da reconstrucao pela API, e o que ela escondia

Ate 2026-09-21 nao havia credencial de Postgres, e o baseline tinha sido
reconstruido pela API PostgREST. A API devolve linhas, nao catalogo: ela mostra
que uma coluna existe, mas nao o tipo, nem `NOT NULL`, nem `DEFAULT`, e nao
enxerga indice, trigger, funcao nem view. O que estava faltando:

| | reconstruido pela API | real (`pg_dump`) |
|---|---|---|
| tabelas | 16 | **18** |
| funcoes | 0 | **23** (+5 no `002`) |
| triggers | 0 | **13** |
| views | 0 | **1** |
| indices | poucos, inferidos | **57** |

Alem disso, o ENUM `account_type` estava sem `debit_card` e `other` (os valores
foram deduzidos dos dados em uso, e nenhuma conta usava esses dois), e varias
colunas `NOT NULL` de producao apareciam como nulaveis — entre elas
`financial_transactions.service_id` e `.category_id`,
`group_invitations.invite_method` e `.invite_target`, e
`group_transactions.split_type`.

Isso e mais perigoso do que parece: um restore a partir do baseline antigo
aceitaria linhas que producao rejeita, e o erro so apareceria na volta para
producao. Os fixtures dos testes foram corrigidos junto — eles tinham sido
escritos contra o schema frouxo e passavam por isso.

A RPC `get_user_by_email`, que o codigo chama e que faltava por inteiro, agora
esta no baseline.

### O que continua em aberto

- **O backup criptografado** (`.gpg`) so foi exercitado no CI: o ambiente do
  agente nao tem `gpg`, entao o drill contra o Supabase de verdade rodou com os
  dumps em claro. O caminho do `gpg` em si e coberto a cada push pelo
  `db-verify`, que exige o `.gz.gpg` e restaura a partir dele.
- **Os valores do seed** nao sao reconferidos a cada geracao: `paperclip_ro` e
  uma role comum, sujeita a RLS, e as policies das duas tabelas de referencia
  sao `TO anon, authenticated` — para ela as duas voltam vazias. A lista de
  colunas de cada `INSERT` foi conferida contra o catalogo em 2026-09-21; os
  valores vem da extracao de 2026-09-18 pela API. Ver HMO-127.

---

## RLS

`002_rls_lockdown.sql` existe por causa de uma auditoria de **2026-09-18** que
encontrou o banco de producao aberto: usando so a chave `anon` — a mesma que vai
embutida no bundle JS publico — e **sem autenticar**, era possivel ler
`profiles`, `financial_accounts`, `financial_transactions`, `expense_groups`,
`group_members`, `group_transactions` e `group_expense_splits` por inteiro.
Escrita tambem passava: um INSERT anonimo em `profiles` retornou `23505`
(chave duplicada) em vez de `42501` (violacao de RLS).

Auditar a qualquer momento:

```bash
node scripts/extract-schema.mjs --audit   # sai != 0 se achar vazamento
```

O teste prova **vazamento**, nao prova protecao: uma tabela vazia passa mesmo
sem RLS. A prova de protecao e a query de `pg_class` no fim de
`002_rls_lockdown.sql`, que lista tabelas com RLS desligada.

### Entrar em grupo por codigo: `join_group_by_code()`

Com RLS ligada, o fluxo antigo de entrar por codigo **nao funciona mais**: quem
ainda nao e membro nao enxerga o grupo, entao o `SELECT ... WHERE group_code = ?`
volta vazio. E liberar o INSERT direto em `group_members` na policy criaria um
buraco — bastaria descobrir o UUID de um grupo para virar membro e passar a ler
as transacoes dele.

Por isso `002` cria a RPC `public.join_group_by_code(p_group_code TEXT)`
(SECURITY DEFINER): ela valida o codigo e insere a associacao na mesma
transacao, mantendo a regra que ja existia (grupo publico entra como `active`,
privado como `pending`). `app/api/expense-groups/join/route.ts` ja foi migrado
para chamar a RPC.

A policy de INSERT em `group_members` agora exige convite pendente valido ou ser
admin do grupo.

### Antes de aplicar o 002 em producao

As policies nao foram lidas do banco, foram deduzidas. Aplicar direto pode
quebrar telas do app. Sequencia segura:

1. criar um projeto Supabase novo
2. rodar `001` e depois `002`
3. criar duas contas e exercitar: transacao pessoal, grupo, convite, divisao
4. confirmar que a conta B nao ve nada da conta A
5. so entao aplicar em producao

---

## Backup

**Nao ha backup automatico deste repositorio.** Decisao do Helio em 18/09/2026
(HMO-121): o PITR do Supabase fica desligado e o dump diario em CI foi removido,
para nao exigir os secrets de producao. O que existe hoje e so o backup diario do
plano Free do Supabase — retencao curta, e nao e testado por ninguem.

O que **sobrou** no repositorio, e continua funcionando:

| | |
|---|---|
| `scripts/db-backup.sh` | dump de schema + dados + `auth.users` + inventario de RLS, criptografado — roda na mao |
| `scripts/db-restore.sh` | restaura num banco vazio, na ordem certa; recusa apontar para producao |
| `.github/workflows/db-verify.yml` | a cada PR: sobe o schema do zero, roda o teste de RLS e faz o drill de backup→restauracao num Postgres descartavel |

O drill do `db-verify` roda contra um Postgres do proprio runner, sem secret
nenhum: ele prova que os dois scripts continuam funcionando, nao que exista
copia de producao em algum lugar. Sao coisas diferentes.

### Se um dia quiser ligar de novo

Sao duas coisas independentes:

1. **PITR** (perda de segundos, dentro do Supabase): Settings → Database →
   Point in Time Recovery. Exige plano pago.
2. **Dump diario em CI** (copia fora do fornecedor): recriar um workflow que
   chame `scripts/db-backup.sh` e por dois secrets em Settings → Secrets and
   variables → Actions:

| Secret | De onde vem |
|---|---|
| `SUPABASE_DB_URL` | Supabase → Settings → Database → Connection string → **Session pooler** |
| `BACKUP_PASSPHRASE` | frase forte, guardada no gerenciador de senhas |

Use o **Session Pooler (porta 5432)**. O Transaction Pooler (6543) nao aguenta
`pg_dump`, e a conexao direta `db.<ref>.supabase.co` e IPv6 — runner do GitHub
nao tem IPv6.

### Na mao

```bash
export SUPABASE_DB_URL='postgresql://postgres.<ref>:<senha>@aws-0-<regiao>.pooler.supabase.com:5432/postgres'
export BACKUP_PASSPHRASE='...'
./scripts/db-backup.sh ./backups

# restaurar num banco de teste (NUNCA em producao)
export RESTORE_DB_URL='postgresql://...'
./scripts/db-restore.sh ./backups
```

Os arquivos gerados estao no `.gitignore`: contem PII, saldos e as senhas
hasheadas de `auth.users`. Nao versionar, nao anexar em issue.

### O que o backup cobre e o que nao cobre

Cobre `public` (estrutura, dados e privilegios) e `auth.users` — sem esta ultima
os dados restaurados ficam orfaos, porque todo `user_id` aponta para la.

**Nao cobre:** Storage, Edge Functions, e o resto do schema `auth` (sessoes,
identidades de OAuth). Um desastre real exige recriar essas partes na mao.

### A restauracao desliga os triggers, e isso e obrigatorio

`db-restore.sh` carrega os dados com `session_replication_role = replica`.
Nao e ajuste de desempenho. As tabelas derivadas — `user_balances`,
`financial_accounts.current_balance`, `user_subscriptions`,
`user_usage_limits` — **ja vem prontas no dump**. Com os triggers ligados, a
reinsercao das transacoes faz `update_account_balance` rodar por cima do saldo
que acabou de ser restaurado.

Medido num drill de uma transacao de R$ 1.234,56: o saldo restaurado virou
**R$ 2.469,12**, e `create_free_subscription` ainda estourou
`user_subscriptions_user_id_key`. O ponto perigoso e que o `psql` nao para: o
banco restaurado fica de pe, parecendo certo, mentindo sobre dinheiro.

O drill do CI confere o saldo derivado alem do valor bruto justamente para
impedir que essa linha volte a sumir.

### Restaurar por cima de um banco que ainda tem contas

Se o destino ja tiver linhas em `auth.users`, `db-restore.sh` **para antes de
apagar qualquer coisa** e pede uma escolha explicita:

| Modo | O que faz |
|---|---|
| (default) | recusa e explica |
| `RESTORE_AUTH_MODE=merge` | carrega as contas do backup com `ON CONFLICT (id) DO NOTHING`; as que ja existem no destino ficam como estao |
| `RESTORE_AUTH_MODE=so-public` | nao toca em `auth.users`; restaura so o conteudo de `public` |

Isso nasceu de um defeito real, achado em 2026-09-21 ao restaurar num Supabase
de verdade. O dump de contas e `--column-inserts` puro: uma conta repetida
estourava `duplicate key ... users_pkey` — **depois** de o script ja ter rodado
`DROP SCHEMA public CASCADE`. O destino ficava com a estrutura, sem dados e sem
contas: a restauracao deixava o banco pior do que antes de comecar. O CI nunca
pegaria isso sozinho, porque la o destino e sempre um `CREATE DATABASE` novo,
com `auth.users` vazio — o caso raro no mundo real, onde o normal e restaurar
por cima de um projeto que ainda tem os usuarios. Hoje o `db-verify` cobre os
dois caminhos.

Detalhe de implementacao que vale lembrar: o `merge` usa a lista de colunas do
proprio dump, nao `SELECT *`. O `auth.users` do Supabase tem `confirmed_at`
GERADA, que o `pg_dump` ja omite; um `SELECT *` a traria de volta e o INSERT
morreria em `cannot insert a non-DEFAULT value into column "confirmed_at"`.

Quando houver dado de cliente de verdade, revisitar a decisao: ligar o
Point-in-Time Recovery do Supabase (Settings → Database) e guardar uma copia
fora do fornecedor (S3/R2/Drive). Hoje a unica rede de seguranca e o backup
diario do plano Free, com retencao curta e sem teste de restauracao.

---

## Divida conhecida: tabelas que o codigo usa e nao existem

`dividends`, `transactions`, `user_connections`, `user_groups` sao referenciadas
no codigo mas **nao existem em producao** — sao restos do produto de
investimentos. Esses caminhos falham em runtime. Nao foram criadas aqui de
proposito: o certo e remover o codigo morto, nao inventar tabela.
