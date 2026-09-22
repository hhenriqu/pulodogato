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
import { parseStatement } from "@/lib/statement";

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
    const { accountId, fileName, content } = body as {
      accountId?: string;
      fileName?: string;
      content?: string;
    };

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
      .select("id, name")
      .eq("id", accountId)
      .eq("user_id", user.id)
      .single();

    if (!conta) {
      return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
    }

    const resultado = parseStatement(content);

    if (resultado.entries.length === 0) {
      return NextResponse.json(
        {
          error:
            "Não encontrei nenhum lançamento neste arquivo. Confira se é o extrato em OFX ou CSV exportado pelo banco.",
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
