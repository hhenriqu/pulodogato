/**
 * O FECHAMENTO DO GRUPO NO RESULTADO DO MES (RN016 a RN018, fase 4).
 *
 * No grupo com dia de fechamento, a parte de cada despesa deixa de contar no
 * Resultado de quem nao a pagou (RN018.9). O que entra no lugar dela sao duas
 * coisas, e este modulo traduz as duas para o formato das leituras que ja
 * existem:
 *
 *   * a CONTA DO FECHAMENTO ("Pagamento ao grupo", "A receber do grupo"). Em
 *     aberto ela e uma conta prevista comum e toda leitura de previsto ja a
 *     soma. Quitada, ela vem de `group_closing_entries` (069) e entra no
 *     realizado -- `contasDoFechamentoComoRealizadas` a poe no formato de
 *     `financial_transactions` que as telas de Receitas e Despesas consomem;
 *   * a ESTIMATIVA do periodo aberto (RN018.7, decisao D2): o que o membro
 *     pagaria ou receberia se o periodo fechasse hoje. Ela e previsao e nao
 *     gera conta. `estimativaDoMembro` le a posicao dele na mesma conta que o
 *     cron grava (`fecharPeriodo`), e `estimativasComoPrevistas` a poe no
 *     formato das linhas previstas.
 *
 * E a conta prevista DO GRUPO que fecha (o aluguel que um membro lanca para
 * todos) fica so com quem a lancou, pelo valor cheio; para os outros ela entra
 * na estimativa do fechamento (`previstasNoGrupoQueFecha`).
 *
 * Funcoes puras, sem I/O. Quem le o banco e
 * lib/services/fechamento-no-resultado.ts e as rotas.
 */

import type { FechamentoDoPeriodo } from "@/lib/fechamento-por-periodo";
import type { LinhaDaLista } from "@/lib/parte-de-grupo-na-lista";
import type { AbatimentoDoGrupo, ItemDoGrupoNaLista } from "@/lib/despesas-do-grupo";

/** A view da conta do fechamento ja quitada (069). */
export const VIEW_DA_CONTA_DO_FECHAMENTO = "group_closing_entries";

/**
 * As colunas que as rotas pedem da view. As quatro primeiras sao as de
 * `COLUNAS_DA_PARTE_DE_GRUPO` (lib/parte-do-grupo-realizada.ts), e e isso que
 * deixa o modo intervalo dos relatorios somar a conta pela mesma
 * `partesComoTransacoes`: `amount` POSITIVO e o sinal em `transaction_type`.
 */
export const COLUNAS_DA_CONTA_DO_FECHAMENTO =
  "id, amount, transaction_type, currency, category_id, transaction_date, descricao, group_id";

/**
 * As duas categorias reservadas da conta gerada (067, SECAO 3), com o nome que
 * o banco grava. A tela de Receitas e Despesas rotula a linha por elas sem
 * uma consulta a mais.
 */
export const CATEGORIA_DO_PAGAMENTO_AO_GRUPO = "2d0cd129-b5a6-400f-b3b4-702c72ced10e";
export const CATEGORIA_DO_RECEBIMENTO_DO_GRUPO = "f17cbc31-ce0d-4ee8-aa0c-1541736e4ad5";

const NOME_DA_CATEGORIA: Readonly<Record<string, string>> = {
  [CATEGORIA_DO_PAGAMENTO_AO_GRUPO]: "Pagamento a grupo",
  [CATEGORIA_DO_RECEBIMENTO_DO_GRUPO]: "Recebimento de grupo",
};

/**
 * O prefixo do id da linha sintetizada. A conta quitada tem id de
 * `scheduled_transactions`, e a linha da tela de Receitas e Despesas nao pode
 * passar por uma linha de `financial_transactions` nem por uma conta prevista
 * que aceite baixa: com o prefixo o id nao e um uuid, e nenhuma rota o aceita.
 */
export const PREFIXO_DA_CONTA_DO_FECHAMENTO = "fechamento:";
export const PREFIXO_DA_ESTIMATIVA_DO_FECHAMENTO = "estimativa-do-fechamento:";

