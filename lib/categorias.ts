// ---------------------------------------------------------------------------
// AS REGRAS DE CATEGORIA E SUBCATEGORIA (HMO-216)
// ---------------------------------------------------------------------------
// Este arquivo responde cinco perguntas, e nenhuma delas toca rede ou banco --
// e por isso todas tem teste (`scripts/test-categorias.mjs`):
//
//   1. que nome/cor/icone a pessoa VE numa categoria          -> `categoriaEfetiva`
//   2. que categorias entram no seletor, e em que ordem       -> `categoriasDoSeletor`
//   3. que subcategorias entram no seletor da categoria X     -> `subcategoriasDaCategoria`
//   4. qual subcategoria vem pre-selecionada                  -> `subcategoriaPadrao`
//   5. um nome digitado serve? ja existe?                     -> `validarNomeDeCategoria`
//
// Elas estao aqui, e nao no componente, por dois motivos medidos neste repo:
// a tela de lancamento tem copia offline do catalogo (entao o filtro precisa
// rodar sem servidor), e `Select` do Radix nao renderiza valor no servidor --
// a regra de selecao tem de ser funcao pura para ser testavel sem navegador.
//
// A CONTABILIZACAO nao esta aqui. Subcategoria nao muda sinal, nao muda
// natureza e nao entra em soma nenhuma: ela e um detalhe DENTRO da categoria,
// e quem soma continua somando por `category_id`.
// ---------------------------------------------------------------------------

/** O nome da subcategoria que toda categoria tem por padrao (036, SECAO 5). */
export const SUBCATEGORIA_PADRAO = "Outros";

/** Teto de nome, igual ao CHECK da 036. Validar antes evita um 23514 na tela. */
export const MAX_NOME_DE_CATEGORIA = 60;

/**
 * Uma linha de `transaction_categories`.
 *
 * `user_id` e o campo que decide quase tudo: `null` significa catalogo (a
 * linha e de todo mundo, e so da para personalizar por preferencia), e
 * preenchido significa que a linha e da pessoa e pode ser editada direto.
 */
export interface Categoria {
  id: string;
  name: string;
  is_expense: boolean;
  user_id?: string | null;
  icon?: string | null;
  color_hex?: string | null;
  is_active?: boolean | null;
}

/** Uma linha de `transaction_category_prefs`. */
export interface PreferenciaDeCategoria {
  category_id: string;
  name?: string | null;
  icon?: string | null;
  color_hex?: string | null;
  is_hidden?: boolean | null;
}

/** Uma linha de `transaction_subcategories`. */
export interface Subcategoria {
  id: string;
  category_id: string;
  name: string;
  user_id?: string | null;
  is_active?: boolean | null;
}

/** O que a tela desenha: a categoria depois de aplicada a personalizacao. */
export interface CategoriaEfetiva extends Categoria {
  /** `true` quando a linha e do catalogo -- a tela mostra "personalizar", nao "editar". */
  doCatalogo: boolean;
  /** `true` quando ha preferencia gravada para ela. */
  personalizada: boolean;
}

/**
 * O nome, o icone e a cor que ESTA pessoa ve nesta categoria.
 *
 * `COALESCE(pref, linha)` campo por campo, e nao "se tem pref use a pref":
 * uma preferencia que so mudou a cor tem `name` nulo, e tratar o objeto todo
 * como substituto apagaria o nome na tela. Foi por isso que as tres colunas da
 * tabela nasceram nulaveis em vez de copiarem o valor do catalogo -- assim uma
 * correcao no catalogo ("Alimentacão" -> "Alimentação") chega a quem
 * personalizou so a cor.
 */
export function categoriaEfetiva(
  categoria: Categoria,
  pref?: PreferenciaDeCategoria | null
): CategoriaEfetiva {
  return {
    ...categoria,
    name: naoVazio(pref?.name) ?? categoria.name,
    icon: naoVazio(pref?.icon) ?? categoria.icon ?? null,
    color_hex: naoVazio(pref?.color_hex) ?? categoria.color_hex ?? null,
    doCatalogo: !categoria.user_id,
    personalizada: Boolean(pref),
  };
}

/**
 * String em branco conta como ausente.
 *
 * O CHECK da 036 proibe `''` na coluna, mas o que chega aqui pode ter vindo da
 * fila offline ou de um `?? ""` de qualquer camada do app -- e um nome vazio
 * na tela e pior que um nome errado: o item do seletor fica sem texto e da
 * para escolher sem ver.
 */
