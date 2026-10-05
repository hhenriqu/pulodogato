// POST   /api/scheduled-transactions/{id}/elo-de-fatura   "esta previsao e a fatura do Nubank de marco"
// DELETE /api/scheduled-transactions/{id}/elo-de-fatura   desfaz o elo
//
// HMO-305 -- o caminho 4 do plano da HMO-302 (§3.4), e a UNICA escrita do
// mecanismo (b): a mesma divida contada duas vezes.
//
// O QUE ESTA ROTA FAZ, EM UMA FRASE
// ---------------------------------
// Grava em `scheduled_transactions.notes` a chave canonica
// `fatura:AAAA-MM-01:<uuid-do-cartao>` -- a MESMA que o
// `POST /api/card-invoices/close` grava desde a HMO-227. Depois disso,
// `sintetizarFaturasAbertas` (lib/agenda-do-cartao.ts) reconhece a fatura aberta
// daquele mes como "ja esta na agenda" e para de sintetiza-la. A divida passa a
// aparecer UMA vez, na linha que a pessoa digitou.
//
// NENHUMA DE-DUPLICACAO NOVA FOI ESCRITA. O mecanismo e o `chavesPersistidas`
// que ja existe e ja tem suite (`npm run test:fatura-prevista`); esta rota so
// poe a chave onde ele ja olha. Era esse o criterio da decisao aprovada: de
// `R$ 1.600,00` para `R$ 800,00` sem uma segunda implementacao da divisao entre
// fatura e previsao -- duas implementacoes divergiriam em silencio, e o sintoma
// seria um numero errado sem erro nenhum.
//
// POR QUE A ESCRITA E INICIADA PELA PESSOA, E NAO ADIVINHADA
// ----------------------------------------------------------
// Os dois caminhos automaticos foram avaliados e RECUSADOS no plano, os dois por
// errarem para BAIXO -- a direcao cara, porque esconde uma conta real:
//
//   * de-duplicar por heuristica (mesma conta, mesmo mes, valor parecido)
//     esconde uma divida verdadeira de quem tem duas parecidas no mes;
//   * suprimir a fatura sintetizada quando existe previsao digitada e
//     indetectavel de proposito: a previsao e lancada na CONTA CORRENTE, nao no
//     cartao (e como as pessoas anotam), entao nao ha elo nenhum para achar.
//
// O app rotula a suspeita (`suspeitasDeFaturaRepetida`, lib/elo-da-fatura.ts) e
// para ai. Quem decide e quem sabe.
//
// AS SEIS RECUSAS DO POST, E O QUE CADA UMA EVITA
// -----------------------------------------------
// Todas erram na direcao de NAO gravar, porque o elo errado esconde dinheiro:
//
//   1. `mes` fora de 'AAAA-MM-01'       -> chave que nenhuma fatura casa: o elo
//                                          nao faria nada, com a tela dizendo
//                                          "pronto" (o pior modo de falha
//                                          possivel aqui);
//   2. conta que nao e cartao de credito -> `card_invoice_lines` filtra
//                                          `account_type = 'credit_card'`;
//                                          chave para conta corrente e inerte;
//   3. previsao de GRUPO                 -> o valor dela ja e rateado entre
//                                          membros, e nao e a fatura do meu
//                                          cartao;
//   4. previsao JA PAGA                  -> ela esta amarrada a uma transacao
//                                          real; esconde-la da agenda deixaria
//                                          os dois lados divergentes;
//   5. previsao lancada NO PROPRIO CARTAO -> ela nem aparece na agenda
//                                          (`agendaSemCompraNoCartao` a tira),
//                                          entao o elo seria invisivel;
//   6. chave JA TOMADA por outra linha    -> duas linhas com a mesma chave nao
//                                          de-duplicam uma a outra: nao ha
//                                          fatura sintetizada para suprimir, e o
//                                          mes continuaria dobrado. E tambem o
//                                          caso da fatura FECHADA, que e uma
//                                          linha real com esta chave.
//
// E A RECUSA DO DELETE: a linha cujo `account_id` E o cartao da chave e a fatura
// FECHADA que o `close` criou -- nao uma previsao que alguem ligou. Apagar a
// chave dela quebraria a idempotencia do fechamento (clicar "fechar" de novo
// criaria uma SEGUNDA conta a pagar do mesmo mes). O caminho de desfazer aquilo
// e reabrir a fatura, na tela do cartao.
//
// POR QUE `notes` E NAO UMA COLUNA NOVA
// -------------------------------------
// Porque uma coluna nova e uma migration, e migration vai para `main` sozinha
// neste repositorio -- o elo ficaria esperando uma colagem no SQL Editor para
// existir. O preco esta no cabecalho de lib/elo-da-fatura.ts e e dito na TELA
// antes do clique: a anotacao escrita a mao em `notes` e SUBSTITUIDA, e desfazer
// nao a traz de volta. A `description` nao e tocada.

