// =========================================================
// PULODOGATO -- a calculadora dos tres campos do emprestimo (HMO-446)
// =========================================================
//   npm run test:juros-do-emprestimo
//
// Roda o JS compilado de lib/juros-do-emprestimo.ts. Aquele modulo nao importa
// nada, entao nao ha passo de resolve-aliases aqui.
//
// TODO VALOR ESPERADO DESTE ARQUIVO E CRAVADO, CALCULADO A MAO
// ------------------------------------------------------------
// Nenhuma assercao recalcula o esperado com a formula da lib. Um conferidor que
// usa o mesmo extrator nos dois lados passa vacuo -- ele concorda com qualquer
// aritmetica, inclusive com `(1 - taxa)`. Entao os totais abaixo saem de conta
// feita a mao em centavos inteiros:
//
//   1000,00 a 20%    -> 100000 x 1,2    = 120000       -> 1200,00
//   1000,33 a 20%    -> 100033 x 1,2    = 120039,6     -> 120040 -> 1200,40
//   999,99 a 7,5%    ->  99999 x 1,075  = 107498,925   -> 107499 -> 1074,99
//   7777,77 a 8,25%  -> 777777 x 1,0825 = 841943,6025  -> 841944 -> 8419,44
//
// O CONTROLE QUE MATA O MUTANTE DA ISSUE
// --------------------------------------
// `(1 + taxa)` trocado por `(1 - taxa)` da 800,00 onde o certo e 1200,00. Toda
// assercao de total cravado o mata, mas a que o mata POR SIGNIFICADO e
// `total > principal`: ela diz que emprestar a juros nao pode devolver menos do
// que saiu. Sem ela, um esperado digitado errado no teste absolveria o mutante.
//
// E O CONTROLE QUE MATA A FALTA DE ABSORCAO DO CENTAVO
// ----------------------------------------------------
// E uma assercao de SOMA, nunca uma de parcela individual: 12 rateios de
// R$ 100,00 num emprestimo de 1000/1200 dao 83,33 cada, e 12 x 83,33 = 999,96.
// Cada linha parece certa; o que esta errado e o total, e sao 4 centavos de
// principal que nenhuma linha explica.
// =========================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  CASAS_DA_TAXA,
  CONVENCAO_DO_JURO,
  PRINCIPAL_DO_IDA_E_VOLTA_EXATO,
  TAXA_MAXIMA,
  jurosDoEmprestimo,
  mensagemDoProblemaDoJuro,
  problemaDoJuro,
  rateioDaParcela,
  rateioDaSerie,
  taxaDoEmprestimo,
  taxaMensalEquivalente,
  totalDoEmprestimo,
  tresCamposDoEmprestimo,
} = await import("../.tmp-juros-do-emprestimo/juros-do-emprestimo.js");

/**
 * Dinheiro em centavos inteiros, para TODA soma deste arquivo.
 *
 * A lib devolve reais com 2 casas exatas, mas SOMAR dois desses floats
 * reintroduz o erro: `200.07 + 1000.33` da 1200.3999999999999, e
 * `83.33 + 16.67` da 100.00000000000001. Uma assercao de soma em float e um
 * `assercao-que-mente` nos dois sentidos -- ela reprova aritmetica certa e,
 * com tolerancia frouxa, absolve a errada.
 */
function emCentavos(valor) {
  return Math.round(valor * 100);
}

// ---------------------------------------------------------
// O SENTIDO DIRETO: emprestado + taxa -> total
// ---------------------------------------------------------

/** [principal, taxa, total] -- os totais sao conta a mao, ver o cabecalho. */
const DIRETOS = [
  [1000, 0.2, 1200],
  [1000, 0, 1000],
  [1000, 0.015, 1015],
  [1000, 0.205, 1205],
  [2500, 0.1, 2750],
  [3000, 0.333, 3999],
  [500, 0.5, 750],
  [24000, 0.18, 28320],
  [1234.56, 0.125, 1388.88],
  [1000.33, 0.2, 1200.4],
  [999.99, 0.075, 1074.99],
  [7777.77, 0.0825, 8419.44],
  [12345.67, 0.205, 14876.53],
  [1000000, 0.015, 1015000],
];

