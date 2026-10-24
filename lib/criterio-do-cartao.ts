// =====================================================
// A REGRA DO CARTAO, E A LEGENDA QUE A DIZ (HMO-266, fase 6)
// =====================================================
// Da HMO-265 ate a fase 5 o painel contava o cartao no pagamento da fatura e a
// tela de relatorios na COMPRA (HMO-266, opcao "consumo"), e as duas legendas
// deste arquivo explicavam a diferenca uma pela outra.
//
// A FASE 6 DO MODELO NOVO (RN017.3, RN017.4, migracao 072) UNIFICOU A REGRA: a
// compra no cartao nao entra sozinha em Despesas, e a fatura e que conta, no mes
// do VENCIMENTO, realizada quando e paga, pelo total das compras dela. O painel,
// a tela de relatorios, as abas de Movimentacoes e Financas Pessoais contam
// igual. A quebra por categoria nao perde nada com isso: o banco abre a fatura
// nas compras dela, cada uma na sua categoria (perna 5 da 072).
//
// O QUE AINDA TEM DOIS CRITERIOS E O GRUPO. O painel do grupo conta a despesa
// dividida no mes em que ela aconteceu -- quem divide a conta nao paga a fatura
// do cartao de ninguem --, e `/api/reports/cash-flow` responde `cartao:
// "compra"` com `groupId`.
//
// O QUE ESTE MODULO RESOLVE, QUE NAO E A ARITMETICA
// -------------------------------------------------
// Nada aqui calcula dinheiro. O que mora aqui e a frase que diz onde a compra
// no cartao foi parar: quem lancou a compra de ontem e nao a ve no Realizado do
// mes le "sumiu", e um valor que falta sem rotulo e indistinguivel de um bug.
// Cada legenda diz a regra da propria tela E nomeia a outra regra, para quem
// compara o painel pessoal com o do grupo.
//
// As duas vivem aqui e nao cada uma no seu componente: duas legendas que se
// referem uma a outra, escritas em arquivos diferentes, e um par que a primeira
// issue a mexer em uma delas deixa se contradizendo.
// =====================================================

/**
 * Qual eixo de data o total usou para o cartao de credito.
 *
 * E o campo `cartao` da resposta de /api/reports/cash-flow, que existe desde a
 * HMO-265 exatamente para que duas telas com numeros distintos para o mesmo mes
 * nao sejam indistinguiveis de um bug. Desde a fase 6, `fatura` e o relatorio
 * pessoal e `compra` e o do grupo.
 */
export type CriterioDoCartao = "compra" | "fatura";

/**
 * A legenda de cada criterio, do ponto de vista da tela que o usa.
 *
 * A chave e o criterio, nao a tela, e isso e proposital: o pessoal (o painel e
 * a tela de relatorios) recebe `fatura` e o grupo recebe `compra`, entao cada
 * texto descreve a propria regra e nomeia a outra sem precisar saber em que
 * arquivo esta sendo renderizado.
 */
export const LEGENDA_DO_CARTAO: Record<CriterioDoCartao, string> = {
  compra:
    "No grupo, a compra no cartão conta no mês em que foi feita: quem divide a " +
    "conta não paga a fatura de ninguém. No seu painel pessoal ela conta pela " +
    "fatura, no mês em que a fatura vence.",
  fatura:
    "A compra no cartão conta pela fatura: no mês em que a fatura vence, pelo " +
    "total das compras dela, depois que você a paga. Fatura em aberto ainda não " +
    "entra no realizado. No painel do grupo é diferente: lá a compra conta no " +
    "mês em que foi feita.",
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
