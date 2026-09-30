import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { User } from "@supabase/supabase-js";

// Convite pendente endereçado a quem esta logado, como
// `list_my_group_invitations()` (migration 030) devolve.
//
// ESTA E A SEGUNDA TELA DE CONVITE, E ERA A MAIS DANOSA (HMO-196)
// ---------------------------------------------------------------
// O sino (useNotifications) apenas escondia o convite. Aqui era pior: este hook
// lia `group_invitations`, buscava os grupos em `expense_groups` num segundo
// SELECT, nao achava nenhum -- porque a RLS esconde o grupo de quem ainda nao e
// membro -- e concluia que o grupo havia sido DELETADO. Tinha `console.log`
// dizendo "🚨 PROBLEMA DETECTADO: Convites órfãos (grupos inexistentes)" e, com
// base nesse diagnostico errado, fazia:
//
//     UPDATE group_invitations SET status = 'expired' WHERE id = <orfao>
//
// Ou seja: bastava a pessoa convidada ABRIR a aba Convites para que todos os
// convites legitimos dela fossem marcados como expirados. Nao e que o convite
// nao chegava -- ele chegava e a propria tela o destruia, e depois mostrava
// "Nenhum convite pendente" com toda a convicçao. Em producao havia 5 convites
// inseridos e 2 vivos. Era tambem o que fazia o relato parecer "nao recebeu
// nada": nao havia o que reenviar, havia o que parar de apagar.
//
// O grupo nunca deixou de existir. `is_active` e o unico eixo de "grupo fora do
// ar" que este produto tem (020), e quem filtra por ele agora e a funcao, no
// banco, onde a RLS nao cega a leitura.
export interface GroupInvitation {
  invitation_id: string;
  group_id: string;
  group_name: string;
  group_description: string | null;
  inviter_name: string | null;
  inviter_avatar_url: string | null;
  invite_message: string | null;
  expires_at: string;
  created_at: string;
}

export const useGroupInvitations = (user: User | null) => {
  const [invitations, setInvitations] = useState<GroupInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [acceptLoading, setAcceptLoading] = useState<string | null>(null);
  const [rejectLoading, setRejectLoading] = useState<string | null>(null);

  const supabase = createClient();

  const fetchInvitations = async () => {
    if (!user) {
      setInvitations([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Uma chamada. Os tres SELECTs (convites, grupos, perfis) e a juncao a mao
      // em JavaScript viraram isto -- e com eles foi embora o "convite orfao",
      // que era a RLS sendo lida como grupo apagado.
      const { data, error } = await supabase.rpc("list_my_group_invitations");

      if (error) {
        console.error("Erro ao buscar convites de grupo:", error);
        setInvitations([]);
        return;
      }

      // Sem filtro no cliente, de proposito. A funcao ja devolve so o que e
      // entregavel (pendente, no prazo, grupo ativo), e qualquer filtro extra
      // aqui seria um novo lugar para um convite desaparecer calado.
      setInvitations((data || []) as GroupInvitation[]);
    } catch (error) {
      console.error("Erro ao buscar convites de grupo:", error);
      setInvitations([]);
    } finally {
      setLoading(false);
    }
  };

  // Aceitar e recusar sao a mesma requisicao com um booleano diferente.
  const responderConvite = async (invitationId: string, accept: boolean) => {
    const setLoadingState = accept ? setAcceptLoading : setRejectLoading;
    setLoadingState(invitationId);
    try {
      const response = await fetch("/api/expense-groups/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitation_id: invitationId, accept }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error };
      }

      // Recarrega em vez de mexer no array local: quem decide se o convite ainda
      // conta e o banco.
      await fetchInvitations();

      return { success: true, message: data.message };
    } catch (error) {
      console.error("Erro ao responder o convite:", error);
      return { success: false, error: "Erro interno" };
    } finally {
      setLoadingState(null);
    }
  };

  const acceptInvitation = (invitationId: string) =>
    responderConvite(invitationId, true);

  const rejectInvitation = (invitationId: string) =>
    responderConvite(invitationId, false);

  const getTimeRemaining = (expiresAt: string) => {
    const now = new Date();
    const expires = new Date(expiresAt);
    const diffMs = expires.getTime() - now.getTime();

    if (diffMs <= 0) return "Expirado";

    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(
      (diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
    );
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (diffDays > 0) return `${diffDays}d ${diffHours}h`;
    if (diffHours > 0) return `${diffHours}h ${diffMins}m`;
    return `${diffMins}m`;
  };

  useEffect(() => {
    fetchInvitations();

    // Refresh a cada 60 segundos para verificar expirações
    const interval = setInterval(fetchInvitations, 60000);

    return () => clearInterval(interval);
  }, [user]);

  return {
    invitations,
    loading,
    acceptLoading,
    rejectLoading,
    refetch: fetchInvitations,
    acceptInvitation,
    rejectInvitation,
    getTimeRemaining,
  };
};
