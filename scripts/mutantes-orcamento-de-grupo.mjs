#!/usr/bin/env node
// Prova de mutacao do lib/orcamento-de-grupo.ts e do linhasParaRepetir de
// lib/services/budget.ts. NAO roda em CI: e ferramenta de quem esta escrevendo
// o teste. Cada entrada abaixo estraga uma decisao dos arquivos; a suite tem
// que ficar VERMELHA em todas. Mutante que sobrevive e um trecho que nenhum
// teste distingue -- ou codigo morto.
//
// O primeiro grupo e o que interessa: sao os erros que a TELA NAO MOSTRA.
// Somar o teto de grupo junto com o pessoal da um total alto que a pessoa
// atribui a ter gastado mesmo, e que cresce a cada membro novo da viagem --
// sem erro, sem cor diferente, sem nada no console.
//
//   node scripts/mutantes-orcamento-de-grupo.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ALVOS = {
  grupo: "lib/orcamento-de-grupo.ts",
  budget: "lib/services/budget.ts",
};

const original = Object.fromEntries(
  Object.entries(ALVOS).map(([k, caminho]) => [k, readFileSync(caminho, "utf8")]),
);

const mutantes = [
  // --- a mistura: o teto de grupo entrando na soma pessoal ---
  [
    "grupo",
    "o teto de grupo cai no balde pessoal (o 'ja gasto' soma a viagem)",
    "    if (o.group_id) {",
    "    if (false) {",
  ],
  [
    "grupo",
    "a separacao passa a olhar o NOME em vez do group_id",
    "    if (o.group_id) {",
    "    if (o.group?.name) {",
  ],
  [
    "grupo",
    "o teto sem nome resolvido e descartado (a barra da viagem some)",
    '      group_name: comNome?.group?.name ?? GRUPO_SEM_NOME,',
    '      group_name: comNome?.group?.name as string,',
  ],

  // --- duas viagens numa barra so ---
  [
    "grupo",
    "todos os grupos caem na mesma chave (uma barra para viagens diferentes)",
    "      const atual = porGrupo.get(o.group_id);",
    '      const atual = porGrupo.get("todos");',
  ],

  // --- centavos ---
  [
    "grupo",
    "a soma passa a ser em reais (residuo de ponto flutuante na tela)",
    "    limiteCents += toCents(Number(o.amount_limit));\n    gastoCents += toCents(Number(o.spent));",
    "    limiteCents += Number(o.amount_limit);\n    gastoCents += Number(o.spent);",
  ],
  [
    "grupo",
    "o restante inverte o sinal (estouro vira sobra)",
    "    restante: toReais(limiteCents - gastoCents),",
    "    restante: toReais(gastoCents - limiteCents),",
  ],
  [
    "grupo",
    "o percentual perde as 4 casas",
    "    limiteCents > 0 ? Math.round((gastoCents / limiteCents) * 10000) / 10000 : 0;",
    "    limiteCents > 0 ? gastoCents / limiteCents : 0;",
  ],
  [
    "grupo",
    "o percentual sem teto vira NaN (a barra some sem erro no console)",
    "    limiteCents > 0 ? Math.round((gastoCents / limiteCents) * 10000) / 10000 : 0;",
    "    Math.round((gastoCents / limiteCents) * 10000) / 10000;",
  ],

  // --- o status do total ---
  [
    "grupo",
    "o teto estourado dentro da viagem deixa de levantar o alerta",
    '  if (orcamentos.some((o) => o.consumption_status !== "ok")) return "alert";',
    '  if (false) return "alert";',
  ],
  [
    "grupo",
    "gastar exatamente o teto deixa de ser estouro",
    '  if (limiteCents > 0 && gastoCents >= limiteCents) return "exceeded";',
    '  if (limiteCents > 0 && gastoCents > limiteCents) return "exceeded";',
  ],
  [
    "grupo",
    "qualquer linha fora de 'ok' derruba o total para 'alert', inclusive apos o estouro",
    '  if (limiteCents > 0 && gastoCents >= limiteCents) return "exceeded";\n  if (orcamentos.some((o) => o.consumption_status !== "ok")) return "alert";',
    '  if (orcamentos.some((o) => o.consumption_status !== "ok")) return "alert";\n  if (limiteCents > 0 && gastoCents >= limiteCents) return "exceeded";',
  ],

  // --- a ordem, que tem que ser deterministica ---
  [
    "grupo",
    "o desempate por id some (a lista troca de posicao sozinha)",
    "  grupos.sort((a, b) => b.ratio - a.ratio || a.group_id.localeCompare(b.group_id));",
    "  grupos.sort((a, b) => b.ratio - a.ratio);",
  ],
  [
    "grupo",
    "a ordem inverte (a viagem mais folgada vem primeiro)",
    "  grupos.sort((a, b) => b.ratio - a.ratio || a.group_id.localeCompare(b.group_id));",
    "  grupos.sort((a, b) => a.ratio - b.ratio || a.group_id.localeCompare(b.group_id));",
  ],

  // --- a frase, que e a unica coisa que a pessoa le ---
  [
    "grupo",
    "as duas frases trocam de lugar (estouro anunciado como sobra)",
    "  return total.restante < 0 ? `Estourou ${valor}` : `Restam ${valor}`;",
    "  return total.restante < 0 ? `Restam ${valor}` : `Estourou ${valor}`;",
  ],
  [
    "grupo",
    "o Math.abs some (sai 'Estourou -R$ 30', que se le como dois estouros)",
    "  }).format(Math.abs(total.restante));",
    "  }).format(total.restante);",
  ],

  // --- carry-forward: a chave e o PAR (categoria, grupo) ---
  [
    "budget",
    "a chave do carry-forward vira so a categoria (um dos dois tetos nao e criado)",
    '  const chave = (categoria: string, grupo: string | null) => `${categoria}|${grupo ?? ""}`;',
    "  const chave = (categoria: string, _grupo: string | null) => categoria;",
  ],
  [
    "budget",
    "o que ja existe no destino deixa de ser consultado (recria o que ja esta la)",
    "    existentes.map((e) => chave(e.category_id, e.group_id ?? null)),",
    "    [] as string[],",
  ],
  [
    "budget",
    "o group_id se perde na copia (o teto da viagem vira pessoal no mes seguinte)",
    "      group_id: b.group_id ?? null,",
    "      group_id: null,",
  ],
];

let sobreviventes = 0;

for (const [alvo, nome, de, para] of mutantes) {
  const caminho = ALVOS[alvo];
  // Um mutante que nao aplica passa por "morto" sem nunca ter existido: o
  // trecho mudou de forma, o replace nao encontra nada, e a suite fica verde
  // por nao ter sido mexida. Ele conta como sobrevivente de proposito.
  if (!original[alvo].includes(de)) {
    console.log(`??  ${nome}: o trecho nao existe mais -- mutante desatualizado`);
    sobreviventes++;
    continue;
  }
  writeFileSync(caminho, original[alvo].replace(de, para));
  let vermelho = false;
  try {
    execSync("npm run test:orcamento-de-grupo", { stdio: "pipe" });
  } catch {
    vermelho = true;
  }
  writeFileSync(caminho, original[alvo]);
  console.log(`${vermelho ? "OK  " : "VIVO"} ${nome}`);
  if (!vermelho) sobreviventes++;
}

for (const [alvo, caminho] of Object.entries(ALVOS)) {
  writeFileSync(caminho, original[alvo]);
}

console.log(`\n${mutantes.length - sobreviventes}/${mutantes.length} mutantes mortos`);
process.exit(sobreviventes === 0 ? 0 : 1);
