/**
 * LER A DIVIDA DO MYBANK -- as duas leituras de banco, num lugar so (HMO-372).
 *
 * Irmao de `lib/services/credito-dos-grupos.ts`, e extraido pela mesma razao
 * que aquele: QUATRO rotas passam a precisar do mesmo recorte
 * (`/api/scheduled-transactions`, `/summary`, `/api/safe-to-spend` e
 * `/api/movimentacoes/resumo`), e as duas alternativas sao piores.
 *
 *   * COPIAR a consulta para as quatro cria quatro implementacoes da mesma
 *     leitura. Elas empatariam hoje e divergiriam na primeira mudanca -- e a
 *     divergencia apareceria como "Contas a Pagar mostra a parcela e o «A
 *     vencer» do cabecalho da MESMA TELA nao a soma", dois numeros plausiveis
 *     sem nada na tela dizendo por que. E a familia
 *     `fontes-consistentes-que-discordam`;
 *   * CHAMAR uma rota por HTTP de dentro da outra troca uma leitura de banco
 *     por uma ida a rede com cookie forjado, e a sessao nao atravessa.
 *
 * A ARITMETICA NAO ESTA AQUI. `parcelasDevidasNoPeriodo`,
 * `parcelasDevidasNaAgenda` e `aReceberDoMyBank` (lib/leituras-do-mybank.ts)
 * sao puras e tem assercao e mutante proprios. Este modulo le e repassa.
 *
 * O ERRO VOLTA COMO VALOR, E NAO COMO EXCECAO NEM COMO 500
 * -------------------------------------------------------
 * Pela mesma razao de `lerCreditoDosGrupos`: as quatro chamadoras existem para
 * responder OUTRA coisa (a agenda, o resumo, o quanto posso gastar). Trocar
 * todos os numeros do mes por uma tela de erro porque a divida do MyBank nao
 * carregou seria o pior dos dois desfechos. Cada chamadora segue sem a parcela,
 * com um `console.error` -- e a direcao do erro e conhecida: os numeros ficam
 * MENORES (falta uma conta a pagar), que e a direcao que a pessoa percebe
 * quando paga a parcela e a conta nao fecha, e nao a que a faz gastar dinheiro
 * que nao tem.
 *
 * ELE NAO FILTRA POR `borrower_user_id`, E ISSO E A VIEW
 * -----------------------------------------------------
 * `mybank_due_entries` ja e `WHERE borrower_user_id = auth.uid()` com
 * `security_invoker = true` (F1). Repetir o filtro aqui seria a segunda copia
 * do recorte -- e a copia esquecida e o defeito. O que esta rotina acrescenta
 * e o RECORTE DE DATA, que a view nao tem de proposito (ela e a divida
 * inteira): `leitura-sem-recorte-de-data-soma-o-horizonte`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  aReceberDoMyBank,
  parcelasDevidasNaAgenda,
  parcelasDevidasNoPeriodo,
  type AReceberDoMyBank,
  type ParcelaAReceber,
  type ParcelaDevida,
  type ParcelaDevidaNaAgenda,
} from "@/lib/leituras-do-mybank";

/** As colunas de `mybank_due_entries` que as quatro leituras usam. */
const COLUNAS_DA_DIVIDA =
  "id, loan_id, lender_user_id, description, amount, due_date, status, installment_number, installment_total, reported_at";

/** A divida lida, ou a mensagem do erro -- nunca um `throw`. */
export type LeituraDaDivida =
  | { ok: true; linhas: ParcelaDevidaNaAgenda[] }
  | { ok: false; mensagem: string };

/**
 * O que EU devo no MyBank na janela, no formato da agenda.
 *
 * `de: null` e SEM PISO, e e o que o safe-to-spend passa: a parcela que venceu
 * no mes passado e nao foi confirmada continua sendo dinheiro que vai sair.
 * As outras tres leituras passam as duas pontas da janela que a tela mostra.
 *
 * O FILTRO DE DATA VAI NA CONSULTA **E** NA FUNCAO PURA, e nao e redundancia:
 * o `.gte`/`.lte` daqui e tamanho de payload (a view e a divida inteira, 24
 * parcelas por emprestimo), e o de `parcelasDevidasNoPeriodo` e a REGRA, que o
 * teste alcanca sem subir banco. A mesma decisao do `to_user_id` em
 * /api/movimentacoes/resumo.
 */
