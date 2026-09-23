// =====================================================
// Calculadoras financeiras (HMO-145)
// =====================================================
// Juros compostos, 13o salario, ferias e FGTS.
//
// Tudo aqui e funcao pura: nao le banco, nao pede login, nao grava nada. A
// tela chama estas funcoes no navegador. Foi isto que permitiu a feature subir
// sem migration -- e e por isto que toda a prova de correcao cabe em teste
// unitario, sem Postgres no meio.
//
// -----------------------------------------------------------------------
// Por que este arquivo e perigoso
// -----------------------------------------------------------------------
// Calculadora de folha e o tipo de codigo que erra em silencio. Nao existe
// excecao, nao existe tela vazia, nao existe 500: existe um numero plausivel,
// com duas casas decimais, que o usuario vai levar para uma conversa com o RH.
// As quatro armadilhas que esta implementacao trava, todas com teste proprio:
//
//   1. INSS PROGRESSIVO, nao alliquota cheia. Quem ganha R$ 5.000 nao paga 14%
//      sobre R$ 5.000 (R$ 700). Paga 7,5% sobre a primeira faixa, 9% sobre a
//      segunda, e assim por diante -- R$ 501,51. A diferenca e de R$ 198,49
//      todo mes, e o numero errado parece tao correto quanto o certo.
//   2. TETO. Acima de R$ 8.475,55 a contribuicao PARA. Sem o teto, quem ganha
//      R$ 20.000 apareceria descontando R$ 2.601,51 em vez de R$ 988,09.
//   3. REDUTOR DA LEI 15.270/2025. Desde 01/01/2026 quem recebe ate R$ 5.000
//      por mes nao paga IRRF. Isso NAO esta na tabela de faixas -- a tabela
//      continua cobrando. A isencao vem de um redutor aplicado depois. Uma
//      calculadora que so implemente a tabela cobra R$ 312,89 de quem e
//      isento, e o resultado passa por correto porque a tabela esta certa.
//   4. TAXA ANUAL -> MENSAL e RAIZ DECIMA SEGUNDA, nao divisao por 12. 12% ao
//      ano dividido por 12 da 1% ao mes, que capitalizado devolve 12,68% ao
//      ano. Em 30 anos de aporte a diferenca passa de 20% do montante, e o
//      grafico sobe bonito nos dois casos.
//
// -----------------------------------------------------------------------
// Validade das tabelas
// -----------------------------------------------------------------------
// INSS, IRRF e o redutor mudam TODO ANO, e uma tabela vencida devolve numero
// errado sem nenhum sinal. As tres estao isoladas em constantes exportadas
// logo abaixo, com a data de vigencia no nome, exatamente para que a revisao
// anual seja um lugar so.
// =====================================================

// ---------------------------------------------------------------------------
// Arredondamento
// ---------------------------------------------------------------------------
// `Math.round(v * 100) / 100` erra em binario: 1,005 vira 1,00 porque o double
// mais proximo de 1,005 e 1,00499999999999989. Dinheiro arredondado para baixo
// por causa de representacao binaria e o defeito que ninguem encontra olhando
// o resultado. O epsilon relativo empurra o valor de volta para a fronteira
// antes de arredondar.
export function arredondar(valor: number, casas = 2): number {
  const fator = 10 ** casas;
  const escalado = valor * fator;
  // O epsilon acompanha a magnitude: em R$ 1.000.000 o erro binario e bem
  // maior do que em R$ 1,00, e uma constante fixa nao cobriria os dois.
  const corrigido = escalado + Math.sign(escalado) * Math.abs(escalado) * Number.EPSILON * 4;
  return Math.round(corrigido) / fator;
}

// ===========================================================================
// SECAO 1 -- Tabelas oficiais vigentes em 2026
// ===========================================================================

