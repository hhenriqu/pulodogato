// ---------------------------------------------------------------------------
// A FATURA DE UM CARTAO, DO PONTO DE VISTA DA TELA (HMO-210)
// ---------------------------------------------------------------------------
// "Na tela de cartoes, ao clicar em um cartao, voce deve entrar e ver os gastos
// que estao nele."
//
// A pergunta ja tinha resposta no banco: a view `card_invoice_lines` (006)
// devolve cada compra com o `invoice_month` dela, e `GET /api/card-invoices`
// agrega por cartao. Este modulo e so o que a TELA precisa decidir em cima
// daquela resposta -- e esta separado do componente porque e aqui que mora a
// parte que da para testar sem navegador.
//
// AS QUATRO DECISOES QUE ESTAO AQUI, E POR QUE CADA UMA
// ----------------------------------------------------
//   1. `faturaDoCartao` escolhe a fatura POR ID, nunca `invoices[0]`. A rota
//      aceita `account_id` e, com ele, devolve uma fatura so -- mas "devolve uma
//      so" e uma propriedade do servidor, e `[0]` transforma qualquer mudanca
//      lá (um cartao novo sem lancamento, um filtro que deixa de filtrar) em
//      "os gastos do cartao errado embaixo do nome do cartao certo". Nada nisso
//      daria erro: sao dois cartoes do mesmo dono, com valores plausiveis.
//
//   2. `cartaoDaTela` exige que o id da URL esteja na lista de cartoes DO
//      USUARIO. A RLS de `financial_transactions` tem um OR para membro de grupo
//      (`002`), entao `card_invoice_lines` pode devolver a compra de grupo
//      lancada no cartao de OUTRA pessoa. O cabecalho nao sairia (ele vem de
//      `financial_accounts`, filtrada por `user_id`), e a tela mostraria uma
//      lista de gastos sem dono. Digitar o id na barra de endereco e o caminho.
//
//   3. `estadoDaTela` junta as DUAS leituras desta tela (o cadastro do cartao e
//      a fatura) na mais pessimista. Sem isso, o cadastro vindo fresco liberaria
//      `podeMostrarNumero()` e a tela imprimiria o total de uma fatura que ela
//      nao conseguiu ler -- o zero confiante de `lib/offline-leitura.ts`, agora
//      com duas fontes em vez de uma.
//
//   4. `PARAM_DO_CARTAO` e o nome do parametro que leva o cartao escolhido para
//      o formulario de despesa. Ele NAO e `id`: sob o segmento dinamico `[id]`
//      o Next consome a chave de mesmo nome ao montar `params`, e
//      `searchParams.get("id")` volta `null` com o `?id=` chegando inteiro
//      (HMO-142). O formulario tambem le `?id=` para EDICAO, e as duas chaves
//      no mesmo lugar seriam "editar o lancamento cujo id e o do cartao".
//      Ha guarda em `scripts/check-rota-query-colidente.mjs`.
// ---------------------------------------------------------------------------

import { mesesDoPeriodo, periodoDaQuery } from "@/lib/periodo-do-painel";
import type { EstadoDaLeitura } from "@/lib/offline-leitura";
import type {
  CardInvoice,
  CardInvoiceLine,
  ScheduledTransaction,
} from "@/types/financial";

/**
 * O nome do parametro que leva o cartao para `/movimentacoes/despesa`.
 *
 * Exportado para que o link e o leitor usem a MESMA string: duas constantes
 * iguais divergem na primeira renomeacao, e o sintoma seria o formulario
 * abrindo sem cartao nenhum -- aberto, utilizavel, e sem o cartao travado que
 * esta issue existe para travar.
 */
export const PARAM_DO_CARTAO = "cartao";

// Os dois caminhos sao TIPADOS como literal de template, e nao como `string`.
// O `next.config.js` liga `typedRoutes`, e o `href` do `next/link` passa a
// aceitar so rota conhecida: uma funcao que devolve `string` nao e atribuivel e
// o `next build` para. Vale registrar que `tsc --noEmit` NAO pega isso -- a
// tipagem das rotas vive em `.next/types`, que so existe depois de um build.

