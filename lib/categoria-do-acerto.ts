import { createClient } from "@/utils/supabase/server";
import {
  DESCRICAO_DA_CATEGORIA_DE_ACERTO,
  NOME_DA_CATEGORIA_DE_ACERTO,
} from "@/lib/acerto-em-lancamento";

/**
 * A categoria reservada do acerto DAQUELE usuario, criando-a na primeira vez.
 *
 * Nasceu dentro de `settlements/route.ts` na fase 11 e saiu para ca na fase 12,
 * quando a rota da perna da contraparte passou a precisar do MESMO passo: a
 * perna dela tambem tem `category_id NOT NULL` para preencher, e tambem na
 * primeira vez que aquela pessoa toca num acerto. Duas copias divergiriam no
 * campo que importa -- `is_expense` ou `is_active` diferentes criariam DUAS
 * categorias de nome igual para o mesmo usuario, uma por rota, e a segunda
 * apareceria no seletor de categorias.
 *
 * Mesma receita do ajuste de fatura (HMO-253,
 * `app/api/card-invoices/ajuste/route.ts`): `category_id` e NOT NULL, acerto nao
 * tem categoria, e a 036 deu `user_id` + `transaction_categories_insert_own`
 * (`WITH CHECK (user_id = auth.uid())`) a `transaction_categories` -- entao a
 * linha nasce aqui, por usuario, sem migration.
 *
 * O caminho da 023 (seed global, colado a mao no SQL Editor) nao se repete: ele
 * foi necessario porque a tabela era global e o INSERT batia em 42501 em toda
 * chamada, de todo usuario.
 *
 * SELECT-depois-INSERT e nao `ON CONFLICT`: a UNIQUE das categorias de usuario e
 * indice PARCIAL (`WHERE user_id IS NOT NULL`), e indice parcial nao arbitra
 * `ON CONFLICT`. O ramo de 23505 cobre dois pedidos simultaneos do mesmo
 * usuario.
 */
export async function categoriaDoAcerto(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  serviceId: string
): Promise<{ id: string } | { erro: string }> {
  const { data: existente, error: erroBusca } = await supabase
    .from("transaction_categories")
    .select("id")
    .eq("service_id", serviceId)
    .eq("user_id", userId)
    .eq("name", NOME_DA_CATEGORIA_DE_ACERTO)
    .maybeSingle();

  if (erroBusca) {
    console.error("Erro ao buscar a categoria do acerto:", erroBusca);
    return { erro: "Nao foi possivel preparar o lancamento do acerto" };
  }
  if (existente) return { id: existente.id };

  const { data: criada, error: erroCriacao } = await supabase
    .from("transaction_categories")
    .insert({
      service_id: serviceId,
      // Do servidor, nunca do corpo do pedido.
      user_id: userId,
      name: NOME_DA_CATEGORIA_DE_ACERTO,
      description: DESCRICAO_DA_CATEGORIA_DE_ACERTO,
      icon: "handshake",
      color_hex: "#6B7280",
      // `is_expense` e NOT NULL e e lido so como ultimo recurso: as telas
      // classificam por `transaction_type`, e a perna do acerto sempre grava o
      // tipo. FALSE porque a perna NAO e despesa em nenhum dos dois lados --
      // ela e `transfer` --, e um fallback que dissesse "despesa" seria a
      // afirmacao errada justamente para quem recebeu.
      is_expense: false,
      is_active: false,
    })
    .select("id")
    .single();

  if (erroCriacao) {
    if (erroCriacao.code === "23505") {
      const { data: recem } = await supabase
        .from("transaction_categories")
        .select("id")
        .eq("service_id", serviceId)
        .eq("user_id", userId)
        .eq("name", NOME_DA_CATEGORIA_DE_ACERTO)
        .maybeSingle();
      if (recem) return { id: recem.id };
    }
    console.error("Erro ao criar a categoria do acerto:", erroCriacao);
    return { erro: "Nao foi possivel preparar o lancamento do acerto" };
  }

  return { id: criada.id };
}
