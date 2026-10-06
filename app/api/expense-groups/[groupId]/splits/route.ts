import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// Os dois embeds sao many-to-one (objeto, nao lista) e podem vir nulos: a RLS de
// SELECT nao da erro para linha de grupo alheio, ela SOME do resultado. E por
// isso que o codigo testa `membro` e `despesa` antes de usar -- o nulo aqui e um
// estado esperado, nao defensividade sobrando.
type ParteComVinculos = {
  id: string;
  status: string;
  member: { id: string; user_id: string } | null;
  despesa: { id: string; group_id: string } | null;
};

/**
 * Aprovar, recusar ou reabrir a PROPRIA parte numa despesa de grupo (HMO-178).
 *
 * Ate aqui o cracha de status na tela do grupo era um rotulo morto: toda parte
 * nascia `pending` e nada no app escrevia outro valor. A unica rota de
 * aprovacao que existia, `PATCH /api/personal-finance/splits`, mexe em
 * `expense_splits` -- a divisao avulsa entre duas pessoas, que e outra tabela.
 *
 * Isto NAO e cosmetico. Duas coisas dependem do status:
 *
 *   1. O saldo. `group_member_balances` soma em `total_owed` as partes com
 *      `status NOT IN ('rejected','expired')`. Recusar tira o valor da conta de
 *      quem recusou -- e, por consequencia, deixa a despesa rateada por menos
 *      gente do que o total, o que aparece como `residual` nas sugestoes de
 *      transferencia. E o comportamento certo (ninguem paga o que recusou),
 *      mas e dinheiro se movendo, nao um enfeite.
 *
 *   2. A trava da 024 (HMO-176). Editar o valor ou trocar de grupo uma despesa
 *      com parte `approved` levanta PDG01. Ate hoje esse estado era
 *      inalcancavel pela tela, entao a opcao (b) se comportava na pratica como
 *      "recalcula sempre". A partir daqui ela vale de verdade.
 *
 * Quem pode agir: SO o dono da parte. A policy de UPDATE da 002 e mais larga --
 * ela tambem deixa o admin do grupo mexer em qualquer parte -- e esta rota
 * fica de proposito dentro dela, num subconjunto. Aprovar quer dizer "conferi e
 * concordo que devo isto"; um terceiro concordando no seu lugar esvazia a
 * frase, e no caso da recusa ele estaria tirando dinheiro do saldo de outra
 * pessoa. Alargar depois e uma linha; estreitar depois de alguem ter usado,
 * nao.
 *
 * `reopen` existe porque a 024 ja promete ele em producao: as duas mensagens de
 * PDG01 mandam "estorne e relance, ou peca para reabrir a aprovacao". Sem um
 * caminho de volta, uma aprovacao seria irreversivel pela tela e travaria a
 * edicao daquela despesa para sempre.
 */

type Acao = "approve" | "reject" | "reopen";

const ACOES: Acao[] = ["approve", "reject", "reopen"];

/** De qual status cada acao pode partir. */
const ORIGEM_VALIDA: Record<Acao, string[]> = {
  approve: ["pending"],
  reject: ["pending"],
  reopen: ["approved", "rejected"],
};

const DESTINO: Record<Acao, string> = {
  approve: "approved",
  reject: "rejected",
  reopen: "pending",
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { groupId } = params;
    const body = await request.json();
    const splitId: string | undefined = body?.splitId;
    const action: Acao | undefined = body?.action;
    const comments: string | undefined = body?.comments;

    if (!splitId || !action || !ACOES.includes(action)) {
      return NextResponse.json(
        {
          error:
            "Campos obrigatorios: splitId e action (approve, reject ou reopen)",
        },
        { status: 400 }
      );
    }

    // Le a parte com o membro e a despesa ligados para responder tres perguntas
    // de uma vez: ela existe, ela e DESTE grupo (o groupId da URL nao pode ser
    // so decorativo) e ela e do usuario que esta chamando.
    const { data: parte, error: erroLeitura } = await supabase
      .from("group_expense_splits")
      .select(
        `
        id,
        status,
        member:group_members ( id, user_id ),
        despesa:group_transactions ( id, group_id )
      `
      )
      .eq("id", splitId)
      .returns<ParteComVinculos[]>()
      .maybeSingle();

    if (erroLeitura) {
      console.error("Erro ao ler a parte:", erroLeitura);
      return NextResponse.json(
        { error: "Nao foi possivel ler a parte" },
        { status: 500 }
      );
    }

    // A RLS de SELECT nao devolve erro para linha de grupo alheio -- ela some do
    // resultado. Aqui isso e indistinguivel de id inexistente, e as duas
    // respostas sao a mesma de proposito: nao vale contar a quem nao e membro
    // que aquele id existe.
    const membro = parte?.member;
    const despesa = parte?.despesa;

    if (!parte || !membro || !despesa || despesa.group_id !== groupId) {
      return NextResponse.json(
        { error: "Parte nao encontrada neste grupo" },
        { status: 404 }
      );
    }

    if (membro.user_id !== user.id) {
      return NextResponse.json(
        {
          error:
            "Cada um responde pela propria parte. Esta e de outro membro do grupo.",
        },
        { status: 403 }
      );
    }

    if (!ORIGEM_VALIDA[action].includes(parte.status)) {
      return NextResponse.json(
        {
          error: `Esta parte esta "${parte.status}" e nao aceita "${action}" agora.`,
          status: parte.status,
        },
        { status: 409 }
      );
    }

    const agora = new Date().toISOString();
    const patch: Record<string, unknown> = {
      status: DESTINO[action],
      // `approved_at` so faz sentido enquanto a parte esta aprovada. Recusar ou
      // reabrir limpa a data: deixa-la para tras faria a linha dizer que foi
      // aprovada num dia em que ela nao esta aprovada.
      approved_at: action === "approve" ? agora : null,
      updated_at: agora,
    };

    // O motivo so e gravado quando ha um. Recusa sem motivo nao apaga um
    // comentario que ja estivesse ali.
    if (action === "reject" && typeof comments === "string" && comments.trim()) {
      patch.comments = comments.trim();
    }

    // O `.eq("status", ...)` repete a checagem de transicao dentro da propria
    // escrita. Sem ele, duas abas abertas na mesma parte poderiam aprovar em
    // cima de uma recusa que chegou primeiro, e a segunda ainda responderia 200.
    const { data: atualizadas, error: erroUpdate } = await supabase
      .from("group_expense_splits")
      .update(patch)
      .eq("id", splitId)
      .eq("status", parte.status)
      .select("id, status, approved_at");

    if (erroUpdate) {
      console.error("Erro ao atualizar a parte:", erroUpdate);
      return NextResponse.json(
        { error: "Nao foi possivel atualizar a parte" },
        { status: 500 }
      );
    }

    // Zero linhas aqui e a falha silenciosa da RLS (ou a corrida acima): o
    // UPDATE "funciona" sem escrever nada. Sem esta checagem a tela diria
    // "aprovado" e o cracha voltaria a "pendente" no proximo carregamento.
    if (!atualizadas || atualizadas.length === 0) {
      return NextResponse.json(
        {
          error:
            "A parte mudou de estado enquanto voce decidia. Recarregue a despesa.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true, split: atualizadas[0] });
  } catch (error) {
    console.error("Erro na rota de partes:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
