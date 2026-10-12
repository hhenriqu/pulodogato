#!/usr/bin/env node
// =====================================================
// PULODOGATO - A RECEITA PREVISTA NO FLUXO DE CAIXA (HMO-400)
// =====================================================
//   npm run test:receita-no-fluxo
//
// O DEFEITO, MEDIDO EM PRODUCAO ANTES DE EXISTIR ESTE ARQUIVO
// -----------------------------------------------------------
// "Ao apagar uma receita, ela continua aparecendo no fluxo de caixa" (HMO-400).
// A medicao da conta de teste em producao (scripts/sonda-hmo400-numeros.mjs)
// mostrou que o DELETE funciona nas tres formas de receita -- e achou outra
// coisa, no mesmo lugar: a receita prevista aparece no fluxo de caixa como
// CONTA A PAGAR.
//
//   receita prevista avulsa de R$ 1.000,00, horizonte de 90 dias
//   saldo projetado:  -189,98  ->  -1.189,98
//   «o que vem por ai»: a linha com valor  -1.000,00
//   tela de Receitas, no mesmo instante:  previsto = 1000
//
// Repare na diferenca: R$ 1.000 e nao R$ 2.000. O valor nao estava faltando do
// lado certo -- estava sendo SUBTRAIDO do errado. As duas leituras do mesmo
// dinheiro discordavam no SINAL, e so uma delas estava certa.
//
// POR QUE A SONDA E DA ROTA, E NAO DA FUNCAO PURA
// -----------------------------------------------
// `projetarFluxoDeCaixa` (lib/cash-flow-forecast.ts) sempre soube separar
// entrada de saida: ela recebe `tipo` e tem suite propria, com mutantes
// (`npm run test:cash-flow`). Ela nao tinha como errar isto e nao errou.
//
// Quem errava era a FIACAO: a rota lia
// `recurring_rule:recurring_rules(transaction_type)` e deduzia a direcao da
// REGRA. A previsao AVULSA -- a que nasce em «Nova receita», sem gasto fixo
// atras -- nao tem regra: o embed vinha `null` e o `?:` caia em `"expense"`.
// Uma suite de unidade sobre a funcao pura passa verde com esse defeito de pe,
// porque ela nunca ve a consulta. E um guard textual casaria com o COMENTARIO
// que hoje explica o defeito no proprio arquivo
// (`assercao-textual-casa-com-o-comentario`).
//
// Entao o que esta suite mede e a rota inteira, com duble de client: o que
// entra e uma linha da view, e o que sai e o numero que a tela desenha.
//
// OS DOIS CONTROLES, QUE SAO O QUE DA VALOR AOS CASOS POSITIVOS
// -------------------------------------------------------------
//   * a DESPESA prevista avulsa continua descontando. Sem este caso, "a receita
//     nao desconta mais" passaria verde com a rota ignorando a agenda inteira;
//   * a receita de REGRA FIXA (`direction: "income"` com `recurring_rule_id`)
//     tambem entra -- ela ja funcionava antes do conserto, e e ela que separa
//     "consertei a precedencia" de "troquei um default pelo outro".
//
// E o terceiro, que nao e sobre dinheiro: `d.lidas` afirma que a rota consultou
// `scheduled_transactions_effective`. Sem isso, uma rota que voltasse a ler a
// TABELA continuaria verde aqui -- o duble responde `[]` para tabela que o
// fixture nao tem, e `[]` se le como "nao havia previsao nenhuma".
// =====================================================

import test, { after, before, mock } from "node:test";
import assert from "node:assert/strict";

import { criarDuble } from "./duble-de-supabase.mjs";

// O relogio e congelado -- `relogio-congelado-em-teste-node`. A rota chama
// `today()` (fuso de Sao Paulo) e dele sai o inicio do horizonte, o teto do
// `lte("due_date")` e a janela do gasto variavel. Com o relogio de verdade, a
// previsao do dia 20 estaria DENTRO do horizonte por 90 dias e fora depois --
// os numeros desta suite mudariam no calendario, sem ninguem mexer em codigo.
before(() => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-03-05T15:00:00Z") });
});

after(() => {
  mock.timers.reset();
});

const RAIZ = "../.tmp-receita-no-fluxo";

const FLUXO = await import(`${RAIZ}/app/api/cash-flow/route.js`);

const EU = "11111111-1111-1111-1111-111111111111";
const CORRENTE = "aaaaaaaa-0000-0000-0000-000000000001";
const REGRA_DO_SALARIO = "bbbbbbbb-0000-0000-0000-000000000001";

