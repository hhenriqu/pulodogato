/**
 * A metade de DOM do puxar-para-atualizar (HMO-206).
 *
 * `lib/puxar-para-atualizar.ts` decide, sem navegador, se um puxao vale. Para
 * decidir, ele precisa saber DE QUEM e o toque -- e essa pergunta so o DOM
 * responde: quais caixas existem entre o dedo e a raiz, quais delas rolam o
 * proprio conteudo, e quais estao marcadas como area sem puxao.
 *
 * POR QUE EM ARQUIVO SEPARADO, E NAO DENTRO DO COMPONENTE
 * -------------------------------------------------------
 * Porque era exatamente aqui que o bug morava, e dentro do componente isto so
 * seria conferivel com um aparelho na mao. Em modulo proprio, a leitura roda
 * em navegador de verdade contra a marcacao da gaveta
 * (scripts/test-puxar-no-menu-dom.mjs) -- com layout real, `overflow` real e
 * `scrollHeight` real, que e a unica forma de provar que a lista do menu e
 * reconhecida como area que rola sozinha.
 *
 * Nao importa React de proposito: o teste precisa carregar este modulo num
 * navegador sem harness nenhum.
 */

import {
  ATRIBUTO_SEM_PUXAO,
  toqueEhNaPagina,
  type AncestralDoToque,
} from "./puxar-para-atualizar";

/**
 * Valores de `overflow-y` em que a caixa rola o proprio conteudo.
 *
 * `overlay` esta na lista porque navegadores WebKit ainda devolvem esse valor
 * computado para barras sobrepostas -- e e justamente no Safari do iPhone que
 * este gesto existe, por nao haver puxao nativo no PWA em tela cheia.
 */
const OVERFLOW_QUE_ROLA = new Set(["auto", "scroll", "overlay"]);

/**
 * Traduz o caminho entre o ponto tocado e a raiz no que `toqueEhNaPagina`
 * precisa saber.
 *
 * A leitura para em `body`/`html` de proposito: a rolagem da PAGINA ja e
 * respondida pelo `scrollTopNoInicio` do gesto. Incluir a raiz aqui faria toda
 * pagina mais alta que a tela parecer "area que rola sozinha", e o puxao
 * morreria no app inteiro -- exatamente a feature que esta issue preserva.
 */
export function lerCaminhoDoToque(
  alvo: EventTarget | null
): AncestralDoToque[] {
  const caminho: AncestralDoToque[] = [];
  let no: Element | null = alvo instanceof Element ? alvo : null;

  while (no && no !== document.body && no !== document.documentElement) {
    const estilo = window.getComputedStyle(no);
    caminho.push({
      rolaOProprioConteudo:
        OVERFLOW_QUE_ROLA.has(estilo.overflowY) &&
        no.scrollHeight > no.clientHeight,
      dispensaOPuxao: no.hasAttribute(ATRIBUTO_SEM_PUXAO),
    });
    no = no.parentElement;
  }

  return caminho;
}

/**
 * O toque que comecou neste alvo pertence a pagina?
 *
 * Junta a leitura de DOM com a regra pura. E o que o componente chama no
 * `touchstart`.
 */
export function toqueComecouNaPagina(alvo: EventTarget | null): boolean {
  return toqueEhNaPagina(lerCaminhoDoToque(alvo));
}
