#!/usr/bin/env node
// =====================================================
// PULODOGATO - as regras de um lancamento (HMO-165)
// =====================================================
// Receita e despesa passaram a ter tela propria, e as regras que as duas telas
// compartilham estao em `lib/lancamento.ts`. Este arquivo cobra as que erram
// DINHEIRO em silencio se quebrarem:
//
//   - o sinal (despesa e gravada negativa; positiva ela SOMA no saldo);
//   - a categoria combinar com a tela (receita com categoria de despesa gravaria
//     `transaction_type = income` com valor negativo -- a tela exibe com
//     `Math.abs` e mostra o numero certo, enquanto todo agregado que soma a
//     coluna crua fica errado);
//   - quais campos existem em cada tela (a separacao e o ponto da issue).
//
// O teste de arvore -- que os campos de despesa NAO aparecem na tela de receita
// -- esta em `test-campos-de-lancamento.mjs`, que renderiza o componente. Uma
// funcao pura nao prova JSX.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  camposDoTipo,
  categoriasDoTipo,
  contasDoSeletor,
  valoresIniciais,
  validarLancamento,
  valorGravado,
  rotaDoTipo,
  tipoDoLancamento,
  naturezasDoTipo,
  regraDeRecorrencia,
  destinoDoLancamento,
  contaPrevista,
  datasDaTransacao,
  hojeISO,
  MAX_MESES_DE_REPETICAO,
} from "../.tmp-lancamento/lib/lancamento.js";

const CATEGORIA_DESPESA = { id: "c1", name: "Mercado", is_expense: true };
const CATEGORIA_RECEITA = { id: "c2", name: "Salário", is_expense: false };

/** Um formulario preenchido e valido, para cada caso mexer em um campo so. */
function preenchido(extra = {}) {
  return {
    ...valoresIniciais(),
    descricao: "Compra",
    valor: "100",
    categoriaId: "c1",
    data: "2026-09-28",
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// O SINAL
// ---------------------------------------------------------------------------

test("despesa e gravada negativa, receita positiva", () => {
  assert.equal(valorGravado("expense", 100), -100);
  assert.equal(valorGravado("income", 100), 100);
});

test("o menos digitado na frente nao inverte o lancamento", () => {
  // O input e `type=number`: "-30" passa. Sem o `Math.abs` dos dois lados, uma
  // despesa digitada como -30 viraria +30 -- dinheiro ENTRANDO -- e o saldo
  // fecharia errado para mais, que e o lado do qual ninguem reclama.
  assert.equal(valorGravado("expense", -30), -30);
  assert.equal(valorGravado("income", -30), 30);
});

// ---------------------------------------------------------------------------
// A CATEGORIA TEM QUE COMBINAR COM A TELA
// ---------------------------------------------------------------------------

test("receita com categoria de despesa e recusada", () => {
  const r = validarLancamento("income", preenchido({ categoriaId: "c1" }), {
    categoria: CATEGORIA_DESPESA,
    editando: false,
  });
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /categoria é de despesa/i);
});

test("despesa com categoria de receita e recusada", () => {
  const r = validarLancamento("expense", preenchido({ categoriaId: "c2" }), {
    categoria: CATEGORIA_RECEITA,
    editando: false,
  });
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /categoria é de receita/i);
});

test("os dois pares certos passam", () => {
  assert.equal(
    validarLancamento("expense", preenchido(), {
      categoria: CATEGORIA_DESPESA,
      editando: false,
    }).ok,
    true
  );
  assert.equal(
    validarLancamento("income", preenchido({ categoriaId: "c2" }), {
      categoria: CATEGORIA_RECEITA,
      editando: false,
    }).ok,
    true
  );
});

test("sem a categoria em maos, a validacao nao inventa recusa", () => {
  // Offline o catalogo pode nao ter a categoria que o `?id=` trouxe. Recusar
  // por ausencia de informacao travaria o lancamento sem motivo -- o banco
  // ainda tem a FK e o `is_expense` para conferir.
  assert.equal(
    validarLancamento("income", preenchido(), {
      categoria: undefined,
      editando: false,
    }).ok,
    true
  );
});

// ---------------------------------------------------------------------------
// QUAIS CAMPOS EXISTEM
// ---------------------------------------------------------------------------

test("receita nao tem parcelamento nem rateio", () => {
  const campos = camposDoTipo("income", "one_off", false);
  // `natureza` PASSOU a existir na receita com a HMO-170 (pontual x fixa), e a
  // asercao mudou junto -- ver "as duas telas oferecem natureza" mais abaixo,
  // que e quem cobra a lista de opcoes de cada tela. O resto continua sendo da
  // despesa so: receita nao se parcela nem se rateia.
  assert.equal(campos.parcelamento, false);
  assert.equal(campos.rateio, false);
  assert.equal(campos.diaDeVencimento, false);
  assert.equal(campos.contaObrigatoria, false);
});

test("despesa tem os tres", () => {
  const campos = camposDoTipo("expense", "one_off", false);
  assert.equal(campos.natureza, true);
  assert.equal(campos.parcelamento, true);
  assert.equal(campos.rateio, true);
});

