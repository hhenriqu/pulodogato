# Banco de dados

Projeto Supabase: `odxqjvtxsioksguuevqm`.

```
database/
├── migrations/
│   ├── 000_preflight_inventory.sql  inventario somente leitura, roda antes
│   ├── 001_baseline.sql             schema + seed de referencia
│   └── 002_rls_lockdown.sql         RLS, privilegios e RPCs  (OBRIGATORIO)
├── tests/
│   ├── 00_supabase_shim.sql             auth.uid() e roles, so para Postgres cru
│   ├── rls_isolation_test.sql           prova que um usuario nao le dados de outro
│   ├── legacy_policy_drift_test.sql     policy antiga de producao tem que sumir
│   └── legacy_function_drift_test.sql   funcao antiga de producao tem que sumir
└── README.md
```

Ordem: `001` e depois `002`. Rodar `001` sozinho deixa o banco aberto.

### Validado num banco limpo

```bash
# so em Postgres cru (CI, docker). Num projeto Supabase o shim se recusa a rodar.
psql "$DB_URL" -v ON_ERROR_STOP=1 -f database/tests/00_supabase_shim.sql

psql "$DB_URL" -v ON_ERROR_STOP=1 -f database/migrations/001_baseline.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f database/migrations/002_rls_lockdown.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f database/tests/rls_isolation_test.sql  # da ROLLBACK no fim
```

Executado do zero num Postgres 17 vazio: 16 tabelas, 16 com RLS, 40 policies, as
20 asserções de isolamento passando e a role `anon` sem privilegio fora das duas
tabelas de referencia. O mesmo roda no CI (`.github/workflows/db-verify.yml`) a
cada PR que toca `database/`.

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

**Resolvido:** existe um schema executavel do zero, com o seed junto, e uma
auditoria de RLS repetivel.

**Não resolvido:** o baseline foi *reconstruido pela API*, não extraido com
`pg_dump`. Enquanto isso não for feito, trate `001_baseline.sql` como uma boa
aproximação, não como a verdade.

### O que foi verificado contra producao

- as 16 tabelas que existem (e as 4 que o codigo usa e **não** existem)
- o nome exato de cada coluna de cada tabela
- o grafo de foreign keys
- quais colunas sao ENUM e o nome de cada tipo
- o seed completo de `financial_services` e `transaction_categories`

### O que foi inferido e ainda precisa de conferencia

- tipos exatos, precisao de `numeric`, `NOT NULL`, `DEFAULT`
- a lista completa de valores de cada ENUM (so os valores em uso foram vistos)
- **indices, triggers e funcoes: nao capturados.** O codigo chama a RPC
  `get_user_by_email`, que nao esta reproduzida aqui — restaurar num projeto
  limpo vai quebrar o convite por email ate essa funcao ser recriada.
- as policies de RLS reais. As de `002` foram escritas a partir dos padroes de
  acesso do codigo, não lidas do banco.

### Fechando a lacuna

Com a senha do Postgres (Supabase → Settings → Database):

```bash
supabase db dump --db-url "$SUPABASE_DB_URL" --schema public > database/dump.sql
diff <(grep -oE 'CREATE TABLE [a-z_.]+' database/dump.sql | sort) \
     <(grep -oE 'CREATE TABLE [a-z_.]+' database/migrations/001_baseline.sql | sort)
```

A conexao direta (`db.<ref>.supabase.co:5432`) e IPv6; de ambiente sem IPv6 use
o pooler `aws-0-<regiao>.pooler.supabase.com:6543`, usuario
`postgres.odxqjvtxsioksguuevqm`.

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
