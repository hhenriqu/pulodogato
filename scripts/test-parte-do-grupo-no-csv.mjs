// =====================================================
// PULODOGATO - a parte de grupo no CSV de relatorio (HMO-207)
// =====================================================
//   npm run test:parte-do-grupo-no-csv
//
// A HMO-202 fez o realizado PESSOAL contar A MINHA PARTE das despesas de grupo
// lendo as views da 033, e mudou duas rotas: /api/reports/cash-flow e
// /api/reports/categories. Deixou /api/reports/export de fora. O resultado,
// medido em producao em 01/10/2026:
//
//   fonte                                    BRL            USD
//   /api/reports/cash-flow        (a TELA)   saidas 67,89   saidas 180,00
//   /api/reports/export?cash-flow (o CSV)    saidas 67,89   LINHA AUSENTE
//
// POR QUE A ASSERCAO E DE IGUALDADE, E NAO "O CSV TEM UMA LINHA DE GRUPO"
// ----------------------------------------------------------------------
// Esta e a decisao de desenho desta suite, e e a razao de ela compilar TRES
// route handlers em vez de um.
//
// "O CSV tem uma linha de USD" passa verde com um conserto errado. Se alguem
// acrescentasse a parte de grupo por outro criterio -- dividindo pelo numero de
// membros, como o PREVISTO faz em lib/parte-do-grupo.ts, em vez de ler o rateio
// gravado --, o arquivo ganharia a linha de dolar e continuaria discordando da
// tela. O usuario veria 180,00 na tela e 200,00 no arquivo, e as duas fontes
// voltariam a se contradizer num numero DIFERENTE do original. A assercao teria
// medido outra coisa.
//
// Entao a sonda chama o export E a tela sobre o MESMO fixture e exige que os
// numeros batam POR MOEDA. Nenhum valor esperado e escrito a mao aqui: o
// esperado e sempre o que a outra rota respondeu. E o unico formato que nao
// volta a divergir no proximo relatorio -- se amanha a definicao da parte mudar,
// as duas mudam juntas ou a suite fica vermelha.
//
// POR QUE A JANELA E DE UM MES
// ----------------------------
// Nao e para simplificar: e para as duas fontes PARTICIONAREM igual. O CSV
// despeja uma linha por (mes, moeda, categoria) e a tela SOMA os meses da janela
// por (moeda, categoria). Numa janela de doze meses os dois estariam certos e
// nao seriam comparaveis linha a linha. Com `months=1` a particao e a mesma, e a
// igualdade e uma igualdade de verdade e nao uma reconciliacao escrita a mao --
// que seria um terceiro lugar para errar a conta.
//
// A janela sai de `janelaDeMeses("1")`, a MESMA funcao que as rotas chamam, e
// nao de aritmetica de data local. `janelaDeMeses` ancora no mes corrente, e um
// fixture com mes cravado passaria a medir janela vazia na virada do mes -- a
// suite ficaria verde por vacuidade. Ver o controle de vacuidade na secao 0.
// =====================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { criarDuble } from "./duble-de-supabase.mjs";

const RAIZ = "../.tmp-parte-do-grupo-no-csv";

const EXPORT = await import(`${RAIZ}/app/api/reports/export/route.js`);
const TELA_FLUXO = await import(`${RAIZ}/app/api/reports/cash-flow/route.js`);
const TELA_CATEGORIAS = await import(
  `${RAIZ}/app/api/reports/categories/route.js`
);
const { janelaDeMeses } = await import(`${RAIZ}/lib/services/reports.js`);

/** A janela que as rotas vao calcular, pela funcao que elas mesmas usam. */
const JANELA = janelaDeMeses("1");
const MES = JANELA.inicio;

const EU = "11111111-1111-1111-1111-111111111111";
const OUTRO = "22222222-2222-2222-2222-222222222222";
const ESTRANHO = "33333333-3333-3333-3333-333333333333";
const GRUPO = "99999999-9999-9999-9999-999999999999";

