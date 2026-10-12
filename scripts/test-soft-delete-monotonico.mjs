#!/usr/bin/env node
// =====================================================
// PULODOGATO - o soft delete da ocorrencia nao anda para tras (HMO-403)
// =====================================================
//   npm run test:soft-delete-monotonico
//
// O QUE FOI MEDIDO EM PRODUCAO
// ----------------------------
// `DELETE /api/scheduled-transactions/{id}` com `{alcance:"apenas_esta"}` numa
// ocorrencia JA `cancelled` respondia 200 e a REESCREVIA para `skipped`. Medido
// na validacao larga da HMO-400, em 6 linhas de uma serie (1 `skipped` + 5
// `cancelled`): as seis terminaram `skipped`. Um comando chamado "apagar"
// piorou o estado de cinco delas.
//
// A causa nao foi filtro esquecido: a rota escrevia um estado FIXO em vez de
// respeitar um estado final ja alcancado. O soft delete nao era idempotente nem
// monotonico.
//
// POR QUE A SUITE RELE O `status`, E NAO O CODIGO DE RESPOSTA
// ----------------------------------------------------------
// Esta e a instrucao mais importante da issue, e ela vem de a medicao ter sido
// feita errado primeiro:
//
//   - o codigo de resposta NAO mede nada. Deu 200 nas seis vezes, enquanto
//     estragava cinco linhas;
//   - a rota de LISTA tambem nao: ela filtra `skipped` E `cancelled`, entao a
//     tela diz "sumiu" nos dois casos, antes e depois do conserto.
//
// O unico oraculo que distingue os dois estados e o `status` na tabela. O duble
// aplica o patch de verdade nas linhas semeadas (ver `update` em
// scripts/duble-de-supabase.mjs), entao `linhaDe(fixture, ID)` abaixo le o que
// o banco teria guardado.
//
// E POR ISSO O CONTROLE POSITIVO NAO E OPCIONAL
// ---------------------------------------------
// Toda assercao principal daqui e de AUSENCIA ("a linha `cancelled` continua
// `cancelled`"), e assercao de ausencia passa verde tambem quando a sonda nao
// chamou nada -- um `params` errado, um fixture que a rota nao encontra, um 404.
// `apenas_esta` sobre uma linha PENDING tem de gravar `skipped`: e o unico caso
// que prova que este aparelho escreve quando deve.
//
// POR QUE A ROTA, E NAO SO A REGRA PURA
// -------------------------------------
// `npm run test:alcance-da-serie` prova o PLANO -- quais ids entram. O defeito
// vivia DEPOIS dele: o UPDATE da rota nao tinha filtro de status, entao plano
// certo e escrita errada conviviam sem nada reclamar. O que esta suite mede e o
// estado que sobra no banco.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import { criarDuble } from "./duble-de-supabase.mjs";

const ROTA = await import(
  "../.tmp-soft-delete-monotonico/app/api/scheduled-transactions/[id]/route.js"
);

const DONO = "dono-1";
const REGRA = "regra-fixa-1";

// AS DATAS SAO TODAS NO FUTURO DISTANTE, de proposito: `encerrarRegra` tem um
// `.gte("due_date", today())` no caminho das `pending`, e um fixture com data
// fixa no passado faria o caso do alcance `todas` medir zero linha por causa do
// calendario -- verde (ou vermelho) pelo motivo errado, e mudando de resposta
// sozinho com o passar dos meses. Ver `relogio-congelado-em-teste-node`.
const D = (dia) => `2099-0${dia}-17`;

/**
 * A serie como ela estava em PRODUCAO quando o defeito foi medido: uma linha
 * `skipped` e cinco `cancelled`. E o fixture que importa, porque e o estado em
 * que o pedido "apagar" PIORAVA cinco linhas.
 *
 * A linha `paid` nao estava na medicao e entra aqui como controle: ela e a que
 * nenhum destes caminhos pode encostar, e sem ela um UPDATE que perdesse o
 * filtro de status passaria sem ninguem ver.
 */