/** Uma linha de `group_closing_entries`, como chega do PostgREST. */
export interface ContaDoFechamentoCrua {
  id: string;
  amount: number | string;
  transaction_type: string | null;
  currency?: string | null;
  category_id?: string | null;
  transaction_date?: string | null;
  descricao?: string | null;
  group_id?: string | null;
}

/**
 * A conta quitada no formato de uma linha realizada da tela de Receitas e
 * Despesas (`RealizadaCrua`, lib/telas-de-movimentacao.ts).
 *
 * `amount` com o SINAL do banco: despesa negativa, receita positiva -- e a
 * convencao de `financial_transactions`, que `linhaRealizada` le.
 *
 * SEM `user_id`, de proposito: a ausencia derruba `posso_editar` e a linha sai
 * sem botao. A conta do fechamento nao se edita nem se exclui (RN018.12); ela
 * se quita pelo acerto no grupo.
 */
export interface ContaDoFechamentoRealizada {
  id: string;
  description: string;
  amount: number;
  transaction_date: string;
  transaction_type: "expense" | "income";
  currency: string;
  category: { name: string; is_expense: boolean };
  /**
   * O juro pago do MyBank (fase 5) usa esta mesma forma, com a chave
   * `mybank:<id>` aqui e o selo que a lista mostra no lugar de "Fechamento do
   * grupo" (`jurosPagosComoRealizados`, lib/leituras-do-mybank.ts).
   */
  notes?: string;
  selo?: string;
}

export function contasDoFechamentoComoRealizadas(
  contas: readonly ContaDoFechamentoCrua[]
): ContaDoFechamentoRealizada[] {
  const linhas: ContaDoFechamentoRealizada[] = [];
  for (const conta of contas) {
    // So os dois tipos que o fechamento gera. Um terceiro nao tem lado no
    // Resultado, e somado como despesa ele seria um numero inventado.
    if (conta.transaction_type !== "expense" && conta.transaction_type !== "income") {
      continue;
    }
    const valor = Math.abs(Number(conta.amount) || 0);
    const despesa = conta.transaction_type === "expense";
    linhas.push({
      id: `${PREFIXO_DA_CONTA_DO_FECHAMENTO}${conta.id}`,
      description: conta.descricao ?? (despesa ? "Pagamento ao grupo" : "A receber do grupo"),
      amount: despesa ? -valor : valor,
      transaction_date: conta.transaction_date ?? "",
      transaction_type: conta.transaction_type,
      currency: conta.currency ?? "BRL",
      category: {
        name:
          NOME_DA_CATEGORIA[conta.category_id ?? ""] ??
          (despesa ? "Pagamento a grupo" : "Recebimento de grupo"),
        is_expense: despesa,
      },
    });
  }
  return linhas;
}

/** A estimativa de um membro no periodo aberto de um grupo. */
export interface EstimativaDoMembro {
  tipo: "expense" | "income";
  /** BRL, positivo. */
  valor: number;
}

/**
 * O que o membro pagaria ou receberia se o periodo fechasse agora.
 *
 * E a conta que o fechamento GERARIA para ele -- a mesma de
 * `FechamentoDoPeriodo.contas`, e nao um saldo recalculado aqui. Saldo zero,
 * ou membro que nao aparece no periodo, nao tem estimativa: `null`.
 */
export function estimativaDoMembro(
  fechamento: Pick<FechamentoDoPeriodo, "contas">,
  userId: string
): EstimativaDoMembro | null {
  const conta = fechamento.contas.find((c) => c.user_id === userId);
  if (!conta || !(conta.valor > 0)) return null;
  return { tipo: conta.tipo, valor: conta.valor };
}

