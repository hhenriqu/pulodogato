/**
 * A moeda da viagem, e o que a tela do grupo pode dizer com ela (HMO-182).
 *
 * A migration 026 deixou o banco com uma divisao de trabalho explicita, e este
 * modulo e o lado de ca dela:
 *
 *   - `financial_transactions.exchange_rate` e a cotacao do dia da COMPRA,
 *     congelada. Ela define quanto cada despesa vale em real, para sempre.
 *   - `group_member_balances` devolve o saldo em BRL (coluna `amount_currency`),
 *     somando cada linha pela cotacao que a propria linha carrega.
 *   - `expense_groups.currency` (coluna `group_currency` na view) e a moeda da
 *     viagem: a moeda SUGERIDA a cada despesa e a moeda em que a tela pode
 *     APRESENTAR o saldo.
 *
 * AS DUAS CONVERSOES DESTE ARQUIVO SAO DIFERENTES, E CONFUNDI-LAS PERDE DINHEIRO
 * -----------------------------------------------------------------------------
 * Ha duas perguntas parecidas nesta tela e elas nao tem a mesma resposta:
 *
 *   1. "quanto valeu o jantar de US$ 180 que eu paguei em 12 de marco?"
 *      -> a cotacao de 12 de marco, gravada na linha. NUNCA muda. Nao passa por
 *         aqui: o banco ja fez essa conta.
 *
 *   2. "eu devo R$ 267,50 ao Helio; quanto e isso em dolar para eu pagar hoje?"
 *      -> a cotacao de HOJE, que muda todo dia. E a unica conversao que este
 *         modulo faz, e ela e de APRESENTACAO: o numero que vale continua sendo
 *         R$ 267,50.
 *
 * A troca perigosa e usar a cotacao de hoje para responder a pergunta 1 -- seria
 * o valor do passado mudando sozinho, que e exatamente o que a issue proibe. Por
 * isso `saldoNaMoedaDaViagem` devolve os dois numeros juntos, sempre, e
 * `rotuloDaConversao` obriga a frase a dizer de que dia e a cotacao. Uma tela
 * que mostre "US$ 50,00" sem essa frase esta afirmando algo falso: amanha o
 * mesmo saldo dara outro numero, sem ninguem ter gastado nada.
 *
 * TUDO EM CENTAVOS INTEIROS ONDE HA COMPARACAO
 * --------------------------------------------
 * `toCents`/`toReais` vem de `lib/settlement.ts` pela razao de sempre: e a
 * UNICA conversao reais -> centavos do projeto, e a tolerancia de um centavo
 * desta tela tem que ser a mesma de `simplifySettlements`. Duas copias
 * divergiriam no dia em que uma mudasse, e o sintoma seria a tela cobrando uma
 * divida que a lista de sugestoes se recusa a gerar.
 */

import { MOEDA_PADRAO, formatarValor, moedaConhecida, moedaPorCodigo } from "@/lib/dinheiro";
import { cotacaoCoerente, precisaDeCotacao } from "@/lib/cambio";
import { toCents, toReais } from "@/lib/settlement";

/**
 * A moeda da viagem, saneada.
 *
 * Codigo desconhecido e ausencia caem os dois em BRL, e isso e uma escolha: a
 * coluna tem CHECK de catalogo no banco, entao um codigo estranho aqui so chega
 * por mao humana no SQL ou por versao do app mais nova que a tela. Nos dois
 * casos, BRL e o denominador REAL do saldo -- a view devolve BRL --, entao cair
 * nele nao inventa conversao nenhuma: apenas desliga a apresentacao na moeda da
 * viagem. O contrario (confiar no codigo estranho) faria `moedaPorCodigo` cair
 * no padrao e a tela escreveria "R$" na frente de um numero em dolar.
 */
export function moedaDaViagem(codigo: string | null | undefined): string {
  if (!moedaConhecida(codigo)) return MOEDA_PADRAO;
  return String(codigo).trim().toUpperCase();
}

