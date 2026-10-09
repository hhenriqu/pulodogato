#!/usr/bin/env node
// Prova de mutacao da subcategoria na compra parcelada (HMO-218).
//
//   node scripts/mutantes-subcategoria-nas-parcelas.mjs
//
// Cada entrada estraga uma decisao; `npm run test:subcategoria-nas-parcelas` tem
// que ficar VERMELHA. Mutante que sobrevive e um trecho que nenhuma assercao
// distingue.
//
// O CONTROLE NEGATIVO DA ENTREGA E O PRIMEIRO DA LISTA
// ----------------------------------------------------
// `A ROTA VOLTA A DESCARTAR A SUBCATEGORIA` e literalmente o estado de ANTES
// desta issue: a linha que a HMO-218 acrescentou, removida. Se ele sobrevive, a
// suite nao mede a feature e nenhum outro mutante compensa.
//
// O SEGUNDO E O QUE JUSTIFICA O RECORTE DO GUARD DE TELA
// -----------------------------------------------------
// `A TELA VOLTA A NAO MANDAR O CAMPO` apaga a chave do corpo do `fetch` de
// parcelas e DEIXA as outras duas ocorrencias de `subcategory_id:` no arquivo
// (o lancamento avulso e a regra fixa). Um guard sobre o arquivo inteiro fica
// VERDE com este mutante de pe -- e era assim que a divida da HMO-216 passava
// sem sintoma. Ele morre porque a assercao olha o objeto do corpo, recortado
// por casamento de chaves, e nao o arquivo.
//
// O CONTROLE POSITIVO VEM PRIMEIRO
// --------------------------------
// Se a suite ja estiver vermelha antes de qualquer mutacao -- ou se um `replace`
// nao casar e o runner "mutar" nada --, todo mutante aparece como MORTO e o
// placar sai cheio sem ter medido nada. Por isso a arvore limpa roda antes, e
// cada `replace` confere que a ancora existe e que o texto mudou.
//
// AS DUAS ANCORAS DE TELA SE DISTINGUEM PELA INDENTACAO, E ISSO E DE PROPOSITO
// ---------------------------------------------------------------------------
// `subcategory_id: valores.subcategoriaId || null,` aparece DUAS vezes em
// FormularioDeLancamento.tsx: com 8 espacos no corpo do `fetch` de parcelas
// (dentro do objeto passado a `JSON.stringify`) e com 6 no objeto de
// `gravarTransacao`. `replace` pega a PRIMEIRA ocorrencia, e as duas linhas sao
// identicas fora da margem -- sem a indentacao na ancora, o mutante que diz
// mexer nas parcelas mexeria no lancamento avulso e mediria outra feature.
import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const ROTA = "app/api/financial-installments/route.ts";
const FORMULARIO = "components/movimentacoes/FormularioDeLancamento.tsx";

const SUITE = "test:subcategoria-nas-parcelas";

// Lido da arvore de verdade, que e o original por construcao: nada mais aqui
// escreve nela.
const original = new Map(
  [ROTA, FORMULARIO].map((a) => [a, readFileSync(a, "utf8")])
);

/** [rotulo, arquivo, de, para] */
const mutantes = [
  // =========================================================================
  // A ENTREGA: o campo atravessa a rota
  // =========================================================================
  [
    "A ROTA VOLTA A DESCARTAR A SUBCATEGORIA (o estado de antes da HMO-218)",
    ROTA,
    "      subcategory_id: subcategory_id || null,\n",
    "",
  ],
  [
    "A TELA VOLTA A NAO MANDAR O CAMPO (e as outras duas ocorrencias ficam)",
    FORMULARIO,
    "        subcategory_id: valores.subcategoriaId || null,\n",
    "",
  ],

  // =========================================================================
  // O CAMPO VAI, MAS VAI ERRADO
  // =========================================================================
  [
    "a rota GRAVA null fixo: o corpo e lido e jogado fora",
    ROTA,
    "      subcategory_id: subcategory_id || null,",
    "      subcategory_id: null,",
  ],
  [
    'o `|| null` vira `|| ""`: uuid vazio e 22P02, e a serie inteira nao grava',
    ROTA,
    "      subcategory_id: subcategory_id || null,",
    '      subcategory_id: subcategory_id || "",',
  ],
  [
    "SO A PARCELA 1 leva a subcategoria: as outras M-1 gravam null",
    ROTA,
    "      subcategory_id: subcategory_id || null,",
    "      subcategory_id: i === 0 ? subcategory_id || null : null,",
  ],
  [
    "o campo entra so DA PARCELA 2 em diante: o lote do PostgREST o descarta inteiro",
    ROTA,
    "      subcategory_id: subcategory_id || null,",
    "      ...(i > 0 ? { subcategory_id: subcategory_id || null } : {}),",
  ],
  [
    "a rota perde a CATEGORIA e mantem a subcategoria: o par que a FK recusa",
    ROTA,
    "      category_id,\n      // A MESMA SUBCATEGORIA",
    "      category_id: null,\n      // A MESMA SUBCATEGORIA",
  ],

  // =========================================================================
  // A TELA MANDA, MAS MANDA OUTRA COISA
  // =========================================================================
  [
    "a tela manda a CATEGORIA no lugar da subcategoria",
    FORMULARIO,
    "        subcategory_id: valores.subcategoriaId || null,",
    "        subcategory_id: valores.categoriaId || null,",
  ],
];

const bloco = criarBlocoDeMutantes({
  suites: [SUITE],
  rotulo: "subcategoria-nas-parcelas",
});

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

for (const [rotulo, arquivo, de, para] of mutantes) {
  const fonte = original.get(arquivo);

  if (!fonte.includes(de)) {
    console.error(
      `ANCORA MORTA  ${rotulo}\n  ${arquivo} nao contem o trecho procurado. ` +
        "Isto e erro do runner, nao mutante morto -- conserte a ancora."
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
