/**
 * ACESSO PELO CLAUDE (servidor MCP) -- a parte pura.
 *
 * O Pulo do Gato e um conector do Claude: `https://<app>/api/mcp`. Este
 * arquivo tem as regras que nao dependem de banco nem de rede, para serem
 * testadas sem servidor (`scripts/test-acesso-pelo-claude.mjs`):
 *
 *   - o formato do token e o hash que vai para `tokens_do_claude` (085);
 *   - o "pacote assinado" que serve de `client_id` e de codigo de autorizacao
 *     do OAuth -- nos dois casos o servidor nao guarda estado, so confere a
 *     assinatura;
 *   - o PKCE (S256) e a lista de enderecos de retorno aceitos;
 *   - achar conta, cartao, categoria ou grupo pelo NOME que a pessoa falou;
 *
 * As rotas ficam em `app/api/mcp/**`; a troca do token por sessao e as
 * ferramentas, em `lib/services/mcp-*.ts`.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

/** O prefixo de todo token. Ajuda a reconhecer um token vazado num log. */
export const PREFIXO_DO_TOKEN = "pdg_";

/** Um token novo: `pdg_` + 32 bytes aleatorios em base64url (43 caracteres). */
export function novoToken(): string {
  return PREFIXO_DO_TOKEN + randomBytes(32).toString("base64url");
}

/** O que vai para `token_hash`: SHA-256 em hex. O token em claro nunca e gravado. */
export function hashDoToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Os primeiros caracteres, so para a tela dizer qual conexao e qual. */
export function prefixoVisivel(token: string): string {
  return token.slice(0, PREFIXO_DO_TOKEN.length + 6);
}

/** Tem cara de token nosso? Barra lixo antes de ir ao banco. */
export function pareceToken(bruto: string | null | undefined): bruto is string {
  return typeof bruto === "string" && /^pdg_[A-Za-z0-9_-]{43}$/.test(bruto);
}

/** O token do cabecalho `Authorization: Bearer <token>`. */
export function tokenDoCabecalho(cabecalho: string | null | undefined): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(cabecalho ?? "");
  return m && pareceToken(m[1]) ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Pacote assinado (client_id e codigo de autorizacao)
// ---------------------------------------------------------------------------

/**
 * `base64url(json) + "." + base64url(hmac)`. O conteudo NAO e secreto -- so
 * nao pode ser forjado nem alterado. Quem tem o pacote le o que esta dentro.
 *
 * `exp` (segundos desde 1970) e opcional: o `client_id` nao expira, o codigo
 * de autorizacao vive cinco minutos.
 */
export function assinarPacote(dados: Record<string, unknown>, segredo: string): string {
  const corpo = Buffer.from(JSON.stringify(dados), "utf8").toString("base64url");
  const assinatura = createHmac("sha256", segredo).update(corpo).digest("base64url");
  return `${corpo}.${assinatura}`;
}

export function abrirPacote<T extends Record<string, unknown>>(
  pacote: string | null | undefined,
  segredo: string,
  agoraEmSegundos: number = Math.floor(Date.now() / 1000)
): T | null {
  if (typeof pacote !== "string") return null;
  const partes = pacote.split(".");
  if (partes.length !== 2) return null;
  const [corpo, assinatura] = partes;

  const esperada = createHmac("sha256", segredo).update(corpo).digest();
  let recebida: Buffer;
  try {
    recebida = Buffer.from(assinatura, "base64url");
  } catch {
    return null;
  }
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) {
    return null;
  }

  let dados: unknown;
  try {
    dados = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return null;

  const exp = (dados as { exp?: unknown }).exp;
  if (exp !== undefined && (typeof exp !== "number" || exp < agoraEmSegundos)) {
    return null;
  }
  return dados as T;
}

/**
 * O segredo das assinaturas, derivado da service role key: nenhuma variavel
 * de ambiente nova para configurar, e um segredo que ja e do servidor. O
 * rotulo separa este uso de qualquer outro que a chave tenha.
 */
export function segredoDasAssinaturas(chaveDeServico: string): string {
  return createHash("sha256")
    .update(`pulodogato:mcp-oauth:v1:${chaveDeServico}`, "utf8")
    .digest("hex");
}

// ---------------------------------------------------------------------------
// OAuth: PKCE e enderecos de retorno
// ---------------------------------------------------------------------------

/** PKCE S256: `base64url(sha256(verifier)) === challenge`. "plain" nao vale. */
export function pkceConfere(verificador: string, desafio: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verificador)) return false;
  const calculado = createHash("sha256").update(verificador, "ascii").digest("base64url");
  const a = Buffer.from(calculado);
  const b = Buffer.from(desafio);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Que endereco de retorno um cliente pode registrar.
 *
 * HTTPS em qualquer host (o Claude usa `https://claude.ai/api/mcp/auth_callback`
 * e `https://claude.com/...`), ou HTTP so em `localhost`/`127.0.0.1` (Claude
 * Code e o MCP Inspector abrem um servidor local para receber o codigo). Nada
 * de `javascript:`, fragmento ou credencial embutida.
 */
