/**
 * O ACERTO DAS CONTAS DO FECHAMENTO (RN019, fase 3 do modelo novo).
 *
 * O fechamento do grupo (067) gera, para cada membro, "Pagamento ao grupo" ou
 * "A receber do grupo". O acerto -- o Pix entre dois membros -- quita essas
 * contas nos dois lados (068). Este modulo responde a pergunta da tela: com o
 * que esta em aberto agora, QUEM PAGA QUEM, e quanto (RN019.5).
 *
 * Puro, sem I/O. A entrada sao as linhas de `contas_em_aberto_do_grupo` (068).
 *
 * POR QUE O PAR SAI DAS CONTAS, E NAO DOS SALDOS DO GRUPO
 * ------------------------------------------------------
 * A baixa do banco reparte o acerto entre a conta A PAGAR de quem manda e a
 * conta A RECEBER de quem recebe. Um par sugerido entre duas pessoas que nao
 * tem essas contas (a Leticia pagando a Lais, quando as duas devem ao grupo)
 * seria registrado, moveria dinheiro e nao quitaria nada -- o banco so leva a
 * sobra para o proximo fechamento. Entao o par so junta quem tem conta a
 * pagar com quem tem conta a receber, e nunca mais do que a menor das duas.
 *
 * Ninguem aparece dos dois lados: a 068 compensa a conta a pagar com a conta a
 * receber do mesmo membro assim que as duas existem. Se aparecer (um banco sem
 * a compensacao), o membro e tratado pelo LIQUIDO, para a tela nunca sugerir
 * alguem pagando a si mesmo.
 */

import { toCents, toReais } from "@/lib/settlement";

/** Uma linha de `contas_em_aberto_do_grupo`. Numeric chega como string. */
export interface ContaEmAberto {
  closing_id: string;
  period_end: string;
  user_id: string;
  tipo: string;
  valor: number | string;
  quitado: number | string;
  aberto: number | string;
}

/** O que um membro ainda tem a pagar ou a receber do grupo, ja liquido. */
export interface EmAbertoDoMembro {
  user_id: string;
  /** Positivo: tem a receber. Negativo: tem a pagar. Nunca zero. */
  saldo: number;
}

/** Um Pix sugerido: `de` paga `para`. */
export interface ParDoAcerto {
  de_user_id: string;
  para_user_id: string;
  valor: number;
}

/**
 * O liquido em aberto de cada membro, em centavos exatos, de quem mais deve
 * para quem mais tem a receber. Membro empatado fica de fora.
 */
export function emAbertoPorMembro(contas: ContaEmAberto[]): EmAbertoDoMembro[] {
  const porMembro = new Map<string, number>();
  for (const c of contas) {
    const aberto = toCents(Math.abs(Number(c.aberto) || 0));
    if (aberto === 0) continue;
    const sinal = c.tipo === "income" ? 1 : c.tipo === "expense" ? -1 : 0;
    if (sinal === 0) continue;
    porMembro.set(c.user_id, (porMembro.get(c.user_id) ?? 0) + sinal * aberto);
  }

  return Array.from(porMembro, ([user_id, centavos]) => ({ user_id, centavos }))
    .filter((m) => m.centavos !== 0)
    .sort((a, b) => a.centavos - b.centavos || a.user_id.localeCompare(b.user_id))
    .map((m) => ({ user_id: m.user_id, saldo: toReais(m.centavos) }));
}

/**
 * Os Pix que zeram o que esta em aberto, guloso: o maior devedor paga o maior
 * credor, ate um dos dois zerar, e segue. Com N pessoas sao no maximo N - 1
 * Pix, e a soma do que sai e exatamente a soma do que entra.
 *
 * Se o que se deve e o que se tem a receber nao empatarem (nao deveria
 * acontecer: as contas de um fechamento somam zero e a baixa e simetrica), os
 * pares param no menor dos dois -- a sugestao nunca inventa um Pix que nao
 * quita conta.
 */
export function paresDoAcerto(contas: ContaEmAberto[]): ParDoAcerto[] {
  const membros = emAbertoPorMembro(contas);
  const devedores = membros
    .filter((m) => m.saldo < 0)
    .map((m) => ({ user_id: m.user_id, centavos: toCents(-m.saldo) }));
  const credores = membros
    .filter((m) => m.saldo > 0)
    .sort((a, b) => b.saldo - a.saldo || a.user_id.localeCompare(b.user_id))
    .map((m) => ({ user_id: m.user_id, centavos: toCents(m.saldo) }));

  const pares: ParDoAcerto[] = [];
  let i = 0;
  let j = 0;
  while (i < devedores.length && j < credores.length) {
    const valor = Math.min(devedores[i].centavos, credores[j].centavos);
    pares.push({
      de_user_id: devedores[i].user_id,
      para_user_id: credores[j].user_id,
      valor: toReais(valor),
    });
    devedores[i].centavos -= valor;
    credores[j].centavos -= valor;
    if (devedores[i].centavos === 0) i++;
    if (credores[j].centavos === 0) j++;
  }
  return pares;
}
