#!/usr/bin/env node
// =====================================================
// PULODOGATO - renda fixa que rende sozinha (HMO-192, entrega 2 da HMO-141)
// =====================================================
// A migration 031 deu onde guardar "110% do CDI". lib/renda-fixa.ts e a conta
// que transforma aquilo em dois numeros na tela (bruto em destaque, liquido ao
// lado) e lib/cdi.ts e a unica conversa com o Banco Central.
//
// Nenhum erro dessa conta levanta excecao. Todos desenham um rendimento errado
// com cara de certo, e por isso esta suite compara numero com numero, contra
// valores conferidos no endpoint de verdade (api.bcb.gov.br, 2026-10-06):
//
//   serie 12 (CDI ao dia)  0,050788%   serie 4389 (CDI ao ano)  13,65%
//   conferencia cruzada:   1,00050788 ^ 252 = 1,13650
//
// O QUE ESTA SUITE OLHA COM MAIS CUIDADO
// --------------------------------------
//   1. OS NUMEROS DA ISSUE, na casa do centavo. R$ 10.000 a 100% do CDI em 21
//      dias uteis -> R$ 107,20 brutos e R$ 83,08 liquidos. Por dia: R$ 5,08 a
//      100%, R$ 5,59 a 110%. Sao eles que pegam a troca de
//      `1 + taxa x percentual` por `(1 + taxa) ^ percentual`, que da numeros
//      quase iguais no primeiro dia e separa com os anos;
//
//   2. O FIM DE SEMANA. A janela de 01/09 a 30/09/2026 tem 29 dias CORRIDOS e
//      21 UTEIS -- 26 e 27/09 estao entre eles, e foi MEDIDO que o SGS nao
//      devolve o sabado. A SECAO 4 passa a mesma janela com os fins de semana
//      preenchidos com zero (o que um "gap filler" ingenuo produz) e mostra o
//      estrago: no CDI o bruto nao muda, mas o prefixado de 13% a.a. salta de
//      R$ 102,37 para R$ 141,64 -- R$ 39 inventados, porque a contagem de dias
//      uteis e o expoente;
//
//   3. LCI, LCA E POUPANCA. Isentas: liquido IGUAL ao bruto e aliquota ZERO. E
//      o caso que o codigo generico erra, e ele erra CONTRA o usuario -- mostra
//      um rendimento menor do que o que ele vai receber;
//
//   4. A BORDA DA TABELA DO IR, em dias CORRIDOS e nunca uteis. 180 ainda e
//      22,5% e 181 ja e 20%. O mesmo contador para as duas coisas tributaria um
//      CDB de 190 dias corridos (131 uteis) a 22,5% em vez de 20%;
//
//   5. A ORDEM DA RESPOSTA DO SGS. MEDIDO: `/bcdata.sgs.12/dados/ultimos/4`
//      volta CRESCENTE e `/bcdata.sgs.4389/dados/ultimos/3` volta DECRESCENTE.
//      Duas series do mesmo endpoint em ordens opostas -- quem le `[0]` ou
//      `[len-1]` acerta numa e erra na outra, com um numero plausivel de outro
//      dia;
//
//   6. O VENCIMENTO PARA A CONTA. Sem isso um CDB vencido em 2024 continuaria
//      acumulando CDI para sempre.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  DIAS_UTEIS_NO_ANO,
  INDEXADORES_PROJETAVEIS,
  PRODUTOS_ISENTOS_DE_IR,
  aliquotaDeIr,
  camposDeRendaFixaVazios,
  dataDoSgs,
  dataParaSgs,
  diasCorridosEntre,
  diasNoPeriodo,
  faixaDeIr,
  fatorDaSerie,
  fatorDoSpread,
  isentoDeIr,
  lerCamposDeRendaFixa,
  normalizarSerie,
  primeiraCompraPorAtivo,
  projetarRendimento,
  somarProjecoes,
} from "../.tmp-renda-fixa/renda-fixa.js";

import {
  JANELA_DE_DIAS,
  SERIE_CDI_ANUAL,
  SERIE_CDI_DIARIO,
  SERIE_DO_INDEXADOR,
  SERIE_SELIC_DIARIA,
  deslocarISO,
} from "../.tmp-renda-fixa/cdi.js";

// ---------------------------------------------------------------------------
// Fixture: a serie 12 como o Banco Central a devolve, so com os dias uteis
// ---------------------------------------------------------------------------
// A taxa e a MEDIDA (0,050788% ao dia, 25/09 a 05/10/2026). Os dias sao
// segunda a sexta de 01/09 a 02/10/2026 -- sem feriado nacional nesse trecho,
// conferido contra a resposta real de 22/09 a 02/10, que traz 22, 23, 24, 25,
// 28, 29, 30/09 e 01, 02/10 e NAO traz 26 nem 27/09.
const TAXA_CDI_DIA = 0.050788;

/** Sabado (6) e domingo (0) pelo calendario UTC -- ver diasCorridosEntre. */
function fimDeSemana(iso) {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}

