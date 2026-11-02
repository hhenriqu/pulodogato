/**
 * A CONEXAO FUNCIONA COMO UM GRUPO DE DUAS PESSOAS (RN020.8 a RN020.11, 075).
 *
 * "Conexoes devem funcionar assim como grupos: quando lancar contas, ficar
 * registrado na conexao, aparecer pra quem vai receber como receita prevista e
 * pra quem paga como despesa, pra saber o quanto tem que pagar por mes."
 *
 * Duas metades, as duas puras:
 *
 *   * `divisaoParaGravar` / `conferirDivisao`: a parte de cada conexao que a
 *     despesa fixa, a prevista e a parcelada levam para o banco. Ate a 075 o
 *     formulario oferecia "Dividir esta despesa" nos tres e a divisao com
 *     pessoa so era gravada no lancamento avulso -- nos outros ela sumia sem
 *     erro.
 *   * `resumoDaConexao`: o que esta registrado entre mim e a conexao, mes a
 *     mes. As linhas sao as contas que o banco gera para cada lado (070 e 075),
 *     achadas por `scheduled_transactions.contraparte_id`.
 */

/**
 * O parametro que a tela da conexao manda para o formulario: "Lancar conta com
 * <pessoa>" abre a despesa ja dividida com ela. Mora aqui para o link e o
 * leitor nao divergirem.
 */
export const PARAM_DA_CONEXAO = "conexao";

/** Uma parte como o formulario a guarda. */
export interface RateioDoFormulario {
  participanteId: string;
  percentual: number;
}

/** Uma parte como as rotas a recebem e o banco a grava. */
export interface ParteDaConexao {
  participant_id: string;
  percentage: number;
}

/**
 * As partes que a despesa leva, ou `[]`.
 *
 * Com grupo nao ha parte de pessoa: o grupo ja diz quem paga (RN020.4), e o
 * banco ignoraria a parte de qualquer jeito. Mandar `[]` em vez de omitir o
 * campo deixa a rota com uma pergunta so ("tem parte?").
 */
export function divisaoParaGravar(valores: {
  compartilhado: boolean;
  grupoId: string;
  rateios: RateioDoFormulario[];
}): ParteDaConexao[] {
  if (!valores.compartilhado || valores.grupoId) return [];
  return valores.rateios
    .filter((r) => r.participanteId && r.percentual > 0)
    .map((r) => ({ participant_id: r.participanteId, percentage: r.percentual }));
}

export type ConferenciaDaDivisao =
  | { ok: true; partes: ParteDaConexao[] }
  | { ok: false; erro: string };

/**
 * Confere o campo `divisao` que chegou no corpo de uma rota.
 *
 * Ausente e lista vazia sao "sem divisao". A conexao aceita e conferida pela
 * policy de escrita da 075 (e pela da 001 no lancamento); aqui fica o que da
 * para dizer sem banco: forma, percentual, pessoa repetida, a propria pessoa e
 * a soma.
 */
export function conferirDivisao(
  bruto: unknown,
  donoId: string
): ConferenciaDaDivisao {
  if (bruto == null) return { ok: true, partes: [] };
  if (!Array.isArray(bruto)) {
    return { ok: false, erro: "A divisão precisa ser uma lista de pessoas." };
  }

  const partes: ParteDaConexao[] = [];
  const vistas = new Set<string>();
  let soma = 0;
  for (const item of bruto) {
    const pessoa = (item as { participant_id?: unknown })?.participant_id;
    const percentual = Number((item as { percentage?: unknown })?.percentage);
    if (typeof pessoa !== "string" || !pessoa) {
      return { ok: false, erro: "Escolha com quem dividir." };
    }
    if (!Number.isFinite(percentual) || percentual <= 0 || percentual > 100) {
      return { ok: false, erro: "A parte de cada pessoa vai de 0,01% a 100%." };
    }
    if (pessoa === donoId) {
      return { ok: false, erro: "Não dá para dividir uma despesa com você mesmo." };
    }
    if (vistas.has(pessoa)) {
      return { ok: false, erro: "A mesma pessoa aparece duas vezes na divisão." };
    }
    vistas.add(pessoa);
    // Em centesimos: 33,33 + 33,33 + 33,34 tem de dar 100, e em ponto
    // flutuante da 100,00000000000001.
    soma += Math.round(percentual * 100);
    partes.push({ participant_id: pessoa, percentage: Math.round(percentual * 100) / 100 });
  }

  if (soma > 10000) {
    return { ok: false, erro: "A soma das partes passa de 100%." };
  }
  return { ok: true, partes };
}

/** Uma conta da agenda gerada pela divisao com a conexao. */
export interface ContaDaConexao {
  id: string;
  description: string;
  amount: number | string;
  due_date: string;
  status: string;
  transaction_type: string | null;
  paid_date?: string | null;
}

export interface MesDaConexao {
  /** `AAAA-MM`. */
  mes: string;
  /** O que eu ainda tenho a pagar a conexao neste mes. */
  aPagar: number;
  /** O que a conexao ainda tem a me pagar neste mes. */
  aReceber: number;
  /** O que eu ja paguei a ela, pelas contas deste mes. */
  pago: number;
  /** O que ela ja me pagou, pelas contas deste mes. */
  recebido: number;
  /** `aReceber - aPagar`: positivo, ela me deve; negativo, eu devo a ela. */
  saldo: number;
  contas: ContaDaConexao[];
}

const centavos = (valor: number | string) => Math.round(Math.abs(Number(valor)) * 100);

/**
 * O que esta registrado entre mim e a conexao, por mes de vencimento.
 *
 * Pulada e cancelada ficam de fora: nao vao acontecer (054). A conta da
 * divisao e sempre `income` (a receber) ou `expense` (a pagar), com o tipo
 * gravado na linha pela 070/075. A conta em aberto e vencida continua no mes
 * do vencimento -- ela e o atraso, e some quando for paga.
 *
 * As somas sao feitas em centavos inteiros, pelo motivo de `conferirDivisao`.
 */
export function resumoDaConexao(contas: ContaDaConexao[]): MesDaConexao[] {
  const porMes = new Map<
    string,
    { aPagar: number; aReceber: number; pago: number; recebido: number; contas: ContaDaConexao[] }
  >();

  for (const conta of contas) {
    if (conta.status === "skipped" || conta.status === "cancelled") continue;
    const mes = conta.due_date.slice(0, 7);
    const balde =
      porMes.get(mes) ?? { aPagar: 0, aReceber: 0, pago: 0, recebido: 0, contas: [] };
    const valor = centavos(conta.amount);
    const paga = conta.status === "paid";
    if (conta.transaction_type === "income") {
      if (paga) balde.recebido += valor;
      else balde.aReceber += valor;
    } else {
      if (paga) balde.pago += valor;
      else balde.aPagar += valor;
    }
    balde.contas.push(conta);
    porMes.set(mes, balde);
  }

  return Array.from(porMes.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, b]) => ({
      mes,
      aPagar: b.aPagar / 100,
      aReceber: b.aReceber / 100,
      pago: b.pago / 100,
      recebido: b.recebido / 100,
      saldo: (b.aReceber - b.aPagar) / 100,
      contas: b.contas.sort(
        (x, y) => x.due_date.localeCompare(y.due_date) || x.id.localeCompare(y.id)
      ),
    }));
}
