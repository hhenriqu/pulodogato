// =====================================================
// PULODOGATO - a paginacao do ramo de INTERVALO (HMO-417)
// =====================================================
//   npm run test:paginacao-do-intervalo
//
// O QUE ESTA SUITE EXISTE PARA TORNAR POSSIVEL
// --------------------------------------------
// `/api/reports/cash-flow` tem dois ramos. O de MES sai dos rollups do 008 e
// tinha sonda desde a HMO-207 (scripts/test-parte-do-grupo-no-csv.mjs). O de
// INTERVALO -- o que soma `financial_transactions` crua no JavaScript, e o que o
// painel principal usa, porque `cartao=fatura` sempre cai nele -- nao tinha
// NENHUMA, e nao por esquecimento: ele pagina as duas consultas que soma com
// `.range(inicio, inicio + TAMANHO_DA_PAGINA - 1)`, e o duble de client
// (scripts/duble-de-supabase.mjs) nao implementava `range`.
//
// O sintoma disso era o pior possivel para quem fosse escrever a sonda:
// `api.range is not a function` estoura DENTRO do `try` da rota, o `catch`
// devolve `500 {"error":"Erro interno"}`, e uma assercao sobre a resposta mede o
// CAMINHO DE ERRO achando que mede a feature. Ver o controle positivo de
// scripts/test-semeadura-pela-renda.mjs, que existe por esse mesmo motivo.
//
// POR QUE A PROVA TEM DE PAGINAR DE VERDADE
// -----------------------------------------
// "O metodo existe" nao e o criterio. Um `range` que ignorasse os argumentos e
// devolvesse a lista inteira passaria por qualquer sonda com fixture pequeno --
// e voltaria a mentir no dia em que a rota mudasse o tamanho da pagina. Entao o
// fixture daqui tem MAIS LINHAS QUE UMA PAGINA, e as assercoes sao sobre
// dinheiro: o total do periodo tem de conter a linha que so existe na SEGUNDA
// pagina.
//
// Os dois off-by-one possiveis estao cobertos, e os dois erram dinheiro para
// MENOS sem nenhum erro na resposta:
//
//   * `ate` exclusivo (um `slice(de, ate)` no duble) -> a pagina volta com 999
//     linhas, a rota le isso como pagina incompleta (`lote.length <
//     TAMANHO_DA_PAGINA`), para na primeira volta e perde o resto do periodo;
//   * corte APLICADO NA HORA em vez de no terminador -> a rota encadeia
//     `.range()` ANTES do `.eq("user_id")` (o `eq` sai do ternario no fim de
//     `pagina`), entao o corte pegaria as mil primeiras linhas da TABELA e so
//     depois tiraria as de outros usuarios. A secao 1 tem linhas de outro
//     usuario ORDENADAS NA FRENTE exatamente para que isso mude um numero.
//
// O TAMANHO DA PAGINA NAO E ESCRITO AQUI -- ELE E MEDIDO
// -----------------------------------------------------
// `TAMANHO_DA_PAGINA` e privado da rota. A secao 0 le a faixa que a rota PEDIU
// (o duble registra `range` em `lidas[].filtros`) e exige que o fixture seja
// maior que ela. Se alguem subir a pagina da rota para 2000, esta suite fica
// VERMELHA pedindo um fixture maior, em vez de continuar verde medindo uma
// pagina so -- que e a forma como uma suite de paginacao apodrece.
//
// NAO HA RELOGIO CONGELADO, E ISSO E DELIBERADO
// ---------------------------------------------
// O ramo de intervalo nao chama `today()`: a janela vem inteira de `?de=&ate=`,
// e a comparacao de datas e lexicografica sobre ISO. Congelar o relogio aqui
// sugeriria uma dependencia de calendario que este ramo nao tem.
// =====================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { criarDuble } from "./duble-de-supabase.mjs";

const RAIZ = "../.tmp-paginacao-do-intervalo";

const FLUXO = await import(`${RAIZ}/app/api/reports/cash-flow/route.js`);

