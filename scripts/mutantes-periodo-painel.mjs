#!/usr/bin/env node
// Prova de mutacao do lib/periodo-do-painel.ts. NAO roda em CI: e uma
// ferramenta de quem esta escrevendo o teste. Cada entrada abaixo estraga uma
// decisao do arquivo; a suite tem que ficar VERMELHA em todas. Mutante que
// sobrevive e um trecho que nenhum teste distingue -- ou codigo morto.
//
// Os tres primeiros sao os bugs que a HMO-173 existiu para consertar, escritos
// de volta a mao: o mes em UTC, a transferencia entrando na soma e a agenda
// sendo materializada no passado. Se algum deles sobreviver, a suite nao esta
// cobrindo o motivo da issue.
//
//   node scripts/mutantes-periodo-painel.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ALVO = "lib/periodo-do-painel.ts";
const original = readFileSync(ALVO, "utf8");

const mutantes = [
  // --- os bugs da issue, recolocados ---
  [
    "o mes corrente volta a ser calculado em UTC",
    "export function periodoCorrente(hoje: string = today()): Periodo {\n  return periodoDoMes(hoje);",
    "export function periodoCorrente(hoje: string = today()): Periodo {\n  return periodoDoMes(new Date().toISOString().slice(0, 10));",
  ],
  [
    "transferencia volta a entrar na soma",
    '    } else {\n      // transfer, e qualquer tipo que o app venha a ganhar, fica FORA da\n      // conta e fora da contagem -- exatamente como no `COUNT(*) FILTER` da\n      // view.\n      continue;\n    }',
    "    } else if (Number(linha.amount) >= 0) {\n      entrada += Math.abs(Number(linha.amount));\n    } else {\n      saida += Math.abs(Number(linha.amount));\n    }",
  ],
  [
    "a agenda volta a ser materializada no passado",
    "  if (periodo.ate < hoje) return null;",
    "",
  ],
  [
    "a janela de escrita volta a comecar antes de hoje",
    "  return { de: periodo.de > hoje ? periodo.de : hoje, ate: periodo.ate };",
    "  return { de: periodo.de, ate: periodo.ate };",
  ],
  [
    "o resumo volta a pegar UM mes em vez de somar",
    "  const total = linhas.reduce(",
    "  const total = linhas.slice(0, 1).reduce(",
  ],

  [
    "o saldo de hoje volta a ser rotulado com o periodo escolhido",
    '      nota: "Saldo de hoje — não é do período escolhido",\n      doPeriodo: false,',
    "      nota: `Em ${rotuloDoPeriodo(opts.periodo)}`,\n      doPeriodo: true,",
  ],
  [
    "o aviso de saldo fora do periodo some",
    "  if (terminaNoPassado(opts.periodo, hoje)) {",
    "  if (false) {",
  ],

  // --- o passo de mes ---
  [
    "o fim do periodo e somado em vez de recalculado",
    "      ? ultimoDiaDoMes(addMonthsClamped(periodo.ate, passo))",
    "      ? addMonthsClamped(periodo.ate, passo)",
  ],
  [
    "o modo passa a ser herdado em vez de recalculado",
    "  return { de, ate, modo: modoDoPeriodo(de, ate) };\n}\n\n/** O periodo cobre o dia de hoje?",
    "  return { de, ate, modo: periodo.modo };\n}\n\n/** O periodo cobre o dia de hoje?",
  ],
  [
    "a seta anda o dobro",
    "export function passoDeMes(periodo: Periodo, passo: number): Periodo {",
    "export function passoDeMes(periodo: Periodo, passo: number): Periodo {\n  passo = passo * 2;",
  ],

  // --- a classificacao mes x intervalo ---
  [
    "todo periodo vira modo mes (o intervalo cairia nas views)",
    "  return comecaNoPrimeiro && terminaNoUltimo ? \"mes\" : \"intervalo\";",
    '  return "mes";',
  ],
  [
    "o fim do mes deixa de ser exigido",
    "  return comecaNoPrimeiro && terminaNoUltimo ? \"mes\" : \"intervalo\";",
    '  return comecaNoPrimeiro ? "mes" : "intervalo";',
  ],

  // --- a validacao da URL ---
  [
    "a rota aceita periodo invertido",
    "  if (de > ate) return \"invalido\";\n  return { de, ate, modo: modoDoPeriodo(de, ate) };",
    "  return { de, ate, modo: modoDoPeriodo(de, ate) };",
  ],
  [
    "meia entrada (so `de`) deixa de ser invalida",
    '  if (!ehDataIso(de) || !ehDataIso(ate)) return "invalido";',
    '  if (de != null && !ehDataIso(de)) return "invalido";\n  if (de == null || ate == null) return null;',
  ],
  [
    "a tela deixa de cair no mes corrente e devolve o periodo estragado",
    "  if (!ehDataIso(de) || !ehDataIso(ate)) return periodoCorrente(hoje);",
    "  if (typeof de !== \"string\" || typeof ate !== \"string\") return periodoCorrente(hoje);",
  ],
  [
    "o dia inexistente passa na validacao",
    "  return dia >= 1 && dia <= diasNoMes(ano, mes);",
    "  return dia >= 1 && dia <= 31;",
  ],

  // --- os presets ---
  [
    "ultimos 3 meses deixa de incluir o mes corrente",
    "addMonthsClamped(primeiroDiaDoMes(hoje), -2)",
    "addMonthsClamped(primeiroDiaDoMes(hoje), -3)",
  ],
  [
    "mes passado vira o mes corrente",
    "    return periodoDoMes(addMonthsClamped(primeiroDiaDoMes(hoje), -1));",
    "    return periodoDoMes(hoje);",
  ],
  [
    "o ano acaba em 30/12",
    "    return { de: `${ano}-01-01`, ate: `${ano}-12-31`, modo: \"mes\" };",
    '    return { de: `${ano}-01-01`, ate: `${ano}-12-30`, modo: "mes" };',
  ],

  // --- as bordas de hoje ---
  [
    "o ultimo dia do periodo deixa de ser presente",
    "  return periodo.de <= hoje && hoje <= periodo.ate;",
    "  return periodo.de <= hoje && hoje < periodo.ate;",
  ],
  [
    "o periodo que termina hoje passa a contar como passado",
    "  return periodo.ate < hoje;",
    "  return periodo.ate <= hoje;",
  ],

  // --- o rotulo ---
  [
    "o rotulo do intervalo passa por Date",
    "  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;",
    "  return new Date(iso).toLocaleDateString(\"pt-BR\");",
  ],
  [
    "a janela de varios meses e rotulada como um mes so",
    "  if (periodo.de.slice(0, 7) === periodo.ate.slice(0, 7)) {",
    "  if (true) {",
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
    execSync("npm run test:periodo-painel", { stdio: "pipe" });
  } catch {
    vermelho = true;
  }
  console.log(`${vermelho ? "OK  " : "VIVO"} ${nome}`);
  if (!vermelho) sobreviventes++;
}

writeFileSync(ALVO, original);
console.log(`\n${mutantes.length - sobreviventes}/${mutantes.length} mutantes mortos`);
process.exit(sobreviventes === 0 ? 0 : 1);
