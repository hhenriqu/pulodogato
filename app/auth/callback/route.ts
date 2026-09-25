import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { decidirCallback } from "@/lib/auth-callback";
import { garantirPerfil } from "@/lib/ensure-profile";

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

  await criarPerfilDaSessao(supabase);

  return NextResponse.redirect(new URL(acao.next, origem));
}

function redirecionarComErro(origem: string, mensagem: string) {
  const destino = new URL("/login", origem);
  destino.searchParams.set("message", mensagem);
  return NextResponse.redirect(destino);
}

/**
 * Cria o perfil de quem acabou de confirmar o link, se ainda nao existir.
 *
 * A regra do upsert vive em `lib/ensure-profile.ts` porque o cadastro com a
 * confirmacao de email DESLIGADA nunca passa por aqui e precisa da mesma
 * gravacao.
 */
async function criarPerfilDaSessao(supabase: ReturnType<typeof createClient>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  const { error } = await garantirPerfil(supabase, user);

  if (error) {
    // Nao derruba o login por causa disto: a sessao ja e valida e o usuario
    // consegue usar o app. Mas precisa aparecer no log -- foi exatamente um
    // `console.error` engolido que deixou o cadastro quebrado sem sintoma.
    console.error("Falha ao criar o perfil no callback de auth:", error);
  }
}