// Dentro do horizonte de 90 dias que a sonda pede, e DEPOIS do relogio
// congelado (2026-03-05): uma data anterior a hoje seria lida como vencida e
// trazida para hoje, o que e outro caso -- e nao o que se mede aqui.
const VENCE_DIA_20 = "2026-03-20";

/**
 * Uma conta corrente com R$ 1.000.
 *
 * O saldo e folgado de proposito: nenhum numero desta suite pode encostar num
 * piso -- `piso-com-folga-desarma-o-controle-negativo`.
 */
const CONTAS = [
  {
    id: CORRENTE,
    user_id: EU,
    name: "Corrente",
    account_type: "checking",
    current_balance: 1000,
    is_active: true,
  },
];

/**
 * Uma linha da view `scheduled_transactions_effective`.
 *
 * `direction` e `transaction_type` NAO sao a mesma coluna, e e exatamente
 * nisso que a issue mora: `direction` e a precedencia (ocorrencia -> regra ->
 * 'expense') resolvida uma vez na migration 027, e o fixture entrega o que a
 * VIEW entregaria. O default aqui e `"expense"` porque e o default da view.
 */
let seq = 0;
const prevista = (extra = {}) => ({
  id: `prev-${++seq}`,
  user_id: EU,
  description: "Linha prevista",
  amount: 1000,
  due_date: VENCE_DIA_20,
  status: "pending",
  effective_status: "pending",
  direction: "expense",
  recurring_rule_id: null,
  ...extra,
});

/**
 * O fixture completo das SEIS leituras da rota.
 *
 * As cinco que nao sao a agenda entram VAZIAS e nao ausentes: tabela ausente
 * tambem responde `[]` no duble, e o teste nao distinguiria "consultou e nao
 * achou" de "deixou de consultar" (`duble-nao-sabia-contar-count-vira-zero` e
 * a familia). `recurring_rules` vazia tambem desliga a materializacao -- o que
 * se mede aqui e a LEITURA, e uma regra ativa faria a rota gravar ocorrencia
 * nova no meio da medicao.
 */
function tabelas(previstas) {
  return {
    financial_accounts: CONTAS,
    scheduled_transactions_effective: previstas,
    detected_recurrences: [],
    recurring_rules: [],
    financial_transactions: [],
    transaction_categories: [],
  };
}

/**
 * Chama a rota com o duble instalado e devolve o corpo.
 *
 * `gastoDiario=0` em TODAS as chamadas: a linha provavel desconta uma media
 * diaria, e com ela ligada o `saldoFinal` carregaria 90 dias de gasto variavel
 * por cima do numero que esta suite mede. Zero e legitimo na rota (`has`, nao
 * "veio vazio") e e o que deixa a diferenca atribuivel a UMA linha da agenda.
 */
async function chamar(previstas) {
  const d = criarDuble({ user: { id: EU }, tabelas: tabelas(previstas) });
  globalThis.__dubleDeSupabase = { sessao: () => d.client, servico: () => d.client };
  try {
    const resposta = await FLUXO.GET({
      url: "http://t/api/cash-flow?dias=90&gastoDiario=0",
      nextUrl: new URL("http://t/api/cash-flow?dias=90&gastoDiario=0"),
    });
    assert.equal(resposta.status, 200);
    const corpo = await resposta.json();
    return { corpo, d };
  } finally {
    delete globalThis.__dubleDeSupabase;
  }
}

/** A linha de «o que vem por ai» daquela previsao, ou `undefined`. */
const evento = (corpo, id) => corpo.upcoming.find((e) => e.id === id);

// =====================================================
// 0. O RETRATO SEM PREVISAO NENHUMA -- o zero de onde os outros casos partem
// =====================================================
// Literais e nao calculados do fixture: um retrato que se calcula com o mesmo
// codigo que ele vigia passa verde com o codigo errado --
// `conferidor-com-o-mesmo-extrator-nos-dois-lados-passa-vacuo`.

test("retrato: agenda vazia -> saldo final e o saldo de hoje, e nao ha evento", async () => {
  const { corpo } = await chamar([]);

  assert.equal(corpo.cash_flow.saldoInicial, 1000);
  assert.equal(corpo.cash_flow.saldoFinal, 1000);
  assert.equal(corpo.cash_flow.totalEntra, 0);
  assert.equal(corpo.cash_flow.totalSai, 0);
  assert.equal(corpo.upcoming.length, 0);
});

