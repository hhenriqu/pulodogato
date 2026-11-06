// ---------------------------------------------------------------------------
// O RELATORIO DE LANCAMENTOS, COM DATA DE REFERENCIA (comparacao com o
// Minhas Financas)
// ---------------------------------------------------------------------------
// O pedido (Helio, 06/11/2026): o relatorio do Minhas Financas filtra por um
// periodo e deixa escolher a DATA DE REFERENCIA -- Lancamento, Vencimento ou
// Efetivacao -- e a SITUACAO -- Todas, Efetivadas ou Pendentes --, alem de
// categoria, tag e conta. Os relatorios do Pulo do Gato so recortavam pela data
// da transacao.
//
// AS TRES DATAS, AQUI
// -------------------
//   efetivacao -> `transaction_date` (o dia em que o dinheiro mexeu);
//   vencimento -> `expected_date` (o dia previsto, gravado na baixa desde a
//                 027) e, sem ele, `transaction_date`;
//   lancamento -> `launch_date` (o dia em que foi anotado, 027) e, sem ele,
//                 `transaction_date`.
// A previsao PENDENTE (`scheduled_transactions`) tem vencimento (`due_date`) e
// lancamento (`created_at`), e nao tem efetivacao: com a referencia
// "efetivacao" ela fica de fora, porque ainda nao aconteceu.
//
// O QUE FICA FORA DAS SOMAS: a transferencia (nao e receita nem despesa,
// RN003.3) nem entra; a linha com `include_in_total = false` aparece na lista
// e nao soma, como em todo relatorio desde a 060.
// ---------------------------------------------------------------------------

export type DataDeReferencia = "lancamento" | "vencimento" | "efetivacao";
export type Situacao = "todas" | "efetivadas" | "pendentes";

export const ROTULO_DA_REFERENCIA: Record<DataDeReferencia, string> = {
  lancamento: "Lançamento",
  vencimento: "Vencimento",
  efetivacao: "Efetivação",
};

export const ROTULO_DA_SITUACAO: Record<Situacao, string> = {
  todas: "Todas",
  efetivadas: "Efetivadas",
  pendentes: "Pendentes",
};

export function dataDeReferencia(valor: string | null | undefined): DataDeReferencia {
  return valor === "lancamento" || valor === "efetivacao" ? valor : "vencimento";
}

export function situacao(valor: string | null | undefined): Situacao {
  return valor === "efetivadas" || valor === "pendentes" ? valor : "todas";
}

/** Uma linha efetivada, como a rota le de `financial_transactions`. */
export interface EfetivadaCrua {
  id: string;
  description: string | null;
  amount: number | string;
  transaction_type: string | null;
  transaction_date: string;
  expected_date?: string | null;
  launch_date?: string | null;
  category_id?: string | null;
  account_id?: string | null;
  include_in_total?: boolean | null;
  tags?: string[] | null;
}

/** Uma previsao pendente, como a rota le de `scheduled_transactions_effective`. */
export interface PendenteCrua {
  id: string;
  description: string | null;
  amount: number | string;
  direction: string | null;
  due_date: string;
  created_at?: string | null;
  category_id?: string | null;
  account_id?: string | null;
}

export interface LinhaDoRelatorio {
  id: string;
  origem: "efetivada" | "pendente";
  descricao: string;
  tipo: "income" | "expense";
  /** Sempre positivo. */
  valor: number;
  /** A data pela referencia escolhida. */
  data: string;
  categoria_id: string | null;
  conta_id: string | null;
  soma: boolean;
  tags: string[];
}

export interface RelatorioDeLancamentos {
  linhas: LinhaDoRelatorio[];
  receitas: number;
  despesas: number;
  saldo: number;
}

function centavos(valor: number | string): number {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : 0;
}

/** A data de uma linha efetivada pela referencia. */
export function dataDaEfetivada(
  linha: Pick<EfetivadaCrua, "transaction_date" | "expected_date" | "launch_date">,
  referencia: DataDeReferencia
): string {
  if (referencia === "vencimento") return linha.expected_date || linha.transaction_date;
  if (referencia === "lancamento") return linha.launch_date || linha.transaction_date;
  return linha.transaction_date;
}

/** A data de uma pendente pela referencia; `null` em "efetivacao". */
export function dataDaPendente(
  linha: Pick<PendenteCrua, "due_date" | "created_at">,
  referencia: DataDeReferencia
): string | null {
  if (referencia === "efetivacao") return null;
  if (referencia === "lancamento") {
    return linha.created_at ? linha.created_at.slice(0, 10) : linha.due_date;
  }
  return linha.due_date;
}

export function montarRelatorio(opts: {
  efetivadas: EfetivadaCrua[];
  pendentes: PendenteCrua[];
  de: string;
  ate: string;
  referencia: DataDeReferencia;
  situacao: Situacao;
  /** Uma tag so, ja normalizada; vazio = todas. */
  tag?: string | null;
  categoriaId?: string | null;
  contaId?: string | null;
  tipo?: "income" | "expense" | null;
}): RelatorioDeLancamentos {
  const { de, ate, referencia } = opts;
  const linhas: LinhaDoRelatorio[] = [];
  const noPeriodo = (data: string | null) => data !== null && data >= de && data <= ate;

  if (opts.situacao !== "pendentes") {
    for (const l of opts.efetivadas) {
      if (l.transaction_type !== "income" && l.transaction_type !== "expense") continue;
      const data = dataDaEfetivada(l, referencia);
      if (!noPeriodo(data)) continue;
      linhas.push({
        id: l.id,
        origem: "efetivada",
        descricao: l.description ?? "",
        tipo: l.transaction_type,
        valor: centavos(l.amount) / 100,
        data,
        categoria_id: l.category_id ?? null,
        conta_id: l.account_id ?? null,
        soma: l.include_in_total !== false,
        tags: Array.isArray(l.tags) ? l.tags : [],
      });
    }
  }

  if (opts.situacao !== "efetivadas") {
    for (const p of opts.pendentes) {
      // Transferencia prevista nao e receita nem despesa.
      if (p.direction === "transfer") continue;
      const data = dataDaPendente(p, referencia);
      if (!noPeriodo(data)) continue;
      linhas.push({
        id: p.id,
        origem: "pendente",
        descricao: p.description ?? "",
        tipo: p.direction === "income" ? "income" : "expense",
        valor: centavos(p.amount) / 100,
        data: data!,
        categoria_id: p.category_id ?? null,
        conta_id: p.account_id ?? null,
        soma: true,
        tags: [],
      });
    }
  }

  const filtradas = linhas
    .filter((l) => !opts.tag || l.tags.includes(opts.tag))
    .filter((l) => !opts.categoriaId || l.categoria_id === opts.categoriaId)
    .filter((l) => !opts.contaId || l.conta_id === opts.contaId)
    .filter((l) => !opts.tipo || l.tipo === opts.tipo)
    .sort((a, b) => (a.data === b.data ? a.descricao.localeCompare(b.descricao) : a.data < b.data ? -1 : 1));

  let receitas = 0;
  let despesas = 0;
  for (const l of filtradas) {
    if (!l.soma) continue;
    if (l.tipo === "income") receitas += Math.round(l.valor * 100);
    else despesas += Math.round(l.valor * 100);
  }

  return {
    linhas: filtradas,
    receitas: receitas / 100,
    despesas: despesas / 100,
    saldo: (receitas - despesas) / 100 || 0,
  };
}
