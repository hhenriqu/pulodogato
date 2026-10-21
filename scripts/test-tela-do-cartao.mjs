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
import { EdicaoDaPrevisaoDoCartao } from "../.tmp-tela-do-cartao/components/cartoes/EdicaoDaPrevisaoDoCartao.js";
import {
  AVISO_DA_FATURA_INTEIRA,
  avisoDaExclusaoDaLinhaDaFatura,
  caminhoDeEdicaoDaLinhaDaFatura,
  ehParcelaDaFatura,
  faturaTemLinhaForaDosTotais,
  pedidoDeExclusaoDaLinhaDaFatura,
  pedidoDeMudarOsTotaisDaLinhaDaFatura,
  ROTULO_DE_TIRAR_DOS_TOTAIS_NA_FATURA,
  ROTULO_DE_VOLTAR_AOS_TOTAIS_NA_FATURA,
  rotuloDeMudarOsTotaisDaLinhaDaFatura,
  SELO_FORA_DOS_TOTAIS_NA_FATURA,
  seloDaLinhaDaFatura,
  somaNosTotaisDaFatura,
} from "../.tmp-tela-do-cartao/lib/acoes-da-fatura.js";
import {
  ancoraDaPrevisao,
  avisoDaEdicaoDaPrevisao,
  avisoDaExclusaoDaPrevisaoAvulsa,
  edicaoInicialDaPrevisao,
  ehSerieDaPrevisao,
  pedidoDeEdicaoDaPrevisaoDoCartao,
  pedidoDeExclusaoDaPrevisaoDoCartao,
  valorNoCampoDaPrevisao,
} from "../.tmp-tela-do-cartao/lib/acoes-da-previsao-do-cartao.js";

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

  // O QUE ESTA PROIBIDO E O **CARTAO** VIAJAR NA CHAVE `id`, e nao a string
  // "?id=" existir na arvore. A assercao era `!html.includes("despesa?id=")` --
  // um grep sobre a pagina inteira -- e ela ficou larga demais na HMO-455: a
  // linha da fatura ganhou um "Editar" que leva o **LANCAMENTO** em `?id=`,
  // para `/dashboard/movimentacoes/despesa`, que NAO tem segmento `[id]` e onde
  // aquela chave e justamente a que `FormularioDeLancamento` le
  // (`parametros.get("id")`) -- o mesmo caminho que `caminhoDeEdicao` ja monta
  // em lib/acoes-da-linha.ts. O grep antigo reprovava o link CERTO.
  //
  // O alvo agora e o VALOR, ancorado no fim (`&` ou a aspa que fecha o href).
  // Sem a ancora a guarda voltaria a reprovar o link certo: o
  // `transaction_id` da fixture comeca com o id do cartao.
  assert.ok(
    !html.includes(`id=${MEU_CARTAO}&`),
    "o cartao viajou na chave id (forma &)"
  );
  assert.ok(
    !html.includes(`id=${MEU_CARTAO}"`),
    "o cartao viajou na chave id (fim do href)"
  );
  // O CONTROLE POSITIVO: o cartao continua indo na chave que a tela de
  // lancamento sabe ler. Sem esta linha as duas negacoes acima passariam
  // vacuas numa tela que tivesse perdido o link inteiro.
  assert.ok(
    html.includes(`despesa?cartao=${MEU_CARTAO}`),
    "sumiu o link que leva o cartao em ?cartao="
  );
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

const listaHtml = (conta = CONTA, props = {}) =>
  renderToStaticMarkup(
    h(CartaoDaLista, {
      conta,
      // HMO-290: o numero deste card vem da FATURA, e nao mais de
      // `current_balance`. As tres props novas sao o que a troca exigiu.
      fatura: FATURA,
      estado: "fresco",
      rotuloDoMes: "outubro de 2026",
      aoEditar: () => {},
      aoArquivar: () => {},
      ...props,
    })
  );

/** Uma fatura com UMA compra parcelada, para a linha das parcelas futuras. */
const FATURA_PARCELADA = {
  ...FATURA,
  total: 300,
  line_count: 1,
  lines: [
    {
      ...linha(MEU_CARTAO, "Notebook (1/10)", 300, "03"),
      installment_number: 1,
      installment_total: 10,
    },
  ],
};

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

  assert.ok(t.includes("R$ 320,00"), `falta a fatura: ${t}`);
  assert.ok(t.includes("Limite R$ 5.000,00"), "falta o limite");
  assert.ok(t.includes("Fecha dia 5 · vence dia 15"), "falta o ciclo");
});

test("o card da lista mostra a fatura sem sinal invertido", () => {
  // A fatura vem de `total`, que ja tem o sinal certo da view (a compra soma, o
  // estorno abate). "-R$ 320,00" embaixo do rotulo de fatura seria um sinal a
  // mais na leitura.
  const t = texto(listaHtml());

  assert.ok(!t.includes("-R$ 320,00"), `saiu com sinal: ${t}`);
});

test("cartao sem dias na lista mostra a tarja", () => {
  const t = texto(listaHtml({ ...CONTA, closing_day: undefined, due_day: undefined }));

  assert.ok(t.includes("Falta fechamento e vencimento"));
  assert.ok(!t.includes("undefined"));
});

// ---------------------------------------------------------------------------
// 6b. O CARD DA LISTA DIZ A FATURA DO PERIODO, E NAO A DIVIDA INTEIRA (HMO-290)
// ---------------------------------------------------------------------------
// O defeito: o card imprimia `Math.abs(current_balance)` sob o rotulo "Fatura
// atual". Aquilo e a divida INTEIRA do cartao -- o trigger
// `update_account_balance` soma `NEW.amount` no INSERT sem olhar
// `transaction_date`, e as 10 parcelas sao gravadas de uma vez.
//
// Nenhuma assercao daqui cabe no teste puro: o que se afirma e QUAL numero
// aparece no HTML, e qual NAO aparece. `lib/fatura-do-periodo.ts` tem suite
// propria (25 blocos) e toda ela passaria verde com o JSX voltando a imprimir
// `current_balance`: a aritmetica estaria exata e a tela ignorando ela.

test("o CASO DA ISSUE: 3.000 em 10x mostra a parcela do mes, nao a compra inteira", () => {
  // O cartao deve 3.000 (as 10 parcelas ja estao no saldo) e a fatura de
  // outubro tem 300 dela.
  const t = texto(
    listaHtml(
      { ...CONTA, current_balance: -3000 },
      { fatura: FATURA_PARCELADA }
    )
  );

  assert.ok(t.includes("R$ 300,00"), `falta a fatura do mes: ${t}`);
  assert.ok(
    !t.includes("R$ 3.000,00"),
    `a divida inteira voltou para a tela: ${t}`
  );
});

test("a linha das parcelas futuras diz o que ainda vai ser cobrado", () => {
  // Sem esta linha a troca seria so um numero menor, e os R$ 2.700 das nove
  // parcelas seguintes nao apareceriam em tela de cartao nenhuma.
  const t = texto(
    listaHtml(
      { ...CONTA, current_balance: -3000 },
      { fatura: FATURA_PARCELADA }
    )
  );

  assert.ok(
    t.includes("R$ 2.700,00 em parcelas futuras"),
    `falta o que ainda vai vir: ${t}`
  );
});

test("fatura sem parcelamento nao imprime 'R$ 0,00 em parcelas futuras'", () => {
  // Ruido em todo cartao de todo mes. A linha so existe quando ha numero.
  const t = texto(listaHtml());

  assert.ok(!t.includes("em parcelas futuras"), `saiu a linha vazia: ${t}`);
});

test("o rotulo diz de QUE MES e a fatura", () => {
  // "Fatura atual" sobre um numero de fatura nao diz a qual fatura o numero
  // responde -- e esta tela mostra o mes que o seletor escolheu, que nem sempre
  // e o corrente. Painel sem eixo de tempo mente no rotulo.
  const t = texto(listaHtml());

  assert.ok(t.includes("Fatura de outubro de 2026"), `falta o mes: ${t}`);
});

