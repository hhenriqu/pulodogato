// =====================================================
// EXTRATO BANCARIO - leitura de OFX/CSV e conciliacao
// =====================================================
// Este arquivo NAO fala com o banco de dados e nao importa nada do projeto: e
// so aritmetica e texto, pelo mesmo motivo de lib/recurrence.ts e
// lib/settlement.ts -- assim o teste compila o arquivo sozinho e roda em
// node --test, sem subir Next nem Supabase.
//
// O QUE ESTA AQUI DECIDE DINHEIRO
// --------------------------------
// Tres coisas, e as tres erram em silencio se estiverem erradas:
//
//   1. O SINAL. Despesa e gravada NEGATIVA em financial_transactions. O
//      <TRNAMT> do OFX ja vem negativo num debito e esta leitura PRESERVA o
//      sinal. Um Math.abs() em qualquer ponto faria toda despesa importada
//      virar receita, e os quatro relatorios do 008 mostrariam um mes de lucro
//      onde houve um mes de gasto -- sem nenhum erro aparecer na tela.
//
//   2. O VALOR EM PORTUGUES. "1.234,56" em parseFloat() da 1.234. Um extrato
//      de R$ 1.234,56 entraria como R$ 1,23 e o usuario so descobriria
//      conferindo o saldo. Ver `lerValor`.
//
//   3. A DATA AMBIGUA. "03/04/2026" e 3 de abril no Brasil e 4 de marco nos
//      EUA. Ver `lerData`: a regra e dd/mm, com deteccao quando um dos campos
//      passa de 12, e um aviso quando nao da para ter certeza.
//
// O QUE ESTE ARQUIVO NAO FAZ
// --------------------------
// Nao escreve em financial_transactions. O extrato para em statement_entries,
// que e area de espera -- o porque esta no cabecalho da migration 009.
// =====================================================

/** Uma linha lida do arquivo, antes de virar lancamento. */
export interface StatementEntry {
  /** id unico do banco (OFX <FITID>). NULL no CSV, que nao tem nada parecido. */
  fitId: string | null;
  /** chave de deduplicacao; o indice unico do 009 e (account_id, fingerprint). */
  fingerprint: string;
  /** 'YYYY-MM-DD' */
  postedAt: string;
  /** SINAL PRESERVADO: negativo = saiu da conta. */
  amount: number;
  description: string;
  memo: string | null;
}

export interface ParseResult {
  format: "ofx" | "csv";
  entries: StatementEntry[];
  periodStart: string | null;
  periodEnd: string | null;
  /**
   * O que o parser decidiu sem ter certeza. Vai para a tela ANTES de o usuario
   * confirmar: um extrato lido com o formato de data errado tem todas as
   * linhas plausiveis, e o unico momento de pegar isso e antes de importar.
   */
  warnings: string[];
}

/** Um lancamento que ja existe no app, para a conciliacao comparar. */
export interface ExistingTransaction {
  id: string;
  /** mesma convencao de sinal de financial_transactions. */
  amount: number;
  /** 'YYYY-MM-DD' */
  transaction_date: string;
  description: string;
}

export interface Match {
  fingerprint: string;
  /** o lancamento que ja existia, ou null se a linha e nova. */
  transactionId: string | null;
  /** distancia em dias entre o extrato e o lancamento. null quando nao casou. */
  dayGap: number | null;
  /** 0..1, quanto as descricoes se parecem. null quando nao casou. */
  similarity: number | null;
}

/** Quantos dias de folga entre a compra e a data que o banco registrou. */
export const TOLERANCIA_DIAS_PADRAO = 3;

// =====================================================
// Texto
// =====================================================

/**
 * Descricao normalizada para deduplicacao e comparacao.
 *
 * O NFD + remocao de acento nao e capricho: um extrato reexportado em latin1 e
 * outro em utf8 trazem "MERCADO SAO JOAO" com bytes diferentes. Sem normalizar,
 * a mesma linha reimportada ganharia outro fingerprint e entraria duas vezes --
 * que e exatamente o que a deduplicacao existe para impedir.
 */