test("receita nao ganha campo de despesa nem passando natureza de cartao", () => {
  // O estado do formulario e um objeto so para os dois tipos, entao `natureza`
  // pode chegar como "card" na tela de receita -- pelo link de edicao de uma
  // entrada apontada para um cartao, por exemplo. Quem decide e o TIPO: se esta
  // funcao olhasse a natureza antes do tipo, a tela de receita passaria a exigir
  // cartao, e o Salvar recusaria pedindo um campo que ela nao mostra.
  const campos = camposDoTipo("income", "card", false);
  assert.equal(campos.contaObrigatoria, false);
  assert.equal(campos.parcelamento, false);
  assert.equal(campos.rateio, false);
  // E "card" nao e uma opcao oferecida na receita, mesmo chegando no estado.
  assert.ok(!naturezasDoTipo("income").includes("card"));
});

test("gasto no cartao torna a conta obrigatoria", () => {
  const campos = camposDoTipo("expense", "card", false);
  assert.equal(campos.contaObrigatoria, true);

  const r = validarLancamento(
    "expense",
    preenchido({ natureza: "card", contaId: "" }),
    { categoria: CATEGORIA_DESPESA, editando: false }
  );
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /cartão/i);
});

test("editar nunca oferece despesa fixa nem parcelamento", () => {
  // Transacao gravada e lancamento, nao regra: a regra mora em
  // `recurring_rules` e se edita em Contas Previstas. E parcelar o que ja existe
  // exigiria apagar a linha e criar N no lugar.
  const campos = camposDoTipo("expense", "fixed", true);
  assert.equal(campos.diaDeVencimento, false);
  assert.equal(campos.parcelamento, false);
});

test("parcelar um lancamento existente e recusado com a mensagem certa", () => {
  const r = validarLancamento(
    "expense",
    preenchido({ parcelado: true, valorDaParcela: "50", totalDeParcelas: 3 }),
    { categoria: CATEGORIA_DESPESA, editando: true }
  );
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /já existe/i);
});

// ---------------------------------------------------------------------------
// DESPESA FIXA
// ---------------------------------------------------------------------------

test("despesa fixa exige dia de vencimento entre 1 e 31", () => {
  const base = { categoria: CATEGORIA_DESPESA, editando: false };

  for (const dia of ["", "0", "32", "12.5", "abc"]) {
    const r = validarLancamento(
      "expense",
      preenchido({ natureza: "fixed", diaDeVencimento: dia }),
      base
    );
    assert.equal(r.ok, false, `dia ${JSON.stringify(dia)} deveria ser recusado`);
    assert.match(r.mensagem, /dia do vencimento/i);
  }

  assert.equal(
    validarLancamento(
      "expense",
      preenchido({ natureza: "fixed", diaDeVencimento: "31" }),
      base
    ).ok,
    true
  );
});

// ---------------------------------------------------------------------------
// VALOR, DESCRICAO, DATA
// ---------------------------------------------------------------------------

test("valor zero, negativo ou vazio e recusado", () => {
  for (const valor of ["", "0", "-5", "abc"]) {
    const r = validarLancamento("expense", preenchido({ valor }), {
      categoria: CATEGORIA_DESPESA,
      editando: false,
    });
    assert.equal(r.ok, false, `valor ${JSON.stringify(valor)} passou`);
    assert.match(r.mensagem, /maior que zero/i);
  }
});

test("descricao so de espaco nao conta como descricao", () => {
  const r = validarLancamento("expense", preenchido({ descricao: "   " }), {
    categoria: CATEGORIA_DESPESA,
    editando: false,
  });
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /descrição/i);
});

test("data fora do formato do banco e recusada", () => {
  for (const data of ["28/09/2026", "2026-9-8", ""]) {
    const r = validarLancamento("expense", preenchido({ data }), {
      categoria: CATEGORIA_DESPESA,
      editando: false,
    });
    assert.equal(r.ok, false, `data ${JSON.stringify(data)} passou`);
  }
});

test("parcelamento exige parcela positiva e mais de uma parcela", () => {
  const base = { categoria: CATEGORIA_DESPESA, editando: false };

  const semValor = validarLancamento(
    "expense",
    preenchido({ parcelado: true, valorDaParcela: "0", totalDeParcelas: 3 }),
    base
  );
  assert.equal(semValor.ok, false);
  assert.match(semValor.mensagem, /parcela deve ser maior/i);

  const umaParcela = validarLancamento(
    "expense",
    preenchido({ parcelado: true, valorDaParcela: "50", totalDeParcelas: 1 }),
    base
  );
  assert.equal(umaParcela.ok, false);
  assert.match(umaParcela.mensagem, /maior que 1/i);

  assert.equal(
    validarLancamento(
      "expense",
      preenchido({ parcelado: true, valorDaParcela: "50", totalDeParcelas: 3 }),
      base
    ).ok,
    true
  );
});