function diasEntre(deISO, ateISO) {
  const dias = [];
  let atual = deISO;
  while (atual <= ateISO) {
    dias.push(atual);
    atual = deslocarISO(atual, 1);
  }
  return dias;
}

/** A serie como o SGS a entrega: SO dia util. */
const SERIE_CDI = diasEntre("2026-09-01", "2026-10-02")
  .filter((d) => !fimDeSemana(d))
  .map((data) => ({ data, valor: TAXA_CDI_DIA }));

/**
 * A MESMA janela com sabado e domingo preenchidos com zero -- o que um "gap
 * filler" ingenuo produz ao ler a ausencia do sabado como "rendeu zero".
 * Usada na SECAO 4 para medir o estrago.
 */
const SERIE_COM_ZEROS = diasEntre("2026-09-01", "2026-10-02").map((data) => ({
  data,
  valor: fimDeSemana(data) ? 0 : TAXA_CDI_DIA,
}));

const CDB = {
  id: "a1",
  symbol: "CDB-XP",
  name: "CDB XP 100% CDI",
  fixed_income_product: "cdb",
  index_kind: "cdi",
  index_percentage: 100,
  spread_annual: null,
  applied_date: "2026-09-01",
  maturity_date: "2028-09-01",
};

/** A janela da issue: 01/09 (aplicacao, nao rende) ate 30/09. */
const HOJE = "2026-09-30";

function projetar(ativo, extra = {}) {
  return projetarRendimento({
    ativo,
    principal: 10000,
    serie: SERIE_CDI,
    hoje: HOJE,
    ...extra,
  });
}

// =====================================================
// SECAO 1 - Os numeros da issue, na casa do centavo
// =====================================================

test("a janela da issue tem 29 dias corridos e 21 uteis", () => {
  assert.equal(diasCorridosEntre("2026-09-01", "2026-09-30"), 29);
  assert.equal(diasNoPeriodo(SERIE_CDI, "2026-09-01", HOJE).length, 21);
});

test("o fim de semana medido (26 e 27/09/2026) nao esta na serie", () => {
  const datas = SERIE_CDI.map((d) => d.data);
  assert.ok(datas.includes("2026-09-25"), "sexta 25/09 tem boletim");
  assert.ok(datas.includes("2026-09-28"), "segunda 28/09 tem boletim");
  assert.ok(!datas.includes("2026-09-26"), "sabado 26/09 nao tem boletim");
  assert.ok(!datas.includes("2026-09-27"), "domingo 27/09 nao tem boletim");
});

test("R$ 10.000 a 100% do CDI em 21 dias uteis rendem R$ 107,20 brutos", () => {
  const p = projetar(CDB);
  assert.equal(p.motivo, null);
  assert.equal(p.diasUteis, 21);
  assert.equal(p.diasCorridos, 29);
  assert.equal(p.bruto, 107.2);
});

test("e R$ 83,08 liquidos, a 22,5% de IR sobre o RENDIMENTO", () => {
  const p = projetar(CDB);
  assert.equal(p.aliquota, 22.5);
  assert.equal(p.isento, false);
  assert.equal(p.liquido, 83.08);
  // O IR incide so sobre o rendimento, nunca sobre o principal. Se incidisse
  // sobre os R$ 10.107,20 o liquido sairia NEGATIVO em R$ 2.166 -- um erro
  // visivel. O erro perigoso e o inverso (nao descontar nada), e por isso a
  // assercao e o valor exato e nao "liquido < bruto".
  assert.ok(p.liquido < p.bruto);
});

test("por dia, R$ 10.000 rendem R$ 5,08 a 100% do CDI e R$ 5,59 a 110%", () => {
  // Aplicado HOJE: zero dia util fechado, bruto zero, e o "por dia" e a taxa
  // cheia sobre o principal -- os numeros que a issue cita.
  const hoje = { ...CDB, applied_date: HOJE };
  const a100 = projetar(hoje);
  assert.equal(a100.bruto, 0);
  assert.equal(a100.porDia, 5.08);

  const a110 = projetar({ ...hoje, index_percentage: 110 });
  assert.equal(a110.porDia, 5.59);
});

test("110% do CDI multiplica a TAXA do dia, nao eleva o fator", () => {
  const p = projetar({ ...CDB, index_percentage: 110 });
  assert.equal(p.percentualDoIndice, 110);
  assert.equal(p.bruto, 117.98);

  // ... e R$ 117,98 NAO distingue as duas formulas. MEDIDO com o mutante
  // "percentual eleva o fator" vivo: `(1 + taxa) ^ 1,10` por dia util da
  // R$ 117,9780 contra os R$ 117,9780 da formula certa -- iguais ate o quarto
  // decimal em 21 dias, porque (1+x)^k ~ 1+kx para x da ordem de 0,0005. As
  // duas separam no PRAZO de um CDB de verdade, quando ninguem mais vai
  // conferir, e por isso a assercao que mede a formula e sobre o FATOR, com
  // casas suficientes para as duas nao colidirem.
  const dias = diasNoPeriodo(SERIE_CDI, "2026-09-01", HOJE);
  const certo = Math.pow(1 + (TAXA_CDI_DIA / 100) * 1.1, 21);
  const errado = Math.pow(Math.pow(1 + TAXA_CDI_DIA / 100, 1.1), 21);
  assert.notEqual(
    certo.toFixed(12),
    errado.toFixed(12),
    "as duas formulas tem que ser distinguiveis nesta precisao"
  );
  assert.equal(fatorDaSerie(dias, 110).toFixed(12), certo.toFixed(12));
});

