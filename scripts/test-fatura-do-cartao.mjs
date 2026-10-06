#!/usr/bin/env node
// =====================================================
// PULODOGATO - as regras da tela de gastos do cartao (HMO-210)
// =====================================================
//   npm run test:fatura-do-cartao
//
// A tela nova (`/dashboard/cartoes/[id]`) nao calcula fatura: a view
// `card_invoice_lines` (006) decide em que mes cada compra cai e
// `GET /api/card-invoices` agrega. O que ESTE modulo decide e o que a tela faz
// com aquela resposta -- e cada decisao aqui tem um modo de falha que nao da
// erro nenhum:
//
//   - escolher a fatura por `[0]` em vez de por id mostra os gastos do cartao
//     errado embaixo do nome do cartao certo. Dois cartoes do mesmo dono, dois
//     totais plausiveis, nada vermelho;
//   - nao conferir se o cartao e do usuario deixa a tela listar a compra de
//     grupo lancada no cartao de outra pessoa (a RLS de financial_transactions
//     tem um OR para membro de grupo);
//   - tomar o estado de UMA das duas leituras libera "R$ 0,00" de uma fatura
//     que nao carregou -- indistinguivel de um mes sem compra;
//   - rotulo de mes quebrado deixa o total sem eixo de tempo.
//
// O que este arquivo NAO cobre: a marcacao. Qual numero aparece em qual lugar,
// e o que NAO aparece, esta em test-tela-do-cartao.mjs -- um teste puro passa
// verde com o JSX mostrando o campo certo no lugar errado.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  caminhoDeNovoGasto,
  caminhoDoCartao,
  caminhoDoCartaoNoMes,
  cartaoDaTela,
  estadoDaTela,
  faturaDoCartao,
  faturaPadraoDoLancamento,
  gastosDaFatura,
  janelaDeFaturas,
  mesCorrenteDaFatura,
  mesInicialDaFatura,
  PARAM_DO_CARTAO,
  PARAM_DO_MES,
  previsoesDoCartao,
  rotuloDaFatura,
  rotuloDoCiclo,
} from "../.tmp-fatura-do-cartao/lib/fatura-do-cartao.js";
// A OUTRA COPIA DA REGRA DO MES, importada e nao reescrita -- ver o caso "a
// recusa de `mesDaFaturaValido` e o `null` de `rotuloDaFatura` concordam" no fim
// deste arquivo, e o porque em scripts/tsconfig.fatura-do-cartao-test.json.
import { mesDaFaturaValido } from "../.tmp-fatura-do-cartao/lib/lancamento.js";

// ---------------------------------------------------------------------------
// O FUSO E PARTE DESTE TESTE, E ELE TEM QUE SER O DO USUARIO
// ---------------------------------------------------------------------------
// O `TZ=America/Sao_Paulo` vem do script no package.json -- o processo precisa
// nascer com ele, porque reatribuir `process.env.TZ` dentro de um modulo ESM
// acontece DEPOIS da avaliacao dos imports, e o fuso pode ja estar latchado.
//
// Por que isto nao e preciosismo: o defeito de `new Date("2026-10-01")` no
// rotulo do mes **nao existe em UTC**. A string e lida como meia-noite UTC e
// `getMonth()` responde no fuso LOCAL -- em UTC devolve outubro (certo, por
// acidente) e em Sao Paulo devolve setembro (o bug). O runner do GitHub Actions
// roda em UTC.
//
// Descoberto pelo controle negativo deste PR, e vale registrar porque o sinal
// aponta para o lugar errado: o mutante "o mes passa por new Date()" morreu na
// maquina de quem escreveu (TZ=America/Sao_Paulo) e SOBREVIVEU em CI. Sem o
// controle, a suite teria entrado na main afirmando proteger contra um defeito
// que ela nao ve justamente no ambiente que decide se o PR passa.
//
// A verificacao abaixo existe para que rodar `node --test` sem o TZ **falhe**,
// em vez de passar sem medir nada. Uma suite cuja premissa pode evaporar em
// silencio nao e suite.
test("a premissa do fuso esta de pe", () => {
  const fuso = Intl.DateTimeFormat().resolvedOptions().timeZone;

  assert.equal(
    fuso,
    "America/Sao_Paulo",
    `esta suite precisa nascer com TZ=America/Sao_Paulo (veio "${fuso}"). ` +
      "Em UTC o defeito de new Date() no rotulo do mes nao se manifesta, e as " +
      "assercoes de fuso passam sem medir nada. Use `npm run test:fatura-do-cartao`."
  );
  // Controle do controle: em Sao Paulo o offset e positivo (atras de UTC), e e
  // disso que o defeito depende.
  assert.ok(
    new Date("2026-10-01").getTimezoneOffset() > 0,
    "o fuso do teste tem que estar ATRAS de UTC"
  );
});

