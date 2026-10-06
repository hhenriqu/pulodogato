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
// Mesma escolha do mutantes-credito-de-grupo.mjs: a mutacao e compilada de uma
// arvore TEMPORARIA. Mutar o arquivo do repo, rodar e restaurar no `finally`
// deixa a fonte mutada no disco quando o processo morre no meio -- e aqui o
// worktree e compartilhado com outros runs, onde isso custaria o trabalho de
// outra pessoa.
//
// A ARVORE TEMPORARIA E O lib/ INTEIRO porque o modulo importa
// `acerto-em-lancamento.ts` pelo alias `@/`, que importa dinheiro, cambio e
// settlement. Copiar so o arquivo mutado derruba a compilacao no primeiro
// import, e TODO mutante "morre" por erro de build.
//
// COMO RODAR
//   npm run mutantes:perna-da-contraparte

import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  cpSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const FONTE = "lib/perna-da-contraparte.ts";
const TESTE = "scripts/test-perna-da-contraparte.mjs";
// O MESMO diretorio que o npm script usa, porque o teste importa dele por
// caminho literal. O `finally` apaga: sem isso, o proximo
// `npm run test:perna-da-contraparte` rodaria contra o ultimo mutante.
const SAIDA = ".tmp-perna-da-contraparte";

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

const dir = mkdtempSync(join(tmpdir(), "mut278-"));
const dirLib = join(dir, "lib");
mkdirSync(dirLib, { recursive: true });
// lib/ inteiro: ver o cabecalho.
cpSync("lib", dirLib, { recursive: true });

// O tsconfig temporario e a copia do scripts/tsconfig.perna-da-contraparte-test
// .json apontada para a arvore mutada. `baseUrl` no dir temporario e o que faz
// `@/lib/...` achar a COPIA, e nao o arquivo do repo.
const tsconfig = join(dir, "tsconfig.json");
writeFileSync(
  tsconfig,
  JSON.stringify({
    compilerOptions: {
      outDir: resolve(SAIDA),
      rootDir: dirLib,
      module: "es2020",
      target: "es2020",
      moduleResolution: "node",
      strict: true,
      skipLibCheck: true,
      baseUrl: dir,
      paths: { "@/*": ["./*"] },
    },
    include: [join(dirLib, "perna-da-contraparte.ts")],
  })
);

function compilaERoda(fonteTs) {
  writeFileSync(join(dirLib, "perna-da-contraparte.ts"), fonteTs);
  rmSync(SAIDA, { recursive: true, force: true });
  execFileSync("npx", ["tsc", "-p", tsconfig], { stdio: "pipe" });
  // O tsc resolve `@/` mas nao o reescreve no JS emitido -- o mesmo passo do
  // npm script, sem o qual o node morre em ERR_MODULE_NOT_FOUND e TODO mutante
  // "morre" por erro de import.
  execFileSync("node", ["scripts/resolve-aliases.mjs", SAIDA, "lib"], {
    stdio: "pipe",
  });
  execFileSync("node", ["--test", TESTE], { stdio: "pipe" });
}

let falhas = 0;
let mortos = 0;

try {
  // CONTROLE POSITIVO: com a fonte intacta o teste tem de PASSAR. Sem isto, um
  // "todos morreram" poderia significar apenas que o build esta quebrado, ou
  // que este runner esta compilando a arvore errada, e o teste reprova sempre.
  try {
    compilaERoda(original);
    console.log("controle positivo: o teste passa com a fonte intacta\n");
  } catch (e) {
    console.error("ABORTADO: o teste reprova com a fonte INTACTA.");
    console.error((e.stdout ?? e.stderr ?? "").toString().slice(-1500));
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

    let r;
    try {
      compilaERoda(original.replace(m.de, m.para));
      r = { verde: true };
    } catch (e) {
      r = { verde: false, saida: (e.stdout ?? e.stderr ?? "").toString() };
    }

    if (r.verde) {
      console.error(`SOBREVIVEU: ${m.nome}`);
      console.error(`            ${m.porque}`);
      falhas++;
    } else {
      // Mutante que nao compila nao e mutante morto: ele nunca chegou ao teste.
      // Sem esta peneira, um `de`/`para` que quebre o TypeScript conta como
      // acerto e o placar sai cheio sem nada ter sido medido.
      if (/error TS\d+/.test(r.saida)) {
        console.error(`NAO COMPILOU: ${m.nome} -- o mutante nao chegou ao teste`);
        console.error((r.saida.match(/error TS\d+[^\n]*/) || [""])[0]);
        falhas++;
        continue;
      }
      mortos++;
      console.log(`morreu:     ${m.nome}`);
    }
  }

  console.log(`\n${mortos}/${MUTANTES.length} mutantes mortos`);
} finally {
  rmSync(dir, { recursive: true, force: true });
  // O artefato do ULTIMO mutante fica em SAIDA, que e o mesmo diretorio do npm
  // script. Apagar aqui e o que impede `npm run test:perna-da-contraparte` de
  // rodar contra codigo mutado e passar/reprovar por motivo nenhum.
  rmSync(SAIDA, { recursive: true, force: true });
}

process.exitCode = falhas ? 1 : 0;
