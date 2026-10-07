#!/usr/bin/env node
// Prova de mutacao do lib/parte-do-grupo.ts. NAO roda em CI: e ferramenta de
// quem esta escrevendo o teste. Cada entrada abaixo estraga uma decisao do
// arquivo; a suite tem que ficar VERMELHA em todas. Mutante que sobrevive e um
// trecho que nenhum teste distingue -- ou codigo morto.
//
// O primeiro grupo e o que interessa: sao os erros que a TELA NAO MOSTRA. Um
// custo fixo inflado sai formatado em reais, a barra enche, e a pessoa atribui
// o numero alto a gastar mesmo. O inverso e pior: um custo fixo subestimado faz
// o safe-to-spend prometer dinheiro que nao sobra, e tambem nao acusa nada.
//
//   node scripts/mutantes-parte-do-grupo.mjs
import { writeFileSync } from "node:fs";
import { protegerArvore } from "./auto-cura-de-mutante.mjs";
import { execSync } from "node:child_process";

const ALVO = "lib/parte-do-grupo.ts";
// O original vem do helper, e nao de um `readFileSync` aqui, para a leitura
// acontecer DEPOIS da auto-cura -- ver o contrato de ordem no cabecalho dele.
const { originais, encerrar } = protegerArvore({
  runner: "parte-do-grupo",
  arquivos: [ALVO],
});
const original = originais[ALVO];

const mutantes = [
  // --- o defeito original: a parte do outro contando como minha ---
  [
    "a parte volta a ser o valor CHEIO (o defeito da HMO-177 de volta)",
    "  return toReais(Math.round(toCents(cheio) / membros));",
    "  return cheio;",
  ],
  [
    "o group_id deixa de ser olhado (toda despesa vira pessoal)",
    "  if (!groupId) return cheio;",
    "  if (true) return cheio;",
  ],

  // --- o erro espelhado: dividir o que nao e de grupo ---
  [
    "a despesa PESSOAL passa a ser dividida tambem",
    "  if (!groupId) return cheio;",
    "  if (false) return cheio;",
  ],

  // --- a contagem desconhecida, que nao pode virar palpite ---
  [
    "grupo desconhecido passa a ser dividido por 2 (subestima o custo fixo)",
    "  if (membros === undefined || !Number.isFinite(membros) || membros < 1) {\n    return cheio;\n  }",
    "  if (false) {\n    return cheio;\n  }\n  if (membros === undefined) return toReais(Math.round(toCents(cheio) / 2));",
  ],
  [
    "contagem zero/negativa deixa de ser barrada (divisao por zero, Infinity na tela)",
    "  if (membros === undefined || !Number.isFinite(membros) || membros < 1) {\n    return cheio;\n  }",
    "  if (membros === undefined) {\n    return cheio;\n  }",
  ],

  // --- o status do membro: quem saiu nao divide conta ---
  [
    "membro inativo volta a contar (a minha parte fica MENOR do que a real)",
    '    if (linha.status && linha.status !== "active") continue;',
    "    if (false) continue;",
  ],
  [
    "a contagem passa a ser por linha e nao por grupo (um grupo herda o total do outro)",
    "    contagem.set(linha.group_id, (contagem.get(linha.group_id) ?? 0) + 1);",
    '    contagem.set(linha.group_id, (contagem.get("todos") ?? 0) + 1);',
  ],

  // --- centavos ---
  [
    "a parte passa a sair em ponto flutuante cru (33.333333333333336 na tela)",
    "  return toReais(Math.round(toCents(cheio) / membros));",
    "  return cheio / membros;",
  ],

  // --- o custo fixo mensal ---
  [
    "a receita volta a entrar no custo fixo",
    '    .filter((r) => r.transaction_type !== "income")',
    "    .filter(() => true)",
  ],
  [
    "a normalizacao para mes desaparece (o seguro anual vira parcela mensal)",
    "        monthlyCost(\n          {\n            frequency: r.frequency,\n            interval_count: r.interval_count ?? 1,\n            start_date: hoje,\n          },\n          minha\n        )",
    "        minha",
  ],
  [
    // A ancora deste mutante morreu quando a HMO-303/304 trocou a divisao IGUAL
    // (`parteDoMembro`) pela divisao POR PESO (`parteConfiguradaDoMembro`) --
    // a chamada passou de uma linha para cinco e de tres argumentos para
    // quatro. O mutante seguiu no arquivo dando "trecho nao existe mais", que
    // este runner conta como sobrevivente de proposito: um mutante que nao
    // aplica fica verde por nao ter mexido em nada.
    "o custo fixo soma o valor cheio em vez da minha parte",
    "      const minha = parteConfiguradaDoMembro(\n        r.amount,\n        r.group_id,\n        pesosPorGrupo,\n        meuUserId\n      );",
    "      const minha = Number(r.amount) || 0;",
  ],
  [
    "o arredondamento final do custo fixo some",
    "  return Number(total.toFixed(2));",
    "  return total;",
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
    execSync("npm run test:parte-do-grupo", { stdio: "pipe" });
  } catch {
    vermelho = true;
  }
  writeFileSync(ALVO, original);
  console.log(`${vermelho ? "OK  " : "VIVO"} ${nome}`);
  if (!vermelho) sobreviventes++;
}

// O laco acima ja restaurou a cada volta; isto apaga o sentinel e o lock da
// auto-cura, porque daqui em diante nao ha medicao em andamento para curar.
encerrar();

// O .tmp-parte-do-grupo que sobra e o build do ULTIMO mutante. Deixar isso no
// disco faz a proxima leitura do JS compilado mentir.
execSync("rm -rf .tmp-parte-do-grupo");

console.log(
  sobreviventes === 0
    ? `\n${mutantes.length} mutantes, nenhum sobrevivente.`
    : `\n${sobreviventes} de ${mutantes.length} mutantes SOBREVIVERAM.`
);
process.exit(sobreviventes === 0 ? 0 : 1);
