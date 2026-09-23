// DELETE /api/receipts/[id]   apaga o comprovante (arquivo e registro)
//
// A ORDEM IMPORTA: o arquivo sai primeiro, a linha depois. Na ordem inversa, um
// erro no Storage deixaria o arquivo no bucket sem nenhuma linha apontando para
// ele -- invisivel, impossivel de apagar pela tela e ocupando espaco para
// sempre. Falhando o Storage primeiro, a linha continua e o usuario pode
// tentar de novo.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const BUCKET = "receipts";

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

    const { data: comprovante } = await supabase
      .from("receipts")
      .select("id, storage_path, user_id")
      .eq("id", params.id)
      .maybeSingle();

    if (!comprovante) {
      return NextResponse.json({ error: "Comprovante não encontrado" }, { status: 404 });
    }

    // A policy de SELECT deixa o grupo VER o comprovante do acerto; apagar e so
    // de quem anexou. Sem esta linha, qualquer membro do grupo apagaria a prova
    // de um pagamento que nao e dele.
    if (comprovante.user_id !== user.id) {
      return NextResponse.json(
        { error: "Só quem anexou pode apagar este comprovante" },
        { status: 403 }
      );
    }

    const { error: erroStorage } = await supabase.storage
      .from(BUCKET)
      .remove([comprovante.storage_path]);

    if (erroStorage) {
      console.error("Erro ao apagar o arquivo:", erroStorage);
      return NextResponse.json(
        { error: "Não foi possível apagar o arquivo" },
        { status: 500 }
      );
    }

    const { error } = await supabase.from("receipts").delete().eq("id", params.id);

    if (error) {
      console.error("Erro ao apagar o registro do comprovante:", error);
      return NextResponse.json(
        { error: "O arquivo foi apagado mas o registro ficou. Recarregue e tente de novo." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Erro ao apagar comprovante:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
