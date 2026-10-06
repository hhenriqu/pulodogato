#!/usr/bin/env node
// Prova de mutacao da sugestao de divisao viva (HMO-245 fase 7 / HMO-273).
// NAO roda em CI: e ferramenta de quem esta escrevendo o teste.
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
// O restore e a ultima linha, fora de try/catch com `process.exit` dentro: um
// `exit` dentro de `try` pularia o `finally` e deixaria um arquivo de producao
// MUTADO no worktree.
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";

const LIB = "lib/sugestao-de-divisao.ts";
const ROTA = "app/api/expense-groups/[groupId]/split-suggestions/route.ts";
const CONFIG = "lib/divisao-configurada.ts";
const TELA_DO_GRUPO =
  "app/(dashboard)/dashboard/expense-groups/[groupId]/page.tsx";

const SUITE = "npm run test:sugestao-de-divisao";

const original = new Map(
  [LIB, ROTA, CONFIG, TELA_DO_GRUPO].map((a) => [a, readFileSync(a, "utf8")])
);

const restaurar = () => {
  for (const [arquivo, fonte] of original) writeFileSync(arquivo, fonte);
  // O emit de uma arvore MUTADA sobrevive ao restore do fonte e e lido pela
  // proxima rodada: ver [[tmp-compilado-guarda-o-mutante-depois-do-restore]]. O
  // npm script comeca com `rm -rf`, mas o restore tambem limpa, para o caso de
  // o runner morrer entre a mutacao e a rodada.
  rmSync(".tmp-sugestao-de-divisao", { recursive: true, force: true });
};

/** Roda a suite. `true` = vermelha. */
function vermelha() {
  try {
    execSync(SUITE, { stdio: "pipe" });
    return false;
  } catch {
    return true;
  }
}

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
    "        expenseData.custom_splits = partesParaGravar(\n          selectedSplitSuggestion.splits\n        ).map((split: any) => ({",
    "        expenseData.custom_splits = selectedSplitSuggestion.splits.map((split: any) => ({",
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

let mortos = 0;
const sobreviventes = [];

try {
  console.log(`controle positivo: \`${SUITE}\` esta verde sem mutante?`);
  rmSync(".tmp-sugestao-de-divisao", { recursive: true, force: true });
  if (vermelha()) {
    console.error(
      "   VERMELHA. Todo mutante abaixo apareceria como MORTO sem ter medido " +
        "nada. Conserte a suite antes de rodar o mutador."
    );
    process.exit(1);
  }
  console.log("   verde.\n");

  for (const [rotulo, arquivo, de, para] of mutantes) {
    const fonte = original.get(arquivo);

    if (!fonte.includes(de)) {
      console.error(`ANCORA NAO CASOU em ${arquivo}: ${rotulo}`);
      console.error(
        "   Isso e erro do RUNNER, nao mutante morto: o arquivo mudou e a " +
          "mutacao nao foi aplicada. Ver " +
          "[[controle-positivo-e-o-unico-que-pega-erro-de-script-no-runner]]."
      );
      process.exit(1);
    }

    // `replace` (e nao `replaceAll`) estraga a PRIMEIRA ocorrencia. Toda ancora
    // acima e unica no arquivo dela; a conferencia abaixo e o que garante isso
    // na proxima vez que alguem mexer no fonte.
    const mutado = fonte.replace(de, para);
    if (mutado === fonte) {
      console.error(`MUTACAO SEM EFEITO em ${arquivo}: ${rotulo}`);
      process.exit(1);
    }

    writeFileSync(arquivo, mutado);
    const morreu = vermelha();
    writeFileSync(arquivo, fonte);

    if (morreu) {
      mortos += 1;
      console.log(`MORTO      ${rotulo}`);
    } else {
      sobreviventes.push(rotulo);
      console.log(`SOBREVIVEU ${rotulo}`);
    }
  }

  console.log(`\n${mortos}/${mutantes.length} mortos.`);
  if (sobreviventes.length > 0) {
    console.log("\nsobreviventes:");
    for (const s of sobreviventes) console.log(`  - ${s}`);
  }
} finally {
  restaurar();
}
