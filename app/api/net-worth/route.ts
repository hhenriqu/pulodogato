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
//
// A CARTEIRA ENTRA NO PATRIMONIO (HMO-437)
// ----------------------------------------
// Ate esta fase o patrimonio era `financial_accounts.current_balance` e nada
// mais: o rendimento de renda fixa era calculado, exibido num card e morria ali.
// Para "ver o patrimonio crescer" era preciso editar o saldo da Conta
// Investimento a mao.
//
// Agora a conta de investimento COM ativo atrelado (migration 059) vale o que a
// carteira vale -- `principal + rendimento bruto`, derivado na LEITURA, por
// funcao pura. O `current_balance` dela continua na resposta como
// `saldoInformado` e para de entrar no total; conta SEM ativo atrelado nao muda
// em nada. A substituicao e a Decisao 1(A) do plano da HMO-432, e a razao de ela
// ser substituicao e nao soma e a dupla contagem: somar as duas imprimiria um
// patrimonio maior com cara de certo.
//
// NENHUMA ESCRITA DE SALDO ACONTECE AQUI (Decisao 3). As triggers legadas de
// saldo deste banco ja perderam dinheiro; esta rota le, soma e responde.
//
// A FALHA DA CARTEIRA DEGRADA, como a da linha do tempo: sem a 059 colada, sem
// Banco Central ou com erro de leitura, o patrimonio volta a sair so dos saldos
// e o `caveat` diz isso. O numero de hoje e a tela; a carteira e a parte nova.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { janelaDeMeses, completarPatrimonio } from "@/lib/services/reports";
import {
  avisoDoPatrimonio,
  consolidar,
  comVariacao,
  resumoDaJanela,
  type CarteiraDaConta,
  type ContaBruta,
} from "@/lib/net-worth";
import { contasQueSomam } from "@/lib/contas";
import { lerCarteiraDoPatrimonio } from "@/lib/services/carteira-da-conta";

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

    if (erroContas) {
      console.error("Erro ao ler as contas do patrimônio:", erroContas);
      return NextResponse.json(
        { error: "Não foi possível montar o patrimônio" },
        { status: 500 }
      );
    }

    // A CONTA DESLIGADA SAI DO PATRIMONIO (HMO-431).
    //
    // O recorte e aqui, e nao dentro de `consolidar`, porque `lib/net-worth.ts`
    // soma o que recebe -- ele nao decide quem entra. Enfiar o criterio la
    // dentro obrigaria `ContaBruta` a carregar o campo e espalharia a regra por
    // mais um arquivo; `contasQueSomam` e a unica definicao, e ela mora em
    // lib/contas.ts.
    const queSomam = contasQueSomam(contas ?? []);

    // A CARTEIRA, se houver. Ler ANTES de consolidar porque ela decide o saldo
    // das contas de investimento atreladas -- e nao DEPOIS, somando por fora,
    // que seria a dupla contagem escrita de outro jeito.
    const leitura = await lerCarteiraDoPatrimonio(supabase, user.id);
    const carteira: CarteiraDaConta[] = leitura.ok
      ? leitura.carteira.porConta
      : [];

    const consolidado = consolidar(queSomam as ContaBruta[], carteira);

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
        // O numero grande e o BRUTO (Decisao 2) e o liquido vai ao lado. O
        // liquido nao pode ser o numero grande: a aliquota de IR cai nas bordas
        // de 180/360/720 dias, entao o patrimonio SUBIRIA sozinho na virada de
        // um desses dias, sem aporte nenhum e sem nada para explicar o salto.
        net_worth_after_tax: consolidado.patrimonioDescontandoIr,
        estimated_tax: consolidado.irEstimado,
        // De onde veio cada parte, em numero e nao em prosa: a tela abre o
        // numero grande nestas duas parcelas, e `informed_balance_ignored` e a
        // evidencia de que a substituicao aconteceu -- sem ele, um total maior
        // que o esperado nao se distingue de um saldo que subiu.
        portfolio_value: consolidado.totalEmCarteira,
        informed_balance_ignored: consolidado.saldoInformadoIgnorado,
      },
      classes: consolidado.classes,
      // A carteira que ninguem atrelou. Ela NAO esta no total -- nem podia
      // estar, porque nao pertence a conta nenhuma -- e por isso vai separada e
      // com aviso: e o estado de todo ativo cadastrado antes da 059.
      portfolio: {
        available: leitura.ok,
        reason: leitura.ok ? null : leitura.motivo,
        unlinked_value: leitura.ok ? (leitura.carteira.solta?.valor ?? 0) : 0,
        without_yield: leitura.ok ? leitura.carteira.semRendimento : 0,
        without_price: leitura.ok ? leitura.carteira.semPreco : 0,
        indexes_unavailable: leitura.ok
          ? leitura.carteira.indexadoresSemBoletim
          : [],
        as_of: leitura.ok ? leitura.carteira.hoje : null,
      },
      months: comVariacao(linhas),
      window_summary: resumoDaJanela(linhas),
      history_available: historicoDisponivel,
      caveat: avisoDoPatrimonio(consolidado, {
        // Carteira VAZIA conta como lida: quem nunca cadastrou ativo nao tem o
        // que ser avisado, e um aviso permanente ali e como se aprende a nao ler
        // aviso nenhum.
        carteiraLida: leitura.ok || leitura.motivo === "vazia",
        indexadoresSemBoletim: leitura.ok
          ? leitura.carteira.indexadoresSemBoletim
          : [],
        carteiraSolta: leitura.ok ? (leitura.carteira.solta?.valor ?? 0) : 0,
      }),
      window: { from: janela.inicio, to: janela.fim, months: janela.meses },
    });
  } catch (error) {
    console.error("Erro na API de patrimônio:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