test("receita com parcelado ligado no estado nao cai nas regras de parcela", () => {
  // A tela de receita nao mostra parcelamento, entao a mensagem sobre parcela
  // falaria de um campo invisivel. Sem esta porta, um `parcelado: true` vindo do
  // estado (ou de um estado reaproveitado) travaria a receita para sempre.
  const r = validarLancamento(
    "income",
    preenchido({
      categoriaId: "c2",
      parcelado: true,
      valorDaParcela: "",
      totalDeParcelas: 1,
    }),
    { categoria: CATEGORIA_RECEITA, editando: false }
  );
  assert.equal(r.ok, true);
});

// ---------------------------------------------------------------------------
// AS LISTAS DOS SELETORES
// ---------------------------------------------------------------------------

test("cada tela lista so as suas categorias", () => {
  const todas = [CATEGORIA_DESPESA, CATEGORIA_RECEITA];
  assert.deepEqual(categoriasDoTipo(todas, "expense"), [CATEGORIA_DESPESA]);
  assert.deepEqual(categoriasDoTipo(todas, "income"), [CATEGORIA_RECEITA]);
});

test("gasto no cartao lista apenas cartao de credito", () => {
  const contas = [
    { id: "a", name: "Corrente", account_type: "checking" },
    { id: "b", name: "Visa", account_type: "credit_card" },
  ];

  assert.deepEqual(
    contasDoSeletor(contas, "expense", "card").map((c) => c.id),
    ["b"]
  );
  // Pontual e fixa listam todas: pagar do saldo e legitimo.
  assert.equal(contasDoSeletor(contas, "expense", "one_off").length, 2);
  assert.equal(contasDoSeletor(contas, "income", "card").length, 2);
});

// ---------------------------------------------------------------------------
// PARA ONDE O BOTAO DE EDITAR LEVA
// ---------------------------------------------------------------------------

test("o tipo sai da coluna quando ela existe", () => {
  assert.equal(
    tipoDoLancamento({ amount: -50, transaction_type: "expense" }),
    "expense"
  );
  assert.equal(
    tipoDoLancamento({ amount: 50, transaction_type: "income" }),
    "income"
  );
});

test("transferencia nao tem tela de edicao: devolve null", () => {
  // A perna de saida de uma transferencia tem a MESMA cara de uma despesa
  // (valor negativo, categoria de despesa). Abri-la na tela de despesa
  // transformaria a perna em despesa e deixaria a outra orfa: o saldo passaria a
  // somar sozinho, e nada apareceria como erro.
  assert.equal(
    tipoDoLancamento({ amount: -1000, transaction_type: "transfer" }),
    null
  );
});

test("linha antiga sem a coluna: a categoria sabe mais que o sinal", () => {
  // Estorno de despesa chega POSITIVO e continua sendo da categoria de despesa.
  // Pelo sinal ele iria para a tela de receita, e o Salvar gravaria a linha como
  // receita -- inflando as duas somas do mes.
  assert.equal(
    tipoDoLancamento({ amount: 80, category: { is_expense: true } }),
    "expense"
  );
  assert.equal(
    tipoDoLancamento({ amount: -80, category: { is_expense: false } }),
    "income"
  );
  // Sem categoria nem coluna, o sinal e o melhor disponivel.
  assert.equal(tipoDoLancamento({ amount: -80 }), "expense");
  assert.equal(tipoDoLancamento({ amount: 80 }), "income");
});

test("a rota de cada tipo", () => {
  assert.equal(rotaDoTipo("income"), "/dashboard/movimentacoes/receita");
  assert.equal(rotaDoTipo("expense"), "/dashboard/movimentacoes/despesa");
});

// ---------------------------------------------------------------------------
// RECEITA FIXA E "POR QUANTOS MESES" (HMO-170)
// ---------------------------------------------------------------------------
// A issue pede que TODAS as movimentacoes possam ser marcadas como fixas, com
// repeticao sem fim ou por um numero de meses. Antes disto o seletor de natureza
// era exclusivo da despesa, e salario -- o exemplo do titulo da issue -- nao
// tinha como ser cadastrado como entrada recorrente.

test("as duas telas oferecem natureza, e so a despesa oferece cartao", () => {
  assert.deepEqual(naturezasDoTipo("expense"), ["one_off", "card", "fixed"]);
  // Receita no cartao entraria na fatura REDUZINDO o que se deve, que e um
  // estorno e nao uma receita.
  assert.deepEqual(naturezasDoTipo("income"), ["one_off", "fixed"]);
});

test("receita fixa mostra o dia do vencimento e a duracao", () => {
  const campos = camposDoTipo("income", "fixed", false);
  assert.equal(campos.natureza, true);
  assert.equal(campos.diaDeVencimento, true);
  assert.equal(campos.duracao, true);
  // O que a receita continua NAO tendo.
  assert.equal(campos.parcelamento, false);
  assert.equal(campos.rateio, false);
});

test("receita pontual nao mostra duracao nem vencimento", () => {
  const campos = camposDoTipo("income", "one_off", false);
  assert.equal(campos.diaDeVencimento, false);
  assert.equal(campos.duracao, false);
});

