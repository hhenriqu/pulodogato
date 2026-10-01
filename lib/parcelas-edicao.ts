// ---------------------------------------------------------------------------
// ALTERAR OU APAGAR UMA PARCELA DE CARTAO: SO ESTA, DESTA EM DIANTE, OU TODAS
// ---------------------------------------------------------------------------
// HMO-228 / HMO-208 Fase 6. O irmao de `lib/recorrencia-edicao.ts`, para a
// outra tabela.
//
// POR QUE NAO DA PARA REUSAR A REGRA DA RECORRENCIA
// -------------------------------------------------
// Sao duas series diferentes, em duas tabelas diferentes, e "todas" quer dizer
// coisas diferentes nas duas:
//
//   gasto fixo (scheduled_transactions, amarrado por recurring_rule_id)
//     "todas" = todas as obrigacoes mensais em aberto. Mudar o valor muda
//     QUANTO SE PAGA POR MES, e nao existe um total -- a serie nao tem fim.
//
//   parcelamento de cartao (financial_transactions, amarrado por
//   installment_parent_id, com installment_number/installment_total da 035)
//     "todas" = as M parcelas de UMA compra. Mudar o valor muda o TOTAL DA
//     COMPRA, que e um numero que existe, aparece na tela e tem de fechar.
//
// E A BARREIRA E O NUMERO, NAO A DATA
// -----------------------------------
// Na recorrencia a barreira de "desta em diante" e a `due_date` da ancora. Aqui
// e o `installment_number`, e a diferenca nao e estetica: duas parcelas podem
// cair no MESMO MES quando a serie troca de dia (uma compra do dia 28 com
// fechamento no dia 1 empurra a parcela para a fatura seguinte, e a parcela
// vizinha pode acabar na mesma). Ordenar por data poria 4/10 antes de 3/10, e
// "desta em diante" deixaria de fora uma parcela que vem depois.
//
// O numero e a ordem que a serie tem de verdade, e ele nao depende de fuso,
// de dia de fechamento nem de edicao de data pelo usuario.
//
// E O QUE PROTEGE O MES JA CONFERIDO AQUI
// ---------------------------------------
// A mesma coisa que protege lá: `status`, nunca data. A diferenca e que uma
// linha de `financial_transactions` nao tem status proprio -- ela E o dinheiro
// gravado. O que fecha um mes de cartao e a FATURA ter sido paga, e isso o app
// registra: `POST /api/card-invoices/close` cria uma `scheduled_transactions`
// com `notes = chaveFatura(mes, cartao)`, e dar baixa nela a deixa `paid`.
//
// Entao a parcela "ja conferida" e a que cai num `invoice_month` cuja fatura
// esta paga. Quem descobre esses meses e a rota (e uma consulta); quem decide o
// que fazer com eles e esta funcao, que recebe a lista pronta em
// `mesesDeFaturaPaga`. Com a lista vazia -- cartao sem nenhuma fatura fechada --
// nenhuma parcela e preservada, que e o comportamento certo: nao ha mes
// conferido para proteger.
//
// Trocar essa barreira por data (`transaction_date < hoje`) tem o mesmo defeito
// duplo da recorrencia: preserva a parcela de uma fatura ABERTA que ainda da
// para corrigir, e deixa passar a parcela futura de uma fatura adiantada.
// O mutante `parcelas_barreira_por_data` existe para isso ficar vermelho.
// ---------------------------------------------------------------------------

import type { BaseDoValorParcelado } from "@/lib/lancamento";

/**
 * Os tres alcances. Mesmas palavras da recorrencia de proposito: e a mesma
 * pergunta para a pessoa, e vocabulario novo para a mesma duvida e como se
 * aprende duas regras onde havia uma.
 */
export type AlcanceDaParcela = "apenas_esta" | "esta_e_proximas" | "todas";

export const ALCANCES_DE_PARCELA: AlcanceDaParcela[] = [
  "apenas_esta",
  "esta_e_proximas",
  "todas",
];

export function ehAlcanceDeParcelaValido(
  valor: unknown
): valor is AlcanceDaParcela {
  return ALCANCES_DE_PARCELA.includes(valor as AlcanceDaParcela);
}

