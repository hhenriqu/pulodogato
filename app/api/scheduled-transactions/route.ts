// GET  /api/scheduled-transactions   agenda de contas previstas
// POST /api/scheduled-transactions   lanca uma conta avulsa (sem regra fixa)
//
// A leitura sai da view scheduled_transactions_effective, e nao da tabela: e
// ela que responde "esta vencida?" sem que ninguem precise gravar um status
// que envelhece sozinho a meia-noite. A view e security_invoker, entao a RLS
// da tabela base continua valendo.
//
// O QUE DE UM CARTAO SAI DAQUI (HMO-209): a compra individual. A fatura fica.
// A regra, com o porque, esta em lib/agenda-do-cartao.ts -- ela e compartilhada
// com /summary, que alimenta o cabecalho da mesma pagina.
//
// E O QUE ENTRA (HMO-227): a fatura ABERTA, sintetizada de card_invoice_lines e
// nunca gravada. Fechar a fatura e manual e o botao mora em /dashboard/budgets,
// entao quem nao abre Orcamentos nunca via a fatura do cartao em Contas a
// Pagar. A sintese sai da MESMA funcao pura que o /summary chama, pela mesma
// razao de sempre: o cabecalho e as linhas da mesma tela nao podem discordar.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { materializarAgenda, horizonteAte } from "@/lib/services/scheduled";
import { isIsoDate, today } from "@/lib/recurrence";
import {
  agendaComFaturasAbertas,
  agendaSemCompraNoCartao,
} from "@/lib/agenda-do-cartao";
import { faturasPrevistasDaJanela } from "@/lib/services/fatura-prevista";

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
    const de = url.searchParams.get("from") ?? today();
    const ate = url.searchParams.get("to") ?? horizonteAte();
    const status = url.searchParams.get("status");
    const groupId = url.searchParams.get("group_id");
    // A geracao e o padrao: sem ela, o usuario abre a tela no dia 1 e nao ve o
    // mes novo. `?generate=false` existe para quem so quer ler (relatorio).
    const gerar = url.searchParams.get("generate") !== "false";

    if (!isIsoDate(de) || !isIsoDate(ate)) {
      return NextResponse.json(
        { error: "Datas devem estar no formato AAAA-MM-DD" },
        { status: 400 }
      );
    }

    let geradas = 0;
    if (gerar) {
      try {
        const agenda = await materializarAgenda(supabase, user.id, { de: today(), ate });
        geradas = agenda.criadas;
      } catch (erroAgenda) {
        // Ler a agenda existente ainda tem valor; falhar aqui apagaria a tela
        // inteira por causa das linhas que faltam.
        console.error("Não foi possível materializar a agenda:", erroAgenda);
      }
    }

    let query = supabase
      .from("scheduled_transactions_effective")
      .select(
        `
        *,
        category:transaction_categories(*),
        account:financial_accounts(id, name, account_type, color_hex),
        group:expense_groups(id, name, group_code)
      `
      )
      .gte("due_date", de)
      .lte("due_date", ate)
      .order("due_date", { ascending: true });

    if (groupId) query = query.eq("group_id", groupId);

    if (status === "open") {
      // "em aberto" e o filtro que a tela usa: pendente ou vencida.
      query = query.eq("status", "pending");
    } else if (status && status !== "all") {
      query = query.eq("status", status);
    } else if (!status) {
      // Cancelada e pulada so aparecem se pedirem explicitamente.
      query = query.in("status", ["pending", "paid"]);
    }

    const { data: scheduled, error } = await query;

    if (error) {
      console.error("Erro ao listar contas previstas:", error);
      return NextResponse.json(
        { error: "Não foi possível carregar as contas previstas" },
        { status: 500 }
      );
    }

    // O FILTRO E DEPOIS DA CONSULTA, EM JAVASCRIPT (HMO-209)
    //
    // Nao e preguica: a regra precisa de duas colunas que moram em tabelas
    // diferentes (`notes` na previsao, `account_type` na conta), e no PostgREST
    // um filtro sobre coluna de embed (`account.account_type`) transforma o
    // LEFT JOIN em INNER -- as previsoes SEM conta sairiam da resposta junto.
    // Conta a pagar sem conta escolhida e o caso mais comum da tela: ela
    // desapareceria inteira para quem nunca escolheu conta nenhuma.
    //
    // O volume e o mesmo que ja vem no corpo da resposta (uma janela de meses),
    // entao filtrar aqui nao paga nada.
    const daAgenda = agendaSemCompraNoCartao(scheduled ?? []);

    // -----------------------------------------------------------------------
    // A FATURA ABERTA ENTRA AQUI (HMO-227)
    // -----------------------------------------------------------------------
    // SO QUANDO O FILTRO DE STATUS INCLUI PENDENTE. A fatura sintetizada e, por
    // construcao, uma previsao em aberto: devolve-la em `?status=paid` poria uma
    // linha pendente numa lista de pagas -- e em `?status=cancelled` ela
    // apareceria numa lista que a pessoa abriu para ver o que NAO vai acontecer.
    const incluiPendente =
      !status || status === "all" || status === "open" || status === "pending";

    const fatura = incluiPendente
      ? await faturasPrevistasDaJanela(supabase, user.id, { de, ate, hoje: today() })
      : { previstas: [], semVencimento: [] };

    return NextResponse.json({
      scheduled: agendaComFaturasAbertas(daAgenda, fatura.previstas),
      // Os cartoes com fatura aberta e sem `due_day`: eles NAO tem linha na
      // agenda porque nao ha vencimento para calcular, e a tela precisa dizer
      // isso em vez de deixar a fatura desaparecer calada. Ver
      // `FaturaSemVencimento` em lib/agenda-do-cartao.ts.
      cards_without_due_day: fatura.semVencimento,
      generated: geradas,
      range: { from: de, to: ate },
    });
  } catch (error) {
    console.error("Erro na API de contas previstas:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const {
      description,
      amount,
      category_id,
      subcategory_id,
      account_id,
      group_id,
      due_date,
      notes,
      transaction_type,
      currency,
    } = body;

    if (!description?.trim()) {
      return NextResponse.json(
        { error: "Descrição é obrigatória" },
        { status: 400 }
      );
    }

    if (!amount || Number(amount) <= 0) {
      return NextResponse.json(
        { error: "Valor deve ser maior que zero" },
        { status: 400 }
      );
    }

    if (!category_id) {
      return NextResponse.json(
        { error: "Categoria é obrigatória" },
        { status: 400 }
      );
    }

    if (!isIsoDate(due_date)) {
      return NextResponse.json(
        { error: "Vencimento deve estar no formato AAAA-MM-DD" },
        { status: 400 }
      );
    }

    // A DIRECAO DA PREVISAO (HMO-188, migration 027)
    //
    // `scheduled_transactions.amount` tem `CHECK (amount > 0)`: a ocorrencia nao
    // guarda sinal. Quem diz se aquilo entra ou sai era so
    // `recurring_rules.transaction_type` -- e uma previsao AVULSA, que e o que
    // esta rota cria, nao tem regra. A baixa caia no `?? "expense"`, e confirmar
    // o recebimento de uma receita prevista gravaria o valor NEGATIVO.
    //
    // O DEFAULT e 'expense' e nao um erro 400: toda chamada anterior a HMO-188
    // (a tela /dashboard/bills) cadastra conta a pagar e nao manda este campo.
    // Exigir o campo quebraria aquela tela, e adivinhar pelo `is_expense` da
    // categoria seria uma segunda fonte de verdade para a direcao.
    //
    // 'transfer' e recusado aqui e no CHECK do banco. Uma previsao de
    // transferencia nao muda patrimonio nenhum, e o terceiro caso faria toda
    // soma de agenda ter de trata-lo -- o tratamento esquecido contaria a perna
    // de saida como despesa prevista.
    const direcao = transaction_type ?? "expense";
    if (direcao !== "income" && direcao !== "expense") {
      return NextResponse.json(
        { error: "A conta prevista tem que ser income ou expense" },
        { status: 400 }
      );
    }

    // -----------------------------------------------------------------------
    // A PREVISAO E EM REAL (HMO-184, migration 034)
    // -----------------------------------------------------------------------
    // `currency` NAO entra no INSERT abaixo, e isso e deliberado: a coluna cai
    // no DEFAULT 'BRL' e a 034 poe um CHECK garantindo que ela nunca saia dali.
    // A razao e a mesma que a HMO-188 ja escreve na tela do lancamento -- a
    // cotacao de uma data futura nao existe --, e o furo concreto esta na
    // BAIXA: [id]/pay insere em `financial_transactions` sem mandar `currency`
    // nem `exchange_rate`, entao uma previsao em dolar daria baixa como se
    // fosse em real, pelo DEFAULT (BRL, 1). O par e consistente consigo mesmo,
    // entao o CHECK da 026 nao pega. Erro de 80% para menos, sem erro nenhum.
    //
    // ESTA RECUSA EXISTE PARA QUE O CAMPO IGNORADO NAO FIQUE SILENCIOSO. Sem
    // ela, um cliente que mandasse `currency: 'USD'` -- a fila offline, um app
    // futuro, um script -- receberia 201 e uma linha em BRL com o valor em
    // dolar dentro. O 201 e a parte cara: ele diz que deu certo. Melhor um 400
    // que explica o que fazer, igual ao do formulario de lancamento.
    //
    // Nao e `!== 'BRL'` sobre o cru. Tres entradas significam "nao informou" e
    // tem de passar reto: `undefined` (o caso normal -- nenhum cliente de hoje
    // manda o campo), `null` e a string vazia, que e o que um <select> sem
    // escolha envia. A mesma leitura de /api/financial-accounts, que ja trata
    // `""` como ausencia. Sem isso o campo vazio produziria a recusa "Lance em
    //  no dia em que pagar" -- uma frase com um buraco no meio.
    const moedaPedida =
      currency == null ? "" : String(currency).trim().toUpperCase();

    if (moedaPedida !== "" && moedaPedida !== "BRL") {
      return NextResponse.json(
        {
          error: `Conta prevista é sempre em reais: a cotação de uma data futura ainda não existe. Lance em ${moedaPedida} no dia em que ${
            direcao === "income" ? "receber" : "pagar"
          }, com a cotação do dia.`,
        },
        { status: 400 }
      );
    }

    if (group_id) {
      const { data: membro } = await supabase
        .from("group_members")
        .select("id")
        .eq("group_id", group_id)
        .eq("user_id", user.id)
        .eq("status", "active")
        .single();

      if (!membro) {
        return NextResponse.json(
          { error: "Você não participa deste grupo" },
          { status: 403 }
        );
      }
    }

    const { data: scheduled, error } = await supabase
      .from("scheduled_transactions")
      .insert({
        user_id: user.id,
        category_id,
        // HMO-216. A subcategoria atravessa a PREVISAO: a baixa
        // (`[id]/pay`) copia este campo para o lancamento, e sem ele a tela
        // aceitaria a subcategoria na conta prevista e a perderia na
        // confirmacao -- sem erro nenhum, porque a coluna e nulavel.
        //
        // `|| null` e nao `""`: a coluna e uuid, e string vazia volta 22P02.
        subcategory_id: subcategory_id || null,
        account_id: account_id || null,
        group_id: group_id || null,
        description: description.trim(),
        amount: Math.abs(Number(amount)),
        due_date,
        notes: notes || null,
        transaction_type: direcao,
      })
      .select(
        `
        *,
        category:transaction_categories(*),
        account:financial_accounts(id, name, account_type, color_hex),
        group:expense_groups(id, name, group_code)
      `
      )
      .single();

    if (error) {
      console.error("Erro ao criar conta prevista:", error);
      return NextResponse.json(
        { error: "Não foi possível criar a conta prevista" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { message: "Conta prevista criada", scheduled },
      { status: 201 }
    );
  } catch (error) {
    console.error("Erro na API de contas previstas:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
