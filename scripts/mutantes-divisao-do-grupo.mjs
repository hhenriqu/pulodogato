#!/usr/bin/env node
// Prova de mutacao do lib/divisao-do-grupo.ts. NAO roda em CI: e uma ferramenta
// de quem esta escrevendo o teste. Cada entrada abaixo estraga uma decisao do
// arquivo; a suite tem que ficar VERMELHA em todas. Mutante que sobrevive e um
// trecho que nenhum teste distingue -- ou codigo morto.
//
// O primeiro grupo e o que interessa, porque reproduz o defeito da HMO-190: o
// tipo que a tela manda caindo em divisao IGUAL sem erro. Esse e o mutante que
// grava 50/50 onde foi combinado 70/30 e devolve 200 com "sucesso" na tela --
// nenhuma tela, nenhum log e nenhum tipo do TypeScript o denuncia.
//
//   node scripts/mutantes-divisao-do-grupo.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ALVO = "lib/divisao-do-grupo.ts";
const original = readFileSync(ALVO, "utf8");

const mutantes = [
  // --- o vocabulario: o silencio que era o defeito ---
  [
    "tipo desconhecido volta a cair em divisao igual (o defeito da issue)",
    "    default:\n      return null;",
    '    default:\n      return "equal";',
  ],
  [
    "proportional deixa de ser traduzido (23514 no UPDATE do split_type)",
    '    case "percentage":\n    case "proportional":\n    case "historical":\n      return "percentage";',
    '    case "percentage":\n      return "percentage";\n    case "proportional":\n    case "historical":\n      return normalizado as TipoGravavel;',
  ],
  [
    "custom passa a ser tratado como percentage",
    '    case "custom":\n      return "custom";',
    '    case "custom":\n      return "percentage";',
  ],
  [
    "o tipo vazio vira custom em vez de equal",
    '    case "":\n    case "equal":\n      return "equal";',
    '    case "":\n      return "custom";\n    case "equal":\n      return "equal";',
  ],

  // --- divisao igual nao pode reescrever o rateio do trigger ---
  [
    "equal passa a devolver as partes da tela (troca o maior resto por residuo)",
    '  if (splitType === "equal") {\n    return { ok: true, splitType: "equal", partes: null };\n  }',
    '  if (splitType === "equal" && !Array.isArray(entrada.partes)) {\n    return { ok: true, splitType: "equal", partes: null };\n  }',
  ],

  // --- a divisao combinada sem partes ---
  [
    "lista de partes vazia deixa de ser recusada",
    "  if (!Array.isArray(entrada.partes) || entrada.partes.length === 0) {",
    "  if (!Array.isArray(entrada.partes)) {",
  ],
  [
    "divisao combinada sem partes volta a virar divisao igual",
    "    return {\n      ok: false,\n      erro: \"Escolha quanto cada membro paga para usar esta divisão.\",\n    };",
    '    return { ok: true, splitType: "equal", partes: null };',
  ],

  // --- o dinheiro que tem que fechar ---
  [
    "custom deixa de conferir a soma (70/20 grava e deixa residuo)",
    "  if (soma !== totalCents) {",
    "  if (false) {",
  ],
  [
    "custom aceita diferenca de um centavo",
    "  if (soma !== totalCents) {",
    "  if (Math.abs(soma - totalCents) > 1) {",
  ],
  [
    "a porcentagem deixa de conferir a soma de 100",
    "  if (Math.abs(soma - 100) > TOLERANCIA_PERCENTUAL) {",
    "  if (false) {",
  ],
  [
    "a tolerancia percentual fica grande demais (70/20 passa)",
    "const TOLERANCIA_PERCENTUAL = 0.5;",
    "const TOLERANCIA_PERCENTUAL = 15;",
  ],
  [
    "a tolerancia percentual zera (100/3 fica impossivel de gravar)",
    "const TOLERANCIA_PERCENTUAL = 0.5;",
    "const TOLERANCIA_PERCENTUAL = 0;",
  ],

  // --- o centavo do maior resto ---
  [
    "o maior resto some: cada parte arredonda sozinha e a soma nao fecha",
    "  const base = brutos.map((b) => Math.floor(b));",
    "  const base = brutos.map((b) => Math.round(b));",
  ],
  [
    "a sobra deixa de ser distribuida (R$ 100 em tres somem um centavo)",
    "  for (const { i } of ordem) {\n    if (sobra <= 0) break;\n    cents[i] += 1;\n    sobra -= 1;\n  }",
    "  for (const { i } of ordem) {\n    if (sobra <= 0) break;\n    cents[i] += 0;\n    sobra -= 1;\n  }",
  ],
  [
    "a sobra toda vai para um unico membro",
    "    cents[i] += 1;\n    sobra -= 1;",
    "    cents[i] += sobra;\n    sobra = 0;",
  ],
  [
    "o desempate por member_id some (a mesma divisao grava valores diferentes)",
    "    .sort((a, b) =>\n      b.resto !== a.resto\n        ? b.resto - a.resto\n        : a.membro < b.membro\n          ? -1\n          : a.membro > b.membro\n            ? 1\n            : 0\n    );",
    "    .sort((a, b) => b.resto - a.resto);",
  ],
  [
    "a normalizacao passa a ser por 100, e nao pela soma real",
    "  const brutos = percentuais.map((p) => (totalCents * p) / soma);",
    "  const brutos = percentuais.map((p) => (totalCents * p) / 100);",
  ],

  // --- a porcentagem que o banco aceita ---
  [
    "o piso de 0,01 some (percentage 0.00 derruba o INSERT no CHECK)",
    "  return Math.max(0.01, duasCasas);",
    "  return duasCasas;",
  ],
  // Nao ha mutante de TETO: `Math.min(100, ...)` aqui seria trava sobre estado
  // impossivel -- `pct > 100` ja foi recusado antes, e o mutante que a removia
  // sobrevivia a suite inteira, porque nao ha entrada legitima que a acione.
  // Ver a nota em percentagemGravavel().
  [
    "a porcentagem deixa de ser arredondada para duas casas",
    "  const duasCasas = Math.round(pct * 100) / 100;",
    "  const duasCasas = pct;",
  ],
  [
    "percentual fora de 0..100 deixa de ser recusado",
    "    if (pct <= 0 || pct > 100) {",
    "    if (false) {",
  ],
  [
    "percentual zero passa a ser aceito",
    "    if (pct <= 0 || pct > 100) {",
    "    if (pct < 0 || pct > 100) {",
  ],

  // --- custom: os valores ---
  [
    "parte de R$ 0,00 passa a ser aceita",
    "    if (cents <= 0) {",
    "    if (false) {",
  ],
  [
    "custom passa a derivar a porcentagem errada (todos com 100%)",
    "      percentage: percentagemGravavel((centsPorParte[i] * 100) / totalCents),",
    "      percentage: 100,",
  ],
  [
    "o sinal da parte deixa de ser normalizado",
    "    const cents = Math.abs(toCents(valor));",
    "    const cents = toCents(valor);",
  ],
  [
    "o total negativo da despesa deixa de ser normalizado",
    "  const totalCents = Math.abs(toCents(numero(entrada.total) ?? 0));",
    "  const totalCents = toCents(numero(entrada.total) ?? 0);",
  ],
  [
    "despesa sem valor deixa de ser recusada",
    "  if (totalCents <= 0) {",
    "  if (false) {",
  ],

  // --- as listas que o banco aceitaria e nao devia ---
  [
    "membro repetido passa (a mesma pessoa e cobrada duas vezes)",
    "    if (membros.includes(memberId)) {",
    "    if (false) {",
  ],
  [
    "parte sem member_id passa",
    "    if (!memberId) {",
    "    if (false) {",
  ],
];

