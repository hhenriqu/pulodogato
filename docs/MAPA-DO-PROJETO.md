# Mapa do projeto — Pulo do Gato

> **Para que serve.** Uma foto do repositório inteiro, organizada pelo que o app
> deve ser na essência: **finanças pessoais**, **finanças da família** e **grupos
> que dividem contas** (viagem, churrasco). Serve para decidir ajustes e
> redirecionamento: o que é núcleo, o que falta, o que está duplicado e o que
> foge da essência.
>
> **Como foi feito (02/11/2026, commit `e610872`).** Grafo do Graphify
> (`graphify update .`, ver [`GRAPHIFY.md`](GRAPHIFY.md) no PR #413: 1.147
> arquivos, 10.698 nós, 22.316 arestas, 547 comunidades), mais levantamento
> direto das rotas, do menu (`components/navegacao-do-menu.ts`), do inventário
> do banco (`database/schema-columns.json`) e de quem chama cada rota de API.
> Números de linhas contam comentários, que neste repositório são muitos.
>
> Este documento **não substitui** a PRD (regras de negócio) nem as migrations
> (schema). Ele aponta para eles.

---

## 1. O app em números

| Área | Arquivos | Linhas | O que tem |
| --- | ---: | ---: | --- |
| `app/` | 169 | 63 mil | 44 páginas, **117 rotas de API** |
| `components/` | 109 | 30 mil | telas grandes quebradas em pedaços por assunto |
| `lib/` | 164 | 60 mil | regras puras (`lib/*.ts`) e leituras de banco (`lib/services/`) |
| `database/` | 184 | 93 mil | **76 migrations** (000 a 075), 95 testes SQL, manutenção |
| `scripts/` | 340 | 172 mil | 173 suítes `test-*.mjs`, ~140 guardas, mutantes e sondas |
| `docs/` | 15 | 4 mil | PRD, guias, decisões |

Banco: **73 tabelas e views** no inventário, 58 triggers e 81 funções. Boa
parte da regra de dinheiro mora no banco (divisão, fechamento, acerto,
fatura), por decisão da PRD.

Peso de cada assunto no código do app (`app` + `components` + `lib`,
classificação por nome de arquivo, aproximada):

| Assunto | Linhas | % |
| --- | ---: | ---: |
| Finanças pessoais (núcleo: lançamento, conta, cartão, previstas, relatórios) | 74 mil | 49% |
| **Investimentos + MyBank + Trading + CVM** | **29 mil** | **19%** |
| Grupos (divisão, fechamento, acerto) | 25 mil | 16% |
| Plataforma (auth, offline, PWA, planos, avisos, perfil) | 20 mil | 13% |
| Conexões / divisão com pessoa | 4 mil | 3% |

A leitura mais importante desta tabela: **o código de investimentos é maior que
o de grupos**, e não existe nenhum código que trate "família" como coisa
própria (ver a seção 3.2).

---

## 2. Os três pilares, e o que serve a cada um

### 2.1 Finanças pessoais — o núcleo (sólido)

É o que está mais maduro e é a base dos outros dois pilares: tudo o que um
grupo divide nasce como lançamento de alguém.

| Pedaço | Telas | APIs principais | Lib | Tabelas |
| --- | --- | --- | --- | --- |
| Contas e cartões | `contas`, `cartoes`, `cartoes/[id]` | `financial-accounts`, `card-invoices` | `contas.ts`, `fatura-do-cartao.ts`, `card-invoice.ts`, `agenda-do-cartao.ts` | `financial_accounts`, `card_invoice_lines`, `card_invoice_paid_entries` |
| Lançamentos | `personal-finance` (lista), `receitas`, `despesas`, `transferencias`, `movimentacoes/{despesa,receita,transferencia}` (formulários) | `personal-finance/transactions`, `movimentacoes/resumo`, `movimentacoes/transferencia`, `financial-installments` | `lancamento.ts`, `telas-de-movimentacao.ts`, `movimentacoes.ts`, `transferencia.ts`, `parcelas-edicao.ts` | `financial_transactions`, `transaction_categories`, `transaction_subcategories` |
| Previstas e recorrência | `bills`, `recurrences` | `scheduled-transactions/*`, `recurring-rules`, `recurrences` | `recurrence.ts` (o mais importado da lib), `recurrence-detector.ts`, `services/scheduled.ts`, `vinculo-da-prevista.ts` | `scheduled_transactions(_effective)`, `recurring_rules`, `detected_recurrences` |
| Planejamento | `budgets`, `goals`, `cash-flow` | `budgets`, `goals`, `cash-flow`, `projection`, `safe-to-spend`, `dashboard/previsao`, `anomalies` | `safe-to-spend.ts`, `projecao.ts`, `cash-flow-forecast.ts`, `previsto-x-realizado.ts` | `budgets`, `budget_consumption`, `financial_goals`, `goal_contributions`, `planned_vs_actual` |
| Leitura do mês | `dashboard` (página inicial), `reports` | `reports/*`, `dashboard/saldo-em-conta` | `periodo-do-painel.ts`, `saldo-em-conta.ts`, `realizado-do-caixa.ts` | views `personal_monthly_cash_flow`, `monthly_cash_flow`, `category_monthly_totals` |
| Entrada em volume | `statements`, `categorization`, `categorias`, `payroll` | `statements`, `categorization-rules`, `receipts`, `payroll` | `statement.ts`, `categorization.ts` | `statement_imports/entries`, `categorization_rules`, `receipts`, `payroll_*` |