/**
 * A moeda que vai para `expense_groups.currency`, ou `null` quando nao da.
 *
 * Diferente de `moedaDaViagem` de proposito: na ESCRITA, um codigo que o app nao
 * conhece tem de virar 400 com mensagem, e nao um grupo gravado em BRL sem que
 * ninguem tenha pedido. O CHECK do banco recusaria de qualquer forma, mas com um
 * 500 que a pessoa nao associa ao seletor de moeda.
 *
 * `undefined` (campo ausente no corpo) devolve BRL, nao `null`: um cliente
 * antigo que nao manda `currency` continua criando grupo, e o grupo dele e em
 * real -- que e o DEFAULT da coluna e o que sempre foi verdade.
 */
export function moedaDoGrupoParaGravar(
  valor: unknown
): string | null {
  if (valor === undefined || valor === null || valor === "") return MOEDA_PADRAO;
  if (typeof valor !== "string") return null;
  if (!moedaConhecida(valor)) return null;
  return valor.trim().toUpperCase();
}

/** Por que a tela NAO esta mostrando o saldo na moeda da viagem. */
export type MotivoSemConversao =
  /** A viagem e em real: o saldo ja esta na moeda da viagem. */
  | "mesma_moeda"
  /** Nao ha cotacao de hoje utilizavel (PTAX nao cobre, ou nao respondeu). */
  | "sem_cotacao";

export interface SaldoApresentado {
  /** O numero que vale, sempre. Em BRL, como a view devolve. */
  brl: number;
  /** A moeda da viagem, saneada. */
  moeda: string;
  /**
   * O mesmo saldo escrito na moeda da viagem, ao cambio de hoje -- ou `null`.
   *
   * `null` nao e falha: e o caso em que a tela mostra so o BRL, que e o numero
   * correto. Inventar uma conversao aqui (cotacao 1, por exemplo) escreveria
   * "US$ 267,50" para uma divida de R$ 267,50.
   */
  naMoedaDaViagem: number | null;
  /** A cotacao usada na conversao de apresentacao. `null` quando nao houve. */
  taxaDeHoje: number | null;
  /** Presente exatamente quando `naMoedaDaViagem` e `null`. */
  motivo: MotivoSemConversao | null;
}

/**
 * O saldo em BRL, mais o mesmo saldo na moeda da viagem ao cambio de hoje.
 *
 * A DIVISAO, E NAO A MULTIPLICACAO
 * --------------------------------
 * `exchange_rate` e "quantos reais vale UMA unidade da moeda" (ver o COMMENT da
 * coluna na 026). Para ir de real para a moeda, divide-se. Multiplicar aqui
 * daria, para uma divida de R$ 267,50 num grupo em dolar a 5,35: US$ 1.431,13
 * em vez de US$ 50,00 -- errado por um fator de 28, e errado para CIMA, que e o
 * lado que faz alguem pagar a mais.
 *
 * `valorEmReais` (lib/cambio.ts) e a outra direcao e continua sendo dela a
 * conta do passado. As duas nao devem ser a mesma funcao: sao perguntas
 * diferentes, e um unico `inverter: boolean` seria um parametro que ninguem le
 * na chamada.
 *
 * O SINAL SOBREVIVE
 * -----------------
 * Saldo negativo (devo) tem de continuar negativo depois da conversao: a tela
 * escolhe "A receber"/"Deve pagar" pelo sinal, e um `Math.abs` aqui faria todo
 * devedor aparecer como credor na moeda da viagem enquanto o numero em real
 * seguia certo ao lado.
 */
export function saldoNaMoedaDaViagem(
  saldoEmBRL: number,
  moedaDoGrupo: string | null | undefined,
  taxaDeHoje: number | null | undefined
): SaldoApresentado {
  const moeda = moedaDaViagem(moedaDoGrupo);
  const brl = toReais(toCents(saldoEmBRL));

  if (!precisaDeCotacao(moeda)) {
    return {
      brl,
      moeda,
      naMoedaDaViagem: null,
      taxaDeHoje: null,
      motivo: "mesma_moeda",
    };
  }

  // A mesma regra do CHECK da 026, pela mesma funcao que o formulario de
  // lancamento usa: taxa ausente, NaN, zero, negativa -- e tambem a taxa 1 numa
  // moeda estrangeira, que e o valor proibido e o unico jeito de a conversao
  // sair igual ao BRL sem ninguem notar.
  if (!cotacaoCoerente(moeda, taxaDeHoje)) {
    return {
      brl,
      moeda,
      naMoedaDaViagem: null,
      taxaDeHoje: null,
      motivo: "sem_cotacao",
    };
  }

  const taxa = taxaDeHoje as number;
  const casas = moedaPorCodigo(moeda).casas;
  const fator = 10 ** casas;

  return {
    brl,
    moeda,
    naMoedaDaViagem: Math.round((brl / taxa) * fator) / fator,
    taxaDeHoje: taxa,
    motivo: null,
  };
}

