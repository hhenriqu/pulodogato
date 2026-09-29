#!/usr/bin/env node
// =====================================================
// PULODOGATO - orcamento de grupo: a barra da viagem (HMO-138)
// =====================================================
// `/api/budgets` devolve, numa lista so, o teto pessoal e o teto de cada grupo
// de que a pessoa participa -- e a RLS do 006 faz isso de proposito.
// `lib/orcamento-de-grupo.ts` separa os dois e soma cada viagem na sua propria
// barra.
//
// O que este arquivo cobra sao erros que a TELA NAO MOSTRA:
//
//   - a mistura. Somar a lista inteira num "ja gasto" da um numero que nao e
//     nem o meu (inclui o gasto dos outros membros da viagem) nem o da viagem
//     (inclui o meu mercado de casa), e que SOBE a cada membro novo do grupo.
//     Nao ha erro, nao ha cor diferente: so um total alto que a pessoa atribui
//     a ter gastado mesmo;
//   - duas viagens somadas numa barra so, que responde por um grupo que nao
//     existe;
//   - o teto de grupo cujo nome nao resolveu caindo no balde pessoal, que e a
//     mesma mistura entrando por outra porta;
//   - o total folgado escondendo um teto estourado dentro dele. Gastar o dobro
//     em restaurante e nada em hotel deixa a barra verde, e o teto por
//     categoria deixa de significar qualquer coisa;
//   - o residuo de ponto flutuante: "restam R$ 0,00" num orcamento fechado e um
//     estado que gasto nenhum resolve;
//   - e, no carry-forward, o par (categoria, grupo) virando so categoria: os
//     dois indices unicos do 006 sao separados de proposito, e com a chave
//     errada repetir o mes deixa de criar um dos dois tetos -- calado, e so no
//     mes seguinte.
//
// A prova de que o teste nao e uma fixture inocente esta em
// `scripts/mutantes-orcamento-de-grupo.mjs`, que quebra cada uma dessas
// decisoes no codigo e exige que a suite reprove.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const { separarOrcamentos, fraseDoRestante, GRUPO_SEM_NOME } = await import(
  "../.tmp-orcamento-de-grupo/orcamento-de-grupo.js"
);
const { linhasParaRepetir } = await import(
  "../.tmp-orcamento-de-grupo/services/budget.js"
);

// Fabrica de teto: so o que o modulo le. `spent` ja vem POSITIVO da view (a
// SECAO 5 do 006 aplica ABS porque despesa e gravada negativa neste banco);
// passar negativo aqui seria testar um dado que a view nao produz.
let seq = 0;
const teto = ({
  limite,
  gasto,
  status = "ok",
  grupo = null,
  nomeDoGrupo = undefined,
  categoria = "Mercado",
}) => ({
  id: `b${++seq}`,
  group_id: grupo,
  amount_limit: limite,
  spent: gasto,
  consumption_status: status,
  category: { name: categoria },
  group: grupo && nomeDoGrupo !== undefined ? { id: grupo, name: nomeDoGrupo } : null,
});

// ---------------------------------------------------------------------------
// A MISTURA: o teto de grupo nao entra na soma pessoal
// ---------------------------------------------------------------------------
test("o gasto da viagem nao entra no 'ja gasto' pessoal", () => {
  const { pessoal, pessoais, grupos } = separarOrcamentos([
    teto({ limite: 800, gasto: 200 }),
    teto({ limite: 5000, gasto: 4000, grupo: "g1", nomeDoGrupo: "Chile" }),
  ]);

  assert.equal(pessoal.limite, 800, "o teto pessoal somou o teto da viagem");
  assert.equal(pessoal.gasto, 200, "o gasto pessoal somou o gasto da viagem");
  assert.equal(pessoal.restante, 600);
  assert.equal(pessoais.length, 1);

  // E o contrario tambem: a viagem nao herda o mercado de casa.
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].limite, 5000);
  assert.equal(grupos[0].gasto, 4000);
});

test("sem teto de grupo nenhum, a soma pessoal continua sendo a lista toda", () => {
  const { pessoal, grupos } = separarOrcamentos([
    teto({ limite: 800, gasto: 200 }),
    teto({ limite: 300, gasto: 100 }),
  ]);

  assert.equal(pessoal.limite, 1100);
  assert.equal(pessoal.gasto, 300);
  assert.equal(grupos.length, 0);
});

test("duas viagens nao viram uma barra so", () => {
  const { grupos } = separarOrcamentos([
    teto({ limite: 1000, gasto: 500, grupo: "g1", nomeDoGrupo: "Chile" }),
    teto({ limite: 2000, gasto: 200, grupo: "g2", nomeDoGrupo: "Casa" }),
  ]);

  assert.equal(grupos.length, 2, "os dois grupos colapsaram em um");

  const chile = grupos.find((g) => g.group_id === "g1");
  const casa = grupos.find((g) => g.group_id === "g2");
  assert.equal(chile.limite, 1000);
  assert.equal(chile.gasto, 500);
  assert.equal(casa.limite, 2000);
  assert.equal(casa.gasto, 200);
});

