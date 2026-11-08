/**
 * ACESSO PELO CLAUDE -- do token para uma sessao da propria pessoa.
 *
 * O servidor MCP (`app/api/mcp/route.ts`) recebe `Authorization: Bearer pdg_...`.
 * Aqui o token vira:
 *
 *   1. a dona, por `tokens_do_claude` (085), lido com a service role -- o
 *      unico ponto que usa a chave de servico, e so para LER o hash;
 *   2. uma sessao NORMAL do Supabase dessa pessoa, pelo mesmo caminho do
 *      "Entrar como" (080): `generateLink` sem e-mail + `verifyOtp`.
 *
 * Toda leitura e escrita das ferramentas usa a sessao do passo 2, com a anon
 * key: a RLS se aplica como se a pessoa estivesse no app. O token nao da
 * acesso a nada que a pessoa nao veja na propria tela.
 *
 * A sessao fica em memoria ate perto de expirar (~1 h), para nao abrir uma
 * sessao nova a cada mensagem da conversa.
 */

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseEnv } from "@/utils/supabase/env";
import { hashDoToken, segredoDasAssinaturas } from "@/lib/acesso-pelo-claude";

export function clienteDeServico(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) return null;
  return createSupabaseClient(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** O segredo do OAuth sem estado (ver `assinarPacote`). Null sem a service role. */
export function segredoDoOAuth(): string | null {
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return chave ? segredoDasAssinaturas(chave) : null;
}

export interface DonoDoToken {
  tokenId: string;
  userId: string;
}

/** Quem e a dona deste token, se ele existe e nao foi revogado. */
export async function donoDoToken(token: string): Promise<DonoDoToken | null> {
  const servico = clienteDeServico();
  if (!servico) return null;

  const { data } = await servico
    .from("tokens_do_claude")
    .select("id, user_id, usado_em")
    .eq("token_hash", hashDoToken(token))
    .is("revogado_em", null)
    .maybeSingle();
  if (!data) return null;

  // "Ultimo uso" para a tela de Configuracoes. Gravado no maximo a cada 10
  // min: uma conversa chama varias ferramentas seguidas.
  const usado = data.usado_em ? Date.parse(data.usado_em) : 0;
  if (Date.now() - usado > 10 * 60 * 1000) {
    await servico
      .from("tokens_do_claude")
      .update({ usado_em: new Date().toISOString() })
      .eq("id", data.id);
  }

  return { tokenId: data.id, userId: data.user_id };
}

interface SessaoGuardada {
  access_token: string;
  refresh_token: string;
  expira_em: number; // ms
}

const sessoes = new Map<string, SessaoGuardada>();

/**
 * A abertura EM ANDAMENTO de cada pessoa.
 *
 * POR QUE (falha real no primeiro uso, 07/11): o Claude chama varias
 * ferramentas AO MESMO TEMPO (listar_contas e listar_categorias juntas). Cada
 * chamada abria a propria sessao, e cada `generateLink` gera um token NOVO
 * que invalida o anterior da mesma pessoa -- o `verifyOtp` da chamada que
 * chegou primeiro batia num token ja trocado e respondia "Nao foi possivel
 * abrir a sessao". A segunda tentativa funcionava, porque a sessao ja estava
 * guardada. Com a promessa compartilhada, chamadas simultaneas na mesma
 * instancia esperam UMA abertura.
 */
const abrindo = new Map<string, Promise<SessaoGuardada>>();

/** Quantas vezes tentar, e a espera antes de cada nova tentativa (ms). */
const ESPERAS = [0, 400, 1200];

async function abrirSessao(userId: string): Promise<SessaoGuardada> {
  const guardada = sessoes.get(userId);
  if (guardada && guardada.expira_em - Date.now() > 5 * 60 * 1000) return guardada;

  const emAndamento = abrindo.get(userId);
  if (emAndamento) return emAndamento;

  const promessa = (async () => {
    // Duas instancias da Vercel ainda podem abrir ao mesmo tempo e uma
    // invalidar o token da outra; nesse caso uma nova tentativa, com um
    // generateLink novo, resolve -- foi o que o segundo clique fez a mao.
    let ultimo: unknown;
    for (const espera of ESPERAS) {
      if (espera) await new Promise((r) => setTimeout(r, espera));
      try {
        const nova = await tentarAbrir(userId);
        sessoes.set(userId, nova);
        return nova;
      } catch (e) {
        ultimo = e;
        if (e instanceof ErroDefinitivo) break;
      }
    }
    console.error("[mcp] falha ao abrir a sessao", ultimo);
    throw ultimo instanceof Error ? ultimo : new Error("Não foi possível abrir a sessão.");
  })().finally(() => abrindo.delete(userId));

  abrindo.set(userId, promessa);
  return promessa;
}

/** Um erro que outra tentativa nao conserta (configuracao, conta sem e-mail). */
class ErroDefinitivo extends Error {}

async function tentarAbrir(userId: string): Promise<SessaoGuardada> {
  const servico = clienteDeServico();
  if (!servico) throw new ErroDefinitivo("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");

  const { data: alvo, error: eAlvo } = await servico.auth.admin.getUserById(userId);
  if (eAlvo) throw new Error("Não foi possível ler a conta.");
  if (!alvo?.user?.email) throw new ErroDefinitivo("Conta sem e-mail de acesso.");

  // generateLink NAO envia e-mail: devolve o token, trocado por sessao aqui.
  const { data: link, error: eLink } = await servico.auth.admin.generateLink({
    type: "magiclink",
    email: alvo.user.email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (eLink || !tokenHash) throw new Error("Não foi possível abrir a sessão.");

  const { url, anonKey } = getSupabaseEnv();
  const anonimo = createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: troca, error: eTroca } = await anonimo.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  const s = troca?.session;
  if (eTroca || !s || s.user.id !== userId) throw new Error("Não foi possível abrir a sessão.");

  return {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expira_em: (s.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000,
  };
}

export interface SessaoDaPessoa {
  userId: string;
  /** Cliente com a sessao da pessoa: anon key + JWT dela, sob RLS. */
  supabase: SupabaseClient;
  /**
   * O cabecalho `Cookie` com a sessao dela, no formato do `@supabase/ssr`, para
   * chamar uma rota do proprio app (`/api/financial-installments`) em vez de
   * reescrever a regra de dinheiro que mora la.
   */
  cookiesDaSessao: () => Promise<string>;
}

export async function sessaoDaPessoa(userId: string): Promise<SessaoDaPessoa> {
  const sessao = await abrirSessao(userId);
  const { url, anonKey } = getSupabaseEnv();

  const supabase = createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${sessao.access_token}` } },
  });

  const cookiesDaSessao = async () => {
    // O proprio @supabase/ssr escreve os cookies: nome, codificacao e
    // fatiamento ficam iguais aos do navegador, sem copiar o formato aqui.
    const pote = new Map<string, string>();
    const ssr = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => Array.from(pote, ([name, value]) => ({ name, value })),
        setAll: (lista) => {
          for (const { name, value } of lista) {
            if (value) pote.set(name, value);
            else pote.delete(name);
          }
        },
      },
    });
    const { error } = await ssr.auth.setSession({
      access_token: sessao.access_token,
      refresh_token: sessao.refresh_token,
    });
    if (error) throw new Error("Não foi possível montar a sessão para a rota.");
    return Array.from(pote, ([n, v]) => `${n}=${v}`).join("; ");
  };

  return { userId, supabase, cookiesDaSessao };
}

/** Esquece a sessao guardada (ex.: a rota respondeu 401 com ela). */
export function esquecerSessao(userId: string) {
  sessoes.delete(userId);
}