Regras de negócio: RN001 a RN006 e RN016/RN017 da PRD (sinal do valor,
transferência, fatura sem dupla contagem, parcelamento, Resultado do mês).

### 2.2 Finanças da família — existe na prática, mas não existe no modelo

**Não há entidade "família"** no código nem no banco. Uma busca por
`famil`, `household`, `casal`, `cônjuge` em `app/`, `lib/`, `components/` e nas
migrations só acha comentários. A família é atendida hoje por **dois caminhos
emprestados**:

1. **Um grupo com dia de fechamento** (ex.: o grupo "Casa" de produção, com três
   pessoas). Despesas fixas da casa viram previstas de grupo, o fechamento mensal
   gera para cada um a conta a pagar ou a receber (RN018), e o acerto dá baixa
   (RN019). Divisão igual, por percentual ou proporcional à renda
   (`semear-pela-renda.ts`). Orçamento de grupo (`orcamento-de-grupo.ts`,
   migration 049).
2. **Uma conexão** (duas pessoas, sem grupo): a divisão com pessoa (RN020),
   que desde a 075 cobre a despesa fixa, a prevista e a parcelada, e a tela
   `connections/[pessoaId]` com quanto cada um paga por mês.

O que a família precisa e **não tem**:

- ~~**Visão da casa.**~~ Feito na migration 078 (RN024): a tela `casa` soma o
  Resultado e o saldo de quem escolhe mostrar o mês, sem contar duas vezes o
  que um membro deve ao outro (`resultado_da_casa`, `lib/resultado-da-casa.ts`).
  Falta somar as previstas de todos.
- ~~**Conta conjunta.**~~ Feito na 078: `financial_accounts.casa_id` marca a
  conta como conjunta; os membros veem saldo e extrato e lançam nela.
- **Metas e orçamento da família.** Metas compartilhadas estão no backlog da
  PRD; o orçamento de grupo existe mas é do grupo, não da casa.
- ~~**Dependente sem login.**~~ Feito na migration 079 (RN024.5): o membro
  sem conta da casa tem `group_members.participa_da_divisao` falso, não
  recebe parte de despesa e pode estar na casa com dia de fechamento.
- ~~**Dizer que o grupo é a casa.**~~ Feito na migration 076 (RN023):
  `expense_groups.group_kind` é `casa` ou `evento`, separado de `group_type`
  (que é a regra de entrada, público ou privado). Os grupos com `closing_day`
  viraram casa.
- **Escolher entre grupo e conexão.** Para duas pessoas que dividem a casa,
  os dois caminhos fazem quase a mesma coisa com tabelas, telas e regras
  diferentes (ver duplicações, seção 4).

### 2.3 Grupos que dividem contas (viagem, churrasco) — completo, mas pesado

| Pedaço | Telas | APIs | Lib | Tabelas |
| --- | --- | --- | --- | --- |
| Grupo e membros | `expense-groups`, `expense-groups/[groupId]` (abas Despesas, Painel, Balanços, Membros), `expense-groups/archived` | `expense-groups`, `.../invite`, `.../join`, `.../leave`, `.../members/*`, `.../restore` | `grupos.ts`, `convite-de-grupo.ts`, `contagem-do-grupo.ts` | `expense_groups`, `group_members`, `group_invitations` |
| Divisão | idem | `.../transactions`, `.../split-config`, `.../split-suggestions`, `.../semear-divisao`, `.../scheduled` | `divisao-do-grupo.ts`, `divisao-configurada.ts`, `sugestao-de-divisao.ts`, `parte-do-grupo*.ts`, `regra-do-pagador.ts` | `group_transactions`, `group_expense_splits`, view `group_share_entries` |
| Saldo, fechamento e acerto | idem | `.../balances`, `.../fechamento*`, `.../settlements*`, `my-balance`, `my-credit`, cron `group-closings` | `settlement.ts`, `fechamento-do-grupo.ts`, `acerto-*.ts`, `teto-do-acerto.ts`, `pra-quem-pagar.ts`, `services/fechamento-dos-grupos.ts` | `group_member_balances`, `group_closings`, `group_closing_items`, `group_closing_entries`, `group_settlements`, `group_settlement_allocations`, `group_bill_payments` |
| Moeda da viagem | idem | `cambio` | `moeda-do-grupo.ts`, `cambio.ts`, `ptax.ts` | `expense_groups.currency` (026) |

