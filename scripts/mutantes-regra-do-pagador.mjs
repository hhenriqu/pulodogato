#!/usr/bin/env node
// Prova de mutacao da REGRA DO PAGADOR no previsto (HMO-363, F1 da HMO-360).
// Cada entrada estraga uma decisao de lib/regra-do-pagador.ts;
// `npm run test:regra-do-pagador` tem que ficar VERMELHA em todas. Mutante que
// sobrevive e um trecho que nenhum teste distingue, ou codigo morto.
//
//   node scripts/mutantes-regra-do-pagador.mjs
//
// Os tres que a issue nomeia estao no topo da lista, porque sao os que nao dao
// sintoma:
//
//   * `sem_dono` -- a regra para de olhar `user_id` e volta ao comportamento de
//     hoje. A tela diz R$ 300 num mes em que o meu cartao cobra R$ 1.000. O
//     numero sai formatado, a soma do mes fecha com ele, e o unico sintoma e a
//     fatura chegando maior do que o app previu;
//   * `dono_invertido` -- o mesmo erro trocado de lado: a conta da Leticia conta
//     bruto e a minha vira fracao. Os dois numeros existem no app, os dois sao
//     plausiveis, e nenhum `tsc` distingue;
//   * `sem_abs` -- a parte sai com o sinal da entrada. A lista pinta pelo SINAL
//     e formata com `Math.abs`, entao R$ -300 aparece como "R$ 300,00" EM VERDE,
//     como receita, e o previsto do mes CANCELA o realizado em vez de somar
//     (`group-share-entries-e-a-minha-parte`, pegadinha 1; secao 5 do plano).
//
// DOIS MUTANTES QUE NAO ESTAO AQUI, E POR QUE
// -------------------------------------------
// 1. `igualdade_frouxa` (`===` -> `==` em `euFrontoAConta`) e EQUIVALENTE:
//    `meuUserId` ja chega garantido string nao-vazia pelo guarda de cima, e
//    nenhum de `undefined`/`null`/`""` e `==` a uma string nao-vazia. Nenhum
//    teste pode mata-lo. Esta escrito aqui porque sobrevivente conhecido
//    omitido em silencio e indistinguivel de sobrevivente escondido.
// 2. `sem_guarda_do_campo_da_linha` nao existe porque o guarda nao existe: ele
//    era morto pela mesma razao (medido, 0 de 25 pares de entrada diferem) e foi
//    apagado em vez de ganhar teste. Ver o cabecalho de `euFrontoAConta`.
//
// AS TRAVAS QUE ESTE RUNNER NAO DISPENSA
// --------------------------------------
// 1. O TRECHO APARECE EXATAMENTE UMA VEZ. `String.replace` com string troca a
//    PRIMEIRA ocorrencia: um alvo que aparece duas vezes muta um lugar que o
//    rotulo nao descreve, e a linha de saida passa a mentir sobre o que mediu.
// 2. A SUITE ESTA VERDE ANTES. Suite ja vermelha faz todo mutante "morrer" sem
//    nada ter sido medido -- 100% de mortalidade com zero poder de deteccao.
// 3. A ARVORE RASTREADA NAO E TOCADA: `criarBlocoDeMutantes` espelha o repo em
//    diretorio temporario e muta so la, com uma compilacao por mutante e cache
//    de AST compartilhado. O pior caso de um processo morto e um diretorio orfao
//    em /tmp, e nao um `lib/*.ts` mutado parecendo trabalho em andamento.

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const REGRA = "lib/regra-do-pagador.ts";

