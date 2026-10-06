// =====================================================
// PULODOGATO - o cartao conta pela FATURA PAGA, nao pela compra (HMO-265)
// =====================================================
//   npm run test:realizado-do-caixa
//
// Roda o JS compilado de lib/realizado-do-caixa.ts junto com `agregarTransacoes`
// de lib/periodo-do-painel.ts -- de proposito, e nao por conveniencia.
//
// POR QUE A ASSERCAO E SOBRE O TOTAL, E NAO SOBRE A LISTA
// -------------------------------------------------------
// `realizadoComCartaoPelaFatura` nao soma nada: ela tira linha e reescreve
// `transaction_type`. Afirmar so sobre a lista que ela devolve deixaria passar
// o defeito que esta issue existe para corrigir, porque o defeito e um NUMERO:
//
//   * promover as DUAS pernas do pagamento -> a lista parece certa (as duas
//     linhas estao la, uma de cada lado) e o total sai com a fatura em DOBRO,
//     porque `agregarTransacoes` aplica `Math.abs` antes de somar;
//   * promover a perna de ENTRADA como income -> a lista tem o mesmo tamanho e
//     a receita do mes sobe pelo valor da fatura;
//   * tirar a compra e nao promover nada -> a lista encurta "corretamente" e o
//     total fica MENOR, que nao parece erro: parece um mes barato.
//
// Entao cada bloco abaixo afirma o total E o numero que a conta errada daria.
// Sem o segundo, "total = 1290" passa verde num modulo que nao faz nada, desde
// que o fixture tenha so a fatura.
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
  ehSaidaDePagamentoDeFatura,
  realizadoComCartaoPelaFatura,
  COLUNAS_DO_REALIZADO_DE_CAIXA,
} = await import("../.tmp-realizado-do-caixa/realizado-do-caixa.js");

