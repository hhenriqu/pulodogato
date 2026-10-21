#!/usr/bin/env node
// Prova de mutacao dos tres numeros da conversa -- HMO-465 (F2 da HMO-462).
//
//   node scripts/mutantes-saldo-da-conversa.mjs
//
// Cada entrada estraga UM dos filtros ou UMA decisao de sinal; `npm run
// test:saldo-da-conversa` tem de ficar VERMELHA em todas. Mutante que sobrevive
// e um trecho que nenhuma assercao distingue.
//
// OS QUATRO QUE A ISSUE NOMEIA SAO OS QUATRO PRIMEIROS DA LISTA
// -------------------------------------------------------------
//   1. `!== false` -> `=== true` (o "eq.false" da issue: perde a linha antiga)
//   2. o `group_id IS NULL` SAI
//   3. o sinal da despesa
//   4. mes corrente -> horizonte aberto
//
// Se qualquer um dos quatro sobrevive, nenhum outro compensa -- a suite nao
// estaria medindo a feature que a issue pediu.
//
// POR QUE ESTES, E POR QUE NENHUM DELES DA ERRO EM LUGAR NENHUM
// -------------------------------------------------------------
// Nao existe excecao, 500, CHECK violado nem tela em branco em NENHUM destes
// mutantes. Todos os quatro deixam a conversa mostrando tres numeros bem
// formatados, e so quem somar na mao descobre. E a familia de defeito que este
// repositorio ja pagou duas vezes (HMO-290, HMO-187), e e por isso que esta
// feature tem runner em vez de leitura de codigo:
//
//   1. a coluna e NOT NULL no banco, entao `=== true` e `!== false` dao o MESMO
//      resultado em toda linha que vem do Postgres. A diferenca so aparece na
//      linha que vem do CACHE OFFLINE sem o campo -- e ai o saldo fica menor,
//      offline, para quem nao tem como conferir. Um mutante que so o banco
//      distingue sobreviveria a qualquer suite que nao tenha o caso do cache;
//   2. a perna de grupo e linha de verdade com o `user_id` DELA. Sem o filtro o
//      gasto cresce, e o numero continua plausivel -- ela gastou mesmo aquilo,
//      so nao sozinha;
//   3. `gastei` vira NEGATIVO, e `ganhei - gastei` passa a SOMAR as pernas. Os
//      dois primeiros numeros da tela ficam certos e o terceiro erra: 2000,
//      1000 e saldo 3000;
//   4. o horizonte aberto nao erra nenhuma linha -- ele erra o PERIODO. O saldo
//      cresce para sempre e nunca reinicia, e no primeiro mes de uso ele da
//      exatamente o mesmo numero que o certo.
//
// A FORMA DA LISTA E A DA FAMILIA TUPLA DE ARIDADE 4
// -------------------------------------------------
// `scripts/mede-ancora-ambigua.mjs` -- a guarda que reprova ancora morta,
// ambigua ou de arquivo inexistente em TODO runner do repo -- le a lista de
// verdade usando o recorte de `converte-mutantes-em-bloco.mjs`. Ele exige a
// tupla `[ALVO, rotulo, de, para]` e que nenhuma `const` MULTILINHA seja
// declarada antes da lista: o recorte corta ate o proximo `\n];`, e um `const
// original = new Map(...)` multilinha ali levaria a lista inteira embora. Por
// isso o `original` e montado DEPOIS da lista, e so a `const LIB` de uma linha
// vem antes.
//
// AS ANCORAS SAO LINHAS INTEIRAS, COM INDENTACAO
// ----------------------------------------------
// O cabecalho da lib CITA os proprios criterios na prosa (`include_in_total !==
// false`, `group_id IS NULL`, `ganhei - gastei`, `Math.abs()`), e uma ancora
// curta mutaria o COMENTARIO e deixaria o codigo intacto -- com o placar dizendo
// "sobreviveu" sobre um mutante que nunca existiu. A trava de ocorrencia unica
// abaixo pega isso, mas a defesa barata e a ancora carregar `linha.`, o `&&` e a
// margem, que a prosa nao tem.
//
// NENHUM MUTANTE E CONSTANTE DOBRAVEL
// -----------------------------------
// `if (false) continue;` seria a forma obvia do mutante 8, e o tsc a reprovaria
// por codigo inalcancavel -- morte no COMPILADOR, nao na assercao, que prova
// menos. Por isso ele troca a condicao por `=== Infinity`, que e falsa para NaN
// sem ser constante.

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const LIB = "lib/saldo-da-conversa.ts";

