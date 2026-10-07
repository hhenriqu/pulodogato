#!/usr/bin/env node
// Prova de mutacao do selo "Pago por ..." da HMO-274. NAO roda em CI -- e
// ferramenta de quem esta escrevendo o teste. Cada entrada estraga uma decisao
// do fonte; `npm run test:pagador-da-parte` tem que ficar VERMELHA em todas.
// Mutante que sobrevive e um trecho que nenhum teste distingue, ou codigo morto.
//
//   node scripts/mutantes-pagador-da-parte.mjs
//
// Os mutantes que mais importam sao os que a issue nomeia, porque sao os que
// nao dao sintoma:
//
//   * o selo DESAPARECENDO quando o perfil nao e legivel. A linha volta a ser
//     "R$ 200,00 · Minha parte · Praia", que se le como despesa propria -- e
//     nada na tela diz que houve um nome que nao deu para mostrar.
//   * o rotulo de fallback virando VAZIO. Sai "Pago por " e um espaco, ou um
//     selo em branco no meio da fileira: ninguem repara, e a informacao sumiu.
//   * a MARCA mentindo sobre o texto. `data-pagador="nome"` em cima de um selo
//     em branco deixa um teste que le a marca passar verde sobre o defeito.
//     E por isso que a marca e o texto saem da mesma funcao.
//
// DUAS TRAVAS QUE ESTE RUNNER TEM E O CUIDADO DE NAO DISPENSAR
// ------------------------------------------------------------
// 1. O TRECHO TEM QUE APARECER EXATAMENTE UMA VEZ. `String.replace` com string
//    troca a PRIMEIRA ocorrencia: um alvo que aparece duas vezes muta um lugar
//    que nao e o anunciado, e o rotulo da linha de saida passa a mentir sobre o
//    que foi medido.
// 2. A SUITE TEM QUE ESTAR VERDE ANTES. Se ela ja estiver vermelha, todo
//    mutante "morre" sem que nada tenha sido medido -- o resultado seria
//    100% de mortalidade com zero poder de deteccao.
//
// O BLOCO: UMA COMPILACAO PARA TODOS OS MUTANTES (HMO-334)
// --------------------------------------------------------
// Este runner MUTAVA A ARVORE RASTREADA: guardava o texto original em memoria,
// escrevia o mutante num dos 2 arquivos de producao da lista,
// chamava `npm run test:pagador-da-parte` ali mesmo e restaurava depois. Dois defeitos
// nisso, e o segundo e o que doia:
//
//   1. cada uma das 22 voltas recompilava o programa INTEIRO, mesmo
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
// As etapas da suite saem do proprio `scripts["test:pagador-da-parte"]` do package.json -- o
// comando que o CI roda --, e nao de uma receita repetida a mao aqui.
//
// A lista de mutantes abaixo NAO foi reescrita: ela veio byte a byte do arquivo
// anterior, pelo `scripts/converte-mutantes-em-bloco.mjs`.

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const LIB = "lib/parte-de-grupo-na-lista.ts";
const LINHA = "components/movimentacoes/LinhaDaParteDeGrupo.tsx";

