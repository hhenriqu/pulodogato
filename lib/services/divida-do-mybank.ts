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
 * DESDE A FASE 5 (RN021.3) HA TAMBEM AS TRES LEITURAS DO JURO, sobre as views
 * da 071: o juro a receber (Receitas de quem emprestou), o juro devido e o juro
 * pago (Despesas de quem pegou). As abas Receitas e Despesas sao o Resultado do
 * mes, e do emprestimo so o juro entra nele.
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
  COLUNAS_DOS_JUROS_PAGOS,
  VIEW_DOS_JUROS_PAGOS,
  aReceberDoMyBank,
  jurosDevidosNaAgenda,
  parcelasDevidasNaAgenda,
  parcelasDevidasNoPeriodo,
  type AReceberDoMyBank,
  type JuroPagoCru,
  type ParcelaAReceber,
  type ParcelaComJuro,
  type ParcelaDevida,
  type ParcelaDevidaNaAgenda,
} from "@/lib/leituras-do-mybank";
import { viewDaParteAusente } from "@/lib/parte-do-grupo-realizada";

/** As colunas de `mybank_due_entries` que as quatro leituras usam. */
const COLUNAS_DA_DIVIDA =
  "id, loan_id, lender_user_id, description, amount, due_date, status, installment_number, installment_total, reported_at";

/** A view do juro de cada parcela, dos dois lados (071). */
const VIEW_DO_JURO_DA_PARCELA = "mybank_installment_interest";

/** As colunas de `mybank_installment_interest` que as duas leituras do juro usam. */
const COLUNAS_DO_JURO_DA_PARCELA =
  "id, loan_id, lender_user_id, borrower_user_id, loan_status, description, installment_number, installment_total, amount, due_date, status, interest_amount";

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
 * O JURO que as minhas conexoes ainda me devem, na janela -- o lado do CREDOR.
 *
 * Desde a fase 5 (RN021.3) o «Previsto» de Receitas soma so o juro: o
 * principal que volta e transferencia. O juro de cada parcela sai de
 * `mybank_installment_interest` (071), pelo rateio da serie que a confirmacao
 * usa, e a view tem `lender_user_id` -- entao uma consulta basta, sem a
 * leitura previa dos emprestimos que a de `mybank_installments` precisava.
 *
 * `lender_user_id = eu` E OBRIGATORIO NA CONSULTA: a view e dos dois lados
 * (a RLS das tabelas entrega a parcela a quem emprestou e a quem pegou), e sem
 * o filtro o juro que EU devo entraria como juro a receber.
 *
 * `loan_status = 'active'`: o emprestimo `settled` ou `cancelled` nao tem mais
 * nada a receber, e e o mesmo recorte da view do devedor.
 *
 * A JANELA ENTRE O DEPLOY E A COLAGEM DA 071: a view nao existe e o «a receber»
 * fica `null`, como na conta sem MyBank. Os numeros ficam menores ate a
 * colagem, e nenhum soma a parcela cheia como receita.
 */
export async function lerAReceberDoMyBank(
  supabase: SupabaseClient,
  meuUserId: string,
  janela: { de: string; ate: string }
): Promise<LeituraDoAReceber> {
  const { data, error } = await supabase
    .from(VIEW_DO_JURO_DA_PARCELA)
    .select(COLUNAS_DO_JURO_DA_PARCELA)
    .eq("lender_user_id", meuUserId)
    .eq("loan_status", "active")
    .in("status", ["pending", "reported"])
    .gte("due_date", janela.de)
    .lte("due_date", janela.ate);

  if (error && viewDaParteAusente(error)) return { ok: true, aReceber: null };
  if (error) {
    return {
      ok: false,
      mensagem: `Não foi possível ler os juros a receber do MyBank: ${error.message}`,
    };
  }

  return {
    ok: true,
    aReceber: aReceberDoMyBank((data ?? []) as unknown as ParcelaAReceber[], meuUserId),
  };
}

/**
 * O juro que EU devo no MyBank, na janela, no formato da agenda -- a linha da
 * aba Despesas de quem pegou (fase 5, RN021.3).
 *
 * Contas a Pagar e o safe-to-spend continuam lendo `lerDividaDoMyBank`, com a
 * parcela cheia. Esta e so a aba Despesas, que e a metade de Despesas do
 * Resultado do mes.
 *
 * `borrower_user_id = eu` na consulta e na funcao pura, pela razao de sempre:
 * o daqui e tamanho de payload, e o de `jurosDevidosNaAgenda` e a regra.
 *
 * A JANELA ENTRE O DEPLOY E A COLAGEM DA 071: a view nao existe e a lista fica
 * vazia. O juro previsto some da aba ate a colagem.
 */
export async function lerJurosDevidosDoMyBank(
  supabase: SupabaseClient,
  meuUserId: string,
  janela: { de: string; ate: string; hoje: string }
): Promise<LeituraDaDivida> {
  const { data, error } = await supabase
    .from(VIEW_DO_JURO_DA_PARCELA)
    .select(COLUNAS_DO_JURO_DA_PARCELA)
    .eq("borrower_user_id", meuUserId)
    .eq("loan_status", "active")
    .in("status", ["pending", "reported"])
    .gte("due_date", janela.de)
    .lte("due_date", janela.ate);

  if (error && viewDaParteAusente(error)) return { ok: true, linhas: [] };
  if (error) {
    return {
      ok: false,
      mensagem: `Não foi possível ler os juros do MyBank: ${error.message}`,
    };
  }

  return {
    ok: true,
    linhas: jurosDevidosNaAgenda(
      (data ?? []) as unknown as ParcelaComJuro[],
      meuUserId,
      { de: janela.de, ate: janela.ate },
      janela.hoje
    ),
  };
}

export type LeituraDosJurosPagos =
  | { ok: true; juros: JuroPagoCru[] }
  | { ok: false; erro: unknown };

/**
 * O juro que eu ja paguei no MyBank, com a data do pagamento no intervalo --
 * o realizado de quem pegou (fase 5, RN021.3).
 *
 * A forma e a de `lerContasDoFechamentoRealizadas`, e pelas mesmas razoes: erro
 * de verdade volta como erro, para a rota responder 500 em vez de um realizado
 * menor sem aviso, e a view que ainda nao existe (a 071 e colada a mao) e lista
 * vazia.
 *
 * A view ja e `user_id = auth.uid()`; o filtro aqui e a convencao de
 * `group_share_entries`, e nao custa nada.
 */
export async function lerJurosPagosDoMyBank(
  supabase: SupabaseClient,
  meuUserId: string,
  de: string,
  ate: string
): Promise<LeituraDosJurosPagos> {
  const { data, error } = await supabase
    .from(VIEW_DOS_JUROS_PAGOS)
    .select(COLUNAS_DOS_JUROS_PAGOS)
    .eq("user_id", meuUserId)
    .gte("transaction_date", de)
    .lte("transaction_date", ate)
    .order("transaction_date", { ascending: true })
    .order("id", { ascending: true });

  if (error && viewDaParteAusente(error)) return { ok: true, juros: [] };
  if (error) return { ok: false, erro: error };
  return { ok: true, juros: (data ?? []) as unknown as JuroPagoCru[] };
}
