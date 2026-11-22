# Composição da fatura e total para quitar os cartões

> Pedido do Helio, 22/11/2026: "Agora preciso saber a composição do meu cartão
> de crédito. Entre o que é gasto recorrente como fixo ou assinatura, e o que
> tenho parcelado e esporádico. Essa composição pode ser mostrada em um gráfico
> de rosca, e embaixo os valores na legenda. Pra mim é importante saber o
> mensal dentro da fatura, mas em uma dashboard nos cartões e no dashboard
> quero ver o mensal e uma aba pra ativar o TOTAL, onde vejo o quanto eu
> precisaria pra QUITAR meus cartões e ficar apenas com o que tem fixo e
> assinaturas (esse não entra no total, exceto o mês atual). E na aba custo de
> vida posso ativar um toggle que soma esse total à reserva de emergência."

Regras na PRD: RN004.12 e RN004.13.

## Onde aparece

| Tela | O que mostra |
| --- | --- |
| Cartão (`/dashboard/cartoes/[id]`) | A rosca da fatura do mês do seletor, logo abaixo do total. Só o mensal. |
| Cartões (`/dashboard/cartoes`) | A rosca de todos os cartões no mês do seletor, com a chave **Mensal / TOTAL**. No TOTAL, a lista de quanto falta em cada cartão. |
| Painel inicial | O bloco "Composição dos cartões" (configurável, como os outros), na fatura do mês corrente, com a mesma chave. |
| Investimentos › Custo de vida | A chave "Somar o total para quitar os cartões", que soma o TOTAL à reserva de emergência sugerida. |

A legenda fica embaixo da rosca, com as quatro fatias sempre (a zerada também,
para a soma fechar com o centro), a porcentagem de cada uma, e duas linhas de
resumo: **Recorrente** (fixo + assinaturas) e **Acaba** (parcelado +
esporádico).

## As quatro fatias

Cada compra da fatura cai em uma só, nesta ordem:

1. **Parcelado**: a compra tem parcela (`installment_total > 1`). A parcela vence
   tudo: uma compra parcelada é dívida que acaba, mesmo que a descrição lembre
   uma conta fixa.
2. **Fixo** ou **Assinatura** pela baixa: a compra é a que uma conta fixa no
   cartão virou no dia dela (`scheduled_transactions.transaction_id`). A marca
   "assinatura" da conta fixa (migration 084) decide entre as duas.
3. **Assinatura** pelo extrato: a compra está numa recorrência que o detector
   achou (detectada ou confirmada, as mesmas que a tela de Assinaturas soma),
   ou tem o lojista dela, ou tem a descrição de uma conta fixa marcada como
   assinatura.
4. **Fixo** pela descrição: a descrição normalizada é a de uma conta fixa de
   despesa ativa — o mesmo critério do Custo de vida, para a compra importada do
   extrato, que não tem baixa.
5. **Esporádico**: o resto. O estorno abate da fatia em que cair, e o ajuste de
   saldo cai aqui.

A cobrança prevista (a conta fixa no cartão antes do dia dela, RN004.5) entra
na fatura do mês dela pela regra: fixo ou assinatura. A avulsa, esporádico.

## Mensal

A fatura do mês: as compras daquele mês de fatura e as cobranças previstas
dele. É o mesmo total previsto que a tela do cartão já mostra ("Com as
cobranças previstas").

## TOTAL para quitar

O quanto seria preciso hoje para zerar os cartões e ficar só com o fixo e as
assinaturas dali em diante:

- a fatura **em aberto** de cada cartão (pelo dia do fechamento) e **todas as
  seguintes**: as parcelas que faltam e a compra feita depois do fechamento;
- as faturas **anteriores ainda não pagas**: a que está pendente na agenda,
  qualquer que seja o mês, e a imediatamente anterior à aberta quando ainda não
  há registro dela (fechou e ninguém fechou nem pagou no app);
- a fatura **paga** nunca entra;
- das cobranças previstas, **só as da fatura em aberto**. O fixo e a assinatura
  dos meses seguintes ainda não são dívida.

### Decisões de leitura

- **Por que não o saldo do cartão.** O saldo (`current_balance`) já é a dívida
  inteira, mas não diz de que ela é feita, e depende de todo pagamento ter sido
  registrado. O total pelas faturas dá a composição e só olha o que está em
  aberto.
- **Fatura antiga sem registro conta como paga.** Senão o histórico importado
  do extrato (meses de compras que foram pagas fora do app) viraria dívida para
  sempre. A exceção é a fatura logo antes da aberta: ela acabou de fechar e
  pode estar esperando o pagamento.
- **Mensal e TOTAL respondem a datas diferentes.** O mensal segue o mês do
  seletor; o TOTAL é sempre o de hoje.
- **O cartão "fora dos totais" não soma** na rosca de todos os cartões, como em
  todo total do app, e a tela diz quantos ficaram de fora.
- **Custo de vida.** Ligada a chave, a reserva sugerida vira os 12 meses de
  custo previsto **mais** o total para quitar os cartões, e "quantos meses a
  carteira cobre" desconta a dívida antes de dividir. A fatura do mês também
  está dentro do custo previsto (pela data da compra), então ligar a chave é
  pedir um colchão com folga, e não uma soma sem sobreposição. A chave começa
  desligada e a escolha fica no navegador.

## Onde está o código

- `lib/composicao-da-fatura.ts`: a regra, sem I/O
  (`npm run test:composicao-da-fatura`).
- `lib/services/composicao-da-fatura.ts`: as leituras.
- `GET /api/card-invoices/composicao?month=AAAA-MM&account_id=`: o mensal e o
  TOTAL por cartão, e a soma dos que entram nos totais.
- `components/cartoes/ComposicaoDosCartoes.tsx`: a rosca, a legenda e a chave.
