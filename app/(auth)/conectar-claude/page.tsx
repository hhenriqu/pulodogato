"use client";

/**
 * A tela de "Permitir" do OAuth do conector do Claude.
 *
 * O Claude abre esta pagina (o `authorization_endpoint` dos metadados) com os
 * parametros do OAuth na URL. Quem nao esta logado vai para o login e volta
 * para ca (`?next=`). Quem esta logado ve o que esta autorizando e clica em
 * Permitir; a rota `/api/mcp/oauth/autorizar` confere o pedido e devolve o
 * endereco de retorno do Claude com o codigo.
 */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { createClient } from "@/utils/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function ConectarClaude() {
  const params = useSearchParams();
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const pedido = {
    client_id: params.get("client_id") ?? "",
    redirect_uri: params.get("redirect_uri") ?? "",
    code_challenge: params.get("code_challenge") ?? "",
    code_challenge_method: params.get("code_challenge_method") ?? "",
    state: params.get("state"),
    response_type: params.get("response_type") ?? "",
  };

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  const aqui =
    typeof window !== "undefined" ? window.location.pathname + window.location.search : "/conectar-claude";

  // Sem redirecionar para `redirect_uri` aqui: a tela nao consegue conferir a
  // assinatura do cliente, e mandar a pessoa para um endereco qualquer da URL
  // seria um redirecionamento aberto. Cancelar so encerra.
  const [cancelado, setCancelado] = useState(false);
  const recusar = () => setCancelado(true);

  const permitir = async () => {
    setEnviando(true);
    setErro(null);
    const resposta = await fetch("/api/mcp/oauth/autorizar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pedido),
    }).catch(() => null);
    const corpo = resposta ? await resposta.json().catch(() => ({})) : {};
    if (!resposta?.ok || !corpo.redirect) {
      setErro(corpo.error ?? "Não foi possível autorizar. Tente de novo.");
      setEnviando(false);
      return;
    }
    window.location.href = corpo.redirect;
  };

  const pedidoValido = pedido.response_type === "code" && pedido.client_id && pedido.redirect_uri;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Conectar ao Claude</CardTitle>
          <CardDescription>
            O Claude vai poder ler suas contas, cartões e categorias e lançar despesas, receitas e
            compras parceladas na sua conta do Pulo do Gato.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {cancelado ? (
            <p className="text-sm">Conexão cancelada. Pode fechar esta aba.</p>
          ) : !pedidoValido ? (
            <p className="text-sm text-destructive">
              Este link não veio do Claude. Adicione o conector pelo Claude para começar.
            </p>
          ) : email === undefined ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : email === null ? (
            <>
              <p className="text-sm">Entre na sua conta para continuar.</p>
              <Button asChild className="w-full">
                <Link href={`/login?next=${encodeURIComponent(aqui)}` as Route}>Entrar</Link>
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm">
                Conectando como <strong>{email}</strong>. Ele só vê e lança o que você vê no app, e
                você pode desconectar quando quiser em Configurações.
              </p>
              {erro && <p className="text-sm text-destructive">{erro}</p>}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={recusar} disabled={enviando}>
                  Cancelar
                </Button>
                <Button className="flex-1" onClick={permitir} disabled={enviando}>
                  {enviando ? "Conectando…" : "Permitir"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function Pagina() {
  return (
    <Suspense>
      <ConectarClaude />
    </Suspense>
  );
}
