#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DA VARREDURA DE RECORRENCIAS
// =====================================================
//   npm run test:recurrence-scan
//
// Exercita lib/services/recurrence-scan.ts -- a funcao que os TRES gatilhos da
// varredura compartilham (botao da tela, importacao de extrato, cron diario).
//
// O que se prova aqui nao e a deteccao (isso e o test:recurrence-detector), e
// sim a CONVERSA COM O BANCO: o que a varredura le, o que ela grava e, acima de
// tudo, o que ela NAO grava. Os tres erros cobertos abaixo sao silenciosos --
// todos produzem uma tela plausivel em vez de um erro.
//
// O cliente do Supabase e dublado. Nao e preguica de subir banco: o db-verify
// ja prova as constraints da 011 em Postgres de verdade, e o que falta provar e
// codigo TypeScript que nenhum SQL alcanca.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const { varrerRecorrencias, janelaPedida, JANELA_PADRAO_MESES, MAX_TRANSACOES } =
  await import("../.tmp-recurrence-scan/services/recurrence-scan.js");

// ---------------------------------------------------------------------------
// Duble do cliente do Supabase
// ---------------------------------------------------------------------------
// O builder do supabase-js e "thenable": cada filtro devolve ele mesmo e o
// await no fim resolve. O duble copia esse formato e guarda o que foi pedido,
// para o teste poder afirmar sobre os FILTROS -- e o filtro `amount < 0` que
// impede o salario de virar a primeira assinatura da lista.
function dublarSupabase({ transacoes = [], erroLeitura = null, erroGravacao = null } = {}) {
  const registro = { filtros: [], upserts: [], tabelas: [] };

  const leitura = () => {
    const b = {};
    for (const metodo of ["select", "eq", "lt", "gte", "order", "limit"]) {
      b[metodo] = (...args) => {
        registro.filtros.push([metodo, ...args]);
        return b;
      };
    }
    b.then = (ok, falha) =>
      Promise.resolve(
        erroLeitura ? { data: null, error: { message: erroLeitura } } : { data: transacoes, error: null }
      ).then(ok, falha);
    return b;
  };

  return {
    registro,
    from(tabela) {
      registro.tabelas.push(tabela);
      if (tabela === "financial_transactions") return leitura();
      if (tabela === "detected_recurrences") {
        return {
          upsert: (linhas, opcoes) => {
            registro.upserts.push({ linhas, opcoes });
            return Promise.resolve({
              error: erroGravacao ? { message: erroGravacao } : null,
            });
          },
        };
      }
      throw new Error(`tabela inesperada na varredura: ${tabela}`);
    },
  };
}

/** Tres cobrancas mensais da Netflix, do jeito que o PostgREST as devolve. */
function netflixMensal(valor = "-39.90") {
  return [
    { id: "t1", description: "NETFLIX.COM*8829", amount: valor, transaction_date: "2026-07-10" },
    { id: "t2", description: "NETFLIX COM", amount: valor, transaction_date: "2026-08-10" },
    { id: "t3", description: "netflix.com 5512", amount: valor, transaction_date: "2026-09-10" },
  ];
}

// ---------------------------------------------------------------------------
// 1. `numeric` chega como STRING
// ---------------------------------------------------------------------------
// O supabase-js entrega `numeric` como string. O fixture usa string de
// proposito: e o formato real da resposta, e um fixture com numero testaria uma
// situacao que nunca acontece em producao.
//
// ATENCAO ao que este teste prova e ao que NAO prova. Ele NAO prova que o
// `Number()` da varredura e indispensavel -- medido: a saida do detector e
// identica com string e com numero, porque `"-39.90" < 0` ja converte e todo
// uso do valor passa por `Math.abs`. Uma versao anterior deste arquivo afirmava
// o contrario no comentario, e a afirmacao era falsa.
//
// O que ele prova e o contrato observavel: entrando o que o banco manda de
// verdade, sai UMA recorrencia com valores NUMERICOS no payload. O tipo da
// saida e a parte que importa -- e por onde um `0 + "-39.90"` = `"0-39.90"`
// entraria no banco como valor errado, sem excecao nenhuma.
test("detecta com amount em string, como o banco devolve", async () => {
  const db = dublarSupabase({ transacoes: netflixMensal() });
  const r = await varrerRecorrencias(db, "u1");

  assert.equal(r.scanned, 3);
  assert.equal(r.detected, 1);
  assert.equal(db.registro.upserts.length, 1);

  const linha = db.registro.upserts[0].linhas[0];
  assert.equal(linha.merchant_key, "netflix");
  for (const coluna of ["avg_amount", "last_amount", "monthly_cost"]) {
    assert.equal(typeof linha[coluna], "number", `${coluna} tem que ir numerico para o banco`);
  }
  assert.equal(linha.avg_amount, 39.9, "e o valor absoluto, nao a string nem o negativo");
});

// ---------------------------------------------------------------------------
// 2. A decisao do usuario sobrevive a varredura
// ---------------------------------------------------------------------------
// O upsert so sobrescreve as colunas que recebe. No dia em que alguem
// acrescentar `status` ao payload "para deixar explicito", toda assinatura que
// o usuario mandou IGNORAR volta para a tela na manha seguinte, porque agora o
// cron roda todo dia. O bug aparece como "o app nao lembra do que eu escolhi".
test("o payload nao carrega status nem status_changed_at", async () => {
  const db = dublarSupabase({ transacoes: netflixMensal() });
  await varrerRecorrencias(db, "u1");

  const linha = db.registro.upserts[0].linhas[0];
  assert.ok(!("status" in linha), "status no payload apaga a escolha do usuario");
  assert.ok(!("status_changed_at" in linha), "status_changed_at no payload idem");
});

