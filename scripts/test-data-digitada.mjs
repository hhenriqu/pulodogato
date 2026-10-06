#!/usr/bin/env node
// =====================================================
// PULODOGATO - a data digitada dd/mm/aaaa (HMO-238)
// =====================================================
// A queixa: "digitar dia mes e ano sem ficar pulando pro ano". O
// `<input type="date">` nativo tem tres segmentos e o navegador decide o salto;
// `scripts/probe-campo-de-data.mjs` varreu as posicoes de clique num campo da
// largura da tela e mediu que digitar 10032026 nao grava a data digitada em
// NENHUMA delas: sai "2026-10-03" (a ordem do aparelho e mm/dd, entao 10 de
// marco virou 3 de outubro, sem erro nenhum), "32026-10-02" (ano corrompido) ou
// "" (oito teclas, nada gravado).
//
// Esta suite cobre a mascara PURA. O que ela prova de mais importante nao e o
// texto bonito na tela, sao os dois contratos que a troca nao pode quebrar:
//
//   1. O valor emitido continua AAAA-MM-DD -- e isto e verificado contra o
//      `validarLancamento` DE VERDADE, nao contra uma copia do regex. Uma copia
//      passaria verde no dia em que o original mudasse, que e o unico dia em que
//      este teste precisa falhar.
//   2. Data incompleta emite VAZIO. "10/1" nao pode virar 2026-01-10: um dia que
//      ninguem digitou entrando no banco e pior que uma recusa, porque ninguem
//      vai olhar.
//
// O que ela NAO cobre: o navegador. Caret, selecao e ordem de evento vivem na
// sonda, que roda o Chromium de verdade chamando as MESMAS funcoes deste modulo.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  DIGITOS_DA_DATA,
  aoDigitarData,
  aplicarMascaraNoCampo,
  dataExiste,
  dataParaExibicao,
  exibicaoDoCampo,
} from "../.tmp-data-digitada/lib/data-digitada.js";
import {
  valoresIniciais,
  validarLancamento,
} from "../.tmp-data-digitada/lib/lancamento.js";

/** O que a pessoa digita, tecla por tecla, num campo que comeca em `partida`. */
function digitar(teclas, partida = "") {
  let exibicao = partida;
  let valor = "";
  for (const tecla of teclas) {
    // O input recebe a tecla no FIM, que e onde a mascara deixa o caret.
    const entrada = aoDigitarData(exibicao + tecla, exibicao);
    exibicao = entrada.exibicao;
    valor = entrada.valor;
  }
  return { exibicao, valor };
}

// ---------------------------------------------------------------------------
// O CASO PRINCIPAL DA ISSUE
// ---------------------------------------------------------------------------

test("8 digitos corridos no campo vazio dao a data digitada", () => {
  const r = digitar("10032026");
  assert.equal(r.exibicao, "10/03/2026");
  assert.equal(r.valor, "2026-03-10");
});

test("digitar sobre um campo preenchido com hoje nao mistura as duas datas", () => {
  // O CASO QUE O CAMPO NATIVO ERRAVA. Com "02/10/2026" na tela, a tecla cai
  // entre os digitos de hoje; sem a regra de redigitacao o resultado era
  // "02/10/1202" -- uma data que ninguem digitou, no formato certo, que a
  // validacao aprova. Veja o teste de controle logo abaixo.
  const r = digitar("10032026", "02/10/2026");
  assert.equal(r.exibicao, "10/03/2026");
  assert.equal(r.valor, "2026-03-10");
  // E a prova explicita de que a data velha nao sobrou em pedaco nenhum: o ano
  // de hoje nao esta na saida, e nem o 1202 que a mistura produzia.
  assert.ok(!r.exibicao.includes("1202"));
});

test("sem a exibicao anterior a mascara NAO sabe que e redigitacao", () => {
  // CONTROLE NEGATIVO DO TESTE ACIMA. Se `aoDigitarData` passasse a ignorar o
  // segundo argumento, o caso de cima continuaria verde por acidente -- o
  // resultado "10/03/2026" tambem sai de um campo que comeca vazio. Este caso
  // afirma a diferenca: digitar no fim de uma data completa, SEM contexto,
  // empilha e perde o que foi digitado.
  let exibicao = "02/10/2026";
  for (const tecla of "10032026") {
    exibicao = aoDigitarData(exibicao + tecla).exibicao;
  }
  assert.equal(exibicao, "02/10/2026", "8 digitos ignorados pelo teto");
  assert.notEqual(exibicao, "10/03/2026");
});