const MEU_CARTAO = "11111111-1111-1111-1111-111111111111";
const OUTRO_CARTAO = "22222222-2222-2222-2222-222222222222";

const linha = (accountId, descricao, valor, dia) => ({
  transaction_id: `${accountId}-${dia}`,
  account_id: accountId,
  description: descricao,
  invoice_amount: valor,
  amount: -valor,
  transaction_date: `2026-10-${dia}`,
  invoice_month: "2026-10-01",
});

const FATURA_MINHA = {
  account_id: MEU_CARTAO,
  account_name: "Nubank",
  invoice_month: "2026-10-01",
  due_date: "2026-10-15",
  total: 320,
  line_count: 2,
  lines: [
    linha(MEU_CARTAO, "Mercado", 200, "03"),
    linha(MEU_CARTAO, "Farmácia", 120, "07"),
  ],
};

const FATURA_DO_OUTRO = {
  account_id: OUTRO_CARTAO,
  account_name: "Itaú",
  invoice_month: "2026-10-01",
  due_date: "2026-10-20",
  total: 999,
  line_count: 1,
  lines: [linha(OUTRO_CARTAO, "Posto do outro cartão", 999, "05")],
};

// ---------------------------------------------------------------------------
// 1. A FATURA E ESCOLHIDA POR ID, NUNCA PELA POSICAO
// ---------------------------------------------------------------------------
// A rota aceita `account_id` e, com ele, devolve uma fatura so. Mas "devolve
// uma so" e propriedade do SERVIDOR, e a tela nao pode depender dela: no dia em
// que aquele filtro deixar de filtrar, `[0]` troca o cartao em silencio.
//
// Por isso o caso base deste bloco entrega as DUAS faturas de proposito, com a
// do outro cartao PRIMEIRO.

test("a fatura sai por account_id mesmo com a do outro cartao na frente", () => {
  const escolhida = faturaDoCartao(
    [FATURA_DO_OUTRO, FATURA_MINHA],
    MEU_CARTAO
  );

  assert.equal(escolhida?.account_id, MEU_CARTAO);
  assert.equal(escolhida?.total, 320);
  // A negacao explicita: o total do outro cartao nao pode ter vindo.
  assert.notEqual(escolhida?.total, 999);
});

test("cartao sem fatura na resposta devolve null, nao a fatura alheia", () => {
  assert.equal(faturaDoCartao([FATURA_DO_OUTRO], MEU_CARTAO), null);
  assert.equal(faturaDoCartao([], MEU_CARTAO), null);
  assert.equal(faturaDoCartao(null, MEU_CARTAO), null);
  assert.equal(faturaDoCartao(undefined, MEU_CARTAO), null);
});

test("sem id de cartao nao ha fatura (e nao a primeira da lista)", () => {
  assert.equal(faturaDoCartao([FATURA_MINHA], ""), null);
});

// ---------------------------------------------------------------------------
// 2. A LISTA NAO MOSTRA O GASTO DO OUTRO CARTAO
// ---------------------------------------------------------------------------
// O pedido da issue e literal: "conferir que a lista traz a compra lancada e
// NAO traz a compra do outro cartao".

test("os gastos sao so os daquele cartao", () => {
  const gastos = gastosDaFatura(FATURA_MINHA, MEU_CARTAO);

  assert.deepEqual(
    gastos.map((g) => g.description),
    ["Mercado", "Farmácia"]
  );
});

test("linha de outro cartao dentro da fatura e descartada", () => {
  // O caso que a view poderia produzir se o filtro de conta se perdesse: a
  // fatura certa, com uma linha intrusa dentro.
  const contaminada = {
    ...FATURA_MINHA,
    lines: [...FATURA_MINHA.lines, linha(OUTRO_CARTAO, "Posto do outro", 999, "05")],
  };

  const gastos = gastosDaFatura(contaminada, MEU_CARTAO);

  assert.equal(gastos.length, 2);
  assert.ok(
    !gastos.some((g) => g.account_id === OUTRO_CARTAO),
    "a linha do outro cartao vazou para a lista"
  );
  assert.ok(
    !gastos.some((g) => g.description === "Posto do outro"),
    "a descricao do gasto do outro cartao vazou para a lista"
  );
});

test("fatura nula nao vira lista de gastos", () => {
  assert.deepEqual(gastosDaFatura(null, MEU_CARTAO), []);
  assert.deepEqual(gastosDaFatura({ ...FATURA_MINHA, lines: undefined }, MEU_CARTAO), []);
});

