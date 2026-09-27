// GET /api/cash-flow?dias=90&gastoDiario=62.50
//
// "Em que dia o meu saldo fica negativo?" A aritmetica inteira -- e cada
// armadilha dela -- mora em lib/cash-flow-forecast.ts, com teste unitario
// proprio. Aqui so ha busca de linha e traducao de formato.
//
// E leitura pura: nao existe tabela de fluxo previsto e nao deve existir. A
// linha muda a cada conta paga, a cada compra e a cada varredura do detector,
// e uma tabela precisaria de trigger em financial_transactions, em
// scheduled_transactions, em detected_recurrences e no saldo das contas para
// nao mentir. Mesmo criterio da /api/projection e da /api/safe-to-spend.
//
// NAO CONFUNDIR COM /api/reports/cash-flow, que ja existe e olha para TRAS:
// entrada, saida e resultado dos meses FECHADOS, saindo da view
// monthly_cash_flow (008). Esta aqui olha para a FRENTE e nao le transacao
// nenhuma -- as duas respondem perguntas opostas e nao compartilham codigo.
//
// Por que materializa a agenda antes de somar: as ocorrencias futuras das
// regras recorrentes sao criadas sob demanda (lib/services/scheduled.ts). Sem
// este passo o aluguel do mes que vem pode simplesmente nao existir como
// linha, e a previsao mostraria um saldo confortavel ate o fim do horizonte --
// o pior sentido para errar numa tela cujo produto e uma DATA.
//
// -----------------------------------------------------------------------
// AS CHAVES COMPROMETIDAS, QUE E A PARTE DELICADA DESTA ROTA
// -----------------------------------------------------------------------
// A linha provavel desconta um gasto variavel diario (lib/variable-spend.ts).
// Para essa media nao cobrar de novo o que ja vira evento datado, ela exclui do
// historico as chaves de estabelecimento ja comprometidas -- e o conjunto
// montado AQUI e a unica coisa que mantem as duas metades coerentes.
//
// Entram duas fontes, e so duas:
//
//   * as assinaturas detectadas que a previsao projeta, ou seja exatamente a
//     mesma lista de `DETECTED`/`CONFIRMED` que alimenta o calculo. Reusar a
//     variavel, em vez de refazer a consulta, e o que impede os dois conjuntos
//     de divergirem quando alguem mudar o filtro de um lado so: uma assinatura
//     em `IGNORED` nao projeta evento e TEM que continuar dentro da media.
//
//   * as regras recorrentes ATIVAS, que geram conta prevista todo periodo.
//
// Conta prevista avulsa fica de fora de proposito -- ela acontece uma vez e a
// media fala de todo mes. Ver o cabecalho do lib/variable-spend.ts, que explica
// por que excluir de mais e pior que nao excluir.
//
// -----------------------------------------------------------------------
// A ABERTURA POR CATEGORIA NAO GANHOU PARAMETRO PROPRIO, E ISSO E DE PROPOSITO
// -----------------------------------------------------------------------
// A tela deixa mexer no valor de cada categoria, mas nao existe `?categoria[]=`
// aqui. O que chega continua sendo UM `?gastoDiario=`, recomposto no cliente
// pelo `gastoDiarioComAjustes` -- a mesma funcao pura que tem teste, chamada do
// outro lado do fio.
//
// A alternativa (mandar os ajustes e recompor no servidor) teria duas
// aritmeticas para o mesmo numero, uma em cada ponta, e a divergencia entre
// elas apareceria como uma tela que mostra um valor e um grafico que usa outro.
// Do jeito que esta, o servidor recebe o numero final, sane-o com o mesmo
// `gastoDiarioValido` de sempre e devolve em `cash_flow.gastoDiario` -- entao a
// tela desenha exatamente o que o calculo usou, sem uma segunda copia da regra.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { today } from "@/lib/recurrence";
import { materializarAgenda } from "@/lib/services/scheduled";
import {
  projetarFluxoDeCaixa,
  proximosEventos,
  horizonteValido,
  gastoDiarioValido,
  DIAS_PADRAO,
  type PrevistaParaFluxo,
  type RecorrenciaParaFluxo,
} from "@/lib/cash-flow-forecast";
import {
  calcularGastoVariavel,
  inicioDaJanela,
  type GastoVariavel,
  type TransacaoParaGastoVariavel,
} from "@/lib/variable-spend";
import { addDays, normalizeMerchant } from "@/lib/recurrence-detector";
import {
  COLUNAS_DA_TRANSACAO,
  MAX_TRANSACOES,
  nomesDasCategorias,
} from "@/lib/services/monthly-summary";

