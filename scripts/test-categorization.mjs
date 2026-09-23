#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DA CATEGORIZACAO AUTOMATICA
// =====================================================
//   npm run test:categorization
//
// Exercita lib/categorization.ts. O que este arquivo protege, em ordem de
// quanto custa errar:
//
//   1. A PENEIRA DO SINAL. Despesa e negativa neste banco. Uma regra de
//      "Alimentação" pegando o ESTORNO do iFood (um credito) faria o
//      lancamento nascer como despesa positiva -- nenhuma constraint reclama e
//      o relatorio de gastos passa a contar estorno como gasto.
//
//   2. O DESEMPATE POR TAMANHO. `uber eats` tem que ganhar de `uber`. Sem o
//      desempate quem decide e a ordem de iteracao do objeto, e a mesma
//      descricao cairia em categorias diferentes sem nada falhar.
//
//   3. REGRA VENCE CATALOGO. O catalogo e chute nosso; a regra e decisao do
//      usuario. Inverter isso faz o app desobedecer uma escolha explicita.
//
//   4. O CATALOGO SER ALCANCAVEL. Uma chave que nao sobrevive a propria
//      normalizacao nunca casa com nada. A falha e muda: o app so deixa de
//      sugerir. O teste de ponto fixo (abaixo) e o unico jeito de ver isso.
//
// Mesmo desenho do test-reports.mjs: .mjs rodando o JS que o tsc emitiu, com o
// passo de reescrita de alias no meio, sem runner de teste novo.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  sugerirCategoria,
  casaPorTokens,
  categoriaServeParaValor,
  chaveDaDescricao,
  regraQueCobre,
  CATALOGO_EMBUTIDO,
} = await import("../.tmp-categorization/categorization.js");

const { normalizeMerchant } = await import("../.tmp-categorization/recurrence-detector.js");

// ---------------------------------------------------------------------------
// As categorias do 001_baseline, com os ids reais do seed.
// ---------------------------------------------------------------------------
const ALIMENTACAO = { id: "b9db286c-ce4f-4fbe-b0bf-f3133185f90f", name: "Alimentação", isExpense: true };
const TRANSPORTE = { id: "49d97f81-6f07-4e6d-9822-75167b8426b2", name: "Transporte", isExpense: true };
const COMPRAS = { id: "ef656abf-50f0-4cd7-8e96-15cbe4eaac26", name: "Compras", isExpense: true };
const LAZER = { id: "57726de2-7a27-493b-b010-04814a7475c4", name: "Lazer", isExpense: true };
const SAUDE = { id: "c962941b-1aa5-4ae9-9103-d3e5ab8c98e5", name: "Saúde", isExpense: true };
const MORADIA = { id: "b61d7949-2abc-430d-9bd0-02a146c1d9d8", name: "Moradia", isExpense: true };
const EDUCACAO = { id: "7802239b-2617-4dc7-a79b-4830bcbda3b0", name: "Educação", isExpense: true };
const SERVICOS = { id: "499636db-7c96-4dae-a807-f95011b3ae8c", name: "Serviços", isExpense: true };
const SALARIO = { id: "d93a6d01-3b70-4c54-af08-e8b56b09fb9e", name: "Salário", isExpense: false };
const INVESTIMENTOS = { id: "8269d16f-f5c3-42c4-9ec8-dbcdcb823a61", name: "Investimentos", isExpense: false };

const CATEGORIAS = [
  ALIMENTACAO, TRANSPORTE, COMPRAS, LAZER, SAUDE,
  MORADIA, EDUCACAO, SERVICOS, SALARIO, INVESTIMENTOS,
];

const NOMES_DAS_CATEGORIAS = new Set(CATEGORIAS.map((c) => c.name));

function regra(merchantKey, categoria, extras = {}) {
  return {
    id: `regra-${merchantKey.replace(/\s/g, "-")}`,
    merchantKey,
    displayName: merchantKey,
    categoryId: categoria.id,
    isActive: true,
    ...extras,
  };
}

// ===========================================================================
// 1. O catalogo e alcancavel
// ===========================================================================

