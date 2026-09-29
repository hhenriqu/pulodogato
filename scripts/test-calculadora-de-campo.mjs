// ---------------------------------------------------------------------------
// A conta da calculadora do campo de valor (HMO-171)
// ---------------------------------------------------------------------------
// Roda sobre o JS compilado de lib/calculadora-de-campo.ts (ver
// `test:calculadora-campo` no package.json). O modulo nao importa nada, entao
// nao ha passo de reescrita do alias `@/` aqui.
//
// O que estes testes tentam pegar, em ordem de quanto dinheiro custam:
//
//   1. o ponto de milhar lido como decimal (erro de 10x, silencioso);
//   2. o centavo perdido no arredondamento de `1,005` (erro de 1 centavo,
//      silencioso, e o que `Math.round(n * 100) / 100` erra);
//   3. o resultado negativo aplicado num campo cuja rota faz `-Math.abs`
//      (troca despesa por receita);
//   4. o resultado que passa dos 15 digitos do campo, onde `aoDigitarValor`
//      ignoraria a tecla extra e exibiria outro numero.
// ---------------------------------------------------------------------------

import test from "node:test";
import assert from "node:assert/strict";

import { calcular, MAX_DIGITOS_PADRAO } from "../.tmp-calculadora-campo/calculadora-de-campo.js";

/** Atalho: o valor aceito, ou o motivo da recusa, para assercao direta. */
function valorDe(expressao, opcoes) {
  const r = calcular(expressao, opcoes);
  return r.ok ? r.valor : `RECUSADO:${r.motivo}`;
}

test("as quatro operacoes, com a precedencia de sempre", () => {
  assert.equal(valorDe("2+3"), "5.00");
  assert.equal(valorDe("10-4"), "6.00");
  assert.equal(valorDe("7*6"), "42.00");
  assert.equal(valorDe("100/4"), "25.00");
  // Multiplicacao antes da soma: "2+3*4" e 14, nao 20.
  assert.equal(valorDe("2+3*4"), "14.00");
  assert.equal(valorDe("(2+3)*4"), "20.00");
  // Parenteses aninhados e subtracao a esquerda (associatividade).
  assert.equal(valorDe("100-((2+3)*4)"), "80.00");
  assert.equal(valorDe("100-10-10"), "80.00");
  assert.equal(valorDe("100/10/2"), "5.00");
});

test("espaco em branco nao muda a conta", () => {
  assert.equal(valorDe("  1.000  +  50,50  "), "1050.50");
  assert.equal(valorDe("\t2\n*\t3 "), "6.00");
});

test("o sinal unario", () => {
  assert.equal(valorDe("10*-2"), "RECUSADO:negativa");
  assert.equal(valorDe("10--2"), "12.00");
  assert.equal(valorDe("-(-30)"), "30.00");
  assert.equal(valorDe("+50"), "50.00");
});

// -------------------------------------------------------------------------
// 1. O ponto de milhar
// -------------------------------------------------------------------------

test("o ponto e milhar, e um milhar invalido e recusado em vez de chutado", () => {
  assert.equal(valorDe("1.000"), "1000.00");
  assert.equal(valorDe("1.234.567"), "1234567.00");
  assert.equal(valorDe("1.000,50"), "1000.50");
  assert.equal(valorDe("999"), "999.00");

  // O CASO QUE CUSTA DINHEIRO: "1.5". Lido como milhar-removido da 15; lido
  // como decimal da 1,5. Chutar qualquer um dos dois erra por 10x, entao a
  // funcao recusa e a tela explica.
  assert.equal(valorDe("1.5"), "RECUSADO:milhar-ambiguo");
  assert.equal(valorDe("12.34"), "RECUSADO:milhar-ambiguo");
  assert.equal(valorDe("1.0000"), "RECUSADO:milhar-ambiguo");
  assert.equal(valorDe("1234.567"), "RECUSADO:milhar-ambiguo");
  // Grupo vazio, e ponto solto.
  assert.equal(valorDe("1..000"), "RECUSADO:milhar-ambiguo");
  assert.equal(valorDe("."), "RECUSADO:milhar-ambiguo");
});

test("a virgula e o decimal, e ha no maximo uma", () => {
  assert.equal(valorDe("0,05"), "0.05");
  assert.equal(valorDe(",5"), "0.50");
  assert.equal(valorDe("1,5+1,5"), "3.00");
  assert.equal(valorDe("1,2,3"), "RECUSADO:sintaxe");
  // Ponto DEPOIS da virgula nao e nada em nenhuma convencao.
  assert.equal(valorDe("1,50.000"), "RECUSADO:sintaxe");
});

// -------------------------------------------------------------------------
// 2. O centavo do arredondamento
// -------------------------------------------------------------------------

