// ---------------------------------------------------------------------------
// RENDA FIXA QUE RENDE SOZINHA -- A ARITMETICA (HMO-192, entrega 2 da HMO-141)
// ---------------------------------------------------------------------------
// A migration 031 deu a `investment_assets` onde guardar "110% do CDI". Este
// arquivo e o que transforma aquelas seis colunas em dois numeros na tela: o
// rendimento BRUTO e o LIQUIDO estimado.
//
// Puro de proposito -- nao importa Supabase, nao le `process.env`, nao conhece
// rota e nao fala com o Banco Central. A unica conversa com o BC mora em
// lib/cdi.ts, exatamente como lib/cambio.ts (puro) e lib/ptax.ts (HTTP). A razao
// e a mesma de lib/investments.ts: nenhum erro desta conta levanta excecao. Ela
// desenha um rendimento errado que parece certo, e a unica forma de pegar isso e
// uma suite que compara numero com numero -- scripts/test-renda-fixa.mjs.
//
// OS NUMEROS DE REFERENCIA, CONFERIDOS CONTRA O BANCO CENTRAL
// -----------------------------------------------------------
// Serie 12 (CDI ao dia) em 25, 28, 29/09/2026: 0,050788% -- ja em %, nao fracao.
// Serie 4389 (CDI ao ano): 13,65%. As duas fecham: 1,00050788 ^ 252 = 1,13650.
//
//   R$ 10.000 a 100% do CDI, 21 dias uteis -> R$ 107,20 brutos
//                                             R$  83,08 liquidos (IR 22,5%)
//   Por dia, a 100% do CDI -> R$ 5,08    a 110% -> R$ 5,59
//
// O PERCENTUAL MULTIPLICA A TAXA DO DIA, NAO O FATOR
// ---------------------------------------------------
// "110% do CDI" e `1 + 0,050788% x 1,10` por dia util, e nao
// `(1 + 0,050788%) ^ 1,10`. As duas formulas sao plausiveis e dao numeros
// parecidos (R$ 5,59 contra R$ 5,59 no primeiro dia), e elas separam depois de
// alguns anos -- quando ninguem mais vai conferir. A primeira e a convencao do
// mercado brasileiro e e a que fecha com o extrato do banco.
//
// O IR INCIDE SO SOBRE O RENDIMENTO, E A ALIQUOTA NAO E FIXA
// -----------------------------------------------------------
// Tabela regressiva, contada em dias CORRIDOS desde a aplicacao:
//
//   ate 180 dias   22,5%      361 a 720      17,5%
//   181 a 360      20,0%      acima de 720   15,0%
//
// Dias CORRIDOS e nao uteis: a tabela do IR conta calendario, enquanto o CDI
// rende em dia util. Usar o mesmo contador para os dois e o erro que faz um CDB
// de 190 dias corridos (131 uteis) ser tributado a 22,5% em vez de 20% -- 2,5
// pontos a mais, sempre contra o usuario, e sem nada na tela denunciando.
//
// LCI, LCA E POUPANCA SAO ISENTAS -- O CASO QUE O CODIGO GENERICO ERRA
// --------------------------------------------------------------------
// Nelas liquido = bruto, e descontar 22,5% mostraria a pessoa um rendimento
// MENOR do que ela vai receber. A isencao nao da para derivar do indexador (uma
// LCI de 95% do CDI e um CDB de 95% do CDI so diferem em `fixed_income_product`),
// e por isso a 031 guarda o produto. NULO e "outro" contam como TRIBUTADOS: e o
// lado seguro do erro -- subestimar o liquido de um isento faz a pessoa receber
// mais do que a tela prometeu, enquanto o contrario promete um liquido que o
// Leao vai cortar.
// ---------------------------------------------------------------------------

/** Os indexadores que o CHECK da 031 aceita. */
export type Indexador =
  | "cdi"
  | "selic"
  | "ipca"
  | "igpm"
  | "prefixado"
  | "poupanca";

/** Os produtos que o CHECK da 031 aceita. */
export type ProdutoRendaFixa =
  | "cdb"
  | "rdb"
  | "lc"
  | "debenture"
  | "lci"
  | "lca"
  | "cri"
  | "cra"
  | "debenture_incentivada"
  | "poupanca"
  | "outro";

export const INDEXADORES: Indexador[] = [
  "cdi",
  "selic",
  "ipca",
  "igpm",
  "prefixado",
  "poupanca",
];

