# PRD — Pulo do Gato

## Product Requirements Document

> **Documento de referência do produto.** Descreve o que o Pulo do Gato é, as
> regras de negócio que valem, e o que ainda é requisito não implementado.

**Versão:** 2.0
**Data:** 29 de setembro de 2026
**Projeto:** Pulo do Gato — gestão financeira familiar
**Tipo:** Progressive Web App (PWA)
**Status:** em produção — https://pulodogato.hmoraes.com.br

### Controle de versões

| Versão | Data | Mudanças | Aprovado por |
| ------ | ---- | -------- | ------------ |
| 1.0 | 23/09/2025 | Versão inicial (como "Controle de Investimentos") | Equipe Dev |
| 1.1 | 23/09/2025 | Perfil avançado + sistema de conexões | Equipe Dev |
| 1.2 | 23/09/2025 | Finanças pessoais + sistema de divisão de gastos | Equipe Dev |
| 2.0 | 29/09/2026 | **Reescrita para o produto que existe** (HMO-119) | pendente |

> **O que a versão 2.0 corrigiu.** Até aqui esta PRD descrevia um app de carteira
> de investimentos: o problema era "investidores pessoa física", as personas eram
> investidores, e a seção de banco de dados traía 650 linhas de ERD com as tabelas
> `assets`, `portfolios`, `dividends`, `portfolio_positions`, `price_history` e
> `asset_categories`. **Nenhuma dessas seis tabelas existe.** O schema real tem 50
> tabelas e views, e o módulo de investimentos nele chama-se
> `investment_assets` / `investment_transactions`.
>
> O documento não era só desatualizado — ele era consumido. O
> `scripts/check-prd-compliance.js` media o projeto contra esta PRD e reportava
> para sempre "RN002 — Gestão de Ativos: pendente", porque cobrava
> `app/api/assets/route.ts`, uma rota que nunca deveria existir. Como ele sai 1, e
> como vem antes do `lint` na cadeia do `pre-commit`, **o lint nunca rodava
> localmente**. Um documento errado tinha desligado uma verificação real.
>
> A regra que ficou: esta PRD **não copia o schema**. Quem manda no schema é
> `database/migrations/` e o inventário gerado `database/schema-columns.json`, com
> guarda de deriva no CI. Cópia que sai de sincronia é pior que não ter cópia.

> **Para mudanças nesta PRD:** consulte [`PRD-Governance.md`](PRD-Governance.md).

---

## Índice

