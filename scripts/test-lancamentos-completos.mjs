// =====================================================
// PULODOGATO - HMO-215: "todos os lancamentos, e o destino"
// =====================================================
//   npm run test:lancamentos-completos
//
// Duas perguntas que a lista de Financas Pessoais nao sabia responder:
//
//   1. PARA ONDE O DINHEIRO FOI (lib/destino-do-lancamento.ts). `account_id`
//      esta na linha desde o 001 e nao tinha leitor. O caso que manda e a
//      transferencia: as duas pernas sao duas linhas com a mesma descricao e o
//      mesmo valor, e o elo entre elas e de UMA VIA so (015) -- so a perna de
//      entrada grava `counterpart_transaction_id`. Um indice ingenuo deixa toda
//      perna de SAIDA sem contraparte, que e exatamente a linha que a pessoa
//      esta olhando quando pergunta para onde o dinheiro foi.
//
//   2. A DESPESA DE GRUPO QUE OUTRO PAGOU (lib/parte-de-grupo-na-lista.ts). A
//      minha parte esta gravada em `group_expense_splits` e o painel ja a conta
//      (033), mas a LISTA nunca a mostrou. Os erros caros aqui sao de sinal (a
//      view devolve positivo; a lista espera negativo) e de contagem dupla (a
//      view tambem devolve a MINHA parte da despesa que eu mesmo paguei, cuja
//      linha inteira ja esta na lista).
//
// Compilado e rodado como os outros testes de lib/: tsc -> resolve-aliases ->
// node --test. Ver scripts/tsconfig.lancamentos-completos-test.json.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  destinoDoLancamento,
  indiceDeContraparte,
  indiceVazio,
  contraparteDe,
} = await import("../.tmp-lancamentos-completos/destino-do-lancamento.js");

const {
  partesDeTerceirosNaLista,
  totalDasPartesDeTerceiros,
  notaDasPartesDeTerceiros,
  linhasDaLista,
  contarComPartes,
} = await import("../.tmp-lancamentos-completos/parte-de-grupo-na-lista.js");

// -----------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------

const conta = (id, name, account_type = "checking") => ({ id, name, account_type });

const ITAU = conta("c1", "Itaú Corrente");
const POUPANCA = conta("c2", "Poupança");
const NUBANK = conta("c3", "Nubank", "credit_card");

/** Uma despesa comum, paga por uma conta. */
const despesa = (over = {}) => ({
  id: "t-despesa",
  amount: -180,
  transaction_type: "expense",
  account_id: ITAU.id,
  account: ITAU,
  transaction_date: "2026-09-12",
  ...over,
});

const receita = (over = {}) => ({
  id: "t-receita",
  amount: 5000,
  transaction_type: "income",
  account_id: ITAU.id,
  account: ITAU,
  transaction_date: "2026-09-05",
  ...over,
});

/**
 * As DUAS pernas de uma transferencia, como a rota as grava: so a entrada
 * aponta para a saida (app/api/movimentacoes/transferencia/route.ts).
 */
function pernas({ valor = 1000, de = ITAU, para = POUPANCA, data = "2026-09-20" } = {}) {
  const saida = {
    id: "t-saida",
    amount: -valor,
    transaction_type: "transfer",
    account_id: de.id,
    account: de,
    counterpart_transaction_id: null,
    transaction_date: data,
  };
  const entrada = {
    id: "t-entrada",
    amount: valor,
    transaction_type: "transfer",
    account_id: para.id,
    account: para,
    counterpart_transaction_id: saida.id,
    transaction_date: data,
  };
  return { saida, entrada };
}

// =================================================================
// 1. O DESTINO
// =================================================================

test("receita: a conta e o DESTINO -- o dinheiro entrou nela", () => {
  const d = destinoDoLancamento(receita());
  assert.equal(d.destino, "Itaú Corrente");
  assert.equal(d.origem, null);
  assert.equal(d.texto, "para Itaú Corrente");
  assert.equal(d.faltaConta, false);
});

test("despesa: a conta e a ORIGEM -- o dinheiro saiu dela", () => {
  const d = destinoDoLancamento(despesa());
  assert.equal(d.origem, "Itaú Corrente");
  assert.equal(d.destino, null);
  assert.equal(d.texto, "de Itaú Corrente");
});

