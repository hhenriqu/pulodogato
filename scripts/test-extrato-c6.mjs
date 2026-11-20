// =====================================================
// Teste da leitura do CSV do C6 Bank (lib/extrato-c6.ts)
// =====================================================
// Roda o JavaScript COMPILADO: `npm run test:extrato-c6` compila antes.
//
// Os fixtures em scripts/fixtures/c6-*.csv copiam o FORMATO dos arquivos que o
// C6 exporta (BOM, CRLF, preambulo da conta, aspas com espacos, ';' na fatura),
// com nomes e valores inventados. Os valores esperados abaixo sao escritos a
// mao a partir dos fixtures, nunca recalculados pelo codigo.
//
// O que custa caro se errar:
//   1. o SINAL da fatura -- o C6 grava a compra POSITIVA. Sem inverter, toda a
//      fatura entraria como receita;
//   2. a PARCELA -- a 6/12 vem com a data da compra de maio. Sem levar para o
//      mes da fatura, ela cairia na fatura de maio, ja paga;
//   3. o FINGERPRINT -- a 5/12 do mes passado e a 6/12 de agora tem a mesma
//      data, valor e descricao. Sem a parcela na chave, a 6/12 seria descartada
//      como repetida e sumiria do app.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { lerExtratoC6, mesDaFaturaPeloNome } = await import("../.tmp-extrato-c6/extrato-c6.js");

const conta = readFileSync(new URL("./fixtures/c6-conta-corrente.csv", import.meta.url), "utf8");
const fatura = readFileSync(new URL("./fixtures/c6-fatura-cartao.csv", import.meta.url), "utf8");

// =====================================================
// Conta corrente
// =====================================================
test("conta: pula o preambulo e le as 8 linhas da tabela", () => {
  const r = lerExtratoC6(conta, { tipo: "conta" });
  assert.equal(r.entries.length, 8);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.format, "csv");
  assert.equal(r.periodStart, "2026-10-01");
  assert.equal(r.periodEnd, "2026-11-03");
});

test("conta: entrada e positiva, saida e negativa", () => {
  const r = lerExtratoC6(conta, { tipo: "conta" });
  assert.equal(r.entries[0].amount, 1500);
  assert.equal(r.entries[1].amount, -2000);
  assert.equal(r.entries[2].amount, -87.35);
  assert.equal(r.entries[7].amount, 25328.47);
});

test("conta: a data e a de lancamento, nao a contabil", () => {
  const r = lerExtratoC6(conta, { tipo: "conta" });
  assert.equal(r.entries[2].postedAt, "2026-10-13");
});

test("conta: titulo vira descricao (sem os espacos do C6) e a descricao do banco vira memo", () => {
  const r = lerExtratoC6(conta, { tipo: "conta" });
  assert.equal(r.entries[1].description, "Pix enviado para BELTRANO DA SILVA");
  assert.equal(r.entries[1].memo, "TRANSF ENVIADA PIX");
  // quando titulo e descricao sao iguais, nao repete
  assert.equal(r.entries[0].memo, null);
});

test("conta: dois Pix recusados identicos no mesmo dia sao dois fatos", () => {
  const r = lerExtratoC6(conta, { tipo: "conta" });
  const recusados = r.entries.filter((e) => e.description === "Pix recusado");
  assert.equal(recusados.length, 2);
  assert.notEqual(recusados[0].fingerprint, recusados[1].fingerprint);
});

test("conta: reler o mesmo arquivo da os mesmos fingerprints", () => {
  const a = lerExtratoC6(conta, { tipo: "conta" }).entries.map((e) => e.fingerprint);
  const b = lerExtratoC6(conta, { tipo: "conta" }).entries.map((e) => e.fingerprint);
  assert.deepEqual(a, b);
});

test("conta: a fatura enviada como conta e recusada com aviso", () => {
  const r = lerExtratoC6(fatura, { tipo: "conta" });
  assert.equal(r.entries.length, 0);
  assert.match(r.warnings.join(" "), /fatura do cart/i);
});

// =====================================================
// Fatura do cartao
// =====================================================
const lerFatura = () => lerExtratoC6(fatura, { tipo: "cartao", mesDaFatura: "2026-11" });

test("cartao: le as 9 linhas da fatura", () => {
  const r = lerFatura();
  assert.equal(r.entries.length, 9);
  assert.deepEqual(r.warnings, []);
});

test("cartao: compra (positiva no C6) vira despesa; estorno e pagamento viram receita", () => {
  const r = lerFatura();
  const por = (d) => r.entries.find((e) => e.description.startsWith(d));
  assert.equal(por("CONTABIL EXEMPLO").amount, -255);
  assert.equal(por("Estorno Tarifa").amount, 98);
  assert.equal(por("Inclusao de Pagamento").amount, 9063.51);
});

