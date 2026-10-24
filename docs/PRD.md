# PRD — Pulo do Gato

## Product Requirements Document

> **Documento de referência do produto.** Descreve o que o Pulo do Gato é, as
> regras de negócio que valem, e o que ainda é requisito não implementado.

**Versão:** 2.6
**Data:** 24 de outubro de 2026
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
| 2.1 | 23/10/2026 | **Modelo novo das movimentações** (RN016 a RN021); regras antigas marcadas com a fase em que saem | Helio (decisões D1 a D5) |
| 2.2 | 23/10/2026 | Fases 2 a 4 implantadas: fechamento do grupo, acerto que dá baixa e a leitura nova nos totais (RN018.13 e RN018.14 novas) | Helio (decisões D1 a D5) |
| 2.3 | 23/10/2026 | Fase 5, primeira parte: divisão com pessoa pelo lançamento (RN020, com RN020.6 e RN020.7 novas). O acerto da RN019 fica só para o grupo | Helio (decisões D1 a D5) |
| 2.4 | 23/10/2026 | Fase 5, segunda parte: MyBank (RN021, com RN021.6 nova). Só os juros entram no Resultado, e o empréstimo a si mesmo sai de Despesas | Helio (decisões D1 a D5) |
| 2.5 | 24/10/2026 | Fase 6: o cartão pela fatura (RN017.3 e RN017.4). A fatura paga conta no mês do vencimento, pelo total das compras, e a compra e o estorno no cartão saem do Resultado. Conclui o modelo novo | Helio (decisões D1 a D5) |
| 2.6 | 24/10/2026 | RN004.4 nova: o cartão só recebe dinheiro pelo pagamento da fatura. A transferência avulsa ou mensal para um cartão é recusada | Helio |
| 2.7 | 24/10/2026 | RN018.7 e RN018.13 reescritas, RN018.15 e RN019.6 novas: a conta do grupo que fecha aparece para os outros membros só na estimativa, no mês do fechamento; a aba Despesas mostra "Despesas do Grupo {nome}" com o detalhe por despesa, e os Pix do acerto com copia e cola | Helio |

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

Desde a fase 6 (RN017.4), a fatura total é a despesa, no mês do vencimento, e
as compras viram o detalhe dela.

### Grupos de despesa ✅

Criação de grupo, convites, membros, rateio por lançamento, saldo entre membros,
acerto de contas, arquivamento e regras de saída. Divisão igual, por percentual e
proporcional à renda (tabela `group_member_proportions`).

Desde as fases 2 a 4 (RN018 e RN019), o grupo pode ter dia de fechamento: o
fechamento gera para cada membro uma conta a pagar ou a receber, e é ela que
conta no Resultado de cada um. O grupo sem dia de fechamento continua pelo
rateio de cada lançamento.

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

> **Modelo novo das movimentações (v2.1).** As RN016 a RN021, no fim desta
> seção, dizem como cada movimentação entra no Saldo de contas e no Resultado do
> mês. Elas são requisito (📋) e entram em seis fases, um PR por fase:
>
> 1. estas regras;
> 2. fechamento do grupo;
> 3. acerto que dá baixa;
> 4. a leitura nova nos totais;
> 5. divisão com pessoa e MyBank;
> 6. cartão pela fatura.
>
> Até a fase dela, cada regra antiga continua valendo. As que saem estão
> marcadas com ↪, com a regra nova e a fase em que são substituídas.

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
  ↪ Substituída pela RN017.4 desde a fase 6: o pagamento continua com duas
  pernas para o saldo, mas a fatura total é a despesa, e as compras deixaram
  de contar sozinhas.
- RN004.3 Detectar "é fatura" pelo tipo de conta é proibido: isso apagaria a
  despesa de toda assinatura lançada no cartão.
- RN004.4 As contas de uma fatura só se pagam pelo **pagamento da fatura**: o
  cartão de crédito não é destino de transferência avulsa nem de transferência
  mensal, e a baixa de uma transferência prevista para um cartão é recusada.
  Pagar antes do vencimento, ou um valor diferente do total, continua pelo
  «Pagar» da fatura.

