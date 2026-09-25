// =====================================================
// O SERVICE WORKER PASSA A DIZER QUANDO A RESPOSTA E VELHA
// =====================================================
// Descoberto ao abrir as telas de leitura sem rede (HMO-145): o cache padrao
// do next-pwa **ja guarda as respostas de `/api/`**. A regra e NetworkFirst,
// `maxEntries: 16`, `maxAgeSeconds: 24h` (`next-pwa/cache.js`, a regra de
// cacheName `apis`).
//
// Isso muda o problema inteiro. Sem rede, uma tela de leitura nao recebe
// necessariamente zero: ela pode receber o JSON de ontem, com `resposta.ok`
// verdadeiro e todo campo no lugar. Do lado do React **nao ha como saber**: a
// resposta que vem do aparelho e byte a byte a mesma que veio do servidor.
//
// E o numero desatualizado com cara de atual e pior que o zero confiante. O
// zero pelo menos e absurdo o suficiente para a pessoa desconfiar; "saldo R$
// 1.240" de ontem ela simplesmente acredita.
//
// Pior ainda, o mesmo caminho acontece COM rede: `networkTimeoutSeconds: 10`
// manda servir a copia guardada quando o servidor passa de dez segundos. Numa
// conexao ruim a tela mostra dado velho sem nada na tela mudar -- e ai nem a
// faixa de "sem conexao" aparece, porque conexao existe.
//
// Entao o service worker passa a CARIMBAR o que serviu do aparelho. Quem
// carimba e ele porque so ele sabe: e o unico ponto do sistema onde a decisao
// "rede ou cache" e tomada. Do carimbo sai o aviso da tela
// (`lib/offline-leitura.ts`), e nenhum numero precisa ser adivinhado.
//
// -----------------------------------------------------------------------
// A ARMADILHA DESTE ARQUIVO (1): `runtimeCaching` SUBSTITUI, NAO SOMA
// -----------------------------------------------------------------------
// Exatamente como `additionalManifestEntries` em `lib/pwa-precache.js`.
// Passar um array para `runtimeCaching` **descarta as 15 regras padrao** do
// next-pwa -- fontes do Google, imagens, audio, video, o proprio JS do
// `/_next/static`, os dados do App Router. O app continuaria funcionando
// online e perderia quase todo o comportamento offline, sem um erro sequer.
//
// Por isso aqui nao ha lista escrita a mao: a lista padrao entra inteira e a
// regra de `apis` e trocada NO LUGAR, com teste cobrando as outras nominalmente.
//
// -----------------------------------------------------------------------
// A ARMADILHA DESTE ARQUIVO (2): O PLUGIN E COPIADO COMO TEXTO
// -----------------------------------------------------------------------
// O workbox-build serializa o plugin com `stringifyWithoutComments` -- ele
// copia o CODIGO-FONTE da funcao para dentro do `sw.js`
// (`workbox-build/build/lib/runtime-caching-converter.js`, caso `plugins`).
//
// Quer dizer: a funcao chega no service worker sem o escopo deste arquivo.
// Qualquer constante de fora que ela cite vira `ReferenceError` LA DENTRO --
// no meio da leitura do cache, offline, que e o lugar do app onde ninguem
// consegue investigar. Por isso os nomes dos cabecalhos estao escritos como
// texto, repetidos, dentro da funcao; e por isso o teste confere que eles
// continuam literais e que batem com os de `lib/offline-leitura.ts`.
// =====================================================

/**
 * Cabecalho que o service worker acrescenta quando a resposta saiu do
 * aparelho, e nao do servidor.
 *
 * Um cabecalho proprio, e nao o `Age` do HTTP: `Age` tem significado definido
 * na cadeia de proxies e pode chegar do servidor por outros motivos. Este so
 * existe se fomos nos.
 */
const MARCA_DO_APARELHO = "x-pulodogato-do-aparelho";

/**
 * Quando o SERVIDOR produziu aquela resposta -- copiado do `Date` original,
 * que continua guardado junto com o corpo.
 *
 * Vem do relogio do servidor de proposito: e ele que a tela mostra. O relogio
 * do aparelho serve para calcular "ha quanto tempo", e so ele estar adiantado
 * ja bastaria para a tela dizer que o dado e do futuro.
 */
const MARCA_GUARDADO_EM = "x-pulodogato-guardado-em";

/**
 * Quanto tempo a resposta de API fica guardada no aparelho.
 *
 * Eram 24 horas no padrao do next-pwa. Sobe para sete dias porque a tela
 * agora DIZ de quando e o dado: o que tornava 24h prudente era a mentira, nao
 * a idade. Uma semana de saldo rotulado "de 22/09 as 10:03" e util; um dia de
 * saldo sem rotulo nao era.
 *
 * Passado o prazo, o workbox apaga a copia e a tela cai em "sem rede" -- que e
 * honesto tambem, so menos util.
 */
