#!/usr/bin/env node
// =====================================================
// PULODOGATO - so esta, desta em diante, ou TODAS (HMO-228)
// =====================================================
// "Ao apagar ou alterar uma conta parcelada ou fixa, perguntar se quer
// apagar/alterar apenas aquela parcela, a partir daquela parcela ou todas as
// parcelas, e ai fazer os ajustes conforme escolhido."
//
// A HMO-170 entregou os dois primeiros alcances, so na EDICAO e so para a conta
// fixa. Este arquivo cobra as quatro coisas que faltavam:
//
//   1. `todas` na conta fixa -- o UNICO alcance que olha para tras, e por isso
//      o unico que pode reescrever um mes ja conferido;
//   2. alcance na EXCLUSAO, incluindo o `end_date` na regra (sem ele a conta
//      apagada volta meses depois, e um teste que confere so o `skipped`
//      das linhas passa verde com o defeito de pe);
//   3. a serie de cartao, que e outra tabela e tem outra barreira (o NUMERO da
//      parcela, nao a data);
//   4. o total da compra recalculado -- em "desta em diante" ele deixa de ser
//      `parcela x M`.
//
// Os testes do alcance que a HMO-170 ja entregou continuam em
// scripts/test-recorrencia-edicao.mjs. Este arquivo nao os repete.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  planejarEdicao,
  planejarExclusao,
  conferirPatchNoAlcance,
  ehAlcanceValido,
  alcancaIrmas,
  ALCANCES,
} from "../.tmp-alcance-da-serie/lib/recorrencia-edicao.js";

import {
  planejarAlteracaoDeParcelas,
  novosValoresDasParcelas,
  totalDaCompra,
  consequenciaDoAlcance,
  ehAlcanceDeParcelaValido,
  // O movimento da serie (HMO-357) -- secao 7.
  mesesEntreFaturas,
  mesDaFaturaPedida,
  novasFaturasDasParcelas,
  consequenciaDoMovimento,
  movimentoPedidoNaTela,
} from "../.tmp-alcance-da-serie/lib/parcelas-edicao.js";

import {
  opcoesDeAlcance,
  consequenciaNaTela,
  precisaPerguntarBase,
  frasePreservadas,
} from "../.tmp-alcance-da-serie/lib/alcance-na-tela.js";

// ---------------------------------------------------------------------------
// A SERIE DO ALUGUEL (conta fixa)
// ---------------------------------------------------------------------------
// Setembro foi pago. Outubro VENCEU e nao foi pago. Novembro esta pulado.
// Dezembro em diante estao pendentes. Janeiro foi pago ANTECIPADAMENTE -- e
// essa linha e a que separa a barreira certa da errada, porque ela tem
// `due_date` no futuro e dinheiro que ja andou.
const REGRA = "regra-aluguel";
const o = (id, due_date, status = "pending") => ({
  id,
  due_date,
  status,
  recurring_rule_id: REGRA,
});

const SETEMBRO = o("set", "2026-09-10", "paid");
const OUTUBRO = o("out", "2026-10-10"); // vencida e nao paga
const NOVEMBRO = o("nov", "2026-11-10", "skipped");
const DEZEMBRO = o("dez", "2026-12-10");
const JANEIRO = o("jan", "2027-01-10", "paid"); // pago antecipadamente
const FEVEREIRO = o("fev", "2027-02-10");

const SERIE = [SETEMBRO, OUTUBRO, NOVEMBRO, DEZEMBRO, JANEIRO, FEVEREIRO];

test("os tres alcances existem, e so eles", () => {
  assert.deepEqual(ALCANCES, ["apenas_esta", "esta_e_proximas", "todas"]);
  assert.equal(ehAlcanceValido("todas"), true);
  assert.equal(ehAlcanceValido("todas_as_parcelas"), false);
  assert.equal(ehAlcanceValido(undefined), false);
});

test("alcancaIrmas: 'todas' precisa da serie, igual a 'esta_e_proximas'", () => {
  // O `if` da rota que buscava a serie foi escrito para DOIS alcances. Deixar o
  // `todas` fora dele faria a rota planejar sobre uma lista vazia e responder
  // "alterei 1 ocorrencia" -- sucesso, sem erro, sem ter alterado a serie.
  assert.equal(alcancaIrmas("apenas_esta"), false);
  assert.equal(alcancaIrmas("esta_e_proximas"), true);
  assert.equal(alcancaIrmas("todas"), true);
});

// ---------------------------------------------------------------------------
// 1. `todas` NA EDICAO
// ---------------------------------------------------------------------------

test("'todas' alcanca o mes ANTERIOR a ancora -- e e o unico que alcanca", () => {
  // A ancora e dezembro. Outubro vence antes dela e esta em aberto.
  const plano = planejarEdicao("todas", DEZEMBRO, SERIE);

  assert.ok(
    plano.ids.includes("out"),
    "outubro (vencida, em aberto, ANTERIOR a ancora) tem de entrar em 'todas'"
  );

  // O contraste que define o alcance: o mesmo outubro NAO entra em
  // "esta_e_proximas". Se os dois alcances dessem o mesmo resultado aqui, o
  // item novo do Select nao faria nada.
  const proximas = planejarEdicao("esta_e_proximas", DEZEMBRO, SERIE);
  assert.ok(
    !proximas.ids.includes("out"),
    "'esta_e_proximas' nao pode alcancar outubro"
  );
  assert.notDeepEqual(plano.ids.slice().sort(), proximas.ids.slice().sort());
});

test("O MUTANTE CRITICO: 'todas' barra por status, NUNCA por data", () => {
  const plano = planejarEdicao("todas", DEZEMBRO, SERIE);

  // Setembro esta PAGO e no passado. Uma barreira de data o protegeria por
  // acidente, e por isso ele sozinho nao prova nada.
  assert.ok(!plano.ids.includes("set"), "setembro esta paga");

  // JANEIRO e a assercao que mata o mutante de data. Ele esta PAGO (quitado
  // antecipadamente) e tem `due_date` no FUTURO. Uma barreira `due_date >= hoje`
  // deixaria janeiro passar e reescreveria o valor de um mes cujo dinheiro ja
  // andou -- exatamente o que "nunca mudar o que ja passou" proibe.
  assert.ok(
    !plano.ids.includes("jan"),
    "janeiro esta paga ANTECIPADAMENTE: a barreira por data a deixaria passar"
  );
  assert.ok(plano.preservadas.includes("jan"));

  // E o outro lado do mesmo mutante: OUTUBRO venceu e NAO foi paga. Uma
  // barreira de data a excluiria, e ela e justamente a conta que a pessoa
  // escolheu "todas" para corrigir ("a luz veio 340, nao 300").
  assert.ok(
    plano.ids.includes("out"),
    "outubro venceu e esta em aberto: tem de ser alterada"
  );
});

test("'todas' deixa de fora o que foi pulado ou cancelado", () => {
  const plano = planejarEdicao("todas", DEZEMBRO, SERIE);
  assert.ok(!plano.ids.includes("nov"), "novembro foi pulado de proposito");
  assert.ok(plano.preservadas.includes("nov"));
});

test("'todas' conta quantas ficaram de fora, e o numero fecha com a serie", () => {
  const plano = planejarEdicao("todas", DEZEMBRO, SERIE);

  // set (paga), nov (pulada), jan (paga antecipada) = 3.
  assert.equal(plano.preservadas.length, 3);
  // out, dez (ancora), fev = 3.
  assert.equal(plano.ids.length, 3);

  // Nenhuma linha da serie se perdeu entre as duas listas. Um "todas" que
  // esquece uma ocorrencia -- sem alterar e sem contar como preservada -- e o
  // modo de falha que nao aparece em nenhuma das duas respostas da rota.
  assert.equal(plano.ids.length + plano.preservadas.length, SERIE.length);
});

