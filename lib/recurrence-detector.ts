// =====================================================
// DETECTOR DE RECORRENCIAS - assinaturas que ninguem cadastrou
// =====================================================
// Le as transacoes ja importadas (OFX/CSV/manuais) e descobre sozinho quais
// sao cobrancas repetidas: Netflix, academia, seguro, o streaming que subiu de
// preco em silencio.
//
// NAO CONFUNDIR COM lib/recurrence.ts
// ------------------------------------
// Aquele arquivo PROJETA datas de uma regra que o usuario cadastrou
// (`recurring_rules` -> `scheduled_transactions`): o usuario diz "aluguel, dia
// 10, mensal" e a lib calcula os vencimentos. Este aqui faz o caminho
// contrario: parte do extrato real e INFERE a regra. Um nao substitui o outro
// -- o gasto fixo que o usuario cadastrou ele ja conhece; o problema deste
// arquivo e a assinatura que ele esqueceu que assinou.
//
// POR QUE ESTE ARQUIVO NAO IMPORTA NADA
// --------------------------------------
// Nenhum import, nem de tipo, nem com o alias `@/`. O `tsc` resolve o alias
// pelo `paths` mas NAO o reescreve no JS emitido, entao um modulo compilado
// que importa outro quebra com ERR_MODULE_NOT_FOUND assim que o teste tenta
// carrega-lo. Mantendo o arquivo fechado, `scripts/test-recurrence-detector.mjs`
// compila e roda sem passo de reescrita e sem runner novo no package.json.
//
// O SINAL DO VALOR
// -----------------
// Despesa neste banco e gravada NEGATIVA (financial_transactions.amount).
// Todo valor que sai daqui -- avgAmount, lastAmount -- e MODULO, positivo,
// porque a tela mostra "R$ 39,90 por mes" e o total mensal e uma soma de
// quanto custa, nao de quanto entrou. A conversao acontece num lugar so
// (`valorDaDespesa`) de proposito: um `Math.abs` espalhado pelo arquivo e
// exatamente como o sinal se perde.
// =====================================================

export type Frequency = "WEEKLY" | "MONTHLY" | "YEARLY";

export type RecurrenceStatus = "DETECTED" | "CONFIRMED" | "IGNORED" | "CANCELLED";

/** O minimo que o detector precisa de uma transacao. */
export interface TransacaoEntrada {
  id: string;
  description: string;
  /** Negativo para despesa, como o banco grava. */
  amount: number;
  /** 'YYYY-MM-DD'. */
  transaction_date: string;
}

export interface RecurrenceCandidate {
  merchantKey: string;
  displayName: string;
  /** Modulo, sempre positivo. */
  avgAmount: number;
  /** Modulo da cobranca mais recente -- e o que se compara com a media. */
  lastAmount: number;
  frequency: Frequency;
  lastChargeDate: string;
  nextExpectedDate: string;
  /** Quanto essa recorrencia pesa por mes, para somar frequencias diferentes. */
  monthlyCost: number;
  transactionIds: string[];
  occurrences: number;
}

// ---------------------------------------------------------------------------
// 1. Normalizacao da descricao
// ---------------------------------------------------------------------------
// O extrato brasileiro nao escreve o nome do estabelecimento duas vezes igual.
// A mesma Netflix aparece como "NETFLIX.COM*123", "NETFLIX COM SAO PAULO BR" e
// "PAG*NETFLIX". Sem normalizar, cada variacao vira um grupo de uma ocorrencia
// so e o detector nunca chega nas 3 do criterio.

/**
 * Prefixos de subadquirente e gateway. Vem colados no nome com `*` ou espaco:
 * "PAG*ACADEMIA", "MP *SPOTIFY", "EBN*UBER". Sao ruido de quem processou o
 * pagamento, nao do estabelecimento -- e o mesmo lojista troca de gateway sem
 * avisar, o que partiria o grupo em dois no meio da serie.
 */
const PREFIXOS_GATEWAY = [
  "pag",
  "pagm",
  "mp",
  "mercadopago",
  "pp",
  "paypal",
  "ame",
  "ebn",
  "dl",
  "iff",
  "pdg",
  "sumup",
  "stone",
  "cielo",
  "rede",
  "getnet",
  "pagseguro",
];

/**
 * Ruido que o adquirente carimba no fim da linha: praca, pais, meio de
 * pagamento, parcela. "SPOTIFY SAO PAULO BR" e "SPOTIFY" sao o mesmo lojista.
 */
