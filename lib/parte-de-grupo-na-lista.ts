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
  resumoDoPeriodo,
  type FiltroDeLancamento,
  type MovimentacaoBruta,
  type ResumoDoPeriodo,
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
 * ELAS ENTRAM NO CARTAO "Despesas" (HMO-275). Este total e a parcela delas
 * dentro daquele numero -- ver `resumoComPartesDeGrupo` logo abaixo, que e
 * quem soma, e o cabecalho dele, que e onde o criterio esta escrito.
 *
 * Ate a HMO-275 este total existia para a tela poder dizer que as partes
 * ficavam de FORA dos tres cartoes, e o motivo alegado era que "Despesas"
 * somava o valor CHEIO de uma despesa de grupo que eu paguei (R$ 400 do hotel)
 * e somar a parte dos outros misturaria dois criterios num numero so. A decisao
 * do Helio de 04/10/2026 responde a isso com um criterio UNICO, que o argumento
 * antigo nao tinha enxergado: o cartao significa **o que me custou** -- inteiro
 * quando eu paguei, minha parte quando outro pagou. Os dois casos passam a ser
 * a mesma pergunta, e nao duas.
 */
export function totalDasPartesDeTerceiros(
  linhas: LancamentoDeTerceiro[]
): number {
  return linhas.reduce((soma, linha) => soma + Math.abs(linha.amount), 0);
}

/**
 * O que a tela diz sobre as partes de terceiros, ou `null` quando nao ha.
 *
 * Desde a HMO-275 a frase nao e mais um aviso de valor omitido: ela ABRE o
 * cartao "Despesas", dizendo quanto daquele total e parte de despesa que outra
 * pessoa pagou. Sem ela, a soma do cartao deixaria de bater com a soma das
 * linhas que a pessoa consegue apontar como suas -- e o unico jeito de
 * descobrir a diferenca seria somar a lista a mao.
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
// OS TRES CARTOES, COM A PARTE DE GRUPO DENTRO (HMO-275)
// ---------------------------------------------------------------------------
// A decisao do Helio em 04/10/2026: **bruto + reembolso**. O cartao "Despesas"
// significa *o que me custou* -- INTEIRO quando eu paguei, MINHA PARTE quando
// outro pagou. Os R$ 159,90 da internet no C6 continuam inteiros no mes dele; os
// R$ 53,30 da Ana passam a contar no mes dela, onde antes ficavam escritos
// embaixo do cartao de saldo com a frase "na lista e fora do saldo".
//
// AS QUATRO COISAS QUE ESTA FUNCAO EXISTE PARA NAO ERRAR
// ------------------------------------------------------
// 1. O SALDO E RECALCULADO, NAO HERDADO. `resumoDoPeriodo` devolve
//    `saldo = receitas - despesas` das MINHAS linhas. Somar a parte em
//    `despesas` e repassar aquele `saldo` deixaria os tres cartoes se
//    contradizendo na mesma tela: "Receitas 5.000", "Despesas 1.053,30",
//    "Saldo 4.000" -- e a legenda do terceiro cartao diz, por escrito,
//    "Receitas - Despesas". O erro e visivel a olho nu e ainda assim e o mais
//    facil de cometer, porque a mudanca de uma linha (`despesas: ... + total`)
//    nao obriga a mexer no `saldo`. Aqui nao ha o que repassar: o `saldo` sai
//    da subtracao dos dois numeros desta funcao.
//
// 2. RECEITAS NAO SE MEXE. O outro lado do "bruto + reembolso" -- o que os
//    outros me devem -- e a F10, e la ele entra como A RECEBER, previsto, com
//    rotulo. Nao e receita realizada: a Ana pode nao pagar. Se esta funcao
//    tocasse `receitas`, o saldo do mes voltaria a fechar certo com os dois
//    lados inchados, que e exatamente a armadilha numero 1 deste bloco
//    (`duas-pernas-mantem-o-total-certo`). Por isso ela devolve `receitas`
//    inalterado -- e o teste afirma sobre os dois numeros EM SEPARADO.
//
// 3. SO A PARTE DO QUE OUTRO PAGOU CHEGA AQUI. `partesDeTerceirosNaLista` ja
//    descartou `paguei_eu` (item 2 do cabecalho do arquivo). Somar a lista
//    crua da view do 033 contaria o hotel da Ana duas vezes: R$ 400 da linha
//    inteira dela mais R$ 200 da parte dela, R$ 600 de um gasto de R$ 400. O
//    tipo do parametro e `LancamentoDeTerceiro[]`, e nao `ParteDeGrupoBruta[]`,
//    para que esse caminho nao compile.
//
// 4. `transferido` E `transferencias` PASSAM INTEIROS. Uma parte de grupo nao e
//    transferencia entre as minhas contas; a view do 033 filtra
//    `transaction_type = 'expense'` na origem. Mexer neles aqui mudaria a outra
//    frase do cartao de saldo, que fala de um assunto que nada tem a ver.

/**
 * Os tres cartoes do topo da tela, com a minha parte do que outros pagaram
 * somada em "Despesas".
 *
 * `minhas` sao as linhas de `financial_transactions`; `partes` e a saida de
 * `partesDeTerceirosNaLista`. A funcao recebe as duas fontes -- em vez de um
 * `ResumoDoPeriodo` ja somado mais o total das partes -- justamente para que o
 * `saldo` nao possa chegar pronto de fora: ver o item 1 do cabecalho acima.
 *
 * `partes` vazio devolve exatamente o que `resumoDoPeriodo` devolveria, e isso
 * e o controle de que a soma nova nao vaza para quem nao tem grupo.
 */
export function resumoComPartesDeGrupo(
  minhas: MovimentacaoBruta[],
  partes: LancamentoDeTerceiro[]
): ResumoDoPeriodo {
  const meu = resumoDoPeriodo(minhas);
  const despesas = meu.despesas + totalDasPartesDeTerceiros(partes);

  return {
    receitas: meu.receitas,
    despesas,
    // Item 1: recalculado, e nao `meu.saldo`.
    saldo: meu.receitas - despesas,
    transferido: meu.transferido,
    transferencias: meu.transferencias,
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
