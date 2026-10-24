// =====================================================
// PULODOGATO - as tres telas de movimentacao (HMO-246)
// =====================================================
//   npm run test:telas-de-movimentacao
//
// Roda o JS compilado de lib/telas-de-movimentacao.ts, que importa
// lib/movimentacoes.ts e lib/destino-do-lancamento.ts -- por isso o npm script
// tem o passo de resolve-aliases.
//
// CADA BLOCO TRAZ O CONTROLE: o numero que a conta ERRADA produziria.
// Sem isso, "total = 159,90" passa verde num modulo que soma so o realizado,
// num periodo em que nao HA realizado -- e a assercao nao seria capaz de
// falhar. As quatro armadilhas do modulo (sinal oposto, conta paga contada
// duas vezes, as duas pernas da transferencia, tipo decidido pelo sinal) tem
// bloco proprio, e cada um deles afirma tambem o que a conta errada daria.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  valorEmReais,
  telaDoTipo,
  TELAS_DE_MOVIMENTACAO,
  STATUS_QUE_SAI_DO_PREVISTO,
  ehPernaDeEntrada,
  ehGastoNoCartao,
  ehPagamentoDaFatura,
  ehFaturaPagaNoResultado,
  PREFIXO_DA_FATURA_PAGA,
  ehEntradaSoltaDoMyBank,
  ehSaidaDaParcelaDoAutoEmprestimo,
  ehJuroPagoDoMyBank,
  ehParcelaDevidaDoMyBank,
  PREFIXO_DO_ELO_DO_MYBANK,
  TIPO_CARTAO,
  TIPO_DA_PERNA_DE_PAGAMENTO,
  linhaRealizada,
  linhaPrevista,
  linhasDaTela,
  secoesDaTela,
  resumoDaTela,
  resumoComReembolsoPrevisto,
  previstoSemLinha,
  previstoVencido,
  indiceDeContraparte,
} = await import("../.tmp-telas-de-movimentacao/telas-de-movimentacao.js");

// A FATURA PAGA COMO A ROTA A MONTA (fase 6). E o oraculo dos blocos da
// armadilha 6: escrever a linha a mao mediria a fabrica do teste, nao a da rota.
const {
  faturasPagasComoRealizadas,
  PREFIXO_DA_FATURA_PAGA: PREFIXO_DA_FATURA_PAGA_DA_ROTA,
} = await import("../.tmp-telas-de-movimentacao/fatura-paga-no-resultado.js");

/**
 * Nenhuma das realizadas veio de regra fixa.
 *
 * `linhasDaTela` e `linhaRealizada` exigem este conjunto como argumento, e a
 * obrigatoriedade e deliberada (HMO-285): a rota e a unica que sabe responder
 * "esta linha realizada e de uma conta fixa?", porque o elo em
 * `financial_transactions` nao existe e a resposta vem de uma terceira consulta.
 * Opcional, a rota pararia de passar o conjunto numa refatoracao sem que `tsc`
 * ou teste nenhum reclamasse, e TODA conta fixa voltaria a se chamar comum.
 *
 * Os blocos que medem OUTRA COISA (soma, ordem, tipo, a frase da conta) passam
 * por `daTela`, que preenche o vazio: `natureza` nao e o que eles afirmam, e
 * repetir `new Set()` em 37 chamadas esconderia os dois blocos em que o
 * conjunto e o assunto.
 */
const SEM_FIXAS = new Set();

/**
 * Quem esta olhando, nos blocos que medem OUTRA COISA.
 *
 * `linhasDaTela` tambem exige este argumento (HMO-301), pela mesma razao do
 * conjunto acima: a rota e a unica que sabe quem esta autenticado. A diferenca
 * e a DIRECAO do erro -- sem ele, `posso_editar` cai para `false` em toda
 * linha e nenhum botao aparece, que e o lado barato. Com ele errado, apareceria
 * um Excluir sobre linha alheia, e `UPDATE` recusado pela RLS volta 200 sem
 * alterar nada.
 *
 * As fabricas `realizada`/`prevista` gravam este mesmo id em `user_id`, entao
 * o caso comum desta suite e "a linha e minha". Os blocos de `posso_editar`
 * trocam um dos dois de proposito.
 */
const EU = "a1b2c3d4-e5f6-4789-abcd-ef0123456789";

/** `linhasDaTela` com "nenhuma realizada e fixa", e sou eu olhando. */
const daTela = (realizadas, previstas, tipo, idsDeFixa = SEM_FIXAS, eu = EU) =>
  linhasDaTela(realizadas, previstas, tipo, idsDeFixa, eu);

/** Uma linha de financial_transactions, com o minimo que o modulo le. */
const realizada = (over = {}) => ({
  id: "t1",
  user_id: EU,
  description: "linha",
  amount: -100,
  transaction_date: "2026-10-10",
  transaction_type: "expense",
  ...over,
});

/** Uma linha de scheduled_transactions_effective. `amount` POSITIVO por CHECK. */
const prevista = (over = {}) => ({
  id: "s1",
  user_id: EU,
  description: "conta",
  amount: "100.00",
  due_date: "2026-10-15",
  my_status: "pending",
  my_effective_status: "pending",
  direction: "expense",
  ...over,
});

// -----------------------------------------------------
// ARMADILHA 1: os dois lados tem sinal OPOSTO
// -----------------------------------------------------
test("a despesa realizada (-159,90) e a prevista (+159,90) SOMAM, nao se cancelam", () => {
  const linhas = daTela(
    [realizada({ id: "t1", description: "Internet set", amount: -159.9 })],
    [prevista({ id: "s1", description: "Internet out", amount: "159.90" })],
    "expense"
  );

  const r = resumoDaTela(linhas);

  // CONTROLE: a soma CRUA dos dois `amount` e exatamente zero. Se este modulo
  // lesse `amount` sem `Math.abs`, o mes fecharia em R$ 0,00 com as duas
  // despesas visiveis na lista ao lado -- e nada apontaria para o sinal.
  assert.equal(-159.9 + 159.9, 0, "o controle precisa somar zero para valer");

  assert.equal(r.realizado, 159.9);
  assert.equal(r.previsto, 159.9);
  assert.equal(r.total, 319.8);
  assert.equal(r.quantidade, 2);
});

test("valorEmReais e sempre positivo, nos dois sinais e nas duas formas", () => {
  assert.equal(valorEmReais(-159.9), 159.9);
  assert.equal(valorEmReais("159.90"), 159.9);
  assert.equal(valorEmReais(159.9), 159.9);
  // Nem `null` nem lixo viram NaN na tela: NaN formatado se le como "R$ NaN".
  assert.equal(valorEmReais(null), 0);
  assert.equal(valorEmReais(undefined), 0);
  assert.equal(valorEmReais("nao e numero"), 0);
});

test("cotacao ausente, zero ou negativa vale 1 -- nunca apaga a linha", () => {
  // `scheduled_transactions` NAO TEM exchange_rate: toda conta prevista chega
  // sem cotacao. Tratada como 0, um boleto de R$ 1.200 valeria R$ 0,00 -- e
  // continuaria aparecendo na lista, com o total sem ele.
  assert.equal(valorEmReais(-1200, undefined), 1200);
  assert.equal(valorEmReais(-1200, null), 1200);
  assert.equal(valorEmReais(-1200, 0), 1200);
  assert.equal(valorEmReais(-1200, -3), 1200);
  assert.equal(valorEmReais(-1200, "nao e numero"), 1200);
  // E a cotacao de verdade MULTIPLICA: US$ 180 a 5,50 sao R$ 990.
  assert.equal(valorEmReais(-180, 5.5), 990);
  assert.equal(valorEmReais(-180, "5.50"), 990);
});

// -----------------------------------------------------
// ARMADILHA 2: a mesma conta contada DUAS vezes
// -----------------------------------------------------
test("a conta prevista com baixa fica FORA do previsto -- ela ja esta no realizado", () => {
  // O que o banco tem depois de a pessoa confirmar o pagamento: a previsao com
  // status 'paid' E a transacao que a baixa criou.
  const linhas = daTela(
    [realizada({ id: "t1", description: "Internet", amount: -159.9 })],
    [prevista({ id: "s1", description: "Internet", my_status: "paid", amount: "159.90" })],
    "expense"
  );

  const r = resumoDaTela(linhas);

  assert.equal(r.previsto, 0);
  assert.equal(r.realizado, 159.9);
  // CONTROLE: sem a exclusao, o total seria 319,80 -- o dobro de uma conta de
  // R$ 159,90, com as duas linhas plausiveis na lista.
  assert.equal(r.total, 159.9);
  assert.notEqual(r.total, 319.8);
  assert.equal(linhas.length, 1);
  assert.equal(linhaPrevista(prevista({ my_status: "paid" })), null);
});

test("skipped e cancelled saem do previsto; pending e overdue ficam", () => {
  assert.equal(linhaPrevista(prevista({ my_status: "skipped" })), null);
  assert.equal(linhaPrevista(prevista({ my_status: "cancelled" })), null);

  assert.ok(linhaPrevista(prevista({ my_status: "pending" })));
  // 'overdue' NUNCA e gravado em `status` -- a view o calcula em
  // `effective_status`. Uma conta vencida continua sendo uma conta que o
  // periodo previa: tirando-a daqui, o total de Despesas DIMINUIRIA no dia
  // seguinte ao vencimento, que e o dia em que a pessoa abre a tela.
  const vencida = linhaPrevista(
    prevista({ my_status: "pending", my_effective_status: "overdue" })
  );
  assert.ok(vencida);
  assert.equal(vencida.situacao, "overdue");

  assert.deepEqual([...STATUS_QUE_SAI_DO_PREVISTO].sort(), [
    "cancelled",
    "paid",
    "skipped",
  ]);
});

test("o vencido e um RECORTE do previsto, nao uma soma a parte", () => {
  const linhas = daTela(
    [],
    [
      prevista({ id: "a", amount: "400.00", my_effective_status: "overdue" }),
      prevista({ id: "b", amount: "100.00", my_effective_status: "pending" }),
    ],
    "expense"
  );

  const r = resumoDaTela(linhas);
  const v = previstoVencido(linhas);

  assert.equal(r.previsto, 500);
  assert.equal(v.total, 400);
  assert.equal(v.quantidade, 1);
  // O vencido esta DENTRO do previsto: somar os dois daria R$ 900 de R$ 500
  // previstos.
  assert.ok(v.total <= r.previsto);
});

test("o realizado nasce sem `situacao` -- e e por isso que ele nunca vira atraso", () => {
  // Este e o INVARIANTE em que `previstoVencido` se apoia: ela filtra so por
  // `situacao === "overdue"`, sem olhar `origem`, porque `linhaRealizada` grava
  // `null` aqui em toda linha. Se este campo passasse a vir preenchido, o
  // cartao "Previsto" anunciaria atraso de algo que ja foi pago -- entao a
  // assercao e sobre o campo, que e o que de fato segura a regra.
  const linhas = daTela(
    [realizada({ amount: -50, transaction_date: "2026-01-01" })],
    [],
    "expense"
  );
  assert.equal(linhas[0].situacao, null);
  assert.equal(linhas[0].status, null);
  assert.equal(previstoVencido(linhas).total, 0);
  assert.equal(previstoVencido(linhas).quantidade, 0);
});

// -----------------------------------------------------
// ARMADILHA 3: a transferencia tem DUAS pernas
// -----------------------------------------------------
test("um Pix de R$ 1.000 entre contas proprias soma R$ 1.000, nao R$ 2.000", () => {
  // Como o banco grava (015 + app/api/movimentacoes/transferencia/route.ts):
  // duas linhas, a MESMA data, e o elo so na perna de ENTRADA.
  const saida = realizada({
    id: "saida",
    description: "Para a poupanca",
    amount: -1000,
    transaction_type: "transfer",
    account: { id: "c1", name: "Itaú" },
  });
  const entrada = realizada({
    id: "entrada",
    description: "Para a poupanca",
    amount: 1000,
    transaction_type: "transfer",
    counterpart_transaction_id: "saida",
    account: { id: "c2", name: "Nubank" },
  });

  const linhas = daTela([saida, entrada], [], "transfer");
  const r = resumoDaTela(linhas);

  // CONTROLE: as duas pernas somam 2.000 em valor absoluto. A assercao abaixo
  // so e capaz de falhar porque este numero existe.
  assert.equal(Math.abs(saida.amount) + Math.abs(entrada.amount), 2000);

  assert.equal(linhas.length, 1, "uma linha por transferencia, nao duas");
  assert.equal(r.realizado, 1000);
  assert.notEqual(r.realizado, 2000);

  // A linha que ficou e a de SAIDA, e ela diz o caminho inteiro.
  assert.equal(linhas[0].id, "saida");
  assert.equal(linhas[0].conta, "Itaú → Nubank");
});

test("transferencia antiga, SEM o elo, tambem conta uma vez so (pelo sinal)", () => {
  // O elo do 015 e `ON DELETE SET NULL`, e ha linha de antes dele. Sem o
  // segundo criterio de `ehPernaDeEntrada` o par voltaria a ser contado duas
  // vezes, e R$ 500 virariam R$ 1.000.
  const linhas = daTela(
    [
      realizada({ id: "a", amount: -500, transaction_type: "transfer" }),
      realizada({ id: "b", amount: 500, transaction_type: "transfer" }),
    ],
    [],
    "transfer"
  );

  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].id, "a");
  assert.equal(resumoDaTela(linhas).realizado, 500);
});

test("ehPernaDeEntrada: o elo manda, e o sinal e a rede", () => {
  // O elo e o criterio mais forte, e o UNICO que funciona com valor zero.
  assert.equal(
    ehPernaDeEntrada({ amount: 0, counterpart_transaction_id: "x" }),
    true
  );
  assert.equal(ehPernaDeEntrada({ amount: -1000, counterpart_transaction_id: "x" }), true);
  // Sem elo, o sinal.
  assert.equal(ehPernaDeEntrada({ amount: 1000 }), true);
  assert.equal(ehPernaDeEntrada({ amount: -1000 }), false);
  // String vazia e espaco em branco NAO sao elo: `counterpart_transaction_id:
  // ""` tratado como elo tiraria a perna de SAIDA e a transferencia
  // desapareceria da tela que existe para mostra-la.
  assert.equal(ehPernaDeEntrada({ amount: -1000, counterpart_transaction_id: "" }), false);
  assert.equal(ehPernaDeEntrada({ amount: -1000, counterpart_transaction_id: "   " }), false);
});

test("transferencia de valor ZERO sem elo fica com as duas linhas, e isso e deliberado", () => {
  // Nao ha criterio que distinga as duas (o elo nao existe, o sinal e igual), e
  // somar duas linhas de zero continua dando zero. Esconder uma delas seria a
  // tela apagando um lancamento que a pessoa criou.
  const linhas = daTela(
    [
      realizada({ id: "a", amount: 0, transaction_type: "transfer" }),
      realizada({ id: "b", amount: 0, transaction_type: "transfer" }),
    ],
    [],
    "transfer"
  );

  assert.equal(linhas.length, 2);
  assert.equal(resumoDaTela(linhas).realizado, 0);
});

test("cambio: a perna de SAIDA e a que diz quanto saiu em reais", () => {
  // Numa transferencia entre contas de moedas diferentes as duas pernas NAO se
  // anulam: -1.000 BRL e +180 USD. Ficar com a de saida responde "quanto
  // andou" em reais; ficar com a de entrada daria R$ 990 de uma transferencia
  // de R$ 1.000.
  const linhas = daTela(
    [
      realizada({
        id: "saida",
        amount: -1000,
        exchange_rate: 1,
        currency: "BRL",
        transaction_type: "transfer",
      }),
      realizada({
        id: "entrada",
        amount: 180,
        exchange_rate: 5.5,
        currency: "USD",
        transaction_type: "transfer",
        counterpart_transaction_id: "saida",
      }),
    ],
    [],
    "transfer"
  );

  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].valor, 1000);
  assert.notEqual(linhas[0].valor, 990);
  // BRL nao vira rotulo de moeda: "R$ 1.000,00 · BRL" e ruido.
  assert.equal(linhas[0].moeda, null);
});

test("a moeda estrangeira VIRA rotulo -- sem ele US$ 180 se le como R$ 180", () => {
  const linhas = daTela(
    [realizada({ amount: -180, exchange_rate: 5.5, currency: "usd" })],
    [],
    "expense"
  );
  assert.equal(linhas[0].moeda, "USD");
  assert.equal(linhas[0].valor, 990);
});

