#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DAS CALCULADORAS
// =====================================================
//   npm run test:calculadoras
//
// Exercita lib/calculadoras.ts. Mesmo desenho do test-settlement.mjs: .mjs
// rodando o JS que o tsc (ja dependencia) emitiu, sem runner de teste novo.
//
// -----------------------------------------------------------------------
// O que estes testes existem para pegar
// -----------------------------------------------------------------------
// Calculadora de folha nao quebra: ela devolve um numero plausivel e errado.
// Nao ha excecao, nao ha 500, nao ha tela vazia. O usuario leva o numero para
// uma conversa com o RH e descobre la.
//
// Por isso quase todo caso abaixo e um NUMERO ESPERADO, digitado a mao a
// partir da tabela oficial ou de exemplo publicado -- e nao o que o codigo
// devolveu. Um teste escrito rodando a funcao e colando a saida prova apenas
// que a funcao continua fazendo o que faz, inclusive se o que ela faz estiver
// errado desde o primeiro dia.
//
// Os quatro erros de maior valor em dinheiro, cada um com teste proprio:
//   - INSS com aliquota cheia em vez de progressiva (R$ 198,49/mes a mais);
//   - INSS sem teto (R$ 1.613/mes a mais em salario alto);
//   - IRRF sem o redutor da Lei 15.270/2025 (cobra R$ 312,89 de quem e isento);
//   - taxa anual convertida por divisao (12% a.a. virando 12,68%).
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  arredondar,
  calcularINSS,
  calcularIRRF,
  calcularDecimoTerceiro,
  calcularFerias,
  calcularFGTS,
  calcularJurosCompostos,
  taxaMensalEquivalente,
  INSS_2026,
  IRRF_2026,
  REDUTOR_IRRF_2026,
} = await import("../.tmp-calculadoras/calculadoras.js");

/**
 * Compara dinheiro com tolerancia de um centavo.
 *
 * O `+ 1e-9` nao e folga: sem ele, |195,08 - 195,07| avalia como
 * 0,010000000000019 em ponto flutuante e a comparacao com 0,01 falha em cima
 * da fronteira exata -- um teste vermelho que nao tem defeito por tras.
 */
function perto(recebido, esperado, mensagem) {
  assert.ok(
    Math.abs(recebido - esperado) <= 0.01 + 1e-9,
    `${mensagem}: esperado ~${esperado}, recebido ${recebido}`,
  );
}

// ===========================================================================
// ARREDONDAMENTO
// ===========================================================================

test("arredondar nao perde meio centavo por representacao binaria", () => {
  // Math.round(1.005 * 100) / 100 devolve 1 -- o double mais proximo de 1,005
  // e 1,00499999999999989. Dinheiro sumindo por binario e o defeito que
  // ninguem encontra olhando o resultado.
  assert.equal(arredondar(1.005), 1.01);
  assert.equal(arredondar(2.675), 2.68);
  assert.equal(arredondar(8.615), 8.62);
});

test("arredondar preserva o zero e o negativo", () => {
  assert.equal(arredondar(0), 0);
  assert.equal(arredondar(-1.005), -1.01);
});

// ===========================================================================
// INSS
// ===========================================================================

test("INSS de R$ 5.000 e progressivo, nao 14% sobre o total", () => {
  const r = calcularINSS(5000);
  // 1.621,00 x 7,5% + 1.281,84 x 9% + 1.451,43 x 12% + 645,73 x 14%
  perto(r.contribuicao, 501.51, "INSS de 5.000");
  // O erro que este teste existe para pegar: 5.000 x 14% = 700.
  assert.notEqual(r.contribuicao, 700);
  assert.equal(r.tetoAtingido, false);
});

test("INSS do salario minimo fica na primeira faixa", () => {
  // 1.621,00 x 7,5% = 121,575
  perto(calcularINSS(1621).contribuicao, 121.58, "INSS do minimo");
});