test("editar nunca mostra a duracao, nos dois tipos", () => {
  // Uma transacao gravada e um lancamento, nao uma regra: a pergunta "por
  // quantos meses?" nao tem resposta sobre ela. Quem muda a serie e a tela de
  // Contas Previstas, com o alcance de `lib/recorrencia-edicao.ts`.
  for (const tipo of ["income", "expense"]) {
    const campos = camposDoTipo(tipo, "fixed", true);
    assert.equal(campos.duracao, false, tipo);
    assert.equal(campos.diaDeVencimento, false, tipo);
  }
});

test("o rotulo da natureza fala do tipo da tela", () => {
  assert.match(camposDoTipo("income", "fixed", false).rotuloDaNatureza, /Receita/);
  assert.match(camposDoTipo("expense", "fixed", false).rotuloDaNatureza, /Despesa/);
});

// ---------------------------------------------------------------------------
// A VALIDACAO DA CONTAGEM DE MESES
// ---------------------------------------------------------------------------

/** Um lancamento fixo valido, para cada caso mexer em um campo so. */
function fixo(tipo, extra = {}) {
  return {
    ...valoresIniciais(),
    descricao: tipo === "income" ? "Salário" : "Aluguel",
    valor: "2500",
    categoriaId: tipo === "income" ? "c2" : "c1",
    data: "2026-09-28",
    natureza: "fixed",
    diaDeVencimento: "10",
    ...extra,
  };
}

const CTX = (tipo) => ({
  categoria: tipo === "income" ? CATEGORIA_RECEITA : CATEGORIA_DESPESA,
  editando: false,
});

test("fixa com repeticao indefinida e valida sem numero de meses", () => {
  for (const tipo of ["income", "expense"]) {
    const v = validarLancamento(tipo, fixo(tipo), CTX(tipo));
    assert.equal(v.ok, true, `${tipo}: ${v.ok ? "" : v.mensagem}`);
  }
});

test("por N meses exige 2 ou mais", () => {
  for (const meses of ["", "0", "1", "abc", "2.5", "-3"]) {
    const v = validarLancamento(
      "expense",
      fixo("expense", { duracao: "contada", mesesDeRepeticao: meses }),
      CTX("expense")
    );
    assert.equal(v.ok, false, `aceitou "${meses}" meses`);
    assert.match(v.mensagem, /meses/i);
  }
});

test("por N meses aceita 2 e o teto", () => {
  for (const meses of ["2", "12", String(MAX_MESES_DE_REPETICAO)]) {
    const v = validarLancamento(
      "income",
      fixo("income", { duracao: "contada", mesesDeRepeticao: meses }),
      CTX("income")
    );
    assert.equal(v.ok, true, `recusou ${meses} meses`);
  }
});

test("acima do teto e recusado, e a recusa aponta a outra opcao", () => {
  const v = validarLancamento(
    "expense",
    fixo("expense", {
      duracao: "contada",
      mesesDeRepeticao: String(MAX_MESES_DE_REPETICAO + 1),
    }),
    CTX("expense")
  );
  assert.equal(v.ok, false);
  assert.match(v.mensagem, /todos os meses/i);
});

test("a contagem NAO e cobrada quando a tela nao mostra o bloco", () => {
  // `mesesDeRepeticao` vive no estado das duas telas. Cobrar sem olhar para
  // `campos.duracao` recusaria um lancamento PONTUAL por causa de um campo que
  // ele nao tem -- e a mensagem falaria de um campo invisivel.
  const v = validarLancamento(
    "expense",
    fixo("expense", { natureza: "one_off", duracao: "contada", mesesDeRepeticao: "1" }),
    CTX("expense")
  );
  assert.equal(v.ok, true, v.ok ? "" : v.mensagem);
});

// ---------------------------------------------------------------------------
// O CORPO QUE VAI PARA /api/recurring-rules
// ---------------------------------------------------------------------------

test("a regra vai com valor POSITIVO nos dois tipos", () => {
  // A migration 005 tem CHECK `amount > 0`: a regra nao tem sinal, quem aplica
  // o sinal de despesa e a baixa da ocorrencia. Um valor negativo aqui seria
  // recusado pelo banco com um 500 sem explicacao na tela.
  const despesa = regraDeRecorrencia("expense", fixo("expense", { valor: "-2500" }));
  assert.equal(despesa.amount, 2500);
  const receita = regraDeRecorrencia("income", fixo("income", { valor: "7000" }));
  assert.equal(receita.amount, 7000);
});

test("transaction_type sai do TIPO DA TELA, nao de um literal", () => {
  // Enquanto isto era `transaction_type: "expense"` escrito na mao, a receita
  // fixa nasceria como GASTO: a agenda cobraria a pessoa pelo proprio salario.
  assert.equal(regraDeRecorrencia("income", fixo("income")).transaction_type, "income");
  assert.equal(regraDeRecorrencia("expense", fixo("expense")).transaction_type, "expense");
});

test("indefinida manda max_occurrences NULL, e nao 0", () => {
  // NULL e "sem fim" na 005. O CHECK e `max_occurrences > 0`, entao um 0 seria
  // recusado pelo banco.
  const corpo = regraDeRecorrencia("expense", fixo("expense"));
  assert.equal(corpo.max_occurrences, null);
});

