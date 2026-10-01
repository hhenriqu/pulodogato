#!/usr/bin/env node
// =====================================================
// PULODOGATO - a fatura ABERTA em Contas a Pagar (HMO-227)
// =====================================================
// O pedido do dono: "Valor total a ser pago no cartao deve aparecer em contas
// previstas com a data de vencimento do cartao para que o usuario informe que
// pagou o cartao."
//
// O modelo de dados ja existia inteiro -- `POST /api/card-invoices/close` cria a
// linha certa, o filtro da HMO-209 a deixa passar, e a baixa dela ja e a
// transferencia de duas pernas da HMO-149. O que faltava era QUEM cria a linha:
// fechar e manual e o unico botao mora em /dashboard/budgets. Quem nunca abre
// Orcamentos nunca via a fatura em Contas a Pagar.
//
// A SINTESE TEM QUATRO MANEIRAS DE DAR ERRADO SEM ERRO NENHUM:
//
//   1. SAIR EM DOBRO. A fatura ja fechada e uma linha real da agenda; se a
//      sintetizada tambem sair, a mesma fatura aparece duas vezes com o mesmo
//      valor e o mesmo vencimento, e o cabecalho cobra o dobro. As duas linhas
//      sao plausiveis lado a lado -- e o controle negativo "linha persistida
//      existe" desta suite.
//   2. INVENTAR VENCIMENTO. Sem `due_day` o banco devolve `invoice_due_date`
//      NULL. Cair num padrao poria na tela uma data que ninguem calculou, e a
//      pessoa pagaria no dia errado por causa de um chute do app.
//   3. DESAPARECER CALADA. A outra metade do caso 2: omitir o cartao sem
//      vencimento e o defeito da issue de volta, agora com o app TENDO os dados
//      para avisar.
//   4. SINTETIZAR SO NA LISTA. O cabecalho ("a vencer") e as linhas saem de duas
//      rotas da MESMA pagina. Sintetizar numa so faz as duas discordarem lado a
//      lado -- e o cabecalho seria o numero MENOR, o que parece certo.
//
// Nenhuma delas quebra nada: todas produzem uma tela de aparencia normal.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  agendaComFaturasAbertas,
  agendaSemCompraNoCartao,
  ehFaturaPrevista,
  sintetizarFaturasAbertas,
} from "../.tmp-fatura-prevista/agenda-do-cartao.js";
import { chaveFatura } from "../.tmp-fatura-prevista/card-invoice.js";
import {
  direcaoDaAgenda,
  somarEmAberto,
} from "../.tmp-fatura-prevista/previsto-x-realizado.js";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

const CARTAO = "11111111-1111-4111-8111-111111111111";
const OUTRO_CARTAO = "22222222-2222-4222-8222-222222222222";

/** A janela que a tela de contas usa: de hoje ate o horizonte. */
const JANELA = { de: "2026-10-01", ate: "2026-12-31", hoje: "2026-10-05" };

/** Uma linha de `card_invoice_lines`, como a view a entrega. */
function linhaDaFatura(extra = {}) {
  return {
    account_id: CARTAO,
    account_name: "Nubank",
    invoice_month: "2026-10-01",
    invoice_due_date: "2026-10-10",
    // `invoice_amount` ja vem com o sinal invertido pela view: a compra soma.
    invoice_amount: 100,
    ...extra,
  };
}

