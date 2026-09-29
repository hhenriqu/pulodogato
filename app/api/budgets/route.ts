// GET  /api/budgets?month=YYYY-MM   tetos do mes, com o consumido de cada um
// GET  /api/budgets?group_id=UUID   so os tetos daquele grupo
// POST /api/budgets                 cria um teto (pessoal ou de grupo)
//
// A leitura sai de `budget_consumption`, nao de `budgets`: o consumido e
// calculado na hora, sobre financial_transactions. Ver a SECAO 5 da migration
// 006 para o porque de nao ser coluna.
//
// A RLS do 006 e quem filtra: o SELECT devolve os tetos do proprio usuario
// mais os dos grupos de que ele participa. Nao repetimos o filtro aqui para
// nao ter duas versoes da mesma regra de acesso.
//
// O `summary` E SO O PESSOAL (HMO-138)
// ------------------------------------
// Ele somava a lista inteira. Enquanto nao existiu tela para criar teto de
// grupo isso nao teve efeito; com ela, somar os dois produz um "ja gasto" que
// nao e nem o meu (inclui o gasto dos outros membros da viagem) nem o da
// viagem (inclui o meu mercado de casa), e que sobe a cada membro novo do
// grupo. O teto de grupo continua na lista `budgets`, agora com o nome do
// grupo junto, e cada viagem soma na sua propria barra -- a separacao mora em
// lib/orcamento-de-grupo.ts, em funcao pura com teste, para a rota e a tela
// nao terem duas versoes dela.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { primeiroDiaDoMes, mesCorrente } from "@/lib/services/budget";
import { separarOrcamentos } from "@/lib/orcamento-de-grupo";

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
    const mesParam = url.searchParams.get("month");
    const mes = mesParam ? primeiroDiaDoMes(mesParam) : mesCorrente();
    const grupoParam = url.searchParams.get("group_id");

    if (!mes) {
      return NextResponse.json(
        { error: "Mês deve estar no formato AAAA-MM" },
        { status: 400 }
      );
    }

    let consulta = supabase
      .from("budget_consumption")
      .select("*")
      .eq("month", mes)
      .order("amount_limit", { ascending: false });

    // Filtro opcional para quem quer a barra de UMA viagem (a tela do grupo).
    // Nao substitui a RLS: um group_id de grupo alheio nao devolve linha
    // nenhuma porque a policy do 006 ja nao deixa a linha aparecer.
    if (grupoParam) consulta = consulta.eq("group_id", grupoParam);

    const { data: budgets, error } = await consulta;

    if (error) {
      console.error("Erro ao listar orçamentos:", error);
      return NextResponse.json(
        { error: "Não foi possível carregar os orçamentos" },
        { status: 500 }
      );
    }

    // A view nao traz os relacionamentos; buscamos as categorias em uma
    // segunda consulta em vez de embutir o join, porque budget_consumption e
    // uma view e o PostgREST nao infere FK atraves dela.
    const categoriaIds = Array.from(
      new Set((budgets ?? []).map((b) => b.category_id))
    );

    const { data: categorias } = categoriaIds.length
      ? await supabase
          .from("transaction_categories")
          .select("*")
          .in("id", categoriaIds)
      : { data: [] };

    const porId = new Map((categorias ?? []).map((c) => [c.id, c]));

    // O nome do grupo vem pelo mesmo caminho da categoria, e pelo mesmo
    // motivo: budget_consumption e uma view, e o PostgREST nao infere FK
    // atraves dela. Sem o nome, a barra da viagem sairia rotulada com um UUID.
    const grupoIds = Array.from(
      new Set(
        (budgets ?? [])
          .map((b) => b.group_id)
          .filter((id): id is string => Boolean(id))
      )
    );

    const { data: grupos } = grupoIds.length
      ? await supabase
          .from("expense_groups")
          .select("id, name")
          .in("id", grupoIds)
      : { data: [] };

    const grupoPorId = new Map((grupos ?? []).map((g) => [g.id, g]));

    const comCategoria = (budgets ?? []).map((b) => ({
      ...b,
      category: porId.get(b.category_id) ?? null,
      group: b.group_id ? grupoPorId.get(b.group_id) ?? null : null,
    }));

    // `summary` e so o pessoal -- ver a nota no topo do arquivo. Sai da mesma
    // funcao que a tela usa para desenhar, para os dois numeros nao poderem
    // discordar.
    const { pessoais, pessoal } = separarOrcamentos(comCategoria);

    return NextResponse.json({
      month: mes,
      budgets: comCategoria,
      summary: {
        total_limit: pessoal.limite,
        total_spent: pessoal.gasto,
        total_remaining: pessoal.restante,
        count_alert: pessoais.filter((b) => b.consumption_status === "alert")
          .length,
        count_exceeded: pessoais.filter(
          (b) => b.consumption_status === "exceeded"
        ).length,
      },
    });
  } catch (error) {
    console.error("Erro na API de orçamentos:", error);
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
      category_id,
      amount_limit,
      month,
      group_id,
      alert_threshold = 0.8,
      carry_forward = true,
      notes,
    } = body;

    if (!category_id) {
      return NextResponse.json(
        { error: "Categoria é obrigatória" },
        { status: 400 }
      );
    }

    const valor = Number(amount_limit);
    if (!Number.isFinite(valor) || valor <= 0) {
      return NextResponse.json(
        { error: "O teto do orçamento deve ser maior que zero" },
        { status: 400 }
      );
    }

    const mes = month ? primeiroDiaDoMes(month) : mesCorrente();
    if (!mes) {
      return NextResponse.json(
        { error: "Mês deve estar no formato AAAA-MM" },
        { status: 400 }
      );
    }

    const limiar = Number(alert_threshold);
    if (!Number.isFinite(limiar) || limiar <= 0 || limiar > 1) {
      return NextResponse.json(
        { error: "O alerta deve ser uma fração entre 0 e 1 (0.8 = 80%)" },
        { status: 400 }
      );
    }

    // Teto de grupo so vale para membro ativo. A policy budgets_insert do 006
    // checa apenas `user_id = auth.uid()` -- ela protege a coluna do DONO, nao
    // a linha-pai -- entao sem esta checagem qualquer pessoa logada pendura um
    // teto num grupo de que nao participa, e a policy de SELECT (que libera os
    // membros) o entrega para o grupo inteiro ver. Mesma checagem que
    // /api/recurring-rules ja faz, e pela mesma razao.
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

    const { data: budget, error } = await supabase
      .from("budgets")
      .insert({
        user_id: user.id,
        category_id,
        group_id: group_id || null,
        month: mes,
        amount_limit: valor,
        alert_threshold: limiar,
        carry_forward: Boolean(carry_forward),
        notes: notes || null,
      })
      .select("*, category:transaction_categories(*)")
      .single();

    if (error) {
      // 23505: ja existe teto para esta categoria neste mes. E o caso comum de
      // quem clica duas vezes, e merece uma mensagem propria em vez de 500.
      //
      // Os dois indices do 006 sao parciais e separados (um por grupo, um
      // pessoal), entao a colisao do teto de grupo tem outra causa: OUTRO
      // membro ja criou aquele teto para o grupo. Dizer "você já tem" para
      // quem nunca criou nada manda a pessoa procurar na tela dela um teto que
      // esta na lista do grupo.
      if (error.code === "23505") {
        return NextResponse.json(
          {
            error: group_id
              ? "O grupo já tem um orçamento para esta categoria neste mês"
              : "Já existe um orçamento para esta categoria neste mês",
          },
          { status: 409 }
        );
      }
      console.error("Erro ao criar orçamento:", error);
      return NextResponse.json(
        { error: "Não foi possível criar o orçamento" },
        { status: 500 }
      );
    }

    return NextResponse.json({ budget }, { status: 201 });
  } catch (error) {
    console.error("Erro na API de orçamentos:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