test("por N meses vira max_occurrences = N", () => {
  const corpo = regraDeRecorrencia(
    "income",
    fixo("income", { duracao: "contada", mesesDeRepeticao: "18" })
  );
  assert.equal(corpo.max_occurrences, 18);
  // A frequencia e mensal: e o que faz "meses" e "ocorrencias" serem a mesma
  // contagem. Se a tela oferecer outra frequencia, os dois se separam.
  assert.equal(corpo.frequency, "monthly");
});

test("o dia do vencimento vai como numero", () => {
  const corpo = regraDeRecorrencia("expense", fixo("expense", { diaDeVencimento: "05" }));
  assert.equal(corpo.due_day, 5);
});

// ---------------------------------------------------------------------------
// PREVISTO x REALIZADO (HMO-188)
// ---------------------------------------------------------------------------
// A pergunta "ja pagou / ja recebeu?" decide em qual TABELA o lancamento cai, e
// essa decisao e a mais caro de errar no app: toda linha de
// `financial_transactions` mexe no saldo da conta no instante do INSERT
// (`update_account_balance_trigger`) e entra no realizado de todo relatorio. Um
// lancamento nao confirmado gravado ali sai gastando dinheiro que nao saiu.

/** Um formulario de previsao valido: sem confirmacao, com data prevista. */
function previsto(extra = {}) {
  return preenchido({
    confirmado: false,
    dataPrevista: "2026-10-10",
    ...extra,
  });
}

test("previsto vai para a agenda; confirmado vira transacao", () => {
  assert.equal(
    destinoDoLancamento("expense", previsto(), false),
    "previsao"
  );
  assert.equal(
    destinoDoLancamento("expense", preenchido(), false),
    "transacao"
  );
  assert.equal(
    destinoDoLancamento("income", previsto(), false),
    "previsao"
  );
});

test("fixa continua virando REGRA, mesmo com a confirmacao desmarcada", () => {
  // A ordem dos ramos e a regra. Posta antes de `regra`, a previsao roubaria a
  // despesa fixa: o aluguel de todo mes viraria uma conta unica de outubro, e a
  // pessoa descobriria em novembro.
  const fixaSemConfirmar = previsto({
    natureza: "fixed",
    diaDeVencimento: "10",
  });
  assert.equal(destinoDoLancamento("expense", fixaSemConfirmar, false), "regra");
  assert.equal(destinoDoLancamento("income", fixaSemConfirmar, false), "regra");
});

test("editar uma transacao gravada nunca vira previsao nova", () => {
  // Sem esta porta o Salvar criaria uma linha em `scheduled_transactions` e
  // DEIXARIA a transacao original no saldo: o gasto contaria duas vezes, uma
  // como realizado e outra como previsto.
  assert.equal(destinoDoLancamento("expense", previsto(), true), "transacao");
});

test("parcelado ganha da previsao, e a validacao recusa o par", () => {
  const parceladoPrevisto = previsto({
    parcelado: true,
    totalDeParcelas: 3,
    valorDaParcela: "50",
  });
  // O ramo de parcelas vem antes: ele ja e um modelo de futuro.
  assert.equal(
    destinoDoLancamento("expense", parceladoPrevisto, false),
    "parcelas"
  );
  // E a recusa e o que impede a checkbox desmarcada de nao fazer nada em
  // silencio. Sem ela a pessoa desmarcaria "ja paguei" e receberia 3 parcelas
  // lancadas como se tivessem sido pagas.
  const v = validarLancamento("expense", parceladoPrevisto, {
    categoria: CATEGORIA_DESPESA,
    editando: false,
  });
  assert.equal(v.ok, false);
  assert.match(v.mensagem, /parcelas futuras/i);
});

test("a conta prevista vai com valor POSITIVO nos dois tipos", () => {
  // `scheduled_transactions.amount` tem CHECK (amount > 0). O valor negativo
  // seria recusado pelo banco com uma mensagem que a tela nao sabe traduzir.
  assert.equal(contaPrevista("expense", previsto()).amount, 100);
  assert.equal(contaPrevista("income", previsto()).amount, 100);

  // COM O MENOS NA FRENTE, que e o caso que prende o `Math.abs`.
  //
  // Medido: sem esta metade, tirar o `Math.abs` sobreviveu ao arquivo inteiro --
  // a fixture so tinha valor positivo, e sobre ela `Math.abs` e no-op. O input
  // aceita "-100" (`valorGravado` documenta o mesmo risco na outra ponta), e
  // uma despesa digitada assim bateria no CHECK do banco.
  assert.equal(contaPrevista("expense", previsto({ valor: "-100" })).amount, 100);
  assert.equal(contaPrevista("income", previsto({ valor: "-100" })).amount, 100);
});

test("transaction_type da conta prevista sai do TIPO DA TELA", () => {
  // A assercao que mais importa deste bloco, e a razao da migration 027. Sem
  // esta coluna a previsao nao guarda direcao e a baixa cai no `?? "expense"`:
  // confirmar o recebimento de uma receita gravaria o valor NEGATIVO, com
  // descricao e categoria certas e nenhum erro.
  assert.equal(contaPrevista("income", previsto()).transaction_type, "income");
  assert.equal(contaPrevista("expense", previsto()).transaction_type, "expense");
});

