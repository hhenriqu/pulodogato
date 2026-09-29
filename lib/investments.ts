// Carteira de investimentos: posicao, resultado e alocacao (HMO-169).
//
// Este arquivo e puro de proposito -- nao importa Supabase, nao le `process.env`
// e nao conhece rota. Ele recebe as linhas das duas tabelas da migration 021 e
// devolve os numeros que a tela mostra. E assim porque nenhum destes erros
// levanta excecao: eles desenham uma carteira errada que parece certa, e a unica
// forma de pegar isso e uma suite que compara numero com numero.
//
// SINAL -- A CONVENCAO AQUI E O OPOSTO DA DE financial_transactions
// ----------------------------------------------------------------
// Em `financial_transactions` a despesa e gravada NEGATIVA. Aqui `quantity`,
// `unit_price` e `fees` sao sempre POSITIVOS (o banco tem CHECK para os tres) e
// quem carrega a direcao e `kind`. Uma venda nao e quantidade negativa: e
// `kind: "sell"` com quantidade positiva.
//
// CUSTO MEDIO, QUE E O METODO USADO NO BRASIL
// -------------------------------------------
// Compra pondera o preco medio. Venda NAO: ela baixa quantidade pelo custo medio
// vigente e o preco medio continua o mesmo. Provento nao toca nem em quantidade
// nem em custo.
//
// Somar venda na ponderacao e o erro central desta conta, e ele e invisivel:
// quem compra 100 a 30 e vende 40 a 34 tem preco medio 30 -- se a venda entrar na
// media, sai 31,14. Os dois numeros sao plausiveis, ninguem estranha 31,14, e o
// lucro que a tela mostra fica errado para sempre. A suite tem esse caso com o
// valor na casa do centavo.
//
// PRECO ATUAL PODE NAO EXISTIR
// ----------------------------
// Nao ha fonte de cotacao contratada (HMO-141 item 2): o preco atual e informado
// a mao pelo usuario e `current_price` nasce NULL. Quando falta preco, a posicao
// e avaliada PELO CUSTO -- `current_value = quantidade * preco medio`, resultado
// zero -- e o ativo entra em `ativosSemPreco` para a tela avisar.
//
// A alternativa era tratar preco ausente como zero. Isso mostraria a carteira
// inteira valendo R$ 0,00 e -100% de prejuizo no dia em que o usuario cadastra o
// primeiro ativo -- um numero alarmante e falso. Avaliar pelo custo diz a
// verdade possivel ("nao sei quanto vale hoje, sei quanto custou") e o aviso da
// tela cobre o resto.

export type AssetType = "stock" | "fii" | "fixed_income" | "international";
export type InvestmentKind = "buy" | "sell" | "dividend";

/** Linha de public.investment_assets, como o PostgREST devolve. */
export interface AtivoBruto {
  id: string;
  symbol: string;
  name: string;
  type: AssetType;
  currency?: string | null;
  current_price?: number | string | null;
  current_price_at?: string | null;
}

/** Linha de public.investment_transactions. */
export interface LancamentoBruto {
  asset_id: string;
  kind: InvestmentKind;
  quantity: number | string;
  unit_price: number | string;
  fees?: number | string | null;
  /** date do Postgres: "YYYY-MM-DD". */
  trade_date: string;
}

/**
 * Posicao consolidada de um ativo.
 *
 * Os campos ate `profit_loss_percentage` sao exatamente os de `Portfolio` em
 * types/index.ts, que e o que components/PortfolioTable.tsx consome. Os de
 * baixo sao acrescimos desta consolidacao.
 */
export interface Posicao {
  asset_id: string;
  symbol: string;
  name: string;
  type: AssetType;
  total_quantity: number;
  average_price: number;
  total_invested: number;
  current_price?: number;
  current_value: number;
  profit_loss: number;
  profit_loss_percentage: number;

  /** Proventos recebidos neste ativo, liquidos de taxa. */
  dividends: number;
  /** Resultado JA REALIZADO pelas vendas (nao entra em profit_loss). */
  realized_profit_loss: number;
  /** false quando o usuario nunca informou preco: a posicao esta avaliada pelo custo. */
  has_price: boolean;
  /**
   * true quando os lancamentos vendem mais do que a posicao tinha. Nao deveria
   * acontecer -- a rota recusa a venda que excede -- mas linha editada direto no
   * banco chega aqui, e zerar em silencio esconderia a inconsistencia.
   */
  exceeded_position: boolean;
}

