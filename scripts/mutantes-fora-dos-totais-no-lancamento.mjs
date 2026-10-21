#!/usr/bin/env node
// Prova de mutacao do `include_in_total` nas duas rotas de lancamento (HMO-452).
//
//   node scripts/mutantes-fora-dos-totais-no-lancamento.mjs
//
// Cada entrada estraga uma decisao; `npm run test:fora-dos-totais-no-lancamento`
// tem que ficar VERMELHA. Mutante que sobrevive e um trecho que nenhuma
// assercao distingue.
//
// O MUTANTE QUE A ISSUE PEDE NOMINALMENTE E O PRIMEIRO DA LISTA
// -------------------------------------------------------------
// `O PATCH VOLTA A SER `Boolean(...)`` e o que a HMO-452 manda medir: "mutante
// por cima do teste estrito -- `Boolean(body.include_in_total)` no lugar do
// `=== false` tem de MATAR a suite, senao o teste nao esta provando a parte que
// importa". Ele e o unico defeito desta feature que grava o OPOSTO do pedido:
// `Boolean("false") === true`, e o lancamento que a pessoa acabou de desmarcar
// volta para os totais com 200 e corpo completo.
//
// OS DOIS CONTROLES DE ENTREGA VEM DEPOIS DELE
// --------------------------------------------
// `A ROTA VOLTA A NAO ACEITAR O CAMPO` nas duas pontas e literalmente o estado
// de ANTES desta issue -- as linhas que ela acrescentou, removidas. Se um deles
// sobrevive, a suite nao mede a feature e nenhum outro mutante compensa.
//
// A ASSIMETRIA ENTRE AS DUAS ROTAS TEM MUTANTE DE CADA LADO, E E O PONTO
// ----------------------------------------------------------------------
// O POST e CONDICIONAL e o PATCH e INCONDICIONAL, de proposito (ver o cabecalho
// da suite). Os dois mutantes que TROCAM UMA FORMA PELA OUTRA sao os que provam
// que a escolha esta medida e nao foi coincidencia:
//
//   * POST incondicional -> nomeia a coluna em todo INSERT, e contra um banco
//     sem a 060 colada toda criacao pela API cai em 500 (42703);
//   * PATCH condicional  -> desmarcar funciona e REMARCAR nao: a coluna sai do
//     patch quando o valor e `true`, e quem desmarcou por engano fica sem
//     caminho de volta. Os dois respondem 200.
//
// O ULTIMO E O CONSERTO ZELOSO, QUE E PIOR QUE O DEFEITO
// ------------------------------------------------------
// `O PATCH PASSA A RECUSAR LANCAMENTO DE GRUPO` e o que alguem escreve de boa
// fe ao ver uma coluna de relatorio numa linha rateada. A secao 6d do plano da
// HMO-443 decidiu o contrario, e o motivo esta na rota: o flag vale so para o
// relatorio pessoal, e o rateio sai de `group_share_entries`, que nao passa por
// `category_monthly_totals`. A recusa tiraria a escolha de quem tem grupo sem
// proteger numero nenhum.
//
// O CONTROLE POSITIVO VEM PRIMEIRO
// --------------------------------
// Se a suite ja estiver vermelha antes de qualquer mutacao -- ou se um
// `replace` nao casar e o runner "mutar" nada --, todo mutante aparece como
// MORTO e o placar sai cheio sem ter medido nada. Por isso a arvore limpa roda
// antes, e cada `replace` confere que a ancora existe, que e UNICA e que o
// texto mudou.
//
// AS ANCORAS NAO PODEM CASAR NO COMENTARIO, E AQUI O RISCO E REAL
// ---------------------------------------------------------------
// As duas rotas EXPLICAM nos comentarios o que nao fazer, citando
// `Boolean(body.include_in_total)` e `!include_in_total` por extenso. Uma
// ancora curta casaria na prosa, o `replace` mutaria um comentario, o codigo
// ficaria intacto e o mutante "sobreviveria" sem nunca ter existido. Dai as
// ancoras abaixo levarem a atribuicao inteira (`updateData.include_in_total =
// ...`) ou a margem de indentacao: cada uma esta medida como ocorrencia UNICA
// pela trava do laco, que aborta em vez de mutar a 1a de duas.
//
// A FORMA DA LISTA E A DA FAMILIA TUPLA DE ARIDADE 4, E ISSO NAO E ESTILO
// -----------------------------------------------------------------------
// `scripts/mede-ancora-ambigua.mjs` -- a guarda que reprova ancora morta,
// ambigua ou de arquivo inexistente em TODO runner do repo -- le a lista de
// verdade em vez de a copiar, e so sabe ler duas formas. Dai a ordem
// `[ALVO, rotulo, de, para]` e o `original` montado DEPOIS da lista, como em
// `mutantes-subcategoria-no-lancamento`.
import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const POST = "app/api/personal-finance/transactions/route.ts";
const PATCH = "app/api/personal-finance/transactions/[id]/route.ts";

