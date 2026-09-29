// PATCH  /api/scheduled-transactions/{id}   edita, pula ou cancela uma ocorrencia
// DELETE /api/scheduled-transactions/{id}   remove uma conta avulsa
//
// Uma ocorrencia tem vida propria: a conta de luz deste mes pode ter outro
// valor sem que o gasto fixo mude, e o mes que nao vai ter aula pode ser
// pulado sem cancelar a mensalidade inteira.
//
// ALCANCE DA EDICAO (HMO-170)
// ---------------------------
// O PATCH aceita `alcance`:
//
//   apenas_esta      (padrao) so esta ocorrencia, como sempre foi
//   esta_e_proximas  esta e as pendentes que vencem DEPOIS dela, mais a regra
//
// O padrao e o comportamento antigo de proposito: um cliente que ja chamava
// esta rota nao passa a reescrever meses que nunca pediu para mexer. Quem decide
// quais linhas entram e `lib/recorrencia-edicao.ts`, e o que nunca entra esta
// escrito la -- o pago, e tudo que vence antes da ancora.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { isIsoDate } from "@/lib/recurrence";
import {
  conferirPatchNoAlcance,
  ehAlcanceValido,
  planejarEdicao,
  type AlcanceDaEdicao,
} from "@/lib/recorrencia-edicao";