test("as duas series do Banco Central fecham entre si", () => {
  // 1,00050788 ^ 252 = 1,13650 = a serie 4389 (CDI ao ano, 13,65%). Sao dois
  // caminhos independentes, e e por isso que a conferencia vale: uma taxa
  // diaria digitada errada por um zero nao passa por aqui.
  const anual = Math.pow(1 + TAXA_CDI_DIA / 100, DIAS_UTEIS_NO_ANO);
  assert.equal(anual.toFixed(5), "1.13650");
  assert.equal(SERIE_CDI_ANUAL, 4389);
  assert.equal(SERIE_CDI_DIARIO, 12);
  assert.equal(SERIE_SELIC_DIARIA, 11);
});

// =====================================================
// SECAO 2 - LCI, LCA e poupanca: o caso que o codigo generico erra
// =====================================================

test("LCI, LCA e poupanca tem liquido IGUAL ao bruto e aliquota zero", () => {
  for (const produto of ["lci", "lca", "poupanca"]) {
    const p = projetar({ ...CDB, fixed_income_product: produto });
    assert.equal(p.isento, true, `${produto} e isento`);
    assert.equal(p.aliquota, 0, `${produto} nao paga IR`);
    assert.equal(p.liquido, p.bruto, `${produto}: liquido = bruto`);
    assert.equal(p.liquido, 107.2, `${produto}: os R$ 107,20 inteiros`);
  }
});

test("CRI, CRA e debenture incentivada tambem sao isentos", () => {
  for (const produto of ["cri", "cra", "debenture_incentivada"]) {
    assert.equal(isentoDeIr(produto), true, produto);
  }
  assert.equal(PRODUTOS_ISENTOS_DE_IR.length, 6);
});

test("a isencao NAO se deriva do indexador: LCI e CDB de 95% do CDI so diferem no produto", () => {
  const comum = { ...CDB, index_percentage: 95 };
  const lci = projetar({ ...comum, fixed_income_product: "lci" });
  const cdb = projetar({ ...comum, fixed_income_product: "cdb" });

  assert.equal(lci.indexador, cdb.indexador);
  assert.equal(lci.percentualDoIndice, cdb.percentualDoIndice);
  assert.equal(lci.diasCorridos, cdb.diasCorridos);
  assert.equal(lci.bruto, cdb.bruto, "o bruto e o mesmo");
  // ... e o liquido nao e. Sem a coluna `fixed_income_product` da 031 este par
  // seria indistinguivel no banco, e o requisito da issue impossivel de cumprir.
  assert.notEqual(lci.liquido, cdb.liquido);
  assert.equal(lci.liquido, lci.bruto);
});

test("produto nulo e `outro` contam como TRIBUTADOS -- o lado seguro do erro", () => {
  assert.equal(isentoDeIr(null), false);
  assert.equal(isentoDeIr(undefined), false);
  assert.equal(isentoDeIr(""), false);
  assert.equal(isentoDeIr("outro"), false);
  assert.equal(isentoDeIr("LCI_INEXISTENTE"), false);

  // Subestimar o liquido de um isento faz a pessoa receber MAIS do que a tela
  // prometeu; o contrario promete um liquido que o Leao vai cortar.
  const p = projetar({ ...CDB, fixed_income_product: null });
  assert.equal(p.aliquota, 22.5);
  assert.equal(p.liquido, 83.08);
});

// =====================================================
// SECAO 3 - A tabela do IR, em dias CORRIDOS
// =====================================================

test("as quatro faixas e as tres bordas da tabela regressiva", () => {
  assert.equal(aliquotaDeIr(1), 22.5);
  assert.equal(aliquotaDeIr(180), 22.5, "180 ainda e a primeira faixa");
  assert.equal(aliquotaDeIr(181), 20, "181 ja e a segunda");
  assert.equal(aliquotaDeIr(360), 20);
  assert.equal(aliquotaDeIr(361), 17.5);
  assert.equal(aliquotaDeIr(720), 17.5);
  assert.equal(aliquotaDeIr(721), 15, "acima de 720 e 15%");
  assert.equal(aliquotaDeIr(3650), 15);
});

test("prazo negativo cai na aliquota MAIS ALTA, nao na mais baixa", () => {
  // O CHECK da 031 tolera `applied_date` um dia no futuro (fuso do cliente).
  // Um `<=` invertido aqui devolveria 15% para quem acabou de aplicar.
  assert.equal(aliquotaDeIr(-1), 22.5);
  assert.equal(aliquotaDeIr(0), 22.5);
});