// ---------------------------------------------------------------------------
// 3. O CARTAO DA URL TEM QUE SER DO USUARIO, E TEM QUE SER CARTAO
// ---------------------------------------------------------------------------

const MEUS_CARTOES = [
  { id: MEU_CARTAO, name: "Nubank", account_type: "credit_card" },
  { id: "33333333-3333-3333-3333-333333333333", name: "Itaú", account_type: "credit_card" },
];

test("o cartao da URL sai da lista do usuario", () => {
  assert.equal(cartaoDaTela(MEUS_CARTOES, MEU_CARTAO)?.name, "Nubank");
});

test("id que nao esta na lista do usuario nao abre a tela", () => {
  // O caminho real: digitar na barra de endereco o id do cartao de outra
  // pessoa. `card_invoice_lines` pode devolver linha dela (compra de grupo,
  // pela RLS com OR), e sem esta recusa a tela listaria os gastos sem dono.
  assert.equal(cartaoDaTela(MEUS_CARTOES, OUTRO_CARTAO), null);
});

test("conta que nao e cartao de credito nao abre a tela de fatura", () => {
  // A tela de Contas e outra. Uma conta corrente aqui mostraria "Limite nao
  // informado" e "Falta fechamento e vencimento" para algo que nunca vai ter
  // fatura.
  const comCorrente = [
    ...MEUS_CARTOES,
    { id: "44444444-4444-4444-4444-444444444444", name: "Conta", account_type: "checking" },
  ];

  assert.equal(
    cartaoDaTela(comCorrente, "44444444-4444-4444-4444-444444444444"),
    null
  );
});

test("sem lista e sem id nao ha cartao", () => {
  assert.equal(cartaoDaTela(null, MEU_CARTAO), null);
  assert.equal(cartaoDaTela(MEUS_CARTOES, null), null);
  assert.equal(cartaoDaTela(MEUS_CARTOES, ""), null);
});

// ---------------------------------------------------------------------------
// 4. AS DUAS LEITURAS, NA MAIS PESSIMISTA
// ---------------------------------------------------------------------------

test("uma leitura fresca nao salva a outra que falhou", () => {
  // O caso que motiva a funcao: o cadastro do cartao veio do servidor e a
  // fatura nao. Tomar o estado do cadastro imprimiria o total da fatura.
  assert.equal(estadoDaTela(["fresco", "sem-rede"]), "sem-rede");
  assert.equal(estadoDaTela(["fresco", "erro-do-servidor"]), "erro-do-servidor");
  assert.equal(estadoDaTela(["fresco", "do-aparelho"]), "do-aparelho");
});

test("as duas frescas liberam a tela", () => {
  assert.equal(estadoDaTela(["fresco", "fresco"]), "fresco");
});

test("a ordem dos argumentos nao muda a resposta", () => {
  assert.equal(estadoDaTela(["sem-rede", "fresco"]), "sem-rede");
  assert.equal(estadoDaTela(["do-aparelho", "fresco"]), "do-aparelho");
});

test("sessao recusada vence tudo (quem manda para /login e o layout)", () => {
  assert.equal(estadoDaTela(["sessao-recusada", "fresco"]), "sessao-recusada");
  assert.equal(estadoDaTela(["sem-rede", "sessao-recusada"]), "sessao-recusada");
});

test("carregando vence: null nao e um estado melhor que os outros", () => {
  // `podeMostrarNumero(null)` e false, e e isso que impede "R$ 0,00" no
  // primeiro quadro. Reduzir [null, 'fresco'] a 'fresco' devolveria o zero
  // confiante durante o carregamento.
  assert.equal(estadoDaTela([null, "fresco"]), null);
  assert.equal(estadoDaTela(["fresco", null]), null);
  assert.equal(estadoDaTela([null, null]), null);
  assert.equal(estadoDaTela([]), null);
});

// ---------------------------------------------------------------------------
// 5. O ROTULO DO MES -- O EIXO DE TEMPO DO TOTAL
// ---------------------------------------------------------------------------

test("o rotulo le os dois formatos que a tela usa", () => {
  assert.equal(rotuloDaFatura("2026-10"), "outubro de 2026");
  assert.equal(rotuloDaFatura("2026-10-01"), "outubro de 2026");
  assert.equal(rotuloDaFatura("2026-01"), "janeiro de 2026");
  assert.equal(rotuloDaFatura("2026-12"), "dezembro de 2026");
});

test("o mes nao passa por new Date() (o dia 01 voltaria um mes no fuso)", () => {
  // '2026-10-01' lido como UTC e convertido para America/Sao_Paulo cai em
  // 30/09. O rotulo diria "setembro" sobre a fatura de outubro.
  assert.equal(rotuloDaFatura("2026-10-01"), "outubro de 2026");
  assert.equal(rotuloDaFatura("2026-01-01"), "janeiro de 2026");
});