test("catalogo: toda chave e ponto fixo da normalizacao", () => {
  // Uma chave que normalizeMerchant() reescreveria nunca casa: a descricao
  // chega aqui JA normalizada, entao comparar com uma chave nao-normalizada e
  // comparar com algo que nunca vai existir do outro lado.
  //
  // O caso real: "ingresso com" parece uma chave razoavel e vira "ingresso" na
  // normalizacao, porque "com" esta em SUFIXOS_RUIDO. A chave ficaria morta no
  // catalogo sem nada falhar.
  const mortas = Object.keys(CATALOGO_EMBUTIDO).filter((k) => normalizeMerchant(k) !== k);

  assert.deepEqual(
    mortas,
    [],
    `Chaves do catalogo que a normalizacao reescreve (logo, nunca casam): ${mortas
      .map((k) => `"${k}" -> "${normalizeMerchant(k)}"`)
      .join(", ")}`
  );
});

test("catalogo: toda categoria apontada existe no seed do 001", () => {
  // Um nome com erro de digitacao ("Alimentacao" sem til) resolve para
  // undefined e a chave inteira para de sugerir, em silencio.
  const orfas = Object.entries(CATALOGO_EMBUTIDO)
    .filter(([, nome]) => !NOMES_DAS_CATEGORIAS.has(nome))
    .map(([chave, nome]) => `"${chave}" -> "${nome}"`);

  assert.deepEqual(orfas, [], `Catalogo aponta para categoria que nao existe: ${orfas.join(", ")}`);
});

// ===========================================================================
// 2. Descricoes reais de extrato
// ===========================================================================
// O formato e o mesmo do test-recurrence-detector: texto como o banco manda,
// nao como seria bonito.

const DESCRICOES_REAIS = [
  ["IFD*IFOOD 3947", -52.9, ALIMENTACAO],
  ["IFOOD *IFOOD SAO PAULO BR", -31.5, ALIMENTACAO],
  ["PAG*IFOOD", -78.2, ALIMENTACAO],
  ["UBER *TRIP SAO PAULO", -23.4, TRANSPORTE],
  ["UBER* TRIP", -18.9, TRANSPORTE],
  ["UBER *EATS SAO PAULO", -47.3, ALIMENTACAO],
  ["NETFLIX.COM*123", -39.9, LAZER],
  ["NETFLIX COM SAO PAULO BR", -39.9, LAZER],
  ["MP *SPOTIFY", -21.9, LAZER],
  ["SPOTIFY COM BR", -21.9, LAZER],
  ["PAG*SMARTFIT", -99.9, SAUDE],
  ["SMART FIT ESCOLA", -119.9, SAUDE],
  ["DROGARAIA 1234 SAO PAULO", -67.4, SAUDE],
  ["DROGASIL 442", -28.3, SAUDE],
  ["MERCADOLIVRE*4RTY", -159.9, COMPRAS],
  ["MERCADO LIVRE BRASIL", -89.0, COMPRAS],
  ["AMAZON BR SERVICOS", -210.5, COMPRAS],
  ["EBN*SHOPEE", -45.6, COMPRAS],
  ["ENEL DISTRIBUICAO SP", -187.3, MORADIA],
  ["SABESP 08/2026", -94.1, MORADIA],
  ["VIVO FIBRA 4429", -129.9, MORADIA],
  ["UDEMY ONLINE COURSES", -49.9, EDUCACAO],
  ["ALURA CURSOS ONLINE", -85.0, EDUCACAO],
  ["GOOGLE ONE 4429", -9.99, SERVICOS],
  ["ADOBE *CREATIVE CLOUD", -119.0, SERVICOS],
  ["POSTO IPIRANGA 221 BR", -280.0, TRANSPORTE],
  ["ESTAPAR ESTACIONAMENTO", -35.0, TRANSPORTE],
  ["CINEMARK SAO PAULO", -64.0, LAZER],
  ["PAG*LEROYMERLIN", -340.2, null], // "leroymerlin" colado: nao e "leroy merlin"
  ["SALARIO EMPRESA XPTO", 7200.0, SALARIO],
  ["RENDIMENTOS POUPANCA", 42.18, INVESTIMENTOS],
];

test("catalogo: descricoes reais de extrato caem na categoria certa", () => {
  for (const [descricao, valor, esperada] of DESCRICOES_REAIS) {
    const s = sugerirCategoria(descricao, valor, [], CATEGORIAS);

    if (esperada === null) {
      assert.equal(s, null, `"${descricao}" nao deveria ter sugestao (virou ${s?.categoryName})`);
      continue;
    }

    assert.ok(s, `"${descricao}" ficou sem sugestao (chave: "${normalizeMerchant(descricao)}")`);
    assert.equal(
      s.categoryName,
      esperada.name,
      `"${descricao}" -> ${s.categoryName}, esperava ${esperada.name}`
    );
    assert.equal(s.origin, "catalog");
  }
});

