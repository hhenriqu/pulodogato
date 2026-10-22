#!/usr/bin/env node
// =====================================================
// PULODOGATO - MUTACOES DO "ATUALIZAR" DAS SETE TELAS (HMO-477)
// =====================================================
//   node scripts/mutantes-atualizar-nas-cinco-telas.mjs
//
// Estraga a fiacao do botao "Atualizar" de um jeito por vez e exige que
// `npm run test:offline-leitura` fique VERMELHA.
//
// POR QUE ESTE RUNNER EXISTE, e nao e zelo repetido do da HMO-457:
// `mutantes-atualizar-da-faixa.mjs` mede UMA tela
// (`ListaDeMovimentacao.tsx`) contra a suite que renderiza aquela tela e
// clica no botao. Esse e o oraculo forte, e ele nao escala: as outras seis
// telas nao tem sonda de render, e escrever seis delas custaria mais do que
// o defeito.
//
// O que a HMO-477 pos no lugar foi uma guarda TEXTUAL sobre as sete
// (`test:offline-leitura`), e guarda textual e exatamente o tipo de assercao
// que passa verde medindo nada: um `includes` que casa no COMENTARIO, uma
// ancora que casa no `import` em vez da chamada, um laco que itera uma lista
// vazia. Nenhuma dessas falhas aparece no placar -- a suite diz "27 pass" nos
// quatro casos.
//
// Entao o que este arquivo mede nao e o codigo: e a GUARDA. Cada mutante aqui
// reproduz um estado que ja existiu neste repositorio (ou que a HMO-477
// consertou), e o veredito util e "a guarda viu?".
//
// DOIS FUROS QUE ESTE RUNNER JA PEGOU, e os dois estavam verdes:
//
//   1. a assercao do aviso ancorava no NOME (`AVISO_ATUALIZAR_FALHOU`), que
//      aparece na linha de `import`. O mutante 8 ("o aviso fica calado") apaga
//      so a linha do `toast.error` e SOBREVIVIA: o import seguia la, a guarda
//      seguia verde, e a tela tinha perdido o aviso. Hoje a ancora e a
//      chamada;
//   2. a mesma assercao nao cobrava o `id`, e sem ele as duas telas de cartoes
//      empilham dois avisos iguais por clique.
//
// A SOMBRA EM /tmp, E NAO A ARVORE (HMO-327): `criarBlocoDeMutantes` muta uma
// copia em diretorio temporario, entao nem SIGKILL suja a arvore. Ver o
// cabecalho de `mutantes-em-bloco.mjs`.
//
// Nao entra no CI: ele roda a suite, nao o mutador.
// =====================================================

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const SUITE = "test:offline-leitura";

/**
 * As sete telas e o nome da funcao que o botao da faixa chama.
 *
 * MESMA tabela do `TELAS_COM_ATUALIZAR` da suite, de proposito: se a suite
 * deixar uma tela de fora, o mutante daquela tela sobrevive e aparece aqui.
 * Uma lista que fosse derivada da outra esconderia justamente esse caso.
 */
const TELAS = [
  ["fluxo de caixa", "app/(dashboard)/dashboard/cash-flow/page.tsx", "carregar"],
  [
    "movimentacao",
    "components/movimentacoes/ListaDeMovimentacao.tsx",
    "carregar",
  ],
  ["contas a pagar", "app/(dashboard)/dashboard/bills/page.tsx", "carregar"],
  ["cartoes", "app/(dashboard)/dashboard/cartoes/page.tsx", "recarregar"],
  ["um cartao", "app/(dashboard)/dashboard/cartoes/[id]/page.tsx", "recarregar"],
  ["recorrencias", "app/(dashboard)/dashboard/recurrences/page.tsx", "carregar"],
  ["contas", "app/(dashboard)/dashboard/contas/page.tsx", "carregar"],
];

