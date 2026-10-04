#!/usr/bin/env node
// =====================================================
// PULODOGATO - o rebalanceamento da divisao do grupo (HMO-245, fase 1)
// =====================================================
// `lib/divisao-configurada.ts` e a regra por tras do slider: "o total deve ser
// 100% entao se eu mexer em um, automaticamente o outro se ajustar". Esta suite
// cobra as quatro coisas que a tela NAO mostra quando dao errado:
//
//   1. A SOMA. 10000 centesimos, cravado, em TODA saida. Nao e preciosismo de
//      arredondamento: a porcentagem daqui e o peso com que o fechamento do mes
//      rateia a conta da casa, e uma configuracao que soma 9999 divide 99,99%
//      do aluguel. O residual de um centesimo nao aparece em lugar nenhum da
//      tela -- ele aparece como saldo que pagamento nenhum zera, semanas
//      depois. Por isso quase todo teste aqui termina em `somaFecha`.
//
//   2. O `NaN`. Com todos os membros em zero -- que e o estado de TODO grupo
//      existente, porque `group_members.percentage` nasce `DEFAULT 0.00` e
//      ninguem nunca escreveu nessa coluna -- a proporcao e `sobra * 0 / 0`.
//      `NaN` nao estoura: atravessa a aritmetica calado, sobrevive ao
//      `numeric(5,2)` como `NaN%` na tela, e um teste que so confira
//      "devolveu tres membros" fica verde. Por isso os testes afirmam
//      `Number.isInteger`, e nao apenas o tamanho da lista.
//
//   3. O MAIOR RESTO, e nao arredondamento. O caso que separa um do outro NAO e
//      `70/3`: 70/3 da 23,33 e `Math.round(2333,33)` e `Math.floor(2333,33)`
//      dao o MESMO 2333, entao o mutante que troca piso por arredondamento
//      sobrevive ao caso obrigatorio da issue. O caso que o mata e uma sobra
//      com parte fracionaria >= 0,5 em mais de um membro -- 3500 centesimos
//      entre tres da 1166,67 cada, e tres arredondamentos para cima somam 3501.
//      Os testes "o centesimo que sobra" existem para isso, e os dois caminhos
//      (proporcional e o degrau da divisao igual) precisam de um caso cada: o
//      mutante do piso vive num enquanto o outro o mata.
//
//   4. O ZERO QUE NAO E PARTE. `group_members.percentage` aceita 0 e
//      `expense_splits.percentage` exige `> 0`. Entao membro em 0% SAI da
//      divisao da despesa; incluir com 0,00 derruba o INSERT inteiro em 23514,
//      com mensagem que nao diz nada a quem lancou. O teste cobra a AUSENCIA da
//      linha -- e tambem que a configuracao continua sendo legitima (arrastar
//      alguem para 100% e uma pessoa bancando o mes, nao um erro).
//
// A prova de que esta suite nao e uma fixture inocente esta em
// `scripts/mutantes-divisao-configurada.mjs`, que estraga cada decisao do
// arquivo e exige vermelho -- inclusive o mutante do maior resto, que e o
// controle negativo que a issue pede por nome.
//
// POR QUE RODA NOS DOIS FUSOS (o npm script chama o node duas vezes)
// ------------------------------------------------------------------
// Este modulo nao tem data nenhuma, e e exatamente por isso que o fuso e
// verificado: a sandbox onde ele foi escrito e America/Sao_Paulo e o CI e UTC,
// e um `new Date()` que aparecesse aqui amanha (uma semeadura por mes, um
// "vigente desde") passaria verde na maquina de quem escreveu e viraria
// porcentagem diferente no CI. Rodar nos dois fusos custa segundos e e a unica
// forma de a ausencia de dependencia de data continuar sendo verdade.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  CENTESIMOS_TOTAIS,
  rebalancear,
  igualitario,
  paraPercentual,
  dePercentual,
  divisaoDaDespesa,
  conferirConfiguracao,
  divisaoDoPeriodo,
} from "../.tmp-divisao-configurada/divisao-configurada.js";

/**
 * A invariante do arquivo inteiro: a soma e 10000, e cada parte e um INTEIRO
 * nao negativo.
 *
 * `Number.isInteger` esta aqui e nao em um teste separado de proposito:
 * `NaN` nao e inteiro, e a soma de uma lista com `NaN` tambem e `NaN` -- que
 * nao e igual a 10000. Mas `assert.equal(NaN, 10000)` falha com uma mensagem
 * sobre numeros, e quem le o vermelho precisa descobrir que o problema e o
 * degrau do `0/0`. A conferencia por membro falha primeiro, dizendo QUAL
 * membro.
 */
function somaFecha(membros, contexto = "") {
  for (const m of membros) {
    assert.ok(
      Number.isInteger(m.centesimos),
      `${contexto}: ${m.member_id} ficou com ${m.centesimos}, que nao e inteiro`
    );
    assert.ok(
      m.centesimos >= 0 && m.centesimos <= CENTESIMOS_TOTAIS,
      `${contexto}: ${m.member_id} ficou com ${m.centesimos}, fora de 0..10000`
    );
  }
  const soma = membros.reduce((acc, m) => acc + m.centesimos, 0);
  assert.equal(
    soma,
    CENTESIMOS_TOTAIS,
    `${contexto}: a configuracao soma ${soma} e tem que somar ${CENTESIMOS_TOTAIS}`
  );
}

/** A lista como `{ id: centesimos }`, para afirmar numero por membro. */
function porMembro(membros) {
  return Object.fromEntries(membros.map((m) => [m.member_id, m.centesimos]));
}

function config(pares) {
  return Object.entries(pares).map(([member_id, centesimos]) => ({
    member_id,
    centesimos,
  }));
}