test("despesa no cartao: a frase nomeia o cartao, e nao uma conta qualquer", () => {
  const d = destinoDoLancamento(despesa({ account_id: NUBANK.id, account: NUBANK }));
  assert.equal(d.texto, "de Nubank");
});

test("sem conta registrada a frase admite a falta, e nao inventa nome", () => {
  const d = destinoDoLancamento(despesa({ account_id: null, account: null }));
  assert.equal(d.texto, "Sem conta");
  assert.equal(d.faltaConta, true);
  assert.equal(d.origem, null);
  assert.equal(d.destino, null);
});

test("conta com nome em branco conta como conta ausente", () => {
  const d = destinoDoLancamento(despesa({ account: { id: "c9", name: "   " } }));
  assert.equal(d.faltaConta, true);
  assert.equal(d.texto, "Sem conta");
});

test("transferencia: as duas pernas desenham a MESMA seta, no mesmo sentido", () => {
  const { saida, entrada } = pernas();
  const indice = indiceDeContraparte([saida, entrada]);

  const daSaida = destinoDoLancamento(saida, indice);
  const daEntrada = destinoDoLancamento(entrada, indice);

  assert.equal(daSaida.texto, "Itaú Corrente → Poupança");
  assert.equal(daEntrada.texto, "Itaú Corrente → Poupança");
  assert.equal(daSaida.origem, "Itaú Corrente");
  assert.equal(daSaida.destino, "Poupança");
  assert.deepEqual(daEntrada, daSaida);
});

test("o elo e de uma via: a perna de SAIDA ainda acha a contraparte", () => {
  // Este e o caso que um `Map` de ids sozinho perde. A saida tem
  // `counterpart_transaction_id: null` -- quem grava o elo e a entrada.
  const { saida, entrada } = pernas();
  const indice = indiceDeContraparte([saida, entrada]);

  assert.equal(saida.counterpart_transaction_id, null);
  assert.equal(contraparteDe(saida, indice)?.id, "t-entrada");
  assert.equal(contraparteDe(entrada, indice)?.id, "t-saida");
});

test("transferencia com a contraparte fora da pagina: meia seta, nunca", () => {
  // A paginacao corta em 50 linhas e as duas pernas podem cair em paginas
  // diferentes. A frase fala so da ponta conhecida.
  const { saida, entrada } = pernas();

  const soASaida = destinoDoLancamento(saida, indiceDeContraparte([saida]));
  assert.equal(soASaida.texto, "saiu de Itaú Corrente");
  assert.equal(soASaida.destino, null);
  assert.ok(!soASaida.texto.includes("→"));

  const soAEntrada = destinoDoLancamento(entrada, indiceDeContraparte([entrada]));
  assert.equal(soAEntrada.texto, "entrou em Poupança");
  assert.equal(soAEntrada.origem, null);
  assert.ok(!soAEntrada.texto.includes("→"));
});

test("a perna sem conta mas com contraparte conhecida nao inverte o caminho", () => {
  // A saida esta sem conta; a entrada (contraparte) caiu na Poupanca. O destino
  // do dinheiro e a Poupanca -- dizer "saiu de Poupança" seria o caminho ao
  // contrario, com a cara de fato.
  const { saida, entrada } = pernas();
  const semConta = { ...saida, account_id: null, account: null };
  const indice = indiceDeContraparte([semConta, entrada]);

  const d = destinoDoLancamento(semConta, indice);
  assert.equal(d.texto, "entrou em Poupança");
  assert.equal(d.destino, "Poupança");
  assert.equal(d.origem, null);
});

test("transferencia de valor zero nao recebe palpite de direcao", () => {
  const { saida, entrada } = pernas({ valor: 0 });
  const indice = indiceDeContraparte([saida, entrada]);
  const d = destinoDoLancamento(saida, indice);

  assert.ok(!d.texto.includes("→"));
  assert.equal(d.origem, null);
  assert.equal(d.destino, null);
  assert.ok(d.texto.includes("Itaú Corrente"));
  assert.ok(d.texto.includes("Poupança"));
});

