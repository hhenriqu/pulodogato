#!/usr/bin/env node
// =====================================================
// PULODOGATO - a serie de parcelas (HMO-211)
// =====================================================
// "Sobre parcelar, deve ser um checkbox abaixo do valor do cartao e ao clicar
// perguntar se o valor que esta no input e o da parcela ou total, e em qual
// parcela aquela se refere de quantas no total."
//
// POR QUE ESTA SUITE E SEPARADA DE test-lancamento.mjs
// ---------------------------------------------------
// Sao quatro entradas (valor, base, N, M) que se combinam de um jeito em que o
// erro nao aparece na tela que o produziu. Cada um dos quatro defeitos abaixo
// grava dinheiro plausivel, sem erro nenhum:
//
//   1. BASE TROCADA. "1.000" em 10x lido como total em vez de parcela grava uma
//      compra de R$ 1.000 em vez de R$ 10.000 -- ou o contrario, dez vezes a
//      compra. Os dois numeros sao valores de compra possiveis.
//   2. N E M INVERTIDOS. "parcela 3 de 10" lido como "10 de 3" muda quantas
//      linhas existem e em que meses elas caem.
//   3. OFF-BY-ONE NA CONTAGEM. Uma parcela a mais no fim cai na fatura de um mes
//      que ainda nao chegou -- a unica tela que mostraria isso e uma que ninguem
//      abriu ainda.
//   4. CENTAVO PERDIDO NA DIVISAO. R$ 1.000 em 3x com `ROUND` e sem a sobra na
//      ultima parcela da 3 x 333,33 = 999,99: a fatura fecha com um centavo que
//      linha nenhuma explica.
//
// `scripts/mutantes-parcelamento.mjs` planta exatamente esses quatro (mais a
// decisao (A)) e exige que cada um reprove ALGUM teste daqui.
//
// A DECISAO (A), E A ASSERCAO NEGATIVA QUE A PRENDE
// -------------------------------------------------
// Lancar "parcela 3 de 10" registra SO as 8 que faltam. A alternativa (B) --
// gravar a serie toda marcando as 2 anteriores como pagas -- foi descartada na
// HMO-208: o app passaria a afirmar pagamentos que ninguem registrou, com
// `paid_date` sem transacao por tras (a classe de problema da HMO-149, o numero
// fecha e o fato nao aconteceu).
//
// Uma suite que so conferisse `parcelas.length === 8` passaria verde com a
// opcao (B) implementada errada de varios jeitos. Entao aqui a negacao e
// EXPLICITA: nenhuma parcela com numero < N, em nenhum caso.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  serieDeParcelas,
  somaMeses,
  descricaoDaParcela,
  rotuloDaParcela,
  resumoDaSerie,
  parcelaDigitada,
  validarLancamento,
  valoresIniciais,
  destinoDoLancamento,
  camposDoTipo,
} from "../.tmp-parcelamento/lib/lancamento.js";

const CATEGORIA_DESPESA = { id: "c1", name: "Mercado", is_expense: true };

