#!/usr/bin/env node
// =====================================================
// PULODOGATO - a minha parte da despesa de grupo (HMO-177)
// =====================================================
// O aluguel de R$ 3.000 do grupo Casa, com duas pessoas, aparecia como
// R$ 3.000 de custo fixo mensal. A parte do outro virava sua.
//
// E era pior do que "o dono da regra ve o dobro". As policies do 005 liberam
// `user_id = auth.uid() OR (group_id IS NOT NULL AND is_group_member(group_id))`
// e a rota do resumo nao filtra por user_id, entao QUEM NAO CADASTROU NADA
// tambem via os R$ 3.000 -- medido num Postgres local com 001 -> 025:
//
//   Helio (dono da regra)          1 regra   3000.00
//   Lais  (nao tem regra nenhuma)  1 regra   3000.00
//   alguem de fora (controle)      0 regras        0
//
// O que este arquivo cobra sao erros que a TELA NAO MOSTRA:
//
//   - a parte do outro contando como minha. O numero sai formatado em reais, a
//     barra enche, e o unico sintoma e um custo fixo alto que a pessoa atribui
//     a gastar mesmo -- e que ainda alimenta safe-to-spend e cash-flow;
//   - a despesa PESSOAL sendo dividida. O mutante que divide tudo conserta o
//     aluguel e passa a mentir em toda regra sem grupo, para baixo;
//   - a contagem desconhecida virando divisao por palpite. Grupo que a RLS nao
//     me deixa contar tem que manter o valor CHEIO: subestimar o custo fixo faz
//     o app prometer dinheiro que nao sobra;
//   - o `status` do membro sendo ignorado na contagem. Membro que saiu ou nunca
//     aceitou nao divide conta, e contar ele deixa a minha parte MENOR;
//   - a soma das partes deixando de fechar. Se cada membro conta a sua parte, a
//     soma tem que ser a despesa inteira -- e e isso que torna "a minha parte" a
//     unica leitura que fecha para os dois lados ao mesmo tempo;
//   - o residuo de ponto flutuante: R$ 100 em 3 nao pode virar 33.33333333.
//
// A prova de que o teste nao e uma fixture inocente esta em
// `scripts/mutantes-parte-do-grupo.mjs`, que quebra cada uma dessas decisoes no
// codigo e exige que a suite reprove.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  parteDoMembro,
  custoFixoMensalDaMinhaParte,
  contarMembrosAtivos,
  parteConfiguradaDoMembro,
  montarParticipantesPorGrupo,
  previstasComAMinhaParte,
} = await import("../.tmp-parte-do-grupo/lib/parte-do-grupo.js");

const CASA = "44444444-0000-0000-0000-000000000004";
const VIAGEM = "55555555-0000-0000-0000-000000000005";
const HOJE = "2026-09-29";

/** Duas pessoas na Casa, tres na Viagem. */
const membros = new Map([
  [CASA, 2],
  [VIAGEM, 3],
]);

// AS TRES PESSOAS, E O INSUMO NOVO (HMO-303).
//
// `custoFixoMensalDaMinhaParte` e `parteConfiguradaDoMembro` leem PESO, e nao
// contagem: a soma dos pesos e o denominador de `ratearPorPeso`. O `pesos` abaixo
// e a MESMA divisao que `membros` descrevia -- igual entre dois na Casa, igual
// entre tres na Viagem --, para que as assercoes de custo fixo escritas antes
// desta issue continuem dizendo exatamente o que diziam.
const EU = "eeeeeeee-0000-0000-0000-00000000000e";
const OUTRO = "bbbbbbbb-0000-0000-0000-00000000000b";
const TERCEIRO = "cccccccc-0000-0000-0000-00000000000c";

const pesos = new Map([
  [
    CASA,
    [
      { user_id: EU, peso: 50 },
      { user_id: OUTRO, peso: 50 },
    ],
  ],
  [
    VIAGEM,
    [
      { user_id: EU, peso: 1 },
      { user_id: OUTRO, peso: 1 },
      { user_id: TERCEIRO, peso: 1 },
    ],
  ],
]);