const ALIMENTACAO = "cat-alimentacao";
const FREELANCE = "cat-freelance";

// ---------------------------------------------------------------------------
// O FIXTURE: O CASO MEDIDO EM PRODUCAO, COM UM SEGUNDO MEMBRO
// ---------------------------------------------------------------------------
// A despesa de grupo e um jantar de USD 360,00 pago por EU, dividido meio a
// meio: a parte de cada um e 180,00. Os numeros em real (67,89 de saida e
// 111,11 de entrada) sao os da medicao de producao e nao tem nada de grupo --
// eles estao aqui para provar que o conserto nao MEXEU no que ja estava certo.
//
// As quatro views da 033 sao SEMEADAS, nao calculadas: elas estao em producao e
// o que esta sob teste e qual delas cada rota le. Recalcular o rateio aqui
// criaria no fixture a segunda implementacao de divisao que a 033 existe para
// nao haver -- e a suite passaria a concordar consigo mesma em vez de com o
// banco.
//
// A LINHA DE `OUTRO` E O QUE FAZ O `eq("user_id")` SER MEDIDO. As views da 033
// nao filtram `user_id` (esta escrito no COMMENT delas) e as policies de grupo
// tem `OR is_group_member(...)`: uma consulta sem o filtro traz a parte do outro
// membro junto e soma 360,00 onde o certo e 180,00. Sem esta linha no fixture,
// apagar o `eq("user_id")` da rota nao mudaria nenhum numero e o mutante
// sobreviveria.
const personalCategoria = [
  {
    user_id: EU,
    month: MES,
    category_id: ALIMENTACAO,
    expense: 67.89,
    income: 0,
    net: -67.89,
    transaction_count: 2,
    currency: "BRL",
  },
  {
    user_id: EU,
    month: MES,
    category_id: FREELANCE,
    expense: 0,
    income: 111.11,
    net: 111.11,
    transaction_count: 1,
    currency: "BRL",
  },
  // A MINHA parte do jantar: metade de 360.
  {
    user_id: EU,
    month: MES,
    category_id: ALIMENTACAO,
    expense: 180.0,
    income: 0,
    net: -180.0,
    transaction_count: 1,
    currency: "USD",
  },
  // A parte do OUTRO membro -- visivel pela RLS de grupo, e que nao pode entrar
  // no relatorio de EU.
  {
    user_id: OUTRO,
    month: MES,
    category_id: ALIMENTACAO,
    expense: 180.0,
    income: 0,
    net: -180.0,
    transaction_count: 1,
    currency: "USD",
  },
];

/** Rollup de `personalCategoria`, como a 033 define a view. */
const personalFluxo = [
  {
    user_id: EU,
    month: MES,
    income: 111.11,
    expense: 67.89,
    net: 43.22,
    transaction_count: 3,
    currency: "BRL",
  },
  {
    user_id: EU,
    month: MES,
    income: 0,
    expense: 180.0,
    net: -180.0,
    transaction_count: 1,
    currency: "USD",
  },
  {
    user_id: OUTRO,
    month: MES,
    income: 0,
    expense: 180.0,
    net: -180.0,
    transaction_count: 1,
    currency: "USD",
  },
];

// As views do 008, com `group_id` no grao. A linha de grupo tem o valor CHEIO
// do jantar (360), que e o numero certo no painel DO GRUPO.
const categoriaComGrupo = [
  {
    user_id: EU,
    month: MES,
    category_id: ALIMENTACAO,
    group_id: null,
    expense: 67.89,
    income: 0,
    net: -67.89,
    transaction_count: 2,
    currency: "BRL",
  },
  {
    user_id: EU,
    month: MES,
    category_id: FREELANCE,
    group_id: null,
    expense: 0,
    income: 111.11,
    net: 111.11,
    transaction_count: 1,
    currency: "BRL",
  },
  {
    user_id: EU,
    month: MES,
    category_id: ALIMENTACAO,
    group_id: GRUPO,
    expense: 360.0,
    income: 0,
    net: -360.0,
    transaction_count: 1,
    currency: "USD",
  },
];

