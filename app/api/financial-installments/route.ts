// ---------------------------------------------------------------------------
// POST /api/financial-installments -- a compra parcelada (HMO-211)
// ---------------------------------------------------------------------------
// "Sobre parcelar, deve ser um checkbox abaixo do valor do cartao e ao clicar
// perguntar se o valor que esta no input e o da parcela ou total, e em qual
// parcela aquela se refere de quantas no total."
//
// ESTA ROTA FOI REESCRITA PORQUE ELA GRAVAVA NUM LUGAR QUE NINGUEM LE
// -------------------------------------------------------------------
// Ela chamava a RPC `create_installments` (001), que insere em
// `transaction_installments`. Essa tabela nao tem **leitor nenhum** em todo o
// repositorio: as linhas nao apareciam em Lancamentos, nem em Contas a Pagar,
// nem na fatura do cartao. Quem parcelasse via o toast "10 parcelas criadas com
// sucesso!" e nunca mais encontrava a compra. O defeito nao era a mensagem --
// era que a unica prova de que o parcelamento funcionava era a propria mensagem.
//
// Agora a serie e materializada onde cada tipo de dinheiro JA tem leitor:
//
//   CARTAO -> N linhas em `financial_transactions`, uma por mes de fatura.
//     A view `card_invoice_lines` (006) decide o `invoice_month` de cada linha
//     pelo `transaction_date`, entao as parcelas aparecem na tela do cartao
//     (HMO-210), na fatura de cada mes seguinte e na lista de Lancamentos sem um
//     leitor novo e sem uma segunda fonte de verdade para o total da fatura.
//
//   FORA DO CARTAO -> N linhas em `scheduled_transactions` (Contas a Pagar).
//     Parcela futura em conta corrente e dinheiro que ainda NAO saiu. Gravar em
//     `financial_transactions` baixaria o saldo hoje por 10 pagamentos que nao
//     aconteceram -- `update_account_balance_trigger` soma `NEW.amount` no saldo
//     no instante do INSERT. Na HMO-209 a agenda passou a excluir previsao de
//     CARTAO (para a compra nao ser cobrada duas vezes, uma avulsa e outra dentro
//     da fatura); previsao de conta corrente nunca foi excluida, e e por isso que
//     este ramo e visivel e o outro nao poderia ser.
//
// POR QUE O INSERT E UM SO, COM N LINHAS
// --------------------------------------
// Um laco de N inserts pode parar no meio: a compra de 10x ficaria gravada em 4
// parcelas, com a fatura de cada mes fechando num valor plausivel e errado, e
// nada na tela diria que faltam 6. Um unico `.insert([...])` e um unico comando
// -- ou entram as 8 linhas, ou nenhuma.
//
// POR QUE O MES DA FATURA VEM DO BANCO, E NAO DAQUI
// -------------------------------------------------
// Ver `datasDasParcelasNoCartao` abaixo. Resumo: somar um mes a
// `transaction_date` NAO soma um mes a fatura, e a diferenca e silenciosa.
// ---------------------------------------------------------------------------

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  descricaoDaParcela,
  serieDeParcelas,
  somaMeses,
  valorGravado,
  type BaseDoValorParcelado,
  type SerieDeParcelas,
} from "@/lib/lancamento";

/**
 * Em que data cada parcela do CARTAO tem de ser gravada para cair na fatura
 * certa.
 *
 * O PROBLEMA, QUE NAO PARECE UM
 * -----------------------------
 * A tentacao e `transaction_date = dataDaCompra + k meses` e deixar
 * `card_invoice_month()` fazer o resto. Isso erra, e erra calado, porque somar
 * um mes a uma data NAO soma um mes a fatura quando o dia e grampeado pelo fim
 * do mes. Medido com a funcao do banco:
 *
 *   compra 31/01, cartao fecha dia 30
 *     31/01 -> dia 31 > 30            -> fatura de FEVEREIRO
 *     28/02 (31/01 + 1 mes, grampeado) -> dia 28 <= 28 -> fatura de FEVEREIRO
 *
 * Duas parcelas na MESMA fatura, e a serie termina um mes antes do que devia.
 * A fatura de fevereiro fecharia com o dobro, a ultima ficaria vazia, e nada
 * disso aparece como erro -- aparece como um mes caro.
 *
 * A SOLUCAO
 * ---------
 * A primeira parcela (a que a pessoa esta lancando) fica com a data REAL da
 * compra: e o fato, e e ela que define a fatura ancora. As seguintes ficam com
 * o **primeiro dia** do mes da fatura delas, porque dia 1 e o unico dia que
 * `card_invoice_month()` nunca empurra para o mes seguinte -- `1 <= closing_day`
 * vale para todo `closing_day >= 1`, e com `closing_day` NULL a funcao trunca no
 * mes de qualquer jeito. A colocacao passa a ser exata por construcao em vez de
 * depender do calendario.
 *
 * E a fatura ancora e perguntada AO BANCO (`card_invoice_month`), nao
 * recalculada aqui: essa regra existe num lugar so (006), e uma segunda copia em
 * TypeScript faria a tela e o relatorio discordarem sobre o mesmo cartao no mes
 * em que uma das duas mudasse.
 */
