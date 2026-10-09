// =====================================================
// PULODOGATO - A DATA QUE A TELA ESCREVE (HMO-353)
// =====================================================
//   npm run test:data-na-tela
//
// A suite roda DUAS vezes, em `America/Sao_Paulo` e em `UTC`, e a razao nao e
// zelo: em UTC o codigo defeituoso e o consertado imprimem o MESMO dia. Uma
// suite rodando so em UTC -- que e o fuso do runner do GitHub Actions -- passa
// verde com o defeito intacto, e passa justamente no ambiente que decide se o
// PR entra. Ja aconteceu neste repositorio: na HMO-210 um mutante de `new Date`
// morreu nesta maquina e SOBREVIVEU em CI, mesmo commit, mesma suite.
//
// Por isso o primeiro bloco afirma a PREMISSA. Sem ele, rodar `node --test`
// direto (sem o `TZ=` do npm script) deixaria de medir em silencio, em vez de
// falhar.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  dataNaTela,
  dataCurtaNaTela,
  dataOuMomentoNaTela,
  ehSoData,
} from "../.tmp-data-na-tela/data-na-tela.js";

const FUSO = Intl.DateTimeFormat().resolvedOptions().timeZone;
const EM_SAO_PAULO = FUSO === "America/Sao_Paulo";

test("a premissa: o fuso e um dos dois que o npm script pede", () => {
  assert.ok(
    EM_SAO_PAULO || FUSO === "UTC",
    `o fuso e ${FUSO}. Rode pelo npm script (test:data-na-tela), que fixa ` +
      "TZ=America/Sao_Paulo e TZ=UTC. Sem fuso fixo esta suite nao mede nada."
  );
});

test("o defeito EXISTE no fuso do usuario, e some em UTC", () => {
  // Este e o controle que justifica a suite inteira. Ele chama o codigo
  // DEFEITUOSO de proposito -- `new Date` cru sobre a coluna `date` -- e exige
  // que ele erre em Sao Paulo. Se um dia parar de errar aqui, a suite inteira
  // virou cerimonia e este teste e quem avisa.
  const cru = new Date("2026-10-09").toLocaleDateString("pt-BR");

  if (EM_SAO_PAULO) {
    assert.equal(
      cru,
      "08/10/2026",
      "`new Date('2026-10-09')` deixou de recuar um dia em America/Sao_Paulo. " +
        "Ou o fuso nao esta aplicado, ou o motor mudou: remeca o defeito antes " +
        "de confiar em qualquer verde desta suite."
    );
  } else {
    assert.equal(
      cru,
      "09/10/2026",
      "em UTC o defeito nao se manifesta -- e por isso que rodar so em UTC " +
        "aprova o codigo defeituoso."
    );
  }
});

test("dataNaTela escreve o dia que esta na string, nos dois fusos", () => {
  assert.equal(dataNaTela("2026-10-09"), "09/10/2026");
  assert.equal(dataNaTela("2026-01-01"), "01/01/2026");
  assert.equal(dataNaTela("2026-12-31"), "31/12/2026");
  assert.equal(dataNaTela("2024-02-29"), "29/02/2024");
});

test("o dia 1 do mes nao cai no mes anterior", () => {
  // O caso que fazia a lista se contradizer com os cartoes de periodo da mesma
  // tela: a despesa de 01/10 aparecia como 30/09, ao lado de um recorte que
  // (corretamente) a contava em outubro.
  assert.equal(dataNaTela("2026-10-01"), "01/10/2026");
  assert.equal(dataNaTela("2026-03-01"), "01/03/2026");
  assert.equal(dataNaTela("2027-01-01"), "01/01/2027");
});

test("dataNaTela nao inventa 01/01/1970 para data ausente", () => {
  // `new Date(null)` e a epoch e `new Date(undefined)` e Invalid Date: a tela
  // escrevia "01/01/1970" ou "Invalid Date" onde nao ha data.
  assert.equal(dataNaTela(null), "");
  assert.equal(dataNaTela(undefined), "");
  assert.equal(dataNaTela(""), "");
  assert.equal(dataNaTela("2026-02-31"), "");
  assert.equal(dataNaTela("09/10/2026"), "");
  assert.equal(dataNaTela("2026-10-09T00:00:00Z"), "");
});

