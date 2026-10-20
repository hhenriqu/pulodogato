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
//   3. DIVISAO POR ZERO. Usuario novo tem as contas padrao zeradas
//      (`create_default_accounts`, que desde a 056 cria DUAS: Conta Corrente e
//      Dinheiro). Sem guarda, cada percentual vira NaN e a tela imprime "NaN%"
//      em todos os tiles. A guarda nao depende de QUANTAS contas sao: o que
//      zera o divisor e o total de ativos, e ele da zero com duas ou com dez.
//   4. VARIACAO COMPARANDO COM ZERO. O primeiro mes da janela nao tem mes
//      anterior. Tratar o ausente como zero faz a variacao do primeiro mes ser
//      o patrimonio inteiro -- um salto que nunca aconteceu, no grafico que
//      existe para mostrar tendencia.
//
// -----------------------------------------------------------------------
// A CARTEIRA SUBSTITUI O SALDO DIGITADO (HMO-437, Decisao 1A da HMO-432)
// -----------------------------------------------------------------------
// Desde a 059 um ativo da carteira pode apontar para uma conta de
// investimento. Isso cria um quinto erro possivel, e o mais caro de todos:
//
//   5. CONTAR A MESMA APLICACAO DUAS VEZES. Quem mantinha o saldo da Conta
//      Investimento na mao -- que e o unico jeito que funcionava antes desta
//      fase -- e agora atrela o CDB a ela tem o mesmo dinheiro no
//      `current_balance` e na carteira. Somar os dois nao levanta excecao, nao
//      quebra nenhuma proporcao e nao deixa linha estranha: imprime um
//      patrimonio MAIOR, plausivel, e exatamente igual ao certo mais o valor da
//      aplicacao.
//
// A regra aprovada: conta de investimento COM ativo atrelado vale o que a
// carteira vale (`principal + rendimento`), e o `current_balance` dela deixa de
// entrar no patrimonio -- continua visivel como "saldo informado", com a data,
// para a pessoa comparar e corrigir o que quiser. Conta SEM ativo atrelado
// continua exatamente como antes desta fase.
//
// Tres recusas deliberadas, cada uma com teste:
//
//   - NAO SOMAR as duas (opcao B do plano) -- e a dupla contagem acima;
//   - NAO ESCREVER `current_balance` por trigger (Decisao 3): as triggers
//     legadas de saldo deste banco ja perderam dinheiro. O valor e derivado na
//     LEITURA, aqui, por funcao pura. Nenhuma escrita automatica em saldo;
//   - NAO SUBSTITUIR conta que nao e de investimento. A trava da 059 exige
//     `account_type = 'investment'` no elo, mas esta funcao nao confia nela: ela
//     recebe linhas, nao garantias. Uma conta corrente atrelada por engano
//     perderia o saldo dela sem nenhum aviso.
//
// -----------------------------------------------------------------------
// O que este arquivo NAO consegue consertar
// -----------------------------------------------------------------------
// O NIVEL do patrimonio herda o que estiver em `current_balance` hoje. Se o
// saldo derivou, a consolidacao inteira desloca junto -- a proporcao entre as
// classes continua certa, o valor absoluto nao. A rota manda esse aviso junto
// com os dados e a tela mostra; ver o comentario da view `net_worth_history`
// na migration 008.
//
// E a parte que vem da CARTEIRA nao esta na view `net_worth_history` de jeito
// nenhum: aquela view reconstroi o passado a partir de `current_balance`. Desde
// esta fase o numero grande e o ultimo ponto da curva podem divergir pelo valor
// da carteira atrelada, e isso nao e erro de nenhum dos dois -- e a rota que
// tem de dizer de onde veio cada parte.
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

/**
 * O que a carteira atrelada a uma conta vale -- uma linha por conta.
 *
 * REDECLARADO, e nao importado de `@/lib/investments`: `test:net-worth` compila
 * ESTE arquivo sozinho (`compila.mjs lib/net-worth.ts`), sem o passo
 * `resolve-aliases`, e o `@/` de um import sobreviveria no JS emitido -- a suite
 * morreria com ERR_MODULE_NOT_FOUND. A compatibilidade e estrutural: o que
 * `valorDaCarteiraPorConta` devolve entra aqui sem conversao.
 *
 * O `account_id` e `string | null` porque e assim que ele chega de la (o solto
 * vem numa linha propria). Linha de `null` e IGNORADA por esta funcao -- ativo
 * sem conta atrelada nao pertence a conta nenhuma, e a rota diz isso a parte.
 */
export interface CarteiraDaConta {
  account_id: string | null;
  /** `principal + rendimento bruto` das posicoes abertas da conta. */
  valor: number;
  /** O mesmo valor com o IR estimado do rendimento descontado. */
  valorLiquido: number;
  principal: number;
  rendimento: number;
}

/** De onde saiu o `saldo` de uma conta consolidada. */
export type OrigemDoSaldo = "saldo_informado" | "carteira";