Regras: RN007, RN008, RN018, RN019 e as regras de saída
(`docs/REGRAS_SAIDA_GRUPOS.md`) e de arquivamento (`docs/GRUPO_ARQUIVAMENTO.md`).

O que a viagem ou o churrasco precisam e **não tem**:

- ~~**Participante sem app.**~~ Feito na migration 077 (RN025): o admin
  adiciona alguém só com o nome (`group_members.user_id` nulo,
  `display_name`), que divide, aparece no saldo e acerta. Fora do grupo com
  dia de fechamento, por enquanto.
- ~~**Lançar o que outra pessoa pagou.**~~ Feito na 077: a despesa paga por
  outro membro fica só no grupo (`group_transactions` sem `transaction_id`,
  com `paid_by_member_id`), pela função `lancar_despesa_paga_por_membro`.
  Falta a parte de quem tem conta entrar no Resultado do mês.
- **Grupo rápido.** Criar grupo exige configurar divisão, moeda, convites. Não
  há um caminho de "evento" que acerta uma vez e arquiva sozinho.
- **Despesa só do grupo.** Toda despesa de grupo é também um lançamento pessoal
  do pagador, numa conta dele. Para quem só quer dividir a viagem, o app exige
  ter conta cadastrada antes.

---

## 3. O que está fora da essência

| Módulo | Tamanho | Situação | Leitura |
| --- | --- | --- | --- |
| **Investimentos** (`investments`, carteira, renda fixa, rebalanceamento, cotação brapi, crivos) | `lib/investments.ts`, `renda-fixa.ts` (1,3 mil), `crivos.ts`, `rebalanceamento.ts`, 7 rotas, migrations 021, 031, 059, 073, 074 | ativo, recebendo trabalho recente (073/074) | A PRD diz que serve para "acompanhar patrimônio, não operar". O rebalanceamento com pesos e crivos já é ferramenta de investidor. |
| **CVM / fundamentos** | `fundamento-cvm.ts`, `cvm-zip.ts`, tabelas `cvm_*` (028) | 3 de 4 tabelas `cvm_*` sem nenhum `.from()` no app | Quase morto. Candidato a sair. |
| **MyBank** (empréstimo da conta de investimento) | `emprestimo-do-mybank.ts` (**4 mil linhas, o maior arquivo da lib**), `mybank-na-tela.ts` (1 mil), 6 rotas, migrations 053, 062, 071 | ativo | Emprestar para uma conexão encosta na família, mas o tamanho é desproporcional ao uso. |
| **Trading** | página que mostra "Em desenvolvimento", gate `trader` | vazio | Decisão de produto já tomada (atividade regulada). Pode sair do menu e do código de planos. |
| **Calculadoras** | página de 745 linhas | ativo | Neutro. Não lê o banco. |
| **Contracheque** | `payroll` | ativo | Serve ao pessoal (gera a receita líquida); é nicho. |
| **Planos e assinatura** | `plans`, `subscription/*`, `user_subscriptions`, `user_usage_limits` | gates parciais | Só `Trading` e `Admin` filtram o menu; o resto é cadeado visual. |
| **Modo papel de pão** | `modo-papel.ts`, `menu-do-papel.ts`, `ConversaDePapel`, `api/papel-de-pao/conversa` | metade entregue | O cabeçalho da rota cita `painel/route.ts` e `lib/papel-de-pao.ts`, que **não existem**. É uma tela simplificada ("Gastei X / Ganhei X") que pode virar a porta de entrada do pessoal, ou sair. |

---

## 4. Duplicações

