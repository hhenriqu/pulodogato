#!/usr/bin/env node
// =====================================================
// PULODOGATO - MUTACOES DO "ATUALIZAR" DA FAIXA (HMO-457)
// =====================================================
//   node scripts/mutantes-atualizar-da-faixa.mjs
//
// Estraga `components/movimentacoes/ListaDeMovimentacao.tsx` de um jeito por vez
// e exige que `npm run test:lista-na-tela` fique VERMELHA. Uma mutacao que
// sobrevive nao diz que o codigo esta certo: diz que o teste nao olha para
// aquela linha.
//
// POR QUE ESTE RUNNER EXISTE, e nao e zelo: o defeito desta issue era
// exatamente uma linha de FIACAO -- o botao da faixa ligado em `carregar` sem o
// argumento que fura o cache do service worker -- e as duas suites que cobrem a
// area passam VERDES com ela errada. `test:offline-leitura` mede a
// CLASSIFICACAO da leitura e `test:secao-da-tela` mede a MARCACAO dos botoes;
// a URL do segundo pedido nao sai no HTML e nao e assunto de nenhuma das duas.
// Antes de confiar no caso P eu preciso ver cada metade dele reprovar sozinha.
//
// A SOMBRA EM /tmp, E NAO A ARVORE (HMO-327). A primeira versao deste runner
// escrevia o mutante no proprio arquivo rastreado e restaurava no fim --
// e `npm run check-mutacao-no-lugar` a reprovou, com razao: um runner morto no
// meio (SIGTERM de timeout, job cancelado) deixa o mutante NO DISCO, e dali em
// diante toda medicao le o arquivo errado sem nada no placar dizer isso. Ja
// aconteceu tres vezes neste repositorio. `criarBlocoDeMutantes` muta uma copia
// em diretorio temporario, entao nem SIGKILL suja a arvore -- e de brinde roda
// num processo so, reparseando apenas o arquivo mutado.
//
// O MUTANTE QUE NAO ESTA NA LISTA, e a ausencia dele e a medicao mais util deste
// arquivo: trocar `aoTentarDeNovo={() => carregar(true)}` por
// `aoTentarDeNovo={carregar}`. Ele SOBREVIVE -- 42 passa, 0 falha, medido em
// 2026-10-21 -- e sobrevive estando CERTO, que e o unico motivo legitimo para um
// mutante ficar de fora. A faixa liga a prop direto no `onClick`, entao o React
// passa o `MouseEvent` como primeiro argumento, e um evento e VERDADEIRO:
// `semCopia` chega truthy e a tela destranca igual, por acidente.
//
// Isso NAO absolve aquela forma, e e por isso que a medicao vale mais que o
// veredito: ela acerta o lado do BOTAO e estraga o lado das ACOES, onde toda
// releitura (confirmar, editar, excluir, pagar) passaria a furar o cache e a
// apagar a leitura offline da tela. Quem mede esse lado e o mutante 2 ("fura
// sempre"), e ele morre. A fiacao do botao esta presa por DOIS casos que se
// cruzam, e nenhum deles e o `includes` da URL sozinho.
//
// (A `main` de antes do conserto nao era essa forma: la `carregar` nao tinha
// parametro nenhum e a URL nunca levava o `semCopia`. Quem reproduz aquilo e o
// mutante 1, e ele morre.)
//
// Nao entra no CI: ele roda a suite, nao o mutador. Isto e a conferencia de
// quem escreve o teste, antes de confiar nele.
// =====================================================

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const ALVO = "components/movimentacoes/ListaDeMovimentacao.tsx";
const SUITE = "test:lista-na-tela";

// Lido da arvore de verdade, que e o original por construcao: nada mais aqui
// escreve nela.
const original = readFileSync(ALVO, "utf8");

// A linha que monta a querystring. Ela e o alvo de dois mutantes GEMEOS -- "nao
// fura quando pedem" e "fura sempre" -- e os dois sao necessarios: o conserto
// tem duas metades que se parecem com uma so.
const LINHA_DO_PARAMETRO =
  '      semCopia ? `&${PARAM_SEM_COPIA}=${Date.now()}` : ""';

