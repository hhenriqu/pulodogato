/**
 * AS DUAS CATEGORIAS RESERVADAS DA CONVERSA -- HMO-481 (F3 do plano da HMO-462).
 *
 * `financial_transactions.category_id` e NOT NULL e a conversa NAO PERGUNTA
 * categoria -- nao e pergunta para ela. Entao o servidor resolve, e a linha
 * nasce POR USUARIO na primeira vez, SEM MIGRATION: a 036 deu `user_id` +
 * `transaction_categories_insert_own` (`WITH CHECK (user_id = auth.uid())`) a
 * `transaction_categories`. Nenhuma migration e o que mantem esta PR fora da
 * fila serializada.
 *
 * O caminho da 023 (seed global colado a mao no SQL Editor) nao se repete porque
 * nao precisa: ele foi necessario quando a tabela era global e o INSERT batia em
 * 42501 em toda chamada, de todo usuario.
 *
 * ===========================================================================
 * DUAS, E NAO UMA -- `is_expense` E NOT NULL
 * ===========================================================================
 * `transaction_categories.is_expense` e `boolean NOT NULL` (001:1308), e e o
 * DESEMPATE que o resto do app usa para dizer o que a linha e quando
 * `transaction_type` nao serve (degrau 2 de `classificarMovimentacao`, e o mesmo
 * degrau da backfill da 037). Uma categoria unica teria de escolher UM valor
 * para as duas direcoes, e metade das linhas dela sairia classificada ao
 * contrario -- "Ganhei 2000" catalogado como despesa.
 *
 * Isto e diferente da categoria do acerto (`lib/categoria-do-acerto.ts`), que e
 * `is_expense: false` nos dois lados de proposito: a perna do acerto e
 * `transfer`, que nao e nem receita nem despesa. As duas da conversa sao
 * exatamente uma despesa e uma receita.
 *
 * ===========================================================================
 * AS DUAS `description` DO LANCAMENTO MORAM AQUI, NO MESMO ARQUIVO
 * ===========================================================================
 * `financial_transactions.description` e NOT NULL (001:1137) e o que vai nela e
 * a palavra que ela apertou -- `Gastei` / `Ganhei`. Ela mora NESTE arquivo, ao
 * lado da categoria da mesma direcao, e nao na rota: sao duas facetas de UMA
 * escolha (o que esta linha e), e separadas elas divergem no dia em que alguem
 * conserta so uma -- a linha diria "Ganhei" com a categoria de gasto, e o
 * relatorio (que agrupa por categoria) discordaria da lista (que mostra a
 * descricao). Nenhum erro, nenhum log: duas leituras plausiveis que discordam.
 *
 * ===========================================================================
 * `is_active: false` NAS DUAS
 * ===========================================================================
 * Como na do acerto: assim elas NAO APARECEM nos seletores de categoria das
 * telas normais. Isto NAO esconde o dinheiro dela de nada -- a policy
 * `transaction_categories_read_own` (036:243) nao filtra `is_active`, de
 * proposito, e nenhuma view de relatorio peneira a categoria por essa coluna.
 * O preco de as linhas aparecerem nas telas normais esta declarado e aceito no
 * plano-mae: o "perfil separado" e da experiencia, nao um cofre no banco.
 */
import { createClient } from "@/utils/supabase/server";
import type { Direcao } from "@/lib/conversa-do-papel";

/** A linha de `transaction_categories` que uma direcao exige, e a palavra dela. */
export interface CategoriaReservadaDaConversa {
  /** `transaction_categories.name` -- a chave da busca, por usuario. */
  readonly name: string;
  /** `transaction_categories.is_expense` -- NOT NULL, e o desempate do app. */
  readonly is_expense: boolean;
  /** `financial_transactions.description` -- NOT NULL, a palavra que ela apertou. */
  readonly descricaoDoLancamento: string;
  /** `transaction_categories.description` -- so para quem for olhar o catalogo. */
  readonly descricaoDaCategoria: string;
}