test("o vencimento da conta prevista sai da data PREVISTA, nao da data real", () => {
  // `data` e o dia em que o dinheiro andou, e numa previsao ele ainda nao andou.
  // Copiar `data` aqui faria toda conta prevista vencer hoje.
  const corpo = contaPrevista("expense", previsto({ data: "2026-09-28" }));
  assert.equal(corpo.due_date, "2026-10-10");
  assert.notEqual(corpo.due_date, "2026-09-28");
});

test("previsto exige a data prevista, e a mensagem fala do tipo", () => {
  const semPrevisao = previsto({ dataPrevista: "" });
  const despesa = validarLancamento("expense", semPrevisao, {
    categoria: CATEGORIA_DESPESA,
    editando: false,
  });
  assert.equal(despesa.ok, false);
  assert.match(despesa.mensagem, /pagamento/i);

  const receita = validarLancamento(
    "income",
    { ...semPrevisao, categoriaId: "c2" },
    { categoria: CATEGORIA_RECEITA, editando: false }
  );
  assert.equal(receita.ok, false);
  assert.match(receita.mensagem, /recebimento/i);
});

test("previsto NAO exige a data real, que a tela esconde", () => {
  // Cobrar `data` num lancamento previsto mandaria a pessoa preencher um campo
  // que nao esta na tela.
  const v = validarLancamento("expense", previsto({ data: "" }), {
    categoria: CATEGORIA_DESPESA,
    editando: false,
  });
  assert.equal(v.ok, true);
});

test("confirmado continua exigindo a data real", () => {
  const v = validarLancamento("expense", preenchido({ data: "" }), {
    categoria: CATEGORIA_DESPESA,
    editando: false,
  });
  assert.equal(v.ok, false);
  assert.match(v.mensagem, /Informe a data/);
});

test("confirmado aceita data prevista vazia, e recusa data prevista pela metade", () => {
  const vazia = validarLancamento("expense", preenchido({ dataPrevista: "" }), {
    categoria: CATEGORIA_DESPESA,
    editando: false,
  });
  assert.equal(vazia.ok, true);

  const quebrada = validarLancamento(
    "expense",
    preenchido({ dataPrevista: "2026-1" }),
    { categoria: CATEGORIA_DESPESA, editando: false }
  );
  assert.equal(quebrada.ok, false);
  assert.match(quebrada.mensagem, /incompleta/i);
});

test("moeda estrangeira NAO pode ficar prevista, e a recusa explica por que", () => {
  // A 026 recusou dar `exchange_rate` a `scheduled_transactions` porque a PTAX
  // de uma data futura nao existe. A consequencia de nao recusar aqui: a baixa
  // insere sem moeda nem cotacao, o banco aplica o DEFAULT (BRL, 1), e US$ 180
  // entram como R$ 180 -- 80% para menos, com o saldo fechando.
  const v = validarLancamento(
    "expense",
    previsto({ moeda: "USD", cotacao: "5.35" }),
    { categoria: CATEGORIA_DESPESA, editando: false }
  );
  assert.equal(v.ok, false);
  assert.match(v.mensagem, /cotação de uma data futura/i);
  // E o CONTROLE POSITIVO: em USD confirmado, com cotacao, ela passa. Sem isto a
  // assercao de cima passaria verde numa versao que recusasse USD sempre.
  const confirmado = validarLancamento(
    "expense",
    preenchido({ moeda: "USD", cotacao: "5.35" }),
    { categoria: CATEGORIA_DESPESA, editando: false }
  );
  assert.equal(confirmado.ok, true);
});

test("a data prevista igual a data real NAO e gravada", () => {
  // NULL em `expected_date` quer dizer "nao havia previsao separada". Gravar a
  // mesma data nas duas colunas faria todo lancamento AFIRMAR que saiu no dia
  // previsto, e um relatorio de atraso sairia com zero atrasos.
  const datas = datasDaTransacao(
    preenchido({ data: "2026-09-28", dataPrevista: "2026-09-28" })
  );
  assert.equal(datas.expected_date, null);
});

test("a data prevista diferente da real e gravada, e launch_date e HOJE", () => {
  const datas = datasDaTransacao(
    preenchido({ data: "2026-09-28", dataPrevista: "2026-09-05" })
  );
  assert.equal(datas.expected_date, "2026-09-05");
  // `launch_date` e o dia em que a pessoa anotou, e nunca a data do lancamento:
  // copiar `data` aqui faria as duas colunas dizerem a mesma coisa e o dado novo
  // nasceria inutil.
  assert.equal(datas.launch_date, hojeISO());
  assert.notEqual(datas.launch_date, "2026-09-28");
});

test("data prevista incompleta nao vira expected_date", () => {
  assert.equal(
    datasDaTransacao(preenchido({ dataPrevista: "2026-1" })).expected_date,
    null
  );
  assert.equal(
    datasDaTransacao(preenchido({ dataPrevista: "" })).expected_date,
    null
  );
});

// ---------------------------------------------------------------------------
// OS CAMPOS QUE A CONFIRMACAO LIGA E DESLIGA
// ---------------------------------------------------------------------------

