// =====================================================
// ANOMALIA DE GASTO E RESUMO DO MES FECHADO (HMO-154)
// =====================================================
// Categoria 8 da lista da HMO-145. Sao duas perguntas diferentes e este arquivo
// responde as duas com UM unico motor de comparacao, de proposito:
//
//   - "este mes esta fora do meu normal?"  -> `detectarAnomalias`, mes corrente
//   - "como foi o mes que fechou?"         -> `resumoDoMesFechado`
//
// Se cada uma tivesse a sua propria nocao de "normal", o resumo de outubro
// poderia dizer que setembro foi tipico enquanto o alerta de setembro, emitido
// no dia 20, gritava que estava caro. Duas respostas divergentes sobre o mesmo
// mes, as duas defensaveis, e nenhuma forma de saber qual olhar. Por isso as
// duas entradas terminam em `compararComHistorico`.
//
// Tudo aqui e funcao pura: nao le banco, nao pede login, nao grava nada. Mesmo
// desenho do lib/safe-to-spend.ts e do lib/net-worth.ts, e pela mesma razao --
// e o que permite a prova de correcao caber em teste unitario.
//
// -----------------------------------------------------------------------
// POR QUE A MEDIANA, E NAO A MEDIA
// -----------------------------------------------------------------------
// O criterio precisa resistir a mes de ferias. Com seis meses de historico em
// que cinco custaram 400 e um (dezembro) custou 2.400, a media da base e 733 --
// ou seja, um unico mes atipico levanta a regua em 83% e passa a esconder
// exatamente o estouro que o alerta existe para achar. A mediana desses mesmos
// seis meses e 400, e nao se move.
//
// O preco e conhecido e aceito: a mediana ignora a magnitude do outlier. Aqui
// isso e a feature, nao o defeito -- quem gastou o triplo em dezembro nao quer
// que dezembro vire o novo normal de janeiro.
//
// -----------------------------------------------------------------------
// AS QUATRO ARMADILHAS, E ONDE CADA UMA E FECHADA
// -----------------------------------------------------------------------
//
//   1. O SINAL. Despesa e gravada NEGATIVA neste banco. Um `SUM(amount)` cru
//      devolve -800 para quem gastou 800, e ai todo o resto inverte: o mes caro
//      vira o mes barato e o alerta sai para a pessoa errada. Pior, um fixture
//      de teste com valor positivo passa verde sem provar nada. Aqui existe UM
//      lugar que le `amount` -- `gastoDaTransacao` -- e ele espelha a regra da
//      view `category_monthly_totals` do 008: filtra por `transaction_type` e
//      usa ABS, nunca o sinal.
//
//   2. PAGAMENTO DE FATURA. As duas pernas `transfer` do HMO-149 nao sao gasto
//      novo: sao o mesmo dinheiro mudando de lugar. `gastoDaTransacao` so conta
//      `expense`, entao `transfer` cai fora pelo mesmo filtro -- igual as views
//      do 008 fazem.
//
//   3. MES INCOMPLETO. Comparar o dia 3 do mes corrente com meses CHEIOS
//      anteriores acusaria "queda de 90%" todo comeco de mes, e -- o que e pior
//      para um alerta -- no dia 28 acusaria estouro em qualquer categoria cujo
//      historico tenha sido interrompido. A saida NAO e projetar o mes (dia 3
//      vezes dez e ruido puro) nem comparar com o mes cheio: e comparar
//      JANELA CONTRA JANELA. `detectarAnomalias` corta o historico no mesmo dia
//      do mes em que o mes corrente esta. No dia 12, "os primeiros 12 dias de
//      agora" contra "os primeiros 12 dias de cada mes anterior".
//      E por isso que esta funcao le transacao e nao as views do 008: mes e o
//      grao daquelas views, e dai nao se extrai um corte por dia. O
//      `resumoDoMesFechado`, que trata de mes cheio, come das views.
//
//   4. USUARIO NOVO. Sem historico nao existe "normal", e o primeiro mes de uso
//      nao pode gerar alerta nenhum nem dividir por zero. `MIN_MESES_BASE`
//      exige tres meses anteriores COM MOVIMENTO naquela chave. Menos que isso,
//      a chave nao e avaliada -- nao e "nao houve anomalia", e "ainda nao da
//      para saber", e `temBase` na saida distingue os dois para a tela.
// =====================================================

