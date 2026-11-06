// GET /api/notifications/sino   o que o sino do cabecalho mostra
//
// Uma lista so, ja ordenada e com a frase pronta, de quatro familias: conta a
// vencer ou vencida, fatura de cartao fechando, grupo fechando, e o que alguem
// lancou para o usuario aprovar. As regras e as frases moram em
// lib/avisos-do-sino.ts; aqui so se le o banco.
//
// CADA FAMILIA NUM TRY PROPRIO
// ----------------------------
// Pelo mesmo motivo do GET /api/notifications: se a leitura dos pagamentos
// entre pessoas falhar (a 081 ainda nao colada, por exemplo), o sino tem que
// continuar dizendo que o aluguel venceu. A falha vai para o log e para
// `falhas`, e as outras familias saem normalmente.
//
// POR QUE NAO REAPROVEITA O GET /api/notifications
// ------------------------------------------------
// Aquela resposta e a da tela /dashboard/notifications (historico, alertas de
// assinatura, contadores), e o contrato dela fica como esta. A familia de
// vencimento sai daqui da MESMA view e com o MESMO filtro por `user_id` (057),
// e com a mesma frase (`textoDoAviso`).

import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import { today } from "@/lib/recurrence";
import type { BillAlert } from "@/lib/services/notifications";
import {
  avisoDeDivisaoParaAprovar,
  avisoDeFechamentoDoCartao,
  avisoDeFechamentoDoGrupo,
  avisoDePagamentoParaConfirmar,
  avisoDePedidosDeEntrada,
  avisoDeVencimento,
  ordenarAvisos,
  type AvisoDoSino,
  type PagamentoParaConfirmar,
} from "@/lib/avisos-do-sino";

export const dynamic = "force-dynamic";

type Cliente = ReturnType<typeof createClient>;

async function vencimentos(supabase: Cliente, userId: string): Promise<AvisoDoSino[]> {
  const { data, error } = await supabase
    .from("bill_alerts")
    .select("*")
    .eq("user_id", userId)
    .order("due_date", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as BillAlert[]).map(avisoDeVencimento);
}

async function cartoes(supabase: Cliente, userId: string, hoje: string): Promise<AvisoDoSino[]> {
  const { data, error } = await supabase
    .from("financial_accounts")
    .select("id, name, closing_day")
    .eq("user_id", userId)
    .eq("account_type", "credit_card")
    .eq("is_active", true)
    .not("closing_day", "is", null);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((c) => avisoDeFechamentoDoCartao(c, hoje))
    .filter((a): a is AvisoDoSino => a !== null);
}

interface MinhaParticipacao {
  role: string | null;
  group: { id: string; name: string; closing_day: number | null; is_active: boolean | null; archived_at: string | null } | null;
}

async function grupos(supabase: Cliente, userId: string, hoje: string): Promise<AvisoDoSino[]> {
  const { data, error } = await supabase
    .from("group_members")
    .select("role, group:expense_groups(id, name, closing_day, is_active, archived_at)")
    .eq("user_id", userId)
    .eq("status", "active")
    .returns<MinhaParticipacao[]>();
  if (error) throw new Error(error.message);

  const ativos = (data ?? []).filter(
    (m) => m.group && m.group.is_active !== false && !m.group.archived_at
  );

  const avisos: AvisoDoSino[] = ativos
    .map((m) => avisoDeFechamentoDoGrupo(m.group!, hoje))
    .filter((a): a is AvisoDoSino => a !== null);

  // Pedidos de entrada: so quem administra decide (a rota /approve confere o
  // mesmo `role = 'admin'`).
  const administrados = ativos.filter((m) => m.role === "admin").map((m) => m.group!);
  if (administrados.length) {
    const { data: pendentes, error: erroPendentes } = await supabase
      .from("group_members")
      .select("group_id")
      .in(
        "group_id",
        administrados.map((g) => g.id)
      )
      .eq("status", "pending");
    if (erroPendentes) throw new Error(erroPendentes.message);

    const porGrupo = new Map<string, number>();
    for (const p of pendentes ?? []) {
      porGrupo.set(p.group_id, (porGrupo.get(p.group_id) ?? 0) + 1);
    }
    for (const g of administrados) {
      const aviso = avisoDePedidosDeEntrada({
        group_id: g.id,
        group_name: g.name,
        quantos: porGrupo.get(g.id) ?? 0,
      });
      if (aviso) avisos.push(aviso);
    }
  }

  return avisos;
}

interface DivisaoPendente {
  id: string;
  amount: number | string;
  created_at: string;
  transaction: { description: string | null; user_id: string } | null;
}

async function divisoes(supabase: Cliente, userId: string): Promise<AvisoDoSino[]> {
  const { data, error } = await supabase
    .from("expense_splits")
    .select("id, amount, created_at, transaction:financial_transactions(description, user_id)")
    .eq("participant_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<DivisaoPendente[]>();
  if (error) throw new Error(error.message);

  const lista = data ?? [];
  const donos = Array.from(
    new Set(lista.map((d) => d.transaction?.user_id).filter((id): id is string => !!id))
  );

  // O nome de quem lancou. A RLS de `profiles` pode esconder o perfil; ai a
  // frase diz "Alguem", em vez de o aviso sumir.
  const nomes = new Map<string, string>();
  if (donos.length) {
    const { data: perfis } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", donos);
    for (const p of perfis ?? []) {
      if (p.full_name) nomes.set(p.id, p.full_name);
    }
  }

  return lista.map((d) =>
    avisoDeDivisaoParaAprovar({
      id: d.id,
      amount: d.amount,
      created_at: d.created_at,
      descricao: d.transaction?.description ?? null,
      quem_lancou: d.transaction ? nomes.get(d.transaction.user_id) ?? null : null,
    })
  );
}

async function pagamentos(supabase: Cliente): Promise<AvisoDoSino[]> {
  const { data, error } = await supabase.rpc("meus_pagamentos_entre_pessoas");
  if (error) throw new Error(error.message);
  return ((data ?? []) as PagamentoParaConfirmar[])
    .map(avisoDePagamentoParaConfirmar)
    .filter((a): a is AvisoDoSino => a !== null);
}

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const hoje = today();
  const familias: Array<[string, Promise<AvisoDoSino[]>]> = [
    ["vencimento", vencimentos(supabase, user.id)],
    ["cartao", cartoes(supabase, user.id, hoje)],
    ["grupo", grupos(supabase, user.id, hoje)],
    ["divisao", divisoes(supabase, user.id)],
    ["pagamento", pagamentos(supabase)],
  ];

  const resultados = await Promise.allSettled(familias.map(([, p]) => p));
  const avisos: AvisoDoSino[] = [];
  const falhas: string[] = [];

  resultados.forEach((r, i) => {
    if (r.status === "fulfilled") {
      avisos.push(...r.value);
    } else {
      falhas.push(familias[i][0]);
      console.error(`Sino: falha ao ler ${familias[i][0]}:`, r.reason);
    }
  });

  return NextResponse.json({ avisos: ordenarAvisos(avisos), falhas });
}
