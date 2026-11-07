// =============================================================================
// O CUSTO DE VIDA -- 12 meses para tras, 12 para a frente, e a reserva
// =============================================================================
// "Quanto custa a minha vida por mes, e quanto eu preciso guardar para aguentar
// 12 meses sem renda?" Mora na tela de Investimentos, ao lado da carteira, e
// responde com tres numeros: o custo realizado de cada um dos ultimos 12 meses
// FECHADOS, a previsao de cada um dos proximos 12 (o mes corrente incluso), e a
// reserva de emergencia sugerida = a soma da previsao.
//
// O CRITERIO DO REALIZADO NAO E O DO «RESULTADO DO MES», DE PROPOSITO
// ------------------------------------------------------------------
// O Resultado do mes (lib/services/resultado-do-mes.ts) responde "quanto saiu
// do meu caixa": o cartao entra pela FATURA paga, e a despesa de grupo que EU
// paguei entra INTEIRA (o reembolso chega depois, como receita). Para o custo de
// vida as duas escolhas distorcem:
//
//   * pela fatura, o mes do custo e o do VENCIMENTO, e uma compra parcelada ou
//     um mes com duas faturas desloca o grafico;
//   * a despesa de grupo inteira poe no MEU custo de vida a parte dos outros
//     (o aluguel de R$ 2.000 da Casa contaria R$ 2.000 para quem paga, quando o
//     custo dele e a parte dele).
//
// Por isso aqui o criterio e o da COMPETENCIA, so com a minha parte:
//
//   * despesa minha sem grupo, pelo valor dela, na data dela -- inclusive a
//     compra no cartao, no dia da compra. A fatura paga NAO entra (o pagamento
//     da fatura e transferencia, e a compra ja contou): o cartao conta uma vez;
//   * transferencia e receita nao entram;
//   * despesa de grupo entra pela MINHA PARTE (`group_share_entries`), tenha eu
//     pago ou nao;
//   * a linha marcada "fora dos totais" nao entra.
//
// Quem le o banco e a rota (app/api/investments/custo-de-vida/route.ts). Este
// arquivo e puro -- sem I/O -- para a suite
// (scripts/test-custo-de-vida.mjs) rodar sem banco.
//
// A PREVISAO: CONTAS FIXAS + MEDIA DO VARIAVEL
// --------------------------------------------
//   * o FIXO de cada mes futuro e a soma das ocorrencias das contas fixas
//     (regras recorrentes de despesa) que caem NAQUELE mes, pela minha parte.
//     Ocorrencia, e nao `monthlyCost`: a regra com data de fim ou numero de
//     parcelas para de contar quando acaba, a anual pesa no mes em que vence, e a
//     que ainda nao comecou so entra a partir do inicio;
//   * o VARIAVEL e a media mensal do que, no historico, NAO foi conta fixa. Uma
//     despesa do historico e "fixa" quando foi a baixa de uma conta prevista
//     (`scheduled_transactions.transaction_id`) ou quando a descricao normalizada
//     e a de uma conta fixa cadastrada. Tirar o fixo do historico antes da media
//     e o que impede o aluguel de entrar duas vezes na previsao: uma pela regra,
//     outra embutido na media.
//
// A media do variavel e sobre os meses COM gasto: quem usa o app ha tres meses
// teria a media dividida por doze e veria um terco do que gasta.
// =============================================================================

import { occurrencesBetween, type RecurrenceFrequency } from "@/lib/recurrence";
import { normalizeMerchant } from "@/lib/recurrence-detector";

/** Quantos meses o grafico mostra para cada lado. */
export const MESES_DO_HISTORICO = 12;
export const MESES_DA_PREVISAO = 12;

/** Uma despesa do historico, ja pela minha parte. */
export interface DespesaDoCusto {
  /** AAAA-MM-DD */
  data: string;
  /** Positivo, ja a minha parte. */
  valor: number;
  descricao: string | null;
  /** A transacao de origem, para casar com a baixa de uma conta prevista. */
  transacaoId?: string | null;
}

