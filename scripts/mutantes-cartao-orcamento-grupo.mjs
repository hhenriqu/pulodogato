#!/usr/bin/env node
// Prova de mutacao do components/financial/CartaoOrcamentoGrupo.tsx. NAO roda
// em CI: e ferramenta de quem esta escrevendo o teste. Cada entrada abaixo
// estraga uma decisao do JSX; a suite tem que ficar VERMELHA em todas. Mutante
// que sobrevive e um trecho que nenhum teste distingue -- ou codigo morto.
//
// O primeiro grupo e o que interessa, e e o "nao fazer" literal da HMO-180:
// refazer a soma dentro do JSX. O numero continua plausivel, a barra continua
// enchendo, e o sintoma e a tela do grupo e a aba de Orcamento mostrando
// percentuais diferentes para a mesma viagem -- sem erro, sem teste vermelho,
// sem nada no console.
//
//   node scripts/mutantes-cartao-orcamento-grupo.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ALVO = "components/financial/CartaoOrcamentoGrupo.tsx";
const original = readFileSync(ALVO, "utf8");

const mutantes = [
  // --- a soma refeita no JSX: o "nao fazer" da issue ---
  [
    "o cabecalho repete o teto de maior valor em vez de somar a viagem",
    "              {formatCurrency(grupo.gasto)} de {formatCurrency(grupo.limite)}",
    "              {formatCurrency(Number(grupo.orcamentos[0]?.spent ?? 0))} de{\" \"}\n              {formatCurrency(Number(grupo.orcamentos[0]?.amount_limit ?? 0))}",
  ],
  [
    "o percentual do grupo passa a ser o da primeira categoria",
    "  const pct = percentual(grupo.ratio);",
    "  const pct = percentual(Number(grupo.orcamentos[0]?.consumed_ratio ?? 0));",
  ],

  // --- a barra, que precisa parar em 100 ---
  [
    "a barra deixa de parar em 100 (o indicador sai do trilho e a barra some)",
    "const larguraDaBarra = (pct: number) => Math.min(pct, 100);",
    "const larguraDaBarra = (pct: number) => pct;",
  ],
  [
    "o percentual sem teto vira NaN na barra",
    "const percentual = (ratio: number) => Math.round(ratio * 100);",
    "const percentual = (ratio: number) => Math.round((ratio * 100) / 0) * 0 + NaN;",
  ],

  // --- a frase, que e a unica coisa que a pessoa le ---
  [
    "o estouro do grupo e anunciado como sobra",
    "            {fraseDoRestante(grupo)}",
    "            {fraseDoRestante({ ...grupo, restante: Math.abs(grupo.restante) })}",
  ],
  [
    "a linha perde o Math.abs (sai 'Estourou -R$ 300', que se le como dois estouros)",
    "            Estourou {formatCurrency(Math.abs(restante))}",
    "            Estourou {formatCurrency(restante)}",
  ],
  [
    "sobra e estouro trocam de lado na linha",
    "        {restante >= 0 ? (",
    "        {restante < 0 ? (",
  ],

  // --- o slot da acao: quem gerencia teto e so a tela de Orcamento ---
  [
    "a acao por linha e ignorada (a tela de Orcamento perde o botao de remover)",
    "            <LinhaDeTeto key={b.id} budget={b} acao={acaoDaLinha?.(b)} />",
    "            <LinhaDeTeto key={b.id} budget={b} />",
  ],
  [
    "a acao e montada sempre para a PRIMEIRA linha (a segunda categoria nao se remove)",
    "            <LinhaDeTeto key={b.id} budget={b} acao={acaoDaLinha?.(b)} />",
    "            <LinhaDeTeto\n              key={b.id}\n              budget={b}\n              acao={acaoDaLinha?.(grupo.orcamentos[0])}\n            />",
  ],
  [
    "a linha passa a desenhar um botao proprio (ele vaza para a tela do grupo)",
    "          {acao}",
    '          {acao ?? <button type="button" aria-label="Remover orçamento" />}',
  ],

  // --- o mes: sem eixo de tempo o rotulo mente sem dar erro ---
  [
    "o mes passa por new Date() (o dia 01 volta um mes no fuso de Sao Paulo)",
    '  const [ano, mes] = iso.split("-");\n  return `${MESES[Number(mes) - 1] ?? iso} de ${ano}`;',
    "  const d = new Date(iso);\n  return `${MESES[d.getMonth()]} de ${d.getFullYear()}`;",
  ],
  [
    "o cartao inventa um mes quando nao recebe nenhum",
    '              {mes ? ` em ${nomeDoMes(mes)}` : ""} — soma o gasto de todos os',
    '              {` em ${nomeDoMes(mes ?? "2026-01-01")}`} — soma o gasto de todos os',
  ],

  // --- o titulo ---
  [
    "o titulo recebido e ignorado (a tela do grupo repete o nome do cabecalho)",
    "              <span className=\"truncate\">{titulo ?? grupo.group_name}</span>",
    "              <span className=\"truncate\">{grupo.group_name}</span>",
  ],
  [
    "o titulo passa a mostrar o group_id",
    "              <span className=\"truncate\">{titulo ?? grupo.group_name}</span>",
    "              <span className=\"truncate\">{titulo ?? grupo.group_id}</span>",
  ],

  // --- a linha por categoria ---
  [
    "a categoria sem nome resolvido sai como linha vazia",
    '            {budget.category?.name ?? "Categoria"}',
    "            {budget.category?.name}",
  ],
  [
    "a linha mostra o gasto no lugar do teto (toda categoria parece 100% consumida)",
    "            {formatCurrency(Number(budget.spent))} de{\" \"}\n            {formatCurrency(Number(budget.amount_limit))}",
    "            {formatCurrency(Number(budget.spent))} de{\" \"}\n            {formatCurrency(Number(budget.spent))}",
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
    execSync("npm run test:cartao-orcamento-grupo", { stdio: "pipe" });
  } catch {
    vermelho = true;
  }
  writeFileSync(ALVO, original);
  console.log(`${vermelho ? "OK  " : "VIVO"} ${nome}`);
  if (!vermelho) sobreviventes++;
}

writeFileSync(ALVO, original);

console.log(
  `\n${mutantes.length - sobreviventes}/${mutantes.length} mutantes mortos`
);
process.exit(sobreviventes === 0 ? 0 : 1);
