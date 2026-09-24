// =====================================================
// Patrimonio liquido consolidado (HMO-145)
// =====================================================
// Consolida as contas do usuario em tres classes -- liquido, investimento e
// divida -- e monta a composicao e a variacao da linha do tempo.
//
// Tudo aqui e funcao pura: nao le banco, nao pede login, nao grava nada. A
// rota /api/net-worth busca as linhas e passa para ca. Foi isso que permitiu
// que a prova de correcao coubesse em teste unitario, sem Postgres no meio.
//
// -----------------------------------------------------------------------
// A conta que este arquivo faz, e por que ela e delicada
// -----------------------------------------------------------------------
// Patrimonio liquido = o que se tem MENOS o que se deve. Neste banco os dois
// lados moram na MESMA coluna: `financial_accounts.current_balance`. Despesa e
// gravada NEGATIVA e o trigger `update_account_balance` soma `amount` direto
// no saldo, em qualquer tipo de conta -- entao um cartao de credito vai
// ficando negativo conforme e usado, e a soma crua de todos os saldos ja e o
// patrimonio liquido.
//
// Isso torna o numero facil de calcular e dificil de LER. As armadilhas que
// este arquivo trava, cada uma com teste proprio:
//
//   1. CLASSIFICAR PELO SINAL, e nao pelo tipo. Um cartao com saldo positivo
//      (estorno maior que as compras) nao virou investimento, e uma conta
//      corrente no cheque especial nao virou cartao. Classificar pelo sinal
//      faz a composicao da carteira mudar de forma sozinha quando um saldo
//      cruza o zero -- a barra de "investimentos" encolhe sem que nenhum
//      investimento tenha sido vendido.
//   2. PERCENTUAL SOBRE O PATRIMONIO LIQUIDO. A participacao de cada classe
//      tem que ser calculada sobre o TOTAL DE ATIVOS, nao sobre o liquido.
//      Quem tem R$ 10.000 aplicados e R$ 9.500 de fatura tem patrimonio de
//      R$ 500; dividir por ele devolveria "investimentos = 2000% da carteira".
//      Com patrimonio negativo o divisor troca de sinal e TODA a composicao
//      aparece invertida, sem erro nenhum na tela.
//   3. DIVISAO POR ZERO. Usuario novo tem as quatro contas padrao zeradas
//      (`create_default_accounts`). Sem guarda, cada percentual vira NaN e a
//      tela imprime "NaN%" em quatro tiles.
//   4. VARIACAO COMPARANDO COM ZERO. O primeiro mes da janela nao tem mes
//      anterior. Tratar o ausente como zero faz a variacao do primeiro mes ser
//      o patrimonio inteiro -- um salto que nunca aconteceu, no grafico que
//      existe para mostrar tendencia.
//
// -----------------------------------------------------------------------
// O que este arquivo NAO consegue consertar
// -----------------------------------------------------------------------
// O NIVEL do patrimonio herda o que estiver em `current_balance` hoje. Se o
// saldo derivou, a consolidacao inteira desloca junto -- a proporcao entre as
// classes continua certa, o valor absoluto nao. A rota manda esse aviso junto
// com os dados e a tela mostra; ver o comentario da view `net_worth_history`
// na migration 008.
// =====================================================

/** Os tipos de conta do enum `public.account_type` (001_baseline). */
export type TipoDeConta =
  | "checking"
  | "savings"
  | "credit_card"
  | "debit_card"
  | "cash"
  | "digital"
  | "investment"
  | "other";

export type ClasseDePatrimonio = "liquido" | "investimento" | "divida";

export interface ContaBruta {
  id: string;
  name: string;
  account_type: TipoDeConta | string;
  current_balance: number | string | null;
  is_active?: boolean | null;
  color_hex?: string | null;
}

export interface ContaConsolidada {
  id: string;
  name: string;
  tipo: string;
  classe: ClasseDePatrimonio;
  saldo: number;
  ativa: boolean;
  color_hex: string | null;
}

export interface TotalDeClasse {
  classe: ClasseDePatrimonio;
  total: number;
  /** Participacao no total de ATIVOS, de 0 a 1. Divida sempre devolve 0. */
  participacao: number;
  contas: ContaConsolidada[];
}

