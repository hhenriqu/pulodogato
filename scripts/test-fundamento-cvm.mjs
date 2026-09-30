// Teste do ingestor de fundamento da CVM -- HMO-194.
//
// O que esta suite existe para impedir: a PETR4 do usuario exibir a
// rentabilidade da ACU PETROLEO S.A. com a mesma confianca.
//
// PETR4, VALE3 e RANI3 nao estao aqui por serem populares -- sao os tres
// tickers em que o PRIMEIRO resultado da consulta da B3 e outra empresa. Um
// piloto feito so com blue chips (ITUB4, ABEV3, WEGE3) acerta 100% por falta de
// concorrente no nome e leva o defeito para producao. Por isso varios testes
// abaixo afirmam DUAS coisas: que a regra acerta, e que a fixture realmente
// contem a armadilha -- uma fixture que perdeu a armadilha faria a suite passar
// sem provar nada, que e o modo de falhar mais caro que existe aqui.
//
// As fixtures sao materia-prima, nao resultado calculado por este codigo:
//   - `fixtures/b3-getinitialcompanies.json` e a resposta crua da B3, gravada
//     em 2026-09-30, com a ordem original preservada;
//   - `fixtures/cvm-2025-*.csv` sao LINHAS VERBATIM do pacote anual da CVM, em
//     ISO-8859-1 como o original, filtradas para tres empresas.
// Os numeros esperados foram conferidos contra o arquivo da CVM antes de virarem
// assercao.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONTAS,
  COLUNA_DMPL_CONSOLIDADO,
  FONTES,
  NAO_DERIVADOS,
  acharConta,
  anoDoExercicio,
  calcularIndicadores,
  escolherEmpresaDaB3,
  formatarCnpj,
  lerCsvCvm,
  normalizarRotulo,
  radicalDoTicker,
  somarDividendos,
  valorEmReais,
} from "../.tmp-fundamento-cvm/fundamento-cvm.js";

const DIR = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");

const B3 = JSON.parse(readFileSync(join(DIR, "b3-getinitialcompanies.json"), "utf8"));

/** Le a fixture como o ingestor le o arquivo real: bytes ISO-8859-1. */
const csv = (curto) => lerCsvCvm(readFileSync(join(DIR, `cvm-2025-${curto}.csv`)).toString("latin1"));

const DRE = csv("DRE_con");
const BPP = csv("BPP_con");
const BPA = csv("BPA_con");
const DMPL = csv("DMPL_con");
const CAPITAL = csv("composicao_capital");

const PETR = "33.000.167/0001-01";
const VALE = "33.592.510/0001-54";
const RANI = "92.791.243/0001-03";
/** Itau: banco, plano de contas proprio -- e a armadilha 4. */
const ITAU = "60.872.504/0001-23";

const bi = (n) => n / 1e9;
/** Compara em bilhoes de reais com 3 casas -- a precisao em que a CVM publica. */
const assertBi = (real, esperado, msg) => assert.equal(Number(bi(real).toFixed(3)), esperado, msg);

// ===========================================================================
// 1. A PONTE ticker -> CNPJ -- o controle negativo da entrega
// ===========================================================================

test("a ponte acerta os tres tickers em que o primeiro resultado da B3 e outra empresa", () => {
  const esperado = {
    PETR4: { codigoCvm: "9512", cnpj: "33000167000101", nome: /PETROBRAS/ },
    VALE3: { codigoCvm: "4170", cnpj: "33592510000154", nome: /^VALE S\.A\.$/ },
    RANI3: { codigoCvm: "2429", cnpj: "92791243000103", nome: /IRANI/ },
  };

  for (const [ticker, quero] of Object.entries(esperado)) {
    const resultados = B3[ticker.slice(0, 4)];
    const r = escolherEmpresaDaB3(ticker, resultados);

    assert.equal(r.ok, true, `${ticker} deveria resolver`);
    assert.equal(r.empresa.codigoCvm, quero.codigoCvm, `${ticker}: codigo CVM`);
    assert.equal(r.empresa.cnpj, quero.cnpj, `${ticker}: CNPJ`);
    assert.match(r.empresa.nome, quero.nome, `${ticker}: nome`);
  }
});

test("A FIXTURE CONTEM A ARMADILHA: nos tres, results[0] e uma empresa DIFERENTE da escolhida", () => {
  // Sem esta assercao o teste de cima passaria mesmo que a B3 tivesse mudado e o
  // primeiro resultado ja fosse o certo -- e ai a suite deixaria de cobrir
  // exatamente o defeito que ela existe para cobrir, sem ficar vermelha.
  const primeirosErrados = {
    PETR4: /A[ÇC]U PETROLEO/,
    VALE3: /ADECOAGRO VALE DO EVINHEMA/,
    RANI3: /GLOBAL X URANIUM ETF/,
  };

  for (const [ticker, nomeErrado] of Object.entries(primeirosErrados)) {
    const resultados = B3[ticker.slice(0, 4)];
    const escolhida = escolherEmpresaDaB3(ticker, resultados);

    assert.match(resultados[0].companyName, nomeErrado, `${ticker}: results[0] mudou -- revalide a fixture`);
    assert.notEqual(
      resultados[0].codeCVM,
      escolhida.empresa.codeCVM,
      `${ticker}: results[0] nao e mais a empresa errada`,
    );
    assert.notEqual(
      String(resultados[0].codeCVM).replace(/^0+/, ""),
      escolhida.empresa.codigoCvm,
      `${ticker}: pegar results[0] daria a MESMA empresa -- a armadilha sumiu da fixture`,
    );
    // E a posicao da certa: longe da primeira, que e o que torna "pegar a
    // primeira" uma escolha errada e nao uma escolha com azar.
    const posicao = resultados.findIndex((x) => String(x.codeCVM).replace(/^0+/, "") === escolhida.empresa.codigoCvm);
    assert.ok(posicao > 0, `${ticker}: a empresa certa esta na posicao ${posicao}, deveria ser > 0`);
  }
});

