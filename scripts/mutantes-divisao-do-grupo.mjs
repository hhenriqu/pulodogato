#!/usr/bin/env node
// Prova de mutacao do lib/divisao-do-grupo.ts. NAO roda em CI: e uma ferramenta
// de quem esta escrevendo o teste. Cada entrada abaixo estraga uma decisao do
// arquivo; a suite tem que ficar VERMELHA em todas. Mutante que sobrevive e um
// trecho que nenhum teste distingue -- ou codigo morto.
//
// O primeiro grupo e o que interessa, porque reproduz o defeito da HMO-190: o
// tipo que a tela manda caindo em divisao IGUAL sem erro. Esse e o mutante que
// grava 50/50 onde foi combinado 70/30 e devolve 200 com "sucesso" na tela --
// nenhuma tela, nenhum log e nenhum tipo do TypeScript o denuncia.
//
//   node scripts/mutantes-divisao-do-grupo.mjs
//
// O BLOCO: UMA COMPILACAO PARA TODOS OS MUTANTES (HMO-334)
// --------------------------------------------------------
// Este runner MUTAVA A ARVORE RASTREADA: guardava o texto original em memoria,
// escrevia o mutante em `lib/divisao-do-grupo.ts`,
// chamava `npm run test:divisao-do-grupo` ali mesmo e restaurava depois. Dois defeitos
// nisso, e o segundo e o que doia:
//
//   1. cada uma das 28 voltas recompilava o programa INTEIRO, mesmo
//      mudando UM arquivo;
//
//   2. o mutante ficava GRAVADO no arquivo de producao quando o processo morria
//      no meio. A restauracao era um `writeFileSync` depois do laco -- que nao
//      roda em SIGTERM, e SIGTERM e o que um timeout manda. Pior: `execSync`
//      bloqueia a thread do JS, entao nem um handler de SIGTERM resolveria; o
//      processo termina a volta em curso e aplica A SEGUINTE. Aconteceu nesta
//      arvore duas vezes (`PainelDePapel.tsx` na HMO-296, e `DivisaoDoGrupo.tsx`
//      herdado mutado pela HMO-263 -- por um runner DESTA familia), e nas duas
//      o `git status` mostrava UM arquivo modificado: a cara de trabalho em
//      andamento.
//
// Agora as voltas dividem um processo e um cache de AST
// (`criarBlocoDeMutantes`, HMO-319): so o arquivo mutado e reparseado, e a
// mutacao vai para uma SOMBRA em diretorio temporario. A arvore rastreada e o
// `.tmp-*` do repositorio nao sao tocados em momento nenhum, entao o pior caso
// de um processo morto e um diretorio orfao em /tmp.
//
// As etapas da suite saem do proprio `scripts["test:divisao-do-grupo"]` do package.json -- o
// comando que o CI roda --, e nao de uma receita repetida a mao aqui.
//
// A lista de mutantes abaixo NAO foi reescrita: ela veio byte a byte do arquivo
// anterior, pelo `scripts/converte-mutantes-em-bloco.mjs`.

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const ALVO = "lib/divisao-do-grupo.ts";

