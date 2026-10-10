import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { today } from "@/lib/recurrence";
import { lerPeriodo, mesesDoPeriodo } from "@/lib/periodo-do-painel";
import { lerCreditoDosGrupos } from "@/lib/services/credito-dos-grupos";

export const dynamic = "force-dynamic";

/**
 * O QUE OS OUTROS ME DEVEM, SOMANDO TODOS OS MEUS GRUPOS (HMO-245, fase 10).
 *
 *   GET /api/expense-groups/my-credit?de=AAAA-MM-DD&ate=AAAA-MM-DD
 *
 * A rota `[groupId]/fechamento` responde sobre UM grupo e exige saber qual. A
 * tela de Financas Pessoais pergunta o contrario -- "e no total, quem me deve?"
 * --, e sem esta rota teria de descobrir os meus grupos e bater numa rota por
 * grupo e por mes: N x M requisicoes para um cartao. Mesmo motivo de
 * `my-balance` (HMO-175), que responde a outra pergunta.
 *
 * A DIFERENCA ENTRE ESTA ROTA E A `my-balance`, QUE NAO E COSMETICA
 * ----------------------------------------------------------------
 * `my-balance` le `group_member_balances` (view do 007): so o REALIZADO, e
 * acumulado, sem recorte de mes. Esta rota fecha o mes com `fecharMes`, que soma
 * PREVISTO JUNTO COM REALIZADO -- a internet do C6 que vence dia 15 e que nao
 * tem transacao nenhuma ainda entra aqui e nao entra la.
 *
 * As duas respostas DIVERGEM, de proposito, e as duas estao certas para a
 * pergunta de cada uma. E por isso que o credito desta rota vai para a tela
 * rotulado A RECEBER / previsto, fora de "Receitas": o cabecalho de
 * lib/credito-de-grupo.ts e onde esse criterio esta escrito.
 *
 * TODA A ARITMETICA ESTA EM lib/ -- AQUI SO HA O RECORTE DE TEMPO E O DESFECHO
 * ---------------------------------------------------------------------------
 * `fecharMes` fecha cada mes, `creditoAReceber` recorta o meu lado positivo e
 * agrega por (grupo, devedor). As duas tem teste e mutante. Esta rota nao tem
 * regra propria sobre dinheiro, e nao deve ter.
 *
 * AS SEIS CONSULTAS MORAM EM lib/services/credito-dos-grupos.ts DESDE A HMO-364
 * ----------------------------------------------------------------------------
 * Elas sairam daqui inteiras, sem mudar uma linha, porque a aba Receitas passou
 * a somar o MESMO credito dentro do cartao «Previsto» (fase F3 da HMO-360) e
 * duas copias das mesmas seis consultas divergiriam na primeira mudanca. O que
 * ficou nesta rota e o que e DELA: o recorte de tempo (`?de=`/`?ate=` por
 * `lerPeriodo`) e o desfecho da falha, que aqui e 500 e na aba Receitas nao e.
 *
 * A guarda de lista vazia de cada `.in()` foi junto, e ela nao e defensiva:
 * `in` com lista vazia devolve TUDO em algumas versoes do PostgREST, e aqui
 * "tudo" seria linha de grupo de que eu nao participo. O mesmo cuidado esta em
 * `my-balance/route.ts`.
 *
 * O MES PADRAO E O DE SAO PAULO. A Vercel roda em UTC: das 21:00 do dia 31 em
 * diante `new Date()` no servidor ja esta no mes seguinte. `today()`
 * (lib/recurrence) formata em America/Sao_Paulo, que e o fuso em que os
 * vencimentos deste app vivem.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const hoje = today();
    const periodo = lerPeriodo(
      request.nextUrl.searchParams.get("de"),
      request.nextUrl.searchParams.get("ate"),
      hoje
    );
    // `mesesDoPeriodo` devolve 'AAAA-MM-01' (a chave das views do 008);
    // `fecharMes` recorta por 'AAAA-MM'.
    const meses = mesesDoPeriodo(periodo).map((m) => m.slice(0, 7));

    // AS SEIS CONSULTAS SAIRAM DESTE ARQUIVO NA HMO-364, SEM MUDAR NENHUMA.
    //
    // A aba Receitas passou a precisar do MESMO credito dentro do cartao
    // «Previsto» (fase F3 da HMO-360), e copiar as consultas para a outra rota
    // criaria a segunda implementacao da mesma leitura -- dois numeros
    // plausiveis que divergiriam na primeira mudanca. O cabecalho de
    // lib/services/credito-dos-grupos.ts e onde esse criterio esta escrito.
    //
    // O DESFECHO DA FALHA CONTINUA SENDO DESTA ROTA, e nao do modulo: ela
    // existe para responder o credito, entao sem ele a resposta nao tem
    // conteudo e o certo e 500. A aba Receitas faz o oposto com a MESMA falha
    // -- segue com os tres numeros e o reembolso zerado --, e e por isso que o
    // erro volta como valor e nao como excecao.
    const leitura = await lerCreditoDosGrupos(supabase, user.id, meses);

    if (!leitura.ok) {
      return NextResponse.json({ error: leitura.mensagem }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      credito: leitura.credito,
      /** O periodo efetivamente usado -- `?de=`/`?ate=` invalido cai no mes corrente. */
      periodo,
      /** Os meses fechados, em 'AAAA-MM'. A tela rotula por eles. */
      meses,
      today: hoje,
      viewer_user_id: user.id,
    });
  } catch (error) {
    console.error("Erro em GET my-credit:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
