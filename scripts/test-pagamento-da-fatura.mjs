#!/usr/bin/env node
// =====================================================
// PULODOGATO - pagar a fatura: a decisao e as duas escritas (HMO-310, fase 13)
// =====================================================
//   npm run test:pagamento-da-fatura
//
// Pagar fatura escolhendo a conta pagadora ja funcionava inteiro -- e so
// funcionava DENTRO de `app/(dashboard)/dashboard/bills/page.tsx`, sem lib e sem
// componente. A tela de Despesas (fase 14) teria de reescrever aquilo, e seria a
// segunda implementacao da de-duplicacao de fatura.
//
// O QUE ESTA SUITE EXISTE PARA MEDIR
// ----------------------------------
// Os TRES SABORES de fatura casam em `natureza === "fatura"`. O que separa UMA
// escrita de DUAS e `gravada`:
//
//   1. fatura ABERTA sintetizada   gravada: false  -> close + pay
//   2. fatura FECHADA na agenda    gravada: true   -> so pay
//   3. previsao DIGITADA ligada    gravada: true   -> so pay   (o elo, HMO-305)
//
// Trocar `gravada` por `natureza` no galho do `close` manda o SABOR 3 para o
// `POST /api/card-invoices/close`: a fatura do CARTAO seria fechada porque a
// pessoa pagou a previsao da CONTA CORRENTE -- e o `close` responde 201, sem
// erro em lugar nenhum. O unico sintoma e uma conta a pagar nova no mes
// seguinte.
//
// E POR ISSO QUE OS CASOS DO SABOR 3 SAO O CORACAO DESTE ARQUIVO. Uma suite que
// so olhe a fatura ABERTA passa VERDE com a troca feita -- naquele sabor as duas
// respostas coincidem. `scripts/mutantes-pagamento-da-fatura.mjs` mede
// exatamente isso, e o mutante `galho_por_natureza` e obrigatorio.
//
// O 409 DO `close` NAO E ERRO
// ---------------------------
// "Esta fatura ja foi fechada" vem com `scheduled_transaction_id`, e e o que
// acontece quando outra aba fechou a fatura no meio. O caminho tem de SEGUIR
// para o `/pay` com aquele id. Os OUTROS 409 do `close` ("esta fatura nao tem
// lancamentos", "nao tem valor a pagar") nao trazem o id e sao erro de verdade:
// distinguir os dois pelo campo, e nao pelo status, e a razao de a sequencia
// morar na lib com a rede injetada -- num teste de componente este ramo e
// inalcancavel.
//
// O QUE ESTA SUITE *NAO* PROVA, DITO EM VOZ ALTA
// ----------------------------------------------
// Que a TELA continua pagando. Teste de componente (e, mais ainda, teste de
// funcao pura) passa verde com o Salvar quebrado. A prova de que Contas a Pagar
// nao mudou e uma escrita de verdade, medindo `current_balance` da conta
// pagadora ANTES -> DEPOIS; ela esta no comentario da issue. A fiacao textual
// (a frase do patrimonio no toast, o motivo escrito no botao) e
// `npm run check-pagamento-da-fatura`.
//
// OS DOIS FUSOS: o npm script roda a suite em America/Sao_Paulo e em UTC. O
// `mes` da chave e `mesDoClose` sao fatia de string e nao deveriam depender do
// relogio -- rodar nos dois e o que prova que nao passaram a depender.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  AVISO_DA_FATURA_ABERTA,
  ERRO_AO_FECHAR,
  ERRO_AO_PAGAR,
  FRASE_DO_PATRIMONIO,
  FRASE_DO_PATRIMONIO_NO_DIALOGO,
  MOTIVO_SEM_CONTA_PAGADORA,
  SEM_CONTA_PAGADORA_CADASTRADA,
  contasQuePodemPagar,
  decisaoDePagamentoDaFatura,
  linhaParaPagarDaAgenda,
  pagarAFatura,
} = await import("../.tmp-pagamento-da-fatura/pagamento-da-fatura.js");

// A MENSAGEM DA RECUSA E IMPORTADA DA ROTA, NUNCA ESCRITA AQUI. Ver o caso
// "o motivo escrito e a recusa da propria rota".
const { chaveFatura, mensagemContaPagadora } = await import(
  "../.tmp-pagamento-da-fatura/card-invoice.js"
);

// -----------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------