export function normalizarDescricao(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// =====================================================
// Valor
// =====================================================

/**
 * Le um valor monetario em pt-BR ou en-US, preservando o sinal.
 *
 * A regra e uma so: **o ultimo separador e o decimal**. Ela resolve os dois
 * formatos sem precisar saber de antemao qual e qual:
 *
 *   "1.234,56" -> ultimo e ','  -> 1234.56
 *   "1,234.56" -> ultimo e '.'  -> 1234.56
 *
 * Quando so ha um tipo de separador ele e ambiguo, e o desempate e pela
 * quantidade de digitos depois dele: exatamente 3 e milhar ("1,234" = 1234),
 * qualquer outra coisa e decimal ("1,5" = 1.5; "1,234567" = 1.234567). Essa e a
 * convencao que os dois formatos respeitam.
 *
 * Devolve null em vez de NaN: NaN se propaga em silencio por toda a aritmetica
 * seguinte e so aparece na tela como "R$ NaN", depois de ja ter sido gravado.
 */
export function lerValor(bruto: string): number | null {
  if (bruto == null) return null;

  // "R$ 1.234,56", "1.234,56 D", "(1.234,56)" — o parenteses e negativo na
  // exportacao de planilha, convencao contabil.
  let texto = String(bruto).trim();
  if (!texto) return null;

  const negativoPorParentese = /^\(.*\)$/.test(texto);
  if (negativoPorParentese) texto = texto.slice(1, -1);

  // sufixo D/C de alguns extratos brasileiros: D = debito.
  let negativoPorSufixo = false;
  const sufixo = texto.match(/\s+([DC])$/i);
  if (sufixo) {
    negativoPorSufixo = sufixo[1].toUpperCase() === "D";
    texto = texto.slice(0, sufixo.index).trim();
  }

  texto = texto.replace(/[R$\s\u00a0]/gi, "");

  const negativoPorSinal = texto.startsWith("-");
  if (negativoPorSinal || texto.startsWith("+")) texto = texto.slice(1);

  if (!/^[\d.,]+$/.test(texto) || !/\d/.test(texto)) return null;

  const ultimoPonto = texto.lastIndexOf(".");
  const ultimaVirgula = texto.lastIndexOf(",");
  const ultimoSeparador = Math.max(ultimoPonto, ultimaVirgula);

  let normalizado: string;
  if (ultimoSeparador === -1) {
    normalizado = texto;
  } else if (ultimoPonto !== -1 && ultimaVirgula !== -1) {
    // os dois aparecem: o ultimo e o decimal, o outro e milhar.
    normalizado =
      texto.slice(0, ultimoSeparador).replace(/[.,]/g, "") +
      "." +
      texto.slice(ultimoSeparador + 1);
  } else {
    const casas = texto.length - ultimoSeparador - 1;
    const separador = texto[ultimoSeparador];
    const ocorrencias = texto.split(separador).length - 1;
    // "1.234.567" -> tres digitos depois E mais de um separador: milhar.
    // "1,234"     -> tres digitos depois: milhar, pela convencao dos dois formatos.
    if (casas === 3 && (ocorrencias > 1 || /^\d{1,3}$/.test(texto.slice(0, ultimoSeparador)))) {
      normalizado = texto.replace(/[.,]/g, "");
    } else {
      normalizado = texto.replace(/[.,]/g, (m, i) => (i === ultimoSeparador ? "." : ""));
    }
  }

  const valor = Number(normalizado);
  if (!Number.isFinite(valor)) return null;

  const negativo = negativoPorSinal || negativoPorParentese || negativoPorSufixo;
  // arredonda em 2 casas: numeric(15,2) no banco, e 0.1+0.2 em float existe.
  const emCentavos = Math.round(valor * 100);
  return (negativo ? -emCentavos : emCentavos) / 100;
}

// =====================================================
// Data
// =====================================================

const DIAS_NO_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function bissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

function dataValida(ano: number, mes: number, dia: number): boolean {
  if (ano < 1900 || ano > 2999 || mes < 1 || mes > 12 || dia < 1) return false;
  const limite = mes === 2 && bissexto(ano) ? 29 : DIAS_NO_MES[mes - 1];
  return dia <= limite;
}

function iso(ano: number, mes: number, dia: number): string {
  return `${String(ano).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * Data do OFX: `YYYYMMDD`, `YYYYMMDDHHMMSS`, `20260131120000.000[-3:BRT]`.
 *
 * Os 8 primeiros caracteres sao fatiados, e NAO passados por `new Date()`. O
 * motivo: `new Date("20260131120000[-3:BRT]")` nao e uma data valida em lugar
 * nenhum, e mesmo a forma limpa passaria pelo fuso do servidor. Um servidor em
 * UTC lendo "1 de janeiro 00:00 BRT" devolveria 31 de dezembro -- e um gasto de
 * janeiro cairia no relatorio de dezembro, no mes errado e no ano errado.
 *
 * Pela especificacao do OFX a data ja vem no fuso que o proprio campo declara,
 * entao fatiar da exatamente o dia que o banco quis dizer.
 */
export function lerDataOfx(bruto: string): string | null {
  const digitos = String(bruto ?? "").trim();
  if (!/^\d{8}/.test(digitos)) return null;

  const ano = Number(digitos.slice(0, 4));
  const mes = Number(digitos.slice(4, 6));
  const dia = Number(digitos.slice(6, 8));

  return dataValida(ano, mes, dia) ? iso(ano, mes, dia) : null;
}

/** 'dmy' = 10/09/2026 e 10 de setembro. 'mdy' = e 9 de outubro. */
export type FormatoData = "dmy" | "mdy";

export interface FormatoDetectado {
  formato: FormatoData;
  /** false quando NENHUMA linha do arquivo desfez a ambiguidade. */
  certo: boolean;
}

interface PartesData {
  p1: number;
  p2: number;
  ano: number;
}

function partirData(texto: string): PartesData | null {
  const partes = texto.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (!partes) return null;

  let ano = Number(partes[3]);
  // 'DD/MM/YY': 00-69 => 2000s, 70-99 => 1900s, a mesma janela do POSIX.
  if (partes[3].length === 2) ano += ano <= 69 ? 2000 : 1900;

  return { p1: Number(partes[1]), p2: Number(partes[2]), ano };
}

/**
 * Decide dd/mm ou mm/dd olhando o ARQUIVO INTEIRO, nao a linha.
 *
 * Linha a linha, "10/09/2026" e ambiguo -- e tambem 01/02, 03/04, 11/12. Como
 * os dois campos de um extrato brasileiro caem em 1..12 durante os doze
 * primeiros dias de todo mes, um aviso linha a linha apareceria na maioria dos
 * arquivos. Aviso que aparece quase sempre nao e lido, e o dia em que a data
 * estivesse REALMENTE trocada ele passaria junto com os outros.
 *
 * Um extrato de um mes quase sempre tem pelo menos um dia acima de 12, e esse
 * dia resolve o arquivo todo: se o primeiro campo passa de 12 em qualquer
 * linha, o arquivo e dd/mm e nenhuma linha dele e ambigua. So quando NENHUMA
 * linha desfaz o empate e que `certo` volta false e a tela avisa.
 */
export function detectarFormatoDeData(valores: string[]): FormatoDetectado {
  let evidenciaDmy = false;
  let evidenciaMdy = false;

  for (const v of valores) {
    const p = partirData(String(v ?? "").trim());
    if (!p) continue;
    if (p.p1 > 12) evidenciaDmy = true;
    if (p.p2 > 12) evidenciaMdy = true;
  }

  // As duas evidencias juntas significam um arquivo com datas em dois formatos,
  // ou uma coluna que nao e data. dd/mm e o palpite, mas avisando.
  if (evidenciaDmy && evidenciaMdy) return { formato: "dmy", certo: false };
  if (evidenciaDmy) return { formato: "dmy", certo: true };
  if (evidenciaMdy) return { formato: "mdy", certo: true };
  return { formato: "dmy", certo: false };
}

/**
 * Data de CSV: 'YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY', 'DD/MM/YY'.
 *
 * ISO e reconhecido sozinho, pelo tamanho do primeiro campo. Para o resto, o
 * `formato` vem de `detectarFormatoDeData` sobre o arquivo inteiro -- ver ali
 * por que a decisao nao pode ser por linha.
 *
 * Quando a leitura no formato escolhido da uma data impossivel (31/04 num
 * arquivo lido como mm/dd), a outra ordem e tentada antes de desistir: e melhor
 * aproveitar a linha do que descartar um lancamento de verdade.
 */
export function lerData(bruto: string, formato: FormatoData = "dmy"): string | null {
  const texto = String(bruto ?? "").trim();
  if (!texto) return null;

  const isoDireto = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoDireto) {
    const [, a, m, d] = isoDireto;
    return dataValida(+a, +m, +d) ? iso(+a, +m, +d) : null;
  }

  const p = partirData(texto);
  if (!p) return null;

  const [primeiro, segundo] =
    formato === "dmy" ? [p.p2, p.p1] : [p.p1, p.p2]; // [mes, dia]

  if (dataValida(p.ano, primeiro, segundo)) return iso(p.ano, primeiro, segundo);
  if (dataValida(p.ano, segundo, primeiro)) return iso(p.ano, segundo, primeiro);
  return null;
}

function distanciaEmDias(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.round(Math.abs(ms) / 86400000);
}

// =====================================================
// Fingerprint
// =====================================================

/**
 * A chave de deduplicacao. Uma regra so para OFX e CSV -- duas regras seriam
 * duas versoes da mesma coisa, e a segunda para de acompanhar a primeira.
 *
 * O `#n` e o que evita um falso positivo caro: dois cafes de R$ 8,00 no mesmo
 * dia e na mesma cafeteria sao dois fatos, nao um repetido. Como o n e a ordem
 * entre as linhas IDENTICAS do arquivo, reimportar o mesmo arquivo devolve
 * exatamente os mesmos fingerprints (e nao duplica nada), enquanto dois cafes
 * de verdade recebem #1 e #2 e entram os dois.
 */
export function fingerprint(
  entrada: { fitId: string | null; postedAt: string; amount: number; description: string },
  ordinal: number
): string {
  if (entrada.fitId) return `fitid:${entrada.fitId}`;
  return [
    "h",
    entrada.postedAt,
    entrada.amount.toFixed(2),
    normalizarDescricao(entrada.description),
    `#${ordinal}`,
  ].join("|");
}

/** Aplica o ordinal a uma lista ja lida, na ordem do arquivo. */
function comFingerprints(
  brutas: Array<Omit<StatementEntry, "fingerprint">>
): StatementEntry[] {
  const vistos = new Map<string, number>();
  return brutas.map((e) => {
    const chaveBase = e.fitId
      ? `fitid:${e.fitId}`
      : `${e.postedAt}|${e.amount.toFixed(2)}|${normalizarDescricao(e.description)}`;
    const n = (vistos.get(chaveBase) ?? 0) + 1;
    vistos.set(chaveBase, n);
    return { ...e, fingerprint: fingerprint(e, n) };
  });
}

// =====================================================
// OFX
// =====================================================

/**
 * Le o valor de uma tag em OFX 1.x (SGML, sem fechamento) e 2.x (XML).
 * A leitura para no proximo '<' ou na quebra de linha, que cobre os dois.
 */
function campoOfx(bloco: string, tag: string): string | null {
  const m = bloco.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, "i"));
  const valor = m?.[1]?.trim();
  return valor ? valor : null;
}

