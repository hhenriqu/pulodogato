#!/usr/bin/env node
// Mutantes de lib/perna-da-contraparte.ts -- HMO-245, fase 12 (HMO-278).
//
// POR QUE ISTO EXISTE
// -------------------
// `npm run test:perna-da-contraparte` passa com 19 blocos verdes. Isso, sozinho,
// nao diz nada: quase todo enunciado desta fase e um BOOLEANO, e booleano e o
// que um teste mal escrito confirma por acidente -- basta olhar o lado que
// calhou de estar certo. Cada mutante abaixo desfaz UMA decisao do modulo; o
// teste tem que ficar vermelho em todos.
//
// O MUTANTE QUE MAIS IMPORTA E O `direcao_invertida`
// --------------------------------------------------
// Ele e o unico que erra DINHEIRO, e erra nos dois lados de uma vez: quem pagou
// recebe a perna POSITIVA e quem recebeu a negativa. O saldo das duas contas
// anda para o lado errado com o valor certo, e a tela nao tem como notar --
// "Lancado em Nubank" e verdade nos dois casos.
//
// Note que ele NAO e morto pelo bloco das "direcoes opostas": invertidas, as
// duas continuam opostas. Quem o mata e a assercao do SINAL com nome
// (`quem deve leva transfer NEGATIVA`), e e por isso que aquele bloco nao basta
// e este runner existe.
//
// O SEGUNDO E O `rotulo_igual_nos_dois_estados`
// ---------------------------------------------
// A entrega 2 da issue e um rotulo, e rotulo e exatamente o tipo de coisa que
// uma suite mede por fora: `assert.match(rotulo, /lançado/)` casa com "ainda nao
// lancado na sua conta" E com "Lancado em Nubank". Este mutante devolve a frase
// de `lancado` nos DOIS estados; se o teste sobreviver, ele esta medindo que
// existe uma frase, nao que ela distingue os dois estados -- e a tela de quem
// nao confirmou volta a dizer que o dinheiro entrou.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao e compilada de uma arvore que nao e a do repositorio. Mutar o
// arquivo do repo, rodar e restaurar no `finally` deixa a fonte mutada no disco
// quando o processo morre no meio -- e aqui o worktree e compartilhado com
// outros runs, onde isso custaria o trabalho de outra pessoa.
//
// A LISTA DE "ARQUIVOS QUE ACOMPANHAM A COPIA" DEIXOU DE EXISTIR (HMO-320)
// ------------------------------------------------------------------------
// Este runner montava, A CADA MUTANTE, uma arvore nova em diretorio temporario
// com `lib/` INTEIRO copiado dentro, um `tsconfig.json` sintetizado apontado
// para ela, e tres processos por cima (`npx tsc`, `resolve-aliases`,
// `node --test`). O `lib/` inteiro estava ali porque o modulo importa
// `acerto-em-lancamento.ts` pelo alias `@/`, que importa dinheiro, cambio e
// settlement -- copiar so o arquivo mutado derruba a compilacao no primeiro
// import e TODO mutante "morre" por erro de build.
//
// O recorte a mao e que era o problema, e nao o seu tamanho: ele e uma SEGUNDA
// copia do grafo de modulos, e ela envelhece calada. Blocos deste repositorio
// reprovavam na main porque o codigo passou a importar `@/types/financial` e o
// recorte de cada um nao acompanhou -- um import novo para FORA de `lib/` este
// tsconfig sintetizado nem veria.
//
// `criarBlocoDeMutantes` nao recebe recorte nenhum: ele espelha a arvore inteira
// por symlink, troca EM MEMORIA so o arquivo mutado, e quem delimita o que o
// bloco prova volta a ser o `scripts/tsconfig.perna-da-contraparte-test.json` --
// o mesmo que o CI usa, e com ele o passo `resolve-aliases` que o npm script tem
// e este runner repetia a mao. O `.tmp-perna-da-contraparte` tambem sai de cena:
// a saida de cada volta e emitida DENTRO da sombra, entao um
// `npm run test:perna-da-contraparte` depois deste runner nao tem como cair no
// artefato do ultimo mutante.
//
// E a compilacao e UMA para todas as voltas, em processo, em vez de uma por
// mutante.
//
// COMO RODAR
//   npm run mutantes:perna-da-contraparte

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const FONTE = "lib/perna-da-contraparte.ts";
const SUITE = "test:perna-da-contraparte";

const original = readFileSync(FONTE, "utf8");