const fluxoComGrupo = [
  {
    user_id: EU,
    month: MES,
    group_id: null,
    income: 111.11,
    expense: 67.89,
    net: 43.22,
    transaction_count: 3,
    currency: "BRL",
  },
  {
    user_id: EU,
    month: MES,
    group_id: GRUPO,
    income: 0,
    expense: 360.0,
    net: -360.0,
    transaction_count: 1,
    currency: "USD",
  },
];

const categorias = [
  {
    id: ALIMENTACAO,
    name: "Alimentação",
    icon: "utensils",
    color_hex: "#ef4444",
    is_expense: true,
  },
  {
    id: FREELANCE,
    name: "Freelance",
    icon: "briefcase",
    color_hex: "#22c55e",
    is_expense: false,
  },
];

const perfis = [EU, OUTRO, ESTRANHO].map((id) => ({
  id,
  preferences: { moeda: { oficial: "BRL" } },
}));

function tabelas() {
  return {
    personal_monthly_cash_flow: personalFluxo,
    personal_category_monthly_totals: personalCategoria,
    monthly_cash_flow: fluxoComGrupo,
    category_monthly_totals: categoriaComGrupo,
    transaction_categories: categorias,
    profiles: perfis,
  };
}

/**
 * Chama um route handler com o duble instalado.
 *
 * `exigeDuble` e o controle positivo de [[route-handler-roda-no-node-com-duble-de-client]]:
 * se a rota trocar o jeito de obter o client, o duble deixa de ser consultado,
 * a resposta sai plausivel e TODA assercao abaixo passaria por vacuidade. A
 * contagem e a unica coisa que percebe isso.
 */
