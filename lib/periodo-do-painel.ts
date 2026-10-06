// -----------------------------------------------------------------------------
// O PERIODO QUE O PAINEL ESTA OLHANDO
// -----------------------------------------------------------------------------
// Ate a HMO-173 a tela inicial nao tinha periodo: ela pedia "o mes" a cada rota
// e cada rota decidia sozinha qual mes era esse. O resultado nao era so falta
// de navegacao -- era um numero errado. `page.tsx` calculava o mes corrente com
// `new Date().toISOString().slice(0, 7)`, que e UTC, e o proprio arquivo
// documentava essa armadilha 110 linhas acima, para o helper `diaEMes`. Em
// America/Sao_Paulo (UTC-3), das 21:00 as 23:59 do ultimo dia do mes o valor ja
// era o mes SEGUINTE; como o resumo de contas previstas chega com janela de
// tres meses, o `find` ACHAVA a linha do mes seguinte e o tile "a vencer neste
// mes" exibia as contas de outubro no dia 30 de setembro. Sem erro, sem tile
// vazio, sem nada na tela dizendo que aquele numero era de outro mes.
//
// Por isso o mes corrente nasce de `today()` (lib/recurrence.ts), que e o
// mesmo Intl.DateTimeFormat em America/Sao_Paulo que as telas de bills,
// budgets e goals ja usavam. Nao ha um segundo calculo de "hoje" neste modulo,
// e nao deve haver: duas definicoes de hoje discordam exatamente nas tres
// horas em que ninguem esta olhando.
//
// MODO MES x MODO INTERVALO, E POR QUE A DISTINCAO NAO E COSMETICA
// ----------------------------------------------------------------
// `monthly_cash_flow`, `planned_vs_actual` e o resumo de contas previstas tem
// grao de MES: sao rollups por `date_trunc('month', ...)`. Um periodo como
// 15/09 a 20/10 nao sai de rollup mensal -- somar os dois meses inteiros
// responderia uma pergunta diferente da que foi feita, com numeros maiores e
// nenhum aviso.
//
// Entao o periodo se classifica sozinho: quando comeca no primeiro dia de um
// mes E termina no ultimo dia de um mes, ele e uma uniao de meses inteiros e
// as views respondem. Qualquer outro recorte e intervalo, e a resposta tem que
// vir de `financial_transactions` agregada por data.
// -----------------------------------------------------------------------------

import { addMonthsClamped, today } from "@/lib/recurrence";
import { MOEDA_PADRAO } from "@/lib/dinheiro";
import { moedaSugerida, resumirPorMoeda } from "@/lib/moeda";

/** De onde a resposta pode sair: rollup mensal ou agregacao por data. */
export type ModoDePeriodo = "mes" | "intervalo";

/** Um periodo fechado, nos dois extremos, em 'AAAA-MM-DD'. */
export interface Periodo {
  /** Primeiro dia, INCLUSIVE. */
  de: string;
  /** Ultimo dia, INCLUSIVE. */
  ate: string;
  modo: ModoDePeriodo;
}

const FORMATO_ISO = /^\d{4}-\d{2}-\d{2}$/;

const MESES_PT = [
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
];

/**
 * Quantos dias tem o mes. `Date.UTC(ano, mes, 0)` e o dia 0 do mes SEGUINTE,
 * que o Postgres e o JavaScript concordam em chamar de ultimo dia deste.
 */
function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/**
 * Valida 'AAAA-MM-DD' de verdade, e nao so o formato.
 *
 * O teste do dia importa: '2026-02-31' casa com a expressao regular e, se
 * passasse, viraria um `de` maior que o `ate` depois do primeiro passo de mes
 * -- um periodo vazio que a tela mostraria como "nao ha nada neste mes".
 */
export function ehDataIso(valor: unknown): valor is string {
  if (typeof valor !== "string" || !FORMATO_ISO.test(valor)) return false;
  const ano = Number(valor.slice(0, 4));
  const mes = Number(valor.slice(5, 7));
  const dia = Number(valor.slice(8, 10));
  if (mes < 1 || mes > 12) return false;
  return dia >= 1 && dia <= diasNoMes(ano, mes);
}

/** O primeiro dia do mes a que a data pertence. */
export function primeiroDiaDoMes(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** O ultimo dia do mes a que a data pertence. */
export function ultimoDiaDoMes(iso: string): string {
  const dias = diasNoMes(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)));
  return `${iso.slice(0, 7)}-${String(dias).padStart(2, "0")}`;
}

/**
 * Meses inteiros ou recorte solto.
 *
 * Note que "meses inteiros" no plural: 01/07 a 30/09 e modo mes, porque as
 * views tem as tres linhas e somar as tres responde exatamente a pergunta.
 */
export function modoDoPeriodo(de: string, ate: string): ModoDePeriodo {
  const comecaNoPrimeiro = de === primeiroDiaDoMes(de);
  const terminaNoUltimo = ate === ultimoDiaDoMes(ate);
  return comecaNoPrimeiro && terminaNoUltimo ? "mes" : "intervalo";
}

/** O periodo do mes a que a data pertence. */
export function periodoDoMes(iso: string): Periodo {
  return {
    de: primeiroDiaDoMes(iso),
    ate: ultimoDiaDoMes(iso),
    modo: "mes",
  };
}

