#!/usr/bin/env node
// =====================================================
// PULODOGATO - a subcategoria atravessa o POST de lancamento (HMO-224)
// =====================================================
//   npm run test:subcategoria-no-lancamento
//
// A ARMADILHA PLANTADA, E POR QUE ELA NAO APARECIA EM NADA
// -------------------------------------------------------
// `app/api/personal-finance/transactions/route.ts` (POST) desestruturava o
// corpo em `description, amount, category_id, transaction_date, notes,
// is_shared, splits, group_id, transaction_type` -- sem `subcategory_id` --, e o
// INSERT tambem nao listava a coluna. Quem postasse ali criava lancamento com
// subcategoria NULA, em silencio: 201, corpo completo de volta, nenhum erro.
//
// Isso nao afetava ninguem quando a HMO-224 foi escrita, e e por isso que nao
// entrou na HMO-216: medido na `main`, nenhuma tela fazia POST nesta rota. O
// formulario grava pelo cliente do navegador
// (`.from("financial_transactions").insert(...)` em
// `components/movimentacoes/FormularioDeLancamento.tsx`), que JA passava
// `subcategory_id`. Da rota o app so usava `DELETE /[id]` e o `export`.
//
// O risco era o reaproveitamento: a rota existe, parece a maneira certa de
// criar lancamento pela API, e o proximo caminho que a usasse (fila offline,
// importador, integracao, um app novo) perderia a subcategoria sem sintoma.
// `docs/TESTING_GUIDE.md` ainda a lista como endpoint testado.
//
// POR QUE ISTO E UMA SONDA DE ROTA, E NAO UM GUARD DE TEXTO NEM O TSC
// -------------------------------------------------------------------
// O defeito era uma AUSENCIA em dois lugares, e nenhum dos dois e visivel para
// o compilador: `request.json()` devolve `any`, entao desestruturar um campo que
// ninguem manda compila, e o objeto literal que vai para o `.insert()` do
// supabase-js esta na fronteira permissiva do client -- apagar a linha compila.
//
// Um guard de texto tambem nao serve, e por dois motivos distintos. O primeiro
// e que a rota responde 201 com o corpo completo COM e SEM o campo, entao nao
// ha nada na resposta para casar. O segundo e o de sempre neste repositorio: o
// comentario que descreve o defeito cita o nome do campo, e uma varredura do
// fonte cru leria a propria prosa e continuaria verde depois de alguem apagar o
// codigo (ver o guard de fonte da HMO-218, que precisou recortar o objeto).
//
// O que corresponde a promessa e CHAMAR o handler e olhar o PAYLOAD que ele
// mandou gravar, mais a linha RELIDA pela propria rota. E o que o duble guarda
// em `escritas` (HMO-218) e o que a releitura devolve (HMO-224 fez o `insert`
// do duble ficar legivel por uma leitura posterior, como o banco faz).
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import { criarDuble } from "./duble-de-supabase.mjs";

const ROTA = await import(
  "../.tmp-subcategoria-no-lancamento/app/api/personal-finance/transactions/route.js"
);

const DONO = "dono-1";
const SERVICO = "servico-financas";
const CATEGORIA = "cat-mercado";
// DIFERENTE da categoria de proposito. `subcategory_id: category_id` tem a
// chave no lugar certo e manda o id errado -- um par que a FK composta recusa
// com 23503. Com os dois ids iguais a assercao de valor nao distinguiria os
// dois casos.
const SUBCATEGORIA = "sub-feira";
const GRUPO = "grupo-1";

/**
 * Chama o POST da rota com um duble, e devolve a resposta, o payload gravado e
 * a linha que a propria rota releu.
 *
 * `comCampo: false` OMITE a chave em vez de manda-la vazia. As duas coisas sao
 * diferentes para a rota: `""` passa pelo `|| null` e `undefined` nem chega a
 * ser lido. Um cliente velho (a fila offline de uma aba antiga, o importador
 * que a issue cita) manda o corpo sem a chave, e esse caso tem de gravar
 * `null`, nao estourar.
 */