const CARTAO = "11111111-1111-4111-8111-111111111111";
const CORRENTE = "22222222-2222-4222-8222-222222222222";
const MES = "2026-10-01";
const CHAVE = chaveFatura(MES, CARTAO);
const ID_DA_FECHADA = "33333333-3333-4333-8333-333333333333";
const ID_DA_PREVISAO = "44444444-4444-4444-8444-444444444444";
const HOJE = "2026-10-10";

/** SABOR 1: a fatura ABERTA sintetizada. Nao existe em tabela nenhuma. */
const faturaAberta = () => ({
  id: null,
  description: "Fatura Nubank 10/2026",
  gravada: false,
  natureza: "fatura",
  fatura: { accountId: CARTAO, mes: MES },
});

/** SABOR 2: a fatura FECHADA -- `account_id` e o proprio cartao. */
const faturaFechada = () => ({
  id: ID_DA_FECHADA,
  description: "Fatura Nubank 10/2026",
  gravada: true,
  natureza: "fatura",
  fatura: { accountId: CARTAO, mes: MES },
});

/**
 * SABOR 3: a previsao DIGITADA que a pessoa ligou a fatura (HMO-305).
 *
 * E indistinguivel do sabor 2 nos tres campos da decisao, e tem de ser: as duas
 * sao uma escrita so. O que as diferencia e `account_id` (ali o cartao, aqui a
 * conta corrente), e a decisao nao le `account_id` -- quem le e o `/pay`, que
 * tira o cartao da CHAVE.
 */
const previsaoLigada = () => ({
  id: ID_DA_PREVISAO,
  description: "Pagar fatura Nubank",
  gravada: true,
  natureza: "fatura",
  fatura: { accountId: CARTAO, mes: MES },
});

/** Uma conta a pagar comum -- a de luz. */
const contaDeLuz = () => ({
  id: "55555555-5555-4555-8555-555555555555",
  description: "Luz",
  gravada: true,
  natureza: "despesa",
  fatura: null,
});

/**
 * A rede falsa: grava as chamadas na ORDEM e devolve as respostas em fila.
 *
 * `ok` e DERIVADO do status, como no `fetch` de verdade. Deixa-lo entrar como
 * campo do fixture permitiria escrever um caso com `ok: true, status: 409` --
 * que nao existe -- e o teste do 409 mediria uma situacao impossivel.
 */
function redeFalsa(respostas) {
  const chamadas = [];
  const fila = [...respostas];
  const rede = async (url, init) => {
    chamadas.push({
      url,
      method: init.method,
      corpo: JSON.parse(init.body),
    });
    if (fila.length === 0) {
      throw new Error(`chamada de rede inesperada: ${init.method} ${url}`);
    }
    const r = fila.shift();
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
    };
  };
  return { rede, chamadas };
}

const URL_DO_CLOSE = "/api/card-invoices/close";
const urlDoPay = (id) => `/api/scheduled-transactions/${id}/pay`;

// =================================================================
// (a) PRECISA DE CONTA PAGADORA? -- os tres sabores respondem SIM
// =================================================================

test("os tres sabores de fatura precisam de conta pagadora", () => {
  for (const [nome, linha] of [
    ["aberta sintetizada", faturaAberta()],
    ["fechada na agenda", faturaFechada()],
    ["previsao ligada ao elo", previsaoLigada()],
  ]) {
    assert.equal(
      decisaoDePagamentoDaFatura(linha).precisaDeContaPagadora,
      true,
      `${nome}: sem conta pagadora o /pay responde 400`
    );
  }
});

test("a conta comum NAO pede conta pagadora", () => {
  const d = decisaoDePagamentoDaFatura(contaDeLuz());
  assert.equal(d.precisaDeContaPagadora, false);
  assert.equal(d.faturaParaFechar, null);
});

test("a conta de regra FIXA nao pede conta pagadora nem close", () => {
  const d = decisaoDePagamentoDaFatura({
    id: "66666666-6666-4666-8666-666666666666",
    gravada: true,
    natureza: "fixa",
    fatura: null,
  });
  assert.equal(d.precisaDeContaPagadora, false);
  assert.equal(d.faturaParaFechar, null);
});

// =================================================================
// (b) PRECISA DE `close`? -- SO a aberta. Este e o galho do mutante.
// =================================================================

