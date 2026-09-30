#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DE REALIZADO + PREVISAO = TOTAL ESPERADO (HMO-174)
// =====================================================
//   npm run test:realizado-e-previsao
//
// Exercita lib/realizado-e-previsao.ts -- a moldura em que todo numero do
// painel passa a ser lido: o que JA aconteceu, o que AINDA vai acontecer, e a
// soma dos dois.
//
// -----------------------------------------------------------------------
// O que estes testes existem para pegar
// -----------------------------------------------------------------------
// Nenhum dos defeitos abaixo levanta excecao. Todos produzem SEIS numeros no
// formato certo, plausiveis, e uma conclusao falsa sobre o dinheiro de quem
// esta olhando. Nao ha sintoma para conferir por inspecao visual:
//
//   - a conta paga contada nos dois lados. E o defeito que a issue nomeia, e
//     ele tem um atalho pronto: `planned_expense` da view `planned_vs_actual`
//     tem o nome exato da feature e inclui as PAGAS. Uma conta de R$ 500 paga
//     no dia 5 entraria nos R$ 500 de "ja gastei" E dentro de "ainda vou
//     gastar", e o total esperado sairia R$ 500 alto -- o usuario acredita ter
//     menos dinheiro do que tem;
//
//   - a mesma cobranca contada duas vezes. Quem cadastrou a Netflix como conta
//     prevista E deixou o detector rodar tem a cobranca nas duas fontes. Somar
//     as duas cru e a armadilha 1 do lib/cash-flow-forecast.ts, e a Previsao do
//     painel tem que sair da linha JA deduplicada -- nao de um SUM novo;
//
//   - a transacao com data futura dentro do mes corrente contada como
//     realizada. `monthly_cash_flow` agrega o mes todo sem comparar com hoje, e
//     a materializacao de recorrencia cria exatamente esse caso: o numero entra
//     em "ja gastei" antes de acontecer e sai tambem da previsao;
//
//   - a transferencia inflando os dois lados. Ela nao muda o saldo liquido, e
//     por isso o erro passa verde em qualquer assercao sobre `net` (HMO-149) --
//     e por isso a fixture aqui TEM uma;
//
//   - o gasto variavel escorregando para dentro de Previsao. A decisao de
//     produto e que ele e linha separada e editavel. Somado dentro, a
//     identidade continua fechando: seriam os tres numeros errados juntos.
//
// -----------------------------------------------------------------------
// A IDENTIDADE SOZINHA NAO E TESTE
// -----------------------------------------------------------------------
// `realizado + previsao === total` vale por CONSTRUCAO em `montarLado` -- e uma
// assercao que nao pode falhar enquanto a soma estiver escrita ali, e um teste
// que nao pode falhar nao prova nada (ver a armadilha do controle negativo que
// nasce falso).
//
// Por isso cada caso abaixo afirma os TRES numeros contra valores escritos a
// mao a partir da regra -- nunca colados da saida das funcoes --, e a
// identidade vem junto como a leitura do conjunto. O que mata o mutante e o
// valor de `previsao`, nao o `===`.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  direcaoNoPainel,
  estimativaVariavel,
  janelaDaPrevisao,
  janelaDoRealizado,
  montarLado,
  montarPainel,
  somarLinhaNaJanela,
} = await import("../.tmp-realizado-e-previsao/realizado-e-previsao.js");

/** Setembro de 2026 inteiro, e hoje e o dia 15. */
const SETEMBRO = { de: "2026-09-01", ate: "2026-09-30" };
const HOJE = "2026-09-15";

/** Um dia da linha do forecast. */
const dia = (data, entra, sai) => ({ data, entra, sai });

// ---------------------------------------------------------------------------
// As duas janelas: onde cada lado tem direito de olhar
// ---------------------------------------------------------------------------

test("no periodo corrente, o realizado para em hoje e a previsao comeca em hoje", () => {
  assert.deepEqual(janelaDoRealizado(SETEMBRO, HOJE), {
    de: "2026-09-01",
    ate: "2026-09-15",
  });
  assert.deepEqual(janelaDaPrevisao(SETEMBRO, HOJE), {
    de: "2026-09-15",
    ate: "2026-09-30",
  });
});

