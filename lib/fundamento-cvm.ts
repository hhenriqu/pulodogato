// Fundamento de acao brasileira a partir da DFP anual da CVM.
//
// Este modulo e a parte PURA do ingestor da HMO-194: dado o texto dos CSVs do
// pacote anual e a resposta da consulta aberta da B3, ele decide qual empresa e,
// quais contas guardar e como derivar cada indicador. Quem baixa o ZIP e quem
// grava no banco e `scripts/ingest-cvm-fundamentos.mjs`; separar assim e o que
// deixa as tres armadilhas abaixo testaveis sem rede e sem banco.
//
// =========================================================================
// ARMADILHA 1 -- a ponte ticker -> CNPJ casa com a empresa ERRADA
// =========================================================================
// A CVM nao sabe o que e um ticker: indexa por CNPJ e codigo CVM. A ponte e a
// consulta aberta da B3, que NAO busca por ticker -- busca substring no nome da
// empresa, ordenada por nome. Medido em 2026-09-30 sobre 15 acoes, o primeiro
// resultado e outra empresa em 3 delas:
//
//   PETR4 -> ACU PETROLEO S.A.            (a Petrobras e a 8a de 17)
//   VALE3 -> ADECOAGRO VALE DO EVINHEMA   (a Vale e a 11a de 12)
//   RANI3 -> GLOBAL X URANIUM ETF         (a Irani e a 5a de 5)
//
// O que torna isso perigoso e que o erro nao da sintoma: a Acu Petroleo existe,
// tem CNPJ valido e tem balanco na CVM. A consulta seguinte funciona, o ingestor
// grava, a tela mostra um ROE. Nao ha excecao, nao ha linha vazia, nao ha log --
// so a rentabilidade de outra empresa, exibida com a mesma confianca.
//
// Por isso `escolherEmpresaDaB3` casa por IGUALDADE EXATA no `issuingCompany`
// contra o ticker sem os digitos finais, nunca pelo primeiro resultado, e
// RECUSA quando nao ha casamento exato. Ticker sem fundamento e um espaco em
// branco honesto na tela; o "mais parecido" e um numero errado exibido como
// certo.
//
// =========================================================================
// ARMADILHA 2 -- a DMPL conta o mesmo dividendo varias vezes
// =========================================================================
// A DMPL tem uma linha por COMPONENTE do patrimonio (`COLUNA_DF`): capital
// social, reservas de lucro, lucros acumulados, ... e tambem os totais
// "Patrimonio Liquido" e "Patrimonio Liquido Consolidado". Somar as linhas de
// "Dividendos" sem escolher a coluna infla o numero somando parcelas COM os
// totais que ja as contem. Medido na PETR4 de 2025: a soma das 8 colunas da
// R$ 127,2 bi, contra R$ 42,4 bi de verdade -- exatamente 3,00x, porque o mesmo
// dividendo aparece nas parcelas, no subtotal "Patrimonio Liquido" e no total
// "Patrimonio Liquido Consolidado". Nenhuma das tres linhas parece redundante
// olhada isolada.
//
// Por isso `somarDividendos` exige `COLUNA_DF = 'Patrimonio Liquido
// Consolidado'` e recusa o arquivo em que essa coluna nao aparece, em vez de
// cair no somatorio.
//
// =========================================================================
// ARMADILHA 3 -- a escala do numero muda de empresa para empresa
// =========================================================================
// `ESCALA_MOEDA` vale MIL ou UNIDADE no mesmo arquivo (as duas ocorrem em 2025).
// Ler sem normalizar erra por 1000x em parte das empresas.
//
// Pior: `composicao_capital` NAO TEM coluna de escala, e as empresas divergem.
// No arquivo de 2025 a PETR4 declara 12.888.732.761 acoes (unidades) e a VALE3
// declara 4.539.007 -- que sao milhares, porque 4,5 milhoes de acoes colocariam
// a Vale a ~R$ 13.000 por acao. Nao ha campo que desempate.
//
// Consequencia, e ela limita de proposito o que esta entrega entrega: guardamos
// a quantidade de acoes como o arquivo a publica, mas NAO derivamos indicador
// nenhum "por acao" (P/L, LPA, dividend yield) dela. Os indicadores deste
// modulo -- ROE, margem, divida liquida / patrimonio -- sao todos RAZAO entre
// dois valores monetarios da MESMA empresa no MESMO arquivo, e por isso
// imunes a escala: o fator 1000 cancela. Ver `FONTES`.

