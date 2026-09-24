// GET /api/safe-to-spend
//
// "Quanto ainda posso gastar este mes, e quanto por dia?" A aritmetica inteira
// -- e cada armadilha dela -- mora em lib/safe-to-spend.ts, com teste unitario
// proprio. Aqui so ha busca de linha e traducao de formato.
//
// E leitura pura: nao existe tabela de "posso gastar" e nao deve existir. O
// numero muda a cada compra no cartao e a cada conta paga, e uma tabela
// precisaria de trigger em financial_transactions, em scheduled_transactions e
// no saldo das contas para nao mentir.
//
// Por que materializa a agenda antes de somar: as ocorrencias futuras das
// regras recorrentes sao criadas sob demanda (lib/services/scheduled.ts). Sem
// este passo o aluguel do dia 25 pode simplesmente nao existir como linha, e o
// app diria que ha mais dinheiro livre do que ha -- o pior sentido para errar.
// E best-effort de proposito: se a materializacao falhar, e melhor devolver o
// numero com as linhas que existem do que devolver 500.

import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import { today } from "@/lib/recurrence";
import { materializarAgenda } from "@/lib/services/scheduled";
import {
  calcularQuantoPossoGastar,
  fimDoMes,
  type PrevistaParaGastar,
  type MetaParaGastar,
} from "@/lib/safe-to-spend";

interface LinhaPrevista {
  id: string;
  amount: number | string;
  due_date: string;
  notes: string | null;
  recurring_rule:
    | { transaction_type: string }
    | { transaction_type: string }[]
    | null;
}

interface LinhaMeta {
  id: string;
  title: string;
  status: string;
  target_amount: number | string;
  saved: number | string | null;
  target_date: string | null;
  monthly_contribution: number | string | null;
}

