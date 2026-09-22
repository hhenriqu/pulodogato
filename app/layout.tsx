import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { PWAWrapper } from "@/components/PWAWrapper";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemedToaster } from "@/components/ThemedToaster";
import { THEME_COLOR, THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  minimumScale: 1,
  userScalable: true,
  viewportFit: "cover",
  // O theme-color NAO sai daqui: as duas entradas com `media` seguiam o
  // prefers-color-scheme, que passa a estar errado assim que o usuario escolhe
  // um tema diferente do sistema. Viraram uma unica meta no <head> abaixo, que
  // o THEME_INIT_SCRIPT reescreve junto com a classe `dark`.
};

// Base das URLs absolutas (Open Graph, manifest, icones).
// Sem isso, um deploy na Vercel anuncia "http://localhost:3000" nas metatags.
// Ordem: dominio explicito > dominio de producao da Vercel > URL do deploy
// atual (preview) > local. As VERCEL_* sao injetadas no build e vem sem esquema.
function resolveSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_URL) return process.env.NEXT_PUBLIC_URL;

  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercelHost) return `https://${vercelHost}`;

  return "http://localhost:3000";
}

export const metadata: Metadata = {
  metadataBase: new URL(resolveSiteUrl()),
  title: {
    default: "Pulo do Gato - Investimentos",
    template: "%s | Pulo do Gato",
  },
  description:
    "Aplicativo para controle inteligente de investimentos financeiros",
  manifest: "/manifest.json",
  keywords: [
    "investimentos",
    "finanças",
    "controle financeiro",
    "pwa",
    "pulo do gato",
  ],
  authors: [{ name: "Pulo do Gato Team" }],
  creator: "Pulo do Gato",
  publisher: "Pulo do Gato",
  applicationName: "Pulo do Gato - Investimentos",
  category: "finance",
  icons: {
    icon: [
      { url: "/icons/icon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/icon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-48x48.png", sizes: "48x48", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [
      { url: "/icons/icon-152x152.png", sizes: "152x152", type: "image/png" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
    ],
    other: {
      rel: "apple-touch-icon-precomposed",
      url: "/icons/icon-192x192.png",
    },
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Pulo do Gato",
    startupImage: [
      {
        url: "/splash/apple-splash-2048-2732.png",
        media:
          "(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
      },
      {
        url: "/splash/apple-splash-1668-2388.png",
        media:
          "(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
      },
      {
        url: "/splash/apple-splash-1536-2048.png",
        media:
          "(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
      },
      {
        url: "/splash/apple-splash-1125-2436.png",
        media:
          "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/splash/apple-splash-1242-2688.png",
        media:
          "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/splash/apple-splash-750-1334.png",
        media:
          "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
      },
      {
        url: "/splash/apple-splash-828-1792.png",
        media:
          "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
      },
    ],
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    siteName: "Pulo do Gato - Investimentos",
    title: "Pulo do Gato - Investimentos",
    description:
      "Aplicativo para controle inteligente de investimentos financeiros",
    images: [
      {
        url: "/icons/icon-512x512.png",
        width: 512,
        height: 512,
        alt: "Pulo do Gato Logo",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "Pulo do Gato - Investimentos",
    description:
      "Aplicativo para controle inteligente de investimentos financeiros",
    images: ["/icons/icon-512x512.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: o script abaixo escreve class/style no <html>
    // antes do React hidratar, entao o HTML do servidor nunca bate com o do
    // cliente aqui. E so neste no -- nao esconde diferenca no resto da arvore.
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/* Uma unica meta theme-color, sem `media`. O script logo abaixo troca
            o content conforme o tema -- por isso ela vem antes dele. */}
        <meta name="theme-color" content={THEME_COLOR.light} />

        {/* Aplica o tema salvo antes da primeira pintura. Tem que ser o
            primeiro elemento do <head> e sincrono: qualquer coisa depois disso
            ja pode ter pintado a tela branca para quem usa o modo escuro. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />

        {/* PWA Meta Tags */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Pulo do Gato" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-touch-fullscreen" content="yes" />

        {/* Microsoft */}
        <meta name="msapplication-config" content="/icons/browserconfig.xml" />
        <meta name="msapplication-TileColor" content="#1a1a1a" />
        <meta name="msapplication-tap-highlight" content="no" />
        <meta name="msapplication-navbutton-color" content="#1a1a1a" />
        <meta name="msapplication-starturl" content="/dashboard" />

        {/* General */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="Pulo do Gato" />
        <meta name="format-detection" content="telephone=no" />

        {/* Favicons */}
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/svg+xml" href="/logo_pulodogato.svg" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <link
          rel="icon"
          type="image/png"
          sizes="32x32"
          href="/icons/icon-32x32.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="16x16"
          href="/icons/icon-16x16.png"
        />
        <link
          rel="mask-icon"
          href="/icons/safari-pinned-tab.svg"
          color="#1a1a1a"
        />

        {/* Additional Apple Touch Icons */}
        <link
          rel="apple-touch-icon"
          sizes="152x152"
          href="/icons/icon-152x152.png"
        />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/icons/icon-192x192.png"
        />
        <link
          rel="apple-touch-icon"
          sizes="167x167"
          href="/icons/icon-192x192.png"
        />

        {/* Preload critical resources */}
        <link rel="preload" href="/icons/icon-192x192.png" as="image" />
        <link rel="dns-prefetch" href="//fonts.googleapis.com" />
      </head>
      <body className={inter.className}>
        <ThemeProvider>
          <PWAWrapper>{children}</PWAWrapper>
          <ThemedToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
