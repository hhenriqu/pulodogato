import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  nomeDoParticipanteParaGravar,
  respostaDoErroDoBanco,
} from "@/lib/membro-sem-conta";

/**
 * Adiciona ao grupo um participante SEM CONTA no app (migration 077, RN025).
 *
 * Corpo: `{ display_name }`. Quem nao tem conta nao recebe convite nem faz
 * login: a linha nasce `active`, com `user_id` nulo e o nome digitado, e ja
 * entra na divisao das proximas despesas.
 *
 * Quem pode: o admin do grupo. Quem decide isso e a RLS de `group_members`
 * (`group_members_insert`, 002: `is_group_admin`), e nao um IF aqui -- a rota
 * so traduz a recusa para 403.
 *
 * Grupo com dia de fechamento recusa (PDG77, 409): o fechamento gera uma conta
 * para cada pessoa com conta, e quem nao tem nao teria onde recebe-la.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { groupId } = params;
    const body = await request.json().catch(() => ({}));

    const nome = nomeDoParticipanteParaGravar(body?.display_name);
    if (!nome.ok) {
      return NextResponse.json({ error: nome.erro }, { status: 400 });
    }

    const { data: membro, error } = await supabase
      .from("group_members")
      .insert({
        group_id: groupId,
        user_id: null,
        display_name: nome.nome,
        role: "member",
        status: "active",
      })
      .select("id, role, status, percentage, display_name")
      .single();

    if (error || !membro) {
      const { status, mensagem } = respostaDoErroDoBanco(error ?? {});
      console.error("Erro ao adicionar participante sem conta:", error);
      return NextResponse.json({ error: mensagem }, { status });
    }

    return NextResponse.json({
      success: true,
      member: {
        ...membro,
        sem_conta: true,
        user: { id: null, full_name: membro.display_name, avatar_url: null },
      },
    });
  } catch (error) {
    console.error("Erro em POST members:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