const STATUS_MANUAIS = ["pending", "skipped", "cancelled"];

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const {
      description,
      amount,
      due_date,
      category_id,
      account_id,
      notes,
      status,
      alcance: alcanceRecebido = "apenas_esta",
    } = body;

    if (!ehAlcanceValido(alcanceRecebido)) {
      return NextResponse.json(
        { error: 'Alcance inválido. Use "apenas_esta" ou "esta_e_proximas".' },
        { status: 400 }
      );
    }
    const alcance: AlcanceDaEdicao = alcanceRecebido;

    const patch: Record<string, unknown> = {};

    if (description !== undefined) {
      if (!description?.trim()) {
        return NextResponse.json({ error: "Descrição é obrigatória" }, { status: 400 });
      }
      patch.description = description.trim();
    }

    if (amount !== undefined) {
      if (!amount || Number(amount) <= 0) {
        return NextResponse.json({ error: "Valor deve ser maior que zero" }, { status: 400 });
      }
      patch.amount = Math.abs(Number(amount));
    }

    if (due_date !== undefined) {
      if (!isIsoDate(due_date)) {
        return NextResponse.json(
          { error: "Vencimento deve estar no formato AAAA-MM-DD" },
          { status: 400 }
        );
      }
      patch.due_date = due_date;
    }

    if (category_id !== undefined) patch.category_id = category_id;
    if (account_id !== undefined) patch.account_id = account_id || null;
    if (notes !== undefined) patch.notes = notes || null;

    if (status !== undefined) {
      // 'paid' so pela rota /pay, que cria a transacao real. Marcar aqui
      // esbarraria na constraint scheduled_transactions_paid_check e voltaria
      // um 500 sem explicacao. 'overdue' nunca e gravado: e calculado.
      if (!STATUS_MANUAIS.includes(status)) {
        return NextResponse.json(
          {
            error:
              "Status inválido. Para dar baixa use POST /api/scheduled-transactions/{id}/pay.",
          },
          { status: 400 }
        );
      }
      patch.status = status;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
    }

    // O patch cabe no alcance? Mudar o vencimento de varias parcelas de uma vez
    // colidiria no indice unico (rule_id, due_date) da 005 e voltaria um erro de
    // banco sem relacao visivel com o pedido. A recusa explica onde mudar.
    const cabe = conferirPatchNoAlcance(alcance, Object.keys(patch));
    if (!cabe.ok) {
      return NextResponse.json({ error: cabe.mensagem }, { status: 400 });
    }

    // A conta ja paga esta amarrada a uma transacao real; mexer nela aqui
    // deixaria os dois lados divergentes. O caminho e estornar primeiro.
    //
    // `due_date` e `recurring_rule_id` entram no select por causa do alcance: a
    // data e a barreira do que conta como "proximas", e sem a regra nao ha
    // serie para propagar.
    const { data: atual } = await supabase
      .from("scheduled_transactions")
      .select("status, due_date, recurring_rule_id")
      .eq("id", params.id)
      .eq("user_id", user.id)
      .single();

    if (!atual) {
      return NextResponse.json({ error: "Conta prevista não encontrada" }, { status: 404 });
    }

    if (atual.status === "paid") {
      return NextResponse.json(
        {
          error:
            "Esta conta já foi paga. Estorne pelo DELETE em /pay antes de editar.",
        },
        { status: 409 }
      );
    }

    // -----------------------------------------------------------------------
    // QUAIS LINHAS ESTA EDICAO TOCA
    // -----------------------------------------------------------------------
    // As irmas so sao buscadas no alcance que precisa delas: em `apenas_esta`
    // -- o padrao, e a maioria das edicoes -- a consulta nao acontece.
    let irmas: {
      id: string;
      due_date: string;
      status: string;
      recurring_rule_id: string | null;
    }[] = [];

    if (alcance === "esta_e_proximas" && atual.recurring_rule_id) {
      // Sem filtro de data nem de status aqui de proposito: quem decide o que
      // fica de fora e `planejarEdicao`, para que a regra tenha UM lugar e o
      // teste possa cobrar ela sem banco. O volume e de uma serie mensal, nao
      // de um extrato.
      const { data: encontradas, error: erroDasIrmas } = await supabase
        .from("scheduled_transactions")
        .select("id, due_date, status, recurring_rule_id")
        .eq("recurring_rule_id", atual.recurring_rule_id)
        .eq("user_id", user.id);

      if (erroDasIrmas) {
        // Propagar com a lista pela metade alteraria alguns meses e nao outros,
        // sem nada na tela indicando quais. Melhor nao alterar nada.
        console.error("Erro ao ler as ocorrências da série:", erroDasIrmas);
        return NextResponse.json(
          { error: "Não foi possível ler as próximas ocorrências. Tente de novo." },
          { status: 500 }
        );
      }

      irmas = encontradas ?? [];
    }

    const plano = planejarEdicao(
      alcance,
      {
        id: params.id,
        due_date: atual.due_date,
        status: atual.status,
        recurring_rule_id: atual.recurring_rule_id,
      },
      irmas
    );

    const { data: scheduled, error } = await supabase
      .from("scheduled_transactions")
      .update(patch)
      // `.in` no lugar do `.eq` de antes: em `apenas_esta` o plano tem um id so,
      // entao este caminho continua sendo o mesmo UPDATE de uma linha.
      .in("id", plano.ids)
      .eq("user_id", user.id)
      .select(
        `
        *,
        category:transaction_categories(*),
        account:financial_accounts(id, name, account_type, color_hex),
        group:expense_groups(id, name, group_code)
      `
      );

    // Sem `.single()`: o alcance "esta e as proximas" devolve varias linhas, e
    // `.single()` responde 406 quando vem mais de uma -- a edicao ACONTECERIA e
    // a tela receberia erro, que e o pior dos dois mundos.
    if (error || !scheduled || scheduled.length === 0) {
      console.error("Erro ao editar conta prevista:", error);
      return NextResponse.json(
        { error: "Não foi possível atualizar a conta prevista" },
        { status: 500 }
      );
    }

    // A ancora e o que a tela pediu para editar; as outras sao consequencia.
    const ancora = scheduled.find((linha) => linha.id === params.id) ?? scheduled[0];

    // -----------------------------------------------------------------------
    // A REGRA TAMBEM MUDA
    // -----------------------------------------------------------------------
    // Sem este passo, a alteracao valeria para as ocorrencias que JA estao
    // materializadas e a proxima geracao traria o valor velho de volta: o
    // aluguel reajustado voltaria ao valor antigo no primeiro mes que a agenda
    // ainda nao tinha criado. Ninguem liga o reaparecimento a esta edicao.
    let regraAtualizada = false;
    if (plano.atualizarRegra && atual.recurring_rule_id) {
      const patchDaRegra: Record<string, unknown> = {};
      for (const campo of ["description", "amount", "category_id", "account_id", "notes"]) {
        if (campo in patch) patchDaRegra[campo] = patch[campo];
      }

      if (Object.keys(patchDaRegra).length > 0) {
        const { error: erroDaRegra } = await supabase
          .from("recurring_rules")
          .update(patchDaRegra)
          .eq("id", atual.recurring_rule_id)
          .eq("user_id", user.id);

        if (erroDaRegra) {
          // As ocorrencias mudaram e a regra nao. Dizer isso e melhor que um
          // sucesso limpo: o valor volta sozinho num mes futuro, e sem este
          // aviso ninguem tem como ligar as duas coisas.
          console.error("Ocorrências alteradas, mas a regra não:", erroDaRegra);
          return NextResponse.json(
            {
              message:
                "Alterei as ocorrências, mas não consegui atualizar o gasto fixo. Confira o valor dele em Contas Previstas.",
              scheduled: ancora,
              ocorrencias_alteradas: scheduled.length,
              preservadas: plano.preservadas.length,
              regra_atualizada: false,
            },
            { status: 207 }
          );
        }
        regraAtualizada = true;
      }
    }

    return NextResponse.json({
      message:
        plano.ids.length > 1
          ? `Alterei esta e as ${plano.ids.length - 1} próximas.`
          : "Conta prevista atualizada",
      scheduled: ancora,
      ocorrencias_alteradas: scheduled.length,
      // Quantas ficaram como estavam por serem anteriores a esta ou por ja
      // terem sido pagas. A garantia "nunca muda o que ja passou" so e visivel
      // se ela vier em numero.
      preservadas: plano.preservadas.length,
      regra_atualizada: regraAtualizada,
    });
  } catch (error) {
    console.error("Erro ao editar conta prevista:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const { data: atual } = await supabase
      .from("scheduled_transactions")
      .select("status, recurring_rule_id")
      .eq("id", params.id)
      .eq("user_id", user.id)
      .single();

    if (!atual) {
      return NextResponse.json({ error: "Conta prevista não encontrada" }, { status: 404 });
    }

    if (atual.status === "paid") {
      return NextResponse.json(
        { error: "Conta já paga: estorne antes de excluir" },
        { status: 409 }
      );
    }

    // Ocorrencia de gasto fixo e derivada da regra: apagar so faria a proxima
    // geracao trazer de volta. Vira 'skipped', que ocupa o lugar dela no
    // indice unico e nao ressuscita.
    if (atual.recurring_rule_id) {
      const { data: pulada, error } = await supabase
        .from("scheduled_transactions")
        .update({ status: "skipped" })
        .eq("id", params.id)
        .eq("user_id", user.id)
        .select()
        .single();

      if (error || !pulada) {
        return NextResponse.json(
          { error: "Não foi possível pular esta conta" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        message: "Ocorrência pulada (o gasto fixo continua ativo)",
        scheduled: pulada,
      });
    }

    const { error } = await supabase
      .from("scheduled_transactions")
      .delete()
      .eq("id", params.id)
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json(
        { error: "Não foi possível excluir a conta prevista" },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: "Conta prevista excluída" });
  } catch (error) {
    console.error("Erro ao excluir conta prevista:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
