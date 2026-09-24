// GET /api/net-worth?months=12
//
// Patrimonio liquido consolidado: o numero de hoje aberto em classes (liquido,
// investimento e divida) e a linha do tempo mes a mes.
//
// Por que existe separada de /api/reports/net-worth: aquela rota responde
// "como o patrimonio andou" e mora atras do plano de relatorios avancados.
// Esta responde "de que ele e feito HOJE", que e a pergunta de quem quer saber
// quanto esta aplicado e quanto deve -- e nao cobra plano, porque so le contas
// que o usuario ja cadastrou. As duas partem da MESMA view e do MESMO
// preenchimento (`completarPatrimonio`), entao os dois graficos nao podem
// divergir.
//
// O aviso do `caveat` vai junto de proposito. O NIVEL do patrimonio herda o que
// estiver em `current_balance` hoje; se o saldo derivou, a curva inteira se
// desloca. Esconder isso faria o usuario decidir sobre um numero que o proprio
// app sabe que pode estar errado.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { janelaDeMeses, completarPatrimonio } from "@/lib/services/reports";
import {
  consolidar,
  comVariacao,
  resumoDaJanela,
  type ContaBruta,
} from "@/lib/net-worth";

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

    const { data: contas, error: erroContas } = await supabase
      .from("financial_accounts")
      .select("id, name, account_type, current_balance, is_active, color_hex")
      .eq("user_id", user.id)
      .order("current_balance", { ascending: false });

    if (erroContas) {
      console.error("Erro ao ler as contas do patrimônio:", erroContas);
      return NextResponse.json(
        { error: "Não foi possível montar o patrimônio" },
        { status: 500 }
      );
    }

    const consolidado = consolidar((contas ?? []) as ContaBruta[]);

    // A linha do tempo DEGRADA em vez de derrubar a tela. `net_worth_history`
    // nasceu na migration 008; se ela nao estiver aplicada no banco, a leitura
    // falha com 42P01 e a rota inteira responderia 500 -- levando junto o
    // consolidado de hoje, que ja esta calculado e nao depende da view.
    //
    // Este e o mesmo defeito que a tela de extrato teve com a 014 (PR #26): o
    // enfeite derrubando a tela. Aqui a linha do tempo e o enfeite; o numero de
    // hoje e a tela.
    let linhas: { month: string; net_change: number; net_worth: number }[] = [];
    let historicoDisponivel = true;

    const { data: historico, error: erroHistorico } = await supabase
      .from("net_worth_history")
      .select("month, net_change, net_worth")
      .eq("user_id", user.id)
      .gte("month", janela.inicio)
      .lte("month", janela.fim)
      .order("month", { ascending: true });

    if (erroHistorico) {
      console.error(
        "Patrimônio: linha do tempo indisponível, seguindo só com o consolidado:",
        erroHistorico
      );
      historicoDisponivel = false;
    } else {
      linhas = completarPatrimonio(
        (historico ?? []).map((d) => ({
          month: String(d.month).slice(0, 10),
          net_change: Number(d.net_change),
          net_worth: Number(d.net_worth),
        })),
        janela.inicio,
        janela.meses
      );
    }

    return NextResponse.json({
      // O consolidado sai do saldo das contas AGORA. A linha do tempo sai da
      // view, que reconstroi o passado a partir desse MESMO saldo -- entao os
      // dois lados da tela partem da mesma origem e nao podem divergir por
      // arredondamento.
      //
      // Eles coincidem no ultimo ponto sempre que nao houver lancamento com
      // data FUTURA. A view calcula `net_worth(M) = saldo_hoje - (tudo que se
      // moveu depois de M)`; uma transacao datada para o mes que vem cai fora
      // da janela, e o ultimo ponto fica menor que o numero grande pelo valor
      // dela. Nao e erro de nenhum dos dois: o numero grande e o saldo que as
      // contas tem hoje, e a curva so desenha ate o mes corrente.
      summary: {
        net_worth: consolidado.patrimonioLiquido,
        total_assets: consolidado.totalAtivos,
        total_debts: consolidado.totalDividas,
        archived_balance: consolidado.totalInativas,
      },
      classes: consolidado.classes,
      months: comVariacao(linhas),
      window_summary: resumoDaJanela(linhas),
      history_available: historicoDisponivel,
      caveat:
        "A variação mês a mês vem das transações e é exata. O nível parte do saldo atual das contas, que é mantido por trigger — se o saldo tiver derivado, a curva inteira se desloca junto.",
      window: { from: janela.inicio, to: janela.fim, months: janela.meses },
    });
  } catch (error) {
    console.error("Erro na API de patrimônio:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
