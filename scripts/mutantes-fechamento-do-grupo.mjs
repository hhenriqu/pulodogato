#!/usr/bin/env node
// Mutantes de lib/fechamento-do-grupo.ts -- HMO-245.
//
// POR QUE ISTO EXISTE
// -------------------
// `npm run test:fechamento-do-grupo` passa com 20 blocos verdes, e um deles
// afirma que a internet de R$ 159,90 aparece no fechamento de outubro. Num
// modulo que soma errado, essa assercao continua verde se o numero certo sair
// por acaso -- o fechamento tem UMA conta no mes do exemplo, e varias contas
// erradas devolvem 159,90 para uma linha so. Cada mutante abaixo desfaz UMA
// decisao; o teste tem que ficar vermelho em todos.
//
// OS MUTANTES QUE IMPORTAM
// ------------------------
//   `sem_abs`              -- o defeito que este modulo existe para nao ter:
//                             previsto (+) e realizado (-) se CANCELAM e o mes
//                             fecha em zero com as duas despesas na lista.
//   `paga_entra`           -- conta a internet DUAS vezes no mes em que ela
//                             recebe baixa: R$ 319,80 de uma conta de 159,90.
//   `previsto_sem_direction` -- soma receita prevista de grupo como conta a
//                             pagar (a familia da 027).
//   `rateio_por_linha`     -- 666,67 x 3 = 2.000,01: todo grupo de tres passa a
//                             dizer "as contas nao fecham por R$ 0,01".
//   `fecha_vacuo`          -- grupo sem membro ativo diz "fecha" com dinheiro
//                             sem dono. Foi um bug REAL deste modulo, achado
//                             pelo teste antes do commit; este mutante e o que
//                             impede ele de voltar.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// Mesma escolha do mutantes-convite-de-grupo.mjs: a mutacao vive em memoria e
// e compilada de um arquivo TEMPORARIO. Mutar, rodar e restaurar no `finally`
// deixa a fonte mutada no disco quando o processo morre no meio.
//
// O IMPORT DE @/lib/settlement E O QUE COMPLICA O BUILD
// -----------------------------------------------------
// Este modulo importa `toCents`/`simplifySettlements`. Compilar so o arquivo
// mutado com `tsc arquivo.ts` nao resolve `@/` e morre em erro de compilacao --
// e um mutante que nao COMPILA "morre" por motivo errado, o que faz o placar
// mentir a favor. Por isso o runner monta uma arvore temporaria com a copia de
// lib/settlement.ts ao lado, escreve um tsconfig com `baseUrl`/`paths` e roda o
// mesmo resolve-aliases.mjs do npm script.
//
// COMO RODAR
//   npm run mutantes:fechamento-do-grupo

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

const FONTE = "lib/fechamento-do-grupo.ts";
const DEPENDENCIA = "lib/settlement.ts";
const SAIDA = ".tmp-fechamento-do-grupo";
const TESTE = "scripts/test-fechamento-do-grupo.mjs";

const original = readFileSync(FONTE, "utf8");