const mutantes = [
  // -------------------------------------------------------------------------
  // O ROTULO DE FALLBACK -- a armadilha que a issue nomeia
  // -------------------------------------------------------------------------
  [
    LIB,
    "o fallback vira VAZIO (sai 'Pago por ' e mais nada)",
    "    texto: `Pago por ${limpo || PAGADOR_SEM_NOME}`,",
    "    texto: `Pago por ${limpo}`,",
  ],
  [
    LIB,
    "o rotulo de fallback e a string vazia",
    'export const PAGADOR_SEM_NOME = "outro membro do grupo";',
    'export const PAGADOR_SEM_NOME = "";',
  ],
  [
    LIB,
    "o fallback deixa de ter prefixo (so 'outro membro do grupo', sem 'Pago por')",
    "    texto: `Pago por ${limpo || PAGADOR_SEM_NOME}`,",
    "    texto: `${limpo || PAGADOR_SEM_NOME}`,",
  ],

  // -------------------------------------------------------------------------
  // A MARCA QUE MENTE SOBRE O TEXTO
  // -------------------------------------------------------------------------
  [
    LIB,
    "a marca diz sempre 'nome', inclusive sobre o selo de fallback",
    "    temNome: limpo.length > 0,",
    "    temNome: true,",
  ],
  [
    LIB,
    "a marca inverte",
    "    temNome: limpo.length > 0,",
    "    temNome: limpo.length === 0,",
  ],
  [
    LIB,
    "nome de espacos em branco passa a contar como nome (marca 'nome', selo em branco)",
    '  const limpo = (nome ?? "").trim();',
    '  const limpo = nome ?? "";',
  ],
  [
    LINHA,
    "a marca volta a ser calculada a parte, e divergir do texto",
    'data-pagador={pagador.temNome ? "nome" : "sem-nome"}',
    'data-pagador={parte.pagador ? "nome" : "sem-nome"}',
  ],

  // -------------------------------------------------------------------------
  // O SELO SUMINDO DA LINHA
  // -------------------------------------------------------------------------
  [
    LINHA,
    "o selo fica em branco quando o perfil nao e legivel",
    "              {pagador.texto}",
    "              {pagador.temNome ? pagador.texto : null}",
  ],
  [
    LINHA,
    "o JSX volta a imprimir o campo cru (renderiza NADA com perfil invisivel)",
    "              {pagador.texto}",
    "              {parte.pagador}",
  ],
  [
    LINHA,
    "o selo passa a sair com texto fixo, sem olhar o nome",
    "              {pagador.texto}",
    '              {"Pago por Ana Souza"}',
  ],
  [
    LINHA,
    "o selo vai para dentro do ramo do rateio a aprovar (linha aprovada perde o nome)",
    '            <span\n              data-pagador={pagador.temNome ? "nome" : "sem-nome"}',
    '            <span\n              hidden={parte.splitStatus !== "pending"}\n              data-pagador={pagador.temNome ? "nome" : "sem-nome"}',
  ],
  [
    LINHA,
    "a explicacao do fallback some do title",
    "                  : \"O perfil de quem pagou não está visível para você. Abra o grupo para ver quem lançou.\"",
    "                  : undefined",
  ],

  // -------------------------------------------------------------------------
  // A FIACAO: O NOME QUE NAO CHEGA
  // -------------------------------------------------------------------------
  [
    LIB,
    "o nome nunca chega na linha (a fiacao e cortada no fim)",
    "      pagador: nomes.get(despesa.user_id) ?? null,",
    "      pagador: null,",
  ],
  [
    LIB,
    "o mapa e consultado pela chave errada (grupo em vez de pagador)",
    "      pagador: nomes.get(despesa.user_id) ?? null,",
    "      pagador: nomes.get(parte.group_id) ?? null,",
  ],
  [
    LIB,
    "o `?? null` cai e o campo passa a vir `undefined`",
    "      pagador: nomes.get(despesa.user_id) ?? null,",
    "      pagador: nomes.get(despesa.user_id) as string,",
  ],
  [
    LIB,
    "o id de quem pagou passa a ser o id da parte",
    "      pagadorId: despesa.user_id,",
    "      pagadorId: parte.id,",
  ],
  [
    LIB,
    "a parte SEM nome legivel passa a ser descartada da lista",
    "    const despesa = despesas.get(parte.transaction_id);",
    '    const achada = despesas.get(parte.transaction_id);\n    const despesa = nomes.get(achada?.user_id ?? "") ? achada : undefined;',
  ],

  // -------------------------------------------------------------------------
  // nomesDosPagadores
  // -------------------------------------------------------------------------
  [
    LIB,
    "nome em branco entra no mapa (o selo sai 'Pago por ' com marca de nome)",
    "    if (nome) nomes.set(perfil.id, nome);",
    "    nomes.set(perfil.id, nome);",
  ],
  [
    LIB,
    "o apelido passa a vencer o nome completo",
    '    const nome = (perfil.full_name ?? "").trim() || (perfil.nickname ?? "").trim();',
    '    const nome = (perfil.nickname ?? "").trim() || (perfil.full_name ?? "").trim();',
  ],
  [
    LIB,
    "o nome deixa de ser aparado (espacos no banco viram nome valido)",
    '    const nome = (perfil.full_name ?? "").trim() || (perfil.nickname ?? "").trim();',
    '    const nome = perfil.full_name || perfil.nickname;',
  ],
  [
    LIB,
    "o apelido deixa de ser consultado (quem so tem apelido perde o nome)",
    '    const nome = (perfil.full_name ?? "").trim() || (perfil.nickname ?? "").trim();',
    '    const nome = (perfil.full_name ?? "").trim();',
  ],
  [
    LIB,
    "perfil sem id entra no mapa com a chave undefined",
    "    if (!perfil?.id) continue;",
    "    if (false) continue;",
  ],
];

const SUITE = "test:pagador-da-parte";

const bloco = criarBlocoDeMutantes({ rotulo: "pagador-da-parte", suites: [SUITE] });

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
