#!/usr/bin/env node
// =====================================================
// PULODOGATO - a TELA de gastos do cartao (HMO-210)
// =====================================================
//   npm run test:tela-do-cartao
//
// POR QUE ESTE TESTE RENDERIZA OS COMPONENTES
// -------------------------------------------
// `lib/fatura-do-cartao.ts` ja tem suite propria, e ela passa verde com todos
// os defeitos que esta tela pode ter de verdade:
//
//   - o total imprimindo sem o rotulo do mes ao lado. Numero certo, pergunta
//     desconhecida -- a fatura de outubro e a de setembro se parecem;
//   - "Nenhum gasto neste cartao" aparecendo quando a tela nao conseguiu LER a
//     fatura. A afirmacao e sobre o que NAO esta na arvore, e isso nao e uma
//     decisao que de para extrair para funcao pura;
//   - "Arquivar" dentro do link do cartao. O handler roda, o link navega, e a
//     pessoa arquiva o cartao e cai na tela dele. Nada disso da erro.
//
// Aqui o `react-dom/server` renderiza os mesmos arquivos que o app importa.
//
// O QUE ELE NAO COBRE
// -------------------
// CSS. Nenhum teste daqui aplica estilo, entao o que esta por cima do que fica
// de fora. Cor sai de token e tem guarda propria (check-color-tokens).
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FaturaDoCartao } from "../.tmp-tela-do-cartao/components/cartoes/FaturaDoCartao.js";
import { CartaoDaLista } from "../.tmp-tela-do-cartao/components/cartoes/CartaoDaLista.js";

const MEU_CARTAO = "11111111-1111-1111-1111-111111111111";
const OUTRO_CARTAO = "22222222-2222-2222-2222-222222222222";

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