/**
 * Faixas do INSS para o segurado empregado (CLT), vigentes desde 01/2026.
 *
 * A aliquota vale apenas sobre a PARTE do salario dentro da faixa. `deduzir` e
 * a "parcela a deduzir" publicada, o atalho equivalente (aliquota cheia menos
 * a parcela). Ela nao e usada para calcular -- o codigo soma faixa a faixa --
 * e sim para o teste conferir um metodo contra o outro. Duas contas
 * independentes que batem e uma prova melhor do que uma conta repetida.
 *
 * O atalho so bate com tolerancia de UM CENTAVO, e isso e do atalho, nao do
 * codigo: a parcela publicada vem arredondada em duas casas (R$ 198,49 no
 * lugar de R$ 198,4856), e esse arredondamento entra inteiro no resultado. A
 * soma por faixa e a exata, e e a que reproduz o teto oficial de R$ 988,09.
 */
export const INSS_2026 = {
  vigencia: "01/2026",
  teto: 8475.55,
  faixas: [
    { ate: 1621.0, aliquota: 0.075, deduzir: 0 },
    { ate: 2902.84, aliquota: 0.09, deduzir: 24.32 },
    { ate: 4354.27, aliquota: 0.12, deduzir: 111.4 },
    { ate: 8475.55, aliquota: 0.14, deduzir: 198.49 },
  ],
} as const;

/**
 * Tabela progressiva mensal do IRRF vigente em 2026.
 *
 * ATENCAO ao ler esta tabela sozinha: ela cobra imposto de quem recebe
 * R$ 5.000, que e isento desde 01/01/2026. A isencao NAO mora aqui, mora no
 * REDUTOR_IRRF_2026 logo abaixo. As duas pecas so fazem sentido juntas.
 */
export const IRRF_2026 = {
  vigencia: "01/2026",
  faixas: [
    { ate: 2428.8, aliquota: 0, deduzir: 0 },
    { ate: 2826.65, aliquota: 0.075, deduzir: 182.16 },
    { ate: 3751.05, aliquota: 0.15, deduzir: 394.16 },
    { ate: 4664.68, aliquota: 0.225, deduzir: 675.49 },
    { ate: Infinity, aliquota: 0.275, deduzir: 908.73 },
  ],
  deducaoPorDependente: 189.59,
  // Desde a MP 1.171/2023 a fonte pagadora aplica o desconto simplificado
  // quando ele for MAIOR que a soma das deducoes legais (INSS + dependentes).
  // Nao e opcional nem uma escolha do usuario: e o que for mais vantajoso.
  descontoSimplificado: 607.2,
} as const;

/**
 * Reducao do IRRF criada pela Lei 15.270/2025, em vigor desde 01/01/2026.
 *
 * O texto define UMA formula, aplicada sobre o rendimento BRUTO tributavel (e
 * nao sobre a base de calculo):
 *
 *     redutor = 978,62 - (0,133145 x rendimento)
 *
 * Duas propriedades desta formula, que os testes prendem porque sao o que faz
 * a lei funcionar:
 *
 *   - Em R$ 7.350,00 ela zera (978,62 - 0,133145 x 7.350 = 0,004). E por isso
 *     que a faixa de reducao termina exatamente ali, sem degrau.
 *   - Em R$ 5.000,00 ela vale R$ 312,90, que e exatamente o imposto devido
 *     nesse salario pela tabela acima com o desconto simplificado. Por isso
 *     "isento ate R$ 5.000" e consequencia da formula, nao uma regra separada.
 *     A margem e de MEIO CENTAVO. Se uma revisao futura mexer na tabela sem
 *     mexer no redutor, a isencao quebra silenciosamente -- e ha um teste que
 *     varre a faixa inteira justamente para pegar isso.
 *
 * Vale tambem para o 13o salario, que e tributado isoladamente na fonte
 * (art. 3o-A, paragrafo 3o, da Lei 9.250/1995).
 */
export const REDUTOR_IRRF_2026 = {
  vigencia: "01/2026",
  constante: 978.62,
  coeficiente: 0.133145,
  /** Acima deste rendimento mensal nao ha reducao nenhuma. */
  limite: 7350.0,
} as const;

/** Aliquota do deposito mensal do FGTS para o contrato CLT padrao. */
export const FGTS_ALIQUOTA = 0.08;

/** Juros do FGTS: 3% ao ano, creditados mes a mes (0,25% a.m.), fora a TR. */
export const FGTS_JUROS_ANUAIS = 0.03;

