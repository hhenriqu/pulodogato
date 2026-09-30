// -----------------------------------------------------------------------------
// RESULTADO PREVISTO x RESULTADO REALIZADO (HMO-186)
// -----------------------------------------------------------------------------
// O painel sabia dizer o que ENTROU e o que SAIU -- os dois numeros vem de
// `monthly_cash_flow`, que e um rollup de `financial_transactions`. O que ele
// nao sabia dizer e se aquilo bateu com o que estava PREVISTO: quanto era
// esperado entrar, quanto era esperado sair, e qual resultado o mes prometia.
//
// DE ONDE SAI O "PREVISTO", E POR QUE ELE NAO E UM ORCAMENTO
// ----------------------------------------------------------
// Sai da AGENDA -- `scheduled_transactions`, as contas previstas e as receitas
// previstas do periodo. Nao sai de `budgets`: orcamento e um teto por
// categoria, uma intencao de gasto; a agenda e um compromisso datado, com valor
// e vencimento. "Previsto de entradas" de um orcamento simplesmente nao existe
// -- orcamento nao tem receita.
//
// A CONSEQUENCIA QUE PRECISA ESTAR NA TELA, NAO SO AQUI
// -----------------------------------------------------
// As duas metades da comparacao NAO cobrem o mesmo universo, e essa e a
// armadilha central desta feature. A agenda tem o aluguel, a escola, o salario.
// O realizado tem isso e mais o supermercado, o posto, o lanche de terca -- tudo
// que ninguem agenda. Para a maioria dos usuarios `despesas` realizadas vao ser
// MAIORES que as previstas quase todo mes, e a diferenca nao significa
// "estourei o plano": significa "a maior parte do que eu gasto nao esta
// agendada".
//
// Ler essa diferenca como desvio de plano e o erro que esta feature pode
// induzir, e ele nao da erro nenhum -- da um numero plausivel e uma conclusao
// falsa. Por isso `quantidade` sai daqui junto com os totais: a tela precisa
// poder dizer sobre quantas linhas a coluna "previsto" foi construida, e
// precisa calar a comparacao inteira quando a agenda do periodo esta vazia.
// Zero previsto contra R$ 4.000 realizados nao e "resultado 4.000 acima do
// previsto", e "nao havia previsao".
//
// O SINAL, NAS DUAS PONTAS
// ------------------------
// Aqui dentro `entradas` e `despesas` sao sempre POSITIVOS, e `resultado` e
// `entradas - despesas`. Isso vale para as duas colunas, e e o que permite
// subtrair uma da outra sem pensar:
//
//   * previsto  -> `scheduled_transactions.amount` tem CHECK amount > 0, entao
//     o valor ja nasce positivo. O que diz se aquilo entra ou sai NAO e o
//     sinal: e `recurring_rules.transaction_type`, porque a ocorrencia nao
//     guarda direcao. Conta avulsa (sem regra) e despesa, pela mesma convencao
//     que /api/projection e lib/safe-to-spend.ts ja usam.
//   * realizado -> `total_expense` chega positivo de /api/reports/cash-flow,
//     que aplica o ABS sobre o valor negativo do banco.
//
// A DIFERENCA E `realizado - previsto`, SEMPRE NESSA ORDEM
// -------------------------------------------------------
// E nao `previsto - realizado`. A ordem importa porque o sinal vai para a tela:
// com esta, "+" quer dizer "veio mais do que o esperado" em QUALQUER das tres
// linhas, e o usuario nao precisa lembrar que em despesa o sinal se inverte.
// O que muda por linha e se "mais" e bom -- e isso e cor, nao sinal.
// -----------------------------------------------------------------------------

/** Para onde uma linha da agenda aponta. */
export type DirecaoPrevista = "income" | "expense";

/**
 * Como a tela fala de uma linha da agenda, dada a direcao dela (HMO-188).
 *
 * "Marcar como paga" numa receita prevista foi o defeito que a HMO-188 nomeia:
 * a pessoa confirma que RECEBEU, nao que pagou. E o erro nao e so de palavra --
 * ele esconde que existem duas coisas diferentes na mesma lista, e quem ve o
 * salario com um botao de "pagar" conclui que cadastrou errado.
 *
 * Sai daqui, e nao de um ternario no JSX, por dois motivos: o ternario e
 * conferido por inspecao visual (e sao quatro strings por direcao, em tres
 * lugares da tela), e este modulo ja e o dono da nocao de direcao prevista --
 * `somarAgenda` le a mesma coisa para decidir em qual balde a linha entra.
 *
 * `direction` chega da coluna homonima de `scheduled_transactions_effective`,
 * que resolveu a precedencia no banco (027). Qualquer valor inesperado cai em
 * despesa, que e o default historico da rota de baixa -- e o lado seguro: ler
 * uma despesa como receita mostraria "vou receber" sobre uma conta a pagar.
 */
