#!/usr/bin/env node
// Mutantes de lib/periodo-do-grupo.ts -- HMO-248.
//
// POR QUE ISTO EXISTE
// -------------------
// `npm run test:periodo-do-grupo` passa com 14 blocos verdes, e o bloco
// principal afirma que o aluguel fixo de tres meses vira UMA conta de R$ 1.800
// no mes selecionado. Num recorte errado essa assercao pode continuar verde por
// acaso: num grupo que tem UMA conta no mes, varios filtros errados devolvem
// 1.800. Cada mutante abaixo desfaz UMA decisao; o teste tem que ficar vermelho
// em todos.
//
// OS MUTANTES QUE IMPORTAM
// ------------------------
//   `sem_recorte_de_mes`   -- o defeito que esta issue existe para consertar:
//                             o cartao volta a somar o aluguel de outubro, de
//                             novembro e de dezembro num total de R$ 5.400.
//   `mes_por_new_date`     -- o recorte volta a passar por `Date`: a conta do
//                             dia 1 cai no mes ANTERIOR em todo fuso negativo,
//                             e o CI em UTC nao ve.
//   `fora_do_mes_invisivel` -- a parcela VENCIDA de um mes passado sai da tela
//                             sem contagem nenhuma: quem cadastrou a fixa
//                             conclui que ela nao foi gravada.
//   `mes_invalido_devolve_tudo` -- um `?mes=` cortado faz a lista inteira da
//                             vida do grupo aparecer sob o titulo de um mes so.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// Mesma escolha do mutantes-fechamento-do-grupo.mjs: a mutacao vive em memoria
// e e compilada de uma arvore TEMPORARIA. Mutar, rodar e restaurar no `finally`
// deixa a fonte mutada no disco quando o processo morre no meio.
//
// SAO DUAS DEPENDENCIAS, E AS DUAS PRECISAM DA COPIA
// -------------------------------------------------
// Este modulo importa `@/lib/settlement` (toCents/toReais) e
// `@/lib/fechamento-do-grupo` (mesDaData) -- e esse segundo importa o primeiro.
// Compilar so o arquivo mutado nao resolve `@/` e morre em erro de compilacao,
// e mutante que nao COMPILA "morre" por motivo errado, o que faz o placar
// mentir a favor. Por isso a arvore temporaria leva as DUAS copias ao lado.
//
// COMO RODAR
//   npm run mutantes:periodo-do-grupo

import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const FONTE = "lib/periodo-do-grupo.ts";
const DEPENDENCIAS = ["lib/settlement.ts", "lib/fechamento-do-grupo.ts"];
const SAIDA = ".tmp-periodo-do-grupo";
const TESTE = "scripts/test-periodo-do-grupo.mjs";

const original = readFileSync(FONTE, "utf8");

/** O recorte por Date, que e o caminho que a tela usava antes desta issue. */
const PELO_DATE =
  "((d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, " +
  '"0")}`)(new Date(String(';

