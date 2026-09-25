"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import type { User } from "@supabase/supabase-js";
import { garantirPerfil } from "@/lib/ensure-profile";
import { decidirPosCadastro } from "@/lib/signup-outcome";
import {
  decidirSessao,
  classificarFalhaDeAuth,
  expiracaoEmMs,
  lembrarSessao,
  lerSessaoLembrada,
  esquecerSessao,
} from "@/lib/offline-session";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * `offline` quer dizer: ninguem confirmou esta sessao agora, estamos indo
   * pelo que o aparelho lembra. A interface usa isto para avisar que os
   * numeros podem estar velhos -- ver `components/OfflineBanner.tsx`.
   */
  const [modo, setModo] = useState<"online" | "offline">("online");
  const supabase = createClient();

  useEffect(() => {
    // -----------------------------------------------------------------------
    // ESTE BLOCO E O CONSERTO DO "FICAR SEM SINAL DESLOGA"
    // -----------------------------------------------------------------------
    // `getUser()` SEMPRE vai na rede -- e para isso que ele existe, confirmar
    // o token com o servidor em vez de confiar no aparelho. Antes, a falha
    // dele virava `user = null`, e `user = null` faz o layout do dashboard
    // empurrar para /login. Sem rede, /login nao tem como funcionar: a pessoa
    // ficava presa numa tela de login inutilizavel, com o app instalado.
    //
    // Agora a falha e classificada antes de virar decisao: rede e uma coisa,
    // servidor dizendo "nao" e outra. A tabela de casos esta em
    // `lib/offline-session.ts`, fora do React, que e onde da para testa-la.
    // -----------------------------------------------------------------------
    const getUser = async () => {
      const { data, error } = await supabase.auth.getUser();

      if (data?.user) {
        setUser(data.user);
        setModo("online");
        setLoading(false);

        // O servidor confirmou: renova o bilhete que vai valer quando a rede
        // faltar. `getSession()` aqui le do armazenamento e nao vai na rede --
        // o token acabou de ser confirmado, entao nao esta vencido.
        const { data: sessaoAtual } = await supabase.auth.getSession();
        const expiraEm = expiracaoEmMs(sessaoAtual?.session);
        if (expiraEm !== null) {
          lembrarSessao(window.localStorage, {
            id: data.user.id,
            email: data.user.email ?? null,
            expiraEm,
          });
        }
        return;
      }

      const lembrada = lerSessaoLembrada(window.localStorage);
      const decisao = decidirSessao({
        usuarioConfirmado: false,
        origemDaFalha: classificarFalhaDeAuth(error),
        sessaoLocalExpiraEm: lembrada?.expiraEm ?? null,
        agora: Date.now(),
      });

      if (decisao === "entrar-offline" && lembrada) {
        // O objeto vem do bilhete, nao do servidor -- e so o suficiente para o
        // cabecalho e o menu desenharem. Nenhuma leitura de dado sai daqui: as
        // consultas continuam indo com o token de verdade e batendo na RLS.
        setUser({ id: lembrada.id, email: lembrada.email ?? undefined } as User);
        setModo("offline");
      } else {
        if (decisao === "login") esquecerSessao(window.localStorage);
        setUser(null);
        setModo("online");
      }

      setLoading(false);
    };

    getUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Com sessao: a rede voltou e o servidor confirmou de novo.
      if (session?.user) {
        setUser(session.user);
        setModo("online");
        const expiraEm = expiracaoEmMs(session);
        if (expiraEm !== null) {
          lembrarSessao(window.localStorage, {
            id: session.user.id,
            email: session.user.email ?? null,
            expiraEm,
          });
        }
        setLoading(false);
        return;
      }

      // Saiu da conta: o bilhete morre junto. Sem isto, sair e depois ficar
      // sem rede reabriria o app na conta de quem saiu -- a pessoa clicou em
      // Sair e o app voltaria sozinho.
      if (event === "SIGNED_OUT") {
        esquecerSessao(window.localStorage);
        setUser(null);
        setModo("online");
        setLoading(false);
      }

      // Qualquer outro evento sem sessao e ignorado de proposito. O
      // `INITIAL_SESSION` vazio e o caso real: ele chega quando o cookie ainda
      // nao foi lido, e zerar o usuario aqui desfaria a decisao offline que o
      // `getUser()` acima acabou de tomar -- o logout voltaria pela janela.
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
        // dominio manda o email apontando para OUTRO. `window.location.origin`
        // faz o link voltar para o dominio em que a pessoa se cadastrou, seja
        // ele o de producao ou um preview.
        //
        // ATENCAO: mandar o valor nao basta. O "Redirect URLs" do Supabase e
        // uma lista de permissao -- um valor que nao casa com ela e descartado
        // EM SILENCIO e o link cai na raiz do Site URL, que nao troca o token
        // por sessao. Ate 25/09 nenhum hostname nosso estava na lista e esta
        // linha nao tinha efeito nenhum em producao; os dois dominios foram
        // liberados no painel em 25/09 (HMO-158) e a sonda confirmou. Liberar
        // dominio novo continua sendo passo de painel: ver
        // docs/DEPLOY_VERCEL.md, passo 3, para conferir sem o painel.
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
    // Apaga o bilhete ANTES de chamar o servidor, e nao depois: `signOut()`
    // tambem precisa de rede, e sair da conta com o wi-fi caindo devolveria um
    // erro -- com o bilhete intacto e o app reabrindo offline na conta de quem
    // acabou de sair. O evento `SIGNED_OUT` apaga de novo, e apagar duas vezes
    // nao custa nada.
    esquecerSessao(window.localStorage);
    const { error } = await supabase.auth.signOut();
    return { error };
  };

  return {
    user,
    loading,
    /** "offline" = a sessao nao foi confirmada agora; os dados podem estar velhos. */
    modo,
    signIn,
    signUp,
    signOut,
  };
}
