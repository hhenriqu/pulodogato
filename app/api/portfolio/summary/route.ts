import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();

    // Verificar se o usuário está autenticado
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Buscar resumo do portfólio
    const { data: portfolioData, error: portfolioError } = await supabase.rpc(
      "get_portfolio_summary",
      { user_id: user.id }
    );

    if (portfolioError) {
      console.error("Erro ao buscar portfólio:", portfolioError);
      // Retornar dados simulados se a função RPC não existir
      return NextResponse.json({
        summary: {
          total_invested: 0,
          current_value: 0,
          total_profit_loss: 0,
          total_profit_loss_percentage: 0,
          total_dividends: 0,
          asset_allocation: {
            stock: 0,
            fii: 0,
            fixed_income: 0,
            international: 0,
          },
        },
        portfolio: [],
      });
    }

    // Buscar dividendos totais
    const { data: dividendsData, error: dividendsError } = await supabase
      .from("dividends")
      .select("amount_per_share, quantity")
      .eq("user_id", user.id);

    const totalDividends =
      dividendsData?.reduce((sum, dividend) => {
        return sum + dividend.amount_per_share * dividend.quantity;
      }, 0) || 0;

    // Calcular alocação por tipo de ativo
    const assetAllocation = {
      stock: 0,
      fii: 0,
      fixed_income: 0,
      international: 0,
    };

    let totalValue = 0;
    portfolioData?.forEach((item: any) => {
      const value = item.current_value || item.total_invested;
      totalValue += value;
      assetAllocation[item.type as keyof typeof assetAllocation] += value;
    });

    // Converter para percentuais
    Object.keys(assetAllocation).forEach((key) => {
      if (totalValue > 0) {
        assetAllocation[key as keyof typeof assetAllocation] =
          (assetAllocation[key as keyof typeof assetAllocation] / totalValue) *
          100;
      }
    });

    const summary = {
      total_invested:
        portfolioData?.reduce(
          (sum: number, item: any) => sum + item.total_invested,
          0
        ) || 0,
      current_value: totalValue,
      total_profit_loss:
        portfolioData?.reduce(
          (sum: number, item: any) => sum + (item.profit_loss || 0),
          0
        ) || 0,
      total_profit_loss_percentage: 0, // Será calculado no frontend
      total_dividends: totalDividends,
      asset_allocation: assetAllocation,
    };

    // Calcular percentual de lucro/prejuízo
    if (summary.total_invested > 0) {
      summary.total_profit_loss_percentage =
        (summary.total_profit_loss / summary.total_invested) * 100;
    }

    return NextResponse.json({
      summary,
      portfolio: portfolioData || [],
    });
  } catch (error) {
    console.error("Erro na API de portfólio:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