test("transferencia PREVISTA (038) conta uma vez: a previsao e UMA linha", () => {
  // As duas pernas so nascem na baixa, entao do lado previsto nao ha o que
  // de-duplicar -- e aplicar `ehPernaDeEntrada` ao previsto apagaria a
  // transferencia recorrente inteira, porque `amount > 0` por CHECK.
  const linhas = daTela(
    [],
    [prevista({ id: "s1", amount: "1000.00", direction: "transfer" })],
    "transfer"
  );

  assert.equal(linhas.length, 1);
  assert.equal(resumoDaTela(linhas).previsto, 1000);
});

// -----------------------------------------------------
// ARMADILHA 4: o SINAL nao pode ser o criterio de TIPO
// -----------------------------------------------------
test("a perna de saida de uma transferencia NAO entra na tela de Despesas", () => {
  // Pelo sinal (-200) e pela categoria (is_expense: true -- o seletor antigo
  // forcava isso) ela e indistinguivel de um gasto. Quem filtrasse por sinal
  // poria todo Pix entre contas proprias no total de despesas do mes.
  const pernaDeSaida = realizada({
    id: "pix",
    amount: -200,
    transaction_type: "transfer",
    category: { name: "Transferência entre contas", is_expense: true },
  });
  const gasto = realizada({
    id: "mercado",
    amount: -80,
    transaction_type: "expense",
    category: { name: "Alimentação", is_expense: true },
  });

  const despesas = daTela([pernaDeSaida, gasto], [], "expense");
  const r = resumoDaTela(despesas);

  // CONTROLE: pelo sinal, as duas linhas sao despesa e o total seria R$ 280.
  assert.equal(Math.abs(-200) + Math.abs(-80), 280);

  assert.equal(despesas.length, 1);
  assert.equal(despesas[0].id, "mercado");
  assert.equal(r.realizado, 80);
  assert.notEqual(r.realizado, 280);

  // E ela aparece na tela de Transferencias, que e onde ela pertence -- "fora
  // de Despesas" nao pode querer dizer "fora do app".
  assert.equal(daTela([pernaDeSaida, gasto], [], "transfer").length, 1);
});

// -----------------------------------------------------
// ARMADILHA 5: o gasto no cartao JA ESTA na fatura (HMO-260)
// -----------------------------------------------------
// "Realizado no periodo nunca deve considerar despesas no cartao. Pois ja
// considera a fatura do cartao pro periodo."

/** A fatura ABERTA como `sintetizarFaturasAbertas` a monta (HMO-227). */
const faturaAberta = (over = {}) => ({
  id: null,
  notes: "fatura:2026-10-01:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  description: "Fatura C6 10/2026",
  amount: 400,
  due_date: "2026-10-10",
  my_status: "pending",
  my_effective_status: "pending",
  direction: "expense",
  account_name: "C6",
  ...over,
});

test("uma compra de R$ 400 no cartao fecha o mes em R$ 400, e nao em R$ 800", () => {
  // O cenario exato da issue: a compra esta em `financial_transactions` (ela
  // aparece em Financas Pessoais, que e onde a pessoa a lancou) E dentro da
  // fatura aberta que o lado previsto sintetiza inteira.
  const compraNoCartao = realizada({
    id: "compra",
    description: "Mercado",
    amount: -400,
    transaction_date: "2026-10-03",
    transaction_type: "expense",
    category: { name: "Alimentação", is_expense: true },
    account: { id: "cartao", name: "C6", account_type: "credit_card" },
  });

  const linhas = daTela([compraNoCartao], [faturaAberta()], "expense");
  const r = resumoDaTela(linhas);

  // CONTROLE: e o numero que a conta ERRADA produzia. Sem o filtro, a compra
  // entra no realizado, a fatura que a contem entra no previsto, e `total` --
  // que e `previsto + realizado` -- dobra a mesma compra. R$ 800 nao parece um
  // erro: ele "fecha" com as duas linhas que a lista mostrava logo abaixo.
  assert.equal(400 + 400, 800, "o controle precisa dobrar para valer");

  assert.equal(r.realizado, 0);
  assert.equal(r.previsto, 400);
  assert.equal(r.total, 400);
  assert.notEqual(r.total, 800);

  // E a lista tem UMA linha: a fatura. A compra solta sairia ao lado dela com o
  // mesmo valor, que e o que faz a duplicata se ler como lancamento duplicado.
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].origem, "previsto");
  assert.equal(linhas[0].descricao, "Fatura C6 10/2026");
});

test("a linha do cartao sai de Despesas E de Receitas -- e o pagamento fica em Transferencias", () => {
  // "Fora de Despesas" nao pode querer dizer "fora do app": o gasto no cartao
  // continua em Financas Pessoais e dentro do cartao. Desde a fase 6 o ESTORNO
  // no cartao sai tambem de Receitas: ele abate a fatura, e a fatura e que
  // conta. Este bloco prova as tres telas juntas -- sem ele, mover o filtro
  // para antes do `classificarMovimentacao` passaria verde e apagaria o
  // pagamento da fatura da tela de Transferencias.
  const noCartao = { id: "cartao", name: "C6", account_type: "credit_card" };

  const estorno = realizada({
    id: "estorno",
    amount: 90,
    transaction_type: "income",
    category: { name: "Reembolso", is_expense: false },
    account: noCartao,
  });

  // A perna de ENTRADA do pagamento da fatura mora NO CARTAO (ela quita a
  // divida): `pernasDoPagamentoDeFatura` manda o dinheiro da conta corrente
  // para o cartao.
  const quitacaoDaFatura = realizada({
    id: "quitacao",
    amount: 400,
    transaction_type: "transfer",
    counterpart_transaction_id: "saida",
    account: noCartao,
  });
  const saidaDaCorrente = realizada({
    id: "saida",
    amount: -400,
    transaction_type: "transfer",
    account: { id: "corrente", name: "Itaú", account_type: "checking" },
  });

  // E uma receita comum, fora do cartao, que FICA em Receitas: o controle de
  // que a peneira e o cartao, e nao a tela.
  const salario = realizada({
    id: "salario",
    amount: 5000,
    transaction_type: "income",
    account: { id: "corrente", name: "Itaú", account_type: "checking" },
  });

  const todas = [estorno, quitacaoDaFatura, saidaDaCorrente, salario];

  // Em Receitas o estorno no cartao SAI, e o salario fica.
  const receitas = daTela(todas, [], "income");
  assert.deepEqual(
    receitas.map((l) => l.id),
    ["salario"]
  );
  assert.equal(resumoDaTela(receitas).realizado, 5000);

  // Em Transferencias o pagamento da fatura continua la, uma vez so (a perna de
  // entrada e a que sai, pela armadilha 3 -- e nao pelo tipo da conta).
  const transferencias = daTela(todas, [], "transfer");
  assert.equal(transferencias.length, 1);
  assert.equal(transferencias[0].id, "saida");
  assert.equal(resumoDaTela(transferencias).realizado, 400);

  // E em Despesas nenhuma das quatro aparece: duas sao transferencia, duas sao
  // receita.
  assert.equal(daTela(todas, [], "expense").length, 0);
});

test("SEM conta a despesa FICA -- `nao sei` nao pode virar `e cartao`", () => {
  // A despesa de grupo e gravada sem `account_id` (lib/destino-do-lancamento),
  // e um embed `null` por RLS significa "nao sei". Esconder no "nao sei"
  // apagaria despesa legitima do unico total que a pessoa abre para saber
  // quanto gastou -- e um total MENOR nao parece um erro, parece um mes barato.
  const semConta = realizada({ id: "grupo", amount: -250, account: null });
  const semCampo = realizada({ id: "antiga", amount: -60 });
  const embedVazio = realizada({ id: "rls", amount: -40, account: [] });

  const linhas = daTela([semConta, semCampo, embedVazio], [], "expense");

  assert.equal(linhas.length, 3);
  assert.equal(resumoDaTela(linhas).realizado, 350);

  assert.equal(ehGastoNoCartao(semConta), false);
  assert.equal(ehGastoNoCartao(semCampo), false);
  assert.equal(ehGastoNoCartao(embedVazio), false);
});

test("compra no cartao com transaction_type NULO FICA -- a fatura nao a contem", () => {
  // O conserto desta issue so pode esconder a linha que a fatura de fato
  // CONTEM, e quem decide isso e a view `card_invoice_lines` (006/035):
  //
  //     WHERE a.account_type = 'credit_card'
  //       AND t.transaction_type IN ('expense', 'income')
  //
  // Ha linha com `transaction_type` NULO em producao (o POST de
  // /api/personal-finance/transactions nao a gravava), e ela NAO entra na
  // fatura. Escondida daqui pelo tipo da conta, ela sairia da tela de Despesas
  // sem que nada a somasse no lugar -- o valor sairia do app, que e pior do que
  // conta-lo duas vezes.
  const semTipo = realizada({
    id: "antiga",
    amount: -150,
    transaction_type: null,
    category: { name: "Alimentação", is_expense: true },
    account: { id: "cartao", name: "C6", account_type: "credit_card" },
  });

  assert.equal(ehGastoNoCartao(semTipo), false);

  const linhas = daTela([semTipo], [], "expense");
  assert.equal(linhas.length, 1, "a linha antiga sumiu da tela de Despesas");
  assert.equal(resumoDaTela(linhas).realizado, 150);

  // E a linha COM o tipo gravado continua saindo -- senao este bloco teria
  // desfeito a issue inteira em vez de proteger um caso de borda.
  const comTipo = realizada({
    ...semTipo,
    id: "nova",
    transaction_type: "expense",
  });
  assert.equal(ehGastoNoCartao(comTipo), true);
  assert.equal(daTela([comTipo], [], "expense").length, 0);
});

test("o embed da conta em ARRAY tambem e lido -- senao o filtro para de filtrar", () => {
  // A rota entrega a resposta com `as unknown as RealizadaCrua[]`, e o tsc nao
  // verifica nada nessa fronteira. Se o PostgREST/supabase-js devolvesse o
  // embed em array, ler so a forma objeto daria `undefined` em TODA linha,
  // nenhuma casaria com `credit_card`, o filtro passaria a nao filtrar NADA e a
  // tela voltaria ao defeito desta issue -- sem erro, sem log, tsc verde.
  const emArray = realizada({
    id: "compra",
    amount: -400,
    account: [{ id: "cartao", name: "C6", account_type: "credit_card" }],
  });

  assert.equal(ehGastoNoCartao(emArray), true);
  assert.equal(daTela([emArray], [], "expense").length, 0);
});

test("so `credit_card` e cartao: debito, corrente e poupanca continuam contando", () => {
  // `debit_card` e o caso que nao se resolve pelo nome: a pessoa chama aquilo
  // de "cartao", mas o dinheiro sai da conta na hora e nao existe fatura
  // nenhuma para conter o gasto. Ele tem de ficar no realizado.
  //
  // E um typo na constante (`credit-card`) nao daria erro nenhum: nenhuma linha
  // casaria e o filtro passaria a nao filtrar nada.
  assert.equal(TIPO_CARTAO, "credit_card");

  const linhas = daTela(
    [
      realizada({
        id: "debito",
        amount: -70,
        account: { id: "d", name: "Visa Débito", account_type: "debit_card" },
      }),
      realizada({
        id: "corrente",
        amount: -30,
        account: { id: "c", name: "Itaú", account_type: "checking" },
      }),
      realizada({
        id: "poupanca",
        amount: -10,
        account: { id: "p", name: "Poupança", account_type: "savings" },
      }),
    ],
    [],
    "expense"
  );

  assert.equal(linhas.length, 3);
  assert.equal(resumoDaTela(linhas).realizado, 110);
});

test("linha antiga com transaction_type NULL e classificada pela CATEGORIA", () => {
  // Ha linha com a coluna nula em producao (o POST de
  // /api/personal-finance/transactions nao a gravava). Sem `is_expense` no
  // select, a classificacao cairia no sinal.
  const estorno = realizada({
    id: "estorno",
    amount: 120, // positivo, e ainda assim da categoria de despesa
    transaction_type: null,
    category: { name: "Saúde", is_expense: true },
  });
  const salario = realizada({
    id: "salario",
    amount: 7000,
    transaction_type: null,
    category: { name: "Salário", is_expense: false },
  });

  assert.equal(daTela([estorno, salario], [], "expense").length, 1);
  assert.equal(daTela([estorno, salario], [], "expense")[0].id, "estorno");
  assert.equal(daTela([estorno, salario], [], "income")[0].id, "salario");
});

test("sem tipo e sem categoria, sobra o sinal -- e ele e melhor que descartar", () => {
  const linhas = daTela(
    [
      realizada({ id: "neg", amount: -30, transaction_type: null, category: null }),
      realizada({ id: "pos", amount: 30, transaction_type: null, category: null }),
    ],
    [],
    "expense"
  );
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].id, "neg");
});

test("o previsto le `direction` da view, e NAO refaz o COALESCE da 027", () => {
  // Uma receita prevista avulsa com `direction: "income"` nao pode virar conta
  // a pagar. Era esse o defeito que a 027 fechou, e um `?? "expense"` sobre o
  // tipo da OCORRENCIA o reabriria.
  const salarioPrevisto = prevista({
    id: "s1",
    description: "Salário",
    amount: "7000.00",
    direction: "income",
  });

  assert.equal(daTela([], [salarioPrevisto], "expense").length, 0);
  const receitas = daTela([], [salarioPrevisto], "income");
  assert.equal(receitas.length, 1);
  assert.equal(resumoDaTela(receitas).previsto, 7000);
});

test("direction fora dos tres tipos fica FORA, em vez de cair em despesa", () => {
  // Um valor novo no ENUM chegaria aqui como lixo. Um `?? "expense"` o
  // enfiaria na tela de Despesas -- uma receita prevista virando conta a pagar.
  // Fora e melhor: a linha falta em UMA tela, e o total das tres deixa de
  // fechar com o da agenda, que e um sintoma que da para ver.
  assert.equal(linhaPrevista(prevista({ direction: null })), null);
  assert.equal(linhaPrevista(prevista({ direction: undefined })), null);
  assert.equal(linhaPrevista(prevista({ direction: "" })), null);
  assert.equal(linhaPrevista(prevista({ direction: "refund" })), null);
  assert.equal(linhaPrevista(prevista({ direction: "EXPENSE" })), null);
});

// -----------------------------------------------------
// O embed do PostgREST sobre uma VIEW chega em DUAS formas
// -----------------------------------------------------
test("categoria e conta do previsto sao lidas tanto no objeto quanto no array", () => {
  // Sobre tabela o supabase-js da objeto; sobre VIEW ele tipa como array e o
  // PostgREST devolve objeto. Ler a forma errada da `undefined` em TODA linha,
  // sem erro nenhum: a coluna some da lista inteira.
  const comObjeto = linhaPrevista(
    prevista({ category: { name: "Moradia" }, account: { name: "Itaú" } })
  );
  const comArray = linhaPrevista(
    prevista({ category: [{ name: "Moradia" }], account: [{ name: "Itaú" }] })
  );

  assert.equal(comObjeto.categoria, "Moradia");
  assert.equal(comObjeto.conta, "Itaú");
  assert.equal(comArray.categoria, "Moradia");
  assert.equal(comArray.conta, "Itaú");

  // Array vazio e `null` sao a mesma ausencia, e nenhum dos dois pode explodir.
  const semNada = linhaPrevista(prevista({ category: [], account: null }));
  assert.equal(semNada.categoria, null);
  assert.equal(semNada.conta, null);
});

// -----------------------------------------------------
// A fatura aberta do cartao: previsto que nao existe em tabela nenhuma
// -----------------------------------------------------
test("a fatura aberta entra no previsto com chave de fatura e `gravada: false`", () => {
  // Como `sintetizarFaturasAbertas` a monta (HMO-227): `id: null` e a chave
  // canonica em `notes`.
  const fatura = linhaPrevista({
    id: null,
    notes: "fatura:2026-10-01:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    description: "Fatura C6 · out/2026",
    amount: 1240.55,
    due_date: "2026-10-10",
    my_status: "pending",
    my_effective_status: "pending",
    direction: "expense",
    account_name: "C6",
  });

  assert.equal(fatura.gravada, false);
  assert.equal(fatura.valor, 1240.55);
  assert.equal(fatura.conta, "C6");
  // A chave NAO pode passar por um uuid: ela vai virar `key` de lista, e um id
  // sintetico plausivel acabaria montando `/api/scheduled-transactions/<isto>`.
  assert.ok(fatura.id.startsWith("fatura:"));
  assert.ok(!/^[0-9a-f]{8}-/.test(fatura.id));

  // A linha gravada e o contrario: id do banco e `gravada: true`.
  assert.equal(linhaPrevista(prevista({ id: "s1" })).gravada, true);
  assert.equal(linhaPrevista(prevista({ id: "s1" })).id, "s1");
  assert.equal(linhaRealizada(realizada(), indiceDeContraparte([]), SEM_FIXAS).gravada, true);
});

