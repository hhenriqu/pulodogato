// =====================================================
// QUANTO AINDA POSSO GASTAR ESTE MES (HMO-145)
// =====================================================
// A pergunta que o app ainda nao respondia. O saldo da conta responde "quanto
// tenho"; a projecao (`/api/projection`) responde "quanto sobra no dia 30 por
// conta". Nenhuma das duas responde "quanto posso gastar HOJE sem furar o
// mes", que e a pergunta que a pessoa faz na fila do caixa.
//
// Tudo aqui e funcao pura: nao le banco, nao pede login, nao grava nada. A
// rota /api/safe-to-spend busca as linhas e passa para ca -- mesmo desenho do
// lib/net-worth.ts, e pela mesma razao: e o que permite a prova de correcao
// caber em teste unitario, sem Postgres no meio.
//
// -----------------------------------------------------------------------
// A conta, e por que ela e delicada
// -----------------------------------------------------------------------
//
//   livre = disponivel + receitas previstas - compromissos do mes - divida de cartao
//
// Cada termo tem uma armadilha, e cada armadilha tem teste proprio:
//
//   1. DIVIDA DE CARTAO CONTADA DUAS VEZES. Este e o mesmo buraco do HMO-149
//      com outra roupa. Quando a fatura FECHA, a rota
//      /api/card-invoices/close cria uma conta prevista com a chave canonica
//      `fatura:<mes>:<cartao>` em `notes` -- e o saldo do cartao NAO muda com o
//      fechamento (nenhuma transacao e lancada). Entao aquele mesmo dinheiro
//      aparece nos dois lugares: dentro do saldo negativo do cartao e como
//      conta a pagar. Somar os dois descontaria a fatura duas vezes e o app
//      diria que a pessoa pode gastar menos da metade do que pode.
//      A saida daqui: a divida de cartao vem INTEIRA dos saldos dos cartoes
//      (uma fonte so, sempre completa -- inclui o que ainda nem foi faturado),
//      e as contas previstas que sao fatura ficam de fora pelo `ehFatura`.
//
//   2. COMPRA NO CARTAO QUE NAO MEXE NO NUMERO. O inverso do item 1, e pior:
//      se a divida do cartao nao entrasse na conta, gastar 500 no cartao nao
//      mudaria em nada o "posso gastar" -- e o numero viraria um incentivo a
//      usar o cartao. Por isso entra a divida TODA, inclusive a do periodo
//      aberto, que so vence no mes que vem. O numero fica conservador de
//      proposito: dinheiro que ja foi gasto no cartao nao esta disponivel para
//      ser gasto de novo.
//
//   3. INVESTIMENTO NAO E DINHEIRO DISPONIVEL. A classe vem do
//      `classificarConta` do lib/net-worth.ts, para nao existirem duas
//      definicoes de "o que e cartao" no repositorio. Contar a corretora aqui
//      faria o app liberar para o rodizio da semana um dinheiro que esta em
//      CDB com carencia.
//
//   4. CONTA ARQUIVADA. Ela ENTRA no patrimonio liquido (e dinheiro) e fica
//      FORA daqui (nao e de onde se gasta). As duas telas discordam de
//      proposito, e o teste registra isso -- sem o registro, a proxima pessoa
//      "conserta" a divergencia e reintroduz o erro.
//      O CARTAO arquivado e a excecao, e nao e inconsistencia: divida de cartao
//      cancelado continua tendo que ser paga. Arquivar o cartao nao perdoa a
//      fatura, e se o desconto saisse da conta o "posso gastar" subiria de
//      degrau no dia em que alguem arrumasse a lista de contas.
//
//   5. VENCIDO CONTINUA SENDO DINHEIRO QUE VAI SAIR. Conta que venceu ontem e
//      nao foi paga entra em `compromissos`, igual a projecao faz. Ignorar o
//      vencido e o jeito mais rapido de o app dizer que ha dinheiro sobrando na
//      exata semana em que a pessoa esta atrasada.
//
//   6. DIVISAO POR ZERO NO ULTIMO DIA DO MES. `porDia` divide por dias
//      restantes; no dia 31 o divisor e 1, nunca 0, porque o dia de hoje conta.
//      E com `livre` negativo nao existe verba diaria: devolver um numero
//      negativo por dia imprimiria "-R$ 12,40 por dia" na tela, que nao
//      significa nada. Nesse caso `porDia` e 0 e quem le a tela recebe outra
//      mensagem.
//
// O que esta conta NAO sabe: fatura paga por fora do app (o saldo do cartao
// zera mas a conta prevista fica `pending`), parcelamento futuro do cartao
// (entra por inteiro no mes em que a compra foi feita) e reserva de metas --
// aporte de meta ainda nao tem alvo mensal no schema, entao nao ha o que
// descontar sem inventar semantica.
// =====================================================

import { classificarConta } from "@/lib/net-worth";
import { ehFatura } from "@/lib/card-invoice";
import { lastDayOfMonth } from "@/lib/recurrence";

/** O que o calculo precisa saber sobre uma conta. */
export interface ContaParaGastar {
  id: string;
  name: string;
  account_type: string;
  current_balance: number | string | null;
  is_active?: boolean | null;
}

/**
 * Uma conta prevista (`scheduled_transactions`) do jeito que a rota entrega.
 *
 * `amount` e sempre positivo (CHECK no 005) e quem diz se aquilo sai ou entra e
 * o tipo da REGRA, nao a ocorrencia -- a mesma leitura que a /api/projection
 * faz. Conta avulsa nao tem regra e, por convencao da Fase 1, e despesa.
 */
