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
  normalizarLancamento,
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

// ---------------------------------------------------------------------------
// TIPO E SINAL NA ESCRITA (HMO-181)
// ---------------------------------------------------------------------------
// Os casos acima leem linhas que ja existem. Estes decidem o que gravar, e o
// defeito que eles prendem foi achado em producao: um POST de `-12.34` --- o
// sinal CERTO pela convencao do banco --- virava `+12.34` no banco, e sem
// `transaction_type` nenhum.
//
// Os dois lados do estrago precisam de assercoes diferentes:
//
//   * o SINAL e regra pura, e esta em `normalizarLancamento`;
//   * a COLUNA no INSERT nao e regra nenhuma --- e uma linha que pode
//     simplesmente sumir num refactor. Nenhuma assercao sobre a funcao pura
//     alcanca essa omissao, entao a ultima secao le o codigo da rota. E um
//     instrumento pobre, usado de proposito e pelo mesmo motivo que
//     scripts/test-alcance-da-serie.mjs o usa: o que ele pega e OMISSAO.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";

const DESPESA = { categoriaEhDespesa: true };
const RECEITA = { categoriaEhDespesa: false };

test("despesa mandada com o sinal CERTO continua negativa", () => {
  // O CONTROLE NEGATIVO DA ISSUE. `const isExpense = category?.is_expense &&
  // amount > 0` fazia este caso cair no ramo do `Math.abs` e gravar +12.34:
  // a rota so funcionava para quem mandava o valor com o sinal errado.
  const r = normalizarLancamento({ amount: -12.34, ...DESPESA });

  assert.equal(r.ok, true);
  assert.equal(r.amount, -12.34, "a despesa foi gravada POSITIVA");
  assert.equal(r.tipo, "expense");
});

test("despesa mandada positiva tambem e normalizada para negativa", () => {
  // O caminho que ja funcionava, preso aqui para que o conserto do caso acima
  // nao quebre o cliente que manda o valor sem sinal (a tela faz isso).
  const r = normalizarLancamento({ amount: 12.34, ...DESPESA });

  assert.equal(r.ok, true);
  assert.equal(r.amount, -12.34);
  assert.equal(r.tipo, "expense");
});

test("receita e sempre positiva, venha com o sinal que vier", () => {
  for (const enviado of [7000, -7000]) {
    const r = normalizarLancamento({ amount: enviado, ...RECEITA });
    assert.equal(r.ok, true);
    assert.equal(r.amount, 7000, `receita enviada como ${enviado}`);
    assert.equal(r.tipo, "income");
  }
});

test("o tipo DECLARADO vence a categoria", () => {
  // Um estorno lancado numa categoria de despesa: o cliente diz "income" e e
  // isso que tem de ser gravado, com o sinal que o tipo manda. Sem esta
  // precedencia o corpo seria decoracao -- o cliente diria uma coisa e o banco
  // gravaria outra, que e a familia inteira de defeitos desta issue.
  const r = normalizarLancamento({
    amount: -300,
    transaction_type: "income",
    ...DESPESA,
  });

  assert.equal(r.ok, true);
  assert.equal(r.tipo, "income");
  assert.equal(r.amount, 300);
});

test("sem tipo e sem categoria, o sinal decide -- e nunca sai NULO", () => {
  // Categoria que a consulta nao achou (`.single()` devolve null em silencio).
  // O palpite por sinal e o pior dos tres criterios e continua sendo melhor que
  // gravar a linha sem tipo: sem tipo ela sai das tres views da 008.
  const gasto = normalizarLancamento({ amount: -50, categoriaEhDespesa: null });
  const entrada = normalizarLancamento({ amount: 50, categoriaEhDespesa: null });

  assert.equal(gasto.ok, true);
  assert.equal(gasto.tipo, "expense");
  assert.equal(entrada.ok, true);
  assert.equal(entrada.tipo, "income");
});

test("a escrita e a leitura concordam sobre a mesma linha", () => {
  // Se `normalizarLancamento` decidisse de um jeito e `classificarMovimentacao`
  // de outro, a linha sairia da lista com um rotulo e entraria nas views com o
  // outro -- dois numeros certos pela propria regra, discordando na mesma tela.
  const casos = [
    { amount: -12.34, categoriaEhDespesa: true },
    { amount: 12.34, categoriaEhDespesa: true },
    { amount: -7000, categoriaEhDespesa: false },
    { amount: -50, categoriaEhDespesa: null },
    { amount: 50, categoriaEhDespesa: null },
    { amount: -300, transaction_type: "income", categoriaEhDespesa: true },
  ];

  for (const caso of casos) {
    const r = normalizarLancamento(caso);
    assert.equal(r.ok, true);

    const comoFicouGravada = {
      amount: r.amount,
      transaction_type: r.tipo,
      category:
        typeof caso.categoriaEhDespesa === "boolean"
          ? { is_expense: caso.categoriaEhDespesa }
          : null,
    };

    assert.equal(
      classificarMovimentacao(comoFicouGravada),
      r.tipo,
      `a leitura discorda da escrita em ${JSON.stringify(caso)}`
    );
  }
});

test("transferencia e RECUSADA: esta rota cria uma perna so", () => {
  // Transferencia e gravada em DUAS pernas que se anulam (015). Aceitar aqui
  // produziria meia transferencia: dinheiro saindo de uma conta sem entrar em
  // nenhuma. E o erro nao apareceria no saldo errado de um lado so -- ele
  // apareceria como dinheiro sumido.
  const r = normalizarLancamento({
    amount: -1000,
    transaction_type: "transfer",
    ...DESPESA,
  });

  assert.equal(r.ok, false, "a rota aceitou criar meia transferencia");
  assert.match(r.erro, /transferencia|transferência/i);
});

