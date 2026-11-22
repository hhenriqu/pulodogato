// =====================================================
// A COMPOSICAO DOS CARTOES: AS LEITURAS (docs/COMPOSICAO-DA-FATURA.md)
// =====================================================
// A regra mora em `lib/composicao-da-fatura.ts`, sem I/O. Aqui ficam as
// leituras que ela precisa e a montagem da resposta de
// GET /api/card-invoices/composicao:
//
//   * os cartoes ativos (com o fechamento, para achar a fatura em aberto);
//   * as linhas de `card_invoice_lines` do mes pedido (o MENSAL) e as do mes
//     mais antigo ainda em aberto em diante (o TOTAL para quitar);
//   * a situacao de cada fatura que ja virou conta a pagar (chave `fatura:`);
//   * as baixas das contas fixas no cartao (a compra que a conta prevista
//     virou), as regras com a marca de assinatura, e as recorrencias que o
//     detector achou no extrato;
//   * as cobrancas previstas (a conta fixa no cartao antes do dia dela).
//
// O QUE PODE FALTAR SEM DERRUBAR A RESPOSTA: as leituras que so RECONHECEM o
// recorrente (baixas, regras, detector). Sem elas a compra cai em esporadico
// -- um rotulo pior, nunca um numero diferente no total. As que dao o
// DINHEIRO (cartoes, linhas, faturas, cobrancas) derrubam: um total menor sem
// aviso e o defeito que a tela nao pode ter.
// =====================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { today } from "@/lib/recurrence";
import { normalizeMerchant } from "@/lib/recurrence-detector";
import { faturaAbertaDoCartao } from "@/lib/fatura-do-cartao";
import { faturaDaChave } from "@/lib/chave-da-fatura";
import { contasQueSomam } from "@/lib/contas";
import { cobrancasPendentesNosCartoes } from "@/lib/services/cobranca-no-cartao";
import {
  composicaoDaFatura,
  mesDeslocado,
  quitacaoDoCartao,
  somarComposicoes,
  type Composicao,
  type LinhaDaComposicao,
  type Reconhecimento,
  type SituacaoDaFatura,
} from "@/lib/composicao-da-fatura";

export interface ComposicaoDoCartao {
  account_id: string;
  account_name: string;
  include_in_total?: boolean;
  /** 'AAAA-MM-01' da fatura em aberto hoje. */
  mes_aberto: string;
  /** A fatura do mes pedido. */
  mensal: Composicao;
  /** Quanto falta para quitar este cartao. */
  total: Composicao;
}

export interface RespostaDaComposicao {
  /** 'AAAA-MM-01' do mensal. */
  mes: string;
  hoje: string;
  cartoes: ComposicaoDoCartao[];
  /** Soma dos cartoes que entram nos totais. */
  mensal: Composicao;
  total: Composicao;
  /** Quantos cartoes ficaram fora da soma (o flag "somar nos totais"). */
  fora_dos_totais: number;
}

/** O PostgREST corta em 1000 linhas; esta leitura pagina. */
const PAGINA = 1000;

async function linhasDosCartoes(
  supabase: SupabaseClient,
  ids: string[],
  filtro: { igual?: string; aPartirDe?: string }
): Promise<LinhaDaComposicao[] | null> {
  const todas: LinhaDaComposicao[] = [];
  for (let de = 0; ; de += PAGINA) {
    let q = supabase
      .from("card_invoice_lines")
      .select("transaction_id, account_id, invoice_month, invoice_amount, description, installment_total")
      .in("account_id", ids)
      .order("transaction_id", { ascending: true })
      .range(de, de + PAGINA - 1);
    if (filtro.igual) q = q.eq("invoice_month", filtro.igual);
    if (filtro.aPartirDe) q = q.gte("invoice_month", filtro.aPartirDe);
    const { data, error } = await q;
    if (error) {
      console.error("Composição dos cartões sem as linhas da fatura:", error);
      return null;
    }
    todas.push(...((data ?? []) as LinhaDaComposicao[]));
    if (!data || data.length < PAGINA) return todas;
  }
}

