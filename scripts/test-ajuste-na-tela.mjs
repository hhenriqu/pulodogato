#!/usr/bin/env node
// =====================================================
// PULODOGATO - o ajuste de saldo NA TELA do cartao (HMO-253)
// =====================================================
//   npm run test:ajuste-na-tela
//
// POR QUE ESTE TESTE RENDERIZA OS COMPONENTES
// -------------------------------------------
// `test:ajuste-de-fatura` ja cobre as regras, e ela passa verde com todos os
// defeitos que ESTA TELA pode ter de verdade:
//
//   - o bloco inteiro faltando. O ajuste existiria na rota e em lugar nenhum
//     para o usuario -- a issue pede "essa opcao fica no cartao", e nada num
//     teste de funcao pura sabe se o botao esta na tela;
//   - a linha do ajuste sem o rotulo "Ajuste". Indistinguivel de uma compra de
//     R$ 50 tres meses depois, com o total somando certo;
//   - "Ajustar saldo" oferecido quando a tela NAO conseguiu conferir se a fatura
//     ja tem ajuste. Uma afirmacao por omissao sobre o dinheiro da pessoa;
//   - a previa "a fatura passa de X para Y" sem dizer de QUAL fatura, ou
//     impressa sobre um total que a tela nao conseguiu ler.
//
// Nenhum desses e uma decisao que de para extrair para funcao pura: sao
// afirmacoes sobre o que esta -- e sobre o que NAO esta -- na arvore.
//
// O QUE ELE NAO COBRE
// -------------------
// Clique. `react-dom/server` nao executa handler nenhum (ver
// `testar-componente-react-sem-harness`): o que se afirma aqui e a presenca e o
// texto dos controles, nao o efeito deles. O efeito e a fiacao da pagina.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AjusteDeSaldo } from "../.tmp-ajuste-na-tela/components/cartoes/AjusteDeSaldo.js";
import { FaturaDoCartao } from "../.tmp-ajuste-na-tela/components/cartoes/FaturaDoCartao.js";

