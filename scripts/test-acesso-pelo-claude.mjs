#!/usr/bin/env node
// =====================================================
// PULODOGATO - acesso pelo Claude (servidor MCP): as regras puras
// =====================================================
// O token, o pacote assinado que serve de client_id e de codigo do OAuth, o
// PKCE, os enderecos de retorno aceitos, achar conta/categoria pelo nome, o
// valor digitado na conversa e o destino do login sem redirecionamento aberto.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  abrirPacote,
  acharPorNome,
  assinarPacote,
  dataValida,
  enderecoDeRetornoAceito,
  fraseDoNaoAchado,
  hashDoToken,
  hojeEmSaoPaulo,
  nomeDoCliente,
  novoToken,
  pareceToken,
  pkceConfere,
  prefixoVisivel,
  segredoDasAssinaturas,
  tokenDoCabecalho,
  valorEmReais,
} from "../.tmp-acesso-pelo-claude/acesso-pelo-claude.js";
import { destinoDepoisDoLogin } from "../.tmp-acesso-pelo-claude/destino-do-login.js";

test("token: formato, hash SHA-256 e prefixo visivel", () => {
  const t = novoToken();
  assert.ok(pareceToken(t), t);
  assert.notEqual(novoToken(), t, "dois tokens seguidos nao podem ser iguais");
  assert.match(hashDoToken(t), /^[0-9a-f]{64}$/, "cabe no CHECK da 085");
  assert.equal(hashDoToken(t), createHash("sha256").update(t).digest("hex"));
  assert.equal(prefixoVisivel(t), t.slice(0, 10));
  assert.ok(!prefixoVisivel(t).includes(t.slice(10)), "o prefixo nao entrega o token");
});

test("token: so Bearer com cara de token nosso passa do cabecalho", () => {
  const t = novoToken();
  assert.equal(tokenDoCabecalho(`Bearer ${t}`), t);
  assert.equal(tokenDoCabecalho(`bearer ${t}`), t);
  assert.equal(tokenDoCabecalho(t), null, "sem 'Bearer'");
  assert.equal(tokenDoCabecalho("Bearer eyJhbGciOi.jwt.qualquer"), null, "JWT do Supabase nao e token do MCP");
  assert.equal(tokenDoCabecalho(null), null);
  assert.equal(tokenDoCabecalho(`Bearer ${t}x`), null, "tamanho errado");
});

test("pacote assinado: ida e volta, adulteracao, segredo errado e validade", () => {
  const segredo = segredoDasAssinaturas("chave-de-servico");
  const p = assinarPacote({ t: "cliente", nome: "Claude", retornos: ["https://claude.ai/cb"] }, segredo);
  assert.deepEqual(abrirPacote(p, segredo), { t: "cliente", nome: "Claude", retornos: ["https://claude.ai/cb"] });

  const [corpo, assinatura] = p.split(".");
  const forjado = Buffer.from(JSON.stringify({ t: "cliente", nome: "X", retornos: ["https://mau.site/cb"] })).toString("base64url");
  assert.equal(abrirPacote(`${forjado}.${assinatura}`, segredo), null, "corpo trocado");
  assert.equal(abrirPacote(`${corpo}.${assinatura.slice(1)}`, segredo), null, "assinatura cortada");
  assert.equal(abrirPacote(p, segredoDasAssinaturas("outra-chave")), null, "segredo de outro ambiente");
  assert.equal(abrirPacote("lixo", segredo), null);
  assert.equal(abrirPacote(undefined, segredo), null);

  const agora = 1_800_000_000;
  const codigo = assinarPacote({ t: "codigo", exp: agora + 300 }, segredo);
  assert.ok(abrirPacote(codigo, segredo, agora), "dentro dos 5 minutos");
  assert.equal(abrirPacote(codigo, segredo, agora + 301), null, "expirado");
});

test("segredo das assinaturas: derivado, nao a propria chave", () => {
  const s = segredoDasAssinaturas("minha-service-role");
  assert.match(s, /^[0-9a-f]{64}$/);
  assert.ok(!s.includes("minha-service-role"));
  assert.equal(s, segredoDasAssinaturas("minha-service-role"), "estavel entre instancias");
});

test("PKCE S256: o vetor do RFC 7636 e as recusas", () => {
  const verificador = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const desafio = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
  assert.ok(pkceConfere(verificador, desafio));
  assert.ok(!pkceConfere(verificador.replace("d", "e"), desafio), "verificador errado");
  assert.ok(!pkceConfere(desafio, desafio), "'plain' nao vale");
  assert.ok(!pkceConfere("curto", desafio), "verificador curto demais");
});

