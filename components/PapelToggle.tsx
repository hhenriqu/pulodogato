"use client";

import { StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useModoPapel } from "@/components/ModoPapelProvider";

/**
 * O papelzinho, ao lado do seletor de tema (HMO-283).
 *
 * E um botao de ALTERNAR, e nao um menu como o `ThemeToggle`: o modo tem dois
 * estados, e um menu de dois itens custa um toque a mais para dizer a mesma
 * coisa.
 *
 * `aria-pressed` e o que conta o estado para leitor de tela -- o icone e o
 * mesmo nos dois, so muda a opacidade, e cor sozinha nao e informacao.
 */
export function PapelToggle({ className }: { className?: string }) {
  const { papel, alternar, mounted } = useModoPapel();

  // Antes de montar nao da para saber o estado (o servidor nao le o
  // localStorage), entao o botao sai neutro e do mesmo tamanho: evita erro de
  // hidratacao e o layout nao pula quando o estado certo aparece. A TELA ja
  // esta na pele certa -- quem a pintou foi o PAPEL_INIT_SCRIPT.
  const ligado = mounted && papel;

  return (
    <Button
      id="papel-toggle"
      variant="ghost"
      size="icon"
      className={className}
      aria-pressed={mounted ? papel : undefined}
      aria-label={
        mounted
          ? ligado
            ? "Papel de pão ligado. Desligar"
            : "Papel de pão desligado. Ligar"
          : "Papel de pão"
      }
      onClick={alternar}
    >
      <StickyNote
        className={`h-5 w-5 ${ligado ? "" : "opacity-60"}`}
        aria-hidden="true"
      />
    </Button>
  );
}