### RN005 — Parcelamento ✅

- RN005.1 Uma compra em N parcelas gera N lançamentos previstos.
- RN005.2 A soma das parcelas é igual ao total, **em centavos** — a sobra do
  arredondamento é distribuída, não descartada.

### RN006 — Recorrência e contas previstas ✅

- RN006.1 Regra de recorrência gera a próxima ocorrência; a data é decidida em
  TypeScript, o banco só garante que a **mesma** data não duplica (índice único).
- RN006.2 Detector de recorrência sugere assinaturas a partir do histórico.
- RN006.3 Uma conta prevista em aberto pode ser **vinculada a um lançamento que
  já existe** ("Já lancei"): ela fica paga, com a data do lançamento, e o
  lançamento não muda. Só lançamento do mesmo dono, na mesma direção, sem outro
  vínculo e até 31 dias do vencimento. Fatura de cartão e transferência ficam
  de fora (continuam pelo pagar).
- RN006.4 Ao lançar, se o lançamento parece pagar uma prevista do mesmo dono
  (valor ±1%, vencimento ±7 dias, mesma categoria ou descrição), o app
  **pergunta**. Nenhum vínculo é criado sem confirmação.
- RN006.5 Excluir o lançamento vinculado devolve a prevista para pendente
  (migration 065).
- RN006.6 Conta prevista de grupo que o dono já quitou sai da **Previsão** do
  painel de todos os membros: a parte de cada um já está no Realizado pelo
  rateio. O que o membro ainda deve ao dono continua no «A pagar» da agenda.
  ↪ Substituída pela RN018 na fase 4: a parte de cada membro deixa de entrar
  no Realizado pelo rateio, e o que ele deve vira a conta do fechamento.

### RN007 — Divisão de despesa em grupo ✅ **(banco)**

> ↪ A partir da fase 4, a divisão de cada lançamento (RN007.2 a RN007.5) deixa
> de ser o que conta no Resultado de cada membro. O que conta é o fechamento do
> período (RN018). RN007.1, RN007.6, RN007.7 e RN007.9 continuam, e a RN007.8
> foi substituída pela RN020 na fase 5.

- RN007.1 Só **despesa** é divisível.
- RN007.2 A divisão é feita pelo **banco**, por trigger, no momento do
  lançamento. A tela não divide — ela exibe. (São dois triggers gêmeos:
  desligar um não prova nada.)
- RN007.3 O rateio fecha **em centavos**: a soma das partes é exatamente o total.
- RN007.4 Percentuais de divisão somam 100%.
- RN007.5 Editar uma despesa de grupo **refaz** a divisão.
- RN007.6 Membro inativo não entra na divisão automática.
- RN007.7 Apagar grupo **arquiva**; não remove histórico de dinheiro.
- RN007.8 **Divisão com pessoa** (sem grupo) continua disponível mesmo entre
  quem tem grupo em comum — a família divide umas contas entre os três e outras
  só em par. A parte recebida aparece para quem a recebe ("Pago por <nome>",
  "Dividido com você") e entra no realizado dele pelo mesmo caminho da parte de
  grupo (`group_share_entries`, migration 066). Quem pagou segue o critério da
  RN do custo pessoal (HMO-258): conta o valor inteiro.
  ↪ Substituída pela RN020 na fase 5 (migration 070): a parte do outro vira
  uma conta a pagar e uma a receber, no lançamento, e a perna de pessoa da 066
  saiu.
- RN007.9 Uma despesa nunca entra pelas duas divisões: com `group_id`, só a
  parte de grupo conta.

### RN008 — Acerto do grupo ✅ **(banco)**

- RN008.1 O saldo entre membros diz quem deve a quem.
- RN008.2 O acerto é registrado com o sinal correto para cada lado.