import { mediana, normalizeMerchant } from "@/lib/recurrence-detector";

/**
 * Meses anteriores COM MOVIMENTO exigidos antes de avaliar uma chave.
 *
 * Tres e o menor numero em que a mediana significa alguma coisa: com dois, ela
 * e a media dos dois e um unico mes atipico manda na regua -- que e exatamente
 * o que a escolha da mediana existe para impedir.
 */
export const MIN_MESES_BASE = 3;

/**
 * Quanto acima do tipico ja e anomalia. 1.5 = gastou 50% a mais que o normal.
 *
 * Sozinho este fator nao serve, e o motivo esta no `EXCESSO_MINIMO`.
 */
export const FATOR_ANOMALIA = 1.5;

/**
 * Piso em reais para o excesso virar alerta.
 *
 * Sem ele, a categoria em que a pessoa gasta 8 por mes dispara alerta ao gastar
 * 12 -- "+50%!" -- e o app passa a avisar sobre quatro reais. Alerta que chega
 * por quantia irrelevante treina o usuario a ignorar a notificacao, e junto com
 * ela vai embora o aviso de vencimento, que e o que ele mais precisa. As duas
 * condicoes valem JUNTAS: percentual sem piso vira ruido, piso sem percentual
 * acusa quem simplesmente tem uma categoria cara.
 */
export const EXCESSO_MINIMO = 50;

/** Quantas categorias que mais cresceram o resumo do mes mostra. */
export const TOP_CRESCIMENTOS = 3;

/** Uma transacao do jeito que o PostgREST entrega. */
export interface TransacaoParaAnomalia {
  transaction_date: string;
  /** Despesa e NEGATIVA aqui. Ninguem le este campo direto -- ver `gastoDaTransacao`. */
  amount: number | string;
  transaction_type: string;
  category_id?: string | null;
  description?: string | null;
}

/** Uma chave comparada contra o proprio historico. */
export interface Comparacao {
  /** `category_id`, ou a chave canonica do estabelecimento. */
  chave: string;
  /** O que a tela mostra. Cai para a propria chave quando nao ha nome. */
  rotulo: string;
  /** Gasto na janela do mes corrente (ou no mes fechado, no resumo). */
  atual: number;
  /** A mediana das mesmas janelas dos meses anteriores. */
  tipico: number;
  /** `atual - tipico`. Negativo quando gastou menos que o normal. */
  excesso: number;
  /** `atual / tipico`. `null` quando o tipico e zero -- ver `compararComHistorico`. */
  razao: number | null;
  /** Quantos meses anteriores com movimento sustentam o `tipico`. */
  mesesBase: number;
  /** Passou nas DUAS reguas (`FATOR_ANOMALIA` e `EXCESSO_MINIMO`). */
  anomalia: boolean;
}

/** Le o valor tolerando o texto que o PostgREST devolve para `numeric`. */
function numero(valor: number | string | null | undefined): number {
  const bruto = Number(valor ?? 0);
  return Number.isFinite(bruto) ? bruto : 0;
}

/**
 * Quanto esta transacao representa de GASTO, sempre >= 0.
 *
 * Este e o unico lugar do arquivo que toca `amount`, e a regra e a mesma da
 * view `category_monthly_totals` (008): filtrar por `transaction_type` e tomar
 * o valor absoluto. Nunca decidir pelo sinal -- ver a armadilha 1 do cabecalho.
 */
export function gastoDaTransacao(t: TransacaoParaAnomalia): number {
  if (t.transaction_type !== "expense") return 0;
  return Math.abs(numero(t.amount));
}

/** 'YYYY-MM' de uma data ISO. */
export function mesDe(iso: string): string {
  return iso.slice(0, 7);
}

/** O dia do mes de uma data ISO, como numero. Aritmetica de string: sem fuso no meio. */
export function diaDoMes(iso: string): number {
  return Number(iso.slice(8, 10));
}