/** O mes corrente em America/Sao_Paulo -- o estado inicial do painel. */
export function periodoCorrente(hoje: string = today()): Periodo {
  return periodoDoMes(hoje);
}

/**
 * Traduz `?de=&ate=` num periodo, com o mes corrente como rede.
 *
 * Cai no mes corrente em vez de dar erro porque o destino e a tela inicial:
 * um link antigo, um parametro cortado no meio pelo aplicativo de mensagem ou
 * um `ate` anterior ao `de` nao podem virar painel em branco. A escolha do
 * usuario se perde -- ele ve o mes corrente e o seletor no topo --, o dinheiro
 * dele nao.
 */
export function lerPeriodo(
  de: unknown,
  ate: unknown,
  hoje: string = today()
): Periodo {
  if (!ehDataIso(de) || !ehDataIso(ate)) return periodoCorrente(hoje);
  if (de > ate) return periodoCorrente(hoje);
  return { de, ate, modo: modoDoPeriodo(de, ate) };
}

/** O periodo como querystring, na ordem fixa que o `lerPeriodo` espera. */
export function periodoParaQuery(periodo: Periodo): string {
  return `de=${periodo.de}&ate=${periodo.ate}`;
}

// -----------------------------------------------------------------------------
// O PAR PERSONALIZADO ENQUANTO ESTA SENDO DIGITADO (HMO-240)
// -----------------------------------------------------------------------------
// O seletor trocou os dois `<input type="date">` pelo campo mascarado da
// HMO-238, e a troca abre um problema que nenhuma das outras cinco telas tem.
//
// Nas outras, o `onChange` do campo cai direto num `setState`: o formulario
// aceita o vazio que a data pela metade emite, guarda, e o campo continua
// mostrando o que foi digitado. Aqui o par NAO alimenta formulario -- ele
// alimenta o filtro do painel, e o filtro nao pode disparar com data
// incompleta: um `de` vazio faria `lerPeriodo` cair no mes corrente e a tela
// pularia para outubro no meio da digitacao.
//
// Entao o periodo do pai IGNORA o vazio. E as duas coisas, cada uma correta
// sozinha, se cancelam: o rascunho do campo (ver `exibicaoDoCampo` em
// lib/data-digitada.ts) so vale enquanto o valor do pai for exatamente o que
// aquele texto emitiu, e aqui o pai nunca aceita o vazio -- a exibicao voltaria
// para a data antiga A CADA TECLA e o campo ficaria impossivel de digitar.
//
// O rascunho do PAR e o que fecha esse buraco: ele guarda o que os dois campos
// emitiram, inclusive vazio, e sobe para o filtro so quando os dois lados
// formam periodo valido.
//
// POR QUE ELE TEM UMA `base`, E NAO E SO UM PAR DE STRINGS
// --------------------------------------------------------
// Pela mesma razao que o rascunho do campo e subordinado ao valor: senao a tela
// passa a ter duas fontes de verdade e o campo mostra o texto antigo com o
// periodo novo por baixo. As setas, o botao "Hoje" e os presets mudam o periodo
// SEM ninguem digitar, e e o `base` -- o periodo sobre o qual a digitacao
// comecou -- que faz o rascunho deixar de valer sozinho nesse instante, sem
// `useEffect` de sincronizacao.
//
// Quando a data completa sobe, o periodo muda, o `base` discorda e a exibicao
// volta a sair do periodo: que e exatamente o par que acabou de ser digitado.
// -----------------------------------------------------------------------------

/** O par de datas que os campos do modo personalizado estao mostrando. */
export interface RascunhoDoPar {
  /** O que o campo inicial emitiu. Vazio enquanto a data esta pela metade. */
  de: string;
  /** O que o campo final emitiu. Vazio enquanto a data esta pela metade. */
  ate: string;
  /** O periodo sobre o qual a digitacao comecou, por `chaveDoPeriodo`. */
  base: string;
}

/**
 * A identidade do periodo para efeito de subordinacao do rascunho.
 *
 * So `de` e `ate` entram: `modo` e derivado dos dois (ver `modoDoPeriodo`) e
 * incluir um campo derivado na chave nao distingue nada que os dois extremos ja
 * nao distingam.
 */
export function chaveDoPeriodo(periodo: Periodo): string {
  return `${periodo.de}|${periodo.ate}`;
}

/** O par que os dois campos devem MOSTRAR: o rascunho, se ainda vale. */
export function parDoSeletor(
  rascunho: RascunhoDoPar | null,
  periodo: Periodo
): { de: string; ate: string } {
  if (rascunho && rascunho.base === chaveDoPeriodo(periodo)) {
    return { de: rascunho.de, ate: rascunho.ate };
  }
  return { de: periodo.de, ate: periodo.ate };
}

/**
 * O que digitar num dos extremos produz: o rascunho novo e, so quando o par
 * fecha, o periodo para subir ao filtro.
 *
 * `par: null` e a resposta normal no meio da digitacao -- data incompleta, e
 * tambem o par INVERTIDO, que acontece toda vez que alguem move o `de` para
 * depois do `ate` antes de arrumar o outro lado. Nos dois casos quem chamou nao
 * pode avisar o painel: `lerPeriodo` devolveria o mes corrente e a tela pularia
 * de mes sozinha enquanto a pessoa ainda estava digitando.
 */