test("a empresa errada de results[0] tem CNPJ valido -- e por isso o erro nao daria sintoma", () => {
  // O ponto da issue: a Acu Petroleo EXISTE. Se o ingestor gravasse ela, a
  // consulta seguinte na CVM funcionaria e a tela mostraria um ROE. Nada
  // quebraria. Este teste documenta que o erro seria silencioso, o que justifica
  // a regra de igualdade exata em vez de um "log de aviso".
  const acu = B3.PETR[0];
  assert.match(acu.companyName, /A[ÇC]U PETROLEO/);
  assert.equal(String(acu.cnpj).replace(/\D/g, "").length, 14, "a empresa errada tem CNPJ de 14 digitos");
  assert.ok(Number(acu.codeCVM) > 0, "a empresa errada tem codigo CVM valido");
});

test("a regra de igualdade exata nao quebra o caso facil (ITUB4: results[0] ja e a certa)", () => {
  const r = escolherEmpresaDaB3("ITUB4", B3.ITUB);
  assert.equal(r.ok, true);
  assert.match(r.empresa.nome, /ITAU UNIBANCO HOLDING/);
  assert.equal(
    String(B3.ITUB[0].codeCVM).replace(/^0+/, ""),
    r.empresa.codigoCvm,
    "em ITUB4 o primeiro resultado E o certo -- a regra tem que concordar",
  );
});

test("FII nao existe nesse registro: HGLG11 e KNRI11 sao recusados, nao aproximados", () => {
  for (const ticker of ["HGLG11", "KNRI11"]) {
    const resultados = B3[ticker.slice(0, 4)];
    assert.equal(resultados.length, 0, `${ticker}: a B3 devolve zero -- FII nao entrega DFP`);

    const r = escolherEmpresaDaB3(ticker, resultados);
    assert.equal(r.ok, false);
    assert.equal(r.recusa.motivo, "sem_casamento_exato");
    assert.equal(r.recusa.candidatos, 0, "candidatos=0 distingue 'nao existe' de 'existe e nao casou'");
  }
});

test("candidatos > 0 com recusa e o caso PERIGOSO, e fica distinguivel de FII", () => {
  // Radical que a B3 conhece, mas nenhuma empresa com `issuingCompany` igual:
  // ha 17 candidatos, e nenhum deles e a empresa pedida. Registrar o numero de
  // candidatos e o que deixa "ninguem com esse nome" separado de "havia 17
  // parecidos e recusamos de proposito".
  const r = escolherEmpresaDaB3("PETX4", B3.PETR);
  assert.equal(r.ok, false);
  assert.equal(r.recusa.motivo, "sem_casamento_exato");
  assert.equal(r.recusa.candidatos, 17);
});

test("CNPJ que comeca em zero nao e recusado: a B3 manda o numero sem os zeros", () => {
  // Caso real: o Banco do Brasil chega da B3 com `cnpj: "191"`, porque o campo e
  // numerico e 00.000.000/0001-91 perde os zeros da frente. Exigir 14 digitos
  // sem reencher recusaria 154 das 439 empresas do pacote de 2025 -- todas com a
  // mesma cara de "nao tem CNPJ valido", nenhuma com erro.
  assert.equal(B3.BBAS[0].cnpj, "191", "a fixture preserva o CNPJ encurtado da B3");

  const r = escolherEmpresaDaB3("BBAS3", B3.BBAS);
  assert.equal(r.ok, true, "o Banco do Brasil tem que resolver");
  assert.equal(r.empresa.cnpj, "00000000000191", "reenchido a esquerda para 14 digitos");
  assert.equal(r.empresa.codigoCvm, "1023");
  // E o CNPJ reenchido tem que casar com o do arquivo da CVM -- se o
  // preenchimento estivesse errado, a busca seguinte nao acharia nada.
  assert.equal(formatarCnpj(r.empresa.cnpj), "00.000.000/0001-91");
  assert.ok(
    DRE.some((l) => l.CNPJ_CIA === "00.000.000/0001-91"),
    "e esse CNPJ existe no pacote da CVM",
  );
});

test("numero longo demais continua recusado: reencher nao pode virar truncar", () => {
  const longo = [{ issuingCompany: "XPTO", companyName: "XPTO S.A.", cnpj: "123456789012345", codeCVM: "1111" }];
  const r = escolherEmpresaDaB3("XPTO3", longo);
  assert.equal(r.ok, false);
  assert.equal(r.recusa.motivo, "sem_codigo_cvm");
});

