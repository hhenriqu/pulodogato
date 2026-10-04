#!/usr/bin/env node
// =====================================================
// PULODOGATO - o ajuste de saldo da fatura do cartao (HMO-253)
// =====================================================
//   npm run test:ajuste-de-fatura
//
// "Possibilidade de lancar um ajuste de saldo para que a fatura fique igual a
// real sem ter que discriminar o que foi o gasto, no caso entra como ajuste
// mesmo negativo ou positivo, essa opcao fica no cartao."
//
// AS QUATRO COISAS QUE PODEM DAR ERRADO AQUI SEM DAR ERRO NENHUM
// --------------------------------------------------------------
//   1. O SINAL INVERTIDO. A view publica `(-t.amount) AS invoice_amount`, entao
//      gravar o valor cru faz o acrescimo ABATER da fatura. O numero fica certo
//      na lista de lancamentos, o sinal fica coerente consigo mesmo, e a fatura
//      anda para o lado oposto ao que a pessoa pediu.
//
//   2. O MES ERRADO. O ajuste de outubro gravado em setembro -- por `new Date()`
//      lendo a ISO como UTC, ou por um default de "hoje" quando o mes nao da
//      para ler. As duas faturas ficam plausiveis e ninguem encontra o erro.
//
//   3. O ACUMULO. Salvar duas vezes R$ 50 deixando a fatura 100 maior. E o
//      clique duplo mais comum da internet, e o estrago e dinheiro.
//
//   4. A PREVIA DISCORDANDO DO POST. "A fatura passa para R$ 1.290" e a unica
//      coisa que o usuario le antes de confirmar; uma conta propria na tela
//      erraria exatamente no caso de ALTERAR um ajuste que ja existe.
//
// O que este arquivo NAO cobre:
//   - a MARCACAO (qual numero em qual lugar, e o rotulo "Ajuste" na linha):
//     esta em test-ajuste-na-tela.mjs, porque um teste puro passa verde com o
//     JSX mostrando o campo certo no lugar errado;
//   - o MAPEAMENTO da data para `invoice_month`, que e aritmetica do Postgres:
//     esta em database/tests/ajuste_de_fatura_test.sql. Uma assercao de
//     TypeScript sobre `card_invoice_month` provaria so que eu repeti a mesma
//     conta duas vezes, e as duas copias erradas concordariam.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  NOME_DA_CATEGORIA_DE_AJUSTE,
  PREFIXO_CHAVE_AJUSTE,
  TETO_DO_AJUSTE,
  ajusteDaChave,
  ajusteDaFatura,
  chaveAjuste,
  descricaoPadraoDoAjuste,
  direcaoDoAjuste,
  ehAjusteDeFatura,
  ehLinhaDeAjuste,
  lancamentoDoAjuste,
  podeConferirAjuste,
  primeiroDiaDoMesDaFatura,
  totalComOAjuste,
  totalSemOAjuste,
  validarAjuste,
  valorDoAjusteNaFatura,
} from "../.tmp-ajuste-de-fatura/lib/ajuste-de-fatura.js";

const CARTAO = "11111111-2222-3333-4444-555555555555";
const OUTRO_CARTAO = "99999999-8888-7777-6666-555555555555";
const CATEGORIA = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/** Uma linha de `card_invoice_lines` como a rota a devolve. */
const linha = (campos = {}) => ({
  transaction_id: "t-1",
  user_id: "u-1",
  account_id: CARTAO,
  account_name: "Nubank",
  category_id: "categoria-comum",
  description: "Mercado",
  amount: -100,
  invoice_amount: 100,
  transaction_date: "2026-10-12",
  transaction_type: "expense",
  invoice_month: "2026-10-01",
  ...campos,
});

// ---------------------------------------------------------------------------
// 1. O SINAL
// ---------------------------------------------------------------------------
// O defeito mais caro do arquivo, e o mais facil de escrever: `amount` recebendo
// `valorNaFatura` em vez de `-valorNaFatura`.

