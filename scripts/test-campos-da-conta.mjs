#!/usr/bin/env node
// =====================================================
// PULODOGATO - os campos que SAIRAM da tela de Contas (HMO-166)
// =====================================================
// A queixa era de arvore, nao de calculo: o cadastro era UM formulario para os
// oito valores do ENUM `account_type`, com limite, dia de fechamento e dia de
// vencimento ligados por `ehCartao`. Quem abria para cadastrar uma conta
// corrente via os tres campos de cartao aparecerem e sumirem conforme trocava o
// tipo no seletor.
//
// POR QUE ESTE TESTE RENDERIZA O COMPONENTE
// -----------------------------------------
// `camposDoEscopo` ja tem teste proprio (test-contas.mjs), e ele passaria verde
// com os dois formularios sobrepostos intactos: a decisao estaria certa e o JSX
// ignorando ela. Aqui o `react-dom/server` renderiza os campos de verdade, do
// mesmo arquivo que o app importa, e o teste afirma sobre o HTML que sai.
//
// E o pedido da issue, literal: "renderizar as duas telas e afirmar que a de
// Contas NAO oferece limite/fechamento/vencimento e que a de Cartoes oferece".
//
// O QUE ELE NAO COBRE
// -------------------
// O conteudo dos seletores. O radix renderiza a lista dentro de um portal, que
// so existe com o seletor ABERTO -- no HTML do servidor sai o botao e um
// `<select>` oculto e vazio. Entao "a tela de Contas nao oferece cartao de
// credito no seletor de tipo" nao da para afirmar pelos nomes; da para afirmar
// por `tiposDoEscopo`, que e o que alimenta o `.map` do JSX e tem asercao em
// test-contas.mjs.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CamposDaConta } from "../.tmp-campos-da-conta/components/contas/CamposDaConta.js";
import { valoresIniciais } from "../.tmp-campos-da-conta/lib/contas.js";

/** Os tres campos que existem por causa da fatura, e so por causa dela. */
const SO_DE_CARTAO = ["Limite", "Dia do fechamento", "Dia do vencimento"];

function renderizar({
  escopo,
  valores = {},
  editando = false,
  mostrarMoeda = false,
} = {}) {
  return renderToStaticMarkup(
    h(CamposDaConta, {
      escopo,
      valores: { ...valoresIniciais(escopo), ...valores },
      aoMudar: () => {},
      editando,
      mostrarMoeda,
    })
  );
}

// ---------------------------------------------------------------------------
// A SEPARACAO, QUE E O PONTO DA ISSUE
// ---------------------------------------------------------------------------

test("a tela de Contas nao oferece limite, fechamento nem vencimento", () => {
  const html = renderizar({ escopo: "conta" });

  for (const campo of SO_DE_CARTAO) {
    assert.ok(
      !html.includes(campo),
      `"${campo}" voltou para a tela de Contas -- conta corrente nao tem fatura para fechar`
    );
  }

  assert.ok(
    !html.includes("a fatura não fecha"),
    "o texto de ajuda da fatura vazou para a tela de Contas"
  );
});

test("a tela de Cartoes oferece os tres", () => {
  const html = renderizar({ escopo: "cartao" });

  for (const campo of SO_DE_CARTAO) {
    assert.ok(
      html.includes(campo),
      `"${campo}" sumiu da tela de Cartoes -- sem ele o cartao nao fecha fatura`
    );
  }
});

test("o aviso de que sem os dois dias a fatura nao fecha continua em Cartoes", () => {
  // Nao e texto decorativo: sem fechamento e vencimento o `card_invoice_month()`
  // (migration 006) trata toda compra como do proprio mes, e a compra do dia 28
  // aparece no mes errado. O cadastro salva e nada da erro.
  const html = renderizar({ escopo: "cartao" });
  assert.ok(html.includes("a fatura não fecha"));
  assert.ok(html.includes("aparece no mês errado"));
});

// ---------------------------------------------------------------------------
// O SELETOR DE TIPO
// ---------------------------------------------------------------------------

test("Cartoes nao tem seletor de tipo: la so existe um tipo", () => {
  const html = renderizar({ escopo: "cartao" });
  assert.ok(
    !html.includes(">Tipo<"),
    "a tela de Cartoes mostrou um seletor de tipo com um item so"
  );
});

test("Contas tem seletor de tipo", () => {
  const html = renderizar({ escopo: "conta" });
  assert.ok(html.includes(">Tipo<"));
});

test("editar uma conta que existe explica que o tipo nao muda", () => {
  // Trocar o tipo depois de ter lancamento reinterpretaria o historico inteiro:
  // o mesmo saldo passa a ser lido como fatura, ou o contrario.
  //
  // ISTO NAO AFIRMA QUE O SELETOR ESTA TRAVADO, e a diferenca importa. O
  // `disabled` do Select do radix nao aparece no HTML do servidor: o
  // `<button role="combobox">` sai byte a byte IGUAL com `disabled={true}` e
  // com `disabled={false}`. Uma asercao por `html.includes("disabled")`
  // passaria verde nos dois casos -- e passaria verde de qualquer jeito, porque
  // todo `<Label>` deste projeto carrega `peer-disabled:` na classe.
  //
  // O que da para afirmar aqui e o TEXTO, que e condicional de verdade. A trava
  // em si e prop do componente, e quem a tira tem que apagar tambem esta frase
  // para o teste continuar verde -- o que e justamente o que ninguem faz por
  // acidente.
  const html = renderizar({
    escopo: "conta",
    valores: { id: "abc" },
    editando: true,
  });
  assert.ok(html.includes("O tipo não muda depois de criada"));

  const novo = renderizar({ escopo: "conta" });
  assert.ok(
    !novo.includes("O tipo não muda depois de criada"),
    "a frase de tipo travado apareceu no cadastro de uma conta nova"
  );
});

