// -----------------------------------------------------------------------------
// A DESPESA DE GRUPO QUE OUTRA PESSOA PAGOU (HMO-215)
// -----------------------------------------------------------------------------
// A HMO-215 pede uma lista com "todos os lancamentos, indiferente de onde foi".
// A lista de Financas Pessoais consulta `financial_transactions` com
// `user_id = eu`, e isso esta certo -- mas deixa um buraco exato:
//
//   A Ana lanca o hotel de R$ 400 na viagem. O rateio grava R$ 200 para a Ana e
//   R$ 200 para a Bia (`group_expense_splits`, 001/007).
//
//   Na lista da Ana aparece "Hotel / R$ 400,00". Na lista da Bia nao aparece
//   NADA -- a linha de `financial_transactions` e da Ana.
//
// Os R$ 200 da Bia nao sao hipotese: estao gravados, ela os deve, e o painel
// dela JA os conta como realizado desde a HMO-202 (migration 033). O que
// faltava era a LISTA -- o lugar onde a pessoa vai justamente para perguntar
// "o que foi lancado?". A Bia abria a aba e via um mes mais barato do que foi.
//
// POR QUE A FONTE E A VIEW DO 033, E NAO UMA CONTA NOVA AQUI
// ---------------------------------------------------------
// `group_share_entries` e a unica definicao de "minha parte" do lado do
// realizado, e o cabecalho do 033 e explicito sobre o motivo: recalcular
// (`ABS(total) / n_membros`) criaria a segunda implementacao de divisao do
// banco, que empata na maioria dos casos e divergi exatamente nos que doem --
// divisao que nao fecha em duas casas, rateio custom, membro que entrou depois
// da despesa. Aqui a parte e LIDA.
//
// AS TRES COISAS QUE ESTE ARQUIVO EXISTE PARA NAO ERRAR
// ----------------------------------------------------
// 1. O SINAL. A view devolve `amount` POSITIVO (esta no comentario dela: 200.00
//    para uma despesa de -400.00). A lista da tela usa a convencao do banco --
//    despesa e NEGATIVA --, e e por esse sinal que a linha e pintada de
//    vermelho e que `classificarMovimentacao` desempata linha antiga. Entregar
//    +200 para a lista mostraria a parte da Bia em VERDE, como receita.
//
// 2. A LINHA QUE EU MESMO PAGUEI NAO ENTRA. Para a Ana, a view tambem devolve a
//    parte dela (R$ 200, `paguei_eu = true`) -- e a despesa inteira dela JA esta
//    na lista, com os R$ 400. As duas juntas mostrariam o hotel duas vezes,
//    somando R$ 600 de um gasto de R$ 400. `paguei_eu` e o unico campo que
//    separa os dois casos.
//
// 3. ELAS NAO SAO LINHAS MINHAS. Nao tem `account_id` (o dinheiro saiu da conta
//    de outra pessoa), nao da para editar e nao da para excluir -- apagar a
//    parte pela minha tela mexeria na despesa de quem pagou. Por isso o tipo de
//    saida e OUTRO, e nao `FinancialTransaction`: um unico array dos dois faria
//    o botao de lixeira aparecer em cima de uma linha que ele nao pode apagar, e
//    o compilador nao teria o que reclamar.
// -----------------------------------------------------------------------------

import {
  classificarMovimentacao,
  type FiltroDeLancamento,
  type MovimentacaoBruta,
} from "@/lib/movimentacoes";

/**
 * Uma linha de `public.group_share_entries` (migration 033).
 *
 * `amount` chega POSITIVO -- ver o item 1 do cabecalho.
 */
export interface ParteDeGrupoBruta {
  /** `group_expense_splits.id`. NAO e um id de `financial_transactions`. */
  id: string;
  transaction_id: string;
  group_id: string;
  /** YYYY-MM-DD. */
  transaction_date: string;
  category_id: string | null;
  transaction_type: string | null;
  currency?: string | null;
  amount: number;
  split_status: string;
  paguei_eu: boolean;
}

/** O que a consulta de descricao devolve para cada despesa de grupo. */
export interface DespesaDeGrupoLida {
  id: string;
  description: string;
  /** O valor CHEIO da despesa, como quem pagou lancou (negativo). */
  amount: number;
  category?: { id: string; name: string; color_hex?: string | null } | null;
}