function datasDasParcelasNoCartao(
  serie: SerieDeParcelas,
  dataDaCompra: string,
  mesDaFaturaAncora: string
): string[] | null {
  const datas: string[] = [];

  for (let k = 0; k < serie.parcelas.length; k++) {
    if (k === 0) {
      datas.push(dataDaCompra);
      continue;
    }
    const mes = somaMeses(mesDaFaturaAncora, k);
    if (!mes) return null;
    datas.push(mes);
  }

  return datas;
}

export async function POST(request: NextRequest) {
  const supabase = createClient();

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const {
      account_id,
      category_id,
      description,
      notes,
      group_id,
      // O VALOR VAI CRU, COM A PERGUNTA AO LADO (HMO-211)
      //
      // O cliente manda o que foi digitado (`valor`) e o que aquilo significa
      // (`base`), e e o SERVIDOR que faz a conta, com a mesma funcao pura que a
      // tela usa para mostrar o resumo. Receber `total_amount` ja multiplicado
      // -- como esta rota recebia -- coloca a aritmetica do dinheiro no cliente:
      // era `Number.parseFloat(valorDaParcela) * totalDeParcelas` dentro do
      // componente, sem nada no servidor conferindo, e o servidor gravava
      // qualquer total que chegasse.
      valor,
      base,
      parcela_atual,
      total_parcelas,
      vencimento,
      currency,
      exchange_rate,
    } = body as {
      account_id?: string | null;
      category_id?: string;
      description?: string;
      notes?: string | null;
      group_id?: string | null;
      valor?: string | number;
      base?: BaseDoValorParcelado;
      parcela_atual?: number;
      total_parcelas?: number;
      vencimento?: string;
      currency?: string | null;
      exchange_rate?: number | null;
    };

    if (!description?.trim()) {
      return NextResponse.json(
        { error: "Descrição é obrigatória" },
        { status: 400 }
      );
    }

    if (!category_id) {
      return NextResponse.json(
        { error: "Categoria é obrigatória" },
        { status: 400 }
      );
    }

    if (base !== "parcela" && base !== "total") {
      return NextResponse.json(
        { error: "Diga se o valor é o da parcela ou o total" },
        { status: 400 }
      );
    }

    // A CONTA INTEIRA SAI DA FUNCAO PURA, E DELA SO.
    //
    // `serieDeParcelas` ja recusa N > M, M < 2, valor <= 0 e data ilegivel --
    // sao as mesmas regras que `validarLancamento` usa para escrever a frase na
    // tela. Repeti-las aqui em outra forma criaria duas peneiras com malhas
    // diferentes, e a rota aceitaria o que a tela recusa (ou o contrario).
    const serie = serieDeParcelas({
      valor: String(valor ?? ""),
      base,
      parcelaAtual: Number(parcela_atual),
      totalDeParcelas: Number(total_parcelas),
      vencimentoDaParcelaAtual: String(vencimento ?? ""),
    });

    if (!serie) {
      return NextResponse.json(
        {
          error:
            "Não consegui montar as parcelas: confira o valor, a parcela atual e o total.",
        },
        { status: 400 }
      );
    }

    // A conta tem de ser do usuario, e e dela que sai o ramo (cartao x resto).
    // Sem conta nao ha onde a parcela aparecer -- nem fatura, nem agenda com
    // conta -- entao ela e obrigatoria aqui, ao contrario do lancamento avulso.
    if (!account_id) {
      return NextResponse.json(
        { error: "Escolha a conta ou o cartão das parcelas" },
        { status: 400 }
      );
    }

    const { data: conta } = await supabase
      .from("financial_accounts")
      .select("id, account_type, closing_day")
      .eq("id", account_id)
      .eq("user_id", user.id)
      .single();

    if (!conta) {
      return NextResponse.json(
        { error: "Conta não encontrada" },
        { status: 404 }
      );
    }

    const total = serie.parcelas.length + serie.parcelasAnteriores;

    // -----------------------------------------------------------------------
    // FORA DO CARTAO A ROTA RECUSA, E ISSO E UMA DECISAO (HMO-211)
    // -----------------------------------------------------------------------
    // O pedido e literalmente "um checkbox abaixo do valor DO CARTAO", e
    // `camposDoTipo` so mostra o parcelamento na natureza `card`. Esta recusa e
    // o que impede a rota de aceitar pelas costas o que a tela nao oferece.
    //
    // POR QUE PARCELAR FORA DO CARTAO NAO E "A MESMA COISA COM OUTRA TABELA"
    //
    // Numa serie fora do cartao a parcela N foi paga (a tela exige "Ja paguei"
    // para parcelar) e as N+1..M nao. Isso exige escrever em DUAS tabelas na
    // mesma operacao -- `financial_transactions` para a que aconteceu e
    // `scheduled_transactions` para as que faltam -- e as duas escritas nao cabem
    // num comando so. Uma serie gravada pela metade e dinheiro errado e
    // plausivel: o saldo baixa, 4 das 10 parcelas aparecem na agenda, e nada na
    // tela diz que faltam 6.
    //
    // E nao e um buraco no produto, porque o caminho existe e funciona: uma
    // despesa FIXA com duracao "por N meses" (`max_occurrences`, migration 005)
    // ja gera as N ocorrencias em Contas a Pagar, cada uma com o seu vencimento,
    // e cada uma e dada como paga no mes dela. E o que um financiamento ou um
    // boleto em 10x e de verdade.
    //
    // 400 e nao 500: quem chamou mandou uma combinacao que o produto nao faz.
    if (conta.account_type !== "credit_card") {
      return NextResponse.json(
        {
          error:
            'Parcelamento só existe no cartão. Para um financiamento ou boleto em N vezes, lance como despesa fixa com duração "por N meses" — ela gera as parcelas em Contas a Pagar.',
        },
        { status: 400 }
      );
    }

    // -----------------------------------------------------------------------
    // NO CARTAO: AS PARCELAS VIRAM COMPRAS, UMA POR FATURA
    // -----------------------------------------------------------------------
    const { data: mesAncora, error: erroDoMes } = await supabase.rpc(
      "card_invoice_month",
      {
        p_transaction_date: serie.parcelas[0].vencimento,
        p_closing_day: conta.closing_day ?? null,
      }
    );

    if (erroDoMes || !mesAncora) {
      console.error("Erro ao resolver o mês da fatura:", erroDoMes);
      return NextResponse.json(
        { error: "Não foi possível descobrir em que fatura a compra cai" },
        { status: 500 }
      );
    }

    const datas = datasDasParcelasNoCartao(
      serie,
      serie.parcelas[0].vencimento,
      String(mesAncora)
    );

    if (!datas) {
      return NextResponse.json(
        { error: "Não foi possível montar as datas das parcelas" },
        { status: 500 }
      );
    }

    const { data: service } = await supabase
      .from("financial_services")
      .select("id")
      .eq("name", "personal_finance")
      .single();

    if (!service) {
      return NextResponse.json(
        { error: "Serviço de finanças pessoais não encontrado" },
        { status: 404 }
      );
    }

    const temGrupo = Boolean(group_id);

    const linhas = serie.parcelas.map((p, i) => ({
      user_id: user.id,
      service_id: service.id,
      category_id,
      account_id,
      description: descricaoDaParcela(description, p.numero, total),
      // NEGATIVO, por `valorGravado`: neste banco despesa e gravada negativa, e
      // a fatura e `SUM(-amount)` na view. Uma parcela positiva nao daria erro:
      // ela ABATERIA a fatura, como um estorno.
      amount: valorGravado("expense", p.valor),
      transaction_date: datas[i],
      transaction_type: "expense" as const,
      notes: notes?.trim() || null,
      is_shared: temGrupo,
      group_id: group_id || null,
      // A moeda e a cotacao vao SEMPRE juntas: a 026 tem
      // `CHECK ((currency = 'BRL') = (exchange_rate = 1))` e a coluna nasceu com
      // DEFAULT 1, entao mandar a moeda sem a cotacao monta o par (USD, 1) --
      // exatamente o proibido -- e o INSERT volta 23514 para a serie inteira.
      currency: currency || "BRL",
      exchange_rate: currency && currency !== "BRL" ? (exchange_rate ?? 1) : 1,
      // O QUE A 035 ACRESCENTOU, E O MOTIVO DESTA ROTA EXISTIR
      //
      // E daqui que sai "parcela 3 de 10" na tela do cartao. O rotulo NAO sai da
      // descricao: a descricao e editavel pelo usuario, e um texto reescrito
      // faria o rotulo sumir de uma parcela e ficar na vizinha, na mesma fatura.
      installment_number: p.numero,
      installment_total: total,
    }));

    const { data: criadas, error } = await supabase
      .from("financial_transactions")
      .insert(linhas)
      .select("id");

    if (error) {
      console.error("Erro ao criar parcelas no cartão:", error);
      return NextResponse.json(
        { error: "Erro ao criar parcelas" },
        { status: 500 }
      );
    }

    // AS PARCELAS DE UMA SERIE FICAM AMARRADAS ENTRE SI
    //
    // `installment_parent_id` existe em `financial_transactions` desde a 001 e
    // nunca foi escrita por ninguem -- `lib/offline-queue.ts:183` ja descrevia
    // este modelo ("Parcelamento vira N transacoes amarradas por
    // `installment_parent_id`"). A primeira parcela e o pai, e ela aponta para
    // si mesma, como a `create_installments` fazia: assim "as parcelas desta
    // serie" e um filtro so (`installment_parent_id = X`), sem um OR para o pai.
    //
    // ESTE UPDATE PODE FALHAR SEM PERDER DINHEIRO, e por isso ele nao derruba a
    // resposta: as linhas de dinheiro ja estao gravadas, com valor, data e
    // rotulo certos, e aparecem na fatura. O que se perde e a amarra -- entao o
    // erro vai para o log e a serie fica utilizavel.
    const ids = (criadas ?? []).map((l: { id: string }) => l.id);
    if (ids.length > 0) {
      const { error: erroDaAmarra } = await supabase
        .from("financial_transactions")
        .update({ installment_parent_id: ids[0] })
        .in("id", ids);

      if (erroDaAmarra) {
        console.error(
          "Parcelas gravadas, mas sem amarrar a série:",
          erroDaAmarra
        );
      }
    }

    return NextResponse.json({
      success: true,
      destino: "fatura-do-cartao",
      installment_ids: ids,
      total_created: ids.length,
      parcelas_anteriores_nao_criadas: serie.parcelasAnteriores,
      message: mensagem(ids.length, serie, "a fatura do cartão"),
    });
  } catch (error) {
    console.error("Create installments error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}

/**
 * O toast. Ele DIZ quantas parcelas anteriores nao entraram.
 *
 * Esta frase e a unica coisa que conta ao usuario que lancar "parcela 3 de 10"
 * gravou 8 linhas e nao 10 -- a decisao (A) da HMO-208. Um "10 parcelas criadas
 * com sucesso!" (o texto que esta rota dava antes) seria falso, e o jeito de
 * descobrir seria procurar nas faturas passadas uma parcela que nunca existiu.
 */
function mensagem(
  quantas: number,
  serie: SerieDeParcelas,
  onde: string
): string {
  const plural = quantas === 1 ? "parcela" : "parcelas";
  if (serie.parcelasAnteriores > 0) {
    return `${quantas} ${plural} em ${onde}, da ${serie.parcelas[0].numero}ª em diante. As ${serie.parcelasAnteriores} anteriores não foram criadas — lance à mão se quiser registrá-las.`;
  }
  return `${quantas} ${plural} em ${onde}.`;
}

export async function GET(request: NextRequest) {
  // A LEITURA FICOU, E ELA LE A TABELA ANTIGA DE PROPOSITO.
  //
  // `transaction_installments` tem linhas de producao gravadas pelo caminho
  // antigo. Elas nao foram migradas (seria mexer em dinheiro gravado) nem
  // apagadas, e esta rota e o unico jeito de alguem olha-las. Parcelamento NOVO
  // nao passa mais por aqui: ele esta em `financial_transactions`
  // (`installment_number` / `installment_total`, 035) ou em
  // `scheduled_transactions`.
  const supabase = createClient();

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const url = new URL(request.url);
    const accountId = url.searchParams.get("account_id");

    let query = supabase
      .from("transaction_installments")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("due_date", { ascending: true });

    if (accountId) query = query.eq("account_id", accountId);

    const { data: installments, error: fetchError } = await query;

    if (fetchError) {
      console.error("Error fetching installments:", fetchError);
      return NextResponse.json(
        { error: "Erro ao buscar parcelas" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      installments: installments || [],
      total_found: installments?.length || 0,
      aviso:
        "Parcelamento legado. As séries novas estão em financial_transactions (cartão) ou scheduled_transactions (fora do cartão).",
    });
  } catch (error) {
    console.error("Get installments error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
