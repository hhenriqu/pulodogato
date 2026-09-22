import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Endpoint público: nunca expor mensagens cruas do banco ou do Supabase.
// Detalhes ficam no log do servidor; o cliente recebe apenas ok/error.
export async function GET() {
  try {
    const supabase = createClient();

    // A sonda TEM de ser uma tabela que `anon` pode ler. Esta rota e publica,
    // entao roda sem sessao -- com a role `anon`.
    //
    // Ja foi `profiles`, e isso quebrou o health check em producao no dia em
    // que a 002_rls_lockdown subiu: ela faz
    // `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon` e so devolve
    // SELECT para duas tabelas de referencia. `profiles` nao e uma delas, e as
    // policies dela sao `TO authenticated`. Resultado: permission denied ->
    // 503 permanente, com o banco inteiramente saudavel. Alarme falso.
    //
    // `transaction_categories` tem GRANT SELECT explicito para anon na 002
    // (conferido em producao), entao ela mede o que a rota quer medir: se a
    // app alcanca o Postgres -- nao se a role tem privilegio.
    const { error: connectionError } = await supabase
      .from("transaction_categories")
      .select("id")
      .limit(1);

    if (connectionError) {
      console.error("Health check: database connection failed", connectionError);
      return NextResponse.json(
        {
          status: "error",
          message: "Database connection failed",
          timestamp: new Date().toISOString(),
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      status: "ok",
      message: "Database connection successful",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Health check error:", error);
    return NextResponse.json(
      {
        status: "error",
        message: "Health check failed",
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
