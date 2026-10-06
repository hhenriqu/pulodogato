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
  ajusteParaFecharEm,
  centavosDaFaturaSemAjuste,
  centavosDe,
  chaveAjuste,
  descricaoPadraoDoAjuste,
  direcaoDaDiferenca,
  direcaoDoAjuste,
  ehAjusteDeFatura,
  ehLinhaDeAjuste,
  lancamentoDoAjuste,
  podeConferirAjuste,
  primeiroDiaDoMesDaFatura,
  totalComOAjuste,
  totalSemOAjuste,
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

// A SUITE DE `validarAjuste({ valor, direcao })` SAIU DAQUI na 2a volta da
// HMO-253, junto com a funcao. Ela cobria "o valor digitado + o lado escolhido",
// e os dois controles sairam da tela quando o ajuste passou a ser automatico:
// depois disso a funcao nao tinha chamador nenhum em producao, e oito testes
// verdes atras dela mediam codigo que nao embarca.
//
// O QUE ELA COBRIA DE VERDADE e o que a secao 6b cobre agora, sobre o caminho
// vivo: o zero que nao pode virar lancamento, os centavos que nao podem
// escorregar, o teto antes do `numeric(15,2)`, e o sinal que a view inverte.

test("zero nao se transforma em lancamento, venha de onde vier", () => {
  // Quem queria TIRAR o ajuste nao digita mais zero (o campo pede o saldo real),
  // mas uma diferenca nula continua existindo -- e ela nao pode virar linha.
  // `lancamentoDoAjuste` e a ultima porta antes do banco.
  assert.equal(
    lancamentoDoAjuste({ valorNaFatura: 0, mes: "2026-10", accountId: CARTAO }),
    null
  );
  // "0.004" arredonda para R$ 0,00 em `numeric(15,2)`. Em centavos ele e 0, e
  // `ajusteParaFecharEm` o chama de "a fatura ja bate" -- que e a resposta certa:
  // nao ha nada a lancar.
  assert.equal(
    ajusteParaFecharEm({ saldoReal: "1240.004", totalSemAjuste: 1240 }).fecha,
    true
  );
  assert.equal(
    ajusteParaFecharEm({ saldoReal: "1240.005", totalSemAjuste: 1240 }).fecha,
    false
  );
});

test("valor alto demais e recusado antes do banco", () => {
  // `numeric(15,2)` estoura e o 22003 chega na tela como "Erro interno".
  assert.equal(
    ajusteParaFecharEm({ saldoReal: TETO_DO_AJUSTE, totalSemAjuste: 0 }).ok,
    false
  );
  assert.equal(
    ajusteParaFecharEm({ saldoReal: TETO_DO_AJUSTE - 1, totalSemAjuste: 0 }).ok,
    true
  );
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
  // A ponte entre a conta da tela e a do banco, PELO CAMINHO VIVO: a tela calcula
  // a diferenca com `ajusteParaFecharEm` e o POST grava com `lancamentoDoAjuste`.
  // `totalComOAjuste` tem de dar o mesmo que somar `invoice_amount` (= -amount)
  // da linha gravada -- senao a conta que o usuario le antes de confirmar
  // discorda do que a fatura vai mostrar depois.
  //
  // A base e 100 de compras; cada saldo real abaixo cobre um lado e um centavo.
  for (const saldoReal of ["150.00", "50.00", "99.99", "1334.56"]) {
    const calculado = ajusteParaFecharEm({ saldoReal, totalSemAjuste: 100 });
    assert.equal(calculado.ok, true, `${saldoReal} tem de ser aceito`);
    assert.equal(calculado.fecha, false);

    const gravado = lancamentoDoAjuste({
      valorNaFatura: calculado.valorNaFatura,
      mes: "2026-10",
      accountId: CARTAO,
    });

    assert.equal(
      totalComOAjuste(100, calculado.valorNaFatura),
      100 + -gravado.amount,
      `previa e gravacao discordam em ${saldoReal}`
    );
    // E a fatura fecha EXATAMENTE no que o usuario informou -- que e o pedido
    // inteiro da issue, em uma assercao.
    assert.equal(100 + -gravado.amount, Number(saldoReal));
  }
});

test("fatura ausente nao quebra a conta da previa", () => {
  assert.equal(totalSemOAjuste(null, null), 0);
  assert.equal(totalSemOAjuste(undefined, null), 0);
});

