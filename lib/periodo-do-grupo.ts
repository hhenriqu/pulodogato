/**
 * O RECORTE DE MES DA ABA DE DESPESAS DO GRUPO (HMO-248).
 *
 * "Adicionei o aluguel como despesa fixa, vence agora dia 10/10, ele esta
 * aparecendo no grupo como previstas, porem no mes atual nao aparece. acredito
 * que no grupo deva aparecer apenas o mes selecionado ou periodo, e nao esse
 * campo Previstas mostrando o fixo de outros meses."
 *
 * POR QUE "PREVISTAS" MOSTRAVA O ALUGUEL DE TRES MESES
 * ---------------------------------------------------
 * Marcar uma despesa como fixa grava uma regra em `recurring_rules` e
 * MATERIALIZA varias parcelas futuras em `scheduled_transactions` -- uma por
 * mes do horizonte. A rota `/scheduled` do grupo lia todas elas
 * (`.neq("status","paid")`, sem recorte de data) e o cartao somava a lista
 * inteira. Um aluguel de R$ 1.800 com tres parcelas materializadas aparecia
 * tres vezes, e a legenda do cartao dizia "Total: R$ 5.400" -- um numero que
 * nao e o aluguel de mes nenhum. Esse era o defeito: nao e que faltasse dado,
 * e que o cartao somava meses diferentes no mesmo total.
 *
 * O MES E RECORTADO POR PREFIXO DE STRING, NAO POR `new Date`
 * -----------------------------------------------------------
 * O recorte antigo do realizado era
 * `new Date(t.transaction_date).getMonth() === new Date().getMonth()`.
 * `transaction_date` e `YYYY-MM-DD`, e `new Date("2026-10-01")` e meia-noite
 * UTC -- que em America/Sao_Paulo e 21:00 de 30/09. A despesa do dia 1 caia no
 * mes ANTERIOR, e so em maquina com fuso negativo: passava em CI (UTC) e errava
 * no celular de quem usa o app. `mesDaData` fatia os sete primeiros caracteres
 * e nao tem fuso. Ver [[teste-de-data-passa-em-utc-e-nao-ve-o-bug]].
 *
 * O QUE SAI DO MES NAO PODE SAIR EM SILENCIO
 * ------------------------------------------
 * Recortar o cartao no mes escondia duas coisas uteis: a parcela VENCIDA de um
 * mes passado e o aluguel do mes que vem. Sumir da tela sem rotulo e
 * indistinguivel de "nao existe" ([[sumido-da-tela-pode-ser-so-indistinguivel]]),
 * e vencida e justamente o que precisa de acao. Por isso `recortarPrevistas`
 * nao devolve so a lista do mes: devolve tambem quantas e quanto ficaram ANTES
 * e DEPOIS, para o cartao dizer em texto que elas existem e em qual direcao
 * trocar o mes.
 *
 * A SOMA E EM CENTAVOS
 * --------------------
 * `0.1 + 0.2` em float e `0.30000000000000004`. Com doze parcelas somadas em
 * reais o total do cartao ganha um centavo de nada -- e este cartao fica ao
 * lado do fechamento, que soma em centavos: dois totais do mesmo mes diferindo
 * de um centavo na mesma tela e pior do que um total so.
 */

import { toCents, toReais } from "@/lib/settlement";
import { mesDaData } from "@/lib/fechamento-do-grupo";

export { mesDaData };

const MESES_PT = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/**
 * `2026-10` -> `outubro de 2026`.
 *
 * Formatado a partir da STRING, e nao de `new Date("2026-10")`: a data sem dia
 * e interpretada como meia-noite UTC, que em America/Sao_Paulo e o mes
 * anterior, e o rotulo diria "setembro" sobre o mes de outubro.
 *
 * Mes fora de 01..12 devolve a propria string em vez de `undefined de 2026`:
 * o rotulo e cabecalho de cartao, e um `?mes=2026-99` cortado nao pode virar
 * titulo quebrado.
 */
export function rotuloDoMes(mes: string): string {
  const [ano, m] = (mes ?? "").split("-");
  const nome = MESES_PT[Number(m) - 1];
  return nome ? `${nome} de ${ano}` : mes;
}

/** O minimo que o recorte precisa de uma conta prevista do grupo. */
export interface PrevistaDoGrupo {
  id: string;
  /** `YYYY-MM-DD`. */
  due_date: string;
  /** BRL, positivo (`scheduled_transactions.amount` tem CHECK > 0). */
  amount: number;
  /** A parte de quem olha, como a rota `/scheduled` ja calcula. */
  share_amount: number;
}

