// =====================================================
// A SEMEADURA DA DIVISAO PELA RENDA DO MES (HMO-245 fase 6 / HMO-272)
// =====================================================
//   npm run test:semeadura
//
// Roda nos DOIS fusos (America/Sao_Paulo e UTC), pelo npm script. O recorte do
// mes e por prefixo de string (`mesDaData`), e um `new Date("2026-10-01")` em
// qualquer lugar da cadeia poria o salario do dia 1 no mes anterior -- so em
// maquina com fuso negativo. A sandbox e Sao_Paulo e o CI e UTC: um teste de um
// fuso so passa verde em metade dos lugares onde roda.
//
// O QUE ESTA SUITE MEDE, EM DUAS CAMADAS
// --------------------------------------
//   1. as REGRAS (lib/semear-pela-renda.ts): a proporcao, o previsto entrando na
//      soma, o zero de quem nao lancou receita, e o `tem_renda` que a tela precisa
//      para nao tirar a pessoa da divisao em silencio;
//   2. o RECORTE DA ROTA (app/api/.../semear-divisao/route.ts), CHAMANDO o
//      handler. Esta e a medida que corresponde a decisao "so a porcentagem": o
//      R$ da renda sai apenas na linha de quem pediu.
//
// POR QUE A SEGUNDA CAMADA NAO PODE SER DISPENSADA PELA PRIMEIRA
// --------------------------------------------------------------
// `semearPelaRenda` recebe o `viewerUserId` de alguem. Um teste so dela prova
// que a FUNCAO recorta; nao prova que a ROTA passa o `auth.uid()` em vez de um
// id do corpo, nem que a resposta nao acrescenta a renda de volta num campo
// novo. E a prova que falta e justamente a que o defeito original pede: a rota
// antiga (/api/expense-groups/proportions) tambem "escondia" o valor -- no JSX.
// Aquela rota foi REMOVIDA na fase 7 (HMO-273); ver a secao 3 no fim deste
// arquivo para onde foi a garantia que os casos dela davam.
//
// E o controle positivo esta na funcao `sonda`: ela exige que os DOIS dubles
// tenham sido consultados. Uma rota que deixasse de usar o client de sessao, ou
// de abrir o client privilegiado, devolveria uma resposta plausivel com os
// dubles intocados -- e todas as assercoes de recorte abaixo passariam por
// vacuidade, medindo uma resposta que o teste praticamente escreveu.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { criarDuble } from "./duble-de-supabase.mjs";

const {
  rendaPorMembro,
  semearPelaRenda,
} = await import("../.tmp-semeadura/lib/semear-pela-renda.js");

const ROTA = await import(
  "../.tmp-semeadura/app/api/expense-groups/[groupId]/semear-divisao/route.js"
);

const CENTESIMOS_TOTAIS = 10000;

const GRUPO = "11111111-1111-1111-1111-111111111111";
const MEMBRO_A = "aaaaaaaa-0000-0000-0000-000000000001";
const MEMBRO_B = "bbbbbbbb-0000-0000-0000-000000000002";
const USUARIO_A = "aaaaaaaa-1111-1111-1111-111111111111";
const USUARIO_B = "bbbbbbbb-2222-2222-2222-222222222222";

/** Receita REALIZADA, como `financial_transactions` a devolve. */
function realizada(user_id, amount, transaction_date, extra = {}) {
  return {
    id: `r-${user_id}-${transaction_date}-${amount}`,
    description: "Salário",
    amount,
    exchange_rate: null,
    transaction_date,
    user_id,
    transaction_type: "income",
    ...extra,
  };
}

/** Receita PREVISTA, como `scheduled_transactions_effective` a devolve. */
function prevista(user_id, amount, due_date, extra = {}) {
  return {
    id: `p-${user_id}-${due_date}-${amount}`,
    description: "Salário previsto",
    amount,
    due_date,
    user_id,
    status: "pending",
    direction: "income",
    ...extra,
  };
}

/** Uma linha ja normalizada, do jeito que `rendaPorMembro` a consome. */
function linha(pagador_user_id, valor, data, tipo = "income") {
  return {
    id: `l-${pagador_user_id}-${data}-${valor}`,
    descricao: null,
    valor,
    data,
    pagador_user_id,
    origem: "realizado",
    tipo,
  };
}