test("periodo inteiramente passado: previsao nao existe, realizado e o periodo inteiro", () => {
  const julho = { de: "2026-07-01", ate: "2026-07-31" };

  assert.equal(janelaDaPrevisao(julho, HOJE), null);
  // O corte em hoje e INOCUO aqui -- o periodo inteiro ja passou --, e isso e
  // o que permite o painel usar a mesma regra para todo periodo.
  assert.deepEqual(janelaDoRealizado(julho, HOJE), {
    de: "2026-07-01",
    ate: "2026-07-31",
  });
});

test("periodo inteiramente futuro: realizado nao existe, previsao e o periodo inteiro", () => {
  const novembro = { de: "2026-11-01", ate: "2026-11-30" };

  assert.equal(janelaDoRealizado(novembro, HOJE), null);
  assert.deepEqual(janelaDaPrevisao(novembro, HOJE), {
    de: "2026-11-01",
    ate: "2026-11-30",
  });
});

test("periodo que termina hoje ainda tem previsao do proprio dia", () => {
  // A conta que vence HOJE e nao foi paga continua sendo dinheiro que vai sair.
  // Sem o dia inclusive ela nao estaria em lado nenhum -- nao virou transacao,
  // entao o Realizado tambem nao a tem.
  assert.deepEqual(janelaDaPrevisao({ de: "2026-09-01", ate: HOJE }, HOJE), {
    de: HOJE,
    ate: HOJE,
  });
});

// ---------------------------------------------------------------------------
// A direcao: o que entra em cada lado, e o que fica fora dos dois
// ---------------------------------------------------------------------------

test("receita prevista vai para receita, e o resto para despesa", () => {
  assert.equal(direcaoNoPainel("income", false), "income");
  assert.equal(direcaoNoPainel("expense", false), "expense");
  // Direcao ilegivel cai em despesa: o default historico da rota de baixa. Ler
  // uma despesa como receita mostraria "vou receber" sobre uma conta a pagar.
  assert.equal(direcaoNoPainel(null, false), "expense");
  assert.equal(direcaoNoPainel("coisa-nova", false), "expense");
});

test("transferencia fica fora dos dois lados", () => {
  assert.equal(direcaoNoPainel("transfer", false), null);
});

test("fatura de cartao fica fora dos dois lados, mesmo marcada como despesa", () => {
  // Cada compra do cartao ja entrou como despesa no dia em que aconteceu.
  // Contar a fatura por cima cobraria as mesmas compras uma segunda vez.
  assert.equal(direcaoNoPainel("expense", true), null);
  assert.equal(direcaoNoPainel("income", true), null);
});

// ---------------------------------------------------------------------------
// A soma da previsao dentro da janela
// ---------------------------------------------------------------------------

test("so os dias dentro da janela entram na previsao", () => {
  const linha = [
    dia("2026-09-14", 0, 900), // antes da janela: ja e passado
    dia("2026-09-20", 0, 500),
    dia("2026-09-25", 7000, 0),
    dia("2026-10-05", 0, 800), // depois da janela: e do mes seguinte
  ];

  const previsao = somarLinhaNaJanela(linha, janelaDaPrevisao(SETEMBRO, HOJE));

  assert.equal(previsao.despesa, 500);
  assert.equal(previsao.receita, 7000);
});

test("janela nula devolve zeros, e nao a soma do horizonte inteiro", () => {
  const linha = [dia("2026-09-20", 0, 500), dia("2026-11-10", 0, 800)];
  const previsao = somarLinhaNaJanela(linha, null);

  assert.equal(previsao.receita, 0);
  assert.equal(previsao.despesa, 0);
});

