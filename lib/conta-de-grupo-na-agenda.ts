// ---------------------------------------------------------------------------
// A CONTA DE GRUPO DE OUTRA PESSOA, NA AGENDA DE CONTAS A PAGAR -- HMO-411
// ---------------------------------------------------------------------------
// A tela de Contas a Pagar lista a conta de grupo que outro membro criou: a
// RLS do 005 a entrega (`group_id IS NOT NULL AND is_group_member(group_id)`)
// e a HMO-303 passou a traze-la de proposito, porque a parte dela e dinheiro
// que vai sair do bolso de quem esta olhando.
//
// MAS OS QUATRO BOTOES DA LINHA COMUM NAO SERVEM NELA, E OS QUATRO FALHAM
// CALADOS -- o mesmo desenho e o mesmo motivo de
// `components/mybank/LinhaDaParcelaDoMyBank.tsx` (HMO-386):
//
//   * «dar baixa» chama `POST /api/scheduled-transactions/{id}/pay`, que
//     filtra `.eq("user_id", user.id)` e responde 404 "Conta prevista nao
//     encontrada" para quem nao e o dono. A pessoa aperta e leva um erro que
//     diz que a conta que ela esta VENDO nao existe;
//   * «alterar» e «pular» mandam PATCH/DELETE na linha do outro: a RLS os
//     recusa pelo filtro, e UPDATE filtrado pela RLS volta **200 sem alterar
//     nada** -- o app diz "pronto" e a linha fica exatamente como estava;
//   * o comprovante se penduraria na conta prevista de outra pessoa.
//
// O gesto que esta linha precisa e outro, e e so um: «eu paguei a minha
// parte». Ele nao move dinheiro nenhum -- ver a decisao D1 no cabecalho de
// app/api/scheduled-transactions/[id]/minha-baixa/route.ts.
//
// POR QUE A REGRA MORA AQUI E NAO DENTRO DO COMPONENTE
// ---------------------------------------------------
// Ela e lida em dois lugares (a tela de Contas a Pagar escolhe o desenho da
// linha; a tela do grupo monta o estado por membro) e e conferida por suite
// propria. Escrita duas vezes, a copia esquecida seria a linha de grupo
// voltando a receber os quatro botoes -- que e o defeito de hoje.

/** O minimo que uma linha da agenda precisa ter para esta regra decidir. */
export interface LinhaComDono {
  /** `null` na fatura sintetizada e na parcela do MyBank -- nenhuma e gravada. */
  id?: string | null;
  /** O DONO da conta prevista, que e quem a criou. */
  user_id?: string | null;
  /** `null`/ausente = conta individual. */
  group_id?: string | null;
  /** `my_status` da view (055). Ausente = a view nao entregou a coluna. */
  my_status?: string | null;
}

/** O que o membro pode estar em relacao a parte dele. */
export type EstadoDaMinhaParte = "pendente" | "avisado" | "confirmado";

/** O rotulo do unico botao da linha. */
export const ROTULO_PARA_AVISAR = "Paguei minha parte";

/** O que aparece no lugar do botao depois do toque. */
export const ROTULO_JA_AVISADO = "Você avisou que pagou";

/** A frase que completa o estado `avisado`: falta alguem, e a tela diz quem. */
export const FALTA_O_DONO_CONFIRMAR = "falta quem criou a conta confirmar";

/** O rotulo do desfazer. */
export const ROTULO_DESFAZER = "Desfazer";

/**
 * Esta linha da agenda e uma conta de GRUPO de que eu NAO sou o dono?
 *
 * AS TRES CONDICOES SAO NECESSARIAS, e cada uma exclui um caso real:
 *
 *   1. `group_id` preenchido -- conta individual de outra pessoa nao chega
 *      nesta tela (a RLS a recusa), mas a condicao e o que torna a funcao
 *      verdadeira em vez de depender disso;
 *   2. `user_id` diferente do meu -- a MINHA conta de grupo continua com os
 *      quatro botoes. Dar baixa nela e justamente o gesto que rateia a despesa
 *      para os outros membros, e troca-lo pelo aviso quebraria o grupo
 *      inteiro: ninguem mais pagaria a conta de verdade;
 *   3. `id` preenchido -- a fatura sintetizada e a parcela do MyBank chegam com
 *      `id: null` e ja tem desenho proprio. Sem esta condicao uma delas que um
 *      dia ganhasse `group_id` cairia aqui e o botao montaria
 *      `/api/scheduled-transactions/null/minha-baixa`.
 *
 * `meuUserId` VAZIO DEVOLVE `false`, e a direcao do erro e o motivo: com
 * `""` a comparacao `user_id !== meuUserId` seria verdadeira para TODA linha,
 * e a tela trocaria os quatro botoes de todo mundo por um so. Errar para o
 * lado de "mostra os botoes de sempre" devolve a tela de antes desta issue;
 * errar para o outro apaga a baixa de verdade da tela inteira.
 */
export function ehContaDeGrupoDeOutro(
  linha: LinhaComDono,
  meuUserId: string | null | undefined
): boolean {
  if (!meuUserId) return false;
  if (!linha.id) return false;
  if (!linha.group_id) return false;
  return Boolean(linha.user_id) && linha.user_id !== meuUserId;
}

/**
 * Em que pe esta a MINHA parte nesta conta.
 *
 * O default e `pendente` e ele cobre DOIS estados do banco que sao o mesmo
 * para quem olha: linha ausente em `group_bill_payments` e linha gravada em
 * `'pending'`. A view 055 ja os funde no `COALESCE` de `my_status`, e esta
 * funcao nao os separa de novo -- quem precisa da distincao e a rota de
 * escrita, nao a tela.
 *
 * Um valor desconhecido tambem cai em `pendente`, e isso e deliberado: o erro
 * possivel passa a ser oferecer o botao a quem ja avisou (que a rota responde
 * com "voce ja avisou", sem gravar nada de novo), e nao esconder o botao de
 * quem precisa dele.
 */
export function estadoDaMinhaParte(linha: LinhaComDono): EstadoDaMinhaParte {
  if (linha.my_status === "reported") return "avisado";
  if (linha.my_status === "paid") return "confirmado";
  return "pendente";
}
