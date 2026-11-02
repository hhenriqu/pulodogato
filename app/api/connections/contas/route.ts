// GET /api/connections/contas?pessoa=<id>
//
// O que esta registrado entre mim e uma conexao, mes a mes (075, RN020.11): as
// contas "A receber de" e "Pagamento a" que o banco gera para cada lado da
// divisao com pessoa -- do lancamento avulso (070) e da conta fixa, prevista e
// parcelada (075). Todas sao contas previstas MINHAS, achadas por
// `contraparte_id`, entao a RLS da agenda (005) ja basta: ninguem le a conta do
// outro lado, e cada um ve o proprio "quanto pagar" e "quanto receber".
//
// A conexao e conferida antes: sem ela a tela mostraria um nome qualquer ao
// lado de uma lista vazia, e um id solto na URL viraria uma pergunta sobre
// quem e aquela pessoa.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { resumoDaConexao, type ContaDaConexao } from "@/lib/conta-da-conexao";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PerfilDaConexao = {
  id: string;
  full_name: string | null;
  nickname: string | null;
  avatar_url: string | null;
} | null;

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const pessoa = request.nextUrl.searchParams.get("pessoa");
    // O id entra no filtro `or()` do PostgREST: so passa uuid, para nenhuma
    // virgula ou parentese da URL virar filtro.
    if (!pessoa || !UUID.test(pessoa)) {
      return NextResponse.json({ error: "Informe a conexão" }, { status: 400 });
    }

    const { data: conexao, error: erroDaConexao } = await supabase
      .from("user_connections")
      .select(
        `
        requester_id,
        requested_id,
        requester:profiles!user_connections_requester_id_fkey(id, full_name, nickname, avatar_url),
        requested:profiles!user_connections_requested_id_fkey(id, full_name, nickname, avatar_url)
      `
      )
      .eq("status", "accepted")
      .or(
        `and(requester_id.eq.${user.id},requested_id.eq.${pessoa}),` +
          `and(requester_id.eq.${pessoa},requested_id.eq.${user.id})`
      )
      .returns<
        {
          requester_id: string;
          requested_id: string;
          requester: PerfilDaConexao;
          requested: PerfilDaConexao;
        }[]
      >()
      .maybeSingle();

    if (erroDaConexao) {
      console.error("Erro ao ler a conexão:", erroDaConexao);
      return NextResponse.json({ error: "Erro ao ler a conexão" }, { status: 500 });
    }
    if (!conexao) {
      return NextResponse.json(
        { error: "Esta pessoa não é uma conexão aceita" },
        { status: 404 }
      );
    }

    // Pela mesma razao de /api/personal-finance/connections: o lado sai de
    // `requester_id`, e nao do embed, que pode vir nulo.
    const perfil =
      conexao.requester_id === user.id ? conexao.requested : conexao.requester;

    const { data: contas, error } = await supabase
      .from("scheduled_transactions")
      .select("id, description, amount, due_date, status, transaction_type, paid_date")
      .eq("user_id", user.id)
      .eq("contraparte_id", pessoa)
      .order("due_date", { ascending: true })
      .limit(1000)
      .returns<ContaDaConexao[]>();

    if (error) {
      // 42703: a coluna `contraparte_id` e da 075. Antes da colagem a tela diz
      // o que falta, em vez de um erro generico.
      if (error.code === "42703") {
        return NextResponse.json(
          { error: "Falta aplicar a migration 075 no banco." },
          { status: 503 }
        );
      }
      console.error("Erro ao ler as contas da conexão:", error);
      return NextResponse.json({ error: "Erro ao ler as contas" }, { status: 500 });
    }

    return NextResponse.json({
      pessoa: {
        id: pessoa,
        full_name: perfil?.full_name ?? null,
        nickname: perfil?.nickname ?? null,
        avatar_url: perfil?.avatar_url ?? null,
      },
      meses: resumoDaConexao(contas ?? []),
    });
  } catch (error) {
    console.error("Erro na API das contas da conexão:", error);
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 });
  }
}
