// O contrato entre o painel do grupo e a rota de fluxo de caixa (HMO-201).
//
// POR QUE ESTE TESTE E DE TEXTO, E NAO DE COMPORTAMENTO
// -----------------------------------------------------
// O defeito que ele existe para pegar nao e de calculo: os dois lados estavam
// certos sozinhos. `PainelDoGrupo` declara `ResumoDoFluxo` com
// `transaction_count`, e a rota SABIA a contagem (vinha de `monthly_cash_flow`,
// e ela ja era usada para `months_with_activity`). O que faltava era a rota
// COLOCAR o campo no `summary` do grao `mes`.
//
// Nada reclamava. `await res.json()` e `any`, entao atribuir a resposta a
// `ResumoDoFluxo` nao e checado pelo tsc -- o campo chegava `undefined`, o
// `?? 0` do tile o transformava em ZERO, e a tela mostrava "Lancamentos: 0"
// em cima de um mes com gasto. Medido em producao: grupo com 180 USD de
// despesa, `months[0].transaction_count = 1`, tile exibindo 0.
//
// E era o caso COMUM, nao a borda: o grao `intervalo` devolvia o campo, o grao
// `mes` nao, e o periodo default do painel (o mes corrente) e um mes fechado --
// ou seja, o caminho que todo mundo abre primeiro era justamente o quebrado.
//
// Um teste de comportamento aqui exigiria subir a rota com Supabase. O que
// quebrou foi a FORMA da resposta, e e isso que este teste tranca.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROTA = "app/api/reports/cash-flow/route.ts";
const PAINEL = "components/grupos/PainelDoGrupo.tsx";

const rota = readFileSync(ROTA, "utf8");
const painel = readFileSync(PAINEL, "utf8");

/** Os campos que o painel le do `summary`, lidos da interface dele. */
function camposQueOPainelLe(fonte) {
  const bloco = fonte.match(/interface ResumoDoFluxo \{([\s\S]*?)\n\}/);
  assert.ok(
    bloco,
    `Nao achei a interface ResumoDoFluxo em ${PAINEL}. Se ela foi renomeada, ` +
      `atualize este teste -- nao o apague: ele e o unico lugar que liga os ` +
      `dois arquivos, porque o tsc nao liga.`
  );
  return bloco[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("*"))
    .map((l) => l.match(/^([a-z_]+)\??\s*:/i))
    .filter(Boolean)
    .map((m) => m[1]);
}

/**
 * Todo literal `summary: { ... }` da rota, com as chaves do primeiro nivel.
 *
 * Literal com spread (`...resumo`) e pulado: ele delega a forma a outro objeto,
 * e exigir as chaves ali daria um teste que reprova codigo correto.
 */
function literaisDeSummary(fonte) {
  const achados = [];
  const marca = /summary:\s*\{/g;
  let m;

  while ((m = marca.exec(fonte)) !== null) {
    const abre = m.index + m[0].length - 1;
    let profundidade = 0;
    let fim = -1;

    for (let i = abre; i < fonte.length; i++) {
      if (fonte[i] === "{") profundidade++;
      else if (fonte[i] === "}") {
        profundidade--;
        if (profundidade === 0) {
          fim = i;
          break;
        }
      }
    }

    assert.notEqual(fim, -1, `Chave nao fechada perto do byte ${abre}`);
    const corpo = fonte.slice(abre + 1, fim);
    if (corpo.includes("...")) continue;

    const linha = fonte.slice(0, m.index).split("\n").length;
    const chaves = [];
    let nivel = 0;
    for (const bruta of corpo.split("\n")) {
      const l = bruta.trim();
      const chave = nivel === 0 && l.match(/^([a-z_]+)\s*:/i);
      if (chave) chaves.push(chave[1]);
      for (const c of l) {
        if (c === "{" || c === "[" || c === "(") nivel++;
        if (c === "}" || c === "]" || c === ")") nivel--;
      }
    }
    achados.push({ linha, chaves });
  }

  return achados;
}

test("o painel do grupo le campos que a rota realmente devolve", () => {
  const esperados = camposQueOPainelLe(painel);

  // Se a interface ficar vazia o teste passaria vazio -- o verde seria do
  // parser ter falhado, nao do contrato estar de pe.
  assert.ok(
    esperados.includes("transaction_count"),
    "ResumoDoFluxo deveria declarar transaction_count; se o tile Lancamentos " +
      "saiu da tela, remova o tile E este teste no mesmo commit."
  );
  assert.ok(esperados.length >= 4, `campos lidos: ${esperados.join(", ")}`);

  const literais = literaisDeSummary(rota);
  assert.ok(
    literais.length >= 2,
    `Esperava pelo menos 2 literais de summary em ${ROTA}, achei ${literais.length}`
  );

  for (const { linha, chaves } of literais) {
    for (const campo of esperados) {
      assert.ok(
        chaves.includes(campo),
        `${ROTA}:${linha} devolve um summary sem "${campo}", e ` +
          `${PAINEL} le esse campo. Como res.json() e any, o tsc nao acusa: ` +
          `o campo chega undefined e o tile mostra 0 em cima de dado real. ` +
          `Chaves presentes: ${chaves.join(", ")}`
      );
    }
  }
});

test("o tile de lancamentos nao vira zero silencioso", () => {
  // O `?? 0` e o que transformou "campo ausente" em "zero crivel". Ele pode
  // ficar -- mas se alguem trocar a fonte do numero por uma constante, ou
  // tirar o campo da leitura, o tile volta a mentir sem ninguem ver.
  assert.match(
    painel,
    /fluxo\?\.transaction_count/,
    "O tile Lancamentos deve ler transaction_count do fluxo; se a fonte do " +
      "numero mudou, atualize o contrato no teste acima junto."
  );
});
