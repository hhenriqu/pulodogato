"use client";

import { Toaster } from "sonner";
import { useTheme } from "@/components/ThemeProvider";

/**
 * O sonner pinta os toasts em um portal com estilo proprio, fora dos nossos
 * tokens. O `theme="system"` dele leria o prefers-color-scheme e ignoraria a
 * escolha explicita do usuario, entao passamos o tema ja resolvido: um toast
 * branco estourando no meio da tela escura e exatamente o que o modo noturno
 * existe para evitar.
 */
export function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return <Toaster theme={resolvedTheme} />;
}
