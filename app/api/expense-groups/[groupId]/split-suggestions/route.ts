import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

interface SplitSuggestion {
  type: "equal" | "proportional" | "historical";
  name: string;
  description: string;
  splits: {
    member_id: string;
    user: {
      id: string;
      full_name: string;
      avatar_url?: string;
    };
    percentage: number;
    amount?: number;
    reason?: string;
  }[];
}

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

    console.log("🔍 SPLIT SUGGESTIONS API:", {
      groupId,
      userId: user.id,
      email: user.email,
    });
    const url = new URL(request.url);
    const amount = parseFloat(url.searchParams.get("amount") || "0");

    // Check if user is member of this group
    const { data: membership } = await supabase
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (!membership) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get group info
    const { data: group, error: groupError } = await supabase
      .from("expense_groups")
      .select(
        `
        id,
        name,
        default_split_type
      `
      )
      .eq("id", groupId)
      .single();

    if (groupError || !group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    // Get group members separately
    const { data: members, error: membersError } = await supabase
      .from("group_members")
      .select(
        `
        id,
        user_id,
        percentage,
        status,
        user:profiles!group_members_user_id_fkey (
          id,
          full_name,
          avatar_url
        )
      `
      )
      .eq("group_id", groupId)
      .eq("status", "active");

    if (membersError || !members) {
      console.error("❌ MEMBERS ERROR:", membersError);
      return NextResponse.json(
        { error: "Error loading group members" },
        { status: 500 }
      );
    }

    console.log("👥 ACTIVE MEMBERS LOADED:", {
      count: members.length,
      members: members.map((m: any) => ({
        id: m.id,
        user_id: m.user_id,
        name: m.user?.full_name,
        percentage: m.percentage,
      })),
    });

    const activeMembers = members;

    if (activeMembers.length === 0) {
      return NextResponse.json(
        { error: "No active members found" },
        { status: 400 }
      );
    }

    const suggestions: SplitSuggestion[] = [];

    // 1. Equal Split (sempre disponível)
    const equalPercentage = 100 / activeMembers.length;

    console.log("🧮 CALCULATING EQUAL SPLIT:", {
      membersCount: activeMembers.length,
      equalPercentage,
      amount,
    });

    suggestions.push({
      type: "equal",
      name: "Divisão Igual",
      description: `Dividir igualmente entre ${
        activeMembers.length
      } membros (${equalPercentage.toFixed(1)}% cada)`,
      splits: activeMembers.map((member: any) => {
        console.log("👤 PROCESSING MEMBER:", {
          id: member.id,
          user: member.user,
          percentage: equalPercentage,
        });

        return {
          member_id: member.id,
          user: member.user,
          percentage: equalPercentage,
          amount: amount ? (amount * equalPercentage) / 100 : undefined,
          reason: "Divisão igual padrão",
        };
      }),
    });

    // 2. Proportional Split (se configurado no grupo)
    if (group.default_split_type === "proportional") {
      // Usar percentuais já configurados para os membros
      const hasCustomPercentages = activeMembers.some(
        (m: any) => m.percentage > 0
      );

      if (hasCustomPercentages) {
        const totalConfiguredPercentage = activeMembers.reduce(
          (sum: number, m: any) => sum + (m.percentage || 0),
          0
        );

        if (Math.abs(totalConfiguredPercentage - 100) < 0.01) {
          suggestions.push({
            type: "proportional",
            name: "Divisão Proporcional",
            description: "Baseada nas proporções configuradas do grupo",
            splits: activeMembers.map((member: any) => ({
              member_id: member.id,
              user: member.user,
              percentage: member.percentage,
              amount: amount ? (amount * member.percentage) / 100 : undefined,
              reason: `${member.percentage}% conforme configuração do grupo`,
            })),
          });
        }
      }
    }

    // 3. Historical Split (baseado no histórico de gastos)
    // Buscar transações dos últimos 3 meses para análise
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const { data: recentTransactions } = await supabase
      .from("group_transactions")
      .select(
        `
        id,
        transaction:financial_transactions (
          id,
          amount,
          transaction_date,
          user_id
        ),
        splits:group_expense_splits (
          id,
          amount,
          percentage,
          member:group_members (
            id,
            user_id,
            user:profiles!group_members_user_id_fkey (
              id,
              full_name
            )
          )
        )
      `
      )
      .eq("group_id", groupId)
      .gte(
        "transaction.transaction_date",
        threeMonthsAgo.toISOString().split("T")[0]
      );

    if (recentTransactions && recentTransactions.length >= 3) {
      // Calcular média de participação de cada membro
      const memberStats = new Map<
        string,
        {
          totalAmount: number;
          participationCount: number;
          totalPercentage: number;
        }
      >();

      activeMembers.forEach((member: any) => {
        memberStats.set(member.user_id, {
          totalAmount: 0,
          participationCount: 0,
          totalPercentage: 0,
        });
      });

      recentTransactions.forEach((gt: any) => {
        if (gt.splits && gt.splits.length > 0) {
          gt.splits.forEach((split: any) => {
            if (
              split.member?.user_id &&
              memberStats.has(split.member.user_id)
            ) {
              const stats = memberStats.get(split.member.user_id)!;
              stats.totalAmount += split.amount || 0;
              stats.totalPercentage += split.percentage || 0;
              stats.participationCount += 1;
            }
          });
        }
      });

      // Calcular percentuais médios históricos
      let totalHistoricalPercentage = 0;
      const historicalPercentages: { [key: string]: number } = {};

      memberStats.forEach((stats, userId) => {
        if (stats.participationCount > 0) {
          const avgPercentage =
            stats.totalPercentage / stats.participationCount;
          historicalPercentages[userId] = avgPercentage;
          totalHistoricalPercentage += avgPercentage;
        }
      });

      // Normalizar percentuais para somar 100%
      if (
        totalHistoricalPercentage > 0 &&
        Object.keys(historicalPercentages).length === activeMembers.length
      ) {
        const normalizedSplits = activeMembers.map((member: any) => {
          const historicalPercentage =
            historicalPercentages[member.user_id] || 0;
          const normalizedPercentage =
            (historicalPercentage / totalHistoricalPercentage) * 100;

          return {
            member_id: member.id,
            user: member.user,
            percentage: normalizedPercentage,
            amount: amount ? (amount * normalizedPercentage) / 100 : undefined,
            reason: `${normalizedPercentage.toFixed(
              1
            )}% baseado no histórico recente`,
          };
        });

        suggestions.push({
          type: "historical",
          name: "Baseado no Histórico",
          description: `Sugestão baseada na participação média dos últimos ${recentTransactions.length} gastos`,
          splits: normalizedSplits,
        });
      }
    }

    // 4. Sugestões específicas baseadas em padrões
    // Analisar quem mais gasta no grupo
    if (recentTransactions && recentTransactions.length > 0) {
      const payerStats = new Map<
        string,
        { count: number; totalAmount: number }
      >();

      recentTransactions.forEach((gt: any) => {
        if (gt.transaction?.user_id) {
          const userId = gt.transaction.user_id;
          const amount = Math.abs(gt.transaction.amount || 0);

          if (!payerStats.has(userId)) {
            payerStats.set(userId, { count: 0, totalAmount: 0 });
          }

          const stats = payerStats.get(userId)!;
          stats.count += 1;
          stats.totalAmount += amount;
        }
      });

      // Identificar o "pagador principal" (quem mais paga)
      let mainPayer: any = null;
      let maxAmount = 0;

      payerStats.forEach((stats, userId) => {
        if (stats.totalAmount > maxAmount) {
          maxAmount = stats.totalAmount;
          mainPayer = activeMembers.find((m: any) => m.user_id === userId);
        }
      });

      // Se existe um pagador principal que paga mais de 50% dos gastos
      const totalSpent = Array.from(payerStats.values()).reduce(
        (sum, stats) => sum + stats.totalAmount,
        0
      );
      if (mainPayer && maxAmount > totalSpent * 0.5) {
        // Sugerir que o pagador principal pague um pouco mais
        const adjustedSplits = activeMembers.map((member: any) => {
          const basePercentage = equalPercentage;
          let adjustedPercentage = basePercentage;

          if (member.user_id === mainPayer!.user_id) {
            // Pagador principal paga 5% a mais
            adjustedPercentage = basePercentage + 5;
          } else {
            // Outros pagam proporcionalmente menos
            adjustedPercentage = 95 / (activeMembers.length - 1);
          }

          return {
            member_id: member.id,
            user: member.user,
            percentage: adjustedPercentage,
            amount: amount ? (amount * adjustedPercentage) / 100 : undefined,
            reason:
              member.user_id === mainPayer!.user_id
                ? "Pagador principal (+5%)"
                : "Ajuste por pagador principal",
          };
        });

        suggestions.push({
          type: "proportional",
          name: "Ajuste por Pagador Principal",
          description: `${
            mainPayer!.user.full_name
          } tem pago a maioria das despesas recentes`,
          splits: adjustedSplits,
        });
      }
    }

    console.log("✅ RETURNING SUGGESTIONS:", {
      suggestionsCount: suggestions.length,
      firstSuggestion: suggestions[0],
    });

    return NextResponse.json({
      success: true,
      suggestions,
      group: {
        id: group.id,
        name: group.name,
        members_count: activeMembers.length,
        default_split_type: group.default_split_type,
      },
    });
  } catch (error) {
    console.error("Error calculating split suggestions:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