test("o upsert usa a UNIQUE da 011, senao a Netflix duplica a cada varredura", async () => {
  const db = dublarSupabase({ transacoes: netflixMensal() });
  await varrerRecorrencias(db, "u1");
  assert.equal(db.registro.upserts[0].opcoes.onConflict, "user_id,merchant_key");
});

test("grava sob o user_id pedido, e nao sob o dono da sessao", async () => {
  // O cron roda com service_role e varre um usuario por vez. Se o user_id
  // saisse de qualquer outro lugar, o cron gravaria as assinaturas de todo
  // mundo na conta de uma pessoa so -- e a RLS nao barra service_role.
  const db = dublarSupabase({ transacoes: netflixMensal() });
  await varrerRecorrencias(db, "usuario-do-cron");
  assert.equal(db.registro.upserts[0].linhas[0].user_id, "usuario-do-cron");
});

// ---------------------------------------------------------------------------
// 3. Os filtros da leitura
// ---------------------------------------------------------------------------
test("le so despesa do proprio usuario, dentro da janela e com teto", async () => {
  const db = dublarSupabase({ transacoes: netflixMensal() });
  await varrerRecorrencias(db, "u1", 24);

  const f = db.registro.filtros;
  assert.deepEqual(
    f.find((x) => x[0] === "eq"),
    ["eq", "user_id", "u1"]
  );
  // Sem este filtro o salario -- que cai todo mes, em intervalo regular e valor
  // estavel -- e a primeira "assinatura" que o usuario ve na tela.
  assert.deepEqual(
    f.find((x) => x[0] === "lt"),
    ["lt", "amount", 0]
  );
  assert.deepEqual(
    f.find((x) => x[0] === "limit"),
    ["limit", MAX_TRANSACOES]
  );
});

test("a janela pedida vira a data inicial da leitura", async () => {
  const db = dublarSupabase({ transacoes: [] });
  const curta = await varrerRecorrencias(db, "u1", 6);
  const longa = await varrerRecorrencias(db, "u1", 24);

  assert.ok(longa.window.from < curta.window.from, "24 meses comeca antes de 6");
  assert.equal(curta.window.months, 6);
  const gte = db.registro.filtros.filter((x) => x[0] === "gte");
  assert.equal(gte[0][2], curta.window.from, "o gte tem que usar a mesma data que a resposta informa");
});

// ---------------------------------------------------------------------------
// 4. `?months=` fora do intervalo
// ---------------------------------------------------------------------------
// `?months=0` faria a janela comecar HOJE: zero transacoes, zero assinaturas,
// resposta 200. O usuario veria a tela esvaziar sem nenhuma mensagem.
test("janelaPedida recusa valor absurdo e cai no padrao", () => {
  assert.equal(janelaPedida(null), JANELA_PADRAO_MESES);
  assert.equal(janelaPedida(""), JANELA_PADRAO_MESES);
  assert.equal(janelaPedida("0"), JANELA_PADRAO_MESES);
  assert.equal(janelaPedida("-3"), JANELA_PADRAO_MESES);
  assert.equal(janelaPedida("abc"), JANELA_PADRAO_MESES);
  assert.equal(janelaPedida("61"), JANELA_PADRAO_MESES);
  assert.equal(janelaPedida("Infinity"), JANELA_PADRAO_MESES);
});

test("janelaPedida aceita o que esta no intervalo", () => {
  assert.equal(janelaPedida("6"), 6);
  assert.equal(janelaPedida("60"), 60);
  assert.equal(janelaPedida("12.7"), 12, "mes fracionado vira inteiro, nao erro");
});

// ---------------------------------------------------------------------------
// 5. Falha do banco chega em quem chamou
// ---------------------------------------------------------------------------
// O cron precisa distinguir "esse usuario falhou" de "nao havia nada". Se a
// varredura engolisse o erro e devolvesse detected: 0, o job sairia verde no
// dia em que a 011 nao estivesse aplicada -- que foi exatamente o que aconteceu
// em producao com a tela.
test("erro de leitura vira excecao com a mensagem do banco", async () => {
  const db = dublarSupabase({ erroLeitura: 'relation "public.financial_transactions" does not exist' });
  await assert.rejects(() => varrerRecorrencias(db, "u1"), /does not exist/);
});

test("erro de gravacao vira excecao com a mensagem do banco", async () => {
  const db = dublarSupabase({
    transacoes: netflixMensal(),
    erroGravacao: 'relation "public.detected_recurrences" does not exist',
  });
  await assert.rejects(() => varrerRecorrencias(db, "u1"), /detected_recurrences/);
});

// ---------------------------------------------------------------------------
// 6. Historico vazio nao escreve
// ---------------------------------------------------------------------------
test("sem transacoes nao ha upsert nenhum", async () => {
  const db = dublarSupabase({ transacoes: [] });
  const r = await varrerRecorrencias(db, "u1");

  assert.equal(r.detected, 0);
  assert.equal(db.registro.upserts.length, 0, "upsert de lista vazia e viagem inutil ao banco");
  assert.equal(r.truncated, false);
});

test("historico no teto marca truncated, em vez de mentir que acabou", async () => {
  // Sem esta bandeira, quem tem mais de MAX_TRANSACOES lancamentos teria so o
  // pedaco mais antigo analisado e concluiria que a assinatura nao tem
  // ocorrencias suficientes -- silenciosamente, com 200 na resposta.
  const muitas = Array.from({ length: MAX_TRANSACOES }, (_, i) => ({
    id: `t${i}`,
    description: "PADARIA DO ZE",
    amount: "-12.00",
    transaction_date: "2026-09-01",
  }));
  const r = await varrerRecorrencias(dublarSupabase({ transacoes: muitas }), "u1");
  assert.equal(r.truncated, true);
});
