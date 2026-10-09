#!/usr/bin/env node
// =====================================================
// PULODOGATO - a subcategoria atravessa a compra parcelada (HMO-218)
// =====================================================
//   npm run test:subcategoria-nas-parcelas
//
// A DIVIDA QUE A HMO-216 DEIXOU ABERTA -- E QUE MUDOU DE LUGAR
// ------------------------------------------------------------
// A 036 deu `subcategory_id` a `financial_transactions`, `recurring_rules` e
// `scheduled_transactions`, e deixou `transaction_installments` de fora porque
// ninguem lia aquela tabela. A HMO-218 foi escrita para fechar isso "quando as
// parcelas ganharem leitor", com uma migration e uma mexida na RPC
// `create_installments`.
//
// O leitor nunca chegou, e a razao e melhor: a HMO-211 REESCREVEU a rota de
// parcelas. Ela nao chama mais `create_installments` (a RPC nao tem mais nenhum
// chamador no app) e nao grava mais em `transaction_installments`. Uma serie
// nova vira N linhas de `financial_transactions`, uma por fatura -- e essa
// tabela JA tem a coluna e JA tem a FK composta da 036. A divida real nunca foi
// a coluna que falta num lugar; era o campo que a rota nova nao copiava.
//
// POR QUE ISTO E UMA SONDA DE ROTA, E NAO UMA ASSERCAO DE TEXTO
// ------------------------------------------------------------
// Um guard que procure `subcategory_id:` no fonte do formulario passa VERDE com
// o defeito de pe, e isso foi conferido: o arquivo ja tinha a chave em
// `gravarTransacao` (o lancamento avulso), trinta linhas abaixo do
// `criarParcelas` que a descartava. O nome "aparecia" e a serie saia sem
// subcategoria. Pelo mesmo motivo nao da para medir isto no `tsc`: o campo
// entra num objeto literal que vai para `.insert()` do supabase-js, tipagem
// permissiva na fronteira -- apagar a linha compila.
//
// O que corresponde a promessa e chamar o handler e olhar o PAYLOAD gravado. E
// o que o duble guarda em `escritas` (HMO-218 estendeu o de leitura da HMO-272).
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { criarDuble } from "./duble-de-supabase.mjs";
import { semComentarios } from "./varredura-de-fonte.mjs";

const ROTA = await import(
  "../.tmp-subcategoria-nas-parcelas/app/api/financial-installments/route.js"
);

const DONO = "dono-1";
const CARTAO = "cartao-1";
const SERVICO = "servico-financas";
const CATEGORIA = "cat-mercado";
const SUBCATEGORIA = "sub-feira";

/**
 * Chama o POST da rota com um duble, e devolve o corpo mais o que foi gravado.
 *
 * `mes_da_fatura` vai SEMPRE preenchido: com ele a rota usa a fatura escolhida
 * como ancora e nao consulta a RPC `card_invoice_month`. Sem ele a rota cairia
 * no `supabase.rpc(...)`, que neste duble responde `[]` -- um valor que passa
 * pelo `!mesDaRpc` (array vazio e truthy) e chega em `String([])`, ou seja `""`,
 * como mes ancora. A serie seria montada a partir de um mes ilegivel e o teste
 * mediria o caminho de erro, nao o payload.
 */
