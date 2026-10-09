import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Restaurar grupo arquivado (HMO-203).
 *
 * ESTA ROTA DIZIA "restaurado com sucesso" E NAO RESTAURAVA NADA
 * --------------------------------------------------------------
 * Medido em producao em 2026-09-30, na mesma linha, antes e depois:
 *
 *     ANTES:  is_active=false  archived_at=2026-10-01T00:12:31Z  restored_at=null
 *     POST .../restore -> HTTP 200 {"success":true,"message":"... restaurado com sucesso!"}
 *     DEPOIS: is_active=false  archived_at=2026-10-01T00:12:31Z  restored_at=null
 *
 * Arquivar o grupo poe o PROPRIO admin em `group_members.status='archived'`, e
 * `is_group_admin()` exige `status='active'`. A policy de UPDATE de
 * `expense_groups` e `USING (is_group_admin(id))` -- entao, depois de arquivar,
 * NAO HAVIA QUEM RESTAURASSE. A RLS filtra as linhas em vez de recusar o
 * comando, o PostgREST devolve 200 com corpo `[]`, e `supabase-js` sem
 * `.select()` nao entrega contagem: o `if (restoreError)` nunca disparava.
 *
 * O `restored_at` da resposta antiga era um `new Date().toISOString()` montado
 * aqui mesmo. A rota DESCREVIA a escrita em vez de medir.
 *
 * E a rota seguia adiante e rodava o SEGUNDO UPDATE, em `group_members`, que
 * PASSA (`user_id = auth.uid()` esta na policy daquela tabela). O resultado era
 * um estado que o app nao sabe produzir de outro jeito: grupo `is_active=false`
 * com admin `status='active'`. Ali o grupo desaparece das DUAS telas -- da ativa
 * por `is_active`, da de arquivados porque aquela rota exige uma linha de membro
 * `status='archived'` -- e `POST /invite` aceitava convidar para ele.
 *
 * O QUE MUDOU
 * -----------
 * A escrita passou a ser UMA chamada a `restore_archived_group()` (migration
 * 051), `SECURITY DEFINER`, que:
 *
 *   - autoriza por "e admin DESTE grupo, ativo ou arquivado" -- sem depender de
 *     `is_group_admin()`, que e justamente a funcao que o arquivamento quebra;
 *   - faz os dois UPDATEs numa transacao, o que torna o estado parcial
 *     impossivel;
 *   - LE A LINHA DE VOLTA depois de escrever e levanta erro se a escrita nao
 *     pegou. O `restored_at` que esta rota responde vem de lá, nao daqui.
 *
 * O PRE-CHECK DE MEMBRO SAIU, E ISSO E PARTE DO CONSERTO
 * ------------------------------------------------------
 * A versao antiga procurava a linha do usuario com `.eq("status","archived")`
 * antes de escrever. Dois problemas: (1) ela duplicava, mais frouxa, uma
 * autorizacao que o banco tambem faz -- e era a RLS que barrava depois, em
 * silencio; (2) num grupo que JA caiu no estado parcial o admin esta `'active'`,
 * entao aquele pre-check respondia 404 e o grupo ficava inalcancavel para
 * sempre. A autorizacao agora e uma so, dentro da funcao, e aceita os dois
 * status.
 *
 * Os SQLSTATE sao o contrato com a 051 -- `data_exception` (22000) de proposito
 * NAO esta no mapa: ele e a conferencia da funcao dizendo que a escrita nao
 * pegou, e isso e 500, nao recado para o usuario.
 */
const STATUS_POR_SQLSTATE: Record<string, number> = {
  // Sessao sem identidade. Nao e alcancavel por aqui (o getUser acima ja
  // recusou), e esta no mapa porque um 500 nesse caso mandaria investigar o
  // banco em vez da sessao.
  "28000": 401,
  // `no_data_found` dentro de plpgsql e P0002, NAO o 02000 do SQL padrao: as
  // duas condicoes tem o mesmo nome e numeros diferentes. Comparar com "02000"
  // nunca casaria, e todo "grupo nao encontrado" cairia no ramo de 500.
  //
  // O nome por extenso vai junto pelo mesmo motivo que em `join/route.ts`: o
  // PostgREST ja devolveu as duas formas, e aceitar so uma transforma uma
  // recusa legitima em 500.
  P0002: 404,
  no_data_found: 404,
  "42501": 403,
  // Codigo proprio da 051 para "este grupo ja esta ativo". Sem ele esse caso
  // teria de se disfarcar de "nao encontrado", e a tela diria que o grupo nao
  // existe.
  PDG01: 400,
};

type GrupoRestaurado = {
  group_id: string;
  group_name: string;
  is_active: boolean;
  restored_at: string;
  members_restored: number;
};

export async function POST(
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

    // Sem `.returns<GrupoRestaurado[]>()`: o client deste projeto nao carrega o
    // generic `Database`, e naquele caso `.returns<T[]>()` sobre `.rpc()`
    // resolve para uma UNIAO com o tipo-sentinela de erro do supabase-js
    // ("Cannot cast single object to array type"), que reprova o tsc no
    // `data[0]`. A asserção abaixo e o mesmo acoplamento, escrito onde se ve.
    const { data, error } = await supabase.rpc("restore_archived_group", {
      p_group_id: groupId,
    });

    if (error) {
      const status = STATUS_POR_SQLSTATE[error.code ?? ""];

      if (status) {
        return NextResponse.json({ error: error.message }, { status });
      }

      // O que sobra aqui e: a conferencia da propria funcao (22000 -- a escrita
      // nao pegou), falta de GRANT, ou a funcao nao existir no banco. Os tres
      // sao defeito nosso, nao do usuario, e nenhum deles pode sair como
      // sucesso -- era exatamente isso que esta issue consertou.
      console.error("Falha ao restaurar o grupo:", {
        groupId,
        code: error.code,
        message: error.message,
      });
      return NextResponse.json(
        {
          error:
            "Nao foi possivel restaurar o grupo agora. A operacao foi desfeita " +
            "por inteiro: o grupo continua arquivado.",
        },
        { status: 500 }
      );
    }

    // `RETURNS TABLE` chega como lista. Vazia nao deveria acontecer -- a funcao
    // ou devolve uma linha ou levanta --, e o `if` existe porque a alternativa
    // e ler `data[0].group_name` de `undefined` e responder 500 por TypeError,
    // com uma mensagem que nao diz nada sobre o que aconteceu.
    const restaurado = (data as GrupoRestaurado[] | null)?.[0];

    if (!restaurado) {
      console.error("restore_archived_group devolveu lista vazia:", { groupId });
      return NextResponse.json(
        { error: "Nao foi possivel confirmar a restauracao do grupo." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Grupo "${restaurado.group_name}" restaurado com sucesso!`,
      // Lido de volta do banco pela funcao, nao montado aqui. Era este campo,
      // na versao antiga, que carimbava de verdade uma escrita que nunca
      // aconteceu.
      restored_at: restaurado.restored_at,
      members_restored: restaurado.members_restored,
    });
  } catch (error) {
    console.error("Error restoring group:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
