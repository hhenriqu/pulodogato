#!/usr/bin/env node
// Prova de mutacao da parte de grupo no CSV de relatorio (HMO-207).
//
//   node scripts/mutantes-parte-do-grupo-no-csv.mjs
//
// Cada entrada estraga uma decisao; `npm run test:parte-do-grupo-no-csv` tem
// que ficar VERMELHA. Mutante que sobrevive e um trecho que nenhuma assercao
// distingue.
//
// O MUTANTE QUE A ISSUE PEDE PELO NOME
// ------------------------------------
// "trocar a view nova pela antiga tem que MATAR a assercao -- se nao matar, a
// assercao esta medindo outra coisa". Sao os dois primeiros da lista, e eles
// cobrem o caso em DUAS versoes que falham de modos diferentes:
//
//   * `A VIEW NOVA VOLTA A SER A ANTIGA` troca so o nome da view. A consulta
//     continua com `eq("user_id")` e SEM filtro de grupo, entao o CSV passa a
//     trazer o valor CHEIO do jantar (360) onde a tela mostra a parte (180);
//   * `O ESTADO DE ANTES DA HMO-207` troca o nome E devolve o
//     `is("group_id", null)`. E literalmente o codigo de `origin/main`: a linha
//     de dolar desaparece do arquivo, que foi a medicao de producao.
//
// O primeiro erra o numero PARA MAIS e o segundo o apaga. Uma assercao que so
// conferisse "existe linha de USD" mataria o segundo e deixaria o primeiro
// passar -- e e por isso que a suite compara com a resposta da TELA.
//
// O `eq("user_id")` TEM DOIS MUTANTES, E ELES SO MORREM PELA DUPLICATA
// -------------------------------------------------------------------
// As views da 033 nao filtram `user_id`. Apagar o filtro traz a parte do outro
// membro -- mas o CSV nao agrega, entao o arquivo ganha uma SEGUNDA linha de
// USD com o mesmo 180,00 em vez de uma linha com 360,00. O total por moeda
// continua batendo com a tela, e um `new Map()` indexado por moeda guardaria a
// ultima linha sem reclamar. Quem mata estes dois e o `mapaSemDuplicata` da
// suite, que recusa chave repetida. Sem ele os dois sobreviveriam verdes.
//
// OS MUTANTES DOS RAMOS QUE NAO MUDARAM
// -------------------------------------
// `planned` e `transactions` continuam filtrando `group_id IS NULL` de
// proposito, e a razao esta escrita no fonte. Comentario nao e medida: os dois
// ultimos mutantes apagam o filtro e a secao 8 tem de reprovar. Sem eles, a
// decisao de NAO mexer naqueles ramos ficaria sem controle nenhum -- e o
// proximo a passar por ali "consertaria" os quatro por simetria de nome, que e
// exatamente o erro de leitura que esta issue existe para registrar.
//
// O CONTROLE POSITIVO VEM PRIMEIRO
// --------------------------------
// Se a suite ja estiver vermelha antes de qualquer mutacao -- ou se um
// `replace` nao casar --, todo mutante aparece como MORTO e o placar sai cheio
// sem ter medido nada.
//
// AS ANCORAS COMECAM COM `\n` DE PROPOSITO
// ----------------------------------------
// Os dois ramos desta rota sao quase o mesmo texto, e a unica coisa que separa
// a consulta principal (12 espacos de margem) da consulta de QUEDA (10 espacos)
// e a indentacao. Sem o `\n` na frente, a ancora de 10 espacos casa DENTRO da
// linha de 12 -- duas ocorrencias, e o `replace` muta a primeira, que e a que o
// rotulo nao descreve. A trava de ambiguidade abaixo pega isso, mas so depois
// de alguem perder tempo; o `\n` evita o problema.
//
// A FORMA DA LISTA E A DA FAMILIA TUPLA DE ARIDADE 4, E ISSO NAO E ESTILO
// -----------------------------------------------------------------------
// `scripts/mede-ancora-ambigua.mjs` -- a guarda que reprova ancora morta,
// ambigua ou de arquivo inexistente em TODO runner do repo -- le a lista de
// verdade em vez de a copiar, e so sabe ler duas formas. Dai a ordem
// `[ALVO, rotulo, de, para]` e o `original` montado DEPOIS da lista.
import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const ROTA = "app/api/reports/export/route.ts";

const COLUNAS_DO_FLUXO =
  '.select("month, income, expense, net, transaction_count, currency")';

