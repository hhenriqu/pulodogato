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
//
// O BLOCO: UMA COMPILACAO PARA TODOS OS MUTANTES (HMO-334)
// --------------------------------------------------------
// Este runner MUTAVA A ARVORE RASTREADA: guardava o texto original em memoria,
// escrevia o mutante em `lib/parte-do-grupo.ts`,
// chamava `npm run test:parte-do-grupo` ali mesmo e restaurava depois. Dois defeitos
// nisso, e o segundo e o que doia:
//
//   1. cada uma das 12 voltas recompilava o programa INTEIRO, mesmo
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
// As etapas da suite saem do proprio `scripts["test:parte-do-grupo"]` do package.json -- o
// comando que o CI roda --, e nao de uma receita repetida a mao aqui.
//
// A lista de mutantes abaixo NAO foi reescrita: ela veio byte a byte do arquivo
// anterior, pelo `scripts/converte-mutantes-em-bloco.mjs`.

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const ALVO = "lib/parte-do-grupo.ts";

const mutantes = [
  // --- o defeito original: a parte do outro contando como minha ---
  [
    "a parte volta a ser o valor CHEIO (o defeito da HMO-177 de volta)",
    "  return toReais(Math.round(toCents(cheio) / membros));",
    "  return cheio;",
  ],
  // OS DOIS ABAIXO LEVAM A LINHA SEGUINTE NA ANCORA, e nao por capricho de
  // recorte: `  if (!groupId) return cheio;` aparece DUAS vezes em
  // lib/parte-do-grupo.ts -- em `parteConfiguradaDoMembro` (a divisao por peso,
  // o caminho vivo desde a HMO-303/304) e em `parteDoMembro` (a divisao igual).
  //
  // `String.replace` troca a primeira, entao estes dois sempre mutaram
  // `parteConfiguradaDoMembro`; o que faltava era o runner DIZER isso. Enquanto
  // a trava de ocorrencia unica nao existia nesta familia, os dois passavam por
  // mortos sem que o placar revelasse qual das duas funcoes havia sido medida
  // (HMO-334). A linha do `meuUserId` so existe em `parteConfiguradaDoMembro`,
  // e e ela que torna a ancora unica -- o `para` a repete intacta.
  //
  // `parteDoMembro` segue sem mutante proprio para esta decisao. E lacuna de
  // cobertura, nao defeito daqui.
  [
    "o group_id deixa de ser olhado (toda despesa vira pessoal)",
    '  if (!groupId) return cheio;\n  if (typeof meuUserId !== "string" || meuUserId === "") return cheio;',
    '  if (true) return cheio;\n  if (typeof meuUserId !== "string" || meuUserId === "") return cheio;',
  ],

  // --- o erro espelhado: dividir o que nao e de grupo ---
  [
    "a despesa PESSOAL passa a ser dividida tambem",
    '  if (!groupId) return cheio;\n  if (typeof meuUserId !== "string" || meuUserId === "") return cheio;',
    '  if (false) return cheio;\n  if (typeof meuUserId !== "string" || meuUserId === "") return cheio;',
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
  // O MESMO CASO: a guarda de status esta em `montarParticipantesPorGrupo` (os
  // PESOS) e em `contarMembrosAtivos` (a CONTAGEM), identica nas duas. Este
  // mutante sempre mutou a primeira, os pesos; a linha do `user_id` so existe
  // la, e e ela que fixa a ancora. O mutante de `contarMembrosAtivos` que vem
  // logo abaixo ja ancora no `contagem.set`, que e unico -- entao a contagem
  // tem cobertura, e o que ficou de fora e so o status DENTRO dela.
  [
    "membro inativo volta a contar (a minha parte fica MENOR do que a real)",
    '    if (linha.status && linha.status !== "active") continue;\n    if (typeof linha.user_id !== "string" || linha.user_id === "") continue;',
    '    if (false) continue;\n    if (typeof linha.user_id !== "string" || linha.user_id === "") continue;',
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
  //
  // A ANCORA DOS TRES ABAIXO MUDOU NA HMO-257. A peneira era
  // `r.transaction_type !== "income"` e passou a ser
  // `classeDaAgenda(r.transaction_type) === "expense"`, para a transferencia
  // recorrente sair do custo fixo. O mutante da receita foi REESCRITO na ancora
  // nova em vez de deixado para tras: ancora morta fica verde por nao ter mexido
  // em nada, e desde a HMO-262 isso reprova no pre-commit.
  [
    "a receita volta a entrar no custo fixo",
    '    .filter((r) => classeDaAgenda(r.transaction_type) === "expense")',
    "    .filter(() => true)",
  ],
  [
    // O DEFEITO DA HMO-257, exatamente como producao o media: a transferencia
    // recorrente de R$ 100/mes para o PIX somando ao custo fixo (R$ 1.300,00
    // onde o certo e R$ 1.200,00). E o criterio ANTIGO, byte a byte.
    "a transferencia recorrente volta a contar como custo fixo (o defeito da HMO-257)",
    '    .filter((r) => classeDaAgenda(r.transaction_type) === "expense")',
    '    .filter((r) => r.transaction_type !== "income")',
  ],
  [
    // O ERRO OPOSTO, e o caro: allow-list lido do campo CRU. Ele conserta a
    // transferencia e passa nos testes do valor, mas `transaction_type` e NULO
    // em parte da base instalada -- toda regra de despesa antiga sairia do custo
    // fixo em silencio, e o numero cairia para perto de zero.
    "a peneira passa a ler o campo CRU, e a despesa sem transaction_type desaparece",
    '    .filter((r) => classeDaAgenda(r.transaction_type) === "expense")',
    '    .filter((r) => r.transaction_type === "expense")',
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

const SUITE = "test:parte-do-grupo";

const bloco = criarBlocoDeMutantes({ rotulo: "parte-do-grupo", suites: [SUITE] });

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
