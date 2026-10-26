#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DO REBALANCEAMENTO DA CARTEIRA
// =====================================================
//   npm run test:rebalanceamento
//
// Exercita lib/rebalanceamento.ts. Mesmo desenho do test-investments.mjs: .mjs
// rodando o JS que o tsc emitiu, sem runner de teste novo.
//
// O fixture principal e a aba Controle da planilha "Rebalanceamento de
// Carteira" do Helio, com os numeros dela. Os valores esperados sao os que o
// Excel calculou naquela planilha (lidos do arquivo, nao da saida desta
// funcao), com UMA diferenca declarada: a base. La ela e o "Valor na
// Corretora" digitado (M3); aqui e o valor dos ativos mais o aporte. O teste
// "a conta e a da planilha" iguala as duas passando como aporte exatamente a
// diferenca entre M3 e a soma dos ativos -- e ai cada "Quero", "Falta" e
// "Compra ou Aguarda" tem de bater com o do Excel.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  calcularRebalanceamento,
  alocacaoPorSetor,
  calcularPesoPelosCriterios,
  lerAporte,
  lerPeso,
  lerPesosParaGravar,
  modeloDoTipo,
  CRITERIOS_DA_CALCULADORA,
  ROTULO_DA_SITUACAO,
  ROTULO_DO_PESO,
  SEM_SETOR,
} = await import("../.tmp-rebalanceamento/rebalanceamento.js");
const { vocabularioDeRecomendacao } = await import(
  "../.tmp-rebalanceamento/crivos.js"
);

function perto(recebido, esperado, mensagem, tolerancia = 0.01) {
  assert.ok(
    Math.abs(recebido - esperado) <= tolerancia + 1e-9,
    `${mensagem}: esperado ${esperado}, recebido ${recebido}`
  );
}

// A aba Controle: ativo, preco, custo medio, quantidade, nota.
const PLANILHA = [
  ["BPAN4", 4.4, 4.56, 10, 10],
  ["PTBL3", 2.35, 4.62, 14, 6],
  ["TAEE4", 8.06, 9.8, 5, 12],
  ["GRND3", 6.85, 9.83, 3, 6],
  ["STBP3", 3.2, 4.19, 14, 6],
  ["PFRM3", 3.1, 5.19, 26, 9],
  ["ABEV3", 11.49, 14.13, 5, 9],
  ["ODPV3", 13.2, 14.45, 5, 8],
  ["KLBN4", 2.67, 3.21, 31, 8],
  ["LEVE3", 15.92, 24.72, 6, 8],
  ["HYPE3", 26.8, 36.64, 5, 8],
  ["OIBR3", 0.44, 1.55, 2, 0],
  ["B3SA3", 30.7, 37.27, 6, 8],
  ["VIVA3", 14, 20.31, 13, 6],
  ["ITUB4", 20.62, 28.2, 13, 7],
  ["SQIA3", 12, 19.87, 17, 8],
  ["BIDI11", 28.03, 39.13, 16, 9],
  ["VVAR3", 4.49, 8.08, 35, 8],
  ["FLRY3", 19, 25.41, 20, 6],
  ["JHSF3", 3.26, 4.65, 60, 7],
  ["ITSA4", 7.62, 11.39, 50, 10],
];

// O "Valor na Corretora" (M3) da planilha: =1138.2+510.91.
const VALOR_NA_CORRETORA = 1138.2 + 510.91;

function ativoDaPlanilha([symbol, preco, custo, quantidade, peso], extra = {}) {
  const valorAtual = preco * quantidade;
  const investido = custo * quantidade;
  return {
    asset_id: `id-${symbol}`,
    symbol,
    peso,
    setor: null,
    preco,
    quantidade,
    valorAtual,
    resultado: valorAtual - investido,
    variacao: (valorAtual / investido - 1) * 100,
    semCota: false,
    ...extra,
  };
}