test("ajuste que AUMENTA a fatura e gravado como despesa negativa", () => {
  const lancamento = lancamentoDoAjuste({
    valorNaFatura: 50,
    mes: "2026-10",
    accountId: CARTAO,
  });

  assert.ok(lancamento);
  assert.equal(lancamento.amount, -50, "despesa e gravada NEGATIVA neste app");
  assert.equal(lancamento.transaction_type, "expense");
});

test("ajuste que ABATE da fatura e gravado como receita positiva", () => {
  const lancamento = lancamentoDoAjuste({
    valorNaFatura: -50,
    mes: "2026-10",
    accountId: CARTAO,
  });

  assert.ok(lancamento);
  assert.equal(lancamento.amount, 50);
  // 'income' na conta do cartao e o formato de um estorno -- que e o que um
  // abatimento de fatura e.
  assert.equal(lancamento.transaction_type, "income");
});

test("o que a VIEW vai mostrar e o que o usuario pediu, nos dois lados", () => {
  // Esta e a assercao que liga o que se grava ao que a fatura mostra, e ela
  // repete a conta da view de proposito: `(-t.amount) AS invoice_amount`. Sem
  // ela, as duas assercoes acima podem estar internamente coerentes e invertidas
  // -- "amount negativo para aumentar" e uma convencao que so significa algo
  // atraves da view.
  for (const valorNaFatura of [50, -50, 0.01, -0.01, 1234.56]) {
    const lancamento = lancamentoDoAjuste({
      valorNaFatura,
      mes: "2026-10",
      accountId: CARTAO,
    });
    assert.ok(lancamento);
    const invoiceAmount = -lancamento.amount;
    assert.equal(
      invoiceAmount,
      valorNaFatura,
      `ajuste de ${valorNaFatura} tem de somar ${valorNaFatura} na fatura`
    );
  }
});

test("tipo e sinal andam juntos: nunca despesa que abate nem receita que soma", () => {
  for (const valorNaFatura of [0.01, 7, 999999]) {
    const l = lancamentoDoAjuste({ valorNaFatura, mes: "2026-10", accountId: CARTAO });
    assert.equal(l.transaction_type, "expense");
    assert.ok(l.amount < 0);
  }
  for (const valorNaFatura of [-0.01, -7, -999999]) {
    const l = lancamentoDoAjuste({ valorNaFatura, mes: "2026-10", accountId: CARTAO });
    assert.equal(l.transaction_type, "income");
    assert.ok(l.amount > 0);
  }
});

test("o tipo NUNCA sai nulo", () => {
  // Linha sem `transaction_type` fica fora de monthly_cash_flow,
  // category_monthly_totals e planned_vs_actual (HMO-181) E fora de
  // `card_invoice_lines`, que filtra IN ('expense','income'). Um ajuste assim
  // apareceria na lista de lancamentos e nao mudaria a fatura -- ou seja, nao
  // faria a unica coisa que ele existe para fazer.
  for (const valorNaFatura of [50, -50]) {
    const l = lancamentoDoAjuste({ valorNaFatura, mes: "2026-10", accountId: CARTAO });
    assert.ok(
      l.transaction_type === "expense" || l.transaction_type === "income",
      "o tipo tem de ser um dos dois que a view aceita"
    );
  }
});

// ---------------------------------------------------------------------------
// 2. A DATA E O MES
// ---------------------------------------------------------------------------

test("a data do ajuste e o primeiro dia do mes da fatura", () => {
  // Dia 1 cai na fatura do proprio mes para QUALQUER closing_day, porque o CHECK
  // do banco garante closing_day >= 1. A prova de que o mapeamento acontece
  // mesmo esta no teste SQL; aqui se afirma a escolha da data.
  const l = lancamentoDoAjuste({ valorNaFatura: 50, mes: "2026-10", accountId: CARTAO });
  assert.equal(l.transaction_date, "2026-10-01");
});

