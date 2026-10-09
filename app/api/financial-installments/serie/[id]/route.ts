// PATCH  /api/financial-installments/serie/{id}  altera parcelas de uma compra
// DELETE /api/financial-installments/serie/{id}  apaga parcelas de uma compra
//
// `{id}` e o id de UMA parcela (uma linha de `financial_transactions`), a
// ancora. O alcance vem no corpo e decide quais linhas da serie entram.
//
// POR QUE ESTA ROTA EXISTE (HMO-228)
// ----------------------------------
// O parcelamento da HMO-211 grava N linhas em `financial_transactions`,
// amarradas por `installment_parent_id`, com `installment_number` /
// `installment_total` (035). O unico caminho de edicao/exclusao dessas linhas
// era `PATCH|DELETE /api/personal-finance/transactions/{id}`, que **nao sabe o
// que e uma serie**: apagar a parcela 3 de 10 apaga uma linha e deixa nove, e a
// fatura de cada mes restante continua fechando num valor plausivel e errado.
//
// Nenhum erro aparece. A compra de R$ 3.000 passa a somar R$ 2.700 espalhados
// em nove meses, e a unica forma de descobrir e reconferir dez faturas a mao.
//
// POR QUE NAO E A ROTA DA RECORRENCIA REUSADA
// -------------------------------------------
// Tabelas diferentes, e "todas" quer dizer coisas diferentes nas duas: no gasto
// fixo "todas" muda quanto se paga por mes (a serie nao tem fim); aqui muda o
// TOTAL DA COMPRA, que e um numero que existe e tem de fechar. A regra fica em
// `lib/parcelas-edicao.ts`, pura e com mutantes; esta rota so lê e grava.
//
// E ELA TAMBEM MOVE A SERIE (HMO-357)
// -----------------------------------
// "Quando movo uma parcela, as demais devem mover junto." Mover era uma edicao
// de UMA linha -- o formulario grava `financial_transactions` direto pelo
// supabase-js --, entao trocar a data (ou a fatura da 041) de "parcela 3 de 10"
// movia a 3 e deixava as outras nove onde estavam: duas parcelas na mesma
// fatura, um mes vazio no fim, e as duas faturas fechando num valor plausivel.
//
// O corpo aceita `invoice_month` ('AAAA-MM', a fatura escolhida) OU
// `transaction_date` ('AAAA-MM-DD', a data da compra) -- as duas formas pelas
// quais a tela move uma parcela hoje. O deslocamento e medido em MESES DE
// FATURA e aplicado a cada parcela alcancada a partir da fatura dela; a regra
// esta em `novasFaturasDasParcelas`, com o motivo de nao ser em dias.
//
// O QUE A ROTA FAZ E A REGRA NAO PODE FAZER
// -----------------------------------------
// Descobrir quais faturas do cartao JA FORAM PAGAS. `POST
// /api/card-invoices/close` grava a fatura como uma `scheduled_transactions`
// com `notes = chaveFatura(mes, cartao)`; dar baixa nela a deixa `paid`. E essa
// a barreira do "mes ja conferido" desta serie -- a unica que existe aqui,
// porque uma linha de `financial_transactions` nao tem status proprio: ela E o
// dinheiro gravado.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { faturaDaChave } from "@/lib/card-invoice";
import {
  ehAlcanceDeParcelaValido,
  mesDaFaturaPedida,
  novasFaturasDasParcelas,
  novosValoresDasParcelas,
  planejarAlteracaoDeParcelas,
  totalDaCompra,
  type AlcanceDaParcela,
  type ParcelaParaAlcance,
  type RecusaDeMovimento,
} from "@/lib/parcelas-edicao";
import type { BaseDoValorParcelado } from "@/lib/lancamento";

interface LinhaDaSerie extends ParcelaParaAlcance {
  account_id: string | null;
  description: string;
  installment_total: number | null;
}

/**
 * A serie inteira a que esta parcela pertence, e os meses de fatura ja pagos do
 * cartao dela.
 *
 * As duas leituras ficam juntas porque uma resposta sem a outra nao serve para
 * decidir nada -- e porque a segunda depende do `account_id` que sai da
 * primeira.
 */
async function lerSerie(
  supabase: ReturnType<typeof createClient>,
  parcelaId: string,
  userId: string
): Promise<
  | { ok: false; status: number; erro: string }
  | {
      ok: true;
      ancora: LinhaDaSerie;
      serie: LinhaDaSerie[];
      mesesPagos: string[];
    }
