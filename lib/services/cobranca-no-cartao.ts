// =====================================================
// A COBRANCA NO CARTAO, NO BANCO (24/10/2026)
// =====================================================
// A regra mora em `lib/cobranca-no-cartao.ts`. Aqui ficam as tres coisas que
// precisam de banco:
//
//   * `lancarCobrancasDoCartao` -- no dia da cobranca, a compra no cartao;
//   * `cobrancasPendentesNosCartoes` -- o que ainda vai cair em cada fatura;
//   * `vencimentosDasFaturas` -- o vencimento da fatura em que cada uma cai,
//     pelo `card_invoice_due_date` do banco.
//
// NAO HA CRON NESTE APP, e o lancamento e preguicoso de proposito: ele roda na
// primeira leitura da fatura depois do dia (a sintese da fatura aberta, a tela
// do cartao e o fechamento). Antes de qualquer uma delas ninguem ve a fatura,
// entao a compra lancada uma hora depois da meia-noite ou tres dias depois da
// a mesma resposta -- a data gravada e a do dia da cobranca, nao a da leitura.
//
// NADA AQUI DERRUBA A LEITURA. Uma escrita que falha deixa a conta prevista
// pendente, e a proxima leitura tenta de novo; enquanto isso ela continua
// contando como prevista na fatura. O contrario -- a tela de erro porque uma
// assinatura nao virou compra -- troca uma linha atrasada por uma pagina vazia.
// =====================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { today } from "@/lib/recurrence";
import { getServiceId } from "@/lib/services/scheduled";
import {
  cobrancasNaFatura,
  compraDaCobranca,
  cobrancaApagadaVoltaParaPulada,
  ehCobrancaNoCartao,
  type CartaoDaCobranca,
  type CobrancaNaFatura,
  type PrevistaNoCartao,
} from "@/lib/cobranca-no-cartao";

/** O que a leitura pede da conta prevista. */
const COLUNAS_DA_PREVISTA =
  "id, user_id, recurring_rule_id, category_id, subcategory_id, account_id, group_id, description, amount, due_date, status, notes, created_at, transaction_type, group_closing_id, expense_split_id, recurring_rule:recurring_rules(transaction_type)";

/**
 * Os cartoes da pessoa, ativos ou nao.
 *
 * O ARQUIVADO ENTRA: arquivar o cartao nao encerra a assinatura cadastrada
 * nele, e a cobranca que vence depois ainda e uma compra naquele cartao. `null`
 * e "nao deu para ler" -- diferente de `[]`.
 */
async function cartoesDaPessoa(
  supabase: SupabaseClient,
  userId: string
): Promise<CartaoDaCobranca[] | null> {
  const { data, error } = await supabase
    .from("financial_accounts")
    .select("id, name, closing_day, due_day")
    .eq("user_id", userId)
    .eq("account_type", "credit_card");
  if (error) {
    console.error("Não foi possível ler os cartões para as cobranças:", error);
    return null;
  }
  return (data ?? []) as CartaoDaCobranca[];
}

/**
 * Lanca no cartao as cobrancas cujo dia ja chegou, e da a conta prevista por
 * paga.
 *
 * DUAS ESCRITAS, NESTA ORDEM, E AS DUAS IDEMPOTENTES:
 *
 *   1. a compra, com o id derivado da conta prevista. Se ela ja existe (outra
 *      rota chegou antes, ou a escrita 2 falhou na vez anterior), o banco
 *      responde 23505 e segue-se para a 2 -- e a compra e a mesma.
 *   2. a conta prevista para `paid`, so se ainda estiver `pending`. O CHECK da
 *      005 exige `paid_date` e `transaction_id` juntos, e e o id da 1.
 *
 * Na ordem contraria uma falha entre as duas deixaria a conta paga sem compra:
 * dinheiro que sumiu da fatura. Nesta, o pior caso e a compra existindo com a
 * conta ainda pendente por uma leitura, e a proxima a fecha.
 *
 * Devolve quantas viraram compra agora, para o log de quem chama.
 */
export async function lancarCobrancasDoCartao(
  supabase: SupabaseClient,
  userId: string,
  hoje: string = today()
): Promise<number> {
  try {
    const cartoes = await cartoesDaPessoa(supabase, userId);
    if (!cartoes?.length) return 0;

    const { data, error } = await supabase
      .from("scheduled_transactions")
      .select(COLUNAS_DA_PREVISTA)
      .eq("user_id", userId)
      .eq("status", "pending")
      .in(
        "account_id",
        cartoes.map((c) => c.id)
      )
      .lte("due_date", hoje);

    if (error) {
      console.error("As cobranças do cartão não foram lançadas:", error);
      return 0;
    }

    const vencidas = ((data ?? []) as unknown as PrevistaNoCartao[]).filter(
      ehCobrancaNoCartao
    );
    if (vencidas.length === 0) return 0;

    const serviceId = await getServiceId(supabase);
    if (!serviceId) {
      console.error("As cobranças do cartão não foram lançadas: serviço de finanças não encontrado");
      return 0;
    }

    let lancadas = 0;
    for (const prevista of vencidas) {
      const compra = compraDaCobranca(prevista, serviceId);
      if (!compra) continue;

      const { error: erroCompra } = await supabase
        .from("financial_transactions")
        .insert(compra);

      // 23505: a compra ja existe, com este mesmo id. Segue para a baixa.
      if (erroCompra && erroCompra.code !== "23505") {
        console.error(
          `A cobrança ${prevista.id} não virou compra no cartão:`,
          erroCompra
        );
        continue;
      }

      const { error: erroBaixa } = await supabase
        .from("scheduled_transactions")
        .update({
          status: "paid",
          paid_date: prevista.due_date,
          transaction_id: compra.id,
        })
        .eq("id", prevista.id)
        .eq("user_id", userId)
        .eq("status", "pending");

      if (erroBaixa) {
        console.error(
          `A cobrança ${prevista.id} virou compra e a conta prevista não foi dada por paga:`,
          erroBaixa
        );
        continue;
      }
      if (!erroCompra) lancadas += 1;
    }
    return lancadas;
  } catch (erro) {
    console.error("As cobranças do cartão não foram lançadas:", erro);
    return 0;
  }
}

