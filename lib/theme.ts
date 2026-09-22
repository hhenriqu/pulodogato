/**
 * Preferencia de tema do usuario.
 *
 * "system" segue o prefers-color-scheme do aparelho e e o padrao: no celular
 * o usuario ja escolheu claro/escuro no sistema, e o app respeita.
 */
export type Theme = "light" | "dark" | "system";

/** Tema efetivamente pintado na tela -- "system" ja resolvido. */
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "pulodogato-theme";

export const THEMES: readonly Theme[] = ["light", "dark", "system"] as const;

export const DEFAULT_THEME: Theme = "system";

export const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export function isTheme(value: unknown): value is Theme {
  return (
    value === "light" || value === "dark" || value === "system"
  );
}

/**
 * Le a preferencia salva. Volta ao padrao em qualquer erro -- navegador em
 * modo privado, cookies/storage bloqueados e SSR passam por aqui.
 */
export function readStoredTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(DARK_MEDIA_QUERY).matches;
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "system") return systemPrefersDark() ? "dark" : "light";
  return theme;
}

/**
 * Cor da barra de status do PWA -- tem que acompanhar o --background de cada
 * tema, senao o app abre instalado com uma faixa branca em cima da tela
 * escura. Espelha os valores de app/globals.css.
 */
export const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: "#ffffff",
  dark: "#020817",
};

/**
 * Aplica o tema no <html>. A classe `dark` e o que o Tailwind observa
 * (darkMode: "class"); o color-scheme faz o navegador pintar de escuro o que
 * nao e nosso -- scrollbar, campos nativos, o fundo antes do CSS carregar.
 */
export function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR[resolved]);
}

/**
 * Script que roda ANTES da primeira pintura, injetado inline no <head>.
 *
 * Sem ele o HTML chega sempre no tema claro e o React so aplica a classe
 * `dark` depois de hidratar: quem usa modo escuro leva um flash branco em
 * tela cheia a cada navegacao. Por isso e inline e sincrono, e nao um
 * useEffect. Precisa ser auto-contido (nao importa nada deste modulo) e nunca
 * pode lancar -- se o localStorage estiver bloqueado, cai no tema do sistema.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)});if(t!=="light"&&t!=="dark"&&t!=="system"){t=${JSON.stringify(
  DEFAULT_THEME
)};}var d=t==="dark"||(t==="system"&&window.matchMedia(${JSON.stringify(
  DARK_MEDIA_QUERY
)}).matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light";var m=document.querySelector('meta[name="theme-color"]');if(m){m.setAttribute("content",d?${JSON.stringify(
  THEME_COLOR.dark
)}:${JSON.stringify(THEME_COLOR.light)});}}catch(_){}})();`;

export const THEME_LABELS: Record<Theme, string> = {
  light: "Claro",
  dark: "Escuro",
  system: "Sistema",
};
