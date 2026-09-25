import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { decidirCallback } from "@/lib/auth-callback";

/**
 * O retorno do link de email: troca o `code`/`token_hash` por sessao e cria o
 * perfil.
 *
 * A criacao do perfil vive AQUI, e nao no `signUp` do cliente, por causa da
 * RLS. A policy `profiles_insert_own` (migration 002) e `FOR INSERT TO
 * authenticated WITH CHECK (id = auth.uid())`. Quando a confirmacao de email
 * esta ligada -- o padrao do Supabase -- o `signUp` devolve `data.user` mas
 * NAO devolve sessao: o insert que o cliente tentava logo depois rodava como
 * `anon` e a RLS o recusava. O codigo antigo so fazia `console.error`, entao o
 * cadastro parecia ter dado certo e o usuario ficava sem perfil para sempre.
 *
 * E nao e so o perfil que se perdia: `create_user_subscription_trigger` dispara
 * AFTER INSERT ON profiles, ou seja a assinatura gratuita tambem nunca nascia.
 * Em producao isto era visivel em 25/09 -- `user_subscriptions.n_tup_ins = 0`,
 * nenhuma assinatura criada desde que o banco existe.
 *
 * Depois da troca ha sessao de verdade, o insert roda como `authenticated`, a
 * policy passa e o trigger dispara.
 */
export async function GET(request: NextRequest) {
  const acao = decidirCallback(request.nextUrl.searchParams);
  const origem = request.nextUrl.origin;

  if (acao.kind === "erro") {
    return redirecionarComErro(origem, acao.mensagem);
  }

  const supabase = createClient();

  const { error } =
    acao.kind === "code"
      ? await supabase.auth.exchangeCodeForSession(acao.code)
      : await supabase.auth.verifyOtp({
          token_hash: acao.tokenHash,
          type: acao.type,
        });

  if (error) {
    return redirecionarComErro(origem, error.message);
  }

  await garantirPerfil(supabase);

  return NextResponse.redirect(new URL(acao.next, origem));
}

function redirecionarComErro(origem: string, mensagem: string) {
  const destino = new URL("/login", origem);
  destino.searchParams.set("message", mensagem);
  return NextResponse.redirect(destino);
}

/**
 * Cria o perfil do usuario recem-confirmado, se ainda nao existir.
 *
 * `upsert` com `onConflict: "id"` porque esta rota e chamada de novo em toda
 * troca de senha e em todo magic link: na segunda visita o perfil ja existe, e
 * um `insert` cru viraria erro de chave duplicada num caminho que deu certo.
 * `id` e a PRIMARY KEY de profiles -- indice cheio, entao serve de arbitro do
 * ON CONFLICT (indice parcial nao serviria: o supabase-js nao manda o
 * predicado).
 *
 * `ignoreDuplicates` fica ligado de proposito: quem ja tem perfil pode ter
 * editado o nome na tela de configuracoes, e sobrescrever com o `full_name` que
 * veio do cadastro apagaria essa edicao.
 */
async function garantirPerfil(supabase: ReturnType<typeof createClient>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      email: user.email ?? null,
      // O nome vem do `options.data` do signUp, o unico lugar onde ele existe
      // antes do perfil.
      full_name:
        (user.user_metadata?.full_name as string | undefined) ?? null,
    },
    { onConflict: "id", ignoreDuplicates: true }
  );

  if (error) {
    // Nao derruba o login por causa disto: a sessao ja e valida e o usuario
    // consegue usar o app. Mas precisa aparecer no log -- foi exatamente um
    // `console.error` engolido que deixou o cadastro quebrado sem sintoma.
    console.error("Falha ao criar o perfil no callback de auth:", error);
  }
}