test("enderecos de retorno: https, ou http so em localhost", () => {
  assert.ok(enderecoDeRetornoAceito("https://claude.ai/api/mcp/auth_callback"));
  assert.ok(enderecoDeRetornoAceito("https://claude.com/api/mcp/auth_callback"));
  assert.ok(enderecoDeRetornoAceito("http://localhost:33418/callback"));
  assert.ok(enderecoDeRetornoAceito("http://127.0.0.1:6274/oauth/callback"));
  assert.ok(!enderecoDeRetornoAceito("http://claude.ai/cb"), "http fora de localhost");
  assert.ok(!enderecoDeRetornoAceito("javascript:alert(1)"));
  assert.ok(!enderecoDeRetornoAceito("https://claude.ai/cb#frag"));
  assert.ok(!enderecoDeRetornoAceito("https://user:senha@claude.ai/cb"));
  assert.ok(!enderecoDeRetornoAceito("nao e url"));
});

test("nome do cliente: limpo e no tamanho da coluna", () => {
  assert.equal(nomeDoCliente("  Claude   Desktop "), "Claude Desktop");
  assert.equal(nomeDoCliente(""), "Claude");
  assert.equal(nomeDoCliente(42), "Claude");
  assert.equal(nomeDoCliente("x".repeat(200)).length, 80);
});

test("achar pelo nome: id, exato sem acento, contem, e ambiguidade", () => {
  const contas = [
    { id: "1", nome: "Cartão Nubank" },
    { id: "2", nome: "Nubank" },
    { id: "3", nome: "Itaú Corrente" },
    { id: "4", nome: "Cartão Itaú" },
  ];
  assert.equal(acharPorNome(contas, "3").item?.id, "3", "pelo id");
  assert.equal(acharPorNome(contas, "nubank").item?.id, "2", "exato ganha de 'contem'");
  assert.equal(acharPorNome(contas, "cartao nubank").item?.id, "1", "sem acento e caixa");
  assert.equal(acharPorNome(contas, "corrente").item?.id, "3", "contem, unico");

  const ambiguo = acharPorNome(contas, "itau");
  assert.equal(ambiguo.ok, false);
  assert.equal(ambiguo.motivo, "varios");
  assert.deepEqual(ambiguo.candidatos.map((c) => c.id), ["3", "4"]);
  assert.match(fraseDoNaoAchado("conta", "itau", ambiguo), /mais de um.*"Itaú Corrente", "Cartão Itaú"/);

  const nenhum = acharPorNome(contas, "Bradesco");
  assert.equal(nenhum.motivo, "nenhum");
  assert.match(fraseDoNaoAchado("conta", "Bradesco", nenhum), /Não achei conta "Bradesco"/);
  assert.equal(acharPorNome(contas, "   ").ok, false, "vazio nao acha nada");
});

test("valor da conversa: numero ou texto brasileiro, sempre positivo", () => {
  assert.equal(valorEmReais(49.9), 49.9);
  assert.equal(valorEmReais("49,90"), 49.9);
  assert.equal(valorEmReais("R$ 1.234,56"), 1234.56);
  assert.equal(valorEmReais("1234.56"), 1234.56);
  assert.equal(valorEmReais(10.005), 10.01, "arredonda em centavos");
  assert.equal(valorEmReais(-50), null, "o sinal e do tipo, nao do numero");
  assert.equal(valorEmReais(0), null);
  assert.equal(valorEmReais("abc"), null);
  assert.equal(valorEmReais(null), null);
});

test("datas: AAAA-MM-DD que existe, e hoje no fuso de Sao Paulo", () => {
  assert.ok(dataValida("2026-11-07"));
  assert.ok(!dataValida("2026-02-30"));
  assert.ok(!dataValida("07/11/2026"));
  // 02:00 UTC do dia 8 ainda e dia 7 em Sao Paulo (UTC-3).
  assert.equal(hojeEmSaoPaulo(new Date("2026-11-08T02:00:00Z")), "2026-11-07");
  assert.equal(hojeEmSaoPaulo(new Date("2026-11-08T03:00:00Z")), "2026-11-08");
});

test("login: ?next= so leva para dentro do app", () => {
  assert.equal(destinoDepoisDoLogin("/conectar-claude?client_id=x"), "/conectar-claude?client_id=x");
  assert.equal(destinoDepoisDoLogin(null), "/dashboard");
  assert.equal(destinoDepoisDoLogin("https://mau.site"), "/dashboard");
  assert.equal(destinoDepoisDoLogin("//mau.site/x"), "/dashboard");
  assert.equal(destinoDepoisDoLogin("/\\mau.site"), "/dashboard");
});