test("ETF sem CNPJ e recusado por falta de codigo CVM utilizavel, nao gravado com cnpj 0", () => {
  // Caso real da fixture: GLOBAL X URANIUM ETF tem `issuingCompany: "BURA"` e
  // `cnpj: 0`. O casamento exato ACERTA (BURA11 -> BURA), e ainda assim nao ha o
  // que buscar na CVM -- ETF nao entrega DFP.
  const r = escolherEmpresaDaB3("BURA11", B3.RANI);
  assert.equal(r.ok, false);
  assert.equal(r.recusa.motivo, "sem_codigo_cvm");
});

test("o casamento e IGUALDADE, nao 'contem': radical que e prefixo de outro codigo nao casa", () => {
  // Hoje todo `issuingCompany` da B3 tem exatamente 4 caracteres, e por isso
  // `includes(radical)` e `=== radical` dao o mesmo resultado em qualquer
  // fixture real -- um mutante que troca um pelo outro sobrevive sem que isso
  // seja um defeito. O que esta assercao fixa e a REGRA, para o dia em que a B3
  // devolver um codigo mais longo: ai a diferenca deixa de ser teorica e volta a
  // ser a armadilha 1, agora sem ninguem olhando.
  const comCodigoMaisLongo = [
    { issuingCompany: "PETRO", companyName: "PETRO OUTRA S.A.", cnpj: "11111111111111", codeCVM: "1111" },
    { issuingCompany: "XPETR", companyName: "XPETR TERCEIRA S.A.", cnpj: "22222222222222", codeCVM: "2222" },
  ];
  const r = escolherEmpresaDaB3("PETR4", comCodigoMaisLongo);
  assert.equal(r.ok, false, "nenhum dos dois E 'PETR' -- conter nao basta");
  assert.equal(r.recusa.motivo, "sem_casamento_exato");
});

test("dois issuingCompany iguais nao viram escolha por sorteio", () => {
  const ambiguo = [
    { issuingCompany: "XPTO", companyName: "XPTO UM S.A.", cnpj: "11111111111111", codeCVM: "1111" },
    { issuingCompany: "XPTO", companyName: "XPTO DOIS S.A.", cnpj: "22222222222222", codeCVM: "2222" },
  ];
  const r = escolherEmpresaDaB3("XPTO3", ambiguo);
  assert.equal(r.ok, false);
  assert.equal(r.recusa.motivo, "casamento_ambiguo");
});

test("ticker fora do padrao e recusado em vez de ter o radical chutado", () => {
  for (const ruim of ["PETR", "PE4", "PETROBRAS4", "petr4x", "", "PETR44444"]) {
    assert.equal(radicalDoTicker(ruim), null, `${JSON.stringify(ruim)} nao tem radical canonico`);
  }
  assert.equal(radicalDoTicker("petr4"), "PETR", "minuscula e normalizada");
  assert.equal(radicalDoTicker("PETR4F"), "PETR", "o F do fracionario nao entra no radical");
  assert.equal(radicalDoTicker("SANB11"), "SANB", "unit de dois digitos");

  const r = escolherEmpresaDaB3("PETROBRAS4", B3.PETR);
  assert.equal(r.ok, false);
  assert.equal(r.recusa.motivo, "ticker_fora_do_padrao");
});

// ===========================================================================
// 2. A DMPL -- o dividendo contado mais de uma vez
// ===========================================================================

test("dividendo da PETR4 em 2025 sai da coluna consolidada: R$ 42,423 bi", () => {
  const d = somarDividendos(DMPL, { cnpjFormatado: PETR, ano: 2025 });
  assertBi(d, 42.423, "dividendo + JCP de 2025");
  assert.ok(d > 0, "o campo guardado significa 'quanto foi distribuido', positivo");
});

test("A FIXTURE CONTEM A ARMADILHA: somar todas as colunas da DMPL infla 3x o dividendo", () => {
  // O defeito que `somarDividendos` evita, medido na propria fixture. Se a DMPL
  // passasse a ter so a coluna consolidada, este numero cairia para 42,423 e o
  // teste de cima deixaria de provar algo -- entao a inflacao e afirmada.
  //
  // Por que exatamente 3x e nao 2x: as parcelas somam o total uma vez
  // (-1,073 de reservas de lucro + -41,236 de lucros acumulados = -42,309), o
  // subtotal 'Patrimonio Liquido' repete esse mesmo valor, e o total
  // 'Patrimonio Liquido Consolidado' o repete de novo somado aos nao
  // controladores. O mesmo dividendo aparece tres vezes na mesma coluna de
  // numeros, e nenhuma das tres linhas parece redundante isolada.
  const todasAsColunas = DMPL.filter(
    (l) => l.CNPJ_CIA === PETR && anoDoExercicio(l) === 2025 && l.CD_CONTA === "5.04.06",
  );
  const somaIngenua = -todasAsColunas.reduce((s, l) => s + valorEmReais(l), 0);

  assert.equal(todasAsColunas.length, 8, "a DMPL tem 8 componentes de patrimonio para esta conta");
  assertBi(somaIngenua, 127.155, "a soma ingenua de todas as colunas");

  const correto = somarDividendos(DMPL, { cnpjFormatado: PETR, ano: 2025 });
  assertBi(correto, 42.423);
  assert.equal((somaIngenua / correto).toFixed(2), "3.00", "a soma ingenua triplica o dividendo");
});