test("sem mes para nomear, o numero do card NAO sai", () => {
  // `rotuloDaFatura` devolve `null` para o que nao da para ler, em vez de
  // "undefined de 2026". Quem recebe `null` esconde o numero junto: um total
  // sem o mes ao lado e um numero sobre um periodo que ninguem declarou.
  const t = texto(listaHtml(CONTA, { rotuloDoMes: null }));

  assert.ok(!t.includes("R$ 320,00"), `o total saiu sem eixo de tempo: ${t}`);
  assert.ok(!t.includes("undefined"), `vazou undefined: ${t}`);
});

test("A LEITURA DE FATURAS FALHANDO DIZ QUE FALHOU, e nao R$ 0,00", () => {
  // A consequencia que esta PR trata em vez de contornar. A tela passou a fazer
  // DUAS leituras onde fazia uma, e este card abre sem rede: com o cadastro
  // fresco e a fatura falhando, "Fatura de outubro: R$ 0,00" embaixo do nome do
  // cartao certo e indistinguivel de um mes sem compra nenhuma.
  //
  // `estado` chega aqui ja reduzido pelo `estadoDaTela`, que leva as duas
  // leituras a mais pessimista.
  const t = texto(listaHtml(CONTA, { estado: "sem-rede" }));

  assert.ok(!t.includes("R$ 0,00"), `imprimiu zero confiante: ${t}`);
  assert.ok(!t.includes("R$ 320,00"), `imprimiu numero sem leitura boa: ${t}`);
  // Controle: o card continua na tela, com o nome do cartao -- o que sumiu e o
  // numero, nao o cartao.
  assert.ok(t.includes("Nubank"), `o card inteiro desapareceu: ${t}`);
  assert.ok(t.includes("—"), `nada marcou o numero como indisponivel: ${t}`);
});

test("cartao ausente da resposta tambem nao imprime R$ 0,00", () => {
  // A rota devolve uma entrada para TODO cartao ativo, zerada quando o mes nao
  // teve compra -- entao a AUSENCIA e "nao deu para ler", e nao fatura vazia.
  // Este caminho nao passa pelo `estado`: a leitura foi bem, o cartao e que nao
  // veio nela.
  const t = texto(listaHtml(CONTA, { fatura: null }));

  assert.ok(!t.includes("R$ 0,00"), `imprimiu zero confiante: ${t}`);
  assert.ok(t.includes("Nubank"), `o card inteiro desapareceu: ${t}`);
});

test("a fatura de OUTRO cartao nao e impressa embaixo deste nome", () => {
  // A pagina casa a fatura por `account_id` com `faturaDoCartao`; o componente
  // nao escolhe fatura. O que ele garante e a linha de parcelas: ela filtra por
  // `account_id` de novo, porque a RLS pode trazer a compra de outro cartao.
  const comIntruso = {
    ...FATURA_PARCELADA,
    lines: [
      ...FATURA_PARCELADA.lines,
      {
        ...linha(OUTRO_CARTAO, "TV do outro cartao (1/10)", 900, "04"),
        installment_number: 1,
        installment_total: 10,
      },
    ],
  };

  const t = texto(
    listaHtml({ ...CONTA, current_balance: -3000 }, { fatura: comIntruso })
  );

  // 300 * 9, e nao (300 + 900) * 9 = R$ 10.800,00.
  assert.ok(
    t.includes("R$ 2.700,00 em parcelas futuras"),
    `a parcela do outro cartao entrou: ${t}`
  );
});