export function parseOfx(conteudo: string): ParseResult {
  const warnings: string[] = [];
  const brutas: Array<Omit<StatementEntry, "fingerprint">> = [];

  const blocos = conteudo.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];

  if (blocos.length === 0 && /<OFX>/i.test(conteudo)) {
    warnings.push(
      "O arquivo parece OFX mas nao tem nenhum bloco <STMTTRN>. Exporte o extrato de novo, escolhendo o periodo."
    );
  }

  for (const bloco of blocos) {
    const dataBruta = campoOfx(bloco, "DTPOSTED") ?? campoOfx(bloco, "DTUSER");
    const valorBruto = campoOfx(bloco, "TRNAMT");
    const postedAt = dataBruta ? lerDataOfx(dataBruta) : null;
    const amount = valorBruto ? lerValor(valorBruto) : null;

    if (!postedAt || amount === null || amount === 0) {
      warnings.push(
        `Linha ignorada: data "${dataBruta ?? "?"}" ou valor "${valorBruto ?? "?"}" ilegivel.`
      );
      continue;
    }

    const memo = campoOfx(bloco, "MEMO");
    const name = campoOfx(bloco, "NAME");

    brutas.push({
      fitId: campoOfx(bloco, "FITID"),
      postedAt,
      amount,
      // NAME e o estabelecimento, MEMO e o complemento. Sem nenhum dos dois a
      // linha ainda vale: o valor e a data sao o que importa.
      description: name ?? memo ?? "Lancamento sem descricao",
      memo: name && memo ? memo : null,
    });
  }

  const entries = comFingerprints(brutas);

  // Periodo declarado pelo proprio arquivo; sem ele, o intervalo das linhas.
  const declaradoInicio = lerDataOfx(campoOfx(conteudo, "DTSTART") ?? "");
  const declaradoFim = lerDataOfx(campoOfx(conteudo, "DTEND") ?? "");
  const datas = entries.map((e) => e.postedAt).sort();

  return {
    format: "ofx",
    entries,
    periodStart: declaradoInicio ?? datas[0] ?? null,
    periodEnd: declaradoFim ?? datas[datas.length - 1] ?? null,
    warnings,
  };
}

