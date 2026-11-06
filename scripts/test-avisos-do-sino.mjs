// =====================================================
// TESTES - OS AVISOS DO SINO DO CABECALHO
// =====================================================
//   npm run test:avisos-do-sino
//
// O que esta suite protege: que o sino avise as quatro familias (vencimento,
// fechamento de cartao, fechamento de grupo, aprovacao), na janela certa, e que
// o "lido" de um evento nao silencie o proximo.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  avisoDeDivisaoParaAprovar,
  avisoDeFechamentoDoCartao,
  avisoDeFechamentoDoGrupo,
  avisoDePagamentoParaConfirmar,
  avisoDePedidosDeEntrada,
  avisoDeVencimento,
  contarNaoLidos,
  diasEntre,
  lidosValidos,
  ordenarAvisos,
  proximaDataDoDia,
} = await import("../.tmp-avisos-do-sino/avisos-do-sino.js");

const { textoDoAviso } = await import("../.tmp-avisos-do-sino/services/notifications.js");

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

test("diasEntre conta dias de calendario, sem fuso", () => {
  assert.equal(diasEntre("2026-11-06", "2026-11-06"), 0);
  assert.equal(diasEntre("2026-11-06", "2026-11-09"), 3);
  assert.equal(diasEntre("2026-11-06", "2026-11-01"), -5);
  assert.equal(diasEntre("2026-12-30", "2027-01-02"), 3);
});

test("proximaDataDoDia: hoje conta, passou vai para o mes seguinte", () => {
  assert.equal(proximaDataDoDia(6, "2026-11-06"), "2026-11-06");
  assert.equal(proximaDataDoDia(10, "2026-11-06"), "2026-11-10");
  assert.equal(proximaDataDoDia(5, "2026-11-06"), "2026-12-05");
  assert.equal(proximaDataDoDia(3, "2026-12-20"), "2027-01-03");
});

test("proximaDataDoDia aperta o dia 31 ao fim do mes curto", () => {
  assert.equal(proximaDataDoDia(31, "2026-11-06"), "2026-11-30");
  assert.equal(proximaDataDoDia(31, "2027-02-10"), "2027-02-28");
  // Passou o 30/11 (o "31" de novembro): o proximo e 31/12, nao 30/12.
  assert.equal(proximaDataDoDia(31, "2026-12-01"), "2026-12-31");
});

// ---------------------------------------------------------------------------
// Vencimento
// ---------------------------------------------------------------------------

const alerta = (over = {}) => ({
  scheduled_transaction_id: "st1",
  user_id: "u1",
  description: "Aluguel",
  amount: 2000,
  due_date: "2026-11-10",
  days_until: 4,
  kind: "due_soon",
  transaction_type: "expense",
  already_notified: false,
  ...over,
});

test("vencimento usa a MESMA frase do push e do e-mail", () => {
  const a = alerta();
  const aviso = avisoDeVencimento(a);
  const { title, body } = textoDoAviso(a);
  assert.equal(aviso.titulo, title);
  assert.equal(aviso.mensagem, body);
  assert.equal(aviso.familia, "vencimento");
  assert.equal(aviso.href, "/dashboard/bills");
});

test("vencida e a familia mais urgente e muda o id", () => {
  const antes = avisoDeVencimento(alerta());
  const depois = avisoDeVencimento(alerta({ kind: "overdue", days_until: -2 }));
  assert.equal(depois.familia, "vencida");
  assert.equal(depois.prioridade, 0);
  assert.notEqual(antes.id, depois.id, "lido como 'a vencer' nao pode silenciar 'vencida'");
});

// ---------------------------------------------------------------------------
// Fechamento do cartao
// ---------------------------------------------------------------------------

const cartao = { id: "c1", name: "Nubank", closing_day: 8 };

test("cartao: avisa ate 3 dias antes, inclusive no dia", () => {
  assert.equal(avisoDeFechamentoDoCartao(cartao, "2026-11-04"), null, "4 dias antes ainda nao");
  const tres = avisoDeFechamentoDoCartao(cartao, "2026-11-05");
  assert.ok(tres);
  assert.match(tres.titulo, /Nubank fecha em 3 dias/);
  assert.match(avisoDeFechamentoDoCartao(cartao, "2026-11-07").titulo, /fecha amanhã/);
  const hoje = avisoDeFechamentoDoCartao(cartao, "2026-11-08");
  assert.match(hoje.titulo, /fecha hoje/);
  assert.equal(hoje.href, "/dashboard/cartoes/c1");
  assert.equal(avisoDeFechamentoDoCartao(cartao, "2026-11-09"), null, "ja fechou");
});

test("cartao: id leva a data, entao o lido de um mes nao apaga o outro", () => {
  const nov = avisoDeFechamentoDoCartao(cartao, "2026-11-07");
  const dez = avisoDeFechamentoDoCartao(cartao, "2026-12-07");
  assert.notEqual(nov.id, dez.id);
});

