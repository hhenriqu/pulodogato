// =====================================================
// TESTES - O LIVRO-RAZAO DAS EXECUCOES DE CRON (HMO-156)
// =====================================================
//   npm run test:cron-ledger
//
// O que esta suite protege, em uma frase: que a execucao OCIOSA fique
// registrada. Todo o resto do arquivo e detalhe -- se um cron que nao tinha
// nada a fazer parar de gravar linha, o projeto volta ao estado da HMO-152, em
// que tres crons mortos e tres crons ociosos eram indistinguiveis no banco.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const { montarLinha, gravarLinha, comRegistro } = await import(
  "../.tmp-cron-ledger/services/cron-ledger.js"
);

// ---------------------------------------------------------------------------
// O CASO QUE DA NOME AO ARQUIVO
// ---------------------------------------------------------------------------

test("execucao ociosa (200 com contadores zerados) e registrada como sucesso", () => {
  const linha = montarLinha({
    job: "bill-alerts",
    httpStatus: 200,
    corpo: { ok: true, avisos: 0, push: 0 },
    inicio: 1_000,
    fim: 1_250,
  });

  assert.equal(linha.status, "ok");
  assert.equal(linha.http_status, 200);
  assert.equal(linha.error, null);
  // O corpo tem que sobreviver inteiro: e ele que diz "rodou e nao havia nada
  // a fazer", que e a informacao que o efeito colateral nao consegue dar.
  assert.deepEqual(linha.result, { ok: true, avisos: 0, push: 0 });
});

test("as quatro respostas de 'nada a fazer' das quatro rotas viram status ok", () => {
  // Os corpos exatos dos early-returns de cada rota. Sao os caminhos que a
  // producao de hoje percorre -- tabelas fisicamente vazias -- entao sao os
  // primeiros que precisam gravar.
  const ociosas = [
    { job: "recurrence-scan", corpo: { ok: true, usuarios: 0, detectadas: 0 } },
    { job: "recurrence-alerts", corpo: { ok: true, avisos: 0, push: 0, usuarios: 0 } },
    { job: "bill-alerts", corpo: { ok: true, avisos: 0, push: 0 } },
    { job: "monthly-summary", corpo: { ok: true, resumos: 0, push: 0, usuarios: 0 } },
  ];

  for (const { job, corpo } of ociosas) {
    const linha = montarLinha({ job, httpStatus: 200, corpo, inicio: 0, fim: 1 });
    assert.equal(linha.status, "ok", `${job} deveria registrar sucesso`);
    assert.equal(linha.error, null, `${job} nao deveria ter mensagem de erro`);
  }
});

// ---------------------------------------------------------------------------
// A FAIXA DE STATUS
// ---------------------------------------------------------------------------

test("2xx e sucesso, o resto e erro", () => {
  const casos = [
    [200, "ok"],
    [201, "ok"],
    [299, "ok"],
    [300, "error"],
    [400, "error"],
    [500, "error"],
    [503, "error"],
  ];

  for (const [http, esperado] of casos) {
    const linha = montarLinha({
      job: "bill-alerts",
      httpStatus: http,
      corpo: { error: "x" },
      inicio: 0,
      fim: 1,
    });
    assert.equal(linha.status, esperado, `http ${http}`);
  }
});

test("o http_status exato sobrevive, nao so a faixa", () => {
  // Sem isto, guardar `ok ? 200 : 500` no lugar do status real passaria
  // despercebido: 201, 299 e 503 viram todos o mesmo numero e a linha perde a
  // unica coluna que separa "falha ao ler" de "variavel de ambiente ausente".
  for (const http of [200, 201, 299, 400, 500, 503]) {
    const linha = montarLinha({
      job: "bill-alerts",
      httpStatus: http,
      corpo: { ok: true },
      inicio: 0,
      fim: 1,
    });
    assert.equal(linha.http_status, http);
  }
});

test("http_status e guardado alem do status, porque 500 e 500 sao bugs diferentes", () => {
  const leitura = montarLinha({
    job: "bill-alerts",
    httpStatus: 500,
    corpo: { error: "Falha ao ler os vencimentos" },
    inicio: 0,
    fim: 1,
  });
  const excecao = montarLinha({
    job: "bill-alerts",
    httpStatus: 500,
    corpo: { error: "Erro interno" },
    erro: new Error("connect ETIMEDOUT"),
    inicio: 0,
    fim: 1,
  });

  assert.equal(leitura.status, excecao.status);
  assert.equal(leitura.http_status, excecao.http_status);
  // O que separa os dois e a mensagem, e ela tem que ser a da excecao.
  assert.equal(leitura.error, "Falha ao ler os vencimentos");
  assert.equal(excecao.error, "connect ETIMEDOUT");
});

// ---------------------------------------------------------------------------
// A MENSAGEM DE ERRO
// ---------------------------------------------------------------------------

