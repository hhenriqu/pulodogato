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
  FATURA_SEM_VENCIMENTO_NAO_TEM_PAGAR,
  FRASE_DO_PATRIMONIO,
  FRASE_DO_PATRIMONIO_NO_DIALOGO,
  MOTIVO_SEM_CONTA_PAGADORA,
  SEM_CONTA_PAGADORA_CADASTRADA,
  contasQuePodemPagar,
  decisaoDePagamentoDaFatura,
  linhaParaPagarDaAgenda,
  linhaParaPagarDaTela,
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
// A LINHA DA TELA DE DESPESAS -> a forma que a decisao le (HMO-311)
// =================================================================
// `linhaParaPagarDaTela` e a irma de `linhaParaPagarDaAgenda`, para a OUTRA
// tela -- e ela existe por um motivo que decide dinheiro: nas telas de
// movimentacao `LinhaDaTela.id` e SEMPRE string, e na fatura ABERTA ele e a
// CHAVE SINTETICA (`linhasDaTela` precisa de chave estavel para o React).
//
// Passar a linha crua faria `pagarAFatura` usar aquela chave como id de banco.

test("a fatura ABERTA da tela perde o id: a chave sintetica NAO e id de banco", () => {
  // O BLOCO QUE IMPORTA. Com `id` passando reto, o caminho monta
  // `POST /api/scheduled-transactions/fatura:2026-10-01:<uuid>/pay` em todo
  // ramo onde o `close` nao sobrescrever o id -- 404, que para quem clicou se le
  // como "o app nao conseguiu".
  const chaveSintetica = `fatura:${MES}:${CARTAO}`;
  const l = linhaParaPagarDaTela({
    id: chaveSintetica,
    gravada: false,
    natureza: "fatura",
    fatura: { accountId: CARTAO, mes: MES },
    descricao: "Fatura Nubank",
  });

  assert.equal(l.id, null, `a chave sintetica virou id: ${l.id}`);
  assert.equal(l.gravada, false);
  assert.equal(l.natureza, "fatura");
  assert.deepEqual(l.fatura, { accountId: CARTAO, mes: MES });
  assert.equal(l.description, "Fatura Nubank");

  // E o resultado e exatamente o sabor 1 que a decisao ja conhece.
  assert.deepEqual(decisaoDePagamentoDaFatura(l), {
    precisaDeContaPagadora: true,
    faturaParaFechar: { accountId: CARTAO, mesDoClose: "2026-10" },
  });
});

test("a fatura GRAVADA da tela MANTEM o id -- senao nao haveria o que pagar", () => {
  // O par do bloco acima. Sem ele, um `id: null` incondicional passaria no
  // primeiro e a fatura FECHADA cairia em `ERRO_AO_FECHAR` sem rede nenhuma: a
  // tela diria "Não foi possível registrar a fatura" sobre uma fatura que ja
  // esta registrada.
  const l = linhaParaPagarDaTela({
    id: ID_DA_FECHADA,
    gravada: true,
    natureza: "fatura",
    fatura: { accountId: CARTAO, mes: MES },
    descricao: "Fatura Nubank 10/2026",
  });

  assert.equal(l.id, ID_DA_FECHADA);
  assert.equal(decisaoDePagamentoDaFatura(l).faturaParaFechar, null);
});

test("`gravada` E o criterio, e NAO o prefixo `fatura:` do id", () => {
  // Duas definicoes de "esta linha existe no banco" divergiriam no dia em que a
  // chave mudasse de forma. Uma linha gravada cujo id POR ACASO comece com
  // `fatura:` tem de manter o id; uma nao-gravada com id de aparencia normal tem
  // de perde-lo. Os dois casos separam os dois criterios.
  assert.equal(
    linhaParaPagarDaTela({
      id: "fatura:parece-chave",
      gravada: true,
      natureza: "fatura",
      fatura: { accountId: CARTAO, mes: MES },
    }).id,
    "fatura:parece-chave"
  );
  assert.equal(
    linhaParaPagarDaTela({
      id: ID_DA_FECHADA,
      gravada: false,
      natureza: "fatura",
      fatura: { accountId: CARTAO, mes: MES },
    }).id,
    null
  );
});