/** Os sete arquivos QUE LEEM, e o nome da leitura que governa a tela. */
const LEITORES = [
  ["fluxo de caixa", "app/(dashboard)/dashboard/cash-flow/page.tsx", "leitura"],
  [
    "movimentacao",
    "components/movimentacoes/ListaDeMovimentacao.tsx",
    "leitura",
  ],
  ["contas a pagar", "app/(dashboard)/dashboard/bills/page.tsx", "agenda"],
  ["cartoes", "app/(dashboard)/dashboard/cartoes/page.tsx", "leitura"],
  ["um cartao", "app/(dashboard)/dashboard/cartoes/[id]/page.tsx", "leitura"],
  ["recorrencias", "app/(dashboard)/dashboard/recurrences/page.tsx", "leitura"],
  ["o hook das contas", "lib/hooks/useContas.ts", "leitura"],
];

const LIB = "lib/offline-leitura.ts";

/** `[nome, arquivo, de, para]` */
const mutantes = [];

// -------------------------------------------------------------------------
// DECISAO 1: o botao da faixa pede a leitura SEM a copia
// -------------------------------------------------------------------------
// O defeito da issue, tela por tela. Sem o `true` a releitura volta da MESMA
// copia do NetworkFirst (sete dias): mesma faixa, mesmo momento, nada muda.
for (const [rotulo, arquivo, leitor] of TELAS) {
  mutantes.push([
    `1.${rotulo}: a faixa perde o \`true\` (= o estado de antes da HMO-477)`,
    arquivo,
    `aoTentarDeNovo={() => ${leitor}(true)}`,
    `aoTentarDeNovo={() => ${leitor}()}`,
  ]);
}

// -------------------------------------------------------------------------
// DECISAO 2: o handler vai dentro de uma SETA
// -------------------------------------------------------------------------
// `FaixaDadoDoAparelho` liga a prop direto no `onClick`, entao a forma por
// referencia chama o handler COM o `MouseEvent`. Um evento e truthy: a tela
// DESTRANCA igual, por acidente, e o estrago vai para o outro lado -- toda
// releitura (confirmar, pagar, arquivar) passa a furar o cache e a apagar a
// leitura offline. Nada na tela fica errado de olhar.
for (const [rotulo, arquivo, leitor] of TELAS) {
  mutantes.push([
    `2.${rotulo}: a seta sai e o \`MouseEvent\` vira \`semCopia\``,
    arquivo,
    `aoTentarDeNovo={() => ${leitor}(true)}`,
    `aoTentarDeNovo={${leitor}}`,
  ]);
}

// -------------------------------------------------------------------------
// DECISAO 3: um "Atualizar" que falha nao apaga o que esta na tela
// -------------------------------------------------------------------------
// A decisao que a issue mandou ler UMA A UMA. Nas sete o `if (leitura.dados)`
// ja protegia as VARIAVEIS -- e e por isso que seis delas passavam por
// consertadas -- mas quem governa o que se VE e o `estado`.
for (const [rotulo, arquivo, leitura] of LEITORES) {
  mutantes.push([
    `3.${rotulo}: o Atualizar que falha volta a APAGAR a tela`,
    arquivo,
    `if (semCopia && !${leitura}.dados) {`,
    "if (false) {",
  ]);
}

// O aviso, e o furo que este mutante pegou na propria guarda (ver o cabecalho).
mutantes.push([
  "4. o Atualizar que falha fica CALADO (a guarda fica, o aviso sai)",
  "lib/hooks/useContas.ts",
  "      toast.error(AVISO_ATUALIZAR_FALHOU, { id: ID_DO_AVISO_ATUALIZAR });",
  "",
]);

mutantes.push([
  "5. o aviso perde o `id` e dois avisos empilham por clique",
  "app/(dashboard)/dashboard/cartoes/page.tsx",
  "toast.error(AVISO_ATUALIZAR_FALHOU, { id: ID_DO_AVISO_ATUALIZAR });",
  "toast.error(AVISO_ATUALIZAR_FALHOU);",
]);