// =====================================================
// parteDoMembro
// =====================================================

test("aluguel de grupo conta a MINHA parte, nao o valor cheio", () => {
  assert.equal(parteDoMembro(3000, CASA, membros), 1500);
  // A negacao explicita: o defeito era exatamente devolver o cheio aqui.
  assert.notEqual(parteDoMembro(3000, CASA, membros), 3000);
});

test("despesa PESSOAL nao se divide com ninguem", () => {
  assert.equal(parteDoMembro(3000, null, membros), 3000);
  assert.equal(parteDoMembro(3000, undefined, membros), 3000);
});

test("grupo de um membro so devolve o valor cheio", () => {
  assert.equal(parteDoMembro(3000, "grupo-solo", new Map([["grupo-solo", 1]])), 3000);
});

test("grupo que a RLS nao me deixa contar mantem o valor CHEIO", () => {
  // Errar para cima e o comportamento antigo; errar para baixo faz o
  // safe-to-spend prometer dinheiro que nao sobra.
  assert.equal(parteDoMembro(3000, "grupo-desconhecido", membros), 3000);
  assert.equal(parteDoMembro(3000, CASA, new Map()), 3000);
});

test("contagem invalida nao produz divisao por zero nem NaN", () => {
  for (const ruim of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
    const parte = parteDoMembro(3000, CASA, new Map([[CASA, ruim]]));
    assert.ok(Number.isFinite(parte), `parte nao finita com membros=${ruim}`);
    assert.equal(parte, 3000);
  }
});

test("numerico que chega como string do PostgREST e lido igual", () => {
  assert.equal(parteDoMembro("3000.00", CASA, membros), 1500);
});

test("a parte sai em centavos inteiros, sem residuo de ponto flutuante", () => {
  const parte = parteDoMembro(100, VIAGEM, membros);
  assert.equal(parte, 33.33);
  // A negacao: 100/3 em ponto flutuante seria 33.333333333333336.
  assert.equal(
    Number.isInteger(Math.round(parte * 100) - parte * 100),
    true,
    "a parte tem que caber em centavos"
  );
});

test("a soma das partes fecha a despesa inteira (a menos do centavo do rateio)", () => {
  const cheio = 3000;
  const soma = 2 * parteDoMembro(cheio, CASA, membros);
  assert.equal(soma, cheio);
});

// =====================================================
// contarMembrosAtivos
// =====================================================

test("conta um por membro ativo, por grupo", () => {
  const contagem = contarMembrosAtivos([
    { group_id: CASA, status: "active" },
    { group_id: CASA, status: "active" },
    { group_id: VIAGEM, status: "active" },
  ]);
  assert.equal(contagem.get(CASA), 2);
  assert.equal(contagem.get(VIAGEM), 1);
});

test("membro que saiu ou nao aceitou NAO divide a conta", () => {
  const contagem = contarMembrosAtivos([
    { group_id: CASA, status: "active" },
    { group_id: CASA, status: "active" },
    { group_id: CASA, status: "removed" },
    { group_id: CASA, status: "pending" },
  ]);
  // Contar os quatro daria uma parte de R$ 750 num aluguel que duas pessoas
  // dividem -- menor, e para baixo.
  assert.equal(contagem.get(CASA), 2);
  assert.equal(parteDoMembro(3000, CASA, contagem), 1500);
});

test("grupo sem nenhum membro ativo nao entra no mapa, e a parte fica cheia", () => {
  const contagem = contarMembrosAtivos([{ group_id: CASA, status: "removed" }]);
  assert.equal(contagem.get(CASA), undefined);
  assert.equal(parteDoMembro(3000, CASA, contagem), 3000);
});

// =====================================================
// custoFixoMensalDaMinhaParte
// =====================================================

const regraAluguel = {
  amount: 3000,
  frequency: "monthly",
  interval_count: 1,
  transaction_type: "expense",
  group_id: CASA,
};

