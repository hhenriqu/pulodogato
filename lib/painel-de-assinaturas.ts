// =====================================================
// PAINEL DE ASSINATURAS (docs/ASSINATURAS.md)
// =====================================================
// O pedido (Helio, 22/11/2026): mostrar com clareza quais sao as assinaturas,
// quanto elas pesam no orcamento e o detalhe de cada uma.
//
// A tela de Assinaturas lia duas fontes e as mostrava em dois blocos que nao
// conversavam: as contas fixas marcadas (migration 084) e as cobrancas que o
// detector achou no extrato (HMO-145). Este modulo junta as duas numa lista
// so, separa o que NAO soma (e diz por que) e calcula o peso do total na renda
// mensal fixa.
//
// A REGRA DO QUE SOMA E A MESMA DE GET /api/recurrences: conta fixa marcada e
// ativa soma; detectada DETECTED ou CONFIRMED soma, menos quando repete uma
// conta fixa marcada (a chave do lojista bate). O total daqui bate com o
// `monthlyTotal` da rota -- dois numeros diferentes na mesma tela seriam o
// defeito.
//
// SEM IMPORTS DE RUNTIME: o teste compila este arquivo sozinho e o roda com
// `node --test`. O `import type` some na compilacao.
// =====================================================

import type { AssinaturaDaContaFixa } from "./assinaturas-das-contas-fixas";

/** A linha de `detected_recurrences` como a rota devolve. */
export interface RecorrenciaDetectada {
  id: string;
  merchant_key: string;
  display_name: string;
  avg_amount: number | string;
  monthly_cost: number | string;
  frequency: "WEEKLY" | "MONTHLY" | "YEARLY";
  occurrences: number;
  last_charge_date: string;
  next_expected_date: string;
  status: "DETECTED" | "CONFIRMED" | "IGNORED" | "CANCELLED";
}

export type OrigemDaAssinatura = "conta-fixa" | "extrato";

export interface ItemDoPainel {
  /** Unica na lista: a mesma id pode existir nas duas tabelas. */
  chave: string;
  origem: OrigemDaAssinatura;
  nome: string;
  /** O valor de cada cobranca. */
  valorDaCobranca: number;
  custoMensal: number;
  custoAnual: number;
  /** Fatia do total mensal, em porcentagem com uma casa (0 a 100). */
  participacao: number;
  /** Detectada no extrato e ainda nao confirmada pela pessoa. */
  paraRevisar: boolean;
  diaDoVencimento: number | null;
  proximaCobranca: string | null;
  ultimaCobranca: string | null;
  /** O original, para a tela tirar rotulo e agir (desmarcar, confirmar...). */
  fixa?: AssinaturaDaContaFixa;
  detectada?: RecorrenciaDetectada;
}

export type MotivoForaDaConta = "ignorada" | "cancelada" | "ja-e-conta-fixa";

export interface ForaDaConta {
  chave: string;
  nome: string;
  custoMensal: number;
  motivo: MotivoForaDaConta;
  detectada: RecorrenciaDetectada;
}

/** Quanto o total pesa na renda: referencia de bolso, explicada na tela. */
export type FaixaDoPeso = "leve" | "atencao" | "pesado";

export interface PainelDeAssinaturas {
  itens: ItemDoPainel[];
  foraDaConta: ForaDaConta[];
  quantidade: number;
  paraRevisar: number;
  totalMensal: number;
  totalAnual: number;
  /** `null` = nao deu para ler; `0` = nenhuma receita fixa cadastrada. */
  rendaMensal: number | null;
  /** Porcentagem com uma casa. `null` quando nao ha renda para dividir. */
  percentualDaRenda: number | null;
  faixa: FaixaDoPeso | null;
}

export interface EntradaDoPainel {
  fixas: readonly AssinaturaDaContaFixa[];
  detectadas: readonly RecorrenciaDetectada[];
  /** `normalizeMerchant` da descricao de cada conta fixa (vem da rota). */
  chavesDasFixas: readonly string[];
  rendaMensal: number | null;
}

