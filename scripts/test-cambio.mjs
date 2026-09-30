#!/usr/bin/env node
// =====================================================
// PULODOGATO - o cambio do dia da compra (HMO-182, item 3 da HMO-138)
// =====================================================
// A migration 026 pos no banco um CHECK que cruza duas colunas:
//
//     CHECK ((currency = 'BRL') = (exchange_rate = 1))
//
// e `exchange_rate` nasceu com `DEFAULT 1`. A consequencia foi medida no
// Postgres antes de esta suite existir, com as migrations 001..026 aplicadas:
//
//     (BRL, default)  -> INSERT 0 1
//     (USD, default)  -> ERRO 23514   <-- todo lancamento em moeda estrangeira
//     (USD, 5.42)     -> INSERT 0 1
//
// A linha do meio nao e um caso de borda: o DEFAULT acerta exatamente o valor
// proibido, entao o app -- que ja mandava `currency` desde a HMO-171 -- passou a
// ser recusado em TODO lancamento fora do real no instante em que a 026 entrou
// em producao.
//
// Por isso a maior parte das asercoes aqui e sobre a mesma pergunta: o que vai
// para a coluna `exchange_rate`? As funcoes puras sao pequenas; o que elas
// protegem e caro.
//
// O QUE ESTA SUITE OLHA COM MAIS CUIDADO
// --------------------------------------
//   1. `cotacaoCoerente` e a mesma regra do CHECK. Se as duas divergirem, quem
//      ganha e o banco, e o sintoma e "Erro ao gravar o lancamento" sem mais
//      nada;
//   2. `escolherBoletim` NAO pega o ultimo item da lista. Um dia util devolve
//      cinco boletins e o ultimo so e o Fechamento depois que o dia terminou --
//      no meio da tarde e um Intermediario;
//   3. `datasParaTentar` anda para TRAS. Andar para frente resolveria o fim de
//      semana e quebraria a razao de existir da issue;
//   4. as DUAS leituras de cotacao digitada concordam. Uma vive em lib/cambio.ts
//      e a outra e uma copia inline em `validarLancamento`, que nao pode
//      importar nada.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  BOLETIM_DE_FECHAMENTO,
  MAX_DIAS_PARA_TRAS,
  MOEDAS_COM_PTAX,
  cotacaoCoerente,
  cotacaoDigitada,
  dataParaPtax,
  datasParaTentar,
  escolherBoletim,
  precisaDeCotacao,
  ptaxCobre,
  taxaDoBoletim,
  taxaImplicita,
  taxaParaGravar,
  valorEmReais,
} from "../.tmp-cambio/cambio.js";

import { valoresIniciais, validarLancamento } from "../.tmp-cambio/lancamento.js";

// ---------------------------------------------------------------------------
// 1. A REGRA DO CHECK, EM TYPESCRIPT
// ---------------------------------------------------------------------------

test("cotacaoCoerente reproduz o CHECK da 026, caso por caso", () => {
  // Estas quatro linhas sao as MESMAS que foram rodadas no Postgres. Se esta
  // tabela mudar sem a do banco mudar, a tela passa a aprovar o que o banco
  // recusa (ou o contrario, e aparece uma recusa que ninguem explica).
  assert.equal(cotacaoCoerente("BRL", 1), true, "real com cotacao 1");
  assert.equal(cotacaoCoerente("USD", 1), false, "o caso que quebrou producao");
  assert.equal(cotacaoCoerente("EUR", 1), false, "idem, em euro");
  assert.equal(cotacaoCoerente("USD", 5.42), true, "dolar com cotacao de verdade");
});

test("real com cotacao diferente de 1 tambem e recusado", () => {
  // A metade menos obvia do CHECK: ele e uma IGUALDADE, nao "moeda estrangeira
  // precisa de cotacao". Um lancamento em reais com cotacao 1,05 viola tanto
  // quanto um dolar com cotacao 1 -- e chegaria aqui por um campo que ficou
  // preenchido depois de a pessoa voltar a moeda para BRL.
  assert.equal(cotacaoCoerente("BRL", 1.05), false);
  assert.equal(cotacaoCoerente("BRL", 5.42), false);
});

