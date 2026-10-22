// ---------------------------------------------------------------------------
// O VINCULO ENTRE A CONTA PREVISTA E UM LANCAMENTO QUE JA EXISTE
// ---------------------------------------------------------------------------
// O sintoma, medido em producao em 22/10/2026: o Helio lancou Aluguel,
// Condominio e IPTU do grupo Casa A MAO no dia 09/10, e as tres contas
// previstas das mesmas despesas continuaram `pending`. O dashboard somou as
// duas pontas -- o realizado (o lancamento) e o previsto (a conta) -- e a Lais
// viu R$ 406,73 de despesa onde o certo era R$ 237,81.
//
// A causa e que `POST /api/scheduled-transactions/{id}/pay` era a UNICA ponte
// entre previsto e realizado, e ela CRIA um lancamento novo. Quem lancou antes
// nao tinha como dizer "isto aqui ja e o pagamento daquela conta".
//
// Este modulo e a regra das duas perguntas que a ponte nova faz, e e puro de
// proposito -- a rota e o formulario so leem e gravam:
//
//   1. `problemaDoVinculo`: ESTE lancamento pode quitar ESTA prevista? E a
//      validacao do clique explicito, com a janela larga (`JANELA_DO_VINCULO`).
//   2. `previstaCorresponde`: este lancamento PARECE o pagamento daquela
//      prevista? E a regra da SUGESTAO, estreita (valor +-1%, vencimento +-7
//      dias, mesma categoria ou mesma descricao normalizada). Ela so serve para
//      perguntar -- nada e vinculado sem a pessoa confirmar.
//
// As duas moram juntas porque a segunda tem de ser um SUBCONJUNTO da primeira:
// sugerir um par que o clique "Sim" recusaria seria pior do que nao sugerir.
// `test-vinculo-da-prevista.mjs` prende isso.
// ---------------------------------------------------------------------------

import { ehFatura } from "@/lib/chave-da-fatura";
import { diasEntre, normalizeMerchant } from "@/lib/recurrence-detector";

// A chave do MyBank (`PREFIXO_DA_CHAVE_DO_MYBANK`, lib/emprestimo-do-mybank.ts)
// repetida em literal: importar de la puxaria o modulo inteiro do MyBank, com
// os aliases `@/`, para dentro de uma regra que so precisa do prefixo.
const PREFIXO_DO_MYBANK = "mybank:";

/**
 * A distancia maxima, em dias, entre o vencimento e a data do lancamento para o
 * vinculo EXPLICITO. Um mes para cada lado: cobre a conta paga adiantada no fim
 * do mes anterior e a paga com atraso, e recusa o lancamento de outro mes que
 * caiu no seletor por engano (o aluguel de setembro quitando o de outubro).
 */
export const JANELA_DO_VINCULO = 31;

/** A janela da SUGESTAO: estreita, porque ela pergunta sem a pessoa pedir. */
export const JANELA_DA_SUGESTAO = 7;

/** A tolerancia de valor da sugestao: 1% do valor previsto. */
export const TOLERANCIA_DA_SUGESTAO = 0.01;

/** O que a regra le da conta prevista. `direction` e o da view (027). */
export interface PrevistaParaVinculo {
  id: string;
  user_id: string;
  status: string;
  amount: number | string;
  due_date: string;
  direction: string | null;
  category_id?: string | null;
  description?: string | null;
  notes?: string | null;
}

/** O que a regra le do lancamento. */
export interface LancamentoParaVinculo {
  id: string;
  user_id: string;
  amount: number | string;
  transaction_date: string;
  transaction_type: string | null;
  category_id?: string | null;
  description?: string | null;
}

export type ProblemaDoVinculo =
  | "prevista_nao_pendente"
  | "prevista_de_transferencia"
  | "lancamento_de_outro"
  | "lancamento_de_transferencia"
  | "direcao_diferente"
  | "ja_vinculado"
  | "fora_da_janela";

/**
 * A direcao do lancamento: `transaction_type`, e o sinal so quando ele falta.
 *
 * O sinal e o fallback e nao a regra porque a HMO-181 consertou exatamente o
 * contrario -- lancamento cujo tipo saia do sinal. Mas linha antiga sem
 * `transaction_type` existe, e recusar o vinculo dela por "direcao diferente"
 * seria um erro sem explicacao.
 */
