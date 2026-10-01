// Testes de lib/categorias.ts -- HMO-216.
//
// O que este arquivo guarda nao e aritmetica: e a diferenca entre o que esta
// GRAVADO (a linha do catalogo, que e de todos) e o que a pessoa VE (a linha
// depois da personalizacao dela). Cada vez que essas duas coisas se
// confundem, o sintoma e silencioso -- a tela mostra o nome de outra pessoa,
// ou mostra nada, e nada estoura.
//
// A ordem tambem esta aqui, e nao e capricho: o seletor de categoria deste app
// tem 13 itens no dia zero e cresce, e onde "Outros" e a categoria nova caem
// decide se a pessoa acha o que criou.

import test from "node:test";
import assert from "node:assert/strict";

const {
  SUBCATEGORIA_PADRAO,
  MAX_NOME_DE_CATEGORIA,
  categoriaEfetiva,
  categoriasDoSeletor,
  subcategoriasDaCategoria,
  subcategoriaPadrao,
  subcategoriaCoerente,
  validarNomeDeCategoria,
  mensagemDeErroDeNome,
} = await import("../.tmp-categorias/categorias.js");

const DONA = "11111111-1111-1111-1111-111111111111";

// Uma do catalogo e uma da pessoa, para que todo teste de ordem/visibilidade
// tenha os dois lados.
const catalogo = (id, name, is_expense = true, extra = {}) => ({
  id,
  name,
  is_expense,
  user_id: null,
  icon: "tag",
  color_hex: "#111111",
  is_active: true,
  ...extra,
});
const minha = (id, name, is_expense = true, extra = {}) => ({
  id,
  name,
  is_expense,
  user_id: DONA,
  icon: "star",
  color_hex: "#222222",
  is_active: true,
  ...extra,
});
const sub = (id, category_id, name, extra = {}) => ({
  id,
  category_id,
  name,
  user_id: null,
  is_active: true,
  ...extra,
});

// =====================================================
// categoriaEfetiva
// =====================================================

test("sem preferencia, o que a pessoa ve e a linha do catalogo", () => {
  const efetiva = categoriaEfetiva(catalogo("c1", "Lazer"));
  assert.equal(efetiva.name, "Lazer");
  assert.equal(efetiva.doCatalogo, true);
  assert.equal(efetiva.personalizada, false);
});

test("preferencia que muda SO a cor nao apaga o nome", () => {
  // Este e o teste que separa "COALESCE campo por campo" de "se tem pref, usa
  // a pref". A segunda forma deixaria `name` undefined e o item do seletor
  // sairia sem texto -- escolhivel sem ser legivel.
  const efetiva = categoriaEfetiva(catalogo("c1", "Lazer"), {
    category_id: "c1",
    color_hex: "#ABCDEF",
  });
  assert.equal(efetiva.name, "Lazer");
  assert.equal(efetiva.color_hex, "#ABCDEF");
  assert.equal(efetiva.personalizada, true);
});

test("preferencia com nome em branco cai para o nome do catalogo", () => {
  // O CHECK da 036 proibe '' na coluna, mas a string pode chegar aqui de um
  // `?? ""` de qualquer camada -- inclusive da fila offline.
  const efetiva = categoriaEfetiva(catalogo("c1", "Lazer"), {
    category_id: "c1",
    name: "   ",
  });
  assert.equal(efetiva.name, "Lazer");
});

test("categoria da pessoa nao e do catalogo", () => {
  assert.equal(categoriaEfetiva(minha("c9", "Terapia")).doCatalogo, false);
});

// =====================================================
// categoriasDoSeletor
// =====================================================

test("a tela de despesa nao lista categoria de receita", () => {
  const lista = categoriasDoSeletor(
    [catalogo("c1", "Mercado", true), catalogo("c2", "Salário", false)],
    [],
    "expense"
  );
  assert.deepEqual(lista.map((c) => c.name), ["Mercado"]);
});

