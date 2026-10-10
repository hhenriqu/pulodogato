#!/usr/bin/env node
// =====================================================
// PULODOGATO - "ela pagou; eu confirmo" na aba Receitas (HMO-366, F4 da HMO-360)
// =====================================================
//   npm run test:acerto-na-aba-receitas
//
// "o pagamento dela gera uma receita prevista pra mim. Ela clica que pagou, e o
// meu continua como previsto, e eu tenho que confirmar que foi pago."
//
// `lib/acerto-na-aba-receitas.ts` decide QUAIS acertos a aba Receitas mostra e
// em qual dos dois lados. Nada nela e mecanismo novo -- o estado vem de
// `comoEuVejoOAcerto` (fase 12) e a frase de `descricaoDoAcerto` (fase 11) --, e
// e exatamente por isso que esta suite existe: o jeito de errar aqui e desfazer
// uma daquelas decisoes sem tocar nos modulos que as medem.
//
// AS SEIS COISAS QUE ERRAM EM SILENCIO SE MUDAREM
// -----------------------------------------------
//   1. O MESMO ACERTO, AS DUAS SESSOES. Para quem RECEBE ele e linha a
//      confirmar; para quem PAGOU ele nao esta nesta aba. Com um `userId` so,
//      qualquer filtro "funciona" -- o teste roda o MESMO acerto pelos dois ids
//      e exige o par. E o enunciado que uma sessao sozinha nao falsifica.
//
//   2. O ACERTO ENTRE OUTRAS DUAS PESSOAS NAO APARECE. A policy da 007 e
//      `USING (is_group_member(group_id))`: a quitacao do Caio com a Bia E
//      legivel para mim, e nao e minha. Listada, ela poria na minha aba
//      Receitas um valor que nunca vai entrar na minha conta, com um botao que
//      a rota recusa com 403.
//
//   3. CONFIRMAR MOVE A LINHA DE LADO, E AS DUAS ASSERCOES SAO UMA SO. O mesmo
//      acerto com `temPerna: false` esta em `a_confirmar` e fora de
//      `confirmados`; com a perna, o contrario. Medir so a primeira metade
//      deixa passar o defeito que a fase tem de resolver -- a linha que
//      DESAPARECE depois do clique.
//
//   4. A FRASE DA TELA E A FRASE DO EXTRATO. `descricao` sai de
//      `descricaoDoAcerto`, a MESMA funcao que o POST da perna usa para gravar
//      `financial_transactions.description`. O teste compara os dois lados
//      ATRAVESSANDO as duas funcoes, e nao com uma string escrita aqui: uma
//      frase propria na lib passaria por qualquer assercao textual e faria a
//      tela prometer um nome que o extrato nao repete.
//
//   5. SO A ABA RECEITAS. Em Despesas estas linhas seriam uma divida que nao
//      existe; em Transferencias, um numero sem rotulo. A guarda esta no mesmo
//      lugar da cadeia que a de `resumoComReembolsoPrevisto`.
//
//   6. VALOR QUE NAO E NUMERO POSITIVO NAO VIRA LINHA. `numeric` chega como
//      string do PostgREST e `Number("")` e 0 -- nao `NaN`, entao nenhum
//      `isNaN` o pega. Uma linha de R$ 0,00 com botao Confirmar abre um dialogo
//      que o servidor recusa, e o sintoma e "cliquei e nada aconteceu".
//
// O QUE ESTA SUITE NAO PROVA, e onde isso e provado
// -------------------------------------------------
//   * que a perna e gravada como `transfer` com `group_id: null` literal: isso
//     e `npm run test:acerto-em-lancamento` e `npm run test:perna-da-contraparte`,
//     e e a ROTA que esta fase reutiliza sem copiar uma linha. Reafirmar aqui
//     seria o terceiro criterio da mesma coisa;
//   * que o clique chega na rota certa e que a tela reflete o resultado: isso e
//     `npm run test:lista-na-tela`, em Chromium de verdade (caso M);
//   * que os dois lados se veem em producao: duas sessoes, no comentario da
//     issue.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  ACERTOS_VAZIOS,
  ACERTO_FORA_DO_PREVISTO,
  ACERTO_FORA_DO_REALIZADO,
  SUBTITULO_A_CONFIRMAR,
  TITULO_A_CONFIRMAR,
  TITULO_CONFIRMADO,
  acertosNaAbaReceitas,
} from "../.tmp-acerto-na-aba-receitas/acerto-na-aba-receitas.js";