/** Uma conta fixa, com o valor ja recortado pela minha parte. */
export interface ContaFixaDoCusto {
  descricao: string | null;
  /** Positivo, ja a minha parte. */
  valor: number;
  frequency: RecurrenceFrequency;
  interval_count?: number | null;
  due_day?: number | null;
  start_date: string;
  end_date?: string | null;
  max_occurrences?: number | null;
}

export interface MesDoHistorico {
  /** AAAA-MM */
  mes: string;
  total: number;
  fixo: number;
  variavel: number;
}

export interface MesDaPrevisao {
  /** AAAA-MM */
  mes: string;
  total: number;
  fixo: number;
  variavel: number;
}

export interface CustoDeVida {
  historico: MesDoHistorico[];
  previsao: MesDaPrevisao[];
  /** Media do total realizado, sobre os meses com gasto. */
  mediaRealizada: number;
  /** Media do variavel realizado, sobre os meses com gasto. A base da previsao. */
  mediaVariavel: number;
  /** Media mensal da previsao. */
  mediaPrevista: number;
  /** A soma dos 12 meses previstos. */
  reservaSugerida: number;
  /** Quantos meses do historico tem gasto: a media vale mais com 12 do que com 2. */
  mesesComGasto: number;
}

const arredondar = (n: number) => Math.round(n * 100) / 100;

/** AAAA-MM somado de `n` meses (n pode ser negativo). */
export function somarMeses(mes: string, n: number): string {
  const [ano, m] = mes.split("-").map(Number);
  const indice = ano * 12 + (m - 1) + n;
  const novoAno = Math.floor(indice / 12);
  const novoMes = (indice % 12) + 1;
  return `${novoAno}-${String(novoMes).padStart(2, "0")}`;
}

/** Ultimo dia do mes AAAA-MM, como AAAA-MM-DD. */
export function fimDoMes(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  const dia = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return `${mes}-${String(dia).padStart(2, "0")}`;
}

/**
 * Os `n` meses FECHADOS antes do mes de `hoje`, do mais antigo ao mais recente.
 * O mes corrente fica de fora: ele ainda nao acabou, e um mes pela metade no
 * historico puxaria a media para baixo.
 */
export function mesesDoHistorico(hoje: string, n = MESES_DO_HISTORICO): string[] {
  const atual = hoje.slice(0, 7);
  return Array.from({ length: n }, (_, i) => somarMeses(atual, i - n));
}

/** Os `n` meses a partir do mes de `hoje`, inclusive. */
export function mesesDaPrevisao(hoje: string, n = MESES_DA_PREVISAO): string[] {
  const atual = hoje.slice(0, 7);
  return Array.from({ length: n }, (_, i) => somarMeses(atual, i));
}

/** A chave que casa a despesa do historico com a conta fixa. */
export function chaveDaDescricao(descricao: string | null | undefined): string {
  return normalizeMerchant(descricao ?? "");
}

/**
 * A despesa e conta fixa? Foi a baixa de uma prevista, ou tem a descricao de
 * uma conta fixa cadastrada.
 */
export function ehDespesaFixa(
  despesa: DespesaDoCusto,
  idsDeBaixa: ReadonlySet<string>,
  chavesFixas: ReadonlySet<string>
): boolean {
  if (despesa.transacaoId && idsDeBaixa.has(despesa.transacaoId)) return true;
  const chave = chaveDaDescricao(despesa.descricao);
  return chave !== "" && chavesFixas.has(chave);
}

/** Quanto as contas fixas somam em cada mes pedido, pelas ocorrencias. */
export function fixoPorMes(
  contas: readonly ContaFixaDoCusto[],
  meses: readonly string[]
): Map<string, number> {
  const saida = new Map<string, number>(meses.map((m) => [m, 0]));
  if (meses.length === 0) return saida;

  const de = `${meses[0]}-01`;
  const ate = fimDoMes(meses[meses.length - 1]);

  for (const conta of contas) {
    const valor = Number(conta.valor) || 0;
    if (valor <= 0) continue;

    let datas: string[];
    try {
      datas = occurrencesBetween(
        {
          frequency: conta.frequency,
          interval_count: conta.interval_count ?? 1,
          due_day: conta.due_day ?? null,
          start_date: conta.start_date,
          end_date: conta.end_date ?? null,
          max_occurrences: conta.max_occurrences ?? null,
        },
        de,
        ate
      );
    } catch {
      // Frequencia desconhecida ou data invalida: a conta nao entra, em vez de
      // derrubar o grafico inteiro.
      continue;
    }

    for (const data of datas) {
      const mes = data.slice(0, 7);
      if (saida.has(mes)) saida.set(mes, (saida.get(mes) ?? 0) + valor);
    }
  }

  saida.forEach((total, mes) => saida.set(mes, arredondar(total)));
  return saida;
}