// -----------------------------------------------------
// A NATUREZA DA LINHA: fatura, fixa ou comum (HMO-285)
// -----------------------------------------------------
// `natureza` e `fatura` nao entram em soma nenhuma -- e e por isso que eles
// precisam de bloco proprio. Um campo de ROTULO errado nao muda um centavo em
// nenhum dos tres cartoes, entao os 40 blocos acima continuariam verdes com a
// classificacao inteira invertida.

/** A chave canonica de uma fatura, como `chaveFatura` a monta. */
const CARTAO = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const CHAVE_DE_FATURA = `fatura:2026-10-01:${CARTAO}`;

test("o previsto comum e `despesa`, e nao aponta para fatura nenhuma", () => {
  const linha = linhaPrevista(prevista({ id: "s1" }));

  assert.equal(linha.natureza, "despesa");
  // `null` e nao `{}`: um objeto vazio passaria por um `if (linha.fatura)` e a
  // tela montaria link para `/dashboard/cartoes?mes=undefined`.
  assert.equal(linha.fatura, null);
});

test("o previsto com `recurring_rule_id` e `fixa`", () => {
  const fixa = linhaPrevista(
    prevista({ id: "s1", recurring_rule_id: "11111111-2222-3333-4444-555555555555" })
  );

  assert.equal(fixa.natureza, "fixa");
  assert.equal(fixa.fatura, null, "conta fixa nao tem para onde apontar");

  // CONTROLE, e e ele que da sentido ao de cima: a MESMA linha sem o elo e
  // comum. Sem este par, uma classificacao que respondesse "fixa" para tudo
  // passaria verde.
  assert.equal(linhaPrevista(prevista({ id: "s1" })).natureza, "despesa");
});

test("`recurring_rule_id` ausente, null ou vazio NAO e regra fixa", () => {
  // A previsao AVULSA tem a coluna nula (027), e e o caso mais comum de quem
  // lanca conta a conta. Uma leitura por presenca do campo (`!== undefined`)
  // chamaria TODA linha vinda da view de fixa, porque o PostgREST devolve a
  // coluna como `null` e nao a omite.
  for (const elo of [undefined, null, "", "   "]) {
    assert.equal(
      linhaPrevista(prevista({ id: "s1", recurring_rule_id: elo })).natureza,
      "despesa",
      `recurring_rule_id ${JSON.stringify(elo)} nao e elo para regra nenhuma`
    );
  }
});

test("a fatura ABERTA (sintetizada) e `fatura`, e carrega cartao E mes", () => {
  // Como `sintetizarFaturasAbertas` a monta (HMO-227): `id: null`, a chave
  // canonica em `notes`.
  const linha = linhaPrevista({
    id: null,
    notes: CHAVE_DE_FATURA,
    description: "Fatura C6 · out/2026",
    amount: 1240.55,
    due_date: "2026-10-10",
    my_status: "pending",
    my_effective_status: "pending",
    direction: "expense",
    account_name: "C6",
  });

  assert.equal(linha.natureza, "fatura");
  assert.deepEqual(linha.fatura, { accountId: CARTAO, mes: "2026-10-01" });
  // E o valor nao se mexeu: `natureza` e rotulo, nao aritmetica.
  assert.equal(linha.valor, 1240.55);
});

test("a fatura FECHADA (gravada) e `fatura` tambem -- um criterio para as duas", () => {
  // O fechamento grava uma `scheduled_transaction` de verdade com a MESMA chave
  // em `notes` (POST /api/card-invoices/close). Um criterio por `gravada` daria
  // duas respostas para a mesma pergunta, e seria a fatura FECHADA a perder o
  // caminho de volta -- justamente a que a pessoa vai pagar.
  const linha = linhaPrevista(
    prevista({ id: "s-fatura", notes: CHAVE_DE_FATURA, amount: "1240.55" })
  );

  assert.equal(linha.gravada, true, "a fatura fechada existe no banco");
  assert.equal(linha.natureza, "fatura");
  assert.deepEqual(linha.fatura, { accountId: CARTAO, mes: "2026-10-01" });
});

test("fatura E regra fixa na mesma linha: ela e FATURA, nao fixa", () => {
  // ESTE BLOCO E A ORDEM DE AVALIACAO, e o estado nao e forjado: `notes` e um
  // campo de texto livre que o usuario preenche, e a regex da chave e ancorada
  // nas duas pontas exatamente porque uma nota escrita a mao pode casar com ela
  // (ver lib/chave-da-fatura.ts). Uma ocorrencia de regra recorrente com esta
  // nota existe pelo caminho normal do app.
  //
  // Invertida a ordem, a linha vira "fixa" e PERDE `fatura` -- o unico campo que
  // leva de volta ao cartao e ao mes, que e o ponto desta issue. O erro nao
  // aparece em soma nenhuma.
  const linha = linhaPrevista(
    prevista({
      id: "s1",
      notes: CHAVE_DE_FATURA,
      recurring_rule_id: "11111111-2222-3333-4444-555555555555",
    })
  );

  assert.equal(linha.natureza, "fatura");
  assert.deepEqual(linha.fatura, { accountId: CARTAO, mes: "2026-10-01" });
});

test("`notes` que NAO e a chave canonica nao vira fatura", () => {
  // A regex e ancorada nas duas pontas. Sem isso, a descricao livre do usuario
  // viraria regra de negocio -- e a linha ganharia um link para um cartao que
  // nao e dela.
  for (const nota of [
    "paguei no debito",
    `${CHAVE_DE_FATURA} paguei no debito`,
    `prefixo ${CHAVE_DE_FATURA}`,
    "fatura:2026-10-01:nao-e-uuid",
    "fatura:",
  ]) {
    const linha = linhaPrevista(prevista({ id: "s1", notes: nota }));
    assert.equal(linha.natureza, "despesa", `"${nota}" nao e chave de fatura`);
    assert.equal(linha.fatura, null, `"${nota}" nao aponta para cartao nenhum`);
  }
});

test("a realizada e `fixa` quando o id esta no conjunto, e `despesa` quando nao", () => {
  // O elo e de UMA VIA: `financial_transactions` nao tem `recurring_rule_id`
  // (001). O conjunto vem da terceira consulta da rota, com os
  // `scheduled_transactions.transaction_id` que tem regra.
  const indice = indiceDeContraparte([]);

  const fixa = linhaRealizada(
    realizada({ id: "t-fixa" }),
    indice,
    new Set(["t-fixa"])
  );
  assert.equal(fixa.natureza, "fixa");

  // CONTROLE: a MESMA linha, com o conjunto nao a contendo, e comum.
  const comum = linhaRealizada(
    realizada({ id: "t-fixa" }),
    indice,
    new Set(["outro-id"])
  );
  assert.equal(comum.natureza, "despesa");

  // E o conjunto VAZIO -- que e o que a rota entrega quando a consulta falha --
  // deixa tudo comum, que e o estado de antes desta issue.
  assert.equal(
    linhaRealizada(realizada({ id: "t-fixa" }), indice, SEM_FIXAS).natureza,
    "despesa"
  );
});

test("a realizada COMUM nao e fatura, com ou sem o conjunto de fixas", () => {
  // Este bloco afirmava "a realizada NUNCA e fatura" ate a HMO-264, e o nome
  // dele era a razao pela qual `fatura: null` era literal em `linhaRealizada`.
  // A fatura PAGA derrubou aquela afirmacao -- mas nao esta: a linha que NAO e o
  // pagamento da fatura continua sem cartao e sem mes, e e isso que impede a
  // tela de montar um link a partir de uma linha que nao tem para onde apontar.
  //
  // O caso que agora E fatura esta no bloco da armadilha 6, mais abaixo.
  const indice = indiceDeContraparte([]);

  for (const ids of [SEM_FIXAS, new Set(["t1"])]) {
    const linha = linhaRealizada(realizada(), indice, ids, EU);
    assert.equal(linha.fatura, null);
    assert.notEqual(linha.natureza, "fatura");
  }
});

test("as tres naturezas convivem na MESMA tela, e nenhuma delas move um centavo", () => {
  const realizadas = [
    realizada({ id: "t-fixa", amount: -159.9 }),
    realizada({ id: "t-comum", amount: -40.1 }),
  ];
  const previstas = [
    prevista({ id: "s-fixa", amount: "200.00", recurring_rule_id: "r1" }),
    prevista({ id: "s-comum", amount: "50.00" }),
    prevista({ id: "s-fatura", amount: "1240.55", notes: CHAVE_DE_FATURA }),
  ];

  const comFixas = linhasDaTela(
    realizadas,
    previstas,
    "expense",
    new Set(["t-fixa"])
  );

  const porId = new Map(comFixas.map((l) => [l.id, l]));
  assert.deepEqual(
    [...porId].map(([id, l]) => [id, l.natureza]).sort(),
    [
      ["s-comum", "despesa"],
      ["s-fatura", "fatura"],
      ["s-fixa", "fixa"],
      ["t-comum", "despesa"],
      ["t-fixa", "fixa"],
    ]
  );

  // A TRAVA DA ISSUE: Total, Previsto e Realizado tem de fechar EXATAMENTE
  // iguais com e sem o conjunto. O rotulo nao pode ter tocado a aritmetica, e a
  // forma de provar isso e rodar as duas e comparar -- um numero escrito a mao
  // aqui so afirmaria que a soma de hoje e a soma de hoje.
  const semFixas = linhasDaTela(realizadas, previstas, "expense", SEM_FIXAS);

  assert.deepEqual(resumoDaTela(comFixas), resumoDaTela(semFixas));
  assert.deepEqual(previstoVencido(comFixas), previstoVencido(semFixas));
  assert.equal(resumoDaTela(comFixas).total, 1690.55);
  assert.equal(resumoDaTela(comFixas).previsto, 1490.55);
  assert.equal(resumoDaTela(comFixas).realizado, 200);

  // E a unica diferenca entre as duas leituras e o rotulo de UMA linha.
  assert.deepEqual(
    semFixas.map((l) => l.natureza).sort(),
    ["despesa", "despesa", "despesa", "fatura", "fixa"]
  );
});

// -----------------------------------------------------
// ARMADILHA 6: a fatura PAGA nao estava em lado nenhum (HMO-264, fase 6)
// -----------------------------------------------------
// "Despesas do cartao sao todas previstas e se tornam realizadas para todos os
// fins apos cartao ser pago, o total de cartao que deve ser e considerado nos
// totais para calcular previsto e realizado."
//
// A armadilha 5 tirou a compra do Realizado contando que a FATURA estivesse no
// Previsto -- e no mes em que ela e PAGA os dois lados a perdiam juntos. A
// HMO-264 trouxe a perna de saida do pagamento; a fase 6 (RN017.4, 072) a
// trocou pela FATURA PAGA somada: no mes do vencimento, pelo total das compras.
// A rota monta a linha com `faturasPagasComoRealizadas`, e estes blocos usam a
// mesma funcao.

/** A conta de onde o dinheiro da fatura sai. Nao e cartao. */
const CONTA_CORRENTE = "11111111-2222-3333-4444-555555555555";

/**
 * A perna de SAIDA do pagamento da fatura, como `pagarFatura` a grava.
 *
 * `notes` e a chave canonica porque a rota copia
 * `scheduled_transactions.notes` para as DUAS pernas -- e e so por isso que a
 * tela de Transferencias consegue dizer que esta `transfer` e uma fatura.
 */
const pernaDeSaidaDaFatura = (over = {}) =>
  realizada({
    id: "pg-saida",
    description: "Fatura C6 10/2026",
    amount: -1290,
    transaction_type: "transfer",
    transaction_date: "2026-10-08",
    notes: CHAVE_DE_FATURA,
    account: { id: CONTA_CORRENTE, name: "Itaú", account_type: "checking" },
    ...over,
  });

/** A perna de ENTRADA: +total no cartao, com o elo do 015 para a de saida. */
const pernaDeEntradaDaFatura = (over = {}) =>
  realizada({
    id: "pg-entrada",
    description: "Pagamento — Fatura C6 10/2026",
    amount: 1290,
    transaction_type: "transfer",
    transaction_date: "2026-10-08",
    notes: CHAVE_DE_FATURA,
    counterpart_transaction_id: "pg-saida",
    account: { id: CARTAO, name: "C6", account_type: "credit_card" },
    ...over,
  });

/** A conta prevista da fatura depois da baixa: `paid`, e fora do previsto. */
const faturaPaga = (over = {}) =>
  prevista({
    id: "s-fatura",
    description: "Fatura C6 10/2026",
    amount: "1290.00",
    due_date: "2026-10-10",
    notes: CHAVE_DE_FATURA,
    my_status: "paid",
    my_effective_status: "paid",
    ...over,
  });

/** Uma linha de `card_invoice_paid_entries` (072), da fatura de outubro do C6. */
const linhaDaFaturaPaga = (over = {}) => ({
  id: "compra",
  account_id: CARTAO,
  account_name: "C6",
  invoice_month: "2026-10-01",
  invoice_description: "Fatura C6 10/2026",
  due_date: "2026-10-10",
  paid_date: "2026-10-08",
  category_id: "cat-mercado",
  invoice_amount: "1290.00",
  currency: "BRL",
  include_in_total: true,
  ...over,
});

/** A fatura paga, somada, do jeito que a rota a poe na aba Despesas. */
const faturaPagaSomada = (linhas = [linhaDaFaturaPaga()]) => {
  const [fatura] = faturasPagasComoRealizadas(linhas);
  return fatura;
};

test("o mes da fatura PAGA fecha no MESMO Total do mes da fatura ABERTA", () => {
  // A VERIFICACAO QUE A ISSUE PEDE, e ela e um oraculo e nao um numero escrito
  // a mao: dois meses IDENTICOS -- a mesma compra de R$ 1.290 no mesmo cartao --
  // em que a unica diferenca e a fatura ter sido paga ou nao. Os dois tem de
  // fechar no mesmo Total, porque o mes nao ficou mais barato por ela ter sido
  // paga.
  const compra = realizada({
    id: "compra",
    amount: -1290,
    transaction_type: "expense",
    account: { id: CARTAO, name: "C6", account_type: "credit_card" },
  });

  // MES A: fatura ABERTA. A compra esta escondida (armadilha 5) e a fatura
  // inteira esta no Previsto, sintetizada de `card_invoice_lines` (HMO-227).
  const aberta = daTela([compra], [faturaAberta({ amount: 1290 })], "expense");

  // MES B: a MESMA compra, e a fatura foi PAGA. Ela saiu do Previsto por
  // `my_status: 'paid'` (armadilha 2), o pagamento entrou em duas pernas, e a
  // rota somou a fatura.
  const paga = daTela(
    [compra, pernaDeSaidaDaFatura(), pernaDeEntradaDaFatura(), faturaPagaSomada()],
    [faturaPaga()],
    "expense"
  );

  assert.equal(resumoDaTela(aberta).total, 1290);
  assert.equal(resumoDaTela(paga).total, 1290);

  // E OS DOIS LADOS TROCARAM DE LUGAR. Afirmar so o Total passaria verde com a
  // fatura em qualquer um dos dois -- inclusive nos DOIS, que e o jeito de ela
  // contar duas vezes (o Total e previsto + realizado).
  assert.deepEqual(
    [resumoDaTela(aberta).previsto, resumoDaTela(aberta).realizado],
    [1290, 0]
  );
  assert.deepEqual(
    [resumoDaTela(paga).previsto, resumoDaTela(paga).realizado],
    [0, 1290]
  );

  // UMA linha em cada mes, e nao duas: a compra continua escondida no mes da
  // fatura paga, que e o que impede o cartao de contar duas vezes (HMO-260), e
  // as pernas ficam em Transferencias.
  assert.equal(aberta.length, 1);
  assert.equal(paga.length, 1);
  assert.equal(paga[0].id, `${PREFIXO_DA_FATURA_PAGA}${CARTAO}:2026-10-01`);
});

