#!/usr/bin/env node
// Prova de mutacao das sete somas em JavaScript que honram `include_in_total`
// (HMO-453, F3 da HMO-443).
//
//   node scripts/mutantes-fora-dos-totais-nas-somas.mjs
//
// Cada entrada estraga UM filtro novo; a suite indicada tem que ficar VERMELHA.
// Mutante que sobrevive e um trecho que nenhuma assercao distingue.
//
// POR QUE ESTE RUNNER EXISTE, DITO PELA ISSUE
// -------------------------------------------
// "mutante por cima de cada filtro novo. Um filtro de opt-out sem mutante e o
// caso tipico do sobrevivente que ninguem ve: o teste passa com o filtro
// APAGADO se a fixture nao tiver linha marcada." Toda fixture tocada por esta
// fase ganhou UMA linha marcada e UMA nao marcada justamente para que os
// mutantes abaixo tenham do que morrer -- e este arquivo e o que mede se isso
// de fato aconteceu.
//
// AS QUATRO FAMILIAS DE MUTANTE, E POR QUE CADA UMA
// -------------------------------------------------
//  1. O FILTRO APAGADO, um por sitio. E literalmente o estado de ANTES desta
//     issue, sitio por sitio. Se um deles sobrevive, aquela soma nao esta
//     medida e nenhum outro mutante compensa.
//  2. A POLARIDADE DO PREDICADO. `=== true`, `Boolean(...)` e
//     `!linha.include_in_total` no lugar do `!== false`. Os tres sao o MESMO
//     defeito escrito de tres formas, e ele e o pior desta feature: na janela
//     entre o deploy e a colagem -- e no cache offline -- o campo chega
//     `undefined`, e os tres fazem `undefined` significar "nao soma". O
//     relatorio inteiro esvazia, sem erro, sem log e com o tsc verde.
//  3. A COLUNA FORA DO `select`. O filtro em JS nao tem como funcionar se o
//     PostgREST nao trouxer o campo: ele chega `undefined`, `!== false` deixa
//     tudo passar, e o filtro vira no-op SEM que uma linha de codigo mude. E o
//     modo de falha de `nome-de-campo-errado-esconde-bug-de-dinheiro`, e no
//     duble ele e observavel porque o duble PROJETA so as colunas nomeadas.
//  4. O CONSERTO ZELOSO, que e pior que o defeito. Filtrar TAMBEM onde a secao
//     3c do plano mandou nao filtrar: dentro de `realizadoComCartaoPelaFatura`
//     (segundo filtro no mesmo caminho, sem mutante que morra) e nas CONTAGENS
//     de `resumoDaTela` (a frase "N lançamento(s)" passaria a discordar da
//     lista ao lado dela).
//
// O CONTROLE POSITIVO VEM PRIMEIRO
// --------------------------------
// Se a suite ja estiver vermelha antes de qualquer mutacao -- ou se um
// `replace` nao casar e o runner "mutar" nada --, todo mutante aparece como
// MORTO e o placar sai cheio sem ter medido nada. Por isso a arvore limpa roda
// antes, por SUITE, e cada `replace` confere que a ancora existe, que e UNICA e
// que o texto mudou.
//
// AS ANCORAS NAO PODEM CASAR NO COMENTARIO, E AQUI O RISCO E REAL
// ---------------------------------------------------------------
// Os sete arquivos EXPLICAM nos comentarios o que nao fazer, citando
// `=== true`, `!linha.include_in_total` e `!== false` por extenso -- e
// lib/fora-dos-totais.ts tem um bloco inteiro so sobre isso. Uma ancora curta
// casaria na prosa, o `replace` mutaria um comentario, o codigo ficaria intacto
// e o mutante "sobreviveria" sem nunca ter existido
// (`ancora-de-mutante-casa-no-comentario-e-o-cmp-nao-ve`). Dai as ancoras
// levarem a linha de codigo inteira, com a indentacao e o `;`.
//
// A TRAVA DE OCORRENCIA UNICA e o que fecha o resto: `String.replace` troca a
// PRIMEIRA ocorrencia, e o runner aborta quando a ancora aparece 0 ou 2+ vezes.

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const SOMAS = "test:fora-dos-totais-nas-somas";
const MOVIMENTACOES = "test:movimentacoes";
const TELAS = "test:telas-de-movimentacao";
const CATEGORIAS = "test:categorias-do-periodo";
const REALIZADO = "test:realizado-do-caixa";
const VARIAVEL = "test:variable-spend";

const DONO = "lib/fora-dos-totais.ts";
const MOV = "lib/movimentacoes.ts";
const TELA = "lib/telas-de-movimentacao.ts";
const CAT = "lib/categorias-do-periodo.ts";
const CAIXA = "lib/realizado-do-caixa.ts";
const VSPEND = "lib/variable-spend.ts";
const RESUMO_MENSAL = "lib/services/monthly-summary.ts";
const ROTA_FLUXO = "app/api/reports/cash-flow/route.ts";
const ROTA_CATEGORIAS = "app/api/reports/categories/route.ts";

/** A linha de codigo do predicado dono, com o `return` e o `;`. */
const PREDICADO = "  return linha.include_in_total !== false;";

