// ---------------------------------------------------------------------------
// A FATURA DO PERIODO, E O QUE AINDA NAO E DESTE PERIODO (HMO-290)
// ---------------------------------------------------------------------------
// O rotulo "Fatura atual" em `CartaoDaLista` imprimia `current_balance` -- a
// divida INTEIRA do cartao. A cadeia que fazia o numero mentir nao tinha nada
// de sutil:
//
//   - `update_account_balance` soma `NEW.amount` no instante do INSERT, sem
//     olhar `transaction_date`;
//   - `POST /api/financial-installments` grava a serie inteira num insert so.
//
// Logo: compra de R$ 3.000 em 10x -> "Fatura atual: R$ 3.000" no mes da compra.
// A fatura daquele mes tem R$ 300 dela. Nada dava erro, e R$ 3.000 num cartao e
// plausivel.
//
// ESTE MODULO NAO FAZ ARITMETICA DE FATURA
// ----------------------------------------
// Em que fatura cada compra cai e decidido pela view `card_invoice_lines`
// (migration 006, via `card_invoice_month`), e `GET /api/card-invoices` ja
// agrega por cartao e mes. Uma segunda copia daquela regra em TypeScript faria
// a tela e o relatorio discordarem sobre o mesmo cartao -- o tipo de
// divergencia que ninguem percebe ate fechar o mes errado.
//
// O que ha aqui e LEITURA da resposta daquela rota, mais a derivacao das
// parcelas futuras. Tudo funcao pura, para caber em teste sem navegador.
//
// `null` E "NAO DEU PARA LER", E NAO "ZERO"
// ----------------------------------------
// A distincao e a razao de o modulo existir em vez de um `?? 0` em cada tela.
// `GET /api/card-invoices` devolve uma entrada para TODO cartao ativo, zerada
// quando o mes nao teve compra (`route.ts:94-121`) -- entao um cartao AUSENTE
// da resposta nao e um cartao sem fatura, e um numero que a tela nao obteve.
//
// Imprimir R$ 0,00 ali e o zero confiante de `lib/offline-leitura.ts` com duas
// fontes em vez de uma: "Fatura atual: R$ 0,00" embaixo do nome do cartao
// certo, indistinguivel de um mes sem compra nenhuma. Quem recebe `null` mostra
// `<NumeroIndisponivel />`.
//
// POR QUE A SOMA DA LISTA E `null` QUANDO FALTA UM CARTAO
// ------------------------------------------------------
// "Faturas em aberto" e a soma de TODOS os cartoes ativos. Com um cartao fora
// da resposta, a soma dos outros e um numero menor que o certo, plausivel, e
// sem nada na tela dizendo que falta uma parcela dela. Somar o que deu e a
// forma mais barata de publicar um total errado -- entao a soma parcial nao
// existe: ou todos os cartoes da lista tem fatura na resposta, ou o total e
// `null`. Mesma politica pessimista do `estadoDaTela`.
// ---------------------------------------------------------------------------

import { faturaDoCartao } from "@/lib/fatura-do-cartao";
import type { CardInvoice } from "@/types/financial";

/** Le o valor tolerando o texto que o PostgREST devolve para `numeric`. */
function numeroOuNulo(valor: number | string | null | undefined): number | null {
  const bruto = Number(valor ?? 0);
  return Number.isFinite(bruto) ? bruto : null;
}

/**
 * O total da fatura daquele mes, ou `null` quando nao houve fatura na resposta.
 *
 * NAO e `Math.abs`: `total` ja vem com o sinal certo da view (`invoice_amount`
 * e `-amount`, entao a compra soma e o estorno abate). Um mes que produziu mais
 * estorno que compra tem fatura negativa de verdade -- e o cartao que deve a
 * voce. `Math.abs` ali faria o credito de R$ 50 aparecer como R$ 50 a pagar,
 * que e a mesma troca de sinal que a nota da SECAO 4 do 006 existe para evitar.
 */
export function totalDaFatura(
  fatura: CardInvoice | null | undefined
): number | null {
  if (!fatura) return null;
  return numeroOuNulo(fatura.total);
}

