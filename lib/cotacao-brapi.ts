// =====================================================
// A COTACAO DA CARTEIRA -- ARITMETICA, SEM REDE E SEM BANCO
// =====================================================
// HMO-191 (entrega 1 da HMO-141): ate aqui `investment_assets.current_price`
// so era preenchida pelo usuario, digitando o preco na mao. Este arquivo tem a
// parte da automacao que da para provar sem rede: quais simbolos valem uma
// chamada, o que conta como resposta boa da brapi, e como a atualizacao e
// montada.
//
// A rota (`app/api/cron/cotacoes/route.ts`) so orquestra: le o banco, chama
// `fetch`, escreve. Toda decisao mora aqui porque decisao dentro de rota de
// cron so se testa com o cron rodando -- e o cron roda uma vez por dia.
//
// =====================================================
// O CHECK QUE ESTE ARQUIVO EXISTE PARA NAO VIOLAR
// =====================================================
// A 021 grava preco e data EM PAR, nas duas direcoes:
//
//   CONSTRAINT investment_assets_preco_par_check
//     CHECK ((current_price IS NULL) = (current_price_at IS NULL))
//
// Um UPDATE que mande so `current_price` toma `23514` e NAO ESCREVE NADA. A
// linha inteira falha -- e falha em silencio para quem so olha o status HTTP do
// cron, porque o job pode devolver 200 com "atualizei 12" enquanto o banco
// recusou as 12.
//
// A defesa aqui e de TIPO, nao de disciplina: `AtualizacaoDePreco` tem os dois
// campos obrigatorios e nao-nulos, e `atualizacaoDePreco()` e o unico jeito de
// construir um. Quem escrever `.update({ current_price: p })` solto na rota nao
// compila. A prova de que o banco realmente recusa a metade do par esta em
// database/tests/031_cotacao_automatica_test.sql -- o CHECK e exercitado la,
// contra o banco, antes de qualquer caminho feliz.
//
// =====================================================
// O QUE NAO SE COTA, E POR QUE
// =====================================================
// A brapi cobre a B3. `fixed_income` e da entrega 2 (CDI/IPCA nao tem ticker) e
// `international` nao esta no plano gratuito. Cotar um CDB pelo endpoint de
// acao gastaria chamada do teto mensal para receber 404 todo dia.
//
// A moeda entra na regra pelo mesmo motivo: `regularMarketPrice` da brapi vem
// em reais. Gravar esse numero numa linha com `currency = 'USD'` produziria uma
// posicao errada sem erro nenhum aparecer -- e o usuario tomaria decisao
// olhando ela.

/** O que a rota precisa ler de cada linha de `investment_assets`. */
export interface AtivoNoBanco {
  symbol: string;
  type: string;
  currency: string;
  /** ISO-8601, ou null quando ninguem nunca informou preco para este ativo. */
  current_price_at: string | null;
}

/** Um simbolo distinto a cotar, ja com a prioridade resolvida. */
export interface SimboloNaFila {
  symbol: string;
  /**
   * A cotacao MAIS ANTIGA entre as linhas que compartilham este simbolo (null
   * quando alguma linha nunca foi cotada). E este valor que ordena a fila.
   */
  cotadoEm: string | null;
}

/**
 * Os tipos de `investment_assets.type` que a brapi gratuita sabe responder.
 *
 * Espelha o CHECK `investment_assets_type_check` da 021 por SUBCONJUNTO: os
 * quatro valores existem la, dois entram aqui. Se a 021 ganhar um quinto tipo,
 * ele nasce fora da cotacao -- que e o padrao seguro (nao cota) e nao o
 * perigoso (cota e grava numero de outro mercado).
 */
export const TIPOS_COTADOS: ReadonlySet<string> = new Set(["stock", "fii"]);

/** A unica moeda em que `regularMarketPrice` da brapi pode ser gravado. */
export const MOEDA_COTADA = "BRL";

/**
 * Teto de chamadas por execucao.
 *
 * O plano gratuito da brapi da 15.000 requisicoes por mes e cobra UMA por
 * ticker. Com um cron diario isso e ~483 tickers/dia se nada mais consumir a
 * cota. O teto de 300 deixa folga para reexecucao manual e para o mes de 31
 * dias, e -- principalmente -- impede que uma carteira que cresceu de repente
 * queime a cota do mes inteiro numa madrugada e deixe o app sem cotacao ate o
 * dia 1.
 *
 * Estourar o teto nao perde simbolo: a fila e ordenada por quem esta mais
 * desatualizado, entao o que sobrou hoje e o primeiro da fila amanha.
 */
