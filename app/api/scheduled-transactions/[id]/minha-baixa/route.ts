// POST   /api/scheduled-transactions/{id}/minha-baixa   "eu paguei a minha parte"
// DELETE /api/scheduled-transactions/{id}/minha-baixa   desfaz o aviso
//
// ---------------------------------------------------------------------------
// O GESTO DO MEMBRO -- HMO-411
// ---------------------------------------------------------------------------
// `scheduled_transactions` tem UMA coluna `status` e ela e do DONO. A rota de
// baixa (`../pay`) filtra `.eq("user_id", user.id)` e por isso responde
// **404 "Conta prevista nao encontrada"** para quem nao e o dono: a Lais ve a
// conta do grupo Casa na agenda dela, aperta o botao de pagar e leva 404. Esta
// rota e o gesto que faltava -- e ela escreve em OUTRA tabela
// (`group_bill_payments`, migration 055), nunca na conta prevista do Helio.
//
// ---------------------------------------------------------------------------
// DECISAO D1: SO O STATUS. NENHUM LANCAMENTO. (aprovada no plano da HMO-407)
// ---------------------------------------------------------------------------
// A tentacao obvia e gravar um lancamento no "paguei" da Lais, para o dinheiro
// aparecer no realizado dela. **Isso contaria a parte dela duas vezes.**
//
// Quando o Helio da baixa na conta do grupo, a trigger
// `auto_create_group_transaction` rateia a despesa e a parte da Lais JA fica
// realizada nos relatorios dela, via `group_share_entries`. Um segundo
// lancamento aqui seria a MESMA parte, pela segunda vez, com outra origem --
// e o sintoma nao seria erro nenhum, seria a Lais vendo o dobro do que gastou.
//
// E o dinheiro que ela de fato passa para o Helio tambem ja tem lugar: e o
// ACERTO do grupo, que existe desde sempre e que a HMO-404 arrumou (o acerto
// registrado virou TETO do credito a receber). Esta rota nao tem nada a dizer
// sobre ele.
//
// Entao: aqui se escreve UM estado, de UMA pessoa, em UMA tabela que nao tem
// coluna de dinheiro nenhuma. Se um dia alguem acrescentar um `insert` em
// `financial_transactions` a este arquivo, o defeito que ele cria e o de
// cima -- e a suite `test-minha-baixa.mjs` tem um caso que falha por isso.
//
// ---------------------------------------------------------------------------
// O `upsert` E A CONSTRAINT -- E POR QUE NAO DA PARA MIRAR NO INDICE
// ---------------------------------------------------------------------------
// `onConflict` tem de nomear o arbitro, e o arbitro e a UNIQUE
// `group_bill_payments_unico (scheduled_transaction_id, user_id)` da secao 2
// da 055. Ela e uma constraint INTEIRA, sem `WHERE`: um indice PARCIAL nao
// arbitra `ON CONFLICT`, e se o arbitro nao casar o insert vira erro de chave
// duplicada em vez de atualizacao.
//
// ---------------------------------------------------------------------------
// POR QUE EXISTE UM SELECT ANTES DO UPSERT, E ELE NAO E PARANOIA
// ---------------------------------------------------------------------------
// A policy de UPDATE da 055 tem duas metades OR-adas, e a do membro exige
// `status = 'pending'` no `USING` -- isto e, na linha ANTIGA. Num
// `INSERT ... ON CONFLICT DO UPDATE` o Postgres confere o `USING` da policy de
// UPDATE contra a linha que ja existe e **aborta a instrucao inteira** quando
// ela recusa. Entao um segundo "avisar que paguei" sobre uma linha que ja esta
// `reported` nao e idempotente: e um 500 com texto de RLS na cara da pessoa.
//
// O SELECT separa os tres casos e responde cada um com a frase certa. Ele nao
// e uma checagem de seguranca -- quem recusa continua sendo a RLS, e o
// paragrafo seguinte e sobre isso.
//
// ---------------------------------------------------------------------------
// QUEM RECUSA E A RLS, E O QUE ESTA ROTA CONFERE E OUTRA COISA
// ---------------------------------------------------------------------------
// A policy de INSERT da 055 ja exige, sozinha: linha minha, status em
// (`pending`,`reported`), conta prevista de GRUPO e `is_group_member` ativo.
// Ela e que impede alguem de pendurar "avisei que paguei" na conta de um
// estranho, e nada que se escreva aqui afrouxa isso.
//
// As conferencias deste arquivo sao de MENSAGEM, nao de permissao: sem elas o
// erro que chega a tela e o texto cru do PostgREST, e a pessoa nao descobre
// que o que ela queria era o botao de pagar logo ao lado. A unica excecao e a
// conta que e MINHA -- aquela nao e recusada pela RLS (eu sou membro do grupo
// e dono da conta), e mandar o dono para ca criaria uma linha de pagamento
// que a view 055 nunca le: para linha propria `my_status` sai de
// `s.status::text` e ignora `group_bill_payments`. Seria um estado gravado sem
// leitor, que nesta base e o mesmo que nao existir.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/** O arbitro do `ON CONFLICT` -- a UNIQUE da secao 2 da migration 055. */
const CONFLITO_DA_PARTE = "scheduled_transaction_id,user_id";