test("INSS para no teto: quem ganha R$ 20.000 paga o mesmo de quem ganha R$ 8.475,55", () => {
  const noTeto = calcularINSS(INSS_2026.teto);
  const acima = calcularINSS(20000);
  // R$ 988,09 e o desconto maximo publicado para 2026.
  perto(noTeto.contribuicao, 988.09, "INSS no teto");
  assert.equal(acima.contribuicao, noTeto.contribuicao);
  assert.equal(acima.tetoAtingido, true);
  // Sem teto seriam 20.000 x 14% - 198,49 = R$ 2.601,51.
  assert.ok(acima.contribuicao < 1000);
});

test("a soma por faixa bate com a parcela a deduzir publicada", () => {
  // Duas contas independentes. A parcela publicada vem arredondada em duas
  // casas, entao a tolerancia e de um centavo -- mas o erro que importa (14%
  // cheio) desviaria R$ 198,49, nao um centavo.
  for (const salario of [900, 1621, 1800, 2902.84, 3000, 4354.27, 5000, 7000, 8475.55]) {
    const faixa = INSS_2026.faixas.find((f) => salario <= f.ate) ?? INSS_2026.faixas[3];
    const atalho = salario * faixa.aliquota - faixa.deduzir;
    perto(calcularINSS(salario).contribuicao, atalho, `INSS de ${salario} pelo atalho`);
  }
});

test("o detalhamento por faixa soma exatamente o total exibido", () => {
  // Quem le a tela soma as linhas. Detalhamento que nao fecha com o proprio
  // total destroi a confianca no numero inteiro.
  for (const salario of [1500, 2666.67, 5000, 6666.67, 9000]) {
    const r = calcularINSS(salario);
    const soma = arredondar(r.porFaixa.reduce((acc, f) => acc + f.parcela, 0));
    assert.equal(soma, r.contribuicao, `detalhamento de ${salario} nao fecha`);
  }
});

test("INSS de renda zero ou negativa nao gera contribuicao nem divisao por zero", () => {
  assert.equal(calcularINSS(0).contribuicao, 0);
  assert.equal(calcularINSS(0).aliquotaEfetiva, 0);
  assert.equal(calcularINSS(-500).contribuicao, 0);
});

// ===========================================================================
// IRRF
// ===========================================================================

test("quem ganha R$ 5.000 e isento -- este e o ponto inteiro da Lei 15.270/2025", () => {
  const inss = calcularINSS(5000).contribuicao;
  const r = calcularIRRF({ rendimento: 5000, inss });

  // Reproduz o exemplo oficial: base 4.392,80 (5.000 menos o desconto
  // simplificado de 607,20), imposto de tabela 312,89, redutor 312,90.
  assert.equal(r.deducaoAplicada, "simplificado");
  perto(r.valorDeducao, 607.2, "deducao");
  perto(r.base, 4392.8, "base de calculo");
  perto(r.impostoTabela, 312.89, "imposto pela tabela");
  perto(r.redutor, 312.9, "redutor");
  assert.equal(r.imposto, 0);
  assert.equal(r.isentoPelaLei15270, true);
});

test("a isencao vale na faixa inteira ate R$ 5.000, nao so no valor redondo", () => {
  // A margem em R$ 5.000 e de MEIO CENTAVO (imposto 312,89 contra redutor
  // 312,895). Qualquer revisao futura da tabela que mexa nas faixas sem mexer
  // no redutor quebra a isencao -- e quebraria primeiro perto do topo da
  // faixa, que e onde ninguem testa. Por isso varre de R$ 100 em R$ 100 e
  // fecha nos ultimos reais.
  for (let salario = 100; salario <= 5000; salario += 100) {
    const inss = calcularINSS(salario).contribuicao;
    const r = calcularIRRF({ rendimento: salario, inss });
    assert.equal(r.imposto, 0, `deveria ser isento em R$ ${salario}, veio ${r.imposto}`);
  }
  for (const salario of [4990, 4995, 4999, 4999.99, 5000]) {
    const inss = calcularINSS(salario).contribuicao;
    assert.equal(calcularIRRF({ rendimento: salario, inss }).imposto, 0, `R$ ${salario}`);
  }
});