import {
  chaveDoAcerto,
  descricaoDoAcerto,
} from "../.tmp-acerto-na-aba-receitas/acerto-em-lancamento.js";

const EU = "aaaaaaaa-0000-0000-0000-00000000a001";
const LETICIA = "bbbbbbbb-0000-0000-0000-00000000b001";
const CAIO = "cccccccc-0000-0000-0000-00000000c001";

const GRUPO = "9f000000-0000-0000-0000-00000000c0a1";
const ID = "5e111111-0000-0000-0000-000000000001";

/** Leticia pagou R$ 300 para mim, e ela registrou. */
const ACERTO = {
  id: ID,
  group_id: GRUPO,
  from_user_id: LETICIA,
  to_user_id: EU,
  created_by: LETICIA,
  // STRING de proposito: `numeric` chega assim no JSON do PostgREST, e e o
  // formato que a rota passa adiante.
  amount: "300.00",
  currency: "BRL",
  exchange_rate: "1",
  settled_on: "2026-10-08",
};

const NOMES = new Map([
  [LETICIA, "Letícia"],
  [CAIO, "Caio"],
]);
const GRUPOS = new Map([[GRUPO, "Casa"]]);

/** A leitura, com os parametros que a rota passa. */
const ler = ({
  acertos = [ACERTO],
  tipo = "income",
  userId = EU,
  comPerna = [],
} = {}) =>
  acertosNaAbaReceitas({
    acertos,
    tipo,
    userId,
    chavesComPerna: new Set(comPerna.map((id) => chaveDoAcerto(id))),
    nomes: NOMES,
    grupos: GRUPOS,
  });

// ---------------------------------------------------------------------------
// 1. O MESMO ACERTO, AS DUAS SESSOES
// ---------------------------------------------------------------------------

test("quem RECEBE ve o acerto a confirmar; quem PAGOU nao o ve nesta aba", () => {
  const meu = ler({ userId: EU });
  const dela = ler({ userId: LETICIA });

  assert.equal(meu.a_confirmar.length, 1, "eu sou to_user_id: a linha e minha");
  assert.equal(meu.a_confirmar[0].settlementId, ID);

  // O PAR e a assercao. Para a Leticia este acerto tambem esta `a_lancar` (ela
  // registrou e pode nao ter lancado), e ele e uma SAIDA de dinheiro: listado
  // aqui, ele poria um debito na aba Receitas dela.
  assert.equal(
    dela.a_confirmar.length,
    0,
    "quem paga nao tem receita: a confirmacao dela vive na tela do grupo"
  );
  assert.equal(dela.confirmados.length, 0);
});

test("o acerto entre outras duas pessoas nao entra na minha aba", () => {
  const entreOutros = {
    ...ACERTO,
    from_user_id: CAIO,
    to_user_id: LETICIA,
    created_by: CAIO,
  };

  const visto = ler({ acertos: [entreOutros], userId: EU });

  assert.deepEqual(visto, ACERTOS_VAZIOS, "a policy me deixa LER, nao me faz parte");
});

// ---------------------------------------------------------------------------
// 2. CONFIRMAR MOVE A LINHA DE LADO -- as duas metades, no mesmo bloco
// ---------------------------------------------------------------------------

