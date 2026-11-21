// =====================================================
// Teste da leitura do CSV do Mercado Pago (lib/extrato-mercadopago.ts)
// e da sugestao de transferencia entre contas proprias (lib/statement.ts)
// =====================================================
// Roda o JavaScript COMPILADO: `npm run test:extrato-c6` compila antes.
//
// O fixture scripts/fixtures/mercadopago-conta.csv copia o FORMATO do arquivo
// que o Mercado Pago exporta (resumo no topo, ';', valores em portugues,
// data dd-mm-aaaa), com nomes, ids e valores inventados. Os valores esperados
// sao escritos a mao a partir do fixture.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { lerExtratoMercadoPago } = await import("../.tmp-extrato-c6/extrato-mercadopago.js");
const { pareceTransferenciaPropria } = await import("../.tmp-extrato-c6/statement.js");

const extrato = readFileSync(new URL("./fixtures/mercadopago-conta.csv", import.meta.url), "utf8");

test("mercado pago: le as 7 linhas, com o periodo e sem aviso", () => {
  const r = lerExtratoMercadoPago(extrato);
  assert.equal(r.entries.length, 7);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.periodStart, "2026-09-01");
  assert.equal(r.periodEnd, "2026-09-18");
});

test("mercado pago: o valor em portugues e o sinal do arquivo", () => {
  const r = lerExtratoMercadoPago(extrato);
  assert.equal(r.entries[0].amount, -12.5);
  assert.equal(r.entries[1].amount, 1.42);
  assert.equal(r.entries[4].amount, -1168, "1.168,00 nao pode virar 1,168");
  assert.equal(r.entries[5].amount, 3500);
});

test("mercado pago: a data dd-mm-aaaa e a descricao sem espaco sobrando", () => {
  const r = lerExtratoMercadoPago(extrato);
  assert.equal(r.entries[2].postedAt, "2026-09-02");
  assert.equal(r.entries[1].description, "Rendimentos");
});

test("mercado pago: o fingerprint vem do REFERENCE_ID", () => {
  const r = lerExtratoMercadoPago(extrato);
  assert.equal(r.entries[0].fitId, "mp:100000000001");
  assert.equal(r.entries[0].fingerprint, "fitid:mp:100000000001");
  assert.equal(new Set(r.entries.map((e) => e.fingerprint)).size, 7);
});

test("mercado pago: linha faltando aparece na conferencia com o resumo", () => {
  const semUma = extrato.split("\n").filter((l) => !l.includes("100000000007")).join("\n");
  const r = lerExtratoMercadoPago(semUma);
  assert.equal(r.entries.length, 6);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /Confira se o arquivo está completo/);
});

test("mercado pago: arquivo de outro formato nao le nada e diz o motivo", () => {
  const r = lerExtratoMercadoPago("Data;Descricao;Valor\n01/09/2026;X;-10,00");
  assert.equal(r.entries.length, 0);
  assert.match(r.warnings[0], /Mercado Pago/);
});

// =====================================================
// Transferencia entre contas proprias
// =====================================================
const TITULAR = "Fulano de Tal Souza";

test("pix de e para o titular sugere transferencia", () => {
  assert.equal(pareceTransferenciaPropria("Pix enviado Fulano de Tal Souza", TITULAR), "titular");
  assert.equal(pareceTransferenciaPropria("Transferência recebida FULANO DE TAL SOUZA", TITULAR), "titular");
  assert.equal(pareceTransferenciaPropria("Pix recebido de FULANO TAL SOUZA", TITULAR), "titular", "sem o 'de'");
  assert.equal(
    pareceTransferenciaPropria("Pix recebido de FULANO DE TAL SOUZA DESENVOLVIMENTO DE SOFTWARE LTDA", TITULAR),
    "titular",
    "a empresa do titular tambem"
  );
});

test("parente com o mesmo sobrenome NAO e transferencia", () => {
  assert.equal(pareceTransferenciaPropria("Pix enviado para CICLANO DE TAL SOUZA", TITULAR), null);
  assert.equal(pareceTransferenciaPropria("Pix recebido de Beltrana Tal Souza", TITULAR), null);
});

test("compra ou pagamento com o nome do titular no meio nao e transferencia", () => {
  assert.equal(pareceTransferenciaPropria("Rendimentos", TITULAR), null);
  assert.equal(pareceTransferenciaPropria("Pagamento com QR Pix LOJA EXEMPLO LTDA", TITULAR), null);
});

test("nome com uma palavra so nao sugere nada", () => {
  assert.equal(pareceTransferenciaPropria("Pix enviado Fulano", "Fulano"), null);
  assert.equal(pareceTransferenciaPropria("Pix enviado Fulano de Tal Souza", null), null);
});

test("dinheiro reservado no proprio banco e transferencia, sem depender do nome", () => {
  assert.equal(pareceTransferenciaPropria("Dinheiro reservado Emergências", null), "reserva");
  assert.equal(pareceTransferenciaPropria("Dinheiro retirado", null), "reserva");
});