async function reconhecimento(
  supabase: SupabaseClient,
  userId: string,
  idsDosCartoes: string[]
): Promise<Reconhecimento> {
  const regraDaBaixa = new Map<string, string>();
  const assinaturaDaRegra = new Map<string, boolean>();
  const transacoesDeAssinatura = new Set<string>();
  const chavesDeAssinatura = new Set<string>();
  const chavesFixas = new Set<string>();

  const [baixas, regras, detectadas] = await Promise.all([
    supabase
      .from("scheduled_transactions")
      .select("transaction_id, recurring_rule_id")
      .eq("user_id", userId)
      .in("account_id", idsDosCartoes)
      .not("transaction_id", "is", null)
      .not("recurring_rule_id", "is", null),
    supabase
      .from("recurring_rules")
      .select("id, description, transaction_type, is_active, is_subscription")
      .eq("user_id", userId),
    supabase
      .from("detected_recurrences")
      .select("merchant_key, transaction_ids, status")
      .eq("user_id", userId)
      .in("status", ["DETECTED", "CONFIRMED"]),
  ]);

  if (baixas.error) {
    console.error("Composição sem as baixas das contas fixas:", baixas.error);
  } else {
    for (const b of baixas.data ?? []) {
      if (b.transaction_id && b.recurring_rule_id) {
        regraDaBaixa.set(b.transaction_id, b.recurring_rule_id);
      }
    }
  }

  if (regras.error) {
    console.error("Composição sem as contas fixas:", regras.error);
  } else {
    for (const r of regras.data ?? []) {
      const assinatura = Boolean(r.is_subscription);
      assinaturaDaRegra.set(r.id, assinatura);
      if (r.is_active === false || (r.transaction_type ?? "expense") !== "expense") continue;
      const chave = normalizeMerchant(r.description ?? "");
      if (!chave) continue;
      (assinatura ? chavesDeAssinatura : chavesFixas).add(chave);
    }
  }

  if (detectadas.error) {
    console.error("Composição sem as recorrências do extrato:", detectadas.error);
  } else {
    for (const d of detectadas.data ?? []) {
      if (d.merchant_key) chavesDeAssinatura.add(d.merchant_key);
      for (const id of (d.transaction_ids ?? []) as string[]) transacoesDeAssinatura.add(id);
    }
  }

  return {
    regraDaBaixa,
    assinaturaDaRegra,
    transacoesDeAssinatura,
    chavesDeAssinatura,
    chavesFixas,
    chave: normalizeMerchant,
  };
}

/** 'AAAA-MM-01' -> o ultimo dia daquele mes. */
function ultimoDiaDoMes(mes: string): string {
  const dia = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate();
  return `${mes.slice(0, 7)}-${String(dia).padStart(2, "0")}`;
}

/**
 * A composicao dos cartoes ativos (ou de um so). `null` quando uma leitura de
 * DINHEIRO falhou -- ver o cabecalho.
 *
 * @param mes 'AAAA-MM-01' da fatura do mensal
 */