/** Para onde "Lancar gasto neste cartao" aponta. */
export function caminhoDeNovoGasto(
  accountId: string
): `/dashboard/movimentacoes/despesa?${string}` {
  return `/dashboard/movimentacoes/despesa?${PARAM_DO_CARTAO}=${encodeURIComponent(
    accountId
  )}`;
}

/** O caminho da tela de um cartao. */
export function caminhoDoCartao(
  accountId: string
): `/dashboard/cartoes/${string}` {
  return `/dashboard/cartoes/${accountId}`;
}

/**
 * O nome do parametro que leva o MES para a tela do cartao (HMO-287).
 *
 * Ele NAO e `id`, pela mesma razao que `PARAM_DO_CARTAO` nao e: sob o segmento
 * dinamico `[id]` o Next consome a chave de mesmo nome e `searchParams.get`
 * volta `null` com o valor chegando inteiro (HMO-142, decisao 4 acima).
 */
export const PARAM_DO_MES = "mes";

/**
 * A tela daquele cartao, aberta no mes DAQUELA fatura (HMO-287).
 *
 * POR QUE O MES VIAJA NA URL. A tela do cartao abre sempre em
 * `mesCorrenteDaFatura()`. Sem o parametro, clicar na fatura de agosto estando
 * a lista de Despesas em agosto abriria OUTUBRO: o valor certo, o mes errado, e
 * nada na tela de destino dizendo que o mes trocou. Esse e o defeito que
 * ninguem reporta, porque a tela de destino parece perfeitamente correta.
 *
 * O `mes` entra em qualquer um dos dois formatos que o app usa -- a chave da
 * fatura e `invoice_month` sao 'AAAA-MM-01'; o estado da tela do cartao e o
 * `&month=` da API sao 'AAAA-MM' -- e sai SEMPRE no de 7 chars, que e o unico
 * que a rota reconhece. Mes que nao da para ler nao vira querystring: o link
 * cai no caminho sem parametro, que abre no mes corrente. Um `?mes=undefined`
 * na barra de endereco seria pior que parametro nenhum.
 */
export function caminhoDoCartaoNoMes(
  accountId: string,
  mes: string | null | undefined
): `/dashboard/cartoes/${string}` {
  const curto = mesDeSeteChars(mes);
  if (!curto) return caminhoDoCartao(accountId);
  return `/dashboard/cartoes/${accountId}?${PARAM_DO_MES}=${curto}`;
}

// ---------------------------------------------------------------------------
// O MES DA FATURA
// ---------------------------------------------------------------------------
// Escritos a mao, e nao via `Intl`: o rotulo entra em assercao de teste, e
// depender da base de locale do Node faz o mesmo teste passar numa maquina e
// falhar noutra sem nada no codigo ter mudado. Mesma razao que
// `lib/periodo-do-painel.ts`.
const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

/**
 * "outubro de 2026" a partir de 'AAAA-MM' ou 'AAAA-MM-01'.
 *
 * Devolve `null` para o que nao da para ler, em vez de "undefined de 2026": o
 * rotulo e a unica coisa na tela que diz a QUAL mes o total abaixo responde, e
 * um rotulo quebrado ali e pior que rotulo nenhum -- ver
 * `painel-sem-eixo-de-tempo-mente-no-rotulo`. Quem recebe `null` esconde o
 * numero junto.
 */
export function rotuloDaFatura(mes: string | null | undefined): string | null {
  if (!mes || !/^\d{4}-\d{2}(-\d{2})?$/.test(mes)) return null;

  const numeroDoMes = Number(mes.slice(5, 7));
  if (numeroDoMes < 1 || numeroDoMes > 12) return null;

  return `${MESES[numeroDoMes - 1]} de ${mes.slice(0, 4)}`;
}

/**
 * O mes da fatura corrente, no fuso de Sao Paulo (onde o cartao fecha).
 *
 * `en-CA` da o formato ISO; o que se pede ao `Intl` aqui e o FUSO, nao nome de
 * mes -- por isso ele e aceitavel neste caso e nao em `rotuloDaFatura`.
 */