/** O `for` de cada sitio, com a chamada que o mutante desliga. */
const FOR_MOV = "  for (const mov of apenasNosTotais(movimentacoes)) {";
const FOR_CAT = "  for (const t of apenasNosTotais(transacoes)) {";
const FOR_VSPEND = "  for (const t of apenasNosTotais(transacoes)) {";
const SOMA_DA_TELA = "    const soma = linha.soma_nos_totais !== false;";

const LACO_DA_ROTA =
  "        for (const linha of apenasNosTotais(\n" +
  "          lote as unknown as LinhaDoRealizado[]\n" +
  "        ))\n" +
  "          linhas.push(linha);";

const FILTRO_DO_RESUMO =
  "  const transacoes = apenasNosTotais(\n" +
  "    (data ?? []) as unknown as TransacaoParaAnomalia[]\n" +
  "  );";

const COLUNAS_MENSAL =
  '  "transaction_date, amount, transaction_type, category_id, description, include_in_total";';

const COLUNAS_CAIXA =
  '  "amount, transaction_type, currency, include_in_total, account:financial_accounts(account_type)";';

const SELECT_DAS_CATEGORIAS =
  '              : "category_id, amount, transaction_type, currency, include_in_total, account:financial_accounts(account_type)"';

const PROMOCAO_DO_CAIXA =
  "    if (ehCompraNoCartao(linha)) continue;\n" +
  "    saida.push(linha);";

const CONTAGEM_DA_TELA =
  "    if (linha.origem === \"previsto\") {\n" +
  "      if (soma) previsto += linha.valor;\n" +
  "      quantidadePrevista += 1;\n" +
  "    } else {\n" +
  "      if (soma) realizado += linha.valor;\n" +
  "      quantidadeRealizada += 1;\n" +
  "    }";

/** `[arquivo, rotulo, de, para, suite]` */
const mutantes = [
  // =========================================================================
  // 1. O FILTRO APAGADO, UM POR SITIO -- o estado de ANTES desta issue
  // =========================================================================
  [
    MOV,
    "`resumoDoPeriodo` VOLTA A NAO FILTRAR: os tres cartoes somam a linha desmarcada",
    FOR_MOV,
    "  for (const mov of movimentacoes) {",
    MOVIMENTACOES,
  ],
  [
    TELA,
    "`resumoDaTela` VOLTA A NAO FILTRAR: Total/Previsto/Realizado das 3 abas",
    SOMA_DA_TELA,
    "    const soma = true;",
    TELAS,
  ],
  [
    CAT,
    "`linhasDeCategoria` VOLTA A NAO FILTRAR: o gemeo em JS da view discorda dela",
    FOR_CAT,
    "  for (const t of transacoes) {",
    CATEGORIAS,
  ],
  [
    ROTA_FLUXO,
    "o LACO DE PAGINACAO volta a nao filtrar: o ramo de INTERVALO discorda do mensal",
    LACO_DA_ROTA,
    "        for (const linha of lote)\n" +
      "          linhas.push(linha as unknown as LinhaDoRealizado);",
    SOMAS,
  ],
  [
    VSPEND,
    "`calcularGastoVariavel` volta a nao filtrar: a mediana e a data de mergulho",
    FOR_VSPEND,
    "  for (const t of transacoes) {",
    SOMAS,
  ],
  [
    RESUMO_MENSAL,
    "`anomaliasDoUsuario` volta a nao filtrar: o e-mail acusa anomalia no ajuste",
    FILTRO_DO_RESUMO,
    "  const transacoes = (data ?? []) as unknown as TransacaoParaAnomalia[];",
    SOMAS,
  ],

  // =========================================================================
  // 2. A POLARIDADE DO PREDICADO -- o defeito que ESVAZIA o relatorio
  // =========================================================================
  // Os tres sao o mesmo defeito escrito de tres formas, e os tres sao mutantes
  // SEPARADOS de proposito: cada um e o que uma pessoa diferente escreveria ao
  // "simplificar" a linha, e o teste tem de matar os tres.
  [
    DONO,
    "o predicado vira `=== true`: `undefined` passa a significar NAO SOMA",
    PREDICADO,
    "  return linha.include_in_total === true;",
    SOMAS,
  ],
  [
    DONO,
    "o predicado vira `Boolean(...)`: a mesma coisa, com cara de limpeza",
    PREDICADO,
    "  return Boolean(linha.include_in_total);",
    SOMAS,
  ],
  [
    DONO,
    "o predicado vira SEMPRE VERDADEIRO: a feature inteira e um no-op",
    PREDICADO,
    "  return true;",
    SOMAS,
  ],
  [
    DONO,
    "o predicado INVERTE: so a linha desmarcada soma",
    PREDICADO,
    "  return linha.include_in_total === false;",
    SOMAS,
  ],
  [
    TELA,
    "o `soma_nos_totais` da tela vira `!linha.soma_nos_totais`: o cache offline zera a tela",
    SOMA_DA_TELA,
    "    const soma = !!linha.soma_nos_totais;",
    TELAS,
  ],

  // =========================================================================
  // 3. A COLUNA FORA DO `select` -- o filtro vira no-op sem mudar codigo
  // =========================================================================
  [
    RESUMO_MENSAL,
    "`COLUNAS_DA_TRANSACAO` perde a coluna: as TRES leituras filtram `undefined`",
    COLUNAS_MENSAL,
    '  "transaction_date, amount, transaction_type, category_id, description";',
    SOMAS,
  ],
  [
    CAIXA,
    "`COLUNAS_DO_REALIZADO_DE_CAIXA` perde a coluna: o ramo de intervalo pessoal volta ao de antes",
    COLUNAS_CAIXA,
    '  "amount, transaction_type, currency, account:financial_accounts(account_type)";',
    SOMAS,
  ],
  // O `select` LITERAL DO FLUXO SAIU DESTA LISTA NA FASE 6. Ate ali o relatorio
  // pessoal de intervalo (o `URL_FLUXO` da suite) lia aquele literal, e so o
  // painel lia `COLUNAS_DO_REALIZADO_DE_CAIXA`; desde a 072 os dois leem a
  // constante, e o literal ficou so no relatorio do GRUPO, que esta suite nao
  // chama. O mutante de cima mede o caminho que o literal media.
  [
    ROTA_CATEGORIAS,
    "o `select` de Categorias perde a coluna: a pizza discorda do fluxo ao lado",
    SELECT_DAS_CATEGORIAS,
    '              : "category_id, amount, transaction_type, currency, account:financial_accounts(account_type)"',
    SOMAS,
  ],

  // =========================================================================
  // 4. O CONSERTO ZELOSO: filtrar onde a secao 3c mandou NAO filtrar
  // =========================================================================
  [
    CAIXA,
    "O CONSERTO ZELOSO: `realizadoComCartaoPelaFatura` passa a filtrar tambem",
    PROMOCAO_DO_CAIXA,
    "    if (linha.include_in_total === false) continue;\n" +
      "    if (ehCompraNoCartao(linha)) continue;\n" +
      "    saida.push(linha);",
    REALIZADO,
  ],
  [
    TELA,
    "O CONSERTO ZELOSO: as CONTAGENS tambem filtram -- a frase discorda da lista",
    CONTAGEM_DA_TELA,
    "    if (!soma) continue;\n" +
      "    if (linha.origem === \"previsto\") {\n" +
      "      previsto += linha.valor;\n" +
      "      quantidadePrevista += 1;\n" +
      "    } else {\n" +
      "      realizado += linha.valor;\n" +
      "      quantidadeRealizada += 1;\n" +
      "    }",
    TELAS,
  ],
];