/** Uma linha da lista que nao e minha: a minha parte do que outro pagou. */
export interface LancamentoDeTerceiro {
  /**
   * `parte:<id da parte>`.
   *
   * O prefixo nao e enfeite: `key` do React e o `id` que a tela usa para
   * decidir o que fazer ao clicar precisam distinguir uma parte de uma
   * transacao. Sem ele, o dia em que alguem passar este id para
   * `/api/personal-finance/transactions/[id]` recebe um 404 -- ou, pior, acerta
   * o id de uma transacao de verdade.
   */
  id: string;
  /** O id da despesa de grupo, para a tela linkar o grupo. */
  transactionId: string;
  groupId: string;
  description: string;
  /** A MINHA parte, negativa (convencao de despesa do banco). */
  amount: number;
  /** O valor cheio da despesa, para a linha dizer de quanto e a parte. */
  totalDaDespesa: number;
  transactionDate: string;
  categoria: { id: string; name: string; color_hex?: string | null } | null;
  /** `pending` ate eu aprovar o rateio. A linha diz isso. */
  splitStatus: string;
  currency: string | null;
}

/**
 * As linhas da lista que vem de despesa de grupo paga por OUTRA pessoa.
 *
 * `despesas` e o mapa `transaction_id -> despesa`, lido de
 * `financial_transactions` numa segunda consulta. A RLS permite: a policy de
 * SELECT do 002 e `user_id = auth.uid() OR (group_id IS NOT NULL AND
 * is_group_member(group_id))` -- membro de grupo le a despesa do grupo.
 *
 * UMA PARTE SEM A DESPESA CORRESPONDENTE E DESCARTADA, e nao exibida com a
 * descricao em branco. Isso acontece se a segunda consulta falhar ou vier
 * cortada, e uma linha "R$ 200,00 · Viagem · 12/09" sem dizer DO QUE e nao
 * responde a pergunta que trouxe a pessoa para esta tela -- ela so acrescenta
 * um valor que a pessoa nao reconhece. A tela conta quantas ficaram de fora.
 */
export function partesDeTerceirosNaLista(
  partes: ParteDeGrupoBruta[],
  despesas: Map<string, DespesaDeGrupoLida>
): { linhas: LancamentoDeTerceiro[]; semDescricao: number } {
  const linhas: LancamentoDeTerceiro[] = [];
  let semDescricao = 0;

  for (const parte of partes) {
    // Item 2 do cabecalho: a minha propria despesa ja esta na lista inteira.
    if (parte.paguei_eu) continue;

    const despesa = despesas.get(parte.transaction_id);
    if (!despesa) {
      semDescricao += 1;
      continue;
    }

    linhas.push({
      id: `parte:${parte.id}`,
      transactionId: parte.transaction_id,
      groupId: parte.group_id,
      description: despesa.description,
      // Item 1 do cabecalho. `-Math.abs` e nao `-`: se algum dia a view passar a
      // devolver negativo, um `-` simples viraria a parte em RECEITA, e uma
      // despesa pintada de verde e o erro que ninguem procura.
      amount: -Math.abs(parte.amount),
      totalDaDespesa: -Math.abs(despesa.amount),
      transactionDate: parte.transaction_date,
      categoria: despesa.category ?? null,
      splitStatus: parte.split_status,
      currency: parte.currency ?? null,
    });
  }

  return { linhas, semDescricao };
}

/**
 * Quanto as partes de terceiros somam, positivo.
 *
 * ELAS NAO ENTRAM NOS TRES CARTOES DO TOPO, e este total existe para a tela
 * poder dizer isso com um numero em vez de omitir.
 *
 * O motivo de ficarem fora: o cartao "Despesas" soma as MINHAS linhas, e para
 * uma despesa de grupo que eu paguei ele soma o valor CHEIO (R$ 400 do hotel --
 * foi o que saiu da minha conta, e e o criterio que a HMO-175 fixou). Somar
 * tambem "a minha parte do que os outros pagaram" misturaria dois criterios
 * dentro de um numero so: valor cheio de um lado, parte do outro. O resultado
 * nao seria nem "o que saiu de mim" nem "o que me cabe" -- seria um terceiro
 * numero que nao responde a pergunta nenhuma, e que nada na tela denunciaria.
 *
 * A saida e a mesma que a transferencia recebeu nesta tela: a linha aparece na
 * lista, o valor aparece ESCRITO em separado, e o cartao continua significando
 * uma coisa so.
 */
export function totalDasPartesDeTerceiros(
  linhas: LancamentoDeTerceiro[]
): number {
  return linhas.reduce((soma, linha) => soma + Math.abs(linha.amount), 0);
}

/**
 * O que a lista diz sobre as partes de terceiros, ou `null` quando nao ha.
 *
 * `null` -- e nao uma frase com zero -- porque "R$ 0,00 em partes de grupo" na
 * tela de quem nao participa de grupo nenhum e ruido que parece um recurso
 * quebrado.
 */