test("as pernas do pagamento NAO entram em Despesas -- so a fatura somada", () => {
  // Ate a fase 5 a perna de saida era a fatura paga da aba. Com ela E a fatura
  // somada, o mes fecharia no dobro: R$ 2.580 de uma fatura de R$ 1.290.
  const pernas = [pernaDeSaidaDaFatura(), pernaDeEntradaDaFatura()];
  assert.equal(daTela(pernas, [], "expense").length, 0);

  const despesas = daTela([...pernas, faturaPagaSomada()], [], "expense");
  assert.equal(despesas.length, 1);
  assert.equal(resumoDaTela(despesas).realizado, 1290);
  assert.notEqual(resumoDaTela(despesas).realizado, 2580);

  // A perna de saida continua sendo reconhecida -- e o selo dela em
  // Transferencias, no bloco abaixo.
  assert.equal(ehPagamentoDaFatura(pernaDeSaidaDaFatura()), true);
  assert.equal(ehPagamentoDaFatura(pernaDeEntradaDaFatura()), false);
});

test("a perna de saida fica em Transferencias, `transfer` e com o selo da fatura", () => {
  // Pagar a fatura E um movimento entre duas contas minhas, e e so isso que a
  // tela de Transferencias afirma. O selo e o caminho de volta para o cartao
  // continuam la.
  const pernas = [pernaDeSaidaDaFatura(), pernaDeEntradaDaFatura()];
  const transferencias = daTela(pernas, [], "transfer");

  assert.equal(transferencias.length, 1);
  assert.equal(transferencias[0].id, "pg-saida");
  assert.equal(transferencias[0].tipo, "transfer");
  assert.equal(transferencias[0].natureza, "fatura");
  assert.deepEqual(transferencias[0].fatura, { accountId: CARTAO, mes: "2026-10-01" });
  assert.equal(resumoDaTela(transferencias).realizado, 1290);
});

test("a perna de entrada SEM o elo tambem fica fora -- o sinal e a rede", () => {
  // O FK `counterpart_transaction_id` e `ON DELETE SET NULL`: a perna de entrada
  // pode perder o elo e continuar no saldo do cartao. E o SINAL que a pega --
  // em `ehPernaDeEntrada` e tambem no criterio estrito de `ehPagamentoDaFatura`
  // --, e sem ele ela entraria como uma segunda fatura em Transferencias.
  const semElo = pernaDeEntradaDaFatura({ counterpart_transaction_id: null });
  assert.equal(ehPagamentoDaFatura(semElo), false);

  const transferencias = daTela([pernaDeSaidaDaFatura(), semElo], [], "transfer");
  assert.equal(transferencias.length, 1);
  assert.equal(resumoDaTela(transferencias).realizado, 1290);
});

test("o par de pagamento de valor ZERO nao e fatura paga, e nao sai do app", () => {
  // A DECISAO DE PRODUTO DA HMO-317, E ELA TINHA DE SER UMA: ate a fase 6
  // `ehPagamentoDaFatura` respondia tambem pelo Realizado do painel, e as duas
  // copias que existiam divergiam exatamente aqui -- o par de zero ficava fora
  // la (o sinal estrito) e entrava nesta tela, por `ehPernaDeEntrada`, que deixa
  // as duas linhas de zero passarem de proposito. Desde a fase 6 ela decide so
  // o selo da perna em Transferencias.
  //
  // A DECISAO E "FICA FORA", E ELA NAO APAGA NADA: `ehPernaDeEntrada` nao mudou,
  // entao o par continua inteiro na tela de TRANSFERENCIAS, que e onde uma
  // transferencia de valor zero mora. O argumento que justificava deixa-lo
  // entrar ("esconder uma delas seria a tela apagando um lancamento que a pessoa
  // criou") e sobre AQUELA tela, e continua de pe la.
  const zeroA = pernaDeSaidaDaFatura({ id: "zero-a", amount: 0 });
  const zeroB = pernaDeEntradaDaFatura({
    id: "zero-b",
    amount: 0,
    counterpart_transaction_id: null,
  });

  assert.equal(ehPagamentoDaFatura(zeroA), false);
  assert.equal(ehPagamentoDaFatura(zeroB), false);

  // FORA DE DESPESAS: nenhuma das duas se apresenta como «Fatura» -- um rotulo
  // que tira o Editar e o Excluir (`podeAgirNaLinha` recusa toda linha de
  // fatura) de uma linha que a pessoa pode querer corrigir, e que oferece um
  // caminho para a tela de um cartao por um pagamento de R$ 0,00.
  assert.equal(daTela([zeroA, zeroB], [], "expense").length, 0);

  // E INTEIRO EM TRANSFERENCIAS, as DUAS linhas. E o controle do "nao apaga": um
  // bloco que afirmasse so a ausencia em Despesas passaria verde numa versao que
  // tirasse o par das tres telas.
  const transferencias = daTela([zeroA, zeroB], [], "transfer");
  assert.deepEqual(
    transferencias.map((l) => l.id),
    ["zero-a", "zero-b"]
  );
});

test("a fatura paga se apresenta como FATURA, com o cartao e o mes", () => {
  // "Precisa ser a FATURA reconhecida como fatura, nao a transferencia
  // reclassificada": e `natureza` + `fatura` que dao a ela o rotulo e o caminho
  // de volta para a tela do cartao. Pelo mesmo criterio do lado previsto.
  const [linha] = daTela([faturaPagaSomada()], [], "expense");

  assert.equal(linha.natureza, "fatura");
  assert.deepEqual(linha.fatura, { accountId: CARTAO, mes: "2026-10-01" });
  assert.equal(linha.origem, "realizado");
  assert.equal(linha.tipo, "expense");
  // NINGUEM EDITA UMA SOMA: a linha nao tem `user_id`, e `posso_editar` cai.
  assert.equal(linha.posso_editar, false);
  // E ela NAO e o elo da HMO-305: aquele e sobre uma conta A PAGAR, e oferecer o
  // desfazer aqui daria um botao que a rota recusa.
  assert.equal(linha.elo_da_fatura, null);
  assert.equal(linha.fatura_suspeita, null);

  // FATURA VENCE FIXA, a mesma ordem do lado previsto: chama-la de "fixa"
  // tiraria dela o cartao e o mes, que e a unica coisa que `fatura` da.
  const comoFixa = daTela(
    [faturaPagaSomada()],
    [],
    "expense",
    new Set([linha.id])
  );
  assert.equal(comoFixa[0].natureza, "fatura");
});

test("a fatura paga NAO aparece em Receitas nem em Transferencias", () => {
  // A excecao da decisao 3 e so em Despesas. Sem a guarda de `tipo`, a fatura
  // somada entraria no total de Receitas do mes -- o pagamento do cartao
  // somado como dinheiro que entrou.
  const fatura = faturaPagaSomada();
  assert.equal(daTela([fatura], [], "income").length, 0);
  assert.equal(resumoDaTela(daTela([fatura], [], "income")).realizado, 0);
  assert.equal(daTela([fatura], [], "transfer").length, 0);
});

test("o valor e o TOTAL das compras, e nunca o que foi pago", () => {
  // RN017.4: a fatura conta pelo total das compras dela. A pessoa pagou
  // R$ 1.200 de uma fatura de R$ 1.290 -- a diferenca fica no saldo do cartao,
  // e a despesa do mes nao muda.
  const despesas = daTela(
    [
      pernaDeSaidaDaFatura({ amount: -1200 }),
      pernaDeEntradaDaFatura({ amount: 1200 }),
      faturaPagaSomada([
        linhaDaFaturaPaga({ id: "c1", invoice_amount: "1000.00" }),
        linhaDaFaturaPaga({ id: "c2", invoice_amount: "290.00" }),
      ]),
    ],
    [faturaPaga({ amount: "1290.00" })],
    "expense"
  );

  assert.equal(resumoDaTela(despesas).realizado, 1290);
  assert.notEqual(resumoDaTela(despesas).realizado, 1200);
});

test("o estorno abate a fatura, e a linha fora dos totais nao soma", () => {
  // `invoice_amount` e negativo no estorno (a view da 006), e a fatura soma os
  // dois. A linha desmarcada (060) fica fora, como em toda soma do app.
  const fatura = faturaPagaSomada([
    linhaDaFaturaPaga({ id: "mercado", invoice_amount: "300.00" }),
    linhaDaFaturaPaga({ id: "estorno", invoice_amount: "-40.00" }),
    linhaDaFaturaPaga({ id: "presente", invoice_amount: "50.00", include_in_total: false }),
  ]);
  const despesas = daTela([fatura], [], "expense");
  assert.equal(resumoDaTela(despesas).realizado, 260);

  // A FATURA DE TOTAL ZERO OU NEGATIVO NAO VIRA LINHA: a aba nao mostra
  // despesa negativa.
  assert.deepEqual(
    faturasPagasComoRealizadas([
      linhaDaFaturaPaga({ id: "estorno", invoice_amount: "-40.00" }),
    ]),
    []
  );
});

test("a fatura paga entra pela data do VENCIMENTO, nao pela do pagamento", () => {
  // RN017.4: a fatura conta no mes do vencimento. A que vence em 05/11 e foi
  // paga em 30/10 cai em NOVEMBRO -- e e o mes em que ela estava no Previsto ate
  // ser paga. Pela data do pagamento, pagar adiantado mudaria o mes.
  const [linha] = daTela(
    [
      faturaPagaSomada([
        linhaDaFaturaPaga({ due_date: "2026-11-05", paid_date: "2026-10-30" }),
      ]),
    ],
    [],
    "expense"
  );

  assert.equal(linha.data, "2026-11-05");
  // E A CHAVE CONTINUA APONTANDO PARA A FATURA DE OUTUBRO. O mes da fatura e o
  // mes do vencimento nao sao o mesmo numero (`card_invoice_due_date` empurra o
  // vencimento quando o dia de vencer vem antes do fechamento), e e a chave que
  // carrega o primeiro.
  assert.deepEqual(linha.fatura, { accountId: CARTAO, mes: "2026-10-01" });
});

test("o id com o prefixo e o que separa a fatura somada", () => {
  // Os tres criterios de `ehFaturaPagaNoResultado`, um de cada vez.
  const fatura = faturaPagaSomada();
  assert.equal(ehFaturaPagaNoResultado(fatura), true);

  // Sem o prefixo: e uma `expense` com a chave, a despesa do elo da HMO-305.
  assert.equal(ehFaturaPagaNoResultado({ ...fatura, id: "uuid-qualquer" }), false);
  // Sem a chave canonica, nao ha cartao nem mes para o caminho de volta.
  assert.equal(ehFaturaPagaNoResultado({ ...fatura, notes: "fatura do mes" }), false);
  // Com outro tipo, ela sairia da aba de Despesas -- e nao entraria em outra.
  assert.equal(
    ehFaturaPagaNoResultado({ ...fatura, transaction_type: "income" }),
    false
  );

  // E O PREFIXO E O MESMO NOS DOIS MODULOS. A string esta repetida em
  // lib/telas-de-movimentacao.ts para nao puxar a arvore da outra; se uma das
  // duas mudar, a fatura somada deixa de ser reconhecida e cai na peneira do
  // cartao -- o mes fica sem a fatura, sem erro.
  assert.equal(PREFIXO_DA_FATURA_PAGA, PREFIXO_DA_FATURA_PAGA_DA_ROTA);
});

test("a despesa do elo da fatura (HMO-305) continua DESPESA, e editavel", () => {
  // Ligar o elo grava a chave canonica em `scheduled_transactions.notes`, e a
  // baixa COMUM copia `notes` para a linha que cria: uma `expense`, negativa,
  // com a chave e sem contraparte -- indistinguivel da perna de saida por tudo
  // menos o `transaction_type`. E ela e uma despesa de VERDADE, paga da conta
  // corrente.
  //
  // O QUE O CRITERIO DO TIPO PROTEGE AQUI NAO E A SOMA. Sem ele a linha nao
  // seria contada duas vezes -- o ramo da fatura faz `continue`, entao ela
  // entraria uma vez pelo ramo novo em vez do filtro de tipo. O que ela perderia
  // e o resto: `natureza: "fatura"` tira o Editar e o Excluir
  // (`podeAgirNaLinha`) e da a ela um link para um cartao que nao e onde aquela
  // despesa aconteceu.
  const doElo = realizada({
    id: "elo",
    amount: -1290,
    transaction_type: "expense",
    notes: CHAVE_DE_FATURA,
    account: { id: CONTA_CORRENTE, name: "Itaú", account_type: "checking" },
  });

  assert.equal(ehPagamentoDaFatura(doElo), false);
  assert.equal(ehFaturaPagaNoResultado(doElo), false);

  const despesas = daTela([doElo], [], "expense");
  assert.equal(despesas.length, 1);
  assert.equal(resumoDaTela(despesas).realizado, 1290);

  // O ROTULO E O QUE ESTE BLOCO MEDE.
  assert.equal(despesas[0].natureza, "despesa");
  assert.equal(despesas[0].fatura, null);
  assert.equal(despesas[0].tipo, "expense");
});

test("o ramo da fatura nao serve de desvio para o gasto NO cartao", () => {
  // O efeito caro do criterio do id: o ramo da fatura em `linhasDaTela` passa
  // POR CIMA de `ehGastoNoCartao` (armadilha 5). Uma linha `expense` na conta
  // de um CARTAO que carregue a chave canonica entraria no Realizado sem
  // aquela peneira -- somada solta ali E dentro da fatura que o Previsto soma,
  // que e o defeito da HMO-260 de volta.
  const noCartaoComAChave = realizada({
    id: "no-cartao",
    amount: -400,
    transaction_type: "expense",
    notes: CHAVE_DE_FATURA,
    account: { id: CARTAO, name: "C6", account_type: "credit_card" },
  });

  assert.equal(ehPagamentoDaFatura(noCartaoComAChave), false);
  assert.equal(ehFaturaPagaNoResultado(noCartaoComAChave), false);
  assert.equal(ehGastoNoCartao(noCartaoComAChave), true);

  // Ela continua ESCONDIDA do Realizado, e a fatura aberta sozinha responde
  // pelos R$ 400.
  const despesas = daTela(
    [noCartaoComAChave],
    [faturaAberta({ amount: 400 })],
    "expense"
  );
  assert.equal(despesas.length, 1);
  assert.equal(resumoDaTela(despesas).realizado, 0);
  assert.equal(resumoDaTela(despesas).total, 400);
  // CONTROLE: pelo desvio, o mes fecharia no dobro da compra.
  assert.notEqual(resumoDaTela(despesas).total, 800);
});

test("`notes` que nao e a chave canonica nao vira fatura paga", () => {
  // A regex e ancorada nas duas pontas de proposito: sem o `$`, a nota escrita
  // a mao viraria regra de negocio.
  for (const notes of [
    null,
    "",
    "pagamento da fatura",
    `fatura:2026-10-01:${CARTAO} paguei no debito`,
    "fatura:2026-10-01:nao-e-uuid",
  ]) {
    assert.equal(
      ehPagamentoDaFatura(pernaDeSaidaDaFatura({ notes })),
      false,
      `notes ${JSON.stringify(notes)} passou por chave canonica`
    );
  }

  // E uma transferencia COMUM entre contas proprias -- sem nota nenhuma --
  // continua fora da tela de Despesas, que e a armadilha 4.
  const pix = pernaDeSaidaDaFatura({ id: "pix", notes: null });
  assert.equal(daTela([pix], [], "expense").length, 0);
  assert.equal(daTela([pix], [], "transfer").length, 1);
});

test("a constante do tipo da perna e o `transfer` do ENUM", () => {
  // Um typo aqui nao da erro: so para de casar, e a fatura paga volta a
  // desaparecer dos dois lados da tela -- o defeito desta issue, em silencio.
  assert.equal(TIPO_DA_PERNA_DE_PAGAMENTO, "transfer");
});

test("sem id E sem notes a linha fica fora -- nao ha chave estavel", () => {
  // Com a chave vindo do indice do array, o React reaproveitaria a linha errada
  // na troca de periodo: o valor de uma conta aparecendo na descricao de outra.
  assert.equal(linhaPrevista({ ...prevista(), id: null, notes: null }), null);
  assert.equal(linhaPrevista({ ...prevista(), id: "", notes: "" }), null);
  assert.equal(linhaPrevista({ ...prevista(), id: "   ", notes: undefined }), null);
});

