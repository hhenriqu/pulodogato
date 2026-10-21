#!/usr/bin/env node
// =====================================================
// PULODOGATO - o lancamento que nao soma nos totais, nas duas rotas (HMO-452)
// =====================================================
//   npm run test:fora-dos-totais-no-lancamento
//
// "escolher uma despesa e uma receita pra nao aparecer nos totais, exemplo
// adicionei um ajuste na minha conta investimento, ela entrou como uma receita
// de ajuste mas nao quero que ela fique somana nos totais." (HMO-443)
//
// A coluna e `financial_transactions.include_in_total boolean NOT NULL DEFAULT
// true` (migration 060), POSITIVA, homonima da de `financial_accounts` (058).
// Esta suite mede as DUAS pontas de escrita dela, e elas tem formas opostas de
// proposito.
//
// =====================================================================
// A ASSIMETRIA QUE ESTA SUITE EXISTE PARA PRENDER
// =====================================================================
// POST -- CONDICIONAL. `...(include_in_total === false ? { include_in_total:
// false } : {})`: a coluna so e NOMEADA no INSERT quando a pessoa pediu para
// tirar dos totais. Nos outros casos a chave nem aparece no corpo, e a linha
// cai no DEFAULT `true` -- que e o mesmo valor que um `include_in_total: true`
// explicito gravaria. O que a omissao COMPRA e a janela entre o deploy e a
// colagem da 060 (ela e colada a mao no SQL Editor, `deploy-ships-code-not-
// schema`): contra um banco sem a coluna, nomea-la num INSERT faz o PostgREST
// responder `42703` e a rota cair em 500 -- e ai NENHUM lancamento e criado
// pela API, nao so o que ia ficar fora dos totais.
//
// PATCH -- ESTRITO. `body.include_in_total === true`, a forma copiada do PATCH
// da 058 (`app/api/financial-accounts/[id]/route.ts`). Aqui nao existe "omitir
// e cair no DEFAULT": o que entra em `updateData` e GRAVADO. E e por isso que
// a assercao mais importante desta suite e a da STRING:
//
//     Boolean("false") === true
//
// Com `Boolean(body.include_in_total)` no lugar do `=== true`, um cliente que
// mandasse `"false"` -- um form urlencoded, um `FormData`, um fetch montado a
// mao -- RELIGARIA o lancamento nos totais. Com 200, corpo completo de volta, e
// nenhuma diferenca na tela: a pessoa clica em "Não somar nos totais", o app diz
// pronto, e o total continua incluindo o ajuste. Gravar o OPOSTO do pedido e o
// unico defeito desta feature que nao tem sintoma nenhum.
//
// =====================================================================
// POR QUE SONDA DE ROTA, E NAO GUARD DE TEXTO NEM O TSC
// =====================================================================
// `request.json()` devolve `any`, entao `body.include_in_total` compila com
// qualquer coisa do outro lado; e o objeto literal que vai para o
// `.insert()`/`.update()` do supabase-js esta na fronteira permissiva do
// client -- trocar `=== true` por `Boolean(...)`, ou `=== false` por
// `!include_in_total`, compila igual. As duas rotas respondem 200/201 com o
// corpo completo em todos esses casos, entao a RESPOSTA nao distingue nenhum
// deles. A unica medida que corresponde a promessa e chamar o handler e olhar o
// PAYLOAD que ele mandou gravar.
//
// Guard de texto e pior que inutil aqui: os comentarios das duas rotas CITAM
// `Boolean(body.include_in_total)` e `!include_in_total` para explicar o que
// NAO fazer, e uma varredura do fonte cru leria a propria prosa e continuaria
// verde depois de alguem trocar o codigo pela forma errada. E a mesma armadilha
// que o guard de fonte da HMO-218 precisou recortar o objeto para evitar.
//
// O unico bloco textual desta suite e o ultimo, e ele e ANCORADO nos argumentos
// dos `.select()` -- nao no arquivo. Ver o comentario dele.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { criarDuble } from "./duble-de-supabase.mjs";

const RAIZ = new URL("../.tmp-fora-dos-totais-no-lancamento/", import.meta.url);

const ROTA_POST = await import(
  new URL("app/api/personal-finance/transactions/route.js", RAIZ).href
);
const ROTA_PATCH = await import(
  new URL("app/api/personal-finance/transactions/[id]/route.js", RAIZ).href
);