export interface CopiaDaPrevisao {
  /** O `title` do botao de confirmar. */
  confirmar: string;
  /** O verbo no infinitivo, para frases montadas. */
  verbo: string;
  /** O rotulo do grupo na lista: "a pagar" x "a receber". */
  rotulo: string;
  /** O aviso curto do que a confirmacao faz com o saldo. */
  efeito: string;
}

export function copiaDaPrevisao(direction?: string | null): CopiaDaPrevisao {
  if (direction === "income") {
    return {
      confirmar: "Confirmar recebimento",
      verbo: "receber",
      rotulo: "a receber",
      efeito: "O valor entra no saldo da conta.",
    };
  }
  return {
    confirmar: "Marcar como paga",
    verbo: "pagar",
    rotulo: "a pagar",
    efeito: "O valor sai do saldo da conta.",
  };
}

/**
 * Para que lado uma linha da agenda vai quando a pergunta e CAIXA: quanto ainda
 * vai sair da conta, quanto ainda vai entrar.
 *
 * Existe separado de `direcaoNoPainel` (lib/realizado-e-previsao.ts) porque as
 * duas perguntas discordam de proposito em dois casos, e confundi-las erra em
 * silencio nos dois sentidos:
 *
 *   * FATURA DE CARTAO entra aqui como "a pagar". La ela fica FORA, porque la a
 *     pergunta e "quanto vou gastar no periodo" e cada compra do cartao ja
 *     entrou como despesa no dia em que aconteceu -- somar a fatura por cima
 *     cobraria as mesmas compras duas vezes. Aqui a pergunta e outra: a fatura
 *     e dinheiro que vai mesmo sair da conta corrente no dia do vencimento, e
 *     esconde-la do "a vencer" faria o bloco prometer uma folga que nao existe.
 *
 *   * TRANSFERENCIA tambem entra como "a pagar", pelo mesmo motivo pratico: a
 *     perna agendada e uma saida datada da conta. Tira-la reduziria o numero
 *     que o bloco existe para dizer.
 *
 * Ou seja, so `income` sai do lado de "a pagar". Direcao desconhecida cai em
 * despesa -- o default historico de /api/projection e do lib/safe-to-spend.ts,
 * e o lado seguro: ler uma despesa como receita mostraria "vou receber" sobre
 * uma conta a pagar.
 *
 * `direction` chega da coluna homonima de `scheduled_transactions_effective`
 * (027), que ja resolveu a precedencia ocorrencia -> regra -> 'expense'. Refazer
 * o COALESCE aqui criaria a segunda copia da precedencia, e a copia esquecida e
 * exatamente o defeito da HMO-187.
 */
export function direcaoDaAgenda(
  direction?: string | null
): DirecaoPrevista {
  return direction === "income" ? "income" : "expense";
}

/**
 * Uma linha da agenda, pronta para somar.
 *
 * `amount` positivo e ja recortado pela parte do membro quando a linha e de
 * grupo -- ver lib/parte-do-grupo.ts. A rota faz esse recorte antes de chamar
 * aqui; sem ele o aluguel de R$ 3.000 do grupo Casa entraria inteiro no
 * previsto das duas pessoas.
 */
export interface LinhaDaAgenda {
  amount: number | string;
  /** O status GRAVADO (`scheduled_status`), nao o derivado. */
  status: string;
  direcao: DirecaoPrevista;
}

export interface PrevistoDoPeriodo {
  entradas: number;
  despesas: number;
  resultado: number;
  /** Quantas linhas da agenda entraram na conta. Zero cala a comparacao. */
  quantidade: number;
}

export interface RealizadoDoPeriodo {
  entradas: number;
  /** POSITIVO, como /api/reports/cash-flow devolve. */
  despesas: number;
  resultado: number;
}

