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
  aoMudarSaldoReal: () => {},
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
      saldoReal: "",
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

test("o formulario pede QUANTO O CARTAO DIZ, e nao o valor do ajuste", () => {
  // O PEDIDO DA 2a VOLTA DA ISSUE: "deve ser automatico, eu lanco o valor real
  // que esta hoje meu cartao". Um campo rotulado "Valor do ajuste" devolveria a
  // subtracao para as maos do usuario -- que e exatamente o que ele pediu para
  // nao fazer. E os dois botoes de lado nao podem sobrar na tela: com a direcao
  // derivada do sinal da diferenca, um botao "Abate da fatura" seria um controle
  // que nao controla nada.
  const t = texto(renderBloco({ aberto: true }));
  assert.match(t, /Quanto o cartão diz hoje/);
  assert.match(t, /A diferença é calculada e lançada sozinha/);
  assert.match(t, /Salvar ajuste/);
  assert.doesNotMatch(t, /Valor do ajuste/);
  assert.doesNotMatch(t, /Aumenta a fatura/);
  assert.doesNotMatch(t, /Abate da fatura/);
});

test("o campo do saldo real e o campo de dinheiro do app, nao um type=number", () => {
  // `<input type="number">` aceitaria "1.290,00" e `parseFloat` daria 1: a
  // fatura inteira virando um real de saldo real, sem erro no caminho
  // (lib/dinheiro.ts) -- e o ajuste lancado seria de -R$ 319,00.
  const html = renderBloco({ aberto: true, saldoReal: "1290.00" });
  assert.doesNotMatch(html, /id="saldo-real-do-cartao"[^>]*type="number"/);
  // A assercao e sobre o ATRIBUTO, e nao sobre o texto da pagina: o valor de um
  // `<input>` mora dentro da tag, e `texto()` apaga tudo o que esta dentro de
  // tag. Procura-lo no texto normalizado daria verde com o campo vazio -- a
  // previa abaixo imprime "R$ 1.290,00" e casaria o padrao sozinha.
  assert.match(html, /id="saldo-real-do-cartao"[^>]*value="R\$ 1\.290,00"/);
});

test("a previa diz de que fatura ela fala, e para onde o total vai", () => {
  const t = texto(
    renderBloco({ aberto: true, saldoReal: "370.00", totalSemAjuste: 320 })
  );
  assert.match(t, /A fatura de outubro de 2026 passa de R\$ 320,00 para R\$ 370,00/);
});

test("a previa nomeia a DIFERENCA, e nao so o total final", () => {
  // Era a subtracao que esta volta da issue tirou das maos do usuario: imprimir
  // so "passa de 320 para 370" a devolve para ele na hora de conferir.
  const acrescimo = texto(
    renderBloco({ aberto: true, saldoReal: "370.00", totalSemAjuste: 320 })
  );
  assert.match(acrescimo, /acréscimo de R\$ 50,00/);

  const abatimento = texto(
    renderBloco({ aberto: true, saldoReal: "270.00", totalSemAjuste: 320 })
  );
  assert.match(abatimento, /passa de R\$ 320,00 para R\$ 270,00/);
  assert.match(abatimento, /abatimento de R\$ 50,00/);
  // O lado nao pode vir trocado: a palavra errada com o numero certo e pior que
  // numero nenhum, porque o usuario confirma lendo a palavra.
  assert.doesNotMatch(abatimento, /acréscimo/);
});

test("saldo real MENOR que a fatura abate -- o sinal sai da conta, nao de um botao", () => {
  // O caso que a versao anterior desta tela exigia um clique para expressar.
  // Aqui ele e consequencia de 270 < 320, e nada na tela precisa ser escolhido.
  const t = texto(
    renderBloco({ aberto: true, saldoReal: "270.00", totalSemAjuste: 320 })
  );
  assert.match(t, /para R\$ 270,00/);
  assert.doesNotMatch(t, /para R\$ 370,00/);
});

test("a previa NAO aparece sem mes que a nomeie", () => {
  // Numero certo respondendo uma pergunta que o leitor nao sabe qual e: o
  // seletor de mes fica dois blocos acima.
  const t = texto(
    renderBloco({ aberto: true, saldoReal: "370.00", rotuloDoMes: null })
  );
  assert.doesNotMatch(t, /passa de/);
});

test("a previa NAO aparece sobre uma fatura que nao carregou", () => {
  // A base da conta e o total da fatura. Sem leitura boa, "passa de R$ 0,00 para
  // R$ 370,00" seria um numero inventado com cara de numero certo.
  const t = texto(
    renderBloco({ aberto: true, saldoReal: "370.00", estado: "sem-rede" })
  );
  assert.doesNotMatch(t, /passa de/);
});

