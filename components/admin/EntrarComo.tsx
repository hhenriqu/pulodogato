"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LogIn } from "lucide-react";
import type { PessoaQuePossoAssumir } from "@/lib/entrar-como";

/**
 * Card do painel Admin: lista quem divide grupo com o admin e deixa entrar na
 * conta da pessoa para conferir o fluxo como ela ve. A volta e pelo aviso no
 * topo da tela (`AvisoEntrouComo`).
 */
export function EntrarComo() {
  const [pessoas, setPessoas] = useState<PessoaQuePossoAssumir[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/admin/entrar-como")
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) {
          setErro(j.error ?? "Não foi possível carregar os membros");
          setPessoas([]);
          return;
        }
        setPessoas(j.pessoas ?? []);
      })
      .catch(() => {
        if (!vivo) return;
        setErro("Não foi possível carregar os membros");
        setPessoas([]);
      });
    return () => {
      vivo = false;
    };
  }, []);

  const entrar = async (p: PessoaQuePossoAssumir) => {
    setEntrando(p.user_id);
    setErro(null);
    try {
      const r = await fetch("/api/admin/entrar-como", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: p.user_id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(j.error ?? "Não foi possível entrar na conta");
        setEntrando(null);
        return;
      }
      // Recarga inteira: o app guarda o usuario em memoria (useAuth), e so
      // um carregamento novo le a sessao trocada pelo servidor.
      window.location.assign("/dashboard");
    } catch {
      setErro("Não foi possível entrar na conta");
      setEntrando(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LogIn className="h-5 w-5" />
          Entrar como
        </CardTitle>
        <CardDescription>
          Entre na conta de quem divide um grupo com você para conferir o app
          como essa pessoa vê. Cada entrada fica registrada, e a pessoa também
          consegue ver o registro. Para sair, use &quot;Voltar para minha
          conta&quot; no topo da tela.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {pessoas === null && (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        )}
        {pessoas !== null && pessoas.length === 0 && !erro && (
          <p className="text-sm text-muted-foreground">
            Ninguém com conta divide um grupo ativo com você.
          </p>
        )}
        {erro && <p className="text-sm text-destructive">{erro}</p>}
        {pessoas?.map((p) => (
          <div
            key={p.user_id}
            className="flex items-center justify-between gap-3 rounded-lg border p-3"
          >
            <div className="min-w-0">
              <p className="font-medium truncate">{p.nome}</p>
              <p className="text-xs text-muted-foreground truncate">
                {p.grupos.join(", ")}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={entrando !== null}
              onClick={() => entrar(p)}
            >
              {entrando === p.user_id ? "Entrando…" : "Entrar como"}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