const carteiraDaPlanilha = () => PLANILHA.map((l) => ativoDaPlanilha(l));
const somaDaPlanilha = PLANILHA.reduce((s, l) => s + l[1] * l[3], 0);

function linha(r, symbol) {
  const l = r.linhas.find((x) => x.symbol === symbol);
  assert.ok(l, `a linha de ${symbol} existe`);
  return l;
}

test("o Tenho da planilha soma R$ 3.100,26 (F3)", () => {
  perto(somaDaPlanilha, 3100.26, "soma dos ativos");
  const r = calcularRebalanceamento(carteiraDaPlanilha(), 0);
  perto(r.valorDaCarteira, 3100.26, "valorDaCarteira");
  assert.equal(r.somaDosPesos, 159);
});

test("a conta e a da planilha: com a mesma base, cada coluna bate com o Excel", () => {
  // Aporte negativo nao existe: para reproduzir a base de M3 (menor que os
  // ativos) a conta e conferida contra percentuais, que nao dependem da base,
  // e contra o Quero/Falta recalculados com M3.
  const r = calcularRebalanceamento(carteiraDaPlanilha(), 0);

  // % Carteira Ideal (H) -- independe da base.
  perto(linha(r, "BPAN4").percentualIdeal, 0.06289308176100629, "% ideal BPAN4", 1e-12);
  perto(linha(r, "TAEE4").percentualIdeal, 0.07547169811320754, "% ideal TAEE4", 1e-12);
  perto(linha(r, "ITUB4").percentualIdeal, 0.0440251572327044, "% ideal ITUB4", 1e-12);
  assert.equal(linha(r, "OIBR3").percentualIdeal, 0, "nota 0 = % ideal 0");

  // Quero (J) e Falta (K), com a base M3 da planilha.
  const quero = (s) => linha(r, s).percentualIdeal * VALOR_NA_CORRETORA;
  perto(quero("BPAN4"), 103.71761006289309, "Quero BPAN4");
  perto(quero("BPAN4") - 44, 59.71761006289309, "Falta BPAN4");
  perto(quero("ITSA4") - 381, -277.2823899371069, "Falta ITSA4");
  perto((quero("BPAN4") - 44) / 4.4, 13.572184105202973, "Qto falta (acoes) BPAN4");
});

test("o % que tenho soma 100% e nao depende do aporte", () => {
  const sem = calcularRebalanceamento(carteiraDaPlanilha(), 0);
  const com = calcularRebalanceamento(carteiraDaPlanilha(), 5000);
  const soma = sem.linhas.reduce((s, l) => s + l.percentualAtual, 0);
  perto(soma, 1, "soma do % atual", 1e-9);
  perto(linha(sem, "BIDI11").percentualAtual, 448.48 / 3100.26, "% atual BIDI11", 1e-9);
  perto(linha(com, "BIDI11").percentualAtual, 448.48 / 3100.26, "% atual com aporte", 1e-9);
});

test("a base e a carteira MAIS o aporte, e o Quero fecha com ela", () => {
  const r = calcularRebalanceamento(carteiraDaPlanilha(), 900);
  perto(r.base, 4000.26, "base");
  const somaQuero = r.linhas.reduce((s, l) => s + l.valorAlvo, 0);
  perto(somaQuero, 4000.26, "soma do Quero", 0.05);
  // BPAN4: 10/159 * 4000,26 = 251,59 ; falta 207,59 ; 47,18 cotas.
  perto(linha(r, "BPAN4").valorAlvo, 251.59, "Quero BPAN4");
  perto(linha(r, "BPAN4").falta, 207.59, "Falta BPAN4");
  perto(linha(r, "BPAN4").cotasQueFaltam, 207.5868 / 4.4, "cotas que faltam BPAN4", 0.001);
});

