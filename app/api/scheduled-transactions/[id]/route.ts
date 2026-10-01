// PATCH  /api/scheduled-transactions/{id}   edita, pula ou cancela ocorrencias
// DELETE /api/scheduled-transactions/{id}   tira ocorrencias da agenda
//
// Uma ocorrencia tem vida propria: a conta de luz deste mes pode ter outro
// valor sem que o gasto fixo mude, e o mes que nao vai ter aula pode ser
// pulado sem cancelar a mensalidade inteira.
//
// ALCANCE (HMO-170, estendido na HMO-228)
// ---------------------------------------
// As DUAS rotas aceitam `alcance`, no CORPO da requisicao:
//
//   apenas_esta      (padrao) so esta ocorrencia, como sempre foi
//   esta_e_proximas  esta e as pendentes que vencem DEPOIS dela, mais a regra
//   todas            todas as ocorrencias em ABERTO da serie
//
// O padrao e o comportamento antigo de proposito: um cliente que ja chamava
// estas rotas nao passa a mexer em meses que nunca pediu. Quem decide quais
// linhas entram e `lib/recorrencia-edicao.ts`, e o que nunca entra esta escrito
// la -- o pago (por `status`, nunca por data) e, em `esta_e_proximas`, tudo que
// vence antes da ancora.
//
// O ALCANCE VIAJA NO CORPO, E NAO NO CLIENTE
// ------------------------------------------
// A alternativa seria a tela montar a lista de ids e aplicar um por um. Esse
// laco fica aplicado PELA METADE quando a conexao cai no meio -- e o estado
// pela metade de uma serie nao tem como ser descoberto depois: nada na tela
// distingue "3 meses alterados de 8" de "a serie tinha 3 meses".
//
// O QUE A EXCLUSAO FAZ, POR ALCANCE
// ---------------------------------
//   apenas_esta      `skipped` naquela ocorrencia
//   esta_e_proximas  `skipped` nas futuras E `end_date` na regra, na data da
//                    ancora. Marcar so as linhas protege apenas o horizonte ja
//                    materializado -- ver o cabecalho de recorrencia-edicao.ts
//   todas            chama `encerrarRegra`, o MESMO caminho de
//                    DELETE /api/recurring-rules/{id}

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { isIsoDate } from "@/lib/recurrence";
import {
  alcancaIrmas,
  conferirPatchNoAlcance,
  ehAlcanceValido,
  planejarEdicao,
  planejarExclusao,
  type AlcanceDaEdicao,
} from "@/lib/recorrencia-edicao";
import { encerrarRegra } from "@/lib/services/scheduled";

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
        {
          error:
            'Alcance inválido. Use "apenas_esta", "esta_e_proximas" ou "todas".',
        },
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

    // `alcancaIrmas` e nao `=== "esta_e_proximas"`: quando o `todas` chegou,
    // este `if` estava escrito para DOIS alcances, e deixa-lo assim faria a
    // rota planejar sobre uma lista vazia e responder "alterei 1 ocorrencia"
    // -- sucesso, sem erro, sem ter alterado a serie.
    if (alcancaIrmas(alcance) && atual.recurring_rule_id) {
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
        plano.ids.length === 1
          ? "Conta prevista atualizada"
          : alcance === "todas"
            ? `Alterei as ${plano.ids.length} ocorrências em aberto.`
            : `Alterei esta e as ${plano.ids.length - 1} próximas.`,
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

    // O ALCANCE CHEGA NO CORPO, E O CORPO DE UM DELETE PODE NAO EXISTIR
    // -----------------------------------------------------------------
    // `request.json()` num DELETE sem corpo lanca -- e lancaria em todo cliente
    // que ja chamava esta rota antes da HMO-228, que e justamente quem nao sabe
    // mandar `alcance`. O default e o comportamento antigo, por isso.
    //
    // O alcance NAO vem na query string de proposito: ele e uma decisao sobre
    // dinheiro, e query string e o que acaba colado em link, repetido por
    // retentativa e registrado em log de proxy.
    let alcanceRecebido: unknown = "apenas_esta";
    try {
      const corpo = await request.json();
      if (corpo && typeof corpo === "object" && "alcance" in corpo) {
        alcanceRecebido = (corpo as { alcance: unknown }).alcance;
      }
    } catch {
      // Sem corpo: fica o padrao.
    }

    if (!ehAlcanceValido(alcanceRecebido)) {
      return NextResponse.json(
        {
          error:
            'Alcance inválido. Use "apenas_esta", "esta_e_proximas" ou "todas".',
        },
        { status: 400 }
      );
    }
    const alcance: AlcanceDaEdicao = alcanceRecebido;

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
        { error: "Conta já paga: estorne antes de excluir" },
        { status: 409 }
      );
    }

    // As irmas so sao buscadas no alcance que precisa delas. `alcancaIrmas` e
    // nao `=== "esta_e_proximas"`: esquecer o `todas` neste `if` faria a rota
    // planejar sobre uma lista vazia e responder sucesso sem ter feito nada.
    let irmas: {
      id: string;
      due_date: string;
      status: string;
      recurring_rule_id: string | null;
    }[] = [];

    if (alcancaIrmas(alcance) && atual.recurring_rule_id) {
      const { data: encontradas, error: erroDasIrmas } = await supabase
        .from("scheduled_transactions")
        .select("id, due_date, status, recurring_rule_id")
        .eq("recurring_rule_id", atual.recurring_rule_id)
        .eq("user_id", user.id);

      if (erroDasIrmas) {
        // Pular a lista pela metade tira alguns meses da agenda e nao outros,
        // sem nada na tela indicando quais. Melhor nao tirar nenhum.
        console.error("Erro ao ler as ocorrências da série:", erroDasIrmas);
        return NextResponse.json(
          { error: "Não foi possível ler as próximas ocorrências. Tente de novo." },
          { status: 500 }
        );
      }

      irmas = encontradas ?? [];
    }

    const plano = planejarExclusao(
      alcance,
      {
        id: params.id,
        due_date: atual.due_date,
        status: atual.status,
        recurring_rule_id: atual.recurring_rule_id,
      },
      irmas
    );

    // -----------------------------------------------------------------------
    // "TODAS": DELEGA PARA O CAMINHO QUE JA ENCERRA UMA REGRA
    // -----------------------------------------------------------------------
    if (plano.desativarRegra && atual.recurring_rule_id) {
      const encerrada = await encerrarRegra(
        supabase,
        atual.recurring_rule_id,
        user.id
      );

      if (!encerrada.ok) {
        return NextResponse.json(
          { error: "Não foi possível encerrar o gasto fixo" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        message: `Gasto fixo encerrado. ${encerrada.canceladas} ocorrência(s) em aberto saíram da agenda.`,
        rule: encerrada.rule,
        ocorrencias_canceladas: encerrada.canceladas,
        // As pagas e as vencidas em aberto ficam, e a tela diz isso: a conta
        // que venceu e nao foi paga continua sendo uma divida real.
        preservadas: 0,
        regra_encerrada: true,
      });
    }

    // -----------------------------------------------------------------------
    // CONTA AVULSA: DELETE DE VERDADE
    // -----------------------------------------------------------------------
    if (plano.apagarDeVez) {
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
    }

    // -----------------------------------------------------------------------
    // "APENAS ESTA" E "ESTA E AS PROXIMAS": skipped NAS LINHAS
    // -----------------------------------------------------------------------
    // Ocorrencia de gasto fixo e derivada da regra: apagar so faria a proxima
    // geracao trazer de volta. Vira 'skipped', que ocupa o lugar dela no indice
    // unico (recurring_rule_id, due_date) da 005 e nao ressuscita.
    const { data: puladas, error } = await supabase
      .from("scheduled_transactions")
      .update({ status: "skipped" })
      .in("id", plano.idsParaPular)
      .eq("user_id", user.id)
      .select();

    if (error || !puladas || puladas.length === 0) {
      return NextResponse.json(
        { error: "Não foi possível pular esta conta" },
        { status: 500 }
      );
    }

    // -----------------------------------------------------------------------
    // E A REGRA RECEBE `end_date` -- O PASSO SEM O QUAL A CONTA VOLTA
    // -----------------------------------------------------------------------
    // Marcar as linhas protege SO o horizonte ja materializado.
    // `materializarAgenda` roda sobre uma janela rolante de 3 meses e a regra
    // continua `is_active`: os vencimentos alem do horizonte de hoje nao tem
    // linha nenhuma segurando o lugar, e serao criados do zero na proxima
    // geracao. A conta apagada nao volta amanha -- volta alguns MESES depois,
    // que e pior, porque ninguem liga uma coisa a outra.
    let regraEncerradaEm: string | null = null;
    if (plano.encerrarRegraEm && atual.recurring_rule_id) {
      const { error: erroDaRegra } = await supabase
        .from("recurring_rules")
        .update({ end_date: plano.encerrarRegraEm })
        .eq("id", atual.recurring_rule_id)
        .eq("user_id", user.id);

      if (erroDaRegra) {
        // As linhas sairam da agenda e a regra continua gerando. Dizer isso e
        // melhor que um sucesso limpo: a conta volta sozinha num mes futuro, e
        // sem este aviso ninguem tem como ligar as duas coisas.
        console.error("Ocorrências puladas, mas a regra não foi encerrada:", erroDaRegra);
        return NextResponse.json(
          {
            message:
              "Tirei estas ocorrências da agenda, mas não consegui encerrar o gasto fixo. Ele vai voltar a gerar contas: confira em Gastos Fixos.",
            ocorrencias_puladas: puladas.length,
            preservadas: plano.preservadas.length,
            regra_encerrada_em: null,
          },
          { status: 207 }
        );
      }
      regraEncerradaEm = plano.encerrarRegraEm;
    }

    return NextResponse.json({
      message:
        plano.idsParaPular.length > 1
          ? `Tirei esta e as ${plano.idsParaPular.length - 1} próximas da agenda. O gasto fixo foi encerrado em ${plano.encerrarRegraEm}.`
          : "Ocorrência pulada (o gasto fixo continua ativo)",
      scheduled: puladas.find((linha) => linha.id === params.id) ?? puladas[0],
      ocorrencias_puladas: puladas.length,
      // Quantas ficaram na agenda por serem anteriores a esta ou por ja terem
      // sido pagas. A garantia so e visivel se ela vier em numero.
      preservadas: plano.preservadas.length,
      regra_encerrada_em: regraEncerradaEm,
    });
  } catch (error) {
    console.error("Erro ao excluir conta prevista:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
