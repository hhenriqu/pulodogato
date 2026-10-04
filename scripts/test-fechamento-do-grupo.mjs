// =====================================================
// PULODOGATO - o fechamento do mes de um grupo (HMO-245)
// =====================================================
//   npm run test:fechamento-do-grupo
//
// Roda o JS compilado de lib/fechamento-do-grupo.ts, que importa
// lib/settlement.ts -- por isso o npm script tem o passo de resolve-aliases.
//
// Cada bloco tem o CONTROLE junto: o numero que a conta errada produziria.
// Sem isso, "total = 159,90" passa verde num modulo que soma so o realizado,
// num grupo em que nao HA realizado -- e a assercao nao seria capaz de falhar.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  mesDaData,
  valorDoFechamento,
  ratearCentavos,
  ratearPorPeso,
  fecharMes,
  mesesComConta,
  linhaDoRealizado,
  linhaDoPrevisto,
} = await import("../.tmp-fechamento-do-grupo/fechamento-do-grupo.js");

const HELIO = "11111111-1111-1111-1111-111111111111";
const LAIS = "22222222-2222-2222-2222-222222222222";
const BIA = "33333333-3333-3333-3333-333333333333";

/**
 * Membros SEM peso -- a divisao igual, que e o que as 20 assercoes anteriores a
 * fase 4 medem. Nao receber peso e o que as mantem medindo a mesma coisa.
 */
const membros = (...ids) =>
  ids.map((id) => ({ user_id: id, full_name: `nome ${id.slice(0, 2)}` }));

/** Membros COM peso: `comPeso([HELIO, 7000], [LAIS, 3000])`. */
const comPeso = (...pares) =>
  pares.map(([id, peso]) => ({
    user_id: id,
    full_name: `nome ${id.slice(0, 2)}`,
    peso,
  }));

const devidoDe = (f, id) => f.por_membro.find((p) => p.user_id === id).devido;

// -----------------------------------------------------
// O caso da issue, numero por numero
// -----------------------------------------------------
test("a internet de R$ 159,90 vencendo 15/10 entra no fechamento de outubro", () => {
  // Exatamente o que a HMO-245 descreve: conta prevista, no cartao C6, no
  // grupo, vencendo 15/10. Nenhuma despesa realizada no mes.
  const internet = linhaDoPrevisto({
    id: "s1",
    description: "Internet",
    amount: "159.90", // scheduled_transactions.amount: POSITIVO por CHECK
    due_date: "2026-10-15",
    user_id: HELIO,
    status: "pending",
    direction: "expense",
  });

  const f = fecharMes([internet], membros(HELIO, LAIS), "2026-10");

  // Antes desta feature este numero era ZERO: o total do mes somava so o
  // realizado, e a internet morava numa secao "Previstas" sem mes.
  assert.equal(f.total, 159.9);
  assert.equal(f.total_previsto, 159.9);
  assert.equal(f.total_realizado, 0);
  assert.equal(f.linhas.length, 1);

  // "cada um vai pagar um x de valor"
  const helio = f.por_membro.find((p) => p.user_id === HELIO);
  const lais = f.por_membro.find((p) => p.user_id === LAIS);
  assert.equal(helio.devido, 79.95);
  assert.equal(lais.devido, 79.95);

  // "quanto cada um deve pagar para o outro ao fim do mes"
  assert.equal(helio.pago, 159.9);
  assert.equal(lais.pago, 0);
  assert.equal(helio.saldo, 79.95);
  assert.equal(lais.saldo, -79.95);

  assert.equal(f.transferencias.length, 1);
  assert.deepEqual(
    {
      de: f.transferencias[0].from_user_id,
      para: f.transferencias[0].to_user_id,
      valor: f.transferencias[0].amount,
    },
    { de: LAIS, para: HELIO, valor: 79.95 }
  );

  assert.equal(f.fecha, true);
});

