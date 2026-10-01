#!/usr/bin/env node
// =====================================================
// PULODOGATO - o seletor de categoria e subcategoria (HMO-216)
// =====================================================
// `lib/categorias.ts` ja tem teste proprio (test-categorias.mjs), e ele
// passaria verde com o JSX inteiro errado: as regras estariam certas e o
// componente ignorando elas. O defeito desta feature e de ARVORE --
//
//   * um seletor de subcategoria desenhado antes de haver categoria escolhida
//     (lista vazia que se le como "carregando", e nao vai carregar nunca);
//   * um botao "Criar" sem `type="button"` dentro do <form> do lancamento, que
//     SUBMETE a despesa inteira no lugar de criar a categoria;
//   * o aviso de lista vazia dizendo "abra com internet" numa tela que, agora,
//     deixa criar a primeira categoria ali mesmo.
//
// Entao aqui o `react-dom/server` renderiza os componentes de verdade, dos
// mesmos arquivos que o app importa, e as assercoes falam do HTML que sai.
//
// O QUE ESTE TESTE NAO COBRE, E POR QUE
// -------------------------------------
// O CONTEUDO dos seletores. O Radix renderiza a lista num portal que so existe
// com o seletor ABERTO; no HTML de servidor sai o botao e um `<select>` oculto
// e VAZIO (medido: `html.includes("Alimentação")` e `false` mesmo com a
// categoria na prop). Entao "o item Criar nova categoria esta na lista" nao da
// para afirmar pelo texto renderizado.
//
// A ultima secao cobre essa falta lendo o ARQUIVO e exigindo as marcas que
// sustentam o item -- o mesmo recurso que test-puxar-no-menu-dom.mjs usa para
// ligar a pagina de teste ao componente real. E uma ponte fraca de proposito:
// ela pega a REMOCAO do item, que e a regressao plausivel, e nao promete nada
// sobre ele aparecer bonito na tela.
//
// A INTERACAO (abrir, digitar, clicar em Criar) tambem nao esta aqui: ela
// exigiria navegador com JS, e o que ela provaria -- validacao do nome e
// coerencia da subcategoria -- sao funcoes puras com assercao em
// test-categorias.mjs.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  SeletorDeCategoria,
  CampoDeNome,
} from "../.tmp-seletor-de-categoria/components/movimentacoes/SeletorDeCategoria.js";

const ALIMENTACAO = {
  id: "c1",
  name: "Alimentação",
  is_expense: true,
  user_id: null,
  is_active: true,
};
const OUTROS = {
  id: "s1",
  category_id: "c1",
  name: "Outros",
  user_id: null,
  is_active: true,
};

function renderizar({
  tipo = "expense",
  categorias = [ALIMENTACAO],
  prefs = [],
  subcategorias = [OUTROS],
  categoriaId = "",
  subcategoriaId = "",
  podeCriar = true,
} = {}) {
  return renderToStaticMarkup(
    h(SeletorDeCategoria, {
      tipo,
      categorias,
      prefs,
      subcategorias,
      categoriaId,
      subcategoriaId,
      aoMudar: () => {},
      aoCriarCategoria: podeCriar ? async () => ({ id: "novo" }) : undefined,
      aoCriarSubcategoria: podeCriar ? async () => ({ id: "novo" }) : undefined,
    })
  );
}

// =====================================================
// O segundo seletor so existe depois do primeiro
// =====================================================

test("sem categoria escolhida, NAO ha seletor de subcategoria", () => {
  const html = renderizar({ categoriaId: "" });
  assert.ok(
    !html.includes('for="subcategory"'),
    "o bloco de subcategoria apareceu sem categoria escolhida"
  );
});

test("com categoria escolhida, o seletor de subcategoria aparece", () => {
  // O par da assercao acima. Sem este lado, um componente que NUNCA desenhasse
  // a subcategoria passaria pelo controle negativo -- e a feature inteira
  // estaria fora da tela.
  const html = renderizar({ categoriaId: "c1", subcategoriaId: "s1" });
  assert.ok(html.includes('for="subcategory"'));
  assert.ok(html.includes("Subcategoria"));
});

test("o rotulo da categoria muda entre despesa e receita", () => {
  assert.ok(renderizar({ tipo: "expense" }).includes("Categoria da despesa"));
  assert.ok(renderizar({ tipo: "income" }).includes("Categoria da receita"));
});

// =====================================================
// Os avisos de lista vazia
// =====================================================

test("lista vazia COM criacao manda criar ali mesmo", () => {
  const html = renderizar({ categorias: [], podeCriar: true });
  assert.ok(html.includes("Nenhuma categoria de despesa"));
  assert.ok(
    html.includes("Crie a primeira pela opção acima"),
    "o aviso nao oferece a saida que a tela agora tem"
  );
  assert.ok(
    !html.includes("Abra esta tela uma vez com internet"),
    "o aviso antigo ficou, mandando a pessoa buscar rede que ela ja tem"
  );
});

test("lista vazia SEM criacao (offline) volta a mandar buscar rede", () => {
  // O par do teste acima, e o que mantem o `?` do JSX honesto: sem rede nao da
  // para criar categoria -- o lancamento vai para a fila, mas a categoria que
  // ele referencia precisa de id, e id so o servidor da.
  const html = renderizar({ categorias: [], podeCriar: false });
  assert.ok(html.includes("Abra esta tela uma vez com internet"));
  assert.ok(!html.includes("Crie a primeira pela opção acima"));
});

