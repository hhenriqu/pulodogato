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
// COMO RODAR
//   npm run mutantes:fechamento-do-grupo
//
// O BLOCO: UMA COMPILACAO PARA TODOS OS MUTANTES (HMO-318)
// --------------------------------------------------------
// Este runner era da familia da HMO-246: montava uma arvore temporaria com uma
// lista de DEPENDENCIAS escrita a mao, sintetizava um tsconfig e disparava
// `npx tsc` + `resolve-aliases` + `node --test` UMA VEZ POR MUTANTE. Entre
// duas voltas mudava UM arquivo, e o programa inteiro era reparseado do zero.
//
// Agora as voltas dividem um processo e um cache de AST (`criarBlocoDeMutantes`,
// HMO-319): so o arquivo mutado e reparseado. Tres coisas sairam junto, e as
// tres eram defeito:
//
//   - a lista de DEPENDENCIAS a mao, que envelhecia em silencio e ja deixou
//     runner desta familia abortando por meses (ver o conversor);
//   - o tsconfig repetido a mao, que podia divergir do alvo `test:fechamento-do-grupo`
//     -- agora as etapas saem do proprio package.json;
//   - a saida MUTADA emitida dentro do repositorio, que o `finally` tinha de
//     recompilar depois. A sombra emite em /tmp; `lib/fechamento-do-grupo.ts`
//     e o `.tmp-*` do repositorio nao sao tocados em momento nenhum.
//
// A lista de mutantes abaixo nao foi reescrita: ela veio byte a byte do arquivo
// anterior, pelo `scripts/converte-mutantes-em-bloco.mjs`.

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const FONTE = "lib/fechamento-do-grupo.ts";

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

const SUITE = "test:fechamento-do-grupo";

const bloco = criarBlocoDeMutantes({ rotulo: "fechamento-do-grupo", suites: [SUITE] });

// A sombra vive em diretorio temporario. No pior caso sobra um diretorio orfao
// em /tmp -- e nao uma fonte mutada na arvore, que era o modo de falha do
// desenho anterior. O handler de sinal existe para que nem o orfao sobre:
// `finally` nao roda em SIGTERM, mas `process.exit` dispara o `exit` abaixo.
process.on("exit", () => bloco.fechar());
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => process.exit(1));
}

// CONTROLE POSITIVO: a arvore INTACTA tem de passar antes de qualquer mutante,
// e pelo MESMO `rodar` que os mutantes usam -- por isso ele pega erro no
// aparelho. Sem ele, uma sombra mal montada reprova TODO mutante e o placar sai
// "N/N mortos" sobre zero assercoes executadas.
const controle = bloco.rodar("controle", {}, SUITE);
if (!controle.verde) {
  console.error(`ABORTADO: ${FONTE} INTACTO reprova em ${SUITE} (${controle.como}).`);
  console.error(`  ${controle.saida}`);
  console.error("O placar nao valeria: todo mutante 'morreria' sem ter sido medido.");
  process.exit(1);
}
console.log(`controle positivo: ${FONTE} intacto passa em ${SUITE}\n`);

let falhas = 0;

for (const m of MUTANTES) {
  // `String.replace` troca a PRIMEIRA ocorrencia. Um trecho que aparece duas
  // vezes produz um mutante que muta o lugar errado e morre verde com o rotulo
  // mentindo sobre o que foi medido -- por isso o trecho tem de ser UNICO, e
  // nao apenas existir.
  const ocorrencias = original.split(m.de).length - 1;
  if (ocorrencias === 0) {
    console.log(`  !! ${m.nome}: o trecho a mutar NAO EXISTE MAIS -- mutante invalido`);
    falhas++;
    continue;
  }
  if (ocorrencias > 1) {
    console.log(`  !! ${m.nome}: o trecho aparece ${ocorrencias}x -- mutante ambiguo, invalido`);
    falhas++;
    continue;
  }

  const r = bloco.rodar(m.nome, { [FONTE]: original.replace(m.de, m.para) }, SUITE);

  if (r.verde) {
    console.log(`  SOBREVIVEU  ${m.nome}  <-- nenhuma assercao protege isto`);
    console.log(`              (${m.porque})`);
    if (r.mudouASaida === false) {
      console.log("              (saida compilada identica a da arvore limpa: EQUIVALENTE)");
    }
    falhas++;
  } else {
    // Morrer no tsc tambem e morrer -- mutante que nao compila nao chega em
    // producao --, mas a distincao importa: um erro de tipo nao diz que a SUITE
    // pegou a regra.
    console.log(`  morreu      ${m.nome}  (${r.como === "tsc" ? "tsc" : "asercao"})`);
  }
}

console.log();
if (falhas === 0) {
  console.log(`todos os ${MUTANTES.length} mutantes morreram`);
} else {
  console.log(`${falhas} mutante(s) sobreviveu/sobreviveram ou sao invalidos`);
  process.exit(1);
}
