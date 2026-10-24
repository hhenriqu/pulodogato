// =====================================================
// PULODOGATO - o cartao conta pela FATURA PAGA, nao pela compra (HMO-265, fase 6)
// =====================================================
//   npm run test:realizado-do-caixa
//
// Roda o JS compilado de lib/realizado-do-caixa.ts junto com `agregarTransacoes`
// de lib/periodo-do-painel.ts -- de proposito, e nao por conveniencia.
//
// POR QUE A ASSERCAO E SOBRE O TOTAL, E NAO SOBRE A LISTA
// -------------------------------------------------------
// `realizadoComCartaoPelaFatura` nao soma nada: ela tira a linha do cartao e
// acrescenta uma linha por fatura paga. Afirmar so sobre a lista que ela
// devolve deixaria passar o defeito que ela existe para impedir, porque o
// defeito e um NUMERO:
//
//   * a compra fica e a fatura entra -> a lista parece certa (cada linha e de
//     verdade) e o total sai com o cartao em DOBRO;
//   * a compra sai e a fatura nao entra -> a lista encurta "corretamente" e o
//     total fica MENOR, que nao parece erro: parece um mes barato;
//   * o estorno vira despesa -> `agregarTransacoes` aplica `Math.abs`, e o
//     estorno que abatia a fatura passa a soma-la.
//
// Entao cada bloco abaixo afirma o total E o numero que a conta errada daria.
//
// A FASE 6 MUDOU A SEGUNDA METADE (RN017.3, RN017.4, migracao 072)
// ---------------------------------------------------------------
// Ate a fase 5 a fatura entrava pela PERNA DE SAIDA do pagamento: o valor pago,
// no dia do pagamento. Desde a 072 ela entra pelas linhas de
// `card_invoice_paid_entries`: o TOTAL das compras que contam, no mes do
// VENCIMENTO. As pernas voltaram a ser so `transfer`, e nenhum agregado de
// fluxo as soma.
//
// O FIXTURE CANONICO E A FATURA DE R$ 1.290 COM R$ 400 DE COMPRA
// --------------------------------------------------------------
// Os numeros nao sao decorativos. 400 e o valor da compra de HMO-260 (onde o
// defeito simetrico fazia R$ 400 virarem R$ 800 na tela de Despesas) e 1.290 e o
// da fatura da HMO-264. Uma compra de 400 dentro de uma fatura de 1.290 e o caso
// em que os dois numeros errados -- 1.690 (compra somada junto) e 0 (os dois
// lados fora) -- sao plausiveis.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  ehCompraNoCartao,
  realizadoComCartaoPelaFatura,
  COLUNAS_DO_REALIZADO_DE_CAIXA,
} = await import("../.tmp-realizado-do-caixa/realizado-do-caixa.js");

const { agregarTransacoes } = await import(
  "../.tmp-realizado-do-caixa/periodo-do-painel.js"
);

const { COLUNAS_DA_FATURA_PAGA, PREFIXO_DA_FATURA_PAGA } = await import(
  "../.tmp-realizado-do-caixa/fatura-paga-no-resultado.js"
);

const CARTAO = "11111111-1111-4111-8111-111111111111";
const CHAVE_FATURA = `fatura:2026-09-01:${CARTAO}`;

/** Uma despesa comum, na conta corrente. */
const despesa = (over = {}) => ({
  amount: -250,
  transaction_type: "expense",
  currency: "BRL",
  account: { account_type: "checking" },
  ...over,
});

/** Uma compra no cartao: despesa cuja conta e um `credit_card`. */
const compraNoCartao = (over = {}) => ({
  amount: -400,
  transaction_type: "expense",
  currency: "BRL",
  account: { account_type: "credit_card" },
  ...over,
});

/**
 * A perna de SAIDA do pagamento da fatura: negativa, na conta pagadora, com a
 * chave canonica em `notes`. `transfer`, e e assim que ela fica.
 */
