// ---------------------------------------------------------------------------
// OS WIDGETS DO PAINEL QUE VIERAM DO MINHAS FINANCAS (06/11/2026)
// ---------------------------------------------------------------------------
// "Gosto muito do layout deste aplicativo, use como inspiracao pra melhorar o
// nosso." O Resumo do Minhas Financas tem uma rosca de despesas por categoria
// e a lista das ultimas despesas. Os dois numeros ja existem no app:
//
//   rosca           -> /api/reports/categories?de=&ate= (a mesma rota da tela
//                      de Relatorios e do painel do grupo);
//   ultimas despesas -> /api/reports/lancamentos com referencia "efetivacao" e
//                      situacao "efetivadas".
//
// Aqui fica so o RECORTE para a tela -- quantas fatias, o que vira "Outras",
// quais cinco linhas --, e nenhuma conta nova de dinheiro: a fatia e o `expense`
// que a rota ja somou, e "Outras" e a soma, em centavos, das fatias que sobram.
// ---------------------------------------------------------------------------

/** Uma categoria como `/api/reports/categories` devolve. */
export interface CategoriaDoRelatorio {
  category_id: string;
  category?: { name?: string | null; color_hex?: string | null } | null;
  expense: number;
}

export interface FatiaDaRosca {
  id: string;
  nome: string;
  valor: number;
  cor: string;
  /** Fracao do total desenhado, de 0 a 1. */
  parte: number;
}

/**
 * As cores de quem nao tem `color_hex`, na ordem: a MESMA paleta da pizza da
 * tela de Relatorios, para a mesma categoria nao trocar de cor entre as duas.
 * Hex e nao `hsl(var(--...))`: o recharts escreve a cor no ATRIBUTO `fill` do
 * SVG, e atributo de apresentacao nao resolve variavel CSS -- a fatia sairia
 * preta (medido no Chromium).
 */
export const CORES_DA_ROSCA = [
  "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
];

/** A cor da fatia "Outras": neutra, para nao se passar por uma categoria. */
export const COR_DE_OUTRAS = "#94a3b8";

export const ID_DE_OUTRAS = "outras";

function centavos(valor: number): number {
  return Number.isFinite(valor) ? Math.round(valor * 100) : 0;
}

/**
 * As fatias da rosca: as `maximo` maiores despesas positivas e, se sobrar
 * alguma, uma fatia "Outras" com a soma delas.
 *
 * A categoria so com estorno (despesa negativa, fase 6) fica fora, como na
 * pizza da tela de Relatorios: uma fatia negativa nao se desenha.
 */
export function fatiasDaRosca(
  categorias: readonly CategoriaDoRelatorio[],
  maximo = 5
): { fatias: FatiaDaRosca[]; total: number } {
  const positivas = categorias
    .filter((c) => centavos(c.expense) > 0)
    .sort((a, b) => centavos(b.expense) - centavos(a.expense));
  const totalEmCentavos = positivas.reduce((s, c) => s + centavos(c.expense), 0);
  if (totalEmCentavos === 0) return { fatias: [], total: 0 };

  const limite = Math.max(1, Math.floor(maximo));
  // "Outras" so quando sobra MAIS DE UMA: com uma so, a fatia dela tem nome.
  const cabem = positivas.length > limite ? limite - 1 : positivas.length;
  const fatias: FatiaDaRosca[] = positivas.slice(0, cabem).map((c, i) => ({
    id: c.category_id,
    nome: c.category?.name?.trim() || "Sem categoria",
    valor: centavos(c.expense) / 100,
    cor: c.category?.color_hex || CORES_DA_ROSCA[i % CORES_DA_ROSCA.length],
    parte: centavos(c.expense) / totalEmCentavos,
  }));

  const resto = positivas.slice(cabem);
  if (resto.length > 0) {
    const soma = resto.reduce((s, c) => s + centavos(c.expense), 0);
    fatias.push({
      id: ID_DE_OUTRAS,
      nome: `Outras (${resto.length})`,
      valor: soma / 100,
      cor: COR_DE_OUTRAS,
      parte: soma / totalEmCentavos,
    });
  }

  return { fatias, total: totalEmCentavos / 100 };
}

/** Uma linha como `/api/reports/lancamentos` devolve. */
export interface LancamentoDoRelatorio {
  id: string;
  descricao: string;
  tipo: "income" | "expense";
  valor: number;
  data: string;
  conta_id: string | null;
  soma: boolean;
}

/**
 * As `n` despesas mais recentes, da mais nova para a mais velha.
 *
 * A rota ordena por data crescente; aqui so se inverte e corta. Empate de data
 * fica na ordem inversa da rota, que e a da descricao -- estavel, para a lista
 * nao trocar de ordem a cada recarga.
 */
export function ultimasDespesas<T extends LancamentoDoRelatorio>(
  linhas: readonly T[],
  n = 5
): T[] {
  return linhas
    .filter((l) => l.tipo === "expense")
    .map((l, i) => ({ l, i }))
    .sort((a, b) => (a.l.data === b.l.data ? b.i - a.i : a.l.data < b.l.data ? 1 : -1))
    .slice(0, Math.max(0, Math.floor(n)))
    .map(({ l }) => l);
}
