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

import { somaMeses, type BaseDoValorParcelado } from "@/lib/lancamento";

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

// ---------------------------------------------------------------------------
// MOVER A PARCELA DE FATURA, E A SERIE INTEIRA COM ELA (HMO-357)
// ---------------------------------------------------------------------------
// "Quando movo uma parcela, as demais devem mover junto."
//
// O QUE ACONTECIA
// ---------------
// Mover uma parcela era uma edicao de UMA linha: o formulario grava
// `financial_transactions` direto pelo supabase-js, e trocar a data (ou a
// fatura escolhida da 041) de "parcela 3 de 10" movia a 3 e deixava as outras
// nove onde estavam. O resultado nao da erro: a serie passa a ter duas parcelas
// na mesma fatura e um mes vazio no fim, e as duas faturas fecham num valor
// plausivel.
//
// A serie de um parcelamento NAO e um conjunto de dez linhas independentes --
// ela e uma CADENCIA de um mes. Mover uma parcela sem mover as seguintes
// destroi a unica propriedade que faz a serie ser uma serie.
//
// POR QUE O DESLOCAMENTO E EM MESES DE FATURA, E NAO EM DIAS
// ----------------------------------------------------------
// Porque a cadencia que existe e a da FATURA, e porque somar dias (ou somar
// meses na `transaction_date`) nao soma uma fatura:
//
//   compra 31/01, cartao fecha dia 30
//     31/01 -> dia 31 > 30             -> fatura de FEVEREIRO
//     28/02 (31/01 + 1 mes, grampeado) -> dia 28 <= 30 -> fatura de FEVEREIRO
//
// Deslocar "um mes" pela data deixaria a parcela na MESMA fatura -- ver o
// cabecalho de `datasDasParcelasNoCartao`. Entao o delta e medido entre o
// `invoice_month` de origem e o de destino da ancora (dois `AAAA-MM-01`), e e
// esse numero de meses que cada irma alcancada anda, cada uma a partir da
// fatura DELA.
//
// `somaMeses` e reusada em vez de reescrita aqui porque e a mesma aritmetica de
// string sem `Date` que a criacao da serie usa (meia-noite UTC reimpressa com
// `toISOString` devolve o dia anterior a oeste de Greenwich, e o teste passaria
// em UTC e falharia em America/Sao_Paulo). Com o dia 1 ela nunca grampeia.
//
// E CADA IRMA ANDA A PARTIR DA FATURA DELA, NAO EM CADEIA
// -------------------------------------------------------
// `somaMeses(fatura_da_irma, delta)`, e nao `somaMeses(destino_da_vizinha, 1)`:
// encadear arrasta para frente qualquer irregularidade que a serie ja tenha (uma
// parcela que alguem ja moveu a mao, uma fatura pulada) e reescreve a serie
// inteira em vez de move-la. O deslocamento preserva o espacamento que existe --
// inclusive um espacamento errado, que nao e esta funcao que conserta.
// ---------------------------------------------------------------------------

/**
 * 'AAAA-MM' (como a tela fala) -> 'AAAA-MM-01' (como a coluna aceita), ou
 * `null` quando nao da para ler.
 *
 * Dia 1 porque e o que a 041 permite: `CHECK (invoice_month_override =
 * date_trunc('month', invoice_month_override))`. Mandar 'AAAA-MM' cru para uma
 * coluna `date` e erro de sintaxe (22008) e mandar um dia qualquer bate no
 * CHECK (23514) -- as duas falhas chegam como mensagem de Postgres que nao
 * nomeia o campo.
 *
 * `app/api/financial-installments/route.ts` (a CRIACAO da serie) tem uma copia
 * privada identica desta funcao. Ela nao foi substituida aqui de proposito:
 * unificar as duas mexe no caminho que grava a compra parcelada, que nao e o
 * que esta mudanca toca. Se a regra do dia 1 mudar, sao dois lugares.
 */
export function mesDaFaturaPedida(bruto: unknown): string | null {
  const mes = String(bruto ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(mes)) return null;

  const numeroDoMes = Number(mes.slice(5, 7));
  if (numeroDoMes < 1 || numeroDoMes > 12) return null;

  return `${mes}-01`;
}

/** 'AAAA-MM-01' -> indice absoluto de mes. `null` se nao e um mes de fatura. */
function indiceDoMesDaFatura(mes: string): number | null {
  // O DIA 1 E EXIGIDO, e nao normalizado em silencio: `invoice_month` e sempre
  // o primeiro dia do mes na 006, e a 041 tem CHECK de `date_trunc`. Um
  // 'AAAA-MM-15' chegando aqui e um chamador que confundiu mes de fatura com
  // data de compra -- aceitar o dia 15 esconderia esse erro e gravaria a serie
  // numa fatura que ninguem escolheu.
  const casa = /^(\d{4})-(\d{2})-01$/.exec(mes);
  if (!casa) return null;

  const ano = Number(casa[1]);
  const numeroDoMes = Number(casa[2]);
  if (numeroDoMes < 1 || numeroDoMes > 12) return null;

  return ano * 12 + (numeroDoMes - 1);
}