test("arredonda meio para cima, inclusive onde o float atrapalha", () => {
  // O caso que `Math.round(n * 100) / 100` erra: 1.005 em binario e
  // 1.00499999999999989..., entao aquela conta da 1.00 -- um centavo a menos,
  // sem erro nenhum. A decisao aqui acontece em decimal.
  assert.equal(valorDe("1,005"), "1.01");
  assert.equal(valorDe("2,675"), "2.68");
  assert.equal(valorDe("8,165"), "8.17");

  // Ruido binario de soma: 0,1 + 0,2 e 0.30000000000000004.
  assert.equal(valorDe("0,1+0,2"), "0.30");

  // Divisao que nao fecha.
  assert.equal(valorDe("100/3"), "33.33");
  assert.equal(valorDe("200/3"), "66.67");
  assert.equal(valorDe("10/8"), "1.25");

  // Para baixo quando o digito extra e menor que 5.
  assert.equal(valorDe("1,004"), "1.00");
  assert.equal(valorDe("1,0049"), "1.00");
});

test("o transporte do arredondamento atravessa os noves", () => {
  // "9,999" -> 999,9|9 -> arredonda para 1000,00: o transporte tem de subir por
  // todas as casas e criar um digito novo na frente.
  assert.equal(valorDe("9,999"), "10.00");
  assert.equal(valorDe("0,999"), "1.00");
  assert.equal(valorDe("99,995"), "100.00");
});

test("as casas sao as da moeda, e iene nao tem centavos", () => {
  assert.equal(valorDe("1000/3", { casas: 0 }), "333");
  assert.equal(valorDe("1500,5", { casas: 0 }), "1501");
  assert.equal(valorDe("1500,4", { casas: 0 }), "1500");
  // Tres casas, para uma moeda que as tenha.
  assert.equal(valorDe("1/3", { casas: 3 }), "0.333");
  assert.equal(valorDe("2/3", { casas: 3 }), "0.667");
});

test("valor menor que uma unidade ganha o zero da frente", () => {
  // Sem o zero, o valor sairia ".05" -- `Number.parseFloat(".05")` ate le, mas o
  // texto quebra a comparacao com o que o campo emite.
  assert.equal(valorDe("0,05"), "0.05");
  assert.equal(valorDe("1/100"), "0.01");
  assert.equal(valorDe("5/1000"), "0.01"); // 0,005 -> meio para cima
});

// -------------------------------------------------------------------------
// 3. O resultado negativo, e o zero
// -------------------------------------------------------------------------

test("resultado negativo e recusado, nao convertido em positivo", () => {
  // As rotas deste app aplicam `-Math.abs` no valor. Entregar -70 a um campo de
  // despesa devolveria +70 do banco: dinheiro entrando numa tela de saida.
  assert.equal(valorDe("30-100"), "RECUSADO:negativa");
  assert.equal(valorDe("-50"), "RECUSADO:negativa");
  assert.equal(valorDe("10*(3-5)"), "RECUSADO:negativa");

  const r = calcular("30-100");
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /negativo/i);
});

test("zero e recusado, porque nenhum campo daqui aceita zero", () => {
  assert.equal(valorDe("5-5"), "RECUSADO:zero");
  assert.equal(valorDe("0"), "RECUSADO:zero");
  assert.equal(valorDe("0*1000"), "RECUSADO:zero");
  // Arredonda PARA zero: meio centavo para baixo ainda e zero em real.
  assert.equal(valorDe("0,004"), "RECUSADO:zero");
  // Negativo que a moeda arredonda para zero e "zero", nao "negativa": recusar
  // por sinal um numero que a moeda considera zero seria uma mensagem confusa.
  assert.equal(valorDe("0-0,004"), "RECUSADO:zero");
});

// -------------------------------------------------------------------------
// 4. O teto de digitos do campo
// -------------------------------------------------------------------------

test("o teto de digitos e o do campo, e o de verdade", () => {
  assert.equal(MAX_DIGITOS_PADRAO, 15);

  // 15 digitos com 2 casas: R$ 9.999.999.999.999,99. Passa.
  assert.equal(valorDe("9999999999999,99"), "9999999999999.99");

  // 16 digitos. `aoDigitarValor` ignoraria a tecla extra, entao o campo
  // mostraria um numero diferente do que a calculadora prometeu.
  assert.equal(valorDe("99999999999999,99"), "RECUSADO:grande-demais");
  assert.equal(valorDe("1000000000000000*10"), "RECUSADO:grande-demais");

  // Acima de 1e21 `toFixed` vira exponencial ("1e+21"): o motivo tem de ser o
  // teto, e nao um numero lido errado a partir da string "1e+21".
  assert.equal(valorDe("99999999999*99999999999999"), "RECUSADO:grande-demais");

  // O teto acompanha a moeda: com 0 casas cabem 15 digitos inteiros.
  assert.equal(valorDe("999999999999999", { casas: 0 }), "999999999999999");
  assert.equal(valorDe("999999999999999", { casas: 2 }), "RECUSADO:grande-demais");

  // Teto menor, por parametro.
  assert.equal(valorDe("1000", { casas: 0, maxDigitos: 4 }), "1000");
  assert.equal(valorDe("10000", { casas: 0, maxDigitos: 4 }), "RECUSADO:grande-demais");
});

