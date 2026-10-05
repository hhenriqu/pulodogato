// =====================================================
// OS DOIS NUMEROS DO MODO PAPEL DE PAO (HMO-286)
// =====================================================
//   npm run test:papel-de-pao
//
// "Salario Previsto" e "Total de contas" sao ROTULOS NOVOS, e e esse o risco
// que esta suite existe para cobrir: rotulo novo em cima de numero velho ja
// custou caro neste repositorio duas vezes ("Fatura atual" mostrando a divida
// inteira do cartao, "a vencer" somando salario com contas). Nos dois casos o
// numero exibido era plausivel.
//
// Ela mede `lib/papel-de-pao.ts` COMPILADO, com as dependencias de verdade --
// `STATUS_FORA_DO_PREVISTO`, `direcaoDaAgenda`, `parteDoMembro` e
// `periodoCorrente` entram pelo tsc, nao reescritos aqui. Uma copia local de
// qualquer uma delas faria a suite medir a si mesma.
//
// O RELOGIO E CONGELADO EM TODO CASO: nao ha `new Date()` nesta suite, e todo
// `hoje` e uma string literal. Teste de data aqui passa em UTC e nao ve o bug
// (a sandbox e America/Sao_Paulo, o CI e UTC), e por isso o script do
// package.json roda a suite DUAS VEZES, uma em cada fuso. Se qualquer coisa
// aqui passar a depender do relogio da maquina, uma das duas voltas reprova.
//
// OS QUATRO CASOS QUE A ISSUE EXIGE, e onde cada um esta:
//   1. o SINAL              -> "O sinal"
//   2. o RECORTE DO MES     -> "O recorte do mes"
//   3. o FILTRO DE CATEGORIA-> "O filtro de categoria"
//   4. o CASO VAZIO         -> "O caso vazio"
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const {
  painelDePapel,
  janelaDoMesCorrente,
  janelaDoMes,
  mesPedido,
  NOME_DA_CATEGORIA_DE_SALARIO,
  FRASE_SEM_SALARIO,
  FRASE_SEM_CONTAS,
} = await import("../.tmp-papel-de-pao/lib/papel-de-pao.js");

// A funcao que a ROTA usa para decidir se materializa, e de onde a rota a pega
// (nao uma copia): e dela que depende o criterio 3 da HMO-295 -- abrir novembro
// tem de CRIAR as linhas das regras recorrentes de novembro.
const { janelaParaMaterializar } = await import(
  "../.tmp-papel-de-pao/lib/periodo-do-painel.js"
);

// ---------------------------------------------------------------------------
// O FIXTURE
// ---------------------------------------------------------------------------
// Marco de 2026. Um mes so, com vizinhos dos dois lados para o recorte ter o
// que descartar.
const HOJE = "2026-03-15";
const JANELA = janelaDoMesCorrente(HOJE);

const SALARIO = "11111111-1111-1111-1111-111111111111";
const MORADIA = "22222222-2222-2222-2222-222222222222";
const SERVICOS = "33333333-3333-3333-3333-333333333333";

const GRUPO_CASA = "99999999-9999-9999-9999-999999999999";
/** O grupo Casa tem duas pessoas: metade de cada conta e minha. */
const MEMBROS = new Map([[GRUPO_CASA, 2]]);

/** A conta previsivel: so o salario e so uma conta. Serve de controle. */
const LINHAS_DO_PAR = [
  {
    due_date: "2026-03-05",
    amount: 7000,
    status: "pending",
    direction: "income",
    category_id: SALARIO,
    group_id: null,
  },
  {
    due_date: "2026-03-20",
    amount: 2000,
    status: "pending",
    direction: "expense",
    category_id: SERVICOS,
    group_id: null,
  },
];