test("sem o redutor, quem e isento pagaria R$ 312,89 -- controle negativo", () => {
  // Prova que o redutor esta fazendo trabalho de verdade. Se a tabela sozinha
  // ja devolvesse zero, o teste acima passaria sem o redutor existir.
  const inss = calcularINSS(5000).contribuicao;
  const r = calcularIRRF({ rendimento: 5000, inss });
  assert.ok(r.impostoTabela > 300, "a tabela progressiva TEM que cobrar aqui");
  assert.equal(r.impostoTabela - r.redutor < 0.01, true);
});

test("o redutor zera exatamente em R$ 7.350 e nao cria degrau", () => {
  const cru = REDUTOR_IRRF_2026.constante - REDUTOR_IRRF_2026.coeficiente * REDUTOR_IRRF_2026.limite;
  assert.ok(Math.abs(cru) < 0.01, `o redutor deveria zerar no limite, deu ${cru}`);

  const antes = calcularIRRF({ rendimento: 7350, inss: calcularINSS(7350).contribuicao });
  const depois = calcularIRRF({ rendimento: 7351, inss: calcularINSS(7351).contribuicao });
  perto(antes.imposto, 884.13, "IRRF em 7.350");
  assert.equal(depois.redutor, 0);
  // Ganhar R$ 1 a mais nao pode custar mais de R$ 1 de imposto.
  assert.ok(depois.imposto - antes.imposto < 1, "degrau na fronteira do redutor");
});

test("o redutor incide sobre o rendimento bruto, nao sobre a base de calculo", () => {
  // Trocar um pelo outro continua devolvendo zero para quem e isento -- o
  // teste obvio passa -- e cobra a MENOS de quem esta entre 5.000 e 7.350.
  const rendimento = 6000;
  const inss = calcularINSS(rendimento).contribuicao;
  const r = calcularIRRF({ rendimento, inss });

  const esperado = arredondar(
    REDUTOR_IRRF_2026.constante - REDUTOR_IRRF_2026.coeficiente * rendimento,
  );
  perto(r.redutor, esperado, "redutor sobre o bruto");

  const sobreABase = REDUTOR_IRRF_2026.constante - REDUTOR_IRRF_2026.coeficiente * r.base;
  assert.ok(Math.abs(r.redutor - sobreABase) > 1, "o teste nao distingue os dois modos");
});

test("acima de R$ 7.350 vale a tabela cheia, sem reducao", () => {
  const r = calcularIRRF({ rendimento: 10000, inss: calcularINSS(10000).contribuicao });
  assert.equal(r.redutor, 0);
  // INSS no teto (988,09) > desconto simplificado, entao prevalece o legal.
  assert.equal(r.deducaoAplicada, "legal");
  perto(r.base, 9011.91, "base");
  perto(r.imposto, 1569.55, "IRRF de 10.000"); // 9.011,91 x 27,5% - 908,73
});

test("prevalece a deducao mais vantajosa entre a legal e a simplificada", () => {
  // Salario baixo: o INSS e pequeno, o simplificado ganha.
  const baixo = calcularIRRF({ rendimento: 3000, inss: calcularINSS(3000).contribuicao });
  assert.equal(baixo.deducaoAplicada, "simplificado");

  // Salario alto: o INSS sozinho ja passa dos 607,20.
  const alto = calcularIRRF({ rendimento: 9000, inss: calcularINSS(9000).contribuicao });
  assert.equal(alto.deducaoAplicada, "legal");

  // Com dependentes suficientes, a legal volta a ganhar mesmo em salario medio.
  const comDependentes = calcularIRRF({
    rendimento: 5500,
    inss: calcularINSS(5500).contribuicao,
    dependentes: 3,
  });
  assert.equal(comDependentes.deducaoAplicada, "legal");
  perto(
    comDependentes.valorDeducao,
    calcularINSS(5500).contribuicao + 3 * IRRF_2026.deducaoPorDependente,
    "deducao legal com 3 dependentes",
  );
});

test("dependente reduz o imposto, nunca aumenta", () => {
  const inss = calcularINSS(8000).contribuicao;
  const sem = calcularIRRF({ rendimento: 8000, inss }).imposto;
  const com = calcularIRRF({ rendimento: 8000, inss, dependentes: 2 }).imposto;
  assert.ok(com < sem, "dependente tem que baixar o IRRF");
  // 2 x 189,59 = 379,18 de base a menos, a 27,5% = 104,27 de imposto a menos.
  perto(sem - com, 104.27, "efeito de 2 dependentes");
});