// ===========================================================================
// 3. O desempate por tamanho
// ===========================================================================

test("desempate: 'uber eats' ganha de 'uber' na mesma descricao", () => {
  // As duas chaves casam em "uber eats sao paulo". Se o desempate sumir, quem
  // decide e a ordem de iteracao do objeto -- e a linha de delivery vira
  // Transporte sem nada falhar.
  const s = sugerirCategoria("UBER *EATS SAO PAULO", -47.3, [], CATEGORIAS);
  assert.equal(s.categoryName, "Alimentação");
  assert.equal(s.matchedKey, "uber eats");
});

test("desempate: a regra mais especifica do usuario ganha da mais generica", () => {
  const regras = [regra("mercado", ALIMENTACAO), regra("mercado livre", COMPRAS)];
  const s = sugerirCategoria("MERCADO LIVRE BRASIL", -89.0, regras, CATEGORIAS);
  assert.equal(s.categoryName, "Compras");
  assert.equal(s.matchedKey, "mercado livre");
});

test("desempate: empate em tamanho e estavel, nao depende da ordem da lista", () => {
  // Duas regras de 1 token casando na mesma descricao. Nenhuma resposta e mais
  // certa; o que nao pode e a mesma descricao cair em categorias diferentes em
  // duas passadas.
  const a = [regra("alpha", COMPRAS), regra("beta", LAZER)];
  const b = [regra("beta", LAZER), regra("alpha", COMPRAS)];
  const desc = "ALPHA BETA LOJA";

  const s1 = sugerirCategoria(desc, -10, a, CATEGORIAS);
  const s2 = sugerirCategoria(desc, -10, b, CATEGORIAS);

  assert.equal(s1.categoryId, s2.categoryId, "a ordem da lista mudou a categoria");
  assert.equal(s1.matchedKey, "alpha", "o empate deveria ser resolvido em ordem alfabetica");
});

// ===========================================================================
// 4. Regra vence catalogo
// ===========================================================================

test("regra do usuario vence o catalogo embutido", () => {
  // O catalogo diz que iFood e Alimentação. O usuario discordou e disse
  // Compras (ele pede mercado por la). O app tem que obedecer.
  const s = sugerirCategoria("IFD*IFOOD 3947", -52.9, [regra("ifood", COMPRAS)], CATEGORIAS);
  assert.equal(s.categoryName, "Compras");
  assert.equal(s.origin, "rule");
  assert.equal(s.ruleId, "regra-ifood");
});

test("regra desligada nao casa, e a sugestao cai para o catalogo", () => {
  const desligada = [regra("ifood", COMPRAS, { isActive: false })];
  const s = sugerirCategoria("IFD*IFOOD 3947", -52.9, desligada, CATEGORIAS);
  assert.equal(s.origin, "catalog");
  assert.equal(s.categoryName, "Alimentação");
});

test("regra apontando para categoria inexistente nao vira sugestao quebrada", () => {
  // O FK da 014 e ON DELETE RESTRICT, entao isso nao deveria acontecer no
  // banco. Mas sugerir um id que nao existe faria a importacao falhar com erro
  // de chave estrangeira em vez de pedir a escolha ao usuario.
  const fantasma = [regra("ifood", { id: "id-que-nao-existe", name: "Sumida", isExpense: true })];
  const s = sugerirCategoria("IFD*IFOOD 3947", -52.9, fantasma, CATEGORIAS);
  assert.equal(s.origin, "catalog", "deveria ter caido para o catalogo");
  assert.equal(s.categoryName, "Alimentação");
});

// ===========================================================================
// 5. A peneira do sinal  -- o teste que mais importa
// ===========================================================================

test("sinal: categoria de despesa nao pega credito", () => {
  // O estorno do iFood chega POSITIVO. Sem a peneira ele nasceria como despesa
  // de valor positivo, e o relatorio de gastos contaria o estorno como gasto.
  const s = sugerirCategoria("IFD*IFOOD 3947", 52.9, [], CATEGORIAS);
  assert.equal(s, null, `estorno do iFood virou ${s?.categoryName}`);
});

test("sinal: categoria de despesa nao pega credito nem por regra do usuario", () => {
  const s = sugerirCategoria("IFD*IFOOD 3947", 52.9, [regra("ifood", ALIMENTACAO)], CATEGORIAS);
  assert.equal(s, null, "a regra do usuario furou a peneira do sinal");
});

