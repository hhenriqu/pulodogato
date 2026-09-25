// =====================================================
// TESTES DA DECISAO DO /auth/callback
// =====================================================
//   npm run test:auth-callback
// =====================================================
// O que estas assercoes protegem (HMO-157): o link de email e a unica peca do
// cadastro que este repositorio NAO controla inteira -- o template vive no
// dashboard do Supabase e pode mandar `code` ou `token_hash`, e pode voltar com
// erro. Cada um desses caminhos, errado, tem o mesmo sintoma: o usuario clica,
// cai no site e nao esta logado.
//
// O `next` tem teste proprio porque e um redirect aberto esperando acontecer: o
// valor vem do querystring de um link que chega por EMAIL.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  decidirCallback,
  caminhoSeguro,
  mensagemDeErro,
  DESTINO_PADRAO,
} from "../.tmp-auth-callback/auth-callback.js";

/** Atalho: querystring -> decisao. */
const decidir = (qs) => decidirCallback(new URLSearchParams(qs));

// ---------------------------------------------------------------------------
// O caminho normal do cadastro
// ---------------------------------------------------------------------------

test("code do PKCE vira troca por sessao, com destino padrao", () => {
  const acao = decidir("code=abc123");
  assert.equal(acao.kind, "code");
  assert.equal(acao.code, "abc123");
  assert.equal(acao.next, DESTINO_PADRAO);
});

test("token_hash + type vira verifyOtp -- o template novo do Supabase", () => {
  const acao = decidir("token_hash=hash-1&type=signup");
  assert.equal(acao.kind, "otp");
  assert.equal(acao.tokenHash, "hash-1");
  assert.equal(acao.type, "signup");
});

test("recovery chega com o next da tela de nova senha", () => {
  const acao = decidir("code=xyz&next=%2Freset-password");
  assert.equal(acao.kind, "code");
  assert.equal(acao.next, "/reset-password");
});

test("type fora da lista nao chega na biblioteca", () => {
  // `type` vai direto para `verifyOtp`. Aceitar qualquer string seria deixar
  // quem monta a URL escolher a operacao.
  const acao = decidir("token_hash=hash-1&type=delete_user");
  assert.equal(acao.kind, "erro");
});

test("token_hash sem type nao e suficiente", () => {
  assert.equal(decidir("token_hash=hash-1").kind, "erro");
});

test("callback sem parametro nenhum e erro, nao sessao vazia", () => {
  const acao = decidir("");
  assert.equal(acao.kind, "erro");
  assert.match(acao.mensagem, /incompleto/i);
});

// ---------------------------------------------------------------------------
// O erro que o Supabase devolve no querystring
// ---------------------------------------------------------------------------

test("link expirado e explicado em portugues, nao como otp_expired", () => {
  const acao = decidir(
    "error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"
  );
  assert.equal(acao.kind, "erro");
  assert.match(acao.mensagem, /expirou/i);
  assert.doesNotMatch(acao.mensagem, /otp_expired/);
});

test("erro ganha prioridade sobre um code que venha na mesma URL", () => {
  // O Supabase nao manda os dois juntos hoje. Se mandar, tentar a troca com um
  // code recusado gastaria o code e mostraria a mensagem crua da biblioteca.
  const acao = decidir("code=abc&error=access_denied&error_code=otp_expired");
  assert.equal(acao.kind, "erro");
});

test("erro desconhecido usa a descricao, com o + virando espaco", () => {
  const acao = decidir("error=server_error&error_description=Algo+deu+errado");
  assert.equal(acao.mensagem, "Algo deu errado");
});

test("erro sem descricao ainda diz algo utilizavel", () => {
  const acao = decidir("error=server_error");
  assert.equal(acao.kind, "erro");
  assert.ok(acao.mensagem.length > 10);
  assert.doesNotMatch(acao.mensagem, /undefined|null/);
});

// ---------------------------------------------------------------------------
// O `next`: redirect aberto num link que chega por email
// ---------------------------------------------------------------------------

test("next relativo passa", () => {
  assert.equal(caminhoSeguro("/dashboard/transactions"), "/dashboard/transactions");
  assert.equal(caminhoSeguro("/reset-password?x=1"), "/reset-password?x=1");
});

test("next ausente ou vazio cai no destino padrao", () => {
  assert.equal(caminhoSeguro(null), DESTINO_PADRAO);
  assert.equal(caminhoSeguro(undefined), DESTINO_PADRAO);
  assert.equal(caminhoSeguro(""), DESTINO_PADRAO);
});

test("URL absoluta para fora nao vira destino", () => {
  assert.equal(caminhoSeguro("https://exemplo-invasor.test/"), DESTINO_PADRAO);
  assert.equal(caminhoSeguro("http://exemplo-invasor.test/"), DESTINO_PADRAO);
});

test("protocolo-relativo e externo, mesmo comecando com barra", () => {
  // `//host` o browser resolve como outro host. E o caso que passa por uma
  // checagem ingenua de `startsWith("/")`.
  assert.equal(caminhoSeguro("//exemplo-invasor.test/"), DESTINO_PADRAO);
});

test("contrabarra tambem e externa -- o browser normaliza para barra", () => {
  assert.equal(caminhoSeguro("/\\exemplo-invasor.test/"), DESTINO_PADRAO);
  assert.equal(caminhoSeguro("\\\\exemplo-invasor.test/"), DESTINO_PADRAO);
});

test("caminho com CR/LF nao vira destino", () => {
  assert.equal(caminhoSeguro("/dashboard\r\nSet-Cookie: a=b"), DESTINO_PADRAO);
});

test("o next inseguro cai no padrao em vez de virar erro", () => {
  // A sessao ja e valida quando o next e lido: recusar o login por causa do
  // destino deixaria o usuario confirmado e de fora. Ignorar o destino, nao o
  // login.
  const acao = decidir("code=abc&next=https%3A%2F%2Fexemplo-invasor.test%2F");
  assert.equal(acao.kind, "code");
  assert.equal(acao.next, DESTINO_PADRAO);
});

// ---------------------------------------------------------------------------
// A traducao isolada
// ---------------------------------------------------------------------------

test("mensagemDeErro nao devolve string vazia para entrada vazia", () => {
  assert.ok(mensagemDeErro(null, null).length > 10);
  assert.ok(mensagemDeErro("", "   ").length > 10);
});