test("mes que nao da para ler devolve null, nao 'undefined de 2026'", () => {
  for (const ruim of ["", "2026", "2026-13", "2026-00", "outubro", "26-10", null, undefined]) {
    assert.equal(rotuloDaFatura(ruim), null, `aceitou ${JSON.stringify(ruim)}`);
  }
});

test("o mes corrente sai em AAAA-MM, no fuso de Sao Paulo", () => {
  // 01/01/2027 as 01:00 UTC ainda e 31/12/2026 em Sao Paulo: a fatura corrente
  // e a de dezembro. `toISOString().slice(0,7)` daria janeiro.
  assert.equal(mesCorrenteDaFatura(new Date("2027-01-01T01:00:00Z")), "2026-12");
  assert.equal(mesCorrenteDaFatura(new Date("2026-10-15T12:00:00Z")), "2026-10");
});

// ---------------------------------------------------------------------------
// 6. O CICLO NO CABECALHO
// ---------------------------------------------------------------------------

test("o ciclo sai com os dois dias", () => {
  assert.equal(
    rotuloDoCiclo({ closing_day: 5, due_day: 15 }),
    "Fecha dia 5 · vence dia 15"
  );
});

test("falta um dos dias e o ciclo nao existe (a tarja toma o lugar)", () => {
  // Sem os dois dias o card_invoice_month() trata toda compra como do proprio
  // mes: a compra do dia 28 aparece no mes errado. "Fecha dia undefined" em vez
  // da tarja esconderia justamente isso.
  assert.equal(rotuloDoCiclo({ closing_day: 5 }), null);
  assert.equal(rotuloDoCiclo({ due_day: 15 }), null);
  assert.equal(rotuloDoCiclo({}), null);
  assert.equal(rotuloDoCiclo({ closing_day: null, due_day: null }), null);
  // Dia 0 nao e dia: `!0` tem que recusar junto com o ausente.
  assert.equal(rotuloDoCiclo({ closing_day: 0, due_day: 15 }), null);
});

// ---------------------------------------------------------------------------
// 7. O PARAMETRO QUE LEVA O CARTAO PARA O FORMULARIO
// ---------------------------------------------------------------------------

test("o parametro NAO se chama id", () => {
  // Sob `[id]` o Next consome a chave de mesmo nome ao montar `params`, e
  // `searchParams.get("id")` volta null (HMO-142). E `?id=` ja significa
  // "editar este lancamento" no formulario: reusar a chave pediria para editar
  // o lancamento cujo id e o do cartao.
  assert.notEqual(PARAM_DO_CARTAO, "id");
  assert.equal(PARAM_DO_CARTAO, "cartao");
});

test("o link de novo gasto leva o cartao, e leva na chave certa", () => {
  const url = new URL(caminhoDeNovoGasto(MEU_CARTAO), "https://exemplo.test");

  assert.equal(url.pathname, "/dashboard/movimentacoes/despesa");
  assert.equal(url.searchParams.get(PARAM_DO_CARTAO), MEU_CARTAO);
  assert.equal(url.searchParams.get("id"), null);
});

test("o caminho da tela do cartao", () => {
  assert.equal(caminhoDoCartao(MEU_CARTAO), `/dashboard/cartoes/${MEU_CARTAO}`);
});

// ---------------------------------------------------------------------------
// 8. AS PREVISOES PENDENTES DO CARTAO (HMO-227)
// ---------------------------------------------------------------------------
// A HMO-209 tirou de Contas a Pagar toda previsao apontada para um cartao que
// nao e a fatura -- a assinatura cadastrada com o cartao como conta -- e o
// comentario dela promete que elas "passam a aparecer na tela do cartao". ELAS
// NAO APARECIAM: `card_invoice_lines` so ve lancamento, e a consulta de
// previsoes da rota so pegava `notes` de fatura. Ficaram gravadas sem leitor.

const previsao = (accountId, descricao, valor) => ({
  id: `${accountId}-${descricao}`,
  user_id: "u1",
  account_id: accountId,
  category_id: "c1",
  description: descricao,
  amount: valor,
  due_date: "2026-10-20",
  status: "pending",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
});

test("as previsoes pendentes daquele cartao saem na tela", () => {
  const fatura = {
    account_id: MEU_CARTAO,
    account_name: "Nubank",
    invoice_month: "2026-10-01",
    total: 320,
    line_count: 0,
    lines: [],
    scheduled_pending: [previsao(MEU_CARTAO, "Streaming", 39.9)],
  };

  assert.deepEqual(
    previsoesDoCartao(fatura, MEU_CARTAO).map((p) => p.description),
    ["Streaming"]
  );
});