/**
 * O minimo que a decisao precisa saber de uma parcela gravada. Menor que a
 * linha do banco de proposito: o que nao entra aqui nao pode influenciar o
 * alcance. `amount` entra porque o recalculo do total da compra o usa.
 */
export interface ParcelaParaAlcance {
  id: string;
  /** O N de "parcela N de M". */
  installment_number: number;
  /** YYYY-MM-01, o mes da fatura em que esta parcela cai (card_invoice_lines). */
  invoice_month: string | null;
  /** Como esta gravado: despesa de cartao e NEGATIVA. */
  amount: number;
}

export interface PlanoDeParcelas {
  /** As parcelas que recebem a alteracao, a ancora inclusa. */
  ids: string[];
  /**
   * Deixadas de fora de proposito: numero menor que o da ancora (em
   * `esta_e_proximas`) ou fatura ja paga (nos tres alcances).
   */
  preservadas: string[];
  /**
   * Quantas ficaram de fora **por fatura paga**, separado das que ficaram por
   * numero. Sao duas frases diferentes na tela: "as 2 anteriores nao mudam"
   * e uma consequencia do que a pessoa escolheu; "1 parcela esta numa fatura
   * ja paga e nao foi alterada" e uma recusa que ela nao pediu, e que muda o
   * total da compra. Um numero so para os dois casos esconde a segunda.
   */
  preservadasPorFaturaPaga: string[];
  /** O numero da parcela clicada. */
  ancoraEm: number;
}

/**
 * Quais parcelas esta alteracao toca.
 *
 * `ancora` e a parcela clicada; `irmas` sao as outras linhas da mesma serie (a
 * ancora pode vir na lista ou nao). `mesesDeFaturaPaga` sao os `invoice_month`
 * do cartao cuja fatura ja foi paga.
 *
 * A ancora entra SEMPRE, inclusive quando a fatura dela esta paga: quem recusa
 * esse caso e a rota, com um 409 que explica que a fatura ja foi quitada. Aqui
 * ele voltaria como um "nada para alterar" generico.
 */
export function planejarAlteracaoDeParcelas(
  alcance: AlcanceDaParcela,
  ancora: ParcelaParaAlcance,
  irmas: ParcelaParaAlcance[],
  mesesDeFaturaPaga: string[] = []
): PlanoDeParcelas {
  const pagas = new Set(mesesDeFaturaPaga);

  const plano: PlanoDeParcelas = {
    ids: [ancora.id],
    preservadas: [],
    preservadasPorFaturaPaga: [],
    ancoraEm: ancora.installment_number,
  };

  if (alcance === "apenas_esta") return plano;

  const daSerie = irmas.filter((p) => p.id !== ancora.id);

  for (const irma of daSerie) {
    // A barreira de ORDEM, e so em `esta_e_proximas`. Pelo NUMERO, nao pela
    // data -- ver o cabecalho. `>=` nao aparece porque a ancora ja esta na
    // lista; aqui so se compara irma com ancora.
    if (
      alcance === "esta_e_proximas" &&
      irma.installment_number < ancora.installment_number
    ) {
      plano.preservadas.push(irma.id);
      continue;
    }

    // A barreira de MES CONFERIDO, e ela vale nos dois alcances que pegam
    // irmas. `invoice_month` nulo (parcela sem cartao resolvido na view) nao e
    // tratado como pago: tratar o desconhecido como protegido faria "todas"
    // silenciosamente nao alterar nada numa serie inteira.
    if (irma.invoice_month !== null && pagas.has(irma.invoice_month)) {
      plano.preservadas.push(irma.id);
      plano.preservadasPorFaturaPaga.push(irma.id);
      continue;
    }

    plano.ids.push(irma.id);
  }

  return plano;
}

export interface ValorDaParcela {
  id: string;
  /** Com sinal, pronto para gravar: despesa de cartao e negativa. */
  amount: number;
}

