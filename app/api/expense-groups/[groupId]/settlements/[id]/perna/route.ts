import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { MOEDA_PADRAO, moedaConhecida } from "@/lib/dinheiro";
import {
  chaveDoAcerto,
  mensagemDaContaDoAcerto,
  pernaDoAcerto,
} from "@/lib/acerto-em-lancamento";
import { categoriaDoAcerto } from "@/lib/categoria-do-acerto";
import {
  mensagemDaRecusaDaPerna,
  minhaPernaPodeSerGravada,
  recusaDeRemoverSoAMinhaPerna,
} from "@/lib/perna-da-contraparte";

/**
 * A PERNA DA CONTRAPARTE (HMO-245, fase 12)
 * =========================================
 *
 * POST grava a perna de quem NAO registrou o acerto. DELETE remove a perna de
 * quem chama -- e so ela, deixando a quitacao de pe.
 *
 * POR QUE ESTA ROTA EXISTE EM VEZ DE O POST DA QUITACAO GRAVAR AS DUAS PERNAS
 * ---------------------------------------------------------------------------
 * `financial_transactions_write` e `FOR INSERT WITH CHECK (user_id =
 * auth.uid())` (`002_rls_lockdown.sql:472`). A rota da quitacao roda na sessao
 * de quem clicou e grava a perna DELE; a da contraparte precisa da sessao da
 * contraparte, porque tambem precisa da CONTA dela -- e ninguem, nem o servidor,
 * tem como adivinhar de qual conta o dinheiro dela saiu.
 *
 * Isso mantem de pe a objecao 1 da migration 007 (*nunca mexer no saldo da
 * conta de outra pessoa*). A alternativa -- um trigger `SECURITY DEFINER`
 * escolhendo conta alheia -- e a forma de errar em silencio no saldo de
 * terceiro, e foi o motivo de a 007 ter recusado o desenho inteiro.
 *
 * O TIPO DA PERNA DE QUEM DEVE E `transfer`, NUNCA `expense`
 * ----------------------------------------------------------
 * Ela ja tomou a parte dela quando a despesa foi rateada
 * (`group_share_entries`, 033). Com `expense`, o Pix de R$ 200 entraria no
 * cartao Despesas dela EM CIMA dos R$ 200 da parte -- R$ 400 de despesa num mes
 * em que ela gastou 200. E o modo de falha mais traicoeiro desta fase porque
 * **o saldo fica certo**: `update_account_balance` soma `NEW.amount` sem olhar
 * `transaction_type` (`001_baseline.sql:833`), entao uma suite que meca so
 * `current_balance` fica verde com a despesa dobrada.
 *
 * O mesmo vale do lado de quem RECEBE, medido na fase 11: `income` ali apaga a
 * parte que ela mesma consumiu (`personal_category_monthly_totals` ignora
 * `transfer`), e o mes fecha empatado. As duas pernas sao `TIPO_DA_PERNA`, e a
 * invariante e **um acerto nunca muda a Receita nem a Despesa de ninguem**.
 *
 * ESTA ROTA NAO TOCA EM `group_settlements`
 * -----------------------------------------
 * Nem no POST nem no DELETE. A quitacao e de quem registrou (a policy de DELETE
 * da 007 exige `created_by = auth.uid()`), e a contraparte confirmando nao e
 * motivo para mudar linha nenhuma dela. O estado "ja lancou / nao lancou" nao
 * mora numa coluna: ele E a existencia da perna, e cada um le a propria.
 */

/** O que as duas verbos precisam ter conferido antes de encostar em dinheiro. */
async function acertoEPerna(
  supabase: ReturnType<typeof createClient>,
  groupId: string,
  settlementId: string,
  userId: string
) {
  // A RLS de `group_settlements` ja exige `is_group_member`, entao quem nao e
  // do grupo nao acha a linha. O filtro por `group_id` e contra a URL montada a
  // mao: o id de um acerto de OUTRO grupo em que a pessoa tambem esteja
  // responderia a leitura e gravaria uma perna pendurada no grupo errado.
  const { data: acerto } = await supabase
    .from("group_settlements")
    .select(
      "id, group_id, from_user_id, to_user_id, amount, currency, exchange_rate, settled_on, created_by"
    )
    .eq("id", settlementId)
    .eq("group_id", groupId)
    .maybeSingle();

  if (!acerto) return { erro: "Acerto não encontrado neste grupo.", status: 404 };

  // A propria perna, se existir. `notes` carrega `acerto:<id>` (fase 11) e a
  // RLS filtra por `user_id`, entao esta consulta responde "EU ja lancei?" e
  // nunca "o outro lancou?" -- que e uma pergunta que nenhuma sessao pode
  // responder, por policy.
  const { data: perna } = await supabase
    .from("financial_transactions")
    .select("id, amount, account_id, transaction_type")
    .eq("user_id", userId)
    .eq("notes", chaveDoAcerto(settlementId))
    .maybeSingle();

  return { acerto, perna: perna ?? null };
}