export const PRODUTOS: ProdutoRendaFixa[] = [
  "cdb",
  "rdb",
  "lc",
  "debenture",
  "lci",
  "lca",
  "cri",
  "cra",
  "debenture_incentivada",
  "poupanca",
  "outro",
];

/**
 * Isentos de IR para pessoa fisica.
 *
 * Esta lista e o requisito "LCI, LCA e poupanca sao isentas" da HMO-192. Ela e
 * dado e nao `if`: um produto novo entra aqui, e nao numa condicao espalhada
 * pelo arquivo.
 */
export const PRODUTOS_ISENTOS_DE_IR: ProdutoRendaFixa[] = [
  "lci",
  "lca",
  "cri",
  "cra",
  "debenture_incentivada",
  "poupanca",
];

export const ROTULO_INDEXADOR: Record<Indexador, string> = {
  cdi: "CDI",
  selic: "Selic",
  ipca: "IPCA",
  igpm: "IGP-M",
  prefixado: "Prefixado",
  poupanca: "Poupança",
};

export const ROTULO_PRODUTO: Record<ProdutoRendaFixa, string> = {
  cdb: "CDB",
  rdb: "RDB",
  lc: "Letra de Câmbio",
  debenture: "Debênture",
  lci: "LCI",
  lca: "LCA",
  cri: "CRI",
  cra: "CRA",
  debenture_incentivada: "Debênture incentivada",
  poupanca: "Poupança",
  outro: "Outro",
};

/**
 * Indexadores que este arquivo sabe projetar.
 *
 * `cdi` e `selic` tem serie diaria publica no SGS do Banco Central (12 e 11);
 * `prefixado` nao precisa de fonte nenhuma -- a taxa esta na propria linha.
 *
 * IPCA, IGP-M e poupanca ficam de fora de proposito, e nao por esquecimento:
 * IPCA e IGP-M sao series MENSAIS com defasagem de publicacao (o indice de
 * setembro sai em outubro), e a poupanca remunera por "aniversario" da
 * aplicacao com TR -- tres regras de pro-rata diferentes da do CDI. Projetar
 * qualquer uma delas com a formula do CDI daria um numero com cara de exato e
 * sem relacao com o extrato. A tela diz "sem projecao automatica" e mantem o
 * preco na mao, que e a verdade possivel. Ver `MOTIVO`.
 */
export const INDEXADORES_PROJETAVEIS: Indexador[] = ["cdi", "selic", "prefixado"];

/** Dias uteis em um ano, pela convencao brasileira. */
export const DIAS_UTEIS_NO_ANO = 252;

/**
 * Por que a projecao nao saiu. `null` em `Projecao.motivo` significa que saiu.
 *
 * Cada um destes exige uma frase DIFERENTE na tela, e e por isso que sao cinco
 * valores e nao um booleano:
 *
 *   sem_indexador  o ativo e fixed_income mas ninguem preencheu o indexador --
 *                  some com um botao de editar;
 *   sem_fonte      IPCA, IGP-M ou poupanca: nao melhora tentando de novo, e
 *                  mandar a pessoa "tentar mais tarde" seria mentira;
 *   sem_taxa       prefixado sem `spread_annual`: a taxa inteira dele mora la;
 *   sem_prazo      nem `applied_date` nem compra lancada -- nao ha de onde tirar
 *                  dia de inicio, e sem inicio nao ha aliquota de IR;
 *   indisponivel   o Banco Central nao respondeu. ESTE melhora tentando de novo,
 *                  e e o unico dos cinco que melhora.
 */
export type MOTIVO =
  | "sem_indexador"
  | "sem_fonte"
  | "sem_taxa"
  | "sem_prazo"
  | "indisponivel";

/** De onde saiu o dia de inicio da contagem -- a tela avisa quando nao e o campo. */
export type OrigemDoPrazo = "applied_date" | "primeira_compra";

/** Um dia da serie diaria do SGS, ja normalizado. `valor` em % ao dia. */
export interface DiaDaSerie {
  /** "YYYY-MM-DD". */
  data: string;
  /** Taxa do dia em PORCENTO (0.050788 = 0,050788% no dia), como o SGS publica. */
  valor: number;
}

/**
 * As colunas da 031 que esta conta usa, como o PostgREST as devolve.
 *
 * `numeric` do Postgres chega como STRING no supabase-js para nao perder
 * precisao -- daí `number | string`.
 */