// ---------------------------------------------------------------------------
// DOIS MEMBROS: o caso em que "o outro se ajusta" e subtracao
// ---------------------------------------------------------------------------

test("dois membros: mexer em um da o resto exato para o outro", () => {
  const r = rebalancear(config({ ana: 5000, bia: 5000 }), "ana", 7000);
  assert.deepEqual(porMembro(r), { ana: 7000, bia: 3000 });
  somaFecha(r, "dois membros");
});

test("dois membros: a sobra vai para o outro mesmo partindo de uma config torta", () => {
  // 70/20 somava 90 -- o estado que a RLS de `group_members` permite criar por
  // fora (cada membro pode escrever a PROPRIA linha no PostgREST). Rebalancear
  // tem que NORMALIZAR, nao propagar o erro: a tela precisa de um numero para
  // mostrar, e 100% e o unico total que a divisao da despesa aceita depois.
  const r = rebalancear(config({ ana: 7000, bia: 2000 }), "ana", 4000);
  assert.deepEqual(porMembro(r), { ana: 4000, bia: 6000 });
  somaFecha(r, "config torta");
});

test("dois membros: a ordem da lista e preservada", () => {
  // A tela renderiza na ordem que recebe. Devolver reordenado faz os sliders
  // saltarem de lugar debaixo do dedo de quem esta arrastando.
  const r = rebalancear(config({ zuza: 5000, ana: 5000 }), "ana", 2500);
  assert.deepEqual(
    r.map((m) => m.member_id),
    ["zuza", "ana"]
  );
  assert.deepEqual(porMembro(r), { zuza: 7500, ana: 2500 });
});

// ---------------------------------------------------------------------------
// TRES OU MAIS: a proporcao, que e onde "o outro se ajusta" fica ambiguo
// ---------------------------------------------------------------------------

test("a sobra respeita a PROPORCAO entre os outros, nao divide igual", () => {
  // ana cai para 10%; bia e cid estavam 3000 e 2000, ou seja 3:2. A sobra de
  // 9000 tem que sair 5400/3600, que continua 3:2. Dividir 4500/4500 seria
  // inventar uma preferencia que ninguem expressou -- e seria indistinguivel
  // do degrau da divisao igual, que existe para OUTRO caso.
  const r = rebalancear(config({ ana: 5000, bia: 3000, cid: 2000 }), "ana", 1000);
  assert.deepEqual(porMembro(r), { ana: 1000, bia: 5400, cid: 3600 });
  somaFecha(r, "proporcao 3:2");
});

test("a proporcao se mantem com quatro membros e sobra que nao divide redondo", () => {
  // bia:cid:dan = 3:2:1 em cima de uma sobra de 3500, que nao e divisivel por
  // 6. 1750/1167/583 mantem o 3:2:1 e soma 3500 cravado.
  const r = rebalancear(
    config({ ana: 4000, bia: 3000, cid: 2000, dan: 1000 }),
    "ana",
    6500
  );
  assert.deepEqual(porMembro(r), { ana: 6500, bia: 1750, cid: 1167, dan: 583 });
  somaFecha(r, "proporcao 3:2:1");
});

test("o caso obrigatorio 70/3: tres membros dividindo 70% nao perdem centesimo", () => {
  // ana fica com 30% e os outros TRES dividem 70 -- 23,3333...% cada, que
  // `numeric(5,2)` nao guarda. Em float, tres vezes 23,33 somam 69,99 e a
  // divisao do mes passa a fechar 99,99% da conta. Em centesimos com maior
  // resto: 2334 + 2333 + 2333 = 7000, exato.
  const r = rebalancear(
    config({ ana: 2500, bia: 0, cid: 0, dan: 0 }),
    "ana",
    3000
  );
  assert.deepEqual(porMembro(r), { ana: 3000, bia: 2334, cid: 2333, dan: 2333 });
  somaFecha(r, "70/3");

  // E o que o banco guarda: 23,33% tres vezes e 23,34% uma, e nao 23,33 quatro
  // vezes. O centesimo nao desaparece na conversao.
  assert.deepEqual(r.map((m) => paraPercentual(m.centesimos)), [
    30, 23.34, 23.33, 23.33,
  ]);
});

// ---------------------------------------------------------------------------
// O CENTESIMO QUE SOBRA: maior resto, e nao arredondamento
// ---------------------------------------------------------------------------
// Estes dois testes sao o controle negativo do item 3 do cabecalho, um por
// caminho de codigo. A escolha de 65% nao e arbitraria: a sobra de 3500 entre
// tres da 1166,67 cada, e e so com parte fracionaria >= 0,5 em mais de um
// membro que `Math.round` deixa de coincidir com `Math.floor` -- tres
// arredondamentos para cima somam 3501, e a configuracao passa a somar 100,01%.
// Com 70/3 (parte fracionaria 0,33) os dois dao o mesmo numero e o mutante
// sobrevive.

test("o centesimo que sobra: caminho PROPORCIONAL com pesos iguais e nao nulos", () => {
  const r = rebalancear(
    config({ ana: 2500, bia: 1000, cid: 1000, dan: 1000 }),
    "ana",
    6500
  );
  somaFecha(r, "maior resto proporcional");
  // Dois sobem para 1167 e um fica em 1166 -- nao tres em 1167.
  assert.deepEqual(porMembro(r), { ana: 6500, bia: 1167, cid: 1167, dan: 1166 });
});

test("o centesimo que sobra: caminho da DIVISAO IGUAL (outros todos em zero)", () => {
  const r = rebalancear(
    config({ ana: 0, bia: 0, cid: 0, dan: 0 }),
    "ana",
    6500
  );
  somaFecha(r, "maior resto igual");
  assert.deepEqual(porMembro(r), { ana: 6500, bia: 1167, cid: 1167, dan: 1166 });
});