// -----------------------------------------------------
// ARMADILHA 7: a perna de entrada SOLTA nao estava em lado nenhum (HMO-380)
// -----------------------------------------------------
// O caso medido em PRODUCAO pela prova da HMO-374: a devedora avisou, o credor
// confirmou, a rota gravou UMA linha (`transfer`, +100, sem elo, com a chave
// `mybank:<id>`), o saldo da conta de investimento foi de R$ 0,00 a R$ 100,00 --
// e as TRES abas de Movimentacoes de novembro leram R$ 0,00.
//
// `ehPernaDeEntrada` casa com ela pelo SINAL, e o `continue` da armadilha 3 a
// descartava. Nao ha segunda perna: a saida aconteceu na conta de OUTRA PESSOA.

/** A perna que app/api/mybank/installments/[id]/route.ts grava, como em prod. */
const PERNA_SOLTA_DO_MYBANK = {
  id: "ec4bb603",
  description: "Moto eletrica HMO-374 (prova) (1/24)",
  amount: 100,
  transaction_type: "transfer",
  counterpart_transaction_id: null,
  notes: `${PREFIXO_DO_ELO_DO_MYBANK}parcela-1-de-24`,
  account: { id: "inv", name: "Investimentos" },
};

test("a perna SOLTA do MyBank aparece na aba Transferencias -- os R$ 100 medidos em prod", () => {
  const linhas = daTela([realizada(PERNA_SOLTA_DO_MYBANK)], [], "transfer");

  // CONTROLE, e e o defeito medido: a MESMA linha sem a chave canonica some. Se
  // a excecao desaparecer, este numero e o que a aba volta a mostrar.
  const semAChave = daTela(
    [realizada({ ...PERNA_SOLTA_DO_MYBANK, notes: null })],
    [],
    "transfer"
  );
  assert.equal(semAChave.length, 0, "o controle precisa sumir para a assercao valer");
  assert.equal(resumoDaTela(semAChave).realizado, 0);

  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].id, "ec4bb603");
  assert.equal(resumoDaTela(linhas).realizado, 100);
  // A frase sai por QUAL ponta e conhecida, e nao por qual perna e a desenhada:
  // a conta da outra ponta nao e minha, entao nao ha "A → B" a dizer.
  assert.equal(linhas[0].conta, "entrou em Investimentos");
  // O SELO, o mesmo que o lado previsto poe nas outras 23 parcelas.
  assert.equal(linhas[0].natureza, "mybank");
});

test("ela NAO entra em Despesas nem em Receitas -- os outros dois zeros estao certos", () => {
  // Nao e gasto (nada saiu de conta minha) e o principal voltando nao e receita
  // nova (`PARCELA_FORA_DO_REALIZADO`). So o zero de Transferencias era defeito.
  const emDespesas = daTela([realizada(PERNA_SOLTA_DO_MYBANK)], [], "expense");
  const emReceitas = daTela([realizada(PERNA_SOLTA_DO_MYBANK)], [], "income");

  assert.equal(emDespesas.length, 0);
  assert.equal(emReceitas.length, 0);
  assert.equal(resumoDaTela(emDespesas).realizado, 0);
  assert.equal(resumoDaTela(emReceitas).realizado, 0);
});

test("o Caso A continua de-duplicado: as DUAS pernas com a mesma nota contam UMA vez", () => {
  // A baixa da previsao do auto-emprestimo (HMO-382) grava `comum.notes` nas
  // DUAS pernas -- a nota `mybank:` chega igual na saida e na entrada -- e o elo
  // do 015 na de entrada. Sem o criterio do elo em `ehEntradaSoltaDoMyBank` a
  // armadilha 3 voltaria para o Caso A inteiro.
  const nota = `${PREFIXO_DO_ELO_DO_MYBANK}parcela-do-auto`;
  const linhas = daTela(
    [
      realizada({
        id: "saida",
        amount: -1000,
        transaction_type: "transfer",
        notes: nota,
        account: { id: "cc", name: "Itaú" },
      }),
      realizada({
        id: "entrada",
        amount: 1000,
        transaction_type: "transfer",
        notes: nota,
        counterpart_transaction_id: "saida",
        account: { id: "inv", name: "Investimentos" },
      }),
    ],
    [],
    "transfer"
  );

  // CONTROLE: as duas pernas somam 2.000 em valor absoluto.
  assert.equal(Math.abs(-1000) + Math.abs(1000), 2000);

  assert.equal(linhas.length, 1, "uma linha por parcela, nao duas");
  assert.equal(linhas[0].id, "saida");
  assert.equal(resumoDaTela(linhas).realizado, 1000);
  assert.notEqual(resumoDaTela(linhas).realizado, 2000);
  // E A PERNA QUE FICOU LEVA O SELO -- MUDOU NA HMO-385, e a inversao e o
  // assunto desta issue.
  //
  // Esta assercao dizia `"despesa"`, pelo argumento que a HMO-380 escreveu no
  // criterio do sinal de `ehEntradaSoltaDoMyBank`: "«MyBank» e o selo de uma
  // linha SEM par". A premissa caiu em duas medidas -- o selo DESENHA a palavra
  // de procedencia «MyBank» (`marcaDaLinha`), e o lado PREVISTO ja o poe nesta
  // mesma parcela, que e justamente a linha que vira um par quando paga. O
  // argumento inteiro esta no `natureza` de `linhaRealizada`.
  //
  // Quem o poe aqui e `ehSaidaDaParcelaDoAutoEmprestimo`, e NAO um afrouxamento
  // do sinal de `ehEntradaSoltaDoMyBank`: a de-duplicacao acima -- as tres
  // assercoes de `length`, `id` e total -- e o que aquele criterio protege, e
  // ela continua medida nesta mesma montagem.
  assert.equal(linhas[0].natureza, "mybank");
});

test("ehEntradaSoltaDoMyBank: os QUATRO criterios, um a um", () => {
  const nota = `${PREFIXO_DO_ELO_DO_MYBANK}p1`;
  const solta = {
    amount: 100,
    transaction_type: "transfer",
    notes: nota,
    counterpart_transaction_id: null,
  };

  assert.equal(ehEntradaSoltaDoMyBank(solta), true);

  // 1. O `transaction_type` GRAVADO. Uma receita anotada com a chave nao e a
  //    perna -- e a leitura e da coluna CRUA: pelo SINAL esta linha e receita.
  assert.equal(ehEntradaSoltaDoMyBank({ ...solta, transaction_type: "income" }), false);
  assert.equal(ehEntradaSoltaDoMyBank({ ...solta, transaction_type: null }), false);
  const { transaction_type: _tipo, ...semTipo } = solta;
  assert.equal(ehEntradaSoltaDoMyBank(semTipo), false);

  // 2. A CHAVE CANONICA, no COMECO da string. As TRES ausencias respondem nao, e
  //    uma nota que apenas CITA `mybank:` no meio de uma frase nao e o elo.
  assert.equal(ehEntradaSoltaDoMyBank({ ...solta, notes: null }), false);
  assert.equal(ehEntradaSoltaDoMyBank({ ...solta, notes: undefined }), false);
  const { notes: _notas, ...semNota } = solta;
  assert.equal(ehEntradaSoltaDoMyBank(semNota), false);
  assert.equal(
    ehEntradaSoltaDoMyBank({ ...solta, notes: "paguei fora do mybank: dinheiro" }),
    false
  );
  // A chave de OUTRA feature nao casa: `fatura:` tem prefixo proprio.
  assert.equal(
    ehEntradaSoltaDoMyBank({ ...solta, notes: "fatura:2026-11-01:cartao" }),
    false
  );

  // 3. O ELO DO 015 NULO -- o criterio que separa o Caso B do Caso A. E elo e
  //    TEXTO: `""` e `"   "` nao sao elo, e tratar um deles como elo tiraria a
  //    perna solta da tela de novo.
  assert.equal(ehEntradaSoltaDoMyBank({ ...solta, counterpart_transaction_id: "x" }), false);
  assert.equal(ehEntradaSoltaDoMyBank({ ...solta, counterpart_transaction_id: "" }), true);
  assert.equal(ehEntradaSoltaDoMyBank({ ...solta, counterpart_transaction_id: "   " }), true);
  const { counterpart_transaction_id: _elo, ...semElo } = solta;
  assert.equal(ehEntradaSoltaDoMyBank(semElo), true);

  // 4. O SINAL POSITIVO. Ela responde sobre a linha que `ehPernaDeEntrada`
  //    tirou, e so sobre ela: a negativa nunca foi descartada, e um par de ZERO
  //    sem elo continua inteiro na aba (a decisao do zero da armadilha 3).
  assert.equal(ehEntradaSoltaDoMyBank({ ...solta, amount: -100 }), false);
  assert.equal(ehEntradaSoltaDoMyBank({ ...solta, amount: 0 }), false);
  assert.equal(ehEntradaSoltaDoMyBank({ ...solta, amount: "100.00" }), true);
});

test("a excecao do MyBank nao afrouxa a de-duplicacao de um Pix comum", () => {
  // O par sem nota nenhuma -- o caso da armadilha 3 -- continua contando uma
  // vez. A assercao existe porque a excecao mora na MESMA linha do `continue`:
  // um `||` onde ha `&&` desarmaria a de-duplicacao inteira.
  const linhas = daTela(
    [
      realizada({ id: "a", amount: -500, transaction_type: "transfer" }),
      realizada({ id: "b", amount: 500, transaction_type: "transfer" }),
    ],
    [],
    "transfer"
  );

  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].id, "a");
});

// -----------------------------------------------------
// ARMADILHA 8: a parcela PAGA do Caso A saia de Despesas (HMO-385)
// -----------------------------------------------------
// O caso medido em PRODUCAO pela prova da HMO-382 (2026-10-11, conta de teste,
// sessao real): `SONDA HMO382 moto eletrica (1/24)`, R$ 10,00, lida em
// `GET /api/movimentacoes/resumo` nas duas abas, antes e depois da baixa.
//
//   | momento             | Despesas              | Transferencias          |
//   | previsao pendente   | aparece, "mybank"     | aparece, "mybank"       |
//   | depois da baixa     | NAO APARECE           | aparece, "despesa"      |
//   | depois do estorno   | aparece, "mybank"     | aparece, "mybank"       |
//
// A baixa grava o par (`pernasDaTransferencia`, HMO-382) com a MESMA nota
// `mybank:` nas duas pernas e o elo do 015 na de entrada. A de saida e
// `transfer` na coluna, entao o filtro de tipo a tirava de Despesas.
//
// DESDE A FASE 5 (RN021.4) ESSE E O COMPORTAMENTO CERTO: a aba Despesas e a
// metade de Despesas do Resultado do mes, e o emprestimo a si mesmo e
// transferencia nos dois lados. O que a HMO-385 consertou e continua valendo e
// o SELO em Transferencias.

/** O par que a baixa do Caso A grava, como em prod. Nota igual nas DUAS. */
const NOTA_DA_PARCELA_PAGA = `${PREFIXO_DO_ELO_DO_MYBANK}parcela-1-de-24`;
const SAIDA_DA_PARCELA_PAGA = {
  id: "saida-paga",
  description: "SONDA HMO382 moto eletrica (1/24)",
  amount: -10,
  transaction_type: "transfer",
  counterpart_transaction_id: null,
  notes: NOTA_DA_PARCELA_PAGA,
  account: { id: "cc", name: "Conta Corrente" },
};
const ENTRADA_DA_PARCELA_PAGA = {
  id: "entrada-paga",
  description: "SONDA HMO382 moto eletrica (1/24)",
  amount: 10,
  transaction_type: "transfer",
  counterpart_transaction_id: "saida-paga",
  notes: NOTA_DA_PARCELA_PAGA,
  account: { id: "inv", name: "Investimentos" },
};
const PAR_DA_PARCELA_PAGA = [
  realizada(SAIDA_DA_PARCELA_PAGA),
  realizada(ENTRADA_DA_PARCELA_PAGA),
];

test("a parcela PAGA do Caso A NAO entra na aba Despesas -- o emprestimo a si mesmo e transferencia (RN021.4)", () => {
  const mercado = realizada({
    id: "mercado",
    description: "Mercado",
    amount: -30,
    transaction_type: "expense",
  });
  const linhas = daTela([...PAR_DA_PARCELA_PAGA, mercado], [], "expense");

  // CONTROLE: a aba nao esta vazia por outro motivo -- a despesa comum do lado
  // continua nela.
  assert.equal(linhas.length, 1, "so o mercado: nenhuma das duas pernas da parcela");
  assert.equal(linhas[0].id, "mercado");
  assert.equal(resumoDaTela(linhas).realizado, 30);

  // CONTROLE: o par e valido, e esta em Transferencias.
  assert.equal(daTela(PAR_DA_PARCELA_PAGA, [], "transfer").length, 1);
});

test("o selo vale em Transferencias: a perna paga e «MyBank»", () => {
  const emTransferencias = daTela(PAR_DA_PARCELA_PAGA, [], "transfer");

  // A de-duplicacao da armadilha 3 continua: a de entrada sai, a de saida fica.
  assert.equal(emTransferencias.length, 1);
  assert.equal(emTransferencias[0].id, "saida-paga");
  assert.equal(resumoDaTela(emTransferencias).realizado, 10);
  // A SEGUNDA METADE DO DEFEITO DA HMO-385: em producao esta linha vinha
  // `natureza: "despesa"` depois da baixa, e a MESMA serie se apresentava como
  // «MyBank» nas 23 parcelas pendentes.
  assert.equal(emTransferencias[0].natureza, "mybank");
  assert.equal(emTransferencias[0].tipo, "transfer");

  // CONTROLE: o MESMO par sem a chave canonica nao leva o selo.
  const semAChave = daTela(
    [
      realizada({ ...SAIDA_DA_PARCELA_PAGA, notes: null }),
      realizada({ ...ENTRADA_DA_PARCELA_PAGA, notes: null }),
    ],
    [],
    "transfer"
  );
  assert.equal(semAChave.length, 1);
  assert.equal(semAChave[0].natureza, "despesa");
});

test("a parcela paga NAO vaza para Receitas -- a perna de entrada nao e receita nova", () => {
  // O principal voltando para a conta de investimento nao e receita
  // (`PARCELA_FORA_DO_REALIZADO`), e a perna positiva e de-duplicada.
  const emReceitas = daTela(PAR_DA_PARCELA_PAGA, [], "income");

  assert.equal(emReceitas.length, 0);
  assert.equal(resumoDaTela(emReceitas).realizado, 0);
});

test("no mes da baixa a parcela conta UMA vez em Transferencias: a previsao `paid` nao soma junto", () => {
  // A rota NAO filtra `status` no SQL de proposito, entao a previsao PAGA chega
  // aqui junto com as duas pernas que a baixa gravou -- e e `linhaPrevista`
  // quem a descarta (`paid` esta em `STATUS_QUE_SAI_DO_PREVISTO`), ANTES de
  // `ehParcelaDoAutoEmprestimo` ser consultada.
  const previsaoPaga = prevista({
    id: "s-mybank",
    description: "SONDA HMO382 moto eletrica (1/24)",
    amount: "10.00",
    direction: "transfer",
    notes: NOTA_DA_PARCELA_PAGA,
    my_status: "paid",
    my_effective_status: "paid",
  });

  const linhas = daTela(PAR_DA_PARCELA_PAGA, [previsaoPaga], "transfer");

  // CONTROLE POSITIVO: a MESMA previsao `pending` entra. Sem ele este teste
  // passaria vacuo se a previsao nunca chegasse a ser considerada
  // (`sonda-de-horizonte-vence-fora-da-janela-e-mede-zero`).
  const pendente = daTela(
    PAR_DA_PARCELA_PAGA,
    [{ ...previsaoPaga, my_status: "pending", my_effective_status: "pending" }],
    "transfer"
  );
  assert.equal(pendente.length, 2, "pendente, a previsao entra -- o controle");
  assert.equal(resumoDaTela(pendente).previsto, 10);

  // E PAGA, ELA NAO ENTRA: uma linha so, a realizada, e o previsto e ZERO.
  assert.equal(linhas.length, 1, "a parcela paga nao conta duas vezes");
  assert.equal(linhas[0].origem, "realizado");
  assert.equal(resumoDaTela(linhas).previsto, 0);
  assert.equal(resumoDaTela(linhas).realizado, 10);
  assert.equal(resumoDaTela(linhas).total, 10);

  // E EM DESPESAS NENHUMA DAS DUAS (RN021.4).
  assert.equal(daTela(PAR_DA_PARCELA_PAGA, [previsaoPaga], "expense").length, 0);
});