function serieComoEstavaEmProducao() {
  return [
    { id: "p1", user_id: DONO, recurring_rule_id: REGRA, due_date: D(1), status: "skipped", description: "SONDA FIXA r2" },
    { id: "p2", user_id: DONO, recurring_rule_id: REGRA, due_date: D(2), status: "cancelled", description: "SONDA FIXA r2" },
    { id: "p3", user_id: DONO, recurring_rule_id: REGRA, due_date: D(3), status: "cancelled", description: "SONDA FIXA r2" },
    { id: "p4", user_id: DONO, recurring_rule_id: REGRA, due_date: D(4), status: "cancelled", description: "SONDA FIXA r2" },
    { id: "p5", user_id: DONO, recurring_rule_id: REGRA, due_date: D(5), status: "cancelled", description: "SONDA FIXA r2" },
    { id: "p6", user_id: DONO, recurring_rule_id: REGRA, due_date: D(6), status: "cancelled", description: "SONDA FIXA r2" },
    { id: "pago", user_id: DONO, recurring_rule_id: REGRA, due_date: D(7), status: "paid", description: "SONDA FIXA r2" },
  ];
}

/** O OUTRO DONO. Ver `VIZINHA_DE_OUTRO_DONO`. */
const ESTRANHO = "dono-2";

/**
 * Uma serie em ABERTO, para o controle positivo e para a mistura de estados.
 *
 * As TRES linhas que nao sao `pending` dao medida a cada recorte da escrita, e
 * cada uma mediria zero se nao estivesse aqui:
 *
 *   `ja-pulada`  o estado intermediario que `todas` tem de levar ao final;
 *   `pago`       o que nenhum destes caminhos pode encostar;
 *   `vencida`    `pending` com vencimento no PASSADO. Ela e a unica coisa que
 *                mede o `.gte("due_date", today())` de `encerrarRegra`: num
 *                fixture inteiramente futuro, apagar essa barreira nao muda
 *                nenhum numero, e o mutante que a apaga sobrevive. Conta
 *                vencida e nao paga e divida de verdade -- cancela-la apagaria
 *                da tela um atraso que existe.
 */
function serieEmAberto() {
  return [
    { id: "a1", user_id: DONO, recurring_rule_id: REGRA, due_date: D(1), status: "pending", description: "Aluguel" },
    { id: "a2", user_id: DONO, recurring_rule_id: REGRA, due_date: D(2), status: "pending", description: "Aluguel" },
    { id: "a3", user_id: DONO, recurring_rule_id: REGRA, due_date: D(3), status: "pending", description: "Aluguel" },
    { id: "ja-pulada", user_id: DONO, recurring_rule_id: REGRA, due_date: D(4), status: "skipped", description: "Aluguel" },
    { id: "pago", user_id: DONO, recurring_rule_id: REGRA, due_date: D(5), status: "paid", description: "Aluguel" },
    { id: "vencida", user_id: DONO, recurring_rule_id: REGRA, due_date: "2020-03-10", status: "pending", description: "Aluguel" },
    VIZINHA_DE_OUTRO_DONO(),
  ];
}

/**
 * Uma linha da MESMA regra pertencente a OUTRO dono.
 *
 * E artificial -- na pratica a regra tem um dono so --, e e por isso que ela
 * esta aqui: o que ela mede e o `.eq("user_id", ...)` de cada escrita, e com um
 * dono so no fixture "as minhas linhas" e "todas as linhas" sao o mesmo
 * conjunto, entao nenhuma assercao as distingue e o mutante que apaga o filtro
 * sobrevive. A RLS barraria esta linha em producao; depender dela para o que a
 * funcao promete e depender de uma segunda trava (ver `segunda-trava-esconde-
 * policy-sem-teste`).
 */
function VIZINHA_DE_OUTRO_DONO() {
  return {
    id: "de-outro-dono",
    user_id: ESTRANHO,
    recurring_rule_id: REGRA,
    due_date: D(8),
    status: "skipped",
    description: "Aluguel do outro",
  };
}

/**
 * Chama o DELETE e devolve `{ status, corpo, agenda, regras, escritas }`.
 *
 * `agenda` e `regras` sao os ARRAYS SEMEADOS, nao copias: e neles que o duble
 * aplica o patch, e e relendo-os que a assercao ve o que o banco guardaria.
 *
 * `noMeioDoPedido` (opcional) roda UMA vez, depois de a rota ter lido a
 * ocorrencia e antes de ela escrever. Ver o caso da corrida.
 */
