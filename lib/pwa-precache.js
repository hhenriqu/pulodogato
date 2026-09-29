// =====================================================
// O QUE ENTRA NO PRECACHE DO SERVICE WORKER
// =====================================================
// Consertando: "o app so abre offline se voce usou a tela nas ultimas 24h".
//
// O next-pwa ja precacheia TODO o JavaScript -- os 110 arquivos do build,
// chunk por chunk. O que ele nao precacheia e o **HTML**. Uma navegacao para
// /dashboard/personal-finance cai na regra `others` do cache padrao dele:
// NetworkFirst, `maxEntries: 32`, `maxAgeSeconds: 24 * 60 * 60`.
//
// Dai os dois limites, e nenhum deles aparece como erro:
//
//   - passadas 24 horas da ultima visita, o HTML guardado esta VENCIDO. Sem
//     rede o NetworkFirst falha, o catch handler entra e a pessoa recebe a
//     pagina /offline -- no aparelho que tem o app instalado, todo o
//     JavaScript precacheado e a fila de lancamentos intacta no IndexedDB;
//   - `maxEntries: 32` conta paginas E qualquer outra coisa da mesma origem.
//     Navegar por umas poucas telas despeja a que voce mais usa.
//
// Precachear o HTML resolve os dois, e resolve uma terceira coisa que e a mais
// dificil de ver: **HTML e JS passam a trocar juntos**. O HTML referencia
// chunks por hash (`/_next/static/chunks/...-598140967a464e89.js`). Um HTML
// guardado no deploy N, servido depois que o precache ja trocou para o N+1,
// aponta para chunks que nao existem mais -- tela branca, sem erro, offline,
// que e onde ninguem consegue investigar. O precache do workbox troca como um
// bloco so: ou tudo do deploy N, ou tudo do N+1.
//
// SEGURANCA: as duas rotas sao `○` (prerender estatico) no `next build`. O
// HTML e identico para todo mundo e nao carrega um byte de dado de usuario --
// tudo vem de chamada do cliente, com o token de verdade, batendo na RLS.
// Precachear uma rota `ƒ` (dinamica, renderizada com o cookie de quem pediu)
// seria outra conversa: guardaria a pagina de UMA pessoa no aparelho. Por isso
// a lista abaixo nao cresce sozinha, e por isso ela tem teste.
//
// -----------------------------------------------------------------------
// A ARMADILHA DESTE ARQUIVO: `additionalManifestEntries` SUBSTITUI, NAO SOMA
// -----------------------------------------------------------------------
// No next-pwa 5.6 (`index.js`, linha 142):
//
//     let manifestEntries = additionalManifestEntries
//     if (!Array.isArray(manifestEntries)) {
//       manifestEntries = globby.sync([...], { cwd: 'public' }).map(...)
//     }
//
// Passar um array **desliga a varredura da pasta `public/`**. Quem escrever
// so `[{ url: "/dashboard" }]` aqui tira do precache os 28 arquivos de
// `public/`: o `manifest.json`, o `favicon.ico` e os 20 icones.
//
// E o sintoma seria o bug que este projeto ja levou meses para achar -- o
// Chrome deixa de oferecer a instalacao quando nao consegue o icone de 192px
// do manifest, e nada nisso aparece como erro: o build passa, o `tsc` passa,
// o servidor responde 200 em tudo. Por isso a montagem da lista mora aqui, com
// `scripts/test-pwa-precache.mjs` cobrando nominalmente os arquivos criticos.
// =====================================================

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/**
 * As telas que abrem sem rede, no plural certo: so entra aqui a rota que tem
 * o que fazer offline.
 *
 * NAO e a lista de todas as telas do dashboard, de proposito. Uma tela de
 * leitura precacheada abre sem rede e imprime R$ 0,00 com toda a confianca --
 * o "zero confiante", que e pior que a pagina /offline porque parece um
 * numero. Cada tela que entrar aqui precisa antes saber dizer "estou sem
 * rede" em vez de dizer "voce nao tem nada".
 *
 * O PEDAGIO PARA ENTRAR NESTA LISTA, e ele tem teste:
 *
 *   1. a rota e `○` (prerender estatico) no `next build`. Uma rota `ƒ` e
 *      renderizada com o cookie de quem pediu -- precachear guardaria a
 *      pagina de UMA pessoa no aparelho;
 *   2. a tela nao pode imprimir numero que ela nao tem. Todo total passa por
 *      `podeMostrarNumero()` e toda frase de vazio por `podeAfirmarVazio()`,
 *      de `lib/offline-leitura.ts`;
 *   3. o botao que exige rede fica apagado sem rede, em vez de aceitar o
 *      formulario e falhar no fim.
 *
 * - `/dashboard`: a casca. Precisa abrir para o menu existir e para dar para
 *   navegar ate a tela de lancamento.
 * - `/dashboard/personal-finance`: a lista de lancamentos, e a tela que RENOVA
 *   o catalogo do aparelho (`lib/offline-cache.ts`) a cada visita com rede.
 * - `/dashboard/movimentacoes/receita` e `/dashboard/movimentacoes/despesa`:
 *   as duas que ESCREVEM offline (HMO-165). Elas tem a fila
 *   (`lib/offline-queue.ts`) e leem o catalogo do aparelho.
 *
 *   Elas ENTRARAM JUNTO com a separacao de propósito. O formulario era um bloco
 *   dentro de `personal-finance`, ou seja, dentro de uma rota ja precacheada.
 *   Leva-lo para rotas novas sem coloca-las aqui apagaria o modo offline
 *   inteiro por um caminho que nao parece com isso: a lista abriria sem rede
 *   normalmente, o botao "Nova Despesa" estaria no lugar, e o toque nele cairia
 *   na pagina /offline -- com a fila intacta no IndexedDB e sem nenhum
 *   formulario para alimentar ela.
 * - `/dashboard/movimentacoes/transferencia`: entra pelo motivo OPOSTO ao das
 *   duas acima. Ela nao escreve offline -- a fila recusa transferencia de
 *   proposito, porque sao duas linhas e enviar metade erra o saldo das duas
 *   contas. Ela esta aqui para poder DIZER isso: o botao "Transferência" fica
 *   na lista de lancamentos, que e precacheada, e sem esta rota o toque nele
 *   cairia na /offline generica. A tela paga o pedagio: o Lançar fica apagado
 *   sem rede, e ela nao afirma "voce nao tem contas" quando o que houve foi
 *   nao conseguir le-las.
 * - `/dashboard/bills`: o que vence e o que ja venceu. A mais util das tres
 *   de leitura, e a que tinha a frase mais cara: sem dado ela dizia "Nada em
 *   atraso.".
 * - `/dashboard/accounts`: saldo por conta e fatura dos cartoes.
 * - `/dashboard/recurrences`: quanto as assinaturas custam por mes.
 *
 * As tres de leitura mostram o que o service worker guardou da ultima visita,
 * com a data em cima (ver `lib/pwa-runtime-cache.js`). Quando nao ha copia,
 * elas dizem isso -- e nao mostram numero nenhum.
 *
 * Ficaram de fora, e o motivo e o mesmo criterio: relatorios, fluxo de caixa,
 * orcamento e metas ainda imprimem total direto do estado vazio.
 */