/** A estimativa de um grupo, pronta para virar linha prevista. */
export interface EstimativaDoGrupo extends EstimativaDoMembro {
  group_id: string;
  nome: string;
  /** O dia do fechamento que vai gerar a conta: o vencimento dela (D3). */
  vencimento: string;
  /**
   * O que o chevron da linha abre: cada despesa com a minha parte, e o que eu
   * ja paguei abatido (`detalheDoPeriodo`, lib/despesas-do-grupo.ts). Opcional
   * porque a previsao do painel nao o usa.
   */
  detalhe?: { itens: ItemDoGrupoNaLista[]; abatimentos: AbatimentoDoGrupo[] };
}

/**
 * O texto da linha: "Despesas do Grupo Casa", o nome que o Helio pediu. Que e
 * PREVISTO a linha diz pelo lugar (so o Previsto a recebe) e pelo selo da tela
 * ("previsto até o fechamento de 01/11", `seloDoGrupo`).
 */
export function descricaoDaEstimativa(e: Pick<EstimativaDoGrupo, "tipo" | "nome">): string {
  return e.tipo === "expense"
    ? `Despesas do Grupo ${e.nome}`
    : `A receber do Grupo ${e.nome}`;
}

/**
 * A estimativa no formato de uma linha prevista da tela de Receitas e
 * Despesas (`PrevistaCrua`).
 *
 * `id: null`, como a fatura aberta sintetizada: a linha nao existe em tabela
 * nenhuma, e `linhaPrevista` a marca `gravada: false` -- sem botao de baixa,
 * editar ou excluir. `notes` leva a chave com prefixo, que e o que vira a
 * chave da linha na tela.
 *
 * `group_id` NULO: a estimativa ja e a minha posicao no grupo. Com o id do
 * grupo ela passaria pelo rateio e seria dividida de novo.
 */
export interface EstimativaComoPrevista {
  id: null;
  description: string;
  amount: number;
  due_date: string;
  my_status: "pending";
  my_effective_status: "pending";
  direction: "expense" | "income";
  notes: string;
  recurring_rule_id: null;
  group_id: null;
}

/**
 * A chave da linha da estimativa: `estimativa-do-fechamento:<grupo>:<dia>`. A
 * tela de Receitas e Despesas a usa como id da linha (`notes`), a previsao do
 * painel como id do item, e a linha do grupo (lib/despesas-do-grupo.ts) para
 * achar a linha que ela agrega -- uma funcao so, para as tres nao divergirem.
 */
export function chaveDaEstimativa(e: Pick<EstimativaDoGrupo, "group_id" | "vencimento">): string {
  return `${PREFIXO_DA_ESTIMATIVA_DO_FECHAMENTO}${e.group_id}:${e.vencimento}`;
}

export function estimativasComoPrevistas(
  estimativas: readonly EstimativaDoGrupo[]
): EstimativaComoPrevista[] {
  return estimativas.map((e) => ({
    id: null,
    description: descricaoDaEstimativa(e),
    amount: e.valor,
    due_date: e.vencimento,
    my_status: "pending",
    my_effective_status: "pending",
    direction: e.tipo,
    notes: chaveDaEstimativa(e),
    recurring_rule_id: null,
    group_id: null,
  }));
}

/** O minimo de uma conta prevista da agenda para as duas funcoes abaixo. */
export interface PrevistaDaAgenda {
  amount: number | string | null;
  group_id?: string | null;
  /** O dono da conta. Sem ele a linha nao e minha. */
  user_id?: string | null;
}

/**
 * Separa a agenda em duas: a conta dos grupos que fecham e o resto.
 *
 * O resto segue pela regra do pagador (lib/regra-do-pagador.ts), como antes. A
 * conta do grupo que fecha segue por `previstasNoGrupoQueFecha`.
 */
export function separarPeloFechamento<T extends PrevistaDaAgenda>(
  previstas: readonly T[],
  gruposQueFecham: ReadonlySet<string>
): { doGrupoQueFecha: T[]; demais: T[] } {
  const doGrupoQueFecha: T[] = [];
  const demais: T[] = [];
  for (const p of previstas) {
    if (p.group_id && gruposQueFecham.has(p.group_id)) doGrupoQueFecha.push(p);
    else demais.push(p);
  }
  return { doGrupoQueFecha, demais };
}