test("desmarcar a confirmacao esconde a data real e exige a prevista", () => {
  const confirmado = camposDoTipo("expense", "one_off", false, true);
  assert.equal(confirmado.dataDeRealizacao, true);
  assert.equal(confirmado.rotuloDaDataPrevista, "Data prevista");

  const previsto = camposDoTipo("expense", "one_off", false, false);
  assert.equal(previsto.dataDeRealizacao, false);
  assert.equal(previsto.rotuloDaDataPrevista, "Data prevista *");
});

test("o rotulo da confirmacao e do campo de data falam do tipo da tela", () => {
  // "Marcar como paga" numa receita foi o defeito que a issue nomeia: a pessoa
  // confirma que RECEBEU, nao que pagou.
  assert.equal(
    camposDoTipo("income", "one_off", false).rotuloDaConfirmacao,
    "Já recebi"
  );
  assert.equal(
    camposDoTipo("expense", "one_off", false).rotuloDaConfirmacao,
    "Já paguei"
  );
  assert.equal(
    camposDoTipo("income", "one_off", false).rotuloDaData,
    "Data do recebimento"
  );
  assert.equal(
    camposDoTipo("expense", "one_off", false).rotuloDaData,
    "Data do pagamento"
  );
});

test("fixa e edicao nao oferecem a confirmacao, e nao perdem o campo de data", () => {
  // O campo de data de uma despesa fixa e o `start_date` da regra. Um
  // `confirmado: false` parado no estado nao pode apaga-lo.
  const fixa = camposDoTipo("expense", "fixed", false, false);
  assert.equal(fixa.confirmacao, false);
  assert.equal(fixa.dataDeRealizacao, true);
  // E fixa nao mostra data prevista: quem diz quando e o dia do vencimento, e
  // dois campos para a mesma pergunta se contradizem.
  assert.equal(fixa.dataPrevista, false);

  const editando = camposDoTipo("expense", "one_off", true, false);
  assert.equal(editando.confirmacao, false);
  assert.equal(editando.dataDeRealizacao, true);
});

test("camposDoTipo sem o quarto argumento se comporta como confirmado", () => {
  // Compatibilidade com os chamadores anteriores a HMO-188: um default `false`
  // apagaria o campo de data deles sem que nenhum tivesse mudado de linha.
  assert.deepEqual(
    camposDoTipo("expense", "one_off", false),
    camposDoTipo("expense", "one_off", false, true)
  );
});

test("valoresIniciais nasce CONFIRMADO", () => {
  // O caso comum e anotar o que acabou de acontecer. Nascer previsto faria toda
  // despesa lancada sem olhar a checkbox parar na agenda em vez de no saldo.
  assert.equal(valoresIniciais().confirmado, true);
  assert.equal(valoresIniciais().dataPrevista, valoresIniciais().data);
});

// ---------------------------------------------------------------------------
// UM GASTO NO CARTAO JA ACONTECEU (HMO-209)
// ---------------------------------------------------------------------------
// A queixa: a compra no cartao oferecia "Ja paguei", e desmarcada ela ia para
// `scheduled_transactions` com o `account_id` do cartao -- aparecendo em Contas
// a Pagar AO LADO da fatura cheia daquele cartao. A mesma despesa duas vezes.
//
// O que estes casos cobram nao e a checkbox fora da tela: e que NAO EXISTA
// ENTRADA que mande um gasto no cartao para a agenda. Esconder o campo e deixar
// a decisao em `valores.confirmado` produziria exatamente o defeito antigo, so
// que invisivel -- o estado do formulario e um objeto so e `confirmado`
// sobrevive a troca de natureza, entao um `false` herdado de "pontual" ainda
// desviaria o lancamento, agora sem nenhum campo na tela que explicasse por que.

test("gasto no cartao nao pergunta 'ja paguei' nem data prevista", () => {
  const campos = camposDoTipo("expense", "card", false, false);

  assert.equal(campos.confirmacao, false);
  // A data prevista sai: nao ha pagamento a prever. O que ainda nao aconteceu e
  // o pagamento da FATURA, que e outro ato, em outra tela.
  assert.equal(campos.dataPrevista, false);
  // A data da COMPRA fica, e isso e o ponto. Ela rebaixa a divida do cartao
  // agora, e e `transaction_date` que decide em que fatura a compra cai.
  assert.equal(campos.dataDeRealizacao, true);
  assert.equal(campos.rotuloDaData, "Data da compra");

  // E o estado da checkbox nao muda NADA no cartao. Se mudasse, haveria um
  // caminho para a tela de cartao se comportar como a de previsao.
  assert.deepEqual(camposDoTipo("expense", "card", false, true), campos);
});

test("'Data do pagamento' continua sendo o rotulo fora do cartao", () => {
  // Controle do caso acima: um `rotuloDaData` cravado em "Data da compra" para
  // toda despesa passaria no teste anterior e mentiria no aluguel.
  assert.equal(
    camposDoTipo("expense", "one_off", false).rotuloDaData,
    "Data do pagamento"
  );
  assert.equal(
    camposDoTipo("expense", "fixed", false).rotuloDaData,
    "Data"
  );
});

