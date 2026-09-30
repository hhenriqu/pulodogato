#!/usr/bin/env node
// Prova de mutacao do components/dashboard/PrevistoXRealizado.tsx. NAO roda em
// CI: e uma ferramenta de quem esta escrevendo o teste. Cada entrada abaixo
// estraga uma decisao da MARCACAO; a suite tem que ficar VERMELHA em todas.
//
// A suite pura (test-previsto-x-realizado) nao alcanca nada disto: a aritmetica
// continua certa em todos os mutantes daqui. O que eles quebram e qual numero
// aparece em qual coluna, e o que a tela diz quando nao ha o que comparar.
//
//   node scripts/mutantes-previsto-bloco.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ALVO = "components/dashboard/PrevistoXRealizado.tsx";
const original = readFileSync(ALVO, "utf8");

const mutantes = [
  // --- as colunas ---
  [
    "a coluna Previsto imprime o realizado",
    "                  Previsto\n                </span>\n                {moeda(linha.previsto)}",
    "                  Previsto\n                </span>\n                {moeda(linha.realizado)}",
  ],
  [
    "a coluna Realizado imprime o previsto",
    "                  Realizado\n                </span>\n                {moeda(linha.realizado)}",
    "                  Realizado\n                </span>\n                {moeda(linha.previsto)}",
  ],
  [
    "os cabecalhos das colunas trocam de lugar",
    '          <span className="hidden sm:block text-right">Previsto</span>\n          <span className="hidden sm:block text-right">Realizado</span>',
    '          <span className="hidden sm:block text-right">Realizado</span>\n          <span className="hidden sm:block text-right">Previsto</span>',
  ],
  [
    "a coluna de diferenca desaparece",
    "                <Diferenca\n                  valor={linha.diferenca}\n                  maiorEMelhor={linha.maiorEMelhor}\n                />",
    "",
  ],

  // --- o sinal e a cor ---
  [
    "o sinal da diferenca inverte na tela",
    '      {valor > 0 ? "+" : "−"} {moeda(Math.abs(valor))}',
    '      {valor > 0 ? "−" : "+"} {moeda(Math.abs(valor))}',
  ],
  [
    "a cor ignora a direcao da linha (despesa acima do previsto fica verde)",
    "  const bom = maiorEMelhor ? valor > 0 : valor < 0;",
    "  const bom = valor > 0;",
  ],
  [
    "a diferenca zero volta a imprimir R$ 0,00",
    "  if (valor === 0) {",
    "  if (false) {",
  ],

  // --- os estados que nao podem imprimir numero ---
  [
    "agenda vazia volta a imprimir previsto R$ 0,00",
    "  if (semPrevisao) {",
    "  if (false) {",
  ],
  [
    "a leitura falhada passa a mostrar a comparacao errada",
    "  if (indisponivel) {",
    "  if (false) {",
  ],
  [
    "semPrevisao passa na frente de indisponivel",
    "  if (indisponivel) {",
    "  if (semPrevisao) {",
  ],
  [
    "agenda vazia esconde tambem o realizado",
    "            <span className=\"font-medium\">{moeda(realizado.resultado)}</span>",
    "            <span className=\"font-medium\">—</span>",
  ],
  [
    "agenda vazia deixa de oferecer o caminho de volta",
    '            <Link href="/dashboard/recurrences">Cadastrar o que é fixo</Link>',
    "            <span>Cadastre o que é fixo</span>",
  ],

  // --- a nota que impede a leitura errada ---
  [
    "a nota sobre a agenda desaparece",
    "          O previsto vem da agenda —{\" \"}",
    "          {\"\"}",
  ],
  [
    "a nota para de dizer sobre quantas linhas o previsto foi feito",
    '            ? "1 conta ou receita"\n            : `${previsto.quantidade} contas e receitas`}',
    '            ? "1 conta ou receita"\n            : "algumas contas e receitas"}',
  ],
  [
    "a nota usa plural com uma linha so",
    "          {previsto.quantidade === 1",
    "          {false",
  ],

  // --- o eixo de tempo ---
  [
    "o bloco perde o rotulo do periodo",
    '      <CardDescription className="capitalize">{rotulo}</CardDescription>',
    "",
  ],

  // --- as filas ---
  [
    "uma das tres filas deixa de ser renderizada",
    "        {linhas.map((linha) => (",
    "        {linhas.slice(0, 2).map((linha) => (",
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
    execSync("npm run test:previsto-bloco", { stdio: "pipe" });
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
