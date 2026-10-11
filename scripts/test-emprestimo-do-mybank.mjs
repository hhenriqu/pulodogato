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