test("a regra do cartao e da DESPESA: a receita nao perde a confirmacao", () => {
  // `natureza: "card"` chega no estado da tela de receita (pelo link de edicao de
  // uma entrada apontada para um cartao). Sem o `tipo === "expense"` na condicao,
  // a tela de receita perderia a checkbox "Ja recebi" e a data prevista: todo
  // salario previsto viraria transacao no ato, entrando no saldo antes de cair.
  const receita = camposDoTipo("income", "card", false, false);
  assert.equal(receita.confirmacao, true);
  assert.equal(receita.dataPrevista, true);
  assert.equal(receita.dataDeRealizacao, false);
});

test("NENHUMA entrada manda um gasto no cartao para a agenda", () => {
  // A negacao explicita, sobre o produto cartesiano das entradas que existem.
  // `destinoDoLancamento` e quem decide a tabela de destino, e e aqui que a trava
  // tem de estar: a UI nao protege o que o estado carrega.
  const combinacoes = [];
  for (const editando of [false, true]) {
    for (const confirmado of [false, true]) {
      for (const parcelado of [false, true]) {
        for (const dataPrevista of ["", "2026-10-10"]) {
          combinacoes.push({ editando, confirmado, parcelado, dataPrevista });
        }
      }
    }
  }
  // O proprio laco pode deixar de varrer: 2 x 2 x 2 x 2.
  assert.equal(combinacoes.length, 16);

  for (const c of combinacoes) {
    const valores = preenchido({
      natureza: "card",
      contaId: "cartao-1",
      confirmado: c.confirmado,
      parcelado: c.parcelado,
      totalDeParcelas: 3,
      valorDaParcela: "50",
      dataPrevista: c.dataPrevista,
    });

    const destino = destinoDoLancamento("expense", valores, c.editando);
    const caso = JSON.stringify(c);

    assert.notEqual(destino, "previsao", `cartao virou previsao em ${caso}`);
    assert.ok(
      destino === "transacao" || destino === "parcelas",
      `cartao foi para ${destino} em ${caso}`
    );
  }
});

test("e a MESMA varredura fora do cartao ainda produz previsao", () => {
  // O controle do caso acima. Sem ele, `destinoDoLancamento` podendo devolver
  // "previsao" para NINGUEM passaria verde -- e a feature inteira (deixar uma
  // despesa prevista, HMO-188) estaria quebrada sem um unico teste vermelho.
  const destinos = new Set();
  for (const confirmado of [false, true]) {
    for (const dataPrevista of ["", "2026-10-10"]) {
      destinos.add(
        destinoDoLancamento(
          "expense",
          preenchido({ natureza: "one_off", confirmado, dataPrevista }),
          false
        )
      );
    }
  }
  assert.ok(destinos.has("previsao"));
  assert.ok(destinos.has("transacao"));
});

test("parcelado no cartao e aceito, e sem mensagem sobre um campo invisivel", () => {
  // Comprar em 12x no cartao e o caso NORMAL, e a compra parcelada ja aconteceu.
  // A recusa "Marque 'Ja paguei' ou desligue o parcelamento" existe para a
  // despesa pontual; no cartao ela mandaria a pessoa a um campo que nao esta na
  // tela, e nao haveria como obedecer.
  const valores = preenchido({
    natureza: "card",
    contaId: "cartao-1",
    confirmado: false,
    parcelado: true,
    totalDeParcelas: 3,
    valorDaParcela: "50",
  });

  const v = validarLancamento("expense", valores, {
    categoria: CATEGORIA_DESPESA,
    editando: false,
  });
  assert.equal(v.ok, true);
  assert.equal(destinoDoLancamento("expense", valores, false), "parcelas");

  // E a recusa continua valendo onde a checkbox EXISTE -- senao desmarcar "Ja
  // paguei" numa despesa parcelada comum voltaria a nao fazer nada em silencio.
  const pontual = validarLancamento(
    "expense",
    preenchido({
      natureza: "one_off",
      confirmado: false,
      parcelado: true,
      totalDeParcelas: 3,
      valorDaParcela: "50",
    }),
    { categoria: CATEGORIA_DESPESA, editando: false }
  );
  assert.equal(pontual.ok, false);
  assert.match(pontual.mensagem, /Já paguei/);
});

test("o cartao nao cobra data prevista, e cobra a data da compra", () => {
  const base = { categoria: CATEGORIA_DESPESA, editando: false };

  // Sem data prevista nenhuma: valido. Cobra-la seria pedir um campo que a tela
  // nao mostra -- o defeito que `camposDoTipo` existe para impedir.
  const semPrevista = validarLancamento(
    "expense",
    preenchido({ natureza: "card", contaId: "cartao-1", dataPrevista: "" }),
    base
  );
  assert.equal(semPrevista.ok, true);

  // A data da compra, por outro lado, e obrigatoria: e ela que decide a fatura.
  const semData = validarLancamento(
    "expense",
    preenchido({ natureza: "card", contaId: "cartao-1", data: "" }),
    base
  );
  assert.equal(semData.ok, false);
  assert.match(semData.mensagem, /data/i);
});