test("SO a fatura aberta leva close, e ele vai com o mes da FATURA", () => {
  const d = decisaoDePagamentoDaFatura(faturaAberta());
  assert.deepEqual(d.faturaParaFechar, {
    accountId: CARTAO,
    // 'AAAA-MM', nunca 'AAAA-MM-01': e o que o `close` aceita.
    mesDoClose: "2026-10",
  });
});

test("a fatura FECHADA nao leva close -- ela ja e a linha da agenda", () => {
  assert.equal(decisaoDePagamentoDaFatura(faturaFechada()).faturaParaFechar, null);
});

test(
  "A PREVISAO LIGADA AO ELO NAO LEVA CLOSE -- o caso que mata o mutante " +
    "`gravada` -> `natureza`",
  () => {
    // Ela e `natureza: "fatura"` E `gravada: true`. Um galho por `natureza`
    // mandaria esta linha para o `close` e FECHARIA A FATURA DO CARTAO porque a
    // pessoa pagou a previsao da conta corrente -- 201, sem erro, com uma conta
    // a pagar nova aparecendo no mes seguinte.
    const d = decisaoDePagamentoDaFatura(previsaoLigada());
    assert.equal(
      d.faturaParaFechar,
      null,
      "a previsao ligada e UMA escrita: fechar aqui cria uma fatura que ninguem pediu"
    );
    // E ela continua precisando da conta pagadora: o `/pay` cai em
    // `pagarFatura` pelos tres sabores.
    assert.equal(d.precisaDeContaPagadora, true);
  }
);

test("fatura aberta SEM a chave na linha nao produz close (estado impossivel)", () => {
  // `natureza: "fatura"` com `fatura: null` nao nasce de nenhuma leitura -- as
  // duas saem da MESMA chave. Se nascesse, a resposta segura e nao fechar: um
  // `close` sem cartao e sem mes nao tem o que mandar.
  const d = decisaoDePagamentoDaFatura({
    id: null,
    gravada: false,
    natureza: "fatura",
    fatura: null,
  });
  assert.equal(d.faturaParaFechar, null);
});

// =================================================================
// A LINHA CRUA DE CONTAS A PAGAR -> a forma que a decisao le
// =================================================================

test("a fatura sintetizada crua (id nulo + chave em notes) vira o sabor 1", () => {
  const l = linhaParaPagarDaAgenda({ id: null, notes: CHAVE });
  assert.deepEqual(l, {
    gravada: false,
    natureza: "fatura",
    fatura: { accountId: CARTAO, mes: MES },
  });
});

test("a fatura fechada crua vira o sabor 2", () => {
  const l = linhaParaPagarDaAgenda({ id: ID_DA_FECHADA, notes: CHAVE });
  assert.equal(l.gravada, true);
  assert.equal(l.natureza, "fatura");
  assert.deepEqual(l.fatura, { accountId: CARTAO, mes: MES });
});

test("a previsao ligada crua vira o sabor 3 -- e e igual ao 2 aqui", () => {
  // Igualdade proposital: as duas sao UMA escrita. Ver `previsaoLigada`.
  assert.deepEqual(
    linhaParaPagarDaAgenda({ id: ID_DA_PREVISAO, notes: CHAVE }),
    linhaParaPagarDaAgenda({ id: ID_DA_FECHADA, notes: CHAVE })
  );
});

test("a conta de regra fixa crua e `fixa`, e a avulsa e `despesa`", () => {
  assert.equal(
    linhaParaPagarDaAgenda({
      id: "x1",
      notes: "aluguel do mes",
      recurring_rule_id: "r-1",
    }).natureza,
    "fixa"
  );
  assert.equal(
    linhaParaPagarDaAgenda({ id: "x2", notes: null }).natureza,
    "despesa"
  );
});

test("FATURA PRIMEIRO, FIXA DEPOIS -- a ordem de `linhasDaTela`", () => {
  // Se a fatura fechada um dia nascer de uma regra recorrente, os dois criterios
  // casam na mesma linha. Chama-la de "fixa" tiraria dela a conta pagadora e o
  // `/pay` responderia 400.
  const l = linhaParaPagarDaAgenda({
    id: ID_DA_FECHADA,
    notes: CHAVE,
    recurring_rule_id: "r-1",
  });
  assert.equal(l.natureza, "fatura");
});

