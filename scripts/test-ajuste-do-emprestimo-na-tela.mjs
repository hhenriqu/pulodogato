// =========================================================
// PULODOGATO -- o ajuste na tela: o corpo do PATCH e a previa (HMO-480)
// =========================================================
//   npm run test:ajuste-do-emprestimo-na-tela
//
// Roda o JS compilado de `lib/ajuste-do-emprestimo-na-tela.ts` (F8 da HMO-444). Sem navegador:
// as seis funcoes aqui sao puras, e o que elas decidem e (a) quais campos
// viajam no corpo do PATCH e (b) que numeros a pessoa le antes de clicar.
//
// O QUE ESTA SUITE EXISTE PARA PEGAR
// ----------------------------------
// A rota do ajuste (F4/F7) esta inteira e medida. O risco desta filha nao e a
// aritmetica -- e a FIACAO, em dois lugares, e os dois sao silenciosos:
//
//   1. UM CAMPO QUE VIAJA SEM TER SIDO TOCADO. `{descricao: "Geladeira"}` sobre
//      um emprestimo que ja se chama "Geladeira" nao da erro, nao muda numero
//      nenhum e grava: a rota entra em `mexeNaDescricao`, a frase reporta uma
//      troca de descricao, e o `updated_at` anda. Nenhuma assercao de VALOR pega
//      isso, porque o valor esta certo. So a assercao de PRESENCA pega
//      (`!("descricao" in pedido)`), e e por isso que ela esta em quase todo
//      caso daqui -- a forma da memoria
//      `pagina-da-sonda-tem-lista-propria-de-modulos-separada-do-tsconfig`, que
//      manda afirmar o contrato novo E que a chave antiga sumiu.
//
//   2. A PREVIA LENDO O ARGUMENTO ERRADO. `previa-na-tela-tem-que-usar-o-peso-
//      do-fechamento`: a tela chamava a funcao de producao certa com o argumento
//      errado, o total fechava, nada denunciava, e a diferenca eram 13 centavos
//      por mes. Aqui o par equivalente e `total` x `falta_receber`: num
//      emprestimo sem nada pago os dois sao o MESMO NUMERO, e uma fiacao trocada
//      passaria verde para sempre. Por isso todo fixture de previa desta suite
//      tem PARCELA PAGA -- e o unico estado em que as duas grandezas discordam.
//
// OS VALORES SAO CRAVADOS, CALCULADOS A MAO EM CENTAVOS INTEIROS
// --------------------------------------------------------------
// Nenhuma assercao recalcula o esperado com as funcoes da lib: um conferidor que
// usa o mesmo extrator nos dois lados concorda com qualquer aritmetica
// (`sonda-que-se-mede-a-si-mesma`). As contas:
//
//   EMPRESTIMO BASE: emprestado 1.000,00, 4 parcelas de 300,00, taxa 0,2 (20%)
//     total gravado    100000 x 1,2 = 120000  -> 1.200,00
//     parcelas         4 x 30000    = 120000  -> fecha com o total
//     1 paga (300,00)  jaRecebido              -> 300,00
//     3 pendentes      3 x 30000    =  90000  -> 900,00
//
//   {taxa: "50"}   -> fracao 0,5; 100000 x 1,5 = 150000 -> total 1.500,00
//                     juros 150000 - 100000 = 50000     -> 500,00
//                     emprestado PARADO                 -> 1.000,00
//                     falta receber 150000 - 30000 = 120000 -> 1.200,00
//
//   {total: "1500"} -> mesmo total, e a taxa sai da INVERSA: 150000/100000 - 1
//                     = 0,5 -> "50,00%". Os dois modos tem de dar o MESMO
//                     quinteto, e e uma assercao desta suite.
//
//   {primeiroVencimentoDaCauda} -> nao mexe em valor: total continua o
//                     `principal` gravado (1.000,00 -- ver abaixo por que NAO e
//                     1.200,00) e falta receber continua o que as pendentes
//                     somam (900,00).
//
// O CASO QUE PARECE DEFEITO E NAO E: `{vencimento}` MOSTRA 1.000,00
// -----------------------------------------------------------------
// `totalDepoisDoAjuste` sem juro e sem `pedido.total` devolve
// `emprestimo.principal`, e num emprestimo COM juro `principal` e o emprestado
// (1.000,00), nao a divida (1.200,00). Entao a previa do pedido que so adia a
// data diz "Passa a valer R$ 1.000,00" sobre uma divida de 1.200,00.
//
// ISSO E A ROTA, NAO ESTA TELA, e esta suite CRAVA o numero em vez de o
// esconder: a previa mostra o que a rota vai concluir, e se a conclusao da rota
// e estranha a previa tem de ser estranha junto -- uma tela que "consertasse" o
// numero aqui mentiria sobre o que vai ser gravado, que e exatamente o defeito
// que `previaDoAjuste` existe para nao cometer. `faltaReceberDoAjuste` tem o
// terceiro ramo (as pendentes somadas, 900,00) exatamente porque `principal` ali
// estaria errado -- o JSDoc dela diz "adiar o vencimento de um emprestimo com
// metade paga DOBRARIA a divida de quem so pediu para mudar uma data". Entao a
// linha "Falta receber" esta certa e e a que importa; a de "Passa a valer" herda
// a escolha da rota. Anotado aqui para que a proxima pessoa que olhar nao
// "conserte" a tela.
// =========================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  FORMULARIO_DO_AJUSTE_VAZIO,
  fraseDoEmprestadoNoAjuste,
  parcelasParaAjustar,
  pedidoAjustaAlgumCampo,
  pedidoDoAjusteDaTela,
  previaDoAjuste,
  rotuloDoModoDoAjuste,
} = await import("../.tmp-ajuste-do-emprestimo-na-tela/lib/ajuste-do-emprestimo-na-tela.js");