// -------------------------------------------------------------------------
// Recusas de forma
// -------------------------------------------------------------------------

test("divisao por zero e recusada onde acontece", () => {
  assert.equal(valorDe("10/0"), "RECUSADO:divisao-por-zero");
  assert.equal(valorDe("10/(5-5)"), "RECUSADO:divisao-por-zero");
  // Barrar so no fim deixaria esta expressao chegar como NaN, cujo motivo
  // ninguem sabe explicar para o usuario.
  assert.equal(valorDe("10/0-10/0"), "RECUSADO:divisao-por-zero");
  assert.equal(valorDe("1+10/0*2"), "RECUSADO:divisao-por-zero");
});

test("expressao incompleta e recusada em vez de meio-avaliada", () => {
  assert.equal(valorDe("2+"), "RECUSADO:sintaxe");
  assert.equal(valorDe("*3"), "RECUSADO:sintaxe");
  assert.equal(valorDe("(2+3"), "RECUSADO:sintaxe");
  assert.equal(valorDe("2+3)"), "RECUSADO:sintaxe");
  assert.equal(valorDe("()"), "RECUSADO:sintaxe");
  // TOKEN SOBRANDO: sem a conferencia de que o parser consumiu tudo, "2 3"
  // devolveria 2 -- um resultado plausivel com metade da conta ignorada.
  assert.equal(valorDe("2 3"), "RECUSADO:sintaxe");
  assert.equal(valorDe("(2)(3)"), "RECUSADO:sintaxe");
});

test("caractere fora do alfabeto e recusado, nunca executado", () => {
  assert.equal(valorDe("1abc2"), "RECUSADO:sintaxe");
  assert.equal(valorDe("R$ 10"), "RECUSADO:sintaxe");
  assert.equal(valorDe("10%"), "RECUSADO:sintaxe");
  // Nada de `eval` nem de `new Function`: isto tem de ser sintaxe, nunca
  // execucao. Se um dia a expressao passar pelo motor de JS, esta linha vira o
  // sintoma -- `process.exit(1)` mataria o proprio processo de teste.
  assert.equal(valorDe("process.exit(1)"), "RECUSADO:sintaxe");
  assert.equal(valorDe("2**3"), "RECUSADO:sintaxe");
});

test("quem digita fora do alfabeto le QUAL e o alfabeto", () => {
  // Este teste compara o TEXTO de proposito.
  //
  // A peneira `PERMITIDOS` nao muda o motivo da recusa -- o tokenizador tambem
  // devolveria "sintaxe" para uma letra. Um controle negativo mostrou isso:
  // apagando a peneira, toda assercao de motivo continuava verde. O que ela faz
  // e dizer a coisa util; sem ela, "R$ 10" responde "Conta incompleta." e manda
  // a pessoa procurar um parentese que ela nao esqueceu.
  // `2**3` NAO entra nesta lista: todo caractere dele e permitido, entao ele
  // passa pela peneira e morre no parser, com a mensagem de forma. Ele estava
  // aqui e o vermelho foi meu proprio teste, nao o codigo.
  for (const entrada of ["R$ 10", "10%", "1abc2"]) {
    const r = calcular(entrada);
    assert.equal(r.ok, false);
    assert.match(
      r.mensagem,
      /Use apenas numeros/,
      `"${entrada}" devia explicar o alfabeto aceito, e respondeu: ${r.mensagem}`
    );
  }

  // E a recusa de forma continua com a mensagem de forma: uma expressao feita
  // so de caracteres validos nao pode cair na mensagem de alfabeto.
  const incompleta = calcular("2+");
  assert.equal(incompleta.ok, false);
  assert.match(incompleta.mensagem, /incompleta/i);
});

test("campo vazio e um estado, nao um erro de conta", () => {
  assert.equal(valorDe(""), "RECUSADO:vazia");
  assert.equal(valorDe("   "), "RECUSADO:vazia");
  const r = calcular("");
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "vazia");
});

test("o resultado aceito traz valor e numero coerentes", () => {
  const r = calcular("1.000,50+49,50");
  assert.equal(r.ok, true);
  assert.equal(r.valor, "1050.00");
  assert.equal(r.numero, 1050);
  // O `valor` tem sempre as casas da moeda -- e o formato que `CampoDeValor`
  // reexibe sem mudar o numero.
  assert.match(r.valor, /^\d+\.\d{2}$/);
});

test("ida e volta: o valor aceito e reentrada valida da propria calculadora", () => {
  // Se o `valor` emitido nao pudesse voltar como expressao, o texto que o campo
  // guarda e o texto que a calculadora le teriam se separado. O ponto do
  // `valor` e decimal, entao ele NAO e reentrada: e isto que o teste fixa, para
  // ninguem "consertar" a calculadora aceitando ponto decimal e reabrindo o
  // erro de 10x do milhar.
  const r = calcular("2+3");
  assert.equal(r.valor, "5.00");
  assert.equal(valorDe(r.valor), "RECUSADO:milhar-ambiguo");
});