// ---------------------------------------------------------------------------
// 6b. O AJUSTE AUTOMATICO: O SALDO REAL -> A DIFERENCA (HMO-253, 2a volta)
// ---------------------------------------------------------------------------
// "Deve ser automatico. Eu lanco o valor real que esta hoje meu cartao e um
// metodo verifica se e menor ou maior que a fatura, e lanca a diferenca somando
// ou subtraindo."

test("saldo real MAIOR que a fatura acrescenta a diferenca", () => {
  const r = ajusteParaFecharEm({ saldoReal: "1290.00", totalSemAjuste: 1240 });
  assert.equal(r.ok, true);
  assert.equal(r.fecha, false);
  assert.equal(r.valorNaFatura, 50);
  assert.equal(direcaoDaDiferenca(r.valorNaFatura), "aumenta");
});

test("saldo real MENOR que a fatura abate a diferenca", () => {
  const r = ajusteParaFecharEm({ saldoReal: "1190.00", totalSemAjuste: 1240 });
  assert.equal(r.ok, true);
  assert.equal(r.fecha, false);
  assert.equal(r.valorNaFatura, -50);
  assert.equal(direcaoDaDiferenca(r.valorNaFatura), "abate");
});

test("a diferenca derivada atravessa a inversao de sinal sem se perder", () => {
  // A ponta a ponta do pedido: o banco diz R$ 1.290 sobre uma fatura de R$ 1.240,
  // e o que tem de chegar na coluna `amount` e -50 (despesa e NEGATIVA neste
  // app, e a view publica `-amount`). Um sinal trocado em qualquer um dos dois
  // passos daria o numero certo andando para o lado errado.
  const acrescimo = ajusteParaFecharEm({ saldoReal: 1290, totalSemAjuste: 1240 });
  const aMais = lancamentoDoAjuste({
    valorNaFatura: acrescimo.valorNaFatura,
    mes: "2026-10",
    accountId: CARTAO,
  });
  assert.equal(aMais.amount, -50);
  assert.equal(aMais.transaction_type, "expense");
  assert.equal(1240 + -aMais.amount, 1290, "a fatura tem de fechar em 1290");

  // O outro lado: o banco diz R$ 1.190 e o ajuste e um estorno.
  const abatido = ajusteParaFecharEm({ saldoReal: 1190, totalSemAjuste: 1240 });
  const aMenos = lancamentoDoAjuste({
    valorNaFatura: abatido.valorNaFatura,
    mes: "2026-10",
    accountId: CARTAO,
  });
  assert.equal(aMenos.amount, 50);
  assert.equal(aMenos.transaction_type, "income");
  assert.equal(1240 + -aMenos.amount, 1190);
});

test("fatura que JA BATE devolve fecha:true, e nao um ajuste de zero", () => {
  // Armadilha 4: sao duas respostas boas e diferentes. Quem le isso como erro
  // manda o usuario que digitou o numero certo procurar o que ele errou; quem
  // grava zero poe uma linha na fatura que nao muda nada e parece compra.
  const r = ajusteParaFecharEm({ saldoReal: "1240.00", totalSemAjuste: 1240 });
  assert.equal(r.ok, true);
  assert.equal(r.fecha, true);
  assert.equal(r.valorNaFatura, 0);
  // E `lancamentoDoAjuste` recusaria esse zero de qualquer forma -- a rota nao
  // pode cair nesse ramo, e por isso ela trata `fecha` ANTES de montar a linha.
  assert.equal(
    lancamentoDoAjuste({ valorNaFatura: 0, mes: "2026-10", accountId: CARTAO }),
    null
  );
});

test("CAMPO VAZIO nao e zero: nao vira estorno da fatura inteira", () => {
  // `Number("")` e `0` em JavaScript. Com o campo vazio lido como zero, a
  // resposta seria um ajuste de -1.240 -- o estorno da fatura INTEIRA, com a
  // aritmetica visivelmente correta.
  for (const vazio of ["", "   ", null, undefined, "abc", {}, []]) {
    const r = ajusteParaFecharEm({ saldoReal: vazio, totalSemAjuste: 1240 });
    assert.equal(r.ok, false, `${JSON.stringify(vazio)} nao pode virar 0`);
    assert.match(r.erro, /Informe quanto o cartão diz hoje/);
  }
});

