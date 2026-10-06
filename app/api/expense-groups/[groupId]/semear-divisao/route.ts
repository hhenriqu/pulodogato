import { createClient } from "@/utils/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { today } from "@/lib/recurrence";
import {
  linhaDoPrevisto,
  linhaDoRealizado,
  mesDaData,
  type LinhaCrua,
} from "@/lib/fechamento-do-grupo";
import { primeiroDiaDoMes, ultimoDiaDoMes } from "@/lib/periodo-do-painel";
import {
  semearPelaRenda,
  type MembroParaSemear,
} from "@/lib/semear-pela-renda";

/**
 * A SEMEADURA DA DIVISAO PELA RENDA DO MES (HMO-245, fase 6).
 *
 *   GET /api/expense-groups/{groupId}/semear-divisao?mes=YYYY-MM
 *
 * Responde "se a conta fosse dividida pela receita de cada um em outubro, os
 * sliders iriam para 70/30". Ela NAO grava nada: quem grava e o PUT
 * /split-config, depois de a pessoa olhar e ajustar. "A divisao fica parada
 * depois" e a decisao do Helio, e e o que distingue um acordo de uma conta que
 * muda sozinha quando alguem recebe um bonus.
 *
 * ESTA ROTA E O RECORTE DA PRIVACIDADE -- A TELA NAO E
 * ----------------------------------------------------
 * "So a porcentagem": o percentual e de todos, o R$ da renda e so do proprio
 * dono. Esconder o valor no componente deixaria o salario de todo mundo no JSON
 * que o navegador baixa -- uma verificacao feita na tela passaria verde com o
 * dado na resposta. Quem decide e `semearPelaRenda` (lib/semear-pela-renda.ts),
 * que poe `renda_centavos` so na linha do `auth.uid()` de quem pediu, e esta
 * rota devolve o que ela produziu sem remontar nada.
 *
 * POR QUE A SERVICE ROLE, E O QUE ISSO OBRIGA
 * -------------------------------------------
 * Salario e uma linha de `financial_transactions` com `group_id` NULO, e a policy
 * `financial_transactions_select` (002_rls_lockdown.sql:464) e
 * `user_id = auth.uid() OR (group_id IS NOT NULL AND is_group_member(group_id))`.
 * Ou seja: com a sessao do proprio usuario, **a renda dos outros membros nao
 * existe**. A semeadura leria zero para todo mundo menos quem clicou, e devolveria
 * 100% para ele -- um numero plausivel e completamente errado.
 *
 * Nao ha caminho sem privilegio: a alternativa seria uma funcao
 * `SECURITY DEFINER` nova, que e migration, e o plano desta fase e TypeScript
 * sem tocar o banco. Entao a leitura das receitas usa a service role -- e isso
 * impoe tres regras, todas visiveis no codigo abaixo:
 *
 *   1. **a sessao do usuario e quem diz quem ele e.** `auth.getUser()` e a
 *      conferencia de pertencimento rodam no client COM RLS, antes de a service
 *      role entrar em cena. A chave privilegiada nunca decide acesso;
 *   2. **a service role toca so as duas consultas de receita**, filtradas pelos
 *      `user_id` dos membros ativos DESTE grupo e pelo mes pedido. Nada mais e
 *      lido com ela -- membros e grupo saem do client normal, onde a RLS ja
 *      permite;
 *   3. **nenhuma linha crua sai na resposta.** O que vai para o JSON e so o que
 *      `semearPelaRenda` devolve: percentual para todos, R$ so para o dono. Uma
 *      descricao de lancamento alheio aqui seria pior que o valor.
 *
 * Falta de `SUPABASE_SERVICE_ROLE_KEY` responde 503 com o nome da variavel, como
 * nas rotas de cron -- e nao 500: a mensagem e a diferenca entre "configurar o
 * ambiente" e "procurar um defeito".
 *
 * O RECORTE DO MES E O MESMO DO FECHAMENTO
 * ----------------------------------------
 * Mesma regua dos dois lados, que e a decisao 2: conta que vence dia 15 ja e
 * despesa do mes, salario que entra dia 20 e receita do mes. Por isso as linhas
 * passam por `linhaDoRealizado`/`linhaDoPrevisto` -- as mesmas do fechamento --,
 * que cuidam de tipo, sinal, `direction` da view e da prevista com baixa (contada
 * uma vez, nao duas).
 *
 * O `.gte`/`.lte` das consultas e so para nao trazer o historico inteiro: o
 * recorte que VALE e o `mesDaData` dentro de `rendaPorMembro`, por prefixo de
 * string, que e quem tem teste nos dois fusos.
 */
