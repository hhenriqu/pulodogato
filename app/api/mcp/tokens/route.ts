/**
 * As conexoes do Claude da pessoa logada, para a tela de Configuracoes.
 *
 *   GET    -> lista (pela RLS: so as proprias linhas, sem o hash)
 *   POST   -> gera um token pessoal, para clientes que nao fazem OAuth
 *             (Claude Code com `--header`, scripts). Volta em claro UMA vez.
 *   DELETE -> ?id=<uuid> revoga (UPDATE de `revogado_em` pela RLS da 085)
 *
 * So o POST usa a service role, porque `authenticated` nao tem INSERT na 085:
 * o hash tem que vir de um token que o SERVIDOR sorteou.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { hashDoToken, nomeDoCliente, novoToken, prefixoVisivel } from "@/lib/acesso-pelo-claude";
import { clienteDeServico } from "@/lib/services/mcp-sessao";

export const dynamic = "force-dynamic";

async function pessoa() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET() {
  const { supabase, user } = await pessoa();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { data, error } = await supabase
    .from("tokens_do_claude")
    .select("id, nome, prefixo, criado_em, usado_em, revogado_em")
    .order("criado_em", { ascending: false });

  if (error) {
    // 42P01: a 085 ainda nao foi colada no SQL Editor.
    const semTabela = error.code === "42P01" || /tokens_do_claude/.test(error.message ?? "");
    return NextResponse.json(
      {
        error: semTabela
          ? "A conexão com o Claude ainda não foi ativada no banco (migration 085)."
          : "Não foi possível ler as conexões.",
      },
      { status: semTabela ? 503 : 500 }
    );
  }
  return NextResponse.json({ tokens: data ?? [] });
}

export async function POST(request: NextRequest) {
  const { user } = await pessoa();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const servico = clienteDeServico();
  if (!servico) {
    return NextResponse.json({ error: "Servidor sem SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => ({}))) as { nome?: unknown };
  const token = novoToken();

  const { error } = await servico.from("tokens_do_claude").insert({
    user_id: user.id,
    nome: nomeDoCliente(corpo.nome ?? "Token pessoal"),
    prefixo: prefixoVisivel(token),
    token_hash: hashDoToken(token),
  });
  if (error) {
    console.error("[mcp] erro ao gerar token pessoal", error);
    return NextResponse.json({ error: "Não foi possível gerar o token." }, { status: 500 });
  }

  return NextResponse.json({ token }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const { supabase, user } = await pessoa();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id") ?? "";
  const { data, error } = await supabase
    .from("tokens_do_claude")
    .update({ revogado_em: new Date().toISOString() })
    .eq("id", id)
    .select("id");

  if (error || !data || data.length === 0) {
    return NextResponse.json({ error: "Conexão não encontrada." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