test("o exemplo dos R$ 2.000 do mes 10 divide sem sobrar centavo", () => {
  // "mes 10 temos/teremos 2 mil reais em contas, cada um vai pagar um x"
  const contas = [
    { id: "a", valor: 1200, data: "2026-10-03", pagador_user_id: HELIO, origem: "realizado" },
    { id: "b", valor: 500, data: "2026-10-15", pagador_user_id: LAIS, origem: "previsto" },
    { id: "c", valor: 300, data: "2026-10-28", pagador_user_id: BIA, origem: "previsto" },
  ];

  const f = fecharMes(contas, membros(HELIO, LAIS, BIA), "2026-10");

  assert.equal(f.total, 2000);
  assert.equal(f.total_realizado, 1200);
  assert.equal(f.total_previsto, 800);

  // 2000/3 nao e exato. As partes tem de SOMAR 2000 -- se cada uma fosse
  // arredondada por conta propria daria 666,67 x 3 = 2000,01, e a tela diria
  // "as contas deste grupo nao fecham por R$ 0,01" em todo grupo de tres.
  const soma = f.por_membro.reduce((s, p) => s + p.devido, 0);
  assert.equal(Number(soma.toFixed(2)), 2000);
  assert.deepEqual(
    f.por_membro.map((p) => p.devido),
    [666.67, 666.67, 666.66]
  );

  assert.equal(f.fecha, true);
  // Os saldos tambem somam zero exato.
  const somaSaldos = f.por_membro.reduce((s, p) => s + p.saldo, 0);
  assert.equal(Number(somaSaldos.toFixed(2)), 0);
});

// -----------------------------------------------------
// Armadilha 1: o sinal dos dois lados e OPOSTO
// -----------------------------------------------------
test("realizado negativo e previsto positivo SOMAM, nao se cancelam", () => {
  // Duas contas de 159,90 no mesmo mes: uma ja paga (amount negativo em
  // financial_transactions) e uma a vencer (amount positivo em
  // scheduled_transactions). Sem Math.abs elas se anulam e o mes fecha em zero.
  const realizada = linhaDoRealizado({
    id: "t1",
    description: "Internet setembro",
    amount: "-159.90",
    transaction_date: "2026-10-05",
    user_id: HELIO,
    transaction_type: "expense",
  });
  const prevista = linhaDoPrevisto({
    id: "s1",
    description: "Internet outubro",
    amount: "159.90",
    due_date: "2026-10-15",
    user_id: HELIO,
    status: "pending",
    direction: "expense",
  });

  // O controle: o que a soma CRUA dos dois `amount` daria.
  const somaCrua = -159.9 + 159.9;
  assert.equal(somaCrua, 0, "controle: os valores crus se cancelam");

  const f = fecharMes([realizada, prevista], membros(HELIO, LAIS), "2026-10");
  assert.equal(f.total, 319.8);
  assert.notEqual(f.total, somaCrua);
});

test("valorDoFechamento devolve positivo vindo dos dois sinais e aplica a cotacao", () => {
  assert.equal(valorDoFechamento("-159.90"), 159.9);
  assert.equal(valorDoFechamento("159.90"), 159.9);
  assert.equal(valorDoFechamento(-180, 5.35), 963); // o jantar de US$ 180 da HMO-182
  // Cotacao ausente/zero/lixo vale 1 -- multiplicar por 0 apagaria a despesa.
  assert.equal(valorDoFechamento(-100, 0), 100);
  assert.equal(valorDoFechamento(-100, null), 100);
  assert.equal(valorDoFechamento(-100, "nao-numero"), 100);
  assert.equal(valorDoFechamento(null), 0);
});