test("sem perna a linha esta em a_confirmar; com perna ela esta em confirmados", () => {
  const antes = ler({ comPerna: [] });
  const depois = ler({ comPerna: [ID] });

  assert.equal(antes.a_confirmar.length, 1, "antes: aparece no lado a confirmar");
  assert.equal(antes.confirmados.length, 0, "antes: NAO aparece como recebido");

  // A SEGUNDA ASSERCAO, que e a da pegadinha de UX: depois de confirmar a linha
  // nao pode simplesmente desaparecer -- a perna e `transfer` e nao entra em
  // Receitas realizadas, entao este lado e o unico lugar onde ela existe.
  assert.equal(depois.a_confirmar.length, 0, "depois: sai do lado a confirmar");
  assert.equal(depois.confirmados.length, 1, "depois: aparece como recebido");
  assert.equal(depois.confirmados[0].settlementId, ID);
});

test("a chave da linha e a MESMA que a perna leva em notes", () => {
  const linha = ler().a_confirmar[0];

  assert.equal(linha.id, chaveDoAcerto(ID));
  assert.match(
    linha.id,
    /^acerto:/,
    "o prefixo impede que este id passe por um id de scheduled_transactions"
  );
  assert.equal(
    linha.settlementId,
    ID,
    "quem monta a URL do POST usa settlementId, nunca o id prefixado"
  );
  assert.equal(linha.groupId, GRUPO, "a rota da perna e por grupo");
});

// ---------------------------------------------------------------------------
// 3. A FRASE DA TELA E A FRASE DO EXTRATO
// ---------------------------------------------------------------------------

test("a descricao da linha e a MESMA que o POST grava na perna", () => {
  const linha = ler().a_confirmar[0];

  // Atravessa as duas funcoes, e nao compara com uma string escrita aqui.
  const comoAPernaGrava = descricaoDoAcerto({
    direcao: "recebi",
    nomeDaContraparte: "Letícia",
    nomeDoGrupo: "Casa",
  });

  assert.equal(linha.descricao, comoAPernaGrava);
  assert.match(linha.descricao, /Letícia/, "o nome de quem pagou esta na frase");
});

test("perfil invisivel pela RLS nao derruba a linha -- a frase tem fallback", () => {
  const visto = acertosNaAbaReceitas({
    acertos: [ACERTO],
    tipo: "income",
    userId: EU,
    chavesComPerna: new Set(),
    // Participar do mesmo grupo nao da acesso ao perfil do outro: o mapa vem
    // sem o nome, e isso e caminho normal.
    nomes: new Map(),
    grupos: GRUPOS,
  });

  assert.equal(visto.a_confirmar.length, 1, "sem nome a linha CONTINUA na tela");
  assert.equal(visto.a_confirmar[0].nomeDaContraparte, null);
  assert.equal(
    visto.a_confirmar[0].descricao,
    descricaoDoAcerto({ direcao: "recebi", nomeDoGrupo: "Casa" })
  );
});

// ---------------------------------------------------------------------------
// 4. SO A ABA RECEITAS
// ---------------------------------------------------------------------------

test("Despesas e Transferencias nao recebem acerto nenhum", () => {
  for (const tipo of ["expense", "transfer"]) {
    assert.deepEqual(
      ler({ tipo }),
      ACERTOS_VAZIOS,
      `${tipo}: o acerto aqui seria uma divida que nao existe, ou um numero sem rotulo`
    );
  }

  // O controle do lado de ca: em `income` a MESMA entrada produz a linha. Sem
  // ele, um mutante que esvaziasse tudo passaria pelo bloco acima.
  assert.equal(ler({ tipo: "income" }).a_confirmar.length, 1);
});

// ---------------------------------------------------------------------------
// 5. VALOR E MOEDA
// ---------------------------------------------------------------------------

test("o valor sai NUMERO positivo na moeda da quitacao, sem conversao", () => {
  const linha = ler().a_confirmar[0];

  assert.equal(linha.valor, 300, "`numeric` chega string e tem de sair numero");
  assert.equal(typeof linha.valor, "number");
  assert.equal(linha.moeda, "BRL");
  assert.equal(linha.cotacao, 1);
  assert.equal(linha.data, "2026-10-08", "a data e settled_on, nao hoje");
});

