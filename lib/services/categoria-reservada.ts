/**
 * UMA CATEGORIA RESERVADA DO USUARIO, CRIADA NA PRIMEIRA VEZ.
 *
 * `financial_transactions.category_id` e NOT NULL, e algumas linhas que o
 * proprio app grava nao tem categoria escolhida pela pessoa: o ajuste de saldo
 * da fatura (HMO-253) e, desde a comparacao com o Minhas Financas, o restante
 * de fatura levado para o mes seguinte e o encargo do pagamento parcial.
 *
 * A categoria nasce com `is_active = false`: o dono a le (a policy
 * `transaction_categories_read_own` nao filtra `is_active`), as telas a
 * reconhecem, e ninguem a escolhe por engano num lancamento comum, porque
 * `GET /api/personal-finance/categories` filtra `is_active = true`.
 *
 * SELECT-depois-INSERT, e nao `ON CONFLICT`: a UNIQUE das categorias de usuario
 * e um indice PARCIAL (`WHERE user_id IS NOT NULL`, 036), e indice parcial nao
 * serve de arbitro de `ON CONFLICT`. O ramo de 23505 cobre a corrida de dois
 * pedidos simultaneos do mesmo usuario.
 *
 * Devolve `null` em qualquer falha; quem chama escreve a frase do erro.
 */
export interface CategoriaReservada {
  nome: string;
  descricao: string;
  icone: string;
  cor: string;
  /** So o ultimo recurso de classificacao: as telas leem `transaction_type`. */
  ehDespesa: boolean;
}

export async function categoriaReservada(
  // O tipo do cliente do supabase-js so aparece na assinatura de createClient.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  serviceId: string,
  categoria: CategoriaReservada
): Promise<{ id: string } | null> {
  const buscar = () =>
    supabase
      .from("transaction_categories")
      .select("id")
      .eq("service_id", serviceId)
      .eq("user_id", userId)
      .eq("name", categoria.nome)
      .maybeSingle();

  const { data: existente, error: erroBusca } = await buscar();
  if (erroBusca) {
    console.error(`Erro ao buscar a categoria "${categoria.nome}":`, erroBusca);
    return null;
  }
  if (existente) return { id: existente.id };

  const { data: criada, error: erroCriacao } = await supabase
    .from("transaction_categories")
    .insert({
      service_id: serviceId,
      // Do servidor, NUNCA do corpo do pedido.
      user_id: userId,
      name: categoria.nome,
      description: categoria.descricao,
      icon: categoria.icone,
      color_hex: categoria.cor,
      is_expense: categoria.ehDespesa,
      is_active: false,
    })
    .select("id")
    .single();

  if (erroCriacao) {
    if (erroCriacao.code === "23505") {
      const { data: recem } = await buscar();
      if (recem) return { id: recem.id };
    }
    console.error(`Erro ao criar a categoria "${categoria.nome}":`, erroCriacao);
    return null;
  }

  return { id: criada.id };
}