const { agregarTransacoes } = await import(
  "../.tmp-realizado-do-caixa/periodo-do-painel.js"
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
 * chave canonica em `notes` e SEM o elo (quem o grava e a perna de entrada).
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

const totalizar = (linhas) =>
  agregarTransacoes(realizadoComCartaoPelaFatura(linhas));

// ---------------------------------------------------------------------------
// As duas metades da regra, cada uma com o numero da conta errada
// ---------------------------------------------------------------------------

test("a compra no cartao sai do realizado -- a fatura e que vai contar", () => {
  const linhas = [despesa(), compraNoCartao()];
  const resumo = totalizar(linhas);

  assert.equal(resumo.total_expense, 250);
  // O numero de antes desta issue: a compra somada no dia da compra.
  assert.notEqual(resumo.total_expense, 650);
  // E a contagem acompanha: um `COUNT(*)` que ainda visse a compra deixaria o
  // tile "Lancamentos" discordando do total ao lado dele.
  assert.equal(resumo.transaction_count, 1);
});

test("a fatura PAGA entra no realizado pelo valor que saiu da conta", () => {
  const resumo = totalizar([saidaDaFatura(), entradaDaFatura()]);

  assert.equal(resumo.total_expense, 1290);
  // Sem a promocao, as duas pernas sao 'transfer' e nenhuma entra: o mes em que
  // se pagou a fatura sairia R$ 1.290 mais barato. E o defeito da HMO-264.
  assert.notEqual(resumo.total_expense, 0);
  // E ela nao pode entrar como RECEITA pela perna de entrada, que e positiva.
  assert.equal(resumo.total_income, 0);
});

test("as duas metades juntas: a compra sai e a fatura que a contem entra", () => {
  const resumo = totalizar([
    despesa(),
    compraNoCartao(),
    saidaDaFatura(),
    entradaDaFatura(),
  ]);

  assert.equal(resumo.total_expense, 1540); // 250 + 1290
  // Os tres totais errados que esta issue tem de impedir, nomeados:
  assert.notEqual(resumo.total_expense, 1940, "a compra somou junto da fatura");
  assert.notEqual(resumo.total_expense, 2830, "a fatura contou em DOBRO");
  assert.notEqual(resumo.total_expense, 250, "o cartao desapareceu dos dois lados");
});

test("a perna de ENTRADA do pagamento nunca vira receita nem despesa", () => {
  // Ela e positiva e esta no cartao: promove-la como income inflaria a receita
  // do mes pelo valor da fatura, e promove-la como expense daria a fatura em
  // dobro -- `agregarTransacoes` aplica `Math.abs`, entao as duas NAO se anulam.
  assert.equal(ehSaidaDePagamentoDeFatura(entradaDaFatura()), false);

  const resumo = totalizar([entradaDaFatura()]);
  assert.equal(resumo.total_income, 0);
  assert.equal(resumo.total_expense, 0);
  assert.notEqual(resumo.total_income, 1290);
});

test("a perna de entrada SEM o elo e reconhecida pelo sinal", () => {
  // O FK do 015 e `ON DELETE SET NULL`: apagar a perna de saida deixa a de
  // entrada sem elo. Sem o criterio de sinal ela passaria por perna de saida e
  // a fatura voltaria a contar duas vezes num par antigo.
  const semElo = entradaDaFatura({ counterpart_transaction_id: null });
  assert.equal(ehSaidaDePagamentoDeFatura(semElo), false);
});

// ---------------------------------------------------------------------------
// O que NAO pode ser confundido com fatura nem com compra
// ---------------------------------------------------------------------------

test("transferencia entre contas proprias continua fora dos dois lados", () => {
  // Um Pix da corrente para a poupanca: 'transfer', SEM chave de fatura. Sem o
  // criterio de `notes`, toda transferencia do periodo viraria despesa do mes.
  const pix = saidaDaFatura({ notes: "Reserva de emergência" });
  assert.equal(ehSaidaDePagamentoDeFatura(pix), false);

  const resumo = totalizar([pix]);
  assert.equal(resumo.total_expense, 0);
  assert.notEqual(resumo.total_expense, 1290);
});

test("nota escrita a mao que PARECE chave de fatura nao e chave de fatura", () => {
  // `ehFatura` e ancorado nas duas pontas de proposito (lib/card-invoice.ts).
  // Sem o `$`, a descricao livre do usuario viraria regra de negocio.
  const aMao = saidaDaFatura({
    notes: `${CHAVE_FATURA} paguei no debito`,
  });
  assert.equal(ehSaidaDePagamentoDeFatura(aMao), false);
});

test("assinatura cobrada no cartao e paga COM o cartao continua sendo despesa", () => {
  // Ela e uma conta prevista com `account_id` do cartao, e a baixa dela grava
  // uma despesa no cartao -- que a fatura CONTEM. Entao ela sai daqui pelo
  // mesmo caminho da compra, e nao por ser "pagamento": o criterio de fatura e
  // a chave em `notes`, e esta linha nao tem chave nenhuma.
  //
  // O que esta sendo provado e o contrario do erro da migration 015: quem
  // detectasse fatura por `account_type` transformaria toda assinatura de cartao
  // em transferencia e a faria desaparecer do relatorio.
  const assinatura = compraNoCartao({ amount: -39.9, notes: "Streaming" });
  assert.equal(ehCompraNoCartao(assinatura), true);
  assert.equal(ehSaidaDePagamentoDeFatura(assinatura), false);
});

test("compra no cartao com transaction_type NULO fica onde estava", () => {
  // A view `card_invoice_lines` filtra `transaction_type IN ('expense','income')`
  // pela COLUNA, e ha linha com a coluna nula em producao. Uma compra assim NAO
  // esta na fatura, entao esconde-la daqui a tiraria do app sem que nada a
  // somasse no lugar.
  const nula = compraNoCartao({ transaction_type: null });
  assert.equal(ehCompraNoCartao(nula), false);

  // Ela atravessa a regra intacta -- e continua fora do total, porque todo
  // agregado de fluxo filtra income/expense. O ponto e que a regra nao a TOCA:
  // o dia em que o tipo dela for corrigido no banco, ela entra pelo caminho
  // normal.
  const [sobrevivente] = realizadoComCartaoPelaFatura([nula]);
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

// ---------------------------------------------------------------------------
// As duas formas do embed, e a linha que nao tem conta
// ---------------------------------------------------------------------------

test("o embed da conta e lido venha ele objeto OU array de um", () => {
  // `financial_transactions` e TABELA e o supabase-js devolve objeto -- mas a
  // rota atravessa a fronteira com um `as` e o tsc nao verifica nada ali. Lendo
  // so a forma objeto, um embed em array daria `undefined` em TODA linha,
  // nenhuma casaria com `credit_card`, e o painel voltaria ao defeito desta
  // issue sem erro, sem log e com o tsc verde (HMO-209).
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
  // conta, sem `notes` e sem elo: a MESMA lista que as transacoes. Elas nao
  // podem ser tocadas aqui -- a minha parte de uma despesa de grupo nao e compra
  // no cartao nem pagamento de fatura.
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
  // `agregarTransacoesPorMoeda`). Reescrever `transaction_type` no proprio
  // objeto seria um efeito a distancia invisivel nas duas funcoes.
  const original = saidaDaFatura();
  const [promovida] = realizadoComCartaoPelaFatura([original]);

  assert.equal(promovida.transaction_type, "expense");
  assert.equal(original.transaction_type, "transfer");
});

// ---------------------------------------------------------------------------
// As colunas que a consulta precisa pedir
// ---------------------------------------------------------------------------

test("as quatro colunas load-bearing estao na lista que a rota pede", () => {
  // Nenhuma das quatro aparece na tela, e tirar qualquer uma do `select` nao
  // quebra tsc nem assercao de unidade: a regra passa a receber `undefined`,
  // deixa de casar, e o painel volta ao defeito. Este bloco e o que torna o
  // `select` parte do contrato.
  for (const coluna of [
    "amount",
    "transaction_type",
    "currency",
    "notes",
    "counterpart_transaction_id",
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
});
