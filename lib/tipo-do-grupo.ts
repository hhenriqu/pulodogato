/**
 * O tipo do grupo: a CASA ou um EVENTO (migration 076, `expense_groups.group_kind`).
 *
 *   - casa:   a familia. Permanente, divide as contas do mes e fecha todo mes
 *             (o grupo "Casa" com dia de fechamento, RN018).
 *   - evento: a viagem, o churrasco. Temporario, acerta uma vez.
 *
 * NAO CONFUNDIR COM `group_type`
 * ------------------------------
 * `group_type` (public/private) e a regra de ENTRADA: quem usa o codigo de um
 * grupo publico entra direto, num privado fica pendente. As duas perguntas sao
 * independentes, e por isso a tela chama `group_type` de "Entrada no grupo" e
 * reserva "Tipo" para este modulo.
 *
 * Os grupos que existiam antes da 076 viraram casa quando tinham dia de
 * fechamento, e evento quando nao tinham.
 */

export const TIPOS_DE_GRUPO = ["casa", "evento"] as const;

export type TipoDoGrupo = (typeof TIPOS_DE_GRUPO)[number];

/** O DEFAULT da coluna: o grupo criado sem dizer o tipo e um evento. */
export const TIPO_PADRAO: TipoDoGrupo = "evento";

export function ehTipoDoGrupo(valor: unknown): valor is TipoDoGrupo {
  return (
    typeof valor === "string" &&
    (TIPOS_DE_GRUPO as readonly string[]).includes(valor)
  );
}

/**
 * O tipo que a rota grava. Campo ausente (cliente mais antigo que a 076) vira
 * o DEFAULT; um valor fora da lista e `null`, para a rota responder 400 em vez
 * de deixar o CHECK do banco virar um 500 sem apontar o campo.
 */
export function tipoDoGrupoParaGravar(valor: unknown): TipoDoGrupo | null {
  if (valor === undefined || valor === null || valor === "") return TIPO_PADRAO;
  return ehTipoDoGrupo(valor) ? valor : null;
}

/**
 * O tipo para MOSTRAR. Uma resposta sem a coluna (API anterior a 076) e lida
 * como evento, que e o que o banco diria para um grupo sem fechamento.
 */
export function tipoDoGrupo(valor: unknown): TipoDoGrupo {
  return ehTipoDoGrupo(valor) ? valor : TIPO_PADRAO;
}

export const ROTULO_DO_TIPO: Record<TipoDoGrupo, string> = {
  casa: "Casa",
  evento: "Evento",
};

export const DESCRICAO_DO_TIPO: Record<TipoDoGrupo, string> = {
  casa: "A família ou quem mora junto. Divide as contas do mês e fecha todo mês.",
  evento: "Uma viagem, um churrasco, uma festa. Divide os gastos e acerta uma vez.",
};

/** A casa vem antes dos eventos na lista de grupos; dentro de cada tipo, a ordem original fica. */
export function casaPrimeiro<T extends { group_kind?: unknown }>(
  grupos: readonly T[]
): T[] {
  return grupos
    .map((grupo, i) => ({ grupo, i }))
    .sort((a, b) => {
      const pa = tipoDoGrupo(a.grupo.group_kind) === "casa" ? 0 : 1;
      const pb = tipoDoGrupo(b.grupo.group_kind) === "casa" ? 0 : 1;
      return pa - pb || a.i - b.i;
    })
    .map(({ grupo }) => grupo);
}