const LINHAS = [
  // 1) O salario do mes. O unico que entra no primeiro numero.
  ...LINHAS_DO_PAR.slice(0, 1),

  // 2) ALUGUEL RECEBIDO -- receita prevista FORA da categoria Salario. E a
  //    linha mais importante do fixture: sem ela, um codigo que lesse o
  //    `expected_income` AGREGADO de /api/scheduled-transactions/summary
  //    passaria verde aqui. Ela nao entra em nenhum dos dois numeros.
  {
    due_date: "2026-03-10",
    amount: 2500,
    status: "pending",
    direction: "income",
    category_id: MORADIA,
    group_id: null,
  },

  // 3) Conta de luz pendente: entra no total de contas.
  {
    due_date: "2026-03-20",
    amount: 180.5,
    status: "pending",
    direction: "expense",
    category_id: SERVICOS,
    group_id: null,
  },

  // 4) Conta JA PAGA: continua sendo uma conta do mes. Sem ela, no dia 30 o
  //    total de contas iria para zero debaixo do mesmo rotulo.
  {
    due_date: "2026-03-08",
    amount: 2000,
    status: "paid",
    direction: "expense",
    category_id: MORADIA,
    group_id: null,
  },

  // 5) Assinatura CANCELADA e mensalidade PULADA: sairam da promessa do mes.
  {
    due_date: "2026-03-12",
    amount: 99,
    status: "cancelled",
    direction: "expense",
    category_id: SERVICOS,
    group_id: null,
  },
  {
    due_date: "2026-03-13",
    amount: 49,
    status: "skipped",
    direction: "expense",
    category_id: SERVICOS,
    group_id: null,
  },

  // 6) Despesa gravada NEGATIVA. A outra convencao de sinal do app chegando
  //    aqui: sem `Math.abs` ela DIMINUIRIA o total de contas.
  {
    due_date: "2026-03-22",
    amount: -300,
    status: "pending",
    direction: "expense",
    category_id: SERVICOS,
    group_id: null,
  },

  // 7) Aluguel do grupo Casa, R$ 3.000 para duas pessoas. Entra por 1.500.
  {
    due_date: "2026-03-28",
    amount: 3000,
    status: "pending",
    direction: "expense",
    category_id: MORADIA,
    group_id: GRUPO_CASA,
  },

  // 8) e 9) Os vizinhos: o salario de ABRIL e o de FEVEREIRO. Nenhum dos dois
  //    e deste mes, e a rota pode trazer meses vizinhos de proposito (a
  //    consulta da fatura do cartao olha um mes antes).
  {
    due_date: "2026-04-05",
    amount: 7000,
    status: "pending",
    direction: "income",
    category_id: SALARIO,
    group_id: null,
  },
  {
    due_date: "2026-02-05",
    amount: 7000,
    status: "pending",
    direction: "income",
    category_id: SALARIO,
    group_id: null,
  },
  // Uma conta de fevereiro, para o recorte ter o que descartar dos DOIS lados
  // no segundo numero tambem.
  {
    due_date: "2026-02-20",
    amount: 1234.56,
    status: "pending",
    direction: "expense",
    category_id: SERVICOS,
    group_id: null,
  },
];

const ctx = {
  janela: JANELA,
  membrosAtivosPorGrupo: MEMBROS,
  categoriasDeSalario: [SALARIO],
};

/** 180,50 + 2.000 (paga) + 300 (negativa) + 1.500 (minha metade do grupo). */
const CONTAS_DE_MARCO = 3980.5;

test("a janela e o mes de hoje, e nao o horizonte", () => {
  assert.deepEqual(JANELA, { de: "2026-03-01", ate: "2026-03-31" });
});

test("os dois numeros do mes, sobre o fixture inteiro", () => {
  const painel = painelDePapel(LINHAS, ctx);

  assert.deepEqual(painel.salario_previsto, { total: 7000, quantidade: 1 });
  assert.deepEqual(painel.total_de_contas, {
    total: CONTAS_DE_MARCO,
    quantidade: 4,
  });
});

// ---------------------------------------------------------------------------
// 1. O SINAL
// ---------------------------------------------------------------------------
test("O sinal: a despesa negativa SOMA no total de contas, nao subtrai", () => {
  const semNegativa = LINHAS.filter((l) => Number(l.amount) >= 0);

  const comTudo = painelDePapel(LINHAS, ctx).total_de_contas.total;
  const sem = painelDePapel(semNegativa, ctx).total_de_contas.total;

  // A linha vale -300. Somada crua, o total CAIRIA 300 em vez de subir 300 --
  // e os dois numeros seriam plausiveis.
  assert.equal(comTudo - sem, 300);
  assert.equal(comTudo, CONTAS_DE_MARCO);
});

test("O sinal: o salario nao cancela as contas -- sao dois numeros, nao um saldo", () => {
  const painel = painelDePapel(LINHAS_DO_PAR, ctx);

  assert.equal(painel.salario_previsto.total, 7000);
  assert.equal(painel.total_de_contas.total, 2000);

  // Os tres jeitos de errar isto, cada um com cara de certo:
  //   9000  -> somou tudo num acumulador positivo (o defeito da HMO-187)
  //   5000  -> deixou o salario cancelar as contas
  //  -5000  -> inverteu o par
  for (const errado of [9000, 5000, -5000]) {
    assert.notEqual(painel.total_de_contas.total, errado);
  }
});

test("O sinal: nenhum dos dois numeros sai negativo", () => {
  const painel = painelDePapel(LINHAS, ctx);
  assert.ok(painel.salario_previsto.total > 0);
  assert.ok(painel.total_de_contas.total > 0);
});

// ---------------------------------------------------------------------------
// 2. O RECORTE DO MES
// ---------------------------------------------------------------------------
test("O recorte do mes: o salario de abril e o de fevereiro ficam fora", () => {
  const painel = painelDePapel(LINHAS, ctx);

  // Tres salarios de R$ 7.000 no fixture, um por mes.
  assert.equal(painel.salario_previsto.total, 7000);
  assert.notEqual(painel.salario_previsto.total, 21000);
  assert.equal(painel.salario_previsto.quantidade, 1);
});

test("O recorte do mes: a conta de fevereiro nao entra no total de marco", () => {
  const painel = painelDePapel(LINHAS, ctx);

  assert.equal(painel.total_de_contas.total, CONTAS_DE_MARCO);
  // Sem recorte, a de fevereiro (1.234,56) entraria e o numero ainda pareceria
  // um total de contas perfeitamente comum.
  assert.notEqual(painel.total_de_contas.total, CONTAS_DE_MARCO + 1234.56);
});

