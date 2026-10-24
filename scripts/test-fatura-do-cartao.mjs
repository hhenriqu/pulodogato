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
  faturaAbertaDoCartao,
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
    faturaPadraoDoLancamento({
      origem: "/dashboard/movimentacoes?de=2026-10-01&ate=2026-10-31",
    }),
    "2026-10"
  );

  // E NAO e o mes do relogio: este caso passaria por acaso se o periodo fosse o
  // mes corrente, entao o periodo e de um ano que nao e o de hoje.
  assert.equal(
    faturaPadraoDoLancamento({
      origem: "/dashboard/movimentacoes?de=2024-03-01&ate=2024-03-31",
      agora: new Date("2026-10-04T12:00:00Z"),
    }),
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
    faturaPadraoDoLancamento({
      origem: "/dashboard/movimentacoes?de=2026-08-01&ate=2026-10-31",
      agora: new Date("2026-10-04T12:00:00Z"),
    }),
    "2026-08"
  );

  // AS DUAS ALTERNATIVAS PLAUSIVEIS SAO NOMEADAS, para que o teste reprove quem
  // trocar `[0]` por uma delas -- as duas se defendem em prosa.
  assert.notEqual(
    faturaPadraoDoLancamento({
      origem: "/dashboard/movimentacoes?de=2026-08-01&ate=2026-10-31",
      agora: new Date("2026-10-04T12:00:00Z"),
    }),
    "2026-10",
    "nao e o ULTIMO mes do intervalo"
  );
  assert.notEqual(
    faturaPadraoDoLancamento({
      origem: "/dashboard/movimentacoes?de=2026-08-01&ate=2026-10-31",
      agora: new Date("2026-09-15T12:00:00Z"),
    }),
    "2026-09",
    "nem o mes que contem HOJE dentro do intervalo"
  );

  // Intervalo que atravessa o ano: o primeiro continua sendo o primeiro.
  assert.equal(
    faturaPadraoDoLancamento({
      origem: "/dashboard/movimentacoes?de=2025-11-15&ate=2026-02-10",
    }),
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
    faturaPadraoDoLancamento({ agora: new Date("2026-11-01T01:00:00Z") }),
    "2026-10",
    "01/11 01:00 UTC e 31/10 22:00 em Sao Paulo: a fatura e de OUTUBRO"
  );

  // E o outro lado da meia-noite, para o caso nao passar por um off-by-one que
  // simplesmente subtrai um mes de tudo.
  assert.equal(
    faturaPadraoDoLancamento({ agora: new Date("2026-11-01T04:00:00Z") }),
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
      faturaPadraoDoLancamento({ origem, agora: congelado }),
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
  assert.equal(faturaPadraoDoLancamento({ origem: cru }), "2026-07");

  // O caso que o `URLSearchParams` resolve: valor do parametro codificado.
  assert.equal(
    faturaPadraoDoLancamento({
      origem: `/dashboard/movimentacoes?de=${encodeURIComponent("2026-07-01")}&ate=${encodeURIComponent("2026-07-31")}`,
    }),
    "2026-07"
  );
});

// =====================================================
// A FATURA EM ABERTO DO CARTAO (HMO-456)
// =====================================================
// "Apesar do usuario poder escolher pra qual fatura vai lancar a conta, devemos
// sugerir a fatura em aberto."
//
// POR QUE OS SEIS PRIMEIROS CASOS SAO COPIA DE UM TESTE SQL
// ---------------------------------------------------------
// `faturaAbertaDoCartao` e a unica aritmetica de fatura em TypeScript do
// repositorio, e o risco dela e DISCORDAR do Postgres -- o formulario grava o
// mes sugerido em `invoice_month_override`, entao a divergencia nao sai como
// numero estranho: sai como a compra de hoje forcada para uma fatura que nao e
// a que o cartao abriria, sem erro nenhum.
//
// Os casos abaixo repetem, com os MESMOS valores esperados,
// `database/tests/budget_invoice_test.sql:313-333`, que afirma o mesmo sobre
// `public.card_invoice_month`. Os dois lados comparam com um numero cravado: um
// teste que medisse uma implementacao contra a outra provaria so que eu repeti a
// mesma conta duas vezes (a nota esta no cabecalho de
// `database/tests/ajuste_de_fatura_test.sql`).
//
// NENHUM `new Date()` NESTES CASOS. A fatura aberta sai da data que esta no
// campo e do `closing_day` -- as duas vem de fora. O relogio so entra no
// fallback de `faturaPadraoDoLancamento`, que ja tem caso proprio acima.

