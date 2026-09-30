#!/usr/bin/env node
// Prova de mutacao do lib/realizado-e-previsao.ts. NAO roda em CI: e uma
// ferramenta de quem esta escrevendo o teste. Cada entrada abaixo estraga uma
// decisao do arquivo; a suite tem que ficar VERMELHA em todas. Mutante que
// sobrevive e um trecho que nenhum teste distingue -- ou codigo morto.
//
// Aqui o mutante sobrevivente costuma denunciar o COMENTARIO, nao o teste: se
// um trecho justifica uma decisao que nenhum caso consegue separar da decisao
// oposta, a justificativa esta errada ou o arquivo tem regra a menos.
//
// Os primeiros sao os defeitos que a HMO-174 pode produzir, escritos a mao: a
// conta paga contada nos dois lados, a transacao futura entrando em Realizado,
// a transferencia e a fatura inflando a Previsao, e o gasto variavel
// escorregando para dentro do total esperado.
//
//   node scripts/mutantes-realizado-e-previsao.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ALVO = "lib/realizado-e-previsao.ts";
const original = readFileSync(ALVO, "utf8");

const mutantes = [
  // --- as duas janelas: e o que mantem os lados disjuntos ---
  [
    "o Realizado volta a cobrir o mes inteiro (a transacao de data futura entra em 'ja gastei')",
    "  const ate = periodo.ate < hoje ? periodo.ate : hoje;\n  return { de: periodo.de, ate };",
    "  return { de: periodo.de, ate: periodo.ate };",
  ],
  [
    "periodo inteiramente futuro passa a ter Realizado",
    "  if (periodo.de > hoje) return null;",
    "",
  ],
  [
    "a Previsao volta a comecar no inicio do periodo (sobrepoe o Realizado)",
    "  const de = periodo.de > hoje ? periodo.de : hoje;\n  return { de, ate: periodo.ate };",
    "  return { de: periodo.de, ate: periodo.ate };",
  ],
  [
    "periodo inteiramente passado passa a ter Previsao",
    "  if (periodo.ate < hoje) return null;",
    "",
  ],
  [
    "a Previsao passa a comecar AMANHA (a conta que vence hoje some dos dois lados)",
    "  const de = periodo.de > hoje ? periodo.de : hoje;",
    "  const de = periodo.de > hoje ? periodo.de : addDays(hoje, 1);",
  ],
  [
    "o corte do Realizado passa a ser exclusivo (o lancamento de hoje some)",
    "  const ate = periodo.ate < hoje ? periodo.ate : hoje;",
    "  const ate = periodo.ate < hoje ? periodo.ate : addDays(hoje, -1);",
  ],

  // --- a soma dentro da janela ---
  [
    "a soma ignora a janela (as contas de novembro entram no total de setembro)",
    "    if (data < janela.de || data > janela.ate) continue;",
    "",
  ],
  [
    "a soma ignora so o inicio da janela (o passado volta para a Previsao)",
    "    if (data < janela.de || data > janela.ate) continue;",
    "    if (data > janela.ate) continue;",
  ],
  [
    "a soma ignora so o fim da janela",
    "    if (data < janela.de || data > janela.ate) continue;",
    "    if (data < janela.de) continue;",
  ],
  [
    "janela nula passa a somar o horizonte inteiro",
    "  if (!janela) return { receita: 0, despesa: 0 };",
    "  if (!janela) janela = { de: '0000-01-01', ate: '9999-12-31' };",
  ],
  [
    "entra e sai trocam de lado",
    "    receita += Math.abs(numero(dia.entra));\n    despesa += Math.abs(numero(dia.sai));",
    "    receita += Math.abs(numero(dia.sai));\n    despesa += Math.abs(numero(dia.entra));",
  ],

  // --- a direcao: o que fica fora dos dois lados ---
  [
    "a transferencia volta a contar como despesa prevista",
    '  if (direction === "transfer") return null;',
    "",
  ],
  [
    "a fatura de cartao volta a contar como despesa prevista (cobra as compras duas vezes)",
    "  if (ehFatura) return null;",
    "",
  ],
  [
    "direcao desconhecida passa a ser receita",
    '  if (direction === "income") return "income";\n  return "expense";',
    '  if (direction === "expense") return "expense";\n  return "income";',
  ],
  [
    "a receita prevista passa a contar como despesa",
    '  if (direction === "income") return "income";',
    "",
  ],

  // --- os tres numeros ---
  [
    "o total esperado passa a ser so o realizado (a Previsao some do total)",
    "  return { realizado: r, previsao: p, total: centavos(r + p) };",
    "  return { realizado: r, previsao: p, total: r };",
  ],
  [
    "o total esperado passa a ser so a previsao",
    "  return { realizado: r, previsao: p, total: centavos(r + p) };",
    "  return { realizado: r, previsao: p, total: p };",
  ],
  [
    "o total esperado passa a SUBTRAIR a previsao",
    "  return { realizado: r, previsao: p, total: centavos(r + p) };",
    "  return { realizado: r, previsao: p, total: centavos(r - p) };",
  ],
  [
    "a despesa que chega negativa volta a encolher o total",
    "  const r = centavos(Math.abs(numero(realizado)));\n  const p = centavos(Math.abs(numero(previsao)));",
    "  const r = centavos(numero(realizado));\n  const p = centavos(numero(previsao));",
  ],
  [
    "as duas parcelas trocam de nome",
    "  return { realizado: r, previsao: p, total: centavos(r + p) };",
    "  return { realizado: p, previsao: r, total: centavos(r + p) };",
  ],

  // --- ACEITE 8: o gasto variavel dentro da Previsao ---
  // O controle negativo que a issue pede. A estimativa nao tem parametro em
  // `montarPainel` de proposito, entao o mutante injeta o numero que a suite
  // usa (R$ 60/dia x 15 dias = R$ 900) direto na despesa prevista -- que e o
  // que aconteceria se alguem somasse a media "so para o total ficar
  // realista". A identidade continua fechando; o que quebra sao os valores.
  [
    "a estimativa de gasto variavel entra dentro da Previsao de despesa",
    "    despesa: montarLado(realizado.despesa, previsao.despesa),",
    "    despesa: montarLado(realizado.despesa, previsao.despesa + 900),",
  ],
  [
    "a estimativa de gasto variavel entra so no total esperado",
    "  return { realizado: r, previsao: p, total: centavos(r + p) };",
    "  return { realizado: r, previsao: p, total: centavos(r + p + 900) };",
  ],

  // --- a linha separada do gasto variavel ---
  [
    "a estimativa passa a cobrar o dia de hoje tambem",
    "  const primeiro = janela.de > hoje ? janela.de : addDays(janela.de, 1);",
    "  const primeiro = janela.de;",
  ],
  [
    "a estimativa passa a pular o primeiro dia do periodo futuro",
    "  const primeiro = janela.de > hoje ? janela.de : addDays(janela.de, 1);",
    "  const primeiro = addDays(janela.de, 1);",
  ],
  [
    "a estimativa perde o dia final da janela",
    "  const dias = diasEntre(primeiro, janela.ate) + 1;",
    "  const dias = diasEntre(primeiro, janela.ate);",
  ],
  [
    "periodo passado volta a receber estimativa variavel",
    "  if (!janela) return { porDia: saneado, dias: 0, total: 0 };",
    '  if (!janela) return { porDia: saneado, dias: 30, total: saneado * 30 };',
  ],
  [
    "a media negativa volta a virar receita",
    "  const saneado = Number.isFinite(taxa) && taxa > 0 ? taxa : 0;",
    "  const saneado = taxa;",
  ],

  // --- a coercao ---
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
    execSync("npm run test:realizado-e-previsao", { stdio: "pipe" });
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
