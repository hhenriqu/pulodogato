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
