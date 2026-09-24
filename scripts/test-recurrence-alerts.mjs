#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DO DISPARO DOS ALERTAS DE ASSINATURA
// =====================================================
//   npm run test:recurrence-alerts
//
// Exercita lib/services/recurrence-alerts.ts -- o modulo que os TRES
// consumidores dos alertas compartilham (a tela /dashboard/recurrences, o sino
// do app, e o cron que manda o push).
//
// O que se prova aqui NAO e a deteccao do alerta (isso e o
// test:recurrence-detector, que ja fixa as frases) e nem as constraints do banco
// (isso e database/tests/recurrence_notifications_test.sql, em Postgres de
// verdade). O que sobra -- e o que esta issue existe para acertar -- e a
// TRADUCAO do alerta para a linguagem da notificacao: qual `kind`, qual
// `reference_date`, e quem fica de fora.
//
// Os tres erros cobertos abaixo sao silenciosos. Nenhum deles lanca excecao,
// nenhum aparece no tsc, e todos produzem um app que parece funcionar:
//
//   1. `reference_date` errado no aviso de cancelamento -> a MESMA frase chega
//      no celular todo mes, indistinguivel de um bug do app;
//   2. assinatura ignorada gerando alerta -> push de uma linha que o usuario
//      mandou calar, pelo canal mais intrusivo que o app tem;
//   3. `kind` fora do dominio -> o INSERT do cron morre no CHECK do 016 e
//      NINGUEM recebe aviso, porque o upsert e um lote so.
//
// O cliente do Supabase e dublado, pelo mesmo motivo do test:recurrence-scan: o
// db-verify ja prova o schema em Postgres, e o que falta provar e TypeScript que
// nenhum SQL alcanca.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  alertasDasRecorrencias,
  alertasDoUsuario,
  KIND_DO_ALERTA,
  linhaDeNotificacao,
  mereceAlerta,
  referenciaDoAlerta,
  textoDoAlerta,
  MAX_RECORRENCIAS,
  URL_DOS_ALERTAS,
} = await import("../.tmp-recurrence-alerts/services/recurrence-alerts.js");

// ---------------------------------------------------------------------------
// Duble do cliente do Supabase
// ---------------------------------------------------------------------------
// O builder do supabase-js e "thenable": cada filtro devolve ele mesmo e o await
// no fim resolve. O duble copia esse formato e GUARDA os filtros, porque um
// deles e de seguranca: sem o `.eq("user_id", ...)` da consulta de transacoes, a
// service_role do cron cruzaria a transacao de um usuario com a assinatura de
// outro.
function dublarSupabase({ transacoes = [], recorrencias = [], erroRecorrencias = null } = {}) {
  const registro = { filtros: [], tabelas: [] };

  const builder = (resolver) => {
    const b = {};
    for (const metodo of ["select", "eq", "neq", "in", "order", "limit", "lt", "gte"]) {
      b[metodo] = (...args) => {
        registro.filtros.push([metodo, ...args]);
        return b;
      };
    }
    b.then = (ok, falha) => Promise.resolve(resolver()).then(ok, falha);
    return b;
  };

  return {
    registro,
    from(tabela) {
      registro.tabelas.push(tabela);
      if (tabela === "financial_transactions") {
        return builder(() => ({ data: transacoes, error: null }));
      }
      if (tabela === "detected_recurrences") {
        return builder(() =>
          erroRecorrencias
            ? { data: null, error: { message: erroRecorrencias } }
            : { data: recorrencias, error: null },
        );
      }
      throw new Error(`tabela inesperada nos alertas: ${tabela}`);
    },
  };
}

/** Uma serie de cobrancas mensais, em despesa (valor NEGATIVO, como o banco grava). */
function cobrancas(valores, primeiraData = "2026-06-10") {
  const [ano, mes, dia] = primeiraData.split("-").map(Number);
  return valores.map((v, i) => ({
    id: `t${i}`,
    description: "NETFLIX.COM",
    // Negativo: despesa. Um fixture positivo passaria verde e esconderia o
    // sinal errado -- ver a convencao de sinal do projeto.
    amount: -Math.abs(v),
    transaction_date: `${ano}-${String(mes + i).padStart(2, "0")}-${String(dia).padStart(2, "0")}`,
  }));
}

