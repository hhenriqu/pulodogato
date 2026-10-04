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
  cartaoFixado = null,
} = {}) {
  return renderToStaticMarkup(
    h(CamposDeLancamento, {
      tipo,
      valores: { ...valoresIniciais(), ...valores },
      aoMudar: () => {},
      categorias,
      contas,
      editando,
      cartaoFixado,
      rateio: h("div", null, MARCADOR_DE_RATEIO),
    })
  );
}

/** O `<input ... id="x" ...>` inteiro, para afirmar sobre os atributos dele. */
function inputPorId(html, id) {
  return html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// ALCANCAR OS HANDLERS, E POR QUE O HTML NAO BASTA (HMO-226)
// ---------------------------------------------------------------------------
// `renderToStaticMarkup` nunca chama `onChange`, `onFocus` nem `onBlur` -- eles
// nao aparecem no HTML de saida. Entao TODA assercao sobre o markup e cega para
// o conserto da HMO-226: o `onChange` daqui pode voltar a ser
// `parseInt(e.target.value) || 1` e o `value=""` do teste de render continua
// saindo igual, porque o teste e quem escolhe o estado. Um mutante plantado no
// handler sobreviveria com a assercao "certa" verde ao lado.
//
// `CamposDeLancamento` nao usa hook NENHUM (e o comentario do `resumo`, em
// components/movimentacoes/CamposDeLancamento.tsx, diz isso em voz alta), entao
// ela e uma funcao pura de props: da para chamá-la e andar na arvore de
// elementos que ela devolve, sem renderizador e sem DOM. E dali os tres
// handlers sao chamaveis de verdade.
//
// Se um dia esta funcao passar a usar hooks, `camposDoInput` vai estourar na
// chamada -- e um erro alto, nao um teste que fica verde medindo nada.
function acharPorId(no, id) {
  if (no == null || typeof no !== "object") return null;
  if (Array.isArray(no)) {
    for (const filho of no) {
      const achado = acharPorId(filho, id);
      if (achado) return achado;
    }
    return null;
  }
  if (no.props?.id === id) return no.props;
  return acharPorId(no.props?.children, id);
}

/**
 * As props do input `id`, mais a lista do que o componente mandou para
 * `aoMudar`.
 *
 * `mudancas` e um array e nao "a ultima mudanca": um handler que chame `aoMudar`
 * duas vezes (ou nenhuma) tem de ser distinguivel de um que chame uma.
 */
function camposDoInput({ id, valores = {} }) {
  const mudancas = [];
  const arvore = CamposDeLancamento({
    tipo: "expense",
    valores: {
      ...valoresIniciais(),
      natureza: "card",
      contaId: CARTAO.id,
      parcelado: true,
      valor: "300",
      totalDeParcelas: "3",
      ...valores,
    },
    aoMudar: (mudanca) => mudancas.push(mudanca),
    categorias: [CATEGORIA_DESPESA],
    contas: [CARTAO],
    editando: false,
    cartaoFixado: null,
    rateio: h("div", null, MARCADOR_DE_RATEIO),
  });

  const props = acharPorId(arvore, id);
  assert.ok(props, `o input id="${id}" nao esta na arvore de elementos`);
  return { props, mudancas };
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

test("despesa tem natureza e rateio; o parcelamento e so do cartao", () => {
  const html = renderizar({ tipo: "expense" });

  assert.ok(html.includes("Tipo de Despesa"), "a natureza da despesa sumiu");
  assert.ok(html.includes(MARCADOR_DE_RATEIO), "o bloco de rateio sumiu");
  // HMO-211: a checkbox saiu da despesa pontual. Ela aparecia e nao funcionava
  // -- a rota gravava em `transaction_installments`, tabela sem leitor nenhum --
  // e agora a rota recusa 400 fora do cartao. Oferecer na tela um caminho que o
  // servidor nao atende e pior que nao oferecer.
  assert.ok(
    !html.includes("Parcelar esta compra"),
    "o parcelamento voltou para a despesa pontual, onde a rota recusa"
  );

  const noCartao = renderizar({
    tipo: "expense",
    valores: { natureza: "card", contaId: CARTAO.id },
  });
  assert.ok(
    noCartao.includes("Parcelar esta compra"),
    "o parcelamento sumiu do cartao"
  );
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
  // Desmarcada, nem no cartao: a checkbox existe, os campos nao.
  const desmarcado = renderizar({
    tipo: "expense",
    valores: { natureza: "card", contaId: CARTAO.id },
  });
  assert.ok(desmarcado.includes('id="is_installment"'));
  assert.ok(!desmarcado.includes('id="total_installments"'));
  assert.ok(!desmarcado.includes('id="parcela_atual"'));
  assert.ok(!desmarcado.includes('id="base_parcela"'));

  const marcado = renderizar({
    tipo: "expense",
    valores: {
      natureza: "card",
      contaId: CARTAO.id,
      parcelado: true,
      valor: "50",
      totalDeParcelas: "3",
    },
  });
  // OS TRES PEDACOS DO PEDIDO, cada um por id proprio.
  assert.ok(marcado.includes('id="total_installments"'), "o M sumiu");
  assert.ok(marcado.includes('id="parcela_atual"'), "o N sumiu");
  assert.ok(marcado.includes('id="base_parcela"'), "a opcao 'parcela' sumiu");
  assert.ok(marcado.includes('id="base_total"'), "a opcao 'total' sumiu");
  assert.ok(marcado.includes("O valor acima é:"), "a pergunta da issue sumiu");

  // O CAMPO DE DINHEIRO DA PARCELA NAO EXISTE MAIS, e isto e o pedido.
  // "perguntar se o valor que esta no input e o da parcela ou total" pressupoe
  // UM valor. Enquanto havia dois, o de cima era sobrescrito em silencio.
  assert.ok(
    !marcado.includes('id="installment_amount"'),
    "voltou o segundo campo de dinheiro, que o pedido elimina"
  );
  assert.ok(
    !marcado.includes('id="first_due_date"'),
    "voltou o campo de data proprio: a data da compra ja esta na tela"
  );

  // 3 x 50 = 150: a conta feita sai na tela para a pessoa conferir antes de
  // salvar -- e e ela que protege de responder "parcela ou total" errado.
  assert.ok(marcado.includes("R$ 150,00"), "o total das parcelas nao foi exibido");
  assert.ok(marcado.includes("3x de R$ 50,00"), "o resumo da serie nao saiu");
});

// A POSICAO E PARTE DO PEDIDO, e nenhuma assercao de presenca a cobre.
//
// "deve ser um checkbox ABAIXO DO VALOR do cartao". O rebase da HMO-216 trouxe
// `SeletorDeCategoria` para exatamente o ponto onde este bloco entra, e resolver
// aquele conflito na ordem errada -- valor, categoria, parcelar -- compila verde
// e passa em TODAS as assercoes de presenca acima: os quatro ids continuam no
// HTML, so longe do campo que a checkbox redefine. Esta e a unica assercao do
// repositorio que falha nesse caso, e por isso ela compara indices e nao
// `includes`.
test("a checkbox de parcelar vem depois do valor e antes da categoria", () => {
  const html = renderizar({
    tipo: "expense",
    valores: { natureza: "card", contaId: CARTAO.id },
  });

  const valor = html.indexOf('id="amount"');
  const checkbox = html.indexOf('id="is_installment"');
  const categoria = html.indexOf('id="category"');

  assert.ok(valor >= 0, "o campo de valor sumiu da tela");
  assert.ok(checkbox >= 0, "a checkbox de parcelar sumiu da tela");
  assert.ok(categoria >= 0, "o seletor de categoria sumiu da tela");

  assert.ok(
    valor < checkbox,
    `a checkbox de parcelar subiu para ANTES do campo de valor (valor=${valor}, checkbox=${checkbox}); o pedido e "abaixo do valor"`
  );
  assert.ok(
    checkbox < categoria,
    `a categoria entrou ENTRE o valor e a checkbox (checkbox=${checkbox}, categoria=${categoria}); a checkbox tem que encostar no campo cujo significado ela muda`
  );
});

test("o resumo diz, na tela, que as parcelas anteriores nao entram", () => {
  // A decisao (A) da HMO-208 fica VISIVEL antes de salvar. Sem esta frase a tela
  // anuncia 10x e grava 8, e a pessoa so descobriria procurando nas faturas
  // passadas uma parcela que nunca existiu.
  const html = renderizar({
    tipo: "expense",
    valores: {
      natureza: "card",
      contaId: CARTAO.id,
      parcelado: true,
      valor: "100",
      parcelaAtual: "3",
      totalDeParcelas: "10",
    },
  });

  assert.ok(html.includes("10x de R$ 100,00"), "o resumo nao trouxe a serie");
  assert.ok(html.includes("R$ 1.000,00"), "o resumo nao trouxe o total");
  assert.ok(
    html.includes("8 parcelas"),
    "o resumo nao disse quantas parcelas vao ser criadas"
  );
  assert.ok(
    html.includes("2 anteriores não entram"),
    "a tela nao avisou que as parcelas anteriores nao sao criadas"
  );
});

// ---------------------------------------------------------------------------
// O CAMPO DE PARCELAS DEIXA APAGAR O "1" (HMO-226)
// ---------------------------------------------------------------------------
// O pedido: "vem preenchido como 1, nao permitindo apagar [...] quando clicar
// ele apague para a pessoa digitar outro numero por exemplo, 6, sem ter que
// digitar 16 e depois apagar o 1".
//
// Os dois primeiros testes afirmam sobre o ESTADO VAZIO, que antes da HMO-226
// era inalcancavel: os campos eram `number`, e `parseInt("") || 1` repunha o 1
// no mesmo quadro do Backspace. Os tres ultimos chamam os handlers, que e onde
// o conserto mora -- ver `camposDoInput` acima para o motivo.

test("os dois campos de parcela aparecem vazios quando o estado esta vazio", () => {
  const semM = renderizar({
    tipo: "expense",
    valores: {
      natureza: "card",
      contaId: CARTAO.id,
      parcelado: true,
      valor: "300",
      totalDeParcelas: "",
    },
  });
  assert.equal(
    inputPorId(semM, "total_installments")?.includes('value=""'),
    true,
    `o campo de parcelas nao saiu vazio: ${inputPorId(semM, "total_installments")}`
  );

  const semN = renderizar({
    tipo: "expense",
    valores: {
      natureza: "card",
      contaId: CARTAO.id,
      parcelado: true,
      valor: "300",
      totalDeParcelas: "3",
      parcelaAtual: "",
    },
  });
  assert.equal(
    inputPorId(semN, "parcela_atual")?.includes('value=""'),
    true,
    `o campo da parcela atual nao saiu vazio: ${inputPorId(semN, "parcela_atual")}`
  );
});

// CONTROLE NEGATIVO, e e ele que torna o teste acima dificil de falsificar.
//
// Um campo vazio com o resumo ainda na tela e PIOR que o bug original: "1x de
// R$ 300,00" se le como resposta -- a tela afirma uma compra em uma parcela
// enquanto a pessoa esta no meio de digitar "6". Sem esta assercao, repor o
// `|| 1` sobrevive: o estado vazio e escolhido pelo teste, entao o `value=""`
// sai igual, e o resumo errado passaria sem ninguem olhar.
test("com o campo de parcelas vazio o resumo DESAPARECE, e nao vira 1x", () => {
  const html = renderizar({
    tipo: "expense",
    valores: {
      natureza: "card",
      contaId: CARTAO.id,
      parcelado: true,
      valor: "300",
      totalDeParcelas: "",
    },
  });

  assert.ok(
    !html.includes('data-testid="resumo-das-parcelas"'),
    "o resumo continuou na tela com o total de parcelas em branco"
  );
  // A NEGACAO EXPLICITA do numero que o fallback produzia. A assercao de cima
  // cai se o bloco inteiro sumir por outro motivo; esta nomeia o valor errado.
  assert.ok(
    !html.includes("1x de"),
    "a tela anunciou uma serie de 1 parcela a partir de um campo vazio"
  );
  assert.ok(
    !html.includes("R$ 300,00 · total"),
    "a tela montou um total a partir de um campo vazio"
  );
});

// O MESMO CONTROLE PARA O CAMPO N, E ELE NAO E REDUNDANTE COM O DE CIMA
//
// Para o M, `|| 1` nao produz resumo nenhum: `serieDeParcelas` recusa M = 1, e a
// frase desaparece do mesmo jeito. O controle negativo do M e, por isso, cego
// para o fallback -- medido, nao suposto (ver
// scripts/mutantes-campo-de-parcelas.mjs).
//
// No N o fallback APARECE: com a Parcela em branco e M = 3, cair em N = 1 monta
// uma serie VALIDA e a tela anuncia "3x de R$ 300,00 · total R$ 900,00" ao lado
// de um campo vazio. Esse e o resumo parcial que se le como resposta, e este e o
// unico teste que o pega.
test("com a parcela atual vazia o resumo tambem DESAPARECE", () => {
  const html = renderizar({
    tipo: "expense",
    valores: {
      natureza: "card",
      contaId: CARTAO.id,
      parcelado: true,
      valor: "300",
      totalDeParcelas: "3",
      parcelaAtual: "",
    },
  });

  assert.ok(
    !html.includes('data-testid="resumo-das-parcelas"'),
    "o resumo continuou na tela com a parcela atual em branco"
  );
  assert.ok(
    !html.includes("3x de"),
    'a tela anunciou "3x de R$ 300,00" com o campo da parcela atual vazio'
  );
  assert.ok(
    !html.includes("R$ 900,00"),
    "a tela montou o total da serie a partir de um campo vazio"
  );
});

test("apagar o campo entrega texto VAZIO ao estado, e nao 1", () => {
  // O MUTANTE QUE ESTE TESTE EXISTE PARA MATAR e `|| 1` de volta no `onChange`.
  // Enquanto ele existia, este era o bug inteiro: o estado nunca via o vazio.
  for (const [id, campo] of [
    ["total_installments", "totalDeParcelas"],
    ["parcela_atual", "parcelaAtual"],
  ]) {
    const { props, mudancas } = camposDoInput({ id });
    props.onChange({ target: { value: "" } });

    assert.deepEqual(
      mudancas,
      [{ [campo]: "" }],
      `apagar o ${id} nao chegou ao estado como string vazia`
    );
    // Nomeia os dois fallbacks que ja estiveram aqui, para a frase do erro dizer
    // qual deles voltou.
    assert.notDeepEqual(mudancas, [{ [campo]: 1 }], `${id} caiu no 1 numerico`);
    assert.notDeepEqual(mudancas, [{ [campo]: "1" }], `${id} caiu no "1"`);
  }
});

test("o campo digitado vai cru para o estado, sem conversao no caminho", () => {
  // "6" e nao 6: a conversao para numero acontece numa borda so
  // (`parcelaDigitada`), e um `parseInt` reaparecendo aqui e o comeco da volta
  // do bug -- com ele, "06" e "6x" chegariam ao estado como 6 e a tela passaria
  // a mostrar algo diferente do que foi digitado.
  const { props, mudancas } = camposDoInput({ id: "total_installments" });
  props.onChange({ target: { value: "6" } });
  assert.deepEqual(mudancas, [{ totalDeParcelas: "6" }]);
});

test("clicar no campo seleciona o conteudo, para a primeira tecla substituir", () => {
  // O "quando clicar ele apague" do pedido, sem deixar o campo em branco para
  // quem so passou por ele com Tab. Nao da para afirmar isto pelo HTML: `select`
  // e uma chamada no handler, nao um atributo.
  for (const id of ["total_installments", "parcela_atual"]) {
    const { props } = camposDoInput({ id });
    let selecionou = false;
    assert.ok(props.onFocus, `o ${id} nao tem onFocus`);
    props.onFocus({ target: { select: () => { selecionou = true; } } });
    assert.ok(
      selecionou,
      `clicar no ${id} nao selecionou o conteudo: a pessoa digita ao lado do "1" e produz 16`
    );
  }
});

test("sair do campo vazio repoe o padrao; sair com numero nao mexe", () => {
  for (const [id, campo] of [
    ["total_installments", "totalDeParcelas"],
    ["parcela_atual", "parcelaAtual"],
  ]) {
    const vazio = camposDoInput({ id });
    vazio.props.onBlur({ target: { value: "" } });
    assert.deepEqual(
      vazio.mudancas,
      [{ [campo]: "1" }],
      `sair do ${id} em branco nao repos o padrao`
    );

    // A OUTRA METADE, e sem ela o `onBlur` poderia estar sobrescrevendo SEMPRE.
    // Um `onBlur` que repoe "1" a cada saida apaga o 6 que a pessoa acabou de
    // digitar -- o mesmo bug com um gatilho diferente, e a assercao de cima
    // continuaria verde.
    const preenchido = camposDoInput({ id });
    preenchido.props.onBlur({ target: { value: "6" } });
    assert.deepEqual(
      preenchido.mudancas,
      [],
      `sair do ${id} com um numero digitado mexeu no estado`
    );
  }
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

// ---------------------------------------------------------------------------
// A RECEITA FIXA E A DURACAO (HMO-170)
// ---------------------------------------------------------------------------
// A issue pede que TODA movimentacao possa ser marcada como fixa, repetindo sem
// fim ou por N meses. A tela de receita nao tinha seletor de natureza nenhum,
// entao salario -- o exemplo do titulo -- nao tinha como virar entrada mensal.
//
// Aqui as asercoes sao POSITIVAS de proposito. O caso de cima
// ("receita nao tem natureza de despesa...") afirma sobre ausencia, e ausencia
// continuaria verde com o seletor da receita nunca renderizando: ele procura por
// "Tipo de Despesa", que a receita nao mostra nem antes nem depois.
//
// Nada aqui afirma sobre o TEXTO DAS OPCOES: o radix monta a lista num portal,
// que no HTML do servidor nao existe. O que da para cobrar e o rotulo, o texto
// de ajuda e os campos -- que e onde o defeito de arvore aparece.

test("a receita tem seletor de natureza, com o rotulo dela", () => {
  const html = renderizar({ tipo: "income" });
  assert.ok(
    html.includes("Tipo de Receita"),
    "a tela de receita nao oferece escolher entre pontual e fixa"
  );
  assert.ok(
    html.includes("Uma entrada avulsa"),
    "o texto de ajuda da receita pontual nao apareceu"
  );
});

test("receita fixa diz que vira regra, e pergunta o dia", () => {
  const html = renderizar({ tipo: "income", valores: { natureza: "fixed" } });

  assert.ok(html.includes("Salário"), "a ajuda da receita fixa nao cita o caso da issue");
  assert.ok(html.includes("Contas Previstas"), "a ajuda nao diz onde a regra aparece");
  // "Cai todo dia", nao "Vence todo dia": salario nao vence.
  assert.ok(html.includes("Cai todo dia"), "o dia da entrada mensal nao apareceu");
  assert.ok(html.includes('id="due_day"'));
});

test("os dois tipos mostram a duracao quando a natureza e fixa", () => {
  for (const tipo of ["income", "expense"]) {
    const html = renderizar({ tipo, valores: { natureza: "fixed" } });
    assert.ok(
      html.includes("Por quanto tempo"),
      `a tela de ${tipo} fixa nao pergunta por quanto tempo`
    );
    // O padrao e sem fim, e a tela diz o que isso significa.
    assert.ok(
      html.includes("Continua até você desativar"),
      `a tela de ${tipo} nao explica a repeticao indefinida`
    );
  }
});

test("a duracao NAO aparece no lancamento pontual", () => {
  for (const tipo of ["income", "expense"]) {
    const html = renderizar({ tipo, valores: { natureza: "one_off" } });
    assert.ok(
      !html.includes("Por quanto tempo"),
      `a tela de ${tipo} pontual pergunta por quanto tempo`
    );
  }
});

test("por N meses abre o campo do numero de meses", () => {
  const html = renderizar({
    tipo: "expense",
    valores: { natureza: "fixed", duracao: "contada" },
  });
  assert.ok(
    html.includes('id="meses_de_repeticao"'),
    "escolher 'por um numero de meses' nao abriu o campo do numero"
  );
  assert.ok(html.includes("Quantos meses"));
  // E o texto de "sem fim" sai da tela: os dois juntos se contradizem.
  assert.ok(!html.includes("Continua até você desativar"));
});

test("o campo de meses NAO aparece na repeticao indefinida", () => {
  const html = renderizar({
    tipo: "expense",
    valores: { natureza: "fixed", duracao: "indefinida" },
  });
  assert.ok(
    !html.includes('id="meses_de_repeticao"'),
    "o campo de meses aparece sem a pessoa ter pedido prazo"
  );
});

test("editando, nem o dia nem a duracao aparecem", () => {
  // Uma transacao gravada e um lancamento, nao uma regra. A pergunta "muda so
  // este mes ou os proximos?" e da tela de Contas Previstas.
  for (const tipo of ["income", "expense"]) {
    const html = renderizar({
      tipo,
      valores: { natureza: "fixed" },
      editando: true,
    });
    assert.ok(!html.includes("Por quanto tempo"), `${tipo}: duracao ao editar`);
    assert.ok(!html.includes('id="due_day"'), `${tipo}: dia de vencimento ao editar`);
  }
});

// ---------------------------------------------------------------------------
// A MASCARA DE DINHEIRO (HMO-171)
// ---------------------------------------------------------------------------
// `test-dinheiro.mjs` prova a mascara como funcao. Aqui a pergunta e outra, e e
// a que o teste de funcao pura nao alcanca: o campo do formulario esta LIGADO
// nela? O defeito que isso cobre e mudo -- `CampoDeValor` existir no repositorio
// e a tela continuar com o `type="number"` de antes compila, passa no tsc e
// passa em todas as outras suites.

test("o campo de valor e mascarado, nao um type=number", () => {
  for (const tipo of ["income", "expense"]) {
    const html = renderizar({ tipo, valores: { valor: "1000.00" } });

    // O que a pessoa ve.
    assert.ok(
      html.includes("R$ 1.000,00"),
      `a tela de ${tipo} nao mascarou o valor`
    );

    // E o que ela NAO pode ver: o valor plano cru dentro do campo. Esta metade e
    // a que denuncia o campo que ficou para tras -- um `type="number"` com
    // `value="1000.00"` tambem "mostra mil", e passaria pela asercao de cima se
    // ela estivesse sozinha.
    assert.ok(
      !html.includes('value="1000.00"'),
      `a tela de ${tipo} exibiu o valor plano em vez da mascara`
    );
  }
});

test("o campo de valor deixou de ser numerico e continua com teclado numerico", () => {
  // `type="number"` nao aceita mascara: o navegador rejeita o ponto de milhar e
  // devolve string vazia, o que apagaria o campo a cada tecla. O `inputMode` e
  // o que mantem o teclado do celular numerico depois da troca -- este app roda
  // instalado, e um campo de dinheiro que abre o teclado de letras e uma
  // regressao que nenhum teste de funcao pura ve.
  const html = renderizar({ tipo: "expense", valores: { valor: "50.00" } });
  const campo = html.match(/<input[^>]*id="amount"[^>]*>/)?.[0];

  assert.ok(campo, "o campo de valor sumiu da tela");
  assert.ok(!campo.includes('type="number"'), `o campo de valor voltou a ser numerico: ${campo}`);
  // Case-insensitive: este React entrega `inputMode` em camelCase no
  // `renderToStaticMarkup`, e o navegador aceita as duas formas. Fixar a caixa
  // aqui seria um teste sobre a versao do React, nao sobre a tela.
  assert.match(campo, /inputmode="decimal"/i, `o campo de valor perdeu o teclado numerico: ${campo}`);
});

test("parcelado, o UNICO campo de dinheiro continua mascarado e o total sai formatado", () => {
  // O teste antigo conferia a mascara do campo `installment_amount`, que a
  // HMO-211 eliminou. O que ele protegia continua valendo, agora sobre o campo
  // de valor de cima: ele nao pode virar `type="number"` (que aceita o menos) e
  // o total exibido tem de sair com simbolo e separador de milhar -- era um
  // `toLocaleString` escrevendo "3.000,00" sem "R$" na frente.
  const html = renderizar({
    tipo: "expense",
    valores: {
      natureza: "card",
      contaId: CARTAO.id,
      parcelado: true,
      valor: "1000.00",
      totalDeParcelas: "3",
    },
  });

  const campo = html.match(/<input[^>]*id="amount"[^>]*>/)?.[0];
  assert.ok(campo, "o campo de valor sumiu");
  assert.ok(!campo.includes('type="number"'), "o campo de valor ficou numerico");
  assert.ok(campo.includes("R$ 1.000,00"), `o valor nao foi mascarado: ${campo}`);

  // 3 x 1000 = 3000, com simbolo e separador de milhar.
  assert.ok(html.includes("R$ 3.000,00"), "o total das parcelas nao saiu formatado");
  assert.ok(!html.includes("R$3.000"), "o total saiu sem o espaco do padrao pt-BR");
});

test("o campo de valor nao oferece o menos", () => {
  // O campo era `type="number"` e aceitava "-30". `valorGravado` aplica
  // `-Math.abs`, entao "-30" numa tela de despesa virava `-(-30) = +30` --
  // dinheiro ENTRANDO numa tela de saida, e o saldo fechando errado para mais,
  // que e o lado do qual ninguem reclama.
  const html = renderizar({ tipo: "expense", valores: { valor: "-30" } });
  const campo = html.match(/<input[^>]*id="amount"[^>]*>/)?.[0];
  assert.ok(campo, "o campo de valor sumiu da tela");

  // So o `value`, e nao a tag inteira: a tag carrega as classes do primitivo
  // (`rounded-md`, `border-input`, ...) e "nao ha hifen no <input>" seria uma
  // asercao que nunca pode passar -- teste que falha por motivo errado e teste
  // que alguem apaga.
  const exibido = campo.match(/value="([^"]*)"/)?.[1];
  assert.equal(
    exibido,
    "R$ 30,00",
    `o campo de despesa mostrou algo que ele nao sabe emitir: ${exibido}`
  );
});

// ---------------------------------------------------------------------------
// A calculadora ao lado do campo (HMO-171, comentario da issue)
// ---------------------------------------------------------------------------
// "Todos os campos de valor ao lado do input deve ter uma calculadora que abre
// como um modal."
//
// A conta em si tem suite propria (test-calculadora-de-campo.mjs) e 14 mutantes.
// O que SO da para afirmar aqui e o que o JSX faz: que o botao chega junto do
// campo dentro de um formulario de verdade, e que ele nao envia esse formulario.
//
// O conteudo do modal nao da para afirmar: o radix monta o `DialogContent` num
// portal que so existe com o modal ABERTO, e no HTML do servidor ele nao sai --
// a mesma limitacao que o comentario do topo deste arquivo descreve para os
// seletores.

/** Os botoes de calculadora presentes no HTML, pelo `aria-label`. */
function botoesDeCalculadora(html) {
  return html.match(/<button[^>]*aria-label="Abrir calculadora[^"]*"[^>]*>/g) ?? [];
}

test("todo campo de valor da tela vem com a calculadora ao lado", () => {
  // Um campo de valor por tela no caso simples...
  for (const tipo of ["income", "expense"]) {
    const html = renderizar({ tipo, valores: { valor: "1000.00" } });
    assert.equal(
      botoesDeCalculadora(html).length,
      1,
      `a tela de ${tipo} nao trouxe exatamente uma calculadora`
    );
  }

  // ...e CONTINUA UM com o parcelamento aberto, porque a HMO-211 deixou um
  // campo de dinheiro so. Antes eram dois (o valor e "Valor da Parcela") e esta
  // metade do teste existia para pegar a calculadora pendurada numa tela so em
  // vez de no componente compartilhado.
  //
  // A assercao e EXATA (`=== 1`) e nao `>= 1` de proposito: ela e o que denuncia
  // o segundo campo de dinheiro voltando -- que e precisamente o que o pedido da
  // issue elimina ("perguntar se o valor que esta no input e o da parcela ou
  // total" pressupoe um input so).
  const parcelado = renderizar({
    tipo: "expense",
    valores: {
      natureza: "card",
      contaId: CARTAO.id,
      parcelado: true,
      valor: "1000.00",
      totalDeParcelas: "3",
    },
  });
  assert.equal(
    botoesDeCalculadora(parcelado).length,
    1,
    "parcelado mudou o numero de campos de dinheiro da tela"
  );
});

test("o botao da calculadora NAO envia o formulario", () => {
  // Um `<button>` sem `type` e `submit` por padrao. Estes campos vivem dentro de
  // um <form>, entao um botao sem `type` gravaria o lancamento -- com o valor
  // ANTIGO -- no clique que devia abrir a calculadora. Compila, renderiza, e o
  // sintoma e "o app salva sozinho quando eu abro a calculadora".
  const html = renderizar({ tipo: "expense", valores: { valor: "1000.00" } });

  for (const botao of botoesDeCalculadora(html)) {
    assert.match(
      botao,
      /type="button"/,
      `a calculadora enviaria o formulario ao abrir: ${botao}`
    );
  }
});

test("a calculadora acompanha o campo desabilitado", () => {
  // Campo travado com calculadora ativa e um jeito de escrever no que nao se
  // pode escrever: o `aoAplicar` e o proprio `onChange` do campo.
  const html = renderizar({ tipo: "expense", valores: { valor: "10.00" }, editando: true });
  const campo = html.match(/<input[^>]*id="amount"[^>]*>/)?.[0];
  assert.ok(campo, "o campo de valor sumiu da tela");

  // Esta tela nao desabilita o valor; a asercao e condicional de proposito, para
  // o dia em que alguma desabilitar. Sem isto o teste seria uma afirmacao sobre
  // a tela de hoje, e nao sobre a regra.
  if (campo.includes("disabled")) {
    for (const botao of botoesDeCalculadora(html)) {
      assert.match(botao, /disabled/, `campo travado com calculadora ativa: ${botao}`);
    }
  }
});

// ---------------------------------------------------------------------------
// A CONFIRMACAO, E O CAMPO DE DATA QUE ELA APAGA (HMO-188)
// ---------------------------------------------------------------------------
// `camposDoTipo` ja decide isso e tem teste proprio. Aqui o que se prova e que
// o JSX OBEDECE: uma decisao certa com o campo renderizado do mesmo jeito
// passaria verde em test-lancamento.mjs e mostraria, na tela de verdade, um
// campo "Data do pagamento" dentro de um lancamento que a pessoa acabou de
// dizer que nao pagou.

test("a checkbox de confirmacao aparece nas duas telas, com o verbo certo", () => {
  const despesa = renderizar({ tipo: "expense" });
  assert.match(despesa, /id="confirmado"/);
  assert.match(despesa, /Já paguei/);
  assert.doesNotMatch(despesa, /Já recebi/);

  const receita = renderizar({ tipo: "income" });
  assert.match(receita, /id="confirmado"/);
  assert.match(receita, /Já recebi/);
  assert.doesNotMatch(receita, /Já paguei/);
});

test("confirmado mostra as DUAS datas; previsto mostra so a prevista", () => {
  const confirmado = renderizar({ tipo: "expense" });
  assert.match(confirmado, /id="date"/);
  assert.match(confirmado, /id="expected-date"/);
  assert.match(confirmado, /Data do pagamento/);

  const previsto = renderizar({
    tipo: "expense",
    valores: { confirmado: false },
  });
  // O campo da data real SAI da tela. Deixa-lo com a data de hoje dentro faria
  // ele parecer uma resposta ja dada -- e o valor iria para
  // `transaction_date` de uma transacao que nao existe.
  assert.doesNotMatch(previsto, /id="date"/);
  assert.doesNotMatch(previsto, /Data do pagamento/);
  assert.match(previsto, /id="expected-date"/);
  // E a obrigatoriedade aparece no rotulo.
  assert.match(previsto, /Data prevista \*/);
});

test("o aviso diz o que a confirmacao faz com o saldo, nos dois estados", () => {
  // E a unica coisa na tela que muda de TABELA. Sem o aviso, desmarcar a
  // checkbox parece um detalhe de rotulo, e a pessoa nao entende por que o
  // dinheiro nao saiu da conta.
  const confirmado = renderizar({ tipo: "expense" });
  assert.match(confirmado, /sai do saldo da conta agora/);

  const previsto = renderizar({
    tipo: "expense",
    valores: { confirmado: false },
  });
  assert.match(previsto, /Contas Previstas/);
  assert.match(previsto, /não mexe no saldo/);

  const receita = renderizar({ tipo: "income" });
  assert.match(receita, /entra no saldo da conta agora/);
});

test("fixa nao oferece a confirmacao", () => {
  // A checkbox nao pode estar ali: regra mensal ja e previsao por definicao, e a
  // confirmacao dela acontece mes a mes em Contas Previstas.
  const html = renderizar({
    tipo: "expense",
    valores: { natureza: "fixed", confirmado: false },
  });
  assert.doesNotMatch(html, /id="confirmado"/);
});

// ---------------------------------------------------------------------------
// A FIXA NAO TEM CAMPO DE DATA, NA TELA (HMO-247)
// ---------------------------------------------------------------------------
// `camposDoTipo` ja decide isso e tem teste proprio, mas a decisao certa com o
// JSX ignorando ela e exatamente o defeito que este arquivo existe para pegar: o
// bloco da data esta a 500 linhas do seletor de natureza, e um `{true && ...}`
// ali deixaria os dois campos na tela com a funcao pura verde do outro lado.

test("fixa nao tem NENHUM campo de data na tela, nos dois tipos", () => {
  for (const tipo of ["expense", "income"]) {
    for (const confirmado of [false, true]) {
      const html = renderizar({
        tipo,
        valores: { natureza: "fixed", confirmado, diaDeVencimento: "10" },
      });
      assert.doesNotMatch(html, /id="date"/, `${tipo}: o campo "Data" ficou na tela`);
      assert.doesNotMatch(html, /id="expected-date"/, `${tipo}: data prevista na tela`);
      // E os rotulos tambem nao: um `<Label>` orfao continuaria pedindo uma data.
      assert.doesNotMatch(html, /Data do pagamento/, `${tipo}: rotulo de data na tela`);
      assert.doesNotMatch(html, /Data do recebimento/, `${tipo}: rotulo de data na tela`);
      assert.doesNotMatch(html, /Data prevista/, `${tipo}: rotulo de prevista na tela`);
      // A resposta que FICA e o dia do vencimento.
      assert.match(html, /id="due_day"/, `${tipo}: perdeu o dia do vencimento`);
    }
  }
});

test("a tela diz quando a primeira cobranca cai, e so com o dia preenchido", () => {
  // Tirando "Data", este dia virou a unica resposta para "quando isso cai?" -- e
  // "ja cai este mes?" nao tinha onde ser respondida.
  const despesa = renderizar({
    tipo: "expense",
    valores: { natureza: "fixed", diaDeVencimento: "10" },
  });
  assert.match(despesa, /A primeira cobrança é no próximo dia 10/);
  assert.match(despesa, /neste mês, se ele ainda não passou/);

  // A receita fala de ENTRADA: "cobrança" no salario e a frase errada, e e o
  // mesmo defeito que deu nome a HMO-170.
  const receita = renderizar({
    tipo: "income",
    valores: { natureza: "fixed", diaDeVencimento: "5" },
  });
  assert.match(receita, /A primeira entrada é no próximo dia 5/);
  assert.doesNotMatch(receita, /cobrança/);

  // Com o campo vazio a frase NAO aparece: "no próximo dia " sem numero e pior
  // que silencio. Mesma coisa para um dia que a validacao recusa -- a tela nao
  // pode prometer a cobranca de um dia 45.
  for (const diaDeVencimento of ["", "0", "45"]) {
    const html = renderizar({
      tipo: "expense",
      valores: { natureza: "fixed", diaDeVencimento },
    });
    assert.doesNotMatch(
      html,
      /primeira cobrança/,
      `prometeu a primeira cobranca com diaDeVencimento "${diaDeVencimento}"`
    );
  }
});

test("editando nao oferece a confirmacao", () => {
  // O que esta gravado ja mexeu no saldo. Desmarcar ali significaria apagar a
  // transacao e criar uma previsao no lugar, e o caminho de volta ja existe e e
  // outro (o estorno da baixa, em Contas Previstas).
  const html = renderizar({
    tipo: "expense",
    editando: true,
    valores: { confirmado: false },
  });
  assert.doesNotMatch(html, /id="confirmado"/);
  assert.match(html, /id="date"/);
});

// ---------------------------------------------------------------------------
// O GASTO NO CARTAO, NA TELA (HMO-209)
// ---------------------------------------------------------------------------
// `camposDoTipo` ja decide isso e tem teste proprio em test-lancamento.mjs. O
// que se prova aqui e que o JSX OBEDECE -- a decisao certa com a checkbox
// renderizada de qualquer jeito passaria verde na funcao pura e mostraria, na
// tela de verdade, "Ja paguei" num gasto de cartao. E a checkbox na tela nao e
// cosmetica: marcar ou desmarcar o `confirmado` e o que mandava a compra para
// Contas a Pagar.

test("gasto no cartao nao mostra 'Ja paguei' nem data prevista", () => {
  const html = renderizar({
    tipo: "expense",
    valores: { natureza: "card", contaId: "a", confirmado: false },
  });

  // `confirmado: false` no estado de proposito: e o valor que sobra quando a
  // pessoa desmarca a checkbox em "pontual" e depois troca para "cartao". Se a
  // tela ainda o obedecesse, a compra iria para a agenda com o campo FORA da
  // tela -- o defeito original, agora sem nada que o explicasse.
  assert.doesNotMatch(html, /id="confirmado"/);
  assert.doesNotMatch(html, /Já paguei/);
  assert.doesNotMatch(html, /id="expected-date"/);
  assert.doesNotMatch(html, /Data prevista/);

  // A data da compra FICA, e com o rotulo dela: e ela que decide em que fatura a
  // compra cai.
  assert.match(html, /id="date"/);
  assert.match(html, /Data da compra/);
  assert.doesNotMatch(html, /Data do pagamento/);
});

test("a despesa pontual continua com a checkbox e as duas datas", () => {
  // Controle do caso acima: uma tela que perdesse a confirmacao em TODA despesa
  // passaria no teste anterior e quebraria a feature da HMO-188 por inteiro.
  const html = renderizar({
    tipo: "expense",
    valores: { natureza: "one_off", confirmado: false },
  });
  assert.match(html, /id="confirmado"/);
  assert.match(html, /Já paguei/);
  assert.match(html, /id="expected-date"/);
  assert.doesNotMatch(html, /Data da compra/);
});

// ---------------------------------------------------------------------------
// O CARTAO QUE A TELA ANTERIOR JA ESCOLHEU (HMO-210)
// ---------------------------------------------------------------------------
// "Lancar gasto neste cartao", em `/dashboard/cartoes/[id]`, abre este
// formulario com `natureza: card` e o cartao travado. A trava e de ARVORE: com
// o seletor no lugar, a pessoa clica no Nubank, cai aqui, e grava no Visa --
// dois cartoes dela, valor plausivel, nada acusa. E ela so descobre ao abrir a
// fatura do cartao em que nao lancou.
//
// Texto, e nao `<Select disabled>`: o radix nao imprime o valor escolhido na
// renderizacao de servidor, entao o nome do cartao sairia em branco no primeiro
// quadro -- e um seletor cinza convida ao clique que nao funciona.

test("com cartao fixado, o cartao e texto e nao seletor", () => {
  const html = renderizar({
    tipo: "expense",
    valores: { natureza: "card", contaId: CARTAO.id },
    cartaoFixado: CARTAO,
  });

  // O nome aparece na tela -- e isso que um seletor do radix nao faz no
  // servidor.
  assert.match(html, /Visa/);
  // E nao ha seletor de conta para trocar de cartao.
  assert.doesNotMatch(html, /<button[^>]*id="account"/);
});

test("com cartao fixado, a natureza tambem nao se troca", () => {
  // "Despesa Fixa" aqui gravaria uma regra mensal em `recurring_rules` em vez
  // da compra, e a tela de origem e a FATURA de um cartao.
  const html = renderizar({
    tipo: "expense",
    valores: { natureza: "card", contaId: CARTAO.id },
    cartaoFixado: CARTAO,
  });

  // A ancora e o SELETOR, nao os nomes das opcoes: o radix renderiza a lista
  // num portal que so existe com ele aberto, entao "Despesa Fixa" nao sai no
  // HTML do servidor nem quando o seletor esta na tela. Afirmar pelos nomes
  // passaria verde com o seletor inteiro de volta no lugar.
  assert.doesNotMatch(html, /id="natureza"/);
  // E o que ficou no lugar dele diz qual natureza e.
  assert.match(html, /Gasto no Cartão/);
});

test("sem cartao fixado os dois seletores continuam no lugar", () => {
  // Controle positivo dos dois testes acima: uma tela que perdesse os seletores
  // em TODA despesa passaria neles e quebraria o lancamento normal por inteiro.
  const html = renderizar({
    tipo: "expense",
    valores: { natureza: "card" },
  });

  assert.match(html, /<button[^>]*id="account"/);
  assert.match(html, /<button[^>]*id="natureza"/);
  assert.match(html, /Tipo de Despesa/);
});

test("cartao fixado continua mostrando valor, categoria e data da compra", () => {
  // A trava e so em natureza e conta. Travar o resto deixaria o formulario sem
  // como lancar nada.
  const html = renderizar({
    tipo: "expense",
    valores: { natureza: "card", contaId: CARTAO.id },
    cartaoFixado: CARTAO,
  });

  assert.match(html, /id="description"/);
  assert.match(html, /id="category"/);
  assert.match(html, /id="date"/);
  assert.match(html, /Data da compra/);
  // E a HMO-209 continua valendo: no cartao nao se pergunta "Ja paguei".
  assert.doesNotMatch(html, /Já paguei/);
});

test("cartao fixado nao traz o aviso de 'nao tem cartao cadastrado'", () => {
  // O aviso existe para o seletor vazio. Com cartao fixado ha um cartao -- e
  // ele e o da tela anterior; o aviso diria que ela nao tem o cartao que acabou
  // de abrir.
  const html = renderizar({
    tipo: "expense",
    valores: { natureza: "card", contaId: CARTAO.id },
    contas: [],
    cartaoFixado: CARTAO,
  });

  assert.doesNotMatch(html, /não tem nenhum cartão de crédito cadastrado/);
});

// ---------------------------------------------------------------------------
// AS DUAS DATAS SAO O CAMPO MASCARADO, E NAO O CONTROLE NATIVO (HMO-238)
// ---------------------------------------------------------------------------
// Os casos acima afirmam que os campos de data ESTAO na tela (`id="date"`), e
// continuariam verdes com o `<input type="date">` de volta -- que e justamente o
// controle medido como incapaz de receber uma data digitada: na largura desta
// tela ele gravava "2026-10-03" para quem digitou 10 de marco, porque a ordem dos
// segmentos sai do APARELHO e nao do nosso codigo.
//
// Estes casos afirmam sobre o ATRIBUTO, que e o que distingue os dois.

test("a data do pagamento e o campo mascarado dd/mm/aaaa", () => {
  const html = renderizar({ tipo: "expense", valores: { data: "2026-10-02" } });
  const campo = inputPorId(html, "date");

  assert.ok(campo, 'nao achei o <input id="date">');
  assert.match(campo, /type="text"/);
  assert.match(campo, /placeholder="dd\/mm\/aaaa"/);
  // A ordem na tela e a NOSSA: o dia vem primeiro, escrito.
  assert.match(campo, /value="02\/10\/2026"/);
  // E o que o campo nativo trazia de volta nao esta mais la.
  assert.doesNotMatch(campo, /type="date"/);
  assert.doesNotMatch(campo, /value="2026-10-02"/);
});

test("a data prevista tambem e o campo mascarado", () => {
  // O segundo dos dois campos que esta issue troca. Sem este caso, trocar so um
  // deles passaria verde.
  const html = renderizar({
    tipo: "expense",
    valores: { dataPrevista: "2026-10-02" },
  });
  const campo = inputPorId(html, "expected-date");

  assert.ok(campo, 'nao achei o <input id="expected-date">');
  assert.match(campo, /type="text"/);
  assert.match(campo, /placeholder="dd\/mm\/aaaa"/);
  assert.match(campo, /value="02\/10\/2026"/);
  assert.doesNotMatch(campo, /type="date"/);
});

test("quem prefere apontar continua tendo calendario", () => {
  // Trocar o controle nativo para consertar a digitacao nao pode custar o
  // calendario -- seria trocar uma reclamacao por outra.
  const html = renderizar({ tipo: "expense", valores: { data: "2026-10-02" } });

  assert.match(html, /aria-label="Escolher Data do pagamento no calendário"/);
  // O picker nativo continua existindo para isso, escondido atras do botao.
  assert.match(html, /<input[^>]*type="date"[^>]*aria-hidden="true"/);
});
