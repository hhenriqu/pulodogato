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
  const [orphanedCount, setOrphanedCount] = useState(0);

  const supabase = createClient();

  const fetchInvitations = async () => {
    if (!user) {
      setInvitations([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // 1. Buscar apenas os convites primeiro
      const { data: invites, error: invitesError } = await supabase
        .from("group_invitations")
        .select("*")
        .eq("invited_user_id", user.id)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });

      if (invitesError) {
        console.error("❌ Error fetching invitations:", invitesError);
        setInvitations([]);
        return;
      }

      if (!invites || invites.length === 0) {
        console.log("📊 Nenhum convite encontrado");
        setInvitations([]);
        return;
      }

      console.log("📊 Convites encontrados:", invites.length);

      // 2. Buscar grupos separadamente usando os group_ids
      const groupIds = Array.from(
        new Set(invites.map((invite) => invite.group_id))
      );

      console.log("🔍 Group IDs para buscar:", groupIds);

      // Teste: verificar se existem grupos com esses IDs (sem RLS)
      const { data: allGroups, error: allGroupsError } = await supabase
        .from("expense_groups")
        .select("id, name, is_active, created_by");

      console.log("🧪 Todos os grupos na tabela:", {
        total: allGroups?.length || 0,
        data: allGroups,
        error: allGroupsError,
      });

      // Teste específico: verificar se os grupos dos convites existem na lista completa
      console.log("🔍 Análise dos grupos necessários:");
      groupIds.forEach((groupId) => {
        const existsInAll = allGroups?.some((g) => g.id === groupId);
        const groupInfo = allGroups?.find((g) => g.id === groupId);
        console.log(
          `   - Grupo ${groupId}: ${
            existsInAll ? "✅ EXISTE" : "❌ NÃO EXISTE"
          } na tabela`,
          groupInfo || "sem dados"
        );
      });

      // Teste específico para os IDs dos convites
      for (const groupId of groupIds) {
        const { data: specificGroup, error: specificError } = await supabase
          .from("expense_groups")
          .select("*")
          .eq("id", groupId)
          .single();

        console.log(`🔍 Grupo ${groupId}:`, {
          data: specificGroup,
          error: specificError,
        });
      }

      const { data: groups, error: groupsError } = await supabase
        .from("expense_groups")
        .select(
          "id, name, description, group_code, group_type, default_split_type, photo_url, is_active"
        )
        .in("id", groupIds);

      if (groupsError) {
        console.error("❌ Error fetching groups:", groupsError);
      }

      console.log("📊 Grupos encontrados:", groups?.length || 0);
      console.log("📋 Dados dos grupos:", groups);

      // 3. Buscar perfis dos convidadores separadamente
      const inviterIds = Array.from(
        new Set(invites.map((invite) => invite.invited_by))
      );
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", inviterIds);

      if (profilesError) {
        console.error("❌ Error fetching profiles:", profilesError);
      }

      console.log("📊 Perfis encontrados:", profiles?.length || 0);

      // 4. Combinar os dados manualmente em JavaScript
      const combinedInvites = invites.map((invite: any) => {
        const group = groups?.find((g) => g.id === invite.group_id) || null;
        const inviter =
          profiles?.find((p) => p.id === invite.invited_by) || null;

        console.log(`🔍 Processando convite ${invite.id}:`, {
          group_id: invite.group_id,
          group_found: !!group,
          group_name: group?.name || "N/A",
          group_active: group?.is_active || false,
          inviter_found: !!inviter,
          inviter_name: inviter?.full_name || "N/A",
        });

        return {
          ...invite,
          group,
          inviter,
        };
      });

      // 5. Identificar e limpar convites órfãos (grupos inexistentes)
      const orphanedInvites = combinedInvites.filter(
        (invite: any) => !invite.group
      );

      if (orphanedInvites.length > 0) {
        console.log(
          "🚨 PROBLEMA DETECTADO: Convites órfãos (grupos inexistentes):",
          {
            total: orphanedInvites.length,
            invites: orphanedInvites.map((inv) => ({
              id: inv.id,
              group_id: inv.group_id,
              created_at: inv.created_at,
            })),
          }
        );

        setOrphanedCount(orphanedInvites.length);

        // Marcar convites órfãos como expirados para limpar o banco
        for (const orphan of orphanedInvites) {
          try {
            await supabase
              .from("group_invitations")
              .update({
                status: "expired",
                updated_at: new Date().toISOString(),
              })
              .eq("id", orphan.id);

            console.log(`🧹 Convite órfão ${orphan.id} marcado como expirado`);
          } catch (error) {
            console.error(`❌ Erro ao limpar convite ${orphan.id}:`, error);
          }
        }
      } else {
        setOrphanedCount(0);
      }

      // 6. Filtrar apenas convites com grupos ativos e dados completos
      const activeInvites = combinedInvites.filter((invite: any) => {
        const hasGroup = invite.group !== null;
        const isActive = invite.group?.is_active === true;
        const hasInviter = invite.inviter !== null;

        const isValid = hasGroup && isActive && hasInviter;

        if (!isValid) {
          console.log(`❌ Convite ${invite.id} filtrado:`, {
            hasGroup,
            isActive,
            hasInviter,
            reason: !hasGroup
              ? "grupo não existe"
              : !isActive
              ? "grupo inativo"
              : "sem dados do convidador",
          });
        }

        return isValid;
      });

      console.log("✅ Convites válidos após filtro:", activeInvites.length);

      // Se todos os convites foram filtrados por grupos inexistentes, mostrar mensagem explicativa
      if (activeInvites.length === 0 && combinedInvites.length > 0) {
        const allOrphaned = combinedInvites.every((inv) => !inv.group);
        if (allOrphaned) {
          console.log(
            "⚠️  TODOS OS CONVITES SÃO ÓRFÃOS - Grupos foram deletados após convites serem enviados"
          );
        }
      }

      setInvitations(activeInvites);
    } catch (error) {
      console.error("❌ Error in fetchInvitations:", error);
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

        // Recarregar lista completa para sincronizar com o banco
        await fetchInvitations();

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
        // Recarregar lista completa para sincronizar com o banco
        await fetchInvitations();

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

  const cleanOrphanedInvitations = async () => {
    if (!user) return { success: false, error: "Usuário não autenticado" };

    try {
      // Marcar todos os convites órfãos como expirados
      const { error } = await supabase
        .from("group_invitations")
        .update({
          status: "expired",
          updated_at: new Date().toISOString(),
        })
        .eq("invited_user_id", user.id)
        .eq("status", "pending");

      if (error) {
        console.error("Erro ao limpar convites órfãos:", error);
        return { success: false, error: error.message };
      }

      // Recarregar convites após limpeza
      await fetchInvitations();

      return {
        success: true,
        message: "Convites órfãos removidos com sucesso",
      };
    } catch (error) {
      console.error("Erro ao limpar convites:", error);
      return { success: false, error: "Erro interno" };
    }
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
    orphanedCount,
    refetch: fetchInvitations,
    acceptInvitation,
    rejectInvitation,
    getTimeRemaining,
    getSplitTypeLabel,
    cleanOrphanedInvitations,
  };
};