export function direcaoDoLancamento(
  l: Pick<LancamentoParaVinculo, "amount" | "transaction_type">
): "income" | "expense" | "transfer" {
  if (l.transaction_type === "income" || l.transaction_type === "expense") {
    return l.transaction_type;
  }
  if (l.transaction_type === "transfer") return "transfer";
  return Number(l.amount) > 0 ? "income" : "expense";
}

/**
 * A direcao da prevista: a coluna `direction` da view, com o mesmo `expense`
 * final da precedencia da 027. Nao refaz o COALESCE -- so cobre a linha que
 * chegou sem a coluna.
 */
export function direcaoDaPrevista(
  p: Pick<PrevistaParaVinculo, "direction">
): string {
  return p.direction ?? "expense";
}

/**
 * Fatura de cartao e transferencia prevista ficam FORA do vinculo.
 *
 * As duas tem DUAS pernas e a baixa delas aponta para a perna de saida, com o
 * estorno procurando a outra pelo elo (`/pay`, HMO-149/172). Vincular a um
 * lancamento solto deixaria a prevista "paga" sem a perna que o estorno espera,
 * e a divida do cartao sem quitar. Para elas o caminho continua sendo o `/pay`.
 */
function previstaDeTransferencia(p: PrevistaParaVinculo): boolean {
  if (direcaoDaPrevista(p) === "transfer") return true;
  return ehFatura(p.notes) || (p.notes ?? "").startsWith(PREFIXO_DO_MYBANK);
}

/**
 * ESTE lancamento pode quitar ESTA prevista? `null` quando pode.
 *
 * `vinculadoA` e o id da prevista que ja aponta para este lancamento, ou
 * `null`. Vem da rota, que e quem le o banco.
 *
 * A ordem das perguntas e a ordem das mensagens que fazem sentido: estado da
 * prevista primeiro (nada mais importa se ela ja foi paga), dono depois, e as
 * comparacoes de conteudo por ultimo.
 */
export function problemaDoVinculo(params: {
  prevista: PrevistaParaVinculo;
  lancamento: LancamentoParaVinculo;
  vinculadoA: string | null;
}): ProblemaDoVinculo | null {
  const { prevista, lancamento, vinculadoA } = params;

  if (prevista.status !== "pending") return "prevista_nao_pendente";
  if (previstaDeTransferencia(prevista)) return "prevista_de_transferencia";

  // O MESMO DONO. A prevista de grupo e uma linha so, do dono dela, e o
  // realizado de grupo sai do lancamento pelo trigger (`group_share_entries`,
  // 033). Vincular ao lancamento de OUTRO membro faria a prevista do Helio
  // ficar paga com o dinheiro da Lais -- e o estorno (apagar o lancamento)
  // dependeria de uma pessoa que nao e dona da prevista.
  if (lancamento.user_id !== prevista.user_id) return "lancamento_de_outro";

  const direcao = direcaoDoLancamento(lancamento);
  if (direcao === "transfer") return "lancamento_de_transferencia";
  if (direcao !== direcaoDaPrevista(prevista)) return "direcao_diferente";

  if (vinculadoA && vinculadoA !== prevista.id) return "ja_vinculado";

  const distancia = Math.abs(
    diasEntre(prevista.due_date, lancamento.transaction_date)
  );
  if (!(distancia <= JANELA_DO_VINCULO)) return "fora_da_janela";

  return null;
}

export function mensagemDoVinculo(problema: ProblemaDoVinculo): string {
  switch (problema) {
    case "prevista_nao_pendente":
      return "Esta conta prevista não está em aberto.";
    case "prevista_de_transferencia":
      return "Fatura de cartão e transferência não se vinculam a um lançamento: use o botão de pagar.";
    case "lancamento_de_outro":
      return "O lançamento precisa ser seu, o mesmo dono da conta prevista.";
    case "lancamento_de_transferencia":
      return "Uma transferência não quita uma conta prevista.";
    case "direcao_diferente":
      return "O lançamento e a conta prevista estão em direções diferentes (receita e despesa).";
    case "ja_vinculado":
      return "Este lançamento já quita outra conta prevista.";
    case "fora_da_janela":
      return `O lançamento está a mais de ${JANELA_DO_VINCULO} dias do vencimento.`;
  }
}