↪ Substituída pela RN019 na fase 3: o acerto passa a dar baixa, nos dois lados,
nas contas que o fechamento gerou.

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

### RN016 — Saldo de contas e Resultado do mês ✅ **(tela)** — fases 4 e 6

- RN016.1 **Saldo de contas** = saldo inicial da conta + receitas realizadas +
  despesas realizadas (com o sinal da RN002), somado nas contas que entram nos
  totais (migration 058). É o `current_balance` mantido por trigger, e não
  muda.
- RN016.1.1 No painel, o tile **Saldo em conta** soma só as contas que guardam
  dinheiro: o **cartão de crédito fica de fora**. O cartão pesa no saldo quando
  a fatura é paga, pela saída da conta que pagou (RN004.4, RN017.4). O tile
  mostra o saldo no começo do período, as entradas realizadas e as saídas
  pagas até hoje, e o saldo no fim (ou hoje, se o fim ainda não chegou). O
  saldo no fim de um mês é o saldo do começo do mês seguinte. Lançamento com
  data futura não conta. A lista de contas do painel continua mostrando o
  cartão com a dívida dele (`lib/saldo-em-conta.ts`).
- RN016.2 **Resultado do mês** = Total de Receitas − Total de Despesas do mês,
  com a composição da RN017.
- RN016.3 Cada movimentação entra no mês da sua data: a data do lançamento
  quando realizada, a do vencimento quando prevista (a fatura segue a
  RN017.4). O Resultado tem duas
  leituras: **realizado** (só o que já foi pago ou recebido) e **previsto** (o
  realizado mais as contas em aberto do mês).
- RN016.4 Há uma definição só. Painel, relatórios, Finanças Pessoais e agenda
  leem o mesmo Resultado. Duas definições em dois lugares foram a origem dos
  defeitos de outubro de 2026.
- RN016.5 Transferência entre contas próprias, aporte e resgate de
  investimento e o principal do MyBank não entram em nenhum dos dois totais
  (RN003.3, RN021.2).
- RN016.6 Conta marcada fora dos totais (058) aparece na lista e não soma.

### RN017 — O que é Despesa e o que é Receita ✅ — fases 4 a 6

Na fase 4 entraram o pagamento a grupo e o a receber de grupos, na fase 5 o
pagamento a pessoa e o a receber de pessoas (RN020) e os juros do MyBank
(RN021), e na fase 6 a fatura do cartão (migration 072).

- RN017.1 **Despesas** = gastos fixos + gastos aleatórios + fatura do cartão +
  pagamento a grupo + pagamento a pessoa, mais os juros do MyBank de quem pegou
  o empréstimo (RN021.3).
- RN017.2 **Gasto fixo** é a despesa que veio de recorrência ou de conta
  prevista (RN006). **Gasto aleatório** é o resto. Não há marcação manual. Uma
  conta de grupo paga por mim entra aqui, como fixo ou aleatório, pelo valor
  inteiro (RN018.1).
- RN017.3 **Compra no cartão**, à vista ou parcelada, não entra sozinha em
  Despesas. Ela é uma linha da fatura do ciclo em que cai. O **estorno** no
  cartão também é linha da fatura: ele abate a fatura e não é Receita.
- RN017.4 **Fatura do cartão**: a fatura total é a despesa, no mês do
  vencimento (decisão D1). Ela é prevista pelo total enquanto está em aberto e
  realizada quando a conta a pagar dela é paga, pelo total das linhas que
  contam nos totais (RN016.6): pagar um valor diferente não muda a despesa, e
  a diferença fica no saldo do cartão. Pagar antes ou depois do vencimento não
  muda o mês. O pagamento continua com duas pernas para o saldo (RN003.1) e
  aparece em Transferências. Os relatórios por categoria abrem a fatura nas
  compras dela, e a soma por categoria fecha com a fatura. O painel do grupo
  continua contando a compra no mês em que ela foi feita: quem divide a conta
  não paga a fatura do cartão de ninguém.
