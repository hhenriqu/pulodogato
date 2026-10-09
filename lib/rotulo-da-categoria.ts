// -----------------------------------------------------------------------------
// A SUBCATEGORIA NA LINHA DA LISTA (HMO-221)
// -----------------------------------------------------------------------------
// Gap conhecido da HMO-216, deixado de fora de proposito. A subcategoria sempre
// foi GRAVADA e LIDA DE VOLTA -- quem lanca em "Alimentação / Mercado" e reabre
// o lancamento ve "Mercado" no seletor, e /dashboard/categorias lista as
// subcategorias de cada categoria. O que faltava era a LISTA: ela mostrava so
// `transaction.category?.name`, e duas despesas em subcategorias diferentes da
// mesma categoria ficavam com exatamente a mesma cara.
//
// O EMBED RESOLVE, E ISSO FOI MEDIDO CONTRA O POSTGREST DE PRODUCAO
// -----------------------------------------------------------------
// A duvida que segurou esta issue: a FK de `financial_transactions` para
// `transaction_subcategories` e COMPOSTA -- `(category_id, subcategory_id)
// REFERENCES transaction_subcategories (category_id, id)` (036) --, e um embed
// que o PostgREST nao resolve volta 400 e derruba a LISTA INTEIRA. Nada disso
// aparece no `tsc`, no `next build` nem em teste puro, e o sandbox nao tem
// PostgREST para perguntar.
//
// Medido em 2026-10-09 contra `odxqjvtxsioksguuevqm`, com a conta de teste:
//
//   select=id,subcategory:transaction_subcategories(id,name)   -> 200
//   select=id,xoxo:transaction_xoxo(id,name)   (controle)      -> 400 PGRST200
//
// O controle e o que da valor ao alvo: ele prova que a resolucao da relacao
// acontece ANTES do acesso ao dado, entao o 200 do alvo e resposta sobre a FK
// COMPOSTA e nao sobre a linha. Tres coisas ficaram provadas de uma vez:
//
//   1. a FK composta resolve SEM dica de desambiguacao -- nao ha segunda FK
//      entre as duas tabelas, entao nao ha PGRST201 a contornar;
//   2. o embed vem como OBJETO ou `null`, nao como array. (Sobre VIEW o
//      supabase-js tipa no plural e a leitura vira `undefined` calado; aqui e
//      tabela com FK visivel, e ele resolve muitos-para-um.) Mesmo assim a
//      normalizacao abaixo aceita as duas formas: ela custa tres linhas e o
//      defeito que ela evita nao tem sintoma;
//   3. a linha com `subcategory_id` NULO vem NORMAL, com `subcategory: null` --
//      o join e LEFT. Era a terceira preocupacao da issue (a assinatura
//      `1, 0, 0`, em que o embed nulo faz o cliente DESCARTAR a linha): aqui
//      nao se aplica, porque quem descartava era o codigo do cliente, e o
//      codigo deste arquivo nunca esconde uma linha -- no pior caso ele diz
//      menos sobre ela.
//
// POR QUE "Outros" NAO APARECE, E POR QUE ISSO NAO E ENFEITE
// ---------------------------------------------------------
// A issue pede o rotulo como "Categoria - Subcategoria". Escrito ao pe da
// letra, o resultado na tela de hoje seria "Alimentação - Outros" em QUASE TODA
// LINHA -- e isso nao e a feature, e o contrario dela.
//
// O motivo esta em duas decisoes anteriores que se somam:
//
//   * a 036 da a TODA categoria uma subcategoria "Outros", por invariante
//     (trigger `criar_subcategoria_outros` + backfill). Em producao, hoje, ela
//     e a UNICA subcategoria que existe: as 6 lidas da conta de teste sao todas
//     "Outros", com `user_id` nulo;
//   * o formulario PRE-SELECIONA essa "Outros" (`subcategoriaCoerente`, da
//     HMO-216) em vez de deixar o campo vazio -- deliberadamente, para nao
//     obrigar dois cliques.
//
// Ou seja: "Outros" nao e uma escolha que a pessoa fez, e o default que o
// formulario fez por ela. Repetir esse default em toda linha gastaria a unica
// coisa que esta linha tem de escasso -- largura -- para dizer nada, e ainda
// empurraria para fora o DESTINO que a HMO-215 acabou de colocar ali. Pior: um
// rotulo que se repete identico em tudo treina o olho a nao ler o campo, e no
// dia em que aparecesse um "Alimentação - Mercado" de verdade ele passaria
// batido.
//
// Entao a regra e: a subcategoria aparece quando ela DISTINGUE a linha de outra
// da mesma categoria. "Outros" nunca distingue -- ele existe em todas. E a
// mesma leitura que `ordenarSubcategorias` ja aplica ao joga-lo para o fim da
// lista, e o nome sai de `SUBCATEGORIA_PADRAO` por import, e nao de um "Outros"
// escrito a mao aqui: duas copias divergem na primeira vez que alguem renomear.
//
// O QUE ESTE ARQUIVO NUNCA FAZ: ESCONDER A LINHA, OU INVENTAR O LADO QUE FALTA
// ---------------------------------------------------------------------------
// Todo caminho daqui devolve uma string -- no limite a vazia, que e exatamente
// o que a tela ja mostrava quando `category` nao vinha. Nenhum retorno depende
// de a categoria existir, porque `category` E um embed e embed cai na RLS de
// quem le: trata-lo como obrigatorio e o caminho conhecido para a linha
// desaparecer da tela sem erro nenhum.
// -----------------------------------------------------------------------------