// -----------------------------------------------------
// Armadilha 2: contar a mesma conta duas vezes
// -----------------------------------------------------
test("a conta prevista PAGA nao entra: ela ja esta no lado realizado", () => {
  // A internet recebeu baixa: status 'paid' e transaction_id preenchido. A
  // transacao virou group_transactions e ja conta como realizado. Se a prevista
  // tambem entrasse, outubro mostraria R$ 319,80 de uma conta de R$ 159,90.
  const paga = linhaDoPrevisto({
    id: "s1",
    amount: "159.90",
    due_date: "2026-10-15",
    user_id: HELIO,
    status: "paid",
    direction: "expense",
  });
  assert.equal(paga, null);

  const realizada = linhaDoRealizado({
    id: "t1",
    amount: "-159.90",
    transaction_date: "2026-10-15",
    user_id: HELIO,
    transaction_type: "expense",
  });

  const linhas = [paga, realizada].filter(Boolean);
  const f = fecharMes(linhas, membros(HELIO, LAIS), "2026-10");
  assert.equal(f.total, 159.9);
  assert.equal(f.linhas.length, 1);
});

test("transferencia fica fora: as duas pernas se anulam mas inflariam o total", () => {
  const linhas = [
    { id: "p1", valor: 500, data: "2026-10-10", pagador_user_id: HELIO, origem: "realizado", tipo: "transfer" },
    { id: "p2", valor: 500, data: "2026-10-10", pagador_user_id: HELIO, origem: "realizado", tipo: "transfer" },
    { id: "d1", valor: 159.9, data: "2026-10-15", pagador_user_id: HELIO, origem: "previsto", tipo: "expense" },
  ];
  const f = fecharMes(linhas, membros(HELIO, LAIS), "2026-10");
  // Com as pernas dentro o total seria 1159,90.
  assert.equal(f.total, 159.9);
});

// -----------------------------------------------------
// Armadilha 3: receita prevista nao e conta a pagar
// -----------------------------------------------------
test("receita prevista de grupo nao entra no fechamento de despesa", () => {
  const salario = linhaDoPrevisto({
    id: "s2",
    description: "Reembolso",
    amount: "5000.00",
    due_date: "2026-10-20",
    user_id: HELIO,
    status: "pending",
    direction: "income", // a coluna `direction` da view, nao o sinal
  });
  const internet = linhaDoPrevisto({
    id: "s1",
    amount: "159.90",
    due_date: "2026-10-15",
    user_id: HELIO,
    status: "pending",
    direction: "expense",
  });

  const f = fecharMes([salario, internet], membros(HELIO, LAIS), "2026-10");
  // Com a receita somada como despesa, outubro mostraria R$ 5.159,90.
  assert.equal(f.total, 159.9);
  assert.equal(f.linhas.length, 1);
});

test("receita realizada nao entra, mesmo quando transaction_type vem NULL", () => {
  // Linha antiga sem transaction_type (o defeito da HMO-182): no realizado o
  // SINAL ainda diz a direcao, e receita e positiva.
  const receita = linhaDoRealizado({
    id: "t9",
    amount: "7000.00", // positivo = receita
    transaction_date: "2026-10-02",
    user_id: HELIO,
    transaction_type: null,
  });
  assert.equal(receita.tipo, "income");

  const despesa = linhaDoRealizado({
    id: "t8",
    amount: "-159.90",
    transaction_date: "2026-10-05",
    user_id: HELIO,
    transaction_type: null,
  });
  assert.equal(despesa.tipo, "expense");

  const f = fecharMes([receita, despesa], membros(HELIO, LAIS), "2026-10");
  assert.equal(f.total, 159.9);
});

test("transaction_type explicito vence o sinal", () => {
  // A precedencia aqui e facil de escrever errada: com `??` solto antes do
  // ternario, 'income' viraria 'expense' por ser string truthy.
  const linha = linhaDoRealizado({
    id: "t7",
    amount: "-100.00",
    transaction_date: "2026-10-01",
    user_id: HELIO,
    transaction_type: "income",
  });
  assert.equal(linha.tipo, "income");
});