/**
 * A conta prevista do grupo que fecha: a MINHA pelo valor cheio, a dos outros
 * fora (24/10/2026).
 *
 * "O lancamento no grupo de outubro deveria fechar dia 01 e aparecer pras
 * pessoas em novembro apenas. Pode aparecer mas como previsto, e bem claro que
 * e o previsto." O aluguel que o Helio lancou com vencimento em outubro nao e
 * uma conta da Leticia em outubro: o que ela deve do grupo vira UMA conta no
 * dia do fechamento (RN017, D3). Ate la ele aparece para ela so dentro da
 * estimativa daquele fechamento, no mes dele, como previsto -- e e
 * `lerEstimativasDoFechamento` que o leva para la, com o detalhe por despesa.
 * Ficar tambem aqui, pela parte dela, era a mesma divida duas vezes, em dois
 * meses (foram os R$ 78,39 que a Leticia viu em outubro numa conta nova).
 *
 * A MINHA CONTA FICA PELO VALOR CHEIO, que e o que sai da minha conta no dia em
 * que eu a pagar. O que os outros me devem dela entra na estimativa "A receber
 * do Grupo", em Receitas, no mes do fechamento -- a estimativa conta a conta
 * prevista como paga por quem a lancou. Contar so a minha parte aqui e a
 * estimativa la tiraria a parte dos outros duas vezes.
 *
 * SEM `pagar_para`, e ausente e nao nulo: neste grupo ninguem paga a parte
 * para quem lancou a conta, paga para o grupo no fechamento. Com o dono ali a
 * aba Despesas diria "pague R$ X a Fulano" (`pra_quem_pagar`), e o acerto
 * viria em dobro. E `null` tambem nao serve: em `destinosDoPagamento`
 * (lib/pra-quem-pagar.ts) ele quer dizer "deve a alguem que nao consigo ler",
 * e a linha entraria la como divida sem dono.
 */
export function previstasNoGrupoQueFecha<T extends PrevistaDaAgenda>(
  previstas: readonly T[],
  meuUserId: string | null | undefined
): (T & { pagar_para?: undefined })[] {
  if (!meuUserId) return [];
  return previstas
    .filter((p) => p.user_id === meuUserId)
    .map((p) => ({ ...p, amount: Math.abs(Number(p.amount) || 0) }));
}

/**
 * A lista da Financas Pessoais com a conta do fechamento quitada.
 *
 * Um terceiro `kind`, e nao uma linha "minha": a conta do fechamento nao e uma
 * `financial_transactions`, e os botoes de editar e excluir da linha comum
 * chamariam a rota de transacao com um id que ela nao conhece. Com a uniao
 * discriminada a tela tem de desenhar o ramo dela.
 *
 * A ordem e a da lista, por data decrescente. `sort` e estavel, entao as
 * linhas que ja vieram ordenadas de `linhasDaLista` nao trocam de lugar entre
 * si.
 */
export type LinhaDaListaComFechamento<T> =
  | LinhaDaLista<T>
  | { kind: "fechamento"; conta: ContaDoFechamentoRealizada };

function dataDaLinhaComFechamento<T extends { transaction_date?: string | null }>(
  linha: LinhaDaListaComFechamento<T>
): string {
  if (linha.kind === "fechamento") return linha.conta.transaction_date;
  if (linha.kind === "parte") return linha.parte.transactionDate;
  return linha.mov.transaction_date ?? "";
}

export function comAsContasDoFechamento<T extends { transaction_date?: string | null }>(
  linhas: readonly LinhaDaLista<T>[],
  contas: readonly ContaDoFechamentoRealizada[]
): LinhaDaListaComFechamento<T>[] {
  const todas: LinhaDaListaComFechamento<T>[] = [
    ...linhas,
    ...contas.map((conta) => ({ kind: "fechamento" as const, conta })),
  ];
  return todas.sort((a, b) =>
    dataDaLinhaComFechamento(b).localeCompare(dataDaLinhaComFechamento(a))
  );
}