test("o total sai de principal x (1 + taxa), em centavos inteiros", () => {
  for (const [principal, taxa, esperado] of DIRETOS) {
    assert.equal(
      totalDoEmprestimo({ principal, taxa }),
      esperado,
      `${principal} a ${taxa}`
    );
  }
});

test("MUTANTE (1 - taxa): o total nunca e menor que o principal", () => {
  // A assercao por SIGNIFICADO, independente dos esperados cravados acima.
  for (const [principal, taxa] of DIRETOS) {
    const total = totalDoEmprestimo({ principal, taxa });
    assert.ok(
      total >= principal,
      `${principal} a ${taxa} devolveu ${total}, menor que o emprestado`
    );
    if (taxa > 0) {
      assert.ok(
        total > principal,
        `${principal} a ${taxa} nao rendeu juro nenhum (${total})`
      );
    }
  }
});

test("o caso canonico da issue: R$ 1.000 a 20% sao R$ 1.200", () => {
  assert.equal(totalDoEmprestimo({ principal: 1000, taxa: 0.2 }), 1200);
  // E o 800 do mutante NAO e o que sai daqui.
  assert.notEqual(totalDoEmprestimo({ principal: 1000, taxa: 0.2 }), 800);
});

// ---------------------------------------------------------
// O SENTIDO INVERSO: emprestado + total -> taxa
// ---------------------------------------------------------

test("a taxa sai de total / principal - 1", () => {
  assert.equal(taxaDoEmprestimo({ principal: 1000, total: 1200 }), 0.2);
  assert.equal(taxaDoEmprestimo({ principal: 1000, total: 1000 }), 0);
  assert.equal(taxaDoEmprestimo({ principal: 2500, total: 2750 }), 0.1);
  assert.equal(taxaDoEmprestimo({ principal: 500, total: 750 }), 0.5);
  assert.equal(taxaDoEmprestimo({ principal: 24000, total: 28320 }), 0.18);
});

test("MUTANTE sem o `- 1`: a taxa de um emprestimo a juro zero e 0, nao 1", () => {
  assert.equal(taxaDoEmprestimo({ principal: 1000, total: 1000 }), 0);
  // 1.2 seria o fator, nao a taxa. A diferenca e "cobro 20%" virar "cobro 120%".
  assert.notEqual(taxaDoEmprestimo({ principal: 1000, total: 1200 }), 1.2);
});

// ---------------------------------------------------------
// O IDA-E-VOLTA, QUE E O CONTROLE NEGATIVO DA ISSUE
// ---------------------------------------------------------

test("ida-e-volta taxa -> total -> taxa fecha EXATO nos 14 pares", () => {
  // 14 pares, acima da duzia que a issue pede, e eles incluem de proposito:
  //   centavo quebrado no principal  -- 1000,33 / 999,99 / 7777,77 / 12345,67
  //   taxa de 3 casas                -- 0,205 / 0,333 / 0,015 / 0,0825
  assert.ok(DIRETOS.length >= 12, "a issue pede ao menos uma duzia de pares");

  const comCentavoQuebrado = DIRETOS.filter(
    ([p]) => Math.round(p * 100) % 100 !== 0
  );
  assert.ok(
    comCentavoQuebrado.length >= 4,
    "os pares precisam incluir principal com centavo quebrado"
  );

  const comTresCasas = DIRETOS.filter(([, t]) => {
    const s = String(t).split(".")[1] ?? "";
    return s.length >= 3;
  });
  assert.ok(
    comTresCasas.length >= 4,
    "os pares precisam incluir taxa de 3 casas ou mais"
  );

  for (const [principal, taxa] of DIRETOS) {
    const total = totalDoEmprestimo({ principal, taxa });
    const volta = taxaDoEmprestimo({ principal, total });
    assert.equal(
      volta,
      taxa,
      `${principal} a ${taxa} -> total ${total} -> voltou ${volta}`
    );
  }
});