test("saldo real ZERO e uma afirmacao legitima, e abate a fatura inteira", () => {
  // O outro lado do teste de cima: "meu cartao esta zerado hoje" e um dado
  // valido, e recusa-lo junto com o campo vazio deixaria sem jeito de zerar uma
  // fatura que o banco diz estar zerada.
  const r = ajusteParaFecharEm({ saldoReal: "0", totalSemAjuste: 1240 });
  assert.equal(r.ok, true);
  assert.equal(r.fecha, false);
  assert.equal(r.valorNaFatura, -1240);

  // E com a fatura TAMBEM em zero, fecha -- nao ha diferenca.
  const zerado = ajusteParaFecharEm({ saldoReal: "0.00", totalSemAjuste: 0 });
  assert.equal(zerado.fecha, true);
});

test("sem o total da fatura NAO se calcula diferenca nenhuma", () => {
  // Armadilha 3: um `?? 0` aqui transformaria "nao sei quanto e a fatura" em "a
  // fatura e zero", e o ajuste gravado seria o saldo real INTEIRO -- dobrando a
  // fatura no instante em que a leitura voltasse.
  for (const ilegivel of [null, undefined, "", Number.NaN, "x"]) {
    const r = ajusteParaFecharEm({ saldoReal: "1290", totalSemAjuste: ilegivel });
    assert.equal(r.ok, false, `total ${String(ilegivel)} nao pode virar 0`);
    assert.match(r.erro, /Não foi possível ler o total desta fatura/);
  }
});

test("A CONTA E EM CENTAVOS: a diferenca nao escorrega em ponto flutuante", () => {
  // 1290 - 1240.10 em `number` da 49.899999999999995, e `numeric(15,2)`
  // arredondaria isso -- fechando a fatura por sorte neste caso e errando um
  // centavo no seguinte.
  const r = ajusteParaFecharEm({ saldoReal: 1290, totalSemAjuste: 1240.1 });
  assert.equal(r.valorNaFatura, 49.9);
  assert.equal(Math.round(r.valorNaFatura * 100), 4990);

  // E o caso em que o residuo de ponto flutuante INVENTA uma diferenca:
  // `0.1 + 0.2` e `0.30000000000000004`, e `0.3 - (0.1 + 0.2)` nao e zero.
  const residuo = ajusteParaFecharEm({
    saldoReal: "0.30",
    totalSemAjuste: 0.1 + 0.2,
  });
  assert.equal(residuo.fecha, true, "residuo de float nao pode virar ajuste");

  // Trinta e tres centavos somados trinta vezes: a soma em reais daria
  // 9.899999999999999 e a fatura nao fecharia em 9,90.
  let emReais = 0;
  for (let i = 0; i < 30; i += 1) emReais += 0.33;
  assert.equal(
    ajusteParaFecharEm({ saldoReal: "9.90", totalSemAjuste: emReais }).fecha,
    true
  );
});

test("centavosDe distingue 'nao da para ler' de zero", () => {
  assert.equal(centavosDe("12.90"), 1290);
  assert.equal(centavosDe(12.9), 1290);
  assert.equal(centavosDe("0"), 0);
  assert.equal(centavosDe(0), 0);
  assert.equal(centavosDe(-12.9), -1290);
  for (const nulo of ["", "  ", null, undefined, "abc", Number.NaN, Infinity]) {
    assert.equal(centavosDe(nulo), null, `${String(nulo)} tem de dar null`);
  }
  // `Math.trunc` perderia um centavo aqui: 12.9 * 100 e 1290.0000000000002.
  assert.equal(centavosDe(12.9), 1290);
  assert.equal(centavosDe(8.29), 829);
});

test("o teto vale para o digitado E para a diferenca", () => {
  const alto = ajusteParaFecharEm({
    saldoReal: TETO_DO_AJUSTE,
    totalSemAjuste: 0,
  });
  assert.equal(alto.ok, false);

  // Dentro do teto digitado, mas a diferenca estoura -- `numeric(15,2)` volta
  // 500 sem explicacao, e a recusa aqui tem mensagem.
  const diferencaAlta = ajusteParaFecharEm({
    saldoReal: TETO_DO_AJUSTE - 1,
    totalSemAjuste: -(TETO_DO_AJUSTE - 1),
  });
  assert.equal(diferencaAlta.ok, false);
  assert.match(diferencaAlta.erro, /diferença/i);
});

// A BASE DO LADO DO SERVIDOR. A rota nao aceita o total da tela (ela pode estar
// velha): ela soma as linhas da view e tira o ajuste que ja esta gravado.

test("o servidor soma as linhas da fatura em CENTAVOS", () => {
  // Em reais, 0.1 + 0.2 + ... acumula residuo e o residuo cai no teste de
  // "a fatura ja bate". Trinta e tres centavos trinta vezes:
  const trinta = Array.from({ length: 30 }, () => 0.33);
  assert.equal(
    centavosDaFaturaSemAjuste({ invoiceAmounts: trinta, amountDoAjuste: null }),
    990
  );
  assert.equal(
    centavosDaFaturaSemAjuste({
      invoiceAmounts: [1240.1, 49.9],
      amountDoAjuste: null,
    }),
    129000
  );
});