test("ehSaidaDaParcelaDoAutoEmprestimo: os TRES criterios, um a um", () => {
  const saida = {
    amount: -10,
    transaction_type: "transfer",
    notes: NOTA_DA_PARCELA_PAGA,
    counterpart_transaction_id: null,
  };

  assert.equal(ehSaidaDaParcelaDoAutoEmprestimo(saida), true);

  // 1. O `transaction_type` GRAVADO. Sem ele uma compra no cartao com a chave
  //    ganharia o selo, e a leitura e da coluna CRUA: pelo SINAL esta linha e
  //    uma despesa comum.
  assert.equal(
    ehSaidaDaParcelaDoAutoEmprestimo({ ...saida, transaction_type: "expense" }),
    false
  );
  assert.equal(
    ehSaidaDaParcelaDoAutoEmprestimo({ ...saida, transaction_type: null }),
    false
  );
  const { transaction_type: _tipo, ...semTipo } = saida;
  assert.equal(ehSaidaDaParcelaDoAutoEmprestimo(semTipo), false);

  // 2. A CHAVE CANONICA, no COMECO da string -- o mesmo criterio dos outros tres
  //    consultores do MyBank, pelo `temOEloDaParcelaDoMyBank` que todos chamam.
  assert.equal(ehSaidaDaParcelaDoAutoEmprestimo({ ...saida, notes: null }), false);
  assert.equal(ehSaidaDaParcelaDoAutoEmprestimo({ ...saida, notes: undefined }), false);
  const { notes: _notas, ...semNota } = saida;
  assert.equal(ehSaidaDaParcelaDoAutoEmprestimo(semNota), false);
  assert.equal(
    ehSaidaDaParcelaDoAutoEmprestimo({ ...saida, notes: "paguei fora do mybank: dinheiro" }),
    false
  );
  assert.equal(
    ehSaidaDaParcelaDoAutoEmprestimo({ ...saida, notes: "fatura:2026-11-01:cartao" }),
    false
  );

  // 3. O SINAL NEGATIVO, que e quem separa esta perna da OUTRA do mesmo par --
  //    a de entrada tem a mesma nota e o mesmo tipo. O zero nao e saida de nada
  //    (a decisao do zero da armadilha 3), e a string negativa casa porque o
  //    valor chega como texto do PostgREST.
  assert.equal(ehSaidaDaParcelaDoAutoEmprestimo({ ...saida, amount: 10 }), false);
  assert.equal(ehSaidaDaParcelaDoAutoEmprestimo({ ...saida, amount: 0 }), false);
  assert.equal(ehSaidaDaParcelaDoAutoEmprestimo({ ...saida, amount: "-10.00" }), true);

  // NAO HA CRITERIO DE ELO, e a assercao e o que impede alguem de acrescentar
  // um: a perna de saida ja nunca carrega o elo (o 015 grava so na de entrada),
  // e exigir `IS NULL` faria a parcela paga perder o selo no dia em que o elo
  // passasse a ser gravado nas duas.
  assert.equal(
    ehSaidaDaParcelaDoAutoEmprestimo({ ...saida, counterpart_transaction_id: "x" }),
    true
  );

  // E AS DUAS PERGUNTAS SAO DIFERENTES: a perna solta do Caso B (positiva, sem
  // elo) NAO e a de saida do Caso A, e vice-versa. Nenhuma das duas funcoes
  // responde pelo caso da outra -- e por isso o selo precisa das duas.
  assert.equal(ehEntradaSoltaDoMyBank(saida), false);
  assert.equal(ehSaidaDaParcelaDoAutoEmprestimo(PERNA_SOLTA_DO_MYBANK), false);
  assert.equal(ehEntradaSoltaDoMyBank(PERNA_SOLTA_DO_MYBANK), true);
});

// -----------------------------------------------------
// A PARCELA QUE EU DEVO A UMA CONEXAO -- HMO-377
// -----------------------------------------------------
// O Caso B do lado do DEVEDOR. Ela nao esta em `scheduled_transactions` (o
// credor nao pode gravar no meu nome, e a RLS recusaria): vem da view
// `mybank_due_entries`, pela rota, na forma de `parcelasDevidasNaAgenda` --
// `id: null`, `direction: 'expense'` e a chave `mybank:<id>` em `notes`.
//
// O NUMERO que esta ligacao vale esta medido na ROTA, em
// scripts/test-leituras-do-mybank.mjs (leitura 4): a aba Despesas da devedora
// ia de R$ 200,00 para R$ 1.200,00, que e o que Contas a Pagar ja dizia. Aqui
// mede-se a REGRA.

/** A parcela devida, na forma com que a rota a entrega a `linhasDaTela`. */
const parcelaDevida = (over = {}) => ({
  id: null,
  user_id: EU,
  description: "Moto elétrica",
  amount: 1000,
  due_date: "2026-10-15",
  my_status: "pending",
  my_effective_status: "pending",
  direction: "expense",
  notes: `${PREFIXO_DO_ELO_DO_MYBANK}parcela-3`,
  recurring_rule_id: null,
  group_id: null,
  ...over,
});

test("a parcela devida do MyBank entra na aba Despesas, com o selo e SEM id de banco", () => {
  const linhas = daTela([], [parcelaDevida()], "expense");

  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].valor, 1000);
  assert.equal(linhas[0].tipo, "expense");
  assert.equal(linhas[0].natureza, "mybank", "sem o selo ela se le como despesa comum");

  // A CHAVE E A NOTA, e nao um id de banco: `linhaPrevista` cai em
  // `texto(crua.notes)` quando `id` e nulo. O prefixo e o que impede qualquer
  // `href` montado com este campo de passar por um uuid de
  // `/api/scheduled-transactions`.
  assert.equal(linhas[0].gravada, false);
  assert.equal(linhas[0].id, `${PREFIXO_DO_ELO_DO_MYBANK}parcela-3`);

  // CONTROLE: a MESMA linha sem a chave canonica e uma despesa comum. Sem este
  // par, um `natureza: "mybank"` escrito em toda previsao passaria verde.
  //
  // `id: "s1"` NO CONTROLE, e nao `id: null` como no caso de cima: sem chave
  // NENHUMA (`id` e `notes` os dois nulos) `linhaPrevista` devolve `null` e a
  // linha nao existe para ser classificada -- o controle mediria a ausencia da
  // linha em vez da ausencia do selo, e passaria verde com o selo escrito em
  // toda previsao. Com o id, o que varia entre os dois e SO a chave canonica.
  const semAChave = daTela([], [parcelaDevida({ id: "s1", notes: null })], "expense");
  assert.equal(semAChave.length, 1, "a linha gravada existe sem a nota");
  assert.equal(semAChave[0].natureza, "despesa");
  assert.equal(semAChave[0].valor, 1000, "o valor nao depende do selo");
});

test("sem chave canonica E sem id de banco a parcela NAO vira linha", () => {
  // A propriedade de seguranca por tras do controle acima: `linhaPrevista`
  // exige UMA das duas chaves (`id ?? notes`) e devolve `null` sem nenhuma. Uma
  // leitura da view que perdesse `notes` no caminho nao produziria uma linha com
  // `id` vazio -- que e o estado em que um `href` montado com o campo viraria
  // `/api/scheduled-transactions//pay`.
  assert.equal(linhaPrevista(parcelaDevida({ notes: null })), null);
  assert.equal(linhaPrevista(parcelaDevida({ notes: "   " })), null);
});

test("a parcela devida NAO aparece em Transferencias nem em Receitas", () => {
  // A assimetria com o Caso A, e ela e a decisao: aquela parcela e `transfer`
  // na coluna e aparece nas DUAS abas, porque o dinheiro andou entre contas
  // MINHAS. Esta sai para a conta de outra pessoa -- "andou entre as suas
  // contas" seria falso sobre ela.
  for (const tipo of ["transfer", "income"]) {
    assert.equal(
      daTela([], [parcelaDevida()], tipo).length,
      0,
      `a parcela devida nao pertence a aba ${tipo}`
    );
  }
});

test("o Caso A e o Caso B nao se confundem -- a `direction` e o que separa", () => {
  // As duas previsoes carregam a MESMA chave `mybank:`, e sao linhas diferentes
  // de dinheiro: a de `transfer` e o auto-emprestimo (SO em Transferencias,
  // desde a fase 5), a de `expense` e o juro devido a conexao (SO em
  // Despesas). Um criterio que lesse apenas a nota daria o mesmo tratamento as
  // duas.
  const casoA = parcelaDevida({ id: "s1", direction: "transfer" });
  const casoB = parcelaDevida();

  assert.equal(ehParcelaDevidaDoMyBank(casoB), true);
  assert.equal(ehParcelaDevidaDoMyBank(casoA), false, "o Caso A nao e parcela DEVIDA");

  // E as duas levam o selo, cada uma na sua aba.
  assert.equal(daTela([], [casoA], "transfer")[0].natureza, "mybank");
  assert.equal(daTela([], [casoB], "expense")[0].natureza, "mybank");

  // A diferenca medida: cada uma so na sua aba.
  assert.equal(daTela([], [casoA], "expense").length, 0);
  assert.equal(daTela([], [casoB], "transfer").length, 0);
});

test("ehParcelaDevidaDoMyBank: os DOIS criterios, um a um", () => {
  const devida = { direction: "expense", notes: `${PREFIXO_DO_ELO_DO_MYBANK}p3` };
  assert.equal(ehParcelaDevidaDoMyBank(devida), true);

  // 1. A `direction` E `expense`. Sem este criterio, a parcela do auto-emprestimo
  //    (`transfer`) tambem casaria -- e o selo dela ja vem de outro lugar.
  assert.equal(ehParcelaDevidaDoMyBank({ ...devida, direction: "transfer" }), false);
  assert.equal(ehParcelaDevidaDoMyBank({ ...devida, direction: "income" }), false);
  assert.equal(ehParcelaDevidaDoMyBank({ ...devida, direction: null }), false);
  assert.equal(ehParcelaDevidaDoMyBank({ ...devida, direction: undefined }), false);
  assert.equal(
    ehParcelaDevidaDoMyBank({ ...devida, direction: "EXPENSE" }),
    false,
    "a coluna da view e minuscula: um casamento sem caixa aceitaria valor que a view nao produz"
  );

  // 2. A CHAVE CANONICA em `notes`, por `startsWith` e nao por `includes`:
  //    `guard-de-includes-casa-dentro-de-identificador-maior`.
  assert.equal(ehParcelaDevidaDoMyBank({ ...devida, notes: null }), false);
  assert.equal(ehParcelaDevidaDoMyBank({ ...devida, notes: undefined }), false);
  assert.equal(ehParcelaDevidaDoMyBank({ ...devida, notes: "" }), false);
  assert.equal(
    ehParcelaDevidaDoMyBank({ ...devida, notes: "paguei fora do mybank: dinheiro" }),
    false,
    "uma nota que CITA a palavra no meio da frase nao e o elo"
  );
  assert.equal(
    ehParcelaDevidaDoMyBank({ ...devida, notes: "fatura:2026-11-01:cartao" }),
    false,
    "a chave da FATURA nao e a chave do MyBank"
  );
});

// -----------------------------------------------------
// O JURO PAGO DO MYBANK -- fase 5, RN021.3
// -----------------------------------------------------
// Quem pegou nao grava transacao nenhuma quando quem emprestou confirma. A rota
// monta a linha a partir de `mybank_interest_entries` (071), na forma de
// `jurosPagosComoRealizados`: `expense`, valor negativo, a chave `mybank:<id>`.

const JURO_PAGO = {
  id: "juros-do-mybank:parcela-2",
  description: "Juros: Moto (2/24)",
  amount: -50,
  transaction_date: "2026-10-10",
  transaction_type: "expense",
  currency: "BRL",
  category: { name: "Juros do MyBank", is_expense: true },
  notes: `${PREFIXO_DO_ELO_DO_MYBANK}parcela-2`,
  selo: "MyBank",
};

test("o juro pago entra no Realizado de Despesas com o selo, e sem botao", () => {
  const linhas = daTela([JURO_PAGO], [], "expense");

  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].origem, "realizado");
  assert.equal(resumoDaTela(linhas).realizado, 50);
  // O MESMO selo do juro previsto (`ehParcelaDevidaDoMyBank`): a linha nao muda
  // de cara no dia em que e paga.
  assert.equal(linhas[0].natureza, "mybank");
  // Sem `user_id`, como a conta do fechamento: nao se edita nem se apaga.
  assert.equal(linhas[0].posso_editar, false);

  // CONTROLE: a mesma linha sem a chave e uma despesa comum.
  assert.equal(daTela([{ ...JURO_PAGO, notes: null }], [], "expense")[0].natureza, "despesa");

  // E so em Despesas.
  assert.equal(daTela([JURO_PAGO], [], "income").length, 0);
  assert.equal(daTela([JURO_PAGO], [], "transfer").length, 0);
});

test("ehJuroPagoDoMyBank: os DOIS criterios, um a um", () => {
  assert.equal(ehJuroPagoDoMyBank(JURO_PAGO), true);

  // 1. `expense`. O juro de quem EMPRESTOU tem a mesma chave e e `income`, e as
  //    pernas do principal e do Caso A sao `transfer`.
  assert.equal(ehJuroPagoDoMyBank({ ...JURO_PAGO, transaction_type: "income" }), false);
  assert.equal(ehJuroPagoDoMyBank({ ...JURO_PAGO, transaction_type: "transfer" }), false);
  assert.equal(ehJuroPagoDoMyBank({ ...JURO_PAGO, transaction_type: null }), false);

  // 2. A chave, no COMECO da string.
  assert.equal(ehJuroPagoDoMyBank({ ...JURO_PAGO, notes: null }), false);
  assert.equal(
    ehJuroPagoDoMyBank({ ...JURO_PAGO, notes: "paguei fora do mybank: dinheiro" }),
    false
  );
});

test("a parcela devida vencida sai com `overdue`, e entra no balde do vencido", () => {
  // `effective_status` chega calculado de `parcelasDevidasNaAgenda` (o mesmo
  // `CASE` da 027). O que se mede aqui e que ele ATRAVESSA `linhaPrevista` ate
  // `previstoVencido` -- a aba Despesas e onde se abre para ver o atraso.
  const linhas = daTela(
    [],
    [parcelaDevida({ my_effective_status: "overdue", due_date: "2026-09-01" })],
    "expense"
  );

  assert.equal(linhas[0].situacao, "overdue");

  const vencido = previstoVencido(linhas);
  assert.equal(vencido.total, 1000);
  assert.equal(vencido.quantidade, 1);
});

// -----------------------------------------------------
// A frase da conta
// -----------------------------------------------------
test("a conta diz o SENTIDO: 'de' na despesa, 'para' na receita, seta na transferencia", () => {
  const indice = indiceDeContraparte([]);

  assert.equal(
    linhaRealizada(
      realizada({ amount: -80, transaction_type: "expense", account: { id: "c", name: "Itaú" } }),
      indice,
      SEM_FIXAS
    ).conta,
    "de Itaú"
  );
  assert.equal(
    linhaRealizada(
      realizada({ amount: 7000, transaction_type: "income", account: { id: "c", name: "Itaú" } }),
      indice,
      SEM_FIXAS
    ).conta,
    "para Itaú"
  );
  // Sem conta a frase e APAGADA, nao preenchida com "Sem conta": um "Sem conta"
  // escrito igual a "Itaú" e um nome de conta inventado.
  assert.equal(
    linhaRealizada(realizada({ account: null }), indice, SEM_FIXAS).conta,
    null
  );
});

// -----------------------------------------------------
// As duas secoes, e a ordem de cada uma
// -----------------------------------------------------
test("previstas em ordem crescente de vencimento; realizadas, decrescente", () => {
  const linhas = daTela(
    [
      realizada({ id: "r1", amount: -10, transaction_date: "2026-10-02" }),
      realizada({ id: "r2", amount: -20, transaction_date: "2026-10-20" }),
    ],
    [
      prevista({ id: "p1", due_date: "2026-10-28" }),
      prevista({ id: "p2", due_date: "2026-10-05" }),
    ],
    "expense"
  );

  const { previstas, realizadas } = secoesDaTela(linhas);

  // "o que vem agora" e o que vence PRIMEIRO. Decrescente poria a conta do dia
  // 28 acima da que vence dia 5.
  assert.deepEqual(previstas.map((l) => l.id), ["p2", "p1"]);
  // "o que aconteceu": o ultimo lancamento primeiro.
  assert.deepEqual(realizadas.map((l) => l.id), ["r2", "r1"]);
});