test("descricao ausente vira `null`, e nao a string 'undefined'", () => {
  // O dialogo escreve `linha.description` em cima do valor. `undefined` num
  // template viraria "undefined" escrito na tela, em cima de um numero certo.
  const l = linhaParaPagarDaTela({
    id: ID_DA_FECHADA,
    gravada: true,
    natureza: "fatura",
    fatura: null,
  });
  assert.equal(l.description, null);
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

test("a frase da fatura SEM VENCIMENTO diz que nao tem botao E qual e o caminho", () => {
  // AS DUAS METADES SAO OBRIGATORIAS (HMO-311). Desde esta fase a fatura NA
  // LISTA tem "Pagar", e esta -- que vem num bloco a parte com so
  // `{ account_name, total }`, sem id e sem `accountId` -- nao tem. Dizer so que
  // ela esta fora do Previsto deixa "a do Nubank tem botão e a do C6 não" se ler
  // como tela quebrada, e a reacao e recarregar a pagina.
  //
  // A SEGUNDA metade e o que transforma a ausencia em instrucao: o caminho dela
  // e cadastrar o dia de vencimento do cartao.
  assert.match(FATURA_SEM_VENCIMENTO_NAO_TEM_PAGAR, /não tem o botão Pagar/);
  assert.match(FATURA_SEM_VENCIMENTO_NAO_TEM_PAGAR, /dia de vencimento/);
  assert.match(FATURA_SEM_VENCIMENTO_NAO_TEM_PAGAR, /passa a aparecer na lista/);
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

// =================================================================
// PAGAMENTO PARCIAL, COM O RESTANTE NA PROXIMA FATURA (como no Minhas Financas)
// =================================================================
// Os numeros sao os do teste feito no Minhas Financas em 06/11/2026: fatura de
// novembro de R$ 500, pagamento de R$ 200, restante de R$ 300 em dezembro.

const {
  CATEGORIAS_DO_PAGAMENTO_PARCIAL,
  categoriaDoPapel,
  chaveEncargo,
  chaveRestante,
  mesSeguinteDaFatura,
  planoDoPagamentoParcial,
  valorDigitado,
} = await import("../.tmp-pagamento-da-fatura/pagamento-parcial-da-fatura.js");

const PARCIAL = {
  totalDaFatura: 500,
  valorPago: 200,
  levarRestante: true,
  mes: "2026-11-01",
  cartaoId: CARTAO,
  pagoEm: "2026-11-23",
};

test("parcial: R$ 200 de R$ 500 leva R$ 300 para a fatura seguinte", () => {
  const plano = planoDoPagamentoParcial(PARCIAL);
  assert.equal(plano.ok, true);
  assert.equal(plano.restante, 300);
  assert.equal(plano.linhas.length, 2);

  const [credito, restante] = plano.linhas;
  // Credito na fatura PAGA: ela fecha em R$ 200 (500 - 300).
  assert.equal(credito.papel, "credito-do-restante");
  assert.equal(credito.amount, 300);
  assert.equal(credito.transaction_type, "income");
  assert.equal(credito.invoice_month_override, "2026-11-01");
  // Divida na fatura SEGUINTE.
  assert.equal(restante.papel, "restante");
  assert.equal(restante.amount, -300);
  assert.equal(restante.transaction_type, "expense");
  assert.equal(restante.invoice_month_override, "2026-12-01");
  // As duas se anulam no saldo do cartao: o "Em aberto" so muda pela
  // transferencia do pagamento (900 -> 700 no Minhas Financas).
  assert.equal(credito.amount + restante.amount, 0);
  // E nenhuma conta nos totais: nao e receita nem despesa.
  assert.equal(credito.include_in_total, false);
  assert.equal(restante.include_in_total, false);
  // A chave liga as duas a fatura paga, para o estorno.
  assert.equal(credito.notes, chaveRestante("2026-11-01", CARTAO));
  assert.equal(restante.notes, credito.notes);
  for (const linha of plano.linhas) {
    assert.equal(linha.account_id, CARTAO);
    assert.equal(linha.transaction_date, "2026-11-23");
  }
});

test("parcial sem pedir para levar o restante: nenhuma linha (o de antes)", () => {
  const plano = planoDoPagamentoParcial({ ...PARCIAL, levarRestante: false });
  assert.equal(plano.ok, true);
  assert.equal(plano.restante, 300);
  assert.deepEqual(plano.linhas, []);
});

test("pagou o total, ou mais: nada a levar", () => {
  for (const valorPago of [500, 600]) {
    const plano = planoDoPagamentoParcial({ ...PARCIAL, valorPago });
    assert.equal(plano.ok, true);
    assert.equal(plano.restante, 0);
    assert.deepEqual(plano.linhas, []);
  }
});

test("o restante e conta em centavos, sem resto de ponto flutuante", () => {
  const plano = planoDoPagamentoParcial({
    ...PARCIAL,
    totalDaFatura: 0.3,
    valorPago: 0.1,
  });
  assert.equal(plano.restante, 0.2);
  assert.equal(plano.linhas[1].amount, -0.2);
});

test("encargo e despesa de verdade na fatura seguinte, e conta nos totais", () => {
  const plano = planoDoPagamentoParcial({ ...PARCIAL, encargo: 12.34 });
  assert.equal(plano.linhas.length, 3);
  const encargo = plano.linhas[2];
  assert.equal(encargo.papel, "encargo");
  assert.equal(encargo.amount, -12.34);
  assert.equal(encargo.transaction_type, "expense");
  assert.equal(encargo.invoice_month_override, "2026-12-01");
  assert.equal(encargo.include_in_total, true);
  assert.equal(encargo.notes, chaveEncargo("2026-11-01", CARTAO));
  assert.notEqual(encargo.notes, chaveRestante("2026-11-01", CARTAO));
});

test("encargo sem restante tambem vale (pagou tudo com juros)", () => {
  const plano = planoDoPagamentoParcial({
    ...PARCIAL,
    valorPago: 500,
    encargo: 5,
  });
  assert.deepEqual(
    plano.linhas.map((l) => l.papel),
    ["encargo"]
  );
});

test("encargo negativo ou ilegivel e recusado antes de qualquer escrita", () => {
  for (const encargo of [-1, Number.NaN, Infinity]) {
    const plano = planoDoPagamentoParcial({ ...PARCIAL, encargo });
    assert.equal(plano.ok, false);
  }
});

test("fatura de dezembro leva o restante para janeiro do ano seguinte", () => {
  const plano = planoDoPagamentoParcial({ ...PARCIAL, mes: "2026-12-01" });
  assert.equal(plano.linhas[1].invoice_month_override, "2027-01-01");
  assert.equal(mesSeguinteDaFatura("2026-12"), "2027-01-01");
  assert.equal(mesSeguinteDaFatura("2026-13"), null);
});

test("mes ou data ilegivel: recusa, nunca grava num mes inventado", () => {
  assert.equal(planoDoPagamentoParcial({ ...PARCIAL, mes: "nov" }).ok, false);
  assert.equal(planoDoPagamentoParcial({ ...PARCIAL, pagoEm: "23/11" }).ok, false);
  assert.equal(planoDoPagamentoParcial({ ...PARCIAL, cartaoId: "" }).ok, false);
});

test("o restante nao usa a categoria do ajuste de saldo", () => {
  // A tela do cartao reconhece o ajuste pela categoria: dividir a categoria
  // faria o restante ser lido como ajuste.
  assert.notEqual(CATEGORIAS_DO_PAGAMENTO_PARCIAL.restante.nome, "Ajuste de fatura");
  assert.equal(categoriaDoPapel("credito-do-restante"), "restante");
  assert.equal(categoriaDoPapel("restante"), "restante");
  assert.equal(categoriaDoPapel("encargo"), "encargo");
});

test("valor digitado: formatos brasileiros e recusas", () => {
  assert.equal(valorDigitado("200"), 200);
  assert.equal(valorDigitado("200,50"), 200.5);
  assert.equal(valorDigitado("1.234,56"), 1234.56);
  assert.equal(valorDigitado("R$ 1.234,56"), 1234.56);
  assert.equal(valorDigitado("200.5"), 200.5);
  assert.equal(valorDigitado(""), null);
  assert.equal(valorDigitado("  "), null);
  assert.equal(valorDigitado("abc"), null);
  assert.equal(valorDigitado("-5"), null);
  assert.equal(valorDigitado("1,234"), null);
});

test("pagarAFatura manda o valor, o restante e o encargo para o /pay", async () => {
  const { rede, chamadas } = redeFalsa([
    { status: 200, body: { message: "Fatura paga com Itaú", is_transfer: true } },
  ]);
  const r = await pagarAFatura({
    linha: faturaFechada(),
    contaPagadoraId: CORRENTE,
    pagoEm: HOJE,
    rede,
    valorPago: 200,
    levarRestante: true,
    encargo: 12.34,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(chamadas[0].corpo, {
    paid_date: HOJE,
    payment_account_id: CORRENTE,
    amount: 200,
    levar_restante: true,
    encargo: 12.34,
  });
});

test("pagarAFatura sem parcial manda o corpo de sempre", async () => {
  const { rede, chamadas } = redeFalsa([
    { status: 200, body: { message: "Fatura paga com Itaú", is_transfer: true } },
  ]);
  await pagarAFatura({
    linha: faturaFechada(),
    contaPagadoraId: CORRENTE,
    pagoEm: HOJE,
    rede,
    levarRestante: false,
    encargo: 0,
  });
  assert.deepEqual(chamadas[0].corpo, {
    paid_date: HOJE,
    payment_account_id: CORRENTE,
  });
});

// =================================================================
// MOVER E PARCELAR A FATURA (lib/mover-e-parcelar-fatura.ts)
// =================================================================

const {
  chaveParcelamento,
  dividirEmCentavos,
  faturaParcelada,
  planoDoParcelamento,
  somarMeses,
} = await import("../.tmp-pagamento-da-fatura/mover-e-parcelar-fatura.js");

test("somarMeses atravessa o ano e recusa mes ilegivel", () => {
  assert.equal(somarMeses("2026-11", 1), "2026-12-01");
  assert.equal(somarMeses("2026-11-01", 2), "2027-01-01");
  assert.equal(somarMeses("2026-11", 14), "2028-01-01");
  assert.equal(somarMeses("2026-13", 1), null);
});

test("dividirEmCentavos soma exatamente o total, sobra nas primeiras", () => {
  assert.deepEqual(dividirEmCentavos(10000, 3), [3334, 3333, 3333]);
  assert.deepEqual(dividirEmCentavos(9, 3), [3, 3, 3]);
});

test("parcelar R$ 100 em 3x: credito na fatura, parcelas nas 3 seguintes", () => {
  const plano = planoDoParcelamento({
    total: 100,
    parcelas: 3,
    mes: "2026-11",
    cartaoId: CARTAO,
    hoje: "2026-11-06",
  });
  assert.equal(plano.ok, true);
  assert.deepEqual(plano.parcelas, [33.34, 33.33, 33.33]);
  const [credito, ...parcelas] = plano.linhas;
  assert.equal(credito.amount, 100);
  assert.equal(credito.invoice_month_override, "2026-11-01");
  assert.equal(credito.include_in_total, false);
  assert.ok(faturaParcelada([credito]));
  assert.deepEqual(
    parcelas.map((l) => l.invoice_month_override),
    ["2026-12-01", "2027-01-01", "2027-02-01"]
  );
  assert.equal(parcelas.reduce((s, l) => s + Math.round(l.amount * 100), 0), -10000);
  for (const l of plano.linhas) {
    assert.equal(l.notes, chaveParcelamento("2026-11", CARTAO));
    assert.equal(l.account_id, CARTAO);
  }
  assert.match(parcelas[0].description, /\(1\/3\)$/);
});

test("parcelar com juros: uma despesa de juros por parcela, nos totais", () => {
  const plano = planoDoParcelamento({
    total: 300,
    parcelas: 3,
    juros: 30,
    mes: "2026-11",
    cartaoId: CARTAO,
    hoje: "2026-11-06",
  });
  const juros = plano.linhas.filter((l) => l.papel === "juros");
  assert.equal(juros.length, 3);
  for (const l of juros) {
    assert.equal(l.amount, -10);
    assert.equal(l.include_in_total, true);
  }
});

test("parcelar recusa parcelas fora de 2..24, fatura zerada e juros negativos", () => {
  const base = { total: 100, mes: "2026-11", cartaoId: CARTAO, hoje: "2026-11-06" };
  for (const parcelas of [1, 25, 2.5, Number.NaN]) {
    assert.equal(planoDoParcelamento({ ...base, parcelas }).ok, false);
  }
  assert.equal(planoDoParcelamento({ ...base, parcelas: 3, total: 0 }).ok, false);
  assert.equal(planoDoParcelamento({ ...base, parcelas: 3, total: -50 }).ok, false);
  assert.equal(planoDoParcelamento({ ...base, parcelas: 3, juros: -1 }).ok, false);
});

test("faturaParcelada so reconhece o credito do parcelamento", () => {
  assert.equal(
    faturaParcelada([{ description: "Fatura de nov/2026 parcelada em 3x", transaction_type: "expense" }]),
    false
  );
  assert.equal(faturaParcelada([{ description: "Mercado", transaction_type: "income" }]), false);
});
