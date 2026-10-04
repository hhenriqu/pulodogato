#!/usr/bin/env node
// =====================================================
// PULODOGATO - o nome de quem pagou, na linha da parte de grupo (HMO-274)
// =====================================================
//   npm run test:pagador-da-parte
//
// A linha da minha parte de uma despesa de grupo ja dizia o grupo, a categoria,
// a data, a minha parte e o valor cheio. Faltava a PESSOA:
//
//   "R$ 200,00 · Minha parte · Lazer · 18/09 · Praia · de R$ 400,00"
//
// Quem le isso sabe quanto deve e nao sabe A QUEM -- que e exatamente o que
// falta para transferir o dinheiro. Pior: uma linha de despesa sem nenhuma
// mencao a outra pessoa se le como despesa PROPRIA, e e por isso que o selo
// novo e incondicional.
//
// POR QUE ESTE TESTE RENDERIZA O COMPONENTE
// -----------------------------------------
// `pagadorNaLinha` e `nomesDosPagadores` tem teste de funcao pura aqui embaixo,
// e eles passariam verde com o JSX nao desenhando selo nenhum: a decisao estaria
// certa e a tela ignorando ela. Por isso o `react-dom/server` renderiza
// `components/movimentacoes/LinhaDaParteDeGrupo.tsx` -- o MESMO arquivo que a
// pagina importa -- e as assercoes sao sobre o HTML que sai.
//
// AS DUAS ARMADILHAS QUE ESTE ARQUIVO EXISTE PARA NAO CAIR
// --------------------------------------------------------
// 1. AFIRMAR SOBRE A PRESENCA DA PALAVRA. `html.includes("Ana Souza")` passa
//    quando o GRUPO se chama Ana Souza e o selo de pagador nem existe. Toda
//    assercao daqui e sobre o CONTEUDO do elemento de pagador, e ha um controle
//    negativo explicito que prova a diferenca (`o nome do grupo nao conta como
//    nome de pagador`).
//
// 2. O PERFIL QUE A RLS ESCONDE. Participar do mesmo grupo NAO da acesso ao
//    perfil do outro -- as policies de SELECT de `profiles` sao `id =
//    auth.uid()`, `is_public = TRUE` (002) e "conexao aceita" (010), e nenhuma
//    olha `group_members`. O PostgREST nao levanta erro nesse caso: a linha
//    simplesmente nao vem. Entao o caminho sem nome e NORMAL, e ele tem que
//    sair com rotulo escrito -- nao com um selo em branco, nem sem selo.
//    Os testes abaixo distinguem os tres estados: nome, rotulo de fallback, e
//    ausencia de selo (que nenhuma entrada produz).
//
// A prova de que as assercoes nao sao vacuas esta em
// `scripts/mutantes-pagador-da-parte.mjs`.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { LinhaDaParteDeGrupo } = await import(
  "../.tmp-pagador-da-parte/components/movimentacoes/LinhaDaParteDeGrupo.js"
);

const {
  PAGADOR_SEM_NOME,
  nomesDosPagadores,
  pagadorNaLinha,
  partesDeTerceirosNaLista,
} = await import("../.tmp-pagador-da-parte/lib/parte-de-grupo-na-lista.js");

// -----------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------

const GRUPO = "g-praia";
const ANA = "u-ana";
const DESPESA = "t-hotel";

/** Uma parte de terceiro ja montada, do jeito que a lista recebe. */
const parte = (over = {}) => ({
  id: "parte:p1",
  transactionId: DESPESA,
  groupId: GRUPO,
  description: "Hotel em Paraty",
  amount: -200,
  totalDaDespesa: -400,
  transactionDate: "2026-09-18",
  categoria: { id: "c1", name: "Lazer", color_hex: "#5566aa" },
  splitStatus: "approved",
  currency: "BRL",
  pagadorId: ANA,
  pagador: "Ana Souza",
  ...over,
});

function renderizar(over = {}, grupos = { [GRUPO]: "Praia" }) {
  return renderToStaticMarkup(
    h(LinhaDaParteDeGrupo, { parte: parte(over), nomeDoGrupo: grupos })
  );
}

