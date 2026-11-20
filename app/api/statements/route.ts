// GET  /api/statements           os extratos ja enviados
// POST /api/statements           envia um arquivo OFX/CSV e guarda as linhas
//
// O arquivo chega como TEXTO no corpo do JSON, lido pelo navegador. Nao ha
// multipart aqui de proposito: o conteudo de um extrato e texto puro, e o
// caminho sem upload evita depender de storage para uma funcionalidade que so
// precisa ler o arquivo uma vez.
//
// Nada entra em financial_transactions por esta rota. O extrato para em
// statement_entries, que e area de espera -- o porque esta no cabecalho da
// migration 009. Quem cria o lancamento e a rota PATCH das entradas, com a
// categoria que o usuario escolheu.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { parseStatement, type ParseResult } from "@/lib/statement";
import { lerExtratoC6, type EntradaC6 } from "@/lib/extrato-c6";

// De onde e o arquivo (087, issue #447). 'auto' e o OFX/CSV generico de sempre;
// os do C6 sao lidos pelo formato proprio, que o usuario escolhe na tela porque
// a conta e a fatura do C6 tem formatos diferentes.
const ORIGENS = ["auto", "c6_conta", "c6_cartao"] as const;
type Origem = (typeof ORIGENS)[number];

/** 5 MB de texto: um ano de extrato em OFX raramente passa de 1 MB. */
const TAMANHO_MAXIMO = 5 * 1024 * 1024;
/** Acima disto o arquivo nao e um extrato, e a tela de revisao fica inusavel. */
const LINHAS_MAXIMAS = 5000;

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

    const { data: imports, error } = await supabase
      .from("statement_imports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Erro ao listar extratos:", error);
      return NextResponse.json(
        { error: "Não foi possível carregar os extratos" },
        { status: 500 }
      );
    }

    // Quantas linhas ainda esperam decisao, por extrato. Sem este numero a tela
    // lista arquivos identicos sem dizer qual ainda tem trabalho pendente.
    const ids = (imports ?? []).map((i) => i.id);
    const { data: pendentes } = ids.length
      ? await supabase
          .from("statement_entries")
          .select("import_id")
          .in("import_id", ids)
          .eq("status", "pending")
      : { data: [] };

    const porImport = new Map<string, number>();
    for (const linha of pendentes ?? []) {
      porImport.set(linha.import_id, (porImport.get(linha.import_id) ?? 0) + 1);
    }

    // As contas vem numa segunda consulta: o PostgREST embute a relacao, mas a
    // tela so precisa do nome e da cor.
    const contaIds = Array.from(new Set((imports ?? []).map((i) => i.account_id)));
    const { data: contas } = contaIds.length
      ? await supabase
          .from("financial_accounts")
          .select("id, name, account_type, color_hex")
          .in("id", contaIds)
      : { data: [] };
    const contaPorId = new Map((contas ?? []).map((c) => [c.id, c]));

    return NextResponse.json({
      imports: (imports ?? []).map((i) => ({
        ...i,
        pending_count: porImport.get(i.id) ?? 0,
        account: contaPorId.get(i.account_id) ?? null,
      })),
    });
  } catch (error) {
    console.error("Erro na API de extratos:", error);
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
    const { accountId, fileName, content, source, invoiceMonth } = body as {
      accountId?: string;
      fileName?: string;
      content?: string;
      source?: string;
      invoiceMonth?: string;
    };

    const origem: Origem = ORIGENS.includes(source as Origem) ? (source as Origem) : "auto";
    if (source != null && source !== origem) {
      return NextResponse.json({ error: "Origem do arquivo inválida" }, { status: 400 });
    }

    // O mes da fatura decide em que mes caem as parcelas 2+ e vira o
    // invoice_month_override do lancamento. Sem ele a fatura sairia espalhada
    // pelos meses das compras originais.
    const mesDaFatura = String(invoiceMonth ?? "").trim();
    if (origem === "c6_cartao" && !/^\d{4}-(0[1-9]|1[0-2])$/.test(mesDaFatura)) {
      return NextResponse.json(
        { error: "Informe o mês da fatura (AAAA-MM)" },
        { status: 400 }
      );
    }

    if (!accountId) {
      return NextResponse.json(
        { error: "Escolha a conta do extrato" },
        { status: 400 }
      );
    }

    if (typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "Arquivo vazio" }, { status: 400 });
    }

    if (content.length > TAMANHO_MAXIMO) {
      return NextResponse.json(
        { error: "Arquivo muito grande. Exporte um período menor." },
        { status: 413 }
      );
    }

    // A conta tem que ser do proprio usuario. A RLS do 009 ja barraria, mas com
    // um erro do Postgres; aqui o usuario le uma frase.
    const { data: conta } = await supabase
      .from("financial_accounts")
      .select("id, name, account_type")
      .eq("id", accountId)
      .eq("user_id", user.id)
      .single();

    if (!conta) {
      return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
    }

    // A fatura so faz sentido num cartao, e o extrato da conta so fora dele:
    // trocar os dois gravaria compras do cartao no saldo da conta corrente.
    const ehCartao = conta.account_type === "credit_card";
    if (origem === "c6_cartao" && !ehCartao) {
      return NextResponse.json(
        { error: "A fatura do cartão precisa ir para uma conta do tipo cartão de crédito" },
        { status: 400 }
      );
    }
    if (origem === "c6_conta" && ehCartao) {
      return NextResponse.json(
        { error: "O extrato da conta corrente não pode ir para um cartão de crédito" },
        { status: 400 }
      );
    }

    const resultado: Omit<ParseResult, "entries"> & { entries: Array<Partial<EntradaC6> & ParseResult["entries"][number]> } =
      origem === "auto"
        ? parseStatement(content)
        : lerExtratoC6(content, {
            tipo: origem === "c6_cartao" ? "cartao" : "conta",
            mesDaFatura: origem === "c6_cartao" ? mesDaFatura : null,
          });

    if (resultado.entries.length === 0) {
      return NextResponse.json(
        {
          error:
            origem === "auto"
              ? "Não encontrei nenhum lançamento neste arquivo. Confira se é o extrato em OFX ou CSV exportado pelo banco."
              : "Não encontrei nenhum lançamento do C6 neste arquivo.",
          warnings: resultado.warnings,
        },
        { status: 422 }
      );
    }

    if (resultado.entries.length > LINHAS_MAXIMAS) {
      return NextResponse.json(
        { error: `Extrato com ${resultado.entries.length} lançamentos. Exporte um período menor.` },
        { status: 413 }
      );
    }

    const { data: novoImport, error: erroImport } = await supabase
      .from("statement_imports")
      .insert({
        user_id: user.id,
        account_id: accountId,
        file_name: (fileName || "extrato").slice(0, 200),
        file_format: resultado.format,
        period_start: resultado.periodStart,
        period_end: resultado.periodEnd,
        entry_count: resultado.entries.length,
        source: origem,
        invoice_month: origem === "c6_cartao" ? `${mesDaFatura}-01` : null,
      })
      .select()
      .single();

    if (erroImport || !novoImport) {
      console.error("Erro ao criar import:", erroImport);
      return NextResponse.json(
        { error: "Não foi possível registrar o extrato" },
        { status: 500 }
      );
    }

    // `ignoreDuplicates` e o que faz reimportar o mesmo arquivo ser inofensivo:
    // o conflito e no indice unico (account_id, fingerprint) do 009.
    const { data: inseridas, error: erroLinhas } = await supabase
      .from("statement_entries")
      .upsert(
        resultado.entries.map((e) => ({
          import_id: novoImport.id,
          user_id: user.id,
          account_id: accountId,
          fit_id: e.fitId,
          fingerprint: e.fingerprint,
          posted_at: e.postedAt,
          amount: e.amount,
          description: e.description.slice(0, 500),
          memo: e.memo?.slice(0, 500) ?? null,
          installment_number: e.installmentNumber ?? null,
          installment_total: e.installmentTotal ?? null,
          purchase_date: e.purchaseDate ?? null,
          card_last4: e.cardLast4?.slice(0, 8) ?? null,
          bank_category: e.bankCategory?.slice(0, 200) ?? null,
          suggested_action: e.suggestedAction ?? null,
        })),
        { onConflict: "account_id,fingerprint", ignoreDuplicates: true }
      )
      .select("id");

    if (erroLinhas) {
      console.error("Erro ao gravar linhas do extrato:", erroLinhas);
      // O import fica sem linhas e seria lixo na tela. Desfaz.
      await supabase.from("statement_imports").delete().eq("id", novoImport.id);
      return NextResponse.json(
        { error: "Não foi possível gravar os lançamentos do extrato" },
        { status: 500 }
      );
    }

    const novas = inseridas?.length ?? 0;
    const duplicadas = resultado.entries.length - novas;

    const { data: atualizado } = await supabase
      .from("statement_imports")
      .update({ entry_count: novas, duplicate_count: duplicadas })
      .eq("id", novoImport.id)
      .select()
      .single();

    return NextResponse.json(
      {
        import: atualizado ?? novoImport,
        parsed: resultado.entries.length,
        inserted: novas,
        duplicates: duplicadas,
        warnings: resultado.warnings,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Erro ao importar extrato:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
