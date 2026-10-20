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
  ordenarPorPercentualDoCdi,
  primeiraCompraPorAtivo,
  projetarRendimento,
  somarProjecoes,
} from "@/lib/renda-fixa";
import {
  SERIE_CDI_DIARIO,
  SERIE_DO_INDEXADOR,
  hojeEmBrasilia,
  serieDoPeriodo,
} from "@/lib/cdi";

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
// UMA REQUISICAO POR SERIE DO SGS, NAO POR ATIVO E NEM POR INDEXADOR
// -------------------------------------------------------------------
// Cinco CDBs de CDI compartilham a mesma serie 12. Buscar por ativo faria cinco
// idas ao Banco Central para pedir a mesma coisa -- e, pior, cinco respostas que
// podem chegar de instantes diferentes, com a tela somando rendimentos de dias
// diferentes. A faixa pedida comeca na aplicacao MAIS ANTIGA do grupo e
// `diasNoPeriodo` recorta o resto por ativo.
//
// O agrupamento e pela SERIE e nao pelo indexador porque `cdi` e `prefixado`
// usam os dois a serie 12 -- ver SERIE_DO_INDEXADOR em lib/cdi.ts. Agrupar por
// indexador traria a mesma serie duas vezes, e o mesmo defeito de instantes
// diferentes voltaria entre dois ativos da MESMA carteira (HMO-440).
//
// A REGUA DE COMPARACAO EXIGE A SERIE 12 SEMPRE
// ----------------------------------------------
// O "% do CDI realizado" (HMO-440) divide o rendimento do papel pelo que 100% do
// CDI deu na mesma janela, e e ele que poe "110% do CDI" e "prefixado 13% a.a."
// na mesma regua. Uma carteira so de Selic ou so de prefixado nao traria a serie
// 12 por conta propria, e e justamente ela que mais precisa da regua -- por isso
// a 12 entra na lista com a borda esquerda de TODAS as series em uso.
//
// O RECORTE POR CONTA (?account_id=, HMO-436)
// -------------------------------------------
// Mesma leitura de /api/investments, e a mesma funcao: ausente e a renda fixa
// toda, com valor e so a daquela conta. Aqui o recorte tem um efeito a mais que
// vale notar -- ele diminui a faixa pedida ao Banco Central, porque
// `inicioPorSerie` passa a olhar so os ativos do recorte. Isso e economia, nao
// mudanca de numero: `diasNoPeriodo` ja recortava por ativo.
//
// A regua tambem sobrevive ao recorte, e por construcao: a borda esquerda e o
// menor inicio DO RECORTE, entao a serie 12 continua cobrindo a janela de cada
// ativo que sobrou. O que muda e so o "% do CDI" da CARTEIRA no resumo, que
// passa a ser o daquela conta -- e e isso que a tela esta pedindo quando
// recorta. O "% do CDI" de cada LINHA nao muda com o recorte, porque ele e
// medido na janela do proprio papel.
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
        // `somarProjecoes([])` daria o mesmo, e o literal existe so para a rota
        // nao montar resposta nenhuma quando nao ha ativo. Campo novo no resumo
        // tem de entrar NOS DOIS lugares, senao a tela le `undefined` aqui e
        // numero la -- e `undefined` em `.toFixed` e TypeError no cliente.
        summary: somarProjecoes([]),
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

    // Agrupa pela SERIE DO SGS e guarda a aplicacao mais antiga de cada grupo --
    // e ela que define a borda esquerda da faixa pedida.
    //
    // Pela SERIE e nao pelo INDEXADOR: `cdi` e `prefixado` apontam os dois para
    // a serie 12 (ver SERIE_DO_INDEXADOR, em lib/cdi.ts, e o uso da serie como
    // CALENDARIO de dias uteis no prefixado). Agrupar por indexador pediria a
    // mesma serie 12 duas vezes, em faixas diferentes, e as duas respostas podem
    // chegar de instantes diferentes -- a armadilha que o comentario acima
    // descreve por ativo, um nivel acima: um boletim novo entre as duas chamadas
    // daria ao prefixado um dia util que o CDB ao lado nao teve.
    const inicioPorSerie: Record<string, string> = {};
    // Qual indexador representa cada serie na chamada -- `serieDoPeriodo` recebe
    // o nome do indexador e mapeia para o numero. O primeiro de
    // SERIE_DO_INDEXADOR que aponta para a serie serve, e a escolha e
    // deterministica porque a ordem das chaves do literal e fixa.
    const representanteDaSerie: Record<string, string> = {};

    for (const a of listaAtivos) {
      const inicio = a.applied_date || primeiraCompra[a.id] || null;
      if (!inicio) continue;
      const ix = indexadorValido(a.index_kind);
      if (!ix) continue;
      const numero = SERIE_DO_INDEXADOR[ix];
      if (!numero) continue;
      const chave = String(numero);
      if (!representanteDaSerie[chave]) representanteDaSerie[chave] = ix;
      const atual = inicioPorSerie[chave];
      if (!atual || inicio < atual) inicioPorSerie[chave] = inicio;
    }

    // A regua de comparacao e o CDI a 100%, e ela vale para TODO ativo que
    // projeta -- e um Selic ou um prefixado que mais precisam dela, e sao
    // exatamente os dois que nao trariam a serie 12 por conta propria. Por isso
    // a serie 12 entra na lista com a borda esquerda de TODAS as series, e nao
    // com a do grupo dela: um denominador que comeca depois da aplicacao do
    // ativo e parcial, e a razao sai alta e plausivel.
    // `rentabilidadeDoCdiNaJanela` confere a contagem e devolve "sem regua"
    // quando isto nao fecha, mas pedir a faixa certa e aqui.
    //
    // A borda sai de `inicioPorSerie` e nao da lista de ativos de proposito: um
    // IPCA de cinco anos atras nunca vai ter regua (ele responde `sem_fonte`),
    // e deixa-lo definir a borda pediria cinco anos de serie 12 ao Banco Central
    // em cada carregamento da tela, para nada.
    const chaves = Object.keys(inicioPorSerie);
    if (chaves.length > 0) {
      let borda = inicioPorSerie[chaves[0]];
      for (const c of chaves) {
        if (inicioPorSerie[c] < borda) borda = inicioPorSerie[c];
      }
      const chaveDoCdi = String(SERIE_CDI_DIARIO);
      if (!representanteDaSerie[chaveDoCdi]) {
        representanteDaSerie[chaveDoCdi] = "cdi";
      }
      inicioPorSerie[chaveDoCdi] = borda;
    }

    const serieDoNumero: Record<string, DiaDaSerie[]> = {};
    // `Object.keys` e nao `for...of` em entries: o target do tsconfig deste
    // projeto e anterior ao ES2017 e `Object.entries` nao esta na lib padrao.
    for (const chave of Object.keys(inicioPorSerie)) {
      const r = await serieDoPeriodo(
        representanteDaSerie[chave],
        inicioPorSerie[chave],
        hoje
      );
      // Falha do Banco Central nao derruba a resposta: o ativo daquela serie
      // sai com `motivo: "indisponivel"` -- ver projetarRendimento, que trata
      // serie vazia assim. A tela diz qual e o caso. E uma falha SO na serie 12
      // com a 11 de pe deixa o Selic com rendimento e sem regua, que tambem tem
      // frase propria.
      if (r.ok) serieDoNumero[chave] = r.serie;
    }

    const serieCdi = serieDoNumero[String(SERIE_CDI_DIARIO)] || null;

    const projections: Projecao[] = listaAtivos.map((ativo) => {
      const ix = indexadorValido(ativo.index_kind);
      const numero = ix ? SERIE_DO_INDEXADOR[ix] : undefined;
      return projetarRendimento({
        ativo,
        principal: principalPorAtivo[ativo.id] ?? 0,
        serie: numero ? serieDoNumero[String(numero)] || [] : [],
        serieCdi,
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

    // A ORDEM vem ANTES do `.map` do `account_id`, e a composicao nao e livre:
    // `ordenarPorPercentualDoCdi` recebe `Projecao[]` e o `.map` produz um objeto
    // MAIS LARGO que `Projecao`. Inverter os dois compila (o objeto largo
    // satisfaz o tipo), ordena certo e nao muda numero nenhum -- mas a ordem
    // passaria a depender de uma lista que ninguem mais trata como `Projecao[]`,
    // e e esse tipo de acoplamento silencioso que some numa leitura futura.
    //
    // A lista sai ordenada pela regua e nao por `symbol`: o pedido da HMO-432
    // termina em comparar rentabilidade, e o primeiro passo de comparar e ver os
    // dois extremos nas pontas. `somarProjecoes` nao depende da ordem, e por
    // isso ele continua recebendo `projections` como veio.
    return NextResponse.json({
      projections: ordenarPorPercentualDoCdi(projections).map((p) => ({
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