const saidaDaFatura = (over = {}) => ({
  amount: -1290,
  transaction_type: "transfer",
  currency: "BRL",
  notes: CHAVE_FATURA,
  counterpart_transaction_id: null,
  account: { account_type: "checking" },
  ...over,
});

/** A perna de ENTRADA: positiva, no cartao, com o elo apontando para a saida. */
const entradaDaFatura = (over = {}) => ({
  amount: 1290,
  transaction_type: "transfer",
  currency: "BRL",
  notes: CHAVE_FATURA,
  counterpart_transaction_id: "tx-da-saida",
  account: { account_type: "credit_card" },
  ...over,
});

/** Uma linha de `card_invoice_paid_entries` (072): positiva na compra. */
const linhaDaFatura = (over = {}) => ({
  id: "compra",
  account_id: CARTAO,
  account_name: "C6",
  invoice_month: "2026-09-01",
  invoice_description: "Fatura C6 09/2026",
  due_date: "2026-10-05",
  paid_date: "2026-10-03",
  category_id: "cat-mercado",
  invoice_amount: "1290.00",
  currency: "BRL",
  include_in_total: true,
  ...over,
});

const totalizar = (linhas, faturas = []) =>
  agregarTransacoes(realizadoComCartaoPelaFatura(linhas, faturas));

// ---------------------------------------------------------------------------
// As duas metades da regra, cada uma com o numero da conta errada
// ---------------------------------------------------------------------------

test("a compra no cartao sai do realizado -- a fatura e que vai contar", () => {
  const resumo = totalizar([despesa(), compraNoCartao()]);

  assert.equal(resumo.total_expense, 250);
  // O numero de antes da HMO-265: a compra somada no dia da compra.
  assert.notEqual(resumo.total_expense, 650);
  // E a contagem acompanha: um `COUNT(*)` que ainda visse a compra deixaria o
  // tile "Lancamentos" discordando do total ao lado dele.
  assert.equal(resumo.transaction_count, 1);
});

test("a fatura PAGA entra no realizado pelo total das compras dela", () => {
  const resumo = totalizar([], [linhaDaFatura()]);

  assert.equal(resumo.total_expense, 1290);
  // Sem a segunda metade, o mes em que a fatura vence sairia R$ 1.290 mais
  // barato. E o defeito da HMO-264.
  assert.notEqual(resumo.total_expense, 0);
  assert.equal(resumo.total_income, 0);
  // UMA linha por fatura, e nao uma por compra: e a unica diferenca para o
  // modo mes, onde o banco conta cada compra.
  assert.equal(resumo.transaction_count, 1);
});

test("as duas metades juntas: a compra sai e a fatura que a contem entra", () => {
  const resumo = totalizar(
    [despesa(), compraNoCartao(), saidaDaFatura(), entradaDaFatura()],
    [
      linhaDaFatura({ id: "c1", invoice_amount: "400.00" }),
      linhaDaFatura({ id: "c2", invoice_amount: "890.00" }),
    ]
  );

  assert.equal(resumo.total_expense, 1540); // 250 + 1290
  // Os tres totais errados que a regra tem de impedir, nomeados:
  assert.notEqual(resumo.total_expense, 1940, "a compra somou junto da fatura");
  assert.notEqual(resumo.total_expense, 2830, "a fatura contou em DOBRO");
  assert.notEqual(resumo.total_expense, 250, "o cartao desapareceu dos dois lados");
});

test("as pernas do pagamento nao entram em lado nenhum", () => {
  // Ate a fase 5 a perna de saida era promovida a `expense`. Com ela E a
  // fatura somada, o mes fecharia no dobro.
  const resumo = totalizar([saidaDaFatura(), entradaDaFatura()]);
  assert.equal(resumo.total_expense, 0);
  assert.equal(resumo.total_income, 0);
  assert.equal(resumo.transaction_count, 0);

  // E a linha nao some do app: ela atravessa a regra como `transfer`, e e a
  // tela de Transferencias que a mostra.
  const lista = realizadoComCartaoPelaFatura([saidaDaFatura()], []);
  assert.deepEqual(
    lista.map((l) => l.transaction_type),
    ["transfer"]
  );
});