const VALIDADE_DAS_APIS_EM_SEGUNDOS = 7 * 24 * 60 * 60;

/**
 * Quantas respostas de API cabem no aparelho.
 *
 * Eram 16 no padrao, e 16 e pouco de um jeito que engana: a tela de contas
 * previstas sozinha busca SEIS enderecos, o painel busca outros tantos.
 * Navegar por tres telas ja despeja a primeira. O efeito offline era o pior
 * possivel para quem usa: a mesma tela abre com dado hoje e sem dado amanha,
 * sem nenhuma regra que a pessoa pudesse aprender.
 *
 * 64 cobre o app inteiro com folga. O custo e alguns megabytes de JSON no
 * Cache Storage, contra a leitura ficar previsivel.
 */
const MAXIMO_DE_APIS = 64;

/**
 * O plugin do workbox que carimba a resposta vinda do cache.
 *
 * `cachedResponseWillBeUsed` so roda quando o workbox decidiu ENTREGAR a copia
 * guardada. No NetworkFirst isso significa uma de duas coisas, e as duas
 * interessam a tela: nao houve resposta do servidor, ou ele passou dos dez
 * segundos.
 *
 * O corpo e relido e a resposta remontada porque `Response.headers` e
 * imutavel depois de construida -- nao da para so acrescentar o cabecalho. O
 * `cachedResponse` que chega aqui ja e uma copia do Cache Storage, entao
 * consumir o corpo dele nao afeta o que esta guardado.
 */
const pluginDeMarcacao = {
  cachedResponseWillBeUsed: async ({ cachedResponse }) => {
    if (!cachedResponse) return cachedResponse;

    // Os nomes vao literais de proposito: esta funcao e copiada como TEXTO
    // para dentro do sw.js e nao leva o escopo deste arquivo junto. Uma
    // constante aqui vira ReferenceError dentro do service worker.
    const cabecalhos = new Headers(cachedResponse.headers);
    const quando = cabecalhos.get("date");
    cabecalhos.set("x-pulodogato-do-aparelho", "1");
    if (quando) cabecalhos.set("x-pulodogato-guardado-em", quando);

    return new Response(await cachedResponse.blob(), {
      status: cachedResponse.status,
      statusText: cachedResponse.statusText,
      headers: cabecalhos,
    });
  },
};

/** A regra de runtime caching e a das respostas de `/api/`. */
const ehRegraDasApis = (regra) =>
  !!regra && !!regra.options && regra.options.cacheName === "apis";

/**
 * A lista que vai para `runtimeCaching`: a padrao do next-pwa inteira, com a
 * regra de `apis` trocada no lugar.
 *
 * @param {Array} regrasPadrao normalmente `require("next-pwa/cache")`.
 */
function montarRuntimeCaching(regrasPadrao) {
  const daApi = regrasPadrao.filter(ehRegraDasApis);

  // O next-pwa pode renomear ou dividir essa regra numa versao futura. Se ela
  // sumir, trocar "no lugar" nao troca nada: o app seguiria sem carimbo, as
  // telas mostrariam dado de ontem como se fosse de agora, e o build ficaria
  // verde. Falhar alto aqui e a unica forma de isso nao passar despercebido.
  if (daApi.length !== 1) {
    throw new Error(
      `Esperava exatamente uma regra de runtime caching com cacheName "apis" ` +
        `no next-pwa, e encontrei ${daApi.length}. Sem ela o carimbo de ` +
        `"resposta vinda do aparelho" nao existe, e as telas offline voltam a ` +
        `mostrar dado velho como se fosse de agora. Ver lib/pwa-runtime-cache.js.`
    );
  }

  return regrasPadrao.map((regra) =>
    ehRegraDasApis(regra)
      ? {
          ...regra,
          options: {
            ...regra.options,
            expiration: {
              ...regra.options.expiration,
              maxEntries: MAXIMO_DE_APIS,
              maxAgeSeconds: VALIDADE_DAS_APIS_EM_SEGUNDOS,
            },
            plugins: [...(regra.options.plugins ?? []), pluginDeMarcacao],
          },
        }
      : regra
  );
}

module.exports = {
  MARCA_DO_APARELHO,
  MARCA_GUARDADO_EM,
  VALIDADE_DAS_APIS_EM_SEGUNDOS,
  MAXIMO_DE_APIS,
  pluginDeMarcacao,
  ehRegraDasApis,
  montarRuntimeCaching,
};