/**
 * A frase de quem tentou avisar numa conta que e dele mesmo.
 *
 * Exportada porque a suite a confere: uma mensagem que nao diz PARA ONDE ir
 * deixa a pessoa no mesmo lugar em que o 404 da `../pay` a deixava.
 */
export const RECUSA_DA_CONTA_PROPRIA =
  "Esta conta prevista é sua: use o botão de dar baixa, que registra o pagamento de verdade.";

/** A frase de quem ja avisou. Nao e erro -- e estado. */
export const JA_AVISADO = "Você já avisou que pagou a sua parte.";

/** A frase de quem foi confirmado pelo dono e tentou mexer. */
export const JA_CONFIRMADO =
  "Quem criou a conta já confirmou a sua parte. Fale com essa pessoa para desfazer.";

export const AVISADO_AGORA = "Avisamos quem criou a conta.";

export const AVISO_DESFEITO = "Desfeito: sua parte voltou para pendente.";

/** O que o SELECT de contexto precisa saber da conta prevista. */
type ContaDoGrupo = {
  id: string;
  user_id: string;
  group_id: string | null;
};

/**
 * Le a conta prevista e a MINHA linha de pagamento, e classifica o caso.
 *
 * A leitura e da TABELA e nao da view: a view resolveria `my_status` por mim,
 * mas e `group_bill_payments.status` cru que decide se o `upsert` pode rodar
 * -- `my_status` de uma conta de grupo ja vem com o COALESCE para `'pending'`
 * aplicado, e com ele "nao tem linha" e "tem linha em pending" viram o mesmo
 * valor. Os dois precisam de caminhos de escrita diferentes.
 */
async function situacao(
  supabase: ReturnType<typeof createClient>,
  id: string,
  meuId: string
) {
  const { data: conta, error: erroConta } = await supabase
    .from("scheduled_transactions")
    .select("id, user_id, group_id")
    .eq("id", id)
    .maybeSingle();

  if (erroConta) return { erro: erroConta } as const;

  // A RLS do 005 ja entrega a conta de grupo de que eu sou membro. Nao achar
  // aqui quer dizer "nao existe ou nao e sua" -- a mesma frase da `../pay`,
  // de proposito: distinguir as duas diria a um estranho que o id existe.
  if (!conta) return { naoAchou: true } as const;

  const { data: minhaLinha, error: erroLinha } = await supabase
    .from("group_bill_payments")
    .select("id, status")
    .eq("scheduled_transaction_id", id)
    .eq("user_id", meuId)
    .maybeSingle();

  if (erroLinha) return { erro: erroLinha } as const;

  return {
    conta: conta as ContaDoGrupo,
    minhaLinha: (minhaLinha as { id: string; status: string } | null) ?? null,
  } as const;
}