1. [Visão geral do produto](#visão-geral-do-produto)
2. [Personas e casos de uso](#personas-e-casos-de-uso)
3. [Funcionalidades](#funcionalidades)
4. [Regras de negócio](#regras-de-negócio)
5. [Arquitetura técnica](#arquitetura-técnica)
6. [Banco de dados](#banco-de-dados)
7. [Interface e design](#interface-e-design)
8. [Segurança](#segurança)
9. [Qualidade e sustentação](#qualidade-e-sustentação)
10. [Roadmap](#roadmap)

---

## Visão geral do produto

### Problema

Uma família que divide as despesas da casa não consegue responder, sem planilha,
três perguntas simples:

- **Quanto entrou e quanto saiu este mês, de verdade?** Somar extrato não
  resolve: o pagamento da fatura do cartão aparece como uma saída de milhares de
  reais, e as compras que geraram aquela fatura aparecem outra vez. O mês fecha
  com o dobro do gasto real.
- **Quanto posso gastar sem estourar?** O saldo da conta não é a resposta —
  parte dele já está comprometida com parcelas, contas previstas e a fatura que
  vai fechar.
- **Quem deve a quem?** Quando duas pessoas dividem aluguel, mercado e
  assinaturas em proporções diferentes, o acerto no fim do mês é uma conta
  manual, feita em centavos, que ninguém confere.

### Solução

Um PWA instalável no celular que registra o dinheiro da casa com as regras certas
embutidas: a fatura do cartão é uma transferência (não uma despesa), a despesa de
grupo é dividida pelo **banco** no momento do lançamento, e o rateio fecha em
centavos. Funciona sem rede — o lançamento feito no mercado, no subsolo, entra
numa fila e sobe quando o sinal volta.

### Proposta de valor

- **O total não mente.** As invariantes de dinheiro que mais erram — sinal do
  valor, dupla contagem da fatura, arredondamento do rateio — são garantidas por
  trigger e por teste em Postgres de verdade, não por cuidado da tela.
- **Divisão sem discussão.** O rateio e o acerto são calculados e auditáveis.
- **Feito para o celular.** Instalável, offline, e com a tela de lançamento a um
  toque.

### Não-objetivos

- Não é home broker, nem cotação em tempo real, nem imposto de renda de bolsa. O
  módulo de investimentos serve para **acompanhar patrimônio**, não para operar.
- Não é open banking. A entrada de dados em volume é por importação de extrato
  (OFX/CSV), não por conexão automática com banco.

---

## Personas e casos de uso

### Persona primária — quem administra o dinheiro da casa

Adulto, contas no nome, dividindo despesas com cônjuge ou parceiro. Já tentou
planilha e desistiu da manutenção. Usa o celular para quase tudo.

**Precisa:** lançar em segundos; saber o quanto sobra; que a divisão com a outra
pessoa seja automática e confiável.
**Dores:** fatura de cartão contada duas vezes; esquecer conta a vencer; acertar
o mês de cabeça.

### Persona secundária — quem divide sem administrar

Participa dos grupos de despesa e lança o que pagou, mas não configura nada.

**Precisa:** ver a sua parte, ver o que deve, e lançar rápido.

### Casos de uso centrais

1. Lançar uma despesa no cartão, parcelada em 6x, e ver as parcelas caírem nos
   meses seguintes sem lançar de novo.
2. Pagar a fatura do cartão e o gasto do mês **não** aumentar.
3. Lançar o mercado num grupo de 2 pessoas com divisão 60/40 e o rateio fechar no
   centavo.
4. Fechar o mês e ver quem deve a quem, e registrar o acerto.
5. Lançar sem internet e confiar que vai subir.

---

## Funcionalidades

Legenda: ✅ em produção · 🚧 parcial · 📋 requisito, não implementado

### Contas e cartões ✅

Contas (corrente, poupança) e cartões de crédito em **telas separadas**, com
campos próprios: conta tem saldo; cartão tem limite, dia de fechamento e dia de
vencimento.

### Lançamentos ✅

Despesa, receita e transferência, cada um com os seus campos. Parcelamento,
recorrência e rateio. Máscara de valor em reais. Categorias de referência.

### Fatura de cartão ✅

Fatura consolidada por ciclo; o **pagamento** da fatura é registrado como
transferência de duas pernas, para que a despesa original não seja contada
novamente.

### Grupos de despesa ✅

Criação de grupo, convites, membros, rateio por lançamento, saldo entre membros,
acerto de contas, arquivamento e regras de saída. Divisão igual, por percentual e
proporcional à renda (tabela `group_member_proportions`).

### Planejamento ✅

Orçamento por categoria; metas com aporte mensal; contas previstas; recorrências
com detector de assinaturas; fluxo de caixa com previsão; "quanto posso gastar";
anomalias; gasto variável; patrimônio líquido; relatórios; calculadoras.

### Extratos e comprovantes ✅

Importação OFX/CSV com deduplicação por conta; comprovantes em bucket privado;
regras de categorização automática.

### Contracheque ✅

Bruto, descontos em folha e líquido — o lançamento gerado é o **líquido**.

### Investimentos 🚧

`investment_assets` e `investment_transactions`: registro de ativos e operações
para compor o patrimônio. Sem cotação automática e sem cálculo de rentabilidade
consolidada.

### PWA e offline ✅

Instalável; leitura offline com carimbo de quando o dado foi servido; fila de
lançamentos feitos sem rede; página `/offline` alcançável.

### Notificações ✅

Push (VAPID), avisos de vencimento, alertas de recorrência e resumo mensal, via
Vercel Cron.

### Conta e assinatura ✅

Perfil, conexões entre usuários, planos com limites de uso, painel de
configurações (ordem dos blocos do dashboard, zerar a conta), modo noturno.

### Multi-moeda 🚧

Schema preparado (migration `022`); a experiência completa de conversão não está
fechada.

---

## Regras de negócio

As regras marcadas **(banco)** são garantidas por constraint, trigger ou policy —
a tela não pode contorná-las. As marcadas **(tela)** vivem em TypeScript testado.

### RN001 — Cadastro e sessão ✅

- RN001.1 Cadastro por e-mail e senha, via Supabase Auth.
- RN001.2 Todo usuário autenticado tem uma linha em `profiles`. **(banco)**
- RN001.3 A sessão não cai por falta de rede: a validação remota é dispensada por
  até 1h, e falha de rede não desloga.

### RN002 — Sinal do valor ✅ **(banco + tela)**

- RN002.1 **Despesa é gravada com valor negativo**; receita, positiva.
- RN002.2 Qualquer soma de valor tem que respeitar o sinal. `SUM` cru sobre
  despesas devolve número negativo — inverter na apresentação é erro clássico
  aqui, e tem teste.
- RN002.3 Valor zero não gera linha de gasto nas views de relatório.

### RN003 — Transferência ✅ **(banco)**

- RN003.1 Transferência é registrada como **duas pernas** que se anulam: o saldo
  total não muda.
- RN003.2 Transferência usa categoria reservada própria, e a rota só **lê** essa
  categoria — nunca a cria sob demanda (`transaction_categories` é tabela de
  referência, com `GRANT SELECT` apenas).
- RN003.3 Transferência não entra em receitas nem em despesas dos relatórios.

### RN004 — Fatura de cartão ✅ **(banco)**

- RN004.1 As compras do ciclo compõem a fatura.
- RN004.2 O **pagamento** da fatura é transferência (RN003), não despesa —
  contá-lo como despesa dobraria o gasto do mês.
- RN004.3 Detectar "é fatura" pelo tipo de conta é proibido: isso apagaria a
  despesa de toda assinatura lançada no cartão.

### RN005 — Parcelamento ✅

- RN005.1 Uma compra em N parcelas gera N lançamentos previstos.
- RN005.2 A soma das parcelas é igual ao total, **em centavos** — a sobra do
  arredondamento é distribuída, não descartada.

### RN006 — Recorrência e contas previstas ✅

- RN006.1 Regra de recorrência gera a próxima ocorrência; a data é decidida em
  TypeScript, o banco só garante que a **mesma** data não duplica (índice único).
- RN006.2 Detector de recorrência sugere assinaturas a partir do histórico.

### RN007 — Divisão de despesa em grupo ✅ **(banco)**

- RN007.1 Só **despesa** é divisível.
- RN007.2 A divisão é feita pelo **banco**, por trigger, no momento do
  lançamento. A tela não divide — ela exibe. (São dois triggers gêmeos:
  desligar um não prova nada.)
- RN007.3 O rateio fecha **em centavos**: a soma das partes é exatamente o total.
- RN007.4 Percentuais de divisão somam 100%.
- RN007.5 Editar uma despesa de grupo **refaz** a divisão.
- RN007.6 Membro inativo não entra na divisão automática.
- RN007.7 Apagar grupo **arquiva**; não remove histórico de dinheiro.

### RN008 — Acerto do grupo ✅ **(banco)**

- RN008.1 O saldo entre membros diz quem deve a quem.
- RN008.2 O acerto é registrado com o sinal correto para cada lado.

### RN009 — Divisão proporcional à renda 🚧

- RN009.1 Percentual do membro = receita do membro ÷ soma das receitas.
- RN009.2 Percentuais ficam versionados para auditoria
  (`group_member_proportions`).
- RN009.3 📋 Recálculo automático quando as receitas mudam.
- RN009.4 📋 Privacidade: membro vê percentual, não valor absoluto do outro.

### RN010 — Conexões entre usuários ✅ **(banco)**

- RN010.1 Divisão só com conexão aceita — consentimento dos dois lados.
- RN010.2 Par de usuários é único, e o bloqueio é durável.

### RN011 — Aprovações e convites 🚧

- RN011.1 Convite de grupo tem histórico com status.
- RN011.2 📋 Aprovação individual de cada parte da divisão, com comentário.
- RN011.3 📋 Lembrete após 3 dias e expiração automática em 7.

### RN012 — Isolamento por usuário ✅ **(banco)**

- RN012.1 RLS ligada em toda tabela de dados do usuário; ninguém lê linha de
  outro. Tem teste de isolamento em Postgres de verdade.
- RN012.2 Policy de `INSERT` com `user_id = auth.uid()` **não basta**: sem chave
  estrangeira composta, A consegue pendurar linha num ativo de B. A FK composta
  é a proteção.
- RN012.3 View sem `security_invoker` fura RLS (roda como o dono) — toda view que
  expõe dado de usuário tem a opção ligada, com teste.
- RN012.4 Trigger que mantém tabela derivada roda com privilégio de quem
  disparou; por isso as funções são `SECURITY DEFINER`, inclusive a casca do
  trigger.

### RN013 — Planos e limites ✅

- RN013.1 Limites de uso por plano, medidos em `user_usage_limits`.
- RN013.2 Limite de plano não se mistura com regra financeira.

### RN014 — Offline ✅

- RN014.1 Lançamento feito sem rede entra em fila local e sobe depois.
- RN014.2 Tela de leitura offline mostra **quando** o dado foi servido; número
  velho com cara de atual é pior que número nenhum.

### RN015 — Rotas de cron ✅

- RN015.1 Autenticadas por `CRON_SECRET`; a checagem vem antes de qualquer acesso
  ao banco, então `401` não diz nada sobre o schema.
- RN015.2 Execuções ficam registradas em `cron_runs`.
- RN015.3 No plano Hobby da Vercel o horário tem tolerância de ±59 min: a ordem
  entre dois jobs do mesmo dia **não** é garantida.

---

## Arquitetura técnica

### Stack

| Camada | Escolha |
| --- | --- |
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind |
| Componentes | Radix UI, Recharts, Lucide |
| Formulários | React Hook Form + Zod |
| Banco / Auth / Storage | Supabase (PostgreSQL com RLS) |
| PWA | next-pwa |
| Hospedagem | Vercel + Vercel Cron |

### Princípio de arquitetura

**Regra de dinheiro mora no banco.** Sinal do valor, duas pernas da
transferência, rateio do grupo e isolamento por usuário são garantidos por
constraint, trigger e policy. A tela pode ter bug sem que o total fique errado — e
já teve: a tela refazia uma divisão que o banco já tinha feito, e anunciava "não
consegui dividir" exibindo a divisão certa.

O que fica em TypeScript é o que é **decisão**, não invariante: qual data a
recorrência escolhe, como a máscara formata, qual tela mostra qual tipo de conta.
Essas partes são funções puras, testadas com o runner nativo do Node.

### Estrutura de pastas

```
app/            App Router: (auth), (dashboard), api/
components/     ui/ (primitivos), e um diretório por área
lib/            regras puras, hooks, clientes de Supabase, services/
database/       migrations/, tests/, validation/, seed/, maintenance/
scripts/        guardas do CI e suítes de teste
docs/           esta PRD e os guias por área
```

### Deploy

Vercel, a partir da `main`, por **squash merge** — merge commit não dispara o
deploy de produção, e commit de autor não verificado não builda. As variáveis
vivem no painel da Vercel; um `.env.production` local não chega ao build de lá, e
`.env.production` **não é versionado**.

`NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` são exigidas **no
build**, não só em runtime: `utils/supabase/env.ts` valida presença, formato de
URL e valor-de-exemplo, e `next build` pré-renderiza as telas de login. Build sem
elas reprova em 31 páginas.

**O deploy publica código, não schema.** Não existe runner de migration: aplicar
migration é passo manual no SQL Editor do Supabase.

---

## Banco de dados

**Esta seção não copia o schema, de propósito** — ver a nota da versão 2.0.

- **Fonte da verdade:** `database/migrations/` (`001` a `024`). A ordem importa:
  `001` sozinho deixa o banco aberto; é o `002` que liga a RLS.
  `001_baseline.sql` é **gerado** por `pg_dump` — não editar à mão.
- **Inventário gerado:** `database/schema-columns.json` — 50 tabelas e views.
- **Guia por arquivo:** [`../database/README.md`](../database/README.md).
- **Guardas de deriva no CI:** `check-table-drift`, `check-column-drift`,
  `code-schema-drift` e `gen-validation-bundle --check`.

### Domínios das 50 tabelas e views

| Domínio | Tabelas principais |
| --- | --- |
| Identidade | `profiles`, `user_connections`, `push_subscriptions`, `notification_preferences` |
| Contas e lançamentos | `financial_accounts`, `financial_transactions`, `transaction_categories`, `transaction_installments`, `card_invoice_lines` |
| Grupos | `expense_groups`, `group_members`, `group_invitations`, `group_transactions`, `group_expense_splits`, `expense_splits`, `group_member_balances`, `group_member_proportions`, `group_settlements`, `user_balances` |
| Planejamento | `budgets`, `budget_consumption`, `financial_goals`, `goal_contributions`, `goal_progress`, `recurring_rules`, `scheduled_transactions`, `detected_recurrences`, `planned_vs_actual` |
| Análise (views) | `category_monthly_totals`, `monthly_cash_flow`, `net_worth_history` |
| Extratos | `statement_imports`, `statement_entries`, `receipts`, `categorization_rules` |
| Contracheque | `payroll_entries`, `payroll_deductions`, `payroll_entry_totals` |
| Investimentos | `investment_assets`, `investment_transactions` |
| Assinatura | `user_subscriptions`, `user_subscription_details`, `subscription_history`, `user_usage_limits` |
| Operação | `bill_alerts`, `bill_notifications`, `cron_runs`, `financial_services`, `schema_migrations` |

---

## Interface e design

- **Cor sai de token.** Nenhuma cor fixa no código: o CI reprova cor literal e
  também **contraste** abaixo de AA nos dois temas. Modo noturno é requisito, não
  enfeite — tela escrita com cor clara fixa fica perfeita para quem revisa de dia
  e vira retângulo branco na cara de quem usa às 23h.
- **Mobile primeiro.** Layout precisa sobreviver a tela estreita: `grid` sem
  `grid-cols-1` estoura a página, porque a trilha `auto` tem `min-content` como
  piso. Tem teste de overflow.
- **Estados obrigatórios** em cada tela: carregando, vazio, erro e offline. O erro
  precisa chegar **legível** — recusa do banco com texto técnico não serve.
- **Rótulo com eixo de tempo.** Bloco que diz "julho" tem que mostrar julho:
  saldo de hoje sob o rótulo do mês passado não gera erro nenhum e engana.

---

## Segurança

- **Autenticação** Supabase Auth; rotas do dashboard protegidas por middleware.
- **Autorização** RLS em todas as tabelas de usuário (RN012), com teste de
  isolamento.
- **Segredos** `SUPABASE_SERVICE_ROLE_KEY` e `CRON_SECRET` só no servidor, lidos
  dentro do handler. Nada de segredo no bundle do cliente.
- **Comprovantes** em bucket privado.
- **LGPD** dados do próprio usuário; o painel de configurações permite zerar a
  conta, e o plano de apagamento respeita a ordem das dependências.

---

## Qualidade e sustentação

Esta seção é o resultado da HMO-119 (Fase 4).

- **Onze workflows no CI**, quase todos **sem filtro de `paths`** — o `db-verify`
  é filtrado e foi assim que três suítes ficaram paradas em verde por semanas.
- **`build`** roda `tsc --noEmit`, `next build` e o **build da imagem Docker**.
  Antes dele, nenhum workflow compilava o projeto: o único build acontecia na
  Vercel, depois do merge.
- **~50 suítes** de aritmética financeira em Node, mais os testes SQL de
  `database/tests/` em Postgres de verdade.
- **Controle negativo** em várias verificações: um passo que planta o defeito e
  exige reprovação. Verificação que nunca viu vermelho não é verificação.
- **Lint:** 142 warnings, zero erros. Backlog, não bloqueia.

---

## Roadmap

### Entregue

Contas e cartões separados; lançamentos com parcelamento e recorrência; fatura de
cartão sem dupla contagem; grupos com rateio, acerto e arquivamento; orçamento;
metas com aporte; contas previstas e detector de recorrência; fluxo de caixa,
"quanto posso gastar", anomalias e gasto variável; patrimônio líquido;
relatórios; extratos OFX/CSV com comprovantes; categorização automática;
contracheque; notificações push e resumo mensal; PWA instalável com fila offline;
planos e limites; modo noturno por token; CI de build, schema, cor e PWA.

### Próximo

- Zerar o backlog de 142 warnings de lint.
- Fechar o módulo de investimentos (rentabilidade consolidada).
- Fechar a experiência multi-moeda.
- Completar RN009 (recálculo automático da proporção por renda) e RN011
  (aprovação individual da divisão).
- Atualizar `database/README.md`, que ainda descreve as migrations até a `012`.

### Backlog

Open banking; imposto de renda; metas compartilhadas em grupo; relatório anual.