test("ida-e-volta total -> taxa -> total: o DINHEIRO nunca anda", () => {
  // Este e o lado do ida-e-volta que protege centavo, e ele vale para TODO
  // principal, inclusive abaixo de R$ 100: quem digitou o total ve o total que
  // digitou. A taxa e que pode ser arredondada, nunca o dinheiro.
  const totais = [
    [1000, 1200],
    [1000.33, 1200.4],
    [50, 62.5],
    [10, 12],
    [99.94, 129.92],
    [333.33, 444.33],
    [7777.77, 8419.44],
  ];
  for (const [principal, total] of totais) {
    const taxa = taxaDoEmprestimo({ principal, total });
    // EM CENTAVOS. Somar os dois floats de 2 casas reintroduz o erro que a lib
    // evitou: 200.07 + 1000.33 da 1200.3999999999999 em ponto flutuante.
    assert.equal(
      emCentavos(jurosDoEmprestimo({ principal, total })) +
        emCentavos(principal),
      emCentavos(total),
      `o juro de ${principal}/${total} nao fecha com o total`
    );
    assert.ok(taxa !== null, `${principal}/${total} devolveu taxa nula`);
  }
});

test("CASAS_DA_TAXA = 4 e o que faz o ida-e-volta fechar (controle da constante)", () => {
  assert.equal(CASAS_DA_TAXA, 4);

  // O CONTROLE NEGATIVO DA CONSTANTE: com 6 casas o ida-e-volta QUEBRA nestes
  // pares -- medido por varredura. Se um dia alguem "melhorar a precisao" para
  // 6, o teste de cima fica vermelho; este afirma que a diferenca e real e nao
  // uma escolha arbitraria, calculando a 6a casa aqui, a mao.
  const quebramEm6Casas = [
    [1000.33, 0.2],
    [999.99, 0.075],
    [7777.77, 0.0825],
    [333.33, 0.333],
  ];
  for (const [principal, taxa] of quebramEm6Casas) {
    const total = totalDoEmprestimo({ principal, taxa });
    const em6 =
      Math.round(
        (Math.round(total * 100) / Math.round(principal * 100) - 1) * 1e6
      ) / 1e6;
    assert.notEqual(
      em6,
      taxa,
      `${principal} a ${taxa} fecharia em 6 casas -- o par nao serve de controle`
    );
    // E em 4 casas o mesmo par fecha.
    assert.equal(taxaDoEmprestimo({ principal, total }), taxa);
  }
});

test("PRINCIPAL_DO_IDA_E_VOLTA_EXATO = 100 e o piso medido", () => {
  assert.equal(PRINCIPAL_DO_IDA_E_VOLTA_EXATO, 100);

  // Acima do piso, em centavos quebrados, o ida-e-volta fecha. A varredura que
  // produziu o numero vive no cabecalho da lib; aqui ficam as bordas.
  for (const principal of [100, 100.01, 100.07, 123.45, 999.99]) {
    for (const taxa of [0.2, 0.0825, 0.333, 0.015]) {
      const total = totalDoEmprestimo({ principal, taxa });
      assert.equal(
        taxaDoEmprestimo({ principal, total }),
        taxa,
        `${principal} a ${taxa} falhou acima do piso`
      );
    }
  }
});

// ---------------------------------------------------------
// O JURO EM REAIS
// ---------------------------------------------------------

test("o juro em reais e total - principal, e fecha com as parcelas", () => {
  assert.equal(jurosDoEmprestimo({ principal: 1000, total: 1200 }), 200);
  assert.equal(jurosDoEmprestimo({ principal: 1000, total: 1000 }), 0);
  assert.equal(jurosDoEmprestimo({ principal: 1000.33, total: 1200.4 }), 200.07);
  assert.equal(jurosDoEmprestimo({ principal: 999.99, total: 1074.99 }), 75);
});

test("MUTANTE de sinal no juro: ele nunca e negativo", () => {
  for (const [principal, taxa, total] of DIRETOS) {
    const juro = jurosDoEmprestimo({ principal, total });
    assert.ok(juro >= 0, `${principal}/${total} deu juro ${juro}`);
    if (taxa > 0) assert.ok(juro > 0, `${principal} a ${taxa} deu juro ${juro}`);
  }
});

// ---------------------------------------------------------
// A TAXA MENSAL EQUIVALENTE -- linha informativa
// ---------------------------------------------------------