export async function GET(
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

    // Regra 1: quem diz quem ele e, e a sessao -- com RLS, antes de qualquer
    // privilegio. Membro inativo ou de outro grupo para aqui.
    const { data: membership } = await supabase
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceRole) {
      const faltando = [
        !url && "NEXT_PUBLIC_SUPABASE_URL",
        !serviceRole && "SUPABASE_SERVICE_ROLE_KEY",
      ].filter(Boolean);

      return NextResponse.json(
        {
          error:
            `A semeadura pela renda não está configurada. ` +
            `Faltam: ${faltando.join(", ")}.`,
          hint: "Project Settings → Environment Variables, escopo Production.",
        },
        { status: 503 }
      );
    }

    // ----------------------------------------------------------------
    // 1. Os membros ativos, na MESMA ordem estavel do fechamento
    // ----------------------------------------------------------------
    // `joined_at` + `user_id`: o maior-resto de `proporcional` desempata pelo
    // `member_id`, mas a tela casa a resposta posicao a posicao com a lista dela
    // -- e duas ordens diferentes para a mesma lista e como o percentual de um
    // aparece no slider do outro.
    //
    // Lido com o client NORMAL: `group_members_select` ja deixa membro ver o
    // grupo dele. A service role nao e usada aqui de proposito (regra 2).
    const { data: membrosCrus, error: erroMembros } = await supabase
      .from("group_members")
      .select("id, user_id, joined_at")
      .eq("group_id", groupId)
      .eq("status", "active")
      .order("joined_at", { ascending: true })
      .order("user_id", { ascending: true });

    if (erroMembros) {
      console.error("Erro ao ler membros para a semeadura:", erroMembros);
      return NextResponse.json(
        { error: "Não foi possível carregar os membros do grupo" },
        { status: 500 }
      );
    }

    // `nome` NAO vem desta rota, e isso e deliberado: nenhuma policy de
    // `profiles` olha `group_members` ([[ser-do-mesmo-grupo-nao-da-acesso-ao-perfil]]),
    // entao o nome do outro exigiria a service role tambem -- e a tela que chama
    // esta rota JA tem os nomes, porque ela desenhou os sliders com eles. Um campo
    // a mais aqui seria privilegio gasto para repetir o que o chamador sabe.
    const membros: MembroParaSemear[] = (membrosCrus ?? [])
      .filter((m) => m.id && m.user_id)
      .map((m) => ({ member_id: m.id, user_id: m.user_id }));

    const userIds = membros.map((m) => m.user_id);

    const hoje = today();
    const pedidoCru = request.nextUrl.searchParams.get("mes");
    const pedido = mesDaData(pedidoCru);
    const mes = pedido || mesDaData(hoje);

    // Grupo sem membro ativo: nao ha renda a ler nem lista a semear, e as duas
    // consultas com `in("user_id", [])` sao duas idas ao banco para nada.
    if (membros.length === 0) {
      return NextResponse.json({
        success: true,
        ...semearPelaRenda(membros, [], mes, user.id),
        mes_corrigido: Boolean(pedidoCru) && !pedido,
        today: hoje,
        viewer_user_id: user.id,
      });
    }

    // ----------------------------------------------------------------
    // 2. A receita do mes -- a unica leitura privilegiada desta rota
    // ----------------------------------------------------------------
    const admin = createServiceClient(url, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const primeiroDia = primeiroDiaDoMes(`${mes}-01`);
    const ultimoDia = ultimoDiaDoMes(`${mes}-01`);

    const { data: realizadas, error: erroRealizadas } = await admin
      .from("financial_transactions")
      .select(
        "id, description, amount, exchange_rate, transaction_date, user_id, transaction_type"
      )
      .in("user_id", userIds)
      .gte("transaction_date", primeiroDia)
      .lte("transaction_date", ultimoDia);

    if (erroRealizadas) {
      console.error("Erro ao ler a receita realizada:", erroRealizadas);
      return NextResponse.json(
        { error: "Não foi possível carregar a receita do mês" },
        { status: 500 }
      );
    }

    // `direction` da view, repassada crua: a precedencia entre o tipo da
    // ocorrencia e o da regra recorrente e da 027, e refazer esse COALESCE aqui e
    // o defeito que ela fechou. E a prevista com baixa sai em `linhaDoPrevisto`,
    // nao num `.neq()` -- senao a receita paga contaria duas vezes.
    const { data: previstas, error: erroPrevistas } = await admin
      .from("scheduled_transactions_effective")
      .select("id, description, amount, due_date, user_id, status, direction")
      .in("user_id", userIds)
      .gte("due_date", primeiroDia)
      .lte("due_date", ultimoDia);

    if (erroPrevistas) {
      console.error("Erro ao ler a receita prevista:", erroPrevistas);
      return NextResponse.json(
        { error: "Não foi possível carregar a receita prevista do mês" },
        { status: 500 }
      );
    }

    const linhas: LinhaCrua[] = [
      ...(realizadas ?? []).map(linhaDoRealizado),
      ...(previstas ?? [])
        .map(linhaDoPrevisto)
        .filter((l): l is LinhaCrua => l !== null),
    ];

    // ----------------------------------------------------------------
    // 3. A semeadura, com o recorte da privacidade dentro dela
    // ----------------------------------------------------------------
    // `user.id` e o `auth.uid()` da sessao, e nao `membership.id` nem nada que
    // tenha vindo do corpo: a privacidade e por quem a pessoa E, nao por um id que
    // ela pode nomear.
    const semeadura = semearPelaRenda(membros, linhas, mes, user.id);

    return NextResponse.json({
      success: true,
      ...semeadura,
      /** `true` = o `?mes=` pedido nao pôde ser usado e esta e a resposta do mes corrente. */
      mes_corrigido: Boolean(pedidoCru) && !pedido,
      today: hoje,
      viewer_user_id: user.id,
    });
  } catch (error) {
    console.error("Erro na semeadura pela renda:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
