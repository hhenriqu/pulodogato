// =====================================================
// A CAUSA NA LINHA DO `ABORTADO`
// =====================================================
//   npm run test:causa-da-reprovacao
//
// Mede `resumoDaReprovacao`, de `scripts/mutantes-em-bloco.mjs`: o texto que os
// 45 runners convertidos imprimem quando o CONTROLE POSITIVO reprova, isto e,
// quando a arvore intacta ja esta vermelha e o placar de mutantes nao valeria.
//
// O DEFEITO QUE ESTA SUITE TRANCA (HMO-405)
// -----------------------------------------
// Ate a HMO-405 essa funcao se chamava `testesQueReprovaram` e devolvia so os
// NOMES dos casos que falharam. O nome do caso e exatamente a parte que mente
// quando a suite quebra por motivo ESTRUTURAL. Rodando
// `scripts/mutantes-detalhe-do-painel.mjs` sem Chromium alcancavel, o abort era:
//
//     ABORTADO: a arvore INTACTA reprova em test:papel-na-tela (teste).
//       o navegador rodou e reportou as duas paginas; A: a conta nova abre [...]
//
// "o navegador rodou e reportou as duas paginas" se le como navegador que rodou
// e NAO reportou -- defeito do app. A frase que resolve (`Aponte CHROMIUM_BIN
// para um binario`) estava na saida da suite, na 62a linha, e era descartada
// aqui. E o preflight e justamente a parte do runner que existe para impedir
// placar falso: ele produzia uma mensagem que se le como "a main esta
// quebrada", e numa issue sobre guarda vermelha isso passa por confirmacao do
// defeito investigado. Custou o diagnostico errado duas vezes na HMO-375.
//
// POR QUE OS FIXTURES SAO SAIDA DE VERDADE, E NAO MONTADOS A MAO
// --------------------------------------------------------------
// `scripts/fixtures/node-test-sem-chromium.txt` e a saida literal de
// `node --test scripts/test-papel-na-tela.mjs` com os candidatos de Chromium
// inalcancaveis, capturada em 2026-10-13. Normalizado dela: o prefixo absoluto
// do worktree (-> `/repo/`) e os tempos por caso (-> `0ms`), que variam a cada
// corrida. Nada que esta suite afirma le path nem tempo.
//
// Isso importa porque a FORMA da saida do `node --test` e o contrato de
// verdade, e uma suite que passasse a propria string inventada mediria o
// extrator contra a suposicao de quem o escreveu -- a familia de defeito
// "teste que passa a propria string nao ve o argumento errado". Em particular a
// forma `AssertionError [ERR_ASSERTION]: ...`, com sufixo entre colchetes antes
// dos dois-pontos, nao foi adivinhada: ela vem do segundo fixture.
//
// O NUMERO QUE PRECISA DE FIXTURE GRANDE
// --------------------------------------
// As 47 falhas daquela corrida tem 34 textos de erro DISTINTOS: um
// `Error: Nenhum Chromium encontrado [...]` e 33 `Cannot read properties of
// null (reading 'X')`, um por campo lido da pagina que nunca abriu. Contadas
// cruas, as 33 derivadas afogam a unica que diz o que fazer -- e por isso que
// `formaDaCausa` colapsa por FORMA e as 34 viram 2 familias. So um fixture com
// as 47 falhas de verdade mede esse colapso; um recorte de tres linhas passaria
// verde com o agrupamento removido.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resumoDaReprovacao } from "./mutantes-em-bloco.mjs";

const SEM_CHROMIUM = readFileSync("scripts/fixtures/node-test-sem-chromium.txt", "utf8");
const ASSERCAO = readFileSync("scripts/fixtures/node-test-assercao.txt", "utf8");

// =====================================================
// 1. O FIXTURE E O QUE EU DIGO QUE ELE E
// =====================================================
// Sem isto o resto da suite pode passar verde sobre um fixture trocado ou
// truncado -- e as duas assercoes seguintes afirmam numeros (47, 34) que so
// significam algo se vierem deste texto.