export function enderecoDeRetornoAceito(bruto: string): boolean {
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") {
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  }
  return false;
}

/** Os dados dentro do `client_id` assinado. */
export interface ClienteRegistrado extends Record<string, unknown> {
  /** Sempre "cliente": impede usar um codigo de autorizacao como client_id. */
  t: "cliente";
  nome: string;
  retornos: string[];
}

/** Os dados dentro do codigo de autorizacao assinado. */
export interface CodigoDeAutorizacao extends Record<string, unknown> {
  t: "codigo";
  usuario: string;
  cliente: string;
  retorno: string;
  desafio: string;
  exp: number;
}

/** O nome do cliente, limpo para caber na tela e na coluna `nome` (1..80). */
export function nomeDoCliente(bruto: unknown): string {
  const nome = typeof bruto === "string" ? bruto.replace(/\s+/g, " ").trim() : "";
  return (nome || "Claude").slice(0, 80);
}

// ---------------------------------------------------------------------------
// Achar pelo nome
// ---------------------------------------------------------------------------

/** "Cartão Nubank" e "cartao  nubank" sao o mesmo nome. */
export function normalizarNome(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type Achado<T> =
  | { ok: true; item: T }
  | { ok: false; motivo: "nenhum" | "varios"; candidatos: T[] };

/**
 * Acha UM item pelo id ou pelo nome que a pessoa falou.
 *
 * Ordem: id exato, nome exato (sem acento e caixa), e por ultimo "contem".
 * Dois candidatos no mesmo degrau sao ambiguidade -- devolve os dois para o
 * Claude perguntar, em vez de chutar e lancar na conta errada.
 */
export function acharPorNome<T extends { id: string; nome: string }>(
  itens: T[],
  pedido: string
): Achado<T> {
  const bruto = pedido.trim();
  const porId = itens.find((i) => i.id === bruto);
  if (porId) return { ok: true, item: porId };

  const alvo = normalizarNome(bruto);
  if (!alvo) return { ok: false, motivo: "nenhum", candidatos: itens };

  const exatos = itens.filter((i) => normalizarNome(i.nome) === alvo);
  if (exatos.length === 1) return { ok: true, item: exatos[0] };
  if (exatos.length > 1) return { ok: false, motivo: "varios", candidatos: exatos };

  const contem = itens.filter((i) => {
    const nome = normalizarNome(i.nome);
    return nome.includes(alvo) || alvo.includes(nome);
  });
  if (contem.length === 1) return { ok: true, item: contem[0] };
  if (contem.length > 1) return { ok: false, motivo: "varios", candidatos: contem };

  return { ok: false, motivo: "nenhum", candidatos: itens };
}

/** A frase de erro de `acharPorNome`, com as opcoes para o Claude perguntar. */
export function fraseDoNaoAchado<T extends { nome: string }>(
  oQue: string,
  pedido: string,
  achado: { motivo: "nenhum" | "varios"; candidatos: T[] }
): string {
  const opcoes = achado.candidatos.map((c) => `"${c.nome}"`).join(", ") || "nenhuma cadastrada";
  return achado.motivo === "varios"
    ? `"${pedido}" bate com mais de um(a) ${oQue}: ${opcoes}. Pergunte qual.`
    : `Não achei ${oQue} "${pedido}". Opções: ${opcoes}.`;
}

// ---------------------------------------------------------------------------
// Valores e datas digitados na conversa
// ---------------------------------------------------------------------------

/**
 * O valor que chegou na ferramenta, em reais. Aceita numero ou texto
 * brasileiro ("1.234,56", "R$ 49,90"). Devolve null para zero, negativo ou
 * lixo -- o SINAL e do tipo do lancamento, nunca do numero (HMO-181).
 */
export function valorEmReais(bruto: unknown): number | null {
  let n: number;
  if (typeof bruto === "number") {
    n = bruto;
  } else if (typeof bruto === "string") {
    let t = bruto.replace(/R\$|\s/g, "");
    if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
    n = Number(t);
  } else {
    return null;
  }
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/** 'AAAA-MM-DD' que existe no calendario. */
export function dataValida(bruto: unknown): bruto is string {
  if (typeof bruto !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(bruto)) return false;
  const d = new Date(`${bruto}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === bruto;
}

/** Hoje no fuso de Sao Paulo -- o "hoje" de quem esta conversando, nao o do servidor. */
export function hojeEmSaoPaulo(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}
