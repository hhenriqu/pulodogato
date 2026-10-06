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
//
// A LINHA DE GRUPO ENTRA PELA MINHA PARTE (HMO-306)
// -------------------------------------------------
// Esta foi a QUARTA leitura do «Total de contas», e a ultima a ser consertada.
// Ate a HMO-306 ela nao chamava `parteConfiguradaDoMembro` nem trazia
// `group_id` no `select`: a minha conta de grupo de R$ 1.000,00 era descontada
// CHEIA de um grupo que me cobra R$ 300,00. Ela subestimava o quanto se pode
// gastar em R$ 700,00 -- errando para o lado seguro, mas por acidente: ela
// simplesmente nao sabia que havia o que dividir.
//
// O FILTRO DE `user_id` NAO MUDOU, e a diferenca para a tela de Despesas e
// deliberada. La a HMO-303 trocou `user_id = eu` por
// `user_id = eu OR group_id IS NOT NULL`, porque LISTAR a conta que o outro
// membro lancou e informacao que faltava. Aqui a pergunta e "quanto EU posso
// gastar", e a parte do outro ja e contada pela parte DELE: trazer a linha
// dele para dentro desta soma descontaria o mesmo dinheiro duas vezes, uma em
// cada carteira.
//
// E O DESCONHECIDO VALE O VALOR CHEIO. Grupo cujos membros a RLS nao entregou
// => nenhum peso => `parteConfiguradaDoMembro` devolve o valor inteiro. Aqui
// essa regra importa mais do que em qualquer outra leitura do app: custo fixo
// subestimado e o app PROMETENDO dinheiro que nao existe.

import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import { today } from "@/lib/recurrence";
import { materializarAgenda } from "@/lib/services/scheduled";
import {
  montarParticipantesPorGrupo,
  parteConfiguradaDoMembro,
  type ParticipantesPorGrupo,
} from "@/lib/parte-do-grupo";
import {
  calcularQuantoPossoGastar,
  fimDoMes,
  type FaturaParaGastar,
  type PrevistaParaGastar,
  type MetaParaGastar,
} from "@/lib/safe-to-spend";

interface LinhaPrevista {
  id: string;
  amount: number | string;
  due_date: string;
  notes: string | null;
  /**
   * LOAD-BEARING (HMO-306). Sem ele nada depois daqui sabe que havia o que
   * dividir, e a linha de grupo volta a ser descontada cheia -- sem erro, sem
   * log e com um numero menor e plausivel na tela.
   */
  group_id: string | null;
  recurring_rule:
    | { transaction_type: string }
    | { transaction_type: string }[]
    | null;
}

/** Uma linha de `card_invoice_lines`, do jeito que o select acima a pede. */
interface LinhaDeFatura {
  account_id: string;
  invoice_month: string;
  invoice_due_date: string | null;
  invoice_amount: number | string | null;
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
        "id, amount, due_date, notes, group_id, recurring_rule:recurring_rules(transaction_type)"
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

    // ------------------------------------------------------------------
    // OS PESOS DO GRUPO (HMO-306)
    // ------------------------------------------------------------------
    // `id, user_id, percentage` SAO LOAD-BEARING, pelas mesmas tres razoes das
    // cinco rotas da HMO-303:
    //
    //   * sem `percentage`, o grupo 70/30 volta a dividir IGUAL -- sem erro e
    //     sem log, so com o numero errado;
    //   * sem `user_id` a linha nao e participante de nada, porque
    //     `ratearPorPeso` indexa o resultado por ele;
    //   * sem `id` o desempate do centavo da sobra cai no fallback de
    //     `user_id`, e duas leituras ordenadas por chaves diferentes discordam
    //     em R$ 0,01 -- acima da tolerancia de R$ 0,004 do controle da HMO-298.
    //
    // `ORDER BY` NAO aparece aqui de proposito: quem fixa a ordem e
    // `montarParticipantesPorGrupo`, uma vez e num lugar que a suite alcanca.
    // Seis `ORDER BY` espalhados pelas consultas seriam seis lugares para
    // esquecer, e o esquecido nao da erro nenhum -- da um centavo.
    const gruposEnvolvidos = Array.from(
      new Set(
        ((previstas ?? []) as LinhaPrevista[])
          .map((p) => p.group_id)
          .filter((id): id is string => Boolean(id))
      )
    );

    let pesosPorGrupo: ParticipantesPorGrupo = new Map();