test("O recorte do mes: so vizinho, nenhuma linha do mes -> indisponivel nos dois", () => {
  const soVizinhos = LINHAS.filter(
    (l) => !l.due_date.startsWith("2026-03")
  );

  const painel = painelDePapel(soVizinhos, ctx);
  assert.deepEqual(painel.salario_previsto, { total: null, quantidade: 0 });
  assert.deepEqual(painel.total_de_contas, { total: null, quantidade: 0 });
});

test("O recorte do mes: os dois extremos da janela ENTRAM", () => {
  const nasPontas = [
    {
      due_date: "2026-03-01",
      amount: 10,
      status: "pending",
      direction: "expense",
      category_id: SERVICOS,
      group_id: null,
    },
    {
      due_date: "2026-03-31",
      amount: 5,
      status: "pending",
      direction: "expense",
      category_id: SERVICOS,
      group_id: null,
    },
  ];

  // Janela FECHADA dos dois lados. Um `<` no lugar do `<=` tiraria a conta que
  // vence no ultimo dia do mes -- a mais comum que existe.
  const painel = painelDePapel(nasPontas, ctx);
  assert.deepEqual(painel.total_de_contas, { total: 15, quantidade: 2 });
});

test("O recorte do mes nasce do fuso de Sao Paulo, nao de UTC", () => {
  // 30 de setembro as 21:00 em Sao Paulo ja e 1o de outubro em UTC. Com `hoje`
  // vindo do fuso certo (`today()`, que a rota chama), a janela e setembro.
  assert.deepEqual(janelaDoMesCorrente("2026-09-30"), {
    de: "2026-09-01",
    ate: "2026-09-30",
  });

  // E o ultimo dia e o do mes de verdade, inclusive em fevereiro bissexto.
  assert.equal(janelaDoMesCorrente("2026-02-10").ate, "2026-02-28");
  assert.equal(janelaDoMesCorrente("2024-02-10").ate, "2024-02-29");
});

// ---------------------------------------------------------------------------
// 2b. O MES PEDIDO -- `?month=AAAA-MM` (HMO-295)
// ---------------------------------------------------------------------------
// O MUTANTE QUE DECIDE ESTA SECAO: ignorar o `?month=` e usar sempre o mes
// corrente. Ele SO MORRE porque o `hoje` destes casos (marco de 2026) e de um
// mes diferente do mes pedido em cada um deles. Um caso que pedisse o mes
// corrente seria sonda VACUA: passaria verde com o parametro inteiramente
// desligado, porque as duas respostas coincidem.
//
// `hoje` continua string literal, e as duas voltas do script (Sao Paulo e UTC)
// continuam valendo: a janela do mes pedido nao passa por `new Date` nenhum, e
// esta secao e onde isso seria facil de quebrar -- `new Date("2026-11-01")` e
// meia-noite UTC e em Sao Paulo ja e 31 de outubro.

test("o mes pedido manda: `2026-11` devolve NOVEMBRO, com hoje em marco", () => {
  assert.deepEqual(janelaDoMes("2026-11", HOJE), {
    de: "2026-11-01",
    ate: "2026-11-30",
  });

  // O mes corrente do fixture, que e a resposta do mutante. Se este `notEqual`
  // ficasse verde junto com o de cima, os dois meses seriam o mesmo e a secao
  // nao mediria nada.
  assert.notDeepEqual(janelaDoMes("2026-11", HOJE), JANELA);
  assert.notEqual(HOJE.slice(0, 7), "2026-11");
});

test("o mes pedido anda para TRAS tambem, e nao so para frente", () => {
  // Um `Math.max(mes, hoje)` escondido no caminho deixaria o passado preso no
  // mes corrente -- e "quanto eu tinha de contas no mes passado" e metade do
  // pedido da issue.
  assert.deepEqual(janelaDoMes("2026-01", HOJE), {
    de: "2026-01-01",
    ate: "2026-01-31",
  });
  assert.deepEqual(janelaDoMes("2025-12", HOJE), {
    de: "2025-12-01",
    ate: "2025-12-31",
  });
});

test("o ultimo dia e o do mes PEDIDO -- inclusive fevereiro bissexto", () => {
  // O erro classico: somar um mes ao dia 31 e ficar preso no dia 28 (ver
  // `passoDeMes` em lib/periodo-do-painel.ts). Aqui a janela e recalculada, e
  // um fevereiro de 30 dias viraria uma conta de 1o de marco contada em
  // fevereiro.
  assert.equal(janelaDoMes("2026-02", HOJE).ate, "2026-02-28");
  assert.equal(janelaDoMes("2024-02", HOJE).ate, "2024-02-29");
  assert.equal(janelaDoMes("2026-04", HOJE).ate, "2026-04-30");
  assert.equal(janelaDoMes("2026-12", HOJE).ate, "2026-12-31");
});

test("o `month` da resposta sai da janela, e ecoa o mes pedido", () => {
  // A rota responde `janela.de.slice(0, 7)`, e e com esse campo que a tela
  // descarta a resposta de outro mes. Se ele nao ecoasse o pedido, a tela
  // descartaria TODA resposta e o painel ficaria indisponivel para sempre.
  for (const mes of ["2026-01", "2026-11", "2027-02"]) {
    assert.equal(janelaDoMes(mes, HOJE).de.slice(0, 7), mes);
  }
});

