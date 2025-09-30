// HOOK CORRIGIDO - useGroupInvitations.ts
// Substitua o arquivo original por este conteúdo

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { User } from "@supabase/supabase-js";

export interface GroupInvitation {
  id: string;
  group_id: string;
  invited_by: string;
  invite_method: "email" | "phone" | "code";
  invite_target: string;
  message?: string;
  status: "pending" | "accepted" | "rejected" | "expired";
  expires_at: string;
  created_at: string;
  updated_at: string;
  group: {
    id: string;
    name: string;
    description?: string;
    group_code: string;
    group_type: "public" | "private";
    default_split_type: string;
    photo_url?: string;
    is_active: boolean;
  };
  inviter: {
    id: string;
    full_name: string;
    avatar_url?: string;
  };
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
      console.log("🔍 Buscando convites para usuário:", user.id);

      // MUDANÇA: Usar LEFT JOIN em vez de !inner para ser mais tolerante
      const { data: invites, error } = await supabase
        .from("group_invitations")
        .select(
          `
          *,
          group:expense_groups(
            id,
            name,
            description,
            group_code,
            group_type,
            default_split_type,
            photo_url,
            is_active
          ),
          inviter:profiles!group_invitations_invited_by_fkey(
            id,
            full_name,
            avatar_url
          )
        `
        )
        .eq("invited_user_id", user.id)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString()) // Não expirados
        .order("created_at", { ascending: false });

      console.log("📊 Resultado da consulta:", { invites, error });

      if (error) {
        console.error("❌ Error fetching invitations:", error);
        setInvitations([]);
      } else {
        // Filtrar apenas convites com grupos ativos após o fetch
        const activeInvites = (invites || []).filter(
          (invite: any) => invite.group && invite.group.is_active === true
        );

        console.log(
          "✅ Convites filtrados (grupos ativos):",
          activeInvites.length
        );
        setInvitations(activeInvites);
      }
    } catch (error) {
      console.error("💥 Error fetching invitations:", error);
      setInvitations([]);
    } finally {
      setLoading(false);
    }
  };

  const acceptInvitation = async (invitationId: string) => {
    setAcceptLoading(invitationId);
    try {
      const response = await fetch("/api/expense-groups/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invitation_id: invitationId,
          accept: true,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        // Remove convite da lista
        setInvitations((prev) => prev.filter((inv) => inv.id !== invitationId));
        return { success: true, message: data.message };
      } else {
        const error = await response.json();
        return { success: false, error: error.error };
      }
    } catch (error) {
      console.error("Error accepting invitation:", error);
      return { success: false, error: "Erro interno" };
    } finally {
      setAcceptLoading(null);
    }
  };

  const rejectInvitation = async (invitationId: string) => {
    setRejectLoading(invitationId);
    try {
      const response = await fetch("/api/expense-groups/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invitation_id: invitationId,
          accept: false,
        }),
      });

      if (response.ok) {
        // Remove convite da lista
        setInvitations((prev) => prev.filter((inv) => inv.id !== invitationId));
        return { success: true };
      } else {
        const error = await response.json();
        return { success: false, error: error.error };
      }
    } catch (error) {
      console.error("Error rejecting invitation:", error);
      return { success: false, error: "Erro interno" };
    } finally {
      setRejectLoading(null);
    }
  };

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

  const getSplitTypeLabel = (type: string) => {
    switch (type) {
      case "equal":
        return "Divisão Igual";
      case "percentage":
        return "Por Percentual";
      case "custom":
        return "Por Despesa";
      case "proportional":
        return "Proporcional à Renda";
      default:
        return type;
    }
  };

  useEffect(() => {
    console.log("🚀 useGroupInvitations: Iniciando fetch de convites");
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
    getSplitTypeLabel,
  };
};