test("o desempate e pelo member_id, nao pela ordem em que a tela montou a lista", () => {
  // Com os outros todos em zero os tres restos sao IDENTICOS -- o empate e a
  // regra, nao a excecao. `sort` do V8 e estavel, entao sem desempate explicito
  // o centesimo extra seguiria a ordem do array: a MESMA configuracao gravaria
  // numeros diferentes conforme a ordem do render. Aqui a lista vem `cid, ana,
  // bia`, e os dois extras tem que ir para `ana` e `bia` (os menores ids), nao
  // para `cid` por estar na frente.
  const r = rebalancear(config({ zuza: 0, cid: 0, ana: 0, bia: 0 }), "zuza", 6500);
  assert.deepEqual(porMembro(r), { zuza: 6500, cid: 1166, ana: 1167, bia: 1167 });
  somaFecha(r, "desempate por id");
});

// ---------------------------------------------------------------------------
// TODOS EM ZERO: o degrau do 0/0, que e o estado de TODO grupo que existe hoje
// ---------------------------------------------------------------------------

test("todos em zero: a sobra se divide IGUAL, e nao vira NaN", () => {
  const r = rebalancear(config({ ana: 0, bia: 0, cid: 0 }), "ana", 4000);
  somaFecha(r, "todos em zero");
  assert.deepEqual(porMembro(r), { ana: 4000, bia: 3000, cid: 3000 });
});

test("todos em zero e o arrastado tambem em zero: a tela nao mostra NaN%", () => {
  // O caso extremo do degrau: nem o membro mexido tem peso. Os outros dividem
  // 100% igual. Sem o degrau, TODA a lista sai `NaN`.
  const r = rebalancear(config({ ana: 0, bia: 0, cid: 0 }), "ana", 0);
  somaFecha(r, "tudo em zero");
  assert.deepEqual(porMembro(r), { ana: 0, bia: 5000, cid: 5000 });
  for (const m of r) {
    assert.ok(
      !Number.isNaN(m.centesimos),
      `${m.member_id} saiu NaN -- a tela mostraria "NaN%"`
    );
  }
});

test("peso negativo ou nao numerico cai no degrau em vez de inverter a proporcao", () => {
  // Nenhum slider produz isso; leitura de banco e `Number("")` produzem. Peso
  // negativo encolhe a soma e INVERTE a proporcao de quem sobrou; `NaN`
  // contamina a soma inteira. Virar zero joga os dois no degrau, que e
  // definido.
  for (const sujo of [-5000, NaN, Infinity, null, undefined, "3000"]) {
    const r = rebalancear(
      [
        { member_id: "ana", centesimos: 2000 },
        { member_id: "bia", centesimos: sujo },
        { member_id: "cid", centesimos: 0 },
      ],
      "ana",
      4000
    );
    somaFecha(r, `peso sujo ${String(sujo)}`);
    assert.deepEqual(porMembro(r), { ana: 4000, bia: 3000, cid: 3000 });
  }
});

// ---------------------------------------------------------------------------
// UM EM 100%: legitimo, e nao um erro a ser impedido
// ---------------------------------------------------------------------------

test("um membro em 100% zera os outros, e isso e legitimo", () => {
  const r = rebalancear(config({ ana: 3000, bia: 3000, cid: 4000 }), "ana", 10000);
  assert.deepEqual(porMembro(r), { ana: 10000, bia: 0, cid: 0 });
  somaFecha(r, "um banca o mes");
});

test("pedir mais de 100% vira 100%, e nao soma 120%", () => {
  // `percentage > 100` e 23514 nas DUAS tabelas, e a tela nao tem como mostrar
  // esse erro de um jeito que explique. O teto mora aqui.
  const r = rebalancear(config({ ana: 3000, bia: 7000 }), "ana", 12000);
  assert.deepEqual(porMembro(r), { ana: 10000, bia: 0 });
  somaFecha(r, "acima do teto");
});

test("pedir menos de zero vira zero", () => {
  const r = rebalancear(config({ ana: 3000, bia: 7000 }), "ana", -500);
  assert.deepEqual(porMembro(r), { ana: 0, bia: 10000 });
  somaFecha(r, "abaixo do piso");
});

test("grupo de um membro so: ele paga 100%, qualquer que seja o pedido", () => {
  // A sobra nao tem para onde ir. Honrar o pedido devolveria uma lista somando
  // menos de 100%, que e exatamente o que nao pode existir.
  for (const pedido of [0, 3000, 10000, 99999]) {
    const r = rebalancear(config({ ana: 0 }), "ana", pedido);
    assert.deepEqual(porMembro(r), { ana: 10000 }, `pedido ${pedido}`);
    somaFecha(r, `um membro, pedido ${pedido}`);
  }
});

test("pedido nao numerico ou membro fora da lista apenas normaliza", () => {
  // Campo vazio (`Number("")` dentro do componente) e lista defasada depois de
  // outro admin remover alguem. Nao ha o que rebalancear EM TORNO DE, mas a
  // tela ainda precisa de uma lista que some 100%.
  for (const [memberId, pedido] of [
    ["ana", NaN],
    ["ana", null],
    ["ana", undefined],
    ["ana", "4000"],
    ["quem-saiu", 4000],
  ]) {
    const r = rebalancear(config({ ana: 3000, bia: 1000 }), memberId, pedido);
    somaFecha(r, `normaliza ${memberId}/${String(pedido)}`);
    // Normalizar mantem a proporcao 3:1 que estava la.
    assert.deepEqual(porMembro(r), { ana: 7500, bia: 2500 });
  }
});

test("lista vazia devolve lista vazia, sem dividir por zero", () => {
  assert.deepEqual(rebalancear([], "ana", 5000), []);
});