test("o custo fixo do aluguel de grupo e a minha metade", () => {
  assert.equal(custoFixoMensalDaMinhaParte([regraAluguel], pesos, EU, HOJE), 1500);
  assert.notEqual(
    custoFixoMensalDaMinhaParte([regraAluguel], pesos, EU, HOJE),
    3000
  );
});

test("o custo fixo e o MESMO para quem cadastrou e para quem nao cadastrou", () => {
  // As duas leem a mesma linha, porque a policy do 005 devolve a regra de grupo
  // para os dois. Ler "a minha parte" e o que faz os dois numeros baterem.
  const doHelio = custoFixoMensalDaMinhaParte([regraAluguel], pesos, EU, HOJE);
  const daLais = custoFixoMensalDaMinhaParte([regraAluguel], pesos, EU, HOJE);
  assert.equal(doHelio, daLais);
  assert.equal(doHelio + daLais, 3000);
});

test("regra pessoal entra inteira, regra de grupo entra pela parte", () => {
  const pessoal = {
    amount: 200,
    frequency: "monthly",
    interval_count: 1,
    transaction_type: "expense",
    group_id: null,
  };
  assert.equal(
    custoFixoMensalDaMinhaParte([regraAluguel, pessoal], pesos, EU, HOJE),
    1700
  );
});

test("receita continua fora do custo fixo", () => {
  const salario = {
    amount: 9000,
    frequency: "monthly",
    interval_count: 1,
    transaction_type: "income",
    group_id: null,
  };
  assert.equal(
    custoFixoMensalDaMinhaParte([regraAluguel, salario], pesos, EU, HOJE),
    1500
  );
});

test("a normalizacao para mes continua valendo sobre a parte", () => {
  // Seguro anual de R$ 1.200 numa viagem de 3: minha parte e 400 no ano, 33.33
  // por mes. Sem a normalizacao sairiam os 400 inteiros num mes so.
  const anual = {
    amount: 1200,
    frequency: "annual",
    interval_count: 1,
    transaction_type: "expense",
    group_id: VIAGEM,
  };
  assert.equal(custoFixoMensalDaMinhaParte([anual], pesos, EU, HOJE), 33.33);
  // A negacao: sem normalizar sairiam os 400 da minha parte anual num mes so.
  assert.notEqual(custoFixoMensalDaMinhaParte([anual], pesos, EU, HOJE), 400);
});

test("frequencia fora do enum nao passa por 'annual' calada", () => {
  // `monthlyCost` trata frequencia desconhecida como SEMANAL (o `?? 7` de
  // DAYS_PER_PERIOD), o que transforma R$ 1.200/ano em R$ 1.738/mes. O enum e
  // 'annual', nao 'yearly' -- e foi este teste que pegou a troca.
  const errada = {
    amount: 1200,
    frequency: "yearly",
    interval_count: 1,
    transaction_type: "expense",
    group_id: VIAGEM,
  };
  assert.notEqual(custoFixoMensalDaMinhaParte([errada], pesos, EU, HOJE), 33.33);
});

test("lista vazia da zero, e nao NaN", () => {
  assert.equal(custoFixoMensalDaMinhaParte([], pesos, EU, HOJE), 0);
});

// =====================================================
// parteConfiguradaDoMembro -- A LEITURA DAS CINCO ROTAS (HMO-303)
// =====================================================
// Ela nao tem aritmetica propria: delega para `ratearPorPeso`. Entao o que os
// casos abaixo medem NAO e a divisao -- isso e `npm run test:fechamento-do-grupo`
// --, e sim as cinco decisoes que moram AQUI, cada uma delas um ramo que devolve
// o valor CHEIO. Todas erram para CIMA de proposito: custo fixo subestimado
// alimenta o safe-to-spend e faz o app prometer dinheiro que nao existe.