const MUTANTES = [
  {
    nome: "sem_abs",
    porque:
      "previsto (+159,90) e realizado (-159,90) se cancelam e outubro fecha em " +
      "ZERO, com as duas despesas visiveis na lista do lado",
    de: "const bruto = Math.abs(Number(amount) || 0);",
    para: "const bruto = Number(amount) || 0;",
  },
  {
    nome: "cotacao_zero_apaga",
    porque:
      "exchange_rate = 0 (ou coluna nao preenchida que chega como 0) multiplica " +
      "a despesa por zero e ela sai do fechamento sem erro nenhum",
    de: "const taxa = Number.isFinite(cotacao) && cotacao > 0 ? cotacao : 1;",
    para: "const taxa = Number.isFinite(cotacao) ? cotacao : 1;",
  },
  {
    nome: "paga_entra",
    porque:
      "a conta prevista com baixa entra junto com a transacao que ela gerou -- " +
      "a internet de 159,90 vira 319,80 no mes em que foi paga",
    de: '  if (linha.status === "paid") return null;',
    para: "  if (false) return null;",
  },
  {
    nome: "previsto_sem_direction",
    porque:
      "toda conta prevista vira despesa: um reembolso previsto de R$ 5.000 no " +
      "grupo entra como conta a pagar e o fechamento cobra isso de todo mundo",
    de: '    tipo: linha.direction ?? "expense",',
    para: '    tipo: "expense",',
  },
  {
    nome: "realizado_sem_tipo",
    porque:
      "receita realizada do grupo entra como despesa -- e a linha antiga com " +
      "transaction_type NULL perde o unico criterio que sobrou (o sinal)",
    de:
      "    tipo:\n" +
      "      linha.transaction_type ??\n" +
      '      ((Number(linha.amount) || 0) < 0 ? "expense" : "income"),',
    para: '    tipo: "expense",',
  },
  {
    nome: "tipo_nao_filtra",
    porque:
      "'o sinal ja foi normalizado, o tipo nao importa' -- entram receita e as " +
      "DUAS pernas de cada transferencia, e o total do mes infla sem ninguem gastar",
    de: '    .filter((l) => (l.tipo ?? "expense") === "expense")',
    para: "    .filter(() => true)",
  },
  {
    nome: "rateio_por_linha",
    porque:
      "cada parte arredondada por conta propria: 2.000 entre tres da 666,67 x 3 " +
      "= 2.000,01, e todo grupo de tres passa a exibir residuo de um centavo",
    de: "  const base = efetivos.map((p) => Math.floor((absoluto * p) / soma));",
    para: "  const base = efetivos.map((p) => Math.round((absoluto * p) / soma));",
  },
  {
    nome: "rateio_descarta_resto",
    porque:
      "o resto da divisao e jogado fora: as partes somam MENOS que o total e o " +
      "grupo divide 1.999,98 de uma conta de 2.000",
    de: "  let sobra = absoluto - base.reduce((acc, b) => acc + b, 0);",
    para: "  let sobra = 0;",
  },
  {
    nome: "peso_ignorado",
    porque:
      "a divisao volta a ser SEMPRE igual: o grupo configurado em 70/30 fecha " +
      "1.000/1.000 de um mes de R$ 2.000, e nada na tela denuncia",
    de:
      "  const efetivos = somaPesos > 0 ? limpos : limpos.map(() => 1);\n" +
      "  const soma = somaPesos > 0 ? somaPesos : n;",
    para:
      "  const efetivos = limpos.map(() => 1);\n" + "  const soma = n;",
  },
  {
    nome: "degrau_zero_zero",
    porque:
      "todos os pesos em zero -- que e o estado de TODO grupo criado antes da " +
      "fase 3, pelo DEFAULT 0.00 da coluna -- divide por zero e a tela mostra " +
      "'R$ NaN' para todo mundo, sem erro nenhum no caminho",
    de: "  const soma = somaPesos > 0 ? somaPesos : n;",
    para: "  const soma = somaPesos;",
  },
  {
    nome: "peso_zero_vira_um",
    porque:
      "membro em 0% volta a entrar na divisao com uma parte minuscula em vez " +
      "de ficar fora dela -- o degrau que separa `group_members.percentage` " +
      "(aceita 0) de `expense_splits.percentage` (exige > 0)",
    de:
      "    typeof p.peso === \"number\" && Number.isFinite(p.peso) && p.peso > 0\n" +
      "      ? p.peso\n" +
      "      : 0",
    para:
      "    typeof p.peso === \"number\" && Number.isFinite(p.peso) && p.peso > 0\n" +
      "      ? p.peso\n" +
      "      : 1",
  },
  {
    nome: "resto_invertido",
    porque:
      "o centavo que sobra vai para quem tem o MENOR resto: num grupo 70/30/0% " +
      "ele cai justamente no membro que nao divide a conta, e o fechamento " +
      "cobra R$ 0,01 de quem configurou 0%",
    de: "    .sort((a, b) => (b.resto !== a.resto ? b.resto - a.resto : a.i - b.i));",
    para: "    .sort((a, b) => (b.resto !== a.resto ? a.resto - b.resto : a.i - b.i));",
  },
  {
    nome: "desempate_sem_indice",
    porque:
      "em divisao igual TODOS os restos empatam, entao sem o desempate por " +
      "indice o centavo de um mes de R$ 2.000 entre tres nao tem dono fixo",
    de: "    .sort((a, b) => (b.resto !== a.resto ? b.resto - a.resto : a.i - b.i));",
    para: "    .sort((a, b) => b.resto - a.resto).reverse();",
  },
  {
    nome: "membro_sem_peso_vira_um",
    porque:
      "`m.peso ?? 1` em vez de `?? 0`: num grupo onde um membro nao tem peso " +
      "configurado ele divide 1 contra os 7000 dos outros -- uma parte de quase " +
      "zero onde devia haver parte igual",
    de: "    membros.map((m) => ({ user_id: m.user_id, peso: m.peso ?? 0 }))",
    para: "    membros.map((m) => ({ user_id: m.user_id, peso: m.peso ?? 1 }))",
  },
  {
    nome: "mes_por_new_date",
    porque:
      "o recorte do mes volta a passar por Date: em America/Sao_Paulo a conta " +
      "do dia 1 cai no mes anterior, e o CI em UTC nao ve isso",
    de: "  const mes = data.slice(0, 7);",
    para:
      "  const d = new Date(data);\n" +
      '  const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;',
  },
  {
    nome: "fecha_vacuo",
    porque:
      "grupo sem membro ativo diz 'fecha' com dinheiro sem dono -- foi um bug " +
      "REAL deste modulo, que o teste pegou antes do commit",
    de: "    fecha: somaDosSaldos === 0 && naoMembroCents === 0,",
    para: "    fecha: somaDosSaldos === 0,",
  },
  {
    nome: "nao_membro_creditado",
    porque:
      "quem saiu do grupo e creditado num balde que a tela nao mostra: o " +
      "residuo desaparece e o fechamento diz que fecha quando nao fecha",
    de: "    if (l.pagador_user_id && devidoPor.has(l.pagador_user_id)) {",
    para: "    if (l.pagador_user_id) {",
  },
  {
    nome: "previsto_vira_total",
    porque:
      "'previsto e o total' -- o cartao do mes passa a mostrar o mes inteiro como " +
      "previsto, inclusive o que ja foi pago",
    de: "    total_previsto: toReais(totalCents - realizadoCents),",
    para: "    total_previsto: toReais(totalCents),",
  },
  {
    nome: "ordem_sem_desempate",
    porque:
      "duas contas na MESMA data trocam de lugar entre dois carregamentos da " +
      "tela, sem nada ter mudado",
    de:
      "      (a, b) => b.data.localeCompare(a.data) || a.id.localeCompare(b.id)",
    para: "      (a, b) => b.data.localeCompare(a.data)",
  },
  {
    nome: "seletor_sem_mes_de_hoje",
    porque:
      "grupo novo (ou mes sem conta) abre num seletor VAZIO em vez do " +
      "fechamento do mes corrente",
    de: "  if (mesDeHoje) meses.add(mesDeHoje);",
    para: "  if (false) meses.add(mesDeHoje);",
  },
  {
    nome: "mes_sem_guarda_de_tipo",
    porque:
      "linha com due_date/transaction_date NULL faz `null.slice` lancar e " +
      "derruba o fechamento inteiro, em vez de a linha ficar de fora",
    de: '  if (typeof data !== "string") return "";',
    para: "  if (false) return \"\";",
  },
];
//
// NOTA SOBRE UM MUTANTE QUE FOI REMOVIDO
// --------------------------------------
// `mesDaData` tinha uma segunda guarda, `data.length < 7`. O mutante que a
// removia SOBREVIVEU -- e sobreviveu com razao: string de menos de 7
// caracteres fatia em si mesma e nao casa com um padrao de exatamente 7, entao
// a guarda era codigo morto e a regex ja fazia o trabalho. A conclusao foi
// apagar a guarda do modulo, nao escrever um teste para ela.