test("pedido fracionario e arredondado antes de entrar na config", () => {
  // Este NAO e um caso hipotetico, e e o caso mais provavel do slider: a
  // posicao do dedo vira porcentagem por regra de tres -- `(x / largura) *
  // 10000` --, que quase nunca da inteiro. Sem arredondar, o proprio membro
  // mexido fica com 3333,5 centesimos: a config soma 10000,5, `numeric(5,2)`
  // guarda 33,34 e a soma gravada deixa de ser a soma calculada. O mutante que
  // tira esse `Math.round` sobreviveu a primeira versao desta suite.
  const r = rebalancear(config({ ana: 0, bia: 0, cid: 0 }), "ana", 3333.5);
  somaFecha(r, "pedido fracionario");
  assert.deepEqual(porMembro(r), { ana: 3334, bia: 3333, cid: 3333 });
});

// ---------------------------------------------------------------------------
// O ESTADO INICIAL DA TELA
// ---------------------------------------------------------------------------

test("igualitario fecha 10000 inclusive quando o numero de membros nao divide", () => {
  assert.deepEqual(porMembro(igualitario(["ana", "bia"])), { ana: 5000, bia: 5000 });

  const tres = igualitario(["ana", "bia", "cid"]);
  somaFecha(tres, "igual entre tres");
  assert.deepEqual(porMembro(tres), { ana: 3334, bia: 3333, cid: 3333 });

  const sete = igualitario(["a", "b", "c", "d", "e", "f", "g"]);
  somaFecha(sete, "igual entre sete");

  assert.deepEqual(igualitario([]), []);
});

// ---------------------------------------------------------------------------
// A IDA E VOLTA PELO numeric(5,2)
// ---------------------------------------------------------------------------

test("centesimos sobrevivem a ida e volta pelo numeric(5,2)", () => {
  // `33.33 * 100` da 3332.9999999999995 em binario. Sem arredondar, cada
  // recarga da tela comeria um centesimo de alguem, e a soma deixaria de fechar
  // depois de um numero de recargas que ninguem conseguiria reproduzir.
  for (const c of [0, 1, 2333, 2334, 3333, 3334, 5000, 6667, 9999, 10000]) {
    assert.equal(dePercentual(paraPercentual(c)), c, `centesimos ${c}`);
  }
});

test("paraPercentual produz o que a coluna aceita", () => {
  assert.equal(paraPercentual(3333), 33.33);
  assert.equal(paraPercentual(10000), 100);
  assert.equal(paraPercentual(0), 0);
});

test("dePercentual nao deixa passar valor fora de 0..100", () => {
  assert.equal(dePercentual(150), CENTESIMOS_TOTAIS);
  assert.equal(dePercentual(-3), 0);
  for (const sujo of [NaN, Infinity, null, undefined, "33.33"]) {
    assert.equal(dePercentual(sujo), 0, `sujo ${String(sujo)}`);
  }
});

// ---------------------------------------------------------------------------
// O DEGRAU QUE VIRA DINHEIRO: 0% SAI DA DIVISAO DA DESPESA
// ---------------------------------------------------------------------------