/**
 * O que as PARCELAS desta fatura ainda vao cobrar depois dela (HMO-290).
 *
 * Depois de a tela passar a mostrar a fatura do periodo, o risco de produto se
 * inverte: antes ela exagerava a fatura, agora os R$ 2.700 das nove parcelas
 * seguintes nao apareceriam em tela de cartao nenhuma. Esta linha e o que
 * impede a troca de ser so um numero menor.
 *
 * A derivacao sai de `installment_number` / `installment_total` (035), e nao da
 * `description`: a descricao gravada e "Notebook (3/10)" e o usuario pode
 * reescreve-la -- as colunas, nao. Mesma razao do `rotuloDaParcela`.
 *
 * DUAS IMPRECISOES CONHECIDAS, as duas para BAIXO:
 *
 *   1. A sobra da divisao mora na ULTIMA parcela (`lib/lancamento.ts`: a conta
 *      e em centavos e a ultima absorve o resto). Multiplicar a parcela DESTE
 *      mes pelas que faltam erra por essa sobra -- centavos, num numero
 *      secundario. Buscar o valor exato exigiria ler os outros meses da view,
 *      uma consulta por mes futuro, para corrigir centavos.
 *   2. A compra parcelada cuja PRIMEIRA parcela cai num mes futuro (comprada
 *      depois do fechamento) nao tem linha nesta fatura, e portanto nao entra.
 *      Ela aparece quando o seletor chegar no mes dela.
 *
 * As duas erram para menos, que e o lado certo para um aviso: o numero nunca
 * promete menos comprometimento do que ha.
 *
 * O estorno nao gera parcela futura (`max(0, ...)`): uma linha negativa
 * parcelada multiplicada por 9 viraria um "comprometimento" negativo que
 * ABATERIA o aviso dos outros cartoes.
 */
export function parcelasFuturasDaFatura(
  fatura: CardInvoice | null | undefined,
  accountId: string
): number | null {
  if (!fatura || !accountId) return null;

  let soma = 0;

  for (const linha of fatura.lines ?? []) {
    // O filtro por `account_id` repete o que a rota e o `faturaDoCartao` ja
    // fizeram, pela mesma razao do `gastosDaFatura`: e a afirmacao da tela, e
    // nao custa nada. A RLS de `financial_transactions` tem um OR para membro
    // de grupo (002), entao a view PODE devolver a compra de outro cartao.
    if (linha.account_id !== accountId) continue;

    const numero = linha.installment_number;
    const total = linha.installment_total;

    // As duas vem NULL juntas numa compra avulsa (ha CHECK no banco). Exigir as
    // duas, e nao so uma, e o que impede uma linha meio-gravada de virar
    // `NaN * 9`.
    if (!numero || !total) continue;
    if (!Number.isInteger(numero) || !Number.isInteger(total)) continue;

    const faltam = total - numero;
    if (faltam <= 0) continue;

    const valor = numeroOuNulo(linha.invoice_amount);
    if (valor === null || valor <= 0) continue;

    soma += valor * faltam;
  }

  return soma;
}

/**
 * A soma das faturas dos cartoes da lista, ou `null` se faltar qualquer uma.
 *
 * Casa por `account_id` com `find`, NUNCA `faturas[0]`: "a rota devolve uma por
 * cartao" e propriedade do servidor, e `[0]` transforma qualquer mudanca la
 * ("um cartao novo sem lancamento", "um filtro que deixou de filtrar") em "o
 * total do cartao errado embaixo do nome do cartao certo". Nada disso daria
 * erro: sao dois cartoes do mesmo dono, com valores plausiveis. E a mesma
 * decisao 1 de `lib/fatura-do-cartao.ts`, e esta funcao IMPORTA `faturaDoCartao`
 * em vez de repetir o `find` -- nao existe uma segunda escolha de fatura no
 * repositorio, e tirar o import derruba o `tsc`.
 */
export function somaDasFaturas(
  faturas: CardInvoice[] | null | undefined,
  idsDosCartoes: string[]
): number | null {
  return somaOuNulo(faturas, idsDosCartoes, (fatura) => totalDaFatura(fatura));
}

/** A soma das parcelas futuras de todos os cartoes da lista. */
export function somaDasParcelasFuturas(
  faturas: CardInvoice[] | null | undefined,
  idsDosCartoes: string[]
): number | null {
  return somaOuNulo(faturas, idsDosCartoes, (fatura, id) =>
    parcelasFuturasDaFatura(fatura, id)
  );
}

/**
 * A soma sobre os cartoes da lista, ou `null` se faltar a fatura de qualquer um.
 *
 * As duas somas publicas sao a MESMA travessia com um leitor diferente, e elas
 * compartilham este corpo em vez de repeti-lo por uma razao concreta: a regra
 * que importa aqui -- "faltou um, o total inteiro e `null`" -- existe num lugar
 * so. Duas copias divergem na primeira correcao, e o sintoma seria o total das
 * faturas recusando a soma parcial enquanto o das parcelas futuras a publica,
 * lado a lado na mesma tela.
 */
function somaOuNulo(
  faturas: CardInvoice[] | null | undefined,
  idsDosCartoes: string[],
  ler: (fatura: CardInvoice | null, accountId: string) => number | null
): number | null {
  if (!faturas) return null;

  let soma = 0;

  for (const id of idsDosCartoes) {
    const parcial = ler(faturaDoCartao(faturas, id), id);
    // Um cartao sem fatura na resposta zera o TOTAL, e nao a parcela dele --
    // ver o cabecalho do arquivo.
    if (parcial === null) return null;
    soma += parcial;
  }

  return soma;
}
