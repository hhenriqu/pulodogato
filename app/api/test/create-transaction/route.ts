import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    // Simular criação de transação com grupo
    const testTransaction = {
      description: "Teste automático - Almoço com grupo",
      amount: 50.0,
      transaction_date: new Date().toISOString().split("T")[0],
      category_id: "transaction_categories", // Você precisa usar uma categoria real
      group_id: "4661ff8c-6b43-48c0-881d-57bd36d9875d", // testereaaa
      transaction_type: "expense",
      notes: "Teste de integração automática",
    };

    console.log("🧪 Testando criação de transação com grupo:", testTransaction);

    // Fazer request para a API real
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SITE_URL}/api/personal-finance/transactions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: request.headers.get("cookie") || "", // Passar cookies de autenticação
        },
        body: JSON.stringify(testTransaction),
      }
    );

    const result = await response.json();

    return NextResponse.json({
      success: response.ok,
      testData: testTransaction,
      apiResponse: result,
      status: response.status,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}