const mutantes = [
  // -------------------------------------------------------------------------
  // OS TRES DA ISSUE
  // -------------------------------------------------------------------------
  [
    REGRA,
    "sem_dono: a regra para de olhar user_id e volta ao comportamento de hoje",
    "    if (euFrontoAConta(p.user_id, meuUserId)) return p;",
    "    if (euFrontoAConta(null, meuUserId)) return p;",
  ],
  [
    REGRA,
    "dono_invertido: a minha conta vira fracao e a da outra pessoa conta bruto",
    "    if (euFrontoAConta(p.user_id, meuUserId)) return p;",
    "    if (!euFrontoAConta(p.user_id, meuUserId)) return p;",
  ],
  [
    REGRA,
    "sem_abs: a parte sai com o sinal da entrada (negativo pinta como receita)",
    "      amount: Math.abs(\n        parteConfiguradaDoMembro",
    "      amount: (\n        parteConfiguradaDoMembro",
  ],

  // -------------------------------------------------------------------------
  // A LINHA PESSOAL -- o cuidado que a funcao de hoje ja tem
  // -------------------------------------------------------------------------
  [
    REGRA,
    "a linha pessoal e recriada e o amount vira number (a string do PostgREST)",
    "    if (!p.group_id) return p;",
    "    if (!p.group_id) return { ...p, amount: Number(p.amount) || 0 };",
  ],
  [
    REGRA,
    "group_id nulo deixa de sair cedo e a despesa pessoal entra no rateio",
    "    if (!p.group_id) return p;",
    "    if (p.group_id === undefined) return p;",
  ],

  // -------------------------------------------------------------------------
  // O VISITANTE SEM ID
  // -------------------------------------------------------------------------
  [
    REGRA,
    "o visitante de id VAZIO passa a ser tratado como pessoa conhecida",
    '    if (typeof meuUserId !== "string" || meuUserId === "") return p;',
    '    if (typeof meuUserId !== "string") return p;',
  ],
  [
    REGRA,
    "sem saber quem sou eu a lista passa a ser rateada e rotulada do mesmo jeito",
    '    if (typeof meuUserId !== "string" || meuUserId === "") return p;',
    '    if (meuUserId === "nunca") return p;',
  ],
  [
    REGRA,
    "euFrontoAConta aceita o par de ausencias (undefined === undefined)",
    '  if (typeof meuUserId !== "string" || meuUserId === "") return false;',
    '  if (meuUserId === "nunca") return false;',
  ],

  // -------------------------------------------------------------------------
  // A FRACAO
  // -------------------------------------------------------------------------
  [
    REGRA,
    "a parte deixa de ser calculada e a linha da outra pessoa conta bruto",
    "        parteConfiguradaDoMembro(p.amount ?? 0, p.group_id, pesosPorGrupo, meuUserId)",
    "        Number(p.amount ?? 0)",
  ],
  [
    REGRA,
    "a divisao passa a ser pedida no nome de QUEM LANCOU, e nao no meu",
    "        parteConfiguradaDoMembro(p.amount ?? 0, p.group_id, pesosPorGrupo, meuUserId)",
    "        parteConfiguradaDoMembro(p.amount ?? 0, p.group_id, pesosPorGrupo, p.user_id)",
  ],

  // -------------------------------------------------------------------------
  // O DESTINATARIO -- o insumo do rotulo da F2
  // -------------------------------------------------------------------------
  [
    REGRA,
    "pagar_para nunca sabe para quem (a conta da outra pessoa se le como propria)",
    '      pagar_para:\n        typeof p.user_id === "string" && p.user_id !== "" ? p.user_id : null,',
    "      pagar_para: null,",
  ],
  [
    REGRA,
    "pagar_para aponta para mim ('pagar para voce')",
    '      pagar_para:\n        typeof p.user_id === "string" && p.user_id !== "" ? p.user_id : null,',
    "      pagar_para: meuUserId,",
  ],
  [
    REGRA,
    "o dono ilegivel vira pagar_para UNDEFINED, que se le como 'nao se aplica'",
    '      pagar_para:\n        typeof p.user_id === "string" && p.user_id !== "" ? p.user_id : null,',
    "      pagar_para: p.user_id as string,",
  ],

  // -------------------------------------------------------------------------
  // O ROTULO QUE SOBREVIVE NO OBJETO
  // -------------------------------------------------------------------------
  [
    REGRA,
    "o group_id morre na saida (a conta de grupo perde o rotulo e vira bug)",
    "      ...p,",
    "      ...p,\n      group_id: null,",
  ],
];

const SUITE = "test:regra-do-pagador";

const bloco = criarBlocoDeMutantes({ rotulo: "regra-do-pagador", suites: [SUITE] });

// A sombra vive em diretorio temporario e a arvore rastreada nunca e mutada. O
// handler de sinal existe so para que nem o diretorio orfao sobre: o fim do laco
// nao roda em SIGTERM, mas `process.exit` dispara o `exit` abaixo.
process.on("exit", () => bloco.fechar());
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => process.exit(1));
}

// O texto de cada arquivo que algum mutante toca. Lido da arvore de verdade, que
// e o original por construcao: nada mais aqui escreve nela. Montado DEPOIS da
// lista, pelos alvos distintos dela -- `const` multilinha declarada ANTES da
// lista faz o recorte de `mede-ancora-ambigua.mjs` levar a lista inteira e a
// guarda de ancora morrer com a main vermelha para todos.
const original = new Map();
for (const arquivo of new Set(mutantes.map(([alvo]) => alvo))) {
  original.set(arquivo, readFileSync(arquivo, "utf8"));
}

// CONTROLE POSITIVO: a arvore INTACTA tem de passar antes de qualquer mutante, e
// pelo MESMO `rodar` que os mutantes usam -- por isso ele pega erro no aparelho.
// Sem ele, uma sombra mal montada reprova TODO mutante e o placar sai "N/N
// mortos" sobre zero assercoes executadas.
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

  // AS TRES TRAVAS DE ANCORA. `String.replace` troca a PRIMEIRA ocorrencia, e um
  // `de` que aparece duas vezes muta um lugar que o rotulo nao descreve.
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
