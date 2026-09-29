#!/usr/bin/env node
// =====================================================
// PULODOGATO - os campos que SAIRAM da tela de receita (HMO-165)
// =====================================================
// A queixa era de arvore, nao de calculo: o formulario antigo era um bloco
// dentro de `personal-finance` que trocava os campos por
// `if (formData.transaction_type === ...)`. Quem abria para lancar uma receita
// via, aparecendo e desaparecendo, o seletor de natureza da despesa, o
// parcelamento e o rateio.
//
// POR QUE ESTE TESTE RENDERIZA O COMPONENTE
// -----------------------------------------
// `camposDoTipo` ja tem teste proprio (test-lancamento.mjs), e ele passaria
// verde com os tres formularios sobrepostos intactos: a decisao estaria certa e
// o JSX ignorando ela. Aqui o `react-dom/server` renderiza os campos de
// verdade, do mesmo arquivo que o app importa, e o teste afirma sobre o HTML
// que sai.
//
// O QUE ELE NAO COBRE
// -------------------
// O conteudo dos seletores. O radix renderiza a lista dentro de um portal, que
// so existe com o seletor ABERTO -- no HTML do servidor sai o botao e um
// `<select>` oculto e vazio. Entao "a tela de receita nao lista categoria de
// despesa" nao da para afirmar pelos nomes; da para afirmar pelo AVISO de lista
// vazia, que e o que o caso "so ha categoria do outro tipo" faz. E a prova de
// que o filtro esta ligado no JSX, e nao so na funcao.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CamposDeLancamento } from "../.tmp-campos-lancamento/components/movimentacoes/CamposDeLancamento.js";
import { valoresIniciais } from "../.tmp-campos-lancamento/lib/lancamento.js";

const CATEGORIA_DESPESA = { id: "c1", name: "Mercado", is_expense: true };
const CATEGORIA_RECEITA = { id: "c2", name: "Salário", is_expense: false };
const CARTAO = { id: "a", name: "Visa", account_type: "credit_card" };
const CORRENTE = { id: "b", name: "Corrente", account_type: "checking" };

/** Marcador do slot de rateio: ele nao e montado aqui, e passado de fora. */
const MARCADOR_DE_RATEIO = "BLOCO-DE-RATEIO";

function renderizar({
  tipo,
  valores = {},
  categorias = [CATEGORIA_DESPESA, CATEGORIA_RECEITA],
  contas = [CARTAO, CORRENTE],
  editando = false,
} = {}) {
  return renderToStaticMarkup(
    h(CamposDeLancamento, {
      tipo,
      valores: { ...valoresIniciais(), ...valores },
      aoMudar: () => {},
      categorias,
      contas,
      editando,
      rateio: h("div", null, MARCADOR_DE_RATEIO),
    })
  );
}

// ---------------------------------------------------------------------------
// A SEPARACAO, QUE E O PONTO DA ISSUE
// ---------------------------------------------------------------------------

test("receita nao tem natureza de despesa, parcelamento nem rateio", () => {
  const html = renderizar({ tipo: "income" });

  assert.ok(
    !html.includes("Tipo de Despesa"),
    "a tela de receita voltou a mostrar a natureza da despesa"
  );
  assert.ok(
    !html.includes("Gasto no Cartão") && !html.includes("Despesa Fixa"),
    "as opcoes de natureza da despesa vazaram para a receita"
  );
  assert.ok(
    !html.includes("Parcelar"),
    "a tela de receita voltou a oferecer parcelamento"
  );
  assert.ok(
    !html.includes(MARCADOR_DE_RATEIO),
    "o bloco de rateio apareceu na receita -- receita nao se divide com ninguem"
  );
  assert.ok(
    !html.includes("Vence todo dia"),
    "o dia de vencimento da regra mensal apareceu na receita"
  );
});

test("despesa tem os tres", () => {
  const html = renderizar({ tipo: "expense" });

  assert.ok(html.includes("Tipo de Despesa"), "a natureza da despesa sumiu");
  assert.ok(html.includes("Parcelar esta despesa"), "o parcelamento sumiu");
  assert.ok(html.includes(MARCADOR_DE_RATEIO), "o bloco de rateio sumiu");
});

test("os campos comuns estao nas duas", () => {
  // Se um destes cair em uma das telas, nao ha lancamento possivel por ela.
  for (const tipo of ["income", "expense"]) {
    const html = renderizar({ tipo });
    for (const campo of [
      'id="description"',
      'id="amount"',
      'id="date"',
      'id="notes"',
      'for="category"',
      'for="account"',
    ]) {
      assert.ok(html.includes(campo), `${campo} faltou na tela de ${tipo}`);
    }
  }
});

// ---------------------------------------------------------------------------
// OS ROTULOS QUE DIZEM EM QUAL TELA A PESSOA ESTA
// ---------------------------------------------------------------------------

test("a categoria e a conta trocam de nome conforme a tela", () => {
  const receita = renderizar({ tipo: "income" });
  assert.ok(receita.includes("Categoria da receita"));
  assert.ok(receita.includes("Conta de entrada"));
  assert.ok(!receita.includes("Conta/Cartão"));

  const despesa = renderizar({ tipo: "expense" });
  assert.ok(despesa.includes("Categoria da despesa"));
  assert.ok(despesa.includes("Conta/Cartão"));
});