// =====================================================
// CSV
// =====================================================

/**
 * Descobre o separador de colunas.
 *
 * Contar virgulas nao serve: o extrato brasileiro e separado por ';' e os
 * valores VEM com virgula decimal ("10/09/2026;MERCADO;-1.234,56"). A virgula
 * ganharia a contagem e o arquivo seria partido no meio de cada valor.
 *
 * Entao a escolha e pelo separador que produz a MESMA quantidade de colunas em
 * todas as linhas (e mais de uma), com ';' e tab antes de ',' no desempate --
 * essa consistencia e o que distingue um separador de verdade de um caractere
 * que so aparece dentro dos campos.
 */
export function detectarSeparador(linhas: string[]): string {
  const candidatos = [";", "\t", ",", "|"];
  const amostra = linhas.slice(0, 10);
  let melhor = ";";
  let melhorNota = -1;

  for (const sep of candidatos) {
    const contagens = amostra.map((l) => dividirLinha(l, sep).length);
    const colunas = contagens[0] ?? 0;
    if (colunas < 2) continue;
    const consistente = contagens.every((c) => c === colunas);
    const nota = (consistente ? 1000 : 0) + colunas;
    if (nota > melhorNota) {
      melhorNota = nota;
      melhor = sep;
    }
  }

  return melhor;
}

