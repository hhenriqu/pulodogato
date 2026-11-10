/**
 * SERVIDOR MCP DO PULO DO GATO
 *
 * A URL que a pessoa adiciona no Claude como conector:
 *
 *     https://<app>/api/mcp
 *
 * Transporte "Streamable HTTP" do MCP, no modo sem estado: cada POST traz uma
 * mensagem JSON-RPC e volta com a resposta em JSON. Nao ha sessao MCP nem
 * stream -- nenhuma ferramenta aqui precisa empurrar nada para o cliente.
 *
 * AUTENTICACAO: `Authorization: Bearer pdg_...`. Sem token (ou com um
 * revogado) a resposta e 401 com `WWW-Authenticate` apontando os metadados do
 * OAuth -- e assim que o Claude descobre que deve abrir a tela de login do
 * app (`/conectar-claude`). O token vira uma sessao normal da propria pessoa
 * (`lib/services/mcp-sessao.ts`): tudo passa pela RLS.
 */

import type { NextRequest } from "next/server";
import { tokenDoCabecalho } from "@/lib/acesso-pelo-claude";
import { acharFerramenta, FERRAMENTAS } from "@/lib/services/mcp-ferramentas";
import { CABECALHOS_CORS, json, origemDoPedido, preflight } from "@/lib/services/mcp-http";
import { donoDoToken, esquecerSessao, sessaoDaPessoa } from "@/lib/services/mcp-sessao";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VERSOES = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCOES =
  "Ferramentas do Pulo do Gato, o app de finanças da pessoa. Para lançar, descubra os nomes com " +
  "listar_contas e listar_categorias (uma vez por conversa basta) e use os nomes exatos. Valores são " +
  "sempre positivos, em reais; a data padrão é hoje. Se a conta ou a categoria não estiver clara, " +
  "pergunte em vez de chutar. Depois de lançar, diga o que foi gravado. Para investimentos, " +
  "confira a carteira com listar_investimentos antes de lançar, para não duplicar.";

interface Pedido {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const resposta = (id: Pedido["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const falha = (id: Pedido["id"], code: number, message: string) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

function naoAutorizado(request: NextRequest, motivo: string) {
  const origem = origemDoPedido(request);
  return json({ error: "unauthorized", error_description: motivo }, 401, {
    "WWW-Authenticate":
      `Bearer realm="Pulo do Gato", error="invalid_token", ` +
      `resource_metadata="${origem}/.well-known/oauth-protected-resource/api/mcp"`,
  });
}

export function OPTIONS() {
  return preflight();
}

/** Sem stream do servidor para o cliente neste modo. */
export function GET() {
  return new Response(null, { status: 405, headers: { ...CABECALHOS_CORS, Allow: "POST" } });
}

/** Sem sessao MCP para encerrar. */
export function DELETE() {
  return new Response(null, { status: 405, headers: { ...CABECALHOS_CORS, Allow: "POST" } });
}

export async function POST(request: NextRequest) {
  const token = tokenDoCabecalho(request.headers.get("authorization"));
  if (!token) return naoAutorizado(request, "Conecte sua conta do Pulo do Gato.");

  const dono = await donoDoToken(token);
  if (!dono) return naoAutorizado(request, "Token inválido ou revogado.");

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return json(falha(null, -32700, "JSON inválido"), 400);
  }

  // Lote (2025-03-26) ou mensagem unica.
  const lote = Array.isArray(corpo);
  const pedidos = (lote ? corpo : [corpo]) as Pedido[];
  const respostas: unknown[] = [];

  for (const pedido of pedidos) {
    const r = await atender(request, dono.userId, pedido);
    if (r) respostas.push(r);
  }

  // So notificacoes (sem `id`): 202 sem corpo, como manda o transporte.
  if (respostas.length === 0) {
    return new Response(null, { status: 202, headers: CABECALHOS_CORS });
  }
  return json(lote ? respostas : respostas[0]);
}

async function atender(request: NextRequest, userId: string, pedido: Pedido) {
  if (!pedido || typeof pedido !== "object" || typeof pedido.method !== "string") {
    return falha(pedido?.id, -32600, "Pedido JSON-RPC inválido");
  }
  const ehNotificacao = pedido.id === undefined || pedido.id === null;
  if (ehNotificacao) return null;

  switch (pedido.method) {
    case "initialize": {
      const pedida = String(pedido.params?.protocolVersion ?? "");
      return resposta(pedido.id, {
        protocolVersion: VERSOES.includes(pedida) ? pedida : VERSOES[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "pulodogato", title: "Pulo do Gato", version: "1.0.0" },
        instructions: INSTRUCOES,
      });
    }

    case "ping":
      return resposta(pedido.id, {});

    case "tools/list":
      return resposta(pedido.id, {
        tools: FERRAMENTAS.map(({ name, title, description, inputSchema, annotations }) => ({
          name,
          title,
          description,
          inputSchema,
          annotations,
        })),
      });

    case "tools/call": {
      const ferramenta = acharFerramenta(pedido.params?.name);
      if (!ferramenta) return falha(pedido.id, -32602, `Ferramenta desconhecida: ${String(pedido.params?.name)}`);
      const args = (pedido.params?.arguments ?? {}) as Record<string, unknown>;

      try {
        const sessao = await sessaoDaPessoa(userId);
        const r = await ferramenta.executar({ sessao, origem: origemDoPedido(request) }, args);
        return resposta(pedido.id, {
          content: [{ type: "text", text: r.texto }],
          isError: Boolean(r.erro),
        });
      } catch (e) {
        // Uma sessao que expirou entre a guarda e o uso: a proxima chamada abre outra.
        esquecerSessao(userId);
        console.error("[mcp] erro na ferramenta", ferramenta.name, e);
        return resposta(pedido.id, {
          content: [{ type: "text", text: e instanceof Error ? e.message : "Erro inesperado." }],
          isError: true,
        });
      }
    }

    case "resources/list":
      return resposta(pedido.id, { resources: [] });
    case "prompts/list":
      return resposta(pedido.id, { prompts: [] });

    default:
      return falha(pedido.id, -32601, `Método não suportado: ${pedido.method}`);
  }
}