export interface NovosValores {
  /** Uma entrada por parcela alcancada. */
  valores: ValorDaParcela[];
  /** O valor que cada parcela alcancada passa a ter, em reais, positivo. */
  valorDaParcela: number;
  /**
   * O total da compra DEPOIS desta alteracao: as parcelas alcancadas com o
   * valor novo mais as preservadas com o valor velho.
   *
   * E por isso que ele e calculado e nao assumido. Em "a partir daquela", as
   * anteriores ficam com o valor velho e o total **deixa de ser**
   * `parcela x M`. Uma tela que mostre `parcela x M` passa a afirmar um total
   * que o banco nao tem -- e o resumo da compra e justamente onde a pessoa
   * confere se acertou.
   */
  totalRecalculado: number;
}

/**
 * Os valores novos de cada parcela alcancada, e o total da compra depois disso.
 *
 * `base` e a mesma pergunta que a HMO-211 ja faz no lancamento, com as mesmas
 * palavras ("o valor de cada parcela" / "o total da compra"):
 *
 *   base "parcela" -> o numero digitado e o valor de CADA parcela alcancada.
 *   base "total"   -> o numero digitado e o total da compra, e ele e dividido
 *                     entre as parcelas alcancadas DEPOIS de descontar o que as
 *                     preservadas ja valem.
 *
 * `null` quando a conta nao fecha, e os casos em que ela nao fecha sao a razao
 * de esta funcao existir:
 *
 *   - base "total" com um total MENOR do que as parcelas preservadas ja somam.
 *     Dividir a sobra negativa produziria parcelas negativas (ou seja, de sinal
 *     invertido: credito no cartao), e o CHECK `amount <> 0` nem barraria isso.
 *     A recusa tem de vir antes do banco porque o banco aceitaria.
 *   - nenhuma parcela alcancada: um sucesso com zero linhas alteradas.
 *
 * Tudo em centavos inteiros no meio do caminho, e a sobra da divisao vai na
 * ULTIMA parcela alcancada -- a mesma regra de `serieDeParcelas`, pelo mesmo
 * motivo: R$ 100 em 3 parcelas da 33,33 + 33,33 + 33,34, e nao tres de 33,33
 * somando 99,99.
 */
export function novosValoresDasParcelas(entrada: {
  base: BaseDoValorParcelado;
  /** O numero digitado na tela, em reais e positivo. */
  valorDigitado: number;
  /** As parcelas que recebem o valor novo, na ordem da serie. */
  alcancadas: ParcelaParaAlcance[];
  /** As que ficam como estao, e que entram no total pelo valor VELHO. */
  preservadas: ParcelaParaAlcance[];
}): NovosValores | null {
  const { base, valorDigitado, alcancadas, preservadas } = entrada;

  if (!Number.isFinite(valorDigitado) || valorDigitado <= 0) return null;
  if (alcancadas.length === 0) return null;

  // Centavos inteiros a partir daqui. `Math.round` e nao `Math.trunc`: R$ 0,10
  // chega como 0.1, que vezes 100 da 10.000000000000002.
  const digitado = Math.round(valorDigitado * 100);

  // `Math.abs` porque a despesa esta gravada negativa e o que se soma aqui e
  // tamanho, nao direcao. Somar cru inverteria o total (ver a convencao de
  // sinal de financial_transactions).
  const preservadoEmCentavos = preservadas.reduce(
    (soma, p) => soma + Math.abs(Math.round(p.amount * 100)),
    0
  );

  const emOrdem = [...alcancadas].sort(
    (a, b) => a.installment_number - b.installment_number
  );
  const quantas = emOrdem.length;

  let aRepartir: number;
  if (base === "parcela") {
    aRepartir = digitado * quantas;
  } else {
    aRepartir = digitado - preservadoEmCentavos;
    // O total digitado nao cobre o que as preservadas ja somam.
    //
    // ESTA LINHA E REDUNDANTE DE PROPOSITO, e nao ha mutante para ela: as duas
    // guardas abaixo ja recusam todo caso que ela recusa (com `aRepartir <= 0`,
    // `porParcela` sai <= 0 ou `ultima` sai <= 0, sempre). Ela fica porque e o
    // unico lugar onde a REGRA esta escrita -- sem ela, "total menor que as
    // parcelas ja pagas e recusado" passaria a depender de uma coincidencia
    // aritmetica duas linhas adiante, e o proximo conserto naquelas guardas
    // poderia reabrir o caso sem nada na tela mudando de nome.
    if (aRepartir <= 0) return null;
  }

  const porParcela = Math.round(aRepartir / quantas);
  // Sem isto, R$ 0,01 repartido em 8 parcelas grava SETE linhas com
  // `amount = 0` -- e `financial_transactions` tem CHECK `amount <> 0`, entao o
  // UPDATE morre no meio da serie, com algumas parcelas ja alteradas.
  if (porParcela <= 0) return null;

  const ultima = aRepartir - porParcela * (quantas - 1);
  // E sem isto, R$ 0,05 em 8 parcelas da sete de 1 centavo e uma ULTIMA de
  // -2 centavos: com o sinal da despesa aplicado, ela vira um numero POSITIVO
  // no meio de oito negativos, ou seja um credito no cartao. O banco aceita
  // (`amount <> 0` passa) e a fatura daquele mes abate em vez de cobrar.
  if (ultima <= 0) return null;

  const valores = emOrdem.map((p, i) => ({
    id: p.id,
    // Negativo: despesa. O sinal vem daqui e nao do chamador para que nao haja
    // um segundo lugar onde esquecer o menos transforma a compra em receita.
    amount: -((i === quantas - 1 ? ultima : porParcela) / 100),
  }));

  return {
    valores,
    valorDaParcela: porParcela / 100,
    totalRecalculado: (aRepartir + preservadoEmCentavos) / 100,
  };
}

