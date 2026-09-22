# Contas previstas e gastos fixos

Fase 1 da evolução do produto (HMO-137). É o que responde, na abertura do app,
a pergunta que os apps grandes de finanças respondem primeiro: **o que ainda vai
sair este mês, e o que já venceu?**

## O modelo: regra × ocorrência

Duas tabelas, criadas pela migration `005_recurring_and_scheduled.sql`:

| Tabela | Guarda | Exemplo |
|---|---|---|
| `recurring_rules` | a **regra** de repetição | "aluguel, todo dia 10, R$ 2.500" |
| `scheduled_transactions` | cada **vencimento** | "aluguel de outubro, vence 10/10, não pago" |

Separar as duas é o que Mobills, Organizze e YNAB fazem, e a razão é prática:

- editar a regra **não reescreve o passado** — reajustar o aluguel não muda o
  valor que foi pago em agosto;
- cada ocorrência tem vida própria — a conta de luz deste mês veio R$ 40 mais
  cara, e isso não vira uma regra nova;
- um mês pode ser **pulado** (`skipped`) sem cancelar a mensalidade inteira.

Parcelamento (12× no cartão) continua em `transaction_installments`: é dívida
fechada, com total conhecido. As duas convivem.

## Três decisões que não são óbvias

**1. `overdue` nunca é gravado.** Uma conta está vencida quando
`due_date < hoje AND status = 'pending'` — isso é uma pergunta, não um estado.
Gravar o status exigiria um job diário só para virar a chave à meia-noite, e um
job que não roda deixa a tela mentindo. A view
`scheduled_transactions_effective` calcula na hora e devolve também
`days_until_due`.

A view é `security_invoker = true`. Sem isso ela rodaria com o privilégio do
dono e devolveria a agenda de **todo mundo** para qualquer usuário logado — é o
furo clássico de view sobre tabela com RLS, e tem assert próprio em
`database/tests/scheduled_rls_test.sql`.

**2. A geração de ocorrências é idempotente, e o banco é quem garante.** A
materialização roda toda vez que a tela abre (`GET /api/scheduled-transactions`).
O índice único `(recurring_rule_id, due_date)` é o que impede o aluguel de
outubro de nascer duas vezes; o app usa `upsert ... ignoreDuplicates`. O índice
**não** é parcial: dois `NULL` nunca colidem no Postgres, então lançamento
avulso continua podendo repetir no mesmo dia, e um índice parcial quebraria a
inferência do `ON CONFLICT` (erro `42P10`).

Por isso, apagar uma ocorrência de gasto fixo não adianta — ela volta na
próxima geração. `DELETE` numa ocorrência com regra vira `skipped`, que ocupa o
lugar dela no índice.

**3. A baixa cria a transação primeiro, e desfaz se o segundo passo falhar.**
Não há transação de banco entre os dois passos (o supabase-js fala PostgREST,
uma requisição por vez). A ordem foi escolhida pelo pior caso: se a marcação
falhar, a transação criada é apagada e sobra "não deu baixa" — que o usuário vê
e refaz. A ordem inversa deixaria "conta paga sem dinheiro lançado", que
ninguém percebe. A constraint `scheduled_transactions_paid_check` exige que
`status='paid'`, `paid_date` e `transaction_id` andem sempre juntos.

O saldo da conta e os saldos do grupo são mantidos por **trigger** em
`financial_transactions` — a baixa só insere a transação. Refazer a divisão do
grupo à mão (como faz a rota antiga de `personal-finance`) criaria split em
dobro.

## API

Todas exigem sessão do Supabase. O filtro por usuário/grupo é da RLS, não do
código.

### Gastos fixos

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/recurring-rules` | lista as regras ativas (`?include_inactive=true` traz o resto) |
| `POST` | `/api/recurring-rules` | cria a regra **e já materializa** os próximos vencimentos |
| `PATCH` | `/api/recurring-rules/{id}` | edita; propaga para as ocorrências pendentes futuras |
| `DELETE` | `/api/recurring-rules/{id}` | desativa e cancela o que ainda não venceu (`?purge=true` exclui, e recusa se houver conta paga) |

`POST` aceita: `description`, `amount`, `category_id`, `account_id?`,
`group_id?`, `transaction_type?` (`expense`), `frequency?` (`monthly`),
`interval_count?`, `due_day?`, `start_date?`, `end_date?`, `max_occurrences?`,
`reminder_days?`, `notes?`.

Frequências: `weekly`, `biweekly`, `monthly`, `bimonthly`, `quarterly`,
`semiannual`, `annual`. `interval_count` multiplica o período — `monthly` + 3 é
trimestral.

Mudar frequência, dia ou fim apaga as pendentes futuras e regera pela regra
nova. Mudar só o valor **não** mexe no que já foi pago.

### Contas previstas

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/scheduled-transactions` | agenda; `?from=&to=&status=&group_id=&generate=false` |
| `POST` | `/api/scheduled-transactions` | conta avulsa, sem regra fixa |
| `PATCH` | `/api/scheduled-transactions/{id}` | edita valor/vencimento, ou marca `skipped`/`cancelled` |
| `DELETE` | `/api/scheduled-transactions/{id}` | pula (se vem de regra) ou exclui (se é avulsa) |
| `POST` | `/api/scheduled-transactions/{id}/pay` | dá baixa: cria a transação real |
| `DELETE` | `/api/scheduled-transactions/{id}/pay` | estorna a baixa |
| `GET` | `/api/scheduled-transactions/summary?months=3` | totais por mês + custo fixo mensal |

`status=open` traz pendentes e vencidas — é o filtro que a tela usa. Sem
`status`, vêm pendentes e pagas; `skipped` e `cancelled` só aparecem se pedidos.

A baixa aceita `paid_date` e `amount` (o valor real, quando a conta de luz não
fecha no previsto). `status='paid'` **não** pode ser gravado pelo `PATCH`: a
constraint recusaria e o usuário veria um 500 sem explicação.

## Datas

`lib/recurrence.ts` faz toda a aritmética, em UTC e com strings `YYYY-MM-DD`.
Dois motivos para não estar no banco: calcular data não justifica mais uma
função `SECURITY DEFINER` para auditar (foi o que as migrations 003 e 004
foram consertar), e em TypeScript dá para exercitar fevereiro e ano bissexto
sem subir um Postgres — `npm run test:recurrence`, 13 casos.

O detalhe que quebra silenciosamente: `new Date('2026-03-10')` é UTC, mas
`new Date(2026, 2, 10)` é local. Misturar os dois faz o vencimento andar um dia
para trás em todo o Brasil. Por isso nada aqui passa por `Date` local, nem no
servidor nem na tela.

Dia 31 em fevereiro cai no último dia do mês (28 ou 29) — e o mês curto **não**
contamina os seguintes: a âncora é sempre a data inicial da regra, nunca a
ocorrência anterior.

## Verificação

```bash
npm run test:recurrence     # aritmética de data (13 casos)

# num Postgres limpo, depois de 001 -> 002 -> 003 -> 004 -> 005:
psql "$DB_URL" -f database/tests/scheduled_rls_test.sql   # 16 asserções, dá ROLLBACK
```

As duas rodam no job `db-verify` a cada PR. O caminho sem credencial (colar no
SQL Editor do Supabase) é `database/validation/03_contas_previstas.sql`.
