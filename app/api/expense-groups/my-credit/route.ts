import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { today } from "@/lib/recurrence";
import {
  fecharMes,
  linhaDoRealizado,
  linhaDoPrevisto,
  type LinhaCrua,
} from "@/lib/fechamento-do-grupo";
import { divisaoDoPeriodo } from "@/lib/divisao-configurada";
import { lerPeriodo, mesesDoPeriodo } from "@/lib/periodo-do-painel";
import { creditoAReceber, type FechamentoDeGrupo } from "@/lib/credito-de-grupo";

export const dynamic = "force-dynamic";

/**
 * O QUE OS OUTROS ME DEVEM, SOMANDO TODOS OS MEUS GRUPOS (HMO-245, fase 10).
 *
 *   GET /api/expense-groups/my-credit?de=AAAA-MM-DD&ate=AAAA-MM-DD
 *
 * A rota `[groupId]/fechamento` responde sobre UM grupo e exige saber qual. A
 * tela de Financas Pessoais pergunta o contrario -- "e no total, quem me deve?"
 * --, e sem esta rota teria de descobrir os meus grupos e bater numa rota por
 * grupo e por mes: N x M requisicoes para um cartao. Mesmo motivo de
 * `my-balance` (HMO-175), que responde a outra pergunta.
 *
 * A DIFERENCA ENTRE ESTA ROTA E A `my-balance`, QUE NAO E COSMETICA
 * ----------------------------------------------------------------
 * `my-balance` le `group_member_balances` (view do 007): so o REALIZADO, e
 * acumulado, sem recorte de mes. Esta rota fecha o mes com `fecharMes`, que soma
 * PREVISTO JUNTO COM REALIZADO -- a internet do C6 que vence dia 15 e que nao
 * tem transacao nenhuma ainda entra aqui e nao entra la.
 *
 * As duas respostas DIVERGEM, de proposito, e as duas estao certas para a
 * pergunta de cada uma. E por isso que o credito desta rota vai para a tela
 * rotulado A RECEBER / previsto, fora de "Receitas": o cabecalho de
 * lib/credito-de-grupo.ts e onde esse criterio esta escrito.
 *
 * TODA A ARITMETICA ESTA EM lib/ -- AQUI SO HA CONSULTA E TRADUCAO
 * ---------------------------------------------------------------
 * `fecharMes` fecha cada mes, `creditoAReceber` recorta o meu lado positivo e
 * agrega por (grupo, devedor). As duas tem teste e mutante. Esta rota nao tem
 * regra propria sobre dinheiro, e nao deve ter.
 *
 * UMA CONSULTA POR TABELA, E NAO UMA POR GRUPO
 * -------------------------------------------
 * Cada `.in()` abaixo tem a guarda de lista vazia, e ela nao e defensiva: `in`
 * com lista vazia devolve TUDO em algumas versoes do PostgREST, e aqui "tudo"
 * seria linha de grupo de que eu nao participo. O mesmo cuidado esta em
 * `my-balance/route.ts`.
 *
 * O MES PADRAO E O DE SAO PAULO. A Vercel roda em UTC: das 21:00 do dia 31 em
 * diante `new Date()` no servidor ja esta no mes seguinte. `today()`
 * (lib/recurrence) formata em America/Sao_Paulo, que e o fuso em que os
 * vencimentos deste app vivem.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const hoje = today();
    const periodo = lerPeriodo(
      request.nextUrl.searchParams.get("de"),
      request.nextUrl.searchParams.get("ate"),
      hoje
    );
    // `mesesDoPeriodo` devolve 'AAAA-MM-01' (a chave das views do 008);
    // `fecharMes` recorta por 'AAAA-MM'.
    const meses = mesesDoPeriodo(periodo).map((m) => m.slice(0, 7));

    // ----------------------------------------------------------------
    // 1. Os MEUS grupos, e so os nao arquivados
    // ----------------------------------------------------------------
    // Arquivar zera `is_active` em `expense_groups` e NAO toca a participacao,
    // que segue `active`. Sem o cruzamento, a viagem de 2024 arquivada com um
    // residuo continuaria cobrando esse residuo na tela principal, com link
    // para um grupo que saiu da listagem -- o mesmo cuidado de `my-balance`.
    const { data: minhas, error: erroMinhas } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", user.id)
      .eq("status", "active");

    if (erroMinhas) {
      console.error("Erro ao ler os meus grupos:", erroMinhas);
      return NextResponse.json(
        { error: "Não foi possível carregar os seus grupos" },
        { status: 500 }
      );
    }

    const meusIds = Array.from(
      new Set((minhas ?? []).map((m) => m.group_id).filter(Boolean))
    );

    const vazio = {
      success: true,
      credito: { linhas: [], total: 0, sem_devedor: 0 },
      periodo,
      meses,
      today: hoje,
      viewer_user_id: user.id,
    };

    if (meusIds.length === 0) return NextResponse.json(vazio);

    const { data: grupos, error: erroGrupos } = await supabase
      .from("expense_groups")
      .select("id, name, default_split_type")
      .in("id", meusIds)
      .eq("is_active", true);

    if (erroGrupos) {
      console.error("Erro ao ler os grupos ativos:", erroGrupos);
      return NextResponse.json(
        { error: "Não foi possível carregar os seus grupos" },
        { status: 500 }
      );
    }

    const ativos = grupos ?? [];
    if (ativos.length === 0) return NextResponse.json(vazio);

    const groupIds = ativos.map((g) => g.id);

    // ----------------------------------------------------------------
    // 2. Os membros ativos de cada grupo, em ordem ESTAVEL, com o peso
    // ----------------------------------------------------------------
    // A ordem e o desempate do centavo em `ratearPorPeso`: na divisao igual
    // TODOS os restos empatam, entao quem leva o centavo e quem vem primeiro
    // nesta lista. Sem ordem fixa, o centavo trocaria de pessoa a cada
    // carregamento da tela. `joined_at` resolve quase sempre; `user_id` cobre
    // dois membros entrando no mesmo instante.
    //
    // O `.order()` vem do banco e vale para a lista INTEIRA; o agrupamento por
    // grupo abaixo preserva essa ordem porque percorre as linhas na ordem
    // recebida.
    const { data: membrosCrus, error: erroMembros } = await supabase
      .from("group_members")
      .select("group_id, user_id, joined_at, percentage")
      .in("group_id", groupIds)
      .eq("status", "active")
      .order("joined_at", { ascending: true })
      .order("user_id", { ascending: true });

    if (erroMembros) {
      console.error("Erro ao ler os membros dos grupos:", erroMembros);
      return NextResponse.json(
        { error: "Não foi possível carregar os membros dos seus grupos" },
        { status: 500 }
      );
    }

    const membrosPorGrupo = new Map<
      string,
      { user_id: string; percentage: number | null }[]
    >();
    for (const m of membrosCrus ?? []) {
      if (!m.user_id) continue;
      const lista = membrosPorGrupo.get(m.group_id) ?? [];
      lista.push({ user_id: m.user_id, percentage: m.percentage });
      membrosPorGrupo.set(m.group_id, lista);
    }

    // ----------------------------------------------------------------
    // 3. O nome dos devedores
    // ----------------------------------------------------------------
    // O perfil pode simplesmente NAO VIR, sem erro: as policies de SELECT de
    // `profiles` sao `id = auth.uid()`, `is_public = TRUE` (002) e "conexao
    // aceita" (010), e nenhuma delas olha `group_members`. Dividir a conta com
    // alguem nao da acesso ao perfil dele, e o PostgREST nao reclama -- devolve
    // menos linhas. Esse caminho e normal, e quem escreve o rotulo no lugar do
    // nome e `devedorNaLinha` (lib/credito-de-grupo.ts).
    const userIds = Array.from(
      new Set((membrosCrus ?? []).map((m) => m.user_id).filter(Boolean))
    );

    const { data: perfis } = userIds.length
      ? await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds)
      : { data: [] as { id: string; full_name: string | null }[] };

    const nomePorUsuario = new Map(
      (perfis ?? []).map((p) => [p.id, p.full_name ?? null] as const)
    );

    // ----------------------------------------------------------------
    // 4. O REALIZADO de todos os grupos
    // ----------------------------------------------------------------
    // Duas consultas em vez de um embed, pelo mesmo motivo da rota do
    // fechamento: `financial_transactions` tem uma coluna `group_id` E e alvo
    // de `group_transactions.transaction_id`, e embed com mais de um caminho
    // possivel responde PGRST201 numa rota que ninguem tocou -- o apagao que a
    // 038 ja causou neste projeto.
    const { data: vinculos, error: erroVinculos } = await supabase
      .from("group_transactions")
      .select("group_id, transaction_id")
      .in("group_id", groupIds);

    if (erroVinculos) {
      console.error("Erro ao ler as despesas dos grupos:", erroVinculos);
      return NextResponse.json(
        { error: "Não foi possível carregar as despesas dos seus grupos" },
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
      console.error("Erro ao ler as transacoes dos grupos:", erroRealizadas);
      return NextResponse.json(
        { error: "Não foi possível carregar as despesas dos seus grupos" },
        { status: 500 }
      );
    }

    const realizadaPorId = new Map(
      (realizadas ?? []).map((t) => [t.id, t] as const)
    );

    // A MESMA transacao pode estar vinculada a mais de um grupo, e o vinculo e
    // que diz a qual. Percorrer `group_transactions` -- e nao as transacoes --
    // e o que mantem cada linha no grupo dela.
    const realizadoPorGrupo = new Map<string, LinhaCrua[]>();
    for (const v of vinculos ?? []) {
      const transacao = realizadaPorId.get(v.transaction_id);
      if (!transacao) continue;
      const lista = realizadoPorGrupo.get(v.group_id) ?? [];
      lista.push(linhaDoRealizado(transacao));
      realizadoPorGrupo.set(v.group_id, lista);
    }

    // ----------------------------------------------------------------
    // 5. O PREVISTO de todos os grupos
    // ----------------------------------------------------------------
    // `direction` e lida da view e repassada crua: a precedencia entre o tipo
    // da ocorrencia e o da regra recorrente e da 027, e refazer esse COALESCE
    // aqui e o defeito que ela fechou. A exclusao da conta com baixa
    // (`status = 'paid'`) mora em `linhaDoPrevisto`, e nao num `.neq()` daqui:
    // um filtro de consulta trocado numa refatoracao nao quebra assercao
    // nenhuma, e o defeito que ele cria e um total dobrado que parece plausivel.
    const { data: previstas, error: erroPrevistas } = await supabase
      .from("scheduled_transactions_effective")
      .select("id, description, amount, due_date, user_id, status, direction, group_id")
      .in("group_id", groupIds);

    if (erroPrevistas) {
      console.error("Erro ao ler as previstas dos grupos:", erroPrevistas);
      return NextResponse.json(
        { error: "Não foi possível carregar as contas previstas" },
        { status: 500 }
      );
    }

    const previstoPorGrupo = new Map<string, LinhaCrua[]>();
    for (const p of previstas ?? []) {
      const linha = linhaDoPrevisto(p);
      if (!linha) continue;
      const lista = previstoPorGrupo.get(p.group_id) ?? [];
      lista.push(linha);
      previstoPorGrupo.set(p.group_id, lista);
    }

    // ----------------------------------------------------------------
    // 6. Um fechamento por grupo e por mes, e o recorte do meu credito
    // ----------------------------------------------------------------
    const fechamentos: FechamentoDeGrupo[] = [];

    for (const grupo of ativos) {
      const membrosDoGrupo = membrosPorGrupo.get(grupo.id) ?? [];
      if (membrosDoGrupo.length === 0) continue;

      // Quem decide se o peso gravado vale -- modo `percentage` com a soma
      // fechando 100% -- e `divisaoDoPeriodo`. Esta rota le e repassa; ela nao
      // tem regra propria sobre porcentagem.
      const divisao = divisaoDoPeriodo(grupo.default_split_type, membrosDoGrupo);

      // O peso vai DENTRO do membro, e nao num array paralelo:
      // `divisaoDoPeriodo` devolve na ordem que recebeu, que e a ordem estavel
      // da consulta. Um segundo array e uma ordem a mais para sair de
      // sincronia, e o defeito que ela produz e a parte de A no nome de B.
      const membros = membrosDoGrupo.map((m, i) => ({
        user_id: m.user_id,
        full_name: nomePorUsuario.get(m.user_id) ?? null,
        peso: divisao.pesos[i].peso,
      }));

      const linhas = [
        ...(realizadoPorGrupo.get(grupo.id) ?? []),
        ...(previstoPorGrupo.get(grupo.id) ?? []),
      ];

      for (const mes of meses) {
        fechamentos.push({
          grupo: { id: grupo.id, nome: grupo.name },
          fechamento: fecharMes(linhas, membros, mes),
        });
      }
    }

    return NextResponse.json({
      success: true,
      credito: creditoAReceber(fechamentos, user.id),
      /** O periodo efetivamente usado -- `?de=`/`?ate=` invalido cai no mes corrente. */
      periodo,
      /** Os meses fechados, em 'AAAA-MM'. A tela rotula por eles. */
      meses,
      today: hoje,
      viewer_user_id: user.id,
    });
  } catch (error) {
    console.error("Erro em GET my-credit:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