export interface Consolidado {
  patrimonioLiquido: number;
  totalAtivos: number;
  totalDividas: number;
  classes: TotalDeClasse[];
  /** Quanto do patrimonio esta em conta arquivada (`is_active = false`). */
  totalInativas: number;
}

export interface PontoDaLinha {
  month: string;
  net_worth: number;
  net_change: number;
}

export interface PontoComVariacao extends PontoDaLinha {
  /** Diferenca para o mes anterior da janela. `null` no primeiro ponto. */
  variacao: number | null;
  /** Variacao relativa ao mes anterior. `null` quando nao da para dividir. */
  variacaoRelativa: number | null;
}

/**
 * A qual classe de patrimonio um tipo de conta pertence.
 *
 * Repare que a assinatura NAO recebe o saldo. E de proposito: ver a armadilha
 * 1 no cabecalho. A classe e uma propriedade da conta, nao do momento.
 */
export function classificarConta(tipo: string): ClasseDePatrimonio {
  if (tipo === "investment") return "investimento";
  if (tipo === "credit_card") return "divida";
  // checking, savings, cash, digital, debit_card, other -- e qualquer valor
  // novo que entre no enum depois. O default e "liquido" porque um tipo
  // desconhecido quase sempre e dinheiro disponivel; se um dia entrar um tipo
  // de divida (emprestimo, financiamento), ele precisa ser listado acima, e o
  // teste `tipo desconhecido cai em liquido` existe para forcar essa revisao.
  return "liquido";
}

/** Le o saldo tolerando o texto que o PostgREST devolve para `numeric`. */
function saldoDe(conta: ContaBruta): number {
  const bruto = Number(conta.current_balance ?? 0);
  return Number.isFinite(bruto) ? bruto : 0;
}

const ORDEM: ClasseDePatrimonio[] = ["liquido", "investimento", "divida"];

/**
 * Consolida as contas em classes, com totais e participacao.
 *
 * `participacao` divide pelo TOTAL DE ATIVOS (a soma das classes liquido e
 * investimento, quando positiva), nunca pelo patrimonio liquido -- ver a
 * armadilha 2 no cabecalho.
 */
export function consolidar(contas: ContaBruta[]): Consolidado {
  const porClasse = new Map<ClasseDePatrimonio, ContaConsolidada[]>(
    ORDEM.map((c) => [c, [] as ContaConsolidada[]])
  );

  let patrimonioLiquido = 0;
  let totalInativas = 0;

  for (const bruta of contas) {
    const saldo = saldoDe(bruta);
    const classe = classificarConta(String(bruta.account_type));
    const ativa = bruta.is_active !== false;

    porClasse.get(classe)!.push({
      id: bruta.id,
      name: bruta.name,
      tipo: String(bruta.account_type),
      classe,
      saldo,
      ativa,
      color_hex: bruta.color_hex ?? null,
    });

    // A conta arquivada ENTRA no patrimonio. Uma conta encerrada com saldo
    // residual continua sendo dinheiro, e exclui-la faria o patrimonio cair de
    // degrau no mes em que alguem arquivou a conta, sem nenhuma transacao
    // explicando a queda -- e a linha do tempo, que vem da view, continuaria
    // contando. As duas metades da tela discordariam.
    patrimonioLiquido += saldo;
    if (!ativa) totalInativas += saldo;
  }

  const totalDe = (classe: ClasseDePatrimonio) =>
    porClasse.get(classe)!.reduce((soma, c) => soma + c.saldo, 0);

  const liquido = totalDe("liquido");
  const investimento = totalDe("investimento");
  const divida = totalDe("divida");

  // Ativos sao as classes que representam o que se TEM. Uma conta no cheque
  // especial deixa `liquido` negativo; nesse caso ela nao e ativo nenhum, e
  // somar o negativo aqui encolheria o divisor. O `Math.max` mantem o divisor
  // como "o que existe de positivo", que e o unico denominador em que a
  // participacao de uma classe fica entre 0 e 1.
  const totalAtivos = Math.max(liquido, 0) + Math.max(investimento, 0);

  const participacaoDe = (total: number) => {
    if (totalAtivos <= 0) return 0;
    return Math.max(total, 0) / totalAtivos;
  };

  const classes: TotalDeClasse[] = [
    {
      classe: "liquido",
      total: arredondar(liquido),
      participacao: participacaoDe(liquido),
      contas: porClasse.get("liquido")!,
    },
    {
      classe: "investimento",
      total: arredondar(investimento),
      participacao: participacaoDe(investimento),
      contas: porClasse.get("investimento")!,
    },
    {
      // Divida nao disputa espaco na composicao dos ativos: ela e o outro
      // lado da conta. Devolver participacao aqui faria a soma das tres
      // passar de 100% numa barra empilhada.
      classe: "divida",
      total: arredondar(divida),
      participacao: 0,
      contas: porClasse.get("divida")!,
    },
  ];

  return {
    patrimonioLiquido: arredondar(patrimonioLiquido),
    totalAtivos: arredondar(totalAtivos),
    // Positivo e legivel: "voce deve R$ 2.000", nao "-2.000 de divida".
    totalDividas: arredondar(Math.abs(Math.min(divida, 0))),
    classes,
    totalInativas: arredondar(totalInativas),
  };
}

