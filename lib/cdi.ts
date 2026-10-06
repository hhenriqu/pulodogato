// ---------------------------------------------------------------------------
// A CONVERSA COM O SGS DO BANCO CENTRAL (HMO-192)
// ---------------------------------------------------------------------------
// Este e o unico lugar do app que fala com `api.bcb.gov.br`. Ele existe separado
// de lib/renda-fixa.ts (puro e testavel) e de /api/investments/renda-fixa (uma
// tela de HTTP) pela mesma razao que lib/ptax.ts existe separado de
// lib/cambio.ts: a regra de "qual boletim vale" nao pode ter duas copias.
//
// Sem chave, sem cadastro, sem cota:
//
//   https://api.bcb.gov.br/dados/serie/bcdata.sgs.{N}/dados?formato=json
//     &dataInicial=DD/MM/YYYY&dataFinal=DD/MM/YYYY
//
//   serie 12   CDI ao dia      (0,050788% em 25, 28 e 29/09/2026)
//   serie 11   Selic ao dia    (mesmo formato, mesma escala)
//   serie 4389 CDI ao ano      (13,65% -- usada so para conferir: 1,00050788 ^ 252 = 1,13650)
//
// ===========================================================================
// A ARMADILHA, E POR QUE COPIAR lib/ptax.ts AO PE DA LETRA QUEBRARIA
// ===========================================================================
// Dia nao util nao tem boletim. Isso ja era sabido. O que foi MEDIDO aqui em
// 2026-10-06, contra o endpoint de verdade, e COMO essa ausencia chega:
//
//   dataInicial=26/09/2026&dataFinal=26/09/2026   (sabado)
//     -> HTTP 404  {"erro":{"statusCode":404,"detail":"... Value(s) not found"}}
//
// NAO e `{"value":[]}` com HTTP 200, que e como a PTAX responde no Olinda (ver
// lib/ptax.ts) e como esta issue descrevia. E um 404.
//
// Isso inverte o sinal que lib/ptax.ts usa para decidir o que fazer: la,
// `!resposta.ok` significa "falha de rede, PARE de andar para tras", e lista
// vazia significa "feriado, ANDE para tras". Aqui as duas coisas chegam pelo
// MESMO 404. Um cliente copiado de lib/ptax.ts sem olhar trataria todo fim de
// semana como falha de rede e desistiria -- e a tela de renda fixa mostraria
// "Banco Central indisponivel" de sabado a domingo, toda semana, com o Banco
// Central no ar.
//
// A saida nao e adivinhar pelo corpo do 404: e NUNCA PEDIR UM DIA SO. Toda
// consulta aqui e por FAIXA, e uma faixa de duas semanas contem dia util em
// qualquer calendario brasileiro. Com isso:
//
//   - o fim de semana desaparece dentro da faixa, sem laco de "andar para tras";
//   - um 404 numa faixa longa volta a significar o que parece significar;
//   - e uma requisicao HTTP resolve, em vez de quatro.
//
// A segunda metade da armadilha e de leitura, nao de rede: o valor ausente do
// sabado NAO e "rendeu zero". Nao ha linha para o sabado porque o CDI nao rende
// no sabado -- o fator do dia e 1, nao 0. Quem preenche o buraco com zero nao
// apaga rendimento (multiplicar por 1 + 0 e inofensivo no produto), mas inventa
// um dia util, e e isso que desloca a contagem de 252 do prefixado. Ver
// `normalizarSerie` e `diasNoPeriodo` em lib/renda-fixa.ts.
// ---------------------------------------------------------------------------

import {
  type DiaDaSerie,
  dataParaSgs,
  normalizarSerie,
} from "@/lib/renda-fixa";

/** CDI ao dia. */
export const SERIE_CDI_DIARIO = 12;
/** Selic ao dia -- mesmo formato e mesma escala do CDI. */
export const SERIE_SELIC_DIARIA = 11;
/** CDI ao ano. So para conferencia cruzada: 1,00050788 ^ 252 = 1,13650. */
export const SERIE_CDI_ANUAL = 4389;

/** Qual serie do SGS alimenta cada indexador que o app sabe projetar. */
export const SERIE_DO_INDEXADOR: Record<string, number> = {
  cdi: SERIE_CDI_DIARIO,
  selic: SERIE_SELIC_DIARIA,
  // Prefixado nao tem indice, mas precisa de um CALENDARIO de dias uteis, e a
  // serie 12 e exatamente isso: um boletim em todo dia util e em nenhum outro.
  // Ver o comentario em projetarRendimento (lib/renda-fixa.ts).
  prefixado: SERIE_CDI_DIARIO,
};

const SGS = "https://api.bcb.gov.br/dados/serie";

/** Quanto esperar o Banco Central. Mesma ordem de grandeza de lib/ptax.ts. */
const TIMEOUT_MS = 6000;

/**
 * Quantos dias para tras pedir quando se quer "a taxa de hoje".
 *
 * Catorze cobre o feriado mais longo do calendario brasileiro (Natal e Ano Novo
 * caindo em fim de semana) sem pedir historico que ninguem vai usar.
 */
export const JANELA_DE_DIAS = 14;