test("'AAAA-MM' e 'AAAA-MM-01' dao a mesma data", () => {
  assert.equal(primeiroDiaDoMesDaFatura("2026-10"), "2026-10-01");
  assert.equal(primeiroDiaDoMesDaFatura("2026-10-01"), "2026-10-01");
  assert.equal(primeiroDiaDoMesDaFatura("2026-10-27"), "2026-10-01");
});

test("o mes NAO passa por new Date()", () => {
  // `new Date("2026-01-01")` e meia-noite UTC e, em Sao Paulo, volta para
  // 31/12/2025: o ajuste de janeiro gravado em dezembro, somando na fatura do
  // ANO anterior. O teste roda com TZ=America/Sao_Paulo (ver o package.json)
  // porque em UTC este defeito nao existe.
  assert.equal(primeiroDiaDoMesDaFatura("2026-01"), "2026-01-01");
  assert.equal(
    lancamentoDoAjuste({ valorNaFatura: 10, mes: "2026-01", accountId: CARTAO })
      .transaction_date,
    "2026-01-01"
  );
  // Marco, que e quando o horario de verao embaralha a aritmetica de Date.
  assert.equal(primeiroDiaDoMesDaFatura("2026-03"), "2026-03-01");
});

test("mes ilegivel NAO vira o mes corrente -- vira null", () => {
  for (const ruim of [null, undefined, "", "2026", "26-10", "2026-13", "2026-00", "outubro"]) {
    assert.equal(primeiroDiaDoMesDaFatura(ruim), null, `${ruim} nao e mes`);
    assert.equal(
      lancamentoDoAjuste({ valorNaFatura: 50, mes: ruim, accountId: CARTAO }),
      null,
      "sem mes legivel nao se grava dinheiro em mes nenhum"
    );
  }
});

test("sem cartao nao ha lancamento", () => {
  assert.equal(
    lancamentoDoAjuste({ valorNaFatura: 50, mes: "2026-10", accountId: "" }),
    null
  );
});

test("valor zero nao vira lancamento", () => {
  assert.equal(
    lancamentoDoAjuste({ valorNaFatura: 0, mes: "2026-10", accountId: CARTAO }),
    null
  );
});

// ---------------------------------------------------------------------------
// 3. A CHAVE CANONICA: O QUE IMPEDE O ACUMULO
// ---------------------------------------------------------------------------

test("a chave carrega o mes e o cartao, e volta inteira", () => {
  const chave = chaveAjuste("2026-10-01", CARTAO);
  assert.ok(chave.startsWith(PREFIXO_CHAVE_AJUSTE));
  assert.deepEqual(ajusteDaChave(chave), { mes: "2026-10-01", accountId: CARTAO });
  assert.equal(ehAjusteDeFatura(chave), true);
});

test("a chave do lancamento usa o PRIMEIRO DIA, nunca o mes cru", () => {
  // Se a chave gravada fosse `ajuste-de-fatura:2026-10:<id>` e o DELETE
  // procurasse `2026-10-01`, remover o ajuste responderia 404 sobre um ajuste
  // que esta na tela -- e alterar criaria um segundo, acumulando.
  const l = lancamentoDoAjuste({ valorNaFatura: 50, mes: "2026-10", accountId: CARTAO });
  assert.equal(l.notes, chaveAjuste("2026-10-01", CARTAO));
  assert.deepEqual(ajusteDaChave(l.notes), {
    mes: "2026-10-01",
    accountId: CARTAO,
  });
});

test("o mesmo mes e o mesmo cartao dao a MESMA chave, qualquer que seja o valor", () => {
  // E isto que faz o POST trocar em vez de empilhar: os dois pedidos procuram a
  // mesma linha.
  const a = lancamentoDoAjuste({ valorNaFatura: 50, mes: "2026-10", accountId: CARTAO });
  const b = lancamentoDoAjuste({ valorNaFatura: -900, mes: "2026-10-01", accountId: CARTAO });
  assert.equal(a.notes, b.notes);
});