test("a borda do fechamento: o dia do fechamento ainda e do mes, o seguinte nao", () => {
  // budget_invoice_test.sql:313 e :316. Errar esta borda por um dia joga a
  // compra para o mes errado -- e o numero continua plausivel na tela.
  assert.equal(faturaAbertaDoCartao("2026-03-28", 28), "2026-03");
  assert.equal(faturaAbertaDoCartao("2026-03-29", 28), "2026-04");
});

test("dezembro vira o ano, e nao vira mes 13", () => {
  // budget_invoice_test.sql:321. `EXTRACT(MONTH)+1` daria 13 no SQL; em JS o
  // equivalente seria `${ano}-${mes + 1}` -- a mesma pegadinha, por isso
  // `andarMeses` conta em meses desde o ano 0.
  assert.equal(faturaAbertaDoCartao("2026-12-30", 28), "2027-01");
  assert.equal(faturaAbertaDoCartao("2026-12-28", 28), "2026-12");
});

test("fechamento dia 31 em fevereiro: a fatura e a do PROPRIO mes", () => {
  // budget_invoice_test.sql:326 e :329, o par que lá cobre o `LEAST`. ESTES DOIS
  // CASOS NAO MATAM O `Math.min`, e isso esta medido: para toda data real o
  // `LEAST` nao muda resposta nenhuma (o argumento esta no corpo de
  // `faturaAbertaDoCartao`, que por isso nao o copia). O que eles provam e a
  // PARIDADE com o valor que o teste SQL exige -- que e a unica coisa que esta
  // copia de regra precisa garantir.
  assert.equal(faturaAbertaDoCartao("2026-02-28", 31), "2026-02");
  assert.equal(faturaAbertaDoCartao("2024-02-29", 31), "2024-02");

  // E o ano bissexto nao e um `% 4` solto: 2100 nao e bissexto (a regra do
  // `% 400`), e com `% 4` sozinho o dia 29 de fevereiro de 2100 -- que nao
  // existe -- seria aceito como data.
  assert.equal(faturaAbertaDoCartao("2100-02-28", 31), "2100-02");
  assert.equal(faturaAbertaDoCartao("2100-02-29", 31), null);
  assert.equal(faturaAbertaDoCartao("2000-02-29", 31), "2000-02");
});

test("sem `closing_day` NAO ha fatura em aberto a sugerir", () => {
  // budget_invoice_test.sql:333 diz que no banco a compra cai no proprio mes --
  // e ela cai mesmo, porque o override fica NULO. O que esta funcao devolve e
  // outra pergunta ("que fatura esta ABERTA neste cartao?"), e um cartao sem
  // ciclo nao tem resposta. Devolver '2026-05' aqui daria a MESMA resposta para
  // "fecha hoje" e "nao fecha", e a tela marcaria a opcao afirmando um
  // fechamento que nao existe.
  assert.equal(faturaAbertaDoCartao("2026-05-20", null), null);
  assert.equal(faturaAbertaDoCartao("2026-05-20", undefined), null);

  // Dia de fechamento que nao e dia: o valor chega de `fetch` e do catalogo
  // guardado no aparelho, nao do CHECK do banco.
  for (const ruim of [0, -1, 32, 5.5, Number.NaN, "5"]) {
    assert.equal(
      faturaAbertaDoCartao("2026-05-20", ruim),
      null,
      `closing_day ${JSON.stringify(ruim)} tinha de ser recusado`
    );
  }
});

test("data que nao da para ler nao vira fatura", () => {
  for (const ruim of [
    null,
    undefined,
    "",
    "2026-10",
    "20/10/2026",
    "2026-13-01",
    "2026-00-10",
    "2026-02-30",
    "hoje",
  ]) {
    assert.equal(
      faturaAbertaDoCartao(ruim, 5),
      null,
      `data ${JSON.stringify(ruim)} tinha de ser recusada`
    );
  }
});