const mutantes = [
  [
    "1. a FEATURE DESFEITA: a URL nunca leva o parametro (= a `main` de antes)",
    LINHA_DO_PARAMETRO,
    '      ""',
  ],
  [
    "2. FURA SEMPRE: toda releitura apaga a leitura offline da tela",
    LINHA_DO_PARAMETRO,
    "      `&${PARAM_SEM_COPIA}=${Date.now()}`",
  ],
  [
    "3. o botao da faixa perde o `true` e volta a nao destrancar nada",
    "aoTentarDeNovo={() => carregar(true)}",
    "aoTentarDeNovo={() => carregar()}",
  ],
  [
    "4. o Atualizar que falha volta a APAGAR a lista do aparelho",
    `      if (semCopia && !leitura.dados) {
        toast.error(
          "Não deu para atualizar agora. Os números continuam sendo os do aparelho."
        );
        setCarregando(false);
        return;
      }`,
    "",
  ],
  [
    "5. o Atualizar que falha fica CALADO (a guarda fica, o aviso sai)",
    `        toast.error(
          "Não deu para atualizar agora. Os números continuam sendo os do aparelho."
        );`,
    "",
  ],
  [
    "6. o so-leitura nunca desliga -- os botoes ficam apagados com rede",
    '  const online = estado === "fresco";',
    "  const online = false;",
  ],
  [
    "7. a PRIMEIRA carga passa a furar o cache (nao ha leitura offline)",
    "    carregar();\n  }, [carregar]);",
    "    carregar(true);\n  }, [carregar]);",
  ],
];

const bloco = criarBlocoDeMutantes({
  rotulo: "atualizar-da-faixa",
  suites: [SUITE],
});

// A sombra vive em diretorio temporario, e a arvore rastreada nunca e mutada.
// O handler de sinal existe so para que nem o diretorio orfao sobre: `finally`
// nao roda em SIGTERM, mas `process.exit` dispara o `exit` abaixo.
process.on("exit", () => bloco.fechar());
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => process.exit(1));
}

// CONTROLE POSITIVO: a suite tem de estar VERDE no codigo intacto antes de
// qualquer mutante. Sem esta conferencia, uma suite quebrada por outro motivo
// mataria todos os mutantes de uma vez e o relatorio sairia perfeito. Ele passa
// pelo MESMO `rodar` dos mutantes, entao pega erro no proprio aparelho.
console.log("controle: a suite no codigo intacto...");
const controle = bloco.rodar("controle", {}, SUITE);
if (!controle.verde) {
  console.error(
    `A suite JA esta vermelha sem mutante nenhum (${controle.como}) -- conserte isso antes.\n` +
      controle.saida
  );
  process.exit(1);
}
console.log("OK   verde no codigo intacto\n");

let sobreviventes = 0;

for (const [nome, de, para] of mutantes) {
  // CADA EDICAO SE AUTO-VERIFICA, por CONTAGEM e nao por `includes`. Duas
  // falhas diferentes moram aqui, e as duas sairiam como "morto":
  //
  //   - ancora MORTA (0x): o trecho mudou de forma, o `replace` nao acha nada,
  //     e a suite fica verde por nunca ter sido mexida;
  //   - ancora AMBIGUA (2x+): `replace` troca a PRIMEIRA ocorrencia, e os
  //     arquivos consertados sao justamente os que citam o defeito em PROSA --
  //     uma ancora que casasse no comentario mutaria um lugar que o `nome` nao
  //     descreve, e o relatorio mentiria sobre qual decisao foi medida.
  //
  // As duas contam como SOBREVIVENTE, de proposito: o placar nao pode premiar
  // um mutante que nao existiu.
  const vezes = original.split(de).length - 1;
  if (vezes !== 1) {
    console.log(
      `??   ${nome}: ancora ${vezes === 0 ? "MORTA" : "AMBIGUA"} (${vezes}x)`
    );
    sobreviventes++;
    continue;
  }

  const r = bloco.rodar(nome, { [ALVO]: original.replace(de, para) }, SUITE);
  const vermelho = !r.verde;

  console.log(`${vermelho ? "OK  " : "VIVO"} ${nome}`);
  if (!vermelho) {
    // Mutante que sobrevive emitindo byte identico nao e furo de assercao: e
    // mutante EQUIVALENTE, e nenhuma assercao do mundo o mataria. A distincao
    // vale porque a resposta certa para os dois casos e oposta.
    if (r.mudouASaida === false) {
      console.log("     (saida compilada identica a da arvore limpa: EQUIVALENTE)");
    }
    sobreviventes++;
  }
}

console.log(
  `\n${mutantes.length - sobreviventes}/${mutantes.length} mutantes mortos`
);
process.exit(sobreviventes === 0 ? 0 : 1);