test("imposto nunca fica negativo", () => {
  for (const rendimento of [0, 500, 1500, 2428.8, 3000, 5000, 5200]) {
    const r = calcularIRRF({ rendimento, inss: calcularINSS(rendimento).contribuicao });
    assert.ok(r.imposto >= 0, `imposto negativo em ${rendimento}`);
  }
});

// ===========================================================================
// 13o SALARIO
// ===========================================================================

test("a 1a parcela do 13o sai sem desconto nenhum", () => {
  // A regra que se erra: dividir INSS e IRRF entre as duas parcelas da o mesmo
  // total anual e faz o usuario planejar dezembro com centenas de reais a
  // mais do que vai receber. O total bate; a data nao.
  const r = calcularDecimoTerceiro({ salarioBruto: 5000 });
  assert.equal(r.primeiraParcela, 2500);
  perto(r.bruto, 5000, "13o bruto");
});

test("todo o INSS e o IRRF do 13o caem na 2a parcela", () => {
  const r = calcularDecimoTerceiro({ salarioBruto: 5000 });
  perto(r.inss.contribuicao, 501.51, "INSS do 13o");
  assert.equal(r.irrf.imposto, 0, "13o de 5.000 tambem entra na isencao");
  perto(r.liquido, 4498.49, "13o liquido");
  perto(r.segundaParcela, 1998.49, "2a parcela");
  perto(r.primeiraParcela + r.segundaParcela, r.liquido, "as duas parcelas somam o liquido");
});

test("o 13o proporcional conta avos, nao meses cheios de salario", () => {
  const r = calcularDecimoTerceiro({ salarioBruto: 6000, mesesTrabalhados: 7 });
  assert.equal(r.avos, 7);
  perto(r.bruto, 3500, "7/12 de 6.000"); // 6.000 / 12 x 7
});

test("o 13o nao passa de 12 avos nem fica negativo", () => {
  assert.equal(calcularDecimoTerceiro({ salarioBruto: 3000, mesesTrabalhados: 18 }).avos, 12);
  assert.equal(calcularDecimoTerceiro({ salarioBruto: 3000, mesesTrabalhados: -2 }).avos, 0);
  assert.equal(calcularDecimoTerceiro({ salarioBruto: 3000, mesesTrabalhados: 0 }).bruto, 0);
});

test("o 13o e tributado isolado: 2 x 5.000 nao vira a faixa de 10.000", () => {
  // Tributacao exclusiva na fonte. Somar o 13o ao salario do mes empurraria o
  // usuario para a faixa de 27,5% e cobraria imposto de quem e isento nas
  // duas pontas.
  const decimo = calcularDecimoTerceiro({ salarioBruto: 5000 });
  const salarioDoMes = calcularIRRF({ rendimento: 5000, inss: calcularINSS(5000).contribuicao });
  assert.equal(decimo.irrf.imposto, 0);
  assert.equal(salarioDoMes.imposto, 0);

  const seSomasse = calcularIRRF({ rendimento: 10000, inss: calcularINSS(10000).contribuicao });
  assert.ok(seSomasse.imposto > 1000, "o teste nao distingue somar de isolar");
});

test("adiantamento informado maior que o devido devolve 2a parcela negativa", () => {
  // Nao se esconde em zero: e o que de fato acontece com o usuario, e a tela
  // precisa poder dizer que ele tem valor a devolver.
  const r = calcularDecimoTerceiro({ salarioBruto: 5000, adiantamentoRecebido: 4800 });
  assert.ok(r.segundaParcela < 0, "deveria acusar saldo negativo");
});

// ===========================================================================
// FERIAS
// ===========================================================================

test("ferias de 30 dias sao salario + 1/3", () => {
  const r = calcularFerias({ salarioBruto: 5000 });
  perto(r.feriasBruto, 5000, "ferias");
  perto(r.tercoConstitucional, 1666.67, "1/3 constitucional");
  perto(r.totalBruto, 6666.67, "bruto total");
});

