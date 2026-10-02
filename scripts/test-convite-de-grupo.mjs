// =====================================================
// HMO-197: as decisoes do convite que nao dependem de banco
// =====================================================
// A metade de JavaScript do conserto. A outra metade -- o trigger, a RLS, o
// backfill -- esta em database/tests/hmo197_convite_sem_conta_test.sql, e e
// aquela que prova a entrega. Aqui ficam as tres regras da rota que erram em
// SILENCIO: a duplicata que nao e detectada, o email gravado num formato que o
// cadastro nao reconhece, e a mensagem que promete uma entrega que nao aconteceu.
//
// Rodar: npm run test:convite-de-grupo
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  alvoParaComparar,
  alvoParaGravar,
  entregaDoConvite,
  jaTemConvitePendente,
  mensagemDeConvite,
} from "../.tmp-convite-de-grupo/convite-de-grupo.js";

// ---------------------------------------------------------------------------
// Normalizacao: o par com o LOWER(btrim(...)) da migration 039
// ---------------------------------------------------------------------------
test("grava sem espaco em volta e preserva a caixa digitada", () => {
  assert.equal(alvoParaGravar("  Leticia@Gmail.com "), "Leticia@Gmail.com");
  assert.equal(alvoParaGravar("ja@limpo.com"), "ja@limpo.com");
});

test("alvoParaGravar nao quebra com valor ausente", () => {
  // `email_or_phone` vem de JSON.parse do corpo da requisicao: pode ser
  // qualquer coisa. Antes era `String(x).trim()` solto na rota, e `undefined`
  // viraria a string "undefined" -- um email que o trigger jamais casa.
  assert.equal(alvoParaGravar(undefined), "");
  assert.equal(alvoParaGravar(null), "");
});

test("a comparacao ignora caixa e espaco, igual ao LOWER(btrim()) do Postgres", () => {
  assert.equal(alvoParaComparar(" Leticia@TEST.local "), "leticia@test.local");
  assert.equal(
    alvoParaComparar("MESMO@email.com"),
    alvoParaComparar("mesmo@EMAIL.com")
  );
});

// ---------------------------------------------------------------------------
// Duplicata: as duas pernas
// ---------------------------------------------------------------------------
const CONTA = "a0a0a0a0-0197-0000-0000-000000000002";

test("detecta duplicata pela CONTA quando ela existe", () => {
  const pendentes = [
    { invited_user_id: CONTA, invite_target: "qualquer@coisa.com" },
  ];
  // Repare que o email NAO bate: quem manda e a conta.
  assert.equal(jaTemConvitePendente(pendentes, CONTA, "outro@email.com"), true);
});

test("detecta duplicata pelo EMAIL quando ainda nao ha conta", () => {
  const pendentes = [
    { invited_user_id: null, invite_target: "Novata@TEST.local" },
  ];
  assert.equal(
    jaTemConvitePendente(pendentes, null, " novata@test.local "),
    true,
    "convidar duas vezes quem nao se cadastrou gravaria duas linhas, e o " +
      "trigger da 039 reclamaria as duas: convite duplicado no app dela"
  );
});

test("olha a perna do EMAIL mesmo quando ja existe conta", () => {
  // Conta NAO confirmada: get_user_by_email nao a devolve (invitedUserId nulo
  // no convite antigo), mas agora ela confirmou e a rota a encontra. A linha
  // sem dono continua la, e convidar de novo duplicaria.
  const pendentes = [
    { invited_user_id: null, invite_target: "novata@test.local" },
  ];
  assert.equal(jaTemConvitePendente(pendentes, CONTA, "novata@test.local"), true);
});

