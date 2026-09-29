// -----------------------------------------------------------------------------
// A MOEDA OFICIAL DO USUARIO (HMO-171, parte 2)
// -----------------------------------------------------------------------------
// Le e grava `profiles.preferences.moeda`. Mesma coluna jsonb que o painel
// (HMO-159) usa, e pela mesma razao: ela ja existe em producao, e uma tabela
// nova para guardar duas chaves custaria uma migration e um passo manual do
// Helio no SQL Editor.
//
// Ver lib/moeda.ts para o que cada chave significa e por que a leitura e
// tolerante enquanto a escrita recusa.
//
// O CUIDADO QUE ESTA ROTA TEM QUE TER: NAO APAGAR O RESTO
// ------------------------------------------------------
// `preferences` nao e "as configuracoes de moeda": e o jsonb inteiro do perfil
// -- painel, notificacoes, privacidade. Um PUT que escrevesse `{ moeda: ... }`
// direto na coluna apagaria tudo isso em silencio: a moeda passaria a funcionar
// exatamente como o usuario pediu, enquanto o layout do painel voltava ao padrao
// sem nenhuma mensagem. Quem mescla e `mesclarPreferenciaDeMoeda`, e ha teste
// para os dois niveis (o jsonb e o bloco de moeda).
// -----------------------------------------------------------------------------

import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import {
  PREFERENCIA_DE_MOEDA_PADRAO,
  lerPreferenciaDeMoeda,
  mesclarPreferenciaDeMoeda,
  opcoesDeMoeda,
  validarPreferenciaDeMoeda,
} from "@/lib/moeda";

export const dynamic = "force-dynamic";

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
    console.error("Erro ao ler a preferência de moeda:", error);
    return NextResponse.json(
      { error: "Não foi possível ler as suas configurações" },
      { status: 500 }
    );
  }

  // Perfil ausente NAO e erro: esta rota pode ser a primeira a rodar numa conta
  // antiga. O padrao e a resposta certa -- a pessoa ve BRL e o seletor por
  // lancamento desligado, que e como o app se comportava antes desta issue.
  return NextResponse.json({
    moeda: profile
      ? lerPreferenciaDeMoeda(profile.preferences)
      : { ...PREFERENCIA_DE_MOEDA_PADRAO },
    opcoes: opcoesDeMoeda(),
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

  const validado = validarPreferenciaDeMoeda(body);
  if (!validado.ok) {
    return NextResponse.json({ error: validado.erro }, { status: 400 });
  }

  const { data: profile, error: leituraErro } = await supabase
    .from("profiles")
    .select("preferences")
    .eq("id", user.id)
    .maybeSingle();

  if (leituraErro) {
    console.error(
      "Erro ao ler o perfil antes de gravar a moeda:",
      leituraErro
    );
    return NextResponse.json(
      { error: "Não foi possível salvar as suas configurações" },
      { status: 500 }
    );
  }

  if (!profile) {
    return NextResponse.json({ error: "Perfil não encontrado" }, { status: 404 });
  }

  const { error: escritaErro } = await supabase
    .from("profiles")
    .update({
      preferences: mesclarPreferenciaDeMoeda(profile.preferences, validado.valor),
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (escritaErro) {
    console.error("Erro ao gravar a preferência de moeda:", escritaErro);
    return NextResponse.json(
      { error: "Não foi possível salvar as suas configurações" },
      { status: 500 }
    );
  }

  // Devolve o que ficou gravado, e nao o que veio no corpo: a tela usa isto para
  // se redesenhar, e ecoar a entrada esconderia qualquer normalizacao (" usd "
  // virou "USD") -- a tela mostraria um estado que o banco nao tem.
  return NextResponse.json({ moeda: validado.valor });
}