test("mes ausente ou estragado cai no mes CORRENTE -- nao em erro, nao em vazio", () => {
  // Criterio 4 da issue: `?month=` ausente, `?month=abacaxi` e `?month=2026-13`
  // todos respondem o mes corrente com status 200. Querystring estragada (link
  // antigo, parametro cortado pelo aplicativo de mensagem) nao pode apagar o
  // modulo inteiro.
  const invalidos = [
    undefined,
    null,
    "",
    "abacaxi",
    "2026-13", // mes 13 NAO existe -- e `Date.UTC(2026, 13, 0)` e um janeiro
    "2026-00", //   de 2027 perfeitamente valido, entao so a regex nao basta
    "2026-1", // sem o zero a esquerda
    "202611",
    "2026/11",
    "26-11",
    "2026-11-05", // data inteira nao e mes
    "2026-11 ", // com espaco: a querystring entrega o que vier
    123,
    {},
    ["2026-11"],
  ];

  for (const entrada of invalidos) {
    assert.deepEqual(
      janelaDoMes(entrada, HOJE),
      JANELA,
      `${JSON.stringify(entrada)} deveria cair no mes corrente`
    );
    assert.equal(mesPedido(entrada), null, `${JSON.stringify(entrada)}`);
  }
});

test("mes valido NAO cai na rede do mes corrente (o par positivo do caso acima)", () => {
  // Sem este par, o caso de cima ficaria verde numa funcao que devolvesse o
  // mes corrente para TUDO -- que e o mutante desta issue.
  for (const mes of ["2025-12", "2026-01", "2026-11", "2027-06"]) {
    assert.equal(mesPedido(mes), mes);
    assert.notDeepEqual(janelaDoMes(mes, HOJE), JANELA);
  }
});

test("sem `hoje`, a rede e o mes do relogio em Sao Paulo", () => {
  // O unico caso da suite que toca o relogio, e de proposito: a rota chama
  // `janelaDoMes(month, today())`, e um default em UTC aqui devolveria o mes
  // seguinte nas tres ultimas horas do ultimo dia do mes. A comparacao e com
  // `janelaDoMesCorrente()` (que delega para `periodoCorrente`), e nao com um
  // mes escrito a mao -- escrever o mes a mao faria o caso vencer de validade.
  assert.deepEqual(janelaDoMes(undefined), janelaDoMesCorrente());
  assert.deepEqual(janelaDoMes("abacaxi"), janelaDoMesCorrente());
});

test("o mes SEGUINTE materializa; o mes passado nao -- conferido, nao suposto", () => {
  // Criterio 3 da issue, e o elo que faz o pedido dela responder algo. A rota
  // chama `janelaParaMaterializar(janela, hoje)`, e o que esta sendo conferido
  // aqui e que a janela do mes seguinte ATRAVESSA essa funcao -- sem isso,
  // novembro diria "nenhuma conta prevista" num mes cheio de contas e o resto da
  // rota estaria correto.
  const seguinte = janelaDoMes("2026-04", HOJE);
  assert.deepEqual(janelaParaMaterializar(seguinte, HOJE), {
    de: "2026-04-01",
    ate: "2026-04-30",
  });

  // E o mes INTEIRAMENTE PASSADO devolve `null`: materializar para tras
  // fabricaria conta vencida retroativa -- o app inventando divida que a pessoa
  // nunca teve, e ainda marcada em atraso. Mes velho mostra so o que ja esta
  // gravado, e esta certo.
  assert.equal(janelaParaMaterializar(janelaDoMes("2026-01", HOJE), HOJE), null);

  // O mes corrente materializa de HOJE para frente, e nao do dia 1: a parte
  // passada da janela nao pode ganhar linha nova.
  assert.deepEqual(janelaParaMaterializar(JANELA, HOJE), {
    de: HOJE,
    ate: "2026-03-31",
  });
});

test("os dois numeros seguem a janela do mes PEDIDO, e nao a do corrente", () => {
  // O elo que fecha a secao: a janela entra em `painelDePapel` por `ctx`, e e
  // ela que decide quais linhas contam. O fixture tem o salario de ABRIL
  // (R$ 7.000, dia 05) e nenhuma conta de abril.
  const abril = painelDePapel(LINHAS, { ...ctx, janela: janelaDoMes("2026-04", HOJE) });

  assert.deepEqual(abril.salario_previsto, { total: 7000, quantidade: 1 });
  assert.deepEqual(abril.total_de_contas, { total: null, quantidade: 0 });

  // E o mes de marco continua respondendo o que respondia -- a janela nova nao
  // mexeu na conta, so em QUAL mes ela responde.
  const marco = painelDePapel(LINHAS, { ...ctx, janela: janelaDoMes("2026-03", HOJE) });
  assert.equal(marco.total_de_contas.total, CONTAS_DE_MARCO);
  assert.notEqual(abril.total_de_contas.total, marco.total_de_contas.total);
});

