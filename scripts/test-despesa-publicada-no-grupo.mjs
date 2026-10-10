#!/usr/bin/env node
// =====================================================
// PULODOGATO - "Despesa adicionada com sucesso!" sobre uma despesa que o grupo
//              nao ve (HMO-356)
// =====================================================
//   npm run test:despesa-publicada-no-grupo
//
// O QUE A ROTA NAO SABIA DIZER
// ----------------------------
// Na divisao COMBINADA (70/30, por percentual, por valor), a despesa nasce SEM
// `group_id` de proposito -- com a coluna preenchida no INSERT, o trigger
// `auto_create_group_transaction` ja cria o rateio IGUAL antes de a rota falar,
// e reescrever por cima exigiria apagar as partes iguais, o que so admin pode.
// Entao a rota cria a ligacao e as partes primeiro, e so no fim preenche a
// coluna:
//
//     .update({ group_id: groupId }).eq("id", transaction.id)
//
// Esse UPDATE era cru, e `if (erroGrupo)` era o unico criterio. Escrita que a
// policy nao alcanca volta SUCESSO COM ZERO LINHA -- a RLS filtra em vez de
// recusar --, e sem `.select()` o supabase-js nao entrega contagem: `data` e
// `error` vem os dois nulos. Medido em producao em 2026-09-30 na rota de
// restaurar grupo (HMO-203); aqui a consequencia e pior que um 200 mentiroso,
// porque a policy de SELECT de `financial_transactions` e
//
//     user_id = auth.uid() OR (group_id IS NOT NULL AND is_group_member(group_id))
//
// e sem `group_id` a despesa fica visivel SO para quem lancou. O grupo divide
// uma conta que metade dele nao enxerga, `group_member_balances` passa a
// discordar de pessoa para pessoa, e a tela de quem lancou disse "Despesa
// adicionada com sucesso!".
//
// A ISSUE DESCREVIA UM LACO QUE NAO EXISTE, E ISSO MUDA O CRITERIO
// ---------------------------------------------------------------
// A HMO-356 foi aberta dizendo que as duas escritas rodam "dentro de laco sobre
// varios lancamentos", e por isso pedia uma decisao de produto: parar no
// primeiro, reportar `{ movidos, ignorados }`, ou recusar o lote. Nao ha laco.
// `.eq("id", transaction.id)` e chave primaria, de uma linha que esta rota
// acabou de inserir, e o POST grava UMA despesa (a tela chama um `fetch` por
// despesa e mostra um toast por resposta). Nao existe "movi N de M" para
// reportar e nenhum contrato de tela para mudar: zero linha e falha, e
// `desfazer` ja sabe o que fazer com ela. E por isso que esta suite afirma
// `success !== true` e nao uma contagem parcial.
//
// POR QUE UMA SONDA DE ROTA, E NAO UM GUARD DE TEXTO
// -------------------------------------------------
// `npm run test:escrita-conferida` ja prova que `conferirEscrita` separa os
// tres modos de falhar. O que ela nao alcanca e se ESTA rota consulta o
// criterio. E um guard textual e pior que inutil aqui: depois da HMO-356 o
// arquivo tem DUAS chamadas de `conferirEscrita` com proposito OPOSTO -- a do
// UPDATE muda a resposta, a do `delete` de compensacao nunca pode mudar --,
// entao `includes("conferirEscrita")` fica verde matando justamente a que
// importa. So chamar o handler e olhar o corpo distingue as duas.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import { criarDuble } from "./duble-de-supabase.mjs";

const ROTA = await import(
  "../.tmp-despesa-publicada-no-grupo/app/api/expense-groups/[groupId]/transactions/route.js"
);

const GRUPO = "grupo-1";
const DONO = "dono-1";
const MEMBRO_DONO = "membro-dono";
const MEMBRO_OUTRO = "membro-outro";
const SERVICO = "servico-financas";
const CATEGORIA = "cat-restaurante";
/** Uma despesa pessoal do mesmo dono, de grupo nenhum. Ver o fixture. */
const VIZINHA = "despesa-pessoal-vizinha";

