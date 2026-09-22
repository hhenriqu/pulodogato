"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/components/ThemeProvider";
import { THEMES, THEME_LABELS, Theme, isTheme } from "@/lib/theme";

const ICONS: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, resolvedTheme, setTheme, mounted } = useTheme();

  // Antes de montar nao da para saber o tema (o servidor nao le localStorage),
  // entao o botao sai neutro e do mesmo tamanho -- evita erro de hidratacao e
  // o layout nao pula quando o icone certo aparece.
  const TriggerIcon = mounted
    ? resolvedTheme === "dark"
      ? Moon
      : Sun
    : Monitor;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={className}
          aria-label={
            mounted
              ? `Tema: ${THEME_LABELS[theme]}. Trocar tema`
              : "Trocar tema"
          }
        >
          <TriggerIcon className="h-5 w-5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            if (isTheme(value)) setTheme(value);
          }}
        >
          {THEMES.map((option) => {
            const Icon = ICONS[option];
            return (
              <DropdownMenuRadioItem key={option} value={option}>
                <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
                {THEME_LABELS[option]}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