const MEU_CARTAO = "11111111-1111-1111-1111-111111111111";
const CATEGORIA_DE_AJUSTE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const CONTA = {
  id: MEU_CARTAO,
  user_id: "u1",
  name: "Nubank",
  account_type: "credit_card",
  bank_name: "Nu Pagamentos",
  last_four_digits: "1234",
  credit_limit: 5000,
  current_balance: -320,
  is_active: true,
  color_hex: "#820ad1",
  icon: "credit-card",
  closing_day: 5,
  due_day: 15,
  currency: "BRL",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

const compra = (descricao, valor, dia) => ({
  transaction_id: `compra-${dia}`,
  user_id: "u1",
  account_id: MEU_CARTAO,
  account_name: "Nubank",
  category_id: "c1",
  description: descricao,
  amount: -valor,
  invoice_amount: valor,
  transaction_date: `2026-10-${dia}`,
  transaction_type: "expense",
  invoice_month: "2026-10-01",
  invoice_due_date: "2026-10-15",
});

/** A linha do ajuste: categoria reservada, data no dia 1. */
const LINHA_DO_AJUSTE = {
  transaction_id: "t-ajuste",
  user_id: "u1",
  account_id: MEU_CARTAO,
  account_name: "Nubank",
  category_id: CATEGORIA_DE_AJUSTE,
  description: "Ajuste de saldo da fatura (acréscimo)",
  amount: -50,
  invoice_amount: 50,
  transaction_date: "2026-10-01",
  transaction_type: "expense",
  invoice_month: "2026-10-01",
  invoice_due_date: "2026-10-15",
};

const faturaCom = (linhas) => ({
  account_id: MEU_CARTAO,
  account_name: "Nubank",
  closing_day: 5,
  due_day: 15,
  invoice_month: "2026-10-01",
  due_date: "2026-10-15",
  total: linhas.reduce((s, l) => s + l.invoice_amount, 0),
  line_count: linhas.length,
  lines: linhas,
  scheduled_pending: [],
});

const SEM_HANDLER = {
  aoAbrir: () => {},
  aoFechar: () => {},
  aoMudarValor: () => {},
  aoMudarDirecao: () => {},
  aoMudarDescricao: () => {},
  aoSalvar: () => {},
  aoRemover: () => {},
};

const renderBloco = (props) =>
  renderToStaticMarkup(
    h(AjusteDeSaldo, {
      rotuloDoMes: "outubro de 2026",
      moeda: "BRL",
      estado: "fresco",
      categoriaDeAjuste: null,
      valorAtual: null,
      totalSemAjuste: 320,
      aberto: false,
      valor: "",
      direcao: "aumenta",
      descricao: "",
      ...SEM_HANDLER,
      ...props,
    })
  );

const renderTela = (props) =>
  renderToStaticMarkup(
    h(FaturaDoCartao, {
      conta: CONTA,
      fatura: faturaCom([compra("Mercado do mes", 200, "03")]),
      mes: "2026-10",
      estado: "fresco",
      aoMudarMes: () => {},
      ...props,
    })
  );

/** O HTML sem tag nenhuma, com os espacos normalizados. */
const texto = (html) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;| /g, " ")
    .replace(/&#x27;|&quot;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&minus;/g, "−")
    .replace(/\s+/g, " ")
    .trim();

// ---------------------------------------------------------------------------
// 1. O PEDIDO DA ISSUE: A OPCAO FICA NO CARTAO
// ---------------------------------------------------------------------------

test("a tela do cartao mostra o bloco de ajuste de saldo", () => {
  // O SLOT e o que liga os dois: sem ele o bloco existiria no repositorio e nao
  // na tela, e a issue inteira deixaria de existir sem nada ficar vermelho.
  const html = renderTela({
    categoriaDeAjuste: null,
    blocoDeAjuste: renderAjusteComoElemento({}),
  });
  const t = texto(html);
  assert.match(t, /Ajuste de saldo/);
  assert.match(t, /Ajustar saldo/);
});

test("o bloco explica para que o ajuste serve", () => {
  // "Ajuste de saldo" sozinho nao diz nada a quem abriu a tela pela primeira
  // vez. O que ele resolve -- a fatura do app diferente da do banco -- precisa
  // estar escrito, senao o botao fica ali sem ninguem saber quando usar.
  const t = texto(renderBloco({}));
  assert.match(t, /fatura fechar igual à do banco/i);
  assert.match(t, /sem detalhar/i);
});

test("o bloco fica ANTES da lista de gastos", () => {
  // Ele explica o TOTAL que esta em cima dele; jogado no fim da tela, depois de
  // trinta compras, ele responde uma pergunta que ninguem lembra mais de ter
  // feito. A ordem sai de `renderToStaticMarkup`, que e a ordem do documento.
  const html = renderTela({
    categoriaDeAjuste: null,
    blocoDeAjuste: renderAjusteComoElemento({}),
  });
  const t = texto(html);
  assert.ok(
    t.indexOf("Ajuste de saldo") < t.indexOf("Mercado do mes"),
    "o bloco de ajuste tem de vir antes das compras"
  );
});

// ---------------------------------------------------------------------------
// 2. O AJUSTE QUE JA EXISTE
// ---------------------------------------------------------------------------

test("o ajuste que esta valendo aparece com valor e sinal", () => {
  const t = texto(renderBloco({ categoriaDeAjuste: CATEGORIA_DE_AJUSTE, valorAtual: 50 }));
  assert.match(t, /\+R\$ 50,00 nesta fatura/);
  // Com ajuste, o botao diz ALTERAR -- "Ajustar saldo" sugeriria que nao ha um.
  assert.match(t, /Alterar ajuste/);
  assert.match(t, /Remover ajuste/);
});

test("o abatimento aparece com sinal de menos, nao como acrescimo", () => {
  const t = texto(renderBloco({ categoriaDeAjuste: CATEGORIA_DE_AJUSTE, valorAtual: -50 }));
  assert.match(t, /−R\$ 50,00 nesta fatura/);
  assert.doesNotMatch(t, /\+R\$ 50,00/);
});

test("sem ajuste nenhum nao se oferece remover", () => {
  const t = texto(renderBloco({ categoriaDeAjuste: null, valorAtual: null }));
  assert.match(t, /Ajustar saldo/);
  assert.doesNotMatch(t, /Remover ajuste/);
  assert.doesNotMatch(t, /nesta fatura/);
});

// ---------------------------------------------------------------------------
// 3. O QUE A TELA NAO PODE AFIRMAR
// ---------------------------------------------------------------------------

test("sem conseguir conferir, a tela NAO oferece lancar ajuste", () => {
  // `undefined` = a consulta da categoria reservada falhou. Oferecer "Ajustar
  // saldo" aqui afirmaria por omissao que esta fatura nao tem ajuste, e o POST
  // reescreveria um ajuste que a tela nao sabe que existe.
  const t = texto(renderBloco({ categoriaDeAjuste: undefined }));
  assert.match(t, /Não foi possível conferir/);
  assert.doesNotMatch(t, /Ajustar saldo/);
  assert.doesNotMatch(t, /Alterar ajuste/);
  assert.doesNotMatch(t, /Remover ajuste/);
});

test("o valor do ajuste nao e impresso sem leitura boa", () => {
  // Mesmo pedagio do total da fatura: numero impresso a partir de uma leitura
  // que falhou mente com a cara de numero certo.
  for (const estado of ["sem-rede", "erro-do-servidor", "sessao-recusada"]) {
    const t = texto(
      renderBloco({ estado, categoriaDeAjuste: CATEGORIA_DE_AJUSTE, valorAtual: 50 })
    );
    assert.doesNotMatch(t, /R\$ 50,00/, `estado ${estado} nao pode imprimir valor`);
  }
});

test("durante o carregamento tambem nao ha numero", () => {
  const t = texto(
    renderBloco({ estado: null, categoriaDeAjuste: CATEGORIA_DE_AJUSTE, valorAtual: 50 })
  );
  assert.doesNotMatch(t, /R\$ 50,00/);
});

// ---------------------------------------------------------------------------
// 4. O FORMULARIO
// ---------------------------------------------------------------------------

test("o formulario aberto tem os dois lados do ajuste", () => {
  // "negativo ou positivo", nas palavras da issue. Sem os dois lados na tela, o
  // campo de dinheiro (mascara de digitos) so permitiria aumentar a fatura.
  const t = texto(renderBloco({ aberto: true }));
  assert.match(t, /Aumenta a fatura/);
  assert.match(t, /Abate da fatura/);
  assert.match(t, /Valor do ajuste/);
  assert.match(t, /Salvar ajuste/);
});

test("o lado escolhido fica marcado para quem nao ve cor", () => {
  // `aria-pressed` e o unico sinal que chega em leitor de tela: sem ele, qual
  // dos dois botoes esta valendo e uma informacao que existe so no pixel -- e o
  // lado errado inverte o ajuste.
  const comAumento = renderBloco({ aberto: true, direcao: "aumenta" });
  const comAbatimento = renderBloco({ aberto: true, direcao: "abate" });

  assert.match(comAumento, /aria-pressed="true"[^>]*>Aumenta a fatura/);
  assert.match(comAbatimento, /aria-pressed="true"[^>]*>Abate da fatura/);
  // E exatamente UM marcado: dois marcados nao dizem nada.
  assert.equal((comAumento.match(/aria-pressed="true"/g) ?? []).length, 1);
});

test("o campo de valor e o campo de dinheiro do app, nao um type=number", () => {
  // `<input type="number">` aceitaria "1.000,00" e `parseFloat` daria 1: mil
  // reais de ajuste gravados como um real, sem erro no caminho (lib/dinheiro.ts).
  const html = renderBloco({ aberto: true, valor: "1000.00" });
  assert.doesNotMatch(html, /id="valor-do-ajuste"[^>]*type="number"/);
  // A assercao e sobre o ATRIBUTO, e nao sobre o texto da pagina: o valor de um
  // `<input>` mora dentro da tag, e `texto()` apaga tudo o que esta dentro de
  // tag. Procura-lo no texto normalizado daria verde com o campo vazio -- a
  // previa abaixo imprime "R$ 1.320,00" e casaria o padrao sozinha.
  assert.match(html, /id="valor-do-ajuste"[^>]*value="R\$ 1\.000,00"/);
});

test("a previa diz de que fatura ela fala, e para onde o total vai", () => {
  const t = texto(
    renderBloco({ aberto: true, valor: "50.00", direcao: "aumenta", totalSemAjuste: 320 })
  );
  assert.match(t, /A fatura de outubro de 2026 passa de R\$ 320,00 para R\$ 370,00/);
});

test("a previa do abatimento desce o total", () => {
  const t = texto(
    renderBloco({ aberto: true, valor: "50.00", direcao: "abate", totalSemAjuste: 320 })
  );
  assert.match(t, /passa de R\$ 320,00 para R\$ 270,00/);
});

test("a previa NAO aparece sem mes que a nomeie", () => {
  // Numero certo respondendo uma pergunta que o leitor nao sabe qual e: o
  // seletor de mes fica dois blocos acima.
  const t = texto(
    renderBloco({ aberto: true, valor: "50.00", rotuloDoMes: null })
  );
  assert.doesNotMatch(t, /passa de/);
});

test("a previa NAO aparece sobre uma fatura que nao carregou", () => {
  // A base da conta e o total da fatura. Sem leitura boa, "passa de R$ 0,00 para
  // R$ 50,00" seria um numero inventado com cara de numero certo.
  const t = texto(
    renderBloco({ aberto: true, valor: "50.00", estado: "sem-rede" })
  );
  assert.doesNotMatch(t, /passa de/);
});

test("valor invalido mostra o erro, e e o MESMO texto da rota", () => {
  // `validarAjuste` e a funcao que a rota chama: o que a tela recusa e o que o
  // servidor recusaria, com a mesma frase. Duas validacoes separadas divergem, e
  // a tela aceitaria o que o POST devolve 400.
  const t = texto(renderBloco({ aberto: true, valor: "0" }));
  assert.match(t, /Remover ajuste/);
});

test("campo vazio nao grita erro antes de o usuario digitar", () => {
  const t = texto(renderBloco({ aberto: true, valor: "" }));
  assert.doesNotMatch(t, /Informe o valor do ajuste/);
});

// ---------------------------------------------------------------------------
// 5. A LINHA DO AJUSTE NA LISTA DA FATURA
// ---------------------------------------------------------------------------

test("a linha do ajuste fica na lista, para a soma fechar com o total", () => {
  // Tira-la deixaria as compras somando R$ 200 embaixo de um total de R$ 250, as
  // duas corretas, e nada na tela explicando a diferenca.
  const fatura = faturaCom([compra("Mercado do mes", 200, "03"), LINHA_DO_AJUSTE]);
  const t = texto(
    renderTela({ fatura, categoriaDeAjuste: CATEGORIA_DE_AJUSTE })
  );

  assert.match(t, /Ajuste de saldo da fatura \(acréscimo\)/);
  assert.match(t, /R\$ 50,00/);
  // O total impresso e a soma das linhas: 200 + 50.
  assert.match(t, /Gastos de outubro de 2026 R\$ 250,00/);
});

test("a linha do ajuste tem ROTULO, e a compra nao", () => {
  // Sem rotulo, um ajuste de R$ 50 e indistinguivel de uma compra de R$ 50 tres
  // meses depois -- e a descricao e editavel, entao ela nao serve de rotulo.
  const fatura = faturaCom([compra("Mercado do mes", 200, "03"), LINHA_DO_AJUSTE]);
  const html = renderTela({ fatura, categoriaDeAjuste: CATEGORIA_DE_AJUSTE });

  // A assercao e sobre o ELEMENTO do rotulo (`>Ajuste<`), e nao sobre a palavra
  // "Ajuste" no texto da pagina. Medido: a primeira versao procurava
  // /\bAjuste\b/ no texto normalizado e passava verde com o rotulo REMOVIDO --
  // a propria descricao da linha ("Ajuste de saldo da fatura") casa o padrao, e
  // a descricao e editavel pelo usuario. A assercao media a frase que ela
  // deveria estar desconfiando.
  assert.match(html, />Ajuste</, "a linha do ajuste precisa do rotulo");
  assert.equal(
    (html.match(/>Ajuste</g) ?? []).length,
    1,
    "exatamente uma linha leva o rotulo"
  );

  // O rotulo e da linha do AJUSTE, e nao de toda linha: um badge em cada compra
  // nao distingue nada.
  const linhaDaCompra = html.slice(
    html.indexOf("Mercado do mes"),
    html.indexOf("Mercado do mes") + 400
  );
  assert.doesNotMatch(linhaDaCompra, />Ajuste</);
});

test("sem categoria conhecida, nenhuma linha recebe o rotulo", () => {
  // Carimbar por adivinhacao chamaria de ajuste a compra de alguem.
  const fatura = faturaCom([compra("Mercado do mes", 200, "03"), LINHA_DO_AJUSTE]);
  const html = renderTela({ fatura, categoriaDeAjuste: undefined });
  assert.doesNotMatch(html, />Ajuste</);
});

// ---------------------------------------------------------------------------
// Monta o bloco como ELEMENTO (e nao como HTML) para entrar no slot da tela.
// ---------------------------------------------------------------------------
function renderAjusteComoElemento(props) {
  return h(AjusteDeSaldo, {
    rotuloDoMes: "outubro de 2026",
    moeda: "BRL",
    estado: "fresco",
    categoriaDeAjuste: null,
    valorAtual: null,
    totalSemAjuste: 320,
    aberto: false,
    valor: "",
    direcao: "aumenta",
    descricao: "",
    ...SEM_HANDLER,
    ...props,
  });
}
