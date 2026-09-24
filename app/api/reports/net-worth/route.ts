// GET /api/reports/net-worth?months=12
//
// Evolucao do patrimonio. Sai de `net_worth_history` (008), que reconstroi o
// passado ANDANDO PARA TRAS a partir do saldo de hoje -- o banco nao guarda
// historico de saldo.
//
// Por isso a resposta carrega `caveat`. A VARIACAO mes a mes e exata (ela vem
// so das transacoes); o NIVEL herda qualquer erro que exista hoje em
// current_balance. Ate o 007 ser aplicado em producao, o saldo derivava a cada
// edicao de lancamento, e a curva inteira sobe ou desce junto com a deriva.
// A tela mostra o aviso; escondê-lo faria o usuario tomar decisao sobre um
// numero que o proprio app sabe que pode estar errado.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { janelaDeMeses, completarPatrimonio } from "@/lib/services/reports";

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const janela = janelaDeMeses(
      new URL(request.url).searchParams.get("months")
    );

    if (!janela) {
      return NextResponse.json(
        { error: "months deve ser um inteiro entre 1 e 60" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("net_worth_history")
      .select("month, net_change, net_worth")
      .eq("user_id", user.id)
      .gte("month", janela.inicio)
      .lte("month", janela.fim)
      .order("month", { ascending: true });

    if (error) {
      console.error("Erro no relatório de patrimônio:", error);
      return NextResponse.json(
        { error: "Não foi possível montar o relatório" },
        { status: 500 }
      );
    }

    const brutas = (data ?? []).map((d) => ({
      month: String(d.month).slice(0, 10),
      net_change: Number(d.net_change),
      net_worth: Number(d.net_worth),
    }));

    // Preenchimento para a FRENTE, e nao o completarMeses() das outras rotas:
    // o mes vazio herda o ultimo patrimonio conhecido. O porque esta em
    // `completarPatrimonio`, que /api/net-worth tambem usa -- duas copias
    // desta regra iam divergir, e a divergencia apareceria como dois graficos
    // do mesmo numero com formatos diferentes.
    const linhas = completarPatrimonio(brutas, janela.inicio, janela.meses);

    const { data: contas } = await supabase
      .from("financial_accounts")
      .select("id, name, account_type, current_balance, is_active, color_hex")
      .eq("user_id", user.id)
      .order("current_balance", { ascending: false });

    const atual = (contas ?? []).reduce(
      (s, c) => s + Number(c.current_balance ?? 0),
      0
    );

    const primeiro = linhas.length ? linhas[0].net_worth : 0;

    return NextResponse.json({
      months: linhas,
      accounts: contas ?? [],
      summary: {
        current: Number(atual.toFixed(2)),
        change_in_window: Number((atual - primeiro).toFixed(2)),
        total_saved: Number(
          linhas.reduce((s, l) => s + Math.max(l.net_change, 0), 0).toFixed(2)
        ),
      },
      caveat:
        "A variação mês a mês vem das transações e é exata. O nível da curva parte do saldo atual das contas, que é mantido por trigger — se o saldo tiver derivado, a curva inteira se desloca junto.",
      window: { from: janela.inicio, to: janela.fim, months: janela.meses },
    });
  } catch (error) {
    console.error("Erro na API de relatórios:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
