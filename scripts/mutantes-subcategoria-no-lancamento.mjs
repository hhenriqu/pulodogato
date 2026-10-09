#!/usr/bin/env node
// Prova de mutacao da subcategoria no POST de lancamento (HMO-224).
//
//   node scripts/mutantes-subcategoria-no-lancamento.mjs
//
// Cada entrada estraga uma decisao; `npm run test:subcategoria-no-lancamento`
// tem que ficar VERMELHA. Mutante que sobrevive e um trecho que nenhuma
// assercao distingue.
//
// O CONTROLE NEGATIVO DA ENTREGA E O PRIMEIRO DA LISTA
// ----------------------------------------------------
// `A ROTA VOLTA A DESCARTAR A SUBCATEGORIA` e literalmente o estado de ANTES
// desta issue: a linha que a HMO-224 acrescentou ao INSERT, removida. Se ele
// sobrevive, a suite nao mede a feature e nenhum outro mutante compensa.
//
// O SEGUNDO MORRE NO COMPILADOR, E ISSO E UM ABATE LEGITIMO
// ---------------------------------------------------------
// `A ROTA VOLTA A NAO LER O CAMPO DO CORPO` apaga `subcategory_id` do
// destructuring. A outra metade do defeito original era essa -- e, uma vez que
// o INSERT cita o nome, apagar so o destructuring nao compila (TS2304). O
// mutante morre no `compila.mjs` e nao numa assercao, o que e justamente a
// prova de que as duas metades estao amarradas: nao da para ter uma sem a
// outra. Sem a linha do INSERT (mutante 1) ele compilaria calado.
//
// O ULTIMO E O CONSERTO ZELOSO, QUE E PIOR QUE O DEFEITO
// ------------------------------------------------------
// `A ROTA PASSA A CONFERIR O PAR EM TYPESCRIPT` e o que alguem escreve de boa
// fe ao ler "par invalido": uma consulta a `transaction_subcategories` e um
// fallback para `null` quando nao acha. Isso recria o defeito desta issue --
// subcategoria sumindo em silencio, com 201 -- e agora com um guard verde em
// cima. A issue e explicita que o arbitro do par e a FK composta da 036, e e
// este mutante que faz a secao 3 da suite medir algo.
//
// O CONTROLE POSITIVO VEM PRIMEIRO
// --------------------------------
// Se a suite ja estiver vermelha antes de qualquer mutacao -- ou se um `replace`
// nao casar e o runner "mutar" nada --, todo mutante aparece como MORTO e o
// placar sai cheio sem ter medido nada. Por isso a arvore limpa roda antes, e
// cada `replace` confere que a ancora existe e que o texto mudou.
//
// AS DUAS ANCORAS DA ROTA SE DISTINGUEM PELA INDENTACAO, E ISSO E DE PROPOSITO
// ---------------------------------------------------------------------------
// `subcategory_id` aparece duas vezes no arquivo: com 6 espacos no
// destructuring do corpo e com 8 dentro do objeto do `.insert()`. `replace`
// pega a PRIMEIRA ocorrencia, e sem a margem na ancora o mutante que diz mexer
// no INSERT mexeria na leitura do corpo -- e mediria outra coisa.
//
// A FORMA DA LISTA E A DA FAMILIA TUPLA DE ARIDADE 4, E ISSO NAO E ESTILO
// -----------------------------------------------------------------------
// `scripts/mede-ancora-ambigua.mjs` -- a guarda que reprova ancora morta,
// ambigua ou de arquivo inexistente em TODO runner do repo -- le a lista de
// verdade em vez de a copiar, e so sabe ler duas formas. Dai a ordem
// `[ALVO, rotulo, de, para]` e o `original` montado DEPOIS da lista, como em
// `mutantes-subcategoria-nas-parcelas`.
import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const ROTA = "app/api/personal-finance/transactions/route.ts";

/** [alvo, rotulo, de, para] */
const mutantes = [
  // =========================================================================
  // A ENTREGA: o campo atravessa a rota
  // =========================================================================
  [
    ROTA,
    "A ROTA VOLTA A DESCARTAR A SUBCATEGORIA (o estado de antes da HMO-224)",
    "        subcategory_id: subcategory_id || null,\n",
    "",
  ],
  [
    ROTA,
    "A ROTA VOLTA A NAO LER O CAMPO DO CORPO (morre no compilador)",
    "      subcategory_id,\n",
    "",
  ],

  // =========================================================================
  // O CAMPO VAI, MAS VAI ERRADO
  // =========================================================================
  [
    ROTA,
    "a rota GRAVA null fixo: o corpo e lido e jogado fora",
    "        subcategory_id: subcategory_id || null,",
    "        subcategory_id: null,",
  ],
  [
    ROTA,
    'o `|| null` vira `|| ""`: uuid vazio e 22P02, e o lancamento nao grava',
    "        subcategory_id: subcategory_id || null,",
    '        subcategory_id: subcategory_id || "",',
  ],
  [
    ROTA,
    "a rota manda a CATEGORIA no lugar da subcategoria: o par que a FK recusa",
    "        subcategory_id: subcategory_id || null,",
    "        subcategory_id: category_id || null,",
  ],
  [
    ROTA,
    "a COLUNA sai do comando quando nao ha subcategoria (em vez de gravar null)",
    "        subcategory_id: subcategory_id || null,",
    "        ...(subcategory_id ? { subcategory_id } : {}),",
  ],
  [
    ROTA,
    "so DESPESA leva subcategoria: toda receita grava null",
    "        subcategory_id: subcategory_id || null,",
    "        subcategory_id: isExpense ? subcategory_id || null : null,",
  ],
  [
    ROTA,
    "so lancamento SEM grupo leva subcategoria: a despesa de grupo grava null",
    "        subcategory_id: subcategory_id || null,",
    "        subcategory_id: group_id ? null : subcategory_id || null,",
  ],

  // =========================================================================
  // O CONSERTO ZELOSO: validar o par aqui em vez de deixar a FK recusar
  // =========================================================================
  [
    ROTA,
    "A ROTA PASSA A CONFERIR O PAR EM TYPESCRIPT e cai para null quando nao acha",
    "        subcategory_id: subcategory_id || null,",
    "        subcategory_id: (\n" +
      '          await supabase\n            .from("transaction_subcategories")\n' +
      '            .select("id")\n            .eq("id", subcategory_id)\n' +
      "            .maybeSingle()\n        ).data\n" +
      "          ? subcategory_id\n          : null,",
  ],
];

const SUITE = "test:subcategoria-no-lancamento";

const bloco = criarBlocoDeMutantes({
  suites: [SUITE],
  rotulo: "subcategoria-no-lancamento",
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
  // AS DUAS ANCORAS DA ROTA, no cabecalho.
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
