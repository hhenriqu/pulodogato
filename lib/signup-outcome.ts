/**
 * O que fazer depois de `signUp`, decidido pelo que o Supabase devolveu.
 *
 * Por que isto e uma decisao e nao uma constante (HMO-157): se o cadastro
 * termina com o usuario logado ou esperando um email depende de
 * `mailer_autoconfirm`, que e um botao do DASHBOARD do Supabase -- fora deste
 * repositorio. A tela antiga assumia SEMPRE "confirme seu email": com a
 * confirmacao desligada o usuario saia dali logado, mas lendo um pedido para
 * abrir um email que nunca seria enviado, e era despachado para `/login`.
 *
 * O sinal confiavel e a sessao. Com confirmacao ligada, `signUp` devolve
 * `user` e `session: null`; com ela desligada, devolve as duas coisas. Ler a
 * sessao faz a tela acompanhar o botao do dashboard sozinha, nos dois sentidos,
 * sem ninguem precisar lembrar de mexer no codigo depois de virar a chave.
 */

/** Para onde vai quem ja saiu do cadastro com sessao valida. */
export const DESTINO_LOGADO = "/dashboard";

/** O aviso de quem ainda precisa abrir o email, mostrado na tela de login. */
export const MENSAGEM_CONFIRMACAO =
  "Verifique seu email para ativar a conta";

/**
 * Sessao vista de fora do supabase-js: interessa uma coisa so, se ha um usuario
 * identificado nela.
 */
export type SessaoMinima = {
  user?: { id?: string | null } | null;
} | null;

export type ResultadoCadastro =
  /**
   * Ja esta logado. Quem decide isto tambem assume a criacao do perfil: este e
   * o unico momento em que esse cadastro tem sessao e ninguem vai passar por
   * `/auth/callback`.
   *
   * `destino` e o tipo literal, e nao `string`, porque o `typedRoutes` do Next
   * exige uma rota que ele conheca: com `string` o `router.push` nao compila.
   */
  | { kind: "logado"; destino: typeof DESTINO_LOGADO; criarPerfil: true }
  /** Falta o email. O perfil nasce depois, no retorno do link. */
  | { kind: "confirmar"; mensagem: string };

/**
 * Uma sessao so serve para o proximo passo se tiver usuario com `id`.
 *
 * Nao e purismo defensivo: o passo seguinte e inserir em `profiles`, e a policy
 * `profiles_insert_own` compara `id = auth.uid()`. Sessao sem usuario nao
 * levanta `auth.uid()`, entao tratar isso como "logado" trocaria a tela de
 * confirmacao por um insert que a RLS recusa -- exatamente a falha silenciosa
 * que esta issue existe para fechar.
 */
export function temSessaoUtil(sessao: SessaoMinima): boolean {
  const id = sessao?.user?.id;
  return typeof id === "string" && id !== "";
}

export function decidirPosCadastro(sessao: SessaoMinima): ResultadoCadastro {
  if (temSessaoUtil(sessao)) {
    return { kind: "logado", destino: DESTINO_LOGADO, criarPerfil: true };
  }

  return { kind: "confirmar", mensagem: MENSAGEM_CONFIRMACAO };
}
