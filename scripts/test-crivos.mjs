#!/usr/bin/env node
// =====================================================
// PULODOGATO - os crivos de fundamento, como LISTA DE CRITERIOS (HMO-195)
// =====================================================
//   npm run test:crivos
//
// POR QUE ESTA SUITE RENDERIZA O COMPONENTE
// -----------------------------------------
// A aritmetica de lib/crivos.ts e trivial -- uma comparacao. O que engana nesta
// entrega mora na MARCACAO e no TEXTO, e nada disso quebra build:
//
//   * tres estados impressos com o mesmo rotulo (ou "sem dado" pintado com a cor
//     de reprovado) desfazem no olho o terceiro estado que o resto do codigo
//     mantem;
//   * ativo fora dos crivos com a lista VAZIA em vez da frase -- vazio se le
//     como "ainda carregando" ou como zero, e zero num crivo de divida APROVA;
//   * uma frase de conveniencia acrescentada depois ("3 de 3, boa hora de
//     comprar") transforma a ferramenta em recomendacao de investimento sem
//     mudar numero nenhum.
//
// AS FIXTURES SAO DADO CONFERIDO, NAO NUMERO BONITO
// -------------------------------------------------
// PETR4, VALE3 e RANI3 saem dos valores que `test-fundamento-cvm` conferiu
// contra o arquivo da CVM (lucro liquido, patrimonio, divida liquida). O ROE da
// PETR4 -- 26,49% -- e o teste da armadilha 1: e o unico numero em que a versao
// SEM conversao de unidade responde diferente da certa.
//
// As linhas de exercicio anterior sao sinteticas de proposito, e estao marcadas
// como tal: elas existem para que escolher o ano errado MUDE o veredito, e nao
// so o rotulo da data.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CHAVE_DE_CRIVOS,
  CRIVOS,
  CRIVOS_PENDENTES,
  EXPLICACAO_FORA_DOS_CRIVOS,
  FONTE_DECLARADA,
  ROTULO_DO_ESTADO,
  VOCABULARIO_PROIBIDO,
  avaliarCrivo,
  daViewParaUnidade,
  formatarDataBase,
  formatarLimite,
  formatarLimiteParaCampo,
  formatarValorDoCrivo,
  lerLimiteDigitado,
  lerLimites,
  limitesEfetivos,
  limitesPadrao,
  mesclarLimites,
  montarCrivosDaCarteira,
  montarCrivosDoAtivo,
  numeroOuNulo,
  textosIniciais,
  ultimoExercicioPorTicker,
  validarLimites,
  vocabularioDeRecomendacao,
} from "../.tmp-crivos/lib/crivos.js";

import {
  BlocoDoAtivo,
  CrivosDeFundamento,
} from "../.tmp-crivos/components/investments/CrivosDeFundamento.js";

