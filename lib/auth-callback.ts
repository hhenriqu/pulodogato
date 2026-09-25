/**
 * A decisao da rota `/auth/callback`, separada do IO para poder ser testada.
 *
 * Por que a rota existe (HMO-157): o `signUp` do cliente e o
 * `resetPasswordForEmail` mandam o usuario para o email, e o link de volta NAO
 * traz sessao pronta -- traz um `code` (PKCE) ou um `token_hash`, que alguem
 * precisa trocar por sessao. Sem esta rota o usuario clicava no link de
 * confirmacao, caia numa pagina qualquer com `?code=...` na URL, ninguem
 * trocava nada, e a tela dizia "faca login" para uma conta que ele acabou de
 * confirmar. Nao havia erro em lugar nenhum: o cadastro simplesmente nao
 * terminava.
 *
 * O `@supabase/ssr` usa PKCE por padrao, e o verificador do PKCE vive num
 * COOKIE. Por isso a troca tem que acontecer no servidor, no mesmo browser que
 * comecou o cadastro -- nao da para fazer no cliente depois de um redirect de
 * dominio, nem numa aba diferente.
 */

/** Para onde mandar quem chega sem `next` -- a tela inicial de quem esta logado. */
export const DESTINO_PADRAO = "/dashboard";

/**
 * Os `type` que o Supabase manda no link de email. Lista fechada de proposito:
 * o valor vai direto para `verifyOtp`, e repassar string arbitraria do
 * querystring para a biblioteca e passar a decisao para quem montou a URL.
 */
const TIPOS_OTP = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
] as const;

export type TipoOtp = (typeof TIPOS_OTP)[number];

export type AcaoCallback =
  | { kind: "code"; code: string; next: string }
  | { kind: "otp"; tokenHash: string; type: TipoOtp; next: string }
  | { kind: "erro"; mensagem: string };

/**
 * O caminho de destino, aceito so quando e relativo a este site.
 *
 * `next` vem do querystring, ou seja de quem monta o link -- inclusive de quem
 * manda o link por email para outra pessoa. Sem esta peneira, um
 * `/auth/callback?next=https://outro-site/` faria o NOSSO dominio despachar o
 * usuario para fora logo depois de logar, o que e um redirect aberto com cara
 * de link legitimo.
 *
 * Os casos que nao sao obvios:
 * - `//outro-site` e uma URL protocolo-relativa: o browser resolve como host
 *   externo, mesmo comecando com barra.
 * - `/\outro-site` (barra + contrabarra) o browser normaliza para `//`, entao
 *   vale a mesma regra.
 * - `\\outro-site` idem, sem barra nenhuma na frente.
 */
export function caminhoSeguro(next: string | null | undefined): string {
  if (!next) return DESTINO_PADRAO;

  // Contrabarra virando barra: e o que o browser faz, e o que a comparacao
  // abaixo precisa ver para nao ser enganada.
  const normalizado = next.replace(/\\/g, "/");

  if (!normalizado.startsWith("/")) return DESTINO_PADRAO;
  if (normalizado.startsWith("//")) return DESTINO_PADRAO;

  // Caractere de controle (CR/LF inclusive) nunca aparece em caminho legitimo e
  // e material de injecao de header.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(normalizado)) return DESTINO_PADRAO;

  return normalizado;
}

/**
 * Traduz o erro que o Supabase devolve no querystring.
 *
 * O caso que importa e o link expirado: sem traducao a tela mostraria
 * `otp_expired`, e o usuario nao tem como saber que basta pedir outro link.
 */
export function mensagemDeErro(
  codigo: string | null | undefined,
  descricao: string | null | undefined
): string {
  const chave = (codigo ?? "").toLowerCase();

  if (chave === "otp_expired" || chave === "access_denied") {
    return "O link expirou ou ja foi usado. Peca um novo para continuar.";
  }

  if (descricao && descricao.trim() !== "") {
    // A descricao do Supabase vem com `+` no lugar de espaco em alguns casos;
    // quem le a tela nao tem nada a ver com isso.
    return descricao.replace(/\+/g, " ");
  }

  return "Nao foi possivel confirmar o link. Tente entrar novamente.";
}

/** O que a rota deve fazer com os parametros que chegaram. */
export function decidirCallback(params: URLSearchParams): AcaoCallback {
  const erro = params.get("error") ?? params.get("error_code");
  if (erro) {
    return {
      kind: "erro",
      mensagem: mensagemDeErro(
        params.get("error_code") ?? params.get("error"),
        params.get("error_description")
      ),
    };
  }

  const next = caminhoSeguro(params.get("next"));

  const code = params.get("code");
  if (code) return { kind: "code", code, next };

  // O template de email mais novo do Supabase manda `token_hash` + `type` em
  // vez de `code`. Os dois formatos chegam aqui porque o template e editavel no
  // dashboard: tratar so um dos dois deixaria o cadastro na mao de uma
  // configuracao que este repositorio nao controla.
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  if (tokenHash && type && (TIPOS_OTP as readonly string[]).includes(type)) {
    return { kind: "otp", tokenHash, type: type as TipoOtp, next };
  }

  return {
    kind: "erro",
    mensagem: "Link de confirmacao incompleto. Peca um novo para continuar.",
  };
}