test("dividendo prescrito (5.04.11) fica fora: e dinheiro que voltou, nao distribuicao", () => {
  const prescritos = DMPL.filter(
    (l) => l.CNPJ_CIA === PETR && anoDoExercicio(l) === 2025 &&
      l.CD_CONTA === "5.04.11" && l.COLUNA_DF === COLUNA_DMPL_CONSOLIDADO,
  );
  assert.equal(prescritos.length, 1, "a fixture tem a linha de prescritos");
  assertBi(valorEmReais(prescritos[0]), 0.828, "prescritos entram POSITIVO na DMPL");

  // Se `somarDividendos` incluisse 5.04.11, o resultado seria 42,423 - 0,828.
  const d = somarDividendos(DMPL, { cnpjFormatado: PETR, ano: 2025 });
  assertBi(d, 42.423);
  assert.notEqual(Number(bi(d).toFixed(3)), 41.595, "prescritos nao podem abater a distribuicao");
});

test("o ano e atribuido ao exercicio certo: 2025 = 42,4 bi e 2024 = 101,2 bi na MESMA fixture", () => {
  // Esta e a armadilha do numero de referencia da issue: ela cita "dividendos
  // R$ 101,2 bi" junto com o lucro e o patrimonio de 2025, mas 101,2 bi e o
  // dividendo de 2024 (a linha PENULTIMO do mesmo arquivo). Misturar os dois
  // anos daria um dividend yield de 15,3% onde o de 2025 e ~6,4%.
  const d2025 = somarDividendos(DMPL, { cnpjFormatado: PETR, ano: 2025 });
  const d2024 = somarDividendos(DMPL, { cnpjFormatado: PETR, ano: 2024 });

  assertBi(d2025, 42.423, "exercicio 2025");
  assertBi(d2024, 101.202, "exercicio 2024, que a referencia da issue atribuiu a 2025");
  assert.notEqual(Number(bi(d2025).toFixed(3)), 101.202, "o dividendo de 2025 nao e o de 2024");
});

test("DMPL sem a coluna consolidada e RECUSADA, nao somada pelas outras", () => {
  const semConsolidado = DMPL.filter(
    (l) => l.CNPJ_CIA === PETR && l.COLUNA_DF !== COLUNA_DMPL_CONSOLIDADO,
  );
  assert.throws(
    () => somarDividendos(semConsolidado, { cnpjFormatado: PETR, ano: 2025 }),
    /nao tem a coluna/,
    "sem a coluna certa o correto e recusar, nao somar as parcelas",
  );
});

test("empresa ausente da DMPL devolve null, nao zero", () => {
  // null = "nao publicou"; zero = "distribuiu nada". Um crivo de dividendos
  // reprovaria a segunda e tem que ignorar a primeira.
  assert.equal(somarDividendos(DMPL, { cnpjFormatado: "99.999.999/9999-99", ano: 2025 }), null);
});

// ===========================================================================
// 3. A escala do numero (MIL x UNIDADE)
// ===========================================================================

test("ESCALA_MOEDA=MIL multiplica por mil: o lucro da PETR4 e R$ 110,605 bi", () => {
  const lucro = acharConta(DRE, { cnpjFormatado: PETR, rotulos: CONTAS.lucroLiquido.rotulos, ano: 2025 });
  assertBi(lucro, 110.605);

  // O numero cru do arquivo e 110605000 -- que sao MILHARES de reais. Ler sem
  // escala daria R$ 110,6 milhoes, mil vezes menos, e um ROE de 0,026%.
  const linhaCrua = DRE.find(
    (l) => l.CNPJ_CIA === PETR && l.CD_CONTA === "3.11" && anoDoExercicio(l) === 2025,
  );
  assert.equal(linhaCrua.ESCALA_MOEDA, "MIL", "a fixture usa MIL -- a normalizacao esta sendo exercitada");
  assert.equal(Number(linhaCrua.VL_CONTA), 110605000);
});

test("ESCALA_MOEDA=UNIDADE nao multiplica", () => {
  const linha = { VL_CONTA: "1234.56", ESCALA_MOEDA: "UNIDADE", MOEDA: "REAL", DT_FIM_EXERC: "2025-12-31" };
  assert.equal(valorEmReais(linha), 1234.56);
});

test("escala ou moeda desconhecida e recusada em vez de assumida", () => {
  assert.throws(
    () => valorEmReais({ VL_CONTA: "1", ESCALA_MOEDA: "MILHAO", MOEDA: "REAL" }),
    /ESCALA_MOEDA desconhecida/,
  );
  assert.throws(
    () => valorEmReais({ VL_CONTA: "1", ESCALA_MOEDA: "MIL", MOEDA: "DOLAR" }),
    /MOEDA diferente de REAL/,
    "converter sem cotacao somaria dolar com real",
  );
  assert.throws(() => valorEmReais({ VL_CONTA: "n/d", ESCALA_MOEDA: "MIL", MOEDA: "REAL" }), /nao numerico/);
});

