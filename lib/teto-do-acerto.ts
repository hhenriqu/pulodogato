/**
 * O ACERTO REGISTRADO VIRA TETO DO CREDITO A RECEBER (HMO-404, item 1).
 *
 * Medido em producao na HMO-367 (`scripts/medicao-hmo367-duas-leituras.mjs`,
 * 12/10/2026, fixture HMO-255): o C pagou os R$ 240,00 que devia a A pela
 * propria sugestao da tela, a tela do grupo passou a dizer "nada a receber"
 * (`group_member_balances` neta acertos) e a aba Receitas continuou prometendo
 * R$ 39,99 a receber do MESMO C -- em outubro, o mes do acerto, E em setembro.
 * No mesmo corpo de resposta a mesma divida aparecia como *recebida* no bloco da
 * HMO-366 e como *a receber* no «Previsto».
 *
 * O CRITERIO, E ELE NAO E UMA SUBTRACAO
 * -------------------------------------
 *   teto(g, devedor)    = max(0, acumulado(g, devedor) - acertos_recebidos(g, devedor))
 *   credito_do_periodo  = min(credito_do_periodo_de_hoje, teto(g, devedor))
 *
 * O acumulado sai da aritmetica do proprio `fecharMes` sobre TODOS os meses do
 * grupo (previsto + realizado, a mistura que a HMO-245 pediu), e os acertos saem
 * de `group_settlements` por PAR. Nada aqui muda `fecharMes`, `divisaoDoPeriodo`
 * nem `creditoAReceber` -- cada uma tem teste e mutantes proprios.
 *
 * AS TRES ALTERNATIVAS REPROVADAS, COM O NUMERO QUE AS REPROVOU
 * ------------------------------------------------------------
 * 1. SUBTRAIR O ACERTO DENTRO DO MES: `39,99 - 240,00 = -200,01`. Os dois nao
 *    sao a mesma grandeza -- o C deve 40/mes desde maio e o acerto de 240 quita
 *    SEIS meses de uma vez. Prender em zero com `Math.max` zeraria outubro por
 *    um pagamento que cobre maio, e nao ha como ratear: `group_settlements` tem
 *    UM `settled_on` e nenhum elo com a despesa nem com o mes.
 * 2. FAZER A ABA RECEITAS RESPONDER A PERGUNTA DA TELA DO GRUPO (acumulado, so
 *    realizado) apaga a feature da HMO-364: o «Previsto» promete o reembolso
 *    PREVISTO do periodo, e a simetria e exata -- a despesa correspondente esta
 *    no «Previsto» da aba Despesas pelo valor bruto.
 * 3. USAR `group_member_balances.net_balance` COMO TETO: a view e SO REALIZADO.
 *    Um grupo cuja divida e inteiramente prevista tem `net_balance = 0`, e o
 *    teto zeraria credito previsto legitimo -- matando o caso da internet do C6,
 *    que e a razao de a feature existir. O teto sai do `fecharMes`; so os
 *    acertos vem da tabela.
 *
 * O GRUPO SEM ACERTO NENHUM NAO PODE MUDAR, E ISSO E ESTRUTURAL
 * ------------------------------------------------------------
 * Sem acerto, `acertos_recebidos = 0`, entao `teto = acumulado`. E o acumulado
 * soma TODOS os meses do grupo, incluindo os do periodo pedido: logo
 * `teto >= credito_do_periodo` e o `min` e no-op. A suite mede isso de qualquer
 * forma -- "e estruturalmente impossivel" ja foi dito neste projeto sobre
 * defeito que existia.
 *
 * EXATO PARA O PERIODO INTEIRO, APROXIMADO PARA UM SUB-PERIODO
 * -----------------------------------------------------------
 * O C deve 40 realizado em setembro e 100 previsto em outubro, e paga 40:
 * acumulado 140, teto 100. Setembro + outubro da 100 (exato); SETEMBRO SOZINHO
 * continua 40, embora aquele mes tenha sido pago. Isso e inevitavel com os dados
 * de hoje -- nada liga um acerto ao mes que ele quita. O conserto exato e um elo
 * explicito acerto <-> divida (a forma do elo da fatura da HMO-305): migration,
 * fase propria, issue propria.
 */

import { toCents, toReais } from "@/lib/settlement";
import type { CreditoAReceber, CreditoDeGrupo } from "@/lib/credito-de-grupo";

/**
 * Uma linha de `group_settlements` como a setima consulta a devolve.
 *
 * `amount` e `exchange_rate` sao `numeric` -- chegam como STRING no JSON do
 * PostgREST. Tipar como `number` deixaria o `tsc` verde e faria a multiplicacao
 * virar concatenacao, que e um teto gigante (e portanto um `min` no-op): o
 * defeito da issue de volta, sem nenhum erro.
 */
export interface AcertoRecebidoCru {
  group_id: string;
  /** Quem PAGOU -- e o devedor da linha do credito. */
  from_user_id: string;
  amount: number | string;
  /** A cotacao congelada em `settled_on` (026). 1, ou nula, em real. */
  exchange_rate: number | string | null;
}

/**
 * A chave do par (grupo, devedor), que e o que identifica uma linha do credito.
 *
 * `\0` e nao `:` ou `-`, pelo mesmo motivo de `creditoAReceber`: uuid nao contem
 * o byte nulo, e um separador que possa aparecer dentro de um id junta duas
 * linhas diferentes numa. E o ESCAPE, nunca o byte literal no fonte -- um NUL
 * cru faz o git tratar o arquivo como binario e o grep para de achar qualquer
 * coisa aqui dentro.
 */
export function chaveDoPar(groupId: string, devedorUserId: string): string {
  return `${groupId}\0${devedorUserId}`;
}

