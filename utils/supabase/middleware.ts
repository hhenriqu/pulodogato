import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "./env";

/**
 * Renova a sessao a cada request e devolve os cookies renovados na resposta.
 *
 * Usa `getAll`/`setAll` de proposito. A API antiga (`get`/`set`/`remove`) grava
 * um cookie por vez, e a sessao do Supabase quase nunca e um cookie so: quando
 * o JWT passa de ~3.6 KB ele e quebrado em `sb-<ref>-auth-token.0`, `.1`, ...
 * Com a API antiga so da para responder um `NextResponse` por chamada, e a
 * gravacao seguinte descartava a anterior -- sobrava o ultimo pedaco, o token
 * remontado nao decodificava, e o usuario era deslogado no proximo clique sem
 * nenhum erro aparecer. Com `setAll` os pedacos saem todos na MESMA resposta.
 */
export async function updateSession(request: NextRequest) {
  const { response } = await resolveSession(request);
  return response;
}

/**
 * Faz o mesmo que `updateSession` e ainda devolve o client e o usuario, para
 * quem precisa decidir algo no middleware -- hoje, a guarda de rota de admin.
 *
 * Existe separada porque a decisao tem que sair ANTES da renderizacao. Guardar
 * a pagina dentro do Server Component protege o conteudo, mas o Next ja comecou
 * a transmitir a resposta quando `notFound()` roda: o corpo sai como 404 e o
 * status sai 200. Aqui ainda nao ha byte enviado, entao o status e honesto.
 */
export async function resolveSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const { url, anonKey } = getSupabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Primeiro no request, para que o resto deste mesmo request ja leia a
        // sessao renovada em vez da que acabou de expirar.
        cookiesToSet.forEach(({ name, value, options }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // Nao remover: e esta chamada que renova o token. Sem ela a sessao expira no
  // prazo do access token (1h por padrao) mesmo com o refresh token valido.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // `response` so e reatribuido dentro de `setAll`, que `getUser()` ja disparou
  // se havia token a renovar -- entao aqui ele ja e o definitivo.
  return { response, supabase, user };
}
