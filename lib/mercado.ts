// ---------------------------------------------------------------------------
// O MERCADO DO DIA: CONSULTA POR TICKER E OS RANKINGS (HMO-193, entrega 3)
// ---------------------------------------------------------------------------
// Este e o modulo PURO. Nao faz rede, nao le banco: recebe a resposta da brapi
// ja decodificada e decide o que pode ser exibido. Quem fala com a brapi e
// lib/brapi.ts; quem traduz para HTTP e /api/investments/mercado. A divisao e a
// mesma de lib/cambio.ts + lib/ptax.ts + /api/cambio, e pela mesma razao: a
// regra que segue abaixo precisa ser testavel sem rede.
//
// =========================================================================
// ARMADILHA 1 -- a lista crua publica lixo com cara de noticia
// =========================================================================
// `GET /api/quote/list?sortBy=change` ordena por variacao e nada mais. O topo
// das altas, medido em 2026-09-30 (captura verbatim em
// scripts/fixtures/brapi-altas-2026-09-30.json):
//
//   FSPE11F   +38,89%      597 acoes
//   TXRX3F    +33,78%       14 acoes
//   MSPA3F    +30,54%       36 acoes
//   B1003F    +23,19%        3 acoes
//   BMIN3F    +19,72%        1 acao
//   IGTI4F    +16,82%        4 acoes
//
// e nas baixas, FIGE3F com -14,79% sobre UMA acao. O enunciado da HMO-193
// mediu RCFA11 caindo 76,67% sobre 100 acoes.
//
// Uma acao "subiu 16%" porque QUATRO papeis trocaram de mao. Ligada direto na
// API, a tela publicaria isso com a mesma cara de certa que tem a alta da
// Magazine Luiza sobre 39 milhoes de acoes. O defeito nao da sintoma: o numero
// e verdadeiro, a API respondeu 200, nao ha excecao para logar. So nao e uma
// informacao.
//
// `type=stock` NAO resolve: todas as seis linhas acima voltam como
// `type: "stock"`. O conserto e daqui.
//
// =========================================================================
// ARMADILHA 2 -- o regex "esperto" de ticker fracionario vaza
// =========================================================================
// O sufixo `F` marca o mercado fracionario. O formato canonico e 4 letras +
// digito(s) + `F`, e o regex obvio para isso -- /^[A-Z]{4}\d+[A-Z]*F$/ -- passa
// em PETR4F, KLBN11F e ate em MRSA5BF (classe com letra no meio).
//
// Ele vaza em DOIS tickers da B3, medidos sobre os 1.796 simbolos que
// `GET /api/available` devolve: **B3SA3F** e **B1003F**, cujo radical (`B3SA3`,
// `B100`) tem digito antes das letras. E B1003F nao e hipotese: esta no topo
// das altas da captura de 2026-09-30, +23,19% sobre TRES acoes -- exatamente a
// linha que o filtro existe para remover.
//
// Por isso a regra e a literal do enunciado -- termina em `F` -- e nao a
// esperta. Ela e segura porque foi MEDIDA e nao deduzida: dos 1.796 simbolos,
// 354 terminam em `F`, todos com pelo menos um digito e no minimo 6 caracteres,
// e nenhum deles e papel cheio. Nao ha ticker inteiro terminado em `F` na B3
// para a regra atropelar. Ver `MEDICOES`.
//
// =========================================================================
// ARMADILHA 3 -- o piso em QUANTIDADE DE ACOES recusa o Santander
// =========================================================================
// O enunciado pede "piso de volume" e fala em acoes negociadas (AZZA3 com 6,5
// milhoes contra IGTI4F com 3). Um piso em quantidade de acoes parece a
// traducao direta disso, e e por onde eu ia. Medir desmentiu.
//
// Quantidade de acao nao mede liquidez sozinha porque ela depende do PRECO.
// Nos 297 simbolos nao fracionarios da captura de 2026-09-30, os dois papeis
// legitimos de menor contagem sao:
//
//   BRAP3 (Bradespar ON)    69.900 acoes x R$ 18,00  = R$ 1,26 milhao
//   SANB3 (Santander ON)    99.300 acoes x R$ 14,41  = R$ 1,43 milhao
//
// Qualquer piso de 100.000 acoes -- o numero redondo que separa bem o resto --
// apaga os dois do ranking. Sao Bradespar e Santander, nao mercado fracionario.
//
// Por isso o piso e em DINHEIRO NEGOCIADO (preco x acoes), que nao depende da
// faixa de preco do papel. A margem e enorme, nao apertada: o mais "liquido"
// dos mentirosos medidos, MSPA3F, negociou R$ 1.668 no dia -- 600 vezes abaixo
// do piso. Nao havia zona cinzenta para calibrar, como o enunciado ja dizia.
//
// =========================================================================
// ARMADILHA 4 -- o filtro largo demais passa em toda assercao de bloqueio
// =========================================================================
// Um filtro que esvazia o ranking bloqueia TXRX3F, MSPA3F, IGTI4F e RCFA11 --
// e bloqueia tambem a Petrobras. Passaria em cada teste de "nao aparece" desta
// suite sem entregar tela nenhuma.
//
// O contrapeso esta medido e afirmado no teste: dos 297 nao fracionarios da
// captura, 143 passam o piso. Ver `MEDICOES.naoFracionariosQuePassam`.
// ---------------------------------------------------------------------------

