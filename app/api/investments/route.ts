import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { lerRecorteDeConta } from "@/lib/conta-do-ativo";
import {
  calcularPosicoes,
  posicoesAbertas,
  resumirCarteira,
  alocacaoPorTipo,
  evolucaoMensal,
  type AtivoBruto,
  type LancamentoBruto,
} from "@/lib/investments";

// =====================================================
// GET /api/investments
// =====================================================
// Tudo o que a tela de investimentos precisa, numa resposta: os ativos, a
// posicao consolidada, o resumo, a alocacao por tipo e a evolucao mensal.
//
// Por que UMA rota em vez de quatro: os quatro numeros saem do MESMO par de
// leituras. Quebrar em quatro rotas faria a tela abrir com quatro idas ao banco
// e -- pior -- permitiria que duas delas lessem o banco em instantes
// diferentes, com o usuario vendo um "Valor Atual" que nao fecha com a soma da
// tabela logo abaixo. Ninguem reporta isso como bug; a pessoa so deixa de
// confiar na tela.
//
// O CALCULO NAO MORA AQUI. Ele esta em lib/investments.ts, puro, com suite
// propria no db-verify (`npm run test:investments`) e prova de mutacao
// (`node scripts/mutantes-investments.mjs`). Nenhum erro dessa aritmetica
// levanta excecao -- ver o cabecalho daquele arquivo.
//
// E ESTA ROTA CONTINUA PROIBIDA DE FALAR COM O BANCO CENTRAL
// ----------------------------------------------------------
// A promessa acima -- os quatro numeros saindo do mesmo par de leituras -- tem
// um preco: nenhuma chamada para fora entra aqui. Um timeout do SGS passaria a
// derrubar a carteira inteira, inclusive a de quem nao tem um centavo em renda
// fixa. `GET /api/investments/renda-fixa` segue sendo a UNICA rota que sai para
// fora, e a composicao das duas acontece na TELA, nunca no servidor. A sonda
// desta fase mede isso por ausencia: ela afirma que o emit desta rota nao
// referencia lib/cdi.
//
// O RECORTE POR CONTA (?account_id=, HMO-436)
// -------------------------------------------
// Ausente devolve a carteira inteira, como sempre. Com valor, a resposta e a
// carteira DAQUELA conta -- e ai o recorte vale para os lancamentos tambem, nao
// so para a lista de ativos: `evolution` e `summary` saem dos lancamentos, e
// recortar so os ativos imprimiria a evolucao da carteira TODA ao lado da lista
// de uma conta. Nada nessa discordancia levanta excecao; e um grafico que nao
// fecha com a tabela embaixo dele.
// =====================================================

/**
 * A linha de `investment_assets` como ESTA rota a le: `AtivoBruto` mais o que o
 * `select` abaixo traz a mais, para a tela poder editar.
 *
 * O tipo e local em vez de uma coluna nova em `AtivoBruto` porque e assim que
 * /api/investments/renda-fixa ja declara os campos da 031 -- e porque
 * `lib/investments.ts` tem ancora de mutante, e alargar a interface de la por
 * conveniencia de uma rota move a superficie que aquele runner mede.
 */
type AtivoDaCarteira = AtivoBruto & {
  account_id: string | null;
  fixed_income_product: string | null;
  index_kind: string | null;
  index_percentage: number | string | null;
  spread_annual: number | string | null;
  applied_date: string | null;
  maturity_date: string | null;
};

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
      // Os seis campos da 031 vem junto para a TELA PODER EDITA-LOS, e
      // `account_id` (059) pelo mesmo motivo: a tela da Fase 3 precisa saber a
      // que conta cada ativo esta atrelado para oferecer trocar ou soltar. A
      // conta de rendimento nao sai daqui -- ela e de
      // /api/investments/renda-fixa, que e a unica que fala com o Banco Central
      // (HMO-192).
      //
      // Nomear `account_id` aqui exige a 059 COLADA em producao, nao so
      // mergeada: a coluna ausente responde `42703` e derruba esta rota inteira
      // com 500 -- ver
      // `select-que-nomeia-coluna-nova-derruba-a-rota-antes-da-colagem`, que foi
      // escrita por causa deste mesmo erro na 058. Medido pelo PostgREST antes
      // deste PR: `select=account_id` responde 42501 (existe, barrado no
      // privilegio) contra o controle `select=symbol`, tambem 42501, e uma
      // coluna inventada, 42703.
      //
      // Uma linha so, sem concatenacao: o supabase-js LE esta string em tempo de
      // tipo para montar o tipo da resposta, e `"a, b" + "c, d"` nao e um
      // literal -- ele cai para `GenericStringError[]` e o cast abaixo passa a
      // ser um erro de compilacao ("neither type sufficiently overlaps").
      // Quebrar esta linha para caber na margem reprova o tsc.
      // prettier-ignore
      .select("id, symbol, name, type, currency, current_price, current_price_at, account_id, fixed_income_product, index_kind, index_percentage, spread_annual, applied_date, maturity_date")
      .eq("user_id", user.id);

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

    const listaAtivos = (ativos || []) as AtivoDaCarteira[];

    let lancamentos: unknown[] | null = [];
    let erroLancamentos: { message: string } | null = null;

    // Com recorte e zero ativo, nao ha o que consultar -- e `.in("asset_id",
    // [])` nao e uma pergunta que valha fazer ao banco. A resposta sai com a
    // mesma FORMA de sempre (listas vazias e resumo zerado vindos das mesmas
    // funcoes), e nao com um corpo especial que a tela teria de saber ler.
    if (recorte.tipo === "sem-recorte" || listaAtivos.length > 0) {
      let consultaLancamentos = supabase
        .from("investment_transactions")
        .select("id, asset_id, kind, quantity, unit_price, fees, trade_date, notes")
        .eq("user_id", user.id);

      // Sem recorte a consulta fica IDENTICA a de antes desta fase, sem `.in`:
      // a carteira inteira nao precisa da lista de ids, e mandar uma lista com
      // todos os ativos do usuario trocaria uma consulta simples por uma URL
      // que cresce com a carteira.
      if (recorte.tipo !== "sem-recorte") {
        consultaLancamentos = consultaLancamentos.in(
          "asset_id",
          listaAtivos.map((a) => a.id)
        );
      }

      const r = await consultaLancamentos.order("trade_date", {
        ascending: true,
      });
      lancamentos = r.data;
      erroLancamentos = r.error;
    }

    if (erroLancamentos) {
      return NextResponse.json(
        { error: `Erro ao buscar lancamentos: ${erroLancamentos.message}` },
        { status: 500 }
      );
    }

    const listaLancamentos = (lancamentos || []) as LancamentoBruto[];

    const posicoes = calcularPosicoes(listaAtivos, listaLancamentos);

    return NextResponse.json({
      assets: listaAtivos,
      transactions: lancamentos || [],
      // A tabela da tela recebe so o que o usuario ainda tem. As encerradas
      // continuam no resumo (proventos e realizado) -- ver resumirCarteira.
      positions: posicoesAbertas(posicoes),
      summary: resumirCarteira(posicoes),
      allocation: alocacaoPorTipo(posicoes),
      evolution: evolucaoMensal(listaLancamentos, 12),
    });
  } catch (error) {
    console.error("Erro em GET /api/investments:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
