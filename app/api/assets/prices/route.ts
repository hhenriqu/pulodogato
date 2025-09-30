import { NextRequest, NextResponse } from "next/server";

// Mock de dados de preços - em produção, isso seria integrado com uma API real
const mockPrices: { [key: string]: number } = {
  PETR4: 32.5,
  VALE3: 65.8,
  ITUB4: 26.75,
  BBDC4: 12.45,
  ABEV3: 14.2,
  HGLG11: 125.3,
  KNRI11: 98.5,
  BCFF11: 89.4,
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbols = searchParams.get("symbols")?.split(",") || [];

    if (symbols.length === 0) {
      return NextResponse.json(
        { error: "Símbolos são obrigatórios" },
        { status: 400 }
      );
    }

    const prices: { [key: string]: number } = {};

    symbols.forEach((symbol) => {
      // Simular preços - em produção, isso seria uma chamada para API externa
      prices[symbol] = mockPrices[symbol] || Math.random() * 100 + 10;
    });

    return NextResponse.json({ prices });
  } catch (error) {
    console.error("Erro na API de preços:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { symbol } = body;

    if (!symbol) {
      return NextResponse.json(
        { error: "Símbolo é obrigatório" },
        { status: 400 }
      );
    }

    // Simular busca de informações do ativo
    const assetInfo = {
      symbol: symbol.toUpperCase(),
      name: `Nome do ativo ${symbol}`,
      type: symbol.includes("11") ? "fii" : "stock",
      currency: "BRL",
      current_price:
        mockPrices[symbol.toUpperCase()] || Math.random() * 100 + 10,
    };

    return NextResponse.json({ asset: assetInfo });
  } catch (error) {
    console.error("Erro na API de preços:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
