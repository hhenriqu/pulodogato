// =====================================================
// AS DUAS LEITURAS DO MESMO PERIODO, E A LEGENDA QUE AS SEPARA (HMO-266)
// =====================================================
// A HMO-265 fez o PAINEL contar o cartao no pagamento da fatura. A tela de
// relatorios continua contando na COMPRA, e isso foi DECIDIDO (HMO-266, opcao
// "consumo" escolhida pelo Helio), nao esquecido:
//
//   * o painel pergunta QUANDO O DINHEIRO SAIU  -> a fatura, no dia em que foi
//     paga. E a pergunta de quem quer saber quanto ainda tem na conta;
//   * a tela de relatorios pergunta NO QUE O DINHEIRO FOI GASTO -> a compra,
//     com a categoria dela. E a pergunta de quem quer saber onde cortar.
//
// Aplicar a regra do painel na tela de relatorios custaria as duas coisas que
// fazem aquela tela servir para algo: a quebra por categoria perderia toda
// compra de cartao das categorias dela (Alimentacao, Transporte...) e viraria
// uma barra so, "Fatura"; e o grafico por mes perderia a serie, porque a regra
// do caixa mistura dois eixos de data e por isso responde um BALDE
// (`grao: "intervalo"`, `months: []`) em app/api/reports/cash-flow/route.ts.
//
// O QUE ESTE MODULO RESOLVE, QUE NAO E A ARITMETICA
// -------------------------------------------------
// Nada aqui calcula dinheiro. O que mora aqui e o unico custo real da decisao:
// duas telas do app passam a mostrar totais DIFERENTES para o mesmo periodo, e
// dois numeros certos por criterios diferentes se leem como defeito -- foi
// exatamente assim que a HMO-258 nasceu.
//
// Medido em producao na fixture de 6 meses da conta de teste (HMO-255), antes
// de a decisao ser tomada:
//
//   consumo (o que a tela de relatorios mostra)  R$ 7.545,00
//   caixa   (o criterio do painel)               R$ 3.345,00
//   diferenca                                    R$ 4.200,00
//
// Os R$ 4.200 sao, ao centavo, o que a aba Categorias chama de Transporte +
// Compras: tudo que foi comprado no cartao e ainda nao foi pago. A fixture
// nunca paga fatura, entao ela exagera o buraco -- para quem paga todo mes a
// diferenca e aproximadamente UMA fatura aberta. O que nao muda com o perfil de
// uso e a DIRECAO: o consumo e sempre >= o caixa, e a diferenca e zero so para
// quem nao tem cartao.
//
// POR QUE UMA LEGENDA SO NAO RESOLVE, E POR QUE AS DUAS MORAM NO MESMO ARQUIVO
// ----------------------------------------------------------------------------
// Legenda que descreve APENAS a propria tela nao resolve nada: quem comparou os
// dois numeros e chegou na legenda ja sabe o que aquela tela mostra -- o que ele
// nao sabe e qual das duas esta errada. Por isso cada texto abaixo NOMEIA A
// OUTRA TELA e diz a direcao da diferenca.
//
// E e por isso que as duas vivem aqui e nao cada uma no seu componente: duas
// legendas que se referem uma a outra, escritas em arquivos diferentes, e um
// par que a primeira issue a mexer em uma delas deixa se contradizendo. Mexer
// numa aqui obriga a ler a outra.
// =====================================================

/**
 * Qual eixo de data o total usou para o cartao de credito.
 *
 * E o campo `cartao` da resposta de /api/reports/cash-flow, que existe desde a
 * HMO-265 exatamente para que duas telas com numeros distintos para o mesmo mes
 * nao sejam indistinguiveis de um bug.
 */
export type CriterioDoCartao = "compra" | "fatura";

/**
 * A legenda de cada criterio, do ponto de vista da tela que o usa.
 *
 * A chave e o criterio, nao a tela, e isso e proposital: a tela que pede
 * `compra` e a de relatorios e a que pede `fatura` e o painel, entao cada texto
 * descreve a propria tela e nomeia a outra sem precisar saber em que arquivo
 * esta sendo renderizado.
 */
export const LEGENDA_DO_CARTAO: Record<CriterioDoCartao, string> = {
  compra:
    "A compra no cartão conta no mês em que você gastou. O painel conta no mês " +
    "em que a fatura foi paga, por isso o total dele para o mesmo período é " +
    "menor enquanto houver fatura em aberto — os dois estão certos, e são " +
    "perguntas diferentes: aqui é no que você gastou, lá é quanto saiu da conta.",
  fatura:
    "A compra no cartão conta no mês em que a fatura foi paga. A tela de " +
    "Relatórios conta no mês da compra, por isso o total dela para o mesmo " +
    "período é maior enquanto houver fatura em aberto — os dois estão certos, e " +
    "são perguntas diferentes: aqui é quanto saiu da conta, lá é no que você gastou.",
};

/**
 * A legenda do total que a rota devolveu.
 *
 * Recebe o campo da resposta em vez de ser uma constante por tela para que a
 * legenda siga a rota: o dia em que alguem mudar o criterio de uma das telas, o
 * texto embaixo do grafico muda com ele em vez de passar a mentir calado.
 *
 * Resposta antiga em cache (ou qualquer coisa fora dos dois valores) nao recebe
 * legenda: inventar "compra" aqui seria afirmar um criterio que ninguem leu.
 */
export function legendaDoCartao(cartao: string | null | undefined): string | null {
  if (cartao !== "compra" && cartao !== "fatura") return null;
  return LEGENDA_DO_CARTAO[cartao];
}