const dir = mkdtempSync(join(tmpdir(), "mut245-"));
const dirLib = join(dir, "lib");
mkdirSync(dirLib, { recursive: true });
copyFileSync(DEPENDENCIA, join(dirLib, "settlement.ts"));

// O tsconfig temporario e a copia do scripts/tsconfig.fechamento-do-grupo-test
// .json apontada para a arvore mutada. `baseUrl` no dir temporario e o que faz
// `@/lib/settlement` achar a COPIA, e nao o arquivo do repo.
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
    include: [join(dirLib, "fechamento-do-grupo.ts")],
  })
);

let falhas = 0;

function compilaERoda(fonteTs) {
  writeFileSync(join(dirLib, "fechamento-do-grupo.ts"), fonteTs);
  rmSync(SAIDA, { recursive: true, force: true });
  execFileSync("npx", ["tsc", "-p", tsconfig], { stdio: "pipe" });
  // O tsc resolve `@/` mas nao o reescreve no JS emitido -- o mesmo passo do
  // npm script, sem o qual o node morre em ERR_MODULE_NOT_FOUND e TODO mutante
  // "morre" por erro de import.
  execFileSync("node", ["scripts/resolve-aliases.mjs", SAIDA, "lib"], {
    stdio: "pipe",
  });
  // O fuso e o mesmo do npm script: o controle do dia 1 so e capaz de falhar
  // em fuso negativo.
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
  // `npm run test:fechamento-do-grupo` nao rodar contra um artefato mutado.
  try {
    rmSync(SAIDA, { recursive: true, force: true });
    execFileSync("npm", ["run", "test:fechamento-do-grupo"], { stdio: "pipe" });
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
