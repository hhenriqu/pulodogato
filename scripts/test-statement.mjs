// =====================================================
// Teste da leitura de extrato e da conciliacao (lib/statement.ts)
// =====================================================
// Roda o JavaScript COMPILADO, nao o TypeScript: `npm run test:statement`
// chama o tsc antes. Mesmo desenho de test-recurrence.mjs e test-settlement.mjs.
//
// O que este arquivo existe para pegar, em ordem de quanto custa errar:
//
//   1. o SINAL -- debito importado como receita faria os quatro relatorios do
//      008 mostrarem lucro num mes de gasto, sem erro nenhum na tela;
//   2. o VALOR EM PORTUGUES -- "1.234,56" em parseFloat() da 1.234, e um
//      extrato de mil reais entra como um real e vinte;
//   3. a DATA -- o fuso do servidor jogando 1o de janeiro para 31 de dezembro,
//      e "03/04" lido como 4 de marco;
//   4. a CONCILIACAO -- dois saques iguais casando com o mesmo lancamento e um
//      deles sumindo do app.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  lerValor,
  lerData,
  lerDataOfx,
  detectarFormatoDeData,
  parseOfx,
  parseCsv,
  parseStatement,
  detectarSeparador,
  normalizarDescricao,
  conciliar,
  tipoPeloSinal,
} = await import("../.tmp-statement/statement.js");

// =====================================================
// 1. O valor
// =====================================================
test("valor em pt-BR: o milhar nao vira decimal", () => {
  // O erro que este teste existe para pegar: parseFloat("1.234,56") = 1.234.
  assert.equal(lerValor("1.234,56"), 1234.56);
  assert.equal(lerValor("12.345.678,90"), 12345678.9);
  assert.equal(lerValor("R$ 250,00"), 250);
  assert.equal(lerValor("0,99"), 0.99);
});

test("valor em en-US", () => {
  assert.equal(lerValor("1,234.56"), 1234.56);
  assert.equal(lerValor("-250.00"), -250);
  assert.equal(lerValor("5000.00"), 5000);
});

test("o sinal sobrevive a todas as formas de escrever negativo", () => {
  assert.equal(lerValor("-8,00"), -8);
  assert.equal(lerValor("(1.234,56)"), -1234.56, "parenteses e negativo contabil");
  assert.equal(lerValor("1.234,56 D"), -1234.56, "sufixo D = debito");
  assert.equal(lerValor("1.234,56 C"), 1234.56, "sufixo C = credito, fica positivo");
  assert.equal(lerValor("+300,00"), 300);
});

test("separador unico e desempatado pela quantidade de casas", () => {
  assert.equal(lerValor("1,234"), 1234, "tres casas depois = milhar");
  assert.equal(lerValor("1.234"), 1234);
  assert.equal(lerValor("12,5"), 12.5, "uma casa = decimal");
  assert.equal(lerValor("12,50"), 12.5, "duas casas = decimal");
});

test("valor ilegivel devolve null, nunca NaN", () => {
  // NaN se propaga por toda a aritmetica seguinte e so aparece na tela depois
  // de ja ter sido gravado no banco.
  for (const lixo of ["", "   ", "abc", "R$", "--", "1,2,3.4.5x"]) {
    const v = lerValor(lixo);
    assert.equal(v, null, `"${lixo}" deveria dar null, deu ${v}`);
  }
});

// =====================================================
// 2. A data
// =====================================================
test("data do OFX e fatiada, nao interpretada pelo fuso", () => {
  assert.equal(lerDataOfx("20260910"), "2026-09-10");
  assert.equal(lerDataOfx("20260910120000"), "2026-09-10");
  // ESTE e o caso que quebra com new Date(): meia-noite em BRT num servidor
  // UTC volta um dia -- e o gasto de janeiro cai no relatorio de dezembro.
  assert.equal(lerDataOfx("20260101000000.000[-3:BRT]"), "2026-01-01");
  assert.equal(lerDataOfx("20261231235900[-3:BRT]"), "2026-12-31");
});

test("data do OFX invalida e recusada", () => {
  assert.equal(lerDataOfx("20260230"), null, "30 de fevereiro nao existe");
  assert.equal(lerDataOfx("20230229"), null, "2023 nao e bissexto");
  assert.equal(lerDataOfx("20240229"), "2024-02-29", "2024 e bissexto");
  assert.equal(lerDataOfx("2026091"), null);
  assert.equal(lerDataOfx(""), null);
});

test("data de CSV segue o formato escolhido para o arquivo", () => {
  assert.equal(lerData("2026-09-10"), "2026-09-10", "ISO e reconhecido sozinho");
  assert.equal(lerData("03/04/2026", "dmy"), "2026-04-03", "3 de abril");
  assert.equal(lerData("03/04/2026", "mdy"), "2026-03-04", "4 de marco");
  assert.equal(lerData("10-09-2026", "dmy"), "2026-09-10", "o traco tambem separa");
  assert.equal(lerData("10/09/26", "dmy"), "2026-09-10", "ano de dois digitos");
});