// ===========================================================================
// SECAO 2 -- INSS
// ===========================================================================

export interface ResultadoINSS {
  /** Rendimento sobre o qual a contribuicao foi calculada, ja limitado ao teto. */
  baseUtilizada: number;
  contribuicao: number;
  /** Quanto saiu de cada faixa -- e o que a tela mostra para explicar o numero. */
  porFaixa: { ate: number; aliquota: number; parcela: number }[];
  /** true quando o salario passou do teto e a contribuicao parou de crescer. */
  tetoAtingido: boolean;
  aliquotaEfetiva: number;
}

/**
 * Contribuicao previdenciaria do empregado, faixa a faixa.
 *
 * Soma as fatias em vez de usar "aliquota cheia menos parcela a deduzir". As
 * duas contas dao o mesmo numero (o teste prova), mas esta e a definicao legal
 * e a unica que consegue devolver `porFaixa` para a tela explicar de onde saiu
 * o valor. Calculadora de imposto que so cospe o total nao e conferivel.
 */
export function calcularINSS(rendimento: number): ResultadoINSS {
  const base = Math.max(0, rendimento);
  // O teto e protegido DUAS vezes: por este clamp e pelo `ate` da ultima
  // faixa. A redundancia e proposital e foi medida -- tirar qualquer uma das
  // duas sozinha nao muda nenhum resultado, e so tirando as duas o desconto
  // dispara (R$ 2.601,51 em vez de R$ 988,09 num salario de R$ 20.000).
  // Registrado porque quem encontrar esta linha vai achar que e codigo morto:
  // ela passa a ser a UNICA protecao no dia em que alguem copiar o `Infinity`
  // da ultima faixa da tabela do IRRF para ca.
  const baseUtilizada = Math.min(base, INSS_2026.teto);

  const porFaixa: ResultadoINSS["porFaixa"] = [];
  let piso = 0;
  let total = 0;

  for (const faixa of INSS_2026.faixas) {
    const teto = Math.min(baseUtilizada, faixa.ate);
    if (teto <= piso) break;
    // Acumula SEM arredondar. Arredondar cada faixa e somar depois erra um
    // centavo para cima em boa parte dos salarios: em R$ 5.000 daria R$ 501,52
    // contra os R$ 501,51 que o contracheque traz, e no teto daria R$ 988,10
    // contra os R$ 988,09 oficiais. Um centavo por mes nao derruba nada e nao
    // aparece em teste nenhum -- so no atrito de o app discordar do holerite.
    const parcela = (teto - piso) * faixa.aliquota;
    porFaixa.push({ ate: faixa.ate, aliquota: faixa.aliquota, parcela: arredondar(parcela) });
    total += parcela;
    piso = faixa.ate;
  }

  const contribuicao = arredondar(total);

  // As parcelas exibidas sao arredondadas uma a uma e podem nao somar o total
  // (o residuo chega a um centavo). Quem le a tela SOMA as linhas, entao o
  // residuo vai para a ultima faixa: melhor um centavo deslocado dentro do
  // detalhamento do que um detalhamento que nao fecha com o proprio total.
  if (porFaixa.length > 0) {
    const somaExibida = porFaixa.reduce((acc, f) => acc + f.parcela, 0);
    const residuo = arredondar(contribuicao - somaExibida);
    if (residuo !== 0) {
      const ultima = porFaixa[porFaixa.length - 1];
      ultima.parcela = arredondar(ultima.parcela + residuo);
    }
  }

  return {
    baseUtilizada: arredondar(baseUtilizada),
    contribuicao,
    porFaixa,
    tetoAtingido: base > INSS_2026.teto,
    aliquotaEfetiva: base > 0 ? arredondar(contribuicao / base, 4) : 0,
  };
}

// ===========================================================================
// SECAO 3 -- IRRF
// ===========================================================================

export interface EntradaIRRF {
  /** Rendimento bruto tributavel do mes (ou do 13o, quando isolado). */
  rendimento: number;
  /** INSS ja descontado sobre esse mesmo rendimento. */
  inss: number;
  dependentes?: number;
}

