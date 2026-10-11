#!/usr/bin/env node
// Prova de mutacao das OITO GUARDAS DE LEITURA do export de relatorio (HMO-378).
//
//   node scripts/mutantes-export-de-relatorio.mjs
//
// Cada entrada reintroduz o `error` IGNORADO em UMA das oito guardas;
// `npm run test:export-de-relatorio` tem de ficar VERMELHA em todas. Mutante
// que sobrevive e uma guarda que nenhuma assercao distingue -- e, aqui, uma
// guarda que ninguem vai notar faltando, porque o sintoma dela e um arquivo
// que abre, tem cabecalho e some com uma secao.
//
// UM MUTANTE POR GUARDA, E E ISSO QUE A ISSUE PEDE
// ------------------------------------------------
// A rota tem DOZE chamadas `.from(...)` agrupadas em OITO pontos de guarda (a
// queda da 033 reatribui `data`/`error` na mesma variavel em dois ramos). Uma
// guarda escrita em oito lugares e sete lugares para esquecer, e o `?? []` que
// ela substituiu era exatamente o que uma linha esquecida volta a ser. Um
// mutante unico sobre `linhasOuFalha` -- a funcao -- nao mediria nada disso:
// ele mataria as oito de uma vez e deixaria sete sem conferencia
// (`duas-guardas-redundantes-fazem-os-dois-mutantes-sobreviverem`, de cabeca
// para baixo).
//
// A MUTACAO E A MESMA NOS OITO, E NAO POR COMODIDADE
// --------------------------------------------------
// `linhasOuFalha(` vira uma arrow que descarta o `error` e devolve
// `r.data ?? []`. Isso nao e "uma mutacao qualquer": e **literalmente o codigo
// que estava ali antes da HMO-378**, nos oito lugares. Entao cada mutante
// reconstroi o defeito original num ramo e deixa os outros sete consertados --
// que e a unica forma de medir se a suite sabe apontar QUAL ramo perdeu a
// guarda.
//
// Deletar a chamada e trocar por `data ?? []` daria o mesmo efeito em quatro
// dos oito e um erro de tipo nos outros quatro (os que consultam dentro do
// argumento, sem variavel intermediaria) -- e mutante que morre no `tsc` nao
// mede assercao nenhuma (`mutante-de-retrocesso-morre-no-tsc-nao-na-assercao`).
// A arrow generica e tipada de proposito: `error?: unknown` no parametro existe
// para o literal `{ data, error }` dos dois primeiros ramos nao bater no
// excess-property-check, e `T[] | null` para o `.map((c) => [c.id, c.name])`
// que vem depois continuar tipado.
//
// AS ANCORAS INCLUEM O NOME DA CONSULTA, E ISSO E OBRIGATORIO
// -----------------------------------------------------------
// `const linhas = linhasOuFalha(` aparece DUAS vezes no arquivo (o ramo de
// categorias e o do extrato), e `linhasOuFalha(` sozinho aparece oito. Sem o
// nome da consulta na ancora, `String.replace` mutaria a primeira ocorrencia e
// o rotulo descreveria outro ramo -- `mutante-por-replace-estraga-a-primeira-ocorrencia`.
// A trava de ocorrencia unica do laco abaixo e o que pega isso.
//
// E as ancoras sao trechos de CODIGO, nunca frases de comentario: este arquivo
// de rota agora explica a decisao em prosa e CITA `linhasOuFalha` e `?? []`
// dentro dos comentarios (`sed-sem-g-muta-o-comentario-e-reprova-a-arvore-certa`).
//
// A FORMA DA LISTA E A DA FAMILIA TUPLA DE ARIDADE 4
// --------------------------------------------------
// `scripts/mede-ancora-ambigua.mjs` -- a guarda que reprova ancora morta,
// ambigua ou de arquivo inexistente em TODO runner do repo -- le a lista de
// verdade em vez de a copiar, e so sabe ler duas formas. Dai a ordem
// `[alvo, rotulo, de, para]` e o `original` montado DEPOIS da lista. As ancoras
// sao strings de uma linha com `\n` escapado, nunca template literal.
import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const ROTA = "app/api/reports/export/route.ts";

/**
 * O `?? []` de antes da HMO-378, como arrow tipada -- ver A MUTACAO E A MESMA
 * NOS OITO, no cabecalho.
 */
const SEM_GUARDA =
  "(<T>(_n: string, r: { data: T[] | null; error?: unknown }) => r.data ?? [])(";