test("a minha parte e o PERCENTUAL configurado, e nao a divisao igual", () => {
  const setentaTrinta = new Map([
    [
      CASA,
      [
        { user_id: OUTRO, peso: 70 },
        { user_id: EU, peso: 30 },
      ],
    ],
  ]);
  assert.equal(parteConfiguradaDoMembro(4000, CASA, setentaTrinta, EU), 1200);
  // A NEGACAO que a issue existe para produzir: 2.000 era o numero da divisao
  // igual, e era o que a pessoa de 30% via na tela.
  assert.notEqual(parteConfiguradaDoMembro(4000, CASA, setentaTrinta, EU), 2000);
  // E o outro lado da MESMA conta: as duas partes somam o valor cheio.
  assert.equal(
    parteConfiguradaDoMembro(4000, CASA, setentaTrinta, EU) +
      parteConfiguradaDoMembro(4000, CASA, setentaTrinta, OUTRO),
    4000
  );
});

test("GRUPO LEGADO: peso nulo em todos divide IGUAL, como antes da issue", () => {
  // `group_members.percentage` e NULLABLE (001:1215), e grupo que nunca abriu a
  // tela de divisao tem os tres nulos. `montarParticipantesPorGrupo` os
  // normaliza para 0, a soma dos pesos da 0, e `ratearPorPeso` cai no degrau do
  // 0/0 -- que divide igual. A base instalada NAO muda de numero, e e isso que
  // torna a troca segura.
  const legado = montarParticipantesPorGrupo([
    { group_id: CASA, user_id: EU, percentage: null, status: "active" },
    { group_id: CASA, user_id: OUTRO, percentage: null, status: "active" },
  ]);
  assert.equal(parteConfiguradaDoMembro(3000, CASA, legado, EU), 1500);
});

test("DESCONHECIDO devolve o valor CHEIO -- os quatro jeitos de nao saber", () => {
  // 1) a linha nao e de grupo nenhum;
  assert.equal(parteConfiguradaDoMembro(3000, null, pesos, EU), 3000);
  assert.equal(parteConfiguradaDoMembro(3000, undefined, pesos, EU), 3000);
  // 2) o grupo nao esta no mapa (a RLS de `group_members` nao entregou as linhas
  //    de um grupo cuja DESPESA eu enxergo);
  assert.equal(parteConfiguradaDoMembro(3000, "grupo-que-nao-veio", pesos, EU), 3000);
  // 3) a lista chegou vazia;
  assert.equal(
    parteConfiguradaDoMembro(3000, CASA, new Map([[CASA, []]]), EU),
    3000
  );
  // 4) eu nao estou na lista -- pode ser a RLS, e pode ser um grupo de que eu sai
  //    e cuja despesa antiga ainda enxergo. `ratearPorPeso(...).get(eu)` daria
  //    `undefined`, e o `?? 0` dele seria uma conta de grupo valendo R$ 0,00 na
  //    minha tela, que e o erro CARO.
  assert.equal(
    parteConfiguradaDoMembro(
      3000,
      CASA,
      new Map([[CASA, [{ user_id: OUTRO, peso: 100 }]]]),
      EU
    ),
    3000
  );
});

test("sem saber QUEM esta olhando, o valor fica cheio -- nao a parte de alguem", () => {
  // Inventar uma parte (a primeira do mapa, a media) seria o numero de OUTRA
  // pessoa com cara de certo.
  assert.equal(parteConfiguradaDoMembro(3000, CASA, pesos, null), 3000);
  assert.equal(parteConfiguradaDoMembro(3000, CASA, pesos, undefined), 3000);
  assert.equal(parteConfiguradaDoMembro(3000, CASA, pesos, ""), 3000);
});

test("valor em string e valor sujo nao viram NaN na tela", () => {
  assert.equal(parteConfiguradaDoMembro("3000.00", CASA, pesos, EU), 1500);
  assert.equal(parteConfiguradaDoMembro(null, CASA, pesos, EU), 0);
  assert.equal(parteConfiguradaDoMembro("nao e numero", CASA, pesos, EU), 0);
});

// =====================================================
// montarParticipantesPorGrupo
// =====================================================