/** Divide uma linha respeitando aspas duplas, inclusive as escapadas ("" ). */
export function dividirLinha(linha: string, separador: string): string[] {
  const campos: string[] = [];
  let atual = "";
  let dentroDeAspas = false;

  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (dentroDeAspas && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else {
        dentroDeAspas = !dentroDeAspas;
      }
    } else if (c === separador && !dentroDeAspas) {
      campos.push(atual);
      atual = "";
    } else {
      atual += c;
    }
  }
  campos.push(atual);
  return campos.map((c) => c.trim());
}

const CABECALHOS_DATA = ["data", "date", "data lancamento", "data movimento", "dt"];
const CABECALHOS_VALOR = ["valor", "amount", "value", "montante", "quantia"];
const CABECALHOS_DESCRICAO = ["descricao", "description", "historico", "memo", "lancamento", "detalhe"];

function acharColuna(cabecalho: string[], nomes: string[]): number {
  return cabecalho.findIndex((c) => nomes.includes(normalizarDescricao(c)));
}

export function parseCsv(conteudo: string): ParseResult {
  const warnings: string[] = [];
  const linhas = conteudo
    .replace(/^\uFEFF/, "") // BOM do Excel; sem isto a primeira coluna nunca casa
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim().length > 0);

  if (linhas.length === 0) {
    return { format: "csv", entries: [], periodStart: null, periodEnd: null, warnings: ["Arquivo vazio."] };
  }

  const separador = detectarSeparador(linhas);
  const primeira = dividirLinha(linhas[0], separador);

  let iData = acharColuna(primeira, CABECALHOS_DATA);
  let iValor = acharColuna(primeira, CABECALHOS_VALOR);
  let iDescricao = acharColuna(primeira, CABECALHOS_DESCRICAO);
  let corpo = linhas.slice(1);

  if (iData === -1 || iValor === -1) {
    // Sem cabecalho reconhecido: assume data / descricao / valor, que e a ordem
    // da esmagadora maioria dos extratos, e avisa. Avisar importa: se a ordem
    // estiver trocada, TODAS as linhas saem plausiveis e erradas.
    iData = 0;
    iDescricao = 1;
    iValor = 2;
    corpo = linhas;
    warnings.push(
      "Sem cabecalho reconhecido. Assumi as colunas na ordem data, descricao, valor - confira as linhas abaixo antes de importar."
    );
  }

  // Varredura previa da coluna de data: o formato e uma propriedade do ARQUIVO
  // e precisa estar decidido antes da primeira linha ser lida. Decidir linha a
  // linha faria "10/09" e "13/09" do mesmo extrato saírem em formatos
  // diferentes -- setembro numa e outubro na outra.
  const colunaDeDatas = corpo.map((l) => dividirLinha(l, separador)[iData] ?? "");
  const naoIso = colunaDeDatas.filter((v) => !/^\d{4}-/.test(v.trim()) && v.trim());
  const deteccao = detectarFormatoDeData(naoIso);

  const brutas: Array<Omit<StatementEntry, "fingerprint">> = [];

  for (const linha of corpo) {
    const campos = dividirLinha(linha, separador);
    const postedAt = lerData(campos[iData] ?? "", deteccao.formato);
    const amount = lerValor(campos[iValor] ?? "");

    if (!postedAt || amount === null || amount === 0) continue;

    brutas.push({
      fitId: null,
      postedAt,
      amount,
      description: (iDescricao >= 0 ? campos[iDescricao] : "")?.trim() || "Lancamento sem descricao",
      memo: null,
    });
  }

  // So avisa quando NENHUMA linha do arquivo desfez o empate -- ver
  // detectarFormatoDeData.
  if (naoIso.length > 0 && !deteccao.certo) {
    warnings.push(
      "Nenhuma data deste arquivo passa do dia 12, entao dd/mm e mm/dd dariam meses diferentes. Li como dd/mm (padrao brasileiro) - confira o mes antes de importar."
    );
  }

  if (brutas.length === 0 && corpo.length > 0) {
    warnings.push(
      "Nenhuma linha legivel. Confira se o separador do arquivo e ';' ou ',' e se ha uma coluna de data e uma de valor."
    );
  }

  const entries = comFingerprints(brutas);
  const datas = entries.map((e) => e.postedAt).sort();

  return {
    format: "csv",
    entries,
    periodStart: datas[0] ?? null,
    periodEnd: datas[datas.length - 1] ?? null,
    warnings,
  };
}