const SUFIXOS_RUIDO = [
  "com",
  "com br",
  "br",
  "bra",
  "brasil",
  "sa",
  "s a",
  "ltda",
  "me",
  "epp",
  "eireli",
  "net",
  "io",
  "app",
  "online",
  "compra",
  "compra cartao",
  "cartao",
  "debito",
  "credito",
  "parcela",
  "parc",
  "mensalidade",
  "assinatura",
  "pagamento",
  "int",
  "intl",
];

/** Capitais e praças que aparecem coladas no nome com mais frequencia. */
const PRACAS = [
  "sao paulo",
  "rio de janeiro",
  "belo horizonte",
  "porto alegre",
  "curitiba",
  "brasilia",
  "salvador",
  "recife",
  "fortaleza",
  "manaus",
  "goiania",
  "campinas",
  "amsterdam",
  "dublin",
  "london",
  "seattle",
  "los gatos",
];

function semAcento(texto: string): string {
  // NFD separa a letra do acento, e U+0300..U+036F e a faixa dos acentos
  // soltos. Escrita em \u de proposito: o caractere combinante literal e
  // invisivel no editor e some no primeiro copiar e colar.
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Reduz a descricao do extrato a uma chave estavel de estabelecimento.
 *
 * Sai o ruido do adquirente -- gateway, praca, sufixo, identificador de
 * transacao -- e fica o nome do lojista. As decisoes que nao sao obvias estao
 * comentadas passo a passo abaixo; a que mais importa e a do token de digito.
 */
export function normalizeMerchant(descricao: string): string {
  if (!descricao) return "";

  let s = semAcento(descricao).toLowerCase();

  // Tudo que nao e letra, digito ou espaco vira espaco: `*`, `-`, `.`, `/`,
  // `#`. Isso ja separa "netflix.com*123" em "netflix com 123".
  s = s.replace(/[^a-z0-9]+/g, " ").trim();
  if (!s) return "";

  // Gateway so conta como prefixo quando e o PRIMEIRO token -- "pag" no fim de
  // "clube pag" e parte do nome.
  let tokens = s.split(" ").filter(Boolean);
  while (tokens.length > 1 && PREFIXOS_GATEWAY.includes(tokens[0])) {
    tokens = tokens.slice(1);
  }

  s = tokens.join(" ");

  // Praca sai antes dos sufixos: "sao paulo" precisa casar inteiro, e depois
  // de cortar "br" no fim ainda sobra "sao paulo" para remover.
  for (const praca of PRACAS) {
    s = s.replace(new RegExp(`\\b${praca}\\b`, "g"), " ");
  }
  s = s.replace(/\s+/g, " ").trim();

  const comDigitos = s;

  // Sai o token que e SO digito -- nunca o digito de dentro de uma palavra.
  //
  // O que se quer remover e identificador de transacao ("...*123"), parcela
  // ("03/12", ja virada em "03 12" acima), ultimos digitos do cartao ("4429")
  // e data colada: todos chegam aqui como token inteiro de digitos.
  //
  // Apagar todo digito, inclusive o de dentro da palavra, era a versao obvia e
  // esta errada: "99*99APP" vira "app", "1password" vira "password" e
  // "123milhas" vira "milhas". O primeiro e o pior dos tres -- "app" e sufixo
  // comum, entao o 99 passaria a colidir com qualquer outro lojista reduzido a
  // "app", e a tela mostraria duas assinaturas diferentes somadas numa linha
  // so.
  s = s
    .split(" ")
    .filter((token) => token && !/^[0-9]+$/.test(token))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  // Sufixos de ruido, do fim para o inicio e repetidamente: "spotify com br"
  // precisa perder "br" e depois "com".
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const sufixo of SUFIXOS_RUIDO) {
      const re = new RegExp(`\\s${sufixo}$`);
      if (re.test(s)) {
        s = s.replace(re, "");
        mudou = true;
      }
    }
  }
  s = s.replace(/\s+/g, " ").trim();

  // A limpeza apagou tudo: o nome era so digito ("99") ou so sufixo. Volta ao
  // estado anterior ao corte de digitos, que ainda distingue um lojista do
  // outro.
  if (!s) return comDigitos;

  return s;
}