function naoVazio(valor?: string | null): string | null | undefined {
  if (valor === null || valor === undefined) return undefined;
  return valor.trim().length > 0 ? valor : undefined;
}

/**
 * As categorias que entram no seletor desta tela, personalizadas e ordenadas.
 *
 * Tres filtros, e cada um tem uma razao diferente de existir:
 *
 *   - `is_expense` separa despesa de receita. Ja era assim (`categoriasDoTipo`
 *     em lib/lancamento.ts); aqui ele volta porque a ordenacao e a
 *     personalizacao tem de acontecer DEPOIS do filtro, senao a pessoa ve
 *     "Salário" na tela de despesa;
 *   - `is_active === false` sai. Desativar e como a pessoa "apaga" uma
 *     categoria propria que ja tem lancamento apontando para ela (a FK e
 *     RESTRICT), e o historico continua mostrando o nome certo;
 *   - `is_hidden` sai. E a unica forma honesta de "apagar" uma categoria do
 *     CATALOGO, que e dos outros usuarios tambem.
 *
 * A ordem coloca as categorias DA PESSOA primeiro. Quem criou "Terapia" criou
 * porque vai usar; deixar as 12 do catalogo na frente, em ordem alfabetica,
 * esconderia a categoria nova no meio de uma lista que a pessoa nao escolheu.
 * Dentro de cada grupo, alfabetica pelo nome EFETIVO -- ordenar pelo nome do
 * catalogo deixaria "Rolê" aparecendo onde "Lazer" estaria.
 */
export function categoriasDoSeletor(
  categorias: Categoria[],
  prefs: PreferenciaDeCategoria[],
  tipo: "income" | "expense"
): CategoriaEfetiva[] {
  const porCategoria = new Map(prefs.map((p) => [p.category_id, p]));
  const querDespesa = tipo === "expense";

  return categorias
    .filter((c) => c.is_expense === querDespesa)
    .filter((c) => c.is_active !== false)
    .filter((c) => !porCategoria.get(c.id)?.is_hidden)
    .map((c) => categoriaEfetiva(c, porCategoria.get(c.id)))
    .sort((a, b) => {
      if (a.doCatalogo !== b.doCatalogo) return a.doCatalogo ? 1 : -1;
      return a.name.localeCompare(b.name, "pt-BR");
    });
}

/**
 * As subcategorias de uma categoria, para o segundo seletor.
 *
 * "Outros" vai para o FIM, sempre, e isso nao e estetica: ele existe em toda
 * categoria por invariante, entao em ordem alfabetica ele cairia no meio da
 * lista ("Mercado", "Outros", "Restaurante") -- no lugar onde a pessoa espera
 * uma subcategoria de verdade, e logo acima da que ela queria. No fim ele le
 * como o que e: a saida para quando nenhuma das outras serve.
 */
export function subcategoriasDaCategoria(
  subcategorias: Subcategoria[],
  categoriaId: string
): Subcategoria[] {
  return subcategorias
    .filter((s) => s.category_id === categoriaId)
    .filter((s) => s.is_active !== false)
    .sort((a, b) => {
      const aPadrao = a.name === SUBCATEGORIA_PADRAO;
      const bPadrao = b.name === SUBCATEGORIA_PADRAO;
      if (aPadrao !== bPadrao) return aPadrao ? 1 : -1;
      return a.name.localeCompare(b.name, "pt-BR");
    });
}

/**
 * Qual subcategoria vem marcada quando a pessoa escolhe uma categoria.
 *
 * "Outros", quando existe -- e o que "por padrao toda categoria tem a
 * subcategoria Outros" significa na tela. Deixar o campo vazio obrigaria um
 * segundo clique em toda despesa para gravar a mesma coisa.
 *
 * Devolve `""` quando a categoria nao tem subcategoria nenhuma, e nao lanca:
 * ha 13 categorias em producao que so vao ter "Outros" depois de alguem colar
 * a 036 no SQL Editor, e entre o deploy e a colagem a tela precisa abrir.
 * Deploy publica codigo, nao schema.
 */
