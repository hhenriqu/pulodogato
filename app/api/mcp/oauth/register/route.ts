/**
 * Registro dinamico de cliente OAuth (RFC 7591), SEM ESTADO.
 *
 * O Claude registra a si mesmo antes do primeiro login. Em vez de gravar o
 * cliente numa tabela -- um endpoint publico que qualquer um poderia encher --,
 * o `client_id` devolvido E o registro: um pacote assinado com o nome e os
 * enderecos de retorno (`assinarPacote`). Na autorizacao e na troca do codigo,
 * o servidor so confere a assinatura.
 */
import type { NextRequest } from "next/server";
import {
  assinarPacote,
  enderecoDeRetornoAceito,
  nomeDoCliente,
  type ClienteRegistrado,
} from "@/lib/acesso-pelo-claude";
import { json, preflight } from "@/lib/services/mcp-http";
import { segredoDoOAuth } from "@/lib/services/mcp-sessao";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function POST(request: NextRequest) {
  const segredo = segredoDoOAuth();
  if (!segredo) return json({ error: "server_error", error_description: "OAuth não configurado." }, 503);

  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const retornos = Array.isArray(corpo?.redirect_uris) ? (corpo!.redirect_uris as unknown[]) : [];

  if (
    retornos.length === 0 ||
    retornos.length > 10 ||
    !retornos.every((r) => typeof r === "string" && enderecoDeRetornoAceito(r))
  ) {
    return json(
      {
        error: "invalid_redirect_uri",
        error_description: "redirect_uris precisa de 1 a 10 endereços https (ou http://localhost).",
      },
      400
    );
  }

  const cliente: ClienteRegistrado = {
    t: "cliente",
    nome: nomeDoCliente(corpo?.client_name),
    retornos: retornos as string[],
  };

  return json(
    {
      client_id: assinarPacote(cliente, segredo),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: cliente.nome,
      redirect_uris: cliente.retornos,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201
  );
}