test("'todas' tambem atualiza a REGRA", () => {
  // Sem isto, a proxima geracao traz o valor velho de volta no primeiro mes que
  // a agenda ainda nao tinha criado -- e ninguem liga aquele reaparecimento a
  // esta edicao.
  assert.equal(planejarEdicao("todas", DEZEMBRO, SERIE).atualizarRegra, true);
});

test("conta avulsa: 'todas' nao inventa serie", () => {
  const avulsa = { id: "luz", due_date: "2026-12-10", status: "pending", recurring_rule_id: null };
  const plano = planejarEdicao("todas", avulsa, SERIE);
  assert.deepEqual(plano.ids, ["luz"]);
  assert.equal(plano.atualizarRegra, false);
  assert.deepEqual(plano.preservadas, []);
});

test("'todas' recusa due_date, igual a 'esta_e_proximas'", () => {
  // A versao antiga liberava `todas` sem conferir (`alcance !== "esta_e_proximas"`).
  // Mudar o vencimento de 'todas' poria a serie inteira vencendo no mesmo dia e
  // colidiria no indice unico (rule_id, due_date) da 005 -- depois de o UPDATE
  // ja ter passado em algumas linhas. Meia serie alterada, erro cru na tela.
  const recusa = conferirPatchNoAlcance("todas", ["amount", "due_date"]);
  assert.equal(recusa.ok, false);
  assert.match(recusa.mensagem, /gasto fixo/);

  assert.equal(conferirPatchNoAlcance("todas", ["amount", "description"]).ok, true);
  // E o alcance de uma linha so continua aceitando tudo.
  assert.equal(conferirPatchNoAlcance("apenas_esta", ["due_date"]).ok, true);
});

// ---------------------------------------------------------------------------
// 2. APAGAR, E O `end_date` QUE FECHA A TORNEIRA
// ---------------------------------------------------------------------------

test("apagar 'apenas_esta': pula a linha e NAO encerra a regra", () => {
  const plano = planejarExclusao("apenas_esta", DEZEMBRO, SERIE);
  assert.deepEqual(plano.idsParaPular, ["dez"]);
  assert.equal(plano.encerrarRegraEm, null, "o gasto fixo continua ativo");
  assert.equal(plano.desativarRegra, false);
  assert.equal(plano.apagarDeVez, false);
});

test("A ASSERCAO EXIGIDA: apagar 'esta_e_proximas' poe end_date na REGRA", () => {
  const plano = planejarExclusao("esta_e_proximas", DEZEMBRO, SERIE);

  // Marcar as linhas protege so o horizonte JA materializado: a linha `skipped`
  // segura o lugar dela no indice unico da 005. Mas `materializarAgenda` roda
  // sobre um horizonte rolante e a regra continua `is_active` -- os vencimentos
  // ALEM do horizonte de hoje nao tem linha nenhuma, e serao criados do zero.
  //
  // A conta apagada nao volta amanha: volta alguns MESES depois. Um teste que
  // confira so o `skipped` das linhas passa verde com esse defeito inteiro de
  // pe, e foi por isso que a issue cobrou esta assercao por escrito.
  assert.equal(
    plano.encerrarRegraEm,
    "2026-12-10",
    "a regra tem de receber end_date na data da ancora"
  );

  // E as linhas tambem, porque `end_date` e INCLUSIVO em occurrencesBetween
  // (`if (due > hardEnd) break`): a propria ancora continua sendo gerada, e e a
  // linha `skipped` que a segura.
  assert.deepEqual(plano.idsParaPular.slice().sort(), ["dez", "fev"]);
});

test("apagar 'esta_e_proximas' nao toca no que passou nem no que esta pago", () => {
  const plano = planejarExclusao("esta_e_proximas", DEZEMBRO, SERIE);

  assert.ok(!plano.idsParaPular.includes("set"), "setembro e anterior e paga");
  assert.ok(!plano.idsParaPular.includes("out"), "outubro e anterior a ancora");
  assert.ok(
    !plano.idsParaPular.includes("jan"),
    "janeiro e posterior mas esta PAGA: o dinheiro ja andou"
  );
  // nov ja estava pulada: remarcar inflaria a contagem que a tela mostra
  // ("pulei 4") com meses que ninguem tirou agora.
  assert.ok(!plano.idsParaPular.includes("nov"));
  assert.deepEqual(plano.preservadas.slice().sort(), ["jan", "nov", "out", "set"]);
});

test("apagar 'todas' DELEGA, e nao marca linha nenhuma", () => {
  const plano = planejarExclusao("todas", DEZEMBRO, SERIE);

  // "apagar todas as parcelas de um gasto fixo" e, palavra por palavra, o que
  // DELETE /api/recurring-rules/{id} ja faz (is_active=false + abertas em
  // 'cancelled'). O plano manda a rota CHAMAR aquele caminho; crescer um
  // segundo igual produz dois lugares que encerram uma regra, e eles divergem
  // no primeiro conserto que so um dos dois receber.
  assert.equal(plano.desativarRegra, true);
  assert.deepEqual(
    plano.idsParaPular,
    [],
    "quem cancela as ocorrencias e o caminho da regra, nao este plano"
  );
  assert.equal(plano.encerrarRegraEm, null);
});

test("apagar conta avulsa: DELETE de verdade, em qualquer alcance", () => {
  const avulsa = { id: "luz", due_date: "2026-12-10", status: "pending", recurring_rule_id: null };
  for (const alcance of ALCANCES) {
    const plano = planejarExclusao(alcance, avulsa, SERIE);
    assert.equal(plano.apagarDeVez, true, alcance);
    assert.equal(plano.desativarRegra, false, alcance);
    assert.deepEqual(plano.idsParaPular, [], alcance);
  }
});

// ---------------------------------------------------------------------------
// 3. A SERIE DE CARTAO: A BARREIRA E O NUMERO
// ---------------------------------------------------------------------------
// Notebook em 10x de R$ 300. As parcelas 1 e 2 cairam em faturas JA PAGAS.
// E a parcela 4 cai no MESMO mes de fatura que a 3 -- uma compra perto do
// fechamento faz isso, e e por isso que ordenar por data inverteria a serie.
const p = (n, invoice_month, amount = -300) => ({
  id: `p${n}`,
  installment_number: n,
  invoice_month,
  amount,
});

const PARCELAS = [
  p(1, "2026-08-01"),
  p(2, "2026-09-01"),
  p(3, "2026-10-01"),
  p(4, "2026-10-01"), // mesmo mes da 3
  p(5, "2026-11-01"),
  p(6, "2026-12-01"),
  p(7, "2027-01-01"),
  p(8, "2027-02-01"),
  p(9, "2027-03-01"),
  p(10, "2027-04-01"),
];
const FATURAS_PAGAS = ["2026-08-01", "2026-09-01"];

test("os tres alcances de parcela existem", () => {
  assert.equal(ehAlcanceDeParcelaValido("todas"), true);
  assert.equal(ehAlcanceDeParcelaValido("esta_e_proximas"), true);
  assert.equal(ehAlcanceDeParcelaValido("a_partir_desta"), false);
});

test("'apenas_esta' na parcela 3 de 10 nao encosta nas outras nove", () => {
  // A prova exigida pela issue. Apagar/alterar a parcela 3 pela rota que nao
  // sabe o que e uma serie apagava UMA linha e deixava nove -- e a fatura de
  // cada mes restante continuava fechando num valor plausivel e errado.
  const plano = planejarAlteracaoDeParcelas(
    "apenas_esta",
    p(3, "2026-10-01"),
    PARCELAS,
    FATURAS_PAGAS
  );
  assert.deepEqual(plano.ids, ["p3"]);
  assert.deepEqual(plano.preservadas, []);
});

