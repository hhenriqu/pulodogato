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
 * O que a pessoa le quando a conta nasceu mas o perfil nao.
 *
 * Nao adianta oferecer "tente de novo": o email ja esta tomado em
 * `auth.users`, entao repetir o cadastro devolve "usuario ja existe" e a conta
 * continua quebrada. Entrar pelo login tambem nao resolve -- o
 * `signInWithPassword` nao passa por lugar nenhum que crie perfil. Por isso a
 * mensagem admite o estado em vez de prometer um conserto que nao existe, e
 * carrega o erro do banco junto: e ele que diz o que quebrou desta vez.
 */
export const MENSAGEM_PERFIL_INCOMPLETO =
  "Sua conta foi criada, mas não conseguimos preparar seu perfil. Não é possível continuar assim — fale com o suporte informando o erro abaixo.";

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
  /**
   * A conta nasceu e a sessao vale, mas a gravacao do perfil falhou.
   *
   * Este caso existe para nao ter `destino`: enquanto ele era so um
   * `console.error`, o cadastro seguia para `/dashboard` como se nada tivesse
   * acontecido e a pessoa ficava com uma conta sem perfil, sem assinatura e
   * sem limites de uso -- exatamente o estrago que o HMO-126 foi criado para
   * reparar. Sem `destino` no tipo, a tela nao tem para onde despachar: o
   * `router.push` nem compila neste ramo.
   */
  | { kind: "perfil-incompleto"; mensagem: string; detalhe: string }
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

/** O erro do supabase-js visto de fora: so a mensagem interessa. */
export type ErroDePerfil = { message?: string | null } | null | undefined;

/**
 * O texto tecnico que acompanha o aviso na tela.
 *
 * Um erro sem mensagem util ainda precisa virar alguma coisa legivel: cair
 * para string vazia devolveria um aviso pela metade, que e de novo uma falha
 * sem sintoma.
 */
export const DETALHE_SEM_MENSAGEM = "o banco recusou a gravacao sem explicar o motivo";

export function detalheDoErroDePerfil(erro: ErroDePerfil): string {
  const mensagem = typeof erro?.message === "string" ? erro.message.trim() : "";
  return mensagem === "" ? DETALHE_SEM_MENSAGEM : mensagem;
}

/**
 * A segunda metade da decisao: o que sobra do cadastro depois de tentar gravar
 * o perfil.
 *
 * Fica separada de `decidirPosCadastro` porque as duas acontecem em momentos
 * diferentes -- entre uma e outra ha uma ida ao banco. E fica aqui, e nao
 * dentro do `useAuth`, porque a regra que importa ("perfil falhou => NAO
 * despacha para o dashboard") e justamente a que ninguem testava quando ela
 * morava num `if` solto no meio do hook.
 *
 * `erroPerfil` nulo devolve o resultado intacto: o caminho feliz nao muda.
 */
export function resultadoAposPerfil(
  resultado: ResultadoCadastro,
  erroPerfil: ErroDePerfil
): ResultadoCadastro {
  // Quem ainda vai confirmar o email nem tentou gravar perfil -- o dele nasce
  // depois, em `/auth/callback`. Trocar a tela dele por um aviso de falha
  // mentiria sobre o que aconteceu.
  if (resultado.kind !== "logado") return resultado;
  if (!erroPerfil) return resultado;

  return {
    kind: "perfil-incompleto",
    mensagem: MENSAGEM_PERFIL_INCOMPLETO,
    detalhe: detalheDoErroDePerfil(erroPerfil),
  };
}
