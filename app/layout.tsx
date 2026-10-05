import type { Metadata, Viewport } from "next";
import { Inter, Patrick_Hand } from "next/font/google";
import { PWAWrapper } from "@/components/PWAWrapper";
import { ModoPapelProvider } from "@/components/ModoPapelProvider";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemedToaster } from "@/components/ThemedToaster";
import { PAPEL_INIT_SCRIPT } from "@/lib/modo-papel";
import { THEME_COLOR, THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

/*
 * A letra manuscrita do modo papel de pao (HMO-283).
 *
 * Entra como VARIAVEL CSS (`.variable`), nao como `className`: a classe poria a
 * letra manuscrita em TODO MUNDO. A variavel so declara `--font-papel` no
 * `<body>`; quem a pede e a regra `.papel body` de app/globals.css -- ver o
 * comentario dela, que explica por que a regra mira o `body`.
 *
 * `preload: false` e DELIBERADO, e e o que torna o modo barato para quem nao o
 * usa: o `<link rel=preload>` que o next/font gera por padrao baixaria o
 * arquivo da fonte em toda visita, inclusive das pessoas que nunca ligaram o
 * papel de pao. Sem ele a variavel fica declarada para todos e o arquivo so
 * desce quando alguma regra de CSS casa -- ou seja, quando a classe `papel`
 * esta no <html>.
 *
 * `weight: "400"` porque a Patrick Hand tem um peso so. Sem ele o next/font
 * recusa a fonte no build.
 */
const patrickHand = Patrick_Hand({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-papel",
  display: "swap",
  preload: false,
});

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
      {
        url: "/icons/apple-touch-icon-152x152.png",
        sizes: "152x152",
        type: "image/png",
      },
      {
        url: "/icons/apple-touch-icon-180x180.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
    other: {
      rel: "apple-touch-icon-precomposed",
      url: "/icons/apple-touch-icon-180x180.png",
    },
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Pulo do Gato",
    // SEM `startupImage`. Havia sete aqui, todas apontando para /splash/*, e
    // as sete davam 404 -- o iOS abria no branco. Gerar as sete custaria entre
    // 1,3 e 3,9 MB commitados (a medida esta em scripts/generate-pwa-icons.mjs)
    // e cobriria so aparelhos ate o iPhone 11: o iOS exige que a imagem bata
    // EXATAMENTE com a resolucao fisica, entao todo iPhone recente cairia no
    // fallback de qualquer forma. O fallback e a cor `background_color` do
    // manifest, hoje apontada para o creme do proprio logo -- abertura colorida
    // em todo aparelho, por zero byte.
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

        {/* Liga a pele de papel de pao antes da primeira pintura, pelo mesmo
            motivo do script acima -- sem ele quem usa o modo leva um flash da
            tela azul-e-branca em tela cheia a cada navegacao.

            DEPOIS daquele, e nao antes: este le a classe `dark` que aquele
            acabou de escrever para escolher entre as duas cores de barra de
            status, e sobrescreve a meta que aquele preencheu. Invertidos, o app
            instalado abre com a faixa do tema normal sobre a tela bege. */}
        <script dangerouslySetInnerHTML={{ __html: PAPEL_INIT_SCRIPT }} />

        {/* PWA Meta Tags */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Pulo do Gato" />
        <meta name="apple-touch-fullscreen" content="yes" />

        {/* Microsoft */}
        <meta name="msapplication-config" content="/icons/browserconfig.xml" />
        <meta name="msapplication-TileColor" content="#1a1a1a" />
        <meta name="msapplication-tap-highlight" content="no" />
        <meta name="msapplication-navbutton-color" content="#1a1a1a" />
        <meta name="msapplication-starturl" content="/dashboard" />

        {/* General. `mobile-web-app-capable` aparecia duas vezes -- aqui e no
            bloco de cima. Duplicata nao quebra nada, mas a segunda esconde a
            primeira de quem for editar. */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="Pulo do Gato" />
        <meta name="format-detection" content="telephone=no" />

        {/* Favicons. Nao ha mais <link> para /logo_pulodogato.svg: esse arquivo
            nunca existiu (so o .png de 1024px), e o Safari que seguisse o link
            recebia a pagina de 404 no lugar do icone. */}
        <link rel="icon" href="/favicon.ico" sizes="any" />
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

        {/* Apple Touch Icons. O iOS ignora o manifest e escolhe daqui: cada
            tamanho aponta para um arquivo daquele tamanho, em vez de os tres
            reusarem o icone de 192 -- reescalar no aparelho borra o desenho. */}
        <link
          rel="apple-touch-icon"
          href="/icons/apple-touch-icon-180x180.png"
        />
        <link
          rel="apple-touch-icon"
          sizes="152x152"
          href="/icons/apple-touch-icon-152x152.png"
        />
        <link
          rel="apple-touch-icon"
          sizes="167x167"
          href="/icons/apple-touch-icon-167x167.png"
        />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/icons/apple-touch-icon-180x180.png"
        />

        {/* Preload critical resources */}
        <link rel="dns-prefetch" href="//fonts.googleapis.com" />
      </head>
      {/* A variavel da manuscrita acompanha a classe do Inter: o `.className`
          da a fonte do app, o `.variable` apenas DECLARA `--font-papel` para o
          bloco `.papel` poder pedi-la. */}
      <body className={`${inter.className} ${patrickHand.variable}`}>
        {/* O ModoPapelProvider por DENTRO do ThemeProvider: `aplicarModoPapel`
            le a classe `dark` do <html> para escolher a cor da barra de status,
            e quem a escreve e o de fora. */}
        <ThemeProvider>
          <ModoPapelProvider>
            <PWAWrapper>{children}</PWAWrapper>
            <ThemedToaster />
          </ModoPapelProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