test("A BARREIRA E O NUMERO, NAO A DATA: a 4 cai no mesmo mes da 3", () => {
  const plano = planejarAlteracaoDeParcelas(
    "esta_e_proximas",
    p(3, "2026-10-01"),
    PARCELAS,
    FATURAS_PAGAS
  );

  // A parcela 4 tem o MESMO `invoice_month` da ancora. Uma barreira por data
  // com `>` a deixaria de fora; com `>=` ela entraria junto com qualquer outra
  // parcela daquele mes, inclusive uma ANTERIOR. O numero nao tem esse problema.
  assert.ok(plano.ids.includes("p4"), "a parcela 4 vem DEPOIS da 3");
  assert.deepEqual(plano.ids, ["p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10"]);
  assert.deepEqual(plano.preservadas.slice().sort(), ["p1", "p2"]);
});

test("ancorado na 4: a 3 fica de fora, apesar do MESMO mes de fatura", () => {
  // O outro lado do mutante de data, e o que a barreira `<` por
  // `invoice_month` nao pega. Ancorando na parcela 4: a 3 esta no MESMO mes de
  // fatura, entao `irma.invoice_month < ancora.invoice_month` e FALSO e ela
  // seria incluida -- "desta em diante" passaria a alterar uma parcela
  // ANTERIOR. Pelo numero, 3 < 4 e ela fica de fora, que e a unica resposta
  // certa.
  const plano = planejarAlteracaoDeParcelas(
    "esta_e_proximas",
    p(4, "2026-10-01"),
    PARCELAS,
    []
  );
  assert.ok(!plano.ids.includes("p3"), "a parcela 3 vem ANTES da 4");
  assert.ok(plano.preservadas.includes("p3"));
  assert.deepEqual(plano.ids, ["p4", "p5", "p6", "p7", "p8", "p9", "p10"]);
});

test("O MUTANTE CRITICO DA SERIE: fatura paga protege, data nao", () => {
  const plano = planejarAlteracaoDeParcelas(
    "todas",
    p(5, "2026-11-01"),
    PARCELAS,
    FATURAS_PAGAS
  );

  // 'todas' nao tem barreira de ordem: ele alcanca as parcelas 3 e 4, que vem
  // ANTES da ancora. E esse o alcance.
  assert.ok(plano.ids.includes("p3"));
  assert.ok(plano.ids.includes("p4"));

  // E as 1 e 2 ficam de fora -- nao por serem anteriores, mas porque a fatura
  // delas foi PAGA. Com uma barreira por data (`transaction_date < hoje`) a
  // parcela 3, numa fatura ABERTA que ainda da para corrigir, tambem seria
  // preservada -- e "todas" deixaria de alterar o que a pessoa pediu.
  assert.deepEqual(plano.preservadas.slice().sort(), ["p1", "p2"]);
  assert.deepEqual(plano.preservadasPorFaturaPaga.slice().sort(), ["p1", "p2"]);
});

test("as preservadas por fatura paga sao contadas em separado", () => {
  // Duas frases diferentes na tela: "as 2 anteriores nao mudam" e consequencia
  // do que a pessoa escolheu; "1 esta em fatura paga" e uma recusa que ela nao
  // pediu, e que muda o total da compra. Um numero so esconde a segunda.
  const plano = planejarAlteracaoDeParcelas(
    "esta_e_proximas",
    p(3, "2026-10-01"),
    PARCELAS,
    ["2026-08-01", "2026-09-01", "2026-12-01"]
  );
  assert.deepEqual(plano.preservadas.slice().sort(), ["p1", "p2", "p6"]);
  assert.deepEqual(
    plano.preservadasPorFaturaPaga,
    ["p6"],
    "p1 e p2 ficaram por numero; so p6 ficou por fatura paga"
  );
});

test("sem nenhuma fatura paga, 'todas' alcanca a serie inteira", () => {
  // Tratar o desconhecido como protegido faria 'todas' nao alterar nada e
  // responder sucesso.
  const plano = planejarAlteracaoDeParcelas("todas", p(5, "2026-11-01"), PARCELAS, []);
  assert.equal(plano.ids.length, 10);
  assert.deepEqual(plano.preservadas, []);
});

test("invoice_month nulo nao conta como fatura paga", () => {
  const comNulo = [p(1, null), p(2, "2026-09-01"), p(3, "2026-10-01")];
  const plano = planejarAlteracaoDeParcelas("todas", p(3, "2026-10-01"), comNulo, ["2026-09-01"]);
  assert.ok(plano.ids.includes("p1"), "nulo e desconhecido, nao protegido");
  assert.deepEqual(plano.preservadas, ["p2"]);
});

// ---------------------------------------------------------------------------
// 4. O TOTAL RECALCULADO
// ---------------------------------------------------------------------------

test("totalDaCompra soma o MODULO: a despesa esta gravada negativa", () => {
  // SUM(amount) cru devolveria -3000, e a tela imprimiria "-R$ 3.000,00 de
  // total da compra".
  assert.equal(totalDaCompra(PARCELAS), 3000);
});

test("base 'parcela' em 'todas': o digitado e o valor de cada uma", () => {
  const alcancadas = PARCELAS.filter((x) => x.installment_number >= 3);
  const preservadas = PARCELAS.filter((x) => x.installment_number < 3);

  const novos = novosValoresDasParcelas({
    base: "parcela",
    valorDigitado: 250,
    alcancadas,
    preservadas,
  });

  assert.equal(novos.valorDaParcela, 250);
  assert.equal(novos.valores.length, 8);
  // Negativo: despesa. O sinal sai da regra para que nao haja um segundo lugar
  // onde esquecer o menos transforma a compra em receita.
  assert.ok(
    novos.valores.every((v) => v.amount === -250),
    "toda parcela alcancada vale -250"
  );

  // A CONSEQUENCIA DECLARADA: as 2 anteriores ficaram com 300, entao o total da
  // compra NAO e 250 x 10 = 2500. Uma tela que mostre `parcela x M` passa a
  // afirmar um total que o banco nao tem.
  assert.equal(novos.totalRecalculado, 2600);
  assert.notEqual(novos.totalRecalculado, 2500);
});

test("base 'total': o digitado e o total, e as preservadas saem dele", () => {
  const alcancadas = PARCELAS.filter((x) => x.installment_number >= 3);
  const preservadas = PARCELAS.filter((x) => x.installment_number < 3);

  const novos = novosValoresDasParcelas({
    base: "total",
    valorDigitado: 2600,
    alcancadas,
    preservadas,
  });

  // 2600 - 600 (as duas preservadas) = 2000, em 8 parcelas = 250.
  assert.equal(novos.valorDaParcela, 250);
  assert.equal(novos.totalRecalculado, 2600, "o total digitado e respeitado");
});

test("a sobra dos centavos vai na ULTIMA alcancada, e o total fecha", () => {
  const serie = [p(1, "2026-10-01", -100), p(2, "2026-11-01", -100), p(3, "2026-12-01", -100)];

  const novos = novosValoresDasParcelas({
    base: "total",
    valorDigitado: 100,
    alcancadas: serie,
    preservadas: [],
  });

  // 100 / 3 = 33,33 + 33,33 + 33,34. Tres de 33,33 somariam 99,99 e o total da
  // compra passaria a mentir em um centavo -- e e sempre o mesmo centavo, todo
  // mes, em toda compra dividida que nao fecha.
  assert.deepEqual(
    novos.valores.map((v) => v.amount),
    [-33.33, -33.33, -33.34]
  );
  const soma = novos.valores.reduce((s, v) => s + Math.round(Math.abs(v.amount) * 100), 0);
  assert.equal(soma, 10000);
  assert.equal(novos.totalRecalculado, 100);
});

