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
// O check-table-drift.mjs le `.from("literal")`, entao NENHUMA das dezessete
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
  LIDO_DEPOIS_DE,
  confirmacaoValida,
  resetCompleto,
  totalApagado,
  totalMantido,
  motivoDaRecusa,
  apagarEmLotes,
  linhaFicaPelasRegras,
  exclusoesPorColuna,
  executarPlano,
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

/**
 * A coluna esta no CREATE TABLE da tabela, ou entrou depois por
 * `ALTER TABLE ... ADD COLUMN` (`group_closing_id` veio na 067,
 * `expense_split_id` na 070).
 */
function colunaDeclarada(tabela, coluna) {
  const bloco = blocoDaTabela(tabela);
  if (bloco && new RegExp(`\\b${coluna}\\b`).test(bloco)) return true;
  return new RegExp(
    `ALTER TABLE (?:IF EXISTS )?(?:public\\.)?${tabela}\\s+ADD COLUMN (?:IF NOT EXISTS )?${coluna}\\b`,
    "i"
  ).test(SQL);
}

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
// O que fica (24/10/2026): grupo, divisao com pessoa e MyBank
// ---------------------------------------------------------------------------

test("toda coluna de regra e de elo existe na tabela do passo", () => {
  // Uma regra sobre coluna inexistente vira `column does not exist` no DELETE
  // e derruba o passo; um elo sobre coluna inexistente nao exclui nada.
  for (const passo of PLANO_DE_RESET) {
    for (const regra of passo.ficam ?? []) {
      assert.ok(
        colunaDeclarada(passo.tabela, regra.coluna),
        `${passo.tabela}.${regra.coluna} (regra "${regra.motivo}") nao existe no schema`
      );
    }
    for (const elo of passo.elos ?? []) {
      assert.ok(
        colunaDeclarada(passo.tabela, elo.coluna),
        `${passo.tabela}.${elo.coluna} (elo "${elo.motivo}") nao existe no schema`
      );
    }
  }
});

test("a regra de prefixo tem prefixo, e ha no maximo uma por passo", () => {
  // A rota traduz `comeca_com` num `.or()`; dois na mesma URL nao sao um
  // contrato do PostgREST.
  for (const passo of PLANO_DE_RESET) {
    const prefixos = (passo.ficam ?? []).filter((r) => r.quando === "comeca_com");
    assert.ok(prefixos.length <= 1, `${passo.tabela} tem ${prefixos.length} regras de prefixo`);
    for (const r of prefixos) {
      assert.ok(r.prefixo && !/[%_,()]/.test(r.prefixo), `prefixo invalido em ${passo.tabela}`);
    }
  }
});

test("cada conjunto e lido depois dos passos de que depende", () => {
  // Lido antes, `contas_que_ficam` ve a conta de um lancamento pessoal que
  // ainda vai sair -- e a conta fica para sempre, com saldo de lancamento
  // nenhum.
  const posicao = new Map(PLANO_DE_RESET.map((p, i) => [p.tabela, i]));
  for (const [i, passo] of PLANO_DE_RESET.entries()) {
    for (const elo of passo.elos ?? []) {
      const dependencias = LIDO_DEPOIS_DE[elo.conjunto];
      assert.ok(dependencias, `${elo.conjunto} nao tem LIDO_DEPOIS_DE`);
      for (const tabela of dependencias) {
        assert.ok(posicao.has(tabela), `${elo.conjunto} depende de ${tabela}, fora do plano`);
        assert.ok(
          posicao.get(tabela) < i,
          `${passo.tabela} le ${elo.conjunto} antes do passo de ${tabela}`
        );
      }
    }
  }
});

