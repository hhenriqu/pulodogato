import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * O R$ DA RENDA E SO DO PROPRIO DONO (HMO-245, fase 6 / HMO-272).
 *
 * Esta rota e a antiga "divisao proporcional a renda", que chama
 * `calculate_member_proportions` e le `group_member_proportions`. A fase 6 nao a
 * aposentou (isso e a fase 7) -- mas ela vazava salario, e isso tinha de parar
 * agora:
 *
 *   * o POST devolvia o retorno CRU da funcao SQL, com `total_income` de TODO
 *     MUNDO para qualquer membro. O modal da tela imprimia "Renda: R$ ..." de
 *     cada pessoa, e quem abrisse a aba de rede veria o mesmo;
 *   * o GET recortava por PAPEL (`role === 'admin'`), que e outra regra: admin de
 *     grupo nao e dono do salario dos outros.
 *
 * A decisao do Helio e "percentual para todos; o R$ da renda so para o proprio
 * dono". Entao o recorte dos dois caminhos agora e o mesmo, e e por LINHA: o
 * `total_income` sobrevive apenas em `member_id === membership.id`, a linha de
 * `group_members` do proprio `auth.uid()`.
 *
 * O recorte mora AQUI, e nao no componente, pelo motivo de sempre: um
 * `{cond && ...}` no JSX esconde o numero da tela e o deixa no JSON que o
 * navegador baixou.
 *
 * A semeadura NOVA nao passa por aqui -- ela e
 * `GET /api/expense-groups/{groupId}/semear-divisao`, em TypeScript, porque esta
 * funcao SQL nao le previsto, perde linha com `transaction_type` nulo e inventa
 * R$ 1.000 para quem nao tem receita no mes.
 */

/** Uma linha de proporcao, como a funcao SQL e a tabela a devolvem. */
interface ProporcaoCrua {
  member_id?: string | null;
  total_income?: unknown;
}

/**
 * Tira `total_income` de toda linha que nao seja a de `memberIdDoDono`.
 *
 * A chave sai (`delete` por desestruturacao), em vez de virar `null`: o modal
 * esconde os dois igual, por causa do `&&` dele -- mas chave ausente e o que faz
 * a resposta nao CARREGAR o salario, que e o ponto desta mudanca.
 */
function semRendaAlheia<T extends ProporcaoCrua>(
  linhas: readonly T[],
  memberIdDoDono: string | null
): Record<string, unknown>[] {
  return linhas.map((linha) => {
    if (memberIdDoDono && linha.member_id === memberIdDoDono) {
      return { ...linha };
    }
    const { total_income: _soDoDono, ...resto } = linha;
    return resto;
  });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();

  try {
    // Verificar autenticação
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const { group_id, calculation_month } = body;

    if (!group_id) {
      return NextResponse.json(
        { error: "ID do grupo é obrigatório" },
        { status: 400 }
      );
    }

    // Verificar se o usuário é membro do grupo.
    //
    // O que se le e `id`, e nao `role`: e a linha de `group_members` do proprio
    // `auth.uid()`, e e ela que diz QUAL `total_income` sobrevive ao recorte lá
    // embaixo. O `role` saiu porque papel deixou de decidir isso.
    const { data: membership } = await supabase
      .from("group_members")
      .select("id")
      .eq("group_id", group_id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (!membership) {
      return NextResponse.json(
        { error: "Acesso negado ao grupo" },
        { status: 403 }
      );
    }

    // Definir mês de cálculo (padrão: mês atual)
    const targetMonth =
      calculation_month || new Date().toISOString().slice(0, 7) + "-01";

    // Chamar função do banco para calcular proporções
    const { data: proportions, error: calcError } = await supabase.rpc(
      "calculate_member_proportions",
      {
        p_group_id: group_id,
        p_calculation_month: targetMonth,
      }
    );

    if (calcError) {
      console.error("Error calculating proportions:", calcError);
      return NextResponse.json(
        { error: "Erro ao calcular proporções" },
        { status: 500 }
      );
    }

    // O retorno da funcao SQL NAO vai cru para o JSON: ele traz `total_income`
    // de todo mundo, e so a linha de quem pediu pode sair com o valor.
    const recortadas = semRendaAlheia(
      (proportions || []) as ProporcaoCrua[],
      membership.id
    );

    return NextResponse.json({
      success: true,
      calculation_month: targetMonth,
      proportions: recortadas,
      total_members: recortadas.length,
    });
  } catch (error) {
    console.error("Calculate proportions error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const supabase = createClient();
  const { searchParams } = new URL(request.url);
  const group_id = searchParams.get("group_id");
  const month = searchParams.get("month");

  try {
    // Verificar autenticação
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    if (!group_id) {
      return NextResponse.json(
        { error: "ID do grupo é obrigatório" },
        { status: 400 }
      );
    }

    // Verificar se o usuário é membro do grupo. `id` pelo mesmo motivo do POST:
    // e a linha cujo `total_income` sobrevive.
    const { data: membership } = await supabase
      .from("group_members")
      .select("id")
      .eq("group_id", group_id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (!membership) {
      return NextResponse.json(
        { error: "Acesso negado ao grupo" },
        { status: 403 }
      );
    }

    // Definir mês de consulta (padrão: mês atual)
    const targetMonth = month || new Date().toISOString().slice(0, 7) + "-01";

    // Buscar proporções existentes para o mês
    const { data: existingProportions, error: fetchError } = await supabase
      .from("group_member_proportions")
      .select(
        `
        id,
        member_id,
        total_income,
        proportion_percentage,
        calculated_at
      `
      )
      .eq("group_id", group_id)
      .eq("calculation_month", targetMonth)
      .eq("is_active", true)
      .order("proportion_percentage", { ascending: false });

    if (fetchError) {
      console.error("Error fetching proportions:", fetchError);
      return NextResponse.json(
        { error: "Erro ao buscar proporções" },
        { status: 500 }
      );
    }

    // Processar dados simplificados (frontend buscará detalhes dos membros separadamente)
    //
    // O recorte NAO e mais por papel. Admin de grupo nao e dono do salario dos
    // outros: quem ve o R$ e o dono da linha, e so ele. `can_view_absolute` saiu
    // da resposta junto com a regra -- um booleano por PESSOA nao descreve mais
    // um recorte que e por LINHA (ninguem lia a chave; conferido na tela que
    // chama esta rota).
    const processedProportions = semRendaAlheia(
      existingProportions?.map((prop) => ({
        member_id: prop.member_id,
        proportion_percentage: prop.proportion_percentage,
        total_income: prop.total_income,
        calculated_at: prop.calculated_at,
      })) || [],
      membership.id
    );

    return NextResponse.json({
      group_id,
      calculation_month: targetMonth,
      proportions: processedProportions,
      total_members: processedProportions.length,
      needs_recalculation: processedProportions.length === 0,
    });
  } catch (error) {
    console.error("Get proportions error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