test("o 1/3 constitucional ENTRA na base do INSS e do IRRF", () => {
  // Tema 985 do STF (2020): o terco de ferias sofre contribuicao. Tirar ele da
  // base parece generoso e devolve um liquido que o contracheque nao confirma.
  const r = calcularFerias({ salarioBruto: 5000 });
  perto(r.baseTributavel, 6666.67, "base tributavel inclui o 1/3");
  perto(r.inss.contribuicao, 734.84, "INSS sobre ferias + 1/3");

  const semOTerco = calcularINSS(5000).contribuicao;
  assert.ok(r.inss.contribuicao > semOTerco, "o 1/3 ficou de fora da base");
});

test("o abono pecuniario e o 1/3 dele NAO sao tributados", () => {
  // Sao indenizacao, nao remuneracao. Jogar o abono na base cobra INSS e IRRF
  // de dinheiro isento e faz vender ferias parecer mau negocio -- o erro muda
  // a decisao do usuario, nao so o numero.
  const salario = 3000;
  const comAbono = calcularFerias({ salarioBruto: salario, diasFerias: 20, diasAbono: 10 });

  perto(comAbono.abonoBruto, 1000, "abono de 10 dias");
  perto(comAbono.tercoAbono, 333.33, "1/3 do abono");
  // Base = 20 dias (2.000) + 1/3 (666,67). O abono e seu terco ficam fora.
  perto(comAbono.baseTributavel, 2666.67, "base sem o abono");

  // Controle: mesma base tributavel de quem tirou 20 dias e nao vendeu nada.
  const semAbono = calcularFerias({ salarioBruto: salario, diasFerias: 20 });
  assert.equal(comAbono.baseTributavel, semAbono.baseTributavel);
  assert.equal(comAbono.inss.contribuicao, semAbono.inss.contribuicao);
  // E ainda assim recebe R$ 1.333,33 a mais na mao.
  perto(comAbono.liquido - semAbono.liquido, 1333.33, "o abono entra inteiro no liquido");
});

test("vender ferias sempre aumenta o valor recebido", () => {
  // Se o abono fosse tributado por engano, esta comparacao inverteria em
  // algum salario -- e o app estaria desaconselhando algo vantajoso.
  for (const salario of [1621, 3000, 5000, 9000, 15000]) {
    const vendendo = calcularFerias({ salarioBruto: salario, diasFerias: 20, diasAbono: 10 });
    const inteiras = calcularFerias({ salarioBruto: salario, diasFerias: 30 });
    assert.ok(
      vendendo.liquido > inteiras.liquido,
      `vender ferias saiu pior em R$ ${salario}: ${vendendo.liquido} vs ${inteiras.liquido}`,
    );
  }
});

test("o abono e limitado a 10 dias e o total a 30, com aviso", () => {
  const demais = calcularFerias({ salarioBruto: 3000, diasFerias: 30, diasAbono: 20 });
  perto(demais.abonoBruto, 1000, "abono cortado em 10 dias");
  assert.equal(demais.avisos.length, 2, "os dois ajustes precisam aparecer na tela");
  perto(demais.feriasBruto, 2000, "descanso ajustado para 20 dias");
});

test("o adiantamento do 13o entra no bruto mas fica fora da base tributavel", () => {
  // Ele e tributado no proprio 13o, em dezembro. Tributar aqui cobraria duas
  // vezes pelo mesmo dinheiro.
  const com = calcularFerias({ salarioBruto: 5000, adiantarDecimoTerceiro: true });
  const sem = calcularFerias({ salarioBruto: 5000 });

  perto(com.adiantamentoDecimo, 2500, "metade do 13o");
  assert.equal(com.baseTributavel, sem.baseTributavel);
  assert.equal(com.inss.contribuicao, sem.inss.contribuicao);
  perto(com.liquido - sem.liquido, 2500, "o adiantamento entra inteiro no liquido");
});

test("ferias proporcionais: 10 dias custam um terco de 30 dias", () => {
  const r = calcularFerias({ salarioBruto: 3000, diasFerias: 10 });
  perto(r.feriasBruto, 1000, "10/30 de 3.000");
  perto(r.tercoConstitucional, 333.33, "1/3");
});

