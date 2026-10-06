/**
 * `GET /api/expense-groups/{groupId}/split-suggestions?amount=`
 *
 * As sugestoes de divisao que a tela de nova despesa oferece. A aritmetica das
 * quatro mora em `lib/sugestao-de-divisao.ts` -- ver o cabecalho de la para o
 * defeito que a fase 7 da HMO-245 fecha (a sugestao configurada nunca aparecia,
 * presa entre um armazem que nada escrevia e um modo que nada gravava) e para
 * por que o R$ da previa nao e `total * % / 100`.
 *
 * Esta rota so faz o que uma rota faz: confere a sessao, le o banco, e traduz.
 * Nenhuma decisao de dinheiro acontece neste arquivo -- cada uma delas sairia
 * daqui como um 200 com o numero errado, e um handler so e verificavel por um
 * 200.
 */

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

import {
  type ParteDaSugestao,
  type ParticipacaoDoMembro,
  type TipoDeSugestao,
  partesDaSugestao,
  pesosConfigurados,
  pesosDoHistorico,
  pesosDoPagadorPrincipal,
  pesosIguais,
} from "@/lib/sugestao-de-divisao";
import type { PesoDoMembro } from "@/lib/divisao-configurada";

interface PerfilDoMembro {
  id: string;
  full_name: string;
  avatar_url?: string;
}

interface SplitSuggestion {
  type: TipoDeSugestao;
  name: string;
  description: string;
  splits: (ParteDaSugestao & {
    user: PerfilDoMembro | null;
    reason?: string;
  })[];
}

// O QUE A CONSULTA DO HISTORICO DEVOLVE
// -------------------------------------
// `transaction` e `member` sao embeds many-to-one (objeto, nao lista) e
// `splits` e one-to-many. Todos podem vir NULOS, e nao por erro: a RLS nao
// reprova a linha alheia, ela a tira do resultado -- e por isso que cada
// leitura abaixo passa por `?.` em vez de confiar no embed.
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
        member: { id: string; user_id: string } | null;
      }[]
    | null;
};

/** Quantas despesas recentes bastam para o historico dizer algo. */
const AMOSTRA_MINIMA_DO_HISTORICO = 3;

/** A fatia do gasto recente acima da qual alguem e "o pagador principal". */
const FATIA_DO_PAGADOR_PRINCIPAL = 0.5;

