/**
 * O "Permitir" da tela `/conectar-claude`.
 *
 * Roda com a sessao do NAVEGADOR (cookie): quem autoriza e quem esta logado
 * no app. Confere o pedido do OAuth (cliente assinado, endereco de retorno
 * registrado, PKCE S256) e devolve o endereco de retorno com um codigo de
 * autorizacao assinado, valido por 5 minutos. A tela redireciona para ele.
 *
 * Nao ha CORS aqui de proposito: so a propria tela do app chama esta rota.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  abrirPacote,
  assinarPacote,
  type ClienteRegistrado,
  type CodigoDeAutorizacao,
} from "@/lib/acesso-pelo-claude";
import { segredoDoOAuth } from "@/lib/services/mcp-sessao";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const segredo = segredoDoOAuth();
  if (!segredo) {
    return NextResponse.json({ error: "Conexão com o Claude não configurada no servidor." }, { status: 503 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Entre na sua conta primeiro." }, { status: 401 });

  const corpo = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const clientId = String(corpo.client_id ?? "");
  const retorno = String(corpo.redirect_uri ?? "");
  const desafio = String(corpo.code_challenge ?? "");
  const metodo = String(corpo.code_challenge_method ?? "");
  const estado = typeof corpo.state === "string" ? corpo.state : null;

  const cliente = abrirPacote<ClienteRegistrado>(clientId, segredo);
  if (!cliente || cliente.t !== "cliente") {
    return NextResponse.json({ error: "Cliente desconhecido. Remova e adicione o conector de novo." }, { status: 400 });
  }
  if (!cliente.retornos.includes(retorno)) {
    return NextResponse.json({ error: "Endereço de retorno não registrado por este cliente." }, { status: 400 });
  }
  if (metodo !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(desafio)) {
    return NextResponse.json({ error: "Pedido sem PKCE S256." }, { status: 400 });
  }

  const codigo: CodigoDeAutorizacao = {
    t: "codigo",
    usuario: user.id,
    cliente: clientId,
    retorno,
    desafio,
    exp: Math.floor(Date.now() / 1000) + 300,
  };

  const destino = new URL(retorno);
  destino.searchParams.set("code", assinarPacote(codigo, segredo));
  if (estado !== null) destino.searchParams.set("state", estado);

  return NextResponse.json({ redirect: destino.toString(), cliente: cliente.nome });
}