const MUTANTES = [
  {
    nome: "sem_recorte_de_mes",
    porque:
      "o cartao Previstas volta a somar TODA parcela materializada da despesa " +
      "fixa: o aluguel de 1.800 vira um total de 5.400, que nao e o aluguel de " +
      "mes nenhum",
    de: "    if (alvo && mesDaConta === alvo) {",
    para: "    if (alvo) {",
  },
  {
    nome: "mes_por_new_date",
    porque:
      "o recorte da prevista volta a passar por Date: em America/Sao_Paulo a " +
      "conta que vence no dia 1 cai no mes ANTERIOR, e o CI em UTC nao ve isso",
    de: "    const mesDaConta = mesDaData(p?.due_date);",
    para: `    const mesDaConta = ${PELO_DATE}p?.due_date)));`,
  },
  {
    nome: "realizado_por_new_date",
    porque:
      "o mesmo bug de fuso do lado realizado: a despesa do dia 1 sai da lista " +
      "do mes dela e aparece na do mes anterior",
    de: "    (l) => mesDaData(l?.transaction_date) === alvo\n",
    para: `    (l) => ${PELO_DATE}l?.transaction_date))) === alvo\n`,
  },
  {
    nome: "sem_data_entra_no_mes",
    porque:
      "conta prevista sem due_date passa a entrar no mes selecionado e engorda " +
      "o total que a pessoa vai ratear com uma linha que nao vence nunca",
    de: "    const mesDaConta = mesDaData(p?.due_date);",
    para: "    const mesDaConta = mesDaData(p?.due_date) || mesDaData(mes);",
  },
  {
    nome: "fora_do_mes_invisivel",
    porque:
      "a parcela VENCIDA de um mes passado sai da tela sem contagem nenhuma -- " +
      "e ela e justamente a que pede acao",
    de: "      antes.quantidade += 1;",
    para: "      antes.quantidade += 0;",
  },
  {
    nome: "antes_e_depois_trocados",
    porque:
      "o aluguel do mes QUE VEM e anunciado como 'vencida antes': a legenda " +
      "manda a pessoa procurar uma divida que nao existe",
    de: "    } else if (mesDaConta && alvo && mesDaConta > alvo) {",
    para: "    } else if (mesDaConta && alvo && mesDaConta < alvo) {",
  },
  {
    nome: "sem_abs_no_total",
    porque:
      "uma linha de valor negativo SUBTRAI do total do mes em vez de somar, e o " +
      "cartao mostra menos do que o grupo deve",
    de: "        (acc, p) => acc + toCents(Math.abs(Number(p?.[campo]) || 0)),",
    para: "        (acc, p) => acc + toCents(Number(p?.[campo]) || 0),",
  },
  {
    nome: "soma_em_reais",
    porque:
      "a soma sai de centavos para float: doze parcelas ganham o centavo de " +
      "nada e o cartao diverge do fechamento ao lado, na mesma tela",
    de:
      "    toReais(\n" +
      "      doMes.reduce(\n" +
      "        (acc, p) => acc + toCents(Math.abs(Number(p?.[campo]) || 0)),\n" +
      "        0\n" +
      "      )\n" +
      "    );",
    para:
      "    doMes.reduce((acc, p) => acc + Math.abs(Number(p?.[campo]) || 0), 0);",
  },
  {
    nome: "parte_vira_total",
    porque:
      "'sua parte' passa a mostrar o valor cheio da conta: num grupo de dois a " +
      "pessoa ve R$ 1.800 como a parte dela de um aluguel de R$ 1.800",
    de: '    total: soma("amount"),\n    parte: soma("share_amount"),',
    para: '    total: soma("amount"),\n    parte: soma("amount"),',
  },
  {
    nome: "mes_invalido_devolve_tudo",
    porque:
      "um `?mes=` cortado no meio faz a lista inteira da vida do grupo aparecer " +
      "sob o titulo de um mes so",
    de: "  if (!alvo) return [];",
    para: "  if (false) return [];",
  },
  {
    nome: "ordem_sem_desempate",
    porque:
      "duas previstas que vencem no MESMO dia trocam de lugar entre dois " +
      "carregamentos da tela, sem nada ter mudado",
    de:
      '        (a.due_date ?? "").localeCompare(b.due_date ?? "") ||\n' +
      "        a.id.localeCompare(b.id)",
    para: '        (a.due_date ?? "").localeCompare(b.due_date ?? "")',
  },
  {
    nome: "ordem_invertida",
    porque:
      "a lista do mes abre pela conta que vence por ULTIMO -- quem abre a tela " +
      "dia 3 ve o dia 28 no topo",
    de: '        (a.due_date ?? "").localeCompare(b.due_date ?? "") ||',
    para: '        (b.due_date ?? "").localeCompare(a.due_date ?? "") ||',
  },
  {
    nome: "rotulo_por_date",
    porque:
      "o titulo do cartao volta a sair de `new Date('2026-10')`, que em " +
      "America/Sao_Paulo e setembro: a tela diz 'Previstas de setembro' sobre a " +
      "lista de outubro",
    de: "  const nome = MESES_PT[Number(m) - 1];",
    para: "  const nome = MESES_PT[new Date(mes ?? '').getMonth()];",
  },
  {
    nome: "rotulo_sem_guarda",
    porque:
      "mes fora de 01..12 vira o titulo 'undefined de 2026' no cabecalho do " +
      "cartao",
    de: "  return nome ? `${nome} de ${ano}` : mes;",
    para: "  return `${nome} de ${ano}`;",
  },
];