const DONO = "dono-1";
const SERVICO = "servico-financas";
const CATEGORIA = "cat-ajuste-de-saldo";
const GRUPO = "grupo-1";
const LINHA = "transacao-1";

/** A chave que esta suite inteira persegue, escrita uma vez. */
const COLUNA = "include_in_total";

/**
 * O valor AUSENTE, para distinguir "a chave nao foi mandada" de `undefined`.
 *
 * `comCampo: false` nos dois ajudantes abaixo OMITE a chave do corpo em vez de
 * manda-la com `undefined`. As duas coisas sao diferentes para quem le: um
 * cliente velho (a fila offline de uma aba antiga, o importador que a HMO-224
 * cita) manda o corpo SEM a chave, e esse caso tem de gravar o default -- nao
 * estourar e nao desligar nada.
 */
const SEM_CAMPO = Symbol("sem campo");

// ---------------------------------------------------------------------------
// O POST
// ---------------------------------------------------------------------------

/**
 * Chama o POST com um duble e devolve o payload do INSERT em
 * `financial_transactions`.
 */
async function criar({ valor = SEM_CAMPO, group_id = null } = {}) {
  const sessao = criarDuble({
    user: { id: DONO },
    tabelas: {
      financial_services: [{ id: SERVICO, name: "personal_finance" }],
      // `is_expense: false` -- o caso real da issue e uma RECEITA de ajuste de
      // saldo, que e exatamente a linha que o Helio quer tirar do total de
      // receitas. Uma despesa aqui mediria o mesmo caminho e com o exemplo
      // errado.
      transaction_categories: [{ id: CATEGORIA, is_expense: false }],
      // Semeada (ainda que vazia) de proposito: e a chave em `tabelas` que da
      // ao `insert` do duble um array onde acumular. Ver o `linhas.push` em
      // duble-de-supabase.mjs.
      financial_transactions: [],
      group_members: group_id
        ? [{ id: "membro-1", group_id, user_id: DONO, status: "active" }]
        : [],
      group_transactions: [],
    },
  });

  const registro = { sessao: () => sessao.client };
  globalThis.__dubleDeSupabase = registro;

  const corpo = {
    description: "Ajuste de saldo da conta investimento",
    amount: 250.5,
    category_id: CATEGORIA,
    transaction_date: "2026-10-21",
    notes: null,
    is_shared: false,
    group_id,
  };

  if (valor !== SEM_CAMPO) corpo[COLUNA] = valor;

  let resposta;
  try {
    resposta = await ROTA_POST.POST({ json: async () => corpo });
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  // CONTROLE POSITIVO. Sem ele o resto passa por vacuidade: uma rota que
  // trocasse o jeito de obter o client deixaria o duble intocado, `escritas`
  // ficaria vazia, e uma assercao sobre "a chave nao esta no payload" responde
  // verde sobre payload que nao existe.
  assert.ok(
    (registro.chamadasDeSessao ?? 0) > 0,
    "controle positivo: o POST nao abriu o client de SESSAO -- o payload " +
      "medido abaixo nao veio dele."
  );

  const inserts = sessao.escritas.filter(
    (e) => e.verbo === "insert" && e.tabela === "financial_transactions"
  );

  assert.equal(
    inserts.length,
    1,
    `esperava UM insert em financial_transactions, vieram ${inserts.length} ` +
      "-- a assercao de payload abaixo nao sabe de qual deles falar."
  );

  // `linhas` e o que a rota MANDOU gravar, no instante em que mandou, e cada
  // linha carrega SO as chaves que estavam na proposta (mais o `id` que o duble
  // atribui). E por isso que `hasOwnProperty` abaixo responde a pergunta certa:
  // "a rota NOMEOU a coluna?", que e diferente de "o valor gravado foi `true`?".
  const [payload] = inserts[0].linhas;

  return { resposta, payload };
}

test("POST com `false` NOMEIA a coluna, e com o valor `false`", async () => {
  const { resposta, payload } = await criar({ valor: false });

  assert.equal(resposta.status, 201);
  assert.ok(
    Object.prototype.hasOwnProperty.call(payload, COLUNA),
    `o INSERT nao levou \`${COLUNA}\`: o lancamento nasce somando, e a escolha ` +
      "da pessoa foi descartada em silencio com 201."
  );
  // O VALOR, e nao so a presenca da chave: `include_in_total: true` tem a chave
  // no lugar certo e grava o oposto do pedido.
  assert.equal(payload[COLUNA], false);
});

test("POST SEM o campo nao nomeia a coluna -- a janela antes da colagem", async () => {
  const { resposta, payload } = await criar();

  assert.equal(resposta.status, 201);
  assert.equal(
    Object.prototype.hasOwnProperty.call(payload, COLUNA),
    false,
    `o INSERT nomeou \`${COLUNA}\` num corpo que nao o pediu. Contra um banco ` +
      "sem a 060 colada o PostgREST responde 42703 e esta rota cai em 500: " +
      "nenhum lancamento e criado pela API, nao so o que ia ficar fora dos " +
      "totais."
  );
});

test("POST com `true` tambem NAO nomeia a coluna -- omitir grava o DEFAULT", async () => {
  // `true` explicito e a omissao gravam o MESMO valor, porque `true` e o
  // DEFAULT da coluna. Nomea-la para gravar o que ja seria gravado paga o
  // 42703 da janela sem comprar nada.
  const { resposta, payload } = await criar({ valor: true });

  assert.equal(resposta.status, 201);
  assert.equal(
    Object.prototype.hasOwnProperty.call(payload, COLUNA),
    false,
    `\`${COLUNA}: true\` no corpo nomeou a coluna no INSERT. O valor gravado ` +
      "seria o mesmo do DEFAULT, e a rota passa a poder quebrar com 42703 por " +
      "nada."
  );
});

test("POST com a STRING `\"false\"` cai no DEFAULT, e nao tira dos totais", async () => {
  // O CONTROLE DO `=== false` ESTRITO, e ele mede a direcao SEGURA do erro.
  //
  // A string `"false"` nao e `false` estrito, entao a coluna nao vai no corpo e
  // a linha nasce somando -- o comportamento de antes da feature. Com
  // `!include_in_total` no lugar do `=== false`, este caso gravaria `false`; e
  // junto com ele gravaria `false` tambem para a chave AUSENTE (`undefined` e
  // falso), e TODO lancamento criado por um cliente que nao conhece o campo
  // nasceria fora dos relatorios, em silencio e com 201.
  //
  // Quem DESLIGA a partir de qualquer coisa que nao seja `true` e o PATCH, de
  // proposito: ali o pedido e sempre de uma pessoa que clicou, e o estado
  // desligado e VISIVEL na linha (o selo). Aqui o pedido pode vir de um
  // integrador que nunca ouviu falar da coluna.
  const { resposta, payload } = await criar({ valor: "false" });

  assert.equal(resposta.status, 201);
  assert.equal(
    Object.prototype.hasOwnProperty.call(payload, COLUNA),
    false,
    `a string "false" nomeou \`${COLUNA}\` no INSERT -- o teste do POST nao e ` +
      "`=== false` estrito, e a chave ausente vai tirar dos totais junto."
  );
});

test("POST de lancamento DE GRUPO pode nascer fora dos totais (decisao 6d)", async () => {
  // A ausencia de recusa e DECISAO, nao esquecimento: o flag vale so para o
  // relatorio PESSOAL -- o rateio, o acerto e o saldo do grupo ignoram a
  // coluna, porque a perna de grupo do custo pessoal sai de
  // `group_share_entries` (033), que nao passa por `category_monthly_totals`.
  // Recusar `group_id` aqui tiraria a escolha de quem tem grupo sem proteger
  // numero nenhum.
  const { resposta, payload } = await criar({ valor: false, group_id: GRUPO });

  assert.equal(resposta.status, 201);
  assert.equal(payload.group_id, GRUPO);
  assert.equal(
    payload[COLUNA],
    false,
    "o lancamento de grupo foi recusado ou perdeu o flag -- a secao 6d do " +
      "plano da HMO-443 decidiu o contrario."
  );
});

// ---------------------------------------------------------------------------
// O PATCH -- onde a string mente
// ---------------------------------------------------------------------------

/**
 * Chama o PATCH com um duble e devolve o PATCH que ele mandou para o banco.
 *
 * A linha semeada e uma RECEITA de ajuste de saldo, positiva e somando: e o
 * estado de onde a pessoa parte quando clica em "Não somar nos totais".
 */
async function alterar({ valor = SEM_CAMPO, jaEstaFora = false } = {}) {
  const sessao = criarDuble({
    user: { id: DONO },
    tabelas: {
      transaction_categories: [{ id: CATEGORIA, is_expense: false }],
      financial_transactions: [
        {
          id: LINHA,
          user_id: DONO,
          service_id: SERVICO,
          category_id: CATEGORIA,
          description: "Ajuste de saldo da conta investimento",
          amount: 250.5,
          transaction_type: "income",
          transaction_date: "2026-10-21",
          group_id: null,
          [COLUNA]: !jaEstaFora,
        },
      ],
      expense_splits: [],
    },
  });

  const registro = { sessao: () => sessao.client };
  globalThis.__dubleDeSupabase = registro;

  const corpo = {};
  if (valor !== SEM_CAMPO) corpo[COLUNA] = valor;

  let resposta;
  try {
    resposta = await ROTA_PATCH.PATCH(
      { json: async () => corpo },
      { params: { id: LINHA } }
    );
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  assert.ok(
    (registro.chamadasDeSessao ?? 0) > 0,
    "controle positivo: o PATCH nao abriu o client de SESSAO."
  );

  const updates = sessao.escritas.filter(
    (e) => e.verbo === "update" && e.tabela === "financial_transactions"
  );

  assert.equal(
    updates.length,
    1,
    `esperava UM update em financial_transactions, vieram ${updates.length}.`
  );

  return { resposta, patch: updates[0].patch };
}

test("PATCH com `false` grava `false`", async () => {
  const { resposta, patch } = await alterar({ valor: false });

  assert.equal(resposta.status ?? 200, 200);
  assert.equal(
    patch[COLUNA],
    false,
    "o PATCH nao tirou o lancamento dos totais: a pessoa clicou, a tela disse " +
      "pronto, e o total continua incluindo o ajuste."
  );
});

test("PATCH com a STRING `\"false\"` NAO grava `true`", async () => {
  // A ASSERCAO QUE PAGA ESTA SUITE INTEIRA.
  //
  // `Boolean("false") === true`. Com `Boolean(body.include_in_total)` no lugar
  // do `=== true`, este caso grava o OPOSTO do pedido: 200, corpo completo de
  // volta, e o lancamento RELIGADO nos totais. Nada na tela distingue "nao
  // consegui" de "liguei de volta", porque as duas imagens sao o total intacto.
  const { patch } = await alterar({ valor: "false" });

  assert.notEqual(
    patch[COLUNA],
    true,
    'a string "false" gravou `true` -- o teste do PATCH e `Boolean(...)`, e a ' +
      "rota esta gravando o OPOSTO do que o cliente pediu, com 200."
  );
  // E o valor, para o mutante que trocasse `=== true` por `=== false` (que
  // tambem nao grava `true` aqui, e grava o `true` errado no caso de baixo).
  assert.equal(patch[COLUNA], false);
});

test("PATCH com `true` grava `true` -- o caminho de volta existe", async () => {
  // Sem este caso o `=== true` poderia ser um `false` cravado e a suite ficaria
  // verde: a pessoa tiraria o lancamento dos totais e nunca o traria de volta.
  // E o estado de "ja esta fora" e o unico em que a tela oferece o inverso.
  const { patch } = await alterar({ valor: true, jaEstaFora: true });

  assert.equal(
    patch[COLUNA],
    true,
    "o PATCH nao devolveu o lancamento aos totais: a escolha e de via unica, e " +
      "quem desmarcou por engano nao tem caminho de volta pela tela."
  );
});

test("PATCH SEM o campo nao toca a coluna", async () => {
  // Editar a DESCRICAO de um lancamento marcado nao pode religa-lo, e editar um
  // lancamento comum nao pode tira-lo dos totais. O `!== undefined` e o que
  // separa os dois, e sem ele o default do `=== true` (`false`) cairia sobre
  // toda edicao: trocar uma virgula na descricao tiraria a linha de todos os
  // relatorios.
  const { patch } = await alterar();

  assert.equal(
    Object.prototype.hasOwnProperty.call(patch, COLUNA),
    false,
    `o PATCH escreveu \`${COLUNA}\` num corpo que nao o mandou -- toda edicao ` +
      "de descricao passa a mexer nos totais."
  );
  // O controle de que o update NAO esta vazio: a rota regrava `transaction_type`
  // sempre (HMO-181). Sem isto, um `patch` vazio tambem passaria a assercao
  // acima -- verde por nao ter medido nada.
  assert.equal(patch.transaction_type, "income");
});

// ---------------------------------------------------------------------------
// A ARMADILHA QUE DERRUBA AS DUAS ROTAS ANTES DA COLAGEM
// ---------------------------------------------------------------------------

test("nenhum `.select()` das duas rotas NOMEIA a coluna", () => {
  // O DEFEITO PLANTADO NO #335 E CONSERTADO NO #336, com a homonima da 058.
  //
  // O PostgREST responde `42703 column ... does not exist` a um `select` que
  // NOMEIA coluna ausente, e o handler cai em 500 -- a tela inteira para de
  // carregar antes de a 060 ser colada a mao. `select("*")` nao nomeia coluna
  // nenhuma: traz o campo quando existe e nao o traz quando nao existe.
  //
  // ANCORADO NOS ARGUMENTOS DOS `.select()`, E NAO NO ARQUIVO -- e e a unica
  // forma de este bloco valer alguma coisa. O nome da coluna aparece dezenas de
  // vezes nos COMENTARIOS das duas rotas (explicando precisamente esta
  // armadilha), entao uma varredura do fonte cru reprovaria sempre; e uma que
  // ignorasse comentarios leria a prosa como codigo no dia em que alguem
  // reescrevesse um deles. O que importa e o que esta DENTRO do `select(...)`.
  //
  // Este e o unico bloco TEXTUAL da suite de proposito: o resto mede payload.
  // Um `select` nomeando a coluna nao e observavel pelo duble -- ele projeta o
  // que tem e nao reclama de nome que nao existe, exatamente como o banco COM a
  // migration colada. O que esta suite nao alcanca e o banco SEM ela, e a
  // sonda por tras desta linha e a de producao: `select=include_in_total` pelo
  // PostgREST com a chave anon, contra um nome inventado como controle
  // negativo (42501 = a coluna existe e a RLS barrou; 42703 = nao existe).
  const fontes = [
    "app/api/personal-finance/transactions/route.ts",
    "app/api/personal-finance/transactions/[id]/route.ts",
  ];

  let medidos = 0;

  for (const caminho of fontes) {
    const fonte = readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

    // Os dois jeitos de escrever o argumento: string curta (`"*"`) e template
    // multilinha (o do embed). `[^)]*` nao serve -- o embed tem parenteses
    // dentro.
    const selects = [
      ...fonte.matchAll(/\.select\(\s*"([^"]*)"/g),
      ...fonte.matchAll(/\.select\(\s*`([^`]*)`/g),
    ].map((m) => m[1]);

    assert.ok(
      selects.length > 0,
      `nao achei nenhum \`.select(...)\` em ${caminho} -- o padrao deste bloco ` +
        "deixou de casar com o codigo, e ele estava passando sem medir nada."
    );

    medidos += selects.length;

    for (const argumento of selects) {
      assert.equal(
        argumento.includes(COLUNA),
        false,
        `${caminho} tem um \`.select()\` que NOMEIA \`${COLUNA}\`:\n\n` +
          `    ${argumento.trim().replace(/\s+/g, " ").slice(0, 160)}\n\n` +
          "Contra um banco sem a migration 060 colada o PostgREST responde " +
          "42703 e o handler cai em 500. Use `select(\"*\")` -- ele traz a " +
          "coluna quando ela existe e nao a nomeia quando nao existe."
      );
    }
  }

  // O controle de cobertura: as duas rotas juntas tem pelo menos os quatro
  // `select` que o codigo de hoje escreve. Um numero menor quer dizer que o
  // padrao parou de casar com metade deles.
  assert.ok(
    medidos >= 4,
    `so achei ${medidos} \`.select()\` nas duas rotas -- esperava 4 ou mais. ` +
      "O padrao esta cego para parte do arquivo."
  );
});