/**
 * A frase que acompanha o valor convertido.
 *
 * Existe como funcao, e nao como texto no JSX, porque ela e a unica coisa que
 * separa uma apresentacao honesta de uma afirmacao falsa -- e porque um teste
 * pode exigir que ela diga "hoje" E que NAO diga que e a cotacao da compra. Sem
 * eixo de tempo no rotulo, "US$ 50,00" ao lado de uma viagem de marco parece o
 * valor que foi gasto em marco.
 *
 * `dataDeHoje` entra por parametro (e nao de `new Date()`) para o teste poder
 * fixar o dia sem mexer no relogio global.
 */
export function rotuloDaConversao(
  apresentado: SaldoApresentado,
  dataDeHoje: string
): string | null {
  if (apresentado.naMoedaDaViagem === null || apresentado.taxaDeHoje === null) {
    return null;
  }

  const [ano, mes, dia] = String(dataDeHoje).slice(0, 10).split("-");
  const dataBR = dia && mes && ano ? `${dia}/${mes}/${ano}` : String(dataDeHoje);

  return (
    `${formatarValor(apresentado.naMoedaDaViagem, apresentado.moeda)} ` +
    `pelo câmbio de hoje (${dataBR}). ` +
    `A dívida é de ${formatarValor(apresentado.brl, MOEDA_PADRAO)} e não muda.`
  );
}

/**
 * A frase do caso em que nao ha conversao. `null` quando ha (ou quando a viagem
 * e em real, onde nao falta nada e nao ha o que explicar).
 */
export function avisoSemConversao(
  apresentado: SaldoApresentado
): string | null {
  if (apresentado.motivo !== "sem_cotacao") return null;
  return (
    `Não consegui a cotação de hoje de ${apresentado.moeda}. ` +
    `Os valores estão em reais, que é como o grupo os guarda.`
  );
}

export interface AcertoParaGravar {
  /** O valor na moeda em que o pagamento foi feito. Vai para `amount`. */
  amount: number;
  /** Vai para `group_settlements.currency`. */
  currency: string;
  /** Vai para `group_settlements.exchange_rate`. Sempre coerente com a moeda. */
  exchange_rate: number;
  /**
   * Quantos reais este pagamento abate de verdade (`amount * exchange_rate`),
   * pela mesma conta que a view da 026 faz.
   */
  abateEmBRL: number;
  /**
   * O que sobra da divida depois deste pagamento, em reais.
   *
   * Zero num acerto em real. Em moeda estrangeira quase nunca e zero, e o
   * motivo esta em `acertoNaMoedaDaViagem`.
   */
  sobraEmBRL: number;
}

/**
 * O acerto de uma divida em BRL, pago na moeda da viagem.
 *
 * POR QUE SOBRA CENTAVO, E POR QUE NAO SE MEXE NA COTACAO PARA ZERAR
 * ------------------------------------------------------------------
 * A divida e R$ 267,50 e o dolar esta a 5,35. Em dolar isso e 50,0000 -- mas a
 * divisao raramente cai redonda: a R$ 267,53 daria US$ 50,0056, e o pagamento
 * existe em centavos de dolar, entao ele e de US$ 50,01. Isso abate
 * 50,01 * 5,35 = R$ 267,55, ou seja R$ 0,02 A MAIS do que se devia.
 *
 * Havia a tentacao de escolher `exchange_rate = divida / amount` para o produto
 * fechar exato. Nao se faz, por duas razoes:
 *
 *   1. seria gravar uma cotacao que nao existiu. A coluna diz "quantos reais
 *      vale 1 unidade da moeda no dia `settled_on`"; um numero calculado de tras
 *      para frente mente sobre o mundo, e e justamente o tipo de numero que uma
 *      conferencia futura nao tem como refutar;
 *   2. a sobra e REAL. Quem paga US$ 50,01 por uma divida de R$ 267,53 pagou
 *      dois centavos a mais de verdade -- o dinheiro existe. Esconder isso na
 *      cotacao apagaria um fato.
 *
 * Entao a sobra volta no resultado, com nome, para a tela poder dizer o que vai
 * acontecer ANTES de registrar. `Math.abs(sobraEmBRL) <= 1 centavo` e a mesma
 * tolerancia de `simplifySettlements`: dentro dela, a sugestao desaparece da
 * lista e nao ha o que avisar.
 *
 * Devolve `null` quando a cotacao nao serve. `null` e o resultado que segura o
 * POST: sem ele, o caminho da moeda estrangeira gravaria cotacao 1 e tomaria
 * 23514 do banco -- ou, pior, gravaria US$ 50 valendo R$ 50 se o CHECK saisse.
 */
