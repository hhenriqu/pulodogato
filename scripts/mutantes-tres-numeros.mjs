#!/usr/bin/env node
// Prova de mutacao dos tiles de Realizado/Previsao/Total (HMO-174). NAO roda em
// CI: e ferramenta de quem escreve o teste. Cada entrada estraga uma decisao da
// MARCACAO -- nao da aritmetica, que tem prova propria em
// mutantes-realizado-e-previsao.mjs. A suite tem que ficar VERMELHA em todas.
//
// O defeito que este arquivo existe para provar que a suite pega e o mais
// silencioso da feature: os dois numeros certos impressos debaixo do rotulo um
// do outro. Ele nao quebra build, nao quebra teste puro e nao deixa a tela
// vazia.
//
//   node scripts/mutantes-tres-numeros.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ALVO = "components/dashboard/RealizadoEPrevisao.tsx";
const original = readFileSync(ALVO, "utf8");

const mutantes = [
  [
    "Realizado e Previsao trocam de numero (os dois rotulos continuam certos)",
    "            <p className=\"text-sm font-semibold\">{moeda(numeros.realizado)}</p>",
    "            <p className=\"text-sm font-semibold\">{moeda(numeros.previsao)}</p>",
  ],
  [
    "o numero grande passa a ser o realizado, e nao o total esperado",
    "<div className={`text-2xl font-bold ${cor}`}>{moeda(numeros.total)}</div>",
    "<div className={`text-2xl font-bold ${cor}`}>{moeda(numeros.realizado)}</div>",
  ],
  [
    "o tile de receita passa a se chamar despesa",
    '          {ehReceita ? "Receitas" : "Despesas"}',
    '          Despesas',
  ],
  [
    "a linha de Previsao some quando o periodo acabou",
    "          <div>\n            <p className=\"text-xs text-muted-foreground\">Previsão</p>",
    "          <div hidden={periodoEncerrado}>\n            <p className=\"text-xs text-muted-foreground\">Previsão</p>",
  ],
  [
    "o motivo do zero passa a aparecer sempre",
    "            {periodoEncerrado && (",
    "            {true && (",
  ],
  [
    "o motivo do periodo futuro passa a aparecer sempre",
    "            {periodoFuturo && (",
    "            {true && (",
  ],
  [
    "o aviso de previsao incompleta nunca aparece",
    "        {previsaoIncompleta && (",
    "        {false && (",
  ],
  [
    "a linha do gasto variavel deixa de dizer que fica de fora",
    "          <strong>Não está somado</strong> na previsão nem no total esperado",
    "          na previsão e no total esperado",
  ],
  [
    "o campo editavel vira texto (a media volta a ser invisivel e fixa)",
    "                type=\"number\"",
    "                type=\"hidden\"",
  ],
  [
    "o campo passa a nascer vazio em vez de trazer a media",
    "                value={porDia}",
    'value={""}',
  ],
  [
    "sem base historica a tela passa a justificar o zero como se houvesse media",
    "          ? `A média sai de ${mesesBase} ${\n                mesesBase === 1 ? \"mês fechado\" : \"meses fechados\"\n              }.`\n            : \"Ainda não há meses fechados suficientes para uma média — o valor inicial é zero.\"",
    "          ? `A média sai de ${mesesBase} ${\n                mesesBase === 1 ? \"mês fechado\" : \"meses fechados\"\n              }.`\n            : `A média sai de ${mesesBase} meses fechados.`",
  ],
  [
    "o botao de voltar a media aparece antes de o usuario mexer",
    "            {ajustado && (",
    "            {true && (",
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
    execSync("npm run test:tres-numeros", { stdio: "pipe" });
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
