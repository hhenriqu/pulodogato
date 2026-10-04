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
  resumoComPartesDeGrupo,
} = await import("../.tmp-lancamentos-completos/parte-de-grupo-na-lista.js");

// O CRITERIO ANTIGO, DE PROPOSITO DUPLICADO AQUI (controle negativo da HMO-275).
//
// Ate a HMO-275 os tres cartoes somavam `resumoDoPeriodo(transactions)` -- so as
// MINHAS linhas. Se a assercao nova passar e esta soma antiga passar TAMBEM com
// o mesmo numero, a janela do teste esta cega: a parte de grupo nao chegou a
// entrar em lugar nenhum.
//
// O controle e a propria `resumoDoPeriodo`, e nao uma soma escrita a mao aqui,
// por dois motivos: (a) ela E o criterio antigo, literalmente o codigo que esta
// tela chamava antes desta issue; (b) uma soma por sinal escrita a mao contaria
// as DUAS pernas de uma transferencia, que e o defeito que
// `resumoDoPeriodo` existe para nao ter -- o controle sairia errado e acusaria o
// fonte certo. Ela mora em lib/movimentacoes.ts, que esta issue nao toca, entao
// ela nao se move junto com o que audita.
const { resumoDoPeriodo } = await import(
  "../.tmp-lancamentos-completos/movimentacoes.js"
);

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

// =================================================================
// 4. OS TRES CARTOES, COM A PARTE DE GRUPO DENTRO (HMO-275)
// =================================================================
// A armadilha numero 1 do bloco 2 da HMO-245: **o saldo fica certo enquanto os
// dois cartoes incham**. Uma assercao sobre `saldo` passa verde com Receitas e
// Despesas completamente errados, porque os erros se anulam -- e e o defeito de
// `duas-pernas-mantem-o-total-certo`, que durou meses em producao.
//
// Por isso nenhum teste desta secao afirma sobre o saldo sozinho. Receitas e
// Despesas sao afirmados EM SEPARADO, e o saldo so aparece como consequencia
// verificada dos dois (que e a legenda escrita no cartao: "Receitas -
// Despesas").

/** O mes da Bia: um salario, uma despesa dela, e a parte dela do hotel da Ana. */
function mesDaBia() {
  const { linhas: partes } = partesDeTerceirosNaLista(
    [parteDaBia()],
    despesasLidas()
  );
  return { minhas: [receita(), despesa()], partes };
}

test("a parte de grupo SOMA em Despesas, e Receitas nao se mexe", () => {
  const { minhas, partes } = mesDaBia();
  const r = resumoComPartesDeGrupo(minhas, partes);

  // Duas assercoes separadas, nunca uma sobre o saldo. 180 da despesa dela +
  // 200 da parte do hotel.
  assert.equal(r.despesas, 380, "a parte de grupo nao entrou no cartao Despesas");
  assert.equal(r.receitas, 5000, "Receitas mudou -- o lado do reembolso e a F10");
});

test("CONTROLE NEGATIVO: o criterio ANTIGO nao ve a parte -- a janela enxerga", () => {
  // Se este numero fosse igual ao de cima, o teste acima estaria passando sem
  // que nada tivesse mudado. A diferenca E a entrega desta issue.
  const { minhas, partes } = mesDaBia();

  const antigo = resumoDoPeriodo(minhas);
  const novo = resumoComPartesDeGrupo(minhas, partes);

  assert.equal(antigo.despesas, 180);
  assert.notEqual(
    novo.despesas,
    antigo.despesas,
    "o criterio novo e o antigo deram o MESMO total de despesas: a parte de grupo nao entrou"
  );
  assert.equal(novo.despesas - antigo.despesas, 200);

  // E o lado que NAO devia andar: aqui os dois criterios tem que concordar.
  assert.equal(novo.receitas, antigo.receitas);
});

test("CONTROLE: o mesmo mes SEM despesa de grupo da o numero de antes desta issue", () => {
  // Prova que a soma nova nao vaza para quem nao participa de grupo, e que a
  // assercao de cima podia falhar.
  const { minhas } = mesDaBia();
  const r = resumoComPartesDeGrupo(minhas, []);

  assert.equal(r.despesas, 180);
  assert.equal(r.receitas, 5000);
  assert.deepEqual(r, resumoDoPeriodo(minhas));
});