const MEMBROS = [
  { member_id: MEMBRO_A, user_id: USUARIO_A },
  { member_id: MEMBRO_B, user_id: USUARIO_B },
];

// ---------------------------------------------------------------------------
// 1. AS REGRAS
// ---------------------------------------------------------------------------

test("a proporcao da renda vira os percentuais, somando 100%", () => {
  const s = semearPelaRenda(
    MEMBROS,
    [linha(USUARIO_A, 7000, "2026-10-05"), linha(USUARIO_B, 3000, "2026-10-20")],
    "2026-10",
    null
  );

  assert.equal(s.membros[0].centesimos, 7000, "A com 70%");
  assert.equal(s.membros[1].centesimos, 3000, "B com 30%");
  assert.equal(s.soma_centesimos, CENTESIMOS_TOTAIS);
  assert.equal(s.membros[0].percentage, 70);
  assert.equal(s.membros[1].percentage, 30);
  assert.equal(s.sem_renda_nenhuma, false);
  assert.equal(s.membros_sem_renda, 0);
});

test("a receita PREVISTA do mes entra na soma -- e e o que muda o percentual", () => {
  // A: 4.000 realizados. B: 2.000 realizados + 2.000 previstos para o dia 20.
  //
  // Sem o previsto a divisao sairia 67/33. Com ele, 50/50. O par de assercoes e
  // o que impede este teste de passar com uma leitura que ignore o previsto: a
  // soma 10000 fecha nos dois casos.
  const soRealizado = semearPelaRenda(
    MEMBROS,
    [linha(USUARIO_A, 4000, "2026-10-05"), linha(USUARIO_B, 2000, "2026-10-05")],
    "2026-10",
    null
  );
  assert.equal(soRealizado.membros[0].centesimos, 6667);
  assert.equal(soRealizado.membros[1].centesimos, 3333);

  const comPrevisto = semearPelaRenda(
    MEMBROS,
    [
      linha(USUARIO_A, 4000, "2026-10-05"),
      linha(USUARIO_B, 2000, "2026-10-05"),
      { ...linha(USUARIO_B, 2000, "2026-10-20"), origem: "previsto" },
    ],
    "2026-10",
    null
  );
  assert.equal(comPrevisto.membros[0].centesimos, 5000, "A cai para 50%");
  assert.equal(comPrevisto.membros[1].centesimos, 5000, "B sobe para 50%");
});

test("o dia 1 e o ultimo dia do mes ficam DENTRO do mes, nos dois fusos", () => {
  // O caso que `new Date(iso)` erraria: meia-noite UTC do dia 1 e 21:00 do dia
  // 30 anterior em Sao_Paulo. `rendaPorMembro` compara prefixo de string, entao
  // o resultado e o mesmo com TZ=UTC e com TZ=America/Sao_Paulo -- e o npm
  // script roda os dois.
  const renda = rendaPorMembro(
    [
      linha(USUARIO_A, 100, "2026-10-01"),
      linha(USUARIO_A, 200, "2026-10-31"),
      linha(USUARIO_A, 400, "2026-09-30"),
      linha(USUARIO_A, 800, "2026-11-01"),
    ],
    "2026-10"
  );

  assert.equal(
    renda.get(USUARIO_A),
    30000,
    "so outubro: 100 + 200 em reais = 30000 centavos"
  );
});

test("membro sem receita no mes sai em 0%, e a resposta DIZ que foi por isso", () => {
  const s = semearPelaRenda(
    MEMBROS,
    [linha(USUARIO_A, 5000, "2026-10-05")],
    "2026-10",
    null
  );

  assert.equal(s.membros[0].centesimos, CENTESIMOS_TOTAIS, "A leva tudo");
  assert.equal(s.membros[1].centesimos, 0, "B em zero, nao numa fracao");
  assert.equal(s.membros[1].tem_renda, false, "o rotulo da tela sai daqui");
  assert.equal(s.membros[0].tem_renda, true);
  assert.equal(s.membros_sem_renda, 1);
  assert.equal(s.sem_renda_nenhuma, false, "alguem lancou: A");
});