test("tipo fora do ENUM e 400, nao palpite", () => {
  // Ignorar em silencio o que o cliente declarou e exatamente o defeito que
  // esta funcao fecha. `despesa` em portugues e o erro provavel.
  for (const invalido of ["despesa", "EXPENSE", "gasto", 1, true]) {
    const r = normalizarLancamento({
      amount: -10,
      transaction_type: invalido,
      ...DESPESA,
    });
    assert.equal(r.ok, false, `aceitou transaction_type = ${String(invalido)}`);
  }

  // E o contrario: string vazia e null sao "nao declarou", nao "declarou
  // errado". A tela manda campo vazio o tempo todo.
  for (const ausente of ["", null, undefined]) {
    const r = normalizarLancamento({
      amount: -10,
      transaction_type: ausente,
      ...DESPESA,
    });
    assert.equal(r.ok, true, `recusou o campo ausente ${String(ausente)}`);
    assert.equal(r.tipo, "expense");
  }
});

// ---------------------------------------------------------------------------
// A ROTA USA A REGRA, E GRAVA A COLUNA
// ---------------------------------------------------------------------------

const ROTA = readFileSync(
  "app/api/personal-finance/transactions/route.ts",
  "utf8"
);

test("o INSERT da rota grava transaction_type", () => {
  // O PRIMEIRO MUTANTE EXIGIDO PELA ISSUE. Sem esta coluna a linha fica fora de
  // `monthly_cash_flow`, `category_monthly_totals` e `planned_vs_actual` -- ela
  // aparece na lista de lancamentos e desaparece do fluxo de caixa, dos
  // relatorios e do orcamento, sem erro e sem aviso.
  assert.match(
    ROTA,
    /\.from\("financial_transactions"\)\s*\n\s*\.insert\(\{[\s\S]{0,600}?transaction_type:/,
    "o insert de financial_transactions nao lista transaction_type"
  );
});

test("a rota nao decide tipo nem sinal por conta propria", () => {
  // Uma segunda copia da regra diverge no primeiro conserto que so uma das duas
  // receber. A prova de que ha um lugar so: a rota chama a funcao compartilhada
  // e nao sobrou nenhum `amount > 0` decidindo direcao.
  assert.match(ROTA, /normalizarLancamento\(/, "a rota nao chama a regra");
  assert.ok(
    !/amount\s*>\s*0/.test(ROTA),
    "a rota voltou a deixar o sinal recebido decidir o tipo"
  );
  assert.ok(
    !/Math\.abs\(amount\)/.test(ROTA),
    "a rota voltou a aplicar o sinal por conta propria"
  );
});

test("a rota recusa com 400 o que a regra recusou", () => {
  // Sem este repasse, `normalizarLancamento` devolveria `ok: false` e a rota
  // seguiria em frente com `tipo` indefinido -- a recusa viraria enfeite.
  assert.match(
    ROTA,
    /if\s*\(!normalizado\.ok\)[\s\S]{0,200}status:\s*400/,
    "a rota nao devolve 400 quando a regra recusa"
  );
});

test("o vinculo de grupo nao depende mais do sinal recebido", () => {
  // O TERCEIRO DEFEITO. `if (group_id && isExpense)` com `isExpense` calculado
  // a partir de `amount > 0`: a despesa de grupo mandada negativa nascia com
  // `group_id` preenchido e SEM linha em `group_transactions` -- sem rateio,
  // sem ninguem devendo nada, e a tela do grupo mostrando a despesa.
  assert.match(
    ROTA,
    /const isExpense = tipo === "expense";/,
    "isExpense voltou a ser calculado a partir do valor recebido"
  );
  assert.match(
    ROTA,
    /if \(group_id && isExpense\)/,
    "a guarda do vinculo de grupo mudou de forma"
  );
});

// ---------------------------------------------------------------------------
// A EDICAO NAO PODE DESFAZER O CONSERTO
// ---------------------------------------------------------------------------
// O PATCH de /api/personal-finance/transactions/[id] carregava o MESMO defeito
// do POST. Consertar so o POST entregaria uma linha que nasce certa e vira
// receita na primeira edicao -- um estrago que aparece depois, longe da causa,
// e que faria a issue parecer resolvida.

const ROTA_EDICAO = readFileSync(
  "app/api/personal-finance/transactions/[id]/route.ts",
  "utf8"
);

test("a edicao usa a mesma regra de tipo e sinal, e grava a coluna", () => {
  assert.match(
    ROTA_EDICAO,
    /normalizarLancamento\(/,
    "o PATCH nao usa a regra compartilhada"
  );
  assert.match(
    ROTA_EDICAO,
    /updateData\.transaction_type = normalizado\.tipo;/,
    "o PATCH nao grava transaction_type"
  );
  assert.ok(
    !/amount\s*>\s*0/.test(ROTA_EDICAO),
    "o PATCH voltou a deixar o sinal recebido decidir o tipo"
  );
});

test("a edicao nao reclassifica uma perna de transferencia", () => {
  // Trocar o tipo de UMA perna desfaz o par das duas (015) e inverter o sinal
  // transforma a saida em entrada: os mesmos R$ 1.000 passam a existir duas
  // vezes. A direcao tem de sair da LINHA, nao do corpo da requisicao.
  assert.match(
    ROTA_EDICAO,
    /existingTransaction\.transaction_type === "transfer"/,
    "o PATCH nao separa a perna de transferencia"
  );
  assert.match(
    ROTA_EDICAO,
    /const direcao = existingAmount < 0 \? -1 : 1;/,
    "o PATCH nao preserva a direcao da perna"
  );
});