test("toda trava de DELETE do schema e uma regra de fica do passo", () => {
  // Lido do schema, e nao da declaracao: a 068 e a 070 recusam apagar a conta
  // com `group_closing_id` e com `expense_split_id`, e UMA recusa derrubava o
  // passo inteiro. Uma trava nova sem a regra correspondente volta a isso.
  const re =
    /FUNCTION public\.(\w+?)_trava\w*\(\)[\s\S]*?IF TG_OP = 'DELETE' THEN\s*IF OLD\.(\w+) IS NOT NULL THEN\s*RAISE EXCEPTION/g;
  const travas = [...SQL.matchAll(re)].map((m) => ({ tabela: m[1], coluna: m[2] }));
  assert.ok(
    travas.some((t) => t.coluna === "group_closing_id") &&
      travas.some((t) => t.coluna === "expense_split_id"),
    "a leitura das travas nao achou as da 068 e da 070 -- o regex quebrou"
  );
  for (const trava of travas) {
    const passo = PLANO_DE_RESET.find((p) => p.tabela === trava.tabela);
    if (!passo) continue;
    assert.ok(
      (passo.ficam ?? []).some((r) => r.coluna === trava.coluna && r.quando === "preenchida"),
      `${trava.tabela}.${trava.coluna} tem trava de DELETE e nao e regra de fica`
    );
  }
});

test("a conta credora do MyBank segura a conta de banco", () => {
  // `lender_account_id` e ON DELETE RESTRICT (053): sem o elo, o DELETE das
  // contas morre inteiro em quem ja emprestou.
  assert.match(
    SQL,
    /lender_account_id\) REFERENCES public\.financial_accounts\(id\) ON DELETE RESTRICT/
  );
  const contas = PLANO_DE_RESET.find((p) => p.tabela === "financial_accounts");
  assert.ok((contas.elos ?? []).some((e) => e.conjunto === "contas_que_ficam"));
});

test("o que outra pessoa ve esta nas regras", () => {
  const regras = (tabela) =>
    (PLANO_DE_RESET.find((p) => p.tabela === tabela)?.ficam ?? []).map(
      (r) => `${r.coluna}:${r.quando}${r.prefixo ? `:${r.prefixo}` : ""}`
    );
  const elos = (tabela) =>
    (PLANO_DE_RESET.find((p) => p.tabela === tabela)?.elos ?? []).map((e) => e.conjunto);

  for (const tabela of ["financial_transactions", "scheduled_transactions", "recurring_rules", "budgets", "financial_goals"]) {
    assert.ok(regras(tabela).includes("group_id:preenchida"), `${tabela} sem a regra de grupo`);
  }
  assert.ok(regras("scheduled_transactions").includes("notes:comeca_com:mybank:"));
  assert.ok(regras("financial_transactions").includes("notes:comeca_com:mybank:"));
  assert.ok(regras("receipts").includes("settlement_id:preenchida"));
  assert.deepEqual(elos("financial_transactions").sort(), [
    "lancamentos_das_contas_que_ficam",
    "lancamentos_divididos",
  ]);
  assert.deepEqual(elos("goal_contributions"), ["metas_de_grupo"]);
});

test("a carteira de investimentos sai, as operacoes antes dos ativos", () => {
  const i = PLANO_DE_RESET.findIndex((p) => p.tabela === "investment_transactions");
  const a = PLANO_DE_RESET.findIndex((p) => p.tabela === "investment_assets");
  assert.ok(i >= 0 && a > i);
});

test("a regra le a linha como o filtro do banco", () => {
  const lancamentos = PLANO_DE_RESET.find((p) => p.tabela === "financial_transactions");
  const fica = (linha) => linhaFicaPelasRegras(lancamentos, linha);
  assert.equal(fica({ group_id: null, notes: null }), false, "notes nula sai");
  assert.equal(fica({ group_id: "g1", notes: null }), true);
  assert.equal(fica({ group_id: null, notes: "mybank:abc" }), true);
  // A chave e o comeco do texto, como o `LIKE 'mybank:%'`.
  assert.equal(fica({ group_id: null, notes: "paguei o mybank: 300" }), false);
  assert.equal(fica({ group_id: null, notes: "acerto:abc" }), false, "a perna de acerto sai");
});

