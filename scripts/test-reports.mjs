#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DOS RELATORIOS
// =====================================================
//   npm run test:reports
//
// Exercita lib/services/reports.ts: a janela de meses e o CSV.
//
// Os numeros dos relatorios sao calculados nas views do 008 e provados por
// database/tests/goals_reports_test.sql. O que sobra para o TypeScript sao
// tres coisas que erram em SILENCIO, e e o que este arquivo cobre:
//
//   1. a janela de meses. Um off-by-one faz o grafico de 12 meses mostrar 11
//      ou 13, e ninguem conta as barras.
//   2. o escape do CSV. Uma descricao com ponto e virgula quebra a linha em
//      duas colunas e desloca TODO o resto da planilha -- o usuario abre no
//      Excel e le valores na coluna errada, sem nenhum sinal de erro.
//   3. os cabecalhos do download. Sem o `attachment` o browser mostra a
//      planilha como texto na aba em vez de baixar, e sem o periodo no nome
//      duas exportacoes viram `arquivo.csv` e `arquivo (1).csv`. Nenhum dos
//      dois aparece num teste que olhe so o conteudo do CSV.
//
// Mesmo desenho do test-recurrence.mjs e do test-settlement.mjs: .mjs
// compilado pelo tsc que ja e dependencia, sem runner de teste novo.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  janelaDeMeses,
  mesesDaJanela,
  completarMeses,
  completarPatrimonio,
  campoCsv,
  montarCsv,
  formatarNumeroCsv,
  cabecalhosCsv,
  nomeArquivoCsv,
  rotuloMes,
} = await import("../.tmp-reports/services/reports.js");

// ---------------------------------------------------------------------------
// Janela de meses
// ---------------------------------------------------------------------------

test("a janela inclui o mes corrente", () => {
  const j = janelaDeMeses("12");
  assert.ok(j, "janela de 12 meses deveria ser valida");
  assert.equal(mesesDaJanela(j.inicio, j.meses).length, 12);
  // O ultimo mes da janela E o fim: se `inicio` voltasse `meses` em vez de
  // `meses - 1`, a serie teria 13 pontos ou nao alcancaria o mes atual.
  assert.equal(mesesDaJanela(j.inicio, j.meses).at(-1), j.fim);
});

test("janela de 1 mes e so o mes corrente", () => {
  const j = janelaDeMeses("1");
  assert.equal(j.inicio, j.fim);
  assert.deepEqual(mesesDaJanela(j.inicio, j.meses), [j.fim]);
});

test("sem parametro, a janela e de 12 meses", () => {
  assert.equal(janelaDeMeses(null).meses, 12);
});

test("janela invalida e recusada, nao corrigida em silencio", () => {
  // Devolver uma janela "consertada" faria a tela desenhar um periodo que o
  // usuario nao pediu; a rota prefere 400.
  for (const ruim of ["0", "-3", "61", "abc", "1.5", ""]) {
    assert.equal(janelaDeMeses(ruim), null, `deveria recusar ${JSON.stringify(ruim)}`);
  }
});

test("a janela atravessa a virada de ano", () => {
  // mesesDaJanela e aritmetica pura sobre 'YYYY-MM-01'; um mes 13 aqui seria o
  // bug classico de somar sem normalizar o ano.
  assert.deepEqual(mesesDaJanela("2025-11-01", 4), [
    "2025-11-01",
    "2025-12-01",
    "2026-01-01",
    "2026-02-01",
  ]);
});

// ---------------------------------------------------------------------------
// Meses vazios
// ---------------------------------------------------------------------------

test("mes sem movimento aparece como zero, e nao some", () => {
  // Um grafico que omite o mes vazio desenha uma reta entre outubro e
  // dezembro e sugere gasto constante em novembro, quando o que houve foi
  // nada.
  const preenchido = completarMeses(
    [{ month: "2026-01-01", expense: 500 }],
    "2025-12-01",
    3,
    (mes) => ({ month: mes, expense: 0 }),
  );

  assert.deepEqual(preenchido, [
    { month: "2025-12-01", expense: 0 },
    { month: "2026-01-01", expense: 500 },
    { month: "2026-02-01", expense: 0 },
  ]);
});

test("a ordem e sempre a do calendario, nao a do banco", () => {
  const preenchido = completarMeses(
    [
      { month: "2026-03-01", expense: 3 },
      { month: "2026-01-01", expense: 1 },
    ],
    "2026-01-01",
    3,
    (mes) => ({ month: mes, expense: 0 }),
  );

  assert.deepEqual(
    preenchido.map((l) => l.month),
    ["2026-01-01", "2026-02-01", "2026-03-01"],
  );
});