test("cotacao que nao e numero positivo nunca e coerente", () => {
  // `Number.parseFloat("")` devolve NaN, e NaN passa por qualquer `>` ou `<`
  // sem reclamar. Um NaN que escapasse daqui viraria `exchange_rate: NaN` no
  // corpo do INSERT, que o PostgREST manda como null e a coluna e NOT NULL.
  for (const ruim of [Number.NaN, 0, -1, -0.5, null, undefined, Infinity]) {
    assert.equal(
      cotacaoCoerente("USD", ruim),
      false,
      `cotacao ${String(ruim)} deveria ser recusada`
    );
  }
  // E o outro CHECK (`exchange_rate > 0`) vale para BRL tambem.
  assert.equal(cotacaoCoerente("BRL", 0), false);
});

test("a moeda e lida sem depender de espaco ou caixa", () => {
  // O codigo chega de `profiles.preferences`, do corpo de um POST e da coluna da
  // conta. Um " usd " que passasse como "moeda estrangeira" exigiria cotacao de
  // um lancamento que o banco vai gravar como... nada: o CHECK compara com
  // 'BRL' exato, e o INSERT so passa se a coluna receber o codigo limpo.
  assert.equal(cotacaoCoerente(" brl ", 1), true);
  assert.equal(cotacaoCoerente("usd", 5.42), true);
  assert.equal(cotacaoCoerente("usd", 1), false);
});

// ---------------------------------------------------------------------------
// 2. O QUE VAI PARA A COLUNA
// ---------------------------------------------------------------------------

test("taxaParaGravar devolve 1 para real, ignorando o que foi digitado", () => {
  // O campo de cotacao nao aparece em BRL, mas o ESTADO dele sobrevive a uma
  // troca de moeda. Se o valor digitado vazasse para o payload em BRL, o CHECK
  // recusaria a linha -- e o campo nem esta na tela para a pessoa corrigir.
  assert.equal(taxaParaGravar("BRL", null), 1);
  assert.equal(taxaParaGravar("BRL", 5.42), 1);
  assert.equal(taxaParaGravar("BRL", Number.NaN), 1);
  assert.equal(taxaParaGravar(undefined, null), 1, "sem moeda = real");
});

test("taxaParaGravar recusa moeda estrangeira sem cotacao", () => {
  // `null` e o resultado que segura o INSERT. Devolver 1 aqui seria a pior
  // falha possivel: e o unico numero que o CHECK proibe, e num mundo sem o CHECK
  // a despesa de 180 dolares entraria no acerto da viagem valendo 180 reais.
  assert.equal(taxaParaGravar("USD", null), null);
  assert.equal(taxaParaGravar("USD", undefined), null);
  assert.equal(taxaParaGravar("USD", 0), null);
  assert.equal(taxaParaGravar("USD", 1), null, "1 em dolar e o par proibido");
  assert.equal(taxaParaGravar("USD", 5.42), 5.42);
});

test("precisaDeCotacao separa real de todo o resto", () => {
  assert.equal(precisaDeCotacao("BRL"), false);
  assert.equal(precisaDeCotacao(null), false, "vazio cai em real");
  for (const m of ["USD", "EUR", "PYG", "JPY"]) {
    assert.equal(precisaDeCotacao(m), true, m);
  }
});

// ---------------------------------------------------------------------------
// 3. O BOLETIM QUE VALE
// ---------------------------------------------------------------------------

