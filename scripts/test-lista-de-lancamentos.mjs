// Testes de lib/lista-de-lancamentos.ts -- a paginacao da lista de lancamentos
// e a frase que ela diz sobre si mesma (HMO-118).
//
// O DEFEITO QUE DA NOME A SUITE: a lista trazia 50 linhas com `.limit(50)`, sem
// periodo e sem paginacao, e apresentava o que trouxe como se fosse tudo. O
// lancamento 51 nao existia para o usuario, e os cartoes do topo somavam essas
// 50 linhas debaixo do rotulo "o resumo do mes".
//
// Por que a FRASE entra em teste: o defeito nao era um numero errado, era um
// numero certo com o rotulo errado. Isso nao quebra assercao numerica nenhuma,
// nao lanca excecao e nao deixa a tela vazia. A unica forma de ele virar
// regressao detectavel e a frase ser codigo, e a assercao negar explicitamente
// o texto enganoso -- ver o teste "lista cortada nunca apresenta o carregado
// como total do periodo".

import test from "node:test";
import assert from "node:assert/strict";

import {
  TAMANHO_DA_PAGINA,
  descreverLista,
  faixaDaPagina,
  notaDoTotal,
  temMaisParaCarregar,
} from "../.tmp-lista-lancamentos/lista-de-lancamentos.js";

const PERIODO = "setembro de 2026";

// -----------------------------------------------------------------------------
// faixaDaPagina -- o `.range()` do PostgREST e inclusivo nos dois extremos
// -----------------------------------------------------------------------------

test("a primeira pagina pede exatamente TAMANHO_DA_PAGINA linhas", () => {
  const { de, ate } = faixaDaPagina(0);

  assert.equal(de, 0);
  // O controle que pega o off-by-one: `range(0, 50)` traz 51 linhas.
  assert.equal(ate - de + 1, TAMANHO_DA_PAGINA);
  assert.equal(ate, TAMANHO_DA_PAGINA - 1);
});

test("as paginas se encostam sem pular nem repetir linha", () => {
  const primeira = faixaDaPagina(0, 10);
  const segunda = faixaDaPagina(1, 10);

  assert.equal(primeira.ate, 9);
  // Repetir seria mostrar a mesma despesa duas vezes na lista -- que e
  // indistinguivel de uma despesa lancada duas vezes.
  assert.equal(segunda.de, primeira.ate + 1);
  assert.equal(segunda.ate, 19);
});

test("a terceira pagina de 50 comeca na linha 100", () => {
  assert.deepEqual(faixaDaPagina(2), { de: 100, ate: 149 });
});

// -----------------------------------------------------------------------------
// temMaisParaCarregar
// -----------------------------------------------------------------------------

test("pagina cheia admite que pode haver mais", () => {
  assert.equal(temMaisParaCarregar(TAMANHO_DA_PAGINA), true);
});

test("pagina incompleta e o fim da lista", () => {
  assert.equal(temMaisParaCarregar(TAMANHO_DA_PAGINA - 1), false);
  assert.equal(temMaisParaCarregar(1), false);
});

test("periodo sem lancamento nenhum nao oferece carregar mais", () => {
  // Sem o teste de `recebidos > 0`, um `0 >= 0` ofereceria "Carregar mais" num
  // mes vazio -- o botao que clica e nao acontece nada.
  assert.equal(temMaisParaCarregar(0), false);
  assert.equal(temMaisParaCarregar(0, 0), false);
});

// -----------------------------------------------------------------------------
// descreverLista -- regra 1: o periodo e sempre nomeado
// -----------------------------------------------------------------------------

test("toda frase da lista nomeia o periodo", () => {
  const casos = [
    { filtro: "todos", visiveis: 0, carregados: 0, temMais: false },
    { filtro: "todos", visiveis: 12, carregados: 12, temMais: false },
    { filtro: "todos", visiveis: 50, carregados: 50, temMais: true },
    { filtro: "expense", visiveis: 0, carregados: 12, temMais: false },
    { filtro: "expense", visiveis: 4, carregados: 12, temMais: false },
    { filtro: "expense", visiveis: 4, carregados: 50, temMais: true },
    { filtro: "expense", visiveis: 0, carregados: 50, temMais: true },
    { filtro: "income", visiveis: 3, carregados: 12, temMais: false },
    { filtro: "transfer", visiveis: 2, carregados: 12, temMais: false },
  ];

  for (const caso of casos) {
    const d = descreverLista({ rotuloDoPeriodo: PERIODO, ...caso });
    assert.ok(
      d.descricao.includes(PERIODO),
      `frase sem periodo para ${JSON.stringify(caso)}: ${d.descricao}`
    );
  }
});

// -----------------------------------------------------------------------------
// regra 2: um zero diz zero DE QUE
// -----------------------------------------------------------------------------

test("periodo vazio diz de que periodo o zero e", () => {
  const d = descreverLista({
    rotuloDoPeriodo: "agosto de 2026",
    filtro: "todos",
    visiveis: 0,
    carregados: 0,
    temMais: false,
  });

  assert.equal(d.descricao, "Nenhum lançamento em agosto de 2026");
  assert.equal(d.cortada, false);
});

test("zero do TIPO e diferente de zero do periodo", () => {
  const semDespesa = descreverLista({
    rotuloDoPeriodo: PERIODO,
    filtro: "expense",
    visiveis: 0,
    carregados: 12,
    temMais: false,
  });
  const semNada = descreverLista({
    rotuloDoPeriodo: PERIODO,
    filtro: "expense",
    visiveis: 0,
    carregados: 0,
    temMais: false,
  });

  // A distincao importa porque "Nenhuma despesa" parece lista quebrada numa
  // tela que acabou de listar doze linhas.
  assert.equal(
    semDespesa.descricao,
    "Nenhum lançamento deste tipo em setembro de 2026"
  );
  assert.equal(semNada.descricao, "Nenhum lançamento em setembro de 2026");
  assert.notEqual(semDespesa.descricao, semNada.descricao);
});