test("a previsao de OUTRO cartao nao entra", () => {
  // Mesma razao de `gastosDaFatura`: a RLS de grupo pode trazer linha de outra
  // pessoa, e a tela afirma "deste cartao". Valor plausivel, zero erro.
  const fatura = {
    account_id: MEU_CARTAO,
    account_name: "Nubank",
    invoice_month: "2026-10-01",
    total: 0,
    line_count: 0,
    lines: [],
    scheduled_pending: [
      previsao(MEU_CARTAO, "Streaming", 39.9),
      previsao(OUTRO_CARTAO, "Academia", 120),
    ],
  };

  assert.deepEqual(
    previsoesDoCartao(fatura, MEU_CARTAO).map((p) => p.description),
    ["Streaming"]
  );
});

test("campo ausente e `null`, nao lista vazia", () => {
  // A diferenca decide a FRASE da tela. `[]` autoriza "este cartao nao tem
  // conta prevista"; `undefined` significa que aquela consulta nao voltou, e
  // dizer a mesma frase ali e o "Nada em atraso." sem rede de novo.
  const semCampo = {
    account_id: MEU_CARTAO,
    account_name: "Nubank",
    invoice_month: "2026-10-01",
    total: 0,
    line_count: 0,
    lines: [],
  };

  assert.equal(previsoesDoCartao(semCampo, MEU_CARTAO), null);
  assert.equal(previsoesDoCartao(null, MEU_CARTAO), null);

  // E a lista vazia continua sendo lista vazia -- nao pode virar `null`, senao
  // todo cartao sem previsao ganharia o aviso de leitura falhada.
  assert.deepEqual(
    previsoesDoCartao({ ...semCampo, scheduled_pending: [] }, MEU_CARTAO),
    []
  );
});

// ---------------------------------------------------------------------------
// O MES QUE CHEGA NA URL (HMO-287)
// ---------------------------------------------------------------------------
// A linha de fatura da tela de Despesas aponta para ca com `?mes=AAAA-MM`.
// Duas pecas, e as duas tem o mesmo modo de falha mudo: a tela abre no mes
// CORRENTE, que e exatamente o que ela faria se o link estivesse certo e o
// parametro nao existisse. Valor certo, mes errado, nada vermelho.
//
// Os dois formatos convivem no app de proposito e nao da para unificar: a chave
// da fatura e `invoice_month` sao 'AAAA-MM-01' (10 chars, e o banco); o estado
// desta tela e o `&month=` da rota sao 'AAAA-MM' (7). E por isso que a
// conversao precisa de teste em vez de inspecao.
// ---------------------------------------------------------------------------

test("o link da fatura leva o mes em 7 chars, e NAO os 10 da chave", () => {
  // Com os 10 a rota recebe um mes que ela nao reconhece.
  assert.equal(
    caminhoDoCartaoNoMes(MEU_CARTAO, "2026-08-01"),
    `/dashboard/cartoes/${MEU_CARTAO}?mes=2026-08`
  );

  // E o que ja vem em 7 passa inteiro.
  assert.equal(
    caminhoDoCartaoNoMes(MEU_CARTAO, "2026-08"),
    `/dashboard/cartoes/${MEU_CARTAO}?mes=2026-08`
  );
});

test("o parametro do mes NAO se chama `id`", () => {
  // Sob o segmento dinamico `[id]` o Next consome a chave de mesmo nome e
  // `searchParams.get("id")` volta null com o valor chegando inteiro (HMO-142).
  assert.equal(PARAM_DO_MES, "mes");
  assert.ok(!caminhoDoCartaoNoMes(MEU_CARTAO, "2026-08").includes("?id="));
});

test("mes que nao da para ler nao vira querystring nenhuma", () => {
  // `?mes=undefined` na barra de endereco e pior que parametro nenhum: ele
  // aparece no link compartilhado e sugere que a tela entende alguma coisa que
  // ela nao entende.
  for (const ruim of [null, undefined, "", "outubro", "2026", "2026-13", "2026-00"]) {
    assert.equal(
      caminhoDoCartaoNoMes(MEU_CARTAO, ruim),
      `/dashboard/cartoes/${MEU_CARTAO}`,
      `mes ${JSON.stringify(ruim)} virou querystring`
    );
  }
});

