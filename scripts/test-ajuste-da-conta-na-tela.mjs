#!/usr/bin/env node
// =====================================================
// PULODOGATO - o ajuste de saldo da conta, na tela (HMO-409)
// =====================================================
//   npm run test:ajuste-da-conta-na-tela
//
// A sonda renderiza `AjusteDeSaldoDaConta` com `react-dom/server` e afirma
// sobre o HTML que sai. O componente nao tem `fetch` nem hook de dados -- so
// handlers --, e e isso que torna esta medicao possivel; quem fala com
// /api/financial-accounts/ajuste e a pagina.
//
// O QUE ESTA SUITE MEDE, E POR QUE NAO E A MESMA DO CARTAO
// --------------------------------------------------------
// `npm run test:ajuste-na-tela` ja mede o bloco do cartao, e o componente novo
// e uma CASCA duplicada de proposito (a aritmetica, sim, e reusada): generalizar
// o do cartao com props de mes e rotulo de fatura moveria o endereco das
// assercoes daquela suite sem nenhuma delas ficar vermelha.
//
// Duplicar a casca so e barato se a copia tiver medida propria, e e o que isto
// e. As cinco coisas medidas aqui sao as cinco que o cabecalho do componente
// diz que ele nao pode fazer -- e a quinta so existe nesta tela:
//
//   1. imprimir numero sem ter conseguido ler;
//   2. dizer "esta conta nao tem ajuste" sem ter conseguido conferir;
//   3. mostrar a previa sem dizer QUAL conta e EM QUE DIA. O dia nao e
//      decoracao: ele decide em que mes do grafico de patrimonio o degrau
//      aparece, e e ele que forma a chave canonica;
//   4. oferecer "Salvar" com cara de erro quando a conta JA BATE;
//   5. CHAMAR A DIFERENCA DE "ACRESCIMO"/"ABATIMENTO". No cartao, positivo quer
//      dizer MAIS DIVIDA; aqui quer dizer MAIS DINHEIRO. Herdar o vocabulario
//      do cartao -- que e o que acontece quando se copia um componente --
//      poria a palavra que significa "voce deve mais" em cima de um saldo que
//      subiu. Nao da erro, e nao tem como quem le saber que esta invertido.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AjusteDeSaldoDaConta } from "../.tmp-ajuste-da-conta-na-tela/components/contas/AjusteDeSaldoDaConta.js";

const PADRAO = {
  nomeDaConta: "Conta corrente",
  data: "2026-10-16",
  moeda: "BRL",
  // "fresco", e nao um "ok" inventado: `podeMostrarNumero` so aceita "fresco" e
  // "do-aparelho" (lib/offline-leitura.ts). Um valor fora da uniao faz TODA
  // assercao sobre numero medir o caminho do `NumeroIndisponivel` -- e como
  // este arquivo e .mjs, o `tsc` nao reclama. Aconteceu ao escrever esta suite.
  estado: "fresco",
  podeConferir: true,
  valorAtual: null,
  saldoSemAjuste: 2430,
  saldoReal: "",
  descricao: "",
  salvando: false,
  aoMudarSaldoReal: () => {},
  aoMudarDescricao: () => {},
  aoSalvar: () => {},
  aoRemover: () => {},
  aoFechar: () => {},
};

/**
 * O HTML do bloco, com o texto ja normalizado.
 *
 * `&nbsp;` vira espaco comum porque o `Intl` de pt-BR separa "R$" do numero com
 * NBSP (U+00A0): uma assercao escrita com espaco comum nao casaria com
 * "R$ 2.380,00" nenhuma vez, e a suite ficaria vermelha sobre a tela certa.
 */
function render(props = {}) {
  const html = renderToStaticMarkup(
    h(AjusteDeSaldoDaConta, { ...PADRAO, ...props })
  );
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
}