test("linha antiga sem transaction_type cai na regra da categoria, nao no sinal", () => {
  // `classificarMovimentacao` usa a categoria antes do sinal: um estorno de
  // despesa chega POSITIVO e continua sendo despesa. A frase tem que acompanhar
  // -- "para Itaú" num estorno de despesa diria que entrou dinheiro novo.
  const estorno = {
    id: "t-velha",
    amount: 180,
    transaction_type: null,
    account: ITAU,
    category: { is_expense: true },
  };
  assert.equal(destinoDoLancamento(estorno).texto, "de Itaú Corrente");
});

test("indiceVazio nao quebra: a linha solta ainda tem frase", () => {
  assert.equal(destinoDoLancamento(receita(), indiceVazio()).texto, "para Itaú Corrente");
  const { saida } = pernas();
  assert.equal(destinoDoLancamento(saida).texto, "saiu de Itaú Corrente");
});

// =================================================================
// 2. A PARTE DE GRUPO QUE OUTRO PAGOU
// =================================================================

/** O hotel de R$ 400 que a Ana pagou, rateado 200/200 com a Bia. */
const HOTEL = {
  id: "tx-hotel",
  description: "Hotel em Paraty",
  amount: -400,
  category: { id: "cat-lazer", name: "Lazer", color_hex: "#06B6D4" },
};

const parteDaBia = (over = {}) => ({
  id: "split-bia",
  transaction_id: HOTEL.id,
  group_id: "g-viagem",
  transaction_date: "2026-09-18",
  category_id: "cat-lazer",
  transaction_type: "expense",
  currency: "BRL",
  amount: 200, // POSITIVO, como group_share_entries grava
  split_status: "approved",
  paguei_eu: false,
  ...over,
});

const despesasLidas = () => new Map([[HOTEL.id, HOTEL]]);

test("a parte de quem NAO pagou entra na lista, com a descricao da despesa", () => {
  const { linhas, semDescricao } = partesDeTerceirosNaLista(
    [parteDaBia()],
    despesasLidas()
  );

  assert.equal(semDescricao, 0);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].description, "Hotel em Paraty");
  assert.equal(linhas[0].groupId, "g-viagem");
  assert.equal(linhas[0].categoria.name, "Lazer");
  assert.equal(linhas[0].transactionId, "tx-hotel");
});

test("a parte entra NEGATIVA -- a view devolve positivo e a lista pinta pelo sinal", () => {
  const { linhas } = partesDeTerceirosNaLista([parteDaBia()], despesasLidas());
  assert.equal(linhas[0].amount, -200);
  assert.ok(linhas[0].amount < 0, "parte positiva apareceria em verde, como receita");
  assert.equal(linhas[0].totalDaDespesa, -400);
});

test("a view mudando de sinal nao transforma a parte em receita", () => {
  const { linhas } = partesDeTerceirosNaLista(
    [parteDaBia({ amount: -200 })],
    despesasLidas()
  );
  assert.equal(linhas[0].amount, -200);
});

test("a parte da despesa que EU paguei nao entra: a linha cheia ja esta na lista", () => {
  // Para a Ana a view devolve as duas partes do hotel. A dela e `paguei_eu`, e
  // os R$ 400 inteiros ja estao na lista como transacao dela. Somar a parte
  // mostraria o hotel duas vezes, totalizando R$ 600 de um gasto de R$ 400.
  const { linhas } = partesDeTerceirosNaLista(
    [parteDaBia({ id: "split-ana", paguei_eu: true }), parteDaBia()],
    despesasLidas()
  );

  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].id, "parte:split-bia");
  assert.equal(totalDasPartesDeTerceiros(linhas), 200);
});

test("o id da linha e prefixado: ele nao pode cair numa rota de transacao", () => {
  const { linhas } = partesDeTerceirosNaLista([parteDaBia()], despesasLidas());
  assert.equal(linhas[0].id, "parte:split-bia");
  assert.notEqual(linhas[0].id, "split-bia");
  assert.notEqual(linhas[0].id, HOTEL.id);
});

test("parte sem a despesa correspondente e descartada e CONTADA", () => {
  const { linhas, semDescricao } = partesDeTerceirosNaLista(
    [parteDaBia(), parteDaBia({ id: "split-x", transaction_id: "tx-sumida" })],
    despesasLidas()
  );

  assert.equal(linhas.length, 1);
  assert.equal(semDescricao, 1);
});