test("o valor e o TOTAL das compras, e nao o que foi pago", () => {
  // RN017.4: pagar R$ 1.200 de uma fatura de R$ 1.290 nao muda a despesa. A
  // diferenca fica no saldo do cartao.
  const resumo = totalizar(
    [saidaDaFatura({ amount: -1200 }), entradaDaFatura({ amount: 1200 })],
    [linhaDaFatura()]
  );
  assert.equal(resumo.total_expense, 1290);
  assert.notEqual(resumo.total_expense, 1200);
});

test("o estorno abate a fatura, e nao vira despesa", () => {
  // `invoice_amount` e negativo no estorno. Somado com `Math.abs` como linha
  // solta, ele SUBIRIA a despesa: 300 + 40 = 340 em vez de 260.
  const resumo = totalizar(
    [],
    [
      linhaDaFatura({ id: "mercado", invoice_amount: "300.00" }),
      linhaDaFatura({ id: "estorno", invoice_amount: "-40.00" }),
    ]
  );
  assert.equal(resumo.total_expense, 260);
  assert.notEqual(resumo.total_expense, 340);
});

test("a fatura de total NEGATIVO sai como receita, e o Resultado e o do banco", () => {
  // Um estorno maior que as compras que contam: no banco a fatura e despesa
  // negativa. Os agregadores somam `Math.abs` pelo tipo, entao ela tem de sair
  // `income` -- como `expense` ela SUBIRIA a despesa.
  const resumo = totalizar(
    [despesa()],
    [linhaDaFatura({ id: "estorno", invoice_amount: "-90.00" })]
  );
  assert.equal(resumo.total_expense, 250);
  assert.equal(resumo.total_income, 90);
  assert.equal(resumo.net, -160);
});

test("a linha da fatura fora dos totais nao soma", () => {
  // A 060 tira a linha desmarcada do Resultado. A fatura do banco a soma, e o
  // Resultado nao: `faturasPagasComoTransacoes` usa o mesmo `apenasNosTotais`
  // das outras somas do app.
  const resumo = totalizar(
    [],
    [
      linhaDaFatura({ id: "mercado", invoice_amount: "300.00" }),
      linhaDaFatura({ id: "presente", invoice_amount: "50.00", include_in_total: false }),
    ]
  );
  assert.equal(resumo.total_expense, 300);
  assert.notEqual(resumo.total_expense, 350);
});

test("duas faturas, dois cartoes, cada uma uma linha", () => {
  const OUTRO = "22222222-2222-4222-8222-222222222222";
  const lista = realizadoComCartaoPelaFatura(
    [],
    [
      linhaDaFatura({ id: "a" }),
      linhaDaFatura({ id: "b", account_id: OUTRO, invoice_amount: "100.00" }),
    ]
  );
  assert.equal(lista.length, 2);
  assert.deepEqual(
    lista.map((l) => l.id).sort(),
    [
      `${PREFIXO_DA_FATURA_PAGA}${CARTAO}:2026-09-01`,
      `${PREFIXO_DA_FATURA_PAGA}${OUTRO}:2026-09-01`,
    ].sort()
  );
  assert.equal(agregarTransacoes(lista).total_expense, 1390);
});

// ---------------------------------------------------------------------------
// O que NAO pode ser confundido com compra no cartao
// ---------------------------------------------------------------------------

test("assinatura cobrada no cartao e linha da fatura como qualquer compra", () => {
  // Ela e uma conta prevista com `account_id` do cartao, e a baixa dela grava
  // uma despesa no cartao -- que a fatura CONTEM. Entao ela sai daqui pelo
  // mesmo caminho da compra.
  const assinatura = compraNoCartao({ amount: -39.9, notes: "Streaming" });
  assert.equal(ehCompraNoCartao(assinatura), true);
});

