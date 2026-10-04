// =====================================================
// A CHAVE CANONICA DA FATURA DO CARTAO
// =====================================================
// Arquivo-FOLHA: nenhum import, nem de `@/`. E a unica razao de ele existir
// separado de `lib/card-invoice.ts`, onde estas cinco coisas moravam.
//
// POR QUE A SEPARACAO (HMO-285)
// -----------------------------
// `lib/telas-de-movimentacao.ts` precisa saber se a linha prevista e uma fatura,
// e a resposta e `ehFatura(notes)` / `faturaDaChave(notes)`. Mas aquele modulo
// NAO PODE importar `lib/card-invoice.ts`: ele e compilado por um tsconfig com
// `rootDir: lib` e o mutador copia para a arvore temporaria apenas as
// dependencias listadas em `DEPENDENCIAS`
// (scripts/mutantes-telas-de-movimentacao.mjs). `card-invoice` arrasta
// `transferencia` -> `lancamento` atras dele, e um mutante que nao COMPILA
// "morre" por motivo errado -- o placar mentiria a favor. O mesmo esta escrito
// no corpo de `telas-de-movimentacao.ts`, em `TIPO_CARTAO`.
//
// A alternativa considerada e recusada foi duplicar a regex num segundo arquivo,
// como `TIPO_CARTAO` ja e duplicado. Aqui o preco seria maior: duas regex
// ancoradas que divergissem nao dariam erro nenhum -- uma das duas so pararia de
// casar, e a tela deixaria de reconhecer a fatura em silencio. Uma CHAVE
// canonica tem de ter uma unica definicao.
//
// `lib/card-invoice.ts` RE-EXPORTA os cinco nomes daqui, para que os nove
// chamadores de hoje continuem importando de la sem mudar uma linha.
// =====================================================

/**
 * Prefixo da chave canonica que `POST /api/card-invoices/close` grava em
 * `scheduled_transactions.notes`.
 */
export const PREFIXO_CHAVE_FATURA = "fatura:";

/**
 * A chave canonica da fatura daquele mes naquele cartao.
 *
 * E ela que torna o fechamento idempotente (clicar duas vezes nao cria duas
 * contas a pagar), que permite ao GET reconhecer a fatura ja fechada sem uma
 * coluna nova, e -- desde o conserto do HMO-149 -- que diz a rota de baixa que
 * aquela conta prevista e uma fatura, nao uma despesa.
 *
 * @param mes 'YYYY-MM-01' (primeiro dia do mes da fatura)
 */
export function chaveFatura(mes: string, accountId: string): string {
  return `${PREFIXO_CHAVE_FATURA}${mes}:${accountId}`;
}

// Ancorada nas duas pontas de proposito. Sem o `$`, uma nota escrita a mao
// como "fatura:2026-09-01:xxx paguei no debito" passaria por chave canonica e
// a descricao livre do usuario viraria regra de negocio.
export const RE_CHAVE_FATURA =
  /^fatura:(\d{4}-\d{2}-\d{2}):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

/** O mes e o cartao de uma chave de fatura, ou null se `notes` nao for uma. */
export function faturaDaChave(
  notes: string | null | undefined,
): { mes: string; accountId: string } | null {
  if (!notes) return null;
  const m = RE_CHAVE_FATURA.exec(notes);
  if (!m) return null;
  return { mes: m[1], accountId: m[2] };
}

/** Esta conta prevista e a fatura de um cartao? */
export function ehFatura(notes: string | null | undefined): boolean {
  return faturaDaChave(notes) !== null;
}