test("base 'total' menor que as preservadas e RECUSADO, nao gravado", () => {
  const alcancadas = PARCELAS.filter((x) => x.installment_number >= 3);
  const preservadas = PARCELAS.filter((x) => x.installment_number < 3);

  // As duas preservadas ja somam R$ 600. Um total de R$ 500 nao sobra nada para
  // as outras oito: a divisao daria parcelas NEGATIVAS, ou seja de sinal
  // invertido (credito no cartao). O CHECK do banco nao barra isso -- ele exige
  // `amount <> 0`, e -(-62.5) e um numero perfeitamente valido. A recusa tem de
  // vir antes do banco porque o banco aceitaria.
  assert.equal(
    novosValoresDasParcelas({ base: "total", valorDigitado: 500, alcancadas, preservadas }),
    null
  );

  // E o caso de borda exato: total IGUAL ao que as preservadas somam sobra zero.
  assert.equal(
    novosValoresDasParcelas({ base: "total", valorDigitado: 600, alcancadas, preservadas }),
    null
  );
});

test("parcela que sairia ZERADA e recusada antes do banco", () => {
  const oito = PARCELAS.slice(0, 8);
  // R$ 0,01 repartido em 8: sete parcelas de R$ 0,00. `financial_transactions`
  // tem CHECK `amount <> 0`, entao o UPDATE morreria NO MEIO da serie -- com
  // algumas parcelas ja alteradas e nenhuma transacao envolvendo tudo.
  assert.equal(
    novosValoresDasParcelas({
      base: "total",
      valorDigitado: 0.01,
      alcancadas: oito,
      preservadas: [],
    }),
    null
  );
});

test("a ultima parcela nunca sai com o sinal INVERTIDO", () => {
  const oito = PARCELAS.slice(0, 8);
  // R$ 0,05 em 8: sete de 1 centavo e uma ultima de -2 centavos. Com o sinal da
  // despesa aplicado ela viraria um numero POSITIVO no meio de oito negativos:
  // um credito no cartao. O banco aceita (`amount <> 0` passa) e a fatura
  // daquele mes abateria em vez de cobrar.
  assert.equal(
    novosValoresDasParcelas({
      base: "total",
      valorDigitado: 0.05,
      alcancadas: oito,
      preservadas: [],
    }),
    null
  );
});

test("nenhuma alcancada, ou valor invalido, devolve null", () => {
  assert.equal(
    novosValoresDasParcelas({ base: "parcela", valorDigitado: 250, alcancadas: [], preservadas: [] }),
    null,
    "zero linhas alteradas nao e um sucesso"
  );
  assert.equal(
    novosValoresDasParcelas({ base: "parcela", valorDigitado: 0, alcancadas: PARCELAS, preservadas: [] }),
    null
  );
  assert.equal(
    novosValoresDasParcelas({ base: "parcela", valorDigitado: -5, alcancadas: PARCELAS, preservadas: [] }),
    null
  );
});

test("a tela declara o total recalculado, com os dois numeros", () => {
  const plano = planejarAlteracaoDeParcelas(
    "esta_e_proximas",
    p(3, "2026-10-01"),
    PARCELAS,
    []
  );
  const frase = consequenciaDoAlcance("esta_e_proximas", plano, {
    antes: 3000,
    depois: 2600,
  });

  // Os DOIS numeros, porque "o total passa a ser 2.600" sozinho nao diz se isso
  // era o esperado. E a negacao explicita de `parcela x M`: a frase tem de
  // dizer que as anteriores ficaram com o valor antigo.
  assert.match(frase, /R\$ 2\.600,00/);
  assert.match(frase, /R\$ 3\.000,00/);
  assert.match(frase, /2 anteriores ficam com o valor antigo/);
});

test("a frase declara, em separado, a parcela que ficou por fatura paga", () => {
  const plano = planejarAlteracaoDeParcelas("todas", p(5, "2026-11-01"), PARCELAS, FATURAS_PAGAS);
  const frase = consequenciaDoAlcance("todas", plano, { antes: 3000, depois: 2600 });

  // Sem esta frase, a pessoa pede "todas", ve o total mudar para um numero que
  // ela nao calculou, e nao tem como descobrir por que.
  assert.match(frase, /2 parcelas estão em fatura já paga/);
  assert.match(frase, /não foram alteradas/);
});

test("'apenas_esta' diz que as outras ficam, e nao fala de total", () => {
  const plano = planejarAlteracaoDeParcelas("apenas_esta", p(3, "2026-10-01"), PARCELAS, []);
  const frase = consequenciaDoAlcance("apenas_esta", plano, { antes: 3000, depois: 2950 });
  assert.match(frase, /Só esta parcela muda/);
});

// ---------------------------------------------------------------------------
// 5. O QUE A TELA DIZ
// ---------------------------------------------------------------------------
// As palavras moram num modulo puro porque o `SelectValue` do Radix nao
// renderiza no servidor: um teste de render veria o gatilho VAZIO e passaria a
// afirmar qualquer coisa sobre a opcao selecionada. Aqui o texto e cobravel.

test("as tres opcoes aparecem na tela, nas duas series e nas duas acoes", () => {
  for (const tipo of ["conta_fixa", "parcela"]) {
    for (const acao of ["alterar", "apagar"]) {
      const opcoes = opcoesDeAlcance({ tipo, acao, ancora: "10/12", totalDeParcelas: 10 });
      assert.deepEqual(
        opcoes.map((o) => o.valor),
        ["apenas_esta", "esta_e_proximas", "todas"],
        `${tipo}/${acao}`
      );
      // Toda opcao declara a consequencia DELA. Uma opcao sem frase deixa a
      // pessoa escolher no escuro justamente no alcance mais destrutivo.
      for (const o of opcoes) {
        assert.ok(o.rotulo.length > 0, `${tipo}/${acao}: rotulo vazio`);
        assert.ok(o.consequencia.length > 0, `${tipo}/${acao}/${o.valor}: sem consequencia`);
      }
    }
  }
});

test("APAGAR 'esta e as proximas' declara que o gasto fixo e ENCERRADO", () => {
  // A consequencia que a pessoa nao tem como adivinhar, e a que a issue chama
  // de pior resultado possivel se ficar calada: sem encerrar a regra a conta
  // volta meses depois. A tela tem de dizer que ela vai ser encerrada.
  const opcoes = opcoesDeAlcance({ tipo: "conta_fixa", acao: "apagar", ancora: "10/12" });
  const frase = consequenciaNaTela("esta_e_proximas", opcoes);

  assert.match(frase, /encerrado/);
  assert.match(frase, /voltaria a gerar/);
});

test("ALTERAR 'todas' declara que alcanca meses ANTERIORES", () => {
  // `todas` e o unico alcance que olha para tras. Uma frase que nao diga isso
  // faz a pessoa escolher "todas" achando que e "desta em diante".
  const opcoes = opcoesDeAlcance({ tipo: "conta_fixa", acao: "alterar", ancora: "10/12" });
  const frase = consequenciaNaTela("todas", opcoes);

  assert.match(frase, /anteriores/);
  assert.match(frase, /já foi pago não é alterado/);
});

