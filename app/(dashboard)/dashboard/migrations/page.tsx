import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import MigrationsClient from "./MigrationsClient";

// Server Component de proposito (HMO-150). Esta tela nao tinha guarda nenhuma:
// nao estava no menu -- nem para admin -- e quem digitasse a URL entrava. O
// resto do app protege pagina no cliente (`<PlanGuard>`), o que aqui seria
// apenas mais um verniz: o bundle desce igual e a decisao acontece na maquina
// de quem esta tentando entrar. Como esta rota descreve o estado do banco, a
// checagem roda no servidor, antes de qualquer HTML sair.
//
// `notFound()` em vez de "acesso negado": para quem nao e admin a tela nao
// existe. Uma negativa explicita confirmaria que ha algo em
// `/dashboard/migrations` -- e o 403 da API ja diz o que precisa ser dito a
// quem tem motivo para perguntar.
export const dynamic = "force-dynamic";

export default async function MigrationsPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    notFound();
  }

  const { data: subscription } = await supabase
    .from("user_subscriptions")
    .select("plan")
    .eq("user_id", user.id)
    .maybeSingle();

  if (subscription?.plan !== "admin") {
    notFound();
  }

  return <MigrationsClient />;
}
