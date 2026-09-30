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

test("o valor da parcela tambem e mascarado, e o total sai formatado", () => {
  const html = renderizar({
    tipo: "expense",
    valores: { parcelado: true, valorDaParcela: "1000.00", totalDeParcelas: 3 },
  });

  const campo = html.match(/<input[^>]*id="installment_amount"[^>]*>/)?.[0];
  assert.ok(campo, "o campo de parcela sumiu");
  assert.ok(!campo.includes('type="number"'), "o campo de parcela ficou numerico");
  assert.ok(campo.includes("R$ 1.000,00"), `a parcela nao foi mascarada: ${campo}`);

  // 3 x 1000 = 3000. Com separador de milhar, que era justamente o que o
  // `toLocaleString` antigo escrevia sem simbolo nenhum na frente.
  assert.ok(html.includes("R$ 3.000,00"), "o total das parcelas nao saiu formatado");
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

  // ...e DOIS quando o parcelamento abre o campo da parcela. Esta metade e a que
  // denuncia uma calculadora pendurada numa tela so em vez de no componente
  // compartilhado: com o botao no lugar errado, o campo da parcela ficaria sem.
  const parcelado = renderizar({
    tipo: "expense",
    valores: { parcelado: true, valorDaParcela: "1000.00", totalDeParcelas: 3 },
  });
  assert.equal(
    botoesDeCalculadora(parcelado).length,
    2,
    "o campo da parcela ficou sem calculadora"
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

test("fixa nao oferece a confirmacao, e NAO perde o campo de data", () => {
  // O campo de data de uma despesa fixa e o `start_date` da regra. Um
  // `confirmado: false` parado no estado nao pode apaga-lo -- e a checkbox nao
  // pode estar ali, porque regra mensal ja e previsao por definicao.
  const html = renderizar({
    tipo: "expense",
    valores: { natureza: "fixed", confirmado: false },
  });
  assert.doesNotMatch(html, /id="confirmado"/);
  assert.match(html, /id="date"/);
  // Nem a data prevista: quem diz quando e o dia do vencimento, e dois campos
  // para a mesma pergunta se contradizem.
  assert.doesNotMatch(html, /id="expected-date"/);
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
