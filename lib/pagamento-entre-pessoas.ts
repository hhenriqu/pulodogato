/**
 * O PAGAMENTO ENTRE PESSOAS (migration 081)
 * =========================================
 *
 * Quem paga marca, na propria despesa, para quem foi o dinheiro. Para quem
 * recebe aparece "<nome> te pagou R$ X -- a lancar"; ela escolhe a conta em que
 * o dinheiro caiu e confirma, e so entao a receita dela nasce -- na sessao
 * dela, na conta dela. E o desenho do acerto de grupo
 * (`lib/perna-da-contraparte.ts`): ninguem lanca na conta de outra pessoa.
 *
 * Este arquivo e a parte pura: o formato da lista, a descricao da receita, o
 * nome da categoria e as mensagens. As rotas ficam em
 * `app/api/pagamentos-entre-pessoas/`.
 */

export type SituacaoDoPagamento = "a_lancar" | "lancado" | "recusado";
export type PapelNoPagamento = "paguei" | "recebi";

/** Uma linha de `meus_pagamentos_entre_pessoas()`. */
export interface PagamentoEntrePessoas {
  id: string;
  papel: PapelNoPagamento;
  outra_pessoa_id: string;
  outra_pessoa: string;
  valor: number;
  data: string;
  descricao: string | null;
  situacao: SituacaoDoPagamento;
  lancamento_do_pagador: string | null;
  lancamento_do_recebedor: string | null;
  created_at: string;
}

export interface PessoaParaPagamento {
  user_id: string;
  nome: string;
}

/**
 * A categoria de RECEITA de quem recebe, criada por usuario na primeira vez
 * (mesmo caminho de `categoria-do-acerto.ts`). Receita, e nao transferencia:
 * quem paga lancou despesa, e o dinheiro e da pessoa que recebeu.
 */
export const NOME_DA_CATEGORIA_DO_RECEBIMENTO = "Recebido da família";
export const DESCRICAO_DA_CATEGORIA_DO_RECEBIMENTO =
  "Dinheiro que outra pessoa da família te pagou (confirmado por você).";

/** O que vai em `notes` da receita, para achar de volta qual pagamento ela confirma. */
export function chaveDoPagamento(pagamentoId: string): string {
  return `pagamento:${pagamentoId}`;
}

/** A descricao da receita de quem recebe: "Recebido de Helio" (+ o que ele escreveu). */
export function descricaoDoRecebimento(
  pagadorNome: string,
  descricaoDoPagador?: string | null
): string {
  const nome = pagadorNome.trim() || "outra pessoa";
  const extra = (descricaoDoPagador ?? "").trim();
  return extra ? `Recebido de ${nome} · ${extra}` : `Recebido de ${nome}`;
}

/** Os que pedem uma acao de quem chama: recebi e ainda nao lancei nem recusei. */
export function aLancarPorMim(
  pagamentos: PagamentoEntrePessoas[]
): PagamentoEntrePessoas[] {
  return pagamentos.filter(
    (p) => p.papel === "recebi" && p.situacao === "a_lancar"
  );
}

/** Rotulo curto da situacao, do ponto de vista de quem pagou. */
export function rotuloParaQuemPagou(p: PagamentoEntrePessoas): string {
  switch (p.situacao) {
    case "lancado":
      return `${p.outra_pessoa} confirmou`;
    case "recusado":
      return `${p.outra_pessoa} disse que não recebeu`;
    default:
      return `Aguardando ${p.outra_pessoa} confirmar`;
  }
}

/**
 * Valida o pedido de criar um pagamento a partir de uma despesa. A rota usa;
 * o banco (trava PDG81 e a policy) confere de novo.
 */
export function problemaDoPedido(corpo: unknown):
  | { ok: true; lancamentoId: string; recebedorId: string }
  | { ok: false; erro: string } {
  const c = (corpo ?? {}) as Record<string, unknown>;
  const lancamentoId = typeof c.lancamento_id === "string" ? c.lancamento_id : "";
  const recebedorId = typeof c.recebedor_id === "string" ? c.recebedor_id : "";
  if (!lancamentoId) return { ok: false, erro: "Falta o lançamento do pagamento." };
  if (!recebedorId) return { ok: false, erro: "Falta para quem foi o pagamento." };
  return { ok: true, lancamentoId, recebedorId };
}
