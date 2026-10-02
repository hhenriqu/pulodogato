// ---------------------------------------------------------------------------
// TRES MOVIMENTACOES, TRES CONTABILIZACOES (HMO-162)
// ---------------------------------------------------------------------------
// Receita, despesa e transferencia sao coisas diferentes e entram na conta de
// formas diferentes. Este arquivo e o unico lugar que decide qual e qual, para
// que as telas separadas de lancamento nao cheguem a tres respostas distintas
// para a mesma pergunta.
//
// O que estava errado: a tela de lancamentos somava por SINAL do valor --
// `amount > 0` era receita, `amount < 0` era despesa. Transferencia nao existia
// nessa conta, e ela e gravada em DUAS pernas (migration 015): `-total` na conta
// que paga e `+total` na conta que recebe. Entao pagar uma fatura de R$ 1.000
// somava R$ 1.000 em "Receitas" E R$ 1.000 em "Despesas".
//
// O detalhe que fez isso durar: o SALDO continuava certo. As duas pernas se
// anulam, entao `receitas - despesas` nao mudava -- o numero grande da tela
// estava correto enquanto as duas parcelas dele estavam infladas. Nao havia erro
// para ninguem procurar, so um mes que parecia mais movimentado do que foi.
//
// Transferencia entre contas proprias nao cria nem destroi dinheiro: ela nao e
// receita nem despesa. Sai das duas somas e e contada em separado.
// ---------------------------------------------------------------------------

/** Os tres tipos que o ENUM `transaction_financial_type` admite no banco. */
export type TipoMovimentacao = "income" | "expense" | "transfer";

/**
 * O que a classificacao precisa de uma linha de `financial_transactions`.
 *
 * `transaction_type` e opcional porque ha linhas gravadas antes da coluna ser
 * preenchida em todo caminho de escrita -- ver `classificarMovimentacao`.
 */
export interface MovimentacaoBruta {
  amount: number;
  transaction_type?: string | null;
  category?: { is_expense?: boolean } | null;
}

export interface ResumoDoPeriodo {
  /** Soma das receitas, positiva. */
  receitas: number;
  /** Soma das despesas, positiva (as linhas estao gravadas negativas). */
  despesas: number;
  /** `receitas - despesas`. Transferencia nao entra. */
  saldo: number;
  /** Quanto andou entre contas proprias, positivo. Nao entra no saldo. */
  transferido: number;
  /** Quantas pernas de transferencia o periodo tem. */
  transferencias: number;
}

/**
 * De que tipo e esta linha.
 *
 * A coluna `transaction_type` manda quando ela existe: e a unica fonte que
 * distingue uma transferencia de uma despesa, porque a perna de saida de uma
 * transferencia tem exatamente a mesma cara de uma despesa (valor negativo, e
 * ate categoria de despesa -- o seletor da tela antiga forcava isso).
 *
 * Sem a coluna, sobra o palpite por sinal, que e o que a tela fazia com TODAS as
 * linhas. Ele acerta receita e despesa e nunca acha uma transferencia; para
 * linhas antigas isso e o melhor disponivel, e e melhor que descartar a linha.
 */
export function classificarMovimentacao(
  mov: MovimentacaoBruta
): TipoMovimentacao {
  const declarado = mov.transaction_type;

  if (
    declarado === "income" ||
    declarado === "expense" ||
    declarado === "transfer"
  ) {
    return declarado;
  }

  // Linha antiga, sem tipo declarado. A categoria sabe mais que o sinal: um
  // estorno de despesa chega positivo e continua sendo da categoria de despesa.
  if (mov.category?.is_expense === true) return "expense";
  if (mov.category?.is_expense === false) return "income";

  return mov.amount < 0 ? "expense" : "income";
}

/**
 * Soma um periodo separando os tres tipos.
 *
 * Usa `Math.abs` nos dois lados de proposito: as duas somas sao grandezas para
 * exibir, e a tela ja pinta receita de verde e despesa de vermelho. Sem o abs,
 * uma despesa gravada com sinal trocado DIMINUIRIA o total de despesas em vez
 * de aparecer -- o erro se esconderia dentro do proprio numero que deveria
 * denuncia-lo.
 */
export function resumoDoPeriodo(
  movimentacoes: MovimentacaoBruta[]
): ResumoDoPeriodo {
  let receitas = 0;
  let despesas = 0;
  let transferido = 0;
  let transferencias = 0;

  for (const mov of movimentacoes) {
    const valor = Math.abs(mov.amount);

    switch (classificarMovimentacao(mov)) {
      case "income":
        receitas += valor;
        break;
      case "expense":
        despesas += valor;
        break;
      case "transfer":
        // As duas pernas somam o dobro do que andou. Contamos so a perna de
        // saida para que "transferido" seja o valor que a pessoa moveu, e nao
        // duas vezes ele.
        transferencias += 1;
        if (mov.amount < 0) transferido += valor;
        break;
    }
  }

  return {
    receitas,
    despesas,
    saldo: receitas - despesas,
    transferido,
    transferencias,
  };
}

