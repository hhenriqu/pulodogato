/**
 * A CONTA DA DIVISAO COM PESSOA MUDA PELO LANCAMENTO (RN020, fase 5).
 *
 * A Lais paga R$ 79,86 na Agropecuaria e divide 90% com o Helio. A 070 faz
 * nascer duas contas previstas desse lancamento: "A receber de Helio" na agenda
 * dela e "Pagamento a Lais" na dele, as duas de R$ 71,87. Cada lado quita a
 * propria com a baixa de sempre (Pagar, Receber ou "Ja lancei"), na conta que
 * quiser.
 *
 * O que nao serve para elas e o editar e o excluir da agenda: o valor, a data e
 * a pessoa sao do lancamento. Mudar so a conta do Helio deixaria a da Lais
 * esperando outro numero, e apagar a dele sumiria com uma divida que o
 * lancamento dela ainda diz que existe.
 *
 * O banco ja recusa tudo isso (`scheduled_transactions_trava_da_divisao`, 070).
 * As rotas conferem antes para responder 409 com uma frase que diz o que fazer,
 * em vez do 500 que o erro do trigger viraria.
 */

export const MENSAGEM_DA_CONTA_DA_DIVISAO =
  "Esta conta veio de um lançamento dividido com outra pessoa: o valor, a data e a pessoa mudam pelo lançamento. Para quitar, use Pagar ou Receber nesta conta.";

/**
 * A recusa da 070 quando um dos lados ja deu baixa (SQLSTATE `PDG02`).
 *
 * O banco escreve sem acento, como toda mensagem de trigger daqui; a tela mostra
 * esta, que diz a mesma coisa para os dois caminhos (editar e apagar).
 */
export const MENSAGEM_DA_DIVISAO_PAGA =
  "Um dos lados já pagou esta divisão. Desfaça a baixa na agenda antes de mudar o valor, a data ou a pessoa, ou de apagar o lançamento.";

/** A conta prevista nasceu de uma divisao com pessoa? */
export function ehContaDaDivisaoComPessoa(
  conta: { expense_split_id?: string | null } | null | undefined
): boolean {
  return Boolean(conta?.expense_split_id);
}

/**
 * A frase para a recusa da divisao ja paga, ou `null` se o erro e outro.
 *
 * Casa pelo codigo, como `avisoDeEdicaoTravada` (lib/grupos.ts) faz com o
 * PDG01: o texto do banco e para ler, o codigo e para programar.
 */
export function avisoDaDivisaoPaga(erro: unknown): string | null {
  if (!erro || typeof erro !== "object") return null;
  return (erro as { code?: unknown }).code === "PDG02"
    ? MENSAGEM_DA_DIVISAO_PAGA
    : null;
}

/** Uma parte como esta gravada em `expense_splits`. */
export interface ParteGravada {
  id: string;
  participant_id: string;
  percentage: number | string;
}

/** Uma parte como esta no formulario. */
export interface ParteDesejada {
  participanteId: string;
  percentual: number;
}

/**
 * O que gravar para a divisao do lancamento sair igual ao formulario.
 *
 * O formulario apagava todas as partes e inseria de novo a cada edicao. Desde a
 * 070 isso apaga e recria as contas da divisao, e recusa a edicao inteira
 * quando um dos lados ja pagou -- mesmo que a pessoa so tenha corrigido a
 * descricao. Por isso a edicao toca so o que mudou:
 *
 *   * a pessoa que saiu da lista e apagada;
 *   * a que ficou com outra porcentagem e atualizada, e mantem a aprovacao;
 *   * a que entrou e inserida.
 *
 * A pessoa e a chave (`unique_participant_per_transaction`). A porcentagem e
 * comparada em centesimos porque a coluna e numeric(5,2) e chega como texto.
 */
export function mudancasDaDivisao(
  gravadas: ParteGravada[],
  desejadas: ParteDesejada[]
): {
  inserir: ParteDesejada[];
  atualizar: { id: string; percentual: number }[];
  apagar: string[];
} {
  const centesimos = (valor: number | string) =>
    Math.round(Number(valor) * 100);
  const porPessoa = new Map(desejadas.map((d) => [d.participanteId, d]));
  const jaGravada = new Set(gravadas.map((g) => g.participant_id));

  const apagar: string[] = [];
  const atualizar: { id: string; percentual: number }[] = [];
  for (const gravada of gravadas) {
    const desejada = porPessoa.get(gravada.participant_id);
    if (!desejada) {
      apagar.push(gravada.id);
    } else if (centesimos(gravada.percentage) !== centesimos(desejada.percentual)) {
      atualizar.push({ id: gravada.id, percentual: desejada.percentual });
    }
  }

  const inserir = desejadas.filter((d) => !jaGravada.has(d.participanteId));
  return { inserir, atualizar, apagar };
}