test("sem o total da fatura NAO se promete ajuste, e o Salvar fica apagado", () => {
  // `totalSemAjuste: null` e "a tela nao leu a fatura". O defeito que esta
  // assercao tranca e o `?? 0`: com a base em zero, a previa anunciaria
  // "passa de R$ 0,00 para R$ 370,00" -- a tela prometendo lancar como ajuste a
  // FATURA INTEIRA, com a conta visivelmente fechando.
  const html = renderBloco({
    aberto: true,
    saldoReal: "370.00",
    totalSemAjuste: null,
  });
  const t = texto(html);
  assert.doesNotMatch(t, /passa de/);
  assert.match(t, /Não foi possível ler o total desta fatura/);
  assert.match(html, /disabled[^>]*>Salvar ajuste|>Salvar ajuste/);
  // O botao de gravar tem de estar DESABILITADO: habilitado, ele manda um POST
  // que o servidor recusa, e o usuario descobre pelo toast o que a tela sabia.
  const antesDoSalvar = html.slice(0, html.indexOf("Salvar ajuste"));
  assert.match(
    antesDoSalvar.slice(-200),
    /disabled/,
    "o Salvar precisa estar desabilitado sem o total da fatura"
  );
});

test("A FATURA JA BATE nao e erro, e avisa que o ajuste velho vai sair", () => {
  // Armadilha 4: `fecha: true` e o melhor desfecho possivel, e tem texto
  // proprio. O aviso do ajuste que SAI e obrigatorio -- sem ele, "Salvar" sobre
  // uma fatura que bate remove R$ 50 da fatura sem nada ter dito isso.
  const t = texto(
    renderBloco({
      aberto: true,
      saldoReal: "320.00",
      totalSemAjuste: 320,
      categoriaDeAjuste: CATEGORIA_DE_AJUSTE,
      valorAtual: 50,
    })
  );
  assert.match(t, /A fatura de outubro de 2026 já fecha nesse valor/);
  assert.match(t, /R\$ 50,00 que está valendo vai ser removido/);
  // Nao e previa, e nao e erro.
  assert.doesNotMatch(t, /passa de/);
  assert.doesNotMatch(t, /Informe quanto o cartão diz hoje/);
  // E o botao diz o que ele FAZ: ele vai remover, nao gravar.
  assert.match(t, /Remover ajuste/);
  assert.doesNotMatch(t, /Salvar ajuste/);
});

test("fatura que bate SEM ajuste gravado nao promete remover nada", () => {
  // Aqui nao ha nada a gravar nem a remover: dizer "o ajuste vai ser removido"
  // inventaria um ajuste, e um Salvar ativo prometeria gravar um no-op.
  const html = renderBloco({
    aberto: true,
    saldoReal: "320.00",
    totalSemAjuste: 320,
    categoriaDeAjuste: null,
    valorAtual: null,
  });
  const t = texto(html);
  assert.match(t, /já fecha nesse valor: não há diferença a lançar/);
  assert.doesNotMatch(t, /vai ser removido/);
  const antesDoSalvar = html.slice(0, html.indexOf("Salvar ajuste"));
  assert.match(antesDoSalvar.slice(-200), /disabled/);
});

test("a fatura que bate em ZERO tambem e um caso bom", () => {
  // Cartao sem compra no mes e saldo real R$ 0,00. `Number("")` e 0 em
  // JavaScript, entao o caminho que trata campo vazio como zero daria ESTE
  // mesmo resultado -- e e por isso que ele e um teste separado do de baixo.
  const t = texto(
    renderBloco({ aberto: true, saldoReal: "0.00", totalSemAjuste: 0 })
  );
  assert.match(t, /já fecha nesse valor/);
});

test("campo vazio nao grita erro antes de o usuario digitar, e nao vira zero", () => {
  // As duas assercoes sao a mesma armadilha (`Number("") === 0`) vista pelos
  // dois lados: com o campo vazio lido como zero, a tela anunciaria "a fatura
  // passa de R$ 320,00 para R$ 0,00" -- um estorno da fatura inteira oferecido a
  // quem ainda nao digitou nada.
  const t = texto(renderBloco({ aberto: true, saldoReal: "", totalSemAjuste: 320 }));
  assert.doesNotMatch(t, /Informe quanto o cartão diz hoje/);
  assert.doesNotMatch(t, /passa de/);
  assert.doesNotMatch(t, /já fecha nesse valor/);
});

test("centavos: a diferenca nao escorrega em ponto flutuante", () => {
  // 1290 - 1240.10 em `number` da 49.899999999999995. A previa imprimiria
  // "R$ 49,90" por arredondamento de exibicao, e o que vai para o banco e o que
  // esta assertado aqui -- a conta e em centavos inteiros.
  const t = texto(
    renderBloco({ aberto: true, saldoReal: "1290.00", totalSemAjuste: 1240.1 })
  );
  assert.match(t, /passa de R\$ 1\.240,10 para R\$ 1\.290,00/);
  assert.match(t, /acréscimo de R\$ 49,90/);
});

test("fatura e saldo real iguais em centavos fecham, e nao geram ajuste de R$ 0,00", () => {
  // `0.1 + 0.2 - 0.3` nao e zero em ponto flutuante. Se a subtracao fosse em
  // reais, esta fatura daria uma diferenca minuscula e a tela ofereceria gravar
  // um ajuste -- de R$ 0,00 depois do arredondamento da coluna.
  const t = texto(
    renderBloco({ aberto: true, saldoReal: "0.30", totalSemAjuste: 0.1 + 0.2 })
  );
  assert.match(t, /já fecha nesse valor/);
  assert.doesNotMatch(t, /passa de/);
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
    saldoReal: "",
    descricao: "",
    ...SEM_HANDLER,
    ...props,
  });
}