test("as categorias DA PESSOA vem antes das do catalogo", () => {
  // Alfabeticamente "Zelo" viria depois de tudo. Quem criou a categoria criou
  // porque vai usar: enterra-la no fim de uma lista que ela nao escolheu e o
  // mesmo que nao ter criado.
  const lista = categoriasDoSeletor(
    [catalogo("c1", "Alimentação"), catalogo("c2", "Moradia"), minha("c9", "Zelo")],
    [],
    "expense"
  );
  assert.deepEqual(lista.map((c) => c.name), ["Zelo", "Alimentação", "Moradia"]);
});

test("a ordem usa o nome PERSONALIZADO, nao o do catalogo", () => {
  // "Lazer" renomeado para "Rolê" tem de aparecer onde "Rolê" aparece. Ordenar
  // pelo nome gravado deixaria a lista fora de ordem na tela, que e o tipo de
  // coisa que se le como bug de carregamento.
  const lista = categoriasDoSeletor(
    [catalogo("c1", "Alimentação"), catalogo("c2", "Lazer"), catalogo("c3", "Saúde")],
    [{ category_id: "c2", name: "Rolê" }],
    "expense"
  );
  assert.deepEqual(lista.map((c) => c.name), ["Alimentação", "Rolê", "Saúde"]);
});

test("categoria escondida pela pessoa sai do seletor", () => {
  const lista = categoriasDoSeletor(
    [catalogo("c1", "Alimentação"), catalogo("c2", "Lazer")],
    [{ category_id: "c2", is_hidden: true }],
    "expense"
  );
  assert.deepEqual(lista.map((c) => c.name), ["Alimentação"]);
});

test("esconder NAO e o mesmo que personalizar -- quem so renomeou continua na lista", () => {
  // Controle do teste acima: se `is_hidden` fosse lido como "tem pref", quem
  // renomeou uma categoria a perderia do seletor.
  const lista = categoriasDoSeletor(
    [catalogo("c1", "Lazer")],
    [{ category_id: "c1", name: "Rolê", is_hidden: false }],
    "expense"
  );
  assert.deepEqual(lista.map((c) => c.name), ["Rolê"]);
});

test("categoria desativada sai do seletor, e a sem is_active fica", () => {
  // `is_active` ausente acontece de verdade: a copia offline do catalogo e um
  // `select` antigo que nao trazia a coluna. Tratar undefined como "desativada"
  // esvaziaria o seletor inteiro no modo offline.
  const lista = categoriasDoSeletor(
    [
      catalogo("c1", "Alimentação", true, { is_active: false }),
      catalogo("c2", "Moradia", true, { is_active: undefined }),
    ],
    [],
    "expense"
  );
  assert.deepEqual(lista.map((c) => c.name), ["Moradia"]);
});

// =====================================================
// subcategoriasDaCategoria / subcategoriaPadrao
// =====================================================

test("so as subcategorias daquela categoria, e 'Outros' por ultimo", () => {
  const lista = subcategoriasDaCategoria(
    [
      sub("s1", "c1", "Restaurante"),
      sub("s2", "c1", SUBCATEGORIA_PADRAO),
      sub("s3", "c1", "Mercado"),
      sub("s4", "c2", "Uber"),
    ],
    "c1"
  );
  assert.deepEqual(lista.map((s) => s.name), ["Mercado", "Restaurante", "Outros"]);
});

test("'Outros' vem pre-selecionado", () => {
  const escolha = subcategoriaPadrao(
    [sub("s1", "c1", "Mercado"), sub("s2", "c1", SUBCATEGORIA_PADRAO)],
    "c1"
  );
  assert.equal(escolha, "s2");
});

test("categoria sem subcategoria nenhuma devolve vazio em vez de estourar", () => {
  // O intervalo real entre deploy e colagem da 036: o codigo sobe antes do
  // schema, e as 13 categorias de producao ficam sem "Outros" ate alguem colar
  // a migration. A tela precisa abrir nesse intervalo.
  assert.equal(subcategoriaPadrao([], "c1"), "");
});

test("sem 'Outros' mas com outras, a primeira da lista e a escolhida", () => {
  const escolha = subcategoriaPadrao(
    [sub("s1", "c1", "Restaurante"), sub("s2", "c1", "Mercado")],
    "c1"
  );
  assert.equal(escolha, "s2", "a primeira em ordem alfabetica, nao a primeira do array");
});