test("nao ha R$ 1.000 inventado -- o contraste com calculate_member_proportions", () => {
  // A funcao SQL faz `COALESCE(..., 1000)` tres vezes. Com A em 9.000 e B sem
  // nada ela daria 90/10, tirando 10% de A para um salario que nao existe.
  // Aqui B fica em 0 e A fica com os 100%.
  const s = semearPelaRenda(
    MEMBROS,
    [linha(USUARIO_A, 9000, "2026-10-10")],
    "2026-10",
    null
  );

  assert.equal(s.membros[1].centesimos, 0);
  assert.notEqual(s.membros[0].centesimos, 9000, "90% seria o COALESCE agindo");
  assert.equal(s.membros[0].centesimos, CENTESIMOS_TOTAIS);
});

test("ninguem com receita no mes cai na divisao IGUAL, e avisa", () => {
  const s = semearPelaRenda(MEMBROS, [], "2026-10", null);

  assert.equal(s.membros[0].centesimos, 5000);
  assert.equal(s.membros[1].centesimos, 5000);
  assert.equal(s.soma_centesimos, CENTESIMOS_TOTAIS);
  assert.equal(
    s.sem_renda_nenhuma,
    true,
    "sem este aviso o 50/50 se le como 'a renda de voces e igual'"
  );
  assert.equal(s.membros_sem_renda, 2);
});

test("grupo sem membro ativo NAO diz 'ninguem lancou receita'", () => {
  // Vacuidade: `[].every(...)` e `true`. O estado real e nao haver ninguem, e as
  // duas leituras pedem telas diferentes.
  const s = semearPelaRenda([], [], "2026-10", null);

  assert.equal(s.sem_renda_nenhuma, false);
  assert.deepEqual(s.membros, []);
  assert.equal(s.soma_centesimos, 0);
});

test("despesa NAO conta como renda, e linha sem tipo tambem nao", () => {
  const s = semearPelaRenda(
    MEMBROS,
    [
      linha(USUARIO_A, 5000, "2026-10-05"),
      linha(USUARIO_B, 5000, "2026-10-05", "expense"),
      linha(USUARIO_B, 5000, "2026-10-06", null),
    ],
    "2026-10",
    null
  );

  assert.equal(s.membros[1].centesimos, 0, "B nao ganhou renda nenhuma");
  assert.equal(s.membros[0].centesimos, CENTESIMOS_TOTAIS);
});

test("renda com valor negativo SOMA, e nao encolhe a renda do membro", () => {
  // `valorDoFechamento` entrega positivo, entao o caso nao e o comum -- mas a
  // convencao de sinal deste app e que despesa e NEGATIVA, e receita gravada com
  // sinal invertido existe. Sem o `Math.abs`, os 2.000 do dia 20 APAGARIAM os
  // 2.000 do dia 5 e o membro sairia com renda zero, o que o manda para 0% e o
  // tira da divisao.
  const renda = rendaPorMembro(
    [linha(USUARIO_A, 2000, "2026-10-05"), linha(USUARIO_A, -2000, "2026-10-20")],
    "2026-10"
  );

  assert.equal(renda.get(USUARIO_A), 400000, "4.000 em centavos, nao 0");

  const s = semearPelaRenda(
    MEMBROS,
    [linha(USUARIO_A, -5000, "2026-10-05")],
    "2026-10",
    USUARIO_A
  );
  assert.equal(s.membros[0].renda_centavos, 500000);
  assert.equal(s.membros[0].tem_renda, true);
  assert.equal(s.membros[0].centesimos, CENTESIMOS_TOTAIS);
});

