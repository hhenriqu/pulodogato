#!/usr/bin/env node
// Prova de mutacao da despesa publicada no grupo (HMO-356).
//
//   node scripts/mutantes-despesa-publicada-no-grupo.mjs
//
// Cada entrada estraga uma decisao; `npm run test:despesa-publicada-no-grupo`
// tem que ficar VERMELHA. Mutante que sobrevive e um trecho que nenhuma
// assercao distingue.
//
// O CONTROLE NEGATIVO DA ENTREGA E O PRIMEIRO DA LISTA
// ----------------------------------------------------
// `A ROTA VOLTA A NAO CONFERIR LINHA` apaga o ramo de erro e devolve o
// comportamento de ANTES desta issue -- 200 `{"success":true}` sobre um
// `group_id` que nao foi gravado. Se ele sobrevive, a suite nao mede a feature e
// nenhum outro mutante compensa.
//
// Ele e mais exato que "apagar o `.select()`" de proposito: apagar o `.select()`
// deixa a rota reprovando TODA despesa combinada (`sem-select`), que e um defeito
// diferente e visivel no caminho bom. O estado de antes era a rota dizendo
// SUCESSO, e o unico mutante que o reproduz e este. De lambuja, ele deixa
// `conferirEscrita` e `.select("id")` NO ARQUIVO -- entao e tambem a prova de
// que um guard textual (`includes("conferirEscrita")`) nao serviria aqui.
//
// A FAMILIA QUE IMPORTA E "CONFERIU, MAS CONFERIU DE MENTIRA"
// ----------------------------------------------------------
// O conserto tem tres pecas que se parecem com uma, e as tres falham sozinhas:
//
//   1. o `.select()`. Sem ele `conferirEscrita` responde `sem-select` em TODA
//      despesa combinada -- a rota fica "conferida" e quebra o caminho bom. Este
//      mutante morre no controle POSITIVO, nao no negativo: e o unico da lista
//      com essa assinatura;
//   2. o `if (!publicacao.ok)`. Invertido, a rota desfaz exatamente as despesas
//      que gravaram -- o pior dos dois mundos;
//   3. o criterio precisa contar ZERO LINHA, e nao so erro de banco.
//      `publicacao.motivo === "erro"` e o buraco da HMO-203 reaberto por dentro
//      de uma chamada que parece conferida.
//
// A ASSIMETRIA DO `delete` DE COMPENSACAO TAMBEM E MEDIDA, E PELOS DOIS LADOS
// --------------------------------------------------------------------------
// `A COMPENSACAO PASSA A MUDAR A RESPOSTA` faz o `delete` de `desfazer` derrubar
// a rota com o proprio motivo. A arvore certa reporta o erro ORIGINAL; o
// mutante reporta "apagar a despesa ...". Sem este mutante, a decisao de nao
// conferir a compensacao seria so um comentario -- e um comentario que a
// proxima varredura de `.select()` ausente removeria de boa fe.
//
// O CONTROLE POSITIVO VEM PRIMEIRO
// --------------------------------
// Se a suite ja estiver vermelha antes de qualquer mutacao -- ou se um `replace`
// nao casar e o runner "mutar" nada --, todo mutante aparece como MORTO e o
// placar sai cheio sem ter medido nada. Por isso a arvore limpa roda antes, e
// cada `replace` confere que a ancora existe, e uma so vez, e que o texto mudou.
//
// A FORMA DA LISTA E A DA FAMILIA TUPLA DE ARIDADE 4
// -------------------------------------------------
// `scripts/mede-ancora-ambigua.mjs` -- a guarda que reprova ancora morta,
// ambigua ou de arquivo inexistente em TODO runner do repo -- le a lista de
// verdade em vez de a copiar, e so sabe ler duas formas. Dai a ordem
// `[ALVO, rotulo, de, para]` e o `original` montado DEPOIS da lista.
import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const ROTA = "app/api/expense-groups/[groupId]/transactions/route.ts";