export const TETO_DE_CHAMADAS_POR_EXECUCAO = 300;

/**
 * A atualizacao que vai para o `.update()`.
 *
 * Os dois campos sao obrigatorios e nao-nulos de proposito -- ver o cabecalho.
 * Nao acrescente campo opcional aqui.
 */
export interface AtualizacaoDePreco {
  current_price: number;
  current_price_at: string;
}

export type FalhaDaCotacao =
  /** A brapi nao conhece o ticker (404, ou `results` vazio). */
  | "desconhecido"
  /** Respondeu o ticker, mas sem `regularMarketPrice` utilizavel. */
  | "sem_preco"
  /** Respondeu OUTRO ticker. Ver `precoDaResposta`. */
  | "simbolo_trocado"
  /** Cota estourada (429) -- nao e erro de ticker, e de orcamento. */
  | "limite_atingido"
  /**
   * `BRAPI_TOKEN` ausente, invalido ou revogado (401/403, ou o corpo dizendo
   * isso). NAO e erro de ticker -- ver `precoDaResposta`.
   */
  | "credencial_recusada"
  /** A fonte caiu (5xx), a rede falhou, ou o corpo nao e o que a API promete. */
  | "fonte_indisponivel";

export type ResultadoDaCotacao =
  | { ok: true; preco: number }
  | { ok: false; motivo: FalhaDaCotacao; detalhe: string };

/**
 * Agrupa os simbolos DISTINTOS a cotar, do mais desatualizado para o menos.
 *
 * Por que distintos e nao por usuario: `investment_assets` e por usuario (ver o
 * cabecalho da 021), entao dez pessoas com PETR4 sao dez linhas. A cotacao da
 * PETR4 e a mesma para as dez, e a brapi cobra por CHAMADA -- cotar por linha
 * multiplicaria a conta por dez sem mudar um numero sequer.
 *
 * Por que ordenado por `cotadoEm` ascendente, nulo primeiro: quando a carteira
 * total passa do teto, a ordem decide quem fica de fora. Alfabetica deixaria o
 * fim do alfabeto desatualizado PARA SEMPRE; por staleness, quem nao foi
 * atualizado hoje e o primeiro amanha. Nulo vem antes de tudo porque "nunca
 * teve preco" e o unico caso em que a tela nao mostra numero nenhum.
 *
 * O desempate e o simbolo, em ordem alfabetica: sem ele duas execucoes com o
 * mesmo dado poderiam montar filas diferentes e o teste nao teria o que
 * afirmar.
 */
export function montarFila(
  ativos: readonly AtivoNoBanco[],
  teto: number = TETO_DE_CHAMADAS_POR_EXECUCAO
): SimboloNaFila[] {
  const porSimbolo = new Map<string, SimboloNaFila>();

  for (const ativo of ativos) {
    if (!TIPOS_COTADOS.has(ativo.type)) continue;
    if ((ativo.currency ?? "").toUpperCase() !== MOEDA_COTADA) continue;

    // A 021 ja garante MAIUSCULA e sem espaco pelo CHECK
    // `investment_assets_symbol_maiusculo`. Normalizar de novo e barato e
    // mantem esta funcao verdadeira para quem a chamar com dado de outra
    // origem (o teste, por exemplo).
    const symbol = ativo.symbol.trim().toUpperCase();
    if (!symbol) continue;

    const anterior = porSimbolo.get(symbol);
    if (!anterior) {
      porSimbolo.set(symbol, { symbol, cotadoEm: ativo.current_price_at });
      continue;
    }

    // Fica o MAIS ANTIGO do grupo. Se qualquer linha daquele simbolo nunca foi
    // cotada, o grupo inteiro e tratado como nunca cotado -- e o certo, porque
    // e essa linha que esta sem numero na tela.
    if (anterior.cotadoEm === null) continue;
    if (ativo.current_price_at === null || ativo.current_price_at < anterior.cotadoEm) {
      porSimbolo.set(symbol, { symbol, cotadoEm: ativo.current_price_at });
    }
  }

  // `Array.from` e nao `[...porSimbolo.values()]`: o tsconfig do app tem alvo
  // mais antigo que o do teste, e o spread sobre iterador de Map so compila
  // com `--downlevelIteration`. O teste compila com alvo es2020 e passaria --
  // e o `npm run type-check` do app e que reprovaria, depois.
  const fila = Array.from(porSimbolo.values()).sort((a, b) => {
    if (a.cotadoEm === b.cotadoEm) return a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;
    if (a.cotadoEm === null) return -1;
    if (b.cotadoEm === null) return 1;
    if (a.cotadoEm !== b.cotadoEm) return a.cotadoEm < b.cotadoEm ? -1 : 1;
    return 0;
  });

  // Teto <= 0 corta tudo. E deliberado: e assim que se desliga o job sem
  // remove-lo do vercel.json, e o livro-razao continua registrando que ele
  // rodou.
  return teto <= 0 ? [] : fila.slice(0, teto);
}