// Um dia util de verdade, copiado da resposta do Olinda para 2026-09-28.
const DIA_FECHADO = [
  { cotacaoCompra: 5.2061, cotacaoVenda: 5.2067, dataHoraCotacao: "2026-09-28 10:11:15", tipoBoletim: "Abertura" },
  { cotacaoCompra: 5.2098, cotacaoVenda: 5.2104, dataHoraCotacao: "2026-09-28 11:08:13", tipoBoletim: "Intermediário" },
  { cotacaoCompra: 5.215, cotacaoVenda: 5.2156, dataHoraCotacao: "2026-09-28 12:08:11", tipoBoletim: "Intermediário" },
  { cotacaoCompra: 5.2194, cotacaoVenda: 5.22, dataHoraCotacao: "2026-09-28 13:03:11", tipoBoletim: "Intermediário" },
  { cotacaoCompra: 5.2126, cotacaoVenda: 5.2132, dataHoraCotacao: "2026-09-28 13:03:11", tipoBoletim: "Fechamento PTAX" },
];

test("escolherBoletim pega o fechamento, nao o ultimo da lista", () => {
  const b = escolherBoletim(DIA_FECHADO);
  assert.equal(b.tipoBoletim, BOLETIM_DE_FECHAMENTO);
  assert.equal(taxaDoBoletim(b), 5.2132);
});

test("dia ainda em aberto NAO tem cotacao (o ultimo e um Intermediario)", () => {
  // Este e o caso que uma leitura por `value[value.length - 1]` erra, e erra
  // exatamente onde importa: um lancamento feito HOJE, no meio da tarde. A taxa
  // 5,22 seria congelada no lancamento com o nome de "PTAX de hoje" e nunca mais
  // conferiria com a PTAX real daquela data.
  const emAberto = DIA_FECHADO.slice(0, 4);
  assert.equal(escolherBoletim(emAberto), null);

  // O controle que prova que a assercao acima nao passa por acidente: a mesma
  // lista COM o fechamento devolve boletim.
  assert.notEqual(escolherBoletim(DIA_FECHADO), null);
});

test("fim de semana e feriado chegam como lista vazia", () => {
  // Medido: 09-26-2026 (sabado) devolve `{"value":[]}` com HTTP 200. Nao e erro,
  // e a resposta certa -- e quem trata isso e o laco que anda para tras.
  assert.equal(escolherBoletim([]), null);
  assert.equal(escolherBoletim(null), null);
  assert.equal(escolherBoletim(undefined), null);
});

test("taxaDoBoletim usa a cotacao de VENDA", () => {
  // Despesa no exterior e compra de moeda, e o lado de venda do boletim e o
  // preco de quem compra. Usar `cotacaoCompra` subestimaria todo gasto de viagem
  // de forma consistente -- pouco, sempre para o mesmo lado, sem nada na tela
  // que denuncie. A diferenca aqui e de 6 pontos no quarto decimal.
  assert.equal(taxaDoBoletim(DIA_FECHADO[4]), 5.2132);
  assert.notEqual(taxaDoBoletim(DIA_FECHADO[4]), 5.2126, "essa e a de compra");
});

test("boletim com cotacao invalida devolve null em vez de zero", () => {
  assert.equal(taxaDoBoletim({ cotacaoVenda: 0, tipoBoletim: BOLETIM_DE_FECHAMENTO }), null);
  assert.equal(taxaDoBoletim({ cotacaoVenda: null, tipoBoletim: BOLETIM_DE_FECHAMENTO }), null);
});

// ---------------------------------------------------------------------------
// 4. AS DATAS, SEMPRE PARA TRAS
// ---------------------------------------------------------------------------

test("datasParaTentar comeca na data da compra e anda para tras", () => {
  const datas = datasParaTentar("2026-09-26", 3);
  assert.deepEqual(datas, [
    "2026-09-26",
    "2026-09-25",
    "2026-09-24",
    "2026-09-23",
  ]);
});

test("nenhuma data tentada e POSTERIOR a compra", () => {
  // A afirmacao central da issue: "usar o cambio de hoje faria o valor do
  // passado mudar sozinho". Uma compra de sabado vale pela sexta, nunca pela
  // segunda -- e uma implementacao que buscasse "o proximo dia util" passaria
  // em todo teste de fim de semana e violaria isto.
  const compra = "2026-09-26";
  for (const d of datasParaTentar(compra)) {
    assert.ok(d <= compra, `${d} e depois de ${compra}`);
  }
});