import { createClient } from "@/utils/supabase/server";
import { NextResponse, type NextRequest } from "next/server";
import { notesDoElo, NOTES_SEM_ELO } from "@/lib/elo-da-fatura";
import { faturaDaChave } from "@/lib/chave-da-fatura";

/** 'AAAA-MM-01' -- o primeiro dia do mes, que e a forma do `invoice_month`. */
const RE_MES_DA_FATURA = /^\d{4}-\d{2}-01$/;

/**
 * A previsao que a chave vai (ou nao) para -- lida UMA vez, usada pelos dois
 * verbos.
 *
 * `eq("user_id", ...)` junto da RLS, e nao so a RLS: a policy do 005 me entrega
 * tambem as linhas de GRUPO dos outros membros, e um `UPDATE` que a RLS recusa
 * volta 200 sem alterar nada -- o app diria "pronto" e o numero nao mudaria.
 * Com o filtro explicito, a resposta e 404 e a tela pode dizer a verdade.
 */
async function lerPrevisao(
  supabase: ReturnType<typeof createClient>,
  id: string,
  userId: string
) {
  return supabase
    .from("scheduled_transactions")
    .select("id, user_id, account_id, group_id, status, notes, description")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
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

    const body = await request.json().catch(() => null);
    const accountId = typeof body?.account_id === "string" ? body.account_id : "";
    const mes = typeof body?.mes === "string" ? body.mes : "";

    if (!accountId || !RE_MES_DA_FATURA.test(mes)) {
      return NextResponse.json(
        {
          error:
            "Informe o cartão (account_id) e o mês da fatura no formato AAAA-MM-01.",
        },
        { status: 400 }
      );
    }

    // (2) O CARTAO TEM DE SER UM CARTAO. A view `card_invoice_lines` filtra
    // `account_type = 'credit_card'`, entao uma chave apontando para a conta
    // corrente nunca casaria com fatura nenhuma: o elo existiria no banco e nao
    // faria nada. O nome volta para a mensagem de sucesso.
    const { data: cartao } = await supabase
      .from("financial_accounts")
      .select("id, name, account_type")
      .eq("id", accountId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!cartao) {
      return NextResponse.json({ error: "Cartão não encontrado" }, { status: 404 });
    }

    if (cartao.account_type !== "credit_card") {
      return NextResponse.json(
        {
          error:
            "O elo só existe para cartão de crédito: é a fatura dele que o app soma duas vezes.",
        },
        { status: 400 }
      );
    }

    const { data: previsao, error: erroDaPrevisao } = await lerPrevisao(
      supabase,
      params.id,
      user.id
    );

    if (erroDaPrevisao) {
      console.error("Erro ao ler a previsão para o elo da fatura:", erroDaPrevisao);
      return NextResponse.json(
        { error: "Não foi possível ler a conta prevista. Tente de novo." },
        { status: 500 }
      );
    }

    if (!previsao) {
      return NextResponse.json(
        { error: "Conta prevista não encontrada" },
        { status: 404 }
      );
    }

    // (3) Despesa de grupo tem rateio proprio: o valor que a tela mostra ja e
    // uma fracao, e chamar aquilo de fatura do meu cartao seria o rotulo errado
    // sobre o numero errado.
    if (previsao.group_id != null) {
      return NextResponse.json(
        {
          error:
            "Esta é uma despesa de grupo, dividida entre os membros. Ela não é a fatura do seu cartão.",
        },
        { status: 409 }
      );
    }

    // (4) A conta paga esta amarrada a uma transacao real. Tira-la da agenda
    // pelo elo deixaria o previsto e o realizado contando coisas diferentes.
    if (previsao.status === "paid") {
      return NextResponse.json(
        {
          error:
            "Esta conta já foi paga. O elo com a fatura só vale para conta ainda a pagar.",
        },
        { status: 409 }
      );
    }

    // (5) Previsao lancada no PROPRIO cartao nao chega a aparecer na agenda --
    // `agendaSemCompraNoCartao` a tira, porque ela esta dentro da fatura. O elo
    // seria gravado e invisivel.
    if (previsao.account_id === accountId) {
      return NextResponse.json(
        {
          error:
            "Esta linha já está lançada no cartão: ela é uma compra dentro da fatura, não a fatura.",
        },
        { status: 409 }
      );
    }

    const chave = notesDoElo(mes, accountId);

    // (6) A CHAVE JA TOMADA. Duas linhas com a mesma chave nao se de-duplicam:
    // `chavesPersistidas` so suprime a fatura SINTETIZADA, e ela ja estaria
    // suprimida pela primeira. O mes continuaria dobrado -- e o clique teria
    // dito "pronto".
    //
    // Sem `.neq("id", params.id)`: ligar duas vezes a MESMA linha e idempotente
    // de verdade (a chave ja e a dela), e e isso que o `ja_estava` abaixo
    // responde.
    const { data: comAChave, error: erroDaChave } = await supabase
      .from("scheduled_transactions")
      .select("id")
      .eq("user_id", user.id)
      .eq("notes", chave);

    if (erroDaChave) {
      console.error("Erro ao conferir se a fatura já tem elo:", erroDaChave);
      return NextResponse.json(
        { error: "Não foi possível conferir a fatura. Tente de novo." },
        { status: 500 }
      );
    }

    const outras = (comAChave ?? []).filter((l) => l.id !== params.id);

    if (outras.length > 0) {
      return NextResponse.json(
        {
          error:
            "Esta fatura já está na agenda em outra linha. Confira a lista antes de ligar o elo.",
        },
        { status: 409 }
      );
    }

    if (previsao.notes === chave) {
      // Idempotente, e com a resposta DIZENDO que nada mudou: um 200 mudo faria
      // a tela mostrar o cartao de sucesso duas vezes para o mesmo clique.
      return NextResponse.json({
        elo: { account_id: accountId, mes, cartao: cartao.name },
        ja_estava: true,
      });
    }

    // A ESCRITA, E A CONFERENCIA DELA. `.select()` depois do `update` nao e
    // enfeite: `UPDATE` filtrado que a RLS recusa volta SUCESSO com zero linhas
    // neste app, e sem conferir a rota responderia 200 sobre uma escrita que nao
    // aconteceu.
    const { data: atualizadas, error: erroDoUpdate } = await supabase
      .from("scheduled_transactions")
      .update({ notes: chave })
      .eq("id", params.id)
      .eq("user_id", user.id)
      .select("id, notes");

    if (erroDoUpdate) {
      console.error("Erro ao gravar o elo da fatura:", erroDoUpdate);
      return NextResponse.json(
        { error: "Não foi possível ligar a previsão à fatura" },
        { status: 500 }
      );
    }

    if (!atualizadas || atualizadas.length === 0) {
      return NextResponse.json(
        { error: "Conta prevista não encontrada" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      elo: { account_id: accountId, mes, cartao: cartao.name },
      // O que foi substituido, de volta na resposta: a tela avisou ANTES, e este
      // campo e o que permite a ela repetir o aviso no cartao de sucesso.
      notes_anterior: previsao.notes ?? null,
      ja_estava: false,
    });
  } catch (error) {
    console.error("Erro no elo da fatura:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
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

    const { data: previsao, error: erroDaPrevisao } = await lerPrevisao(
      supabase,
      params.id,
      user.id
    );

    if (erroDaPrevisao) {
      console.error("Erro ao ler a previsão para desfazer o elo:", erroDaPrevisao);
      return NextResponse.json(
        { error: "Não foi possível ler a conta prevista. Tente de novo." },
        { status: 500 }
      );
    }

    if (!previsao) {
      return NextResponse.json(
        { error: "Conta prevista não encontrada" },
        { status: 404 }
      );
    }

    const elo = faturaDaChave(previsao.notes);

    if (!elo) {
      // Nada para desfazer, e dizer isso e melhor que um 200 mudo: a tela
      // mostraria "desfeito" sobre uma linha que nunca teve elo.
      return NextResponse.json(
        { error: "Esta previsão não está ligada a nenhuma fatura." },
        { status: 409 }
      );
    }

    // A FATURA FECHADA NAO SE DESFAZ AQUI. Ela e uma linha que o
    // `POST /api/card-invoices/close` criou, e a chave dela e o que torna o
    // fechamento idempotente: sem ela, clicar "fechar fatura" de novo criaria
    // uma SEGUNDA conta a pagar do mesmo mes. O criterio e o `account_id` ser o
    // proprio cartao da chave -- o `close` grava o cartao de proposito ("esta
    // conta a pagar PERTENCE ao cartao"), e uma previsao digitada a mao esta na
    // conta de onde o dinheiro sai.
    if (previsao.account_id === elo.accountId) {
      return NextResponse.json(
        {
          error:
            "Esta linha é a fatura fechada do cartão, e não uma previsão ligada a ela. Para desfazer, reabra a fatura na tela do cartão.",
        },
        { status: 409 }
      );
    }

    const { data: atualizadas, error: erroDoUpdate } = await supabase
      .from("scheduled_transactions")
      .update({ notes: NOTES_SEM_ELO })
      .eq("id", params.id)
      .eq("user_id", user.id)
      .select("id, notes");

    if (erroDoUpdate) {
      console.error("Erro ao desfazer o elo da fatura:", erroDoUpdate);
      return NextResponse.json(
        { error: "Não foi possível desfazer o elo" },
        { status: 500 }
      );
    }

    if (!atualizadas || atualizadas.length === 0) {
      return NextResponse.json(
        { error: "Conta prevista não encontrada" },
        { status: 404 }
      );
    }

    // O elo DESFEITO volta na resposta: e com ele que a tela diz qual fatura
    // voltou a aparecer na lista.
    return NextResponse.json({ desfeito: { account_id: elo.accountId, mes: elo.mes } });
  } catch (error) {
    console.error("Erro ao desfazer o elo da fatura:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