interface LinhaPrevista {
  id: string;
  description: string | null;
  amount: number | string;
  due_date: string;
  recurring_rule:
    | { transaction_type: string }
    | { transaction_type: string }[]
    | null;
}

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

    const url = new URL(request.url);
    // `dias` fora da faixa e CORRIGIDO, nao rejeitado: um 400 aqui transformaria
    // um parametro de tela (os botoes 30/60/90) numa fonte de erro para o
    // usuario, e o valor certo e obvio. A regra mora na funcao pura, com teste.
    const dias = horizonteValido(
      url.searchParams.has("dias") ? Number(url.searchParams.get("dias")) : DIAS_PADRAO
    );

    const hoje = today();
    const ate = addDays(hoje, dias - 1);

    try {
      await materializarAgenda(supabase, user.id, { de: hoje, ate });
    } catch (erroAgenda) {
      console.error("Fluxo de caixa seguiu sem materializar a agenda:", erroAgenda);
    }

    // `is_active` vem junto: a conta arquivada e excluida do saldo inicial
    // dentro do calculo. O cartao tambem vem, e tambem e excluido la -- aqui a
    // divida entra pela FATURA datada, nao pelo saldo. Ver a armadilha 2 do
    // lib/cash-flow-forecast.ts, que e a regra oposta a do "posso gastar".
    const { data: contas, error: erroContas } = await supabase
      .from("financial_accounts")
      .select("id, name, account_type, current_balance, is_active")
      .eq("user_id", user.id);

    if (erroContas) {
      console.error("Erro ao carregar contas:", erroContas);
      return NextResponse.json(
        { error: "Não foi possível carregar as contas" },
        { status: 500 }
      );
    }

    // Sem piso de data: uma conta que venceu no mes passado e nao foi paga
    // continua sendo dinheiro que vai sair, e o calculo a traz para hoje. O
    // teto e feito aqui porque o banco ja sabe filtrar por data.
    const { data: previstas, error: erroPrevistas } = await supabase
      .from("scheduled_transactions")
      .select(
        "id, description, amount, due_date, recurring_rule:recurring_rules(transaction_type)"
      )
      .eq("user_id", user.id)
      .eq("status", "pending")
      .lte("due_date", ate);

    if (erroPrevistas) {
      console.error("Erro ao carregar contas previstas:", erroPrevistas);
      return NextResponse.json(
        { error: "Não foi possível carregar as contas previstas" },
        { status: 500 }
      );
    }

    const paraCalculo: PrevistaParaFluxo[] = ((previstas ??
      []) as LinhaPrevista[]).map((p) => {
      const regra = Array.isArray(p.recurring_rule)
        ? p.recurring_rule[0]
        : p.recurring_rule;

      return {
        id: p.id,
        description: p.description,
        amount: p.amount,
        due_date: p.due_date,
        tipo: regra?.transaction_type === "income" ? "income" : "expense",
      };
    });

    // As assinaturas que o detector achou sozinho. `IGNORED` e `CANCELLED`
    // ficam de fora ja na consulta -- o filtro tambem esta dentro do calculo (e
    // tem teste la), e repetir aqui e o que evita trazer do banco a lista
    // inteira de tudo que o usuario ja mandou ignorar.
    const { data: recorrenciasBrutas, error: erroRecorrencias } = await supabase
      .from("detected_recurrences")
      .select(
        "id, merchant_key, display_name, avg_amount, frequency, next_expected_date, status"
      )
      .eq("user_id", user.id)
      .in("status", ["DETECTED", "CONFIRMED"]);

    // NAO devolve 500 quando a leitura das assinaturas falha, pelo mesmo
    // criterio da /api/safe-to-spend: perder uma parcela e ruim, perder a tela
    // inteira e pior. Mas aqui a omissao e PERIGOSA -- sem as assinaturas a
    // linha fica otimista e a data de mergulho atrasa, que e exatamente o erro
    // que esta tela existe para evitar.
    //
    // Por isso a rota nao cala: a flag sobe para a tela, que escreve um aviso
    // em vez de mostrar um numero mais bonito sem dizer por que.
    const recorrenciasIndisponiveis = Boolean(erroRecorrencias);
    if (erroRecorrencias) {
      console.error(
        "Fluxo de caixa seguiu SEM as assinaturas detectadas:",
        erroRecorrencias
      );
    }

    const recorrencias = (recorrenciasBrutas ?? []) as RecorrenciaParaFluxo[];

    // ---------------------------------------------------------------
    // O gasto variavel do dia a dia -- a segunda linha
    // ---------------------------------------------------------------
    const desde = inicioDaJanela(hoje);

    const [regras, transacoes, nomesDeCategoria] = await Promise.all([
      supabase
        .from("recurring_rules")
        .select("description")
        .eq("user_id", user.id)
        .eq("is_active", true),
      supabase
        .from("financial_transactions")
        .select(COLUNAS_DA_TRANSACAO)
        .eq("user_id", user.id)
        .eq("transaction_type", "expense")
        .gte("transaction_date", desde)
        // Teto EXPLICITO pelo mesmo motivo do lib/services/monthly-summary.ts:
        // o PostgREST pagina em silencio, e sem pedir o limite o truncamento
        // viraria uma media calculada sobre parte do historico, sem aviso.
        .limit(MAX_TRANSACOES),
      // O nome da categoria e so ROTULO: a abertura por categoria e calculada
      // por `category_id` e nao depende disto. Por isso o catch devolve `{}` em
      // vez de derrubar a rota -- a tela cai para o id, feia mas correta, e o
      // grafico nao muda em nada. (`nomesDasCategorias` lanca em erro de
      // leitura; sem o catch, uma falha ao ler uma tabela de ROTULOS levaria a
      // previsao inteira junto.)
      nomesDasCategorias(supabase).catch((erro) => {
        console.error("Fluxo de caixa seguiu sem os nomes de categoria:", erro);
        return {} as Record<string, string>;
      }),
    ]);

    // Ver o cabecalho: a lista de assinaturas e a MESMA que alimenta o calculo,
    // por variavel e nao por consulta nova.
    const chavesComprometidas = [
      ...recorrencias.map((r) => r.merchant_key),
      ...((regras.data ?? []) as { description: string | null }[]).map((r) =>
        normalizeMerchant(r.description ?? "")
      ),
    ].filter(Boolean);

    // Falha de leitura NAO derruba a tela -- mesmo criterio das assinaturas --
    // mas tambem nao passa calada: sem historico a linha provavel simplesmente
    // nao existe, e a tela precisa dizer isso em vez de mostrar uma linha so e
    // deixar o usuario achar que ela e a resposta completa.
    const gastoIndisponivel = Boolean(transacoes.error);
    if (transacoes.error) {
      console.error(
        "Fluxo de caixa seguiu SEM o gasto variavel:",
        transacoes.error
      );
    }

    const gastoVariavel: GastoVariavel = calcularGastoVariavel({
      transacoes: (transacoes.data ?? []) as unknown as TransacaoParaGastoVariavel[],
      chavesComprometidas,
      hoje,
      nomesDeCategoria,
    });

    // O ajuste do usuario (a media tem que ser VISIVEL e mudavel, ver o
    // cabecalho do lib/variable-spend.ts). Um valor fora de faixa e saneado
    // pela mesma funcao do calculo, entao a tela nunca ve um numero que o
    // grafico nao usou. `gastoDiario=0` e legitimo: e o usuario pedindo a linha
    // otimista de volta, e por isso o teste e `has`, nao "veio vazio".
    const ajustado = url.searchParams.has("gastoDiario")
      ? gastoDiarioValido(Number(url.searchParams.get("gastoDiario")))
      : null;

    const gastoDiario = ajustado ?? gastoVariavel.porDia;

    const fluxo = projetarFluxoDeCaixa({
      contas: contas ?? [],
      previstas: paraCalculo,
      recorrencias,
      hoje,
      dias,
      gastoDiario,
    });

    return NextResponse.json({
      today: hoje,
      recorrencias_indisponiveis: recorrenciasIndisponiveis,
      gasto_indisponivel: gastoIndisponivel,
      // A procedencia da media vai junto com ela: quantos meses a sustentam,
      // quais sao, e quanto foi descartado por ja estar comprometido. Sem isso
      // o usuario compara com o proprio extrato, acha a diferenca e conclui que
      // a conta esta errada -- quando ela esta certa por causa da diferenca.
      variable_spend: gastoVariavel,
      gasto_ajustado: ajustado !== null,
      gasto_truncado: (transacoes.data ?? []).length >= MAX_TRANSACOES,
      cash_flow: fluxo,
      // A lista de "o que vem por ai" sai pronta do servidor: o saldo ao lado
      // de cada linha e acumulado, e recalcula-lo no cliente seria uma segunda
      // versao da mesma regra -- a que deixa de acompanhar a primeira.
      upcoming: proximosEventos(fluxo, 40),
    });
  } catch (error) {
    console.error("Erro na API de fluxo de caixa:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