/** Escolhe o parser pelo conteudo, nao pela extensao (que o usuario renomeia). */
export function parseStatement(conteudo: string): ParseResult {
  return /<STMTTRN>|<OFX>|OFXHEADER/i.test(conteudo) ? parseOfx(conteudo) : parseCsv(conteudo);
}

// =====================================================
// Conciliacao
// =====================================================

function semelhanca(a: string, b: string): number {
  const ta = new Set(normalizarDescricao(a).split(" ").filter((t) => t.length > 2));
  const tb = new Set(normalizarDescricao(b).split(" ").filter((t) => t.length > 2));
  if (ta.size === 0 || tb.size === 0) return 0;

  let comuns = 0;
  ta.forEach((t) => {
    if (tb.has(t)) comuns++;
  });
  return comuns / Math.max(ta.size, tb.size);
}

/**
 * Casa as linhas do extrato com os lancamentos que o usuario ja fez a mao.
 *
 * Sem esta etapa o import dobra o mes: metade do extrato JA ESTA lancado, e
 * cada almoco apareceria duas vezes.
 *
 * Tres regras, e a terceira e a que custa dinheiro se faltar:
 *
 *   1. O valor tem que bater EXATAMENTE, com sinal. Casar por aproximacao
 *      ligaria um almoco de R$ 32,00 a um de R$ 32,50 e o usuario perderia o
 *      lancamento certo sem ver.
 *   2. A data pode ter ate `toleranciaDias` de folga: a compra no cartao e de
 *      sexta e o banco registra na segunda.
 *   3. Cada lancamento existente e reivindicado por NO MAXIMO UMA linha. Sem
 *      isso, dois saques de R$ 50,00 no extrato casariam os dois com o UNICO
 *      saque de R$ 50,00 ja lancado -- e o segundo saque, que e dinheiro de
 *      verdade que saiu da conta, sumiria do app para sempre.
 *
 * A atribuicao e gulosa sobre todos os pares possiveis ordenados por qualidade
 * (menor distancia de data, maior semelhanca de descricao), e nao na ordem do
 * arquivo: assim a melhor combinacao global ganha, em vez de a primeira linha
 * do arquivo levar um lancamento que casava muito melhor com outra.
 */