export interface ResultadoIRRF {
  base: number;
  /** Qual deducao prevaleceu -- a tela mostra, porque muda o numero. */
  deducaoAplicada: "legal" | "simplificado";
  valorDeducao: number;
  /** Imposto que a tabela progressiva cobraria, ANTES do redutor da Lei 15.270. */
  impostoTabela: number;
  redutor: number;
  imposto: number;
  aliquotaFaixa: number;
  aliquotaEfetiva: number;
  isentoPelaLei15270: boolean;
}

/**
 * IRRF mensal, ja com o redutor da Lei 15.270/2025.
 *
 * A ordem importa e nao e intuitiva:
 *   1. deducao = a MAIOR entre (INSS + dependentes) e o desconto simplificado;
 *   2. base = rendimento - deducao;
 *   3. imposto pela tabela progressiva sobre a BASE;
 *   4. redutor calculado sobre o rendimento BRUTO -- nao sobre a base;
 *   5. imposto final = max(0, imposto - redutor).
 *
 * O passo 4 e o que se erra: aplicar o redutor sobre a base faz um salario de
 * R$ 5.000 receber redutor de R$ 393,61 em vez de R$ 312,90. Continua dando
 * zero para quem e isento, entao o teste obvio passa -- e cobra a menos de
 * quem ganha entre R$ 5.000 e R$ 7.350, que e onde ninguem confere.
 */
export function calcularIRRF({ rendimento, inss, dependentes = 0 }: EntradaIRRF): ResultadoIRRF {
  const bruto = Math.max(0, rendimento);

  const deducaoLegal = inss + dependentes * IRRF_2026.deducaoPorDependente;
  const usaSimplificado = IRRF_2026.descontoSimplificado > deducaoLegal;
  const valorDeducao = arredondar(usaSimplificado ? IRRF_2026.descontoSimplificado : deducaoLegal);

  const base = arredondar(Math.max(0, bruto - valorDeducao));

  const faixa = IRRF_2026.faixas.find((f) => base <= f.ate) ?? IRRF_2026.faixas[IRRF_2026.faixas.length - 1];
  const impostoTabela = arredondar(Math.max(0, base * faixa.aliquota - faixa.deduzir));

  // O redutor so existe ate o limite. Passou de R$ 7.350, a tabela vale cheia.
  const redutor =
    bruto <= REDUTOR_IRRF_2026.limite
      ? arredondar(Math.max(0, REDUTOR_IRRF_2026.constante - REDUTOR_IRRF_2026.coeficiente * bruto))
      : 0;

  const imposto = arredondar(Math.max(0, impostoTabela - redutor));

  return {
    base,
    deducaoAplicada: usaSimplificado ? "simplificado" : "legal",
    valorDeducao,
    impostoTabela,
    redutor,
    imposto,
    aliquotaFaixa: faixa.aliquota,
    aliquotaEfetiva: bruto > 0 ? arredondar(imposto / bruto, 4) : 0,
    isentoPelaLei15270: impostoTabela > 0 && imposto === 0,
  };
}

// ===========================================================================
// SECAO 4 -- 13o salario
// ===========================================================================

export interface EntradaDecimoTerceiro {
  salarioBruto: number;
  /** Meses trabalhados no ano. Fracao de mes >= 15 dias conta como mes cheio. */
  mesesTrabalhados?: number;
  dependentes?: number;
  /**
   * Quanto ja foi recebido na 1a parcela. Quando ausente, assume o padrao
   * legal: metade do 13o bruto.
   */
  adiantamentoRecebido?: number;
}

export interface ResultadoDecimoTerceiro {
  bruto: number;
  avos: number;
  primeiraParcela: number;
  segundaParcela: number;
  inss: ResultadoINSS;
  irrf: ResultadoIRRF;
  liquido: number;
}

/**
 * 13o salario, nas duas parcelas.
 *
 * A regra que se erra: a 1a parcela (ate 30/11) sai SEM desconto nenhum. INSS
 * e IRRF incidem sobre o 13o INTEIRO e sao retidos de uma vez na 2a parcela
 * (ate 20/12). Dividir os descontos entre as duas parcelas da o mesmo liquido
 * anual e o mesmo total -- e faz o usuario planejar dezembro com varias
 * centenas de reais a mais do que vai receber. O total bate; a data nao.
 *
 * O IRRF do 13o e exclusivo na fonte: nao entra na base do salario do mes,
 * calcula-se isolado. O redutor da Lei 15.270 vale aqui tambem.
 */
