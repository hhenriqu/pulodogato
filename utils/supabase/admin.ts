import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";

/**
 * Checagem de papel de administrador NO SERVIDOR.
 *
 * Ate a HMO-150 isto nao existia: o unico `isAdmin` do projeto era o do hook
 * `lib/hooks/useSubscription.ts`, que roda no navegador. Esconder o item do
 * menu e renderizar `<PlanGuard>` nao protege nada -- quem digita a URL baixa o
 * mesmo bundle, e um GET direto em `/api/...` nao passa por componente algum.
 *
 * A fonte da verdade e a mesma que o hook usa (`user_subscriptions.plan`), de
 * proposito: se as duas divergissem, a tela e a rota discordariam sobre quem e
 * admin. O que muda e ONDE a resposta e produzida.
 *
 * O client de `utils/supabase/server` usa a anon key mais o cookie de sessao,
 * entao a consulta roda como `authenticated` com o JWT do proprio usuario e a
 * RLS se aplica: a policy `user_subscriptions_select` (`user_id = auth.uid()`)
 * so devolve a linha dele. Nao ha service-role key aqui -- ninguem le o plano
 * alheio nem por acidente.
 */

export type AdminCheck =
  | { ok: true; user: User }
  | { ok: false; response: NextResponse };

export async function requireAdmin(): Promise<AdminCheck> {
  const supabase = createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Usuário não autenticado" },
        { status: 401 }
      ),
    };
  }

  const { data: subscription, error } = await supabase
    .from("user_subscriptions")
    .select("plan")
    .eq("user_id", user.id)
    .maybeSingle();

  // Falha fechada. `maybeSingle` devolve `null` sem erro quando nao ha linha
  // (usuario sem assinatura), e qualquer erro de verdade aqui -- rede, RLS,
  // tabela ausente -- tambem cai no negado. Um catch que deixasse passar
  // transformaria indisponibilidade do banco em acesso liberado.
  if (error || subscription?.plan !== "admin") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Acesso restrito a administradores" },
        { status: 403 }
      ),
    };
  }

  return { ok: true, user };
}
