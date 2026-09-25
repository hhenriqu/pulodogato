#!/usr/bin/env node
/**
 * Guarda do modo noturno (HMO-144). Faz duas perguntas ao codigo:
 *
 *   1. Toda cor de interface sai de um token? Uma classe fixa como
 *      `bg-white` ou `text-gray-900` nao muda no tema escuro -- ela nao
 *      quebra o build, nao quebra teste nenhum, e so aparece como um bloco
 *      branco na tela de quem usa o app a noite.
 *   2. Os pares de token continuam legiveis nos dois temas? E facil trocar um
 *      valor em globals.css e deixar texto com contraste de 2:1 sem perceber.
 *
 * Roda no pre-commit e no CI. Se precisar mesmo de uma cor fixa, adicione o
 * caso em ALLOWED com o motivo -- a excecao fica registrada em vez de virar
 * precedente silencioso.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";

const CSS_FILE = "app/globals.css";
const DIRS = ["app", "components", "lib"];

// Paletas fixas do Tailwind que NAO acompanham o tema.
const HARDCODED =
  /\b(?:bg|text|border|ring|divide|placeholder|from|to|via)-(?:white|black|gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?:\/\d{1,3})?\b/g;

/** Excecoes deliberadas: classe fixa -> por que ela nao deve virar token. */
const ALLOWED = [
  {
    // Preto/branco com opacidade nao sao "cor do tema", sao veu: escurecem ou
    // clareiam o que esta atras, e precisam fazer isso nos dois temas.
    test: (cls) => /^(?:bg|from|via|to)-(?:black|white)\/\d{1,3}$/.test(cls),
    reason: "veu/overlay translucido",
  },
  {
    // Conteudo sobre uma cor propria (chip da categoria, tela de carregamento),
    // onde o fundo nao vem do tema.
    //
    // O Sidebar saiu desta lista na HMO-161. A excecao dele era o X do menu
    // mobile, que flutuava sobre o veu escuro e por isso era claro nos dois
    // temas. O botao passou a morar DENTRO do painel, cujo fundo VEM do tema --
    // e ali a mesma cor fixa fica invisivel no tema claro. O X agora vive em
    // components/MobileMenuChrome.tsx, que nao esta em nenhuma excecao: se
    // alguem reintroduzir a cor fixa junto com a posicao antiga, esta guarda
    // reprova.
    test: (cls, file) =>
      ["text-white", "ring-white", "border-white", "bg-black"].includes(cls) &&
      [
        "components/ui/LoadingScreen.tsx",
        "app/(dashboard)/dashboard/personal-finance/page.tsx",
      ].includes(file),
    reason: "texto sobre fundo que nao e do tema",
  },
  {
    // Termometro de forca da senha: sao 5 degraus de uma escala unica
    // (vermelho -> verde). Mapear para 3 tokens apagaria degraus, e os tons
    // 500/600 ja tem contraste nos dois temas.
    test: (cls, file) =>
      /^bg-(?:red|orange|yellow|green)-(?:500|600)$/.test(cls) &&
      ["components/ui/form.tsx", "app/(auth)/signup/page.tsx"].includes(file),
    reason: "escala de forca da senha",
  },
  {
    // Serie de grafico: cores categoricas precisam ser distinguiveis entre si,
    // nao seguir o tema. Os tons 500 funcionam sobre claro e escuro.
    test: (cls, file) =>
      file.startsWith("components/charts/") &&
      /^(?:from|to|stroke)-(?:blue|purple|emerald)-(?:500|600)$/.test(cls),
    reason: "cor categorica de grafico",
  },
];

function isAllowed(cls, file) {
  return ALLOWED.some((rule) => rule.test(cls, file));
}

/**
 * Varre o disco em vez de perguntar ao git: um componente recem-criado ainda
 * nao esta no indice, e e exatamente nele que a cor fixa costuma entrar.
 */
function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else if (/\.(tsx|css)$/.test(entry)) out.push(full);
  }
  return out;
}