test("secoesDaTela devolve arrays PROPRIOS -- `filter` ja copia", () => {
  // `Array.prototype.sort` ordena no lugar, e as duas secoes sao ordenadas em
  // sentidos OPOSTOS: se elas compartilhassem o array de `linhasDaTela`, a
  // segunda desfaria a primeira. `filter` devolve array novo, e e isso que faz
  // as duas ordens coexistirem -- a assercao e que as referencias sao outras.
  const linhas = daTela(
    [realizada({ id: "r1", amount: -10, transaction_date: "2026-10-02" })],
    [
      prevista({ id: "p1", due_date: "2026-10-28" }),
      prevista({ id: "p2", due_date: "2026-10-05" }),
    ],
    "expense"
  );
  const { previstas, realizadas } = secoesDaTela(linhas);

  assert.notEqual(previstas, linhas);
  assert.notEqual(realizadas, linhas);
  assert.notEqual(previstas, realizadas);
  assert.equal(linhas.length, 3, "nenhuma linha sumiu ou se duplicou");
  assert.equal(previstas.length + realizadas.length, linhas.length);
});

test("a lista vem em ordem de data decrescente, por STRING e nao por Date", () => {
  const linhas = daTela(
    [
      realizada({ id: "set30", amount: -10, transaction_date: "2026-09-30" }),
      realizada({ id: "out01", amount: -20, transaction_date: "2026-10-01" }),
    ],
    [],
    "expense"
  );

  assert.deepEqual(linhas.map((l) => l.id), ["out01", "set30"]);
  // E o campo guardado e a string crua, sem passar por Date em lugar nenhum.
  assert.equal(linhas[0].data, "2026-10-01");
});

test("UMA linha sem data nao pode embaralhar a ordem das outras", () => {
  // Este e o caso que separa `localeCompare` de `new Date(...)`, e ele nao e
  // teorico: `data` e "" quando a coluna vem NULL, e `new Date("").getTime()` e
  // NaN. Um NaN no comparador nao poe uma linha no lugar errado -- ele
  // EMBARALHA a lista. Medido com estas mesmas quatro linhas: por Date a ordem
  // sai ["a", "vazia", "b", "c"], com a de 20/10 ABAIXO da de 05/10.
  const linhas = daTela(
    [
      realizada({ id: "a", amount: -10, transaction_date: "2026-10-05" }),
      realizada({ id: "vazia", amount: -40, transaction_date: null }),
      realizada({ id: "b", amount: -20, transaction_date: "2026-10-20" }),
      realizada({ id: "c", amount: -30, transaction_date: "2026-09-01" }),
    ],
    [],
    "expense"
  );

  // As tres com data, na ordem certa, e a sem data no fim e sozinha.
  assert.deepEqual(linhas.map((l) => l.id), ["b", "a", "c", "vazia"]);
  // E ela CONTINUA na lista e no total: data que falta nao e linha que some.
  assert.equal(resumoDaTela(linhas).realizado, 100);
});

test("data ausente nao derruba a lista -- a linha fica, com a data vazia", () => {
  const linhas = daTela(
    [realizada({ id: "x", amount: -10, transaction_date: null })],
    [prevista({ id: "y", due_date: null })],
    "expense"
  );
  assert.equal(linhas.length, 2);
  assert.equal(linhas.find((l) => l.id === "x").data, "");
  assert.equal(linhas.find((l) => l.id === "y").data, "");
});

// -----------------------------------------------------
// Os tres numeros
// -----------------------------------------------------
test("total e previsto + realizado, e as contagens batem com a lista", () => {
  const linhas = daTela(
    [
      realizada({ id: "r1", amount: -100.01 }),
      realizada({ id: "r2", amount: -200.02 }),
    ],
    [prevista({ id: "p1", amount: "300.03" })],
    "expense"
  );

  const r = resumoDaTela(linhas);

  assert.equal(r.realizado, 300.03);
  assert.equal(r.previsto, 300.03);
  assert.equal(r.total, 600.06);
  // O total NAO pode ser uma terceira varredura: tem que ser exatamente a soma
  // dos dois que a tela mostra, ou os numeros discordam entre si na mesma tela.
  assert.equal(r.total, r.previsto + r.realizado);

  assert.equal(r.quantidadeRealizada, 2);
  assert.equal(r.quantidadePrevista, 1);
  assert.equal(r.quantidade, 3);
  assert.equal(r.quantidade, linhas.length);
});

test("periodo vazio da zero em tudo, sem NaN", () => {
  const r = resumoDaTela([]);
  assert.deepEqual(r, {
    previsto: 0,
    realizado: 0,
    total: 0,
    quantidadePrevista: 0,
    quantidadeRealizada: 0,
    quantidade: 0,
  });
  assert.deepEqual(previstoVencido([]), { total: 0, quantidade: 0 });
});

test("centavos nao acumulam ruido de ponto flutuante", () => {
  // 0,1 + 0,2 e 0,30000000000000004 em IEEE 754, e "R$ 0,30" formatado
  // esconderia isso ate alguem comparar dois totais.
  const linhas = daTela(
    [realizada({ id: "a", amount: -0.1 }), realizada({ id: "b", amount: -0.2 })],
    [],
    "expense"
  );
  assert.equal(resumoDaTela(linhas).realizado, 0.3);
});

// -----------------------------------------------------
// O catalogo das tres telas
// -----------------------------------------------------
test("telaDoTipo aceita os tres e recusa qualquer outra coisa", () => {
  assert.equal(telaDoTipo("income").rota, "/dashboard/receitas");
  assert.equal(telaDoTipo("expense").rota, "/dashboard/despesas");
  assert.equal(telaDoTipo("transfer").rota, "/dashboard/transferencias");

  // A recusa e o que faz a rota responder 400 em vez de numeros de despesa a
  // quem pediu outra coisa.
  for (const errado of ["despeza", "despesa", "INCOME", "", null, undefined, "todos"]) {
    assert.equal(telaDoTipo(errado), null, `${String(errado)} nao pode virar tela`);
  }
});

test("o catalogo tem as tres telas, cada uma com rota e rotulos proprios", () => {
  assert.equal(TELAS_DE_MOVIMENTACAO.length, 3);
  assert.deepEqual(
    TELAS_DE_MOVIMENTACAO.map((t) => t.tipo),
    ["income", "expense", "transfer"]
  );
  const rotas = new Set(TELAS_DE_MOVIMENTACAO.map((t) => t.rota));
  assert.equal(rotas.size, 3, "duas telas com a mesma rota viram a mesma tela");
  for (const t of TELAS_DE_MOVIMENTACAO) {
    // Rotulo vazio viraria cartao sem legenda, e a legenda e o que separa este
    // "Total" do cartao de Financas Pessoais.
    assert.ok(t.titulo.length > 0, `${t.tipo} sem titulo`);
    assert.ok(t.oQueOPrevistoE.length > 0, `${t.tipo} sem legenda de previsto`);
    assert.ok(t.oQueORealizadoE.length > 0, `${t.tipo} sem legenda de realizado`);
  }
});

// -----------------------------------------------------
// O caso completo de um mes, com as tres telas lendo as MESMAS linhas
// -----------------------------------------------------
test("um mes inteiro: as tres telas somam cada uma o seu, sem sobreposicao", () => {
  const todasAsRealizadas = [
    realizada({ id: "salario", amount: 7000, transaction_type: "income" }),
    realizada({ id: "aluguel", amount: -2500, transaction_type: "expense" }),
    realizada({ id: "mercado", amount: -430.2, transaction_type: "expense" }),
    realizada({ id: "pix-saida", amount: -1000, transaction_type: "transfer" }),
    realizada({
      id: "pix-entrada",
      amount: 1000,
      transaction_type: "transfer",
      counterpart_transaction_id: "pix-saida",
    }),
  ];

  const todasAsPrevistas = [
    prevista({ id: "internet", amount: "159.90", direction: "expense" }),
    prevista({ id: "freela", amount: "1200.00", direction: "income" }),
    prevista({ id: "ja-paga", amount: "80.00", direction: "expense", my_status: "paid" }),
  ];

  const receitas = resumoDaTela(daTela(todasAsRealizadas, todasAsPrevistas, "income"));
  const despesas = resumoDaTela(daTela(todasAsRealizadas, todasAsPrevistas, "expense"));
  const transf = resumoDaTela(daTela(todasAsRealizadas, todasAsPrevistas, "transfer"));

  assert.deepEqual(
    { total: receitas.total, previsto: receitas.previsto, realizado: receitas.realizado },
    { total: 8200, previsto: 1200, realizado: 7000 }
  );
  assert.deepEqual(
    { total: despesas.total, previsto: despesas.previsto, realizado: despesas.realizado },
    { total: 3090.1, previsto: 159.9, realizado: 2930.2 }
  );
  assert.deepEqual(
    { total: transf.total, previsto: transf.previsto, realizado: transf.realizado },
    { total: 1000, previsto: 0, realizado: 1000 }
  );

  // NENHUMA linha em duas telas, e nenhuma linha perdida: as tres contagens
  // somam as linhas que entram, e a conta paga + a perna de entrada sao
  // exatamente as duas que ficam fora.
  const contadas = receitas.quantidade + despesas.quantidade + transf.quantidade;
  assert.equal(contadas, todasAsRealizadas.length + todasAsPrevistas.length - 2);
});

// -----------------------------------------------------
// `posso_editar`: QUEM PODE MEXER NA LINHA (HMO-301)
// -----------------------------------------------------
// O campo e o que decide se os botoes de Editar / Excluir / Confirmar aparecem
// (`lib/acoes-da-linha.ts`). Ele FALHA FECHADO em todos os caminhos de duvida, e
// cada bloco abaixo mede um deles -- porque os tres erros do lado oposto erram
// na direcao CARA: o botao aparece, a RLS recusa a escrita, e `UPDATE` recusado
// pela RLS volta **200 sem alterar nada**. O app diz "pronto" e a linha fica.

test("a linha com o MEU user_id e editavel, nos dois lados", () => {
  const linhas = daTela(
    [realizada({ id: "t1" })],
    [prevista({ id: "s1" })],
    "expense"
  );

  assert.equal(linhas.length, 2, "o caso base precisa das duas linhas");
  for (const linha of linhas) {
    assert.equal(linha.posso_editar, true, `${linha.origem} nao ficou editavel`);
  }
});

test("a linha de OUTRO user_id NAO e editavel -- nem prevista nem realizada", () => {
  // Este e o caso que o campo existe para cobrir: a policy do 005 traz as
  // linhas de grupo dos outros membros junto com as minhas.
  const OUTRO = "99999999-8888-4777-b666-555544443333";

  const linhas = daTela(
    [realizada({ id: "t1", user_id: OUTRO })],
    [prevista({ id: "s1", user_id: OUTRO })],
    "expense"
  );

  assert.equal(linhas.length, 2, "a linha alheia tem de CONTINUAR na lista");
  for (const linha of linhas) {
    assert.equal(
      linha.posso_editar,
      false,
      `${linha.origem} de outro membro ficou editavel`
    );
  }
});

test("a linha alheia continua SOMANDO -- `posso_editar` nao e um filtro", () => {
  // A distincao importa: tirar a linha da lista mudaria os tres numeros da tela,
  // e o total menor e plausivel. O campo decide BOTAO, nao soma.
  const OUTRO = "99999999-8888-4777-b666-555544443333";

  const minhas = resumoDaTela(
    daTela([realizada({ amount: -100 })], [prevista({ amount: "50.00" })], "expense")
  );
  const alheias = resumoDaTela(
    daTela(
      [realizada({ amount: -100, user_id: OUTRO })],
      [prevista({ amount: "50.00", user_id: OUTRO })],
      "expense"
    )
  );

  assert.equal(minhas.total, 150);
  assert.deepEqual(alheias, minhas);
});

test("`user_id` ausente no dado NAO e editavel -- a rota que esqueceu o select", () => {
  // O caminho exato do `select` sem a coluna. Um `===` entre dois `undefined`
  // seria VERDADE e liberaria TODA linha de TODO mundo.
  for (const vazio of [undefined, null, ""]) {
    const linhas = daTela(
      [realizada({ user_id: vazio })],
      [prevista({ user_id: vazio })],
      "expense"
    );
    assert.equal(linhas.length, 2);
    for (const linha of linhas) {
      assert.equal(
        linha.posso_editar,
        false,
        `user_id ${JSON.stringify(vazio)} em ${linha.origem} ficou editavel`
      );
    }
  }
});

test("SEM saber quem esta olhando, nada e editavel", () => {
  // A rota que parou de passar `user.id`. `undefined === undefined` seria
  // verdade contra uma linha que tambem perdeu o campo; as duas guardas de tipo
  // em `ehMinha` e que impedem isso.
  for (const ninguem of [undefined, null, ""]) {
    // `linhasDaTela` CRU e nao `daTela`: o parametro com default daquele
    // atalho dispara com `undefined` (e so com ele), devolveria `EU` de volta,
    // e este bloco mediria exatamente o caso oposto do que afirma medir --
    // verde, e sem nunca ter chamado a lib sem o id.
    const linhas = linhasDaTela(
      [realizada()],
      [prevista()],
      "expense",
      SEM_FIXAS,
      ninguem
    );
    assert.equal(linhas.length, 2);
    for (const linha of linhas) {
      assert.equal(
        linha.posso_editar,
        false,
        `sem meuUserId (${JSON.stringify(ninguem)}), ${linha.origem} ficou editavel`
      );
    }
  }
});

test("a comparacao e por VALOR e sensivel a caixa -- nao e `==` nem prefixo", () => {
  // Tres vizinhos do id certo, os tres recusados. `==` aprovaria o caso de
  // `undefined`/`null` acima; um `startsWith` aprovaria o prefixo.
  for (const parecido of [EU.toUpperCase(), EU.slice(0, -1), `${EU}0`, ` ${EU}`]) {
    const [linha] = daTela([realizada({ user_id: parecido })], [], "expense");
    assert.equal(
      linha.posso_editar,
      false,
      `user_id "${parecido}" passou por igual a "${EU}"`
    );
  }
});

test("a fatura aberta sintetizada nao e editavel -- ela nao tem user_id nenhum", () => {
  // Ela e calculada de `card_invoice_lines` a cada leitura (HMO-227): nao existe
  // em tabela, nao tem `user_id` e nao tem `scheduled_transactions.id`. Os DOIS
  // campos a recusam, e nenhum dos dois e redundante -- a fatura FECHADA e uma
  // `scheduled_transaction` de verdade, com os dois preenchidos.
  const [aberta] = daTela(
    [],
    [
      {
        ...prevista(),
        id: null,
        user_id: undefined,
        notes: "fatura:2026-10-01:33333333-3333-3333-3333-333333333333",
      },
    ],
    "expense"
  );

  assert.ok(aberta, "a fatura aberta tem de continuar na lista");
  assert.equal(aberta.gravada, false);
  assert.equal(aberta.posso_editar, false);

  const [fechada] = daTela(
    [],
    [
      prevista({
        id: "s-fatura",
        notes: "fatura:2026-10-01:33333333-3333-3333-3333-333333333333",
      }),
    ],
    "expense"
  );

  assert.equal(fechada.gravada, true);
  assert.equal(fechada.posso_editar, true, "a fatura FECHADA e minha e gravada");
});

test("`posso_editar` nao depende do TIPO da tela -- as tres o produzem", () => {
  // A tela de Transferencias le as MESMAS linhas previstas (a transferencia
  // recorrente da 038 chega com `direction: "transfer"`). Um campo calculado so
  // no caminho da despesa deixaria duas telas sem botao nenhum.
  for (const tipo of ["income", "expense", "transfer"]) {
    const linhas = daTela(
      [],
      [prevista({ id: `s-${tipo}`, direction: tipo })],
      tipo
    );
    assert.equal(linhas.length, 1, `nenhuma linha na tela ${tipo}`);
    assert.equal(linhas[0].posso_editar, true, `tela ${tipo} sem posso_editar`);
  }
});

