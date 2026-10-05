import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  montarParticipantesPorGrupo,
  parteConfiguradaDoMembro,
} from "@/lib/parte-do-grupo";

/**
 * As despesas de grupo que ainda NAO aconteceram (HMO-177).
 *
 * POR QUE A DESPESA FIXA DE GRUPO ERA INVISIVEL NO GRUPO
 * -----------------------------------------------------
 * Marcar uma despesa como "fixa" nao grava lancamento: grava uma regra em
 * `recurring_rules` e materializa as parcelas em `scheduled_transactions`
 * (Contas Previstas). A transacao real -- e com ela a linha de
 * `group_transactions` que o trigger `auto_create_group_transaction` cria --
 * so nasce na BAIXA da conta prevista.
 *
 * A tela do grupo lia unicamente `group_transactions`. Resultado: o aluguel do
 * grupo Casa era invisivel para os outros membros ate alguem dar baixa, todo
 * mes. Nao havia dado perdido -- o `group_id` e preservado na regra, na parcela
 * e na baixa --, faltava a leitura. Esta rota e a leitura que faltava.
 *
 * A RLS JA PERMITIA: NAO HOUVE MIGRATION
 * --------------------------------------
 * `scheduled_transactions_select` (005_recurring_and_scheduled.sql:310) libera
 * `user_id = auth.uid() OR (group_id IS NOT NULL AND is_group_member(group_id))`.
 * Quem e do grupo sempre pode ler a parcela de grupo do outro; ninguem de fora
 * pode. Por isso esta feature e so codigo, e o schema nao muda.
 *
 * O QUE FICA DE FORA, PARA NAO CONTAR A MESMA DESPESA DUAS VEZES
 * -------------------------------------------------------------
 * `status = 'paid'` e excluido. A conta paga tem `transaction_id` preenchido
 * (o CHECK `scheduled_transactions_paid_check` exige), e essa transacao ja
 * virou `group_transactions` -- ou seja, ela JA aparece na aba de despesas.
 * Trazer as pagas aqui tambem dobraria o aluguel na tela do grupo, que e
 * exatamente o defeito que esta issue existe para nao criar.
 */
export async function GET(
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

    const { data: membership } = await supabase
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // A view calcula 'overdue' na hora (nunca gravado) e tem security_invoker,
    // entao a RLS de scheduled_transactions continua valendo aqui.
    const { data: linhas, error } = await supabase
      .from("scheduled_transactions_effective")
      .select(
        "id, description, amount, due_date, status, effective_status, days_until_due, user_id, recurring_rule_id, category_id"
      )
      .eq("group_id", groupId)
      .neq("status", "paid")
      .order("due_date", { ascending: true });

    if (error) {
      console.error("Erro ao ler as previstas do grupo:", error);
      return NextResponse.json(
        { error: "Não foi possível carregar as despesas previstas" },
        { status: 500 }
      );
    }

    // `id, user_id, percentage` SAO LOAD-BEARING -- ver o comentario identico em
    // app/api/papel-de-pao/painel/route.ts.
    const { data: membros } = await supabase
      .from("group_members")
      .select("id, group_id, user_id, percentage, status")
      .eq("group_id", groupId)
      .eq("status", "active");

    const pesosPorGrupo = montarParticipantesPorGrupo(membros ?? []);

    // Quem vai pagar a conta. Sao poucos donos distintos (uma regra por
    // despesa fixa), entao uma consulta resolve todos.
    const donos = Array.from(
      new Set((linhas ?? []).map((l) => l.user_id).filter(Boolean))
    );

    const { data: perfis } = donos.length
      ? await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .in("id", donos)
      : { data: [] as { id: string; full_name: string; avatar_url?: string }[] };

    const perfilPorId = new Map(
      (perfis ?? []).map((p) => [p.id, p] as const)
    );

    const categorias = Array.from(
      new Set((linhas ?? []).map((l) => l.category_id).filter(Boolean))
    );

    const { data: cats } = categorias.length
      ? await supabase
          .from("transaction_categories")
          .select("id, name, icon")
          .in("id", categorias)
      : { data: [] as { id: string; name: string; icon?: string }[] };

    const catPorId = new Map((cats ?? []).map((c) => [c.id, c] as const));

    const previstas = (linhas ?? []).map((l) => ({
      id: l.id,
      description: l.description,
      amount: Number(l.amount),
      /**
       * A MINHA parte -- a de quem esta olhando, pelo percentual configurado.
       *
       * ERA "a parte de cada membro" ATE A HMO-303, e isso parava de ser uma
       * frase possivel: com a divisao igual a parte era a mesma para todos e um
       * numero so servia; com `group_members.percentage` ela e 70% para um e 30%
       * para outro. A tela escreve "sua parte {share_amount}" (page.tsx:1288),
       * entao a resposta certa e a de quem pediu -- `user.id`, e nao `l.user_id`,
       * que e o dono da conta.
       *
       * E e o MESMO numero que o fechamento vai cobrar: as duas leituras chamam
       * `ratearPorPeso` sobre a mesma lista de pesos.
       */
      share_amount: parteConfiguradaDoMembro(
        l.amount,
        groupId,
        pesosPorGrupo,
        user.id
      ),
      due_date: l.due_date,
      status: l.effective_status,
      is_overdue: l.effective_status === "overdue",
      days_until_due: l.days_until_due,
      /** true = nasceu de uma regra "fixa"; false = conta prevista avulsa. */
      is_recurring: Boolean(l.recurring_rule_id),
      payer: perfilPorId.get(l.user_id) ?? null,
      category: catPorId.get(l.category_id) ?? null,
    }));

    return NextResponse.json({
      success: true,
      scheduled: previstas,
      // A CONTAGEM SAI DA MESMA LISTA DE PESOS, e nao de uma segunda consulta:
      // "(2 pessoas)" na tela de fechamento tem de contar exatamente as pessoas
      // entre quem a conta foi rateada. `?? 1` por tras do `length` seria
      // impossivel -- a lista vazia e um grupo sem membro ativo, que a checagem
      // de `membership` acima ja recusou.
      active_members: (pesosPorGrupo.get(groupId) ?? []).length,
    });
  } catch (error) {
    console.error("Erro nas previstas do grupo:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