test("gasto no cartao pede cartao, e diz que e obrigatorio", () => {
  const html = renderizar({ tipo: "expense", valores: { natureza: "card" } });
  assert.ok(html.includes("Cartão *"), "o rotulo nao marcou o cartao como obrigatorio");
  assert.ok(html.includes("Entra na fatura do cartão escolhido"));
});

test("despesa fixa mostra o dia do vencimento, e diz o que ela vira", () => {
  const html = renderizar({ tipo: "expense", valores: { natureza: "fixed" } });
  assert.ok(html.includes('id="due_day"'), "o dia do vencimento nao apareceu");
  assert.ok(html.includes("Vira uma regra mensal em Contas Previstas"));
});

// ---------------------------------------------------------------------------
// OS AVISOS QUE EVITAM SELETOR VAZIO SEM EXPLICACAO
// ---------------------------------------------------------------------------

test("o filtro de categoria esta ligado no JSX, nao so na funcao", () => {
  // A tela de despesa recebendo SO categoria de receita: se o componente
  // passasse a lista inteira para o seletor, o aviso de lista vazia nao
  // apareceria -- e o seletor abriria oferecendo "Salário" para uma despesa.
  const html = renderizar({ tipo: "expense", categorias: [CATEGORIA_RECEITA] });
  assert.ok(
    html.includes("Nenhuma categoria de despesa"),
    "a lista de categorias nao esta filtrada por tipo dentro do componente"
  );

  const inverso = renderizar({ tipo: "income", categorias: [CATEGORIA_DESPESA] });
  assert.ok(inverso.includes("Nenhuma categoria de receita"));
});

test("com categoria do tipo certo, o aviso de lista vazia nao aparece", () => {
  // O controle positivo do caso acima: sem ele, um aviso que aparece SEMPRE
  // passaria os dois.
  const html = renderizar({ tipo: "expense", categorias: [CATEGORIA_DESPESA] });
  assert.ok(!html.includes("Nenhuma categoria"));
});

test("gasto no cartao sem cartao nenhum explica o seletor vazio", () => {
  const semCartao = renderizar({
    tipo: "expense",
    valores: { natureza: "card" },
    contas: [CORRENTE],
  });
  assert.ok(
    semCartao.includes("não tem nenhum cartão de crédito"),
    "o seletor de cartao abriria vazio e sem explicacao"
  );

  // Com cartao na lista o aviso sai -- senao ele seria decoracao permanente.
  const comCartao = renderizar({
    tipo: "expense",
    valores: { natureza: "card" },
    contas: [CARTAO],
  });
  assert.ok(!comCartao.includes("não tem nenhum cartão de crédito"));
});

// ---------------------------------------------------------------------------
// EDITAR
// ---------------------------------------------------------------------------

test("editando, nao ha parcelamento nem dia de vencimento", () => {
  // Transacao gravada e lancamento, nao regra -- e parcelar o que ja existe
  // exigiria apagar a linha e criar N no lugar.
  const html = renderizar({
    tipo: "expense",
    valores: { natureza: "fixed" },
    editando: true,
  });
  assert.ok(!html.includes("Parcelar"), "editar voltou a oferecer parcelamento");
  assert.ok(!html.includes('id="due_day"'), "editar voltou a oferecer despesa fixa");
});

test("editando, a natureza fica visivel mas travada", () => {
  // Ela precisa ser LIDA (o gasto saiu do cartao ou da conta?) e nao pode ser
  // trocada: virar "fixa" transformaria um lancamento em regra pelas costas.
  const html = renderizar({
    tipo: "expense",
    valores: { natureza: "card" },
    editando: true,
  });
  assert.ok(html.includes("Tipo de Despesa"));
  assert.ok(html.includes("disabled"), "o seletor de natureza ficou editavel");
});

// ---------------------------------------------------------------------------
// PARCELAMENTO
// ---------------------------------------------------------------------------

test("os campos da parcela so existem com o parcelamento marcado", () => {
  const desmarcado = renderizar({ tipo: "expense" });
  assert.ok(!desmarcado.includes('id="total_installments"'));

  const marcado = renderizar({
    tipo: "expense",
    valores: { parcelado: true, valorDaParcela: "50", totalDeParcelas: 3 },
  });
  assert.ok(marcado.includes('id="total_installments"'));
  assert.ok(marcado.includes('id="installment_amount"'));
  assert.ok(marcado.includes('id="first_due_date"'));
  // 3 x 50 = 150: o total sai na tela para a pessoa conferir antes de salvar.
  assert.ok(marcado.includes("150,00"), "o total das parcelas nao foi exibido");
});

// ---------------------------------------------------------------------------
// O CELULAR (HMO-168)
// ---------------------------------------------------------------------------

test("nenhum grid sem coluna de base", () => {
  // `grid` sem `grid-cols-1` estoura o container no celular: o trilho `auto`
  // tem o min-content como PISO e cresce alem do pai em vez de apertar. Foram
  // 364px de trilho dentro de 288px nas calculadoras.
  for (const tipo of ["income", "expense"]) {
    const html = renderizar({
      tipo,
      valores: { parcelado: true, natureza: "fixed" },
    });
    for (const classe of html.match(/class="[^"]*\bgrid\b[^"]*"/g) ?? []) {
      assert.ok(
        /\bgrid-cols-1\b/.test(classe),
        `grid sem coluna de base na tela de ${tipo}: ${classe}`
      );
    }
  }
});