test("varios tetos do MESMO grupo somam numa barra so", () => {
  const { grupos } = separarOrcamentos([
    teto({ limite: 1000, gasto: 500, grupo: "g1", nomeDoGrupo: "Chile" }),
    teto({ limite: 500, gasto: 100, grupo: "g1", nomeDoGrupo: "Chile", categoria: "Hotel" }),
  ]);

  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].limite, 1500);
  assert.equal(grupos[0].gasto, 600);
  assert.equal(grupos[0].orcamentos.length, 2);
});

// ---------------------------------------------------------------------------
// O NOME DO GRUPO NAO DECIDE NADA: quem separa e o group_id
// ---------------------------------------------------------------------------
test("teto de grupo sem nome resolvido continua sendo de grupo", () => {
  const { pessoais, grupos } = separarOrcamentos([
    teto({ limite: 900, gasto: 100, grupo: "g1" }),
  ]);

  assert.equal(pessoais.length, 0, "o teto da viagem caiu no balde pessoal");
  assert.equal(grupos.length, 1, "o teto da viagem sumiu da tela");
  assert.equal(grupos[0].group_name, GRUPO_SEM_NOME);
  assert.equal(grupos[0].limite, 900);
});

test("uma linha sem nome nao apaga o nome das outras do mesmo grupo", () => {
  const { grupos } = separarOrcamentos([
    teto({ limite: 100, gasto: 10, grupo: "g1" }),
    teto({ limite: 100, gasto: 10, grupo: "g1", nomeDoGrupo: "Chile" }),
  ]);

  assert.equal(grupos[0].group_name, "Chile");
});

// ---------------------------------------------------------------------------
// O STATUS DO TOTAL
// ---------------------------------------------------------------------------
test("um teto estourado dentro da viagem levanta o alerta mesmo com o total folgado", () => {
  const { grupos } = separarOrcamentos([
    teto({ limite: 1000, gasto: 100, grupo: "g1", nomeDoGrupo: "Chile", categoria: "Hotel" }),
    teto({
      limite: 100,
      gasto: 200,
      status: "exceeded",
      grupo: "g1",
      nomeDoGrupo: "Chile",
      categoria: "Restaurante",
    }),
  ]);

  // O total cabe: 300 de 1100. E mesmo assim a barra NAO pode sair verde.
  assert.equal(grupos[0].gasto, 300);
  assert.equal(grupos[0].limite, 1100);
  assert.notEqual(grupos[0].status, "ok", "o hotel que sobrou escondeu o restaurante que estourou");
  assert.equal(grupos[0].status, "alert");
});

test("o total que passou do teto e 'exceeded', mesmo com toda linha em 'ok'", () => {
  const { grupos } = separarOrcamentos([
    teto({ limite: 100, gasto: 90, grupo: "g1", nomeDoGrupo: "Chile" }),
    teto({ limite: 100, gasto: 90, grupo: "g1", nomeDoGrupo: "Chile", categoria: "Hotel" }),
  ]);

  // 180 de 200 nao estoura; este caso e o oposto -- o total cabe.
  assert.equal(grupos[0].status, "ok");

  const estourado = separarOrcamentos([
    teto({ limite: 100, gasto: 150, status: "exceeded", grupo: "g1", nomeDoGrupo: "Chile" }),
    teto({ limite: 100, gasto: 60, grupo: "g1", nomeDoGrupo: "Chile", categoria: "Hotel" }),
  ]).grupos[0];

  assert.equal(estourado.status, "exceeded");
});

test("gastar exatamente o teto ja e estouro", () => {
  const { grupos } = separarOrcamentos([
    teto({ limite: 100, gasto: 100, grupo: "g1", nomeDoGrupo: "Chile" }),
  ]);

  // Mesma regra da view (`>=`): "restam R$ 0,00" nao e folga.
  assert.equal(grupos[0].status, "exceeded");
  assert.equal(grupos[0].restante, 0);
});

// ---------------------------------------------------------------------------
// CENTAVOS INTEIROS
// ---------------------------------------------------------------------------
test("somar centavos nao deixa residuo de ponto flutuante", () => {
  // 0.1 + 0.2 em double da 0.30000000000000004: a soma crua faria a tela
  // mostrar um restante que nao fecha e que gasto nenhum zera.
  const { pessoal } = separarOrcamentos([
    teto({ limite: 1, gasto: 0.1 }),
    teto({ limite: 1, gasto: 0.2 }),
  ]);

  assert.equal(pessoal.gasto, 0.3);
  assert.equal(pessoal.restante, 1.7);
});

test("os numericos do PostgREST chegam como string e somam igual", () => {
  const { pessoal } = separarOrcamentos([
    teto({ limite: "800.00", gasto: "200.50" }),
    teto({ limite: "300.00", gasto: "99.50" }),
  ]);

  assert.equal(pessoal.limite, 1100);
  assert.equal(pessoal.gasto, 300);
  assert.equal(pessoal.restante, 800);
});