import { SUBCATEGORIA_PADRAO } from "@/lib/categorias";

/** O que o rotulo precisa saber da categoria. */
export interface CategoriaDoRotulo {
  name?: string | null;
}

/** O que o rotulo precisa saber da subcategoria. */
export interface SubcategoriaDoRotulo {
  name?: string | null;
}

/**
 * Uma linha da lista, do ponto de vista do rotulo.
 *
 * Os dois embeds sao opcionais e podem vir `null`. `subcategory` aceita
 * tambem ARRAY: medido, o PostgREST devolve objeto para esta FK (ver o
 * cabecalho), mas o custo de aceitar as duas formas e tres linhas e o custo de
 * errar e um campo que vira `undefined` sem nenhum sintoma.
 */
export interface LancamentoComCategoria {
  category?: CategoriaDoRotulo | null;
  subcategory?: SubcategoriaDoRotulo | SubcategoriaDoRotulo[] | null;
}

/** O separador entre os dois nomes. */
const SEPARADOR = " - ";

/**
 * Um nome utilizavel, ou `null`.
 *
 * Nome em branco conta como ausente -- a mesma regra de `nomeDaConta` em
 * lib/destino-do-lancamento.ts. Sem o `trim`, um nome de um espaco produziria
 * "Alimentação -  " na tela: um separador apontando para nada.
 */
function nomeUtilizavel(valor: string | null | undefined): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

/**
 * A subcategoria da linha, nas duas formas que o embed pode ter.
 *
 * Array vazio e a mesma ausencia que `null`.
 */
function subcategoriaDaLinha(
  valor: LancamentoComCategoria["subcategory"]
): SubcategoriaDoRotulo | null {
  if (!valor) return null;
  if (Array.isArray(valor)) return valor[0] ?? null;
  return valor;
}

/**
 * `true` quando o nome da subcategoria nao distingue a linha de nenhuma outra.
 *
 * Hoje isso e so a "Outros" da 036 -- ver o cabecalho deste arquivo.
 */
function subcategoriaDistingue(nome: string): boolean {
  return nome !== SUBCATEGORIA_PADRAO;
}

/**
 * O que a linha da lista mostra no lugar de `transaction.category?.name`.
 *
 * - categoria e subcategoria proprias -> `"Alimentação - Mercado"`;
 * - subcategoria ausente, ou a "Outros" que o formulario pre-seleciona ->
 *   `"Alimentação"`, igual a antes desta issue;
 * - categoria que a RLS nao devolveu, mas subcategoria sim -> o nome da
 *   subcategoria SOZINHO. Nao e o rotulo ideal, e e o unico fato verdadeiro
 *   que sobrou: desenhar `" - Mercado"` seria um separador com um lado em
 *   branco, e devolver vazio jogaria fora informacao que chegou;
 * - nada legivel -> string vazia, que e o que a tela ja mostrava.
 */
export function rotuloDaCategoria(mov: LancamentoComCategoria): string {
  const categoria = nomeUtilizavel(mov.category?.name);
  const sub = nomeUtilizavel(subcategoriaDaLinha(mov.subcategory)?.name);

  const subVisivel = sub && subcategoriaDistingue(sub) ? sub : null;

  if (categoria && subVisivel) return `${categoria}${SEPARADOR}${subVisivel}`;
  if (categoria) return categoria;
  return subVisivel ?? "";
}