// ---------------------------------------------------------------------------
// 3. O FILTRO DE CATEGORIA
// ---------------------------------------------------------------------------
test("O filtro de categoria: aluguel recebido NAO e salario", () => {
  const painel = painelDePapel(LINHAS, ctx);

  assert.equal(painel.salario_previsto.total, 7000);

  // 9.500 = 7.000 do salario + 2.500 do aluguel recebido. E exatamente o que um
  // codigo que lesse o `expected_income` agregado da rota de resumo devolveria,
  // e e um numero com cara de salario de quem tem renda extra.
  assert.notEqual(painel.salario_previsto.total, 9500);
  assert.equal(painel.salario_previsto.quantidade, 1);
});

test("O filtro de categoria: a receita fora da categoria tambem nao vira CONTA", () => {
  // O aluguel recebido e `income`: ele nao cai no "Total de contas" so por nao
  // ser salario. As duas peneiras nao cobrem a lista inteira, e esta e a prova.
  const painel = painelDePapel(LINHAS, ctx);
  assert.equal(painel.total_de_contas.total, CONTAS_DE_MARCO);
  assert.notEqual(painel.total_de_contas.total, CONTAS_DE_MARCO + 2500);
});

test("O filtro de categoria: mais de um id de salario conta (catalogo + a propria)", () => {
  // A 036 deixa a pessoa criar a PROPRIA categoria, e o nome pode repetir o do
  // catalogo. A rota resolve os dois ids pelo mesmo nome e os dois contam.
  const MEU_SALARIO = "44444444-4444-4444-4444-444444444444";
  const linhas = [
    ...LINHAS_DO_PAR.slice(0, 1),
    {
      due_date: "2026-03-25",
      amount: 1200,
      status: "pending",
      direction: "income",
      category_id: MEU_SALARIO,
      group_id: null,
    },
  ];

  const um = painelDePapel(linhas, ctx);
  assert.deepEqual(um.salario_previsto, { total: 7000, quantidade: 1 });

  const dois = painelDePapel(linhas, {
    ...ctx,
    categoriasDeSalario: [SALARIO, MEU_SALARIO],
  });
  assert.deepEqual(dois.salario_previsto, { total: 8200, quantidade: 2 });
});

test("O filtro de categoria: linha sem category_id nunca cai no salario", () => {
  // A fatura sintetizada do cartao chega assim -- calculada, nao gravada. Ela e
  // `expense`, entao o lugar dela e o outro numero.
  const comFatura = [
    {
      due_date: "2026-03-10",
      amount: 450,
      status: "pending",
      direction: "expense",
      notes: "fatura:2026-03",
    },
  ];

  const painel = painelDePapel(comFatura, ctx);
  assert.deepEqual(painel.salario_previsto, { total: null, quantidade: 0 });
  assert.deepEqual(painel.total_de_contas, { total: 450, quantidade: 1 });
});

test("o nome da categoria e o do seed do 001, com acento", () => {
  // Digitado sem acento, o filtro nao casa com nada e o cartao do salario fica
  // vazio PARA SEMPRE, sem erro em lugar nenhum.
  assert.equal(NOME_DA_CATEGORIA_DE_SALARIO, "Salário");
});

// ---------------------------------------------------------------------------
// 4. O CASO VAZIO
// ---------------------------------------------------------------------------
test("O caso vazio: lista vazia -> indisponivel nos dois, e nao R$ 0,00", () => {
  const painel = painelDePapel([], ctx);

  assert.deepEqual(painel.salario_previsto, { total: null, quantidade: 0 });
  assert.deepEqual(painel.total_de_contas, { total: null, quantidade: 0 });

  // Zero e uma afirmacao sobre o dinheiro da pessoa, e nesta conta ela e falsa.
  assert.notEqual(painel.salario_previsto.total, 0);
  assert.notEqual(painel.total_de_contas.total, 0);
});

test("O caso vazio: tem contas mas nao tem salario -> um numero e uma frase", () => {
  const soContas = LINHAS.filter((l) => l.direction === "expense");
  const painel = painelDePapel(soContas, ctx);

  assert.equal(painel.salario_previsto.total, null);
  assert.equal(painel.total_de_contas.total, CONTAS_DE_MARCO);
});

test("O caso vazio: catalogo sem a categoria Salario -> indisponivel, nao zero", () => {
  const painel = painelDePapel(LINHAS, { ...ctx, categoriasDeSalario: [] });

  assert.deepEqual(painel.salario_previsto, { total: null, quantidade: 0 });
  // O outro numero nao e afetado.
  assert.equal(painel.total_de_contas.total, CONTAS_DE_MARCO);
});

test("O caso vazio: todas as linhas do mes canceladas -> indisponivel", () => {
  const canceladas = LINHAS.filter((l) => l.due_date.startsWith("2026-03")).map(
    (l) => ({ ...l, status: "cancelled" })
  );

  const painel = painelDePapel(canceladas, ctx);
  assert.deepEqual(painel.salario_previsto, { total: null, quantidade: 0 });
  assert.deepEqual(painel.total_de_contas, { total: null, quantidade: 0 });
});

test("as duas frases do caso vazio existem e nao dizem zero", () => {
  for (const frase of [FRASE_SEM_SALARIO, FRASE_SEM_CONTAS]) {
    assert.equal(typeof frase, "string");
    assert.ok(frase.length > 0);
    assert.ok(!/0,00|R\$/.test(frase), `a frase do caso vazio diz um valor: ${frase}`);
  }
  assert.notEqual(FRASE_SEM_SALARIO, FRASE_SEM_CONTAS);
});