test("a FATURA EM ABERTO vence o periodo da tela de origem", () => {
  // O CASO DA ISSUE, inteiro: dia 20, cartao que fecha dia 5. A compra de hoje
  // e da fatura de NOVEMBRO, e era outubro que o seletor abria marcado -- uma
  // fatura que ja fechou e pode ja estar paga.
  assert.equal(
    faturaPadraoDoLancamento({
      origem: "/dashboard/movimentacoes?de=2026-10-01&ate=2026-10-31",
      dataDaCompra: "2026-10-20",
      closingDay: 5,
      agora: new Date("2026-10-20T12:00:00Z"),
    }),
    "2026-11"
  );

  // E a mesma pessoa, no mesmo dia, com um cartao que fecha dia 28: a fatura
  // aberta e a de outubro. O caso existe para o teste nao passar por um
  // "sempre o mes seguinte".
  assert.equal(
    faturaPadraoDoLancamento({
      origem: "/dashboard/movimentacoes?de=2026-10-01&ate=2026-10-31",
      dataDaCompra: "2026-10-20",
      closingDay: 28,
      agora: new Date("2026-10-20T12:00:00Z"),
    }),
    "2026-10"
  );
});

test("sem cartao (ou sem fechamento) o padrao e o de ANTES da HMO-456", () => {
  // AS FONTES 2 E 3 NAO VIRARAM CODIGO MORTO, e e isso que mantem a decisao da
  // HMO-289 viva: o seletor de fatura aparece junto com a natureza, ANTES de
  // haver cartao escolhido.
  const congelado = new Date("2026-10-20T12:00:00Z");

  assert.equal(
    faturaPadraoDoLancamento({
      origem: "/dashboard/movimentacoes?de=2026-08-01&ate=2026-08-31",
      dataDaCompra: "2026-10-20",
      agora: congelado,
    }),
    "2026-08",
    "sem closing_day quem responde e o periodo da origem"
  );

  assert.equal(
    faturaPadraoDoLancamento({
      dataDaCompra: "2026-10-20",
      closingDay: null,
      agora: congelado,
    }),
    "2026-10",
    "sem origem e sem fechamento, o relogio de Sao Paulo"
  );

  // A DATA ilegivel tambem cai no padrao antigo, e nao num mes qualquer: o campo
  // de data e livre e pode estar pela metade enquanto a pessoa digita.
  assert.equal(
    faturaPadraoDoLancamento({
      origem: "/dashboard/movimentacoes?de=2026-08-01&ate=2026-08-31",
      dataDaCompra: "2026-10",
      closingDay: 5,
      agora: congelado,
    }),
    "2026-08"
  );
});

