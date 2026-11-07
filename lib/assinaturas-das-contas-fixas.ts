// =====================================================
// CONTAS FIXAS MARCADAS COMO ASSINATURA (migration 084)
// =====================================================
// O pedido (Helio, 07/11/2026): marcar uma conta fixa do cartao como assinatura
// e ve-la na tela de Assinaturas, com o total gasto.
//
// A tela de Assinaturas ja existia (HMO-145) e so conhecia o que o DETECTOR
// encontra no extrato (`detected_recurrences`). Este modulo traduz a regra que o
// usuario cadastrou (`recurring_rules`) para a mesma unidade daquela tela: o
// CUSTO MENSAL, que e o que deixa somar a Netflix mensal com o seguro anual.
//
// SEM IMPORTS, pelo mesmo motivo de `lib/recurrence-detector.ts`: o teste
// compila este arquivo sozinho e o roda com `node --test`.
// =====================================================

/** O ENUM `recurrence_frequency` da migration 005. */
export type FrequenciaDaRegra =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "bimonthly"
  | "quarterly"
  | "semiannual"
  | "annual";

/** Quantas vezes por ANO cada frequencia cobra, com `interval_count = 1`. */
const COBRANCAS_POR_ANO: Record<FrequenciaDaRegra, number> = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  bimonthly: 6,
  quarterly: 4,
  semiannual: 2,
  annual: 1,
};

export const ROTULO_DA_FREQUENCIA_DA_REGRA: Record<FrequenciaDaRegra, string> = {
  weekly: "Semanal",
  biweekly: "Quinzenal",
  monthly: "Mensal",
  bimonthly: "Bimestral",
  quarterly: "Trimestral",
  semiannual: "Semestral",
  annual: "Anual",
};

/** A regra como ela sai do banco (`numeric` chega como string no supabase-js). */
export interface RegraDeAssinatura {
  id: string;
  description: string;
  amount: number | string;
  frequency: string;
  interval_count?: number | null;
  due_day?: number | null;
  account_id?: string | null;
  is_active?: boolean | null;
  transaction_type?: string | null;
}

export interface AssinaturaDaContaFixa {
  id: string;
  descricao: string;
  /** O valor de cada cobranca, positivo. */
  valor: number;
  frequencia: FrequenciaDaRegra;
  intervalo: number;
  diaDoVencimento: number | null;
  contaId: string | null;
  /** O custo equivalente por mes, para somar com as outras. */
  custoMensal: number;
}

function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}

function ehFrequencia(valor: string): valor is FrequenciaDaRegra {
  return valor in COBRANCAS_POR_ANO;
}

/**
 * Custo mensal equivalente de uma cobranca de `valor` a cada `intervalo`
 * periodos de `frequencia`. Frequencia desconhecida conta como mensal: e o
 * DEFAULT da coluna, e sumir com a assinatura do total seria pior.
 */
export function custoMensalDaRegra(
  frequencia: string,
  valor: number,
  intervalo: number = 1
): number {
  const porAno = ehFrequencia(frequencia) ? COBRANCAS_POR_ANO[frequencia] : 12;
  const passo = Number.isFinite(intervalo) && intervalo > 0 ? intervalo : 1;
  return arredondar((Math.abs(valor) * porAno) / passo / 12);
}

/**
 * As regras que entram na tela de Assinaturas, da mais cara para a mais barata
 * (a mesma ordem das detectadas: a tela existe para decidir o que cancelar).
 *
 * Fica de fora o que nao esta valendo: regra inativa (encerrada) e receita --
 * "assinatura" e o que se paga, e um salario marcado por engano nao pode
 * inflar o total.
 */
export function assinaturasDasContasFixas(
  regras: RegraDeAssinatura[]
): AssinaturaDaContaFixa[] {
  return regras
    .filter((r) => r.is_active !== false)
    .filter((r) => (r.transaction_type ?? "expense") === "expense")
    .map((r) => {
      const valor = Math.abs(Number(r.amount));
      const frequencia: FrequenciaDaRegra = ehFrequencia(r.frequency)
        ? r.frequency
        : "monthly";
      const intervalo = Number(r.interval_count ?? 1) || 1;
      return {
        id: r.id,
        descricao: r.description,
        valor,
        frequencia,
        intervalo,
        diaDoVencimento: r.due_day ?? null,
        contaId: r.account_id ?? null,
        custoMensal: custoMensalDaRegra(frequencia, valor, intervalo),
      };
    })
    .filter((a) => Number.isFinite(a.valor) && a.valor > 0)
    .sort((a, b) => b.custoMensal - a.custoMensal);
}

/** Soma do custo mensal das contas fixas marcadas. */
export function totalMensalDasContasFixas(
  assinaturas: AssinaturaDaContaFixa[]
): number {
  return arredondar(assinaturas.reduce((acc, a) => acc + a.custoMensal, 0));
}

/** "Mensal", "Anual", "A cada 2 meses"... */
export function rotuloDaFrequenciaDaRegra(
  frequencia: FrequenciaDaRegra,
  intervalo: number
): string {
  if (intervalo <= 1) return ROTULO_DA_FREQUENCIA_DA_REGRA[frequencia];
  if (frequencia === "monthly") return `A cada ${intervalo} meses`;
  if (frequencia === "weekly") return `A cada ${intervalo} semanas`;
  if (frequencia === "annual") return `A cada ${intervalo} anos`;
  return `${ROTULO_DA_FREQUENCIA_DA_REGRA[frequencia]} (x${intervalo})`;
}