/**
 * Chama o POST com um duble e devolve `{ status, corpo, sessao, registro }`.
 *
 * `rlsFiltra` e o unico botao que interessa: ele faz a ESCRITA na tabela citada
 * alcancar zero linhas sem erro -- a resposta que a policy da quando nao casa
 * com a linha. Ver o cabecalho de scripts/duble-de-supabase.mjs.
 */
async function lancarDespesa({ rlsFiltra = {}, corpo: sobrescrito = {} } = {}) {
  const sessao = criarDuble({
    user: { id: DONO },
    rlsFiltra,
    tabelas: {
      group_members: [
        {
          id: MEMBRO_DONO,
          group_id: GRUPO,
          user_id: DONO,
          status: "active",
        },
      ],
      transaction_categories: [
        {
          id: CATEGORIA,
          service_id: SERVICO,
          is_expense: true,
          is_active: true,
        },
      ],
      expense_groups: [{ id: GRUPO, currency: "BRL" }],
      // Declarada com a despesa VIZINHA dentro, e as duas metades decidem algo.
      //
      // Declarar (em vez de omitir): o duble so acumula o que foi inserido em
      // tabela que a sonda citou (ver o `linhas.push` do `insert`). Sem a chave,
      // cada `from()` fabrica um array novo, a linha recem-inserida nao existe
      // para o UPDATE seguinte, e ele alcancaria zero linhas POR CONSTRUCAO --
      // o controle positivo falharia por defeito da sonda e o caso negativo
      // passaria por motivo errado.
      //
      // A VIZINHA e o que da medida ao `.eq("id", ...)`, e ela foi acrescentada
      // porque sem ela o mutante que APAGA o `.eq` sobrevivia: com uma linha so
      // na tabela, "esta despesa" e "todas as despesas" sao o mesmo conjunto, e
      // nenhuma assercao as distingue. Ela e uma despesa PESSOAL do mesmo dono,
      // de grupo nenhum -- exatamente a linha que um UPDATE sem filtro
      // arrastaria para dentro do grupo, publicando para os outros membros uma
      // conta que nao e deles.
      financial_transactions: [
        {
          id: VIZINHA,
          user_id: DONO,
          group_id: null,
          description: "Farmacia (pessoal, fora do grupo)",
          amount: -50,
        },
      ],
      group_transactions: [],
      group_expense_splits: [],
    },
  });

  const registro = { sessao: () => sessao.client };
  globalThis.__dubleDeSupabase = registro;

  const corpoDoPedido = {
    description: "Jantar da viagem",
    amount: 200,
    transaction_date: "2026-10-09",
    notes: null,
    currency: "BRL",
    exchange_rate: 1,
    split_type: "percentage",
    custom_splits: [
      { member_id: MEMBRO_DONO, percentage: 70, amount: 140 },
      { member_id: MEMBRO_OUTRO, percentage: 30, amount: 60 },
    ],
    ...sobrescrito,
  };

  let resposta;
  try {
    resposta = await ROTA.POST({ json: async () => corpoDoPedido }, {
      params: { groupId: GRUPO },
    });
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  return {
    status: resposta.status,
    corpo: await resposta.json(),
    sessao,
    registro,
  };
}

test("CONTROLE POSITIVO: a divisao combinada grava e a rota responde sucesso", async () => {
  const { status, corpo, sessao, registro } = await lancarDespesa();

  // Sem este par, todo o resto passa por vacuidade: uma rota que trocasse o
  // jeito de obter o client deixaria o duble intocado, e um 500 de duble
  // incompleto se leria como o 500 da feature.
  assert.ok(
    (registro.chamadasDeSessao ?? 0) > 0,
    "controle positivo: a rota nao abriu o client de SESSAO -- o que foi medido abaixo nao veio dela."
  );
  assert.equal(
    status,
    200,
    `controle positivo: a divisao 70/30 tinha de gravar. Corpo: ${JSON.stringify(corpo)}`
  );
  assert.equal(corpo.success, true);

  // A ordem de escrita e load-bearing (ver o INSERT da rota): a despesa nasce
  // SEM grupo, e o `group_id` entra depois que as partes combinadas estao
  // gravadas. Se ela nascesse com a coluna, o trigger rateava igual e o 70/30
  // viraria 50/50 sem nenhum erro aparecer.
  const insercaoDaDespesa = sessao.escritas.find(
    (e) => e.verbo === "insert" && e.tabela === "financial_transactions"
  );
  assert.equal(
    insercaoDaDespesa.linhas[0].group_id,
    null,
    "a despesa combinada tem de nascer SEM group_id -- com a coluna preenchida o trigger rateia igual antes da rota falar."
  );

  const publicacao = sessao.escritas.find(
    (e) => e.verbo === "update" && e.tabela === "financial_transactions"
  );
  assert.ok(publicacao, "o `group_id` nunca foi publicado.");
  assert.equal(publicacao.patch.group_id, GRUPO);
  assert.equal(
    publicacao.linhasAfetadas,
    1,
    "o UPDATE tinha de alcancar UMA linha -- a despesa recem-inserida, e so ela."
  );

  // O `.eq("id", ...)` medido pelo efeito, e nao pela presenca. Sem o filtro, o
  // UPDATE publica `group_id` em toda despesa que a policy alcanca: a farmacia
  // pessoal do dono entraria no grupo e viraria conta a dividir, visivel para
  // os outros membros pela policy de SELECT. Uma assercao sobre `filtros` diria
  // que o `.eq` esta escrito; esta diz que ele RECORTA.
  const vizinha = sessao.client
    .from("financial_transactions")
    .select("id, group_id");
  const { data: todas } = await vizinha;
  const aindaPessoal = todas.find((l) => l.id === VIZINHA);

  assert.equal(
    aindaPessoal.group_id,
    null,
    "o UPDATE arrastou a despesa PESSOAL para dentro do grupo -- o `.eq(\"id\")` " +
      "nao esta recortando, e uma conta que nao e do grupo passou a ser dividida."
  );
});

test("A RLS FILTRA O UPDATE: a rota NAO pode responder sucesso", async () => {
  const { status, corpo, sessao } = await lancarDespesa({
    rlsFiltra: { financial_transactions: true },
  });

  // ESTA e a assercao da issue. Antes da HMO-356 a rota respondia
  // 200 {"success":true} aqui, e a tela dizia "Despesa adicionada com
  // sucesso!" sobre uma despesa que nenhum outro membro do grupo consegue ler.
  assert.notEqual(
    corpo.success,
    true,
    "a rota respondeu SUCESSO com o `group_id` nao publicado: a despesa fica " +
      "invisivel para os outros membros (policy de SELECT de " +
      "financial_transactions) e o grupo divide uma conta que nao ve."
  );
  assert.equal(status, 500);
  assert.match(String(corpo.error), /publicar a despesa no grupo/i);

  // A escrita foi TENTADA e voltou zero -- e nao "a rota parou antes". Sem esta
  // linha o teste acima ficaria verde tambem se a rota desistisse por outro
  // motivo qualquer, e a sonda mediria o caminho errado.
  const publicacao = sessao.escritas.find(
    (e) => e.verbo === "update" && e.tabela === "financial_transactions"
  );
  assert.ok(publicacao, "o UPDATE nem foi tentado -- a rota falhou antes.");
  assert.equal(publicacao.linhasAfetadas, 0);
});

test("o `.select()` do UPDATE existe: sem ele nao ha contagem para conferir", async () => {
  const { sessao } = await lancarDespesa();

  // O duble devolve `{ data: null }` para escrita SEM `.select()`, como o client
  // de verdade -- e `conferirEscrita` chama isso de `sem-select`, um modo de
  // falhar separado de `nenhuma-linha` de proposito (lib/escrita-conferida.ts).
  //
  // Esta assercao e o que impede o conserto de regredir pela porta lateral: dar
  // `conferirEscrita` a uma chamada sem `.select()` deixa a rota com a aparencia
  // de conferida e o comportamento de antes -- ela passaria a responder 500 em
  // TODA despesa combinada, inclusive nas que gravaram. O caso positivo acima
  // pegaria isso; esta linha diz POR QUE.
  const publicacao = sessao.escritas.find(
    (e) => e.verbo === "update" && e.tabela === "financial_transactions"
  );
  assert.equal(
    publicacao.linhasAfetadas,
    1,
    "o UPDATE precisa de `.select()` para que exista contagem de linhas afetadas."
  );
});

test("A COMPENSACAO NAO MUDA O MOTIVO DA FALHA, mesmo apagando zero linhas", async () => {
  // A assimetria deliberada da HMO-356. Aqui a ligacao de grupo falha (erro de
  // verdade), a rota chama `desfazer`, e o `delete` de compensacao e barrado
  // pela mesma policy -- zero linha.
  //
  // A resposta tem de continuar dizendo o erro ORIGINAL ("ligar a despesa ao
  // grupo"). Exigir conferencia do `delete` de compensacao trocaria essa frase
  // por "a compensacao nao pegou nada" e apagaria o unico sinal que diz o que
  // consertar -- e o mesmo recorte que a HMO-356 reafirma para os dois `delete`
  // de settlements.
  const sessao = criarDuble({
    user: { id: DONO },
    rlsFiltra: { financial_transactions: true },
    erros: { group_transactions: { message: "policy recusou a ligacao" } },
    tabelas: {
      group_members: [
        { id: MEMBRO_DONO, group_id: GRUPO, user_id: DONO, status: "active" },
      ],
      transaction_categories: [
        { id: CATEGORIA, service_id: SERVICO, is_expense: true, is_active: true },
      ],
      expense_groups: [{ id: GRUPO, currency: "BRL" }],
      financial_transactions: [],
    },
  });

  const registro = { sessao: () => sessao.client };
  globalThis.__dubleDeSupabase = registro;

  let resposta;
  try {
    resposta = await ROTA.POST(
      {
        json: async () => ({
          description: "Jantar da viagem",
          amount: 200,
          transaction_date: "2026-10-09",
          currency: "BRL",
          exchange_rate: 1,
          split_type: "percentage",
          custom_splits: [
            { member_id: MEMBRO_DONO, percentage: 70, amount: 140 },
            { member_id: MEMBRO_OUTRO, percentage: 30, amount: 60 },
          ],
        }),
      },
      { params: { groupId: GRUPO } }
    );
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  const corpo = await resposta.json();

  assert.equal(resposta.status, 500);
  assert.match(
    String(corpo.error),
    /ligar a despesa ao grupo/i,
    "a resposta trocou o erro original pelo da compensacao: quem le o log " +
      "perde a unica frase que diz o que consertar."
  );

  const compensacao = sessao.escritas.find((e) => e.verbo === "delete");
  assert.ok(
    compensacao,
    "`desfazer` nao tentou apagar a despesa -- o lancamento fica orfao."
  );
  assert.equal(compensacao.tabela, "financial_transactions");
  assert.equal(
    compensacao.linhasAfetadas,
    0,
    "a compensacao foi barrada (e o caso deste teste): a despesa ficou orfa, e " +
      "a resposta continua reportando o erro original."
  );
});

test("DIVISAO IGUAL nao passa pelo UPDATE: nada a conferir, e isso e proposital", async () => {
  // Na divisao igual a despesa nasce JA com `group_id` e o trigger cria a
  // ligacao e o rateio. A rota so LE o que o banco fez -- inserir de novo
  // criaria uma segunda ligacao e cobraria o dobro, sem erro. Entao o UPDATE
  // conferido nao existe neste ramo, e um conserto que o colocasse em TODA
  // despesa quebraria justamente o caminho mais comum.
  const { status, corpo, sessao } = await lancarDespesa({
    corpo: { split_type: "equal", custom_splits: undefined },
  });

  assert.equal(
    status,
    200,
    `a divisao igual tinha de gravar. Corpo: ${JSON.stringify(corpo)}`
  );
  assert.equal(corpo.success, true);
  assert.equal(
    sessao.escritas.filter((e) => e.verbo === "update").length,
    0,
    "a divisao igual nao deve publicar `group_id` por UPDATE -- a coluna ja vai no INSERT."
  );
});