async function chamar(rota, url, { user = EU, erros = {} } = {}) {
  const sessao = criarDuble({
    user: user ? { id: user } : null,
    tabelas: tabelas(),
    erros,
  });

  const registro = { sessao: () => sessao.client };
  globalThis.__dubleDeSupabase = registro;

  let resposta;
  try {
    resposta = await rota.GET({ url });
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  assert.ok(
    (registro.chamadasDeSessao ?? 0) > 0,
    `controle positivo: ${url} nao abriu o client de SESSAO. Sem ele a ` +
      "resposta medida abaixo nao veio do fixture e a igualdade e ficticia."
  );

  return { resposta, lidas: sessao.lidas };
}

/**
 * As linhas de um CSV desta rota, como objetos.
 *
 * BOM na frente e `\r\n` entre linhas (ver montarCsv em lib/services/reports.ts).
 * O `split(";")` cru basta porque nenhum campo deste fixture tem `;`, aspa ou
 * quebra de linha -- `campoCsv` so cita nesses casos. Um fixture que precisasse
 * de campo citado precisaria de parser, e NAO deve ser escrito sem ele: o
 * `split` silenciosamente partiria o campo em dois e a comparacao mediria
 * colunas trocadas.
 */
// `texto` JA vem sem o BOM: `Response.text()` decodifica UTF-8 e o decodificador
// descarta um U+FEFF inicial. O BOM esta nos BYTES (e e la que o Excel o le) --
// ver `bomDosBytes`, que e onde ele e conferido. Procurar o BOM aqui reprovaria
// um CSV correto.
function lerCsv(texto) {
  const linhas = texto.split("\r\n").filter((l) => l.length > 0);

  const cabecalho = linhas[0].split(";");

  for (const campo of linhas.slice(1)) {
    assert.ok(
      !campo.includes('"'),
      `campo citado no CSV (${campo}) -- lerCsv nao sabe ler isso, ver o ` +
        "comentario desta funcao"
    );
  }

  return linhas.slice(1).map((linha) => {
    const campos = linha.split(";");
    return Object.fromEntries(cabecalho.map((c, i) => [c, campos[i]]));
  });
}

/**
 * "67,89" -> 67.89. O CSV sai em decimal pt-BR.
 *
 * Vale TAMBEM para a coluna "Lançamentos", e isso surpreende: `montarCsv`
 * formata todo valor numerico com `formatarNumeroCsv`, entao uma contagem de 3
 * lancamentos sai "3,00". `Number("3,00")` e NaN, e um `assert.equal(NaN, 3)`
 * falha com uma mensagem que nao diz por que.
 */
function numeroDoCsv(texto) {
  assert.match(
    texto,
    /^-?\d+,\d{2}$/,
    `"${texto}" nao esta no formato de numero do CSV pt-BR (duas casas, virgula)`
  );
  return Number(texto.replace(",", "."));
}

/**
 * Os tres primeiros BYTES do corpo, para conferir o BOM onde ele existe.
 *
 * Sem o BOM o Excel em pt-BR le o arquivo como ANSI e "Alimentação" chega como
 * "AlimentaÃ§Ã£o" -- ver montarCsv em lib/services/reports.ts. Conferir isso em
 * `text()` e impossivel: o decodificador de UTF-8 come o U+FEFF inicial, e a
 * assercao reprovaria um arquivo correto.
 */
async function bomDosBytes(resposta) {
  const bytes = new Uint8Array(await resposta.arrayBuffer());
  return [...bytes.slice(0, 3)];
}

const DOIS_CASAS = (n) => Number(Number(n).toFixed(2));

/**
 * Indexa as linhas do CSV e RECUSA chave repetida.
 *
 * A recusa e a assercao, nao uma defesa do helper. Este CSV nao agrega: ele
 * despeja as linhas da view. O grao da view pessoal e (user_id, mes, moeda)
 * -- e (…, categoria) na de categorias --, entao numa janela de UM mes e com
 * UM usuario cada chave aparece exatamente uma vez. Duas linhas com a mesma
 * chave significam que a consulta trouxe a parte de MAIS DE UM membro.
 *
 * Sem isto o `eq("user_id")` fica sem medida: um `new Map(...)` guarda a
 * ULTIMA linha de cada chave, e as duas linhas de USD (a minha parte, 180, e a
 * do outro membro, tambem 180) tem o mesmo valor. O total comparado com a tela
 * bateria, o mutante que apaga o filtro sobreviveria, e a planilha do usuario
 * mostraria o jantar duas vezes.
 */
function mapaSemDuplicata(linhas, chaveDe, oQue) {
  const mapa = new Map();

  for (const linha of linhas) {
    const chave = chaveDe(linha);
    assert.ok(
      !mapa.has(chave),
      `linha repetida no CSV de ${oQue}: ${chave} aparece mais de uma vez. ` +
        "O grao da view da UMA linha por chave para um usuario num mes -- " +
        "repetida significa que a consulta somou a parte de outro membro."
    );
    mapa.set(chave, linha);
  }

  return mapa;
}

// ===========================================================================
// SECAO 0 - controle de vacuidade: o fixture tem de estar DENTRO da janela
// ===========================================================================
// `janelaDeMeses` ancora no mes corrente. Se o fixture caisse fora da janela,
// as duas fontes responderiam VAZIO e a igualdade da secao 1 passaria verde
// medindo nada -- o modo de falha mais perigoso desta suite, porque ele fica
// verde para sempre e nao aparece em nenhum diff.
test("secao 0: a janela de um mes alcanca o fixture (anti-vacuidade)", async () => {
  assert.equal(JANELA.meses, 1);
  assert.equal(JANELA.inicio, JANELA.fim, "months=1 recorta um mes so");

  const { resposta } = await chamar(
    EXPORT,
    "https://exemplo.test/api/reports/export?report=cash-flow&months=1"
  );
  const linhas = lerCsv(await resposta.text());

  assert.ok(
    linhas.length > 0,
    `o CSV saiu so com cabecalho: o fixture esta no mes ${MES} e a janela ` +
      `pediu ${JANELA.inicio}..${JANELA.fim}. Toda assercao de igualdade desta ` +
      "suite passaria por vacuidade."
  );

  const moedas = new Set(linhas.map((l) => l.Moeda));
  assert.deepEqual(
    [...moedas].sort(),
    ["BRL", "USD"],
    "o fixture tem de produzir DUAS moedas: a divergencia da HMO-207 era " +
      "exatamente a moeda que faltava no arquivo"
  );

  // O corpo so pode ser lido uma vez, entao o BOM sai de uma segunda chamada.
  const { resposta: outra } = await chamar(
    EXPORT,
    "https://exemplo.test/api/reports/export?report=cash-flow&months=1"
  );
  assert.deepEqual(
    await bomDosBytes(outra),
    [0xef, 0xbb, 0xbf],
    "o CSV perdeu o BOM -- o Excel pt-BR leria 'Alimentação' como 'AlimentaÃ§Ã£o'"
  );
});

// ===========================================================================
// SECAO 1 - a igualdade que a issue pede: export?report=cash-flow == cash-flow
// ===========================================================================
test("secao 1: o CSV de fluxo de caixa bate com a tela, POR MOEDA", async () => {
  const { resposta: csv } = await chamar(
    EXPORT,
    "https://exemplo.test/api/reports/export?report=cash-flow&months=1"
  );
  const { resposta: tela } = await chamar(
    TELA_FLUXO,
    "https://exemplo.test/api/reports/cash-flow?months=1"
  );

  const linhas = lerCsv(await csv.text());
  const corpo = await tela.json();

  assert.equal(corpo.grao, "mes", "a tela tem de responder no mesmo grao");

  const doCsv = mapaSemDuplicata(linhas, (l) => l.Moeda, "fluxo de caixa");
  const daTela = new Map(corpo.by_currency.map((b) => [b.currency, b]));

  assert.deepEqual(
    [...doCsv.keys()].sort(),
    [...daTela.keys()].sort(),
    "as DUAS fontes tem de cobrir as mesmas moedas. Era exatamente aqui que a " +
      "HMO-207 doia: a tela trazia USD e o arquivo nao."
  );

  for (const [moeda, bloco] of daTela) {
    const linha = doCsv.get(moeda);

    assert.equal(
      numeroDoCsv(linha["Saídas"]),
      DOIS_CASAS(bloco.summary.total_expense),
      `saidas em ${moeda} discordam entre o CSV e a tela`
    );
    assert.equal(
      numeroDoCsv(linha.Entradas),
      DOIS_CASAS(bloco.summary.total_income),
      `entradas em ${moeda} discordam entre o CSV e a tela`
    );
    assert.equal(
      numeroDoCsv(linha.Resultado),
      DOIS_CASAS(bloco.summary.net),
      `resultado em ${moeda} discorda entre o CSV e a tela`
    );
    assert.equal(
      numeroDoCsv(linha["Lançamentos"]),
      bloco.summary.transaction_count,
      `contagem em ${moeda} discorda entre o CSV e a tela`
    );
  }
});

// ===========================================================================
// SECAO 2 - a mesma igualdade no outro relatorio
// ===========================================================================
test("secao 2: o CSV por categoria bate com a tela, POR MOEDA E CATEGORIA", async () => {
  const { resposta: csv } = await chamar(
    EXPORT,
    "https://exemplo.test/api/reports/export?report=categories&months=1"
  );
  const { resposta: tela } = await chamar(
    TELA_CATEGORIAS,
    "https://exemplo.test/api/reports/categories?months=1"
  );

  const linhas = lerCsv(await csv.text());
  const corpo = await tela.json();

  const chave = (moeda, categoria) => `${moeda}|${categoria}`;

  const doCsv = mapaSemDuplicata(
    linhas,
    (l) => chave(l.Moeda, l.Categoria),
    "gastos por categoria"
  );

  const daTela = new Map();
  for (const bloco of corpo.by_currency) {
    for (const c of bloco.categories) {
      daTela.set(chave(bloco.currency, c.category?.name ?? "Sem categoria"), c);
    }
  }

  assert.deepEqual(
    [...doCsv.keys()].sort(),
    [...daTela.keys()].sort(),
    "as duas fontes tem de cobrir os mesmos pares (moeda, categoria). A " +
      "medicao de producao mostrava o CSV sem a linha USD/Alimentação."
  );

  for (const [k, c] of daTela) {
    const linha = doCsv.get(k);

    assert.equal(
      numeroDoCsv(linha["Saídas"]),
      DOIS_CASAS(c.expense),
      `saidas em ${k} discordam entre o CSV e a tela`
    );
    assert.equal(
      numeroDoCsv(linha.Entradas),
      DOIS_CASAS(c.income),
      `entradas em ${k} discordam entre o CSV e a tela`
    );
    assert.equal(
      numeroDoCsv(linha["Lançamentos"]),
      c.transaction_count,
      `contagem em ${k} discorda entre o CSV e a tela`
    );
  }
});

// ===========================================================================
// SECAO 3 - a fonte: o CSV le as views da 033, nao as do 008 com filtro
// ===========================================================================
// A secao 1 provaria igualdade tambem se as DUAS rotas lessem a view errada
// juntas. Esta secao crava a view, que e o que o conserto afirma.
test("secao 3: o CSV pessoal le as views da 033", async () => {
  const { lidas: lidasFluxo } = await chamar(
    EXPORT,
    "https://exemplo.test/api/reports/export?report=cash-flow&months=1"
  );

  const tabelasFluxo = lidasFluxo.map((l) => l.tabela);
  assert.ok(
    tabelasFluxo.includes("personal_monthly_cash_flow"),
    `o CSV de fluxo nao leu personal_monthly_cash_flow (leu ${tabelasFluxo.join(", ")})`
  );
  assert.ok(
    !tabelasFluxo.includes("monthly_cash_flow"),
    "o CSV de fluxo pessoal ainda le monthly_cash_flow -- a view do 008 com " +
      "`group_id IS NULL` e justamente a que esconde a parte de grupo"
  );

  const { lidas: lidasCat } = await chamar(
    EXPORT,
    "https://exemplo.test/api/reports/export?report=categories&months=1"
  );

  const tabelasCat = lidasCat.map((l) => l.tabela);
  assert.ok(
    tabelasCat.includes("personal_category_monthly_totals"),
    `o CSV por categoria nao leu personal_category_monthly_totals (leu ${tabelasCat.join(", ")})`
  );
  assert.ok(
    !tabelasCat.includes("category_monthly_totals"),
    "o CSV por categoria ainda le category_monthly_totals"
  );
});

// ===========================================================================
// SECAO 4 - o `eq("user_id")` e load-bearing
// ===========================================================================
// As views da 033 NAO filtram user_id, e as policies de grupo tem
// `OR is_group_member(...)`. Sem o filtro na rota vem a parte dos OUTROS
// membros: 360,00 onde o certo e 180,00. O fixture tem a linha de `OUTRO`
// exatamente para que apagar o filtro mude um numero.
test("secao 4: o CSV nao traz a parte dos outros membros", async () => {
  const { resposta, lidas } = await chamar(
    EXPORT,
    "https://exemplo.test/api/reports/export?report=cash-flow&months=1"
  );

  const usd = lerCsv(await resposta.text()).find((l) => l.Moeda === "USD");

  assert.equal(
    numeroDoCsv(usd["Saídas"]),
    180.0,
    "a saida em USD tem de ser A MINHA parte (180). 360 significa que a " +
      "consulta somou a parte do outro membro; 0 significa que ela voltou a " +
      "esconder a despesa de grupo."
  );

  const consulta = lidas.find((l) => l.tabela === "personal_monthly_cash_flow");
  assert.ok(
    consulta.filtros.some(([op, col, val]) => op === "eq" && col === "user_id" && val === EU),
    "a leitura da view pessoal saiu sem `eq(user_id)`"
  );
});

// ===========================================================================
// SECAO 5 - controle negativo: quem nao e do grupo nao ganha linha nenhuma
// ===========================================================================
test("secao 5: usuario fora do grupo nao recebe linha de grupo", async () => {
  for (const report of ["cash-flow", "categories"]) {
    const { resposta } = await chamar(
      EXPORT,
      `https://exemplo.test/api/reports/export?report=${report}&months=1`,
      { user: ESTRANHO }
    );

    const texto = await resposta.text();

    assert.deepEqual(
      lerCsv(texto),
      [],
      `${report}: o CSV de quem nao tem lancamento nenhum saiu com linhas`
    );
    assert.ok(
      !texto.includes("180,00") && !texto.includes("360,00"),
      `${report}: a parte de grupo de outra pessoa apareceu no CSV de ESTRANHO`
    );
  }
});

// ===========================================================================
// SECAO 6 - o relatorio DO GRUPO continua com o valor CHEIO
// ===========================================================================
// O conserto nao pode ter trocado a view do caminho `?groupId=`: la o numero
// certo e o jantar inteiro (360), de todos os membros, e nao a parte de um.
test("secao 6: com groupId o CSV mantem o valor cheio e bate com a tela", async () => {
  const { resposta: csv, lidas } = await chamar(
    EXPORT,
    `https://exemplo.test/api/reports/export?report=cash-flow&months=1&groupId=${GRUPO}`
  );
  const { resposta: tela } = await chamar(
    TELA_FLUXO,
    `https://exemplo.test/api/reports/cash-flow?months=1&groupId=${GRUPO}`
  );

  const linhas = lerCsv(await csv.text());
  const corpo = await tela.json();

  const usd = linhas.find((l) => l.Moeda === "USD");
  assert.equal(
    numeroDoCsv(usd["Saídas"]),
    360.0,
    "o painel do grupo mostra a despesa CHEIA; 180 significa que o caminho de " +
      "grupo passou a ler a view pessoal"
  );

  const blocoUsd = corpo.by_currency.find((b) => b.currency === "USD");
  assert.equal(
    numeroDoCsv(usd["Saídas"]),
    DOIS_CASAS(blocoUsd.summary.total_expense),
    "o CSV do grupo discorda da tela do grupo"
  );

  const tabelasLidas = lidas.map((l) => l.tabela);
  assert.ok(
    tabelasLidas.includes("monthly_cash_flow") &&
      !tabelasLidas.includes("personal_monthly_cash_flow"),
    `o caminho de grupo leu a view errada (${tabelasLidas.join(", ")})`
  );
});

// ===========================================================================
// SECAO 7 - a janela entre o deploy e a colagem da migration
// ===========================================================================
// Producao nao tem runner de migration: o deploy publica CODIGO, nao schema.
// Num banco onde a 033 ainda nao foi colada as views nao existem, e a rota cai
// para o comportamento ANTIGO em vez de entregar arquivo vazio -- que numa
// planilha se le como "nao houve movimento no periodo".
//
// E so para os dois codigos de relacao inexistente: erro de verdade nao pode
// virar queda silenciosa. Ver viewDaParteAusente em lib/parte-do-grupo-realizada.ts.
test("secao 7: sem a 033 colada, o CSV cai para a view antiga", async () => {
  for (const code of ["42P01", "PGRST205"]) {
    const { resposta } = await chamar(
      EXPORT,
      "https://exemplo.test/api/reports/export?report=cash-flow&months=1",
      { erros: { personal_monthly_cash_flow: { code, message: "nao existe" } } }
    );

    const linhas = lerCsv(await resposta.text());

    assert.ok(
      linhas.length > 0,
      `${code}: o CSV saiu vazio em vez de cair para monthly_cash_flow`
    );

    const brl = linhas.find((l) => l.Moeda === "BRL");
    assert.equal(
      numeroDoCsv(brl["Saídas"]),
      67.89,
      `${code}: a queda tem de devolver o numero de antes da 033`
    );
    assert.equal(
      linhas.find((l) => l.Moeda === "USD"),
      undefined,
      `${code}: a queda e para o comportamento ANTIGO -- sem a parte de grupo`
    );
  }
});

test("secao 7b: erro que NAO e view ausente nao vira queda silenciosa", async () => {
  const { resposta, lidas } = await chamar(
    EXPORT,
    "https://exemplo.test/api/reports/export?report=cash-flow&months=1",
    {
      erros: {
        // 42501 = permissao negada. Uma quebra de RLS nao pode ser lida como
        // "a migration nao foi colada": o arquivo sairia com numeros velhos
        // para sempre, sem ninguem saber.
        personal_monthly_cash_flow: { code: "42501", message: "permissao" },
      },
    }
  );

  await resposta.text();

  assert.ok(
    !lidas.map((l) => l.tabela).includes("monthly_cash_flow"),
    "erro 42501 disparou a queda para a view antiga -- viewDaParteAusente " +
      "passou a engolir erro de verdade"
  );
});

// ===========================================================================
// SECAO 8 - os dois ramos que NAO mudam, e por que
// ===========================================================================
// `planned` e `transactions` continuam filtrando `group_id IS NULL`, e isso e
// uma conclusao medida e nao um esquecimento -- foi o esquecimento SEM
// comentario da HMO-202 que produziu esta issue.
//
//   planned      -> /api/reports/planned-vs-actual faz o MESMO filtro sobre a
//                   MESMA view. Os dois lados ja concordam.
//   transactions -> o substituto da lista da tela e
//                   /api/personal-finance/transactions/export, nao este
//                   relatorio. Ver o cabecalho daquele arquivo.
//
// A assercao e sobre a LEITURA e nao sobre o texto do fonte: um guard textual
// ficaria verde com o comentario intacto e a consulta trocada.
test("secao 8: planned e transactions continuam sem a parte de grupo", async () => {
  const { lidas } = await chamar(
    EXPORT,
    "https://exemplo.test/api/reports/export?report=planned&months=1"
  );

  const consulta = lidas.find((l) => l.tabela === "planned_vs_actual");
  assert.ok(consulta, "o relatorio planned deixou de ler planned_vs_actual");
  assert.ok(
    consulta.filtros.some(
      ([op, col, val]) => op === "is" && col === "group_id" && val === null
    ),
    "o relatorio planned perdeu o `group_id IS NULL` -- ele tem de continuar " +
      "igual a /api/reports/planned-vs-actual, que faz o mesmo filtro"
  );

  const { lidas: lidasExtrato } = await chamar(
    EXPORT,
    "https://exemplo.test/api/reports/export?report=transactions&months=1"
  );

  const extrato = lidasExtrato.find(
    (l) => l.tabela === "financial_transactions"
  );
  assert.ok(extrato, "o extrato deixou de ler financial_transactions");
  assert.ok(
    extrato.filtros.some(
      ([op, col, val]) => op === "is" && col === "group_id" && val === null
    ),
    "o extrato perdeu o `group_id IS NULL`; o substituto da lista da tela e " +
      "/api/personal-finance/transactions/export, e misturar os dois dobraria " +
      "a despesa de grupo (a linha cheia MAIS a parte)"
  );
});