test("a aliquota sai dos dias CORRIDOS, nunca dos uteis", () => {
  // 190 dias corridos sao ~131 uteis. Pela tabela, 190 e 20%; quem contasse
  // uteis veria 131 e cobraria 22,5% -- 2,5 pontos a mais, sempre contra o
  // usuario, e sem nada na tela denunciando.
  assert.equal(aliquotaDeIr(190), 20);
  assert.equal(aliquotaDeIr(131), 22.5);

  const longo = projetar(
    { ...CDB, applied_date: "2026-03-24" },
    { serie: SERIE_CDI }
  );
  assert.equal(longo.diasCorridos, 190);
  assert.equal(longo.aliquota, 20);
  assert.ok(longo.diasUteis < longo.diasCorridos);
});

test("faixaDeIr descreve a faixa que aliquotaDeIr escolheu", () => {
  assert.equal(faixaDeIr(180), "até 180 dias");
  assert.equal(faixaDeIr(181), "181 a 360 dias");
  assert.equal(faixaDeIr(361), "361 a 720 dias");
  assert.equal(faixaDeIr(721), "acima de 720 dias");
});

// =====================================================
// SECAO 4 - O fim de semana, e o estrago de ler a ausencia como zero
// =====================================================

test("sabado e domingo contribuem com NADA porque nada rendeu neles", () => {
  const p = projetar(CDB);
  // 29 dias corridos, 21 uteis: os 8 dias de fim de semana nao capitalizam.
  assert.equal(p.diasUteis, 21);
  assert.notEqual(p.diasUteis, 29);
});

test("preencher o fim de semana com zero INVENTA dia util", () => {
  const comZeros = projetar(CDB, { serie: SERIE_COM_ZEROS });
  // No CDI o bruto sobrevive -- multiplicar por (1 + 0) e inofensivo --, e e
  // exatamente por isso que o defeito passa: o numero em destaque continua
  // certo enquanto o CONTADOR fica errado.
  assert.equal(comZeros.bruto, 107.2);
  assert.equal(comZeros.diasUteis, 29, "o gap filler conta 29 dias uteis");
});

test("e no prefixado esse dia util inventado vira R$ 39 de rendimento falso", () => {
  const prefixado = {
    ...CDB,
    index_kind: "prefixado",
    index_percentage: null,
    spread_annual: 13,
  };

  const certo = projetar(prefixado);
  assert.equal(certo.diasUteis, 21);
  assert.equal(certo.bruto, 102.37);

  const errado = projetar(prefixado, { serie: SERIE_COM_ZEROS });
  assert.equal(errado.diasUteis, 29);
  assert.equal(errado.bruto, 141.64);

  // R$ 39,27 em um mes, num ativo de R$ 10.000. E o expoente de 252 que
  // transforma a contagem de dias uteis em dinheiro.
  assert.ok(errado.bruto - certo.bruto > 39);
});

test("serie VAZIA e `indisponivel`, e nao rendimento zero", () => {
  // Esta e a diferenca que a issue cobra: "nao ha boletim" nao e "rendeu zero".
  // Zero apareceria na tela como um numero -- e a pessoa concluiria que o CDB
  // dela parou de render.
  const p = projetar(CDB, { serie: [] });
  assert.equal(p.motivo, "indisponivel");
  assert.equal(p.bruto, null);
  assert.equal(p.liquido, null);
  assert.equal(p.porDia, null);
});

test("aplicado na sexta e consultado no domingo: zero dia util, mas a projecao SAI", () => {
  // Nada rendeu ainda, e isso e um fato e nao uma falha. `motivo` nulo com
  // bruto zero e o que permite a tela dizer "aplicado em 25/09, ainda sem dia
  // util fechado" em vez de "Banco Central indisponivel".
  const p = projetar({ ...CDB, applied_date: "2026-09-25" }, {
    hoje: "2026-09-27",
  });
  assert.equal(p.motivo, null);
  assert.equal(p.diasUteis, 0);
  assert.equal(p.bruto, 0);
  assert.equal(p.diasCorridos, 2);
});

// =====================================================
// SECAO 5 - A resposta do SGS: formato de data e ORDEM
// =====================================================

test("a data do SGS e DD/MM/YYYY -- e nao o MM-DD-YYYY da PTAX", () => {
  assert.equal(dataParaSgs("2026-09-25"), "25/09/2026");
  assert.equal(dataParaSgs("2026-10-02"), "02/10/2026");
  // A troca nao da erro: devolve dado de outro mes ou um 404 lido como feriado.
  assert.notEqual(dataParaSgs("2026-09-13"), "09-13-2026");
  assert.equal(dataDoSgs("25/09/2026"), "2026-09-25");
  assert.equal(dataDoSgs("2026-09-25"), null, "ISO na entrada nao e aceito calado");
  assert.equal(dataDoSgs(null), null);
  assert.equal(dataDoSgs("5/9/2026"), null, "sem zero a esquerda nao e o formato");
});