const SUITES = [SOMAS, MOVIMENTACOES, TELAS, CATEGORIAS, REALIZADO, VARIAVEL];

const bloco = criarBlocoDeMutantes({
  suites: SUITES,
  rotulo: "fora-dos-totais-nas-somas",
});

// Lido da arvore de verdade, que e o original por construcao: nada mais aqui
// escreve nela. Montado DEPOIS da lista, para a lista poder nomear os arquivos.
const original = new Map();
for (const arquivo of new Set(mutantes.map(([alvo]) => alvo))) {
  original.set(arquivo, readFileSync(arquivo, "utf8"));
}

// CONTROLE POSITIVO, POR SUITE. Uma suite ja vermelha faz todo mutante dela
// aparecer como MORTO sem medir nada (`suite-vermelha-faz-todo-controle-negativo-passar-vacuo`),
// e aqui ha SEIS suites -- uma so delas quebrada contamina a parte do placar
// que mais importa.
const usadas = new Set(mutantes.map(([, , , , suite]) => suite));
for (const suite of SUITES) {
  if (!usadas.has(suite)) continue;
  const limpo = bloco.rodar("<arvore limpa>", {}, suite);
  if (!limpo.verde) {
    console.error(
      `controle positivo REPROVOU em ${suite}: a suite ja esta vermelha sem ` +
        "mutante nenhum. Todo mutante dela apareceria como MORTO sem medir nada."
    );
    bloco.fechar();
    process.exit(1);
  }
  console.log(`controle positivo: ${suite} VERDE na arvore limpa.`);
}
console.log();

let mortos = 0;
const sobreviventes = [];

for (const [arquivo, rotulo, de, para, suite] of mutantes) {
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

  // A TRAVA DE OCORRENCIA UNICA. Ver AS ANCORAS NAO PODEM CASAR NO COMENTARIO,
  // no cabecalho: `lib/fora-dos-totais.ts` cita as tres formas erradas do
  // predicado em prosa, e `lib/variable-spend.ts` e `lib/categorias-do-periodo.ts`
  // tem o MESMO `for (const t of apenasNosTotais(transacoes))`, em arquivos
  // diferentes.
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

  const r = bloco.rodar(rotulo, { [arquivo]: mutado }, suite);

  if (!r.verde) {
    mortos += 1;
    console.log(`MORTO      [${suite}] ${rotulo}`);
  } else {
    sobreviventes.push(`[${suite}] ${rotulo}`);
    console.log(`SOBREVIVEU [${suite}] ${rotulo}`);
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