// ---------------------------------------------------------------------------
// O QUE GRAVAR: TIPO E SINAL (HMO-181)
// ---------------------------------------------------------------------------
// `classificarMovimentacao` acima LE uma linha que ja existe. Esta secao e o
// contrario: decide o que escrever, e por isso ela nao pode ter a tolerancia da
// leitura. A leitura adivinha porque nao tem escolha -- a linha antiga ja esta
// gravada sem tipo. Na escrita, adivinhar e o que CRIA a linha sem tipo.
//
// Tres coisas estavam erradas no POST de /api/personal-finance/transactions, e
// as tres saiam da mesma linha (`category?.is_expense && amount > 0`):
//
//   1. A coluna `transaction_type` nunca era gravada. As views da 008
//      (`monthly_cash_flow`, `category_monthly_totals`, `planned_vs_actual`)
//      filtram `transaction_type IN ('expense','income')`, entao a linha ficava
//      FORA do fluxo de caixa, dos relatorios e do orcamento -- mas DENTRO da
//      lista de lancamentos, que classifica por palpite. O lancamento existia e
//      nao existia ao mesmo tempo, sem erro em lugar nenhum.
//
//   2. O sinal recebido decidia o tipo, quando e o tipo que decide o sinal.
//      Mandar `-12.34` -- o sinal CERTO pela convencao do banco -- fazia
//      `amount > 0` dar falso, e o outro ramo gravava `+12.34`. A rota so
//      funcionava para quem mandava o valor com o sinal errado.
//
//   3. O vinculo com o grupo (`group_transactions`) dependia daquele mesmo
//      booleano, entao uma despesa de grupo mandada com sinal negativo nascia
//      com `group_id` preenchido e sem rateio nenhum.
//
// A tela disfarcava os tres: `classificarMovimentacao` cai em
// `category.is_expense` e acerta o rotulo, e `resumoDoPeriodo` usa `Math.abs`.
// Quem nao disfarca e o banco.
// ---------------------------------------------------------------------------

/** O que o corpo do POST traz de relevante para tipo e sinal. */
export interface LancamentoRecebido {
  /** Como veio do cliente: qualquer sinal. */
  amount: number;
  /** Opcional. Quando vem, manda -- e quando vem errado, e erro, nao palpite. */
  transaction_type?: unknown;
  /** `transaction_categories.is_expense` da categoria escolhida. */
  categoriaEhDespesa?: boolean | null;
}

export type LancamentoNormalizado =
  | {
      ok: true;
      /** Sempre preenchido: nunca mais uma linha sem tipo. */
      tipo: "income" | "expense";
      /** Ja na convencao do banco: despesa negativa, receita positiva. */
      amount: number;
    }
  | { ok: false; erro: string };

/**
 * Tipo e valor prontos para o INSERT, ou o motivo de recusar.
 *
 * A ordem de precedencia e a mesma de `classificarMovimentacao` -- declarado,
 * depois categoria, depois sinal -- de proposito: se a escrita decidisse de um
 * jeito e a leitura de outro, a linha sairia da tela com um rotulo e entraria
 * nas views com o outro. O sinal fica em ultimo porque e o palpite mais fraco
 * (um estorno chega positivo e continua sendo da categoria de despesa), mas
 * continua existindo: categoria nova, sem `is_expense`, ainda precisa gravar
 * algum tipo.
 *
 * Duas recusas explicitas, as duas por 400:
 *
 *   * tipo declarado fora do ENUM. Ignorar em silencio e exatamente o defeito
 *     que esta funcao existe para fechar: o cliente diz uma coisa, o banco
 *     grava outra, e ninguem fica sabendo.
 *
 *   * `transfer`. Transferencia e gravada em DUAS pernas que se anulam
 *     (migration 015, e /api/movimentacoes/transferencia e quem faz isso). Esta
 *     rota cria UMA linha. Aceitar aqui produziria meia transferencia: dinheiro
 *     saindo de uma conta sem entrar em nenhuma, com o saldo geral errado e sem
 *     perna irma para o elo `counterpart_transaction_id` apontar.
 */
