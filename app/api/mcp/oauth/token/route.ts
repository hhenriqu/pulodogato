/**
 * Troca do codigo de autorizacao pelo token (OAuth 2.1, cliente publico + PKCE).
 *
 * O codigo e um pacote assinado (`/api/mcp/oauth/autorizar`) com a pessoa, o
 * cliente, o endereco de retorno e o desafio PKCE. Aqui se confere tudo isso,
 * cria a linha em `tokens_do_claude` (085) com o SHA-256 do token e do codigo
 * -- o UNIQUE de `codigo_hash` torna o codigo de uso unico -- e devolve o
 * token em claro UMA vez.
 *
 * O token nao expira sozinho: vale ate a pessoa revogar em Configuracoes.
 */
import type { NextRequest } from "next/server";
import {
  abrirPacote,
  hashDoToken,
  nomeDoCliente,
  novoToken,
  pkceConfere,
  prefixoVisivel,
  type ClienteRegistrado,
  type CodigoDeAutorizacao,
} from "@/lib/acesso-pelo-claude";
import { json, preflight } from "@/lib/services/mcp-http";
import { clienteDeServico, segredoDoOAuth } from "@/lib/services/mcp-sessao";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

const recusa = (error: string, error_description: string, status = 400) =>
  json({ error, error_description }, status);

/** O corpo chega como formulario (o padrao do OAuth) ou, as vezes, JSON. */
async function lerCorpo(request: NextRequest): Promise<Record<string, string>> {
  const tipo = request.headers.get("content-type") ?? "";
  if (tipo.includes("application/json")) {
    const j = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, String(v ?? "")]));
  }
  const texto = await request.text();
  return Object.fromEntries(new URLSearchParams(texto));
}

export async function POST(request: NextRequest) {
  const segredo = segredoDoOAuth();
  const servico = clienteDeServico();
  if (!segredo || !servico) return recusa("server_error", "OAuth não configurado.", 503);

  const corpo = await lerCorpo(request);

  if (corpo.grant_type !== "authorization_code") {
    return recusa("unsupported_grant_type", "Só authorization_code.");
  }

  const codigo = abrirPacote<CodigoDeAutorizacao>(corpo.code, segredo);
  if (!codigo || codigo.t !== "codigo") {
    return recusa("invalid_grant", "Código inválido ou expirado.");
  }
  if (corpo.client_id && corpo.client_id !== codigo.cliente) {
    return recusa("invalid_grant", "O código é de outro cliente.");
  }
  if (corpo.redirect_uri && corpo.redirect_uri !== codigo.retorno) {
    return recusa("invalid_grant", "redirect_uri diferente do da autorização.");
  }
  if (!pkceConfere(corpo.code_verifier ?? "", codigo.desafio)) {
    return recusa("invalid_grant", "code_verifier não confere.");
  }

  const cliente = abrirPacote<ClienteRegistrado>(codigo.cliente, segredo);
  const token = novoToken();

  const { error } = await servico.from("tokens_do_claude").insert({
    user_id: codigo.usuario,
    nome: nomeDoCliente(cliente?.nome),
    prefixo: prefixoVisivel(token),
    token_hash: hashDoToken(token),
    codigo_hash: hashDoToken(corpo.code),
  });

  if (error) {
    // 23505 em `codigo_hash`: o codigo ja foi trocado uma vez.
    if (error.code === "23505") return recusa("invalid_grant", "Código já usado.");
    console.error("[mcp] erro ao gravar o token", error);
    return recusa("server_error", "Não foi possível gerar o acesso.", 500);
  }

  return json({ access_token: token, token_type: "Bearer", scope: "lancamentos" });
}
