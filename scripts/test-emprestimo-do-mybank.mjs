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

async function mexerNaParcela(quem, corpoDoPedido, extra = {}) {
  const sessao = criarDuble({
    user: { id: quem },
    tabelas: tabelas({
      mybank_loans: [EMPRESTIMO_PARA_A_LAIS],
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
