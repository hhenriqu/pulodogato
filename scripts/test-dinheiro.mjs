#!/usr/bin/env node
// =====================================================
// PULODOGATO - a mascara de dinheiro e o valor por tras dela (HMO-171)
// =====================================================
// O pedido era de aparencia ("aplicar a mascara R$1.000,00"), mas o defeito que
// ele pode CRIAR e de dinheiro. Todo formulario deste app guarda o valor como
// string e converte com `Number.parseFloat` na hora de gravar. Se o texto
// mascarado chegar a esse parseFloat:
//
//   Number.parseFloat("1.000,00")  ->  1
//
// Mil reais entram no banco como um real. Nao ha NaN, nao ha excecao, nao ha
// nada para um catch ver: a tela mostra o valor certo, a validacao aprova
// (1 > 0), e o saldo fecha errado.
//
// Por isso a maior parte deste arquivo afirma sobre o par
// (exibicao, valor) -- e principalmente sobre o VALOR, que e o lado invisivel.
// Um teste que so conferisse o texto mascarado passaria verde com o bug inteiro
// de pe.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_DIGITOS,
  MOEDAS,
  MOEDA_PADRAO,
  aoDigitarValor,
  formatarValor,
  moedaConhecida,
  moedaPorCodigo,
  valorNumerico,
  valorParaExibicao,
} from "../.tmp-dinheiro/dinheiro.js";

// ---------------------------------------------------------------------------
// O QUE A PESSOA VE ENQUANTO DIGITA
// ---------------------------------------------------------------------------
// A mascara e guiada por digitos: eles preenchem a partir dos centavos, que e
// como todo campo de dinheiro se comporta no Brasil.

test("os digitos preenchem a partir dos centavos", () => {
  assert.equal(aoDigitarValor("1").exibicao, "R$ 0,01");
  assert.equal(aoDigitarValor("12").exibicao, "R$ 0,12");
  assert.equal(aoDigitarValor("123").exibicao, "R$ 1,23");
  assert.equal(aoDigitarValor("1234").exibicao, "R$ 12,34");
  assert.equal(aoDigitarValor("12345").exibicao, "R$ 123,45");
  assert.equal(aoDigitarValor("123456").exibicao, "R$ 1.234,56");
});

test("o exemplo literal da issue sai exatamente como pedido", () => {
  // "R$1.000,00". O app escreve com espaco depois do simbolo, que e como o
  // resto das telas ja formata dinheiro -- o que a issue pede e o AGRUPAMENTO
  // de milhar com ponto e a virgula decimal.
  assert.equal(aoDigitarValor("100000").exibicao, "R$ 1.000,00");
  assert.equal(aoDigitarValor("100000").valor, "1000.00");
});

test("o agrupamento de milhar acerta em todo tamanho de numero", () => {
  // O erro classico e agrupar a partir do COMECO: ele acerta os numeros com
  // tamanho multiplo de 3 e erra todos os outros, entao um teste com um unico
  // exemplo passa verde na metade dos casos.
  assert.equal(aoDigitarValor("100000").exibicao, "R$ 1.000,00");
  assert.equal(aoDigitarValor("1000000").exibicao, "R$ 10.000,00");
  assert.equal(aoDigitarValor("10000000").exibicao, "R$ 100.000,00");
  assert.equal(aoDigitarValor("100000000").exibicao, "R$ 1.000.000,00");
  assert.equal(aoDigitarValor("1234567890").exibicao, "R$ 12.345.678,90");
});

test("digitar em cima do proprio texto mascarado nao acumula separador", () => {
  // Este e o caminho REAL: o input ja contem "R$ 1.234,56" e a pessoa tecla um
  // 7. O que chega na funcao e o texto inteiro com a tecla dentro.
  assert.equal(aoDigitarValor("R$ 1.234,567").exibicao, "R$ 12.345,67");
  assert.equal(aoDigitarValor("R$ 1.234,567").valor, "12345.67");
});

test("apagar de tras para frente devolve o valor anterior", () => {
  // Backspace em "R$ 1,50" deixa "R$ 1,5" no input cru.
  assert.equal(aoDigitarValor("R$ 1,5").exibicao, "R$ 0,15");
  assert.equal(aoDigitarValor("R$ 1,5").valor, "0.15");
});

