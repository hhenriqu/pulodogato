#!/usr/bin/env node
// =====================================================
// PULODOGATO - MyBank F2: a serie do emprestimo e as duas rotas (HMO-370)
// =====================================================
//   npm run test:emprestimo-do-mybank
//
// O QUE ESTA SUITE EXISTE PARA IMPEDIR
// ------------------------------------
// Tres coisas, e as tres sao dinheiro errado e plausivel:
//
//   1. A SOMA DAS PARCELAS NAO FECHAR COM O PRINCIPAL. 24x de R$ 10.000,00 nao
//      divide redondo (41.666,67 centavos), e qualquer arredondamento por
//      parcela perde ou inventa centavos no total. A aritmetica e importada de
//      `lib/lancamento.ts` justamente para nao haver uma segunda resposta; o que
//      esta suite mede e que ela CONTINUA sendo a usada.
//
//   2. O CASO B INVENTAR DESPESA NO MEU LADO. Eu emprestei R$ 24.000 para a
//      Lais; se a rota gravar as 24 parcelas em `scheduled_transactions`, o meu
//      safe-to-spend passa a descontar R$ 1.000 por mes de um dinheiro que ELA
//      paga, Despesas infla, e nenhuma tela diz por que. Nada no caminho
//      reclama: as linhas sao minhas, a RLS as aceita, o CHECK do destino passa.
//      E por isso que o teste do Caso B afirma a AUSENCIA de escrita, e nao a
//      resposta da rota.
//
//   3. O DEVEDOR ENCOLHER A DIVIDA. A policy de UPDATE da 053 nao consegue
//      comparar NEW com OLD (`USING` ve OLD, `WITH CHECK` ve NEW), entao quem
//      prende o `amount` no banco e a trigger. Aqui se mede o outro lado da
//      mesma trava: a ROTA nunca le `amount` do corpo do pedido, em ramo nenhum.
//      O teste manda `amount` junto com o `status` e exige que ele nao apareca
//      no patch.
//
// POR QUE O DUBLE DE CLIENT, E NAO SO A FUNCAO PURA
// ------------------------------------------------
// `previsoesDoEmprestimo` devolver `[]` no Caso B nao prova que a rota nao
// escreve: ela podia montar a linha a mao, ou chamar a funcao e ignorar o
// retorno. A promessa da issue ("pra mim nao deve aparecer como despesa") vive
// na fiacao, e a unica forma de medi-la e olhar o que a rota MANDOU gravar --
// ver `route-handler-roda-no-node-com-duble-de-client`.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import { criarDuble } from "./duble-de-supabase.mjs";

const LIB = await import("../.tmp-emprestimo-do-mybank/lib/emprestimo-do-mybank.js");
const LOANS = await import("../.tmp-emprestimo-do-mybank/app/api/mybank/loans/route.js");
const PARCELA = await import(
  "../.tmp-emprestimo-do-mybank/app/api/mybank/installments/[id]/route.js"
);

const EU = "eu-mesmo";
const LAIS = "lais";
const INVESTIMENTO = "conta-investimento";
const CORRENTE = "conta-corrente";
const SERVICO = "servico-financas";
const CATEGORIA_TRANSFER = "categoria-transferencia";

// ---------------------------------------------------------------------------
// PARTE 1 -- a funcao pura: a serie fecha com o principal
// ---------------------------------------------------------------------------

test("24x de um valor que NAO divide redondo: a soma fecha com o principal", () => {
  // 1.000.000 centavos / 24 = 41.666,67 -- nao divide. A parcela e R$ 416,67 e
  // o total das 24 por esse valor daria R$ 10.000,08: oito centavos inventados.
  const serie = LIB.serieDoEmprestimo({
    valor: "10000.00",
    base: "total",
    parcelas: 24,
    primeiroVencimento: "2026-11-10",
  });

  assert.ok(serie, "a serie de 24x tem de existir");
  assert.equal(serie.parcelas.length, 24);

  // EM CENTAVOS INTEIROS. Somar floats de reais daria 9999.999999999998 e o
  // teste passaria ou falharia por causa do IEEE 754, nao por causa da feature.
  const somaEmCentavos = serie.parcelas.reduce(
    (t, p) => t + Math.round(p.valor * 100),
    0
  );

  assert.equal(somaEmCentavos, 1000000, "a soma das 24 parcelas e o principal");
  assert.equal(serie.valorTotal, 10000);
});

test("a parcela 24 absorve o centavo da divisao -- e e a ULTIMA, nao a primeira", () => {
  const serie = LIB.serieDoEmprestimo({
    valor: "10000.00",
    base: "total",
    parcelas: 24,
    primeiroVencimento: "2026-11-10",
  });

  const vinteETres = serie.parcelas.slice(0, 23);
  const ultima = serie.parcelas[23];

  // As 23 primeiras sao iguais entre si...
  assert.deepEqual([...new Set(vinteETres.map((p) => p.valor))], [416.67]);

  // ...e a 24a e a diferenca, que aqui e MENOR. Este caso importa: a tentacao
  // e assumir que a ultima parcela e sempre a maior (sobra positiva), e com
  // arredondamento para cima ela e a menor. Um teste escrito sobre um valor que
  // arredonda para baixo nao distinguiria `Math.round` de `Math.ceil`.
  assert.equal(ultima.numero, 24);
  assert.equal(ultima.valor, 416.59);
  assert.ok(ultima.valor < 416.67, "aqui a ultima parcela e a MENOR");
});

test('base "parcela": o principal e 24x o digitado, nao o digitado', () => {
  const serie = LIB.serieDoEmprestimo({
    valor: "1000.00",
    base: "parcela",
    parcelas: 24,
    primeiroVencimento: "2026-11-10",
  });

  assert.equal(serie.valorTotal, 24000);
  assert.equal(serie.valorDaParcela, 1000);
  // Com base "parcela" o total e multiplo exato: nao ha sobra em parcela
  // nenhuma, e a 24a vale o mesmo que a 1a.
  assert.deepEqual([...new Set(serie.parcelas.map((p) => p.valor))], [1000]);
});

test("a serie comeca SEMPRE na parcela 1: nao ha parcela anterior nao criada", () => {
  const serie = LIB.serieDoEmprestimo({
    valor: "10000.00",
    base: "total",
    parcelas: 24,
    primeiroVencimento: "2026-11-10",
  });

  // Na compra do cartao a pessoa pode lancar "parcela 3 de 10" e as duas
  // anteriores NAO sao criadas (decisao (A) da HMO-208). Num emprestimo isso
  // produziria uma divida cuja soma de parcelas nao fecha com o principal.
  assert.equal(serie.parcelasAnteriores, 0);
  assert.equal(serie.parcelas[0].numero, 1);
  assert.equal(serie.parcelas[0].vencimento, "2026-11-10");
  assert.equal(serie.parcelas[23].vencimento, "2028-10-10");
});

test("o vencimento de 31/01 e grampeado em fevereiro, e a serie nao pula mes", () => {
  const serie = LIB.serieDoEmprestimo({
    valor: "300.00",
    base: "total",
    parcelas: 3,
    primeiroVencimento: "2027-01-31",
  });

  // `somaMeses` grampeia o dia no ultimo do mes destino: sem isso 31/01 + 1 mes
  // viraria 03/03 e duas parcelas cairiam no mesmo mes.
  assert.deepEqual(
    serie.parcelas.map((p) => p.vencimento),
    ["2027-01-31", "2027-02-28", "2027-03-31"]
  );
});

// ---------------------------------------------------------------------------
// PARTE 2 -- quais pernas cada caso gera
// ---------------------------------------------------------------------------

test("casoDoEmprestimo: devedor igual ao credor e `auto`; diferente e `conexao`", () => {
  assert.equal(
    LIB.casoDoEmprestimo({ lenderUserId: EU, borrowerUserId: EU }),
    "auto"
  );
  assert.equal(
    LIB.casoDoEmprestimo({ lenderUserId: EU, borrowerUserId: LAIS }),
    "conexao"
  );
});

const PARCELAS_GRAVADAS = [
  {
    id: "parcela-1",
    installment_number: 1,
    installment_total: 2,
    amount: 500,
    due_date: "2026-11-10",
  },
  {
    id: "parcela-2",
    installment_number: 2,
    installment_total: 2,
    amount: 500,
    due_date: "2026-12-10",
  },
];

test("CASO A: cada parcela vira uma transferencia prevista, com destino e elo", () => {
  const previsoes = LIB.previsoesDoEmprestimo({
    caso: "auto",
    parcelas: PARCELAS_GRAVADAS,
    descricao: "Moto elétrica",
    contaDePagamentoId: CORRENTE,
    contaCredoraId: INVESTIMENTO,
  });

  assert.equal(previsoes.length, 2);

  // `transfer`, e nao `expense`: a baixa de `expense` criaria UMA perna negativa
  // na conta corrente e a conta de investimento nunca receberia nada -- o
  // dinheiro sairia do patrimonio sem erro nenhum no caminho.
  assert.deepEqual([...new Set(previsoes.map((p) => p.transaction_type))], [
    "transfer",
  ]);

  assert.equal(previsoes[0].account_id, CORRENTE);
  assert.equal(previsoes[0].destination_account_id, INVESTIMENTO);
  assert.equal(previsoes[0].description, "Moto elétrica (1/2)");
  // POSITIVO: `scheduled_transactions_amount_check` e `CHECK (amount > 0)`.
  assert.equal(previsoes[0].amount, 500);
  assert.equal(previsoes[0].due_date, "2026-11-10");
  // O elo que liga a previsao de volta a parcela, na convencao do `acerto:<id>`.
  assert.equal(previsoes[0].notes, "mybank:parcela-1");
  assert.equal(previsoes[1].notes, "mybank:parcela-2");
});

test("CASO B: NENHUMA perna minha -- a lista de previsoes e vazia", () => {
  const previsoes = LIB.previsoesDoEmprestimo({
    caso: "conexao",
    parcelas: PARCELAS_GRAVADAS,
    descricao: "Moto elétrica",
    // Mesmo COM uma conta de pagamento no pedido: o que decide e o caso, nao a
    // presenca do campo. Um cliente que mandasse a conta por engano nao pode
    // conseguir criar a despesa que o Caso B existe para nao ter.
    contaDePagamentoId: CORRENTE,
    contaCredoraId: INVESTIMENTO,
  });

  assert.deepEqual(previsoes, []);
});

test("CASO B: o recebimento e perna de ENTRADA de transferencia, nao receita", () => {
  const perna = LIB.pernaDeEntradaDoPagamento({
    caso: "conexao",
    contaCredoraId: INVESTIMENTO,
    valor: 1000,
    descricao: "Moto elétrica",
    numero: 3,
    total: 24,
  });

  assert.ok(perna);
  // `income` faria o MESMO dinheiro contar como renda 24 vezes: principal
  // voltando move dinheiro de volta para dentro do patrimonio, nao o aumenta.
  assert.equal(perna.transaction_type, "transfer");
  assert.equal(perna.account_id, INVESTIMENTO);
  assert.equal(perna.amount, 1000);
  assert.ok(perna.amount > 0, "a entrada e POSITIVA");
  assert.equal(perna.description, "Moto elétrica (3/24)");
});

test("CASO A: o recebimento NAO gera perna aqui -- quem paga e Contas a Pagar", () => {
  // A parcela do auto-emprestimo ja e uma transferencia prevista, e a baixa
  // dela grava as DUAS pernas. Uma perna aqui faria a conta de investimento
  // receber o valor duas vezes.
  assert.equal(
    LIB.pernaDeEntradaDoPagamento({
      caso: "auto",
      contaCredoraId: INVESTIMENTO,
      valor: 1000,
      descricao: "Moto elétrica",
      numero: 3,
      total: 24,
    }),
    null
  );
});

test("as parcelas vao com `amount` POSITIVO para o banco", () => {
  const serie = LIB.serieDoEmprestimo({
    valor: "10000.00",
    base: "total",
    parcelas: 24,
    primeiroVencimento: "2026-11-10",
  });

  const linhas = LIB.linhasDasParcelas({ serie, parcelas: 24 });

  assert.equal(linhas.length, 24);
  assert.ok(
    linhas.every((l) => l.amount > 0),
    "`mybank_installments_amount_check` e CHECK (amount > 0): uma parcela negativa derrubaria a serie inteira em 23514"
  );
  assert.deepEqual([...new Set(linhas.map((l) => l.status))], ["pending"]);
  assert.deepEqual([...new Set(linhas.map((l) => l.installment_total))], [24]);
});

// ---------------------------------------------------------------------------
// PARTE 3 -- as recusas, em forma de frase
// ---------------------------------------------------------------------------

const PEDIDO_VALIDO = {
  descricao: "Moto elétrica",
  base: "total",
  caso: "auto",
  contaCredoraPedida: INVESTIMENTO,
  contaCredora: { id: INVESTIMENTO, account_type: "investment" },
  contaDePagamentoPedida: CORRENTE,
  contaDePagamento: { id: CORRENTE, account_type: "checking" },
  conexaoAceita: false,
  juros: 0,
  parcelas: 24,
};

function problema(mudancas) {
  const serie = LIB.serieDoEmprestimo({
    valor: "10000.00",
    base: "total",
    parcelas: mudancas.parcelas ?? 24,
    primeiroVencimento: "2026-11-10",
  });
  return LIB.problemaDoEmprestimo({ ...PEDIDO_VALIDO, serie, ...mudancas });
}

test("o pedido bom passa (controle positivo da peneira)", () => {
  // Sem este caso, todo teste abaixo passaria com uma funcao que devolvesse
  // sempre um problema -- e a rota recusaria todo emprestimo.
  assert.equal(problema({}), null);
});

test("conta credora que nao e de investimento: recusa com frase", () => {
  const p = problema({
    contaCredora: { id: INVESTIMENTO, account_type: "checking" },
  });
  assert.equal(p, "conta_credora_nao_e_investimento");
  assert.match(LIB.mensagemDoProblema(p), /conta de investimento/i);
});

test("conta de outra pessoa chega como NAO ENCONTRADA, nao como 'nao e sua'", () => {
  // A rota le com `.eq("user_id", user.id)`, entao a conta alheia volta `null`.
  // Dizer "essa conta nao e sua" confirmaria a existencia do uuid.
  const p = problema({ contaCredora: null });
  assert.equal(p, "conta_credora_nao_encontrada");
  assert.doesNotMatch(LIB.mensagemDoProblema(p), /não é sua|nao e sua/i);
});

test("devedor sem conexao aceita: recusa, e so no caso `conexao`", () => {
  assert.equal(
    problema({ caso: "conexao", conexaoAceita: false }),
    "devedor_sem_conexao"
  );
  assert.equal(problema({ caso: "conexao", conexaoAceita: true }), null);
  // O auto-emprestimo NAO consulta conexao: `user_connections` tem
  // `CHECK (requester_id <> requested_id)` e ninguem e conexao de si mesmo --
  // exigir conexao aqui recusaria o caso principal da issue.
  assert.equal(problema({ caso: "auto", conexaoAceita: false }), null);
});

test("juro diferente de zero: recusado na fase 1", () => {
  assert.equal(problema({ juros: 0.015 }), "juros_fora_da_fase_1");
});

test("parcelas fora de 2..60: a frase DIZ os numeros", () => {
  assert.equal(problema({ parcelas: 1 }), "parcelas_fora_do_alcance");
  assert.equal(problema({ parcelas: 61 }), "parcelas_fora_do_alcance");
  assert.equal(problema({ parcelas: 60 }), null);
  assert.equal(problema({ parcelas: 2 }), null);

  // A faixa do banco e 1..360 e a desta fase e 2..60. A diferenca pode existir
  // (o banco e rede de seguranca, pode ser mais largo que a UX); o que ela nao
  // pode ser e silenciosa.
  assert.match(
    LIB.mensagemDoProblema("parcelas_fora_do_alcance"),
    /entre 2 e 60/
  );
});

test("o Caso A exige a conta de onde o dinheiro sai; o Caso B, nao", () => {
  assert.equal(
    problema({ caso: "auto", contaDePagamentoPedida: null }),
    "conta_de_pagamento_ausente"
  );
  // No Caso B nao ha perna minha: pedir de onde sai um dinheiro que nao sai de
  // mim nao tem resposta certa.
  assert.equal(
    problema({
      caso: "conexao",
      conexaoAceita: true,
      contaDePagamentoPedida: null,
      contaDePagamento: null,
    }),
    null
  );
});

test("pagar da propria conta credora e recusado antes do 23514", () => {
  assert.equal(
    problema({
      contaDePagamentoPedida: INVESTIMENTO,
      contaDePagamento: { id: INVESTIMENTO, account_type: "investment" },
    }),
    "conta_de_pagamento_e_a_credora"
  );
});

// ---------------------------------------------------------------------------
// PARTE 4 -- POST /api/mybank/loans, pelo duble
// ---------------------------------------------------------------------------

/** O fixture base: uma conta de investimento e uma corrente, as duas minhas. */
function tabelas(extra = {}) {
  return {
    financial_accounts: [
      { id: INVESTIMENTO, user_id: EU, account_type: "investment" },
      { id: CORRENTE, user_id: EU, account_type: "checking" },
      // A VIZINHA: uma conta de OUTRA pessoa. Sem ela, "esta conta" e "todas as
      // contas" sao o mesmo conjunto e o mutante que apaga o `.eq("user_id")`
      // sobrevive.
      { id: "conta-da-lais", user_id: LAIS, account_type: "investment" },
    ],
    financial_services: [{ id: SERVICO, name: "personal_finance" }],
    transaction_categories: [
      {
        id: CATEGORIA_TRANSFER,
        service_id: SERVICO,
        name: "Transferência entre contas",
        is_active: false,
      },
    ],
    user_connections: [],
    // Declaradas vazias de proposito: e o que faz a linha inserida ficar
    // legivel numa leitura posterior (e o que faz `escritas` ter onde cair).
    mybank_loans: [],
    mybank_installments: [],
    scheduled_transactions: [],
    financial_transactions: [],
    profiles: [{ id: LAIS, full_name: "Laís Bernucio", nickname: null }],
    ...extra,
  };
}

