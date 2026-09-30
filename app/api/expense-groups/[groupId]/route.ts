import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { divisaoPendenteDoGrupo } from "@/lib/services/expense-groups";
import { moedaDoGrupoParaGravar } from "@/lib/moeda-do-grupo";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  try {
    const supabase = createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { groupId } = params;

    console.log("Getting group details for:", groupId);

    // Get group details
    const { data: group, error: groupError } = await supabase
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
        creator:profiles!expense_groups_created_by_fkey (
          full_name,
          avatar_url
        )
      `
      )
      .eq("id", groupId)
      .single();

    if (groupError || !group) {
      console.error("Group error:", groupError);
      return NextResponse.json(
        { error: "Grupo não encontrado" },
        { status: 404 }
      );
    }

    // Get group members
    const { data: members, error: membersError } = await supabase
      .from("group_members")
      .select(
        `
        id,
        role,
        status,
        percentage,
        user:profiles!group_members_user_id_fkey (
          id,
          full_name,
          avatar_url
        )
      `
      )
      .eq("group_id", groupId)
      .eq("status", "active");

    if (membersError) {
      console.error("Members error:", membersError);
    }

    // Check if user is member of this group
    const userIsMember = members?.some(
      (member: any) => member.user?.id === user.id
    );
    if (!userIsMember) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    const groupWithMembers = {
      ...group,
      members: members || [],
    };

    console.log("Group loaded successfully:", groupWithMembers.name);

    return NextResponse.json({
      success: true,
      group: groupWithMembers,
    });
  } catch (error) {
    console.error("Error in group detail API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Editar o grupo -- inclusive a MOEDA DA VIAGEM (migration 026, HMO-182).
 *
 * ESTE HANDLER NAO EXISTIA, E A TELA JA O CHAMAVA
 * -----------------------------------------------
 * "Editar Grupo" na tela de grupos manda `PUT /api/expense-groups/{id}` desde
 * que o botao existe, e este arquivo exportava apenas GET e DELETE. Em Next.js
 * um metodo sem export vira **405**, e a tela cai no ramo `!response.ok`
 * mostrando "Erro ao atualizar grupo" -- a mesma frase de um erro de rede.
 * Renomear o grupo nunca funcionou, e nao havia como descobrir isso pela
 * mensagem. O item 3 desta issue ("moeda no grupo: criar e EDITAR") nao tinha
 * onde entrar antes de o handler existir.
 *
 * POR QUE SO ADMIN
 * ----------------
 * Mesma regra do DELETE logo abaixo. A moeda da viagem nao e cosmetica: ela e a
 * moeda sugerida a cada despesa nova e a moeda em que a tela apresenta o saldo
 * de TODOS os membros. Qualquer um do grupo poder troca-la faria o saldo dos
 * outros mudar de moeda sem aviso.
 *
 * A troca de moeda NAO reescreve despesa nenhuma, e e isso que a torna segura:
 * cada lancamento carrega a propria moeda e a propria cotacao congelada
 * (`financial_transactions.currency` / `exchange_rate`), e o saldo continua
 * saindo em BRL da view. Trocar a moeda do grupo depois de a viagem comecar muda
 * o que o formulario SUGERE e a moeda em que a tela ESCREVE o saldo -- nao o
 * valor de nada que ja foi gasto.
 *
 * A lista de campos e fechada de proposito: um `...body` deixaria um cliente
 * mandar `group_code` (a chave de convite), `created_by` ou `is_active` -- o
 * ultimo desarquivaria o grupo por um caminho que nao passa pela checagem de
 * `/restore`.
 */
export async function PUT(
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
    const body = await request.json();

    const { data: membership } = await supabase
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (!membership) {
      return NextResponse.json(
        { error: "Grupo não encontrado ou acesso negado" },
        { status: 404 }
      );
    }

    if (membership.role !== "admin") {
      return NextResponse.json(
        { error: "Apenas administradores podem editar o grupo" },
        { status: 403 }
      );
    }

    const mudancas: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const nome = String(body.name).trim();
      if (nome.length < 3) {
        return NextResponse.json(
          { error: "O nome do grupo precisa de pelo menos 3 caracteres" },
          { status: 400 }
        );
      }
      mudancas.name = nome;
    }

    if (body.description !== undefined) {
      const descricao = String(body.description ?? "").trim();
      mudancas.description = descricao || null;
    }

    if (body.group_type !== undefined) {
      if (!["public", "private"].includes(body.group_type)) {
        return NextResponse.json(
          { error: "O tipo do grupo tem que ser public ou private" },
          { status: 400 }
        );
      }
      mudancas.group_type = body.group_type;
    }

    if (body.default_split_type !== undefined) {
      if (
        !["equal", "percentage", "custom", "proportional"].includes(
          body.default_split_type
        )
      ) {
        return NextResponse.json(
          { error: "Tipo de divisão inválido" },
          { status: 400 }
        );
      }
      mudancas.default_split_type = body.default_split_type;
    }

    // A moeda so entra quando veio no corpo. `moedaDoGrupoParaGravar` devolve
    // BRL para campo ausente, e usar isso aqui faria toda edicao de NOME zerar a
    // moeda de uma viagem em dolar -- de longe o pior desfecho possivel desta
    // rota, porque a tela seguiria mostrando os saldos e so o rotulo mudaria.
    if (body.currency !== undefined) {
      const currency = moedaDoGrupoParaGravar(body.currency);
      if (currency === null) {
        return NextResponse.json(
          { error: "Moeda desconhecida para o grupo" },
          { status: 400 }
        );
      }
      mudancas.currency = currency;
    }

    if (Object.keys(mudancas).length === 0) {
      return NextResponse.json(
        { error: "Nada para atualizar" },
        { status: 400 }
      );
    }

    const { data: group, error: updateError } = await supabase
      .from("expense_groups")
      .update(mudancas)
      .eq("id", groupId)
      .select(
        "id, name, description, group_code, group_type, default_split_type, currency, photo_url, created_at"
      )
      .single();

    if (updateError) {
      console.error("Erro ao atualizar grupo:", updateError);
      return NextResponse.json(
        { error: `Erro ao atualizar grupo: ${updateError.message}` },
        { status: 500 }
      );
    }

    // `update` sem linha afetada NAO e erro no PostgREST: a RLS pode ter filtrado
    // a linha e o `.single()` devolve erro de zero linhas. O ramo acima cobre
    // isso, mas a guarda explicita fica porque "grupo atualizado" com `group`
    // nulo e o tipo de resposta que a tela comemora sem nada ter mudado.
    if (!group) {
      return NextResponse.json(
        { error: "O grupo não foi atualizado" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, group });
  } catch (error) {
    console.error("Erro em PUT group:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Arquivar grupo (em vez de deletar)
export async function DELETE(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  try {
    const supabase = createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { groupId } = params;

    // Verificar se o usuário é admin do grupo
    const { data: membership, error: membershipError } = await supabase
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (membershipError || !membership) {
      return NextResponse.json(
        { error: "Grupo não encontrado ou acesso negado" },
        { status: 404 }
      );
    }

    if (membership.role !== "admin") {
      return NextResponse.json(
        { error: "Apenas administradores podem arquivar grupos" },
        { status: 403 }
      );
    }

    // Verificar se há transações pendentes. Ver lib/services/expense-groups.ts:
    // "não deu para saber" recusa igual a "há", porque arquivar o grupo apaga o
    // registro de quem devia a quem e isso não tem volta.
    const pendencia = await divisaoPendenteDoGrupo(supabase, groupId);

    if (pendencia.situacao === "nao-deu-para-saber") {
      console.error("Não deu para verificar as divisões pendentes:", pendencia.erro);
      return NextResponse.json(
        {
          error:
            "Não foi possível verificar se há divisões pendentes no grupo. Tente de novo em instantes.",
        },
        { status: 503 }
      );
    }

    if (pendencia.situacao === "ha") {
      return NextResponse.json(
        {
          error:
            "Não é possível arquivar grupos com transações pendentes. Finalize todas as divisões primeiro.",
        },
        { status: 400 }
      );
    }

    // As colunas de arquivamento existem desde a migration 020 (HMO-167). Antes
    // dela, este bloco farejava o schema em tempo de execucao: nao achava as
    // colunas, caia num ramo que concatenava "[ARQUIVADO]" na DESCRICAO do
    // grupo -- texto visivel para o usuario, que nenhuma consulta sabia desfazer
    // -- e ainda tentava gravar `metadata`, coluna que nunca existiu.
    const arquivadoEm = new Date().toISOString();

    const { error: archiveError } = await supabase
      .from("expense_groups")
      .update({
        is_active: false,
        archived_at: arquivadoEm,
        archived_by: user.id,
      })
      .eq("id", groupId);

    if (archiveError) {
      console.error("Error archiving group:", archiveError);
      return NextResponse.json(
        { error: `Erro ao arquivar grupo: ${archiveError.message}` },
        { status: 500 }
      );
    }

    // Arquivar os membros. Este erro NAO pode ser apenas logado, e era: o
    // comentario dizia "Nao falhar se nao conseguir arquivar membros", e como
    // `status = 'archived'` violava group_members_status_check (que so aceitava
    // active/inactive/pending/removed ate a 020), a gravacao falhava SEMPRE.
    // A rota respondia "Grupo arquivado com sucesso" com um `archived_at` que
    // nunca foi gravado, e a listagem de arquivados -- que procura os grupos
    // pelo `status = 'archived'` do membro -- nunca acharia nada.
    const { error: membersArchiveError } = await supabase
      .from("group_members")
      .update({ status: "archived", archived_at: arquivadoEm })
      .eq("group_id", groupId)
      .eq("status", "active");

    if (membersArchiveError) {
      console.error("Error archiving members:", membersArchiveError);
      return NextResponse.json(
        {
          error:
            "O grupo foi arquivado, mas os membros nao: ele nao apareceria na lista de arquivados. " +
            membersArchiveError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message:
        "Grupo arquivado com sucesso. O histórico de transações foi preservado.",
      archived_at: arquivadoEm,
    });
  } catch (error) {
    console.error("Error archiving group:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