test("fatura zerada de verdade MOSTRA R$ 0,00 (o mes sem compra tem numero)", () => {
  // O outro lado: devolver travessao aqui esconderia um numero que a rota
  // respondeu, e a pessoa nao saberia que o mes nao teve compra.
  const t = texto(
    listaHtml(CONTA, { fatura: { ...FATURA, total: 0, line_count: 0, lines: [] } })
  );

  assert.ok(t.includes("R$ 0,00"), `faltou o zero legitimo: ${t}`);
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
// APAGAR A PARCELA, DA TELA DO CARTAO (HMO-228)
// ---------------------------------------------------------------------------
// "A pergunta tem de ser feita onde a pessoa clica." Uma parcela e VISTA aqui, e
// aqui nao havia botao nenhum de apagar -- a exclusao saia pela lista de
// Lancamentos, por uma rota que nao sabe o que e uma serie.
//
// O botao chama um PROP e nao faz fetch: este componente nao tem rede nem hook
// de dados, e e isso que permite renderiza-lo aqui. O `onClick` nao aparece no
// HTML de servidor, entao o que se cobra e a presenca do controle e o TEXTO
// dele -- que e o que avisa a pessoa que apagar vai perguntar o alcance.

const TITULO_APAGAR = "Apagar parcela (só esta, desta em diante, ou todas)";

test("a parcela ganha botao de apagar quando a pagina passa o handler", () => {
  const html = render({
    fatura: { ...FATURA, lines: [parcela(3, 10, 100)], line_count: 1, total: 100 },
    aoApagarParcela: () => {},
  });

  assert.ok(
    html.includes(TITULO_APAGAR),
    "a parcela nao ganhou o botao de apagar"
  );
  // Um botao de lixeira sem esse aviso se le como "apaga esta linha", que e
  // exatamente o defeito que esta issue existe para consertar.
  assert.ok(html.includes("desta em diante"), "o aviso das tres opcoes sumiu");
});

test("a compra AVULSA nao ganha botao de apagar parcela", () => {
  // A negacao explicita. Sem ela, um botao que aparecesse em TODA linha passaria
  // verde no teste acima -- e apagar uma compra avulsa cairia na rota de serie,
  // que responde 400 "não faz parte de uma compra parcelada" sobre uma linha que
  // a pessoa acabou de clicar.
  const html = render({ aoApagarParcela: () => {} });

  assert.ok(
    !html.includes(TITULO_APAGAR),
    "a compra avulsa ganhou o botao de apagar parcela"
  );
});

test("sem handler, nem a parcela ganha o botao", () => {
  // O prop e opcional de proposito: e isso que mantem este componente sem rede.
  // Um botao que aparecesse sempre apareceria tambem onde nao ha nada ligado
  // nele -- um controle que nao faz nada ao ser clicado.
  const html = render({
    fatura: { ...FATURA, lines: [parcela(3, 10, 100)], line_count: 1, total: 100 },
  });

  assert.ok(!html.includes(TITULO_APAGAR), "o botao apareceu sem handler");
  // E o resto da linha continua intacto: o rotulo nao depende do handler.
  assert.ok(html.includes("parcela 3 de 10"));
});

// ---------------------------------------------------------------------------
// EDITAR E EXCLUIR A COMPRA, DA PROPRIA FATURA (HMO-455)
// ---------------------------------------------------------------------------
// "Contas do cartao tambem podem ser editadas, excluidas e desconsideradas do
// saldo."
//
// Ate esta issue a unica acao da linha era apagar PARCELA. A compra avulsa --
// a maioria das linhas de qualquer fatura -- nao tinha nem editar nem excluir:
// o conserto saia pela lista de Despesas, numa tela que nao diz em que fatura
// aquela compra caiu.
//
// A DECISAO esta em `lib/acoes-da-fatura.ts` e tem assercao de unidade logo
// abaixo; o que se cobra AQUI e que ela chegue na arvore -- um `podeAgir` certo
// com o botao fora do JSX passa verde em qualquer teste de funcao pura.

const TITULO_EXCLUIR = "Excluir esta compra da fatura";
const CATEGORIA_DE_AJUSTE = "cat-ajuste";

/** A linha do ajuste de saldo: o que a difere e a CATEGORIA, nao a descricao. */
const linhaDeAjuste = () => ({
  ...linha(MEU_CARTAO, "Ajuste de saldo da fatura", 50, "20"),
  transaction_id: "ajuste-1",
  category_id: CATEGORIA_DE_AJUSTE,
});

test("a compra avulsa ganha Editar, apontando para o formulario de despesa", () => {
  const html = render();

  // O id do LANCAMENTO, e o `de=` de volta para a fatura. Sem o `de=`,
  // corrigir uma compra de agosto termina na lista do mes corrente.
  assert.ok(
    html.includes(`/dashboard/movimentacoes/despesa?id=${MEU_CARTAO}-03`),
    `o Editar nao aponta para o formulario: ${html.slice(0, 400)}`
  );
  assert.ok(
    html.includes(
      `origem=${encodeURIComponent(`/dashboard/cartoes/${MEU_CARTAO}`)}`
    ),
    "o Editar nao leva a volta para a fatura"
  );
});

test("o ESTORNO abre o formulario de RECEITA, nao o de despesa", () => {
  // Abrir um estorno no formulario de despesa o reclassificaria na primeira
  // gravacao -- a rota de PATCH re-deriva o tipo pela categoria escolhida. O
  // estorno de R$ 200 viraria uma compra de R$ 200, e a fatura subiria R$ 400:
  // dois numeros plausiveis e nada vermelho.
  const html = render({
    fatura: {
      ...FATURA,
      lines: [
        { ...linha(MEU_CARTAO, "Estorno da passagem", 200, "09"),
          transaction_type: "income" },
      ],
      line_count: 1,
    },
  });

  assert.ok(
    html.includes("/dashboard/movimentacoes/receita?id="),
    "o estorno abriria no formulario errado"
  );
  assert.ok(
    !html.includes("/dashboard/movimentacoes/despesa?id="),
    "o estorno tambem ganhou o link de despesa"
  );
});

test("a compra avulsa ganha Excluir quando a pagina passa o handler", () => {
  const html = render({ aoExcluirCompra: () => {} });

  assert.ok(html.includes(TITULO_EXCLUIR), "a compra avulsa nao ganhou Excluir");
});

test("sem handler, a compra avulsa NAO ganha Excluir", () => {
  // O prop e opcional, e e isso que mantem este componente sem rede. Um botao
  // que aparecesse sempre apareceria tambem onde nao ha nada ligado nele.
  const html = render();

  assert.ok(!html.includes(TITULO_EXCLUIR), "o Excluir apareceu sem handler");
});

test("os dois botoes de lixeira sao EXCLUDENTES na mesma linha", () => {
  // A parcela sai pela rota de SERIE, que pergunta o alcance; a avulsa pela
  // rota de lancamento, que nao pergunta. Duas lixeiras lado a lado prometendo
  // coisas diferentes, sem nada dizendo qual e qual, e pior que uma so -- e
  // apagar uma parcela pela rota da avulsa deixa nove linhas rotuladas
  // "parcela N de 10" numa serie que agora tem nove.
  const soParcela = render({
    fatura: { ...FATURA, lines: [parcela(3, 10, 100)], line_count: 1, total: 100 },
    aoApagarParcela: () => {},
    aoExcluirCompra: () => {},
  });

  assert.ok(soParcela.includes(TITULO_APAGAR), "a parcela perdeu o botao dela");
  assert.ok(
    !soParcela.includes(TITULO_EXCLUIR),
    "a parcela ganhou TAMBEM o Excluir da avulsa"
  );

  const soAvulsa = render({ aoApagarParcela: () => {}, aoExcluirCompra: () => {} });

  assert.ok(soAvulsa.includes(TITULO_EXCLUIR), "a avulsa perdeu o Excluir");
  assert.ok(
    !soAvulsa.includes(TITULO_APAGAR),
    "a avulsa ganhou TAMBEM o apagar-parcela"
  );
});

test("a linha do AJUSTE nao ganha Editar nem Excluir", () => {
  // Ela ja tem controle proprio um bloco acima ("Ajustar saldo" / "Remover").
  // E o Editar e pior que redundante: o formulario deixa trocar a CATEGORIA, e
  // e a categoria reservada que faz aquela linha ser um ajuste. Trocada, o
  // bloco de cima conclui que a fatura nao tem ajuste e o proximo "Ajustar
  // saldo" grava um SEGUNDO -- a diferenca contada duas vezes.
  const html = render({
    fatura: { ...FATURA, lines: [linhaDeAjuste()], line_count: 1, total: 50 },
    categoriaDeAjuste: CATEGORIA_DE_AJUSTE,
    aoExcluirCompra: () => {},
  });

  assert.ok(texto(html).includes("Ajuste"), "o selo do ajuste sumiu");
  assert.ok(
    !html.includes("/dashboard/movimentacoes/despesa?id=ajuste-1"),
    "o ajuste ganhou Editar"
  );
  assert.ok(!html.includes(TITULO_EXCLUIR), "o ajuste ganhou Excluir");
});

test("a compra COMUM continua com as acoes quando ha um ajuste na fatura", () => {
  // A negacao do teste acima. Sem ela, uma regra que escondesse os botoes de
  // TODA linha quando a fatura tem ajuste passaria verde la em cima.
  const html = render({
    fatura: {
      ...FATURA,
      lines: [linhaDeAjuste(), linha(MEU_CARTAO, "Mercado do mes", 200, "03")],
      line_count: 2,
    },
    categoriaDeAjuste: CATEGORIA_DE_AJUSTE,
    aoExcluirCompra: () => {},
  });

  assert.ok(html.includes(TITULO_EXCLUIR), "a compra comum perdeu o Excluir");
  assert.ok(
    html.includes(`/dashboard/movimentacoes/despesa?id=${MEU_CARTAO}-03`),
    "a compra comum perdeu o Editar"
  );
});

// ---------------------------------------------------------------------------
// A DECISAO, SEM ARVORE: lib/acoes-da-fatura.ts
// ---------------------------------------------------------------------------
// As assercoes acima provam que a decisao CHEGA na tela. Estas provam a decisao
// -- inclusive os ramos que a tela nao tem como mostrar (o `null` do pedido,
// que e o que impede a parcela de cair na rota da avulsa).

test("pedidoDeExclusaoDaLinhaDaFatura devolve null para parcela e para ajuste", () => {
  const avulsa = { transaction_id: "t1", description: "Mercado" };

  assert.deepEqual(pedidoDeExclusaoDaLinhaDaFatura(avulsa, false), {
    metodo: "DELETE",
    url: "/api/personal-finance/transactions/t1",
  });

  // A PARCELA: `null`, senao ela cairia na rota que nao pergunta o alcance.
  assert.equal(
    pedidoDeExclusaoDaLinhaDaFatura(
      { ...avulsa, installment_number: 3, installment_total: 10 },
      false
    ),
    null
  );

  // O AJUSTE: `null` mesmo sendo avulso.
  assert.equal(pedidoDeExclusaoDaLinhaDaFatura(avulsa, true), null);
});

test("ehParcelaDaFatura nao se deixa enganar pelo par meio preenchido", () => {
  // O criterio e `installment_number` sozinho -- o mesmo que o botao da
  // HMO-228 ja usa. Exigir o par abriria uma TERCEIRA classe (numero sem
  // total) que ganharia o botao da avulsa e cairia na rota errada.
  assert.equal(ehParcelaDaFatura({ transaction_id: "t", description: "d" }), false);
  assert.equal(
    ehParcelaDaFatura({
      transaction_id: "t",
      description: "d",
      installment_number: 3,
      installment_total: null,
    }),
    true
  );
});

test("caminhoDeEdicaoDaLinhaDaFatura escapa o id e preserva a origem", () => {
  const caminho = caminhoDeEdicaoDaLinhaDaFatura(
    { transaction_id: "a/b", description: "d" },
    false,
    "/dashboard/cartoes/x"
  );

  assert.ok(caminho.includes("?id=a%2Fb"), `id nao escapado: ${caminho}`);
  assert.ok(caminho.includes("origem=%2Fdashboard%2Fcartoes%2Fx"), caminho);

  // E `null` para o ajuste, que e o que o JSX usa para nao montar o botao.
  assert.equal(
    caminhoDeEdicaoDaLinhaDaFatura(
      { transaction_id: "t", description: "d" },
      true,
      null
    ),
    null
  );
});

test("o aviso da exclusao nomeia a compra e diz o que volta", () => {
  // "Tem certeza?" nao distingue perder a linha de perder a fatura, e a lista
  // tem muitas linhas parecidas: confirmar a errada e silencioso.
  const aviso = avisoDaExclusaoDaLinhaDaFatura({
    transaction_id: "t",
    description: "Mercado do mes",
  });

  assert.ok(aviso.includes("Mercado do mes"), aviso);
  assert.ok(aviso.includes("saldo do cartão volta"), aviso);

  // Descricao vazia nao vira `Excluir "" desta fatura?`.
  assert.ok(
    avisoDaExclusaoDaLinhaDaFatura({
      transaction_id: "t",
      description: "   ",
    }).includes("esta compra"),
    "a frase ficou com as aspas vazias"
  );
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

// ---------------------------------------------------------------------------
// EDITAR E EXCLUIR A CONTA PREVISTA DO CARTAO (HMO-460)
// ---------------------------------------------------------------------------
// Fase F3 da HMO-455. Helio respondeu "sim" a segunda pergunta do cartao de
// decisao: "contas do cartao" INCLUI as contas previstas do cartao.
//
// E o buraco mais fechado dos dois. A linha do bloco acima -- a assinatura
// cadastrada com o cartao como conta -- nao tinha botao NENHUM, e nao aparece em
// Contas a Pagar (a HMO-209 a tirou de la de proposito, para a mesma despesa
// nao ser somada ao lado da fatura que ja a contem). Logo: ela nao se editava
// nem se apagava em lugar NENHUM do app. A compra da fatura (F1) ao menos se
// editava pela lista de Despesas.
//
// A DECISAO esta em `lib/acoes-da-previsao-do-cartao.ts` e tem assercao de
// unidade mais abaixo; o que se cobra aqui e que ela chegue na arvore.

const PREVISAO_FIXA = {
  ...PREVISAO,
  id: "s2",
  description: "Academia",
  recurring_rule_id: "regra-1",
};

const comPrevisoes = (previsoes, props) =>
  render({ fatura: { ...FATURA, scheduled_pending: previsoes }, ...props });

test("a conta prevista ganha Editar e Excluir quando a pagina passa os handlers", () => {
  const html = comPrevisoes([PREVISAO], {
    aoEditarPrevisao: () => {},
    aoExcluirPrevisao: () => {},
  });

  // Os TITULOS, e nao o icone: `Pencil` e `Trash2` ja aparecem na lista da
  // fatura acima, entao procurar o svg nao distingue os dois blocos.
  assert.ok(
    html.includes("Editar esta conta prevista"),
    `a previsao nao ganhou Editar: ${html.slice(-900)}`
  );
  assert.ok(
    html.includes("Excluir esta conta prevista"),
    "a previsao nao ganhou Excluir"
  );
});

test("sem handler, a conta prevista NAO ganha botao nenhum", () => {
  // O CONTROLE POSITIVO do teste acima: os props sao opcionais, e e isso que
  // mantem este componente sem rede. Sem esta assercao, um botao renderizado
  // incondicionalmente passaria verde la em cima.
  const html = comPrevisoes([PREVISAO]);

  assert.ok(
    !html.includes("Editar esta conta prevista"),
    "o Editar da previsao apareceu sem handler"
  );
  assert.ok(
    !html.includes("Excluir esta conta prevista"),
    "o Excluir da previsao apareceu sem handler"
  );
  // E a linha continua na tela: o que falta e a acao, nao a leitura.
  assert.ok(texto(html).includes("Streaming mensal"), "a previsao sumiu");
});

test("os botoes da previsao NAO se confundem com os da compra da fatura", () => {
  // As duas listas estao na mesma tela, as duas tem lapis e lixeira, e as duas
  // falam com rotas DIFERENTES: a compra sai por
  // `/api/personal-finance/transactions/{id}` e a previsao por
  // `/api/scheduled-transactions/{id}`. Titulos iguais fariam o teste (e o
  // leitor de tela) nao distinguir qual botao e qual.
  const html = comPrevisoes([PREVISAO], {
    aoExcluirCompra: () => {},
    aoEditarPrevisao: () => {},
    aoExcluirPrevisao: () => {},
  });

  assert.ok(html.includes(TITULO_EXCLUIR), "a compra perdeu o Excluir dela");
  assert.ok(
    html.includes("Excluir esta conta prevista"),
    "a previsao perdeu o Excluir dela"
  );
  assert.notEqual(
    TITULO_EXCLUIR,
    "Excluir esta conta prevista",
    "os dois titulos ficaram iguais"
  );

  // E o Editar da previsao NAO e um link para o formulario de lancamento: ele
  // le `?id=` de `financial_transactions`, e a previsao vive em outra tabela --
  // o link responderia 404 sobre um id que existe.
  assert.ok(
    !html.includes("/dashboard/movimentacoes/despesa?id=s1"),
    "a previsao ganhou link para a tela de lancamento"
  );
});

test("o formulario da previsao aparece FORA do bloco das previsoes", () => {
  // Ele e slot, e a posicao importa: dentro do bloco ele desapareceria -- com o
  // texto digitado dentro -- no instante em que uma releitura falhasse e
  // `scheduled_pending` voltasse ausente. Esta e a assercao daquele estado.
  const semLeitura = render({
    fatura: FATURA, // sem `scheduled_pending`: a consulta falhou
    blocoDeEdicaoDaPrevisao: h("p", null, "formulario-aberto"),
  });

  const t = texto(semLeitura);
  assert.ok(
    t.includes("Não foi possível conferir as contas previstas"),
    `esperava o aviso de leitura falha: ${t}`
  );
  assert.ok(
    t.includes("formulario-aberto"),
    `o formulario sumiu junto com a lista: ${t}`
  );
});

// ---------------------------------------------------------------------------
// O FORMULARIO DA CONTA PREVISTA: components/cartoes/EdicaoDaPrevisaoDoCartao
// ---------------------------------------------------------------------------

const renderEdicao = (props) =>
  renderToStaticMarkup(
    h(EdicaoDaPrevisaoDoCartao, {
      previsao: PREVISAO,
      campos: edicaoInicialDaPrevisao(PREVISAO),
      aoMudarCampos: () => {},
      aoSalvar: () => {},
      aoCancelar: () => {},
      ...props,
    })
  );

test("o formulario abre com os TRES campos e com os valores de hoje", () => {
  const html = renderEdicao();

  assert.ok(html.includes('id="previsao-descricao"'), "falta a descricao");
  assert.ok(html.includes('id="previsao-valor"'), "falta o valor");
  assert.ok(html.includes('id="previsao-vencimento"'), "falta o vencimento");

  assert.ok(html.includes('value="Streaming mensal"'), `descricao fora: ${html}`);
  // "39,90" E NAO "39.9": o campo e lido com `replace(/\./g, "")` (ponto e
  // separador de milhar no Brasil), entao um "39.9" aqui viraria R$ 399,00 para
  // quem clicasse Salvar sem tocar em nada. Dez vezes o valor, com 200 na rota.
  assert.ok(html.includes('value="39,90"'), `valor fora: ${html}`);
  assert.ok(!html.includes('value="39.9"'), "o campo veio com PONTO decimal");
});

test("o vencimento aparece em dd/mm/aaaa, nao em ISO nem no formato do aparelho", () => {
  // `CampoDeData` e nao o `type="date"` nativo: a ordem dos tres segmentos do
  // nativo sai do APARELHO, e o mesmo app mostra dd/mm para um usuario e mm/dd
  // para outro sem nada dizendo qual. Quem digitasse 10 de MARCO gravaria 3 de
  // OUTUBRO -- data valida, plausivel e sem erro no caminho.
  const html = renderEdicao();

  // ANCORADO NO CAMPO, e nao um `includes` solto na pagina: `CampoDeData`
  // carrega um `type="date"` ESCONDIDO ao lado do campo de texto (e ele e quem
  // abre o calendario nativo), e aquele input leva a ISO de verdade --
  // `value="2026-10-20"`, por construcao. Um `!includes('value="2026-10-20"')`
  // na pagina inteira reprovaria o componente certo por causa do picker.
  assert.match(
    html,
    /id="previsao-vencimento"[^>]*value="20\/10\/2026"/,
    `o campo visivel nao mostra dd/mm/aaaa: ${html}`
  );
  assert.ok(
    !/id="previsao-vencimento"[^>]*value="2026-10-20"/.test(html),
    "o campo visivel mostrou a ISO crua"
  );
});

test("o formulario DIZ que a edicao vale so para esta ocorrencia", () => {
  const html = texto(renderEdicao());

  assert.ok(
    html.includes("Vale só para a ocorrência de 20/10/2026"),
    `falta a frase do alcance: ${html}`
  );
});

test("na SERIE o formulario avisa que as proximas ficam com o valor de antes", () => {
  // `apenas_esta` muda esta ocorrencia e NAO a regra: a assinatura reajustada
  // so neste mes volta ao valor antigo no proximo. Sem esta frase ninguem liga
  // uma coisa a outra -- a correcao parece ter sido desfeita sozinha.
  const serie = texto(
    renderEdicao({
      previsao: PREVISAO_FIXA,
      campos: edicaoInicialDaPrevisao(PREVISAO_FIXA),
    })
  );

  assert.ok(
    serie.includes("as próximas ocorrências continuam com o valor de antes"),
    `falta o aviso da serie: ${serie}`
  );

  // O CONTROLE POSITIVO: na avulsa a frase NAO aparece. Ela nao tem proximas, e
  // dizer que tem ensinaria a pessoa a ignorar a frase na serie, onde ela vale.
  const avulsa = texto(renderEdicao());
  assert.ok(
    !avulsa.includes("as próximas ocorrências continuam"),
    `o aviso da serie apareceu na avulsa: ${avulsa}`
  );
});

test("o formulario tem Salvar e Cancelar, e Salvar apaga enquanto salva", () => {
  assert.ok(renderEdicao().includes('id="previsao-salvar"'), "falta o Salvar");
  assert.ok(renderEdicao().includes('id="previsao-cancelar"'), "falta o Cancelar");

  // Sem isto, o duplo clique manda dois PATCH -- e no caminho da exclusao seriam
  // dois DELETE, o segundo sobre uma linha que ja saiu.
  //
  // O ATRIBUTO `disabled=""`, e NAO a palavra "disabled": todo botao e todo
  // input deste app carrega `disabled:opacity-50` na lista de classes do
  // Tailwind, entao um `includes("disabled")` casa com o componente PARADO e a
  // assercao passaria verde sem o `disabled` existir.
  const contarDisabled = (html) => (html.match(/disabled=""/g) ?? []).length;

  assert.equal(
    contarDisabled(renderEdicao()),
    0,
    "o formulario ja nasce com botao apagado"
  );
  // Os DOIS: o Cancelar tambem apaga, senao fechar no meio da gravacao deixaria
  // o PATCH no ar com o formulario fechado.
  assert.equal(
    contarDisabled(renderEdicao({ salvando: true })),
    2,
    "Salvar e Cancelar nao apagam durante a gravacao"
  );
});

// ---------------------------------------------------------------------------
// A DECISAO, SEM ARVORE: lib/acoes-da-previsao-do-cartao.ts
// ---------------------------------------------------------------------------
// As assercoes acima provam que a decisao CHEGA na tela. Estas provam a decisao
// -- inclusive os ramos que a tela nao tem como mostrar: o `null` do aviso (que
// e o que faz a serie abrir o dialogo) e o alcance dentro do corpo.

test("ehSerieDaPrevisao le recurring_rule_id, e string vazia nao e serie", () => {
  assert.equal(ehSerieDaPrevisao(PREVISAO), false);
  assert.equal(ehSerieDaPrevisao(PREVISAO_FIXA), true);
  assert.equal(ehSerieDaPrevisao({ ...PREVISAO, recurring_rule_id: null }), false);
  // String vazia: `!= null` a aceitaria, e o dialogo abriria sobre uma linha que
  // a rota vai apagar de vez -- a pessoa escolheria "todas as ocorrencias" e
  // apagaria uma linha so, sem nada dizendo que as tres opcoes eram iguais.
  assert.equal(ehSerieDaPrevisao({ ...PREVISAO, recurring_rule_id: "" }), false);
});

test("o pedido de exclusao leva o alcance ESCOLHIDO no corpo", () => {
  // A rota le `alcance` de `request.json()` e cai no default `apenas_esta`
  // quando ele nao vem: um corpo ausente escolheria o alcance mais conservador
  // em silencio, exatamente no caso em que a pessoa pediu "todas".
  for (const alcance of ["apenas_esta", "esta_e_proximas", "todas"]) {
    assert.deepEqual(
      pedidoDeExclusaoDaPrevisaoDoCartao(PREVISAO_FIXA, alcance),
      {
        metodo: "DELETE",
        url: "/api/scheduled-transactions/s2",
        corpo: { alcance },
      },
      `alcance ${alcance} nao chegou no corpo`
    );
  }

  // E a URL e a da AGENDA, nunca a de lancamento: a previsao vive em
  // `scheduled_transactions`, e `/api/personal-finance/transactions/s2`
  // responderia 404 sobre um id que existe, em outra tabela.
  const pedido = pedidoDeExclusaoDaPrevisaoDoCartao(PREVISAO, "apenas_esta");
  assert.ok(
    !pedido.url.includes("personal-finance"),
    `URL de lancamento: ${pedido.url}`
  );
});

test("o id vai escapado na URL da exclusao", () => {
  const pedido = pedidoDeExclusaoDaPrevisaoDoCartao(
    { ...PREVISAO, id: "a/b" },
    "apenas_esta"
  );

  assert.equal(pedido.url, "/api/scheduled-transactions/a%2Fb");
});

test("o aviso do confirm existe na AVULSA e e null na SERIE", () => {
  // O `null` e o contrato: ele e o que obriga a tela a abrir o dialogo do
  // alcance em vez de perguntar duas vezes pela mesma exclusao.
  assert.equal(avisoDaExclusaoDaPrevisaoAvulsa(PREVISAO_FIXA), null);

  const aviso = avisoDaExclusaoDaPrevisaoAvulsa(PREVISAO);
  assert.ok(aviso, "a avulsa ficou sem frase de confirmacao");
  assert.ok(aviso.includes("Streaming mensal"), `falta o nome: ${aviso}`);
  // Ela diz que NAO VOLTA, e isso e verdade: `planejarExclusao` devolve
  // `apagarDeVez` para a linha sem regra, nos tres alcances.
  assert.ok(aviso.includes("não volta"), `falta o que acontece: ${aviso}`);

  // E NAO manda ninguem para Contas a Pagar -- a frase que o ramo da `fixa` de
  // `avisoDaExclusao` usa. A HMO-209 tirou esta linha daquela tela: mandar a
  // pessoa para onde a conta nao aparece e pior que nao dizer nada.
  assert.ok(
    !aviso.includes("Contas a Pagar"),
    `aponta para a tela onde a linha nao existe: ${aviso}`
  );
});

test("o campo e o parser fecham o ciclo: 39,90 volta 39.9, e nao 399", () => {
  // O DEFEITO DE 10x, em uma assercao. `pedidoDeEdicaoDaPrevista` le o campo com
  // `replace(/\./g, "")` porque no Brasil o ponto e separador de MILHAR; um
  // preenchimento com `String(39.9)` faria aquele replace produzir "399".
  assert.equal(valorNoCampoDaPrevisao(39.9), "39,90");
  assert.equal(valorNoCampoDaPrevisao(1234.5), "1234,50");

  const resultado = pedidoDeEdicaoDaPrevisaoDoCartao(
    PREVISAO,
    edicaoInicialDaPrevisao(PREVISAO)
  );

  assert.ok(!("erro" in resultado), `recusou o proprio preenchimento: ${resultado.erro}`);
  assert.equal(resultado.pedido.corpo.amount, 39.9);

  // O CONTROLE POSITIVO do formato: com o ponto decimal o mesmo caminho daria
  // 399. Se um dia `valorNoCampoDaPrevisao` voltar a emitir ponto, a assercao de
  // cima quebra -- e esta prova que ela quebraria pelo motivo certo.
  const comPonto = pedidoDeEdicaoDaPrevisaoDoCartao(PREVISAO, {
    ...edicaoInicialDaPrevisao(PREVISAO),
    valor: "39.9",
  });
  assert.equal(comPonto.pedido.corpo.amount, 399);
});

test("o PATCH leva os tres campos e o alcance apenas_esta", () => {
  const resultado = pedidoDeEdicaoDaPrevisaoDoCartao(PREVISAO_FIXA, {
    descricao: "  Academia Smart  ",
    valor: "129,90",
    vencimento: "2026-11-05",
  });

  assert.deepEqual(resultado, {
    pedido: {
      metodo: "PATCH",
      url: "/api/scheduled-transactions/s2",
      corpo: {
        description: "Academia Smart",
        amount: 129.9,
        due_date: "2026-11-05",
        // ESCRITO, e nao herdado do default da rota: o alcance decide se a serie
        // inteira muda, e e a unica coisa que o formulario nao pergunta.
        alcance: "apenas_esta",
      },
    },
  });
});

test("a edicao recusa os tres estados ruins antes de sair", () => {
  const base = edicaoInicialDaPrevisao(PREVISAO);

  // Campo vazio vira `Number("") === 0`, que nao e `NaN` e passa por qualquer
  // guarda de `isNaN` -- e a rota responde 400 com texto que a tela mostraria
  // como "erro do servidor".
  assert.ok("erro" in pedidoDeEdicaoDaPrevisaoDoCartao(PREVISAO, { ...base, valor: "" }));
  assert.ok("erro" in pedidoDeEdicaoDaPrevisaoDoCartao(PREVISAO, { ...base, valor: "0" }));
  assert.ok(
    "erro" in pedidoDeEdicaoDaPrevisaoDoCartao(PREVISAO, { ...base, descricao: "   " })
  );
  assert.ok(
    "erro" in
      pedidoDeEdicaoDaPrevisaoDoCartao(PREVISAO, { ...base, vencimento: "20/10/2026" }),
    "aceitou vencimento fora de AAAA-MM-DD"
  );

  // E o CONTROLE POSITIVO: o preenchimento bom passa. Sem ele, uma recusa que
  // devolvesse erro para tudo passaria verde nas quatro assercoes acima.
  assert.ok(!("erro" in pedidoDeEdicaoDaPrevisaoDoCartao(PREVISAO, base)));
});

test("a ancora do dialogo e dd/mm/aaaa, montada a mao", () => {
  // A MAO e nao `Intl.DateTimeFormat`: ha Node sem full-icu que devolve o
  // formato en-US para qualquer locale pedido, e este texto entra em assercao.
  // E sem `new Date()`: a ISO seria lida como UTC e, no Brasil, voltaria um dia.
  assert.equal(ancoraDaPrevisao("2026-10-20"), "20/10/2026");
  assert.equal(ancoraDaPrevisao("2026-01-01"), "01/01/2026");

  // Lixo passa adiante em vez de virar string vazia: um `ancora` vazio deixaria
  // o dialogo com "Apenas esta ()" -- o rotulo que deveria identificar a linha
  // identificando nada.
  assert.equal(ancoraDaPrevisao("sem data"), "sem data");
});

test("o aviso da edicao nomeia a ocorrencia, e so a serie ganha a segunda frase", () => {
  const avulsa = avisoDaEdicaoDaPrevisao(PREVISAO);
  const serie = avisoDaEdicaoDaPrevisao(PREVISAO_FIXA);

  assert.ok(avulsa.includes("20/10/2026"), avulsa);
  assert.ok(!avulsa.includes("gasto fixo"), `avulsa chamada de fixa: ${avulsa}`);
  assert.ok(serie.includes("gasto fixo"), `serie sem o aviso: ${serie}`);

  // Nenhuma das duas aponta para Contas a Pagar: nao existe hoje, em tela
  // nenhuma do app, caminho para alterar o VALOR da serie inteira de uma
  // previsao apontada para cartao. Prometer um que nao existe e pior que calar.
  assert.ok(!avulsa.includes("Contas a Pagar"), avulsa);
  assert.ok(!serie.includes("Contas a Pagar"), serie);
});

// ---------------------------------------------------------------------------
// 10. DESCONSIDERAR A COMPRA DO SALDO (HMO-461, F2b da HMO-455)
// ---------------------------------------------------------------------------
// O terceiro verbo do pedido: "contas do cartao tambem podem ser editadas,
// excluidas e DESCONSIDERADAS DO SALDO". A semantica e a **Opcao A** escolhida
// pelo Helio: a linha sai dos RELATORIOS e o total da FATURA continua inteiro.
//
// O QUE ESTA SECAO EXISTE PARA PEGAR, e nenhum dos tres da sintoma:
//
//   1. o `=== true` ingenuo. A coluna da 060 tem TRES estados e `NULL` quer
//      dizer "ninguem mexeu no botao" -- ou seja, SOMA. Trocar
//      `!== false` por `=== true` poria o selo "fora dos totais" e a frase em
//      TODA fatura anterior a migration, e o botao de toda linha antiga
//      prometeria "Voltar a somar" algo que nunca saiu;
//   2. o total da fatura MUDANDO. Se alguem "consertar" a view para filtrar a
//      linha marcada, a fatura do app passa a discordar da do banco -- e e a do
//      banco que o Helio confere. Por isso ha assercao sobre o total AQUI, e
//      nao so sobre o selo;
//   3. a frase ausente. Sem ela o fluxo inteiro se le como botao quebrado: o
//      total nao muda e nada na tela diz por que.
//
// Cada assercao textual nova vem com CONTROLE POSITIVO -- a mesma arvore, no
// outro estado do flag -- porque `assert.ok(!html.includes(X))` passa verde
// tambem quando o render morreu, quando o selo mudou de palavra, e quando o
// componente inteiro deixou de desenhar a lista.

/** A mesma linha, com o flag no estado pedido. */
const linhaComFlag = (valor, descricao = "Mercado do mes") => ({
  ...linha(MEU_CARTAO, descricao, 200, "03"),
  include_in_total: valor,
});

/** A fatura com as linhas dadas, mantendo o total IMPRESSO em 320. */
const faturaCom = (...lines) => ({ ...FATURA, lines, line_count: lines.length });

// --- A resolucao dos tres estados, que e a decisao de baixo de tudo ----------

test("somaNosTotaisDaFatura resolve os TRES estados: NULL e ausente SOMAM", () => {
  // `!== false`, e nao `=== true`. `NULL` na coluna quer dizer "ninguem mexeu
  // no botao", que e o estado de toda compra gravada antes da 060 -- e o
  // `DEFAULT true` da coluna diz que ela soma.
  assert.equal(somaNosTotaisDaFatura({ include_in_total: true }), true);
  assert.equal(somaNosTotaisDaFatura({ include_in_total: false }), false);
  assert.equal(
    somaNosTotaisDaFatura({ include_in_total: null }),
    true,
    "a linha NULL foi tratada como fora dos totais -- e o defeito do `=== true`"
  );
  assert.equal(
    somaNosTotaisDaFatura({}),
    true,
    "linha sem o campo (cache antigo, resposta anterior a 061) virou 'fora'"
  );
});

test("o selo sai do mesmo campo, e a linha NULL NAO ganha selo", () => {
  assert.equal(seloDaLinhaDaFatura(linhaComFlag(false)), "fora dos totais");
  assert.equal(seloDaLinhaDaFatura(linhaComFlag(false)), SELO_FORA_DOS_TOTAIS_NA_FATURA);

  // `null` e nao `""`: quem desenha nao pode renderizar um Badge vazio, que
  // muda o `gap` da linha sem mostrar nada.
  assert.equal(seloDaLinhaDaFatura(linhaComFlag(true)), null);
  assert.equal(
    seloDaLinhaDaFatura(linhaComFlag(null)),
    null,
    "a linha NULL ganhou selo: a fatura antiga inteira apareceria marcada"
  );
});

test("o rotulo do botao tem DUAS frases, e a linha NULL oferece TIRAR", () => {
  // Rotulo fixo mentiria em metade dos cliques: em cima da linha JA desmarcada,
  // "Nao somar nos totais" prometeria desmarcar de novo.
  assert.equal(
    rotuloDeMudarOsTotaisDaLinhaDaFatura(linhaComFlag(true)),
    ROTULO_DE_TIRAR_DOS_TOTAIS_NA_FATURA
  );
  assert.equal(
    rotuloDeMudarOsTotaisDaLinhaDaFatura(linhaComFlag(false)),
    ROTULO_DE_VOLTAR_AOS_TOTAIS_NA_FATURA
  );
  assert.equal(
    rotuloDeMudarOsTotaisDaLinhaDaFatura(linhaComFlag(null)),
    ROTULO_DE_TIRAR_DOS_TOTAIS_NA_FATURA,
    "a linha NULL prometeria RELIGAR uma compra que nunca saiu"
  );

  // As duas frases sao DIFERENTES. Um `??` que colapsasse as duas passaria as
  // duas assercoes de cima se elas comparassem com a mesma constante.
  assert.notEqual(
    ROTULO_DE_TIRAR_DOS_TOTAIS_NA_FATURA,
    ROTULO_DE_VOLTAR_AOS_TOTAIS_NA_FATURA
  );
});

// --- O pedido: a rota da HMO-452, com o booleano invertido e LITERAL ---------

test("o PATCH vai para a rota da HMO-452 com o booleano INVERTIDO", () => {
  const ligada = pedidoDeMudarOsTotaisDaLinhaDaFatura(linhaComFlag(true), false);
  assert.deepEqual(ligada, {
    metodo: "PATCH",
    url: `/api/personal-finance/transactions/${MEU_CARTAO}-03`,
    corpo: { include_in_total: false },
  });

  // O inverso, para que um corpo cravado em `false` nao passe verde.
  const desligada = pedidoDeMudarOsTotaisDaLinhaDaFatura(linhaComFlag(false), false);
  assert.equal(desligada.corpo.include_in_total, true);

  // A LINHA NULL MANDA `false`: ela esta somando (pelo default), e o clique
  // pede para tirar. Um `!linha.include_in_total` escrito a mao mandaria `true`
  // aqui -- a pessoa clica "Nao somar" e a rota recebe "somar".
  const nula = pedidoDeMudarOsTotaisDaLinhaDaFatura(linhaComFlag(null), false);
  assert.equal(
    nula.corpo.include_in_total,
    false,
    "o clique na linha NULL pediu o OPOSTO do que o botao prometia"
  );

  // E o booleano vai LITERAL, nao em string: a rota testa `=== true` estrito, e
  // a string "false" e truthy -- um `String(...)` aqui gravaria o oposto com
  // 200 e sem sintoma na tela.
  assert.equal(typeof ligada.corpo.include_in_total, "boolean");
  assert.equal(JSON.stringify(ligada.corpo), '{"include_in_total":false}');
});

test("a linha do AJUSTE nao tem pedido, e a PARCELA tem", () => {
  // O ajuste de saldo (HMO-253) ja tem controle proprio um bloco acima, e a
  // categoria reservada e o que faz aquela linha SER um ajuste. Ele existe para
  // reconciliar o total -- tira-lo do relatorio deixaria a diferenca que ele
  // representa sem lugar nenhum.
  assert.equal(
    pedidoDeMudarOsTotaisDaLinhaDaFatura(linhaComFlag(true), true),
    null
  );

  // A PARCELA PODE, e aqui esta a diferenca deliberada para o Excluir (que a
  // recusa): desde a 035 cada parcela e uma linha propria de
  // `financial_transactions`, e o PATCH grava nela sem tocar nas irmas. O que
  // estraga a serie e EXCLUIR uma de dez -- marcar uma nao mexe em rotulo
  // nenhum.
  const umaParcela = { ...parcela(3, 10, 300), include_in_total: true };
  const pedidoDaParcela = pedidoDeMudarOsTotaisDaLinhaDaFatura(umaParcela, false);
  assert.ok(
    pedidoDaParcela,
    "a parcela nao pode ser tirada dos totais -- e a unica forma de tirar uma compra em 10x"
  );
  assert.equal(pedidoDaParcela.corpo.include_in_total, false);

  // CONTROLE NEGATIVO da linha de cima: o Excluir continua recusando a parcela.
  assert.equal(pedidoDeExclusaoDaLinhaDaFatura(umaParcela, false), null);
});

// --- O pedagio da frase ------------------------------------------------------

test("faturaTemLinhaForaDosTotais nao se acende numa fatura ANTIGA (toda NULL)", () => {
  assert.equal(faturaTemLinhaForaDosTotais([linhaComFlag(null), linhaComFlag(null)]), false);
  assert.equal(faturaTemLinhaForaDosTotais([linhaComFlag(true)]), false);
  assert.equal(faturaTemLinhaForaDosTotais([]), false);
  assert.equal(faturaTemLinhaForaDosTotais(null), false);

  // CONTROLE POSITIVO: uma linha marcada entre duas que somam acende.
  assert.equal(
    faturaTemLinhaForaDosTotais([
      linhaComFlag(true),
      linhaComFlag(false),
      linhaComFlag(null),
    ]),
    true
  );
});

// --- E agora a ARVORE: a decisao certa com o JSX errado passa verde acima ----

test("o SELO aparece na linha marcada, e so nela", () => {
  const html = render({
    fatura: faturaCom(linhaComFlag(false, "Notebook"), linhaComFlag(true, "Farmacia")),
  });
  const t = texto(html);

  assert.ok(
    t.includes(SELO_FORA_DOS_TOTAIS_NA_FATURA),
    `o selo nao chegou na arvore: ${t.slice(0, 400)}`
  );
  // UMA VEZ, e nao duas: o selo e da linha marcada. Duas ocorrencias significam
  // que a linha que soma tambem ganhou selo.
  assert.equal(
    t.split(SELO_FORA_DOS_TOTAIS_NA_FATURA).length - 1,
    1,
    `o selo apareceu em mais de uma linha: ${t.slice(0, 500)}`
  );

  // CONTROLE POSITIVO do `!includes` abaixo: a MESMA arvore, com o flag no
  // outro estado, desenha as duas compras e NAO traz selo nenhum.
  const limpa = texto(
    render({
      fatura: faturaCom(linhaComFlag(null, "Notebook"), linhaComFlag(true, "Farmacia")),
    })
  );
  assert.ok(limpa.includes("Notebook"), `a lista nem desenhou: ${limpa.slice(0, 300)}`);
  assert.ok(limpa.includes("Farmacia"), limpa.slice(0, 300));
  assert.ok(
    !limpa.includes(SELO_FORA_DOS_TOTAIS_NA_FATURA),
    `a fatura sem linha marcada ganhou selo: ${limpa.slice(0, 400)}`
  );
});

test("A FRASE aparece quando ha linha marcada -- e o total da fatura NAO muda", () => {
  const html = render({ fatura: faturaCom(linhaComFlag(false, "Notebook")) });
  const t = texto(html);

  // A frase, que e o item 3 do escopo. Sem ela a pessoa ve o total igual e
  // conclui que o botao nao funciona.
  assert.ok(
    t.includes(texto(AVISO_DA_FATURA_INTEIRA)),
    `a frase nao chegou na tela: ${t.slice(0, 600)}`
  );

  // A frase DIZ O QUE CONTINUA e DE ONDE A LINHA SAIU -- "sai dos totais"
  // sozinho nao e endereco nenhum, e e justamente a duvida que o selo nao
  // responde.
  assert.ok(t.includes("continua inteiro"), AVISO_DA_FATURA_INTEIRA);
  assert.ok(t.includes("relatórios"), AVISO_DA_FATURA_INTEIRA);
  // E manda para a outra ferramenta: quem marcou a linha querendo mudar o valor
  // da fatura estava procurando o Ajuste de saldo (HMO-253), um bloco acima.
  assert.ok(t.includes("Ajuste de saldo"), AVISO_DA_FATURA_INTEIRA);

  // O TOTAL IMPRESSO CONTINUA INTEIRO -- a Opcao A em pixel. Se alguem filtrar
  // a linha marcada na view, a fatura do app para de bater com a do banco, que
  // e o numero que o Helio confere com o papel ao lado da tela.
  assert.ok(
    t.includes("R$ 320,00"),
    `o total da fatura mudou por causa do flag: ${t.slice(0, 500)}`
  );
});

test("sem linha marcada a frase NAO aparece (e a tela nao fica muda)", () => {
  // Aviso permanente que nao se aplica e o texto que se aprende a nao ler --
  // bem antes do mes em que ele passa a importar.
  const t = texto(render());

  // CONTROLE POSITIVO: a tela desenhou de verdade. Sem ele este teste passa
  // verde tambem se o componente parar de renderizar a lista inteira.
  assert.ok(t.includes("Mercado do mes"), `a lista nem desenhou: ${t.slice(0, 300)}`);
  assert.ok(t.includes("2 gastos nesta fatura"), t.slice(0, 300));

  assert.ok(
    !t.includes("continua inteiro"),
    `a frase apareceu numa fatura sem linha marcada: ${t.slice(0, 500)}`
  );
});

test("o BOTAO aparece com o rotulo do estado, e some sem o handler", () => {
  const marcada = render({
    aoMudarOsTotais: () => {},
    fatura: faturaCom(linhaComFlag(false, "Notebook")),
  });
  assert.ok(
    marcada.includes(ROTULO_DE_VOLTAR_AOS_TOTAIS_NA_FATURA),
    `a linha marcada nao oferece voltar: ${marcada.slice(0, 500)}`
  );
  assert.ok(
    !marcada.includes(ROTULO_DE_TIRAR_DOS_TOTAIS_NA_FATURA),
    "a linha marcada prometeu tirar de novo"
  );

  const somando = render({
    aoMudarOsTotais: () => {},
    fatura: faturaCom(linhaComFlag(null, "Notebook")),
  });
  assert.ok(
    somando.includes(ROTULO_DE_TIRAR_DOS_TOTAIS_NA_FATURA),
    `a linha NULL nao oferece tirar: ${somando.slice(0, 500)}`
  );
  assert.ok(
    !somando.includes(ROTULO_DE_VOLTAR_AOS_TOTAIS_NA_FATURA),
    "a linha NULL prometeu RELIGAR uma compra que nunca saiu"
  );

  // SEM O HANDLER, NENHUM DOS DOIS. O prop e opcional, e e isso que mantem este
  // componente sem rede -- um botao que aparecesse sempre apareceria tambem
  // onde nao ha nada ligado nele.
  const semHandler = render({ fatura: faturaCom(linhaComFlag(false, "Notebook")) });
  // CONTROLE POSITIVO: a linha continua desenhada, com selo e tudo.
  assert.ok(semHandler.includes("Notebook"), semHandler.slice(0, 300));
  assert.ok(texto(semHandler).includes(SELO_FORA_DOS_TOTAIS_NA_FATURA), "o selo sumiu junto");
  assert.ok(
    !semHandler.includes(ROTULO_DE_TIRAR_DOS_TOTAIS_NA_FATURA) &&
      !semHandler.includes(ROTULO_DE_VOLTAR_AOS_TOTAIS_NA_FATURA),
    "o botao apareceu sem handler atras dele"
  );
});

test("a linha do AJUSTE nao ganha o botao dos totais", () => {
  // Mesma regra da Fase 1, pelo mesmo motivo -- e o item 4 do escopo.
  //
  // A FATURA TEM **SO** A LINHA DO AJUSTE, de proposito. Com uma compra comum
  // ao lado, o `!html.includes(rotulo)` reprovaria pela linha VIZINHA, que
  // ganha o botao com razao: o grep e da pagina inteira e o rotulo e o mesmo
  // nas duas linhas. A versao com duas linhas desta assercao foi escrita
  // primeiro e falhou exatamente assim
  // (`guarda-que-grepa-a-pagina-inteira-por-fragmento-de-url-reprova-o-link-novo-e-certo`).
  //
  // O `include_in_total: false` e o caso adversario: mesmo marcada -- estado
  // ALCANCAVEL, porque a lista de Despesas (HMO-452) oferece o toggle sem
  // peneirar a categoria reservada -- a linha do ajuste nao ganha o botao AQUI.
  const html = render({
    fatura: faturaCom({ ...linhaDeAjuste(), include_in_total: false }),
    categoriaDeAjuste: CATEGORIA_DE_AJUSTE,
    aoMudarOsTotais: () => {},
  });
  const t = texto(html);

  // CONTROLE POSITIVO: a linha do ajuste ESTA na tela, com o selo "Ajuste" --
  // ela fica na lista para a soma fechar com o total impresso em cima. Sem
  // isto, o `!includes` abaixo passa verde tambem com a tela em branco.
  assert.ok(t.includes("Ajuste de saldo da fatura"), t.slice(0, 400));
  assert.ok(t.includes("Ajuste"), t.slice(0, 400));

  assert.ok(
    !html.includes(ROTULO_DE_TIRAR_DOS_TOTAIS_NA_FATURA) &&
      !html.includes(ROTULO_DE_VOLTAR_AOS_TOTAIS_NA_FATURA),
    `o ajuste ganhou o botao dos totais: ${html.slice(0, 600)}`
  );
});

test("o ajuste JA marcado mostra o selo -- o botao e que nao vem", () => {
  // ESTE CASO NAO E ZELO: a primeira versao desta secao afirmava "nem o selo"
  // no teste acima, e estava errada.
  //
  // O estado e ALCANCAVEL. A lista de Despesas da HMO-452 oferece o toggle em
  // qualquer lancamento realizado e NAO peneira a categoria reservada do
  // ajuste -- entao existe ajuste com `include_in_total = false` gravado por
  // outra tela, sem que esta tela tenha oferecido nada.
  //
  // E nesse estado o selo esta CERTO: aquele ajuste realmente esta fora dos
  // relatorios. Esconde-lo aqui -- "o ajuste nao participa desta feature" --
  // faria a tela mentir sobre dinheiro que de fato saiu das somas, no unico
  // lugar onde a pessoa teria como descobrir isso. E por isso que
  // `seloDaLinhaDaFatura` NAO recebe `ehAjuste`: o selo DESCREVE o estado, o
  // botao e que DECIDE quem pode mexer.
  const t = texto(
    render({
      fatura: faturaCom({ ...linhaDeAjuste(), include_in_total: false }),
      categoriaDeAjuste: CATEGORIA_DE_AJUSTE,
    })
  );

  assert.ok(
    t.includes(SELO_FORA_DOS_TOTAIS_NA_FATURA),
    `o ajuste marcado esconde que esta fora dos relatorios: ${t.slice(0, 500)}`
  );
  // Os dois selos convivem: "Ajuste" diz o que a linha E, "fora dos totais" diz
  // onde ela nao esta.
  assert.ok(t.includes("Ajuste"), t.slice(0, 400));

  // CONTROLE POSITIVO: o ajuste NAO marcado nao ganha o selo -- sem isto, um
  // selo cravado sempre passaria verde acima.
  const semMarca = texto(
    render({
      fatura: faturaCom(linhaDeAjuste()),
      categoriaDeAjuste: CATEGORIA_DE_AJUSTE,
    })
  );
  assert.ok(semMarca.includes("Ajuste de saldo da fatura"), semMarca.slice(0, 300));
  assert.ok(
    !semMarca.includes(SELO_FORA_DOS_TOTAIS_NA_FATURA),
    `o ajuste comum ganhou selo de fora dos totais: ${semMarca.slice(0, 400)}`
  );
});

test("a compra COMUM continua com o botao quando ha um ajuste na fatura", () => {
  // O inverso do teste acima: a peneira do ajuste nao pode desligar a feature
  // nas linhas vizinhas. Sem este caso, `podeMudarOsTotais` cravado em `false`
  // passaria verde no teste de cima.
  const html = render({
    fatura: faturaCom(linhaDeAjuste(), linhaComFlag(true, "Farmacia")),
    categoriaDeAjuste: CATEGORIA_DE_AJUSTE,
    aoMudarOsTotais: () => {},
  });

  assert.ok(
    html.includes(ROTULO_DE_TIRAR_DOS_TOTAIS_NA_FATURA),
    `a compra comum perdeu o botao por causa do ajuste: ${html.slice(0, 600)}`
  );
});
