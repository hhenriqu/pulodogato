// -----------------------------------------------------------------------------
// O MES DE CADA CONTA (comparacao com o Minhas Financas)
// -----------------------------------------------------------------------------
// O pedido (Helio, 06/11/2026): a tela Contas do Minhas Financas tem, por conta
// e para o mes escolhido, as colunas Saldo inicial, Receitas, Despesas,
// Transf. cred., Transf. deb., Saldo e Previsto. O Pulo do Gato so mostrava o
// saldo de hoje.
//
// O QUE O MINHAS FINANCAS FAZ, MEDIDO COM LANCAMENTOS DE TESTE (novembro/2026)
// ---------------------------------------------------------------------------
//   Saldo inicial R$ 178,17 | Receitas R$ 1.000 | Despesas R$ 550 |
//   Saldo -R$ 121,83 | Previsto R$ 628,17
//
//   - Receitas e Despesas sao o MES INTEIRO, pago e pendente juntos: a receita
//     de R$ 1.000 ainda nao recebida esta la, e as despesas somam a paga
//     (R$ 100), a pendente (R$ 50), a fixa pendente (R$ 200) e o pagamento
//     parcial de fatura (R$ 200).
//   - Saldo e so o REALIZADO: 178,17 - 100 - 200 = -121,83.
//   - Previsto fecha a conta do mes: inicial + receitas - despesas
//     + transf. cred. - transf. deb. = 628,17.
//   - O pagamento da fatura sai da conta como DESPESA, e nao como
//     transferencia: o cartao nao e conta de dinheiro.
//
// AQUI
// ----
// O saldo numa data vem da mesma ideia de `lib/saldo-em-conta.ts`: o banco
// guarda so o saldo de hoje, e `saldo em D = current_balance - soma dos
// lancamentos com data > D`.
//
// O mes junta duas fontes:
//   - os lancamentos gravados com data no mes (inclusive os de data futura);
//   - as previsoes PENDENTES da agenda que vencem no mes.
//
// Um lancamento e TRANSFERENCIA quando o par dele (pelo
// `counterpart_transaction_id`, em qualquer direcao) esta noutra conta de
// dinheiro. Par num cartao -- o pagamento da fatura -- e despesa ou receita,
// pelo sinal.
// -----------------------------------------------------------------------------

import { addDays } from "@/lib/recurrence";
import { contasQueSomam } from "@/lib/contas";

export interface ContaDoMes {
  id: string;
  account_type: string;
  current_balance: number | string | null;
  include_in_total?: boolean | null;
}

export interface LancamentoDoMes {
  id: string;
  account_id: string | null;
  amount: number | string;
  transaction_date: string;
  counterpart_transaction_id?: string | null;
}

/** Uma ponta de transferencia, so para achar em que conta esta o par. */
export interface PontaDoPar {
  id: string;
  account_id: string | null;
  counterpart_transaction_id?: string | null;
}

export type ClasseDaPrevista = "income" | "expense" | "transfer";

export interface PrevistaDoMes {
  id: string;
  account_id: string | null;
  destination_account_id?: string | null;
  amount: number | string;
  due_date: string;
  classe: ClasseDaPrevista;
}

export interface MesDaConta {
  conta_id: string;
  saldo_inicial: number;
  receitas: number;
  despesas: number;
  transf_credito: number;
  transf_debito: number;
  /** O realizado: o saldo hoje, ou no fim do mes se ele ja passou. */
  saldo: number;
  /** Inicial + receitas - despesas + transf. cred. - transf. deb. */
  previsto: number;
}

export interface MesDasContas {
  /** 'AAAA-MM-01' e 'AAAA-MM-DD' do ultimo dia. */
  de: string;
  ate: string;
  contas: MesDaConta[];
  /** A soma das contas que somam nos totais (`contasQueSomam`). */
  total: Omit<MesDaConta, "conta_id">;
}

/** Centavos para reais, sem `-0` (que o Intl escreve "-R$ 0,00"). */
function reais(emCentavos: number): number {
  return emCentavos / 100 || 0;
}

