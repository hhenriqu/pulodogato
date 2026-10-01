/**
 * A minha parte das despesas de grupo no REALIZADO (HMO-202).
 *
 * Contraparte de `lib/parte-do-grupo.ts`, que faz o mesmo no PREVISTO desde a
 * HMO-177. A diferenca entre os dois arquivos e de onde vem a parte:
 *
 *   previsto  -> nao existe rateio gravado para uma conta que ainda nao foi
 *                paga, entao `parteDoMembro` DIVIDE pelo numero de membros
 *                ativos;
 *   realizado -> o rateio EXISTE (`group_expense_splits`, criado por trigger no
 *                insert da despesa), e dividir de novo aqui criaria a segunda
 *                implementacao de divisao do projeto. Entao este arquivo nao
 *                calcula nada: a parte vem lida da view `group_share_entries`
 *                (migration 033).
 *
 * O QUE SOBRA PARA O JAVASCRIPT, E POR QUE SO ISSO
 * ------------------------------------------------
 * No modo MES as rotas leem `personal_monthly_cash_flow` e
 * `personal_category_monthly_totals` (033), que ja somam os dois lados no banco
 * -- nada deste arquivo e usado la.
 *
 * O modo INTERVALO ("de 15/09 a 20/10") nao tem rollup mensal que responda e
 * soma as linhas cruas no JavaScript. E so para esse caminho que este modulo
 * existe: converter a linha da view no mesmo formato que `financial_transactions`
 * tem, para que a soma continue sendo feita por `agregarTransacoes` e
 * `linhasDeCategoria` -- as funcoes que ja sabem que despesa e gravada negativa
 * e que `transfer` fica fora da conta.
 *
 * A CONVERSAO E UM `map`, E AINDA ASSIM MORA NUMA FUNCAO
 * -----------------------------------------------------
 * Porque o jeito errado de escrever esse `map` nao da erro. `amount` sai
 * POSITIVO da view (a parte de uma despesa de -400 e 200,00), e os dois
 * agregadores aplicam `Math.abs` -- entao inverter o sinal aqui passaria
 * despercebido nos dois. O que NAO passa despercebido e `transaction_type`: se
 * ele vier vazio, os agregadores descartam a linha em silencio (e o `continue`
 * do ramo de `transfer`) e o realizado de grupo volta a ser zero, que e
 * exatamente o defeito que a 033 consertou.
 *
 * Por isso a conversao fica conferivel sem banco, e por isso ela repassa
 * `transaction_type` da view em vez de escrever o literal `"expense"`: a view
 * ja filtra `transaction_type = 'expense'`, e repetir a afirmacao aqui criaria
 * um lugar a mais para ela ficar desatualizada.
 */

/**
 * Uma linha de `group_share_entries` (033), como ela chega do PostgREST.
 *
 * `amount` e `number | string` pela mesma razao de sempre: `numeric(15,2)` nao
 * cabe em double sem perda, entao o driver nao converte.
 */
export interface ParteDeGrupoCrua {
  amount: number | string;
  transaction_type: string | null;
  currency?: string | null;
  category_id?: string | null;
}

/** O formato que `agregarTransacoes` e `linhasDeCategoria` consomem. */
export interface ParteComoTransacao {
  amount: number | string;
  transaction_type: string | null;
  currency: string | null;
  category_id: string | null;
}

/**
 * As colunas que as rotas pedem de `group_share_entries`.
 *
 * Numa constante so para as duas rotas nao divergirem: `/api/reports/cash-flow`
 * nao precisa de `category_id` e `/api/reports/categories` precisa, e a
 * tentacao e cada uma pedir o seu. O custo de trazer uma coluna a mais e nulo
 * perto do de descobrir, meses depois, que os dois relatorios leem conjuntos
 * diferentes de linhas.
 */
export const COLUNAS_DA_PARTE_DE_GRUPO =
  "id, amount, transaction_type, currency, category_id";

/**
 * Converte as partes lidas da view em linhas somaveis pelos agregadores.
 *
 * Nao filtra nada: o recorte (usuario, intervalo de datas, status do rateio,
 * tipo da transacao) e todo do banco. Uma linha que chegou aqui JA passou por
 * ele, e re-filtrar no cliente so criaria um segundo criterio para discordar do
 * primeiro.
 */
export function partesComoTransacoes(
  partes: readonly ParteDeGrupoCrua[]
): ParteComoTransacao[] {
  return partes.map((parte) => ({
    amount: parte.amount,
    transaction_type: parte.transaction_type,
    currency: parte.currency ?? null,
    category_id: parte.category_id ?? null,
  }));
}