function checkHardcodedClasses() {
  const files = DIRS.flatMap(listFiles).filter((f) => f !== CSS_FILE); // globals.css define os tokens

  const offenders = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const match of line.matchAll(HARDCODED)) {
        if (isAllowed(match[0], file)) continue;
        offenders.push(`${file}:${index + 1}  ${match[0]}`);
      }
    });
  }
  return offenders;
}

// --- contraste -------------------------------------------------------------

function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function relativeLuminance([r, g, b]) {
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Le os blocos :root e .dark de globals.css em dois mapas de token -> HSL. */
function readTokens() {
  const css = readFileSync(CSS_FILE, "utf8");
  const block = (selector) => {
    const start = css.indexOf(selector);
    if (start === -1) throw new Error(`bloco ${selector} nao encontrado`);
    const open = css.indexOf("{", start);
    const end = css.indexOf("}", open);
    const tokens = {};
    for (const [, name, h, s, l] of css
      .slice(open, end)
      .matchAll(/--([\w-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g)) {
      tokens[name] = hslToRgb(Number(h), Number(s), Number(l));
    }
    return tokens;
  };
  return { light: block(":root"), dark: block(".dark") };
}

// Texto normal precisa de 4.5:1 (WCAG AA). Icone/borda/preenchimento so
// precisa de 3:1 -- por isso a lista separa os dois casos.
const TEXT_PAIRS = [
  ["foreground", "background"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["accent-foreground", "accent"],
  ["destructive-foreground", "destructive"],
  ["success-foreground", "success"],
  ["warning-foreground", "warning"],
  ["info-foreground", "info"],
  ["premium-foreground", "premium"],
  // Cor semantica usada como texto direto (valor negativo, rotulo de status).
  ["destructive", "card"],
  ["success", "card"],
  ["warning", "card"],
  ["info", "card"],
  ["premium", "card"],
  ["primary", "card"],
];

// O anel de foco e o unico elemento nao-textual com exigencia real de 3:1
// (WCAG 1.4.11) -- e o que diz onde o teclado esta. A borda de card e
// separador decorativo: 3:1 deixaria a interface dura, mas ela ainda precisa
// existir, entao so checamos que nao sumiu na superficie.
const NON_TEXT_PAIRS = [
  ["ring", "background", 3],
  ["border", "card", 1.15],
];

function checkContrast() {
  const { light, dark } = readTokens();
  const failures = [];
  for (const [themeName, tokens] of [
    ["claro", light],
    ["escuro", dark],
  ]) {
    const check = (fg, bg, min) => {
      if (!tokens[fg] || !tokens[bg]) {
        failures.push(`[${themeName}] token faltando: --${fg} ou --${bg}`);
        return;
      }
      const ratio = contrast(tokens[fg], tokens[bg]);
      if (ratio < min) {
        failures.push(
          `[${themeName}] --${fg} sobre --${bg}: ${ratio.toFixed(2)}:1 (minimo ${min}:1)`
        );
      }
    };
    for (const [fg, bg] of TEXT_PAIRS) check(fg, bg, 4.5);
    for (const [fg, bg, min] of NON_TEXT_PAIRS) check(fg, bg, min);
  }
  return failures;
}

// --- main ------------------------------------------------------------------

const offenders = checkHardcodedClasses();
const contrastFailures = checkContrast();

if (offenders.length) {
  console.error(
    `\n✗ ${offenders.length} classe(s) de cor fixa fora dos tokens:\n`
  );
  for (const line of offenders) console.error(`  ${line}`);
  console.error(
    "\n  Use um token (bg-card, text-muted-foreground, text-success, ...).\n" +
      "  Se a cor fixa for mesmo necessaria, registre a excecao em ALLOWED\n" +
      `  em ${import.meta.url.split("/").pop()} com o motivo.\n`
  );
}

if (contrastFailures.length) {
  console.error(`\n✗ ${contrastFailures.length} par(es) de token sem contraste:\n`);
  for (const line of contrastFailures) console.error(`  ${line}`);
  console.error(`\n  Ajuste a luminosidade do token em ${CSS_FILE}.\n`);
}

if (offenders.length || contrastFailures.length) process.exit(1);

console.log("✓ cores: todas nos tokens, contraste AA nos dois temas");
