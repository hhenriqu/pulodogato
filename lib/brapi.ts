// ---------------------------------------------------------------------------
// A CONVERSA COM A BRAPI (HMO-193)
// ---------------------------------------------------------------------------
// Unico lugar do app que fala com a brapi. Separado de lib/mercado.ts (puro e
// testavel) e de /api/investments/mercado (tela de HTTP) pela mesma razao que
// lib/ptax.ts e separado de lib/cambio.ts.
//
// A promessa aqui e a mesma da PTAX: ESTA CAMADA NAO LANCA. Toda falha volta
// como `{ ok: false, falha }` com o motivo ja classificado, e quem chamou
// decide o que fazer. Nenhuma tela de investimento pode quebrar porque um
// servico de cotacao de terceiro caiu.
//
// O TOKEN
// -------
// `BRAPI_TOKEN` e OPCIONAL e sem prefixo NEXT_PUBLIC_: quem chama a brapi e o
// servidor, e a chave nao desce para o navegador.
//
// O que muda sem ele, medido em 2026-09-30:
//   - `GET /api/quote/list`  responde 200 sem token. Os RANKINGS FUNCIONAM.
//   - `GET /api/quote/{t}`   responde 200 so para uma vitrine curta (PETR4,
//                            ITUB4, VALE3 e MGLU3 responderam) e 401
//                            MISSING_TOKEN para o resto (WEGE3, BHIA3, ROMI3,
//                            AZZA3). A BUSCA POR TICKER fica quase toda 401.
//
// Por isso a entrega nao trata token ausente como erro: trata como uma metade
// desligada, com frase propria (ver `mensagemDaFalha` em lib/mercado.ts). O
// app instalado sem chave mostra os rankings e explica a busca, em vez de
// mostrar "WEGE3 nao encontrada" -- que seria mentira.
// ---------------------------------------------------------------------------

import {
  type CotacaoBrapi,
  type Direcao,
  type FalhaDaConsulta,
  type LinhaDaLista,
  classificarErro,
} from "@/lib/mercado";

const BASE = "https://brapi.dev/api";

/** Quanto esperar a brapi. O mesmo orcamento que a PTAX usa por tentativa. */
const TIMEOUT_MS = 6000;

/**
 * Quantas linhas pedir antes de filtrar.
 *
 * O filtro remove muita coisa: das 200 linhas do topo das altas medidas em
 * 2026-09-30, sobraram poucas dezenas depois do piso. Pedir 10 para exibir 10
 * devolveria um ranking vazio nos dias em que o topo e todo fracionario -- que
 * foi exatamente o dia medido.
 */
const LINHAS_POR_PAGINA = 200;

function token(): string | null {
  const t = String(process.env.BRAPI_TOKEN ?? "").trim();
  return t.length > 0 ? t : null;
}

/** `true` quando a busca por ticker tem chance de funcionar para qualquer papel. */
export function temTokenConfigurado(): boolean {
  return token() !== null;
}

function comToken(url: URL): URL {
  const t = token();
  if (t) url.searchParams.set("token", t);
  return url;
}

type Resposta = { status: number; corpo: unknown } | { status: null; corpo: null };

/** Um GET com prazo. Nao lanca: rede caida vira `{ status: null }`. */
async function pegar(url: URL): Promise<Resposta> {
  const aborto = new AbortController();
  const prazo = setTimeout(() => aborto.abort(), TIMEOUT_MS);

  try {
    const resposta = await fetch(url.toString(), {
      signal: aborto.signal,
      headers: { Accept: "application/json" },
      // A brapi ja entrega com ~30 min de atraso; um cache proprio de 5 min nao
      // piora o que a tela promete e tira o pico de chamada de quem recarrega.
      next: { revalidate: 300 },
    });

    let corpo: unknown = null;
    try {
      corpo = await resposta.json();
    } catch {
      corpo = null;
    }

    return { status: resposta.status, corpo };
  } catch {
    return { status: null, corpo: null };
  } finally {
    clearTimeout(prazo);
  }
}

export type ResultadoDaLista =
  | { ok: true; linhas: readonly LinhaDaLista[] }
  | { ok: false; falha: FalhaDaConsulta };

/**
 * As linhas cruas do dia, na direcao pedida. SEM FILTRO -- filtrar e de
 * lib/mercado.ts, para o teste poder provar o filtro sem rede.
 */
export async function listarPorVariacao(direcao: Direcao): Promise<ResultadoDaLista> {
  const url = comToken(new URL(`${BASE}/quote/list`));
  url.searchParams.set("sortBy", "change");
  url.searchParams.set("sortOrder", direcao === "altas" ? "desc" : "asc");
  url.searchParams.set("limit", String(LINHAS_POR_PAGINA));
  url.searchParams.set("type", "stock");

  const { status, corpo } = await pegar(url);

  if (status === null) return { ok: false, falha: { tipo: "indisponivel" } };
  if (status !== 200) return { ok: false, falha: classificarErro(status, corpo, "") };

  const linhas = (corpo as { stocks?: unknown } | null)?.stocks;
  if (!Array.isArray(linhas)) return { ok: false, falha: { tipo: "indisponivel" } };

  return { ok: true, linhas: linhas as LinhaDaLista[] };
}

export type ResultadoDaCotacao =
  | { ok: true; bruta: CotacaoBrapi }
  | { ok: false; falha: FalhaDaConsulta };

/**
 * A cotacao de UM ticker.
 *
 * Um por chamada, nunca a lista separada por virgula: medi em 2026-09-30 que
 * `GET /api/quote/PETR4,ITUB4` responde 401 sem token mesmo quando os dois
 * respondem 200 separados -- multi-ticker e recurso pago.
 */
export async function cotacaoDoTicker(ticker: string): Promise<ResultadoDaCotacao> {
  const url = comToken(new URL(`${BASE}/quote/${encodeURIComponent(ticker)}`));

  const { status, corpo } = await pegar(url);

  if (status === null) return { ok: false, falha: { tipo: "indisponivel" } };
  if (status !== 200) return { ok: false, falha: classificarErro(status, corpo, ticker) };

  const resultados = (corpo as { results?: unknown } | null)?.results;
  const bruta = Array.isArray(resultados) ? resultados[0] : null;
  if (!bruta) return { ok: false, falha: { tipo: "nao_encontrado", ticker } };

  return { ok: true, bruta: bruta as CotacaoBrapi };
}