/**
 * O lancamento PARECE o pagamento desta prevista? E a regra da sugestao.
 *
 *   - passa em `problemaDoVinculo` (sem vinculo anterior): sugerir o que o
 *     clique "Sim" recusaria e pior do que nao sugerir;
 *   - valor igual com tolerancia de 1% do PREVISTO, em centavos. A conta de luz
 *     que veio R$ 3 maior nao e sugerida -- a pessoa vincula pela agenda;
 *   - vencimento a +-7 dias da data do lancamento;
 *   - mesma categoria OU mesma descricao normalizada. So valor e data juntaria
 *     o condominio de R$ 295 com o mercado de R$ 295 da mesma semana.
 */
export function previstaCorresponde(
  prevista: PrevistaParaVinculo,
  lancamento: LancamentoParaVinculo
): boolean {
  if (problemaDoVinculo({ prevista, lancamento, vinculadoA: null })) {
    return false;
  }

  const previsto = Math.round(Math.abs(Number(prevista.amount)) * 100);
  const lancado = Math.round(Math.abs(Number(lancamento.amount)) * 100);
  if (!Number.isFinite(previsto) || !Number.isFinite(lancado)) return false;
  const tolerancia = Math.round(previsto * TOLERANCIA_DA_SUGESTAO);
  if (Math.abs(previsto - lancado) > tolerancia) return false;

  const distancia = Math.abs(
    diasEntre(prevista.due_date, lancamento.transaction_date)
  );
  if (distancia > JANELA_DA_SUGESTAO) return false;

  const mesmaCategoria =
    Boolean(prevista.category_id) &&
    prevista.category_id === lancamento.category_id;

  const chavePrevista = normalizeMerchant(prevista.description ?? "");
  const mesmaDescricao =
    chavePrevista !== "" &&
    chavePrevista === normalizeMerchant(lancamento.description ?? "");

  return mesmaCategoria || mesmaDescricao;
}

/**
 * As previstas que o lancamento parece pagar, da mais proxima para a mais
 * distante (dias do vencimento, depois diferenca de valor). A tela pergunta
 * pela primeira e oferece as outras.
 */
export function previstasCorrespondentes<P extends PrevistaParaVinculo>(
  previstas: P[],
  lancamento: LancamentoParaVinculo
): P[] {
  const distancia = (p: P) =>
    Math.abs(diasEntre(p.due_date, lancamento.transaction_date));
  const diferenca = (p: P) =>
    Math.abs(Math.abs(Number(p.amount)) - Math.abs(Number(lancamento.amount)));

  return previstas
    .filter((p) => previstaCorresponde(p, lancamento))
    .sort((a, b) => distancia(a) - distancia(b) || diferenca(a) - diferenca(b));
}

/**
 * Os lancamentos que a pessoa pode escolher para uma prevista, no seletor da
 * agenda ("Ja lancei -- vincular"). Todos os que `problemaDoVinculo` aceita;
 * os que a regra da sugestao reconhece vem primeiro e marcados.
 */
export function lancamentosParaEscolher<L extends LancamentoParaVinculo>(
  prevista: PrevistaParaVinculo,
  lancamentos: L[],
  vinculadosAOutra: ReadonlySet<string>
): (L & { sugerido: boolean })[] {
  const distancia = (l: L) =>
    Math.abs(diasEntre(prevista.due_date, l.transaction_date));

  return lancamentos
    .filter(
      (l) =>
        !problemaDoVinculo({
          prevista,
          lancamento: l,
          vinculadoA: vinculadosAOutra.has(l.id) ? "outra" : null,
        })
    )
    .map((l) => ({ ...l, sugerido: previstaCorresponde(prevista, l) }))
    .sort(
      (a, b) =>
        Number(b.sugerido) - Number(a.sugerido) || distancia(a) - distancia(b)
    );
}