test("as exclusoes por id juntam por coluna e tiram repeticao", () => {
  assert.deepEqual(
    exclusoesPorColuna([
      { coluna: "id", ids: ["a", "b"] },
      { coluna: "id", ids: ["b", "c", ""] },
      { coluna: "goal_id", ids: [] },
    ]),
    [{ coluna: "id", ids: ["a", "b", "c"] }]
  );
});

// ---------------------------------------------------------------------------
// O apagamento por lotes
// ---------------------------------------------------------------------------

const ids = (n) => Array.from({ length: n }, (_, i) => `t${i}`);

test("um lote recusado e partido ate a linha que o banco nao solta", async () => {
  const chamadas = [];
  const r = await apagarEmLotes(ids(250), async (lote) => {
    chamadas.push(lote.length);
    if (lote.includes("t137")) return { apagadas: null, erro: { code: "23503", message: "fk" } };
    return { apagadas: lote.length, erro: null };
  });
  assert.equal(r.apagadas, 249);
  assert.deepEqual(r.recusadas, [
    { id: "t137", motivo: "outro registro que ficou aponta para ele" },
  ]);
  assert.equal(r.esgotou, false);
  // 3 lotes + a bissecao de um lote de 100: bem abaixo de uma chamada por id.
  assert.ok(chamadas.length < 20, `${chamadas.length} chamadas`);
});

test("o banco que recusa tudo para na folga, e o resto volta como recusado", async () => {
  let chamadas = 0;
  const r = await apagarEmLotes(
    ids(300),
    async () => {
      chamadas += 1;
      return { apagadas: null, erro: { message: "permission denied" } };
    },
    { folga: 10 }
  );
  assert.equal(chamadas, 3 + 10);
  assert.equal(r.esgotou, true);
  assert.equal(r.apagadas, 0);
  // Nada some do relatorio: o que nao foi tentado conta como nao apagado.
  assert.equal(r.recusadas.length, 300);
});

test("o motivo da recusa", () => {
  assert.equal(motivoDaRecusa({ code: "23503", message: "x" }), "outro registro que ficou aponta para ele");
  assert.equal(motivoDaRecusa({ message: "Conta gerada pelo fechamento do grupo nao se apaga" }), "Conta gerada pelo fechamento do grupo nao se apaga");
  assert.equal(motivoDaRecusa(null), "o banco recusou sem dizer por quê");
});

// ---------------------------------------------------------------------------
// O plano inteiro, contra um banco de mentira
// ---------------------------------------------------------------------------
// O banco falso faz o que o Postgres faria com estas linhas: o DELETE de um
// comando so morre inteiro com uma recusa, a conta de banco com lancamento
// recusa sair (23503), e a trava da 068 recusa a conta do fechamento. Os
// conjuntos sao lidos das tabelas NO MOMENTO da chamada, como a rota le.

const EU = "u-eu";