/** O percentual em pt-BR, para o texto da sugestao. */
function pct(valor: number): string {
  return valor.toFixed(2).replace(".", ",");
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

    const url = new URL(request.url);
    const amountBruto = parseFloat(url.searchParams.get("amount") || "0");
    // `parseFloat("")` e `NaN`, e `NaN` atravessa a aritmetica calado. A previa
    // em reais so existe quando ha um valor digitado -- ver `partesDaSugestao`,
    // que devolve `amount` ausente, e nao R$ 0,00.
    const amount =
      Number.isFinite(amountBruto) && amountBruto > 0 ? amountBruto : null;

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

    const activeMembers = members as unknown as {
      id: string;
      user_id: string;
      percentage: unknown;
      user: PerfilDoMembro | null;
    }[];

    if (activeMembers.length === 0) {
      return NextResponse.json(
        { error: "No active members found" },
        { status: 400 }
      );
    }

    const ids = activeMembers.map((m) => m.id);
    const perfilPorMembro = new Map(activeMembers.map((m) => [m.id, m.user]));

    /**
     * Pesos -> uma sugestao pronta, com o perfil de cada membro ao lado.
     *
     * Toda sugestao desta rota passa por aqui, e e isso que garante que todas
     * fechem: o % e o R$ saem de `partesDaSugestao`, nunca de uma conta escrita
     * no meio do handler.
     */
    const sugestao = (
      type: TipoDeSugestao,
      name: string,
      description: string,
      pesos: readonly PesoDoMembro[],
      motivo: (parte: ParteDaSugestao) => string
    ): SplitSuggestion => ({
      type,
      name,
      description,
      splits: partesDaSugestao(pesos, amount).map((parte) => ({
        ...parte,
        user: perfilPorMembro.get(parte.member_id) ?? null,
        reason: motivo(parte),
      })),
    });

    const suggestions: SplitSuggestion[] = [];

    // 1. A divisao CONFIGURADA do grupo (fase 3), quando o fechamento do mes a
    //    aplica. Vem PRIMEIRO porque ela e a regra que o grupo combinou: e o
    //    numero que o fechamento vai cobrar de qualquer jeito no fim do mes.
    const configurados = pesosConfigurados(
      group.default_split_type,
      activeMembers.map((m) => ({ member_id: m.id, percentage: m.percentage }))
    );

    if (configurados) {
      suggestions.push(
        sugestao(
          "proportional",
          "Divisão Configurada",
          `A divisão gravada do grupo: ${configurados
            .map((p) => `${pct(p.centesimos / 100)}%`)
            .join(" / ")}`,
          configurados,
          (parte) => `${pct(parte.percentage)}% conforme a divisão do grupo`
        )
      );
    }

    // 2. Divisao igual: sempre disponivel, porque nao depende de configuracao.
    //    E a sugestao que todo grupo em `equal` -- e todo grupo que ninguem
    //    configurou -- vai ver, e e tambem o que o fechamento do mes cobra
    //    nesses casos.
    suggestions.push(
      sugestao(
        "equal",
        "Divisão Igual",
        `Dividir igualmente entre ${activeMembers.length} membros`,
        pesosIguais(ids),
        () => "Divisão igual padrão"
      )
    );

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
            user_id
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

    if (
      recentTransactions &&
      recentTransactions.length >= AMOSTRA_MINIMA_DO_HISTORICO
    ) {
      // A participacao de cada membro ATIVO na amostra. A chave e o `member_id`,
      // e nao o `user_id`: e ele que o corpo do POST exige, e e ele que decide o
      // desempate do centavo.
      const participacoes = new Map<string, ParticipacaoDoMembro>(
        ids.map((member_id) => [
          member_id,
          { member_id, somaPercentual: 0, participacoes: 0 },
        ])
      );

      recentTransactions.forEach((gt) => {
        gt.splits?.forEach((split) => {
          const memberId = split?.member?.id;
          const registro = memberId ? participacoes.get(memberId) : undefined;
          if (!registro) return;
          registro.somaPercentual += Number(split.percentage) || 0;
          registro.participacoes += 1;
        });
      });

      const historicos = pesosDoHistorico(
        ids.map((member_id) => participacoes.get(member_id)!)
      );

      if (historicos) {
        suggestions.push(
          sugestao(
            "historical",
            "Baseado no Histórico",
            `Sugestão baseada na participação média dos últimos ${recentTransactions.length} gastos`,
            historicos,
            (parte) => `${pct(parte.percentage)}% baseado no histórico recente`
          )
        );
      }
    }

    // 4. Quem adianta a maioria das despesas assume cinco pontos a mais.
    if (recentTransactions && recentTransactions.length > 0) {
      const gastoPorMembro = new Map<string, number>();
      const membroPorUsuario = new Map(activeMembers.map((m) => [m.user_id, m.id]));

      recentTransactions.forEach((gt) => {
        // O `user_id` sai do embed, que pode ser nulo -- entao ele e lido antes,
        // e nao direto dentro do `get`: `Map<string, string>.get` nao aceita
        // `undefined`, e era o `any` que escondia isso.
        const userId = gt.transaction?.user_id;
        const memberId = userId ? membroPorUsuario.get(userId) : undefined;
        if (!memberId) return;
        gastoPorMembro.set(
          memberId,
          (gastoPorMembro.get(memberId) ?? 0) +
            Math.abs(Number(gt.transaction?.amount) || 0)
        );
      });

      let pagadorId: string | null = null;
      let maiorGasto = 0;
      gastoPorMembro.forEach((gasto, memberId) => {
        if (gasto > maiorGasto) {
          maiorGasto = gasto;
          pagadorId = memberId;
        }
      });

      const gastoTotal = Array.from(gastoPorMembro.values()).reduce(
        (acc, g) => acc + g,
        0
      );

      if (pagadorId && maiorGasto > gastoTotal * FATIA_DO_PAGADOR_PRINCIPAL) {
        const ajustados = pesosDoPagadorPrincipal(ids, pagadorId);
        const nomeDoPagador =
          perfilPorMembro.get(pagadorId)?.full_name ?? "Um dos membros";

        if (ajustados) {
          suggestions.push(
            sugestao(
              "proportional",
              "Ajuste por Pagador Principal",
              `${nomeDoPagador} tem pago a maioria das despesas recentes`,
              ajustados,
              (parte) =>
                parte.member_id === pagadorId
                  ? "Pagador principal (+5 pontos)"
                  : "Ajuste por pagador principal"
            )
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      suggestions,
      group: {
        id: group.id,
        name: group.name,
        members_count: activeMembers.length,
        default_split_type: group.default_split_type,
        /**
         * `true` quando a divisao gravada do grupo esta valendo. A tela pode
         * usar isso para cobrar o ajuste: um grupo em "Igual" nao tem sugestao
         * configurada, e isso e informacao, nao ausencia de dado.
         */
        divisao_configurada_aplicada: configurados !== null,
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
