/**
 * ACESSO PELO CLAUDE -- pedacos HTTP comuns as rotas de `app/api/mcp/**`.
 */

import { NextResponse, type NextRequest } from "next/server";

/**
 * `https://<host>` de quem chamou. Atras da Vercel o host real vem em
 * `x-forwarded-host`; e ele que o Claude usou, e e ele que tem que aparecer
 * nos metadados do OAuth -- senao o Claude recusa um emissor diferente da URL
 * que a pessoa colou.
 */
export function origemDoPedido(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto =
    request.headers.get("x-forwarded-proto") ??
    (request.nextUrl.protocol ? request.nextUrl.protocol.replace(":", "") : "https");
  return host ? `${proto}://${host}` : request.nextUrl.origin;
}

/**
 * CORS aberto: os clientes do MCP que rodam no navegador (MCP Inspector)
 * precisam. Nao abre nada: toda chamada exige o token no cabecalho, que um
 * site qualquer nao tem -- e nenhum cookie e aceito por estas rotas.
 */
export const CABECALHOS_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

export function json(corpo: unknown, status = 200, extras: Record<string, string> = {}) {
  return NextResponse.json(corpo, {
    status,
    headers: { ...CABECALHOS_CORS, "Cache-Control": "no-store", ...extras },
  });
}

export function preflight() {
  return new NextResponse(null, { status: 204, headers: CABECALHOS_CORS });
}

/** Os metadados do recurso protegido (RFC 9728). */
export function metadadosDoRecurso(origem: string) {
  return {
    resource: `${origem}/api/mcp`,
    authorization_servers: [origem],
    bearer_methods_supported: ["header"],
    resource_name: "Pulo do Gato",
    resource_documentation: `${origem}/dashboard/settings`,
  };
}

/** Os metadados do servidor de autorizacao (RFC 8414). */
export function metadadosDoServidor(origem: string) {
  return {
    issuer: origem,
    authorization_endpoint: `${origem}/conectar-claude`,
    token_endpoint: `${origem}/api/mcp/oauth/token`,
    registration_endpoint: `${origem}/api/mcp/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["lancamentos"],
  };
}