const ROTAS_QUE_ABREM_SEM_REDE = [
  "/dashboard",
  "/dashboard/personal-finance",
  "/dashboard/movimentacoes/receita",
  "/dashboard/movimentacoes/despesa",
  "/dashboard/movimentacoes/transferencia",
  "/dashboard/bills",
  "/dashboard/accounts",
  "/dashboard/recurrences",
];

/**
 * Os mesmos descartes que o next-pwa faz na varredura de `public/`.
 *
 * Nao e cosmetico: o proprio `sw.js` nao pode entrar no precache dele mesmo, e
 * os `workbox-*.js` / `worker-*.js` / `fallback-*.js` sao saida do build --
 * guardar a versao de ontem junto com o service worker de hoje e o comeco de
 * um service worker que nunca se atualiza.
 */
const DESCARTES = [
  /^sw\.js(\.map)?$/,
  /^workbox-.*\.js(\.map)?$/,
  /^worker-.*\.js(\.map)?$/,
  /^fallback-.*\.js(\.map)?$/,
];

const revisaoDoArquivo = (arquivo) =>
  crypto.createHash("md5").update(fs.readFileSync(arquivo)).digest("hex");

/** Caminhos relativos de todo arquivo sob `dir`, com barra normal. */
function listarArquivos(dir, prefixo = "") {
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entrada) => {
      const relativo = prefixo ? `${prefixo}/${entrada.name}` : entrada.name;
      if (entrada.isDirectory()) {
        return listarArquivos(path.join(dir, entrada.name), relativo);
      }
      return [relativo];
    })
    .sort();
}

/**
 * A lista completa que vai para `additionalManifestEntries`.
 *
 * @param {object} opcoes
 * @param {string} opcoes.publicDir pasta `public/` do projeto.
 * @param {string} opcoes.revisaoDasRotas o que muda a cada deploy -- ver
 *   `revisaoDoDeploy()`. Uma revisao que NAO muda quando o HTML mudou deixa a
 *   tela velha no aparelho para sempre, entao este valor erra para o lado de
 *   mudar demais: revalidar a mais custa duas requisicoes por deploy.
 * @param {string[]} [opcoes.rotas]
 */
function montarPrecache({
  publicDir,
  revisaoDasRotas,
  rotas = ROTAS_QUE_ABREM_SEM_REDE,
}) {
  const doPublic = listarArquivos(publicDir)
    .filter((rel) => !DESCARTES.some((re) => re.test(rel)))
    .map((rel) => ({
      url: `/${rel}`,
      revision: revisaoDoArquivo(path.join(publicDir, rel)),
    }));

  return [
    ...doPublic,
    ...rotas.map((url) => ({ url, revision: revisaoDasRotas })),
  ];
}

/**
 * O que identifica este deploy.
 *
 * Na Vercel o commit vem pronto no ambiente. Fora dela tentamos o git, e o
 * ultimo recurso e o relogio -- que revalida a mais em todo build local, e
 * nunca a menos. O erro caro aqui e o contrario: revisao repetida com HTML
 * novo prende a tela velha no aparelho de quem instalou o app.
 */
function revisaoDoDeploy() {
  const daVercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (daVercel) return daVercel;

  try {
    return require("child_process")
      .execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return String(Date.now());
  }
}

module.exports = {
  ROTAS_QUE_ABREM_SEM_REDE,
  DESCARTES,
  listarArquivos,
  montarPrecache,
  revisaoDoDeploy,
};