test("compra no cartao com transaction_type NULO fica onde estava", () => {
  // A view `card_invoice_lines` filtra `transaction_type IN ('expense','income')`
  // pela COLUNA, e ha linha com a coluna nula em producao. Uma compra assim NAO
  // esta na fatura, entao esconde-la daqui a tiraria do app sem que nada a
  // somasse no lugar.
  const nula = compraNoCartao({ transaction_type: null });
  assert.equal(ehCompraNoCartao(nula), false);

  // Ela atravessa a regra intacta -- e continua fora do total, porque todo
  // agregado de fluxo filtra income/expense. O ponto e que a regra nao a TOCA.
  const [sobrevivente] = realizadoComCartaoPelaFatura([nula], []);
  assert.equal(sobrevivente.transaction_type, null);
});

test("ESTORNO no cartao (income) sai junto, porque a fatura ja o abate", () => {
  // `card_invoice_lines` inclui 'income' no cartao: o estorno de uma compra
  // reduz a fatura. Deixa-lo no realizado somaria uma RECEITA que o total da
  // fatura ja descontou -- receita inventada, e do tamanho do estorno.
  const estorno = compraNoCartao({ amount: 120, transaction_type: "income" });
  assert.equal(ehCompraNoCartao(estorno), true);

  const resumo = totalizar([estorno]);
  assert.equal(resumo.total_income, 0);
  assert.notEqual(resumo.total_income, 120);
});

test("a perna de entrada do pagamento, no cartao, nao e linha da fatura", () => {
  // Ela mora no cartao, mas e `transfer`: a fatura nao a contem, e tira-la
  // daqui esconderia o pagamento da tela de Transferencias por outro caminho.
  assert.equal(ehCompraNoCartao(entradaDaFatura()), false);
});

// ---------------------------------------------------------------------------
// As duas formas do embed, e a linha que nao tem conta
// ---------------------------------------------------------------------------

test("o embed da conta e lido venha ele objeto OU array de um", () => {
  // `financial_transactions` e TABELA e o supabase-js devolve objeto -- mas a
  // rota atravessa a fronteira com um `as` e o tsc nao verifica nada ali. Lendo
  // so a forma objeto, um embed em array daria `undefined` em TODA linha,
  // nenhuma casaria com `credit_card`, e o painel voltaria a contar o cartao em
  // dobro sem erro, sem log e com o tsc verde (HMO-209).
  const emArray = compraNoCartao({ account: [{ account_type: "credit_card" }] });
  assert.equal(ehCompraNoCartao(emArray), true);

  const resumo = totalizar([despesa(), emArray]);
  assert.equal(resumo.total_expense, 250);
  assert.notEqual(resumo.total_expense, 650);
});

test("linha SEM conta FICA: 'nao sei' nao e 'e cartao'", () => {
  // A despesa de grupo e gravada sem `account_id`, e um embed `null` por RLS
  // significa "nao sei". Esconder no "nao sei" apagaria despesa legitima do
  // unico numero que a pessoa abre o painel para ver -- e um total menor nao
  // levanta suspeita.
  const semConta = despesa({ account: null });
  assert.equal(ehCompraNoCartao(semConta), false);

  const resumo = totalizar([semConta]);
  assert.equal(resumo.total_expense, 250);
});

test("a parte de grupo atravessa a regra intacta", () => {
  // `partesComoTransacoes` (lib/parte-do-grupo-realizada.ts) entrega linhas sem
  // conta: a MESMA lista que as transacoes. Elas nao podem ser tocadas aqui --
  // a minha parte de uma despesa de grupo nao e linha de fatura minha.
  const parte = {
    amount: 200,
    transaction_type: "expense",
    currency: "BRL",
    category_id: null,
  };

  const resumo = totalizar([parte]);
  assert.equal(resumo.total_expense, 200);
});

// ---------------------------------------------------------------------------
// A regra nao muta a lista que recebeu
// ---------------------------------------------------------------------------