const MUTANTES = [
  {
    nome: "direcao_invertida",
    porque:
      "a direcao sai trocada nas duas sessoes: quem pagou leva a perna POSITIVA e quem recebeu a negativa -- os dois saldos andam para o lado errado com o valor certo",
    de: "    fromUserId: params.acerto.from_user_id,\n    toUserId: params.acerto.to_user_id,",
    para: "    fromUserId: params.acerto.to_user_id,\n    toUserId: params.acerto.from_user_id,",
  },
  {
    nome: "rotulo_igual_nos_dois_estados",
    porque:
      'o estado intermediario passa a dizer "Lancado na sua conta": "nao lancado" volta a ser indistinguivel de "lancado", que e a entrega 2 da issue desfeita',
    de: "    rotulo: ROTULO_A_LANCAR,",
    para: "    rotulo: rotuloDeLancado(params.nomeDaConta),",
  },
  {
    nome: "rotulo_mente_para_quem_nao_e_parte",
    porque:
      'o acerto entre outras duas pessoas ganha "ainda nao lancado na SUA conta": afirma na tela do Caio uma divida que nao e dele, e oferece a acao de lancar dinheiro que nao passou por ele',
    de: "      rotulo: null,",
    para: "      rotulo: ROTULO_A_LANCAR,",
  },
  {
    nome: "lanca_sem_ser_parte",
    porque:
      "a tela oferece a acao de lancar a perna de um acerto entre outras duas pessoas -- botao que a rota recusa com 403, e que convida a inventar um lancamento",
    // `podeLancar: false,` aparece DUAS vezes (nao_sou_parte e lancado). A linha
    // de cima e o que torna o trecho unico -- sem ela o mutante mudaria o ramo
    // `lancado` e passaria a ser o mutante da duplicata, com o rotulo mentindo
    // sobre o que foi medido.
    de: "      rotulo: null,\n      podeLancar: false,",
    para: "      rotulo: null,\n      podeLancar: true,",
  },
  {
    nome: "registrador_ganha_desfazer_so_a_perna",
    porque:
      "quem registrou passa a ver tambem 'Desfazer o meu lancamento', que deixa a quitacao de pe sem o dinheiro ter saido -- o defeito EXATO que a fase 11 consertou, a um clique de distancia",
    de: "      podeDesfazerSoAMinhaPerna: !podeDesfazerOAcerto,",
    para: "      podeDesfazerSoAMinhaPerna: true,",
  },
  {
    nome: "duplicata_passa",
    porque:
      "a guarda de ja-lancado some: o duplo clique grava a perna DUAS vezes e tira o valor do acerto em dobro da conta de quem confirma",
    de: '  if (visao.estado === "lancado") return { recusa: "ja_lancado" };',
    para: "",
  },
  {
    nome: "registrador_remove_so_a_propria_perna",
    porque:
      "a rota da perna aceita o pedido de quem registrou: ele tira o lancamento e DEIXA a quitacao -- a divida fica quitada com o dinheiro ainda na conta dele",
    de: "  if (visao.podeDesfazerOAcerto) return MENSAGEM_USE_DESFAZER;",
    para: "",
  },
  {
    nome: "remove_perna_que_nao_existe",
    porque:
      'a guarda de "nao ha o que remover" some: a rota segue para o DELETE com `perna` nulo e estoura 500 onde a resposta certa e uma frase',
    de: '  if (visao.estado === "a_lancar") {\n    return "Este acerto não está lançado na sua conta: não há o que remover.";\n  }',
    para: "",
  },
];

const bloco = criarBlocoDeMutantes({ rotulo: "perna-da-contraparte", suites: [SUITE] });
// A sombra vive em diretorio temporario e sai junto com o processo -- inclusive
// na saida antecipada do controle. No pior caso (SIGTERM) sobra um diretorio
// orfao em /tmp, e nao mutante em `lib/`.
process.on("exit", () => bloco.fechar());

/** Uma volta do bloco com estas sobrescritas (`{}` = arvore intacta). */
const compilaERoda = (sobrescritas = {}) =>
  bloco.rodar("perna-da-contraparte", sobrescritas, SUITE);

let falhas = 0;
let mortos = 0;

// CONTROLE POSITIVO: com a fonte intacta o teste tem de PASSAR. Sem isto, um
// "todos morreram" poderia significar apenas que o build esta quebrado, ou
// que este runner esta compilando a arvore errada, e o teste reprova sempre.
const controle = compilaERoda();
if (controle.verde) {
  console.log("controle positivo: o teste passa com a fonte intacta\n");
} else {
  console.error("ABORTADO: o teste reprova com a fonte INTACTA.");
  console.error(`  (${controle.como}) ${controle.saida}`);
  process.exit(1);
}

for (const m of MUTANTES) {
  // `String.replace` troca a PRIMEIRA ocorrencia. Um trecho que aparece duas
  // vezes produz um mutante que muta o lugar errado e morre verde com o
  // rotulo mentindo sobre o que foi medido -- por isso o trecho tem de ser
  // UNICO, e nao apenas existir.
  const ocorrencias = original.split(m.de).length - 1;
  if (ocorrencias !== 1) {
    console.error(
      `NAO APLICOU: ${m.nome} -- o trecho aparece ${ocorrencias}x em ${FONTE} (tem de ser 1)`
    );
    falhas++;
    continue;
  }

  const r = compilaERoda({ [FONTE]: original.replace(m.de, m.para) });

  if (r.verde) {
    console.error(`SOBREVIVEU: ${m.nome}`);
    console.error(`            ${m.porque}`);
    // Sobreviver emitindo byte IDENTICO ao da arvore limpa nao e furo de
    // assercao: e mutante equivalente, e nenhuma assercao o mataria.
    if (r.mudouASaida === false) {
      console.error(
        "            (a saida compilada e identica a da arvore limpa: mutante EQUIVALENTE, nao furo de teste)"
      );
    }
    falhas++;
  } else {
    // Mutante que nao compila nao e mutante morto: ele nunca chegou ao teste.
    // Sem esta peneira, um `de`/`para` que quebre o TypeScript conta como
    // acerto e o placar sai cheio sem nada ter sido medido. A distincao vem do
    // proprio bloco (`como`), e nao mais de um grep por `error TS` numa saida
    // em que tsc e `node --test` estavam misturados.
    if (r.como === "tsc") {
      console.error(`NAO COMPILOU: ${m.nome} -- o mutante nao chegou ao teste`);
      console.error(`  ${r.saida}`);
      falhas++;
      continue;
    }
    mortos++;
    console.log(`morreu:     ${m.nome}`);
  }
}

console.log(`\n${mortos}/${MUTANTES.length} mutantes mortos`);

process.exitCode = falhas ? 1 : 0;