export function extremoDigitado(
  rascunho: RascunhoDoPar | null,
  periodo: Periodo,
  qual: "de" | "ate",
  valor: string
): { rascunho: RascunhoDoPar; par: { de: string; ate: string } | null } {
  // O par que esta na tela ANTES desta tecla. Sai de `parDoSeletor` e nao de
  // `periodo` porque o outro extremo pode estar no meio de uma edicao propria:
  // ler do periodo apagaria o que ja foi digitado nele.
  const atual = parDoSeletor(rascunho, periodo);
  const de = qual === "de" ? valor : atual.de;
  const ate = qual === "ate" ? valor : atual.ate;

  const proximo: RascunhoDoPar = { de, ate, base: chaveDoPeriodo(periodo) };

  if (!ehDataIso(de) || !ehDataIso(ate) || de > ate) {
    return { rascunho: proximo, par: null };
  }
  return { rascunho: proximo, par: { de, ate } };
}

/**
 * A versao para as ROTAS, que distingue ausente de invalido.
 *
 * A diferenca com `lerPeriodo` e deliberada. Na tela, um parametro corrompido
 * vira o mes corrente: painel em branco seria pior. Numa rota, o mesmo silencio
 * responderia numeros de setembro a quem pediu julho, e quem chamou nao teria
 * como saber -- entao aqui isso vira 400.
 *
 *   * `null`        -> a chamada nao pediu periodo (comportamento antigo, por `months`)
 *   * `"invalido"`  -> pediu errado, e a rota deve responder 400
 */
export function periodoDaQuery(
  de: string | null,
  ate: string | null
): Periodo | "invalido" | null {
  if (de == null && ate == null) return null;
  // Metade do par tambem e invalido: um `?de=` sozinho nao descreve periodo
  // nenhum, e completar o outro extremo por conta propria seria a rota
  // respondendo uma pergunta que ninguem fez.
  if (!ehDataIso(de) || !ehDataIso(ate)) return "invalido";
  if (de > ate) return "invalido";
  return { de, ate, modo: modoDoPeriodo(de, ate) };
}

/**
 * Anda `passo` meses, preservando o tamanho da janela.
 *
 * O INICIO nao precisa de cuidado nenhum: em modo mes ele ja e dia 1 por
 * definicao (ver `modoDoPeriodo`), e somar meses a um dia 1 devolve um dia 1.
 * Em modo intervalo o clamp e justamente o comportamento desejado.
 *
 * O FIM precisa. `addMonthsClamped` so sabe empurrar o dia para tras quando
 * ele nao cabe: 31/01 mais um mes e 28/02, e dai em diante a janela ficaria
 * presa no dia 28 -- marco apareceria com 28 dos 31 dias, abril com 28 dos 30,
 * e a diferenca sairia dos tiles sem aparecer em lugar nenhum da tela. Em modo
 * mes o ultimo dia e RECALCULADO a partir do mes de destino, nao somado.
 *
 * O `modo` e recalculado em vez de herdado: e sempre `modoDoPeriodo` quem
 * responde de onde a resposta pode sair, aqui como em todo lugar.
 */
export function passoDeMes(periodo: Periodo, passo: number): Periodo {
  const de = addMonthsClamped(periodo.de, passo);
  const ate =
    periodo.modo === "mes"
      ? ultimoDiaDoMes(addMonthsClamped(periodo.ate, passo))
      : addMonthsClamped(periodo.ate, passo);

  return { de, ate, modo: modoDoPeriodo(de, ate) };
}

/** O periodo cobre o dia de hoje? */
export function contemHoje(periodo: Periodo, hoje: string = today()): boolean {
  return periodo.de <= hoje && hoje <= periodo.ate;
}

/** O periodo terminou antes de hoje? */
export function terminaNoPassado(
  periodo: Periodo,
  hoje: string = today()
): boolean {
  return periodo.ate < hoje;
}

/** O periodo e exatamente o mes corrente? (o botao "Hoje" some quando sim) */
export function ehPeriodoCorrente(
  periodo: Periodo,
  hoje: string = today()
): boolean {
  const corrente = periodoCorrente(hoje);
  return periodo.de === corrente.de && periodo.ate === corrente.ate;
}

// -----------------------------------------------------------------------------
// Os presets
// -----------------------------------------------------------------------------
// Sao atalhos, nao um tipo de periodo a parte: todos produzem um `Periodo`
// comum e, depois de escolhidos, andam com as setas como qualquer outro. Os
// quatro sao alinhados a mes de proposito -- inclusive "este ano" --, entao
// saem todos em modo mes e nenhum deles paga o custo da agregacao por data.

export type IdDePreset =
  | "este-mes"
  | "mes-passado"
  | "ultimos-3-meses"
  | "este-ano";

export const PRESETS: { id: IdDePreset; rotulo: string }[] = [
  { id: "este-mes", rotulo: "Este mês" },
  { id: "mes-passado", rotulo: "Mês passado" },
  { id: "ultimos-3-meses", rotulo: "Últimos 3 meses" },
  { id: "este-ano", rotulo: "Este ano" },
];