test("duas posicoes com o mesmo member_id ficam com o peso de CADA uma", () => {
  // Defensivo, e o teste existe para a razao do codigo ser medida em vez de
  // afirmada: `semearPelaRenda` casa membro e peso por POSICAO, e nao por mapa.
  // Um `find` por `member_id` devolveria a PRIMEIRA entrada para as duas, e as
  // duas linhas sairiam com o mesmo percentual -- a linha de baixo perderia a
  // renda dela sem nada na tela mudando de lugar.
  const duplicado = [
    { member_id: MEMBRO_A, user_id: USUARIO_A },
    { member_id: MEMBRO_A, user_id: USUARIO_B },
  ];

  const s = semearPelaRenda(
    duplicado,
    [linha(USUARIO_A, 7000, "2026-10-05"), linha(USUARIO_B, 3000, "2026-10-05")],
    "2026-10",
    null
  );

  assert.equal(s.membros[0].centesimos, 7000);
  assert.equal(s.membros[1].centesimos, 3000);
  assert.equal(s.soma_centesimos, CENTESIMOS_TOTAIS);
});

test("linha sem pagador identificado nao cria membro fantasma", () => {
  const renda = rendaPorMembro(
    [linha(null, 5000, "2026-10-05"), linha("", 5000, "2026-10-05")],
    "2026-10"
  );

  assert.equal(renda.size, 0);
});

test("so a linha do viewer carrega renda_centavos -- e nas outras a chave NAO existe", () => {
  const comoB = semearPelaRenda(
    MEMBROS,
    [linha(USUARIO_A, 7000, "2026-10-05"), linha(USUARIO_B, 3000, "2026-10-05")],
    "2026-10",
    USUARIO_B
  );

  assert.equal("renda_centavos" in comoB.membros[1], true, "B ve a dele");
  assert.equal(comoB.membros[1].renda_centavos, 300000);
  assert.equal(
    "renda_centavos" in comoB.membros[0],
    false,
    "chave AUSENTE na linha de A -- `null` responderia 'sim' ao `in`"
  );

  // Simetria: nao e a posicao 1 que e privilegiada, e o `user_id` do viewer.
  const comoA = semearPelaRenda(
    MEMBROS,
    [linha(USUARIO_A, 7000, "2026-10-05"), linha(USUARIO_B, 3000, "2026-10-05")],
    "2026-10",
    USUARIO_A
  );
  assert.equal(comoA.membros[0].renda_centavos, 700000);
  assert.equal("renda_centavos" in comoA.membros[1], false);

  // E o percentual e de TODOS, nos dois casos: o recorte e do R$, nao do %.
  assert.deepEqual(
    comoB.membros.map((m) => m.centesimos),
    comoA.membros.map((m) => m.centesimos)
  );
});