test("a tela do cartao abre no mes do `?mes=`, e nao no corrente", () => {
  // O defeito que esta funcao existe para impedir: clicar na fatura de agosto
  // abrindo outubro.
  const emOutubro = new Date("2026-10-15T12:00:00Z");

  assert.equal(mesInicialDaFatura("2026-08", emOutubro), "2026-08");
  // E ela aceita os 10 chars tambem: a URL e colada a mao e compartilhada, e
  // 'AAAA-MM-01' e a forma que o resto do app escreve.
  assert.equal(mesInicialDaFatura("2026-08-01", emOutubro), "2026-08");
});

test("sem `?mes=` -- ou com um que nao da para ler -- cai no mes corrente", () => {
  const emOutubro = new Date("2026-10-15T12:00:00Z");

  for (const ruim of [null, undefined, "", "outubro", "2026", "2026-13", "2026-1"]) {
    assert.equal(
      mesInicialDaFatura(ruim, emOutubro),
      "2026-10",
      `mes ${JSON.stringify(ruim)} nao caiu no corrente`
    );
  }
});

test("o mes corrente do fallback e o de SAO PAULO, nao o de UTC", () => {
  // 1 de novembro as 00:30 UTC e 31 de OUTUBRO em Sao Paulo. Sem o fuso, quem
  // abrisse a tela nessa janela veria a fatura do mes seguinte -- e a do mes
  // que ele esta vivendo estaria a um clique de distancia, sem nada dizendo.
  const viradaEmUtc = new Date("2026-11-01T00:30:00Z");

  assert.equal(mesInicialDaFatura(null, viradaEmUtc), "2026-10");
  assert.equal(mesInicialDaFatura(null, viradaEmUtc), mesCorrenteDaFatura(viradaEmUtc));
});

// =====================================================
// A FATURA QUE O SELETOR DE LANCAMENTO ABRE MARCADA (HMO-281 / HMO-289)
// =====================================================
// "compro hoje e vai para a fatura que fecha semana que vem, indiferente da
// data que estou lancando."
//
// As duas funcoes aqui sao PURAS e moram fora do componente justamente para
// serem medidas sem navegador -- e o que ha para medir e o que nao da para ver
// olhando a tela: o FUSO e a TELA DE ORIGEM.

test("o padrao sai do periodo da tela de origem", () => {
  // Quem esta olhando outubro e clica em "Nova Despesa" esta lancando em
  // outubro. Perguntar de novo seria ignorar a resposta que ela acabou de dar.
  assert.equal(
    faturaPadraoDoLancamento(
      "/dashboard/movimentacoes?de=2026-10-01&ate=2026-10-31"
    ),
    "2026-10"
  );

  // E NAO e o mes do relogio: este caso passaria por acaso se o periodo fosse o
  // mes corrente, entao o periodo e de um ano que nao e o de hoje.
  assert.equal(
    faturaPadraoDoLancamento(
      "/dashboard/movimentacoes?de=2024-03-01&ate=2024-03-31",
      new Date("2026-10-04T12:00:00Z")
    ),
    "2024-03",
    "o relogio congelado diz outubro de 2026; a origem tem de vencer"
  );
});

test("periodo de VARIOS meses: a regra e o PRIMEIRO mes, e esta escrita", () => {
  // "a fatura do periodo" nao existe quando o periodo tem tres meses -- sao
  // tres. A regra e o primeiro, e ela esta no codigo E aqui: com a regra
  // implicita, cada caminho que precisasse dela escolheria um, e a mesma tela
  // lancaria em faturas diferentes.
  assert.equal(
    faturaPadraoDoLancamento(
      "/dashboard/movimentacoes?de=2026-08-01&ate=2026-10-31",
      new Date("2026-10-04T12:00:00Z")
    ),
    "2026-08"
  );

  // AS DUAS ALTERNATIVAS PLAUSIVEIS SAO NOMEADAS, para que o teste reprove quem
  // trocar `[0]` por uma delas -- as duas se defendem em prosa.
  assert.notEqual(
    faturaPadraoDoLancamento(
      "/dashboard/movimentacoes?de=2026-08-01&ate=2026-10-31",
      new Date("2026-10-04T12:00:00Z")
    ),
    "2026-10",
    "nao e o ULTIMO mes do intervalo"
  );
  assert.notEqual(
    faturaPadraoDoLancamento(
      "/dashboard/movimentacoes?de=2026-08-01&ate=2026-10-31",
      new Date("2026-09-15T12:00:00Z")
    ),
    "2026-09",
    "nem o mes que contem HOJE dentro do intervalo"
  );

  // Intervalo que atravessa o ano: o primeiro continua sendo o primeiro.
  assert.equal(
    faturaPadraoDoLancamento(
      "/dashboard/movimentacoes?de=2025-11-15&ate=2026-02-10"
    ),
    "2025-11"
  );
});