test("valor ilegivel na linha vale zero, e nao apaga o resto da soma", () => {
  // O PostgREST devolve `numeric` como TEXTO, e uma coluna nova que ninguem
  // preencheu chega `null`. Sem a coercao, UM valor ruim vira NaN e contamina a
  // soma inteira: o tile imprime "R$ NaN" no melhor caso e, se a tela formatar,
  // um traco onde havia dinheiro.
  const previsao = somarLinhaNaJanela(
    [
      dia("2026-09-20", null, "500.00"),
      dia("2026-09-21", undefined, "nao-e-numero"),
      dia("2026-09-22", "1200", 0),
    ],
    janelaDaPrevisao(SETEMBRO, HOJE)
  );

  assert.equal(previsao.despesa, 500);
  assert.equal(previsao.receita, 1200);
});

test("a soma fecha no centavo, sem o residuo do ponto flutuante", () => {
  // 0.1 + 0.2 da 0.30000000000000004 em IEEE 754. Sem o arredondamento, o tile
  // imprime um numero com quinze casas e a identidade `realizado + previsao ===
  // total` falha por um residuo que nenhum humano ve.
  const previsao = somarLinhaNaJanela(
    [dia("2026-09-20", 0, 0.1), dia("2026-09-21", 0, 0.2)],
    janelaDaPrevisao(SETEMBRO, HOJE)
  );

  assert.equal(previsao.despesa, 0.3);

  const lado = montarLado(0.1, 0.2);
  assert.equal(lado.total, 0.3);
});

// ---------------------------------------------------------------------------
// ACEITE 1, 2 e 6: os seis numeros de um mes de verdade
// ---------------------------------------------------------------------------
// A fixture, escrita a mao:
//
//   JA ACONTECEU (financial_transactions, transaction_date <= 15/09)
//     salario ................. receita  7.000,00   (dia 05)
//     aluguel PAGO ............ despesa  1.500,00   (dia 05, era conta prevista)
//     mercado ................. despesa    420,00   (dia 12)
//     transferencia CC -> poupanca ...... 2.000,00  (dia 10)  << fora dos dois
//
//   AINDA VAI ACONTECER (agenda pendente + recorrencia, ja deduplicadas)
//     escola .................. despesa    800,00   (dia 20)
//     Netflix ................. despesa     55,00   (dia 22)
//     freela .................. receita  1.200,00   (dia 28)
//
// Realizado  receita 7.000,00   despesa 1.920,00
// Previsao   receita 1.200,00   despesa   855,00
// Total      receita 8.200,00   despesa 2.775,00
//
// A transferencia NAO aparece em nenhum dos seis. Ela esta na fixture de
// proposito: sem ela o teste passa verde com o bug de pe, porque uma
// transferencia infla receita E despesa na mesma medida e o saldo liquido
// continua exato (HMO-149).
// ---------------------------------------------------------------------------

/** O realizado como /api/reports/cash-flow devolve: os dois JA positivos. */
const REALIZADO_DE_SETEMBRO = { receita: 7000, despesa: 1920 };

/** A linha do forecast, ja deduplicada pelo lib/cash-flow-forecast.ts. */
const LINHA_DE_SETEMBRO = [
  dia("2026-09-15", 0, 0),
  dia("2026-09-20", 0, 800),
  dia("2026-09-22", 0, 55),
  dia("2026-09-28", 1200, 0),
];

test("os seis numeros do mes corrente, e Realizado + Previsao = Total esperado", () => {
  const previsao = somarLinhaNaJanela(
    LINHA_DE_SETEMBRO,
    janelaDaPrevisao(SETEMBRO, HOJE)
  );
  const painel = montarPainel(REALIZADO_DE_SETEMBRO, previsao);

  assert.equal(painel.receita.realizado, 7000);
  assert.equal(painel.receita.previsao, 1200);
  assert.equal(painel.receita.total, 8200);

  assert.equal(painel.despesa.realizado, 1920);
  assert.equal(painel.despesa.previsao, 855);
  assert.equal(painel.despesa.total, 2775);

  // A leitura do conjunto. Sozinha ela nao prova nada -- vale por construcao --,
  // e por isso vem DEPOIS dos seis valores escritos a mao.
  assert.equal(
    painel.receita.realizado + painel.receita.previsao,
    painel.receita.total
  );
  assert.equal(
    painel.despesa.realizado + painel.despesa.previsao,
    painel.despesa.total
  );
});