> {
  // `card_invoice_lines` e nao `financial_transactions`: e a view que resolve o
  // `invoice_month` de cada linha pelo `transaction_date` e pelo `closing_day`
  // do cartao (006). Recalcular isso aqui seria uma SEGUNDA fonte de verdade
  // para o mes da fatura, e ela divergiria da tela na primeira troca de dia de
  // fechamento.
  //
  // A view tem `security_invoker`, entao a RLS das tabelas base vale. Mesmo
  // assim o `.eq("user_id")` fica: ver o padrao de agregado pessoal inflado por
  // policy com OR.
  const { data: ancoraNaView, error: erroDaAncora } = await supabase
    .from("card_invoice_lines")
    .select(
      "transaction_id, user_id, account_id, description, amount, invoice_month, installment_number, installment_total"
    )
    .eq("transaction_id", parcelaId)
    .eq("user_id", userId)
    .maybeSingle();

  if (erroDaAncora) {
    console.error("Erro ao ler a parcela:", erroDaAncora);
    return { ok: false, status: 500, erro: "Não foi possível ler esta parcela" };
  }

  if (!ancoraNaView) {
    // Pode ser uma linha que existe e NAO e de cartao (a view filtra
    // `account_type = 'credit_card'`). A mensagem nao afirma que a linha nao
    // existe: dizer "não encontrada" sobre um lancamento que a pessoa esta
    // vendo na tela e o jeito de fazer ela desconfiar da tela, nao do pedido.
    return {
      ok: false,
      status: 404,
      erro: "Esta parcela não foi encontrada em nenhuma fatura de cartão.",
    };
  }

  // `installment_parent_id` nao esta na view (ela nasceu antes da amarra), e e
  // por ele que a serie e encontrada. Duas leituras, entao.
  const { data: amarra } = await supabase
    .from("financial_transactions")
    .select("installment_parent_id")
    .eq("id", parcelaId)
    .eq("user_id", userId)
    .maybeSingle();

  const parentId = amarra?.installment_parent_id ?? null;

  if (!parentId || !ancoraNaView.installment_number) {
    return {
      ok: false,
      status: 400,
      erro:
        "Este lançamento não faz parte de uma compra parcelada. Edite ou apague por Lançamentos.",
    };
  }

  const { data: linhas, error: erroDaSerie } = await supabase
    .from("financial_transactions")
    .select("id, installment_number, installment_total, account_id, description")
    .eq("installment_parent_id", parentId)
    .eq("user_id", userId);

  if (erroDaSerie || !linhas) {
    console.error("Erro ao ler a série:", erroDaSerie);
    // Alterar com a lista pela metade mexeria em algumas parcelas e nao em
    // outras, sem nada na tela indicando quais. Melhor nao mexer em nenhuma.
    return {
      ok: false,
      status: 500,
      erro: "Não foi possível ler as parcelas desta compra. Tente de novo.",
    };
  }

  // O `invoice_month` e o `amount` de cada parcela vem da view, pelos mesmos
  // motivos da ancora.
  const { data: naView, error: erroDaView } = await supabase
    .from("card_invoice_lines")
    .select("transaction_id, invoice_month, amount, account_id")
    .in(
      "transaction_id",
      linhas.map((l) => l.id)
    )
    .eq("user_id", userId);

  if (erroDaView || !naView) {
    console.error("Erro ao ler os meses de fatura da série:", erroDaView);
    return {
      ok: false,
      status: 500,
      erro: "Não foi possível ler as faturas desta compra. Tente de novo.",
    };
  }

  const porId = new Map(naView.map((l) => [l.transaction_id, l]));

  const serie: LinhaDaSerie[] = linhas
    .map((l) => {
      const v = porId.get(l.id);
      return {
        id: l.id,
        installment_number: Number(l.installment_number),
        installment_total: l.installment_total,
        account_id: l.account_id ?? v?.account_id ?? null,
        description: l.description,
        // `Number` porque `numeric` chega como string pelo PostgREST em alguns
        // caminhos, e `"-300" + 0` concatena em vez de somar.
        amount: v ? Number(v.amount) : 0,
        invoice_month: v?.invoice_month ?? null,
      };
    })
    .sort((a, b) => a.installment_number - b.installment_number);

  const ancora = serie.find((l) => l.id === parcelaId);
  if (!ancora) {
    // A ancora esta na view e nao esta na propria serie: a amarra aponta para
    // outro lugar. Recusar e melhor que planejar sobre uma serie que nao contem
    // a linha clicada.
    return {
      ok: false,
      status: 409,
      erro: "Esta parcela não está amarrada à compra dela. Edite por Lançamentos.",
    };
  }

  // -------------------------------------------------------------------------
  // AS FATURAS JA PAGAS DO CARTAO
  // -------------------------------------------------------------------------
  // Uma consulta so, pelo `status = 'paid'`, e o mes sai da propria chave. O
  // filtro por cartao acontece em `faturaDaChave`: a chave carrega o
  // `account_id`, e comparar com ele e o que impede a fatura paga de OUTRO
  // cartao de preservar uma parcela deste.
  const cartoes = new Set(serie.map((l) => l.account_id).filter(Boolean));

  const { data: faturasPagas } = await supabase
    .from("scheduled_transactions")
    .select("notes")
    .eq("user_id", userId)
    .eq("status", "paid")
    .like("notes", "fatura:%");

  const mesesPagos = (faturasPagas ?? [])
    .map((f) => faturaDaChave(f.notes))
    .filter(
      (f): f is { mes: string; accountId: string } =>
        f !== null && cartoes.has(f.accountId)
    )
    .map((f) => f.mes);

  return { ok: true, ancora, serie, mesesPagos };
}

