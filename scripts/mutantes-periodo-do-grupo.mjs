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
// COMO RODAR
//   npm run mutantes:periodo-do-grupo
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
//   - o tsconfig repetido a mao, que podia divergir do alvo `test:periodo-do-grupo`
//     -- agora as etapas saem do proprio package.json;
//   - a saida MUTADA emitida dentro do repositorio, que o `finally` tinha de
//     recompilar depois. A sombra emite em /tmp; `lib/periodo-do-grupo.ts`
//     e o `.tmp-*` do repositorio nao sao tocados em momento nenhum.
//
// A lista de mutantes abaixo nao foi reescrita: ela veio byte a byte do arquivo
// anterior, pelo `scripts/converte-mutantes-em-bloco.mjs`.

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const FONTE = "lib/periodo-do-grupo.ts";

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

const SUITE = "test:periodo-do-grupo";

const bloco = criarBlocoDeMutantes({ rotulo: "periodo-do-grupo", suites: [SUITE] });

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