test("a primeira tecla no MEIO do campo tambem comeca uma data nova", () => {
  // O caso literal da queixa: o campo e largo, o texto ocupa a esquerda, e no
  // celular o dedo cai no meio. A tecla entra entre os digitos de hoje --
  // "02/10" + "1" + "/2026" -- e e dai que a mistura nascia. A mascara nao
  // precisa saber onde estava o caret: ela acha o digito inserido comparando com
  // o que estava na tela.
  const r = aoDigitarData("02/101/2026", "02/10/2026");
  assert.equal(r.exibicao, "1");
  assert.equal(r.valor, "");

  // E dai em diante o caret ja esta no fim, entao a digitacao segue corrida.
  assert.equal(digitar("0032026", "1").valor, "2026-03-10");
});

test("uma data colada em cima de outra substitui a antiga", () => {
  // Colar nao chega tecla por tecla: o texto inteiro aparece de uma vez.
  const r = aoDigitarData("02/10/202610/03/2026", "02/10/2026");
  assert.equal(r.valor, "2026-03-10");
});

// ---------------------------------------------------------------------------
// A EXIBICAO ENQUANTO A PESSOA DIGITA
// ---------------------------------------------------------------------------

test("a pontuacao aparece sozinha, e nunca sobra barra no fim", () => {
  // Barra no fim ("10/") daria a esta mascara um ponto fixo no backspace: a
  // tecla apaga a barra, a mascara a devolve, e o campo fica impossivel de
  // limpar -- o defeito que a mascara de dinheiro teve.
  assert.equal(aoDigitarData("1").exibicao, "1");
  assert.equal(aoDigitarData("10").exibicao, "10");
  assert.equal(aoDigitarData("100").exibicao, "10/0");
  assert.equal(aoDigitarData("1003").exibicao, "10/03");
  assert.equal(aoDigitarData("10032").exibicao, "10/03/2");
  assert.equal(aoDigitarData("10032026").exibicao, "10/03/2026");
});

test("o backspace esvazia o campo, sem ponto fixo", () => {
  let exibicao = "10/03/2026";
  const vistos = [exibicao];

  for (let i = 0; i < 20 && exibicao !== ""; i++) {
    // Backspace apaga o ultimo CARACTERE, barra incluida.
    const entrada = aoDigitarData(exibicao.slice(0, -1), exibicao);
    assert.notEqual(
      entrada.exibicao,
      exibicao,
      `o campo parou de encolher em ${JSON.stringify(exibicao)}`
    );
    exibicao = entrada.exibicao;
    vistos.push(exibicao);
  }

  assert.equal(exibicao, "");
  // 10 caracteres na tela, 8 digitos: as duas barras saem junto com o digito
  // anterior a elas, entao sao 8 teclas e nao 10.
  assert.equal(vistos.length, DIGITOS_DA_DATA + 1);
});

test("o que nao e digito e descartado", () => {
  assert.equal(aoDigitarData("abc10xx03//2026!").valor, "2026-03-10");
  assert.equal(aoDigitarData("10-03-2026").valor, "2026-03-10");
  assert.equal(aoDigitarData("").exibicao, "");
  assert.equal(aoDigitarData("").valor, "");
});

// ---------------------------------------------------------------------------
// CONTRATO 2: DATA INCOMPLETA EMITE VAZIO
// ---------------------------------------------------------------------------

test("data pela metade emite vazio, nunca data parcial", () => {
  for (const parcial of ["1", "10", "100", "1003", "10032", "100320", "1003202"]) {
    const r = aoDigitarData(parcial);
    assert.equal(r.valor, "", `${parcial} nao pode emitir data`);
    // E a pessoa continua vendo o que digitou -- se a exibicao sumisse, o campo
    // apagaria a propria digitacao a cada tecla.
    assert.ok(r.exibicao.length > 0);
  }
});