function noCartao(extra = {}) {
  return {
    ...valoresIniciais(),
    descricao: "Notebook",
    valor: "100",
    categoriaId: "c1",
    contaId: "cartao-1",
    natureza: "card",
    data: "2026-10-15",
    parcelado: true,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// A PERGUNTA DA ISSUE: O VALOR E DA PARCELA OU O TOTAL?
// ---------------------------------------------------------------------------

test("base 'parcela': o valor digitado e cada parcela, e o total e o multiplo", () => {
  const s = serieDeParcelas({
    valor: "100",
    base: "parcela",
    parcelaAtual: 1,
    totalDeParcelas: 10,
    vencimentoDaParcelaAtual: "2026-10-15",
  });

  assert.equal(s.valorDaParcela, 100);
  assert.equal(s.valorTotal, 1000);
  // Com base "parcela" NAO HA SOBRA: as 10 valem o mesmo, inclusive a ultima.
  assert.equal(s.parcelas.at(-1).valor, 100);
});

test("base 'total': o valor digitado e a compra inteira, e a parcela e a divisao", () => {
  const s = serieDeParcelas({
    valor: "100",
    base: "total",
    parcelaAtual: 1,
    totalDeParcelas: 10,
    vencimentoDaParcelaAtual: "2026-10-15",
  });

  assert.equal(s.valorDaParcela, 10);
  assert.equal(s.valorTotal, 100);
});

test("as duas bases NAO dao o mesmo resultado para o mesmo numero digitado", () => {
  // A assercao que mata o mutante "base trocada". As duas chamadas diferem SO na
  // base, e e por isso que ela nao passa por acidente: um `===` entre os dois
  // totais seria verde se a base fosse ignorada.
  const entrada = {
    valor: "1000",
    parcelaAtual: 1,
    totalDeParcelas: 10,
    vencimentoDaParcelaAtual: "2026-10-15",
  };

  const comoParcela = serieDeParcelas({ ...entrada, base: "parcela" });
  const comoTotal = serieDeParcelas({ ...entrada, base: "total" });

  assert.equal(comoParcela.valorTotal, 10000);
  assert.equal(comoTotal.valorTotal, 1000);
  // Dez vezes, exatamente -- e nao so "diferente".
  assert.equal(comoParcela.valorTotal, comoTotal.valorTotal * 10);
  assert.equal(comoParcela.valorDaParcela, 1000);
  assert.equal(comoTotal.valorDaParcela, 100);
});

// ---------------------------------------------------------------------------
// "EM QUAL PARCELA AQUELA SE REFERE DE QUANTAS NO TOTAL"
// ---------------------------------------------------------------------------

test("parcela 3 de 10 cria OITO parcelas, numeradas de 3 a 10", () => {
  const s = serieDeParcelas({
    valor: "100",
    base: "parcela",
    parcelaAtual: 3,
    totalDeParcelas: 10,
    vencimentoDaParcelaAtual: "2026-10-15",
  });

  assert.equal(s.parcelas.length, 8);
  assert.deepEqual(
    s.parcelas.map((p) => p.numero),
    [3, 4, 5, 6, 7, 8, 9, 10]
  );
  assert.equal(s.parcelasAnteriores, 2);
  // O total continua sendo o da COMPRA INTEIRA (10 x 100), e nao o das 8 que
  // vao ser gravadas. Somar 800 aqui faria a tela anunciar uma compra menor do
  // que a que a pessoa fez.
  assert.equal(s.valorTotal, 1000);
});

test("NEGACAO DA OPCAO (B): nenhuma parcela anterior a N e criada", () => {
  // A assercao mais importante do arquivo. Gravar as parcelas 1 e 2 -- ainda que
  // marcadas como pagas -- faria o app afirmar dois pagamentos que ninguem
  // registrou. Ver o cabecalho.
  for (const [n, m] of [
    [3, 10],
    [2, 2],
    [9, 10],
    [5, 12],
  ]) {
    const s = serieDeParcelas({
      valor: "100",
      base: "parcela",
      parcelaAtual: n,
      totalDeParcelas: m,
      vencimentoDaParcelaAtual: "2026-10-15",
    });

    assert.equal(s.parcelas.length, m - n + 1, `${n} de ${m}: quantas`);
    assert.ok(
      s.parcelas.every((p) => p.numero >= n),
      `${n} de ${m}: nenhuma parcela antes de ${n}`
    );
    assert.equal(
      s.parcelas.filter((p) => p.numero < n).length,
      0,
      `${n} de ${m}: contagem de parcelas anteriores gravadas`
    );
    // E a ULTIMA e sempre M -- a serie nao para antes do fim.
    assert.equal(s.parcelas.at(-1).numero, m, `${n} de ${m}: termina em M`);
  }
});

test("N e M invertidos sao RECUSADOS, nao reordenados em silencio", () => {
  // "parcela 10 de 3" e o erro de digitacao mais provavel da tela (os dois
  // campos ficam lado a lado). Devolver `null` e o que faz
  // `validarLancamento` produzir a frase que nomeia o campo certo; "consertar"
  // a ordem aqui gravaria uma serie que a pessoa nao pediu.
  assert.equal(
    serieDeParcelas({
      valor: "100",
      base: "parcela",
      parcelaAtual: 10,
      totalDeParcelas: 3,
      vencimentoDaParcelaAtual: "2026-10-15",
    }),
    null
  );

  // E o mutante "troca N por M" tambem morre aqui: com (3, 10) trocado para
  // (10, 3) a funcao devolveria null onde o teste acima exige 8 parcelas.
  assert.notEqual(
    serieDeParcelas({
      valor: "100",
      base: "parcela",
      parcelaAtual: 3,
      totalDeParcelas: 10,
      vencimentoDaParcelaAtual: "2026-10-15",
    }),
    null
  );
});

test("M menor que 2, N zero e valor nao-positivo nao formam serie", () => {
  const base = {
    valor: "100",
    base: "parcela",
    parcelaAtual: 1,
    totalDeParcelas: 10,
    vencimentoDaParcelaAtual: "2026-10-15",
  };

  assert.equal(serieDeParcelas({ ...base, totalDeParcelas: 1 }), null);
  assert.equal(serieDeParcelas({ ...base, totalDeParcelas: 0 }), null);
  assert.equal(serieDeParcelas({ ...base, totalDeParcelas: 61 }), null);
  assert.equal(serieDeParcelas({ ...base, parcelaAtual: 0 }), null);
  assert.equal(serieDeParcelas({ ...base, valor: "0" }), null);
  assert.equal(serieDeParcelas({ ...base, valor: "-100" }), null);
  assert.equal(serieDeParcelas({ ...base, valor: "" }), null);
  assert.equal(serieDeParcelas({ ...base, valor: "abc" }), null);
  // Nao-inteiro: 2,5 parcelas nao existe, e `Math.round` em silencio escolheria
  // 2 ou 3 sem a pessoa saber qual.
  assert.equal(serieDeParcelas({ ...base, totalDeParcelas: 2.5 }), null);
  assert.equal(serieDeParcelas({ ...base, parcelaAtual: 1.5 }), null);
});

// ---------------------------------------------------------------------------
// O CENTAVO
// ---------------------------------------------------------------------------

test("as parcelas criadas + as anteriores somam EXATAMENTE o total", () => {
  // O mutante "tira a sobra da ultima parcela" morre aqui: 3 x 333,33 = 999,99
  // e a diferenca de um centavo nao aparece em nenhuma linha.
  const casos = [
    { valor: "1000", m: 3 },
    { valor: "100", m: 3 },
    { valor: "0.10", m: 3 },
    { valor: "1000", m: 7 },
    { valor: "999.99", m: 11 },
    { valor: "1", m: 2 },
  ];

  for (const { valor, m } of casos) {
    const s = serieDeParcelas({
      valor,
      base: "total",
      parcelaAtual: 1,
      totalDeParcelas: m,
      vencimentoDaParcelaAtual: "2026-10-15",
    });

    const somaEmCentavos = s.parcelas.reduce(
      (acc, p) => acc + Math.round(p.valor * 100),
      0
    );
    assert.equal(
      somaEmCentavos,
      Math.round(s.valorTotal * 100),
      `${valor} em ${m}x: a soma das parcelas tem de fechar o total`
    );
  }
});

test("a sobra da divisao vai na ULTIMA parcela, e a ultima esta sempre na serie", () => {
  const s = serieDeParcelas({
    valor: "1000",
    base: "total",
    parcelaAtual: 1,
    totalDeParcelas: 3,
    vencimentoDaParcelaAtual: "2026-10-15",
  });

  assert.deepEqual(
    s.parcelas.map((p) => p.valor),
    [333.33, 333.33, 333.34]
  );

  // E com N > 1 a sobra continua na parcela M, que E criada -- se ela caisse
  // numa parcela que nao e gravada, o centavo sumiria de vez.
  const parcial = serieDeParcelas({
    valor: "1000",
    base: "total",
    parcelaAtual: 3,
    totalDeParcelas: 3,
    vencimentoDaParcelaAtual: "2026-10-15",
  });
  assert.deepEqual(
    parcial.parcelas.map((p) => p.valor),
    [333.34]
  );
});

test("valor com centavos nao vira ponto flutuante quebrado", () => {
  const s = serieDeParcelas({
    valor: "0.10",
    base: "parcela",
    parcelaAtual: 1,
    totalDeParcelas: 3,
    vencimentoDaParcelaAtual: "2026-10-15",
  });
  assert.equal(s.valorDaParcela, 0.1);
  assert.equal(s.valorTotal, 0.3);
  assert.deepEqual(
    s.parcelas.map((p) => p.valor),
    [0.1, 0.1, 0.1]
  );
});

test("R$ 19,99 em 3x: os centavos sao exatos, nao aproximados", () => {
  // O CASO QUE PRENDE OS CENTAVOS INTEIROS, e ele e especifico de proposito.
  //
  // `19.99 * 100` em ponto flutuante da 1998.9999999999998, nao 1999. Sem o
  // `Math.round` na entrada a divisao arrasta o residuo ate o fim e a ultima
  // parcela sai 6.669999999999998 -- um numero que nao e dinheiro, e que a
  // mascara da tela exibiria como "R$ 6,67" enquanto o banco guarda outra coisa.
  //
  // Por que NAO basta conferir a soma: a soma fecha nos dois casos (ela usa
  // `Math.round` para contar), entao o teste de total passa verde com o defeito
  // dentro. O que distingue e a igualdade EXATA de cada parcela.
  //
  // Valores que NAO servem para este teste, por colapsarem de volta no certo:
  // 0,10 / 8,11 / 1.234,56. Foi o mutante `conta_em_ponto_flutuante`
  // sobrevivendo que mostrou isso.
  const s = serieDeParcelas({
    valor: "19.99",
    base: "total",
    parcelaAtual: 1,
    totalDeParcelas: 3,
    vencimentoDaParcelaAtual: "2026-10-15",
  });

  assert.deepEqual(
    s.parcelas.map((p) => p.valor),
    [6.66, 6.66, 6.67]
  );
  assert.equal(s.valorTotal, 19.99);
  assert.equal(s.valorDaParcela, 6.66);

  // E o mesmo com outro valor da mesma familia, para nao depender de um numero
  // sortudo so.
  const outra = serieDeParcelas({
    valor: "70.07",
    base: "total",
    parcelaAtual: 1,
    totalDeParcelas: 3,
    vencimentoDaParcelaAtual: "2026-10-15",
  });
  assert.deepEqual(
    outra.parcelas.map((p) => p.valor),
    [23.36, 23.36, 23.35]
  );
  assert.equal(outra.valorTotal, 70.07);
});

test("a checkbox de parcelar existe SO no cartao", () => {
  // Vive tambem em test-lancamento.mjs, e e repetido aqui de proposito: o laco
  // de mutantes roda SO esta suite, e sem esta assercao o mutante que devolve a
  // checkbox para toda despesa sobrevive -- a tela voltaria a oferecer um
  // caminho que a rota recusa com 400.
  assert.equal(camposDoTipo("expense", "card", false).parcelamento, true);
  assert.equal(camposDoTipo("expense", "one_off", false).parcelamento, false);
  assert.equal(camposDoTipo("expense", "fixed", false).parcelamento, false);
  assert.equal(camposDoTipo("expense", "card", true).parcelamento, false);
  assert.equal(camposDoTipo("income", "card", false).parcelamento, false);
});

// ---------------------------------------------------------------------------
// OS VENCIMENTOS
// ---------------------------------------------------------------------------

test("os vencimentos andam um mes por parcela, a partir da parcela atual", () => {
  const s = serieDeParcelas({
    valor: "100",
    base: "parcela",
    parcelaAtual: 3,
    totalDeParcelas: 6,
    vencimentoDaParcelaAtual: "2026-10-15",
  });

  assert.deepEqual(
    s.parcelas.map((p) => p.vencimento),
    ["2026-10-15", "2026-11-15", "2026-12-15", "2027-01-15"]
  );
  // A PRIMEIRA e a data que a pessoa digitou, nao a da parcela 1. Somar meses
  // para tras aqui jogaria a compra em agosto.
  assert.equal(s.parcelas[0].vencimento, "2026-10-15");
});

test("somaMeses grampeia o dia no ultimo do mes, e viaja no calendario", () => {
  // 31 de janeiro + 1 mes e 28 de fevereiro, nao 3 de marco. Sem o grampo a
  // serie "pula" um mes e duas parcelas caem na mesma fatura.
  assert.equal(somaMeses("2026-01-31", 1), "2026-02-28");
  assert.equal(somaMeses("2024-01-31", 1), "2024-02-29"); // bissexto
  assert.equal(somaMeses("2026-01-31", 2), "2026-03-31");
  assert.equal(somaMeses("2026-03-31", 1), "2026-04-30");
  // Virada de ano, nos dois sentidos.
  assert.equal(somaMeses("2026-12-15", 1), "2027-01-15");
  assert.equal(somaMeses("2026-01-15", -1), "2025-12-15");
  assert.equal(somaMeses("2026-10-15", 0), "2026-10-15");
  assert.equal(somaMeses("2026-10-15", 12), "2027-10-15");
  // Nao-datas.
  assert.equal(somaMeses("", 1), null);
  assert.equal(somaMeses("2026-10", 1), null);
  assert.equal(somaMeses("15/10/2026", 1), null);
  assert.equal(somaMeses("2026-13-01", 1), null);
});

test("somaMeses nao depende do fuso da maquina", () => {
  // O sandbox roda em America/Sao_Paulo e o CI em UTC. Uma implementacao com
  // `new Date(iso).setMonth()` + `toISOString()` devolve o dia ANTERIOR a oeste
  // de Greenwich, entao o mesmo codigo passaria num e falharia no outro. A
  // aritmetica e de string: o resultado nao pode mudar com TZ.
  //
  // O proprio teste nao consegue trocar o fuso do processo depois do boot, mas
  // pode provar o que importa: a borda da meia-noite. Dia 1 e o unico dia que
  // um deslocamento negativo de fuso jogaria para o mes anterior.
  assert.equal(somaMeses("2026-10-01", 1), "2026-11-01");
  assert.equal(somaMeses("2026-01-01", -1), "2025-12-01");
  assert.equal(somaMeses("2026-03-01", 1), "2026-04-01");
  // E o ano no formato de 4 digitos, sem cair para 3.
  assert.match(somaMeses("2026-10-01", 1), /^\d{4}-\d{2}-\d{2}$/);
});

test("a serie com 60 parcelas tem 60 vencimentos distintos e consecutivos", () => {
  // O limite declarado. Uma serie longa e onde um off-by-one no laco aparece
  // como uma data repetida ou faltando.
  const s = serieDeParcelas({
    valor: "100",
    base: "parcela",
    parcelaAtual: 1,
    totalDeParcelas: 60,
    vencimentoDaParcelaAtual: "2026-01-15",
  });

  assert.equal(s.parcelas.length, 60);
  assert.equal(new Set(s.parcelas.map((p) => p.vencimento)).size, 60);
  assert.equal(s.parcelas.at(-1).vencimento, "2030-12-15");
});

// ---------------------------------------------------------------------------
// OS ROTULOS
// ---------------------------------------------------------------------------

test("a descricao gravada leva (N/M)", () => {
  assert.equal(descricaoDaParcela("Notebook", 3, 10), "Notebook (3/10)");
  // Espaco sobrando na digitacao nao vira "Notebook  (3/10)".
  assert.equal(descricaoDaParcela("  Notebook  ", 1, 2), "Notebook (1/2)");
});

test("rotuloDaParcela devolve null em vez de uma frase pela metade", () => {
  assert.equal(rotuloDaParcela(3, 10), "parcela 3 de 10");
  // Uma coluna sem a outra: "parcela 3 de " e pior que rotulo nenhum. Ha CHECK
  // no banco impedindo o par meio-preenchido, e isto e o cinto do lado da tela.
  assert.equal(rotuloDaParcela(3, null), null);
  assert.equal(rotuloDaParcela(null, 10), null);
  assert.equal(rotuloDaParcela(null, null), null);
  assert.equal(rotuloDaParcela(undefined, undefined), null);
  // N > M nao e rotulavel.
  assert.equal(rotuloDaParcela(12, 10), null);
  assert.equal(rotuloDaParcela(0, 10), null);
  assert.equal(rotuloDaParcela(1.5, 10), null);
});

test("o resumo da tela diz o total E quantas parcelas nao entram", () => {
  const serie = serieDeParcelas({
    valor: "100",
    base: "parcela",
    parcelaAtual: 3,
    totalDeParcelas: 10,
    vencimentoDaParcelaAtual: "2026-10-15",
  });

  const texto = resumoDaSerie(serie);
  // Os dois numeros que a pergunta "parcela ou total" decide, lado a lado.
  assert.match(texto, /10x de R\$ 100,00/);
  assert.match(texto, /total R\$ 1\.000,00/);
  // E A FRASE QUE TORNA A DECISAO (A) VISIVEL ANTES DE SALVAR.
  assert.match(texto, /8 parcelas/);
  assert.match(texto, /2 anteriores não entram/);

  // Numa serie que comeca na 1 nao ha anteriores, e a frase nao aparece --
  // dizer "as 0 anteriores nao entram" sugeriria que algo ficou de fora.
  const doZero = resumoDaSerie(
    serieDeParcelas({
      valor: "100",
      base: "parcela",
      parcelaAtual: 1,
      totalDeParcelas: 10,
      vencimentoDaParcelaAtual: "2026-10-15",
    })
  );
  assert.doesNotMatch(doZero, /anteriores/);
  assert.match(doZero, /10 parcelas/);

  // Sem serie nao ha resumo: um "10x de R$ 0,00" se le como resposta.
  assert.equal(resumoDaSerie(null), null);
});

test("o resumo formata o real sem depender do locale do Node", () => {
  // Ha Node sem full-icu, onde `toLocaleString("pt-BR")` devolve o formato
  // en-US ("R$1,000.00") -- o mesmo codigo passaria numa maquina e falharia na
  // outra. A formatacao e a mao.
  const texto = resumoDaSerie(
    serieDeParcelas({
      valor: "1234567.89",
      base: "total",
      parcelaAtual: 1,
      totalDeParcelas: 2,
      vencimentoDaParcelaAtual: "2026-10-15",
    })
  );
  assert.match(texto, /R\$ 1\.234\.567,89/);
  assert.doesNotMatch(texto, /1,234,567/);
});

// ---------------------------------------------------------------------------
// A VALIDACAO, E O DESTINO
// ---------------------------------------------------------------------------

test("o Salvar nomeia o campo errado quando N e M estao invertidos", () => {
  const r = validarLancamento(
    "expense",
    noCartao({ parcelaAtual: "12", totalDeParcelas: "10" }),
    { categoria: CATEGORIA_DESPESA, editando: false }
  );
  assert.equal(r.ok, false);
  // A frase fala da PARCELA ATUAL e do limite, nao do valor -- sem isto o
  // usuario arrumaria o campo certo pelo motivo errado.
  assert.match(r.mensagem, /parcela atual/i);
  assert.match(r.mensagem, /entre 1 e 10/);
});

test("o Salvar recusa serie sem data, pela recusa generica de data", () => {
  // A frase vem do bloco de datas, que roda ANTES do ramo de parcelas -- e e
  // por isso que nao ha uma segunda checagem de data dentro do ramo. Este teste
  // existe para que a remocao daquela guarda generica apareca aqui, e nao so
  // numa tela sem parcelamento.
  const r = validarLancamento(
    "expense",
    noCartao({ data: "", totalDeParcelas: "3" }),
    { categoria: CATEGORIA_DESPESA, editando: false }
  );
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /informe a data/i);
});

test("uma serie valida vai para o destino 'parcelas'", () => {
  const valores = noCartao({ parcelaAtual: "3", totalDeParcelas: "10" });
  assert.equal(
    validarLancamento("expense", valores, {
      categoria: CATEGORIA_DESPESA,
      editando: false,
    }).ok,
    true
  );
  assert.equal(destinoDoLancamento("expense", valores, false), "parcelas");
});

test("o limite de 60 parcelas e cobrado com a frase, nao com o null", () => {
  const r = validarLancamento("expense", noCartao({ totalDeParcelas: "61" }), {
    categoria: CATEGORIA_DESPESA,
    editando: false,
  });
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /60 parcelas/);
});