    if (gruposEnvolvidos.length > 0) {
      const { data: membros, error: erroMembros } = await supabase
        .from("group_members")
        .select("id, group_id, user_id, percentage, status")
        .in("group_id", gruposEnvolvidos)
        .eq("status", "active");

      if (erroMembros) {
        // Sem os pesos, `parteConfiguradaDoMembro` mantem o valor CHEIO -- o
        // comportamento de antes da HMO-306, que erra para CIMA. E a direcao
        // certa do erro justamente nesta rota: um custo fixo subestimado aqui
        // faz o app prometer dinheiro que nao sobra. Por isso tambem nao ha
        // flag de "indisponivel" como a das metas e a das faturas: o modo de
        // falha ja e o conservador, e nao ha afirmacao falsa a esconder.
        console.error(
          "Posso gastar seguiu descontando a parte do grupo CHEIA:",
          erroMembros
        );
      } else {
        pesosPorGrupo = montarParticipantesPorGrupo(membros ?? []);
      }
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
        // A MINHA PARTE, e nao o valor cheio (HMO-306). Linha fora de grupo
        // atravessa sem mudanca: `parteConfiguradaDoMembro` devolve o valor
        // inteiro quando `group_id` e nulo.
        amount: parteConfiguradaDoMembro(
          p.amount,
          p.group_id,
          pesosPorGrupo,
          user.id
        ),
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

    // ------------------------------------------------------------------
    // AS FATURAS, PARA SEPARAR O QUE ESTE MES COBRA (HMO-290)
    // ------------------------------------------------------------------
    // A armadilha 10 do calculo. O que ele precisa daqui e so a parte DIFERIDA
    // da divida: quanto de cada cartao vence depois do fim do mes.
    //
    // `invoice_month >= o mes corrente` basta, e nao e chute: o vencimento de
    // uma fatura e, no maximo, no mes seguinte ao dela
    // (`card_invoice_due_date` empurra um mes quando o vencimento vem antes do
    // fechamento), entao fatura de mes passado nunca vence depois do fim deste
    // mes. Sem esse teto a consulta traria a vida inteira do cartao.
    //
    // O recorte e `account_id IN (os cartoes do usuario)`, e NAO
    // `user_id = user.id`: `current_balance` e mantido pelo trigger
    // `update_account_balance`, que soma por CONTA e ignora quem lancou. A
    // divida de onde se subtrai inclui a compra de grupo que outra pessoa
    // lancou no meu cartao, e filtrar por `user_id` deixaria a parte diferida
    // dela de fora -- o mesmo recorte dos dois lados, ou a subtracao nao fecha.
    const idsDosCartoes = (contas ?? [])
      .filter((c) => c.account_type === "credit_card")
      .map((c) => c.id);

    const { data: linhasDeFatura, error: erroFaturas } = idsDosCartoes.length
      ? await supabase
          .from("card_invoice_lines")
          .select("account_id, invoice_month, invoice_due_date, invoice_amount")
          .in("account_id", idsDosCartoes)
          .gte("invoice_month", inicioDoMes)
      : { data: [], error: null };

    // Falhar aqui NAO derruba o card, pelo mesmo critério das metas -- mas o
    // efeito e o oposto, e vale ser explicito: sem as faturas, `faturas: []`
    // faz `diferida` ser 0 e a divida INTEIRA voltar a ser descontada, que e o
    // comportamento de antes da HMO-290 e o lado conservador do erro.
    //
    // O que nao se pode fazer e calar: a tela mostraria "R$ 0,00 em parcelas
    // futuras" ao lado de um numero que desconta justamente as parcelas
    // futuras -- duas afirmacoes que se contradizem, e a errada e a que parece
    // tranquilizadora. A flag existe para a tela dizer que nao deu para
    // separar.
    const semDiferido = Boolean(erroFaturas);
    if (erroFaturas) {
      console.error(
        "Posso gastar seguiu descontando a divida INTEIRA dos cartoes:",
        erroFaturas
      );
    }

    // Agrega por (cartao, mes da fatura) -- a mesma agregacao que
    // `GET /api/card-invoices` faz, e pela mesma razao: em que fatura a compra
    // cai e decidido pela view, nunca recalculado aqui.
    const porFatura = new Map<string, FaturaParaGastar>();

    for (const linha of (linhasDeFatura ?? []) as LinhaDeFatura[]) {
      const chave = `${linha.account_id}:${linha.invoice_month}`;
      const atual = porFatura.get(chave);

      if (atual) {
        atual.total = Number(atual.total) + Number(linha.invoice_amount ?? 0);
        continue;
      }

      porFatura.set(chave, {
        account_id: linha.account_id,
        invoice_month: linha.invoice_month,
        due_date: linha.invoice_due_date ?? null,
        total: Number(linha.invoice_amount ?? 0),
      });
    }

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
      // Idem para a parte diferida da divida de cartao (HMO-290): sem as
      // faturas, `dividaDiferida` vem 0 porque a divida inteira voltou a ser
      // descontada -- e nao porque nao ha parcela futura.
      diferido_indisponivel: semDiferido,
      safe_to_spend: calcularQuantoPossoGastar({
        contas: contas ?? [],
        previstas: paraCalculo,
        metas,
        faturas: Array.from(porFatura.values()),
        hoje,
      }),
    });
  } catch (error) {
    console.error("Erro na API de quanto posso gastar:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