test("lista vazia nunca diz que ha mais, nem se temMais chegar verdadeiro", () => {
  // Contradicao na mesma frase: "Nenhum lançamento ... e ha mais".
  const d = descreverLista({
    rotuloDoPeriodo: PERIODO,
    filtro: "todos",
    visiveis: 0,
    carregados: 0,
    temMais: true,
  });

  assert.equal(d.cortada, false);
  assert.ok(!d.descricao.includes("há mais"), d.descricao);
});

// -----------------------------------------------------------------------------
// regra 3: lista cortada nao apresenta o carregado como total do periodo
// -----------------------------------------------------------------------------

test("lista cortada nunca apresenta o carregado como total do periodo", () => {
  // Era exatamente isto que a tela dizia: "Mostrando 4 de 50 lançamentos", com
  // mais trinta no banco. Nenhuma palavra errada, e quem le entende que o
  // periodo tem 50.
  const cortada = descreverLista({
    rotuloDoPeriodo: PERIODO,
    filtro: "expense",
    visiveis: 4,
    carregados: 50,
    temMais: true,
  });

  assert.equal(cortada.cortada, true);
  assert.ok(cortada.descricao.includes("há mais"), cortada.descricao);
  assert.ok(cortada.descricao.includes("carregados"), cortada.descricao);
  // A NEGACAO explicita: a frase antiga, palavra por palavra, nao pode voltar.
  assert.ok(
    !/\bde 50 lançamentos em /.test(cortada.descricao),
    `apresenta 50 como o total do periodo: ${cortada.descricao}`
  );
});

test("lista completa afirma o total do periodo, sem ressalva", () => {
  const completa = descreverLista({
    rotuloDoPeriodo: PERIODO,
    filtro: "expense",
    visiveis: 4,
    carregados: 12,
    temMais: false,
  });

  assert.equal(completa.cortada, false);
  assert.equal(completa.descricao, "4 de 12 lançamentos em setembro de 2026");
  // O controle negativo do teste acima: aqui a ressalva NAO pode aparecer,
  // senao a suite passaria verde com uma funcao que sempre a escreve.
  assert.ok(!completa.descricao.includes("há mais"), completa.descricao);
  assert.ok(!completa.descricao.includes("carregados"), completa.descricao);
});

test("as duas frases do mesmo par de numeros sao diferentes", () => {
  // O par (visiveis, carregados) e o mesmo; so `temMais` muda. Uma funcao que
  // ignorasse `temMais` passaria em todos os testes acima que olham uma frase
  // de cada vez.
  const base = {
    rotuloDoPeriodo: PERIODO,
    filtro: "todos",
    visiveis: 50,
    carregados: 50,
  };

  const cortada = descreverLista({ ...base, temMais: true });
  const completa = descreverLista({ ...base, temMais: false });

  assert.notEqual(cortada.descricao, completa.descricao);
  assert.equal(cortada.cortada, true);
  assert.equal(completa.cortada, false);
});

// -----------------------------------------------------------------------------
// notaDoTotal -- a linha debaixo dos cartoes de Receitas / Despesas / Saldo
// -----------------------------------------------------------------------------

test("o total nomeia o periodo que somou, e nunca 'Este mes'", () => {
  // A string literal que estava no JSX. Ela e falsa para todo periodo que nao
  // e o mes corrente, e era falsa ate para ele -- os cartoes somavam as 50
  // linhas mais recentes de toda a historia.
  const agosto = notaDoTotal({
    rotuloDoPeriodo: "agosto de 2026",
    temMais: false,
  });

  assert.equal(agosto, "agosto de 2026");
  assert.ok(!agosto.includes("Este mês"), agosto);
});

test("soma parcial se declara parcial", () => {
  const parcial = notaDoTotal({ rotuloDoPeriodo: PERIODO, temMais: true });
  const inteira = notaDoTotal({ rotuloDoPeriodo: PERIODO, temMais: false });

  // Um total parcial debaixo do nome de um mes inteiro erra PARA MENOS e parece
  // certo -- e o resultado mais dificil de desconfiar.
  assert.ok(parcial.includes("parcial"), parcial);
  assert.ok(parcial.startsWith(PERIODO), parcial);
  // O controle negativo: sem ele, uma funcao que escrevesse "parcial" sempre
  // passaria na assercao de cima.
  assert.ok(!inteira.includes("parcial"), inteira);
  assert.notEqual(parcial, inteira);
});

// -----------------------------------------------------------------------------
// o titulo
// -----------------------------------------------------------------------------

test("o titulo e o rotulo do filtro escolhido", () => {
  const rotulos = {
    todos: "Lançamentos",
    income: "Receitas",
    expense: "Despesas",
    transfer: "Transferências",
  };

  for (const [filtro, rotulo] of Object.entries(rotulos)) {
    const d = descreverLista({
      rotuloDoPeriodo: PERIODO,
      filtro,
      visiveis: 1,
      carregados: 1,
      temMais: false,
    });
    assert.equal(d.titulo, rotulo);
  }
});

test("lancamento no singular", () => {
  const d = descreverLista({
    rotuloDoPeriodo: PERIODO,
    filtro: "todos",
    visiveis: 1,
    carregados: 1,
    temMais: false,
  });

  assert.ok(d.descricao.startsWith("1 lançamento em "), d.descricao);
  assert.ok(!d.descricao.includes("1 lançamentos"), d.descricao);
});
