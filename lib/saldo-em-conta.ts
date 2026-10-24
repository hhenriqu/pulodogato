// -----------------------------------------------------------------------------
// O SALDO EM CONTA DO PAINEL
// -----------------------------------------------------------------------------
// "Saldo em conta deve ser o quanto eu tenho na minha conta mais receitas ja
// realizadas menos despesas ja pagas no periodo e considerar o saldo para o mes
// seguinte." -- Helio, 24/10/2026.
//
// Ate aqui o tile somava `current_balance` de TODA conta ativa, cartao
// incluido. O cartao guarda a divida de cada compra -- inclusive as parcelas
// que vencem daqui a meses --, e quem tinha a conta corrente zerada via o
// painel negativo pelo total do cartao (medido: -R$ 1.695,52, duas faturas
// futuras, numa conta criada no mesmo dia).
//
// A REGRA
// -------
//   saldo no fim = saldo no comeco + entradas realizadas - saidas pagas
//
// so nas contas que guardam dinheiro: toda conta que soma nos totais
// (`contasQueSomam`) e nao e `credit_card`. O cartao entra no saldo quando a
// fatura e PAGA, pela perna da transferencia que sai da conta corrente -- e o
// mesmo criterio do Resultado (RN017.4, fase 6): a compra no cartao nao e
// dinheiro que saiu, a fatura paga e.
//
// O SALDO PASSA DE UM MES PARA O OUTRO porque ele nao e uma soma do periodo:
// e o saldo da conta numa data. O "comeco" de novembro e o "fim" de outubro,
// pela mesma conta.
//
// O SALDO NUMA DATA, SEM HISTORICO GRAVADO
// ----------------------------------------
// O banco guarda so o saldo de HOJE (`current_balance`), e o trigger
// `update_account_balance` ja somou nele todo lancamento gravado -- inclusive o
// de data futura que a materializacao de recorrencia cria. Entao:
//
//   saldo em D = current_balance - soma dos lancamentos com data > D
//
// Isso tambem tira o lancamento futuro do "ja realizado", que e a outra metade
// do pedido. O saldo inicial digitado na criacao da conta, que nao e
// lancamento, fica dentro de `current_balance` e atravessa todos os meses.
//
// "JA" QUER DIZER ATE HOJE. O fim do periodo e `min(ate, hoje)`; num periodo
// inteiramente futuro o fim e o comeco sao hoje, e entradas e saidas sao zero.
//
// A TRANSFERENCIA ENTRE DUAS CONTAS DE DINHEIRO nao e entrada nem saida: as
// duas pernas saem da soma. O pagamento de fatura tem uma perna so aqui -- a
// outra cai no cartao -- e entra como saida, que e o que ele e.
// -----------------------------------------------------------------------------

import { addDays } from "@/lib/recurrence";
import { contasQueSomam } from "@/lib/contas";

export interface ContaDoSaldo {
  id: string;
  account_type: string;
  current_balance: number | string | null;
  include_in_total?: boolean | null;
}

export interface LancamentoDoSaldo {
  id: string;
  account_id: string | null;
  amount: number | string;
  transaction_date: string;
  counterpart_transaction_id?: string | null;
}

export interface SaldoEmConta {
  /** Primeiro dia que conta (o `de` do periodo, ou hoje se ele for futuro). */
  desde: string;
  /** Ultimo dia que conta: `min(ate, hoje)`. */
  ate: string;
  saldo_inicial: number;
  entradas: number;
  saidas: number;
  saldo_final: number;
  /** Quantas contas entraram na soma. */
  contas: number;
}

/** As contas que guardam dinheiro: somam nos totais e nao sao cartao. */
export function contasDeDinheiro<T extends ContaDoSaldo>(contas: T[]): T[] {
  return contasQueSomam(contas).filter(
    (conta) => conta.account_type !== "credit_card"
  );
}

function centavos(valor: number): number {
  return Math.round(valor * 100);
}

/**
 * O saldo em conta de um periodo.
 *
 * `lancamentos` precisa trazer TODO lancamento das contas de dinheiro com data
 * a partir de `de - 1 dia` (ou de hoje, o que vier antes) -- os de antes nao
 * mudam conta nenhuma aqui. Linha de outra conta e ignorada.
 */