- RN017.5 **Receitas** = salários (o líquido do contracheque) + a receber de
  grupos + a receber de pessoas + outras receitas, mais os juros do MyBank de
  quem emprestou (RN021.3).
- RN017.6 O que um grupo ou uma pessoa me deve é receita desde que a conta a
  receber existe (RN018.5, RN020.2): prevista até ser quitada, realizada na
  quitação (o acerto, no grupo; a baixa, na pessoa). A conta vira realizada quando o acerto a quita inteira, e conta no
  mês do vencimento dela, que é o dia do fechamento (decisão D3, RN018.10).
  Acerto parcial aparece no Saldo de contas pela transferência, e a conta
  continua prevista pelo valor inteiro até a quitação.

### RN018 — Grupo: o fechamento ✅ **(banco)** — fases 2 e 4

- RN018.1 Qualquer membro ativo lança uma conta no grupo. Ela é despesa de quem
  pagou, pelo valor inteiro, porque saiu da conta dele.
- RN018.2 A configuração do grupo guarda o **% de responsabilidade** de cada
  membro ativo e o **dia de fechamento**, de 1 a 28. Os % somam 100% e podem
  ser iguais, definidos à mão ou proporcionais à renda (RN009).
- RN018.3 O período vai do dia seguinte ao fechamento anterior até o dia de
  fechamento, inclusive. A conta entra no período da sua data; se esse período
  já fechou, ela entra no próximo fechamento. O primeiro fechamento inclui toda
  conta do grupo ainda não fechada, inclusive as lançadas antes da fase 2.
  Conta prevista do grupo entra quando é paga: o que ainda não saiu do bolso de
  ninguém no dia do fechamento fica para o fechamento seguinte.
- RN018.4 No fechamento, para cada membro: responsabilidade = total do período
  × %, e saldo = o que ele pagou no período − a responsabilidade. A soma das
  responsabilidades é exatamente o total, em centavos (a sobra do
  arredondamento é distribuída, não descartada), e a soma dos saldos é zero.
- RN018.5 Saldo negativo gera uma conta prevista **"Pagamento ao grupo"**
  (despesa). Saldo positivo gera uma **"A receber do grupo"** (receita). As
  duas vencem no dia do fechamento (decisão D3). Saldo zero não gera conta.
- RN018.6 Um período fecha uma vez só: o banco impede gerar duas vezes o
  fechamento do mesmo grupo e período. Período fechado não reabre. Mudar o %
  ou o dia de fechamento vale a partir do próximo período.
- RN018.7 Antes do fechamento, o saldo estimado do membro no período aparece
  como **previsto** no painel, a pagar ou a receber, sem gerar conta (decisão
  D2). A estimativa vence no dia do fechamento e conta a conta prevista do
  grupo ainda não paga como paga por quem a lançou, na data do vencimento.
  Cada fechamento tem a sua estimativa, no mês dele: a conta que vence depois
  do fechamento do mês entra na estimativa do fechamento seguinte.
- RN018.8 O fechamento roda sozinho, por cron diário, no dia de fechamento de
  cada grupo (RN015).
- RN018.9 Membro não conta como despesa a parte de uma conta que não pagou. O
  que ele deve entra pelo "Pagamento ao grupo" do fechamento.
- RN018.10 Quando o período não coincide com o mês do calendário, a despesa
  paga e a conta gerada podem cair em meses diferentes. A soma dos meses fecha
  na responsabilidade.
- RN018.11 Acerto registrado sem conta gerada (o acerto de antes da fase 3)
  entra no fechamento do período dele: soma no que pagou quem mandou o dinheiro
  e desconta de quem recebeu. Sem isso, um acerto já feito seria cobrado de novo
  pela conta do fechamento.
- RN018.12 Conta gerada pelo fechamento não muda de valor, de tipo nem de dono
  depois de criada. O que muda nela é só a baixa.