test("a excecao ganha do corpo generico da resposta", () => {
  const linha = montarLinha({
    job: "recurrence-scan",
    httpStatus: 500,
    corpo: { error: "Erro interno" },
    erro: new Error("relation \"detected_recurrences\" does not exist"),
    inicio: 0,
    fim: 1,
  });

  // "Erro interno" e o texto que a rota mostra para fora; gravar isso no
  // livro-razao daria uma linha que registra a falha e nao ajuda a corrigi-la.
  assert.match(linha.error, /does not exist/);
});

test("sem excecao, a mensagem sai do campo error do corpo", () => {
  const linha = montarLinha({
    job: "monthly-summary",
    httpStatus: 500,
    corpo: { error: "Falha ao gravar os resumos" },
    inicio: 0,
    fim: 1,
  });
  assert.equal(linha.error, "Falha ao gravar os resumos");
});

test("erro sem mensagem nenhuma ainda produz uma linha gravavel", () => {
  const linha = montarLinha({
    job: "bill-alerts",
    httpStatus: 500,
    corpo: {},
    inicio: 0,
    fim: 1,
  });
  // NOT NULL nao se aplica a `error`, mas uma linha de falha com error vazio
  // e um registro que nao registra nada.
  assert.equal(linha.error, "falha sem mensagem");
});

test("excecao que nao e Error (throw de string) tambem vira mensagem", () => {
  const linha = montarLinha({
    job: "bill-alerts",
    httpStatus: 500,
    corpo: {},
    erro: "boom",
    inicio: 0,
    fim: 1,
  });
  assert.equal(linha.error, "boom");
});

test("sucesso nunca carrega mensagem de erro", () => {
  const linha = montarLinha({
    job: "bill-alerts",
    httpStatus: 200,
    // Um corpo de sucesso que por acaso tem a chave `error` (contador de
    // falhas parciais, por exemplo) nao pode marcar a execucao como falha.
    corpo: { ok: true, error: 0 },
    inicio: 0,
    fim: 1,
  });
  assert.equal(linha.status, "ok");
  assert.equal(linha.error, null);
});

// ---------------------------------------------------------------------------
// DURACAO -- e o CHECK da 019
// ---------------------------------------------------------------------------

test("duracao e a diferenca, arredondada", () => {
  const linha = montarLinha({
    job: "bill-alerts",
    httpStatus: 200,
    corpo: {},
    inicio: 1_000,
    fim: 3_400.6,
  });
  assert.equal(linha.duration_ms, 2401);
});

test("relogio que anda para tras nao produz duracao negativa", () => {
  const linha = montarLinha({
    job: "bill-alerts",
    httpStatus: 200,
    corpo: {},
    inicio: 5_000,
    fim: 4_000,
  });
  assert.equal(linha.duration_ms, 0);
});

test("finished_at nunca fica antes de started_at -- o CHECK da 019 recusaria a linha", () => {
  // Sem o piso, esta linha seria recusada pelo banco com
  // cron_runs_finished_after_started_check e a execucao sumiria do livro-razao
  // -- silenciosamente, porque gravarLinha nao derruba a rota.
  const linha = montarLinha({
    job: "bill-alerts",
    httpStatus: 200,
    corpo: {},
    inicio: 5_000,
    fim: 4_000,
  });
  assert.ok(
    new Date(linha.finished_at) >= new Date(linha.started_at),
    `finished_at ${linha.finished_at} < started_at ${linha.started_at}`
  );
});

test("os horarios saem em ISO, que e o que o Postgres aceita em timestamptz", () => {
  const linha = montarLinha({
    job: "bill-alerts",
    httpStatus: 200,
    corpo: {},
    inicio: Date.UTC(2026, 8, 25, 9, 0, 0),
    fim: Date.UTC(2026, 8, 25, 9, 0, 30),
  });
  assert.equal(linha.started_at, "2026-09-25T09:00:00.000Z");
  assert.equal(linha.finished_at, "2026-09-25T09:00:30.000Z");
});

// ---------------------------------------------------------------------------
// O TETO DO CORPO
// ---------------------------------------------------------------------------

test("corpo pequeno passa inteiro, sem marca de corte", () => {
  const corpo = { ok: true, usuarios: 3, detectadas: 7 };
  const linha = montarLinha({
    job: "recurrence-scan",
    httpStatus: 200,
    corpo,
    inicio: 0,
    fim: 1,
  });
  assert.deepEqual(linha.result, corpo);
  assert.equal(linha.result.truncado, undefined);
});

test("corpo gigante e cortado e o corte fica marcado", () => {
  // O caso real: recurrence-scan devolve `falhas[]` por usuario.
  const falhas = Array.from({ length: 500 }, (_, i) => ({
    user_id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    erro: "relation \"detected_recurrences\" does not exist",
  }));

  const linha = montarLinha({
    job: "recurrence-scan",
    httpStatus: 200,
    corpo: { ok: true, falhas },
    inicio: 0,
    fim: 1,
  });

  assert.equal(linha.result.truncado, true);
  assert.match(linha.result.motivo, /acima do teto/);
  // Um corte sem marca seria pior que o corte: o leitor concluiria que o job
  // devolveu pouco, em vez de que o registro nao coube.
  assert.ok(linha.result.trecho.length <= 4000);
});