export function calcularDecimoTerceiro({
  salarioBruto,
  mesesTrabalhados = 12,
  dependentes = 0,
  adiantamentoRecebido,
}: EntradaDecimoTerceiro): ResultadoDecimoTerceiro {
  const salario = Math.max(0, salarioBruto);
  const avos = Math.min(12, Math.max(0, Math.floor(mesesTrabalhados)));

  const bruto = arredondar((salario / 12) * avos);
  const primeiraParcela = arredondar(adiantamentoRecebido ?? bruto / 2);

  const inss = calcularINSS(bruto);
  const irrf = calcularIRRF({ rendimento: bruto, inss: inss.contribuicao, dependentes });

  const liquido = arredondar(bruto - inss.contribuicao - irrf.imposto);
  // Pode ficar negativa se o usuario informar um adiantamento maior que o
  // devido -- e o que de fato acontece com ele, entao nao se esconde em zero.
  const segundaParcela = arredondar(liquido - primeiraParcela);

  return { bruto, avos, primeiraParcela, segundaParcela, inss, irrf, liquido };
}

// ===========================================================================
// SECAO 5 -- Ferias
// ===========================================================================

export interface EntradaFerias {
  salarioBruto: number;
  /** Dias de descanso. O maximo legal e 30, e 30 - diasAbono quando ha venda. */
  diasFerias?: number;
  /** Abono pecuniario ("vender ferias"): no maximo 1/3, ou seja 10 dias. */
  diasAbono?: number;
  /** Adiantar metade do 13o junto com as ferias, como permite a CLT. */
  adiantarDecimoTerceiro?: boolean;
  dependentes?: number;
}

export interface ResultadoFerias {
  feriasBruto: number;
  tercoConstitucional: number;
  abonoBruto: number;
  tercoAbono: number;
  adiantamentoDecimo: number;
  /** Ferias + 1/3. O abono NAO entra: e isento dos dois tributos. */
  baseTributavel: number;
  inss: ResultadoINSS;
  irrf: ResultadoIRRF;
  totalBruto: number;
  liquido: number;
  avisos: string[];
}

/**
 * Ferias com 1/3 constitucional, abono pecuniario e adiantamento do 13o.
 *
 * Duas regras opostas, e errar qualquer uma das duas produz numero plausivel:
 *
 *   - O 1/3 constitucional E tributado. INSS incide sobre ele desde o Tema 985
 *     do STF (2020), e IRRF sempre incidiu. Tirar o 1/3 da base parece
 *     generoso e devolve um liquido que o contracheque nao vai confirmar.
 *   - O ABONO PECUNIARIO e o 1/3 dele NAO sao tributados. Sao indenizacao, nao
 *     remuneracao. Jogar o abono na base cobra INSS e IRRF de dinheiro isento
 *     e faz a venda de ferias parecer um mau negocio -- o erro chega a mudar a
 *     decisao do usuario, nao so o numero na tela.
 *
 * O adiantamento do 13o tambem fica fora da base: ele e tributado no proprio
 * 13o, em dezembro, e nao aqui.
 */
