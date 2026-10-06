import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { today } from "@/lib/recurrence";
import {
  fecharMes,
  mesDaData,
  mesesComConta,
  linhaDoRealizado,
  linhaDoPrevisto,
  type LinhaCrua,
} from "@/lib/fechamento-do-grupo";
import { divisaoDoPeriodo, paraPercentual } from "@/lib/divisao-configurada";

/**
 * O FECHAMENTO DO MES DO GRUPO (HMO-245).
 *
 *   GET /api/expense-groups/{groupId}/fechamento?mes=YYYY-MM
 *
 * Responde "em outubro o grupo tem R$ 2.000 de conta, cada um paga X, e quem
 * paga para quem" -- juntando o que ja aconteceu com o que vence no mes. A
 * conta de internet do C6 vencendo dia 15 nao tem transacao nenhuma ainda, e e
 * exatamente o tipo de linha que nao entrava em total nenhum do grupo.
 *
 * TODA A ARITMETICA ESTA EM lib/fechamento-do-grupo.ts, DE PROPOSITO
 * -----------------------------------------------------------------
 * Esta rota faz tres consultas e traduz as linhas; quem soma, rateia e decide
 * o que entra e o modulo puro, que tem teste e mutante
 * (`npm run mutantes:fechamento-do-grupo`). Em particular a EXCLUSAO da conta
 * prevista com baixa -- a unica defesa contra contar a mesma conta duas vezes
 * -- mora em `linhaDoPrevisto`, e nao num `.neq("status", "paid")` aqui: um
 * filtro de consulta trocado numa refatoracao nao quebra assercao nenhuma, e o
 * defeito que ele cria e um total dobrado que parece plausivel.
 *
 * A DIVISAO NAO E MAIS SEMPRE IGUAL (HMO-245, fase 4)
 * ---------------------------------------------------
 * A rota le `expense_groups.default_split_type` + `group_members.percentage` e
 * passa o PESO de cada membro para `fecharMes`. Quem decide se aquele peso vale
 * -- modo `percentage` com a soma fechando 100% -- e `divisaoDoPeriodo` em
 * lib/divisao-configurada.ts, que tem teste e mutante. Esta rota faz as
 * consultas e repassa; ela nao tem regra propria sobre porcentagem.
 *
 * O limite da configuracao, que a tela precisa dizer: ela vale para o
 * FECHAMENTO DO PERIODO e para despesa NOVA. Mudar de 50/50 para 70/30 nao
 * reescreve divisao de despesa ja lancada nem parte ja aprovada -- a 025
 * trancou repontamento de divisao justamente por isso.
 *
 * O MES PADRAO E O DE SAO PAULO, NAO O DO SERVIDOR
 * ------------------------------------------------
 * A Vercel roda em UTC. Das 21:00 do dia 31 em diante, `new Date()` no servidor
 * ja esta no mes seguinte enquanto o usuario ainda esta no mes corrente -- e o
 * fechamento do mes que ele esta fechando abriria vazio. `today()` de
 * lib/recurrence formata em America/Sao_Paulo, que e o fuso em que os
 * vencimentos deste app vivem.
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

    // ----------------------------------------------------------------
    // 1. Os membros ativos, em ordem ESTAVEL, com o peso da divisao
    // ----------------------------------------------------------------
    // `ratearPorPeso` da o centavo que sobra a quem tem o maior resto, e em
    // divisao IGUAL todos os restos empatam -- entao o desempate e a ordem
    // desta lista. Sem ordem fixa, o centavo de um mes de R$ 2.000 entre tres
    // trocaria de pessoa a cada carregamento da tela. `joined_at` resolve quase
    // sempre; o desempate por `user_id` cobre dois membros entrando no mesmo
    // instante (o que acontece quando o grupo e criado com os dois).
    //
    // `percentage` entra na MESMA consulta dos membros, de proposito: ela e um
    // atributo da linha do membro, e uma segunda consulta teria de ser casada
    // por id com esta -- uma ordem a mais para sair de sincronia, cujo defeito
    // e a parte de A no nome de B.
    const { data: membrosCrus, error: erroMembros } = await supabase
      .from("group_members")
      .select("user_id, joined_at, percentage")
      .eq("group_id", groupId)
      .eq("status", "active")
      .order("joined_at", { ascending: true })
      .order("user_id", { ascending: true });

    if (erroMembros) {
      console.error("Erro ao ler membros para o fechamento:", erroMembros);
      return NextResponse.json(
        { error: "Não foi possível carregar os membros do grupo" },
        { status: 500 }
      );
    }

    const ativos = (membrosCrus ?? []).filter((m) => m.user_id);
    const userIds = ativos.map((m) => m.user_id);

    const { data: perfis } = userIds.length
      ? await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .in("id", userIds)
      : { data: [] as { id: string; full_name: string; avatar_url?: string }[] };

    const perfilPorId = new Map((perfis ?? []).map((p) => [p.id, p] as const));

    // ----------------------------------------------------------------
    // 1b. O MODO DE DIVISAO, que e quem decide se o peso vale
    // ----------------------------------------------------------------
    // `default_split_type` sai do GRUPO e os percentuais saem dos MEMBROS: sem
    // ler os dois, um grupo em modo `percentage` com a coluna nunca escrita
    // (que e todo grupo criado antes da fase 3) rateia 0% da conta.
    //
    // Quem decide o que vale e `divisaoDoPeriodo`, em lib/divisao-configurada.ts
    // -- esta rota nao tem regra propria sobre isso. Erro ao ler o grupo nao
    // derruba o fechamento: `grupo` vem `null`, `configurado` cai em `equal`, e
    // o mes fecha na divisao igual em vez de a tela ficar em branco.
    const { data: grupo } = await supabase
      .from("expense_groups")
      .select("default_split_type")
      .eq("id", groupId)
      .maybeSingle();

    const divisao = divisaoDoPeriodo(grupo?.default_split_type, ativos);

    // O peso vai DENTRO do membro -- `divisaoDoPeriodo` devolve na ordem que
    // recebeu, que e a ordem estavel da consulta acima.
    const membros = ativos.map((m, i) => ({
      user_id: m.user_id,
      full_name: perfilPorId.get(m.user_id)?.full_name ?? null,
      avatar_url: perfilPorId.get(m.user_id)?.avatar_url ?? null,
      peso: divisao.pesos[i].peso,
    }));

    // ----------------------------------------------------------------
    // 2. O REALIZADO: as despesas que o grupo ja registrou
    // ----------------------------------------------------------------
    // Duas consultas em vez de um embed. `financial_transactions` tem uma
    // coluna `group_id` E e alvo de `group_transactions.transaction_id`, e
    // embed com mais de um caminho possivel responde PGRST201 numa rota que
    // nunca foi tocada -- o apagao que a 038 ja causou neste projeto. Ler os
    // ids primeiro nao tem ambiguidade possivel.
    const { data: vinculos, error: erroVinculos } = await supabase
      .from("group_transactions")
      .select("transaction_id")
      .eq("group_id", groupId);

    if (erroVinculos) {
      console.error("Erro ao ler as despesas do grupo:", erroVinculos);
      return NextResponse.json(
        { error: "Não foi possível carregar as despesas do grupo" },
        { status: 500 }
      );
    }

    const idsDeTransacao = Array.from(
      new Set((vinculos ?? []).map((v) => v.transaction_id).filter(Boolean))
    );

    const { data: realizadas, error: erroRealizadas } = idsDeTransacao.length
      ? await supabase
          .from("financial_transactions")
          .select(
            "id, description, amount, exchange_rate, transaction_date, user_id, transaction_type"
          )
          .in("id", idsDeTransacao)
      : { data: [], error: null };

    if (erroRealizadas) {
      console.error("Erro ao ler as transacoes do grupo:", erroRealizadas);
      return NextResponse.json(
        { error: "Não foi possível carregar as despesas do grupo" },
        { status: 500 }
      );
    }

    // ----------------------------------------------------------------
    // 3. O PREVISTO: as contas do grupo que ainda vao acontecer
    // ----------------------------------------------------------------
    // `direction` e lida da view e repassada crua: a precedencia entre o tipo
    // da ocorrencia e o da regra recorrente e da 027, e refazer esse COALESCE
    // aqui e o defeito que ela fechou.
    const { data: previstas, error: erroPrevistas } = await supabase
      .from("scheduled_transactions_effective")
      .select("id, description, amount, due_date, user_id, status, direction")
      .eq("group_id", groupId);

    if (erroPrevistas) {
      console.error("Erro ao ler as previstas do grupo:", erroPrevistas);
      return NextResponse.json(
        { error: "Não foi possível carregar as contas previstas do grupo" },
        { status: 500 }
      );
    }

    // ----------------------------------------------------------------
    // 4. O fechamento
    // ----------------------------------------------------------------
    const linhas: LinhaCrua[] = [
      ...(realizadas ?? []).map(linhaDoRealizado),
      ...(previstas ?? [])
        .map(linhaDoPrevisto)
        .filter((l): l is LinhaCrua => l !== null),
    ];

    const hoje = today();
    const meses = mesesComConta(linhas, hoje);

    // `?mes=` invalido ou de um mes sem conta nao e erro: esta e a tela inicial
    // do fechamento e um parametro cortado no meio nao pode virar tela em
    // branco. Cai no mes corrente, com o seletor a vista -- a mesma escolha de
    // `lerPeriodo` em lib/periodo-do-painel.ts.
    // `mesDaData` aceita tanto `YYYY-MM-DD` quanto o `YYYY-MM` que vem daqui:
    // ela fatia os 7 primeiros caracteres e exige o padrao exato.
    const pedidoCru = request.nextUrl.searchParams.get("mes");
    const pedido = mesDaData(pedidoCru);
    const mes = pedido || mesDaData(hoje);

    const fechamento = fecharMes(linhas, membros, mes);

    return NextResponse.json({
      success: true,
      ...fechamento,
      /** Os meses que o seletor da tela oferece, do mais recente ao mais antigo. */
      meses,
      /** `true` = o `?mes=` pedido nao pôde ser usado e esta e a resposta do mes corrente. */
      mes_corrigido: Boolean(pedidoCru) && !pedido,
      today: hoje,
      active_members: membros.length,
      /** Quem este fechamento e, para a tela destacar "voce paga/recebe". */
      viewer_user_id: user.id,
      /**
       * Com que divisao este mes foi rateado.
       *
       * `configurado` e o que o grupo pediu; `aplicado` e o que valeu. Os dois
       * vem porque eles DIVERGEM em dois casos reais -- modo `custom`/
       * `proportional`, que o fechamento nao sabe aplicar, e config gravada que
       * nao fecha 100% -- e a tela precisa dizer qual, nao mostrar "igual" sobre
       * um grupo configurado de outro jeito. `soma_percentual` e o numero pelo
       * qual a tela cobra o ajuste.
       *
       * `pesos[].peso` e RAZAO, nao porcentagem: em `percentage` ele e o
       * centesimo de ponto gravado (7000 = 70%); em `equal` e 1 para todos. O
       * VALOR em real de cada um nao esta aqui e nao deve ser recalculado a
       * partir daqui -- ele e `por_membro[].devido`, uma aritmetica so, para as
       * duas telas nao terem como discordar.
       */
      divisao: {
        ...divisao,
        soma_percentual: paraPercentual(divisao.soma_centesimos),
      },
    });
  } catch (error) {
    console.error("Erro no fechamento do grupo:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