test("campo vazio e vazio, nao zero", () => {
  // Mostrar "R$ 0,00" aqui tornaria impossivel limpar o campo, e faria o
  // `required` do HTML passar com nada digitado.
  assert.equal(aoDigitarValor("").exibicao, "");
  assert.equal(aoDigitarValor("").valor, "");
  assert.equal(aoDigitarValor("R$ ").valor, "");
  assert.equal(aoDigitarValor("R$").valor, "");
});

test("texto sem digito nenhum limpa o campo em vez de travar", () => {
  // Colar "mil reais" nao pode deixar o campo num estado que a validacao nao
  // sabe ler.
  assert.equal(aoDigitarValor("mil reais").valor, "");
  assert.equal(aoDigitarValor("abc").exibicao, "");
});

test("so zeros e campo vazio, e isso e o que desentala o backspace", () => {
  // Custo assumido: um valor exatamente ZERO nao e digitavel. Ele nao pode ser,
  // porque "R$ 0,00" e indistinguivel de "a pessoa apagou tudo" quando a unica
  // informacao disponivel e o texto em tela -- e tratar os dois como zero cria um
  // PONTO FIXO no backspace: apagar o ultimo caractere de "R$ 0,00" deixa
  // "R$ 0,0", que volta a ser "R$ 0,00". O campo fica impossivel de limpar, sem
  // erro nenhum, para sempre.
  //
  // Nenhum campo deste app quer zero: toda validacao pede "maior que zero", e
  // campo vazio e o estado que elas ja sabem recusar.
  assert.equal(aoDigitarValor("0").valor, "");
  assert.equal(aoDigitarValor("0").exibicao, "");
  assert.equal(aoDigitarValor("0000").valor, "");
  assert.equal(aoDigitarValor("R$ 0,00").valor, "");
});

test("zeros a esquerda nao sobrevivem", () => {
  assert.equal(aoDigitarValor("000123").exibicao, "R$ 1,23");
  assert.equal(aoDigitarValor("000123").valor, "1.23");
  assert.equal(aoDigitarValor("007").valor, "0.07");
});

// ---------------------------------------------------------------------------
// O VALOR, QUE E O LADO QUE ERRA DINHEIRO
// ---------------------------------------------------------------------------

test("o valor emitido e legivel por parseFloat, a mascara nao", () => {
  const entrada = aoDigitarValor("100000");

  // O que o formulario guarda:
  assert.equal(Number.parseFloat(entrada.valor), 1000);

  // O que aconteceria se a mascara fosse gravada no lugar dele. Esta asercao
  // existe para documentar o tamanho do estrago: nao e um erro, e mil virando
  // um.
  assert.equal(Number.parseFloat(entrada.exibicao.replace("R$ ", "")), 1);
});

test("o valor nunca carrega separador de milhar", () => {
  for (const digitos of ["1", "100", "100000", "123456789", "1".repeat(15)]) {
    const { valor } = aoDigitarValor(digitos);
    assert.ok(
      !valor.includes(","),
      `virgula vazou no valor de ${digitos}: ${valor}`
    );
    // Exatamente um ponto, o decimal.
    assert.equal(
      valor.split(".").length - 1,
      1,
      `mais de um ponto no valor de ${digitos}: ${valor}`
    );
    assert.ok(
      Number.isFinite(Number.parseFloat(valor)),
      `valor ilegivel para ${digitos}: ${valor}`
    );
  }
});

test("os centavos chegam exatos no valor", () => {
  // NAO confunda este teste com uma prova de que a montagem por string e
  // necessaria: trocar o corpo da funcao por `(Number(digitos)/100).toFixed(2)`
  // passa verde aqui, e passa verde de verdade -- dentro de `MAX_DIGITOS` as
  // duas formas concordam em todo caso. Ver o cabecalho de lib/dinheiro.ts para
  // por que a string fica mesmo assim. O que estas asercoes cobrem e o
  // resultado: os centavos que a pessoa digitou sao os centavos que o
  // formulario guarda.
  assert.equal(aoDigitarValor("7").valor, "0.07");
  assert.equal(aoDigitarValor("107").valor, "1.07");
  assert.equal(aoDigitarValor("2999").valor, "29.99");
  assert.equal(aoDigitarValor("1029").valor, "10.29");
});

