#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DO "APAGAR TUDO E COMECAR DO ZERO"
// =====================================================
//   npm run test:account-reset
//
// Exercita lib/account-reset.ts (HMO-159) e confronta o plano de apagamento
// com o SCHEMA VERSIONADO em database/migrations.
//
// -----------------------------------------------------------------------
// Por que este teste le as migrations
// -----------------------------------------------------------------------
// A rota apaga com `.from(etapa.tabela)` -- nome de tabela vindo de variavel.
// O check-table-drift.mjs le `.from("literal")`, entao NENHUMA das dezesseis
// tabelas deste plano esta coberta por ele. Sem este arquivo, um nome de
// tabela errado no plano passaria pelo tsc, pelo next build e pelo CI inteiro,
// e apareceria como um passo "falhou" na tela de quem clicou no botao -- com
// parte da conta ja apagada.
//
// -----------------------------------------------------------------------
// Os tres modos de falha que ele existe para pegar
// -----------------------------------------------------------------------
// 1. ORDEM ERRADA. `financial_transactions.account_id` referencia
//    `financial_accounts` SEM `ON DELETE` nenhum -- NO ACTION. Apagar as
//    contas antes dos lancamentos levanta erro no meio do caminho, e como nao
//    ha transacao atravessando as chamadas (PostgREST comita cada DELETE), a
//    conta fica num estado que nao e nem o antigo nem o novo.
//
// 2. FALTA DE POLICY DE DELETE -- e esta e a pior, porque e MUDA. A rota apaga
//    com a sessao do usuario, de proposito (um `user_id` errado com a chave de
//    servico apagaria dado de outra pessoa). Mas RLS ligada sem policy de
//    DELETE nao devolve erro: devolve ZERO LINHAS apagadas, em silencio. O
//    passo voltaria "0" e a tela escreveria "pronto, a conta esta como nova"
//    com o dado todo no lugar. E o mesmo modo de falha que a 019 documenta
//    para a leitura de auditoria, e que ja custou semanas neste projeto.
//
// 3. TABELA QUE NAO EXISTE NO SCHEMA. Nome trocado, tabela renomeada por outra
//    migration, plural esquecido.
//
// Os cabecalhos de lib/account-reset.ts explicam o desenho; aqui esta a prova
// de que o desenho continua valido depois de cada migration nova.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const {
  PLANO_DE_RESET,
  FRASE_DE_CONFIRMACAO,
  confirmacaoValida,
  resetCompleto,
  totalApagado,
} = await import("../.tmp-account-reset/account-reset.js");

const DIR = "database/migrations";

/**
 * As migrations concatenadas, SEM comentario de linha.
 *
 * Tirar os `--` nao e cosmetico: estes arquivos discutem policies e chaves
 * estrangeiras em prosa, e um `CREATE POLICY` citado dentro de um comentario
 * faria este teste dar verde por uma policy que nao existe -- exatamente o
 * falso positivo que ele foi escrito para impedir.
 */
const SQL = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(`${DIR}/${f}`, "utf8"))
  .join("\n")
  .split("\n")
  .map((linha) => linha.replace(/--.*$/, ""))
  .join("\n");

/** Controle negativo da limpeza acima: o corte de comentario funcionou? */
test("a leitura das migrations descarta comentario", () => {
  assert.ok(
    !SQL.includes("PULODOGATO"),
    "o titulo dos arquivos vive em comentario e nao deveria sobrar no SQL lido"
  );
  assert.ok(
    SQL.includes("CREATE TABLE"),
    "sobrou SQL executavel para analisar"
  );
});

/** O bloco `CREATE TABLE ... (...)` de uma tabela, ou null. */
function blocoDaTabela(tabela) {
  const re = new RegExp(
    `CREATE TABLE (?:IF NOT EXISTS )?(?:public\\.)?${tabela}\\s*\\(([\\s\\S]*?)\\n\\s*\\);`,
    "i"
  );
  return SQL.match(re)?.[1] ?? null;
}