test("20% em 12x equivalem a ~1,53% ao mes (capitalizada, nao dividida)", () => {
  const mensal = taxaMensalEquivalente({ taxa: 0.2, parcelas: 12 });
  // 1,2 ^ (1/12) - 1 = 0,0153094...  Cravado em 4 casas.
  assert.equal(Math.round(mensal * 1e4) / 1e4, 0.0153);

  // O CONTROLE QUE MATA `taxa / parcelas`: a divisao daria 0,016667, que faz o
  // emprestimo parecer mais caro do que e. A capitalizada e ESTRITAMENTE menor.
  assert.ok(
    mensal < 0.2 / 12,
    `a mensal ${mensal} nao e menor que a divisao simples ${0.2 / 12}`
  );
  // E ela compoe de volta no total: (1 + mensal)^12 - 1 = 0,20.
  assert.equal(Math.round((Math.pow(1 + mensal, 12) - 1) * 1e4) / 1e4, 0.2);
});

test("a mensal de juro zero e zero, e de 1 parcela e a propria taxa", () => {
  assert.equal(taxaMensalEquivalente({ taxa: 0, parcelas: 12 }), 0);
  assert.equal(taxaMensalEquivalente({ taxa: 0.2, parcelas: 1 }), 0.2);
});

test("a mensal recusa parcelas que nao sao mes nenhum", () => {
  assert.equal(taxaMensalEquivalente({ taxa: 0.2, parcelas: 0 }), null);
  assert.equal(taxaMensalEquivalente({ taxa: 0.2, parcelas: -3 }), null);
  assert.equal(taxaMensalEquivalente({ taxa: 0.2, parcelas: 1.5 }), null);
  assert.equal(taxaMensalEquivalente({ taxa: -0.1, parcelas: 12 }), null);
});

// ---------------------------------------------------------
// O RATEIO -- principal que volta x juro ganho
// ---------------------------------------------------------

test("o rateio de uma parcela e proporcional", () => {
  // 100,00 de um 1000/1200: 10000 x 100000 / 120000 = 8333,33 -> 8333.
  const r = rateioDaParcela({ amount: 100, principal: 1000, total: 1200 });
  assert.deepEqual(r, { parteDoPrincipal: 83.33, parteDosJuros: 16.67 });

  // As duas partes somam a parcela, sempre -- o juro nao se inventa nem some.
  assert.equal(emCentavos(r.parteDoPrincipal) + emCentavos(r.parteDosJuros), 10000);
});

test("sem juro, a parcela e toda principal (nenhuma receita aparece)", () => {
  const r = rateioDaParcela({ amount: 100, principal: 1200, total: 1200 });
  assert.deepEqual(r, { parteDoPrincipal: 100, parteDosJuros: 0 });
});

test("A SOMA DO RATEIO DA SERIE FECHA EXATO -- principal e juro", () => {
  /** [principal, total, parcelas] -- series que somam o total por construcao. */
  const series = [
    [1000, 1200, Array(12).fill(100)],
    // 1200 em 7x: round(120000/7) = 17143, e a ultima fecha: 120000 - 6x17143.
    [1000, 1200, [171.43, 171.43, 171.43, 171.43, 171.43, 171.43, 171.42]],
    [1000.33, 1200.4, [400.14, 400.13, 400.13]],
    [999.99, 1074.99, [537.5, 537.49]],
    [24000, 28320, Array(24).fill(1180)],
    [3000, 3999, [1333, 1333, 1333]],
    [7777.77, 8419.44, Array(6).fill(1403.24)],
    [1000, 1000, Array(10).fill(100)],
  ];

  for (const [principal, total, parcelas] of series) {
    const rateio = rateioDaSerie({ parcelas, principal, total });
    assert.ok(rateio !== null, `${principal}/${total} em ${parcelas.length}x`);
    assert.equal(rateio.length, parcelas.length);

    // EM CENTAVOS: somar floats de 2 casas reintroduz o erro que a lib evitou.
    const somaPrincipal = rateio.reduce(
      (a, r) => a + Math.round(r.parteDoPrincipal * 100),
      0
    );
    const somaJuros = rateio.reduce(
      (a, r) => a + Math.round(r.parteDosJuros * 100),
      0
    );

    assert.equal(
      somaPrincipal,
      Math.round(principal * 100),
      `a soma do principal de ${principal}/${total} nao fecha`
    );
    assert.equal(
      somaJuros,
      Math.round(total * 100) - Math.round(principal * 100),
      `a soma do juro de ${principal}/${total} nao fecha`
    );
    // E cada parcela continua somando ela mesma.
    rateio.forEach((r, i) => {
      assert.equal(
        Math.round(r.parteDoPrincipal * 100) + Math.round(r.parteDosJuros * 100),
        Math.round(parcelas[i] * 100),
        `a parcela ${i + 1} de ${principal}/${total} nao fecha`
      );
      assert.ok(r.parteDoPrincipal >= 0 && r.parteDosJuros >= 0);
    });
  }
});