test("notes com texto livre que PARECE chave nao e fatura", () => {
  // `RE_CHAVE_FATURA` e ancorada nas duas pontas de proposito: sem isso a
  // anotacao da pessoa viraria regra de negocio.
  const l = linhaParaPagarDaAgenda({
    id: "x3",
    notes: `${CHAVE} paguei no debito`,
  });
  assert.equal(l.natureza, "despesa");
  assert.equal(l.fatura, null);
});

test("`id: \"\"` nao e linha gravada", () => {
  // Um mock produz isso sem esforco, e `gravada: true` com id vazio montaria
  // `/api/scheduled-transactions//pay`.
  assert.equal(linhaParaPagarDaAgenda({ id: "", notes: CHAVE }).gravada, false);
});

// =================================================================
// A SEQUENCIA DAS ESCRITAS
// =================================================================

test("a fatura ABERTA faz DUAS escritas, close primeiro e pay depois", async () => {
  const { rede, chamadas } = redeFalsa([
    { status: 201, body: { scheduled_transaction: { id: ID_DA_FECHADA } } },
    { status: 200, body: { message: "Fatura paga com Itaú", is_transfer: true } },
  ]);

  const r = await pagarAFatura({
    linha: faturaAberta(),
    contaPagadoraId: CORRENTE,
    pagoEm: HOJE,
    rede,
  });

  assert.equal(r.ok, true);
  assert.equal(chamadas.length, 2);

  // A ORDEM. Invertida, o `/pay` receberia o id da fatura aberta -- que nao
  // existe -- e responderia 404.
  assert.equal(chamadas[0].url, URL_DO_CLOSE);
  assert.deepEqual(chamadas[0].corpo, { account_id: CARTAO, month: "2026-10" });

  // O id do `/pay` e o que o `close` acabou de criar, e nao o `id` da linha
  // (que e nulo).
  assert.equal(chamadas[1].url, urlDoPay(ID_DA_FECHADA));
  assert.deepEqual(chamadas[1].corpo, {
    paid_date: HOJE,
    payment_account_id: CORRENTE,
  });
});

test("a fatura FECHADA faz UMA escrita: nada de close", async () => {
  const { rede, chamadas } = redeFalsa([
    { status: 200, body: { message: "Fatura paga com Itaú", is_transfer: true } },
  ]);

  const r = await pagarAFatura({
    linha: faturaFechada(),
    contaPagadoraId: CORRENTE,
    pagoEm: HOJE,
    rede,
  });

  assert.equal(r.ok, true);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, urlDoPay(ID_DA_FECHADA));
  assert.equal(
    chamadas.some((c) => c.url === URL_DO_CLOSE),
    false
  );
});

test(
  "A PREVISAO LIGADA FAZ UMA ESCRITA, NO ID DELA -- o segundo caso que mata o " +
    "mutante `gravada` -> `natureza`",
  async () => {
    const { rede, chamadas } = redeFalsa([
      {
        status: 200,
        body: { message: "Fatura paga com Itaú", is_transfer: true },
      },
    ]);

    const r = await pagarAFatura({
      linha: previsaoLigada(),
      contaPagadoraId: CORRENTE,
      pagoEm: HOJE,
      rede,
    });

    assert.equal(r.ok, true);
    // ZERO chamadas ao `close`. Com o galho por `natureza` haveria uma, e ela
    // criaria a conta a pagar da fatura do cartao sem ninguem ter pedido.
    assert.equal(
      chamadas.filter((c) => c.url === URL_DO_CLOSE).length,
      0,
      "fechar a fatura do cartao aqui e a duplicacao silenciosa que a fase 13 existe para nao herdar"
    );
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0].url, urlDoPay(ID_DA_PREVISAO));
  }
);

test("o 409 'ja foi fechada' NAO e erro: segue para o /pay com o id dele", async () => {
  const ID_DA_OUTRA_ABA = "77777777-7777-4777-8777-777777777777";
  const { rede, chamadas } = redeFalsa([
    {
      status: 409,
      body: {
        error: "Esta fatura já foi fechada",
        scheduled_transaction_id: ID_DA_OUTRA_ABA,
      },
    },
    { status: 200, body: { message: "Fatura paga com Itaú", is_transfer: true } },
  ]);

  const r = await pagarAFatura({
    linha: faturaAberta(),
    contaPagadoraId: CORRENTE,
    pagoEm: HOJE,
    rede,
  });

  assert.equal(r.ok, true, "mostrar o erro mandaria a pessoa refazer o que ja esta feito");
  assert.equal(chamadas.length, 2);
  assert.equal(chamadas[1].url, urlDoPay(ID_DA_OUTRA_ABA));
});

