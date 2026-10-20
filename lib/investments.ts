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
//
// RENDA FIXA NAO TEM COTA: `quantity` SAO REAIS E `unit_price` E 1 (HMO-439)
// --------------------------------------------------------------------------
// Um CDB nao se compra em cotas a um preco unitario -- se aplica um VALOR numa
// data. As duas colunas da 021 continuam servindo, com uma convencao declarada:
//
//     aporte de R$ 10.000,00  ->  quantity = 10000, unit_price = 1
//
// Ou seja `quantity` passa a ser "quantos reais foram aplicados" e `unit_price`
// e "quanto vale hoje cada real aplicado". Nada nesta aritmetica muda: `custo`
// e `quantidade * preco + taxas`, que da os mesmos R$ 10.000,00 que a outra
// convencao possivel (`quantity = 1`, `unit_price = valor`) daria.
//
// POR QUE ESTA E NAO A OUTRA -- a medicao que decidiu (HMO-439, 20/10/2026)
//
// 1. NAO HA DADO PARA PRESERVAR. Em producao, `investment_assets` e
//    `investment_transactions` estao FISICAMENTE VAZIAS: `relpages = 0` nas duas
//    (leitura de catalogo, imune a RLS, valendo para todos os usuarios), com
//    `n_tup_ins = n_tup_del` em `pg_stat_user_tables`, e a conta de teste lida
//    pela propria sessao devolve `[]` nas duas tabelas. Entao escolher aqui nao
//    reescreve principal de ninguem -- mas escreve a convencao de TODO dado
//    futuro, e por isso a escolha e declarada e nao implicita.
// 2. E A CONVENCAO QUE O REPO JA USA. A unica fixture de renda fixa da suite
//    (`scripts/test-investments.mjs`, o TESOURO da alocacao) e
//    `lanc("a3", "buy", 1000, 1)` com `current_price: 1` -- R$ 1.000 aplicados.
// 3. E A UNICA QUE SOBREVIVE AO SEGUNDO APORTE, que e o caso para o qual o
//    formulario existe. Com `quantity = 1`, dois aportes (R$ 10.000 e R$ 5.000)
//    deixam `total_quantity = 2` e `average_price = 7.500` -- um numero que a
//    tela imprime como "Preco medio" e que nao significa nada. Pior: a tela
//    avalia a posicao como `quantidade * current_price`, entao quem informasse
//    "este CDB vale hoje R$ 15.200" veria R$ 30.400 na carteira, um erro de
//    dinheiro PLAUSIVEL (exatamente 2x) e sem linha estranha para auditar.
//    Com reais em `quantity`, `average_price` e sempre R$ 1,00, e o mesmo erro
//    de digitacao daria um numero absurdo o suficiente para ser visto.
//
// O que esta convencao deliberadamente NAO tenta fazer e guardar o rendimento:
// a posicao de renda fixa vale `principal` aqui, e o CDI acumulado e PROJETADO
// por lib/renda-fixa.ts a partir deste mesmo `total_invested`. Um resgate
// lancado como `sell` baixa principal e nao produz "resultado realizado" --
// e o certo neste modelo: o rendimento ja esta sendo contado do outro lado, e
// soma-lo aqui tambem seria o contar duas vezes.

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

// ---------------------------------------------------------------------------
// O APORTE EM REAIS -> O PAR DE COLUNAS (HMO-439)
// ---------------------------------------------------------------------------

/**
 * O preco unitario de toda linha de renda fixa: R$ 1,00 por real aplicado.
 *
 * String e nao numero porque e assim que o valor viaja do formulario para o
 * corpo do POST, e porque `investment_transactions.unit_price` tem CHECK
 * `> 0` -- um `1` que virasse `0` por conversao em algum lugar do caminho seria
 * recusado pelo banco, nao gravado em silencio.
 */
export const PRECO_UNITARIO_DA_RENDA_FIXA = "1";

/** O par que `POST /api/investments/transactions` recebe. */
export interface ParDeGravacao {
  quantity: string;
  unitPrice: string;
}

