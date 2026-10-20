import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { lerRecorteDeConta } from "@/lib/conta-do-ativo";
import {
  calcularPosicoes,
  type AtivoBruto,
  type LancamentoBruto,
} from "@/lib/investments";
import {
  type DiaDaSerie,
  type Projecao,
  indexadorValido,
  primeiraCompraPorAtivo,
  projetarRendimento,
  somarProjecoes,
} from "@/lib/renda-fixa";
import { hojeEmBrasilia, serieDoPeriodo } from "@/lib/cdi";

// =====================================================
// GET /api/investments/renda-fixa
// =====================================================
// O rendimento de cada ativo de renda fixa da carteira: BRUTO acumulado,
// LIQUIDO estimado e quanto rende por dia.
//
// POR QUE NAO DENTRO DE GET /api/investments
// ------------------------------------------
// Aquela rota existe justamente para que os quatro numeros da tela saiam do
// MESMO par de leituras, e trazer isto para dentro dela quebraria a promessa:
// esta rota fala com o Banco Central, e a de la nao fala com ninguem de fora.
// Um timeout do SGS passaria a atrasar -- ou derrubar -- a carteira inteira,
// inclusive para quem nao tem um centavo em renda fixa. Separada, a falha fica
// contida: o card de renda fixa diz "nao consegui falar com o Banco Central" e
// o resto da tela abre igual.
//
// O CALCULO NAO MORA AQUI. Ele esta em lib/renda-fixa.ts, puro, com suite
// propria (`npm run test:renda-fixa`) e prova de mutacao
// (`node scripts/mutantes-renda-fixa.mjs`). O que mora aqui e o recorte: quem
// sao os ativos, qual o principal de cada um e qual serie do SGS buscar.
//
// UMA REQUISICAO POR INDEXADOR, NAO POR ATIVO
// -------------------------------------------
// Cinco CDBs de CDI compartilham a mesma serie 12. Buscar por ativo faria cinco
// idas ao Banco Central para pedir a mesma coisa -- e, pior, cinco respostas que
// podem chegar de instantes diferentes, com a tela somando rendimentos de dias
// diferentes. A faixa pedida comeca na aplicacao MAIS ANTIGA do grupo e
// `diasNoPeriodo` recorta o resto por ativo.
//
// O RECORTE POR CONTA (?account_id=, HMO-436)
// -------------------------------------------
// Mesma leitura de /api/investments, e a mesma funcao: ausente e a renda fixa
// toda, com valor e so a daquela conta. Aqui o recorte tem um efeito a mais que
// vale notar -- ele diminui a faixa pedida ao Banco Central, porque
// `inicioPorIndexador` passa a olhar so os ativos do recorte. Isso e economia,
// nao mudanca de numero: `diasNoPeriodo` ja recortava por ativo.
// =====================================================

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const recorte = lerRecorteDeConta(
      new URL(request.url).searchParams.get("account_id")
    );
    if (!recorte.ok) {
      return NextResponse.json({ error: recorte.erro }, { status: 400 });
    }

    let consultaAtivos = supabase
      .from("investment_assets")
      // `account_id` (059) vem junto para a tela poder dizer de QUE conta e cada
      // projecao. Nomear a coluna exige a 059 colada em producao -- a mesma
      // armadilha de 42703 documentada em /api/investments.
      //
      // Uma linha so, sem concatenacao: o supabase-js le esta string em tempo de
      // TIPO. `"a, b" + "c, d"` nao e literal, o tipo da resposta cai para
      // `GenericStringError[]`, e o cast abaixo deixa de compilar.
      // prettier-ignore
      .select("id, symbol, name, type, currency, current_price, current_price_at, account_id, fixed_income_product, index_kind, index_percentage, spread_annual, applied_date, maturity_date")
      .eq("user_id", user.id)
      .eq("type", "fixed_income");

    if (recorte.tipo === "conta") {
      consultaAtivos = consultaAtivos.eq("account_id", recorte.account_id);
    } else if (recorte.tipo === "soltos") {
      consultaAtivos = consultaAtivos.is("account_id", null);
    }

    const { data: ativos, error: erroAtivos } = await consultaAtivos.order(
      "symbol",
      { ascending: true }
    );

    if (erroAtivos) {
      return NextResponse.json(
        { error: `Erro ao buscar ativos: ${erroAtivos.message}` },
        { status: 500 }
      );
    }

    const listaAtivos = (ativos || []) as Array<
      AtivoBruto & {
        account_id: string | null;
        fixed_income_product: string | null;
        index_kind: string | null;
        index_percentage: number | string | null;
        spread_annual: number | string | null;
        applied_date: string | null;
        maturity_date: string | null;
      }
    >;

    if (listaAtivos.length === 0) {
      return NextResponse.json({
        projections: [],
        summary: { bruto: 0, liquido: 0, porDia: 0, semProjecao: 0 },
        hoje: hojeEmBrasilia(),
      });
    }

    const { data: lancamentos, error: erroLancamentos } = await supabase
      .from("investment_transactions")
      .select("asset_id, kind, quantity, unit_price, fees, trade_date")
      .eq("user_id", user.id)
      .in(
        "asset_id",
        listaAtivos.map((a) => a.id)
      )
      .order("trade_date", { ascending: true });

    if (erroLancamentos) {
      return NextResponse.json(
        { error: `Erro ao buscar lancamentos: ${erroLancamentos.message}` },
        { status: 500 }
      );
    }

    const listaLancamentos = (lancamentos || []) as LancamentoBruto[];

    // O principal e o CUSTO da posicao, e ele vem de lib/investments.ts e nao de
    // uma soma local: aquele arquivo e quem sabe que taxa entra no custo e que
    // venda baixa pelo custo medio. Uma segunda implementacao aqui divergiria no
    // primeiro resgate parcial.
    const posicoes = calcularPosicoes(
      listaAtivos as AtivoBruto[],
      listaLancamentos
    );
    const principalPorAtivo: Record<string, number> = {};
    for (const p of posicoes) principalPorAtivo[p.asset_id] = p.total_invested;

    const primeiraCompra = primeiraCompraPorAtivo(
      listaLancamentos as Array<{
        asset_id: string;
        kind: string;
        trade_date: string;
      }>
    );

    const hoje = hojeEmBrasilia();

    // Agrupa por indexador e guarda a aplicacao mais antiga de cada grupo -- e
    // ela que define a borda esquerda da faixa pedida ao SGS.
    const inicioPorIndexador: Record<string, string> = {};
    for (const a of listaAtivos) {
      const ix = indexadorValido(a.index_kind);
      if (!ix) continue;
      const inicio = a.applied_date || primeiraCompra[a.id] || null;
      if (!inicio) continue;
      const atual = inicioPorIndexador[ix];
      if (!atual || inicio < atual) inicioPorIndexador[ix] = inicio;
    }

    const serieDoIndexador: Record<string, DiaDaSerie[]> = {};
    // `Object.keys` e nao `for...of` em entries: o target do tsconfig deste
    // projeto e anterior ao ES2017 e `Object.entries` nao esta na lib padrao.
    for (const ix of Object.keys(inicioPorIndexador)) {
      const r = await serieDoPeriodo(ix, inicioPorIndexador[ix], hoje);
      // Falha do Banco Central nao derruba a resposta: o ativo daquele indexador
      // sai com `motivo: "indisponivel"` -- ver projetarRendimento, que trata
      // serie vazia assim. A tela diz qual e o caso.
      if (r.ok) serieDoIndexador[ix] = r.serie;
    }

    const projections: Projecao[] = listaAtivos.map((ativo) => {
      const ix = indexadorValido(ativo.index_kind);
      return projetarRendimento({
        ativo,
        principal: principalPorAtivo[ativo.id] ?? 0,
        serie: ix ? serieDoIndexador[ix] || [] : [],
        primeiraCompra: primeiraCompra[ativo.id] || null,
        hoje,
      });
    });

    // `account_id` entra na resposta AQUI, e nao em `Projecao`.
    //
    // lib/renda-fixa.ts e uma calculadora de rendimento: ela sabe de indexador,
    // dia util e aliquota de IR, e nao tem nada a ver com conta bancaria.
    // Alargar `Projecao` para carregar o elo faria a assinatura de
    // `projetarRendimento` pedir um campo que ela nao usa em nenhuma conta --
    // e aquele arquivo e medido por mutante, entao o custo de mexer nele sem
    // precisar nao e so de leitura.
    //
    // O `somarProjecoes` recebe as projecoes SEM o campo, de proposito: o
    // resumo soma dinheiro e o elo nao e dinheiro.
    const contaPorAtivo: Record<string, string | null> = {};
    for (const a of listaAtivos) contaPorAtivo[a.id] = a.account_id ?? null;

    return NextResponse.json({
      projections: projections.map((p) => ({
        ...p,
        account_id: contaPorAtivo[p.asset_id] ?? null,
      })),
      summary: somarProjecoes(projections),
      hoje,
    });
  } catch (error) {
    console.error("Erro em GET /api/investments/renda-fixa:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