test("a virada de mes e de ano nao produz data invalida", () => {
  assert.deepEqual(datasParaTentar("2026-03-01", 2), [
    "2026-03-01",
    "2026-02-28",
    "2026-02-27",
  ]);
  assert.deepEqual(datasParaTentar("2026-01-01", 1), ["2026-01-01", "2025-12-31"]);
  // 2024 foi bissexto: 1 de marco volta para 29 de fevereiro.
  assert.deepEqual(datasParaTentar("2024-03-01", 1), ["2024-03-01", "2024-02-29"]);
});

test("a primeira data e a da compra, e nao o dia anterior (UTC)", () => {
  // O erro de fuso classico: `new Date("2026-09-26")` e meia-noite UTC, mas
  // `getDate`/`setDate` leem o fuso local. Em America/Sao_Paulo isso e 21h do
  // dia 25, e a lista sairia comecando um dia antes -- a cotacao viria sempre do
  // dia anterior a compra, sem nada na tela apontando isso.
  assert.equal(datasParaTentar("2026-09-26", 0)[0], "2026-09-26");
  assert.equal(datasParaTentar("2026-01-01", 0)[0], "2026-01-01");
});

test("o teto de dias e respeitado, e o padrao e MAX_DIAS_PARA_TRAS", () => {
  assert.equal(datasParaTentar("2026-09-26", 3).length, 4);
  assert.equal(datasParaTentar("2026-09-26").length, MAX_DIAS_PARA_TRAS + 1);
});

test("data impossivel devolve lista vazia em vez de NaN", () => {
  assert.deepEqual(datasParaTentar("nao-e-data"), []);
});

test("dataParaPtax poe mes antes de dia (o Olinda exige MM-DD-YYYY)", () => {
  // Trocar a ordem nao da erro: devolve lista vazia, que este modulo leria como
  // feriado. Um 09-13 viraria "13 de setembro" num mes e "sem boletim" no outro,
  // e o unico sintoma seria a cotacao vindo do dia errado.
  assert.equal(dataParaPtax("2026-09-26"), "09-26-2026");
  assert.equal(dataParaPtax("2026-01-31"), "01-31-2026");
});

// ---------------------------------------------------------------------------
// 5. COBERTURA DA PTAX -- O QUE O BANCO CENTRAL NAO PUBLICA
// ---------------------------------------------------------------------------

test("a PTAX cobre 7 das 13 moedas do app", () => {
  // Medido contra o endpoint /Moedas do Olinda em 2026-09-29: ele lista DEZ
  // moedas, e tres delas (DKK, NOK, SEK) nao estao no catalogo do app.
  for (const m of ["USD", "EUR", "GBP", "CHF", "CAD", "AUD", "JPY"]) {
    assert.equal(ptaxCobre(m), true, `${m} tem PTAX`);
  }
  // Estas cinco NAO tem cotacao publicada, nunca -- e sao justamente as dos
  // vizinhos de carro. Para elas "nao consegui buscar" e mentira: nao ha o que
  // buscar, e a tela tem de dizer isso em vez de convidar a tentar de novo.
  for (const m of ["ARS", "CLP", "UYU", "PYG", "CNY"]) {
    assert.equal(ptaxCobre(m), false, `${m} nao tem PTAX`);
  }
});

test("BRL e moeda inventada nao tem PTAX para buscar", () => {
  assert.equal(ptaxCobre("BRL"), false, "real nao precisa de cotacao");
  assert.equal(ptaxCobre("XYZ"), false, "fora do catalogo do app");
  assert.equal(ptaxCobre(""), false);
  assert.equal(ptaxCobre(null), false);
});