async function apagar({ id, alcance, agenda, regras, noMeioDoPedido }) {
  const scheduled_transactions = agenda ?? serieComoEstavaEmProducao();
  const recurring_rules =
    regras ?? [{ id: REGRA, user_id: DONO, is_active: true, end_date: null }];

  const sessao = criarDuble({
    user: { id: DONO },
    tabelas: { scheduled_transactions, recurring_rules },
  });

  // O CLIENT EMBRULHADO, PARA PODER ENCAIXAR ALGO ENTRE A LEITURA E A ESCRITA.
  //
  // A rota le `atual` e decide, e so depois grava. A janela entre as duas e o
  // que o filtro de status da escrita existe para fechar, e sem um gancho aqui
  // ela nao tem como ser encenada: o duble e sincrono e nao ha concorrencia de
  // verdade para esperar. O embrulho conta os `from("scheduled_transactions")`
  // e dispara no segundo, que e o do UPDATE.
  let vezes = 0;
  const client = noMeioDoPedido
    ? {
        ...sessao.client,
        from(tabela) {
          if (tabela === "scheduled_transactions") {
            vezes += 1;
            if (vezes === 2) noMeioDoPedido();
          }
          return sessao.client.from(tabela);
        },
      }
    : sessao.client;

  globalThis.__dubleDeSupabase = { sessao: () => client };

  let resposta;
  try {
    resposta = await ROTA.DELETE(
      { json: async () => ({ alcance }) },
      { params: { id } }
    );
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  return {
    status: resposta.status,
    corpo: await resposta.json(),
    agenda: scheduled_transactions,
    regras: recurring_rules,
    escritas: sessao.escritas,
  };
}

const linhaDe = (linhas, id) => linhas.find((l) => l.id === id);
const statusDe = (linhas, id) => linhaDe(linhas, id)?.status;

// ---------------------------------------------------------------------------
// 1. O CONTROLE POSITIVO: o aparelho escreve quando deve
// ---------------------------------------------------------------------------

test("CONTROLE POSITIVO: 'apenas_esta' numa PENDING grava skipped", async () => {
  // Sem este caso, todos os de baixo passariam verdes tambem com a sonda
  // chamando o handler errado, com `params` que nao acha linha nenhuma, ou com
  // o duble descartando a escrita -- "a linha nao mudou" e exatamente o que se
  // ve nos dois mundos.
  const r = await apagar({ id: "a1", alcance: "apenas_esta", agenda: serieEmAberto() });

  assert.equal(r.status, 200, "sucesso");
  assert.equal(statusDe(r.agenda, "a1"), "skipped", "a ocorrencia pendente TEM de virar skipped");
  assert.equal(r.corpo.ocorrencias_puladas, 1);
  assert.equal(r.corpo.ancora_ja_fora_da_agenda, false);
  assert.equal(r.corpo.scheduled?.id, "a1", "a resposta devolve a linha pedida");
});

// ---------------------------------------------------------------------------
// 2. O DEFEITO MEDIDO: cancelled nao vira skipped
// ---------------------------------------------------------------------------

test("O DEFEITO DA ISSUE: 'apenas_esta' numa CANCELLED nao a rebaixa", async () => {
  const r = await apagar({ id: "p2", alcance: "apenas_esta" });

  // A ASSERCAO QUE A ISSUE COBRA, e ela e sobre a TABELA. Antes do conserto
  // esta linha terminava `skipped` -- com 200 na resposta, que foi o que fez a
  // primeira medicao em producao concluir que nada havia acontecido.
  assert.equal(
    statusDe(r.agenda, "p2"),
    "cancelled",
    "a ocorrencia encerrada foi REBAIXADA para skipped"
  );

  // E o pedido continua sendo sucesso: pedir de novo o que ja esta feito nao e
  // erro. Antes do conserto a lista vazia caia no 500 "nao foi possivel pular".
  assert.equal(r.status, 200, "ja estar fora da agenda e sucesso, nao 500");
  assert.equal(r.corpo.ancora_ja_fora_da_agenda, true);
  assert.equal(r.corpo.ocorrencias_puladas, 0);
  assert.equal(r.corpo.scheduled, null, "nao ha linha nova para devolver");
  assert.match(r.corpo.message, /já estava fora da agenda/);
});

test("NENHUMA ESCRITA sai da rota quando a ancora ja esta cancelled", async () => {
  // A assercao de cima prova o VALOR; esta prova que nao houve UPDATE nenhum.
  // As duas sao necessarias: um UPDATE que gravasse `cancelled` em cima de
  // `cancelled` deixaria o valor certo e ainda assim seria uma escrita a toa,
  // que carimba `updated_at` e inventa linha no log de auditoria.
  const r = await apagar({ id: "p2", alcance: "apenas_esta" });

  const naAgenda = r.escritas.filter((e) => e.tabela === "scheduled_transactions");
  assert.deepEqual(naAgenda, [], `a rota escreveu: ${JSON.stringify(naAgenda)}`);
});

test("as SEIS linhas da medicao de producao sobrevivem ao pedido que as estragava", async () => {
  // O caso como ele aconteceu: seis pedidos de "apagar", um por linha. Antes do
  // conserto as seis terminavam `skipped`. A assercao e sobre o conjunto, e nao
  // sobre uma linha, porque foi o conjunto que foi medido.
  const agenda = serieComoEstavaEmProducao();

  for (const id of ["p1", "p2", "p3", "p4", "p5", "p6"]) {
    await apagar({ id, alcance: "apenas_esta", agenda });
  }

  assert.deepEqual(
    agenda.filter((l) => l.id !== "pago").map((l) => `${l.id}:${l.status}`),
    [
      "p1:skipped",
      "p2:cancelled",
      "p3:cancelled",
      "p4:cancelled",
      "p5:cancelled",
      "p6:cancelled",
    ],
    "o estado de alguma linha mudou -- era 1 skipped + 5 cancelled e tem de continuar"
  );
  assert.equal(statusDe(agenda, "pago"), "paid", "a paga nao se mexe");
});

// ---------------------------------------------------------------------------
// 3. IDEMPOTENCIA: apagar duas vezes e igual a apagar uma
// ---------------------------------------------------------------------------

test("apagar a MESMA ocorrencia duas vezes nao infla a contagem", async () => {
  const agenda = serieEmAberto();

  const primeira = await apagar({ id: "a1", alcance: "apenas_esta", agenda });
  const segunda = await apagar({ id: "a1", alcance: "apenas_esta", agenda });

  assert.equal(primeira.corpo.ocorrencias_puladas, 1);
  assert.equal(statusDe(agenda, "a1"), "skipped");

  // A segunda volta nao grava nada, e diz isso. Antes do conserto ela gravava
  // `skipped` em cima de `skipped` e respondia "Ocorrencia pulada" de novo --
  // "pulei 1" sobre um mes que ninguem acabou de pular.
  assert.equal(segunda.corpo.ocorrencias_puladas, 0, "a segunda volta contou uma escrita que nao houve");
  assert.equal(segunda.corpo.ancora_ja_fora_da_agenda, true);
  assert.equal(statusDe(agenda, "a1"), "skipped");
});

// ---------------------------------------------------------------------------
// 3b. A JANELA ENTRE LER E GRAVAR
// ---------------------------------------------------------------------------

test("a linha que virou cancelled DEPOIS da leitura nao e rebaixada pela escrita", async () => {
  // POR QUE ESTE CASO EXISTE, E POR QUE SO ELE MEDE O FILTRO DA ESCRITA
  // ------------------------------------------------------------------
  // O plano decide a partir de um `status` lido algumas linhas antes do UPDATE.
  // Entre as duas cabe um segundo pedido -- a aba aberta duas vezes, a
  // retentativa do cliente que perdeu a resposta --, e nessa janela o plano
  // esta CERTO e a escrita cega rebaixaria a linha de novo.
  //
  // E a diferenca entre "o plano nunca rebaixa" e "a ROTA nunca rebaixa", e so
  // a segunda e verdade para quem le o banco depois. Sem este caso o
  // `.eq("status", "pending")` da escrita e redundante com o plano em tudo que
  // o fixture consegue produzir, e o mutante que o apaga sobrevive -- duas
  // guardas que se cobrem fazem as duas parecerem desnecessarias.
  const agenda = serieEmAberto();

  const r = await apagar({
    id: "a1",
    alcance: "apenas_esta",
    agenda,
    // O outro pedido chegou primeiro e encerrou a serie.
    noMeioDoPedido: () => {
      linhaDe(agenda, "a1").status = "cancelled";
    },
  });

  assert.equal(
    statusDe(agenda, "a1"),
    "cancelled",
    "a escrita rebaixou a linha que o outro pedido acabou de encerrar"
  );

  // E a resposta nao mente sobre isso: zero linha com lista NAO vazia e um
  // conflito, nao um sucesso. Dizer 200 aqui afirmaria uma escrita que nao
  // aconteceu.
  assert.equal(r.status, 409);
  assert.match(r.corpo.error, /mudaram de estado/);
});

// ---------------------------------------------------------------------------
// 4. 'esta_e_proximas' COM A ANCORA JA FORA: as irmas saem, e a REGRA ENCERRA
// ---------------------------------------------------------------------------

test("'esta_e_proximas' de uma ancora cancelled pula as irmas e NAO rebaixa a ancora", async () => {
  // Este e o caso que o conserto obvio erra. Quem le "se a ancora ja esta fora,
  // devolve na hora" escreve um `return` antes do bloco das irmas -- e com ele
  // nenhuma pendente sai da agenda E a regra continua gerando, com 200 na
  // resposta. Os tres pedacos sao medidos aqui de uma vez.
  const agenda = [
    { id: "cancelada", user_id: DONO, recurring_rule_id: REGRA, due_date: D(2), status: "cancelled", description: "Aluguel" },
    { id: "depois-1", user_id: DONO, recurring_rule_id: REGRA, due_date: D(3), status: "pending", description: "Aluguel" },
    { id: "depois-2", user_id: DONO, recurring_rule_id: REGRA, due_date: D(4), status: "pending", description: "Aluguel" },
    { id: "antes", user_id: DONO, recurring_rule_id: REGRA, due_date: D(1), status: "pending", description: "Aluguel" },
  ];

  const r = await apagar({ id: "cancelada", alcance: "esta_e_proximas", agenda });

  assert.equal(statusDe(agenda, "cancelada"), "cancelled", "a ancora foi rebaixada");
  assert.equal(statusDe(agenda, "depois-1"), "skipped", "a irma posterior tinha de sair da agenda");
  assert.equal(statusDe(agenda, "depois-2"), "skipped");
  assert.equal(statusDe(agenda, "antes"), "pending", "a anterior a ancora nao se mexe");

  // O PASSO QUE FECHA A TORNEIRA. Sem ele a conta nao volta amanha -- volta
  // alguns MESES depois, quando ninguem liga uma coisa a outra.
  assert.equal(
    linhaDe(r.regras, REGRA).end_date,
    D(2),
    "a regra tem de receber end_date mesmo com a ancora ja fora da agenda"
  );
  assert.equal(r.corpo.regra_encerrada_em, D(2));

  // E a frase nao diz "tirei ESTA e as 2 proximas" sobre uma linha que a rota
  // preservou: confirmar a acao que nao houve e o pior jeito de responder.
  assert.equal(r.corpo.ancora_ja_fora_da_agenda, true);
  assert.equal(r.corpo.ocorrencias_puladas, 2);
  assert.match(r.corpo.message, /já estava fora da agenda/);
  assert.ok(
    !/Tirei esta e as/.test(r.corpo.message),
    `a frase afirma ter tirado a ancora: ${r.corpo.message}`
  );
});

test("'esta_e_proximas' de uma ancora PENDING continua dizendo 'esta e as proximas'", async () => {
  // O outro lado da frase acima -- sem este caso, um `ancoraJaForaDaAgenda`
  // cravado em `true` passaria verde.
  const agenda = serieEmAberto();
  const r = await apagar({ id: "a1", alcance: "esta_e_proximas", agenda });

  assert.equal(statusDe(agenda, "a1"), "skipped");
  assert.equal(statusDe(agenda, "a2"), "skipped");
  assert.equal(statusDe(agenda, "a3"), "skipped");
  assert.equal(statusDe(agenda, "ja-pulada"), "skipped", "ja estava pulada: nao conta de novo");
  assert.equal(statusDe(agenda, "pago"), "paid");

  assert.equal(r.corpo.ancora_ja_fora_da_agenda, false);
  assert.equal(r.corpo.ocorrencias_puladas, 3, "tres pendentes, e nao a ja pulada nem a paga");
  assert.match(r.corpo.message, /Tirei esta e as 2 próximas/);
});

// ---------------------------------------------------------------------------
// 5. O CAMINHO DE LIMPEZA: 'todas' encerra tambem o que ja estava pulado
// ---------------------------------------------------------------------------

test("'todas' ENCERRA as linhas que ja estavam skipped -- o caminho que nao existia", async () => {
  // Medido em producao: `{alcance:"todas"}` respondia "Gasto fixo encerrado. 0
  // ocorrencia(s) em aberto sairam da agenda" e nao tocava em nenhuma das seis
  // linhas `skipped`. Elas ficavam `skipped` para sempre -- nao havia caminho
  // NENHUM no app para mudar isso, so um DELETE no SQL Editor.
  const agenda = serieEmAberto();

  const r = await apagar({ id: "a1", alcance: "todas", agenda });

  assert.equal(statusDe(agenda, "a1"), "cancelled");
  assert.equal(statusDe(agenda, "a2"), "cancelled");
  assert.equal(statusDe(agenda, "a3"), "cancelled");
  assert.equal(
    statusDe(agenda, "ja-pulada"),
    "cancelled",
    "a linha ja pulada ficou presa em skipped: encerrar a serie e o estado final dela"
  );
  assert.equal(statusDe(agenda, "pago"), "paid", "a paga nao se mexe nem aqui");

  // AS DUAS GARANTIAS QUE A ESCRITA NOVA NAO PODE ATROPELAR.
  assert.equal(
    statusDe(agenda, "vencida"),
    "pending",
    "a conta que venceu e nao foi paga e divida real: cancela-la apaga da tela um atraso que existe"
  );
  assert.equal(
    statusDe(agenda, "de-outro-dono"),
    "skipped",
    "a linha de outro dono saiu do lugar: a escrita perdeu o recorte de usuario"
  );

  assert.equal(linhaDe(r.regras, REGRA).is_active, false);
  assert.equal(r.corpo.regra_encerrada, true);
});

test("'todas' devolve os DOIS numeros separados, e nao a soma", async () => {
  // Somar as ja puladas em `ocorrencias_canceladas` faria a frase prometer que
  // N meses sairam da agenda AGORA, quando parte deles ja estava fora -- a
  // mesma inflacao de contagem que o plano da exclusao recusa.
  const r = await apagar({ id: "a1", alcance: "todas", agenda: serieEmAberto() });

  assert.equal(r.corpo.ocorrencias_canceladas, 3, "tres pendentes sairam da agenda agora");
  assert.equal(r.corpo.ocorrencias_ja_fora_encerradas, 1, "uma ja estava pulada");
  assert.match(r.corpo.message, /3 ocorrência\(s\) em aberto saíram da agenda/);
  assert.match(r.corpo.message, /1 que já estava\(m\) pulada\(s\)/);
});

test("'todas' numa serie inteiramente pulada nao diz mais '0' e nada faz", async () => {
  // O caso exato da medicao: as seis linhas da sonda, todas fora da agenda.
  const agenda = serieComoEstavaEmProducao();
  const r = await apagar({ id: "p1", alcance: "todas", agenda });

  assert.deepEqual(
    agenda.filter((l) => l.id !== "pago").map((l) => l.status),
    ["cancelled", "cancelled", "cancelled", "cancelled", "cancelled", "cancelled"],
    "encerrar a serie tem de levar a linha skipped ao estado final"
  );
  assert.equal(r.corpo.ocorrencias_canceladas, 0, "nenhuma estava em aberto");
  assert.equal(r.corpo.ocorrencias_ja_fora_encerradas, 1, "so a p1 estava skipped; as outras cinco ja estavam cancelled");
  assert.equal(statusDe(agenda, "pago"), "paid");
});

// ---------------------------------------------------------------------------
// 6. A OCORRENCIA PAGA CONTINUA SENDO 409, E NAO "ja estava fora"
// ---------------------------------------------------------------------------

test("a ocorrencia PAGA volta 409 com a frase do estorno, e nao um sucesso idempotente", async () => {
  // `oSoftDeleteAvanca` responde `false` para `paid` tambem -- de proposito,
  // porque fechar por omissao e o lado certo de errar. Mas se a rota lesse esse
  // `false` como "ja estava fora da agenda", apagar uma conta PAGA responderia
  // 200 "nada mudou" em vez de explicar o estorno. A ordem dos dois criterios na
  // rota e o que separa as duas respostas, e so este caso a mede.
  const r = await apagar({ id: "pago", alcance: "apenas_esta" });

  assert.equal(r.status, 409);
  assert.match(r.corpo.error, /estorne/);
  assert.equal(statusDe(r.agenda, "pago"), "paid");
});