/**
 * Traduz o que a pessoa digitou para as duas colunas da 021.
 *
 * Renda fixa tem UM campo de dinheiro na tela e precisa de DUAS colunas no
 * banco; os outros tipos tem os dois campos e passam direto. A traducao mora
 * aqui, e nao no `onSubmit` da tela, por dois motivos:
 *
 *   - e uma decisao de dinheiro, e as decisoes de dinheiro deste app moram em
 *     arquivo puro com suite que compara numero com numero -- ver o cabecalho;
 *   - escrita na tela, ela seria invisivel para a suite e para os mutantes, e
 *     um `unitPrice` trocado por `quantity` aqui nao levanta excecao nenhuma:
 *     grava um CDB de R$ 1,00 com "10.000 de preco unitario", que soma o MESMO
 *     custo e envenena so a quantidade e o preco medio.
 *
 * Nao valida nada: quem recusa o aporte vazio e a tela (com a frase certa) e a
 * rota (com 400). Devolver a string crua e deliberado -- `Number("")` e ZERO,
 * e um zero montado aqui seria um aporte de R$ 0,00 aceito pelo caminho todo.
 */
export function lancamentoDeCarteiraParaGravar(entrada: {
  ehRendaFixa: boolean;
  quantidade: string;
  preco: string;
  valorDoAporte: string;
}): ParDeGravacao {
  if (!entrada.ehRendaFixa) {
    return { quantity: entrada.quantidade, unitPrice: entrada.preco };
  }

  return {
    quantity: entrada.valorDoAporte,
    unitPrice: PRECO_UNITARIO_DA_RENDA_FIXA,
  };
}

// ---------------------------------------------------------------------------
// QUANTO A CONTA DE INVESTIMENTO VALE (HMO-437, Decisao 1A da HMO-432)
// ---------------------------------------------------------------------------
// Desde a 059 um ativo pode apontar para uma `financial_accounts` do tipo
// `investment`. A partir dai a conta tem DOIS valores possiveis: o
// `current_balance` que a pessoa digitou e o que a carteira atrelada vale. Somar
// os dois conta a mesma aplicacao duas vezes -- e esse defeito nao levanta
// excecao, ele imprime um patrimonio MAIOR com cara de certo. A decisao aprovada
// e a 1(A): com ativo atrelado, a carteira SUBSTITUI o saldo digitado; sem ativo
// atrelado, nada muda. A substituicao em si mora em lib/net-worth.ts; o que mora
// aqui e o total por conta que ela consome.
//
// QUAL VALOR ENTRA, POR TIPO DE ATIVO
// -----------------------------------
// Renda fixa entra pelo valor PROJETADO (`principal + bruto`, de
// lib/renda-fixa.ts) e os outros tipos entram pelo `current_value` desta
// consolidacao. Nao e inconsistencia: sao as duas respostas para "quanto vale
// hoje" que este app tem. Acao tem preco informado a mao; CDB nao tem preco, tem
// indexador, e quem sabe avaliar e a projecao do CDI.
//
// A CONSEQUENCIA DE ESQUECER OS OUTROS TIPOS seria grave e silenciosa: uma conta
// de investimento com uma PETR4 atrelada deixaria de contar o saldo digitado
// (porque ela TEM ativo atrelado) e nao contaria a acao (porque so renda fixa
// teria sido somada). O patrimonio cairia pelo valor da posicao, sem nenhuma
// linha para auditar. Por isso o laco e sobre as posicoes ABERTAS inteiras e o
// mapa de projecao so decide o valor de QUEM ele conhece.
//
// POSICAO ZERADA FICA FORA (`posicoesAbertas`): um CDB resgatado por inteiro nao
// e mais patrimonio. O resultado realizado dele continua valendo no resumo da
// carteira, que e outra pergunta.

/**
 * O valor projetado de um ativo de renda fixa, como `valorDeMercado` o devolve.
 *
 * REDECLARADO, e nao importado de `@/lib/renda-fixa`: `test:investments` compila
 * ESTE arquivo sozinho (`compila.mjs lib/investments.ts`), sem o passo
 * `resolve-aliases`, e o `@/` de um import sobrevive no JS emitido -- a suite
 * morreria com ERR_MODULE_NOT_FOUND antes da primeira assercao. A compatibilidade
 * e estrutural: o `Record` que a rota recebe de lib/renda-fixa.ts entra aqui sem
 * conversao, e o tsc reprova se os campos divergirem.
 */
export interface ValorProjetadoDoAtivo {
  /** `principal + rendimento bruto`. */
  valor: number;
  /** `principal + rendimento liquido estimado`. */
  valorLiquido: number;
  principal: number;
  rendimento: number;
  /** false quando o valor caiu para o custo por falta de projecao. */
  rendeu: boolean;
}