// ===========================================================================
// 4. O layout que muda entre arquivos do mesmo pacote
// ===========================================================================

test("ler por NOME de coluna sobrevive a deriva de layout entre os tres arquivos", () => {
  // `CD_CONTA` e o 12o campo na DRE (que tem DT_INI_EXERC), o 11o na BPP/BPA
  // (que nao tem) e o 13o na DMPL (que tem COLUNA_DF). Ler por indice devolveria
  // a coluna vizinha, sem erro.
  assert.ok("DT_INI_EXERC" in DRE[0], "DRE tem DT_INI_EXERC");
  assert.ok(!("DT_INI_EXERC" in BPP[0]), "BPP nao tem DT_INI_EXERC");
  assert.ok("COLUNA_DF" in DMPL[0], "DMPL tem COLUNA_DF");

  // A prova de que a posicao realmente difere -- se os tres layouts
  // convergissem, este teste nao cobriria mais nada.
  const posicao = (linhas) => Object.keys(linhas[0]).indexOf("CD_CONTA");
  assert.equal(posicao(DRE), 11, "CD_CONTA e o 12o campo da DRE (indice 11)");
  assert.equal(posicao(BPP), 10, "CD_CONTA e o 11o campo da BPP (indice 10)");
  assert.equal(posicao(DMPL), 12, "CD_CONTA e o 13o campo da DMPL (indice 12)");

  // E mesmo assim as tres contas saem certas.
  assertBi(acharConta(DRE, { cnpjFormatado: PETR, rotulos: CONTAS.lucroLiquido.rotulos, ano: 2025 }), 110.605);
  assertBi(acharConta(BPP, { cnpjFormatado: PETR, rotulos: CONTAS.patrimonioLiquido.rotulos, ano: 2025 }), 417.587);
  assertBi(acharConta(BPA, { cnpjFormatado: PETR, rotulos: CONTAS.caixa.rotulos, codigo: CONTAS.caixa.codigo, ano: 2025 }), 35.608);
});

test("a fixture esta em ISO-8859-1, e lida como UTF-8 a coluna da DMPL nao casa", () => {
  // Justifica o `.toString("latin1")` do ingestor. Lido como UTF-8, o nome da
  // coluna chega quebrado e `somarDividendos` recusaria o arquivo inteiro.
  const bytes = readFileSync(join(DIR, "cvm-2025-DMPL_con.csv"));
  assert.ok(bytes.toString("latin1").includes(COLUNA_DMPL_CONSOLIDADO), "latin1 acha a coluna");
  assert.ok(!bytes.toString("utf8").includes(COLUNA_DMPL_CONSOLIDADO), "utf8 NAO acha a coluna");
});

test("linha com numero de campos diferente do cabecalho e erro, nao coluna trocada", () => {
  const bom = "CNPJ_CIA;CD_CONTA;VL_CONTA\n11.111.111/1111-11;3.11;10\n";
  assert.equal(lerCsvCvm(bom).length, 1);

  const comCampoExtra = "CNPJ_CIA;CD_CONTA;VL_CONTA\n11.111.111/1111-11;3.11;10;sobrando\n";
  assert.throws(() => lerCsvCvm(comCampoExtra), /tem 4 campos, cabecalho tem 3/);

  const faltando = "CNPJ_CIA;CD_CONTA;VL_CONTA\n11.111.111/1111-11;3.11\n";
  assert.throws(() => lerCsvCvm(faltando), /tem 2 campos, cabecalho tem 3/);
});

test("conta repetida para a mesma empresa e exercicio e recusada (re-apresentacao)", () => {
  const linha = DRE.find((l) => l.CNPJ_CIA === PETR && l.CD_CONTA === "3.11" && anoDoExercicio(l) === 2025);
  const duplicado = [...DRE, { ...linha, VERSAO: "2", VL_CONTA: "999999" }];

  assert.throws(
    () => acharConta(duplicado, { cnpjFormatado: PETR, rotulos: CONTAS.lucroLiquido.rotulos, ano: 2025 }),
    /valores diferentes/,
    "escolher pela ordem do arquivo gravaria o balanco retificado ou o original por sorteio",
  );
});

test("linha IDENTICA repetida pela CVM e colapsada, nao recusada", () => {
  // A CVM publica a mesma linha mais de uma vez. No pacote de 2025, FGR
  // INCORPORACOES traz o patrimonio 2x e VLI MULTIMODAL 3x -- mesmo codigo, mesma
  // VERSAO, mesmo valor. Isso e redundancia do arquivo, nao duas respostas: se
  // `acharConta` recusasse por contagem, duas companhias validas sairiam do banco
  // com a mesma cara de dado inconsistente.
  const duplicadas = [
    ["02.171.304/0001-47", 2, 1.703],
    ["42.276.907/0001-28", 3, 8.328],
  ];

  for (const [cnpj, vezes, esperado] of duplicadas) {
    const linhas = BPP.filter(
      (l) =>
        l.CNPJ_CIA === cnpj &&
        l.ORDEM_EXERC === "ÚLTIMO" &&
        normalizarRotulo(l.DS_CONTA) === "patrimonio liquido consolidado",
    );
    // A FIXTURE CONTEM A REPETICAO: sem isto o teste passaria por ausencia.
    assert.equal(linhas.length, vezes, `${cnpj}: a fixture tem a linha repetida ${vezes}x`);
    assert.equal(new Set(linhas.map((l) => l.VL_CONTA)).size, 1, "e as copias sao identicas");

    const pl = acharConta(BPP, { cnpjFormatado: cnpj, rotulos: CONTAS.patrimonioLiquido.rotulos, ano: 2025 });
    assertBi(pl, esperado, `${cnpj}: o valor sai uma vez, nao somado nem recusado`);
  }
});