test("categoria sem subcategoria avisa, em vez de so mostrar vazio", () => {
  // Acontece de verdade entre o deploy e a colagem da 036: o codigo sobe antes
  // do schema, e nenhuma das 13 categorias tem "Outros" ainda.
  const html = renderizar({
    categoriaId: "c1",
    subcategorias: [],
  });
  assert.ok(html.includes("ainda não tem subcategorias"));
});

test("categoria COM subcategoria nao mostra o aviso", () => {
  const html = renderizar({ categoriaId: "c1", subcategorias: [OUTROS] });
  assert.ok(!html.includes("ainda não tem subcategorias"));
});

// =====================================================
// O campo de digitar o nome
// =====================================================

function renderizarCampo({ erro = null, salvando = false } = {}) {
  return renderToStaticMarkup(
    h(CampoDeNome, {
      id: "nova-categoria",
      rotulo: "Nome da nova categoria",
      nome: "Mercado",
      setNome: () => {},
      erro,
      salvando,
      aoSalvar: () => {},
      aoCancelar: () => {},
    })
  );
}

test('os dois botoes do campo sao type="button"', () => {
  // A assercao mais importante deste arquivo. Este campo vive DENTRO do <form>
  // do lancamento, e o default de <button> ali e `submit`: sem `type="button"`,
  // clicar em "Criar" submete a despesa inteira -- com a categoria antiga, ou
  // sem nenhuma. Nao da erro, e a tela navega.
  const html = renderizarCampo();
  const botoes = html.match(/<button[^>]*>/g) ?? [];
  assert.equal(botoes.length, 2, "esperado exatamente Criar e Cancelar");
  for (const botao of botoes) {
    assert.ok(
      botao.includes('type="button"'),
      `botao sem type="button": ${botao}`
    );
  }
});

test("Cancelar existe -- sem ele quem abriu por engano fica preso", () => {
  // O seletor sai da tela enquanto o campo esta aberto, entao nao ha caminho de
  // volta que nao seja este botao.
  assert.ok(renderizarCampo().includes("Cancelar"));
});

test("o teto de 60 caracteres esta no input, nao so no banco", () => {
  // Sem `maxLength` a pessoa digita 80 caracteres, clica em Criar e recebe
  // "o nome tem no máximo 60" depois de ter escrito tudo.
  //
  // A busca ignora a CAIXA do atributo: este `Input` repassa as props para o
  // elemento, e o React imprime `maxLength` (camelCase) no markup em vez do
  // `maxlength` do HTML. Cravar uma das duas grafias faria o teste reprovar
  // numa troca de primitivo que nao muda nada para quem usa a tela.
  const input = renderizarCampo().match(/<input[^>]*>/)?.[0] ?? "";
  assert.match(input, /maxlength="60"/i);
});

test("o erro aparece abaixo do campo, e so quando existe", () => {
  assert.ok(!renderizarCampo({ erro: null }).includes("já tem uma categoria"));
  assert.ok(
    renderizarCampo({ erro: "Você já tem uma categoria com esse nome." })
      .includes("já tem uma categoria")
  );
});

test("salvando desabilita os dois botoes e diz que esta criando", () => {
  const html = renderizarCampo({ salvando: true });
  assert.ok(html.includes("Criando..."));
  assert.equal((html.match(/disabled=""/g) ?? []).length, 2);
});

test("o grid do campo declara grid-cols-1 no celular", () => {
  // `grid` sem coluna declarada estoura a largura da pagina no telefone, e o
  // sintoma e scroll horizontal na tela inteira -- nao neste bloco.
  const html = renderizarCampo();
  assert.ok(html.includes("grid-cols-1"));
  assert.ok(html.includes("sm:grid-cols-"));
});

// =====================================================
// A PONTE com o que o Radix nao deixa renderizar
// =====================================================
// O portal do Radix nao existe no HTML de servidor, entao o item "Criar nova
// categoria" nao da para afirmar pelo texto. Estas duas assercoes leem o
// arquivo e exigem as marcas que o sustentam. Elas pegam a regressao plausivel
// -- alguem removendo o item ao mexer no seletor -- e nao prometem nada sobre a
// aparencia.

test("o arquivo tem o item de criar nos DOIS seletores", () => {
  const fonte = readFileSync(
    "components/movimentacoes/SeletorDeCategoria.tsx",
    "utf8"
  );
  assert.equal(
    (fonte.match(/<SelectItem value=\{CRIAR\}>/g) ?? []).length,
    2,
    "esperado um item de criar no seletor de categoria e um no de subcategoria"
  );
  assert.ok(fonte.includes("Criar nova categoria"));
  assert.ok(fonte.includes("Criar nova subcategoria"));
});

test("o sentinela de criar nao pode ser a string vazia", () => {
  // `""` e o que o Radix usa para "nada escolhido": se o sentinela fosse `""`,
  // abrir a tela sem categoria escolhida abriria o campo de digitar sozinho.
  const fonte = readFileSync(
    "components/movimentacoes/SeletorDeCategoria.tsx",
    "utf8"
  );
  const declaracao = fonte.match(/const CRIAR = "([^"]*)";/);
  assert.ok(declaracao, "a constante CRIAR desapareceu");
  assert.ok(declaracao[1].length > 0);
});