export interface AtivoRendaFixa {
  id: string;
  symbol: string;
  name: string;
  fixed_income_product?: ProdutoRendaFixa | string | null;
  index_kind?: Indexador | string | null;
  index_percentage?: number | string | null;
  spread_annual?: number | string | null;
  applied_date?: string | null;
  maturity_date?: string | null;
}

export interface Projecao {
  asset_id: string;
  symbol: string;
  name: string;

  /** O que a pessoa aplicou -- o custo da posicao, vindo de lib/investments.ts. */
  principal: number;
  /** Rendimento BRUTO acumulado. `null` quando `motivo` nao e nulo. */
  bruto: number | null;
  /** Rendimento LIQUIDO estimado (bruto menos IR). `null` junto com `bruto`. */
  liquido: number | null;
  /** Quanto rende HOJE, bruto, na taxa do ultimo boletim. `null` sem fonte. */
  porDia: number | null;

  /** Aliquota de IR aplicada, em %. Zero quando isento. */
  aliquota: number;
  isento: boolean;
  /** Dias CORRIDOS desde o inicio -- e este que decide a aliquota. */
  diasCorridos: number;
  /** Dias UTEIS com boletim no periodo -- e este que capitaliza. */
  diasUteis: number;

  /** "YYYY-MM-DD": o dia em que a contagem comecou. */
  inicio: string | null;
  origemDoPrazo: OrigemDoPrazo | null;
  /** "YYYY-MM-DD": hoje, ou o vencimento quando ele ja passou. */
  fim: string | null;
  /** true quando o papel ja venceu e a conta parou no vencimento. */
  vencido: boolean;

  indexador: Indexador | null;
  produto: ProdutoRendaFixa | null;
  /** Percentual do indice efetivamente usado (100 quando a coluna e nula). */
  percentualDoIndice: number | null;
  spreadAnual: number | null;

  motivo: MOTIVO | null;
}

// ---------------------------------------------------------------------------
// Normalizacao
// ---------------------------------------------------------------------------

/**
 * `numeric` do Postgres chega como string. `Number(null)` e 0 e
 * `Number(undefined)` e NaN, e um NaN aqui se espalha pela multiplicacao inteira
 * sem levantar erro -- por isso a conversao mora num lugar so, e devolve `null`
 * para ausente em vez de 0: zero por cento e um valor, ausente nao e.
 */