// -----------------------------------------------------
// O recorte do mes, nos dois fusos
// -----------------------------------------------------
test("o mes sai do prefixo da string, e nao de new Date", () => {
  assert.equal(mesDaData("2026-10-15"), "2026-10");
  assert.equal(mesDaData("2026-10-01"), "2026-10");
  assert.equal(mesDaData("2026-12-31"), "2026-12");
  // Data ausente ou curta nao casa com mes nenhum.
  assert.equal(mesDaData(null), "");
  assert.equal(mesDaData(""), "");
  assert.equal(mesDaData("2026-1"), "");
  assert.equal(mesDaData("nao-e-data"), "");
});

test("o dia 1 nao escorrega para o mes anterior (o fuso de Sao Paulo)", () => {
  // O controle: new Date("2026-10-01") e meia-noite UTC = 21:00 de 30/09 em
  // America/Sao_Paulo. Quem recortar o mes assim perde a primeira conta --
  // e so em maquina com fuso negativo, entao passa verde no CI em UTC.
  const porDate = new Date("2026-10-01").getMonth(); // 0-based, local
  const fusoNegativo = new Date().getTimezoneOffset() > 0;
  if (fusoNegativo) {
    assert.equal(porDate, 8, "controle: new Date joga 01/10 em setembro");
  }

  const f = fecharMes(
    [{ id: "a", valor: 100, data: "2026-10-01", pagador_user_id: HELIO, origem: "previsto" }],
    membros(HELIO, LAIS),
    "2026-10"
  );
  assert.equal(f.total, 100);
});

test("conta de outro mes fica fora do fechamento", () => {
  const linhas = [
    { id: "a", valor: 159.9, data: "2026-09-15", pagador_user_id: HELIO, origem: "previsto" },
    { id: "b", valor: 159.9, data: "2026-10-15", pagador_user_id: HELIO, origem: "previsto" },
    { id: "c", valor: 159.9, data: "2026-11-15", pagador_user_id: HELIO, origem: "previsto" },
  ];
  const f = fecharMes(linhas, membros(HELIO, LAIS), "2026-10");
  assert.equal(f.total, 159.9);
  assert.deepEqual(f.linhas.map((l) => l.id), ["b"]);
});

// -----------------------------------------------------
// O rateio exato
// -----------------------------------------------------
test("ratearCentavos distribui o resto e sempre soma o total", () => {
  const tres = ratearCentavos(200000, [HELIO, LAIS, BIA]);
  assert.deepEqual([...tres.values()], [66667, 66667, 66666]);
  assert.equal([...tres.values()].reduce((a, b) => a + b, 0), 200000);

  // Varredura: nenhum total entre 0 e 1000 centavos, para 1..7 pessoas, pode
  // deixar residuo. Uma conta de maior-resto errada falha em algum deles.
  for (let total = 0; total <= 1000; total++) {
    for (let n = 1; n <= 7; n++) {
      const ids = Array.from({ length: n }, (_, i) => `u${i}`);
      const partes = [...ratearCentavos(total, ids).values()];
      assert.equal(partes.length, n);
      assert.equal(
        partes.reduce((a, b) => a + b, 0),
        total,
        `total ${total} entre ${n}`
      );
      // A diferenca entre a maior e a menor parte nunca passa de um centavo.
      assert.ok(Math.max(...partes) - Math.min(...partes) <= 1);
    }
  }
});