// AS ANCORAS SAO STRINGS DE UMA LINHA, COM `\n` ESCAPADO -- NAO TEMPLATE LITERAL
// -----------------------------------------------------------------------------
// `scripts/converte-mutantes-em-bloco.mjs` le a primeira entrada da lista com
// `/^ {2}\[\n((?: {4}.*\n)+?) {2,6}\],?$/m` e CONTA as linhas de nivel 4 para
// cruzar a aridade. Um `de` multilinha em backtick quebra essa contagem, e o
// `mede-ancora-ambigua.mjs` morre com "nao consegui ler a primeira entrada da
// lista de mutantes" -- medido aqui ao escrever este runner. Entao todo trecho
// de varias linhas vira uma string so, com `\n` literal.
/** [alvo, rotulo, de, para] */
const mutantes = [
  // =========================================================================
  // A ENTREGA: a rota deixa de dizer sucesso sobre escrita que nao pegou linha
  // =========================================================================
  //
  // ESTE E O CONTROLE NEGATIVO DA ISSUE, e ele e mais exato que apagar o
  // `.select()`: apagar o ramo de erro devolve o COMPORTAMENTO de antes (200
  // com zero linha) e DEIXA `conferirEscrita` e `.select("id")` no arquivo.
  // Qualquer guard textual sobre o fonte fica verde com ele de pe.
  [
    ROTA,
    'A ROTA VOLTA A NAO CONFERIR LINHA (o estado de antes: 200 sobre zero linha, com `conferirEscrita` ainda no arquivo)',
    '      if (!publicacao.ok) {\n        return desfazer("Erro ao publicar a despesa no grupo.", publicacao);\n      }',
    '      void publicacao;',
  ],

  // =========================================================================
  // CONFERIU, MAS CONFERIU DE MENTIRA
  // =========================================================================
  [
    ROTA,
    'o `.select()` do UPDATE sai: sem contagem, `sem-select` reprova TODA despesa combinada',
    '          .eq("id", transaction.id)\n          .select("id"),\n        "publicar a despesa no grupo"',
    '          .eq("id", transaction.id),\n        "publicar a despesa no grupo"',
  ],
  [
    ROTA,
    'a condicao INVERTE: a rota desfaz justamente as despesas que gravaram',
    '      if (!publicacao.ok) {',
    '      if (publicacao.ok) {',
  ],
  [
    ROTA,
    'zero linha deixa de contar e so o erro de banco conta (o buraco da HMO-203)',
    '      if (!publicacao.ok) {',
    '      if (!publicacao.ok && publicacao.motivo === "erro") {',
  ],

  // =========================================================================
  // O FILTRO DA ESCRITA
  // =========================================================================
  [
    ROTA,
    'o UPDATE perde o `.eq`: publica o grupo em TODA despesa que a policy alcanca',
    '          .update({ group_id: groupId })\n          .eq("id", transaction.id)\n          .select("id"),',
    '          .update({ group_id: groupId })\n          .select("id"),',
  ],

  // =========================================================================
  // A ASSIMETRIA DA COMPENSACAO
  // =========================================================================
  [
    ROTA,
    'A COMPENSACAO PASSA A MUDAR A RESPOSTA (e apaga o erro que a disparou)',
    '      if (!compensacao.ok) {\n        console.error(',
    '      if (!compensacao.ok) {\n        return NextResponse.json({ error: compensacao.mensagem }, { status: 500 });\n        console.error(',
  ],
  [
    ROTA,
    'o `delete` de compensacao nao e nem tentado: a despesa fica orfa em silencio',
    '        await supabase\n          .from("financial_transactions")\n          .delete()\n          .eq("id", transaction.id)\n          .select("id"),',
    '        await Promise.resolve({ data: [{ id: transaction.id }], error: null }),',
  ],

  // =========================================================================
  // A ORDEM DE ESCRITA DA DIVISAO COMBINADA (o que o UPDATE existe para fazer)
  // =========================================================================
  [
    ROTA,
    'a despesa combinada volta a NASCER com group_id: o trigger rateia igual antes da rota falar',
    '        group_id: partesCombinadas === null ? groupId : null,',
    '        group_id: groupId,',
  ],
];

const SUITE = "test:despesa-publicada-no-grupo";

const bloco = criarBlocoDeMutantes({
  suites: [SUITE],
  rotulo: "despesa-publicada-no-grupo",
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
  // mutante passa a medir outra feature. Aqui o risco e concreto -- o arquivo
  // tem DUAS chamadas de `conferirEscrita` e DOIS `.select("id")`.
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