test("o rateio pendente aparece, com o status para a tela rotular", () => {
  const { linhas } = partesDeTerceirosNaLista(
    [parteDaBia({ split_status: "pending" })],
    despesasLidas()
  );
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].splitStatus, "pending");
});

test("sem parte nenhuma a nota e null, e nao uma frase com zero", () => {
  assert.equal(notaDasPartesDeTerceiros([]), null);

  const { linhas } = partesDeTerceirosNaLista([parteDaBia()], despesasLidas());
  assert.deepEqual(notaDasPartesDeTerceiros(linhas), { quantas: 1, total: 200 });
});

// =================================================================
// 3. A LISTA UNICA
// =================================================================

test("as partes aparecem em Lançamentos e em Despesas, e em mais nenhuma aba", () => {
  const { linhas: partes } = partesDeTerceirosNaLista(
    [parteDaBia()],
    despesasLidas()
  );
  const minhas = [receita(), despesa()];

  const todos = linhasDaLista(minhas, partes, "todos");
  assert.equal(todos.filter((l) => l.kind === "parte").length, 1);

  const gastos = linhasDaLista(minhas, partes, "expense");
  assert.equal(gastos.filter((l) => l.kind === "parte").length, 1);

  for (const aba of ["income", "transfer"]) {
    const linhas = linhasDaLista(minhas, partes, aba);
    assert.equal(
      linhas.filter((l) => l.kind === "parte").length,
      0,
      `a parte de grupo apareceu na aba "${aba}"`
    );
  }
});

test("a lista sai em ordem de data decrescente, misturando as duas fontes", () => {
  // Sem reordenar, as partes ficariam todas no fim -- as de setembro abaixo das
  // minhas de marco, como se fossem de outro periodo.
  const { linhas: partes } = partesDeTerceirosNaLista(
    [parteDaBia({ transaction_date: "2026-09-18" })],
    despesasLidas()
  );
  const minhas = [
    { ...despesa(), id: "t-nova", transaction_date: "2026-09-25" },
    { ...despesa(), id: "t-velha", transaction_date: "2026-03-02" },
  ];

  const datas = linhasDaLista(minhas, partes, "todos").map((l) =>
    l.kind === "minha" ? l.mov.transaction_date : l.parte.transactionDate
  );

  assert.deepEqual(datas, ["2026-09-25", "2026-09-18", "2026-03-02"]);
});

test("no mesmo dia a ordem das minhas linhas e preservada", () => {
  const minhas = [
    { ...despesa(), id: "a", transaction_date: "2026-09-12" },
    { ...despesa(), id: "b", transaction_date: "2026-09-12" },
    { ...despesa(), id: "c", transaction_date: "2026-09-12" },
  ];
  const ids = linhasDaLista(minhas, [], "todos").map((l) => l.mov.id);
  assert.deepEqual(ids, ["a", "b", "c"]);
});

test("a contagem da barra casa com a lista, nas quatro abas", () => {
  const { linhas: partes } = partesDeTerceirosNaLista(
    [parteDaBia()],
    despesasLidas()
  );
  const { saida, entrada } = pernas();
  const minhas = [receita(), despesa(), saida, entrada];

  const contagem = contarComPartes(minhas, partes);

  for (const aba of ["todos", "income", "expense", "transfer"]) {
    assert.equal(
      linhasDaLista(minhas, partes, aba).length,
      contagem[aba],
      `a aba "${aba}" mostra um numero diferente do que a barra anuncia`
    );
  }

  assert.equal(contagem.todos, 5);
  assert.equal(contagem.expense, 2); // a minha despesa + a parte da Bia
  assert.equal(contagem.income, 1);
  assert.equal(contagem.transfer, 2); // as duas pernas
});

test("sem partes, a contagem e a mesma de antes desta issue", () => {
  const { saida, entrada } = pernas();
  const contagem = contarComPartes([receita(), despesa(), saida, entrada], []);
  assert.deepEqual(contagem, { todos: 4, income: 1, expense: 1, transfer: 2 });
});