// ---------------------------------------------------------------------------
// 2. Datas
// ---------------------------------------------------------------------------
// Mesma regra de ouro de lib/recurrence.ts: data e string 'YYYY-MM-DD' e toda
// a aritmetica roda em UTC. `new Date('2026-03-10')` e UTC e
// `new Date(2026, 2, 10)` e local; misturar os dois anda um dia para tras no
// Brasil inteiro.

function paraUtc(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function paraIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isIsoDate(valor: unknown): valor is string {
  return typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor);
}

export function diasEntre(inicio: string, fim: string): number {
  return Math.round((paraUtc(fim).getTime() - paraUtc(inicio).getTime()) / 86400000);
}

function ultimoDiaDoMes(ano: number, mes1: number): number {
  return new Date(Date.UTC(ano, mes1, 0)).getUTCDate();
}

/**
 * Soma meses sem transbordar. Assinatura cobrada dia 31 nao pode virar dia 3
 * do mes seguinte -- `setUTCMonth` cru faz isso porque 31/02 nao existe.
 */
export function addMonthsClamped(iso: string, meses: number): string {
  const base = paraUtc(iso);
  const dia = base.getUTCDate();
  const total = base.getUTCFullYear() * 12 + base.getUTCMonth() + meses;
  const ano = Math.floor(total / 12);
  const mes = total % 12;
  return paraIso(new Date(Date.UTC(ano, mes, Math.min(dia, ultimoDiaDoMes(ano, mes + 1)))));
}

export function addDays(iso: string, dias: number): string {
  const base = paraUtc(iso);
  base.setUTCDate(base.getUTCDate() + dias);
  return paraIso(base);
}

// ---------------------------------------------------------------------------
// 3. Classificacao da frequencia
// ---------------------------------------------------------------------------

/** Intervalo nominal de cada frequencia, em dias. */
const DIAS_NOMINAIS: Record<Frequency, number> = {
  WEEKLY: 7,
  MONTHLY: 30,
  YEARLY: 365,
};

/**
 * Tolerancia de +/-3 dias do criterio de aceite -- menos no mensal.
 *
 * Mensal precisa de folga maior que 3: o mes tem de 28 a 31 dias, entao a
 * distancia entre duas cobrancas "do dia 15" varia de 28 a 31 por si so, e uma
 * serie que pula de fevereiro para marco da 28 enquanto outra da 31. Com +/-3
 * em torno de 30 a faixa e [27, 33], que cobre todos os meses. E a mesma
 * tolerancia do enunciado; so nao e por acaso que ela funciona aqui.
 *
 * Anual tem a mesma questao com o ano bissexto (365 ou 366), coberta pela
 * faixa [362, 368].
 */
const TOLERANCIA_DIAS: Record<Frequency, number> = {
  WEEKLY: 3,
  MONTHLY: 3,
  YEARLY: 3,
};

export function classificarFrequencia(medianaDias: number): Frequency | null {
  const ordem: Frequency[] = ["WEEKLY", "MONTHLY", "YEARLY"];
  for (const f of ordem) {
    if (Math.abs(medianaDias - DIAS_NOMINAIS[f]) <= TOLERANCIA_DIAS[f]) return f;
  }
  return null;
}

export function mediana(valores: number[]): number {
  if (valores.length === 0) return 0;
  const ordenado = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenado.length / 2);
  return ordenado.length % 2 === 1
    ? ordenado[meio]
    : (ordenado[meio - 1] + ordenado[meio]) / 2;
}

// ---------------------------------------------------------------------------
// 4. Deteccao
// ---------------------------------------------------------------------------

/** Quantas ocorrencias um grupo precisa ter. Criterio de aceite 2. */
export const MIN_OCORRENCIAS = 3;

/** Variacao maxima de valor dentro do grupo. Criterio de aceite 2. */
export const VARIACAO_MAX = 0.1;

/** Acima disso o aumento vira alerta. Criterio de aceite 5. */
export const AUMENTO_ALERTA = 0.1;

/** Despesa e negativa no banco; o produto fala em quanto custa. Ver cabecalho. */
function valorDaDespesa(amount: number): number {
  return Math.abs(amount);
}

/** Custo mensal equivalente, para somar semanal, mensal e anual na mesma linha. */
export function custoMensal(frequency: Frequency, valor: number): number {
  if (frequency === "MONTHLY") return valor;
  if (frequency === "YEARLY") return valor / 12;
  return (valor * 365) / (12 * 7);
}

export function proximaCobranca(frequency: Frequency, ultima: string): string {
  if (frequency === "MONTHLY") return addMonthsClamped(ultima, 1);
  if (frequency === "YEARLY") return addMonthsClamped(ultima, 12);
  return addDays(ultima, 7);
}