// ---------------------------------------------------------------------------
// O STATUS
// ---------------------------------------------------------------------------
test("'paid' fica DENTRO do previsto; 'skipped' e 'cancelled' saem", () => {
  const base = {
    due_date: "2026-03-10",
    direction: "expense",
    category_id: SERVICOS,
    group_id: null,
  };

  const paga = painelDePapel([{ ...base, amount: 100, status: "paid" }], ctx);
  assert.deepEqual(paga.total_de_contas, { total: 100, quantidade: 1 });

  for (const status of ["skipped", "cancelled"]) {
    const fora = painelDePapel([{ ...base, amount: 100, status }], ctx);
    assert.deepEqual(
      fora.total_de_contas,
      { total: null, quantidade: 0 },
      `status ${status} deveria sair do previsto`
    );
  }

  // 'overdue' nunca e GRAVADO (a view o calcula na hora): uma conta vencida
  // continua sendo uma conta que o mes previa.
  const vencida = painelDePapel(
    [{ ...base, amount: 100, status: "pending" }],
    ctx
  );
  assert.equal(vencida.total_de_contas.total, 100);
});

// ---------------------------------------------------------------------------
// A PARTE DO GRUPO
// ---------------------------------------------------------------------------
test("a linha de grupo entra pela MINHA parte, nao pelo valor cheio", () => {
  const doGrupo = [
    {
      due_date: "2026-03-28",
      amount: 3000,
      status: "pending",
      direction: "expense",
      category_id: MORADIA,
      group_id: GRUPO_CASA,
    },
  ];

  // Duas pessoas no grupo: metade.
  const comMetade = painelDePapel(doGrupo, ctx);
  assert.deepEqual(comMetade.total_de_contas, { total: 1500, quantidade: 1 });

  // Sem a contagem de membros o valor fica CHEIO -- erra para cima, que e a
  // direcao barata (ver lib/parte-do-grupo.ts). O que nao pode e a policy do
  // 005, que devolve a previsto de grupo dos OUTROS membros, virar R$ 3.000 no
  // total de contas de quem nao cadastrou nada.
  const semMapa = painelDePapel(doGrupo, {
    ...ctx,
    membrosAtivosPorGrupo: new Map(),
  });
  assert.equal(semMapa.total_de_contas.total, 3000);
});

// ---------------------------------------------------------------------------
// A DIRECAO AUSENTE CALA O PAINEL
// ---------------------------------------------------------------------------
test("direcao ausente deixa os DOIS numeros indisponiveis", () => {
  // Se a view do 027 deixar de entregar `direction`, o default historico
  // ('expense') poria o salario dentro do total de contas: o painel mostraria
  // "nenhum salario previsto" e uma conta inflada em R$ 7.000, com cara de mes
  // apertado. A tela escreve "indisponivel" em vez disso.
  const semDirecao = LINHAS.map(({ direction, ...resto }) => resto);

  const painel = painelDePapel(semDirecao, ctx);
  assert.deepEqual(painel.salario_previsto, { total: null, quantidade: 0 });
  assert.deepEqual(painel.total_de_contas, { total: null, quantidade: 0 });
});

test("direcao ausente FORA da janela nao cala nada", () => {
  // A linha que a tela nao mostra nao pode apagar a que ela mostra. Um
  // vizinho mal formado nao derruba o mes.
  const linhas = [
    ...LINHAS_DO_PAR,
    { due_date: "2026-04-09", amount: 500, status: "pending" },
  ];

  const painel = painelDePapel(linhas, ctx);
  assert.equal(painel.salario_previsto.total, 7000);
  assert.equal(painel.total_de_contas.total, 2000);
});

// ---------------------------------------------------------------------------
// CENTAVOS
// ---------------------------------------------------------------------------
test("a soma fecha em centavos, sem o residuo do ponto flutuante", () => {
  const tresDeDezCentavos = [0.1, 0.2, 0.3].map((amount, i) => ({
    due_date: `2026-03-0${i + 1}`,
    amount,
    status: "pending",
    direction: "expense",
    category_id: SERVICOS,
    group_id: null,
  }));

  // 0.1 + 0.2 + 0.3 da 0.6000000000000001 em ponto flutuante.
  assert.equal(painelDePapel(tresDeDezCentavos, ctx).total_de_contas.total, 0.6);
});

test("amount em string (como o PostgREST entrega numeric) soma igual", () => {
  const comoTexto = LINHAS.map((l) => ({ ...l, amount: String(l.amount) }));
  const painel = painelDePapel(comoTexto, ctx);

  assert.equal(painel.salario_previsto.total, 7000);
  assert.equal(painel.total_de_contas.total, CONTAS_DE_MARCO);
});

