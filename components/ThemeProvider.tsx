"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DARK_MEDIA_QUERY,
  DEFAULT_THEME,
  ResolvedTheme,
  THEME_STORAGE_KEY,
  Theme,
  applyTheme,
  isTheme,
  readStoredTheme,
  resolveTheme,
} from "@/lib/theme";

interface ThemeContextValue {
  /** O que o usuario escolheu -- pode ser "system". */
  theme: Theme;
  /** O que esta na tela agora -- "system" ja resolvido. */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  /**
   * false ate o primeiro efeito no cliente. Quem pinta algo que depende do
   * tema (icone do seletor) precisa esperar: no servidor nao da para saber
   * qual e, e renderizar um chute quebra a hidratacao.
   */
  mounted: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // O primeiro render precisa bater com o HTML do servidor, que nao conhece o
  // localStorage -- por isso comeca no padrao e so le a preferencia no efeito
  // abaixo. Enquanto isso a tela ja esta correta: quem aplicou a classe `dark`
  // foi o THEME_INIT_SCRIPT, antes da primeira pintura.
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  const [resolved, setResolved] = useState<ResolvedTheme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = readStoredTheme();
    setThemeState(stored);
    setResolved(resolveTheme(stored));
    setMounted(true);
  }, []);

  // Reaplica no <html> a cada mudanca de escolha. No primeiro render nao faz
  // nada de novo (o script inline ja deixou o DOM assim), mas mantem o DOM
  // como fonte unica da verdade depois de cada setTheme.
  useEffect(() => {
    if (!mounted) return;
    applyTheme(resolved);
  }, [resolved, mounted]);

  // Com "system", seguir o aparelho em tempo real: quem usa o modo escuro
  // agendado do celular ve o app virar junto, sem precisar recarregar.
  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined") return;
    const query = window.matchMedia(DARK_MEDIA_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      setResolved(event.matches ? "dark" : "light");
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [theme]);

  // O app e um PWA e costuma ficar aberto em mais de uma aba/janela; trocar o
  // tema em uma delas deve valer nas outras.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const next = isTheme(event.newValue) ? event.newValue : DEFAULT_THEME;
      setThemeState(next);
      setResolved(resolveTheme(next));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    const nextResolved = resolveTheme(next);
    setResolved(nextResolved);
    // Aplica direto, sem esperar o efeito: a troca precisa ser instantanea no
    // clique, senao o menu fecha ainda no tema antigo.
    applyTheme(nextResolved);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage bloqueado: o tema vale so nesta sessao. Nao e motivo de erro.
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme: resolved, setTheme, mounted }),
    [theme, resolved, setTheme, mounted]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme precisa estar dentro de <ThemeProvider>");
  }
  return context;
}