/** Ate 5% da renda e leve; ate 10%, atencao; acima disso, pesado. */
export const LIMITE_LEVE = 5;
export const LIMITE_ATENCAO = 10;

function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}

function umaCasa(valor: number): number {
  return Math.round(valor * 10) / 10;
}

function numero(valor: number | string): number {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

export function faixaDoPeso(percentual: number): FaixaDoPeso {
  if (percentual <= LIMITE_LEVE) return "leve";
  if (percentual <= LIMITE_ATENCAO) return "atencao";
  return "pesado";
}

export function montarPainelDeAssinaturas(
  entrada: EntradaDoPainel
): PainelDeAssinaturas {
  const chavesDasFixas = new Set(entrada.chavesDasFixas);

  type SemFatia = Omit<ItemDoPainel, "participacao">;
  const itens: SemFatia[] = [];
  const foraDaConta: ForaDaConta[] = [];

  for (const f of entrada.fixas) {
    itens.push({
      chave: `fixa:${f.id}`,
      origem: "conta-fixa",
      nome: f.descricao,
      valorDaCobranca: f.valor,
      custoMensal: f.custoMensal,
      custoAnual: arredondar(f.custoMensal * 12),
      paraRevisar: false,
      diaDoVencimento: f.diaDoVencimento,
      proximaCobranca: null,
      ultimaCobranca: null,
      fixa: f,
    });
  }

  for (const d of entrada.detectadas) {
    const custoMensal = arredondar(numero(d.monthly_cost));
    const motivo: MotivoForaDaConta | null =
      d.status === "IGNORED"
        ? "ignorada"
        : d.status === "CANCELLED"
          ? "cancelada"
          : chavesDasFixas.has(d.merchant_key)
            ? "ja-e-conta-fixa"
            : null;

    if (motivo) {
      foraDaConta.push({
        chave: `extrato:${d.id}`,
        nome: d.display_name,
        custoMensal,
        motivo,
        detectada: d,
      });
      continue;
    }

    itens.push({
      chave: `extrato:${d.id}`,
      origem: "extrato",
      nome: d.display_name,
      valorDaCobranca: arredondar(numero(d.avg_amount)),
      custoMensal,
      custoAnual: arredondar(custoMensal * 12),
      paraRevisar: d.status === "DETECTED",
      diaDoVencimento: null,
      proximaCobranca: d.next_expected_date || null,
      ultimaCobranca: d.last_charge_date || null,
      detectada: d,
    });
  }

  const totalMensal = arredondar(
    itens.reduce((soma, i) => soma + i.custoMensal, 0)
  );

  const comFatia: ItemDoPainel[] = itens
    .map((i) => ({
      ...i,
      participacao:
        totalMensal > 0 ? umaCasa((i.custoMensal / totalMensal) * 100) : 0,
    }))
    // Da mais cara para a mais barata: a tela existe para decidir o que
    // cancelar. Empate desempata pelo nome, para a ordem nao pular entre
    // leituras.
    .sort(
      (a, b) =>
        b.custoMensal - a.custoMensal || a.nome.localeCompare(b.nome, "pt-BR")
    );

  foraDaConta.sort(
    (a, b) =>
      b.custoMensal - a.custoMensal || a.nome.localeCompare(b.nome, "pt-BR")
  );

  const renda = entrada.rendaMensal;
  const percentualDaRenda =
    renda !== null && renda > 0 ? umaCasa((totalMensal / renda) * 100) : null;

  return {
    itens: comFatia,
    foraDaConta,
    quantidade: comFatia.length,
    paraRevisar: comFatia.filter((i) => i.paraRevisar).length,
    totalMensal,
    totalAnual: arredondar(totalMensal * 12),
    rendaMensal: renda,
    percentualDaRenda,
    faixa: percentualDaRenda === null ? null : faixaDoPeso(percentualDaRenda),
  };
}