test("a lista de moedas da PTAX e a do Banco Central, nao a do app", () => {
  // DKK/NOK/SEK ficam na constante de proposito: ela descreve a API, e quem
  // cruza com o catalogo da tela e `ptaxCobre`. Se alguem "limpasse" a lista
  // para so as moedas do app, adicionar a coroa dinamarquesa ao catalogo
  // silenciosamente pararia de buscar cotacao.
  for (const m of ["DKK", "NOK", "SEK"]) {
    assert.ok(MOEDAS_COM_PTAX.includes(m), `${m} esta na PTAX`);
    assert.equal(ptaxCobre(m), false, `${m} nao esta no catalogo do app`);
  }
});

// ---------------------------------------------------------------------------
// 6. O TEXTO DIGITADO
// ---------------------------------------------------------------------------

test("cotacaoDigitada aceita virgula e ponto", () => {
  // O teclado brasileiro produz virgula. Recusar "5,42" faria o formulario
  // rejeitar uma cotacao escrita corretamente para o idioma da tela.
  assert.equal(cotacaoDigitada("5,42"), 5.42);
  assert.equal(cotacaoDigitada("5.42"), 5.42);
  assert.equal(cotacaoDigitada(" 5,2132 "), 5.2132);
  assert.equal(cotacaoDigitada("0,0007"), 0.0007, "o guarani");
});

test("ponto e lido como decimal, e o ambiguo cai para o lado visivel", () => {
  // "1.234" nao tem leitura unica (em pt-BR o ponto e separador de milhar). A
  // escolha e ler como decimal, porque e o lado que erra VISIVEL: um valor
  // digitado no campo errado vira um total pequeno e obviamente errado no rodape
  // do campo, em vez de um total grande que passa batido.
  assert.equal(cotacaoDigitada("1.234"), 1.234);
  assert.equal(cotacaoDigitada("5.42"), 5.42);
});

test("as formas em que um VALOR aparece sao recusadas", () => {
  // Nenhuma moeda do catalogo vale mil reais por unidade, entao mais de tres
  // digitos inteiros nao e cotacao. E dois separadores nao e numero nenhum.
  assert.equal(cotacaoDigitada("1.234,56"), null, "duas marcas");
  assert.equal(cotacaoDigitada("5421,00"), null, "quatro digitos inteiros");
  assert.equal(cotacaoDigitada("1000"), null);
});

test("cotacaoDigitada recusa vazio, zero, negativo e lixo", () => {
  for (const ruim of ["", "   ", "0", "0,00", "-5", "abc", "5,4,2", null, undefined]) {
    assert.equal(
      cotacaoDigitada(ruim),
      null,
      `${JSON.stringify(ruim)} deveria ser recusado`
    );
  }
});

test("as DUAS leituras de cotacao concordam", () => {
  // `cotacaoDigitada` vive em lib/cambio.ts; a copia inline vive dentro de
  // `validarLancamento`, em lib/lancamento.ts, que nao importa nada de
  // proposito. Uma leitura mais frouxa do lado do formulario aprovaria um texto
  // que `taxaParaGravar` depois le como null, o payload transformaria em 1 pelo
  // `?? 1`, e o banco recusaria com 23514 -- uma recusa em cima de um valor que
  // a tela disse estar bom.
  const entradas = [
    "5,42", "5.42", "0,0007", "1.234", "1.234,56", "", "0", "-5", "abc",
    "1", "999", "1000", "5,4,2", " 5,2132 ",
  ];

  for (const texto of entradas) {
    const pelaCambio = cotacaoDigitada(texto) !== null;

    const valores = { ...valoresIniciais(), moeda: "USD", cotacao: texto };
    const r = validarLancamento(
      "expense",
      { ...valores, descricao: "Jantar", categoriaId: "c1", valor: "180" },
      { editando: false }
    );
    const pelaValidacao = r.ok;

    // Um texto que uma aceita e a outra recusa e exatamente a divergencia que
    // este teste existe para pegar. Excecao conhecida e desejada: "1" passa por
    // `cotacaoDigitada` (e um numero positivo valido) e e recusado por
    // `validarLancamento` em moeda estrangeira, porque 1 e o par proibido do
    // CHECK. Ver o caso seguinte.
    if (texto.trim() === "1") continue;

    assert.equal(
      pelaValidacao,
      pelaCambio,
      `divergencia em ${JSON.stringify(texto)}: cambio=${pelaCambio} validacao=${pelaValidacao}`
    );
  }
});

