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
 *
 * ===========================================================================
 * O ESTADO POR MEMBRO -- HMO-411
 * ===========================================================================
 * `scheduled_transactions` tem UM status e ele e do DONO. A migration 055 pos
 * o estado de cada pessoa em `group_bill_payments`, e esta rota e o LEITOR
 * dele: sem ela o `reported` que o membro grava e dado sem leitor, que nesta
 * base e o mesmo que nao existir -- a feature passaria verde com ninguem
 * vendo nada.
 *
 * O `.neq("status","paid")` ABAIXO NAO MUDA, e isso foi pedido: o GRUPO
 * continua sem status de pago. Quando o dono da baixa, a despesa vira real, o
 * rateio nasce e a linha passa para a aba de despesas -- ela sai das
 * previstas de proposito. Por isso o filtro continua lendo `status` (o do
 * dono) e nao `my_status`: a pergunta aqui e sobre a CONTA, nao sobre a
 * pessoa.
 *
 * O QUADRO E DO DONO, E QUEM DIZ ISSO E A RLS
 * -------------------------------------------
 * A policy de SELECT da 055 entrega uma linha de pagamento a duas pessoas: a
 * dona DELA e o dono da CONTA PREVISTA. Mais ninguem -- nem os outros membros
 * do grupo. Entao:
 *
 *   * quem criou a conta ve o quadro inteiro ("Helio pagou · Lais avisou que
 *     pagou · Ana pendente");
 *   * quem NAO criou ve duas linhas: a do dono (que sai do `status` da conta
 *     prevista, legivel por todo membro) e a sua propria.
 *
 * E AQUI ESTA A ARMADILHA QUE ESTA ROTA EVITA. Linha ausente em
 * `group_bill_payments` vale `pending` -- e esse e o COALESCE da view. Mas
 * para quem NAO e o dono a linha da Ana tambem chega ausente, **porque a RLS
 * a escondeu**, e os dois casos sao indistinguiveis daqui. Imprimir "Ana
 * pendente" nessa situacao seria inventar: a Ana pode ter avisado ha uma
 * semana. Por isso a resposta so lista quem ela pode AFIRMAR, e marca
 * `estado_parcial` para a tela dizer por que a lista esta curta.
 */

/** Uma linha de `group_bill_payments` como a 055 a entrega (HMO-411). */
type GroupBillPayment = {
  scheduled_transaction_id: string;
  user_id: string;
  status: string;
  reported_at: string | null;
};

/** O estado de UMA pessoa numa conta prevista do grupo (HMO-411). */
type EstadoDoMembro = {
  user_id: string;
  full_name: string | null;
  avatar_url?: string | null;
  estado: "pago" | "avisou" | "pendente";
};

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

    // -----------------------------------------------------------------------
    // O ESTADO POR MEMBRO (HMO-411) -- ver o cabecalho
    // -----------------------------------------------------------------------
    // UMA consulta para a lista inteira, e nao uma por linha: sao poucas
    // previstas por grupo e o `.in` resolve todas de uma vez. A RLS da 055
    // filtra sozinha o que cada leitor pode ver, e e exatamente por isso que
    // o resultado nao pode ser lido como "quem nao esta aqui esta pendente".
    // `user` ja foi recusado la em cima com 401; a const existe para o `tsc`
    // nao reabrir a duvida dentro do fechamento abaixo.
    const meuId = user.id;

    const idsDasPrevistas = (linhas ?? []).map((l) => l.id);

    const { data: pagamentos, error: erroPagamentos } = idsDasPrevistas.length
      ? await supabase
          .from("group_bill_payments")
          .select("scheduled_transaction_id, user_id, status, reported_at")
          .in("scheduled_transaction_id", idsDasPrevistas)
      : { data: [] as GroupBillPayment[], error: null };

    if (erroPagamentos) {
      // A LISTA NAO CAI POR CAUSA DO QUADRO. Mesma decisao das outras rotas de
      // dinheiro desta base: sem o quadro a tela mostra a lista de antes desta
      // feature, que e o estado de ontem -- derrubar a aba inteira seria
      // trocar uma informacao a menos por nenhuma.
      console.error(
        "As previstas do grupo seguiram sem o estado por membro:",
        erroPagamentos
      );
    }

    const pagamentosPorPrevista = new Map<string, GroupBillPayment[]>();
    for (const p of (pagamentos ?? []) as GroupBillPayment[]) {
      const lista = pagamentosPorPrevista.get(p.scheduled_transaction_id) ?? [];
      lista.push(p);
      pagamentosPorPrevista.set(p.scheduled_transaction_id, lista);
    }

    // Os perfis de TODOS os membros ativos, e nao so os dos donos: o quadro
    // nomeia gente que nao criou conta nenhuma.
    const membrosAtivos = (membros ?? []).map((m) => m.user_id).filter(Boolean);
    const aNomear = Array.from(new Set([...donos, ...membrosAtivos])).filter(
      (id) => !perfilPorId.has(id)
    );

    if (aNomear.length) {
      const { data: outros } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", aNomear);
      for (const p of outros ?? []) perfilPorId.set(p.id, p);
    }

    /**
     * O quadro de UMA conta prevista.
     *
     * O DONO SAI DO `status` DA CONTA, E NAO DE `group_bill_payments`: ele
     * nunca tem linha la (a view 055 resolve `my_status` dele por
     * `s.status::text` e ignora a tabela), e a conta so chega aqui com
     * `status <> 'paid'` -- logo o dono esta sempre pendente nesta lista. A
     * linha dele existe mesmo assim porque um quadro que comeca na Lais faz
     * parecer que o Helio nao deve nada.
     */
    const quadroDaPrevista = (previstaId: string, donoId: string) => {
      const minhas = pagamentosPorPrevista.get(previstaId) ?? [];
      const souODono = donoId === meuId;

      const porUsuario = new Map(minhas.map((p) => [p.user_id, p] as const));

      // QUEM EU POSSO AFIRMAR. Sendo o dono, todo membro ativo -- a RLS me
      // entregou as linhas de todos, e a ausencia de linha e `pending` de
      // verdade. Nao sendo, so eu e o dono: a ausencia da linha da Ana pode
      // ser a RLS, e chama-la de pendente seria inventar.
      const aListar = souODono
        ? membrosAtivos
        : Array.from(new Set([donoId, meuId]));

      const estados: EstadoDoMembro[] = aListar.map((id) => {
        const perfil = perfilPorId.get(id);
        const base = {
          user_id: id,
          full_name: perfil?.full_name ?? null,
          avatar_url: perfil?.avatar_url ?? null,
        };

        if (id === donoId) return { ...base, estado: "pendente" as const };

        const linha = porUsuario.get(id);
        if (linha?.status === "paid") return { ...base, estado: "pago" as const };
        if (linha?.status === "reported")
          return { ...base, estado: "avisou" as const };
        return { ...base, estado: "pendente" as const };
      });

      return {
        estado_por_membro: estados,
        // A TELA PRECISA DISTINGUIR "todo mundo pendente" DE "nao posso ver".
        // Sem esta flag as duas respostas sao a MESMA lista curta, e a
        // segunda se leria como a primeira.
        estado_parcial: !souODono,
      };
    };

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
      // HMO-411: "Helio pendente · Lais avisou que pagou · Ana pendente".
      ...quadroDaPrevista(l.id, l.user_id),
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