export function normalizarLancamento(
  recebido: LancamentoRecebido
): LancamentoNormalizado {
  const declarado = recebido.transaction_type;

  if (declarado !== undefined && declarado !== null && declarado !== "") {
    if (declarado === "transfer") {
      return {
        ok: false,
        erro: "Transferência tem duas pernas: use /api/movimentacoes/transferencia",
      };
    }
    if (declarado !== "income" && declarado !== "expense") {
      return {
        ok: false,
        erro: `transaction_type inválido: ${String(declarado)} (esperado "income" ou "expense")`,
      };
    }
  }

  const tipo = classificarMovimentacao({
    amount: recebido.amount,
    transaction_type: typeof declarado === "string" ? declarado : null,
    category:
      typeof recebido.categoriaEhDespesa === "boolean"
        ? { is_expense: recebido.categoriaEhDespesa }
        : null,
  });

  // `classificarMovimentacao` pode devolver "transfer" so quando o declarado e
  // "transfer", e esse caminho ja saiu com 400 la em cima. O estreitamento aqui
  // e para o compilador, nao para o runtime.
  if (tipo === "transfer") {
    return { ok: false, erro: "Transferência não é criada por esta rota" };
  }

  const absoluto = Math.abs(recebido.amount);

  return {
    ok: true,
    tipo,
    amount: tipo === "income" ? absoluto : -absoluto,
  };
}

// ---------------------------------------------------------------------------
// O FILTRO DA LISTA DE LANCAMENTOS (HMO-162)
// ---------------------------------------------------------------------------
// A lista sempre trouxe os tres tipos -- a consulta nunca filtrou por tipo --
// mas eles chegavam misturados e sem rotulo nenhum que dissesse qual era qual.
// Uma perna de transferencia, na lista, tem exatamente a mesma cara de uma
// despesa: valor negativo, pintado de vermelho. Quem procurava "onde foram
// parar meus R$ 1.000" nao tinha como ver que aquela linha nao era um gasto.
//
// O filtro vive aqui, e nao dentro do componente, pelo mesmo motivo que
// `resumoDoPeriodo` vive aqui: ele TEM que concordar com a soma dos cartoes de
// cima. Se a tela filtrasse por `amount < 0` e o resumo classificasse por
// `transaction_type`, a aba "Despesas" mostraria linhas que o card "Despesas"
// nao contou -- dois numeros certos pela propria regra, discordando na mesma
// tela. Por isso os dois passam por `classificarMovimentacao`.
// ---------------------------------------------------------------------------

/** O que a barra de filtros da lista oferece. `todos` nao esconde nada. */
export type FiltroDeLancamento = "todos" | TipoMovimentacao;

/**
 * Os filtros na ordem em que aparecem, com o rotulo que o usuario le.
 *
 * Existe como dado, e nao como quatro botoes escritos na mao no JSX, porque a
 * lista e o contador tem que percorrer exatamente o mesmo conjunto: um quinto
 * filtro escrito so no JSX apareceria sem nunca receber contagem.
 */
export const FILTROS_DE_LANCAMENTO: {
  id: FiltroDeLancamento;
  rotulo: string;
}[] = [
  { id: "todos", rotulo: "Lançamentos" },
  { id: "income", rotulo: "Receitas" },
  { id: "expense", rotulo: "Despesas" },
  { id: "transfer", rotulo: "Transferências" },
];

/**
 * As linhas que o filtro escolhido deixa passar.
 *
 * O generico preserva o tipo da linha: a tela precisa do registro inteiro
 * (descricao, categoria, splits) e nao so do que `MovimentacaoBruta` declara.
 */
export function filtrarLancamentos<T extends MovimentacaoBruta>(
  movimentacoes: T[],
  filtro: FiltroDeLancamento
): T[] {
  if (filtro === "todos") return movimentacoes;
  return movimentacoes.filter((m) => classificarMovimentacao(m) === filtro);
}

/**
 * Quantas linhas cada filtro mostraria.
 *
 * E o que faz a resposta de "cade minhas transferencias?" caber na propria
 * barra: um zero em "Transferências" e diferente de uma aba que abre vazia sem
 * explicar se nao ha linha ou se a tela quebrou.
 *
 * `todos` conta o total, e nao a soma dos outros tres, porque sao a mesma
 * coisa por construcao -- `classificarMovimentacao` sempre devolve um dos tres
 * e nunca descarta uma linha. Somar os tres aqui esconderia uma eventual
 * quarta classificacao em vez de deixa-la aparecer como diferenca.
 */
export function contarPorFiltro(
  movimentacoes: MovimentacaoBruta[]
): Record<FiltroDeLancamento, number> {
  const contagem: Record<FiltroDeLancamento, number> = {
    todos: movimentacoes.length,
    income: 0,
    expense: 0,
    transfer: 0,
  };

  for (const mov of movimentacoes) {
    contagem[classificarMovimentacao(mov)] += 1;
  }

  return contagem;
}
