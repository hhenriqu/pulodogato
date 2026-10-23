// Testes de lib/vinculo-da-prevista.ts -- a despesa contada duas vezes.
//
// O caso de producao (22/10/2026): Aluguel R$ 2.000, Condominio R$ 295 e IPTU
// R$ 185,41 do grupo Casa lancados a mao em 09/10, com as contas previstas
// vencendo em 10/10 e continuando `pending`. As fixtures abaixo sao esse caso.
//
// O QUE ESTE ARQUIVO PRENDE
// -------------------------
//   1. a regra da SUGESTAO (`previstaCorresponde`): valor +-1%, vencimento +-7
//      dias, mesma categoria ou descricao normalizada -- e cada borda;
//   2. a regra do VINCULO explicito (`problemaDoVinculo`): mesmo dono, mesma
//      direcao, sem outro vinculo, ate um mes do vencimento, e fatura/
//      transferencia fora;
//   3. a sugestao e SUBCONJUNTO do vinculo: nunca sugerir um par que o "Sim"
//      recusaria;
//   4. a ordem da sugestao e do seletor.

import test from "node:test";
import assert from "node:assert/strict";

const {
  JANELA_DO_VINCULO,
  direcaoDoLancamento,
  lancamentosParaEscolher,
  mensagemDoVinculo,
  previstaCorresponde,
  previstasCorrespondentes,
  problemaDoVinculo,
} = await import("../.tmp-vinculo-da-prevista/vinculo-da-prevista.js");

const HELIO = "2a1107d1-81fe-45d3-bd16-ed5dad884285";
const LAIS = "241dda5c-22c6-44f6-91e8-69d5e1fea3a2";
const MORADIA = "cat-moradia";

const aluguelPrevisto = {
  id: "7b2f5b47",
  user_id: HELIO,
  status: "pending",
  amount: "2000.00",
  due_date: "2026-10-10",
  direction: "expense",
  category_id: MORADIA,
  description: "Aluguel",
  notes: null,
};

const aluguelLancado = {
  id: "c1697eb6",
  user_id: HELIO,
  amount: "-2000.00",
  transaction_date: "2026-10-09",
  transaction_type: "expense",
  category_id: MORADIA,
  description: "Aluguel",
};

const semVinculo = { vinculadoA: null };

// ---------------------------------------------------------------------------
// 1. A regra da sugestao
// ---------------------------------------------------------------------------

test("o caso de producao: o aluguel lancado em 09/10 corresponde a prevista de 10/10", () => {
  assert.equal(previstaCorresponde(aluguelPrevisto, aluguelLancado), true);
});

test("valor dentro de 1% corresponde; fora, nao", () => {
  // 1% de 2000,00 = 20,00
  assert.equal(
    previstaCorresponde(aluguelPrevisto, { ...aluguelLancado, amount: "-2020.00" }),
    true
  );
  assert.equal(
    previstaCorresponde(aluguelPrevisto, { ...aluguelLancado, amount: "-1980.00" }),
    true
  );
  assert.equal(
    previstaCorresponde(aluguelPrevisto, { ...aluguelLancado, amount: "-2020.01" }),
    false
  );
});

test("a tolerancia e em centavos: o IPTU de R$ 185,41 nao arredonda para cima", () => {
  const iptu = { ...aluguelPrevisto, id: "55250038", amount: "185.41", description: "IPTU" };
  const lancado = { ...aluguelLancado, id: "61c58297", amount: "-185.41", description: "IPTU" };
  assert.equal(previstaCorresponde(iptu, lancado), true);
  // 1% de 185,41 = 1,85 (centavos inteiros); 187,27 passa do limite.
  assert.equal(previstaCorresponde(iptu, { ...lancado, amount: "-187.26" }), true);
  assert.equal(previstaCorresponde(iptu, { ...lancado, amount: "-187.27" }), false);
});

test("vencimento a 7 dias corresponde; a 8, nao", () => {
  assert.equal(
    previstaCorresponde(aluguelPrevisto, { ...aluguelLancado, transaction_date: "2026-10-03" }),
    true
  );
  assert.equal(
    previstaCorresponde(aluguelPrevisto, { ...aluguelLancado, transaction_date: "2026-10-17" }),
    true
  );
  assert.equal(
    previstaCorresponde(aluguelPrevisto, { ...aluguelLancado, transaction_date: "2026-10-02" }),
    false
  );
});

test("mesma categoria com descricao diferente corresponde", () => {
  assert.equal(
    previstaCorresponde(aluguelPrevisto, { ...aluguelLancado, description: "Pix imobiliaria" }),
    true
  );
});

