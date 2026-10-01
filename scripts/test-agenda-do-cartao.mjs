#!/usr/bin/env node
// =====================================================
// PULODOGATO - o que de um cartao aparece em Contas a Pagar (HMO-209)
// =====================================================
// A queixa: a compra individual no cartao aparecia na agenda AO LADO da fatura
// cheia daquele mesmo cartao. A mesma despesa duas vezes na mesma tela, e o
// cabecalho da pagina somando as duas.
//
// Esta suite cobra as quatro maneiras de "consertar" isso errado. Nenhuma delas
// da erro em lugar nenhum -- todas produzem uma tela plausivel:
//
//   1. filtrar pelo TIPO DA CONTA e mais nada: a propria fatura e uma
//      `scheduled_transaction` com o `account_id` do cartao, entao ela
//      desapareceria junto. A pessoa deixaria de ver a unica conta de cartao que
//      ela de fato paga -- e o app pararia de cobra-la de um valor que vence.
//   2. reconhecer a fatura por TEXTO LIVRE em `notes`: uma anotacao escrita a
//      mao ("paguei a fatura no debito") passaria por chave canonica e a
//      descricao do usuario viraria regra de negocio.
//   3. esconder a linha quando a conta nao e legivel (embed `null` por RLS, ou
//      previsao sem conta): conta a pagar comum sumiria da agenda em silencio, e
//      a pessoa so descobriria no dia do vencimento.
//   4. filtrar so na LISTA e nao no RESUMO: as linhas e o total discordariam
//      lado a lado, na mesma tela -- e o total e o numero errado, porque e o que
//      parece certo. O ultimo caso desta suite le as duas rotas e cobra que as
//      duas chamem o mesmo filtro.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  TIPO_CARTAO,
  previsaoApareceNaAgenda,
  agendaSemCompraNoCartao,
} from "../.tmp-agenda-do-cartao/agenda-do-cartao.js";
import { chaveFatura } from "../.tmp-agenda-do-cartao/card-invoice.js";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

const CARTAO = "11111111-1111-4111-8111-111111111111";
const CONTA = { account_type: "checking" };

/** A fatura fechada de setembro naquele cartao, como o close a grava. */
function fatura(extra = {}) {
  return {
    description: "Fatura Visa · setembro",
    amount: 1200,
    notes: chaveFatura("2026-09-01", CARTAO),
    account: { account_type: TIPO_CARTAO },
    ...extra,
  };
}