test("acerto em moeda estrangeira mantem a moeda e a cotacao da quitacao", () => {
  // A 026 congela as duas em `settled_on`: pela cotacao de hoje o valor
  // recebido mudaria sozinho todo dia.
  const emDolar = {
    ...ACERTO,
    amount: "50.00",
    currency: "USD",
    exchange_rate: "5.35",
  };

  const linha = ler({ acertos: [emDolar] }).a_confirmar[0];

  assert.equal(linha.valor, 50, "NAO convertido aqui: quem converte e pernaDoAcerto");
  assert.equal(linha.moeda, "USD");
  assert.equal(linha.cotacao, 5.35);
});

test("valor vazio, zero, negativo ou nao-numerico nao vira linha", () => {
  for (const amount of ["", "0", "0.00", "-300.00", "abc", null]) {
    const visto = ler({ acertos: [{ ...ACERTO, amount }] });
    assert.deepEqual(
      visto,
      ACERTOS_VAZIOS,
      `amount=${JSON.stringify(amount)} nao pode ganhar botao Confirmar`
    );
  }
});

test("moeda desconhecida cai em BRL em vez de derrubar a linha", () => {
  const linha = ler({ acertos: [{ ...ACERTO, currency: "XYZ" }] }).a_confirmar[0];
  assert.equal(linha.moeda, "BRL");
});

// ---------------------------------------------------------------------------
// 6. ORDEM E ROTULOS
// ---------------------------------------------------------------------------

test("as duas ordens sao opostas, como nas secoes da tela", () => {
  const velho = { ...ACERTO, id: `${ID}a`, settled_on: "2026-10-02" };
  const novo = { ...ACERTO, id: `${ID}b`, settled_on: "2026-10-20" };

  const aConfirmar = ler({ acertos: [novo, velho] }).a_confirmar;
  assert.deepEqual(
    aConfirmar.map((l) => l.data),
    ["2026-10-02", "2026-10-20"],
    "a confirmar: crescente -- o mais antigo espera ha mais tempo"
  );

  const confirmados = ler({
    acertos: [velho, novo],
    comPerna: [velho.id, novo.id],
  }).confirmados;
  assert.deepEqual(
    confirmados.map((l) => l.data),
    ["2026-10-20", "2026-10-02"],
    "confirmados: decrescente -- o ultimo e o que a pessoa acabou de fazer"
  );
});

test("as frases dizem FORA do total, e as duas falam de cartoes diferentes", () => {
  // Elas sao a entrega da pegadinha desta fase: um valor na tela que nao esta
  // em nenhum dos tres cartoes, sem frase, e indistinguivel de bug.
  assert.match(ACERTO_FORA_DO_PREVISTO, /Previsto/);
  assert.match(ACERTO_FORA_DO_PREVISTO, /reembolso previsto/);
  assert.match(ACERTO_FORA_DO_REALIZADO, /Realizado/);
  assert.match(ACERTO_FORA_DO_REALIZADO, /transfer/i);

  assert.notEqual(
    ACERTO_FORA_DO_PREVISTO,
    ACERTO_FORA_DO_REALIZADO,
    "a mesma frase nos dois lados nao explicaria nenhum dos dois"
  );

  // O estado do bloco a confirmar tem de dizer a CONSEQUENCIA de nao agir:
  // sem ela a linha se le como aviso e fica ali para sempre.
  assert.match(SUBTITULO_A_CONFIRMAR, /extrato/);
  assert.notEqual(TITULO_A_CONFIRMAR, TITULO_CONFIRMADO);
});

test("ACERTOS_VAZIOS e a forma que a tela recebe quando nao ha nada", () => {
  assert.deepEqual(ACERTOS_VAZIOS, { a_confirmar: [], confirmados: [] });
  assert.deepEqual(ler({ acertos: [] }), ACERTOS_VAZIOS);
});
