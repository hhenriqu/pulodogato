// ---------------------------------------------------------------------------
// O CATALOGO DE CATEGORIAS DE QUEM ESTA PEDINDO (HMO-216)
// ---------------------------------------------------------------------------
// Antes da HMO-216 esta rota era um SELECT numa tabela global: a resposta era a
// mesma para todo mundo. Agora ela responde tres coisas de uma vez, e e
// importante que seja de uma vez:
//
//   categories    -> catalogo + as da pessoa, com o nome/cor/icone EFETIVOS
//   subcategories -> as subcategorias visiveis, para o segundo seletor
//   prefs         -> a personalizacao crua, para a tela de editar
//
// Tres requisicoes separadas deixariam a tela montar o seletor com o nome do
// catalogo e corrigir depois -- o nome piscando na frente da pessoa --, e no
// modo offline ela guardaria tres respostas que podem ser de momentos
// diferentes.
//
// `categories` sai com o nome EFETIVO aplicado no servidor de proposito: cinco
// paginas (bills, budgets, categorization, payroll, statements) consomem esta
// rota e nenhuma delas conhece `transaction_category_prefs`. Mandar o nome cru
// faria a personalizacao valer so na tela de lancamento, que e o pior dos dois
// mundos -- a pessoa renomeia e o relatorio continua com o nome antigo.
//
// `prefs` vai junto, crua, porque a tela de editar precisa distinguir "esta
// categoria chama Rolê" de "esta categoria chama Lazer e EU a chamo de Rolê":
// a primeira leitura permite salvar; a segunda, nao (a linha e dos outros).
// ---------------------------------------------------------------------------

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  categoriaEfetiva,
  validarNomeDeCategoria,
  mensagemDeErroDeNome,
  type Categoria,
  type PreferenciaDeCategoria,
} from "@/lib/categorias";

export const dynamic = "force-dynamic";