async function criarEmprestimo(corpo, extra = {}) {
  const sessao = criarDuble({ user: { id: EU }, tabelas: tabelas(extra) });
  const registro = { sessao: () => sessao.client };
  globalThis.__dubleDeSupabase = registro;

  let resposta;
  try {
    resposta = await LOANS.POST({ json: async () => corpo });
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  return { status: resposta.status, corpo: await resposta.json(), sessao, registro };
}

const CORPO_AUTO = {
  descricao: "Moto elétrica",
  conta_credora_id: INVESTIMENTO,
  conta_de_pagamento_id: CORRENTE,
  valor: "1000.00",
  base: "parcela",
  parcelas: 24,
  primeiro_vencimento: "2026-11-10",
};

const CORPO_CONEXAO = {
  descricao: "Moto elétrica",
  conta_credora_id: INVESTIMENTO,
  devedor_id: LAIS,
  valor: "1000.00",
  base: "parcela",
  parcelas: 24,
  primeiro_vencimento: "2026-11-10",
};

const CONEXAO_ACEITA = {
  user_connections: [
    { id: "c1", requester_id: EU, requested_id: LAIS, status: "accepted" },
  ],
};

test("POST recusa conta credora que nao e de investimento", async () => {
  const { status, corpo, sessao } = await criarEmprestimo({
    ...CORPO_AUTO,
    conta_credora_id: CORRENTE,
    conta_de_pagamento_id: INVESTIMENTO,
  });

  assert.equal(status, 400);
  assert.match(corpo.error, /conta de investimento/i);
  // RECUSAR E GRAVAR DE QUALQUER JEITO SERIA O PIOR DOS DOIS MUNDOS.
  assert.equal(
    sessao.escritas.some((e) => e.tabela === "mybank_loans"),
    false
  );
});

test("POST recusa conta de OUTRO usuario (ela volta como nao encontrada)", async () => {
  const { status, corpo, sessao } = await criarEmprestimo({
    ...CORPO_AUTO,
    conta_credora_id: "conta-da-lais",
  });

  assert.equal(status, 400);
  assert.match(corpo.error, /não encontrada/i);
  assert.equal(sessao.escritas.length, 0);
});

test("POST recusa devedor SEM conexao aceita", async () => {
  const { status, corpo, sessao } = await criarEmprestimo(CORPO_CONEXAO);

  assert.equal(status, 400);
  assert.match(corpo.error, /conexão aceita/i);
  assert.equal(sessao.escritas.length, 0);
});

test("POST recusa devedor com conexao PENDENTE (o `accepted` e load-bearing)", async () => {
  const { status, sessao } = await criarEmprestimo(CORPO_CONEXAO, {
    user_connections: [
      { id: "c1", requester_id: EU, requested_id: LAIS, status: "pending" },
    ],
  });

  // Sem este caso, um `.eq("status", "accepted")` perdido passaria verde: a
  // lista nao estaria vazia e a rota aceitaria quem so recebeu o convite.
  assert.equal(status, 400);
  assert.equal(sessao.escritas.length, 0);
});

test("POST aceita a conexao registrada do OUTRO lado (requested -> requester)", async () => {
  const { status } = await criarEmprestimo(CORPO_CONEXAO, {
    user_connections: [
      { id: "c1", requester_id: LAIS, requested_id: EU, status: "accepted" },
    ],
  });

  // O pedido pode ter partido de qualquer um dos dois; so um dos sentidos
  // deixaria metade das conexoes reais sem poder emprestar.
  assert.equal(status, 201);
});

test("CASO A: a serie vai num insert so, e nasce a transferencia prevista", async () => {
  const { status, corpo, sessao } = await criarEmprestimo(CORPO_AUTO);

  assert.equal(status, 201);
  assert.equal(corpo.caso, "auto");
  assert.equal(corpo.total_de_parcelas, 24);
  assert.equal(corpo.previsoes_criadas, 24);

  const emprestimos = sessao.escritas.filter(
    (e) => e.tabela === "mybank_loans" && e.verbo === "insert"
  );
  assert.equal(emprestimos.length, 1);
  // `principal` e 24x o digitado, porque a base e "parcela". Gravar o digitado
  // poria R$ 1.000 num emprestimo de R$ 24.000.
  assert.equal(emprestimos[0].linhas[0].principal, 24000);
  assert.equal(emprestimos[0].linhas[0].installment_count, 24);
  assert.equal(emprestimos[0].linhas[0].borrower_user_id, EU);
  assert.equal(emprestimos[0].linhas[0].interest_rate, 0);
  assert.equal(emprestimos[0].linhas[0].first_due_date, "2026-11-10");

  // UM insert com 24 linhas, e nao 24 inserts: um laco pode parar no meio e a
  // divida ficaria gravada pela metade, com a soma deixando de fechar.
  const parcelas = sessao.escritas.filter(
    (e) => e.tabela === "mybank_installments" && e.verbo === "insert"
  );
  assert.equal(parcelas.length, 1);
  assert.equal(parcelas[0].linhas.length, 24);
  // O lote do PostgREST monta as colunas a partir da PRIMEIRA linha: uma chave
  // ausente nela e descartada de todas, em silencio.
  assert.deepEqual(parcelas[0].descartadas, []);

  const previstas = sessao.escritas.filter(
    (e) => e.tabela === "scheduled_transactions" && e.verbo === "insert"
  );
  assert.equal(previstas.length, 1);
  assert.equal(previstas[0].linhas.length, 24);
  assert.deepEqual(previstas[0].descartadas, []);
  assert.deepEqual(
    [...new Set(previstas[0].linhas.map((l) => l.transaction_type))],
    ["transfer"]
  );
  assert.deepEqual(
    [...new Set(previstas[0].linhas.map((l) => l.destination_account_id))],
    [INVESTIMENTO]
  );
  assert.deepEqual(
    [...new Set(previstas[0].linhas.map((l) => l.account_id))],
    [CORRENTE]
  );
  // Rateio de grupo numa transferencia entre contas minhas cobraria de membros
  // um valor que nao e despesa de ninguem.
  assert.deepEqual([...new Set(previstas[0].linhas.map((l) => l.group_id))], [
    null,
  ]);
  assert.equal(previstas[0].linhas[0].category_id, CATEGORIA_TRANSFER);
});

test("CASO B: a rota NAO escreve em `scheduled_transactions` -- nem no meu nome nem no dela", async () => {
  const { status, corpo, sessao } = await criarEmprestimo(
    CORPO_CONEXAO,
    CONEXAO_ACEITA
  );

  assert.equal(status, 201);
  assert.equal(corpo.caso, "conexao");
  assert.equal(corpo.previsoes_criadas, 0);

  // ESTE E O TESTE QUE IMPEDE A FEATURE DE INVENTAR DESPESA NO MEU LADO.
  // Ver o item 2 do cabecalho: 24 contas a pagar no meu nome por um dinheiro
  // que ela paga, sem erro nenhum no caminho.
  assert.equal(
    sessao.escritas.some((e) => e.tabela === "scheduled_transactions"),
    false,
    "o Caso B nao tem perna minha: nenhuma escrita em scheduled_transactions"
  );
  assert.equal(
    sessao.escritas.some((e) => e.tabela === "financial_transactions"),
    false,
    "e nenhum lancamento realizado tambem -- a divida ainda nao foi paga"
  );

  // A divida existe, e existe SO em `mybank_installments`.
  const parcelas = sessao.escritas.filter(
    (e) => e.tabela === "mybank_installments" && e.verbo === "insert"
  );
  assert.equal(parcelas.length, 1);
  assert.equal(parcelas[0].linhas.length, 24);

  const emprestimos = sessao.escritas.filter(
    (e) => e.tabela === "mybank_loans" && e.verbo === "insert"
  );
  assert.equal(emprestimos[0].linhas[0].borrower_user_id, LAIS);
});

test("CASO B: mandar `conta_de_pagamento_id` no corpo NAO cria despesa minha", async () => {
  const { status, corpo, sessao } = await criarEmprestimo(
    // O pedido com os dois campos: um cliente que mande a conta por engano (ou
    // de proposito) nao pode conseguir criar a conta a pagar que o Caso B existe
    // para NAO ter. Sem este caso, o mutante que apaga a guarda do caso dentro
    // de `previsoesDoEmprestimo` sobreviveria no nivel da rota -- lá o
    // `contaDePagamentoId` ja chega `null` por outro caminho, e as duas guardas
    // viram uma so aos olhos da sonda.
    { ...CORPO_CONEXAO, conta_de_pagamento_id: CORRENTE },
    CONEXAO_ACEITA
  );

  assert.equal(status, 201);
  assert.equal(corpo.previsoes_criadas, 0);
  assert.equal(
    sessao.escritas.some((e) => e.tabela === "scheduled_transactions"),
    false
  );
});

test("CASO A: previsao que falha DESFAZ o emprestimo -- nada fica gravado", async () => {
  const sessao = criarDuble({
    user: { id: EU },
    tabelas: tabelas(),
    // A unica resposta que importa aqui: o insert das previsoes falhando depois
    // de o emprestimo e as 24 parcelas ja estarem gravados.
    erros: {
      scheduled_transactions: { code: "23514", message: "check_violation" },
    },
  });
  globalThis.__dubleDeSupabase = { sessao: () => sessao.client };

  let resposta;
  try {
    resposta = await LOANS.POST({ json: async () => CORPO_AUTO });
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  const corpo = await resposta.json();

  assert.equal(resposta.status, 500);
  assert.match(corpo.error, /Nada foi gravado/i);

  // NO CASO A A PREVISAO E O UNICO JEITO DE A PARCELA APARECER EM CONTAS A
  // PAGAR. Um emprestimo com parcelas e sem previsao e uma divida que a pessoa
  // nunca ve para pagar, e ela nao tem como descobrir que faltou. O CASCADE de
  // `loan_id` leva as parcelas junto.
  const apagados = sessao.escritas.filter(
    (e) => e.tabela === "mybank_loans" && e.verbo === "delete"
  );
  assert.equal(apagados.length, 1);
  assert.equal(apagados[0].linhasAfetadas, 1);
});

test("o aviso filtrado pela RLS NAO responde sucesso", async () => {
  const sessao = criarDuble({
    user: { id: LAIS },
    tabelas: tabelas({
      mybank_loans: [EMPRESTIMO_PARA_A_LAIS],
      mybank_installments: [{ ...PARCELA_DA_LAIS }],
    }),
    // A UNICA resposta que a policy da quando ela nao casa com a linha: HTTP
    // 200, corpo `[]`. A RLS FILTRA em vez de recusar -- entao nao ha erro para
    // a rota ver, e um `await` sem conferir a contagem responde "avisei" sobre
    // um UPDATE que alcancou zero linha.
    rlsFiltra: { mybank_installments: true },
  });
  globalThis.__dubleDeSupabase = { sessao: () => sessao.client };

  let resposta;
  try {
    resposta = await PARCELA.PATCH(
      { json: async () => ({ status: "reported" }) },
      { params: { id: "p3" } }
    );
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  assert.equal(resposta.status, 500);
});

test("CASO B: o toast diz que isso NAO entra nas minhas despesas", async () => {
  const { corpo } = await criarEmprestimo(CORPO_CONEXAO, CONEXAO_ACEITA);

  // Um texto unico para os dois casos faria o Caso B parecer que criou conta a
  // pagar no meu nome -- e quem leu isso vai procurar a despesa que falta.
  assert.match(corpo.message, /não entra nas suas despesas/i);
  assert.match(corpo.message, /a receber no MyBank/i);
});

test("CONTROLE: a rota usou o duble (a sonda nao esta vazia)", async () => {
  const { registro, sessao } = await criarEmprestimo(CORPO_AUTO);

  // Sem isto, um dia em que a rota trocasse o jeito de obter o client faria
  // todas as assercoes de ausencia acima passarem por vacuidade -- inclusive a
  // do Caso B, que e a principal.
  assert.ok(
    registro.chamadasDeSessao > 0,
    "a rota tem de ter pedido o client de sessao ao duble"
  );
  assert.equal(
    sessao.lidas.some((l) => l.tabela === "financial_accounts"),
    true
  );
});

// ---------------------------------------------------------------------------
// PARTE 5 -- GET /api/mybank/loans
// ---------------------------------------------------------------------------

async function lerEmprestimos(extra = {}) {
  const sessao = criarDuble({ user: { id: EU }, tabelas: tabelas(extra) });
  globalThis.__dubleDeSupabase = { sessao: () => sessao.client };

  let resposta;
  try {
    resposta = await LOANS.GET();
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  return { status: resposta.status, corpo: await resposta.json(), sessao };
}

const EMPRESTIMO_PARA_A_LAIS = {
  id: "loan-lais",
  lender_user_id: EU,
  lender_account_id: INVESTIMENTO,
  borrower_user_id: LAIS,
  description: "Moto elétrica",
  principal: 24000,
  installment_count: 24,
  first_due_date: "2026-11-10",
  status: "active",
  created_at: "2026-10-10T00:00:00Z",
};

/** A divida que EU devo a OUTRA pessoa -- a RLS me deixa ve-la. */
const EMPRESTIMO_QUE_EU_DEVO = {
  id: "loan-eu-devo",
  lender_user_id: LAIS,
  lender_account_id: "conta-da-lais",
  borrower_user_id: EU,
  description: "Geladeira",
  principal: 1200,
  installment_count: 12,
  first_due_date: "2026-11-05",
  status: "active",
  created_at: "2026-10-09T00:00:00Z",
};

test("GET devolve valor, `n de m` e quem deve pagar", async () => {
  const { status, corpo } = await lerEmprestimos({
    mybank_loans: [EMPRESTIMO_PARA_A_LAIS],
    mybank_installments: [
      {
        id: "p3",
        loan_id: "loan-lais",
        installment_number: 3,
        installment_total: 24,
        amount: 1000,
        due_date: "2027-01-10",
        status: "pending",
        reported_at: null,
        paid_date: null,
      },
    ],
  });

  assert.equal(status, 200);
  assert.equal(corpo.loans.length, 1);

  const [emprestimo] = corpo.loans;
  assert.equal(emprestimo.quem_deve_pagar, "Laís Bernucio");
  assert.equal(emprestimo.parcelas[0].valor, 1000);
  assert.equal(emprestimo.parcelas[0].rotulo, "3 de 24");
  assert.equal(emprestimo.parcelas[0].a_confirmar, false);
});

test("GET nao mistura o que EU devo com o que me devem", async () => {
  const { corpo } = await lerEmprestimos({
    mybank_loans: [EMPRESTIMO_PARA_A_LAIS, EMPRESTIMO_QUE_EU_DEVO],
    mybank_installments: [],
  });

  // `mybank_loans_select` deixa os DOIS lados verem a linha -- e isso e o que
  // faz o devedor ver a divida dele. Sem o `.eq("lender_user_id")` desta rota,
  // "quem deve pagar" diria o MEU nome numa lista chamada "A receber".
  assert.deepEqual(
    corpo.loans.map((l) => l.id),
    ["loan-lais"]
  );
});

test("GET: o devedor que avisou aparece como `a_confirmar` (estado derivado)", async () => {
  const { corpo } = await lerEmprestimos({
    mybank_loans: [EMPRESTIMO_PARA_A_LAIS],
    mybank_installments: [
      {
        id: "p3",
        loan_id: "loan-lais",
        installment_number: 3,
        installment_total: 24,
        amount: 1000,
        due_date: "2027-01-10",
        status: "reported",
        reported_at: "2027-01-11T10:00:00Z",
        paid_date: null,
      },
    ],
  });

  // Nao ha coluna "a confirmar" no banco: e `status = 'reported'`, derivado --
  // o achado da HMO-366.
  assert.equal(corpo.loans[0].parcelas[0].a_confirmar, true);
});

test("GET: perfil ilegivel nao esconde a divida", async () => {
  const { corpo } = await lerEmprestimos({
    mybank_loans: [EMPRESTIMO_PARA_A_LAIS],
    mybank_installments: [],
    // Desfazer a conexao depois do emprestimo torna o perfil ilegivel pela
    // `profiles_select_connected`. Com embed, a linha seria DESCARTADA e a
    // lista ficaria vazia sem erro nenhum.
    profiles: [],
  });

  assert.equal(corpo.loans.length, 1);
  assert.match(corpo.loans[0].quem_deve_pagar, /contato indisponível/i);
});

test("GET: no auto-emprestimo quem deve pagar sou eu, sem ir a `profiles`", async () => {
  const { corpo } = await lerEmprestimos({
    mybank_loans: [
      { ...EMPRESTIMO_PARA_A_LAIS, id: "loan-auto", borrower_user_id: EU },
    ],
    mybank_installments: [],
    profiles: [],
  });

  assert.equal(corpo.loans[0].quem_deve_pagar, "Você mesmo");
});

// ---------------------------------------------------------------------------
// PARTE 6 -- PATCH /api/mybank/installments/[id]
// ---------------------------------------------------------------------------

const PARCELA_DA_LAIS = {
  id: "p3",
  loan_id: "loan-lais",
  installment_number: 3,
  installment_total: 24,
  amount: 1000,
  due_date: "2027-01-10",
  status: "pending",
  reported_at: null,
  paid_date: null,
  paid_transaction_id: null,
};

// `rlsFiltra` SAI DO `extra` ANTES DE ELE VIRAR TABELA. Sem esta separacao a
// opcao entra em `tabelas()` como se fosse uma tabela chamada "rlsFiltra", o
// duble a ignora em silencio e o teste que pedia a escrita filtrada mede o
// caminho FELIZ -- passando com a assercao invertida.
async function mexerNaParcela(
  quem,
  corpoDoPedido,
  { rlsFiltra, ...extra } = {}
) {
  const sessao = criarDuble({
    user: { id: quem },
    ...(rlsFiltra ? { rlsFiltra } : {}),
    tabelas: tabelas({
      // A COPIA NAO E ESTILO: o duble aplica o patch DE VERDADE nas linhas
      // semeadas (`Object.assign(l, patch)`, para a rota reler o que escreveu),
      // e desde a HMO-394 esta rota ESCREVE em `mybank_loans` -- a quitacao.
      // Semear a constante por referencia fazia o `settled` de um teste vazar
      // para `EMPRESTIMO_PARA_A_LAIS` e, dali, para todos os testes seguintes:
      // dois do cancelamento quebraram com "409" e "settled em vez de active",
      // longe daqui e sem relacao aparente com a parcela.
      mybank_loans: [{ ...EMPRESTIMO_PARA_A_LAIS }],
      mybank_installments: [{ ...PARCELA_DA_LAIS }],
      ...extra,
    }),
  });
  globalThis.__dubleDeSupabase = { sessao: () => sessao.client };

  let resposta;
  try {
    resposta = await PARCELA.PATCH(
      { json: async () => corpoDoPedido },
      { params: { id: "p3" } }
    );
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  return { status: resposta.status, corpo: await resposta.json(), sessao };
}

test("o DEVEDOR leva pending -> reported", async () => {
  const { status, sessao } = await mexerNaParcela(LAIS, { status: "reported" });

  assert.equal(status, 200);

  const patches = sessao.escritas.filter(
    (e) => e.tabela === "mybank_installments" && e.verbo === "update"
  );
  assert.equal(patches.length, 1);
  assert.equal(patches[0].patch.status, "reported");
  assert.ok(patches[0].patch.reported_at, "o carimbo do aviso e gravado");
  assert.equal(patches[0].linhasAfetadas, 1);
});

test("o DEVEDOR nao consegue mudar o `amount` -- o campo nao chega ao patch", async () => {
  const { status, sessao } = await mexerNaParcela(LAIS, {
    status: "reported",
    // O ataque da issue: encolher a divida no mesmo UPDATE que avisa.
    amount: 0.01,
    due_date: "2030-01-01",
    paid_transaction_id: "forjado",
  });

  assert.equal(status, 200);

  const [patch] = sessao.escritas
    .filter((e) => e.tabela === "mybank_installments" && e.verbo === "update")
    .map((e) => e.patch);

  // A defesa e a AUSENCIA: esta rota nao le nenhum destes campos, em ramo
  // nenhum. Nao ha um `delete patch.amount` para alguem remover sem querer.
  assert.deepEqual(Object.keys(patch).sort(), ["reported_at", "status"]);
  assert.equal("amount" in patch, false);
  assert.equal("due_date" in patch, false);
  assert.equal("paid_transaction_id" in patch, false);
});

test("o DEVEDOR nao consegue levar a parcela a `paid`", async () => {
  const { status, corpo, sessao } = await mexerNaParcela(LAIS, {
    status: "paid",
  });

  // Quem ve o dinheiro chegar e quem confirma: a conta que recebe nao e dele.
  assert.equal(status, 403);
  assert.match(corpo.error, /quem recebe o dinheiro/i);
  assert.equal(sessao.escritas.length, 0);
});

test("o devedor nao avisa duas vezes (reported -> reported e 409)", async () => {
  const { status, sessao } = await mexerNaParcela(
    LAIS,
    { status: "reported" },
    { mybank_installments: [{ ...PARCELA_DA_LAIS, status: "reported" }] }
  );

  assert.equal(status, 409);
  assert.equal(sessao.escritas.length, 0);
});

test("o CREDOR confirma: a parcela vira `paid` e nasce a perna de ENTRADA", async () => {
  const { status, corpo, sessao } = await mexerNaParcela(
    EU,
    { status: "paid", data_do_pagamento: "2027-01-12" },
    { mybank_installments: [{ ...PARCELA_DA_LAIS, status: "reported" }] }
  );

  assert.equal(status, 200);

  const lancamentos = sessao.escritas.filter(
    (e) => e.tabela === "financial_transactions" && e.verbo === "insert"
  );
  assert.equal(lancamentos.length, 1);

  const linha = lancamentos[0].linhas[0];
  // `transfer` E NAO `income`: principal voltando nao e receita. Com `income` o
  // mesmo dinheiro contaria como renda 24 vezes.
  assert.equal(linha.transaction_type, "transfer");
  assert.equal(linha.account_id, INVESTIMENTO);
  assert.equal(linha.amount, 1000);
  assert.ok(linha.amount > 0, "a entrada e positiva");
  assert.equal(linha.transaction_date, "2027-01-12");
  assert.equal(linha.notes, "mybank:p3");
  assert.equal(linha.group_id, null);
  assert.equal(linha.category_id, CATEGORIA_TRANSFER);

  const patches = sessao.escritas.filter(
    (e) => e.tabela === "mybank_installments" && e.verbo === "update"
  );
  assert.equal(patches[0].patch.status, "paid");
  assert.equal(patches[0].patch.paid_date, "2027-01-12");
  // `mybank_installments_paid_check` e `(status='paid') = (paid_date IS NOT
  // NULL)`: `paid` sem data derruba a linha em 23514.
  assert.ok(patches[0].patch.paid_date);
  assert.equal(patches[0].patch.paid_transaction_id, "financial_transactions-1");

  assert.match(corpo.message, /não é receita/i);
});

test("CASO A: o credor NAO marca `paid` aqui -- a parcela e pagavel em Contas a Pagar", async () => {
  const { status, corpo, sessao } = await mexerNaParcela(
    EU,
    { status: "paid" },
    {
      mybank_loans: [{ ...EMPRESTIMO_PARA_A_LAIS, borrower_user_id: EU }],
    }
  );

  // Aceitar aqui produziria uma parcela paga sem nenhum dinheiro ter se movido:
  // o emprestimo quitado, o saldo da corrente intacto e a conta de investimento
  // sem ter recebido nada. "O numero fecha, o fato nao aconteceu."
  assert.equal(status, 400);
  assert.match(corpo.error, /Contas a Pagar/);
  assert.equal(sessao.escritas.length, 0);
});

test("quem nao e credor nem devedor nao acha a parcela", async () => {
  const { status, sessao } = await mexerNaParcela("estranho", {
    status: "reported",
  });

  // 404 e nao 403: "existe mas nao e sua" confirmaria a existencia do id.
  assert.equal(status, 404);
  assert.equal(sessao.escritas.length, 0);
});

test("status fora de reported/paid e recusado", async () => {
  for (const status of ["cancelled", "pending", "PAID", ""]) {
    const r = await mexerNaParcela(EU, { status });
    assert.equal(r.status, 400, `status ${JSON.stringify(status)} tem de ser 400`);
    assert.equal(r.sessao.escritas.length, 0);
  }
});

// ---------------------------------------------------------------------------
// PARTE 7 -- O CICLO DO CASO A FECHA (HMO-382)
// ---------------------------------------------------------------------------
// A baixa da transferencia prevista leva a parcela do MyBank a `paid`, e o
// estorno a devolve a `pending`.
//
// O QUE ESTA PARTE EXISTE PARA IMPEDIR
// ------------------------------------
// O estado que a main tinha depois da F4: eu pago a moto para mim mesmo nas 24
// vezes, a conta corrente baixa `-X`, a conta de investimento sobe `+X`, o
// patrimonio fica certo -- e `mybank_installments.status` fica em `pending`
// PARA SEMPRE, com o painel do MyBank dizendo que eu devo as 24 parcelas. E o
// oposto da familia HMO-149 ("o numero fecha, o fato nao aconteceu"): aqui o
// fato aconteceu e o numero nao mexe.
//
// E NAO SE CONSERTA ACEITANDO `paid` NO PATCH: a recusa daquela rota esta certa
// (ver o teste "CASO A: o credor NAO marca `paid` aqui"), porque aceitar lá
// produziria emprestimo quitado sem nada ter saido da conta. Os dois testes
// convivem de proposito -- um exige a recusa, o outro exige o caminho que
// funciona.
//
// POR QUE A PROVA E PELA ROTA, E NAO PELA FUNCAO PURA
// ---------------------------------------------------
// `parcelaDaChaveDoMyBank("mybank:p1") === "p1"` nao prova nada sobre a baixa:
// o defeito consertado aqui era precisamente a rota NAO CHAMAR a leitura do
// elo. O que corresponde a promessa e o UPDATE que a rota mandou -- tabela,
// patch e contagem de linhas.

const PAY = await import(
  "../.tmp-emprestimo-do-mybank/app/api/scheduled-transactions/[id]/pay/route.js"
);

/** A parcela 3/24 do MEU auto-emprestimo -- o Caso A da HMO-368. */
const PARCELA_DO_AUTO = {
  id: "parcela-do-auto",
  loan_id: "loan-auto",
  installment_number: 3,
  installment_total: 24,
  amount: 1000,
  due_date: "2027-01-10",
  status: "pending",
  reported_at: null,
  paid_date: null,
  paid_transaction_id: null,
};

const EMPRESTIMO_DO_AUTO = {
  id: "loan-auto",
  lender_user_id: EU,
  lender_account_id: INVESTIMENTO,
  // O Caso A em uma linha: eu sou os dois lados.
  borrower_user_id: EU,
  description: "Moto elétrica",
  principal: 24000,
  installment_count: 24,
  first_due_date: "2026-11-10",
  status: "active",
  created_at: "2026-10-10T00:00:00Z",
};

/**
 * A transferencia prevista que a F2 criou para essa parcela: do corrente para o
 * investimento, com o elo em `notes`.
 */
const PREVISAO_DO_AUTO = {
  id: "prev-do-auto",
  user_id: EU,
  account_id: CORRENTE,
  destination_account_id: INVESTIMENTO,
  description: "Moto elétrica (3/24)",
  amount: 1000,
  due_date: "2027-01-10",
  transaction_type: "transfer",
  status: "pending",
  paid_date: null,
  transaction_id: null,
  category_id: CATEGORIA_TRANSFER,
  subcategory_id: null,
  group_id: null,
  notes: "mybank:parcela-do-auto",
  created_at: "2026-10-10T00:00:00Z",
};

function tabelasDoCicloDoAuto(extra = {}) {
  return tabelas({
    mybank_loans: [{ ...EMPRESTIMO_DO_AUTO }],
    mybank_installments: [{ ...PARCELA_DO_AUTO }],
    scheduled_transactions: [{ ...PREVISAO_DO_AUTO }],
    ...extra,
  });
}

async function pagarPrevisao({ tabelas: linhas, corpo = {}, erros, rlsFiltra } = {}) {
  const sessao = criarDuble({
    user: { id: EU },
    tabelas: linhas ?? tabelasDoCicloDoAuto(),
    ...(erros ? { erros } : {}),
    ...(rlsFiltra ? { rlsFiltra } : {}),
  });
  const registro = { sessao: () => sessao.client };
  globalThis.__dubleDeSupabase = registro;

  let resposta;
  try {
    resposta = await PAY.POST(
      { json: async () => corpo },
      { params: { id: "prev-do-auto" } }
    );
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  return { status: resposta.status, corpo: await resposta.json(), sessao, registro };
}

async function estornarPrevisao({ tabelas: linhas, rlsFiltra } = {}) {
  const sessao = criarDuble({
    user: { id: EU },
    tabelas: linhas ?? tabelasDoCicloDoAuto(),
    ...(rlsFiltra ? { rlsFiltra } : {}),
  });
  globalThis.__dubleDeSupabase = { sessao: () => sessao.client };

  let resposta;
  try {
    resposta = await PAY.DELETE(
      {},
      { params: { id: "prev-do-auto" } }
    );
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  return { status: resposta.status, corpo: await resposta.json(), sessao };
}

/** Os UPDATEs que a rota mandou para `mybank_installments`. */
function patchesDaParcela(sessao) {
  return sessao.escritas.filter(
    (e) => e.tabela === "mybank_installments" && e.verbo === "update"
  );
}

/** As duas pernas que a baixa inseriu, na ordem. */
function pernas(sessao) {
  return sessao.escritas
    .filter((e) => e.tabela === "financial_transactions" && e.verbo === "insert")
    .map((e) => e.linhas[0]);
}

test("A BAIXA DA PREVISAO LEVA A PARCELA A `paid` -- o ciclo do Caso A fecha", async () => {
  const linhas = tabelasDoCicloDoAuto();
  const { status, corpo, sessao } = await pagarPrevisao({
    tabelas: linhas,
    corpo: { paid_date: "2027-01-12" },
  });

  assert.equal(status, 200);

  // O DINHEIRO PRIMEIRO: as duas pernas, e so duas.
  const [saida, entrada] = pernas(sessao);
  assert.equal(pernas(sessao).length, 2);
  assert.equal(saida.account_id, CORRENTE);
  assert.ok(saida.amount < 0, "a saida e NEGATIVA na conta corrente");
  assert.equal(entrada.account_id, INVESTIMENTO);
  assert.ok(entrada.amount > 0, "a entrada e POSITIVA na conta de investimento");

  // E A PARCELA. Um UPDATE, nesta tabela, com os tres campos.
  const patches = patchesDaParcela(sessao);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].patch.status, "paid");
  assert.equal(patches[0].patch.paid_date, "2027-01-12");
  // `mybank_installments_paid_check` e `(status='paid') = (paid_date IS NOT
  // NULL)`: `paid` sem data derruba a linha em 23514.
  assert.ok(patches[0].patch.paid_date);
  // ALCANCOU A LINHA: patch certo com filtro errado reescreve a tabela ou
  // nenhuma linha, e nos dois casos a resposta da rota e a mesma.
  assert.equal(patches[0].linhasAfetadas, 1);

  // E o estado final da linha semeada, que e o que o painel do MyBank le.
  assert.equal(linhas.mybank_installments[0].status, "paid");

  assert.equal(corpo.mybank_installment_id, "parcela-do-auto");
});

test("o elo aponta para a perna de ENTRADA, a da conta de investimento", async () => {
  const { sessao } = await pagarPrevisao();

  const [saida, entrada] = pernas(sessao);
  const patch = patchesDaParcela(sessao)[0].patch;

  // `paid_transaction_id` responde "onde foi que este dinheiro ENTROU", e e a
  // mesma coluna que no Caso B guarda a perna de entrada que o credor lanca.
  // Apontar para a saida faria a coluna querer dizer coisas opostas nos dois
  // casos -- e uma tela futura mostraria "a parcela 3 entrou na conta corrente"
  // com sinal negativo.
  assert.notEqual(
    saida.id,
    entrada.id,
    "as duas pernas tem ids diferentes -- sem isto esta assercao nao mediria nada"
  );
  assert.equal(patch.paid_transaction_id, entrada.id);
  assert.notEqual(patch.paid_transaction_id, saida.id);

  // E a previsao continua apontando para a SAIDA: e por ela que o estorno acha
  // a contraparte (`counterpart_transaction_id = transaction_id`).
  const baixaDaPrevisao = sessao.escritas.find(
    (e) => e.tabela === "scheduled_transactions" && e.verbo === "update"
  );
  assert.equal(baixaDaPrevisao.patch.transaction_id, saida.id);
});

test("a parcela e baixada ANTES da previsao: a falha nela nao deixa baixa sem parcela", async () => {
  const { sessao } = await pagarPrevisao();

  const ordem = sessao.escritas.map((e) => `${e.verbo}:${e.tabela}`);
  const parcela = ordem.indexOf("update:mybank_installments");
  const previsao = ordem.indexOf("update:scheduled_transactions");

  // A ORDEM E A FEATURE. Com a parcela DEPOIS, uma falha nela deixaria previsao
  // paga + dinheiro movido + parcela pendente -- o proprio defeito que a
  // HMO-382 fecha, e sem ninguem para consertar depois.
  assert.ok(parcela > -1 && previsao > -1);
  assert.ok(
    parcela < previsao,
    `a parcela tem de ser baixada antes da previsao; a ordem foi ${ordem.join(" > ")}`
  );
});

test("a parcela que a RLS nao deixa baixar DESFAZ as duas pernas -- nada fica lancado", async () => {
  const linhas = tabelasDoCicloDoAuto();
  const { status, corpo, sessao } = await pagarPrevisao({
    tabelas: linhas,
    // A unica resposta que a policy da quando ela nao casa com a linha: 200 com
    // corpo `[]`. A `mybank_installments_trava_do_devedor` (053) tambem recusa
    // -- com excecao -- quem nao e o credor.
    rlsFiltra: { mybank_installments: true },
  });

  assert.equal(status, 500);
  assert.match(corpo.error, /Nada foi lançado/i);

  // AS DUAS PERNAS FORAM APAGADAS, e a de ENTRADA primeiro: ela aponta para a
  // de saida e o FK e ON DELETE SET NULL.
  const apagadas = sessao.escritas.filter(
    (e) => e.tabela === "financial_transactions" && e.verbo === "delete"
  );
  assert.equal(apagadas.length, 2);

  // E A PREVISAO NAO FOI BAIXADA. Este e o estado que a posicao do passo 2.5
  // garante: "nao deu baixa", que a pessoa ve e refaz.
  assert.equal(
    sessao.escritas.some(
      (e) => e.tabela === "scheduled_transactions" && e.verbo === "update"
    ),
    false,
    "a previsao continua pendente"
  );
  assert.equal(linhas.scheduled_transactions[0].status, "pending");
});

test("previsao SEM elo do MyBank: a baixa segue igual e nao toca parcela nenhuma", async () => {
  // O CONTROLE NEGATIVO DA FEATURE. Sem ele, um `parcelaDaChaveDoMyBank` que
  // devolvesse o `notes` cru passaria verde: toda transferencia prevista tentaria
  // baixar uma parcela, e a de luz do mes que vem levaria 500.
  const linhas = tabelasDoCicloDoAuto({
    scheduled_transactions: [
      { ...PREVISAO_DO_AUTO, notes: "transferência pro investimento" },
    ],
  });

  const { status, corpo, sessao } = await pagarPrevisao({ tabelas: linhas });

  assert.equal(status, 200);
  assert.equal(corpo.message, "Transferência confirmada");
  assert.equal(corpo.mybank_installment_id, null);
  assert.equal(patchesDaParcela(sessao).length, 0);
  assert.equal(
    sessao.lidas.some((l) => l.tabela === "mybank_installments"),
    false,
    "sem elo nao ha nem leitura da tabela de parcelas"
  );
  // E o dinheiro andou do mesmo jeito.
  assert.equal(pernas(sessao).length, 2);
  assert.equal(linhas.scheduled_transactions[0].status, "paid");
});

test("`notes` que so CONTEM a palavra mybank nao e elo", async () => {
  // `notes` e campo digitado. Uma busca por prefixo em qualquer posicao faria
  // "paguei o mybank: 300 reais" virar elo para um id inventado.
  for (const notes of [
    "paguei o mybank: 300 reais",
    // ESTA e a que distingue `startsWith` de `includes`: com busca em qualquer
    // posicao, o `slice` do tamanho do prefixo devolveria "ank:p1" -- um id
    // inventado, que nao e vazio e nao tem espaco para a peneira seguinte pegar.
    "ver mybank:p1",
    "mybank:parcela do auto",
    "mybank:",
    "fatura:2027-01|cartao-1",
    null,
  ]) {
    assert.equal(
      LIB.parcelaDaChaveDoMyBank(notes),
      null,
      `${JSON.stringify(notes)} nao e chave de parcela`
    );
  }

  assert.equal(LIB.parcelaDaChaveDoMyBank("mybank:p1"), "p1");
  // O ida-e-volta: quem grava e quem le usam a MESMA chave.
  assert.equal(
    LIB.parcelaDaChaveDoMyBank(LIB.chaveDaParcelaDoMyBank("parcela-do-auto")),
    "parcela-do-auto"
  );
});

test("elo PENDURADO (a parcela nao existe mais) nao impede a transferencia", async () => {
  // Estado alcancavel: `mybank_loans_delete` (053) deixa apagar emprestimo sem
  // parcela paga, o CASCADE leva as parcelas, e as 24 previsoes ficam com
  // `notes` apontando para ids que nao existem mais. Recusar a baixa ali
  // transformaria "o MyBank nao sabe mais desta parcela" em "voce nao consegue
  // mais transferir o seu dinheiro".
  const linhas = tabelasDoCicloDoAuto({ mybank_installments: [] });

  const { status, corpo, sessao } = await pagarPrevisao({ tabelas: linhas });

  assert.equal(status, 200);
  assert.equal(corpo.mybank_installment_id, null);
  assert.equal(patchesDaParcela(sessao).length, 0);
  assert.equal(pernas(sessao).length, 2);
  assert.equal(linhas.scheduled_transactions[0].status, "paid");
});

test("parcela CANCELADA nao volta a `paid` por efeito colateral da baixa", async () => {
  const linhas = tabelasDoCicloDoAuto({
    mybank_installments: [{ ...PARCELA_DO_AUTO, status: "cancelled" }],
  });

  const { status, sessao } = await pagarPrevisao({ tabelas: linhas });

  assert.equal(status, 200);
  assert.equal(patchesDaParcela(sessao).length, 0);
  assert.equal(linhas.mybank_installments[0].status, "cancelled");
});

test("O ESTORNO DEVOLVE A PARCELA A `pending` -- e os tres campos juntos", async () => {
  const linhas = tabelasDoCicloDoAuto({
    scheduled_transactions: [
      {
        ...PREVISAO_DO_AUTO,
        status: "paid",
        paid_date: "2027-01-12",
        transaction_id: "tx-saida",
      },
    ],
    mybank_installments: [
      {
        ...PARCELA_DO_AUTO,
        status: "paid",
        paid_date: "2027-01-12",
        paid_transaction_id: "tx-entrada",
      },
    ],
    financial_transactions: [
      { id: "tx-saida", user_id: EU, amount: -1000 },
      {
        id: "tx-entrada",
        user_id: EU,
        amount: 1000,
        counterpart_transaction_id: "tx-saida",
      },
    ],
  });

  const { status, sessao } = await estornarPrevisao({ tabelas: linhas });

  assert.equal(status, 200);

  const patches = patchesDaParcela(sessao);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].patch.status, "pending");
  // OS TRES CAMPOS. `paid_date` e exigido pelo CHECK; `paid_transaction_id` e o
  // que impede a parcela pendente de apontar para um lancamento apagado -- o FK
  // e ON DELETE SET NULL, entao a coluna zeraria sozinha, mas o `status` NAO
  // volta sozinho e a parcela ficaria "paga" sem dinheiro.
  assert.equal(patches[0].patch.paid_date, null);
  assert.equal(patches[0].patch.paid_transaction_id, null);
  assert.equal(patches[0].linhasAfetadas, 1);

  assert.equal(linhas.mybank_installments[0].status, "pending");
  assert.equal(linhas.scheduled_transactions[0].status, "pending");
  // As duas pernas sairam.
  assert.equal(linhas.financial_transactions.length, 0);
});

test("o estorno desfaz a PARCELA primeiro: parcela presa nao apaga o dinheiro", async () => {
  const linhas = tabelasDoCicloDoAuto({
    scheduled_transactions: [
      {
        ...PREVISAO_DO_AUTO,
        status: "paid",
        paid_date: "2027-01-12",
        transaction_id: "tx-saida",
      },
    ],
    mybank_installments: [
      {
        ...PARCELA_DO_AUTO,
        status: "paid",
        paid_date: "2027-01-12",
        paid_transaction_id: "tx-entrada",
      },
    ],
    financial_transactions: [
      { id: "tx-saida", user_id: EU, amount: -1000 },
      {
        id: "tx-entrada",
        user_id: EU,
        amount: 1000,
        counterpart_transaction_id: "tx-saida",
      },
    ],
  });

  const { status, corpo, sessao } = await estornarPrevisao({
    tabelas: linhas,
    rlsFiltra: { mybank_installments: true },
  });

  assert.equal(status, 500);
  assert.match(corpo.error, /Nada foi estornado/i);

  // NADA FOI TOCADO. O contrario -- apagar as pernas e deixar a parcela paga --
  // seria emprestimo quitado de graca, pior que nao ter estornado.
  assert.equal(linhas.financial_transactions.length, 2);
  assert.equal(linhas.scheduled_transactions[0].status, "paid");
  assert.equal(
    sessao.escritas.some((e) => e.tabela === "financial_transactions"),
    false
  );
  assert.equal(
    sessao.escritas.some((e) => e.tabela === "scheduled_transactions"),
    false
  );
});

test("estorno de previsao SEM elo nao mexe em parcela nenhuma", async () => {
  const linhas = tabelasDoCicloDoAuto({
    scheduled_transactions: [
      {
        ...PREVISAO_DO_AUTO,
        notes: null,
        status: "paid",
        paid_date: "2027-01-12",
        transaction_id: "tx-saida",
      },
    ],
    financial_transactions: [{ id: "tx-saida", user_id: EU, amount: -1000 }],
  });

  const { status, sessao } = await estornarPrevisao({ tabelas: linhas });

  assert.equal(status, 200);
  assert.equal(patchesDaParcela(sessao).length, 0);
  assert.equal(linhas.scheduled_transactions[0].status, "pending");
});

test("estorno com elo PENDURADO: a parcela nao existe e o estorno acontece igual", async () => {
  // A outra metade do elo pendurado, do lado do desfazer. Aqui a tolerancia a
  // `null` e load-bearing e nao ha segunda guarda: um
  // `parcelaSegueAoEstornoDaPrevisao` que aceitasse a parcela ausente mandaria
  // um UPDATE para um id que nao existe, alcancaria zero linha e recusaria o
  // estorno -- a pessoa nao conseguiria mais desfazer a baixa.
  const linhas = tabelasDoCicloDoAuto({
    mybank_installments: [],
    scheduled_transactions: [
      {
        ...PREVISAO_DO_AUTO,
        status: "paid",
        paid_date: "2027-01-12",
        transaction_id: "tx-saida",
      },
    ],
    financial_transactions: [{ id: "tx-saida", user_id: EU, amount: -1000 }],
  });

  const { status, sessao } = await estornarPrevisao({ tabelas: linhas });

  assert.equal(status, 200);
  assert.equal(patchesDaParcela(sessao).length, 0);
  assert.equal(linhas.scheduled_transactions[0].status, "pending");
  assert.equal(linhas.financial_transactions.length, 0);
});

test("estorno repetido: a parcela ja pendente nao e tocada de novo", async () => {
  // O caminho de retentativa: a primeira tentativa devolveu a parcela e falhou
  // na soltura da previsao. Na segunda, `parcelaSegueAoEstornoDaPrevisao` ve
  // `pending` e nao refaz o UPDATE -- sem isto o estorno nao seria repetivel.
  const linhas = tabelasDoCicloDoAuto({
    scheduled_transactions: [
      {
        ...PREVISAO_DO_AUTO,
        status: "paid",
        paid_date: "2027-01-12",
        transaction_id: "tx-saida",
      },
    ],
    mybank_installments: [{ ...PARCELA_DO_AUTO, status: "pending" }],
    financial_transactions: [{ id: "tx-saida", user_id: EU, amount: -1000 }],
  });

  const { status, sessao } = await estornarPrevisao({ tabelas: linhas });

  assert.equal(status, 200);
  assert.equal(patchesDaParcela(sessao).length, 0);
  assert.equal(linhas.scheduled_transactions[0].status, "pending");
});

test("CONTROLE: a rota da baixa usou o duble (as assercoes de ausencia nao sao vacuas)", async () => {
  const { registro, sessao } = await pagarPrevisao();

  assert.ok(
    registro.chamadasDeSessao > 0,
    "a rota tem de ter pedido o client de sessao ao duble"
  );
  assert.equal(
    sessao.lidas.some((l) => l.tabela === "mybank_installments"),
    true,
    "e tem de ter ido a `mybank_installments` -- e dela que sai a decisao"
  );
});

// ---------------------------------------------------------------------------
// PARTE 5 -- A CHAVE DO PEDIDO: o segundo POST com o mesmo id (HMO-390, F1)
// ---------------------------------------------------------------------------
// O que esta parte mede e o caminho que NENHUMA trava de tela alcanca:
// recarregar a pagina e reenviar o mesmo formulario. A unicidade usada e a PK
// que a 053 ja tem -- nao ha migration nesta issue.

/** Um uuid qualquer, no formato que a coluna exige. */
const PEDIDO = "aaaaaaaa-1111-4111-b111-aaaaaaaaaaaa";

/** A violacao de PK que o Postgres devolve no segundo insert com o mesmo id. */
const DUPLICADA = {
  code: "23505",
  message:
    'duplicate key value violates unique constraint "mybank_loans_pkey"',
};

test("o id do pedido CHEGA ao insert, e nao e descartado no caminho", async () => {
  const { status, sessao } = await criarEmprestimo({
    ...CORPO_AUTO,
    id: PEDIDO,
  });

  assert.equal(status, 201);

  const insercoes = sessao.escritas.filter(
    (e) => e.tabela === "mybank_loans" && e.verbo === "insert"
  );
  assert.equal(insercoes.length, 1);

  // O `id` NO PAYLOAD. Sem esta assercao, o mutante que apaga o
  // `...(pedidoId ? { id: pedidoId } : {})` do insert sobrevive: a rota
  // continua respondendo 201, o emprestimo continua nascendo, e a idempotencia
  // simplesmente deixa de existir -- a coluna usa o `DEFAULT gen_random_uuid()`
  // e o reenvio cria a SEGUNDA divida sem nada parecer errado.
  assert.equal(
    insercoes[0].linhas[0].id,
    PEDIDO,
    "o insert nao levou o id do pedido: o reenvio criaria a segunda divida"
  );
});

test("sem id de pedido a coluna fica com o DEFAULT -- o insert nao manda `id: null`", async () => {
  const { status, sessao } = await criarEmprestimo(CORPO_AUTO);

  assert.equal(status, 201);

  const insercao = sessao.escritas.filter(
    (e) => e.tabela === "mybank_loans" && e.verbo === "insert"
  )[0];

  // `id: null` EXPLICITO derruba o `DEFAULT gen_random_uuid()` da coluna: o
  // Postgres recebe o NULL e recusa com 23502. Quem chama esta rota sem mandar
  // id (o PostgREST, as sondas que nao sabem desta issue) pararia de conseguir
  // emprestar -- entao a chave tem de estar AUSENTE, e nao nula.
  assert.ok(
    !Object.prototype.hasOwnProperty.call(insercao.linhas[0], "id") ||
      insercao.linhas[0].id === "mybank_loans-1",
    "o insert mandou `id` sem o cliente ter pedido: " +
      JSON.stringify(insercao.linhas[0])
  );
});

test("id de pedido que nao e uuid volta 400, e NAO 500", async () => {
  const { status, corpo, sessao } = await criarEmprestimo({
    ...CORPO_AUTO,
    id: "abc",
  });

  // `"abc"` numa coluna uuid e `22P02 invalid input syntax`, que esta rota
  // devolveria como 500 "erro interno" -- um pedido malformado que nao se le
  // como pedido malformado em log nenhum.
  assert.equal(status, 400);
  assert.match(corpo.error, /UUID/i);

  // E nada foi gravado: a peneira e ANTES do insert.
  assert.equal(
    sessao.escritas.some((e) => e.tabela === "mybank_loans"),
    false,
    "a rota gravou algo antes de recusar o id malformado"
  );
});

test("o SEGUNDO POST com o mesmo id devolve 200 com o emprestimo que ja existe", async () => {
  // O emprestimo que o PRIMEIRO POST gravou, e que a PK vai recusar de novo.
  const sessao = criarDuble({
    user: { id: EU },
    tabelas: tabelas({
      mybank_loans: [
        {
          id: PEDIDO,
          lender_user_id: EU,
          borrower_user_id: EU,
          principal: 24000,
          installment_count: 24,
        },
      ],
      // As 24 parcelas que ja existem: a contagem da resposta vem DAQUI, e nao
      // de `parcelas` do pedido.
      mybank_installments: Array.from({ length: 24 }, (_, i) => ({
        id: `p-${i + 1}`,
        loan_id: PEDIDO,
      })),
    }),
    // SO o insert falha. A tabela continua legivel, que e o que a rota faz em
    // seguida -- ver `erroDeInsert` em `scripts/duble-de-supabase.mjs`.
    errosDeInsert: { mybank_loans: DUPLICADA },
  });
  globalThis.__dubleDeSupabase = { sessao: () => sessao.client };

  let resposta;
  try {
    resposta = await LOANS.POST({
      // `parcelas: 12` CONTRA AS 24 QUE JA EXISTEM, de proposito.
      //
      // A rota promete que a contagem da resposta vem do BANCO e nao do pedido,
      // e com os dois numeros iguais essa promessa nao tem como ser medida: um
      // `total_de_parcelas: numeroDeParcelas` passaria verde. O cenario e o que
      // o comentario da rota descreve -- o primeiro POST morreu entre o passo 1
      // e o passo 2, e o reenvio pede outra coisa.
      json: async () => ({ ...CORPO_AUTO, id: PEDIDO, parcelas: 12 }),
    });
  } finally {
    delete globalThis.__dubleDeSupabase;
  }
  const corpo = await resposta.json();

  // 200, E NAO 500 NEM 201: nada foi gravado AGORA, e o pedido nao e um erro.
  assert.equal(resposta.status, 200, JSON.stringify(corpo));
  assert.equal(corpo.success, true);
  assert.equal(corpo.ja_existia, true);
  assert.equal(corpo.loan_id, PEDIDO);
  assert.match(corpo.message, /já tinha sido criado/i);

  // A CONTAGEM VEM DO BANCO (24), E NAO DO PEDIDO (12). Se ela viesse do
  // pedido, a resposta mentiria sobre uma divida que o primeiro POST pode ter
  // deixado incompleta.
  assert.equal(
    corpo.total_de_parcelas,
    24,
    "a contagem saiu do pedido e nao do banco"
  );

  // E NADA DE NOVO FOI GRAVADO -- nem parcela, nem previsao. Sem esta
  // assercao, uma rota que caisse no 200 DEPOIS de inserir as 24 parcelas de
  // novo passaria verde, e a divida ficaria com 48.
  for (const tabela of [
    "mybank_installments",
    "scheduled_transactions",
    "financial_transactions",
  ]) {
    assert.equal(
      sessao.escritas.some((e) => e.tabela === tabela && e.verbo === "insert"),
      false,
      `o caminho idempotente inseriu em ${tabela}`
    );
  }
});

test("id que colide com emprestimo em que eu sou DEVEDOR volta 409, e nao vaza a linha", async () => {
  // A ARMADILHA DA ISSUE, e ela e de privacidade E de dinheiro.
  //
  // A policy de SELECT da 053 e `lender OR borrower`: esta linha PASSA pela
  // policy para mim, porque eu sou o devedor dela. Um re-`select` nu por id
  // devolveria 200 com um emprestimo que eu DEVO, e a tela diria "criado"
  // mostrando a divida de outra pessoa. Familia
  // `o .select() mente em linha alheia`.
  const sessao = criarDuble({
    user: { id: EU },
    tabelas: tabelas({
      mybank_loans: [
        {
          id: PEDIDO,
          lender_user_id: LAIS,
          borrower_user_id: EU,
          principal: 99999,
          installment_count: 60,
        },
      ],
    }),
    errosDeInsert: { mybank_loans: DUPLICADA },
  });
  globalThis.__dubleDeSupabase = { sessao: () => sessao.client };

  let resposta;
  try {
    resposta = await LOANS.POST({
      json: async () => ({ ...CORPO_AUTO, id: PEDIDO }),
    });
  } finally {
    delete globalThis.__dubleDeSupabase;
  }
  const corpo = await resposta.json();

  assert.equal(resposta.status, 409, JSON.stringify(corpo));

  // NADA DA LINHA ALHEIA NA RESPOSTA. A assercao e sobre o corpo INTEIRO
  // serializado, e nao sobre campos escolhidos: `loan_id` ausente nao prova que
  // o `principal` tambem esta, e e o conjunto que a issue exige.
  const serializado = JSON.stringify(corpo);
  for (const vazamento of [PEDIDO, LAIS, "99999", "60"]) {
    assert.ok(
      !serializado.includes(vazamento),
      `o 409 vazou ${vazamento} da linha alheia: ${serializado}`
    );
  }
  assert.equal(corpo.success, undefined);
  assert.equal(corpo.loan_id, undefined);
  assert.match(corpo.error, /Tente de novo/i);
});

// ---------------------------------------------------------------------------
// PARTE 9 -- PATCH /api/mybank/loans/[id]: o CANCELAMENTO (HMO-391, F3)
// ---------------------------------------------------------------------------
// O que esta parte existe para impedir, e as quatro coisas sao dinheiro errado:
//
//   1. A PARCELA `paid` SER REESCRITA PARA `cancelled`. Ela tem (ou teve) perna
//      em `financial_transactions`: o dinheiro saiu da conta corrente e entrou
//      na de investimento. Cancelar essa parcela apaga o fato e deixa o saldo
//      sem nada que o explique -- e nada no caminho reclama, porque
//      `mybank_installments_paid_check` so compara `status = 'paid'` com
//      `paid_date IS NOT NULL` e o UPDATE que mexe nos dois passa.
//
//   2. A PREVISAO JA PAGA SER APAGADA. Mesma familia, do outro lado do elo: a
//      previsao baixada e o registro da transferencia que aconteceu. Apagar a
//      linha deixa as duas pernas orfas no extrato.
//
//   3. O `.in` COM LISTA VAZIA. No Caso B nao ha previsao nenhuma do meu lado, e
//      `.in("notes", [])` no PostgREST NAO filtra: o DELETE alcanca toda
//      previsao pendente que a RLS entrega -- a agenda inteira de Contas a Pagar
//      vai embora, com 200 na tela. A guarda e o `.length`, e o teste do Caso B
//      e quem a mede.
//
//   4. O DEVEDOR RECEBER "CANCELADO" SEM NADA TER MUDADO. `mybank_loans_select`
//      e `lender OR borrower`, entao ele LE a linha; e UPDATE que a policy
//      filtra volta 200 com corpo vazio. Sem a pergunta de credor a rota
//      responderia sucesso de uma escrita que nao aconteceu.
//
// A ORDEM TAMBEM E MEDIDA (`assercao-de-ORDEM-por-indexof`), porque ela e a
// direcao da falha parcial: emprestimo -> parcelas -> previsoes. Invertida, a
// divida ficaria viva sem as contas a pagar dela -- dinheiro subestimado, e
// ninguem reporta.

const CANCELA = await import(
  "../.tmp-emprestimo-do-mybank/app/api/mybank/loans/[id]/route.js"
);

/**
 * O Caso A do cancelamento: 3 parcelas, a 1 JA PAGA, e uma previsao por parcela
 * -- a da parcela paga tambem ja baixada.
 *
 * A PARCELA PAGA E A PREVISAO PAGA ESTAO NO FIXTURE DE PROPOSITO: elas sao o
 * controle negativo desta issue. Sem elas, "cancelar tudo" e "cancelar o que
 * esta em aberto" alcancam o MESMO conjunto, e os dois mutantes principais
 * sobrevivem (`mutante-de-ramo-de-passagem-exige-fixture-do-outro-ramo`).
 */
const PARCELAS_DO_AUTO_A_CANCELAR = [
  {
    id: "p-paga",
    loan_id: "loan-auto",
    installment_number: 1,
    installment_total: 3,
    amount: 1000,
    due_date: "2026-11-10",
    status: "paid",
    reported_at: null,
    paid_date: "2026-11-11",
    paid_transaction_id: "tx-da-paga",
  },
  {
    id: "p-pendente",
    loan_id: "loan-auto",
    installment_number: 2,
    installment_total: 3,
    amount: 1000,
    due_date: "2026-12-10",
    status: "pending",
    reported_at: null,
    paid_date: null,
    paid_transaction_id: null,
  },
  {
    id: "p-avisada",
    loan_id: "loan-auto",
    installment_number: 3,
    installment_total: 3,
    amount: 1000,
    due_date: "2027-01-10",
    // `reported` tambem e "em aberto": o devedor avisou e o credor nao
    // confirmou. Sem esta linha um criterio `status === "pending"` passaria.
    status: "reported",
    reported_at: "2027-01-09T00:00:00Z",
    paid_date: null,
    paid_transaction_id: null,
  },
];

function previsaoDaParcela(parcelaId, status, extra = {}) {
  return {
    ...PREVISAO_DO_AUTO,
    id: `prev-${parcelaId}`,
    notes: `mybank:${parcelaId}`,
    status,
    ...extra,
  };
}

const PREVISOES_DO_AUTO_A_CANCELAR = [
  // A previsao da parcela paga: JA BAIXADA. Fato consumado -- fica.
  previsaoDaParcela("p-paga", "paid", {
    paid_date: "2026-11-11",
    transaction_id: "tx-da-paga",
  }),
  previsaoDaParcela("p-pendente", "pending"),
  previsaoDaParcela("p-avisada", "pending"),
  // A VIZINHA: previsao pendente MINHA que nao e do MyBank. Sem ela, "apagar as
  // previsoes do emprestimo" e "apagar a agenda" sao o mesmo conjunto, e o
  // mutante que tira a guarda do `.length` sobrevive.
  {
    ...PREVISAO_DO_AUTO,
    id: "prev-alheia",
    description: "Aluguel",
    notes: null,
    status: "pending",
  },
];

function tabelasDoCancelamento(extra = {}) {
  return tabelas({
    mybank_loans: [{ ...EMPRESTIMO_DO_AUTO }],
    mybank_installments: PARCELAS_DO_AUTO_A_CANCELAR.map((p) => ({ ...p })),
    scheduled_transactions: PREVISOES_DO_AUTO_A_CANCELAR.map((p) => ({ ...p })),
    ...extra,
  });
}

async function cancelarEmprestimo({
  quem = EU,
  loanId = "loan-auto",
  corpo = { status: "cancelled" },
  tabelas: linhas,
  erros,
  rlsFiltra,
} = {}) {
  const sessao = criarDuble({
    user: { id: quem },
    tabelas: linhas ?? tabelasDoCancelamento(),
    ...(erros ? { erros } : {}),
    ...(rlsFiltra ? { rlsFiltra } : {}),
  });
  const registro = { sessao: () => sessao.client };
  globalThis.__dubleDeSupabase = registro;

  let resposta;
  try {
    resposta = await CANCELA.PATCH(
      { json: async () => corpo },
      { params: { id: loanId } }
    );
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  return { status: resposta.status, corpo: await resposta.json(), sessao, registro };
}

/** Os ids que um UPDATE/DELETE alcancou, pelo filtro `.in` que a rota montou. */
function idsDoFiltroIn(escrita, coluna) {
  const achado = (escrita.filtros ?? []).find(
    ([op, c]) => op === "in" && c === coluna
  );
  return achado ? achado[2] : null;
}

function escritasEm(sessao, tabela, verbo) {
  return sessao.escritas.filter((e) => e.tabela === tabela && e.verbo === verbo);
}

test("CASO A: o emprestimo vira `cancelled`, as abertas tambem, e a PAGA fica paga", async () => {
  const linhas = tabelasDoCancelamento();
  const { status, corpo, sessao } = await cancelarEmprestimo({ tabelas: linhas });

  assert.equal(status, 200, JSON.stringify(corpo));

  // 1. O EMPRESTIMO. As duas leituras do MyBank filtram `active`, entao e este
  // UPDATE que tira a divida das duas telas.
  const [doEmprestimo] = escritasEm(sessao, "mybank_loans", "update");
  assert.equal(doEmprestimo.patch.status, "cancelled");
  assert.equal(doEmprestimo.linhasAfetadas, 1);
  assert.equal(linhas.mybank_loans[0].status, "cancelled");

  // 2. AS PARCELAS, e o `.in` LISTA SO AS DUAS EM ABERTO.
  const [dasParcelas] = escritasEm(sessao, "mybank_installments", "update");
  assert.equal(dasParcelas.patch.status, "cancelled");
  assert.deepEqual(idsDoFiltroIn(dasParcelas, "id").sort(), [
    "p-avisada",
    "p-pendente",
  ]);
  assert.equal(dasParcelas.linhasAfetadas, 2);

  // O PATCH DA PARCELA NAO MEXE EM MAIS NADA: `paid_date` e
  // `paid_transaction_id` fora do patch e o que mantem o CHECK da 053 em paz e
  // o que impede este caminho de apagar carimbo de pagamento.
  assert.deepEqual(Object.keys(dasParcelas.patch), ["status"]);

  // 3. O CONTROLE NEGATIVO DA ISSUE, lido na TABELA e nao na resposta.
  const porId = new Map(linhas.mybank_installments.map((p) => [p.id, p]));
  assert.equal(porId.get("p-paga").status, "paid");
  assert.equal(porId.get("p-paga").paid_date, "2026-11-11");
  assert.equal(porId.get("p-paga").paid_transaction_id, "tx-da-paga");
  assert.equal(porId.get("p-pendente").status, "cancelled");
  assert.equal(porId.get("p-avisada").status, "cancelled");

  // 4. AS PREVISOES: as duas pendentes do elo saem; a paga e a alheia ficam.
  const [doDelete] = escritasEm(sessao, "scheduled_transactions", "delete");
  assert.deepEqual(idsDoFiltroIn(doDelete, "notes").sort(), [
    "mybank:p-avisada",
    "mybank:p-pendente",
  ]);
  assert.equal(doDelete.linhasAfetadas, 2);

  const sobraram = linhas.scheduled_transactions.map((p) => p.id).sort();
  assert.deepEqual(sobraram, ["prev-alheia", "prev-p-paga"]);

  assert.equal(corpo.parcelas_canceladas, 2);
  assert.equal(corpo.parcelas_pagas_intactas, 1);
  assert.equal(corpo.previsoes_apagadas, 2);
});

test("a previsao JA PAGA do elo NAO e apagada -- o `status = pending` esta no DELETE", async () => {
  // O ELO DA PARCELA PAGA PRECISA ENTRAR NO `.in`, e e isso que este fixture
  // arranja: aqui `p-paga` esta PENDENTE (entao ela e cancelada e o elo dela vai
  // para a lista) e a PREVISAO dela ja foi baixada. E o unico arranjo em que o
  // filtro de `status` decide sozinho -- com a parcela paga o elo nem chegava a
  // lista, e o teste mediria o passo 3 achando que mede o 4
  // (`mutante-de-ramo-de-passagem-exige-fixture-do-outro-ramo`).
  const linhas = tabelasDoCancelamento({
    mybank_installments: [
      {
        ...PARCELAS_DO_AUTO_A_CANCELAR[0],
        status: "pending",
        paid_date: null,
        paid_transaction_id: null,
      },
    ],
  });

  const { status, corpo, sessao } = await cancelarEmprestimo({ tabelas: linhas });

  assert.equal(status, 200, JSON.stringify(corpo));

  const [doDelete] = escritasEm(sessao, "scheduled_transactions", "delete");
  assert.deepEqual(idsDoFiltroIn(doDelete, "notes"), ["mybank:p-paga"]);

  // O FILTRO ESTA NO PEDIDO...
  assert.ok(
    (doDelete.filtros ?? []).some(
      ([op, coluna, valor]) =>
        op === "eq" && coluna === "status" && valor === "pending"
    ),
    `o DELETE das previsoes nao filtrou por status pendente: ${JSON.stringify(
      doDelete.filtros
    )}`
  );

  // ...E A LINHA CONTINUA LA, que e a assercao que vale: previsao baixada e o
  // registro da transferencia que aconteceu, e apaga-la deixaria as duas pernas
  // orfas no extrato.
  const paga = linhas.scheduled_transactions.find((p) => p.id === "prev-p-paga");
  assert.ok(paga, "a previsao ja paga foi apagada pelo cancelamento");
  assert.equal(paga.status, "paid");
  assert.equal(paga.transaction_id, "tx-da-paga");
  assert.equal(doDelete.linhasAfetadas, 0);
  assert.equal(corpo.previsoes_apagadas, 0);
});

test("A ORDEM: o emprestimo sai de `active` ANTES de a previsao ser apagada", async () => {
  const { sessao } = await cancelarEmprestimo();

  const ordem = sessao.escritas.map((e) => `${e.tabela}:${e.verbo}`);
  const doEmprestimo = ordem.indexOf("mybank_loans:update");
  const dasParcelas = ordem.indexOf("mybank_installments:update");
  const dasPrevisoes = ordem.indexOf("scheduled_transactions:delete");

  assert.ok(doEmprestimo >= 0 && dasParcelas >= 0 && dasPrevisoes >= 0, ordem.join(" > "));

  // A DIRECAO DA FALHA PARCIAL, escrita como assercao: quebrar no meio desta
  // ordem deixa previsao orfa em Contas a Pagar (a pessoa e cobrada e PERCEBE).
  // A ordem inversa deixaria a divida viva sem as contas a pagar -- dinheiro
  // subestimado, e ninguem reporta.
  assert.ok(
    doEmprestimo < dasParcelas,
    `o emprestimo tem de ser cancelado antes das parcelas: ${ordem.join(" > ")}`
  );
  assert.ok(
    dasParcelas < dasPrevisoes,
    `as parcelas tem de ser canceladas antes de as previsoes serem apagadas: ${ordem.join(" > ")}`
  );
});

test("CASO B: NENHUM delete em `scheduled_transactions` -- a guarda da lista vazia", async () => {
  const linhas = tabelasDoCancelamento({
    mybank_loans: [{ ...EMPRESTIMO_PARA_A_LAIS }],
    mybank_installments: [{ ...PARCELA_DA_LAIS }],
    // A agenda da pessoa, intacta e pendente: e ela que um `.in("notes", [])`
    // levaria embora inteira.
    scheduled_transactions: [
      { ...PREVISAO_DO_AUTO, id: "prev-aluguel", notes: null, status: "pending" },
      { ...PREVISAO_DO_AUTO, id: "prev-luz", notes: null, status: "pending" },
    ],
  });

  const { status, corpo, sessao } = await cancelarEmprestimo({
    loanId: "loan-lais",
    tabelas: linhas,
  });

  assert.equal(status, 200, JSON.stringify(corpo));
  assert.equal(corpo.caso, "conexao");

  // A ASSERCAO E A AUSENCIA DO DELETE, e nao "nada foi apagado": um DELETE que
  // por sorte nao casou com nenhuma linha passaria pela segunda e nao pela
  // primeira -- e e o DELETE emitido que apaga a agenda quando o fixture tem
  // previsao com `notes` nulo.
  assert.equal(escritasEm(sessao, "scheduled_transactions", "delete").length, 0);
  assert.equal(corpo.previsoes_apagadas, 0);
  assert.deepEqual(
    linhas.scheduled_transactions.map((p) => p.id).sort(),
    ["prev-aluguel", "prev-luz"]
  );

  // E a divida sai da tela DELA pelo status do emprestimo, que e o unico passo
  // que o Caso B precisa.
  assert.equal(linhas.mybank_loans[0].status, "cancelled");
  assert.equal(linhas.mybank_installments[0].status, "cancelled");

  // A frase diz o que mudou no lado dela, com o nome.
  assert.match(corpo.message, /Laís Bernucio/);
});

test("quem NAO e o credor recebe recusa explicita, e nada e escrito", async () => {
  const linhas = tabelasDoCancelamento({
    mybank_loans: [{ ...EMPRESTIMO_PARA_A_LAIS }],
    mybank_installments: [{ ...PARCELA_DA_LAIS }],
  });

  const { status, corpo, sessao } = await cancelarEmprestimo({
    quem: LAIS,
    loanId: "loan-lais",
    tabelas: linhas,
  });

  // 403 EXPLICITO, e nao 200 de uma escrita que a RLS filtrou.
  assert.equal(status, 403);
  assert.match(corpo.error, /Só quem emprestou/i);
  assert.equal(corpo.success, undefined);
  assert.equal(sessao.escritas.length, 0);
  assert.equal(linhas.mybank_loans[0].status, "active");
});

test("a recusa ao devedor nao conta o ESTADO da divida (nem `settled` nem `cancelled`)", async () => {
  const { status, corpo } = await cancelarEmprestimo({
    quem: LAIS,
    loanId: "loan-lais",
    tabelas: tabelasDoCancelamento({
      mybank_loans: [{ ...EMPRESTIMO_PARA_A_LAIS, status: "settled" }],
      mybank_installments: [{ ...PARCELA_DA_LAIS }],
    }),
  });

  // A ORDEM DAS PERGUNTAS E A RESPOSTA: "nao e seu" vem antes de "ja quitado",
  // senao a mensagem de erro conta o estado da divida de outra pessoa.
  assert.equal(status, 403);
  assert.doesNotMatch(corpo.error, /quitado|cancelado/i);
});

test("emprestimo JA CANCELADO e recusado com frase propria, e nao cancela de novo", async () => {
  const linhas = tabelasDoCancelamento({
    mybank_loans: [{ ...EMPRESTIMO_DO_AUTO, status: "cancelled" }],
  });

  const { status, corpo, sessao } = await cancelarEmprestimo({ tabelas: linhas });

  assert.equal(status, 409);
  assert.match(corpo.error, /já está cancelado/i);
  assert.equal(sessao.escritas.length, 0);
});

test("emprestimo JA QUITADO tem frase DIFERENTE da do cancelado", async () => {
  const { status, corpo } = await cancelarEmprestimo({
    tabelas: tabelasDoCancelamento({
      mybank_loans: [{ ...EMPRESTIMO_DO_AUTO, status: "settled" }],
    }),
  });

  assert.equal(status, 409);
  // Dizer "ja cancelado" de um emprestimo quitado desmente o banco para quem
  // acabou de receber a ultima parcela.
  assert.match(corpo.error, /quitado/i);
  assert.doesNotMatch(corpo.error, /já está cancelado/i);
});

test("o UPDATE do emprestimo filtrado pela RLS NAO responde sucesso", async () => {
  const linhas = tabelasDoCancelamento();
  const { status, corpo, sessao } = await cancelarEmprestimo({
    tabelas: linhas,
    // A resposta medida em producao: 200 com corpo vazio, sem erro nenhum.
    rlsFiltra: { mybank_loans: true },
  });

  assert.equal(status, 500);
  assert.equal(corpo.success, undefined);
  assert.match(corpo.error, /Nada foi alterado/i);

  // E O PASSO 3 NAO ACONTECE: parcela cancelada de um emprestimo que continua
  // ativo e o pior dos dois estados -- a divida aparece nas telas sem nenhuma
  // parcela a pagar.
  assert.equal(escritasEm(sessao, "mybank_installments", "update").length, 0);
  assert.equal(escritasEm(sessao, "scheduled_transactions", "delete").length, 0);
  assert.equal(linhas.mybank_installments[1].status, "pending");
});

test("as parcelas que a RLS nao deixa cancelar NAO levam as previsoes embora", async () => {
  const linhas = tabelasDoCancelamento();
  const { status, corpo, sessao } = await cancelarEmprestimo({
    tabelas: linhas,
    rlsFiltra: { mybank_installments: true },
  });

  // O emprestimo JA esta cancelado e isso nao e desfeito -- ressuscitar a
  // divida por causa do passo seguinte seria trocar um erro visivel por outro.
  assert.equal(status, 500);
  assert.equal(linhas.mybank_loans[0].status, "cancelled");
  assert.match(corpo.error, /continuam em aberto/i);
  assert.equal(corpo.parcelas_em_aberto, 2);

  // A PREVISAO DA PARCELA QUE CONTINUOU EM ABERTO FICA. Apaga-la seria a
  // direcao de falha que esta ordem existe para evitar: cobranca invisivel.
  assert.equal(escritasEm(sessao, "scheduled_transactions", "delete").length, 0);
  assert.equal(linhas.scheduled_transactions.length, 4);
});

test("a linha DEVOLVIDA pelo UPDATE e conferida: credor diferente volta 500", async () => {
  // O FIXTURE E UM ESTADO QUE A CHAVE PRIMARIA PROIBE, e isso esta escrito aqui
  // de proposito: duas linhas de `mybank_loans` com o mesmo id. Nenhum caminho
  // de producao chega nele hoje -- a pergunta do passo 1 ja barrou o devedor, e
  // a PK impede o homonimo.
  //
  // E a conferencia continua valendo a linha que ocupa: ela e sobre o UPDATE QUE
  // ACONTECEU, e nao sobre a linha que foi lida antes dele. O que ela protege e
  // o dia em que `mybank_loans_update` afrouxar (uma policy que passe a aceitar
  // o devedor, um `OR` novo) -- e este e o unico arranjo em que a sonda alcanca
  // essa guarda. Sem este teste a linha ficaria sem medicao nenhuma, e um
  // mutante que a apagasse sobreviveria dizendo "nenhuma assercao protege isto".
  const linhas = tabelasDoCancelamento({
    mybank_loans: [
      { ...EMPRESTIMO_DO_AUTO },
      { ...EMPRESTIMO_DO_AUTO, lender_user_id: LAIS, borrower_user_id: LAIS },
    ],
  });

  const { status, corpo, sessao } = await cancelarEmprestimo({ tabelas: linhas });

  assert.equal(status, 500);
  assert.equal(corpo.success, undefined);

  // E O PASSO 3 NAO ACONTECE: a rota para na conferencia, antes de mexer em
  // parcela nenhuma.
  assert.equal(escritasEm(sessao, "mybank_installments", "update").length, 0);
  assert.equal(escritasEm(sessao, "scheduled_transactions", "delete").length, 0);
});

test("emprestimo com TODAS as parcelas pagas: nao ha `.in` vazio em parcela nenhuma", async () => {
  const linhas = tabelasDoCancelamento({
    mybank_installments: [{ ...PARCELAS_DO_AUTO_A_CANCELAR[0] }],
    scheduled_transactions: [
      previsaoDaParcela("p-paga", "paid", {
        paid_date: "2026-11-11",
        transaction_id: "tx-da-paga",
      }),
      { ...PREVISAO_DO_AUTO, id: "prev-alheia", notes: null, status: "pending" },
    ],
  });

  const { status, corpo, sessao } = await cancelarEmprestimo({ tabelas: linhas });

  assert.equal(status, 200, JSON.stringify(corpo));
  assert.equal(linhas.mybank_loans[0].status, "cancelled");

  // SEM UPDATE DE PARCELA E SEM DELETE: um `.in("id", [])` aqui alcancaria toda
  // parcela que a RLS entrega -- inclusive as pagas de OUTROS emprestimos meus.
  assert.equal(escritasEm(sessao, "mybank_installments", "update").length, 0);
  assert.equal(escritasEm(sessao, "scheduled_transactions", "delete").length, 0);
  assert.equal(linhas.mybank_installments[0].status, "paid");
  assert.equal(linhas.scheduled_transactions.length, 2);
  assert.equal(corpo.parcelas_canceladas, 0);
  assert.equal(corpo.parcelas_pagas_intactas, 1);
});

test("corpo sem `status: cancelled` e recusado, e a rota nao edita a divida", async () => {
  for (const corpo of [
    {},
    { status: "settled" },
    { status: "active" },
    // O ataque: encolher a divida pelo mesmo PATCH que encerra.
    { status: "cancelled!", principal: 1, installment_count: 1 },
  ]) {
    const linhas = tabelasDoCancelamento();
    const r = await cancelarEmprestimo({ corpo, tabelas: linhas });

    assert.equal(r.status, 400, JSON.stringify(corpo));
    assert.match(r.corpo.error, /cancelled/);
    assert.equal(r.sessao.escritas.length, 0);
    assert.equal(linhas.mybank_loans[0].status, "active");
  }
});

test("o PATCH nunca grava campo nenhum do corpo no emprestimo", async () => {
  const linhas = tabelasDoCancelamento();
  const { status, sessao } = await cancelarEmprestimo({
    corpo: {
      status: "cancelled",
      principal: 1,
      installment_count: 1,
      borrower_user_id: LAIS,
      lender_user_id: LAIS,
      lender_account_id: "conta-da-lais",
    },
    tabelas: linhas,
  });

  assert.equal(status, 200);

  // A defesa e a AUSENCIA: `status` e o unico campo que este arquivo le do
  // corpo, em ramo nenhum. Nao ha `delete patch.principal` para alguem remover.
  const [doEmprestimo] = escritasEm(sessao, "mybank_loans", "update");
  assert.deepEqual(Object.keys(doEmprestimo.patch), ["status"]);
  assert.equal(linhas.mybank_loans[0].principal, 24000);
  assert.equal(linhas.mybank_loans[0].borrower_user_id, EU);
});

test("emprestimo que nao e meu nem e divida minha volta 404, e nao 403", async () => {
  const { status, corpo, sessao } = await cancelarEmprestimo({
    loanId: "loan-de-ninguem",
  });

  assert.equal(status, 404);
  assert.match(corpo.error, /não encontrado/i);
  assert.equal(sessao.escritas.length, 0);
});

test("CONTROLE: a rota do cancelamento usou o duble (as ausencias nao sao vacuas)", async () => {
  const { sessao } = await cancelarEmprestimo();

  // Sem este controle, um `__dubleDeSupabase` que nao chegasse a rota faria
  // TODA assercao de ausencia desta parte passar verde sem medir nada.
  assert.ok(sessao.lidas.length > 0, "a rota nao leu nada pelo duble");
  assert.ok(
    sessao.escritas.length >= 3,
    `a rota escreveu menos do que os tres passos: ${JSON.stringify(
      sessao.escritas.map((e) => `${e.tabela}:${e.verbo}`)
    )}`
  );
});

// ---------------------------------------------------------------------------
// PARTE 10 -- as frases do cancelamento (funcao pura)
// ---------------------------------------------------------------------------

test("o aviso do `confirm()` diz o que o cancelamento NAO faz", () => {
  const aviso = LIB.avisoDoCancelamento({
    descricao: "Moto elétrica",
    caso: "auto",
    nomeDoDevedor: null,
  });

  assert.match(aviso, /Moto elétrica/);
  assert.match(aviso, /Contas a Pagar/i);
  assert.match(aviso, /já pagas continuam pagas/i);
  // AS DUAS NEGATIVAS, e elas sao a razao de este texto ter teste: quem cancela
  // achando que esta quitando ve a divida desaparecer e conclui que pagou.
  assert.match(aviso, /NÃO registra pagamento/);
  assert.match(aviso, /NÃO amortiza/);
});

test("no Caso B o aviso diz que a tela que muda e a de OUTRA pessoa", () => {
  const aviso = LIB.avisoDoCancelamento({
    descricao: "Moto elétrica",
    caso: "conexao",
    nomeDoDevedor: "Laís",
  });

  assert.match(aviso, /tela de Laís/);
  assert.match(aviso, /NÃO registra pagamento/);
});

test("aviso do Caso B sem nome legivel nao mostra `null`", () => {
  const aviso = LIB.avisoDoCancelamento({
    descricao: "Moto elétrica",
    caso: "conexao",
    nomeDoDevedor: null,
  });

  assert.doesNotMatch(aviso, /null|undefined/);
  assert.match(aviso, /quem deve/i);
});

test("a mensagem do cancelamento conta os DOIS lados, e nomeia quem deixa de ser cobrado", () => {
  const doCasoB = LIB.mensagemDoCancelamento({
    caso: "conexao",
    quantasCanceladas: 23,
    quantasPagas: 1,
    previsoesApagadas: 0,
    nomeDoDevedor: "Laís",
  });

  assert.match(doCasoB, /23 parcelas canceladas/);
  assert.match(doCasoB, /despesas de Laís/);
  assert.match(doCasoB, /já paga continua paga/);

  const doCasoA = LIB.mensagemDoCancelamento({
    caso: "auto",
    quantasCanceladas: 2,
    quantasPagas: 0,
    previsoesApagadas: 2,
    nomeDoDevedor: null,
  });

  assert.match(doCasoA, /2 parcelas canceladas/);
  assert.match(doCasoA, /2 contas a pagar saíram/i);
  // Sem parcela paga, a frase NAO inventa a oracao sobre elas. O padrao e a
  // ORACAO e nao a palavra: "contas a pagar" contem "paga", e um
  // `doesNotMatch(/paga/i)` reprovaria a frase certa.
  assert.doesNotMatch(doCasoA, /continuam? paga/i);
});

test("`parcelaSegueOCancelamento`: so `pending` e `reported`", () => {
  assert.equal(LIB.parcelaSegueOCancelamento({ status: "pending" }), true);
  assert.equal(LIB.parcelaSegueOCancelamento({ status: "reported" }), true);
  // As duas que NAO podem entrar: a paga (apagaria historico de dinheiro) e a
  // ja cancelada (cancelar duas vezes nao tem segundo efeito).
  assert.equal(LIB.parcelaSegueOCancelamento({ status: "paid" }), false);
  assert.equal(LIB.parcelaSegueOCancelamento({ status: "cancelled" }), false);
});

test("`chavesDasPrevisoesDoCancelamento`: Caso A tem chave por parcela, Caso B e vazio", () => {
  assert.deepEqual(
    LIB.chavesDasPrevisoesDoCancelamento({
      caso: "auto",
      parcelasCanceladas: [{ id: "p1" }, { id: "p2" }],
    }),
    ["mybank:p1", "mybank:p2"]
  );

  // O Caso B nunca gravou previsao minha: a lista e vazia POR DECISAO, e e o
  // `.length` de quem chama que impede o `.in` vazio de apagar a agenda.
  assert.deepEqual(
    LIB.chavesDasPrevisoesDoCancelamento({
      caso: "conexao",
      parcelasCanceladas: [{ id: "p1" }],
    }),
    []
  );
});

test("`problemaDoCancelamento`: o credor passa, o devedor nao, e o estado vem depois", () => {
  const ativo = { lender_user_id: EU, status: "active" };

  assert.equal(LIB.problemaDoCancelamento({ emprestimo: ativo, meuId: EU }), null);
  assert.equal(
    LIB.problemaDoCancelamento({ emprestimo: ativo, meuId: LAIS }),
    "nao_sou_o_credor"
  );
  assert.equal(
    LIB.problemaDoCancelamento({
      emprestimo: { lender_user_id: EU, status: "cancelled" },
      meuId: EU,
    }),
    "emprestimo_ja_cancelado"
  );
  assert.equal(
    LIB.problemaDoCancelamento({
      emprestimo: { lender_user_id: EU, status: "settled" },
      meuId: EU,
    }),
    "emprestimo_ja_quitado"
  );
  // A ORDEM: quem nao e o credor nao chega a saber o estado da divida.
  assert.equal(
    LIB.problemaDoCancelamento({
      emprestimo: { lender_user_id: EU, status: "settled" },
      meuId: LAIS,
    }),
    "nao_sou_o_credor"
  );
});

// ---------------------------------------------------------------------------
// PARTE 11 -- `settled`: O EMPRESTIMO QUE CHEGOU AO FIM (HMO-394, F1 da HMO-393)
// ---------------------------------------------------------------------------
// Antes desta entrega `mybank_loans.status = 'settled'` NAO ERA ESCRITO POR
// NINGUEM: o CHECK da 053 o aceitava, as duas telas filtravam `active` e
// `problemaDoCancelamento` ja tinha a frase de `emprestimo_ja_quitado` -- e o
// ciclo de pagamento nao alcancava o status. Um emprestimo 24/24 pago ficava
// `active` para sempre e a unica saida da tela era o botao Cancelar: uma divida
// integralmente honrada terminava carimbada como cancelada.
//
// O QUE ESTA PARTE EXISTE PARA IMPEDIR, e nao e o defeito original
// ----------------------------------------------------------------
// E o INVERSO dele: um emprestimo que se declara quitado sem ter sido pago.
// `emprestimoFicouQuitado` exige nenhuma parcela em aberto E ao menos uma
// `paid`, e a segunda condicao nao e defensiva -- sem ela o emprestimo gravado
// pela metade (o POST que morreu entre os dois inserts, estado que o proprio
// ramo idempotente de `loans/route.ts` reconhece) tem zero parcela, "nada em
// aberto" e verdade, e a divida se declara cumprida: ela sai das duas telas, que
// filtram `active`, e ninguem e cobrado por ela nunca mais.
//
// A POSICAO DA ESCRITA TEM TESTE PROPRIO
// --------------------------------------
// A quitacao e a ULTIMA escrita das duas rotas, depois do ultimo desfazimento
// possivel. No Caso A isso importa: se ela estivesse no passo 2.5, a falha da
// baixa da previsao -- que desfaz as pernas e devolve a parcela a `pending` --
// deixaria um emprestimo `settled` com parcela pendente, e a divida viva sairia
// das duas telas. `a quitacao NAO acontece quando a baixa da previsao falha`
// mede exatamente isso.

// ---------------------------------------------------------------------------
// A regra pura
// ---------------------------------------------------------------------------

test("`emprestimoFicouQuitado`: nada em aberto E ao menos uma paga", () => {
  assert.equal(
    LIB.emprestimoFicouQuitado({ parcelas: [{ status: "paid" }] }),
    true
  );
  assert.equal(
    LIB.emprestimoFicouQuitado({
      parcelas: [{ status: "paid" }, { status: "paid" }],
    }),
    true
  );
});

test("`emprestimoFicouQuitado`: UMA parcela em aberto basta para nao estar quitado", () => {
  // Os dois estados de `STATUS_EM_ABERTO_DA_PARCELA`, um a um: 23 pagas e uma
  // pendente e o caso real do penultimo mes.
  for (const emAberto of ["pending", "reported"]) {
    assert.equal(
      LIB.emprestimoFicouQuitado({
        parcelas: [{ status: "paid" }, { status: emAberto }],
      }),
      false,
      `${emAberto} em aberto nao pode quitar o emprestimo`
    );
  }
});

test("`emprestimoFicouQuitado`: ZERO parcelas NAO e quitacao -- o emprestimo gravado pela metade", () => {
  // O ESTADO E ALCANCAVEL, nao hipotese: o POST de `/api/mybank/loans` grava o
  // emprestimo e a serie em dois inserts, e o ramo idempotente do 23505 diz por
  // extenso que o primeiro pode ter morrido entre o passo 1 e o passo 2.
  //
  // Sem a exigencia de uma `paid`, `[].some(...)` e `false`, "nada em aberto" e
  // verdade e esta divida se declara cumprida -- saindo das duas telas, que
  // filtram `active`, sem nunca ter sido cobrada.
  assert.equal(LIB.emprestimoFicouQuitado({ parcelas: [] }), false);
});

test("`emprestimoFicouQuitado`: TODAS canceladas e `cancelled`, e nao quitacao", () => {
  // Esse estado ja tem rota propria (o PATCH do cancelamento). Chamar de quitado
  // um emprestimo que ninguem pagou diria que a divida foi honrada.
  assert.equal(
    LIB.emprestimoFicouQuitado({
      parcelas: [{ status: "cancelled" }, { status: "cancelled" }],
    }),
    false
  );
});

test("`emprestimoFicouQuitado`: paga + cancelada, nada em aberto, E quitacao", () => {
  // A cauda que a antecipacao encurta (F2): 1 paga e as outras canceladas chegou
  // ao fim tanto quanto um 24/24. O criterio e "nada EM ABERTO e algum dinheiro
  // entrou", e nao "todas pagas".
  assert.equal(
    LIB.emprestimoFicouQuitado({
      parcelas: [{ status: "paid" }, { status: "cancelled" }],
    }),
    true
  );
});

test("a quitacao torna `emprestimo_ja_quitado` ALCANCAVEL -- e as duas pontas concordam", () => {
  // A frase de `emprestimo_ja_quitado` existe desde a HMO-391 e era INALCANCAVEL:
  // ninguem escrevia `settled`. Esta fase a alcanca, e o que liga as duas pontas
  // e o status -- escrito por `patchDaQuitacaoDoEmprestimo`, lido por
  // `problemaDoCancelamento`. Os dois comparam o MESMO literal em arquivos
  // diferentes; se divergirem, o emprestimo fica quitado e o botao Cancelar volta
  // a aparecer, cada lado certo sozinho.
  const statusGravado = LIB.patchDaQuitacaoDoEmprestimo().status;

  assert.equal(
    LIB.problemaDoCancelamento({
      emprestimo: { lender_user_id: EU, status: statusGravado },
      meuId: EU,
    }),
    "emprestimo_ja_quitado"
  );
  assert.match(
    LIB.mensagemDoProblemaDoCancelamento("emprestimo_ja_quitado"),
    /quitado/i
  );
});

test("`patchDaQuitacaoDoEmprestimo`: so `status`, e mais nada", () => {
  const patch = LIB.patchDaQuitacaoDoEmprestimo();

  assert.equal(patch.status, "settled");
  // A LISTA DE CHAVES, e nao so o `status`: a 053 tem trigger de carimbo em
  // `updated_at` e nao tem coluna de data de quitacao -- um campo a mais aqui
  // competiria com o trigger ou inventaria coluna que nao existe (42703).
  assert.deepEqual(Object.keys(patch), ["status"]);
  assert.equal(LIB.STATUS_QUITADO, "settled");
});

// ---------------------------------------------------------------------------
// O chamador 1: o PATCH da parcela (Caso B)
// ---------------------------------------------------------------------------

test("A ULTIMA PARCELA QUITA O EMPRESTIMO -- o PATCH da parcela fecha o ciclo", async () => {
  const { status, corpo, sessao } = await mexerNaParcela(
    EU,
    { status: "paid", data_do_pagamento: "2027-01-12" },
    { mybank_installments: [{ ...PARCELA_DA_LAIS, status: "reported" }] }
  );

  assert.equal(status, 200);

  const quitacoes = sessao.escritas.filter(
    (e) => e.tabela === "mybank_loans" && e.verbo === "update"
  );
  assert.equal(quitacoes.length, 1);
  assert.equal(quitacoes[0].patch.status, "settled");
  // O FILTRO E PELO ID DO EMPRESTIMO. Um UPDATE sem ele alcancaria todo
  // emprestimo que a RLS entrega -- os meus outros, todos quitados de uma vez.
  assert.deepEqual(quitacoes[0].filtros, [["eq", "id", "loan-lais"]]);

  assert.equal(corpo.emprestimo_quitado, true);
  assert.match(corpo.message, /quitado/i);

  // A ORDEM: a parcela e baixada ANTES de o emprestimo ser quitado. A decisao le
  // a serie do banco, e lela antes da baixa veria a parcela ainda em aberto.
  const tabelasEscritas = sessao.escritas.map((e) => `${e.tabela}:${e.verbo}`);
  assert.ok(
    tabelasEscritas.indexOf("mybank_installments:update") <
      tabelasEscritas.indexOf("mybank_loans:update"),
    `a baixa vem antes da quitacao: ${tabelasEscritas.join(" -> ")}`
  );
});

test("parcela paga com OUTRA ainda pendente NAO quita o emprestimo", async () => {
  const { status, corpo, sessao } = await mexerNaParcela(
    EU,
    { status: "paid" },
    {
      mybank_installments: [
        { ...PARCELA_DA_LAIS, status: "reported" },
        // A 4/24, pendente: a divida continua viva.
        {
          ...PARCELA_DA_LAIS,
          id: "p4",
          installment_number: 4,
          status: "pending",
        },
      ],
    }
  );

  assert.equal(status, 200);
  assert.equal(
    sessao.escritas.filter((e) => e.tabela === "mybank_loans").length,
    0,
    "nenhuma escrita em mybank_loans enquanto ha parcela em aberto"
  );
  assert.equal(corpo.emprestimo_quitado, false);
  // E a frase NAO fala de quitacao: dizer "quitado" aqui mandaria a pessoa parar
  // de esperar as 20 parcelas que faltam.
  assert.doesNotMatch(corpo.message, /quitado/i);
});

test("a releitura da serie e SO deste emprestimo -- parcela de outro nao impede a quitacao", async () => {
  const { status, corpo, sessao } = await mexerNaParcela(
    EU,
    { status: "paid" },
    {
      mybank_loans: [
        { ...EMPRESTIMO_PARA_A_LAIS },
        // Um SEGUNDO emprestimo meu, vivo, com parcela pendente. A RLS entrega
        // as duas linhas: `mybank_installments_select` e por emprestimo meu, nao
        // por serie.
        { ...EMPRESTIMO_PARA_A_LAIS, id: "loan-geladeira" },
      ],
      mybank_installments: [
        { ...PARCELA_DA_LAIS, status: "reported" },
        {
          ...PARCELA_DA_LAIS,
          id: "p-geladeira",
          loan_id: "loan-geladeira",
          status: "pending",
        },
      ],
    }
  );

  assert.equal(status, 200);

  // SEM o `.eq("loan_id", ...)` a releitura traria a pendente do OUTRO
  // emprestimo, "ainda em aberto" seria verdade e a moto nunca se declararia
  // quitada -- um emprestimo que se recusa a terminar porque outro esta em dia.
  assert.equal(corpo.emprestimo_quitado, true);

  const quitacoes = sessao.escritas.filter(
    (e) => e.tabela === "mybank_loans" && e.verbo === "update"
  );
  assert.equal(quitacoes.length, 1);
  assert.deepEqual(quitacoes[0].filtros, [["eq", "id", "loan-lais"]]);
});

test("a quitacao filtrada pela RLS NAO desfaz a baixa, e a resposta nao mente", async () => {
  const { status, corpo, sessao } = await mexerNaParcela(
    EU,
    { status: "paid", data_do_pagamento: "2027-01-12" },
    {
      mybank_installments: [{ ...PARCELA_DA_LAIS, status: "reported" }],
      // `mybank_loans_update` e `lender_user_id = auth.uid()`: UPDATE que a
      // policy filtra volta 200 com ZERO linha neste app, sem erro e sem
      // SQLSTATE. Sem conferir o `.length` a rota diria "quitado".
      rlsFiltra: { mybank_loans: true },
    }
  );

  // 200, E NADA E DESFEITO: o dinheiro entrou e a parcela esta paga. O estado que
  // sobra -- parcela `paid`, emprestimo `active` -- e exatamente o de antes desta
  // issue, e e correto em dinheiro. Reverter a baixa para preservar o status
  // trocaria um registro atrasado por um pagamento apagado.
  assert.equal(status, 200);
  assert.equal(corpo.success, true);
  assert.equal(corpo.status, "paid");
  assert.ok(corpo.transaction_id, "a perna de entrada continua gravada");

  // A RESPOSTA DIZ O QUE FICOU, e nao o que deveria ter ficado.
  assert.equal(corpo.emprestimo_quitado, false);
  assert.doesNotMatch(corpo.message, /quitado/i);

  // E O UPDATE FOI TENTADO. Sem esta assercao o teste nao distingue "a RLS
  // filtrou a escrita" de "o ramo da quitacao nem rodou" -- os dois dao
  // `emprestimo_quitado: false`, e o segundo passaria vacuo se a condicao de
  // quitacao quebrasse.
  const quitacoes = sessao.escritas.filter(
    (e) => e.tabela === "mybank_loans" && e.verbo === "update"
  );
  assert.equal(quitacoes.length, 1);
  assert.equal(quitacoes[0].patch.status, "settled");
});

// ---------------------------------------------------------------------------
// O chamador 2: a baixa da previsao (Caso A)
// ---------------------------------------------------------------------------

test("CASO A: a baixa da ULTIMA parcela quita o emprestimo", async () => {
  const linhas = tabelasDoCicloDoAuto();
  const { status, corpo, sessao } = await pagarPrevisao({
    tabelas: linhas,
    corpo: { paid_date: "2027-01-12" },
  });

  assert.equal(status, 200);

  const quitacoes = sessao.escritas.filter(
    (e) => e.tabela === "mybank_loans" && e.verbo === "update"
  );
  assert.equal(quitacoes.length, 1);
  assert.equal(quitacoes[0].patch.status, "settled");
  assert.deepEqual(quitacoes[0].filtros, [["eq", "id", "loan-auto"]]);

  // A LINHA SEMEADA, e nao so o patch: e ela que as duas telas leem.
  assert.equal(linhas.mybank_loans[0].status, "settled");

  assert.equal(corpo.emprestimo_quitado, true);
  assert.match(corpo.message, /quitado/i);
});

test("CASO A: com outra parcela pendente a baixa NAO quita nada", async () => {
  const linhas = tabelasDoCicloDoAuto({
    mybank_loans: [{ ...EMPRESTIMO_DO_AUTO }],
    mybank_installments: [
      { ...PARCELA_DO_AUTO },
      {
        ...PARCELA_DO_AUTO,
        id: "parcela-4",
        installment_number: 4,
        status: "pending",
      },
    ],
    scheduled_transactions: [{ ...PREVISAO_DO_AUTO }],
  });

  const { status, corpo, sessao } = await pagarPrevisao({ tabelas: linhas });

  assert.equal(status, 200);
  assert.equal(
    sessao.escritas.filter((e) => e.tabela === "mybank_loans").length,
    0
  );
  assert.equal(linhas.mybank_loans[0].status, "active");
  assert.equal(corpo.emprestimo_quitado, false);
  assert.equal(corpo.message, "Parcela do MyBank paga");
});

test("A QUITACAO NAO ACONTECE QUANDO A BAIXA DA PREVISAO FALHA -- a posicao do passo 4", async () => {
  const linhas = tabelasDoCicloDoAuto();
  const { status, sessao } = await pagarPrevisao({
    tabelas: linhas,
    // A baixa da previsao e o ULTIMO passo que pode voltar atras: a falha nela
    // desfaz as duas pernas e devolve a parcela a `pending`.
    rlsFiltra: { scheduled_transactions: true },
  });

  assert.equal(status, 500);

  // E O EMPRESTIMO NAO FOI TOCADO. Se a quitacao estivesse no passo 2.5, junto da
  // baixa da parcela, este estorno deixaria um emprestimo `settled` com parcela
  // `pending` -- e como as duas telas do MyBank filtram `active`, a divida viva
  // sairia das duas e ninguem seria cobrado por ela. O estorno nao sabe desfazer
  // o status do emprestimo; a saida e a quitacao vir DEPOIS dele.
  assert.equal(
    sessao.escritas.filter((e) => e.tabela === "mybank_loans").length,
    0,
    "nenhuma escrita em mybank_loans quando a baixa da previsao falha"
  );
  assert.equal(linhas.mybank_loans[0].status, "active");
  assert.equal(linhas.mybank_installments[0].status, "pending");
});

test("previsao SEM elo do MyBank nao toca `mybank_loans`", async () => {
  const linhas = tabelasDoCicloDoAuto({
    scheduled_transactions: [{ ...PREVISAO_DO_AUTO, notes: "Aluguel" }],
  });

  const { status, corpo, sessao } = await pagarPrevisao({ tabelas: linhas });

  assert.equal(status, 200);
  // A transferencia prevista comum nao tem emprestimo para quitar. Sem a guarda
  // do elo, a releitura da serie sairia com `loan_id` indefinido -- e um
  // `.eq("loan_id", undefined)` no PostgREST nao filtra nada.
  assert.equal(
    sessao.escritas.filter((e) => e.tabela === "mybank_loans").length,
    0
  );
  assert.equal(corpo.emprestimo_quitado, false);
  assert.equal(corpo.message, "Transferência confirmada");
});

// ---------------------------------------------------------------------------
// PARTE 12 -- A ANTECIPACAO DE PARCELAS (HMO-395, F2 da HMO-393)
// ---------------------------------------------------------------------------
// O QUE ESTA PARTE EXISTE PARA IMPEDIR, e a primeira e a razao de a issue
// existir:
//
//   1. A ANTECIPACAO CANCELAR A CAUDA. O desenho que a HMO-393 propunha no item
//      2 -- as parcelas do fim viram `cancelled` E o dinheiro paga as proximas em
//      aberto -- EXTINGUE O DOBRO DO QUE FOI PAGO. Quatro parcelas saem do
//      caminho, duas foram pagas, e a divida de R$ 600 se resolve com R$ 400.
//      Nenhum CHECK reclama e as duas telas ficam consistentes ENTRE SI: o unico
//      numero que denuncia e `soma(pagas) + soma(em aberto)` comparado com
//      `principal`, e esse numero nao esta em tela nenhuma.
//
//      E por isso o controle desta issue e uma assercao de SOMATORIO, lida na
//      TABELA, e nao de `status`: os dois desenhos escrevem status diferentes, e
//      so um deles perde dinheiro. Uma assercao de status mataria o mutante pelo
//      motivo errado e continuaria verde no dia em que o desenho mudasse de
//      status sem mudar de aritmetica.
//
//   2. A ESCOLHA PEGAR A CABECA DA SERIE. Com `ASC` no lugar de `DESC` o total
//      recebido e o MESMO e as duas telas ficam consistentes -- mas a serie NAO
//      ENCURTA: a decisao de produto ("2 parcelas menos", "ENCURTA a serie")
//      deixa de ser cumprida sem nenhum numero errado em lugar nenhum. O que
//      mede isso e QUAIS parcelas foram baixadas e qual passou a ser o ultimo
//      vencimento em aberto.
//
//   3. A PERNA SER `income`. Principal voltando nao e receita, e aqui o defeito
//      e maior que na parcela avulsa: a antecipacao lanca N pernas de uma vez,
//      entao o mesmo principal entraria como renda N vezes num unico clique. A
//      parcela avulsa ja tem ancora propria para isso; esta rota precisa da DELA
//      (`mesmo-alvo-nao-prova-coberto-compare-as-ancoras`).
//
//   4. O CREDOR SER CONFERIDO SO DEPOIS DO UPDATE. `mybank_loans_select` e
//      `lender OR borrower`: a devedora LE a linha. A trava do devedor (053)
//      recusa `paid_date` com excecao, mas a POLICY de UPDATE filtra em silencio
//      -- 200 com `[]` --, e sem a pergunta na rota ela receberia "antecipei
//      duas parcelas" de uma escrita que nao aconteceu.
//
//   5. O ROLLBACK DA PERNA NAO RODAR. Perna sem parcela baixada e dinheiro no
//      extrato que nenhuma divida explica: o saldo da conta de investimento sobe
//      e a divida fica inteira de pe.
//
// O FIXTURE TEM PARCELA JA PAGA, E ISSO E O QUE FAZ O SOMATORIO MEDIR
// ------------------------------------------------------------------
// Com todas as parcelas em aberto, "pagar a cauda" e "cancelar a cauda e pagar a
// cabeca" movem a MESMA quantidade de dinheiro para dentro do periodo medido, e
// o somatorio de uma serie virgem nao distingue os dois arranjos tao bem. Com a
// parcela 1 ja paga ANTES do pedido, a soma do que o devedor pagou ao todo entra
// na conta -- e e ela que cai de R$ 600 para R$ 400 no desenho que cancela
// (`mutante-de-ramo-de-passagem-exige-fixture-do-outro-ramo`).
//
// E O VIZINHO: um SEGUNDO emprestimo meu, com parcelas em aberto de vencimento
// MAIOR. Sem ele, "as parcelas desta divida" e "as parcelas que a RLS entrega"
// sao o mesmo conjunto, e o mutante que apaga o `.eq("loan_id")` sobrevive
// antecipando a parcela de outra divida.

const ANTECIPA = await import(
  "../.tmp-emprestimo-do-mybank/app/api/mybank/loans/[id]/antecipacao/route.js"
);

/** 6 x R$ 100 para a Lais -- o emprestimo da medicao em producao. */
const EMPRESTIMO_A_ANTECIPAR = {
  id: "loan-antecipa",
  lender_user_id: EU,
  lender_account_id: INVESTIMENTO,
  borrower_user_id: LAIS,
  description: "Notebook",
  principal: 600,
  installment_count: 6,
  first_due_date: "2026-11-10",
  status: "active",
  // A trava `mybank_loans_interest_rate_fase_1` prende isto em 0, e e ela que
  // faz `valorDaAntecipacao` poder ser uma soma simples. O `numeric` do
  // PostgREST chega como STRING, e o fixture imita isso de proposito: com
  // `!== 0` no lugar do `Number(...)` a recusa de juro dispararia em TODO
  // emprestimo da fase 1 e a feature inteira ficaria inalcancavel.
  interest_rate: "0.00",
  created_at: "2026-10-10T00:00:00Z",
};

function parcelaDoNotebook(numero, status, extra = {}) {
  // Vencimentos mensais a partir de 11/2026: a parcela 6 vence em 04/2027.
  const mes = String(10 + numero).padStart(2, "0");
  const ano = numero <= 2 ? 2026 : 2027;
  const mesReal = numero <= 2 ? mes : String(numero - 2).padStart(2, "0");

  return {
    id: `n${numero}`,
    loan_id: "loan-antecipa",
    installment_number: numero,
    installment_total: 6,
    amount: 100,
    due_date: `${ano}-${mesReal}-10`,
    status,
    reported_at: null,
    paid_date: null,
    paid_transaction_id: null,
    ...extra,
  };
}

/**
 * A serie: 1 JA PAGA, 2..6 em aberto -- e a 4 em `reported`.
 *
 * A `reported` nao e enfeite: ela e "em aberto" tanto quanto a `pending` (o
 * devedor avisou, o credor nao confirmou), e sem ela um criterio
 * `status === "pending"` passaria em toda assercao desta parte.
 */
const PARCELAS_DO_NOTEBOOK = [
  parcelaDoNotebook(1, "paid", {
    paid_date: "2026-11-11",
    paid_transaction_id: "tx-n1",
  }),
  parcelaDoNotebook(2, "pending"),
  parcelaDoNotebook(3, "pending"),
  parcelaDoNotebook(4, "reported", { reported_at: "2027-02-09T00:00:00Z" }),
  parcelaDoNotebook(5, "pending"),
  parcelaDoNotebook(6, "pending"),
];

/** O VIZINHO: outra divida minha, com parcela em aberto de vencimento MAIOR. */
const EMPRESTIMO_VIZINHO = {
  ...EMPRESTIMO_A_ANTECIPAR,
  id: "loan-vizinho",
  description: "Bicicleta",
  principal: 200,
  installment_count: 2,
};

const PARCELAS_DO_VIZINHO = [
  {
    ...parcelaDoNotebook(1, "pending"),
    id: "v1",
    loan_id: "loan-vizinho",
    installment_total: 2,
    // DEPOIS de toda parcela do notebook: se o `.eq("loan_id")` cair, esta e a
    // primeira que a escolha da cauda pega.
    due_date: "2029-12-10",
  },
];

function tabelasDaAntecipacao(extra = {}) {
  return tabelas({
    mybank_loans: [{ ...EMPRESTIMO_A_ANTECIPAR }, { ...EMPRESTIMO_VIZINHO }],
    mybank_installments: [
      ...PARCELAS_DO_NOTEBOOK.map((p) => ({ ...p })),
      ...PARCELAS_DO_VIZINHO.map((p) => ({ ...p })),
    ],
    ...extra,
  });
}

async function antecipar({
  quem = EU,
  loanId = "loan-antecipa",
  corpo = { parcelas: 2, data_do_pagamento: "2026-12-01" },
  tabelas: linhas,
  erros,
  rlsFiltra,
} = {}) {
  const sessao = criarDuble({
    user: { id: quem },
    tabelas: linhas ?? tabelasDaAntecipacao(),
    ...(erros ? { erros } : {}),
    ...(rlsFiltra ? { rlsFiltra } : {}),
  });
  const registro = { sessao: () => sessao.client };
  globalThis.__dubleDeSupabase = registro;

  let resposta;
  try {
    resposta = await ANTECIPA.POST(
      { json: async () => corpo },
      { params: { id: loanId } }
    );
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  return { status: resposta.status, corpo: await resposta.json(), sessao, registro };
}

/**
 * A INVARIANTE DO DINHEIRO: `soma(pagas) + soma(em aberto) = principal`.
 *
 * Lida na TABELA e em CENTAVOS INTEIROS -- somar reais em float daria
 * 599,9999999999999 e o teste passaria ou falharia pelo IEEE 754 em vez de pela
 * feature. O que a soma NAO inclui e `cancelled`: parcela cancelada nao foi paga
 * nem e divida, e e exatamente por isso que cancelar a cauda faz esta soma cair.
 */
function somaDaDivida(linhasDasParcelas, loanId) {
  const daSerie = linhasDasParcelas.filter((p) => p.loan_id === loanId);

  const emCentavos = (status) =>
    daSerie
      .filter((p) => status.includes(p.status))
      .reduce((t, p) => t + Math.round(Number(p.amount) * 100), 0);

  const pagas = emCentavos(["paid"]);
  const emAberto = emCentavos(["pending", "reported"]);

  return { pagas, emAberto, total: pagas + emAberto };
}

// ---------------------------------------------------------------------------
// 12.1 -- A REGRA PURA: a escolha da cauda
// ---------------------------------------------------------------------------

test("`parcelasDaAntecipacao` pega as N em aberto de MAIOR vencimento", () => {
  const escolhidas = LIB.parcelasDaAntecipacao({
    parcelas: PARCELAS_DO_NOTEBOOK,
    quantas: 2,
  });

  // AS DO FIM, e na ordem da cauda para cima.
  assert.deepEqual(
    escolhidas.map((p) => p.installment_number),
    [6, 5]
  );
});

test("`parcelasDaAntecipacao` NAO alcanca `paid` nem `cancelled`", () => {
  const serie = [
    ...PARCELAS_DO_NOTEBOOK.slice(0, 4),
    parcelaDoNotebook(5, "cancelled"),
    parcelaDoNotebook(6, "paid", {
      paid_date: "2027-01-01",
      paid_transaction_id: "tx-n6",
    }),
  ];

  const escolhidas = LIB.parcelasDaAntecipacao({ parcelas: serie, quantas: 3 });

  // Antecipar uma parcela PAGA seria pagar duas vezes a mesma coisa; uma
  // CANCELADA nao e divida. Sobram 2, 3 e 4 -- e a maior vem primeiro.
  assert.deepEqual(
    escolhidas.map((p) => p.installment_number),
    [4, 3, 2]
  );
});

test("empate de vencimento: o desempate e `installment_number` DESC", () => {
  // AS DUAS NO MESMO DIA, e semeadas na ordem CRESCENTE de numero. `sort` e
  // ESTAVEL: sem o desempate ele devolve esta mesma ordem e a escolha pega a 5,
  // e um teste escrito sobre um fixture ja ordenado na direcao certa nao mediria
  // nada (`sort-estavel-faz-o-teste-de-desempate-nao-medir-nada`).
  const serie = [
    parcelaDoNotebook(5, "pending", { due_date: "2027-03-10" }),
    parcelaDoNotebook(6, "pending", { due_date: "2027-03-10" }),
  ];

  const escolhidas = LIB.parcelasDaAntecipacao({ parcelas: serie, quantas: 1 });

  assert.deepEqual(
    escolhidas.map((p) => p.installment_number),
    [6]
  );
});

test("`parcelasDaAntecipacao` NAO reordena a lista que recebeu", () => {
  // A rota le as parcelas UMA vez e passa o mesmo array para a escolha, para
  // `quantasEmAberto` e para `ultimoVencimentoEmAberto`. Um `.sort()` sem copia
  // reordenaria o array de quem chamou como efeito colateral de escolher.
  const serie = PARCELAS_DO_NOTEBOOK.map((p) => ({ ...p }));
  const antes = serie.map((p) => p.installment_number);

  LIB.parcelasDaAntecipacao({ parcelas: serie, quantas: 3 });

  assert.deepEqual(
    serie.map((p) => p.installment_number),
    antes
  );
});

test("`valorDaAntecipacao` soma em CENTAVOS: 12 x 33,33 nao vira dizima", () => {
  // O CASO TEM DE SER UM QUE DIVIRJA, E 24 x 416,67 NAO E UM DELES.
  //
  // O numero canonico desta feature -- 24 x R$ 416,67, a serie de R$ 10.000 da
  // PARTE 1 -- soma EXATO em float: 10000.08 pelos dois caminhos. Um teste
  // escrito sobre ele afirma a resposta certa pelo motivo errado, e o mutante
  // que troca a soma de centavos pela soma de reais SOBREVIVE. Foi exatamente o
  // que aconteceu na primeira volta desta medicao -- 77 de 78, e o sobrevivente
  // era este (`caso-da-issue-nao-distingue-floor-de-round`).
  //
  // R$ 400 em 12 x R$ 33,33 diverge: somando reais da 399.95999999999987.
  const parcelas = Array.from({ length: 12 }, () => ({ amount: 33.33 }));

  const valor = LIB.valorDaAntecipacao({ parcelasEscolhidas: parcelas });

  assert.equal(valor, 399.96);

  // O CONTROLE DO PROPRIO CASO. Sem esta linha nada neste teste prova que o
  // caso escolhido distingue os dois caminhos, e quem mexer aqui pode trocar
  // por um valor que volta a nao medir nada.
  assert.notEqual(
    parcelas.reduce((t, p) => t + p.amount, 0),
    399.96,
    "o caso escolhido tem de DIVERGIR da soma em reais"
  );

  assert.equal(LIB.valorDaAntecipacao({ parcelasEscolhidas: [] }), 0);
});

test("`ultimoVencimentoEmAberto`: `MM/AAAA` da parcela em aberto mais distante", () => {
  // 6 vence em 04/2027 e esta em aberto.
  assert.equal(LIB.ultimoVencimentoEmAberto(PARCELAS_DO_NOTEBOOK), "04/2027");

  // Com 5 e 6 pagas, o fim da serie passa a ser a 4 -- 02/2027. E e isto que
  // "a serie encurtou" quer dizer com um numero.
  const depois = PARCELAS_DO_NOTEBOOK.map((p) =>
    p.installment_number >= 5 ? { ...p, status: "paid" } : p
  );
  assert.equal(LIB.ultimoVencimentoEmAberto(depois), "02/2027");

  // Nada em aberto devolve `null`, e nao a string de uma data qualquer: e o
  // sinal de "a divida acabou" que a mensagem le.
  assert.equal(
    LIB.ultimoVencimentoEmAberto(
      PARCELAS_DO_NOTEBOOK.map((p) => ({ ...p, status: "paid" }))
    ),
    null
  );
});

test("`ultimoVencimentoEmAberto` ordena pelo ISO, e nao pelo rotulo", () => {
  // `MM/AAAA` NAO ordena lexicograficamente: "01/2028" vem antes de "09/2026".
  // Ordenar os rotulos devolveria 09/2026 como o ultimo vencimento.
  const serie = [
    parcelaDoNotebook(1, "pending", { due_date: "2026-09-10" }),
    parcelaDoNotebook(2, "pending", { due_date: "2028-01-10" }),
  ];

  assert.equal(LIB.ultimoVencimentoEmAberto(serie), "01/2028");
});

// ---------------------------------------------------------------------------
// 12.2 -- A REGRA PURA: as recusas, e a ORDEM delas
// ---------------------------------------------------------------------------

test("`problemaDaAntecipacao`: o credor passa, e a devedora nao", () => {
  const base = {
    emprestimo: EMPRESTIMO_A_ANTECIPAR,
    parcelas: PARCELAS_DO_NOTEBOOK,
    quantas: 2,
  };

  assert.equal(LIB.problemaDaAntecipacao({ ...base, meuId: EU }), null);
  assert.equal(
    LIB.problemaDaAntecipacao({ ...base, meuId: LAIS }),
    "nao_sou_o_credor"
  );
});

test("`problemaDaAntecipacao`: a pergunta de credor VEM ANTES do estado", () => {
  // A devedora LE a linha (`mybank_loans_select` e `lender OR borrower`).
  // Perguntar pelo estado primeiro diria "esse emprestimo esta cancelado" a quem
  // nao tem nada a antecipar -- vazando o estado da divida de outra pessoa numa
  // mensagem de erro. A mesma razao de `problemaDoCancelamento`.
  for (const estado of ["cancelled", "settled"]) {
    assert.equal(
      LIB.problemaDaAntecipacao({
        emprestimo: { ...EMPRESTIMO_A_ANTECIPAR, status: estado },
        meuId: LAIS,
        parcelas: PARCELAS_DO_NOTEBOOK,
        quantas: 2,
      }),
      "nao_sou_o_credor",
      `com status ${estado} a devedora nao pode saber o estado`
    );
  }
});

test("`problemaDaAntecipacao`: emprestimo fora de `active` nao antecipa", () => {
  for (const estado of ["cancelled", "settled"]) {
    assert.equal(
      LIB.problemaDaAntecipacao({
        emprestimo: { ...EMPRESTIMO_A_ANTECIPAR, status: estado },
        meuId: EU,
        parcelas: PARCELAS_DO_NOTEBOOK,
        quantas: 2,
      }),
      "emprestimo_nao_esta_ativo"
    );
  }
});

test("`problemaDaAntecipacao`: juro diferente de zero e RECUSADO, nao calculado", () => {
  // Com juro, antecipar tem de descontar o juro NAO-CORRIDO da cauda, e somar
  // `amount` cobraria juro de um tempo que nao existiu. A trava da 053 prende
  // isto em 0 hoje; a recusa e o que faz o dia em que ela mudar ser um 409 em
  // vez de um erro de dinheiro.
  assert.equal(
    LIB.problemaDaAntecipacao({
      emprestimo: { ...EMPRESTIMO_A_ANTECIPAR, interest_rate: "1.50" },
      meuId: EU,
      parcelas: PARCELAS_DO_NOTEBOOK,
      quantas: 2,
    }),
    "juros_impedem_a_antecipacao"
  );

  // E o `numeric` como STRING continua passando: `"0.00" !== 0` e verdade, e um
  // `!==` cru aqui recusaria TODO emprestimo da fase 1.
  for (const juro of ["0.00", 0, "0", null, undefined]) {
    assert.equal(
      LIB.problemaDaAntecipacao({
        emprestimo: { ...EMPRESTIMO_A_ANTECIPAR, interest_rate: juro },
        meuId: EU,
        parcelas: PARCELAS_DO_NOTEBOOK,
        quantas: 2,
      }),
      null,
      `juro ${JSON.stringify(juro)} e juro zero`
    );
  }
});

test("`problemaDaAntecipacao`: `quantas` tem de ser inteiro >= 1", () => {
  for (const quantas of [0, -1, 1.5, NaN, Number("duas")]) {
    assert.equal(
      LIB.problemaDaAntecipacao({
        emprestimo: EMPRESTIMO_A_ANTECIPAR,
        meuId: EU,
        parcelas: PARCELAS_DO_NOTEBOOK,
        quantas,
      }),
      "quantas_invalida",
      `${JSON.stringify(quantas)} nao e um numero de parcelas`
    );
  }
});

test("`problemaDaAntecipacao`: nao da para antecipar mais do que esta em aberto", () => {
  // Sao 5 em aberto (a 1 ja foi paga): 5 passa, 6 nao.
  assert.equal(LIB.quantasEmAberto(PARCELAS_DO_NOTEBOOK), 5);

  assert.equal(
    LIB.problemaDaAntecipacao({
      emprestimo: EMPRESTIMO_A_ANTECIPAR,
      meuId: EU,
      parcelas: PARCELAS_DO_NOTEBOOK,
      quantas: 5,
    }),
    null
  );

  assert.equal(
    LIB.problemaDaAntecipacao({
      emprestimo: EMPRESTIMO_A_ANTECIPAR,
      meuId: EU,
      parcelas: PARCELAS_DO_NOTEBOOK,
      quantas: 6,
    }),
    "mais_do_que_em_aberto"
  );
});

test("`problemaDaAntecipacao`: o CASO A e recusado aqui, e por ultimo", () => {
  const auto = {
    ...EMPRESTIMO_A_ANTECIPAR,
    // Eu sou os dois lados: a parcela e uma transferencia prevista, e quem move
    // o dinheiro e a baixa dela em Contas a Pagar.
    borrower_user_id: EU,
  };

  assert.equal(
    LIB.problemaDaAntecipacao({
      emprestimo: auto,
      meuId: EU,
      parcelas: PARCELAS_DO_NOTEBOOK,
      quantas: 2,
    }),
    "caso_a_nao_entra_aqui"
  );

  // E A ORDEM: um Caso A com `quantas` malformado responde pela FORMA do corpo,
  // e nao pelo ponteiro para outra tela. A frase do Caso A nomeia outro caminho,
  // e mandar alguem para lá com um pedido que lá tambem seria recusado troca uma
  // recusa por uma caminhada inutil.
  assert.equal(
    LIB.problemaDaAntecipacao({
      emprestimo: auto,
      meuId: EU,
      parcelas: PARCELAS_DO_NOTEBOOK,
      quantas: 99,
    }),
    "mais_do_que_em_aberto"
  );
});

test("as frases das recusas dizem o que fazer, e a de `quantas` fala dos R$ 150", () => {
  const contexto = { status: "cancelled", emAberto: 5 };

  // A recusa ao devedor nao conta o estado da divida.
  const doDevedor = LIB.mensagemDoProblemaDaAntecipacao(
    "nao_sou_o_credor",
    contexto
  );
  assert.match(doDevedor, /Só quem emprestou/i);
  assert.equal(/cancel|settled|quitad/i.test(doDevedor), false);

  // A FRASE QUE A ISSUE PEDE POR NOME: `valor` nao existe no contrato, entao
  // R$ 150 contra parcelas de R$ 200 nao tem como ser expresso -- e a razao
  // precisa estar escrita onde a pessoa a le, em vez de so recusar.
  const deQuantas = LIB.mensagemDoProblemaDaAntecipacao(
    "quantas_invalida",
    contexto
  );
  assert.match(deQuantas, /parcela inteira/i);
  assert.match(deQuantas, /pagamento parcial de parcela é outra operação/i);
  assert.match(deQuantas, /não existe hoje/i);

  // O ponteiro do Caso A, na convencao do PATCH da parcela.
  assert.match(
    LIB.mensagemDoProblemaDaAntecipacao("caso_a_nao_entra_aqui", contexto),
    /Contas a Pagar/
  );

  // O estado entra na frase de quem manda nele...
  assert.match(
    LIB.mensagemDoProblemaDaAntecipacao("emprestimo_nao_esta_ativo", contexto),
    /"cancelled"/
  );
  // ...e a contagem na de "mais do que em aberto", nos dois plurais.
  assert.match(
    LIB.mensagemDoProblemaDaAntecipacao("mais_do_que_em_aberto", contexto),
    /5 parcelas em aberto/
  );
  assert.match(
    LIB.mensagemDoProblemaDaAntecipacao("mais_do_que_em_aberto", {
      status: "active",
      emAberto: 1,
    }),
    /Só resta 1 parcela/
  );
});

// ---------------------------------------------------------------------------
// 12.3 -- A REGRA PURA: a mensagem, e a TERCEIRA frase dela
// ---------------------------------------------------------------------------

test("`mensagemDaAntecipacao` diz as TRES coisas que mudaram", () => {
  const frase = LIB.mensagemDaAntecipacao({
    numerosAntecipados: [6, 5],
    ultimoVencimentoAntes: "04/2027",
    ultimoVencimentoDepois: "02/2027",
    quitado: false,
    serieRelida: true,
  });

  // 1. quantas sairam, e QUAIS;
  assert.match(frase, /2 parcelas antecipadas/);
  assert.match(frase, /6 e 5/);
  // 2. o fim da serie, antes e depois -- a unica frase que diz "encurtou" com
  //    um numero;
  assert.match(frase, /era 04\/2027/);
  assert.match(frase, /passou a ser 02\/2027/);
  // 3. QUE O VALOR DE QUEM SOBRA NAO MUDOU. Sem ela a leitura natural de "duas
  //    parcelas menos" e "baixaram minha prestacao", e a pessoa passa a esperar
  //    um debito menor no mes que vem.
  assert.match(frase, /mantêm o valor/i);
  assert.match(frase, /não baixa a prestação/i);
});

test("`mensagemDaAntecipacao` no singular nao diz `1 parcelas`", () => {
  const frase = LIB.mensagemDaAntecipacao({
    numerosAntecipados: [6],
    ultimoVencimentoAntes: "04/2027",
    ultimoVencimentoDepois: "03/2027",
    quitado: false,
    serieRelida: true,
  });

  assert.match(frase, /Parcela 6 antecipada/);
  assert.equal(/1 parcelas/.test(frase), false);
});

test("`mensagemDaAntecipacao`: sem nada em aberto a TERCEIRA frase SAI", () => {
  const frase = LIB.mensagemDaAntecipacao({
    numerosAntecipados: [6, 5],
    ultimoVencimentoAntes: "04/2027",
    ultimoVencimentoDepois: null,
    quitado: true,
    serieRelida: true,
  });

  assert.match(frase, /quitado/i);
  assert.match(frase, /sai da lista A receber/i);
  // "As que sobram mantem o valor" sobre ZERO parcelas e uma promessa sobre uma
  // cobranca futura que nao existe -- quem acabou de quitar leria isso como
  // "ainda vou pagar".
  assert.equal(/mantêm o valor/i.test(frase), false);
  assert.equal(/passou a ser/.test(frase), false);
});

test("`mensagemDaAntecipacao`: nada em aberto SEM quitacao nao anuncia quitacao", () => {
  // O ESTADO ALCANCAVEL: a serie zerou e o UPDATE de `settled` foi filtrado pela
  // policy -- 200 com `[]`, sem erro. O emprestimo continua `active` e as duas telas
  // continuam mostrando a divida. Deduzir a quitacao de "nao sobrou vencimento"
  // faria a frase anunciar um status que tela nenhuma leria.
  const frase = LIB.mensagemDaAntecipacao({
    numerosAntecipados: [6, 5],
    ultimoVencimentoAntes: "04/2027",
    ultimoVencimentoDepois: null,
    quitado: false,
    serieRelida: true,
  });

  assert.match(frase, /continua em atividade/i);
  assert.equal(/quitado/i.test(frase), false);
  assert.equal(/sai da lista/i.test(frase), false);
});

// ---------------------------------------------------------------------------
// 12.4 -- A ROTA: o passo 4 da medicao, e o somatorio
// ---------------------------------------------------------------------------

test("`mensagemDaAntecipacao`: releitura que FALHOU nao afirma que a divida acabou", () => {
  // O ESTADO: as parcelas foram pagas de verdade e a releitura da serie falhou.
  // `ultimoVencimentoDepois` chega `null` -- indistinguivel de "nao sobrou nada" --,
  // e sem ramo proprio a frase anunciaria o fim da divida porque a rota nao
  // conseguiu PERGUNTAR se ela acabou. O dinheiro entrou, entao quem le
  // concluiria que quitou.
  const frase = LIB.mensagemDaAntecipacao({
    numerosAntecipados: [6, 5],
    ultimoVencimentoAntes: "04/2027",
    ultimoVencimentoDepois: null,
    quitado: false,
    serieRelida: false,
  });

  assert.match(frase, /2 parcelas antecipadas/);
  assert.match(frase, /não consegui reler/i);
  assert.match(frase, /confira a lista A receber/i);

  // NADA AFIRMADO SOBRE O RESTO DA SERIE: nem quitacao, nem "nao sobrou
  // parcela", nem o valor de quem fica.
  assert.equal(/quitado/i.test(frase), false);
  assert.equal(/Não sobrou/i.test(frase), false);
  assert.equal(/mantêm o valor/i.test(frase), false);
});

test("a RELEITURA que falha nao faz a rota dizer que sobrou zero", async () => {
  const linhas = tabelasDaAntecipacao();

  // O ARRANJO: a releitura da serie e a ULTIMA leitura de `mybank_installments`
  // da rota, e e a unica que pode falhar DEPOIS de o dinheiro ter entrado.
  // `erros` do duble derruba a tabela inteira e impediria o pedido de comecar,
  // entao o embrulho deixa as duas primeiras leituras passarem e derruba a
  // terceira.
  const sessao = criarDuble({ user: { id: EU }, tabelas: linhas });
  let leituras = 0;
  globalThis.__dubleDeSupabase = {
    sessao: () => ({
      ...sessao.client,
      from(tabela) {
        const api = sessao.client.from(tabela);
        if (tabela !== "mybank_installments") return api;
        return {
          ...api,
          select(cols) {
            leituras += 1;
            if (leituras < 2) return api.select(cols);
            const falha = {
              eq: () => falha,
              then: (res, rej) =>
                Promise.resolve({
                  data: null,
                  error: { code: "XX000", message: "conexão caiu" },
                }).then(res, rej),
            };
            return falha;
          },
        };
      },
    }),
  };

  let resposta;
  try {
    resposta = await ANTECIPA.POST(
      { json: async () => ({ parcelas: 2, data_do_pagamento: "2026-12-01" }) },
      { params: { id: "loan-antecipa" } }
    );
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  const corpo = await resposta.json();

  // O DINHEIRO ENTROU, e a rota diz isso.
  assert.equal(resposta.status, 200, JSON.stringify(corpo));
  assert.equal(corpo.parcelas_antecipadas, 2);
  assert.equal(linhas.financial_transactions.length, 2);

  // E O QUE ELA NAO SABE SAI COMO `null`, E NAO COMO ZERO. Um `0` aqui diria
  // "nao sobrou nada a pagar" porque a releitura falhou, e as parcelas pagas ja
  // estao pagas -- quem le concluiria que quitou.
  assert.equal(corpo.parcelas_em_aberto, null);
  assert.equal(corpo.ultimo_vencimento_depois, null);
  assert.equal(corpo.emprestimo_quitado, false);
  assert.match(corpo.message, /não consegui reler/i);
  assert.equal(/quitado/i.test(corpo.message), false);

  // E NADA DE `settled`: sem saber o que sobrou, declarar a quitacao tiraria a
  // divida das duas telas (que filtram `active`) por causa de uma consulta que
  // nao respondeu.
  assert.equal(escritasEm(sessao, "mybank_loans", "update").length, 0);
  assert.equal(
    linhas.mybank_loans.find((l) => l.id === "loan-antecipa").status,
    "active"
  );
});

test("O CONTROLE DA ISSUE: a soma da divida continua fechando com o principal", async () => {
  // ESTE TESTE TEM UMA ASSERCAO SO, E ISSO E DELIBERADO.
  //
  // O mutante que a issue nomeia -- "a antecipacao CANCELA a cauda" -- escreve
  // `cancelled` em duas parcelas e `paid` em duas outras. Num teste que TAMBEM
  // afirme `status` ele morre na primeira assercao de status, e o placar diz
  // "morto" sem que nada tenha medido o dinheiro: a prova ficaria amarrada a
  // qual status cada desenho escreve, e nao ao fato de um deles perder R$ 200.
  //
  // Aqui a unica assercao e o somatorio. Com a cauda cancelada ele cai de
  // R$ 600 para R$ 400, e nenhum CHECK deste banco reclama disso.
  const linhas = tabelasDaAntecipacao();
  const { status, corpo } = await antecipar({ tabelas: linhas });
  assert.equal(status, 200, JSON.stringify(corpo));

  assert.equal(
    somaDaDivida(linhas.mybank_installments, "loan-antecipa").total,
    Math.round(EMPRESTIMO_A_ANTECIPAR.principal * 100),
    "soma(pagas) + soma(em aberto) tem de continuar sendo o principal"
  );
});

test("ANTECIPAR 2: as parcelas 5 e 6 viram `paid` e a SOMA continua R$ 600", async () => {
  const linhas = tabelasDaAntecipacao();
  const { status, corpo, sessao } = await antecipar({ tabelas: linhas });

  assert.equal(status, 200, JSON.stringify(corpo));
  assert.equal(corpo.success, true);
  assert.equal(corpo.parcelas_antecipadas, 2);
  assert.equal(corpo.valor, 200);

  const porId = new Map(linhas.mybank_installments.map((p) => [p.id, p]));

  // AS DO FIM DA SERIE VIRAM `paid` -- e com os tres campos juntos, que e o que
  // `mybank_installments_paid_check` exige.
  for (const id of ["n5", "n6"]) {
    assert.equal(porId.get(id).status, "paid", `${id} tem de estar paga`);
    assert.equal(porId.get(id).paid_date, "2026-12-01");
    assert.ok(porId.get(id).paid_transaction_id, `${id} aponta para a perna`);
  }

  // NADA E CANCELADO. `cancelled` quer dizer "encerrada sem dinheiro" neste
  // banco, e e isso que extinguiria o dobro do que foi pago.
  assert.equal(
    linhas.mybank_installments.filter((p) => p.status === "cancelled").length,
    0
  );

  // A PARCELA 2 CONTINUA PENDENTE, NO DIA DELA E COM O VALOR DELA. Esta e a
  // metade da decisao de produto que nenhum numero de total denuncia: a serie
  // encurta pelo FIM, e nao pela frente.
  assert.equal(porId.get("n2").status, "pending");
  assert.equal(porId.get("n2").due_date, "2026-12-10");
  assert.equal(porId.get("n2").amount, 100);
  assert.equal(porId.get("n3").status, "pending");
  assert.equal(porId.get("n4").status, "reported");

  // O CONTROLE DESTA ISSUE: `soma(pagas) + soma(em aberto) = principal`. Com a
  // cauda CANCELADA esta soma cai para R$ 400 e nenhum CHECK reclama.
  const soma = somaDaDivida(linhas.mybank_installments, "loan-antecipa");
  assert.equal(soma.pagas, 30000, "pagas: a 1, a 5 e a 6");
  assert.equal(soma.emAberto, 30000, "em aberto: a 2, a 3 e a 4");
  assert.equal(
    soma.total,
    Math.round(EMPRESTIMO_A_ANTECIPAR.principal * 100),
    "soma(pagas) + soma(em aberto) tem de ser o principal"
  );

  // E A SERIE ENCURTOU: o fim era 04/2027 e passou a ser 02/2027.
  assert.equal(corpo.ultimo_vencimento_antes, "04/2027");
  assert.equal(corpo.ultimo_vencimento_depois, "02/2027");
  assert.deepEqual(corpo.numeros, [6, 5]);
  assert.equal(corpo.parcelas_em_aberto, 3);
  assert.equal(corpo.emprestimo_quitado, false);
  assert.match(corpo.message, /mantêm o valor/i);
});

test("as DUAS pernas sao `transfer` POSITIVA na conta de investimento, uma por parcela", async () => {
  const linhas = tabelasDaAntecipacao();
  const { status, corpo, sessao } = await antecipar({ tabelas: linhas });

  assert.equal(status, 200, JSON.stringify(corpo));

  const lancamentos = escritasEm(sessao, "financial_transactions", "insert");
  // UMA CHAMADA DE INSERT POR PARCELA, e nao um lote: o rollback precisa saber
  // qual perna desfazer, e um `.in()` de N ids num UPDATE so seria atomico na
  // baixa e nao nas N pernas.
  assert.equal(lancamentos.length, 2);

  const pernas = lancamentos.map((e) => e.linhas[0]);
  for (const perna of pernas) {
    // `transfer` E NAO `income`: principal voltando nao e receita, e aqui o
    // mesmo principal entraria como renda DUAS vezes num unico clique.
    assert.equal(perna.transaction_type, "transfer");
    assert.equal(perna.account_id, INVESTIMENTO);
    assert.equal(perna.amount, 100);
    assert.ok(perna.amount > 0, "a entrada e positiva");
    assert.equal(perna.transaction_date, "2026-12-01");
    assert.equal(perna.category_id, CATEGORIA_TRANSFER);
    assert.equal(perna.group_id, null);
  }

  // O ELO, NOS DOIS SENTIDOS: a perna leva `mybank:<id>` em `notes`, e a parcela
  // aponta para a perna DELA. Sem a segunda metade, duas parcelas poderiam
  // apontar para a mesma linha e uma perna ficaria sem divida que a explicasse.
  assert.deepEqual(pernas.map((p) => p.notes).sort(), ["mybank:n5", "mybank:n6"]);

  const porId = new Map(linhas.mybank_installments.map((p) => [p.id, p]));
  const elos = [
    porId.get("n5").paid_transaction_id,
    porId.get("n6").paid_transaction_id,
  ];
  assert.equal(new Set(elos).size, 2, "cada parcela aponta para a perna DELA");
  assert.deepEqual(corpo.transacoes.sort(), [...elos].sort());
});

test("o patch da baixa nao toca `amount` nem `installment_total`", async () => {
  const linhas = tabelasDaAntecipacao();
  const { sessao } = await antecipar({ tabelas: linhas });

  for (const escrita of escritasEm(sessao, "mybank_installments", "update")) {
    // A decisao de produto em forma de assercao: "as que sobram mantem o valor"
    // e verdade porque NENHUM `amount` e tocado -- nem das que ficam nem das que
    // saem. E `installment_total` intacto e o que mantem o CHECK
    // `installment_number BETWEEN 1 AND installment_total` fora do caminho, que
    // e a razao de esta issue nao ter migration.
    assert.deepEqual(Object.keys(escrita.patch).sort(), [
      "paid_date",
      "paid_transaction_id",
      "status",
    ]);
    assert.equal(escrita.linhasAfetadas, 1);
  }

  assert.equal(escritasEm(sessao, "mybank_loans", "update").length, 0);
});

test("a escolha da cauda e SO desta divida: a parcela do vizinho nao e tocada", async () => {
  const linhas = tabelasDaAntecipacao();
  const { status, corpo } = await antecipar({ tabelas: linhas });

  assert.equal(status, 200, JSON.stringify(corpo));

  // `v1` vence em 2029 -- depois de TODA parcela do notebook. Sem o
  // `.eq("loan_id")` na leitura ela seria a primeira da cauda, e antecipar o
  // notebook pagaria a bicicleta.
  const vizinha = linhas.mybank_installments.find((p) => p.id === "v1");
  assert.equal(vizinha.status, "pending");
  assert.equal(vizinha.paid_date, null);
  assert.equal(vizinha.paid_transaction_id, null);

  const soma = somaDaDivida(linhas.mybank_installments, "loan-vizinho");
  assert.equal(soma.pagas, 0);
});

test("ANTECIPAR AS 5 QUE SOBRAM: o emprestimo vira `settled` e sai das telas", async () => {
  const linhas = tabelasDaAntecipacao();
  const { status, corpo, sessao } = await antecipar({
    tabelas: linhas,
    corpo: { parcelas: 5, data_do_pagamento: "2026-12-01" },
  });

  assert.equal(status, 200, JSON.stringify(corpo));
  assert.equal(corpo.parcelas_antecipadas, 5);
  assert.equal(corpo.valor, 500);

  const [quitacao] = escritasEm(sessao, "mybank_loans", "update");
  assert.deepEqual(quitacao.patch, { status: "settled" });
  assert.equal(quitacao.linhasAfetadas, 1);
  assert.equal(
    linhas.mybank_loans.find((l) => l.id === "loan-antecipa").status,
    "settled"
  );
  assert.equal(corpo.emprestimo_quitado, true);

  // A SOMA DEPOIS DA QUITACAO: tudo pago, nada em aberto, e o total continua o
  // principal. E o desenho que cancela a cauda chegaria aqui com R$ 100.
  const soma = somaDaDivida(linhas.mybank_installments, "loan-antecipa");
  assert.equal(soma.pagas, 60000);
  assert.equal(soma.emAberto, 0);
  assert.equal(soma.total, 60000);

  // E A FRASE MUDA: nao ha "as que sobram mantem o valor" quando nao sobra nada.
  assert.equal(corpo.ultimo_vencimento_depois, null);
  assert.match(corpo.message, /quitado/i);
  assert.equal(/mantêm o valor/i.test(corpo.message), false);

  // O VIZINHO NAO QUITA JUNTO: ele tem parcela em aberto e o UPDATE e por id.
  assert.equal(escritasEm(sessao, "mybank_loans", "update").length, 1);
  assert.equal(
    linhas.mybank_loans.find((l) => l.id === "loan-vizinho").status,
    "active"
  );
});

test("a quitacao filtrada pela RLS NAO desfaz as baixas, e a resposta nao mente", async () => {
  const linhas = tabelasDaAntecipacao();
  const { status, corpo, sessao } = await antecipar({
    tabelas: linhas,
    corpo: { parcelas: 5, data_do_pagamento: "2026-12-01" },
    // O UPDATE em `mybank_loans` alcanca ZERO linha, sem erro.
    rlsFiltra: { mybank_loans: true },
  });

  // O DINHEIRO FICA. Reverter cinco baixas para preservar um status seria trocar
  // um registro atrasado por cinco pagamentos apagados.
  assert.equal(status, 200, JSON.stringify(corpo));
  assert.equal(corpo.parcelas_antecipadas, 5);
  assert.equal(
    linhas.mybank_installments.filter(
      (p) => p.loan_id === "loan-antecipa" && p.status === "paid"
    ).length,
    6
  );
  assert.equal(linhas.financial_transactions.length, 5);

  // E A RESPOSTA NAO MENTE: o UPDATE nao alcancou a linha, entao nao houve
  // quitacao -- e a frase nao pode anunciar um status que tela nenhuma leria.
  assert.equal(corpo.emprestimo_quitado, false);
  assert.equal(
    linhas.mybank_loans.find((l) => l.id === "loan-antecipa").status,
    "active"
  );
  assert.equal(/quitado/i.test(corpo.message), false);
  assert.match(corpo.message, /continua em atividade/i);
  assert.equal(escritasEm(sessao, "mybank_loans", "update").length, 1);
});

test("antecipar 1 com 2 em aberto NAO quita nada", async () => {
  const linhas = tabelasDaAntecipacao({
    mybank_loans: [{ ...EMPRESTIMO_A_ANTECIPAR }],
    mybank_installments: [
      parcelaDoNotebook(5, "pending"),
      parcelaDoNotebook(6, "pending"),
    ],
  });

  const { status, corpo, sessao } = await antecipar({
    tabelas: linhas,
    corpo: { parcelas: 1, data_do_pagamento: "2026-12-01" },
  });

  assert.equal(status, 200, JSON.stringify(corpo));
  assert.equal(corpo.parcelas_antecipadas, 1);
  assert.equal(corpo.emprestimo_quitado, false);
  assert.equal(escritasEm(sessao, "mybank_loans", "update").length, 0);
  assert.equal(
    linhas.mybank_installments.find((p) => p.id === "n5").status,
    "pending"
  );
});

// ---------------------------------------------------------------------------
// 12.5 -- A ROTA: as recusas, e NADA e escrito em nenhuma delas
// ---------------------------------------------------------------------------

test("A DEVEDORA LEVA 403, e nada e escrito -- o passo 6 da medicao", async () => {
  const linhas = tabelasDaAntecipacao();
  const { status, corpo, sessao } = await antecipar({
    quem: LAIS,
    tabelas: linhas,
  });

  // A trava da 053 recusaria `paid_date` com `insufficient_privilege`, mas a
  // POLICY de UPDATE FILTRA em silencio -- 200 com `[]`. Sem a pergunta na rota
  // ela receberia "antecipei duas parcelas" de uma escrita que nao aconteceu.
  assert.equal(status, 403);
  assert.match(corpo.error, /Só quem emprestou/i);
  assert.equal(sessao.escritas.length, 0);

  // E A FRASE NAO CONTA O ESTADO DA DIVIDA.
  assert.equal(/active|cancel|settled/i.test(corpo.error), false);
});

test("o CASO A e recusado com o ponteiro para Contas a Pagar, e sem escrita", async () => {
  const linhas = tabelasDaAntecipacao({
    mybank_loans: [{ ...EMPRESTIMO_A_ANTECIPAR, borrower_user_id: EU }],
  });

  const { status, corpo, sessao } = await antecipar({ tabelas: linhas });

  // Antecipar aqui encurtaria a serie sem nada ter saido da conta: a parcela do
  // auto-emprestimo JA e uma transferencia prevista, e quem move o dinheiro e a
  // baixa dela. "O numero fecha, o fato nao aconteceu."
  assert.equal(status, 400);
  assert.match(corpo.error, /Contas a Pagar/);
  assert.equal(sessao.escritas.length, 0);
});

test("corpo sem `parcelas`, ou com valor em reais, e recusado em 400", async () => {
  for (const corpo of [
    {},
    { parcelas: 0 },
    { parcelas: -2 },
    { parcelas: 1.5 },
    { parcelas: "duas" },
    // O PEDIDO QUE A FORMA DO CORPO TORNA INEXPRIMIVEL: R$ 150 contra parcelas
    // de R$ 100. `valor` nao e um campo desta rota, entao ele chega como corpo
    // sem `parcelas` -- e a recusa vem com a frase que diz o que fazer.
    { valor: 150 },
  ]) {
    const r = await antecipar({ corpo });

    assert.equal(r.status, 400, `corpo ${JSON.stringify(corpo)} tem de ser 400`);
    assert.match(r.corpo.error, /parcela inteira/i);
    assert.equal(r.sessao.escritas.length, 0);
  }
});

test("antecipar MAIS do que esta em aberto e 409, e nao antecipa o que cabe", async () => {
  const linhas = tabelasDaAntecipacao();
  const { status, corpo, sessao } = await antecipar({
    tabelas: linhas,
    corpo: { parcelas: 6 },
  });

  // Sao 5 em aberto. Antecipar "as 5 que cabem" seria a rota decidir um valor
  // diferente do que a pessoa confirmou -- e o valor e dinheiro que sai da conta
  // dela.
  assert.equal(status, 409);
  assert.match(corpo.error, /5 parcelas em aberto/);
  assert.equal(sessao.escritas.length, 0);
});

test("emprestimo fora de `active` e 409, com o status na frase", async () => {
  for (const estado of ["cancelled", "settled"]) {
    const linhas = tabelasDaAntecipacao({
      mybank_loans: [{ ...EMPRESTIMO_A_ANTECIPAR, status: estado }],
    });

    const r = await antecipar({ tabelas: linhas });

    assert.equal(r.status, 409);
    assert.match(r.corpo.error, new RegExp(estado));
    assert.equal(r.sessao.escritas.length, 0);
  }
});

test("emprestimo COM JURO e recusado em 409 -- a fase 2 reabre a feature", async () => {
  const linhas = tabelasDaAntecipacao({
    mybank_loans: [{ ...EMPRESTIMO_A_ANTECIPAR, interest_rate: "2.00" }],
  });

  const { status, corpo, sessao } = await antecipar({ tabelas: linhas });

  // Somar `amount` com juro cobraria juro de um tempo que nao existiu. A rota
  // recusa em vez de calcular errado.
  assert.equal(status, 409);
  assert.match(corpo.error, /juro/i);
  assert.equal(sessao.escritas.length, 0);
});

test("emprestimo que nao e meu nem e divida minha volta 404, e nao 403", async () => {
  const { status, sessao } = await antecipar({ loanId: "loan-que-nao-existe" });

  // "Existe mas nao e seu" confirmaria a existencia do id para quem o chutou.
  assert.equal(status, 404);
  assert.equal(sessao.escritas.length, 0);
});

// ---------------------------------------------------------------------------
// 12.6 -- A ROTA: o rollback da perna, e a antecipacao PARCIAL
// ---------------------------------------------------------------------------

test("A BAIXA FILTRADA PELA RLS DESFAZ A PERNA -- nada de dinheiro fica no extrato", async () => {
  const linhas = tabelasDaAntecipacao();
  const { status, corpo, sessao } = await antecipar({
    tabelas: linhas,
    // A escrita em `mybank_installments` alcanca ZERO linha, sem erro -- a
    // resposta medida em producao quando a policy nao casa com a linha.
    rlsFiltra: { mybank_installments: true },
  });

  // NENHUMA PARCELA ENTROU: o mundo esta como antes do pedido.
  assert.equal(status, 500);
  assert.equal(corpo.parcelas_antecipadas, 0);

  // A PERNA FOI GRAVADA E DEPOIS APAGADA. Sem o rollback ela ficaria no extrato
  // da conta de investimento sem nenhuma parcela paga que a explicasse -- o
  // saldo sobe e a divida fica inteira de pe.
  const insercoes = escritasEm(sessao, "financial_transactions", "insert");
  assert.equal(insercoes.length, 1, "a perna da PRIMEIRA parcela foi tentada");

  const [apagada] = escritasEm(sessao, "financial_transactions", "delete");
  assert.ok(apagada, "a perna tem de ser apagada quando a baixa nao alcanca");
  assert.deepEqual(apagada.filtros, [
    ["eq", "id", insercoes[0].linhas[0].id],
  ]);
  assert.equal(linhas.financial_transactions.length, 0);

  // E O LACO PARA NA PRIMEIRA: insistir nas seguintes depois de uma falha de
  // escrita so aumenta a chance de parar num estado pior.
  assert.equal(linhas.mybank_installments.filter((p) => p.status === "paid").length, 1);
  assert.equal(escritasEm(sessao, "mybank_loans", "update").length, 0);
});

test("a perna que NAO entra nao deixa parcela baixada, e nada e apagado", async () => {
  const linhas = tabelasDaAntecipacao();
  const { status, corpo, sessao } = await antecipar({
    tabelas: linhas,
    erros: {
      financial_transactions: { code: "XX000", message: "sem espaço" },
    },
  });

  assert.equal(status, 500);
  assert.equal(corpo.parcelas_antecipadas, 0);

  // A BAIXA NAO ACONTECE: ela vem DEPOIS da perna de proposito. Na ordem
  // inversa a parcela ficaria paga apontando para um lancamento que nao existe.
  assert.equal(escritasEm(sessao, "mybank_installments", "update").length, 0);
  assert.equal(
    linhas.mybank_installments.filter((p) => p.status === "paid").length,
    1,
    "so a parcela que ja estava paga antes do pedido"
  );
});

/**
 * Um cliente que deixa a PRIMEIRA baixa passar e faz a SEGUNDA alcancar ZERO
 * LINHA, sem erro -- a forma exata que a RLS produz (200 com corpo `[]`).
 *
 * POR QUE UM EMBRULHO, E NAO `rlsFiltra`/`erros` DO DUBLE
 * ----------------------------------------------------
 * Os dois botoes do duble valem para a TABELA INTEIRA: eles derrubariam a
 * primeira baixa tambem, e o caso medido voltaria a ser "nada entrou" -- que ja
 * tem teste. A antecipacao PARCIAL e um estado que so existe quando uma parcela
 * entra e a seguinte nao, e sem este embrulho ele nao tem como ser montado.
 *
 * O embrulho intercepta SO `update` em `mybank_installments`: os `insert` das
 * pernas, o `delete` do rollback e todas as leituras continuam indo ao duble, e
 * e por isso que as assercoes sobre eles continuam medindo o duble.
 */
function clienteComASegundaBaixaFiltrada(client) {
  let baixas = 0;

  return {
    ...client,
    from(tabela) {
      const api = client.from(tabela);
      if (tabela !== "mybank_installments") return api;

      return {
        ...api,
        update(patch) {
          baixas += 1;
          if (baixas === 1) return api.update(patch);

          // Zero linha e nenhum erro. A cadeia devolve `this` em cada filtro
          // porque a rota encadeia `.eq().select()` antes do `await`.
          const cadeia = {
            eq: () => cadeia,
            in: () => cadeia,
            select: () => cadeia,
            then: (res, rej) =>
              Promise.resolve({ data: [], error: null }).then(res, rej),
          };
          return cadeia;
        },
      };
    },
  };
}

test("ANTECIPACAO PARCIAL: a resposta diz o NUMERO, e nao `sucesso`", async () => {
  const linhas = tabelasDaAntecipacao();
  const sessao = criarDuble({ user: { id: EU }, tabelas: linhas });
  globalThis.__dubleDeSupabase = {
    sessao: () => clienteComASegundaBaixaFiltrada(sessao.client),
  };

  let resposta;
  try {
    resposta = await ANTECIPA.POST(
      { json: async () => ({ parcelas: 2, data_do_pagamento: "2026-12-01" }) },
      { params: { id: "loan-antecipa" } }
    );
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  const corpo = await resposta.json();

  // 200, PORQUE UMA PARCELA FOI ANTECIPADA DE VERDADE -- o dinheiro entrou e a
  // parcela 6 esta paga. Devolver 500 aqui diria que nada aconteceu.
  assert.equal(resposta.status, 200, JSON.stringify(corpo));

  // O CONTRATO E O NUMERO. `success` e `false` justamente para que quem le so
  // ele nao trate 1-de-2 como 2.
  assert.equal(corpo.parcelas_antecipadas, 1);
  assert.equal(corpo.parcelas_pedidas, 2);
  assert.equal(corpo.success, false);
  assert.ok(corpo.parcial, "a resposta diz o que parou");
  assert.deepEqual(corpo.numeros, [6]);
  assert.equal(corpo.valor, 100);

  // A FRASE TAMBEM SAI DO QUE ENTROU: "2 parcelas antecipadas" de uma so seria
  // a resposta mentindo sobre o dinheiro que ela mesma movimentou.
  assert.match(corpo.message, /Parcela 6 antecipada/);
  assert.equal(/2 parcelas antecipadas/.test(corpo.message), false);

  const porId = new Map(linhas.mybank_installments.map((p) => [p.id, p]));

  // A 6 ENTROU INTEIRA (perna + baixa); a 5 nao entrou de jeito nenhum.
  assert.equal(porId.get("n6").status, "paid");
  assert.ok(porId.get("n6").paid_transaction_id);
  assert.equal(porId.get("n5").status, "pending");
  assert.equal(porId.get("n5").paid_date, null);

  // E A PERNA DA 5 FOI DESFEITA: sobra UMA linha de dinheiro, a da parcela que
  // de fato baixou. Sem o rollback sobrariam duas, e uma delas sem divida que a
  // explicasse.
  assert.equal(linhas.financial_transactions.length, 1);
  assert.equal(linhas.financial_transactions[0].notes, "mybank:n6");

  // PARAR NO MEIO E UM ESTADO CONSISTENTE, E ESTA E A ASSERCAO QUE O DIZ:
  // `soma(pagas) + soma(em aberto) = principal` vale depois de CADA parcela, e
  // e por isso que esta rota nao precisa de transacao.
  const soma = somaDaDivida(linhas.mybank_installments, "loan-antecipa");
  assert.equal(soma.pagas, 20000, "a 1 (de antes) e a 6");
  assert.equal(soma.emAberto, 40000, "a 2, a 3, a 4 e a 5");
  assert.equal(
    soma.total,
    Math.round(EMPRESTIMO_A_ANTECIPAR.principal * 100),
    "a invariante vale no estado parcial"
  );

  // E NAO HOUVE QUITACAO: sobrou divida em aberto.
  assert.equal(corpo.emprestimo_quitado, false);
  assert.equal(
    linhas.mybank_loans.find((l) => l.id === "loan-antecipa").status,
    "active"
  );
});

test("CONTROLE: a rota da antecipacao usou o duble (as ausencias nao sao vacuas)", async () => {
  const { sessao } = await antecipar();

  // Sem esta sonda, um `erros`/`rlsFiltra` mal montado faria a rota cair no
  // `catch` e TODA assercao de "nada foi escrito" passaria sem medir nada.
  assert.ok(
    sessao.lidas.some((l) => l.tabela === "mybank_loans"),
    "a rota leu o emprestimo pelo duble"
  );
  assert.ok(
    sessao.lidas.some((l) => l.tabela === "mybank_installments"),
    "a rota leu as parcelas pelo duble"
  );
  assert.ok(
    sessao.escritas.some(
      (e) => e.tabela === "financial_transactions" && e.verbo === "insert"
    ),
    "a rota gravou perna pelo duble"
  );
});