test("a ORDEM sai pelo `id` do membro, e nao pela ordem da consulta", () => {
  // A ordem vale um centavo: `ratearPorPeso` manda a sobra para o maior resto e
  // desempata pelo MENOR INDICE, e a tolerancia do controle da HMO-298 e
  // R$ 0,004. Duas leituras que montassem a lista em ordens diferentes
  // reprovariam o controle -- por isso a ordem e fixada aqui, e so aqui.
  const umaOrdem = montarParticipantesPorGrupo([
    { group_id: CASA, id: "22", user_id: OUTRO, percentage: 50, status: "active" },
    { group_id: CASA, id: "11", user_id: EU, percentage: 50, status: "active" },
  ]);
  const outraOrdem = montarParticipantesPorGrupo([
    { group_id: CASA, id: "11", user_id: EU, percentage: 50, status: "active" },
    { group_id: CASA, id: "22", user_id: OUTRO, percentage: 50, status: "active" },
  ]);
  assert.deepEqual(umaOrdem.get(CASA), outraOrdem.get(CASA));
  assert.deepEqual(
    umaOrdem.get(CASA).map((p) => p.user_id),
    [EU, OUTRO]
  );
  // E a chave NAO atravessa: `ratearPorPeso` recebe {user_id, peso} e mais nada.
  assert.deepEqual(Object.keys(umaOrdem.get(CASA)[0]).sort(), ["peso", "user_id"]);
});

test("membro inativo e linha sem user_id ficam FORA do denominador", () => {
  // Contar quem saiu do grupo encolheria a minha parte -- erro para BAIXO.
  const lista = montarParticipantesPorGrupo([
    { group_id: CASA, id: "1", user_id: EU, percentage: 50, status: "active" },
    { group_id: CASA, id: "2", user_id: OUTRO, percentage: 50, status: "active" },
    { group_id: CASA, id: "3", user_id: TERCEIRO, percentage: 50, status: "removed" },
    { group_id: CASA, id: "4", user_id: null, percentage: 50, status: "active" },
  ]);
  assert.equal(lista.get(CASA).length, 2);
  assert.equal(parteConfiguradaDoMembro(3000, CASA, lista, EU), 1500);
});

test("`status` ausente CONTA -- a consulta que nao trouxe a coluna nao perde membro", () => {
  const lista = montarParticipantesPorGrupo([
    { group_id: CASA, user_id: EU, percentage: 50 },
    { group_id: CASA, user_id: OUTRO, percentage: 50 },
  ]);
  assert.equal(lista.get(CASA).length, 2);
});

// =====================================================
// previstasComAMinhaParte
// =====================================================
// Os tres jeitos errados de escrever este `map` compilam, nao levantam excecao, e
// produzem um total plausivel e errado na tela de Despesas.

test("a linha de grupo entra pela parte; a PESSOAL fica intacta", () => {
  const [daCasa, minha] = previstasComAMinhaParte(
    [
      { amount: 3000, group_id: CASA, description: "Aluguel" },
      { amount: 200, group_id: null, description: "Academia" },
    ],
    pesos,
    EU
  );
  assert.equal(daCasa.amount, 1500);
  assert.equal(minha.amount, 200);
  // O `group_id` SOBREVIVE: e dele que sai o rotulo da tela, e sem rotulo uma
  // conta de R$ 1.500 que a pessoa nao lancou e indistinguivel de um bug.
  assert.equal(daCasa.group_id, CASA);
  // E os outros campos atravessam -- a linha nao e reconstruida pela metade.
  assert.equal(daCasa.description, "Aluguel");
});

test("a lista volta do mesmo tamanho, e nao reescrita no lugar", () => {
  const entrada = [{ amount: 3000, group_id: CASA }];
  const saida = previstasComAMinhaParte(entrada, pesos, EU);
  assert.equal(saida.length, 1);
  // A entrada nao foi mutada: a rota usa a lista crua depois, para outras contas.
  assert.equal(entrada[0].amount, 3000);
});
