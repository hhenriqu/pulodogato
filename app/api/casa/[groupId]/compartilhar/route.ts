// POST /api/casa/[groupId]/compartilhar  { compartilha: boolean }
//
// Liga ou desliga o PROPRIO mes na visao da casa (078). So o membro muda o
// dele: o trigger da 078 barra ate o admin de mudar o de outra pessoa.
import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { statusDoErroDaCasa } from "@/lib/resultado-da-casa";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const corpo = await request.json().catch(() => null);
  if (!corpo || typeof corpo.compartilha !== "boolean") {
    return NextResponse.json(
      { error: "Envie { compartilha: true | false }" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc("compartilhar_com_a_casa", {
    p_group_id: params.groupId,
    p_compartilha: corpo.compartilha,
  });
  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: statusDoErroDaCasa(error) }
    );
  }
  return NextResponse.json({ compartilha: data === true });
}
