"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import type { User } from "@supabase/supabase-js";
import { garantirPerfil } from "@/lib/ensure-profile";
import { decidirPosCadastro } from "@/lib/signup-outcome";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const getUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);
      setLoading(false);
    };

    getUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [supabase.auth]);

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error("Auth error:", error);

        // Provide more user-friendly error messages
        if (error.message.includes("Invalid login credentials")) {
          return { error: { ...error, message: "Email ou senha incorretos" } };
        } else if (error.message.includes("Email not confirmed")) {
          return {
            error: {
              ...error,
              message: "Por favor, confirme seu email antes de fazer login",
            },
          };
        } else if (
          error.message.includes("fetch failed") ||
          error.message.includes("ENOTFOUND")
        ) {
          return {
            error: {
              ...error,
              message:
                "Erro de conexão com o banco de dados. Verifique sua internet.",
            },
          };
        } else if (error.message.includes("Database error")) {
          return {
            error: {
              ...error,
              message:
                "Erro no banco de dados. O sistema pode não estar configurado corretamente.",
            },
          };
        }
      }

      return { error };
    } catch (err) {
      console.error("Sign in error:", err);
      return {
        error: {
          message: "Erro inesperado durante o login. Tente novamente.",
          cause: err instanceof Error ? err.message : "Unknown error",
        },
      };
    }
  };

  const signUp = async (email: string, password: string, fullName?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Sem isto o link de confirmacao usa o "Site URL" do projeto Supabase,
        // que e um valor unico para todos os ambientes: o cadastro feito num
        // dominio manda o email apontando para OUTRO. Em 22/09 esse campo
        // estava preenchido com o hostname de uma aplicacao de terceiros, ou
        // seja o link de confirmacao -- com o token na URL -- saia deste site.
        // `window.location.origin` faz o link voltar para o dominio em que a
        // pessoa se cadastrou, seja ele o de producao ou um preview.
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          full_name: fullName,
        },
      },
    });

    if (error) return { error, resultado: null };

    // A partir daqui o cadastro pode terminar de DOIS jeitos, e quem escolhe e
    // `mailer_autoconfirm`, um botao do dashboard do Supabase:
    //
    // - confirmacao ligada  -> `session` vem null. O perfil nao pode nascer
    //   agora: a policy `profiles_insert_own` e `TO authenticated` e o insert
    //   rodaria como `anon`. Ele nasce em `/auth/callback`.
    // - confirmacao desligada -> `session` vem preenchida, e NINGUEM vai passar
    //   por `/auth/callback`. Se o perfil nao nascer aqui, nao nasce em lugar
    //   nenhum -- e sem perfil o `create_user_subscription_trigger` nao dispara
    //   e a conta fica sem assinatura.
    const resultado = decidirPosCadastro(data.session);

    if (resultado.kind === "logado" && data.user) {
      // Agora ha sessao de verdade, entao este cliente fala como
      // `authenticated` e a RLS aceita o insert.
      const { error: erroPerfil } = await garantirPerfil(supabase, data.user);

      if (erroPerfil) {
        // A conta existe e a sessao vale -- barrar a entrada aqui seria pior.
        // Mas isto tem que aparecer: sem perfil nao ha assinatura.
        console.error("Falha ao criar o perfil no cadastro:", erroPerfil);
      }
    }

    return { error: null, resultado };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  };

  return {
    user,
    loading,
    signIn,
    signUp,
    signOut,
  };
}
