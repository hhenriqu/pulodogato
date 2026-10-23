/**
 * A CONTA GERADA PELO FECHAMENTO DO GRUPO SE QUITA PELO ACERTO (RN019, fase 3).
 *
 * "Pagamento ao grupo" e "A receber do grupo" (067) sao contas previstas como
 * as outras, e aparecem na mesma agenda -- com o mesmo botao de baixa, o mesmo
 * "Ja lancei: vincular", o mesmo editar e excluir. Nenhum deles serve para
 * elas:
 *
 *   * a baixa comum quita a conta de UM lado. A Lais que marcasse o pagamento
 *     dela como pago deixaria a conta a receber do Helio esperando um dinheiro
 *     que ja saiu, e o lado dele nunca saberia;
 *   * editar o valor ou apagar a conta muda uma divida que o fechamento
 *     calculou para o grupo inteiro (RN018.12).
 *
 * O banco ja recusa tudo isso (`scheduled_transactions_trava_do_fechamento`,
 * 068). As rotas conferem antes para responder 409 com uma frase que diz o que
 * fazer, em vez do 500 que o erro do trigger viraria.
 */

export const MENSAGEM_DA_CONTA_DO_FECHAMENTO =
  "Esta conta veio do fechamento do grupo e se quita pelo acerto no grupo: registre o Pix na tela do grupo, e a conta dos dois lados é quitada junto.";

/** A conta prevista nasceu de um fechamento de grupo? */
export function ehContaDoFechamento(
  conta: { group_closing_id?: string | null } | null | undefined
): boolean {
  return Boolean(conta?.group_closing_id);
}