test("a conta prevista PAGA no periodo aparece so em Realizado", () => {
  // O aluguel de R$ 1.500 foi pago no dia 05 e ja esta dentro dos R$ 1.920 de
  // Realizado. Ele nao esta na linha do forecast porque deixou de ser pendente.
  //
  // Este e o controle que a issue pede: trocar a fonte da Previsao para o
  // `planned_expense` da view `planned_vs_actual` colocaria os R$ 1.500 de
  // volta (la a paga conta, e la isso e o certo), e a despesa prevista viraria
  // 855 + 1.500 = 2.355 com o total em 4.275.
  const previsao = somarLinhaNaJanela(
    LINHA_DE_SETEMBRO,
    janelaDaPrevisao(SETEMBRO, HOJE)
  );

  assert.equal(previsao.despesa, 855);
  assert.notEqual(previsao.despesa, 2355);

  const painel = montarPainel(REALIZADO_DE_SETEMBRO, previsao);
  assert.equal(painel.despesa.total, 2775);
});

test("a cobranca que existe nas duas fontes conta UMA vez", () => {
  // A linha do forecast ja e o resultado da deduplicacao: a Netflix aparece
  // como conta prevista (dia 22) e a recorrencia detectada do mesmo
  // estabelecimento foi absorvida la. Somar as duas fontes cru daria 55 + 55.
  const previsao = somarLinhaNaJanela(
    LINHA_DE_SETEMBRO,
    janelaDaPrevisao(SETEMBRO, HOJE)
  );

  assert.equal(previsao.despesa, 855);
  assert.notEqual(previsao.despesa, 910);
});

// ---------------------------------------------------------------------------
// ACEITE 4: a transacao com data futura dentro do mes corrente
// ---------------------------------------------------------------------------

test("o que esta datado depois de hoje nao pode entrar em Realizado", () => {
  // A janela do realizado para em 15/09. Uma transacao lancada com data 25/09 --
  // que a materializacao de recorrencia cria exatamente assim -- fica fora dela.
  const janela = janelaDoRealizado(SETEMBRO, HOJE);

  assert.equal(janela.ate, "2026-09-15");
  assert.ok(janela.ate < "2026-09-25");
});

test("e ele entra em Previsao, no dia em que vence", () => {
  const previsao = somarLinhaNaJanela(
    [dia("2026-09-25", 0, 300)],
    janelaDaPrevisao(SETEMBRO, HOJE)
  );

  assert.equal(previsao.despesa, 300);
});

// ---------------------------------------------------------------------------
// ACEITE 5: periodo passado e periodo futuro
// ---------------------------------------------------------------------------

test("periodo passado: Previsao zerada nos dois lados, e o total e o realizado", () => {
  const julho = { de: "2026-07-01", ate: "2026-07-31" };
  const previsao = somarLinhaNaJanela(
    LINHA_DE_SETEMBRO,
    janelaDaPrevisao(julho, HOJE)
  );
  const painel = montarPainel({ receita: 5000, despesa: 4100 }, previsao);

  assert.equal(painel.receita.previsao, 0);
  assert.equal(painel.despesa.previsao, 0);
  assert.equal(painel.receita.total, 5000);
  assert.equal(painel.despesa.total, 4100);
});

test("periodo futuro: Realizado zerado nos dois lados, e o total e a previsao", () => {
  const novembro = { de: "2026-11-01", ate: "2026-11-30" };
  const previsao = somarLinhaNaJanela(
    [dia("2026-11-10", 0, 800), dia("2026-11-05", 7000, 0)],
    janelaDaPrevisao(novembro, HOJE)
  );
  const painel = montarPainel({ receita: 0, despesa: 0 }, previsao);

  assert.equal(painel.receita.realizado, 0);
  assert.equal(painel.despesa.realizado, 0);
  assert.equal(painel.receita.total, 7000);
  assert.equal(painel.despesa.total, 800);
});