function numOuNulo(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function arredondar(v: number, casas = 2): number {
  const f = Math.pow(10, casas);
  return Math.round((v + Number.EPSILON) * f) / f;
}

export function indexadorValido(v: unknown): Indexador | null {
  const s = String(v ?? "").trim().toLowerCase();
  return (INDEXADORES as string[]).includes(s) ? (s as Indexador) : null;
}

export function produtoValido(v: unknown): ProdutoRendaFixa | null {
  const s = String(v ?? "").trim().toLowerCase();
  return (PRODUTOS as string[]).includes(s) ? (s as ProdutoRendaFixa) : null;
}

// ---------------------------------------------------------------------------
// Imposto de renda
// ---------------------------------------------------------------------------

/**
 * Isento de IR para pessoa fisica?
 *
 * NULO e "outro" respondem FALSO -- tratados como tributados. Ver o cabecalho:
 * e o lado seguro do erro.
 */
export function isentoDeIr(
  produto: ProdutoRendaFixa | string | null | undefined
): boolean {
  const p = produtoValido(produto);
  return p !== null && PRODUTOS_ISENTOS_DE_IR.indexOf(p) >= 0;
}

/**
 * Aliquota da tabela regressiva, em %, por dias CORRIDOS desde a aplicacao.
 *
 * As bordas sao inclusivas no topo da faixa: 180 dias ainda e 22,5% e 181 ja e
 * 20%. E o texto da lei, e errar a borda por um dia muda o liquido em 2,5 pontos
 * exatamente no dia em que a pessoa confere se vale resgatar.
 *
 * Prazo negativo (data de aplicacao no futuro, que o CHECK da 031 tolera por um
 * dia por causa de fuso) cai na primeira faixa -- a mais alta. Nao ha resgate
 * com prazo negativo para tributar; o que importa e que a funcao nao devolva
 * 15% para quem acabou de aplicar.
 */
export function aliquotaDeIr(diasCorridos: number): number {
  if (diasCorridos <= 180) return 22.5;
  if (diasCorridos <= 360) return 20;
  if (diasCorridos <= 720) return 17.5;
  return 15;
}

/** A faixa em palavras, para a tela explicar de onde veio a aliquota. */
export function faixaDeIr(diasCorridos: number): string {
  if (diasCorridos <= 180) return "até 180 dias";
  if (diasCorridos <= 360) return "181 a 360 dias";
  if (diasCorridos <= 720) return "361 a 720 dias";
  return "acima de 720 dias";
}

// ---------------------------------------------------------------------------
// A resposta do SGS -- o pedaco puro da conversa com o Banco Central
// ---------------------------------------------------------------------------
// O HTTP mora em lib/cdi.ts; a LEITURA da resposta mora aqui, porque e ela que
// tem as armadilhas e e ela que a suite precisa alcancar sem rede.

/** Uma linha crua do SGS: `{"data":"25/09/2026","valor":"0.050788"}`. */
export interface LinhaDoSgs {
  data?: unknown;
  valor?: unknown;
}

/**
 * "YYYY-MM-DD" -> "DD/MM/YYYY", que e o formato que o SGS exige.
 *
 * NAO e o mesmo da PTAX (`MM-DD-YYYY`, ver lib/cambio.ts). Os dois endpoints sao
 * do mesmo Banco Central, em hosts diferentes, com ordens de campo diferentes, e
 * trocar um pelo outro nao da erro: devolve dado de outro mes ou 404 lido como
 * feriado. Um "09-13" viraria "13 de setembro" num e "sem boletim" no outro.
 */
export function dataParaSgs(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** "DD/MM/YYYY" -> "YYYY-MM-DD". Devolve null para o que nao casa com o formato. */
export function dataDoSgs(br: unknown): string | null {
  const s = String(br ?? "").trim();
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return null;
  return `${s.slice(6, 10)}-${s.slice(3, 5)}-${s.slice(0, 2)}`;
}

/**
 * Normaliza a resposta do SGS numa serie confiavel: datas em ISO, valores em
 * numero, ORDENADA por data, sem duplicata.
 *
 * A ordenacao nao e zelo. MEDIDO em 2026-10-06 contra api.bcb.gov.br:
 *
 *   /bcdata.sgs.12/dados/ultimos/4    -> 30/09, 01/10, 02/10, 05/10  (CRESCENTE)
 *   /bcdata.sgs.4389/dados/ultimos/3  -> 05/10, 02/10, 01/10         (DECRESCENTE)
 *
 * Duas series do MESMO endpoint, em ordens opostas. Quem le `valores[0]` como "o
 * mais antigo" ou `valores[len-1]` como "o mais novo" acerta numa serie e erra na
 * outra, e o erro e um numero plausivel de outro dia -- a mesma armadilha do
 * "ultimo boletim nao e o do dia" da PTAX, em lib/cambio.ts.
 *
 * Linha com data ou valor ilegivel e DESCARTADA em vez de virar zero: um dia com
 * taxa zero no meio da serie nao atrapalha o produto dos fatores (multiplica por
 * 1), mas conta como dia util e deslocaria a contagem de dias uteis do prefixado.
 */
export function normalizarSerie(bruto: unknown): DiaDaSerie[] {
  if (!Array.isArray(bruto)) return [];

  const porData: Record<string, number> = {};
  for (const linha of bruto as LinhaDoSgs[]) {
    const data = dataDoSgs(linha?.data);
    if (!data) continue;
    const valor = numOuNulo(linha?.valor as number | string | null | undefined);
    if (valor === null) continue;
    porData[data] = valor;
  }

  return Object.keys(porData)
    .sort()
    .map((data) => ({ data, valor: porData[data] }));
}

// ---------------------------------------------------------------------------
// Calendario
// ---------------------------------------------------------------------------

/**
 * Dias corridos entre duas datas "YYYY-MM-DD", pelo calendario.
 *
 * `Date.UTC` e nao `new Date(iso)` com horario local: no fuso de Sao Paulo (-03)
 * a data montada localmente escorrega um dia, e um dia de deslize na borda de
 * 180 troca a aliquota de IR -- ver [teste-de-data-passa-em-utc].
 */
export function diasCorridosEntre(deISO: string, ateISO: string): number {
  const de = Date.UTC(
    Number(deISO.slice(0, 4)),
    Number(deISO.slice(5, 7)) - 1,
    Number(deISO.slice(8, 10))
  );
  const ate = Date.UTC(
    Number(ateISO.slice(0, 4)),
    Number(ateISO.slice(5, 7)) - 1,
    Number(ateISO.slice(8, 10))
  );
  return Math.round((ate - de) / 86400000);
}

/**
 * Os dias da serie que capitalizam no periodo: `inicio` EXCLUSIVO, `fim`
 * INCLUSIVO.
 *
 * O dia da aplicacao nao rende -- o dinheiro entra nele. Incluir o inicio daria
 * um dia util a mais em todo ativo da carteira, o que num CDB de 21 dias e 5% de
 * rendimento inventado.
 *
 * Fim de semana e feriado simplesmente NAO ESTAO na serie, e e assim que tem de
 * ser: o CDI rende em dia util, e um sabado ausente contribui com nada porque
 * nada rendeu, nao porque o boletim falhou. A diferenca entre as duas coisas e o
 * assunto de lib/cdi.ts -- aqui a serie ja chegou confiavel.
 */
export function diasNoPeriodo(
  serie: DiaDaSerie[],
  inicioISO: string,
  fimISO: string
): DiaDaSerie[] {
  return serie.filter((d) => d.data > inicioISO && d.data <= fimISO);
}

/**
 * Fator de capitalizacao de uma serie diaria a um percentual do indice.
 *
 * `percentual` em %, onde 100 = "100% do CDI". A multiplicacao e na TAXA do dia
 * e nao no fator -- ver o cabecalho do arquivo.
 */
export function fatorDaSerie(
  dias: DiaDaSerie[],
  percentual: number
): number {
  let fator = 1;
  for (const d of dias) {
    fator *= 1 + (d.valor / 100) * (percentual / 100);
  }
  return fator;
}

/**
 * Fator de um spread anual ao longo de `diasUteis`, pela convencao de 252.
 *
 * E a formula do prefixado ("13% a.a.") e tambem do `+ 6%` de um IPCA+. `spread`
 * em pontos percentuais ao ano.
 */
export function fatorDoSpread(spread: number, diasUteis: number): number {
  if (spread === 0 || diasUteis <= 0) return 1;
  return Math.pow(1 + spread / 100, diasUteis / DIAS_UTEIS_NO_ANO);
}

// ---------------------------------------------------------------------------
// A projecao
// ---------------------------------------------------------------------------

export interface EntradaDaProjecao {
  ativo: AtivoRendaFixa;
  /** Custo da posicao -- `total_invested` de lib/investments.ts. */
  principal: number;
  /** Serie diaria do indexador do ativo, ja normalizada e ordenada. */
  serie?: DiaDaSerie[] | null;
  /** "YYYY-MM-DD" da primeira COMPRA do ativo, para quando `applied_date` e nula. */
  primeiraCompra?: string | null;
  /** "YYYY-MM-DD" -- hoje. Parametro e nao `new Date()` para a suite congelar o relogio. */
  hoje: string;
}

function projecaoSemNumero(
  e: EntradaDaProjecao,
  motivo: MOTIVO,
  parcial: Partial<Projecao> = {}
): Projecao {
  const indexador = indexadorValido(e.ativo.index_kind);
  const produto = produtoValido(e.ativo.fixed_income_product);
  return {
    asset_id: e.ativo.id,
    symbol: e.ativo.symbol,
    name: e.ativo.name,
    principal: arredondar(e.principal),
    bruto: null,
    liquido: null,
    porDia: null,
    aliquota: 0,
    isento: isentoDeIr(produto),
    diasCorridos: 0,
    diasUteis: 0,
    inicio: null,
    origemDoPrazo: null,
    fim: null,
    vencido: false,
    indexador,
    produto,
    percentualDoIndice: numOuNulo(e.ativo.index_percentage),
    spreadAnual: numOuNulo(e.ativo.spread_annual),
    motivo,
    ...parcial,
  };
}

/**
 * Rendimento bruto e liquido de UM ativo de renda fixa.
 *
 * Nunca lanca e nunca chuta: quando falta ingrediente, devolve `bruto: null` com
 * o `motivo`, e a tela diz qual campo preencher. O que esta funcao nao faz e
 * escolher uma aliquota sem ter prazo de onde tirar -- ver o cabecalho da 031.
 */
export function projetarRendimento(e: EntradaDaProjecao): Projecao {
  const indexador = indexadorValido(e.ativo.index_kind);
  const produto = produtoValido(e.ativo.fixed_income_product);
  const spread = numOuNulo(e.ativo.spread_annual);

  if (indexador === null) return projecaoSemNumero(e, "sem_indexador");

  if (INDEXADORES_PROJETAVEIS.indexOf(indexador) < 0) {
    return projecaoSemNumero(e, "sem_fonte");
  }

  if (indexador === "prefixado" && (spread === null || spread <= 0)) {
    return projecaoSemNumero(e, "sem_taxa");
  }

  // `applied_date` e a fonte certa; a primeira compra e a queda documentada na
  // 031 para quem cadastrou o ativo antes dela existir. Sao quase sempre a mesma
  // data, e nao mostrar rendimento nenhum puniria justamente essas pessoas.
  const inicio = e.ativo.applied_date || e.primeiraCompra || null;
  if (!inicio) return projecaoSemNumero(e, "sem_prazo");
  const origemDoPrazo: OrigemDoPrazo = e.ativo.applied_date
    ? "applied_date"
    : "primeira_compra";

  // O papel para de render no vencimento. Sem este corte, um CDB vencido em 2024
  // continuaria acumulando CDI para sempre e a tela mostraria um rendimento que
  // o banco nao vai pagar -- com dois anos de juros compostos de diferenca.
  const venceu =
    !!e.ativo.maturity_date && e.ativo.maturity_date < e.hoje;
  const fim = venceu ? (e.ativo.maturity_date as string) : e.hoje;

  const diasCorridos = Math.max(0, diasCorridosEntre(inicio, fim));
  const isento = isentoDeIr(produto);
  // Aliquota pelo prazo CORRIDO, nunca pelo util -- ver o cabecalho.
  const aliquota = isento ? 0 : aliquotaDeIr(diasCorridos);

  const base: Projecao = {
    asset_id: e.ativo.id,
    symbol: e.ativo.symbol,
    name: e.ativo.name,
    principal: arredondar(e.principal),
    bruto: null,
    liquido: null,
    porDia: null,
    aliquota,
    isento,
    diasCorridos,
    diasUteis: 0,
    inicio,
    origemDoPrazo,
    fim,
    vencido: venceu,
    indexador,
    produto,
    percentualDoIndice: null,
    spreadAnual: spread,
    motivo: null,
  };

  // Prefixado nao acompanha indice nenhum (o CHECK da 031 proibe
  // `index_percentage` nele), mas ainda precisa saber QUANTOS dias uteis
  // passaram. A serie do Banco Central e usada aqui so como CALENDARIO: ela
  // publica um boletim em todo dia util e em nenhum outro, o que a torna, na
  // pratica, o calendario de dias uteis que o app nao tem.
  const serie = e.serie || [];
  if (serie.length === 0) {
    return { ...base, motivo: "indisponivel" };
  }

  const dias = diasNoPeriodo(serie, inicio, fim);
  const diasUteis = dias.length;

  // 100 e o default documentado: `index_kind = 'cdi'` sem percentual e "CDI",
  // que no mercado quer dizer 100% dele. Zero seria um ativo que nao rende, e o
  // CHECK da 031 nem aceita gravar zero.
  const percentual =
    indexador === "prefixado" ? 0 : numOuNulo(e.ativo.index_percentage) ?? 100;

  const fatorIndice =
    indexador === "prefixado" ? 1 : fatorDaSerie(dias, percentual);
  // O spread convive com o indice: "IPCA + 6%" e "CDI + 2%" existem, e no
  // prefixado ele e a taxa INTEIRA. Multiplicar os dois fatores e o que faz os
  // tres formatos de remuneracao sairem da mesma conta.
  const fatorTotal = fatorIndice * fatorDoSpread(spread ?? 0, diasUteis);

  const bruto = e.principal * (fatorTotal - 1);
  const liquido = bruto - bruto * (aliquota / 100);

  // Quanto rende HOJE, sobre o saldo de hoje (principal + bruto acumulado). Para
  // R$ 10.000 recem aplicados a 100% do CDI isto da R$ 5,08; a 110%, R$ 5,59.
  // Papel vencido nao rende mais nada -- `null` e nao zero, porque "nao rende
  // mais" e "rendeu zero hoje" pedem frases diferentes na tela.
  const ultimo = serie[serie.length - 1];
  const porDia = venceu
    ? null
    : indexador === "prefixado"
      ? (e.principal + bruto) *
        (Math.pow(1 + (spread as number) / 100, 1 / DIAS_UTEIS_NO_ANO) - 1)
      : (e.principal + bruto) *
        ((ultimo.valor / 100) * (percentual / 100) +
          (Math.pow(1 + (spread ?? 0) / 100, 1 / DIAS_UTEIS_NO_ANO) - 1));

  return {
    ...base,
    diasUteis,
    percentualDoIndice: indexador === "prefixado" ? null : percentual,
    bruto: arredondar(bruto),
    liquido: arredondar(liquido),
    porDia: porDia === null ? null : arredondar(porDia),
  };
}

// ---------------------------------------------------------------------------
// O que vai para as colunas da 031 -- a mesma regra dos CHECK, em portugues
// ---------------------------------------------------------------------------

/** As seis colunas da 031, como o PostgREST as recebe num insert/update. */
export interface CamposDeRendaFixa {
  fixed_income_product: ProdutoRendaFixa | null;
  index_kind: Indexador | null;
  index_percentage: number | null;
  spread_annual: number | null;
  applied_date: string | null;
  maturity_date: string | null;
}

export type LeituraDeCampos =
  | { ok: true; campos: CamposDeRendaFixa }
  | { ok: false; erro: string };

const SO_DATA = /^\d{4}-\d{2}-\d{2}$/;

function textoOuNulo(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

/**
 * Numero digitado: `null` para AUSENTE, `NaN` para ILEGIVEL.
 *
 * `numOuNulo` colapsa os dois em `null`, e ali isso esta certo -- ele le o que
 * ja esta GRAVADO no banco, onde `numeric` ou e nulo ou e numero. Aqui ele
 * estaria errado: um campo digitado como "cento e dez" nao e um campo vazio.
 * Colapsar os dois faria o texto ilegivel ser GRAVADO como nulo, e o ativo
 * apareceria na tela como "CDI" sem percentual -- que a projecao le como 100% do
 * CDI. A pessoa teria digitado 110, visto a tela aceitar, e recebido uma conta
 * de 100%.
 */
function numeroDigitado(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  // O `trim()` antes do teste de vazio importa: `Number("  ")` e ZERO, nao NaN.
  // Sem ele, um campo que o usuario deixou com um espaco dentro viraria um
  // percentual de 0%, que o CHECK da 031 recusa -- e a pessoa veria "Percentual
  // precisa ficar entre 0 e 1000" num campo que ela acha que deixou em branco.
  const texto = String(v).trim();
  if (texto === "") return null;
  const n = Number(texto);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Le os seis campos do corpo de uma requisicao, com as MESMAS regras dos CHECK
 * da migration 031.
 *
 * Esta funcao e uma duplicata deliberada do banco, e a duplicata tem dono: o
 * banco decide, e isto so existe para a pessoa ler "Prefixado nao usa percentual
 * do indice" em vez de
 * "new row violates check constraint investment_assets_prefixado_sem_percentual".
 * Por isso cada guarda abaixo cita a constraint que ela espelha -- se uma mudar
 * no SQL e nao aqui, o sintoma e um erro feio, nao um dado errado. O contrario
 * (frouxa aqui, apertada la) tambem e seguro: o INSERT falha.
 *
 * O que NAO e espelhado: `renda_fixa_so_em_fixed_income`. Quem decide o `type` e
 * a rota, e e ela que zera os seis campos num ativo que nao e renda fixa -- ver
 * o uso em /api/investments/assets.
 */
export function lerCamposDeRendaFixa(body: unknown): LeituraDeCampos {
  const b = (body ?? {}) as Record<string, unknown>;

  const produtoTexto = textoOuNulo(b.fixedIncomeProduct);
  const produto = produtoTexto === null ? null : produtoValido(produtoTexto);
  if (produtoTexto !== null && produto === null) {
    return {
      ok: false,
      erro: `Produto invalido. Use um de: ${PRODUTOS.join(", ")}`,
    };
  }

  const indexadorTexto = textoOuNulo(b.indexKind);
  const indexador =
    indexadorTexto === null ? null : indexadorValido(indexadorTexto);
  if (indexadorTexto !== null && indexador === null) {
    return {
      ok: false,
      erro: `Indexador invalido. Use um de: ${INDEXADORES.join(", ")}`,
    };
  }

  // investment_assets_index_percentage_check: > 0 e <= 1000. O teto nao e regra
  // de mercado -- e limite de digitacao. Sem ele, "11000" no lugar de "110"
  // projeta um rendimento cem vezes maior, com toda a confianca.
  const percentual = numeroDigitado(b.indexPercentage);
  if (
    percentual !== null &&
    (!Number.isFinite(percentual) || percentual <= 0 || percentual > 1000)
  ) {
    return {
      ok: false,
      erro: "Percentual do indice precisa ficar entre 0 e 1000 (110 = 110% do CDI)",
    };
  }

  // investment_assets_spread_annual_check: >= 0 e <= 100. Zero e valido (IPCA
  // puro); negativo nao -- sinal invertido viraria rendimento negativo silencioso.
  const spread = numeroDigitado(b.spreadAnnual);
  if (spread !== null && (!Number.isFinite(spread) || spread < 0 || spread > 100)) {
    return { ok: false, erro: "Taxa ao ano precisa ficar entre 0 e 100" };
  }

  // investment_assets_percentual_exige_indexador: "110% de que?"
  if (percentual !== null && indexador === null) {
    return {
      ok: false,
      erro: "Informe o indexador do percentual (110% de que?)",
    };
  }

  // investment_assets_prefixado_sem_percentual: a taxa inteira do prefixado mora
  // em `spreadAnnual`, e um percentual aqui seria percentual de um indice que
  // nao existe na linha.
  if (indexador === "prefixado" && percentual !== null) {
    return {
      ok: false,
      erro: "Prefixado nao usa percentual do indice -- informe a taxa ao ano",
    };
  }

  const aplicacao = textoOuNulo(b.appliedDate);
  if (aplicacao !== null && !SO_DATA.test(aplicacao)) {
    return { ok: false, erro: "Data de aplicacao invalida (use AAAA-MM-DD)" };
  }

  const vencimento = textoOuNulo(b.maturityDate);
  if (vencimento !== null && !SO_DATA.test(vencimento)) {
    return { ok: false, erro: "Vencimento invalido (use AAAA-MM-DD)" };
  }

  // investment_assets_vencimento_depois_da_aplicacao. Igual tambem nao serve:
  // prazo zero divide por zero em qualquer projecao.
  if (aplicacao !== null && vencimento !== null && vencimento <= aplicacao) {
    return {
      ok: false,
      erro: "O vencimento tem que ser depois da data de aplicacao",
    };
  }

  return {
    ok: true,
    campos: {
      fixed_income_product: produto,
      index_kind: indexador,
      index_percentage: percentual,
      spread_annual: spread,
      applied_date: aplicacao,
      maturity_date: vencimento,
    },
  };
}

/** Os seis campos zerados -- o que vai para um ativo que nao e renda fixa. */
export function camposDeRendaFixaVazios(): CamposDeRendaFixa {
  return {
    fixed_income_product: null,
    index_kind: null,
    index_percentage: null,
    spread_annual: null,
    applied_date: null,
    maturity_date: null,
  };
}

/**
 * A primeira COMPRA de cada ativo, por asset_id.
 *
 * Provento e venda ficam de fora: nenhum dos dois e o dia em que o dinheiro
 * entrou no papel, e um provento lancado antes da compra (acontece, em linha
 * editada a mao) daria um inicio anterior a aplicacao -- prazo inflado e
 * aliquota de IR menor que a devida.
 */
export function primeiraCompraPorAtivo(
  lancamentos: Array<{ asset_id: string; kind: string; trade_date: string }>
): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const l of lancamentos) {
    if (l.kind !== "buy") continue;
    const atual = mapa[l.asset_id];
    if (!atual || l.trade_date < atual) mapa[l.asset_id] = l.trade_date;
  }
  return mapa;
}

/** Soma o bruto e o liquido das projecoes que sairam. */
export function somarProjecoes(projecoes: Projecao[]): {
  bruto: number;
  liquido: number;
  porDia: number;
  /** Quantos ativos ficaram sem projecao -- a tela avisa em vez de somar menos. */
  semProjecao: number;
} {
  let bruto = 0;
  let liquido = 0;
  let porDia = 0;
  let semProjecao = 0;

  for (const p of projecoes) {
    if (p.motivo !== null || p.bruto === null || p.liquido === null) {
      semProjecao++;
      continue;
    }
    bruto += p.bruto;
    liquido += p.liquido;
    porDia += p.porDia ?? 0;
  }

  return {
    bruto: arredondar(bruto),
    liquido: arredondar(liquido),
    porDia: arredondar(porDia),
    semProjecao,
  };
}