test("meses diferentes e cartoes diferentes dao chaves diferentes", () => {
  const outubro = chaveAjuste("2026-10-01", CARTAO);
  assert.notEqual(outubro, chaveAjuste("2026-11-01", CARTAO));
  assert.notEqual(outubro, chaveAjuste("2026-10-01", OUTRO_CARTAO));
});

test("nota escrita a mao NAO passa por chave canonica", () => {
  for (const notes of [
    null,
    undefined,
    "",
    "ajuste",
    "ajuste-de-fatura",
    `ajuste-de-fatura:2026-10-01:${CARTAO} conferi no app do banco`,
    `prefixo ajuste-de-fatura:2026-10-01:${CARTAO}`,
    "ajuste-de-fatura:2026-10-01:nao-e-uuid",
    "fatura:2026-10-01:" + CARTAO,
  ]) {
    assert.equal(ehAjusteDeFatura(notes), false, `"${notes}" nao e chave`);
  }
});

// ---------------------------------------------------------------------------
// 4. O QUE O USUARIO DIGITOU
// ---------------------------------------------------------------------------

test("valor + direcao viram o valor assinado na fatura", () => {
  assert.deepEqual(validarAjuste({ valor: "50.00", direcao: "aumenta" }), {
    ok: true,
    valorNaFatura: 50,
  });
  assert.deepEqual(validarAjuste({ valor: "50.00", direcao: "abate" }), {
    ok: true,
    valorNaFatura: -50,
  });
  assert.deepEqual(validarAjuste({ valor: 12.34, direcao: "aumenta" }), {
    ok: true,
    valorNaFatura: 12.34,
  });
});

test("zero e recusado, e com a mensagem que ensina o caminho", () => {
  const r = validarAjuste({ valor: "0", direcao: "aumenta" });
  assert.equal(r.ok, false);
  // Quem queria TIRAR o ajuste digitaria zero; se isso gravasse uma linha de
  // R$ 0,00, a pessoa sairia achando que tirou e o ajuste velho continuaria
  // valendo. A mensagem tem de apontar o Remover.
  assert.match(r.erro, /Remover ajuste/);
});

test("centavos de zero tambem sao zero", () => {
  // "0.004" arredonda para R$ 0,00 em `numeric(15,2)`: aceitar aqui gravaria uma
  // linha que nao muda nada e ainda aparece na fatura com cara de compra.
  assert.equal(validarAjuste({ valor: "0.004", direcao: "aumenta" }).ok, false);
  assert.equal(validarAjuste({ valor: "0.005", direcao: "aumenta" }).ok, true);
});

test("valor ausente, vazio ou nao numerico e recusado", () => {
  for (const ruim of [null, undefined, "", "   ", "abc", "R$ 50", Number.NaN, Infinity]) {
    assert.equal(
      validarAjuste({ valor: ruim, direcao: "aumenta" }).ok,
      false,
      `${String(ruim)} nao e valor`
    );
  }
});

test("negativo e recusado -- a direcao e que diz o lado", () => {
  // `CampoDeValor` e mascara de digitos e nunca emite negativo. Um negativo aqui
  // veio de outro cliente, e aceitar faria "abate -50" significar "aumenta 50":
  // a tela dizendo o contrario do que o banco guarda.
  const r = validarAjuste({ valor: "-50", direcao: "abate" });
  assert.equal(r.ok, false);
});

test("direcao ausente ou inventada e recusada", () => {
  for (const ruim of [null, undefined, "", "soma", "positivo", true, 1]) {
    assert.equal(validarAjuste({ valor: "50", direcao: ruim }).ok, false);
  }
});