/**
 * TETO DE TEMPO NOS CASOS QUE CHAMAM A ROTA -- contra TRAVAR O JOB, nao contra
 * lentidao.
 *
 * O laco da rota para quando a pagina volta INCOMPLETA. Um `range` que
 * devolvesse a lista inteira a cada chamada (o no-op que a secao 5 mata) nunca
 * produz pagina incompleta: a rota pede pagina para sempre, com a mesma
 * resposta.
 *
 * MEDIDO com esse mutante aplicado: o que mata o processo nao e este teto e sim
 * o `linhas.push` do laco, que estoura o heap -- `FATAL ERROR: ... heap out of
 * memory` em ~41s, codigo de saida diferente de zero. A suite fica vermelha de
 * um jeito ou de outro, e o teto continua valendo a pena porque ele e o unico
 * que ainda limita o caso em que o laco um dia deixar de acumular (ai nao ha
 * OOM nenhum para interromper, e o job ficaria ocupado ate o limite da conta).
 *
 * Os seis casos somados rodam em ~60ms nesta maquina; trinta segundos nao
 * aproxima nenhum deles do teto, nem no runner mais carregado (ver
 * `tempo-de-runner-varia-14x-com-a-carga-do-host`).
 */
const TETO = { timeout: 30_000 };

const EU = "11111111-1111-1111-1111-111111111111";
const OUTRO = "22222222-2222-2222-2222-222222222222";
const GRUPO = "99999999-9999-9999-9999-999999999999";

/**
 * O periodo pedido: NAO e uma uniao de meses inteiros.
 *
 * `modoDoPeriodo` responde "intervalo" porque `de` nao e dia 1 -- e e so nesse
 * modo que nenhum rollup do 008 responde e a rota passa a somar as linhas
 * cruas, paginando. Um periodo de mes inteiro cairia no outro ramo e esta suite
 * mediria a view, nao a paginacao.
 */
const DE = "2026-03-10";
const ATE = "2026-04-20";

/** Dentro da janela. */
const DIA = "2026-03-15";
/** Fora dela, pelo lado de cima. */
const DEPOIS = "2026-05-01";

/**
 * Quantas linhas o volume do fixture tem.
 *
 * Uma a mais que o `TAMANHO_DA_PAGINA` da rota (1000, hoje), para que a ULTIMA
 * linha -- a unica com valor diferente -- caia na SEGUNDA pagina. O numero nao
 * e confiado a este comentario: a secao 0 o compara com a faixa que a rota
 * pediu de verdade.
 */
const VOLUME = 1001;

/**
 * O valor da ultima linha do volume, a que so existe na segunda pagina.
 *
 * Diferente de todas as outras de proposito: com mil linhas iguais, uma rota que
 * parasse na primeira pagina devolveria um total redondo e plausivel. Este
 * numero e a diferenca entre "o total esta certo" e "o total cabe numa pagina".
 */
const SO_NA_SEGUNDA_PAGINA = -777.77;

/**
 * `id` com largura fixa, porque a rota ordena por ele.
 *
 * `.order("id")` e o que torna a paginacao estavel -- sem ordem, duas paginas
 * podem repetir e pular linhas. Com id de largura variavel ("t-9" > "t-10" em
 * ordem de texto) o fixture teria uma ordem que o banco nao tem, e a fronteira
 * entre as paginas cairia num lugar que ninguem escolheu.
 */
const idDoVolume = (i) => `t-${String(i).padStart(6, "0")}`;

/** Uma linha de `financial_transactions` como a rota a le. */
const transacao = (extra) => ({
  user_id: EU,
  group_id: null,
  transaction_date: DIA,
  amount: -1,
  transaction_type: "expense",
  currency: "BRL",
  // Pedidas so no caminho `cartao=fatura` (COLUNAS_DO_REALIZADO_DE_CAIXA).
  // Nulas aqui: `notes` vazio e conta que nao e cartao fazem a regra da fatura
  // deixar a linha passar intacta -- o criterio dela e assunto da HMO-413, nao
  // desta suite.
  notes: null,
  counterpart_transaction_id: null,
  account: { account_type: "checking" },
  ...extra,
});