test("normalizarSerie ORDENA: a serie 4389 volta decrescente do mesmo endpoint", () => {
  // MEDIDO 2026-10-06: /bcdata.sgs.4389/dados/ultimos/3 devolve 05/10, 02/10,
  // 01/10 -- do mais novo para o mais velho --, enquanto /bcdata.sgs.12 devolve
  // crescente. Quem le posicao em vez de data acerta numa serie e erra na outra.
  const decrescente = [
    { data: "05/10/2026", valor: "0.050788" },
    { data: "02/10/2026", valor: "0.050788" },
    { data: "01/10/2026", valor: "0.050788" },
  ];
  const serie = normalizarSerie(decrescente);
  assert.deepEqual(
    serie.map((d) => d.data),
    ["2026-10-01", "2026-10-02", "2026-10-05"]
  );
  assert.equal(serie[serie.length - 1].data, "2026-10-05", "o ultimo e o mais novo");
});

test("normalizarSerie converte o `valor` STRING do SGS em numero", () => {
  const serie = normalizarSerie([{ data: "25/09/2026", valor: "0.050788" }]);
  assert.equal(serie[0].valor, 0.050788);
  assert.equal(typeof serie[0].valor, "number");
});

test("normalizarSerie DESCARTA linha ilegivel em vez de virar zero", () => {
  // Um zero no meio da serie multiplica por 1 (inofensivo no CDI) mas conta
  // como dia util -- ver a SECAO 4, onde isso vale R$ 39 num prefixado.
  const serie = normalizarSerie([
    { data: "25/09/2026", valor: "0.050788" },
    { data: "26/09/2026", valor: null },
    { data: "lixo", valor: "0.050788" },
    { valor: "0.050788" },
    { data: "28/09/2026", valor: "nao-numero" },
    { data: "29/09/2026", valor: "0.050788" },
  ]);
  assert.deepEqual(
    serie.map((d) => d.data),
    ["2026-09-25", "2026-09-29"]
  );
});

test("normalizarSerie aguenta resposta que nao e lista", () => {
  // O 404 do SGS vem com corpo `{"erro":{...}}`. Se ele escapasse para ca,
  // `Array.isArray` e o que impede um `.filter of undefined` derrubar a rota.
  assert.deepEqual(normalizarSerie(null), []);
  assert.deepEqual(normalizarSerie(undefined), []);
  assert.deepEqual(normalizarSerie({ erro: { statusCode: 404 } }), []);
  assert.deepEqual(normalizarSerie("[]"), []);
});

test("deslocarISO anda no calendario, inclusive virando mes e ano", () => {
  assert.equal(deslocarISO("2026-09-30", 1), "2026-10-01");
  assert.equal(deslocarISO("2026-10-01", -1), "2026-09-30");
  assert.equal(deslocarISO("2027-01-01", -1), "2026-12-31");
  assert.equal(deslocarISO("2026-10-06", -JANELA_DE_DIAS), "2026-09-22");
});

test("cada indexador projetavel aponta para a serie CERTA do SGS", () => {
  // Os numeros, e nao `typeof === "number"`: MEDIDO com o mutante
  // "Selic aponta para a serie do CDI" vivo -- as duas series tem o mesmo
  // formato e, hoje, o mesmo valor (0,050788%), entao trocar uma pela outra nao
  // muda nada ate o dia em que a Selic e o CDI se separarem. Que e o dia em que
  // ninguem vai estar olhando para este arquivo.
  assert.equal(SERIE_DO_INDEXADOR.cdi, 12);
  assert.equal(SERIE_DO_INDEXADOR.selic, 11);
  // Prefixado nao tem indice: a serie 12 entra como CALENDARIO de dias uteis.
  assert.equal(SERIE_DO_INDEXADOR.prefixado, 12);

  for (const ix of INDEXADORES_PROJETAVEIS) {
    assert.equal(typeof SERIE_DO_INDEXADOR[ix], "number", ix);
  }
  // O mapa nao tem nada ALEM dos projetaveis: uma serie para o IPCA aqui faria
  // a rota buscar boletim DIARIO de um indice mensal, e a resposta (ou a falta
  // dela) viraria "indisponivel" em vez do "sem_fonte" que e a verdade.
  assert.deepEqual(
    Object.keys(SERIE_DO_INDEXADOR).sort(),
    [...INDEXADORES_PROJETAVEIS].sort()
  );
  for (const ix of ["ipca", "igpm", "poupanca"]) {
    assert.equal(SERIE_DO_INDEXADOR[ix], undefined, ix);
  }
});

// =====================================================
// SECAO 6 - O vencimento, o prazo que falta, e o que a tela precisa dizer
// =====================================================

test("papel vencido para de render no VENCIMENTO, nao em hoje", () => {
  const vencido = projetar(
    { ...CDB, applied_date: "2026-09-01", maturity_date: "2026-09-15" },
    { hoje: "2026-09-30" }
  );
  assert.equal(vencido.vencido, true);
  assert.equal(vencido.fim, "2026-09-15");
  assert.equal(vencido.diasCorridos, 14);
  // 10 dias uteis de 02/09 a 15/09 -- e nao os 21 da janela inteira.
  assert.equal(vencido.diasUteis, 10);
  assert.ok(vencido.bruto < 107.2);
  // "Nao rende mais" nao e "rendeu zero hoje": a tela diz coisas diferentes.
  assert.equal(vencido.porDia, null);
});

