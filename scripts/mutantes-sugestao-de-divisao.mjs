#!/usr/bin/env node
// Prova de mutacao da sugestao de divisao viva (HMO-245 fase 7 / HMO-273).
//
//   node scripts/mutantes-sugestao-de-divisao.mjs
//
// Cada entrada estraga uma decisao; `npm run test:sugestao-de-divisao` tem que
// ficar VERMELHA. Mutante que sobrevive e um trecho que nenhum teste distingue --
// ou codigo morto, que e exatamente o defeito que esta fase foi consertar.
//
// OS MUTANTES QUE SAO O CONTROLE NEGATIVO DA ENTREGA
// --------------------------------------------------
// Quatro, e sao a entrega inteira:
//
//   * `A SUGESTAO CONFIGURADA VOLTA A SER CODIGO MORTO` -- a rota deixa de
//     empurra-la. E o estado de ANTES desta fase. Se ele sobrevive, a suite nao
//     mede a feature, e nenhum outro mutante compensa;
//   * `VOLTA A LER O MODO APOSENTADO` -- a condicao volta para `proportional`;
//   * `O R$ VOLTA A SER total * % / 100` -- o criterio antigo da previa;
//   * `O DESEMPATE DO CENTAVO VOLTA PARA A ORDEM RECEBIDA` -- a previa cobra de
//     uma pessoa e a despesa, de outra.
//
// O CONTROLE POSITIVO VEM PRIMEIRO, E E O UNICO QUE PEGA ERRO DE SCRIPT
// ---------------------------------------------------------------------
// Se a suite ja estiver vermelha antes de qualquer mutacao -- ou se o
// `replace` nao casar e o runner "mutar" nada --, todo mutante aparece como
// MORTO e o relatorio sai 10/10 sem ter medido nada. Por isso:
//
//   1. a suite roda limpa antes de tudo, e o runner para se nao estiver verde;
//   2. cada `replace` CONFERE que a ancora existe e que o texto mudou. Ancora
//      que nao casa e erro do runner, nao mutante morto.
//
// O BLOCO: UMA COMPILACAO PARA TODOS OS MUTANTES (HMO-335)
// --------------------------------------------------------
// Este runner MUTAVA A ARVORE RASTREADA: escrevia o mutante num dos quatro
// arquivos de producao, chamava `npm run` ali mesmo e restaurava num `finally`.
// Dois defeitos, e o segundo e o que doia:
//
//   1. cada volta recompilava o programa INTEIRO para trocar UM arquivo -- 17
//      voltas de `tsc` completo, 56s medidos;
//   2. o `finally` NAO roda em SIGTERM, que e o sinal que um timeout manda, e
//      `execSync` BLOQUEIA a thread do JS -- entao nem um handler de sinal
//      resolveria. Ja aconteceu nesta arvore: a HMO-329 comecou com
//      `lib/divisao-configurada.ts` -- um dos quatro alvos DESTE runner --
//      mutado na arvore, e os `.tmp-*` compilados guardando a mutacao.
//
// Agora as voltas dividem um processo e um cache de AST
// (`criarBlocoDeMutantes`, HMO-319): so o arquivo mutado e reparseado, e a
// mutacao vai para uma SOMBRA em diretorio temporario. A arvore rastreada e o
// `.tmp-*` do repositorio nao sao tocados em momento nenhum, entao o pior caso
// de um processo morto e um diretorio orfao em /tmp.
//
// Por isso o `restaurar` saiu inteiro, e com ele o `rmSync` do
// `.tmp-sugestao-de-divisao`: aquele `rmSync` existia porque o emit de uma
// arvore MUTADA sobrevivia ao restore do fonte e era lido pela rodada seguinte
// (ver [[tmp-compilado-guarda-o-mutante-depois-do-restore]]). O bloco emite
// DENTRO da sombra, entao o `.tmp-*` do repositorio nunca ve codigo mutado e
// nao ha o que limpar.
//
// As etapas da suite saem do proprio `scripts["test:sugestao-de-divisao"]` do
// package.json -- o comando que o CI roda --, e nao de uma receita repetida a
// mao aqui.
//
// A lista de mutantes abaixo NAO foi reescrita nem movida: o diff desta
// conversao nao toca uma linha dela.
import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const LIB = "lib/sugestao-de-divisao.ts";
const ROTA = "app/api/expense-groups/[groupId]/split-suggestions/route.ts";
const CONFIG = "lib/divisao-configurada.ts";
const TELA_DO_GRUPO =
  "app/(dashboard)/dashboard/expense-groups/[groupId]/page.tsx";