const linha = (accountId, descricao, valor, dia) => ({
  transaction_id: `${accountId}-${dia}`,
  user_id: "u1",
  account_id: accountId,
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

const FATURA = {
  account_id: MEU_CARTAO,
  account_name: "Nubank",
  closing_day: 5,
  due_day: 15,
  invoice_month: "2026-10-01",
  due_date: "2026-10-15",
  total: 320,
  line_count: 2,
  lines: [
    linha(MEU_CARTAO, "Mercado do mes", 200, "03"),
    linha(MEU_CARTAO, "Farmacia", 120, "07"),
  ],
};

const render = (props) =>
  renderToStaticMarkup(
    h(FaturaDoCartao, {
      conta: CONTA,
      fatura: FATURA,
      mes: "2026-10",
      estado: "fresco",
      aoMudarMes: () => {},
      ...props,
    })
  );

/**
 * O HTML sem tag nenhuma, com os espacos normalizados.
 *
 * Necessario porque os valores nascem partidos por elemento: o rotulo e o
 * numero sao irmaos, e procurar "Gastos de outubro de 2026 R$ 320,00" no HTML
 * cru nao acha nada -- ha tag entre os dois.
 */
const texto = (html) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;| /g, " ")
    .replace(/&#x27;|&quot;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

// ---------------------------------------------------------------------------
// 1. O PEDIDO DA ISSUE: OS GASTOS DAQUELE CARTAO, E SO ELES
// ---------------------------------------------------------------------------

test("a lista traz as compras lancadas no cartao", () => {
  const t = texto(render());

  assert.ok(t.includes("Mercado do mes"), "falta a compra do mercado");
  assert.ok(t.includes("Farmacia"), "falta a compra da farmacia");
  assert.ok(t.includes("2 gastos nesta fatura"), `contagem fora: ${t}`);
});

test("a lista NAO traz a compra do outro cartao", () => {
  // A assercao que da nome a issue. A linha intrusa entra na fatura certa, com
  // valor plausivel: sem o filtro ela aparece na tela e nada fica vermelho.
  const contaminada = {
    ...FATURA,
    lines: [...FATURA.lines, linha(OUTRO_CARTAO, "Posto do outro cartao", 999, "05")],
  };

  const t = texto(render({ fatura: contaminada }));

  assert.ok(t.includes("Mercado do mes"), "a compra deste cartao sumiu");
  assert.ok(
    !t.includes("Posto do outro cartao"),
    "a compra do outro cartao apareceu na lista"
  );
  assert.ok(
    !t.includes("999,00"),
    "o valor do outro cartao apareceu na lista"
  );
  assert.ok(t.includes("2 gastos nesta fatura"), "a contagem incluiu a intrusa");
});

test("a fatura de outro cartao nao e desenhada como se fosse desta", () => {
  // `faturaDoCartao` devolve null quando a resposta nao tem a fatura deste
  // cartao, e a tela tem que tratar null -- nao desenhar a do vizinho.
  const t = texto(render({ fatura: null }));

  assert.ok(!t.includes("Posto"), "linha de outra fatura apareceu");
  assert.ok(t.includes("Nenhum gasto neste cartão"), `esperava o vazio: ${t}`);
});

// ---------------------------------------------------------------------------
// 2. O TOTAL ANDA COM O MES
// ---------------------------------------------------------------------------
// "O rotulo do mes da fatura tem que aparecer junto do total -- bloco sem eixo
// de tempo mente no rotulo."

test("o total aparece com o mes da fatura no mesmo bloco", () => {
  const t = texto(render());

  // Juntos, e na ordem: o rotulo imediatamente antes do numero. Procurar os
  // dois em qualquer lugar do HTML passaria com o seletor de mes num canto e o
  // total no outro.
  assert.match(t, /Gastos de outubro de 2026 R\$ 320,00/);
});

test("trocar o mes troca o rotulo (o eixo de tempo e vivo)", () => {
  const t = texto(render({ mes: "2026-09" }));

  assert.ok(t.includes("Gastos de setembro de 2026"), `rotulo fora: ${t}`);
  assert.ok(!t.includes("outubro de 2026"), "o rotulo ficou preso em outubro");
});

test("o seletor do mes mostra o mes que esta na tela", () => {
  const html = render();

  assert.match(html, /type="month"/);
  assert.match(html, /value="2026-10"/);
});

test("sem mes para nomear, o total nao aparece", () => {
  // Um mes ilegivel deixaria o rotulo quebrado. A regra e a mesma do estado de
  // leitura: sem como dizer de QUANDO e o numero, ele nao sai.
  const t = texto(render({ mes: "2026-13" }));

  assert.ok(!t.includes("R$ 320,00"), `o total saiu sem eixo de tempo: ${t}`);
  assert.ok(t.includes("—"), "faltou o travessao de numero indisponivel");
});

test("o vencimento daquela fatura aparece", () => {
  assert.ok(texto(render()).includes("Vence em 15/10"));
});

// ---------------------------------------------------------------------------
// 3. OS DOIS PEDAGIOS DA CASA
// ---------------------------------------------------------------------------

test("sem rede o total vira travessao, e nao R$ 0,00", () => {
  const t = texto(render({ estado: "sem-rede", fatura: null }));

  assert.ok(!t.includes("R$ 0,00"), `imprimiu zero confiante: ${t}`);
  assert.ok(t.includes("—"), "faltou o travessao");
});

test("sem rede a tela NAO afirma que o cartao nao teve gasto", () => {
  // A frase de vazio e uma afirmacao sobre o dinheiro da pessoa. Com a fatura
  // nao lida, ela diz que o mes nao teve compra -- e pode ter tido.
  for (const estado of ["sem-rede", "erro-do-servidor", "do-aparelho", null]) {
    const t = texto(render({ estado, fatura: null }));

    assert.ok(
      !t.includes("Nenhum gasto neste cartão"),
      `com estado ${estado} a tela afirmou o vazio`
    );
    assert.ok(
      t.includes("Não foi possível ler os gastos deste cartão agora."),
      `com estado ${estado} faltou dizer que nao deu para ler`
    );
  }
});

test("so com resposta do servidor agora a frase de vazio e dita", () => {
  const t = texto(render({ estado: "fresco", fatura: null }));

  assert.ok(t.includes("Nenhum gasto neste cartão em outubro de 2026"));
  // O vazio tambem nomeia o mes: "nenhum gasto neste cartao" sem mes se le
  // como "nunca teve gasto".
  assert.ok(!t.includes("Não foi possível ler"));
});

test("dado do aparelho mostra numero, mas nao afirma vazio", () => {
  // `podeMostrarNumero('do-aparelho')` e true e `podeAfirmarVazio` e false:
  // a copia guardada tem dado de verdade, e pode ser de antes da compra.
  const t = texto(render({ estado: "do-aparelho" }));

  assert.ok(t.includes("R$ 320,00"), "escondeu numero que ha como mostrar");
  assert.ok(t.includes("Mercado do mes"));
});

// ---------------------------------------------------------------------------
// 4. O CABECALHO
// ---------------------------------------------------------------------------

test("o cabecalho tem nome, limite e o ciclo da fatura", () => {
  const t = texto(render());

  assert.ok(t.includes("Nubank"), "falta o nome");
  assert.ok(t.includes("R$ 5.000,00"), `falta o limite: ${t}`);
  assert.ok(t.includes("Fecha dia 5 · vence dia 15"), "falta o ciclo");
});

test("cartao sem fechamento/vencimento mostra a tarja, nao 'dia undefined'", () => {
  const t = texto(
    render({ conta: { ...CONTA, closing_day: undefined, due_day: undefined } })
  );

  assert.ok(t.includes("Falta fechamento e vencimento"), `faltou a tarja: ${t}`);
  assert.ok(!t.includes("undefined"), "imprimiu undefined na tela");
});

test("cartao sem limite nao imprime R$ 0,00 de limite", () => {
  const t = texto(render({ conta: { ...CONTA, credit_limit: undefined } }));

  assert.ok(t.includes("não informado"), `faltou o 'nao informado': ${t}`);
});

// ---------------------------------------------------------------------------
// 5. "LANCAR GASTO NESTE CARTAO"
// ---------------------------------------------------------------------------

test("o botao de lancar aponta para a despesa com o cartao na query", () => {
  const html = render();

  assert.ok(
    html.includes(`/dashboard/movimentacoes/despesa?cartao=${MEU_CARTAO}`),
    "o link nao leva o cartao"
  );
  assert.ok(texto(html).includes("Lançar gasto neste cartão"));
});

test("o link NAO usa a chave id (ela colide sob a rota [id])", () => {
  const html = render();

  assert.ok(!html.includes("despesa?id="), "o link usou ?id=");
  assert.ok(!html.includes(`&id=${MEU_CARTAO}`), "o link usou &id=");
});

test("o vazio tambem oferece lancar (e o caminho de saida da tela vazia)", () => {
  const html = render({ estado: "fresco", fatura: null });

  assert.ok(html.includes(`despesa?cartao=${MEU_CARTAO}`));
});

test("cartao arquivado nao oferece lancar gasto", () => {
  // `disabled` num `asChild` viraria atributo de `<a>`, que o navegador
  // ignora: o botao ficaria cinza e continuaria navegando.
  const html = render({ conta: { ...CONTA, is_active: false } });

  assert.ok(
    !texto(html).includes("Lançar gasto neste cartão"),
    "cartao arquivado ofereceu lancamento"
  );
  assert.ok(!html.includes("despesa?cartao="), "o link sobrou na tela");
});

test("a tela tem volta para a lista de cartoes", () => {
  assert.match(render(), /href="\/dashboard\/cartoes"/);
});

// ---------------------------------------------------------------------------
// 6. O CARTAO DA LISTA: O LINK NOVO, E OS BOTOES FORA DELE
// ---------------------------------------------------------------------------

const listaHtml = (conta = CONTA) =>
  renderToStaticMarkup(
    h(CartaoDaLista, {
      conta,
      aoEditar: () => {},
      aoArquivar: () => {},
    })
  );

test("o card da lista e link para a tela do cartao", () => {
  const html = listaHtml();

  assert.ok(
    html.includes(`href="/dashboard/cartoes/${MEU_CARTAO}"`),
    `faltou o link: ${html}`
  );
  assert.ok(texto(html).includes("Ver os gastos deste cartão"));
});

test("Editar e Arquivar ficam FORA da area clicavel", () => {
  // O defeito que a issue aponta: dentro do link, arquivar um cartao tambem
  // navega -- a pessoa arquiva e cai na tela dele. A assercao e estrutural, e
  // nao sobre handler: `<button>` dentro de `<a>` se le do HTML.
  const html = listaHtml();

  const inicioDoLink = html.indexOf("<a ");
  const fimDoLink = html.indexOf("</a>");

  assert.ok(inicioDoLink !== -1 && fimDoLink !== -1, "nao ha link no card");

  const dentroDoLink = html.slice(inicioDoLink, fimDoLink);

  for (const rotulo of ["Editar", "Arquivar"]) {
    assert.ok(
      !dentroDoLink.includes(rotulo),
      `"${rotulo}" esta dentro do <a>: clicar nele tambem navega`
    );
  }

  // Controle: os dois botoes existem em algum lugar do card. Sem isto, apagar
  // os dois botoes faria a assercao acima passar.
  const t = texto(html);
  assert.ok(t.includes("Editar"), "o botao Editar desapareceu do card");
  assert.ok(t.includes("Arquivar"), "o botao Arquivar desapareceu do card");
});

test("nao ha botao dentro do link (nem outro que apareca depois)", () => {
  const html = listaHtml();
  const dentroDoLink = html.slice(html.indexOf("<a "), html.indexOf("</a>"));

  assert.ok(
    !dentroDoLink.includes("<button"),
    "ha <button> dentro do <a>: marcacao invalida, e o clique faz as duas coisas"
  );
});

test("o card da lista mostra fatura, limite e ciclo", () => {
  const t = texto(listaHtml());

  assert.ok(t.includes("R$ 320,00"), `falta a fatura atual: ${t}`);
  assert.ok(t.includes("Limite R$ 5.000,00"), "falta o limite");
  assert.ok(t.includes("Fecha dia 5 · vence dia 15"), "falta o ciclo");
});

test("o card da lista mostra a fatura em modulo", () => {
  // `current_balance` e negativo (as compras rebaixaram o saldo do cartao).
  // "-R$ 320,00" embaixo de "Fatura atual" e um sinal a mais na leitura.
  const t = texto(listaHtml());

  assert.ok(!t.includes("-R$ 320,00"), `saiu com sinal: ${t}`);
});

test("cartao sem dias na lista mostra a tarja", () => {
  const t = texto(listaHtml({ ...CONTA, closing_day: undefined, due_day: undefined }));

  assert.ok(t.includes("Falta fechamento e vencimento"));
  assert.ok(!t.includes("undefined"));
});

// ---------------------------------------------------------------------------
// "PARCELA N DE M" NA FATURA (HMO-211, migration 035)
// ---------------------------------------------------------------------------
// O CAMINHO DE VOLTA DO PARCELAMENTO TERMINA AQUI.
//
// Antes da 035 as parcelas iam para `transaction_installments`, tabela sem
// leitor nenhum: a compra em 10x era gravada e desaparecia de Lancamentos, de
// Contas a Pagar e da fatura. Agora cada parcela e uma compra no cartao, no mes
// da fatura dela -- e esta tela e onde ela aparece. Um teste que so cobrisse a
// funcao pura provaria a aritmetica e nao provaria que a parcela chega na tela.

const parcela = (numero, total, valor) => ({
  ...linha(MEU_CARTAO, `Notebook (${numero}/${total})`, valor, "15"),
  transaction_id: `parcela-${numero}`,
  installment_number: numero,
  installment_total: total,
});

test("a fatura rotula a parcela com 'parcela N de M'", () => {
  const html = render({
    fatura: { ...FATURA, lines: [parcela(3, 10, 100)], line_count: 1, total: 100 },
  });

  assert.ok(html.includes("parcela 3 de 10"), "o rotulo da parcela nao saiu");
  // E a descricao continua na tela: as duas coisas aparecem, e e a descricao que
  // diz O QUE foi comprado.
  assert.ok(html.includes("Notebook (3/10)"), "a descricao da parcela sumiu");
});

test("o rotulo sai das COLUNAS, nao da descricao", () => {
  // Uma descricao reescrita pelo usuario ("Notebook do trabalho") nao pode
  // apagar o rotulo: ele vem de `installment_number`/`installment_total`. Se a
  // tela fizesse parsing do texto, o rotulo sumiria aqui.
  const html = render({
    fatura: {
      ...FATURA,
      lines: [
        {
          ...parcela(4, 10, 100),
          description: "Notebook do trabalho",
        },
      ],
      line_count: 1,
      total: 100,
    },
  });

  assert.ok(html.includes("parcela 4 de 10"), "o rotulo dependia da descricao");
  assert.ok(html.includes("Notebook do trabalho"));
});

test("compra avulsa continua mostrando a data, e NAO ganha rotulo de parcela", () => {
  // A negacao. Sem ela, um rotulo que aparecesse em toda linha passaria verde
  // nos dois testes acima -- e metade das compras do mes se chamaria "parcela".
  const html = render();

  assert.ok(!html.includes("parcela "), "a compra avulsa ganhou rotulo de parcela");
  // A data continua na tela nas compras avulsas: ela e o unico eixo de tempo da
  // linha, e e um dado que a pessoa digitou.
  assert.ok(html.includes("03/10"), "a data da compra avulsa sumiu");
});

test("par meio preenchido nao vira 'parcela 3 de ' na tela", () => {
  // Ha CHECK no banco impedindo este par (035), e este teste e o cinto do lado
  // da tela: um rotulo pela metade e pior que rotulo nenhum. Quem recebe o par
  // ruim cai de volta na data.
  const html = render({
    fatura: {
      ...FATURA,
      lines: [{ ...parcela(3, 10, 100), installment_total: null }],
      line_count: 1,
      total: 100,
    },
  });

  assert.ok(!html.includes("parcela 3 de"), "a tela imprimiu um rotulo pela metade");
  assert.ok(html.includes("15/10"), "sem rotulo, a linha devia mostrar a data");
});

// ---------------------------------------------------------------------------
// AS PREVISOES PENDENTES DO CARTAO (HMO-227)
// ---------------------------------------------------------------------------
// A HMO-209 tirou de Contas a Pagar a previsao apontada para um cartao que nao
// e a fatura -- a assinatura cadastrada com o cartao como conta --, e o
// comentario dela promete que aquelas linhas "passam a aparecer na tela do
// cartao". Elas nao apareciam em lugar nenhum: ficaram gravadas, sem leitor.
//
// O teste de funcao pura nao pega isto: `previsoesDoCartao` podia estar certa e
// o componente nao renderizar nada -- que era exatamente o estado desta tela.

const PREVISAO = {
  id: "s1",
  user_id: "u1",
  account_id: MEU_CARTAO,
  category_id: "c1",
  description: "Streaming mensal",
  amount: 39.9,
  due_date: "2026-10-20",
  status: "pending",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

test("a previsao pendente do cartao aparece na tela, fora da fatura", () => {
  const t = texto(
    render({ fatura: { ...FATURA, scheduled_pending: [PREVISAO] } })
  );

  assert.ok(t.includes("Streaming mensal"), `falta a previsao: ${t}`);
  assert.ok(t.includes("1 conta prevista neste cartão"), `falta o titulo: ${t}`);
  assert.ok(t.includes("R$ 39,90"), `falta o valor da previsao: ${t}`);
  // O vencimento DELA, e nao o da fatura: previsao tem `due_date` proprio, e
  // encaixa-la no ciclo do cartao seria aplicar a uma conta a pagar a regra de
  // uma compra.
  assert.ok(t.includes("20/10"), `falta o vencimento da previsao: ${t}`);

  // E o total da fatura NAO a soma: 320 continua 320. Somar aqui contaria a
  // assinatura duas vezes no dia em que ela fosse paga.
  assert.ok(t.includes("R$ 320,00"), `o total da fatura mudou: ${t}`);
});

test("sem previsao nenhuma o bloco nao aparece", () => {
  // Lista vazia e o caso comum. Um bloco escrito "nenhuma conta prevista" em
  // todo cartao seria ruido permanente.
  const t = texto(render({ fatura: { ...FATURA, scheduled_pending: [] } }));

  assert.ok(!t.includes("conta prevista neste cartão"), `bloco a mais: ${t}`);
  assert.ok(
    !t.includes("Não foi possível conferir as contas previstas"),
    `aviso de falha numa leitura que deu certo: ${t}`
  );
});

test("campo ausente NAO vira silencio: a tela diz que nao conferiu", () => {
  // `scheduled_pending` ausente significa que aquela consulta falhou. Omitir o
  // bloco seria a tela afirmando por omissao que o cartao nao tem conta
  // prevista -- o "Nada em atraso." sem rede, de novo.
  const t = texto(render({ fatura: FATURA }));

  assert.ok(
    t.includes("Não foi possível conferir as contas previstas deste cartão"),
    `a tela calou sobre uma leitura que falhou: ${t}`
  );
  assert.ok(!t.includes("conta prevista neste cartão"), `bloco a mais: ${t}`);
});

test("o valor da previsao nao e impresso sem leitura boa", () => {
  // O mesmo pedagio do total da fatura: `sem-rede` nao pode virar "R$ 39,90"
  // com cara de numero conferido.
  const t = texto(
    render({
      fatura: { ...FATURA, scheduled_pending: [PREVISAO] },
      estado: "sem-rede",
    })
  );

  assert.ok(t.includes("Streaming mensal"), `a linha devia continuar: ${t}`);
  assert.ok(!t.includes("R$ 39,90"), `valor impresso sem leitura boa: ${t}`);
});