test("o teto de digitos ignora a tecla extra em vez de cortar o numero", () => {
  const cheio = "1".repeat(MAX_DIGITOS);
  const demais = "1".repeat(MAX_DIGITOS + 5);

  // O mesmo valor: a tecla a mais nao fez nada. Cortar pelo FIM mudaria o
  // numero que a pessoa esta vendo enquanto digita.
  assert.equal(aoDigitarValor(demais).valor, aoDigitarValor(cheio).valor);

  // E o que caiu dentro do teto continua exato em ponto flutuante.
  assert.ok(Number.parseFloat(aoDigitarValor(cheio).valor) <= Number.MAX_SAFE_INTEGER);
});

// ---------------------------------------------------------------------------
// O SINAL
// ---------------------------------------------------------------------------

test("o campo de digitacao nunca aceita negativo", () => {
  // Isto conserta um perigo anterior a esta issue: o campo era `type="number"`
  // e aceitava "-30" numa tela de despesa. `valorGravado` aplica `-Math.abs`,
  // entao "-30" virava `-(-30) = +30` -- dinheiro ENTRANDO numa tela de saida, e
  // o saldo fechando errado para MAIS, que e o lado do qual ninguem reclama.
  assert.equal(aoDigitarValor("-3000").valor, "30.00");
  assert.equal(aoDigitarValor("-3000").exibicao, "R$ 30,00");
  assert.equal(aoDigitarValor("-").valor, "");
  assert.equal(aoDigitarValor("-").exibicao, "");
});

test("a exibicao de um valor gravado e o que o campo emitiria", () => {
  // Inclusive quando o gravado e negativo. O campo nao sabe emitir um menos,
  // entao ele nao pode MOSTRAR um menos: o texto em tela seria um estado que o
  // proprio campo destroi na primeira tecla, e a pessoa veria o sinal
  // desaparecer sem ter mexido nele.
  const exibido = valorParaExibicao("-30.00");
  assert.equal(exibido, "R$ 30,00");
  assert.equal(aoDigitarValor(exibido).valor, "30.00");
});

test("para LER um negativo existe formatarValor, que mantem o sinal", () => {
  // Engolir o menos de um saldo no vermelho seria mentir sobre o numero. A
  // divisao e: `valorParaExibicao` serve ao campo de digitacao,
  // `formatarValor` serve a leitura.
  assert.equal(formatarValor(-30), "-R$ 30,00");
});

// ---------------------------------------------------------------------------
// AS OUTRAS MOEDAS
// ---------------------------------------------------------------------------

test("cada moeda usa o seu simbolo", () => {
  assert.equal(aoDigitarValor("100000", "USD").exibicao, "US$ 1.000,00");
  assert.equal(aoDigitarValor("100000", "EUR").exibicao, "€ 1.000,00");
  assert.equal(aoDigitarValor("100000", "GBP").exibicao, "£ 1.000,00");
});

test("moeda sem centavos nao ganha centavos inventados", () => {
  // Iene nao tem subdivisao. Formatar "¥ 1.000,00" prometeria uma casa decimal
  // que a moeda nao possui -- e faria os digitos entrarem deslocados por 100.
  const entrada = aoDigitarValor("1000", "JPY");
  assert.equal(entrada.exibicao, "¥ 1.000");
  assert.equal(entrada.valor, "1000");
  assert.equal(Number.parseFloat(entrada.valor), 1000);

  // O mesmo numero de teclas em real vale cem vezes menos.
  assert.equal(aoDigitarValor("1000", "BRL").valor, "10.00");
});

test("codigo de moeda desconhecido cai no padrao em vez de quebrar a tela", () => {
  // `preferences` e um jsonb: uma mao humana, ou uma versao antiga do app, pode
  // deixar qualquer string ali. Uma tela de lancamento branca por causa disso
  // seria um estrago desproporcional.
  assert.equal(moedaPorCodigo("XYZ").codigo, MOEDA_PADRAO);
  assert.equal(moedaPorCodigo(null).codigo, MOEDA_PADRAO);
  assert.equal(moedaPorCodigo(undefined).codigo, MOEDA_PADRAO);
  assert.equal(moedaPorCodigo("").codigo, MOEDA_PADRAO);
  assert.equal(aoDigitarValor("100000", "XYZ").exibicao, "R$ 1.000,00");
});

test("o codigo e aceito em minusculas e com espaco", () => {
  assert.equal(moedaPorCodigo(" usd ").codigo, "USD");
  assert.equal(moedaConhecida("usd"), true);
  assert.equal(moedaConhecida("XYZ"), false);
  assert.equal(moedaConhecida(42), false);
  assert.equal(moedaConhecida(null), false);
});