/**
 * Quantos meses de fatura separam duas faturas ('AAAA-MM-01').
 *
 * Positivo quando `para` e depois de `de`. `null` quando uma das duas nao e um
 * mes de fatura legivel -- e nao 0, que seria indistinguivel de "nao ha
 * movimento" e faria um destino ilegivel passar como pedido inofensivo.
 */
export function mesesEntreFaturas(de: string, para: string): number | null {
  const origem = indiceDoMesDaFatura(de);
  const destino = indiceDoMesDaFatura(para);
  if (origem === null || destino === null) return null;
  return destino - origem;
}

/** Para onde cada parcela alcancada vai: o `invoice_month` novo dela. */
export interface MovimentoDeParcela {
  id: string;
  /** 'AAAA-MM-01'. */
  invoiceMonth: string;
}

/**
 * Por que o movimento foi recusado. Cada motivo tem uma frase propria na rota:
 * um "não foi possível mover" generico sobre uma serie de dez parcelas nao diz
 * a ninguem o que fazer em seguida.
 */
export type RecusaDeMovimento =
  /** A ancora nao esta em fatura nenhuma: nao ha de onde medir o delta. */
  | "ancora_sem_fatura"
  /** O destino nao e um 'AAAA-MM-01' (ou a conta de meses saiu do calendario). */
  | "destino_ilegivel"
  /** O destino e a fatura onde a parcela ja esta. */
  | "sem_movimento"
  /** Uma alcancada nao esta em fatura nenhuma: nao ha de onde desloca-la. */
  | "parcela_sem_fatura"
  /** O destino de alguma alcancada e uma fatura JA PAGA. */
  | "fatura_paga_no_destino";

export type PlanoDeMovimento =
  | { ok: true; delta: number; movimentos: MovimentoDeParcela[] }
  | { ok: false; motivo: RecusaDeMovimento; parcelas: string[] };

/**
 * Para qual fatura vai cada parcela alcancada, quando a ancora vai para
 * `destinoDaAncora`.
 *
 * Quem decide QUAIS parcelas sao alcancadas e `planejarAlteracaoDeParcelas` --
 * esta funcao so desloca as que recebeu. Em `apenas_esta` isso e um movimento
 * de uma parcela so, que e legitimo: e o comportamento de hoje, com a diferenca
 * de ter sido escolhido em voz alta.
 *
 * TUDO OU NADA, E ISSO E A DECISAO PRINCIPAL DAQUI
 * ------------------------------------------------
 * Qualquer impedimento recusa o movimento INTEIRO, em vez de mover as que dao e
 * deixar as outras. Mover 6 de 8 parcelas e exatamente o estado que esta issue
 * existe para eliminar -- e o unico jeito de descobri-lo seria reconferir oito
 * faturas a mao.
 *
 * E A FATURA PAGA E RECUSA, NAO PRESERVACAO
 * -----------------------------------------
 * `planejarAlteracaoDeParcelas` ja tira de `ids` as parcelas que ESTAO em
 * fatura paga. Esta funcao cuida do outro lado: uma parcela que CAIRIA numa
 * fatura paga. Deixa-la entrar mudaria o total de uma fatura que a pessoa ja
 * conferiu e pagou -- e a conta do cartao nao muda junto. Nenhum alcance
 * autoriza isso, entao e recusa e nao aviso.
 */
export function novasFaturasDasParcelas(entrada: {
  ancora: ParcelaParaAlcance;
  /** 'AAAA-MM-01': a fatura para onde a ancora vai. */
  destinoDaAncora: string;
  /** As parcelas que o alcance pegou, a ancora inclusa. */
  alcancadas: ParcelaParaAlcance[];
  mesesDeFaturaPaga?: string[];
}): PlanoDeMovimento {
  const { ancora, destinoDaAncora, alcancadas } = entrada;
  const pagas = new Set(entrada.mesesDeFaturaPaga ?? []);

  if (!ancora.invoice_month) {
    return { ok: false, motivo: "ancora_sem_fatura", parcelas: [ancora.id] };
  }

  const delta = mesesEntreFaturas(ancora.invoice_month, destinoDaAncora);
  if (delta === null) {
    return { ok: false, motivo: "destino_ilegivel", parcelas: [] };
  }
  if (delta === 0) {
    return { ok: false, motivo: "sem_movimento", parcelas: [] };
  }

  const emOrdem = [...alcancadas].sort(
    (a, b) => a.installment_number - b.installment_number
  );

  const semFatura = emOrdem.filter((p) => !p.invoice_month).map((p) => p.id);
  if (semFatura.length > 0) {
    return { ok: false, motivo: "parcela_sem_fatura", parcelas: semFatura };
  }

  const movimentos: MovimentoDeParcela[] = [];
  const noPago: string[] = [];

  for (const p of emOrdem) {
    const destino = somaMeses(String(p.invoice_month), delta);
    if (!destino) {
      // A conta de meses saiu do calendario (ano fora de 0001..9999). Nao e um
      // caso de usuario, e e por isso que ele recusa em vez de pular a linha:
      // pular deixaria a serie meio movida pelo mesmo pedido.
      return { ok: false, motivo: "destino_ilegivel", parcelas: [p.id] };
    }
    if (pagas.has(destino)) noPago.push(p.id);
    movimentos.push({ id: p.id, invoiceMonth: destino });
  }

  if (noPago.length > 0) {
    return { ok: false, motivo: "fatura_paga_no_destino", parcelas: noPago };
  }

  return { ok: true, delta, movimentos };
}