function sintetizar(linhas, extra = {}) {
  return sintetizarFaturasAbertas({
    linhas,
    chavesPersistidas: [],
    ...JANELA,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// A FATURA ABERTA VIRA UMA LINHA DA AGENDA
// ---------------------------------------------------------------------------

test("a fatura aberta entra na agenda com o total e o vencimento do cartao", () => {
  const { previstas } = sintetizar([
    linhaDaFatura({ invoice_amount: 180.5 }),
    linhaDaFatura({ invoice_amount: 39.9 }),
    linhaDaFatura({ invoice_amount: 1000 }),
  ]);

  assert.equal(previstas.length, 1, "tres compras, UMA fatura");

  const [fatura] = previstas;
  assert.equal(fatura.amount, 1220.4, "o total e SUM(invoice_amount)");
  assert.equal(fatura.due_date, "2026-10-10", "o vencimento vem da view");
  assert.equal(fatura.account_id, CARTAO);
  assert.equal(fatura.invoice_month, "2026-10-01");
  assert.equal(fatura.status, "pending");
  assert.equal(fatura.effective_status, "pending");
  assert.equal(fatura.days_until_due, 5);
  // Fatura e sempre dinheiro saindo. Sem isto ela cairia em "a receber" e o
  // cabecalho mostraria a fatura do cartao como dinheiro entrando.
  assert.equal(fatura.direction, "expense");
  // Fatura nao e de grupo: o rateio e das COMPRAS, uma a uma, e elas ja estao
  // dentro deste total. Com `group_id` a parte do grupo dividiria a fatura
  // inteira pelo numero de membros.
  assert.equal(fatura.group_id, null);
});

test("a linha sintetizada NAO tem id, e se anuncia como sintetizada", () => {
  // `id: null` e load-bearing: toda acao da tela de contas monta a URL com o
  // id. Um id inventado (a propria chave canonica, por exemplo) compilaria e
  // produziria `POST /api/scheduled-transactions/fatura:2026-10-01:<uuid>/pay`.
  const { previstas } = sintetizar([linhaDaFatura()]);
  assert.equal(previstas[0].id, null);
  assert.equal(ehFaturaPrevista(previstas[0]), true);
  // E a linha gravada nao e confundida com ela. `fatura_prevista` so vale
  // `true`: um valor qualquer -- a string "false", por exemplo, vinda de um
  // JSON remontado -- nao pode ligar o caminho da fatura sintetizada.
  assert.equal(
    ehFaturaPrevista({ id: "abc", description: "Luz", due_date: "2026-10-09" }),
    false
  );
  assert.equal(ehFaturaPrevista({ fatura_prevista: "false" }), false);
});

test("a chave canonica da linha sintetizada e a MESMA que o close grava", () => {
  // E por ela que a de-duplicacao funciona depois, que o filtro da HMO-209
  // deixa a linha passar (`ehFatura`), e que a baixa sabe que pagar a fatura e
  // transferencia e nao despesa. Uma chave diferente aqui quebra os tres de uma
  // vez, e nenhum deles reclamaria.
  const { previstas } = sintetizar([linhaDaFatura()]);
  assert.equal(previstas[0].notes, chaveFatura("2026-10-01", CARTAO));
});

test("a descricao e a mesma que o close grava", () => {
  // Nao e cosmetico: a pessoa confirma o pagamento olhando a descricao, e o
  // `close` roda DEPOIS do clique. Se as duas discordarem, a linha muda de nome
  // no instante em que ela e paga -- com cara de ter pago outra coisa.
  const { previstas } = sintetizar([linhaDaFatura()]);
  assert.equal(previstas[0].description, "Fatura Nubank 10/2026");
});

test("sem nome de cartao a descricao nao fica quebrada", () => {
  // O nome vem de `financial_accounts` pela view; falta dele e leitura
  // incompleta, nao convite para inventar nome. "Fatura undefined 10/2026" e o
  // tipo de rotulo que faz a pessoa desconfiar do valor ao lado.
  const { previstas } = sintetizar([linhaDaFatura({ account_name: null })]);
  assert.equal(previstas[0].description, "Fatura do cartão 10/2026");
  assert.equal(previstas[0].account_name, null);
});

// ---------------------------------------------------------------------------
// O CONTROLE NEGATIVO DA ISSUE: NUNCA AS DUAS AO MESMO TEMPO
// ---------------------------------------------------------------------------

test("fatura JA FECHADA nao e sintetizada de novo", () => {
  const { previstas, semVencimento } = sintetizar([linhaDaFatura()], {
    chavesPersistidas: [chaveFatura("2026-10-01", CARTAO)],
  });

  // A negacao explicita, e nao `length === 0`: uma regressao que devolvesse
  // lista vazia por outro motivo passaria num teste que so conta linhas.
  assert.equal(
    previstas.some(
      (p) => p.account_id === CARTAO && p.invoice_month === "2026-10-01"
    ),
    false,
    "a fatura de outubro deste cartao NAO pode sair sintetizada: ela ja existe gravada"
  );
  assert.deepEqual(previstas, []);
  // E ela tambem nao vira aviso de "sem vencimento": o `close` exige `due_day`,
  // entao quem fechou tinha o dia configurado. Apagar o dia depois nao
  // transforma uma conta a pagar real num aviso.
  assert.deepEqual(semVencimento, []);
});

test("a de-duplicacao e por mes+cartao, nao por cartao", () => {
  // Suprimir o cartao inteiro ao achar UMA fatura fechada dele apagaria a
  // fatura do mes seguinte -- a que a pessoa de fato vai pagar. Verde em
  // qualquer teste que use um mes so.
  const { previstas } = sintetizar(
    [
      linhaDaFatura({ invoice_month: "2026-10-01", invoice_due_date: "2026-10-10" }),
      linhaDaFatura({
        invoice_month: "2026-11-01",
        invoice_due_date: "2026-11-10",
        invoice_amount: 300,
      }),
    ],
    { chavesPersistidas: [chaveFatura("2026-10-01", CARTAO)] }
  );

  assert.deepEqual(
    previstas.map((p) => p.invoice_month),
    ["2026-11-01"]
  );
  assert.equal(previstas[0].amount, 300);
});

test("a de-duplicacao e por cartao, nao por mes", () => {
  // O erro simetrico: a fatura fechada de um cartao suprimindo a do OUTRO
  // cartao no mesmo mes. Quem tem dois cartoes deixaria de ver um deles.
  const { previstas } = sintetizar(
    [
      linhaDaFatura(),
      linhaDaFatura({
        account_id: OUTRO_CARTAO,
        account_name: "Itaú",
        invoice_due_date: "2026-10-20",
        invoice_amount: 500,
      }),
    ],
    { chavesPersistidas: [chaveFatura("2026-10-01", CARTAO)] }
  );

  assert.deepEqual(
    previstas.map((p) => p.account_id),
    [OUTRO_CARTAO]
  );
});

test("a agenda com a fatura fechada NAO ganha a sintetizada ao lado", () => {
  // O caso de ponta a ponta do controle negativo, na forma em que a tela o
  // veria: a linha gravada esta na agenda e a sintese roda sobre as mesmas
  // compras. So uma linha de fatura pode sair, e o total nao pode dobrar.
  const chave = chaveFatura("2026-10-01", CARTAO);

  const gravadas = [
    { id: "a", description: "Luz", amount: 230, due_date: "2026-10-08", notes: null, status: "pending", effective_status: "pending", direction: "expense" },
    { id: "b", description: "Fatura Nubank 10/2026", amount: 1220.4, due_date: "2026-10-10", notes: chave, status: "pending", effective_status: "pending", direction: "expense", account: { account_type: "credit_card" } },
  ];

  const { previstas } = sintetizar([linhaDaFatura({ invoice_amount: 1220.4 })], {
    chavesPersistidas: [chave],
  });

  const naTela = agendaComFaturasAbertas(
    agendaSemCompraNoCartao(gravadas),
    previstas
  );

  const faturas = naTela.filter((l) => l.notes === chave);
  assert.equal(faturas.length, 1, "a fatura de outubro aparece UMA vez");

  const total = naTela.reduce((s, l) => s + Number(l.amount), 0);
  assert.equal(total, 1450.4, "230 + 1220,40 -- e nao 230 + 1220,40 + 1220,40");
});

// ---------------------------------------------------------------------------
// CARTAO SEM DIA DE VENCIMENTO: NEM DATA INVENTADA, NEM SILENCIO
// ---------------------------------------------------------------------------

test("sem vencimento a fatura NAO entra na agenda e NAO ganha data inventada", () => {
  const { previstas, semVencimento } = sintetizar([
    linhaDaFatura({ invoice_due_date: null, invoice_amount: 1240 }),
  ]);

  // A negacao explicita, que e o que a issue cobra: nenhuma linha, e nenhuma
  // data. Um padrao qualquer ("vence dia 10") produziria uma linha plausivel.
  assert.deepEqual(previstas, []);
  assert.equal(
    previstas.some((p) => p.account_id === CARTAO),
    false
  );

  // E nao desaparece calada: o cartao sai no outro balde, com o valor, para a
  // tela poder dizer "configure o vencimento do cartao".
  assert.equal(semVencimento.length, 1);
  assert.deepEqual(semVencimento[0], {
    account_id: CARTAO,
    account_name: "Nubank",
    invoice_month: "2026-10-01",
    total: 1240,
  });
});

test("invoice_due_date ausente (undefined) vale o mesmo que null", () => {
  // A view devolve NULL; o PostgREST pode entregar o campo ausente. Tratar so
  // `null` deixaria o `undefined` cair no caminho de sucesso, com
  // `due_date: undefined` -- e a linha apareceria na tela com "vence em
  // undefined/undefined".
  const sem = { ...linhaDaFatura() };
  delete sem.invoice_due_date;

  const { previstas, semVencimento } = sintetizar([sem]);
  assert.deepEqual(previstas, []);
  assert.equal(semVencimento.length, 1);
});

test("uma linha sem vencimento nao apaga o vencimento que outra trouxe", () => {
  // Mesma fatura, duas linhas, e so uma com a data. Manter a ultima vista faria
  // a fatura inteira virar aviso de "configure o vencimento" num cartao que tem
  // o dia configurado.
  const { previstas, semVencimento } = sintetizar([
    linhaDaFatura({ invoice_amount: 100 }),
    linhaDaFatura({ invoice_due_date: null, invoice_amount: 50 }),
  ]);

  assert.deepEqual(semVencimento, []);
  assert.equal(previstas.length, 1);
  assert.equal(previstas[0].due_date, "2026-10-10");
  assert.equal(previstas[0].amount, 150);
});

// ---------------------------------------------------------------------------
// O QUE NAO E CONTA A PAGAR
// ---------------------------------------------------------------------------

test("fatura zerada nao vira conta a pagar", () => {
  // Compra e estorno do mesmo valor. Uma previsao de R$ 0,00 seria ruido mensal
  // em todo cartao que a pessoa nao usou -- e o `CHECK (amount > 0)` do 005
  // recusaria a linha no dia em que ela fosse materializada.
  const { previstas, semVencimento } = sintetizar([
    linhaDaFatura({ invoice_amount: 100 }),
    linhaDaFatura({ invoice_amount: -100 }),
  ]);
  assert.deepEqual(previstas, []);
  assert.deepEqual(semVencimento, []);
});

test("fatura negativa (saldo a favor) nao vira conta a pagar", () => {
  // Estorno maior que as compras: o cartao deve dinheiro ao usuario. Nao existe
  // conta a pagar de valor negativo, e `Math.abs` em algum somador a jusante a
  // transformaria numa divida.
  const { previstas } = sintetizar([linhaDaFatura({ invoice_amount: -40 })]);
  assert.deepEqual(previstas, []);
});

test("o resto de ponto flutuante nao vira fatura de R$ 0,00", () => {
  // 0,1 + 0,2 - 0,3 = 5.55e-17 em float. Sem o arredondamento para centavos
  // antes do `<= 0`, isso passa a peneira e vira uma linha de R$ 0,00 na agenda
  // -- com um botao de pagar.
  const { previstas } = sintetizar([
    linhaDaFatura({ invoice_amount: 0.1 }),
    linhaDaFatura({ invoice_amount: 0.2 }),
    linhaDaFatura({ invoice_amount: -0.3 }),
  ]);
  assert.deepEqual(previstas, []);
});

test("o total e arredondado em centavos", () => {
  const { previstas } = sintetizar([
    linhaDaFatura({ invoice_amount: 0.1 }),
    linhaDaFatura({ invoice_amount: 0.2 }),
  ]);
  assert.equal(previstas[0].amount, 0.3);
});

test("numeric como string soma igual", () => {
  // O PostgREST entrega `numeric` como string em alguns caminhos. Com
  // concatenacao em vez de soma, "100" + "50" daria 10050 -- uma fatura cem
  // vezes maior, plausivel o suficiente para ninguem duvidar do app.
  const { previstas } = sintetizar([
    linhaDaFatura({ invoice_amount: "100.50" }),
    linhaDaFatura({ invoice_amount: "50" }),
  ]);
  assert.equal(previstas[0].amount, 150.5);
});

// ---------------------------------------------------------------------------
// A JANELA, E A FATURA VENCIDA
// ---------------------------------------------------------------------------

test("fatura que vence fora da janela nao entra", () => {
  // `de`/`ate` sao os mesmos limites da consulta da agenda. Sem esta peneira a
  // fatura apareceria num mes que a tela nao esta mostrando, e o cabecalho
  // (calculado sobre a janela) discordaria das linhas.
  const antes = sintetizar([
    linhaDaFatura({ invoice_month: "2026-09-01", invoice_due_date: "2026-09-10" }),
  ]);
  assert.deepEqual(antes.previstas, []);

  const depois = sintetizar([
    linhaDaFatura({ invoice_month: "2027-01-01", invoice_due_date: "2027-01-10" }),
  ]);
  assert.deepEqual(depois.previstas, []);
});

test("a fatura vencida sai como vencida, com os dias negativos", () => {
  // Sem isto ela cairia em "Próximos 7 dias" com "em -3 dia(s)" no badge, e a
  // secao "Vencidas" diria "Nada em atraso." com a fatura atrasada na tela.
  const { previstas } = sintetizar([
    linhaDaFatura({ invoice_due_date: "2026-10-02" }),
  ]);
  assert.equal(previstas[0].effective_status, "overdue");
  assert.equal(previstas[0].days_until_due, -3);
});

test("a fatura que vence hoje nao esta vencida", () => {
  const { previstas } = sintetizar([
    linhaDaFatura({ invoice_due_date: "2026-10-05" }),
  ]);
  assert.equal(previstas[0].effective_status, "pending");
  assert.equal(previstas[0].days_until_due, 0);
});

test("as faturas saem ordenadas por vencimento", () => {
  const { previstas } = sintetizar([
    linhaDaFatura({ invoice_due_date: "2026-11-20", invoice_month: "2026-11-01" }),
    linhaDaFatura({
      account_id: OUTRO_CARTAO,
      account_name: "Itaú",
      invoice_due_date: "2026-10-03",
    }),
  ]);
  assert.deepEqual(
    previstas.map((p) => p.due_date),
    ["2026-10-03", "2026-11-20"]
  );
});

test("sem linha nenhuma nao sai fatura nenhuma", () => {
  // Controle: a sintese nao pode fabricar linha a partir do vazio.
  const { previstas, semVencimento } = sintetizar([]);
  assert.deepEqual(previstas, []);
  assert.deepEqual(semVencimento, []);
});

// ---------------------------------------------------------------------------
// A MERGE: AS LINHAS GRAVADAS E AS SINTETIZADAS, EM ORDEM
// ---------------------------------------------------------------------------

test("a agenda fica ordenada por vencimento depois da sintese", () => {
  // A tela separa em "Vencidas", "Próximos 7 dias" e "Mais adiante" por
  // `days_until_due`, mas dentro de cada secao a ordem e a da lista. Concatenar
  // sem reordenar poria a fatura de dezembro no meio das contas de outubro.
  const gravadas = [
    { id: "a", description: "Luz", amount: 230, due_date: "2026-10-08", notes: null },
    { id: "b", description: "Aluguel", amount: 2000, due_date: "2026-11-05", notes: null },
  ];
  const { previstas } = sintetizar([linhaDaFatura()]);

  assert.deepEqual(
    agendaComFaturasAbertas(gravadas, previstas).map((l) => l.due_date),
    ["2026-10-08", "2026-10-10", "2026-11-05"]
  );
});

// ---------------------------------------------------------------------------
// O CABECALHO BATE COM AS LINHAS (a prova que a issue cobra)
// ---------------------------------------------------------------------------

test("o total do cabecalho bate com a soma das linhas depois da sintese", () => {
  // As duas rotas da MESMA pagina: `/api/scheduled-transactions` devolve estas
  // linhas e `/api/scheduled-transactions/summary` soma o cabecalho. Esta
  // assercao roda as duas pontas sobre a MESMA leitura -- a mesma lista
  // `agendaComFaturasAbertas(agendaSemCompraNoCartao(brutas), previstas)` -- e
  // cobra que o numero de cima seja o de baixo.
  //
  // O somador e `somarEmAberto`, o de verdade: refazer a conta a mao aqui
  // provaria a aritmetica do teste, nao a da tela.
  const brutas = [
    { id: "a", description: "Luz", amount: 230, due_date: "2026-10-08", notes: null, status: "pending", effective_status: "pending", direction: "expense" },
    // Uma compra solta no cartao: a HMO-209 a tira da agenda. Ela esta aqui para
    // que a soma NAO a inclua -- ela ja esta dentro do total da fatura.
    { id: "c", description: "Mercado", amount: 180, due_date: "2026-10-09", notes: null, status: "pending", effective_status: "pending", direction: "expense", account: { account_type: "credit_card" } },
    // Uma receita prevista: ela nao pode entrar em "a pagar".
    { id: "s", description: "Salário", amount: 7000, due_date: "2026-10-05", notes: null, status: "pending", effective_status: "pending", direction: "income" },
    // Uma fatura VENCIDA, gravada: ela entra no outro balde do cabecalho.
    { id: "v", description: "Fatura Itaú 09/2026", amount: 400, due_date: "2026-10-01", notes: chaveFatura("2026-09-01", OUTRO_CARTAO), status: "pending", effective_status: "overdue", direction: "expense", account: { account_type: "credit_card" } },
  ];

  const { previstas } = sintetizar([linhaDaFatura({ invoice_amount: 1220.4 })]);

  const naTela = agendaComFaturasAbertas(
    agendaSemCompraNoCartao(brutas),
    previstas
  );

  // O cabecalho, pelo caminho do /summary.
  const cabecalho = somarEmAberto(
    naTela.map((l) => ({
      amount: l.amount,
      status: String(l.status),
      effective_status: l.effective_status,
      direcao: direcaoDaAgenda(l.direction),
    }))
  );

  // As linhas, pelo caminho da tela de contas (ela soma as tres secoes).
  const somaDasLinhas = naTela
    .filter((l) => direcaoDaAgenda(l.direction) === "expense")
    .reduce((s, l) => s + Math.abs(Number(l.amount)), 0);

  assert.equal(
    cabecalho.aPagar.total + cabecalho.vencidoAPagar.total,
    Number(somaDasLinhas.toFixed(2)),
    "o cabecalho tem de somar exatamente as linhas que a tela mostra"
  );

  // E o numero, escrito: 230 (luz) + 400 (fatura vencida) + 1220,40 (a fatura
  // aberta sintetizada). A compra de mercado (180) NAO entra -- ela esta dentro
  // da fatura --, e o salario de 7.000 esta no outro lado.
  assert.equal(cabecalho.aPagar.total, 1450.4);
  assert.equal(cabecalho.vencidoAPagar.total, 400);
  assert.equal(cabecalho.aReceber.total, 7000);

  // A negacao explicita: a compra de cartao nao sobreviveu a merge.
  assert.equal(
    naTela.some((l) => l.description === "Mercado"),
    false
  );
});

// ---------------------------------------------------------------------------
// AS DUAS ROTAS LEEM A MESMA COISA
// ---------------------------------------------------------------------------

test("a lista E o resumo sintetizam a fatura, pela mesma leitura", () => {
  // Este caso le o CODIGO das duas rotas, e nao o comportamento: o defeito que
  // ele existe para pegar e de OMISSAO. Sintetizar na lista e esquecer o resumo
  // deixa o "a vencer" do cabecalho MENOR que a soma das linhas logo abaixo
  // dele, na mesma tela -- e o numero menor e o que parece certo. Nenhum teste
  // de funcao pura ve isso: as duas rotas precisam de banco e de sessao.
  const rotas = [
    "app/api/scheduled-transactions/route.ts",
    "app/api/scheduled-transactions/summary/route.ts",
  ];

  for (const rota of rotas) {
    const fonte = readFileSync(join(RAIZ, rota), "utf8");

    assert.match(
      fonte,
      /import \{ faturasPrevistasDaJanela \} from "@\/lib\/services\/fatura-prevista"/,
      `${rota} nao importa a leitura compartilhada da HMO-227`
    );
    // A chamada, e nao so o import: import nao usado compila, e o lint deste
    // projeto so emite aviso.
    assert.match(
      fonte,
      /faturasPrevistasDaJanela\(/,
      `${rota} importa a leitura e nao a chama`
    );
    assert.match(
      fonte,
      /agendaComFaturasAbertas\(/,
      `${rota} le a fatura prevista e nao a junta a agenda`
    );
  }
});

test("a leitura compartilhada filtra por user_id", () => {
  // `card_invoice_lines` sai de `financial_transactions`, cuja policy (002) tem
  // um OR para membro de grupo: sem o filtro a view devolve tambem a compra de
  // grupo lancada no cartao de OUTRA pessoa, e o agrupamento por cartao somaria
  // aquilo na minha fatura prevista. A RLS nao substitui o filtro aqui.
  const fonte = readFileSync(
    join(RAIZ, "lib/services/fatura-prevista.ts"),
    "utf8"
  );
  assert.match(fonte, /\.from\("card_invoice_lines"\)/);
  assert.match(fonte, /\.eq\("user_id", userId\)/);

  // AS DUAS consultas, e nao uma. A de de-duplicacao le
  // `scheduled_transactions`, cuja policy do 005 tambem libera a linha de GRUPO
  // dos outros membros: sem o filtro, a fatura fechada por outra pessoa num
  // cartao dela suprimiria a MINHA fatura prevista -- a linha desapareceria da
  // minha agenda por causa de um registro que nao e meu.
  assert.equal(
    (fonte.match(/\.eq\("user_id", userId\)/g) ?? []).length,
    2,
    "as duas consultas da leitura compartilhada precisam do filtro de user_id"
  );
});

test("a de-duplicacao sai de uma consulta propria, nao da agenda ja lida", () => {
  // A lista da tela consulta com `status=open`, entao uma fatura ja PAGA nao
  // esta naquele resultado. De-duplicar contra ele sintetizaria a fatura de
  // novo, e quem acabou de pagar o cartao a veria reaparecer em Contas a Pagar
  // cobrando o mesmo valor.
  const fonte = readFileSync(
    join(RAIZ, "lib/services/fatura-prevista.ts"),
    "utf8"
  );
  assert.match(fonte, /\.from\("scheduled_transactions"\)/);
  assert.match(fonte, /\.in\("notes", chaves\)/);
  // E sem filtro de status: incluir `status=pending` aqui traria de volta o
  // mesmo furo por outra porta.
  assert.doesNotMatch(
    fonte,
    /\.in\("notes", chaves\)[\s\S]{0,120}\.eq\("status"/,
    "a consulta de de-duplicacao nao pode filtrar status: a fatura PAGA tambem conta"
  );
});