// =====================================================
// 1. O DEFEITO DA ISSUE -- a receita prevista AVULSA
// =====================================================
// Sem regra fixa atras (`recurring_rule_id: null`), que e a forma em que a
// receita digitada em «Nova receita» chega. Antes do conserto esta era a linha
// que virava conta a pagar.

test("receita prevista AVULSA entra como entrada: R$ 1.000 SOBEM o saldo projetado", async () => {
  const receita = prevista({ description: "Salário de março", direction: "income" });
  const { corpo } = await chamar([receita]);

  // O numero da tela, nos dois lugares em que ela o mostra.
  assert.equal(corpo.cash_flow.totalEntra, 1000);
  assert.equal(corpo.cash_flow.totalSai, 0);
  assert.equal(corpo.cash_flow.saldoFinal, 2000);

  // E a linha de «o que vem por ai», com o sinal que a medicao de producao
  // pegou invertido.
  const e = evento(corpo, receita.id);
  assert.ok(e, "a receita prevista tem de aparecer na lista de proximos eventos");
  assert.equal(e.valor, 1000);
  assert.equal(e.saldoDepois, 2000);
});

test("a receita avulsa NAO desconta: nem no menor saldo, nem no dia negativo", async () => {
  // O horizonte inteiro com um saldo que NAO suportaria a mesma linha lida como
  // despesa: com R$ 100 na conta, uma receita de R$ 1.000 lida ao contrario
  // levaria o saldo a -900 e acenderia `primeiroDiaNegativo`. Este caso e o que
  // mede a CONSEQUENCIA do sinal, e nao so o total.
  const receita = prevista({ direction: "income" });
  const d = criarDuble({
    user: { id: EU },
    tabelas: {
      ...tabelas([receita]),
      financial_accounts: [{ ...CONTAS[0], current_balance: 100 }],
    },
  });

  globalThis.__dubleDeSupabase = { sessao: () => d.client, servico: () => d.client };
  try {
    const resposta = await FLUXO.GET({
      url: "http://t/api/cash-flow?dias=90&gastoDiario=0",
      nextUrl: new URL("http://t/api/cash-flow?dias=90&gastoDiario=0"),
    });
    const corpo = await resposta.json();

    assert.equal(corpo.cash_flow.saldoFinal, 1100);
    assert.equal(corpo.cash_flow.menorSaldo, 100);
    assert.equal(corpo.cash_flow.primeiroDiaNegativo, null);
    assert.equal(corpo.cash_flow.comecaNegativo, false);
  } finally {
    delete globalThis.__dubleDeSupabase;
  }
});

// =====================================================
// 2. OS CONTROLES -- sem eles o caso 1 nao prova nada
// =====================================================

test("controle: a DESPESA prevista avulsa continua descontando", async () => {
  const conta = prevista({ description: "Luz", direction: "expense" });
  const { corpo } = await chamar([conta]);

  assert.equal(corpo.cash_flow.totalSai, 1000);
  assert.equal(corpo.cash_flow.totalEntra, 0);
  assert.equal(corpo.cash_flow.saldoFinal, 0);
  assert.equal(evento(corpo, conta.id).valor, -1000);
});

test("controle: a receita de REGRA FIXA tambem entra (ela ja entrava antes)", async () => {
  const salario = prevista({
    description: "Salário",
    direction: "income",
    recurring_rule_id: REGRA_DO_SALARIO,
  });
  const { corpo } = await chamar([salario]);

  assert.equal(corpo.cash_flow.totalEntra, 1000);
  assert.equal(corpo.cash_flow.saldoFinal, 2000);
});

test("controle: direcao DESCONHECIDA cai em despesa, e nao em entrada", async () => {
  // O lado seguro, e o mesmo de `direcaoDaAgenda`: ler uma despesa como receita
  // mostraria "vou receber" sobre uma conta a pagar. `null` acontece de verdade
  // -- e o que a coluna devolve numa linha gravada antes da 027.
  const { corpo } = await chamar([prevista({ direction: null })]);

  assert.equal(corpo.cash_flow.totalSai, 1000);
  assert.equal(corpo.cash_flow.totalEntra, 0);
});

test("controle: a transferencia prevista continua saindo da conta", async () => {
  // Decisao de produto preservada, nao descuido: a perna agendada e uma saida
  // datada da conta corrente, e e isso que esta tela projeta. Ver o comentario
  // de `direcaoDaAgenda` e `transferencia-prevista-tem-3-leituras-2-a-mantem`.
  const { corpo } = await chamar([prevista({ direction: "transfer" })]);

  assert.equal(corpo.cash_flow.totalSai, 1000);
  assert.equal(corpo.cash_flow.totalEntra, 0);
});