test("o saldo e RECALCULADO: ele nao pode ser o saldo de antes da parte entrar", () => {
  // O erro de uma linha: somar em `despesas` e repassar o `saldo` que
  // `resumoDoPeriodo` devolveu. Os tres cartoes ficariam se contradizendo na
  // mesma tela, embaixo da legenda "Receitas - Despesas".
  const { minhas, partes } = mesDaBia();
  const r = resumoComPartesDeGrupo(minhas, partes);

  assert.equal(r.saldo, r.receitas - r.despesas, "o saldo nao fecha com os dois cartoes");
  assert.equal(r.saldo, 4620);
  assert.notEqual(
    r.saldo,
    resumoDoPeriodo(minhas).saldo,
    "o saldo ficou no valor de antes da parte entrar"
  );
});

test("a parte de quem EU paguei nao infla o cartao: R$ 400 continuam R$ 400", () => {
  // O mes da Ana: ela lancou o hotel inteiro (-400) e a view do 033 devolve
  // tambem a parte DELA (paguei_eu). Se aquela parte chegasse ao cartao, os
  // R$ 400 virariam R$ 600 -- e o numero continuaria plausivel.
  const hotelDaAna = { ...despesa(), id: "tx-hotel", amount: -400 };
  const { linhas: partes } = partesDeTerceirosNaLista(
    [parteDaBia({ id: "split-ana", paguei_eu: true })],
    despesasLidas()
  );

  assert.equal(partes.length, 0);
  const r = resumoComPartesDeGrupo([hotelDaAna], partes);
  assert.equal(r.despesas, 400);
  assert.equal(r.receitas, 0);
});

test("a parte PENDENTE soma: o dinheiro e devido antes de eu aprovar o rateio", () => {
  // Regra decidida no plano: `group_share_entries` ja descarta `rejected` e
  // `expired`, e `pending` e o criterio que a 033 usa no painel. O selo
  // "a aprovar" continua na linha -- ele nao muda o total.
  const { linhas: partes } = partesDeTerceirosNaLista(
    [parteDaBia({ split_status: "pending" })],
    despesasLidas()
  );
  const r = resumoComPartesDeGrupo([despesa()], partes);

  assert.equal(r.despesas, 380);
  assert.equal(partes[0].splitStatus, "pending");
});

test("duas partes de grupos diferentes somam as duas", () => {
  const JANTAR = {
    id: "tx-jantar",
    description: "Jantar",
    amount: -90,
    category: null,
  };
  const { linhas: partes } = partesDeTerceirosNaLista(
    [
      parteDaBia(),
      parteDaBia({
        id: "split-jantar",
        transaction_id: JANTAR.id,
        group_id: "g-casa",
        amount: 30,
      }),
    ],
    new Map([
      [HOTEL.id, HOTEL],
      [JANTAR.id, JANTAR],
    ])
  );

  const r = resumoComPartesDeGrupo([], partes);
  assert.equal(r.despesas, 230);
  assert.equal(r.receitas, 0);
});

test("a parte descartada por falta de descricao nao entra no cartao", () => {
  // `partesDeTerceirosNaLista` descarta a parte sem a despesa correspondente e
  // CONTA o descarte (a tela avisa). O cartao tem que concordar com a lista:
  // somar uma linha que a lista nao mostra deixaria a pessoa sem como conferir.
  const { linhas: partes, semDescricao } = partesDeTerceirosNaLista(
    [parteDaBia(), parteDaBia({ id: "split-x", transaction_id: "tx-sumida" })],
    despesasLidas()
  );

  assert.equal(semDescricao, 1);
  assert.equal(resumoComPartesDeGrupo([], partes).despesas, 200);
});

test("transferido e transferencias passam inteiros: a parte nao e transferencia", () => {
  const { saida, entrada } = pernas();
  const { partes } = mesDaBia();
  const minhas = [receita(), despesa(), saida, entrada];

  const r = resumoComPartesDeGrupo(minhas, partes);

  assert.equal(r.transferido, 1000, "contou as duas pernas, ou perdeu a frase do saldo");
  assert.equal(r.transferencias, 2);
  // E a transferencia continua fora dos dois cartoes, com ou sem parte.
  assert.equal(r.despesas, 380);
  assert.equal(r.receitas, 5000);
});

test("a nota do cartao de Despesas casa com o que foi somado nele", () => {
  // A frase embaixo do cartao ("inclui R$ X de N despesas de grupo...") e o
  // unico jeito de a pessoa conferir a diferenca entre o cartao e a soma das
  // linhas que ela reconhece como suas. Se ela discordar do que entrou, a
  // conferencia aponta para o lugar errado.
  const { minhas, partes } = mesDaBia();
  const nota = notaDasPartesDeTerceiros(partes);
  const r = resumoComPartesDeGrupo(minhas, partes);

  assert.equal(nota.total, r.despesas - resumoDoPeriodo(minhas).despesas);
  assert.equal(nota.quantas, partes.length);
});
