import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { MOEDA_PADRAO } from "@/lib/dinheiro";
import { precisaDeCotacao } from "@/lib/cambio";
import { cotacaoNaData } from "@/lib/ptax";
import { moedaDaViagem } from "@/lib/moeda-do-grupo";

// O client nao tem o generic `Database`: sem declarar a linha, todo `select()`
// volta `any` e o `tsc` para de conferir os nomes de coluna. Os numericos da
// view chegam como string no JSON do PostgREST -- e o que justifica o `Number()`
// em cada um deles mais abaixo.
type LinhaDeSaldoDoGrupo = {
  user_id: string;
  member_id: string;
  total_paid: number | string;
  total_owed: number | string;
  settlements_paid: number | string;
  settlements_received: number | string;
  net_balance: number | string;
  paid_count: number | string;
  owed_count: number | string;
  amount_currency: string | null;
  group_currency: string | null;
};

type PerfilDoMembro = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
};

/**
 * Saldo de cada membro do grupo.
 *
 * Passou a ler a view `group_member_balances` (migration 007) em vez de
 * recalcular aqui. Tres coisas mudaram com isso:
 *
 *  1. Os ACERTOS entram na conta. Antes, registrar o pagamento nao mexia no
 *     saldo -- na verdade nem havia onde registrar, e a divida quitada
 *     continuava aparecendo para sempre.
 *  2. Uma consulta em vez de duas POR MEMBRO. A versao anterior rodava um
 *     `Promise.all` que refazia a mesma busca de group_transactions uma vez
 *     para cada membro, e depois filtrava em memoria.
 *  3. Rateio recusado deixou de contar como divida.
 *
 * E esta rota e a rota de transfers davam respostas DIFERENTES para "quanto eu
 * devo", porque cada uma implementava a regra do seu jeito. Agora as duas leem
 * a mesma view.
 *
 * A MOEDA DA VIAGEM, E A COTACAO DE HOJE (HMO-182, item 4)
 * --------------------------------------------------------
 * A 026 acrescentou duas colunas a view, e as duas dizem coisas diferentes:
 *
 *   `amount_currency` = 'BRL'  -- a moeda dos numeros. Constante, e existe
 *                                 porque as sete colunas de dinheiro nao diziam
 *                                 em que moeda estavam e agora ha duas em jogo.
 *   `group_currency`           -- a moeda da VIAGEM, para a tela apresentar.
 *
 * Esta rota devolve as duas mais `today_rate`: a cotacao de HOJE da moeda da
 * viagem, que e a unica cotacao com que a apresentacao pode ser feita. Ela nao
 * toca em `net_balance` -- a conversao e da tela, e o numero que vale continua
 * sendo o BRL.
 *
 * `today_rate` vem `null` sem drama em tres casos (PTAX nao cobre a moeda, o
 * Banco Central nao respondeu, grupo em real), e a tela mostra so o BRL. Buscar
 * a cotacao NAO pode derrubar esta rota: o saldo do grupo e a informacao
 * principal da tela e ela nao depende de cotacao nenhuma. Por isso o `try` em
 * volta da chamada, e nao um `await` solto -- `lib/ptax.ts` ja trata o timeout,
 * mas um throw inesperado dali viraria 500 numa tela que tem tudo para
 * responder.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { groupId } = params;

    const { data: membership } = await supabase
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { data: linhas, error } = await supabase
      .from("group_member_balances")
      .select(
        `
        user_id,
        member_id,
        total_paid,
        total_owed,
        settlements_paid,
        settlements_received,
        net_balance,
        paid_count,
        owed_count,
        amount_currency,
        group_currency
      `
      )
      .eq("group_id", groupId)
      .returns<LinhaDeSaldoDoGrupo[]>();

    if (error) {
      console.error("Erro ao ler saldos do grupo:", error);
      return NextResponse.json(
        { error: "Failed to load balances" },
        { status: 500 }
      );
    }

    // A view nao carrega nome e foto (ela e sobre dinheiro). Um SELECT em
    // profiles resolve, e e uma consulta so para o grupo inteiro.
    const userIds = (linhas || []).map((l) => l.user_id);
    const { data: perfis } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", userIds.length > 0 ? userIds : [user.id])
      .returns<PerfilDoMembro[]>();

    const perfilPor = new Map((perfis || []).map((p) => [p.id, p]));

    const balances = (linhas || []).map((l) => ({
      member: perfilPor.get(l.user_id) || { id: l.user_id, full_name: null },
      balance: Number(l.net_balance),
      total_paid: Number(l.total_paid),
      total_owed: Number(l.total_owed),
      settlements_paid: Number(l.settlements_paid),
      settlements_received: Number(l.settlements_received),
      transactions_count: Number(l.paid_count) + Number(l.owed_count),
    }));

    // Grupo fechado soma zero: todo real pago a mais por um e um real pago a
    // menos por outro. Quando nao soma, e despesa sem rateio, rateio que nao
    // cobre 100% do valor, ou parte no nome de quem ja saiu do grupo -- ver a
    // nota de `residual` em lib/settlement.ts. A tela avisa em vez de exibir um
    // acerto que nunca fecha.
    const residualCents = balances.reduce(
      (acc, b) => acc + Math.round(b.balance * 100),
      0
    );

    // A view devolve a mesma moeda de grupo em toda linha (ela vem do JOIN com
    // expense_groups), entao a primeira linha basta. Grupo sem membro ativo nao
    // produz linha nenhuma: nesse caso nao ha saldo para apresentar e BRL e o
    // que a tela usa para formatar o zero.
    const primeira = (linhas || [])[0];
    const groupCurrency = moedaDaViagem(primeira?.group_currency);
    const amountCurrency = primeira?.amount_currency || MOEDA_PADRAO;

    const hoje = new Date().toISOString().slice(0, 10);
    let todayRate: number | null = null;
    let todayRateDate: string | null = null;

    if (precisaDeCotacao(groupCurrency)) {
      try {
        const cotacao = await cotacaoNaData(groupCurrency, hoje);
        todayRate = cotacao.taxa;
        todayRateDate = cotacao.dataDoBoletim;
      } catch (erro) {
        // Cotacao e enfeite nesta rota; saldo nao e. Ver o cabecalho.
        console.error("Cotacao de hoje indisponivel para o grupo:", erro);
      }
    }

    return NextResponse.json({
      success: true,
      balances,
      residual: residualCents / 100,
      is_balanced: Math.abs(residualCents) <= 1,
      // A moeda em que `balance`, `total_paid` e companhia estao. Constante hoje,
      // e explicita para a tela nao ter de descobrir lendo a migration.
      amount_currency: amountCurrency,
      // A moeda da viagem. Pode ser igual a de cima (grupo em real).
      group_currency: groupCurrency,
      // A cotacao de HOJE, so para a tela escrever o saldo na moeda da viagem.
      // `null` = mostre em real. Nunca 1 numa moeda estrangeira: ver lib/cambio.ts.
      today_rate: todayRate,
      today_rate_date: todayRateDate,
      today: hoje,
    });
  } catch (error) {
    console.error("Erro em GET balances:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