/** O que uma conta vale em carteira -- uma linha por `account_id`. */
export interface CarteiraDaConta {
  /** `investment_assets.account_id` (059). `null` = ativo sem conta atrelada. */
  account_id: string | null;
  /** O valor de hoje: renda fixa pelo projetado, o resto pelo `current_value`. */
  valor: number;
  /** O mesmo valor com o IR estimado do rendimento descontado. */
  valorLiquido: number;
  /** O custo das posicoes abertas desta conta. */
  principal: number;
  /** O rendimento de renda fixa ja contado no `valor`. */
  rendimento: number;
  /** Quantas posicoes abertas a conta tem. */
  ativos: number;
  /** Posicoes avaliadas PELO CUSTO por falta de preco informado. */
  semPreco: number;
  /** Posicoes de renda fixa que entraram SEM rendimento (projecao nao saiu). */
  semRendimento: number;
}

/**
 * Agrupa o valor das posicoes abertas por conta de investimento.
 *
 * `contaPorAtivo` vem da rota (que leu `investment_assets.account_id`) e nao das
 * posicoes: `Posicao` nao carrega o elo, pelo mesmo motivo que `Projecao` nao
 * carrega -- estes dois arquivos calculam dinheiro e nao conhecem conta
 * bancaria.
 *
 * O ativo SOLTO (`account_id` nulo ou ausente) nao e descartado: ele sai na
 * linha de `account_id: null`. Descarta-lo aqui faria o valor dele desaparecer
 * sem rastro; devolve-lo numa linha propria deixa o chamador dizer em voz alta
 * que aquele dinheiro esta na carteira e em conta nenhuma -- que e o estado real
 * de todo ativo cadastrado antes da 059.
 *
 * A ordem e determinista (conta por `account_id`, o solto por ultimo) para a
 * tela e as suites nao dependerem da ordem de insercao do `Map`.
 */
export function valorDaCarteiraPorConta(
  posicoes: Posicao[],
  contaPorAtivo: Record<string, string | null>,
  projetado?: Record<string, ValorProjetadoDoAtivo> | null
): CarteiraDaConta[] {
  const porConta = new Map<string, CarteiraDaConta>();
  // `null` nao e chave de Map com tipo `string`; a linha do solto fica numa
  // variavel separada e e concatenada no fim.
  const SOLTO = " solto";

  for (const p of posicoesAbertas(posicoes)) {
    const chave = contaPorAtivo[p.asset_id] ?? null;
    const mapKey = chave === null ? SOLTO : chave;

    let linha = porConta.get(mapKey);
    if (!linha) {
      linha = {
        account_id: chave,
        valor: 0,
        valorLiquido: 0,
        principal: 0,
        rendimento: 0,
        ativos: 0,
        semPreco: 0,
        semRendimento: 0,
      };
      porConta.set(mapKey, linha);
    }

    const proj = projetado ? projetado[p.asset_id] : undefined;

    if (proj) {
      // Renda fixa: o preco informado e IGNORADO e o valor e `principal +
      // bruto`. O racional esta no cabecalho de lib/renda-fixa.ts -- somar o
      // bruto em cima de um preco informado a mao conta o rendimento duas vezes.
      linha.valor += proj.valor;
      linha.valorLiquido += proj.valorLiquido;
      linha.principal += proj.principal;
      linha.rendimento += proj.rendimento;
      if (!proj.rendeu) linha.semRendimento++;
    } else {
      // Os outros tipos: `current_value` ja cai para o custo quando falta preco,
      // e `has_price` e o que a tela usa para avisar. O valor liquido de uma
      // acao e o valor dela: o IR de acao e sobre o ganho na VENDA e depende de
      // isencao mensal, que este app nao modela -- estimar aqui seria chutar.
      linha.valor += p.current_value;
      linha.valorLiquido += p.current_value;
      linha.principal += p.total_invested;
      if (!p.has_price) linha.semPreco++;
    }

    linha.ativos++;
  }

  const comConta: CarteiraDaConta[] = [];
  let solto: CarteiraDaConta | null = null;

  // `Array.from` e nao iterador direto: o target deste tsconfig e anterior ao
  // ES2015 -- mesma razao do laco de `evolucaoMensal`.
  for (const linha of Array.from(porConta.values())) {
    const fechada: CarteiraDaConta = {
      ...linha,
      valor: arredondar(linha.valor),
      valorLiquido: arredondar(linha.valorLiquido),
      principal: arredondar(linha.principal),
      rendimento: arredondar(linha.rendimento),
    };
    if (fechada.account_id === null) solto = fechada;
    else comConta.push(fechada);
  }

  comConta.sort((a, b) =>
    (a.account_id as string) < (b.account_id as string)
      ? -1
      : (a.account_id as string) > (b.account_id as string)
        ? 1
        : 0
  );

  return solto ? comConta.concat([solto]) : comConta;
}