export interface ResumoCarteira {
  totalInvested: number;
  currentValue: number;
  totalProfitLoss: number;
  totalProfitLossPercentage: number;
  totalDividends: number;
  realizedProfitLoss: number;
  /** Quantos ativos abertos estao sem preco informado. */
  ativosSemPreco: number;
}

export interface FatiaAlocacao {
  name: string;
  value: number;
  percentage: number;
}

export interface PontoEvolucao {
  /** "YYYY-MM-DD" -- o ultimo dia do mes. */
  date: string;
  portfolio: number;
}

// Rotulos dos tipos. Estes textos NAO sao decoracao: as chaves de COLORS em
// components/charts/AssetAllocationChart.tsx sao estas strings, e um rotulo
// diferente aqui sai como fatia cinza no grafico, sem erro nenhum.
export const ROTULO_TIPO: Record<AssetType, string> = {
  stock: "Ações",
  fii: "FIIs",
  fixed_income: "Renda Fixa",
  international: "Internacional",
};

export const TIPOS_DE_ATIVO: AssetType[] = [
  "stock",
  "fii",
  "fixed_income",
  "international",
];

/**
 * `numeric` do Postgres chega como STRING no supabase-js, para nao perder
 * precisao. `Number(null)` e 0 e `Number(undefined)` e NaN, e um NaN aqui se
 * espalha por toda a soma sem levantar erro -- daí a normalizacao num lugar so.
 */
function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Arredonda para `casas` decimais sem o erro de ponto flutuante acumular. */
function arredondar(v: number, casas = 2): number {
  const f = Math.pow(10, casas);
  return Math.round((v + Number.EPSILON) * f) / f;
}

/**
 * Ordena por data e, dentro do mesmo dia, mantem a ordem de entrada.
 *
 * A ordem importa porque o custo medio e sequencial: vender antes de comprar da
 * outro resultado. `Array.prototype.sort` e estavel desde o ES2019, entao uma
 * venda lancada depois de uma compra no MESMO dia e processada depois dela --
 * que e a unica leitura razoavel de dois lancamentos sem hora.
 */
function emOrdem(lancamentos: LancamentoBruto[]): LancamentoBruto[] {
  return [...lancamentos].sort((a, b) =>
    a.trade_date < b.trade_date ? -1 : a.trade_date > b.trade_date ? 1 : 0
  );
}

interface EstadoAtivo {
  quantidade: number;
  custo: number;
  proventos: number;
  realizado: number;
  excedeu: boolean;
}

function estadoVazio(): EstadoAtivo {
  return {
    quantidade: 0,
    custo: 0,
    proventos: 0,
    realizado: 0,
    excedeu: false,
  };
}

/**
 * Replay do custo medio para um ativo. `ate` (inclusive, "YYYY-MM-DD") corta o
 * historico numa data -- e o que permite desenhar a evolucao mes a mes sem uma
 * segunda implementacao da mesma aritmetica.
 */
function replay(lancamentos: LancamentoBruto[], ate?: string): EstadoAtivo {
  const e = estadoVazio();

  for (const l of emOrdem(lancamentos)) {
    if (ate && l.trade_date > ate) continue;

    const quantidade = num(l.quantity);
    const preco = num(l.unit_price);
    const taxas = num(l.fees);

    if (l.kind === "buy") {
      // A taxa entra no custo: quem paga R$ 5,90 de corretagem pagou isso pelo
      // ativo. Deixar a taxa de fora infla o lucro em exatamente o valor das
      // taxas, todo mes, para sempre.
      e.custo += quantidade * preco + taxas;
      e.quantidade += quantidade;
      continue;
    }

    if (l.kind === "sell") {
      const medio = e.quantidade > 0 ? e.custo / e.quantidade : 0;
      const vendida = Math.min(quantidade, e.quantidade);
      if (quantidade > e.quantidade) e.excedeu = true;

      // Resultado realizado: o que entrou menos a taxa menos o custo do que
      // saiu. E separado do resultado NAO realizado de proposito -- somar os
      // dois num numero so faz o "Lucro/Prejuizo" da tela mudar quando o
      // usuario vende no lucro, como se vender criasse dinheiro novo.
      e.realizado += quantidade * preco - taxas - medio * vendida;

      e.custo -= medio * vendida;
      e.quantidade -= vendida;
      // O preco medio NAO muda aqui: custo e quantidade cairam na mesma
      // proporcao. Ver o cabecalho do arquivo.
      continue;
    }

    // dividend: `quantity` sao as cotas que receberam e `unit_price` o valor por
    // cota. Nao toca em quantidade nem em custo -- provento nao e aporte.
    e.proventos += quantidade * preco - taxas;
  }

  return e;
}