function bancoFalso(tabelas, { falhaDeUmaVez = new Set(), conjuntoQueFalha = null } = {}) {
  const chamadas = [];
  const doDono = (passo) => (tabelas[passo.tabela] ?? []).filter((l) => l[passo.coluna] === EU);
  const recusa = (tabela, linha) => {
    if (tabela === "scheduled_transactions" && linha.group_closing_id) {
      return { code: "42501", message: "Conta gerada pelo fechamento do grupo nao se apaga" };
    }
    if (tabela === "financial_accounts") {
      const usada = ["financial_transactions", "scheduled_transactions", "recurring_rules"].some(
        (t) => (tabelas[t] ?? []).some((l) => l.account_id === linha.id)
      );
      if (usada) return { code: "23503", message: "violates foreign key constraint" };
    }
    return null;
  };
  const apagar = (passo, saem) => {
    for (const l of saem) {
      const erro = recusa(passo.tabela, l);
      if (erro) return { apagadas: null, erro };
    }
    tabelas[passo.tabela] = (tabelas[passo.tabela] ?? []).filter((l) => !saem.includes(l));
    return { apagadas: saem.length, erro: null };
  };
  const coluna = (tabela, col, filtro = () => true) =>
    (tabelas[tabela] ?? []).filter(filtro).map((l) => l[col]).filter(Boolean);

  return {
    chamadas,
    async apagarDeUmaVez(passo, exclusoes) {
      chamadas.push(`umaVez:${passo.tabela}`);
      if (falhaDeUmaVez.has(passo.tabela)) return { apagadas: null, erro: { message: "statement timeout" } };
      const saem = doDono(passo).filter(
        (l) => !linhaFicaPelasRegras(passo, l) && !exclusoes.some((e) => e.ids.includes(l[e.coluna]))
      );
      return apagar(passo, saem);
    },
    async lerLinhasQueSaem(passo) {
      chamadas.push(`ler:${passo.tabela}`);
      return { linhas: doDono(passo).filter((l) => !linhaFicaPelasRegras(passo, l)), erro: null };
    },
    async apagarIds(passo, lote) {
      return apagar(passo, doDono(passo).filter((l) => lote.includes(l.id)));
    },
    async contarRestantes(passo) {
      return doDono(passo).length;
    },
    async lerConjunto(conjunto) {
      chamadas.push(`conjunto:${conjunto}`);
      if (conjunto === conjuntoQueFalha) return { ids: null, erro: { message: "rede" } };
      switch (conjunto) {
        case "metas_de_grupo":
          return { ids: coluna("financial_goals", "id", (l) => l.group_id), erro: null };
        case "lancamentos_divididos":
          return { ids: coluna("expense_splits", "transaction_id"), erro: null };
        case "lancamentos_das_contas_que_ficam":
          return { ids: coluna("scheduled_transactions", "transaction_id", (l) => l.user_id === EU), erro: null };
        case "contas_que_ficam":
          return {
            ids: [
              ...coluna("financial_transactions", "account_id", (l) => l.user_id === EU),
              ...coluna("scheduled_transactions", "account_id", (l) => l.user_id === EU),
              ...coluna("recurring_rules", "account_id", (l) => l.user_id === EU),
              ...coluna("mybank_loans", "lender_account_id", (l) => l.lender_user_id === EU),
            ],
            erro: null,
          };
      }
      throw new Error(`conjunto desconhecido: ${conjunto}`);
    },
  };
}

/**
 * Uma conta como a da Leticia, mais o que o Helio tem: o pessoal que sai e o
 * que envolve outra pessoa, que fica.
 */