test("o catalogo nao tem codigo repetido e todo codigo e ISO de 3 letras", () => {
  const codigos = MOEDAS.map((m) => m.codigo);
  assert.equal(new Set(codigos).size, codigos.length, "codigo repetido");
  for (const m of MOEDAS) {
    assert.match(m.codigo, /^[A-Z]{3}$/, `codigo fora do ISO: ${m.codigo}`);
    assert.ok(m.simbolo.length > 0, `moeda sem simbolo: ${m.codigo}`);
    assert.ok(m.nome.length > 0, `moeda sem nome: ${m.codigo}`);
    assert.ok(
      Number.isInteger(m.casas) && m.casas >= 0 && m.casas <= 4,
      `casas improvaveis em ${m.codigo}: ${m.casas}`
    );
  }
  assert.ok(codigos.includes(MOEDA_PADRAO), "o padrao nao esta no catalogo");
});

// ---------------------------------------------------------------------------
// A VOLTA: UM VALOR GRAVADO VOLTANDO PARA O CAMPO
// ---------------------------------------------------------------------------

test("o valor que veio do banco aparece mascarado igual ao digitado", () => {
  // Dois caminhos para o mesmo texto e como um deles fica diferente sem ninguem
  // notar. Esta asercao amarra os dois.
  assert.equal(valorParaExibicao("1000.00"), aoDigitarValor("100000").exibicao);
  assert.equal(valorParaExibicao("1000"), "R$ 1.000,00");
  assert.equal(valorParaExibicao(1000), "R$ 1.000,00");
  assert.equal(valorParaExibicao("0.07"), "R$ 0,07");
  assert.equal(valorParaExibicao("29.99"), "R$ 29,99");
});

test("a ida e a volta nao movem o valor", () => {
  for (const digitos of ["1", "7", "107", "2999", "100000", "123456789"]) {
    const { valor } = aoDigitarValor(digitos);
    const devolta = aoDigitarValor(valorParaExibicao(valor)).valor;
    assert.equal(devolta, valor, `${digitos} nao fechou o ciclo`);
  }
});

test("despesa gravada negativa volta positiva para o campo", () => {
  // A despesa e gravada NEGATIVA neste banco, e a tela de edicao mostra o valor
  // absoluto -- `valorGravado` reaplica o sinal na hora de salvar.
  assert.equal(valorParaExibicao("-30.00"), "R$ 30,00");
  assert.equal(valorParaExibicao(-1000), "R$ 1.000,00");
});

test("valor ausente ou ilegivel deixa o campo vazio, nao 'R$ NaN'", () => {
  assert.equal(valorParaExibicao(null), "");
  assert.equal(valorParaExibicao(undefined), "");
  assert.equal(valorParaExibicao(""), "");
  assert.equal(valorParaExibicao("abc"), "");
  assert.equal(valorParaExibicao(Number.NaN), "");
  assert.equal(valorParaExibicao(Number.POSITIVE_INFINITY), "");
});

test("valorNumerico devolve zero em vez de NaN", () => {
  // Quem soma nao pode receber NaN: uma parcela NaN contamina o total inteiro e
  // a tela mostra "R$ NaN" no lugar de um numero.
  assert.equal(valorNumerico("1000.00"), 1000);
  assert.equal(valorNumerico(""), 0);
  assert.equal(valorNumerico(null), 0);
  assert.equal(valorNumerico(undefined), 0);
  assert.equal(valorNumerico("abc"), 0);
});

// ---------------------------------------------------------------------------
// A FORMATACAO DE LEITURA
// ---------------------------------------------------------------------------

test("formatarValor escreve o menos antes do simbolo", () => {
  // "R$ -10,00" e o formato que todo leitor le duas vezes.
  assert.equal(formatarValor(-10), "-R$ 10,00");
  assert.equal(formatarValor(10), "R$ 10,00");
  assert.equal(formatarValor(0), "R$ 0,00");
  assert.equal(formatarValor(1234.5), "R$ 1.234,50");
});

test("formatarValor respeita as casas reais da moeda", () => {
  assert.equal(formatarValor(1000, "JPY"), "¥ 1.000");
  assert.equal(formatarValor(1000, "USD"), "US$ 1.000,00");
});