test("convite que JA tem dono nao bloqueia o convite novo para o mesmo email", () => {
  // Caso reachable e nada obvio: o convite foi entregue ao Bob quando
  // `invite_target` era o email dele; depois o Bob trocou o email da conta no
  // GoTrue. Aquele endereco ficou sem dono, `get_user_by_email` nao acha
  // ninguem (invitedUserId nulo), e convidar o endereco de novo E legitimo --
  // e um convite para quem vier a se cadastrar com ele.
  //
  // Sem o `c.invited_user_id === null` na perna do email, o convite do Bob
  // bloquearia este, com a mensagem errada ("ja existe convite pendente para
  // esse email") e sem caminho de saida para o admin.
  const pendentes = [
    { invited_user_id: "bbbbbbbb-0197-0000-0000-00000000000b", invite_target: "bob@x.com" },
  ];
  assert.equal(jaTemConvitePendente(pendentes, null, "bob@x.com"), false);
});

test("nao confunde convidados diferentes", () => {
  const pendentes = [
    { invited_user_id: null, invite_target: "alguem@test.local" },
    { invited_user_id: "c0c0c0c0-0197-0000-0000-000000000003", invite_target: "x@y.z" },
  ];
  assert.equal(jaTemConvitePendente(pendentes, null, "outra@test.local"), false);
  assert.equal(jaTemConvitePendente(pendentes, CONTA, "outra@test.local"), false);
});

test("lista vazia nunca e duplicata", () => {
  assert.equal(jaTemConvitePendente([], null, "a@b.c"), false);
  assert.equal(jaTemConvitePendente([], CONTA, "a@b.c"), false);
});

test("invite_target nulo no banco nao casa com email vazio por acidente", () => {
  // `invite_target` e NOT NULL no schema, entao isto e defesa -- mas se um dia
  // deixar de ser, um `null` virando "" casaria com um email vazio e bloquearia
  // um convite legitimo com "ja existe pendente".
  const pendentes = [{ invited_user_id: null, invite_target: null }];
  assert.equal(jaTemConvitePendente(pendentes, null, "   "), true);
  assert.equal(jaTemConvitePendente(pendentes, null, "real@email.com"), false);
});

// ---------------------------------------------------------------------------
// A mensagem: os dois casos sao entregas diferentes
// ---------------------------------------------------------------------------
test("com conta, a mensagem diz que o convite JA esta no app da pessoa", () => {
  const msg = mensagemDeConvite({
    invitedUserId: CONTA,
    nomeConvidado: "Leticia",
    alvo: "leticia@test.local",
    groupCode: "A197F9",
  });
  assert.match(msg, /Convite enviado para Leticia/);
  assert.match(msg, /notificações do app/);
  assert.equal(entregaDoConvite(CONTA), "in_app");
});

test("sem conta, a mensagem NAO promete notificacao agora", () => {
  const msg = mensagemDeConvite({
    invitedUserId: null,
    nomeConvidado: "quem@sem-conta.com",
    alvo: "quem@sem-conta.com",
    groupCode: "A197F9",
  });

  // A assercao central da HMO-197 do lado do texto, e ela e uma NEGACAO: a frase
  // nao pode dizer "convite enviado". Era isso que mandava o admin esperar uma
  // notificacao que so existiria quando a pessoa se cadastrasse -- e, se ela
  // nunca se cadastrasse, nunca.
  assert.doesNotMatch(msg, /[Cc]onvite enviado/);
  assert.match(msg, /ainda não tem conta/);
  assert.match(msg, /assim que ela se cadastrar/);
  // O codigo do grupo vai junto como caminho mais rapido.
  assert.match(msg, /A197F9/);
  assert.equal(entregaDoConvite(null), "on_signup");
});

test("as duas mensagens sao diferentes", () => {
  // Guarda contra o conserto por copia: as duas frases vindo do mesmo galho
  // (ou uma delas sumindo) e justamente o defeito que a HMO-196 teve.
  const comum = { nomeConvidado: "Alguem", alvo: "a@b.c", groupCode: "Z9Z9Z9" };
  assert.notEqual(
    mensagemDeConvite({ ...comum, invitedUserId: null }),
    mensagemDeConvite({ ...comum, invitedUserId: CONTA })
  );
});