export function periodoDoPreset(
  id: IdDePreset,
  hoje: string = today()
): Periodo {
  if (id === "mes-passado") {
    return periodoDoMes(addMonthsClamped(primeiroDiaDoMes(hoje), -1));
  }

  if (id === "ultimos-3-meses") {
    // Inclui o mes corrente: "ultimos 3 meses" em 29/09 e julho, agosto e
    // setembro. Voltar tres meses inteiros a partir do mes passado deixaria o
    // mes que a pessoa esta vivendo de fora -- o recorte mais estranho
    // possivel para um atalho de tela inicial.
    return {
      de: primeiroDiaDoMes(addMonthsClamped(primeiroDiaDoMes(hoje), -2)),
      ate: ultimoDiaDoMes(hoje),
      modo: "mes",
    };
  }

  if (id === "este-ano") {
    const ano = hoje.slice(0, 4);
    return { de: `${ano}-01-01`, ate: `${ano}-12-31`, modo: "mes" };
  }

  return periodoCorrente(hoje);
}

/**
 * Qual preset corresponde a este periodo, se algum.
 *
 * Serve para o seletor abrir marcando o atalho certo quando o usuario chegou
 * por link. Sem isto, quem abrisse `?de=2026-09-01&ate=2026-09-30` veria o
 * seletor dizendo "personalizado" para o proprio mes corrente.
 */
export function presetDoPeriodo(
  periodo: Periodo,
  hoje: string = today()
): IdDePreset | null {
  for (const { id } of PRESETS) {
    const candidato = periodoDoPreset(id, hoje);
    if (candidato.de === periodo.de && candidato.ate === periodo.ate) return id;
  }
  return null;
}

// -----------------------------------------------------------------------------
// O ITEM "PERSONALIZADO" DO SELETOR (HMO-243)
// -----------------------------------------------------------------------------
// ATE ESTA ISSUE O ITEM ERA DECORATIVO. Escolher "Personalizado" no menu nao
// fazia nada: nenhum campo de data aparecia e o rotulo nao mudava. O par de
// datas so era alcancavel andando DOIS meses para tras com a seta -- um mes cai
// no preset "Mes passado", que tambem esconde os campos.
//
// A causa nao era o campo: era o fato de "personalizado" nao ser estado nenhum.
// O seletor DERIVAVA tudo do periodo (`presetDoPeriodo`), o handler do item
// tinha um `return` seco, e os campos renderizavam so quando `preset === null`.
// Escolher o item nao mudava o periodo; o periodo continuava casando com
// `este-mes`; `preset === null` nunca virava verdade. O ciclo fechava em si
// mesmo e nada na tela dizia isso.
//
// POR QUE NAO "MANDAR UM PERIODO QUE NAO CASA COM PRESET NENHUM"
// --------------------------------------------------------------
// Essa e a correcao de uma linha, e ela esta errada: mexer no periodo no
// instante em que a pessoa ABRE o menu muda os numeros da tela antes de ela ter
// escolhido data nenhuma. Escolher "escrever as datas a mao" e uma declaracao de
// intencao, nao um filtro -- e um filtro que dispara sozinho e exatamente o
// defeito que `extremoDigitado` (HMO-240) existe para impedir, pela outra porta.
//
// Entao "personalizado" passa a ser estado EXPLICITO, e o periodo nao se mexe.
//
// POR QUE A DECISAO MORA AQUI E NAO NO JSX
// ----------------------------------------
// `react-dom/server` nao enxerga handler nenhum: logica que viva so dentro de um
// `onValueChange` nao tem teste possivel neste repositorio sem navegador. Foi
// assim que o `return` seco atravessou revisao -- e com o comentario ao lado
// AFIRMANDO o contrario do que o codigo fazia ("so abre os dois campos"), que e
// o que quem leu o arquivo leu. Com a decisao em funcao pura, o teste de
// scripts/test-periodo-painel.mjs alcanca os quatro gestos.
// -----------------------------------------------------------------------------

/**
 * O valor do seletor que NAO descreve periodo nenhum.
 *
 * Ele e irmao dos `IdDePreset` na lista do menu e de propositalmente outro tipo:
 * os presets respondem "qual recorte", este responde "eu escolho as datas".
 */
export const VALOR_PERSONALIZADO = "personalizado";

/** O que o seletor sabe de si: o periodo (que mora na URL) e o modo a mao. */
export interface EstadoDoSeletor {
  periodo: Periodo;
  /** A pessoa pediu os campos, mesmo que o periodo ainda case com um preset. */
  personalizado: boolean;
}

/**
 * Os quatro gestos que podem mexer no periodo ou no modo a mao.
 *
 * `par` e o unico que chega com o periodo ja pronto: ele sai de
 * `extremoDigitado` + `lerPeriodo`, que e quem sabe recusar data pela metade e
 * par invertido. O que este ramo decide e so o MODO.
 */
export type GestoDoSeletor =
  | { tipo: "item"; valor: string }
  | { tipo: "passo"; meses: number }
  | { tipo: "hoje" }
  | { tipo: "par"; periodo: Periodo };

export interface EscolhaDoSeletor {
  /** O modo a mao DEPOIS do gesto. */
  personalizado: boolean;
  /** O periodo novo, ou `null` quando o gesto nao mexe em numero nenhum. */
  periodo: Periodo | null;
}

/** O valor e um dos presets de verdade? (e nao "personalizado", nem lixo) */
function ehIdDePreset(valor: string): valor is IdDePreset {
  return PRESETS.some((p) => p.id === valor);
}