test("a compra RETROATIVA e sugerida na fatura dela, nao na que esta aberta hoje", () => {
  // A funcao recebe a DATA DA COMPRA, nao `hoje`, e e isso que faz o caso
  // retroativo sair certo: quem lanca em 20/10 uma compra de 02/08 num cartao
  // que fecha dia 5 esta falando da fatura de AGOSTO (dia 2 <= dia 5), e nao da
  // aberta agora. Sugerir a aberta ali moveria uma compra antiga para o mes
  // corrente -- com a fatura do banco deixando de bater nos dois meses.
  assert.equal(
    faturaPadraoDoLancamento({
      dataDaCompra: "2026-08-02",
      closingDay: 5,
      agora: new Date("2026-10-20T12:00:00Z"),
    }),
    "2026-08"
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

// ---------------------------------------------------------------------------
// A COBRANCA NO CARTAO (24/10/2026)
// ---------------------------------------------------------------------------
// "Despesas fixas no cartao tem que ser possivel. basicamente ele se repete em
// toda fatura." A conta prevista apontada para um cartao cai na fatura como uma
// compra feita no dia dela, e vira compra sozinha no dia. A regra e pura e
// mora em lib/cobranca-no-cartao.ts; a escrita e a leitura tem caso proprio em
// `test:materializacao`.

const cobranca = await import("../.tmp-fatura-do-cartao/lib/cobranca-no-cartao.js");

const CARTAO_DA_COBRANCA = "33333333-3333-4333-8333-333333333333";
const prevista = (extra = {}) => ({
  id: "aaaaaaaa-0000-4000-8000-000000000020",
  user_id: "u1",
  recurring_rule_id: "regra-1",
  category_id: "cat-1",
  subcategory_id: "sub-1",
  account_id: CARTAO_DA_COBRANCA,
  group_id: null,
  description: "Streaming",
  amount: "39.90",
  due_date: "2026-10-20",
  status: "pending",
  notes: null,
  created_at: "2026-09-01T12:00:00Z",
  transaction_type: null,
  group_closing_id: null,
  expense_split_id: null,
  ...extra,
});

test("cobranca: cai na fatura pela regra da COMPRA, no dia dela", () => {
  // Fecha dia 5: a cobranca do dia 10 vai para a fatura seguinte, a do dia 5
  // fica na do mes. E o exemplo da regra escrita no doc.
  assert.equal(cobranca.mesDaFaturaDaCobranca("2026-10-10", 5), "2026-11-01");
  assert.equal(cobranca.mesDaFaturaDaCobranca("2026-10-05", 5), "2026-10-01");
  assert.equal(cobranca.mesDaFaturaDaCobranca("2026-12-30", 28), "2027-01-01");
  // A mesma resposta que a compra daquele dia teria -- e a mesma funcao.
  for (const [dia, fecha] of [["2026-03-28", 28], ["2026-03-29", 28], ["2026-02-28", 31]]) {
    assert.equal(
      cobranca.mesDaFaturaDaCobranca(dia, fecha),
      `${faturaAbertaDoCartao(dia, fecha)}-01`
    );
  }
});

test("cobranca: cartao sem fechamento poe a cobranca na fatura do proprio mes", () => {
  // O ramo `IS NULL` de `card_invoice_month`. O `null` de
  // `faturaAbertaDoCartao` ("nao ha fatura em aberto a sugerir") NAO pode
  // virar "sem fatura" aqui: a compra daquele dia cai, sim, numa fatura.
  assert.equal(cobranca.mesDaFaturaDaCobranca("2026-10-20", null), "2026-10-01");
  assert.equal(cobranca.mesDaFaturaDaCobranca("2026-10-20", undefined), "2026-10-01");
  assert.equal(cobranca.mesDaFaturaDaCobranca("20/10/2026", 5), null);
  assert.equal(cobranca.mesDaFaturaDaCobranca("2026-02-31", 5), null);
});

test("cobranca: fatura, transferencia, MyBank e as contas do grupo nao sao cobranca", () => {
  assert.equal(cobranca.ehCobrancaNoCartao(prevista()), true, "a fixa");
  assert.equal(
    cobranca.ehCobrancaNoCartao(prevista({ recurring_rule_id: null })),
    true,
    "a avulsa, no mesmo limbo"
  );
  assert.equal(
    cobranca.ehCobrancaNoCartao(prevista({ notes: `fatura:2026-10-01:${CARTAO_DA_COBRANCA}` })),
    false
  );
  assert.equal(cobranca.ehCobrancaNoCartao(prevista({ transaction_type: "transfer" })), false);
  assert.equal(
    cobranca.ehCobrancaNoCartao(prevista({ recurring_rule: { transaction_type: "transfer" } })),
    false,
    "a direcao da REGRA tambem conta"
  );
  assert.equal(cobranca.ehCobrancaNoCartao(prevista({ notes: "mybank:p1" })), false);
  assert.equal(cobranca.ehCobrancaNoCartao(prevista({ group_closing_id: "f1" })), false);
  assert.equal(cobranca.ehCobrancaNoCartao(prevista({ expense_split_id: "d1" })), false);
  assert.equal(cobranca.ehCobrancaNoCartao(prevista({ account_id: null })), false);
});

test("cobranca: a compra tem id DERIVADO da prevista, e nenhum id do banco e igual a ele", () => {
  const id = cobranca.idDaCompraDaCobranca("AAAAAAAA-0000-4000-8000-000000000020");
  assert.equal(id, "aaaaaaaa-0000-5000-8000-000000000020");
  // Sempre o mesmo: e o que faz a segunda tentativa levar 23505.
  assert.equal(cobranca.idDaCompraDaCobranca("aaaaaaaa-0000-4000-8000-000000000020"), id);
  // Versao 5: `gen_random_uuid()` so da versao 4.
  assert.equal(id[14], "5");
  assert.equal(cobranca.idDaCompraDaCobranca("nao-e-uuid"), null);
  assert.equal(cobranca.idDaCompraDaCobranca(null), null);

  assert.equal(cobranca.cobrancaApagadaVoltaParaPulada(id, "aaaaaaaa-0000-4000-8000-000000000020"), true);
  assert.equal(
    cobranca.cobrancaApagadaVoltaParaPulada(
      "cccccccc-0000-4000-8000-000000000001",
      "aaaaaaaa-0000-4000-8000-000000000020"
    ),
    false,
    "a compra ligada a mao (RN006.3) continua na RN006.5"
  );
});

test("cobranca: a compra e a da baixa, com a data da COBRANCA", () => {
  const compra = cobranca.compraDaCobranca(prevista(), "servico");
  assert.equal(compra.id, "aaaaaaaa-0000-5000-8000-000000000020");
  assert.equal(compra.transaction_date, "2026-10-20");
  assert.equal(compra.expected_date, "2026-10-20");
  assert.equal(compra.launch_date, "2026-09-01");
  assert.equal(compra.amount, -39.9);
  assert.equal(compra.transaction_type, "expense");
  assert.equal(compra.subcategory_id, "sub-1");
  assert.equal(compra.account_id, CARTAO_DA_COBRANCA);
  assert.equal(compra.service_id, "servico");

  const estorno = cobranca.compraDaCobranca(prevista({ transaction_type: "income" }), "servico");
  assert.equal(estorno.amount, 39.9, "o estorno mensal entra positivo e abate a fatura");
  assert.equal(cobranca.compraDaCobranca(prevista({ id: "x" }), "servico"), null);
});

test("cobranca: cada prevista com o mes da fatura dela, e o total previsto em centavos", () => {
  const cartoes = [{ id: CARTAO_DA_COBRANCA, name: " Nubank ", closing_day: 5, due_day: 12 }];
  const lista = cobranca.cobrancasNaFatura(
    [
      prevista({ id: "c2", due_date: "2026-11-20" }),
      prevista({ id: "c1", due_date: "2026-10-03", amount: 0.1 }),
      prevista({ id: "paga", status: "paid" }),
      prevista({ id: "outro-cartao", account_id: "nao-e-meu" }),
      prevista({ id: "fatura", notes: `fatura:2026-10-01:${CARTAO_DA_COBRANCA}` }),
    ],
    cartoes
  );

  assert.deepEqual(
    lista.map((c) => [c.id, c.invoice_month, c.amount, c.account_name]),
    [
      ["c1", "2026-10-01", 0.1, "Nubank"],
      ["c2", "2026-12-01", 39.9, "Nubank"],
    ]
  );
  assert.equal(cobranca.totalPrevistoDaFatura(0.2, lista), 40.2);
  assert.equal(
    cobranca.totalPrevistoDaFatura(100, [{ amount: 10, direction: "income" }]),
    90,
    "o estorno previsto abate"
  );

  const linha = cobranca.linhaDaCobrancaNaFatura(lista[1], "2026-12-12");
  assert.deepEqual(linha, {
    account_id: CARTAO_DA_COBRANCA,
    account_name: "Nubank",
    invoice_month: "2026-12-01",
    invoice_due_date: "2026-12-12",
    invoice_amount: 39.9,
  });
});

// =====================================================
// A COBRANCA NO CARTAO: DA OCORRENCIA A COMPRA (24/10/2026)
// =====================================================
// A regra pura esta nos casos logo acima. Estes sao os dois passos que falam
// com o banco, e a ocorrencia de que eles partem e a que `materializarAgenda`
// grava quando a conta da despesa fixa e um cartao:
//
//   * antes do dia, ela soma na fatura aberta como PREVISTA
//     (`faturasPrevistasDaJanela`), e por ali chega a Contas a Pagar, ao
//     Previsto da aba Despesas e ao painel;
//   * no dia, ela VIRA COMPRA no cartao (`lancarCobrancasDoCartao`), com a
//     data dela, e a conta prevista fica paga.
//
// O que pode dar errado sem erro nenhum: a assinatura entrar DUAS vezes (a
// compra e a prevista, ou duas compras porque o painel abre quatro rotas ao
// mesmo tempo), entrar com a data de hoje (e cair na fatura seguinte), ou
// voltar depois de apagada. Cada caso abaixo e um desses.
//
// O banco de mentira guarda as linhas de verdade e faz o que o banco faria nos
// tres pontos que importam: a chave primaria (23505), o trigger da 065 (apagar
// o lancamento solta a conta prevista) e a view `card_invoice_lines` (a compra
// no cartao vira linha da fatura do mes pelo fechamento).
// =====================================================

const {
  cobrancaDaCompra,
  lancarCobrancasDoCartao,
  pularCobranca,
} = await import("../.tmp-fatura-do-cartao/lib/services/cobranca-no-cartao.js");
const { faturasPrevistasDaJanela } = await import(
  "../.tmp-fatura-do-cartao/lib/services/fatura-prevista.js"
);
const { idDaCompraDaCobranca } = cobranca;

const USUARIO = "00000000-0000-0000-0000-0000000000aa";
const CORRENTE = "11111111-1111-1111-1111-111111111111";
const CATEGORIA = "99999999-9999-9999-9999-999999999999";
const CARTAO = CARTAO_DA_COBRANCA;
const HOJE = "2026-10-24";

/** A regra da 006 (`card_invoice_month`), so para a view de mentira. */
function mesDaCompra(data, fechamento) {
  const [ano, mes, dia] = data.split("-").map(Number);
  if (!fechamento || dia <= fechamento) return `${data.slice(0, 7)}-01`;
  const total = ano * 12 + mes;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

/** `card_invoice_due_date` da 006, sem o clamp do fim do mes (nao ha dia 31 aqui). */
function vencimentoDaFatura(mes, fechamento, vencimento) {
  if (!vencimento) return null;
  let [ano, m] = mes.split("-").map(Number);
  if (fechamento && vencimento <= fechamento) {
    m += 1;
    if (m === 13) {
      m = 1;
      ano += 1;
    }
  }
  return `${ano}-${String(m).padStart(2, "0")}-${String(vencimento).padStart(2, "0")}`;
}

function bancoDeMentira({ previstas = [], lancamentos = [], erroNoInsert = null } = {}) {
  const tabelas = {
    financial_accounts: [
      { id: CARTAO, user_id: USUARIO, name: "Nubank", account_type: "credit_card", closing_day: 5, due_day: 12 },
      { id: CORRENTE, user_id: USUARIO, name: "Conta", account_type: "checking", closing_day: null, due_day: null },
    ],
    financial_services: [{ id: "servico-financas", name: "personal_finance" }],
    scheduled_transactions: previstas.map((p) => ({ ...p })),
    financial_transactions: lancamentos.map((l) => ({ ...l })),
  };
  const inserts = [];

  const view = () =>
    tabelas.financial_transactions.flatMap((t) => {
      const conta = tabelas.financial_accounts.find((c) => c.id === t.account_id);
      if (conta?.account_type !== "credit_card") return [];
      if (!["expense", "income"].includes(t.transaction_type)) return [];
      const mes = mesDaCompra(t.transaction_date, conta.closing_day);
      return [
        {
          user_id: t.user_id,
          account_id: conta.id,
          account_name: conta.name,
          invoice_month: mes,
          invoice_due_date: vencimentoDaFatura(mes, conta.closing_day, conta.due_day),
          invoice_amount: -t.amount,
        },
      ];
    });

  function from(tabela) {
    const filtros = [];
    let modo = "select";
    let patch = null;
    let nova = null;
    let uma = false;
    const q = {
      select: () => q,
      eq: (c, v) => (filtros.push((l) => l[c] === v), q),
      in: (c, vs) => (filtros.push((l) => vs.includes(l[c])), q),
      lte: (c, v) => (filtros.push((l) => l[c] <= v), q),
      gte: (c, v) => (filtros.push((l) => l[c] >= v), q),
      insert: (linha) => ((modo = "insert"), (nova = linha), q),
      update: (p) => ((modo = "update"), (patch = p), q),
      delete: () => ((modo = "delete"), q),
      single: () => ((uma = true), q),
      maybeSingle: () => ((uma = true), q),
      then: (ok, falha) => Promise.resolve().then(executar).then(ok, falha),
    };
    function executar() {
      if (modo === "insert") {
        inserts.push(nova);
        if (erroNoInsert) return { error: erroNoInsert };
        if (tabelas[tabela].some((l) => l.id === nova.id)) {
          return { error: { code: "23505", message: "duplicate key" } };
        }
        tabelas[tabela].push({ ...nova });
        return { error: null };
      }
      const base = tabela === "card_invoice_lines" ? view() : tabelas[tabela];
      const alvo = base.filter((l) => filtros.every((f) => f(l)));
      if (modo === "update") {
        for (const l of alvo) Object.assign(l, patch);
        return { error: null };
      }
      if (modo === "delete") {
        for (const l of alvo) {
          // O trigger da 065: a conta prevista quitada por este lancamento
          // volta para pendente.
          for (const p of tabelas.scheduled_transactions) {
            if (p.transaction_id === l.id && p.status === "paid") {
              Object.assign(p, { status: "pending", paid_date: null, transaction_id: null });
            }
          }
          tabelas[tabela].splice(tabelas[tabela].indexOf(l), 1);
        }
        return { error: null };
      }
      const copias = alvo.map((l) => ({ ...l }));
      return { data: uma ? copias[0] ?? null : copias, error: null };
    }
    return q;
  }

  return {
    tabelas,
    inserts,
    from,
    rpc: async (nome, args) => {
      assert.equal(nome, "card_invoice_due_date");
      return {
        data: vencimentoDaFatura(args.p_invoice_month, args.p_closing_day, args.p_due_day),
        error: null,
      };
    },
  };
}

/** A ocorrencia de uma despesa fixa no cartao, como `materializarAgenda` a grava. */
const ocorrencia = (id, dia, extra = {}) => ({
  id,
  user_id: USUARIO,
  recurring_rule_id: "regra-streaming",
  category_id: CATEGORIA,
  subcategory_id: null,
  account_id: CARTAO,
  group_id: null,
  description: "Streaming",
  amount: 39.9,
  due_date: dia,
  status: "pending",
  paid_date: null,
  transaction_id: null,
  notes: null,
  created_at: "2026-09-01T12:00:00Z",
  transaction_type: null,
  group_closing_id: null,
  expense_split_id: null,
  ...extra,
});

const DE_OUTUBRO = "aaaaaaaa-0000-4000-8000-000000000020";
const DE_NOVEMBRO = "aaaaaaaa-0000-4000-8000-000000001120";

test("cobranca no cartao: no dia ela vira compra, com a data DELA, e a prevista fica paga", async () => {
  const banco = bancoDeMentira({
    previstas: [ocorrencia(DE_OUTUBRO, "2026-10-20"), ocorrencia(DE_NOVEMBRO, "2026-11-20")],
  });

  const lancadas = await lancarCobrancasDoCartao(banco, USUARIO, HOJE);

  assert.equal(lancadas, 1, "so a de outubro ja chegou");
  const [compra] = banco.tabelas.financial_transactions;
  assert.equal(compra.id, idDaCompraDaCobranca(DE_OUTUBRO));
  // A data e a da cobranca, e nao a de hoje: com 24/10 ela cairia na mesma
  // fatura aqui, mas com o fechamento no dia 22 cairia na seguinte.
  assert.equal(compra.transaction_date, "2026-10-20");
  assert.equal(compra.account_id, CARTAO);
  assert.equal(compra.amount, -39.9, "despesa entra negativa, como na baixa");
  assert.equal(compra.transaction_type, "expense");
  assert.equal(compra.service_id, "servico-financas");

  const [outubro, novembro] = banco.tabelas.scheduled_transactions;
  assert.deepEqual(
    [outubro.status, outubro.paid_date, outubro.transaction_id],
    ["paid", "2026-10-20", compra.id]
  );
  assert.equal(novembro.status, "pending", "a de novembro ainda e prevista");
});

test("cobranca no cartao: quatro leituras ao mesmo tempo lancam UMA compra", async () => {
  // A primeira leitura depois do dia costuma ser o painel, que abre quatro
  // rotas juntas. Com um id novo a cada tentativa a assinatura entraria quatro
  // vezes na fatura.
  const banco = bancoDeMentira({ previstas: [ocorrencia(DE_OUTUBRO, "2026-10-20")] });

  await Promise.all([1, 2, 3, 4].map(() => lancarCobrancasDoCartao(banco, USUARIO, HOJE)));

  assert.equal(banco.tabelas.financial_transactions.length, 1);
  assert.equal(banco.tabelas.scheduled_transactions[0].status, "paid");
});

test("cobranca no cartao: a compra ja lancada (23505) so fecha a prevista", async () => {
  // A vez anterior gravou a compra e falhou na baixa: a prevista ficou pendente
  // com a compra existindo. A proxima leitura nao pode lancar outra.
  const banco = bancoDeMentira({
    previstas: [ocorrencia(DE_OUTUBRO, "2026-10-20")],
    lancamentos: [
      {
        id: idDaCompraDaCobranca(DE_OUTUBRO),
        user_id: USUARIO,
        account_id: CARTAO,
        amount: -39.9,
        transaction_date: "2026-10-20",
        transaction_type: "expense",
      },
    ],
  });

  const lancadas = await lancarCobrancasDoCartao(banco, USUARIO, HOJE);

  assert.equal(lancadas, 0);
  assert.equal(banco.tabelas.financial_transactions.length, 1);
  assert.equal(banco.tabelas.scheduled_transactions[0].status, "paid");
});

test("cobranca no cartao: a escrita que falha deixa a prevista pendente", async () => {
  const banco = bancoDeMentira({
    previstas: [ocorrencia(DE_OUTUBRO, "2026-10-20")],
    erroNoInsert: { code: "42501", message: "permission denied" },
  });

  assert.equal(await lancarCobrancasDoCartao(banco, USUARIO, HOJE), 0);
  assert.equal(banco.tabelas.scheduled_transactions[0].status, "pending");
});

test("cobranca no cartao: fatura, transferencia, conta comum e MyBank nao viram compra", async () => {
  const banco = bancoDeMentira({
    previstas: [
      ocorrencia("aaaaaaaa-0000-4000-8000-0000000000f1", "2026-10-12", {
        recurring_rule_id: null,
        notes: `fatura:2026-10-01:${CARTAO}`,
      }),
      ocorrencia("aaaaaaaa-0000-4000-8000-0000000000f2", "2026-10-10", {
        transaction_type: "transfer",
      }),
      ocorrencia("aaaaaaaa-0000-4000-8000-0000000000f3", "2026-10-10", {
        account_id: CORRENTE,
      }),
      ocorrencia("aaaaaaaa-0000-4000-8000-0000000000f4", "2026-10-10", {
        notes: "mybank:parcela-1",
      }),
    ],
  });

  assert.equal(await lancarCobrancasDoCartao(banco, USUARIO, HOJE), 0);
  assert.equal(banco.inserts.length, 0);
});

test("cobranca no cartao: antes do dia ela SOMA na fatura aberta; depois, so a compra soma", async () => {
  // Cartao fecha dia 5 e vence dia 12. A compra de 15/10 e as cobrancas de
  // 20/10 (ja vencida) e 03/11 (avulsa, ainda prevista) caem na fatura de
  // novembro; a de 20/11 cai na de dezembro, que por enquanto nao tem compra
  // nenhuma -- e e o vencimento dela que o banco calcula.
  const banco = bancoDeMentira({
    previstas: [
      ocorrencia(DE_OUTUBRO, "2026-10-20"),
      ocorrencia(DE_NOVEMBRO, "2026-11-20"),
      ocorrencia("aaaaaaaa-0000-4000-8000-0000000a1103", "2026-11-03", {
        recurring_rule_id: null,
        description: "Passagem",
        amount: 100,
      }),
    ],
    lancamentos: [
      {
        id: "bbbbbbbb-0000-4000-8000-000000001015",
        user_id: USUARIO,
        account_id: CARTAO,
        amount: -200,
        transaction_date: "2026-10-15",
        transaction_type: "expense",
      },
    ],
  });

  const { previstas, semVencimento } = await faturasPrevistasDaJanela(banco, USUARIO, {
    de: "2026-10-01",
    ate: "2026-12-31",
    hoje: HOJE,
  });

  assert.deepEqual(semVencimento, []);
  assert.deepEqual(
    previstas.map((f) => [f.invoice_month, f.due_date, f.amount]),
    [
      // 200 da compra + 39,90 da cobranca de outubro (ja compra) + 100 da
      // avulsa prevista. A de outubro entra UMA vez: como compra.
      ["2026-11-01", "2026-11-12", 339.9],
      ["2026-12-01", "2026-12-12", 39.9],
    ]
  );
  assert.equal(
    banco.tabelas.scheduled_transactions[0].status,
    "paid",
    "a leitura lancou a de outubro antes de somar"
  );
});

test("cobranca no cartao: apagar a compra que o app lancou PULA a cobranca, e ela nao volta", async () => {
  const banco = bancoDeMentira({ previstas: [ocorrencia(DE_OUTUBRO, "2026-10-20")] });
  await lancarCobrancasDoCartao(banco, USUARIO, HOJE);
  const id = idDaCompraDaCobranca(DE_OUTUBRO);

  // A ordem da rota DELETE: le antes, apaga (o trigger solta), pula depois.
  const pulada = await cobrancaDaCompra(banco, USUARIO, id);
  assert.equal(pulada, DE_OUTUBRO);
  await banco.from("financial_transactions").delete().eq("id", id);
  assert.equal(banco.tabelas.scheduled_transactions[0].status, "pending", "a 065 soltou");
  await pularCobranca(banco, USUARIO, pulada);

  assert.equal(banco.tabelas.scheduled_transactions[0].status, "skipped");
  assert.equal(await lancarCobrancasDoCartao(banco, USUARIO, HOJE), 0);
  assert.equal(banco.tabelas.financial_transactions.length, 0, "a compra apagada nao voltou");
});

test("cobranca no cartao: a compra ligada a mao continua na RN006.5", async () => {
  // "Ja lancei" (RN006.3) liga a prevista a um lancamento que a pessoa fez, com
  // outro id. Apaga-lo devolve a prevista para pendente, como sempre.
  const manual = "cccccccc-0000-4000-8000-000000000001";
  const banco = bancoDeMentira({
    previstas: [
      ocorrencia(DE_OUTUBRO, "2026-10-20", {
        status: "paid",
        paid_date: "2026-10-20",
        transaction_id: manual,
      }),
    ],
  });

  assert.equal(await cobrancaDaCompra(banco, USUARIO, manual), null);
});
