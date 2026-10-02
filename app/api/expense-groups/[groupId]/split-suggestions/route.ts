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

// O perfil do membro sai do proprio contrato de resposta, de proposito: o que a
// consulta promete e o que a sugestao entrega sao o MESMO tipo, entao mexer num
// sem o outro reprova no `tsc` em vez de sair pela resposta da API.
type PerfilDoMembro = SplitSuggestion["splits"][number]["user"];

type MembroAtivo = {
  id: string;
  user_id: string;
  percentage: number | null;
  status: string;
  user: PerfilDoMembro;
};

// `transaction` e `member` sao embeds many-to-one (objeto), `splits` e
// one-to-many (lista). Todos podem vir nulos: a RLS nao devolve erro para linha
// alheia, ela tira a linha do resultado -- e por isso que cada leitura abaixo
// passa por `?.` ou por um `if`.
type DespesaRecente = {
  id: string;
  transaction: {
    id: string;
    amount: number | null;
    transaction_date: string;
    user_id: string;
  } | null;
  splits:
    | {
        id: string;
        amount: number | null;
        percentage: number | null;
        member: {
          id: string;
          user_id: string;
          user: { id: string; full_name: string } | null;
        } | null;
      }[]
    | null;
};

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
      .eq("status", "active")
      .returns<MembroAtivo[]>();

    if (membersError || !members) {
      console.error("❌ MEMBERS ERROR:", membersError);
      return NextResponse.json(
        { error: "Error loading group members" },
        { status: 500 }
      );
    }

    console.log("👥 ACTIVE MEMBERS LOADED:", {
      count: members.length,
      members: members.map((m) => ({
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
      splits: activeMembers.map((member) => {
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
        (m) => (m.percentage ?? 0) > 0
      );

      if (hasCustomPercentages) {
        const totalConfiguredPercentage = activeMembers.reduce(
          (sum: number, m) => sum + (m.percentage || 0),
          0
        );

        if (Math.abs(totalConfiguredPercentage - 100) < 0.01) {
          suggestions.push({
            type: "proportional",
            name: "Divisão Proporcional",
            description: "Baseada nas proporções configuradas do grupo",
            splits: activeMembers.map((member) => ({
              member_id: member.id,
              user: member.user,
              percentage: member.percentage ?? 0,
              amount: amount
                ? (amount * (member.percentage ?? 0)) / 100
                : undefined,
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
      )
      .returns<DespesaRecente[]>();

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

      activeMembers.forEach((member) => {
        memberStats.set(member.user_id, {
          totalAmount: 0,
          participationCount: 0,
          totalPercentage: 0,
        });
      });

      recentTransactions.forEach((gt) => {
        if (gt.splits && gt.splits.length > 0) {
          gt.splits.forEach((split) => {
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
        const normalizedSplits = activeMembers.map((member) => {
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

      recentTransactions.forEach((gt) => {
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
      //
      // Vem de um `reduce` e nao de um `let` atribuido dentro do `forEach`: com
      // o tipo no lugar do `any`, o TypeScript nao ve a atribuicao feita dentro
      // do callback e estreita a variavel de volta para `null` -- os
      // `mainPayer!` logo abaixo passavam exatamente porque o tipo era `any`.
      // Empate continua com o primeiro, como no laco anterior.
      const maiorPagador = Array.from(payerStats.entries()).reduce<
        { userId: string; totalAmount: number } | null
      >(
        (maior, [userId, stats]) =>
          !maior || stats.totalAmount > maior.totalAmount
            ? { userId, totalAmount: stats.totalAmount }
            : maior,
        null
      );

      const maxAmount = maiorPagador?.totalAmount ?? 0;
      const mainPayer = maiorPagador
        ? activeMembers.find((m) => m.user_id === maiorPagador.userId) ?? null
        : null;

      // Se existe um pagador principal que paga mais de 50% dos gastos
      const totalSpent = Array.from(payerStats.values()).reduce(
        (sum, stats) => sum + stats.totalAmount,
        0
      );
      if (mainPayer && maxAmount > totalSpent * 0.5) {
        // Sugerir que o pagador principal pague um pouco mais
        const adjustedSplits = activeMembers.map((member) => {
          const basePercentage = equalPercentage;
          let adjustedPercentage = basePercentage;

          if (member.user_id === mainPayer.user_id) {
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
              member.user_id === mainPayer.user_id
                ? "Pagador principal (+5%)"
                : "Ajuste por pagador principal",
          };
        });

        suggestions.push({
          type: "proportional",
          name: "Ajuste por Pagador Principal",
          description: `${
            mainPayer.user.full_name
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