/**
 * As duas reservadas, uma por direcao.
 *
 * O NOME e prefixado com o modo (`Papel de pao — ...`) e nao e a palavra do
 * botao: ele e o que ela vai ler no RELATORIO, que agrupa por categoria, e ali
 * uma categoria chamada so "Gastei" ficaria indistinguivel de uma categoria que
 * ela mesma tivesse criado com esse nome -- e a busca de reuso abaixo passaria a
 * adotar a categoria dela em vez de criar a reservada.
 */
export const CATEGORIAS_DA_CONVERSA: Readonly<
  Record<Direcao, CategoriaReservadaDaConversa>
> = {
  gastei: {
    name: "Papel de pão — gasto",
    is_expense: true,
    descricaoDoLancamento: "Gastei",
    descricaoDaCategoria:
      "Reservada: o que o modo Papel de Pão grava quando ela aperta " +
      "“Gastei”. Fora dos seletores (is_active = false) porque a conversa " +
      "não pergunta categoria.",
  },
  ganhei: {
    name: "Papel de pão — ganho",
    is_expense: false,
    descricaoDoLancamento: "Ganhei",
    descricaoDaCategoria:
      "Reservada: o que o modo Papel de Pão grava quando ela aperta " +
      "“Ganhei”. Fora dos seletores (is_active = false) porque a conversa " +
      "não pergunta categoria.",
  },
};

/**
 * A categoria reservada DAQUELA direcao, DAQUELE usuario, criando-a na primeira
 * vez.
 *
 * MESMA RECEITA DE `lib/categoria-do-acerto.ts`, e o parentesco e deliberado --
 * aquele arquivo ja e a segunda copia dela, depois da do ajuste de fatura
 * (HMO-253).
 *
 * SELECT-DEPOIS-INSERT, E NAO `ON CONFLICT`: a UNIQUE das categorias de usuario
 * e indice PARCIAL (`unique_categoria_do_usuario ... WHERE user_id IS NOT NULL`,
 * 036:192), e indice parcial NAO ARBITRA `ON CONFLICT` -- o `ON CONFLICT` sairia
 * com `42P10 there is no unique or exclusion constraint matching`, que e 500 na
 * cara dela.
 *
 * O ramo de `23505` RELE em vez de devolver erro: dois toques no Confirmar em
 * sequencia, ou a fila offline descarregando, mandam dois pedidos do mesmo
 * usuario, e o segundo acha a linha que o primeiro acabou de criar.
 *
 * `user_id` SAI DO SERVIDOR, nunca do corpo do pedido: e o que a policy de
 * insert compara com `auth.uid()`, e e a unica coisa que separa a categoria dela
 * da de outra pessoa. A busca tambem recorta por ele -- sem isso o lancamento
 * dela apontaria para a categoria homonima de outra pessoa, a FK nao reprovaria
 * (a linha existe), e o relatorio dela sairia sem a categoria.
 */
export async function categoriaDaConversa(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  serviceId: string,
  direcao: Direcao
): Promise<{ id: string } | { erro: string }> {
  const reservada = CATEGORIAS_DA_CONVERSA[direcao];

  const { data: existente, error: erroBusca } = await supabase
    .from("transaction_categories")
    .select("id")
    .eq("service_id", serviceId)
    .eq("user_id", userId)
    .eq("name", reservada.name)
    .maybeSingle();

  if (erroBusca) {
    console.error("Erro ao buscar a categoria da conversa:", erroBusca);
    return { erro: "Não foi possível preparar o lançamento" };
  }
  if (existente) return { id: existente.id };

  const { data: criada, error: erroCriacao } = await supabase
    .from("transaction_categories")
    .insert({
      service_id: serviceId,
      // Do servidor, nunca do corpo do pedido.
      user_id: userId,
      name: reservada.name,
      description: reservada.descricaoDaCategoria,
      icon: direcao === "gastei" ? "arrow-down" : "arrow-up",
      color_hex: direcao === "gastei" ? "#EF4444" : "#10B981",
      is_expense: reservada.is_expense,
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
        .eq("name", reservada.name)
        .maybeSingle();
      if (recem) return { id: recem.id };
    }
    console.error("Erro ao criar a categoria da conversa:", erroCriacao);
    return { erro: "Não foi possível preparar o lançamento" };
  }

  return { id: criada.id };
}
