// GET    /api/statements/[id]   as linhas do extrato, com a sugestao de conciliacao
// DELETE /api/statements/[id]   descarta o extrato inteiro
//
// A CONCILIACAO E CALCULADA NA LEITURA, E NAO GRAVADA
// ----------------------------------------------------
// A tentacao e gravar `suggested_transaction_id` numa coluna na hora do
// import. Rejeitado: a sugestao envelhece. O usuario importa o extrato,
// apaga o lancamento duplicado pela tela de lancamentos, volta aqui -- e a
// coluna continuaria apontando para um lancamento que nao existe mais,
// oferecendo "ja lancado" para uma linha que nao esta lancada em lugar nenhum.
//
// Calculando na leitura, a sugestao sempre reflete o estado de agora. O custo e
// uma consulta a mais por leitura, limitada ao periodo do extrato.
//
// E uma SUGESTAO, nao uma acao: o status so vira 'linked' quando o usuario
// clica. Conciliacao automatica erra em silencio, e o erro dela e apagar do
// app um gasto que aconteceu de verdade.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { conciliar, TOLERANCIA_DIAS_PADRAO } from "@/lib/statement";
import { sugerirParaLinhas } from "@/lib/services/categorization";

function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const { data: extrato } = await supabase
      .from("statement_imports")
      .select("*")
      .eq("id", params.id)
      .single();

    if (!extrato) {
      return NextResponse.json({ error: "Extrato não encontrado" }, { status: 404 });
    }

    const { data: linhas, error } = await supabase
      .from("statement_entries")
      .select("*")
      .eq("import_id", params.id)
      .order("posted_at", { ascending: false });

    if (error) {
      console.error("Erro ao ler linhas do extrato:", error);
      return NextResponse.json(
        { error: "Não foi possível carregar o extrato" },
        { status: 500 }
      );
    }

    const pendentes = (linhas ?? []).filter((l) => l.status === "pending");

    // Os lancamentos ja existentes na MESMA conta e dentro do periodo, com a
    // folga de dias dos dois lados. Filtrar pela conta importa: um almoco de
    // R$ 32 no cartao nao concilia com um almoco de R$ 32 na conta corrente.
    let sugestoes = new Map<string, { transactionId: string; dayGap: number; similarity: number }>();

    if (pendentes.length > 0) {
      const datas = pendentes.map((l) => l.posted_at).sort();
      const de = somarDias(datas[0], -TOLERANCIA_DIAS_PADRAO);
      const ate = somarDias(datas[datas.length - 1], TOLERANCIA_DIAS_PADRAO);

      const { data: existentes } = await supabase
        .from("financial_transactions")
        .select("id, amount, transaction_date, description")
        .eq("account_id", extrato.account_id)
        .gte("transaction_date", de)
        .lte("transaction_date", ate);

      // Lancamentos que JA foram reivindicados por outra linha de extrato nao
      // entram: senao a mesma transacao seria oferecida duas vezes e o usuario
      // apagaria um gasto de verdade achando que era duplicata.
      const { data: jaLigados } = await supabase
        .from("statement_entries")
        .select("transaction_id")
        .eq("account_id", extrato.account_id)
        .not("transaction_id", "is", null);

      const ocupados = new Set((jaLigados ?? []).map((l) => l.transaction_id));
      const livres = (existentes ?? [])
        .filter((t) => !ocupados.has(t.id))
        .map((t) => ({
          id: t.id,
          amount: Number(t.amount),
          transaction_date: String(t.transaction_date).slice(0, 10),
          description: t.description ?? "",
        }));

      const casamentos = conciliar(
        pendentes.map((l) => ({
          fitId: l.fit_id,
          fingerprint: l.fingerprint,
          postedAt: String(l.posted_at).slice(0, 10),
          amount: Number(l.amount),
          description: l.description ?? "",
          memo: l.memo,
        })),
        livres
      );

      sugestoes = new Map(
        casamentos
          .filter((c) => c.transactionId)
          .map((c) => [
            c.fingerprint,
            {
              transactionId: c.transactionId as string,
              dayGap: c.dayGap as number,
              similarity: c.similarity as number,
            },
          ])
      );
    }

    // A descricao do lancamento sugerido, para a tela dizer COM O QUE a linha
    // casou. Sem ela o usuario confirma no escuro.
    const idsSugeridos = Array.from(sugestoes.values()).map((s) => s.transactionId);
    const { data: sugeridos } = idsSugeridos.length
      ? await supabase
          .from("financial_transactions")
          .select("id, description, amount, transaction_date")
          .in("id", idsSugeridos)
      : { data: [] };
    const sugeridoPorId = new Map((sugeridos ?? []).map((t) => [t.id, t]));

    // A categoria sugerida para cada linha pendente -- a regra do usuario ou,
    // na falta dela, o catalogo embutido. Calculada na leitura pela mesma razao
    // da conciliacao (ver o cabecalho): a regra pode ter mudado desde o import,
    // e uma coluna gravada mostraria a categoria de ontem.
    //
    // Em lote, uma leitura de regras para o extrato inteiro. Uma consulta por
    // linha faria dezenas de viagens ao banco a cada abertura da tela.
    const categorias = await sugerirParaLinhas(
      supabase,
      user.id,
      pendentes.map((l) => ({ id: l.id, description: l.description ?? "", amount: l.amount }))
    );

    return NextResponse.json({
      import: extrato,
      entries: (linhas ?? []).map((l) => {
        const s = sugestoes.get(l.fingerprint);
        const c = categorias.get(l.id);
        return {
          ...l,
          suggestion: s
            ? {
                transaction: sugeridoPorId.get(s.transactionId) ?? null,
                day_gap: s.dayGap,
                similarity: s.similarity,
              }
            : null,
          // `origin` viaja junto de proposito: e o que permite a tela tratar a
          // regra ("voce ja disse que isto e X") diferente do palpite ("acho
          // que e X"). Sem o campo, as duas teriam a mesma cara e o usuario
          // confiaria no chute tanto quanto na propria decisao.
          category_suggestion: c
            ? {
                category_id: c.categoryId,
                category_name: c.categoryName,
                origin: c.origin,
                matched_key: c.matchedKey,
              }
            : null,
        };
      }),
    });
  } catch (error) {
    console.error("Erro na API do extrato:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    // As linhas ja importadas viraram lancamentos de verdade, e apagar o
    // extrato NAO pode apagar dinheiro. O ON DELETE CASCADE do 009 leva as
    // linhas embora, mas as financial_transactions ficam -- o que fica em
    // aberto e que os fingerprints somem junto, e reimportar o mesmo arquivo
    // voltaria a oferecer o que ja foi importado.
    const { count } = await supabase
      .from("statement_entries")
      .select("id", { count: "exact", head: true })
      .eq("import_id", params.id)
      .in("status", ["imported", "linked"]);

    if ((count ?? 0) > 0) {
      return NextResponse.json(
        {
          error: `Este extrato já virou ${count} lançamento(s). Apagar agora faria o app oferecer os mesmos lançamentos de novo numa próxima importação.`,
        },
        { status: 409 }
      );
    }

    const { error } = await supabase
      .from("statement_imports")
      .delete()
      .eq("id", params.id);

    if (error) {
      console.error("Erro ao descartar extrato:", error);
      return NextResponse.json(
        { error: "Não foi possível descartar o extrato" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Erro ao descartar extrato:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