const dir = mkdtempSync(join(tmpdir(), "mut248-"));
const dirLib = join(dir, "lib");
mkdirSync(dirLib, { recursive: true });
for (const dep of DEPENDENCIAS) {
  copyFileSync(dep, join(dirLib, dep.replace(/^lib\//, "")));
}

// O tsconfig temporario e a copia do scripts/tsconfig.periodo-do-grupo-test.json
// apontada para a arvore mutada. `baseUrl` no dir temporario e o que faz
// `@/lib/...` achar as COPIAS, e nao os arquivos do repo.
const tsconfig = join(dir, "tsconfig.json");
writeFileSync(
  tsconfig,
  JSON.stringify({
    compilerOptions: {
      outDir: resolve(SAIDA),
      rootDir: dirLib,
      module: "es2020",
      target: "es2020",
      moduleResolution: "node",
      skipLibCheck: true,
      baseUrl: dir,
      paths: { "@/*": ["./*"] },
    },
    include: [join(dirLib, "periodo-do-grupo.ts")],
  })
);

let falhas = 0;

function compilaERoda(fonteTs) {
  writeFileSync(join(dirLib, "periodo-do-grupo.ts"), fonteTs);
  rmSync(SAIDA, { recursive: true, force: true });
  execFileSync("npx", ["tsc", "-p", tsconfig], { stdio: "pipe" });
  // O tsc resolve `@/` mas nao o reescreve no JS emitido -- o mesmo passo do
  // npm script, sem o qual o node morre em ERR_MODULE_NOT_FOUND e TODO mutante
  // "morre" por erro de import.
  execFileSync("node", ["scripts/resolve-aliases.mjs", SAIDA, "lib"], {
    stdio: "pipe",
  });
  // O fuso e o mesmo do npm script: os controles do dia 1 e do rotulo so sao
  // capazes de falhar em fuso negativo.
  execFileSync("node", ["--test", TESTE], {
    stdio: "pipe",
    env: { ...process.env, TZ: "America/Sao_Paulo" },
  });
}

try {
  // CONTROLE POSITIVO: com a fonte intacta o teste tem de PASSAR. Sem isto, um
  // "todos morreram" poderia significar apenas que o build esta quebrado e o
  // teste reprova sempre.
  try {
    compilaERoda(original);
    console.log("controle positivo: o teste passa com a fonte intacta\n");
  } catch (e) {
    console.error("ABORTADO: o teste reprova com a fonte INTACTA.");
    console.error((e.stdout ?? e.stderr ?? "").toString().slice(-1500));
    process.exit(1);
  }

  for (const m of MUTANTES) {
    // `String.replace` troca a PRIMEIRA ocorrencia. Um trecho que aparece duas
    // vezes produz um mutante que muta o lugar errado e morre verde com o
    // rotulo mentindo sobre o que foi medido -- por isso o trecho tem de ser
    // unico, e nao apenas existir.
    const ocorrencias = original.split(m.de).length - 1;
    if (ocorrencias === 0) {
      console.log(
        `  !! ${m.nome}: o trecho a mutar NAO EXISTE MAIS -- mutante invalido`
      );
      falhas++;
      continue;
    }
    if (ocorrencias > 1) {
      console.log(
        `  !! ${m.nome}: o trecho aparece ${ocorrencias}x -- mutante ambiguo, invalido`
      );
      falhas++;
      continue;
    }

    const mutado = original.replace(m.de, m.para);

    let sobreviveu = false;
    try {
      compilaERoda(mutado);
      sobreviveu = true;
    } catch {
      // reprovou (ou nem compilou): e o esperado.
    }

    if (sobreviveu) {
      console.log(`  SOBREVIVEU  ${m.nome}  <-- nenhuma assercao protege isto`);
      console.log(`              (${m.porque})`);
      falhas++;
    } else {
      console.log(`  morreu      ${m.nome}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
  // Deixa o build em dia com a fonte de verdade, para o proximo
  // `npm run test:periodo-do-grupo` nao rodar contra um artefato mutado.
  try {
    rmSync(SAIDA, { recursive: true, force: true });
    execFileSync("npm", ["run", "test:periodo-do-grupo"], { stdio: "pipe" });
  } catch {
    /* o controle positivo acima ja teria falhado */
  }
}

console.log();
if (falhas === 0) {
  console.log(`todos os ${MUTANTES.length} mutantes morreram`);
} else {
  console.log(`${falhas} mutante(s) sobreviveu/sobreviveram ou sao invalidos`);
  process.exit(1);
}