/**
 * O selo de pagador que saiu no HTML, ou `null` se nao saiu NENHUM.
 *
 * Devolve `marca` e `texto` separados porque e disso que depende distinguir os
 * tres estados. Um teste que so olhasse o texto nao separaria "o nome e
 * literalmente 'outro membro do grupo'" de "o perfil nao veio"; um que so
 * olhasse a marca passaria verde com o texto em branco ao lado.
 *
 * O `[^<]*` no conteudo e deliberado: se alguem embrulhar o texto em outro
 * elemento, isto devolve `null` e o teste reprova alto, em vez de casar com um
 * pedaco e medir metade do selo.
 */
function seloDoPagador(html) {
  const achado = html.match(
    /<span data-pagador="([^"]*)"([^>]*)>([^<]*)<\/span>/
  );
  if (!achado) return null;
  return { marca: achado[1], atributos: achado[2], texto: achado[3] };
}

// =====================================================
// O NOME NA LINHA
// =====================================================

test("o nome de quem pagou sai DENTRO do selo de pagador", () => {
  const selo = seloDoPagador(renderizar());
  assert.ok(selo, "a linha nao desenhou selo de pagador nenhum");
  assert.equal(selo.texto, "Pago por Ana Souza");
  assert.equal(selo.marca, "nome");
});

test("o selo acompanha o nome, e nao e um texto fixo", () => {
  // Sem esta, um selo que escrevesse "Pago por Ana Souza" cravado no JSX
  // passaria no teste de cima. A sonda tem que reagir ao dado.
  const selo = seloDoPagador(renderizar({ pagador: "Bia Lima" }));
  assert.equal(selo.texto, "Pago por Bia Lima");
});

test("o nome do grupo NAO conta como nome de pagador (controle negativo)", () => {
  // O grupo se chama "Ana Souza" e o perfil de quem pagou nao veio. Uma
  // assercao por presenca da palavra -- `html.includes("Ana Souza")` -- passa
  // aqui, porque o selo do GRUPO tem esse texto. A assercao sobre o conteudo do
  // elemento de pagador reprova, que e o ponto.
  const html = renderizar({ pagador: null }, { [GRUPO]: "Ana Souza" });

  assert.ok(
    html.includes("Ana Souza"),
    "o controle so vale se a palavra estiver no HTML por outro motivo"
  );

  const selo = seloDoPagador(html);
  assert.ok(selo);
  assert.equal(selo.texto, `Pago por ${PAGADOR_SEM_NOME}`);
  assert.notEqual(selo.texto, "Pago por Ana Souza");
});

// =====================================================
// O PERFIL QUE A RLS ESCONDE
// =====================================================

test("perfil invisivel pela RLS sai com ROTULO, nao com espaco em branco", () => {
  const selo = seloDoPagador(renderizar({ pagador: null }));

  assert.ok(selo, "sem o selo a linha se le como despesa propria");
  assert.equal(selo.marca, "sem-nome");
  assert.equal(selo.texto, `Pago por ${PAGADOR_SEM_NOME}`);
  // A negacao que importa: o defeito a evitar e o selo vazio.
  assert.notEqual(selo.texto.trim(), "");
  assert.notEqual(selo.texto, "Pago por ");
});

test("o caso sem nome e DISTINGUIVEL do caso com nome no HTML", () => {
  // Os tres estados possiveis de uma linha, e os tres tem que ser diferentes
  // entre si no HTML: nome, rotulo de fallback, e selo ausente (que nenhuma
  // entrada produz -- e isso que as duas primeiras assercoes cobram).
  const comNome = seloDoPagador(renderizar({ pagador: "Ana Souza" }));
  const semNome = seloDoPagador(renderizar({ pagador: null }));

  assert.ok(comNome && semNome, "as duas linhas tem que ter selo");
  assert.notEqual(comNome.marca, semNome.marca);
  assert.notEqual(comNome.texto, semNome.texto);
});

