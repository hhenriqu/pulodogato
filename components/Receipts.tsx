"use client";

// Comprovantes anexados a um lancamento, conta prevista ou acerto de grupo.
//
// Um componente so para os tres alvos: a regra de "exatamente um alvo" e do
// CHECK do 009, e repetir a tela tres vezes faria as tres divergirem.
//
// A URL do arquivo e ASSINADA e vale 10 minutos (o bucket e privado). Por isso
// a lista e recarregada ao abrir em vez de guardada: uma URL de meia hora atras
// ja expirou, e um link quebrado parece arquivo perdido.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { FileText, ImageIcon, Loader2, Paperclip, Trash2 } from "lucide-react";

export type AlvoComprovante =
  | { transaction_id: string }
  | { scheduled_transaction_id: string }
  | { settlement_id: string };

interface Comprovante {
  id: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  created_at: string;
  url: string | null;
}

const TAMANHO_MAXIMO = 10 * 1024 * 1024;

const tamanhoLegivel = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function Receipts({ alvo, titulo = "Comprovantes" }: { alvo: AlvoComprovante; titulo?: string }) {
  const [lista, setLista] = useState<Comprovante[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  const [coluna, valor] = Object.entries(alvo)[0] as [string, string];

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch(`/api/receipts?${coluna}=${valor}`);
      const d = await r.json();
      if (r.ok) setLista(d.receipts ?? []);
    } catch {
      // Silencioso de proposito: o comprovante e acessorio, e um toast de erro
      // toda vez que a secao abre atrapalharia a acao principal da tela.
    } finally {
      setCarregando(false);
    }
  }, [coluna, valor]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const enviar = async (arquivo: File) => {
    // Conferir aqui evita subir 40 MB para receber 413 depois -- no celular,
    // num plano de dados.
    if (arquivo.size > TAMANHO_MAXIMO) {
      toast.error("O arquivo precisa ter até 10 MB.");
      return;
    }

    setEnviando(true);
    try {
      const form = new FormData();
      form.append("file", arquivo);
      form.append(coluna, valor);

      const r = await fetch("/api/receipts", { method: "POST", body: form });
      const d = await r.json().catch(() => ({}));

      if (!r.ok) {
        toast.error(d.error ?? "Não foi possível anexar");
        return;
      }

      toast.success("Comprovante anexado");
      await carregar();
    } finally {
      setEnviando(false);
      if (entrada.current) entrada.current.value = "";
    }
  };

  const apagar = async (id: string) => {
    const r = await fetch(`/api/receipts/${id}`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));

    if (!r.ok) {
      toast.error(d.error ?? "Não foi possível apagar");
      return;
    }

    setLista((l) => l.filter((c) => c.id !== id));
    toast.success("Comprovante apagado");
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Paperclip className="h-4 w-4" /> {titulo}
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={enviando}
          onClick={() => entrada.current?.click()}
        >
          {enviando ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
          Anexar
        </Button>
        <input
          ref={entrada}
          type="file"
          className="hidden"
          accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) enviar(f);
          }}
        />
      </div>

      {carregando ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : lista.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum comprovante. Foto do boleto ou PDF, até 10 MB.
        </p>
      ) : (
        <ul className="space-y-1">
          {lista.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                {c.mime_type === "application/pdf" ? (
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                {c.url ? (
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate underline underline-offset-2"
                  >
                    {c.file_name}
                  </a>
                ) : (
                  // Sem URL assinada o nome aparece sem link: um link quebrado
                  // pareceria arquivo perdido.
                  <span className="truncate">{c.file_name}</span>
                )}
                <span className="shrink-0 text-xs text-muted-foreground">
                  {tamanhoLegivel(c.byte_size)}
                </span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => apagar(c.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