test("a lista de entrada nao e alterada", () => {
  // A rota le a mesma lista mais de uma vez (uma vez por moeda, em
  // `agregarTransacoesPorMoeda`). Tirar ou acrescentar no proprio array seria
  // um efeito a distancia invisivel nas duas funcoes.
  const linhas = [despesa(), compraNoCartao()];
  const faturas = [linhaDaFatura()];
  const saida = realizadoComCartaoPelaFatura(linhas, faturas);

  assert.equal(linhas.length, 2);
  assert.equal(faturas.length, 1);
  assert.notEqual(saida, linhas);
});

// ---------------------------------------------------------------------------
// As colunas que as consultas precisam pedir
// ---------------------------------------------------------------------------

test("as colunas load-bearing estao na lista que a rota pede", () => {
  // Nenhuma delas aparece na tela, e tirar qualquer uma do `select` nao quebra
  // tsc nem assercao de unidade: a regra passa a receber `undefined`, deixa de
  // casar, e o painel volta ao defeito. Este bloco e o que torna o `select`
  // parte do contrato.
  for (const coluna of [
    "amount",
    "transaction_type",
    "currency",
    // HMO-453: quem FILTRA por ela e a ROTA (`apenasNosTotais` no laco de
    // paginacao de /api/reports/cash-flow), nao este modulo -- mas e esta
    // lista que a pede no relatorio pessoal. Sem a coluna, o campo chega
    // `undefined` em toda linha, o predicado `!== false` deixa tudo passar, e a
    // linha que a pessoa tirou dos relatorios volta a contar.
    "include_in_total",
    "account_type",
  ]) {
    assert.ok(
      COLUNAS_DO_REALIZADO_DE_CAIXA.includes(coluna),
      `COLUNAS_DO_REALIZADO_DE_CAIXA perdeu ${coluna}`
    );
  }

  // O embed, e nao a coluna solta: `account_type` nao existe em
  // `financial_transactions`. Pedi-la crua responderia 400 do PostgREST -- o
  // painel inteiro sem Realizado.
  assert.ok(
    COLUNAS_DO_REALIZADO_DE_CAIXA.includes(
      "account:financial_accounts(account_type)"
    ),
    "account_type tem de vir pelo embed de financial_accounts"
  );

  // E A VIEW DA FATURA PAGA. `include_in_total` pelo mesmo motivo; os outros
  // sao a chave da fatura (cartao e mes), o recorte (vencimento) e o valor.
  for (const coluna of [
    "account_id",
    "invoice_month",
    "due_date",
    "invoice_amount",
    "currency",
    "include_in_total",
  ]) {
    assert.ok(
      COLUNAS_DA_FATURA_PAGA.split(", ").includes(coluna),
      `COLUNAS_DA_FATURA_PAGA perdeu ${coluna}`
    );
  }
});

// ---------------------------------------------------------------------------
// O LANCAMENTO FORA DOS TOTAIS -- O QUE ESTE MODULO *NAO* FAZ (HMO-453)
// ---------------------------------------------------------------------------
// `realizadoComCartaoPelaFatura` NAO filtra as linhas de `financial_transactions`
// por `include_in_total`, e isso e decisao e nao esquecimento: o filtro vive UMA
// PORTA ACIMA, no laco de paginacao de /api/reports/cash-flow. Um segundo filtro
// aqui seria codigo morto no unico chamador que existe -- e codigo morto nao tem
// mutante que morra. As linhas da FATURA sao outra fonte, e o filtro delas mora
// em `faturasPagasComoTransacoes` (o bloco "a linha da fatura fora dos totais"
// acima).

test("a regra do cartao atravessa a linha desmarcada INTACTA", () => {
  // A linha chega aqui ja filtrada pela rota. Receber uma desmarcada e o
  // estado de um chamador novo que esqueceu `apenasNosTotais` -- e a resposta
  // certa deste modulo e nao inventar um segundo criterio: ele responde sobre
  // CARTAO e FATURA, nao sobre relatorio.
  const desmarcada = {
    amount: -200,
    transaction_type: "expense",
    include_in_total: false,
    account: { account_type: "checking" },
  };

  const saida = realizadoComCartaoPelaFatura([desmarcada], []);
  assert.equal(saida.length, 1);
  assert.equal(saida[0].include_in_total, false);
});