let sobreviventes = 0;

for (const [nome, de, para] of mutantes) {
  // Um mutante que nao aplica passa por "morto" sem nunca ter existido: o
  // trecho mudou de forma, o replace nao encontra nada, e a suite fica verde
  // por nao ter sido mexida. Ele conta como sobrevivente de proposito.
  if (!original.includes(de)) {
    console.log(`??  ${nome}: o trecho nao existe mais -- mutante desatualizado`);
    sobreviventes++;
    continue;
  }
  writeFileSync(ALVO, original.replace(de, para));
  let vermelho = false;
  try {
    execSync("npm run test:divisao-do-grupo", { stdio: "pipe" });
  } catch {
    vermelho = true;
  }
  console.log(`${vermelho ? "OK  " : "VIVO"} ${nome}`);
  if (!vermelho) sobreviventes++;
}

// Fora de qualquer try/catch com process.exit dentro: restaurar o fonte e a
// ultima coisa que este script faz, e `process.exit()` num `try` pularia o
// `finally` -- deixaria lib/divisao-do-grupo.ts MUTADO no worktree.
writeFileSync(ALVO, original);
console.log(`\n${mutantes.length - sobreviventes}/${mutantes.length} mutantes mortos`);
process.exit(sobreviventes === 0 ? 0 : 1);