export function calcularFerias({
  salarioBruto,
  diasFerias = 30,
  diasAbono = 0,
  adiantarDecimoTerceiro = false,
  dependentes = 0,
}: EntradaFerias): ResultadoFerias {
  const salario = Math.max(0, salarioBruto);
  const avisos: string[] = [];

  let abono = Math.max(0, Math.floor(diasAbono));
  if (abono > 10) {
    abono = 10;
    avisos.push("O abono pecuniario e limitado a 1/3 do periodo: no maximo 10 dias.");
  }

  let dias = Math.max(0, Math.floor(diasFerias));
  if (dias + abono > 30) {
    dias = 30 - abono;
    avisos.push(`Descanso + abono nao podem passar de 30 dias. Ajustado para ${dias} dias de descanso.`);
  }

  // A CLT calcula ferias sobre o mes comercial de 30 dias, nao sobre o numero
  // de dias do mes em que elas caem.
  const feriasBruto = arredondar((salario / 30) * dias);
  const tercoConstitucional = arredondar(feriasBruto / 3);
  const abonoBruto = arredondar((salario / 30) * abono);
  const tercoAbono = arredondar(abonoBruto / 3);
  const adiantamentoDecimo = adiantarDecimoTerceiro ? arredondar(salario / 2) : 0;

  const baseTributavel = arredondar(feriasBruto + tercoConstitucional);

  const inss = calcularINSS(baseTributavel);
  const irrf = calcularIRRF({ rendimento: baseTributavel, inss: inss.contribuicao, dependentes });

  const totalBruto = arredondar(
    feriasBruto + tercoConstitucional + abonoBruto + tercoAbono + adiantamentoDecimo,
  );
  const liquido = arredondar(totalBruto - inss.contribuicao - irrf.imposto);

  return {
    feriasBruto,
    tercoConstitucional,
    abonoBruto,
    tercoAbono,
    adiantamentoDecimo,
    baseTributavel,
    inss,
    irrf,
    totalBruto,
    liquido,
    avisos,
  };
}

// ===========================================================================
// SECAO 6 -- FGTS
// ===========================================================================

export type MotivoSaida = "SEM_JUSTA_CAUSA" | "ACORDO" | "PEDIDO_DEMISSAO" | "JUSTA_CAUSA";

export interface EntradaFGTS {
  salarioBruto: number;
  mesesTrabalhados: number;
  saldoInicial?: number;
  /** O 13o tambem gera deposito de 8%, uma vez por ano. */
  incluirDecimoTerceiro?: boolean;
  motivoSaida?: MotivoSaida;
  /** Juros anuais. O padrao e 3%; a TR entra por aqui quando nao for zero. */
  jurosAnuais?: number;
}

export interface ResultadoFGTS {
  depositoMensal: number;
  totalDepositado: number;
  rendimento: number;
  saldoFinal: number;
  percentualMulta: number;
  multa: number;
  /** Saldo + multa: o que o trabalhador saca quando a saida da direito. */
  totalRescisao: number;
  evolucao: { mes: number; deposito: number; juros: number; saldo: number }[];
}

/** Percentual da multa rescisoria por motivo de saida. */
const MULTA_POR_MOTIVO: Record<MotivoSaida, number> = {
  SEM_JUSTA_CAUSA: 0.4,
  // Acordo entre as partes (art. 484-A, reforma de 2017): metade da multa.
  ACORDO: 0.2,
  PEDIDO_DEMISSAO: 0,
  JUSTA_CAUSA: 0,
};

/**
 * Projecao do saldo de FGTS e da multa rescisoria.
 *
 * Os juros sao de 3% ao ano creditados MES A MES (0,25% ao mes), que e como a
 * Caixa credita -- nao 3% capitalizados uma vez por ano. Sao coisas
 * diferentes e a segunda subestima o saldo.
 *
 * Uma simplificacao registrada, porque ela mexe em dinheiro: a base legal da
 * multa e o montante de TODOS os depositos do contrato, corrigidos, mesmo os
 * ja sacados. Aqui ela sai sobre o saldo projetado. Para quem nunca sacou, da
 * no mesmo; para quem aderiu ao saque-aniversario, o valor real e MAIOR que o
 * exibido. O resultado erra para baixo de proposito: e o lado que nao cria
 * expectativa de dinheiro que nao vem.
 */