// -----------------------------------------------------
// O rateio COM PESO (HMO-245, fase 4)
// -----------------------------------------------------
test("70/30 de R$ 2.000 fecha em R$ 2.000 cravado", () => {
  // O caso obrigatorio da issue. Antes desta fase o fechamento rateava SEMPRE
  // igual, e este mes sairia 666,67 / 666,67 / 666,66 para tres, ou 1.000 /
  // 1.000 para dois -- a conta da casa dividida por uma regra que o grupo nao
  // configurou.
  const contas = [
    { id: "a", valor: 1200, data: "2026-10-03", pagador_user_id: HELIO, origem: "realizado" },
    { id: "b", valor: 500, data: "2026-10-15", pagador_user_id: LAIS, origem: "previsto" },
    { id: "c", valor: 300, data: "2026-10-28", pagador_user_id: HELIO, origem: "previsto" },
  ];

  const f = fecharMes(contas, comPeso([HELIO, 7000], [LAIS, 3000]), "2026-10");

  assert.equal(f.total, 2000);
  assert.equal(devidoDe(f, HELIO), 1400);
  assert.equal(devidoDe(f, LAIS), 600);

  // O controle: a divisao IGUAL dos mesmos R$ 2.000 daria 1.000 para cada --
  // o numero que esta assercao teria se o peso fosse ignorado.
  const igual = fecharMes(contas, membros(HELIO, LAIS), "2026-10");
  assert.equal(devidoDe(igual, HELIO), 1000);
  assert.notEqual(devidoDe(f, HELIO), devidoDe(igual, HELIO));

  // "fecha em R$ 2.000 cravado": a soma das partes E o total, e os saldos
  // somam zero -- senao o grupo exibe um residuo que Pix nenhum zera.
  assert.equal(
    Number(f.por_membro.reduce((s, p) => s + p.devido, 0).toFixed(2)),
    2000
  );
  assert.equal(
    Number(f.por_membro.reduce((s, p) => s + p.saldo, 0).toFixed(2)),
    0
  );
  assert.equal(f.fecha, true);

  // E o acerto sai do saldo novo, nao do antigo: Lais pagou 500 e deve 600.
  assert.deepEqual(
    f.transferencias.map((t) => [t.from_user_id, t.to_user_id, t.amount]),
    [[LAIS, HELIO, 100]]
  );
});

test("o peso e RAZAO: 7/3 divide igual a 7000/3000", () => {
  // `ratearPorPeso` divide pela SOMA dos pesos, entao a unidade nao importa --
  // so a proporcao. E isso que faz a conferencia de soma != 100% ser um degrau
  // de VERDADE (quem recusa e `divisaoDoPeriodo`): aqui 70 e 27 nao rateariam
  // 97% da conta, eles rateariam 100% numa proporcao que ninguem configurou.
  const contas = [
    { id: "a", valor: 2000, data: "2026-10-03", pagador_user_id: HELIO, origem: "realizado" },
  ];
  const grosso = fecharMes(contas, comPeso([HELIO, 7], [LAIS, 3]), "2026-10");
  const fino = fecharMes(contas, comPeso([HELIO, 7000], [LAIS, 3000]), "2026-10");
  assert.deepEqual(
    grosso.por_membro.map((p) => p.devido),
    fino.por_membro.map((p) => p.devido)
  );
  assert.equal(devidoDe(grosso, HELIO), 1400);
});

test("membro em 0% nao aparece com parte zerada por arredondamento", () => {
  // O degrau que vira dinheiro: `group_members.percentage` aceita 0 (uma pessoa
  // nao divide a conta). A parte dela tem de ser ZERO -- nao um centavo de
  // sobra, que e o que um maior-resto escrito ao contrario produz.
  //
  // R$ 2.000,01 e escolhido de proposito: ele TEM sobra de um centavo para
  // distribuir. Com R$ 2.000 nao haveria sobra e a assercao passaria por
  // vacuidade, medindo um caso em que nenhuma implementacao erra.
  const contas = [
    { id: "a", valor: 2000.01, data: "2026-10-03", pagador_user_id: HELIO, origem: "realizado" },
  ];
  const f = fecharMes(
    contas,
    comPeso([HELIO, 7000], [LAIS, 3000], [BIA, 0]),
    "2026-10"
  );

  assert.equal(devidoDe(f, BIA), 0);
  // O centavo de sobra foi para quem tem o MAIOR resto, e sobrou um so.
  assert.equal(devidoDe(f, HELIO), 1400.01);
  assert.equal(devidoDe(f, LAIS), 600);
  assert.equal(
    Number(f.por_membro.reduce((s, p) => s + p.devido, 0).toFixed(2)),
    2000.01
  );

  // Bia CONTINUA na lista: ela nao divide a conta, mas se tiver pagado algo
  // tem a receber. Tira-la de `por_membro` apagaria esse credito.
  assert.equal(f.por_membro.length, 3);
});