test("so o caso sem nome explica por que, e so ele", () => {
  // O `title` e o unico lugar que diz "o perfil nao esta visivel". Ele nao
  // substitui o texto (texto invisivel nao e rotulo), mas sem ele a pessoa fica
  // sem saber se o app nao sabe o nome ou se esqueceu de mostrar.
  assert.match(
    seloDoPagador(renderizar({ pagador: null })).atributos,
    /title="[^"]*perfil de quem pagou[^"]*"/
  );
  assert.doesNotMatch(
    seloDoPagador(renderizar({ pagador: "Ana Souza" })).atributos,
    /title=/
  );
});

test("nome de espacos em branco cai no rotulo, e a marca nao mente", () => {
  // `full_name` nao tem NOT NULL nem CHECK de tamanho em `profiles` (001), e
  // `"   "` e verdadeiro em JavaScript. Se a marca fosse calculada a parte
  // (`parte.pagador ? "nome" : "sem-nome"`), ela diria "nome" sobre um selo
  // escrito "Pago por " -- e um teste que leia a marca passaria verde.
  const selo = seloDoPagador(renderizar({ pagador: "   " }));
  assert.equal(selo.texto, `Pago por ${PAGADOR_SEM_NOME}`);
  assert.equal(selo.marca, "sem-nome");
});

// =====================================================
// O SELO E INCONDICIONAL
// =====================================================

test("o selo sai tambem na linha de rateio a aprovar", () => {
  // O ramo do `pending` desenha mais dois nos irmaos do selo de pagador. Se o
  // selo novo tivesse entrado dentro daquele ramo, a linha aprovada ficaria sem
  // nome -- e ela e a maioria das linhas.
  for (const splitStatus of ["approved", "pending"]) {
    const selo = seloDoPagador(renderizar({ splitStatus }));
    assert.ok(selo, `linha com splitStatus=${splitStatus} ficou sem selo`);
    assert.equal(selo.texto, "Pago por Ana Souza");
  }
  assert.match(renderizar({ splitStatus: "pending" }), /a aprovar/);
});

test("o selo sai mesmo quando o grupo nao veio e quando nao ha categoria", () => {
  // Os dois unicos pedacos opcionais da fileira de selos. Nenhum deles pode
  // levar o pagador embora.
  const semGrupo = seloDoPagador(renderizar({}, {}));
  const semCategoria = seloDoPagador(renderizar({ categoria: null }));
  assert.equal(semGrupo?.texto, "Pago por Ana Souza");
  assert.equal(semCategoria?.texto, "Pago por Ana Souza");
});

// =====================================================
// pagadorNaLinha
// =====================================================

test("pagadorNaLinha nunca devolve texto vazio", () => {
  for (const entrada of [null, undefined, "", "   ", "\t\n"]) {
    const { texto, temNome } = pagadorNaLinha(entrada ?? null);
    assert.notEqual(texto.trim(), "", `texto vazio para ${JSON.stringify(entrada)}`);
    assert.equal(temNome, false);
    assert.equal(texto, `Pago por ${PAGADOR_SEM_NOME}`);
  }
});

test("pagadorNaLinha usa o nome quando ha nome, aparado", () => {
  assert.deepEqual(pagadorNaLinha("Ana Souza"), {
    texto: "Pago por Ana Souza",
    temNome: true,
  });
  assert.deepEqual(pagadorNaLinha("  Ana Souza  "), {
    texto: "Pago por Ana Souza",
    temNome: true,
  });
});

// =====================================================
// nomesDosPagadores
// =====================================================

test("o mapa sai do full_name", () => {
  const nomes = nomesDosPagadores([{ id: ANA, full_name: "Ana Souza" }]);
  assert.equal(nomes.get(ANA), "Ana Souza");
});

test("perfil que a RLS nao devolveu simplesmente nao entra no mapa", () => {
  // O caminho real do fallback: o PostgREST devolve MENOS linhas, sem erro.
  const nomes = nomesDosPagadores([]);
  assert.equal(nomes.get(ANA), undefined);
  assert.equal(nomes.size, 0);
});

test("full_name nulo ou em branco nao vira nome", () => {
  for (const ruim of [null, undefined, "", "   "]) {
    const nomes = nomesDosPagadores([{ id: ANA, full_name: ruim }]);
    assert.equal(
      nomes.get(ANA),
      undefined,
      `full_name=${JSON.stringify(ruim)} entrou no mapa`
    );
  }
});