test("conta ausente devolve null; DT_FIM_EXERC invalido e erro", () => {
  assert.equal(acharConta(DRE, { cnpjFormatado: PETR, rotulos: ["conta que nao existe"], ano: 2025 }), null);
  assert.equal(acharConta(DRE, { cnpjFormatado: PETR, rotulos: CONTAS.lucroLiquido.rotulos, ano: 1999 }), null);
  assert.throws(() => anoDoExercicio({ DT_FIM_EXERC: "" }), /DT_FIM_EXERC invalido/);
});

// ===========================================================================
// 4b. O mesmo CODIGO de conta significa outra coisa em banco (armadilha 4)
// ===========================================================================

test("ARMADILHA REAL: no Itau o codigo 2.03 e um PASSIVO, nao o patrimonio", () => {
  // Esta e a razao pela qual a conta e localizada pelo rotulo e nao pelo codigo.
  // Se a fixture perder esta linha, os dois testes seguintes param de provar algo.
  const c203 = BPP.find((l) => l.CNPJ_CIA === ITAU && l.CD_CONTA === "2.03" && l.ORDEM_EXERC === "ÚLTIMO");
  assert.ok(c203, "a fixture tem o 2.03 do Itau");
  assert.match(c203.DS_CONTA, /Passivos Financeiros ao Custo Amortizado/);
  assertBi(valorEmReais(c203), 2350.901, "o passivo que ocupa o endereco do patrimonio");

  // E o patrimonio de verdade, em outro codigo.
  const c208 = BPP.find((l) => l.CNPJ_CIA === ITAU && l.CD_CONTA === "2.08" && l.ORDEM_EXERC === "ÚLTIMO");
  assert.match(c208.DS_CONTA, /Patrim[ôo]nio L[íi]quido Consolidado/);
  assertBi(valorEmReais(c208), 215.076, "o patrimonio do Itau");

  // Ler pelo codigo 2.03 daria um numero ~11x maior que o patrimonio: um ROE de
  // 2% onde o certo e 21,32%. Nada quebraria, e o crivo reprovaria o banco.
  assert.ok(valorEmReais(c203) / valorEmReais(c208) > 10, "a ordem de grandeza do erro");
});

test("a conta e achada pelo ROTULO, e por isso o banco tambem sai certo", () => {
  // Passa `codigo` junto com `rotulo`, exatamente como o ingestor faz -- e nao so
  // o rotulo. A diferenca importa: se alguem voltar a fixar `codigo: "2.03"` em
  // `CONTAS.patrimonioLiquido`, o Itau passa a cair na recusa da armadilha 4 e
  // este teste fica vermelho. Lendo so o rotulo, o mesmo defeito passaria verde.
  const pl = acharConta(BPP, {
    cnpjFormatado: ITAU,
    rotulos: CONTAS.patrimonioLiquido.rotulos,
    codigo: CONTAS.patrimonioLiquido.codigo,
    ano: 2025,
  });
  const lucro = acharConta(DRE, {
    cnpjFormatado: ITAU,
    rotulos: CONTAS.lucroLiquido.rotulos,
    codigo: CONTAS.lucroLiquido.codigo,
    ano: 2025,
  });

  assertBi(pl, 215.076, "patrimonio do Itau, achado por rotulo em 2.08");
  assertBi(lucro, 45.849, "lucro do Itau, achado por rotulo em 3.09");

  // O ROE do Itau sai de contas que estao em codigos diferentes dos da Petrobras.
  const roe = calcularIndicadores({
    ...fundamentoDe(PETR),
    lucroLiquido: lucro,
    patrimonioLiquido: pl,
  }).roe;
  assert.equal((roe * 100).toFixed(2), "21.32", "ROE do Itau");
});

test("codigo presente com rotulo diferente devolve null, nunca a conta vizinha", () => {
  // O codigo 2.03 do Itau EXISTE e vale R$ 2.350,9 bi -- de passivo. Pedir o
  // patrimonio restringindo a esse codigo tem que dar null: a empresa nao publica
  // o patrimonio ali. O que nao pode acontecer e voltar o numero do passivo.
  const comCodigoFixo = acharConta(BPP, {
    cnpjFormatado: ITAU,
    codigo: "2.03",
    rotulos: ["patrimonio liquido consolidado"],
    ano: 2025,
  });
  assert.equal(comCodigoFixo, null, "rotulo nao casou -> null, nao o passivo");

  // E a prova de que havia um numero plausivel esperando para ser lido por engano.
  const passivo = BPP.find((l) => l.CNPJ_CIA === ITAU && l.CD_CONTA === "2.03" && l.ORDEM_EXERC === "ÚLTIMO");
  assert.ok(valorEmReais(passivo) > 2000e9, "o numero que a leitura por codigo devolveria");
});

