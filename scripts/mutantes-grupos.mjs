#!/usr/bin/env node
// Prova de mutacao do lib/grupos.ts. NAO roda em CI: e uma ferramenta de quem
// esta escrevendo o teste. Cada entrada abaixo estraga uma decisao do arquivo;
// a suite tem que ficar VERMELHA em todas. Mutante que sobrevive e um trecho
// que nenhum teste distingue -- ou codigo morto.
//
// O primeiro grupo de mutantes e o que interessa: sao os erros que a tela NAO
// mostra. Um sinal invertido exibe "você tem R$ 345 a receber" para quem deve
// R$ 345, com o numero, o simbolo e a formatacao todos certos; e o `Math.abs`
// logo abaixo e o "conserto" que alguem escreve ao ver o sinal trocado, e que
// deixa os dois sentidos com a mesma cara.
//
//   node scripts/mutantes-grupos.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ALVO = "lib/grupos.ts";
const original = readFileSync(ALVO, "utf8");

const mutantes = [
  // --- o sinal: a view fala de credito, a tela fala de divida ---
  [
    "o sinal deixa de ser invertido (quem deve aparece como credor)",
    "    const devoCents = -toCents(linha.net_balance);",
    "    const devoCents = toCents(linha.net_balance);",
  ],
  [
    "o sinal vira Math.abs (os dois sentidos com a mesma cara)",
    "    const devoCents = -toCents(linha.net_balance);",
    "    const devoCents = Math.abs(toCents(linha.net_balance));",
  ],
  [
    "a divida passa a ser o devido cru, sem abater o que eu paguei",
    "    const devoCents = -toCents(linha.net_balance);",
    "    const devoCents = toCents(Number(linha.total_owed) || 0);",
  ],

  // --- a tolerancia de um centavo, que tem que bater com a do acerto ---
  [
    "a tolerancia some (R$ 0,01 vira divida que o grupo nao sabe cobrar)",
    "const TOLERANCIA_EM_CENTAVOS = 1;",
    "const TOLERANCIA_EM_CENTAVOS = 0;",
  ],
  [
    "a tolerancia dobra (R$ 0,02 some da tela)",
    "const TOLERANCIA_EM_CENTAVOS = 1;",
    "const TOLERANCIA_EM_CENTAVOS = 2;",
  ],
  [
    "o grupo quitado volta para a lista",
    "    else continue; // quitado: nao vai para a lista",
    "    else if (false) continue;",
  ],

  // --- somar varios grupos ---
  [
    "o liquido soma em vez de subtrair",
    "    liquido: toReais(aPagarCents - aReceberCents),",
    "    liquido: toReais(aPagarCents + aReceberCents),",
  ],
  [
    "a pagar e a receber caem no mesmo balde",
    "    if (devoCents > TOLERANCIA_EM_CENTAVOS) aPagarCents += devoCents;\n    else if (devoCents < -TOLERANCIA_EM_CENTAVOS) aReceberCents += -devoCents;",
    "    if (devoCents > TOLERANCIA_EM_CENTAVOS) aPagarCents += devoCents;\n    else if (devoCents < -TOLERANCIA_EM_CENTAVOS) aPagarCents += -devoCents;",
  ],
  [
    "o total de grupos passa a contar so os em aberto",
    "    totalDeGrupos: linhas.length,",
    "    totalDeGrupos: grupos.length,",
  ],

  // --- a ordem, que tem que ser deterministica ---
  [
    "o desempate por id some (a lista troca de ordem sozinha)",
    "  grupos.sort((a, b) => b.cents - a.cents || a.group_id.localeCompare(b.group_id));",
    "  grupos.sort((a, b) => b.cents - a.cents);",
  ],
  [
    "a ordem inverte (o maior credito vem antes da maior divida)",
    "  grupos.sort((a, b) => b.cents - a.cents || a.group_id.localeCompare(b.group_id));",
    "  grupos.sort((a, b) => a.cents - b.cents || a.group_id.localeCompare(b.group_id));",
  ],

  // --- o rotulo do cartao ---
  [
    "o zero passa a ser rotulado como divida",
    "  if (resumo.liquido > 0) {",
    "  if (resumo.liquido >= 0) {",
  ],
  [
    "os dois rotulos trocam de lugar",
    '      titulo: "Você deve aos grupos",',
    '      titulo: "Os grupos devem a você",',
  ],
  [
    "o valor do rotulo perde a inversao no lado do credito",
    "      valor: -resumo.liquido,",
    "      valor: resumo.liquido,",
  ],

  // --- o detalhamento das duas pontas ---
  [
    "precisaDetalhar vira OU (detalha quando nao ha o que detalhar)",
    "  return resumo.aPagar > 0 && resumo.aReceber > 0;",
    "  return resumo.aPagar > 0 || resumo.aReceber > 0;",
  ],
  [
    "precisaDetalhar nunca dispara (o liquido zero mente sozinho)",
    "  return resumo.aPagar > 0 && resumo.aReceber > 0;",
    "  return false;",
  ],

  // --- o que a linha carrega ---
  [
    "o grupo sem nome e descartado (some dinheiro em aberto da tela)",
    '      nome: linha.nome || "Grupo sem nome",',
    "      nome: linha.nome as string,",
  ],
  [
    "pago e devido chegam zerados na tela",
    "      total_paid: Number(linha.total_paid) || 0,\n      total_owed: Number(linha.total_owed) || 0,",
    "      total_paid: 0,\n      total_owed: 0,",
  ],

  // --- a recusa PDG01 da edicao de despesa de grupo (HMO-176) ---
  [
    "qualquer erro de banco vira \"alguem ja aprovou\"",
    '  if (codigo !== "PDG01") return null;',
    "  if (false) return null;",
  ],
  [
    "a recusa PDG01 deixa de ser reconhecida",
    '  if (codigo !== "PDG01") return null;',
    "  return null;",
  ],
  [
    "o aviso passa a casar pelo texto da mensagem",
    '  const codigo = (erro as { code?: unknown }).code;',
    '  const codigo = String((erro as { message?: unknown }).message ?? "").includes("aprovou") ? "PDG01" : "outro";',
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
    execSync("npm run test:grupos", { stdio: "pipe" });
  } catch {
    vermelho = true;
  }
  console.log(`${vermelho ? "OK  " : "VIVO"} ${nome}`);
  if (!vermelho) sobreviventes++;
}

writeFileSync(ALVO, original);
console.log(`\n${mutantes.length - sobreviventes}/${mutantes.length} mutantes mortos`);
process.exit(sobreviventes === 0 ? 0 : 1);