/** So o texto, sem tag nenhuma -- para afirmar sobre a frase que a pessoa le. */
function texto(props = {}) {
  return render(props)
    .replace(/<[^>]*>/g, "")
    .replace(/&#x2F;/g, "/")
    .replace(/ /g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// CONTROLE POSITIVO: o bloco renderiza, e renderiza o formulario
// ---------------------------------------------------------------------------

test("CONTROLE POSITIVO: o formulario sai no HTML do servidor", () => {
  // Sem este caso, toda assercao de ausencia abaixo passaria verde tambem com
  // o componente devolvendo `null`, com um import que nao resolveu, ou com o
  // formulario inteiro atras de um portal do Radix que nao renderiza no
  // servidor. E essa ultima e a razao de o `<Dialog>` ficar na PAGINA.
  const html = render();

  assert.match(html, /Quanto a conta mostra hoje/);
  assert.match(html, /id="saldo-real-da-conta"/);
  assert.match(html, /id="descricao-do-ajuste-da-conta"/);
  assert.match(html, /Salvar ajuste/);
});

// ---------------------------------------------------------------------------
// 1. O CAMPO PEDE O SALDO, E NAO A DIFERENCA
// ---------------------------------------------------------------------------

test("o rotulo pede o saldo do banco, e a linha de ajuda diz que a conta e feita sozinha", () => {
  // Quem digitar a DIFERENCA num campo que espera o SALDO grava a diferenca da
  // diferenca -- com a tela coerente consigo mesma e nada vermelho.
  const t = texto();

  assert.match(t, /Quanto a conta mostra hoje/);
  assert.match(t, /O saldo no app do banco\. A diferença é calculada e lançada sozinha\./);
  assert.ok(
    !/Valor do ajuste/i.test(t),
    `o campo pede o valor do ajuste em vez do saldo real: ${t}`
  );
});

// ---------------------------------------------------------------------------
// 2. A PREVIA: COM A CONTA, COM O DIA, E COM O VOCABULARIO DA CONTA
// ---------------------------------------------------------------------------

test("a previa diz de QUAL conta, EM QUE DIA, e quanto entra ou sai", () => {
  // O app diz 2.430 e o banco diz 2.380: saem R$ 50.
  const t = texto({ saldoReal: "2380.00" });

  // O DIA VAI NA MESMA EXPRESSAO DA DIFERENCA, e nao numa assercao sua.
  //
  // `/em 16\/10\/2026/` solto passa verde com a previa SEM data nenhuma: a
  // frase de abertura do bloco ("a diferença é lançada como um movimento em
  // 16/10/2026...") tambem casa, e e ela que estava respondendo. Medido --
  // o mutante que apaga `em {diaNaTela}` da previa sobrevivia aquela versao.
  // Ver `assercao-de-rotulo-casa-com-o-dado-rotulado`.
  assert.match(
    t,
    /O saldo de Conta corrente passa de R\$ 2\.430,00 para R\$ 2\.380,00 — saída de R\$ 50,00 em 16\/10\/2026\./,
    `a previa nao traz conta, valores, direcao e dia na mesma frase: ${t}`
  );
});

test("O VOCABULARIO E O DA CONTA: entrada e saida, nunca acrescimo nem abatimento", () => {
  // O ponto 5 do cabecalho, e o unico defeito desta tela que a suite do cartao
  // nao teria como pegar -- porque la as palavras estao CERTAS.
  //
  // No cartao, "acrescimo" quer dizer que a divida subiu. Numa conta corrente,
  // um saldo que sobe e dinheiro que apareceu: chamar isso de acrescimo e
  // ambiguo, e chamar a queda de "abatimento" (que no cartao e uma boa noticia)
  // inverte o sentido.
  const entrou = texto({ saldoSemAjuste: 2380, saldoReal: "2430.00" });
  assert.match(entrou, /entrada de R\$ 50,00/);

  const saiu = texto({ saldoSemAjuste: 2430, saldoReal: "2380.00" });
  assert.match(saiu, /saída de R\$ 50,00/);

  for (const t of [entrou, saiu]) {
    assert.ok(!/acréscimo|abatimento/i.test(t), `a tela da conta herdou o vocabulario do cartao: ${t}`);
    assert.ok(!/fatura|cart[ãa]o/i.test(t), `a tela da conta fala de fatura: ${t}`);
  }
});

test("a previa nao sai quando a tela nao conseguiu ler o saldo", () => {
  // `saldoSemAjuste: null` e "nao sei quanto a conta tem". Uma previa calculada
  // sobre isso anunciaria um ajuste do valor INTEIRO que a pessoa digitou.
  const t = texto({ saldoSemAjuste: null, saldoReal: "2380.00" });

  assert.ok(!/passa de/.test(t), `previa impressa sem base: ${t}`);
  // E o erro aparece, com a palavra da CONTA -- a pessoa precisa saber por que
  // o botao esta apagado.
  assert.match(t, /Não foi possível ler o saldo desta conta/);
  assert.ok(!/fatura/i.test(t), t);
});

test("a previa nao sai quando o numero nao pode ser mostrado (sem rede)", () => {
  // Item 1: todo valor passa por `podeMostrarNumero()`. Uma previa calculada
  // sobre uma leitura que nao veio e um numero inventado com cara de certo.
  const t = texto({ estado: "sem-rede", saldoReal: "2380.00" });
  assert.ok(!/passa de/.test(t), `previa impressa sem leitura: ${t}`);
});

// ---------------------------------------------------------------------------
// 3. A CONTA JA BATE: TEXTO PROPRIO, E O AVISO DA REMOCAO
// ---------------------------------------------------------------------------

test("o saldo ja bate: a tela diz isso, e o botao nao promete salvar", () => {
  // Item 4. Digitar o numero do banco e descobrir que ele coincide e o melhor
  // resultado possivel -- sem texto proprio, fica indistinguivel de nada ter
  // acontecido, e a pessoa procura o que errou.
  const props = { saldoSemAjuste: 2430, saldoReal: "2430.00" };
  assert.match(texto(props), /O saldo de Conta corrente já é esse/);
  assert.match(texto(props), /não há diferença a lançar/);

  // Sem ajuste gravado nao ha o que gravar nem o que remover: botao APAGADO ao
  // lado da frase que explica por que. Um botao ativo prometendo "Salvar
  // ajuste" sobre um no-op e pior que um apagado.
  //
  // A assercao casa o `disabled` DENTRO da tag do proprio botao, e nao em
  // qualquer lugar do HTML: `/disabled/` solto casaria com o `disabled` de
  // outro botao (e, pior, com a classe `disabled:` do Tailwind, que esta em
  // todos eles -- ver `includes-disabled-casa-com-a-classe-do-tailwind`).
  assert.match(
    render(props),
    /<button[^>]*\sdisabled=""[^>]*>Salvar ajuste<\/button>/,
    "o botao Salvar fica ativo sobre um no-op"
  );

  // O CONTROLE do disabled acima: com diferenca a lancar, o MESMO botao sai
  // habilitado. Sem este par, um `disabled` cravado em `true` passaria verde --
  // e o formulario nunca gravaria nada.
  assert.match(
    render({ saldoSemAjuste: 2430, saldoReal: "2380.00" }),
    /<button(?:(?!\sdisabled=)[^>])*>Salvar ajuste<\/button>/,
    "o botao Salvar esta apagado mesmo havendo diferenca a lancar"
  );
});

test("o saldo ja bate E ha ajuste: o botao diz REMOVER, e a tela avisa", () => {
  // Sem o aviso, "Salvar" sobre uma conta que bate REMOVE dinheiro do saldo sem
  // nada na tela ter dito isso. E o rotulo tem de acompanhar: um botao escrito
  // "Salvar ajuste" que apaga o ajuste prometeu o contrario do que faz.
  const props = { saldoSemAjuste: 2430, saldoReal: "2430.00", valorAtual: -50 };
  const t = texto(props);

  assert.match(t, /o ajuste de R\$ 50,00 de 16\/10\/2026 vai ser removido/);
  assert.match(render(props), /Remover ajuste/);
  assert.ok(
    !/Salvar ajuste/.test(render(props)),
    "o botao promete salvar o que ele vai remover"
  );
});

// ---------------------------------------------------------------------------
// 4. NAO DEU PARA CONFERIR: NAO AFIRMA, E NAO OFERECE
// ---------------------------------------------------------------------------

test("sem ter conseguido conferir, o bloco nao oferece o formulario", () => {
  // Item 2. Um POST daqui reescreveria um ajuste que a tela nao sabe que
  // existe -- e a pessoa somaria a mesma diferenca de novo achando que estava
  // criando a primeira.
  const html = render({ podeConferir: false });
  const t = texto({ podeConferir: false });

  assert.match(t, /Não foi possível conferir/);
  assert.match(t, /Recarregue antes de lançar um/);
  assert.ok(
    !/Quanto a conta mostra hoje/.test(html),
    "o formulario foi oferecido sobre uma conta que a tela nao conseguiu conferir"
  );
  assert.ok(!/Salvar ajuste/.test(html), "ofereceu Salvar sem saber o que ja existe");
});

// ---------------------------------------------------------------------------
// 5. O AJUSTE QUE JA VALE APARECE, COM SINAL
// ---------------------------------------------------------------------------

test("o ajuste gravado aparece com o sinal e o dia", () => {
  assert.match(texto({ valorAtual: -50 }), /−R\$ 50,00 neste dia/);
  assert.match(texto({ valorAtual: 50 }), /\+R\$ 50,00 neste dia/);
});

test("sem poder mostrar numero, o selo nao imprime o valor", () => {
  // Item 1 outra vez, no selo: numero na tela e lido, e um valor impresso a
  // partir de uma leitura que nao veio e pior que numero nenhum.
  const t = texto({ valorAtual: -50, estado: "sem-rede" });
  assert.ok(!/R\$ 50,00 neste dia/.test(t), `valor impresso sem leitura: ${t}`);
});