/**
 * Traduz o status HTTP da brapi em motivo de falha.
 *
 * O 404 precisa ser distinguido dos outros: ele e o unico que significa "este
 * ticker nao existe" (digitacao errada do usuario, empresa que saiu da bolsa) e
 * o unico que nao adianta tentar de novo amanha. Os demais sao transitorios, e
 * confundi-los faria o resumo do cron acusar carteira quebrada num dia em que a
 * brapi so estava fora do ar.
 */
export function motivoDoStatus(status: number): FalhaDaCotacao {
  if (status === 404) return "desconhecido";
  if (status === 429) return "limite_atingido";
  if (status === 401 || status === 403) return "credencial_recusada";
  return "fonte_indisponivel";
}

/**
 * Os codigos/mensagens com que a brapi recusa a CREDENCIAL, e nao o ticker.
 *
 * Medido contra a API de verdade em 2026-09-30: uma chamada sem token responde
 * `401` com o corpo
 *
 *   {"error":true,"message":"Token de autenticação não fornecido",
 *    "code":"MISSING_TOKEN"}
 *
 * -- isto e, o MESMO formato `error: true` que a API usa para "ticker nao
 * existe". Sem esta distincao um token revogado faria o cron reportar a
 * carteira inteira como `desconhecidos: N`, ou seja: "todos os seus tickers
 * sao invalidos" quando a verdade e "a minha chave venceu". As duas causas
 * pedem acoes opostas (o usuario corrigir o ticker x o dono renovar a chave), e
 * o resumo do cron e a unica coisa que alguem vai ler antes de decidir qual.
 */
function pareceProblemaDeCredencial(code: unknown, message: unknown): boolean {
  const alvo = `${typeof code === "string" ? code : ""} ${
    typeof message === "string" ? message : ""
  }`.toUpperCase();

  return (
    alvo.includes("TOKEN") ||
    alvo.includes("UNAUTHORIZED") ||
    alvo.includes("API KEY") ||
    alvo.includes("APIKEY") ||
    alvo.includes("AUTENTICA") ||
    alvo.includes("AUTHENTICAT")
  );
}

/**
 * Le o corpo da brapi e devolve o preco -- ou diz por que nao da.
 *
 * O formato do plano gratuito e `{ results: [ { symbol, regularMarketPrice } ] }`.
 *
 * POR QUE O SIMBOLO E CONFERIDO
 * -----------------------------
 * A brapi aceita o ticker na URL e responde o que achou. Um ticker parecido que
 * resolve para outro papel devolve 200 com preco valido -- e gravar esse numero
 * seria a carteira mostrando o preco de outra empresa, com data de hoje e cara
 * de certo. E o mesmo defeito que a busca por nome da B3 produz na HMO-194
 * (`results[0]` de outra empresa), e la ele so apareceu porque alguem conferiu.
 * Preferir devolver nada a devolver o numero de outro papel.
 *
 * `bruto` e `unknown` de proposito: vem de `response.json()`, que nao garante
 * nada. Toda a validacao de forma esta aqui, em um lugar so.
 */
