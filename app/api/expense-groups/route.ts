import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { moedaDoGrupoParaGravar } from "@/lib/moeda-do-grupo";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("👤 USUÁRIO API:", user.id, user.email);

    // Usar abordagem direta e simples
    console.log("🔧 Buscando grupos do usuário...");

    // Buscar todos os grupos ativos apenas (não arquivados)
    const { data: allGroups, error: allGroupsError } = await supabase
      .from("expense_groups")
      .select(
        `
            id,
            name,
            description,
            group_code,
            group_type,
            default_split_type,
            currency,
            photo_url,
            created_at,
            created_by,
            creator:profiles!expense_groups_created_by_fkey(full_name, avatar_url)
          `
      )
      .eq("is_active", true);

    if (allGroupsError) {
      console.error("Erro ao buscar grupos:", allGroupsError);
      return NextResponse.json(
        { error: "Failed to fetch groups" },
        { status: 500 }
      );
    }

    // Buscar todos os membros
    const { data: allMembers, error: allMembersError } = await supabase
      .from("group_members")
      .select(
        `
            id,
            group_id,
            user_id,
            role,
            status,
            percentage,
            user:profiles!group_members_user_id_fkey(id, full_name, avatar_url)
          `
      )
      .eq("status", "active");

    if (allMembersError) {
      console.error("Erro ao buscar membros:", allMembersError);
      return NextResponse.json(
        { error: "Failed to fetch members" },
        { status: 500 }
      );
    }

    console.log("📊 DADOS BRUTOS:", {
      totalGroups: allGroups?.length || 0,
      totalMembers: allMembers?.length || 0,
      userGroups:
        allMembers
          ?.filter((m) => m.user_id === user.id)
          .map((m) => m.group_id) || [],
    });

    // Filtrar grupos onde o usuário é membro
    const userGroupIds =
      allMembers
        ?.filter((member) => member.user_id === user.id)
        ?.map((member) => member.group_id) || [];

    const userGroups =
      allGroups?.filter((group) => userGroupIds.includes(group.id)) || [];

    // Combinar grupos com seus membros
    const groupsWithMembers = userGroups.map((group) => ({
      ...group,
      members:
        allMembers?.filter((member) => member.group_id === group.id) || [],
    }));

    console.log("🎯 RESULTADO FINAL:", {
      groupsCount: groupsWithMembers.length,
      groups: groupsWithMembers.map((g) => ({
        id: g.id,
        name: g.name,
        membersCount: g.members.length,
        memberNames: g.members
          .map((m: any) => m.user?.full_name)
          .filter(Boolean),
      })),
    });

    // Os pedidos de entrada ainda na fila (migration 029).
    //
    // Não dá para tirar isso das queries acima: quem está `pending` não é
    // membro para a RLS (`is_group_member` exige status = 'active'), então a
    // linha de `expense_groups` é invisível para ela e o nome do grupo não
    // existe deste lado. O que ela enxerga é a própria linha de
    // `group_members` -- um UUID e nada mais.
    //
    // Sem esta lista, digitar o código certo num grupo privado não deixa
    // vestígio nenhum na tela: é o "o grupo não está aparecendo para ela" da
    // HMO-190. A RPC é SECURITY DEFINER e devolve só id, nome e data dos
    // pedidos do próprio chamador -- o suficiente para dizer "você está
    // esperando fulano aprovar", sem abrir o conteúdo do grupo.
    const { data: pendingRows, error: pendingError } = await supabase.rpc(
      "my_pending_group_requests"
    );

    // Um erro aqui não pode derrubar a lista de grupos: os grupos de verdade
    // são a função principal da tela, e o pedido pendente é um aviso.
    if (pendingError) {
      console.error("Erro ao buscar pedidos pendentes:", pendingError);
    }

    const pendingRequests = (pendingRows || []).map((row: any) => ({
      group_id: row.group_id,
      group_name: row.group_name,
      requested_at: row.requested_at,
    }));

    return NextResponse.json({
      groups: groupsWithMembers,
      pendingRequests,
      debug: {
        total_groups_found: allGroups?.length || 0,
        user_groups_found: groupsWithMembers.length,
        pending_requests_found: pendingRequests.length,
        user_id: user.id,
      },
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Manter POST existente
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      name,
      description,
      group_type = "private",
      default_split_type = "equal",
      photo_url,
    } = body;

    // Validações básicas
    if (!name || name.trim().length < 3) {
      return NextResponse.json(
        { error: "Group name must be at least 3 characters" },
        { status: 400 }
      );
    }

    if (!["public", "private"].includes(group_type)) {
      return NextResponse.json(
        { error: "Group type must be public or private" },
        { status: 400 }
      );
    }

    if (
      !["equal", "percentage", "custom", "proportional"].includes(
        default_split_type
      )
    ) {
      return NextResponse.json(
        { error: "Invalid default split type" },
        { status: 400 }
      );
    }

    // A moeda da viagem (migration 026). Campo ausente vira BRL -- o DEFAULT da
    // coluna e o que sempre foi verdade para todo grupo que ja existia --, mas
    // um codigo fora do catalogo e 400 e nao BRL: gravar real quando alguem
    // pediu outra coisa criaria uma viagem na moeda errada em silencio, e o
    // CHECK do banco devolveria 500 sem apontar o campo.
    const currency = moedaDoGrupoParaGravar(body.currency);

    if (currency === null) {
      return NextResponse.json(
        { error: "Moeda desconhecida para o grupo" },
        { status: 400 }
      );
    }

    // Criar grupo
    const { data: group, error: groupError } = await supabase
      .from("expense_groups")
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
        group_type,
        default_split_type,
        currency,
        photo_url: photo_url || null,
        created_by: user.id,
      })
      .select("*")
      .single();

    if (groupError) {
      console.error("Group creation error:", groupError);
      return NextResponse.json(
        { error: "Failed to create group" },
        { status: 500 }
      );
    }

    // Buscar grupo completo básico (sem joins complexos)
    const completeGroup = {
      ...group,
      creator: {
        full_name: user.user_metadata?.full_name || user.email,
        avatar_url: null,
      },
      members: [
        {
          id: "temp-id",
          role: "admin",
          status: "active",
          percentage: 0,
          user: {
            id: user.id,
            full_name: user.user_metadata?.full_name || user.email,
            avatar_url: null,
          },
        },
      ],
    };

    return NextResponse.json(
      {
        message: "Group created successfully",
        group: completeGroup,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