test("banco nao tem receita de venda nem custo: margens ficam n/d, nao zero", () => {
  const receita = acharConta(DRE, { cnpjFormatado: ITAU, rotulos: CONTAS.receitaLiquida.rotulos, ano: 2025 });
  const custo = acharConta(DRE, { cnpjFormatado: ITAU, rotulos: CONTAS.custo.rotulos, ano: 2025 });
  assert.equal(receita, null, "'Receita de Venda de Bens e/ou Servicos' nao existe em banco");
  assert.equal(custo, null, "nem 'Custo dos Bens e/ou Servicos Vendidos'");

  // A DRE do Itau TEM 3.01 e 3.02 -- com outro significado
  // ("Receitas/Despesas da Intermediacao Financeira"). Ler por codigo daria
  // margem bruta de banco a partir de spread bancario, que nao e margem bruta.
  const i301 = DRE.find((l) => l.CNPJ_CIA === ITAU && l.CD_CONTA === "3.01" && l.ORDEM_EXERC === "ÚLTIMO");
  assert.equal(i301, undefined, "a fixture so guarda linhas cujo rotulo nos interessa");
});

test("formatarCnpj poe a mascara que os CSVs da CVM usam", () => {
  assert.equal(formatarCnpj("33000167000101"), PETR);
  assert.throws(() => formatarCnpj("330001670001"), /12 digitos/);
});

// ===========================================================================
// 5. Os indicadores, ponta a ponta, com os tres controles
// ===========================================================================

// O ingestor roteia cada conta pelo campo `arquivo` de CONTAS. O teste usa o
// MESMO roteamento -- e nao os arrays direto -- porque senao `CONTAS.*.arquivo`
// ficaria sem cobertura: trocar `BPP_con` por `BPP_ind` nao mudaria nada aqui e a
// suite continuaria verde, enquanto o ingestor passaria a ler o balanco
// individual. So ha fixture dos arquivos `_con`, entao pedir outro e erro.
const ARQUIVOS = { DRE_con: DRE, BPP_con: BPP, BPA_con: BPA };

/** Monta a linha que iria para `cvm_fundamentos`, como o ingestor monta. */
function fundamentoDe(cnpj, ano = 2025) {
  const conta = (chave) => {
    const { arquivo, codigo, rotulos } = CONTAS[chave];
    const linhas = ARQUIVOS[arquivo];
    assert.ok(linhas, `CONTAS.${chave} aponta para ${arquivo}, que nao e um arquivo consolidado conhecido`);
    return acharConta(linhas, { cnpjFormatado: cnpj, rotulos, codigo, ano });
  };
  const capital = CAPITAL.find((l) => l.CNPJ_CIA === cnpj);
  const dre = DRE.find((l) => l.CNPJ_CIA === cnpj && l.CD_CONTA === "3.11" && anoDoExercicio(l) === ano);

  return {
    codigoCvm: String(Number(dre.CD_CVM)),
    cnpj: cnpj.replace(/\D/g, ""),
    anoExercicio: ano,
    dataBase: dre.DT_FIM_EXERC,
    receitaLiquida: conta("receitaLiquida"),
    custo: conta("custo"),
    lucroLiquido: conta("lucroLiquido"),
    patrimonioLiquido: conta("patrimonioLiquido"),
    dividaCurtoPrazo: conta("dividaCurtoPrazo"),
    dividaLongoPrazo: conta("dividaLongoPrazo"),
    caixa: conta("caixa"),
    aplicacoesFinanceiras: conta("aplicacoesFinanceiras"),
    dividendosDistribuidos: somarDividendos(DMPL, { cnpjFormatado: cnpj, ano }),
    quantidadeAcoes: capital ? Number(capital.QT_ACAO_TOTAL_CAP_INTEGR) : null,
  };
}

test("toda conta sai do arquivo CONSOLIDADO, nunca do individual", () => {
  // Para holding -- que e o caso de quase toda blue chip -- o `_ind` mostra so a
  // controladora e ignora as controladas. A PETR4 individual tem patrimonio
  // diferente do consolidado, entao trocar `_con` por `_ind` daria um ROE
  // plausivel e errado, sem erro nenhum no caminho.
  for (const [chave, { arquivo }] of Object.entries(CONTAS)) {
    assert.match(arquivo, /_con$/, `${chave} tem que vir do consolidado, veio de ${arquivo}`);
  }
});

test("PETR4: a cadeia inteira reproduz os numeros conferidos no arquivo da CVM", () => {
  const f = fundamentoDe(PETR);
  assert.equal(f.codigoCvm, "9512");
  assert.equal(f.dataBase, "2025-12-31");

  assertBi(f.lucroLiquido, 110.605, "lucro liquido");
  assertBi(f.patrimonioLiquido, 417.587, "patrimonio liquido");
  assertBi(f.dividaCurtoPrazo + f.dividaLongoPrazo, 384.025, "divida bruta");
  assertBi(f.caixa, 35.608, "caixa");
  assertBi(f.aplicacoesFinanceiras, 15.0, "aplicacoes");
  assert.equal(f.quantidadeAcoes, 12888732761, "quantidade de acoes");

  const i = calcularIndicadores(f);
  assert.equal((i.roe * 100).toFixed(2), "26.49", "ROE");
  assertBi(i.dividaLiquida, 333.417, "divida liquida");
  assert.equal(i.dividaLiquidaSobrePatrimonio.toFixed(2), "0.80", "divida liquida / patrimonio");
  assert.equal((i.margemLiquida * 100).toFixed(2), "22.23", "margem liquida");
  assert.equal((i.margemBruta * 100).toFixed(2), "47.63", "margem bruta");
});

