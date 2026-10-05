// GET /api/scheduled-transactions/summary?months=3
// GET /api/scheduled-transactions/summary?de=AAAA-MM-DD&ate=AAAA-MM-DD
//
// O numero que o app nao sabia responder antes: quanto ainda vai sair este mes.
// Serve o cabecalho da tela de contas e o widget do dashboard.
//
// A agregacao e feita aqui, em JavaScript, e nao com um GROUP BY: o PostgREST
// nao expoe agregacao sem criar uma RPC, e uma RPC nova significaria mais uma
// funcao SECURITY DEFINER para auditar (ver migrations 003 e 004). O volume e
// de dezenas de linhas por mes - cabe na memoria sem pensar duas vezes.
//
// ESTA ROTA NAO CONSEGUIA RESPONDER O PASSADO (HMO-173)
// ------------------------------------------------------
// Com `?months=N` a janela comeca no primeiro dia do mes CORRENTE e caminha
// para a frente. Isso e certo para "o que ainda vai sair", e e por isso que o
// painel, ao navegar para agosto, recebia uma lista que nao continha agosto --
// e mostrava zero. `de`/`ate` explicitos resolvem.
//
// O QUE A JANELA EXPLICITA NAO PODE FAZER
// ----------------------------------------
// NENHUMA DAS DUAS CONSULTAS FILTRA POR user_id (HMO-177)
// -------------------------------------------------------
// Isso e deliberado -- a RLS filtra --, mas as policies do 005 nao sao
// `user_id = auth.uid()` e mais nada: elas tambem liberam
// `group_id IS NOT NULL AND is_group_member(group_id)`. Entao a consulta sem
// filtro traz, junto com as minhas linhas, as linhas de GRUPO dos outros
// membros. Um aluguel de R$ 3.000 do grupo Casa aparecia inteiro para as duas
// pessoas: para quem cadastrou a regra e para quem nunca cadastrou nada.
// Por isso cada linha de grupo entra aqui pela parte de um membro -- ver
// lib/parte-do-grupo.ts, que tem a medicao e o controle negativo.
//
// `materializarAgenda` CRIA linhas de vencimento a partir das regras
// recorrentes. Rodar isso sobre um mes que ja passou fabricaria contas
// retroativas -- e, como elas nasceriam vencidas, o app passaria a acusar
// atraso em dividas que o usuario nunca teve. Navegar para tras e leitura; a
// janela de escrita sai de `janelaParaMaterializar`, que nunca comeca antes de
// hoje e devolve `null` quando o periodo inteiro ja passou.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { materializarAgenda } from "@/lib/services/scheduled";
import { addMonthsClamped, today } from "@/lib/recurrence";
import {
  custoFixoMensalDaMinhaParte,
  montarParticipantesPorGrupo,
  parteConfiguradaDoMembro,
  type ParticipantesPorGrupo,
} from "@/lib/parte-do-grupo";
import { janelaParaMaterializar, periodoDaQuery } from "@/lib/periodo-do-painel";
import {
  agendaComFaturasAbertas,
  agendaSemCompraNoCartao,
} from "@/lib/agenda-do-cartao";
import { faturasPrevistasDaJanela } from "@/lib/services/fatura-prevista";
import {
  direcaoDaAgenda,
  somarAgenda,
  somarEmAberto,
  type LinhaDaAgenda,
  type LinhaEmAberto,
} from "@/lib/previsto-x-realizado";
import type { RecurringRule, ScheduledSummary } from "@/types/financial";

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

    const periodo = periodoDaQuery(
      url.searchParams.get("de") ?? url.searchParams.get("from"),
      url.searchParams.get("ate") ?? url.searchParams.get("to")
    );

    if (periodo === "invalido") {
      return NextResponse.json(
        { error: "de e ate devem ser datas AAAA-MM-DD, com de <= ate" },
        { status: 400 }
      );
    }

    let de: string;
    let ate: string;

    if (periodo) {
      de = periodo.de;
      ate = periodo.ate;
    } else {
      const meses = Math.min(
        Math.max(Number(url.searchParams.get("months") ?? 3), 1),
        12
      );
      // Do primeiro dia do mes corrente ate o fim da janela: o resumo do mes
      // tem que incluir o que ja foi pago nos dias que passaram.
      de = `${hoje.slice(0, 7)}-01`;
      ate = addMonthsClamped(de, meses);
    }

    const aMaterializar = janelaParaMaterializar({ de, ate }, hoje);

    if (aMaterializar) {
      try {
        await materializarAgenda(supabase, user.id, aMaterializar);
      } catch (erroAgenda) {
        console.error("Resumo seguiu sem materializar a agenda:", erroAgenda);
      }
    }

    // `currency` NAO entra neste select, e nao e esquecimento (HMO-184). Todo
    // somador daqui para baixo soma `amount` sem converter nada; isso so esta
    // certo porque a conta prevista e SEMPRE em real, garantido pelo
    // `CHECK (currency = 'BRL')` que a migration 034 poe em
    // `scheduled_transactions`. Antes da 034 estava certo por acidente -- a
    // coluna existia desde a 022, ninguem a escrevia, e a primeira rota que
    // gravasse 'USD' faria estas somas misturarem dolar com real sem erro e
    // sempre para MENOS (custo fixo subestimado e insumo do safe-to-spend: o
    // app passaria a prometer dinheiro que nao sobra).
    //
    // Se um dia a previsao em moeda estrangeira for destravada, este select e um
    // dos lugares que PRECISAM mudar junto -- e o cabecalho da 034 lista o
    // primeiro deles, que e a baixa.
    //
    // `notes` E O EMBED DA CONTA ENTRAM NA HMO-209, e nao para serem exibidos:
    // sao as duas colunas de que `previsaoApareceNaAgenda` precisa para separar
    // a fatura (que fica) da compra individual no cartao (que sai). Sem eles
    // este resumo somaria as compras que a lista nao mostra mais, e o "a vencer"
    // do cabecalho discordaria das linhas logo abaixo dele, na MESMA tela -- com
    // o numero maior, que e o que parece certo.
    const { data: linhasBrutas, error } = await supabase
      .from("scheduled_transactions_effective")
      .select(
        "due_date, amount, status, effective_status, group_id, direction, notes, account:financial_accounts(account_type)"
      )
      .gte("due_date", de)
      .lte("due_date", ate);

    if (error) {
      console.error("Erro ao resumir contas previstas:", error);
      return NextResponse.json(
        { error: "Não foi possível calcular o resumo" },
        { status: 500 }
      );
    }

    // ANTES DE QUALQUER SOMA, e antes da varredura de `direction` logo abaixo:
    // uma linha que a tela nao mostra nao pode influenciar nada do que a tela
    // mostra. Filtrado depois, um `direction` nulo numa compra de cartao
    // escondida zeraria o bloco de previsto x realizado inteiro.
    const semCompraDeCartao = agendaSemCompraNoCartao(linhasBrutas ?? []);

    // A FATURA ABERTA ENTRA ANTES DAS SOMAS (HMO-227), pela MESMA leitura e a
    // MESMA funcao pura da lista. Sintetizar so na lista faria o "a vencer" deste
    // cabecalho ficar MENOR que a soma das linhas logo abaixo dele, na mesma
    // tela -- e o numero menor e o que parece certo a quem nao somou na mao.
    //
    // A linha sintetizada vem com `direction: 'expense'` e `group_id: null`, que
    // e o que os dois somadores abaixo leem: ela entra em "a pagar", nunca em "a
    // receber", e nao passa pelo rateio de grupo (o rateio e das COMPRAS, uma a
    // uma, e elas ja estao dentro do total da fatura).
    const previsaoDaFatura = await faturasPrevistasDaJanela(
      supabase,
      user.id,
      { de, ate, hoje }
    );

    const linhas = agendaComFaturasAbertas(
      semCompraDeCartao,
      previsaoDaFatura.previstas
    );

    const { data: regras } = await supabase
      .from("recurring_rules")
      .select("amount, frequency, interval_count, transaction_type, group_id")
      .eq("is_active", true);

    // ------------------------------------------------------------------
    // A DIRECAO DE CADA LINHA DA AGENDA (HMO-186, refeita na HMO-187)
    // ------------------------------------------------------------------
    // `scheduled_transactions.amount` tem CHECK amount > 0: a ocorrencia nao
    // guarda sinal nenhum. Quem diz se aquilo entra ou sai e a coluna
    // `direction` da view, que o 027 acrescentou com a precedencia JA
    // RESOLVIDA: ocorrencia -> regra -> 'expense'.
    //
    // ATE A HMO-187 ISTO ERA UMA SEGUNDA CONSULTA a `recurring_rules`, e ela
    // tinha um furo que a coluna fecha: a precedencia comeca na OCORRENCIA, e
    // uma previsao avulsa de receita (que /api/scheduled-transactions passou a
    // aceitar na HMO-188, gravando `transaction_type` na propria linha) nao tem
    // regra nenhuma. Pela regra antiga ela caia em "sem regra, logo despesa" --
    // uma receita prevista contada como dinheiro saindo, sem erro em lugar
    // nenhum. Refazer o COALESCE aqui seria a segunda copia da precedencia, e a
    // copia esquecida e este defeito.
    //
    // A coluna vem `NOT NULL` na pratica (o COALESCE da view termina em
    // 'expense'), entao a flag abaixo so dispara se a view for trocada por uma
    // que nao a entregue. Ela custa uma varredura e evita o modo de falha caro:
    // sem direcao, TODA linha cairia em despesa, o "a vencer" voltaria a somar
    // o salario e o resultado previsto ficaria negativo no valor dele -- um
    // numero plausivel, com cara de "o mes fecha no vermelho". Mesmo criterio
    // do `reserva_indisponivel` em /api/safe-to-spend: a tela escreve
    // "indisponivel" em vez de mostrar isso.
    const direcaoIndisponivel = (linhas as { direction?: unknown }[])
      .some((l) => l.direction == null);

    if (direcaoIndisponivel) {
      console.error(
        "Resumo seguiu SEM a direcao das linhas previstas: a view scheduled_transactions_effective nao entregou `direction` (migration 027)"
      );
    }

    // Quantos membros ativos tem cada grupo que aparece nas duas consultas.
    // Sem isto a parte dos outros continua contando como minha - ver o cabecalho
    // de lib/parte-do-grupo.ts para a medicao que mostra o numero inflado.
    const gruposEnvolvidos = Array.from(
      new Set(
        [
          ...((regras ?? []) as { group_id?: string | null }[]),
          ...(linhas as { group_id?: string | null }[]),
        ]
          .map((r) => r.group_id)
          .filter((id): id is string => Boolean(id))
      )
    );

    let pesosPorGrupo: ParticipantesPorGrupo = new Map();

    if (gruposEnvolvidos.length > 0) {
      // `id, user_id, percentage` SAO LOAD-BEARING -- ver o comentario identico em
      // app/api/papel-de-pao/painel/route.ts. Sem `percentage` o grupo 70/30
      // volta a dividir igual, sem erro e sem log.
      const { data: membros, error: erroMembros } = await supabase
        .from("group_members")
        .select("id, group_id, user_id, percentage, status")
        .in("group_id", gruposEnvolvidos)
        .eq("status", "active");

      if (erroMembros) {
        // Sem os pesos, `parteConfiguradaDoMembro` mantem o valor CHEIO. Erra
        // para cima, que e o comportamento antigo, em vez de subestimar o custo
        // fixo e fazer o safe-to-spend prometer dinheiro que nao sobra.
        console.error(
          "Resumo seguiu sem dividir a parte do grupo:",
          erroMembros
        );
      } else {
        pesosPorGrupo = montarParticipantesPorGrupo(membros ?? []);
      }
    }

    const custoFixoMensal = custoFixoMensalDaMinhaParte(
      (regras ?? []) as RecurringRule[],
      pesosPorGrupo,
      user.id,
      hoje
    );

    // A agenda de cada mes, guardada crua para os dois somadores fazerem a
    // conta. O acumulo NAO e feito aqui dentro do laco de proposito: as duas
    // regras que ele carregaria -- quais status contam como "previsto" (ver
    // STATUS_FORA_DO_PREVISTO) e para que perna cada linha vai -- sao a
    // definicao das features, e num `else if` de rota elas seriam conferidas
    // por inspecao visual. Foi assim que a mistura de receita e despesa num
    // acumulador so sobreviveu a HMO-186.
    const agendaPorMes = new Map<string, LinhaDaAgenda[]>();
    const emAbertoPorMes = new Map<string, LinhaEmAberto[]>();

    for (const linha of linhas) {
      const mes = String(linha.due_date).slice(0, 7);

      // A linha de grupo entra pela MINHA parte. Nao e refinamento do custo
      // fixo: a policy do 005 devolve tambem as previstas de grupo dos OUTROS
      // membros, entao sem esta divisao a Lais via uma conta de R$ 3.000 no nome
      // do Helio somada ao "quanto ainda vai sair" dela.
      const valor = parteConfiguradaDoMembro(
        linha.amount,
        (linha as { group_id?: string | null }).group_id,
        pesosPorGrupo,
        user.id
      );

      const direcao = direcaoDaAgenda(
        (linha as { direction?: string | null }).direction
      );

      const emAberto = emAbertoPorMes.get(mes) ?? [];
      emAberto.push({
        amount: valor,
        status: String(linha.status),
        effective_status: String(linha.effective_status),
        direcao,
      });
      emAbertoPorMes.set(mes, emAberto);

      // O previsto usa `valor` -- a MINHA parte --, o mesmo numero das somas
      // acima. Usar `linha.amount` cru aqui faria o previsto de um casal
      // discordar do "a vencer" que aparece tres blocos acima, na mesma tela.
      const daAgenda = agendaPorMes.get(mes) ?? [];
      daAgenda.push({ amount: valor, status: String(linha.status), direcao });
      agendaPorMes.set(mes, daAgenda);
    }

    // Array.from em vez de spread: o tsconfig do projeto compila para ES5, onde
    // espalhar um iterador de Map exige --downlevelIteration.
    const resumo: ScheduledSummary[] = Array.from(emAbertoPorMes.keys())
      .map((month) => {
        // Com a direcao indisponivel, o previsto do mes vem ZERADO e com
        // `expected_count: 0`. Nao e "nao havia nada agendado": e o que faz a
        // flag e o `semPrevisao` do bloco calarem a comparacao juntos. Somar as
        // linhas como despesa aqui produziria o numero errado com cara de
        // certo, que e exatamente o que a flag existe para impedir.
        const previsto = direcaoIndisponivel
          ? { entradas: 0, despesas: 0, resultado: 0, quantidade: 0 }
          : somarAgenda(agendaPorMes.get(month) ?? []);

        const emAberto = somarEmAberto(emAbertoPorMes.get(month) ?? []);

        // AS DUAS PERNAS, no lugar do `total_pending` unico que somava as duas
        // (HMO-187). O nome mudou de proposito: um consumidor que ainda leia o
        // campo antigo passa a receber `undefined` e a mostrar o estado
        // "indisponivel", em vez de continuar exibindo em silencio um numero
        // que mistura o salario com as contas.
        //
        // Sem a direcao elas nao saem, e isso NAO e simetria com o previsto
        // acima: se saissem, `direcaoDaAgenda` teria classificado tudo como
        // despesa e o bloco "A vencer" -- que nao le
        // `previsto_indisponivel` -- mostraria de novo o salario somado as
        // contas, exatamente o defeito desta issue. A ausencia do campo e o
        // que faz `somarPrevistas` devolver null e a tela dizer
        // "indisponivel".
        const pernas = direcaoIndisponivel
          ? {}
          : {
              total_pending_expense: emAberto.aPagar.total,
              count_pending_expense: emAberto.aPagar.quantidade,
              total_pending_income: emAberto.aReceber.total,
              count_pending_income: emAberto.aReceber.quantidade,
              total_overdue_expense: emAberto.vencidoAPagar.total,
              count_overdue_expense: emAberto.vencidoAPagar.quantidade,
              total_overdue_income: emAberto.vencidoAReceber.total,
              count_overdue_income: emAberto.vencidoAReceber.quantidade,
            };

        return {
          month,
          ...pernas,
          total_paid: emAberto.pago,
          fixed_monthly_cost: Number(custoFixoMensal.toFixed(2)),
          expected_income: previsto.entradas,
          expected_expense: previsto.despesas,
          expected_result: previsto.resultado,
          expected_count: previsto.quantidade,
        };
      })
      .sort((a, b) => a.month.localeCompare(b.month));

    return NextResponse.json({
      summary: resumo,
      fixed_monthly_cost: Number(custoFixoMensal.toFixed(2)),
      // A tela usa isto para escrever "indisponivel" no bloco de previsto x
      // realizado em vez de mostrar um resultado previsto que ninguem calculou.
      previsto_indisponivel: direcaoIndisponivel,
      range: { from: de, to: ate },
    });
  } catch (error) {
    console.error("Erro no resumo de contas previstas:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