/** O servico de financas pessoais, que e o dono de toda categoria desta tela. */
async function servicoDeFinancasPessoais(
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  const { data } = await supabase
    .from("financial_services")
    .select("id")
    .eq("name", "personal_finance")
    .single();
  return data?.id as string | undefined;
}

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const serviceId = await servicoDeFinancasPessoais(supabase);
    if (!serviceId) {
      return NextResponse.json(
        { error: "Personal finance service not found" },
        { status: 404 }
      );
    }

    // Sem filtro de `user_id` aqui, e isso e deliberado: quem decide o que
    // volta e a RLS da 036 (catalogo + as minhas). Repetir o filtro no SELECT
    // seria uma segunda regra de visibilidade competindo com a policy -- e a
    // que nao esta no banco e a que esquece de ser atualizada.
    //
    // `is_active` SIM: a policy devolve as minhas inclusive desativadas, de
    // proposito (a tela de gerenciar precisa delas para reativar). Esta rota
    // monta SELETOR.
    const { data: categoriasCruas, error } = await supabase
      .from("transaction_categories")
      .select("id, name, description, icon, color_hex, is_expense, is_active, user_id")
      .eq("service_id", serviceId)
      .eq("is_active", true)
      .order("name");

    if (error) {
      console.error("Database error:", error);
      return NextResponse.json(
        { error: "Failed to fetch categories" },
        { status: 500 }
      );
    }

    const categorias = (categoriasCruas ?? []) as Categoria[];

    // As duas consultas seguintes nao tem `.eq("user_id", ...)` pelo mesmo
    // motivo: `transaction_category_prefs` so devolve as minhas pela policy, e
    // `transaction_subcategories` devolve catalogo + minhas.
    const [{ data: prefsCruas }, { data: subcategoriasCruas }] = await Promise.all([
      supabase
        .from("transaction_category_prefs")
        .select("category_id, name, icon, color_hex, is_hidden"),
      supabase
        .from("transaction_subcategories")
        .select("id, category_id, name, user_id, is_active")
        .eq("is_active", true)
        .order("name"),
    ]);

    const prefs = (prefsCruas ?? []) as PreferenciaDeCategoria[];
    const porCategoria = new Map(prefs.map((p) => [p.category_id, p]));

    // A ORDENACAO E A FILTRAGEM POR TIPO NAO ACONTECEM AQUI
    // ----------------------------------------------------
    // Elas sao de `categoriasDoSeletor` (lib/categorias.ts), que roda no
    // cliente -- inclusive sobre a copia offline do catalogo, onde nao ha
    // servidor para ordenar. Fazer as duas coisas nos dois lugares e como as
    // tres copias da regra de transferencia acabaram divergindo.
    //
    // O que o servidor faz e so o que o cliente nao consegue: aplicar a
    // personalizacao, que exige a tabela de prefs.
    const categories = categorias.map((c) =>
      categoriaEfetiva(c, porCategoria.get(c.id))
    );

    return NextResponse.json({
      categories,
      subcategories: subcategoriasCruas ?? [],
      prefs,
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST: a pessoa cria uma categoria
// ---------------------------------------------------------------------------
// "ao selecionar uma categoria, ele tem a opcao de criar uma nova categoria."
//
// `user_id` sai de `user.id` do servidor, NUNCA do corpo da requisicao. A
// policy da 036 recusaria um `user_id` alheio de qualquer forma, mas aceitar o
// campo do cliente ja seria errado antes disso: o 42501 chegaria na tela como
// "erro ao criar categoria", escondendo que o pedido estava malformado.
//
// A subcategoria "Outros" NAO e criada aqui. Ela nasce pelo trigger da 036
// (`criar_subcategoria_outros`), e por isso vale tambem para categoria criada
// por migration -- o caso em que nao existe rota nenhuma rodando.
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const corpo = await request.json().catch(() => null);
    const nome = typeof corpo?.name === "string" ? corpo.name.trim() : "";
    const ehDespesa = corpo?.is_expense;

    // `is_expense` e obrigatorio e nao tem default: uma categoria criada do
    // lado errado aparece na tela oposta a que a pessoa estava usando, e
    // corrigir depois exige editar a categoria -- nao o lancamento.
    if (typeof ehDespesa !== "boolean") {
      return NextResponse.json(
        { error: "Informe se a categoria é de despesa ou de receita." },
        { status: 400 }
      );
    }

    const serviceId = await servicoDeFinancasPessoais(supabase);
    if (!serviceId) {
      return NextResponse.json(
        { error: "Personal finance service not found" },
        { status: 404 }
      );
    }

    // A duplicata e conferida contra o que a pessoa VE (catalogo + as dela),
    // que e o escopo que a RLS devolve. Dizer "esse nome já existe" sobre uma
    // categoria de outra pessoa seria uma mensagem impossivel de resolver.
    const { data: visiveis } = await supabase
      .from("transaction_categories")
      .select("id, name, is_expense")
      .eq("service_id", serviceId);

    const escopo = (visiveis ?? []).filter((c) => c.is_expense === ehDespesa);
    const erro = validarNomeDeCategoria(nome, escopo);
    if (erro) {
      return NextResponse.json(
        { error: mensagemDeErroDeNome(erro) },
        { status: 400 }
      );
    }

    const { data: criada, error } = await supabase
      .from("transaction_categories")
      .insert({
        service_id: serviceId,
        user_id: user.id,
        name: nome,
        is_expense: ehDespesa,
        icon: typeof corpo?.icon === "string" && corpo.icon.trim() ? corpo.icon.trim() : null,
        color_hex: corFinal(corpo?.color_hex),
        is_active: true,
      })
      .select("id, name, icon, color_hex, is_expense, is_active, user_id")
      .single();

    if (error || !criada) {
      // 23505 aqui e corrida, nao bug: duas abas da mesma pessoa criando o
      // mesmo nome. A mensagem e a mesma da validacao de cima porque o estado
      // e o mesmo -- "ja existe" --, e nao um erro interno.
      if (error?.code === "23505") {
        return NextResponse.json(
          { error: mensagemDeErroDeNome("duplicado") },
          { status: 409 }
        );
      }
      console.error("Erro ao criar categoria:", error);
      return NextResponse.json(
        { error: "Não foi possível criar a categoria." },
        { status: 500 }
      );
    }

    // A subcategoria "Outros" acabou de nascer pelo trigger. Devolvemos ela
    // junto para que a tela possa pre-selecionar sem uma segunda ida ao
    // servidor -- e, mais importante, para que a resposta PROVE que o
    // invariante valeu. Se a 036 nao estiver aplicada em producao, isto volta
    // vazio e a tela sabe que nao ha subcategoria a oferecer.
    const { data: subcategorias } = await supabase
      .from("transaction_subcategories")
      .select("id, category_id, name, user_id, is_active")
      .eq("category_id", criada.id);

    return NextResponse.json(
      {
        category: categoriaEfetiva(criada as Categoria),
        subcategories: subcategorias ?? [],
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * A cor, ou nada.
 *
 * O CHECK da 036 so existe em `transaction_category_prefs`; nesta tabela a
 * coluna e texto livre desde o 001. Validar aqui tambem porque o valor entra
 * em `style`/`className` na tela -- e `transaction_categories.color_hex` nao
 * tem CHECK que impeca `red; background: url(...)`.
 */
function corFinal(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  return /^#[0-9A-Fa-f]{6}$/.test(valor.trim()) ? valor.trim() : null;
}