test("os DOIS lados ausentes nao se igualam -- o caso que as guardas existem para pegar", () => {
  // ESTE e o bloco que mede as guardas de tipo de `ehMinha`, e nenhum dos
  // anteriores o alcanca: eles variam UM dos dois lados e deixam o outro
  // valido, e aí `daLinha === meuUserId` ja devolve `false` sozinho. Medido: com
  // as duas guardas removidas, os sete blocos acima continuam VERDES.
  //
  // O estado perigoso e a COINCIDENCIA de duas ausencias -- a rota que esqueceu
  // `user_id` no `select` E parou de passar `user.id` (uma refatoracao faz as
  // duas de uma vez). `undefined === undefined` e `"" === ""` sao os dois
  // VERDADE, e aí TODA linha de TODO mundo ganharia os tres botoes.
  for (const ausencia of [undefined, null, ""]) {
    const linhas = linhasDaTela(
      [realizada({ user_id: ausencia })],
      [prevista({ user_id: ausencia })],
      "expense",
      SEM_FIXAS,
      ausencia
    );

    assert.equal(linhas.length, 2, "as duas linhas tem de continuar na lista");
    for (const linha of linhas) {
      assert.equal(
        linha.posso_editar,
        false,
        `com os dois lados ${JSON.stringify(ausencia)}, ${linha.origem} ficou editavel`
      );
    }
  }

  // E o cruzado: linha vazia contra id valido, e vice-versa, nas duas ordens.
  // `"" === ""` e o unico par de strings que `typeof` sozinho nao recusaria.
  assert.equal(
    linhasDaTela([realizada({ user_id: "" })], [], "expense", SEM_FIXAS, "")[0]
      .posso_editar,
    false,
    'user_id "" contra meuUserId "" ficou editavel'
  );
});

// ---------------------------------------------------------------------------
// resumoComReembolsoPrevisto -- O REEMBOLSO DO GRUPO NO «Previsto» (HMO-364)
// ---------------------------------------------------------------------------
// A fase F3 da HMO-360. A aritmetica e uma soma, e e justamente por isso que
// ela mora numa funcao: os jeitos errados de escrever esta soma nao dao erro
// nenhum. Somar no `realizado` publica como recebido um dinheiro que ninguem
// pagou; nao somar no `total` faz o cartao «Total» discordar da soma dos dois
// cartoes ao lado dele; somar em TODA tela abate uma promessa da conta a pagar.
// Os tres compilam e os tres produzem numeros plausiveis.
//
// O CONTROLE DE CADA BLOCO E O RESUMO DE PARTIDA, afirmado campo a campo: sem
// ele "previsto = 1300" passaria verde numa funcao que IGNORA o resumo e
// devolve o reembolso.

/** Um resumo de partida com os seis campos diferentes entre si. */
const RESUMO_BASE = {
  previsto: 1000,
  realizado: 250,
  total: 1250,
  quantidadePrevista: 3,
  quantidadeRealizada: 2,
  quantidade: 5,
};

/** O reembolso de tres devedores em dois grupos. */
const REEMBOLSO = { total: 300, quantos: 3, grupos: 2 };

test("em Receitas o reembolso entra no previsto e no total, e SO neles", () => {
  const com = resumoComReembolsoPrevisto(RESUMO_BASE, "income", REEMBOLSO);

  // AS DUAS PARCELAS EM ASSERCOES SEPARADAS. O par previsto/realizado nao se
  // anula aqui, mas a familia e a mesma de `duas-pernas-mantem-o-total-certo`:
  // afirmar so o `total` deixaria passar a soma feita no balde errado, porque
  // `total` sobe 300 nos dois casos.
  assert.equal(com.previsto, 1300, "o previsto tem de somar o reembolso");
  assert.equal(
    com.realizado,
    250,
    "o realizado NAO pode mudar -- o credito e sobre conta que ninguem pagou"
  );
  assert.equal(com.total, 1550, "o total e previsto + realizado, e sobe junto");

  // AS CONTAGENS NAO SOBEM: o reembolso nao e linha da lista. "N lançamento(s)"
  // prometeria uma linha que a lista nao tem.
  assert.equal(com.quantidadePrevista, 3);
  assert.equal(com.quantidadeRealizada, 2);
  assert.equal(com.quantidade, 5);

  // E ele vai dito em separado, ou o numero sobe sem rotulo (fase F5).
  assert.deepEqual(com.reembolso_previsto, REEMBOLSO);
});

test("em Despesas e em Transferencias o reembolso nao toca em numero nenhum", () => {
  for (const tipo of ["expense", "transfer"]) {
    const com = resumoComReembolsoPrevisto(RESUMO_BASE, tipo, REEMBOLSO);

    // O CONTROLE DESTE BLOCO: os seis campos iguais aos de partida. "o previsto
    // nao e 1300" passaria verde numa funcao que devolvesse `{}`.
    for (const campo of Object.keys(RESUMO_BASE)) {
      assert.equal(
        com[campo],
        RESUMO_BASE[campo],
        `${tipo}: ${campo} mudou -- em Despesas o reembolso seria um abatimento ` +
          `da conta a pagar, que e o criterio do safe-to-spend e nao desta tela`
      );
    }

    assert.equal(
      com.reembolso_previsto,
      null,
      `${tipo}: o campo tem de vir null, senao a tela desenha a frase do reembolso`
    );
  }
});

test("sem reembolso o resumo passa intacto, e o campo e null e nao zero", () => {
  // `null` e nao `{ total: 0, ... }`: "R$ 0,00 de reembolso previsto" na tela de
  // quem nao participa de grupo nenhum e ruido que parece recurso quebrado.
  for (const vazio of [null, undefined, { total: 0, quantos: 0, grupos: 0 }]) {
    const com = resumoComReembolsoPrevisto(RESUMO_BASE, "income", vazio);

    for (const campo of Object.keys(RESUMO_BASE)) {
      assert.equal(com[campo], RESUMO_BASE[campo], `${campo} mudou com ${vazio}`);
    }
    assert.equal(com.reembolso_previsto, null);
  }
});

test("reembolso negativo nao derruba a receita prevista", () => {
  // `creditoAReceber` nao devolve negativo hoje (`creditoSemDevedorCents` prende
  // no zero), entao esta entrada e out-of-contract e o teste dela e sintetico
  // por construcao. A guarda existe porque o defeito e MUDO: somar -300 aqui
  // derrubaria o «Previsto» de Receitas em 300 e a tela apresentaria isso como
  // credito A RECEBER -- o numero certo com o sinal invertido, que e a familia
  // de `previsto-e-realizado-tem-sinais-opostos`.
  const com = resumoComReembolsoPrevisto(RESUMO_BASE, "income", {
    total: -300,
    quantos: 1,
    grupos: 1,
  });

  assert.equal(com.previsto, 1000, "o previsto nao pode CAIR por reembolso");
  assert.equal(com.total, 1250);
  assert.equal(com.reembolso_previsto, null);
});

test("o resumo de partida nao e mutado -- a funcao devolve objeto novo", () => {
  // `resumoDaTela` devolve o objeto que a rota tambem usa; mutar no lugar faria
  // um efeito a distancia que nao aparece em nenhuma das duas funcoes.
  const partida = { ...RESUMO_BASE };
  const com = resumoComReembolsoPrevisto(partida, "income", REEMBOLSO);

  assert.equal(partida.previsto, 1000, "a funcao mutou o argumento");
  assert.notEqual(com, partida);
});

test("o reembolso soma em centavos inteiros, sem residuo de ponto flutuante", () => {
  // 0.1 + 0.2 = 0.30000000000000004. `centavos` existe para o cartao nao
  // mostrar isso, e o mutante que o remove tem de morrer aqui.
  const com = resumoComReembolsoPrevisto(
    { ...RESUMO_BASE, previsto: 0.1, realizado: 0, total: 0.1 },
    "income",
    { total: 0.2, quantos: 1, grupos: 1 }
  );

  assert.equal(com.previsto, 0.3);
  assert.equal(com.total, 0.3);
});

// ---------------------------------------------------------------------------
// previstoSemLinha -- QUANTO DO «Previsto» NAO TEM LINHA (HMO-379)
// ---------------------------------------------------------------------------
// O defeito que esta funcao existe para consertar foi medido em producao: o
// cartao «Previsto» em R$ 30,00 e, na mesma dobra, o bloco "Previsto no período
// (0)" dizendo "Nada previsto neste período.". As duas promessas que o cartao
// soma nascem fora de `scheduled_transactions` e nenhuma delas vira linha, e a
// frase de vazio nao tinha como saber disso.
//
// ELA DEVOLVE DINHEIRO E NAO BOOLEANO porque a frase diz o VALOR. Um booleano
// faria a tela escrever "ha algo previsto sem linha", que e mais vago do que o
// numero que a pessoa esta olhando.

/** O resumo da tela, com as duas promessas vazias. */
const SEM_PROMESSA = {
  ...RESUMO_BASE,
  reembolso_previsto: null,
  a_receber_do_mybank: null,
};

test("sem promessa nenhuma o previsto-sem-linha e ZERO", () => {
  // O CONTROLE NEGATIVO da issue: a conta vazia tem de continuar lendo
  // "Nada previsto neste período.", e quem decide isso e o zero daqui.
  assert.equal(previstoSemLinha(SEM_PROMESSA), 0);

  // `null` e o resumo que nao veio (leitura falhada, ou resposta do aparelho de
  // antes da feature). Ele NAO pode virar frase nova: sem resumo a tela ja tem
  // a frase "Não dá para conferir o previsto agora.".
  assert.equal(previstoSemLinha(null), 0);
});

test("cada promessa entra sozinha, e as duas somam", () => {
  // OS TRES CASOS SEPARADOS, com valores DIFERENTES (300 e 30): com os dois
  // iguais, uma funcao que lesse o mesmo campo duas vezes passaria verde.
  assert.equal(
    previstoSemLinha({ ...SEM_PROMESSA, reembolso_previsto: REEMBOLSO }),
    300,
    "o reembolso de grupo sozinho -- o defeito da HMO-364 tinha a MESMA forma"
  );
  assert.equal(
    previstoSemLinha({
      ...SEM_PROMESSA,
      a_receber_do_mybank: { total: 30, parcelas: 1, devedores: 1, emprestimos: 1 },
    }),
    30,
    "o «a receber» do MyBank sozinho -- o caso medido em prod na HMO-379"
  );
  assert.equal(
    previstoSemLinha({
      ...SEM_PROMESSA,
      reembolso_previsto: REEMBOLSO,
      a_receber_do_mybank: { total: 30, parcelas: 1, devedores: 1, emprestimos: 1 },
    }),
    330,
    "quem tem grupo E MyBank tem as DUAS fora da lista, e a frase diz a soma"
  );
});

test("o previsto-sem-linha IGNORA o previsto que TEM linha", () => {
  // A assercao que separa esta funcao de `resumo.previsto`. O `RESUMO_BASE` tem
  // `previsto: 1000` de linhas gravadas de verdade; devolver 1000 (ou 1300)
  // faria a frase afirmar que TODO o previsto e promessa sem linha -- e ela
  // apareceria em toda tela que tem previsao normal, que e pior que o defeito
  // original.
  assert.equal(previstoSemLinha({ ...SEM_PROMESSA, previsto: 1000 }), 0);
  assert.equal(
    previstoSemLinha({ ...SEM_PROMESSA, reembolso_previsto: REEMBOLSO }),
    300,
    "com previsto=1000 e reembolso=300, o que nao tem linha sao os 300"
  );
});

test("o previsto-sem-linha soma em centavos inteiros", () => {
  // Mesma razao do bloco do reembolso: 0.1 + 0.2 = 0.30000000000000004, e este
  // numero vai DIRETO para uma frase que a pessoa le.
  assert.equal(
    previstoSemLinha({
      ...SEM_PROMESSA,
      reembolso_previsto: { total: 0.1, quantos: 1, grupos: 1 },
      a_receber_do_mybank: { total: 0.2, parcelas: 1, devedores: 1, emprestimos: 1 },
    }),
    0.3
  );
});

test("a resposta ANTIGA do aparelho, sem as duas chaves, nao quebra", () => {
  // Uma copia guardada de antes da HMO-364/372 nao tem `reembolso_previsto` nem
  // `a_receber_do_mybank`. `?? 0` e o que faz isso ser zero em vez de `NaN` --
  // e `NaN > 0` e falso, entao o sintoma nao seria um erro: seria a frase certa
  // por acidente, ate alguem "simplificar" a comparacao.
  assert.equal(previstoSemLinha({ ...RESUMO_BASE }), 0);
});

// ---------------------------------------------------------------------------
// O LANCAMENTO FORA DOS TOTAIS NOS TRES NUMEROS (HMO-453, F3 da HMO-443)
// ---------------------------------------------------------------------------
// `resumoDaTela` tem aritmetica propria sobre `LinhaDaTela` -- ela nao le view
// nenhuma e nao herda o `WHERE` que a 060 pos em `category_monthly_totals`.
//
// A ASSIMETRIA QUE ESTES BLOCOS PRENDEM: o dinheiro sai, a CONTAGEM fica.
// `previsto`, `realizado` e `total` perdem a linha marcada; `quantidade`,
// `quantidadePrevista` e `quantidadeRealizada` continuam contando, porque elas
// descrevem a LISTA -- e a linha marcada continua na lista, com selo (decisao
// C). O rodape do cartao Total diz "previsto + realizado · N lançamento(s)", e
// um N ao lado de uma lista com N+1 linhas e contradicao visivel.
//
// A FIXTURE TEM SEMPRE UMA MARCADA E UMA NAO MARCADA. Com so um dos lados o
// filtro pode ser apagado e o bloco continua verde.

test("a despesa realizada desmarcada sai do Realizado, e nao da contagem", () => {
  const linhas = daTela(
    [
      realizada({ id: "t1", amount: -500, include_in_total: true }),
      realizada({ id: "t2", amount: -200, include_in_total: false }),
    ],
    [],
    "expense"
  );

  // CONTROLE: as duas linhas ESTAO na lista. Sem isto, um bloco que medisse so
  // `realizado === 500` passaria tambem com a linha escondida da tela -- que e
  // o defeito oposto, e e o que a decisao C recusou.
  assert.equal(linhas.length, 2);

  const r = resumoDaTela(linhas);
  assert.equal(r.realizado, 500);
  assert.notEqual(r.realizado, 700, "700 e o numero de antes da 060");
  assert.equal(r.quantidadeRealizada, 2);
  assert.equal(r.quantidade, 2);
});

test("o Total e previsto + realizado JA filtrados, e nao uma terceira varredura", () => {
  const linhas = daTela(
    [
      realizada({ id: "t1", amount: -500, include_in_total: true }),
      realizada({ id: "t2", amount: -200, include_in_total: false }),
    ],
    [prevista({ id: "s1", amount: "300.00" })],
    "expense"
  );

  const r = resumoDaTela(linhas);
  assert.equal(r.realizado, 500);
  assert.equal(r.previsto, 300);
  assert.equal(r.total, 800);
  // As tres linhas continuam na frase do rodape.
  assert.equal(r.quantidade, 3);
});

test("a linha PREVISTA nunca e marcada: a coluna e de financial_transactions", () => {
  // `scheduled_transactions` nao tem `include_in_total`, e `linhaPrevista`
  // grava `soma_nos_totais: true` sempre. Se este bloco ficar vermelho, alguem
  // passou a derivar o campo de uma fonte que nao o tem -- e o Previsto
  // inteiro cairia a zero.
  const linhas = daTela([], [prevista({ id: "s1", amount: "300.00" })], "expense");
  assert.equal(linhas[0].soma_nos_totais, true);
  assert.equal(resumoDaTela(linhas).previsto, 300);
});

test("a receita desmarcada sai do Realizado de Receitas -- o caso da HMO-443", () => {
  const linhas = daTela(
    [
      realizada({ id: "t1", amount: 3000, transaction_type: "income", include_in_total: true }),
      realizada({
        id: "t2",
        description: "Ajuste de saldo",
        amount: 1000,
        transaction_type: "income",
        include_in_total: false,
      }),
    ],
    [],
    "income"
  );

  const r = resumoDaTela(linhas);
  assert.equal(r.realizado, 3000);
  assert.notEqual(r.realizado, 4000);
});

test("o campo AUSENTE soma: o cache offline de antes da F2 nao zera a tela", () => {
  // `linhaRealizada` resolve a ausencia com `!== false`, e `resumoDaTela`
  // repete a forma sobre `soma_nos_totais` -- porque uma resposta GUARDADA no
  // aparelho de antes da F2 chega sem o campo, e o `tsc` nao olha o cache. Com
  // `!linha.soma_nos_totais` este numero viraria ZERO, offline, justamente
  // quando nao ha rede para conferir.
  const daCrua = daTela([realizada({ id: "t1", amount: -80 })], [], "expense");
  assert.equal(daCrua[0].soma_nos_totais, true);
  assert.equal(resumoDaTela(daCrua).realizado, 80);

  // E a LinhaDaTela crua, como ela sai de um cache de antes do campo existir.
  const doCache = [{ ...daCrua[0], soma_nos_totais: undefined }];
  assert.equal(resumoDaTela(doCache).realizado, 80);
});