/**
 * As linhas que NAO podem entrar, ordenadas NA FRENTE do volume ("d-" < "t-").
 *
 * A posicao e a assercao. Se o duble cortasse a faixa antes de aplicar o
 * `.eq("user_id")`/`.is("group_id")` da rota, estas tres entrariam na primeira
 * pagina, a pagina chegaria a rota com 997 linhas uteis, o laco leria "pagina
 * incompleta" e pararia -- e o total do periodo sairia menor sem erro nenhum.
 * Com elas atras do volume, o mesmo defeito nao mudaria numero nenhum.
 */
const RECUSADAS = [
  // A despesa de OUTRO membro, visivel pela RLS de grupo (`OR
  // is_group_member(...)`) e que nao e dinheiro de EU.
  transacao({ id: "d-000001", user_id: OUTRO, amount: -500 }),
  // Despesa de grupo: a linha CHEIA nao entra no relatorio pessoal -- o que
  // entra e a parte, lida de `group_share_entries` (033).
  transacao({ id: "d-000002", group_id: GRUPO, amount: -300 }),
  // Fora da janela pedida.
  transacao({ id: "d-000003", transaction_date: DEPOIS, amount: -900 }),
];

/** O volume: mil linhas de -1,00 e a ultima diferente. */
const VOLUME_DE_DESPESA = Array.from({ length: VOLUME }, (_, i) =>
  transacao({
    id: idDoVolume(i),
    amount: i === VOLUME - 1 ? SO_NA_SEGUNDA_PAGINA : -1,
  })
);

/**
 * Entrada e dolar, ordenados DEPOIS do volume ("u"/"v" > "t").
 *
 * A entrada separa "a rota somou tudo" de "a rota somou tudo como saida", e o
 * dolar guarda a separacao por moeda do caminho paginado: sem ele, um total que
 * misturasse real com dolar (o defeito que a 022 tirou das views e que a
 * HMO-171 reencontrou AQUI, no JavaScript) passaria verde.
 */
const ENTRADA = transacao({
  id: "u-000001",
  amount: 123.45,
  transaction_type: "income",
});

const EM_DOLAR = transacao({
  id: "v-000001",
  amount: -50,
  currency: "USD",
});

// 1000 linhas de 1,00 mais a de 777,77.
const SAIDA_ESPERADA = 1000 + 777.77;
const ENTRADA_ESPERADA = 123.45;
// O volume mais a linha de entrada. O dolar vira bloco proprio, e as tres
// RECUSADAS nao entram em nenhum.
const CONTAGEM_ESPERADA = VOLUME + 1;

const PERFIS = [{ id: EU, preferences: { moeda: { oficial: "BRL" } } }];

/**
 * Chama o handler com o duble instalado.
 *
 * `chamadasDeSessao > 0` e o controle positivo de
 * [[route-handler-roda-no-node-com-duble-de-client]]: se a rota trocar o jeito de
 * obter o client, o duble deixa de ser consultado, a resposta sai plausivel e
 * TODA assercao abaixo passa por vacuidade. A contagem e a unica coisa que
 * percebe isso.
 */