const SUITE = "test:sugestao-de-divisao";

// Lido da arvore de verdade, que e o original por construcao: nada mais aqui
// escreve nela.
const original = new Map(
  [LIB, ROTA, CONFIG, TELA_DO_GRUPO].map((a) => [a, readFileSync(a, "utf8")])
);

/** [rotulo, arquivo, de, para] */
const mutantes = [
  // =========================================================================
  // A ENTREGA 1: a sugestao configurada volta a aparecer
  // =========================================================================
  [
    "A SUGESTAO CONFIGURADA VOLTA A SER CODIGO MORTO: a rota nao a empurra",
    ROTA,
    "    if (configurados) {\n      suggestions.push(",
    "    if (false && configurados) {\n      suggestions.push(",
  ],
  [
    "VOLTA A LER O MODO APOSENTADO: `proportional` em vez do modo do grupo",
    LIB,
    'if (aplicada.aplicado !== "percentage") return null;',
    'if (modo !== "proportional") return null;',
  ],
  [
    "a rota passa um modo FIXO em vez do `default_split_type` do grupo",
    ROTA,
    "    const configurados = pesosConfigurados(\n      group.default_split_type,",
    '    const configurados = pesosConfigurados(\n      "percentage",',
  ],
  [
    "a ORDEM da lista se inverte: a sugestao configurada deixa de vir primeiro",
    ROTA,
    "      success: true,\n      suggestions,",
    "      success: true,\n      suggestions: [...suggestions].reverse(),",
  ],
  [
    "a soma gravada deixa de ser conferida: 70/27 vira 72,16/27,84",
    CONFIG,
    'configurado === "percentage" && soma === CENTESIMOS_TOTAIS',
    'configurado === "percentage"',
  ],

  // =========================================================================
  // O R$ DA PREVIA: o que tem de fechar ao centavo
  // =========================================================================
  [
    "O R$ VOLTA A SER total * % / 100: tres membros e R$ 10,00 dao R$ 9,99",
    LIB,
    `      ? ratearPorPeso(
          toCents(total),`,
    `      ? new Map(
          pesos.map((p) => [
            p.member_id,
            Math.round((total * (p.centesimos / 100)) / 100 * 100),
          ])
        ) ?? ratearPorPeso(
          toCents(total),`,
  ],
  [
    "O DESEMPATE DO CENTAVO VOLTA PARA A ORDEM RECEBIDA",
    LIB,
    `          [...pesos]
            .sort((a, b) =>
              a.member_id < b.member_id ? -1 : a.member_id > b.member_id ? 1 : 0
            )
            .map((p) => ({`,
    `          [...pesos]
            .map((p) => ({`,
  ],
  [
    "`amount` passa a sair como 0 quando nao ha valor digitado",
    LIB,
    "    if (centavos) {\n      parte.amount = toReais(centavos.get(p.member_id) ?? 0);\n    }",
    "    parte.amount = toReais(centavos?.get(p.member_id) ?? 0);",
  ],
  [
    "o total NEGATIVO passa a valer como previa (o `> 0` cai)",
    LIB,
    "typeof total === \"number\" && Number.isFinite(total) && total > 0",
    'typeof total === "number" && Number.isFinite(total)',
  ],

  // =========================================================================
  // AS OUTRAS TRES SUGESTOES
  // =========================================================================
  [
    "membro em 0% SAI da lista da sugestao (sumido vira indistinguivel de zerado)",
    LIB,
    "  return pesos.map((p) => {",
    "  return pesos.filter((p) => p.centesimos > 0).map((p) => {",
  ],
  [
    "a parte de 0% VOLTA a entrar no corpo do POST: o lancamento falha sempre",
    LIB,
    "  return partes.filter((p) => p.percentage > 0);",
    "  return [...partes];",
  ],
  [
    "a TELA volta a montar `custom_splits` sem passar pelo filtro",
    TELA_DO_GRUPO,
    // O `: any` do callback saiu na HMO-179 ("zero aviso de lint em 579
    // arquivos") e levou a ancora com ele. O runner nao deu o mutante por
    // morto: acusou ANCORA NAO CASOU e saiu 1, que e a trava funcionando.
    "        expenseData.custom_splits = partesParaGravar(\n          selectedSplitSuggestion.splits\n        ).map((split) => ({",
    "        expenseData.custom_splits = selectedSplitSuggestion.splits.map((split) => ({",
  ],
  // A guarda `participacoes > 0` de `pesosDoHistorico` NAO tem mutante, e a
  // ausencia e deliberada: ela e inalcancavel como causa UNICA. Tirando-a,
  // `somaPercentual / participacoes` vira `0 / 0`, que e `NaN`, e `NaN`
  // contamina a soma -- entao a guarda SEGUINTE (`!(soma > 0)`) devolve o mesmo
  // `null` pelo mesmo caminho. O mutante sobreviveria, e o sobrevivente estaria
  // certo: ver [[duas-guardas-redundantes-fazem-os-dois-mutantes-sobreviverem]].
  //
  // A guarda fica no codigo de proposito. Ela diz o que a funcao decide ("media
  // de zero despesas e 'nao sei', nao '0%'") em vez de deixar a decisao
  // depender de `NaN` atravessar tres linhas de aritmetica calado -- que e a
  // classe de defeito que este repositorio ja pagou caro. O caso de teste
  // existe (`quem nao participou de NADA nao vira 0%`); o que nao existe e um
  // mutante que o distinga, e um mutante inventado para "fechar o placar" seria
  // um 17/17 ficticio.

  [
    "a sugestao historica deixa de normalizar: as medias somam 95 e ficam 95",
    LIB,
    `  return proporcional(
    participacoes.map((p) => p.member_id),
    medias
  );`,
    `  return participacoes.map((p, i) => ({
    member_id: p.member_id,
    centesimos: Math.round(medias[i]),
  }));`,
  ],
  [
    "o pagador principal volta ao criterio que somava 150%",
    LIB,
    `  return rebalancear(
    base,
    pagadorId,
    Math.min(
      CENTESIMOS_TOTAIS,
      dele.centesimos + PONTOS_DO_PAGADOR_PRINCIPAL
    )
  );`,
    `  return ids.map((member_id) => ({
    member_id,
    centesimos:
      member_id === pagadorId
        ? CENTESIMOS_TOTAIS / ids.length + PONTOS_DO_PAGADOR_PRINCIPAL
        : (CENTESIMOS_TOTAIS - PONTOS_DO_PAGADOR_PRINCIPAL) / (ids.length - 1),
  }));`,
  ],
  [
    "o grupo de UM membro volta a dividir por zero no pagador principal",
    LIB,
    "  if (ids.length < 2) return null;",
    "  if (ids.length < 1) return null;",
  ],

  // =========================================================================
  // O QUE A ROTA LE
  // =========================================================================
  [
    "a rota para de filtrar `status = active`: quem saiu do grupo divide a conta",
    ROTA,
    `      .eq("group_id", groupId)
      .eq("status", "active");`,
    '      .eq("group_id", groupId);',
  ],
  [
    "a sugestao historica casa a parte por `user_id` em vez de `member_id`",
    ROTA,
    "        const memberId = split?.member?.id;",
    "        const memberId = split?.member?.user_id;",
  ],
];