function contaDeQuemEstaNumGrupo() {
  return {
    financial_accounts: [
      { id: "conta-pessoal", user_id: EU },
      { id: "conta-do-grupo", user_id: EU },
      { id: "conta-credora", user_id: EU },
    ],
    financial_transactions: [
      { id: "mercado", user_id: EU, account_id: "conta-pessoal", group_id: null, notes: null },
      { id: "acerto", user_id: EU, account_id: "conta-pessoal", group_id: null, notes: "acerto:s1" },
      { id: "aluguel-do-grupo", user_id: EU, account_id: "conta-do-grupo", group_id: "casa", notes: null },
      { id: "pizza-dividida", user_id: EU, account_id: "conta-do-grupo", group_id: null, notes: null },
      { id: "paguei-a-lais", user_id: EU, account_id: "conta-do-grupo", group_id: null, notes: null },
      { id: "parcela-mybank", user_id: EU, account_id: "conta-credora", group_id: null, notes: "mybank:p1" },
      { id: "da-lais", user_id: "u-lais", account_id: "conta-da-lais", group_id: "casa", notes: null },
    ],
    expense_splits: [{ id: "d1", transaction_id: "pizza-dividida" }],
    scheduled_transactions: [
      { id: "luz", user_id: EU, account_id: "conta-pessoal", group_id: null, notes: null, transaction_id: null },
      { id: "luz-do-grupo", user_id: EU, account_id: "conta-do-grupo", group_id: "casa", notes: null, transaction_id: null },
      { id: "pagamento-ao-grupo", user_id: EU, account_id: null, group_id: null, group_closing_id: "f1", notes: null, transaction_id: null },
      { id: "pagamento-a-lais", user_id: EU, account_id: "conta-do-grupo", group_id: null, expense_split_id: "d2", notes: null, transaction_id: "paguei-a-lais" },
      { id: "parcela-prevista", user_id: EU, account_id: "conta-credora", group_id: null, notes: "mybank:p2", transaction_id: null },
    ],
    recurring_rules: [
      { id: "netflix", user_id: EU, account_id: "conta-pessoal", group_id: null },
    ],
    budgets: [
      { id: "b-pessoal", user_id: EU, group_id: null },
      { id: "b-casa", user_id: EU, group_id: "casa" },
    ],
    financial_goals: [
      { id: "viagem", user_id: EU, group_id: null },
      { id: "reforma", user_id: "u-lais", group_id: "casa" },
    ],
    goal_contributions: [
      { id: "aporte-viagem", user_id: EU, goal_id: "viagem" },
      { id: "aporte-reforma", user_id: EU, goal_id: "reforma" },
    ],
    receipts: [
      { id: "r-mercado", user_id: EU, transaction_id: "mercado", settlement_id: null },
      { id: "r-acerto", user_id: EU, transaction_id: null, settlement_id: "s1" },
    ],
    investment_assets: [{ id: "petr4", user_id: EU }],
    investment_transactions: [{ id: "compra", user_id: EU }],
    mybank_loans: [{ id: "emprestimo", lender_user_id: EU, lender_account_id: "conta-credora" }],
  };
}

const ids_ = (tabelas, tabela) => (tabelas[tabela] ?? []).map((l) => l.id).sort();

test("o plano apaga o pessoal e deixa o que envolve outra pessoa", async () => {
  const tabelas = contaDeQuemEstaNumGrupo();
  const passos = await executarPlano(bancoFalso(tabelas));

  assert.deepEqual(ids_(tabelas, "financial_transactions"), [
    "aluguel-do-grupo",
    "da-lais",
    "paguei-a-lais",
    "parcela-mybank",
    "pizza-dividida",
  ]);
  assert.deepEqual(ids_(tabelas, "scheduled_transactions"), [
    "luz-do-grupo",
    "pagamento-a-lais",
    "pagamento-ao-grupo",
    "parcela-prevista",
  ]);
  assert.deepEqual(ids_(tabelas, "financial_accounts"), ["conta-credora", "conta-do-grupo"]);
  assert.deepEqual(ids_(tabelas, "budgets"), ["b-casa"]);
  assert.deepEqual(ids_(tabelas, "financial_goals"), ["reforma"]);
  assert.deepEqual(ids_(tabelas, "goal_contributions"), ["aporte-reforma"]);
  assert.deepEqual(ids_(tabelas, "receipts"), ["r-acerto"]);
  assert.deepEqual(ids_(tabelas, "recurring_rules"), []);
  assert.deepEqual(ids_(tabelas, "investment_assets"), []);

  // Terminou inteiro: o que ficou e o plano, e nao uma falha.
  assert.equal(resetCompleto(passos), true);
  const lancamentos = passos.find((p) => p.tabela === "financial_transactions");
  assert.equal(lancamentos.apagadas, 2);
  assert.equal(lancamentos.mantidas, 4);
  assert.ok(lancamentos.motivos.includes("lançamento de grupo"));
  const contas = passos.find((p) => p.tabela === "financial_accounts");
  assert.equal(contas.apagadas, 1);
  assert.equal(contas.mantidas, 2);
  // contas 2, lancamentos 4, previstas 4, orcamento 1, aporte 1, comprovante 1.
  // A meta "reforma" fica, mas e da Lais: nao conta como minha.
  assert.equal(totalMantido(passos), 2 + 4 + 4 + 1 + 1 + 1);
});