test("aportar quando falta, aguardar quando sobra -- e peso 0 sempre aguarda", () => {
  const r = calcularRebalanceamento(carteiraDaPlanilha(), 900);
  assert.equal(linha(r, "BPAN4").situacao, "aportar");
  assert.equal(linha(r, "FLRY3").situacao, "aguardar", "FLRY3 tem R$ 380 e quer ~R$ 150");
  assert.equal(linha(r, "OIBR3").situacao, "aguardar");
  perto(linha(r, "OIBR3").valorAlvo, 0, "OIBR3 quer zero");
  perto(linha(r, "OIBR3").falta, -0.88, "OIBR3 sobra o que tem");
});

test("o aporte e dividido na proporcao da falta e nunca passa do aporte", () => {
  const r = calcularRebalanceamento(carteiraDaPlanilha(), 900);
  assert.ok(r.faltaTotal > 900, "ha mais falta que aporte (ativos acima do alvo)");
  perto(r.aporteDividido, 900, "o aporte dividido e o aporte inteiro", 0.05);
  const bpan = linha(r, "BPAN4");
  perto(bpan.doAporte, (bpan.falta * 900) / r.faltaTotal, "BPAN4 recebe a parte dele", 0.02);
  for (const l of r.linhas) {
    if (l.situacao === "aguardar") assert.equal(l.doAporte, 0, `${l.symbol} acima do alvo nao recebe`);
  }
});

test("cotas do aporte sao inteiras, para baixo, e a sobra e o troco", () => {
  const r = calcularRebalanceamento(carteiraDaPlanilha(), 900);
  let gasto = 0;
  for (const l of r.linhas) {
    assert.ok(Number.isInteger(l.cotasDoAporte), `${l.symbol}: cota inteira`);
    const preco = PLANILHA.find((p) => p[0] === l.symbol)[1];
    assert.ok(l.cotasDoAporte * preco <= l.doAporte + 0.01, `${l.symbol}: nao passa do que recebeu`);
    gasto += l.cotasDoAporte * preco;
  }
  perto(r.sobraDoArredondamento, 900 - gasto, "sobra", 0.02);
  assert.ok(r.sobraDoArredondamento >= 0);
});

test("10 cotas exatas nao viram 9 por erro de ponto flutuante", () => {
  const r = calcularRebalanceamento(
    [
      ativoDaPlanilha(["AAAA3", 0.1, 0.1, 0, 1]),
      ativoDaPlanilha(["BBBB3", 10, 10, 10, 0]),
    ],
    1
  );
  // base 101 ; AAAA3 quer 101, tem 0 ; recebe o aporte inteiro (R$ 1) = 10 cotas.
  assert.equal(linha(r, "AAAA3").cotasDoAporte, 10);
});

test("aporte menor que a falta de um so ativo: ele recebe tudo", () => {
  const r = calcularRebalanceamento(
    [ativoDaPlanilha(["AAAA3", 10, 10, 0, 1]), ativoDaPlanilha(["BBBB3", 10, 10, 10, 1])],
    50
  );
  // base 150 ; cada um quer 75 ; AAAA3 falta 75, BBBB3 falta -25.
  perto(linha(r, "AAAA3").doAporte, 50, "AAAA3 fica com o aporte");
  assert.equal(linha(r, "AAAA3").cotasDoAporte, 5);
  assert.equal(linha(r, "BBBB3").doAporte, 0);
});

test("peso NULL fica fora da base e da tabela; peso 0 fica dentro", () => {
  const ativos = [
    ativoDaPlanilha(["AAAA3", 10, 10, 10, 1]),
    ativoDaPlanilha(["RESERVA", 1, 1, 5000, null], { semCota: true }),
    ativoDaPlanilha(["ZERA3", 1, 1, 100, 0]),
  ];
  const r = calcularRebalanceamento(ativos, 0);
  assert.deepEqual(r.fora, ["RESERVA"]);
  assert.equal(r.linhas.length, 2);
  perto(r.valorDaCarteira, 200, "a reserva nao entra na base");
  perto(linha(r, "AAAA3").valorAlvo, 200, "AAAA3 quer a base inteira");
});