export function calcularSaldoEmConta(opts: {
  contas: ContaDoSaldo[];
  lancamentos: LancamentoDoSaldo[];
  de: string;
  ate: string;
  hoje: string;
}): SaldoEmConta {
  const { hoje } = opts;
  const dinheiro = contasDeDinheiro(opts.contas);
  const ids = new Set(dinheiro.map((c) => c.id));

  const fim = opts.ate < hoje ? opts.ate : hoje;
  const desde = opts.de < hoje ? opts.de : hoje;
  // O saldo inicial e o do fim do dia anterior ao comeco.
  const vespera = addDays(desde, -1);

  const daqui = opts.lancamentos.filter(
    (l) => l.account_id !== null && ids.has(l.account_id)
  );
  const contaPorLancamento = new Map(daqui.map((l) => [l.id, l.account_id]));

  let hojeEmCentavos = 0;
  for (const conta of dinheiro) hojeEmCentavos += centavos(Number(conta.current_balance ?? 0));

  const saldoEm = (data: string) => {
    let depois = 0;
    for (const l of daqui) {
      if (l.transaction_date > data) depois += centavos(Number(l.amount));
    }
    return hojeEmCentavos - depois;
  };

  let entradas = 0;
  let saidas = 0;
  for (const l of daqui) {
    if (l.transaction_date <= vespera || l.transaction_date > fim) continue;
    // As duas pernas de uma transferencia entre contas de dinheiro, ambas no
    // periodo, se anulam -- nenhuma e entrada ou saida. Se so uma esta no
    // periodo, ela conta pelo sinal, e a conta continua fechando.
    const par = l.counterpart_transaction_id
      ? daqui.find((o) => o.id === l.counterpart_transaction_id)
      : undefined;
    if (
      par &&
      contaPorLancamento.has(par.id) &&
      par.transaction_date > vespera &&
      par.transaction_date <= fim
    ) {
      continue;
    }
    const valor = centavos(Number(l.amount));
    if (valor >= 0) entradas += valor;
    else saidas -= valor;
  }

  const inicial = saldoEm(vespera);
  const final = saldoEm(fim);

  return {
    desde,
    ate: fim,
    saldo_inicial: inicial / 100,
    entradas: entradas / 100,
    saidas: saidas / 100,
    saldo_final: final / 100,
    contas: dinheiro.length,
  };
}

// -----------------------------------------------------------------------------
// O ROTULO DO TILE
// -----------------------------------------------------------------------------
// Herdado da regra que valia para o tile antigo (HMO-173): um numero nunca
// aparece debaixo do nome de um periodo a que ele nao se refere. Agora o
// numero TEM versao para todo periodo -- e o saldo no fim dele, ou hoje se o
// fim ainda nao chegou --, e o rotulo diz qual das duas.

export interface RotuloDoSaldoEmConta {
  titulo: string;
  nota: string;
  /** Mostrar a linha "comecou com / entrou / saiu"? Nao num periodo futuro. */
  mostrarMovimento: boolean;
}

export function rotuloDoSaldoEmConta(opts: {
  de: string;
  ate: string;
  hoje: string;
  /** O periodo por extenso, de `rotuloDoPeriodo`. */
  nomeDoPeriodo: string;
}): RotuloDoSaldoEmConta {
  if (opts.de > opts.hoje) {
    return {
      titulo: "Saldo em conta hoje",
      nota: `Ainda não começou ${opts.nomeDoPeriodo}: é o saldo que passa para ele`,
      mostrarMovimento: false,
    };
  }
  if (opts.ate < opts.hoje) {
    return {
      titulo: "Saldo em conta no fim",
      nota: `Em ${opts.nomeDoPeriodo}, sem o cartão de crédito`,
      mostrarMovimento: true,
    };
  }
  return {
    titulo: "Saldo em conta",
    nota: "Hoje, sem o cartão de crédito: ele entra quando a fatura é paga",
    mostrarMovimento: true,
  };
}