export function mesCorrenteDaFatura(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  })
    .format(agora)
    .slice(0, 7);
}

/**
 * 'AAAA-MM' a partir de 'AAAA-MM' ou 'AAAA-MM-DD'; `null` para o resto.
 *
 * A VALIDACAO DO NUMERO DO MES NAO E ENFEITE. '2026-13' casa com `\d{4}-\d{2}`
 * e e um mes que nao existe: a API devolveria uma fatura vazia e a tela diria
 * "R$ 0,00" com o rotulo de mes em branco (`rotuloDaFatura` ja recusa 13) --
 * um mes sem compra e um mes impossivel ficariam indistinguiveis.
 */
function mesDeSeteChars(mes: string | null | undefined): string | null {
  if (!mes || !/^\d{4}-\d{2}(-\d{2})?$/.test(mes)) return null;
  const numeroDoMes = Number(mes.slice(5, 7));
  if (numeroDoMes < 1 || numeroDoMes > 12) return null;
  return mes.slice(0, 7);
}

/**
 * Em que mes a tela do cartao abre: o do `?mes=` da URL, ou o corrente
 * (HMO-287).
 *
 * FUNCAO PURA, E NAO UM `useState` COM UM `??` DENTRO. Esta e a unica regra
 * nova da tela do cartao nesta issue, e o modo de falha dela e mudo: um mes que
 * a tela nao aceita nao da erro -- ela abre no mes corrente, que e exatamente o
 * que ela faria se o link estivesse certo e o parametro nao existisse. Um
 * handler em navegador nao distingue os dois casos; esta funcao distingue.
 *
 * ELA ACEITA OS DOIS FORMATOS, e isso NAO e uma segunda guarda redundante: a
 * conversao acontece em UM lugar so (`mesDeSeteChars`), que o link e esta
 * funcao chamam. Duas conversoes separadas e que seriam o problema -- elas
 * divergiriam sem dar erro, e o sintoma seria o mes errado embaixo do total
 * certo. Aceitar os 10 chars aqui cobre a URL colada a mao e a compartilhada,
 * que e a forma que o resto do app escreve ('AAAA-MM-01' e o que esta em
 * `invoice_month` e na chave da fatura).
 */
export function mesInicialDaFatura(
  mesDaUrl: string | null | undefined,
  agora: Date = new Date()
): string {
  return mesDeSeteChars(mesDaUrl) ?? mesCorrenteDaFatura(agora);
}

// ---------------------------------------------------------------------------
// EM QUAL FATURA A COMPRA CAI, NO LANCAMENTO (HMO-281 / HMO-289)
// ---------------------------------------------------------------------------
// "compro hoje e vai para a fatura que fecha semana que vem, indiferente da
// data que estou lancando."
//
// As duas funcoes abaixo sao PURAS e moram aqui, fora do componente, porque e
// isso que permite medi-las sem navegador -- e o que ha para medir e justamente
// a escolha do padrao, que depende de FUSO e de TELA DE ORIGEM.
// ---------------------------------------------------------------------------

/** Quantas faturas para tras o seletor oferece, a contar do padrao. */
export const FATURAS_PARA_TRAS = 3;
/** Quantas para frente. A ida e o caso da issue; a volta e o lancamento atrasado. */
export const FATURAS_PARA_FRENTE = 3;

/**
 * Anda `passo` meses sobre 'AAAA-MM'.
 *
 * ARITMETICA DE MES, E NAO DE DATA, de proposito. `somaMeses`
 * (lib/lancamento.ts) opera em 'AAAA-MM-DD' e GRAMPEIA o dia no fim do mes --
 * que e correto para uma data e e a origem do defeito que o cabecalho de
 * `app/api/financial-installments/route.ts` descreve (31/01 mais um mes e 28/02,
 * e as duas caem na MESMA fatura). Aqui nao ha dia nenhum para grampear, e
 * passar por uma funcao que carrega dia seria convidar o bug de volta.
 *
 * Meses contados de 0 para o modulo nao tropecar no 12.
 */
