/**
 * A frase da direita de cada conta na lista do grupo: "você emprestou R$ X",
 * "você deve R$ Y" ou "não participa".
 *
 * E a pergunta que quem abre a tela do grupo faz para cada linha -- "e eu com
 * isso?" -- e antes ela so se respondia abrindo a divisao da despesa e achando
 * o proprio nome no meio das partes.
 *
 * A conta e a mesma do saldo do grupo, so que de UMA despesa:
 *   - paguei:     emprestei o total menos a minha parte;
 *   - nao paguei: devo a minha parte.
 *
 * Os valores estao na moeda da DESPESA (as partes sao uma fracao dela, ver a
 * 026). Quem formata e a tela.
 *
 * `null` em `userId`, `payerId` ou no id da parte e o membro sem conta (077):
 * ele nunca e "eu", e dois `null` nao sao a mesma pessoa. Por isso a
 * comparacao exige um id de verdade dos dois lados.
 */

export type MinhaPosicaoNaConta =
  | { tipo: "emprestou"; valor: number }
  | { tipo: "deve"; valor: number }
  | { tipo: "fora"; valor: 0 };

export interface ContaParaPosicao {
  amount: number;
  payer?: { id: string | null } | null;
  splits: { amount: number; member?: { id: string | null } | null }[];
}

const CENTAVO = 0.005;

function mesmaPessoa(a: string | null | undefined, b: string | null | undefined) {
  return Boolean(a) && Boolean(b) && a === b;
}

export function minhaPosicaoNaConta(
  conta: ContaParaPosicao,
  userId: string | null | undefined
): MinhaPosicaoNaConta {
  const minhaParte = conta.splits
    .filter((s) => mesmaPessoa(s.member?.id, userId))
    .reduce((soma, s) => soma + (Number(s.amount) || 0), 0);

  if (mesmaPessoa(conta.payer?.id, userId)) {
    const emprestado = Math.round(((Number(conta.amount) || 0) - minhaParte) * 100) / 100;
    return emprestado > CENTAVO
      ? { tipo: "emprestou", valor: emprestado }
      : { tipo: "fora", valor: 0 };
  }

  const devido = Math.round(minhaParte * 100) / 100;
  return devido > CENTAVO ? { tipo: "deve", valor: devido } : { tipo: "fora", valor: 0 };
}

/**
 * O mes vizinho de "AAAA-MM", para as setas do seletor da lista.
 *
 * Aritmetica de string, e nao `new Date(...)`: o mesmo motivo de
 * lib/periodo-do-grupo.ts -- `Date` em fuso negativo poe o dia 1 no mes
 * anterior.
 */
export function mesVizinho(mes: string, delta: number): string {
  const [ano, m] = mes.split("-").map(Number);
  if (!ano || !m) return mes;
  const indice = ano * 12 + (m - 1) + delta;
  const novoAno = Math.floor(indice / 12);
  const novoMes = (indice % 12) + 1;
  return `${novoAno}-${String(novoMes).padStart(2, "0")}`;
}