const mutantes = [
  // --- o vocabulario: o silencio que era o defeito ---
  [
    "tipo desconhecido volta a cair em divisao igual (o defeito da issue)",
    "    default:\n      return null;",
    '    default:\n      return "equal";',
  ],
  [
    "proportional deixa de ser traduzido (23514 no UPDATE do split_type)",
    '    case "percentage":\n    case "proportional":\n    case "historical":\n      return "percentage";',
    '    case "percentage":\n      return "percentage";\n    case "proportional":\n    case "historical":\n      return normalizado as TipoGravavel;',
  ],
  [
    "custom passa a ser tratado como percentage",
    '    case "custom":\n      return "custom";',
    '    case "custom":\n      return "percentage";',
  ],
  [
    "o tipo vazio vira custom em vez de equal",
    '    case "":\n    case "equal":\n      return "equal";',
    '    case "":\n      return "custom";\n    case "equal":\n      return "equal";',
  ],

  // --- divisao igual nao pode reescrever o rateio do trigger ---
  [
    "equal passa a devolver as partes da tela (troca o maior resto por residuo)",
    '  if (splitType === "equal") {\n    return { ok: true, splitType: "equal", partes: null };\n  }',
    '  if (splitType === "equal" && !Array.isArray(entrada.partes)) {\n    return { ok: true, splitType: "equal", partes: null };\n  }',
  ],

  // --- a divisao combinada sem partes ---
  [
    "lista de partes vazia deixa de ser recusada",
    "  if (!Array.isArray(entrada.partes) || entrada.partes.length === 0) {",
    "  if (!Array.isArray(entrada.partes)) {",
  ],
  [
    "divisao combinada sem partes volta a virar divisao igual",
    "    return {\n      ok: false,\n      erro: \"Escolha quanto cada membro paga para usar esta divisão.\",\n    };",
    '    return { ok: true, splitType: "equal", partes: null };',
  ],

  // --- o dinheiro que tem que fechar ---
  [
    "custom deixa de conferir a soma (70/20 grava e deixa residuo)",
    "  if (soma !== totalCents) {",
    "  if (false) {",
  ],
  [
    "custom aceita diferenca de um centavo",
    "  if (soma !== totalCents) {",
    "  if (Math.abs(soma - totalCents) > 1) {",
  ],
  [
    "a porcentagem deixa de conferir a soma de 100",
    "  if (Math.abs(soma - 100) > TOLERANCIA_PERCENTUAL) {",
    "  if (false) {",
  ],
  [
    "a tolerancia percentual fica grande demais (70/20 passa)",
    "const TOLERANCIA_PERCENTUAL = 0.5;",
    "const TOLERANCIA_PERCENTUAL = 15;",
  ],
  [
    "a tolerancia percentual zera (100/3 fica impossivel de gravar)",
    "const TOLERANCIA_PERCENTUAL = 0.5;",
    "const TOLERANCIA_PERCENTUAL = 0;",
  ],

  // --- o centavo do maior resto ---
  [
    "o maior resto some: cada parte arredonda sozinha e a soma nao fecha",
    "  const base = brutos.map((b) => Math.floor(b));",
    "  const base = brutos.map((b) => Math.round(b));",
  ],
  [
    "a sobra deixa de ser distribuida (R$ 100 em tres somem um centavo)",
    "  for (const { i } of ordem) {\n    if (sobra <= 0) break;\n    cents[i] += 1;\n    sobra -= 1;\n  }",
    "  for (const { i } of ordem) {\n    if (sobra <= 0) break;\n    cents[i] += 0;\n    sobra -= 1;\n  }",
  ],
  [
    "a sobra toda vai para um unico membro",
    "    cents[i] += 1;\n    sobra -= 1;",
    "    cents[i] += sobra;\n    sobra = 0;",
  ],
  [
    "o desempate por member_id some (a mesma divisao grava valores diferentes)",
    "    .sort((a, b) =>\n      b.resto !== a.resto\n        ? b.resto - a.resto\n        : a.membro < b.membro\n          ? -1\n          : a.membro > b.membro\n            ? 1\n            : 0\n    );",
    "    .sort((a, b) => b.resto - a.resto);",
  ],
  [
    "a normalizacao passa a ser por 100, e nao pela soma real",
    "  const brutos = percentuais.map((p) => (totalCents * p) / soma);",
    "  const brutos = percentuais.map((p) => (totalCents * p) / 100);",
  ],

  // --- a porcentagem que o banco aceita ---
  [
    "o piso de 0,01 some (percentage 0.00 derruba o INSERT no CHECK)",
    "  return Math.max(0.01, duasCasas);",
    "  return duasCasas;",
  ],
  // Nao ha mutante de TETO: `Math.min(100, ...)` aqui seria trava sobre estado
  // impossivel -- `pct > 100` ja foi recusado antes, e o mutante que a removia
  // sobrevivia a suite inteira, porque nao ha entrada legitima que a acione.
  // Ver a nota em percentagemGravavel().
  [
    "a porcentagem deixa de ser arredondada para duas casas",
    "  const duasCasas = Math.round(pct * 100) / 100;",
    "  const duasCasas = pct;",
  ],
  [
    "percentual fora de 0..100 deixa de ser recusado",
    "    if (pct <= 0 || pct > 100) {",
    "    if (false) {",
  ],
  [
    "percentual zero passa a ser aceito",
    "    if (pct <= 0 || pct > 100) {",
    "    if (pct < 0 || pct > 100) {",
  ],

  // --- custom: os valores ---
  [
    "parte de R$ 0,00 passa a ser aceita",
    "    if (cents <= 0) {",
    "    if (false) {",
  ],
  [
    "custom passa a derivar a porcentagem errada (todos com 100%)",
    "      percentage: percentagemGravavel((centsPorParte[i] * 100) / totalCents),",
    "      percentage: 100,",
  ],
  [
    "o sinal da parte deixa de ser normalizado",
    "    const cents = Math.abs(toCents(valor));",
    "    const cents = toCents(valor);",
  ],
  [
    "o total negativo da despesa deixa de ser normalizado",
    "  const totalCents = Math.abs(toCents(numero(entrada.total) ?? 0));",
    "  const totalCents = toCents(numero(entrada.total) ?? 0);",
  ],
  [
    "despesa sem valor deixa de ser recusada",
    "  if (totalCents <= 0) {",
    "  if (false) {",
  ],

  // --- as listas que o banco aceitaria e nao devia ---
  [
    "membro repetido passa (a mesma pessoa e cobrada duas vezes)",
    "    if (membros.includes(memberId)) {",
    "    if (false) {",
  ],
  [
    "parte sem member_id passa",
    "    if (!memberId) {",
    "    if (false) {",
  ],
];