test("sem teto nenhum o percentual e zero, nao NaN", () => {
  const { pessoal } = separarOrcamentos([]);

  assert.equal(pessoal.ratio, 0);
  assert.equal(Number.isNaN(pessoal.ratio), false, "NaN faz a barra sumir sem erro no console");
  assert.equal(pessoal.limite, 0);
  assert.equal(pessoal.status, "ok");
});

test("o percentual sai com 4 casas, igual a view", () => {
  const { grupos } = separarOrcamentos([
    teto({ limite: 300, gasto: 100, grupo: "g1", nomeDoGrupo: "Chile" }),
  ]);

  assert.equal(grupos[0].ratio, 0.3333);
});

// ---------------------------------------------------------------------------
// A ORDEM, QUE TEM QUE SER DETERMINISTICA
// ---------------------------------------------------------------------------
test("a viagem mais apertada vem primeiro, e o empate desempata por id", () => {
  const linhas = [
    teto({ limite: 100, gasto: 50, grupo: "gb", nomeDoGrupo: "B" }),
    teto({ limite: 100, gasto: 90, grupo: "gc", nomeDoGrupo: "C" }),
    teto({ limite: 100, gasto: 50, grupo: "ga", nomeDoGrupo: "A" }),
  ];

  const ordem = separarOrcamentos(linhas).grupos.map((g) => g.group_id);
  assert.deepEqual(ordem, ["gc", "ga", "gb"]);

  // A ordem de chegada do banco nao e estavel; a da tela tem que ser.
  const invertida = separarOrcamentos([...linhas].reverse()).grupos.map((g) => g.group_id);
  assert.deepEqual(invertida, ordem, "a lista troca de posicao sozinha a cada refresh");
});

// ---------------------------------------------------------------------------
// A FRASE, que e a unica coisa que a pessoa le
// ---------------------------------------------------------------------------
test("restante negativo fala em estouro, e sem sinal de menos", () => {
  const frase = fraseDoRestante({ limite: 100, gasto: 130, restante: -30, ratio: 1.3, status: "exceeded" });

  assert.match(frase, /^Estourou/, "o estouro apareceu como sobra");
  assert.equal(frase.includes("-"), false, "o menos em 'estourou -R$ 30' se le como dois estouros");
  assert.match(frase, /30/);
});

test("restante positivo fala em sobra", () => {
  const frase = fraseDoRestante({ limite: 100, gasto: 30, restante: 70, ratio: 0.3, status: "ok" });

  assert.match(frase, /^Restam/);
  assert.match(frase, /70/);
});

// ---------------------------------------------------------------------------
// CARRY-FORWARD: a chave e o PAR (categoria, grupo)
// ---------------------------------------------------------------------------
const base = [
  { category_id: "cat-mercado", group_id: null, amount_limit: 800, alert_threshold: 0.8 },
  { category_id: "cat-mercado", group_id: "g1", amount_limit: 2000, alert_threshold: 0.8 },
];

test("o mercado pessoal e o mercado da viagem sao duas linhas, nao uma", () => {
  // Outubro ja tem o pessoal; o da viagem ainda falta.
  const linhas = linhasParaRepetir(
    base,
    [{ category_id: "cat-mercado", group_id: null }],
    "u1",
    "2026-10-01",
  );

  assert.equal(linhas.length, 1, "a chave so pela categoria descarta o teto da viagem");
  assert.equal(linhas[0].group_id, "g1");
  assert.equal(linhas[0].amount_limit, 2000);
  assert.equal(linhas[0].month, "2026-10-01");
  assert.equal(linhas[0].user_id, "u1");
  assert.equal(linhas[0].carry_forward, true);
});

test("o teto que OUTRO membro ja criou para o grupo nao e recriado", () => {
  // `existentes` chega sem filtro de user_id de proposito: o teto da viagem e
  // unico por (grupo, categoria, mes), nao por usuario. Repetir por cima bate
  // no indice, volta 23505, e o lote INTEIRO se perde em silencio.
  const linhas = linhasParaRepetir(
    base,
    [{ category_id: "cat-mercado", group_id: "g1" }],
    "u1",
    "2026-10-01",
  );

  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].group_id, null, "recriou o teto do grupo que ja existia");
});

test("mes destino ja completo nao repete nada", () => {
  const linhas = linhasParaRepetir(
    base,
    [
      { category_id: "cat-mercado", group_id: null },
      { category_id: "cat-mercado", group_id: "g1" },
    ],
    "u1",
    "2026-10-01",
  );

  assert.equal(linhas.length, 0);
});

test("mes destino vazio repete os dois", () => {
  const linhas = linhasParaRepetir(base, [], "u1", "2026-10-01");

  assert.equal(linhas.length, 2);
  // Sem `.sort()`: o default de Array.sort compara como STRING, e "g1" vem
  // antes de "null" -- a assercao passaria a falar de uma ordem que a funcao
  // nao promete.
  assert.equal(linhas.filter((l) => l.group_id === null).length, 1);
  assert.equal(linhas.filter((l) => l.group_id === "g1").length, 1);
});