async function lancar({
  subcategory_id,
  comCampo = true,
  category_id = CATEGORIA,
  is_expense = true,
  group_id = null,
  amount = 100,
} = {}) {
  const sessao = criarDuble({
    user: { id: DONO },
    tabelas: {
      financial_services: [{ id: SERVICO, name: "personal_finance" }],
      transaction_categories: [{ id: category_id, is_expense }],
      // Semeada (ainda que vazia) de proposito: e a chave em `tabelas` que da
      // ao `insert` do duble um array onde acumular, e sem ela a releitura da
      // rota nao acharia a linha. Ver o `linhas.push` em duble-de-supabase.mjs.
      financial_transactions: [],
      group_members: group_id
        ? [{ id: "membro-1", group_id, user_id: DONO, status: "active" }]
        : [],
    },
  });

  const registro = { sessao: () => sessao.client };
  globalThis.__dubleDeSupabase = registro;

  const corpoDoPedido = {
    description: "Mercado do mês",
    amount,
    category_id,
    transaction_date: "2026-10-04",
    notes: null,
    is_shared: false,
    group_id,
  };

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

  return { resposta, corpo, inserts, escritas: sessao.escritas, sessao };
}

// ---------------------------------------------------------------------------
// 1. O CAMPO CHEGA AO BANCO
// ---------------------------------------------------------------------------

test("a subcategoria postada vai no INSERT de financial_transactions", async () => {
  const { resposta, inserts } = await lancar({
    subcategory_id: SUBCATEGORIA,
  });

  assert.equal(resposta.status, 201);
  assert.equal(inserts.length, 1, "o lancamento tem de ir num INSERT unico");

  const [linha] = inserts[0].linhas;

  // `in` e nao `!= null`: a diferenca entre "gravou null" e "a coluna nao foi
  // no comando" e exatamente o defeito desta issue -- a rota mandava um objeto
  // SEM a chave, e o PostgREST nao grava coluna que nao esta no comando.
  assert.ok(
    "subcategory_id" in linha,
    "o lancamento foi para o banco SEM a coluna subcategory_id -- e o defeito " +
      "da HMO-224: 201, nenhum erro, e a subcategoria escolhida desaparece."
  );
  assert.equal(
    linha.subcategory_id,
    SUBCATEGORIA,
    "o lancamento gravou outra coisa no lugar da subcategoria postada"
  );
});

test("a categoria e a subcategoria vao JUNTAS -- o par e o que a FK confere", async () => {
  // A FK composta da 036 e `(category_id, subcategory_id)`. Uma linha com a
  // subcategoria e sem a categoria nao e "meio certa": e um par que o banco
  // recusa com 23503, e o lancamento nao grava. Medir so a subcategoria
  // deixaria passar uma rota que perdesse a categoria no caminho.
  const { inserts } = await lancar({ subcategory_id: SUBCATEGORIA });
  const [linha] = inserts[0].linhas;

  assert.equal(linha.category_id, CATEGORIA);
  assert.equal(linha.subcategory_id, SUBCATEGORIA);
});

test("a releitura da rota devolve a subcategoria no corpo da resposta", async () => {
  // "poste pela rota com subcategoria e releia a linha", que e o teste que a
  // issue pede. A rota relê a linha que acabou de criar
  // (`.select("*, ...").eq("id", ...).single()`) e e ESSE corpo que um cliente
  // de API ve. A releitura tem de carregar a coluna: um `select` que trocasse
  // o `*` por uma lista explicita de colunas sem `subcategory_id` gravaria
  // certo no banco e devolveria a subcategoria vazia para quem postou.
  const { corpo } = await lancar({ subcategory_id: SUBCATEGORIA });

  assert.ok(corpo.transaction, "a rota nao releu a linha que criou");
  assert.equal(
    corpo.transaction.subcategory_id,
    SUBCATEGORIA,
    "a linha relida pela rota nao traz a subcategoria"
  );
});

test("receita tambem leva subcategoria (o campo nao e so de despesa)", async () => {
  // `is_expense` decide tipo e sinal, e o `isExpense` resultante e guarda do
  // vinculo de grupo e dos splits. Nada disso tem a ver com a subcategoria --
  // mas um conserto que pendurasse o campo dentro de um desses ramos sairia
  // verde no teste de despesa e perderia a subcategoria de toda receita.
  const { resposta, inserts } = await lancar({
    subcategory_id: SUBCATEGORIA,
    is_expense: false,
  });

  assert.equal(resposta.status, 201);
  const [linha] = inserts[0].linhas;
  assert.equal(linha.transaction_type, "income");
  assert.equal(linha.subcategory_id, SUBCATEGORIA);
});