test("uma linha que nao cabe no formato do arquivo e lida na outra ordem", () => {
  // Melhor aproveitar a linha do que descartar um lancamento de verdade: 31
  // nao pode ser mes, entao so ha uma leitura possivel.
  assert.equal(lerData("31/01/2026", "mdy"), "2026-01-31");
  assert.equal(lerData("04/13/2026", "dmy"), "2026-04-13");
});

test("o formato da data sai do arquivo inteiro, nao da linha", () => {
  // ESTE e o ponto: sozinha, "10/09/2026" e ambigua. Com "15/09/2026" no mesmo
  // arquivo, o 15 prova que o primeiro campo e o dia -- e resolve as duas.
  assert.deepEqual(detectarFormatoDeData(["10/09/2026", "15/09/2026"]), {
    formato: "dmy",
    certo: true,
  });
  assert.deepEqual(detectarFormatoDeData(["09/10/2026", "09/15/2026"]), {
    formato: "mdy",
    certo: true,
  });
  // nenhuma linha passa do dia 12: nao da para saber, e o chamador avisa.
  assert.deepEqual(detectarFormatoDeData(["10/09/2026", "03/04/2026"]), {
    formato: "dmy",
    certo: false,
  });
  // evidencia dos dois lados = arquivo estranho. dd/mm, mas avisando.
  assert.deepEqual(detectarFormatoDeData(["15/09/2026", "09/15/2026"]), {
    formato: "dmy",
    certo: false,
  });
});

test("data de CSV impossivel e recusada", () => {
  assert.equal(lerData("31/02/2026", "dmy"), null, "31 de fevereiro nao existe em ordem nenhuma");
  assert.equal(lerData("abc"), null);
  assert.equal(lerData(""), null);
});

// =====================================================
// 3. OFX
// =====================================================
const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKTRANLIST>
<DTSTART>20260901
<DTEND>20260930
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260910120000[-3:BRT]
<TRNAMT>-250.00
<FITID>BANCO-77
<MEMO>MERCADO SAO JOAO
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260905
<TRNAMT>5000.00
<FITID>BANCO-78
<MEMO>SALARIO
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

const OFX_XML = `<?xml version="1.0"?>
<OFX>
  <BANKTRANLIST>
    <STMTTRN>
      <TRNTYPE>DEBIT</TRNTYPE>
      <DTPOSTED>20260910</DTPOSTED>
      <TRNAMT>-250.00</TRNAMT>
      <FITID>BANCO-77</FITID>
      <NAME>MERCADO SAO JOAO</NAME>
      <MEMO>compra no debito</MEMO>
    </STMTTRN>
  </BANKTRANLIST>
</OFX>`;

test("OFX 1.x (SGML, sem tag de fechamento) e lido", () => {
  const r = parseOfx(OFX_SGML);
  assert.equal(r.entries.length, 2);
  assert.equal(r.periodStart, "2026-09-01");
  assert.equal(r.periodEnd, "2026-09-30");

  const [mercado, salario] = r.entries;
  assert.equal(mercado.amount, -250, "debito TEM que continuar negativo");
  assert.equal(mercado.postedAt, "2026-09-10");
  assert.equal(mercado.fitId, "BANCO-77");
  assert.equal(mercado.fingerprint, "fitid:BANCO-77");
  assert.equal(salario.amount, 5000, "credito continua positivo");
});

test("OFX 2.x (XML, com tag de fechamento) e lido pelo mesmo caminho", () => {
  const r = parseOfx(OFX_XML);
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].amount, -250);
  assert.equal(r.entries[0].description, "MERCADO SAO JOAO", "NAME e o estabelecimento");
  assert.equal(r.entries[0].memo, "compra no debito");
});

test("o formato e escolhido pelo conteudo, nao pela extensao", () => {
  assert.equal(parseStatement(OFX_SGML).format, "ofx");
  assert.equal(parseStatement("data;descricao;valor\n10/09/2026;MERCADO;-250,00").format, "csv");
});

// =====================================================
// 4. CSV
// =====================================================
// O dia 15 e o que resolve o formato do arquivo inteiro: 15 nao pode ser mes,
// entao o primeiro campo e o dia e nenhuma linha fica ambigua.
const CSV_BR = `Data;Descricao;Valor
10/09/2026;MERCADO SAO JOAO;-1.234,56
15/09/2026;SALARIO;5.000,00
03/09/2026;CAFE;-8,00
03/09/2026;CAFE;-8,00`;