/**
 * Quanto cada devedor JA ME PAGOU em cada grupo, em CENTAVOS de real.
 *
 * POR PAR, E NAO POR GRUPO. `group_member_balances.settlements_received`
 * agregaria todos os pagadores num numero so e perderia QUEM pagou -- e a linha
 * do credito e por (grupo, devedor). Num grupo onde o C me pagou e o D nao, o
 * criterio por grupo abateria do D o que o C pagou: o D sairia da tela devendo
 * zero. Com um devedor so os dois criterios EMPATAM, e e por isso que a suite
 * tem fixture de dois.
 *
 * CADA LADO CONVERTE PELA COTACAO CONGELADA DELE, os dois em BRL -- igual ao que
 * a view ja faz. `amount * exchange_rate` e nao a cotacao de hoje: o acerto de
 * US$ 50 pago em marco vale o que valia em marco, e usar a de hoje faria o teto
 * (e portanto o credito) mudar sozinho todo dia.
 *
 * Valor que nao e numero positivo nao entra: `numeric` chega como string e
 * `Number("")` e 0 -- nao `NaN`, entao nenhum `isNaN` o pegaria.
 */
export function acertosRecebidosPorDevedor(
  acertos: readonly AcertoRecebidoCru[]
): Map<string, number> {
  const porPar = new Map<string, number>();

  for (const acerto of acertos ?? []) {
    if (!acerto?.group_id || !acerto.from_user_id) continue;

    const valor = Number(acerto.amount);
    if (!Number.isFinite(valor) || valor <= 0) continue;

    // `|| 1` cobre `null`, `0` e `""`: cotacao zero zeraria o acerto, e um
    // acerto que vale zero e um teto que nao abate nada.
    const cotacao = Number(acerto.exchange_rate ?? 1) || 1;

    const chave = chaveDoPar(acerto.group_id, acerto.from_user_id);
    porPar.set(chave, (porPar.get(chave) ?? 0) + toCents(valor * cotacao));
  }

  return porPar;
}

/**
 * O credito do periodo com o teto do acerto aplicado LINHA POR LINHA.
 *
 * O TETO NAO VAI NO TOTAL. O total continua sendo a soma das linhas -- criterio
 * da HMO-275, e `sem_devedor` existe justamente para a diferenca nao
 * desaparecer calada. Um teto aplicado ao total deixaria o numero grande
 * diferente da soma dos nomes que a pessoa consegue apontar na tela, e a unica
 * forma de descobrir a diferenca seria somar a lista a mao.
 *
 * LINHA QUE CHEGA A ZERO SAI DA LISTA, e nao fica como R$ 0,00. "O C te deve
 * R$ 0,00" embaixo de "A receber dos grupos: R$ 0,00" e ruido que parece recurso
 * quebrado -- a mesma escolha que faz o bloco inteiro desaparecer quando nao ha
 * credito nenhum (ver `notaDoCreditoAReceber`).
 *
 * A ORDEM E RECALCULADA, e nao herdada. `creditoAReceber` devolve do maior para
 * o menor, e o teto muda as grandezas: uma linha de R$ 100 presa em R$ 10 tem de
 * cair para baixo da linha de R$ 50 que ninguem pagou. Sem reordenar, a tela
 * lista R$ 10,00 acima de R$ 50,00 sem nada ter mudado nos dados. Os desempates
 * sao os mesmos de `creditoAReceber` de proposito -- duas telas da mesma lista
 * em ordens diferentes se leem como dado diferente.
 *
 * `sem_devedor` passa INTACTO: ele e o residuo do meu saldo sem devedor nomeado
 * (o centavo de tolerancia de `simplifySettlements`), e o teto e por
 * (grupo, devedor) -- nao ha par a que prende-lo. Inventar um rateio dele aqui
 * seria aritmetica sem oraculo sobre um valor de centavos.
 */
export function aplicarTetoDoAcerto(params: {
  /** O credito dos meses pedidos -- o que a tela mostraria sem o teto. */
  doPeriodo: CreditoAReceber;
  /** O MESMO calculo sobre todos os meses do grupo. */
  acumulado: CreditoAReceber;
  /** A saida de `acertosRecebidosPorDevedor`, em centavos. */
  acertos: ReadonlyMap<string, number>;
}): CreditoAReceber {
  const { doPeriodo, acumulado, acertos } = params;

  const acumuladoPorPar = new Map<string, number>();
  for (const linha of acumulado.linhas) {
    const chave = chaveDoPar(linha.group_id, linha.devedor_user_id);
    acumuladoPorPar.set(
      chave,
      (acumuladoPorPar.get(chave) ?? 0) + toCents(linha.valor)
    );
  }

  const presas: (CreditoDeGrupo & { cents: number })[] = [];

  for (const linha of doPeriodo.linhas) {
    const chave = chaveDoPar(linha.group_id, linha.devedor_user_id);

    const tetoCents = Math.max(
      0,
      (acumuladoPorPar.get(chave) ?? 0) - (acertos.get(chave) ?? 0)
    );

    const cents = Math.min(toCents(linha.valor), tetoCents);
    if (cents <= 0) continue;

    presas.push({ ...linha, cents, valor: toReais(cents) });
  }

  const linhas = presas
    .sort(
      (a, b) =>
        b.cents - a.cents ||
        a.grupo.localeCompare(b.grupo) ||
        a.devedor_user_id.localeCompare(b.devedor_user_id)
    )
    .map(({ cents, ...linha }) => linha);

  const totalCents = presas.reduce((soma, l) => soma + l.cents, 0);

  return {
    linhas,
    total: toReais(totalCents),
    sem_devedor: doPeriodo.sem_devedor,
  };
}