test("sinal: categoria de receita nao pega debito", () => {
  const s = sugerirCategoria("SALARIO EMPRESA XPTO", -7200.0, [], CATEGORIAS);
  assert.equal(s, null);
});

test("sinal: valor zero e nao-numero nao viram sugestao", () => {
  // statement_entries tem CHECK (amount <> 0), entao zero nao chega pela
  // importacao. Mas se chegasse nao daria para dizer de que lado e.
  assert.equal(sugerirCategoria("NETFLIX.COM*123", 0, [], CATEGORIAS), null);
  assert.equal(sugerirCategoria("NETFLIX.COM*123", NaN, [], CATEGORIAS), null);
  assert.equal(categoriaServeParaValor(ALIMENTACAO, 0), false);
  assert.equal(categoriaServeParaValor(ALIMENTACAO, NaN), false);
});

test("sinal: regra que nao serve ao valor cai para o catalogo, nao para null", () => {
  // O usuario mandou Netflix para "Investimentos" (categoria de RECEITA) --
  // configuracao errada, mas possivel. A linha e uma despesa, entao a regra nao
  // serve; o catalogo tem Lazer, que serve.
  const s = sugerirCategoria("NETFLIX.COM*123", -39.9, [regra("netflix", INVESTIMENTOS)], CATEGORIAS);
  assert.equal(s.origin, "catalog");
  assert.equal(s.categoryName, "Lazer");
});

// ===========================================================================
// 6. Casamento por tokens
// ===========================================================================

test("casaPorTokens: exige sequencia, nao so presenca", () => {
  assert.equal(casaPorTokens("ifd ifood", "ifood"), true);
  assert.equal(casaPorTokens("uber trip sao paulo", "uber"), true);
  assert.equal(casaPorTokens("gol linhas aereas", "gol linhas aereas"), true);

  // Os tres tokens existem, mas fora de ordem: casar aqui seria acerto por
  // acidente.
  assert.equal(casaPorTokens("linhas de credito aereas gol", "gol linhas aereas"), false);

  // Token parcial nao conta: "net" nao casa em "netflix".
  assert.equal(casaPorTokens("netflix", "net"), false);

  // Agulha maior que o palheiro.
  assert.equal(casaPorTokens("uber", "uber eats"), false);
  assert.equal(casaPorTokens("uber", ""), false);
});

test("descricao que normaliza para vazio nao vira sugestao", () => {
  // normalizeMerchant devolve "" para descricao sem letra nem digito. Uma
  // chave vazia casaria com tudo -- e a migration 014 tem CHECK para impedir
  // que uma regra assim seja gravada.
  assert.equal(chaveDaDescricao("***"), "");
  assert.equal(sugerirCategoria("***", -10, [regra("ifood", ALIMENTACAO)], CATEGORIAS), null);
  assert.equal(sugerirCategoria("", -10, [], CATEGORIAS), null);
});

// ===========================================================================
// 7. O aprendizado nao duplica regra
// ===========================================================================

test("regraQueCobre encontra a regra existente sob outra variacao do lojista", () => {
  // Sem isto, importar "IFD*IFOOD 3947" e depois "PAG*IFOOD" criaria duas
  // regras para o mesmo lojista -- as duas certas, as duas na tela.
  const regras = [regra("ifood", ALIMENTACAO)];

  assert.equal(regraQueCobre("IFD*IFOOD 3947", regras)?.merchantKey, "ifood");
  assert.equal(regraQueCobre("PAG*IFOOD", regras)?.merchantKey, "ifood");
  assert.equal(regraQueCobre("UBER *TRIP", regras), null);
});

test("regraQueCobre ignora regra desligada", () => {
  // E o que faz o aprendizado NAO recriar a regra que o usuario acabou de
  // desligar... e tambem o que faz uma regra nova poder nascer no lugar dela.
  const regras = [regra("ifood", ALIMENTACAO, { isActive: false })];
  assert.equal(regraQueCobre("PAG*IFOOD", regras), null);
});

test("chaveDaDescricao e a mesma normalizacao do detector de assinaturas", () => {
  // Se as duas divergirem, a regra gravada por uma tela para de casar na
  // outra, e o sintoma e "a regra existe e nao funciona".
  for (const [descricao] of DESCRICOES_REAIS) {
    assert.equal(chaveDaDescricao(descricao), normalizeMerchant(descricao));
  }
});