/** As policies declaradas sobre uma tabela, cada uma como um texto. */
function policiesDaTabela(tabela) {
  const re = new RegExp(
    `CREATE POLICY\\s+\\S+\\s+ON\\s+(?:public\\.)?${tabela}\\b([\\s\\S]*?);`,
    "gi"
  );
  return [...SQL.matchAll(re)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// O plano contra o schema
// ---------------------------------------------------------------------------

test("o plano nao repete tabela", () => {
  // Uma tabela duas vezes no plano produz um segundo passo que sempre apaga
  // zero linhas -- e um relatorio dizendo "Lancamentos: 0" logo abaixo de
  // "Lancamentos: 412".
  const tabelas = PLANO_DE_RESET.map((p) => p.tabela);
  assert.equal(new Set(tabelas).size, tabelas.length);
});

test("toda tabela do plano existe no schema versionado", () => {
  for (const passo of PLANO_DE_RESET) {
    assert.ok(
      blocoDaTabela(passo.tabela),
      `${passo.tabela} nao tem CREATE TABLE em ${DIR}`
    );
  }
});

test("toda tabela do plano tem a coluna de dono declarada", () => {
  for (const passo of PLANO_DE_RESET) {
    const bloco = blocoDaTabela(passo.tabela);
    assert.ok(
      new RegExp(`\\b${passo.coluna}\\b`).test(bloco),
      `${passo.tabela} nao declara a coluna ${passo.coluna}`
    );
  }
});

test("toda tabela do plano deixa o dono APAGAR as proprias linhas", () => {
  // O modo de falha 2 do cabecalho. Sem uma destas policies, o DELETE volta
  // com zero linhas e SEM erro, e o reset mente.
  for (const passo of PLANO_DE_RESET) {
    const policies = policiesDaTabela(passo.tabela);
    assert.ok(
      policies.length > 0,
      `${passo.tabela} nao tem policy nenhuma -- com RLS ligada, o DELETE apaga zero linhas em silencio`
    );

    const permiteApagar = policies.some(
      (p) =>
        /FOR\s+(DELETE|ALL)\b/i.test(p) &&
        /TO\s+[^;]*\bauthenticated\b/i.test(p)
    );
    assert.ok(
      permiteApagar,
      `${passo.tabela} nao tem policy de DELETE (nem FOR ALL) para authenticated`
    );
  }
});

test("os filhos vem antes dos pais", () => {
  // O modo de falha 1. `apontaPara` lista as tabelas DESTE plano que o passo
  // referencia sem cascata; todas tem que ser apagadas depois dele.
  const posicao = new Map(PLANO_DE_RESET.map((passo, i) => [passo.tabela, i]));

  for (const [i, passo] of PLANO_DE_RESET.entries()) {
    for (const referida of passo.apontaPara) {
      assert.ok(
        posicao.has(referida),
        `${passo.tabela} aponta para ${referida}, que nao esta no plano`
      );
      assert.ok(
        posicao.get(referida) > i,
        `${passo.tabela} (posicao ${i}) tem que ser apagada ANTES de ${referida} (posicao ${posicao.get(
          referida
        )})`
      );
    }
  }
});

test("a dependencia declarada e a que o schema tem, para o caso que fixa a ordem", () => {
  // Controle da declaracao: `apontaPara` e escrito a mao, e uma lista vazia
  // faria o teste acima passar verde sem conferir nada. Este caso e o que
  // custa caro se estiver errado, e ele e lido do schema, nao da declaracao.
  assert.match(
    SQL,
    /financial_transactions[\s\S]{0,400}?FOREIGN KEY \(account_id\) REFERENCES (?:public\.)?financial_accounts\(id\);/,
    "o FK de financial_transactions para financial_accounts deixou de ser NO ACTION -- reveja a ordem do plano"
  );

  const lancamentos = PLANO_DE_RESET.find(
    (p) => p.tabela === "financial_transactions"
  );
  assert.ok(lancamentos, "financial_transactions saiu do plano");
  assert.ok(
    lancamentos.apontaPara.includes("financial_accounts"),
    "a dependencia que fixa a ordem deixou de estar declarada"
  );
});

test("as contas e os cartoes sao o ultimo passo do dinheiro", () => {
  // Quatro tabelas do plano referenciam financial_accounts sem cascata. Se ela
  // subir na lista, o reset quebra no meio.
  const indiceContas = PLANO_DE_RESET.findIndex(
    (p) => p.tabela === "financial_accounts"
  );
  for (const passo of PLANO_DE_RESET) {
    if (passo.apontaPara.includes("financial_accounts")) {
      assert.ok(
        PLANO_DE_RESET.indexOf(passo) < indiceContas,
        `${passo.tabela} tem que vir antes de financial_accounts`
      );
    }
  }
});

test("o plano nao toca em grupo de despesa nem no perfil", () => {
  // Grupo tem outras pessoas dentro, e o perfil carrega a assinatura (ela nasce
  // de um trigger AFTER INSERT ON profiles). Apagar qualquer um dos dois a
  // partir deste botao destruiria dado que nao e so de quem clicou.
  const proibidas = [
    "expense_groups",
    "group_members",
    "group_transactions",
    "group_settlements",
    "group_expense_splits",
    "group_invitations",
    "group_member_proportions",
    "profiles",
    "user_subscriptions",
    "user_balances",
  ];

  for (const passo of PLANO_DE_RESET) {
    assert.ok(
      !proibidas.includes(passo.tabela),
      `${passo.tabela} nao pode estar no plano de reset`
    );
  }
});

// ---------------------------------------------------------------------------
// A frase de confirmacao
// ---------------------------------------------------------------------------

test("a frase exata confirma", () => {
  assert.equal(confirmacaoValida(FRASE_DE_CONFIRMACAO), true);
});

test("caixa e espaco nas pontas nao reprovam", () => {
  // Teclado de celular capitaliza sozinho. Reprovar "Apagar tudo" nao aumenta
  // seguranca nenhuma -- so ensina a pessoa a copiar e colar, que e o oposto
  // do atrito que a frase existe para criar.
  for (const entrada of [
    "apagar tudo",
    "Apagar Tudo",
    "  APAGAR TUDO  ",
    "\tapagar TUDO\n",
  ]) {
    assert.equal(
      confirmacaoValida(entrada),
      true,
      `deveria aceitar ${JSON.stringify(entrada)}`
    );
  }
});

test("qualquer outra coisa nao confirma", () => {
  // O `""` e o caso que importa: um corpo sem `confirmacao` chega aqui como
  // undefined, e uma comparacao frouxa deixaria o botao apagar a conta a
  // partir de um POST vazio.
  for (const entrada of [
    "",
    "   ",
    "apagar",
    "apagar tudo agora",
    "APAGARTUDO",
    "delete everything",
    undefined,
    null,
    true,
    1,
    {},
    [FRASE_DE_CONFIRMACAO],
  ]) {
    assert.equal(
      confirmacaoValida(entrada),
      false,
      `nao deveria aceitar ${JSON.stringify(entrada) ?? "undefined"}`
    );
  }
});

// ---------------------------------------------------------------------------
// A leitura do relatorio
// ---------------------------------------------------------------------------

test("um passo que falhou impede o 'pronto'", () => {
  const passos = [
    { tabela: "a", rotulo: "A", apagadas: 3 },
    { tabela: "b", rotulo: "B", apagadas: null, erro: "permission denied" },
  ];
  assert.equal(resetCompleto(passos), false);
  // E o total ignora o passo que falhou em vez de virar NaN -- um NaN na tela
  // e indistinguivel de bug de renderizacao.
  assert.equal(totalApagado(passos), 3);
});

test("zero linhas apagadas nao e falha", () => {
  // Conta nova, ou segundo clique depois de um reset parcial. Confundir "nao
  // tinha nada" com "nao consegui apagar" faria a tela dizer que falhou
  // justamente quando esta tudo certo.
  const passos = [{ tabela: "a", rotulo: "A", apagadas: 0 }];
  assert.equal(resetCompleto(passos), true);
  assert.equal(totalApagado(passos), 0);
});

test("relatorio vazio nao conta como sucesso", () => {
  // Nenhum passo executado quer dizer que o laco nao rodou -- nao que a conta
  // ja estava limpa.
  assert.equal(resetCompleto([]), false);
});
