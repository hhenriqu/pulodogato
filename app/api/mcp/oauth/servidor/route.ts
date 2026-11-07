/**
 * Metadados do servidor de autorizacao (RFC 8414). Servido em
 * `/.well-known/oauth-authorization-server` (e na variante OpenID) pelo
 * rewrite do `next.config.js`.
 */
import type { NextRequest } from "next/server";
import { json, metadadosDoServidor, origemDoPedido, preflight } from "@/lib/services/mcp-http";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export function GET(request: NextRequest) {
  return json(metadadosDoServidor(origemDoPedido(request)));
}