/**
 * Consolida ativos + lancamentos em uma posicao por ativo.
 *
 * Inclui posicao ZERADA (vendida por inteiro): ela nao aparece na tabela da
 * tela, mas o resultado realizado e os proventos dela continuam valendo, e o
 * resumo os soma. Quem quiser so a carteira de hoje usa `posicoesAbertas`.
 */
export function calcularPosicoes(
  ativos: AtivoBruto[],
  lancamentos: LancamentoBruto[]
): Posicao[] {
  const porAtivo = new Map<string, LancamentoBruto[]>();
  for (const l of lancamentos) {
    const lista = porAtivo.get(l.asset_id);
    if (lista) lista.push(l);
    else porAtivo.set(l.asset_id, [l]);
  }

  return ativos.map((ativo) => {
    const e = replay(porAtivo.get(ativo.id) || []);

    const medio = e.quantidade > 0 ? e.custo / e.quantidade : 0;
    const precoInformado = ativo.current_price;
    const temPreco =
      precoInformado !== null &&
      precoInformado !== undefined &&
      precoInformado !== "" &&
      num(precoInformado) > 0;

    // Sem preco informado a posicao vale o que custou -- ver o cabecalho.
    const precoParaAvaliar = temPreco ? num(precoInformado) : medio;
    const valorAtual = e.quantidade * precoParaAvaliar;
    const resultado = valorAtual - e.custo;

    return {
      asset_id: ativo.id,
      symbol: ativo.symbol,
      name: ativo.name,
      type: ativo.type,
      total_quantity: arredondar(e.quantidade, 8),
      average_price: arredondar(medio, 6),
      total_invested: arredondar(e.custo),
      current_price: temPreco ? num(precoInformado) : undefined,
      current_value: arredondar(valorAtual),
      profit_loss: arredondar(resultado),
      // Dividir pelo CUSTO, nao pelo valor atual: rentabilidade e resultado
      // sobre o que foi aplicado. Dividir pelo valor atual da um numero menor
      // em toda alta e maior em toda baixa, e o erro passa desapercebido porque
      // a ordem de grandeza continua parecida.
      profit_loss_percentage:
        e.custo > 0 ? arredondar((resultado / e.custo) * 100) : 0,
      dividends: arredondar(e.proventos),
      realized_profit_loss: arredondar(e.realizado),
      has_price: temPreco,
      exceeded_position: e.excedeu,
    };
  });
}

/** So o que o usuario ainda tem. E o que vai para a tabela da tela. */
export function posicoesAbertas(posicoes: Posicao[]): Posicao[] {
  return posicoes.filter((p) => p.total_quantity > 0);
}

export function resumirCarteira(posicoes: Posicao[]): ResumoCarteira {
  const abertas = posicoesAbertas(posicoes);

  const totalInvested = abertas.reduce((s, p) => s + p.total_invested, 0);
  const currentValue = abertas.reduce((s, p) => s + p.current_value, 0);
  const totalProfitLoss = currentValue - totalInvested;

  // Proventos e realizado somam TODAS as posicoes, inclusive as zeradas: o
  // dinheiro que o usuario recebeu de uma acao que ele ja vendeu nao deixou de
  // ter entrado na conta dele.
  const totalDividends = posicoes.reduce((s, p) => s + p.dividends, 0);
  const realizedProfitLoss = posicoes.reduce(
    (s, p) => s + p.realized_profit_loss,
    0
  );

  const semPreco = abertas.filter((p) => !p.has_price);

  return {
    totalInvested: arredondar(totalInvested),
    currentValue: arredondar(currentValue),
    totalProfitLoss: arredondar(totalProfitLoss),
    // Guarda de divisao por zero: carteira vazia imprimiria NaN% num tile da
    // tela, que e o defeito que a HMO-146 achou no patrimonio liquido.
    totalProfitLossPercentage:
      totalInvested > 0
        ? arredondar((totalProfitLoss / totalInvested) * 100)
        : 0,
    totalDividends: arredondar(totalDividends),
    realizedProfitLoss: arredondar(realizedProfitLoss),
    ativosSemPreco: semPreco.length,
  };
}

/**
 * Alocacao por tipo, sobre o VALOR ATUAL das posicoes abertas.
 *
 * Tipo sem nada na carteira fica fora: uma fatia de 0% na legenda do recharts
 * ocupa espaco e faz o usuario procurar uma fatia que nao existe no grafico.
 */