/**
 * Nome legivel do grupo: a descricao original mais recente, com as maiusculas
 * arrumadas. A chave normalizada ("netflix") serve para AGRUPAR, nao para
 * mostrar -- "clube de assinatura x" ficaria irreconhecivel na tela.
 */
function nomeParaExibir(descricao: string): string {
  const limpo = semAcento(descricao)
    .replace(/[^A-Za-z0-9\s]+/g, " ")
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const base = limpo || descricao.trim();
  return base
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/**
 * Agrupa as transacoes por estabelecimento e devolve as que se comportam como
 * recorrencia.
 *
 * Regularidade e exigida em TODOS os intervalos, nao so na mediana. Tres
 * compras avulsas no mesmo mercado em 10, 40 e 70 dias tem mediana 30 e
 * passariam por "mensal" se a checagem olhasse so o meio da serie -- e o
 * usuario veria o supermercado listado como assinatura.
 */
export function detectRecurrences(
  transacoes: TransacaoEntrada[],
): RecurrenceCandidate[] {
  const grupos = new Map<string, TransacaoEntrada[]>();

  for (const t of transacoes) {
    // Receita nao e assinatura. Salario cai todo mes, em intervalo regular e
    // valor estavel -- sem este filtro ele e a primeira "assinatura" da lista.
    if (!(t.amount < 0)) continue;
    if (!isIsoDate(t.transaction_date)) continue;

    const chave = normalizeMerchant(t.description);
    if (!chave) continue;

    const atual = grupos.get(chave);
    if (atual) atual.push(t);
    else grupos.set(chave, [t]);
  }

  const saida: RecurrenceCandidate[] = [];

  for (const [merchantKey, itens] of grupos) {
    // Duas cobrancas no mesmo dia (anuidade dividida, retentativa) nao formam
    // intervalo: dariam um intervalo 0 que reprovaria a serie inteira. Contam
    // como uma ocorrencia so, somada.
    const porData = new Map<string, TransacaoEntrada[]>();
    for (const t of itens) {
      const mesmoDia = porData.get(t.transaction_date);
      if (mesmoDia) mesmoDia.push(t);
      else porData.set(t.transaction_date, [t]);
    }

    const datas = [...porData.keys()].sort();
    if (datas.length < MIN_OCORRENCIAS) continue;

    const valores = datas.map((d) =>
      porData.get(d)!.reduce((acc, t) => acc + valorDaDespesa(t.amount), 0),
    );

    const intervalos: number[] = [];
    for (let i = 1; i < datas.length; i++) {
      intervalos.push(diasEntre(datas[i - 1], datas[i]));
    }

    const frequency = classificarFrequencia(mediana(intervalos));
    if (!frequency) continue;

    const nominal = DIAS_NOMINAIS[frequency];
    const tolerancia = TOLERANCIA_DIAS[frequency];
    // Um unico intervalo fora da faixa reprova o grupo. Ver o comentario da
    // funcao: a mediana sozinha aceita serie irregular.
    const regular = intervalos.every((d) => Math.abs(d - nominal) <= tolerancia);
    if (!regular) continue;

    const media = valores.reduce((a, b) => a + b, 0) / valores.length;
    if (media <= 0) continue;
    const estavel = valores.every((v) => Math.abs(v - media) / media <= VARIACAO_MAX);
    if (!estavel) continue;

    const ultimaData = datas[datas.length - 1];
    const ultimoValor = valores[valores.length - 1];
    const displayName = nomeParaExibir(
      porData.get(ultimaData)![0].description,
    );

    saida.push({
      merchantKey,
      displayName,
      avgAmount: arredondar(media),
      lastAmount: arredondar(ultimoValor),
      frequency,
      lastChargeDate: ultimaData,
      nextExpectedDate: proximaCobranca(frequency, ultimaData),
      monthlyCost: arredondar(custoMensal(frequency, media)),
      transactionIds: datas.flatMap((d) => porData.get(d)!.map((t) => t.id)),
      occurrences: datas.length,
    });
  }

  // Mais caro por mes primeiro: a tela existe para decidir o que cancelar.
  saida.sort((a, b) => b.monthlyCost - a.monthlyCost || a.merchantKey.localeCompare(b.merchantKey));

  return saida;
}

/**
 * Comeco da janela de analise: 6 meses atras, no formato que a coluna
 * `transaction_date` usa. Criterio de aceite 1.
 *
 * Fica aqui, e nao na rota, porque a janela faz parte da definicao do
 * detector: mudar para 12 meses muda o que conta como recorrencia anual (com 6
 * meses nenhuma serie anual chega a 3 ocorrencias), e isso precisa mudar junto
 * com os testes, nao no meio de um handler HTTP.
 */
export function inicioDaJanela(hoje: string, meses = 6): string {
  return addMonthsClamped(hoje, -meses);
}

/** Duas casas, como o `numeric(15,2)` da coluna. */
function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/** Soma do que as recorrencias custam por mes. Criterio de aceite 3. */
export function totalMensal(recorrencias: { monthlyCost: number }[]): number {
  return arredondar(recorrencias.reduce((acc, r) => acc + r.monthlyCost, 0));
}

// ---------------------------------------------------------------------------
// 5. Alertas
// ---------------------------------------------------------------------------

export type AlertaTipo = "PRICE_INCREASE" | "CHARGED_AFTER_CANCEL";

export interface Alerta {
  tipo: AlertaTipo;
  merchantKey: string;
  displayName: string;
  mensagem: string;
  /** Presente so no aumento de preco. */
  variacao?: number;
}

/**
 * Compara a ultima cobranca com a media das ANTERIORES.
 *
 * A media das anteriores, e nao a media geral: a propria cobranca nova puxa a
 * media para cima e dilui o aumento que se quer detectar. Numa serie de 4
 * meses, um salto de 10% na ultima vira ~7,5% se entrar na conta -- ficaria
 * abaixo do limite e o alerta nunca sairia.
 *
 * Alem disso, um grupo so vira recorrencia com variacao de ate 10% (criterio
 * 2), entao o reajuste que estoura o limite normalmente PARTE a serie: as
 * cobrancas velhas ficam de fora e o grupo detectado ja comeca no preco novo.
 * Por isso esta funcao recebe a serie bruta do estabelecimento, nao o
 * candidato aprovado.
 */
export function alertaDeAumento(
  merchantKey: string,
  displayName: string,
  valoresEmOrdem: number[],
): Alerta | null {
  if (valoresEmOrdem.length < 2) return null;

  const anteriores = valoresEmOrdem.slice(0, -1).map(valorDaDespesa);
  const ultimo = valorDaDespesa(valoresEmOrdem[valoresEmOrdem.length - 1]);
  const mediaAnterior = anteriores.reduce((a, b) => a + b, 0) / anteriores.length;
  if (mediaAnterior <= 0) return null;

  const variacao = (ultimo - mediaAnterior) / mediaAnterior;
  if (variacao <= AUMENTO_ALERTA) return null;

  return {
    tipo: "PRICE_INCREASE",
    merchantKey,
    displayName,
    variacao: Math.round(variacao * 1000) / 1000,
    mensagem: `${displayName} subiu ${(variacao * 100).toFixed(1)}% (de ${formatarBRL(mediaAnterior)} para ${formatarBRL(ultimo)}).`,
  };
}

/**
 * Cobranca depois de marcada como cancelada. Criterio de aceite 4.
 *
 * `desdeData` e a data em que o usuario marcou o cancelamento, e a comparacao
 * e estritamente maior: a propria cobranca que motivou o cancelamento e
 * anterior ou igual, e dispararia um alerta no mesmo instante do clique.
 */
export function alertaDeCobrancaAposCancelamento(
  merchantKey: string,
  displayName: string,
  status: RecurrenceStatus,
  desdeData: string,
  cobrancas: TransacaoEntrada[],
): Alerta | null {
  if (status !== "CANCELLED") return null;
  if (!isIsoDate(desdeData)) return null;

  const depois = cobrancas
    .filter((t) => t.amount < 0 && isIsoDate(t.transaction_date))
    .filter((t) => t.transaction_date > desdeData)
    .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));

  if (depois.length === 0) return null;

  const primeira = depois[0];
  return {
    tipo: "CHARGED_AFTER_CANCEL",
    merchantKey,
    displayName,
    mensagem: `${displayName} foi marcada como cancelada, mas cobrou ${formatarBRL(valorDaDespesa(primeira.amount))} em ${formatarData(primeira.transaction_date)}.`,
  };
}

function formatarBRL(valor: number): string {
  return `R$ ${valor.toFixed(2).replace(".", ",")}`;
}

function formatarData(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
