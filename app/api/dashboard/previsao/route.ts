// GET /api/dashboard/previsao?de=AAAA-MM-DD&ate=AAAA-MM-DD
//
// "Quanto ainda vou gastar e ainda vou receber ate o fim do periodo escolhido."
// A outra metade -- o que JA aconteceu -- continua saindo de
// /api/reports/cash-flow, e e o painel que soma as duas (HMO-174).
//
// POR QUE ESTA ROTA NAO CALCULA O REALIZADO TAMBEM
// ------------------------------------------------
// Porque o realizado ja tem dono. Devolve-lo aqui criaria a segunda versao do
// mesmo numero na mesma tela, e as duas discordariam no primeiro dia em que
// alguem mudasse o que conta como receita -- com os tiles "Entrou" e "Saiu"
// mostrando um valor e o "Total esperado" logo abaixo somando outro. O que esta
// rota devolve e so a parcela que ninguem mais sabe calcular.
//
// O painel recorta o realizado em `hoje` pedindo `ate=min(periodo.ate, hoje)`
// aquela rota. Ver lib/realizado-e-previsao.ts para o porque do corte.
//
// A PREVISAO SAI DA DEDUPLICACAO QUE JA EXISTE, NAO DE UM SUM NOVO
// -----------------------------------------------------------------
// `projetarFluxoDeCaixa` (lib/cash-flow-forecast.ts) e quem resolve a parte
// dificil: a mesma cobranca existindo como conta prevista E como recorrencia
// detectada. Somar as duas fontes cru cobra a Netflix duas vezes -- e a
// armadilha 1 documentada no cabecalho dele, com teste proprio. Esta rota monta
// a linha do tempo por la e depois SOMA OS DIAS que caem dentro do periodo.
//
// O saldo inicial nao interessa aqui, e por isso `contas: []`. Os campos
// `entra`/`sai` de cada dia saem so dos eventos; o saldo e derivado deles. Uma
// consulta a `financial_accounts` so para alimentar um numero que a resposta
// nao usa seria trabalho e uma dependencia a mais para quebrar.
//
// O QUE NAO ENTRA NA CONTA, E POR QUE CADA UM
// --------------------------------------------
// A selecao das linhas diverge de propósito da que /api/cash-flow faz, em tres
// pontos -- as duas telas perguntam coisas diferentes:
//
//   1. TRANSFERENCIA e FATURA DE CARTAO ficam FORA (`direcaoNoPainel`). La a
//      pergunta e uma DATA e a fatura precisa aparecer no dia em que o dinheiro
//      sai da conta corrente. Aqui a pergunta e "quanto vou gastar no periodo",
//      e cada compra do cartao ja entrou como despesa no dia em que aconteceu:
//      somar a fatura por cima cobraria as mesmas compras duas vezes.
//
//   2. A DIRECAO VEM DA VIEW DO 027 (`scheduled_transactions_effective.
//      direction`), nao do `transaction_type` da regra. A ocorrencia pode ter
//      direcao propria e ela tem precedencia; refazer o COALESCE aqui e
//      exatamente a copia esquecida que a 027 existe para evitar.
//
//   3. A LINHA DE GRUPO ENTRA PELA MINHA PARTE (`parteDoMembro`). As policies
//      do 005 liberam as previstas de grupo dos OUTROS membros, e sem a divisao
//      o aluguel de R$ 3.000 do grupo Casa entraria inteiro na previsao das duas
//      pessoas -- e discordaria do "A vencer" do mesmo painel, que ja divide.
//
// O GASTO VARIAVEL VEM JUNTO, MAS FORA DOS DOIS LADOS
// ----------------------------------------------------
// `variable_spend` viaja na resposta com a procedencia inteira, e NAO esta
// somado em `previsao`. Decisao de produto do Helio (HMO-145, opcao
// "separado"): a media e linha propria, visivel e editavel, e o numero de
// Previsao leva somente o comprometido. Ver o cabecalho do
// lib/variable-spend.ts -- a media "so pode entrar na conta se ela aparecer na
// tela e puder ser mudada la".

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { today } from "@/lib/recurrence";
import { materializarAgenda } from "@/lib/services/scheduled";
import {
  janelaParaMaterializar,
  periodoCorrente,
  periodoDaQuery,
} from "@/lib/periodo-do-painel";
import {
  direcaoNoPainel,
  janelaDaPrevisao,
  somarLinhaNaJanela,
} from "@/lib/realizado-e-previsao";
import {
  horizonteValido,
  projetarFluxoDeCaixa,
  type PrevistaParaFluxo,
  type RecorrenciaParaFluxo,
} from "@/lib/cash-flow-forecast";
import {
  calcularGastoVariavel,
  inicioDaJanela,
  type GastoVariavel,
  type TransacaoParaGastoVariavel,
} from "@/lib/variable-spend";
import { diasEntre, normalizeMerchant } from "@/lib/recurrence-detector";
import { ehFatura } from "@/lib/card-invoice";
import { contarMembrosAtivos, parteDoMembro } from "@/lib/parte-do-grupo";
import {
  COLUNAS_DA_TRANSACAO,
  MAX_TRANSACOES,
  nomesDasCategorias,
} from "@/lib/services/monthly-summary";

