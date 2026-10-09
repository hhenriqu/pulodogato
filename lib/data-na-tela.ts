// ---------------------------------------------------------------------------
// A DATA QUE A TELA ESCREVE (HMO-353)
// ---------------------------------------------------------------------------
// Toda data da lista de lancamentos aparecia UM DIA MAIS CEDO. Medido em
// producao em 2026-10-09, com a conta de teste e Chromium headless no fuso de
// Sao Paulo: um lancamento gravado com `transaction_date = 2026-10-09` saiu na
// tela como **08/10/2026**.
//
// O mecanismo cabe em duas linhas:
//
//   new Date("2026-10-09")                        -> meia-noite UTC
//   .toLocaleDateString("pt-BR")  em UTC-3        -> "08/10/2026"
//
// `transaction_date`, `due_date`, `settled_on` e companhia sao colunas `date`.
// Elas chegam como a string `"2026-10-09"`, sem hora e sem fuso -- um dia do
// calendario, nao um instante. `new Date(string-sem-hora)` nao le isso como um
// dia: le como um INSTANTE em UTC, e todo fuso negativo entao recua a data na
// hora de escrever. O fuso de todo usuario deste app e UTC-3.
//
// POR QUE ISTO MACHUCA MAIS DO QUE UM DIA DE DIFERENCA
// ---------------------------------------------------
//   - quem confere o extrato do banco contra o app ve TODA linha deslocada, e a
//     leitura natural e que o app GRAVOU errado -- nao que ele mostra errado;
//   - a despesa do dia 1 aparece no ultimo dia do mes ANTERIOR, ao lado de
//     cartoes de periodo que (corretamente) a contam no mes certo. A tela passa
//     a se contradizer consigo mesma;
//   - nao ha sintoma: nenhum erro, nenhum log, e o que aparece e uma data
//     plausivel.
//
// AS DUAS SAIDAS, E POR QUE NENHUMA DELAS E `new Date(iso)`
// --------------------------------------------------------
//   1. PARSE TEXTUAL. `dataParaExibicao` de lib/data-digitada.ts ja faz isso:
//      regex em ano/mes/dia, sem construir `Date` nenhum, entao nao ha fuso no
//      caminho. E a saida para `dd/mm/aaaa`, e esta e a primitiva do repo --
//      nao escrevemos uma segunda.
//   2. `Date.UTC` + `Intl` COM `timeZone: "UTC"`. Para formato que exige nome de
//      mes ("31 de out."), uma tabela de meses a mao seria uma terceira copia de
//      dados que o `Intl` ja tem. O que conserta nao e evitar `Date`: e fechar
//      o circuito -- a data nasce em UTC E e lida em UTC. Tirar o `timeZone`
//      devolve o defeito inteiro, e e exatamente o que o teste mede.
//
// O QUE NAO ENTRA AQUI
// --------------------
// Coluna `timestamptz` (`created_at`, `archived_at`, `current_price_at`) E um
// instante, e para ela `new Date(valor)` esta CERTO: o fuso local e justamente
// o que a pessoa quer ver. `dataOuMomentoNaTela` existe para separar os dois
// casos num lugar so, porque `formatDate` de lib/utils.ts recebe os dois.
//
// A SUITE RODA NOS DOIS FUSOS, E ISSO NAO E ZELO
// ----------------------------------------------
// Em UTC o codigo defeituoso e o consertado dao o MESMO dia. Uma suite rodando
// so em UTC -- que e o fuso do runner do GitHub -- passa verde sobre o defeito
// intacto. `test:data-na-tela` roda em `America/Sao_Paulo` e em `UTC`, e afirma
// o fuso como premissa: sem isso ela nao mede nada no unico ambiente que decide
// se o PR entra.
// ---------------------------------------------------------------------------

import { dataParaExibicao } from "@/lib/data-digitada";

/**
 * A forma de uma coluna `date` vinda do PostgREST: um dia do calendario, sem
 * hora. E o que distingue "dia" de "instante" sem ter de consultar o schema.
 *
 * Deliberadamente SEM `g`: um regex global guarda `lastIndex` entre chamadas e
 * `.test()` passaria a alternar verdadeiro/falso para a mesma entrada.
 */
const SO_DATA = /^\d{4}-\d{2}-\d{2}$/;

/** O valor e um dia do calendario (coluna `date`), e nao um instante? */
export function ehSoData(valor: unknown): valor is string {
  return typeof valor === "string" && SO_DATA.test(valor);
}

/**
 * `"2026-10-09"` -> `"09/10/2026"`, em qualquer fuso.
 *
 * Delega em `dataParaExibicao`, que parseia a string textualmente. Vazio para
 * o que nao e uma data que existe no calendario -- inclusive `null`, que antes
 * virava `new Date(null)` = epoch e escrevia **01/01/1970** na tela.
 */
export function dataNaTela(iso: string | null | undefined): string {
  return dataParaExibicao(iso);
}

/**
 * `"2026-10-31"` -> `"31 de out."`. O rotulo curto do eixo de um grafico, onde
 * `dd/mm/aaaa` nao cabe.
 *
 * `timeZone: "UTC"` e a linha que conserta: sem ela, a mesma data que nasceu em
 * `Date.UTC` e lida no fuso do aparelho e o dia 31 de outubro imprime "30 de
 * out." em Sao Paulo (medido). Vazio para o que nao e `AAAA-MM-DD`.
 */
export function dataCurtaNaTela(iso: string | null | undefined): string {
  if (!ehSoData(iso)) return "";

  const ano = Number(iso.slice(0, 4));
  const mes = Number(iso.slice(5, 7));
  const dia = Number(iso.slice(8, 10));

  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(ano, mes - 1, dia)));
}

/**
 * Para quem recebe os DOIS: dia do calendario ou instante.
 *
 * E o corpo de `formatDate` de lib/utils.ts, que e chamada com `settled_on` e
 * `today_rate_date` (colunas `date`, que o fuso recuava) e tambem com
 * `current_price_at` (`timestamptz`, cujo instante tem de continuar sendo lido
 * no fuso local). Um `new Date` para os dois casos conserta um e estraga o
 * outro; a peneira de forma e o que separa, e ela mora aqui para ter teste.
 *
 * Data invalida sai VAZIA em vez de "Invalid Date": `Intl.format` de um `Date`
 * NaN lanca `RangeError`, e uma data ruim no banco nao pode derrubar a tela.
 */
export function dataOuMomentoNaTela(
  valor: string | Date | null | undefined
): string {
  if (valor === null || valor === undefined || valor === "") return "";

  if (ehSoData(valor)) return dataNaTela(valor);

  const quando = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(quando.getTime())) return "";

  return new Intl.DateTimeFormat("pt-BR").format(quando);
}