/**
 * Anota cada ponto da linha do tempo com a variacao para o mes anterior.
 *
 * O primeiro ponto devolve `null`, e nao zero: nao ha mes anterior na janela,
 * e zero seria uma afirmacao ("nao mudou") que ninguem verificou.
 */
export function comVariacao(pontos: PontoDaLinha[]): PontoComVariacao[] {
  return pontos.map((ponto, i) => {
    if (i === 0) {
      return { ...ponto, variacao: null, variacaoRelativa: null };
    }
    const anterior = pontos[i - 1].net_worth;
    const variacao = ponto.net_worth - anterior;

    // Divisao pelo mes anterior so faz sentido com base positiva. Partindo de
    // zero, qualquer centavo vira "infinito por cento"; partindo de um
    // patrimonio negativo, melhorar a situacao devolveria percentual NEGATIVO,
    // que le ao contrario do que aconteceu.
    const variacaoRelativa = anterior > 0 ? variacao / anterior : null;

    return {
      ...ponto,
      variacao: arredondar(variacao),
      variacaoRelativa,
    };
  });
}

/**
 * Resumo da janela: onde comecou, onde terminou e quanto andou.
 *
 * `crescimento` fica `null` quando a janela comeca em zero ou negativo, pelo
 * mesmo motivo de `variacaoRelativa`.
 */
export function resumoDaJanela(pontos: PontoDaLinha[]): {
  inicio: number;
  fim: number;
  variacao: number;
  crescimento: number | null;
  melhorMes: PontoDaLinha | null;
  piorMes: PontoDaLinha | null;
} {
  if (!pontos.length) {
    return {
      inicio: 0,
      fim: 0,
      variacao: 0,
      crescimento: null,
      melhorMes: null,
      piorMes: null,
    };
  }

  const inicio = pontos[0].net_worth;
  const fim = pontos[pontos.length - 1].net_worth;

  // Melhor e pior mes saem de `net_change`, que e a variacao EXATA vinda das
  // transacoes -- e o unico numero desta tela que nao herda a deriva do saldo
  // (ver o cabecalho). Usar a diferenca de `net_worth` daria o mesmo resultado
  // com mais arredondamento no caminho.
  let melhorMes = pontos[0];
  let piorMes = pontos[0];
  for (const p of pontos) {
    if (p.net_change > melhorMes.net_change) melhorMes = p;
    if (p.net_change < piorMes.net_change) piorMes = p;
  }

  return {
    inicio: arredondar(inicio),
    fim: arredondar(fim),
    variacao: arredondar(fim - inicio),
    crescimento: inicio > 0 ? (fim - inicio) / inicio : null,
    melhorMes,
    piorMes,
  };
}

/**
 * Duas casas, sem o lixo de ponto flutuante.
 *
 * `0.1 + 0.2` vale `0.30000000000000004`, e somar saldo de dezenas de contas
 * acumula essa sujeira ate aparecer na tela como `R$ 1.234,5600000001`.
 */
function arredondar(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}
