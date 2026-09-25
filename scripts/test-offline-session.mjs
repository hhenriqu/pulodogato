// =====================================================
// TESTES DA DECISAO DE SESSAO SEM REDE
// =====================================================
//   npm run test:offline-session
//
// O que estes testes protegem, em uma frase: ficar sem sinal nao pode deslogar
// ninguem, e o servidor dizendo "nao" tem que deslogar mesmo assim.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  decidirSessao,
  classificarFalhaDeAuth,
  expiracaoEmMs,
  DIAS_DE_GRACA_OFFLINE,
} from "../.tmp-offline-session/offline-session.js";

const DIA = 86_400_000;
const AGORA = Date.UTC(2026, 8, 25, 12, 0, 0);

/** Sem rede, com sessao guardada que vence daqui a meia hora. */
const base = {
  usuarioConfirmado: false,
  origemDaFalha: "rede",
  sessaoLocalExpiraEm: AGORA + 1_800_000,
  agora: AGORA,
};

// ---------------------------------------------------------------------------
// decidirSessao
// ---------------------------------------------------------------------------

test("servidor confirmou o token: entra normal", () => {
  assert.equal(
    decidirSessao({ ...base, usuarioConfirmado: true }),
    "entrar"
  );
});

test("servidor confirmou: entra mesmo sem sessao local legivel", () => {
  // O caminho normal de quem acabou de logar em outra aba. Se a confirmacao do
  // servidor nao ganhasse de tudo, este caso cairia em "login" com o usuario
  // autenticado na mao -- um logout no meio de uma sessao valida.
  assert.equal(
    decidirSessao({
      ...base,
      usuarioConfirmado: true,
      sessaoLocalExpiraEm: null,
    }),
    "entrar"
  );
});

test("O BUG: sem rede, com sessao valida, NAO vai para o login", () => {
  // Este e o comportamento que o app tinha ate aqui. `getUser()` falhava por
  // falta de rede, `user` virava null, e o layout empurrava para /login -- uma
  // tela que, offline, nao tem como funcionar. A pessoa ficava presa.
  assert.equal(decidirSessao(base), "entrar-offline");
});

test("servidor RECUSOU: vai para o login, mesmo offline", () => {
  // O outro lado. Token invalido e invalido: deixar entrar aqui seria manter
  // no app alguem que o servidor acabou de recusar.
  assert.equal(
    decidirSessao({ ...base, origemDaFalha: "recusa" }),
    "login"
  );
});

test("sem rede e sem sessao nenhuma guardada: login", () => {
  assert.equal(
    decidirSessao({ ...base, sessaoLocalExpiraEm: null }),
    "login"
  );
});

test("sessao vencida ha menos que a graca ainda abre offline", () => {
  // O access token dura 1 hora. Sem esta regra, qualquer pessoa que ficasse
  // uma hora offline -- um voo curto -- perderia o app na mao.
  assert.equal(
    decidirSessao({
      ...base,
      sessaoLocalExpiraEm: AGORA - (DIAS_DE_GRACA_OFFLINE - 1) * DIA,
    }),
    "entrar-offline"
  );
});

test("sessao vencida ha mais que a graca: login", () => {
  assert.equal(
    decidirSessao({
      ...base,
      sessaoLocalExpiraEm: AGORA - (DIAS_DE_GRACA_OFFLINE + 1) * DIA,
    }),
    "login"
  );
});

test("exatamente no limite da graca ainda entra", () => {
  // A borda esta escrita como `> DIAS_DE_GRACA_OFFLINE`, e este teste e o que
  // segura isso: trocar por `>=` passaria despercebido em qualquer outro caso.
  assert.equal(
    decidirSessao({
      ...base,
      sessaoLocalExpiraEm: AGORA - DIAS_DE_GRACA_OFFLINE * DIA,
    }),
    "entrar-offline"
  );
});

test("relogio do aparelho adiantado nao vira caso separado", () => {
  // Data no futuro so deixa `diasVencida` mais negativo. Se a conta fosse
  // feita em valor absoluto, um celular com o fuso errado mandaria a pessoa
  // para o login sem motivo.
  assert.equal(
    decidirSessao({ ...base, sessaoLocalExpiraEm: AGORA + 400 * DIA }),
    "entrar-offline"
  );
});