/** [alvo, rotulo, de, para] */
const mutantes = [
  // =========================================================================
  // O QUE A ISSUE PEDE PELO NOME: a view nova trocada pela antiga
  // =========================================================================
  [
    ROTA,
    "A VIEW NOVA VOLTA A SER A ANTIGA no fluxo de caixa (o CSV passa a trazer o valor CHEIO)",
    '\n            .from("personal_monthly_cash_flow")',
    '\n            .from("monthly_cash_flow")',
  ],
  [
    ROTA,
    "O ESTADO DE ANTES DA HMO-207 no fluxo de caixa (a linha de USD desaparece)",
    `\n            .from("personal_monthly_cash_flow")\n            ${COLUNAS_DO_FLUXO}\n            .eq("user_id", user.id)\n`,
    `\n            .from("monthly_cash_flow")\n            ${COLUNAS_DO_FLUXO}\n            .eq("user_id", user.id)\n            .is("group_id", null)\n`,
  ],
  [
    ROTA,
    "A VIEW NOVA VOLTA A SER A ANTIGA nas categorias (valor CHEIO por categoria)",
    '\n            .from("personal_category_monthly_totals")',
    '\n            .from("category_monthly_totals")',
  ],
  [
    ROTA,
    "O ESTADO DE ANTES DA HMO-207 nas categorias (a linha USD/Alimentação desaparece)",
    '\n            .from("personal_category_monthly_totals")',
    '\n            .from("category_monthly_totals")\n            .is("group_id", null)',
  ],

  // =========================================================================
  // O `eq("user_id")` E LOAD-BEARING: sem ele vem a parte dos OUTROS membros
  // =========================================================================
  [
    ROTA,
    'o fluxo pessoal perde o `eq("user_id")`: entra a parte dos outros membros',
    `\n            .eq("user_id", user.id)\n            .gte("month", janela.inicio)\n            .lte("month", janela.fim);`,
    `\n            .gte("month", janela.inicio)\n            .lte("month", janela.fim);`,
  ],
  [
    ROTA,
    'as categorias pessoais perdem o `eq("user_id")`: entra a parte dos outros',
    '\n            .eq("user_id", user.id);',
    ";",
  ],

  // =========================================================================
  // O CAMINHO DE GRUPO NAO PODE TER SIDO TROCADO JUNTO
  // =========================================================================
  [
    ROTA,
    "o painel DO GRUPO passa a ler a view pessoal (perde o valor cheio da viagem)",
    '\n            .from("monthly_cash_flow")',
    '\n            .from("personal_monthly_cash_flow")',
  ],

  // =========================================================================
  // A QUEDA DA JANELA DE COLAGEM: ela tem de existir e tem de ser ESTREITA
  // =========================================================================
  [
    ROTA,
    "a queda para a view antiga DESAPARECE (banco sem a 033 entrega CSV vazio)",
    "      if (error && !groupId && viewDaParteAusente(error)) {\n        const antiga = await supabase\n          .from(\"monthly_cash_flow\")",
    "      if (false && error && !groupId && viewDaParteAusente(error)) {\n        const antiga = await supabase\n          .from(\"monthly_cash_flow\")",
  ],
  [
    ROTA,
    "a queda ENGOLE ERRO DE VERDADE: 42501 de RLS vira numero velho em silencio",
    "      if (error && !groupId && viewDaParteAusente(error)) {\n        const antiga = await supabase\n          .from(\"monthly_cash_flow\")",
    "      if (error && !groupId) {\n        const antiga = await supabase\n          .from(\"monthly_cash_flow\")",
  ],

  // =========================================================================
  // OS RAMOS QUE NAO MUDARAM: a decisao de nao mexer tambem precisa de controle
  // =========================================================================
  [
    ROTA,
    "`planned` perde o `group_id IS NULL` e passa a discordar de /api/reports/planned-vs-actual",
    '        : q.is("group_id", null)',
    "        : q",
  ],
  [
    ROTA,
    "o EXTRATO perde o `group_id IS NULL` (dobraria a despesa de grupo)",
    '\n            .is("group_id", null)',
    "",
  ],
];

const SUITE = "test:parte-do-grupo-no-csv";

const bloco = criarBlocoDeMutantes({
  suites: [SUITE],
  rotulo: "parte-do-grupo-no-csv",
});

// Lido da arvore de verdade, que e o original por construcao: nada mais aqui
// escreve nela. Montado DEPOIS da lista -- ver A FORMA DA LISTA, no cabecalho.
const original = new Map();
for (const arquivo of new Set(mutantes.map(([alvo]) => alvo))) {
  original.set(arquivo, readFileSync(arquivo, "utf8"));
}

// CONTROLE POSITIVO: a arvore limpa tem de passar. Ver o cabecalho.
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
  // um `de` que aparece duas vezes muta um lugar que o rotulo nao descreve, e o
  // mutante passa a medir outra feature. E o risco concreto deste runner -- ver
  // AS ANCORAS COMECAM COM `\n`, no cabecalho.
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