test("despesa de grupo tambem leva subcategoria", async () => {
  // O ramo de grupo faz escritas a mais (`group_transactions`,
  // `group_expense_splits`) DEPOIS do insert do lancamento. Se o campo
  // dependesse da ordem dessas escritas, este caso pegaria.
  const { resposta, inserts } = await lancar({
    subcategory_id: SUBCATEGORIA,
    group_id: GRUPO,
  });

  assert.equal(resposta.status, 201);
  const [linha] = inserts[0].linhas;
  assert.equal(linha.group_id, GRUPO);
  assert.equal(linha.subcategory_id, SUBCATEGORIA);
});

// ---------------------------------------------------------------------------
// 2. SEM SUBCATEGORIA CONTINUA PASSANDO
// ---------------------------------------------------------------------------
// O `MATCH SIMPLE` da FK composta e o que faz isto valer no banco: par com
// `subcategory_id` NULL nao e conferido. Uma rota que exigisse o campo
// quebraria todo lancamento de quem nao usa subcategoria -- e quase todo mundo.

test("postar sem subcategoria grava null, e grava a COLUNA", async () => {
  const { resposta, inserts } = await lancar({ subcategory_id: "" });

  assert.equal(resposta.status, 201);
  const [linha] = inserts[0].linhas;

  assert.ok("subcategory_id" in linha);
  // `null` e nao `""`: a coluna e uuid, e string vazia volta 22P02 e derruba o
  // lancamento inteiro. E o mesmo `|| null` de `scheduled-transactions`.
  assert.equal(linha.subcategory_id, null);
});

test("corpo SEM a chave (cliente velho) grava null em vez de estourar", async () => {
  const { resposta, inserts } = await lancar({ comCampo: false });

  assert.equal(resposta.status, 201);
  const [linha] = inserts[0].linhas;
  assert.ok(
    "subcategory_id" in linha,
    "corpo sem a chave deixou a coluna fora do comando em vez de gravar null"
  );
  assert.equal(linha.subcategory_id, null);
});

// ---------------------------------------------------------------------------
// 3. A ROTA NAO INVENTA VALIDACAO DE PAR
// ---------------------------------------------------------------------------

test("o par que a rota nao sabe conferir vai ao banco INTEIRO, para a FK recusar", async () => {
  // A issue e explicita: "deixar a FK composta
  // `financial_transactions_subcategoria_da_categoria` recusar par invalido
  // (ela existe e esta validada em prod)". Ou seja a rota NAO consulta
  // `transaction_subcategories` para conferir o par.
  //
  // Isto esta medido porque o conserto "zeloso" e pior que o defeito: uma
  // validacao em TypeScript que nao achasse a subcategoria e caisse para
  // `null` gravaria o lancamento SEM subcategoria -- de novo em silencio, de
  // novo com 201, e agora com um guard verde em cima. O banco e o arbitro.
  const { resposta, inserts, sessao } = await lancar({
    subcategory_id: "sub-de-outra-categoria",
  });

  assert.equal(
    resposta.status,
    201,
    "a rota passou a recusar o par por conta propria; quem confere e a FK"
  );
  assert.equal(
    inserts[0].linhas[0].subcategory_id,
    "sub-de-outra-categoria",
    "a rota reescreveu a subcategoria postada em vez de manda-la ao banco"
  );

  const consultouSubcategorias = sessao.lidas.some(
    (l) => l.tabela === "transaction_subcategories"
  );
  assert.equal(
    consultouSubcategorias,
    false,
    "a rota passou a validar o par em TypeScript -- uma segunda copia da regra " +
      "da FK, que diverge dela no primeiro conserto que so uma das duas receber"
  );
});

// ---------------------------------------------------------------------------
// 4. O LOTE NAO DESCARTA NADA EM SILENCIO
// ---------------------------------------------------------------------------

test("nenhuma coluna e descartada pelo lote do PostgREST", async () => {
  const { inserts } = await lancar({ subcategory_id: SUBCATEGORIA });

  // Aqui o lote tem uma linha so, entao a lista estar vazia e barato -- e o
  // valor da assercao e nao deixar de medir isso se a rota passar a inserir em
  // lote algum dia (as parcelas da HMO-211 ja inserem N linhas, e lá uma chave
  // ausente na PRIMEIRA linha sai do comando de TODAS, sem erro nenhum).
  assert.deepEqual(
    inserts[0].descartadas,
    [],
    "ha chave presente em alguma linha e ausente na primeira: ela nao vai " +
      "para o banco, e nada avisa"
  );
});