test("a parcela declara que o total DEIXA de ser parcela x M", () => {
  // A consequencia exigida pela issue: em "a partir daquela", as anteriores
  // ficam com o valor velho. Sem esta frase o resumo afirma um total que o
  // banco nao tem.
  const opcoes = opcoesDeAlcance({
    tipo: "parcela",
    acao: "alterar",
    ancora: "parcela 3",
    totalDeParcelas: 10,
  });
  const frase = consequenciaNaTela("esta_e_proximas", opcoes);

  assert.match(frase, /valor antigo/);
  assert.match(frase, /deixa de ser/);
});

test("o rotulo de 'todas' diz QUANTAS parcelas, quando se sabe", () => {
  const com = opcoesDeAlcance({
    tipo: "parcela",
    acao: "apagar",
    ancora: "parcela 3",
    totalDeParcelas: 10,
  });
  assert.equal(com[2].rotulo, "Todas as 10 parcelas");

  // Sem M nao se inventa numero: "Todas as undefined parcelas" na tela e o
  // rotulo quebrado que faz a pessoa desconfiar do que esta ao lado dele.
  const sem = opcoesDeAlcance({ tipo: "parcela", acao: "apagar", ancora: "parcela 3" });
  assert.equal(sem[2].rotulo, "Todas as parcelas");
});

test("o rotulo de 'apenas esta' identifica a linha clicada", () => {
  // Sem a ancora no rotulo, "Apenas esta" num dialogo aberto por um menu nao
  // identifica nada -- e o dialogo e o unico lugar que confirma QUAL linha.
  const o = opcoesDeAlcance({ tipo: "conta_fixa", acao: "apagar", ancora: "10/12" });
  assert.equal(o[0].rotulo, "Apenas esta (10/12)");
});

test("alcance desconhecido devolve string vazia, nao undefined", () => {
  // Um `undefined` renderizado no JSX desaparece em silencio, e a tela ficaria
  // sem a declaracao exatamente no caso em que algo esta errado.
  const o = opcoesDeAlcance({ tipo: "parcela", acao: "alterar", ancora: "parcela 3" });
  assert.equal(consequenciaNaTela("qualquer_coisa", o), "");
});

test("a pergunta parcela/total so aparece onde ha ambiguidade", () => {
  const base = { tipo: "parcela", mudaValor: true };

  // Em "apenas esta" nao ha ambiguidade: uma parcela so, o numero e ela. Fazer
  // a pergunta ali ensina a pessoa a ignora-la.
  assert.equal(precisaPerguntarBase({ ...base, alcance: "apenas_esta" }), false);
  assert.equal(precisaPerguntarBase({ ...base, alcance: "esta_e_proximas" }), true);
  assert.equal(precisaPerguntarBase({ ...base, alcance: "todas" }), true);

  // Nem na conta fixa: ali nao existe "total da compra" -- a serie nao tem fim.
  assert.equal(
    precisaPerguntarBase({ tipo: "conta_fixa", mudaValor: true, alcance: "todas" }),
    false
  );
  // Nem quando o valor nao muda.
  assert.equal(
    precisaPerguntarBase({ tipo: "parcela", mudaValor: false, alcance: "todas" }),
    false
  );
});

test("a contagem do que ficou de fora vira frase -- e cala quando e zero", () => {
  // Um toast que sempre termina com "0 ficaram de fora" treina a pessoa a nao
  // ler o fim da frase, e e justamente o fim da frase que carrega a garantia.
  assert.equal(frasePreservadas({ preservadas: 0 }), null);
  assert.equal(frasePreservadas({ preservadas: 0, porFaturaPaga: 0 }), null);

  assert.equal(frasePreservadas({ preservadas: 3 }), "3 ficaram como estavam.");
  assert.equal(
    frasePreservadas({ preservadas: 3, porFaturaPaga: 1 }),
    "3 ficaram como estavam — 1 em fatura já paga."
  );
});

// ---------------------------------------------------------------------------
// 6. A ROTA LE O PLANO
// ---------------------------------------------------------------------------
// As regras puras acima provam que o PLANO pede o `end_date` e que o alcance
// "todas" DELEGA. Nenhuma delas prova que a rota faz o que o plano pede -- um
// `if (false)` em volta do bloco que grava o `end_date` passa pelos 23 mutantes
// sem arranhao, e o sintoma seria a conta apagada voltando meses depois.
//
// Entao estes casos leem o CODIGO da rota. E um instrumento pobre comparado a
// um teste de integracao e esta sendo usado de proposito: o que ele pega e
// OMISSAO (o passo que desaparece num refactor), e omissao e justamente o que
// nenhuma assercao sobre a regra pura alcanca. O mesmo padrao ja e usado em
// scripts/test-fatura-prevista.mjs.

import { readFileSync } from "node:fs";

const ROTA_AGENDA = readFileSync(
  "app/api/scheduled-transactions/[id]/route.ts",
  "utf8"
);
const ROTA_SERIE = readFileSync(
  "app/api/financial-installments/serie/[id]/route.ts",
  "utf8"
);

test("o DELETE da agenda grava o end_date que o plano pediu", () => {
  // A SEGUNDA PROVA EXIGIDA PELA ISSUE, do lado da rota.
  assert.match(
    ROTA_AGENDA,
    /plano\.encerrarRegraEm/,
    "a rota nao le o end_date do plano"
  );
  assert.match(
    ROTA_AGENDA,
    /\.from\("recurring_rules"\)[\s\S]{0,200}end_date/,
    "a rota nao escreve end_date em recurring_rules"
  );
});