export function subcategoriaPadrao(
  subcategorias: Subcategoria[],
  categoriaId: string
): string {
  const daCategoria = subcategoriasDaCategoria(subcategorias, categoriaId);
  const padrao = daCategoria.find((s) => s.name === SUBCATEGORIA_PADRAO);
  return padrao?.id ?? daCategoria[0]?.id ?? "";
}

/** O que `validarNomeDeCategoria` responde. */
export type ErroDeNome =
  | "vazio"
  | "comprido"
  | "duplicado"
  | null;

/**
 * O nome digitado serve?
 *
 * Existe para que a tela nao dependa do banco para dizer "ja existe": os dois
 * erros que o Postgres devolveria aqui -- 23505 da unique e 23514 do CHECK --
 * chegam na rota como numero, e virariam "Erro ao criar categoria" na tela.
 *
 * A comparacao de duplicata e `trim` + minusculas sem acento, mais larga que a
 * unique do banco (que e byte a byte). De proposito: quem ja tem "Pets" e
 * digita "pets " nao quer uma segunda categoria, quer a que tem. A unique do
 * banco continua sendo a autoridade -- esta checagem so antecipa o caso
 * comum com uma mensagem que diz o que fazer.
 *
 * `escopo` recebe as categorias que concorrem pelo nome: as da PESSOA mais as
 * do catalogo que ela ve. Nao as de todo mundo -- ela nao as enxerga, e dizer
 * "esse nome ja existe" sobre uma categoria invisivel seria uma mensagem
 * impossivel de resolver (ver `mensagem-de-erro-unica-para-dois-estados`).
 */
export function validarNomeDeCategoria(
  nome: string,
  escopo: { id: string; name: string }[],
  ignorarId?: string
): ErroDeNome {
  const limpo = nome.trim();
  if (limpo.length === 0) return "vazio";
  if (limpo.length > MAX_NOME_DE_CATEGORIA) return "comprido";

  const chave = normalizar(limpo);
  const colide = escopo.some(
    (c) => c.id !== ignorarId && normalizar(c.name) === chave
  );
  return colide ? "duplicado" : null;
}

/** A mensagem que a tela mostra para cada erro. Uma frase por estado. */
export function mensagemDeErroDeNome(erro: ErroDeNome): string | null {
  switch (erro) {
    case "vazio":
      return "Dê um nome para a categoria.";
    case "comprido":
      return `O nome tem no máximo ${MAX_NOME_DE_CATEGORIA} caracteres.`;
    case "duplicado":
      return "Você já tem uma categoria com esse nome.";
    default:
      return null;
  }
}

/**
 * Sem acento, sem caixa, sem espaco nas pontas.
 *
 * `NFD` + remocao de diacriticos em vez de uma tabela de substituicao: a
 * tabela esqueceria o "ç" ou o "ã" na primeira revisao, e o sintoma seria uma
 * categoria duplicada que a pessoa nao consegue explicar.
 *
 * A classe e escrita com escapes (`\u0300-\u036f`, o bloco "Combining
 * Diacritical Marks") e nao com os caracteres literais: marca combinante no
 * meio de um arquivo-fonte e invisivel no editor e no diff, entao uma edicao
 * que a apagasse por acidente nao apareceria em review nenhum.
 */
function normalizar(valor: string): string {
  return valor
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * A subcategoria escolhida pertence a categoria escolhida?
 *
 * O banco ja garante isso pela FK composta da 036 -- o que esta funcao evita e
 * o 23503 CHEGAR na tela. O caso real nao e ataque, e sequencia de cliques:
 * a pessoa escolhe Alimentação, escolhe "Mercado", muda para Transporte e
 * salva. O `subcategoryId` ficou no estado apontando para a categoria antiga.
 *
 * Devolve a subcategoria que deve ser GRAVADA: a mesma, se ainda servir, ou a
 * padrao da categoria nova. Nunca `null` por preguica -- cair para "sem
 * subcategoria" num formulario que mostrava "Mercado" seria perder o dado sem
 * avisar.
 */
export function subcategoriaCoerente(
  subcategorias: Subcategoria[],
  categoriaId: string,
  subcategoriaId: string
): string {
  if (!categoriaId) return "";
  const serve = subcategorias.some(
    (s) => s.id === subcategoriaId && s.category_id === categoriaId
  );
  if (serve) return subcategoriaId;
  return subcategoriaPadrao(subcategorias, categoriaId);
}