/** O que a tela manda no corpo para mover: um destino, ou nada. */
export type DestinoPedido =
  | { invoice_month: string }
  | { transaction_date: string };

/**
 * A pessoa MOVEU esta parcela no formulario? E, se moveu, qual destino declara
 * o movimento?
 *
 * O formulario tem DOIS campos que decidem em que fatura a compra cai -- a data
 * e o seletor de fatura da 041 --, e eles nao tem o mesmo peso: com o override
 * preenchido, a fatura e a escolha e a data nao coloca nada. E por isso que
 * "mudou a data" nao e, sozinho, um movimento:
 *
 *   fatura escolhida (nova, nao vazia) -> o destino e ELA. Explicita ganha.
 *   fatura APAGADA no seletor          -> a compra volta a cair pela data, e o
 *                                         destino e a data que vai ser gravada.
 *   sem fatura escolhida, data mudou   -> o destino e a data nova.
 *   fatura escolhida INTACTA           -> nao ha movimento, mesmo com a data
 *                                         mudando: o override continua
 *                                         colocando a parcela onde ela esta.
 *
 * O ultimo caso e o que esta funcao existe para acertar. Tratar toda troca de
 * data como movimento faria a serie andar quando a parcela NAO anda -- as nove
 * irmas mudariam de fatura e a ancora ficaria onde estava, que e o defeito desta
 * issue invertido e pior (a tela nem mostra as irmas).
 */
export function movimentoPedidoNaTela(entrada: {
  /** `transaction_date` como esta gravada ('AAAA-MM-DD'). */
  dataGravada: string;
  /** `invoice_month_override` gravado, em 'AAAA-MM', ou "" quando nulo. */
  faturaGravada: string;
  /** A data no campo ('AAAA-MM-DD'). */
  dataNova: string;
  /** O seletor de fatura ('AAAA-MM'), ou "" em "pela data da compra". */
  faturaNova: string;
}): DestinoPedido | null {
  const { dataGravada, faturaGravada, dataNova, faturaNova } = entrada;

  const mudouAFatura = faturaNova !== faturaGravada;
  const mudouAData = dataNova !== dataGravada;

  if (mudouAFatura && faturaNova) return { invoice_month: faturaNova };
  if (mudouAFatura) return { transaction_date: dataNova };
  if (mudouAData && !faturaNova) return { transaction_date: dataNova };

  return null;
}

/**
 * A frase que declara o movimento, para a tela e para o toast.
 *
 * Ela diz o NUMERO de parcelas e o SENTIDO, porque "as demais movem junto" tem
 * duas leituras na cabeca de quem clica -- "as nove restantes" e "as seis
 * seguintes" -- e so o alcance escolhido distingue as duas. Sem o numero, o
 * dialogo de "esta e as proximas" e o de "todas" dizem a mesma coisa.
 */
export function consequenciaDoMovimento(
  plano: PlanoDeParcelas,
  delta: number
): string {
  const quantas = plano.ids.length;
  const meses = Math.abs(delta);
  const sentido = delta > 0 ? "para frente" : "para trás";
  const emMeses = `${meses} ${meses === 1 ? "mês" : "meses"} ${sentido}`;

  const frases: string[] = [
    quantas === 1
      ? `Só esta parcela anda ${emMeses}. As outras ficam nas faturas delas.`
      : `${quantas} parcelas andam ${emMeses}, cada uma a partir da fatura dela.`,
  ];

  const quantasPagas = plano.preservadasPorFaturaPaga.length;
  if (quantasPagas > 0) {
    frases.push(
      `${quantasPagas} parcela${quantasPagas === 1 ? " está" : "s estão"} em fatura já paga e não ${quantasPagas === 1 ? "foi" : "foram"} movida${quantasPagas === 1 ? "" : "s"}.`
    );
  }

  return frases.join(" ");
}
