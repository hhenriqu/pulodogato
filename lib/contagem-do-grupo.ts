// =====================================================
// QUANTAS DESPESAS DO GRUPO CADA MEMBRO PARTICIPA -- HMO-259
// =====================================================
// Arquivo-FOLHA: nenhum import. A contagem e aritmetica de conjunto, nao de
// dinheiro, e nao precisa de nada de `lib/dinheiro.ts` nem do cliente Supabase.
//
// O DEFEITO QUE ISTO CONSERTA
// ---------------------------
// `GET /api/expense-groups/{id}/balances` devolvia
//
//     transactions_count: paid_count + owed_count
//
// e as duas colunas da view `group_member_balances` (007/026) contam COISAS
// DIFERENTES sobre A MESMA despesa:
//
//     paid_count  -- quantas despesas do grupo este membro PAGOU
//     owed_count  -- em quantos rateios do grupo ele tem parte
//
// Quem paga um jantar e rateia com os outros aparece nas duas. Somar e contar
// essa despesa duas vezes. Medido na conta de teste da HMO-255 em producao
// (grupo de 12 despesas, 6 pagas pela A, 6 pela B, todas rateadas entre os
// tres):
//
//     antes:  A 18   B 18   C 12        depois:  A 12   B 12   C 12
//
// O 18 nao e "12 + 6 erradas": e 12 rateios + 6 despesas proprias, e as 6
// proprias JA ESTAVAM entre os 12. O numero certo e o tamanho da UNIAO, nao a
// soma dos dois lados -- e e por isso que o conserto nao cabe na rota somando
// ou subtraindo colunas: de `paid_count` e `owed_count` prontos nao se recupera
// a intersecao. Tem de voltar as linhas.
//
// NENHUM VALOR EM REAIS MUDA
// --------------------------
// `total_paid`, `total_owed`, `net_balance` e os acertos continuam vindo da
// view, intocados. A soma de dinheiro dos dois lados esta CERTA justamente
// porque cada lado soma uma coisa diferente (o que ele pagou menos a parte que
// lhe cabe); e so a CONTAGEM que nao pode ser somada assim.
//
// POR QUE AQUI, E NAO NA VIEW
// ---------------------------
// Uma coluna nova em `group_member_balances` seria a casa natural -- a view e
// onde mora a regra de saldo de grupo. Duas coisas pesaram contra:
//
//   1. a view e lida por `security_invoker`, e a rota le as MESMAS tabelas com o
//      MESMO cliente. A visibilidade e identica por construcao: toda linha que
//      a view enxerga nos dois LATERAL desta conta, esta rota enxerga aqui, e
//      nenhuma outra. Nao e uma segunda implementacao da regra de saldo -- e a
//      mesma regra de participacao, sobre as mesmas linhas, contada sem somar.
//   2. `CREATE OR REPLACE VIEW` so aceita coluna nova no FIM, e a coluna nova so
//      existe em producao depois de alguem colar o SQL no editor do Supabase. Um
//      `select` que pedisse a coluna antes disso devolve 42703 e derruba a tela
//      de grupo inteira -- trocar um contador cosmetico errado pela tela
//      principal do grupo em 500 e um mau negocio.
//
// AS DUAS PERNAS, E POR QUE O FILTRO DE CADA UMA E O QUE E
// --------------------------------------------------------
// As condicoes abaixo sao as dos dois LATERAL da view, uma a uma, de proposito
// -- inclusive onde elas sao ASSIMETRICAS:
//
//   PAGOU:  `t.user_id = m.user_id AND t.transaction_type = 'expense'`
//   DEVE:   `es.status NOT IN ('rejected','expired')`, sem filtro de tipo
//
// A perna do pago exige `expense`; a do rateio NAO exige. Parece descuido e nao
// e: rateio so nasce de despesa (o trigger da 042 e a 024 so criam parte para
// despesa de grupo), entao o filtro seria redundante la e mentiria aqui -- se um
// dia nascer rateio de outra natureza, quem tem parte nele PARTICIPA dela, e a
// contagem tem de dizer isso. Mudar um dos dois lados aqui faz esta contagem
// discordar de `paid_count`/`owed_count` na mesma resposta, o que e pior do que
// o defeito que ela conserta: dois numeros errados em vez de um.
// =====================================================

