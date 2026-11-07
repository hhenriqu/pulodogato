"use client";

/**
 * Configuracoes > Claude: o endereco do conector, as conexoes ativas (com o
 * botao de desconectar) e o token pessoal para quem nao usa o login do Claude.
 * As rotas estao em `app/api/mcp/tokens/route.ts`.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, KeyRound, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface Conexao {
  id: string;
  nome: string;
  prefixo: string;
  criado_em: string;
  usado_em: string | null;
  revogado_em: string | null;
}

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "nunca";

export function ConexaoComOClaude() {
  const [endereco, setEndereco] = useState("");
  const [conexoes, setConexoes] = useState<Conexao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tokenNovo, setTokenNovo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/mcp/tokens", { cache: "no-store" }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) {
      setErro(j.error ?? "Não foi possível ler as conexões.");
      setConexoes([]);
      return;
    }
    setErro(null);
    setConexoes(j.tokens ?? []);
  }, []);

  useEffect(() => {
    setEndereco(`${window.location.origin}/api/mcp`);
    carregar();
  }, [carregar]);

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success("Copiado.");
    } catch {
      toast.error("Não consegui copiar. Selecione e copie à mão.");
    }
  };

  const gerarToken = async () => {
    setOcupado(true);
    const r = await fetch("/api/mcp/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: "Token pessoal" }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setOcupado(false);
    if (!r?.ok) {
      toast.error(j.error ?? "Não foi possível gerar o token.");
      return;
    }
    setTokenNovo(j.token);
    carregar();
  };

  const desconectar = async (id: string) => {
    const r = await fetch(`/api/mcp/tokens?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(
      () => null
    );
    if (!r?.ok) {
      toast.error("Não foi possível desconectar.");
      return;
    }
    toast.success("Desconectado.");
    carregar();
  };

  const ativas = (conexoes ?? []).filter((c) => !c.revogado_em);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Lançar pelo Claude</CardTitle>
          <CardDescription>
            Converse com o Claude (&quot;gastei 52 reais no mercado no Nubank&quot;) e ele lança na sua
            conta. Funciona no claude.ai, no app do Claude e no Claude Code.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ol className="list-decimal pl-5 space-y-1">
            <li>
              No Claude, abra <strong>Configurações → Conectores → Adicionar conector personalizado</strong>.
            </li>
            <li>Nome: Pulo do Gato. URL: o endereço abaixo.</li>
            <li>Clique em Conectar, entre com sua conta do Pulo do Gato e clique em Permitir.</li>
          </ol>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-muted px-2 py-1.5 text-xs break-all">{endereco}</code>
            <Button size="sm" variant="outline" onClick={() => copiar(endereco)} aria-label="Copiar endereço">
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Conexões ativas</CardTitle>
          <CardDescription>
            Cada conexão lança só na sua conta e vê só o que você vê. Desconectar corta o acesso na hora.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {erro && <p className="text-destructive">{erro}</p>}
          {conexoes === null ? (
            <p className="text-muted-foreground">Carregando…</p>
          ) : ativas.length === 0 ? (
            <p className="text-muted-foreground">Nenhuma conexão ativa.</p>
          ) : (
            ativas.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded border p-2">
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {c.nome} <Badge variant="secondary">{c.prefixo}…</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Conectado em {quando(c.criado_em)} · último uso {quando(c.usado_em)}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => desconectar(c.id)}>
                  <Unplug className="h-4 w-4 mr-1" />
                  Desconectar
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Token pessoal</CardTitle>
          <CardDescription>
            Para clientes sem o login do Claude (ex.: Claude Code com cabeçalho). Trate como uma senha.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {tokenNovo ? (
            <>
              <p>Copie agora: ele não aparece de novo.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-muted px-2 py-1.5 text-xs break-all">{tokenNovo}</code>
                <Button size="sm" variant="outline" onClick={() => copiar(tokenNovo)} aria-label="Copiar token">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground break-all">
                Claude Code: claude mcp add --transport http pulodogato {endereco} --header
                &quot;Authorization: Bearer {tokenNovo}&quot;
              </p>
            </>
          ) : (
            <Button variant="outline" onClick={gerarToken} disabled={ocupado}>
              <KeyRound className="h-4 w-4 mr-2" />
              Gerar token pessoal
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