test("o alcance 'todas' da agenda CHAMA encerrarRegra, nao uma copia dela", () => {
  // Dois lugares que encerram uma regra divergem no primeiro conserto que so um
  // dos dois receber. A prova de que ha um lugar so: a rota importa e chama a
  // funcao compartilhada, e nao escreve `is_active: false` por conta propria.
  assert.match(ROTA_AGENDA, /encerrarRegra\(/, "a rota nao chama encerrarRegra");
  assert.ok(
    !/is_active:\s*false/.test(ROTA_AGENDA),
    "a rota cresceu a propria copia do encerramento da regra"
  );

  const SERVICO = readFileSync("lib/services/scheduled.ts", "utf8");
  assert.match(SERVICO, /export async function encerrarRegra/);
  assert.match(SERVICO, /is_active:\s*false/, "encerrarRegra nao desativa a regra");
  assert.match(SERVICO, /status:\s*"cancelled"/, "encerrarRegra nao cancela as abertas");

  // E o OUTRO caminho -- o DELETE do gasto fixo -- passou a chamar a mesma
  // funcao. Sem esta assercao, "um lugar so" valeria para o caminho novo e a
  // copia velha continuaria de pe no antigo.
  const ROTA_REGRA = readFileSync("app/api/recurring-rules/[id]/route.ts", "utf8");
  assert.match(ROTA_REGRA, /encerrarRegra\(/, "o DELETE do gasto fixo nao usa a funcao");
});

test("as duas rotas aceitam o alcance NO CORPO, nao na query string", () => {
  // Um laco no cliente aplicando id por id fica aplicado pela metade quando a
  // conexao cai, e o estado pela metade de uma serie nao tem como ser
  // descoberto depois. A decisao e de servidor, e chega no corpo.
  for (const [nome, fonte] of [
    ["agenda", ROTA_AGENDA],
    ["serie", ROTA_SERIE],
  ]) {
    assert.match(fonte, /request\.json\(\)/, `${nome}: nao le o corpo`);
    assert.ok(
      !/searchParams\.get\("alcance"\)/.test(fonte),
      `${nome}: o alcance esta vindo pela query string`
    );
  }
});

test("a rota da serie devolve a contagem do que ficou de fora", () => {
  // "A contagem de quantas ficaram de fora tem de aparecer na resposta da rota
  // E na tela." Os dois numeros, separados.
  assert.match(ROTA_SERIE, /preservadas:/);
  assert.match(ROTA_SERIE, /preservadas_por_fatura_paga:/);
  assert.match(ROTA_SERIE, /total_da_compra:/);
});

test("o DELETE da serie reamarra as parcelas que sobraram", () => {
  // `installment_parent_id` nao tem foreign key (conferido): apagar a primeira
  // parcela deixa as outras apontando para um id que nao existe, sem erro. Sem
  // este passo a serie se desfaz e a proxima edicao das restantes cai no 400
  // "nao faz parte de uma compra parcelada", sobre linhas que a tela mostra
  // como "parcela 4 de 10".
  assert.match(
    ROTA_SERIE,
    /installment_parent_id:\s*novaPrimeira/,
    "o DELETE nao reamarra a serie"
  );
});

// ---------------------------------------------------------------------------
// 7. MOVER UMA PARCELA MOVE A SERIE (HMO-357)
// ---------------------------------------------------------------------------
// "Quando movo uma parcela, as demais devem mover junto."
//
// A serie de um parcelamento nao e um conjunto de dez linhas independentes: ela
// e uma CADENCIA de um mes. Mover a parcela 3 sem mover as seguintes poe duas
// parcelas na mesma fatura e deixa um mes vazio no fim -- e as duas faturas
// fecham num valor plausivel, sem erro em lugar nenhum.
//
// A FIXTURE ACIMA E A QUE INTERESSA, e por um detalhe: a parcela 4 cai no MESMO
// mes de fatura que a 3 (uma compra perto do fechamento faz isso). E ele que
// separa a implementacao certa -- cada parcela anda a partir da fatura DELA --
// da que encadeia (`somaMeses(destino_da_vizinha, 1)`), que normalizaria o
// espacamento e moveria a 4 um mes a mais do que a pessoa pediu.

const idsMovidos = (plano) => plano.movimentos.map((m) => `${m.id}:${m.invoiceMonth}`);

test("mover a parcela 3 um mes para frente move da 3 em diante", () => {
  const ancora = PARCELAS[2]; // p3, fatura de outubro/2026
  const plano = planejarAlteracaoDeParcelas(
    "esta_e_proximas",
    ancora,
    PARCELAS,
    FATURAS_PAGAS
  );
  const alcancadas = PARCELAS.filter((x) => plano.ids.includes(x.id));

  const movimento = novasFaturasDasParcelas({
    ancora,
    destinoDaAncora: "2026-11-01",
    alcancadas,
    mesesDeFaturaPaga: FATURAS_PAGAS,
  });

  assert.equal(movimento.ok, true);
  assert.equal(movimento.delta, 1);

  // A 4 vai para NOVEMBRO, junto da 3 -- ela ja estava na mesma fatura que a 3,
  // e o movimento preserva o espacamento que existe em vez de inventar um.
  assert.deepEqual(idsMovidos(movimento), [
    "p3:2026-11-01",
    "p4:2026-11-01",
    "p5:2026-12-01",
    "p6:2027-01-01",
    "p7:2027-02-01",
    "p8:2027-03-01",
    "p9:2027-04-01",
    "p10:2027-05-01",
  ]);

  // E as duas primeiras -- as de fatura ja paga -- nao entram no movimento.
  assert.ok(!movimento.movimentos.some((m) => m.id === "p1" || m.id === "p2"));
});

test("o deslocamento e o MESMO para todas: a cadencia de um mes sobrevive", () => {
  // A prova independente da lista literal acima: a diferenca entre a fatura de
  // destino de cada parcela e a de origem dela e a mesma para todas. Uma
  // implementacao encadeada quebra esta igualdade exatamente no par 3/4.
  const ancora = PARCELAS[2];
  const plano = planejarAlteracaoDeParcelas("todas", ancora, PARCELAS, []);
  const alcancadas = PARCELAS.filter((x) => plano.ids.includes(x.id));

  const movimento = novasFaturasDasParcelas({
    ancora,
    destinoDaAncora: "2027-01-01", // tres meses para frente
    alcancadas,
    mesesDeFaturaPaga: [],
  });

  assert.equal(movimento.ok, true);
  assert.equal(movimento.delta, 3);
  assert.equal(movimento.movimentos.length, 10);

  for (const m of movimento.movimentos) {
    const origem = PARCELAS.find((x) => x.id === m.id).invoice_month;
    assert.equal(
      mesesEntreFaturas(origem, m.invoiceMonth),
      3,
      `${m.id} andou um numero de meses diferente do pedido`
    );
  }
});

test("mover PARA TRAS tambem arrasta a serie", () => {
  const ancora = PARCELAS[4]; // p5, novembro/2026
  const plano = planejarAlteracaoDeParcelas("esta_e_proximas", ancora, PARCELAS, []);
  const alcancadas = PARCELAS.filter((x) => plano.ids.includes(x.id));

  const movimento = novasFaturasDasParcelas({
    ancora,
    destinoDaAncora: "2026-10-01",
    alcancadas,
    mesesDeFaturaPaga: [],
  });

  assert.equal(movimento.ok, true);
  assert.equal(movimento.delta, -1);
  assert.deepEqual(idsMovidos(movimento), [
    "p5:2026-10-01",
    "p6:2026-11-01",
    "p7:2026-12-01",
    "p8:2027-01-01",
    "p9:2027-02-01",
    "p10:2027-03-01",
  ]);
});

test("'apenas_esta' move UMA parcela, e e uma escolha legitima", () => {
  const ancora = PARCELAS[2];
  const plano = planejarAlteracaoDeParcelas("apenas_esta", ancora, PARCELAS, []);
  const alcancadas = PARCELAS.filter((x) => plano.ids.includes(x.id));

  const movimento = novasFaturasDasParcelas({
    ancora,
    destinoDaAncora: "2026-12-01",
    alcancadas,
    mesesDeFaturaPaga: [],
  });

  assert.equal(movimento.ok, true);
  assert.deepEqual(idsMovidos(movimento), ["p3:2026-12-01"]);
});

test("O MUTANTE CRITICO DO MOVIMENTO: cair numa fatura PAGA e recusa, nao aviso", () => {
  // `planejarAlteracaoDeParcelas` protege a parcela que ESTA em fatura paga.
  // Este e o outro lado: a parcela que CAIRIA numa. Deixa-la entrar mudaria o
  // total de uma fatura que a pessoa ja conferiu e pagou -- e a conta do cartao
  // nao muda junto. Nenhum alcance autoriza isso.
  const ancora = PARCELAS[2]; // p3, outubro
  const plano = planejarAlteracaoDeParcelas("esta_e_proximas", ancora, PARCELAS, FATURAS_PAGAS);
  const alcancadas = PARCELAS.filter((x) => plano.ids.includes(x.id));

  const movimento = novasFaturasDasParcelas({
    ancora,
    destinoDaAncora: "2026-09-01", // setembro esta PAGO
    alcancadas,
    mesesDeFaturaPaga: FATURAS_PAGAS,
  });

  assert.equal(movimento.ok, false);
  assert.equal(movimento.motivo, "fatura_paga_no_destino");
  // A 3 e a 4 cairiam em setembro (as duas estao em outubro hoje).
  assert.deepEqual(movimento.parcelas, ["p3", "p4"]);
  // E NADA e movido: um movimento aplicado pela metade e o estado que esta
  // issue existe para eliminar.
  assert.equal(movimento.movimentos, undefined);
});

test("destino igual a origem nao e erro nem movimento", () => {
  // E o que acontece quando a pessoa muda o DIA dentro da mesma fatura (de 05
  // para 10 de outubro). Recusar bloquearia uma edicao legitima; mover as irmas
  // zero meses e dizer que a serie andou seria pior.
  const ancora = PARCELAS[2];
  const movimento = novasFaturasDasParcelas({
    ancora,
    destinoDaAncora: "2026-10-01",
    alcancadas: [ancora],
    mesesDeFaturaPaga: [],
  });

  assert.equal(movimento.ok, false);
  assert.equal(movimento.motivo, "sem_movimento");
});

test("sem fatura na ancora ou numa alcancada, o movimento inteiro e recusado", () => {
  const semFatura = p(3, null);
  assert.deepEqual(
    novasFaturasDasParcelas({
      ancora: semFatura,
      destinoDaAncora: "2026-11-01",
      alcancadas: [semFatura],
    }),
    { ok: false, motivo: "ancora_sem_fatura", parcelas: ["p3"] }
  );

  // Uma IRMA sem fatura tambem para o pedido todo: mover as oito que dao e
  // deixar uma atras desmonta a cadencia sem nada na tela dizendo qual linha
  // ficou.
  const movimento = novasFaturasDasParcelas({
    ancora: PARCELAS[2],
    destinoDaAncora: "2026-11-01",
    alcancadas: [PARCELAS[2], p(7, null), PARCELAS[7]],
  });
  assert.equal(movimento.ok, false);
  assert.equal(movimento.motivo, "parcela_sem_fatura");
  assert.deepEqual(movimento.parcelas, ["p7"]);
});

test("o destino tem de ser um MES de fatura, com o dia 1", () => {
  // 'AAAA-MM-15' chegando aqui e quem confundiu mes de fatura com data de
  // compra. Normalizar em silencio gravaria a serie numa fatura que ninguem
  // escolheu -- e a 041 tem CHECK de date_trunc, entao o banco recusaria depois,
  // com uma mensagem que nao nomeia o campo.
  for (const destino of ["2026-11-15", "2026-11", "novembro", "", "2026-13-01"]) {
    const movimento = novasFaturasDasParcelas({
      ancora: PARCELAS[2],
      destinoDaAncora: destino,
      alcancadas: [PARCELAS[2]],
    });
    assert.equal(movimento.ok, false, `${destino} passou`);
    assert.equal(movimento.motivo, "destino_ilegivel", `${destino}: motivo errado`);
  }
});

test("mesesEntreFaturas conta meses, atravessa o ano e recusa o ilegivel", () => {
  assert.equal(mesesEntreFaturas("2026-10-01", "2026-11-01"), 1);
  assert.equal(mesesEntreFaturas("2026-10-01", "2026-10-01"), 0);
  assert.equal(mesesEntreFaturas("2026-11-01", "2027-01-01"), 2);
  assert.equal(mesesEntreFaturas("2026-12-01", "2027-12-01"), 12);
  assert.equal(mesesEntreFaturas("2027-01-01", "2026-11-01"), -2);
  // `null` e nao 0: zero e indistinguivel de "nao ha movimento", e um destino
  // ilegivel passaria como pedido inofensivo.
  assert.equal(mesesEntreFaturas("2026-10-01", "lixo"), null);
  assert.equal(mesesEntreFaturas("", "2026-10-01"), null);
});

test("'AAAA-MM' da tela vira 'AAAA-MM-01' da coluna", () => {
  assert.equal(mesDaFaturaPedida("2026-11"), "2026-11-01");
  assert.equal(mesDaFaturaPedida(" 2026-01 "), "2026-01-01");
  // O dia 1 e exigencia da 041 (CHECK date_trunc), entao uma data completa NAO
  // e aceita aqui: ela e outra pergunta (em que fatura esta data cai?), e quem
  // responde essa e a card_invoice_month no banco.
  assert.equal(mesDaFaturaPedida("2026-11-01"), null);
  assert.equal(mesDaFaturaPedida("2026-13"), null);
  assert.equal(mesDaFaturaPedida(null), null);
  assert.equal(mesDaFaturaPedida(undefined), null);
});

test("a tela declara QUANTAS parcelas andam e para que lado", () => {
  const ancora = PARCELAS[2];
  const plano = planejarAlteracaoDeParcelas(
    "esta_e_proximas",
    ancora,
    PARCELAS,
    FATURAS_PAGAS
  );

  const frase = consequenciaDoMovimento(plano, 1);
  assert.match(frase, /8 parcelas andam 1 mês para frente/);
  // "as demais movem junto" tem duas leituras na cabeca de quem clica -- "as
  // nove restantes" e "as oito seguintes" --, e so o numero distingue as duas.
  assert.match(frase, /a partir da fatura dela/);

  assert.match(consequenciaDoMovimento(plano, -2), /2 meses para trás/);

  const soEsta = planejarAlteracaoDeParcelas("apenas_esta", ancora, PARCELAS, []);
  assert.match(
    consequenciaDoMovimento(soEsta, 1),
    /Só esta parcela anda 1 mês para frente/
  );
});

test("a frase conta, em separado, a parcela que nao foi movida por fatura paga", () => {
  const ancora = PARCELAS[3]; // p4
  const plano = planejarAlteracaoDeParcelas("todas", ancora, PARCELAS, FATURAS_PAGAS);
  const frase = consequenciaDoMovimento(plano, 1);
  assert.match(frase, /2 parcelas estão em fatura já paga e não foram movidas/);
});

// ---------------------------------------------------------------------------
// 7b. A ROTA MOVE DE VERDADE
// ---------------------------------------------------------------------------
// As assercoes puras acima provam a REGRA. Nenhuma delas prova que a rota a
// chama: um `if (false)` em volta do bloco do movimento passa por todas, e o
// sintoma seria o de sempre -- a parcela anda sozinha e a serie fica torta.
//
// E OS COMENTARIOS SAO REMOVIDOS ANTES DE QUALQUER BUSCA. Este arquivo e a rota
// explicam por escrito exatamente o que estas assercoes procuram ("aceita
// `invoice_month`", "chama `novasFaturasDasParcelas`"): sobre o texto cru elas
// passariam verdes com o codigo apagado.

const semComentarios = (fonte) =>
  fonte
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const CODIGO_DA_SERIE = semComentarios(ROTA_SERIE);

test("a rota aceita as DUAS formas de mover: a fatura e a data", () => {
  // As duas, porque sao os dois caminhos pelos quais a tela move uma parcela
  // hoje: o seletor de fatura (041) e o campo de data.
  assert.match(CODIGO_DA_SERIE, /invoice_month,/, "a rota nao le invoice_month do corpo");
  assert.match(CODIGO_DA_SERIE, /transaction_date,/, "a rota nao le transaction_date do corpo");
  assert.match(
    CODIGO_DA_SERIE,
    /mudaFatura\s*&&\s*mudaData/,
    "a rota nao recusa os dois destinos no mesmo pedido"
  );
});

test("a rota chama a REGRA do movimento, e nao uma aritmetica propria", () => {
  assert.match(
    CODIGO_DA_SERIE,
    /novasFaturasDasParcelas\(/,
    "a rota nao usa a regra do deslocamento"
  );
  // Nenhuma conta de mes escrita na rota: duas copias da aritmetica divergem no
  // primeiro conserto que so uma das duas receber.
  assert.ok(
    !/somaMeses\(|getUTCMonth|setMonth/.test(CODIGO_DA_SERIE),
    "a rota cresceu a propria aritmetica de meses"
  );
});

test("em que fatura cai a data nova: a rota PERGUNTA ao banco", () => {
  // `card_invoice_month` (006) e a unica fonte dessa regra. Recalcula-la em
  // TypeScript criaria a segunda, e as duas divergiriam no primeiro dia de
  // fechamento alterado -- "31/01 com fechamento no dia 30 cai em fevereiro" e
  // o caso que uma reimplementacao perde na borda.
  assert.match(
    CODIGO_DA_SERIE,
    /rpc\(\s*"card_invoice_month"/,
    "a rota nao pergunta ao banco em que fatura a data cai"
  );
  assert.match(
    CODIGO_DA_SERIE,
    /closing_day/,
    "a rota nao leva o dia de fechamento do cartao para a RPC"
  );
});

test("a rota grava UMA linha por parcela movida, com a fatura de cada uma", () => {
  // `.in(ids).update({invoice_month_override: X})` poria a MESMA fatura em todas
  // -- a serie inteira numa fatura so, que e um defeito maior do que o que esta
  // issue conserta.
  assert.match(
    CODIGO_DA_SERIE,
    /movimento\.movimentos/,
    "a rota nao percorre os movimentos"
  );
  assert.match(
    CODIGO_DA_SERIE,
    /invoice_month_override:\s*m\.invoiceMonth/,
    "a rota nao grava a fatura de destino de cada parcela"
  );
  assert.match(
    CODIGO_DA_SERIE,
    /\.eq\("id",\s*m\.id\)/,
    "a rota nao grava parcela por parcela"
  );
});

test("a rota devolve quantas parcelas andaram", () => {
  // Sem este numero, "Parcela alterada" sobre um pedido que moveu oito linhas
  // em sete faturas esconde justamente o que a issue entregou -- e conferir
  // seria abrir as sete faturas.
  assert.match(CODIGO_DA_SERIE, /parcelas_movidas:/);
  assert.match(CODIGO_DA_SERIE, /deslocamento_em_meses:/);
});

// ---------------------------------------------------------------------------
// 7c. QUANDO A TELA MOVEU, E QUANDO ELA SO EDITOU
// ---------------------------------------------------------------------------
// O formulario tem DOIS campos que colocam a compra numa fatura -- a data e o
// seletor da 041 --, e eles nao tem o mesmo peso. Com override preenchido, a
// fatura e a escolha e a data nao coloca nada: tratar toda troca de data como
// movimento faria as nove irmas andarem com a ancora PARADA, que e o defeito
// desta issue invertido e pior (a tela nem mostra as irmas).

test("a fatura escolhida e o destino, e ela ganha da data", () => {
  assert.deepEqual(
    movimentoPedidoNaTela({
      dataGravada: "2026-10-04",
      faturaGravada: "",
      dataNova: "2026-10-04",
      faturaNova: "2026-12",
    }),
    { invoice_month: "2026-12" }
  );

  // As duas mudaram: a escolha explicita e o destino. A rota recusaria as duas
  // juntas -- sao dois lugares diferentes para a mesma parcela.
  assert.deepEqual(
    movimentoPedidoNaTela({
      dataGravada: "2026-10-04",
      faturaGravada: "2026-10",
      dataNova: "2026-11-20",
      faturaNova: "2026-12",
    }),
    { invoice_month: "2026-12" }
  );
});

test("apagar a fatura escolhida devolve a parcela para a data, e isso MOVE", () => {
  assert.deepEqual(
    movimentoPedidoNaTela({
      dataGravada: "2026-10-04",
      faturaGravada: "2026-12",
      dataNova: "2026-10-04",
      faturaNova: "",
    }),
    { transaction_date: "2026-10-04" }
  );
});

test("sem fatura escolhida, mudar a data MOVE", () => {
  assert.deepEqual(
    movimentoPedidoNaTela({
      dataGravada: "2026-10-04",
      faturaGravada: "",
      dataNova: "2026-11-04",
      faturaNova: "",
    }),
    { transaction_date: "2026-11-04" }
  );
});

test("O MUTANTE CRITICO DA TELA: com a fatura escolhida INTACTA, a data nao move", () => {
  // O override continua colocando a parcela onde ela esta. Se isto virasse
  // movimento, as irmas andariam e a ancora ficaria -- e a tela nao mostra as
  // irmas, entao ninguem veria.
  assert.equal(
    movimentoPedidoNaTela({
      dataGravada: "2026-10-04",
      faturaGravada: "2026-11",
      dataNova: "2026-10-20",
      faturaNova: "2026-11",
    }),
    null
  );
});

test("Salvar sem mexer na colocacao nao pergunta nada", () => {
  assert.equal(
    movimentoPedidoNaTela({
      dataGravada: "2026-10-04",
      faturaGravada: "",
      dataNova: "2026-10-04",
      faturaNova: "",
    }),
    null
  );
});

test("mover tem as PROPRIAS consequencias na tela, e nao as do valor", () => {
  const movendo = opcoesDeAlcance({
    tipo: "parcela",
    acao: "alterar",
    ancora: "parcela 3 de 10",
    totalDeParcelas: 10,
    movendo: true,
  });

  // Mover NAO muda o total da compra, entao a frase do valor ("o total da compra
  // deixa de ser o valor da parcela vezes o numero de parcelas") seria falsa
  // aqui. O que esta em jogo e a cadencia.
  assert.match(
    consequenciaNaTela("esta_e_proximas", movendo),
    /a partir da fatura dela/
  );
  assert.ok(
    !/total da compra/.test(consequenciaNaTela("esta_e_proximas", movendo)),
    "a consequencia de mover fala do total da compra, que mover nao muda"
  );
  // E "apenas esta" declara o estado que a issue existe para evitar.
  assert.match(
    consequenciaNaTela("apenas_esta", movendo),
    /duas parcelas podem acabar na mesma fatura/
  );
  assert.match(
    consequenciaNaTela("todas", movendo),
    /fatura já paga não são movidas/
  );

  // Sem `movendo`, as frases continuam sendo as do valor -- a alteracao de valor
  // nao mudou de texto.
  const alterandoValor = opcoesDeAlcance({
    tipo: "parcela",
    acao: "alterar",
    ancora: "parcela 3 de 10",
    totalDeParcelas: 10,
  });
  assert.match(
    consequenciaNaTela("esta_e_proximas", alterandoValor),
    /valor da parcela vezes o número de parcelas/
  );
});

test("o formulario pergunta o alcance ANTES de gravar a linha movida", () => {
  // A fiacao: sem ela, a regra e a rota existem e o Salvar continua movendo uma
  // linha so. Os comentarios saem antes da busca -- o formulario explica por
  // escrito exatamente isto.
  const FORMULARIO = semComentarios(
    readFileSync("components/movimentacoes/FormularioDeLancamento.tsx", "utf8")
  );

  assert.match(
    FORMULARIO,
    /movimentoPedidoNaTela\(/,
    "o formulario nao decide se a parcela foi movida"
  );
  assert.match(
    FORMULARIO,
    /financial-installments\/serie\//,
    "o formulario nao chama a rota que conhece a serie"
  );
  assert.match(
    FORMULARIO,
    /setPerguntandoAlcance\(true\)/,
    "o formulario nao abre a pergunta do alcance"
  );
  // A ORDEM: mover primeiro, gravar depois. Gravar antes apagaria a fatura de
  // ORIGEM, e a rota leria deslocamento zero sobre a parcela ja movida.
  const pedido = FORMULARIO.indexOf("financial-installments/serie/");
  const gravacao = FORMULARIO.indexOf("await gravarTransacao()", pedido);
  assert.ok(
    pedido > 0 && gravacao > pedido,
    "o formulario grava a linha antes de pedir o movimento"
  );
});
