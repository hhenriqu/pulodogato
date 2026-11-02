"use client";

import { Home, PartyPopper } from "lucide-react";
import {
  DESCRICAO_DO_TIPO,
  ROTULO_DO_TIPO,
  TIPOS_DE_GRUPO,
  type TipoDoGrupo,
} from "@/lib/tipo-do-grupo";
import { cn } from "@/lib/utils";

const ICONE_DO_TIPO: Record<TipoDoGrupo, typeof Home> = {
  casa: Home,
  evento: PartyPopper,
};

/**
 * As duas opcoes do tipo do grupo (076), lado a lado, com a frase que diz para
 * que cada uma serve. Um Select esconderia a descricao, e e ela que ajuda a
 * escolher na primeira vez.
 */
export function EscolhaDoTipoDoGrupo({
  valor,
  aoMudar,
  id,
}: {
  valor: TipoDoGrupo;
  aoMudar: (tipo: TipoDoGrupo) => void;
  id?: string;
}) {
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label="Tipo do grupo"
      className="grid grid-cols-1 sm:grid-cols-2 gap-3"
    >
      {TIPOS_DE_GRUPO.map((tipo) => {
        const Icone = ICONE_DO_TIPO[tipo];
        const escolhido = valor === tipo;
        return (
          <button
            key={tipo}
            type="button"
            role="radio"
            aria-checked={escolhido}
            onClick={() => aoMudar(tipo)}
            className={cn(
              "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
              escolhido
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "border-border hover:bg-muted"
            )}
          >
            <Icone
              className={cn(
                "h-5 w-5 mt-0.5 shrink-0",
                escolhido ? "text-primary" : "text-muted-foreground"
              )}
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium">
                {ROTULO_DO_TIPO[tipo]}
              </span>
              <span className="block text-xs text-muted-foreground">
                {DESCRICAO_DO_TIPO[tipo]}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** O selo do tipo no cartao e no cabecalho do grupo. */
export function SeloDoTipoDoGrupo({ tipo }: { tipo: TipoDoGrupo }) {
  const Icone = ICONE_DO_TIPO[tipo];
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <Icone className="h-3 w-3" />
      {ROTULO_DO_TIPO[tipo]}
    </span>
  );
}
