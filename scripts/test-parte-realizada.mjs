// Testes de lib/parte-do-grupo-realizada.ts -- HMO-202.
//
// O modulo e um `map` de quatro campos, e testar o `map` nao valeria o arquivo.
// O que vale e o que vem DEPOIS dele: a linha convertida tem que atravessar
// `agregarTransacoes` e `linhasDeCategoria` contando como DESPESA, com o valor
// da parte.
//
// POR QUE ESSE E O TESTE QUE IMPORTA
// ----------------------------------
// Os dois agregadores descartam EM SILENCIO tudo que nao e 'income' nem
// 'expense' -- e o ramo de `transfer`, que fica fora da conta e fora da
// contagem. Entao a forma do defeito aqui nao e um numero errado: e a parte de
// grupo valendo ZERO de novo, no modo intervalo, com o modo mes continuando
// certo. Dois caminhos da mesma rota discordando, sem erro nenhum.
//
// Os dois agregadores tambem aplicam `Math.abs`, e e por isso que NAO existe
// aqui um teste de sinal: inverter o sinal da parte nao tem efeito observavel, e
// uma assercao sobre isso daria a impressao de cobrir algo que ela nao cobre.

import test from "node:test";
import assert from "node:assert/strict";

const {
  partesComoTransacoes,
  COLUNAS_DA_PARTE_DE_GRUPO,
  viewDaParteAusente,
} = await import("../.tmp-parte-realizada/parte-do-grupo-realizada.js");
const { agregarTransacoes, agregarTransacoesPorMoeda } = await import(
  "../.tmp-parte-realizada/periodo-do-painel.js"
);
const { linhasDeCategoria } = await import(
  "../.tmp-parte-realizada/categorias-do-periodo.js"
);

// Como a view 033 devolve a parte do hotel de R$ 400 num grupo de dois:
// POSITIVA, na moeda da despesa, com o `transaction_type` da transacao.
const parteDoHotel = {
  id: "s1",
  amount: "200.00",
  transaction_type: "expense",
  currency: "BRL",
  category_id: "viagem",
};

test("a parte atravessa o agregador de fluxo como DESPESA", () => {
  const resumo = agregarTransacoes(partesComoTransacoes([parteDoHotel]));
  assert.equal(resumo.total_expense, 200);
  assert.equal(resumo.total_income, 0);
  assert.equal(resumo.net, -200);
  // A contagem e o que faz a media do periodo existir: com ela em zero, a rota
  // devolveria total 200 e media 0 no mesmo bloco.
  assert.equal(resumo.transaction_count, 1);
});

test("a parte atravessa o agregador de categorias como DESPESA", () => {
  const linhas = linhasDeCategoria(partesComoTransacoes([parteDoHotel]));
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].category_id, "viagem");
  assert.equal(linhas[0].expense, 200);
  assert.equal(linhas[0].income, 0);
  assert.equal(linhas[0].transaction_count, 1);
});

test("a parte soma junto com as transacoes pessoais, sem substituir nenhuma", () => {
  // O caso do modo intervalo: o mercado e so do usuario, o hotel e a parte dele
  // no grupo. O realizado do periodo e a SOMA -- 70 + 200.
  const mercado = { amount: -70, transaction_type: "expense", currency: "BRL" };
  const resumo = agregarTransacoes([
    mercado,
    ...partesComoTransacoes([parteDoHotel]),
  ]);
  assert.equal(resumo.total_expense, 270);
  assert.equal(resumo.transaction_count, 2);
});

test("transaction_type nulo nao e inventado -- e some em silencio, que e o defeito", () => {
  // Esta assercao documenta o comportamento em vez de pedir outro. A view 033
  // filtra `transaction_type = 'expense'`, entao `null` nao chega aqui; se
  // alguem afrouxar aquele WHERE, este teste e o lugar que explica por que o
  // numero sumiu em vez de dar erro.
  const semTipo = { ...parteDoHotel, transaction_type: null };
  const resumo = agregarTransacoes(partesComoTransacoes([semTipo]));
  assert.equal(resumo.total_expense, 0);
  assert.equal(resumo.transaction_count, 0);
});

test("a moeda da parte e preservada, e nao colapsada na oficial", () => {
  // Um grupo em dolar (026). Somar a parte em dolar com a em real daria um
  // numero que nao esta em moeda nenhuma -- o defeito que a 022 tirou das views.
  const jantar = {
    id: "s2",
    amount: "30.00",
    transaction_type: "expense",
    currency: "USD",
    category_id: "viagem",
  };
  const blocos = agregarTransacoesPorMoeda(
    partesComoTransacoes([parteDoHotel, jantar]),
    "BRL"
  );
  assert.equal(blocos.length, 2);
  const porMoeda = Object.fromEntries(
    blocos.map((b) => [b.currency, b.summary.total_expense])
  );
  assert.equal(porMoeda.BRL, 200);
  assert.equal(porMoeda.USD, 30);
  // A negacao: 230 e o numero que sai quando a moeda nao entra na chave.
  assert.notEqual(porMoeda.BRL, 230);
});

test("as duas rotas pedem as MESMAS colunas da view", () => {
  // `/api/reports/cash-flow` nao usa `category_id` e `/api/reports/categories`
  // usa. A tentacao e cada rota pedir o seu select, e o custo disso e descobrir
  // meses depois que os dois relatorios leem conjuntos diferentes de linhas.
  for (const coluna of [
    "id",
    "amount",
    "transaction_type",
    "currency",
    "category_id",
  ]) {
    assert.ok(
      COLUNAS_DA_PARTE_DE_GRUPO.includes(coluna),
      `${coluna} saiu do select compartilhado`
    );
  }
});

// ---------------------------------------------------------------------------
// A janela entre o deploy e a colagem da 033
// ---------------------------------------------------------------------------
// Producao nao tem runner de migration. Entre o merge e a colagem da 033 no SQL
// Editor, as quatro views nao existem -- e as rotas tem que cair para o
// comportamento ANTIGO em vez de devolver 500, porque o que quebraria e o bloco
// de realizado do PAINEL PRINCIPAL.
//
// O par de assercoes e o que importa: reconhecer os dois codigos NAO vale nada
// sem o controle de que um erro de verdade continua sendo erro.

test("42P01 e PGRST205 sao reconhecidos como 'a 033 ainda nao foi aplicada'", () => {
  // SQLSTATE do Postgres para relacao inexistente.
  assert.equal(viewDaParteAusente({ code: "42P01" }), true);
  // O que o PostgREST devolve quando a relacao nao esta no schema cache dele.
  assert.equal(viewDaParteAusente({ code: "PGRST205" }), true);
});

test("CONTROLE: erro de verdade NAO e confundido com view ausente", () => {
  // Se esta funcao respondesse `true` para qualquer falha, uma quebra de RLS ou
  // de rede viraria "cai para a view antiga" em silencio, e o painel mostraria
  // numeros velhos para sempre sem ninguem saber -- um 500 honesto trocado por
  // uma mentira silenciosa.
  assert.equal(viewDaParteAusente({ code: "42501" }), false); // insufficient_privilege
  assert.equal(viewDaParteAusente({ code: "PGRST116" }), false);
  assert.equal(viewDaParteAusente({ code: "57014" }), false); // query_canceled
  assert.equal(viewDaParteAusente({ message: "fetch failed" }), false);
  assert.equal(viewDaParteAusente(new Error("boom")), false);
});

test("entrada que nao e objeto nao derruba o reconhecimento", () => {
  for (const nada of [null, undefined, "42P01", 42, true]) {
    assert.equal(viewDaParteAusente(nada), false);
  }
});