test("a data vem do Postgres com hora e mesmo assim casa", () => {
  // O PostgREST as vezes devolve 'YYYY-MM-DDT00:00:00'. Sem o slice(0,10) o
  // mes nao casaria com a chave e TODA linha viraria um mes vazio -- o
  // relatorio sairia zerado com dados no banco.
  const preenchido = completarMeses(
    [{ month: "2026-01-01T00:00:00" }],
    "2026-01-01",
    1,
    (mes) => ({ month: mes, vazio: true }),
  );

  assert.equal(preenchido[0].vazio, undefined, "a linha real deveria ter sido aproveitada");
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

test("ponto e virgula na descricao nao quebra a coluna", () => {
  // O caso que corrompe a planilha em silencio: o separador e `;`, entao uma
  // descricao com `;` viraria duas colunas e deslocaria todo o resto da linha.
  assert.equal(campoCsv("Mercado; feira"), '"Mercado; feira"');
});

test("aspas sao dobradas", () => {
  assert.equal(campoCsv('Mercado "do Ze"'), '"Mercado ""do Ze"""');
});

test("quebra de linha na observacao nao vira linha nova da planilha", () => {
  assert.equal(campoCsv("linha1\nlinha2"), '"linha1\nlinha2"');
});

test("texto simples nao ganha aspas a toa", () => {
  assert.equal(campoCsv("Mercado"), "Mercado");
  assert.equal(campoCsv(null), "");
  assert.equal(campoCsv(undefined), "");
});

test("numero sai com virgula decimal, como o Excel pt-BR espera", () => {
  assert.equal(formatarNumeroCsv(1234.5), "1234,50");
  // Despesa exportada no extrato mantem o sinal do banco: e o que faz a coluna
  // somar sozinha para o saldo do periodo.
  assert.equal(formatarNumeroCsv(-800), "-800,00");
  assert.equal(formatarNumeroCsv(0), "0,00");
});

test("o CSV comeca com BOM", () => {
  // Sem o BOM o Excel le como ANSI e "Alimentação" vira "AlimentaÃ§Ã£o" na
  // coluna inteira.
  const csv = montarCsv(["Mês"], [["Alimentação"]]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
});

test("o CSV inteiro fica com o numero certo de colunas", () => {
  const csv = montarCsv(
    ["Data", "Descrição", "Valor"],
    [
      ["01/09/26", "Mercado; feira", -800],
      ["02/09/26", 'Uber "pro trampo"', -32.5],
    ],
  );

  const linhas = csv.replace(/^﻿/, "").trimEnd().split("\r\n");
  assert.equal(linhas.length, 3, "cabecalho + duas linhas");

  // Conta os `;` FORA de aspas: e exatamente o que o Excel faz ao separar.
  const separadoresForaDeAspas = (linha) => {
    let dentro = false;
    let n = 0;
    for (const c of linha) {
      if (c === '"') dentro = !dentro;
      else if (c === ";" && !dentro) n++;
    }
    return n;
  };

  for (const linha of linhas) {
    assert.equal(
      separadoresForaDeAspas(linha),
      2,
      `a linha deslocaria a planilha: ${linha}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Download: cabecalho HTTP e nome do arquivo
// ---------------------------------------------------------------------------
// O CSV so chega ao usuario como ARQUIVO por causa destes cabecalhos. Sem o
// `attachment` o browser exibe a planilha como texto na aba e nao baixa nada;
// o usuario ve uma tela de `Mês;Entradas;...` e conclui que a exportacao
// quebrou. Nada disso aparece num teste do conteudo do CSV.

test("o browser baixa o arquivo em vez de exibi-lo na aba", () => {
  const h = cabecalhosCsv("extrato-2026-01-a-2026-09.csv");

  assert.equal(h["Content-Type"], "text/csv; charset=utf-8");
  assert.match(h["Content-Disposition"], /^attachment;/);
  assert.equal(
    h["Content-Disposition"],
    'attachment; filename="extrato-2026-01-a-2026-09.csv"',
  );
});

test("o relatorio nao fica em cache de proxy", () => {
  // Cache compartilhado com extrato financeiro dentro: o proximo usuario da
  // mesma rede receberia o relatorio do anterior.
  assert.equal(cabecalhosCsv("extrato.csv")["Cache-Control"], "no-store");
});

test("aspas no nome nao escapam do cabecalho", () => {
  // Uma aspa fecharia o filename="..." no meio; uma quebra de linha encerraria
  // o cabecalho e o resto do nome viraria um cabecalho HTTP proprio.
  const h = cabecalhosCsv('extrato";\r\nX-Injetado: 1.csv');

  assert.equal(h["Content-Disposition"].split("\r\n").length, 1);
  assert.equal(
    (h["Content-Disposition"].match(/"/g) ?? []).length,
    2,
    "o filename tem que ter exatamente as duas aspas que o delimitam",
  );
});

test("o nome do arquivo carrega o periodo exportado", () => {
  // Sem o periodo no nome, exportar 3 e depois 12 meses deixa na pasta de
  // downloads um `fluxo-de-caixa.csv` e um `fluxo-de-caixa (1).csv`, que sao
  // indistinguiveis sem abrir os dois.
  assert.equal(
    nomeArquivoCsv("fluxo-de-caixa", {
      inicio: "2025-10-01",
      fim: "2026-09-01",
    }),
    "fluxo-de-caixa-2025-10-a-2026-09.csv",
  );
});

test("o nome sai do periodo REAL, e nao dos 12 meses do padrao", () => {
  // A tela exporta a janela que o usuario selecionou. Um nome fixo em 12 meses
  // sobre uma exportacao de 3 arquiva o arquivo com o periodo errado.
  const janela = janelaDeMeses("3");
  const nome = nomeArquivoCsv("extrato", janela);

  assert.equal(nome, `extrato-${janela.inicio.slice(0, 7)}-a-${janela.fim.slice(0, 7)}.csv`);
  assert.ok(nome.endsWith(".csv"));
});

test("janela de um mes nao vira nome quebrado", () => {
  const janela = janelaDeMeses("1");
  assert.equal(janela.inicio, janela.fim);
  assert.match(
    nomeArquivoCsv("patrimonio", janela),
    /^patrimonio-\d{4}-\d{2}-a-\d{4}-\d{2}\.csv$/,
  );
});

test("rotuloMes nao passa por Date", () => {
  // new Date('2026-01-01') e lido como UTC e, no fuso do Brasil, voltaria para
  // dezembro de 2025 -- o relatorio inteiro sairia um mes atrasado.
  assert.equal(rotuloMes("2026-01-01"), "01/2026");
  assert.equal(rotuloMes("2026-12-01"), "12/2026");
});

// ---------------------------------------------------------------------------
// completarPatrimonio  (preenchimento para a FRENTE)
// ---------------------------------------------------------------------------
// Patrimonio e saldo, nao fluxo. O mes sem transacao nenhuma nao tem linha na
// view, e o valor dele nao e zero -- e o mesmo do mes anterior. Estes testes
// separam `completarPatrimonio` de `completarMeses`, que faz o oposto.

test("o mes sem movimento herda o patrimonio do mes anterior", () => {
  const linhas = completarPatrimonio(
    [
      { month: "2026-01-01", net_change: 1000, net_worth: 5000 },
      { month: "2026-03-01", net_change: 200, net_worth: 5200 },
    ],
    "2026-01-01",
    3,
  );

  assert.equal(linhas.length, 3);
  // Fevereiro nao tem linha na view. Com zero, o grafico desenharia um "V" de
  // 5000 ate a origem e de volta a 5200 -- uma queda que nunca aconteceu.
  assert.equal(linhas[1].month, "2026-02-01");
  assert.equal(linhas[1].net_worth, 5000, "fevereiro herda janeiro");
  assert.equal(linhas[1].net_change, 0, "sem movimento, variacao zero");
});

test("os meses antes do primeiro dado ficam em zero", () => {
  // Nao ha de onde herdar para tras. Repetir o primeiro valor desenharia uma
  // reta de patrimonio que ninguem mediu.
  const linhas = completarPatrimonio(
    [{ month: "2026-03-01", net_change: 900, net_worth: 900 }],
    "2026-01-01",
    3,
  );

  assert.equal(linhas[0].net_worth, 0);
  assert.equal(linhas[1].net_worth, 0);
  assert.equal(linhas[2].net_worth, 900);
});

test("o preenchimento tolera a data com hora que o PostgREST devolve", () => {
  const linhas = completarPatrimonio(
    [{ month: "2026-01-01T00:00:00+00:00", net_change: 10, net_worth: 700 }],
    "2026-01-01",
    2,
  );

  assert.equal(linhas[0].net_worth, 700, "a linha casou com o mes");
  assert.equal(linhas[1].net_worth, 700, "e fevereiro herdou dela");
});

test("janela sem nenhuma linha devolve a janela inteira em zero", () => {
  const linhas = completarPatrimonio([], "2026-01-01", 2);
  assert.equal(linhas.length, 2);
  assert.deepEqual(
    linhas.map((l) => l.net_worth),
    [0, 0],
  );
});