export type RespostaDaSerie =
  | { ok: true; serie: DiaDaSerie[] }
  /**
   * O Banco Central respondeu que nao ha boletim na faixa. Numa faixa curta isso
   * e legitimo (aplicou ontem, e ontem era sabado); numa faixa longa e sintoma.
   * Quem chama decide, porque so quem chama sabe o tamanho da faixa que pediu.
   */
  | { ok: false; motivo: "sem_boletim" }
  | { ok: false; motivo: "indisponivel" };

/** Hoje em "YYYY-MM-DD", no fuso de Brasilia -- o calendario do SGS. */
export function hojeEmBrasilia(): string {
  return new Date()
    .toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
    .slice(0, 10);
}

/** Uma data ISO deslocada em `dias` (negativo anda para tras). */
export function deslocarISO(iso: string, dias: number): string {
  const base = Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10))
  );
  return new Date(base + dias * 86400000).toISOString().slice(0, 10);
}

/**
 * A serie diaria de `numero` entre duas datas, ordenada e em ISO.
 *
 * Nunca lanca. Falha do Banco Central volta como `ok: false`, e quem chamou
 * decide o que a tela diz -- a mesma promessa de `cotacaoNaData` em lib/ptax.ts.
 */
export async function serieDiaria(
  numero: number,
  deISO: string,
  ateISO: string
): Promise<RespostaDaSerie> {
  // Faixa invertida devolveria 404 e se leria como feriado. Barrar aqui e mais
  // honesto do que mandar e interpretar o erro.
  if (deISO > ateISO) return { ok: false, motivo: "sem_boletim" };

  const url =
    `${SGS}/bcdata.sgs.${numero}/dados?formato=json` +
    `&dataInicial=${dataParaSgs(deISO)}&dataFinal=${dataParaSgs(ateISO)}`;

  try {
    const resposta = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
      // A taxa de um dia fechado nunca muda, e a de hoje sai uma vez por dia.
      // Uma hora de cache poupa o Banco Central sem risco de servir numero
      // velho: o pior caso e a tela mostrar o rendimento de ontem por mais uma
      // hora, contra uma requisicao por pageview.
      //
      // `next.revalidate` e extensao do Next ao RequestInit, e a declaracao dela
      // vem de next-env.d.ts -- que o tsconfig da suite (que compila so este
      // arquivo e lib/renda-fixa.ts) nao carrega. O `as RequestInit` e o que
      // mantem `npm run test:renda-fixa` compilando sem arrastar os tipos do
      // Next para dentro do build do teste.
      ...({ next: { revalidate: 3600 } } as RequestInit),
    });

    // 404 com corpo de erro e o que o SGS devolve para "nenhum boletim na
    // faixa" -- incluindo um fim de semana inteiro. Ver o cabecalho: e o
    // contrario da PTAX, e e a razao de toda consulta aqui ser por faixa.
    if (resposta.status === 404) return { ok: false, motivo: "sem_boletim" };
    if (!resposta.ok) return { ok: false, motivo: "indisponivel" };

    const serie = normalizarSerie(await resposta.json());
    if (serie.length === 0) return { ok: false, motivo: "sem_boletim" };

    return { ok: true, serie };
  } catch {
    // Timeout, DNS, TLS, JSON quebrado. Juntos de proposito: para a tela a
    // diferenca nao muda a frase.
    return { ok: false, motivo: "indisponivel" };
  }
}

/**
 * A serie que cobre o periodo de um ativo, de `inicioISO` ate hoje.
 *
 * O `- JANELA_DE_DIAS` na borda esquerda nao e folga: um ativo aplicado na
 * sexta-feira pede uma faixa de tres dias que pode nao ter dia util nenhum
 * (sexta feriado, sabado, domingo), e o 404 dessa faixa diria "indisponivel"
 * para um ativo em que so falta o mercado abrir. Alargar a faixa para tras
 * custa nada -- `diasNoPeriodo` descarta o que e anterior ao inicio -- e troca
 * um falso "indisponivel" por um "rendeu nada ainda" correto.
 */
export async function serieDoPeriodo(
  indexador: string,
  inicioISO: string,
  hojeISO: string = hojeEmBrasilia()
): Promise<RespostaDaSerie> {
  const numero = SERIE_DO_INDEXADOR[indexador];
  if (numero === undefined) return { ok: false, motivo: "indisponivel" };

  const de = deslocarISO(
    inicioISO < hojeISO ? inicioISO : hojeISO,
    -JANELA_DE_DIAS
  );
  return serieDiaria(numero, de, hojeISO);
}

/**
 * A taxa diaria mais recente de uma serie -- "quanto o CDI esta rendendo hoje".
 *
 * Pede uma faixa de duas semanas e pega o ultimo boletim DELA, que e por que
 * sabado e feriado nao aparecem como falha. Pedir `dataInicial = dataFinal =
 * hoje` num sabado devolve 404, e e esse 404 que um cliente ingenuo mostraria
 * como "o Banco Central esta fora do ar".
 */
export async function taxaDiariaMaisRecente(
  numero: number = SERIE_CDI_DIARIO,
  hojeISO: string = hojeEmBrasilia()
): Promise<{ ok: true; dia: DiaDaSerie } | { ok: false; motivo: string }> {
  const r = await serieDiaria(
    numero,
    deslocarISO(hojeISO, -JANELA_DE_DIAS),
    hojeISO
  );
  if (!r.ok) return r;
  // `serie` ja vem ordenada por data -- ver `normalizarSerie`, e por que a
  // posicao crua da resposta nao serve.
  return { ok: true, dia: r.serie[r.serie.length - 1] };
}