export async function lerDividaDoMyBank(
  supabase: SupabaseClient,
  meuUserId: string,
  janela: { de: string | null; ate: string; hoje: string }
): Promise<LeituraDaDivida> {
  let consulta = supabase
    .from("mybank_due_entries")
    .select(COLUNAS_DA_DIVIDA)
    .lte("due_date", janela.ate);

  if (janela.de !== null) consulta = consulta.gte("due_date", janela.de);

  const { data, error } = await consulta;

  if (error) {
    return {
      ok: false,
      mensagem: `Não foi possível ler a dívida do MyBank: ${error.message}`,
    };
  }

  const noPeriodo = parcelasDevidasNoPeriodo(
    (data ?? []) as unknown as ParcelaDevida[],
    { de: janela.de, ate: janela.ate }
  );

  // `user_id` fica vazio aqui de proposito: quem o preenche e a rota, com o
  // `user.id` da sessao (`comODonoDaLeitura`). Ver o cabecalho daquele campo em
  // lib/leituras-do-mybank.ts -- e a licao da HMO-311 na fatura sintetizada.
  return { ok: true, linhas: parcelasDevidasNaAgenda(noPeriodo, janela.hoje) };
}

/** O "a receber" lido, ou a mensagem do erro. `null` = nao ha nada a receber. */
export type LeituraDoAReceber =
  | { ok: true; aReceber: AReceberDoMyBank | null }
  | { ok: false; mensagem: string };

/**
 * O que as minhas conexoes ainda me devem, na janela -- o lado do CREDOR.
 *
 * DUAS CONSULTAS E NAO UM EMBED, e a razao e a RLS e nao estilo. A policy de
 * SELECT de `mybank_installments` e um `EXISTS` no emprestimo que libera os
 * DOIS lados (credor e devedor), entao uma leitura de `mybank_installments`
 * sem filtro traria tambem as parcelas que EU devo a outra pessoa -- que sao
 * exatamente o oposto de "a receber". O filtro que separa os dois lados e
 * `mybank_loans.lender_user_id = eu`, e ele precisa de uma consulta propria:
 * um `.eq("loan.lender_user_id", ...)` sobre coluna de embed transforma o LEFT
 * JOIN em INNER no PostgREST, e a 053 deu a `mybank_installments` uma FK unica
 * para `mybank_loans` mas o embed curto ainda seria mais um nome para manter
 * sincronizado com a migration (`embed-de-fk-composta-resolve-no-postgrest`).
 *
 * `status = 'active'` NO EMPRESTIMO: o emprestimo `settled` ou `cancelled` nao
 * tem mais nada a receber, e e o mesmo recorte da view do devedor -- as duas
 * pontas da mesma divida tem de concordar sobre ela existir.
 */
export async function lerAReceberDoMyBank(
  supabase: SupabaseClient,
  meuUserId: string,
  janela: { de: string; ate: string }
): Promise<LeituraDoAReceber> {
  const { data: emprestimos, error: erroEmprestimos } = await supabase
    .from("mybank_loans")
    .select("id, borrower_user_id")
    .eq("lender_user_id", meuUserId)
    .eq("status", "active");

  if (erroEmprestimos) {
    return {
      ok: false,
      mensagem: `Não foi possível ler os empréstimos do MyBank: ${erroEmprestimos.message}`,
    };
  }

  const meus = (emprestimos ?? []) as { id: string; borrower_user_id: string }[];

  // Sem emprestimo nenhum a segunda consulta nao e feita. Nao e so economia: um
  // `.in("loan_id", [])` no PostgREST e uma clausula vazia, e o comportamento
  // dela nao e o que se le -- a consulta sem filtro efetivo devolveria TODA
  // parcela que a RLS me entrega, inclusive as que EU devo. A conta sem MyBank
  // e o controle negativo desta issue, e ela passa por aqui.
  if (meus.length === 0) return { ok: true, aReceber: null };

  const porEmprestimo = new Map(meus.map((e) => [e.id, e.borrower_user_id]));

  const { data: parcelas, error: erroParcelas } = await supabase
    .from("mybank_installments")
    .select("id, loan_id, amount, due_date, status")
    .in(
      "loan_id",
      meus.map((e) => e.id)
    )
    .gte("due_date", janela.de)
    .lte("due_date", janela.ate);

  if (erroParcelas) {
    return {
      ok: false,
      mensagem: `Não foi possível ler as parcelas a receber do MyBank: ${erroParcelas.message}`,
    };
  }

  const comODevedor: ParcelaAReceber[] = (
    (parcelas ?? []) as unknown as Omit<ParcelaAReceber, "borrower_user_id">[]
  ).map((parcela) => ({
    ...parcela,
    // `?? meuUserId` e a direcao SEGURA, e nao defensividade: um `loan_id` que
    // nao esteja no mapa so pode ter vindo de um emprestimo que nao e meu como
    // credor, e `aReceberDoMyBank` descarta o que e meu de os dois lados. O
    // outro default (`""`) faria essa linha ser contada como receita a receber
    // de um devedor que nao existe.
    borrower_user_id: porEmprestimo.get(parcela.loan_id) ?? meuUserId,
  }));

  return { ok: true, aReceber: aReceberDoMyBank(comODevedor, meuUserId) };
}
