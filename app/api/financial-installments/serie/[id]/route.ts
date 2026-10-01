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
  novosValoresDasParcelas,
  planejarAlteracaoDeParcelas,
  totalDaCompra,
  type AlcanceDaParcela,
  type ParcelaParaAlcance,
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
    } = corpo as {
      amount?: unknown;
      description?: unknown;
      base?: unknown;
    };

    const mudaValor = amount !== undefined;
    const mudaDescricao = description !== undefined;

    if (!mudaValor && !mudaDescricao) {
      return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
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
      message:
        plano.ids.length === 1
          ? "Parcela alterada"
          : `Alterei ${plano.ids.length} parcelas.`,
      parcelas_alteradas: plano.ids.length,
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