test("valor alto demais e recusado antes do banco", () => {
  // `numeric(15,2)` estoura e o 22003 chega na tela como "Erro interno".
  assert.equal(validarAjuste({ valor: TETO_DO_AJUSTE, direcao: "aumenta" }).ok, false);
  assert.equal(validarAjuste({ valor: TETO_DO_AJUSTE - 1, direcao: "aumenta" }).ok, true);
});

test("a descricao padrao diz de que lado o ajuste e", () => {
  assert.match(descricaoPadraoDoAjuste(50), /Ajuste de saldo da fatura/);
  assert.notEqual(descricaoPadraoDoAjuste(50), descricaoPadraoDoAjuste(-50));
});

test("descricao do usuario e usada, e so em branco cai no padrao", () => {
  assert.equal(
    lancamentoDoAjuste({
      valorNaFatura: 50,
      mes: "2026-10",
      accountId: CARTAO,
      descricao: "IOF da compra em dólar",
    }).description,
    "IOF da compra em dólar"
  );
  for (const vazia of ["", "   ", null, undefined]) {
    assert.equal(
      lancamentoDoAjuste({
        valorNaFatura: 50,
        mes: "2026-10",
        accountId: CARTAO,
        descricao: vazia,
      }).description,
      descricaoPadraoDoAjuste(50),
      "descricao em branco nao deixa a linha sem nome"
    );
  }
});

// ---------------------------------------------------------------------------
// 5. ACHAR O AJUSTE NA RESPOSTA DA ROTA
// ---------------------------------------------------------------------------

const faturaCom = (linhas, total) => ({
  account_id: CARTAO,
  account_name: "Nubank",
  invoice_month: "2026-10-01",
  total,
  line_count: linhas.length,
  lines: linhas,
});

test("o ajuste e achado pela categoria reservada", () => {
  const ajuste = linha({
    transaction_id: "t-ajuste",
    category_id: CATEGORIA,
    amount: -50,
    invoice_amount: 50,
  });
  const fatura = faturaCom([linha(), ajuste], 150);

  assert.equal(ajusteDaFatura(fatura, CARTAO, CATEGORIA)?.transaction_id, "t-ajuste");
  assert.equal(valorDoAjusteNaFatura(ajuste), 50);
  assert.equal(direcaoDoAjuste(ajuste), "aumenta");
});

test("o valor do ajuste na tela sai de invoice_amount, nao de amount", () => {
  // Ler `amount` mostraria "- R$ 50,00" para um ajuste que ACRESCENTA 50 -- o
  // sinal certo da coluna, invertido para quem le a fatura.
  const acrescimo = linha({ category_id: CATEGORIA, amount: -50, invoice_amount: 50 });
  const abatimento = linha({
    category_id: CATEGORIA,
    amount: 50,
    invoice_amount: -50,
    transaction_type: "income",
  });
  assert.equal(valorDoAjusteNaFatura(acrescimo), 50);
  assert.equal(valorDoAjusteNaFatura(abatimento), -50);
  assert.equal(direcaoDoAjuste(abatimento), "abate");
});

test("linha de OUTRO cartao nao e o ajuste desta fatura", () => {
  const fatura = faturaCom(
    [linha({ transaction_id: "t-outro", account_id: OUTRO_CARTAO, category_id: CATEGORIA })],
    50
  );
  assert.equal(ajusteDaFatura(fatura, CARTAO, CATEGORIA), null);
});

test("sem categoria reservada nao ha ajuste a achar", () => {
  const fatura = faturaCom([linha({ category_id: CATEGORIA })], 50);
  assert.equal(ajusteDaFatura(fatura, CARTAO, null), null);
  assert.equal(ajusteDaFatura(fatura, CARTAO, undefined), null);
});

test("undefined e 'nao da para conferir'; null e 'nao tem'", () => {
  // A distincao que impede a tela de oferecer "Ajustar saldo" sobre uma fatura
  // que JA tem ajuste, afirmando por omissao que ela nao tem.
  assert.equal(podeConferirAjuste(undefined), false);
  assert.equal(podeConferirAjuste(null), true);
  assert.equal(podeConferirAjuste(CATEGORIA), true);
});