test("sem origem legivel o padrao e o mes de SAO PAULO, com o relogio congelado", () => {
  // ESTE E O CASO QUE PASSA AQUI E FALHA NO CI SEM O CODIGO MUDAR, se o padrao
  // vier de `new Date().getMonth()`: as 22h de 31/10 em Sao Paulo ja e dia 1 de
  // NOVEMBRO em UTC. O cartao fecha em Sao Paulo, entao a fatura e a de outubro.
  //
  // O relogio e congelado por parametro -- sem isso o caso muda de resposta todo
  // dia 1 -- e a afirmacao vale nos dois fusos, porque `mesCorrenteDaFatura` pede
  // ao `Intl` o fuso EXPLICITO e nao o do ambiente.
  assert.equal(
    faturaPadraoDoLancamento(null, new Date("2026-11-01T01:00:00Z")),
    "2026-10",
    "01/11 01:00 UTC e 31/10 22:00 em Sao Paulo: a fatura e de OUTUBRO"
  );

  // E o outro lado da meia-noite, para o caso nao passar por um off-by-one que
  // simplesmente subtrai um mes de tudo.
  assert.equal(
    faturaPadraoDoLancamento(null, new Date("2026-11-01T04:00:00Z")),
    "2026-11",
    "01/11 04:00 UTC ja e 01/11 em Sao Paulo"
  );

  // Origem sem query, origem vazia e periodo ILEGIVEL caem todos no relogio --
  // e nao num mes qualquer. `periodoDaQuery` e quem recusa, e por isso o par
  // pela metade e o par invertido entram aqui.
  const congelado = new Date("2026-10-04T12:00:00Z");
  for (const origem of [
    null,
    undefined,
    "",
    "/dashboard/movimentacoes",
    "/dashboard/movimentacoes?de=2026-10-01",
    "/dashboard/movimentacoes?ate=2026-10-31",
    "/dashboard/movimentacoes?de=2026-10-31&ate=2026-10-01",
    "/dashboard/movimentacoes?de=outubro&ate=2026-10-31",
  ]) {
    assert.equal(
      faturaPadraoDoLancamento(origem, congelado),
      "2026-10",
      `origem ${JSON.stringify(origem)} tinha de cair no mes corrente`
    );
  }
});

test("a origem chega PERCENT-ENCODED, e o padrao a le assim", () => {
  // `comOrigem` faz `encodeURIComponent` no caminho inteiro, entao o `?` e o `&`
  // chegam como %3F e %26 quando a origem vem de outra origem. Quem lesse a
  // string crua acharia `de=` so no caso facil.
  const cru = "/dashboard/movimentacoes?de=2026-07-01&ate=2026-07-31";
  assert.equal(faturaPadraoDoLancamento(cru), "2026-07");

  // O caso que o `URLSearchParams` resolve: valor do parametro codificado.
  assert.equal(
    faturaPadraoDoLancamento(
      `/dashboard/movimentacoes?de=${encodeURIComponent("2026-07-01")}&ate=${encodeURIComponent("2026-07-31")}`
    ),
    "2026-07"
  );
});

test("a janela do seletor e 3 para tras e 3 para frente, sem tropecar no ano", () => {
  assert.deepEqual(janelaDeFaturas("2026-10"), [
    "2026-07",
    "2026-08",
    "2026-09",
    "2026-10",
    "2026-11",
    "2026-12",
    "2027-01",
  ]);

  // A IDA e o caso da issue ("compro hoje e vai para a fatura que fecha semana
  // que vem"); a VOLTA e o lancamento atrasado. As duas tem de existir.
  const janela = janelaDeFaturas("2026-10");
  assert.ok(janela.includes("2026-11"), "sem a ida, a issue nao e atendida");
  assert.ok(janela.includes("2026-09"), "sem a volta, o lancamento atrasado nao tem opcao");
  assert.equal(janela.length, 7);

  // ATRAVESSANDO O ANO PARA OS DOIS LADOS -- e onde a aritmetica `mes - 3` crua
  // produz mes 0 e mes -1.
  assert.deepEqual(janelaDeFaturas("2026-01"), [
    "2025-10",
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
    "2026-03",
    "2026-04",
  ]);
  assert.deepEqual(janelaDeFaturas("2026-12"), [
    "2026-09",
    "2026-10",
    "2026-11",
    "2026-12",
    "2027-01",
    "2027-02",
    "2027-03",
  ]);

  // ORDENADA, porque a lista e a ordem das opcoes na tela.
  const fora = janelaDeFaturas("2026-10");
  assert.deepEqual(fora, [...fora].sort(), "o seletor nao pode listar meses fora de ordem");
});