/**
 * O mes anterior a `iso` ('YYYY-MM' ou 'YYYY-MM-DD'), em 'YYYY-MM'.
 *
 * Aritmetica de string e nao `new Date`: `new Date('2026-01-01')` nasce em UTC
 * e, no fuso de Sao Paulo, devolve dezembro ao ser lida com `getMonth()` -- o
 * resumo do mes fechado sairia sobre o mes errado exatamente na virada do ano.
 */
export function mesAnterior(iso: string): string {
  const ano = Number(iso.slice(0, 4));
  const mes = Number(iso.slice(5, 7));
  return mes === 1
    ? `${ano - 1}-12`
    : `${ano}-${String(mes - 1).padStart(2, "0")}`;
}

/** A chave canonica do estabelecimento, ou `null` quando nao da para extrair uma. */
export function chaveDoEstabelecimento(descricao: string | null | undefined): string | null {
  if (!descricao) return null;
  const chave = normalizeMerchant(descricao);
  return chave.length > 0 ? chave : null;
}

/**
 * O MOTOR. Compara o valor atual de cada chave com a mediana do proprio
 * historico, e diz quais estouraram.
 *
 * `historico` e uma lista por chave dos valores dos meses ANTERIORES -- ja na
 * mesma unidade do `atual` (janela contra janela, ou mes cheio contra mes
 * cheio; quem garante isso e quem chama).
 *
 * Meses em que a chave nao teve movimento nao entram na base, e essa decisao
 * tem consequencia: quem come fora a cada dois meses tem o "normal" calculado
 * sobre os meses em que comeu, nao diluido pelos meses em que nao comeu. O
 * contrario -- contar zero -- faria a mediana despencar e a primeira refeicao
 * do ano viraria anomalia.
 *
 * Chave que nunca apareceu antes NAO e anomalia: e estreia. Com `tipico` zero
 * nao existe percentual (dividir por zero da Infinity, que imprimiria "+∞%" na
 * tela), entao `razao` e `null` e a linha so entra como anomalia se houver base
 * suficiente -- o que, por definicao, uma estreia nao tem.
 */
export function compararComHistorico(
  atual: Map<string, number>,
  historico: Map<string, number[]>,
  rotulos: Map<string, string> = new Map()
): Comparacao[] {
  // `Array.from` e nao spread de iterador: o tsconfig do app nao liga
  // `downlevelIteration`, e iterar Map/Set direto nao compila no build do Next
  // (compila no tsconfig do teste, que tem target mais alto -- ou seja, o erro
  // so apareceria no build).
  const chaves = Array.from(
    new Set<string>(Array.from(atual.keys()).concat(Array.from(historico.keys())))
  );
  const saida: Comparacao[] = [];

  for (const chave of chaves) {
    const valor = atual.get(chave) ?? 0;
    // Zero nao entra na base: ver o paragrafo acima. O filtro tambem e o que
    // impede a mediana de ser puxada por meses anteriores ao cadastro da conta.
    const base = (historico.get(chave) ?? []).filter((v: number) => v > 0);
    const mesesBase = base.length;
    const tipico = mesesBase > 0 ? mediana(base) : 0;
    const excesso = valor - tipico;

    saida.push({
      chave,
      rotulo: rotulos.get(chave) ?? chave,
      atual: valor,
      tipico,
      excesso,
      razao: tipico > 0 ? valor / tipico : null,
      mesesBase,
      anomalia:
        mesesBase >= MIN_MESES_BASE &&
        tipico > 0 &&
        valor >= tipico * FATOR_ANOMALIA &&
        excesso >= EXCESSO_MINIMO,
    });
  }

  // Maior estouro primeiro: e a ordem em que a tela e a notificacao querem ler,
  // e por valor absoluto e nao por percentual -- 300 reais a mais no mercado
  // importa mais que 200% a mais na farmacia de 30 reais.
  saida.sort((a, b) => b.excesso - a.excesso);
  return saida;
}

export interface EntradaDeAnomalias {
  transacoes: TransacaoParaAnomalia[];
  /** 'YYYY-MM-DD'. Injetado para o teste nao depender do calendario. */
  hoje: string;
  /** `category_id` -> nome, para a tela nao mostrar UUID. */
  nomesDeCategoria?: Record<string, string>;
}