export function precoDaResposta(bruto: unknown, symbolPedido: string): ResultadoDaCotacao {
  if (bruto === null || typeof bruto !== "object") {
    return { ok: false, motivo: "fonte_indisponivel", detalhe: "corpo nao e objeto" };
  }

  const corpo = bruto as {
    results?: unknown;
    error?: unknown;
    message?: unknown;
    code?: unknown;
  };

  // A brapi sinaliza erro no corpo, e usa o MESMO formato para duas causas
  // muito diferentes -- ver `pareceProblemaDeCredencial`.
  if (corpo.error) {
    const msg = typeof corpo.message === "string" ? corpo.message : "erro sem mensagem";
    const motivo: FalhaDaCotacao = pareceProblemaDeCredencial(corpo.code, corpo.message)
      ? "credencial_recusada"
      : "desconhecido";
    return { ok: false, motivo, detalhe: msg };
  }

  if (!Array.isArray(corpo.results)) {
    return { ok: false, motivo: "fonte_indisponivel", detalhe: "results ausente ou nao e lista" };
  }

  if (corpo.results.length === 0) {
    return { ok: false, motivo: "desconhecido", detalhe: "results vazio" };
  }

  const primeiro = corpo.results[0];
  if (primeiro === null || typeof primeiro !== "object") {
    return { ok: false, motivo: "fonte_indisponivel", detalhe: "results[0] nao e objeto" };
  }

  const cotacao = primeiro as { symbol?: unknown; regularMarketPrice?: unknown };

  const devolvido = typeof cotacao.symbol === "string" ? cotacao.symbol.trim().toUpperCase() : "";
  const pedido = symbolPedido.trim().toUpperCase();
  if (devolvido !== pedido) {
    return {
      ok: false,
      motivo: "simbolo_trocado",
      detalhe: `pedi ${pedido}, veio ${devolvido || "(sem symbol)"}`,
    };
  }

  const preco = cotacao.regularMarketPrice;
  if (typeof preco !== "number" || !Number.isFinite(preco)) {
    return { ok: false, motivo: "sem_preco", detalhe: `regularMarketPrice = ${String(preco)}` };
  }

  // Zero e negativo sao recusados aqui e nao pelo banco. O CHECK
  // `investment_assets_current_price_positivo` da 021 tambem barraria, mas la
  // o custo e um UPDATE perdido com erro no log; aqui e uma linha no resumo
  // dizendo qual ticker veio zerado. Papel suspenso na B3 as vezes responde 0.
  if (preco <= 0) {
    return { ok: false, motivo: "sem_preco", detalhe: `preco nao positivo: ${preco}` };
  }

  return { ok: true, preco };
}

/**
 * O UNICO construtor de `AtualizacaoDePreco`.
 *
 * Existe para que nao haja como montar meia atualizacao: o par sai daqui
 * completo ou nao sai. Ver o cabecalho do arquivo para o 23514.
 *
 * Lanca em vez de devolver nulo porque chegar aqui com preco invalido ja e um
 * defeito de programa -- `precoDaResposta` e a porta que filtra dado de fora, e
 * ela nunca deixa passar um numero assim. Nulo silencioso aqui viraria uma
 * linha "atualizada" que o banco recusou.
 */
export function atualizacaoDePreco(preco: number, agora: Date): AtualizacaoDePreco {
  if (typeof preco !== "number" || !Number.isFinite(preco) || preco <= 0) {
    throw new Error(`preco invalido para gravar: ${String(preco)}`);
  }
  if (!(agora instanceof Date) || Number.isNaN(agora.getTime())) {
    throw new Error("data invalida para current_price_at");
  }
  return { current_price: preco, current_price_at: agora.toISOString() };
}

/**
 * A URL de cotacao de UM ticker no plano gratuito.
 *
 * Um ticker por chamada porque o endpoint de lote (`quote/A,B,C`) e pago; no
 * gratuito ele responde so o primeiro, calado. Pedir lote e receber um ticker
 * pareceria "os outros nao existem" e a carteira encolheria sozinha.
 *
 * O token vai no header `Authorization`, nao na query: a URL aparece inteira em
 * log de erro e em mensagem de excecao do `fetch`, e o token e segredo.
 */
export function urlDaCotacao(symbol: string): string {
  return `https://brapi.dev/api/quote/${encodeURIComponent(symbol.trim().toUpperCase())}`;
}
