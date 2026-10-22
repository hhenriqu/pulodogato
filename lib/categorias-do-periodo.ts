/**
 * Gasto por categoria num periodo QUALQUER (HMO-201, parte 3).
 *
 * O pedido: o painel do grupo precisa dar "os totais de gastos e separado por
 * categoria, alem de ter [...] a possibilidade de escolher o periodo de datas".
 *
 * O BURACO QUE ISTO FECHA
 * -----------------------
 * `/api/reports/categories` so sabia responder `?months=N`: uma janela de N
 * meses terminando no mes corrente. "De 15/09 a 20/10" nao tem como ser
 * perguntado, e "o mes passado inteiro" tambem nao -- `months=1` e sempre o
 * mes de hoje.
 *
 * `/api/reports/cash-flow` ja resolveu esse problema (HMO-173) e a solucao de
 * la vale aqui inteira: quando o periodo e uma uniao de meses INTEIROS, a
 * resposta sai das views do 008, porque ela TEM que sair -- senao o painel e o
 * relatorio dariam numeros diferentes para o mesmo mes. Quando nao e, nenhum
 * rollup mensal responde e a soma passa a ser feita sobre
 * `financial_transactions` recortada por data.
 *
 * Este modulo e a segunda metade: transformar transacoes cruas em linhas com o
 * mesmo formato que `category_monthly_totals` produz, para que o resto da rota
 * -- o agrupamento por moeda, as fatias da pizza, a ordenacao -- continue
 * sendo UM caminho so, e nao dois que precisam concordar.
 *
 * A REGRA DO SINAL NAO PODE SER REESCRITA AQUI
 * --------------------------------------------
 * `category_monthly_totals` separa entrada de saida por `transaction_type` e
 * deixa `transfer` de FORA, inclusive da contagem. Quem refaz isso no
 * JavaScript sem repetir o filtro produz um relatorio em que as duas pernas de
 * uma transferencia -- e as duas de um pagamento de fatura -- aparecem como
 * receita e despesa de verdade. O total continua certo (elas se anulam), mas
 * "quanto entrou" e "quanto saiu" inflam os dois juntos, e a categoria de
 * transferencia vira a maior fatia da pizza.
 *
 * E por isso que a conversao mora aqui, e nao dentro da rota: e a mesma regra
 * de `agregarTransacoes` em lib/periodo-do-painel.ts, e ela precisa ser
 * conferivel sem banco.
 */

import { apenasNosTotais, type LinhaComTotais } from "@/lib/fora-dos-totais";

/** Uma transacao crua, como ela vem de `financial_transactions`. */
export interface TransacaoDeCategoria extends LinhaComTotais {
  category_id: string | null;
  amount: number | string;
  transaction_type: string | null;
  currency?: string | null;
}

/**
 * Uma linha no formato de `category_monthly_totals` -- sem o `month`, que nao
 * existe num periodo que corta meses pela metade.
 */
export interface LinhaDeCategoria {
  category_id: string;
  expense: number;
  income: number;
  transaction_count: number;
  currency: string | null;
}

/**
 * Categoria para a qual cai o lancamento sem `category_id`.
 *
 * HOJE ISTO NAO ACONTECE: `financial_transactions.category_id` e NOT NULL
 * (001_baseline, conferido no banco). Nao e um defeito sendo corrigido, e uma
 * escolha sobre o que fazer se a coluna afrouxar -- e a escolha e nao DESCARTAR
 * a linha, porque descartar faria o total por categoria ficar menor que o
 * total do fluxo de caixa do mesmo periodo, sem que o usuario tivesse como
 * saber em qual dos dois acreditar. Aparecendo como "Sem categoria", o
 * dinheiro continua na tela e a pizza continua fechando em 100%.
 */
export const CATEGORIA_AUSENTE = "sem-categoria";

/**
 * Agrega transacoes cruas em linhas por (categoria, moeda).
 *
 * A moeda entra na CHAVE, e nao so no valor: e o que impede a mesma categoria
 * com gasto em real e em dolar de virar uma linha so com `1000 + 180 = 1180`
 * -- um numero que nao esta em moeda nenhuma, com cara de total e para mais.
 * Foi exatamente esse defeito que a migration 022 foi a producao corrigir nas
 * views, e ele volta por esta porta se a chave for so a categoria.
 *
 * O LANCAMENTO FORA DOS TOTAIS SAI DAQUI TAMBEM, E PRECISA SAIR (HMO-453)
 * ----------------------------------------------------------------------
 * Esta funcao e o GEMEO EM JAVASCRIPT de `category_monthly_totals`, e aquela
 * view ganhou `AND t.include_in_total` na 060. As duas respondem a MESMA
 * pergunta por caminhos diferentes -- a view no ramo de MES inteiro, esta
 * funcao no ramo de INTERVALO livre -- e consertar so uma faz "setembro
 * inteiro" e "01/09 a 30/09" darem numeros diferentes. Esse defeito e pior que
 * o original: as duas leituras discordam sem que exista um terceiro total para
 * arbitrar (`duas-leituras-do-previsto-discordam-por-construcao`).
 *
 * `apenasNosTotais` vem ANTES do laco e nao dentro dele, no mesmo lugar em que
 * a view poe o filtro: no `WHERE`, e nao em cada `FILTER (WHERE ...)`. Isso faz
 * a linha desmarcada sair TAMBEM do `transaction_count`, exatamente como la --
 * uma categoria que diz "3 lancamentos" ao lado de um total de dois e a
 * contradicao visivel que nao se explica, e e o `COUNT(*) FILTER` da 060 que ja
 * decidiu isso do lado do banco. As duas contagens nao podem discordar: elas
 * alimentam a mesma pizza.
 *
 * A linha de `partesComoTransacoes` (lib/parte-do-grupo-realizada.ts) atravessa
 * intacta: ela vem de `group_share_entries`, nao tem a coluna, e
 * `undefined !== false` e `true`. E a resposta certa pela decisao D -- o que eu
 * devo nao muda porque quem lancou escondeu a linha do relatorio dele.
 */
export function linhasDeCategoria(
  transacoes: readonly TransacaoDeCategoria[],
  moedaPadrao = "BRL"
): LinhaDeCategoria[] {
  const acumulado = new Map<string, LinhaDeCategoria>();

  for (const t of apenasNosTotais(transacoes)) {
    // `transfer` -- e qualquer tipo que o app venha a ganhar -- fica fora da
    // conta E fora da contagem, igual ao `COUNT(*) FILTER` da view.
    if (t.transaction_type !== "income" && t.transaction_type !== "expense") {
      continue;
    }

    const categoria = t.category_id ?? CATEGORIA_AUSENTE;
    const moeda = t.currency ?? moedaPadrao;
    const chave = `${categoria}\u0000${moeda}`;

    const linha =
      acumulado.get(chave) ??
      ({
        category_id: categoria,
        expense: 0,
        income: 0,
        transaction_count: 0,
        currency: moeda,
      } as LinhaDeCategoria);

    // `Math.abs`: a despesa e gravada NEGATIVA neste banco, e a view usa
    // ABS(). Somar cru aqui devolveria a despesa com sinal trocado e a pizza
    // desenharia fatias negativas.
    const valor = Math.abs(Number(t.amount));

    if (t.transaction_type === "income") linha.income += valor;
    else linha.expense += valor;

    linha.transaction_count += 1;
    acumulado.set(chave, linha);
  }

  return Array.from(acumulado.values()).map((l) => ({
    ...l,
    expense: Number(l.expense.toFixed(2)),
    income: Number(l.income.toFixed(2)),
  }));
}