function centavos(valor: number | string | null | undefined): number {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Primeiro e ultimo dia de 'AAAA-MM'; `null` se ilegivel. */
export function limitesDoMes(
  mes: string | null | undefined
): { de: string; ate: string } | null {
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return null;
  const ano = Number(mes.slice(0, 4));
  const numero = Number(mes.slice(5, 7));
  if (numero < 1 || numero > 12) return null;
  const ultimo = new Date(Date.UTC(ano, numero, 0)).getUTCDate();
  return { de: `${mes}-01`, ate: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

/** As contas que guardam dinheiro: tudo que nao e cartao de credito. */
function ehDinheiro(conta: ContaDoMes | undefined): boolean {
  return conta !== undefined && conta.account_type !== "credit_card";
}

type Acumulado = Omit<MesDaConta, "conta_id" | "saldo" | "previsto" | "saldo_inicial">;

export function mesDasContas(opts: {
  contas: ContaDoMes[];
  /** Todo lancamento das contas de dinheiro com data depois da vespera do mes. */
  lancamentos: LancamentoDoMes[];
  /** As pontas ligadas a esses lancamentos (podem repetir os de cima). */
  pares?: PontaDoPar[];
  /** As previsoes pendentes que vencem no mes. */
  previstas?: PrevistaDoMes[];
  mes: string;
  hoje: string;
}): MesDasContas | null {
  const limites = limitesDoMes(opts.mes);
  if (!limites) return null;
  const { de, ate } = limites;
  const vespera = addDays(de, -1);
  // O realizado vai ate hoje, nunca antes da vespera (mes futuro: o saldo e o
  // inicial) nem depois do fim (mes passado: o saldo e o do fim).
  const corte = opts.hoje < vespera ? vespera : opts.hoje > ate ? ate : opts.hoje;

  const contaPorId = new Map(opts.contas.map((c) => [c.id, c]));
  const dinheiro = opts.contas.filter((c) => ehDinheiro(c));

  // Onde esta cada ponta, e quem aponta para quem.
  const contaDaPonta = new Map<string, string | null>();
  const apontadoPor = new Map<string, string>();
  for (const p of [...(opts.pares ?? []), ...opts.lancamentos]) {
    contaDaPonta.set(p.id, p.account_id);
    if (p.counterpart_transaction_id) {
      apontadoPor.set(p.counterpart_transaction_id, p.id);
    }
  }
  const contaDoPar = (l: LancamentoDoMes): string | null => {
    const par = l.counterpart_transaction_id ?? apontadoPor.get(l.id) ?? null;
    if (!par) return null;
    return contaDaPonta.get(par) ?? null;
  };

  const acumulado = new Map<string, Acumulado>();
  const depoisDe = new Map<string, { vespera: number; corte: number }>();
  for (const conta of dinheiro) {
    acumulado.set(conta.id, {
      receitas: 0,
      despesas: 0,
      transf_credito: 0,
      transf_debito: 0,
    });
    depoisDe.set(conta.id, { vespera: 0, corte: 0 });
  }

  for (const l of opts.lancamentos) {
    if (!l.account_id) continue;
    const soma = acumulado.get(l.account_id);
    const depois = depoisDe.get(l.account_id);
    if (!soma || !depois) continue;
    const valor = centavos(l.amount);

    if (l.transaction_date > vespera) depois.vespera += valor;
    if (l.transaction_date > corte) depois.corte += valor;

    if (l.transaction_date < de || l.transaction_date > ate) continue;
    const transferencia = ehDinheiro(contaPorId.get(contaDoPar(l) ?? ""));
    if (transferencia) {
      if (valor >= 0) soma.transf_credito += valor;
      else soma.transf_debito -= valor;
    } else if (valor >= 0) {
      soma.receitas += valor;
    } else {
      soma.despesas -= valor;
    }
  }

  for (const p of opts.previstas ?? []) {
    if (p.due_date < de || p.due_date > ate) continue;
    const valor = Math.abs(centavos(p.amount));
    const origem = p.account_id ? acumulado.get(p.account_id) : undefined;

    if (p.classe === "transfer" && p.destination_account_id) {
      const destino = acumulado.get(p.destination_account_id);
      if (destino && origem) {
        origem.transf_debito += valor;
        destino.transf_credito += valor;
      } else if (origem) {
        // Destino no cartao (ou fora das contas): e saida de dinheiro.
        origem.despesas += valor;
      } else if (destino) {
        destino.receitas += valor;
      }
      continue;
    }
    if (!origem) continue;
    if (p.classe === "income") origem.receitas += valor;
    else origem.despesas += valor;
  }

  const contas: MesDaConta[] = dinheiro.map((conta) => {
    const soma = acumulado.get(conta.id)!;
    const depois = depoisDe.get(conta.id)!;
    const hoje = centavos(conta.current_balance);
    const inicial = hoje - depois.vespera;
    const saldo = hoje - depois.corte;
    const previsto =
      inicial +
      soma.receitas -
      soma.despesas +
      soma.transf_credito -
      soma.transf_debito;
    return {
      conta_id: conta.id,
      saldo_inicial: reais(inicial),
      receitas: reais(soma.receitas),
      despesas: reais(soma.despesas),
      transf_credito: reais(soma.transf_credito),
      transf_debito: reais(soma.transf_debito),
      saldo: reais(saldo),
      previsto: reais(previsto),
    };
  });

  const somam = new Set(contasQueSomam(dinheiro).map((c) => c.id));
  const total = {
    saldo_inicial: 0,
    receitas: 0,
    despesas: 0,
    transf_credito: 0,
    transf_debito: 0,
    saldo: 0,
    previsto: 0,
  };
  for (const linha of contas) {
    if (!somam.has(linha.conta_id)) continue;
    for (const chave of Object.keys(total) as (keyof typeof total)[]) {
      total[chave] += Math.round(linha[chave] * 100);
    }
  }
  for (const chave of Object.keys(total) as (keyof typeof total)[]) {
    total[chave] = reais(total[chave]);
  }

  return { de, ate, contas, total };
}