test("ehLinhaDeAjuste nao carimba o rotulo sem categoria", () => {
  const comum = linha();
  const ajuste = linha({ category_id: CATEGORIA });
  assert.equal(ehLinhaDeAjuste(ajuste, CATEGORIA), true);
  assert.equal(ehLinhaDeAjuste(comum, CATEGORIA), false);
  // Sem categoria conhecida NENHUMA linha e ajuste -- carimbar por adivinhacao
  // chamaria de ajuste a compra de alguem.
  assert.equal(ehLinhaDeAjuste(ajuste, undefined), false);
  assert.equal(ehLinhaDeAjuste(ajuste, null), false);
});

// ---------------------------------------------------------------------------
// 6. A PREVIA, QUE TEM DE CONCORDAR COM O POST
// ---------------------------------------------------------------------------

test("o total sem o ajuste tira o que o ajuste pos", () => {
  const ajuste = linha({ category_id: CATEGORIA, amount: -50, invoice_amount: 50 });
  const fatura = faturaCom([linha(), ajuste], 150);
  assert.equal(totalSemOAjuste(fatura, ajuste), 100);
  // Sem ajuste, o total da fatura e o proprio total.
  assert.equal(totalSemOAjuste(faturaCom([linha()], 100), null), 100);
});

test("ALTERAR um ajuste nao empilha: a previa troca o valor, nao soma", () => {
  // O caso que erra se a previa partir do total da TELA (que ja inclui o ajuste
  // atual): a fatura tem R$ 100 de compras e R$ 50 de ajuste, total 150. Trocar
  // o ajuste para R$ 70 tem de dar 170, nao 220.
  const ajuste = linha({ category_id: CATEGORIA, amount: -50, invoice_amount: 50 });
  const fatura = faturaCom([linha(), ajuste], 150);

  const base = totalSemOAjuste(fatura, ajuste);
  assert.equal(totalComOAjuste(base, 70), 170);
  assert.notEqual(totalComOAjuste(base, 70), 220);
});

test("a previa fecha com o que o POST grava, nos dois lados", () => {
  // A ponte entre a conta da tela e a do banco: `totalComOAjuste` tem de dar o
  // mesmo que somar `invoice_amount` (= -amount) do lancamento gravado.
  for (const [valor, direcao] of [
    ["50.00", "aumenta"],
    ["50.00", "abate"],
    ["0.01", "abate"],
    ["1234.56", "aumenta"],
  ]) {
    const validado = validarAjuste({ valor, direcao });
    assert.equal(validado.ok, true);

    const gravado = lancamentoDoAjuste({
      valorNaFatura: validado.valorNaFatura,
      mes: "2026-10",
      accountId: CARTAO,
    });

    assert.equal(
      totalComOAjuste(100, validado.valorNaFatura),
      100 + -gravado.amount,
      `previa e gravacao discordam em ${valor} ${direcao}`
    );
  }
});

test("fatura ausente nao quebra a conta da previa", () => {
  assert.equal(totalSemOAjuste(null, null), 0);
  assert.equal(totalSemOAjuste(undefined, null), 0);
});

// ---------------------------------------------------------------------------
// 7. A CATEGORIA RESERVADA
// ---------------------------------------------------------------------------

test("o nome da categoria reservada e o mesmo nos dois lados", () => {
  // A rota de ajuste CRIA por este nome e a rota GET PROCURA por ele. Duas
  // strings iguais escritas em dois arquivos divergem na primeira renomeacao, e
  // o sintoma seria o rotulo "Ajuste" sumindo da linha -- com o ajuste
  // continuando a somar certo na fatura, entao nada pareceria quebrado.
  assert.equal(NOME_DA_CATEGORIA_DE_AJUSTE, "Ajuste de fatura");
});