// ---------------------------------------------------------------------------
// 7. A VALIDACAO DO FORMULARIO
// ---------------------------------------------------------------------------

const base = () => ({
  ...valoresIniciais(),
  descricao: "Jantar em Lisboa",
  categoriaId: "cat-1",
  valor: "180",
});

test("lancamento em real nao pede cotacao", () => {
  const r = validarLancamento("expense", { ...base(), moeda: "BRL" }, { editando: false });
  assert.equal(r.ok, true);
});

test("lancamento em euro sem cotacao e recusado, dizendo a moeda", () => {
  const r = validarLancamento(
    "expense",
    { ...base(), moeda: "EUR", cotacao: "" },
    { editando: false }
  );
  assert.equal(r.ok, false);
  // A mensagem tem de nomear a moeda: "informe a cotacao" num formulario com
  // varios campos numericos nao diz qual deles.
  assert.match(r.mensagem, /EUR/);
});

test("cotacao 1 em moeda estrangeira e recusada com a razao", () => {
  // O caso que o DEFAULT da coluna produz, e o que quebrou producao. A mensagem
  // e diferente da de campo vazio de proposito: o campo esta preenchido, e
  // "informe a cotacao" faria a pessoa olhar um campo que ja tem numero.
  const r = validarLancamento(
    "expense",
    { ...base(), moeda: "USD", cotacao: "1" },
    { editando: false }
  );
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /1 vale só para reais|só para reais/);
});

test("lancamento em dolar com cotacao valida passa", () => {
  const r = validarLancamento(
    "expense",
    { ...base(), moeda: "USD", cotacao: "5,2132" },
    { editando: false }
  );
  assert.equal(r.ok, true);
});

test("valoresIniciais nasce com cotacao vazia, nao com 1", () => {
  // "1" como padrao seria o pior valor possivel: invisivel em BRL (onde esta
  // certo) e o par proibido em qualquer outra moeda (onde o campo aparece ja
  // preenchido e com cara de pronto).
  assert.equal(valoresIniciais().cotacao, "");
});

// ---------------------------------------------------------------------------
// 8. A CONVERSAO
// ---------------------------------------------------------------------------

test("valorEmReais arredonda ao centavo, como o banco", () => {
  // As views da 026 fazem `t.amount * t.exchange_rate` no Postgres. Uma tela que
  // arredondasse diferente mostraria um total que nao fecha com o extrato, e um
  // centavo de diferenca e o tipo de coisa que ninguem consegue explicar depois.
  assert.equal(valorEmReais(180, 5.2132), 938.38);
  assert.equal(valorEmReais(100, 5.2132), 521.32);
  assert.equal(valorEmReais(-180, 5.2132), -938.38, "despesa e negativa");
});

test("taxaImplicita tira a cotacao dos dois valores da transferencia", () => {
  // R$ 1.000 que viraram US$ 180 foram cambiados a 5,5556 -- a taxa real da
  // operacao, com spread e IOF embutidos.
  const t = taxaImplicita(1000, 180);
  assert.ok(Math.abs(t - 5.5556) < 0.0001, `deu ${t}`);
  // O sinal nao significa nada aqui: uma perna e negativa por construcao.
  assert.equal(taxaImplicita(-1000, 180), t);
});

test("taxaImplicita recusa zero em vez de devolver Infinity", () => {
  assert.equal(taxaImplicita(1000, 0), null);
  assert.equal(taxaImplicita(0, 180), null);
  assert.equal(taxaImplicita(Number.NaN, 180), null);
});