// -------------------------------------------------------------------------
// O SEPARADOR, que e a razao de `comSemCopia` existir
// -------------------------------------------------------------------------
mutantes.push([
  "6. SEPARADOR CRAVADO EM `&`: /api/recurrences vira outro CAMINHO (404)",
  LIB,
  '  return `${url}${url.includes("?") ? "&" : "?"}${PARAM_SEM_COPIA}=${agora}`;',
  "  return `${url}&${PARAM_SEM_COPIA}=${agora}`;",
]);

mutantes.push([
  "7. SEPARADOR CRAVADO EM `?`: a querystring que a rota le se corrompe",
  LIB,
  '  return `${url}${url.includes("?") ? "&" : "?"}${PARAM_SEM_COPIA}=${agora}`;',
  "  return `${url}?${PARAM_SEM_COPIA}=${agora}`;",
]);

mutantes.push([
  "8. FURA SEMPRE: apaga a leitura offline das telas mais pesadas",
  LIB,
  "  if (!semCopia) return url;",
  "",
]);

mutantes.push([
  "9. NUNCA FURA: o botao Atualizar volta a nao mudar nada nas sete",
  LIB,
  "  if (!semCopia) return url;",
  "  if (true) return url;",
]);

mutantes.push([
  "10. a chave do cache fica FIXA: o segundo clique cai na copia do primeiro",
  LIB,
  "  agora: number = Date.now()",
  "  agora: number = 0",
]);

// A fiacao de uma tela que deixa de usar o helper -- a declaracao de
// `COMO_FURA` tem de reprovar, senao ela vira texto velho absolvendo qualquer
// coisa.
mutantes.push([
  "11. uma tela para de furar o cache (o helper sai da chamada)",
  "app/(dashboard)/dashboard/recurrences/page.tsx",
  "        comSemCopia(\n          `/api/recurrences${mostrarIgnoradas ? \"?status=all\" : \"\"}`,\n          semCopia\n        )",
  '        `/api/recurrences${mostrarIgnoradas ? "?status=all" : ""}`',
]);

const bloco = criarBlocoDeMutantes({
  rotulo: "atualizar-nas-sete-telas",
  suites: [SUITE],
});

process.on("exit", () => bloco.fechar());
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => process.exit(1));
}

// CONTROLE POSITIVO: a suite tem de estar VERDE no codigo intacto. Sem isto,
// uma suite quebrada por outro motivo mataria todos os mutantes de uma vez e o
// relatorio sairia perfeito sobre zero medicao.
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

for (const [nome, arquivo, de, para] of mutantes) {
  // Lido na volta, e nao uma vez no topo: sao onze arquivos diferentes.
  const original = readFileSync(arquivo, "utf8");

  // CADA EDICAO SE AUTO-VERIFICA, por CONTAGEM e nao por `includes`. Ancora
  // MORTA (0x) deixa a suite verde por nunca ter sido mexida; ancora AMBIGUA
  // (2x+) muta a PRIMEIRA ocorrencia, que nestes arquivos e justamente a que
  // cita o defeito EM PROSA -- o relatorio mentiria sobre o que foi medido.
  // As duas contam como SOBREVIVENTE: o placar nao premia mutante que nao
  // existiu.
  const vezes = original.split(de).length - 1;
  if (vezes !== 1) {
    console.log(
      `??   ${nome}: ancora ${vezes === 0 ? "MORTA" : "AMBIGUA"} (${vezes}x) em ${arquivo}`
    );
    sobreviventes++;
    continue;
  }

  const r = bloco.rodar(nome, { [arquivo]: original.replace(de, para) }, SUITE);
  const vermelho = !r.verde;

  console.log(`${vermelho ? "OK  " : "VIVO"} ${nome}`);
  if (!vermelho) {
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