test("VALE3 e RANI3: ROE proprio, cada um do seu balanco", () => {
  const vale = fundamentoDe(VALE);
  assert.equal(vale.codigoCvm, "4170");
  assertBi(vale.lucroLiquido, 11.811);
  assertBi(vale.patrimonioLiquido, 188.926);
  assert.equal((calcularIndicadores(vale).roe * 100).toFixed(2), "6.25");

  const rani = fundamentoDe(RANI);
  assert.equal(rani.codigoCvm, "2429");
  assertBi(rani.lucroLiquido, 0.242);
  assertBi(rani.patrimonioLiquido, 1.452);
  assert.equal((calcularIndicadores(rani).roe * 100).toFixed(2), "16.67");

  // Os tres ROE sao diferentes entre si: se a ponte casasse todos com a mesma
  // empresa errada, este teste pegaria.
  const petr = calcularIndicadores(fundamentoDe(PETR)).roe;
  const conjunto = new Set([petr, calcularIndicadores(vale).roe, calcularIndicadores(rani).roe]);
  assert.equal(conjunto.size, 3, "tres empresas, tres ROE distintos");
});

test("a quantidade de acoes da CVM nao tem escala, e por isso nao vira indicador", () => {
  // A prova de que a escala diverge esta na propria fixture: a PETR4 declara
  // 12,9 bilhoes (unidades) e a VALE3 declara 4,5 milhoes (milhares). A Vale nao
  // tem 4,5 milhoes de acoes -- isso a poria a ~R$ 13.000 por acao.
  const petr = fundamentoDe(PETR).quantidadeAcoes;
  const vale = fundamentoDe(VALE).quantidadeAcoes;

  assert.equal(petr, 12888732761);
  assert.equal(vale, 4539007);
  assert.ok(petr / vale > 2000, `escalas incompativeis no mesmo arquivo (${petr} vs ${vale})`);

  // E `calcularIndicadores` nao oferece nada por acao.
  const i = calcularIndicadores(fundamentoDe(PETR));
  for (const proibido of ["precoSobreLucro", "dividendYield", "lucroPorAcao", "lpa", "pl"]) {
    assert.equal(proibido in i, false, `${proibido} nao pode sair desta entrega`);
  }
  assert.ok(NAO_DERIVADOS.lucroPorAcao.includes("escala"), "a razao esta declarada em NAO_DERIVADOS");
});

test("patrimonio liquido negativo nao produz ROE positivo", () => {
  // -50 de prejuizo sobre -100 de patrimonio daria "ROE 50%", e um crivo de
  // rentabilidade aprovaria a empresa mais quebrada da lista como a melhor.
  const base = fundamentoDe(PETR);
  const i = calcularIndicadores({ ...base, lucroLiquido: -50e9, patrimonioLiquido: -100e9 });
  assert.equal(i.roe, null, "sem patrimonio nao existe retorno sobre patrimonio");
  assert.equal(i.dividaLiquidaSobrePatrimonio, null, "nem alavancagem");
});

test("conta faltando vira null em cascata, sem virar zero", () => {
  const base = fundamentoDe(PETR);
  const i = calcularIndicadores({ ...base, lucroLiquido: null, custo: null, dividaCurtoPrazo: null, dividaLongoPrazo: null });
  assert.equal(i.roe, null);
  assert.equal(i.margemLiquida, null);
  assert.equal(i.margemBruta, null, "banco nao tem conta de custo -- margem bruta n/d, nao 100%");
  assert.equal(i.dividaLiquida, null, "sem nenhuma perna de divida, nao ha 'caixa liquido' a inventar");
  assert.equal(i.dividaLiquidaSobrePatrimonio, null);
});

test("cada indicador tem UMA fonte declarada no codigo", () => {
  // A regra da issue: misturar fonte por indicador e proibido mesmo quando as
  // duas respondem. `FONTES` existe para que a entrega 5 nao "complete" a conta
  // com a fonte que estiver a mao.
  for (const chave of ["roe", "margemLiquida", "margemBruta", "dividaLiquidaSobrePatrimonio"]) {
    assert.equal(typeof FONTES[chave], "string", `${chave} sem fonte declarada`);
    // A fonte tem que citar o CODIGO da conta (`3.11`, `2.03`), nao so o nome do
    // arquivo: "vem da DRE" nao desempata entre lucro do periodo e lucro
    // atribuido aos controladores, que sao contas diferentes com nomes parecidos.
    assert.match(FONTES[chave], /\d\.\d\d/, `a fonte de ${chave} tem que citar o codigo da conta`);
  }
  assert.match(FONTES.roe, /3\.11.*2\.03/, "ROE = 3.11 / 2.03");
});