const bloco = criarBlocoDeMutantes({ rotulo: "sugestao-de-divisao", suites: [SUITE] });

// A sombra vive em diretorio temporario, e a arvore rastreada nunca e mutada --
// era esse o modo de falha deste runner. O handler de sinal existe so para que
// nem o diretorio orfao sobre: `finally` nao roda em SIGTERM, mas
// `process.exit` dispara o `exit` abaixo.
process.on("exit", () => bloco.fechar());
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => process.exit(1));
}

let mortos = 0;
const sobreviventes = [];

// O CONTROLE POSITIVO passa pelo MESMO `rodar` dos mutantes, entao agora ele
// pega erro no proprio aparelho -- nao apenas suite vermelha.
console.log(`controle positivo: \`${SUITE}\` esta verde sem mutante?`);
const controle = bloco.rodar("controle", {}, SUITE);
if (!controle.verde) {
  console.error(
    `   VERMELHA (${controle.como}). Todo mutante abaixo apareceria como MORTO ` +
      "sem ter medido nada. Conserte a suite antes de rodar o mutador."
  );
  console.error(`   ${controle.saida}`);
  process.exit(1);
}
console.log("   verde.\n");

for (const [rotulo, arquivo, de, para] of mutantes) {
  const fonte = original.get(arquivo);

  // ANCORA QUE NAO CASA E ERRO DO RUNNER, e este runner para em vez de contar o
  // mutante como sobrevivente -- semantica preservada da versao anterior.
  if (!fonte.includes(de)) {
    console.error(`ANCORA NAO CASOU em ${arquivo}: ${rotulo}`);
    console.error(
      "   Isso e erro do RUNNER, nao mutante morto: o arquivo mudou e a " +
        "mutacao nao foi aplicada. Ver " +
        "[[controle-positivo-e-o-unico-que-pega-erro-de-script-no-runner]]."
    );
    process.exit(1);
  }

  // `replace` (e nao `replaceAll`) estraga a PRIMEIRA ocorrencia. A conferencia
  // de ocorrencia UNICA e a que esta conversao acrescenta: um trecho que aparece
  // duas vezes muta um lugar que o rotulo nao descreve. Ela entrou sem mudar
  // veredito nenhum -- nenhuma das 17 ancoras daqui e ambigua hoje (medido na
  // HMO-335, junto com as outras quatro listas).
  const ocorrencias = fonte.split(de).length - 1;
  if (ocorrencias > 1) {
    console.error(`ANCORA AMBIGUA em ${arquivo} (${ocorrencias}x): ${rotulo}`);
    console.error("   O `replace` mutaria a PRIMEIRA ocorrencia, que o rotulo nao descreve.");
    process.exit(1);
  }

  const mutado = fonte.replace(de, para);
  if (mutado === fonte) {
    console.error(`MUTACAO SEM EFEITO em ${arquivo}: ${rotulo}`);
    process.exit(1);
  }

  const r = bloco.rodar(rotulo, { [arquivo]: mutado }, SUITE);

  if (!r.verde) {
    mortos += 1;
    console.log(`MORTO      ${rotulo}`);
  } else {
    sobreviventes.push(rotulo);
    console.log(`SOBREVIVEU ${rotulo}`);
    if (r.mudouASaida === false) {
      console.log("           (saida compilada identica a da arvore limpa: EQUIVALENTE)");
    }
  }
}

console.log(`\n${mortos}/${mutantes.length} mortos.`);
if (sobreviventes.length > 0) {
  console.log("\nsobreviventes:");
  for (const s of sobreviventes) console.log(`  - ${s}`);
}

// O CODIGO DE SAIDA E NOVO, e sem ele o step de CI desta conversao seria VACUO.
// A versao anterior imprimia a lista de sobreviventes e saia 0 -- como
// ferramenta de quem escreve o teste isso bastava, porque a pessoa LE a saida.
// Num step de workflow ninguem le: um runner que sai 0 com sobrevivente fica
// verde para sempre e o step prova o mesmo que step nenhum. Os outros quatro
// runners desta familia ja saiam 1; so este nao.
process.exit(sobreviventes.length === 0 ? 0 : 1);