/**
 * Os status que SAEM do previsto.
 *
 * Deny-list, e nao allow-list de `pending`+`paid`, porque a regra e semantica e
 * nao uma lista de valores: previsto e o que o periodo prometia, e estes dois
 * sao exatamente as maneiras de uma linha DEIXAR de fazer parte da promessa --
 * 'skipped' e "pulei este mes", 'cancelled' e "nao existe mais".
 *
 * `paid` fica DENTRO, e esse e o ponto que uma allow-list de "pending" erraria
 * de um jeito que ninguem veria: no dia 30 do mes toda conta prevista ja foi
 * paga, e um previsto que so conta pendentes fecharia o mes em zero. A
 * comparacao viraria "previsto R$ 0,00 x realizado R$ 6.000" no unico momento
 * em que ela tem todos os dados -- e pareceria um bug de dados, nao de
 * definicao.
 *
 * 'overdue' nao aparece aqui porque nunca e gravado: a view do 005 o calcula na
 * hora a partir de `pending` + vencimento passado. Uma linha vencida e uma
 * linha que o periodo previa e que continua prevista.
 */
export const STATUS_FORA_DO_PREVISTO: ReadonlySet<string> = new Set([
  "skipped",
  "cancelled",
]);

/** Centavos, sem o ruido de ponto flutuante acumulado na soma. */
const centavos = (valor: number) => Number(valor.toFixed(2));

