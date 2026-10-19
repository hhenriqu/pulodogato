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
import { mesesDoPeriodo, periodoDaQuery } from "@/lib/periodo-do-painel";
import { contasQueSomam } from "@/lib/contas";

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

    const params = new URL(request.url).searchParams;

    // HMO-173: o painel navega para o passado e precisa do patrimonio no FIM
    // do periodo, que e o unico numero de saldo que existe para um mes que ja
    // terminou. A view tem grao de mes; um `ate` no meio do mes e arredondado
    // para o mes inteiro a que ele pertence, e quem chama sabe disso -- o
    // painel so pergunta em modo mes.
    const periodo = periodoDaQuery(
      params.get("de") ?? params.get("from"),
      params.get("ate") ?? params.get("to")
    );

    if (periodo === "invalido") {
      return NextResponse.json(
        { error: "de e ate devem ser datas AAAA-MM-DD, com de <= ate" },
        { status: 400 }
      );
    }

    const janela = periodo
      ? {
          inicio: `${periodo.de.slice(0, 7)}-01`,
          fim: `${periodo.ate.slice(0, 7)}-01`,
          meses: mesesDoPeriodo(periodo).length,
        }
      : janelaDeMeses(params.get("months"));

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

    const { data: contasBrutas } = await supabase
      .from("financial_accounts")
      .select(
        // `*` E NAO A LISTA DE COLUNAS, e o motivo e uma ordem de deploy
        // (HMO-431). Nomear `include_in_total` aqui faz o PostgREST responder
        //
        //     42703  column financial_accounts.include_in_total does not exist
        //
        // em qualquer banco que ainda nao recebeu a migration 058 -- e a 058 e
        // colada A MAO no SQL Editor, depois do deploy do codigo. MEDIDO em
        // producao em 2026-10-19: a coluna respondia 42703 enquanto `is_active`
        // respondia 42501 (permissao), o que prova que o 42703 e resolucao de
        // NOME e nao RLS. Com a lista nomeada, esta rota inteira responderia 500
        // na janela entre o deploy e a colagem.
        //
        // `*` nao nomeia coluna nenhuma: ele traz o campo quando ele existe e
        // simplesmente nao o traz quando nao existe. Ai `include_in_total` chega
        // `undefined`, e `contasQueSomam` trata ausente como "soma" -- o
        // comportamento de antes da feature, que e exatamente o que se quer
        // nessa janela.
        //
        // NAO troque por `.eq("include_in_total", true)` tampouco: um filtro tem
        // o mesmo 42703 do select nomeado, e ainda por cima descartaria a linha
        // em vez de derrubar a rota -- um total silenciosamente menor e pior que
        // um 500.
        "*"
      )
      .eq("user_id", user.id)
      .order("current_balance", { ascending: false });

    // A CONTA DESLIGADA SAI DO PATRIMONIO DO RELATORIO (HMO-431).
    //
    // O MESMO recorte da rota /api/net-worth, de proposito: as duas respondem
    // "quanto eu tenho", e divergir aqui poria dois numeros diferentes para a
    // mesma pergunta em duas telas -- o defeito que `contasQueSomam` existe
    // para impedir.
    //
    // E ele vale para o `atual` E para a lista `accounts` devolvida abaixo:
    // mostrar na tela uma conta que nao esta somada no total faria o leitor
    // somar na mao e encontrar um numero diferente do que a tela imprime.
    const contas = contasQueSomam(contasBrutas ?? []);

    const atual = contas.reduce(
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