// ===========================================================================
// FGTS
// ===========================================================================

test("o deposito mensal e 8% do bruto", () => {
  assert.equal(calcularFGTS({ salarioBruto: 3000, mesesTrabalhados: 1 }).depositoMensal, 240);
});

test("o 13o gera um deposito extra por ano", () => {
  const com = calcularFGTS({ salarioBruto: 3000, mesesTrabalhados: 12, jurosAnuais: 0 });
  const sem = calcularFGTS({
    salarioBruto: 3000,
    mesesTrabalhados: 12,
    incluirDecimoTerceiro: false,
    jurosAnuais: 0,
  });
  perto(sem.totalDepositado, 2880, "12 x 240");
  perto(com.totalDepositado, 3120, "13 x 240");
});

test("a multa rescisoria segue o motivo da saida", () => {
  const base = { salarioBruto: 3000, mesesTrabalhados: 24, jurosAnuais: 0 };
  const semJustaCausa = calcularFGTS({ ...base, motivoSaida: "SEM_JUSTA_CAUSA" });
  const acordo = calcularFGTS({ ...base, motivoSaida: "ACORDO" });
  const pedido = calcularFGTS({ ...base, motivoSaida: "PEDIDO_DEMISSAO" });

  perto(semJustaCausa.multa, arredondar(semJustaCausa.saldoFinal * 0.4), "multa de 40%");
  perto(acordo.multa, arredondar(acordo.saldoFinal * 0.2), "acordo: metade da multa");
  assert.equal(pedido.multa, 0, "pedido de demissao nao gera multa");
  assert.equal(calcularFGTS({ ...base, motivoSaida: "JUSTA_CAUSA" }).multa, 0);

  // E o saldo em si e o mesmo nos quatro casos -- so a multa muda.
  assert.equal(acordo.saldoFinal, semJustaCausa.saldoFinal);
});

test("os juros de 3% ao ano sao creditados mes a mes", () => {
  // 0,25% ao mes, nao 3% de uma vez no fim do ano. Sao coisas diferentes e a
  // segunda subestima o saldo.
  const r = calcularFGTS({
    salarioBruto: 1000,
    mesesTrabalhados: 12,
    saldoInicial: 10000,
    incluirDecimoTerceiro: false,
  });
  // O saldo inicial sozinho renderia 10.000 x 1,0025^12 = 10.304,16.
  assert.ok(r.rendimento > 300, `rendimento baixo demais: ${r.rendimento}`);
  assert.ok(r.rendimento < 320, `rendimento alto demais: ${r.rendimento}`);
  perto(r.totalDepositado, 960, "12 x 80");
});

test("saldo final = inicial + depositos + rendimento, sem sobra", () => {
  const r = calcularFGTS({ salarioBruto: 4500, mesesTrabalhados: 36, saldoInicial: 2000 });
  perto(r.saldoFinal, 2000 + r.totalDepositado + r.rendimento, "conta do saldo nao fecha");
  perto(r.totalRescisao, r.saldoFinal + r.multa, "conta da rescisao nao fecha");
  assert.equal(r.evolucao.length, 36);
  assert.equal(r.evolucao[35].saldo, r.saldoFinal);
});

test("zero mes trabalhado nao inventa saldo", () => {
  const r = calcularFGTS({ salarioBruto: 5000, mesesTrabalhados: 0 });
  assert.equal(r.saldoFinal, 0);
  assert.equal(r.totalDepositado, 0);
  assert.equal(r.evolucao.length, 0);
});

// ===========================================================================
// JUROS COMPOSTOS
// ===========================================================================

test("taxa anual vira mensal por raiz decima segunda, nunca por divisao", () => {
  const mensal = taxaMensalEquivalente(12, "ANUAL");
  // 12% a.a. equivalem a 0,9489% a.m. -- nao a 1%.
  perto(mensal * 100, 0.9489, "taxa mensal equivalente a 12% a.a.");
  assert.notEqual(arredondar(mensal * 100, 4), 1);

  // E a volta tem que fechar: 12 meses da taxa equivalente reconstroem o ano.
  perto((1 + mensal) ** 12, 1.12, "a taxa equivalente nao reconstroi o ano");
});