1. **Três jeitos de dividir uma despesa**, com tabelas próprias:
   - grupo por lançamento: `group_transactions` → `group_expense_splits`;
   - grupo por fechamento: `group_closings` → `group_closing_items/entries` →
     `group_settlements` + `group_settlement_allocations`;
   - pessoa/conexão: `expense_splits` (+ `recurring_rule_splits` e
     `scheduled_splits` da 075), com contas "A receber de" / "Pagamento a".

   A PRD já diz que "a conexão funciona como um grupo de duas pessoas"
   (RN020.8). No código ela **não é** um grupo: é um segundo sistema que repete
   o primeiro. A thread aberta "Fazer conexões lançarem contas como grupos" é
   exatamente essa costura. Unificar (conexão = grupo de 2 com fechamento no
   lançamento) eliminaria um sistema inteiro.

2. **Restos de modelos antigos de divisão** ainda no banco:
   `user_balances` (trigger do 001, lida só pela rota órfã
   `personal-finance/splits`), `group_member_proportions` (sem nenhum
   `.from()`, o código já avisa que a verdade é `group_members.percentage`),
   colunas de aprovação em `expense_splits` (`status`, `approved_at`,
   `rejection_reason`) para a RN011.2 que nunca foi implementada.

3. **Cinco leituras de previsão**: `api/projection`, `api/cash-flow`,
   `api/dashboard/previsao`, `api/safe-to-spend` e
   `api/scheduled-transactions/summary`. Cada uma aplica a parte do grupo e o
   cartão pela fatura no seu próprio caminho.

4. **Vários somadores do Resultado do mês em TypeScript**: dashboard,
   `movimentacoes/resumo`, `reports/cash-flow`, `reports/categories`,
   Finanças Pessoais, `cash-flow`, além das views `budget_consumption` e
   `planned_vs_actual`. O próprio código registra a família de defeito
   `despesa-de-grupo-tem-tres-convencoes`: quatro telas respondendo 990 / 950 /
   900 / 990 para a mesma despesa (`lib/legenda-do-bruto-e-do-liquido.ts`). As
   threads de "saldo negativo no dashboard" e "despesa contada duas vezes"
   nascem daqui. Um único serviço de Resultado (realizado + previsto, por
   pessoa e por período) que todas as telas leem é a mudança com maior retorno.

5. **Escrita fora da API.** O formulário de lançamento, Finanças Pessoais,
   Perfil, Conexões e a chave Pix gravam direto no Supabase do navegador. Ao
   mesmo tempo existem rotas para as mesmas coisas que ninguém chama (seção 5).
   O `POST /api/personal-finance/transactions` não grava `account_id`, e a rota
   da conversa do papel de pão foi criada à parte por causa disso.

6. **Lista e recortes de movimentação.** `personal-finance` (lista com editar e
   excluir) convive com `receitas`, `despesas` e `transferencias` (os três
   recortes com previsto e realizado). O menu explica a fronteira, mas para quem
   usa são quatro telas para "o que entrou e saiu".

Não são duplicação, apesar do nome repetido: `lib/X.ts` e `lib/services/X.ts`
(`despesas-do-grupo`, `fechamento-no-resultado`, `fatura-paga-no-resultado`,
`categorization`). É a separação de propósito entre regra pura e leitura do
banco.

---

## 5. Código órfão e sobras

Rotas de API **sem nenhuma tela chamando** (fora as de cron, que a Vercel chama):

- `app/api/connections/requests` e `.../requests/[id]` — a tela de Conexões grava direto em `user_connections`;
- `app/api/users/search`;
- `app/api/personal-finance/splits` — lê `user_balances`, modelo antigo;
- `app/api/expense-groups/[groupId]/members/[memberId]/role`.

Arquivos que sobraram:

- `app/api/expense-groups/route-backup.ts`, `route-fixed.ts`, `route-emergency.ts`;
- `PROBLEMA_RESOLVIDO.md` na raiz (nota de um conserto antigo);
- `deploy.sh`, `setup-ssl.sh`, `docker-compose.yml` (deploy por Docker/nginx;
  produção é Vercel — o `Dockerfile` ainda é construído no CI);
- `app/(dashboard)/dashboard/transactions` (só redireciona) e `migrations`
  (tela de admin que só reporta);
- `package.json` ainda chama o projeto de `pulodogato-investments`.

Documentação desatualizada: a PRD cita migrations "001 a 024" e 50 tabelas (são
76 e 73), ainda lista `transaction_installments` (apagada na 052);
`database/README.md` vai até a 012; `API-Specification.md`,
`GROUP_MANAGEMENT_IMPLEMENTATION.md` e `PERSONAL_FINANCE_GUIDE.md` são da
primeira versão.

---

## 6. Fluxos principais (onde olhar)

