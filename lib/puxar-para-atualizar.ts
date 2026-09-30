/**
 * O gesto de puxar a tela para atualizar (HMO-201, parte 4).
 *
 * O pedido: "Quando arrastar tudo pra cima, dar refresh na pagina."
 *
 * O QUE ESTE MODULO ASSUME, PORQUE A FRASE TEM DUAS LEITURAS
 * ----------------------------------------------------------
 * "Arrastar tudo pra cima" pode ser o dedo subindo (que rola a pagina para
 * BAIXO) ou a pagina sendo levada ao topo. O que esta implementado e o gesto
 * universal de aplicativo movel: com a tela JA no topo, puxar para baixo passa
 * de um limiar e solta para atualizar. E o unico dos dois que o usuario ja
 * conhece de todo outro app, e o unico que nao conflita com rolar a pagina.
 *
 * POR QUE O APP PRECISA FAZER ISSO NA MAO
 * ---------------------------------------
 * Instalado como PWA em tela cheia, o iOS nao oferece o puxar-para-atualizar
 * do Safari: nao ha barra de endereco, nao ha botao de recarregar, e nao ha
 * gesto nativo. A pessoa fica sem nenhuma forma de pedir dados novos -- que e
 * exatamente a reclamacao.
 *
 * POR QUE A DECISAO MORA NUMA FUNCAO PURA
 * ---------------------------------------
 * Porque a parte que erra nao e o `addEventListener`, e a aritmetica: quanto
 * conta como "puxou o suficiente", o que fazer quando o dedo volta para cima
 * no meio do gesto, e o caso que estraga tudo -- o gesto que COMECOU no meio
 * da pagina e so por acaso chegou ao topo. Sem isto separado, cada uma dessas
 * respostas so seria conferivel com um aparelho na mao.
 */

/** Quanto o dedo precisa percorrer, em pixels, para o gesto valer. */
export const LIMIAR_EM_PIXELS = 70;

/**
 * Teto do indicador na tela. O dedo pode percorrer a tela inteira; o
 * indicador para de descer aqui, senao ele empurraria o conteudo para fora.
 */
export const DESLOCAMENTO_MAXIMO = 96;

/**
 * Resistencia: o indicador anda metade do que o dedo anda.
 *
 * Nao e enfeite. Sem ela o indicador acompanha o dedo 1:1 e qualquer
 * deslizada curta ja cruza o limiar -- a pagina recarrega sozinha quando a
 * pessoa so queria rolar para cima. A resistencia e o que faz o gesto
 * precisar de intencao.
 */
export const RESISTENCIA = 0.5;

export type EstadoDoGesto =
  /** Nada acontecendo, ou o gesto nao se qualifica. */
  | "inerte"
  /** Puxando, mas ainda nao deu o suficiente. */
  | "puxando"
  /** Passou do limiar: soltar agora atualiza. */
  | "solte";

export type LeituraDoGesto = {
  readonly estado: EstadoDoGesto;
  /** Quanto o indicador desce, em pixels. Sempre entre 0 e o maximo. */
  readonly deslocamento: number;
};

export const GESTO_INERTE: LeituraDoGesto = {
  estado: "inerte",
  deslocamento: 0,
};

export type EntradaDoGesto = {
  /**
   * `scrollTop` no instante em que o dedo ENCOSTOU. Nao o de agora: puxar
   * para baixo a partir do topo nao muda o scroll, mas um gesto que comecou
   * com a pagina rolada e chegou ao topo no meio do caminho mudaria -- e esse
   * e o gesto que NAO pode virar refresh.
   */
  readonly scrollTopNoInicio: number;
  /** Y do toque agora menos o Y de quando ele comecou. Positivo = para baixo. */
  readonly deltaY: number;
  /** Ja ha uma atualizacao em curso? */
  readonly atualizando?: boolean;
};

/**
 * Traduz o estado do toque no que a tela deve mostrar.
 *
 * Pura de proposito: a mesma entrada da a mesma saida, sem DOM, sem relogio e
 * sem rede.
 */
export function lerGesto({
  scrollTopNoInicio,
  deltaY,
  atualizando = false,
}: EntradaDoGesto): LeituraDoGesto {
  // Ja esta atualizando: um segundo gesto por cima nao faz nada. Sem isto, tres
  // puxadas seguidas disparam tres recargas.
  if (atualizando) return GESTO_INERTE;

  // O GESTO SO VALE SE COMECOU NO TOPO.
  //
  // `> 0` e nao `>= 1`: qualquer rolagem, mesmo de meio pixel (o iOS produz
  // valores fracionarios ao desacelerar), significa que havia pagina acima e
  // que o dedo esta rolando, nao puxando.
  if (scrollTopNoInicio > 0) return GESTO_INERTE;

  // Dedo subindo: e rolagem normal para baixo, nao um puxao.
  if (deltaY <= 0) return GESTO_INERTE;

  const deslocamento = Math.min(deltaY * RESISTENCIA, DESLOCAMENTO_MAXIMO);

  return {
    // O limiar e comparado contra o DESLOCAMENTO, nao contra o `deltaY` cru.
    // E o deslocamento que a pessoa ve; usar o delta faria o indicador dizer
    // "solte para atualizar" numa posicao que nao corresponde ao que esta
    // desenhado na tela.
    estado: deslocamento >= LIMIAR_EM_PIXELS ? "solte" : "puxando",
    deslocamento,
  };
}

/**
 * O dedo saiu da tela: atualiza ou nao?
 *
 * Separado de `lerGesto` porque sao perguntas diferentes -- uma descreve o que
 * desenhar durante o gesto, a outra decide um efeito colateral -- e juntar as
 * duas e como um indicador que diz "solte para atualizar" acaba soltando sem
 * atualizar.
 */
export function deveAtualizar(leitura: LeituraDoGesto): boolean {
  return leitura.estado === "solte";
}