// ---------------------------------------------------------------------------
// O QUE AS DUAS TELAS TEM EM COMUM
// ---------------------------------------------------------------------------

test("nome, banco e ultimos digitos estao nas duas", () => {
  for (const escopo of ["conta", "cartao"]) {
    const html = renderizar({ escopo });
    assert.ok(html.includes("Nome"), `Nome sumiu de ${escopo}`);
    assert.ok(html.includes("Banco"), `Banco sumiu de ${escopo}`);
    assert.ok(
      html.includes("Últimos 4 dígitos"),
      `os ultimos digitos sumiram de ${escopo}`
    );
  }
});

test("o limite e campo de dinheiro, com a mascara do app", () => {
  // Input cru aceita "1.000,00", e `parseFloat` disso e 1. Um limite de mil
  // reais gravado como um real nao derruba nada -- so faz o cartao parecer
  // estourado desde a primeira compra. Ver lib/dinheiro.ts.
  const html = renderizar({
    escopo: "cartao",
    valores: { credit_limit: "5000" },
  });
  assert.ok(
    html.includes("R$ 5.000,00"),
    "o limite saiu sem a mascara de moeda -- o campo voltou a ser um input cru"
  );
});

test("o formulario de cartao abre em cartao de credito", () => {
  // Nao ha seletor para escolher, entao o tipo tem que vir certo dos valores
  // iniciais -- senao o POST grava `checking` e o cartao nasce como conta.
  assert.equal(valoresIniciais("cartao").account_type, "credit_card");
});

// ---------------------------------------------------------------------------
// A MOEDA DA CONTA (HMO-171)
// ---------------------------------------------------------------------------
// Este bloco existe por causa de um acidente real de ordem de merge. O seletor
// de moeda por conta foi escrito em `app/(dashboard)/dashboard/accounts/page.tsx`,
// e essa tela foi APAGADA pela HMO-166, que separou Contas de Cartoes. O rebase
// resolvia o conflito sozinho, `tsc --noEmit` passava limpo, e o campo
// simplesmente nao existia mais em tela nenhuma -- sem erro, sem aviso, e com a
// migration 022 ja aplicada em producao esperando por ele.
//
// Nenhuma asercao sobre `lib/contas.ts` pega isso: `corpoDaConta` continuaria
// mandando `currency` certinho a partir de um estado que nenhum campo edita.
// So renderizar o componente pega.
//
// O que NAO da para afirmar aqui, pelo motivo ja explicado no cabecalho: os
// NOMES das moedas. O radix monta a lista num portal, que so existe com o
// seletor aberto. O rotulo e o texto de ajuda ficam fora do portal, e sao esses
// que provam que o campo esta montado.

test("o seletor de moeda aparece nas duas telas quando o recurso esta ligado", () => {
  for (const escopo of ["conta", "cartao"]) {
    const html = renderizar({ escopo, mostrarMoeda: true });
    assert.ok(
      html.includes("Moeda"),
      `o seletor de moeda sumiu da tela de ${escopo} -- ele morava na accounts/page.tsx, que a HMO-166 apagou`
    );
    assert.ok(
      html.includes('id="conta-moeda"'),
      `o rotulo "Moeda" saiu sem o seletor junto em ${escopo}`
    );
  }
});

test("sem o recurso ligado, nenhuma das duas telas mostra moeda", () => {
  // Este e o controle negativo do teste acima: se o campo fosse incondicional,
  // os dois passariam verde e nenhum dos dois estaria afirmando nada.
  for (const escopo of ["conta", "cartao"]) {
    const html = renderizar({ escopo, mostrarMoeda: false });
    assert.ok(
      !html.includes('id="conta-moeda"'),
      `a tela de ${escopo} ofereceu moeda com o recurso desligado nas configuracoes`
    );
  }
});

// A moeda SELECIONADA nao da para afirmar aqui, e vale registrar por que: o
// radix so emite um <button role="combobox"> no servidor. O valor escolhido e a
// lista de opcoes vivem no portal, que exige o seletor aberto. Eu escrevi a
// asercao achando que havia um <select> oculto espelhando o valor -- nao ha, e
// ela falhou. A regra "conta em dolar reabre em dolar" e de `valoresDaConta`,
// que e funcao pura, e esta afirmada em test-contas.mjs.

test("o texto de ajuda distingue conta nova de conta que ja tem historico", () => {
  const nova = renderizar({ escopo: "conta", mostrarMoeda: true });
  const existente = renderizar({
    escopo: "conta",
    valores: { id: "abc" },
    editando: true,
    mostrarMoeda: true,
  });

  assert.ok(
    nova.includes("vão sugerir esta moeda"),
    "a conta nova perdeu o texto que explica para que serve a moeda"
  );
  assert.ok(
    existente.includes("ficam na moeda em que foram registrados"),
    "a edicao nao avisa que os lancamentos antigos NAO sao convertidos -- e a leitura natural e que sao"
  );
  assert.ok(
    !nova.includes("ficam na moeda em que foram registrados"),
    "a conta nova prometeu preservar um historico que ela nao tem"
  );
});
