/**
 * O PARTICIPANTE SEM CONTA (migration 077, RN025).
 *
 * O amigo do churrasco entra no grupo so com o nome: a linha de
 * `group_members` tem `user_id` nulo e `display_name` preenchido. Ele divide
 * as despesas, aparece no saldo e no acerto, mas nao faz login.
 *
 * Este modulo e a regra pura que as rotas e a tela compartilham:
 *
 *   * `nomeDoParticipanteParaGravar` -- o que a rota de adicionar aceita. O
 *     mesmo limite dos CHECKs da 077 (nome nao vazio, ate 80 caracteres), para
 *     a rota responder 400 com a frase certa em vez de o banco responder 23514;
 *   * `idDaParte` -- a identidade de alguem no SALDO e no ACERTO. Quem tem conta
 *     e o `user_id` (como sempre foi: a perna do acerto, o Pix e a tela
 *     comparam com o usuario logado); quem nao tem e a linha do membro. As duas
 *     sao uuid, e nunca colidem;
 *   * `membroParaATela` -- a forma que a tela ja le (`member.user.full_name`),
 *     com `user.id` nulo para quem nao tem conta, de modo que nenhuma
 *     comparacao com o usuario logado da verdadeiro por engano.
 */

/** O tamanho maximo do nome, o mesmo de `group_members_display_name_tamanho_check`. */
export const TAMANHO_MAXIMO_DO_NOME = 80;

export type NomeParaGravar =
  | { ok: true; nome: string }
  | { ok: false; erro: string };

/**
 * Valida o nome digitado para o participante sem conta.
 *
 * Espacos nas pontas saem, e espacos repetidos no meio viram um so: "  Joao
 * da   Silva " e "Joao da Silva". Vazio e recusado (o CHECK da 077 recusaria
 * do mesmo jeito), e nome longo demais tambem.
 */
export function nomeDoParticipanteParaGravar(bruto: unknown): NomeParaGravar {
  if (typeof bruto !== "string") {
    return { ok: false, erro: "Diga o nome de quem vai participar." };
  }
  const nome = bruto.replace(/\s+/g, " ").trim();
  if (nome.length === 0) {
    return { ok: false, erro: "Diga o nome de quem vai participar." };
  }
  if (nome.length > TAMANHO_MAXIMO_DO_NOME) {
    return {
      ok: false,
      erro: `O nome pode ter até ${TAMANHO_MAXIMO_DO_NOME} caracteres.`,
    };
  }
  return { ok: true, nome };
}

/** O minimo de uma linha de membro (ou de saldo) que as funcoes abaixo leem. */
export type LinhaDoMembro = {
  member_id: string;
  user_id: string | null;
  display_name?: string | null;
};

/**
 * A identidade de alguem no saldo e no acerto: o `user_id` de quem tem conta,
 * a linha do membro de quem nao tem.
 */
export function idDaParte(linha: LinhaDoMembro): string {
  return linha.user_id ?? linha.member_id;
}

/** Se a linha e de alguem sem conta no app. */
export function semConta(linha: { user_id: string | null | undefined }): boolean {
  return !linha.user_id;
}

/**
 * O nome que a tela mostra. Para quem tem conta, o do perfil (que a RLS de
 * `profiles` pode esconder -- dai o fallback); para quem nao tem, o
 * `display_name`.
 */
export function nomeDoMembro(
  linha: { user_id: string | null | undefined; display_name?: string | null },
  nomeDoPerfil?: string | null
): string | null {
  if (linha.user_id) return nomeDoPerfil ?? null;
  return linha.display_name ?? null;
}

export type PerfilNaTela = {
  id: string | null;
  full_name: string | null;
  avatar_url: string | null;
};

/**
 * O `user` que a tela le em cada membro. Quem nao tem conta ganha um perfil
 * de fachada com `id: null` e o nome dele.
 */
export function membroParaATela(
  linha: { user_id?: string | null; display_name?: string | null },
  perfil: PerfilNaTela | null | undefined
): PerfilNaTela | null {
  if (linha.user_id) return perfil ?? null;
  return { id: null, full_name: linha.display_name ?? null, avatar_url: null };
}

/**
 * Traduz o SQLSTATE das travas da 077 para a resposta da rota.
 *
 * PDG77 e a trava do fechamento (e a do grupo arquivado): 409, com a frase do
 * banco, que ja diz o que fazer. 42501 / RLS: 403. 23514 (CHECK): 400.
 */
export function respostaDoErroDoBanco(erro: {
  code?: string | null;
  message?: string | null;
}): { status: number; mensagem: string } {
  const mensagem = erro.message || "Não foi possível gravar.";
  switch (erro.code) {
    case "PDG77":
      return { status: 409, mensagem };
    case "42501":
      // A RLS recusa sem dizer por que; as funcoes da 077 dizem.
      return {
        status: 403,
        mensagem: /row-level security/i.test(mensagem)
          ? "Só o admin do grupo pode fazer isso."
          : mensagem,
      };
    case "23514":
    case "22023":
      return { status: 400, mensagem };
    default:
      return { status: 500, mensagem: "Não foi possível gravar." };
  }
}
