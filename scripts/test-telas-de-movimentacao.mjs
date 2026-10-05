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
  TIPO_CARTAO,
  linhaRealizada,
  linhaPrevista,
  linhasDaTela,
  secoesDaTela,
  resumoDaTela,
  previstoVencido,
  indiceDeContraparte,
} = await import("../.tmp-telas-de-movimentacao/telas-de-movimentacao.js");

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
  status: "pending",
  effective_status: "pending",
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
    [prevista({ id: "s1", description: "Internet", status: "paid", amount: "159.90" })],
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
  assert.equal(linhaPrevista(prevista({ status: "paid" })), null);
});

test("skipped e cancelled saem do previsto; pending e overdue ficam", () => {
  assert.equal(linhaPrevista(prevista({ status: "skipped" })), null);
  assert.equal(linhaPrevista(prevista({ status: "cancelled" })), null);

  assert.ok(linhaPrevista(prevista({ status: "pending" })));
  // 'overdue' NUNCA e gravado em `status` -- a view o calcula em
  // `effective_status`. Uma conta vencida continua sendo uma conta que o
  // periodo previa: tirando-a daqui, o total de Despesas DIMINUIRIA no dia
  // seguinte ao vencimento, que e o dia em que a pessoa abre a tela.
  const vencida = linhaPrevista(
    prevista({ status: "pending", effective_status: "overdue" })
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
      prevista({ id: "a", amount: "400.00", effective_status: "overdue" }),
      prevista({ id: "b", amount: "100.00", effective_status: "pending" }),
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
  status: "pending",
  effective_status: "pending",
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

test("o gasto no cartao sai SO da tela de Despesas -- ele nao sai do app", () => {
  // "Fora de Despesas" nao pode querer dizer "fora do app": a issue pede o
  // gasto do cartao em Financas Pessoais e dentro do cartao, e o estorno no
  // cartao continua sendo uma entrada. `ehGastoNoCartao` so e consultado na
  // tela de Despesas, e este bloco e o que prova isso -- sem ele, mover o
  // filtro para antes do `classificarMovimentacao` passaria verde e apagaria o
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

  const todas = [estorno, quitacaoDaFatura, saidaDaCorrente];

  // Em Receitas o estorno no cartao continua la.
  const receitas = daTela(todas, [], "income");
  assert.equal(receitas.length, 1);
  assert.equal(receitas[0].id, "estorno");
  assert.equal(resumoDaTela(receitas).realizado, 90);

  // Em Transferencias o pagamento da fatura continua la, uma vez so (a perna de
  // entrada e a que sai, pela armadilha 3 -- e nao pelo tipo da conta).
  const transferencias = daTela(todas, [], "transfer");
  assert.equal(transferencias.length, 1);
  assert.equal(transferencias[0].id, "saida");
  assert.equal(resumoDaTela(transferencias).realizado, 400);

  // E em Despesas nenhuma das tres aparece: duas sao transferencia, uma e
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
    status: "pending",
    effective_status: "pending",
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
    status: "pending",
    effective_status: "pending",
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

test("a realizada NUNCA e fatura -- o pagamento dela e transferencia de duas pernas", () => {
  // `pernasDoPagamentoDeFatura` grava as duas pernas como `transfer`, entao
  // nenhuma delas chega na tela de Despesas. Nao existe linha realizada que
  // seja uma fatura aqui, e `fatura: null` em toda realizada e o que impede a
  // tela de oferecer um link a partir de um lado da conta que nao o tem.
  const indice = indiceDeContraparte([]);

  for (const ids of [SEM_FIXAS, new Set(["t1"])]) {
    assert.equal(linhaRealizada(realizada(), indice, ids).fatura, null);
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

test("sem id E sem notes a linha fica fora -- nao ha chave estavel", () => {
  // Com a chave vindo do indice do array, o React reaproveitaria a linha errada
  // na troca de periodo: o valor de uma conta aparecendo na descricao de outra.
  assert.equal(linhaPrevista({ ...prevista(), id: null, notes: null }), null);
  assert.equal(linhaPrevista({ ...prevista(), id: "", notes: "" }), null);
  assert.equal(linhaPrevista({ ...prevista(), id: "   ", notes: undefined }), null);
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
    prevista({ id: "ja-paga", amount: "80.00", direction: "expense", status: "paid" }),
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