/** [alvo, rotulo, de, para] */
const mutantes = [
  // =========================================================================
  // GUARDA 1 -- o fluxo de caixa mensal (3 consultas: grupo, 033, queda)
  // =========================================================================
  [
    ROTA,
    "GUARDA 1/8: o fluxo de caixa volta a ignorar o `error` (a RLS barra a view e o CSV sai com as seis colunas e nenhum mes -- doze meses de movimento lidos como ano sem movimento)",
    '      const linhasDoFluxo = linhasOuFalha("o fluxo de caixa mensal", {',
    `      const linhasDoFluxo = ${SEM_GUARDA}"o fluxo de caixa mensal", {`,
  ],

  // =========================================================================
  // GUARDA 2 -- os gastos por categoria (3 consultas)
  // =========================================================================
  [
    ROTA,
    "GUARDA 2/8: os gastos por categoria voltam a ignorar o `error` (e o arquivo de categorias sai vazio enquanto o de fluxo de caixa, que le a view irma, sai cheio -- `fontes-consistentes-que-discordam` em dois arquivos da mesma pasta de downloads)",
    '      const linhas = linhasOuFalha("os gastos por categoria", { data, error });',
    `      const linhas = ${SEM_GUARDA}"os gastos por categoria", { data, error });`,
  ],

  // =========================================================================
  // GUARDA 3 -- o join de ROTULO do ramo de categorias
  // =========================================================================
  // O modo de falha deste e o pior dos oito, e e por isso que ele tem mutante
  // proprio em vez de ficar junto com a guarda 2: aqui o arquivo sai com os
  // VALORES CERTOS e a classificacao inteira apagada. Toda linha diz "Sem
  // categoria", o total da planilha fecha com o do painel, e nada no arquivo
  // chama atencao -- `porId.get(...) ?? "Sem categoria"` nao distingue "esta
  // categoria nao existe" de "nao consegui ler nenhuma".
  [
    ROTA,
    "GUARDA 3/8: o join de rotulo de categories volta a ignorar o `error` (o CSV sai com os valores certos e TODA linha dizendo «Sem categoria» -- ele soma igual, e a classificacao inteira desapareceu)",
    '      const categorias = linhasOuFalha(\n        "os nomes das categorias",',
    `      const categorias = ${SEM_GUARDA}\n        "os nomes das categorias",`,
  ],

  // =========================================================================
  // GUARDA 4 -- o previsto x realizado
  // =========================================================================
  // Este ramo e um dos tres que a HMO-207 NAO instrumentou: antes da HMO-378
  // ele nao desestruturava `error` em lugar nenhum, nem para `console.error`.
  [
    ROTA,
    "GUARDA 4/8: o previsto x realizado volta a ignorar o `error` (nove colunas e zero linhas, num relatorio que existe para dizer se o mes estourou o planejado)",
    '      const linhasDoPrevisto = linhasOuFalha("o previsto x realizado", previsto);',
    `      const linhasDoPrevisto = ${SEM_GUARDA}"o previsto x realizado", previsto);`,
  ],

  // =========================================================================
  // GUARDA 5 -- o historico de patrimonio
  // =========================================================================
  [
    ROTA,
    "GUARDA 5/8: o patrimonio volta a ignorar o `error` (duas colunas de numero e nenhuma linha se le como «este app nao sabe meu patrimonio», e nao como leitura falhada)",
    '      const linhasDoPatrimonio = linhasOuFalha(\n        "o historico de patrimonio",',
    `      const linhasDoPatrimonio = ${SEM_GUARDA}\n        "o historico de patrimonio",`,
  ],

  // =========================================================================
  // GUARDA 6 -- o extrato de lancamentos
  // =========================================================================
  // O extrato e o relatorio que alguem abre JUSTAMENTE para desconfiar de um
  // numero agregado. "O painel diz R$ 4.000 e o extrato nao tem linha nenhuma"
  // nao se resolve a favor do painel: o extrato parece a fonte mais crua.
  [
    ROTA,
    "GUARDA 6/8: o extrato volta a ignorar o `error` (quem exportou para conferir um agregado de que desconfiava recebe zero lancamentos -- e conclui que o agregado estava inflado)",
    '      const linhas = linhasOuFalha("o extrato de lancamentos", extrato);',
    `      const linhas = ${SEM_GUARDA}"o extrato de lancamentos", extrato);`,
  ],

  // =========================================================================
  // GUARDA 7 e 8 -- os dois joins de rotulo do extrato
  // =========================================================================
  // Duas guardas e nao uma, mesmo saindo do mesmo `Promise.all`: ele devolve as
  // DUAS respostas, cada uma com o seu `error`, e uma guarda so cobriria a
  // primeira. Os dois mutantes existem para provar que a suite as distingue --
  // com uma assercao so, o sintoma da outra (a coluna "Conta" inteira em
  // branco) passaria verde.
  [
    ROTA,
    "GUARDA 7/8: o join de categoria do EXTRATO volta a ignorar o `error` (a coluna «Categoria» de todo lancamento fica em branco, com os valores certos ao lado)",
    '        linhasOuFalha("os nomes das categorias do extrato", respostaDasCategorias).map(',
    `        ${SEM_GUARDA}"os nomes das categorias do extrato", respostaDasCategorias).map(`,
  ],
  [
    ROTA,
    "GUARDA 8/8: o join de conta do EXTRATO volta a ignorar o `error` (a coluna «Conta» de todo lancamento fica em branco -- e e a coluna que diz de qual banco saiu o dinheiro)",
    '        linhasOuFalha("os nomes das contas do extrato", respostaDasContas).map((c) => [',
    `        ${SEM_GUARDA}"os nomes das contas do extrato", respostaDasContas).map((c) => [`,
  ],
];

