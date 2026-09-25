// -----------------------------------------------------------------------------
// A PREFERENCIA DE PAINEL DO USUARIO (HMO-159)
// -----------------------------------------------------------------------------
// Le e grava `profiles.preferences.dashboard.layout`. Ver lib/dashboard-layout
// para por que a preferencia mora num jsonb que ja existe em producao em vez
// de numa tabela nova.
//
// O CUIDADO QUE ESTA ROTA TEM QUE TER: NAO APAGAR O RESTO
// ------------------------------------------------------
// `preferences` nao e "as configuracoes do painel": e o jsonb inteiro do
// perfil -- moeda, fuso, notificacoes, privacidade. Um PUT que escrevesse
// `{ dashboard: { layout } }` direto na coluna apagaria tudo isso, e apagaria
// em silencio: o painel passaria a funcionar exatamente como o usuario pediu,
// enquanto as preferencias de notificacao voltavam ao padrao sem nenhuma
// mensagem. Por isso o PUT le o objeto atual antes de escrever e mescla.
// -----------------------------------------------------------------------------

import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import {
  layoutPadrao,
  normalizarLayout,
  SECOES_DO_PAINEL,
} from "@/lib/dashboard-layout";

export const dynamic = "force-dynamic";

/** Extrai `preferences.dashboard.layout` sem assumir que o caminho existe. */
function layoutDentroDe(preferences: unknown): unknown {
  if (typeof preferences !== "object" || preferences === null) return null;
  const dashboard = (preferences as Record<string, unknown>).dashboard;
  if (typeof dashboard !== "object" || dashboard === null) return null;
  return (dashboard as Record<string, unknown>).layout ?? null;
}

export async function GET() {
  const supabase = createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("preferences")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Erro ao ler as preferências do painel:", error);
    return NextResponse.json(
      { error: "Não foi possível ler as suas configurações" },
      { status: 500 }
    );
  }

  // Perfil ausente NAO e erro aqui: o cadastro cria o perfil, mas esta rota
  // pode ser a primeira a rodar numa conta antiga. Responder com o padrao e a
  // resposta certa -- o usuario ve o painel de fabrica, e o primeiro PUT cria
  // a chave.
  return NextResponse.json({
    layout: profile
      ? normalizarLayout(layoutDentroDe(profile.preferences))
      : layoutPadrao(),
    secoes: SECOES_DO_PAINEL,
  });
}

export async function PUT(request: Request) {
  const supabase = createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido" }, { status: 400 });
  }

  const recebido = (body as { layout?: unknown } | null)?.layout;

  // Sem `layout` no corpo, `normalizarLayout` devolveria o padrao e a rota
  // gravaria isso como se fosse escolha do usuario -- um bug de cliente viraria
  // "as configuracoes dele voltaram ao padrao sozinhas". Melhor recusar.
  if (!Array.isArray(recebido)) {
    return NextResponse.json(
      { error: "Envie `layout` como uma lista de seções" },
      { status: 400 }
    );
  }

  const layout = normalizarLayout(recebido);

  const { data: profile, error: leituraErro } = await supabase
    .from("profiles")
    .select("preferences")
    .eq("id", user.id)
    .maybeSingle();

  if (leituraErro) {
    console.error(
      "Erro ao ler o perfil antes de gravar o painel:",
      leituraErro
    );
    return NextResponse.json(
      { error: "Não foi possível salvar as suas configurações" },
      { status: 500 }
    );
  }

  if (!profile) {
    return NextResponse.json(
      { error: "Perfil não encontrado" },
      { status: 404 }
    );
  }

  const preferencesAtuais =
    typeof profile.preferences === "object" && profile.preferences !== null
      ? (profile.preferences as Record<string, unknown>)
      : {};

  const dashboardAtual =
    typeof preferencesAtuais.dashboard === "object" &&
    preferencesAtuais.dashboard !== null
      ? (preferencesAtuais.dashboard as Record<string, unknown>)
      : {};

  const { error: escritaErro } = await supabase
    .from("profiles")
    .update({
      preferences: {
        ...preferencesAtuais,
        dashboard: { ...dashboardAtual, layout },
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (escritaErro) {
    console.error("Erro ao gravar as preferências do painel:", escritaErro);
    return NextResponse.json(
      { error: "Não foi possível salvar as suas configurações" },
      { status: 500 }
    );
  }

  return NextResponse.json({ layout });
}