/**
 * O que cada gesto do seletor faz com o periodo e com o modo a mao.
 *
 * AS SETAS E O "HOJE" LIMPAM O MODO. Os dois voltam para um periodo que casa com
 * preset, e insistir no modo a mao ali deixaria os campos abertos mostrando um
 * par que a pessoa nao digitou -- ela saiu do modo de proposito, clicando noutro
 * controle. Esta escolha e deliberada e esta fixada em teste; se um dia virar o
 * contrario, e aqui e no teste que a troca aparece, e nao num `useState` perdido
 * no meio do JSX.
 *
 * VALOR DESCONHECIDO NAO MEXE EM NADA. Nao ha caminho de tela que produza um,
 * mas cair em `periodoDoPreset` com lixo devolveria o mes corrente -- o seletor
 * REFILTRANDO a tela por causa de um valor que ninguem reconheceu.
 */
export function escolhaDoSeletor(
  gesto: GestoDoSeletor,
  estado: EstadoDoSeletor,
  hoje: string = today()
): EscolhaDoSeletor {
  if (gesto.tipo === "passo") {
    return {
      personalizado: false,
      periodo: passoDeMes(estado.periodo, gesto.meses),
    };
  }

  if (gesto.tipo === "hoje") {
    return { personalizado: false, periodo: periodoCorrente(hoje) };
  }

  // Digitar um par a mao E estar no modo a mao. Sem isto, um par digitado que
  // por acaso casa com um preset (01 a 31 do mes corrente) fecharia os campos
  // embaixo da propria pessoa que acabou de escrever as datas.
  if (gesto.tipo === "par") {
    return { personalizado: true, periodo: gesto.periodo };
  }

  // O item do menu. `periodo: null` e o ponto desta issue: abrir os campos NAO
  // e refiltrar a tela.
  if (gesto.valor === VALOR_PERSONALIZADO) {
    return { personalizado: true, periodo: null };
  }

  if (ehIdDePreset(gesto.valor)) {
    return {
      personalizado: false,
      periodo: periodoDoPreset(gesto.valor, hoje),
    };
  }

  return { personalizado: estado.personalizado, periodo: null };
}

/**
 * O item que o seletor mostra fechado.
 *
 * O modo a mao vence o preset de proposito: no instante seguinte a escolher
 * "Personalizado" o periodo AINDA casa com `este-mes` -- e era justamente o
 * `preset ?? PERSONALIZADO` sozinho que fazia o menu voltar a dizer "Este mes"
 * depois do clique, como se nada tivesse acontecido.
 */
export function valorDoSeletor(
  preset: IdDePreset | null,
  personalizado: boolean
): string {
  if (personalizado) return VALOR_PERSONALIZADO;
  return preset ?? VALOR_PERSONALIZADO;
}

/**
 * Os dois campos de data estao na tela?
 *
 * As duas razoes sao independentes: `preset === null` e "o periodo nao tem nome"
 * (chegou por link, ou por duas setas para tras), e `personalizado` e "a pessoa
 * pediu". Exigir as duas juntas e o defeito da HMO-243; exigir so a primeira
 * tambem.
 */
export function camposAbertos(
  preset: IdDePreset | null,
  personalizado: boolean
): boolean {
  return preset === null || personalizado;
}

// -----------------------------------------------------------------------------
// O rotulo
// -----------------------------------------------------------------------------
// Ele aparece entre as duas setas e e o unico lugar da tela que diz QUAL
// periodo os numeros abaixo respondem. Um rotulo generico ("periodo
// selecionado") devolveria a tela ao problema que esta issue existe para
// resolver: numero certo, pergunta desconhecida.
//
// Os nomes dos meses estao escritos aqui em vez de virem de `Intl`: o rotulo
// entra em asserção de teste, e depender da base de dados de locale do Node
// faz o mesmo teste passar numa maquina e falhar noutra sem que nada no codigo
// tenha mudado.

function nomeDoMes(iso: string): string {
  return MESES_PT[Number(iso.slice(5, 7)) - 1];
}

