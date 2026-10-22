// ---------------------------------------------------------------------------
// O LANCAMENTO FORA DOS TOTAIS, DO LADO DAS SOMAS EM JAVASCRIPT
// (HMO-453, F3 da HMO-443)
// ---------------------------------------------------------------------------
// A migration 060 criou `financial_transactions.include_in_total` e pos o
// filtro em `category_monthly_totals`, de onde ele propaga para a cadeia de
// cinco views e para os cinco leitores delas. A 063 fez o mesmo em
// `budget_consumption`, que tem o `SUM` dela proprio.
//
// Sobraram as somas que NAO estao em view nenhuma: as que percorrem as linhas
// cruas no JavaScript. Elas nao herdam nada, e precisam ser ensinadas uma a
// uma -- e e este modulo que elas chamam, para que a pergunta tenha UM dono.
//
// POR QUE UM MODULO, E NAO O PREDICADO ESCRITO EM CADA LUGAR
// ---------------------------------------------------------
// Porque sao SETE lugares e o predicado tem uma forma contraintuitiva (ver
// abaixo). Sete copias escritas a mao sao sete chances de escrever `=== true`
// ou `!linha.include_in_total`, e as duas falham do lado que esvazia o
// relatorio -- o lado de que se reclama tarde. Com um dono, a forma e decidida
// uma vez e cada call site e so uma fiacao, que e o que o `tsc` cobra.
//
// E porque isso da ao mutante um alvo por SITIO: trocar
// `apenasNosTotais(linhas)` por `linhas` num arquivo mede aquele arquivo, sem
// precisar mexer na expressao interna. E a mesma forma que
// `scripts/check-cartao-pela-fatura.mjs` ja usa com
// `realizadoComCartaoPelaFatura(linhas)` -> `linhas.slice()`.
//
// ===========================================================================
// `!== false`, NUNCA `=== true` E NUNCA `!linha.include_in_total`
// ===========================================================================
// A coluna e `boolean NOT NULL DEFAULT true` no banco, entao parece que os tres
// dao no mesmo. Nao dao, porque o campo nao chega sempre do banco:
//
//   * ANTES DA COLAGEM da 060 o campo nao existe, e o `select` que nao o nomeia
//     simplesmente nao o traz. Deploy leva codigo, nao schema
//     (`deploy-ships-code-not-schema`), e a colagem e passo manual. Nessa
//     janela `include_in_total` chega `undefined`;
//   * uma resposta GUARDADA NO APARELHO de antes da feature (lib/offline-cache)
//     tambem chega sem o campo, e chega justamente quando a tela nao tem rede
//     para conferir.
//
// Com `=== true`, `undefined` significa "nao soma" e **todo** lancamento
// desaparece dos totais nessas duas janelas: o app zerado, sem erro, sem log, e
// com o tsc verde. Com `!== false`, `undefined` significa "o comportamento de
// antes da feature", que e o certo -- e e literalmente o DEFAULT da coluna.
//
// `!linha.include_in_total` e a mesma armadilha escrita de outro jeito, e e a
// mais facil de cometer porque le bem em voz alta: `!undefined` e `true`, logo
// ela descarta a linha. Ver `coluna-booleana-anulavel-not-is-false`, que mediu
// a familia inteira em producao, e o comentario de `soma_nos_totais` em
// lib/telas-de-movimentacao.ts, que repete o aviso do lado da tela.
//
// ===========================================================================
// O QUE ESTE MODULO **NAO** DECIDE
// ===========================================================================
// Ele nao esconde linha de LISTA e nao mexe em SALDO. A secao 3c do plano da
// HMO-443 e explicita sobre quem fica de fora, e nenhum desses leitores chama
// este modulo:
//
//   * o trigger `update_account_balance`: e ele que aplica o ajuste. Honrar o
//     flag desfaria a feature;
//   * `net_worth_history` (008): o `saldo_hoje` le `current_balance`, que JA
//     contem o ajuste -- filtrar o `movimento` faria o grafico deixar de fechar
//     com o numero grande ao lado;
//   * `/api/net-worth`, `/api/safe-to-spend`, `/api/projection`: somam SALDO DE
//     CONTA, nao receita/despesa;
//   * `card_invoice_lines` (041/061) e a fatura: a fatura e divida de verdade, e
//     a compra tem de ser cobrada mesmo marcada (Opcao A da HMO-455);
//   * `group_share_entries`, `group_member_balances` e os acertos: o que eu DEVO
//     a alguem nao muda porque eu escondi a linha do meu relatorio (decisao D).
//     E por isso que a linha de `partesComoTransacoes` atravessa `entraNosTotais`
//     INTACTA: ela nao tem a coluna, e `undefined !== false` e `true`.
//
// Nem a LISTA de lancamentos: a linha marcada continua aparecendo, com selo
// (decisao C, entregue na F2). O que sai e o numero, nao o registro.
// ---------------------------------------------------------------------------

/**
 * O que uma soma precisa ler de uma linha para saber se ela entra.
 *
 * O campo e OPCIONAL de proposito, e a ausencia e um estado legitimo -- as duas
 * janelas estao no cabecalho. `null` entra na assinatura porque o PostgREST
 * devolve `null` para coluna de embed que a RLS nao deixou ler, e porque uma
 * coluna anulavel no futuro nao deve exigir mexer em sete call sites.
 */
export interface LinhaComTotais {
  include_in_total?: boolean | null;
}

/**
 * Esta linha entra nos totais de relatorio?
 *
 * `!== false` e a forma, e ela e load-bearing: ver o bloco homonimo no
 * cabecalho antes de "simplificar" para `=== true`, `!!` ou `Boolean(...)`.
 * Os tres fazem `undefined` significar "nao soma", e `undefined` e o que chega
 * na janela entre o deploy e a colagem e do cache offline de antes da feature.
 */
export function entraNosTotais(linha: LinhaComTotais): boolean {
  return linha.include_in_total !== false;
}

/**
 * As linhas que somam, na ordem em que chegaram.
 *
 * O generico preserva o tipo da linha: quem chama precisa do registro inteiro
 * (valor, tipo, moeda, conta, `notes`) e nao so do que `LinhaComTotais`
 * declara -- a mesma razao de `filtrarLancamentos` em lib/movimentacoes.ts ser
 * generica.
 *
 * Devolve array NOVO e nunca muta a entrada: as linhas chegam do PostgREST e a
 * mesma lista e lida mais de uma vez em algumas rotas (uma vez por moeda, em
 * /api/reports/cash-flow). Mutar aqui seria efeito a distancia que nao aparece
 * em nenhum dos dois leitores.
 */
export function apenasNosTotais<T extends LinhaComTotais>(
  linhas: readonly T[]
): T[] {
  return linhas.filter(entraNosTotais);
}
