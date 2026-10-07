#!/usr/bin/env node
// Prova de mutacao do lib/orcamento-de-grupo.ts e do linhasParaRepetir de
// lib/services/budget.ts. Cada entrada abaixo estraga uma decisao dos
// arquivos; a suite tem que ficar VERMELHA em todas. Mutante que sobrevive e um
// trecho que nenhum teste distingue -- ou codigo morto.
//
// O primeiro grupo e o que interessa: sao os erros que a TELA NAO MOSTRA.
// Somar o teto de grupo junto com o pessoal da um total alto que a pessoa
// atribui a ter gastado mesmo, e que cresce a cada membro novo da viagem --
// sem erro, sem cor diferente, sem nada no console.
//
//   node scripts/mutantes-orcamento-de-grupo.mjs
//
// O BLOCO: UMA COMPILACAO PARA TODOS OS MUTANTES (HMO-335)
// --------------------------------------------------------
// Este runner MUTAVA A ARVORE RASTREADA: escrevia o mutante num dos dois
// arquivos de producao de `ALVOS`, chamava `npm run` ali mesmo e restaurava
// depois. Dois defeitos, e o segundo e o que doia:
//
//   1. cada volta recompilava o programa INTEIRO para trocar UM arquivo -- 21
//      voltas de `tsc` completo, 84s medidos;
//   2. o mutante ficava GRAVADO no arquivo de producao quando o processo morria
//      no meio. A restauracao estava no corpo do laco, sem `finally`, e
//      `execSync` BLOQUEIA a thread do JS -- com SIGTERM (o sinal que um timeout
//      manda) o processo termina a volta em curso e aplica A SEGUINTE. Ja
//      aconteceu nesta arvore: a HMO-329 comecou com `lib/divisao-configurada.ts`
//      mutado por um runner deste desenho, e os `.tmp-*` compilados guardando a
//      mutacao.
//
// Agora as voltas dividem um processo e um cache de AST
// (`criarBlocoDeMutantes`, HMO-319): so o arquivo mutado e reparseado, e a
// mutacao vai para uma SOMBRA em diretorio temporario. A arvore rastreada e o
// `.tmp-*` do repositorio nao sao tocados em momento nenhum, entao o pior caso
// de um processo morto e um diretorio orfao em /tmp -- e por isso a restauracao
// final, que varria os dois alvos, saiu: nao ha mais escrita para desfazer.
//
// As etapas da suite saem do proprio `scripts["test:orcamento-de-grupo"]` do
// package.json -- o comando que o CI roda --, e nao de uma receita repetida a
// mao aqui.
//
// A lista de mutantes abaixo NAO foi reescrita nem movida: o diff desta
// conversao nao toca uma linha dela.
import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const ALVOS = {
  grupo: "lib/orcamento-de-grupo.ts",
  budget: "lib/services/budget.ts",
};

const SUITE = "test:orcamento-de-grupo";

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

  // --- a viagem PEDIDA, que e o que a tela do grupo mostra (HMO-180) ---
  // A tela do grupo desenha uma viagem so, com o nome dela no titulo da pagina.
  // Pegar a viagem errada nao da erro: da dois numeros plausiveis debaixo do
  // nome de outra.
  [
    "grupo",
    "a tela do grupo passa a mostrar a PRIMEIRA viagem da lista (a mais apertada)",
    "  return grupos.find((g) => g.group_id === groupId) ?? null;",
    "  return grupos[0] ?? null;",
  ],
  [
    "grupo",
    "a busca casa qualquer viagem MENOS a pedida",
    "  return grupos.find((g) => g.group_id === groupId) ?? null;",
    "  return grupos.find((g) => g.group_id !== groupId) ?? null;",
  ],
  [
    "grupo",
    "grupo sem teto no mes cai no teto PESSOAL (o mercado de casa vira gasto da viagem)",
    "  const { grupos } = separarOrcamentos(orcamentos);\n  return grupos.find((g) => g.group_id === groupId) ?? null;",
    "  const { grupos, pessoal } = separarOrcamentos(orcamentos);\n  return (\n    grupos.find((g) => g.group_id === groupId) ?? {\n      group_id: groupId ?? \"\",\n      group_name: GRUPO_SEM_NOME,\n      orcamentos: [],\n      ...pessoal,\n    }\n  );",
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

const bloco = criarBlocoDeMutantes({ rotulo: "orcamento-de-grupo", suites: [SUITE] });

// A sombra vive em diretorio temporario, e a arvore rastreada nunca e mutada --
// era esse o modo de falha deste runner. O handler de sinal existe so para que
// nem o diretorio orfao sobre: `finally` nao roda em SIGTERM, mas
// `process.exit` dispara o `exit` abaixo.
process.on("exit", () => bloco.fechar());
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => process.exit(1));
}

// CONTROLE POSITIVO, primeiro e obrigatorio: a suite tem de passar com a arvore
// INTACTA, e pelo MESMO `rodar` que os mutantes usam -- por isso ele pega erro
// no proprio aparelho. Sem ele, uma sombra mal montada reprova TODO mutante e o
// placar fecha "21/21 mortos" sobre zero assercoes executadas.
const controle = bloco.rodar("controle", {}, SUITE);
if (!controle.verde) {
  console.error(`ABORTADO: a arvore INTACTA reprova em ${SUITE} (${controle.como}).`);
  console.error(`  ${controle.saida}`);
  console.error("O placar nao valeria: todo mutante 'morreria' sem ter sido medido.");
  process.exit(1);
}
console.log(`controle positivo: a arvore intacta passa em ${SUITE}\n`);

let sobreviventes = 0;

for (const [alvo, nome, de, para] of mutantes) {
  const caminho = ALVOS[alvo];
  // Um mutante que nao aplica passa por "morto" sem nunca ter existido: o
  // trecho mudou de forma, o replace nao encontra nada, e a suite fica verde
  // por nao ter sido mexida. Ele conta como sobrevivente de proposito.
  //
  // A segunda trava -- a ocorrencia UNICA -- e a que esta conversao acrescenta:
  // `String.replace` troca a PRIMEIRA ocorrencia, entao um trecho que aparece
  // duas vezes muta um lugar que o rotulo nao descreve e sobrevive com o rotulo
  // mentindo. Ela entrou sem mudar veredito nenhum: nenhuma das 21 ancoras daqui
  // e ambigua hoje (medido na HMO-335, junto com as outras quatro listas).
  const ocorrencias = original[alvo].split(de).length - 1;
  if (ocorrencias === 0) {
    console.log(`??  ${nome}: o trecho nao existe mais -- mutante desatualizado`);
    sobreviventes++;
    continue;
  }
  if (ocorrencias > 1) {
    console.log(`??  ${nome}: o trecho aparece ${ocorrencias}x -- mutante ambiguo, invalido`);
    sobreviventes++;
    continue;
  }

  const r = bloco.rodar(nome, { [caminho]: original[alvo].replace(de, para) }, SUITE);
  const vermelho = !r.verde;
  console.log(`${vermelho ? "OK  " : "VIVO"} ${nome}`);
  if (!vermelho) {
    if (r.mudouASaida === false) {
      console.log("     (saida compilada identica a da arvore limpa: EQUIVALENTE)");
    }
    sobreviventes++;
  }
}

console.log(`\n${mutantes.length - sobreviventes}/${mutantes.length} mutantes mortos`);
process.exit(sobreviventes === 0 ? 0 : 1);
