# Assinaturas: quanto custam, quanto pesam e o detalhe de cada uma

Spec escrita no formato `to-spec` (skills de engenharia do Matt Pocock), a
partir do pedido do Helio em 22/11/2026: "uma melhor maneira de apontar pro
usuário suas assinaturas, o quanto isso significa do orçamento e a lista de
visualização de cada uma delas. Já temos isso, mas precisamos melhorar a
experiência do usuário".

## Problem Statement

A tela de Assinaturas (`/dashboard/recurrences`) já soma o total mensal, mas
mostra as assinaturas em dois blocos separados que não conversam: as contas
fixas marcadas como assinatura (migration 084) num cartão e as cobranças
detectadas no extrato numa lista à parte, misturadas com as já canceladas e
com as que repetem uma conta fixa. A pessoa vê um número solto ("R$ 312,40 por
mês") sem saber se isso é muito ou pouco para ela, não vê o custo no ano, não
sabe qual assinatura pesa mais no total e não distingue o que ainda precisa
revisar do que já está decidido.

## Solution

A tela passa a responder, de cima para baixo, três perguntas:

1. **Quanto eu gasto com assinaturas?** Total por mês em destaque, o custo no
   ano e quantas assinaturas são.
2. **Quanto isso pesa no meu orçamento?** O total como porcentagem da renda
   mensal fixa (as receitas fixas ativas que a pessoa cadastrou), com uma barra
   e uma faixa: até 5% "Leve", até 10% "Atenção", acima disso "Pesado". Sem
   renda fixa cadastrada, a tela diz isso e leva para Receitas, em vez de
   mostrar 0% ou esconder o bloco.
3. **Quais são e quanto cada uma custa?** Uma lista única, da mais cara para a
   mais barata, com contas fixas marcadas e cobranças do extrato juntas. Cada
   linha mostra o nome, de onde veio (conta fixa ou extrato), a frequência, o
   valor da cobrança, o custo por mês, o custo por ano, a fatia do total
   (porcentagem e barra) e a data (vencimento, próxima e última cobrança). As
   detectadas ainda não confirmadas levam a marca "Para revisar", e um filtro
   mostra só elas.

O que não entra na soma (canceladas, ignoradas e detectadas que repetem uma
conta fixa) sai da lista principal e vai para "Fora da conta", com o motivo de
cada uma e o botão para voltar atrás.

## User Stories

1. Como pessoa usuária, quero ver o total que gasto por mês com assinaturas logo no topo, para saber o tamanho do problema.
2. Como pessoa usuária, quero ver o custo anual das assinaturas, para perceber o quanto elas somam no ano.
3. Como pessoa usuária, quero ver quantas assinaturas tenho, para saber se perdi alguma de vista.
4. Como pessoa usuária, quero ver quanto as assinaturas representam da minha renda mensal, para saber se o valor é alto para o meu orçamento.
5. Como pessoa usuária, quero uma indicação simples (leve, atenção, pesado), para não ter de interpretar a porcentagem sozinha.
6. Como pessoa usuária sem renda fixa cadastrada, quero ser avisada disso e levada até Receitas, para conseguir ver a porcentagem.
7. Como pessoa usuária, quero que a porcentagem não apareça quando a renda não pôde ser lida, para não tomar decisão com um número errado.
8. Como pessoa usuária, quero uma lista única com todas as minhas assinaturas, sem precisar juntar dois blocos de cabeça.
9. Como pessoa usuária, quero a lista da mais cara para a mais barata, para decidir o que cancelar primeiro.
10. Como pessoa usuária, quero ver de onde veio cada assinatura (conta fixa ou extrato), para saber onde mexer nela.
11. Como pessoa usuária, quero ver o custo mensal e anual de cada assinatura, para comparar uma anual com uma mensal.
12. Como pessoa usuária, quero ver a fatia de cada assinatura no total, para enxergar qual pesa mais.
13. Como pessoa usuária, quero ver quando vence ou quando será a próxima cobrança, para cancelar antes dela.
14. Como pessoa usuária, quero ver quais detectadas ainda preciso revisar, para confirmar ou ignorar.
15. Como pessoa usuária, quero filtrar só as que estão para revisar, para resolver todas de uma vez.
16. Como pessoa usuária, quero confirmar, ignorar ou marcar como cancelada uma detectada direto na linha.
17. Como pessoa usuária, quero tirar uma conta fixa de Assinaturas direto na linha.
18. Como pessoa usuária, quero ver separado o que não entra na conta e por quê, para entender a diferença entre a lista e o total.
19. Como pessoa usuária, quero desfazer um "ignorar" ou um "cancelei", para corrigir um clique errado.
20. Como pessoa usuária, quero que uma detectada que repete uma conta fixa não conte duas vezes no total.
21. Como pessoa usuária sem rede, quero continuar vendo a última leitura guardada, sem números inventados.
22. Como pessoa usuária no celular, quero que cada linha caiba na tela sem rolagem lateral.

## Implementation Decisions

- **Um módulo puro novo, o painel de assinaturas.** Recebe as contas fixas
  marcadas (já na forma `AssinaturaDaContaFixa`), as recorrências detectadas
  como vêm da rota, as chaves de lojista que repetem uma conta fixa e a renda
  mensal (`number`, `0` ou `null`). Devolve os itens da lista (já ordenados,
  com custo mensal, anual e participação), o que fica fora da conta (com
  motivo), o total mensal e anual, a contagem para revisar, a porcentagem da
  renda e a faixa. Sem imports de runtime, no padrão de
  `lib/assinaturas-das-contas-fixas.ts`, para o teste compilar só ele.
- **A regra do que soma não muda.** Conta fixa marcada e ativa soma; detectada
  com status `DETECTED` ou `CONFIRMED` soma, menos quando a chave do lojista
  repete uma conta fixa. É a mesma regra de `GET /api/recurrences`, e o total
  do painel bate com o `monthlyTotal` da rota.
- **"Orçamento" é a renda mensal fixa.** As regras de receita ativas da pessoa
  (`recurring_rules` com `transaction_type = 'income'`), normalizadas para o
  mês com a mesma conta de custo mensal das assinaturas. A rota passa a
  devolver `fixedMonthlyIncome` (`null` quando a leitura falha). Os tetos por
  categoria (`budgets`) não servem de denominador: são limites de categorias
  escolhidas, não o orçamento inteiro.
- **Faixas:** até 5% da renda "Leve", acima de 5% até 10% "Atenção", acima de
  10% "Pesado". É uma referência de bolso, explicada numa dica na tela.
- **A tela calcula o painel no cliente**, a partir da resposta da rota. Assim a
  cópia guardada no aparelho (leitura offline) de uma versão anterior da rota
  continua funcionando: sem `fixedMonthlyIncome`, a porcentagem só não aparece.
- **Sem migration.** Tudo sai de colunas que já existem.

## Testing Decisions

- Um bom teste aqui confere comportamento visível pela interface pública do
  módulo (entra lista crua, sai painel), com valores esperados escritos à mão,
  sem recalcular do jeito que o código calcula.
- **Seam único:** a função pura do painel, mais a renda mensal em
  `lib/assinaturas-das-contas-fixas.ts`. A rota e a tela são finas em volta
  dela.
- Prior art: `scripts/test-assinaturas-das-contas-fixas.mjs` (compila o módulo
  e roda `node --test`).

## Out of Scope

- Um bloco de assinaturas no painel inicial (dashboard). A tela inicial tem
  ordem e visibilidade de blocos configuráveis; entra num passo seguinte.
- Marcar como assinatura uma conta fixa fora do cartão a partir desta tela.
- Dividir a assinatura de grupo pela parte de cada membro.

## Further Notes

- A renda considerada é só a fixa cadastrada. Quem recebe por lançamento
  avulso verá o convite para cadastrar a renda fixa.