test("vencimento no futuro nao corta nada", () => {
  const p = projetar({ ...CDB, maturity_date: "2030-01-01" });
  assert.equal(p.vencido, false);
  assert.equal(p.fim, HOJE);
  assert.equal(p.bruto, 107.2);
});

test("sem applied_date a conta cai para a primeira COMPRA, e diz de onde veio", () => {
  const semData = { ...CDB, applied_date: null };
  const p = projetar(semData, { primeiraCompra: "2026-09-01" });
  assert.equal(p.motivo, null);
  assert.equal(p.inicio, "2026-09-01");
  assert.equal(p.origemDoPrazo, "primeira_compra");
  assert.equal(p.bruto, 107.2);

  // Com o campo preenchido, ele GANHA da primeira compra -- e a fonte certa.
  const comData = projetar(CDB, { primeiraCompra: "2020-01-01" });
  assert.equal(comData.origemDoPrazo, "applied_date");
  assert.equal(comData.inicio, "2026-09-01");
});

test("sem applied_date e sem compra lancada, nao se escolhe aliquota nenhuma", () => {
  const p = projetar({ ...CDB, applied_date: null });
  assert.equal(p.motivo, "sem_prazo");
  assert.equal(p.bruto, null);
  // Zero aqui nao e uma aliquota escolhida: e a ausencia dela, e `motivo` e o
  // que impede a tela de imprimir "IR 0%" como se fosse isencao.
  assert.equal(p.aliquota, 0);
  assert.equal(p.inicio, null);
});

test("primeiraCompraPorAtivo ignora venda e provento", () => {
  const mapa = primeiraCompraPorAtivo([
    { asset_id: "a1", kind: "dividend", trade_date: "2026-01-05" },
    { asset_id: "a1", kind: "buy", trade_date: "2026-09-01" },
    { asset_id: "a1", kind: "buy", trade_date: "2026-09-20" },
    { asset_id: "a2", kind: "sell", trade_date: "2026-02-02" },
  ]);
  // Um provento lancado antes da compra daria um inicio anterior a aplicacao --
  // prazo inflado e aliquota de IR MENOR que a devida.
  assert.equal(mapa.a1, "2026-09-01");
  assert.equal(mapa.a2, undefined);
});

// =====================================================
// SECAO 7 - Os motivos: cada ausencia pede uma frase diferente
// =====================================================

test("IPCA, IGP-M e poupanca respondem `sem_fonte`, que nao melhora tentando de novo", () => {
  for (const ix of ["ipca", "igpm", "poupanca"]) {
    const p = projetar({ ...CDB, index_kind: ix });
    assert.equal(p.motivo, "sem_fonte", ix);
    assert.equal(p.bruto, null, ix);
    // O indexador continua preenchido: a tela mostra "IPCA" e explica que a
    // projecao e manual, em vez de dizer que o ativo esta incompleto.
    assert.equal(p.indexador, ix, ix);
  }
});

test("indexador ausente ou invalido responde `sem_indexador`", () => {
  assert.equal(projetar({ ...CDB, index_kind: null }).motivo, "sem_indexador");
  assert.equal(projetar({ ...CDB, index_kind: "" }).motivo, "sem_indexador");
  assert.equal(projetar({ ...CDB, index_kind: "CDI_PLUS" }).motivo, "sem_indexador");
  // Maiuscula e espaco vem de formulario e nao sao erro de dado.
  assert.equal(projetar({ ...CDB, index_kind: " CDI " }).motivo, null);
});

test("prefixado sem taxa responde `sem_taxa` -- a taxa inteira dele e o spread", () => {
  const base = { ...CDB, index_kind: "prefixado", index_percentage: null };
  assert.equal(projetar({ ...base, spread_annual: null }).motivo, "sem_taxa");
  assert.equal(projetar({ ...base, spread_annual: 0 }).motivo, "sem_taxa");
  assert.equal(projetar({ ...base, spread_annual: 13 }).motivo, null);
});

test("CDI sem percentual vale 100% do CDI, que e o que `CDI` quer dizer", () => {
  const p = projetar({ ...CDB, index_percentage: null });
  assert.equal(p.percentualDoIndice, 100);
  assert.equal(p.bruto, 107.2);
});

test("`numeric` que chega como STRING do PostgREST e lido como numero", () => {
  const p = projetar({ ...CDB, index_percentage: "110.0000" });
  assert.equal(p.percentualDoIndice, 110);
  assert.equal(p.bruto, 117.98);
});

test("CDI + spread soma os dois fatores", () => {
  // "CDI + 2%" existe, e a 031 permite as duas colunas juntas (so prefixado
  // proibe percentual). Ignorar o spread seria perder 2% a.a. em silencio.
  const p = projetar({ ...CDB, spread_annual: 2 });
  assert.ok(p.bruto > 107.2, "o spread acrescenta");
  assert.equal(
    p.bruto,
    Number(
      (
        10000 *
        (Math.pow(1 + TAXA_CDI_DIA / 100, 21) * Math.pow(1.02, 21 / 252) - 1)
      ).toFixed(2)
    )
  );
});