test("CSV brasileiro: ponto-e-virgula com virgula decimal", () => {
  // A armadilha: contar virgulas escolheria ',' como separador e partiria o
  // arquivo no meio de cada valor.
  assert.equal(detectarSeparador(CSV_BR.split("\n")), ";");

  const r = parseCsv(CSV_BR);
  assert.equal(r.entries.length, 4);
  assert.equal(r.entries[0].amount, -1234.56, "mil duzentos e trinta e quatro, nao um e vinte");
  assert.equal(r.entries[1].amount, 5000);
  assert.equal(r.periodStart, "2026-09-03");
  assert.equal(r.periodEnd, "2026-09-15");
  assert.deepEqual(r.warnings, [], "o dia 15 resolveu o formato: nada a avisar");
});

test("CSV americano com virgula separadora e campo entre aspas", () => {
  const csv = `date,description,amount
2026-09-10,"MERCADO, LTDA",-250.00
2026-09-05,SALARY,5000.00`;
  const r = parseCsv(csv);
  assert.equal(r.entries.length, 2);
  assert.equal(r.entries[0].description, "MERCADO, LTDA", "a virgula dentro das aspas nao divide");
  assert.equal(r.entries[0].amount, -250);
});

test("BOM do Excel nao impede achar a coluna de data", () => {
  // Sem remover o BOM, "﻿Data" nunca casa com "data" e o parser cai no
  // caminho posicional -- avisando sobre um cabecalho que estava ali.
  const r = parseCsv(`﻿Data;Descricao;Valor\n15/09/2026;MERCADO;-250,00`);
  assert.equal(r.entries.length, 1);
  assert.deepEqual(r.warnings, [], "com BOM removido o cabecalho e reconhecido");
});

test("CSV sem cabecalho reconhecido importa E avisa", () => {
  const r = parseCsv(`15/09/2026;MERCADO;-250,00\n05/09/2026;SALARIO;5.000,00`);
  assert.equal(r.entries.length, 2, "a primeira linha NAO e descartada como cabecalho");
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /data, descricao, valor/);
});

test("arquivo em que nenhuma data passa do dia 12 importa E avisa", () => {
  const r = parseCsv(`Data;Descricao;Valor\n03/04/2026;MERCADO;-250,00\n05/04/2026;PADARIA;-30,00`);
  assert.equal(r.entries[0].postedAt, "2026-04-03", "dd/mm e o palpite brasileiro");
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /dd\/mm/);
});

test("arquivo em ISO nao avisa nada sobre formato de data", () => {
  const r = parseCsv(`date,description,amount\n2026-04-03,MERCADO,-250.00`);
  assert.deepEqual(r.warnings, []);
});

test("linha de saldo (valor zero) e descartada", () => {
  const r = parseCsv(`Data;Descricao;Valor\n10/09/2026;SALDO ANTERIOR;0,00\n10/09/2026;MERCADO;-250,00`);
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].description, "MERCADO");
});