function diaMesAno(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function rotuloDoPeriodo(periodo: Periodo): string {
  if (periodo.modo === "intervalo") {
    return `${diaMesAno(periodo.de)} a ${diaMesAno(periodo.ate)}`;
  }

  const anoDe = periodo.de.slice(0, 4);
  const anoAte = periodo.ate.slice(0, 4);

  if (
    anoDe === anoAte &&
    periodo.de.endsWith("-01-01") &&
    periodo.ate.endsWith("-12-31")
  ) {
    return `ano de ${anoDe}`;
  }

  if (periodo.de.slice(0, 7) === periodo.ate.slice(0, 7)) {
    return `${nomeDoMes(periodo.de)} de ${anoDe}`;
  }

  if (anoDe === anoAte) {
    return `${nomeDoMes(periodo.de)} a ${nomeDoMes(periodo.ate)} de ${anoAte}`;
  }

  return `${nomeDoMes(periodo.de)} de ${anoDe} a ${nomeDoMes(
    periodo.ate
  )} de ${anoAte}`;
}

/** Os meses do periodo, em 'AAAA-MM-01' -- a chave das views do 008. */
export function mesesDoPeriodo(periodo: Periodo): string[] {
  const meses: string[] = [];
  let mes = primeiroDiaDoMes(periodo.de);
  const ultimo = primeiroDiaDoMes(periodo.ate);
  while (mes <= ultimo) {
    meses.push(mes);
    mes = addMonthsClamped(mes, 1);
  }
  return meses;
}

// -----------------------------------------------------------------------------
// A agregacao por data (modo intervalo)
// -----------------------------------------------------------------------------
// ESTE E O PONTO DO ARQUIVO QUE PODE MENTIR EM SILENCIO.
//
// `category_monthly_totals` (008) filtra `transaction_type IN ('expense',
// 'income')`. Esse filtro nao e otimizacao: uma transferencia entre contas
// proprias e gravada como DUAS pernas, uma saindo e outra entrando, e o
// pagamento de fatura de cartao tambem (HMO-149). Sem repetir o filtro aqui, as
// duas pernas entram na soma e inflam receita E despesa pelo mesmo valor --
// deixando o `net` EXATO.
//
// Esse e o pior sintoma possivel. Quem confere o resultado ve o saldo do
// periodo bater, conclui que a conta esta certa e nunca olha os dois tiles de
// cima, que estao errados. Por isso o teste desta funcao tem transferencia no
// fixture: um fixture so com receita e despesa passa verde com o bug de pe.

/** Os unicos tipos que sao dinheiro entrando ou saindo do patrimonio. */
export const TIPOS_DE_FLUXO = ["expense", "income"] as const;

export interface LinhaDeTransacao {
  amount: number | string;
  /**
   * `null` e aceito porque a COLUNA e nullable (`financial_transactions.
   * transaction_type`, 001_baseline), e `TransacaoDeCategoria` em
   * lib/categorias-do-periodo.ts sempre refletiu isso -- os dois tipos
   * descrevem a mesma linha e divergiam.
   *
   * Nao muda comportamento: `agregarTransacoes` ja trata tudo que nao e
   * 'income'/'expense' pelo ramo de `transfer`, que fica fora da conta E da
   * contagem. O que o tipo antigo fazia era obrigar quem le a coluna crua a
   * mentir sobre ela.
   */
  transaction_type: string | null;
  /** Opcional: linha de um SELECT que nao pediu a coluna cai na moeda oficial. */
  currency?: string | null;
}

export interface ResumoDeFluxo {
  total_income: number;
  total_expense: number;
  net: number;
  transaction_count: number;
}

/**
 * Soma entrada, saida e resultado de uma lista de lancamentos.
 *
 * Despesa e gravada NEGATIVA em `financial_transactions`, e a view aplica
 * `SUM(ABS(amount))`. O `Math.abs` aqui e a mesma decisao, pela mesma razao:
 * um SUM cru devolveria -800 para quem gastou 800 e o tile "Saiu" apareceria
 * negativo. O sinal nunca decide o TIPO -- quem decide e `transaction_type`.
 */
export function agregarTransacoes(linhas: LinhaDeTransacao[]): ResumoDeFluxo {
  let entrada = 0;
  let saida = 0;
  let contagem = 0;

  for (const linha of linhas) {
    if (linha.transaction_type === "income") {
      entrada += Math.abs(Number(linha.amount));
    } else if (linha.transaction_type === "expense") {
      saida += Math.abs(Number(linha.amount));
    } else {
      // transfer, e qualquer tipo que o app venha a ganhar, fica FORA da
      // conta e fora da contagem -- exatamente como no `COUNT(*) FILTER` da
      // view.
      continue;
    }
    contagem += 1;
  }

  return {
    total_income: Number(entrada.toFixed(2)),
    total_expense: Number(saida.toFixed(2)),
    net: Number((entrada - saida).toFixed(2)),
    transaction_count: contagem,
  };
}

// -----------------------------------------------------------------------------
// O ROTULO DO TILE DE SALDO
// -----------------------------------------------------------------------------
// Esta funcao existe para que o aceite da issue vire assercao em vez de
// inspecao visual. A regra e uma frase: um numero que nao tem versao para o
// periodo escolhido NUNCA pode aparecer debaixo do nome desse periodo.
//
// `financial_accounts.current_balance` e o saldo de HOJE -- o banco nao guarda
// historico de saldo. Navegar para julho e continuar mostrando o mesmo numero
// sob o rotulo "julho" e uma afirmacao falsa sobre o dinheiro do usuario, e do
// tipo que nao da erro nem fica vazia. Deixar a decisao no JSX faria dela algo
// que so um par de olhos conferindo a tela distingue; aqui, o teste distingue.

export interface RotuloDeSaldo {
  titulo: string;
  nota: string;
  /** O numero se refere ao periodo escolhido, ou a hoje? */
  doPeriodo: boolean;
}

export function rotuloDoSaldo(opts: {
  periodo: Periodo;
  hoje?: string;
  /** O patrimonio no fim do periodo, quando existe versao historica dele. */
  saldoHistorico: number | null;
  quantidadeDeContas: number;
}): RotuloDeSaldo {
  const hoje = opts.hoje ?? today();

  // Ha reconstrucao historica: o numero E do periodo, e o rotulo pode nomea-lo.
  if (opts.saldoHistorico !== null) {
    return {
      titulo: "Patrimônio no fim",
      nota: `Em ${rotuloDoPeriodo(opts.periodo)} — reconstruído a partir das transações`,
      doPeriodo: true,
    };
  }

  // Nao ha, e o periodo ja terminou: o aviso tem que ser a primeira coisa que
  // a linha diz, nao um detalhe no fim dela.
  if (terminaNoPassado(opts.periodo, hoje)) {
    return {
      titulo: "Saldo das contas",
      nota: "Saldo de hoje — não é do período escolhido",
      doPeriodo: false,
    };
  }

  // O periodo alcanca hoje: o saldo de hoje e legitimo dentro dele, e a linha
  // volta a ser a contagem de contas -- com "saldo de hoje" dito assim mesmo,
  // porque num periodo de tres meses "o saldo" ainda e o de um dia so.
  const plural = opts.quantidadeDeContas === 1 ? "conta ativa" : "contas ativas";
  return {
    titulo: "Saldo das contas",
    nota: `${opts.quantidadeDeContas} ${plural}, saldo de hoje`,
    doPeriodo: false,
  };
}

// -----------------------------------------------------------------------------
// O resumo de contas previstas, somado sobre o periodo
// -----------------------------------------------------------------------------
// `/api/scheduled-transactions/summary` responde uma linha POR MES. O painel
// mostra um numero so, e ate a HMO-173 ele escolhia a linha com
// `find(m => m.month === new Date().toISOString().slice(0, 7))` -- o mes em
// UTC. Era esse `find` que, nas tres ultimas horas do ultimo dia do mes em
// Sao Paulo, achava a linha do mes SEGUINTE.
//
// Somar em vez de procurar conserta as duas coisas de uma vez: nao ha mais um
// mes "escolhido" para errar, e um periodo de tres meses passa a mostrar os
// tres. A rota ja recortou por `due_date` dentro do periodo, entao a soma das
// linhas e exatamente o total do periodo -- inclusive em modo intervalo, onde
// os meses das pontas chegam cortados.

//
// AS QUATRO PERNAS, E POR QUE UMA SOMA CRUA NAO SERVE (HMO-187)
// --------------------------------------------------------------
// A rota deixou de mandar `total_pending`/`total_overdue`: cada um deles somava
// receita prevista com despesa prevista num unico positivo. Aqui isso importa
// duas vezes -- uma soma sobre o campo antigo daria `Number(undefined ?? 0)`,
// que e 0, e o painel mostraria "R$ 0,00 a vencer" com toda a confianca do
// mundo. Por isso os campos novos sao lidos como `number | undefined` e a
// AUSENCIA deles vira `null`, nao zero: e o unico jeito de a tela distinguir
// "nao ha nada a vencer" de "esta resposta veio do cache de antes da mudanca".

export interface LinhaDeMesPrevisto {
  month: string;
  total_pending_expense?: number | string | null;
  total_pending_income?: number | string | null;
  count_pending_expense?: number | string | null;
  count_pending_income?: number | string | null;
  total_overdue_expense?: number | string | null;
  total_overdue_income?: number | string | null;
  count_overdue_expense?: number | string | null;
  count_overdue_income?: number | string | null;
}

export interface ResumoPrevisto {
  /** A vencer que vai sair da conta. */
  total_pending_expense: number;
  count_pending_expense: number;
  /** A vencer que vai entrar. */
  total_pending_income: number;
  count_pending_income: number;
  /** Vencido a pagar: divida. */
  total_overdue_expense: number;
  count_overdue_expense: number;
  /** Vencido a receber: atrasado PARA voce. */
  total_overdue_income: number;
  count_overdue_income: number;
}

const CAMPOS_DA_PREVISTA = [
  "total_pending_expense",
  "count_pending_expense",
  "total_pending_income",
  "count_pending_income",
  "total_overdue_expense",
  "count_overdue_expense",
  "total_overdue_income",
  "count_overdue_income",
] as const;

/**
 * Soma as linhas de mes do resumo, ou `null` quando a resposta nao traz as
 * pernas separadas.
 *
 * `null` acontece com uma resposta servida do cache do PWA de antes da HMO-187
 * -- as rotas /api/ ficam ate 24h em cache. Devolver zeros ali seria o painel
 * afirmando que nao ha nada a vencer; o `null` faz a tela dizer "indisponivel",
 * que e a verdade.
 *
 * Lista VAZIA nao e ausencia: um periodo sem nenhuma linha na agenda soma zero
 * legitimamente, e esse zero e uma afirmacao correta.
 */
export function somarPrevistas(
  linhas: LinhaDeMesPrevisto[]
): ResumoPrevisto | null {
  const total: ResumoPrevisto = {
    total_pending_expense: 0,
    count_pending_expense: 0,
    total_pending_income: 0,
    count_pending_income: 0,
    total_overdue_expense: 0,
    count_overdue_expense: 0,
    total_overdue_income: 0,
    count_overdue_income: 0,
  };

  for (const linha of linhas) {
    for (const campo of CAMPOS_DA_PREVISTA) {
      const bruto = linha[campo];
      // `== null` cobre undefined e null de uma vez. A linha que nao traz UMA
      // das pernas nao traz nenhuma -- elas saem juntas da rota --, e o teste
      // por campo e o que impede um mes velho no meio da lista contribuir com
      // zeros silenciosos para os outros.
      if (bruto == null) return null;
      const n = Number(bruto);
      if (!Number.isFinite(n)) return null;
      total[campo] += n;
    }
  }

  return {
    ...total,
    total_pending_expense: Number(total.total_pending_expense.toFixed(2)),
    total_pending_income: Number(total.total_pending_income.toFixed(2)),
    total_overdue_expense: Number(total.total_overdue_expense.toFixed(2)),
    total_overdue_income: Number(total.total_overdue_income.toFixed(2)),
  };
}

// -----------------------------------------------------------------------------
// A agenda de contas previstas nao pode ser materializada no passado
// -----------------------------------------------------------------------------
// `materializarAgenda` CRIA linhas de vencimento a partir das regras
// recorrentes. Rodar isso numa janela que ja passou fabricaria contas vencidas
// retroativas -- o app inventaria dividas que o usuario nunca teve e ainda as
// marcaria em atraso. Navegar para julho e um gesto de leitura; ele nao pode
// escrever nada.

/**
 * A janela em que materializar e seguro, ou null quando nao ha nenhuma.
 *
 * Recebe so os dois extremos, e nao um `Periodo`: a rota de contas previstas
 * tambem chama isto na janela derivada de `?months=`, que nunca passou por
 * `modoDoPeriodo` e nao tem por que inventar um modo so para atravessar esta
 * assinatura.
 */
export function janelaParaMaterializar(
  periodo: { de: string; ate: string },
  hoje: string = today()
): { de: string; ate: string } | null {
  if (periodo.ate < hoje) return null;
  // Começa em hoje mesmo quando o periodo comeca antes: a parte passada da
  // janela nao pode ganhar linha nova.
  return { de: periodo.de > hoje ? periodo.de : hoje, ate: periodo.ate };
}

/** Um bloco de resultado do modo intervalo, todo numa unica moeda. */
export interface BlocoDeFluxoPorMoeda {
  currency: string;
  symbol: string;
  summary: ResumoDeFluxo;
}

/**
 * O mesmo que `agregarTransacoes`, mas UMA VEZ POR MOEDA.
 *
 * POR QUE ISTO EXISTE, E POR QUE O `agregarTransacoes` CRU NAO BASTA
 * ------------------------------------------------------------------
 * A HMO-171 tirou a mistura de moedas das views do 008: elas passaram a ter a
 * moeda no GRAO (migration 022), e a rota de fluxo de caixa separa a serie
 * mensal com `separarSeriePorMoeda`. So que a HMO-173 abriu um SEGUNDO caminho
 * na mesma rota -- o periodo `?de=&ate=` que nao cai em meses inteiros nao e
 * respondido por view nenhuma, e a soma passa a ser feita aqui, no JavaScript,
 * sobre as linhas cruas de `financial_transactions`.
 *
 * Esse caminho nasceu sem moeda: `SELECT amount, transaction_type` e um
 * `reduce` por cima. Para um periodo com gasto em real e em dolar ele devolvia
 * 1000 + 180 = 1180, um numero que nao esta em moeda nenhuma, com cara de total
 * e para MAIS -- exatamente o defeito que a 022 foi aplicada em producao para
 * eliminar, reintroduzido por uma porta que a 022 nao cobre, porque nao passa
 * por view.
 *
 * Nenhuma das duas suites pegava: a da moeda so exercita a serie das views, e a
 * do periodo so exercita a aritmetica sem moeda. O defeito so aparece no
 * cruzamento das duas.
 *
 * A ordem dos blocos vem de `resumirPorMoeda`, a mesma do caminho mensal: a
 * moeda oficial primeiro quando ela tem movimento, depois por volume. Duas
 * ordens diferentes para a mesma informacao e como uma delas fica errada sem
 * ninguem notar.
 */
export function agregarTransacoesPorMoeda(
  linhas: LinhaDeTransacao[],
  moedaOficial: string = MOEDA_PADRAO
): BlocoDeFluxoPorMoeda[] {
  const porMoeda = new Map<string, LinhaDeTransacao[]>();

  for (const linha of linhas) {
    // Linha sem moeda cai na oficial, e nao em BRL fixo: quem tem dolar como
    // moeda principal e um lancamento antigo sem a coluna veria esse lancamento
    // virar um bloco "BRL" de mentira, separado do resto do proprio dinheiro.
    const codigo = moedaSugerida({
      doLancamento: linha.currency,
      oficial: moedaOficial,
    });
    const grupo = porMoeda.get(codigo);
    if (grupo) grupo.push(linha);
    else porMoeda.set(codigo, [linha]);
  }

  // `resumirPorMoeda` da a ordem e o simbolo; a soma de cada bloco continua
  // sendo feita por `agregarTransacoes`, que e quem sabe que despesa e gravada
  // negativa e que `transfer` fica fora da conta.
  const resumos = new Map<string, ResumoDeFluxo>();
  porMoeda.forEach((doGrupo, codigo) => {
    resumos.set(codigo, agregarTransacoes(doGrupo));
  });

  const linhasPorMoeda: {
    currency: string;
    income: number;
    expense: number;
    net: number;
    transaction_count: number;
  }[] = [];
  resumos.forEach((resumo, codigo) => {
    linhasPorMoeda.push({
      currency: codigo,
      income: resumo.total_income,
      expense: resumo.total_expense,
      net: resumo.net,
      transaction_count: resumo.transaction_count,
    });
  });

  return resumirPorMoeda(linhasPorMoeda, moedaOficial).map((bloco) => ({
    currency: bloco.moeda,
    symbol: bloco.simbolo,
    // O resumo vem do `agregarTransacoes` do grupo, e nao dos campos que
    // `resumirPorMoeda` resomou: sao os mesmos numeros, e o unico jeito de eles
    // divergirem seria um bug -- entao a fonte fica sendo uma so.
    summary: resumos.get(bloco.moeda) ?? {
      total_income: 0,
      total_expense: 0,
      net: 0,
      transaction_count: 0,
    },
  }));
}
