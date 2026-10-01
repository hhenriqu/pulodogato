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
