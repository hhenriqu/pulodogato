// =====================================================
// TESTES: O QUE A TELA PODE AFIRMAR SOBRE O DINHEIRO DA PESSOA
// =====================================================
//   npm run test:offline-leitura
//
// A suite existe para um defeito que nao aparece como defeito. Sem rede, uma
// tela de leitura mostrava:
//
//     Saldo somado das contas   R$ 0,00
//     Voce ainda nao tem contas
//     Nada em atraso.
//
// Nada disso e calculo errado -- a lista veio vazia e `soma([]) === 0`. O que
// esta errado e a AFIRMACAO: o app diz que voce nao tem conta e nao deve nada
// apoiado numa requisicao que falhou.
//
// Por isso os casos aqui sao escritos como tabela: quatro origens diferentes
// (servidor agora, aparelho, ninguem, erro) produziam a mesma lista vazia, e
// caso que nao existe no codigo tambem nao existe no teste. Foi assim que o
// modo offline subiu sem as categorias no PR #57.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const {
  classificarLeitura,
  podeMostrarNumero,
  podeAfirmarVazio,
  descreverMomento,
  buscarLeitura,
  MARCA_DO_APARELHO,
  MARCA_GUARDADO_EM,
} = await import("../.tmp-offline-leitura/offline-leitura.js");

/** Uma resposta como `classificarLeitura` a enxerga. */
const resposta = (status, cabecalhos = {}) => ({
  resposta: {
    ok: status >= 200 && status < 300,
    status,
    cabecalho: (nome) => cabecalhos[nome.toLowerCase()] ?? null,
  },
});

const SEM_RESPOSTA = { resposta: null };

// ---------------------------------------------------------------------------
// A TABELA: QUATRO ORIGENS, QUATRO ESTADOS
// ---------------------------------------------------------------------------

test("o servidor respondeu agora: fresco", () => {
  assert.equal(classificarLeitura(resposta(200)).estado, "fresco");
});

test("o service worker serviu a copia do aparelho: do-aparelho", () => {
  // A resposta e 200 e o corpo e real. Sem o carimbo, este caso e
  // indistinguivel do de cima -- e a tela mostraria o dado de ontem com a
  // mesma confianca do de agora.
  const { estado, guardadoEm } = classificarLeitura(
    resposta(200, {
      [MARCA_DO_APARELHO]: "1",
      [MARCA_GUARDADO_EM]: "Wed, 24 Sep 2026 21:40:00 GMT",
    })
  );
  assert.equal(estado, "do-aparelho");
  assert.equal(guardadoEm.getTime(), Date.parse("2026-09-24T21:40:00Z"));
});

test("ninguem respondeu e nao ha copia: sem-rede", () => {
  // Nao ter resposta E a prova de que nao havia copia: se houvesse, o
  // NetworkFirst do service worker a teria entregue aqui, com carimbo.
  assert.equal(classificarLeitura(SEM_RESPOSTA).estado, "sem-rede");
});

test("o servidor respondeu erro: erro-do-servidor", () => {
  assert.equal(classificarLeitura(resposta(500)).estado, "erro-do-servidor");
});

test("401 e 403 sao sessao recusada, nao erro do servidor", () => {
  // A acao da pessoa e outra: entrar de novo, e nao esperar. Quem manda para
  // /login e o layout do dashboard.
  assert.equal(classificarLeitura(resposta(401)).estado, "sessao-recusada");
  assert.equal(classificarLeitura(resposta(403)).estado, "sessao-recusada");
});

// ---------------------------------------------------------------------------
// O QUE A TELA PODE IMPRIMIR EM CADA UM DELES
// ---------------------------------------------------------------------------

test("numero so aparece quando ha dado atras dele", () => {
  assert.equal(podeMostrarNumero("fresco"), true);
  assert.equal(podeMostrarNumero("do-aparelho"), true);
  assert.equal(podeMostrarNumero("sem-rede"), false);
  assert.equal(podeMostrarNumero("erro-do-servidor"), false);
  assert.equal(podeMostrarNumero("sessao-recusada"), false);
  // `null` e "ainda carregando": durante o carregamento tambem nao da para
  // afirmar R$ 0,00.
  assert.equal(podeMostrarNumero(null), false);
});

