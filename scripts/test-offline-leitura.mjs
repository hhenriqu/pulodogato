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

import test, { mock } from "node:test";
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
  comSemCopia,
  MARCA_DO_APARELHO,
  MARCA_GUARDADO_EM,
  PARAM_SEM_COPIA,
  AVISO_ATUALIZAR_FALHOU,
  ID_DO_AVISO_ATUALIZAR,
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

// Onde a leitura de cada tela precacheada mora.
//
// Ate a HMO-166 era sempre o proprio `page.tsx`, e a lista podia ser so o nome
// da tela. Depois que "Contas e Cartões" virou duas telas, a conversa com
// `/api/financial-accounts` passou a morar num hook compartilhado -- as duas
// paginas nao leem nada por conta propria. A guarda segue o ARQUIVO QUE LE, e
// nao a pagina, senao ela cobraria `buscarLeitura` de quem nao busca e deixaria
// de olhar o unico arquivo onde a regressao pode acontecer.
const QUEM_LE = [
  { rotulo: "bills/page.tsx", caminho: "app/(dashboard)/dashboard/bills/page.tsx" },
  {
    rotulo: "recurrences/page.tsx",
    caminho: "app/(dashboard)/dashboard/recurrences/page.tsx",
  },
  { rotulo: "lib/hooks/useContas.ts", caminho: "lib/hooks/useContas.ts" },
  // As DUAS telas de cartoes leem a fatura por conta propria, alem do cadastro
  // que vem do hook. Elas estavam fora das duas listas -- nem aqui, nem em
  // `QUEM_NAO_LE` -- e por isso eram as unicas telas precacheadas onde um
  // `fetch(` de leitura podia voltar sem nada reprovar (achado na HMO-477).
  {
    rotulo: "cartoes/page.tsx (a fatura do mes)",
    caminho: "app/(dashboard)/dashboard/cartoes/page.tsx",
  },
  {
    rotulo: "cartoes/[id]/page.tsx (a fatura do cartao)",
    caminho: "app/(dashboard)/dashboard/cartoes/[id]/page.tsx",
  },
];

/**
 * Escrita continua liberada: um POST que falha a pessoa ve falhar.
 *
 * A regra e pela NEGATIVA -- "tem `method:` e nao e `"GET"`" -- e nao por uma
 * lista de verbos. A lista (`"(POST|PATCH|PUT|DELETE)"`) exigia o verbo como
 * TEXTO no proprio `fetch`, e por isso nao via a forma em que ele chega por
 * variavel:
 *
 *     const resposta = await fetch(pedido.url, { method: pedido.metodo });
 *
 * Esse e o Excluir da tela de um cartao, e `pedido.metodo` e tipado como o
 * literal `"DELETE"` (`lib/acoes-da-fatura.ts`) -- escrita, sem duvida. Com a
 * lista de verbos ele era classificado como LEITURA CRUA, e a unica razao pela
 * qual nada reprovava e que aquele arquivo nao estava em nenhuma das duas
 * listas (achado ao inclui-lo, HMO-477).
 *
 * Pela negativa a classificacao segue a pergunta que a guarda faz de verdade
 * ("isto e uma leitura que deveria passar por `buscarLeitura`?"), e de brinde
 * cobre `HEAD` e qualquer verbo novo sem precisar reeditar a lista.
 */
const E_ESCRITA = (trecho) => {
  const comMetodo = trecho.match(/method:\s*([^,\n}]+)/);
  // Sem `method:`, `fetch` e GET -- e GET e leitura.
  if (!comMetodo) return false;
  return !/^["'`]GET["'`]$/.test(comMetodo[1].trim());
};