/** A compra solta no cartao: o que a tela de lancamento gravava desmarcada. */
function compraNoCartao(extra = {}) {
  return {
    description: "Mercado",
    amount: 180,
    notes: null,
    account: { account_type: TIPO_CARTAO },
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// A FATURA FICA, A COMPRA SAI
// ---------------------------------------------------------------------------

test("a fatura do cartao continua na agenda", () => {
  // E a unica linha de cartao que a pessoa paga de fato, e e o motivo pelo qual
  // o filtro nao pode ser "a conta e cartao, logo fora".
  assert.equal(previsaoApareceNaAgenda(fatura()), true);
});

test("a compra individual no cartao sai da agenda", () => {
  // Ela ja esta contada duas vezes: no saldo negativo do cartao (a divida) e
  // dentro do total da fatura.
  assert.equal(previsaoApareceNaAgenda(compraNoCartao()), false);
});

test("a chave da fatura e ancorada: nota escrita a mao nao vira fatura", () => {
  // Sem a ancoragem nas duas pontas, a descricao livre do usuario passaria a
  // decidir o que a agenda mostra -- e a compra voltaria para a tela por causa
  // de um comentario.
  const comTextoEmVolta = compraNoCartao({
    notes: `${chaveFatura("2026-09-01", CARTAO)} paguei no debito`,
  });
  assert.equal(previsaoApareceNaAgenda(comTextoEmVolta), false);

  assert.equal(
    previsaoApareceNaAgenda(compraNoCartao({ notes: "fatura do cartao" })),
    false
  );
});

// ---------------------------------------------------------------------------
// O QUE NAO E CARTAO NAO E AFETADO
// ---------------------------------------------------------------------------

test("conta a pagar comum nao e tocada pelo filtro", () => {
  assert.equal(
    previsaoApareceNaAgenda({ notes: null, account: CONTA }),
    true
  );
  assert.equal(
    previsaoApareceNaAgenda({ notes: "aluguel de outubro", account: CONTA }),
    true
  );
});

test("sem conta, ou sem conseguir LER a conta, a linha aparece", () => {
  // Tres formas da mesma ausencia, e a que mais importa e a do meio: o embed do
  // PostgREST vem `null` quando a RLS nao libera a conta, e `null` ali significa
  // "nao sei", nao "e cartao". Esconder no "nao sei" faria uma conta legitima
  // desaparecer da agenda sem erro nenhum na tela.
  assert.equal(previsaoApareceNaAgenda({ notes: null }), true);
  assert.equal(previsaoApareceNaAgenda({ notes: null, account: null }), true);
  assert.equal(previsaoApareceNaAgenda({ notes: null, account: {} }), true);
});

test("o tipo do cartao e exatamente credit_card", () => {
  // Um typo aqui nao daria erro: nenhuma linha casaria, o filtro passaria a nao
  // filtrar nada, e a tela voltaria ao defeito desta issue em silencio.
  assert.equal(TIPO_CARTAO, "credit_card");
  assert.equal(
    previsaoApareceNaAgenda(compraNoCartao({ account: { account_type: "credit-card" } })),
    true
  );
});

// ---------------------------------------------------------------------------
// A PROVA DA ISSUE: UMA PREVISAO DE CARTAO E UMA FATURA, SO A FATURA VOLTA
// ---------------------------------------------------------------------------

test("com uma compra e a fatura no mesmo cartao, a agenda devolve so a fatura", () => {
  const agenda = [
    { description: "Luz", amount: 230, notes: null, account: CONTA },
    compraNoCartao(),
    fatura(),
    compraNoCartao({ description: "Streaming", amount: 39.9 }),
  ];

  const visiveis = agendaSemCompraNoCartao(agenda);

  assert.deepEqual(
    visiveis.map((l) => l.description),
    ["Luz", "Fatura Visa · setembro"]
  );

  // E O TOTAL CONCORDA COM AS LINHAS. Este e o par que a issue cobra: o
  // cabecalho da pagina soma o resultado do MESMO filtro, entao o numero nao
  // pode conter o que a lista nao mostra. Antes do conserto este total era
  // 230 + 180 + 1200 + 39,90 = 1649,90 -- a fatura mais as compras que ela ja
  // contem.
  const total = visiveis.reduce((s, l) => s + l.amount, 0);
  assert.equal(total, 1430);

  // A negacao explicita: nenhuma linha de cartao que nao seja fatura sobrou.
  for (const linha of visiveis) {
    if (linha.account?.account_type === TIPO_CARTAO) {
      assert.notEqual(linha.notes, null);
    }
  }
});

test("agenda sem nenhuma linha de cartao passa inteira", () => {
  // Controle: o filtro nao pode comer linha por outro motivo. Uma regressao que
  // devolvesse lista vazia tambem faria o caso acima passar se ele so olhasse
  // "a compra nao esta aqui".
  const agenda = [
    { description: "Luz", amount: 230, notes: null, account: CONTA },
    { description: "Agua", amount: 80, notes: null, account: null },
  ];
  assert.deepEqual(agendaSemCompraNoCartao(agenda), agenda);
});

// ---------------------------------------------------------------------------
// AS DUAS ROTAS, O MESMO FILTRO
// ---------------------------------------------------------------------------

test("a lista E o resumo chamam o filtro", () => {
  // Este caso le o CODIGO das duas rotas, e nao o comportamento delas, porque o
  // defeito que ele existe para pegar e de omissao: filtrar a lista e esquecer o
  // resumo deixa o cabecalho ("a vencer", "custo fixo") somando as compras que a
  // lista logo abaixo nao mostra mais. Nenhum teste de funcao pura ve isso --
  // as duas rotas precisam de banco e de sessao --, e o sintoma na tela e um
  // total que discorda das linhas ao lado dele.
  const rotas = [
    "app/api/scheduled-transactions/route.ts",
    "app/api/scheduled-transactions/summary/route.ts",
  ];

  for (const rota of rotas) {
    const fonte = readFileSync(join(RAIZ, rota), "utf8");
    assert.match(
      fonte,
      /import \{ agendaSemCompraNoCartao \} from "@\/lib\/agenda-do-cartao"/,
      `${rota} nao importa o filtro da HMO-209`
    );
    // A chamada, e nao so o import: um import nao usado compila (e o lint deste
    // projeto so emite aviso) e deixaria a rota sem filtro nenhum.
    assert.match(
      fonte,
      /agendaSemCompraNoCartao\(/,
      `${rota} importa o filtro e nao o chama`
    );
  }
});

test("o resumo pede as duas colunas de que o filtro precisa", () => {
  // `notes` e o embed da conta nao sao exibidos por este resumo -- entram so
  // para o filtro. Um `select` que os perca nao quebra nada: o embed vem
  // `undefined`, toda linha passa pelo "nao sei, logo aparece", e o resumo volta
  // a somar as compras de cartao. Verde, com o numero antigo.
  const fonte = readFileSync(
    join(RAIZ, "app/api/scheduled-transactions/summary/route.ts"),
    "utf8"
  );
  assert.match(fonte, /notes/);
  assert.match(fonte, /account:financial_accounts\(account_type\)/);
});

// ---------------------------------------------------------------------------
// O EMBED PODE CHEGAR COMO ARRAY
// ---------------------------------------------------------------------------

test("a regra vale igual com o embed em forma de array", () => {
  // A fonte das duas rotas e uma VIEW, e sobre view o supabase-js nao consegue
  // provar que `account_id -> financial_accounts.id` e muitos-para-um: ele TIPA
  // o embed como array (foi o `tsc` deste PR que mostrou). Se em algum caminho a
  // resposta vier nessa forma, ler `linha.account.account_type` direto daria
  // `undefined` em TODA linha -- nenhuma casaria com `credit_card`, o filtro
  // pararia de filtrar e a tela voltaria ao defeito da issue. Sem erro nenhum.
  const comoArray = (linha) => ({ ...linha, account: [linha.account] });

  assert.equal(previsaoApareceNaAgenda(comoArray(fatura())), true);
  assert.equal(previsaoApareceNaAgenda(comoArray(compraNoCartao())), false);
  // Array vazio e a mesma ausencia de `null`: "nao sei", logo aparece.
  assert.equal(
    previsaoApareceNaAgenda({ notes: null, account: [] }),
    true
  );
});
