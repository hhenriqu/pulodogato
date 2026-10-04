import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { chaveDoAcerto } from "@/lib/acerto-em-lancamento";

/**
 * Desfaz um acerto registrado por engano.
 *
 * So quem registrou desfaz -- a policy de DELETE da 007 exige
 * `created_by = auth.uid()`. Sem isso, qualquer membro poderia apagar o
 * comprovante de um pagamento que recebeu e cobrar de novo.
 *
 * Apagar devolve a divida ao estado anterior por construcao: o saldo e
 * calculado na leitura (view group_member_balances) e nao existe coluna de
 * saldo congelada para ficar fora de sincronia.
 *
 * E APAGA A PERNA EM `financial_transactions` (HMO-245, fase 11)
 * --------------------------------------------------------------
 * Desde que o acerto passou a gravar lancamento, desfazer sem apagar a perna
 * seria um bug de dinheiro: a quitacao sai da lista, a divida volta a aparecer
 * na sugestao de pagamento, e o Pix continua no saldo da conta corrente. Duas
 * telas afirmando coisas contrarias sobre o mesmo dinheiro, sem erro nenhum.
 *
 * A linha e achada pela chave canonica em `notes` (`acerto:<id>`), porque
 * `financial_transactions` nao tem coluna de acerto -- criar uma exigiria
 * migration, isto e, um passo humano no SQL Editor antes de o codigo poder
 * subir. Mesmo recurso do ajuste de fatura (HMO-253).
 *
 * A ORDEM E: perna primeiro, quitacao depois. Se a quitacao fosse apagada
 * primeiro e a perna falhasse, sobraria um lancamento orfao que nada mais
 * aponta -- e a chave em `notes` apontaria para uma quitacao que nao existe.
 * Na ordem inversa, a falha deixa tudo como estava e a pessoa pode tentar de
 * novo.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { groupId: string; id: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { groupId, id } = params;

    // CONFERIR ANTES DE APAGAR A PERNA, e nao depois.
    //
    // Sem esta leitura ha um caminho em que a perna some e a quitacao fica: um
    // `groupId` errado na URL faz o DELETE de baixo apagar ZERO linhas (ele
    // filtra pelos dois campos) e responder 403 -- com o lancamento ja apagado,
    // o dinheiro de volta na conta e a divida ainda dada como quitada no grupo.
    // A policy de DELETE da 007 exige `created_by = auth.uid()`, e e isso que
    // esta repetido aqui: a checagem nao substitui a policy, ela so impede que
    // o passo irreversivel comece quando a resposta ja e 403.
    const { data: existente } = await supabase
      .from("group_settlements")
      .select("id, created_by")
      .eq("id", id)
      .eq("group_id", groupId)
      .maybeSingle();

    if (!existente || existente.created_by !== user.id) {
      return NextResponse.json(
        {
          error:
            "Acerto nao encontrado, ou registrado por outra pessoa. Quem registrou e quem desfaz.",
        },
        { status: 403 }
      );
    }

    // A perna de quem esta desfazendo. A RLS de `financial_transactions` ja
    // limita a `user_id = auth.uid()`, entao quem nao registrou o acerto nao
    // acha linha nenhuma por esta chave -- e apaga zero, que e o certo: a perna
    // da contraparte (quando existir, F12) e dela, nao de quem clicou aqui.
    const { error: erroDaPerna } = await supabase
      .from("financial_transactions")
      .delete()
      .eq("notes", chaveDoAcerto(id));

    if (erroDaPerna) {
      // Abortar ANTES de encostar na quitacao e o que mantem os dois lados
      // coerentes: nada mudou, e a pessoa pode tentar de novo. Apagar a
      // quitacao aqui faria a divida voltar a tela com o dinheiro ainda fora da
      // conta -- o estado que convida a pagar duas vezes.
      console.error("Erro ao apagar o lancamento do acerto:", erroDaPerna);
      return NextResponse.json(
        {
          error:
            "Não foi possível desfazer o lançamento deste acerto. Nada foi alterado — tente novamente.",
        },
        { status: 500 }
      );
    }

    const { data: apagados, error } = await supabase
      .from("group_settlements")
      .delete()
      .eq("id", id)
      .eq("group_id", groupId)
      .select("id");

    if (error) {
      console.error("Erro ao desfazer acerto:", error);
      return NextResponse.json(
        { error: "Nao foi possivel desfazer o acerto" },
        { status: 500 }
      );
    }

    // A RLS nao devolve erro quando a linha nao passa na policy -- ela some do
    // resultado, e o DELETE "funciona" apagando zero linhas. Sem esta
    // checagem a tela diria "acerto desfeito" e o valor continuaria la.
    if (!apagados || apagados.length === 0) {
      return NextResponse.json(
        {
          error:
            "Acerto nao encontrado, ou registrado por outra pessoa. Quem registrou e quem desfaz.",
        },
        { status: 403 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erro em DELETE settlement:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
