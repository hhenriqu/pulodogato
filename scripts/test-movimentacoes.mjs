// Testes de lib/movimentacoes.ts -- a separacao contabil das tres
// movimentacoes (HMO-162).
//
// O caso que da nome a suite e o "fatura paga infla os dois lados": as duas
// pernas de uma transferencia entram como receita E como despesa quando a soma
// olha so o sinal do valor. O saldo continua certo nesse bug, entao um teste que
// verifique apenas o saldo passa verde com o defeito intacto -- toda asercao
// aqui olha `receitas` e `despesas` separadamente.
//
// As despesas nos fixtures sao NEGATIVAS, como estao no banco. Fixture de
// despesa com valor positivo passa verde mesmo se o codigo perder o Math.abs.

import test from "node:test";
import assert from "node:assert/strict";

import {
  classificarMovimentacao,
  contarPorFiltro,
  filtrarLancamentos,
  resumoDoPeriodo,
  FILTROS_DE_LANCAMENTO,
} from "../.tmp-movimentacoes/movimentacoes.js";

const despesa = (amount, extra = {}) => ({
  amount,
  transaction_type: "expense",
  ...extra,
});
const receita = (amount, extra = {}) => ({
  amount,
  transaction_type: "income",
  ...extra,
});

/** As duas pernas que o pagamento de fatura grava (lib/card-invoice.ts). */
const pernasDeFatura = (total) => [
  { amount: -total, transaction_type: "transfer" },
  { amount: total, transaction_type: "transfer" },
];

test("transferencia nao entra em receitas nem em despesas", () => {
  const r = resumoDoPeriodo(pernasDeFatura(1000));

  assert.equal(r.receitas, 0);
  assert.equal(r.despesas, 0);
  assert.equal(r.saldo, 0);
});

test("pagar a fatura nao mexe no mes que teve receita e despesa", () => {
  const semFatura = [receita(5000), despesa(-1200)];
  const comFatura = [...semFatura, ...pernasDeFatura(1000)];

  const a = resumoDoPeriodo(semFatura);
  const b = resumoDoPeriodo(comFatura);

  // Este par de asercoes e o bug original: antes, `b.receitas` era 6000 e
  // `b.despesas` era 2200 -- inflados em exatamente o valor da fatura.
  assert.equal(b.receitas, a.receitas, "a perna de entrada virou receita");
  assert.equal(b.despesas, a.despesas, "a perna de saida virou despesa");
  assert.equal(b.saldo, a.saldo);

  assert.equal(b.receitas, 5000);
  assert.equal(b.despesas, 1200);
  assert.equal(b.saldo, 3800);
});

test("o que andou entre contas e contado uma vez, fora do saldo", () => {
  const r = resumoDoPeriodo(pernasDeFatura(1000));

  assert.equal(r.transferido, 1000, "contou as duas pernas, nao o valor");
  assert.equal(r.transferencias, 2);
});

test("despesa gravada negativa aparece positiva no total", () => {
  const r = resumoDoPeriodo([despesa(-250.5), despesa(-49.5)]);

  assert.equal(r.despesas, 300);
  assert.equal(r.receitas, 0);
  assert.equal(r.saldo, -300);
});

test("receita e despesa se separam pelo tipo, nao pelo sinal", () => {
  // Estorno de despesa: chega POSITIVO, mas nao e receita.
  const r = resumoDoPeriodo([despesa(80), receita(200)]);

  assert.equal(r.receitas, 200, "o estorno positivo entrou como receita");
  assert.equal(r.despesas, 80);
});

test("linha antiga sem tipo: a categoria decide antes do sinal", () => {
  assert.equal(
    classificarMovimentacao({ amount: 80, category: { is_expense: true } }),
    "expense"
  );
  assert.equal(
    classificarMovimentacao({ amount: -80, category: { is_expense: false } }),
    "income"
  );
});

test("linha antiga sem tipo e sem categoria: sobra o sinal", () => {
  assert.equal(classificarMovimentacao({ amount: -10 }), "expense");
  assert.equal(classificarMovimentacao({ amount: 10 }), "income");
  assert.equal(classificarMovimentacao({ amount: 0 }), "income");
});

test("tipo declarado vence a categoria", () => {
  // A perna de saida de uma transferencia carrega categoria de despesa -- o
  // seletor da tela antiga so oferecia essas para `transfer`. Se a categoria
  // ganhasse, a perna voltaria a ser contada como despesa.
  assert.equal(
    classificarMovimentacao({
      amount: -1000,
      transaction_type: "transfer",
      category: { is_expense: true },
    }),
    "transfer"
  );
});

test("tipo desconhecido nao e tratado como transferencia", () => {
  // Um valor fora do ENUM nao pode virar "neutro": isso sumiria com a linha da
  // conta sem nada aparecer.
  const r = resumoDoPeriodo([{ amount: -40, transaction_type: "qualquer" }]);

  assert.equal(r.despesas, 40);
  assert.equal(r.transferencias, 0);
});

