import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { RecurrenceStatus } from "@/lib/recurrence-detector";

// =====================================================
// PATCH /api/recurrences/:id
// =====================================================
// A decisao do usuario sobre uma recorrencia detectada: confirmar, ignorar ou
// marcar como cancelada. Body: { "status": "CONFIRMED" | "IGNORED" | "CANCELLED" }
//
// E o unico lugar que muda `status`. A varredura nao mexe nesse campo -- ver o
// comentario em app/api/recurrences/scan/route.ts.
// =====================================================

/**
 * Para onde o usuario pode levar uma recorrencia.
 *
 * DETECTED nao esta na lista: e o estado em que o detector deixa a linha, e
 * nao um destino. Deixar voltar para DETECTED daria ao cliente um jeito de
 * limpar o carimbo de cancelamento -- e o carimbo e a data a partir da qual
 * uma cobranca nova vira alerta (criterio 4). Para desfazer um "ignorar" o
 * caminho e CONFIRMED.
 */
const DESTINOS_VALIDOS: RecurrenceStatus[] = ["CONFIRMED", "IGNORED", "CANCELLED"];

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = params;
    const body = await request.json().catch(() => null);
    const status = body?.status;

    if (!status || !DESTINOS_VALIDOS.includes(status)) {
      return NextResponse.json(
        {
          error: `status invalido. Esperado um de: ${DESTINOS_VALIDOS.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // O `.eq("user_id")` e redundante com a RLS e fica assim de proposito: sem
    // ele, uma falha de policy vira "atualizou a linha de outro usuario" em
    // vez de "nao encontrou". A RLS e a garantia; isto e o que faz a rota
    // responder 404 em vez de 200 silencioso.
    const { data, error } = await supabase
      .from("detected_recurrences")
      .update({
        status,
        // O CHECK da migration 011 exige carimbo em todo status que nao seja
        // DETECTED. Como DETECTED nao e destino valido aqui, o carimbo e
        // sempre preenchido.
        status_changed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "Recorrencia nao encontrada" },
        { status: 404 }
      );
    }

    return NextResponse.json({ recurrence: data });
  } catch (error) {
    console.error("Erro em PATCH /api/recurrences/[id]:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