/** Quantas contas, e quanto, ficaram de um lado de fora do mes. */
export interface ForaDoMes {
  quantidade: number;
  /** BRL, positivo. */
  total: number;
}

export interface RecorteDePrevistas<T> {
  /** As previstas que vencem DENTRO do mes, da que vence primeiro em diante. */
  doMes: T[];
  /** A soma de `amount` das do mes. BRL. */
  total: number;
  /** A soma de `share_amount` das do mes. BRL. */
  parte: number;
  /** As que vencem ANTES do mes -- tipicamente parcela vencida. */
  antes: ForaDoMes;
  /** As que vencem DEPOIS do mes -- tipicamente a fixa do mes que vem. */
  depois: ForaDoMes;
}

/**
 * As contas previstas do grupo que vencem dentro de `mes`.
 *
 * A comparacao e `<`/`>` sobre `YYYY-MM`, que para esse formato de largura fixa
 * e a ordem cronologica -- `"2026-09" < "2026-10"` e verdadeiro, e nenhum `Date`
 * entra na conta.
 *
 * Linha sem data (ou com data invalida) conta como FORA do mes e entra em
 * `antes`: ela nao pode engordar o total do mes que a pessoa vai ratear, e
 * tambem nao pode desaparecer sem contagem nenhuma.
 */
export function recortarPrevistas<T extends PrevistaDoGrupo>(
  previstas: readonly T[],
  mes: string
): RecorteDePrevistas<T> {
  const alvo = mesDaData(mes);
  const doMes: T[] = [];
  const antes = { quantidade: 0, totalCents: 0 };
  const depois = { quantidade: 0, totalCents: 0 };

  for (const p of previstas ?? []) {
    const mesDaConta = mesDaData(p?.due_date);
    const cents = toCents(Math.abs(Number(p?.amount) || 0));

    if (alvo && mesDaConta === alvo) {
      doMes.push(p);
    } else if (mesDaConta && alvo && mesDaConta > alvo) {
      depois.quantidade += 1;
      depois.totalCents += cents;
    } else {
      antes.quantidade += 1;
      antes.totalCents += cents;
    }
  }

  const soma = (campo: "amount" | "share_amount") =>
    toReais(
      doMes.reduce(
        (acc, p) => acc + toCents(Math.abs(Number(p?.[campo]) || 0)),
        0
      )
    );

  return {
    // A que vence primeiro primeiro; empate de data pelo id, para a ordem nao
    // trocar entre dois carregamentos da mesma tela.
    //
    // O `sort` e no lugar porque `doMes` ja e um array NOVO (montado no laco
    // acima), e nao o que o componente guarda no estado -- uma copia defensiva
    // aqui seria codigo morto. O teste que afirma que a entrada nao e mutada
    // continua valendo: ele e o que quebra se alguem trocar este laco por um
    // `previstas.filter(...).sort(...)`, que ordena o estado do React no lugar.
    doMes: doMes.sort(
      (a, b) =>
        (a.due_date ?? "").localeCompare(b.due_date ?? "") ||
        a.id.localeCompare(b.id)
    ),
    total: soma("amount"),
    parte: soma("share_amount"),
    antes: { quantidade: antes.quantidade, total: toReais(antes.totalCents) },
    depois: { quantidade: depois.quantidade, total: toReais(depois.totalCents) },
  };
}

/** O minimo que o recorte precisa de uma despesa ja realizada do grupo. */
export interface RealizadaDoGrupo {
  id: string;
  /** `YYYY-MM-DD`. */
  transaction_date: string;
}

/**
 * As despesas realizadas do grupo que aconteceram dentro de `mes`.
 *
 * Substitui o `groupTransactionsByPeriod` que comparava `getMonth()` de dois
 * `Date` -- ver o cabecalho para o bug de fuso que isso tinha.
 *
 * A GUARDA DE MES INVALIDO NAO E REDUNDANTE COM O FILTRO
 * -----------------------------------------------------
 * Mes invalido devolve lista vazia: e melhor "nenhuma despesa neste mes" do que
 * a lista inteira do grupo sob o titulo de um mes so. Parece que o filtro
 * abaixo bastaria (nenhuma data casa com `""`), mas a linha SEM data tem
 * `mesDaData(null) === ""` -- e `"" === ""` e verdadeiro. Sem a guarda, um
 * `?mes=` cortado faz a despesa sem data aparecer em todo mes que nao existe.
 */
export function recortarRealizado<T extends RealizadaDoGrupo>(
  linhas: readonly T[],
  mes: string
): T[] {
  const alvo = mesDaData(mes);
  if (!alvo) return [];
  return (linhas ?? []).filter(
    (l) => mesDaData(l?.transaction_date) === alvo
  );
}