/**
 * O piso de liquidez, em reais negociados no dia (preco de fechamento x acoes).
 *
 * R$ 1 milhao e redondo de proposito: nao ha nada perto dele para calibrar. O
 * mentiroso mais liquido medido negociou R$ 1.668; o papel legitimo mais magro
 * medido (BRAP3) negociou R$ 1,26 milhao. Ver armadilha 3.
 */
export const PISO_DE_LIQUIDEZ_EM_REAIS = 1_000_000;

/**
 * O que foi contado, quando, sobre o que. Serve a dois propositos: deixar o
 * numero acima auditavel, e dar ao teste um alvo para afirmar que a FIXTURE
 * ainda contem a armadilha -- fixture que perdeu a armadilha faz a suite passar
 * sem provar nada.
 */
export const MEDICOES = {
  /** `GET /api/available`, 2026-09-30. */
  simbolosNaB3: 1796,
  /** Desses, quantos terminam em `F`. Todos fracionarios -- armadilha 2. */
  terminadosEmF: 354,
  /** Tickers em que o regex 4-letras vaza. Armadilha 2. */
  vazamentosDoRegexEsperto: ["B3SA3F", "B1003F"] as readonly string[],
  /** Simbolos nao fracionarios nas duas capturas de 2026-09-30, sem repeticao. */
  naoFracionarios: 297,
  /** Desses, quantos passam o piso. O contrapeso da armadilha 4. */
  naoFracionariosQuePassam: 143,
} as const;

/** O que o app promete sobre este dado -- a tela repete, nao inventa. */
export const AVISO_DE_ATRASO =
  "Cotação do plano gratuito da brapi, com atraso de cerca de 30 minutos. Não é preço ao vivo.";

/**
 * O rodape obrigatorio dos rankings.
 *
 * "Maiores altas" e um fato publico sobre o dia, nao uma sugestao de compra, e
 * o enunciado proibe a tela de sugerir acao. Esta frase e o que impede o bloco
 * de ser lido como lista de indicacao.
 */
export const AVISO_NAO_E_RECOMENDACAO =
  "Lista informativa das maiores variações do dia. Não é recomendação de compra ou venda.";

/** Uma linha de `GET /api/quote/list`, como a brapi a devolve. */
export interface LinhaDaLista {
  stock: string;
  name?: string | null;
  close?: number | null;
  change?: number | null;
  volume?: number | null;
  type?: string | null;
  sector?: string | null;
  logo?: string | null;
}

/** Uma linha ja aprovada, pronta para a tela. */
export interface ItemDoRanking {
  ticker: string;
  nome: string;
  preco: number;
  variacao: number;
  acoesNegociadas: number;
  reaisNegociados: number;
}