test("quem esta em 0% e pagou a conta tem a receber tudo que pagou", () => {
  const f = fecharMes(
    [{ id: "a", valor: 300, data: "2026-10-05", pagador_user_id: BIA, origem: "realizado" }],
    comPeso([HELIO, 7000], [LAIS, 3000], [BIA, 0]),
    "2026-10"
  );
  const bia = f.por_membro.find((p) => p.user_id === BIA);
  assert.equal(bia.pago, 300);
  assert.equal(bia.devido, 0);
  assert.equal(bia.saldo, 300);
  // O dinheiro TEM dono: nao e `pago_por_nao_membro`, e o fechamento fecha.
  assert.equal(f.pago_por_nao_membro, 0);
  assert.equal(f.fecha, true);
  assert.equal(f.transferencias.length, 2);
});

test("sobra nunca alcanca peso zero, varrendo totais e combinacoes", () => {
  // A propriedade, e nao a guarda: com peso 0 o resto e 0, que e o MENOR
  // possivel, e a sobra e sempre menor que o numero de restos positivos. Esta
  // varredura e o que torna isso medido em vez de argumentado.
  for (let total = 0; total <= 400; total++) {
    for (const pesos of [
      [7000, 3000, 0],
      [0, 7000, 3000],
      [3333, 3333, 3334, 0, 0],
      [1, 0],
      [0, 1, 0, 1],
    ]) {
      const ids = pesos.map((_, i) => `u${i}`);
      const partes = ratearPorPeso(
        total,
        ids.map((user_id, i) => ({ user_id, peso: pesos[i] }))
      );
      const valores = ids.map((id) => partes.get(id));
      assert.equal(
        valores.reduce((a, b) => a + b, 0),
        total,
        `total ${total} com pesos ${pesos}`
      );
      pesos.forEach((p, i) => {
        if (p === 0) {
          assert.equal(
            valores[i],
            0,
            `total ${total} pesos ${pesos}: peso zero levou ${valores[i]}`
          );
        }
      });
    }
  }
});

test("todos os pesos em zero divide IGUAL, e nao NaN", () => {
  // O estado de todo grupo que existe hoje: `group_members.percentage` nasce
  // `DEFAULT 0.00` e ninguem nunca escreveu nela. Sem o degrau a conta e
  // `total * 0 / 0` = NaN, que nao estoura -- atravessa calado e chega na tela
  // como "R$ NaN".
  const zeros = ratearPorPeso(200000, [
    { user_id: HELIO, peso: 0 },
    { user_id: LAIS, peso: 0 },
    { user_id: BIA, peso: 0 },
  ]);
  assert.deepEqual([...zeros.values()], [66667, 66667, 66666]);
  // E e exatamente a divisao igual, pela MESMA aritmetica -- nao um segundo
  // caminho de codigo que possa divergir dela.
  assert.deepEqual(
    [...zeros.values()],
    [...ratearCentavos(200000, [HELIO, LAIS, BIA]).values()]
  );
  assert.equal([...zeros.values()].every(Number.isInteger), true);
});

test("peso negativo, NaN e Infinity viram zero em vez de contaminar a divisao", () => {
  // Nenhum dos tres vem de slider: vem de `Number("")`, `Number("abc")` e de
  // leitura de banco. `NaN` contaminaria a soma e TODO MUNDO sairia NaN;
  // negativo encolheria a soma e inverteria a proporcao de quem sobrou.
  for (const ruim of [-5000, NaN, Infinity, -Infinity, "7000", null, undefined]) {
    const partes = ratearPorPeso(100000, [
      { user_id: HELIO, peso: 7000 },
      { user_id: LAIS, peso: ruim },
    ]);
    assert.deepEqual(
      [...partes.values()],
      [100000, 0],
      `peso ${String(ruim)} nao foi normalizado para zero`
    );
  }
});