export interface Anomalias {
  /** O mes corrente, 'YYYY-MM'. */
  mes: string;
  /** O dia do corte. A janela e do dia 1 ate este dia, nos dois lados. */
  ateODia: number;
  /** Toda categoria avaliada, maior estouro primeiro. */
  categorias: Comparacao[];
  /** Todo estabelecimento avaliado, maior estouro primeiro. */
  estabelecimentos: Comparacao[];
  /** So as que estouraram, das duas listas. E o que vira alerta. */
  alertas: Comparacao[];
  /** Houve ao menos uma chave com historico suficiente para julgar. */
  temBase: boolean;
}

/**
 * Agrega gasto por (mes, chave), cortando cada mes no dia `ateODia`.
 *
 * O corte e o que torna a comparacao honesta no meio do mes -- armadilha 3 do
 * cabecalho. Transacao sem chave (categoria nula, descricao vazia) fica de fora
 * em vez de virar um balde "sem categoria": esse balde some junto a compra de
 * mercado com a mensalidade da escola e o alerta que sai dele nao diz nada.
 */
function agregarPorMes(
  transacoes: TransacaoParaAnomalia[],
  chaveDe: (t: TransacaoParaAnomalia) => string | null,
  ateODia: number
): Map<string, Map<string, number>> {
  const porMes = new Map<string, Map<string, number>>();

  for (const t of transacoes) {
    const valor = gastoDaTransacao(t);
    if (valor <= 0) continue;
    if (diaDoMes(t.transaction_date) > ateODia) continue;

    const chave = chaveDe(t);
    if (!chave) continue;

    const mes = mesDe(t.transaction_date);
    let balde = porMes.get(mes);
    if (!balde) {
      balde = new Map<string, number>();
      porMes.set(mes, balde);
    }
    balde.set(chave, (balde.get(chave) ?? 0) + valor);
  }

  return porMes;
}

/** Separa o mes corrente do historico e roda o motor. */
function anomaliasDe(
  transacoes: TransacaoParaAnomalia[],
  chaveDe: (t: TransacaoParaAnomalia) => string | null,
  mesCorrente: string,
  ateODia: number,
  rotulos: Map<string, string>
): Comparacao[] {
  const porMes = agregarPorMes(transacoes, chaveDe, ateODia);
  const atual = porMes.get(mesCorrente) ?? new Map<string, number>();

  const historico = new Map<string, number[]>();
  // `forEach` e nao `for...of` sobre o Map, pelo mesmo motivo do
  // `compararComHistorico`: sem `downlevelIteration` o build do Next nao aceita.
  porMes.forEach((balde, mes) => {
    // Estritamente ANTERIOR. O `>=` tambem descarta mes futuro, que existe de
    // verdade: conta lancada com data adiantada entraria como historico de si
    // mesma e o "normal" passaria a incluir o que ainda nem aconteceu.
    if (mes >= mesCorrente) return;
    balde.forEach((valor, chave) => {
      const lista = historico.get(chave) ?? [];
      lista.push(valor);
      historico.set(chave, lista);
    });
  });

  return compararComHistorico(atual, historico, rotulos);
}

/**
 * O mes corrente esta fora do normal? Por categoria e por estabelecimento.
 *
 * Os dois eixos respondem perguntas diferentes e por isso saem juntos: a
 * categoria diz ONDE o mes escorreu ("alimentacao 60% acima"), o
 * estabelecimento diz POR CAUSA DE QUEM ("o posto da esquina, quatro vezes").
 * So a categoria deixa a pessoa sem acao; so o estabelecimento esconde o
 * escorrimento diluido em dez lugares diferentes.
 */