/** Por que uma linha foi recusada. Recusa muda a tela, entao ela tem nome. */
export type MotivoDaRecusa =
  | "fracionario"
  | "sem_preco"
  | "sem_acoes"
  | "sem_variacao"
  | "abaixo_do_piso";

/**
 * Ticker do mercado fracionario.
 *
 * A regra literal do enunciado -- termina em `F` --, nao a esperta. Ver
 * armadilha 2: a esperta vaza B3SA3F e B1003F, e B1003F esta no topo das altas
 * medidas com tres acoes negociadas.
 *
 * O `length >= 5` nao e defesa contra ticker real nenhum (o mais curto dos 354
 * terminados em `F` tem 6 caracteres): e so a recusa de tratar uma string curta
 * demais para ser ticker como se fosse fracionario.
 */
export function ehFracionario(ticker: string): boolean {
  const t = ticker.trim().toUpperCase();
  return t.length >= 5 && t.endsWith("F");
}

/**
 * Numero utilizavel, ou `null`.
 *
 * Existe porque `Number(null)` e `0`, e `0` e finito. Sem isto, a linha que a
 * brapi manda com `change: null` -- papel que nao negociou -- passaria pela
 * validacao como se tivesse variado exatamente 0%, e a unica coisa que a
 * recusaria depois seria a conferencia de direcao, por acidente. `close` e
 * `volume` escapariam pelo mesmo buraco se nao fossem checados contra zero.
 */
function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Quantos reais o papel negociou no dia, ou `null` quando nao da para saber.
 *
 * `null` e diferente de zero e essa diferenca importa: a linha que o enunciado
 * publica para RCFA11 traz 100 acoes e nenhum preco. Sem preco nao ha como
 * provar liquidez, e o que nao se prova nao sobe para a tela.
 */
export function reaisNegociados(linha: LinhaDaLista): number | null {
  const preco = numero(linha.close);
  const acoes = numero(linha.volume);
  if (preco === null || preco <= 0) return null;
  if (acoes === null || acoes <= 0) return null;
  return preco * acoes;
}

/**
 * A linha pode ser publicada? Devolve o motivo quando nao -- `null` quando sim.
 *
 * Devolve o MOTIVO em vez de um booleano porque o teste precisa distinguir
 * "recusado por ser fracionario" de "recusado por nao negociar": RCFA11 nao
 * termina em `F` e so cai pelo piso, e IGTI4F cairia pelos dois. Um booleano
 * deixaria uma das duas regras poder ser desligada sem quebrar teste nenhum.
 */
export function motivoDaRecusa(linha: LinhaDaLista): MotivoDaRecusa | null {
  const ticker = String(linha.stock ?? "").trim().toUpperCase();

  if (ehFracionario(ticker)) return "fracionario";

  const variacao = numero(linha.change);
  if (variacao === null) return "sem_variacao";

  const preco = numero(linha.close);
  if (preco === null || preco <= 0) return "sem_preco";

  const acoes = numero(linha.volume);
  if (acoes === null || acoes <= 0) return "sem_acoes";

  const reais = reaisNegociados(linha);
  if (reais === null || reais < PISO_DE_LIQUIDEZ_EM_REAIS) return "abaixo_do_piso";

  return null;
}

/** Atalho de leitura. A regra mora em `motivoDaRecusa`. */
export function temLiquidez(linha: LinhaDaLista): boolean {
  return motivoDaRecusa(linha) === null;
}

/** Para onde o ranking olha. */
export type Direcao = "altas" | "baixas";

export interface Ranking {
  direcao: Direcao;
  itens: readonly ItemDoRanking[];
  /** Quantas linhas a brapi mandou antes do filtro. */
  recebidas: number;
  /** Quantas o filtro removeu, por motivo. Vai para a tela como uma frase. */
  removidas: Readonly<Record<MotivoDaRecusa, number>>;
}

const ZERO_POR_MOTIVO: Readonly<Record<MotivoDaRecusa, number>> = {
  fracionario: 0,
  sem_preco: 0,
  sem_acoes: 0,
  sem_variacao: 0,
  abaixo_do_piso: 0,
};