// `ajusteDoEmprestimo` E A ROTA, E ELA ENTRA NESTA SUITE DE PROPOSITO (HMO-479).
// O caso E1 nao afirma um R$ escolhido a mao: ele compara a previa com o
// `patchDoEmprestimo` que o servidor vai gravar. Um valor cravado nos dois lados
// passaria a verde no dia em que a rota mudasse de ramo
// (`suite-de-view-com-valor-cravado-nao-se-re-roda`, mesma familia).
const { ajusteDoEmprestimo } = await import(
  "../.tmp-ajuste-do-emprestimo-na-tela/lib/emprestimo-do-mybank.js"
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** O formulario com os campos pedidos trocados. Parte SEMPRE do vazio. */
function form(mudancas = {}) {
  return { ...FORMULARIO_DO_AJUSTE_VAZIO, ...mudancas };
}

/**
 * O EMPRESTIMO BASE, e ele tem PARCELA PAGA de proposito.
 *
 * Ver o cabecalho, ponto 2: sem parcela paga, `total` e `falta_receber` sao o
 * mesmo numero e a suite nao distingue as duas grandezas. `jaRecebido` 300,00 e
 * o que as separa.
 *
 * `amount` COMO STRING, porque e assim que `numeric(15,2)` chega do PostgREST --
 * e `jaRecebidoDaSerie` existe por isso. Um fixture com numero mediria um
 * caminho que a producao nao tem.
 */
function emprestimoBase() {
  return {
    principal: 1000,
    interest_rate: 0.2,
  };
}

function parcelasBase() {
  return [
    {
      id: "p1",
      installment_number: 1,
      installment_total: 4,
      amount: "300.00",
      due_date: "2026-01-10",
      status: "paid",
    },
    {
      id: "p2",
      installment_number: 2,
      installment_total: 4,
      amount: "300.00",
      due_date: "2026-02-10",
      status: "pending",
    },
    {
      id: "p3",
      installment_number: 3,
      installment_total: 4,
      amount: "300.00",
      due_date: "2026-03-10",
      status: "pending",
    },
    {
      id: "p4",
      installment_number: 4,
      installment_total: 4,
      amount: "300.00",
      due_date: "2026-04-10",
      status: "pending",
    },
  ];
}

/** A grandeza de uma chave, ou `undefined` se a previa nao a tem. */
function grandeza(previa, chave) {
  return (previa ?? []).find((g) => g.chave === chave);
}

/** O valor formatado de uma chave -- o texto que a pessoa LE. */
function valorDa(previa, chave) {
  const g = grandeza(previa, chave);
  assert.ok(g, `a previa nao tem a grandeza "${chave}"`);
  return g.valor;
}

// ---------------------------------------------------------------------------
// A -- A PRESENCA DO CAMPO MANDA
// ---------------------------------------------------------------------------

test("A1: o formulario de abertura nao manda campo nenhum", () => {
  const pedido = pedidoDoAjusteDaTela(FORMULARIO_DO_AJUSTE_VAZIO);

  // O CORPO E `{}`, e a assercao e sobre as QUATRO chaves e nao sobre o
  // tamanho: `Object.keys(...).length === 0` passaria tambem com uma chave
  // chamada errado, e um campo com nome errado e `!== undefined` na rota.
  assert.ok(!("descricao" in pedido));
  assert.ok(!("total" in pedido));
  assert.ok(!("taxa" in pedido));
  assert.ok(!("primeiroVencimentoDaCauda" in pedido));

  assert.equal(pedidoAjustaAlgumCampo(pedido), false);
});

test("A2: a descricao digitada viaja, e so ela", () => {
  const pedido = pedidoDoAjusteDaTela(form({ descricao: "Geladeira nova" }));

  assert.equal(pedido.descricao, "Geladeira nova");
  // AS OUTRAS TRES SAO A ENTREGA. O pedido que so corrige um typo nao pode
  // mandar `total` nem data: com `total` ele recalcularia a cauda inteira, e a
  // rota pediria parcela pendente (`sem_parcela_pendente`) a quem so queria
  // trocar o texto de um emprestimo todo pago.
  assert.ok(!("total" in pedido));
  assert.ok(!("taxa" in pedido));
  assert.ok(!("primeiroVencimentoDaCauda" in pedido));

  assert.equal(pedidoAjustaAlgumCampo(pedido), true);
});

test("A3: campo em branco e campo NAO TOCADO, nos quatro", () => {
  // "" e "   " sao a mesma coisa: campo em branco. Ver `trim()` DECIDE.
  const pedido = pedidoDoAjusteDaTela(
    form({
      descricao: "   ",
      modoDoJuro: "taxa",
      taxa: "  ",
      primeiroVencimentoDaCauda: "",
    })
  );

  assert.ok(!("descricao" in pedido));
  assert.ok(!("taxa" in pedido));
  assert.ok(!("primeiroVencimentoDaCauda" in pedido));
  assert.equal(pedidoAjustaAlgumCampo(pedido), false);
});

test("A4: o valor vai CRU, nao aparado", () => {
  // A tela nao conserta o pedido calado: quem decide o que serve e a rota, e a
  // pessoa relê a resposta dela. Aparar aqui faria a descricao gravada ser
  // diferente da digitada sem nada avisar.
  const pedido = pedidoDoAjusteDaTela(form({ descricao: "  Geladeira  " }));
  assert.equal(pedido.descricao, "  Geladeira  ");
});

test("A5: o MODO escolhe qual campo de juro viaja -- nunca os dois", () => {
  // O caso que esta tela existe para tornar inalcancavel
  // (`taxa_e_total_juntos`): os dois campos preenchidos no estado, um modo so.
  const comOsDoisDigitados = { taxa: "50", total: "1500" };

  const porTaxa = pedidoDoAjusteDaTela(
    form({ ...comOsDoisDigitados, modoDoJuro: "taxa" })
  );
  assert.equal(porTaxa.taxa, "50");
  assert.ok(!("total" in porTaxa));

  const porTotal = pedidoDoAjusteDaTela(
    form({ ...comOsDoisDigitados, modoDoJuro: "total" })
  );
  assert.equal(porTotal.total, "1500");
  assert.ok(!("taxa" in porTotal));

  // E O MODO INICIAL NAO MANDA NENHUM DOS DOIS, mesmo com os dois digitados --
  // e o caso de quem digitou, voltou para "Nao mexer nos juros" e mandou.
  const semMexer = pedidoDoAjusteDaTela(
    form({ ...comOsDoisDigitados, modoDoJuro: "sem_juros" })
  );
  assert.ok(!("taxa" in semMexer));
  assert.ok(!("total" in semMexer));
  assert.equal(pedidoAjustaAlgumCampo(semMexer), false);
});

test("A6: zerar o juro se pede com taxa 0, e ele VIAJA", () => {
  // O caso que separa "nao mexer" de "zerar": `{taxa: "0"}` e um pedido
  // legitimo, e `Number("0") === 0` NAO pode fazer o campo sumir. Uma guarda
  // escrita como `if (Number(form.taxa))` mataria exatamente este caso.
  const pedido = pedidoDoAjusteDaTela(
    form({ modoDoJuro: "taxa", taxa: "0" })
  );
  assert.equal(pedido.taxa, "0");
  assert.equal(pedidoAjustaAlgumCampo(pedido), true);
});

test("A7: os quatro campos juntos sao um pedido valido", () => {
  // `taxa` e `total` sao exclusivos, entao "os quatro" sao descricao + um dos
  // dois + data. Sem este caso, uma guarda que mandasse UM campo so (um
  // `else if` na cadeia) sobreviveria a suite inteira.
  const pedido = pedidoDoAjusteDaTela(
    form({
      descricao: "Geladeira",
      modoDoJuro: "taxa",
      taxa: "50",
      primeiroVencimentoDaCauda: "2026-06-10",
    })
  );

  assert.equal(pedido.descricao, "Geladeira");
  assert.equal(pedido.taxa, "50");
  assert.equal(pedido.primeiroVencimentoDaCauda, "2026-06-10");
  assert.ok(!("total" in pedido));
});

test("A8: cada um dos quatro campos sozinho ja habilita o botao", () => {
  // `pedidoAjustaAlgumCampo` e um OU de quatro. Sem um caso por campo, tirar
  // qualquer um dos quatro ramos sobreviveria -- e o sintoma seria um botao
  // cinza sobre um campo preenchido, que se le como tela quebrada.
  for (const mudanca of [
    { descricao: "x" },
    { modoDoJuro: "taxa", taxa: "50" },
    { modoDoJuro: "total", total: "1500" },
    { primeiroVencimentoDaCauda: "2026-06-10" },
  ]) {
    assert.equal(
      pedidoAjustaAlgumCampo(pedidoDoAjusteDaTela(form(mudanca))),
      true,
      `o campo ${JSON.stringify(mudanca)} tinha de habilitar o ajuste`
    );
  }
});

// ---------------------------------------------------------------------------
// B -- OS ROTULOS DO ALTERNADOR
// ---------------------------------------------------------------------------

test("B1: o modo inicial diz NAO MEXER, e nao 'sem juros'", () => {
  // A frase e a entrega: "Sem juros" marcado faria a pessoa acreditar que
  // aquele modo ZERA o juro, e ele nao manda campo nenhum. Ver ZERAR O JURO.
  assert.equal(rotuloDoModoDoAjuste("sem_juros"), "Não mexer nos juros");
  assert.equal(rotuloDoModoDoAjuste("taxa"), "% de juros");
  assert.equal(rotuloDoModoDoAjuste("total"), "Total a receber");

  // E O MODO INICIAL DO FORMULARIO E ESSE. Sem esta linha, o rotulo certo
  // poderia estar num modo que a tela nunca abre.
  assert.equal(FORMULARIO_DO_AJUSTE_VAZIO.modoDoJuro, "sem_juros");
});

// ---------------------------------------------------------------------------
// C -- A TRADUCAO DAS DUAS FORMAS DA PARCELA
// ---------------------------------------------------------------------------

test("C1: a parcela da rota vira a parcela do ajuste, campo por campo", () => {
  // `parcela.total` e o TOTAL DE PARCELAS (o 24 de "3 de 24"), `parcela.valor` e
  // o dinheiro. Trocar os dois nao da sintoma na previa, e poe o numero de
  // parcelas no lugar do valor -- `nome-de-campo-errado-esconde-bug-de-dinheiro`.
  const [traduzida] = parcelasParaAjustar([
    {
      id: "p9",
      valor: 300.5,
      numero: 3,
      total: 24,
      rotulo: "3 de 24",
      vencimento: "2026-03-10",
      status: "pending",
      a_confirmar: false,
    },
  ]);

  assert.equal(traduzida.id, "p9");
  assert.equal(traduzida.installment_number, 3);
  assert.equal(traduzida.installment_total, 24);
  assert.equal(traduzida.amount, 300.5);
  assert.equal(traduzida.due_date, "2026-03-10");
  assert.equal(traduzida.status, "pending");
});

test("C2: traduzida, a serie ainda distingue paga de pendente", () => {
  // O que a traducao tem de preservar para a previa funcionar: o `status` e o
  // `amount`. Sem este caso, um mapeamento que perdesse o status passaria C1 (o
  // campo existe) e faria `jaRecebido` virar 0 -- a previa diria que falta
  // receber a divida inteira num emprestimo com metade paga.
  const traduzidas = parcelasParaAjustar([
    { id: "a", valor: 300, numero: 1, total: 2, rotulo: "", vencimento: "2026-01-10", status: "paid", a_confirmar: false },
    { id: "b", valor: 300, numero: 2, total: 2, rotulo: "", vencimento: "2026-02-10", status: "pending", a_confirmar: false },
  ]);

  const previa = previaDoAjuste({
    emprestimo: { principal: 600, interest_rate: 0 },
    parcelas: traduzidas,
    pedido: { primeiroVencimentoDaCauda: "2026-05-10" },
  });

  // 600,00 de divida, 300,00 pagos -> falta 300,00 (o que a pendente soma).
  assert.equal(valorDa(previa, "falta_receber"), "R$ 300,00");
});

// ---------------------------------------------------------------------------
// D -- A PREVIA
// ---------------------------------------------------------------------------

test("D1: formulario intocado nao tem previa (e nao uma de zeros)", () => {
  assert.equal(
    previaDoAjuste({
      emprestimo: emprestimoBase(),
      parcelas: parcelasBase(),
      pedido: pedidoDoAjusteDaTela(FORMULARIO_DO_AJUSTE_VAZIO),
    }),
    null
  );
});

test("D2: {taxa: 50} -- o emprestado fica PARADO e a taxa se move", () => {
  // A decisao da HMO-478 (opcao A, confirmada pelo Helio) medida na tela.
  const previa = previaDoAjuste({
    emprestimo: emprestimoBase(),
    parcelas: parcelasBase(),
    pedido: pedidoDoAjusteDaTela(form({ modoDoJuro: "taxa", taxa: "50" })),
  });

  // O EMPRESTADO NAO SE MOVEU: 1.000,00 antes, 1.000,00 depois. Esta e a
  // assercao central da issue irma, e aqui ela vale sobre `juro.principal` --
  // ou seja, sobre a RESPOSTA da funcao e nao sobre o fixture.
  assert.equal(valorDa(previa, "emprestado"), "R$ 1.000,00");

  // E A DIVIDA SE MOVEU: 100000 x 1,5 = 150000.
  assert.equal(valorDa(previa, "total"), "R$ 1.500,00");
  assert.equal(valorDa(previa, "juros"), "R$ 500,00");
  assert.equal(valorDa(previa, "taxa"), "50,00%");

  // E FALTA RECEBER NAO E O TOTAL: 150000 - 30000 (a parcela paga) = 120000.
  // As duas linhas discordam, e e por isso que as duas existem.
  assert.equal(valorDa(previa, "falta_receber"), "R$ 1.200,00");
});

test("D3: {total: 1500} da o MESMO quinteto que {taxa: 50}", () => {
  // Os dois sentidos do alternador sobre o mesmo emprestimo. A taxa aqui sai da
  // INVERSA (150000/100000 - 1 = 0,5), e cravar "50,00%" e o que prova que a
  // previa do modo `total` responde a segunda metade do pedido da HMO-444
  // ("vejo quanto de juros estou cobrando").
  const previa = previaDoAjuste({
    emprestimo: emprestimoBase(),
    parcelas: parcelasBase(),
    pedido: pedidoDoAjusteDaTela(form({ modoDoJuro: "total", total: "1500" })),
  });

  assert.equal(valorDa(previa, "emprestado"), "R$ 1.000,00");
  assert.equal(valorDa(previa, "total"), "R$ 1.500,00");
  assert.equal(valorDa(previa, "juros"), "R$ 500,00");
  assert.equal(valorDa(previa, "taxa"), "50,00%");
  assert.equal(valorDa(previa, "falta_receber"), "R$ 1.200,00");
});

test("D4: o pedido que nao mexe no juro NAO mostra juros nem taxa", () => {
  // A AUSENCIA E A INFORMACAO. "Juros R$ 0,00" ali diria que o ajuste vai zerar
  // o juro de um emprestimo que continua a 20% -- um numero falso sobre
  // dinheiro, na linha que a pessoa le para decidir.
  const previa = previaDoAjuste({
    emprestimo: emprestimoBase(),
    parcelas: parcelasBase(),
    pedido: pedidoDoAjusteDaTela(form({ descricao: "Geladeira nova" })),
  });

  assert.equal(grandeza(previa, "juros"), undefined);
  assert.equal(grandeza(previa, "taxa"), undefined);

  // E AS OUTRAS TRES CONTINUAM. A previa do typo nao e vazia: ela mostra que
  // nada de dinheiro muda, que e a confirmacao que a pessoa precisa.
  assert.equal(valorDa(previa, "emprestado"), "R$ 1.000,00");
  assert.equal(valorDa(previa, "falta_receber"), "R$ 900,00");
});

test("D5: so a data -- falta receber e o que as PENDENTES somam", () => {
  // O terceiro ramo de `faltaReceberDoAjuste`, e o JSDoc dele diz o estrago do
  // ramo errado: `principal - jaRecebido` daria 100000 - 30000 = 70000 (700,00)
  // e `principal` cru daria 1.000,00. O certo e 3 x 30000 = 90000 -> 900,00,
  // porque adiar uma data nao mexe em valor nenhum.
  const previa = previaDoAjuste({
    emprestimo: emprestimoBase(),
    parcelas: parcelasBase(),
    pedido: pedidoDoAjusteDaTela(
      form({ primeiroVencimentoDaCauda: "2026-09-10" })
    ),
  });

  assert.equal(valorDa(previa, "falta_receber"), "R$ 900,00");

  // E O TOTAL HERDA O `principal` DA ROTA -- 1.000,00 e nao 1.200,00. Ver O
  // CASO QUE PARECE DEFEITO E NAO E, no cabecalho. Cravado de proposito: a
  // previa mostra o que a rota conclui, estranho ou nao.
  assert.equal(valorDa(previa, "total"), "R$ 1.000,00");
  assert.equal(grandeza(previa, "juros"), undefined);
});

test("D6: taxa 0 sobre emprestimo COM juro zera a divida ate o emprestado", () => {
  // O pedido de perdoar o juro. `ajusteMexeNoJuro` e verdadeiro (ja tem juro +
  // mexe na taxa), entao a previa mostra as cinco grandezas com juro ZERO -- e
  // aqui "R$ 0,00" e verdade, diferente de D4.
  const previa = previaDoAjuste({
    emprestimo: emprestimoBase(),
    parcelas: parcelasBase(),
    pedido: pedidoDoAjusteDaTela(form({ modoDoJuro: "taxa", taxa: "0" })),
  });

  assert.equal(valorDa(previa, "emprestado"), "R$ 1.000,00");
  assert.equal(valorDa(previa, "total"), "R$ 1.000,00");
  assert.equal(valorDa(previa, "juros"), "R$ 0,00");
  assert.equal(valorDa(previa, "taxa"), "0,00%");
  // 100000 - 30000 = 70000. A pessoa ve que ainda falta receber 700,00 das tres
  // pendentes -- que e exatamente o que ela precisa ler para decidir.
  assert.equal(valorDa(previa, "falta_receber"), "R$ 700,00");
});

test("D7: emprestimo SEM juro -- {total} nao inventa taxa", () => {
  // `ajusteMexeNoJuro` e falso (nao tem juro e a taxa nao foi pedida), entao
  // `juroDepoisDoAjuste` devolve `null` e o total sai do PEDIDO. 4 parcelas de
  // 250,00 (1.000,00), 1 paga, novo total 1.200,00 -> falta 950,00.
  const parcelas = parcelasBase().map((p) => ({ ...p, amount: "250.00" }));

  const previa = previaDoAjuste({
    emprestimo: { principal: 1000, interest_rate: 0 },
    parcelas,
    pedido: pedidoDoAjusteDaTela(form({ modoDoJuro: "total", total: "1200" })),
  });

  assert.equal(valorDa(previa, "total"), "R$ 1.200,00");
  assert.equal(valorDa(previa, "falta_receber"), "R$ 950,00");
  // SEM TAXA NA PREVIA: a juro zero, mudar o total e mudar o valor da divida,
  // nao cobrar juro. Mostrar "20,00%" aqui seria inventar uma cobranca.
  assert.equal(grandeza(previa, "taxa"), undefined);
  assert.equal(grandeza(previa, "juros"), undefined);
});

test("D8: a ORDEM das grandezas e estavel, e emprestado vem primeiro", () => {
  // A ordem e leitura: emprestado (o que nao muda) antes de total (o que muda) e
  // de falta receber (o que sobra). `array-de-strings-sobrevive-ao-chunk-e-
  // prova-ordem`: a lista de chaves e a assercao, nao a posicao de uma delas.
  const comJuro = previaDoAjuste({
    emprestimo: emprestimoBase(),
    parcelas: parcelasBase(),
    pedido: pedidoDoAjusteDaTela(form({ modoDoJuro: "taxa", taxa: "50" })),
  });
  assert.deepEqual(
    comJuro.map((g) => g.chave),
    ["emprestado", "juros", "taxa", "total", "falta_receber"]
  );

  const semJuro = previaDoAjuste({
    emprestimo: emprestimoBase(),
    parcelas: parcelasBase(),
    pedido: pedidoDoAjusteDaTela(form({ descricao: "x" })),
  });
  assert.deepEqual(
    semJuro.map((g) => g.chave),
    ["emprestado", "total", "falta_receber"]
  );
});

test("D9: o emprestado da previa e o `principal` em STRING tambem", () => {
  // `numeric` chega como string do PostgREST, e a rota do painel ja faz
  // `Number(l.principal)` -- mas a funcao pura aceita as duas formas e
  // `"1000.00" + juro` seria concatenacao. O caso guarda a coercao.
  const previa = previaDoAjuste({
    emprestimo: { principal: "1000.00", interest_rate: "0.2000" },
    parcelas: parcelasBase(),
    pedido: pedidoDoAjusteDaTela(form({ modoDoJuro: "taxa", taxa: "50" })),
  });

  assert.equal(valorDa(previa, "emprestado"), "R$ 1.000,00");
  assert.equal(valorDa(previa, "total"), "R$ 1.500,00");
});

test("D10: {total} sobre emprestimo COM juro recalcula a taxa", () => {
  // O caso que `interest_rate` na rota do painel existe para alcancar (HMO-480).
  // Sem o campo, `jaTemJuro` seria falso, `juroDepoisDoAjuste` devolveria `null`
  // e a previa mostraria o total certo e TAXA NENHUMA -- enquanto a rota
  // gravaria uma taxa nova. Aqui o fixture tem a taxa, e a previa a reporta.
  //
  // 100000 -> 110000 e taxa 110000/100000 - 1 = 0,1 -> "10,00%".
  const previa = previaDoAjuste({
    emprestimo: emprestimoBase(),
    parcelas: parcelasBase(),
    pedido: pedidoDoAjusteDaTela(form({ modoDoJuro: "total", total: "1100" })),
  });

  assert.equal(valorDa(previa, "taxa"), "10,00%");
  assert.equal(valorDa(previa, "juros"), "R$ 100,00");
  assert.equal(valorDa(previa, "emprestado"), "R$ 1.000,00");
});

test("D11: taxa e total juntos no pedido nao produzem previa de juro", () => {
  // A tela nao alcanca este corpo (A5), mas a funcao e chamada com o pedido que
  // chegar: `juroDepoisDoAjuste` devolve `null` para os dois juntos (eles podem
  // DISCORDAR), e quem transforma isso em frase e a rota
  // (`taxa_e_total_juntos`). A previa nao pode escolher um dos dois calado --
  // seria apagar da tela um numero que a pessoa digitou.
  const previa = previaDoAjuste({
    emprestimo: emprestimoBase(),
    parcelas: parcelasBase(),
    pedido: { taxa: "50", total: "9999" },
  });

  assert.equal(grandeza(previa, "taxa"), undefined);
  assert.equal(grandeza(previa, "juros"), undefined);
});

// ---------------------------------------------------------------------------
// E. O EMPRESTADO QUE MUDA, E A FRASE QUE O EXPLICA (HMO-479)
// ---------------------------------------------------------------------------
// O bloco D mediu a previa em cinco cenarios e NAO mediu o `emprestado` no
// unico ramo em que ele se move: sem juro, com `total` no pedido, a rota grava
// `principal = total` e a previa imprimia o valor ANTIGO (o D7 afirmava
// `total`, `falta_receber` e a ausencia de taxa/juros -- nunca o emprestado).
//
// O E1 fecha aquele buraco e nao fecha so o numero: ele pergunta a ROTA o que
// vai ser gravado e exige que a tela diga a mesma coisa.
// ---------------------------------------------------------------------------

/** O `principal` que o PATCH vai gravar, ou `undefined` se a coluna nao entra. */
function principalGravado({ emprestimo, parcelas, pedido }) {
  const ajuste = ajusteDoEmprestimo({
    emprestimo: { description: "Geladeira", ...emprestimo },
    parcelas,
    pedido,
    cauda: null,
  });
  return ajuste.patchDoEmprestimo?.principal;
}

test("E1: SEM juro, {total} -- o emprestado da previa e o que a ROTA grava", () => {
  // O cenario do D7, letra por letra: 4x250,00 (1.000,00), 1 paga, sem juro,
  // novo total 1.200,00. Antes da HMO-479 a tela dizia "R$ 1.000,00" aqui e o
  // `patchDoEmprestimo` levava `{principal: 1200}`.
  const parcelas = parcelasBase().map((p) => ({ ...p, amount: "250.00" }));
  const emprestimo = { principal: 1000, interest_rate: 0 };
  const pedido = pedidoDoAjusteDaTela(form({ modoDoJuro: "total", total: "1200" }));

  const gravado = principalGravado({ emprestimo, parcelas, pedido });

  // A ROTA MEXE NO EMPRESTADO NESTE RAMO, E PARA 1200 -- se isto falhar, o ramo
  // mudou de lado e a assercao abaixo passou a falar de outra coisa.
  //
  // O 1200 ESTA ESCRITO NOS DOIS LADOS DE PROPOSITO, e nao derivado de um para o
  // outro: `assert.equal(previa, emReais(gravado))` usaria a lib como seu proprio
  // conferidor e concordaria com qualquer aritmetica
  // (`sonda-que-se-mede-a-si-mesma`, a regra do cabecalho desta suite). O que liga
  // as duas afirmacoes e o numero cravado no meio.
  assert.equal(gravado, 1200, "a rota deveria gravar principal = total");

  const previa = previaDoAjuste({ emprestimo, parcelas, pedido });
  assert.equal(valorDa(previa, "emprestado"), "R$ 1.200,00");

  // E O TOTAL CONTINUA SENDO O MESMO NUMERO, que e o que "a juro zero o total E
  // o principal" quer dizer. As duas linhas coincidirem aqui NAO e redundancia:
  // e a prova de que a previa nao passou a somar juro nenhum.
  assert.equal(valorDa(previa, "total"), "R$ 1.200,00");
  assert.equal(valorDa(previa, "falta_receber"), "R$ 950,00");
});

test("E2: COM juro, {total} -- o emprestado fica PARADO e a rota nao toca a coluna", () => {
  // O outro lado da mesma moeda, e e a decisao da F7: com juro, `{total}`
  // recalcula a TAXA e o `principal` NAO entra no patch.
  const emprestimo = emprestimoBase();
  const parcelas = parcelasBase();
  const pedido = pedidoDoAjusteDaTela(form({ modoDoJuro: "total", total: "1500" }));

  assert.equal(
    principalGravado({ emprestimo, parcelas, pedido }),
    undefined,
    "com juro o principal nao pode entrar no patch"
  );

  const previa = previaDoAjuste({ emprestimo, parcelas, pedido });
  assert.equal(valorDa(previa, "emprestado"), "R$ 1.000,00");
  assert.equal(valorDa(previa, "total"), "R$ 1.500,00");
});

test("E3: a frase diz CONTINUA no ramo com juro, e nomeia o emprestado parado", () => {
  const frase = fraseDoEmprestadoNoAjuste({
    emprestimo: emprestimoBase(),
    parcelas: parcelasBase(),
    pedido: pedidoDoAjusteDaTela(form({ modoDoJuro: "total", total: "1500" })),
  });

  assert.match(frase, /continua tendo emprestado/);
  // O R$ DA FRASE E O DA LINHA `emprestado`, e nao o total que a pessoa digitou.
  assert.match(frase, /R\$ 1\.000,00/);
  assert.doesNotMatch(frase, /R\$ 1\.500,00/);
});

test("E4: a frase NAO diz CONTINUA quando o emprestado muda -- ela seria falsa", () => {
  // O ramo do E1. Uma frase fixa no JSX mentiria exatamente aqui, e mentiria no
  // ramo em que a pessoa esta mexendo no valor DE PROPOSITO.
  const frase = fraseDoEmprestadoNoAjuste({
    emprestimo: { principal: 1000, interest_rate: 0 },
    parcelas: parcelasBase().map((p) => ({ ...p, amount: "250.00" })),
    pedido: pedidoDoAjusteDaTela(form({ modoDoJuro: "total", total: "1200" })),
  });

  assert.doesNotMatch(frase, /continua/);
  assert.match(frase, /corrige o valor emprestado/);
  // O NUMERO E O NOVO, e nao o de hoje: a frase acompanha a linha corrigida.
  assert.match(frase, /R\$ 1\.200,00/);
  assert.doesNotMatch(frase, /R\$ 1\.000,00/);
});

test("E5: a frase e `null` quando o pedido nao tem noticia sobre o emprestado", () => {
  // So descricao, e so data: nenhum dos dois chega perto de `principal`.
  const so = (mudancas) =>
    fraseDoEmprestadoNoAjuste({
      emprestimo: emprestimoBase(),
      parcelas: parcelasBase(),
      pedido: pedidoDoAjusteDaTela(form(mudancas)),
    });

  assert.equal(so({ descricao: "Geladeira nova" }), null);
  assert.equal(so({ primeiroVencimentoDaCauda: "2026-06-10" }), null);
  // E o formulario INTOCADO tambem, pela mesma porta que a previa usa.
  assert.equal(so({}), null);
});

test("E6: {taxa: 0} perdoa o juro e o emprestado CONTINUA parado", () => {
  // Zerar o juro e o ramo em que o total CAI, e a tentacao de ler "o emprestado
  // tambem caiu" e maxima: com juro 0 o total passa a valer o emprestado.
  const emprestimo = emprestimoBase();
  const parcelas = parcelasBase();
  const pedido = pedidoDoAjusteDaTela(form({ modoDoJuro: "taxa", taxa: "0" }));

  assert.equal(
    principalGravado({ emprestimo, parcelas, pedido }),
    undefined,
    "perdoar o juro nao move o principal"
  );

  const previa = previaDoAjuste({ emprestimo, parcelas, pedido });
  assert.equal(valorDa(previa, "emprestado"), "R$ 1.000,00");
  assert.equal(valorDa(previa, "total"), "R$ 1.000,00");
  assert.match(fraseDoEmprestadoNoAjuste({ emprestimo, parcelas, pedido }), /continua/);
});