function andarMeses(mes: string, passo: number): string {
  const ano = Number(mes.slice(0, 4));
  const numeroDoMes = Number(mes.slice(5, 7));

  const indice = ano * 12 + (numeroDoMes - 1) + passo;
  const anoDestino = Math.floor(indice / 12);
  const mesDestino = (indice % 12) + 1;

  return `${String(anoDestino).padStart(4, "0")}-${String(mesDestino).padStart(
    2,
    "0"
  )}`;
}

/**
 * A fatura que o seletor abre marcada.
 *
 * DUAS FONTES, NESTA ORDEM:
 *
 *   1. o mes do periodo da TELA DE ORIGEM (`?de=&ate=`, levado pelo `origem` de
 *      lib/retorno-do-lancamento.ts). Quem esta olhando outubro e clica em "Nova
 *      Despesa" esta lancando em outubro, e perguntar de novo seria ignorar a
 *      resposta que ela acabou de dar.
 *   2. sem origem legivel, `mesCorrenteDaFatura()` -- que pega o mes no fuso de
 *      SAO PAULO, onde o cartao fecha. `new Date().getMonth()` aqui erraria o mes
 *      inteiro para quem lanca depois das 21h do dia 30 (em UTC ja e dia 1 do mes
 *      seguinte), e o teste disso passa numa maquina em SP e reprova no CI em
 *      UTC sem uma linha de codigo mudar.
 *
 * O PRIMEIRO MES DO INTERVALO, QUANDO O PERIODO TEM VARIOS
 * --------------------------------------------------------
 * Em modo intervalo ("1 de agosto a 31 de outubro") NAO EXISTE "a fatura do
 * periodo": sao tres. A regra e o PRIMEIRO mes, e ela esta escrita aqui e
 * cobrada no teste por um motivo pratico -- `mesesDoPeriodo` devolve a lista
 * inteira, e `[0]`, `[length-1]` e "o mes que contem hoje" sao todos defensaveis
 * em prosa. Com a regra implicita, cada caminho que precisasse dela escolheria
 * um, e a mesma tela lancaria em faturas diferentes dependendo de onde o padrao
 * foi calculado.
 *
 * O primeiro e nao o ultimo porque e o que o rotulo da tela de origem mostra
 * primeiro ("agosto a outubro"), e porque um periodo que termina no futuro
 * sugeriria uma fatura que ainda nao abriu.
 *
 * `agora` e parametro com default para que o teste CONGELE o relogio. Sem isso o
 * caso do padrao nao e afirmavel: ele muda de resposta todo dia 1.
 */
export function faturaPadraoDoLancamento(
  origem: string | null | undefined,
  agora: Date = new Date()
): string {
  const doPeriodo = mesDoPeriodoDaOrigem(origem);
  if (doPeriodo) return doPeriodo;
  return mesCorrenteDaFatura(agora);
}

/**
 * O primeiro mes do periodo que veio na origem, ou `null`.
 *
 * `periodoDaQuery` e quem le o par `?de=&ate=` -- e nao um regex local --
 * porque ele ja recusa o par pela metade, o par invertido (`de > ate`) e a data
 * que nao e data, devolvendo `"invalido"`. Reimplementar isso aqui faria o
 * formulario aceitar um periodo que a tela de origem recusa.
 *
 * Toda recusa cai no mesmo lugar (`null` -> o mes corrente), e isso e
 * deliberado: a origem e um parametro de URL que qualquer um pode escrever, e
 * nao ha o que fazer com um periodo ilegivel alem de ignora-lo. O que NAO pode
 * acontecer e ele virar um mes qualquer.
 */
function mesDoPeriodoDaOrigem(origem: string | null | undefined): string | null {
  if (!origem) return null;

  const inicioDaQuery = origem.indexOf("?");
  if (inicioDaQuery === -1) return null;

  // `URLSearchParams` e nao um split proprio: ele decodifica o percent-encoding,
  // e a origem CHEGA codificada (`comOrigem` faz `encodeURIComponent`). Quem
  // lesse a string crua acharia `de=2026-10-01` so quando ela nao precisasse ser
  // decodificada, o que e o caso facil e nao o caso real.
  const query = new URLSearchParams(origem.slice(inicioDaQuery + 1));
  const periodo = periodoDaQuery(query.get("de"), query.get("ate"));
  if (periodo === null || periodo === "invalido") return null;

  // `mesesDoPeriodo` devolve 'AAAA-MM-01'; o seletor fala 'AAAA-MM'.
  const meses = mesesDoPeriodo(periodo);
  if (meses.length === 0) return null;
  return meses[0].slice(0, 7);
}