test('"10/1" emite vazio e o formulario recusa com "Informe a data."', () => {
  // O criterio da issue, ponta a ponta: a mascara se cala e quem fala e a
  // validacao de verdade.
  const r = aoDigitarData("101");
  assert.equal(r.exibicao, "10/1");
  assert.equal(r.valor, "");

  const validacao = validarLancamento(
    "expense",
    { ...valoresIniciais(), descricao: "Compra", valor: "100", categoriaId: "c1", data: r.valor },
    { categoria: { id: "c1", name: "Mercado", is_expense: true }, editando: false }
  );
  assert.equal(validacao.ok, false);
  assert.equal(validacao.mensagem, "Informe a data.");
});

// ---------------------------------------------------------------------------
// O CALENDARIO: DATA QUE NAO EXISTE NAO PODE SER EMITIDA
// ---------------------------------------------------------------------------

test("dia que o mes nao tem emite vazio", () => {
  // Sem esta porta a mascara emitiria "2026-02-31": oito digitos, formato certo,
  // regex aprovando, e o Postgres recusando com 22007 na hora de gravar -- que a
  // tela mostra como "erro ao salvar", sem dizer qual campo esta errado.
  assert.equal(aoDigitarData("31022026").valor, "");
  assert.equal(aoDigitarData("31042026").valor, "");
  assert.equal(aoDigitarData("32102026").valor, "");
  assert.equal(aoDigitarData("00102026").valor, "");
  // E a exibicao fica, para a pessoa poder consertar o que ela digitou.
  assert.equal(aoDigitarData("31022026").exibicao, "31/02/2026");
});

test("mes fora de 1..12 emite vazio", () => {
  assert.equal(aoDigitarData("10002026").valor, "");
  assert.equal(aoDigitarData("10132026").valor, "");
  assert.equal(aoDigitarData("10992026").valor, "");
});

test("ano zero emite vazio", () => {
  // `'0000-01-01'::date` e fora de faixa no Postgres. E um ano a meio caminho
  // ("0002" indo para 2026) nao pode virar uma gravacao.
  assert.equal(aoDigitarData("10030000").valor, "");
  assert.equal(aoDigitarData("10030001").valor, "0001-03-10");
});

test("bissexto pela regra cheia", () => {
  assert.equal(aoDigitarData("29022024").valor, "2024-02-29");
  assert.equal(aoDigitarData("29022026").valor, "");
  // 2000 e bissexto (divisivel por 400), 1900 nao e (divisivel por 100). Um
  // `ano % 4 === 0` sozinho acerta 2024 e erra 1900.
  assert.equal(aoDigitarData("29022000").valor, "2000-02-29");
  assert.equal(aoDigitarData("29021900").valor, "");
});

test("os 31 dias de cada mes, e nenhum a mais", () => {
  const trinta = [4, 6, 9, 11];
  for (let mes = 1; mes <= 12; mes++) {
    const esperado = mes === 2 ? 28 : trinta.includes(mes) ? 30 : 31;
    assert.equal(dataExiste(esperado, mes, 2026), true, `${esperado}/${mes}`);
    assert.equal(dataExiste(esperado + 1, mes, 2026), false, `${esperado + 1}/${mes}`);
  }
});

// ---------------------------------------------------------------------------
// CONTRATO 1: O VALOR EMITIDO E AAAA-MM-DD, CONFERIDO PELO VALIDADOR DE VERDADE
// ---------------------------------------------------------------------------

test("toda data emitida passa pelo validarLancamento do app", () => {
  const casos = ["10032026", "01012026", "29022024", "31122099", "10030001"];
  let aceitas = 0;

  for (const teclas of casos) {
    const { valor } = aoDigitarData(teclas);
    assert.notEqual(valor, "", `${teclas} deveria ser data valida`);

    const validacao = validarLancamento(
      "expense",
      {
        ...valoresIniciais(),
        descricao: "Compra",
        valor: "100",
        categoriaId: "c1",
        data: valor,
      },
      { categoria: { id: "c1", name: "Mercado", is_expense: true }, editando: false }
    );

    assert.equal(validacao.ok, true, `${valor} recusado: ${validacao.mensagem}`);
    aceitas++;
  }

  // Sem este contador o laco inteiro poderia nao ter rodado e o teste passaria
  // vacuo -- a armadilha de afirmar dentro de um laco sobre uma lista.
  assert.equal(aceitas, casos.length);
});