test("o DELETE que morre inteiro e refeito por lotes, e so a linha recusada fica", async () => {
  // Uma conta do fechamento sem `group_closing_id` na regra (o plano de antes
  // de 24/10) derrubava o passo inteiro. Com a regra tirada de proposito, a
  // trava recusa uma linha so, e o resto do passo sai.
  const tabelas = contaDeQuemEstaNumGrupo();
  const plano = PLANO_DE_RESET.map((p) =>
    p.tabela === "scheduled_transactions"
      ? { ...p, ficam: p.ficam.filter((r) => r.coluna !== "group_closing_id") }
      : p
  );
  const passos = await executarPlano(bancoFalso(tabelas), plano);
  const previstas = passos.find((p) => p.tabela === "scheduled_transactions");
  assert.equal(previstas.apagadas, 1, "a luz pessoal saiu");
  assert.equal(previstas.recusadas, 1);
  assert.match(previstas.motivoDaRecusa, /fechamento do grupo/);
  assert.ok(ids_(tabelas, "scheduled_transactions").includes("pagamento-ao-grupo"));
  // A recusa tira o "pronto": nao era para ter acontecido.
  assert.equal(resetCompleto(passos), false);
});

test("sem o conjunto, o passo nao apaga nada", async () => {
  // Apagar os lancamentos sem saber quais pagam conta que fica reabriria
  // "Pagamento a Lais", ja paga.
  const tabelas = contaDeQuemEstaNumGrupo();
  const passos = await executarPlano(
    bancoFalso(tabelas, { conjuntoQueFalha: "lancamentos_das_contas_que_ficam" })
  );
  const lancamentos = passos.find((p) => p.tabela === "financial_transactions");
  assert.equal(lancamentos.apagadas, null);
  assert.match(lancamentos.erro, /não consegui ler o que fica/);
  assert.ok(ids_(tabelas, "financial_transactions").includes("mercado"));
  assert.equal(resetCompleto(passos), false);
});

test("a falha do DELETE de uma vez cai nos lotes com as mesmas exclusoes", async () => {
  const tabelas = contaDeQuemEstaNumGrupo();
  const banco = bancoFalso(tabelas, { falhaDeUmaVez: new Set(["financial_transactions"]) });
  const passos = await executarPlano(banco);
  assert.ok(banco.chamadas.includes("ler:financial_transactions"));
  assert.deepEqual(ids_(tabelas, "financial_transactions"), [
    "aluguel-do-grupo",
    "da-lais",
    "paguei-a-lais",
    "parcela-mybank",
    "pizza-dividida",
  ]);
  assert.equal(resetCompleto(passos), true);
});

test("sobra num passo sem regra e erro, e nao 'pronto'", async () => {
  // O DELETE que a RLS filtra devolve zero e sem erro. A contagem do que
  // sobrou e o que denuncia.
  const tabelas = contaDeQuemEstaNumGrupo();
  const banco = bancoFalso(tabelas);
  const apagarDeUmaVez = banco.apagarDeUmaVez;
  banco.apagarDeUmaVez = async (passo, exclusoes) =>
    passo.tabela === "investment_assets"
      ? { apagadas: 0, erro: null }
      : apagarDeUmaVez(passo, exclusoes);
  const passos = await executarPlano(banco);
  const ativos = passos.find((p) => p.tabela === "investment_assets");
  assert.match(ativos.erro, /1 linha não saiu/);
  assert.equal(resetCompleto(passos), false);
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

test("o que ficou de proposito nao tira o 'pronto', a recusa tira", () => {
  assert.equal(
    resetCompleto([{ tabela: "a", rotulo: "A", apagadas: 3, mantidas: 2, motivos: ["x"] }]),
    true
  );
  assert.equal(
    resetCompleto([{ tabela: "a", rotulo: "A", apagadas: 3, recusadas: 1, motivoDaRecusa: "x" }]),
    false
  );
  assert.equal(totalMantido([{ apagadas: 1, mantidas: 2 }, { apagadas: null }]), 2);
});