interface LinhaPrevistaEfetiva {
  id: string;
  description: string | null;
  notes: string | null;
  amount: number | string;
  due_date: string;
  direction: string | null;
  group_id: string | null;
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
    const hoje = today();

    const daQuery = periodoDaQuery(
      url.searchParams.get("de") ?? url.searchParams.get("from"),
      url.searchParams.get("ate") ?? url.searchParams.get("to")
    );

    if (daQuery === "invalido") {
      return NextResponse.json(
        { error: "de e ate devem ser datas AAAA-MM-DD, com de <= ate" },
        { status: 400 }
      );
    }

    const periodo = daQuery ?? periodoCorrente(hoje);
    const janela = janelaDaPrevisao(periodo, hoje);

    // ---------------------------------------------------------------------
    // Periodo inteiramente passado: a resposta e zero, e ela sai daqui
    // ---------------------------------------------------------------------
    // Sem esta saida o horizonte seria negativo, `horizonteValido` o corrigiria
    // para os 90 dias padrao e a rota somaria as contas de NOVEMBRO dentro do
    // total esperado de julho. O erro nao teria sintoma: um numero maior,
    // plausivel, debaixo do rotulo de um mes que ja acabou.
    if (!janela) {
      return NextResponse.json({
        today: hoje,
        periodo,
        janela: null,
        previsao: { receita: 0, despesa: 0 },
        variable_spend: null,
        gasto_indisponivel: false,
        recorrencias_indisponiveis: false,
        absorvidas_pela_agenda: [],
      });
    }

    const dias = horizonteValido(diasEntre(hoje, janela.ate) + 1);

    const aMaterializar = janelaParaMaterializar(periodo, hoje);
    if (aMaterializar) {
      try {
        await materializarAgenda(supabase, user.id, aMaterializar);
      } catch (erroAgenda) {
        console.error("Previsao seguiu sem materializar a agenda:", erroAgenda);
      }
    }

    // Sem piso de data, pelo mesmo motivo da /api/cash-flow: uma conta que
    // venceu no mes passado e nao foi paga continua sendo dinheiro que vai
    // sair, e o calculo a traz para hoje -- que esta DENTRO desta janela por
    // construcao. O teto e `janela.ate`.
    //
    // A view, e nao a tabela: `direction` so existe la (027), e `notes` e o que
    // `ehFatura` le. Sem filtro de `user_id` porque a RLS filtra -- e porque as
    // linhas de grupo dos outros membros precisam chegar para entrar pela minha
    // parte, exatamente como em /api/scheduled-transactions/summary.
    const { data: previstas, error: erroPrevistas } = await supabase
      .from("scheduled_transactions_effective")
      .select("id, description, notes, amount, due_date, direction, group_id")
      .eq("status", "pending")
      .lte("due_date", janela.ate);

    if (erroPrevistas) {
      console.error("Erro ao carregar as previstas do painel:", erroPrevistas);
      return NextResponse.json(
        { error: "Não foi possível calcular a previsão" },
        { status: 500 }
      );
    }

    const linhas = (previstas ?? []) as unknown as LinhaPrevistaEfetiva[];

    const gruposEnvolvidos = Array.from(
      new Set(linhas.map((l) => l.group_id).filter((id): id is string => Boolean(id)))
    );

    let membrosAtivosPorGrupo = new Map<string, number>();

    if (gruposEnvolvidos.length > 0) {
      const { data: membros, error: erroMembros } = await supabase
        .from("group_members")
        .select("group_id, status")
        .in("group_id", gruposEnvolvidos)
        .eq("status", "active");

      if (erroMembros) {
        // Sem a contagem, `parteDoMembro` mantem o valor CHEIO. Erra para cima,
        // que e o lado que nao promete dinheiro que nao sobra.
        console.error("Previsao seguiu sem dividir a parte do grupo:", erroMembros);
      } else {
        membrosAtivosPorGrupo = contarMembrosAtivos(membros ?? []);
      }
    }

    const paraCalculo: PrevistaParaFluxo[] = [];