const SUITE = "test:divisao-do-grupo";

const bloco = criarBlocoDeMutantes({ rotulo: "divisao-do-grupo", suites: [SUITE] });

// A sombra vive em diretorio temporario, e a arvore rastreada nunca e mutada --
// era esse o modo de falha deste runner. O handler de sinal existe so para que
// nem o diretorio orfao sobre: o fim do laco nao roda em SIGTERM, mas
// `process.exit` dispara o `exit` abaixo.
process.on("exit", () => bloco.fechar());
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => process.exit(1));
}

// O texto de cada arquivo que algum mutante toca. Lido da arvore de verdade, que
// e o original por construcao: nada mais aqui escreve nela.
const original = new Map();
for (const arquivo of [ALVO]) {
  original.set(arquivo, readFileSync(arquivo, "utf8"));
}

// CONTROLE POSITIVO: a arvore INTACTA tem de passar antes de qualquer mutante,
// e pelo MESMO `rodar` que os mutantes usam -- por isso ele pega erro no
// aparelho. Sem ele, uma sombra mal montada reprova TODO mutante e o placar sai
// "N/N mortos" sobre zero assercoes executadas.
const controle = bloco.rodar("controle", {}, SUITE);
if (!controle.verde) {
  console.error(`ABORTADO: a arvore INTACTA reprova em ${SUITE} (${controle.como}).`);
  console.error(`  ${controle.saida}`);
  console.error("O placar nao valeria: todo mutante 'morreria' sem ter sido medido.");
  process.exit(1);
}
console.log(`controle positivo: a arvore intacta passa em ${SUITE}\n`);

let sobreviventes = 0;

for (const [nome, de, para] of mutantes) {
  const alvo = ALVO;
  const antes = original.get(alvo);

  // AS TRES TRAVAS DE ANCORA. A primeira e a terceira ja existiam neste runner;
  // a do meio e a que a conversao acrescenta (ver OCORRENCIA UNICA, no
  // conversor): `String.replace` troca a PRIMEIRA ocorrencia, e um `de` que
  // aparece duas vezes muta um lugar que o rotulo nao descreve.
  const ocorrencias = antes.split(de).length - 1;
  if (ocorrencias === 0) {
    console.error(`SOBREVIVEU (ancora nao casou) :: ${nome}`);
    console.error(`  o texto buscado nao existe em ${alvo}: ${de}`);
    sobreviventes++;
    continue;
  }
  if (ocorrencias > 1) {
    console.error(`SOBREVIVEU (ancora ambigua) :: ${nome}`);
    console.error(`  o texto aparece ${ocorrencias}x em ${alvo} -- o replace muta so a 1a`);
    sobreviventes++;
    continue;
  }
  const depois = antes.replace(de, para);
  if (depois === antes) {
    console.error(`SOBREVIVEU (replace nao mudou nada) :: ${nome}`);
    sobreviventes++;
    continue;
  }

  const r = bloco.rodar(nome, { [alvo]: depois }, SUITE);

  if (r.verde) {
    console.error(`SOBREVIVEU :: ${nome}`);
    if (r.mudouASaida === false) {
      console.error("  (saida compilada identica a da arvore limpa: EQUIVALENTE)");
    }
    sobreviventes++;
  } else {
    // Morrer no tsc tambem e morrer -- mutante que nao compila nao chega em
    // producao --, mas a distincao importa: um erro de tipo nao diz que a SUITE
    // pegou a regra.
    console.log(`morreu     :: ${nome}  (${r.como === "tsc" ? "tsc" : "asercao"})`);
  }
}

console.log(`\n${mutantes.length - sobreviventes}/${mutantes.length} mortos`);
process.exit(sobreviventes === 0 ? 0 : 1);