// =====================================================
// 5. Deduplicacao
// =====================================================
test("dois cafes identicos no mesmo dia sao dois fatos, nao um repetido", () => {
  const r = parseCsv(CSV_BR);
  const cafes = r.entries.filter((e) => e.description === "CAFE");
  assert.equal(cafes.length, 2);
  assert.notEqual(cafes[0].fingerprint, cafes[1].fingerprint, "o #n e o que separa os dois");
  assert.match(cafes[0].fingerprint, /#1$/);
  assert.match(cafes[1].fingerprint, /#2$/);
});

test("reimportar o MESMO arquivo devolve os MESMOS fingerprints", () => {
  // E o que faz o ON CONFLICT DO NOTHING do 009 funcionar. Se o fingerprint
  // dependesse do horario, do id do import ou de um contador global, cada
  // reimportacao duplicaria o extrato inteiro.
  const a = parseCsv(CSV_BR).entries.map((e) => e.fingerprint);
  const b = parseCsv(CSV_BR).entries.map((e) => e.fingerprint);
  assert.deepEqual(a, b);
});

test("acento e caixa nao mudam o fingerprint", () => {
  // Um extrato reexportado em outra codificacao nao pode duplicar o mes.
  const a = parseCsv(`Data;Descricao;Valor\n10/09/2026;Mercado São João;-250,00`);
  const b = parseCsv(`Data;Descricao;Valor\n10/09/2026;MERCADO SAO JOAO;-250,00`);
  assert.equal(a.entries[0].fingerprint, b.entries[0].fingerprint);
  assert.equal(normalizarDescricao("Mercado  São   João"), "mercado sao joao");
});

// =====================================================
// 6. Conciliacao
// =====================================================
const extrato = (linhas) =>
  linhas.map((l, i) => ({
    fitId: null,
    fingerprint: `fp${i}`,
    postedAt: l.d,
    amount: l.v,
    description: l.t,
    memo: null,
  }));

test("mesmo valor e mesma data: casa", () => {
  const m = conciliar(
    extrato([{ d: "2026-09-10", v: -250, t: "MERCADO SAO JOAO" }]),
    [{ id: "t1", amount: -250, transaction_date: "2026-09-10", description: "Mercado" }]
  );
  assert.equal(m[0].transactionId, "t1");
  assert.equal(m[0].dayGap, 0);
});

test("a folga de dias cobre a compra que o banco registra depois", () => {
  const dentro = conciliar(
    extrato([{ d: "2026-09-13", v: -250, t: "MERCADO" }]),
    [{ id: "t1", amount: -250, transaction_date: "2026-09-10", description: "Mercado" }]
  );
  assert.equal(dentro[0].transactionId, "t1", "3 dias entra");

  const fora = conciliar(
    extrato([{ d: "2026-09-14", v: -250, t: "MERCADO" }]),
    [{ id: "t1", amount: -250, transaction_date: "2026-09-10", description: "Mercado" }]
  );
  assert.equal(fora[0].transactionId, null, "4 dias nao entra");
});

test("valor diferente nunca casa, nem por um centavo", () => {
  const m = conciliar(
    extrato([{ d: "2026-09-10", v: -32.0, t: "ALMOCO" }]),
    [{ id: "t1", amount: -32.5, transaction_date: "2026-09-10", description: "Almoco" }]
  );
  assert.equal(m[0].transactionId, null);
});

test("o SINAL faz parte do casamento", () => {
  // Um estorno de R$ 250 nao e a compra de R$ 250.
  const m = conciliar(
    extrato([{ d: "2026-09-10", v: 250, t: "ESTORNO MERCADO" }]),
    [{ id: "t1", amount: -250, transaction_date: "2026-09-10", description: "Mercado" }]
  );
  assert.equal(m[0].transactionId, null);
});

test("um lancamento existente e reivindicado por UMA linha so", () => {
  // A regra que custa dinheiro se faltar: dois saques de R$ 50 no extrato, um
  // unico saque de R$ 50 lancado. Se os dois casassem, o segundo saque -- que
  // e dinheiro de verdade que saiu da conta -- sumiria do app para sempre.
  const m = conciliar(
    extrato([
      { d: "2026-09-10", v: -50, t: "SAQUE" },
      { d: "2026-09-10", v: -50, t: "SAQUE" },
    ]),
    [{ id: "t1", amount: -50, transaction_date: "2026-09-10", description: "Saque" }]
  );
  const casados = m.filter((x) => x.transactionId !== null);
  assert.equal(casados.length, 1, "exatamente um casa");
  assert.equal(m.filter((x) => x.transactionId === null).length, 1, "o outro entra como novo");
});

test("a melhor combinacao global ganha, nao a primeira linha do arquivo", () => {
  // A primeira linha do extrato esta a 3 dias do lancamento; a segunda, no
  // mesmo dia. Na ordem do arquivo a primeira levaria o lancamento e a
  // segunda -- que casava exatamente -- entraria como novo, duplicando o mes.
  const m = conciliar(
    extrato([
      { d: "2026-09-13", v: -250, t: "MERCADO" },
      { d: "2026-09-10", v: -250, t: "MERCADO" },
    ]),
    [{ id: "t1", amount: -250, transaction_date: "2026-09-10", description: "Mercado" }]
  );
  assert.equal(m[0].transactionId, null);
  assert.equal(m[1].transactionId, "t1");
  assert.equal(m[1].dayGap, 0);
});

test("a semelhanca de descricao desempata entre candidatos iguais", () => {
  const m = conciliar(
    extrato([{ d: "2026-09-10", v: -80, t: "POSTO IPIRANGA" }]),
    [
      { id: "farmacia", amount: -80, transaction_date: "2026-09-10", description: "Farmacia Pague Menos" },
      { id: "posto", amount: -80, transaction_date: "2026-09-10", description: "Posto Ipiranga" },
    ]
  );
  assert.equal(m[0].transactionId, "posto");
  assert.ok(m[0].similarity > 0.5);
});

test("sem nenhum candidato, a linha e nova", () => {
  const m = conciliar(extrato([{ d: "2026-09-10", v: -250, t: "MERCADO" }]), []);
  assert.deepEqual(m[0], { fingerprint: "fp0", transactionId: null, dayGap: null, similarity: null });
});

// =====================================================
// 7. O tipo sai do sinal
// =====================================================
test("negativo e despesa, positivo e receita", () => {
  assert.equal(tipoPeloSinal(-250), "expense");
  assert.equal(tipoPeloSinal(5000), "income");
  assert.equal(tipoPeloSinal(-0.01), "expense");
});
