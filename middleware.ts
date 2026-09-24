import { resolveSession } from "@/utils/supabase/middleware";
import { NextResponse, type NextRequest } from "next/server";

// Telas que so admin pode alcancar. Prefixo, nao igualdade, para que uma
// subrota futura (`/dashboard/migrations/<algo>`) nasca protegida em vez de
// nascer aberta e depender de alguem lembrar de vir aqui.
//
// `/dashboard/admin` nao esta na lista de proposito: ela nao renderiza dado
// real -- os numeros sao mock hardcoded -- e e protegida no cliente pelo
// `<PlanGuard>`, como o resto do app. Quando ganhar dados de verdade, entra
// aqui e passa a consumir rota com `requireAdmin()`.
const ADMIN_ONLY_PATHS = ["/dashboard/migrations"];

function isAdminOnly(pathname: string) {
  return ADMIN_ONLY_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

export async function middleware(request: NextRequest) {
  const { response, supabase, user } = await resolveSession(request);

  if (!isAdminOnly(request.nextUrl.pathname)) {
    return response;
  }

  // A guarda vive aqui, e nao so no Server Component da pagina, por causa do
  // status: dentro da pagina o Next ja comecou a transmitir quando `notFound()`
  // roda, entao o corpo sai 404 e o status sai 200 -- e um scanner de rota le
  // 200 como "existe e esta aberta". A da pagina continua no lugar: se alguem
  // mexer no `matcher` abaixo, o conteudo segue protegido.
  let isAdmin = false;

  if (user) {
    const { data } = await supabase
      .from("user_subscriptions")
      .select("plan")
      .eq("user_id", user.id)
      .maybeSingle();

    isAdmin = data?.plan === "admin";
  }

  if (!isAdmin) {
    // Reescreve para a rota interna de 404 do App Router: para quem nao e
    // admin a tela simplesmente nao existe, com o mesmo corpo e o mesmo status
    // de qualquer URL inventada. Redirecionar para /dashboard denunciaria que
    // ha algo ali.
    return NextResponse.rewrite(new URL("/_not-found", request.url), {
      status: 404,
    });
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