export function acertoNaMoedaDaViagem(
  dividaEmBRL: number,
  moedaDoPagamento: string | null | undefined,
  taxa: number | null | undefined
): AcertoParaGravar | null {
  const divida = toReais(toCents(dividaEmBRL));
  if (!(divida > 0)) return null;

  const moeda = moedaDaViagem(moedaDoPagamento);

  if (!precisaDeCotacao(moeda)) {
    return {
      amount: divida,
      currency: MOEDA_PADRAO,
      exchange_rate: 1,
      abateEmBRL: divida,
      sobraEmBRL: 0,
    };
  }

  if (!cotacaoCoerente(moeda, taxa)) return null;

  const t = taxa as number;
  const casas = moedaPorCodigo(moeda).casas;
  const fator = 10 ** casas;
  const amount = Math.round((divida / t) * fator) / fator;

  // Uma divida pequena numa moeda de zero casas (iene, guarani) pode arredondar
  // para zero. Zero nao passa no CHECK `amount > 0` da 007, e um acerto de zero
  // nao e um acerto: devolver `null` manda a tela oferecer o pagamento em real,
  // que e o unico que representa aquela divida.
  if (!(amount > 0)) return null;

  const abateEmBRL = Math.round(amount * t * 100) / 100;

  return {
    amount,
    currency: moeda,
    exchange_rate: t,
    abateEmBRL,
    sobraEmBRL: toReais(toCents(divida) - toCents(abateEmBRL)),
  };
}

/**
 * O aviso de sobra, ou `null` quando o pagamento fecha a divida.
 *
 * O limite e um centavo, igual ao de `simplifySettlements`: abaixo dele a
 * sugestao nem aparece na lista, entao avisar seria assustar sem motivo.
 */
export function avisoDeSobra(acerto: AcertoParaGravar): string | null {
  const sobraCents = toCents(acerto.sobraEmBRL);
  if (Math.abs(sobraCents) <= 1) return null;

  const valor = formatarValor(Math.abs(acerto.sobraEmBRL), MOEDA_PADRAO);

  return sobraCents > 0
    ? `Pagando ${formatarValor(acerto.amount, acerto.currency)} ainda ficam ${valor} em aberto (a cotação não divide redondo).`
    : `Pagando ${formatarValor(acerto.amount, acerto.currency)} você paga ${valor} a mais do que devia (a cotação não divide redondo).`;
}

/**
 * A moeda que o formulario de despesa do grupo deve SUGERIR.
 *
 * "Sugerida" e a palavra da decisao e do COMMENT da coluna: a moeda do grupo
 * preenche o campo, e a pessoa troca se o jantar daquela noite foi pago em
 * outra. Uma viagem ao Chile com uma diaria cobrada em dolar e o caso normal,
 * nao a excecao.
 *
 * A moeda da CONTA (022) perde para a do grupo dentro do grupo: na viagem a
 * despesa e na moeda do lugar, e a conta usada e um detalhe de como se pagou.
 * Fora do grupo esta funcao nao e chamada, e a da conta continua valendo.
 */
export function moedaSugeridaDaDespesa(
  moedaDoGrupo: string | null | undefined,
  moedaDaConta: string | null | undefined
): string {
  const doGrupo = moedaDaViagem(moedaDoGrupo);
  if (precisaDeCotacao(doGrupo)) return doGrupo;
  return moedaConhecida(moedaDaConta)
    ? String(moedaDaConta).trim().toUpperCase()
    : MOEDA_PADRAO;
}