test("MUTANTE sem absorcao: a ULTIMA parcela carrega a sobra", () => {
  const rateio = rateioDaSerie({
    parcelas: Array(12).fill(100),
    principal: 1000,
    total: 1200,
  });

  // As 11 primeiras sao 83,33; a ultima e 83,37 -- 4 centavos a mais, que e
  // exatamente o que 12 x 83,33 perde (999,96 em vez de 1000,00).
  for (let i = 0; i < 11; i++) {
    assert.equal(rateio[i].parteDoPrincipal, 83.33, `parcela ${i + 1}`);
  }
  assert.equal(rateio[11].parteDoPrincipal, 83.37);
  assert.equal(rateio[11].parteDosJuros, 16.63);

  // A assercao que mata o mutante por SIGNIFICADO, e nao pelo 83,37 cravado:
  // sem absorcao a soma daria 999,96, e nenhuma linha diria por que.
  const soma = rateio.reduce(
    (a, r) => a + Math.round(r.parteDoPrincipal * 100),
    0
  );
  assert.equal(soma, 100000);
  assert.notEqual(soma, 99996);
});

test("o rateio recusa serie que nao soma o total", () => {
  // OS DOIS CASOS QUE MEDEM A GUARDA DE SOMA, E SO ELA
  //
  // Medido: nos casos "obvios" (soma MENOR que o total) a recusa vem da guarda
  // de parte-principal negativa, la embaixo -- a soma que falta e jogada na
  // ultima parcela e estoura o valor dela. Entao aqueles casos NAO distinguem
  // a guarda de soma: tira-la do codigo e eles continuam devolvendo `null`, e o
  // mutante sobrevive (`filtro-a-jusante-torna-o-porteiro-inobservavel`).
  //
  // Quem a torna observavel e a soma MAIOR que o total, porque ai a absorcao da
  // ultima parcela ENCOLHE e passa pela guarda de baixo:
  //
  //   13 x 100 com 1000/1200 -> soma dos juros 300,00 onde o certo e 200,00,
  //     e a ultima parcela fica com 4 centavos de principal e 99,96 de juro
  //   12 x 100 com 1000/1150 -> soma dos juros 200,00 onde o certo e 150,00
  //
  // Nos dois a soma do PRINCIPAL continua fechando (a absorcao garante isso),
  // entao o unico sintoma e o juro -- o numero que a tela mostra como ganho e
  // que a F5 gravaria como `income`.
  assert.equal(
    rateioDaSerie({ parcelas: Array(13).fill(100), principal: 1000, total: 1200 }),
    null,
    "13 x 100 nao soma 1200 -- o juro sairia 300 em vez de 200"
  );
  assert.equal(
    rateioDaSerie({ parcelas: Array(12).fill(100), principal: 1000, total: 1150 }),
    null,
    "12 x 100 nao soma 1150 -- o juro sairia 200 em vez de 150"
  );

  // E os casos de soma MENOR, que a guarda de baixo tambem pega. Ficam porque
  // a recusa e a resposta certa para eles de qualquer jeito.
  assert.equal(
    rateioDaSerie({ parcelas: Array(12).fill(100), principal: 1000, total: 1250 }),
    null
  );
  assert.equal(
    rateioDaSerie({ parcelas: [100, 100], principal: 1000, total: 1200 }),
    null
  );
  assert.equal(
    rateioDaSerie({ parcelas: [], principal: 1000, total: 1200 }),
    null
  );
  assert.equal(
    rateioDaSerie({ parcelas: [600, 0, 600], principal: 1000, total: 1200 }),
    null
  );
});