const RAIZ = join(fileURLToPath(new URL(".", import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Os quocientes conferidos no arquivo da CVM. Ver test-fundamento-cvm.mjs. */
const PETR4_2025 = {
  ticker: "PETR4",
  denominacao: "PETROLEO BRASILEIRO S.A. PETROBRAS",
  ano_exercicio: 2025,
  data_base: "2025-12-31",
  // 110.605 bi de lucro / 417.587 bi de patrimonio = 26,49%
  roe: String(110.605 / 417.587),
  // 110.605 / 497.55 bi de receita. O arquivo fecha em 22,23%.
  margem_liquida: "0.2223",
  // 333.417 bi de divida liquida / 417.587 bi de patrimonio = 0,80x
  divida_liquida_sobre_patrimonio: String(333.417 / 417.587),
};

/**
 * SINTETICA. Existe para que escolher o exercicio errado mude o VEREDITO: com
 * ROE de 10% a PETR4 nao bate o criterio de 15%, e o erro aparece no selo em vez
 * de so na data-base -- que ninguem confere.
 */
const PETR4_2024 = {
  ...PETR4_2025,
  ano_exercicio: 2024,
  data_base: "2024-12-31",
  roe: "0.10",
  margem_liquida: "0.05",
};

/** 11.811 bi / 188.926 bi = 6,25%. Conferido. */
const VALE3_2024 = {
  ticker: "VALE3",
  denominacao: "VALE S.A.",
  ano_exercicio: 2024,
  data_base: "2024-12-31",
  roe: String(11.811 / 188.926),
  margem_liquida: "0.1500",
  divida_liquida_sobre_patrimonio: "0.2500",
};

/** 0.242 bi / 1.452 bi = 16,67%. Conferido. */
const RANI3_2025 = {
  ticker: "RANI3",
  denominacao: "IRANI PAPEL E EMBALAGEM S.A.",
  ano_exercicio: 2025,
  data_base: "2025-12-31",
  roe: String(0.242 / 1.452),
  margem_liquida: "0.1100",
  divida_liquida_sobre_patrimonio: "0.9000",
};

/**
 * Patrimonio negativo: a view devolve NULL em `roe` e em alavancagem de
 * proposito -- -50 de prejuizo sobre -100 de patrimonio daria "ROE de 50%".
 * Margem liquida continua legivel, porque ela nao divide por patrimonio.
 */
const AZUL4_2025 = {
  ticker: "AZUL4",
  denominacao: "AZUL S.A.",
  ano_exercicio: 2025,
  data_base: "2025-12-31",
  roe: null,
  margem_liquida: "0.1800",
  divida_liquida_sobre_patrimonio: null,
};

const ativo = (symbol, type = "stock", nome = symbol) => ({
  id: `id-${symbol}`,
  symbol,
  name: nome,
  type,
});

const PADRAO = limitesPadrao();

/** O HTML sem tag nenhuma, com os espacos normalizados. */
const texto = (html) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;| /g, " ")
    .replace(/&#x27;|&quot;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** Quantas vezes `agulha` aparece. Contar e o que permite NEGAR um estado. */
const conta = (t, agulha) => t.split(agulha).length - 1;

const renderCarteira = (props) =>
  renderToStaticMarkup(
    h(CrivosDeFundamento, {
      dados: {
        ativos: [ativo("PETR4")],
        indicadores: [PETR4_2025],
        limites: PADRAO,
        fonteIndisponivel: false,
        ...(props?.dados ?? {}),
      },
    })
  );

const renderBloco = (bloco) =>
  renderToStaticMarkup(h(BlocoDoAtivo, { ativo: bloco }));

// ===========================================================================
// 1. ARMADILHA 1 -- a view devolve razao, a tela fala em porcentagem
// ===========================================================================

test("a fixture da PETR4 REALMENTE contem a armadilha da unidade", () => {
  // Sem esta assercao, a suite inteira poderia estar medindo um numero em que a
  // conversao nao faz diferenca -- e passaria verde provando nada. O ROE da
  // PETR4 e o caso em que a razao crua e o percentual respondem DIFERENTE contra
  // o limite de 15.
  const razao = Number(PETR4_2025.roe);
  assert.ok(razao < 1, "a view entrega razao: 0,26, nao 26");
  assert.equal(razao > 15, false, "a razao crua nunca passa de 15");
  assert.equal(razao * 100 > 15, true, "o percentual passa");
});

test("ROE da PETR4 e 26,49% e bate o criterio de 15% -- nao 0,26%", () => {
  const roe = CRIVOS.find((c) => c.id === "roe");
  const a = avaliarCrivo(PETR4_2025, roe, 15);

  assert.equal(a.estado, "atingido");
  assert.equal(formatarValorDoCrivo(a.valor, a.unidade), "26,49%");
  assert.equal(a.criterio, "acima de 15%");
  // O numero que a tela mostra tem que ser maior que 1: a razao crua jamais e.
  assert.ok(a.valor > 1, "sem a conversao o valor sai abaixo de 1");
});

test("a mesma empresa com ROE de 5% nao bate o criterio de 15%", () => {
  const roe = CRIVOS.find((c) => c.id === "roe");
  const a = avaliarCrivo({ ...PETR4_2025, roe: "0.05" }, roe, 15);
  assert.equal(a.estado, "nao_atingido");
  assert.equal(formatarValorDoCrivo(a.valor, a.unidade), "5,00%");
});

test("multiplicador NAO leva a conversao de porcentagem", () => {
  const divida = CRIVOS.find((c) => c.id === "divida-liquida-sobre-patrimonio");
  const a = avaliarCrivo(PETR4_2025, divida, 1);

  assert.equal(formatarValorDoCrivo(a.valor, a.unidade), "0,80x");
  assert.equal(a.estado, "atingido", "0,80x esta abaixo de 1,0x");
  // Se alguem "uniformizasse" a conversao, 0,80 viraria 79,84 e a empresa
  // passaria a aparecer devendo 80 vezes o patrimonio -- sem erro nenhum.
  assert.equal(daViewParaUnidade(0.8, "multiplicador"), 0.8);
  assert.equal(daViewParaUnidade(0.8, "percentual"), 80);
});

test("a comparacao e estrita: o valor igual ao limite nao esta acima dele", () => {
  const roe = CRIVOS.find((c) => c.id === "roe");
  assert.equal(avaliarCrivo({ roe: "0.15" }, roe, 15).estado, "nao_atingido");
  assert.equal(avaliarCrivo({ roe: "0.1501" }, roe, 15).estado, "atingido");

  const divida = CRIVOS.find((c) => c.id === "divida-liquida-sobre-patrimonio");
  assert.equal(
    avaliarCrivo({ divida_liquida_sobre_patrimonio: "1" }, divida, 1).estado,
    "nao_atingido",
    "1,0x nao esta abaixo de 1,0x"
  );
});

// ===========================================================================
// 2. ARMADILHA 2 -- "ultimo balanco fechado" e por empresa
// ===========================================================================

test("cada empresa traz o exercicio MAIS RECENTE dela, nao um ano fixo", () => {
  // A PETR4 tem 2025, a VALE3 so 2024. Um filtro por ano fixo faria uma das duas
  // desaparecer da lista.
  const mapa = ultimoExercicioPorTicker([
    PETR4_2024,
    PETR4_2025,
    VALE3_2024,
    RANI3_2025,
  ]);

  assert.equal(mapa.size, 3, "tres tickers, tres linhas -- nao uma por exercicio");
  assert.equal(numeroOuNulo(mapa.get("PETR4").ano_exercicio), 2025);
  assert.equal(numeroOuNulo(mapa.get("VALE3").ano_exercicio), 2024);
});

test("escolher o exercicio errado MUDA o veredito, nao so a data", () => {
  // A fixture de 2024 tem ROE de 10%: com ela a PETR4 reprova o criterio de 15%.
  // Esta assercao e o que impede a suite de aprovar um agrupamento que pega a
  // primeira linha que aparecer.
  const comAsDuas = montarCrivosDaCarteira(
    [ativo("PETR4")],
    [PETR4_2024, PETR4_2025],
    PADRAO
  );
  const roeDoAtivo = (blocos) =>
    blocos[0].avaliacoes.find((a) => a.id === "roe");

  assert.equal(comAsDuas.length, 1, "um ativo, um bloco");
  assert.equal(comAsDuas[0].anoExercicio, 2025);
  assert.equal(roeDoAtivo(comAsDuas).estado, "atingido");

  const soAAntiga = montarCrivosDaCarteira(
    [ativo("PETR4")],
    [PETR4_2024],
    PADRAO
  );
  assert.equal(
    roeDoAtivo(soAAntiga).estado,
    "nao_atingido",
    "a fixture antiga precisa reprovar, senao a assercao acima nao prova nada"
  );
});

test("a ordem em que as linhas chegam nao muda a escolha", () => {
  for (const linhas of [
    [PETR4_2024, PETR4_2025],
    [PETR4_2025, PETR4_2024],
  ]) {
    assert.equal(
      numeroOuNulo(ultimoExercicioPorTicker(linhas).get("PETR4").ano_exercicio),
      2025
    );
  }
});

test("o symbol do usuario casa com o ticker mesmo em minuscula e com espaco", () => {
  // `investment_assets.symbol` e digitado pela pessoa. Um casamento sensivel a
  // caixa faria o ativo aparecer como "balanco nao importado" -- que se le como
  // problema da CVM, e nao como problema nosso.
  const blocos = montarCrivosDaCarteira(
    [{ ...ativo("PETR4"), symbol: " petr4 " }],
    [PETR4_2025],
    PADRAO
  );
  assert.equal(blocos[0].foraDosCrivos, null);
  assert.equal(blocos[0].anoExercicio, 2025);
});

test("agrupar duas vezes da o mesmo resultado", () => {
  // A rota ja devolve uma linha por ticker e a tela reagrupa. Se o agrupamento
  // nao fosse idempotente, o numero mudaria entre servidor e cliente.
  const umaVez = [...ultimoExercicioPorTicker([PETR4_2024, PETR4_2025]).values()];
  const duasVezes = [...ultimoExercicioPorTicker(umaVez).values()];
  assert.deepEqual(duasVezes, umaVez);
});

// ===========================================================================
// 3. ARMADILHA 3 -- NULL nao e reprovado
// ===========================================================================

test("indicador NULL vira 'sem dado', e nunca 'nao atingido'", () => {
  const roe = CRIVOS.find((c) => c.id === "roe");
  const divida = CRIVOS.find((c) => c.id === "divida-liquida-sobre-patrimonio");

  const semRoe = avaliarCrivo(AZUL4_2025, roe, 15);
  assert.equal(semRoe.estado, "sem_dado");
  assert.equal(semRoe.valor, null);
  assert.equal(formatarValorDoCrivo(semRoe.valor, semRoe.unidade), "—");

  // O caso caro: num crivo de "abaixo de", ausencia tratada como zero APROVA.
  const semDivida = avaliarCrivo(AZUL4_2025, divida, 1);
  assert.equal(semDivida.estado, "sem_dado");
  assert.notEqual(semDivida.estado, "atingido", "ausencia nao pode aprovar");
  assert.notEqual(semDivida.estado, "nao_atingido", "nem reprovar");
});

test("`null > 15` e false em JavaScript -- e por isso o terceiro estado existe", () => {
  // A assercao documenta a armadilha no lugar em que ela morde: a linguagem
  // entrega calada a resposta que o SQL se recusa a dar.
  assert.equal(null > 15, false);
  assert.equal(null < 1, true, "e em crivo de 'abaixo de', ela APROVA");
});

test("string vazia e texto ilegivel nao viram zero", () => {
  assert.equal(numeroOuNulo(""), null);
  assert.equal(numeroOuNulo("   "), null);
  assert.equal(numeroOuNulo(null), null);
  assert.equal(numeroOuNulo(undefined), null);
  assert.equal(numeroOuNulo("abc"), null);
  assert.equal(numeroOuNulo(NaN), null);
  assert.equal(numeroOuNulo(Infinity), null);
  // E o zero de verdade continua zero.
  assert.equal(numeroOuNulo("0"), 0);
  assert.equal(numeroOuNulo(0), 0);
});

test("zero de verdade e avaliado, e nao confundido com ausencia", () => {
  const roe = CRIVOS.find((c) => c.id === "roe");
  const a = avaliarCrivo({ roe: "0" }, roe, 15);
  assert.equal(a.estado, "nao_atingido", "lucro zero e reprovacao medida");
  assert.equal(formatarValorDoCrivo(a.valor, a.unidade), "0,00%");
});

// ===========================================================================
// 4. A TELA: os tres estados sao distinguiveis, com NEGACAO explicita
// ===========================================================================

test("empresa com ROE nulo imprime 'sem dado' e NAO imprime 'nao atingido'", () => {
  // Definicao de pronto, item 3. A assercao nega o outro estado: so afirmar a
  // presenca do rotulo passaria verde numa tela que imprimisse os dois.
  const blocos = montarCrivosDaCarteira([ativo("AZUL4")], [AZUL4_2025], PADRAO);
  const t = texto(renderBloco(blocos[0]));

  assert.equal(conta(t, ROTULO_DO_ESTADO.sem_dado), 2, "ROE e alavancagem sem dado");
  assert.equal(
    conta(t, ROTULO_DO_ESTADO.nao_atingido),
    0,
    "sem dado nao pode aparecer como reprovado"
  );
  assert.equal(
    conta(t, ROTULO_DO_ESTADO.atingido),
    1,
    "a margem, que tem leitura, continua avaliada -- o card nao ficou mudo"
  );
  // E o valor ausente sai como travessao, nao como 0,00.
  assert.equal(conta(t, "0,00"), 0, "ausencia nao pode imprimir zero");
});

test("os tres rotulos de estado sao frases diferentes, nao cores da mesma", () => {
  const rotulos = Object.values(ROTULO_DO_ESTADO);
  assert.equal(new Set(rotulos).size, 3);
  // E "sem dado" nao pode ser uma variacao de "nao atingido": quem le de relance
  // le a palavra, e duas frases parecidas apagam o terceiro estado.
  assert.equal(
    ROTULO_DO_ESTADO.sem_dado.includes("atingido"),
    false,
    "o rotulo de ausencia nao pode conter a palavra do veredito"
  );
});

test("empresa aprovada e empresa reprovada aparecem com selos diferentes", () => {
  const blocos = montarCrivosDaCarteira(
    [ativo("PETR4"), ativo("VALE3")],
    [PETR4_2025, VALE3_2024],
    PADRAO
  );

  const petr = texto(renderBloco(blocos[0]));
  assert.equal(conta(petr, ROTULO_DO_ESTADO.atingido), 3, "PETR4 bate os tres");
  assert.equal(conta(petr, ROTULO_DO_ESTADO.nao_atingido), 0);

  const vale = texto(renderBloco(blocos[1]));
  assert.ok(vale.includes("6,25%"), "o ROE da VALE3 conferido");
  assert.equal(
    conta(vale, ROTULO_DO_ESTADO.nao_atingido),
    1,
    "6,25% nao bate 15%"
  );
  assert.equal(conta(vale, ROTULO_DO_ESTADO.atingido), 2);
});

// ===========================================================================
// 5. MUDAR O LIMITE MUDA O RESULTADO NA TELA
// ===========================================================================

test("o mesmo balanco muda de selo quando o limite do usuario muda", () => {
  // Definicao de pronto, item 1. A RANI3 tem ROE de 16,67%: bate 15% e nao bate
  // 20%. E o mesmo componente, com o mesmo dado -- so o limite mudou.
  const comum = { ativos: [ativo("RANI3")], indicadores: [RANI3_2025], fonteIndisponivel: false };

  const com15 = texto(
    renderToStaticMarkup(
      h(CrivosDeFundamento, { dados: { ...comum, limites: { ...PADRAO, roe: 15 } } })
    )
  );
  const com20 = texto(
    renderToStaticMarkup(
      h(CrivosDeFundamento, { dados: { ...comum, limites: { ...PADRAO, roe: 20 } } })
    )
  );

  assert.ok(com15.includes("16,67%"), "o valor da empresa nao depende do limite");
  assert.ok(com20.includes("16,67%"));

  assert.ok(com15.includes("acima de 15%"), "o criterio impresso e o do usuario");
  assert.ok(com20.includes("acima de 20%"));

  assert.equal(conta(com15, ROTULO_DO_ESTADO.nao_atingido), 0, "16,67% bate 15%");
  assert.equal(conta(com20, ROTULO_DO_ESTADO.nao_atingido), 1, "e nao bate 20%");
});

test("a lista e avaliada com o limite DIGITADO, nao com o salvo", () => {
  // ESTA ASSERCAO E TEXTUAL, e o motivo e uma limitacao honesta do harness: nao
  // ha DOM aqui (nem jsdom nem navegador), e `renderToStaticMarkup` nao digita.
  // Renderizar duas vezes com limites salvos diferentes -- o que o teste acima
  // faz -- NAO distingue "usa o texto digitado" de "usa o salvo": na primeira
  // pintura os dois valem o mesmo, e a diferenca so nasce na tecla seguinte.
  //
  // O que cobre a costura, entao, sao tres coisas juntas: `limitesEfetivos` tem
  // suite propria (abaixo), o render tem suite propria (acima), e isto amarra as
  // duas ao estado do campo. E um piso, nao uma garantia -- mesmo desenho do
  // check-tests-in-ci.
  const fonte = readFileSync(
    join(RAIZ, "components/investments/CrivosDeFundamento.tsx"),
    "utf8"
  );

  assert.match(
    fonte,
    /limitesEfetivos\(textos, dados\.limites\)/,
    "o limite que vale tem que sair do texto do campo mais o salvo"
  );
  assert.match(
    fonte,
    /montarCrivosDaCarteira\(\s*dados\.ativos,\s*dados\.indicadores,\s*limites,/,
    "a lista tem que ser montada com o limite efetivo, nao com dados.limites"
  );
  assert.match(
    fonte,
    /value=\{textos\[crivo\.id\] \?\? ""\}/,
    "o campo tem que ser controlado pelo MESMO estado que avalia a lista"
  );
});

test("o campo do limite abre com o valor salvo, em formato que o input aceita", () => {
  // `value="1,0"` num input numerico e valor invalido: o navegador o apaga e o
  // campo abre VAZIO -- a pessoa conclui que perdeu a configuracao.
  const textos = textosIniciais({ ...PADRAO, "divida-liquida-sobre-patrimonio": 1.5 });
  for (const valor of Object.values(textos)) {
    assert.equal(/^-?\d+(\.\d+)?$/.test(valor), true, `${valor} tem virgula ou lixo`);
  }
  assert.equal(textos.roe, "15");
  assert.equal(textos["divida-liquida-sobre-patrimonio"], "1.5");

  // E a ida e volta fecha: o que o campo abre mostrando e o limite salvo.
  assert.deepEqual(limitesEfetivos(textos, PADRAO), {
    ...PADRAO,
    "divida-liquida-sobre-patrimonio": 1.5,
  });
});

test("campo apagado ou ilegivel cai no limite SALVO, nao no padrao de fabrica", () => {
  const salvos = { ...PADRAO, roe: 8 };

  for (const ruim of ["", "   ", "abc", "-", "1e"]) {
    assert.equal(
      limitesEfetivos({ roe: ruim }, salvos).roe,
      8,
      `"${ruim}" nao pode saltar para 15 no meio da digitacao`
    );
  }
  // Fora da faixa tambem: a tela nao avalia contra um criterio que a rota recusa.
  assert.equal(limitesEfetivos({ roe: "9999" }, salvos).roe, 8);
  assert.equal(limitesEfetivos({ roe: "12,5" }, salvos).roe, 12.5, "virgula do teclado pt-BR");
  assert.equal(limitesEfetivos({ roe: "12.5" }, salvos).roe, 12.5);
});

test("o teclado do celular manda virgula, e o campo aceita", () => {
  assert.equal(lerLimiteDigitado("1,5"), 1.5);
  assert.equal(lerLimiteDigitado("1.5"), 1.5);
  assert.equal(lerLimiteDigitado(""), null);
  assert.equal(lerLimiteDigitado("abc"), null);
  assert.equal(formatarLimiteParaCampo(1.5), "1.5");
});

test("o aviso de nao-salvo NAO aparece na primeira abertura", () => {
  // O jsonb de quem nunca editou nao tem as chaves. Comparar o limite efetivo
  // com o cru daria "nao salvo" para todo mundo, e um aviso que aparece sempre
  // deixa de ser lido.
  const semNada = texto(
    renderToStaticMarkup(
      h(CrivosDeFundamento, {
        dados: {
          ativos: [ativo("PETR4")],
          indicadores: [PETR4_2025],
          limites: {},
          fonteIndisponivel: false,
        },
      })
    )
  );
  assert.equal(
    semNada.includes("Salve para que ele valha"),
    false,
    "ninguem digitou nada ainda"
  );
  assert.ok(semNada.includes("acima de 15%"), "e os limites de fabrica valem");
});

// ===========================================================================
// 6. FII E OS OUTROS ESTADOS EXPLICITOS
// ===========================================================================

test("FII na carteira mostra a explicacao, e nem um campo vazio nem um zero", () => {
  // Definicao de pronto, item 2.
  const blocos = montarCrivosDaCarteira(
    [ativo("HGLG11", "fii", "CSHG Logistica FII")],
    [],
    PADRAO
  );
  assert.equal(blocos[0].foraDosCrivos, "fii");

  const t = texto(renderBloco(blocos[0]));
  assert.ok(t.includes("Fundo imobiliário não publica balanço"), "falta a frase");
  assert.ok(t.includes("HGLG11"), "o ativo continua na lista");

  for (const rotulo of Object.values(ROTULO_DO_ESTADO)) {
    assert.equal(conta(t, rotulo), 0, `FII nao pode receber o selo "${rotulo}"`);
  }
  assert.equal(conta(t, "0,00"), 0, "nem zero");
  assert.equal(conta(t, "—"), 0, "nem campo vazio");
  // E a frase tem que dizer que a cotacao segue normal: sem isso a pessoa acha
  // que o FII saiu da carteira.
  assert.ok(t.includes("cotação"), "falta dizer que a cotacao segue normal");
});

test("os cinco motivos de ficar fora dos crivos tem textos DIFERENTES", () => {
  // Eles pedem acoes opostas: FII nunca vai ter esse dado, balanco nao importado
  // pode ter amanha, fonte indisponivel e problema nosso. Um texto unico para os
  // tres faria a pessoa esperar por algo que nao vem -- ou desistir do que vem.
  const textos = Object.values(EXPLICACAO_FORA_DOS_CRIVOS);
  assert.equal(new Set(textos).size, 5);
  for (const frase of textos) {
    assert.ok(frase.length > 40, `"${frase}" e curta demais para explicar`);
  }
  // As duas que podem ser confundidas com reprovacao dizem que nao sao.
  assert.ok(EXPLICACAO_FORA_DOS_CRIVOS.sem_fundamento.includes("não é reprovação"));
  assert.ok(EXPLICACAO_FORA_DOS_CRIVOS.fonte_indisponivel.includes("não é reprovação"));
});

test("acao sem balanco importado NAO recebe o texto do FII", () => {
  const blocos = montarCrivosDaCarteira([ativo("XPTO3")], [], PADRAO);
  assert.equal(blocos[0].foraDosCrivos, "sem_fundamento");

  const t = texto(renderBloco(blocos[0]));
  assert.ok(t.includes("ainda não foi importado"));
  assert.equal(
    t.includes("Fundo imobiliário"),
    false,
    "dizer 'fundo imobiliario' de uma acao e mentira sobre o ativo"
  );
});

test("a view indisponivel vira frase, nao card vazio -- e o FII vem antes dela", () => {
  // A 028 pode nao estar aplicada: migration neste projeto nao tem runner.
  const blocos = montarCrivosDaCarteira(
    [ativo("PETR4"), ativo("HGLG11", "fii")],
    [],
    PADRAO,
    true
  );

  assert.equal(blocos[0].foraDosCrivos, "fonte_indisponivel");
  assert.equal(
    blocos[1].foraDosCrivos,
    "fii",
    "dizer a um FII que 'a base nao respondeu' sugere que um dia ela responde"
  );

  const t = texto(renderCarteira({ dados: { fonteIndisponivel: true, indicadores: [] } }));
  assert.ok(t.includes("não respondeu agora"));
  for (const rotulo of Object.values(ROTULO_DO_ESTADO)) {
    assert.equal(conta(t, rotulo), 0);
  }
});

test("renda fixa e ativo internacional tambem ficam de fora, cada um com seu texto", () => {
  const blocos = montarCrivosDaCarteira(
    [ativo("TESOURO-IPCA", "fixed_income"), ativo("AAPL", "international")],
    [],
    PADRAO
  );
  assert.equal(blocos[0].foraDosCrivos, "renda_fixa");
  assert.equal(blocos[1].foraDosCrivos, "internacional");
  assert.ok(texto(renderBloco(blocos[1])).includes("companhia brasileira listada"));
});

test("ativo fora dos crivos nunca tem avaliacao, e dentro tem sempre as tres", () => {
  const blocos = montarCrivosDaCarteira(
    [ativo("PETR4"), ativo("HGLG11", "fii"), ativo("XPTO3")],
    [PETR4_2025],
    PADRAO
  );
  assert.equal(blocos[0].avaliacoes.length, CRIVOS.length);
  assert.equal(blocos[0].explicacao, null, "quem tem criterio nao tem frase");
  for (const bloco of blocos.slice(1)) {
    assert.equal(bloco.avaliacoes.length, 0);
    assert.notEqual(bloco.explicacao, null, "quem nao tem criterio TEM frase");
  }
});

// ===========================================================================
// 7. SEM NOTA, SEM VOCABULARIO DE RECOMENDACAO
// ===========================================================================

test("a tela inteira nao usa vocabulario de recomendacao", () => {
  const html = renderToStaticMarkup(
    h(CrivosDeFundamento, {
      dados: {
        ativos: [
          ativo("PETR4"),
          ativo("VALE3"),
          ativo("AZUL4"),
          ativo("HGLG11", "fii"),
          ativo("XPTO3"),
        ],
        indicadores: [PETR4_2025, VALE3_2024, AZUL4_2025],
        limites: PADRAO,
        fonteIndisponivel: false,
      },
      onSalvar: async () => ({ ok: true }),
    })
  );

  const achados = vocabularioDeRecomendacao(html);
  assert.deepEqual(achados, [], `a tela usa: ${achados.join(", ")}`);
});

test("a propria trava de vocabulario sabe acusar", () => {
  // Controle negativo. Uma varredura que nunca viu vermelho nao e varredura --
  // e esta e a unica coisa entre a decisao de produto e uma frase de conveniencia
  // acrescentada em seis meses.
  assert.deepEqual(vocabularioDeRecomendacao("Bom momento para comprar"), ["comprar"]);
  assert.deepEqual(vocabularioDeRecomendacao("Score: 3 de 3"), ["score"]);
  assert.deepEqual(vocabularioDeRecomendacao("RECOMENDADO"), ["recomend"]);
  // Com acento e sem: a varredura normaliza antes de comparar.
  assert.deepEqual(vocabularioDeRecomendacao("pontuação alta"), ["pontuacao", "pontuação"]);
  assert.ok(VOCABULARIO_PROIBIDO.length >= 10, "a lista nao pode ter sido esvaziada");
});

test("nenhuma nota unica sai do codigo: o resultado e por criterio", () => {
  const bloco = montarCrivosDoAtivo(ativo("PETR4"), PETR4_2025, PADRAO);
  for (const proibido of ["score", "nota", "pontos", "pontuacao", "ranking", "estrelas"]) {
    assert.equal(proibido in bloco, false, `${proibido} nao pode existir no bloco`);
  }
  for (const avaliacao of bloco.avaliacoes) {
    assert.equal("score" in avaliacao, false);
    assert.ok(["atingido", "nao_atingido", "sem_dado"].includes(avaliacao.estado));
  }
});

test("nenhuma migration declara coluna de score", () => {
  // A issue e explicita: nenhum campo de score no banco. Esta entrega nao tem
  // migration, e a verificacao existe para que a proxima nao traga uma.
  const dir = join(RAIZ, "database/migrations");
  const arquivos = readdirSync(dir).filter((f) => f.endsWith(".sql"));
  assert.ok(arquivos.length > 20, "a varredura perdeu o alvo");

  for (const arquivo of arquivos) {
    const sql = readFileSync(join(dir, arquivo), "utf8");
    const coluna = /^\s*(score|pontuacao|ranking)\s+(?:numeric|integer|int|smallint|real|text)/im;
    assert.equal(coluna.test(sql), false, `${arquivo} declara coluna de nota`);
  }
});

test("o quarto crivo esta declarado como pendente, com o motivo na tela", () => {
  // Um criterio que simplesmente nao aparece se le como esquecimento. A escolha
  // desta entrega e a recomendada pela issue: os tres que fecham sozinhos agora,
  // o yield depois da cotacao automatica.
  assert.equal(CRIVOS_PENDENTES.length, 1);
  const yield_ = CRIVOS_PENDENTES[0];
  assert.equal(yield_.id, "dividend-yield");
  assert.match(yield_.motivo, /preço/, "o motivo tem que citar o preco");

  // E ele NAO esta entre os crivos avaliados: exibir yield com o preco digitado
  // a mao, sem dizer de quando ele e, e o que a issue proibiu.
  assert.equal(
    CRIVOS.some((c) => c.id === "dividend-yield"),
    false
  );
  const t = texto(renderCarteira());
  assert.ok(t.includes("Dividend yield"), "a tela declara a ausencia");
  assert.ok(t.includes(yield_.motivo.slice(0, 40)));
});

// ===========================================================================
// 8. UMA FONTE POR INDICADOR, E A DATA-BASE NA TELA
// ===========================================================================

test("cada indicador cita a conta de onde saiu, e as tres fontes sao distintas", () => {
  // A mesma PETR4 tinha tres P/L defensaveis no mesmo dia. "Vem da DRE" nao
  // desempata entre lucro do periodo e lucro atribuido aos controladores.
  const fontes = CRIVOS.map((c) => FONTE_DECLARADA[c.campo]);
  assert.equal(new Set(fontes).size, 3);
  for (const fonte of fontes) {
    assert.match(fonte, /\d\.\d\d/, `"${fonte}" nao cita codigo de conta`);
    assert.match(fonte, /CVM/);
  }
  assert.match(FONTE_DECLARADA.roe, /3\.11.*2\.03/);
});

test("a tela imprime a fonte de cada indicador e a data-base do balanco", () => {
  const t = texto(renderCarteira());
  for (const crivo of CRIVOS) {
    assert.ok(
      t.includes(FONTE_DECLARADA[crivo.campo]),
      `a fonte de ${crivo.id} nao aparece na tela`
    );
  }
  assert.ok(t.includes("31/12/2025"), "falta a data-base");
  assert.ok(t.includes("2025"), "falta o exercicio");
  // A razao social da CVM prova, na tela, que a ponte casou a empresa certa --
  // e a Acu Petroleo tambem tem CNPJ valido e balanco publicado.
  assert.ok(t.includes("PETROBRAS"));
});

test("a data-base nao anda um dia para tras", () => {
  // `new Date("2025-12-31")` e meia-noite UTC, que em Sao Paulo e 21:00 de 30/12.
  assert.equal(formatarDataBase("2025-12-31"), "31/12/2025");
  assert.equal(formatarDataBase("2024-01-01"), "01/01/2024");
  assert.equal(formatarDataBase(null), "—");
  assert.equal(formatarDataBase("nao e data"), "—");
});

test("o que o app le da view existe na view", () => {
  // Deriva de coluna e invisivel: tabela certa com coluna errada compila, e o
  // PostgREST devolve erro em tempo de execucao, dentro de um catch.
  const rota = readFileSync(
    join(RAIZ, "app/api/investments/crivos/route.ts"),
    "utf8"
  );
  const sql028 = readFileSync(
    join(RAIZ, "database/migrations/028_fundamento_cvm.sql"),
    "utf8"
  );

  const colunas = [
    ...new Set([
      "ticker",
      "denominacao",
      "ano_exercicio",
      "data_base",
      ...CRIVOS.map((c) => c.campo),
    ]),
  ];

  for (const coluna of colunas) {
    assert.ok(
      new RegExp(`\\b${coluna}\\b`).test(rota),
      `a rota nao pede ${coluna} -- o campo chegaria undefined e viraria "sem dado"`
    );
    assert.ok(
      new RegExp(`(AS ${coluna}\\b|[fp]\\.${coluna}\\b)`).test(sql028),
      `${coluna} nao sai da view da 028`
    );
  }
});

// ===========================================================================
// 9. O LIMITE DENTRO DO JSONB
// ===========================================================================

test("preferencia ilegivel nao derruba a lista: cai no padrao", () => {
  for (const lixo of [null, undefined, 0, "", [], "texto", { crivos: 7 }, { crivos: { limites: 3 } }]) {
    assert.deepEqual(lerLimites(lixo), PADRAO, `${JSON.stringify(lixo)} devia cair no padrao`);
  }
});

test("o catalogo manda: crivo novo nasce com o limite de fabrica", () => {
  // No dia em que um crivo entrar, todo usuario que ja salvou limite tem no banco
  // um objeto que nao o menciona. Se a tela mostrasse so o salvo, o criterio novo
  // ficaria invisivel justamente para quem mais usa o app.
  const salvo = { [CHAVE_DE_CRIVOS]: { limites: { roe: 20 } } };
  const lido = lerLimites(salvo);

  assert.equal(lido.roe, 20, "o que o usuario salvou vale");
  assert.equal(Object.keys(lido).length, CRIVOS.length, "um limite por crivo");
  assert.equal(lido["margem-liquida"], 10, "o que ele nao salvou vem de fabrica");

  // E id que o catalogo nao conhece e descartado, nao repassado.
  const comLixo = lerLimites({
    [CHAVE_DE_CRIVOS]: { limites: { roe: 20, "crivo-aposentado": 99 } },
  });
  assert.equal("crivo-aposentado" in comLixo, false);
});

test("limite fora da faixa gravado a mao cai no padrao, sem explodir", () => {
  const lido = lerLimites({ [CHAVE_DE_CRIVOS]: { limites: { roe: 100000, "margem-liquida": "abc" } } });
  assert.equal(lido.roe, 15);
  assert.equal(lido["margem-liquida"], 10);
});

test("gravar os crivos nao apaga o resto do jsonb do perfil", () => {
  // `preferences` guarda painel, moeda, notificacoes e privacidade. Um PUT que
  // escrevesse `{ crivos: ... }` direto apagaria tudo isso em silencio: os
  // criterios funcionariam e o layout do painel voltaria ao padrao sem aviso.
  const antes = {
    moeda: { oficial: "BRL", porLancamento: true },
    dashboard: { layout: [{ id: "resumo", visivel: false }] },
    [CHAVE_DE_CRIVOS]: { algoQueJaEstava: true },
  };
  const depois = mesclarLimites(antes, { ...PADRAO, roe: 18 });

  assert.deepEqual(depois.moeda, antes.moeda);
  assert.deepEqual(depois.dashboard, antes.dashboard);
  assert.equal(depois[CHAVE_DE_CRIVOS].algoQueJaEstava, true, "nem dentro do bloco");
  assert.equal(depois[CHAVE_DE_CRIVOS].limites.roe, 18);

  // E o objeto original nao foi mutado: a rota le, mescla e grava, e uma mutacao
  // aqui faria o "antes" e o "depois" serem o mesmo objeto no log de erro.
  assert.equal(antes[CHAVE_DE_CRIVOS].limites, undefined);
});

test("mesclar num perfil sem preferences nenhuma funciona", () => {
  const depois = mesclarLimites(null, PADRAO);
  assert.deepEqual(depois[CHAVE_DE_CRIVOS].limites, PADRAO);
});

test("a escrita RECUSA em vez de corrigir", () => {
  assert.equal(validarLimites(null).ok, false);
  assert.equal(validarLimites({}).ok, false);
  assert.equal(validarLimites({ limites: {} }).ok, false, "corpo incompleto e bug de cliente");

  const semUm = { limites: { ...PADRAO } };
  delete semUm.limites["margem-liquida"];
  const r = validarLimites(semUm);
  assert.equal(r.ok, false);
  assert.match(r.erro, /Margem/, "o erro tem que dizer QUAL criterio falta");

  assert.equal(validarLimites({ limites: { ...PADRAO, roe: 99999 } }).ok, false);
  assert.equal(validarLimites({ limites: { ...PADRAO, roe: "abc" } }).ok, false);
});

test("o limite gravado e NUMERO, mesmo quando chega como string", () => {
  // Um "15" gravado no jsonb faria a tela comparar string com numero depois, e o
  // aviso de "nao salvo" apareceria para quem acabou de salvar.
  const r = validarLimites({ limites: { ...PADRAO, roe: "18.5" } });
  assert.equal(r.ok, true);
  assert.equal(r.valor.roe, 18.5);
  assert.equal(typeof r.valor.roe, "number");
});

test("o limite aceito pela escrita e o mesmo que a leitura mantem", () => {
  // As duas usam a mesma faixa. Se divergissem, a rota aceitaria um limite que a
  // leitura descarta -- a pessoa salva, ve "salvo", e o criterio volta ao padrao
  // na proxima abertura.
  for (const crivo of CRIVOS) {
    const dentro = { limites: { ...PADRAO, [crivo.id]: crivo.limiteMaximo } };
    assert.equal(validarLimites(dentro).ok, true, `${crivo.id} no maximo`);
    assert.equal(
      lerLimites({ [CHAVE_DE_CRIVOS]: { limites: dentro.limites } })[crivo.id],
      crivo.limiteMaximo
    );

    const fora = { limites: { ...PADRAO, [crivo.id]: crivo.limiteMaximo + 0.01 } };
    assert.equal(validarLimites(fora).ok, false, `${crivo.id} acima do maximo`);
  }
});

// ===========================================================================
// 10. FORMATACAO
// ===========================================================================

test("o limite em prosa sai na unidade do criterio", () => {
  assert.equal(formatarLimite(15, "percentual"), "15%");
  assert.equal(formatarLimite(12.5, "percentual"), "12,5%");
  assert.equal(formatarLimite(1, "multiplicador"), "1,0x");
  assert.equal(formatarLimite(1.25, "multiplicador"), "1,25x");
});

test("o valor da empresa sai com duas casas em pt-BR", () => {
  assert.equal(formatarValorDoCrivo(26.4866, "percentual"), "26,49%");
  assert.equal(formatarValorDoCrivo(0.7984, "multiplicador"), "0,80x");
  assert.equal(formatarValorDoCrivo(-3.5, "percentual"), "-3,50%");
  assert.equal(formatarValorDoCrivo(null, "percentual"), "—");
});

test("os limites de fabrica sao os tres que o Helio escolheu", () => {
  assert.deepEqual(PADRAO, {
    roe: 15,
    "divida-liquida-sobre-patrimonio": 1,
    "margem-liquida": 10,
  });
  // A direcao faz parte do criterio: alavancagem e o unico "abaixo de", e trocar
  // a direcao aprovaria exatamente as empresas mais endividadas.
  assert.equal(CRIVOS.find((c) => c.id === "roe").direcao, "acima");
  assert.equal(CRIVOS.find((c) => c.id === "margem-liquida").direcao, "acima");
  assert.equal(
    CRIVOS.find((c) => c.id === "divida-liquida-sobre-patrimonio").direcao,
    "abaixo"
  );
});

test("a carteira vazia diz o que fazer, em vez de nao dizer nada", () => {
  const t = texto(renderCarteira({ dados: { ativos: [], indicadores: [] } }));
  assert.ok(t.includes("Cadastre um ativo"));
  // E os campos de limite continuam la, com o valor que vale: configurar antes de
  // cadastrar o primeiro ativo e valido.
  assert.ok(t.includes("valendo agora: 15%"), "o limite de ROE nao aparece");
  assert.ok(t.includes("valendo agora: 1,0x"), "o de alavancagem nao aparece");
  for (const rotulo of Object.values(ROTULO_DO_ESTADO)) {
    assert.equal(conta(t, rotulo), 0, "carteira vazia nao pode ter selo nenhum");
  }
});
