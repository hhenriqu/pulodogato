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
