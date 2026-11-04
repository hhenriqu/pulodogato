"use client";

import { useEffect, useState } from "react";
import { COOKIE_ENTROU_COMO, lerEntrouComo } from "@/lib/entrar-como";

function lerCookie(nome: string): string | null {
  if (typeof document === "undefined") return null;
  const par = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${nome}=`));
  return par ? par.slice(nome.length + 1) : null;
}

/**
 * Faixa no topo enquanto o admin esta na conta de outro membro ("Entrar
 * como"). E o unico caminho de volta: dentro da conta do membro o painel
 * Admin nao abre.
 */
export function AvisoEntrouComo() {
  const [nome, setNome] = useState<string | null>(null);
  const [voltando, setVoltando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setNome(lerEntrouComo(lerCookie(COOKIE_ENTROU_COMO))?.nome ?? null);
  }, []);

  if (!nome) return null;

  const voltar = async () => {
    setVoltando(true);
    setErro(null);
    const r = await fetch("/api/admin/voltar", { method: "POST" }).catch(
      () => null
    );
    if (r?.ok) {
      window.location.assign("/dashboard/admin");
      return;
    }
    const j = r ? await r.json().catch(() => ({})) : {};
    setErro(j.error ?? "Não foi possível voltar");
    window.location.assign("/login");
  };

  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-3 bg-warning px-4 py-2 text-sm font-medium text-warning-foreground"
    >
      <span>
        Você está usando o app como <strong>{nome}</strong>. Tudo o que lançar
        fica na conta dessa pessoa.
      </span>
      <button
        type="button"
        onClick={voltar}
        disabled={voltando}
        className="rounded-md border border-current px-3 py-1 text-xs font-semibold"
      >
        {voltando ? "Voltando…" : "Voltar para minha conta"}
      </button>
      {erro && <span>{erro}</span>}
    </div>
  );
}