test("o fixture sem Chromium e a saida de uma suite de navegador que reprovou inteira", () => {
  assert.match(SEM_CHROMIUM, /^ℹ fail 47$/m, "o fixture tem de ter as 47 falhas");
  assert.match(SEM_CHROMIUM, /^ℹ pass 1$/m);
  assert.match(
    SEM_CHROMIUM,
    /Error: Nenhum Chromium encontrado\. Aponte CHROMIUM_BIN/,
    "a causa de verdade tem de estar no fixture -- e ela que era descartada"
  );
  // E ela esta ENTERRADA: nao e a primeira linha, e nenhum olho a acha rolando.
  const linhas = SEM_CHROMIUM.split("\n");
  const onde = linhas.findIndex((l) => /Nenhum Chromium encontrado/.test(l));
  assert.ok(onde > 50, `a causa esta na linha ${onde + 1}, esperava enterrada`);
});

test("o fixture de assercao traz a forma com colchete, que o extrator precisa ler", () => {
  assert.match(ASSERCAO, /^ {2}AssertionError \[ERR_ASSERTION\]: /m);
  assert.match(ASSERCAO, /^ℹ fail 1$/m);
});

// =====================================================
// 2. A LINHA NOMEIA `CHROMIUM_BIN` -- o "pronto quando" da HMO-405
// =====================================================

test("sem Chromium, o resumo NOMEIA CHROMIUM_BIN", () => {
  const r = resumoDaReprovacao(SEM_CHROMIUM);
  assert.match(
    r,
    /CHROMIUM_BIN/,
    `a palavra que resolve o problema nao saiu na linha do ABORTADO: ${r}`
  );
});

test("sem Chromium, o resumo traz a instrucao inteira, nao so o nome da variavel", () => {
  const r = resumoDaReprovacao(SEM_CHROMIUM);
  assert.match(r, /Nenhum Chromium encontrado/);
  assert.match(r, /Aponte CHROMIUM_BIN para um binario/);
});

// =====================================================
// 3. A CONTAGEM DIZ "ESTRUTURAL", QUE E A OUTRA METADE DO DIAGNOSTICO
// =====================================================
// 47 casos reprovando de uma vez nao e assercao: e aparelho. Quem le a linha
// decide por esse numero se procura o bug no app ou no ambiente.

test("o resumo conta os casos que reprovaram", () => {
  assert.match(resumoDaReprovacao(SEM_CHROMIUM), /\b47 caso\(s\) reprovaram/);
  assert.match(resumoDaReprovacao(ASSERCAO), /\b1 caso\(s\) reprovaram/);
});

// =====================================================
// 4. AS 34 CAUSAS DISTINTAS COLAPSAM EM 2 FAMILIAS
// =====================================================
// Esta e a assercao que justifica `formaDaCausa`. Sem o colapso, as duas vagas
// de causa sairiam ocupadas por dois `Cannot read properties of null` e a linha
// voltaria a nao dizer `CHROMIUM_BIN` -- com a contagem certa e tudo.

test("as causas derivadas nao ocupam as vagas da causa que resolve", () => {
  const r = resumoDaReprovacao(SEM_CHROMIUM);

  // As 34 cruas estao la, no fixture, e sao 34 mesmo.
  const cruas = new Set(
    [...SEM_CHROMIUM.matchAll(/^ *([A-Za-z]*Error\b[^:\n]*: .+)$/gm)].map((m) => m[1])
  );
  assert.equal(cruas.size, 34, "o fixture tem 34 textos de erro distintos");

  // E o resumo nao se deixa afogar por elas: a familia derivada entra UMA vez.
  const derivadas = r.match(/Cannot read properties of null/g) ?? [];
  assert.equal(
    derivadas.length,
    1,
    `a familia derivada ocupou ${derivadas.length} vagas; deveria ocupar 1`
  );
  assert.match(r, /CHROMIUM_BIN/, "e a causa que resolve continua na linha");
});

// =====================================================
// 4b. E O COLAPSO AGUENTA OUTRA ORDEM DE CASOS
// =====================================================
// A medicao acima nao prova `formaDaCausa` sozinha, e isto foi descoberto pelo
// runner de mutantes, nao suposto: naquele fixture a causa do Chromium e a
// PRIMEIRA da saida (o caso que abre o navegador roda primeiro), entao as duas
// vagas de causa sairiam certas mesmo sem colapso nenhum -- o mutante que
// desliga `formaDaCausa` SOBREVIVIA com as assercoes de 1 a 4.
//
// E a ordem dos casos nao e garantia de nada: basta a sonda nao abrir o
// navegador no primeiro caso. Reordenar os blocos da secao `failing tests:` e
// exatamente o texto que essa outra ordem produziria -- nenhuma linha e
// inventada aqui, elas sao as mesmas 47 falhas de verdade em outra sequencia.
//
// Medido: com a causa do Chromium no FIM, o modo cru acha 34 familias e as duas
// vagas saem com dois `Cannot read properties of null`; o colapso acha 2 e a
// linha continua dizendo o que fazer.