// =====================================================
// 3. A RECEITA QUE SAIU DA AGENDA -- o pedido literal da issue
// =====================================================
// O DELETE de «apenas esta» ocorrencia grava `status = 'skipped'`, e nao apaga
// a linha (a ocorrencia de regra fixa apagada voltaria na proxima
// materializacao). Medido em producao: o fluxo de caixa deixa de mostra-la. O
// caso esta aqui porque e o que a issue pede, e porque e um filtro de UMA
// palavra -- trocar `pending` por `in(['pending','skipped'])` em nome de
// "mostrar o historico" devolveria o defeito relatado.

test("receita PULADA (skipped) nao aparece no fluxo de caixa", async () => {
  const pulada = prevista({ direction: "income", status: "skipped" });
  const { corpo } = await chamar([pulada]);

  assert.equal(corpo.cash_flow.totalEntra, 0);
  assert.equal(corpo.upcoming.length, 0);
  assert.equal(corpo.cash_flow.saldoFinal, 1000);
});

test("receita CANCELADA e receita PAGA tambem ficam fora", async () => {
  const { corpo } = await chamar([
    prevista({ direction: "income", status: "cancelled" }),
    prevista({ direction: "income", status: "paid" }),
  ]);

  assert.equal(corpo.cash_flow.totalEntra, 0);
  assert.equal(corpo.upcoming.length, 0);
});

// =====================================================
// 4. A FIACAO -- de qual relacao a rota le, e com qual filtro
// =====================================================

test("a rota le a VIEW `scheduled_transactions_effective`, nao a tabela", async () => {
  const { d } = await chamar([prevista({ direction: "income" })]);

  assert.ok(
    d.lidas.some((l) => l.tabela === "scheduled_transactions_effective"),
    "sem esta leitura a direcao nao existe: a tabela crua nao tem `direction`"
  );

  // E NAO a tabela crua. Esta metade e que fecha a porta de volta: a direcao
  // deduzida do embed `recurring_rules(transaction_type)` e justamente o que
  // deixava a previsao AVULSA sem regra para consultar.
  //
  // A assercao nao e vazia aqui de propria: com `recurring_rules: []` no
  // fixture, `materializarAgenda` devolve antes de tocar
  // `scheduled_transactions` (`if (!regras?.length) return`), entao a tabela
  // crua so apareceria em `lidas` se a CONSULTA DA PREVISAO voltasse para ela.
  assert.ok(
    !d.lidas.some((l) => l.tabela === "scheduled_transactions"),
    "a previsao nao sai mais da tabela: sem `direction` a receita avulsa vira despesa"
  );

  // O filtro de status na PROPRIA leitura da agenda, e nao em qualquer uma das
  // seis: o caso `skipped` acima mede o efeito, este mede onde ele e pedido.
  const daAgenda = d.lidas.find(
    (l) => l.tabela === "scheduled_transactions_effective"
  );
  assert.ok(
    daAgenda.filtros.some(
      ([op, coluna, valor]) => op === "eq" && coluna === "status" && valor === "pending"
    ),
    "o recorte de `pending` e o que mantem a receita apagada fora da projecao"
  );
});

test("o filtro de usuario FICA: a view deixa passar linha de grupo de outro membro", async () => {
  // A view e `security_invoker` e a policy do 005 libera `group_id IS NOT NULL
  // AND is_group_member(group_id)`. Sem o `.eq("user_id")` o aluguel de R$
  // 3.000 do grupo entraria no fluxo de caixa de cada membro pelo valor CHEIO.
  // O duble NAO tem RLS (ver o cabecalho dele), entao a linha do outro membro
  // chega aqui como chegaria da view -- e o que se mede e o filtro da ROTA.
  const minha = prevista({ direction: "income", amount: 500 });
  const doOutro = prevista({
    user_id: "22222222-2222-2222-2222-222222222222",
    direction: "expense",
    amount: 3000,
    group_id: "cccccccc-0000-0000-0000-000000000001",
  });

  const { corpo } = await chamar([minha, doOutro]);

  assert.equal(corpo.cash_flow.totalEntra, 500);
  assert.equal(corpo.cash_flow.totalSai, 0, "a linha do outro membro nao e minha");
  assert.equal(corpo.upcoming.length, 1);
});