test("o 409 SEM `scheduled_transaction_id` e erro, e o /pay nao acontece", async () => {
  // "Esta fatura nao tem lancamentos" / "nao tem valor a pagar": mesmo status,
  // sem o id. Distinguir pelo STATUS so deixaria a sequencia seguir para um
  // `/pay` com id nulo.
  const { rede, chamadas } = redeFalsa([
    { status: 409, body: { error: "Esta fatura não tem lançamentos" } },
  ]);

  const r = await pagarAFatura({
    linha: faturaAberta(),
    contaPagadoraId: CORRENTE,
    pagoEm: HOJE,
    rede,
  });

  assert.equal(r.ok, false);
  assert.equal(r.etapa, "close");
  assert.equal(r.erro, "Esta fatura não tem lançamentos");
  assert.equal(chamadas.length, 1, "nenhuma fatura meio-paga");
});

test("close que falha sem texto proprio cai na frase do app", async () => {
  const { rede, chamadas } = redeFalsa([{ status: 500, body: {} }]);
  const r = await pagarAFatura({
    linha: faturaAberta(),
    contaPagadoraId: CORRENTE,
    pagoEm: HOJE,
    rede,
  });
  assert.equal(r.ok, false);
  assert.equal(r.etapa, "close");
  assert.equal(r.erro, ERRO_AO_FECHAR);
  assert.equal(chamadas.length, 1);
});

test("o 400 do /pay volta com a mensagem da rota", async () => {
  const { rede } = redeFalsa([
    { status: 400, body: { error: mensagemContaPagadora("outro_cartao") } },
  ]);
  const r = await pagarAFatura({
    linha: faturaFechada(),
    contaPagadoraId: CARTAO,
    pagoEm: HOJE,
    rede,
  });
  assert.equal(r.ok, false);
  assert.equal(r.etapa, "pay");
  assert.equal(r.erro, mensagemContaPagadora("outro_cartao"));
});

test("/pay que falha sem texto proprio cai na frase do app", async () => {
  const { rede } = redeFalsa([{ status: 500, body: {} }]);
  const r = await pagarAFatura({
    linha: faturaFechada(),
    contaPagadoraId: CORRENTE,
    pagoEm: HOJE,
    rede,
  });
  assert.equal(r.ok, false);
  assert.equal(r.erro, ERRO_AO_PAGAR);
});

test("sem conta pagadora a sequencia recusa ANTES da rede", async () => {
  const { rede, chamadas } = redeFalsa([]);
  const r = await pagarAFatura({
    linha: faturaAberta(),
    contaPagadoraId: "",
    pagoEm: HOJE,
    rede,
  });
  assert.equal(r.ok, false);
  assert.equal(r.etapa, "decisao");
  assert.equal(r.erro, MOTIVO_SEM_CONTA_PAGADORA);
  // ZERO chamadas: fechar a fatura e depois descobrir que falta a conta
  // pagadora deixaria uma fatura fechada e nao paga para tras -- e fechar nao
  // e reversivel pela tela.
  assert.equal(chamadas.length, 0);
});

test("linha sem id e sem chave nao chega a montar URL", async () => {
  // O estado impossivel do lado da ESCRITA: `gravada: false` sem `fatura` nao
  // tem id para o `/pay` nem cartao para o `close`. Sem a guarda, a sequencia
  // montaria `/api/scheduled-transactions/null/pay` -- 404, que para quem
  // clicou se le como "o app nao conseguiu".
  const { rede, chamadas } = redeFalsa([]);
  const r = await pagarAFatura({
    linha: { id: null, gravada: false, natureza: "fatura", fatura: null },
    contaPagadoraId: CORRENTE,
    pagoEm: HOJE,
    rede,
  });
  assert.equal(r.ok, false);
  assert.equal(r.etapa, "decisao");
  assert.equal(chamadas.length, 0);
});

