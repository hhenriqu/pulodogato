/**
 * Acerto de contas do grupo: de N saldos para o menor numero de transferencias.
 *
 * "Ana pagou o hotel, Helio pagou a gasolina, Bia nao pagou nada" vira, no fim
 * da viagem, uma lista de quem paga quanto para quem. O objetivo nao e so
 * fechar a conta -- e fechar com POUCAS transferencias. Par a par, tres pessoas
 * ja geram ate seis pagamentos; simplificado, no maximo dois.
 *
 * TUDO EM CENTAVOS INTEIROS
 * -------------------------
 * A entrada vem em reais (numeric(15,2) do banco) e a primeira coisa que este
 * modulo faz e converter para centavos inteiros. Nao e preciosismo: em ponto
 * flutuante, tres pessoas dividindo R$ 100,00 recebem 33.333... cada, os saldos
 * nao somam exatamente zero, e o algoritmo guloso fecha deixando residuos de
 * R$ 0,0000001 -- que viram uma transferencia fantasma de R$ 0,00 na tela, ou
 * um "voce ainda deve R$ 0,00" que nao some com pagamento nenhum, porque nao
 * existe pagamento capaz de zerar aquilo.
 *
 * Em centavos inteiros a comparacao com zero e exata e esse estado nao existe.
 */

/** Saldo liquido de um membro, como vem de public.group_member_balances. */
export interface MemberBalance {
  user_id: string;
  /** Em reais. Negativo = deve; positivo = tem a receber. */
  net_balance: number;
  full_name?: string | null;
  avatar_url?: string | null;
}

/** Uma transferencia sugerida: quem paga, quem recebe, quanto. */
export interface SuggestedTransfer {
  from_user_id: string;
  to_user_id: string;
  /** Em reais, com duas casas. */
  amount: number;
  from_name?: string | null;
  to_name?: string | null;
}

/** Reais -> centavos, sem o erro de `Math.round(x * 100)` em valores como 1.005. */
export function toCents(reais: number): number {
  return Math.round((Number(reais) || 0) * 100);
}

/** Centavos -> reais com duas casas. */
export function toReais(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * Reduz os saldos ao menor numero pratico de transferencias.
 *
 * O algoritmo e o guloso classico: pega o maior devedor e o maior credor,
 * transfere o menor dos dois valores, repete. Ele nao garante o minimo
 * absoluto -- achar o minimo e NP-dificil (particao de conjunto) -- mas garante
 * no maximo N-1 transferencias para N pessoas, contra ate N*(N-1)/2 no acerto
 * par a par, e acerta o otimo em praticamente toda viagem real. Pagar o custo
 * exponencial para eventualmente economizar um Pix nao se justifica.
 *
 * A ordenacao secundaria por user_id existe para o resultado ser DETERMINISTICO:
 * com empate de saldo (dois membros devendo exatamente R$ 50), a ordem de
 * chegada do banco decidiria quem paga quem, e a tela trocaria os nomes de
 * lugar a cada refresh sem nada ter mudado.
 */
export function simplifySettlements(
  balances: MemberBalance[],
): SuggestedTransfer[] {
  const nomes = new Map<string, MemberBalance>();
  for (const b of balances) nomes.set(b.user_id, b);

  // Um centavo de tolerancia: saldo de R$ 0,01 nao vira transferencia.
  const naoZero = balances
    .map((b) => ({ user_id: b.user_id, cents: toCents(b.net_balance) }))
    .filter((b) => Math.abs(b.cents) > 1);

  const devedores = naoZero
    .filter((b) => b.cents < 0)
    .sort((a, b) => a.cents - b.cents || a.user_id.localeCompare(b.user_id));
  const credores = naoZero
    .filter((b) => b.cents > 0)
    .sort((a, b) => b.cents - a.cents || a.user_id.localeCompare(b.user_id));

  const transferencias: SuggestedTransfer[] = [];
  let i = 0;
  let j = 0;

  while (i < devedores.length && j < credores.length) {
    const devedor = devedores[i];
    const credor = credores[j];
    const valor = Math.min(-devedor.cents, credor.cents);

    // Com os dois `if` do fim do laco, `valor` nunca chega a zero aqui -- esta
    // guarda e a segunda das duas defesas contra a transferencia de R$ 0,00, e
    // sozinha ja basta. Derrubar as duas e o que o teste
    // "par que se anula exatamente" pega; derrubar uma so nao muda a saida.
    if (valor > 0) {
      transferencias.push({
        from_user_id: devedor.user_id,
        to_user_id: credor.user_id,
        amount: toReais(valor),
        from_name: nomes.get(devedor.user_id)?.full_name ?? null,
        to_name: nomes.get(credor.user_id)?.full_name ?? null,
      });
    }

    devedor.cents += valor;
    credor.cents -= valor;

    // Avanca quem zerou. Os dois podem zerar na MESMA rodada (50 contra -50),
    // e por isso sao dois `if` e nao um `if/else`: com `else`, o credor que
    // zerou junto ficaria parado no indice e a rodada seguinte calcularia
    // valor = 0 contra ele -- uma volta desperdicada, e a transferencia de
    // R$ 0,00 se a guarda de `valor > 0` acima tambem cair.
    if (devedor.cents === 0) i++;
    if (credor.cents === 0) j++;
  }

  return transferencias;
}

/**
 * O que ESTE usuario deve e tem a receber, dentro da lista sugerida.
 * A tela do grupo mostra "voce paga X para Ana" em destaque; o resto do grupo
 * fica na lista de baixo.
 */
export function transfersForUser(
  transfers: SuggestedTransfer[],
  userId: string,
): { toPay: SuggestedTransfer[]; toReceive: SuggestedTransfer[] } {
  return {
    toPay: transfers.filter((t) => t.from_user_id === userId),
    toReceive: transfers.filter((t) => t.to_user_id === userId),
  };
}

/**
 * A soma dos saldos de um grupo fechado tem que ser zero: todo real que alguem
 * pagou a mais e um real que outro pagou a menos.
 *
 * Quando NAO da zero, nao e erro de arredondamento -- e um dos casos abaixo, e
 * os tres sao reais neste banco:
 *   - despesa de grupo lancada sem rateio nenhum (group_transactions sem
 *     group_expense_splits, o que acontece quando o grupo nao tinha membro
 *     ativo no momento do lancamento);
 *   - rateio que nao cobre 100% do valor da despesa;
 *   - rateio no nome de um membro que ja saiu -- ele sai da view, que so lista
 *     membro ativo, mas a despesa que ele pagou continua contando para os outros.
 *
 * A tela usa isto para avisar em vez de exibir um acerto que nao fecha.
 */
export function residual(balances: MemberBalance[]): number {
  const soma = balances.reduce((acc, b) => acc + toCents(b.net_balance), 0);
  return toReais(soma);
}