function recorrencia(extra = {}) {
  return {
    id: "r1",
    merchant_key: "netflix",
    display_name: "Netflix",
    status: "DETECTED",
    status_changed_at: null,
    last_charge_date: "2026-09-10",
    transaction_ids: ["t0", "t1", "t2", "t3"],
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// 1. O `kind` tem que ser exatamente o do dominio do CHECK do 016
// ---------------------------------------------------------------------------
// Um `kind` fora do dominio nao gera aviso errado: gera INSERT recusado. E como
// o cron grava tudo num upsert unico, UM kind errado significa que NINGUEM
// recebe aviso naquela execucao -- e a mensagem no log fala de constraint, nao
// de vocabulario.
test("o kind de cada alerta e o que a migration 016 admite", () => {
  assert.equal(KIND_DO_ALERTA.PRICE_INCREASE, "price_increase");
  assert.equal(KIND_DO_ALERTA.CHARGED_AFTER_CANCEL, "charge_after_cancel");

  // O dominio inteiro do CHECK, as duas familias. Acrescentar um tipo de alerta
  // no detector sem acrescentar o `kind` no 016 reprova aqui.
  const admitidos = ["due_soon", "overdue", "price_increase", "charge_after_cancel"];
  for (const kind of Object.values(KIND_DO_ALERTA)) {
    assert.ok(admitidos.includes(kind), `kind fora do dominio do 016: ${kind}`);
  }
});

// ---------------------------------------------------------------------------
// 2. reference_date: o que decide se o aviso repete
// ---------------------------------------------------------------------------
test("aumento de preco e deduplicado pela ultima cobranca", () => {
  const alerta = { tipo: "PRICE_INCREASE", displayName: "Netflix", mensagem: "x" };
  assert.equal(referenciaDoAlerta(alerta, "2026-09-10"), "2026-09-10");
});

// ESTE e o assert que mais importa do arquivo. O desenho da issue mandava usar
// `last_charge_date` para as DUAS familias. Para o aumento esta certo; para o
// cancelamento, nao: a frase desse alerta cita sempre a PRIMEIRA cobranca
// posterior ao cancelamento, entao uma chave que anda a cada cobranca nova
// manda a MESMA frase -- mesmo valor, mesma data -- todo mes. E o spam que esta
// issue existe para impedir, chegando pelo caminho que ela abriu.
test("cobranca apos cancelamento e deduplicada pela cobranca que a frase CITA", () => {
  const alerta = {
    tipo: "CHARGED_AFTER_CANCEL",
    displayName: "Netflix",
    mensagem: "Netflix foi marcada como cancelada, mas cobrou R$ 39,90 em 10/07/2026.",
    dataDaCobranca: "2026-07-10",
  };

  // A assinatura ja foi cobrada mais duas vezes desde entao (last_charge_date
  // andou para setembro), e a frase continua falando de julho.
  assert.equal(referenciaDoAlerta(alerta, "2026-09-10"), "2026-07-10");
});

test("sem dataDaCobranca, a referencia cai na ultima cobranca", () => {
  // Rede para um alerta futuro que nao traga a data: melhor deduplicar por
  // last_charge_date do que gravar reference_date nulo, que o NOT NULL da coluna
  // recusaria e derrubaria o lote inteiro.
  const alerta = { tipo: "CHARGED_AFTER_CANCEL", displayName: "X", mensagem: "y" };
  assert.equal(referenciaDoAlerta(alerta, "2026-09-10"), "2026-09-10");
});

// ---------------------------------------------------------------------------
// 3. O texto: uma frase so para a tela, o sino e o push
// ---------------------------------------------------------------------------
test("o corpo do aviso e a frase do detector, sem reescrita", () => {
  const mensagem = "Netflix subiu 12,5% (de R$ 39,90 para R$ 44,90).";
  const { title, body } = textoDoAlerta({
    tipo: "PRICE_INCREASE",
    displayName: "Netflix",
    mensagem,
  });

  // A frase e a MESMA que a tela /dashboard/recurrences mostra. Um segundo texto
  // aqui divergiria dela na primeira correcao de redacao, e o usuario veria o
  // push dizer uma coisa e o app outra.
  assert.equal(body, mensagem);
  assert.equal(title, "Netflix ficou mais caro");
});

test("o titulo diz qual dos dois alertas e, sem depender do corpo", () => {
  // Em push, o corpo pode ser cortado pelo sistema; o titulo raramente. Se os
  // dois alertas tivessem o mesmo titulo, a notificacao na tela de bloqueio nao
  // distinguiria "ficou mais caro" de "cobrou depois de cancelada" -- que
  // pedem acoes diferentes.
  const aumento = textoDoAlerta({
    tipo: "PRICE_INCREASE",
    displayName: "Netflix",
    mensagem: "m",
  });
  const cobrou = textoDoAlerta({
    tipo: "CHARGED_AFTER_CANCEL",
    displayName: "Netflix",
    mensagem: "m",
  });

  assert.notEqual(aumento.title, cobrou.title);
  assert.match(cobrou.title, /cancelada/);
});

// ---------------------------------------------------------------------------
// 4. A linha que vai para o banco
// ---------------------------------------------------------------------------
test("a linha gravada tem as colunas que o 016 exige, e só a referencia de recorrencia", () => {
  const linha = linhaDeNotificacao("u1", {
    tipo: "PRICE_INCREASE",
    recurrenceId: "r1",
    kind: "price_increase",
    referenceDate: "2026-09-10",
    title: "t",
    body: "b",
    displayName: "Netflix",
    merchantKey: "netflix",
    mensagem: "b",
  });

  assert.deepEqual(linha, {
    user_id: "u1",
    recurrence_id: "r1",
    kind: "price_increase",
    reference_date: "2026-09-10",
    title: "t",
    body: "b",
    channel: "inapp",
  });

  // O CHECK de exclusividade do 016 recusa a linha com as DUAS referencias. Uma
  // chave `scheduled_transaction_id: null` explicita passaria (NULL nao conta),
  // mas `undefined` viajando no JSON viraria a coluna ausente -- o que tambem
  // passa. O assert e sobre a AUSENCIA porque e ela que mantem o payload
  // honesto: quem ler esta linha sabe que a familia e a de recorrencia.
  assert.ok(!("scheduled_transaction_id" in linha));

  // 'inapp' e a verdade no momento da gravacao: o push ainda nao foi tentado. A
  // rota promove para 'push' depois do envio.
  assert.equal(linha.channel, "inapp");
});

// ---------------------------------------------------------------------------
// 5. Quem fica de fora
// ---------------------------------------------------------------------------
test("assinatura ignorada nao gera alerta", () => {
  assert.equal(mereceAlerta("IGNORED"), false);
  assert.equal(mereceAlerta("DETECTED"), true);
  assert.equal(mereceAlerta("CONFIRMED"), true);
  // CANCELLED tem que continuar valendo: e justamente o status do alerta de
  // cobranca-depois-de-cancelada. Filtrar por "status ativo" calaria o alerta
  // que mais importa dos dois.
  assert.equal(mereceAlerta("CANCELLED"), true);
});

test("a varredura nao calcula alerta de assinatura ignorada", async () => {
  const supabase = dublarSupabase({ transacoes: cobrancas([39.9, 39.9, 39.9, 44.9]) });

  const alertas = await alertasDasRecorrencias(supabase, "u1", [
    recorrencia({ status: "IGNORED" }),
  ]);

  assert.equal(alertas.length, 0);
  // E nem foi ao banco: sem candidata, nao ha transacao para ler.
  assert.equal(supabase.registro.tabelas.length, 0);
});

// ---------------------------------------------------------------------------
// 6. O caminho completo, com o duble
// ---------------------------------------------------------------------------
test("o aumento de preco vira um alerta pronto para gravar", async () => {
  // 39,90 tres vezes e 44,90 na ultima: +12,5% sobre a media das anteriores,
  // acima do limite de 10%.
  const supabase = dublarSupabase({ transacoes: cobrancas([39.9, 39.9, 39.9, 44.9]) });

  const alertas = await alertasDasRecorrencias(supabase, "u1", [recorrencia()]);

  assert.equal(alertas.length, 1);
  assert.equal(alertas[0].kind, "price_increase");
  assert.equal(alertas[0].recurrenceId, "r1");
  assert.equal(alertas[0].referenceDate, "2026-09-10");
  assert.match(alertas[0].body, /12,5%/);
});

test("a consulta de transacoes e filtrada pelo usuario", async () => {
  const supabase = dublarSupabase({ transacoes: cobrancas([39.9, 39.9, 39.9, 44.9]) });
  await alertasDasRecorrencias(supabase, "u1", [recorrencia()]);

  // Sem este filtro a service_role do cron cruzaria a transacao de um usuario
  // com a assinatura de outro: o alerta sairia com o valor errado e nada
  // quebraria. O duble nao aplica filtro nenhum, entao so o registro prova.
  const porUsuario = supabase.registro.filtros.find(
    ([metodo, coluna]) => metodo === "eq" && coluna === "user_id",
  );
  assert.deepEqual(porUsuario, ["eq", "user_id", "u1"]);
});

test("sem aumento e sem cancelamento, nao ha alerta", async () => {
  // Controle negativo: um preco estavel nao pode gerar aviso. Sem isto, um
  // limite quebrado que alerta SEMPRE passaria em todos os testes acima.
  const supabase = dublarSupabase({ transacoes: cobrancas([39.9, 39.9, 39.9, 39.9]) });
  const alertas = await alertasDasRecorrencias(supabase, "u1", [recorrencia()]);
  assert.equal(alertas.length, 0);
});

test("cancelada e cobrada depois vira alerta com a data da cobranca", async () => {
  const supabase = dublarSupabase({
    transacoes: cobrancas([39.9, 39.9, 39.9, 39.9]), // junho a setembro, preco estavel
  });

  const alertas = await alertasDasRecorrencias(supabase, "u1", [
    recorrencia({
      status: "CANCELLED",
      // Cancelou em 30/06: a cobranca de julho e a primeira posterior.
      status_changed_at: "2026-06-30T12:00:00.000Z",
    }),
  ]);

  assert.equal(alertas.length, 1);
  assert.equal(alertas[0].kind, "charge_after_cancel");
  // A chave e julho, e nao setembro: o aviso de outubro nao vai repetir esta
  // frase. Ver o teste 2.
  assert.equal(alertas[0].referenceDate, "2026-07-10");
  assert.match(alertas[0].body, /10\/07\/2026/);
});

test("os dois alertas da mesma assinatura sao dois avisos distintos", async () => {
  const supabase = dublarSupabase({ transacoes: cobrancas([39.9, 39.9, 39.9, 44.9]) });

  const alertas = await alertasDasRecorrencias(supabase, "u1", [
    recorrencia({ status: "CANCELLED", status_changed_at: "2026-06-30T12:00:00.000Z" }),
  ]);

  assert.equal(alertas.length, 2);
  // Chaves de deduplicacao diferentes: os dois tem que caber no indice unico do
  // 016 ao mesmo tempo. Se colidissem, um dos dois avisos nunca sairia.
  const chaves = alertas.map((a) => `${a.recurrenceId}|${a.kind}|${a.referenceDate}`);
  assert.equal(new Set(chaves).size, 2);
});

test("cancelada sem status_changed_at nao gera alerta de cobranca", async () => {
  // O CHECK do 011 garante que so 'DETECTED' tem status_changed_at nulo, mas a
  // rota nao pode depender disso: sem a data do cancelamento nao existe
  // "cobranca posterior", e comparar com string vazia acusaria TODA cobranca.
  const supabase = dublarSupabase({ transacoes: cobrancas([39.9, 39.9, 39.9, 39.9]) });
  const alertas = await alertasDasRecorrencias(supabase, "u1", [
    recorrencia({ status: "CANCELLED", status_changed_at: null }),
  ]);
  assert.equal(alertas.length, 0);
});

test("recorrencia sem transacao no lote nao gera alerta", async () => {
  // Acontece de verdade: o usuario apaga os lancamentos e a linha fica na
  // tabela com a decisao dele preservada (recurrence-scan.ts nao apaga). Um
  // alerta calculado sobre lista vazia seria um aviso sobre nada.
  const supabase = dublarSupabase({ transacoes: [] });
  const alertas = await alertasDasRecorrencias(supabase, "u1", [recorrencia()]);
  assert.equal(alertas.length, 0);
});

// ---------------------------------------------------------------------------
// 7. alertasDoUsuario: o caminho do sino e do cron
// ---------------------------------------------------------------------------
test("alertasDoUsuario filtra IGNORED no banco e respeita o teto", async () => {
  const supabase = dublarSupabase({
    recorrencias: [recorrencia()],
    transacoes: cobrancas([39.9, 39.9, 39.9, 44.9]),
  });

  const { alertas, truncated } = await alertasDoUsuario(supabase, "u1");

  assert.equal(alertas.length, 1);
  assert.equal(truncated, false);

  const semIgnoradas = supabase.registro.filtros.find(
    ([metodo, coluna]) => metodo === "neq" && coluna === "status",
  );
  assert.deepEqual(semIgnoradas, ["neq", "status", "IGNORED"]);

  const teto = supabase.registro.filtros.find(([metodo]) => metodo === "limit");
  assert.deepEqual(teto, ["limit", MAX_RECORRENCIAS]);
});

test("alertasDoUsuario lanca quando o banco recusa, em vez de devolver lista vazia", async () => {
  // Uma lista vazia aqui viraria "nenhum alerta" -- o cron sairia verde sem
  // avisar ninguem, que e a falha silenciosa que este projeto mais teme. Quem
  // chama decide o que fazer: o sino engole e mostra o resto, o cron conta a
  // falha na resposta.
  const supabase = dublarSupabase({ erroRecorrencias: "permission denied" });
  await assert.rejects(() => alertasDoUsuario(supabase, "u1"), /permission denied/);
});

// ---------------------------------------------------------------------------
// 8. O destino do clique
// ---------------------------------------------------------------------------
test("o clique do aviso leva para a tela das assinaturas", () => {
  // O push e o sino usam a MESMA constante. Um caminho digitado a mao em cada
  // lugar vira 404 no celular no dia em que a rota mudar de nome.
  assert.equal(URL_DOS_ALERTAS, "/dashboard/recurrences");
});