test("o toast de sucesso leva A FRASE DO PATRIMONIO", async () => {
  const { rede } = redeFalsa([
    { status: 200, body: { message: "Fatura paga com Itaú", is_transfer: true } },
  ]);
  const r = await pagarAFatura({
    linha: faturaFechada(),
    contaPagadoraId: CORRENTE,
    pagoEm: HOJE,
    rede,
  });
  assert.equal(r.ok, true);
  assert.equal(r.mensagem, "Fatura paga com Itaú");
  assert.equal(
    r.descricao,
    FRASE_DO_PATRIMONIO,
    "quem paga R$ 1.000 e ve o patrimonio parado conclui que a tela nao registrou -- e paga de novo"
  );
});

test("a frase do patrimonio sai TAMBEM quando a rota nao manda is_transfer", async () => {
  // A rota sempre manda (`pagarFatura` termina em `is_transfer: true`).
  // Condicionar a frase ao campo criaria um jeito silencioso de ela
  // desaparecer, e e justamente ela que evita o pagamento em dobro.
  const { rede } = redeFalsa([
    { status: 200, body: { message: "Fatura paga com Itaú" } },
  ]);
  const r = await pagarAFatura({
    linha: faturaFechada(),
    contaPagadoraId: CORRENTE,
    pagoEm: HOJE,
    rede,
  });
  assert.equal(r.descricao, FRASE_DO_PATRIMONIO);
});

// =================================================================
// AS FRASES
// =================================================================

test("o motivo escrito do botao e a recusa da PROPRIA rota", () => {
  // IMPORTADA, nao escrita a mao: o dia em que a rota mudar a recusa, o dialogo
  // tem de mudar com ela. Uma copia literal aqui prometeria uma coisa na tela e
  // a rota recusaria outra.
  assert.equal(MOTIVO_SEM_CONTA_PAGADORA, mensagemContaPagadora("ausente"));
  assert.equal(
    MOTIVO_SEM_CONTA_PAGADORA,
    "Escolha de qual conta o dinheiro da fatura saiu"
  );
});

test("as frases do patrimonio dizem que o patrimonio NAO muda", () => {
  // O conteudo, nao o comprimento: uma frase que perdesse essa parte deixaria o
  // toast dizendo so "pago", que e o que havia antes do HMO-149.
  assert.match(FRASE_DO_PATRIMONIO, /patrimônio não muda/);
  assert.match(FRASE_DO_PATRIMONIO_NO_DIALOGO, /patrimônio fica igual/);
  assert.match(FRASE_DO_PATRIMONIO_NO_DIALOGO, /não é um gasto novo/);
});

test("o aviso da fatura aberta diz que o valor de HOJE e o que fica", () => {
  assert.match(AVISO_DA_FATURA_ABERTA, /em aberto/);
  assert.match(AVISO_DA_FATURA_ABERTA, /total de hoje/);
});

test("a frase de nenhuma conta pagadora explica POR QUE o cartao nao serve", () => {
  assert.match(SEM_CONTA_PAGADORA_CADASTRADA, /cartão de crédito não paga cartão/);
});

// =================================================================
// QUEM PODE PAGAR A FATURA
// =================================================================

test("cartao de credito nunca entra no seletor de conta pagadora", () => {
  const contas = [
    { id: "a", name: "Itaú", account_type: "checking" },
    { id: "b", name: "Nubank", account_type: "credit_card" },
    { id: "c", name: "Carteira", account_type: "cash" },
    { id: "d", name: "Poupança", account_type: "savings" },
  ];
  assert.deepEqual(
    contasQuePodemPagar(contas).map((c) => c.id),
    ["a", "c", "d"]
  );
});

test("conta ARQUIVADA nao e recusada pelo seletor", () => {
  // Quem quita a fatura de um cartao que fechou costuma pagar pela conta que
  // fechou junto. `validarContaPagadora` tambem a aceita, e recusar aqui
  // deixaria a pessoa sem caminho nenhum para registrar um pagamento que
  // aconteceu de verdade.
  const contas = [{ id: "a", name: "Itaú velho", account_type: "checking", is_active: false }];
  assert.equal(contasQuePodemPagar(contas).length, 1);
});

test("conta sem `account_type` legivel nao e descartada", () => {
  // Embed nulo pela RLS, coluna fora do `select`: "nao sei" nao e "e cartao".
  // Esconder no "nao sei" tiraria do seletor a unica conta da pessoa, e a
  // API ainda recusa o cartao de verdade.
  assert.equal(contasQuePodemPagar([{ id: "a", name: "?" }]).length, 1);
});
