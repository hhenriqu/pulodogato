/**
 * MODO "PAPEL DE PAO" -- a preferencia (HMO-283, do plano da HMO-279).
 *
 * POR QUE ISTO NAO E UM TERCEIRO TEMA
 * -----------------------------------
 * `lib/theme.ts` declara `Theme = "light" | "dark" | "system"`, `resolveTheme()`
 * devolve um dos DOIS valores pintaveis e `applyTheme()` liga/desliga a classe
 * `dark`. Enfiar `"papel"` nesse tipo quebraria tres contratos de uma vez --
 * `ResolvedTheme`, o `THEME_COLOR` indexado por ele, e o `THEME_INIT_SCRIPT`.
 *
 * E erraria o assunto: papel de pao nao substitui claro/escuro, ele CONVIVE com
 * os dois (ha uma paleta de papel claro e uma de papel escuro em
 * `app/globals.css`). Por isso ele e um modo ORTOGONAL: chave propria, classe
 * propria no `<html>`, interruptor proprio.
 *
 * O arquivo e puro de proposito -- sem React, sem import de componente. Quem
 * guarda o estado em memoria e `components/ModoPapelProvider.tsx`; aqui mora o
 * que e testavel sem navegador (`npm run test:modo-papel`).
 */
import { ResolvedTheme, THEME_COLOR } from "@/lib/theme";

/** A escolha do usuario. Dois valores, e um deles e o padrao. */
export type ModoPapel = "ligado" | "desligado";

export const MODO_PAPEL_STORAGE_KEY = "pulodogato-papel-de-pao";

/**
 * A classe no `<html>`. Os blocos `.papel` e `.dark.papel` de
 * `app/globals.css` sao o que ela liga -- e a composicao com `dark` e o que faz
 * o botao de Claro/Escuro continuar tendo efeito dentro do modo.
 */
export const PAPEL_CLASS = "papel";

export const DEFAULT_MODO_PAPEL: ModoPapel = "desligado";

export const MODOS_PAPEL: readonly ModoPapel[] = [
  "desligado",
  "ligado",
] as const;

export function isModoPapel(value: unknown): value is ModoPapel {
  return value === "ligado" || value === "desligado";
}

export function papelAtivo(modo: ModoPapel): boolean {
  return modo === "ligado";
}

export function alternarModoPapel(modo: ModoPapel): ModoPapel {
  return modo === "ligado" ? "desligado" : "ligado";
}

/**
 * Le a preferencia salva. Volta ao padrao em qualquer erro -- navegador em modo
 * privado, storage bloqueado, SSR e valor sujo (de uma versao antiga, ou de
 * outra aba escrevendo na mesma chave) passam todos por aqui.
 */
export function lerModoPapel(): ModoPapel {
  if (typeof window === "undefined") return DEFAULT_MODO_PAPEL;
  try {
    const salvo = window.localStorage.getItem(MODO_PAPEL_STORAGE_KEY);
    return isModoPapel(salvo) ? salvo : DEFAULT_MODO_PAPEL;
  } catch {
    return DEFAULT_MODO_PAPEL;
  }
}

/**
 * Grava a preferencia. Storage bloqueado nao e erro: o modo vale so nesta
 * sessao, do mesmo jeito que o tema.
 */
export function gravarModoPapel(modo: ModoPapel): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MODO_PAPEL_STORAGE_KEY, modo);
  } catch {
    // Sem storage o modo nao sobrevive ao recarregar. Nao e motivo de erro.
  }
}

/**
 * Cor da barra de status do PWA no modo papel -- os `--background` dos blocos
 * `.papel` e `.dark.papel`, em hex.
 *
 * Existe pelo mesmo motivo do `THEME_COLOR`: sem ela o app instalado abre com
 * uma faixa branca (ou azul-escura) em cima de uma tela bege. Os valores
 * ESPELHAM `app/globals.css` -- mexer la sem mexer aqui deixa a faixa de uma
 * cor e a tela de outra.
 */
export const PAPEL_THEME_COLOR: Record<ResolvedTheme, string> = {
  light: "#eee4d3",
  dark: "#231810",
};

/**
 * Aplica o modo no `<html>`.
 *
 * O claro/escuro nao e parametro: ele e LIDO do DOM (`classList.contains`),
 * que e onde o `THEME_INIT_SCRIPT` e o `applyTheme()` o escrevem. Receber o
 * tema por argumento criaria uma segunda fonte da verdade para a mesma
 * pergunta, e as duas divergiriam no primeiro `setTheme` que esquecesse de
 * reaplicar o papel.
 */
export function aplicarModoPapel(modo: ModoPapel): void {
  if (typeof document === "undefined") return;
  const raiz = document.documentElement;
  const ativo = papelAtivo(modo);
  raiz.classList.toggle(PAPEL_CLASS, ativo);

  const escuro = raiz.classList.contains("dark");
  const tema: ResolvedTheme = escuro ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute(
      "content",
      ativo ? PAPEL_THEME_COLOR[tema] : THEME_COLOR[tema]
    );
  }
}

/**
 * Script que roda ANTES da primeira pintura, inline no `<head>`.
 *
 * Mesmo motivo escrito no `lib/theme.ts`: o HTML chega na pele normal e o React
 * so aplica a classe depois de hidratar, entao quem usa o modo levaria um flash
 * da tela azul-e-branca EM TELA CHEIA a cada navegacao. Por isso e inline e
 * sincrono, nao um `useEffect`.
 *
 * Tem que vir DEPOIS do `THEME_INIT_SCRIPT` no `<head>`: ele le a classe `dark`
 * que aquele acabou de escrever para escolher entre as duas cores de barra de
 * status, e sobrescreve a meta que aquele preencheu.
 *
 * E auto-contido (nao importa nada deste modulo, que nao existe ainda naquele
 * instante) e nunca lanca. As constantes entram por `JSON.stringify` em vez de
 * digitadas: o script e TEXTO, nao compila, e uma chave digitada a mao aqui
 * poderia apontar para uma preferencia que nao existe mais sem nada falhar.
 */
export const PAPEL_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  MODO_PAPEL_STORAGE_KEY
)})===${JSON.stringify(
  "ligado"
)};var e=document.documentElement;e.classList.toggle(${JSON.stringify(
  PAPEL_CLASS
)},p);if(p){var d=e.classList.contains("dark");var m=document.querySelector('meta[name="theme-color"]');if(m){m.setAttribute("content",d?${JSON.stringify(
  PAPEL_THEME_COLOR.dark
)}:${JSON.stringify(PAPEL_THEME_COLOR.light)});}}}catch(_){}})();`;

export const MODO_PAPEL_LABELS: Record<ModoPapel, string> = {
  ligado: "Ligado",
  desligado: "Desligado",
};