test("a frase de vazio exige resposta do servidor AGORA", () => {
  // Esta e a diferenca entre as duas funcoes, e ela nao e cosmetica: com dado
  // do aparelho, a lista pode estar vazia por ser copia de antes de a pessoa
  // cadastrar a primeira conta. "Voce ainda nao tem contas" a convidaria a
  // cadastrar de novo o que ja existe -- e em `bills` a frase equivalente e
  // "Nada em atraso.", dita sobre uma agenda de ontem.
  assert.equal(podeAfirmarVazio("fresco"), true);
  assert.equal(podeAfirmarVazio("do-aparelho"), false);
  assert.equal(podeAfirmarVazio("sem-rede"), false);
  assert.equal(podeAfirmarVazio(null), false);
});

// ---------------------------------------------------------------------------
// DE QUANDO E O DADO
// ---------------------------------------------------------------------------

const em = (a, m, d, h, min) => new Date(a, m - 1, d, h, min);

test("hoje, ontem e a data cheia", () => {
  const agora = em(2026, 9, 25, 14, 0);
  assert.equal(descreverMomento(em(2026, 9, 25, 9, 5), agora), "hoje as 09:05");
  assert.equal(descreverMomento(em(2026, 9, 24, 21, 40), agora), "ontem as 21:40");
  assert.equal(descreverMomento(em(2026, 9, 22, 10, 3), agora), "em 22/09 as 10:03");
});

test("ontem as 23:50 nao e 'hoje' -- a conta e de calendario", () => {
  // Vinte minutos de diferenca e dias diferentes. Subtrair timestamps
  // (`(agora - quando) / 86400000`) diria "hoje", e diria "hoje" tambem para
  // as 00:10 de depois de amanha.
  const agora = em(2026, 9, 25, 0, 10);
  assert.equal(descreverMomento(em(2026, 9, 24, 23, 50), agora), "ontem as 23:50");
});

test("dado 'do futuro' vira data cheia, nunca 'amanha'", () => {
  // Relogio do aparelho atrasado: o `Date` do servidor fica a frente. A data
  // cheia e o unico jeito de nao escrever uma frase absurda embaixo de um
  // saldo.
  const agora = em(2026, 9, 25, 10, 0);
  assert.equal(descreverMomento(em(2026, 9, 27, 8, 0), agora), "em 27/09 as 08:00");
});

test("sem data legivel, a frase continua honesta", () => {
  assert.equal(descreverMomento(null), "de um carregamento anterior");
  assert.equal(
    classificarLeitura(
      resposta(200, { [MARCA_DO_APARELHO]: "1", [MARCA_GUARDADO_EM]: "ontem" })
    ).guardadoEm,
    null
  );
  // Sem o cabecalho de data, o estado continua sendo `do-aparelho`: perder a
  // hora nao pode fazer a tela achar que o dado e de agora.
  assert.equal(
    classificarLeitura(resposta(200, { [MARCA_DO_APARELHO]: "1" })).estado,
    "do-aparelho"
  );
});

// ---------------------------------------------------------------------------
// O EMBRULHO DO FETCH
// ---------------------------------------------------------------------------

/** Troca o `fetch` global pela resposta (ou falha) que o teste quiser. */
async function comFetch(falso, corpo) {
  const original = globalThis.fetch;
  globalThis.fetch = falso;
  try {
    return await corpo();
  } finally {
    globalThis.fetch = original;
  }
}

const respostaFalsa = (status, corpo, cabecalhos = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (n) => cabecalhos[n.toLowerCase()] ?? null },
  json: async () => {
    if (corpo === undefined) throw new SyntaxError("nao e JSON");
    return corpo;
  },
});

test("fetch que rejeita nao propaga excecao -- vira 'sem-rede'", async () => {
  // O ponto do embrulho. Era o try/catch em volta de cada busca que vinha
  // escondendo os quatro casos um dentro do outro, e num `Promise.all` de
  // seis buscas bastava UMA rejeitar para as outras cinco sumirem juntas.
  await comFetch(
    async () => {
      throw new TypeError("Failed to fetch");
    },
    async () => {
      const leitura = await buscarLeitura("/api/x");
      assert.equal(leitura.estado, "sem-rede");
      assert.equal(leitura.dados, null);
    }
  );
});

test("o corpo so e lido quando ha corpo utilizavel", async () => {
  await comFetch(
    async () => respostaFalsa(200, { accounts: [1, 2] }),
    async () => {
      const leitura = await buscarLeitura("/api/x");
      assert.equal(leitura.estado, "fresco");
      assert.deepEqual(leitura.dados, { accounts: [1, 2] });
    }
  );

  await comFetch(
    async () => respostaFalsa(500, { error: "x" }),
    async () => {
      const leitura = await buscarLeitura("/api/x");
      assert.equal(leitura.estado, "erro-do-servidor");
      assert.equal(leitura.dados, null);
    }
  );
});