export function alocacaoPorTipo(posicoes: Posicao[]): FatiaAlocacao[] {
  const abertas = posicoesAbertas(posicoes);
  const total = abertas.reduce((s, p) => s + p.current_value, 0);

  const porTipo = new Map<AssetType, number>();
  for (const p of abertas) {
    porTipo.set(p.type, (porTipo.get(p.type) || 0) + p.current_value);
  }

  return TIPOS_DE_ATIVO.filter((t) => (porTipo.get(t) || 0) > 0).map((t) => {
    const valor = porTipo.get(t) || 0;
    return {
      name: ROTULO_TIPO[t],
      value: arredondar(valor),
      // O divisor e o total da CARTEIRA, nao o patrimonio liquido: dividir por
      // um numero que pode ser menor que a parte (ou negativo) produz
      // "investimentos = 2000% da carteira" e inverte o grafico. Foi esse o
      // defeito do patrimonio liquido na HMO-146.
      percentage: total > 0 ? arredondar((valor / total) * 100) : 0,
    };
  });
}

/** Ultimo dia do mes de uma data "YYYY-MM-DD" ou Date, em "YYYY-MM-DD". */
function fimDoMes(ano: number, mesZeroBased: number): string {
  // Dia 0 do mes seguinte e o ultimo dia deste mes, e o construtor com UTC
  // evita o deslize de um dia que o fuso de Sao Paulo (-03) provoca quando a
  // data e montada no horario local.
  const d = new Date(Date.UTC(ano, mesZeroBased + 1, 0));
  return d.toISOString().slice(0, 10);
}

/**
 * Evolucao mes a mes do VALOR INVESTIDO (custo da carteira no fim de cada mes).
 *
 * Nao e o valor de MERCADO historico, e nao pode ser: nao ha serie de cotacao
 * guardada -- so o preco de hoje, informado a mao. Uma linha de "valor de
 * mercado" desenhada com o preco de hoje aplicado a quantidade do passado seria
 * ficcao com aparencia de historico, que e pior que nao ter o grafico.
 *
 * `meses` conta para tras a partir de `hoje`, mas a janela e cortada no mes do
 * PRIMEIRO lancamento: doze meses com nove zeros na frente nao informam nada e
 * achatam a parte que importa.
 */
export function evolucaoMensal(
  lancamentos: LancamentoBruto[],
  meses = 12,
  hoje: Date = new Date()
): PontoEvolucao[] {
  if (lancamentos.length === 0) return [];

  const primeira = emOrdem(lancamentos)[0].trade_date;
  const anoRef = hoje.getUTCFullYear();
  const mesRef = hoje.getUTCMonth();

  const pontos: PontoEvolucao[] = [];

  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(anoRef, mesRef - i, 1));
    const fim = fimDoMes(d.getUTCFullYear(), d.getUTCMonth());

    // Corta o que e anterior ao primeiro lancamento. A comparacao e com o FIM do
    // mes: o mes do primeiro aporte entra, mesmo que o aporte tenha sido no dia
    // 28.
    if (fim < primeira) continue;

    const porAtivo = new Map<string, LancamentoBruto[]>();
    for (const l of lancamentos) {
      const lista = porAtivo.get(l.asset_id);
      if (lista) lista.push(l);
      else porAtivo.set(l.asset_id, [l]);
    }

    let custo = 0;
    // `Array.from` e nao `for (... of map.values())`: o target do tsconfig deste
    // projeto e anterior ao ES2015 e o iterador de Map so compila com
    // downlevelIteration.
    for (const lista of Array.from(porAtivo.values())) {
      custo += replay(lista, fim).custo;
    }

    pontos.push({ date: fim, portfolio: arredondar(custo) });
  }

  return pontos;
}

/**
 * Quanto o usuario pode vender de um ativo hoje.
 *
 * A rota usa isto para recusar a venda que excede a posicao. O banco nao tem
 * como checar isso num CHECK -- a regra depende das OUTRAS linhas da tabela --
 * e sem a verificacao na rota a posicao vira negativa e a tela mostra preco
 * medio zero com quantidade negativa.
 */
export function quantidadeDisponivel(
  lancamentos: LancamentoBruto[],
  assetId: string
): number {
  const doAtivo = lancamentos.filter((l) => l.asset_id === assetId);
  return arredondar(replay(doAtivo).quantidade, 8);
}