// =====================================================
// SECAO 8 - Os fatores, isolados
// =====================================================

test("fatorDaSerie a 0% nao rende, e a 100% rende a taxa cheia", () => {
  const dias = diasNoPeriodo(SERIE_CDI, "2026-09-01", HOJE);
  assert.equal(fatorDaSerie(dias, 0), 1);
  assert.equal(
    fatorDaSerie(dias, 100).toFixed(8),
    Math.pow(1 + TAXA_CDI_DIA / 100, 21).toFixed(8)
  );
});

test("fatorDoSpread usa 252 dias uteis, nao 365 corridos", () => {
  assert.equal(fatorDoSpread(13, DIAS_UTEIS_NO_ANO).toFixed(6), "1.130000");
  assert.equal(fatorDoSpread(0, 100), 1, "spread zero nao capitaliza");
  assert.equal(fatorDoSpread(13, 0), 1, "nenhum dia util nao capitaliza");
  // Usar 365 no denominador daria 1,00711 em vez de 1,01024 em 21 dias.
  assert.equal(fatorDoSpread(13, 21).toFixed(5), "1.01024");
});

test("diasNoPeriodo exclui o dia da aplicacao e inclui o fim", () => {
  // O dinheiro ENTRA no dia da aplicacao; ele nao rende nesse dia. Incluir o
  // inicio daria um dia util a mais em todo ativo da carteira -- 5% de
  // rendimento inventado num CDB de 21 dias.
  const dias = diasNoPeriodo(SERIE_CDI, "2026-09-01", "2026-09-04");
  assert.deepEqual(
    dias.map((d) => d.data),
    ["2026-09-02", "2026-09-03", "2026-09-04"]
  );
});

test("diasCorridosEntre nao escorrega um dia pelo fuso de Sao Paulo", () => {
  assert.equal(diasCorridosEntre("2026-09-01", "2026-09-30"), 29);
  assert.equal(diasCorridosEntre("2026-01-01", "2027-01-01"), 365);
  // A virada do horario de verao do hemisferio norte (que o Date local pega)
  // nao muda a contagem em UTC.
  assert.equal(diasCorridosEntre("2026-03-01", "2026-04-01"), 31);
  assert.equal(diasCorridosEntre("2026-09-30", "2026-09-01"), -29);
});

// =====================================================
// SECAO 9 - O total da carteira
// =====================================================

test("somarProjecoes soma o que saiu e CONTA o que nao saiu", () => {
  const ok = projetar(CDB);
  const isento = projetar({ ...CDB, id: "a2", fixed_income_product: "lci" });
  const semFonte = projetar({ ...CDB, id: "a3", index_kind: "ipca" });

  const total = somarProjecoes([ok, isento, semFonte]);
  assert.equal(total.bruto, 214.4);
  assert.equal(total.liquido, 190.28);
  // O ativo sem projecao nao entra na soma e tambem nao desaparece: a tela
  // avisa, em vez de mostrar um total menor sem explicacao.
  assert.equal(total.semProjecao, 1);
});

test("carteira sem renda fixa soma zero sem NaN", () => {
  const total = somarProjecoes([]);
  assert.equal(total.bruto, 0);
  assert.equal(total.liquido, 0);
  assert.equal(total.porDia, 0);
  assert.equal(total.semProjecao, 0);
});

// =====================================================
// SECAO 10 - O que vai para as colunas: a mesma regra dos CHECK da 031
// =====================================================
// `lerCamposDeRendaFixa` e uma duplicata deliberada do banco. O banco decide; ela
// existe para a pessoa ler "Prefixado nao usa percentual do indice" em vez de
// "violates check constraint investment_assets_prefixado_sem_percentual". Cada
// assercao abaixo cita a constraint que ela espelha -- se uma mudar no SQL e nao
// aqui, o sintoma e um erro feio, nao um dado errado.

const COMPLETO = {
  fixedIncomeProduct: "cdb",
  indexKind: "cdi",
  indexPercentage: "110",
  spreadAnnual: null,
  appliedDate: "2026-09-01",
  maturityDate: "2028-09-01",
};

test("o caso completo passa e sai com os nomes de COLUNA, nao os do corpo", () => {
  const r = lerCamposDeRendaFixa(COMPLETO);
  assert.equal(r.ok, true);
  assert.deepEqual(r.campos, {
    fixed_income_product: "cdb",
    index_kind: "cdi",
    index_percentage: 110,
    spread_annual: null,
    applied_date: "2026-09-01",
    maturity_date: "2028-09-01",
  });
});

test("o corpo vazio passa com os seis campos nulos", () => {
  // Nenhum campo e obrigatorio -- a 031 nao poe NOT NULL em nenhum deles, para
  // nao quebrar a tela dos ativos que ja existiam.
  const r = lerCamposDeRendaFixa({});
  assert.equal(r.ok, true);
  assert.deepEqual(r.campos, camposDeRendaFixaVazios());
});