test("descricao normalizada igual com categoria diferente corresponde", () => {
  assert.equal(
    previstaCorresponde(aluguelPrevisto, {
      ...aluguelLancado,
      category_id: "outra",
      description: "  ALUGUEL ",
    }),
    true
  );
});

test("so valor e data NAO bastam: o mercado de R$ 295 nao e o condominio", () => {
  const condominio = {
    ...aluguelPrevisto,
    id: "b68b44a3",
    amount: "295.00",
    description: "Condominio",
  };
  const mercado = {
    ...aluguelLancado,
    id: "m1",
    amount: "-295.00",
    category_id: "cat-mercado",
    description: "Supermercado",
  };
  assert.equal(previstaCorresponde(condominio, mercado), false);
});

test("prevista sem categoria e sem descricao nao casa por vazio", () => {
  const vazia = { ...aluguelPrevisto, category_id: null, description: "" };
  assert.equal(
    previstaCorresponde(vazia, { ...aluguelLancado, category_id: null, description: "" }),
    false
  );
});

// ---------------------------------------------------------------------------
// 2. A regra do vinculo explicito
// ---------------------------------------------------------------------------

test("o vinculo do caso de producao e aceito", () => {
  assert.equal(
    problemaDoVinculo({ prevista: aluguelPrevisto, lancamento: aluguelLancado, ...semVinculo }),
    null
  );
});

test("lancamento de OUTRO membro do grupo e recusado", () => {
  assert.equal(
    problemaDoVinculo({
      prevista: aluguelPrevisto,
      lancamento: { ...aluguelLancado, user_id: LAIS },
      ...semVinculo,
    }),
    "lancamento_de_outro"
  );
});

test("prevista que nao esta pendente e recusada", () => {
  for (const status of ["paid", "skipped", "cancelled"]) {
    assert.equal(
      problemaDoVinculo({
        prevista: { ...aluguelPrevisto, status },
        lancamento: aluguelLancado,
        ...semVinculo,
      }),
      "prevista_nao_pendente",
      status
    );
  }
});

test("direcao diferente e recusada: receita nao quita conta a pagar", () => {
  assert.equal(
    problemaDoVinculo({
      prevista: aluguelPrevisto,
      lancamento: { ...aluguelLancado, amount: "2000.00", transaction_type: "income" },
      ...semVinculo,
    }),
    "direcao_diferente"
  );
});

test("lancamento ja vinculado a OUTRA prevista e recusado; a mesma, nao", () => {
  assert.equal(
    problemaDoVinculo({
      prevista: aluguelPrevisto,
      lancamento: aluguelLancado,
      vinculadoA: "outra-prevista",
    }),
    "ja_vinculado"
  );
  // A prevista ja paga cai antes, em `prevista_nao_pendente`. Aqui so importa
  // que o proprio id nao conta como "outra".
  assert.equal(
    problemaDoVinculo({
      prevista: aluguelPrevisto,
      lancamento: aluguelLancado,
      vinculadoA: aluguelPrevisto.id,
    }),
    null
  );
});

test("a janela do vinculo explicito e de um mes para cada lado", () => {
  assert.equal(JANELA_DO_VINCULO, 31);
  const em = (data) =>
    problemaDoVinculo({
      prevista: aluguelPrevisto,
      lancamento: { ...aluguelLancado, transaction_date: data },
      ...semVinculo,
    });
  assert.equal(em("2026-09-09"), null); // 31 dias antes
  assert.equal(em("2026-11-10"), null); // 31 dias depois
  assert.equal(em("2026-09-08"), "fora_da_janela");
  assert.equal(em("2026-11-11"), "fora_da_janela");
});

test("fatura de cartao, parcela do MyBank e transferencia prevista ficam fora", () => {
  const casos = [
    { ...aluguelPrevisto, notes: "fatura:2026-10-01:0b8e7c1e-0000-0000-0000-000000000001" },
    { ...aluguelPrevisto, notes: "mybank:0b8e7c1e-0000-0000-0000-000000000002" },
    { ...aluguelPrevisto, direction: "transfer" },
  ];
  for (const prevista of casos) {
    assert.equal(
      problemaDoVinculo({ prevista, lancamento: aluguelLancado, ...semVinculo }),
      "prevista_de_transferencia",
      prevista.notes ?? prevista.direction
    );
  }
});

