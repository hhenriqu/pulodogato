/**
 * A criacao do perfil, compartilhada pelos DOIS jeitos de um cadastro terminar.
 *
 * Existem dois porque `mailer_autoconfirm` e um botao do dashboard do Supabase
 * (HMO-157):
 *
 * - confirmacao LIGADA: o `signUp` nao devolve sessao, o perfil so pode nascer
 *   em `/auth/callback`, depois de o link de email virar sessao;
 * - confirmacao DESLIGADA: o `signUp` ja devolve sessao e NINGUEM passa por
 *   `/auth/callback` -- se o perfil nascesse so la, o cadastro terminaria sem
 *   perfil e, por consequencia, sem assinatura.
 *
 * Os dois caminhos chamam esta funcao para que a regra nao viva duas vezes. O
 * detalhe que cobra isso caro e o trigger: `create_user_subscription_trigger`
 * dispara AFTER INSERT ON profiles, ou seja o perfil e o que faz a assinatura
 * gratuita existir. Um caminho que esquece o insert nao mostra erro nenhum --
 * so produz uma conta sem plano.
 */

/** As colunas que o cadastro sabe preencher. */
export type PerfilNovo = {
  id: string;
  email: string | null;
  full_name: string | null;
};

/**
 * O usuario visto de fora do supabase-js.
 *
 * `user_metadata.full_name` e o unico lugar onde o nome digitado no formulario
 * existe antes de haver perfil: ele entra via `options.data` do `signUp`.
 */
export type UsuarioMinimo = {
  id: string;
  email?: string | null;
  user_metadata?: { full_name?: unknown } | null;
};

/**
 * `upsert` com `onConflict: "id"` porque estes caminhos rodam de novo: toda
 * troca de senha e todo magic link voltam por `/auth/callback` com o perfil ja
 * existindo, e um `insert` cru viraria erro de chave duplicada num caminho que
 * deu certo. `id` e a PRIMARY KEY de `profiles` -- indice CHEIO, entao serve de
 * arbitro do ON CONFLICT (indice parcial nao serviria: o supabase-js nao manda
 * o predicado junto).
 *
 * `ignoreDuplicates` fica ligado de proposito: quem ja tem perfil pode ter
 * editado o nome na tela de configuracoes, e sobrescrever com o `full_name` do
 * cadastro apagaria essa edicao.
 */
export const CONFLITO_PERFIL = {
  onConflict: "id",
  ignoreDuplicates: true,
} as const;

/** So aceita string de verdade: `user_metadata` e JSON livre. */
export function nomeDoUsuario(user: UsuarioMinimo): string | null {
  const nome = user.user_metadata?.full_name;
  if (typeof nome !== "string") return null;

  const limpo = nome.trim();
  return limpo === "" ? null : limpo;
}

export function perfilDoUsuario(user: UsuarioMinimo): PerfilNovo {
  return {
    id: user.id,
    email: user.email ?? null,
    full_name: nomeDoUsuario(user),
  };
}

/**
 * O minimo de cliente Supabase que esta funcao usa -- atendido tanto pelo
 * cliente de browser quanto pelo de servidor.
 *
 * `PromiseLike` e nao `Promise` porque o builder do supabase-js e um thenable:
 * ele nao tem `catch`/`finally`, entao exigir `Promise` aqui rejeitaria os dois
 * clientes reais.
 */
export type ClienteComPerfis = {
  from(tabela: "profiles"): {
    upsert(
      valores: PerfilNovo,
      opcoes: { onConflict: string; ignoreDuplicates: boolean }
    ): PromiseLike<{ error: { message: string } | null }>;
  };
};

/**
 * Grava o perfil e devolve o erro, sem derrubar o chamador.
 *
 * Devolve em vez de engolir de proposito: foi um `console.error` solto que
 * deixou o cadastro quebrado por meses sem nenhum sintoma na tela. Quem chama
 * decide o que fazer, mas precisa receber.
 */
export async function garantirPerfil(
  supabase: ClienteComPerfis,
  user: UsuarioMinimo
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase
    .from("profiles")
    .upsert(perfilDoUsuario(user), CONFLITO_PERFIL);

  return { error };
}