test("dividir por 12 inflaria o montante -- controle negativo", () => {
  const certo = calcularJurosCompostos({
    valorInicial: 1000,
    taxa: 12,
    unidadeTaxa: "ANUAL",
    meses: 360,
  });
  const errado = calcularJurosCompostos({
    valorInicial: 1000,
    taxa: 1,
    unidadeTaxa: "MENSAL",
    meses: 360,
  });
  // 30 anos: R$ 29.960 contra R$ 35.950. As duas curvas sobem igualmente
  // bonitas no grafico, e so uma delas e verdade.
  perto(certo.montante, 29959.92, "12% a.a. por 30 anos");
  assert.ok(errado.montante / certo.montante > 1.19, "o teste nao separa os dois modos");
});

test("taxa mensal informada como mensal e usada como esta", () => {
  const r = calcularJurosCompostos({
    valorInicial: 1000,
    taxa: 1,
    unidadeTaxa: "MENSAL",
    meses: 12,
  });
  perto(r.montante, 1126.83, "1% a.m. por 12 meses"); // 1000 x 1,01^12
  perto(r.jurosGanhos, 126.83, "juros");
  assert.equal(r.totalInvestido, 1000);
});

test("aporte mensal entra no fim do mes (serie postecipada)", () => {
  // 1,01^12 = 1,1268250301. Entao:
  //   1000 x 1,1268250301                      = 1.126,82503
  //   100 x ((1,1268250301 - 1) / 0,01)        = 1.268,25030
  //                                    montante = 2.395,07533 -> 2.395,08
  const r = calcularJurosCompostos({
    valorInicial: 1000,
    aporteMensal: 100,
    taxa: 1,
    unidadeTaxa: "MENSAL",
    meses: 12,
  });
  perto(r.montante, 2395.08, "montante com aporte");
  assert.equal(r.totalInvestido, 2200);
  perto(r.jurosGanhos, 195.08, "juros com aporte");

  // Se o aporte entrasse no INICIO do mes, renderia um mes a mais cada um:
  // 2.395,08 x 1,01 = 2.419,03. A diferenca e pequena em 12 meses e grande em
  // 30 anos, entao a convencao precisa estar presa.
  assert.ok(r.montante < 2410, "o aporte esta rendendo um mes a mais");
});

test("taxa zero soma os aportes sem inventar rendimento", () => {
  const r = calcularJurosCompostos({
    valorInicial: 500,
    aporteMensal: 100,
    taxa: 0,
    meses: 10,
  });
  assert.equal(r.montante, 1500);
  assert.equal(r.jurosGanhos, 0);
});

test("zero mes devolve o valor inicial intacto", () => {
  const r = calcularJurosCompostos({ valorInicial: 777, aporteMensal: 100, taxa: 10, meses: 0 });
  assert.equal(r.montante, 777);
  assert.equal(r.totalInvestido, 777);
  assert.equal(r.jurosGanhos, 0);
  assert.equal(r.evolucao.length, 0);
});

test("a evolucao fecha com o resultado e nao perde mes", () => {
  const r = calcularJurosCompostos({
    valorInicial: 1000,
    aporteMensal: 250,
    taxa: 9,
    unidadeTaxa: "ANUAL",
    meses: 120,
  });
  assert.equal(r.evolucao.length, 120);
  assert.equal(r.evolucao[0].mes, 1);
  assert.equal(r.evolucao[119].montante, r.montante);
  assert.equal(r.evolucao[119].investido, r.totalInvestido);
  // investido + juros = montante, mes a mes.
  for (const ponto of r.evolucao) {
    perto(ponto.investido + ponto.juros, ponto.montante, `mes ${ponto.mes} nao fecha`);
  }
});

test("juros compostos nao aceita entrada negativa como rendimento", () => {
  const r = calcularJurosCompostos({ valorInicial: -1000, aporteMensal: -50, taxa: 10, meses: 12 });
  assert.equal(r.montante, 0);
  assert.equal(r.totalInvestido, 0);
});