/** O historico mes a mes, separado em fixo e variavel. */
export function historicoPorMes(
  despesas: readonly DespesaDoCusto[],
  meses: readonly string[],
  idsDeBaixa: ReadonlySet<string>,
  chavesFixas: ReadonlySet<string>
): MesDoHistorico[] {
  const porMes = new Map<string, { fixo: number; variavel: number }>(
    meses.map((m) => [m, { fixo: 0, variavel: 0 }])
  );

  for (const despesa of despesas) {
    const balde = porMes.get(String(despesa.data).slice(0, 7));
    if (!balde) continue;
    const valor = Math.abs(Number(despesa.valor) || 0);
    if (ehDespesaFixa(despesa, idsDeBaixa, chavesFixas)) balde.fixo += valor;
    else balde.variavel += valor;
  }

  return meses.map((mes) => {
    const { fixo, variavel } = porMes.get(mes)!;
    return {
      mes,
      fixo: arredondar(fixo),
      variavel: arredondar(variavel),
      total: arredondar(fixo + variavel),
    };
  });
}

export interface EntradaDoCustoDeVida {
  despesas: readonly DespesaDoCusto[];
  contasFixas: readonly ContaFixaDoCusto[];
  /** `transaction_id` das contas previstas que ja tiveram baixa. */
  idsDeBaixa?: Iterable<string>;
  /**
   * Descricoes de contas fixas que NAO entram na previsao (encerradas,
   * desativadas), mas cujo pagamento no historico continua sendo fixo. Sem
   * elas, o financiamento que acabou em agosto entraria como gasto VARIAVEL
   * dos meses em que foi pago e inflaria a media que vai para a previsao.
   */
  descricoesFixasEncerradas?: Iterable<string | null>;
  /** AAAA-MM-DD, no fuso de Sao Paulo. */
  hoje: string;
  mesesHistorico?: number;
  mesesPrevisao?: number;
}

export function calcularCustoDeVida(entrada: EntradaDoCustoDeVida): CustoDeVida {
  const idsDeBaixa = new Set(Array.from(entrada.idsDeBaixa ?? []));
  const chavesFixas = new Set(
    [
      ...entrada.contasFixas.map((c) => c.descricao),
      ...Array.from(entrada.descricoesFixasEncerradas ?? []),
    ]
      .map((d) => chaveDaDescricao(d))
      .filter(Boolean)
  );

  const meses = mesesDoHistorico(entrada.hoje, entrada.mesesHistorico);
  const historico = historicoPorMes(entrada.despesas, meses, idsDeBaixa, chavesFixas);

  const comGasto = historico.filter((m) => m.total > 0);
  const mesesComGasto = comGasto.length;
  const media = (f: (m: MesDoHistorico) => number) =>
    mesesComGasto ? arredondar(comGasto.reduce((s, m) => s + f(m), 0) / mesesComGasto) : 0;

  const mediaRealizada = media((m) => m.total);
  const mediaVariavel = media((m) => m.variavel);

  const futuros = mesesDaPrevisao(entrada.hoje, entrada.mesesPrevisao);
  const fixos = fixoPorMes(entrada.contasFixas, futuros);
  const previsao = futuros.map((mes) => {
    const fixo = fixos.get(mes) ?? 0;
    return {
      mes,
      fixo,
      variavel: mediaVariavel,
      total: arredondar(fixo + mediaVariavel),
    };
  });

  const reservaSugerida = arredondar(previsao.reduce((s, m) => s + m.total, 0));

  return {
    historico,
    previsao,
    mediaRealizada,
    mediaVariavel,
    mediaPrevista: previsao.length ? arredondar(reservaSugerida / previsao.length) : 0,
    reservaSugerida,
    mesesComGasto,
  };
}