test("cartao sem dia de fechamento (ou invalido) nao avisa", () => {
  for (const closing_day of [null, undefined, 0, 32, "abc", 2.5]) {
    assert.equal(avisoDeFechamentoDoCartao({ ...cartao, closing_day }, "2026-11-07"), null);
  }
  assert.ok(avisoDeFechamentoDoCartao({ ...cartao, closing_day: "8" }, "2026-11-07"));
});

// ---------------------------------------------------------------------------
// Fechamento do grupo
// ---------------------------------------------------------------------------

test("grupo: avisa na janela e aponta para a pagina do grupo", () => {
  const g = { id: "g1", name: "Casa", closing_day: 10 };
  const aviso = avisoDeFechamentoDoGrupo(g, "2026-11-08");
  assert.match(aviso.titulo, /O grupo Casa fecha em 2 dias/);
  assert.equal(aviso.href, "/dashboard/expense-groups/g1");
  assert.equal(avisoDeFechamentoDoGrupo(g, "2026-11-01"), null);
});

test("grupo: dia fora de 1..28 nao fecha (RN018), entao nao avisa", () => {
  assert.equal(avisoDeFechamentoDoGrupo({ id: "g", name: "X", closing_day: 30 }, "2026-11-29"), null);
  assert.equal(avisoDeFechamentoDoGrupo({ id: "g", name: "X", closing_day: null }, "2026-11-29"), null);
});

// ---------------------------------------------------------------------------
// Aprovacao
// ---------------------------------------------------------------------------

test("divisao para aprovar traz quem, o que, a parte e a acao", () => {
  const aviso = avisoDeDivisaoParaAprovar({
    id: "s1",
    amount: "71.87",
    created_at: "2026-10-22T13:00:00Z",
    descricao: "Agropecuária",
    quem_lancou: "Lais",
  });
  assert.equal(aviso.titulo, 'Lais dividiu "Agropecuária" com você');
  assert.match(aviso.mensagem, /R\$\s?71,87/);
  assert.deepEqual(aviso.acao, { tipo: "divisao", split_id: "s1" });
  assert.equal(aviso.familia, "aprovacao");
});

test("divisao sem nome visivel diz 'Alguém', em vez de sumir", () => {
  const aviso = avisoDeDivisaoParaAprovar({
    id: "s2",
    amount: 10,
    created_at: "2026-10-22T13:00:00Z",
    descricao: null,
    quem_lancou: null,
  });
  assert.equal(aviso.titulo, "Alguém dividiu uma despesa com você");
});

test("pagamento: so o que EU recebo e ainda esta a lancar", () => {
  const base = {
    id: "p1",
    papel: "recebi",
    situacao: "a_lancar",
    outra_pessoa: "Helio",
    valor: 100,
    data: "2026-11-05",
    descricao: "Pix",
  };
  assert.match(avisoDePagamentoParaConfirmar(base).titulo, /Helio lançou um pagamento/);
  assert.equal(avisoDePagamentoParaConfirmar({ ...base, papel: "paguei" }), null);
  assert.equal(avisoDePagamentoParaConfirmar({ ...base, situacao: "lancado" }), null);
  assert.equal(avisoDePagamentoParaConfirmar({ ...base, situacao: "recusado" }), null);
});

test("pedidos de entrada: zero nao avisa, e um pedido novo muda o id", () => {
  const p = { group_id: "g1", group_name: "Casa", quantos: 0 };
  assert.equal(avisoDePedidosDeEntrada(p), null);
  const um = avisoDePedidosDeEntrada({ ...p, quantos: 1 });
  const dois = avisoDePedidosDeEntrada({ ...p, quantos: 2 });
  assert.equal(um.titulo, "1 pedido para entrar no grupo Casa");
  assert.equal(dois.titulo, "2 pedidos para entrar no grupo Casa");
  assert.notEqual(um.id, dois.id);
});

// ---------------------------------------------------------------------------
// Ordem e lido
// ---------------------------------------------------------------------------

test("ordem: vencida, depois aprovacao, depois o que vence mais cedo", () => {
  const lista = ordenarAvisos([
    avisoDeFechamentoDoCartao(cartao, "2026-11-05"),
    avisoDeVencimento(alerta({ days_until: 1, due_date: "2026-11-07" })),
    avisoDePagamentoParaConfirmar({
      id: "p1", papel: "recebi", situacao: "a_lancar", outra_pessoa: "A",
      valor: 1, data: "2026-11-01", descricao: null,
    }),
    avisoDeVencimento(alerta({ scheduled_transaction_id: "st9", kind: "overdue", days_until: -3 })),
  ]);
  assert.deepEqual(
    lista.map((a) => a.familia),
    ["vencida", "aprovacao", "vencimento", "cartao"]
  );
});

test("lido: descarta id que saiu da lista e conta os nao lidos", () => {
  assert.deepEqual(lidosValidos(["a", "b", "velho", "a"], ["a", "b", "c"]), ["a", "b"]);
  assert.equal(contarNaoLidos(["a", "b", "c"], ["a"]), 2);
  assert.equal(contarNaoLidos([], ["a"]), 0);
});