/**
 * As telas precacheadas que nao podem ler por conta propria.
 *
 * `leiturasDeclaradas` E A EXCECAO ESCRITA, e nao a ausencia da guarda.
 *
 * Ate a HMO-409 estas duas telas nao tinham `fetch(` nenhum, e a guarda podia
 * ser "zero chamadas". A HMO-409 pos o ajuste de saldo na linha da conta: duas
 * ESCRITAS (POST e DELETE), que a regra do `QUEM_LE` acima ja libera pelo mesmo
 * motivo de la, e UMA LEITURA -- o GET do ajuste do dia.
 *
 * A leitura entrou aqui como excecao em vez de ir para dentro de um hook com
 * `buscarLeitura`, e a razao e que a alternativa seria PIOR, nao mais barata. O
 * que aquele GET devolve e `saldo_sem_ajuste`: o saldo contra o qual a pessoa
 * vai declarar "a conta mostra tanto". Servido de cache offline, ele seria um
 * saldo VELHO em cima do qual se decide dinheiro -- exatamente o "numero
 * plausivel" que esta guarda existe para impedir, so que no pior lugar
 * possivel. O caminho certo para esta leitura nao e sobreviver sem rede: e nao
 * acontecer sem rede.
 *
 * E e `premissa` que CONFERE isso, e por isso a excecao nao e um carimbo. Ela
 * so se sustenta enquanto o gesto que dispara o GET estiver apagado sem rede.
 * Hoje esta, por dois caminhos: o botao "Ajustar saldo" leva
 * `disabled={!online}`, e com `estado === "sem-rede"` a lista inteira -- logo o
 * botao -- nem chega a ser renderizada. A guarda ancora no primeiro, que e o
 * especifico daquele botao: se alguem tirar o `disabled`, a excecao passa a ser
 * FALSA e isto fica vermelho, em vez de seguir absolvendo um `fetch(` calado.
 */