test("200 com corpo que nao e JSON nao vira tela vazia", async () => {
  // Acontece quando alguma camada no meio devolve uma pagina de erro com
  // status 200. Tratar como sucesso mostraria a tela zerada -- de novo
  // afirmando que a pessoa nao tem nada.
  await comFetch(
    async () => respostaFalsa(200, undefined),
    async () => {
      assert.equal((await buscarLeitura("/api/x")).estado, "erro-do-servidor");
    }
  );
});

test("a copia do aparelho chega com dado E com a data", async () => {
  await comFetch(
    async () =>
      respostaFalsa(
        200,
        { scheduled: [{ id: "a" }] },
        {
          [MARCA_DO_APARELHO]: "1",
          [MARCA_GUARDADO_EM]: "Wed, 24 Sep 2026 21:40:00 GMT",
        }
      ),
    async () => {
      const leitura = await buscarLeitura("/api/x");
      assert.equal(leitura.estado, "do-aparelho");
      assert.deepEqual(leitura.dados, { scheduled: [{ id: "a" }] });
      assert.equal(leitura.guardadoEm.getTime(), Date.parse("2026-09-24T21:40:00Z"));
    }
  );
});

// ---------------------------------------------------------------------------
// OS DOIS ARQUIVOS PRECISAM CONCORDAR
// ---------------------------------------------------------------------------

test("o nome do carimbo e o mesmo aqui e no service worker", () => {
  // Quem escreve o cabecalho e `lib/pwa-runtime-cache.js` (copiado como texto
  // para dentro do sw.js); quem o le e `lib/offline-leitura.ts`. Sao dois
  // arquivos, em duas linguagens, sem import entre eles.
  //
  // Uma letra diferente nao quebra nada visivel: o dado continua chegando, o
  // estado volta a ser "fresco", e a tela volta a mostrar ontem como se fosse
  // agora -- que e exatamente o defeito que este trabalho veio consertar.
  const require = createRequire(import.meta.url);
  const doSw = require("../lib/pwa-runtime-cache.js");

  assert.equal(MARCA_DO_APARELHO, doSw.MARCA_DO_APARELHO);
  assert.equal(MARCA_GUARDADO_EM, doSw.MARCA_GUARDADO_EM);

  // E o plugin tem que escrever os dois LITERAIS: ele e serializado para
  // dentro do sw.js sem o escopo do modulo, entao uma constante ali vira
  // ReferenceError dentro do service worker -- offline, onde ninguem ve.
  const fonte = doSw.pluginDeMarcacao.cachedResponseWillBeUsed.toString();
  assert.ok(
    fonte.includes(`"${MARCA_DO_APARELHO}"`),
    "o plugin nao escreve o nome do carimbo como texto"
  );
  assert.ok(
    fonte.includes(`"${MARCA_GUARDADO_EM}"`),
    "o plugin nao escreve o nome da data como texto"
  );
  assert.ok(
    !/MARCA_DO_APARELHO|MARCA_GUARDADO_EM/.test(fonte),
    "o plugin cita uma constante do modulo: dentro do sw.js ela nao existe"
  );
});

test("a pagina que le nao pode voltar a usar fetch cru", () => {
  // Guarda de arquitetura. As tres telas entraram no precache porque sabem
  // dizer "sem rede"; um `fetch(` de leitura solto numa delas devolve o
  // comportamento antigo para aquela busca, e o sintoma e de novo um numero
  // plausivel -- nao um erro.
  const RAIZ = path.join(import.meta.dirname, "..");
  for (const tela of ["bills", "accounts", "recurrences"]) {
    const fonte = fs.readFileSync(
      path.join(RAIZ, "app/(dashboard)/dashboard", tela, "page.tsx"),
      "utf8"
    );
    assert.ok(
      fonte.includes("buscarLeitura"),
      `${tela}/page.tsx nao usa buscarLeitura`
    );

    for (const chamada of fonte.matchAll(/\bfetch\(/g)) {
      // So leitura. Escrita continua com `fetch` e trata o erro na hora --
      // um POST que falha a pessoa ve falhar, entao ali nao ha silencio.
      const trecho = fonte.slice(chamada.index, chamada.index + 300);
      // `method:` pode vir de um ternario (`form.id ? "PATCH" : "POST"`), por
      // isso o verbo e procurado na linha inteira e nao colado nos dois pontos.
      assert.ok(
        /method:[^\n]*"(POST|PATCH|PUT|DELETE)"/.test(trecho),
        `${tela}/page.tsx voltou a LER com fetch cru:\n${trecho.split("\n")[0]}`
      );
    }
  }
});