test("membro em 0% nao entra na divisao da despesa com parte zerada", () => {
  // `group_members.percentage` aceita 0; `expense_splits.percentage` exige
  // `> 0`. Uma linha com 0,00 derruba o INSERT INTEIRO em 23514 -- a despesa
  // nao e gravada, e a mensagem do CHECK nao diz nada a quem lancou.
  const r = divisaoDaDespesa(config({ ana: 7000, bia: 3000, cid: 0 }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.partes, [
    { member_id: "ana", percentage: 70 },
    { member_id: "bia", percentage: 30 },
  ]);
  assert.ok(
    !r.partes.some((p) => p.member_id === "cid"),
    "cid esta em 0% e nao pode ter parte nenhuma desta despesa"
  );
  for (const p of r.partes) {
    assert.ok(p.percentage > 0, `${p.member_id} saiu com percentage ${p.percentage}`);
  }
});

test("um membro bancando o mes gera UMA parte de 100%, nao N-1 partes de zero", () => {
  const so = rebalancear(config({ ana: 3000, bia: 3000, cid: 4000 }), "ana", 10000);
  const r = divisaoDaDespesa(so);
  assert.equal(r.ok, true);
  assert.deepEqual(r.partes, [{ member_id: "ana", percentage: 100 }]);
});

test("a soma das partes da despesa continua 100% depois de tirar os zeros", () => {
  // Tirar linha de zero nao muda soma -- mas e aqui que se prova, porque
  // "filtrar" e "filtrar e reescalar" sao indistinguiveis em qualquer teste que
  // so conte linhas.
  const r = divisaoDaDespesa(config({ ana: 2334, bia: 2333, cid: 2333, dan: 3000, eva: 0 }));
  assert.equal(r.ok, true);
  const soma = r.partes.reduce((acc, p) => acc + Math.round(p.percentage * 100), 0);
  assert.equal(soma, CENTESIMOS_TOTAIS);
  assert.equal(r.partes.length, 4);
});

test("configuracao que nao soma 100% e RECUSADA, nao usada em silencio", () => {
  // O que chega nesta funcao vem do banco, uma linha por membro, e a RLS
  // `group_members_update` deixa qualquer membro escrever a PROPRIA
  // `percentage` pelo PostgREST. Um "eu pago 1%" feito por fora deixa o
  // conjunto somando 96 -- e a despesa fecharia 96% do valor, em silencio.
  // Nao ha CHECK no banco que veja a soma: ela e conferida aqui.
  const r = divisaoDaDespesa(config({ ana: 100, bia: 9500 }));
  assert.equal(r.ok, false);
  assert.match(r.erro, /96,00%/);
  assert.match(r.erro, /100%/);
});

test("configuracao toda em zero e recusada pela soma, com o numero na mensagem", () => {
  // O grupo nunca configurado (`DEFAULT 0.00` em todas as linhas) chegando na
  // despesa. Sem a conferencia da soma isto geraria uma despesa com parte
  // nenhuma: dinheiro lancado que nao e de ninguem.
  const r = divisaoDaDespesa(config({ ana: 0, bia: 0, cid: 0 }));
  assert.equal(r.ok, false);
  assert.match(r.erro, /0,00%/);
});

test("UM centesimo de diferenca na soma ja e recusado", () => {
  // A conferencia e `!== 10000`, e nao "perto de 10000". O mutante que a trocou
  // por `Math.abs(soma - 10000) > 1` sobreviveu a primeira versao desta suite --
  // e ele e precisamente o defeito que o arquivo existe para impedir: 99,99% da
  // conta dividida deixa um residual que pagamento nenhum zera, e esse residual
  // nao aparece em tela nenhuma. Nao ha tolerancia a conceder porque nao ha nada
  // a tolerar: em centesimos inteiros, 100% E atingivel sempre.
  for (const soma of [9999, 10001]) {
    const r = divisaoDaDespesa(config({ ana: 5000, bia: soma - 5000 }));
    assert.equal(r.ok, false, `soma ${soma} passou`);
  }
  assert.match(
    divisaoDaDespesa(config({ ana: 5000, bia: 4999 })).erro,
    /99,99%/
  );
});

test("configuracao que soma MAIS de 100% tambem e recusada", () => {
  const r = divisaoDaDespesa(config({ ana: 7000, bia: 7000 }));
  assert.equal(r.ok, false);
  assert.match(r.erro, /140,00%/);
});

test("despesa sem membro nenhum e recusada", () => {
  const r = divisaoDaDespesa([]);
  assert.equal(r.ok, false);
});

// ---------------------------------------------------------------------------
// A PONTA A PONTA: arrastar varias vezes nao acumula erro
// ---------------------------------------------------------------------------

test("arrastar em sequencia mantem a soma em 10000 em todos os passos", () => {
  // O modo de falha que um teste de uma chamada so nao ve: um centesimo perdido
  // por arrasto. Quem mexe no slider mexe dezenas de vezes antes de salvar, e o
  // erro acumulado chegaria no banco sem ninguem ter visto um numero errado na
  // tela.
  let atual = igualitario(["ana", "bia", "cid", "dan"]);
  somaFecha(atual, "inicial");

  const arrastos = [
    ["ana", 6500],
    ["bia", 3333],
    ["cid", 1],
    ["dan", 9999],
    ["ana", 0],
    ["bia", 10000],
    ["cid", 2500],
    ["dan", 2500],
    ["ana", 7777],
  ];

  for (const [quem, quanto] of arrastos) {
    atual = rebalancear(atual, quem, quanto);
    somaFecha(atual, `depois de ${quem} -> ${quanto}`);
    assert.equal(
      atual.find((m) => m.member_id === quem).centesimos,
      quanto,
      `${quem} pediu ${quanto} e nao ficou com isso`
    );
    assert.deepEqual(
      atual.map((m) => m.member_id),
      ["ana", "bia", "cid", "dan"],
      "a ordem da lista mudou no meio do arrasto"
    );
  }

  // E o que o banco receberia no fim continua sendo divisivel em despesa.
  const r = divisaoDaDespesa(atual);
  assert.equal(r.ok, true);
});

test("a ida e volta pelo banco nao quebra a divisao da despesa", () => {
  // O ciclo real: rebalanceia na tela -> grava `numeric(5,2)` -> recarrega ->
  // lanca despesa. Se a conversao perdesse um centesimo, a despesa passaria a
  // ser RECUSADA depois de uma recarga -- um defeito que so aparece na segunda
  // sessao, e que nenhum teste de uma funcao so alcanca.
  const naTela = rebalancear(config({ ana: 0, bia: 0, cid: 0 }), "ana", 3334);
  const noBanco = naTela.map((m) => paraPercentual(m.centesimos));
  const recarregado = naTela.map((m, i) => ({
    member_id: m.member_id,
    centesimos: dePercentual(noBanco[i]),
  }));

  somaFecha(recarregado, "recarregado do banco");
  assert.deepEqual(porMembro(recarregado), porMembro(naTela));
  assert.equal(divisaoDaDespesa(recarregado).ok, true);
});

// ---------------------------------------------------------------------------
// conferirConfiguracao -- o corpo do PUT /split-config (HMO-269, fase 3)
// ---------------------------------------------------------------------------
// Esta e a porta de entrada da PRIMEIRA escrita que o app tem em
// `group_members.percentage`. As tres recusas dela sao a unica coisa entre um
// corpo de requisicao e o peso com que o fechamento rateia a conta da casa, e
// todas as tres falham do mesmo jeito quando quebram: um 200 com o numero
// errado gravado. Por isso elas sao testadas aqui, na funcao pura, e nao por
// uma sonda que so saberia ler o status.

/** `{ member_id: percentage }` -> o formato que a rota recebe no corpo. */
function corpo(pares) {
  return Object.entries(pares).map(([member_id, percentage]) => ({
    member_id,
    percentage,
  }));
}

/** A saida aprovada como `{ id: percentage }`. */
function aprovado(r) {
  assert.equal(r.ok, true, `esperava aprovacao, veio ${JSON.stringify(r)}`);
  return Object.fromEntries(r.porMembro.map((m) => [m.member_id, m.percentage]));
}

test("70/30 passa e sai na ordem do BANCO, nao na do corpo", () => {
  const r = conferirConfiguracao(
    ["ana", "bia"],
    corpo({ bia: 30, ana: 70 }) // o corpo veio ao contrario de proposito
  );
  assert.deepEqual(aprovado(r), { ana: 70, bia: 30 });
  // A ordem importa: a rota casa esta lista com as linhas que leu do banco.
  assert.deepEqual(
    r.porMembro.map((m) => m.member_id),
    ["ana", "bia"]
  );
});

test("soma 99,99 e RECUSADA -- o caso que a issue pede por nome", () => {
  const r = conferirConfiguracao(["ana", "bia"], corpo({ ana: 69.99, bia: 30 }));
  assert.equal(r.ok, false);
  assert.equal(r.recusa.motivo, "soma");
  // O numero da mensagem e o que foi CONFERIDO, em centesimos: 9999.
  assert.equal(r.recusa.centesimos, 9999);
  assert.equal(paraPercentual(r.recusa.centesimos), 99.99);
});

test("soma 100,01 tambem e recusada -- a trava e dos DOIS lados", () => {
  // Sem esta, um `>= 10000` no lugar do `===` passaria em todo teste de 99,99 e
  // gravaria uma configuracao que rateia 100,01% da conta.
  const r = conferirConfiguracao(["ana", "bia"], corpo({ ana: 70.01, bia: 30 }));
  assert.equal(r.ok, false);
  assert.equal(r.recusa.motivo, "soma");
  assert.equal(r.recusa.centesimos, 10001);
});

test("33,333 x3 e recusado: o que soma 100 em float grava 99,99", () => {
  // O caso que separa "conferiu o corpo" de "conferiu o que vai ser gravado".
  // 33.333 * 3 = 99.999, que qualquer tolerancia de float aceita como 100 --
  // e `numeric(5,2)` guardaria 33.33 tres vezes, somando 99,99.
  const r = conferirConfiguracao(
    ["ana", "bia", "cid"],
    corpo({ ana: 33.333, bia: 33.333, cid: 33.333 })
  );
  assert.equal(r.ok, false);
  assert.equal(r.recusa.motivo, "soma");
  assert.equal(r.recusa.centesimos, 9999);
});

test("33,33 / 33,33 / 33,34 passa, e e exatamente o que vai para a coluna", () => {
  const r = conferirConfiguracao(
    ["ana", "bia", "cid"],
    corpo({ ana: 33.33, bia: 33.33, cid: 33.34 })
  );
  const p = aprovado(r);
  assert.deepEqual(p, { ana: 33.33, bia: 33.33, cid: 33.34 });
  // Duas casas decimais, porque `numeric(5,2)` nao guarda mais que isso sem
  // arredondar calado.
  for (const v of Object.values(p)) {
    assert.ok(
      Number.isInteger(Math.round(v * 100)) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-9,
      `${v} nao cabe em numeric(5,2)`
    );
  }
});

test("membro em 0% FICA na configuracao, ao contrario da divisao da despesa", () => {
  // Uma pessoa banca o mes. A linha do outro membro existe no banco de
  // qualquer jeito: omiti-la deixaria nela o valor ANTIGO, e a soma GRAVADA
  // deixaria de ser a soma conferida.
  const r = conferirConfiguracao(["ana", "bia"], corpo({ ana: 100, bia: 0 }));
  assert.deepEqual(aprovado(r), { ana: 100, bia: 0 });

  // E o contraste com `divisaoDaDespesa`, que OMITE o zero porque
  // `expense_splits.percentage` exige `> 0`:
  const despesa = divisaoDaDespesa([
    { member_id: "ana", centesimos: CENTESIMOS_TOTAIS },
    { member_id: "bia", centesimos: 0 },
  ]);
  assert.equal(despesa.ok, true);
  assert.deepEqual(
    despesa.partes.map((p) => p.member_id),
    ["ana"]
  );
});

test("membro ativo que o corpo esqueceu e recusado, e a recusa DIZ quem", () => {
  // Gravar 70/30 entre dois de tres deixaria o terceiro no valor velho: a soma
  // gravada viraria 70+30+x. Este e o caso que um teste de soma sozinho nao
  // pega, porque 70+30 fecha 100 perfeitamente.
  const r = conferirConfiguracao(
    ["ana", "bia", "cid"],
    corpo({ ana: 70, bia: 30 })
  );
  assert.equal(r.ok, false);
  assert.equal(r.recusa.motivo, "conjunto");
  assert.deepEqual(r.recusa.faltando, ["cid"]);
  assert.deepEqual(r.recusa.sobrando, []);
});

test("membro inativo ou inventado no corpo e recusado como SOBRANDO", () => {
  const r = conferirConfiguracao(
    ["ana", "bia"],
    corpo({ ana: 50, bia: 30, fantasma: 20 })
  );
  assert.equal(r.ok, false);
  assert.equal(r.recusa.motivo, "conjunto");
  assert.deepEqual(r.recusa.sobrando, ["fantasma"]);
});

test("o conjunto e conferido ANTES da soma", () => {
  // Um corpo que soma 100 mas fala de outro grupo nao pode ser aprovado por
  // acidente. Se a ordem das duas conferencias se invertesse, este caso
  // continuaria sendo recusado -- mas o de cima ("esqueceu o cid"), que soma
  // 100 cravado, passaria.
  const r = conferirConfiguracao(["ana", "bia"], corpo({ zed: 60, mel: 40 }));
  assert.equal(r.ok, false);
  assert.equal(r.recusa.motivo, "conjunto");
  assert.deepEqual(r.recusa.faltando, ["ana", "bia"]);
  assert.deepEqual(r.recusa.sobrando, ["zed", "mel"]);
});

test("o mesmo membro duas vezes e recusado", () => {
  // Sem esta guarda o Map colapsa as duas entradas, a ultima vence, e o
  // conjunto parece completo com `bia` nunca tendo sido mencionada.
  const r = conferirConfiguracao(
    ["ana", "bia"],
    corpo([]).concat(
      { member_id: "ana", percentage: 100 },
      { member_id: "ana", percentage: 0 }
    )
  );
  assert.equal(r.ok, false);
  assert.equal(r.recusa.motivo, "repetido");
});

test("grupo sem membro ativo cai na recusa de soma, nao em NaN", () => {
  const r = conferirConfiguracao([], []);
  assert.equal(r.ok, false);
  assert.equal(r.recusa.motivo, "soma");
  assert.equal(r.recusa.centesimos, 0);
});

test("o que `rebalancear` produz e sempre aceito por `conferirConfiguracao`", () => {
  // O contrato entre a tela (fase 5) e a rota (fase 3). Se ele quebrar, o
  // slider passa a montar corpos que a rota recusa -- e o sintoma seria
  // "salvar nao funciona", sem nada vermelho em lugar nenhum.
  const ids = ["ana", "bia", "cid"];
  for (const pedido of [0, 1, 3333, 5000, 6667, 9999, 10000]) {
    const naTela = rebalancear(config({ ana: 0, bia: 0, cid: 0 }), "ana", pedido);
    const r = conferirConfiguracao(
      ids,
      naTela.map((m) => ({
        member_id: m.member_id,
        percentage: paraPercentual(m.centesimos),
      }))
    );
    assert.equal(
      r.ok,
      true,
      `pedido ${pedido}: a rota recusaria o que o slider montou (${JSON.stringify(r)})`
    );
    const soma = r.porMembro.reduce((acc, m) => acc + dePercentual(m.percentage), 0);
    assert.equal(soma, CENTESIMOS_TOTAIS, `pedido ${pedido}: a soma gravada nao fecha`);
  }
});

test("o que `igualitario` produz tambem e aceito", () => {
  for (const n of [1, 2, 3, 4, 7]) {
    const ids = Array.from({ length: n }, (_, i) => `m${i}`);
    const r = conferirConfiguracao(
      ids,
      igualitario(ids).map((m) => ({
        member_id: m.member_id,
        percentage: paraPercentual(m.centesimos),
      }))
    );
    assert.equal(r.ok, true, `${n} membros: ${JSON.stringify(r)}`);
  }
});

test("o que sai e o NORMALIZADO, nao o numero que entrou no corpo", () => {
  // O caso que separa "conferiu em centesimos" de "gravou em centesimos".
  // 70,004 + 29,996 vira 7000 + 3000 = 10000 cravado, entao a conferencia
  // APROVA -- e os dois numeros do corpo nao cabem em `numeric(5,2)`. Devolver
  // o que entrou deixaria o Postgres arredondar calado na hora do INSERT, e o
  // que a conferencia aprovou nao seria o que ficou na coluna.
  const r = conferirConfiguracao(
    ["ana", "bia"],
    corpo({ ana: 70.004, bia: 29.996 })
  );
  assert.deepEqual(aprovado(r), { ana: 70, bia: 30 });
});

// =====================================================
// `divisaoDoPeriodo`: a config virando PESO (HMO-245, fase 4)
// =====================================================
// Esta e a unica funcao que le `expense_groups.default_split_type` junto com
// `group_members.percentage` e decide o que vale no fechamento do mes. Tudo o
// que ela errar sai da rota do fechamento como um 200 com o numero errado.
//
// O caso que mais importa e o que ela RECUSA: `ratearPorPeso` divide pela SOMA
// dos pesos, entao uma config gravada somando 97% nao divide 97% da conta --
// divide 100% numa proporcao que ninguem configurou, com o total fechando e
// nada na tela denunciando. `equal` e a saida certa, e `soma_centesimos` e o
// numero pelo qual a tela cobra o ajuste.

const membrosCom = (...pares) =>
  pares.map(([user_id, percentage]) => ({ user_id, percentage }));

const pesosDe = (d) => d.pesos.map((p) => p.peso);

test("modo percentage com soma 100% aplica o peso gravado", () => {
  const d = divisaoDoPeriodo("percentage", membrosCom(["ana", 70], ["bia", 30]));
  assert.equal(d.aplicado, "percentage");
  assert.equal(d.configurado, "percentage");
  assert.equal(d.soma_centesimos, CENTESIMOS_TOTAIS);
  // Centesimo de ponto: 70,00% e 7000, nao 70.
  assert.deepEqual(pesosDe(d), [7000, 3000]);
  // A ordem recebida e preservada -- a rota casa `pesos[i]` com `membros[i]`.
  assert.deepEqual(
    d.pesos.map((p) => p.user_id),
    ["ana", "bia"]
  );
});

test("as duas casas decimais chegam inteiras no peso", () => {
  // 33,33 + 33,33 + 33,34 = 100,00. Em float `33.33 * 100` da
  // 3332.9999999999995, e sem o arredondamento de `dePercentual` a soma nao
  // fecharia 10000 e o grupo cairia em `equal` por um erro de binario.
  const d = divisaoDoPeriodo(
    "percentage",
    membrosCom(["ana", 33.33], ["bia", 33.33], ["cau", 33.34])
  );
  assert.equal(d.soma_centesimos, CENTESIMOS_TOTAIS);
  assert.equal(d.aplicado, "percentage");
  assert.deepEqual(pesosDe(d), [3333, 3333, 3334]);
  assert.equal(pesosDe(d).every(Number.isInteger), true);
});

test("soma != 100% NAO rateia a proporcao errada: cai em equal", () => {
  // Como a RLS `group_members_update` permite `user_id = auth.uid()` e policy
  // nao compara OLD com NEW, qualquer membro pode baixar a PROPRIA percentage
  // direto no PostgREST. 70 + 27 continuaria dividindo 100% da conta, em
  // 72,2/27,8 -- numeros que ninguem configurou, com o total fechando.
  const d = divisaoDoPeriodo("percentage", membrosCom(["ana", 70], ["bia", 27]));
  assert.equal(d.configurado, "percentage");
  assert.equal(d.aplicado, "equal");
  assert.equal(d.soma_centesimos, 9700);
  assert.deepEqual(pesosDe(d), [1, 1]);

  // E passa de 100% tambem: 70 + 40 e config invalida, nao "70/40 normalizado".
  const demais = divisaoDoPeriodo(
    "percentage",
    membrosCom(["ana", 70], ["bia", 40])
  );
  assert.equal(demais.aplicado, "equal");
  assert.equal(demais.soma_centesimos, 11000);
});

test("os quatro zeros do DEFAULT 0.00 caem em equal, e dizem a soma", () => {
  // O estado de TODO grupo criado antes da fase 3: a coluna existe desde a 001
  // e nunca foi escrita. Sem este degrau o grupo em modo percentage rateia 0%
  // da conta da casa.
  const d = divisaoDoPeriodo(
    "percentage",
    membrosCom(["ana", 0], ["bia", 0], ["cau", 0])
  );
  assert.equal(d.aplicado, "equal");
  assert.equal(d.soma_centesimos, 0);
  assert.deepEqual(pesosDe(d), [1, 1, 1]);
});

test("equal, custom e proportional nao usam peso -- e `configurado` diz qual era", () => {
  // Os quatro valores do `expense_groups_default_split_type_check`. Só
  // `percentage` tem numero de GRUPO para ler: `custom` e por despesa e
  // `proportional` le `group_member_proportions`, o segundo armazem de
  // porcentagem que a fase 7 aposenta. Ler os dois aqui e como se chega a duas
  // telas discordando sobre dinheiro.
  for (const modo of ["equal", "custom", "proportional"]) {
    const d = divisaoDoPeriodo(modo, membrosCom(["ana", 70], ["bia", 30]));
    assert.equal(d.aplicado, "equal", modo);
    // O que a tela usa para nao mostrar "igual" sobre um grupo configurado de
    // outro jeito.
    assert.equal(d.configurado, modo);
    assert.deepEqual(pesosDe(d), [1, 1], modo);
    // A soma e informada mesmo quando nao foi usada: 70/30 gravado continua
    // sendo o que a tela de configuracao vai mostrar.
    assert.equal(d.soma_centesimos, CENTESIMOS_TOTAIS, modo);
  }
});

test("modo ausente ou nao-string cai em equal sem lancar", () => {
  // Erro ao ler o grupo deixa `grupo` nulo na rota, e `grupo?.default_split_type`
  // chega `undefined`. O fechamento tem de sair na divisao igual, e nao a tela
  // ficar em branco por causa de uma coluna.
  //
  // String vazia NAO esta nesta lista de proposito: `default_split_type` e
  // `NOT NULL` com CHECK nos quatro valores (001_baseline:1064 e :1069), entao
  // "" nao e um estado que o banco produz -- e afirmar o que a funcao faz com
  // ele seria trancar uma escolha arbitraria em vez de um comportamento.
  for (const modo of [undefined, null, 42, {}]) {
    const d = divisaoDoPeriodo(modo, membrosCom(["ana", 70], ["bia", 30]));
    assert.equal(d.aplicado, "equal", String(modo));
    assert.equal(d.configurado, "equal", String(modo));
  }
});

test("percentage que chega como STRING nao apaga a configuracao", () => {
  // A falha desta conversao e MUDA: `dePercentual("70.00")` e 0, quatro zeros
  // somam 0, e isso cai em `equal` -- a divisao configurada simplesmente nunca
  // valeria, sem erro, sem log, com um fechamento que parece certo.
  const d = divisaoDoPeriodo(
    "percentage",
    membrosCom(["ana", "70.00"], ["bia", "30.00"])
  );
  assert.equal(d.aplicado, "percentage");
  assert.deepEqual(pesosDe(d), [7000, 3000]);
});

test("percentage nulo ou lixo vale zero, e nao derruba o fechamento", () => {
  const d = divisaoDoPeriodo(
    "percentage",
    membrosCom(["ana", 100], ["bia", null], ["cau", "nao-numero"])
  );
  // Bia e Cau em zero: Ana banca o mes, que e config legitima.
  assert.equal(d.aplicado, "percentage");
  assert.equal(d.soma_centesimos, CENTESIMOS_TOTAIS);
  assert.deepEqual(pesosDe(d), [10000, 0, 0]);
});

test("grupo sem membro ativo nao vira config aplicada", () => {
  // Soma 0 != 10000: cai em `equal` com lista vazia. Nao ha guarda propria para
  // isso, e a conferencia da soma ja descreve o estado.
  const d = divisaoDoPeriodo("percentage", []);
  assert.equal(d.aplicado, "equal");
  assert.equal(d.soma_centesimos, 0);
  assert.deepEqual(d.pesos, []);
});

test("o que `conferirConfiguracao` aprova e o que `divisaoDoPeriodo` aplica", () => {
  // As duas pontas da mesma config: o PUT da fase 3 grava o que a primeira
  // aprovou, e o fechamento da fase 4 le com a segunda. Se elas discordarem
  // sobre o que soma 100%, o admin grava 200 e o fechamento rateia igual --
  // sem erro em lugar nenhum.
  for (const pedido of [0, 1, 33, 50, 70, 99, 100]) {
    const corpoDoPut = [
      { member_id: "ana", percentage: pedido },
      { member_id: "bia", percentage: 100 - pedido },
    ];
    const aprovou = conferirConfiguracao(["ana", "bia"], corpoDoPut).ok;

    const d = divisaoDoPeriodo(
      "percentage",
      corpoDoPut.map((m) => ({ user_id: m.member_id, percentage: m.percentage }))
    );
    assert.equal(
      d.aplicado === "percentage",
      aprovou,
      `pedido ${pedido}: o PUT ${aprovou ? "aprova" : "recusa"} e o fechamento ${
        d.aplicado === "percentage" ? "aplica" : "ignora"
      }`
    );
  }
});