/**
 * Rateio que nao conta: parte recusada pelo membro, ou que expirou sem
 * resposta. As duas deixam de ser divida -- e a 007 tirou do saldo pela mesma
 * razao. Quem recusou a parte nao participa da despesa.
 */
export const STATUS_FORA_DO_RATEIO: readonly string[] = ["rejected", "expired"];

/**
 * O unico `transaction_type` que conta pela perna do PAGOU. Despesa e gravada
 * NEGATIVA neste banco e o tipo e quem a identifica -- ver `ABS()` na view.
 */
export const TIPO_DE_DESPESA = "expense";

/** Uma parte de `group_expense_splits`, so o que a contagem usa. */
export interface RateioParaContagem {
  /** `group_expense_splits.member_id` -- aponta para `group_members.id`. */
  member_id: string | null | undefined;
  /** `pending` | `approved` | `rejected` | `expired`. */
  status: string | null | undefined;
}

/** Uma despesa do grupo (`group_transactions`), so o que a contagem usa. */
export interface DespesaParaContagem {
  /** `group_transactions.id`. NAO e o id do `financial_transactions`. */
  id: string;
  /** `financial_transactions.user_id` -- quem pagou. */
  pagador: string | null | undefined;
  /** `financial_transactions.transaction_type`. */
  tipo: string | null | undefined;
  rateios: RateioParaContagem[];
}

/**
 * Quantas despesas do grupo cada membro participa, contando cada despesa UMA
 * vez.
 *
 * Participar e pagar a despesa ou ter parte nao recusada nela. A chave do
 * resultado e `user_id`, e nao `member_id`, porque e assim que a view agrupa:
 * um usuario que saiu e voltou tem duas linhas em `group_members` e UM saldo.
 *
 * @param despesas as despesas do grupo, com os rateios de cada uma.
 * @param userIdPorMembro `group_members.id` -> `group_members.user_id`, do
 *   grupo inteiro e de TODO status. Membro inativo entra: a perna do rateio na
 *   view junta por `em.id = es.member_id` sem exigir `active`, entao a parte que
 *   ficou no nome de quem saiu continua contando para ele. Rateio cujo
 *   `member_id` nao esta no mapa nao conta para ninguem -- e o que a view faz
 *   quando a RLS esconde a linha do membro.
 * @returns contagem por `user_id`. Usuario sem participacao nenhuma nao aparece
 *   no mapa; quem le deve tratar a ausencia como zero.
 */
export function contagemPorMembro(
  despesas: readonly DespesaParaContagem[],
  userIdPorMembro: ReadonlyMap<string, string>,
): Map<string, number> {
  // Conjunto, e nao contador, PORQUE o defeito era justamente contar a mesma
  // despesa duas vezes. Incrementar um numero nas duas pernas reproduziria o
  // 18; o Set e o que torna a de-duplicacao impossivel de esquecer.
  const despesasPorUsuario = new Map<string, Set<string>>();

  const participa = (userId: string | null | undefined, despesaId: string) => {
    if (!userId) return;
    let conjunto = despesasPorUsuario.get(userId);
    if (!conjunto) {
      conjunto = new Set<string>();
      despesasPorUsuario.set(userId, conjunto);
    }
    conjunto.add(despesaId);
  };

  for (const despesa of despesas) {
    if (despesa.tipo === TIPO_DE_DESPESA) {
      participa(despesa.pagador, despesa.id);
    }

    for (const rateio of despesa.rateios) {
      if (!rateio.member_id) continue;
      if (STATUS_FORA_DO_RATEIO.includes(rateio.status ?? "")) continue;
      participa(userIdPorMembro.get(rateio.member_id), despesa.id);
    }
  }

  // `forEach` e nao `for (const [k, v] of mapa)`, e nao e estilo: o tsconfig da
  // suite tem `target: es2020` e o do APP nao, entao o `for...of` sobre um Map
  // compila aqui e reprova no `next build` com TS2802 -- erro que nenhuma suite
  // ve, porque cada suite compila com o target dela. Medido ao escrever isto.
  // Sobre ARRAY o `for...of` passa nos dois, e e por isso que os lacos acima
  // ficaram como estao.
  const contagem = new Map<string, number>();
  despesasPorUsuario.forEach((conjunto, userId) => {
    contagem.set(userId, conjunto.size);
  });
  return contagem;
}