export function detectarAnomalias(entrada: EntradaDeAnomalias): Anomalias {
  const { transacoes, hoje, nomesDeCategoria = {} } = entrada;
  const mes = mesDe(hoje);
  const ateODia = diaDoMes(hoje);

  const rotulos = new Map(Object.entries(nomesDeCategoria));

  const categorias = anomaliasDe(
    transacoes,
    (t) => t.category_id ?? null,
    mes,
    ateODia,
    rotulos
  );

  const estabelecimentos = anomaliasDe(
    transacoes,
    (t) => chaveDoEstabelecimento(t.description),
    mes,
    ateODia,
    new Map()
  );

  const alertas = [...categorias, ...estabelecimentos]
    .filter((c) => c.anomalia)
    .sort((a, b) => b.excesso - a.excesso);

  return {
    mes,
    ateODia,
    categorias,
    estabelecimentos,
    alertas,
    temBase: [...categorias, ...estabelecimentos].some(
      (c) => c.mesesBase >= MIN_MESES_BASE
    ),
  };
}

// =====================================================
// RESUMO DO MES FECHADO
// =====================================================
// Aqui o grao e mes cheio, entao a entrada vem das views do 008 -- e nao de
// transacao crua como no `detectarAnomalias`. Nao e inconsistencia: e a mesma
// razao dos dois lados. Quando da para usar a view, usa-se a view, porque o
// tratamento de sinal mora la num lugar so; quando o corte por dia e necessario
// (mes corrente), a view nao tem o grao e nao ha escolha.

/** Uma linha de `monthly_cash_flow`. */
export interface LinhaDeFluxo {
  /** 'YYYY-MM-01' como a view devolve, ou 'YYYY-MM'. Normalizado aqui. */
  month: string;
  income: number | string;
  expense: number | string;
}

/** Uma linha de `category_monthly_totals`. */
export interface LinhaDeCategoria {
  month: string;
  category_id: string | null;
  expense: number | string;
}

/** Uma assinatura que ficou mais cara, ja apurada pelo lib/recurrence-detector. */
export interface AssinaturaQueSubiu {
  displayName: string;
  de: number;
  para: number;
}

/** Uma conta que virou o mes sem ser paga. */
export interface ContaVencida {
  descricao: string;
  valor: number;
  due_date: string;
}

export interface EntradaDoResumo {
  /** 'YYYY-MM-DD' de qualquer dia do mes em que o resumo esta sendo gerado. */
  hoje: string;
  fluxo: LinhaDeFluxo[];
  porCategoria: LinhaDeCategoria[];
  nomesDeCategoria?: Record<string, string>;
  assinaturasQueSubiram?: AssinaturaQueSubiu[];
  vencidas?: ContaVencida[];
  /**
   * A moeda das linhas que vieram em `fluxo` e `porCategoria` (HMO-171).
   *
   * Quem chama e responsavel por so mandar linhas de UMA moeda -- as views tem a
   * moeda no grao desde a 022, e a soma abaixo juntaria moedas diferentes.
   * `resumoDoUsuario` faz isso filtrando a consulta pela moeda oficial.
   *
   * Ausente = BRL, o mesmo DEFAULT da coluna.
   */
  moeda?: string;
}

export interface ResumoDoMes {
  /** O mes FECHADO, 'YYYY-MM'. Nunca o mes corrente. */
  mes: string;
  entrou: number;
  saiu: number;
  /** `entrou - saiu`. Negativo = o mes fechou no vermelho. */
  saldo: number;
  /** As categorias que mais cresceram contra a propria mediana. No maximo `TOP_CRESCIMENTOS`. */
  crescimentos: Comparacao[];
  assinaturasQueSubiram: AssinaturaQueSubiu[];
  vencidas: ContaVencida[];
  totalVencido: number;
  /** Houve movimento no mes fechado. Falso = nao ha resumo a enviar. */
  temMovimento: boolean;
  /**
   * A moeda em que `entrou`, `saiu` e `saldo` estao (ISO 4217, HMO-171).
   *
   * Viaja junto com os numeros de proposito, e nao e assumida pelo leitor: o
   * resumo e lido por `resumoDoUsuario`, que restringe a consulta a moeda
   * oficial do usuario. Sem este campo o texto da notificacao formataria tudo
   * com "R$" -- e um resumo em dolar chegaria no celular anunciando reais, que e
   * exatamente o erro que esta issue existe para impedir, no unico lugar do app
   * onde nao ha tela ao lado para conferir.
   */
  moeda: string;
}

/** A view devolve 'YYYY-MM-01' (date_trunc); a chave de comparacao e 'YYYY-MM'. */
function normalizarMes(month: string): string {
  return month.slice(0, 7);
}

