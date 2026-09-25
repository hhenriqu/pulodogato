const path = require("path");
const { montarPrecache, revisaoDoDeploy } = require("./lib/pwa-precache");

const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",

  // ---------------------------------------------------------------------
  // O HTML DAS TELAS QUE ABREM SEM REDE
  // ---------------------------------------------------------------------
  // Sem esta chave o next-pwa precacheia todo o JavaScript e NENHUM HTML, e a
  // navegacao cai na regra `others` do cache padrao: NetworkFirst com 24h e 32
  // entradas. Passado um dia sem abrir a tela, o app instalado responde com a
  // pagina /offline -- com os 110 chunks e a fila de lancamentos intactos no
  // aparelho. O motivo completo, as duas rotas escolhidas e a armadilha de
  // `additionalManifestEntries` SUBSTITUIR a varredura de `public/` (em vez de
  // somar) estao em `lib/pwa-precache.js`, com teste.
  additionalManifestEntries: montarPrecache({
    publicDir: path.join(__dirname, "public"),
    revisaoDasRotas: revisaoDoDeploy(),
  }),

  // ---------------------------------------------------------------------
  // A PAGINA /offline EXISTIA E ERA INALCANCAVEL
  // ---------------------------------------------------------------------
  // `app/offline/page.tsx` esta no projeto ha muito tempo, com ilustracao,
  // texto e botao. Nada nunca navegou ate ela: sem esta chave o next-pwa nao
  // registra `setCatchHandler` nenhum no service worker, e uma navegacao que
  // falha na rede E no cache simplesmente estoura -- a pessoa ve a tela de
  // "sem internet" do proprio navegador, nao a nossa.
  //
  // Conferido no `sw.js` de PRODUCAO antes de mexer: ele tem os 15 caches de
  // runtime do next-pwa e zero `setCatchHandler`. O arquivo
  // `public/fallback-*.js` versionado no repositorio reforcava a impressao de
  // que aquilo estava configurado; era sobra de um build antigo, ninguem o
  // carregava, e ele saiu junto com este commit.
  //
  // Por que o default (`{}`) nao bastava: o next-pwa so descobre a pagina
  // sozinho procurando `pages/_offline.*`, e este projeto e App Router -- nao
  // existe diretorio `pages/`. A busca falha, ele desliga os fallbacks em
  // silencio e nao imprime nada no log do build.
  //
  // A ORDEM IMPORTA, e e a que queremos: o catch handler so entra depois de a
  // estrategia falhar, entao uma tela ja visitada continua abrindo do cache. A
  // /offline e ultimo recurso, nao primeiro.
  fallbacks: {
    document: "/offline",
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    typedRoutes: true,
  },
  images: {
    domains: ["localhost"],
  },
};

module.exports = withPWA(nextConfig);