// ---------------------------------------------------------------------------
// O PORTAO DA ROTA /dashboard
// ---------------------------------------------------------------------------
// As quatro linhas que escolhem qual painel aparece. INVERTIDAS, o app fica
// exatamente ao contrario -- quem liga o modo recebe o painel de 8 requisicoes
// e quem nao liga recebe dois numeros -- e nada nesta suite, no tsc, no lint ou
// no `next build` nota: as duas pontas existem, compilam e sao do mesmo tipo.
// E a familia de defeito de "campo de rotulo passa pela suite de aritmetica".
//
// POR QUE ESTA ASSERCAO E TEXTUAL, e qual e o limite dela
// -------------------------------------------------------
// O portao vive em `page.tsx`, que importa o `PainelCompleto` inteiro -- as 8
// chamadas de rede, o seletor de periodo, 40 modulos. Monta-lo num `file://`
// com o React UMD (o desenho de `test:papel-na-tela`) significaria esbocar
// aquilo todo, e cada esboco e um lugar onde a sonda deixa de falar do codigo
// de producao. O preco aceito e este: a assercao prova a DECISAO escrita, nao a
// tela pintada. O que ela NAO cobre e um `useModoPapel` que devolvesse `papel`
// errado -- e isso `npm run test:modo-papel` e `npm run test:papel-na-tela` ja
// cobrem, cada um de um lado.
//
// O COMENTARIO E ARRANCADO ANTES, e essa e a parte que erra calado: o cabecalho
// do portao MENCIONA os dois nomes em prosa. Sobre o texto cru, um `exigido`
// passaria verde com o `return` apagado (o comentario basta) e um `proibido`
// reprovaria sempre. O controle do proprio strip esta no caso seguinte.
const PAGINA = fileURLToPath(new URL("../app/(dashboard)/dashboard/page.tsx", import.meta.url));
const FONTE_DA_PAGINA = readFileSync(PAGINA, "utf8");

/** O codigo sem comentario -- bloco `/* *\/` e linha `//`, nessa ordem. */
const semComentario = (texto) =>
  texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const CODIGO_DA_PAGINA = semComentario(FONTE_DA_PAGINA);

test("o strip de comentario funciona -- senao todo caso abaixo e vacuo", () => {
  // Uma frase que SO existe em comentario no arquivo. Se ela sobrevive ao
  // strip, o strip nao rodou e os casos seguintes estao lendo prosa.
  assert.ok(
    /NAO E HIGIENE/.test(FONTE_DA_PAGINA),
    "a ancora do controle saiu do arquivo: reescreva este caso"
  );
  assert.ok(
    !/NAO E HIGIENE/.test(CODIGO_DA_PAGINA),
    "o strip de comentario nao removeu um comentario conhecido"
  );
});

test("o portao manda o modo papel para o PainelDePapel, e nao o contrario", () => {
  assert.match(
    CODIGO_DA_PAGINA,
    /if\s*\(\s*papel\s*\)\s*return\s*<PainelDePapel\s*\/>\s*;/,
    "o ramo do modo papel nao devolve <PainelDePapel />"
  );
  assert.match(
    CODIGO_DA_PAGINA,
    /<PainelCompleto\s*\/>/,
    "o outro ramo nao devolve <PainelCompleto />"
  );

  // E o inverso NAO esta escrito em lugar nenhum: `if (papel)` devolvendo o
  // painel completo e a unica forma do defeito que compila igual.
  assert.ok(
    !/if\s*\(\s*papel\s*\)\s*return\s*<PainelCompleto/.test(CODIGO_DA_PAGINA),
    "o portao esta invertido: com o modo ligado ele devolve o painel completo"
  );
});

test("o portao espera o `mounted` ANTES de escolher um dos dois", () => {
  // Sem isto o servidor renderiza um dos dois no chute e a hidratacao quebra --
  // a tela INTEIRA troca, nao um icone.
  assert.match(
    CODIGO_DA_PAGINA,
    /if\s*\(\s*!mounted\s*\)\s*return\s*<Girando\s*\/>\s*;/,
    "o portao nao espera o mounted"
  );

  // E a espera vem PRIMEIRO. Depois do `if (papel)` ela nao protege nada.
  const ondeMounted = CODIGO_DA_PAGINA.indexOf("!mounted");
  const ondePapel = CODIGO_DA_PAGINA.indexOf("if (papel)");
  assert.ok(ondeMounted >= 0 && ondePapel >= 0);
  assert.ok(
    ondeMounted < ondePapel,
    "o `!mounted` aparece DEPOIS da escolha do painel: ali ele nao protege nada"
  );
});

// ---------------------------------------------------------------------------
// A FIACAO DA ROTA: ela tem de LER o `?month=` e passa-lo adiante (HMO-295)
// ---------------------------------------------------------------------------
// Os casos funcionais acima provam `janelaDoMes`. O que eles NAO alcancam e a
// rota, e e la que vive o mutante da issue: uma `GET()` que nunca le a
// querystring responde o mes corrente para todo pedido, e isso compila, nao da
// erro de lint e passa por todos os casos de cima -- a funcao esta certa, so
// nao e chamada com o parametro.
//
// Nenhuma suite deste repositorio importa um `route.ts` (ele arrasta
// `next/server` e o cliente do Supabase), entao a prova aqui e TEXTUAL, e os
// limites dela sao os conhecidos:
//
//   * a ancora e o CALL SITE com os argumentos, e nao o nome da funcao. Um
//     `exigido("janelaDoMes")` passaria verde com `import { janelaDoMes }`
//     intacto e a chamada apagada -- e tambem com `janelaDoMes(null, hoje)`,
//     que e o mutante escrito de outro jeito;
//   * o comentario e arrancado ANTES. O cabecalho da rota MENCIONA `month` e
//     `janelaDoMes` em prosa: sobre o texto cru, um `proibido` reprovaria
//     sempre e um `exigido` passaria com o codigo apagado. O controle do
//     proprio strip e o primeiro caso abaixo.
const ROTA = fileURLToPath(
  new URL("../app/api/papel-de-pao/painel/route.ts", import.meta.url)
);
const FONTE_DA_ROTA = readFileSync(ROTA, "utf8");
const CODIGO_DA_ROTA = semComentario(FONTE_DA_ROTA);