// ---------------------------------------------------------------------------
// O CAMPO VAZIO TEM FRASE PROPRIA (HMO-226)
// ---------------------------------------------------------------------------
// O fallback `|| 1` que a issue removeu nao so impedia o Backspace: ele
// TRADUZIA o vazio para 1, e a pessoa recebia "o total de parcelas deve ser 2 ou
// mais" sobre um 1 que ela nao digitou. E a mentira que estes testes impedem de
// voltar -- e repor o fallback os deixa vermelhos pela MENSAGEM, nao pelo `ok`.

test("o total de parcelas em branco e recusado com frase propria, nao com '2 ou mais'", () => {
  const r = validarLancamento("expense", noCartao({ totalDeParcelas: "" }), {
    categoria: CATEGORIA_DESPESA,
    editando: false,
  });
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /informe em quantas parcelas/i);
  assert.doesNotMatch(
    r.mensagem,
    /2 ou mais/i,
    "o campo vazio voltou a ser tratado como 1"
  );
});

test("a parcela atual em branco e recusada com frase propria, nao com 'entre 1 e M'", () => {
  const r = validarLancamento(
    "expense",
    noCartao({ parcelaAtual: "", totalDeParcelas: "10" }),
    { categoria: CATEGORIA_DESPESA, editando: false }
  );
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /informe qual parcela/i);
  assert.doesNotMatch(
    r.mensagem,
    /entre 1 e/i,
    "o campo vazio voltou a ser tratado como um numero fora do intervalo"
  );
});

