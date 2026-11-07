/**
 * Para onde o login manda depois de entrar (`/login?next=...`). Hoje quem usa
 * e a autorizacao do Claude (`/conectar-claude`), que precisa voltar para a
 * mesma tela depois do login.
 *
 * So caminho DENTRO do app: um `?next=https://outro.site` ou `//outro.site`
 * viraria redirecionamento aberto -- a tela de login do Pulo do Gato mandando
 * a pessoa para um site falso.
 *
 * Arquivo proprio, sem nada de `node:`: a tela de login roda no navegador.
 */
export function destinoDepoisDoLogin(next: string | null | undefined): string {
  if (typeof next !== "string") return "/dashboard";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/dashboard";
  }
  return next;
}