/** As 47 falhas reais, com o bloco do Chromium movido para o fim da secao. */
function comOChromiumNoFim(saida) {
  const i = saida.indexOf("✖ failing tests:");
  assert.ok(i > 0, "o fixture tem de ter a secao `failing tests:`");
  const blocos = saida.slice(i).split(/(?=\ntest at )/);
  const qual = blocos.findIndex((b) => /Nenhum Chromium/.test(b));
  assert.ok(qual > 0, "o bloco do Chromium tem de estar na secao");
  const [bloco] = blocos.splice(qual, 1);
  blocos.push(bloco);
  return saida.slice(0, i) + blocos.join("");
}

test("a causa que resolve sobrevive mesmo nao sendo a primeira da saida", () => {
  const permutado = comOChromiumNoFim(SEM_CHROMIUM);

  // A permutacao nao perdeu nem inventou falha nenhuma.
  assert.equal(
    (permutado.match(/Nenhum Chromium encontrado/g) ?? []).length,
    (SEM_CHROMIUM.match(/Nenhum Chromium encontrado/g) ?? []).length
  );
  assert.equal(permutado.length, SEM_CHROMIUM.length, "a permutacao nao muda o texto");
  assert.notEqual(permutado, SEM_CHROMIUM, "mas muda a ORDEM -- senao nao mede nada");

  const r = resumoDaReprovacao(permutado);
  assert.match(
    r,
    /CHROMIUM_BIN/,
    `com a causa fora da primeira posicao a linha parou de dizer o que fazer: ${r}`
  );
  assert.match(r, /\b47 caso\(s\) reprovaram/, "e a contagem nao muda com a ordem");
});

// =====================================================
// 5. A ORDEM: CONTAGEM, CAUSA, NOMES
// =====================================================
// Deliberada, e nao cosmetica: se algum consumidor truncar a linha, o que tem
// de sobrar e a parte que diagnostica. Ate a HMO-405 o nome do caso vinha
// primeiro e era a UNICA coisa que vinha.

test("a causa vem antes dos nomes dos casos", () => {
  const r = resumoDaReprovacao(SEM_CHROMIUM);
  const causa = r.indexOf("causa:");
  const casos = r.indexOf("casos:");
  assert.ok(causa > 0, "faltou o campo `causa:`");
  assert.ok(casos > 0, "faltou o campo `casos:`");
  assert.ok(
    causa < casos,
    `a causa saiu DEPOIS dos nomes (causa em ${causa}, casos em ${casos})`
  );
});

// =====================================================
// 6. A ASSERCAO COMUM NAO FOI ESTRAGADA
// =====================================================
// O caso de longe mais frequente desta funcao nao e navegador quebrado: e um
// mutante matando uma assercao. Ele tem de continuar legivel -- e o nome do
// caso, que a HMO-405 despromoveu de unico campo para ultimo, nao pode ter
// desaparecido.

test("numa reprovacao por assercao saem a mensagem do assert E o nome do caso", () => {
  const r = resumoDaReprovacao(ASSERCAO);
  assert.match(r, /dois mais dois tem de dar 4/, "a mensagem do assert tem de sair");
  assert.match(r, /a soma fecha/, "o nome do caso tem de continuar saindo");
  assert.doesNotMatch(r, /CHROMIUM_BIN/, "e nada de palpite sobre navegador aqui");
});

// =====================================================
// 7. SAIDA QUE NAO CASA COM NADA NAO VIRA LINHA VAZIA
// =====================================================
// Uma suite pode morrer antes de o `node --test` imprimir caso nenhum (erro de
// modulo, OOM). O abort ainda precisa dizer alguma coisa.

test("sem caso e sem causa reconheciveis, o resumo ainda diz que reprovou", () => {
  assert.equal(resumoDaReprovacao(""), "reprovou");
  assert.equal(resumoDaReprovacao("barulho que nao e saida de node --test"), "reprovou");
});

test("so a causa, sem lista de casos, ja sai na linha", () => {
  const r = resumoDaReprovacao("  Error: Cannot find module '@/lib/que-nao-existe'\n");
  assert.match(r, /Cannot find module/);
  assert.doesNotMatch(r, /caso\(s\) reprovaram/, "nao invente contagem de caso que nao houve");
});