test("o strip de comentario funciona na rota -- senao os casos dela sao vacuos", () => {
  // Uma frase que SO existe em comentario no route.ts. Se ela sobrevive ao
  // strip, o strip nao rodou e os casos seguintes estao lendo prosa.
  assert.ok(
    /ECOA o mes que saiu da querystring/.test(FONTE_DA_ROTA),
    "a ancora do controle saiu do route.ts: reescreva este caso"
  );
  assert.ok(
    !/ECOA o mes que saiu da querystring/.test(CODIGO_DA_ROTA),
    "o strip de comentario nao removeu um comentario conhecido do route.ts"
  );
});

test("a GET recebe o request -- sem ele nao ha querystring para ler", () => {
  // A `GET()` de antes desta issue nao recebia parametro nenhum. Esta e a forma
  // mais crua do mutante, e a unica que o tsc tambem pegaria (o `request.url`
  // abaixo nao compilaria) -- as outras duas, nao.
  assert.match(
    CODIGO_DA_ROTA,
    /export\s+async\s+function\s+GET\s*\(\s*request\s*:/,
    "a GET do painel voltou a nao receber o request"
  );
});

test("a rota LE o `month` da querystring", () => {
  assert.match(
    CODIGO_DA_ROTA,
    /request\.nextUrl\.searchParams\.get\s*\(\s*"month"\s*\)/,
    "a rota nao le `month` dos searchParams do request"
  );
});

test("a rota passa o `month` para `janelaDoMes`, e nao fixa o mes corrente", () => {
  // O call site COM os argumentos. `janelaDoMes(null, hoje)` e
  // `janelaDoMesCorrente(hoje)` sao as duas formas do mutante que compilam
  // igual, e as duas falham aqui.
  assert.match(
    CODIGO_DA_ROTA,
    /janelaDoMes\s*\(\s*month\s*,\s*hoje\s*\)/,
    "a rota nao chama janelaDoMes(month, hoje)"
  );

  // E a porta do mes corrente NAO esta aberta em paralelo. `janelaDoMesCorrente`
  // continua existindo em lib/ (e `janelaDoMes` o chama como rede), mas na rota
  // ele e o mutante: chamado ali, o `?month=` nao chega a lugar nenhum.
  assert.ok(
    !/janelaDoMesCorrente/.test(CODIGO_DA_ROTA),
    "a rota voltou a calcular o mes corrente por conta propria"
  );
});

test("a rota materializa a janela do mes PEDIDO, e nao outra", () => {
  // O elo do "mes seguinte ja materializa": abrir novembro cria as linhas das
  // regras recorrentes de novembro, que e literalmente o que o comentario da
  // issue pede. Materializar a janela do mes corrente aqui deixaria novembro
  // dizendo "nenhuma conta prevista" com o resto da rota correto.
  assert.match(
    CODIGO_DA_ROTA,
    /janelaParaMaterializar\s*\(\s*janela\s*,\s*hoje\s*\)/,
    "a rota nao materializa a janela pedida"
  );

  // E a leitura das linhas usa os extremos DESSA janela, nos dois lados.
  assert.match(CODIGO_DA_ROTA, /\.gte\s*\(\s*"due_date"\s*,\s*janela\.de\s*\)/);
  assert.match(CODIGO_DA_ROTA, /\.lte\s*\(\s*"due_date"\s*,\s*janela\.ate\s*\)/);
});

test("o `month` da resposta sai da janela, e nao do relogio", () => {
  // Se ele saisse de `hoje`, a tela descartaria toda resposta de outro mes --
  // o painel ficaria "indisponivel" em novembro com a conta certa por baixo.
  assert.match(
    CODIGO_DA_ROTA,
    /month:\s*janela\.de\.slice\(0,\s*7\)/,
    "o campo `month` da resposta nao sai de janela.de"
  );
});

test("o portao le a preferencia pelo hook, e nao pelo localStorage na mao", () => {
  // `useModoPapel` e o unico lugar com o estado em memoria e o `mounted`. Ler o
  // storage direto aqui criaria a segunda fonte da verdade, e as duas
  // divergiriam no primeiro clique no papelzinho.
  assert.match(CODIGO_DA_PAGINA, /useModoPapel\s*\(\s*\)/);
  assert.ok(
    !/localStorage/.test(CODIGO_DA_PAGINA),
    "a pagina le o localStorage direto em vez de usar o useModoPapel"
  );
});