export async function lerComposicaoDosCartoes(
  supabase: SupabaseClient,
  userId: string,
  params: { mes: string; accountId?: string | null }
): Promise<RespostaDaComposicao | null> {
  const hoje = today();
  const { mes, accountId } = params;

  let consultaCartoes = supabase
    .from("financial_accounts")
    .select("id, name, closing_day, include_in_total")
    .eq("user_id", userId)
    .eq("account_type", "credit_card")
    .eq("is_active", true);
  if (accountId) consultaCartoes = consultaCartoes.eq("id", accountId);
  const { data: cartoes, error: erroCartoes } = await consultaCartoes;
  if (erroCartoes) {
    console.error("Composição sem os cartões:", erroCartoes);
    return null;
  }

  const vazia: Composicao = { fixo: 0, assinatura: 0, parcelado: 0, esporadico: 0, total: 0 };
  if (!cartoes || cartoes.length === 0) {
    return { mes, hoje, cartoes: [], mensal: vazia, total: vazia, fora_dos_totais: 0 };
  }

  const ids = cartoes.map((c) => c.id as string);
  // A fatura em aberto de cada cartao, pelo fechamento. Sem fechamento nao ha
  // ciclo (a 006 trata a compra como do proprio mes): a aberta e a do mes.
  const mesAberto = new Map<string, string>(
    cartoes.map((c) => [
      c.id as string,
      `${faturaAbertaDoCartao(hoje, c.closing_day) ?? hoje.slice(0, 7)}-01`,
    ])
  );

  // A situacao das faturas que viraram conta a pagar.
  const { data: faturas, error: erroFaturas } = await supabase
    .from("scheduled_transactions")
    .select("notes, status")
    .eq("user_id", userId)
    .like("notes", "fatura:%");
  if (erroFaturas) {
    console.error("Composição sem a situação das faturas:", erroFaturas);
    return null;
  }
  const situacoes = new Map<string, Map<string, SituacaoDaFatura>>();
  for (const f of faturas ?? []) {
    const chave = faturaDaChave(f.notes);
    if (!chave || !mesAberto.has(chave.accountId)) continue;
    const situacao: SituacaoDaFatura | null =
      f.status === "paid" ? "paga" : f.status === "pending" ? "pendente" : null;
    if (!situacao) continue;
    const doCartao = situacoes.get(chave.accountId) ?? new Map<string, SituacaoDaFatura>();
    // Paga vence pendente: a fatura paga em duas vezes tem as duas linhas.
    if (doCartao.get(chave.mes) !== "paga") doCartao.set(chave.mes, situacao);
    situacoes.set(chave.accountId, doCartao);
  }

  // Desde quando ler para o TOTAL: a fatura anterior a aberta mais antiga, ou a
  // pendente mais antiga.
  let aPartirDe = mesDeslocado(
    Array.from(mesAberto.values()).sort()[0],
    -1
  );
  situacoes.forEach((doCartao) =>
    doCartao.forEach((s, m) => {
      if (s === "pendente" && m < aPartirDe) aPartirDe = m;
    })
  );
  const ultimoAberto = Array.from(mesAberto.values()).sort().reverse()[0];

  const [linhasDoMes, linhasEmAberto, cobrancasLidas, rec] = await Promise.all([
    linhasDosCartoes(supabase, ids, { igual: mes }),
    linhasDosCartoes(supabase, ids, { aPartirDe }),
    cobrancasPendentesNosCartoes(supabase, userId, {
      de: mesDeslocado(mes < aPartirDe ? mes : aPartirDe, -1),
      ate: ultimoDiaDoMes(mes > ultimoAberto ? mes : ultimoAberto),
    }),
    reconhecimento(supabase, userId, ids),
  ]);
  if (!linhasDoMes || !linhasEmAberto || !cobrancasLidas) return null;

  const porCartao: ComposicaoDoCartao[] = cartoes.map((c) => {
    const id = c.id as string;
    const cobrancas = cobrancasLidas.cobrancas.filter((x) => x.account_id === id);
    return {
      account_id: id,
      account_name: c.name as string,
      include_in_total: c.include_in_total ?? undefined,
      mes_aberto: mesAberto.get(id)!,
      mensal: composicaoDaFatura({
        linhas: linhasDoMes.filter((l) => l.account_id === id),
        cobrancas,
        mes,
        rec,
      }),
      total: quitacaoDoCartao({
        linhas: linhasEmAberto.filter((l) => l.account_id === id),
        cobrancas,
        mesAberto: mesAberto.get(id)!,
        situacoes: situacoes.get(id) ?? new Map(),
        rec,
      }),
    };
  });

  porCartao.sort((a, b) => b.total.total - a.total.total);
  const somam = contasQueSomam(porCartao);

  return {
    mes,
    hoje,
    cartoes: porCartao,
    mensal: somarComposicoes(somam.map((c) => c.mensal)),
    total: somarComposicoes(somam.map((c) => c.total)),
    fora_dos_totais: porCartao.length - somam.length,
  };
}