async function parcelar({
  subcategory_id,
  total_parcelas = 10,
  parcela_atual = 1,
  comCampo = true,
} = {}) {
  const sessao = criarDuble({
    user: { id: DONO },
    tabelas: {
      financial_accounts: [
        {
          id: CARTAO,
          user_id: DONO,
          account_type: "credit_card",
          closing_day: 30,
        },
      ],
      financial_services: [{ id: SERVICO, name: "personal_finance" }],
      financial_transactions: [],
    },
  });

  const registro = { sessao: () => sessao.client };
  globalThis.__dubleDeSupabase = registro;

  const corpoDoPedido = {
    account_id: CARTAO,
    category_id: CATEGORIA,
    description: "Mercado do mês",
    valor: "100",
    base: "parcela",
    parcela_atual,
    total_parcelas,
    vencimento: "2026-10-04",
    mes_da_fatura: "2026-11",
    group_id: null,
    notes: null,
    currency: "BRL",
    exchange_rate: 1,
  };

  // `comCampo: false` OMITE a chave em vez de manda-la vazia. As duas coisas
  // sao diferentes para a rota: `""` passa pelo `|| null` e `undefined` nem
  // chega a ser lido. Um cliente velho (a fila offline de uma aba antiga) manda
  // o corpo sem a chave, e esse caso tem de gravar `null`, nao estourar.
  if (comCampo) corpoDoPedido.subcategory_id = subcategory_id;

  let resposta;
  try {
    resposta = await ROTA.POST({ json: async () => corpoDoPedido });
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  const corpo = await resposta.json();

  // CONTROLE POSITIVO. Sem ele todo o resto passa por vacuidade: uma rota que
  // trocasse o jeito de obter o client deixaria o duble intocado, `escritas`
  // ficaria vazia, e um `.every()` sobre lista vazia responde `true`.
  assert.ok(
    (registro.chamadasDeSessao ?? 0) > 0,
    "controle positivo: a rota nao abriu o client de SESSAO -- o payload " +
      "medido abaixo nao veio dela."
  );

  const inserts = sessao.escritas.filter(
    (e) => e.verbo === "insert" && e.tabela === "financial_transactions"
  );

  return { resposta, corpo, inserts, escritas: sessao.escritas };
}

// ---------------------------------------------------------------------------
// 1. O CAMPO CHEGA, E CHEGA EM TODAS AS PARCELAS
// ---------------------------------------------------------------------------

test("a subcategoria escolhida vai nas 10 linhas da serie", async () => {
  const { resposta, inserts } = await parcelar({
    subcategory_id: SUBCATEGORIA,
  });

  assert.equal(resposta.status, 200);
  assert.equal(inserts.length, 1, "a serie tem de ir num INSERT unico");

  const linhas = inserts[0].linhas;
  assert.equal(linhas.length, 10, "10 parcelas, 10 linhas");

  // `in` e nao `!= null`: a diferenca entre "gravou null" e "a coluna nao foi
  // no comando" e exatamente o descarte silencioso do lote do PostgREST.
  for (const [i, linha] of linhas.entries()) {
    assert.ok(
      "subcategory_id" in linha,
      `a parcela ${i + 1} foi para o banco SEM a coluna subcategory_id`
    );
    assert.equal(
      linha.subcategory_id,
      SUBCATEGORIA,
      `a parcela ${i + 1} gravou a subcategoria errada`
    );
  }
});

test("a categoria e a subcategoria vao JUNTAS -- o par e o que a FK confere", () => {
  // A FK composta da 036 e `(category_id, subcategory_id)`. Uma linha com a
  // subcategoria e sem a categoria nao e "meio certa": e um par que o banco
  // recusa com 23503, e a serie inteira nao grava. Medir so a subcategoria
  // deixaria passar uma rota que perdesse a categoria no caminho.
  return parcelar({ subcategory_id: SUBCATEGORIA }).then(({ inserts }) => {
    for (const linha of inserts[0].linhas) {
      assert.equal(linha.category_id, CATEGORIA);
      assert.equal(linha.subcategory_id, SUBCATEGORIA);
    }
  });
});

test("a subcategoria e a MESMA nas M parcelas -- uma compra, um par", async () => {
  const { inserts } = await parcelar({ subcategory_id: SUBCATEGORIA });
  const distintas = new Set(
    inserts[0].linhas.map((l) => `${l.category_id}|${l.subcategory_id}`)
  );
  assert.equal(
    distintas.size,
    1,
    "parcelas da mesma compra com pares diferentes viram dois gastos no relatorio"
  );
});

// ---------------------------------------------------------------------------
// 2. SEM SUBCATEGORIA CONTINUA PASSANDO
// ---------------------------------------------------------------------------
// O `MATCH SIMPLE` da FK composta e o que faz isto valer no banco: par com
// `subcategory_id` NULL nao e conferido. Uma rota que exigisse o campo quebraria
// todo parcelamento de quem nao usa subcategoria -- e quase todo mundo.

test("parcelar sem subcategoria grava null, e grava a COLUNA", async () => {
  const { resposta, inserts } = await parcelar({ subcategory_id: "" });

  assert.equal(resposta.status, 200);
  for (const linha of inserts[0].linhas) {
    assert.ok("subcategory_id" in linha);
    // `null` e nao `""`: a coluna e uuid, e string vazia volta 22P02 e derruba
    // a serie inteira. E o mesmo `|| null` de `scheduled-transactions`.
    assert.equal(linha.subcategory_id, null);
  }
});

test("corpo SEM a chave (cliente velho) grava null em vez de estourar", async () => {
  const { resposta, inserts } = await parcelar({ comCampo: false });

  assert.equal(resposta.status, 200);
  for (const linha of inserts[0].linhas) {
    assert.equal(linha.subcategory_id, null);
  }
});

// ---------------------------------------------------------------------------
// 3. O LOTE NAO DESCARTA NADA EM SILENCIO
// ---------------------------------------------------------------------------

test("nenhuma coluna e descartada pelo lote do PostgREST", async () => {
  const { inserts } = await parcelar({ subcategory_id: SUBCATEGORIA });

  // O PostgREST monta as colunas a partir da PRIMEIRA linha do array. Uma chave
  // que aparecesse so da segunda parcela em diante sairia do comando sem erro
  // nenhum -- a serie gravaria, o toast diria sucesso, e o campo nao existiria.
  assert.deepEqual(
    inserts[0].descartadas,
    [],
    "ha chave presente em alguma parcela e ausente na primeira: ela nao vai " +
      "para o banco, e nada avisa"
  );
});

// ---------------------------------------------------------------------------
// 4. A TELA MANDA O CAMPO -- E ESTE RECORTE E O QUE FAZ A ASSERCAO VALER
// ---------------------------------------------------------------------------
// A rota acima pode estar perfeita e a serie sair sem subcategoria, porque quem
// preenche o corpo e o formulario. Isso nao aparece na sonda de rota (ela monta
// o corpo a mao) nem no `tsc` (o corpo de um `fetch` e `any` do outro lado).
//
// E UM GUARD DE TEXTO, E ELE TEM DUAS ARMADILHAS CONHECIDAS. AS DUAS ESTAO
// FECHADAS AQUI, e nao por zelo -- a primeira foi MEDIDA neste arquivo:
//
//   1. `FormularioDeLancamento.tsx` JA CONTEM `subcategory_id:`, em
//      `gravarTransacao` (o lancamento avulso) e no corpo da regra fixa. Um
//      guard sobre o arquivo INTEIRO fica verde com o `criarParcelas` sem o
//      campo -- o estado de antes desta issue. Por isso o alvo e o OBJETO que
//      vai no corpo do `fetch` para `/api/financial-installments`, recortado
//      por casamento de chaves, e nao o arquivo;
//
//   2. os comentarios desta feature CITAM o nome do campo (o que esta logo
//      acima da linha, inclusive). Varrendo o fonte cru, o guard leria a propria
//      prosa que descreve o defeito e continuaria verde depois de alguem apagar
//      o codigo e deixar o comentario.

const FORMULARIO = "components/movimentacoes/FormularioDeLancamento.tsx";

/**
 * O objeto literal que vai no corpo do POST para `/api/financial-installments`.
 *
 * Recortado por casamento de chaves a partir do `JSON.stringify({` que segue a
 * URL da rota -- e nao por regex sobre a linha, porque o corpo tem objetos
 * aninhados e uma regex gulosa pegaria metade do componente.
 */
function corpoDoPedidoDeParcelas() {
  const fonte = semComentarios(readFileSync(FORMULARIO, "utf8"));

  const naRota = fonte.indexOf('"/api/financial-installments"');
  assert.ok(
    naRota > 0,
    `${FORMULARIO}: nao ha mais um fetch para "/api/financial-installments". ` +
      "Se a chamada mudou de lugar, este recorte precisa seguir junto -- sem " +
      "isso o guard abaixo passaria por vacuidade."
  );

  const abre = fonte.indexOf("JSON.stringify({", naRota);
  assert.ok(
    abre > 0,
    `${FORMULARIO}: o fetch de parcelas nao monta mais o corpo com JSON.stringify({...}).`
  );

  const inicio = fonte.indexOf("{", abre + "JSON.stringify(".length);
  let profundidade = 0;
  for (let i = inicio; i < fonte.length; i++) {
    if (fonte[i] === "{") profundidade += 1;
    else if (fonte[i] === "}") {
      profundidade -= 1;
      if (profundidade === 0) return fonte.slice(inicio, i + 1);
    }
  }

  assert.fail(`${FORMULARIO}: o objeto do corpo de parcelas nao fecha.`);
}

test("o formulario manda subcategory_id NO CORPO DAS PARCELAS", () => {
  const corpo = corpoDoPedidoDeParcelas();

  // Controle de vacuidade do proprio recorte: se ele tiver pegado o pedaco
  // errado do arquivo, estes dois campos -- que so existem no corpo de parcelas
  // -- nao estariam nele, e a assercao seguinte nao mediria nada.
  assert.match(
    corpo,
    /base:/,
    "o recorte nao e o corpo das parcelas (falta `base:`)"
  );
  assert.match(
    corpo,
    /total_parcelas:/,
    "o recorte nao e o corpo das parcelas (falta `total_parcelas:`)"
  );

  assert.match(
    corpo,
    /subcategory_id:/,
    "o corpo do POST de parcelas NAO leva `subcategory_id`. A pessoa escolhe " +
      "a subcategoria, o toast diz que as parcelas foram criadas, e as M " +
      "linhas nascem sem ela -- sem erro, porque a coluna e nulavel."
  );

  // A ATRIBUICAO INTEIRA, e nao so a chave. Isto foi um mutante SOBREVIVENTE:
  // `subcategory_id: valores.categoriaId || null` tem a chave no lugar certo e
  // manda o id da CATEGORIA como subcategoria. No banco esse par nao existe --
  // a FK composta da 036 recusa com 23503 e a serie inteira nao grava --, ou
  // seja o parcelamento passaria a falhar sempre para quem escolhe
  // subcategoria. Medir so o nome da chave nao distingue os dois casos.
  assert.match(
    corpo,
    /subcategory_id:\s*valores\.subcategoriaId\b/,
    "o corpo de parcelas tem a chave `subcategory_id`, mas ela nao recebe " +
      "`valores.subcategoriaId` -- esta mandando outro campo da tela."
  );
});

test("a amarra da serie continua de pe (installment_parent_id)", async () => {
  // Nao e a feature desta issue, e e justamente por isso que esta aqui: o
  // `insert` do duble passou a devolver ids de verdade para `.select("id")`, e
  // se essa parte mentisse o UPDATE da amarra nunca seria exercido e a sonda
  // estaria medindo meia rota.
  const { escritas } = await parcelar({ subcategory_id: SUBCATEGORIA });
  const amarra = escritas.find((e) => e.verbo === "update");

  assert.ok(amarra, "a serie foi gravada e nao foi amarrada");
  assert.equal(amarra.patch.installment_parent_id, "financial_transactions-1");
});
