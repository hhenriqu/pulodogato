# Banco de dados

Projeto Supabase: `odxqjvtxsioksguuevqm`.

```
database/
├── migrations/
│   ├── 001_baseline.sql      schema + seed de referencia
│   └── 002_rls_lockdown.sql  RLS, privilegios e RPCs  (OBRIGATORIO)
├── tests/
│   └── rls_isolation_test.sql  prova que um usuario nao le dados de outro
└── README.md
```

Ordem: `001` e depois `002`. Rodar `001` sozinho deixa o banco aberto.

### Validado num banco limpo

As duas migrations foram executadas do zero num Postgres 17 vazio, e o teste de
isolamento passou nas 20 asserções:

```bash
psql "$DB_URL" -f database/migrations/001_baseline.sql
psql "$DB_URL" -f database/migrations/002_rls_lockdown.sql
psql "$DB_URL" -f database/tests/rls_isolation_test.sql   # roda em transacao, da ROLLBACK no fim
```

O teste assume `auth.users` e `auth.uid()` e as roles `anon`/`authenticated` — num
projeto Supabase real ja existem. Num Postgres cru e preciso criar esse minimo
antes. Ressalva: foi validado em Postgres puro, **nao** num projeto Supabase
limpo de verdade; extensoes e roles extras do Supabase nao foram exercitadas.

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

**Ainda nao configurado** — depende de acesso que o agente nao tem.

O plano de Point-in-Time Recovery do Supabase e o caminho mais curto
(Settings → Database → Point in Time Recovery); no plano Free existe apenas
backup diario com retencao curta, o que nao e suficiente antes de entrar dinheiro
real. Alternativa versionada, para rodar num runner com a senha em secret:

```bash
supabase db dump --db-url "$SUPABASE_DB_URL" --schema public \
  > "backup-$(date +%F).sql"
```

Guardar fora do Supabase (S3/R2/Drive). Um backup nunca restaurado nao e backup:
testar a restauracao num projeto limpo pelo menos uma vez.

---

## Divida conhecida: tabelas que o codigo usa e nao existem

`dividends`, `transactions`, `user_connections`, `user_groups` sao referenciadas
no codigo mas **nao existem em producao** — sao restos do produto de
investimentos. Esses caminhos falham em runtime. Nao foram criadas aqui de
proposito: o certo e remover o codigo morto, nao inventar tabela.