/**
 * A frase de cada recusa de movimento, e o status dela.
 *
 * Uma frase por motivo porque as quatro pedem coisas diferentes de quem leu: um
 * "não foi possível mover" generico sobre uma serie de dez parcelas nao diz a
 * ninguem o que fazer em seguida. E o status separa o pedido mal formado (400)
 * do estado que impede (409) -- estornar a fatura e editar por Lancamentos sao
 * as duas saidas, e elas nao sao a mesma.
 */
function frasesDaRecusa(
  motivo: RecusaDeMovimento,
  quantas: number
): { frase: string; status: number } {
  switch (motivo) {
    case "ancora_sem_fatura":
      return {
        frase:
          "Esta parcela não está em nenhuma fatura, então não há de onde movê-la. Edite por Lançamentos.",
        status: 409,
      };
    case "destino_ilegivel":
      return {
        frase: "A fatura de destino não é um mês de fatura válido.",
        status: 400,
      };
    case "parcela_sem_fatura":
      return {
        frase: `${quantas} parcela${quantas === 1 ? "" : "s"} desta compra não ${quantas === 1 ? "está" : "estão"} em fatura nenhuma, e mover só as outras desmontaria a série. Edite por Lançamentos.`,
        status: 409,
      };
    case "fatura_paga_no_destino":
      return {
        frase: `${quantas} parcela${quantas === 1 ? "" : "s"} cairia${quantas === 1 ? "" : "m"} numa fatura já paga, que mudaria de valor sem a conta do cartão mudar junto. Estorne o pagamento dessa fatura, ou escolha outro destino.`,
        status: 409,
      };
    case "sem_movimento":
      // Nao chega aqui: quem chama trata `sem_movimento` como caminho de
      // sucesso (a fatura nao mudou). A frase existe para o `switch` ser
      // exaustivo -- sem ela, um motivo novo no tipo sai daqui como `undefined`
      // e vira um 200 com corpo vazio.
      return {
        frase: "Esta parcela já está nessa fatura.",
        status: 400,
      };
  }
}

/**
 * O toast. Ele DIZ quantas parcelas andaram e para onde.
 *
 * "Parcela alterada" sobre um pedido que moveu oito linhas em sete faturas
 * diferentes esconde justamente o que esta issue entregou -- e o unico jeito de
 * a pessoa conferir seria abrir as sete faturas. O caso de zero tem frase
 * propria pelo motivo oposto: quando a fatura de destino era a de origem, nada
 * andou, e uma frase de sucesso generica afirmaria um movimento que nao houve.
 */
function mensagemDaAlteracao(entrada: {
  alteradas: number;
  movidas: number;
  delta: number;
  pediuMovimento: boolean;
  mudouCampos: boolean;
}): string {
  const { alteradas, movidas, delta, pediuMovimento, mudouCampos } = entrada;

  const doValor =
    alteradas === 1 ? "Parcela alterada" : `Alterei ${alteradas} parcelas.`;

  if (!pediuMovimento) return doValor;

  if (movidas === 0) {
    return "A fatura desta parcela não mudou, então as outras não se mexeram.";
  }

  const meses = Math.abs(delta);
  const emMeses = `${meses} ${meses === 1 ? "mês" : "meses"} ${delta > 0 ? "para frente" : "para trás"}`;
  const doMovimento =
    movidas === 1
      ? `Movi esta parcela ${emMeses}.`
      : `Movi ${movidas} parcelas ${emMeses}.`;

  // As duas frases juntas quando o pedido fez as duas coisas: um toast que
  // noticia so o movimento deixaria a alteracao de valor invisivel, e e ela que
  // muda o total da compra.
  return mudouCampos ? `${doMovimento} ${doValor}` : doMovimento;
}