const QUEM_NAO_LE = [
  {
    caminho: "app/(dashboard)/dashboard/contas/page.tsx",
    leiturasDeclaradas: [
      {
        apelido: "o GET do ajuste de saldo do dia (HMO-409)",
        forma: /fetch\(\s*`\/api\/financial-accounts\/ajuste\?account_id=/,
        premissa: {
          apelido: 'o botao "Ajustar saldo" fica apagado sem rede',
          ancora: "onClick={() => abrirAjuste(conta)}",
          exige: "disabled={!online}",
        },
        porque:
          "ele le `saldo_sem_ajuste`, o saldo contra o qual a pessoa declara o " +
          "que a conta mostra. De cache, seria saldo velho decidindo dinheiro -- " +
          "por isso o GESTO exige rede, em vez de a leitura virar offline.",
      },
    ],
  },
  // Esta tela esta nas DUAS listas, e nao e engano: ela DELEGA o cadastro ao
  // `useContas` (que e o que se mede aqui) e le a FATURA do mes por conta
  // propria, com `buscarLeitura` (que e o que se mede em `QUEM_LE`). As duas
  // assercoes falam de buscas diferentes do mesmo arquivo.
  {
    caminho: "app/(dashboard)/dashboard/cartoes/page.tsx",
    leiturasDeclaradas: [],
  },
];

test("quem le por uma tela precacheada nao pode voltar a usar fetch cru", () => {
  // Guarda de arquitetura. As telas entraram no precache porque sabem dizer
  // "sem rede"; um `fetch(` de leitura solto devolve o comportamento antigo
  // para aquela busca, e o sintoma e de novo um numero plausivel -- nao um erro.
  const RAIZ = path.join(import.meta.dirname, "..");

  for (const { rotulo, caminho } of QUEM_LE) {
    const fonte = fs.readFileSync(path.join(RAIZ, caminho), "utf8");
    assert.ok(fonte.includes("buscarLeitura"), `${rotulo} nao usa buscarLeitura`);

    for (const chamada of fonte.matchAll(/\bfetch\(/g)) {
      // So leitura. Escrita continua com `fetch` e trata o erro na hora --
      // um POST que falha a pessoa ve falhar, entao ali nao ha silencio.
      const trecho = fonte.slice(chamada.index, chamada.index + 300);
      // `method:` pode vir de um ternario (`form.id ? "PATCH" : "POST"`), por
      // isso o verbo e procurado na linha inteira e nao colado nos dois pontos.
      assert.ok(
        E_ESCRITA(trecho),
        `${rotulo} voltou a LER com fetch cru:\n${trecho.split("\n")[0]}`
      );
    }
  }
});

test("as telas que delegam a leitura nao buscam por fora do hook", () => {
  // O outro lado da guarda de cima. Uma delas voltar a chamar a API direto e o
  // caminho pelo qual o tratamento de "sem rede" se perde sem ninguem tirar
  // nada do lugar: o hook continua la, correto, e a tela simplesmente deixa de
  // passar por ele.
  const RAIZ = path.join(import.meta.dirname, "..");

  for (const { caminho, leiturasDeclaradas } of QUEM_NAO_LE) {
    const fonte = fs.readFileSync(path.join(RAIZ, caminho), "utf8");
    assert.ok(
      fonte.includes("useContas"),
      `${caminho} nao le pelo hook que trata a falta de rede`
    );

    // Cada `fetch(` e classificado UMA vez, e as duas conferencias abaixo leem
    // desta mesma lista -- e o que mantem a excecao medindo a LEITURA. Se o
    // GET fosse conferido por "existe um fetch com esta forma", a DELETE da
    // mesma rota (mesma URL, mais `method: "DELETE"`) satisfaria a conferencia
    // sozinha: o GET poderia ter ido embora e a excecao seguiria "em uso".
    const chamadas = [...fonte.matchAll(/\bfetch\(/g)].map((chamada) => {
      const trecho = fonte.slice(chamada.index, chamada.index + 300);
      return { trecho, primeiraLinha: trecho.split("\n")[0], escrita: E_ESCRITA(trecho) };
    });
    const leituras = chamadas.filter((c) => !c.escrita);

    // METADE 1 -- nenhuma LEITURA sem declaracao. Esta e a assercao original
    // ("zero fetch"), so que agora ela absolve escrita e a excecao escrita.
    for (const leitura of leituras) {
      const declarada = leiturasDeclaradas.find((d) => d.forma.test(leitura.trecho));
      assert.ok(
        declarada,
        `${caminho} voltou a chamar a API por fora do useContas:\n` +
          `  ${leitura.primeiraLinha}\n` +
          "  se esta leitura tem de existir, declare-a em `leiturasDeclaradas`\n" +
          "  com o `porque` E a `premissa` que a sustenta -- como a do ajuste."
      );
    }

    // METADE 2 -- a excecao declarada e CONFERIDA AO CONTRARIO: ela tem de
    // continuar existindo como leitura, senao a declaracao e so texto velho
    // absolvendo um `fetch(` futuro que ninguem decidiu.
    for (const { apelido, forma, premissa, porque } of leiturasDeclaradas) {
      assert.ok(
        leituras.some((l) => forma.test(l.trecho)),
        `${caminho}: a excecao declarada "${apelido}" nao existe mais como ` +
          `leitura (${forma.source}).\n` +
          "  se ela foi para dentro de um hook com `buscarLeitura`, tire a " +
          "entrada de `leiturasDeclaradas` -- ela nao tem mais o que absolver."
      );

      // METADE 3 -- E A PREMISSA. A excecao vale por o gesto exigir rede; sem
      // o `disabled`, o GET passa a sair offline e o motivo escrito fica falso.
      const ancora = fonte.indexOf(premissa.ancora);
      assert.ok(
        ancora !== -1,
        `${caminho}: nao achei a ancora da premissa de "${apelido}" ` +
          `(\`${premissa.ancora}\`).\n` +
          "  o gesto mudou de forma, entao a premissa parou de ser medida -- " +
          "reancore-a ou reveja a excecao."
      );
      // Janela nos DOIS sentidos (a ordem das props nao e garantida), mas
      // curta: o `disabled` do botao do ajuste esta a 61 chars da ancora, e o
      // `disabled={!online}` mais proximo que e de OUTRO botao esta a 3376.
      const janela = fonte.slice(Math.max(0, ancora - 300), ancora + 300);
      assert.ok(
        janela.includes(premissa.exige),
        `${caminho}: ${premissa.apelido} -- e esta premissa CAIU ` +
          `(\`${premissa.exige}\` nao esta junto da ancora).\n` +
          `  com isso "${apelido}" deixa de ser excecao e volta a ser leitura ` +
          "crua sem rede.\n" +
          `  ${porque}`
      );
    }
  }
});

// =========================================================================
// O "ATUALIZAR" DAS SETE TELAS -- HMO-477
// =========================================================================
// A HMO-401 ligou o botao no fluxo de caixa e a HMO-457 nas tres telas de
// movimentacao. A HMO-477 ligou as cinco que faltavam, e dai nasceu o problema
// que estas guardas medem: a fiacao e IGUAL em sete arquivos, cada um com a sua
// suite, e nenhuma delas olha para os outros seis. Um botao desligado nao quebra
// teste nenhum -- ele so devolve a mesma tela com o mesmo momento.
//
// Sao tres decisoes por tela, e as tres falham CALADAS:
//
//   1. a URL leva o parametro (senao o NetworkFirst devolve a copia de sete
//      dias e o botao nao muda nada);
//   2. o handler vai dentro de uma SETA (senao o `MouseEvent` do `onClick`
//      chega como `semCopia` e TODA releitura fura o cache);
//   3. um "Atualizar" que falha nao apaga o que esta na tela.

/**
 * As sete telas que tem o botao, e o nome da funcao que o botao chama.
 *
 * O nome MUDA por tela (`carregar` nas cinco de uma leitura, `recarregar` nas
 * duas de cartoes, que juntam o cadastro e a fatura), e e por isso que ele e
 * dado aqui em vez de procurado: uma guarda que aceitasse "qualquer nome"
 * passaria verde com a seta chamando a funcao errada.
 */
const TELAS_COM_ATUALIZAR = [
  {
    rotulo: "fluxo de caixa (HMO-401)",
    caminho: "app/(dashboard)/dashboard/cash-flow/page.tsx",
    leitor: "carregar",
  },
  {
    rotulo: "despesas/receitas/transferencias (HMO-457)",
    caminho: "components/movimentacoes/ListaDeMovimentacao.tsx",
    leitor: "carregar",
  },
  {
    rotulo: "contas a pagar",
    caminho: "app/(dashboard)/dashboard/bills/page.tsx",
    leitor: "carregar",
  },
  {
    rotulo: "cartoes",
    caminho: "app/(dashboard)/dashboard/cartoes/page.tsx",
    leitor: "recarregar",
  },
  {
    rotulo: "um cartao",
    caminho: "app/(dashboard)/dashboard/cartoes/[id]/page.tsx",
    leitor: "recarregar",
  },
  {
    rotulo: "recorrencias",
    caminho: "app/(dashboard)/dashboard/recurrences/page.tsx",
    leitor: "carregar",
  },
  {
    rotulo: "contas",
    caminho: "app/(dashboard)/dashboard/contas/page.tsx",
    leitor: "carregar",
  },
];

const RAIZ_DO_REPO = path.join(import.meta.dirname, "..");
const fonteDe = (caminho) =>
  fs.readFileSync(path.join(RAIZ_DO_REPO, caminho), "utf8");

/**
 * A fonte SEM as linhas de comentario.
 *
 * Nao e capricho: os sete arquivos explicam o defeito EM PROSA, e a prosa cita
 * a forma errada com todas as letras (``aoTentarDeNovo={carregar}` passaria o
 * MouseEvent`). Uma guarda que lesse o arquivo cru acharia a forma proibida no
 * comentario de quem a proibiu, e reprovaria o codigo certo -- ou, pior, acharia
 * a forma CERTA num comentario e absolveria a fiacao errada.
 */
const semComentarios = (fonte) =>
  fonte
    .split("\n")
    .filter((linha) => {
      const t = linha.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

/** O bloco JSX de uma tag, da abertura ao `/>` que a fecha. */
function blocoDaTag(fonte, tag) {
  const abre = fonte.indexOf(`<${tag}`);
  if (abre === -1) return null;
  const fecha = fonte.indexOf("/>", abre);
  return fecha === -1 ? null : fonte.slice(abre, fecha + 2);
}

test("as sete telas chamam o Atualizar dentro de uma SETA", () => {
  // DECISAO 2, e ela vale para TODO `aoTentarDeNovo` do arquivo -- a faixa e os
  // dois paineis. `FaixaDadoDoAparelho` liga a prop direto no `onClick`
  // (`onClick={aoTentarDeNovo}`), entao passar a funcao por referencia a chama
  // COM o `MouseEvent` do clique. Um evento e truthy: `semCopia` chegaria
  // verdadeiro em toda releitura -- depois de confirmar, pagar, editar,
  // arquivar -- e cada uma apagaria a leitura offline da tela. Nada quebra, e a
  // tela parece certa.
  for (const { rotulo, caminho } of TELAS_COM_ATUALIZAR) {
    const codigo = semComentarios(fonteDe(caminho));

    for (const linha of codigo.split("\n")) {
      if (!linha.includes("aoTentarDeNovo=")) continue;
      assert.ok(
        linha.includes("aoTentarDeNovo={() =>"),
        `${rotulo}: ${caminho} passa o handler por REFERENCIA -- o ` +
          "`MouseEvent` do onClick vira `semCopia` e toda releitura fura o " +
          `cache:\n  ${linha.trim()}`
      );
    }
  }
});

test("nas sete, o botao da FAIXA pede a leitura sem a copia", () => {
  // DECISAO 1, e a assercao e ancorada no bloco da FAIXA de proposito. Uma
  // guarda que procurasse `(true)` no arquivo inteiro ficaria verde com o
  // `true` no painel de sem-rede e a faixa sem ele -- e a faixa e a unica das
  // tres que precisa dele, porque e a unica que aparece quando HA copia no
  // aparelho para o NetworkFirst servir de novo.
  for (const { rotulo, caminho, leitor } of TELAS_COM_ATUALIZAR) {
    const codigo = semComentarios(fonteDe(caminho));
    const faixa = blocoDaTag(codigo, "FaixaDadoDoAparelho");

    assert.ok(faixa, `${rotulo}: nao achei o bloco de <FaixaDadoDoAparelho`);
    assert.ok(
      faixa.includes(`aoTentarDeNovo={() => ${leitor}(true)}`),
      `${rotulo}: o "Atualizar" da faixa NAO fura o cache.\n` +
        `  esperado \`aoTentarDeNovo={() => ${leitor}(true)}\`\n` +
        `  sem o \`true\` a releitura volta da MESMA copia do NetworkFirst ` +
        "(sete dias), com a mesma faixa e o mesmo momento -- um botao que nao " +
        `muda nada.\n  achado:${faixa.split("\n").filter((l) => l.includes("aoTentarDeNovo")).join("")}`
    );
  }

  // E o `true` e SO da faixa. Nos dois paineis nao ha copia para furar --
  // `sem-rede` quer dizer que nao ha, e `erro-do-servidor` quer dizer que o
  // servidor respondeu (e resposta de erro nao vira copia) -- entao um `true`
  // ali seria fiacao que ninguem decidiu, escondida num arquivo que ja passou.
  for (const { rotulo, caminho, leitor } of TELAS_COM_ATUALIZAR) {
    const codigo = semComentarios(fonteDe(caminho));
    const comTrue = codigo
      .split("\n")
      .filter((l) => l.includes(`aoTentarDeNovo={() => ${leitor}(true)}`));
    assert.equal(
      comTrue.length,
      1,
      `${rotulo}: o \`(true)\` tem de estar em UM lugar so (a faixa), e esta ` +
        `em ${comTrue.length}:\n${comTrue.join("\n")}`
    );
  }
});

/**
 * Como o parametro chega na URL, por arquivo QUE LE.
 *
 * Nao e a lista das telas: as tres de cartoes e contas leem pelo
 * `useContas`, e as tres de movimentacao dividem um componente. A guarda segue
 * o arquivo onde o `fetch` mora, que e o unico lugar onde a regressao cabe.
 *
 * `comSemCopia` e a forma de agora, e ela existe pelo SEPARADOR: metade destas
 * URLs ja tem `?` e metade nao, e um `&` colado numa sem `?` nao produz
 * parametro nenhum -- produz outro caminho, que responde 404.
 *
 * As duas primeiras montam a querystring na mao e estao declaradas como
 * EXCECAO, com a forma exata: elas vieram antes do helper (HMO-401 e HMO-457) e
 * nas duas a URL tem `?` por construcao, entao o separador nunca foi escolha.
 * A declaracao e conferida como as outras -- se alguem reescrever aquela linha,
 * isto fica vermelho e a decisao volta para a mesa em vez de a tela passar a
 * nunca furar o cache calada.
 */
const COMO_FURA = [
  {
    caminho: "app/(dashboard)/dashboard/cash-flow/page.tsx",
    forma: "query.set(PARAM_SEM_COPIA, String(Date.now()))",
    porque:
      "a URL e montada com URLSearchParams, que ja resolve o separador sozinho",
  },
  {
    caminho: "components/movimentacoes/ListaDeMovimentacao.tsx",
    forma: "`&${PARAM_SEM_COPIA}=${Date.now()}`",
    porque:
      "a query desta tela SEMPRE tem `tipo=` antes, entao o `&` e correto por " +
      "construcao",
  },
  { caminho: "app/(dashboard)/dashboard/bills/page.tsx", forma: "comSemCopia(" },
  { caminho: "app/(dashboard)/dashboard/cartoes/page.tsx", forma: "comSemCopia(" },
  {
    caminho: "app/(dashboard)/dashboard/cartoes/[id]/page.tsx",
    forma: "comSemCopia(",
  },
  {
    caminho: "app/(dashboard)/dashboard/recurrences/page.tsx",
    forma: "comSemCopia(",
  },
  { caminho: "lib/hooks/useContas.ts", forma: "comSemCopia(" },
];

test("cada arquivo que le declara COMO o parametro entra na URL", () => {
  for (const { caminho, forma, porque } of COMO_FURA) {
    const codigo = semComentarios(fonteDe(caminho));
    assert.ok(
      codigo.includes(forma),
      `${caminho}: a forma declarada de furar o cache nao esta mais la ` +
        `(\`${forma}\`).\n` +
        (porque ? `  ela era excecao porque ${porque}.\n` : "") +
        "  se a tela passou a usar `comSemCopia`, atualize a declaracao -- e " +
        "se ela parou de furar, o botao Atualizar voltou a nao mudar nada."
    );
  }
});

test("um Atualizar que falha nao apaga o que esta na tela, nos sete", () => {
  // DECISAO 3, e e a que a HMO-477 teve de ler UMA A UMA: nao ha regra geral.
  //
  // Nas sete o `if (leitura.dados)` ja protegia as VARIAVEIS, e e por isso que
  // o defeito passava por consertado. Mas quem governa o que se VE e o
  // `estado`: com `sem-rede` o painel SUBSTITUI a lista, o total e o grafico. O
  // dado continuava na memoria, inalcancavel, e quem apertou "Atualizar"
  // perdia a tela que estava olhando -- sem como traze-la de volta senao
  // recarregando a pagina.
  //
  // O nome da leitura muda (em `bills` sao SEIS buscas, e quem manda e a
  // `agenda`), por isso ele e declarado em vez de procurado.
  const QUEM_GUARDA = [
    { caminho: "app/(dashboard)/dashboard/cash-flow/page.tsx", leitura: "leitura" },
    {
      caminho: "components/movimentacoes/ListaDeMovimentacao.tsx",
      leitura: "leitura",
    },
    { caminho: "app/(dashboard)/dashboard/bills/page.tsx", leitura: "agenda" },
    { caminho: "app/(dashboard)/dashboard/cartoes/page.tsx", leitura: "leitura" },
    {
      caminho: "app/(dashboard)/dashboard/cartoes/[id]/page.tsx",
      leitura: "leitura",
    },
    {
      caminho: "app/(dashboard)/dashboard/recurrences/page.tsx",
      leitura: "leitura",
    },
    { caminho: "lib/hooks/useContas.ts", leitura: "leitura" },
  ];

  for (const { caminho, leitura } of QUEM_GUARDA) {
    const codigo = semComentarios(fonteDe(caminho));

    assert.ok(
      codigo.includes(`if (semCopia && !${leitura}.dados)`),
      `${caminho}: perdeu a guarda do "Atualizar" que falha ` +
        `(\`if (semCopia && !${leitura}.dados)\`).\n` +
        "  sem ela, o clique que nao trouxe nada escreve `sem-rede` no " +
        "`estado` e o painel substitui o que a pessoa estava olhando."
    );

    // E a guarda tem de AVISAR. Calada, o clique fica indistinguivel de um
    // botao morto -- que e exatamente o defeito que a HMO-457 relatou.
    //
    // A ancora e a CHAMADA (`toast.error(AVISO_...`), e nao o nome solto: o
    // nome aparece tambem na linha de `import`, e com ele esta guarda ficaria
    // VERDE para um arquivo que importa a constante e nunca a usa -- que e
    // exatamente o estado em que o aviso desaparece da tela. Medido: o mutante
    // que apaga so a linha do `toast.error` sobrevivia a versao anterior
    // desta assercao.
    assert.ok(
      codigo.includes("toast.error(AVISO_ATUALIZAR_FALHOU"),
      `${caminho}: a guarda ficou CALADA -- sem o aviso, o clique que nao ` +
        "trouxe nada e indistinguivel de um botao que nao funciona."
    );

    // E o aviso leva o `id`: nas duas telas de cartoes um clique dispara DUAS
    // leituras, e sem ele sonner empilha dois avisos identicos para um gesto.
    assert.ok(
      codigo.includes("{ id: ID_DO_AVISO_ATUALIZAR }"),
      `${caminho}: o aviso perdeu o \`id\` -- nas telas de duas leituras um ` +
        "clique passa a empilhar dois avisos iguais."
    );
  }
});

test("o aviso do Atualizar tem UMA escrita, e um id para nao duplicar", () => {
  // As duas telas de cartoes fazem DUAS leituras (cadastro e fatura) e um
  // clique so pode ver as duas falharem. O `id` igual faz sonner ATUALIZAR o
  // aviso em vez de empilhar dois identicos para um gesto unico.
  assert.equal(typeof ID_DO_AVISO_ATUALIZAR, "string");
  assert.ok(ID_DO_AVISO_ATUALIZAR.length > 0);
  assert.match(AVISO_ATUALIZAR_FALHOU, /Não deu para atualizar agora/);
  assert.match(AVISO_ATUALIZAR_FALHOU, /continuam sendo os do aparelho/);

  // E ninguem reescreve a frase a mao. Duas escritas da mesma frase divergem na
  // primeira revisao, e a que divergir sera a da tela que menos se abre.
  for (const { caminho } of COMO_FURA) {
    const codigo = semComentarios(fonteDe(caminho));
    assert.ok(
      !codigo.includes(`"${AVISO_ATUALIZAR_FALHOU}"`),
      `${caminho} escreve a frase do aviso a mao em vez de importar ` +
        "`AVISO_ATUALIZAR_FALHOU` -- duas escritas divergem, e o `id` " +
        "compartilhado para de colapsar os dois avisos num."
    );
  }
});

// -------------------------------------------------------------------------
// O SEPARADOR, QUE E A RAZAO DE `comSemCopia` EXISTIR
// -------------------------------------------------------------------------

test("comSemCopia nao mexe na URL quando nao pediram", () => {
  // A metade que impede o conserto de virar outro defeito: um parametro que
  // fosse junto em toda carga apagaria a leitura offline das telas mais
  // pesadas -- que e exatamente onde ela serve. E a condicao 2 do JSDoc.
  for (const url of [
    "/api/recurrences",
    "/api/card-invoices?month=2026-10",
    "/api/financial-accounts?include_inactive=1",
  ]) {
    assert.equal(comSemCopia(url, false), url);
    assert.ok(!comSemCopia(url, false).includes(PARAM_SEM_COPIA));
  }
});

test("comSemCopia escolhe ? ou & olhando a URL -- as 8 rotas de verdade", () => {
  // A tabela e das URLs REAIS das sete telas, e nao de exemplos: e o caso
  // `/api/recurrences` (sem `?`) que o helper existe para nao errar. Um `&`
  // colado nela daria `/api/recurrences&semCopia=1`, que nao e um parametro --
  // e outro CAMINHO, e a rota responde 404. A tela cairia no painel de erro e
  // o relato seria "sem rede" num aparelho com rede.
  const CASOS = [
    // Sem querystring: tem de ganhar `?`.
    ["/api/recurrences", "/api/recurrences?semCopia=777"],
    ["/api/recurring-rules", "/api/recurring-rules?semCopia=777"],
    [
      "/api/personal-finance/categories",
      "/api/personal-finance/categories?semCopia=777",
    ],
    ["/api/financial-accounts", "/api/financial-accounts?semCopia=777"],
    ["/api/expense-groups", "/api/expense-groups?semCopia=777"],
    // Com querystring: tem de ganhar `&`.
    [
      "/api/recurrences?status=all",
      "/api/recurrences?status=all&semCopia=777",
    ],
    [
      "/api/scheduled-transactions?status=open",
      "/api/scheduled-transactions?status=open&semCopia=777",
    ],
    [
      "/api/scheduled-transactions/summary?months=1",
      "/api/scheduled-transactions/summary?months=1&semCopia=777",
    ],
    [
      "/api/financial-accounts?include_inactive=1",
      "/api/financial-accounts?include_inactive=1&semCopia=777",
    ],
    [
      "/api/card-invoices?month=2026-10",
      "/api/card-invoices?month=2026-10&semCopia=777",
    ],
    [
      "/api/card-invoices?account_id=abc&month=2026-10",
      "/api/card-invoices?account_id=abc&month=2026-10&semCopia=777",
    ],
  ];

  for (const [url, esperado] of CASOS) {
    assert.equal(comSemCopia(url, true, 777), esperado, `separador errado em ${url}`);
  }
});

test("a URL furada continua sendo LIDA do mesmo jeito pela rota", () => {
  // A prova de que o desvio e do service worker e nao chega como regra no
  // servidor (condicao 1 do JSDoc). `URLSearchParams` aqui faz o papel do
  // `params.get` das oito rotas: o que elas leem nao pode mudar.
  const antes = new URL("http://x/api/card-invoices?account_id=abc&month=2026-10");
  const depois = new URL(
    `http://x${comSemCopia("/api/card-invoices?account_id=abc&month=2026-10", true, 777)}`
  );

  assert.equal(depois.pathname, antes.pathname, "o CAMINHO mudou");
  for (const chave of ["account_id", "month"]) {
    assert.equal(
      depois.searchParams.get(chave),
      antes.searchParams.get(chave),
      `a rota passaria a ler outro \`${chave}\``
    );
  }
  assert.equal(depois.searchParams.get(PARAM_SEM_COPIA), "777");

  // E o caso que mais importa: sem `?`, o parametro entra como PARAMETRO e nao
  // como parte do caminho.
  const semQuery = new URL(`http://x${comSemCopia("/api/recurrences", true, 777)}`);
  assert.equal(semQuery.pathname, "/api/recurrences");
  assert.equal(semQuery.searchParams.get(PARAM_SEM_COPIA), "777");
});

test("a chave do cache MUDA entre dois cliques", () => {
  // O parametro existe para trocar a chave do Cache Storage. Dois cliques com o
  // mesmo valor cairiam na copia que o PRIMEIRO acabou de guardar, e o segundo
  // "Atualizar" voltaria a nao mudar nada.
  assert.notEqual(
    comSemCopia("/api/recurrences", true, 1),
    comSemCopia("/api/recurrences", true, 2)
  );
});

test("e o valor PADRAO e o relogio, nao uma constante", () => {
  // ESTE CASO NASCEU DE UM MUTANTE SOBREVIVENTE (HMO-477).
  //
  // O caso acima passa `agora` a mao, nos dois lados -- e por isso ele ficava
  // VERDE com o padrao trocado por `agora: number = 0`. Mas quem chama em
  // producao nao passa `agora`: as sete telas chamam `comSemCopia(url,
  // semCopia)` e dependem do padrao. Com uma constante ali, TODO clique monta a
  // mesma URL, o segundo "Atualizar" cai na copia que o primeiro acabou de
  // guardar, e o botao volta a nao mudar nada -- o defeito da issue, de volta,
  // por uma linha que nenhuma assercao olhava.
  //
  // O relogio e congelado (`mock.timers`) e nao lido duas vezes: dois
  // `Date.now()` seguidos cabem no MESMO milissegundo, e um `notEqual` entre
  // eles seria um teste que falha as vezes. Ver o relato de
  // "relogio congelado em teste node".
  mock.timers.enable({ apis: ["Date"], now: 1_700_000_000_000 });
  try {
    assert.equal(
      comSemCopia("/api/recurrences", true),
      `/api/recurrences?${PARAM_SEM_COPIA}=1700000000000`,
      "o padrao de `agora` nao e o relogio -- a chave do cache ficou fixa"
    );

    // E ele ANDA: a mesma chamada, um segundo depois, pede outra chave.
    mock.timers.tick(1000);
    assert.equal(
      comSemCopia("/api/recurrences", true),
      `/api/recurrences?${PARAM_SEM_COPIA}=1700000001000`
    );
  } finally {
    mock.timers.reset();
  }
});
