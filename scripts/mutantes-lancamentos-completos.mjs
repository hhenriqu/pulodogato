#!/usr/bin/env node
// Prova de mutacao dos dois modulos da HMO-215. NAO roda em CI -- e ferramenta
// de quem esta escrevendo o teste. Cada entrada estraga uma decisao do fonte; a
// suite tem que ficar VERMELHA em todas. Mutante que sobrevive e um trecho que
// nenhum teste distingue, ou codigo morto.
//
//   node scripts/mutantes-lancamentos-completos.mjs
//
// Os dois mutantes que mais importam, porque sao os que erram DINHEIRO sem
// quebrar nada:
//
//   * `-Math.abs(parte.amount)` virando `parte.amount`. A view do 033 devolve a
//     parte POSITIVA; a lista pinta pelo sinal. O mutante mostra a minha parte
//     do jantar em VERDE, como receita, e o numero exibido continua certo.
//   * a guarda de `paguei_eu` caindo. A despesa que eu paguei aparece duas
//     vezes -- os R$ 400 cheios mais os R$ 200 da minha parte --, somando R$ 600
//     de um gasto de R$ 400.
//
// O BLOCO: UMA COMPILACAO PARA TODOS OS MUTANTES (HMO-334)
// --------------------------------------------------------
// Este runner MUTAVA A ARVORE RASTREADA: guardava o texto original em memoria,
// escrevia o mutante num dos 2 arquivos de producao da lista,
// chamava `npm run test:lancamentos-completos` ali mesmo e restaurava depois. Dois defeitos
// nisso, e o segundo e o que doia:
//
//   1. cada uma das 34 voltas recompilava o programa INTEIRO, mesmo
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
// As etapas da suite saem do proprio `scripts["test:lancamentos-completos"]` do package.json -- o
// comando que o CI roda --, e nao de uma receita repetida a mao aqui.
//
// A lista de mutantes abaixo NAO foi reescrita: ela veio byte a byte do arquivo
// anterior, pelo `scripts/converte-mutantes-em-bloco.mjs`.

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const DESTINO = "lib/destino-do-lancamento.ts";
const PARTE = "lib/parte-de-grupo-na-lista.ts";

