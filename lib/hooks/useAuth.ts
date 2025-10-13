"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import type { User } from "@supabase/supabase-js";

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
        data: {
          full_name: fullName,
        },
      },
    });

    // Se o usuário foi criado com sucesso e não há confirmação pendente
    if (data.user && !error) {
      // Criar perfil na tabela profiles
      const { error: profileError } = await supabase.from("profiles").insert({
        id: data.user.id,
        full_name: fullName,
      });

      if (profileError) {
        console.error("Erro ao criar perfil:", profileError);
      }
    }

    return { error };
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