/**
 * O ranking publicavel.
 *
 * Filtra, confere a DIRECAO e so entao corta em `quantos`. A ordem importa:
 * cortar antes de filtrar devolveria um ranking curto feito de lixo removido.
 *
 * A conferencia de direcao existe porque a brapi ordena por variacao mas nao
 * promete sinal: num dia de alta generalizada a cauda de `sortOrder=asc` ainda
 * sobe, e uma "maior baixa" de +2% e um rotulo que mente. Linha com variacao
 * zero nao entra em nenhum dos dois -- nao variou.
 */
export function montarRanking(
  linhas: readonly LinhaDaLista[],
  direcao: Direcao,
  quantos = 10,
): Ranking {
  const removidas: Record<MotivoDaRecusa, number> = { ...ZERO_POR_MOTIVO };
  const aprovadas: ItemDoRanking[] = [];

  for (const linha of linhas) {
    const motivo = motivoDaRecusa(linha);
    if (motivo !== null) {
      removidas[motivo] += 1;
      continue;
    }

    // `motivoDaRecusa` ja garantiu que os tres sao numeros utilizaveis.
    const variacao = numero(linha.change) as number;
    if (direcao === "altas" ? variacao <= 0 : variacao >= 0) continue;

    const ticker = String(linha.stock).trim().toUpperCase();

    aprovadas.push({
      ticker,
      nome: String(linha.name ?? "").trim() || ticker,
      preco: numero(linha.close) as number,
      variacao,
      acoesNegociadas: numero(linha.volume) as number,
      reaisNegociados: reaisNegociados(linha) as number,
    });
  }

  aprovadas.sort((a, b) => (direcao === "altas" ? b.variacao - a.variacao : a.variacao - b.variacao));

  return {
    direcao,
    itens: aprovadas.slice(0, Math.max(0, quantos)),
    recebidas: linhas.length,
    removidas,
  };
}

// ---------------------------------------------------------------------------
// A CONSULTA POR TICKER
// ---------------------------------------------------------------------------

/** Uma linha de `GET /api/quote/{ticker}`, como a brapi a devolve. */
export interface CotacaoBrapi {
  symbol?: string | null;
  shortName?: string | null;
  longName?: string | null;
  currency?: string | null;
  regularMarketPrice?: number | null;
  regularMarketChange?: number | null;
  regularMarketChangePercent?: number | null;
  regularMarketDayHigh?: number | null;
  regularMarketDayLow?: number | null;
  regularMarketPreviousClose?: number | null;
  regularMarketVolume?: number | null;
  regularMarketTime?: string | null;
}

export interface Cotacao {
  ticker: string;
  nome: string;
  moeda: string;
  preco: number;
  variacao: number | null;
  variacaoPercentual: number | null;
  minimaDoDia: number | null;
  maximaDoDia: number | null;
  fechamentoAnterior: number | null;
  acoesNegociadas: number | null;
  medidoEm: string | null;
  /** Sempre `AVISO_DE_ATRASO`. Fica no objeto para a tela nao poder esquecer. */
  aviso: string;
}

/**
 * Ticker digitado -> ticker consultavel, ou `null` quando nem vale a chamada.
 *
 * Aceita letras e digitos, ate 8 caracteres (`MRSA5BF` tem 7). Nao "corrige"
 * nada: quem digita ITUB e nao ITUB4 recebe "nao encontrei ITUB", que e
 * verdade, em vez da cotacao de um papel que ele nao pediu.
 */
