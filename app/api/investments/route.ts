import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
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
// =====================================================

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: ativos, error: erroAtivos } = await supabase
      .from("investment_assets")
      .select(
        "id, symbol, name, type, currency, current_price, current_price_at"
      )
      .eq("user_id", user.id)
      .order("symbol", { ascending: true });

    if (erroAtivos) {
      return NextResponse.json(
        { error: `Erro ao buscar ativos: ${erroAtivos.message}` },
        { status: 500 }
      );
    }

    const { data: lancamentos, error: erroLancamentos } = await supabase
      .from("investment_transactions")
      .select("id, asset_id, kind, quantity, unit_price, fees, trade_date, notes")
      .eq("user_id", user.id)
      .order("trade_date", { ascending: true });

    if (erroLancamentos) {
      return NextResponse.json(
        { error: `Erro ao buscar lancamentos: ${erroLancamentos.message}` },
        { status: 500 }
      );
    }

    const listaAtivos = (ativos || []) as AtivoBruto[];
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