/**
 * Os meses que o `<select>` oferece: 3 para tras e 3 para frente do padrao.
 *
 * `escolhido` entra na lista mesmo quando cai FORA da janela, e isso nao e
 * zelo: na EDICAO de uma compra antiga o valor gravado pode ser de um ano atras.
 * Um `<select>` cujo `value` nao casa com nenhuma `<option>` nao mostra vazio --
 * ele mostra a PRIMEIRA opcao como se fosse a escolhida, e a tela passaria a
 * afirmar uma fatura que nao e a gravada. Salvar sem tocar no campo moveria a
 * compra de fatura sozinho.
 *
 * Ordenada do mes mais antigo para o mais novo, e sem repetidos.
 */
export function janelaDeFaturas(
  padrao: string,
  escolhido?: string | null
): string[] {
  const meses = new Set<string>();

  // PADRAO ILEGIVEL NAO VIRA JANELA. `andarMeses("")` faz aritmetica com `NaN` e
  // devolveria sete opcoes "NaN-NaN" -- um seletor cheio de lixo clicavel, com
  // `rotuloDaFatura` devolvendo `null` em todas. Lista vazia e a resposta
  // honesta: sobra a opcao "pela data da compra", que e o comportamento da 006.
  if (/^\d{4}-\d{2}$/.test(padrao)) {
    for (let passo = -FATURAS_PARA_TRAS; passo <= FATURAS_PARA_FRENTE; passo++) {
      meses.add(andarMeses(padrao, passo));
    }
  }

  // Normalizado para 'AAAA-MM' porque o que volta do banco e 'AAAA-MM-01': sem
  // o recorte, o valor gravado entraria na lista numa forma que nunca casa com
  // o `value` da opcao, e seria o mesmo defeito de nao estar na lista.
  if (escolhido && /^\d{4}-\d{2}/.test(escolhido)) {
    meses.add(escolhido.slice(0, 7));
  }

  // `Array.from` e nao `[...meses]`: o `target` do tsconfig do APP e anterior a
  // es2015, e espalhar um `Set` ali e TS2802. A suite nao pega -- o tsconfig dela
  // compila em es2020 --, entao o erro so aparece no `tsc` do repositorio.
  return Array.from(meses).sort();
}

// ---------------------------------------------------------------------------
// ESCOLHER A FATURA, E ESCOLHER O CARTAO
// ---------------------------------------------------------------------------

/**
 * A fatura DAQUELE cartao na resposta da rota.
 *
 * `find` por `account_id`, nunca `[0]`: ver a decisao 1 no topo do arquivo.
 */
export function faturaDoCartao(
  faturas: CardInvoice[] | null | undefined,
  accountId: string
): CardInvoice | null {
  if (!faturas || !accountId) return null;
  return faturas.find((f) => f.account_id === accountId) ?? null;
}

/**
 * As linhas da fatura, recusando o que nao e daquele cartao.
 *
 * A rota ja filtra por `account_id` e `faturaDoCartao` ja escolheu por id --
 * este terceiro filtro existe porque e a afirmacao da tela ("os gastos que
 * estao NELE") e ela nao custa nada. Se a view passar a devolver a linha de
 * outro cartao dentro do mesmo grupo, a lista nao a mostra.
 */
export function gastosDaFatura(
  fatura: CardInvoice | null,
  accountId: string
): CardInvoiceLine[] {
  if (!fatura) return [];
  return (fatura.lines ?? []).filter((l) => l.account_id === accountId);
}