/** [alvo, rotulo, de, para] */
const mutantes = [
  // =========================================================================
  // OS QUATRO QUE A ISSUE NOMEIA
  // =========================================================================

  [
    LIB,
    "1. `!== false` VIRA `=== true`: a linha sem o campo (cache offline, banco pre-060) sai da soma",
    "      linha.include_in_total !== false &&",
    "      linha.include_in_total === true &&",
  ],

  [
    LIB,
    "2. o `group_id IS NULL` SAI: a perna de grupo do custo pessoal dela entra em gastei",
    "      (linha.group_id ?? null) === null &&",
    "      true &&",
  ],

  [
    LIB,
    "3. o SINAL da despesa: sem o Math.abs, gastei fica negativo e o saldo SOMA as pernas",
    "    const centavos = Math.round(Math.abs(Number(linha.amount)) * 100);",
    "    const centavos = Math.round(Number(linha.amount) * 100);",
  ],

  [
    LIB,
    "4. MES CORRENTE vira HORIZONTE ABERTO: o saldo passa a crescer para sempre",
    "  return dia >= mes.de && dia <= mes.ate;",
    '  return dia >= "0000-00-00";',
  ],

  // =========================================================================
  // E OS OUTROS CINCO, UM POR DECISAO QUE SOBROU
  // =========================================================================

  [
    LIB,
    "5. o saldo SOMA em vez de subtrair: 2000 e 1000 certos, saldo 3000",
    "    saldo: (ganhei - gastei) / 100,",
    "    saldo: (ganhei + gastei) / 100,",
  ],

  [
    LIB,
    "6. o ROTULO das pernas trocado: o saldo continua 1000 e `ganhei` desaba para 1000",
    '    if (linha.transaction_type === "income") ganhei += centavos;',
    '    if (linha.transaction_type === "expense") ganhei += centavos;',
  ],

  [
    LIB,
    "7. um `else` no lugar do 2o `if`: transferencia e tipo NULO viram gasto fantasma",
    '    else if (linha.transaction_type === "expense") gastei += centavos;',
    "    else gastei += centavos;",
  ],

  [
    LIB,
    "8. a guarda do `amount` invalido sai: um NaN envenena os TRES numeros de uma vez",
    "    if (!Number.isFinite(centavos)) continue;",
    "    if (centavos === Infinity) continue;",
  ],

  [
    LIB,
    "9. o `select` volta a NOMEAR as colunas: 42703 em todo banco sem a 060 colada",
    'export const COLUNAS_DA_CONVERSA = "*";',
    'export const COLUNAS_DA_CONVERSA = "transaction_type,amount,transaction_date,group_id,include_in_total";',
  ],
];

const SUITE = "test:saldo-da-conversa";

const bloco = criarBlocoDeMutantes({
  suites: [SUITE],
  rotulo: "saldo-da-conversa",
});

// Lido da arvore de verdade, que e o original por construcao: nada mais aqui
// escreve nela. Montado DEPOIS da lista -- ver A FORMA DA LISTA, no cabecalho.
const original = new Map();
for (const arquivo of new Set(mutantes.map(([alvo]) => alvo))) {
  original.set(arquivo, readFileSync(arquivo, "utf8"));
}

// CONTROLE POSITIVO: a arvore limpa tem de passar. Sem ele, uma suite ja
// vermelha deixaria TODO mutante aparecendo como morto e o placar sairia cheio
// sem medir nada -- `suite-vermelha-faz-todo-controle-negativo-passar-vacuo`.
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
  // risco e concreto neste arquivo -- o cabecalho da lib CITA os quatro
  // criterios na prosa.
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