export function conciliar(
  entries: StatementEntry[],
  existentes: ExistingTransaction[],
  opcoes: { toleranciaDias?: number } = {}
): Match[] {
  const tolerancia = opcoes.toleranciaDias ?? TOLERANCIA_DIAS_PADRAO;

  interface Par {
    iEntrada: number;
    iExistente: number;
    dias: number;
    sim: number;
  }
  const pares: Par[] = [];

  entries.forEach((entrada, iEntrada) => {
    existentes.forEach((existente, iExistente) => {
      // centavos inteiros: 32.00 !== 32.000000000000004 em float
      if (Math.round(entrada.amount * 100) !== Math.round(existente.amount * 100)) return;

      const dias = distanciaEmDias(entrada.postedAt, existente.transaction_date);
      if (dias > tolerancia) return;

      pares.push({
        iEntrada,
        iExistente,
        dias,
        sim: semelhanca(entrada.description, existente.description),
      });
    });
  });

  pares.sort(
    (a, b) => a.dias - b.dias || b.sim - a.sim || a.iEntrada - b.iEntrada || a.iExistente - b.iExistente
  );

  const entradaUsada = new Set<number>();
  const existenteUsado = new Set<number>();
  const porEntrada = new Map<number, Par>();

  for (const par of pares) {
    if (entradaUsada.has(par.iEntrada) || existenteUsado.has(par.iExistente)) continue;
    entradaUsada.add(par.iEntrada);
    existenteUsado.add(par.iExistente);
    porEntrada.set(par.iEntrada, par);
  }

  return entries.map((entrada, i) => {
    const par = porEntrada.get(i);
    return {
      fingerprint: entrada.fingerprint,
      transactionId: par ? existentes[par.iExistente].id : null,
      dayGap: par ? par.dias : null,
      similarity: par ? Number(par.sim.toFixed(2)) : null,
    };
  });
}

/** O tipo do lancamento sai do SINAL, e de mais nada. Ver o topo do arquivo. */
export function tipoPeloSinal(amount: number): "expense" | "income" {
  return amount < 0 ? "expense" : "income";
}