/**
 * As previsoes PENDENTES daquele cartao que nao sao a fatura (HMO-227).
 *
 * O bloco existe porque a HMO-209 tirou essas linhas de Contas a Pagar dizendo
 * que elas "passam a aparecer na tela do cartao" -- e elas nao apareciam nem
 * aqui nem la: `card_invoice_lines` so ve lancamento, e a consulta de previsoes
 * de `GET /api/card-invoices` so pegava `notes` de fatura. Ficaram gravadas sem
 * leitor nenhum, que e o pior lugar para um dado estar.
 *
 * `null` E "NAO DEU PARA LER", e nao "nenhuma". `scheduled_pending` vem
 * `undefined` quando aquela consulta falhou, e a diferenca importa na frase:
 * "este cartao nao tem nenhuma previsao pendente" dita sobre uma leitura que
 * falhou e da mesma familia do "Nada em atraso." sem rede. Quem recebe `null`
 * diz que nao conseguiu conferir.
 *
 * O filtro por `account_id` repete o que a rota ja fez, pela mesma razao de
 * `gastosDaFatura`: e a afirmacao da tela, e nao custa nada.
 */
export function previsoesDoCartao(
  fatura: CardInvoice | null,
  accountId: string
): ScheduledTransaction[] | null {
  if (!fatura?.scheduled_pending) return null;
  return fatura.scheduled_pending.filter((p) => p.account_id === accountId);
}

/**
 * O cartao da URL, se ele for do usuario.
 *
 * `null` e "nao e seu, ou nao existe" -- os dois merecem a mesma tela, porque
 * distinguir os dois contaria a um estranho que aquele id existe.
 */
export function cartaoDaTela<
  T extends { id: string; account_type?: string | null },
>(cartoes: T[] | null | undefined, id: string | null | undefined): T | null {
  if (!cartoes || !id) return null;
  return (
    cartoes.find((c) => c.id === id && c.account_type === "credit_card") ?? null
  );
}

// ---------------------------------------------------------------------------
// AS DUAS LEITURAS, NA MAIS PESSIMISTA
// ---------------------------------------------------------------------------
// Do pior para o melhor. `null` (ainda carregando) nao esta na lista de
// proposito: ele vence todos, porque durante o carregamento nao da para afirmar
// nem R$ 0,00 nem "nenhum gasto" -- e o que `podeMostrarNumero(null)` ja diz.
const GRAVIDADE: EstadoDaLeitura[] = [
  "sessao-recusada",
  "sem-rede",
  "erro-do-servidor",
  "do-aparelho",
  "fresco",
];

/**
 * O estado que vale para a tela quando ela faz mais de uma leitura.
 *
 * Esta tela le o cadastro do cartao (`/api/financial-accounts`) e a fatura
 * (`/api/card-invoices`). Mostrar numero exige que as DUAS tenham dado:
 * a fatura falhando com o cadastro fresco imprimiria "R$ 0,00" de uma fatura
 * nao lida, embaixo do nome do cartao certo -- indistinguivel de um mes sem
 * compra nenhuma.
 */
export function estadoDaTela(
  estados: (EstadoDaLeitura | null)[]
): EstadoDaLeitura | null {
  if (estados.length === 0) return null;
  // Ainda carregando vence: nao ha o que afirmar enquanto falta resposta.
  if (estados.some((e) => e === null)) return null;

  let pior = estados[0] as EstadoDaLeitura;
  for (const estado of estados as EstadoDaLeitura[]) {
    if (GRAVIDADE.indexOf(estado) < GRAVIDADE.indexOf(pior)) pior = estado;
  }
  return pior;
}

// ---------------------------------------------------------------------------
// O CABECALHO
// ---------------------------------------------------------------------------

/**
 * "Fecha dia 5 · vence dia 15", ou `null` quando o cartao nao fecha fatura.
 *
 * `null` nao e cosmetico: sem os dois dias o `card_invoice_month()` trata toda
 * compra como do proprio mes, e a compra do dia 28 aparece no mes errado. Quem
 * recebe `null` mostra a tarja de aviso que a tela de cartoes ja mostra.
 */
export function rotuloDoCiclo(conta: {
  closing_day?: number | null;
  due_day?: number | null;
}): string | null {
  if (!conta.closing_day || !conta.due_day) return null;
  return `Fecha dia ${conta.closing_day} · vence dia ${conta.due_day}`;
}