test("corpo circular vira marca de corte em vez de derrubar o registro", () => {
  const circular = { ok: true };
  circular.self = circular;

  const linha = montarLinha({
    job: "bill-alerts",
    httpStatus: 200,
    corpo: circular,
    inicio: 0,
    fim: 1,
  });

  assert.equal(linha.result.truncado, true);
  assert.match(linha.result.motivo, /nao serializavel/);
  // E o principal: a linha continua sendo uma linha de sucesso gravavel.
  assert.equal(linha.status, "ok");
});

test("corpo undefined vira null, nao some da linha", () => {
  const linha = montarLinha({
    job: "bill-alerts",
    httpStatus: 200,
    corpo: undefined,
    inicio: 0,
    fim: 1,
  });
  assert.equal(linha.result, null);
});

// ---------------------------------------------------------------------------
// A GRAVACAO -- com um cliente falso
// ---------------------------------------------------------------------------

function clienteFalso(respostaInsert) {
  const gravadas = [];
  return {
    gravadas,
    from(tabela) {
      assert.equal(tabela, "cron_runs");
      return {
        insert(linha) {
          gravadas.push(linha);
          return Promise.resolve(respostaInsert ?? { error: null });
        },
      };
    },
  };
}

test("a linha vai para cron_runs", async () => {
  const cliente = clienteFalso();
  const linha = montarLinha({
    job: "bill-alerts",
    httpStatus: 200,
    corpo: { ok: true },
    inicio: 0,
    fim: 1,
  });

  const r = await gravarLinha(cliente, linha);

  assert.equal(r.gravou, true);
  assert.equal(cliente.gravadas.length, 1);
  assert.equal(cliente.gravadas[0].job, "bill-alerts");
});

test("erro do banco na gravacao nao lanca -- o trabalho do cron ja aconteceu", async () => {
  const cliente = clienteFalso({ error: { message: 'relation "cron_runs" does not exist' } });
  const linha = montarLinha({
    job: "bill-alerts",
    httpStatus: 200,
    corpo: { ok: true },
    inicio: 0,
    fim: 1,
  });

  // Este e o dia em que a 019 ainda nao foi aplicada em producao. A rota tem
  // que continuar respondendo 200.
  const r = await gravarLinha(cliente, linha);
  assert.equal(r.gravou, false);
  assert.match(r.erro, /does not exist/);
});

test("cliente que estoura excecao na gravacao tambem nao lanca", async () => {
  const cliente = {
    from() {
      throw new Error("pooler recusou a conexao");
    },
  };
  const linha = montarLinha({
    job: "bill-alerts",
    httpStatus: 200,
    corpo: {},
    inicio: 0,
    fim: 1,
  });

  const r = await gravarLinha(cliente, linha);
  assert.equal(r.gravou, false);
  assert.match(r.erro, /pooler/);
});

// ---------------------------------------------------------------------------
// O ENVELOPE
// ---------------------------------------------------------------------------

test("comRegistro devolve o status e o corpo da rota sem alterar nada", async () => {
  const saida = await comRegistro(
    "bill-alerts",
    { url: "http://exemplo.invalido", serviceRole: "chave" },
    async () => ({ status: 200, body: { ok: true, avisos: 3 } })
  );

  assert.equal(saida.status, 200);
  assert.deepEqual(saida.body, { ok: true, avisos: 3 });
});

test("excecao dentro do corpo vira 500 e a rota nao propaga a excecao", async () => {
  const saida = await comRegistro(
    "recurrence-scan",
    { url: "http://exemplo.invalido", serviceRole: "chave" },
    async () => {
      throw new Error("estourou no meio");
    }
  );

  assert.equal(saida.status, 500);
  assert.equal(saida.body.error, "Erro interno");
});

test("comRegistro sobrevive a um destino de banco inalcancavel", async () => {
  // A gravacao vai falhar (host invalido) e a resposta tem que sair intacta.
  // Aqui a falha acontece DENTRO do fetch, entao quem a segura e o try/catch
  // do gravarLinha -- nao o que envolve o createClient. Ver o teste seguinte.
  const saida = await comRegistro(
    "monthly-summary",
    { url: "http://127.0.0.1:1", serviceRole: "chave" },
    async () => ({ status: 200, body: { ok: true, resumos: 0 } })
  );

  assert.equal(saida.status, 200);
  assert.deepEqual(saida.body, { ok: true, resumos: 0 });
});

test("variavel de ambiente vazia derruba o createClient e a rota ainda responde", async () => {
  // `createClient("")` estoura SINCRONAMENTE ("supabaseUrl is required"), antes
  // de qualquer fetch -- um caminho diferente do teste acima. E o cenario real
  // de um deploy com a variavel apagada: o trabalho do cron ja terminou e a
  // resposta nao pode virar 500 por causa do livro-razao.
  const saida = await comRegistro(
    "recurrence-alerts",
    { url: "", serviceRole: "" },
    async () => ({ status: 200, body: { ok: true, avisos: 2 } })
  );

  assert.equal(saida.status, 200);
  assert.deepEqual(saida.body, { ok: true, avisos: 2 });
});
