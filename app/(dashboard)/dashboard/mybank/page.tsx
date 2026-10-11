import { redirect } from "next/navigation";

import { createClient } from "@/utils/supabase/server";
import { PainelDoMyBank } from "@/components/mybank/PainelDoMyBank";

// ---------------------------------------------------------------------------
// /dashboard/mybank -- HMO-371 (F3 da HMO-368)
// ---------------------------------------------------------------------------
// SEM GATE DE PLANO. E a Decisao 5 da HMO-368: quem tem conta de investimento
// tem MyBank. Nao ha `<PlanGuard>`, `requiredFeature` nem `requiredPlans` em
// lugar nenhum desta feature -- o item do menu tambem nao declara nenhum.
//
// SERVER COMPONENT, E O QUE ELE FAZ E UMA COISA SO: o `user.id`.
//
// Ele existe porque o painel precisa saber QUEM esta olhando para resolver o
// outro lado de cada linha de `user_connections` -- a tabela guarda
// `requester_id` e `requested_id`, e "a outra pessoa" nao e derivavel sem o meu
// id. As alternativas eram piores: um `createClient()` do cliente dentro do
// painel arrastaria o supabase-js para dentro da sonda de navegador, e inventar
// um campo `eu` na resposta de `/api/mybank/loans` poria identidade numa rota de
// emprestimo.
//
// `redirect` E NAO `notFound()`: esta tela nao e secreta, ela so precisa de
// sessao -- e `notFound()` em server component devolve 200 com a pagina de erro,
// que para um robo de medicao parece a tela tendo carregado. Quem nao esta
// logado vai para o login, que e o que o middleware faria um instante depois.
// ---------------------------------------------------------------------------
export const dynamic = "force-dynamic";

export default async function MyBankPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <PainelDoMyBank meuId={user.id} />;
}