test("o rateio recusa a cauda de centavos em que a absorcao estouraria", () => {
  // 60 parcelas cujo fim e um centavo: a sobra acumulada nao cabe na ultima, e
  // a parte-principal dela ficaria negativa -- perna `transfer` de sinal
  // trocado. `mybank_installments_amount_check` aceita amount = 0,01 e 60x e o
  // teto de `serieDeParcelas`, entao o estado e alcancavel.
  const parcelas = [...Array(59).fill(0.02), 0.01];
  const total = parcelas.reduce((a, b) => a + Math.round(b * 100), 0) / 100;
  const r = rateioDaSerie({ parcelas, principal: total - 0.5, total });
  // Ou recusa, ou fecha -- o que NAO pode e devolver parte negativa.
  if (r !== null) {
    for (const p of r) {
      assert.ok(
        p.parteDoPrincipal >= 0 && p.parteDosJuros >= 0,
        `parte negativa: ${JSON.stringify(p)}`
      );
    }
  }
});

// ---------------------------------------------------------
// AS RECUSAS, cada uma com frase propria
// ---------------------------------------------------------

test("principal <= 0 e recusa (o caso que a issue nomeia)", () => {
  assert.equal(problemaDoJuro({ principal: 0, taxa: 0.2 }), "principal_nao_positivo");
  assert.equal(problemaDoJuro({ principal: -1000, taxa: 0.2 }), "principal_nao_positivo");
  assert.equal(problemaDoJuro({ principal: 0.004, taxa: 0.2 }), "principal_nao_positivo");

  // E as funcoes devolvem `null` em vez de Infinity / NaN.
  assert.equal(taxaDoEmprestimo({ principal: 0, total: 1200 }), null);
  assert.equal(totalDoEmprestimo({ principal: 0, taxa: 0.2 }), null);
  assert.equal(jurosDoEmprestimo({ principal: 0, total: 1200 }), null);
});

test("taxa negativa e recusa, e a frase diz como emprestar sem juros", () => {
  assert.equal(problemaDoJuro({ principal: 1000, taxa: -0.1 }), "taxa_negativa");
  assert.equal(totalDoEmprestimo({ principal: 1000, taxa: -0.1 }), null);
  assert.match(mensagemDoProblemaDoJuro("taxa_negativa"), /zero/);
  // Zero NAO e recusa -- e o emprestimo a juro zero, que ja existia.
  assert.equal(problemaDoJuro({ principal: 1000, taxa: 0 }), null);
});

test("total menor que o principal e recusa, com os dois lados na frase", () => {
  assert.equal(
    problemaDoJuro({ principal: 1000, total: 900 }),
    "total_menor_que_o_principal"
  );
  assert.equal(taxaDoEmprestimo({ principal: 1000, total: 900 }), null);
  assert.equal(jurosDoEmprestimo({ principal: 1000, total: 900 }), null);
  // Um centavo a menos ja e recusa: o juro negativo da F5 gravaria receita
  // negativa, e ela nao tem tamanho minimo.
  assert.equal(
    problemaDoJuro({ principal: 1000, total: 999.99 }),
    "total_menor_que_o_principal"
  );
  // Igual NAO e recusa.
  assert.equal(problemaDoJuro({ principal: 1000, total: 1000 }), null);
});

test("taxa absurda e recusa pelos DOIS campos", () => {
  assert.equal(problemaDoJuro({ principal: 1000, taxa: 11 }), "taxa_absurda");
  assert.equal(problemaDoJuro({ principal: 1000, total: 50000 }), "taxa_absurda");
  // O teto exato passa -- a recusa e acima dele.
  assert.equal(problemaDoJuro({ principal: 1000, taxa: TAXA_MAXIMA }), null);
  assert.equal(problemaDoJuro({ principal: 1000, total: 11000 }), null);
});