export function calcularFGTS({
  salarioBruto,
  mesesTrabalhados,
  saldoInicial = 0,
  incluirDecimoTerceiro = true,
  motivoSaida = "SEM_JUSTA_CAUSA",
  jurosAnuais = FGTS_JUROS_ANUAIS,
}: EntradaFGTS): ResultadoFGTS {
  const salario = Math.max(0, salarioBruto);
  const meses = Math.max(0, Math.floor(mesesTrabalhados));
  const depositoMensal = arredondar(salario * FGTS_ALIQUOTA);
  const jurosMensais = jurosAnuais / 12;

  let saldo = Math.max(0, saldoInicial);
  let totalDepositado = 0;
  const evolucao: ResultadoFGTS["evolucao"] = [];

  for (let mes = 1; mes <= meses; mes++) {
    // O 13o gera um deposito extra de 8% sobre ele, pago junto com a parcela
    // de dezembro. Como o 13o cheio equivale a um salario, o extra e igual a
    // um deposito mensal.
    const extra = incluirDecimoTerceiro && mes % 12 === 0 ? depositoMensal : 0;
    const deposito = arredondar(depositoMensal + extra);

    // Juros sobre o saldo que JA existia: o deposito do mes entra depois de o
    // rendimento do periodo ser creditado.
    const juros = arredondar(saldo * jurosMensais);
    saldo = arredondar(saldo + juros + deposito);
    totalDepositado = arredondar(totalDepositado + deposito);

    evolucao.push({ mes, deposito, juros, saldo });
  }

  const percentualMulta = MULTA_POR_MOTIVO[motivoSaida];
  const multa = arredondar(saldo * percentualMulta);

  return {
    depositoMensal,
    totalDepositado,
    rendimento: arredondar(saldo - Math.max(0, saldoInicial) - totalDepositado),
    saldoFinal: saldo,
    percentualMulta,
    multa,
    totalRescisao: arredondar(saldo + multa),
    evolucao,
  };
}

// ===========================================================================
// SECAO 7 -- Juros compostos
// ===========================================================================

export type UnidadeTaxa = "MENSAL" | "ANUAL";

export interface EntradaJurosCompostos {
  valorInicial: number;
  aporteMensal?: number;
  /** Em pontos percentuais: 12 significa 12%. */
  taxa: number;
  unidadeTaxa?: UnidadeTaxa;
  meses: number;
}

export interface ResultadoJurosCompostos {
  montante: number;
  totalInvestido: number;
  jurosGanhos: number;
  taxaMensalEfetiva: number;
  evolucao: { mes: number; investido: number; juros: number; montante: number }[];
}

/**
 * Converte uma taxa anual para a mensal equivalente.
 *
 * Raiz decima segunda, nunca divisao por 12. Dividir 12% por 12 da 1% ao mes,
 * que ao longo de 12 meses rende 12,68% -- a calculadora passaria a prometer
 * um rendimento que o investimento nao entrega. Em 30 anos de aporte mensal a
 * diferenca passa de 20% do montante final, e as duas curvas sobem igualmente
 * bonitas no grafico.
 */
export function taxaMensalEquivalente(taxa: number, unidade: UnidadeTaxa): number {
  const decimal = taxa / 100;
  return unidade === "MENSAL" ? decimal : (1 + decimal) ** (1 / 12) - 1;
}

/**
 * Montante de um aporte inicial somado a aportes mensais constantes.
 *
 * O aporte entra no FIM de cada mes (serie postecipada), que e a convencao das
 * calculadoras de banco: o aporte do mes 1 rende por 11 meses no primeiro ano,
 * nao por 12.
 */
export function calcularJurosCompostos({
  valorInicial,
  aporteMensal = 0,
  taxa,
  unidadeTaxa = "ANUAL",
  meses,
}: EntradaJurosCompostos): ResultadoJurosCompostos {
  const inicial = Math.max(0, valorInicial);
  const aporte = Math.max(0, aporteMensal);
  const n = Math.max(0, Math.floor(meses));
  const i = taxaMensalEquivalente(taxa, unidadeTaxa);

  const evolucao: ResultadoJurosCompostos["evolucao"] = [];
  let montante = inicial;
  let investido = inicial;

  for (let mes = 1; mes <= n; mes++) {
    const juros = montante * i;
    montante = montante + juros + aporte;
    investido += aporte;
    evolucao.push({
      mes,
      investido: arredondar(investido),
      juros: arredondar(montante - investido),
      montante: arredondar(montante),
    });
  }

  const montanteFinal = arredondar(montante);
  const totalInvestido = arredondar(investido);

  return {
    montante: montanteFinal,
    totalInvestido,
    jurosGanhos: arredondar(montanteFinal - totalInvestido),
    taxaMensalEfetiva: arredondar(i * 100, 4),
    evolucao,
  };
}