const numero = (valor: number | string | null | undefined): number => {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Soma a agenda de um periodo em entradas, despesas e resultado.
 *
 * O `Math.abs` sobre `amount` nao e paranoia sobre o CHECK do banco: esta
 * funcao tambem soma linhas que vieram de um mes ja agregado por outra rota, e
 * um valor negativo escapando ali viraria uma despesa que AUMENTA o resultado
 * previsto -- numero plausivel, conta errada.
 */
export function somarAgenda(linhas: LinhaDaAgenda[]): PrevistoDoPeriodo {
  let entradas = 0;
  let despesas = 0;
  let quantidade = 0;

  for (const linha of linhas) {
    if (STATUS_FORA_DO_PREVISTO.has(String(linha.status))) continue;

    const valor = Math.abs(numero(linha.amount));
    quantidade += 1;

    if (linha.direcao === "income") {
      entradas += valor;
    } else {
      despesas += valor;
    }
  }

  return {
    entradas: centavos(entradas),
    despesas: centavos(despesas),
    resultado: centavos(entradas - despesas),
    quantidade,
  };
}

// -----------------------------------------------------------------------------
// O QUE AINDA VAI SAIR x O QUE AINDA VAI ENTRAR (HMO-187)
// -----------------------------------------------------------------------------
// `somarAgenda` acima responde "o que o periodo PROMETIA" -- inclui a conta ja
// paga, porque uma promessa cumprida continua tendo sido uma promessa. A
// pergunta desta secao e outra e o balde e outro: o que ainda esta EM ABERTO.
//
// O DEFEITO QUE ISTO CONSERTA, MEDIDO EM PRODUCAO
// ------------------------------------------------
// `total_pending` somava receita prevista e despesa prevista no mesmo
// acumulador positivo, porque `scheduled_transactions.amount` tem CHECK
// amount > 0 e a ocorrencia nao guardava direcao. Com uma regra de receita de
// R$ 7.000, uma de despesa de R$ 2.500 e um boleto avulso de R$ 88,50, o bloco
// "A vencer" anunciava R$ 9.588,50 quando o que ia SAIR eram R$ 2.588,50 -- e o
// badge dizia "3 contas" havendo 1 conta, 1 boleto e 1 salario. Quem cadastra o
// salario como regra recorrente, que e o uso esperado, via o numero inflar sem
// entender por que.
//
// O numero errado era PLAUSIVEL, e e por isso que ninguem o pegou por
// inspecao: R$ 9.588,50 a vencer num mes com salario de R$ 7.000 nao tem cara
// de bug, tem cara de mes cheio.
//
// POR QUE AS DUAS PERNAS, E NAO UM SALDO SO
// ------------------------------------------
// Um unico `a pagar - a receber` esconderia o mesmo erro com outro sinal: mes
// com salario maior que as contas daria "a vencer" NEGATIVO, que se le como
// "nao devo nada". Sao duas perguntas distintas -- quanto sai, quanto entra --
// e a tela mostra as duas.
//
// VENCIDO TAMBEM SE SEPARA, E ESSE E O CASO QUE MAIS DOI
// ------------------------------------------------------
// A mesma mistura vivia em `total_overdue`. E la ela e pior: o salario vira
// linha da agenda no dia do vencimento e fica `pending` ate alguem confirmar
// que recebeu (HMO-188), entao todo mes, no dia seguinte ao pagamento, o painel
// passava a acusar R$ 7.000 "em atraso". Divida que nao existe, todo mes.

/** Um lado de uma das duas perguntas: quanto, em quantas linhas. */
export interface PernaEmAberto {
  total: number;
  quantidade: number;
}

/**
 * A agenda de um periodo separada pelas duas perguntas de caixa.
 *
 * `vencidoAPagar` e `vencidoAReceber` NAO estao dentro de `aPagar`/`aReceber`:
 * uma linha esta num balde ou no outro, nunca nos dois. Somar os quatro da o
 * total em aberto do periodo sem contar nada duas vezes.
 */
export interface EmAbertoDoPeriodo {
  aPagar: PernaEmAberto;
  aReceber: PernaEmAberto;
  vencidoAPagar: PernaEmAberto;
  vencidoAReceber: PernaEmAberto;
  /** O que ja foi baixado no periodo, nas duas direcoes. Nao e "em aberto". */
  pago: number;
}

/**
 * Uma linha da agenda com os dois status que a view entrega.
 *
 * Os dois sao necessarios e nao sao intercambiaveis: `effective_status` e o
 * unico que sabe dizer 'overdue' (a view o calcula na hora, nunca e gravado), e
 * `status` e o unico que distingue 'paid' de 'skipped'/'cancelled' -- que
 * `effective_status` repassa identicos.
 */
export interface LinhaEmAberto {
  amount: number | string;
  /** O status GRAVADO. */
  status: string;
  /** O status da view, o unico que pode valer 'overdue'. */
  effective_status?: string | null;
  direcao: DirecaoPrevista;
}

const perna = (): PernaEmAberto => ({ total: 0, quantidade: 0 });

/**
 * Separa a agenda de um periodo em a pagar, a receber, e as duas vencidas.
 *
 * A ordem dos testes e a mesma da rota antes desta mudanca -- vencida primeiro,
 * depois pendente, depois paga -- de proposito: 'overdue' e um `pending` com
 * vencimento no passado, entao testar `pending` antes contaria toda linha
 * vencida como simplesmente a vencer e o bloco de atraso zeraria.
 *
 * 'skipped' e 'cancelled' nao caem em lugar nenhum: nao estao em aberto (a
 * pessoa disse que aquilo nao vai acontecer) e nao foram pagos.
 */
export function somarEmAberto(linhas: LinhaEmAberto[]): EmAbertoDoPeriodo {
  const emAberto: EmAbertoDoPeriodo = {
    aPagar: perna(),
    aReceber: perna(),
    vencidoAPagar: perna(),
    vencidoAReceber: perna(),
    pago: 0,
  };

  for (const linha of linhas) {
    // Mesmo `Math.abs` de `somarAgenda`, pela mesma razao: um valor negativo
    // escapando do CHECK do banco viraria uma despesa que DIMINUI o "a pagar".
    const valor = Math.abs(numero(linha.amount));
    const receita = linha.direcao === "income";

    if (linha.effective_status === "overdue") {
      const alvo = receita ? emAberto.vencidoAReceber : emAberto.vencidoAPagar;
      alvo.total += valor;
      alvo.quantidade += 1;
    } else if (linha.status === "pending") {
      const alvo = receita ? emAberto.aReceber : emAberto.aPagar;
      alvo.total += valor;
      alvo.quantidade += 1;
    } else if (linha.status === "paid") {
      emAberto.pago += valor;
    }
  }

  for (const chave of [
    "aPagar",
    "aReceber",
    "vencidoAPagar",
    "vencidoAReceber",
  ] as const) {
    emAberto[chave].total = centavos(emAberto[chave].total);
  }
  emAberto.pago = centavos(emAberto.pago);

  return emAberto;
}

/** Uma linha por mes, como a rota de resumo devolve. */
export interface MesPrevisto {
  expected_income: number | string;
  expected_expense: number | string;
  expected_count: number | string;
}

/**
 * Junta os meses de um periodo num previsto so.
 *
 * Mesma razao de `somarPrevistas` em lib/periodo-do-painel.ts: a rota devolve
 * uma linha por mes ja recortada pelo periodo, e PROCURAR o mes corrente na
 * lista foi o defeito da HMO-173. Aqui nao ha mes escolhido para errar.
 *
 * `resultado` e recalculado da soma em vez de somado mes a mes -- as duas
 * contas dao o mesmo numero, e recalcular e o que impede um `expected_result`
 * de mes vir inconsistente com as suas proprias parcelas e a inconsistencia
 * sobreviver a soma.
 */
export function somarMesesPrevistos(meses: MesPrevisto[]): PrevistoDoPeriodo {
  let entradas = 0;
  let despesas = 0;
  let quantidade = 0;

  for (const mes of meses) {
    entradas += numero(mes.expected_income);
    despesas += numero(mes.expected_expense);
    quantidade += numero(mes.expected_count);
  }

  return {
    entradas: centavos(entradas),
    despesas: centavos(despesas),
    resultado: centavos(entradas - despesas),
    quantidade,
  };
}

/** Uma das tres linhas da comparacao, pronta para renderizar. */
export interface LinhaDeComparacao {
  chave: "entradas" | "despesas" | "resultado";
  rotulo: string;
  previsto: number;
  realizado: number;
  /** `realizado - previsto`. Positivo = veio mais do que o previsto. */
  diferenca: number;
  /**
   * Largura da barra do previsto, 0 a 1, proporcional ao MAIOR valor absoluto
   * do par. Duas barras na mesma linha com escalas diferentes desenhariam o
   * menor numero como a barra maior.
   */
  proporcaoPrevisto: number;
  proporcaoRealizado: number;
  /**
   * `realizado > previsto` e bom nesta linha? Entrada acima do previsto e boa,
   * despesa acima do previsto nao e. Sai daqui e nao do JSX porque e a unica
   * coisa que difere entre as tres linhas, e no JSX viraria um ternario
   * conferido por inspecao visual.
   */
  maiorEMelhor: boolean;
}

export interface Comparacao {
  linhas: LinhaDeComparacao[];
  /**
   * `true` quando a agenda do periodo esta vazia. A tela nao mostra numero
   * nenhum nesse caso: "previsto R$ 0,00 x realizado R$ 4.000" se le como
   * "R$ 4.000 acima do previsto", e o que aconteceu foi que nao havia previsao.
   */
  semPrevisao: boolean;
}

/**
 * Proporcoes de um par de valores, na mesma escala.
 *
 * O divisor e o maior valor ABSOLUTO do par: na linha de resultado os dois
 * numeros podem ser negativos, e dividir por um maximo negativo devolveria
 * proporcao invertida. Par de zeros devolve duas barras vazias em vez de NaN.
 */
function proporcoes(a: number, b: number): [number, number] {
  const escala = Math.max(Math.abs(a), Math.abs(b));
  if (escala === 0) return [0, 0];
  return [Math.abs(a) / escala, Math.abs(b) / escala];
}

/**
 * As tres linhas da comparacao, na ordem em que a tela as mostra.
 *
 * Nada e recalculado a partir das parcelas do outro lado: `previsto.resultado`
 * vem de quem somou a agenda e `realizado.resultado` vem de
 * /api/reports/cash-flow (o `net` de `monthly_cash_flow`). Refazer a subtracao
 * aqui criaria uma segunda versao do resultado do mes, e no dia em que a view
 * mudasse o que considera receita o total e as parcelas passariam a discordar
 * dentro do mesmo cartao -- a mesma razao que o painel ja documenta para nao
 * recalcular o "quanto posso gastar".
 */
export function compararPrevistoRealizado(
  previsto: PrevistoDoPeriodo,
  realizado: RealizadoDoPeriodo
): Comparacao {
  const pares: {
    chave: LinhaDeComparacao["chave"];
    rotulo: string;
    previsto: number;
    realizado: number;
    maiorEMelhor: boolean;
  }[] = [
    {
      chave: "entradas",
      rotulo: "Entradas",
      previsto: previsto.entradas,
      realizado: realizado.entradas,
      maiorEMelhor: true,
    },
    {
      chave: "despesas",
      rotulo: "Despesas",
      previsto: previsto.despesas,
      realizado: realizado.despesas,
      maiorEMelhor: false,
    },
    {
      chave: "resultado",
      rotulo: "Resultado",
      previsto: previsto.resultado,
      realizado: realizado.resultado,
      maiorEMelhor: true,
    },
  ];

  return {
    semPrevisao: previsto.quantidade === 0,
    linhas: pares.map((par) => {
      const [proporcaoPrevisto, proporcaoRealizado] = proporcoes(
        par.previsto,
        par.realizado
      );

      return {
        ...par,
        diferenca: centavos(par.realizado - par.previsto),
        proporcaoPrevisto,
        proporcaoRealizado,
      };
    }),
  };
}