test("cartao: parcela 6/12 vai para o dia 1 do mes da fatura, com (6/12) na descricao", () => {
  const e = lerFatura().entries[0];
  assert.equal(e.postedAt, "2026-11-01");
  assert.equal(e.purchaseDate, "2026-05-26");
  assert.equal(e.description, "MP *LOJAEXEMPLO (6/12)");
  assert.equal(e.installmentNumber, 6);
  assert.equal(e.installmentTotal, 12);
  assert.equal(e.amount, -50.82);
});

test("cartao: parcela 1/2 fica na data da compra, e Unica nao ganha sufixo", () => {
  const r = lerFatura();
  const padaria = r.entries.find((e) => e.description.startsWith("PADARIA"));
  assert.equal(padaria.description, "PADARIA EXEMPLO (1/2)");
  assert.equal(padaria.postedAt, "2026-10-30");
  assert.equal(padaria.purchaseDate, null);
  const contabil = r.entries.find((e) => e.description.startsWith("CONTABIL"));
  assert.equal(contabil.description, "CONTABIL EXEMPLO");
  assert.equal(contabil.installmentNumber, null);
});

test("cartao: final do cartao e categoria do C6 vem junto; '-' vira null", () => {
  const r = lerFatura();
  assert.equal(r.entries[0].cardLast4, "1111");
  assert.equal(r.entries[0].bankCategory, "Serviços Profissionais");
  const pagamento = r.entries.find((e) => e.description.startsWith("Inclusao"));
  assert.equal(pagamento.bankCategory, null);
  assert.equal(pagamento.description, "Inclusao de Pagamento");
});

test("cartao: so o pagamento da fatura chega sugerido para cancelar", () => {
  const sugeridos = lerFatura().entries.filter((e) => e.suggestedAction === "ignore");
  assert.deepEqual(sugeridos.map((e) => e.description), ["Inclusao de Pagamento"]);
});

test("cartao: compra em dolar ganha o valor e a cotacao no memo", () => {
  const e = lerFatura().entries.find((x) => x.description.startsWith("SOFTWARE"));
  assert.equal(e.amount, -576.2);
  assert.equal(e.memo, "US$ 109,20 × R$ 5,28");
  assert.equal(e.description, "SOFTWARE* ASSINATURA SA");
});

test("cartao: dois pedagios identicos no mesmo dia sao dois fatos", () => {
  const pedagios = lerFatura().entries.filter((e) => e.description === "PEDAGIO EXEMPLO");
  assert.equal(pedagios.length, 2);
  assert.notEqual(pedagios[0].fingerprint, pedagios[1].fingerprint);
});

test("cartao: a 5/12 da fatura passada e a 6/12 de agora nunca tem o mesmo fingerprint", () => {
  // A mesma compra, com a mesma data de compra, valor e descricao do banco.
  const cabecalho = fatura.split("\r\n")[0];
  const linha = (p) => `26/05/2026;FULANO D TAL;1111;Serviços Profissionais;MP *LOJAEXEMPLO;${p};0;0;50.82`;
  const outubro = lerExtratoC6(`${cabecalho}\r\n${linha("5/12")}\r\n`, { tipo: "cartao", mesDaFatura: "2026-10" });
  const novembro = lerExtratoC6(`${cabecalho}\r\n${linha("6/12")}\r\n`, { tipo: "cartao", mesDaFatura: "2026-11" });
  assert.notEqual(outubro.entries[0].fingerprint, novembro.entries[0].fingerprint);
});

test("cartao: o mesmo cartao com o mesmo gasto em finais diferentes sao dois fatos", () => {
  const cabecalho = fatura.split("\r\n")[0];
  const linha = (f) => `03/11/2026;FULANO D TAL;${f};-;PEDAGIO EXEMPLO;Única;0;0;16.10`;
  const r = lerExtratoC6(`${cabecalho}\r\n${linha("1111")}\r\n${linha("2222")}\r\n`, { tipo: "cartao", mesDaFatura: "2026-11" });
  assert.notEqual(r.entries[0].fingerprint, r.entries[1].fingerprint);
});

test("cartao: sem mes da fatura, a parcela 2+ fica na data da compra e a tela e avisada", () => {
  const r = lerExtratoC6(fatura, { tipo: "cartao" });
  assert.equal(r.entries[0].postedAt, "2026-05-26");
  assert.match(r.warnings.join(" "), /mês da fatura/);
});

test("cartao: o extrato da conta enviado como fatura e recusado com aviso", () => {
  const r = lerExtratoC6(conta, { tipo: "cartao", mesDaFatura: "2026-11" });
  assert.equal(r.entries.length, 0);
  assert.match(r.warnings.join(" "), /extrato da conta/i);
});

test("mes da fatura sai do nome do arquivo do C6", () => {
  assert.equal(mesDaFaturaPeloNome("Fatura_2026-11-20.csv"), "2026-11");
  assert.equal(mesDaFaturaPeloNome("extrato.csv"), null);
  assert.equal(mesDaFaturaPeloNome("Fatura_2026-13-01.csv"), null);
});