test("dataCurtaNaTela nao recua o ultimo dia do mes", () => {
  // O eixo do grafico de evolucao: cada ponto e o fim de um mes.
  assert.equal(dataCurtaNaTela("2026-10-31"), "31 de out.");
  assert.equal(dataCurtaNaTela("2026-02-28"), "28 de fev.");
  assert.equal(dataCurtaNaTela("2026-12-31"), "31 de dez.");
  assert.equal(dataCurtaNaTela("2026-01-01"), "1 de jan.");
});

test("dataCurtaNaTela recusa o que nao e um dia do calendario", () => {
  assert.equal(dataCurtaNaTela(null), "");
  assert.equal(dataCurtaNaTela(undefined), "");
  assert.equal(dataCurtaNaTela(""), "");
  assert.equal(dataCurtaNaTela("2026-10"), "");
});

test("dataOuMomentoNaTela separa o DIA do INSTANTE", () => {
  // Coluna `date` -> parse textual, sem fuso. E o caso de `settled_on` e
  // `today_rate_date`, que `formatDate` recebia e recuava.
  assert.equal(dataOuMomentoNaTela("2026-10-09"), "09/10/2026");
  assert.equal(dataOuMomentoNaTela("2026-10-01"), "01/10/2026");

  // Coluna `timestamptz` -> o instante continua lido no fuso LOCAL, que e o que
  // a pessoa quer ver. 2026-10-09 as 12:00Z e 09/10 nos dois fusos; o que o
  // teste afirma e que o caminho do instante continua vivo.
  assert.equal(dataOuMomentoNaTela("2026-10-09T12:00:00Z"), "09/10/2026");
  assert.equal(
    dataOuMomentoNaTela(new Date(Date.UTC(2026, 9, 9, 12, 0, 0))),
    "09/10/2026"
  );
});

test("dataOuMomentoNaTela le o instante no fuso local, e nao em UTC", () => {
  // A prova de que o ramo do instante NAO foi textualizado junto: 2026-10-10 as
  // 01:00Z ainda e 09/10 em Sao Paulo (UTC-3) e ja e 10/10 em UTC. Um conserto
  // que mandasse tudo pelo parse textual perderia essa distincao -- e e a
  // distincao que faz "criado em" dizer a verdade para quem ve a tela.
  const instante = "2026-10-10T01:00:00Z";
  assert.equal(
    dataOuMomentoNaTela(instante),
    EM_SAO_PAULO ? "09/10/2026" : "10/10/2026"
  );
});

test("dataOuMomentoNaTela nao derruba a tela com data ruim", () => {
  // `Intl.format` de um Date NaN lanca RangeError. Uma linha ruim no banco nao
  // pode virar tela branca.
  assert.equal(dataOuMomentoNaTela(null), "");
  assert.equal(dataOuMomentoNaTela(undefined), "");
  assert.equal(dataOuMomentoNaTela(""), "");
  assert.equal(dataOuMomentoNaTela("nao e data"), "");
  assert.equal(dataOuMomentoNaTela(new Date("x")), "");
});

test("ehSoData distingue a coluna date da timestamptz", () => {
  assert.equal(ehSoData("2026-10-09"), true);
  assert.equal(ehSoData("2026-10-09T00:00:00Z"), false);
  assert.equal(ehSoData("2026-10-09 00:00:00+00"), false);
  assert.equal(ehSoData(null), false);
  assert.equal(ehSoData(new Date()), false);

  // Sem `g` no regex: com a flag global, `lastIndex` sobrevive entre chamadas e
  // a MESMA entrada alternaria verdadeiro/falso.
  assert.equal(ehSoData("2026-10-09"), true);
  assert.equal(ehSoData("2026-10-09"), true);
});