test("index_percentage_check: fora de (0, 1000] e recusado", () => {
  // O teto nao e regra de mercado, e limite de digitacao: "11000" no lugar de
  // "110" projeta um rendimento cem vezes maior, com toda a confianca.
  for (const valor of ["0", "-1", "1001", "11000"]) {
    const r = lerCamposDeRendaFixa({ ...COMPLETO, indexPercentage: valor });
    assert.equal(r.ok, false, `recusa ${valor}`);
  }
  assert.equal(lerCamposDeRendaFixa({ ...COMPLETO, indexPercentage: "1000" }).ok, true);
  assert.equal(lerCamposDeRendaFixa({ ...COMPLETO, indexPercentage: "0.0001" }).ok, true);
});

test("campo ILEGIVEL e recusado, nao tratado como campo vazio", () => {
  // MEDIDO ao escrever esta suite: a primeira versao usava o mesmo leitor de
  // `numeric` que a projecao usa, e ele colapsa "ausente" e "ilegivel" em nulo.
  // O efeito era mudo e caro: "cento e dez" no campo de percentual seria
  // GRAVADO como nulo, o ativo apareceria como "CDI" sem percentual, e a
  // projecao leria isso como 100% do CDI. A pessoa digita 110, a tela aceita, e
  // a conta sai a 100%.
  for (const lixo of ["cento e dez", "11o", "--5", {}]) {
    assert.equal(
      lerCamposDeRendaFixa({ ...COMPLETO, indexPercentage: lixo }).ok,
      false,
      String(lixo)
    );
    assert.equal(
      lerCamposDeRendaFixa({ ...COMPLETO, spreadAnnual: lixo }).ok,
      false,
      String(lixo)
    );
  }
  // Vazio continua sendo vazio -- e o campo em branco de um formulario.
  assert.equal(lerCamposDeRendaFixa({ ...COMPLETO, indexPercentage: "" }).ok, true);
  assert.equal(
    lerCamposDeRendaFixa({ ...COMPLETO, indexPercentage: "  " }).campos
      .index_percentage,
    null,
    "espaco em branco e campo vazio"
  );
});

test("spread_annual_check: zero vale, negativo nao", () => {
  // Zero e valido (IPCA puro, sem juro real); negativo viraria rendimento
  // negativo silencioso.
  assert.equal(lerCamposDeRendaFixa({ ...COMPLETO, spreadAnnual: "0" }).ok, true);
  assert.equal(lerCamposDeRendaFixa({ ...COMPLETO, spreadAnnual: "-1" }).ok, false);
  assert.equal(lerCamposDeRendaFixa({ ...COMPLETO, spreadAnnual: "101" }).ok, false);
  assert.equal(lerCamposDeRendaFixa({ ...COMPLETO, spreadAnnual: "100" }).ok, true);
});

test("percentual_exige_indexador: 110% de que?", () => {
  const r = lerCamposDeRendaFixa({ ...COMPLETO, indexKind: null });
  assert.equal(r.ok, false);
  assert.match(r.erro, /indexador/i);
});

test("prefixado_sem_percentual: a taxa inteira do prefixado e o spread", () => {
  const r = lerCamposDeRendaFixa({
    ...COMPLETO,
    indexKind: "prefixado",
    indexPercentage: "110",
  });
  assert.equal(r.ok, false);
  assert.match(r.erro, /[Pp]refixado/);

  const certo = lerCamposDeRendaFixa({
    ...COMPLETO,
    indexKind: "prefixado",
    indexPercentage: null,
    spreadAnnual: "13",
  });
  assert.equal(certo.ok, true);
  assert.equal(certo.campos.spread_annual, 13);
});

test("vencimento_depois_da_aplicacao: igual tambem nao serve", () => {
  // Prazo zero divide por zero em qualquer projecao de rendimento.
  const igual = lerCamposDeRendaFixa({
    ...COMPLETO,
    maturityDate: COMPLETO.appliedDate,
  });
  assert.equal(igual.ok, false);

  const antes = lerCamposDeRendaFixa({
    ...COMPLETO,
    maturityDate: "2026-08-31",
  });
  assert.equal(antes.ok, false);

  // Vencimento sem aplicacao passa: o CHECK tolera um dos dois nulo.
  assert.equal(
    lerCamposDeRendaFixa({ ...COMPLETO, appliedDate: null }).ok,
    true
  );
});

test("data em outro formato e recusada em vez de chegar torta no banco", () => {
  for (const data of ["01/09/2026", "2026-9-1", "ontem", "2026-09"]) {
    assert.equal(
      lerCamposDeRendaFixa({ ...COMPLETO, appliedDate: data }).ok,
      false,
      data
    );
  }
});

test("produto e indexador fora da lista do CHECK sao recusados", () => {
  const p = lerCamposDeRendaFixa({ ...COMPLETO, fixedIncomeProduct: "tesouro" });
  assert.equal(p.ok, false);
  assert.match(p.erro, /lci/, "a mensagem lista o que vale");

  const i = lerCamposDeRendaFixa({ ...COMPLETO, indexKind: "cdi+" });
  assert.equal(i.ok, false);
  assert.match(i.erro, /cdi/);
});
