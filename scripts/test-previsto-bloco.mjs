#!/usr/bin/env node
// =====================================================
// PULODOGATO - o BLOCO de previsto x realizado (HMO-186)
// =====================================================
//   npm run test:previsto-bloco
//
// POR QUE ESTE TESTE RENDERIZA O COMPONENTE
// -----------------------------------------
// `compararPrevistoRealizado` ja tem suite propria (test-previsto-x-realizado),
// e ela passaria verde com o JSX trocando as colunas de lugar: a aritmetica
// estaria certa e a tela ignorando ela. Um bloco que imprime o previsto na
// coluna "Realizado" nao quebra build, nao quebra teste puro e nao fica vazio --
// ele mostra os dois numeros certos nos lugares errados, e a unica coisa que
// denuncia isso e ler o HTML.
//
// Aqui o `react-dom/server` renderiza o mesmo arquivo que o app importa, e o
// teste afirma sobre o HTML que sai.
//
// OS TRES ESTADOS QUE O BLOCO TEM
// -------------------------------
//   1. comparacao -- a agenda tem linhas, as tres filas aparecem;
//   2. `semPrevisao` -- a agenda do periodo esta vazia. NAO pode imprimir
//      "R$ 0,00" na coluna do previsto: zero contra R$ 4.000 realizados se le
//      como "R$ 4.000 acima do previsto", e o que houve foi ausencia de
//      previsao;
//   3. `indisponivel` -- a rota nao soube dizer a direcao das linhas. Tambem nao
//      pode imprimir numero: o previsto sairia com todo salario do lado das
//      despesas.
//
// Os estados 2 e 3 sao os que um teste puro nao alcanca de jeito nenhum: o que
// se afirma deles e que o numero NAO aparece, e "nao aparece" e uma propriedade
// da marcacao.
//
// O QUE ELE NAO COBRE
// -------------------
// Largura de barra e cor. As barras saem em `style={{ width }}` a partir das
// proporcoes, que tem assercao na suite pura; a cor sai de classe de token, que
// tem guarda propria (check-color-tokens). O que este teste cobre e QUAL numero
// aparece em QUAL coluna, e o que nao aparece.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PrevistoXRealizado } from "../.tmp-previsto-bloco/components/dashboard/PrevistoXRealizado.js";

const PREVISTO = {
  entradas: 5000,
  despesas: 3000,
  resultado: 2000,
  quantidade: 6,
};

const REALIZADO = { entradas: 4800, despesas: 4200, resultado: 600 };

const render = (props) =>
  renderToStaticMarkup(
    h(PrevistoXRealizado, { rotulo: "setembro de 2026", ...props })
  );

/**
 * O HTML sem tag nenhuma, com os espacos normalizados.
 *
 * Necessario porque os valores nascem partidos por elemento: o rotulo "Previsto"
 * do celular e um <span> irmao do numero, e procurar "Previsto R$ 5.000,00" no
 * HTML cru nao acha nada -- ha uma tag entre os dois.
 */