// ---------------------------------------------------------------------------
// O sinal
// ---------------------------------------------------------------------------

test("despesa que chega negativa nao diminui o total esperado", () => {
  // Sao TRES convencoes de sinal alimentando o mesmo tile. Um negativo escapando
  // viraria uma despesa que ENCOLHE o total -- numero plausivel, conta errada.
  const lado = montarLado(-1920, -855);

  assert.equal(lado.realizado, 1920);
  assert.equal(lado.previsao, 855);
  assert.equal(lado.total, 2775);
});

// ---------------------------------------------------------------------------
// ACEITE 8: o gasto variavel e linha separada
// ---------------------------------------------------------------------------

test("mudar a estimativa de gasto variavel nao move nenhum dos seis numeros", () => {
  const previsao = somarLinhaNaJanela(
    LINHA_DE_SETEMBRO,
    janelaDaPrevisao(SETEMBRO, HOJE)
  );

  const painel = montarPainel(REALIZADO_DE_SETEMBRO, previsao);

  // A estimativa e calculada ao lado, e nao ha por onde ela entrar em
  // `montarPainel` -- a assinatura nao a aceita. Os dois valores abaixo sao
  // deliberadamente distantes: R$ 3.000 de diferenca no total variavel.
  const barata = estimativaVariavel(10, janelaDaPrevisao(SETEMBRO, HOJE), HOJE);
  const cara = estimativaVariavel(210, janelaDaPrevisao(SETEMBRO, HOJE), HOJE);

  assert.notEqual(barata.total, cara.total);

  assert.equal(painel.despesa.previsao, 855);
  assert.equal(painel.despesa.total, 2775);
  assert.equal(painel.receita.previsao, 1200);
  assert.equal(painel.receita.total, 8200);
});

test("a estimativa variavel comeca amanha e para no fim do periodo", () => {
  // Hoje e 15/09 e o periodo vai ate 30/09: 15 dias (16 a 30 inclusive). O dia
  // de hoje nao conta -- o que foi gasto e lancado hoje ja esta em Realizado.
  const estimativa = estimativaVariavel(
    60,
    janelaDaPrevisao(SETEMBRO, HOJE),
    HOJE
  );

  assert.equal(estimativa.dias, 15);
  assert.equal(estimativa.total, 900);
  assert.equal(estimativa.porDia, 60);
});

test("em periodo futuro a estimativa cobre a janela inteira", () => {
  // Novembro tem 30 dias e nenhum deles e hoje: nao ha um dia ja gasto para
  // descontar.
  const estimativa = estimativaVariavel(
    60,
    janelaDaPrevisao({ de: "2026-11-01", ate: "2026-11-30" }, HOJE),
    HOJE
  );

  assert.equal(estimativa.dias, 30);
  assert.equal(estimativa.total, 1800);
});

test("em periodo passado a estimativa e zero, nao a media vezes o mes", () => {
  const estimativa = estimativaVariavel(
    60,
    janelaDaPrevisao({ de: "2026-07-01", ate: "2026-07-31" }, HOJE),
    HOJE
  );

  assert.equal(estimativa.dias, 0);
  assert.equal(estimativa.total, 0);
});

test("periodo que termina hoje nao tem dia de gasto variavel pela frente", () => {
  const estimativa = estimativaVariavel(
    60,
    janelaDaPrevisao({ de: "2026-09-01", ate: HOJE }, HOJE),
    HOJE
  );

  assert.equal(estimativa.dias, 0);
  assert.equal(estimativa.total, 0);
});

test("media negativa vira zero, nao receita", () => {
  const estimativa = estimativaVariavel(
    -60,
    janelaDaPrevisao(SETEMBRO, HOJE),
    HOJE
  );

  assert.equal(estimativa.porDia, 0);
  assert.equal(estimativa.total, 0);
});