test("parcelaDigitada nao inventa numero onde nao ha", () => {
  // A BORDA UNICA entre o texto do campo e o N/M. Cada caso aqui e uma conversao
  // pronta que ERRA: `Number("")` e `Number(" ")` valem 0 -- um inteiro que
  // passaria por `Number.isInteger` e chegaria ao banco como uma quantidade de
  // parcelas --, e `parseInt` le o prefixo e descarta o resto ("6x" -> 6).
  for (const texto of ["", " ", "6x", "1.5", "1e3", "-2", "abc", "."]) {
    assert.equal(
      Number.isNaN(parcelaDigitada(texto)),
      true,
      `parcelaDigitada(${JSON.stringify(texto)}) devolveu um numero`
    );
  }
  assert.equal(parcelaDigitada("6"), 6);
  assert.equal(parcelaDigitada(" 10 "), 10);
  // "06" vale 6: zero a esquerda e digitacao, nao outra quantidade.
  assert.equal(parcelaDigitada("06"), 6);
});

test("valoresIniciais abre sem parcelamento e com a base de parcela", () => {
  const v = valoresIniciais();
  assert.equal(v.parcelado, false);
  assert.equal(v.baseDoValorParcelado, "parcela");
  // TEXTO, e nao numero (HMO-226): e o que permite o campo ficar vazio
  // enquanto a pessoa digita. Ver `parcelaAtual` em lib/lancamento.ts.
  assert.equal(v.parcelaAtual, "1");
  assert.equal(v.totalDeParcelas, "1");
  // O campo de data proprio do bloco antigo ("Primeira Parcela") NAO existe
  // mais: a data e a da compra, que ja esta na tela desde a HMO-209.
  assert.equal("primeiroVencimento" in v, false);
});