/** Escala declarada pela CVM na linha. O arquivo de 2025 usa as duas. */
const FATOR_ESCALA: Readonly<Record<string, number>> = { MIL: 1000, UNIDADE: 1 };

/** A unica `COLUNA_DF` da DMPL que e o total consolidado -- ver armadilha 2. */
export const COLUNA_DMPL_CONSOLIDADO = "Patrimônio Líquido Consolidado";

// =========================================================================
// ARMADILHA 4 -- o MESMO codigo de conta significa outra coisa em banco
// =========================================================================
// O plano de contas da CVM nao e unico: instituicao financeira e seguradora
// publicam uma DRE e um balanco com estrutura propria. Medido no pacote de 2025,
// sobre as 439 empresas:
//
//   o rotulo "Patrimonio Liquido Consolidado" esta em  2.03 (429 empresas),
//                                                      2.07 (9) e 2.08 (4);
//   o rotulo "Lucro/Prejuizo Consolidado do Periodo"  em 3.11 (427),
//                                                      3.13 (2) e 3.09 (4).
//
// E o codigo nao fica VAZIO nas outras: no Itau, `2.03` existe e vale
// R$ 2.350,9 bi -- e "Passivos Financeiros ao Custo Amortizado", nao patrimonio.
// O patrimonio do Itau esta em `2.08`, R$ 215,1 bi. Buscar so pelo codigo nao
// devolveria nada faltando: devolveria um PASSIVO no lugar do patrimonio, dez
// vezes maior, e o ROE sairia dividido pela conta errada -- plausivel, calado e
// errado, para 13 das 439 empresas.
//
// Por isso a conta e localizada pelo ROTULO (`DS_CONTA`), que e o conceito, e
// nao pelo codigo, que e so o endereco dele naquele plano de contas. Onde o
// rotulo se repete de propria natureza -- "Emprestimos e Financiamentos" aparece
// no circulante E no nao circulante -- o codigo desempata, e ai o rotulo e
// CONFERIDO: se o codigo existir com outro rotulo, a leitura e recusada em vez de
// aceita.