const mutantes = [
  // --- o sentido do destino ---
  [
    DESTINO,
    "receita e despesa trocam de preposicao (gasto no cartao vira entrada)",
    '      ? { origem: null, destino: minha, texto: `para ${minha}`, faltaConta: false }\n      : { origem: minha, destino: null, texto: `de ${minha}`, faltaConta: false };',
    '      ? { origem: minha, destino: null, texto: `de ${minha}`, faltaConta: false }\n      : { origem: null, destino: minha, texto: `para ${minha}`, faltaConta: false };',
  ],
  [
    DESTINO,
    "a seta da transferencia aponta para o lado errado",
    "  const souASaida = mov.amount < 0;",
    "  const souASaida = mov.amount > 0;",
  ],
  [
    DESTINO,
    "o tipo passa a sair do sinal, e nao de classificarMovimentacao",
    "  const tipo = classificarMovimentacao(mov);",
    '  const tipo = mov.transaction_type === "transfer" ? "transfer" : mov.amount < 0 ? "expense" : "income";',
  ],

  // --- o elo de uma via (015) ---
  [
    DESTINO,
    "o indice reverso some (toda perna de SAIDA perde a contraparte)",
    "    if (mov.counterpart_transaction_id) {\n      porContraparte.set(mov.counterpart_transaction_id, mov);\n    }",
    "    if (false) {\n      porContraparte.set(mov.counterpart_transaction_id!, mov);\n    }",
  ],
  [
    DESTINO,
    "a busca da contraparte deixa de tentar as duas direcoes",
    "  return indice.porContraparte.get(mov.id) ?? null;",
    "  return null;",
  ],

  // --- o que nao se inventa ---
  [
    DESTINO,
    "a conta ausente passa a virar meia seta em vez de frase",
    "  if (origem) {\n    return { origem, destino: null, texto: `saiu de ${origem}`, faltaConta: false };\n  }",
    "  if (origem) {\n    return { origem, destino: null, texto: `${origem} → `, faltaConta: false };\n  }",
  ],
  [
    DESTINO,
    "nome de conta em branco deixa de contar como ausente",
    '  return typeof nome === "string" && nome.trim() ? nome.trim() : null;',
    '  return typeof nome === "string" ? nome : null;',
  ],
  [
    DESTINO,
    "a transferencia de valor zero passa a receber direcao",
    "  if (mov.amount === 0) {",
    "  if (false) {",
  ],

  // --- o sinal da parte de grupo ---
  [
    PARTE,
    "a parte entra POSITIVA (a minha parte do jantar aparece como receita)",
    "      amount: -Math.abs(parte.amount),",
    "      amount: parte.amount,",
  ],
  [
    PARTE,
    "o -Math.abs vira - simples (view mudando de sinal vira receita)",
    "      amount: -Math.abs(parte.amount),",
    "      amount: -parte.amount,",
  ],
  [
    PARTE,
    "o total da despesa entra positivo",
    "      totalDaDespesa: -Math.abs(despesa.amount),",
    "      totalDaDespesa: Math.abs(despesa.amount),",
  ],

  // --- a contagem dupla ---
  [
    PARTE,
    "a guarda de paguei_eu cai (a despesa que eu paguei conta duas vezes)",
    "    if (parte.paguei_eu) continue;",
    "    if (false) continue;",
  ],
  [
    PARTE,
    "a guarda de paguei_eu inverte (so a MINHA parte do que eu paguei entra)",
    "    if (parte.paguei_eu) continue;",
    "    if (!parte.paguei_eu) continue;",
  ],

  // --- a parte sem descricao ---
  [
    PARTE,
    "a parte sem despesa passa a entrar na lista sem descricao",
    "    const despesa = despesas.get(parte.transaction_id);\n    if (!despesa) {\n      semDescricao += 1;\n      continue;\n    }",
    '    const despesa = despesas.get(parte.transaction_id) ?? {\n      id: parte.transaction_id,\n      user_id: "",\n      description: "",\n      amount: 0,\n      category: null,\n    };',
  ],
  [
    PARTE,
    "o descarte deixa de ser contado (a lista encurta em silencio)",
    "      semDescricao += 1;\n      continue;",
    "      continue;",
  ],

  // --- o id que nao pode cair numa rota de transacao ---
  [
    PARTE,
    "o id da parte perde o prefixo (vai cru para a rota de transacao)",
    "      id: `parte:${parte.id}`,",
    "      id: parte.id,",
    ],
  [
    PARTE,
    "o id da parte passa a ser o id da transacao do grupo",
    "      id: `parte:${parte.id}`,",
    "      id: parte.transaction_id,",
  ],

  // --- a aba em que a parte aparece ---
  [
    PARTE,
    "a parte passa a aparecer em TODAS as abas (inclusive Receitas)",
    '  if (filtro === "todos" || filtro === "expense") {',
    "  if (true) {",
  ],
  [
    PARTE,
    "a parte deixa de aparecer na aba Despesas",
    '  if (filtro === "todos" || filtro === "expense") {',
    '  if (filtro === "todos") {',
  ],
  [
    PARTE,
    "a parte deixa de aparecer na lista inteira",
    '  if (filtro === "todos" || filtro === "expense") {',
    "  if (false) {",
  ],

  // --- a ordem ---
  [
    PARTE,
    "a ordenacao por data some (as partes caem todas no fim da lista)",
    "  return linhas.sort((a, b) => dataDaLinha(b).localeCompare(dataDaLinha(a)));",
    "  return linhas;",
  ],
  [
    PARTE,
    "a lista sai em ordem CRESCENTE de data",
    "  return linhas.sort((a, b) => dataDaLinha(b).localeCompare(dataDaLinha(a)));",
    "  return linhas.sort((a, b) => dataDaLinha(a).localeCompare(dataDaLinha(b)));",
  ],

  // --- a contagem da barra de abas ---
  [
    PARTE,
    "a contagem volta a ignorar as partes (a aba diz 4 e mostra 6)",
    "    todos: minhas.length + partes.length,\n    income: 0,\n    expense: partes.length,",
    "    todos: minhas.length,\n    income: 0,\n    expense: 0,",
  ],
  [
    PARTE,
    "as partes entram na contagem de Receitas",
    "    income: 0,\n    expense: partes.length,",
    "    income: partes.length,\n    expense: 0,",
  ],

  // --- a nota dos cartoes ---
  [
    PARTE,
    "o total das partes passa a somar com sinal (zera ou inverte)",
    "  return linhas.reduce((soma, linha) => soma + Math.abs(linha.amount), 0);",
    "  return linhas.reduce((soma, linha) => soma + linha.amount, 0);",
  ],
  [
    PARTE,
    "a nota passa a aparecer com zero parte (R$ 0,00 em grupo para quem nao tem grupo)",
    "  if (linhas.length === 0) return null;",
    "  if (false) return null;",
  ],

  // --- a parte DENTRO do cartao Despesas (HMO-275) ---
  //
  // Os tres primeiros sao os que erram dinheiro sem quebrar nada: um deles --
  // o `meu.saldo` herdado -- e um erro de UMA PALAVRA que deixa os tres cartoes
  // se contradizendo embaixo da legenda "Receitas - Despesas". Um teste que
  // afirmasse so sobre o saldo sobreviveria a dois deles.
  [
    PARTE,
    "a parte volta a ficar fora do cartao Despesas",
    "  const despesas = meu.despesas + totalDasPartesDeTerceiros(partes);",
    "  const despesas = meu.despesas;",
  ],
  [
    PARTE,
    "o saldo e HERDADO em vez de recalculado (os tres cartoes se contradizem)",
    "    saldo: meu.receitas - despesas,",
    "    saldo: meu.saldo,",
  ],
  [
    PARTE,
    "a parte entra em RECEITAS (o reembolso da F10 publicado como recebido)",
    "  const despesas = meu.despesas + totalDasPartesDeTerceiros(partes);\n\n  return {\n    receitas: meu.receitas,",
    "  const despesas = meu.despesas;\n\n  return {\n    receitas: meu.receitas + totalDasPartesDeTerceiros(partes),",
  ],
  [
    PARTE,
    "a parte entra nos DOIS lados (o saldo fecha certo e os dois cartoes incham)",
    "    receitas: meu.receitas,",
    "    receitas: meu.receitas + totalDasPartesDeTerceiros(partes),",
  ],
  [
    PARTE,
    "a parte SUBTRAI de Despesas (gasto do mes cai quando outro paga)",
    "  const despesas = meu.despesas + totalDasPartesDeTerceiros(partes);",
    "  const despesas = meu.despesas - totalDasPartesDeTerceiros(partes);",
  ],
  [
    PARTE,
    "a parte conta em dobro no cartao",
    "  const despesas = meu.despesas + totalDasPartesDeTerceiros(partes);",
    "  const despesas = meu.despesas + 2 * totalDasPartesDeTerceiros(partes);",
  ],
  [
    PARTE,
    "a parte passa a contar como transferencia (muda a outra frase do saldo)",
    "    transferido: meu.transferido,\n    transferencias: meu.transferencias,",
    "    transferido: meu.transferido + totalDasPartesDeTerceiros(partes),\n    transferencias: meu.transferencias + partes.length,",
  ],
  [
    PARTE,
    "o cartao passa a contar a parte CONTADA PELA QUANTIDADE, nao pelo valor",
    "  const despesas = meu.despesas + totalDasPartesDeTerceiros(partes);",
    "  const despesas = meu.despesas + partes.length;",
  ],
];

const SUITE = "test:lancamentos-completos";

const bloco = criarBlocoDeMutantes({ rotulo: "lancamentos-completos", suites: [SUITE] });

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
for (const arquivo of new Set(mutantes.map(([alvo]) => alvo))) {
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

for (const [alvo, nome, de, para] of mutantes) {
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
