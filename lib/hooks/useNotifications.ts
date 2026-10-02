import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { User } from "@supabase/supabase-js";

export interface Notification {
  id: string;
  type: "group_invitation" | "connection_request" | "general";
  title: string;
  message: string;
  read: boolean;
  created_at: string;
  // `unknown` e nao `any`: o conteudo varia por `type`, e quem le tem que
  // afirmar a forma (`data as GroupInvitationNotification`). Com `any` o acesso
  // passava direto, sem afirmacao nenhuma e sem conferencia.
  data?: unknown;
}

// O que `list_my_group_invitations()` devolve (migration 030). Nao ha
// `group_code` aqui de proposito: quem recusa o convite nao sai com a chave de
// entrada do grupo, e os botoes Aceitar/Recusar nao precisam dela.
//
// `inviter_name` e anulavel de verdade -- `profiles.full_name` e opcional, e a
// conta do relato original da HMO-196 tem exatamente esse estado.
export interface GroupInvitationNotification {
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

export const useNotifications = (user: User | null) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  const supabase = createClient();

  const fetchNotifications = async () => {
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Convites de grupo pendentes.
      //
      // ISTO ERA UM SELECT COM EMBED, E ERA O BUG DA HMO-196. A consulta lia
      // `group_invitations` com `group:expense_groups(...)` e
      // `inviter:profiles!...(...)`, e os dois embeds caem na RLS de quem esta
      // lendo -- a pessoa convidada. Ela nao e membro do grupo
      // (`expense_groups_select`) e o perfil de quem convidou nao e publico
      // (`profiles_select_own_or_public`), entao PostgREST devolvia os dois como
      // `null`, sem erro nenhum. O filtro logo abaixo -- `if (!invite.group ||
      // !invite.inviter) return false` -- entao jogava fora TODO convite, com um
      // console.warn. Em producao havia 5 convites gravados e o sino de quem foi
      // convidada ficava vazio, o que virou "ela nao recebeu o convite".
      //
      // As duas policies estao certas e continuam como estao. A leitura passou a
      // ser `list_my_group_invitations()`, que monta o cartao dentro do banco
      // (SECURITY DEFINER) devolvendo so o nome do grupo e o de quem convidou, e
      // filtra por `invited_user_id = auth.uid()` no proprio corpo.
      const { data: groupInvites, error: inviteError } = await supabase.rpc(
        "list_my_group_invitations"
      );

      if (inviteError) {
        console.error("Error fetching group invitations:", inviteError);
      }

      // Sem `.filter()` descartando linha: a funcao ja devolve exatamente os
      // convites entregaveis (pendentes, no prazo, de grupo ativo). Se um dia
      // voltar a faltar dado, o certo e a linha aparecer incompleta e alguem
      // reclamar -- nao ela desaparecer em silencio, que foi o defeito aqui.
      const inviteNotifications: Notification[] = (
        (groupInvites || []) as GroupInvitationNotification[]
      ).map((invite) => ({
        id: `group_invite_${invite.invitation_id}`,
        type: "group_invitation" as const,
        title: `Convite para grupo: ${invite.group_name}`,
        message: `${
          invite.inviter_name ?? "Alguém"
        } te convidou para participar do grupo "${invite.group_name}"${
          invite.invite_message ? `. Mensagem: ${invite.invite_message}` : ""
        }`,
        read: false,
        created_at: invite.created_at,
        data: invite,
      }));

      // TODO: Buscar outros tipos de notificações aqui
      // - Solicitações de conexão pendentes
      // - Notificações gerais
      // - Lembretes de transações

      const allNotifications = [
        ...inviteNotifications,
        // ...connectionRequests,
        // ...generalNotifications,
      ];

      setNotifications(allNotifications);
      setUnreadCount(allNotifications.filter((n) => !n.read).length);
    } catch (error) {
      console.error("Error fetching notifications:", error);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (notificationId: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
  };

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  // Aceitar e recusar diferem em UM booleano, e eram duas funcoes copiadas.
  // Juntar as duas nao e so estetica aqui: o campo do id mudou de `id` para
  // `invitation_id` com a 030, e numa edicao de dois blocos iguais um deles sai
  // com o nome velho. `invitation_id: undefined` no corpo faz a rota cair na
  // entrada por CODIGO em vez de responder o convite, e a tela mostraria
  // "Group code must be 6 characters" ao clicar em Aceitar -- nenhum tsc pega
  // isso, porque `undefined` e um valor legal no JSON.
  const responderConvite = async (
    invitation: GroupInvitationNotification,
    accept: boolean
  ) => {
    try {
      const response = await fetch("/api/expense-groups/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invitation_id: invitation.invitation_id,
          accept,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        return { success: false, error: error.error };
      }

      setNotifications((prev) =>
        prev.filter((n) => n.id !== `group_invite_${invitation.invitation_id}`)
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      return { success: true };
    } catch (error) {
      console.error("Error responding to invitation:", error);
      return { success: false, error: "Erro interno" };
    }
  };

  const acceptGroupInvitation = (invitation: GroupInvitationNotification) =>
    responderConvite(invitation, true);

  const rejectGroupInvitation = (invitation: GroupInvitationNotification) =>
    responderConvite(invitation, false);

  useEffect(() => {
    fetchNotifications();

    // Configurar polling para atualizar notificações a cada 30 segundos
    const interval = setInterval(fetchNotifications, 30000);

    return () => clearInterval(interval);
  }, [user]);

  return {
    notifications,
    loading,
    unreadCount,
    refetch: fetchNotifications,
    markAsRead,
    markAllAsRead,
    acceptGroupInvitation,
    rejectGroupInvitation,
  };
};