/**
 * As cobrancas PENDENTES nos cartoes da pessoa, com o mes da fatura de cada
 * uma.
 *
 * `ate` limita pelo dia da cobranca: uma compra depois dele nao cai em fatura
 * que vence antes dele. `de`, quando vem, e o outro limite. `null` e "nao deu
 * para ler", e quem recebe nao pode trata-lo como "nenhuma".
 */
export async function cobrancasPendentesNosCartoes(
  supabase: SupabaseClient,
  userId: string,
  janela: { de?: string; ate: string }
): Promise<{ cobrancas: CobrancaNaFatura[]; cartoes: CartaoDaCobranca[] } | null> {
  const cartoes = await cartoesDaPessoa(supabase, userId);
  if (cartoes === null) return null;
  if (cartoes.length === 0) return { cobrancas: [], cartoes };

  let consulta = supabase
    .from("scheduled_transactions")
    .select(COLUNAS_DA_PREVISTA)
    .eq("user_id", userId)
    .eq("status", "pending")
    .in(
      "account_id",
      cartoes.map((c) => c.id)
    )
    .lte("due_date", janela.ate);
  if (janela.de) consulta = consulta.gte("due_date", janela.de);

  const { data, error } = await consulta;
  if (error) {
    console.error("Não foi possível ler as cobranças previstas dos cartões:", error);
    return null;
  }

  return {
    cobrancas: cobrancasNaFatura(
      (data ?? []) as unknown as PrevistaNoCartao[],
      cartoes
    ),
    cartoes,
  };
}

/**
 * O vencimento de cada fatura (cartao + mes), pelo `card_invoice_due_date` do
 * banco.
 *
 * PELO BANCO, E NAO EM TYPESCRIPT: a regra do vencimento (o mes seguinte
 * quando o `due_day` vem antes do fechamento, o dia 31 que vira o ultimo do
 * mes) existe num lugar so, a 006. A fatura que so tem cobranca prevista nao
 * tem linha na view para trazer o vencimento, e e so para ela que esta funcao
 * existe.
 *
 * Cartao sem `due_day` volta `null` sem perguntar -- e o que a funcao do banco
 * responderia. Uma consulta que falha some do mapa: quem le trata "sem
 * vencimento conhecido" como "nao da para pôr na agenda", e nao inventa data.
 */
export async function vencimentosDasFaturas(
  supabase: SupabaseClient,
  pares: { account_id: string; invoice_month: string }[],
  cartoes: CartaoDaCobranca[]
): Promise<Map<string, string | null>> {
  const porId = new Map(cartoes.map((c) => [c.id, c]));
  const unicos = new Map<string, { account_id: string; invoice_month: string }>();
  for (const p of pares) unicos.set(`${p.account_id}|${p.invoice_month}`, p);

  const vencimentos = new Map<string, string | null>();
  await Promise.all(
    Array.from(unicos.entries()).map(async ([chave, par]) => {
      const cartao = porId.get(par.account_id);
      if (!cartao) return;
      if (cartao.due_day === null || cartao.due_day === undefined) {
        vencimentos.set(chave, null);
        return;
      }
      const { data, error } = await supabase.rpc("card_invoice_due_date", {
        p_invoice_month: par.invoice_month,
        p_closing_day: cartao.closing_day ?? null,
        p_due_day: cartao.due_day,
      });
      if (error || typeof data !== "string") {
        console.error(
          `Não foi possível calcular o vencimento da fatura ${chave}:`,
          error
        );
        return;
      }
      vencimentos.set(chave, data.slice(0, 10));
    })
  );
  return vencimentos;
}

/**
 * Apagar a compra que o app lancou de uma cobranca deixa a conta prevista
 * PULADA, e nao pendente.
 *
 * O trigger da 065 solta a conta prevista quando o lancamento que a quitou e
 * apagado -- ela volta para `pending`. Para a cobranca no cartao isso a faria
 * virar compra de novo na proxima leitura, com o mesmo id: apagar nao
 * apagaria. Quem apaga a compra que o app lancou esta dizendo que aquela
 * cobranca nao aconteceu.
 *
 * DUAS METADES, PORQUE O TRIGGER RODA NO MEIO: `cobrancaDaCompra` le ANTES do
 * DELETE (depois dele o elo `transaction_id` ja foi apagado), e
 * `pularCobranca` escreve DEPOIS (antes dele a conta ainda esta `paid`, e o
 * trigger a soltaria de volta).
 */
export async function cobrancaDaCompra(
  supabase: SupabaseClient,
  userId: string,
  transactionId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("scheduled_transactions")
    .select("id")
    .eq("user_id", userId)
    .eq("transaction_id", transactionId)
    .maybeSingle();
  if (error || !data?.id) return null;
  return cobrancaApagadaVoltaParaPulada(transactionId, data.id) ? data.id : null;
}

export async function pularCobranca(
  supabase: SupabaseClient,
  userId: string,
  scheduledId: string
): Promise<void> {
  const { error } = await supabase
    .from("scheduled_transactions")
    .update({ status: "skipped" })
    .eq("id", scheduledId)
    .eq("user_id", userId)
    .eq("status", "pending");
  if (error) {
    console.error(
      `A compra da cobrança ${scheduledId} foi apagada e a conta prevista não foi pulada:`,
      error
    );
  }
}