export async function GET() {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const hoje = today();
    const ate = fimDoMes(hoje);

    try {
      await materializarAgenda(supabase, user.id, { de: hoje, ate });
    } catch (erroAgenda) {
      console.error("Posso gastar seguiu sem materializar a agenda:", erroAgenda);
    }

    // `is_active` vem junto: a conta arquivada e excluida do disponivel dentro
    // do calculo, e o cartao arquivado continua descontando. Filtrar aqui por
    // is_active tiraria a divida do cartao cancelado da conta.
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
    // continua sendo dinheiro que vai sair. O filtro de teto e feito no
    // calculo, que ja conhece o fim do mes.
    const { data: previstas, error: erroPrevistas } = await supabase
      .from("scheduled_transactions")
      .select(
        "id, amount, due_date, notes, recurring_rule:recurring_rules(transaction_type)"
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

    // A direcao (sai ou entra) vem do tipo da REGRA, nao da ocorrencia --
    // `scheduled_transactions.amount` e sempre positivo por CHECK. Mesma
    // leitura da /api/projection; conta avulsa nao tem regra e e despesa.
    const paraCalculo: PrevistaParaGastar[] = ((previstas ??
      []) as LinhaPrevista[]).map((p) => {
      const regra = Array.isArray(p.recurring_rule)
        ? p.recurring_rule[0]
        : p.recurring_rule;

      return {
        id: p.id,
        amount: p.amount,
        due_date: p.due_date,
        notes: p.notes,
        tipo: regra?.transaction_type === "income" ? "income" : "expense",
      };
    });

    // ------------------------------------------------------------------
    // A quinta parcela: o que ainda falta separar para as metas (HMO-155)
    // ------------------------------------------------------------------
    // `group_id IS NULL` de proposito: a RLS do 008 devolve tambem as metas dos
    // grupos do usuario, e o alvo mensal de uma meta de grupo e do GRUPO.
    // Descontar o valor cheio da carteira de cada membro faria tres pessoas
    // reservarem R$ 900 para uma meta de R$ 300 por mes. Ver a migration 018.
    //
    // So `active`: o filtro tambem esta dentro do calculo (e tem teste la), e
    // repetir aqui e o que evita trazer do banco meta cancelada de anos atras.
    const { data: metasBrutas, error: erroMetas } = await supabase
      .from("goal_progress")
      .select(
        "id, title, status, target_amount, saved, target_date, monthly_contribution"
      )
      .eq("status", "active")
      .is("group_id", null);

    // NAO devolve 500 quando a leitura das metas falha, e o motivo e concreto:
    // entre o merge deste codigo e a migration 018 rodar no SQL Editor de
    // producao existe uma JANELA em que `monthly_contribution` nao existe na
    // view. O PostgREST responde 42703 (`column ... does not exist`) e, com um
    // 500 aqui, o card inteiro do "quanto posso gastar" -- as outras quatro
    // parcelas, que nao dependem de meta nenhuma -- sumiria da tela inicial.
    //
    // Perder a quinta parcela e ruim; perder o card e pior, e seria uma
    // regressao de algo que ja funcionava. Mesmo criterio (e mesmo comentario)
    // da materializacao da agenda no topo do arquivo.
    //
    // O que NAO se faz aqui e calar: sem a flag, a tela mostraria
    // "Nas metas − R$ 0,00" e o usuario leria isso como "nao tenho nada a
    // separar este mes", que e uma afirmacao FALSA sobre o dinheiro dele. A
    // flag existe para a tela poder dizer "indisponivel" em vez de zero.
    const metasIndisponiveis = Boolean(erroMetas);
    if (erroMetas) {
      console.error(
        "Posso gastar seguiu SEM a reserva de metas (a 018 ja rodou em producao?):",
        erroMetas
      );
    }

    // Quanto ja foi aportado em CADA meta dentro deste mes. Sem isto o aporte
    // do dia 5 seria descontado duas vezes: uma no saldo da conta, de onde o
    // dinheiro saiu, e outra no alvo mensal cheio.
    //
    // A janela vem de `hoje`, nao do CURRENT_DATE do Postgres: e a mesma fonte
    // que o resto do calculo usa para saber em que mes esta. Aporte com data
    // mais adiante no mes conta como ja feito -- ele ja foi lancado, e o
    // dinheiro ja saiu da conta que alimenta o "disponivel".
    const inicioDoMes = `${hoje.slice(0, 7)}-01`;
    const idsDeMeta = (metasBrutas ?? []).map((m) => m.id);

    const { data: aportes, error: erroAportes } = idsDeMeta.length
      ? await supabase
          .from("goal_contributions")
          .select("goal_id, amount")
          .eq("user_id", user.id)
          .in("goal_id", idsDeMeta)
          .gte("contributed_at", inicioDoMes)
          .lte("contributed_at", ate)
      : { data: [], error: null };

    // Aqui o 500 seria ATIVAMENTE perigoso, nao so inconveniente: sem os
    // aportes do mes, cada meta reservaria o alvo CHEIO por cima de dinheiro
    // que ja saiu da conta -- o desconto em dobro que esta rota existe para
    // evitar. Entao ou se tem a lista de aportes, ou nao se desconta nada.
    const aportesIndisponiveis = Boolean(erroAportes);
    if (erroAportes) {
      console.error("Erro ao carregar aportes do mes:", erroAportes);
    }

    const aportadoPorMeta = new Map<string, number>();
    for (const a of aportes ?? []) {
      const atual = aportadoPorMeta.get(a.goal_id) ?? 0;
      aportadoPorMeta.set(a.goal_id, atual + Number(a.amount ?? 0));
    }

    const semReserva = metasIndisponiveis || aportesIndisponiveis;

    const metas: MetaParaGastar[] = (
      semReserva ? [] : ((metasBrutas ?? []) as LinhaMeta[])
    ).map(
      (m) => ({
        id: m.id,
        title: m.title,
        status: m.status,
        target_amount: m.target_amount,
        saved: m.saved,
        target_date: m.target_date,
        monthly_contribution: m.monthly_contribution,
        aportadoNoMes: aportadoPorMeta.get(m.id) ?? 0,
      })
    );

    return NextResponse.json({
      today: hoje,
      // A tela usa isto para escrever "indisponivel" no tile em vez de
      // "R$ 0,00" -- zero seria uma afirmacao sobre o dinheiro do usuario que
      // a rota nao tem como sustentar.
      reserva_indisponivel: semReserva,
      safe_to_spend: calcularQuantoPossoGastar({
        contas: contas ?? [],
        previstas: paraCalculo,
        metas,
        hoje,
      }),
    });
  } catch (error) {
    console.error("Erro na API de quanto posso gastar:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
