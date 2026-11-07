/**
 * Metadados do recurso protegido (RFC 9728). Servido em
 * `/.well-known/oauth-protected-resource[/api/mcp]` pelo rewrite do
 * `next.config.js`: e o endereco que o 401 de `/api/mcp` aponta.
 */
import type { NextRequest } from "next/server";
import { json, metadadosDoRecurso, origemDoPedido, preflight } from "@/lib/services/mcp-http";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export function GET(request: NextRequest) {
  return json(metadadosDoRecurso(origemDoPedido(request)));
}
