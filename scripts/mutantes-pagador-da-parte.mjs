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
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

import { protegerArvore } from "./auto-cura-de-mutante.mjs";

const LIB = "lib/parte-de-grupo-na-lista.ts";
const LINHA = "components/movimentacoes/LinhaDaParteDeGrupo.tsx";

// Os originais vem do helper, e nao de `readFileSync` aqui, para a leitura
// acontecer DEPOIS da auto-cura -- ver o contrato de ordem no cabecalho dele.
const { originais, encerrar } = protegerArvore({
  runner: "pagador-da-parte",
  arquivos: [LIB, LINHA],
});
const fontes = new Map(Object.entries(originais));

const SUITE = "npm run test:pagador-da-parte";

function suiteVermelha() {
  try {
    execSync(SUITE, { stdio: "pipe" });
    return false;
  } catch {
    return true;
  }
}

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

// -------------------------------------------------------------------------
// Controle: a suite tem que estar VERDE antes de qualquer mutacao.
// -------------------------------------------------------------------------
console.log("conferindo a suite sem mutacao...");
if (suiteVermelha()) {
  console.error(
    "A suite JA esta vermelha. Todo mutante 'morreria' sem medir nada -- " +
      "conserte a suite antes de rodar esta prova."
  );
  process.exit(2);
}
console.log("suite verde. comecando.\n");

let sobreviventes = 0;

for (const [alvo, nome, de, para] of mutantes) {
  const original = fontes.get(alvo);

  // Trava 1: o trecho tem que existir, e exatamente uma vez. Um `replace` que
  // nao casa sai sem erro e a suite fica verde por nao ter sido mexida -- o
  // mutante seria dado por morto medindo nada. Duas ocorrencias sao piores:
  // muta a primeira, que nao e a anunciada.
  const vezes = original.split(de).length - 1;
  if (vezes !== 1) {
    console.log(
      `??  ${nome}: o trecho aparece ${vezes}x (esperado 1) -- mutante desatualizado`
    );
    sobreviventes++;
    continue;
  }

  const mutado = original.replace(de, para);
  if (mutado === original) {
    console.log(`??  ${nome}: a troca nao mudou o arquivo -- mutante inerte`);
    sobreviventes++;
    continue;
  }

  writeFileSync(alvo, mutado);
  const vermelho = suiteVermelha();
  writeFileSync(alvo, original);

  // Trava 2: restaurou de verdade. Um fonte deixado mutado contamina todo
  // mutante seguinte e, pior, fica no worktree depois do script sair.
  if (readFileSync(alvo, "utf8") !== original) {
    console.error(`\nFALHA: ${alvo} nao voltou ao original. Pare e confira.`);
    process.exit(3);
  }

  console.log(`${vermelho ? "OK  " : "VIVO"} ${nome}`);
  if (!vermelho) sobreviventes++;
}

// Restaurar os dois fontes e a ultima coisa que este script faz. `process.exit`
// dentro de um try pularia qualquer finally e deixaria o worktree MUTADO.
encerrar();

console.log(`\n${mutantes.length - sobreviventes}/${mutantes.length} mutantes mortos`);
process.exit(sobreviventes === 0 ? 0 : 1);