export async function POST(
  request: NextRequest,
  { params }: { params: { groupId: string; id: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { groupId, id } = params;
    const body = await request.json();

    const lido = await acertoEPerna(supabase, groupId, id, user.id);
    if ("erro" in lido) {
      return NextResponse.json({ error: lido.erro }, { status: lido.status });
    }
    const { acerto, perna: pernaExistente } = lido;

    // Sou parte? Ja lancei? As duas perguntas numa funcao pura, a MESMA que a
    // tela usa para decidir se mostra o botao -- se divergirem, a tela oferece
    // uma acao que a rota recusa.
    const permissao = minhaPernaPodeSerGravada({
      acerto,
      userId: user.id,
      temPerna: Boolean(pernaExistente),
    });

    if (permissao.recusa) {
      return NextResponse.json(
        { error: mensagemDaRecusaDaPerna(permissao.recusa) },
        // 409 e nao 400 no caso de duplicata: o pedido estava certo, o estado e
        // que mudou. Um duplo clique cai aqui, e a tela pode tratar os dois
        // casos de forma diferente.
        { status: permissao.recusa === "ja_lancado" ? 409 : 403 }
      );
    }

    const accountId =
      typeof body.account_id === "string" && body.account_id
        ? body.account_id
        : null;

    if (!accountId) {
      return NextResponse.json(
        { error: mensagemDaContaDoAcerto("sem_conta") },
        { status: 400 }
      );
    }

    // `user_id` no filtro: a conta de outra pessoa volta como "nao encontrada",
    // que e a resposta certa -- dizer "essa conta nao e sua" confirmaria que o
    // id existe. A RLS recusaria o insert de qualquer forma, com 42501.
    const { data: conta } = await supabase
      .from("financial_accounts")
      .select("id, name, account_type, currency")
      .eq("user_id", user.id)
      .eq("id", accountId)
      .maybeSingle();

    if (!conta) {
      return NextResponse.json(
        { error: mensagemDaContaDoAcerto("conta_nao_encontrada") },
        { status: 400 }
      );
    }

    const { data: servico } = await supabase
      .from("financial_services")
      .select("id")
      .eq("name", "personal_finance")
      .single();

    if (!servico) {
      return NextResponse.json(
        { error: "Serviço de finanças pessoais não encontrado" },
        { status: 404 }
      );
    }

    const categoria = await categoriaDoAcerto(supabase, user.id, servico.id);
    if ("erro" in categoria) {
      return NextResponse.json({ error: categoria.erro }, { status: 500 });
    }

    // Os nomes sao so para a descricao do extrato, e e por isso que a falha
    // deles nao derruba nada. Consultas diretas em vez de embed: `group_members`
    // tem mais de uma FK para `profiles` e o embed sairia PGRST201.
    const contraparteId =
      permissao.direcao === "recebi" ? acerto.from_user_id : acerto.to_user_id;

    const [{ data: contraparte }, { data: grupo }] = await Promise.all([
      supabase
        .from("profiles")
        .select("full_name")
        .eq("id", contraparteId)
        .maybeSingle(),
      supabase
        .from("expense_groups")
        .select("name")
        .eq("id", groupId)
        .maybeSingle(),
    ]);

    // A MOEDA E A TAXA SAO AS DA QUITACAO, nunca as de hoje: a 026 congelou as
    // duas em `settled_on` justamente para que o valor recebido nao mudasse
    // sozinho todo dia. A contraparte confirma dias depois -- e o caso normal
    // desta fase --, e por isso ler a taxa de hoje aqui seria um valor
    // diferente do que a outra perna gravou.
    const currency = moedaConhecida(acerto.currency)
      ? String(acerto.currency).trim().toUpperCase()
      : MOEDA_PADRAO;

    const { perna, problema } = pernaDoAcerto({
      direcao: permissao.direcao,
      conta,
      amount: Number(acerto.amount),
      currency,
      exchange_rate: Number(acerto.exchange_rate ?? 1) || 1,
      settledOn: String(acerto.settled_on),
      settlementId: acerto.id,
      nomeDaContraparte: contraparte?.full_name,
      nomeDoGrupo: grupo?.name,
    });

    if (problema) {
      return NextResponse.json(
        { error: mensagemDaContaDoAcerto(problema, currency) },
        { status: 400 }
      );
    }

    const { data: lancamento, error: erroDoLancamento } = await supabase
      .from("financial_transactions")
      .insert({
        ...perna,
        user_id: user.id,
        service_id: servico.id,
        category_id: categoria.id,
      })
      .select("id, amount, transaction_type, transaction_date, account_id")
      .single();

    if (erroDoLancamento || !lancamento) {
      // Nada a desfazer aqui, e e a diferenca em relacao ao POST da quitacao:
      // esta rota nao gravou nenhuma outra linha antes. O estado continua
      // exatamente o de antes do pedido -- "acerto registrado, ainda nao
      // lancado na sua conta" --, e a pessoa pode tentar de novo.
      //
      // 42501 = a policy barrou, e nesse caso o `user_id` acima nao e o da
      // sessao. Vale uma frase propria: "tente de novo" seria falso.
      const policy = erroDoLancamento?.code === "42501";
      console.error("Erro ao lancar a perna da contraparte:", erroDoLancamento);
      return NextResponse.json(
        {
          error: policy
            ? "O banco recusou lançar na conta escolhida. Escolha uma conta sua."
            : "Não foi possível lançar o acerto na sua conta. Nada foi alterado — tente novamente.",
        },
        { status: policy ? 403 : 500 }
      );
    }

    return NextResponse.json({
      success: true,
      // A tela diz em QUAL conta o dinheiro mexeu, pela RESPOSTA e nao pelo
      // estado dela: "Lancado" sozinho nao distingue o lancamento que caiu do
      // que nao caiu.
      lancamento: {
        ...lancamento,
        amount: Number(lancamento.amount),
        account_name: conta.name,
      },
    });
  } catch (error) {
    console.error("Erro em POST da perna do acerto:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Remove a perna de quem chama, SEM apagar a quitacao.
 *
 * O simetrico da confirmacao, e o unico desfazer disponivel a quem nao
 * registrou: a quitacao nao e dela para apagar (policy da 007). Quem registrou
 * cai em `MENSAGEM_USE_DESFAZER` -- ver o porque em
 * `lib/perna-da-contraparte.ts`.
 *
 * SE PROVA PELO `current_balance` VOLTANDO AO VALOR DE ANTES, nao pela linha
 * sumir da lista: o branch de DELETE do `update_account_balance`
 * (`001_baseline.sql:840`) e que reverte o saldo, e e ele que esta sendo
 * exercitado aqui.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { groupId: string; id: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { groupId, id } = params;

    const lido = await acertoEPerna(supabase, groupId, id, user.id);
    if ("erro" in lido) {
      return NextResponse.json({ error: lido.erro }, { status: lido.status });
    }
    const { acerto, perna } = lido;

    const recusa = recusaDeRemoverSoAMinhaPerna({
      acerto,
      userId: user.id,
      temPerna: Boolean(perna),
    });

    if (recusa) {
      return NextResponse.json({ error: recusa }, { status: 403 });
    }

    // Pelo ID da perna lida, e nao pela chave em `notes`: a leitura acima ja
    // confirmou de quem ela e e que ela existe, e apagar por `notes` repetiria
    // a decisao num filtro que tambem aceitaria uma linha que apareceu entre as
    // duas chamadas.
    const { data: apagados, error } = await supabase
      .from("financial_transactions")
      .delete()
      .eq("id", perna!.id)
      .eq("user_id", user.id)
      .select("id");

    if (error) {
      console.error("Erro ao remover a perna do acerto:", error);
      return NextResponse.json(
        {
          error:
            "Não foi possível remover o lançamento deste acerto. Nada foi alterado — tente novamente.",
        },
        { status: 500 }
      );
    }

    // A RLS nao devolve erro quando a linha nao passa na policy -- ela some do
    // resultado, e o DELETE "funciona" apagando zero linhas. Sem esta checagem
    // a tela diria "lancamento removido" com o dinheiro ainda fora da conta.
    if (!apagados || apagados.length === 0) {
      return NextResponse.json(
        {
          error:
            "Não foi possível remover o lançamento deste acerto. Nada foi alterado — tente novamente.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      // A quitacao continua de pe, e dizer isso evita a leitura errada mais
      // provavel: "removi o lancamento" lido como "desfiz o acerto".
      settlement_id: acerto.id,
    });
  } catch (error) {
    console.error("Erro em DELETE da perna do acerto:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
