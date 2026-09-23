import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "./env";

/**
 * Um cliente so por aba, reaproveitado.
 *
 * Antes isto devolvia um cliente novo a cada chamada, e `useAuth()` chama no
 * corpo do componente -- ou seja, um GoTrueClient novo por render. O Supabase
 * ROTACIONA o refresh token: o primeiro cliente que renova invalida o token que
 * os outros ainda seguram, e o seguinte recebe "Invalid Refresh Token: Already
 * Used" e derruba a sessao. O sintoma nao e um erro na tela, e o usuario
 * voltando para a tela de login sozinho.
 */
// O tipo sai desta funcao, nao de `ReturnType<typeof createBrowserClient>`:
// `createBrowserClient` e generica, e referenciar o tipo dela direto instancia
// o parametro de schema no constraint (`string`) em vez de `"public"`. O
// cliente continua compilando, mas `.from()` passa a devolver `any` e o
// `noImplicitAny` estoura em ~20 callbacks espalhados por lib/.
const makeBrowserClient = () => {
  const { url, anonKey } = getSupabaseEnv();
  return createBrowserClient(url, anonKey);
};

let browserClient: ReturnType<typeof makeBrowserClient> | undefined;

export const createClient = () => (browserClient ??= makeBrowserClient());