test("formatarValor nao usa espaco inquebravel", () => {
  // `Intl.NumberFormat` insere U+00A0 entre simbolo e numero. Ele e invisivel,
  // e um teste que compare "R$ 1,00" com a saida do Intl falha por um caractere
  // que ninguem ve no diff.
  // Escrito como escape: um U+00A0 literal neste arquivo seria indistinguivel
  // de um espaco normal para quem le o diff, e o teste passaria a nao testar
  // nada no dia em que alguem "normalizasse" o espaco.
  const INQUEBRAVEL = "\u00a0";
  for (const texto of [formatarValor(1), formatarValor(-1), formatarValor(1000)]) {
    assert.ok(!texto.includes(INQUEBRAVEL), `espaco inquebravel em ${texto}`);
  }

  // Controle positivo: o Intl POE o U+00A0. Sem ele, a asercao acima passaria
  // verde tambem no dia em que perdesse o alvo.
  const doIntl = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(1);
  assert.ok(doIntl.includes(INQUEBRAVEL), "o Intl mudou: o controle perdeu o alvo");
  assert.notEqual(formatarValor(1), doIntl);
});

// ---------------------------------------------------------------------------
// O CICLO DO CAMPO CONTROLADO
// ---------------------------------------------------------------------------
// `CampoDeValor` nao guarda estado proprio: a exibicao e DERIVADA do valor a
// cada render. Isso significa que digitar passa por
//
//   texto em tela -> aoDigitarValor -> valor -> valorParaExibicao -> texto em tela
//
// e que a volta tem que devolver exatamente o mesmo texto. Se ela nao devolver,
// o campo pisca entre dois formatos enquanto a pessoa digita -- ou pior, perde o
// digito recem-teclado. Nenhuma asercao das secoes acima ve isso: cada uma delas
// olha um lado do par, e as duas podem estar "certas" e nao se encaixarem.

/** Uma tecla no fim do campo, como o navegador entrega. */
function teclar(exibicaoAtual, tecla) {
  const { valor } = aoDigitarValor(exibicaoAtual + tecla);
  return { valor, exibicao: valorParaExibicao(valor) };
}

test("digitar tecla por tecla converge, sem perder digito", () => {
  let estado = { valor: "", exibicao: "" };
  const visto = [];

  for (const tecla of "100000") {
    estado = teclar(estado.exibicao, tecla);
    visto.push(estado.exibicao);
  }

  // O caminho inteiro, e nao so o fim: um passo intermediario errado significa
  // um numero errado piscando na tela de quem esta digitando.
  assert.deepEqual(visto, [
    "R$ 0,01",
    "R$ 0,10",
    "R$ 1,00",
    "R$ 10,00",
    "R$ 100,00",
    "R$ 1.000,00",
  ]);
  assert.equal(estado.valor, "1000.00");
});

test("a exibicao derivada do valor e identica a que a digitacao produziu", () => {
  // Esta e a propriedade de que o componente depende para nao guardar estado.
  for (const digitos of ["1", "7", "99", "107", "2999", "100000", "123456789"]) {
    const direto = aoDigitarValor(digitos);
    const derivado = valorParaExibicao(direto.valor);
    assert.equal(
      derivado,
      direto.exibicao,
      `o campo pularia entre dois formatos em ${digitos}`
    );
  }
});

test("apagar tecla por tecla chega ao campo vazio", () => {
  // O backspace tira o ultimo CARACTERE do texto em tela, que pode ser um
  // separador. Se o campo nao voltar ao vazio, fica um resto que a pessoa nao
  // consegue apagar.
  let exibicao = aoDigitarValor("100000").exibicao;
  let valor = "1000.00";

  for (let i = 0; i < 40 && exibicao !== ""; i++) {
    const cru = exibicao.slice(0, -1);
    valor = aoDigitarValor(cru).valor;
    exibicao = valorParaExibicao(valor);
  }

  assert.equal(exibicao, "", "sobrou texto que o backspace nao apaga");
  assert.equal(valor, "", "sobrou valor depois de apagar tudo");
});

test("teclar um menos nao muda nada, nem em tela nem no valor", () => {
  // O campo nao sabe emitir negativo, entao o menos e simplesmente inerte --
  // e nao um sinal que aparece e some. Ver o cabecalho de `aoDigitarValor`.
  let estado = teclar("", "-");
  assert.deepEqual(estado, { valor: "", exibicao: "" });

  for (const tecla of "3000") estado = teclar(estado.exibicao, tecla);
  assert.equal(estado.exibicao, "R$ 30,00");

  // E um menos teclado DEPOIS tambem nao inverte nada.
  assert.deepEqual(teclar(estado.exibicao, "-"), {
    valor: "30.00",
    exibicao: "R$ 30,00",
  });
});
