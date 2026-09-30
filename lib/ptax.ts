// ---------------------------------------------------------------------------
// A CONVERSA COM O BANCO CENTRAL (HMO-182)
// ---------------------------------------------------------------------------
// Este e o unico lugar do app que fala com o Olinda. Ele existe separado de
// lib/cambio.ts (que e puro e testavel) e de /api/cambio (que e uma tela de
// HTTP) por uma razao concreta: DOIS caminhos de escrita precisam da mesma
// cotacao, e eles nao podem divergir.
//
//   /api/cambio                       o formulario de lancamento pergunta;
//   /api/movimentacoes/transferencia  a transferencia resolve sozinha, no
//                                     servidor, porque cada perna fica na moeda
//                                     da SUA conta e nao ha campo na tela para
//                                     a pessoa informar duas cotacoes.
//
// Se cada um tivesse a sua copia da regra "so boletim de fechamento, so para
// tras, no maximo N tentativas", a transferencia acabaria gravando um
// Intermediario enquanto o formulario grava o Fechamento -- e as duas linhas
// ficariam com cotacoes diferentes para a mesma moeda no mesmo dia.
//
// A promessa desta funcao e a mesma da rota: ela NAO LANCA. Falha do Banco
// Central volta como `taxa: null` com a origem que explica o motivo, e quem
// chamou decide o que fazer. Ver o cabecalho de lib/cambio.ts para por que a
// cotacao e obrigatoria mas a busca dela nao.
// ---------------------------------------------------------------------------

import {
  MAX_DIAS_PARA_TRAS,
  type BoletimPtax,
  type Cotacao,
  datasParaTentar,
  dataParaPtax,
  escolherBoletim,
  precisaDeCotacao,
  ptaxCobre,
  taxaDoBoletim,
} from "@/lib/cambio";

const OLINDA =
  "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaDia(moeda=@moeda,dataCotacao=@dataCotacao)";

/** Quanto esperar o Banco Central em cada tentativa. */
const TIMEOUT_MS = 6000;

/**
 * Quantas datas tentar de fato.
 *
 * `MAX_DIAS_PARA_TRAS` (10) e o alcance do calendario; isto e quantas chamadas
 * HTTP eu aceito gastar. Quatro cobre o caso real mais longo que um lancamento
 * encontra (compra no domingo de um feriado de segunda e terca) sem transformar
 * um campo de formulario em dez requisicoes.
 */
const MAX_TENTATIVAS = 4;

/** Orcamento total, independente de quantas tentativas sobraram. */
const ORCAMENTO_MS = 9000;

interface RespostaOlinda {
  value?: BoletimPtax[];
}

type ResultadoDeBusca =
  | { ok: true; boletim: BoletimPtax }
  | { ok: false; vazio: true }
  | { ok: false; falhou: true };

/**
 * Um boletim de fechamento para (moeda, data), ou o motivo de nao ter.
 *
 * Distingue "respondeu que nao ha boletim" de "nao respondeu". A primeira faz a
 * busca andar para tras (e fim de semana ou feriado); a segunda faz a busca
 * PARAR -- andar para tras depois de um timeout gastaria o orcamento inteiro
 * repetindo a mesma falha de rede para terminar em `indisponivel` do mesmo
 * jeito, so mais devagar.
 */
async function buscarBoletim(
  moeda: string,
  dataISO: string
): Promise<ResultadoDeBusca> {
  const url = `${OLINDA}?@moeda='${encodeURIComponent(
    moeda
  )}'&@dataCotacao='${dataParaPtax(dataISO)}'&$format=json`;

  try {
    const resposta = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
      // A cotacao de uma data passada nunca muda, mas a de hoje muda ate o
      // fechamento. `no-store` evita servir um Intermediario velho como se fosse
      // o numero final -- o cache economizaria milissegundos e custaria a
      // correcao do unico numero que este modulo existe para dar.
      cache: "no-store",
    });

    if (!resposta.ok) return { ok: false, falhou: true };

    const corpo = (await resposta.json()) as RespostaOlinda;
    const boletim = escolherBoletim(corpo?.value);
    if (!boletim) return { ok: false, vazio: true };

    return { ok: true, boletim };
  } catch {
    // Timeout, DNS, TLS, JSON quebrado. Tudo junto de proposito: para quem
    // chama, a diferenca nao muda a resposta nem o que a tela mostra.
    return { ok: false, falhou: true };
  }
}

/** A data de hoje em ISO, no fuso de Brasilia -- o calendario da PTAX. */
export function hojeEmBrasilia(): string {
  return new Date()
    .toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
    .slice(0, 10);
}

/**
 * A cotacao de uma moeda na data da compra, andando para tras se preciso.
 *
 * Nunca lanca. Nunca devolve taxa 1 para moeda estrangeira -- isso violaria o
 * CHECK da 026, e devolver "1, deu tudo certo" seria a pior falha possivel: o
 * banco aceitaria a linha e a despesa de 180 dolares entraria no acerto da
 * viagem como 180 reais.
 */
export async function cotacaoNaData(
  moeda: string,
  dataISO: string
): Promise<Cotacao> {
  const codigo = String(moeda ?? "").trim().toUpperCase();

  // BRL vale 1 por definicao, e o CHECK da 026 exige exatamente 1.
  if (!precisaDeCotacao(codigo)) {
    return { taxa: 1, dataDoBoletim: null, origem: "ptax" };
  }

  // Compra no futuro nao tem cotacao para congelar. `indisponivel` e nao
  // `sem_cobertura`: amanha essa mesma data passa a ter PTAX.
  if (dataISO > hojeEmBrasilia()) {
    return { taxa: null, dataDoBoletim: null, origem: "indisponivel" };
  }

  if (!ptaxCobre(codigo)) {
    return {
      taxa: null,
      dataDoBoletim: null,
      origem: "sem_cobertura",
    };
  }

  const comecou = Date.now();
  const candidatas = datasParaTentar(dataISO, MAX_DIAS_PARA_TRAS).slice(
    0,
    MAX_TENTATIVAS
  );

  for (const data of candidatas) {
    if (Date.now() - comecou > ORCAMENTO_MS) break;

    const r = await buscarBoletim(codigo, data);

    if (r.ok) {
      const taxa = taxaDoBoletim(r.boletim);
      if (taxa === null) break;
      return {
        taxa,
        dataDoBoletim: data,
        origem: data === dataISO ? "ptax" : "ptax_anterior",
      };
    }

    // Falha de rede nao melhora mudando de data. Ver buscarBoletim.
    if ("falhou" in r) break;
  }

  return {
    taxa: null,
    dataDoBoletim: null,
    origem: "indisponivel",
  };
}