test("viewer nulo ou de fora da lista deixa a resposta POBRE, nunca indiscreta", () => {
  for (const viewer of [null, "cccccccc-3333-3333-3333-333333333333"]) {
    const s = semearPelaRenda(
      MEMBROS,
      [linha(USUARIO_A, 7000, "2026-10-05")],
      "2026-10",
      viewer
    );
    for (const m of s.membros) {
      assert.equal(
        "renda_centavos" in m,
        false,
        `viewer ${viewer} nao e dono de renda nenhuma`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 2. O RECORTE DA ROTA -- chamando o handler
// ---------------------------------------------------------------------------

/**
 * Chama `GET /api/expense-groups/{GRUPO}/semear-divisao` como `user`.
 *
 * O CONTROLE POSITIVO VIVE AQUI: as duas contagens de duble. Sem elas, uma rota
 * que parasse de usar os clients devolveria algo plausivel e todas as
 * assercoes abaixo mediriam uma resposta que ninguem leu do "banco".
 */
async function sonda({
  user,
  membros,
  realizadas = [],
  previstas = [],
  mes = "2026-10",
  env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://exemplo.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "chave-de-servico",
  },
  exigeDubles = true,
}) {
  const sessao = criarDuble({
    user: user ? { id: user } : null,
    tabelas: { group_members: membros },
  });
  const servico = criarDuble({
    tabelas: {
      financial_transactions: realizadas,
      scheduled_transactions_effective: previstas,
    },
  });

  const registro = {
    sessao: () => sessao.client,
    servico: () => servico.client,
  };
  globalThis.__dubleDeSupabase = registro;

  const antes = {};
  for (const chave of Object.keys(env)) {
    antes[chave] = process.env[chave];
  }
  for (const [chave, valor] of Object.entries(env)) {
    if (valor === undefined) delete process.env[chave];
    else process.env[chave] = valor;
  }

  let resposta;
  try {
    resposta = await ROTA.GET(
      {
        nextUrl: new URL(
          `https://exemplo.test/api/expense-groups/${GRUPO}/semear-divisao?mes=${mes}`
        ),
      },
      { params: { groupId: GRUPO } }
    );
  } finally {
    for (const [chave, valor] of Object.entries(antes)) {
      if (valor === undefined) delete process.env[chave];
      else process.env[chave] = valor;
    }
    delete globalThis.__dubleDeSupabase;
  }

  const corpo = await resposta.json();

  if (exigeDubles) {
    assert.ok(
      (registro.chamadasDeSessao ?? 0) > 0,
      "controle positivo: a rota nao abriu o client de SESSAO. Sem ele, " +
        "`auth.uid()` nao veio da sessao e o recorte medido abaixo e ficticio."
    );
    assert.ok(
      (registro.chamadasDeServico ?? 0) > 0,
      "controle positivo: a rota nao abriu o client de SERVICE ROLE. Sem ele " +
        "a receita dos outros membros nao foi lida, e qualquer proporcao na " +
        "resposta veio de uma leitura vazia."
    );
  }

  return { resposta, corpo, sessao, servico, registro };
}

const MEMBROS_DO_BANCO = [
  {
    id: MEMBRO_A,
    user_id: USUARIO_A,
    group_id: GRUPO,
    status: "active",
    joined_at: "2026-01-01T00:00:00Z",
  },
  {
    id: MEMBRO_B,
    user_id: USUARIO_B,
    group_id: GRUPO,
    status: "active",
    joined_at: "2026-02-01T00:00:00Z",
  },
];

// A: 7.000 realizados. B: 3.000 realizados. O numero de A em centavos e o que
// NAO pode aparecer na resposta de B, em campo nenhum.
const RECEITAS_REALIZADAS = [
  realizada(USUARIO_A, 7000, "2026-10-05"),
  realizada(USUARIO_B, 3000, "2026-10-05"),
];

test("a rota chamada pelo membro B nao traz a renda do membro A", async () => {
  const { resposta, corpo } = await sonda({
    user: USUARIO_B,
    membros: MEMBROS_DO_BANCO,
    realizadas: RECEITAS_REALIZADAS,
  });

  assert.equal(resposta.status, 200);

  const deA = corpo.membros.find((m) => m.member_id === MEMBRO_A);
  const deB = corpo.membros.find((m) => m.member_id === MEMBRO_B);

  assert.ok(deA && deB, "as duas linhas vem -- o recorte e do R$, nao da linha");
  assert.equal(deA.centesimos, 7000, "o percentual de A e publico");
  assert.equal(deB.centesimos, 3000);

  assert.equal(
    "renda_centavos" in deA,
    false,
    "o R$ da renda de A nao pode existir na resposta de B"
  );
  assert.equal(deB.renda_centavos, 300000, "B ve a propria renda");

  // A medida que a assercao de campo nao faz: o salario de A em NENHUM lugar do
  // JSON. Um campo novo que o levasse de volta -- `total`, `debug`, uma linha
  // crua esquecida -- passaria pelo `in` acima e morre aqui.
  const texto = JSON.stringify(corpo);
  assert.equal(
    texto.includes("700000"),
    false,
    `a renda de A (700000 centavos) aparece no corpo: ${texto}`
  );
  assert.equal(
    texto.includes("Salário"),
    false,
    "descricao de lancamento alheio na resposta e pior que o valor"
  );
});

test("a mesma chamada pelo membro A espelha o recorte (nao e a posicao)", async () => {
  const { corpo } = await sonda({
    user: USUARIO_A,
    membros: MEMBROS_DO_BANCO,
    realizadas: RECEITAS_REALIZADAS,
  });

  const deA = corpo.membros.find((m) => m.member_id === MEMBRO_A);
  const deB = corpo.membros.find((m) => m.member_id === MEMBRO_B);

  assert.equal(deA.renda_centavos, 700000);
  assert.equal("renda_centavos" in deB, false);
  assert.equal(JSON.stringify(corpo).includes("300000"), false, "a de B saiu");

  // E os percentuais sao os MESMOS que B viu: o recorte nao mexe na divisao.
  assert.equal(deA.centesimos, 7000);
  assert.equal(deB.centesimos, 3000);
});

test("a rota soma a receita PREVISTA do mes, e a paga nao conta duas vezes", async () => {
  const { corpo } = await sonda({
    user: USUARIO_A,
    membros: MEMBROS_DO_BANCO,
    realizadas: [
      realizada(USUARIO_A, 4000, "2026-10-05"),
      realizada(USUARIO_B, 2000, "2026-10-05"),
    ],
    previstas: [
      // Entra: pendente, do mes, direcao income. Leva B de 33% para 50%.
      prevista(USUARIO_B, 2000, "2026-10-20"),
      // NAO entra: `status: 'paid'` ja esta no lado realizado (a de A, acima).
      prevista(USUARIO_A, 4000, "2026-10-05", { status: "paid" }),
      // NAO entra: previsao de DESPESA nao e receita de ninguem.
      prevista(USUARIO_A, 9000, "2026-10-15", { direction: "expense" }),
    ],
  });

  const deA = corpo.membros.find((m) => m.member_id === MEMBRO_A);
  const deB = corpo.membros.find((m) => m.member_id === MEMBRO_B);

  assert.equal(deA.centesimos, 5000, "50% -- o previsto de B entrou");
  assert.equal(deB.centesimos, 5000);
  assert.equal(deA.renda_centavos, 400000, "a paga nao dobrou a renda de A");
  assert.equal(corpo.soma_centesimos, CENTESIMOS_TOTAIS);
});

test("a leitura privilegiada e restrita aos membros DESTE grupo e ao mes", async () => {
  const INTRUSO = "dddddddd-4444-4444-4444-444444444444";

  const { corpo, servico, registro } = await sonda({
    user: USUARIO_B,
    membros: MEMBROS_DO_BANCO,
    realizadas: [
      ...RECEITAS_REALIZADAS,
      // Alguem de fora do grupo, e um mes vizinho de B: nenhum dos dois pode
      // mexer na proporcao.
      realizada(INTRUSO, 90000, "2026-10-05"),
      realizada(USUARIO_B, 50000, "2026-09-30"),
    ],
  });

  const deA = corpo.membros.find((m) => m.member_id === MEMBRO_A);
  assert.equal(deA.centesimos, 7000, "o de fora nao diluiu ninguem");
  assert.equal(corpo.membros.length, 2, "e nao entrou na lista");

  // A service role foi aberta com o que o ambiente deu -- nao com string vazia.
  assert.equal(registro.argumentosDoServico.url, "https://exemplo.supabase.co");
  assert.equal(registro.argumentosDoServico.chave, "chave-de-servico");

  // E as duas consultas privilegiadas foram FILTRADAS por user_id. Uma leitura
  // sem `.in()` traria a receita do app inteiro para dentro da rota.
  const privilegiadas = servico.lidas.filter((l) =>
    ["financial_transactions", "scheduled_transactions_effective"].includes(
      l.tabela
    )
  );
  assert.equal(privilegiadas.length, 2, "exatamente as duas de receita");
  for (const leitura of privilegiadas) {
    const porUsuario = leitura.filtros.find(
      (f) => f[0] === "in" && f[1] === "user_id"
    );
    assert.ok(
      porUsuario,
      `${leitura.tabela} foi lida sem .in("user_id", ...) com a service role`
    );
    assert.deepEqual([...porUsuario[2]].sort(), [USUARIO_A, USUARIO_B].sort());
  }
});

test("quem nao e membro ativo do grupo recebe 403, e nada e lido com privilegio", async () => {
  const DE_FORA = "eeeeeeee-5555-5555-5555-555555555555";

  const { resposta, corpo, servico, registro } = await sonda({
    user: DE_FORA,
    membros: MEMBROS_DO_BANCO,
    realizadas: RECEITAS_REALIZADAS,
    exigeDubles: false,
  });

  assert.equal(resposta.status, 403);
  assert.equal(corpo.membros, undefined, "nenhum percentual escapou");
  assert.equal(servico.lidas.length, 0, "a service role nem foi usada");
  assert.equal(registro.chamadasDeServico ?? 0, 0);
});

test("membro INATIVO do grupo nao passa pelo portao nem ganha percentual", async () => {
  const membros = [
    MEMBROS_DO_BANCO[0],
    { ...MEMBROS_DO_BANCO[1], status: "removed" },
  ];

  // O inativo pedindo: 403.
  const dele = await sonda({
    user: USUARIO_B,
    membros,
    realizadas: RECEITAS_REALIZADAS,
    exigeDubles: false,
  });
  assert.equal(dele.resposta.status, 403);

  // E o admin pedindo: o inativo nao aparece na divisao, e A fica com 100%.
  const { corpo } = await sonda({
    user: USUARIO_A,
    membros,
    realizadas: RECEITAS_REALIZADAS,
  });
  assert.equal(corpo.membros.length, 1);
  assert.equal(corpo.membros[0].member_id, MEMBRO_A);
  assert.equal(corpo.membros[0].centesimos, CENTESIMOS_TOTAIS);
});

test("sem sessao e 401, antes de qualquer leitura", async () => {
  const { resposta, sessao, servico } = await sonda({
    user: null,
    membros: MEMBROS_DO_BANCO,
    exigeDubles: false,
  });

  assert.equal(resposta.status, 401);
  assert.equal(sessao.lidas.length, 0);
  assert.equal(servico.lidas.length, 0);
});

test("service role ausente da 503 nomeando a variavel -- nao 500", async () => {
  const { resposta, corpo } = await sonda({
    user: USUARIO_B,
    membros: MEMBROS_DO_BANCO,
    realizadas: RECEITAS_REALIZADAS,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://exemplo.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    },
    exigeDubles: false,
  });

  assert.equal(resposta.status, 503);
  assert.match(corpo.error, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.equal(
    corpo.error.includes("NEXT_PUBLIC_SUPABASE_URL"),
    false,
    "so a que falta: nomear as duas manda procurar no lugar errado"
  );
});

test("?mes= lixo cai no mes corrente e DIZ que caiu", async () => {
  const { corpo } = await sonda({
    user: USUARIO_B,
    membros: MEMBROS_DO_BANCO,
    realizadas: RECEITAS_REALIZADAS,
    mes: "mes-que-vem",
  });

  assert.equal(corpo.mes_corrigido, true);
  assert.match(corpo.mes, /^\d{4}-\d{2}$/);
  assert.equal(corpo.mes, corpo.today.slice(0, 7), "o mes de `today`");
});

test("?mes= valido NAO e marcado como corrigido", async () => {
  const { corpo } = await sonda({
    user: USUARIO_B,
    membros: MEMBROS_DO_BANCO,
    realizadas: RECEITAS_REALIZADAS,
    mes: "2026-10",
  });

  assert.equal(corpo.mes_corrigido, false);
  assert.equal(corpo.mes, "2026-10");
});

// ---------------------------------------------------------------------------
// 3. A ROTA ANTIGA -- /api/expense-groups/proportions -- FOI REMOVIDA (HMO-273)
// ---------------------------------------------------------------------------
// A fase 6 CONSERTOU o vazamento de salario daquela rota (o POST devolvia o
// retorno cru de `calculate_member_proportions` com o `total_income` de todo
// mundo; o GET recortava por PAPEL, e admin de grupo nao e dono do salario dos
// outros). A fase 7 aposentou o caminho inteiro: a rota, o modal e o segundo
// armazem de porcentagem sairam, e a semeadura pela renda desta fase e quem
// ficou no lugar.
//
// Os casos que moravam aqui foram embora com o arquivo que eles importavam --
// rota que nao existe nao vaza. A garantia que os substitui e mais forte que
// eles, e e um guard em vez de um caso: a secao 3 de
// scripts/test-sugestao-de-divisao.mjs varre `app/`, `lib/`, `components/` e
// `utils/` e exige ZERO leitor, ZERO escritor e ZERO `fetch` do caminho
// aposentado -- inclusive um que alguem reintroduzisse em outro arquivo, que os
// casos antigos (presos ao route.ts) nao alcancavam.