// ---------------------------------------------------------------------------
// classificarFalhaDeAuth -- quem disse "nao"
// ---------------------------------------------------------------------------
// NOTA DA RODADA DE MUTACAO, para quem repetir o exercicio: apagar o ramo do
// `status === 0` ou o do `>= 500` NAO faz nenhum teste ficar vermelho. Isso
// nao e buraco de cobertura -- e que o default da funcao ja e "rede", entao os
// dois ramos sao redundantes por construcao e a resposta nao muda. Quem manda
// ali e o default, e ele TEM teste ("erro desconhecido cai para o lado que nao
// desloga"): trocar o default por "recusa" derruba a suite. Os ramos ficam
// escritos porque dizem em voz alta o que a funcao decide, e e mais facil
// discordar de uma linha que existe do que de uma que falta.
// ---------------------------------------------------------------------------

test("AuthRetryableFetchError e falha de rede", () => {
  assert.equal(
    classificarFalhaDeAuth({ name: "AuthRetryableFetchError", status: 0 }),
    "rede"
  );
});

test("sem erro e sem usuario e recusa, nao rede", () => {
  // Quem nunca logou cai aqui. Classificar como "rede" abriria o modo offline
  // para visitante -- so a casca, mas ainda assim errado.
  assert.equal(classificarFalhaDeAuth(null), "recusa");
  assert.equal(classificarFalhaDeAuth(undefined), "recusa");
});

test("401 e 403 sao recusa do servidor", () => {
  assert.equal(classificarFalhaDeAuth({ status: 401 }), "recusa");
  assert.equal(classificarFalhaDeAuth({ status: 403 }), "recusa");
});

test("o auth do Supabase fora do ar NAO desloga ninguem", () => {
  // Um 500 nao e a sessao da pessoa acabando. Tratar 5xx como recusa
  // transformaria dez minutos de instabilidade em logout de toda a base -- e
  // offline ninguem consegue logar de volta.
  assert.equal(classificarFalhaDeAuth({ status: 500 }), "rede");
  assert.equal(classificarFalhaDeAuth({ status: 503 }), "rede");
});

test("as tres mensagens de fetch cru, uma por motor de navegador", () => {
  // Chrome, Firefox e Safari dizem coisas diferentes para a MESMA falha, e so
  // a do Safari nao contem a palavra "fetch". Procurar so por "Failed to
  // fetch" deslogaria iPhone e nao deslogaria Android -- o defeito que parece
  // intermitente.
  assert.equal(classificarFalhaDeAuth({ message: "Failed to fetch" }), "rede");
  assert.equal(
    classificarFalhaDeAuth({ message: "NetworkError when attempting to fetch resource." }),
    "rede"
  );
  assert.equal(classificarFalhaDeAuth({ message: "Load failed" }), "rede");
});

test("erro desconhecido cai para o lado que nao desloga", () => {
  assert.equal(classificarFalhaDeAuth({ message: "algo inesperado" }), "rede");
});

// ---------------------------------------------------------------------------
// expiracaoEmMs
// ---------------------------------------------------------------------------

test("expires_at vem em SEGUNDOS e vira milissegundos", () => {
  // Sem a conversao, uma sessao de 2026 vira janeiro de 1970: toda sessao
  // apareceria vencida ha decadas, o modo offline nunca abriria, e o sintoma
  // seria exatamente o bug que ele veio consertar.
  const segundos = Math.floor(AGORA / 1000);
  assert.equal(expiracaoEmMs({ expires_at: segundos }), segundos * 1000);
});

test("sessao ausente ou sem expires_at devolve null", () => {
  assert.equal(expiracaoEmMs(null), null);
  assert.equal(expiracaoEmMs(undefined), null);
  assert.equal(expiracaoEmMs({}), null);
  assert.equal(expiracaoEmMs({ expires_at: null }), null);
});

test("a conversao de segundos importa DENTRO da decisao, nao so isolada", () => {
  // O teste acima passaria mesmo se `decidirSessao` recebesse segundos por
  // engano em algum ponto. Este amarra as duas pecas: uma sessao que vence
  // daqui a uma hora, lida do jeito que o Supabase entrega, tem que abrir o
  // app offline.
  const sessao = { expires_at: Math.floor((AGORA + 3_600_000) / 1000) };
  assert.equal(
    decidirSessao({ ...base, sessaoLocalExpiraEm: expiracaoEmMs(sessao) }),
    "entrar-offline"
  );
});
