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
  data?: any;
}

export interface GroupInvitationNotification {
  id: string;
  group_id: string;
  invited_by: string;
  invite_method: "email" | "phone" | "code";
  invite_target: string;
  message?: string;
  status: "pending" | "accepted" | "rejected" | "expired";
  expires_at: string;
  created_at: string;
  group: {
    name: string;
    description?: string;
    group_code: string;
  };
  inviter: {
    full_name: string;
    avatar_url?: string;
  };
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

      // Buscar convites de grupo pendentes
      const { data: groupInvites, error: inviteError } = await supabase
        .from("group_invitations")
        .select(
          `
          *,
          group:expense_groups(name, description, group_code),
          inviter:profiles!group_invitations_invited_by_fkey(full_name, avatar_url)
        `
        )
        .eq("invited_user_id", user.id)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });

      if (inviteError) {
        console.error("Error fetching group invitations:", inviteError);
      }

      // Transformar convites em notificações
      const inviteNotifications: Notification[] = (groupInvites || [])
        .filter((invite: GroupInvitationNotification) => {
          // Filtrar convites com dados válidos
          if (!invite.group || !invite.inviter) {
            console.warn("Convite com dados incompletos:", invite);
            return false;
          }
          return true;
        })
        .map((invite: GroupInvitationNotification) => ({
          id: `group_invite_${invite.id}`,
          type: "group_invitation" as const,
          title: `Convite para grupo: ${invite.group.name}`,
          message: `${
            invite.inviter.full_name
          } te convidou para participar do grupo "${invite.group.name}"${
            invite.message ? `. Mensagem: ${invite.message}` : ""
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

  const acceptGroupInvitation = async (
    invitation: GroupInvitationNotification
  ) => {
    try {
      const response = await fetch("/api/expense-groups/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invitation_id: invitation.id,
          accept: true,
        }),
      });

      if (response.ok) {
        // Remover notificação da lista
        setNotifications((prev) =>
          prev.filter((n) => n.id !== `group_invite_${invitation.id}`)
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
        return { success: true };
      } else {
        const error = await response.json();
        return { success: false, error: error.error };
      }
    } catch (error) {
      console.error("Error accepting invitation:", error);
      return { success: false, error: "Erro interno" };
    }
  };

  const rejectGroupInvitation = async (
    invitation: GroupInvitationNotification
  ) => {
    try {
      const response = await fetch("/api/expense-groups/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invitation_id: invitation.id,
          accept: false,
        }),
      });

      if (response.ok) {
        // Remover notificação da lista
        setNotifications((prev) =>
          prev.filter((n) => n.id !== `group_invite_${invitation.id}`)
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
        return { success: true };
      } else {
        const error = await response.json();
        return { success: false, error: error.error };
      }
    } catch (error) {
      console.error("Error rejecting invitation:", error);
      return { success: false, error: "Erro interno" };
    }
  };

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