test("o peso nao muda o que `fecharMes` faz com quem saiu do grupo", () => {
  const ausente = "99999999-9999-9999-9999-999999999999";
  const f = fecharMes(
    [
      { id: "a", valor: 300, data: "2026-10-02", pagador_user_id: ausente, origem: "realizado" },
      { id: "b", valor: 700, data: "2026-10-15", pagador_user_id: HELIO, origem: "previsto" },
    ],
    comPeso([HELIO, 7000], [LAIS, 3000]),
    "2026-10"
  );
  assert.equal(f.total, 1000);
  assert.equal(devidoDe(f, HELIO), 700);
  assert.equal(devidoDe(f, LAIS), 300);
  assert.equal(f.pago_por_nao_membro, 300);
  assert.equal(f.fecha, false);
});

test("ratearPorPeso aceita total negativo mantendo a soma exata", () => {
  // O fechamento nunca produz um (`valorDoFechamento` normalizou o sinal), mas
  // a funcao e exportada: um total negativo tratado pela metade devolveria
  // partes positivas somando o oposto do total.
  const partes = ratearPorPeso(-200001, [
    { user_id: HELIO, peso: 7000 },
    { user_id: LAIS, peso: 3000 },
  ]);
  assert.deepEqual([...partes.values()], [-140001, -60000]);
  assert.equal([...partes.values()].reduce((a, b) => a + b, 0), -200001);
});

test("ratearPorPeso com lista vazia devolve mapa vazio, sem dividir por zero", () => {
  assert.deepEqual([...ratearPorPeso(100000, []).entries()], []);
});

test("membro sem peso numa lista que TEM pesos nao divide a conta", () => {
  // `peso ?? 0`, e nao `?? 1`. As duas sao indistinguiveis quando NINGUEM tem
  // peso (zeros caem no degrau, uns sao uniformes: a mesma divisao igual), e e
  // por isso que esta assercao precisa de uma lista MISTA -- sem ela o `?? 1`
  // passaria verde nas 20 assercoes de divisao igual.
  //
  // Com `?? 1` Bia dividiria 1 contra os 7000 de Helio: uma parte de quase
  // zero, com o total ainda fechando, onde a leitura certa e "Bia nao tem peso
  // configurado, logo nao esta nesta divisao".
  const f = fecharMes(
    [{ id: "a", valor: 1000, data: "2026-10-05", pagador_user_id: HELIO, origem: "realizado" }],
    [
      { user_id: HELIO, peso: 7000 },
      { user_id: LAIS, peso: 3000 },
      { user_id: BIA },
    ],
    "2026-10"
  );
  assert.equal(devidoDe(f, HELIO), 700);
  assert.equal(devidoDe(f, LAIS), 300);
  assert.equal(devidoDe(f, BIA), 0);
  assert.equal(
    Number(f.por_membro.reduce((s, p) => s + p.devido, 0).toFixed(2)),
    1000
  );
});

test("grupo sem membro ativo nao divide por zero", () => {
  const f = fecharMes(
    [{ id: "a", valor: 100, data: "2026-10-01", pagador_user_id: HELIO, origem: "previsto" }],
    [],
    "2026-10"
  );
  assert.equal(f.total, 100);
  assert.deepEqual(f.por_membro, []);
  assert.deepEqual(f.transferencias, []);
  // Ninguem a quem creditar: o fechamento DIZ isso em vez de mostrar zero.
  assert.equal(f.pago_por_nao_membro, 100);
  assert.equal(f.fecha, false);
});