const texto = (html) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;| /g, " ")
    .replace(/&#x27;|&quot;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

// ---------------------------------------------------------------------------
// 1. A comparacao
// ---------------------------------------------------------------------------

test("as tres filas aparecem, com os rotulos da issue", () => {
  const t = texto(render({ previsto: PREVISTO, realizado: REALIZADO }));

  for (const rotulo of ["Entradas", "Despesas", "Resultado"]) {
    assert.ok(t.includes(rotulo), `falta a fila "${rotulo}"`);
  }
  // "o previsto de entradas e o previsto de despesas, e o resultado final
  // previsto": as tres colunas tem que estar nomeadas na tela.
  for (const coluna of ["Previsto", "Realizado", "Diferença"]) {
    assert.ok(t.includes(coluna), `falta a coluna "${coluna}"`);
  }
});

test("o cabecalho do desktop esta na ordem das celulas", () => {
  // As duas versoes do bloco nomeiam as colunas de formas diferentes: no celular
  // cada celula carrega o proprio rotulo, no desktop existe UMA fila de
  // cabecalho e as celulas sao anonimas. Entao trocar a ordem do cabecalho e um
  // defeito que so existe no desktop -- e que as assercoes de "Previsto R$ ..."
  // deste arquivo nao pegam, porque elas leem o rotulo do celular.
  //
  // O que se afirma e a ORDEM no HTML, e nao a presenca: cabecalho
  // Realizado/Previsto sobre celulas Previsto/Realizado imprime os dois numeros
  // debaixo do nome do outro, sem faltar nada na tela.
  // A fatia comeca no rotulo `sr-only` da primeira coluna, nao no inicio do
  // HTML: o TITULO do cartao e "Previsto x Realizado", e uma fatia que o inclua
  // acha as duas palavras sempre nessa ordem -- entao a assercao passaria verde
  // com o cabecalho da grade invertido. Foi o que aconteceu na primeira versao
  // deste teste, e o mutante sobreviveu.
  const html = render({ previsto: PREVISTO, realizado: REALIZADO });
  const inicio = html.indexOf("Linha");
  assert.ok(inicio !== -1, "a fila de cabecalho da grade nao existe");
  const cabecalho = html.slice(inicio, html.indexOf("Entradas"));

  const posicoes = ["Previsto", "Realizado", "Diferença"].map((c) =>
    cabecalho.indexOf(c)
  );

  for (const [i, pos] of posicoes.entries()) {
    assert.ok(pos !== -1, `coluna ${i} nao esta no cabecalho`);
  }
  assert.deepEqual(
    [...posicoes].sort((a, b) => a - b),
    posicoes,
    "o cabecalho do desktop nao esta na ordem Previsto, Realizado, Diferença"
  );
});

test("cada numero sai na coluna dele", () => {
  const t = texto(render({ previsto: PREVISTO, realizado: REALIZADO }));

  // O rotulo da coluna precede o valor na versao de celular, e e essa
  // vizinhanca que prova a posicao. Trocar as duas colunas no JSX deixaria os
  // seis numeros na tela e reprovaria aqui.
  assert.ok(
    t.includes("Previsto R$ 5.000,00"),
    "entradas previstas fora da coluna Previsto"
  );
  assert.ok(
    t.includes("Realizado R$ 4.800,00"),
    "entradas realizadas fora da coluna Realizado"
  );
  assert.ok(
    t.includes("Previsto R$ 3.000,00"),
    "despesas previstas fora da coluna Previsto"
  );
  assert.ok(
    t.includes("Realizado R$ 4.200,00"),
    "despesas realizadas fora da coluna Realizado"
  );
  assert.ok(
    t.includes("Previsto R$ 2.000,00"),
    "resultado previsto fora da coluna Previsto"
  );
  assert.ok(
    t.includes("Realizado R$ 600,00"),
    "resultado realizado fora da coluna Realizado"
  );
});

test("a diferenca sai com sinal, e o sinal segue realizado - previsto", () => {
  const t = texto(render({ previsto: PREVISTO, realizado: REALIZADO }));

  // Entrou R$ 200 menos que o previsto, saiu R$ 1.200 mais, e o resultado ficou
  // R$ 1.400 abaixo. O "−" e o sinal tipografico (U+2212), nao hifen.
  assert.ok(t.includes("− R$ 200,00"), "falta a diferenca de entradas");
  assert.ok(t.includes("+ R$ 1.200,00"), "falta a diferenca de despesas");
  assert.ok(t.includes("− R$ 1.400,00"), "falta a diferenca de resultado");
});

test("diferenca zero vira palavra, nao '+ R$ 0,00'", () => {
  const igual = { entradas: 5000, despesas: 3000, resultado: 2000 };
  const t = texto(
    render({ previsto: { ...igual, quantidade: 4 }, realizado: igual })
  );

  assert.ok(t.includes("Igual ao previsto"));
  assert.ok(!t.includes("R$ 0,00"), "imprimiu zero em vez da palavra");
});

test("a cor da diferenca inverte entre entrada e despesa", () => {
  // A mesma direcao numerica ("veio mais do que o previsto") e boa em entradas e
  // ruim em despesas. Sem a inversao, gastar acima do previsto apareceria em
  // verde -- um erro que so se ve olhando, porque o numero esta certo.
  const html = render({
    previsto: { entradas: 100, despesas: 100, resultado: 0, quantidade: 2 },
    realizado: { entradas: 200, despesas: 200, resultado: 0 },
  });

  // As duas filas tem diferenca +R$ 100: a de entradas tem que sair no token de
  // sucesso e a de despesas no de destrutivo.
  const filas = html.split("Entradas")[1] ?? "";
  const entradas = filas.split("Despesas")[0] ?? "";
  const despesas = filas.split("Despesas")[1] ?? "";

  assert.ok(
    entradas.includes("text-success"),
    "entrada acima do previsto nao saiu no token de sucesso"
  );
  assert.ok(
    despesas.includes("text-destructive"),
    "despesa acima do previsto nao saiu no token de destrutivo"
  );
});

test("a nota explica que o previsto e a agenda, e diz sobre quantas linhas", () => {
  // Sem esta nota a diferenca em despesas se le como estouro de orcamento,
  // quando na maioria dos meses ela mede so o gasto que ninguem agenda.
  const t = texto(render({ previsto: PREVISTO, realizado: REALIZADO }));

  // A frase inteira, e nao so a palavra "agenda": o botao no pe do cartao diz
  // "Ver a agenda do período", entao procurar a palavra solta passa verde com a
  // nota REMOVIDA -- e a nota e a unica coisa que impede ler a diferenca em
  // despesas como estouro de plano.
  assert.ok(
    t.includes("O previsto vem da agenda"),
    "a nota nao diz de onde vem o previsto"
  );
  assert.ok(
    t.includes("não está na agenda"),
    "a nota nao avisa que o gasto avulso aparece so no realizado"
  );
  assert.ok(
    t.includes("6 contas e receitas"),
    "a nota nao diz sobre quantas linhas o previsto foi feito"
  );
});

test("a nota concorda no singular com uma linha so", () => {
  const t = texto(
    render({
      previsto: { entradas: 0, despesas: 1200, resultado: -1200, quantidade: 1 },
      realizado: REALIZADO,
    })
  );

  assert.ok(t.includes("1 conta ou receita"), "plural com uma linha so");
});

test("o periodo aparece nos TRES estados do bloco", () => {
  // O painel inteiro tem eixo de tempo desde a HMO-173. Um bloco sem o rotulo do
  // periodo e um bloco cujo numero pode ser de qualquer mes.
  //
  // Os tres estados, e nao so o da comparacao: na comparacao a nota de rodape
  // tambem menciona o periodo ("com vencimento em setembro de 2026"), entao
  // afirmar so ali passa verde com o CardDescription REMOVIDO. Nos outros dois
  // estados a nota nao existe, e o cabecalho e o unico lugar onde o periodo
  // pode aparecer -- que e justamente quando o usuario mais precisa dele, porque
  // nao ha numero nenhum na tela para ancorar o mes.
  const estados = [
    ["comparacao", { previsto: PREVISTO, realizado: REALIZADO }],
    ["sem previsao", { previsto: VAZIO, realizado: REALIZADO }],
    [
      "indisponivel",
      { previsto: PREVISTO, realizado: REALIZADO, indisponivel: true },
    ],
  ];

  for (const [nome, props] of estados) {
    assert.ok(
      texto(render(props)).includes("setembro de 2026"),
      `o estado "${nome}" nao diz de que periodo fala`
    );
  }
});

// ---------------------------------------------------------------------------
// 2. semPrevisao: a agenda vazia
// ---------------------------------------------------------------------------

const VAZIO = { entradas: 0, despesas: 0, resultado: 0, quantidade: 0 };

test("agenda vazia NAO imprime a comparacao", () => {
  const t = texto(
    render({
      previsto: VAZIO,
      realizado: { entradas: 6000, despesas: 2000, resultado: 4000 },
    })
  );

  // Nenhuma das tres filas, e nenhuma coluna: a grade inteira fica de fora.
  assert.ok(!t.includes("Diferença"), "manteve a coluna de diferenca");
  assert.ok(
    !t.includes("Previsto R$ 0,00"),
    "imprimiu zero como se fosse previsao"
  );
  assert.ok(
    t.includes("Não havia nada previsto"),
    "nao explicou a ausencia de previsao"
  );
});

test("agenda vazia mostra o realizado e diz que nao ha com que comparar", () => {
  const t = texto(
    render({
      previsto: VAZIO,
      realizado: { entradas: 6000, despesas: 2000, resultado: 4000 },
    })
  );

  // O numero do realizado aparece -- ele existe e e verdadeiro. O que nao
  // aparece e uma diferenca contra zero.
  assert.ok(t.includes("R$ 4.000,00"), "escondeu o realizado tambem");
  assert.ok(t.includes("comparar"), "nao disse que falta a previsao");
});

test("agenda vazia oferece o caminho de volta", () => {
  // Bloco vazio sem acao e indistinguivel de bloco quebrado -- a mesma decisao
  // que o painel ja tomou no aviso de "escondeu tudo".
  const html = render({
    previsto: VAZIO,
    realizado: { entradas: 0, despesas: 0, resultado: 0 },
  });

  assert.ok(
    html.includes('href="/dashboard/recurrences"'),
    "nao ofereceu onde cadastrar o que e fixo"
  );
});

// ---------------------------------------------------------------------------
// 3. indisponivel: a direcao que a rota nao soube ler
// ---------------------------------------------------------------------------

test("sem a direcao das linhas, o bloco nao imprime numero nenhum", () => {
  // O modo de falha que isto impede: toda linha da agenda tratada como despesa,
  // o previsto de entradas em zero e o resultado previsto negativo no valor do
  // salario. Numero plausivel, conta que ninguem fez.
  const t = texto(
    render({
      previsto: { entradas: 0, despesas: 8000, resultado: -8000, quantidade: 9 },
      realizado: REALIZADO,
    indisponivel: true,
    })
  );

  assert.ok(!t.includes("R$"), `imprimiu valor: ${t}`);
  assert.ok(
    t.includes("entrada ou saída"),
    "nao explicou o que faltou para calcular"
  );
});

test("indisponivel nao cala os outros blocos do painel", () => {
  // A rota devolve o resto do resumo normalmente, e o bloco diz isso: quem le a
  // mensagem precisa saber que "Entrou"/"Saiu" continuam validos.
  const t = texto(
    render({ previsto: PREVISTO, realizado: REALIZADO, indisponivel: true })
  );

  assert.ok(t.includes("realizado"), "nao apontou para onde o realizado esta");
});

test("indisponivel vence semPrevisao", () => {
  // Com a direcao indisponivel a rota devolve o previsto ZERADO, o que tambem
  // satisfaz `semPrevisao`. Se a ordem dos dois `if` invertesse, o bloco diria
  // "nao havia nada previsto" -- uma afirmacao sobre a agenda do usuario, feita
  // a partir de uma leitura que falhou.
  const t = texto(
    render({ previsto: VAZIO, realizado: REALIZADO, indisponivel: true })
  );

  assert.ok(
    t.includes("entrada ou saída"),
    "caiu no texto de agenda vazia em vez do de leitura falhada"
  );
  assert.ok(
    !t.includes("Não havia nada previsto"),
    "afirmou que a agenda estava vazia sem ter conseguido le-la"
  );
});