test("sem preco ou renda fixa: falta em reais, sem cotas", () => {
  const r = calcularRebalanceamento(
    [
      ativoDaPlanilha(["SEMPRECO", 10, 10, 10, 1], { preco: null }),
      ativoDaPlanilha(["CDB", 1, 1, 100, 1], { semCota: true }),
    ],
    100
  );
  assert.equal(linha(r, "SEMPRECO").cotasQueFaltam, null);
  assert.equal(linha(r, "SEMPRECO").cotasDoAporte, null);
  assert.equal(linha(r, "CDB").cotasDoAporte, null);
  // base 300 (100 + 100 + aporte 100) ; cada um quer 150 e tem 100.
  perto(linha(r, "CDB").falta, 50, "CDB: quer 150, tem 100");
  perto(linha(r, "SEMPRECO").doAporte, 50, "SEMPRECO recebe em reais");
  perto(linha(r, "CDB").doAporte, 50, "CDB recebe em reais");
  perto(r.sobraDoArredondamento, 0, "em reais nao ha troco");
});

test("todos com peso 0: nada quer nada, e o % ideal e NULL (nao NaN)", () => {
  const r = calcularRebalanceamento([ativoDaPlanilha(["AAAA3", 10, 10, 10, 0])], 100);
  assert.equal(linha(r, "AAAA3").percentualIdeal, null);
  assert.equal(linha(r, "AAAA3").valorAlvo, 0);
  assert.equal(linha(r, "AAAA3").situacao, "aguardar");
});

test("carteira vazia nao quebra", () => {
  const r = calcularRebalanceamento([], 100);
  assert.equal(r.linhas.length, 0);
  assert.equal(r.base, 100);
  assert.deepEqual(r.setores, []);
});

test("ordem: quem mais falta primeiro", () => {
  const r = calcularRebalanceamento(carteiraDaPlanilha(), 900);
  for (let i = 1; i < r.linhas.length; i++) {
    assert.ok(r.linhas[i - 1].falta >= r.linhas[i].falta, "ordenado pela falta");
  }
});

test("setores: soma por setor, sem diferenciar maiuscula, e o sem setor", () => {
  const r = calcularRebalanceamento(
    [
      ativoDaPlanilha(["ITUB4", 10, 10, 10, 1], { setor: "Financeiro" }),
      ativoDaPlanilha(["B3SA3", 10, 10, 10, 1], { setor: "financeiro" }),
      ativoDaPlanilha(["FLRY3", 10, 10, 30, 2], { setor: "Saúde" }),
      ativoDaPlanilha(["XXXX3", 10, 10, 10, 0], { setor: "  " }),
    ],
    0
  );
  const fin = r.setores.find((s) => s.setor.toLowerCase() === "financeiro");
  assert.equal(r.setores.filter((s) => s.setor.toLowerCase() === "financeiro").length, 1);
  perto(fin.valorAtual, 200, "Financeiro soma os dois");
  perto(fin.percentualAtual, 200 / 600, "Financeiro tem 1/3", 1e-9);
  perto(fin.percentualIdeal, 0.5, "Financeiro quer 50%", 1e-9);
  const sem = r.setores.find((s) => s.setor === SEM_SETOR);
  assert.ok(sem, "setor em branco vira o sem setor");
  assert.equal(r.setores[0].setor, "Saúde", "o maior setor primeiro");
  perto(
    alocacaoPorSetor(r.linhas).reduce((s, f) => s + f.percentualAtual, 0),
    1,
    "os setores somam 100%",
    1e-9
  );
});

test("a calculadora e a media ponderada da aba Nota Empresa", () => {
  // A aba Nota Empresa: importancias 10,7,7,6,7,3,6,5 e notas 7,10,10,10,3,10,11,12.
  // O Excel da 8,6352... com os 11 e 12 da planilha; aqui os dois sao presos em 10.
  const valores = {
    setor: 7,
    lucro: 10,
    margem: 10,
    roe: 10,
    dividendo: 3,
    endividamento: 10,
    pl: 11,
    subjetiva: 12,
  };
  const esperado = (10 * 7 + 7 * 10 + 7 * 10 + 6 * 10 + 7 * 3 + 3 * 10 + 6 * 10 + 5 * 10) / 51;
  perto(
    calcularPesoPelosCriterios(CRITERIOS_DA_CALCULADORA.empresa, valores),
    esperado,
    "resultado"
  );
});