export async function POST(
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

    const atual = await situacao(supabase, params.id, user.id);

    if ("erro" in atual) {
      console.error("Erro ao ler a conta prevista do grupo:", atual.erro);
      return NextResponse.json(
        { error: "Não foi possível registrar o aviso" },
        { status: 500 }
      );
    }

    if ("naoAchou" in atual) {
      return NextResponse.json(
        { error: "Conta prevista não encontrada" },
        { status: 404 }
      );
    }

    const { conta, minhaLinha } = atual;

    // A CONTA PROPRIA SAI AQUI -- ver o cabecalho. A RLS nao recusaria este
    // caso, e e justamente por isso que ele precisa de uma recusa escrita.
    if (conta.user_id === user.id) {
      return NextResponse.json(
        { error: RECUSA_DA_CONTA_PROPRIA },
        { status: 409 }
      );
    }

    // Conta que nao e de grupo e de outra pessoa nao chegaria aqui pela RLS do
    // 005. A conferencia fica pela mensagem, e porque a policy de INSERT da
    // 055 responderia com texto cru de PostgREST.
    if (!conta.group_id) {
      return NextResponse.json(
        { error: "Conta prevista não encontrada" },
        { status: 404 }
      );
    }

    if (minhaLinha?.status === "paid") {
      return NextResponse.json({ error: JA_CONFIRMADO }, { status: 409 });
    }

    // JA AVISOU: 200 e nao erro. O duplo toque e o caso comum do celular, e o
    // estado que a pessoa queria ja e o que esta gravado. Nao passa pelo
    // `upsert` de proposito -- ver o cabecalho: o `USING` da policy de UPDATE
    // exige `pending` na linha antiga e abortaria a instrucao inteira.
    if (minhaLinha?.status === "reported") {
      return NextResponse.json({ success: true, message: JA_AVISADO });
    }

    // O CARIMBO E OBRIGATORIO, e nao e enfeite: o CHECK
    // `group_bill_payments_carimbos_check` recusa `reported` sem
    // `reported_at`, porque a tela do grupo escreve "avisou que pagou" COM a
    // data e uma linha sem carimbo viraria "avisou em --/--/----".
    const agora = new Date().toISOString();

    const { error: erroUpsert } = await supabase
      .from("group_bill_payments")
      .upsert(
        {
          scheduled_transaction_id: params.id,
          user_id: user.id,
          status: "reported",
          reported_at: agora,
          // `confirmed_at` NAO vai aqui, e a omissao e deliberada: so o dono
          // escreve essa coluna, e a trigger `group_bill_payments_trava_do_membro`
          // recusaria o UPDATE que a mexesse pelo lado do membro.
        },
        { onConflict: CONFLITO_DA_PARTE }
      );

    if (erroUpsert) {
      console.error("Erro ao registrar o aviso de pagamento:", erroUpsert);
      return NextResponse.json(
        { error: "Não foi possível registrar o aviso" },
        { status: 500 }
      );
    }

    // NENHUMA OUTRA ESCRITA. Ver a decisao D1 no cabecalho -- um `insert` em
    // `financial_transactions` aqui contaria a parte desta pessoa duas vezes.
    return NextResponse.json({ success: true, message: AVISADO_AGORA });
  } catch (error) {
    console.error("Erro em minha-baixa:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

/**
 * DESFAZER o aviso.
 *
 * ELE EXISTE POR CAUSA DO COALESCE DA VIEW, e a 055 o justifica na propria
 * policy de DELETE: linha ausente E `pending`, entao apagar a linha e voltar
 * ao estado inicial. Sem esta rota a policy nao tem chamador -- e quem tocou
 * "avisar que paguei" por engano fica em `reported` para sempre, porque o
 * `USING` da policy de UPDATE exige `pending` e nao ha volta por ali.
 *
 * Depois de o dono confirmar (`paid`) quem manda e ele: a propria policy de
 * DELETE tem `status <> 'paid'`.
 */
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

    const atual = await situacao(supabase, params.id, user.id);

    if ("erro" in atual) {
      console.error("Erro ao ler a conta prevista do grupo:", atual.erro);
      return NextResponse.json(
        { error: "Não foi possível desfazer o aviso" },
        { status: 500 }
      );
    }

    if ("naoAchou" in atual) {
      return NextResponse.json(
        { error: "Conta prevista não encontrada" },
        { status: 404 }
      );
    }

    if (atual.minhaLinha?.status === "paid") {
      return NextResponse.json({ error: JA_CONFIRMADO }, { status: 409 });
    }

    // SEM LINHA JA E O ESTADO PEDIDO. 200, e nao 404: "desfazer o que nao
    // existe" e exatamente o resultado que a pessoa queria, e um erro aqui
    // transformaria o duplo toque num alarme.
    if (!atual.minhaLinha) {
      return NextResponse.json({ success: true, message: AVISO_DESFEITO });
    }

    // O `.eq("user_id")` NAO E REDUNDANTE COM A RLS, e a direcao do erro e o
    // motivo: DELETE recusado pela RLS volta 200 sem apagar nada (o filtro da
    // policy some a linha em vez de recusar a instrucao). Com o filtro
    // explicito o alvo e UMA linha nomeada, e um id trocado nao vira um apagao
    // silencioso de linha alheia.
    const { error: erroDelete } = await supabase
      .from("group_bill_payments")
      .delete()
      .eq("scheduled_transaction_id", params.id)
      .eq("user_id", user.id);

    if (erroDelete) {
      console.error("Erro ao desfazer o aviso de pagamento:", erroDelete);
      return NextResponse.json(
        { error: "Não foi possível desfazer o aviso" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: AVISO_DESFEITO });
  } catch (error) {
    console.error("Erro em minha-baixa (DELETE):", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