test("quem preencheu so o apelido tem nome a mostrar", () => {
  const nomes = nomesDosPagadores([
    { id: ANA, full_name: "   ", nickname: "ana.s" },
  ]);
  assert.equal(nomes.get(ANA), "ana.s");
});

test("full_name vence o apelido", () => {
  const nomes = nomesDosPagadores([
    { id: ANA, full_name: "Ana Souza", nickname: "ana.s" },
  ]);
  assert.equal(nomes.get(ANA), "Ana Souza");
});

test("perfil sem id nao derruba o mapa nem entra nele", () => {
  const nomes = nomesDosPagadores([
    { full_name: "Fantasma" },
    { id: ANA, full_name: "Ana Souza" },
  ]);
  assert.equal(nomes.size, 1);
  assert.equal(nomes.get(ANA), "Ana Souza");
});

// =====================================================
// A LIGACAO: partesDeTerceirosNaLista
// =====================================================

const parteBruta = {
  id: "p1",
  transaction_id: DESPESA,
  group_id: GRUPO,
  transaction_date: "2026-09-18",
  category_id: "c1",
  transaction_type: "expense",
  currency: "BRL",
  amount: 200,
  split_status: "approved",
  paguei_eu: false,
};

const despesaLida = {
  id: DESPESA,
  user_id: ANA,
  description: "Hotel em Paraty",
  amount: -400,
  category: { id: "c1", name: "Lazer" },
};

test("a linha carrega quem pagou, por id e por nome", () => {
  const { linhas } = partesDeTerceirosNaLista(
    [parteBruta],
    new Map([[DESPESA, despesaLida]]),
    new Map([[ANA, "Ana Souza"]])
  );
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].pagadorId, ANA);
  assert.equal(linhas[0].pagador, "Ana Souza");
});

test("sem o nome a linha CONTINUA na lista -- e so o nome que falta", () => {
  // Diferente da descricao, que descarta a linha: o valor e a despesa ainda
  // respondem a pergunta que trouxe a pessoa para a tela. Descartar aqui
  // esconderia dinheiro devido por causa de um perfil fechado.
  const { linhas, semDescricao } = partesDeTerceirosNaLista(
    [parteBruta],
    new Map([[DESPESA, despesaLida]]),
    new Map()
  );
  assert.equal(linhas.length, 1);
  assert.equal(semDescricao, 0);
  assert.equal(linhas[0].pagador, null);
  // `null` e nao `undefined`: o campo tem que ter um valor que o selo saiba
  // tratar, e `undefined` passa por todo `||` sem ninguem notar.
  assert.strictEqual(linhas[0].pagador, null);
  assert.equal(linhas[0].pagadorId, ANA);
});

test("a parte sem a DESPESA continua sendo descartada", () => {
  // Controle do contrario: a regra antiga nao afrouxou com a chegada do nome.
  const { linhas, semDescricao } = partesDeTerceirosNaLista(
    [parteBruta],
    new Map(),
    new Map([[ANA, "Ana Souza"]])
  );
  assert.equal(linhas.length, 0);
  assert.equal(semDescricao, 1);
});

test("a ponta a ponta: nome do mapa de perfis chega ao HTML da linha", () => {
  // As duas metades juntas, do jeito que a pagina as usa: perfis -> mapa ->
  // linha -> HTML. E o unico teste daqui que falharia se a fiacao do `pagador`
  // fosse cortada no meio do caminho.
  const nomes = nomesDosPagadores([{ id: ANA, full_name: "Ana Souza" }]);
  const { linhas } = partesDeTerceirosNaLista(
    [parteBruta],
    new Map([[DESPESA, despesaLida]]),
    nomes
  );
  const html = renderToStaticMarkup(
    h(LinhaDaParteDeGrupo, {
      parte: linhas[0],
      nomeDoGrupo: { [GRUPO]: "Praia" },
    })
  );
  assert.equal(seloDoPagador(html).texto, "Pago por Ana Souza");
});