| Fluxo | Caminho |
| --- | --- |
| Lançar despesa | `movimentacoes/despesa` → `components/movimentacoes/FormularioDeLancamento.tsx` → `lib/lancamento.ts` → insert em `financial_transactions` → trigger de saldo da conta; com grupo, trigger `auto_create_group_transaction` → `group_transactions` + `group_expense_splits` |
| Compra no cartão e fatura | lançamento no cartão → `card_invoice_lines` (006/041) → fatura em `cartoes/[id]` → pagamento = transferência de duas pernas (015) → no Resultado conta a fatura no vencimento (072, `lib/fatura-paga-no-resultado.ts`) |
| Conta prevista | `recurring_rules` → `scheduled_transactions` (agenda) → `scheduled-transactions/[id]/pay` cria o lançamento, ou `.../vincular` liga a um já lançado (065) |
| Despesa de grupo até o acerto | lançamento com `group_id` → divisão por trigger → cron `group-closings` no dia de fechamento → `group_closings/items/entries` (067/069) → conta a pagar/receber de cada membro → `settlements` dá baixa (068) |
| Divisão com conexão | lançamento com pessoa → `expense_splits` → contas "A receber de" e "Pagamento a" (070); fixa e prevista pela 075 (`recurring_rule_splits`, `scheduled_splits`) → `connections/[pessoaId]` |
| MyBank | `mybank/loans` → `mybank_loans` + `mybank_installments` (053) → juros (062/071) → agenda dos dois lados |
| Avisos | crons `bill-alerts`, `recurrence-scan`, `recurrence-alerts`, `monthly-summary` → `bill_notifications` → push/email |

As migrations contam a história do produto: 001–019 base e planejamento;
020–052 grupos, categorias e convites; 053–064 MyBank e "fora dos totais";
065–072 o modelo novo das movimentações (fases 1 a 6 da PRD); 073–074
investimentos; 075 divisão com conexão na agenda.

---

## 7. Recomendações para redirecionar

Em ordem de retorno para a essência:

1. **Um serviço único de Resultado do mês.** Uma função (ou view) que responde
   realizado e previsto, por pessoa e período, já com parte de grupo, conexão,
   fatura e MyBank. Todas as telas e as cinco rotas de previsão passam a ler
   dela. Fecha a família de defeitos que mais aparece (saldo negativo, despesa
   em dobro, números diferentes entre telas).
2. **Conexão vira grupo de duas pessoas de verdade.** Um modelo de divisão só,
   com dois modos: fecha no lançamento ou fecha no dia do mês. Apagar
   `user_balances`, `group_member_proportions` e as colunas de aprovação sem uso.
3. **Dar nome à família.** Um tipo de grupo (`casa` / `evento`), feito na 076
   numa coluna própria (`group_kind`), porque `public`/`private` é a regra de
   entrada e continua valendo. Falta a visão "Casa" (Resultado e previstas somados de
   todos) e conta conjunta como próximo passo.
4. **Facilitar o churrasco.** Participante sem conta (só nome), lançar despesa
   paga por outro membro e um grupo de evento que acerta uma vez e arquiva.
5. **Encolher o que foge.** Tirar Trading e CVM; congelar investimentos em
   "acompanhar patrimônio" (sem novas features de rebalanceamento); manter o
   MyBank só para empréstimo entre conexões, sem crescer.
6. **Limpar sobras.** Rotas órfãs, `route-*.ts` de backup, scripts de deploy
   Docker se a Vercel for o único destino, e atualizar PRD, `database/README.md`
   e as docs da primeira versão.

---

## 8. Usar o Graphify para navegar

Com o Graphify instalado (`docs/GRAPHIFY.md`), `graphify update .` leva ~20 s.
O que funcionou melhor neste mapeamento:

- `graphify explain "lib/fechamento-do-grupo.ts"` — vizinhos de um arquivo;
- `graphify path "FormularioDeLancamento.tsx" "lib/lancamento.ts"` — caminho entre dois pontos
  (para tabela, use `arquivo::public.tabela`, porque o nome aparece em várias migrations);
- arestas `reads_from` / `writes_to` do `graph.json` ligam as migrations às
  tabelas que cada função SQL lê e grava.

Perguntas em linguagem livre (`graphify query`) trazem muito ruído dos
`scripts/`, que são mais da metade do grafo; prefira nomes de arquivo ou de
tabela. O relatório agregado (`GRAPH_REPORT.md`) aponta como nós centrais
`createClient`, `recurrence.ts`, `dinheiro.ts` e os componentes de UI.