/**
 * O total da compra como esta gravado hoje, para a tela poder mostrar o "de /
 * para" ao lado do campo.
 *
 * Em reais e POSITIVO, somando o modulo de cada parcela: o que se mostra e o
 * tamanho da compra, e `SUM(amount)` cru devolveria um negativo que a tela
 * imprimiria como "-R$ 3.000,00 de total".
 */
export function totalDaCompra(parcelas: ParcelaParaAlcance[]): number {
  const centavos = parcelas.reduce(
    (soma, p) => soma + Math.abs(Math.round(p.amount * 100)),
    0
  );
  return centavos / 100;
}

/**
 * A frase que declara a consequencia, para a tela nao ter de monta-la.
 *
 * `null` quando nao ha nada a declarar. Ela existe porque a consequencia de
 * "a partir daquela" NAO e obvia: o total da compra deixa de ser
 * `parcela x M`, e sem dizer isso o resumo passa a afirmar um total que o banco
 * nao tem.
 */
export function consequenciaDoAlcance(
  alcance: AlcanceDaParcela,
  plano: PlanoDeParcelas,
  total: { antes: number; depois: number }
): string | null {
  const emReais = (v: number) => {
    const centavos = Math.round(v * 100);
    const inteiros = String(Math.floor(centavos / 100)).replace(
      /\B(?=(\d{3})+(?!\d))/g,
      "."
    );
    return `R$ ${inteiros},${String(centavos % 100).padStart(2, "0")}`;
  };

  const frases: string[] = [];

  if (alcance === "apenas_esta") {
    frases.push("Só esta parcela muda. As outras ficam como estão.");
  } else if (alcance === "esta_e_proximas") {
    const anteriores = plano.ancoraEm - 1;
    frases.push(
      anteriores > 0
        ? `Muda da parcela ${plano.ancoraEm} em diante. As ${anteriores} anteriores ficam com o valor antigo, então o total da compra passa a ser ${emReais(total.depois)} (era ${emReais(total.antes)}).`
        : `Muda a série inteira. O total da compra passa a ser ${emReais(total.depois)} (era ${emReais(total.antes)}).`
    );
  } else {
    frases.push(
      `Muda todas as parcelas. O total da compra passa a ser ${emReais(total.depois)} (era ${emReais(total.antes)}).`
    );
  }

  // A recusa que a pessoa NAO pediu, e que por isso tem de aparecer em frase
  // propria: ela explica por que o total nao e o que ela esperava.
  const quantasPagas = plano.preservadasPorFaturaPaga.length;
  if (quantasPagas > 0) {
    frases.push(
      `${quantasPagas} parcela${quantasPagas === 1 ? " está" : "s estão"} em fatura já paga e não ${quantasPagas === 1 ? "foi" : "foram"} alterada${quantasPagas === 1 ? "" : "s"}.`
    );
  }

  return frases.length > 0 ? frases.join(" ") : null;
}