test("grupo de um membro: ele deve o mes inteiro a si mesmo, sem transferencia", () => {
  const f = fecharMes(
    [{ id: "a", valor: 159.9, data: "2026-10-15", pagador_user_id: HELIO, origem: "previsto" }],
    membros(HELIO),
    "2026-10"
  );
  assert.equal(f.por_membro[0].devido, 159.9);
  assert.equal(f.por_membro[0].pago, 159.9);
  assert.equal(f.por_membro[0].saldo, 0);
  assert.deepEqual(f.transferencias, []);
  assert.equal(f.fecha, true);
});

// -----------------------------------------------------
// Quem pagou nao e mais do grupo
// -----------------------------------------------------
test("conta paga por quem saiu do grupo conta no total e NAO fecha", () => {
  const ausente = "99999999-9999-9999-9999-999999999999";
  const f = fecharMes(
    [
      { id: "a", valor: 300, data: "2026-10-02", pagador_user_id: ausente, origem: "realizado" },
      { id: "b", valor: 100, data: "2026-10-15", pagador_user_id: HELIO, origem: "previsto" },
    ],
    membros(HELIO, LAIS),
    "2026-10"
  );

  assert.equal(f.total, 400);
  assert.equal(f.pago_por_nao_membro, 300);
  // O residuo e exatamente o que foi pago por quem nao esta mais no grupo.
  const somaSaldos = f.por_membro.reduce((s, p) => s + p.saldo, 0);
  assert.equal(Number(somaSaldos.toFixed(2)), -300);
  assert.equal(f.fecha, false);
});

test("pagador nulo nao e creditado a ninguem", () => {
  const f = fecharMes(
    [{ id: "a", valor: 100, data: "2026-10-02", pagador_user_id: null, origem: "realizado" }],
    membros(HELIO, LAIS),
    "2026-10"
  );
  assert.equal(f.pago_por_nao_membro, 100);
  assert.equal(f.por_membro.every((p) => p.pago === 0), true);
});

// -----------------------------------------------------
// Determinismo e o seletor de mes
// -----------------------------------------------------
test("a ordem das linhas e estavel com datas empatadas", () => {
  const linhas = [
    { id: "zz", valor: 10, data: "2026-10-10", pagador_user_id: HELIO, origem: "previsto" },
    { id: "aa", valor: 10, data: "2026-10-10", pagador_user_id: HELIO, origem: "previsto" },
    { id: "mm", valor: 10, data: "2026-10-20", pagador_user_id: HELIO, origem: "previsto" },
  ];
  const uma = fecharMes(linhas, membros(HELIO), "2026-10").linhas.map((l) => l.id);
  const outra = fecharMes([...linhas].reverse(), membros(HELIO), "2026-10").linhas.map((l) => l.id);
  assert.deepEqual(uma, ["mm", "aa", "zz"]);
  assert.deepEqual(uma, outra);
});

test("o seletor de mes traz o mes de hoje mesmo sem conta nenhuma", () => {
  assert.deepEqual(mesesComConta([], "2026-10-03"), ["2026-10"]);

  const linhas = [
    { id: "a", valor: 10, data: "2026-08-10", pagador_user_id: HELIO, origem: "previsto" },
    { id: "b", valor: 10, data: "2026-11-10", pagador_user_id: HELIO, origem: "previsto" },
    { id: "c", valor: 10, data: "2026-08-20", pagador_user_id: HELIO, origem: "previsto" },
  ];
  // Mais recente primeiro, sem repetir agosto, com outubro (hoje) no meio.
  assert.deepEqual(mesesComConta(linhas, "2026-10-03"), [
    "2026-11",
    "2026-10",
    "2026-08",
  ]);
});

test("fecharMes nao muda o array que recebeu", () => {
  const linhas = [
    { id: "b", valor: 10, data: "2026-10-20", pagador_user_id: HELIO, origem: "previsto" },
    { id: "a", valor: 10, data: "2026-10-10", pagador_user_id: HELIO, origem: "previsto" },
  ];
  const antes = linhas.map((l) => l.id);
  fecharMes(linhas, membros(HELIO), "2026-10");
  assert.deepEqual(linhas.map((l) => l.id), antes);
});