test("lancamento de transferencia nao quita prevista", () => {
  assert.equal(
    problemaDoVinculo({
      prevista: aluguelPrevisto,
      lancamento: { ...aluguelLancado, transaction_type: "transfer" },
      ...semVinculo,
    }),
    "lancamento_de_transferencia"
  );
});

test("a direcao do lancamento sem transaction_type sai do sinal", () => {
  assert.equal(direcaoDoLancamento({ amount: "-10", transaction_type: null }), "expense");
  assert.equal(direcaoDoLancamento({ amount: "10", transaction_type: null }), "income");
  // O tipo gravado manda sobre o sinal.
  assert.equal(direcaoDoLancamento({ amount: "10", transaction_type: "expense" }), "expense");
});

test("todo problema tem mensagem", () => {
  for (const p of [
    "prevista_nao_pendente",
    "prevista_de_transferencia",
    "lancamento_de_outro",
    "lancamento_de_transferencia",
    "direcao_diferente",
    "ja_vinculado",
    "fora_da_janela",
  ]) {
    assert.ok(mensagemDoVinculo(p).length > 10, p);
  }
});

// ---------------------------------------------------------------------------
// 3. A sugestao e subconjunto do vinculo
// ---------------------------------------------------------------------------

test("nada que a sugestao reconhece e recusado pelo vinculo", () => {
  const variacoes = [];
  for (const user_id of [HELIO, LAIS]) {
    for (const transaction_type of ["expense", "income", "transfer", null]) {
      for (const transaction_date of ["2026-10-01", "2026-10-09", "2026-10-17", "2026-11-30"]) {
        for (const amount of ["-2000.00", "2000.00", "-2010.00", "-2500.00"]) {
          variacoes.push({ ...aluguelLancado, user_id, transaction_type, transaction_date, amount });
        }
      }
    }
  }
  const previstas = [
    aluguelPrevisto,
    { ...aluguelPrevisto, status: "paid" },
    { ...aluguelPrevisto, direction: "income" },
    { ...aluguelPrevisto, notes: "mybank:abc" },
  ];
  let sugeridos = 0;
  for (const prevista of previstas) {
    for (const lancamento of variacoes) {
      if (previstaCorresponde(prevista, lancamento)) {
        sugeridos += 1;
        assert.equal(
          problemaDoVinculo({ prevista, lancamento, vinculadoA: null }),
          null,
          JSON.stringify({ prevista, lancamento })
        );
      }
    }
  }
  // Controle positivo: a varredura sugeriu alguma coisa, entao a assercao de
  // dentro do laco rodou.
  assert.ok(sugeridos > 0);
});

// ---------------------------------------------------------------------------
// 4. A ordem
// ---------------------------------------------------------------------------

test("as tres previstas de outubro, para um lancamento so, voltam so a dele", () => {
  const previstas = [
    aluguelPrevisto,
    { ...aluguelPrevisto, id: "b68b44a3", amount: "295.00", description: "Condominio", category_id: "cat-condominio" },
    { ...aluguelPrevisto, id: "55250038", amount: "185.41", description: "IPTU", category_id: "cat-iptu" },
  ];
  const condominio = {
    ...aluguelLancado,
    id: "6ea5f19e",
    amount: "-295.00",
    description: "Condominio",
    category_id: "cat-condominio",
  };
  assert.deepEqual(
    previstasCorrespondentes(previstas, condominio).map((p) => p.id),
    ["b68b44a3"]
  );
});

test("duas previstas parecidas: a de vencimento mais perto vem primeiro", () => {
  const setembro = { ...aluguelPrevisto, id: "set", due_date: "2026-10-03" };
  const outubro = { ...aluguelPrevisto, id: "out", due_date: "2026-10-10" };
  assert.deepEqual(
    previstasCorrespondentes([setembro, outubro], aluguelLancado).map((p) => p.id),
    ["out", "set"]
  );
});

test("o seletor da agenda: sugeridos primeiro, recusados fora, ja vinculados fora", () => {
  const lancamentos = [
    { ...aluguelLancado, id: "longe", transaction_date: "2026-10-30", description: "Outra coisa", category_id: "x" },
    aluguelLancado,
    { ...aluguelLancado, id: "receita", amount: "2000.00", transaction_type: "income" },
    { ...aluguelLancado, id: "ja-usado" },
  ];
  const lista = lancamentosParaEscolher(aluguelPrevisto, lancamentos, new Set(["ja-usado"]));
  assert.deepEqual(
    lista.map((l) => [l.id, l.sugerido]),
    [
      ["c1697eb6", true],
      ["longe", false],
    ]
  );
});