/** A linha inteira do PATCH, com a margem -- ver AS ANCORAS, no cabecalho. */
const LINHA_DO_PATCH =
  "    if (body.include_in_total !== undefined)\n" +
  "      updateData.include_in_total = body.include_in_total === true;";

/** O espalhamento condicional do POST, com a margem de 8 espacos. */
const LINHA_DO_POST =
  "        ...(include_in_total === false ? { include_in_total: false } : {}),";

/** [alvo, rotulo, de, para] */
const mutantes = [
  // =========================================================================
  // O MUTANTE QUE A ISSUE PEDE: o teste estrito do PATCH
  // =========================================================================
  [
    PATCH,
    "O PATCH VOLTA A SER `Boolean(...)`: a string \"false\" RELIGA nos totais",
    LINHA_DO_PATCH,
    "    if (body.include_in_total !== undefined)\n" +
      "      updateData.include_in_total = Boolean(body.include_in_total);",
  ],

  // =========================================================================
  // A ENTREGA: as duas rotas aceitam o campo
  // =========================================================================
  [
    PATCH,
    "O PATCH VOLTA A NAO ACEITAR O CAMPO (o estado de antes da HMO-452)",
    `${LINHA_DO_PATCH}\n`,
    "",
  ],
  [
    POST,
    "O POST VOLTA A NAO ACEITAR O CAMPO (o estado de antes da HMO-452)",
    `${LINHA_DO_POST}\n`,
    "",
  ],
  [
    POST,
    "O POST VOLTA A NAO LER O CAMPO DO CORPO (morre no compilador)",
    "      include_in_total,\n",
    "",
  ],

  // =========================================================================
  // A ASSIMETRIA TROCADA DE LADO -- ver o cabecalho
  // =========================================================================
  [
    POST,
    "o POST passa a NOMEAR a coluna sempre: 42703 em toda criacao antes da colagem",
    LINHA_DO_POST,
    "        include_in_total: include_in_total !== false,",
  ],
  [
    PATCH,
    "o PATCH so grava quando e `false`: desmarcar funciona, REMARCAR nao",
    LINHA_DO_PATCH,
    "    if (body.include_in_total === false) updateData.include_in_total = false;",
  ],

  // =========================================================================
  // O CAMPO VAI, MAS VAI ERRADO
  // =========================================================================
  [
    PATCH,
    "o PATCH grava `false` cravado: marcar de volta nunca pega",
    LINHA_DO_PATCH,
    "    if (body.include_in_total !== undefined)\n" +
      "      updateData.include_in_total = false;",
  ],
  [
    PATCH,
    "o `=== true` vira `=== false`: a tela grava o inverso do botao",
    LINHA_DO_PATCH,
    "    if (body.include_in_total !== undefined)\n" +
      "      updateData.include_in_total = body.include_in_total === false;",
  ],
  [
    PATCH,
    "cai o `!== undefined`: TODA edicao de descricao tira a linha dos totais",
    LINHA_DO_PATCH,
    "    updateData.include_in_total = body.include_in_total === true;",
  ],
  [
    POST,
    "o `=== false` vira `!include_in_total`: o corpo SEM o campo nasce fora dos totais",
    LINHA_DO_POST,
    "        ...(!include_in_total ? { include_in_total: false } : {}),",
  ],
  [
    POST,
    "o POST grava `true` onde pediram `false`: a escolha vira o oposto, com 201",
    LINHA_DO_POST,
    "        ...(include_in_total === false ? { include_in_total: true } : {}),",
  ],

  // =========================================================================
  // O CONSERTO ZELOSO: recusar o que a secao 6d mandou aceitar
  // =========================================================================
  [
    POST,
    "O POST PASSA A RECUSAR O FLAG EM LINHA DE GRUPO (contra a decisao 6d)",
    LINHA_DO_POST,
    "        ...(include_in_total === false && !group_id\n" +
      "          ? { include_in_total: false }\n" +
      "          : {}),",
  ],
];

const SUITE = "test:fora-dos-totais-no-lancamento";

const bloco = criarBlocoDeMutantes({
  suites: [SUITE],
  rotulo: "fora-dos-totais-no-lancamento",
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
  // mutante passa a medir outra coisa. Aqui o risco concreto e o COMENTARIO --
  // ver AS ANCORAS NAO PODEM CASAR NO COMENTARIO, no cabecalho.
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