test("periodo vazio soma zero", () => {
  const r = resumoDoPeriodo([]);

  assert.deepEqual(r, {
    receitas: 0,
    despesas: 0,
    saldo: 0,
    transferido: 0,
    transferencias: 0,
  });
});

// ---------------------------------------------------------------------------
// O FILTRO DA LISTA (HMO-162)
// ---------------------------------------------------------------------------
// A barra "Lançamentos | Receitas | Despesas | Transferências" tem que
// concordar com os cartoes do topo da mesma tela. Por isso as asercoes abaixo
// cruzam as duas funcoes: o que a aba "Despesas" mostra e o que o cartao
// "Despesas" somou. Testar so o filtro deixaria passar uma divergencia entre os
// dois -- dois numeros certos pela propria regra, discordando na tela.
// ---------------------------------------------------------------------------

test("cada filtro devolve so o seu tipo, e 'todos' nao esconde nada", () => {
  const linhas = [
    receita(3000),
    despesa(-200),
    despesa(-50),
    ...pernasDeFatura(1000),
  ];

  assert.equal(filtrarLancamentos(linhas, "todos").length, 5);
  assert.equal(filtrarLancamentos(linhas, "income").length, 1);
  assert.equal(filtrarLancamentos(linhas, "expense").length, 2);
  assert.equal(filtrarLancamentos(linhas, "transfer").length, 2);
});

test("a aba Despesas NAO mostra a perna de saida da transferencia", () => {
  // O controle negativo desta suite. A perna de saida chega com valor
  // NEGATIVO, igualzinha a uma despesa: um filtro escrito como `amount < 0`
  // passaria em todo teste de contagem acima e reprovaria aqui. Sem esta
  // asercao explicita de NEGACAO, o bug que a HMO-162 existe para consertar
  // voltaria pela lista depois de ter saido da soma.
  const saida = { amount: -1000, transaction_type: "transfer" };
  const gasto = despesa(-1000);

  const despesas = filtrarLancamentos([saida, gasto], "expense");

  assert.equal(despesas.length, 1);
  assert.equal(despesas[0], gasto);
  assert.ok(!despesas.includes(saida));
});

test("filtro e resumo classificam a MESMA linha do mesmo jeito", () => {
  // Cruza as duas funcoes. Uma linha antiga, sem `transaction_type`, com
  // categoria de despesa e valor POSITIVO (um estorno): o sinal diz receita e a
  // categoria diz despesa. As duas tem que escolher a categoria -- se o filtro
  // decidisse por sinal, a linha apareceria em "Receitas" enquanto o cartao
  // "Despesas" a estaria somando.
  const estorno = { amount: 80, category: { is_expense: true } };

  assert.equal(classificarMovimentacao(estorno), "expense");
  assert.equal(filtrarLancamentos([estorno], "expense").length, 1);
  assert.equal(filtrarLancamentos([estorno], "income").length, 0);
  assert.equal(resumoDoPeriodo([estorno]).despesas, 80);
});

test("a contagem de cada filtro bate com o que o filtro devolve", () => {
  const linhas = [
    receita(3000),
    receita(120),
    despesa(-200),
    ...pernasDeFatura(1000),
    { amount: 80, category: { is_expense: true } },
  ];

  const contagem = contarPorFiltro(linhas);

  // Contra o rotulo que mente: o numero ao lado de cada aba tem que ser
  // exatamente o tamanho da lista que aquela aba abre.
  for (const { id } of FILTROS_DE_LANCAMENTO) {
    assert.equal(
      contagem[id],
      filtrarLancamentos(linhas, id).length,
      `contagem de "${id}" nao bate com a lista`
    );
  }

  assert.equal(contagem.todos, 6);
  assert.equal(contagem.transfer, 2);
});

test("os quatro filtros da barra existem, e nenhum fica sem contagem", () => {
  // `FILTROS_DE_LANCAMENTO` alimenta a barra da tela. Um filtro acrescentado la
  // sem tratamento em `contarPorFiltro` apareceria com contagem `undefined` --
  // que o React renderiza como nada, sem erro nenhum.
  assert.deepEqual(
    FILTROS_DE_LANCAMENTO.map((f) => f.id),
    ["todos", "income", "expense", "transfer"]
  );
  assert.deepEqual(
    FILTROS_DE_LANCAMENTO.map((f) => f.rotulo),
    ["Lançamentos", "Receitas", "Despesas", "Transferências"]
  );

  const contagem = contarPorFiltro([]);
  for (const { id } of FILTROS_DE_LANCAMENTO) {
    assert.equal(contagem[id], 0, `filtro "${id}" ficou sem contagem`);
  }
});