export interface PrevistaParaGastar {
  id: string;
  amount: number | string;
  due_date: string;
  /** 'expense' | 'income'. Ausente = despesa (conta avulsa). */
  tipo?: string | null;
  notes?: string | null;
}

export interface CartaoNoCalculo {
  id: string;
  name: string;
  /** Quanto se deve neste cartao, sempre >= 0. */
  divida: number;
}

export interface QuantoPossoGastar {
  /** Ultimo dia do mes corrente, 'YYYY-MM-DD'. O horizonte da conta. */
  ate: string;
  /** Hoje inclusive. Nunca 0. */
  diasRestantes: number;
  /** Saldo somado das contas liquidas e ativas. */
  disponivel: number;
  /** Receitas previstas pendentes com vencimento ate o fim do mes. */
  receitasPrevistas: number;
  /** Despesas previstas pendentes ate o fim do mes, SEM as faturas. */
  compromissos: number;
  /** Parte de `compromissos` que ja venceu e nao foi paga. */
  compromissosVencidos: number;
  /** Divida somada dos cartoes: faturas fechadas + periodo aberto. */
  dividaDeCartao: number;
  /** O numero da tela. Pode ser negativo. */
  livre: number;
  /** Verba diaria. 0 quando `livre` <= 0 -- ver armadilha 6. */
  porDia: number;
  cartoes: CartaoNoCalculo[];
}

export interface EntradaDoCalculo {
  contas: ContaParaGastar[];
  previstas: PrevistaParaGastar[];
  /** 'YYYY-MM-DD'. Injetado para o teste nao depender do calendario. */
  hoje: string;
}

/** Le o valor tolerando o texto que o PostgREST devolve para `numeric`. */
function numero(valor: number | string | null | undefined): number {
  const bruto = Number(valor ?? 0);
  return Number.isFinite(bruto) ? bruto : 0;
}

/** Ultimo dia do mes de `iso`, em ISO. */
export function fimDoMes(iso: string): string {
  const [ano, mes] = iso.split("-").map(Number);
  const ultimo = lastDayOfMonth(ano, mes);
  return `${iso.slice(0, 7)}-${String(ultimo).padStart(2, "0")}`;
}

/**
 * Dias que faltam para o fim do mes, contando hoje.
 *
 * Aritmetica de string, nao de Date: `new Date('2026-09-24')` nasce em UTC e,
 * no fuso de Sao Paulo, um `getDate()` sobre ela devolve o dia 23. Aqui os dois
 * lados vem do mesmo mes, entao subtrair o numero do dia basta e nao ha fuso
 * no meio.
 */
export function diasRestantesNoMes(hoje: string): number {
  const ultimo = Number(fimDoMes(hoje).slice(8, 10));
  const dia = Number(hoje.slice(8, 10));
  return Math.max(1, ultimo - dia + 1);
}

/**
 * Quanto ainda pode ser gasto este mes, e quanto por dia.
 *
 * Todas as decisoes de sinal e de exclusao estao no cabecalho do arquivo. A
 * ordem dos termos aqui espelha a ordem em que a tela os mostra, para quem
 * comparar a conta com o que esta vendo nao precisar traduzir nada.
 */
export function calcularQuantoPossoGastar(
  entrada: EntradaDoCalculo
): QuantoPossoGastar {
  const { contas, previstas, hoje } = entrada;
  const ate = fimDoMes(hoje);
  const diasRestantes = diasRestantesNoMes(hoje);

  let disponivel = 0;
  const cartoes: CartaoNoCalculo[] = [];

  for (const conta of contas) {
    const classe = classificarConta(String(conta.account_type));
    const saldo = numero(conta.current_balance);

    if (classe === "divida") {
      // Saldo positivo num cartao (estorno maior que as compras) nao e divida
      // negativa: e zero de divida. Somar o positivo aqui aumentaria o "posso
      // gastar" por causa de um credito que so existe dentro do cartao.
      const divida = saldo < 0 ? -saldo : 0;
      cartoes.push({ id: conta.id, name: conta.name, divida });
      continue;
    }

    // Investimento fica fora: nao e dinheiro disponivel (armadilha 3).
    if (classe !== "liquido") continue;

    // Arquivada fica fora: nao e de onde se gasta (armadilha 4).
    if (conta.is_active === false) continue;

    disponivel += saldo;
  }

  const dividaDeCartao = cartoes.reduce((s, c) => s + c.divida, 0);

  let receitasPrevistas = 0;
  let compromissos = 0;
  let compromissosVencidos = 0;

  for (const p of previstas) {
    if (p.due_date > ate) continue;

    // A fatura fechada ja esta dentro do saldo do cartao (armadilha 1).
    if (ehFatura(p.notes)) continue;

    const valor = Math.abs(numero(p.amount));

    if (p.tipo === "income") {
      receitasPrevistas += valor;
      continue;
    }

    compromissos += valor;
    if (p.due_date < hoje) compromissosVencidos += valor;
  }

  const livre =
    disponivel + receitasPrevistas - compromissos - dividaDeCartao;

  cartoes.sort((a, b) => b.divida - a.divida);

  return {
    ate,
    diasRestantes,
    disponivel,
    receitasPrevistas,
    compromissos,
    compromissosVencidos,
    dividaDeCartao,
    livre,
    porDia: livre > 0 ? livre / diasRestantes : 0,
    cartoes,
  };
}