async function chamar(url, { tabelas = {}, erros = {} } = {}) {
  const sessao = criarDuble({
    user: { id: EU },
    tabelas: { profiles: PERFIS, ...tabelas },
    erros,
  });

  const registro = { sessao: () => sessao.client };
  globalThis.__dubleDeSupabase = registro;

  let resposta;
  try {
    resposta = await FLUXO.GET({ url });
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  assert.ok(
    (registro.chamadasDeSessao ?? 0) > 0,
    `controle positivo: ${url} nao abriu o client de SESSAO. A resposta medida ` +
      "abaixo nao veio do fixture."
  );

  return { resposta, lidas: sessao.lidas };
}

const urlDoIntervalo = (extra = "") =>
  `https://exemplo.test/api/reports/cash-flow?de=${DE}&ate=${ATE}${extra}`;

/** As faixas que a rota pediu de uma tabela, na ordem. */
function faixasPedidas(lidas, tabela) {
  return lidas
    .filter((l) => l.tabela === tabela)
    .map((l) => {
      const faixa = l.filtros.find(([op]) => op === "range");
      assert.ok(
        faixa,
        `uma consulta a ${tabela} saiu SEM range: o ramo de intervalo soma as ` +
          "linhas no JavaScript, e sem paginacao o teto de linhas do PostgREST " +
          "trunca a resposta e o total sai menor sem erro"
      );
      return faixa[2];
    });
}

/**
 * O corpo de uma resposta que deveria ter sido 200, para a mensagem do assert.
 *
 * A dica sobre o duble esta aqui de proposito: nesta familia de sonda, 500 quase
 * nunca e a rota. O `catch` do handler engole `... is not a function` e devolve
 * `{"error":"Erro interno"}`, e quem le a falha vai depurar a rota -- que esta
 * certa. Foi assim que a falta de `range` ficou invisivel ate a HMO-417.
 */
async function textoDoErro(resposta) {
  if (resposta.status === 200) return "";
  return (
    `a rota respondeu ${resposta.status}: ${await resposta.text()}. Um 500 aqui ` +
    "costuma ser metodo que falta no duble (o `catch` da rota engole o " +
    "`... is not a function`) -- e nao a feature."
  );
}

/** O bloco de uma moeda na resposta. */
function bloco(corpo, moeda) {
  const achado = corpo.by_currency.find((b) => b.currency === moeda);
  assert.ok(
    achado,
    `a resposta nao tem bloco de ${moeda} (tem ${corpo.by_currency
      .map((b) => b.currency)
      .join(", ")})`
  );
  return achado;
}

// ===========================================================================
// SECAO 0 - o fixture e MAIOR que uma pagina (anti-vacuidade)
// ===========================================================================
// Esta secao e a que impede esta suite de apodrecer. Toda assercao de dinheiro
// abaixo so prova paginacao enquanto o fixture nao couber numa pagina -- e o
// tamanho da pagina e uma constante privada da rota, que alguem pode mudar sem
// olhar para este arquivo. Em vez de repetir o 1000 aqui (uma segunda copia que
// envelheceria calada), a faixa e lida da consulta que a rota FEZ.
test("secao 0: o fixture nao cabe numa pagina da rota", TETO, async () => {
  const { resposta, lidas } = await chamar(urlDoIntervalo(), {
    tabelas: {
      financial_transactions: [...RECUSADAS, ...VOLUME_DE_DESPESA],
    },
  });

  assert.equal(resposta.status, 200, await textoDoErro(resposta));

  const faixas = faixasPedidas(lidas, "financial_transactions");
  assert.ok(faixas.length > 0, "a rota nao paginou nada");

  const [primeiraDe, primeiraAte] = faixas[0];
  assert.equal(primeiraDe, 0, "a primeira pagina tem de comecar no zero");

  const tamanhoDaPagina = primeiraAte - primeiraDe + 1;

  assert.ok(
    VOLUME > tamanhoDaPagina,
    `o fixture tem ${VOLUME} linhas e a pagina da rota e de ${tamanhoDaPagina}: ` +
      "o volume CABE numa pagina, e nenhuma assercao desta suite prova mais " +
      `paginacao. Suba VOLUME para pelo menos ${tamanhoDaPagina + 1}.`
  );

  assert.ok(
    faixas.length >= 2,
    `a rota pediu ${faixas.length} pagina(s) para ${VOLUME} linhas com pagina ` +
      `de ${tamanhoDaPagina}: a segunda pagina nunca foi buscada`
  );

  // Contiguas e sem sobreposicao -- `ate` INCLUSIVO. Uma faixa que repetisse a
  // ultima linha da pagina anterior contaria dinheiro duas vezes; uma que
  // pulasse uma linha o perderia. Nos dois casos o total fica plausivel.
  faixas.forEach(([de, ate], i) => {
    assert.equal(
      de,
      i * tamanhoDaPagina,
      `a pagina ${i} comecou em ${de} em vez de ${i * tamanhoDaPagina} -- as ` +
        "faixas tem de ser contiguas e sem sobreposicao"
    );
    assert.equal(
      ate - de + 1,
      tamanhoDaPagina,
      `a pagina ${i} pediu ${ate - de + 1} linhas e as outras pedem ${tamanhoDaPagina}`
    );
  });
});

// ===========================================================================
// SECAO 1 - o dinheiro da SEGUNDA pagina entra no total
// ===========================================================================
test("secao 1: o total do periodo inclui a linha que so existe na 2a pagina", TETO, async () => {
  const { resposta } = await chamar(urlDoIntervalo(), {
    tabelas: {
      financial_transactions: [
        ...RECUSADAS,
        ...VOLUME_DE_DESPESA,
        ENTRADA,
        EM_DOLAR,
      ],
    },
  });

  assert.equal(resposta.status, 200, await textoDoErro(resposta));
  const corpo = await resposta.json();

  assert.equal(corpo.grao, "intervalo", "o periodo pedido nao e de meses inteiros");

  assert.equal(
    corpo.summary.total_expense,
    SAIDA_ESPERADA,
    `a saida do periodo tem de ser ${SAIDA_ESPERADA} (mil linhas de 1,00 mais ` +
      `a de ${Math.abs(SO_NA_SEGUNDA_PAGINA)}, que esta na SEGUNDA pagina). ` +
      "1000,00 significa que a rota parou na primeira pagina; 997,00, que o " +
      "corte da faixa aconteceu antes dos filtros e levou as linhas recusadas."
  );

  assert.equal(
    corpo.summary.total_income,
    ENTRADA_ESPERADA,
    "a entrada do periodo se perdeu na paginacao"
  );

  assert.equal(
    corpo.summary.transaction_count,
    CONTAGEM_ESPERADA,
    `a contagem tem de ser ${CONTAGEM_ESPERADA}. Um numero MAIOR significa ` +
      "faixas sobrepostas (dinheiro contado duas vezes); menor, pagina perdida."
  );

  assert.equal(
    corpo.summary.net,
    Number((ENTRADA_ESPERADA - SAIDA_ESPERADA).toFixed(2)),
    "o resultado nao fecha com entrada menos saida"
  );

  // A moeda nao se mistura no caminho paginado: o dolar e bloco proprio, e os
  // 50 dele NAO estao nos 1777,77 acima.
  assert.equal(corpo.currency, "BRL", "o bloco principal tem de ser o da moeda oficial");
  assert.equal(bloco(corpo, "USD").summary.total_expense, 50);
  assert.equal(bloco(corpo, "BRL").summary.total_expense, SAIDA_ESPERADA);
  assert.equal(corpo.multi_currency, true);
});

// ===========================================================================
// SECAO 2 - a OUTRA consulta paginada: a minha parte das despesas de grupo
// ===========================================================================
// O ramo de intervalo pagina DUAS consultas, e as duas somam no JavaScript. Uma
// sonda que cobrisse so `financial_transactions` deixaria a segunda metade do
// total do painel sem medida -- e `group_share_entries` e justamente a metade
// que a HMO-202 acrescentou.
//
// Aqui o volume esta na view, e `financial_transactions` tem uma linha so.
test("secao 2: a parte de grupo tambem pagina, e a 2a pagina entra no total", TETO, async () => {
  const idDaParte = (i) => `g-${String(i).padStart(6, "0")}`;

  // `amount` sai POSITIVO da view -- a parte de uma despesa de -400 e 200,00 --
  // e os agregadores aplicam `Math.abs`. Ver lib/parte-do-grupo-realizada.ts.
  const parte = (extra) => ({
    user_id: EU,
    transaction_date: DIA,
    amount: 2,
    transaction_type: "expense",
    currency: "BRL",
    category_id: null,
    ...extra,
  });

  const SO_NA_SEGUNDA = 55.55;

  const partes = [
    // Ordenada na frente ("a-" < "g-"), pela mesma razao das RECUSADAS: as views
    // da 033 nao filtram `user_id` e as policies de grupo tem
    // `OR is_group_member(...)`, entao sem o `eq("user_id")` da rota vem a parte
    // dos OUTROS membros.
    parte({ id: "a-000001", user_id: OUTRO, amount: 900 }),
    ...Array.from({ length: VOLUME }, (_, i) =>
      parte({
        id: idDaParte(i),
        amount: i === VOLUME - 1 ? SO_NA_SEGUNDA : 2,
      })
    ),
  ];

  const { resposta, lidas } = await chamar(urlDoIntervalo(), {
    tabelas: {
      financial_transactions: [transacao({ id: "t-000000", amount: -10 })],
      group_share_entries: partes,
    },
  });

  assert.equal(resposta.status, 200, await textoDoErro(resposta));
  const corpo = await resposta.json();

  const faixas = faixasPedidas(lidas, "group_share_entries");
  assert.ok(
    faixas.length >= 2,
    `a parte de grupo foi pedida em ${faixas.length} pagina(s) para ` +
      `${VOLUME} linhas -- a segunda pagina nunca foi buscada`
  );

  // 10,00 da transacao + mil partes de 2,00 + a de 55,55 da segunda pagina.
  const esperado = Number((10 + 1000 * 2 + SO_NA_SEGUNDA).toFixed(2));

  assert.equal(
    corpo.summary.total_expense,
    esperado,
    `a saida tem de ser ${esperado}. 2010,00 significa que a parte de grupo ` +
      "parou na primeira pagina; 2965,55, que a parte do OUTRO membro entrou."
  );

  assert.equal(
    corpo.summary.transaction_count,
    VOLUME + 1,
    "a contagem tem de somar a transacao com as partes de grupo"
  );
});

// ===========================================================================
// SECAO 3 - a janela entre o deploy e a colagem da 033
// ===========================================================================
// Producao nao tem runner de migration: o deploy publica CODIGO, nao schema.
// Num banco onde a 033 ainda nao foi colada `group_share_entries` nao existe, e
// a rota segue SEM a parte de grupo em vez de devolver 500 -- o bloco de
// realizado do painel principal nao pode morrer esperando alguem colar um
// arquivo. Ver viewDaParteAusente em lib/parte-do-grupo-realizada.ts.
//
// Esta secao tambem e o que prova `range` no objeto de ERRO do duble: sem ele a
// cadeia estoura antes de chegar ao `if` da queda, e a sonda mediria o `catch`
// da rota -- um 500 lido como "a queda nao funciona".
test("secao 3: sem a 033 colada, o intervalo responde sem a parte de grupo", TETO, async () => {
  for (const code of ["42P01", "PGRST205"]) {
    const { resposta } = await chamar(urlDoIntervalo(), {
      tabelas: {
        financial_transactions: [...RECUSADAS, ...VOLUME_DE_DESPESA],
      },
      erros: { group_share_entries: { code, message: "nao existe" } },
    });

    assert.equal(resposta.status, 200, await textoDoErro(resposta));
    const corpo = await resposta.json();

    assert.equal(
      corpo.summary.total_expense,
      SAIDA_ESPERADA,
      `${code}: a queda tem de devolver o periodo PAGINADO sem a parte de ` +
        "grupo, e nao um total truncado"
    );
  }
});

// ===========================================================================
// SECAO 4 - o ramo que o painel principal usa: `cartao=fatura`
// ===========================================================================
// `cartao=fatura` entra NESTA mesma condicao, e por isso ele e o caso mais
// comum do ramo paginado: o painel pede a regra nova em todo periodo, inclusive
// num mes inteiro (que sem o parametro cairia nos rollups do 008). Era este o
// caminho que a falta de `range` tornava inalcancavel por sonda.
//
// O CRITERIO da regra -- que linha e compra no cartao e que linha e pagamento de
// fatura -- nao e medido aqui: as linhas deste fixture atravessam a regra
// intactas (conta que nao e cartao, `notes` vazio). O que se mede e que o ramo
// responde, no grao certo, com o total das DUAS paginas.
test("secao 4: cartao=fatura cai no ramo paginado e soma as duas paginas", TETO, async () => {
  const MES_INTEIRO = "de=2026-03-01&ate=2026-03-31";

  const { resposta, lidas } = await chamar(
    `https://exemplo.test/api/reports/cash-flow?${MES_INTEIRO}&cartao=fatura`,
    {
      tabelas: {
        financial_transactions: [...RECUSADAS, ...VOLUME_DE_DESPESA],
      },
    }
  );

  assert.equal(resposta.status, 200, await textoDoErro(resposta));
  const corpo = await resposta.json();

  assert.equal(
    corpo.cartao,
    "fatura",
    "a resposta tem de dizer qual regra do cartao produziu o numero"
  );
  assert.equal(
    corpo.grao,
    "intervalo",
    "mesmo num mes inteiro: `cartao=fatura` responde um BALDE, nao uma serie"
  );
  assert.deepEqual(corpo.months, []);

  assert.ok(
    faixasPedidas(lidas, "financial_transactions").length >= 2,
    "o caminho de `cartao=fatura` nao paginou a segunda pagina"
  );

  assert.equal(
    corpo.summary.total_expense,
    SAIDA_ESPERADA,
    "o total de `cartao=fatura` perdeu a linha da segunda pagina"
  );
});

// ===========================================================================
// SECAO 5 - o contrato de `range` no duble, direto
// ===========================================================================
// As secoes acima medem a rota, que e o que importa. Esta mede o duble sozinho,
// e existe por dois motivos:
//
//   * ela acusa com a MENSAGEM CERTA o `range` que ignora os argumentos. Nas
//     secoes 0 a 4 esse defeito nao vira assercao vermelha: a pagina cheia volta
//     sempre cheia, a rota pede pagina para sempre, e o que aparece e o teto de
//     `TETO` estourando -- "o caso demorou 30s" nao aponta para o metodo;
//   * ela crava o `ate` INCLUSIVO e a independencia de ordem como afirmacoes
//     proprias, em vez de deixa-las implicitas num total de dinheiro.
test("secao 5: range(de, ate) corta, e `ate` e inclusivo", async () => {
  const linhas = Array.from({ length: 10 }, (_, i) => ({
    id: `x-${i}`,
    user_id: i % 2 === 0 ? EU : OUTRO,
    n: i,
  }));

  const { client } = criarDuble({ user: { id: EU }, tabelas: { t: linhas } });

  const primeira = await client.from("t").select("id, n").range(0, 2);
  assert.deepEqual(
    primeira.data.map((l) => l.n),
    [0, 1, 2],
    "range(0, 2) tem de trazer TRES linhas: o PostgREST e inclusivo nos dois " +
      "extremos. Duas significa `slice(de, ate)`, e numa rota que para quando a " +
      "pagina volta incompleta isso perde a pagina seguinte inteira."
  );

  const segunda = await client.from("t").select("id, n").range(3, 5);
  assert.deepEqual(
    segunda.data.map((l) => l.n),
    [3, 4, 5],
    "a pagina seguinte tem de continuar de onde a anterior parou"
  );

  const estourada = await client.from("t").select("id, n").range(100, 199);
  assert.deepEqual(
    estourada.data,
    [],
    "faixa depois do fim responde vazio -- e assim que o laco da rota termina"
  );

  // A ORDEM DAS CHAMADAS NAO PODE IMPORTAR. No PostgREST o `Range` vai no mesmo
  // pedido que o `WHERE` e e aplicado DEPOIS dele; a rota, de fato, encadeia
  // `.range()` antes do `.eq("user_id")`.
  const antes = await client.from("t").select("id, n").range(0, 2).eq("user_id", EU);
  const depois = await client.from("t").select("id, n").eq("user_id", EU).range(0, 2);

  assert.deepEqual(
    antes.data.map((l) => l.n),
    [0, 2, 4],
    "com `.range()` ANTES do `.eq()`, o corte pegou a tabela inteira e so " +
      "depois filtrou -- a pagina chega a rota menor do que e, e o laco para " +
      "achando que acabou"
  );
  assert.deepEqual(
    depois.data.map((l) => l.n),
    antes.data.map((l) => l.n),
    "a ordem das chamadas no builder mudou o resultado"
  );

  // `count` e o total que casa com os filtros, SEM a faixa: e isso que o
  // `count=exact` do PostgREST devolve, e e o que torna o `count` util para
  // paginar.
  const contada = await client
    .from("t")
    .select("id", { count: "exact" })
    .eq("user_id", EU)
    .range(0, 1);

  assert.equal(contada.data.length, 2, "a pagina tem de vir recortada");
  assert.equal(
    contada.count,
    5,
    "o `count` tem de ser o total filtrado (5 linhas de EU), nao o tamanho da " +
      "pagina -- um count igual a pagina diria a quem pagina que acabou"
  );
});