    for (const p of linhas) {
      const lado = direcaoNoPainel(p.direction, ehFatura(p.notes));
      if (lado === null) continue;

      paraCalculo.push({
        id: p.id,
        description: p.description,
        amount: parteDoMembro(p.amount, p.group_id, membrosAtivosPorGrupo),
        due_date: p.due_date,
        tipo: lado,
      });
    }

    // As assinaturas que o detector achou sozinho. `IGNORED` e `CANCELLED`
    // ficam fora ja na consulta, como em /api/cash-flow.
    const { data: recorrenciasBrutas, error: erroRecorrencias } = await supabase
      .from("detected_recurrences")
      .select(
        "id, merchant_key, display_name, avg_amount, frequency, next_expected_date, status"
      )
      .eq("user_id", user.id)
      .in("status", ["DETECTED", "CONFIRMED"]);

    // Perder as assinaturas nao derruba a tela, mas nao passa calado: sem elas
    // a Previsao fica OTIMISTA -- e um total esperado menor que a verdade e o
    // pior lado do erro nesta tela. A flag sobe para o painel escrever o aviso.
    const recorrenciasIndisponiveis = Boolean(erroRecorrencias);
    if (erroRecorrencias) {
      console.error("Previsao seguiu SEM as assinaturas detectadas:", erroRecorrencias);
    }

    const recorrencias = (recorrenciasBrutas ?? []) as RecorrenciaParaFluxo[];

    // ---------------------------------------------------------------------
    // O gasto variavel: a linha de fora
    // ---------------------------------------------------------------------
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
        .limit(MAX_TRANSACOES),
      nomesDasCategorias(supabase).catch((erro) => {
        console.error("Previsao seguiu sem os nomes de categoria:", erro);
        return {} as Record<string, string>;
      }),
    ]);

    // A MESMA lista de assinaturas que alimenta o calculo, por variavel e nao
    // por consulta nova -- ver o cabecalho de /api/cash-flow. Excluir da media
    // uma chave que a previsao NAO projeta e pior que nao excluir nada: o gasto
    // some das duas metades.
    const chavesComprometidas = [
      ...recorrencias.map((r) => r.merchant_key),
      ...((regras.data ?? []) as { description: string | null }[]).map((r) =>
        normalizeMerchant(r.description ?? "")
      ),
    ].filter(Boolean);

    if (transacoes.error) {
      console.error("Previsao seguiu SEM o gasto variavel:", transacoes.error);
    }

    const gastoVariavel: GastoVariavel = calcularGastoVariavel({
      transacoes: (transacoes.data ?? []) as unknown as TransacaoParaGastoVariavel[],
      chavesComprometidas,
      hoje,
      nomesDeCategoria,
    });

    // ---------------------------------------------------------------------
    // A linha do tempo, e a soma dos dias que caem no periodo
    // ---------------------------------------------------------------------
    // `gastoDiario` NAO e passado: a linha provavel do forecast desconta a
    // media dia a dia, e o que sai daqui e so o comprometido. Passar o valor
    // aqui nao mudaria `entra`/`sai` -- que e o que esta rota soma --, mas
    // deixaria no codigo a impressao de que a media entra na Previsao.
    const fluxo = projetarFluxoDeCaixa({
      contas: [],
      previstas: paraCalculo,
      recorrencias,
      hoje,
      dias,
    });

    return NextResponse.json({
      today: hoje,
      periodo,
      janela,
      previsao: somarLinhaNaJanela(fluxo.linha, janela),
      // A procedencia da media vai junto: quantos meses a sustentam, quais sao,
      // e o que foi descartado por ja estar comprometido. Sem isso o usuario
      // compara com o extrato, acha a diferenca e conclui que a conta esta
      // errada -- quando ela esta certa POR CAUSA da diferenca.
      //
      // Vem so a MEDIANA, nao a estimativa multiplicada pelos dias. Quem
      // multiplica e a tela, com o `estimativaVariavel` do
      // lib/realizado-e-previsao.ts -- porque o valor que vale ali e o que o
      // usuario digitou no campo, e uma segunda multiplicacao aqui devolveria
      // um total que a tela nao usa. Duas versoes do mesmo numero e como a
      // segunda passa a discordar em silencio.
      variable_spend: gastoVariavel,
      gasto_indisponivel: Boolean(transacoes.error),
      recorrencias_indisponiveis: recorrenciasIndisponiveis,
      // Quais assinaturas foram absorvidas por uma conta prevista. Vai para a
      // tela pelo mesmo motivo da /api/cash-flow: sem isso o usuario procura a
      // Netflix na previsao, nao acha, e conclui que ela foi esquecida.
      absorvidas_pela_agenda: fluxo.absorvidasPelaAgenda,
    });
  } catch (error) {
    console.error("Erro na API de previsão do painel:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