test("a calculadora de FII e a aba Nota FII", () => {
  const valores = { localizacao: 10, dy: 10, ocupacao: 10, padrao: 5, diversificacao: 8 };
  perto(calcularPesoPelosCriterios(CRITERIOS_DA_CALCULADORA.fii, valores), 8.6, "resultado");
});

test("criterio nao avaliado nao conta como zero; nada avaliado e NULL", () => {
  const so = calcularPesoPelosCriterios(CRITERIOS_DA_CALCULADORA.fii, { dy: 8 });
  assert.equal(so, 8);
  assert.equal(calcularPesoPelosCriterios(CRITERIOS_DA_CALCULADORA.fii, {}), null);
});

test("o modelo da calculadora segue o tipo do ativo", () => {
  assert.equal(modeloDoTipo("fii"), "fii");
  assert.equal(modeloDoTipo("stock"), "empresa");
});

test("leitura do aporte digitado", () => {
  assert.equal(lerAporte("1.500,50"), 1500.5);
  assert.equal(lerAporte("1500.5"), 1500.5);
  assert.equal(lerAporte("R$ 900"), 900);
  assert.equal(lerAporte(""), 0);
  assert.equal(lerAporte("-10"), 0);
  assert.equal(lerAporte("abc"), 0);
});

test("leitura do peso que vem do banco", () => {
  assert.equal(lerPeso("7.50"), 7.5);
  assert.equal(lerPeso(0), 0);
  assert.equal(lerPeso(null), null);
  assert.equal(lerPeso(""), null);
  assert.equal(lerPeso(-1), null);
});

test("nenhum rotulo da tela e vocabulario de recomendacao", () => {
  const textos = [
    ...Object.values(ROTULO_DA_SITUACAO),
    ROTULO_DO_PESO,
    SEM_SETOR,
    ...Object.values(CRITERIOS_DA_CALCULADORA).flatMap((cs) =>
      cs.flatMap((c) => [c.rotulo, c.dica])
    ),
  ];
  for (const t of textos) {
    assert.deepEqual(vocabularioDeRecomendacao(t), [], `"${t}" usa vocabulario proibido`);
  }
});

test("o que a rota aceita gravar", () => {
  const ok = lerPesosParaGravar({
    itens: [
      { asset_id: "a", peso: "7,5", setor: "  Saúde   e  bem-estar " },
      { asset_id: "b", peso: "", setor: "" },
      { asset_id: "c", peso: 0, setor: null },
    ],
  });
  assert.ok(ok.ok);
  assert.deepEqual(ok.itens, [
    { asset_id: "a", target_weight: 7.5, sector: "Saúde e bem-estar" },
    { asset_id: "b", target_weight: null, sector: null },
    { asset_id: "c", target_weight: 0, sector: null },
  ]);
  assert.equal(lerPesosParaGravar({ itens: [{ asset_id: "a", peso: -1 }] }).ok, false);
  assert.equal(lerPesosParaGravar({ itens: [{ asset_id: "a", peso: 1000.5 }] }).ok, false);
  assert.equal(lerPesosParaGravar({ itens: [{ asset_id: "a", peso: "abc" }] }).ok, false);
  assert.equal(lerPesosParaGravar({ itens: [{ asset_id: "a", setor: "x".repeat(61) }] }).ok, false);
  assert.equal(lerPesosParaGravar({ itens: [{ asset_id: "a" }, { asset_id: "a" }] }).ok, false);
  assert.equal(lerPesosParaGravar({ itens: [] }).ok, false);
  assert.equal(lerPesosParaGravar(null).ok, false);
});