test("o ajuste gravado SAI da base, e sai pelo sinal certo", () => {
  // O DEFEITO QUE ESTA ASSERCAO TRANCA: `amount` e a coluna crua e a view
  // publica `-amount`. Subtrair em vez de somar erraria a base pelo DOBRO do
  // ajuste existente -- e so no SEGUNDO ajuste do mes, com tudo plausivel.
  //
  // Compras de 1.240 + ajuste de +50 na fatura. A view mostra 1.290, e a linha
  // do ajuste tem amount = -50.
  const base = centavosDaFaturaSemAjuste({
    invoiceAmounts: [1240, 50],
    amountDoAjuste: -50,
  });
  assert.equal(base, 124000, "a base tem de voltar para as compras");

  // E o abatimento: ajuste de -50 na fatura tem amount = +50.
  const comAbatimento = centavosDaFaturaSemAjuste({
    invoiceAmounts: [1240, -50],
    amountDoAjuste: 50,
  });
  assert.equal(comAbatimento, 124000);

  // A conta fecha de ponta a ponta: o banco diz 1.300 e o ajuste tem de ser +60.
  const r = ajusteParaFecharEm({ saldoReal: "1300", totalSemAjuste: base / 100 });
  assert.equal(r.valorNaFatura, 60);
});

test("fatura SEM ajuste gravado nao mexe na base", () => {
  for (const semAjuste of [null, undefined]) {
    assert.equal(
      centavosDaFaturaSemAjuste({
        invoiceAmounts: [1240],
        amountDoAjuste: semAjuste,
      }),
      124000
    );
  }
});

test("fatura VAZIA soma zero, e isso nao e 'nao sei'", () => {
  // Cartao novo ou mes sem compra: ajustar essa fatura e legitimo.
  assert.equal(
    centavosDaFaturaSemAjuste({ invoiceAmounts: [], amountDoAjuste: null }),
    0
  );
});

test("UMA linha ilegivel invalida o total inteiro", () => {
  // Pula-la deixaria a fatura menor do que ela e, e o ajuste calculado em cima
  // disso ACRESCENTARIA o valor da linha pulada: a fatura fecharia no numero do
  // banco por um lancamento duplicado -- a doenca que esta feature trata.
  for (const ilegivel of [null, undefined, "", "abc", Number.NaN]) {
    assert.equal(
      centavosDaFaturaSemAjuste({
        invoiceAmounts: [1240, ilegivel, 50],
        amountDoAjuste: null,
      }),
      null,
      `linha ${String(ilegivel)} nao pode ser pulada`
    );
  }
  // E o `amount` do ajuste ilegivel tambem invalida: trata-lo como "nao ha
  // ajuste" faria a diferenca ser calculada em cima dele.
  assert.equal(
    centavosDaFaturaSemAjuste({ invoiceAmounts: [1240], amountDoAjuste: "x" }),
    null
  );
});

test("ALTERAR um ajuste: a base e a fatura SEM ajuste, nao a da tela", () => {
  // O caso que acumula se a base estiver errada. Compras de 1.240, ajuste de
  // +50 valendo, tela mostrando 1.290. O banco agora diz 1.300.
  const fatura = {
    total: 1290,
    lines: [
      { account_id: CARTAO, category_id: "c", invoice_amount: 1240 },
      { account_id: CARTAO, category_id: CATEGORIA, invoice_amount: 50 },
    ],
  };
  const ajuste = ajusteDaFatura(fatura, CARTAO, CATEGORIA);
  const base = totalSemOAjuste(fatura, ajuste);
  assert.equal(base, 1240);

  const r = ajusteParaFecharEm({ saldoReal: "1300", totalSemAjuste: base });
  // +60, e nao +10: o ajuste SUBSTITUI o de 50 pela chave canonica.
  assert.equal(r.valorNaFatura, 60);
  assert.equal(totalComOAjuste(base, r.valorNaFatura), 1300);

  // Sobre o total da TELA daria +10, e a fatura fecharia em 1.350.
  const errado = ajusteParaFecharEm({ saldoReal: "1300", totalSemAjuste: 1290 });
  assert.equal(errado.valorNaFatura, 10);
  assert.notEqual(totalComOAjuste(base, errado.valorNaFatura), 1300);
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
