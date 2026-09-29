#!/usr/bin/env node
// =====================================================
// PULODOGATO - "esta e as proximas", e nunca o que ja passou (HMO-170)
// =====================================================
// A issue pede que editar uma movimentacao que se repete pergunte se a mudanca
// vale para uma ocorrencia ou para as seguintes, "mas nunca mudar o que ja
// passou". Este arquivo cobra a parte que erra dinheiro em silencio: QUAIS
// linhas entram na alteracao.
//
// Por que isto e testavel sem banco: `planejarEdicao` decide pelo conteudo das
// linhas, nao consultando. A rota busca as irmas e aplica o plano; o filtro NAO
// esta no `.eq()` de uma query, justamente para poder ser cobrado aqui.
//
// O DEFEITO QUE ESTE TESTE EXISTE PARA PEGAR
// ------------------------------------------
// Filtrar por `due_date >= hoje` em vez de `>= ancora`. As duas versoes passam
// em qualquer caso onde a ancora E o mes corrente -- que e como se testa a
// funcionalidade a mao -- e divergem quando a pessoa edita um mes mais a frente:
// a versao por `hoje` reescreve tambem os meses ENTRE hoje e a ancora. A pessoa
// pediu "daqui para frente" e recebeu "desde sempre", em linhas que ela nao
// estava olhando.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  planejarEdicao,
  conferirPatchNoAlcance,
  ehAlcanceValido,
  CAMPOS_PROPAGAVEIS,
} from "../.tmp-recorrencia-edicao/lib/recorrencia-edicao.js";

const REGRA = "regra-aluguel";

/** Uma ocorrencia da serie do aluguel. */
function ocorrencia(id, due_date, status = "pending", regra = REGRA) {
  return { id, due_date, status, recurring_rule_id: regra };
}

// A serie: setembro ja foi paga, outubro venceu e nao foi paga, novembro em
// diante estao pendentes. A ancora dos casos principais e dezembro.
const SETEMBRO = ocorrencia("set", "2026-09-10", "paid");
const OUTUBRO = ocorrencia("out", "2026-10-10", "pending");
const NOVEMBRO = ocorrencia("nov", "2026-11-10", "pending");
const DEZEMBRO = ocorrencia("dez", "2026-12-10", "pending");
const JANEIRO = ocorrencia("jan", "2027-01-10", "pending");
const FEVEREIRO = ocorrencia("fev", "2027-02-10", "pending");

const SERIE = [SETEMBRO, OUTUBRO, NOVEMBRO, DEZEMBRO, JANEIRO, FEVEREIRO];

// ---------------------------------------------------------------------------
// APENAS ESTA
// ---------------------------------------------------------------------------

test("apenas_esta toca uma linha so, mesmo com a serie inteira na mao", () => {
  const plano = planejarEdicao("apenas_esta", DEZEMBRO, SERIE);

  assert.deepEqual(plano.ids, ["dez"]);
  // A regra NAO muda: corrigir a conta de luz de um mes nao reajusta a conta de
  // luz. Se mudasse, todo acerto pontual viraria um reajuste permanente.
  assert.equal(plano.atualizarRegra, false);
});

test("apenas_esta nao pede a regra nem quando a ocorrencia e avulsa", () => {
  const avulsa = { id: "a", due_date: "2026-10-01", status: "pending", recurring_rule_id: null };
  const plano = planejarEdicao("apenas_esta", avulsa, []);

  assert.deepEqual(plano.ids, ["a"]);
  assert.equal(plano.atualizarRegra, false);
});

// ---------------------------------------------------------------------------
// ESTA E AS PROXIMAS -- O QUE ENTRA
// ---------------------------------------------------------------------------

test("esta_e_proximas pega a ancora e o que vence depois dela", () => {
  const plano = planejarEdicao("esta_e_proximas", DEZEMBRO, SERIE);

  assert.deepEqual(plano.ids, ["dez", "jan", "fev"]);
  // A regra tambem: sem isto, o valor novo valeria para os meses ja
  // materializados e a proxima geracao traria o antigo de volta.
  assert.equal(plano.atualizarRegra, true);
});

test("a ancora entra sempre, e entra primeiro", () => {
  const plano = planejarEdicao("esta_e_proximas", DEZEMBRO, SERIE);
  assert.equal(plano.ids[0], "dez");
});

test("a ancora nao e duplicada quando ela vem na lista de irmas", () => {
  // A rota busca a serie inteira por `recurring_rule_id`, entao a ancora VEM na
  // lista. Um `ids` com "dez" duas vezes nao quebra o UPDATE, mas a contagem
  // que a tela mostra ("alterei esta e as 3 proximas") passaria a mentir.
  const plano = planejarEdicao("esta_e_proximas", DEZEMBRO, SERIE);
  assert.equal(plano.ids.filter((id) => id === "dez").length, 1);
});

// ---------------------------------------------------------------------------
// O QUE NUNCA ENTRA -- O CORACAO DA ISSUE
// ---------------------------------------------------------------------------

test("o mes PAGO nunca entra, nem sendo posterior a ancora", () => {
  // Quem adiantou o pagamento de janeiro ja moveu o dinheiro de janeiro: existe
  // uma `financial_transactions` amarrada nele. Reescrever o valor deixaria a
  // ocorrencia e a transacao divergentes, e o extrato do mes fechado mudaria.
  const janeiroPago = ocorrencia("jan", "2027-01-10", "paid");
  const plano = planejarEdicao("esta_e_proximas", DEZEMBRO, [
    OUTUBRO,
    NOVEMBRO,
    DEZEMBRO,
    janeiroPago,
    FEVEREIRO,
  ]);

  assert.deepEqual(plano.ids, ["dez", "fev"]);
  assert.ok(plano.preservadas.includes("jan"));
});