export interface ContaConsolidada {
  id: string;
  name: string;
  tipo: string;
  classe: ClasseDePatrimonio;
  /** O valor que ENTROU no patrimonio -- ja e o da carteira, quando houver. */
  saldo: number;
  ativa: boolean;
  color_hex: string | null;
  /**
   * `"carteira"` quando a carteira atrelada substituiu o saldo digitado.
   * Sem carteira o campo e `"saldo_informado"`, e `saldo` e o de sempre.
   */
  origemDoSaldo: OrigemDoSaldo;
  /**
   * O `current_balance` digitado, SEMPRE -- inclusive quando ele nao conta.
   *
   * Ele nao e descartado de proposito: e com ele que a tela mostra "voce
   * informou X, a carteira vale Y" e a pessoa descobre que o saldo que ela
   * mantinha na mao estava defasado. Zerar aqui esconderia a unica evidencia de
   * que a substituicao aconteceu.
   */
  saldoInformado: number;
  /** As parcelas do valor da carteira. `null` quando a carteira nao entrou. */
  carteira: { valor: number; valorLiquido: number; principal: number; rendimento: number } | null;
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
  /** Quanto do patrimonio veio da CARTEIRA e nao de saldo digitado. */
  totalEmCarteira: number;
  /**
   * A soma dos `current_balance` que PARARAM de contar por substituicao.
   *
   * E este numero que prova que a dupla contagem nao aconteceu: sem ele, um
   * total maior do que o esperado nao se distingue de um saldo que subiu.
   */
  saldoInformadoIgnorado: number;
  /** IR estimado sobre o rendimento que entrou no patrimonio. Zero sem carteira. */
  irEstimado: number;
  /**
   * O patrimonio com o `irEstimado` descontado -- o numero PEQUENO da tela.
   *
   * O numero grande e o BRUTO (Decisao 2 do plano): a aliquota de IR cai nas
   * bordas de 180/360/720 dias, entao um patrimonio exibido pelo liquido SUBIRIA
   * sozinho na virada de um desses dias, sem aporte nenhum.
   */
  patrimonioDescontandoIr: number;
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
export function consolidar(
  contas: ContaBruta[],
  carteira?: CarteiraDaConta[] | null
): Consolidado {
  const porClasse = new Map<ClasseDePatrimonio, ContaConsolidada[]>(
    ORDEM.map((c) => [c, [] as ContaConsolidada[]])
  );

  // O indice por conta. A linha do ativo SOLTO (`account_id: null`) fica fora:
  // ela e dinheiro na carteira que nao pertence a conta nenhuma, e enfia-la em
  // qualquer conta seria inventar um elo que o banco nao tem.
  const carteiraDaConta = new Map<string, CarteiraDaConta>();
  for (const linha of carteira ?? []) {
    if (linha.account_id === null || linha.account_id === "") continue;
    carteiraDaConta.set(linha.account_id, linha);
  }

  let patrimonioLiquido = 0;
  let totalInativas = 0;
  let totalEmCarteira = 0;
  let saldoInformadoIgnorado = 0;
  let irEstimado = 0;

  for (const bruta of contas) {
    const saldoInformado = saldoDe(bruta);
    const classe = classificarConta(String(bruta.account_type));
    const ativa = bruta.is_active !== false;

    // A substituicao exige as DUAS coisas: ter carteira atrelada E ser conta de
    // investimento. O segundo teste nao e redundante com a trava da 059 -- ver a
    // terceira recusa no cabecalho.
    const daCarteira =
      classe === "investimento" ? carteiraDaConta.get(bruta.id) : undefined;

    const saldo = daCarteira ? daCarteira.valor : saldoInformado;

    if (daCarteira) {
      totalEmCarteira += daCarteira.valor;
      saldoInformadoIgnorado += saldoInformado;
      // O IR estimado sai da diferenca entre bruto e liquido JA calculada do
      // outro lado. Recalcular aliquota aqui seria uma segunda implementacao da
      // regra dos 180/360/720 dias, em um arquivo que nao sabe o prazo de nada.
      irEstimado += daCarteira.valor - daCarteira.valorLiquido;
    }

    porClasse.get(classe)!.push({
      id: bruta.id,
      name: bruta.name,
      tipo: String(bruta.account_type),
      classe,
      saldo,
      ativa,
      color_hex: bruta.color_hex ?? null,
      origemDoSaldo: daCarteira ? "carteira" : "saldo_informado",
      saldoInformado,
      carteira: daCarteira
        ? {
            valor: daCarteira.valor,
            valorLiquido: daCarteira.valorLiquido,
            principal: daCarteira.principal,
            rendimento: daCarteira.rendimento,
          }
        : null,
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
    totalEmCarteira: arredondar(totalEmCarteira),
    saldoInformadoIgnorado: arredondar(saldoInformadoIgnorado),
    irEstimado: arredondar(irEstimado),
    patrimonioDescontandoIr: arredondar(patrimonioLiquido - irEstimado),
  };
}

// ---------------------------------------------------------------------------
// O AVISO: DE ONDE VEIO CADA PARTE (HMO-437)
// ---------------------------------------------------------------------------
// Desde esta fase o numero grande pode ter DUAS origens na mesma soma -- saldo
// digitado e carteira atrelada -- e pode nao bater com o ultimo ponto da curva,
// que a view reconstroi so a partir de saldo. Um numero novo sem legenda nao se
// distingue de bug, e o caminho dessa estranheza termina em alguem
// "consertando" a conta por fora, editando o saldo a mao: exatamente o trabalho
// que esta fase existiu para acabar.
//
// POR QUE ESTA FRASE E FUNCAO PURA, E NAO UM LITERAL NA ROTA
// ---------------------------------------------------------
// Porque ela e CONDICIONAL. Dizer "parte deste total vem da carteira" para quem
// nao tem ativo atrelado e um aviso falso, e dizer que o patrimonio e bruto para
// quem nao tem renda fixa nenhuma e ruido. Cada oracao e ligada pelo numero que
// o proprio consolidado devolveu -- e isso tem suite, porque frase que mente
// sobre dinheiro custa o mesmo que numero errado.
//
// OS VALORES NAO ENTRAM NO TEXTO de proposito: eles ja vao na resposta
// (`totalEmCarteira`, `saldoInformadoIgnorado`, `irEstimado`), formatados pela
// tela, que e quem conhece o `Intl` do navegador. Um "R$ 10.412,35" montado aqui
// seria um segundo formatador de dinheiro, com separador diferente do resto do
// app no primeiro locale que divergir.

/** O que a rota sabe sobre a leitura da carteira e o consolidado nao. */
export interface OrigemDasPartes {
  /**
   * false SO quando a carteira falhou (banco sem a 059, erro de leitura) -- o
   * patrimonio sai como antes desta fase, e dizer isso e melhor que um silencio
   * que parece "voce nao tem investimento".
   *
   * CARTEIRA VAZIA E `true`: quem nunca cadastrou um ativo nao tem nada para ser
   * avisado, e esse e o caso da maioria. Um aviso ai seria ruido permanente na
   * tela de quem nao usa a carteira -- e ruido permanente e como se aprende a
   * nao ler avisos.
   */
  carteiraLida: boolean;
  /** Indexadores cujo boletim do Banco Central nao veio. */
  indexadoresSemBoletim?: string[];
  /** Valor na carteira sem conta atrelada -- ele NAO entra no patrimonio. */
  carteiraSolta?: number;
}

/** O aviso base, que vale com ou sem carteira. */
export const AVISO_DO_SALDO =
  "A variação mês a mês vem das transações e é exata. O nível parte do saldo " +
  "atual das contas, que é mantido por trigger — se o saldo tiver derivado, a " +
  "curva inteira se desloca junto.";

/**
 * O `caveat` da rota: uma frase por origem presente no total.
 *
 * A ordem e fixa (saldo, carteira, curva, IR, pendencias) para a frase nao
 * mudar de forma entre duas leituras iguais.
 */
export function avisoDoPatrimonio(
  c: Consolidado,
  origem: OrigemDasPartes
): string {
  const frases: string[] = [AVISO_DO_SALDO];

  if (c.totalEmCarteira > 0) {
    frases.push(
      "Parte deste total não vem de saldo digitado: as contas de investimento " +
        "com ativo atrelado valem o que a carteira vale (valor aplicado mais " +
        "rendimento bruto), e o saldo informado delas continua visível mas não " +
        "é somado — é assim que a mesma aplicação não conta duas vezes."
    );
    frases.push(
      "A linha do tempo não conhece a carteira: ela reconstrói o passado a " +
        "partir do saldo das contas, então o último ponto da curva pode ficar " +
        "menor que o número de hoje pelo valor da carteira atrelada."
    );
  }

  if (c.irEstimado > 0) {
    frases.push(
      "O número grande é o BRUTO. O líquido estimado desconta o IR do " +
        "rendimento de renda fixa; ele muda só por o tempo passar, porque a " +
        "alíquota cai em 180, 360 e 720 dias."
    );
  }

  if ((origem.indexadoresSemBoletim ?? []).length > 0) {
    frases.push(
      "O Banco Central não respondeu por " +
        (origem.indexadoresSemBoletim as string[]).join(", ") +
        " nesta leitura: os papéis desse índice entram pelo valor aplicado, " +
        "sem o rendimento do período."
    );
  }

  if ((origem.carteiraSolta ?? 0) > 0) {
    frases.push(
      "Há investimento na carteira sem conta atrelada. Ele aparece na tela de " +
        "investimentos e NÃO entra neste patrimônio — atrele o ativo a uma " +
        "conta de investimento para ele passar a contar."
    );
  }

  if (!origem.carteiraLida) {
    frases.push(
      "A carteira de investimentos não entrou nesta leitura: o patrimônio " +
        "saiu só do saldo das contas."
    );
  }

  return frases.join(" ");
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