test("valor ilegivel e recusa", () => {
  assert.equal(problemaDoJuro({ principal: NaN, taxa: 0.2 }), "valor_ilegivel");
  assert.equal(problemaDoJuro({ principal: Infinity, taxa: 0.2 }), "valor_ilegivel");
  assert.equal(problemaDoJuro({ principal: 1000, taxa: NaN }), "valor_ilegivel");
  assert.equal(problemaDoJuro({ principal: 1000, total: NaN }), "valor_ilegivel");
});

test("sem taxa nem total e recusa propria", () => {
  assert.equal(problemaDoJuro({ principal: 1000 }), "sem_taxa_nem_total");
  assert.equal(problemaDoJuro({ principal: 1000, taxa: null }), "sem_taxa_nem_total");
});

test("cada recusa tem frase PROPRIA, e nenhuma e vazia", () => {
  const problemas = [
    "principal_nao_positivo",
    "valor_ilegivel",
    "taxa_negativa",
    "taxa_absurda",
    "total_menor_que_o_principal",
    "sem_taxa_nem_total",
  ];
  const frases = problemas.map((p) => mensagemDoProblemaDoJuro(p));
  for (const f of frases) {
    assert.equal(typeof f, "string");
    assert.ok(f.trim().length > 10, `frase curta demais: ${f}`);
  }
  // PROPRIA: seis problemas, seis frases distintas. Duas iguais fariam a tela
  // dizer a mesma coisa para erros que pedem consertos diferentes.
  assert.equal(new Set(frases).size, problemas.length);
});

// ---------------------------------------------------------
// OS DOIS SENTIDOS NUM LUGAR SO -- o que o formulario da F3 chama
// ---------------------------------------------------------

test("os dois sentidos chegam nas MESMAS quatro grandezas", () => {
  // O que a issue pede literalmente: digitar 1000 + 20% e digitar 1000 + total
  // 1200 tem de mostrar a mesma previa.
  const porTaxa = tresCamposDoEmprestimo({ principal: 1000, taxa: 0.2 });
  const porTotal = tresCamposDoEmprestimo({ principal: 1000, total: 1200 });

  assert.deepEqual(porTaxa, {
    principal: 1000,
    taxa: 0.2,
    total: 1200,
    juros: 200,
  });
  assert.deepEqual(porTotal, porTaxa);
});

test("os dois sentidos concordam tambem com centavo quebrado", () => {
  for (const [principal, taxa, total] of DIRETOS) {
    if (principal < PRINCIPAL_DO_IDA_E_VOLTA_EXATO) continue;
    const porTaxa = tresCamposDoEmprestimo({ principal, taxa });
    const porTotal = tresCamposDoEmprestimo({ principal, total });
    assert.deepEqual(
      porTotal,
      porTaxa,
      `${principal} a ${taxa} discorda entre os dois sentidos`
    );
    assert.equal(porTaxa.total, total);
    assert.equal(
      emCentavos(porTaxa.juros) + emCentavos(porTaxa.principal),
      emCentavos(total)
    );
  }
});

test("taxa E total juntos sao recusados (eles podem discordar)", () => {
  assert.equal(
    tresCamposDoEmprestimo({ principal: 1000, taxa: 0.2, total: 1500 }),
    null
  );
  // Inclusive quando concordam: aceitar aqui seria aceitar a forma, e a
  // proxima chamada mandaria os dois discordando sem nada reclamar.
  assert.equal(
    tresCamposDoEmprestimo({ principal: 1000, taxa: 0.2, total: 1200 }),
    null
  );
});

test("a previa recusa o que as recusas recusam", () => {
  assert.equal(tresCamposDoEmprestimo({ principal: 0, taxa: 0.2 }), null);
  assert.equal(tresCamposDoEmprestimo({ principal: 1000, taxa: -0.1 }), null);
  assert.equal(tresCamposDoEmprestimo({ principal: 1000, total: 900 }), null);
  assert.equal(tresCamposDoEmprestimo({ principal: 1000 }), null);
});

test("a convencao esta nomeada, e e a da interest_kind da 060", () => {
  // D2: a convencao vai GRAVADA na linha, nao inferida do nome da coluna.
  assert.equal(CONVENCAO_DO_JURO, "total_simples");
});