/** O alcance do corpo, com o padrao conservador e a recusa explicita. */
function lerAlcance(corpo: unknown): AlcanceDaParcela | null {
  const bruto =
    corpo && typeof corpo === "object" && "alcance" in corpo
      ? (corpo as { alcance: unknown }).alcance
      : "apenas_esta";
  return ehAlcanceDeParcelaValido(bruto) ? bruto : null;
}

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

    const corpo = await request.json().catch(() => ({}));
    const alcance = lerAlcance(corpo);

    if (!alcance) {
      return NextResponse.json(
        {
          error:
            'Alcance inválido. Use "apenas_esta", "esta_e_proximas" ou "todas".',
        },
        { status: 400 }
      );
    }

    const {
      amount,
      description,
      base: baseRecebida,
      invoice_month,
      transaction_date,
    } = corpo as {
      amount?: unknown;
      description?: unknown;
      base?: unknown;
      invoice_month?: unknown;
      transaction_date?: unknown;
    };

    const mudaValor = amount !== undefined;
    const mudaDescricao = description !== undefined;
    // AS DUAS FORMAS DE MOVER UMA PARCELA (HMO-357)
    //
    // `invoice_month` e a fatura escolhida ('AAAA-MM', o seletor da 041) e
    // `transaction_date` e a data da compra ('AAAA-MM-DD', o campo de data). As
    // duas movem, e elas NAO sao a mesma coisa: a fatura e uma escolha
    // explicita, a data e um fato que a `card_invoice_month` traduz em fatura
    // usando o dia de fechamento do cartao. Aceitar as duas e o que faz a serie
    // seguir a parcela pelos DOIS caminhos pelos quais a tela a move hoje.
    const mudaFatura = invoice_month !== undefined;
    const mudaData = transaction_date !== undefined;

    if (!mudaValor && !mudaDescricao && !mudaFatura && !mudaData) {
      return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
    }

    // As duas juntas sao recusadas, e nao resolvidas por precedencia: "a data e
    // 10/04 e a fatura e maio" sao dois destinos diferentes para a mesma
    // parcela, e escolher um em silencio moveria a serie inteira para o lugar
    // que a pessoa nao pediu. Quem quer as duas coisas manda a data (a fatura
    // sai dela) ou escolhe a fatura (a data fica como esta).
    if (mudaFatura && mudaData) {
      return NextResponse.json(
        {
          error:
            'Mande a data OU a fatura, não as duas: são dois destinos diferentes para a mesma parcela.',
        },
        { status: 400 }
      );
    }

    const faturaPedida = mudaFatura ? mesDaFaturaPedida(invoice_month) : null;
    if (mudaFatura && !faturaPedida) {
      return NextResponse.json(
        { error: "O mês da fatura não é um mês ('AAAA-MM')" },
        { status: 400 }
      );
    }

    const dataPedida = mudaData ? String(transaction_date ?? "").trim() : null;
    if (mudaData && !/^\d{4}-\d{2}-\d{2}$/.test(dataPedida ?? "")) {
      return NextResponse.json(
        { error: "A data da parcela não é uma data ('AAAA-MM-DD')" },
        { status: 400 }
      );
    }

    // A MESMA PERGUNTA QUE A HMO-211 JA FAZ, COM AS MESMAS PALAVRAS
    //
    // "o valor de cada parcela" / "o total da compra". Vocabulario novo para a
    // mesma duvida e como se aprende duas regras onde havia uma -- e aqui ela
    // nao tem default inofensivo: seja qual for, metade das pessoas digita
    // pensando no outro. Entao em `todas` a tela e obrigada a dizer qual e.
    let base: BaseDoValorParcelado = "parcela";
    if (mudaValor) {
      if (baseRecebida !== undefined) {
        if (baseRecebida !== "parcela" && baseRecebida !== "total") {
          return NextResponse.json(
            { error: 'Informe se o valor é "parcela" ou "total".' },
            { status: 400 }
          );
        }
        base = baseRecebida;
      } else if (alcance !== "apenas_esta") {
        // Em `apenas_esta` nao ha ambiguidade: uma parcela so, o numero e ela.
        return NextResponse.json(
          {
            error:
              'Informe se o valor digitado é o de cada parcela ou o total da compra ("base": "parcela" ou "total").',
          },
          { status: 400 }
        );
      }

      if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
        return NextResponse.json(
          { error: "Valor deve ser maior que zero" },
          { status: 400 }
        );
      }
    }

    if (mudaDescricao && !String(description).trim()) {
      return NextResponse.json(
        { error: "Descrição é obrigatória" },
        { status: 400 }
      );
    }

    const lida = await lerSerie(supabase, params.id, user.id);
    if (!lida.ok) {
      return NextResponse.json({ error: lida.erro }, { status: lida.status });
    }
    const { ancora, serie, mesesPagos } = lida;

    // A ancora numa fatura JA PAGA e recusada aqui, com a frase que explica o
    // caminho -- e nao silenciosamente preservada pela regra, que devolveria um
    // "nada para alterar" generico sobre a linha que a pessoa acabou de clicar.
    if (ancora.invoice_month && mesesPagos.includes(ancora.invoice_month)) {
      return NextResponse.json(
        {
          error:
            "A fatura desta parcela já foi paga. Estorne o pagamento da fatura antes de alterar a parcela.",
        },
        { status: 409 }
      );
    }

    const plano = planejarAlteracaoDeParcelas(alcance, ancora, serie, mesesPagos);

    const alcancadas = serie.filter((l) => plano.ids.includes(l.id));
    const preservadas = serie.filter((l) => plano.preservadas.includes(l.id));

    const totalAntes = totalDaCompra(serie);
    let totalDepois = totalAntes;

    // -----------------------------------------------------------------------
    // O MOVIMENTO: A SERIE ANDA COM A PARCELA (HMO-357)
    // -----------------------------------------------------------------------
    // "Quando movo uma parcela, as demais devem mover junto."
    //
    // O deslocamento e medido em MESES DE FATURA entre a fatura de origem e a de
    // destino da ancora, e cada parcela alcancada anda esse numero de meses a
    // partir da fatura DELA -- a regra inteira esta em
    // `novasFaturasDasParcelas`, com o motivo de nao ser em dias.
    let parcelasMovidas = 0;
    let deltaDeMeses = 0;
    let faturaNova: string | null = null;

    if (mudaFatura || mudaData) {
      let destino = faturaPedida;

      if (mudaData) {
        // EM QUE FATURA CAI ESTA DATA -- A PERGUNTA VAI PARA O BANCO
        //
        // `card_invoice_month` (006) e a unica fonte dessa regra, e recalcula-la
        // aqui em TypeScript criaria a segunda: a tela e a serie discordariam do
        // cartao no primeiro dia de fechamento alterado. E o erro nao seria de
        // um dia -- "31/01 com fechamento no dia 30 cai em fevereiro" e o tipo de
        // caso que uma reimplementacao acerta por acidente e perde na borda.
        if (!ancora.account_id) {
          return NextResponse.json(
            {
              error:
                "Esta parcela não está em nenhum cartão, então não há fatura para onde movê-la.",
            },
            { status: 409 }
          );
        }

        const { data: cartao, error: erroDoCartao } = await supabase
          .from("financial_accounts")
          .select("closing_day")
          .eq("id", ancora.account_id)
          .eq("user_id", user.id)
          .maybeSingle();

        if (erroDoCartao) {
          console.error("Erro ao ler o dia de fechamento do cartão:", erroDoCartao);
          return NextResponse.json(
            { error: "Não foi possível ler o cartão desta parcela" },
            { status: 500 }
          );
        }

        const { data: mesDaRpc, error: erroDoMes } = await supabase.rpc(
          "card_invoice_month",
          {
            p_transaction_date: dataPedida,
            // `?? null` e nao `?? 1`: a funcao trata o NULL (trunca no mes) e um
            // dia inventado aqui moveria a serie pela regra de um cartao que nao
            // existe.
            p_closing_day: cartao?.closing_day ?? null,
          }
        );

        if (erroDoMes || !mesDaRpc) {
          console.error("Erro ao resolver a fatura da data nova:", erroDoMes);
          return NextResponse.json(
            { error: "Não foi possível descobrir em que fatura esta data cai" },
            { status: 500 }
          );
        }

        destino = String(mesDaRpc).slice(0, 10);
      }

      const movimento = novasFaturasDasParcelas({
        ancora,
        destinoDaAncora: String(destino),
        alcancadas,
        mesesDeFaturaPaga: mesesPagos,
      });

      if (!movimento.ok && movimento.motivo !== "sem_movimento") {
        const recusa = frasesDaRecusa(movimento.motivo, movimento.parcelas.length);
        return NextResponse.json(
          { error: recusa.frase, parcelas_movidas: 0 },
          { status: recusa.status }
        );
      }

      if (!movimento.ok) {
        // `sem_movimento`: a fatura de destino e a de origem. NAO e erro -- e o
        // que acontece quando a pessoa muda o DIA dentro da mesma fatura (de 05
        // para 10 de marco). Recusar com 400 bloquearia uma edicao legitima;
        // mover as irmas seria pior ainda, porque elas andariam zero meses e a
        // resposta diria que a serie se mexeu. A data da ancora e gravada, e a
        // resposta diz em voz alta que as outras nao se mexeram.
        if (mudaData) {
          const { error: erroDaData } = await supabase
            .from("financial_transactions")
            .update({ transaction_date: dataPedida })
            .eq("id", ancora.id)
            .eq("user_id", user.id);

          if (erroDaData) {
            console.error("Erro ao gravar a data da parcela:", erroDaData);
            return NextResponse.json(
              { error: "Não foi possível alterar a data desta parcela" },
              { status: 500 }
            );
          }
        }
      } else {
        deltaDeMeses = movimento.delta;
        faturaNova = String(destino);

        // UMA LINHA POR PARCELA, e tres casos diferentes de COMO mover. Os tres
        // existem para nao haver duas fontes de verdade para a mesma colocacao,
        // que e a mesma razao pela qual a criacao da serie so poe override na
        // parcela 1 (ver o cabecalho de `app/api/financial-installments/route.ts`):
        //
        //   1. a ancora movida por DATA leva a data digitada e o override LIMPO.
        //      A data e o fato que a pessoa escreveu, e `destino` saiu dela pela
        //      `card_invoice_month` -- um override aqui seria uma segunda
        //      resposta para a pergunta que a data ja responde.
        //
        //   2. a PARCELA 1 da serie leva override e mantem a data. A data dela e
        //      a data real da compra, um fato do mundo; reescreve-la para o dia 1
        //      do mes de destino apagaria o dia em que a compra aconteceu.
        //
        //   3. as outras levam a data no DIA 1 do mes de destino, e o override
        //      limpo. A `transaction_date` delas nunca foi um fato -- e o
        //      dispositivo de colocacao que a criacao usa, e o dia 1 e o unico
        //      que `card_invoice_month` nunca empurra para o mes seguinte. Assim
        //      a data que a lista de Lancamentos mostra continua concordando com
        //      a fatura em que a parcela esta.
        for (const m of movimento.movimentos) {
          const ehAncora = m.id === ancora.id;
          const ehPrimeira =
            serie.find((l) => l.id === m.id)?.installment_number === 1;

          const campos =
            ehAncora && mudaData
              ? { transaction_date: dataPedida, invoice_month_override: null }
              : ehPrimeira
                ? { invoice_month_override: m.invoiceMonth }
                : {
                    transaction_date: m.invoiceMonth,
                    invoice_month_override: null,
                  };

          const { error } = await supabase
            .from("financial_transactions")
            .update(campos)
            .eq("id", m.id)
            .eq("user_id", user.id);

          if (error) {
            console.error("Erro ao mover a parcela:", error);
            // A serie fica PELA METADE e dizer isso e a unica coisa honesta:
            // nao ha transacao envolvendo as N linhas aqui (o PostgREST nao abre
            // uma), e o numero e o que torna o estado descobrivel.
            return NextResponse.json(
              {
                error:
                  "Movi parte das parcelas e não consegui terminar. Confira em quais faturas elas estão antes de tentar de novo.",
                parcelas_movidas: parcelasMovidas,
              },
              { status: 500 }
            );
          }

          parcelasMovidas++;
        }
      }
    }

    // -----------------------------------------------------------------------
    // O VALOR
    // -----------------------------------------------------------------------
    // Uma linha por parcela, e NAO um UPDATE unico: em base "total" a sobra dos
    // centavos cai na ultima alcancada, entao as parcelas nao valem todas o
    // mesmo. Um `.in(ids).update({amount})` poria o mesmo numero em todas e a
    // compra deixaria de fechar -- sempre em um centavo, sempre sem erro.
    if (mudaValor) {
      const novos = novosValoresDasParcelas({
        base,
        valorDigitado: Number(amount),
        alcancadas,
        preservadas,
      });

      if (!novos) {
        return NextResponse.json(
          {
            error:
              base === "total"
                ? "Este total não cobre as parcelas que ficam como estão. Informe um total maior, ou escolha outro alcance."
                : "Este valor não forma parcelas válidas.",
          },
          { status: 400 }
        );
      }

      for (const v of novos.valores) {
        const { error } = await supabase
          .from("financial_transactions")
          .update({ amount: v.amount })
          .eq("id", v.id)
          .eq("user_id", user.id);

        if (error) {
          console.error("Erro ao alterar o valor da parcela:", error);
          // A serie fica PELA METADE, e dizer isso e a unica coisa honesta a
          // fazer: nao ha transacao envolvendo as N linhas aqui (o PostgREST
          // nao abre uma), e um 500 generico faria a pessoa tentar de novo em
          // cima de um estado que ela nao conhece. O numero e o que torna o
          // estado descobrivel.
          return NextResponse.json(
            {
              error:
                "Alterei parte das parcelas e não consegui terminar. Confira os valores na fatura do cartão antes de tentar de novo.",
              parcelas_alteradas: novos.valores.indexOf(v),
              total_da_compra: null,
            },
            { status: 500 }
          );
        }
      }

      totalDepois = novos.totalRecalculado;
    }

    // -----------------------------------------------------------------------
    // A DESCRICAO
    // -----------------------------------------------------------------------
    // O rotulo "(N/M)" e remontado por parcela: copiar a descricao da ancora
    // para as irmas poria "(3/10)" em todas as oito, e a lista de Lancamentos
    // mostraria oito linhas com o mesmo nome. O rotulo da TELA sai das colunas
    // da 035, mas a descricao e o que a pessoa le na lista e na busca.
    if (mudaDescricao) {
      const limpa = String(description).trim().replace(/\s*\(\d+\/\d+\)\s*$/, "");

      for (const l of alcancadas) {
        const total = l.installment_total;
        const nova =
          total && l.installment_number
            ? `${limpa} (${l.installment_number}/${total})`
            : limpa;

        const { error } = await supabase
          .from("financial_transactions")
          .update({ description: nova })
          .eq("id", l.id)
          .eq("user_id", user.id);

        if (error) {
          console.error("Erro ao alterar a descrição da parcela:", error);
          return NextResponse.json(
            {
              error:
                "Alterei parte das parcelas e não consegui terminar. Confira a fatura do cartão antes de tentar de novo.",
            },
            { status: 500 }
          );
        }
      }
    }

    return NextResponse.json({
      message: mensagemDaAlteracao({
        alteradas: plano.ids.length,
        movidas: parcelasMovidas,
        delta: deltaDeMeses,
        pediuMovimento: mudaFatura || mudaData,
        mudouCampos: mudaValor || mudaDescricao,
      }),
      parcelas_alteradas: plano.ids.length,
      // O QUE O MOVIMENTO FEZ, EM NUMEROS (HMO-357)
      //
      // `parcelas_movidas` e 0 num pedido que mexeu so no valor E num pedido em
      // que a fatura de destino era a de origem -- os dois casos em que a
      // resposta nao pode dizer que a serie andou. `deslocamento_em_meses` da o
      // sentido (negativo = para tras), e `fatura_nova` e onde a ancora foi
      // parar, que e o unico jeito de a tela conferir o destino sem refazer a
      // conta do fechamento.
      parcelas_movidas: parcelasMovidas,
      deslocamento_em_meses: deltaDeMeses,
      fatura_nova: faturaNova,
      // A CONTAGEM QUE A ISSUE EXIGE NA RESPOSTA E NA TELA.
      //
      // Dois numeros e nao um: "ficaram de fora" por escolha (anteriores a
      // ancora) e "ficaram de fora" por recusa (fatura paga) sao frases
      // diferentes, e a segunda explica um total que a pessoa nao calculou.
      preservadas: plano.preservadas.length,
      preservadas_por_fatura_paga: plano.preservadasPorFaturaPaga.length,
      total_da_compra: totalDepois,
      total_da_compra_antes: totalAntes,
    });
  } catch (error) {
    console.error("Erro ao alterar a série de parcelas:", error);
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

    // `request.json()` num DELETE sem corpo lanca. O padrao conservador e o
    // comportamento de uma parcela so.
    const corpo = await request.json().catch(() => ({}));
    const alcance = lerAlcance(corpo);

    if (!alcance) {
      return NextResponse.json(
        {
          error:
            'Alcance inválido. Use "apenas_esta", "esta_e_proximas" ou "todas".',
        },
        { status: 400 }
      );
    }

    const lida = await lerSerie(supabase, params.id, user.id);
    if (!lida.ok) {
      return NextResponse.json({ error: lida.erro }, { status: lida.status });
    }
    const { ancora, serie, mesesPagos } = lida;

    if (ancora.invoice_month && mesesPagos.includes(ancora.invoice_month)) {
      return NextResponse.json(
        {
          error:
            "A fatura desta parcela já foi paga. Estorne o pagamento da fatura antes de apagar a parcela.",
        },
        { status: 409 }
      );
    }

    const plano = planejarAlteracaoDeParcelas(alcance, ancora, serie, mesesPagos);

    // DELETE de verdade, e nao um status: `financial_transactions` nao tem
    // estado "cancelada", e nada regenera estas linhas (ao contrario das
    // ocorrencias de gasto fixo, que a agenda recria). Aqui apagar apaga.
    const { data: apagadas, error } = await supabase
      .from("financial_transactions")
      .delete()
      .in("id", plano.ids)
      .eq("user_id", user.id)
      .select("id");

    if (error) {
      console.error("Erro ao apagar parcelas:", error);
      return NextResponse.json(
        { error: "Não foi possível apagar estas parcelas" },
        { status: 500 }
      );
    }

    const quantas = apagadas?.length ?? 0;

    // -----------------------------------------------------------------------
    // A LINHA ORFA, QUE E O DEFEITO QUE SOBRA DEPOIS DE APAGAR CERTO
    // -----------------------------------------------------------------------
    // `installment_parent_id` aponta para a PRIMEIRA parcela. Apagar a primeira
    // deixa as outras apontando para uma linha que nao existe mais.
    //
    // E CONFERIDO: a coluna NAO TEM FOREIGN KEY. Ela e um `uuid` solto em
    // `financial_transactions` desde a 001 (a 035 so criou um indice parcial
    // sobre ela). Nao ha `ON DELETE` nenhum para limpar o ponteiro, entao ele
    // nao vira NULL -- ele fica apontando para um id que nao existe, que e o
    // estado exato que a issue nomeia ("nenhuma linha orfa com
    // `installment_parent_id` apontando para nada").
    //
    // Nada disso da erro. A serie simplesmente se desfaz, e as parcelas
    // restantes deixam de ser encontraveis uma pela outra: a proxima edicao
    // delas cai no 400 "não faz parte de uma compra parcelada", sobre linhas
    // que sao visivelmente "parcela 4 de 10" na tela.
    //
    // Reamarrar na nova primeira parcela e o que mantem a serie utilizavel. Se
    // nao sobrou nenhuma, nao ha o que reamarrar.
    let reamarradas = 0;
    const restantes = serie.filter((l) => !plano.ids.includes(l.id));

    if (restantes.length > 0) {
      const novaPrimeira = restantes[0].id;
      const { data: religadas, error: erroDaAmarra } = await supabase
        .from("financial_transactions")
        .update({ installment_parent_id: novaPrimeira })
        .in(
          "id",
          restantes.map((l) => l.id)
        )
        .eq("user_id", user.id)
        .select("id");

      if (erroDaAmarra) {
        // As parcelas foram apagadas e a amarra ficou solta. O dinheiro esta
        // certo; o que se perde e a navegacao pela serie.
        console.error("Parcelas apagadas, mas a série não foi reamarrada:", erroDaAmarra);
        return NextResponse.json(
          {
            message: `Apaguei ${quantas} parcela(s), mas não consegui religar as ${restantes.length} restantes à compra. Os valores estão certos; editar a série de novo pode não encontrar todas as parcelas.`,
            parcelas_apagadas: quantas,
            preservadas: plano.preservadas.length,
            preservadas_por_fatura_paga: plano.preservadasPorFaturaPaga.length,
            serie_reamarrada: false,
          },
          { status: 207 }
        );
      }
      reamarradas = religadas?.length ?? 0;
    }

    return NextResponse.json({
      message:
        quantas === 1
          ? "Parcela apagada"
          : `Apaguei ${quantas} parcelas desta compra.`,
      parcelas_apagadas: quantas,
      parcelas_restantes: restantes.length,
      preservadas: plano.preservadas.length,
      preservadas_por_fatura_paga: plano.preservadasPorFaturaPaga.length,
      serie_reamarrada: reamarradas > 0,
      total_da_compra: totalDaCompra(restantes),
    });
  } catch (error) {
    console.error("Erro ao apagar a série de parcelas:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
