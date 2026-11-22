import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { normalizarLancamento } from "@/lib/movimentacoes";
import { avisoDaDivisaoPaga } from "@/lib/conta-da-divisao";
import { cobrancaDaCompra, pularCobranca } from "@/lib/services/cobranca-no-cartao";
import { ehAlcanceValido, type AlcanceDaEdicao } from "@/lib/recorrencia-edicao";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = params;
    const body = await request.json();

    // Verificar se a transação pertence ao usuário
    const { data: existingTransaction, error: fetchError } = await supabase
      .from("financial_transactions")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (fetchError || !existingTransaction) {
      return NextResponse.json(
        { error: "Transaction not found or access denied" },
        { status: 404 }
      );
    }

    // Extrair campos que podem ser atualizados
    const {
      description,
      amount,
      category_id,
      transaction_date,
      notes,
      group_id,
      transaction_type,
    } = body;

    // Validar group_id se fornecido
    if (group_id && group_id !== existingTransaction.group_id) {
      const { data: groupMember } = await supabase
        .from("group_members")
        .select("id")
        .eq("group_id", group_id)
        .eq("user_id", user.id)
        .eq("status", "active")
        .single();

      if (!groupMember) {
        return NextResponse.json(
          { error: "User is not a member of the specified group" },
          { status: 403 }
        );
      }
    }

    // -----------------------------------------------------------------------
    // TIPO E SINAL NA EDICAO: A MESMA REGRA DO POST (HMO-181)
    // -----------------------------------------------------------------------
    // Este bloco tinha o defeito do POST, inteiro, e ele DESFAZIA o conserto de
    // la na primeira edicao: mandar o valor com o sinal certo junto com um
    // `category_id` fazia a comparacao contra zero dar falso, e a despesa era
    // regravada positiva. A linha nascia certa pelo POST novo e virava receita
    // ao ser editada -- um estrago que aparece depois, longe da causa.
    //
    // O tipo tambem nunca era escrito aqui. Com o backfill da 037 isso deixaria
    // de importar para as linhas antigas, mas nao para a linha que o usuario
    // edita: ela e justamente a que ele acabou de olhar.
    const existingAmount = Number(existingTransaction.amount);
    const updateData: Record<string, unknown> = {};

    if (existingTransaction.transaction_type === "transfer") {
      // PERNA DE TRANSFERENCIA NAO E RECLASSIFICADA AQUI.
      //
      // As duas pernas sao gravadas por /api/movimentacoes/transferencia e se
      // anulam (015). Trocar o tipo de UMA desfaz o par, e inverter o sinal
      // transforma a saida em entrada: os mesmos R$ 1.000 passariam a existir
      // duas vezes, e o saldo geral subiria sem ninguem ter recebido nada.
      // A direcao vem da linha, nao do que chegou no corpo.
      if (amount !== undefined) {
        const direcao = existingAmount < 0 ? -1 : 1;
        updateData.amount = direcao * Math.abs(amount);
      }
    } else {
      const categoriaId = category_id ?? existingTransaction.category_id;
      const { data: category } = categoriaId
        ? await supabase
            .from("transaction_categories")
            .select("is_expense")
            .eq("id", categoriaId)
            .single()
        : { data: null };

      // Trocar a CATEGORIA re-deriva o tipo. Sem isto, mover um lancamento de
      // "Salario" para "Alimentacao" manteria `income` gravado, e a despesa
      // entraria no mes como receita com a categoria certa do lado.
      const declarado =
        transaction_type ??
        (category_id !== undefined && category_id !== existingTransaction.category_id
          ? null
          : existingTransaction.transaction_type);

      const normalizado = normalizarLancamento({
        amount: amount !== undefined ? amount : existingAmount,
        transaction_type: declarado,
        categoriaEhDespesa: category?.is_expense ?? null,
      });

      if (!normalizado.ok) {
        return NextResponse.json({ error: normalizado.erro }, { status: 400 });
      }

      // O tipo e regravado sempre: e o que tira da invisibilidade a linha
      // antiga, criada sem a coluna, no momento em que o usuario mexe nela.
      updateData.transaction_type = normalizado.tipo;
      if (amount !== undefined) updateData.amount = normalizado.amount;
    }

    if (description !== undefined) updateData.description = description;
    if (category_id !== undefined) updateData.category_id = category_id;
    if (transaction_date !== undefined)
      updateData.transaction_date = transaction_date;
    if (notes !== undefined) updateData.notes = notes;
    if (group_id !== undefined) updateData.group_id = group_id || null;

    // -----------------------------------------------------------------------
    // ESTE LANCAMENTO SOMA NOS TOTAIS? (HMO-443, migration 060)
    // -----------------------------------------------------------------------
    // "adicionei um ajuste na minha conta investimento, ela entrou como uma
    // receita de ajuste mas nao quero que ela fique somando nos totais."
    //
    // `=== true` E NAO `Boolean(...)`, E ESTA E A LINHA QUE IMPORTA. A forma e
    // copiada de `app/api/financial-accounts/[id]/route.ts` (o PATCH da 058),
    // palavra por palavra, porque a pergunta e a mesma um nivel abaixo -- e a
    // armadilha tambem: a coluna e `NOT NULL` e isto vai para um UPDATE, onde
    // nao existe "omitir e cair no DEFAULT" como no INSERT do POST. O que
    // entrar em `updateData` e GRAVADO.
    //
    // Com `Boolean(body.include_in_total)`, um cliente que mandasse a STRING
    // `"false"` -- um form urlencoded, um `FormData`, um fetch montado a mao --
    // RELIGARIA o lancamento (`Boolean("false") === true`), em silencio e com
    // 200: a pessoa clica em "Não somar nos totais", a tela diz pronto, e o
    // total continua incluindo o ajuste. Com `=== true`, qualquer coisa que nao
    // seja o booleano `true` DESLIGA -- e desligar e o estado reversivel e
    // VISIVEL (o selo na linha, HMO-452), enquanto religar calado e o que
    // ninguem percebe. Na duvida, o lado seguro e o que a pessoa consegue ver.
    //
    // LANCAMENTO DE GRUPO PODE SER MARCADO, e a ausencia de recusa e decisao
    // (secao 6d do plano da HMO-443): o flag vale so para o relatorio PESSOAL
    // -- o rateio, o acerto e o saldo do grupo ignoram a coluna, porque a perna
    // de grupo do custo pessoal sai de `group_share_entries`, que nao passa por
    // `category_monthly_totals`. Recusar `group_id` aqui tiraria a escolha de
    // quem tem grupo sem proteger numero nenhum.
    //
    // NENHUM `.select()` DESTA ROTA NOMEIA A COLUNA, e isso tambem e
    // deliberado: os dois reads deste handler sao `select("*")` e
    // `select("*, category:..., expense_splits(...)")`. Um `select` que NOMEIA
    // coluna ausente faz o PostgREST responder `42703` e o handler cair em 500
    // -- o defeito plantado no #335 e consertado no #336 com a homonima da 058.
    if (body.include_in_total !== undefined)
      updateData.include_in_total = body.include_in_total === true;

    // Atualizar transação
    const { error: updateError } = await supabase
      .from("financial_transactions")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      console.error("Transaction update error:", updateError);

      // PDG01 e a recusa da migration 024 (HMO-176): a edicao mudaria uma
      // divisao de grupo cuja parte alguem ja aprovou. Nao e falha do servidor
      // -- e uma regra de negocio, e a mensagem vem escrita para ser lida por
      // quem lancou. Devolver 500 com "Failed to update transaction" faria a
      // tela dizer "tente de novo" para algo que nunca vai passar.
      if (updateError.code === "PDG01") {
        return NextResponse.json({ error: updateError.message }, { status: 409 });
      }

      // PDG02 e a recusa da 070: um dos lados da divisao com pessoa ja pagou a
      // conta dele, e mudar o valor ou a data deixaria a baixa com outro numero.
      const divisaoPaga = avisoDaDivisaoPaga(updateError);
      if (divisaoPaga) {
        return NextResponse.json({ error: divisaoPaga }, { status: 409 });
      }

      return NextResponse.json(
        { error: "Failed to update transaction" },
        { status: 500 }
      );
    }

    // -----------------------------------------------------------------------
    // GRUPO: QUEM REFAZ A DIVISAO E O BANCO (HMO-176)
    // -----------------------------------------------------------------------
    // Aqui havia um bloco que apagava a ligacao do grupo antigo e inseria a do
    // novo, com um rateio calculado a mao (valor / numero de membros). Ele
    // duplicava o que o trigger de financial_transactions faz -- e desde a
    // migration 024 o trigger faz isso CERTO, inclusive na edicao: move a
    // divisao de grupo, recalcula as partes pendentes pelo metodo do maior
    // resto do 007 (que nao perde centavo) e recusa a edicao quando alguem ja
    // aprovou a propria parte.
    //
    // Mantido, o bloco produziria dois defeitos novos: o INSERT bateria no
    // indice unico por transaction_id que a 024 criou -- e o erro so era
    // registrado no console, entao a rota responderia 200 com uma falha
    // silenciosa dentro --, e o rateio a mao reintroduziria o centavo perdido
    // que o 007 existiu para tirar (R$ 100 entre 3 davam 33,33 tres vezes).
    //
    // E a mesma conclusao a que a HMO-175 chegou na tela de lancamento: quando
    // o `await` do update acima retorna, a divisao JA esta em dia.

    // Buscar transação completa para retorno
    const { data: completeTransaction } = await supabase
      .from("financial_transactions")
      .select(
        `
        *,
        category:transaction_categories(*),
        expense_splits(
          *,
          participant:profiles!expense_splits_participant_id_fkey(full_name, avatar_url)
        )
      `
      )
      .eq("id", id)
      .single();

    return NextResponse.json({
      message: "Transaction updated successfully",
      transaction: completeTransaction,
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = params;

    // O ALCANCE DA SERIE, QUANDO O LANCAMENTO VEIO DE UMA RECEITA/GASTO FIXO
    // ----------------------------------------------------------------------
    // "Excluí um lançamento duplicado do meu salário e ele excluiu só aquele
    // mês. Se for fixo, deve perguntar se quero excluir apenas aquele mês,
    // daquele mês em diante ou todas."
    //
    // Sem `alcance` no corpo a rota faz o que sempre fez: apaga ESTE lancamento,
    // e o trigger da 065 devolve a ocorrencia que ele quitou para `pending` --
    // ela reaparece em "Previsto" como se nada tivesse sido apagado. Com
    // `alcance`, a ocorrencia deste mes sai da agenda e, conforme a escolha, as
    // dos meses seguintes tambem, pelo MESMO caminho do Excluir de uma conta
    // prevista (`DELETE /api/scheduled-transactions/{id}`): uma regra so para
    // "tirar meses de uma serie", e nao duas que divergem no primeiro conserto.
    //
    // No CORPO e nao na query string, pelo motivo escrito na rota da agenda: e
    // uma decisao sobre dinheiro.
    let alcance: AlcanceDaEdicao | null = null;
    // "Todos os meses" que apaga tambem os ja lancados (ver
    // lib/services/lancados-da-serie.ts). Repassado a agenda, so em `todas`.
    let apagarLancados = false;
    try {
      const corpo = await request.json();
      if (corpo && typeof corpo === "object") {
        apagarLancados =
          (corpo as { apagar_lancados?: unknown }).apagar_lancados === true;
      }
      if (corpo && typeof corpo === "object" && "alcance" in corpo) {
        const recebido = (corpo as { alcance: unknown }).alcance;
        if (!ehAlcanceValido(recebido)) {
          return NextResponse.json(
            {
              error:
                'Alcance inválido. Use "apenas_esta", "esta_e_proximas" ou "todas".',
            },
            { status: 400 }
          );
        }
        alcance = recebido;
      }
    } catch {
      // Sem corpo: o comportamento de sempre.
    }

    // Verificar se a transação pertence ao usuário
    const { data: existingTransaction, error: fetchError } = await supabase
      .from("financial_transactions")
      .select("group_id, transaction_type")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (fetchError || !existingTransaction) {
      return NextResponse.json(
        { error: "Transaction not found or access denied" },
        { status: 404 }
      );
    }

    // Remover group_transactions e splits relacionados primeiro
    // A COMPRA QUE O APP LANCOU DE UMA COBRANCA NO CARTAO (24/10/2026). Lida
    // ANTES do DELETE, porque o trigger da 065 apaga o elo; e pulada DEPOIS,
    // porque antes a conta prevista ainda esta paga. Sem isto, apagar a
    // assinatura de outubro a faria voltar na proxima leitura. Ver
    // `cobrancaDaCompra`.
    const cobrancaPulada = await cobrancaDaCompra(supabase, user.id, id);

    // A ocorrencia da serie que este lancamento quitou. Lida ANTES do DELETE
    // pela mesma razao de `cobrancaDaCompra`: depois dele o trigger da 065 ja
    // zerou o `transaction_id`, e o elo some. Transferencia fica de fora -- o
    // estorno dela e o `DELETE .../pay`, e ela nem chega a esta rota pela tela.
    let ocorrenciaDaSerie: string | null = null;
    if (alcance && existingTransaction.transaction_type !== "transfer") {
      const { data: ocorrencia } = await supabase
        .from("scheduled_transactions")
        .select("id, recurring_rule_id")
        .eq("user_id", user.id)
        .eq("transaction_id", id)
        .not("recurring_rule_id", "is", null)
        .maybeSingle();
      ocorrenciaDaSerie = ocorrencia?.id ?? null;
    }

    if (existingTransaction.group_id) {
      await supabase
        .from("group_transactions")
        .delete()
        .eq("transaction_id", id)
        .eq("group_id", existingTransaction.group_id);
    }

    // Deletar transação (expense_splits serão deletados automaticamente devido ao CASCADE)
    const { error: deleteError } = await supabase
      .from("financial_transactions")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (deleteError) {
      console.error("Transaction deletion error:", deleteError);

      // A mesma recusa da 070 no PATCH: apagar o lancamento apagaria a conta
      // que um dos lados ja pagou.
      const divisaoPaga = avisoDaDivisaoPaga(deleteError);
      if (divisaoPaga) {
        return NextResponse.json({ error: divisaoPaga }, { status: 409 });
      }
      return NextResponse.json(
        { error: "Failed to delete transaction" },
        { status: 500 }
      );
    }

    if (cobrancaPulada) await pularCobranca(supabase, user.id, cobrancaPulada);

    if (alcance && ocorrenciaDaSerie) {
      // 1. O MES DESTE LANCAMENTO SAI DA AGENDA, EM QUALQUER ALCANCE.
      //
      // O trigger da 065 acabou de devolver a ocorrencia para `pending`. Deixada
      // assim, ela reaparece em "Previsto" -- e o pior caso e o `todas`:
      // `encerrarRegra` so cancela as pendentes de HOJE em diante, entao o
      // salario de um mes que ja passou voltaria como receita atrasada depois de
      // a pessoa ter mandado apagar a serie inteira. `skipped` e o que a agenda
      // ja usa para "este mes nao acontece", e `encerrarRegra` o leva a
      // `cancelled` junto com as outras. O filtro de `pending` na escrita e o
      // mesmo da agenda: a cobranca no cartao ja foi pulada logo acima.
      const { error: erroAoPular } = await supabase
        .from("scheduled_transactions")
        .update({ status: "skipped" })
        .eq("id", ocorrenciaDaSerie)
        .eq("user_id", user.id)
        .eq("status", "pending");

      if (erroAoPular) {
        console.error("Lançamento apagado, mas o mês não saiu da agenda:", erroAoPular);
        return NextResponse.json(
          {
            message:
              "Apaguei o lançamento, mas este mês continua na agenda. Confira em Contas a Pagar.",
            lancamento_excluido: true,
          },
          { status: 207 }
        );
      }

      if (alcance === "apenas_esta") {
        return NextResponse.json({
          message:
            "Lançamento apagado. Este mês saiu da agenda e os próximos continuam vindo.",
          lancamento_excluido: true,
        });
      }

      // 2. OS MESES SEGUINTES (OU TODOS) PELO EXCLUIR DA AGENDA.
      //
      // O DELETE da agenda e importado AQUI, sob demanda, e por caminho
      // relativo: as suites que compilam esta rota rodam o JS sem empacotador,
      // so reescrevem os aliases de `lib` e nao passam por este galho. Um import
      // estatico quebraria o carregamento delas inteiro.
      const { DELETE: tirarDaAgenda } = await import(
        "../../../scheduled-transactions/[id]/route"
      );
      const daAgenda = await tirarDaAgenda(
        new NextRequest(
          new URL(`/api/scheduled-transactions/${ocorrenciaDaSerie}`, request.url),
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              alcance === "todas" && apagarLancados
                ? { alcance, apagar_lancados: true }
                : { alcance }
            ),
          }
        ),
        { params: { id: ocorrenciaDaSerie } }
      );
      const serie = await daAgenda.json().catch(() => ({}));

      // 207 da agenda tambem e metade: as linhas sairam e a regra nao encerrou.
      if (!daAgenda.ok || daAgenda.status === 207) {
        // O lancamento JA saiu, e isso nao volta. Dizer so "erro" mandaria a
        // pessoa tentar de novo sobre uma linha que nao existe mais; o que ela
        // precisa saber e que a serie nao ficou como ela pediu.
        return NextResponse.json(
          {
            message:
              "Apaguei o lançamento e tirei este mês da agenda, mas não consegui encerrar a série" +
              (serie?.error ? `: ${serie.error}` : ".") +
              " Confira em Contas a Pagar.",
            lancamento_excluido: true,
            serie,
          },
          { status: 207 }
        );
      }

      const outros = Number(
        alcance === "todas"
          ? serie?.ocorrencias_canceladas ?? 0
          : serie?.ocorrencias_puladas ?? 0
      );
      const fora =
        outros > 0
          ? ` ${outros} ${outros === 1 ? "mês em aberto saiu" : "meses em aberto saíram"} da agenda.`
          : "";

      const outrosLancados = Number(serie?.lancados_apagados ?? 0);

      return NextResponse.json({
        message:
          alcance === "todas" && apagarLancados
            ? `Série apagada: ${
                outrosLancados > 0
                  ? `este lançamento e mais ${outrosLancados} já ${outrosLancados === 1 ? "feito saíram" : "feitos saíram"}`
                  : "este lançamento saiu"
              }, e a série foi encerrada.${fora}` +
              (Number(serie?.preservadas ?? 0) > 0
                ? ` ${serie.preservadas} ficaram (transferência ou conta dividida já paga).`
                : "")
            : alcance === "todas"
            ? `Lançamento apagado e a série encerrada.${fora} Os meses já lançados ficam no histórico.`
            : `Lançamento apagado e a série encerrada a partir deste mês.${fora}`,
        lancamento_excluido: true,
        serie,
      });
    }

    return NextResponse.json({
      message: "Transaction deleted successfully",
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