test("o mes ANTERIOR a ancora nunca entra, mesmo pendente e vencido", () => {
  // Este e o caso que o filtro por `hoje` erraria. Outubro esta PENDENTE (nao
  // pago, ja vencido) e portanto passaria por qualquer peneira de "futuro em
  // aberto" -- mas e anterior a ancora, e a pessoa nao pediu para mexer nele.
  const plano = planejarEdicao("esta_e_proximas", DEZEMBRO, SERIE);

  assert.ok(!plano.ids.includes("out"), "outubro foi arrastado junto");
  assert.ok(!plano.ids.includes("nov"), "novembro foi arrastado junto");
  assert.deepEqual(plano.preservadas.sort(), ["nov", "out", "set"]);
});

test("pulado e cancelado ficam de fora: a pessoa tirou aquele mes de proposito", () => {
  const janeiroPulado = ocorrencia("jan", "2027-01-10", "skipped");
  const fevereiroCancelado = ocorrencia("fev", "2027-02-10", "cancelled");
  const plano = planejarEdicao("esta_e_proximas", DEZEMBRO, [
    DEZEMBRO,
    janeiroPulado,
    fevereiroCancelado,
  ]);

  assert.deepEqual(plano.ids, ["dez"]);
  assert.deepEqual(plano.preservadas.sort(), ["fev", "jan"]);
});

test("ocorrencia de OUTRA regra nunca entra", () => {
  // As duas series podem vencer no mesmo dia (aluguel e escola, dia 10). Sem o
  // filtro por regra, reajustar o aluguel mexeria na escola -- e o valor errado
  // apareceria numa linha que a pessoa nem abriu.
  const escola = ocorrencia("escola-jan", "2027-01-10", "pending", "regra-escola");
  const plano = planejarEdicao("esta_e_proximas", DEZEMBRO, [DEZEMBRO, JANEIRO, escola]);

  assert.deepEqual(plano.ids, ["dez", "jan"]);
});

test("a ancora avulsa nao arrasta ninguem, mesmo pedindo as proximas", () => {
  // Conta avulsa nao tem serie. A tela nem oferece a escolha, mas a rota e
  // publica: pedir `esta_e_proximas` aqui nao pode virar um UPDATE largo.
  const avulsa = { id: "a", due_date: "2026-10-01", status: "pending", recurring_rule_id: null };
  const plano = planejarEdicao("esta_e_proximas", avulsa, SERIE);

  assert.deepEqual(plano.ids, ["a"]);
  assert.equal(plano.atualizarRegra, false);
});

test("mesmo vencimento que a ancora anda junto", () => {
  // Uma serie que trocou de dia pode ter duas ocorrencias no mesmo dia. `>=`
  // (e nao `>`) e o que faz a irma do mesmo dia acompanhar -- ela nao e passado.
  const gemea = ocorrencia("dez-2", "2026-12-10", "pending");
  const plano = planejarEdicao("esta_e_proximas", DEZEMBRO, [DEZEMBRO, gemea]);

  assert.deepEqual(plano.ids.sort(), ["dez", "dez-2"]);
});

test("a data da ancora volta no plano, para a rota poder explicar", () => {
  const plano = planejarEdicao("esta_e_proximas", DEZEMBRO, SERIE);
  assert.equal(plano.ancoraEm, "2026-12-10");
});

// ---------------------------------------------------------------------------
// O PATCH CABE NO ALCANCE?
// ---------------------------------------------------------------------------

test("due_date com esta_e_proximas e recusado, e a recusa diz onde mudar", () => {
  // Copiar a data da ancora para as irmas colidiria no indice unico
  // (recurring_rule_id, due_date) da 005: a segunda linha seria recusada pelo
  // banco e a edicao voltaria um erro sem relacao visivel com o pedido.
  const conferido = conferirPatchNoAlcance("esta_e_proximas", ["amount", "due_date"]);

  assert.equal(conferido.ok, false);
  assert.match(conferido.mensagem, /gasto fixo|regra/i);
});

test("due_date com apenas_esta passa: e uma linha so", () => {
  assert.equal(conferirPatchNoAlcance("apenas_esta", ["due_date"]).ok, true);
});

test("status com esta_e_proximas e recusado", () => {
  // Pular "esta e as proximas" e desativar a regra, nao editar N linhas.
  const conferido = conferirPatchNoAlcance("esta_e_proximas", ["status"]);
  assert.equal(conferido.ok, false);
});

test("os campos de valor propagam", () => {
  assert.equal(
    conferirPatchNoAlcance("esta_e_proximas", [...CAMPOS_PROPAGAVEIS]).ok,
    true
  );
});

test("due_date nao esta entre os propagaveis", () => {
  // Asercao sobre a LISTA, e nao sobre o comportamento: alguem que adicione
  // "due_date" em CAMPOS_PROPAGAVEIS faria o teste de recusa acima passar a
  // aceitar, e sem este caso a mudanca entraria verde.
  assert.ok(!CAMPOS_PROPAGAVEIS.includes("due_date"));
});

// ---------------------------------------------------------------------------
// O ALCANCE QUE CHEGA DA REDE
// ---------------------------------------------------------------------------

test("so os dois alcances conhecidos sao aceitos", () => {
  assert.equal(ehAlcanceValido("apenas_esta"), true);
  assert.equal(ehAlcanceValido("esta_e_proximas"), true);
  // "todas" seria o alcance que a issue proibe: ele reescreveria o passado.
  assert.equal(ehAlcanceValido("todas"), false);
  assert.equal(ehAlcanceValido(undefined), false);
  assert.equal(ehAlcanceValido(null), false);
});