/**
 * O resumo do mes que acabou de fechar.
 *
 * Roda sobre o mes ANTERIOR ao de `hoje`, sempre. Rodar sobre o mes corrente
 * daria um "resumo do mes" que muda a cada dia e que, no dia 1, diz que a
 * pessoa nao ganhou nada -- e a notificacao ja teria saido.
 *
 * Um usuario sem movimento no mes fechado sai com `temMovimento: false`, e quem
 * chama nao deve notificar: "voce movimentou R$ 0,00 em setembro" e um aviso
 * que so serve para lembrar que o app existe.
 */
export function resumoDoMesFechado(entrada: EntradaDoResumo): ResumoDoMes {
  const {
    hoje,
    fluxo,
    porCategoria,
    nomesDeCategoria = {},
    assinaturasQueSubiram = [],
    vencidas = [],
    moeda = "BRL",
  } = entrada;

  const mes = mesAnterior(hoje);

  // SOMA, nao `find`. As duas views do 008 tem `group_id` no GRAO: um usuario
  // que participa de um grupo tem, no mesmo mes, uma linha pessoal (group_id
  // nulo) e uma por grupo. Pegar a primeira linha que casa o mes devolveria um
  // pedaco do mes -- e qual pedaco dependeria da ordem em que o Postgres
  // resolveu devolver as linhas, que nao e estavel. O resumo sairia com um
  // numero plausivel e errado, diferente a cada execucao.
  let entrou = 0;
  let saiu = 0;
  for (const linha of fluxo) {
    if (normalizarMes(linha.month) !== mes) continue;
    entrou += Math.abs(numero(linha.income));
    saiu += Math.abs(numero(linha.expense));
  }

  // Mesmo motor do alerta do mes corrente -- ver o cabecalho. A diferenca e
  // so a unidade comparada: mes cheio contra mes cheio.
  //
  // O agrupamento por (mes, categoria) ANTES de montar o historico existe pelo
  // mesmo motivo do `group_id` acima: sem ele, a categoria que aparece em duas
  // linhas do mesmo mes entraria DUAS VEZES na base da mediana. O mes viraria
  // dois meses, `mesesBase` passaria a regua de tres meses com historico de
  // dois, e a mediana seria tirada sobre metades de mes.
  const porMesECategoria = new Map<string, Map<string, number>>();

  for (const linha of porCategoria) {
    const chave = linha.category_id;
    if (!chave) continue;

    const m = normalizarMes(linha.month);
    if (m > mes) continue;

    const valor = Math.abs(numero(linha.expense));
    if (valor <= 0) continue;

    let balde = porMesECategoria.get(m);
    if (!balde) {
      balde = new Map<string, number>();
      porMesECategoria.set(m, balde);
    }
    balde.set(chave, (balde.get(chave) ?? 0) + valor);
  }

  const atual = porMesECategoria.get(mes) ?? new Map<string, number>();
  const historico = new Map<string, number[]>();

  porMesECategoria.forEach((balde, m) => {
    if (m >= mes) return;
    balde.forEach((valor, chave) => {
      const lista = historico.get(chave) ?? [];
      lista.push(valor);
      historico.set(chave, lista);
    });
  });

  const comparadas = compararComHistorico(
    atual,
    historico,
    new Map(Object.entries(nomesDeCategoria))
  );

  // So crescimento real entra, e so com base para sustentar a afirmacao. Sem o
  // filtro de `mesesBase`, o segundo mes de uso imprimiria "mercado cresceu
  // 100%" comparando com o unico mes anterior que existe.
  const crescimentos = comparadas
    .filter((c) => c.excesso > 0 && c.mesesBase >= MIN_MESES_BASE)
    .slice(0, TOP_CRESCIMENTOS);

  const totalVencido = vencidas.reduce((s, v) => s + Math.abs(numero(v.valor)), 0);

  return {
    mes,
    entrou,
    saiu,
    saldo: entrou - saiu,
    crescimentos,
    assinaturasQueSubiram,
    vencidas,
    totalVencido,
    temMovimento: entrou > 0 || saiu > 0,
    moeda,
  };
}
