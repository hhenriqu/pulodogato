// =====================================================
// AS PARCELAS QUE A FATURA IMPORTADA AINDA NAO TROUXE
// =====================================================
// A fatura do C6 traz a compra parcelada como UMA linha: a parcela do mes
// ("PLACA SOLAR (3/10)"). Ate aqui o import gravava so essa linha, e as 7
// que faltam nao existiam em lugar nenhum do app: a fatura de dezembro em
// diante nao as mostrava, o saldo do cartao nao as contava, e o TOTAL para
// quitar os cartoes (docs/COMPOSICAO-DA-FATURA.md) saia com uma fracao da
// divida -- R$ 10 mil com uma placa solar de R$ 22 mil parcelada no cartao.
//
// Agora a parcela importada leva junto as que faltam, como
// POST /api/financial-installments ja faz com a compra parcelada lancada a mao:
// uma linha por mes de fatura, no dia 1, com o rotulo k/N. Quando a fatura do
// mes seguinte for importada, a parcela k+1 dela casa com a que ja estava
// gravada (`parcelaJaGravada`) em vez de virar um segundo lancamento.
//
// Sem I/O: quem le e grava e app/api/statements/entries/[id]/route.ts.
// Testes: npm run test:parcelas-da-fatura-importada
// =====================================================

/** " (3/10)" no fim da descricao, como o leitor do C6 e a compra parcelada gravam. */
const SUFIXO_DA_PARCELA = /\s*\(\s*\d+\s*\/\s*\d+\s*\)\s*$/;

/**
 * A descricao da compra sem o " (k/N)" e sem diferenca de caixa e espacos: o
 * que identifica a SERIE, e nao a parcela.
 */
export function descricaoDaSerie(descricao: string): string {
  return descricao
    .replace(SUFIXO_DA_PARCELA, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** 'AAAA-MM-01' + n meses (n pode ser negativo). `null` se a entrada nao e um mes. */
export function mesDaFaturaMais(mes: string, n: number): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(mes);
  if (!m) return null;
  const indice = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
  const ano = Math.floor(indice / 12);
  const mesDoAno = (indice % 12) + 1;
  return `${ano}-${String(mesDoAno).padStart(2, "0")}-01`;
}

/** A parcela que acabou de ser importada (ja com o que o usuario editou na fila). */
export interface ParcelaImportada {
  numero: number;
  total: number;
  /** 'AAAA-MM-01' da fatura em que ela cai. */
  mesDaFatura: string;
  /** Com sinal, como gravado (despesa negativa). */
  valor: number;
  descricao: string;
}

/** Um lancamento do cartao que pode ser parcela da mesma serie. */
export interface ParcelaGravada {
  id: string;
  numero: number | null;
  total: number | null;
  /** 'AAAA-MM-01' (ou 'AAAA-MM-DD'; so o mes conta). */
  mesDaFatura: string;
  valor: number;
  descricao: string;
  /** Ja e o lancamento de outra linha de extrato. */
  vinculada: boolean;
}

export interface ParcelaQueFalta {
  numero: number;
  total: number;
  mesDaFatura: string;
  /** Dia 1 do mes da fatura, como a compra parcelada grava as parcelas 2+. */
  dataDoLancamento: string;
  valor: number;
  descricao: string;
}

const centavos = (v: number) => Math.round(v * 100);

function mesmaSerie(a: ParcelaImportada, b: ParcelaGravada): boolean {
  return (
    b.total === a.total &&
    centavos(b.valor) === centavos(a.valor) &&
    descricaoDaSerie(b.descricao) === descricaoDaSerie(a.descricao)
  );
}

/** A parcela valida para ganhar irmas: 1 <= k < N, N >= 2, valor nao zero. */
export function temParcelasPelaFrente(p: {
  numero?: number | null;
  total?: number | null;
  valor: number;
}): boolean {
  const k = p.numero ?? 0;
  const n = p.total ?? 0;
  return (
    Number.isInteger(k) &&
    Number.isInteger(n) &&
    n >= 2 &&
    k >= 1 &&
    k < n &&
    centavos(p.valor) !== 0
  );
}

/**
 * A parcela k ja gravada por uma importacao anterior (a projecao da fatura
 * passada) -- a que a linha de agora deve VINCULAR, em vez de criar outra.
 * So conta a que ainda nao e de outra linha de extrato, na mesma fatura.
 */
export function parcelaJaGravada(
  importada: ParcelaImportada,
  gravadas: readonly ParcelaGravada[]
): ParcelaGravada | null {
  const mes = importada.mesDaFatura.slice(0, 7);
  return (
    gravadas.find(
      (g) =>
        !g.vinculada &&
        g.numero === importada.numero &&
        g.mesDaFatura.slice(0, 7) === mes &&
        mesmaSerie(importada, g)
    ) ?? null
  );
}

/**
 * As parcelas k+1..N que ainda nao existem no cartao. Uma que ja existe (da
 * importacao anterior, ou da compra lancada a mao) nao se repete: a serie
 * nunca fica com duas parcelas 5/10.
 */
export function parcelasQueFaltam(
  importada: ParcelaImportada,
  gravadas: readonly ParcelaGravada[]
): ParcelaQueFalta[] {
  if (!temParcelasPelaFrente(importada)) return [];
  const existentes = new Set(
    gravadas.filter((g) => mesmaSerie(importada, g)).map((g) => g.numero)
  );
  const base = importada.descricao.replace(SUFIXO_DA_PARCELA, "").trim();
  const faltam: ParcelaQueFalta[] = [];
  for (let j = importada.numero + 1; j <= importada.total; j++) {
    if (existentes.has(j)) continue;
    const mes = mesDaFaturaMais(importada.mesDaFatura, j - importada.numero);
    if (!mes) return [];
    faltam.push({
      numero: j,
      total: importada.total,
      mesDaFatura: mes,
      dataDoLancamento: mes,
      valor: importada.valor,
      descricao: `${base} (${j}/${importada.total})`,
    });
  }
  return faltam;
}