- RN018.13 Conta prevista do grupo que fecha, ainda não paga, entra no previsto
  de quem a lançou pelo valor inteiro, no mês do vencimento dela. Para os
  outros membros ela não aparece no mês do vencimento: entra na estimativa do
  fechamento (RN018.7), no mês do fechamento, como previsto. Do lado de quem a
  lançou, a parte dos outros entra na estimativa a receber. Não há reembolso
  previsto nem "Paguei minha parte" nesse grupo: o que cada um deve sai do
  fechamento.
- RN018.14 Só o grupo com dia de fechamento segue esta regra. O grupo sem dia
  de fechamento continua pelo rateio de cada lançamento (RN007), e tirar o dia
  de fechamento não devolve ao rateio o que já entrou num fechamento.
- RN018.15 Na aba Despesas, a conta de grupo que outro membro lançou aparece
  numa linha só por grupo, **"Despesas do Grupo {nome}"**, com o total. O
  chevron abre o detalhe: cada despesa com a data, quem lançou, o valor cheio
  e a minha parte, e o que eu já paguei abatido; o detalhe soma o total. O
  nome leva à tela do grupo. No grupo que fecha, a linha é a estimativa
  (RN018.7), com o selo "previsto até o fechamento de DD/MM", e depois do
  fechamento é o "Pagamento ao grupo", com o mesmo detalhe. No grupo sem dia
  de fechamento, é uma linha por grupo e por mês, pela minha parte de cada
  conta. Os totais da aba não mudam: a linha do grupo é a soma das linhas que
  ela junta.

Exemplo: grupo Casa, % de 50/30/20, R$ 2.000 de contas no período.

| Membro | % | Pagou | Responsabilidade | Fechamento gera | Resultado |
| ------ | - | ----- | ---------------- | --------------- | --------- |
| Helio | 50% | R$ 1.500 | R$ 1.000 | A receber R$ 500 | −R$ 1.000 |
| Lais | 30% | R$ 500 | R$ 600 | Pagamento R$ 100 | −R$ 600 |
| Letícia | 20% | R$ 0 | R$ 400 | Pagamento R$ 400 | −R$ 400 |

O Resultado de cada um fecha na responsabilidade, e a soma dá os R$ 2.000.

### RN019 — Acerto ✅ **(banco)** — fase 3

- RN019.1 O acerto (o Pix entre duas pessoas) **quita** contas geradas pelo
  fechamento do grupo (RN018): a conta a pagar de quem pagou e a conta a
  receber de quem recebeu. A conta da divisão com pessoa não passa pelo acerto:
  cada lado a quita com a baixa de sempre (RN020.6).
- RN019.2 Ele não é receita nem despesa nova. O valor acertado é a realização
  das contas que já existiam.
- RN019.3 Registrado por um lado, ele dá baixa nos dois, numa operação só do
  banco (função `SECURITY DEFINER`). A tela nunca grava os dois lados em duas
  chamadas.
- RN019.4 Acerto parcial quita o valor acertado, e o resto continua em aberto.
- RN019.5 No grupo, o acerto é entre dois membros: quem deve paga a quem tem a
  receber. A tela sugere os pares, como o fechamento mensal de hoje (HMO-245).
- RN019.6 Debaixo do "Pagamento ao grupo" em aberto, a aba Despesas mostra os
  Pix que o quitam, que são os pares da RN019.5 em que eu pago: "Transferir
  R$ 250,00 para Helio". O botão ao lado copia o Pix copia e cola (BR Code)
  com a chave de quem recebe e o valor, para colar no app do banco. Sem chave
  cadastrada, o botão copia só o valor e a linha diz que a pessoa não
  cadastrou chave Pix. O acerto continua sendo registrado na tela do grupo. O
  painel "Pra quem pagar" do grupo sem dia de fechamento ganha o mesmo botão.

### RN020 — Divisão com pessoa ✅ **(banco)** — fase 5

- RN020.1 Uma despesa sem grupo pode ser dividida com uma conexão aceita
  (RN010.1). Ela funciona como um grupo de duas pessoas, sem período.
