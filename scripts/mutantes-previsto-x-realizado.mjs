#!/usr/bin/env node
// Prova de mutacao do lib/previsto-x-realizado.ts. NAO roda em CI: e uma
// ferramenta de quem esta escrevendo o teste. Cada entrada abaixo estraga uma
// decisao do arquivo; a suite tem que ficar VERMELHA em todas. Mutante que
// sobrevive e um trecho que nenhum teste distingue -- ou codigo morto.
//
// Os primeiros sao os defeitos que a HMO-186 pode produzir, escritos a mao:
// previsto que zera no fim do mes, receita contada como despesa, diferenca com
// o sinal invertido, barra fora de escala e o zero que se passa por previsao. Se
// algum deles sobreviver, a suite nao esta cobrindo o motivo da issue.
//
//   node scripts/mutantes-previsto-x-realizado.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ALVO = "lib/previsto-x-realizado.ts";
const original = readFileSync(ALVO, "utf8");

const mutantes = [
  // --- os defeitos da issue ---
  [
    "o previsto passa a ignorar o que ja foi pago (zera no fim do mes)",
    'export const STATUS_FORA_DO_PREVISTO: ReadonlySet<string> = new Set([\n  "skipped",\n  "cancelled",\n]);',
    'export const STATUS_FORA_DO_PREVISTO: ReadonlySet<string> = new Set([\n  "skipped",\n  "cancelled",\n  "paid",\n]);',
  ],
  [
    "a pulada volta a contar como prevista",
    '  "skipped",\n  "cancelled",',
    '  "cancelled",',
  ],
  [
    "a cancelada volta a contar como prevista",
    '  "skipped",\n  "cancelled",',
    '  "skipped",',
  ],
  [
    "toda linha da agenda vira despesa (a receita prevista desaparece)",
    '    if (linha.direcao === "income") {',
    "    if (false) {",
  ],
  [
    "toda linha da agenda vira receita",
    '    if (linha.direcao === "income") {',
    "    if (true) {",
  ],
  [
    "a diferenca inverte o sinal (previsto - realizado)",
    "        diferenca: centavos(par.realizado - par.previsto),",
    "        diferenca: centavos(par.previsto - par.realizado),",
  ],
  [
    "despesa acima do previsto passa a ser comemorada",
    '      chave: "despesas",\n      rotulo: "Despesas",\n      previsto: previsto.despesas,\n      realizado: realizado.despesas,\n      maiorEMelhor: false,',
    '      chave: "despesas",\n      rotulo: "Despesas",\n      previsto: previsto.despesas,\n      realizado: realizado.despesas,\n      maiorEMelhor: true,',
  ],
  [
    "entrada abaixo do previsto passa a ser comemorada",
    '      chave: "entradas",\n      rotulo: "Entradas",\n      previsto: previsto.entradas,\n      realizado: realizado.entradas,\n      maiorEMelhor: true,',
    '      chave: "entradas",\n      rotulo: "Entradas",\n      previsto: previsto.entradas,\n      realizado: realizado.entradas,\n      maiorEMelhor: false,',
  ],
  [
    "a agenda vazia deixa de calar a comparacao",
    "    semPrevisao: previsto.quantidade === 0,",
    "    semPrevisao: false,",
  ],
  [
    "previsto zerado (mas com linhas) passa a ser tratado como sem previsao",
    "    semPrevisao: previsto.quantidade === 0,",
    "    semPrevisao: previsto.entradas === 0 && previsto.despesas === 0,",
  ],

  // --- as barras ---
  [
    "cada barra passa a ter a propria escala (as duas ficam cheias)",
    "  const escala = Math.max(Math.abs(a), Math.abs(b));\n  if (escala === 0) return [0, 0];\n  return [Math.abs(a) / escala, Math.abs(b) / escala];",
    "  if (a === 0 && b === 0) return [0, 0];\n  return [a === 0 ? 0 : 1, b === 0 ? 0 : 1];",
  ],
  [
    "a escala usa o maior COM sinal (par de negativos estoura a barra)",
    "  const escala = Math.max(Math.abs(a), Math.abs(b));",
    "  const escala = Math.max(a, b);",
  ],
  [
    "o par de zeros volta a devolver NaN",
    "  if (escala === 0) return [0, 0];",
    "",
  ],
  [
    "as duas proporcoes trocam de lugar",
    "  return [Math.abs(a) / escala, Math.abs(b) / escala];",
    "  return [Math.abs(b) / escala, Math.abs(a) / escala];",
  ],

  // --- o sinal e a coercao ---
  [
    "o valor negativo que escapa volta a virar credito",
    "    const valor = Math.abs(numero(linha.amount));",
    "    const valor = numero(linha.amount);",
  ],
  [
    "o resultado previsto inverte os termos",
    "    resultado: centavos(entradas - despesas),\n    quantidade,",
    "    resultado: centavos(despesas - entradas),\n    quantidade,",
  ],
  [
    "valor nao numerico volta a virar NaN",
    "  return Number.isFinite(n) ? n : 0;",
    "  return n;",
  ],
  [
    "a soma deixa de fechar no centavo",
    "const centavos = (valor: number) => Number(valor.toFixed(2));",
    "const centavos = (valor: number) => valor;",
  ],

  // --- a contagem ---
  [
    "a contagem passa a incluir as linhas descartadas",
    "    if (STATUS_FORA_DO_PREVISTO.has(String(linha.status))) continue;\n\n    const valor = Math.abs(numero(linha.amount));\n    quantidade += 1;",
    "    quantidade += 1;\n    if (STATUS_FORA_DO_PREVISTO.has(String(linha.status))) continue;\n\n    const valor = Math.abs(numero(linha.amount));",
  ],

  // --- a soma dos meses ---
  [
    "o periodo volta a pegar UM mes em vez de somar",
    "  for (const mes of meses) {\n    entradas += numero(mes.expected_income);",
    "  for (const mes of meses.slice(0, 1)) {\n    entradas += numero(mes.expected_income);",
  ],
  [
    "a contagem do periodo para de somar os meses",
    "    quantidade += numero(mes.expected_count);",
    "",
  ],

  // --- o repasse dos valores ---
  [
    "o resultado realizado passa a ser recalculado das parcelas",
    "      previsto: previsto.resultado,\n      realizado: realizado.resultado,",
    "      previsto: previsto.entradas - previsto.despesas,\n      realizado: realizado.entradas - realizado.despesas,",
  ],
  [
    "as tres linhas mudam de ordem",
    '    {\n      chave: "entradas",\n      rotulo: "Entradas",',
    '    {\n      chave: "despesas",\n      rotulo: "Despesas",',
  ],
];

let sobreviventes = 0;

for (const [nome, de, para] of mutantes) {
  if (!original.includes(de)) {
    console.log(`??  ${nome}: o trecho nao existe mais -- mutante desatualizado`);
    sobreviventes++;
    continue;
  }
  writeFileSync(ALVO, original.replace(de, para));
  let vermelho = false;
  try {
    execSync("npm run test:previsto-x-realizado", { stdio: "pipe" });
  } catch {
    vermelho = true;
  }
  console.log(`${vermelho ? "OK  " : "VIVO"} ${nome}`);
  if (!vermelho) sobreviventes++;
}

writeFileSync(ALVO, original);
console.log(
  `\n${mutantes.length - sobreviventes}/${mutantes.length} mutantes mortos`
);
process.exit(sobreviventes === 0 ? 0 : 1);