/** Sem acento, minusculo, sem espaco duplo -- para comparar `DS_CONTA`. */
export function normalizarRotulo(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * As contas que os crivos (entrega 5) usam.
 *
 * Sempre os arquivos `_con` (consolidado), nunca `_ind` (individual): para
 * holding -- que e o caso de quase toda blue chip -- o individual mostra o
 * resultado da controladora sozinha e ignora as operacoes das controladas.
 *
 * Cada conta declara os ROTULOS que a identificam e, quando preciso, o CODIGO.
 * A regra que vale para todas: **um valor so e lido quando o rotulo casa**. Sem
 * casamento de rotulo o campo fica nulo -- nunca se le a conta vizinha.
 *
 * Os conjuntos de rotulo abaixo foram MEDIDOS no pacote de 2025 (439 empresas com
 * balanco consolidado), nao supostos:
 *
 *   lucro consolidado     433 "lucro/prejuizo consolidado do periodo"      [3.09, 3.11, 3.13]
 *                           9 "lucro ou prejuizo liquido consolidado ..."  [3.11]   -> 439/439
 *   patrimonio            442 "patrimonio liquido consolidado"             [2.03, 2.07, 2.08] -> 439/439
 *   receita               429 "receita de venda de bens e/ou servicos"     [3.01, 3.01.01]
 *   custo                 433 "custo dos bens e/ou servicos vendidos"      [3.02, 3.02.01, ...]
 *
 * Duas consequencias desses numeros estao no desenho:
 *
 *   1. Lucro e patrimonio -- as duas entradas do ROE -- sao achados SO por
 *      rotulo, sem codigo, porque o codigo muda com o plano de contas e cobrir os
 *      439 exige aceitar 3.09/3.11/3.13 e 2.03/2.07/2.08.
 *   2. Receita e custo levam codigo JUNTO com o rotulo, porque o mesmo texto
 *      aparece na conta-mae (3.01) e numa subconta (3.01.01): so o rotulo daria
 *      duas linhas para o mesmo conceito e a leitura seria ambigua.
 *
 * A cauda longa (as ~6 a 11 empresas que escrevem "Receita Liquida", "Custo dos
 * Servicos Prestados", "Depositos") fica de fora de proposito: "receita liquida
 * com tits. capitalizacao" nao e comparavel com "receita de venda de bens", e
 * empilhar as duas na mesma coluna faria um crivo de margem comparar conceitos
 * diferentes. Para essas empresas a margem fica n/d -- espaco em branco honesto,
 * que e a mesma escolha que a issue faz para o ticker sem casamento.
 */
export const CONTAS = {
  // So rotulo: o codigo varia com o plano de contas (ver armadilha 4).
  lucroLiquido: {
    arquivo: "DRE_con",
    rotulos: ["lucro/prejuizo consolidado do periodo", "lucro ou prejuizo liquido consolidado do periodo"],
  },
  patrimonioLiquido: { arquivo: "BPP_con", rotulos: ["patrimonio liquido consolidado"] },

  // Rotulo + codigo: o mesmo texto aparece na conta-mae e na subconta.
  receitaLiquida: { arquivo: "DRE_con", codigo: "3.01", rotulos: ["receita de venda de bens e/ou servicos"] },
  custo: { arquivo: "DRE_con", codigo: "3.02", rotulos: ["custo dos bens e/ou servicos vendidos"] },

  // Rotulo + codigo: "Emprestimos e Financiamentos" e o mesmo texto no
  // circulante (2.01.04) e no nao circulante (2.02.01) -- so o codigo separa.
  dividaCurtoPrazo: { arquivo: "BPP_con", codigo: "2.01.04", rotulos: ["emprestimos e financiamentos"] },
  dividaLongoPrazo: { arquivo: "BPP_con", codigo: "2.02.01", rotulos: ["emprestimos e financiamentos"] },
  caixa: { arquivo: "BPA_con", codigo: "1.01.01", rotulos: ["caixa e equivalentes de caixa"] },
  aplicacoesFinanceiras: { arquivo: "BPA_con", codigo: "1.01.02", rotulos: ["aplicacoes financeiras"] },
} as const;

/** Dividendo e JCP saem da DMPL. JCP e distribuicao tambem -- banco paga quase tudo assim. */
export const CONTAS_DMPL = { dividendos: "5.04.06", jurosSobreCapitalProprio: "5.04.07" } as const;

/**
 * A fonte declarada de cada indicador -- uma por indicador, escrita aqui.
 *
 * Por que isto e uma constante e nao um comentario: a mesma PETR4 tinha TRES
 * P/L defensaveis no mesmo dia (brapi pronta 4,79; lucro CVM / acoes CVM 5,77;
 * lucro CVM / acoes implicitas no valor de mercado 6,00). 25% entre o menor e o
 * maior, nenhum errado -- medem bases diferentes. Um crivo "P/L abaixo de 6"
 * aprova ou reprova a mesma acao conforme a fonte, e as tres telas pareceriam
 * igualmente certas. Misturar fonte por indicador e proibido mesmo quando as
 * duas respondem; a tela mostra `dataBase`.
 */
export const FONTES = {
  roe:
    "rotulo 'Lucro/Prejuizo Consolidado do Periodo' (DRE con; codigos 3.09/3.11/3.13) / " +
    "rotulo 'Patrimonio Liquido Consolidado' (BPP con; codigos 2.03/2.07/2.08), mesmo DT_FIM_EXERC",
  margemLiquida:
    "'Lucro/Prejuizo Consolidado do Periodo' / 'Receita de Venda de Bens e/ou Servicos' (DRE con 3.01)",
  margemBruta:
    "('Receita de Venda de Bens e/ou Servicos' + 'Custo dos Bens e/ou Servicos Vendidos') / receita, DRE con (3.01, 3.02)",
  dividaLiquidaSobrePatrimonio:
    "('Emprestimos e Financiamentos' BPP con 2.01.04 + 2.02.01 - 'Caixa e Equivalentes' BPA con 1.01.01 " +
    "- 'Aplicacoes Financeiras' 1.01.02) / 'Patrimonio Liquido Consolidado'",
} as const;

/**
 * O que esta entrega deliberadamente NAO calcula, e por que.
 *
 * Deixar isto explicito e o que impede a entrega 5 de "completar" a conta com a
 * fonte que estiver a mao -- que e exatamente como nascem os tres P/L.
 */
export const NAO_DERIVADOS = {
  precoSobreLucro: "exige preco/valor de mercado (brapi), que nao e CVM -- entrega 5",
  dividendYield: "exige valor de mercado (brapi) -- entrega 5",
  lucroPorAcao:
    "a quantidade de acoes da CVM nao tem escala declarada e as empresas divergem (PETR4 em unidades, VALE3 em milhares) -- ver armadilha 3",
} as const;

// ---------------------------------------------------------------------------
// A ponte ticker -> empresa
// ---------------------------------------------------------------------------

/** Um resultado da consulta aberta da B3 (`GetInitialCompanies`). */
export type ResultadoB3 = {
  readonly issuingCompany?: string;
  readonly companyName?: string;
  readonly cnpj?: string;
  readonly codeCVM?: string;
};

export type EmpresaDaB3 = {
  readonly ticker: string;
  readonly radical: string;
  readonly codigoCvm: string;
  /** So digitos, como a B3 devolve. `formatarCnpj` poe a mascara da CVM. */
  readonly cnpj: string;
  readonly nome: string;
};

/** Por que o ticker nao virou empresa. Vira linha em `cvm_tickers_sem_fundamento`. */
export type RecusaDaPonte =
  | { readonly motivo: "ticker_fora_do_padrao"; readonly ticker: string; readonly candidatos: number }
  | { readonly motivo: "sem_casamento_exato"; readonly ticker: string; readonly radical: string; readonly candidatos: number }
  | { readonly motivo: "casamento_ambiguo"; readonly ticker: string; readonly radical: string; readonly candidatos: number }
  | { readonly motivo: "sem_codigo_cvm"; readonly ticker: string; readonly radical: string; readonly candidatos: number };

export type ResolucaoDaPonte =
  | { readonly ok: true; readonly empresa: EmpresaDaB3 }
  | { readonly ok: false; readonly recusa: RecusaDaPonte };

/**
 * O radical de 4 letras que a B3 usa em `issuingCompany`. `PETR4` -> `PETR`.
 *
 * Exige a forma canonica (4 letras + digitos, com `F` opcional do fracionario)
 * e devolve `null` para qualquer outra. Recusar e de proposito: uma forma que
 * nao reconhecemos e exatamente onde "chutar o radical" casaria com outra
 * empresa, que e a armadilha 1.
 */
export function radicalDoTicker(ticker: string): string | null {
  const m = /^([A-Z]{4})\d{1,2}F?$/.exec(ticker.trim().toUpperCase());
  return m ? m[1] : null;
}

/**
 * Escolhe a empresa pelo ticker, por igualdade exata no `issuingCompany`.
 *
 * NUNCA devolve `resultados[0]`: a lista vem ordenada por NOME, e a primeira
 * posicao e de quem tem o nome alfabeticamente menor contendo o radical --
 * ACU PETROLEO na frente da PETROBRAS. Sem casamento exato, recusa.
 */
export function escolherEmpresaDaB3(ticker: string, resultados: readonly ResultadoB3[]): ResolucaoDaPonte {
  const limpo = ticker.trim().toUpperCase();
  const radical = radicalDoTicker(limpo);
  if (!radical) {
    return { ok: false, recusa: { motivo: "ticker_fora_do_padrao", ticker: limpo, candidatos: resultados.length } };
  }

  const exatos = resultados.filter((r) => (r.issuingCompany ?? "").trim().toUpperCase() === radical);

  if (exatos.length === 0) {
    return { ok: false, recusa: { motivo: "sem_casamento_exato", ticker: limpo, radical, candidatos: resultados.length } };
  }
  // Dois `issuingCompany` iguais nao acontecem hoje, mas se acontecerem nao ha
  // como escolher sem chutar -- e chutar aqui e a armadilha 1 de novo.
  if (exatos.length > 1) {
    return { ok: false, recusa: { motivo: "casamento_ambiguo", ticker: limpo, radical, candidatos: resultados.length } };
  }

  const e = exatos[0];
  const codigoCvm = String(e.codeCVM ?? "").trim().replace(/^0+/, "");

  // A B3 devolve o CNPJ como NUMERO, nao como texto: os zeros a esquerda somem.
  // O Banco do Brasil chega como `"191"` -- o CNPJ dele e 00.000.000/0001-91.
  // Exigir 14 digitos sem reencher recusaria 154 das 439 empresas do pacote de
  // 2025 (35%), entre elas o proprio Banco do Brasil, todas com a mesma cara de
  // "empresa sem CNPJ valido". Zero a esquerda que desaparece e um classico, e
  // aqui ele nao daria erro: daria uma lista de recusas plausiveis.
  const cnpjCru = String(e.cnpj ?? "").replace(/\D/g, "");
  const cnpj = cnpjCru.replace(/^0+/, "") === "" ? "" : cnpjCru.padStart(14, "0");

  // `GLOBAL X URANIUM ETF` vem com `cnpj: 0` (vira "" acima) -- ETF nao entrega
  // DFP. Sem codigo CVM ou CNPJ utilizavel nao ha o que buscar no pacote da CVM.
  // `cnpj.length !== 14` tambem pega o caso oposto, de um numero longo demais:
  // `padStart` nao corta, entao um CNPJ com 15 digitos continua sendo recusado.
  if (!codigoCvm || codigoCvm === "0" || cnpj.length !== 14) {
    return { ok: false, recusa: { motivo: "sem_codigo_cvm", ticker: limpo, radical, candidatos: resultados.length } };
  }

  return {
    ok: true,
    empresa: { ticker: limpo, radical, codigoCvm, cnpj, nome: (e.companyName ?? "").trim() },
  };
}

/** `33000167000101` -> `33.000.167/0001-01`, que e como os CSVs da CVM escrevem. */
export function formatarCnpj(somenteDigitos: string): string {
  const d = somenteDigitos.replace(/\D/g, "");
  if (d.length !== 14) throw new Error(`CNPJ com ${d.length} digitos: ${somenteDigitos}`);
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

// ---------------------------------------------------------------------------
// Os CSVs
// ---------------------------------------------------------------------------

export type LinhaCsv = Readonly<Record<string, string>>;

/**
 * Le um CSV da CVM em linhas indexadas pelo NOME da coluna.
 *
 * Por nome, e nao por posicao, porque o layout muda entre arquivos do MESMO
 * pacote: a DRE tem `DT_INI_EXERC` e `DT_FIM_EXERC`, a BPP/BPA so tem
 * `DT_FIM_EXERC`, e a DMPL ainda acrescenta `COLUNA_DF`. `CD_CONTA` e o 12o campo num,
 * o 11o no outro e o 13o no terceiro -- ler por indice devolve vazio, ou pior,
 * devolve a coluna vizinha, sem erro.
 *
 * O texto tem que vir decodificado de ISO-8859-1 (`buf.toString("latin1")`).
 * Lido como UTF-8, `Patrimônio` chega quebrado e a comparacao com
 * `COLUNA_DMPL_CONSOLIDADO` falha calada -- e ai `somarDividendos` recusa o
 * arquivo inteiro apontando para a coluna errada.
 */
export function lerCsvCvm(texto: string): readonly LinhaCsv[] {
  const linhas = texto.split(/\r?\n/).filter((l) => l.length > 0);
  if (linhas.length === 0) throw new Error("CSV vazio.");

  const colunas = linhas[0].split(";").map((c) => c.trim());
  const saida: LinhaCsv[] = [];

  for (let i = 1; i < linhas.length; i++) {
    const valores = linhas[i].split(";");
    // Nenhuma das 419.549 linhas do pacote de 2025 tem contagem diferente, e
    // nenhum campo vem entre aspas. Se isso mudar, o `split` passa a desalinhar
    // TODAS as colunas seguintes -- entao a contagem e conferida em vez de
    // suposta: um CSV com campo citado tem que virar erro, nao valor trocado.
    if (valores.length !== colunas.length) {
      throw new Error(
        `CSV da CVM: linha ${i + 1} tem ${valores.length} campos, cabecalho tem ${colunas.length}. ` +
          `O formato mudou (campo entre aspas?) e ler por posicao passou a trocar coluna.`,
      );
    }
    const linha: Record<string, string> = {};
    for (let c = 0; c < colunas.length; c++) linha[colunas[c]] = valores[c].trim();
    saida.push(linha);
  }
  return saida;
}

/** O valor da linha em REAIS, aplicando `ESCALA_MOEDA` (armadilha 3). */
export function valorEmReais(linha: LinhaCsv): number {
  const escala = (linha.ESCALA_MOEDA ?? "").toUpperCase();
  const fator = FATOR_ESCALA[escala];
  if (fator === undefined) throw new Error(`ESCALA_MOEDA desconhecida: ${JSON.stringify(linha.ESCALA_MOEDA)}`);
  const moeda = (linha.MOEDA ?? "").toUpperCase();
  // Todo o pacote de 2025 e REAL. Se a CVM publicar outra moeda, converter sem
  // cotacao seria somar dolar com real -- recusamos.
  if (moeda && moeda !== "REAL") throw new Error(`MOEDA diferente de REAL: ${linha.MOEDA}`);
  const n = Number(linha.VL_CONTA);
  if (!Number.isFinite(n)) throw new Error(`VL_CONTA nao numerico: ${JSON.stringify(linha.VL_CONTA)}`);
  return n * fator;
}

/** O ano do exercicio da linha, tirado de `DT_FIM_EXERC`. */
export function anoDoExercicio(linha: LinhaCsv): number {
  const dt = linha.DT_FIM_EXERC ?? "";
  const ano = Number(dt.slice(0, 4));
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) {
    throw new Error(`DT_FIM_EXERC invalido: ${JSON.stringify(dt)}`);
  }
  return ano;
}

/**
 * Acha UMA conta de UMA empresa, no exercicio pedido.
 *
 * Recusa quando o arquivo traz a mesma conta duas vezes para a mesma empresa e
 * exercicio: hoje a CVM publica uma unica `VERSAO` por (CNPJ, DT_REFER) -- 439
 * empresas, zero duplicadas em 2025 -- mas uma re-apresentacao mudaria isso, e
 * "pegar a primeira" escolheria entre o balanco novo e o antigo pela ordem do
 * arquivo. Melhor recusar a empresa do que gravar o numero retificado ou o
 * original conforme o sorteio.
 */
export function acharConta(
  linhas: readonly LinhaCsv[],
  opcoes: {
    readonly cnpjFormatado: string;
    readonly ano: number;
    /** Os rotulos que identificam o conceito. Comparados normalizados. */
    readonly rotulos: readonly string[];
    /** So onde o rotulo se repete no arquivo (conta-mae x subconta, circulante x nao). */
    readonly codigo?: string;
  },
): number | null {
  const querido = opcoes.rotulos.map(normalizarRotulo);

  let candidatas = linhas.filter(
    (l) => l.CNPJ_CIA === opcoes.cnpjFormatado && anoDoExercicio(l) === opcoes.ano,
  );
  if (opcoes.codigo !== undefined) candidatas = candidatas.filter((l) => l.CD_CONTA === opcoes.codigo);

  // O rotulo e a ultima peneira, e ela nao tem excecao: se nenhum rotulo casar, a
  // conta nao foi publicada COM ESTE SIGNIFICADO por esta empresa, e o campo fica
  // nulo. E o que impede a armadilha 4 -- no Itau o codigo 2.03 existe e vale
  // R$ 2.350,9 bi de "Passivos Financeiros ao Custo Amortizado"; aceitar pelo
  // codigo poria um passivo no lugar do patrimonio. Nulo aqui e "esta empresa nao
  // publica esta conta assim", que e verdade; ler a linha vizinha seria mentira.
  const achadas = candidatas.filter((l) => querido.includes(normalizarRotulo(l.DS_CONTA ?? "")));
  if (achadas.length === 0) return null;

  // A CVM repete linha identica: no pacote de 2025, FGR INCORPORACOES publica o
  // patrimonio 2x e VLI MULTIMODAL 3x, com MESMO codigo, MESMA versao e MESMO
  // valor. Isso e redundancia do arquivo, nao ambiguidade -- recusar a empresa por
  // causa disso tiraria duas companhias validas do banco.
  // Sem `[...new Set(...)]` de proposito: o `tsc` do APP tem target menor que o
  // do build do teste, e o spread sobre Set reprova la com TS2802 depois de
  // passar aqui (`npm run type-check` pega, `npm run test:fundamento-cvm` nao).
  const distintos: number[] = [];
  for (const l of achadas) {
    const v = valorEmReais(l);
    if (!distintos.includes(v)) distintos.push(v);
  }

  // Valores que DISCORDAM e outra historia: ai ha duas respostas para a mesma
  // conta, mesma empresa e mesmo exercicio (re-apresentacao, ou o mesmo rotulo em
  // dois codigos com numeros diferentes). Escolher pela ordem do arquivo gravaria
  // o balanco retificado ou o original por sorteio, sem nada na tela indicando
  // qual dos dois.
  if (distintos.length > 1) {
    const onde = achadas.map((l) => `${l.CD_CONTA}=${l.VL_CONTA} (v${l.VERSAO})`).join(", ");
    throw new Error(
      `${JSON.stringify(opcoes.rotulos[0])} tem ${distintos.length} valores diferentes para ` +
        `${opcoes.cnpjFormatado} em ${opcoes.ano}: ${onde}. ` +
        `Escolher pela ordem do arquivo gravaria o balanco errado.`,
    );
  }
  return distintos[0];
}

/**
 * Dividendo + JCP distribuidos no exercicio, em reais positivos.
 *
 * So a coluna consolidada (armadilha 2). O sinal e invertido porque a DMPL
 * lanca distribuicao como SAIDA do patrimonio (negativo) e o campo guardado
 * significa "quanto foi distribuido".
 *
 * `5.04.11 Dividendos prescritos` fica FORA: e dividendo que voltou para a
 * empresa por nao ter sido sacado -- entra positivo na DMPL. Somar junto
 * abateria distribuicao de verdade com dinheiro que nunca saiu.
 */
export function somarDividendos(
  linhas: readonly LinhaCsv[],
  opcoes: { readonly cnpjFormatado: string; readonly ano: number },
): number | null {
  const daEmpresa = linhas.filter((l) => l.CNPJ_CIA === opcoes.cnpjFormatado && anoDoExercicio(l) === opcoes.ano);
  if (daEmpresa.length === 0) return null;

  const consolidadas = daEmpresa.filter((l) => l.COLUNA_DF === COLUNA_DMPL_CONSOLIDADO);
  if (consolidadas.length === 0) {
    throw new Error(
      `DMPL de ${opcoes.cnpjFormatado} em ${opcoes.ano} nao tem a coluna ${JSON.stringify(COLUNA_DMPL_CONSOLIDADO)}. ` +
        `Somar as outras colunas contaria o mesmo dividendo mais de uma vez.`,
    );
  }

  const codigos: readonly string[] = [CONTAS_DMPL.dividendos, CONTAS_DMPL.jurosSobreCapitalProprio];
  const alvo = consolidadas.filter((l) => codigos.includes(l.CD_CONTA));
  if (alvo.length === 0) return null;

  return -alvo.reduce((soma, l) => soma + valorEmReais(l), 0);
}

// ---------------------------------------------------------------------------
// O que vai para o banco, e o que se deriva dele
// ---------------------------------------------------------------------------

/** Uma linha de `public.cvm_fundamentos`: as poucas contas que os crivos usam. */
export type FundamentoAnual = {
  readonly codigoCvm: string;
  readonly cnpj: string;
  readonly anoExercicio: number;
  /** `DT_FIM_EXERC` do balanco usado -- a data-base que a tela mostra. */
  readonly dataBase: string;
  readonly receitaLiquida: number | null;
  readonly custo: number | null;
  readonly lucroLiquido: number | null;
  readonly patrimonioLiquido: number | null;
  readonly dividaCurtoPrazo: number | null;
  readonly dividaLongoPrazo: number | null;
  readonly caixa: number | null;
  readonly aplicacoesFinanceiras: number | null;
  readonly dividendosDistribuidos: number | null;
  /** Como o arquivo publica, SEM escala declarada -- nao use para "por acao". */
  readonly quantidadeAcoes: number | null;
};

export type Indicadores = {
  readonly roe: number | null;
  readonly margemLiquida: number | null;
  readonly margemBruta: number | null;
  readonly dividaLiquida: number | null;
  readonly dividaLiquidaSobrePatrimonio: number | null;
};

/** Divide devolvendo `null` em vez de `Infinity`/`NaN` quando nao da para dividir. */
function razao(numerador: number | null, denominador: number | null): number | null {
  if (numerador === null || denominador === null) return null;
  if (denominador === 0) return null;
  return numerador / denominador;
}

/**
 * Deriva os indicadores de UMA linha, cada um pela fonte de `FONTES`.
 *
 * Patrimonio liquido NEGATIVO (empresa com passivo a descoberto) zera o ROE e a
 * alavancagem em vez de devolver numero: -50 de lucro sobre -100 de patrimonio
 * daria "ROE 50%", que um crivo de rentabilidade aprovaria. O sinal do
 * denominador inverte o significado da razao, e nao existe leitura correta de
 * "retorno sobre patrimonio" quando nao ha patrimonio.
 */
export function calcularIndicadores(f: FundamentoAnual): Indicadores {
  const patrimonioUtil = f.patrimonioLiquido !== null && f.patrimonioLiquido > 0 ? f.patrimonioLiquido : null;

  const dividaBruta =
    f.dividaCurtoPrazo === null && f.dividaLongoPrazo === null
      ? null
      : (f.dividaCurtoPrazo ?? 0) + (f.dividaLongoPrazo ?? 0);

  const dividaLiquida =
    dividaBruta === null ? null : dividaBruta - (f.caixa ?? 0) - (f.aplicacoesFinanceiras ?? 0);

  const margemBruta =
    f.receitaLiquida === null || f.custo === null || f.receitaLiquida === 0
      ? null
      : // `custo` vem NEGATIVO da DRE (3.02), entao soma-se para obter o lucro bruto.
        (f.receitaLiquida + f.custo) / f.receitaLiquida;

  return {
    roe: razao(f.lucroLiquido, patrimonioUtil),
    margemLiquida: razao(f.lucroLiquido, f.receitaLiquida),
    margemBruta,
    dividaLiquida,
    dividaLiquidaSobrePatrimonio: razao(dividaLiquida, patrimonioUtil),
  };
}