test("a exibicao mascarada NUNCA e o valor emitido", () => {
  // O erro simetrico ao de dinheiro, onde "1.000,00" virava 1 no parseFloat:
  // aqui "10/03/2026" chegando no PostgREST e 22007, traduzido na tela para um
  // "erro ao salvar" sem campo.
  const { exibicao, valor } = aoDigitarData("10032026");
  assert.notEqual(exibicao, valor);
  assert.match(valor, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!valor.includes("/"));
});

// ---------------------------------------------------------------------------
// A VOLTA: UMA DATA QUE JA EXISTE
// ---------------------------------------------------------------------------

test("data do banco aparece em dd/mm/aaaa", () => {
  assert.equal(dataParaExibicao("2026-03-10"), "10/03/2026");
  assert.equal(dataParaExibicao("2026-10-02"), "02/10/2026");
});

test("ida e volta nao perde nem inventa nada", () => {
  for (const iso of ["2026-03-10", "2024-02-29", "2026-12-31", "2026-01-01"]) {
    const texto = dataParaExibicao(iso);
    assert.equal(aoDigitarData(texto.replace(/\D/g, "")).valor, iso);
  }
});

test("valor que o campo nao emitiria nao e exibido", () => {
  // Inclui o "32026-10-02" que o controle nativo produzia: o campo mostra vazio
  // em vez de mostrar uma data que ele seria incapaz de gerar.
  assert.equal(dataParaExibicao("32026-10-02"), "");
  assert.equal(dataParaExibicao("2026-02-31"), "");
  assert.equal(dataParaExibicao("10/03/2026"), "");
  assert.equal(dataParaExibicao(""), "");
  assert.equal(dataParaExibicao(null), "");
  assert.equal(dataParaExibicao(undefined), "");
});

// ---------------------------------------------------------------------------
// O RASCUNHO FICA SUBORDINADO AO VALOR
// ---------------------------------------------------------------------------

test("o rascunho vale enquanto o pai concordar com ele", () => {
  const rascunho = { texto: "10/03", valor: "" };
  // Data pela metade: o valor do pai e "" e o rascunho e o unico que sabe o que
  // esta na tela. Sem ele, o campo apagaria a digitacao.
  assert.equal(exibicaoDoCampo(rascunho, ""), "10/03");
});

test("valor mudado POR FORA vence o rascunho", () => {
  // O bug que `CampoDeValor` evita nao guardando estado: a edicao carrega o
  // lancamento do banco, ou a tela copia a data prevista da data real, e o campo
  // continuaria mostrando o texto antigo com o valor novo por baixo.
  const rascunho = { texto: "10/03", valor: "" };
  assert.equal(exibicaoDoCampo(rascunho, "2026-10-02"), "02/10/2026");
});

test("sem rascunho a exibicao sai do valor", () => {
  assert.equal(exibicaoDoCampo(null, "2026-10-02"), "02/10/2026");
  assert.equal(exibicaoDoCampo(null, ""), "");
});

// ---------------------------------------------------------------------------
// O QUE A MASCARA FAZ COM O CAMPO (a funcao que a sonda tambem chama)
// ---------------------------------------------------------------------------

test("a mascara reescreve o campo e poe o caret no fim", () => {
  // Sem o caret no fim, a barra recem-inserida desloca a tecla seguinte e "1003"
  // vira "10/30". Medido na sonda; aqui fica o contrato.
  const campo = {
    value: "1003",
    inicio: -1,
    fim: -1,
    setSelectionRange(i, f) {
      this.inicio = i;
      this.fim = f;
    },
  };

  const entrada = aplicarMascaraNoCampo(campo, "100");

  assert.equal(campo.value, "10/03");
  assert.equal(entrada.exibicao, "10/03");
  assert.equal(entrada.valor, "");
  assert.equal(campo.inicio, 5);
  assert.equal(campo.fim, 5);
});

test("a mascara no campo respeita a redigitacao", () => {
  // O mesmo caso principal da issue, agora pelo caminho que o componente e a
  // sonda usam.
  const campo = {
    value: "02/10/20261",
    setSelectionRange() {},
  };

  const entrada = aplicarMascaraNoCampo(campo, "02/10/2026");

  assert.equal(campo.value, "1");
  assert.equal(entrada.valor, "");
});