export function notaDasPartesDeTerceiros(
  linhas: LancamentoDeTerceiro[]
): { quantas: number; total: number } | null {
  if (linhas.length === 0) return null;
  return {
    quantas: linhas.length,
    total: totalDasPartesDeTerceiros(linhas),
  };
}

// ---------------------------------------------------------------------------
// A LISTA UNICA QUE A TELA DESENHA
// ---------------------------------------------------------------------------
// Os dois tipos de linha nao viram um array so com um campo opcional, e isso e
// deliberado. Uma parte de terceiro nao pode ser editada nem excluida (ver o
// item 3 do cabecalho); num array de `FinancialTransaction` com `account_id`
// e `user_id` opcionais, os dois botoes de acao apareceriam em cima dela e o
// compilador nao teria o que reclamar -- o `onClick` chamaria a rota com um id
// de `group_expense_splits` e receberia um 404 que, para quem clicou, se le
// como "o app nao conseguiu apagar".
//
// Com a uniao discriminada, o JSX e obrigado a decidir o que desenhar para cada
// `kind`, e esquecer um ramo e erro de compilacao.

export type LinhaDaLista<T> =
  | { kind: "minha"; mov: T }
  | { kind: "parte"; parte: LancamentoDeTerceiro };

/**
 * A data de uma linha, para a ordenacao da lista inteira.
 *
 * As duas fontes vem ordenadas por data decrescente, cada uma por si. Coladas
 * sem reordenar, a lista mostraria todas as minhas linhas e DEPOIS todas as
 * partes de grupo -- as de setembro no fim, abaixo das minhas de marco. A
 * pessoa concluiria que as partes sao de outro periodo.
 */
function dataDaLinha<T extends { transaction_date?: string }>(
  linha: LinhaDaLista<T>
): string {
  return linha.kind === "minha"
    ? linha.mov.transaction_date ?? ""
    : linha.parte.transactionDate;
}

/**
 * As linhas que o filtro escolhido deixa passar, das duas fontes, em ordem de
 * data decrescente.
 *
 * A PARTE DE GRUPO SO APARECE EM "Lançamentos" E EM "Despesas". A view do 033
 * filtra `transaction_type = 'expense'` na origem -- nao existe parte de
 * receita nem de transferencia --, entao classificar aqui seria afirmar sobre
 * um caso que o banco nao produz. O filtro e por igualdade com `"expense"` em
 * vez de "nao e income nem transfer" para que, no dia em que a view afrouxar
 * aquele WHERE, a linha nova apareca na aba errada e NAO em silencio na aba
 * "Receitas".
 *
 * `sort` do JavaScript e estavel (garantido pela especificacao desde a ES2019),
 * e e disso que depende o desempate: entre duas linhas do mesmo dia, as minhas
 * mantem a ordem de tres chaves que a consulta pediu
 * (`transaction_date, created_at, id`) e as partes ficam depois delas.
 */
export function linhasDaLista<T extends MovimentacaoBruta & { transaction_date?: string }>(
  minhas: T[],
  partes: LancamentoDeTerceiro[],
  filtro: FiltroDeLancamento
): LinhaDaLista<T>[] {
  const linhas: LinhaDaLista<T>[] = [];

  for (const mov of minhas) {
    if (filtro === "todos" || classificarMovimentacao(mov) === filtro) {
      linhas.push({ kind: "minha", mov });
    }
  }

  if (filtro === "todos" || filtro === "expense") {
    for (const parte of partes) {
      linhas.push({ kind: "parte", parte });
    }
  }

  return linhas.sort((a, b) => dataDaLinha(b).localeCompare(dataDaLinha(a)));
}

/**
 * Quantas linhas cada aba mostraria, somando as duas fontes.
 *
 * A contagem da barra TEM que casar com a lista -- e a contagem que responde
 * "cadê a minha parte do jantar?" sem exigir um clique. `contarPorFiltro` de
 * lib/movimentacoes.ts conta so as minhas linhas; usar aquela aqui deixaria a
 * aba "Despesas" dizendo 4 e mostrando 6.
 */
export function contarComPartes(
  minhas: MovimentacaoBruta[],
  partes: LancamentoDeTerceiro[]
): Record<FiltroDeLancamento, number> {
  const contagem: Record<FiltroDeLancamento, number> = {
    todos: minhas.length + partes.length,
    income: 0,
    expense: partes.length,
    transfer: 0,
  };

  for (const mov of minhas) {
    contagem[classificarMovimentacao(mov)] += 1;
  }

  return contagem;
}