const SUITE = "test:export-de-relatorio";

const bloco = criarBlocoDeMutantes({
  suites: [SUITE],
  rotulo: "export-de-relatorio",
});

// Lido da arvore de verdade, que e o original por construcao: nada mais aqui
// escreve nela. Montado DEPOIS da lista -- ver A FORMA DA LISTA, no cabecalho.
const original = new Map();
for (const arquivo of new Set(mutantes.map(([alvo]) => alvo))) {
  original.set(arquivo, readFileSync(arquivo, "utf8"));
}

// CONTROLE POSITIVO: a arvore limpa tem de passar. Sem ele, uma suite ja
// vermelha -- ou um erro de script -- deixaria TODO mutante aparecendo como
// morto e o placar sairia cheio sem medir nada.
const limpo = bloco.rodar("<arvore limpa>", {}, SUITE);
if (!limpo.verde) {
  console.error(
    "controle positivo REPROVOU: a suite ja esta vermelha sem mutante nenhum. " +
      "Todo mutante abaixo apareceria como MORTO sem medir nada."
  );
  bloco.fechar();
  process.exit(1);
}
console.log("controle positivo: arvore limpa VERDE.\n");

let mortos = 0;
const sobreviventes = [];

for (const [arquivo, rotulo, de, para] of mutantes) {
  const fonte = original.get(arquivo);
  const ocorrencias = fonte.split(de).length - 1;

  if (ocorrencias === 0) {
    console.error(
      `ANCORA MORTA  ${rotulo}\n  ${arquivo} nao contem o trecho procurado. ` +
        "Isto e erro do runner, nao mutante morto -- conserte a ancora."
    );
    bloco.fechar();
    process.exit(1);
  }

  // A TRAVA DE OCORRENCIA UNICA. `String.replace` troca a PRIMEIRA ocorrencia:
  // um `de` que aparece duas vezes muta um lugar que o rotulo nao descreve. O
  // risco e concreto aqui -- `linhasOuFalha(` aparece OITO vezes no arquivo e
  // `const linhas = linhasOuFalha(` aparece duas --, e por isso toda ancora
  // carrega o nome da consulta.
  if (ocorrencias > 1) {
    console.error(
      `ANCORA AMBIGUA  ${rotulo}\n  o trecho aparece ${ocorrencias}x em ${arquivo} ` +
        "-- o replace muta so a 1a. Isto e erro do runner; estreite a ancora."
    );
    bloco.fechar();
    process.exit(1);
  }

  const mutado = fonte.replace(de, para);

  if (mutado === fonte) {
    console.error(
      `MUTACAO NO-OP  ${rotulo}\n  o replace nao mudou o texto de ${arquivo}.`
    );
    bloco.fechar();
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
      console.log(
        "           (saida compilada identica a da arvore limpa: EQUIVALENTE)"
      );
    }
  }
}

bloco.fechar();

console.log(`\n${mortos}/${mutantes.length} mortos.`);
if (sobreviventes.length > 0) {
  console.log("\nsobreviventes:");
  for (const s of sobreviventes) console.log(`  - ${s}`);
}

// Sai 1 com sobrevivente: um runner que saisse 0 deixaria o step de CI verde
// para sempre e provaria o mesmo que step nenhum.
process.exit(sobreviventes.length === 0 ? 0 : 1);