test("subcategoria desativada nao e escolhida nem listada", () => {
  const dados = [
    sub("s1", "c1", SUBCATEGORIA_PADRAO, { is_active: false }),
    sub("s2", "c1", "Mercado"),
  ];
  assert.deepEqual(subcategoriasDaCategoria(dados, "c1").map((s) => s.id), ["s2"]);
  assert.equal(subcategoriaPadrao(dados, "c1"), "s2");
});

// =====================================================
// subcategoriaCoerente -- o caso da sequencia de cliques
// =====================================================

test("trocar de categoria troca a subcategoria para a 'Outros' da nova", () => {
  // A sequencia: escolhe Alimentação, escolhe "Mercado", muda para Transporte,
  // salva. Sem esta funcao o POST levaria uma subcategoria de OUTRA categoria
  // e o banco responderia 23503 -- que chega na tela como "erro ao salvar".
  const dados = [
    sub("s1", "c1", "Mercado"),
    sub("s2", "c1", SUBCATEGORIA_PADRAO),
    sub("s3", "c2", SUBCATEGORIA_PADRAO),
  ];
  assert.equal(subcategoriaCoerente(dados, "c2", "s1"), "s3");
});

test("quando a subcategoria ainda serve, ela NAO e trocada", () => {
  // Controle do teste acima: uma funcao que devolvesse sempre a padrao
  // passaria no teste anterior e apagaria a escolha da pessoa em toda edicao.
  const dados = [sub("s1", "c1", "Mercado"), sub("s2", "c1", SUBCATEGORIA_PADRAO)];
  assert.equal(subcategoriaCoerente(dados, "c1", "s1"), "s1");
});

test("sem categoria escolhida nao ha subcategoria", () => {
  assert.equal(subcategoriaCoerente([sub("s1", "c1", "Mercado")], "", "s1"), "");
});

// =====================================================
// validarNomeDeCategoria
// =====================================================

test("nome em branco e recusado antes de sair da tela", () => {
  assert.equal(validarNomeDeCategoria("   ", []), "vazio");
});

test("nome no limite passa, e um caractere acima nao", () => {
  const escopo = [];
  assert.equal(validarNomeDeCategoria("x".repeat(MAX_NOME_DE_CATEGORIA), escopo), null);
  assert.equal(
    validarNomeDeCategoria("x".repeat(MAX_NOME_DE_CATEGORIA + 1), escopo),
    "comprido"
  );
});

test("duplicata ignora caixa, acento e espaco nas pontas", () => {
  // Mais largo que a unique do banco de proposito: quem tem "Pets" e digita
  // " pets " quer a que tem. A unique continua sendo a autoridade; isto so
  // antecipa o caso comum com uma frase que diz o que fazer.
  const escopo = [{ id: "c1", name: "Pets" }, { id: "c2", name: "Saúde" }];
  assert.equal(validarNomeDeCategoria(" pets ", escopo), "duplicado");
  assert.equal(validarNomeDeCategoria("SAUDE", escopo), "duplicado");
  assert.equal(validarNomeDeCategoria("Pet", escopo), null);
});

test("renomear uma categoria para o proprio nome nao e duplicata", () => {
  // Sem o `ignorarId`, abrir a categoria e salvar sem mexer no nome diria
  // "você já tem uma categoria com esse nome" -- sobre ela mesma.
  const escopo = [{ id: "c1", name: "Pets" }];
  assert.equal(validarNomeDeCategoria("Pets", escopo, "c1"), null);
  assert.equal(validarNomeDeCategoria("Pets", escopo, "c2"), "duplicado");
});

test("cada erro tem uma frase propria, e nome valido nao tem frase", () => {
  // Uma mensagem para dois estados e como o usuario acaba repetindo de volta
  // uma informacao errada: "comprido" e "duplicado" pedem acoes diferentes.
  const frases = ["vazio", "comprido", "duplicado"].map(mensagemDeErroDeNome);
  assert.equal(new Set(frases).size, 3);
  for (const f of frases) assert.ok(f && f.length > 0);
  assert.equal(mensagemDeErroDeNome(null), null);
});