test("o mes GRAVADO entra na janela mesmo caindo fora dela", () => {
  // O CASO DA EDICAO, e ele nao e zelo. Um `<select>` cujo `value` nao casa com
  // nenhuma `<option>` NAO mostra vazio: mostra a PRIMEIRA opcao como se fosse a
  // escolhida. Abrir uma compra de um ano atras afirmaria uma fatura que nao e a
  // gravada, e Salvar sem tocar no campo a moveria sozinho.
  const janela = janelaDeFaturas("2026-10", "2025-02");
  assert.ok(janela.includes("2025-02"), "o mes gravado tem de estar na lista");
  assert.equal(janela.length, 8, "ele ENTRA, e nao substitui nenhum da janela");
  assert.deepEqual(janela, [...janela].sort());

  // Dentro da janela ele nao duplica.
  assert.equal(janelaDeFaturas("2026-10", "2026-11").length, 7);

  // 'AAAA-MM-01' (a forma que volta do banco) e normalizado -- senao ele entraria
  // numa forma que nunca casa com o `value` da opcao, que e o mesmo defeito.
  const comDia = janelaDeFaturas("2026-10", "2025-02-01");
  assert.ok(comDia.includes("2025-02"));
  assert.ok(!comDia.includes("2025-02-01"));

  // Vazio e ilegivel nao entram: o vazio ja e a opcao "pela data da compra", e
  // um ilegivel seria uma opcao com rotulo `null`.
  assert.equal(janelaDeFaturas("2026-10", "").length, 7);
  assert.equal(janelaDeFaturas("2026-10", null).length, 7);
  assert.equal(janelaDeFaturas("2026-10", "nao-e-mes").length, 7);
});

test("padrao ilegivel nao vira sete opcoes de lixo", () => {
  // `andarMeses("")` faria aritmetica com NaN e devolveria "NaN-NaN" sete vezes
  // -- opcoes clicaveis com `rotuloDaFatura` nulo em todas. Lista vazia e a
  // resposta honesta: sobra a opcao "pela data da compra".
  assert.deepEqual(janelaDeFaturas(""), []);
  assert.deepEqual(janelaDeFaturas("2026"), []);
  assert.deepEqual(janelaDeFaturas("outubro"), []);

  // E o mes gravado ainda aparece, para a edicao nao perder o que esta no banco.
  assert.deepEqual(janelaDeFaturas("", "2025-02"), ["2025-02"]);
});

test("todo mes da janela tem rotulo -- nenhuma opcao sai 'undefined de 2026'", () => {
  // O seletor imprime `rotuloDaFatura(mes)`. Se a janela produzisse um mes que
  // aquela funcao nao sabe ler, a opcao sairia com o fallback cru no lugar do
  // nome do mes -- e a pessoa escolheria "2027-01" numa lista de nomes.
  for (const padrao of ["2026-01", "2026-10", "2026-12", "2030-06"]) {
    for (const mes of janelaDeFaturas(padrao)) {
      assert.ok(
        rotuloDaFatura(mes),
        `a janela de ${padrao} produziu ${mes}, que rotuloDaFatura nao sabe ler`
      );
    }
  }
});

test("a recusa de `mesDaFaturaValido` e o `null` de `rotuloDaFatura` concordam", () => {
  // DUAS COPIAS DA MESMA REGRA, E E ESTE CASO QUE AS SEGURA JUNTAS.
  //
  // `mesDaFaturaValido` mora em lib/lancamento.ts, que nao pode ter import
  // nenhum (`test:lancamento` o compila sozinho); `rotuloDaFatura` mora aqui.
  // Sem comparar os dois, afrouxar a validacao deixaria a tela aceitar um mes
  // que o rotulo nao sabe escrever -- "undefined de 2026" sobre o total de uma
  // fatura, que e pior que rotulo nenhum.
  //
  // Os DOIS modulos sao compilados e importados; nenhum criterio e reescrito aqui.
  const entradas = [
    "2026-01",
    "2026-10",
    "2026-12",
    "2026-10-01",
    "2026-13",
    "2026-00",
    "2026-1",
    "202610",
    "",
    "outubro",
    "2026-10-",
    "0000-01",
  ];

  for (const entrada of entradas) {
    assert.equal(
      mesDaFaturaValido(entrada),
      rotuloDaFatura(entrada) !== null,
      `as duas copias discordam sobre ${JSON.stringify(entrada)}`
    );
  }

  // CONTROLE: a lista nao pode ser toda de um lado, senao a comparacao acima
  // passaria com as duas funcoes devolvendo sempre a mesma coisa.
  assert.ok(entradas.some((e) => mesDaFaturaValido(e)));
  assert.ok(entradas.some((e) => !mesDaFaturaValido(e)));
});