- RN020.2 Ela fecha no lançamento (decisão D4). Quem pagou conta a despesa
  inteira e ganha uma **"A receber de <pessoa>"** (receita) pela parte do
  outro. O outro ganha uma **"Pagamento a <pessoa>"** (despesa) do mesmo valor.
  As duas vencem na data do lançamento.
- RN020.3 Editar o valor, a data ou a parte refaz as duas contas, e apagar o
  lançamento, tirar a pessoa da divisão ou a pessoa recusar a parte remove as
  duas. Conta já quitada não é refeita em silêncio: se um dos lados já deu
  baixa, o banco recusa a mudança até a baixa ser desfeita. A conta da divisão
  não se edita nem se apaga pela agenda, só pelo lançamento.
- RN020.4 Uma despesa nunca entra pelas duas divisões: com grupo, vale só o
  fechamento do grupo (RN007.9).
- RN020.5 Exemplo: a Lais pagou R$ 79,86 e dividiu 90% com o Helio. A Lais fica
  com despesa de R$ 79,86 e a receber de R$ 71,87, e o Resultado dela é
  −R$ 7,99. O Helio fica com um pagamento a pessoa de R$ 71,87.
- RN020.6 Cada lado quita a própria conta com a baixa de sempre: Pagar ou
  Receber, ou "Já lancei" quando o Pix já está lançado. Quitar um lado não
  quita o outro. A conta a receber nasce na conta de onde saiu a despesa,
  quando ela não é cartão, e a conta a pagar na primeira conta corrente ativa
  do outro. Ninguém escolhe conta de outra pessoa.
- RN020.7 Despesa em outra moeda divide pelo valor convertido na cotação do
  lançamento, e as duas contas são em reais.

### RN021 — MyBank ✅ **(banco)** — fase 5

- RN021.1 O empréstimo sai de uma conta de investimento, para o próprio
  usuário ou para uma conexão aceita, com parcelas e juros opcionais
  (migrations 053 e 062).
- RN021.2 Emprestar não é gastar, e receber de volta não é ganhar. A saída e o
  principal de cada parcela são transferência, nos dois lados.
- RN021.3 Só os **juros** entram no Resultado: receita de quem emprestou e
  despesa de quem pegou (decisão D5). O juro de cada parcela sai do rateio da
  série inteira, o mesmo que a confirmação usa para gravar a perna de juro de
  quem emprestou. Em aberto, ele é previsto no vencimento da parcela. Pago, ele
  é realizado na data do pagamento, com o valor gravado na baixa: ajustar uma
  parcela depois não muda o juro de uma que já foi paga (migration 071).
- RN021.4 No empréstimo a si mesmo nada entra no Resultado, nem os juros,
  porque o dinheiro não sai de casa. A parcela fica só em Transferências, com o
  selo MyBank, prevista e paga.
- RN021.5 As parcelas aparecem na agenda: a pagar para quem pegou, a receber
  para quem emprestou.
- RN021.6 Contas a Pagar e o "Quanto ainda posso gastar" continuam com a
  parcela cheia, porque lá a pergunta é quanto sai da conta. A aba Despesas de
  quem pegou mostra só o juro ("Juros: Moto (3/24)"), e a aba Receitas de quem
  emprestou soma só o juro a receber.

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
planos e limites; modo noturno por token; CI de build, schema, cor e PWA; o
modelo novo das movimentações (RN016 a RN021), com um Resultado do mês só e o
cartão pela fatura.

### Próximo

- Zerar o backlog de 142 warnings de lint.
- Fechar o módulo de investimentos (rentabilidade consolidada).
- Fechar a experiência multi-moeda.
- Completar RN009 (recálculo automático da proporção por renda) e RN011
  (aprovação individual da divisão).
- Atualizar `database/README.md`, que ainda descreve as migrations até a `012`.

### Backlog

Open banking; imposto de renda; metas compartilhadas em grupo; relatório anual.