export function normalizarTicker(texto: string | null | undefined): string | null {
  const t = String(texto ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{4,8}$/.test(t) ? t : null;
}

/** O que impediu a consulta de responder com uma cotacao. */
export type FalhaDaConsulta =
  | { tipo: "ticker_invalido" }
  | { tipo: "nao_encontrado"; ticker: string }
  | { tipo: "precisa_de_token"; ticker: string }
  | { tipo: "limite_atingido" }
  | { tipo: "indisponivel" };

/**
 * A frase que a pessoa le. Cada falha tem a sua -- e a de token diz que e
 * configuracao do app, nao erro de quem digitou.
 *
 * `precisa_de_token` existe porque medi o plano gratuito em 2026-09-30: SEM
 * token, `GET /api/quote/{ticker}` responde 200 para uma vitrine curta (PETR4,
 * ITUB4, VALE3, MGLU3 responderam) e 401 `MISSING_TOKEN` para o resto --
 * WEGE3, BHIA3, ROMI3 e AZZA3 entre eles. Sem a distincao, a tela diria
 * "WEGE3 nao encontrada", que e falso, e mandaria a pessoa procurar defeito no
 * que ela digitou. Os rankings NAO dependem disso: `GET /api/quote/list`
 * responde 200 sem token.
 */
export function mensagemDaFalha(falha: FalhaDaConsulta): string {
  switch (falha.tipo) {
    case "ticker_invalido":
      return "Digite um código de negociação, como PETR4 ou ITUB4.";
    case "nao_encontrado":
      return `Não encontrei ${falha.ticker} na B3.`;
    case "precisa_de_token":
      return `A consulta de ${falha.ticker} precisa de uma chave da brapi, que ainda não está configurada neste app. As maiores altas e baixas continuam funcionando.`;
    case "limite_atingido":
      return "A brapi atingiu o limite de consultas do plano gratuito. Tente de novo em alguns minutos.";
    case "indisponivel":
      return "Não consegui falar com a brapi agora. Tente de novo em alguns instantes.";
  }
}

/**
 * Traduz a resposta de erro da brapi no motivo.
 *
 * O 401 da brapi e ambiguo de proposito do lado dela: a mesma resposta cobre
 * "sem token" e "token invalido". Do lado de ca as duas dao a mesma frase, que
 * aponta para a configuracao do app -- e o que importa.
 */
export function classificarErro(status: number, corpo: unknown, ticker: string): FalhaDaConsulta {
  const mensagem = String(
    (corpo as { message?: unknown } | null)?.message ?? "",
  ).toLowerCase();

  if (status === 401 || status === 403) return { tipo: "precisa_de_token", ticker };
  if (status === 404) return { tipo: "nao_encontrado", ticker };
  if (status === 429) return { tipo: "limite_atingido" };
  if (mensagem.includes("token")) return { tipo: "precisa_de_token", ticker };
  if (mensagem.includes("não encontrado") || mensagem.includes("not found")) {
    return { tipo: "nao_encontrado", ticker };
  }
  return { tipo: "indisponivel" };
}

/**
 * A cotacao pronta para a tela, ou `null` quando a resposta nao tem preco.
 *
 * Papel sem `regularMarketPrice` e resposta vazia com status 200 -- acontece
 * com simbolo que existe no cadastro mas nao negocia. Devolver um objeto com
 * preco `NaN` colocaria "R$ NaN" na tela; devolver `null` deixa quem chamou
 * dizer "nao encontrei", que e o que a pessoa precisa saber.
 */
export function lerCotacao(bruta: CotacaoBrapi | null | undefined): Cotacao | null {
  if (!bruta) return null;

  const ticker = String(bruta.symbol ?? "").trim().toUpperCase();
  const preco = Number(bruta.regularMarketPrice);
  if (!ticker || !Number.isFinite(preco) || preco <= 0) return null;

  const numeroOuNulo = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    ticker,
    nome: String(bruta.longName ?? bruta.shortName ?? "").trim() || ticker,
    moeda: String(bruta.currency ?? "BRL").trim().toUpperCase() || "BRL",
    preco,
    variacao: numeroOuNulo(bruta.regularMarketChange),
    variacaoPercentual: numeroOuNulo(bruta.regularMarketChangePercent),
    minimaDoDia: numeroOuNulo(bruta.regularMarketDayLow),
    maximaDoDia: numeroOuNulo(bruta.regularMarketDayHigh),
    fechamentoAnterior: numeroOuNulo(bruta.regularMarketPreviousClose),
    acoesNegociadas: numeroOuNulo(bruta.regularMarketVolume),
    medidoEm: String(bruta.regularMarketTime ?? "").trim() || null,
    aviso: AVISO_DE_ATRASO,
  };
}
