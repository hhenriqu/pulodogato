// =====================================================
// PREVISAO DE FLUXO DE CAIXA (HMO-145)
// =====================================================
// A pergunta: "em que dia o meu saldo fica negativo?"
//
// O app ja respondia duas perguntas vizinhas e nenhuma era esta:
//
//   /api/projection      -> "quanto sobra no dia 30, por conta" (UM ponto no
//                           tempo; nao diz se o saldo mergulha no dia 12 e
//                           volta no dia 20, que e exatamente quando o cheque
//                           especial come juros)
//   /api/safe-to-spend   -> "quanto posso gastar este mes" (um numero unico,
//                           sem data: trata o mes como um balde)
//
// Aqui o tempo e o eixo. O saldo anda DIA A DIA a partir de hoje, cada
// compromisso cai no dia em que vence, e a resposta e uma data.
//
// Tudo neste arquivo e funcao pura: nao le banco, nao pede login, nao grava.
// A rota /api/cash-flow busca as linhas e passa para ca -- mesmo desenho do
// lib/safe-to-spend.ts e do lib/net-worth.ts, e pela mesma razao: e o que
// permite a prova de correcao caber em teste unitario, sem Postgres no meio.
//
// -----------------------------------------------------------------------
// De onde saem os eventos
// -----------------------------------------------------------------------
// Duas fontes, e so duas:
//
//   1. CONTAS PREVISTAS (`scheduled_transactions` com status `pending`). Sao
//      compromissos que o usuario -- ou a regra de recorrencia dele -- ja
//      registrou, com data e valor. Entram pelo dia do vencimento.
//
//   2. RECORRENCIAS DETECTADAS (`detected_recurrences`, HMO-145). Sao as
//      assinaturas que o detector achou sozinho no extrato. Elas NAO existem
//      como conta prevista: ninguem cadastrou a Netflix: o detector a
//      reconheceu. Sem elas a linha fica otimista em todo mes que tem
//      assinatura, que e todo mes.
//
// -----------------------------------------------------------------------
// As armadilhas, e cada uma tem teste proprio
// -----------------------------------------------------------------------
//
//   1. A MESMA COBRANCA NAS DUAS FONTES. Esta e a armadilha central, e ela e
//      nova: quem cadastrou a Netflix como conta prevista E deixou o detector
//      rodar tem a mesma cobranca nos dois lugares. Somar as duas tira R$ 55
//      de um saldo de onde so saem R$ 27,90, e o app anuncia um dia negativo
//      que nao vai acontecer -- pior que errar para menos, porque destroi a
//      confianca no unico numero pelo qual a tela existe.
//      A saida: a cobranca detectada e DESCARTADA quando existe uma conta
//      prevista do mesmo estabelecimento dentro de +/-7 dias. Quem ganha e a
//      conta prevista, porque ela tem data e valor que o usuario controla; a
//      deteccao e uma inferencia sobre o passado. Cada conta prevista absorve
//      no maximo UMA cobranca (ver `TOLERANCIA_DUPLICATA_DIAS`).
//
//   2. FATURA DE CARTAO: AQUI ELA ENTRA, E NO "POSSO GASTAR" NAO. A regra e
//      oposta a do lib/safe-to-spend.ts de proposito, e quem ler os dois
//      arquivos vai achar que um deles esta errado. Nenhum esta:
//        * la a pergunta nao tem data, entao a divida vem INTEIRA do saldo do
//          cartao (fonte unica e completa) e a conta prevista da fatura e
//          descartada para nao contar duas vezes;
//        * aqui a pergunta E a data. O saldo do cartao nao tem dia de
//          vencimento -- a fatura fechada tem. O dinheiro sai da conta
//          corrente no dia do vencimento, e e isso que a linha precisa
//          mostrar.
//      Por isso o saldo inicial NAO desconta cartao nenhum e a fatura entra
//      como evento datado. Descontar os dois seria a armadilha 1 com outra
//      roupa.
//
//   3. VENCIDO NAO SOME. Conta que venceu ontem e nao foi paga continua sendo
//      dinheiro que vai sair, e ela nao tem dia futuro para cair. Cai em HOJE,
//      o primeiro dia da linha -- ignorar seria o jeito mais rapido de a tela
//      dizer que esta tudo bem na exata semana em que a pessoa esta atrasada.
//      Mesmo criterio da /api/projection e do lib/safe-to-spend.ts.
//
//   4. SALDO QUE JA NASCE NEGATIVO. Quem ja esta no vermelho hoje nao recebe
//      "seu saldo fica negativo em 24/09": isso nao e uma descoberta, e a tela
//      precisa dizer outra coisa. `primeiroDiaNegativo` e null nesse caso e
//      `comecaNegativo` e true -- mesma decisao do `goes_negative` da
//      /api/projection, que so avisa quando a projecao MUDA a resposta.
//
//   5. INVESTIMENTO E CONTA ARQUIVADA FICAM FORA do saldo inicial. A classe da
//      conta vem do `classificarConta` do lib/net-worth.ts para nao existirem
//      duas definicoes de "o que e cartao" no repositorio. CDB com carencia
//      nao paga a conta de luz de quinta-feira.
//
//   6. RECORRENCIA COM DATA VENCIDA. `next_expected_date` pode estar no
//      passado quando a ultima varredura e antiga. A cobranca e ROLADA para a
//      frente pela propria frequencia ate cair dentro da janela, em vez de
//      descartada: uma assinatura que o detector viu tres vezes continua
//      cobrando, e some-la e o lado conservador do erro. O laco tem teto
//      (`MAX_PASSOS`) e para se a frequencia nao andar -- sem isso uma data
//      malformada trava o servidor num laco infinito.
//
//   7. SO DETECTED E CONFIRMED PROJETAM. `IGNORED` e o usuario dizendo "isto
//      nao e assinatura" e `CANCELLED` e ele dizendo "cancelei". Projetar
//      qualquer uma delas seria o app insistindo numa cobranca depois de ser
//      corrigido. (A cobranca que aparece DEPOIS do cancelamento ja tem dono:
//      e o alerta CHARGED_AFTER_CANCEL do lib/services/recurrence-alerts.ts.)
//
// -----------------------------------------------------------------------
// O que esta previsao NAO sabe -- e a tela diz isso em voz alta
// -----------------------------------------------------------------------
// GASTO DO DIA A DIA. Mercado, restaurante, posto: nada disso entra. A linha
// mostra o que ja esta comprometido, e por construcao ela e OTIMISTA. Nao
// inventamos uma media diaria de gasto variavel aqui porque o numero da tela
// e uma DATA -- "voce fica negativo em 12/10" --, e uma data que nasce de uma
// media invisivel e uma data que o usuario nao tem como conferir nem corrigir.
// Melhor uma resposta estreita e verdadeira, com o limite escrito na tela, do
// que uma resposta larga que ninguem sabe de onde veio.
//
// PERIODO ABERTO DO CARTAO. A compra de ontem no cartao so vira evento quando
// a fatura fechar e virar conta prevista (ver armadilha 2). Ate la ela esta no
// saldo do cartao, que esta linha nao le. O "quanto posso gastar" cobre essa
// ponta; esta tela cobre a ponta da data.
// =====================================================

import { classificarConta } from "@/lib/net-worth";
import {
  normalizeMerchant,
  proximaCobranca,
  diasEntre,
  isIsoDate,
  addDays,
  type Frequency,
  type RecurrenceStatus,
} from "@/lib/recurrence-detector";

/** Horizonte padrao da previsao, em dias. */
export const DIAS_PADRAO = 90;

/** Teto do horizonte. Acima disso a linha vira ruido e o laco, trabalho a toa. */
export const DIAS_MAX = 365;

/**
 * Distancia maxima, em dias, para considerar que uma conta prevista e a
 * recorrencia detectada sao a MESMA cobranca (armadilha 1).
 *
 * Sete dias, e nao os +/-3 da deteccao, porque aqui as duas datas nascem de
 * fontes diferentes: a conta prevista tem o dia do VENCIMENTO que o usuario
 * digitou, e a recorrencia tem o dia em que a cobranca CAIU no extrato. Um
 * boleto que vence dia 10 e debitado dia 5 e a mesma conta, e com tolerancia
 * de 3 dias ela seria contada duas vezes.
 *
 * Mais que uma semana seria perigoso no outro sentido: uma assinatura semanal
 * teria TODAS as suas cobrancas absorvidas por uma unica conta prevista.
 */
export const TOLERANCIA_DUPLICATA_DIAS = 7;

/**
 * Teto de iteracoes ao projetar uma recorrencia.
 *
 * 400 cobre o pior caso legitimo: uma assinatura semanal com `next_expected`
 * 5 anos atras, rolada ate a janela (~260 passos) e projetada por 365 dias
 * (~52 passos). Existe para uma data malformada nao travar o servidor.
 */
const MAX_PASSOS = 400;

/** Uma conta do jeito que a rota entrega. */
export interface ContaParaFluxo {
  id: string;
  name: string;
  account_type: string;
  current_balance: number | string | null;
  is_active?: boolean | null;
}

/**
 * Uma conta prevista (`scheduled_transactions`).
 *
 * `amount` e sempre positivo (CHECK no 005) e quem diz se aquilo sai ou entra
 * e o tipo da REGRA, nao a ocorrencia -- mesma leitura da /api/projection e do
 * lib/safe-to-spend.ts. Conta avulsa nao tem regra e, por convencao da Fase 1,
 * e despesa.
 */
export interface PrevistaParaFluxo {
  id: string;
  description?: string | null;
  amount: number | string;
  due_date: string;
  /** 'expense' | 'income'. Ausente = despesa. */
  tipo?: string | null;
}

/** Uma recorrencia detectada (`detected_recurrences`). */
export interface RecorrenciaParaFluxo {
  id: string;
  merchant_key: string;
  display_name: string;
  /** Sempre > 0 (CHECK no 011): o produto fala em quanto CUSTA. */
  avg_amount: number | string;
  frequency: Frequency;
  next_expected_date: string;
  status: RecurrenceStatus;
}

export type OrigemDoEvento = "prevista" | "recorrencia";

export interface EventoDoFluxo {
  /** Id da linha de origem; `recorrencia` repete o id a cada cobranca. */
  id: string;
  data: string;
  descricao: string;
  /** Positivo entra, negativo sai. */
  valor: number;
  origem: OrigemDoEvento;
  /** true quando a conta ja tinha vencido e foi trazida para hoje. */
  vencida?: boolean;
}

export interface DiaDoFluxo {
  data: string;
  entra: number;
  sai: number;
  /** Saldo ao FIM do dia, depois de todos os eventos dele. */
  saldo: number;
  eventos: EventoDoFluxo[];
}

export interface FluxoDeCaixa {
  /** Hoje, o primeiro dia da linha. */
  de: string;
  /** Ultimo dia projetado. */
  ate: string;
  dias: number;
  /** Soma das contas liquidas e ativas. Cartao e investimento ficam fora. */
  saldoInicial: number;
  /** O saldo ja esta negativo hoje -- ver armadilha 4. */
  comecaNegativo: boolean;
  /**
   * O dia em que o saldo cruza para baixo de zero. `null` quando nao cruza --
   * e tambem quando ja nasce negativo, onde a frase certa e outra.
   */
  primeiroDiaNegativo: string | null;
  saldoFinal: number;
  menorSaldo: number;
  diaDoMenorSaldo: string;
  totalEntra: number;
  totalSai: number;
  /**
   * Assinaturas cujas cobrancas foram descartadas por ja existirem como conta
   * prevista (armadilha 1). Vai para a tela: sem isso o usuario procura a
   * Netflix na lista, nao acha, e conclui que a previsao esqueceu dela.
   */
  absorvidasPelaAgenda: string[];
  /** Um item por dia do horizonte, inclusive os dias sem evento. */
  linha: DiaDoFluxo[];
}

export interface EntradaDoFluxo {
  contas: ContaParaFluxo[];
  previstas: PrevistaParaFluxo[];
  /**
   * Recorrencias detectadas. OBRIGATORIO, mesmo que vazio: se fosse opcional,
   * uma rota nova que esquecesse de passa-las devolveria uma linha mais
   * otimista que a real, sem erro de compilacao e sem sintoma na tela.
   */
  recorrencias: RecorrenciaParaFluxo[];
  /** 'YYYY-MM-DD'. Injetado para o teste nao depender do calendario. */
  hoje: string;
  /** Horizonte em dias. Fora de [1, DIAS_MAX] e corrigido, nao rejeitado. */
  dias?: number;
}

/** Le o valor tolerando o texto que o PostgREST devolve para `numeric`. */
function numero(valor: number | string | null | undefined): number {
  const bruto = Number(valor ?? 0);
  return Number.isFinite(bruto) ? bruto : 0;
}

/** Horizonte efetivo: inteiro dentro de [1, DIAS_MAX]. */
export function horizonteValido(dias: number | undefined): number {
  const bruto = Math.floor(Number(dias ?? DIAS_PADRAO));
  if (!Number.isFinite(bruto) || bruto < 1) return DIAS_PADRAO;
  return Math.min(bruto, DIAS_MAX);
}

/**
 * As datas em que esta recorrencia cobra dentro de [de, ate].
 *
 * Rola `next_expected_date` para a frente quando ela ficou no passado
 * (armadilha 6) e para se a frequencia nao andar -- uma data invalida faz
 * `proximaCobranca` devolver algo que nao cresce, e sem esta guarda o laco so
 * termina no teto.
 */
export function cobrancasNaJanela(
  recorrencia: RecorrenciaParaFluxo,
  de: string,
  ate: string
): string[] {
  const datas: string[] = [];
  if (!isIsoDate(recorrencia.next_expected_date)) return datas;

  let data = recorrencia.next_expected_date;

  for (let i = 0; i < MAX_PASSOS && data <= ate; i++) {
    if (data >= de) datas.push(data);
    const proxima = proximaCobranca(recorrencia.frequency, data);
    if (!isIsoDate(proxima) || proxima <= data) break;
    data = proxima;
  }

  return datas;
}

/** Uma conta prevista candidata a absorver uma cobranca detectada. */
interface Agendada {
  chave: string;
  data: string;
  usada: boolean;
}

/**
 * Monta a linha do tempo do saldo.
 *
 * A ordem dos passos aqui espelha a ordem das armadilhas no cabecalho, para
 * quem comparar o codigo com o comentario nao precisar traduzir nada.
 */
export function projetarFluxoDeCaixa(entrada: EntradaDoFluxo): FluxoDeCaixa {
  const { contas, previstas, hoje } = entrada;
  // `?? []` apesar de o campo ser obrigatorio no tipo: os testes rodam o JS
  // emitido, onde o tipo nao existe mais, e um `undefined` aqui viraria
  // TypeError em vez de um numero errado.
  const recorrencias = entrada.recorrencias ?? [];
  const dias = horizonteValido(entrada.dias);
  const ate = addDays(hoje, dias - 1);

  // ---------------------------------------------------------------
  // 1. Saldo inicial: so o que e liquido e ativo (armadilhas 2 e 5)
  // ---------------------------------------------------------------
  let saldoInicial = 0;
  for (const conta of contas) {
    if (classificarConta(String(conta.account_type)) !== "liquido") continue;
    if (conta.is_active === false) continue;
    saldoInicial += numero(conta.current_balance);
  }

  // ---------------------------------------------------------------
  // 2. Eventos das contas previstas
  // ---------------------------------------------------------------
  const eventos: EventoDoFluxo[] = [];
  const agendadas: Agendada[] = [];

  for (const p of previstas) {
    if (!isIsoDate(p.due_date) || p.due_date > ate) continue;

    const valor = Math.abs(numero(p.amount));
    const ehReceita = p.tipo === "income";
    // Armadilha 3: o que ja venceu nao tem dia futuro -- cai em hoje.
    const vencida = p.due_date < hoje;
    const data = vencida ? hoje : p.due_date;

    eventos.push({
      id: p.id,
      data,
      descricao: p.description?.trim() || (ehReceita ? "Recebimento previsto" : "Conta prevista"),
      valor: ehReceita ? valor : -valor,
      origem: "prevista",
      vencida,
    });

    // Receita nao absorve assinatura: o detector so agrupa despesa (ver o
    // filtro `t.amount < 0` do detectRecurrences). Sem esta linha, um salario
    // chamado "Netflix" apagaria a assinatura da previsao.
    if (ehReceita) continue;

    const chave = normalizeMerchant(p.description ?? "");
    // Chave vazia (conta sem descricao) nao pode casar com nada: se casasse,
    // ela absorveria a primeira assinatura de chave vazia que aparecesse.
    if (chave) agendadas.push({ chave, data: p.due_date, usada: false });
  }

  // ---------------------------------------------------------------
  // 3. Eventos das recorrencias detectadas, sem duplicar (armadilhas 1 e 7)
  // ---------------------------------------------------------------
  const absorvidas = new Set<string>();

  for (const r of recorrencias) {
    if (r.status !== "DETECTED" && r.status !== "CONFIRMED") continue;

    const valor = Math.abs(numero(r.avg_amount));
    if (valor <= 0) continue;

    for (const data of cobrancasNaJanela(r, hoje, ate)) {
      const gemea = agendadas.find(
        (a) =>
          !a.usada &&
          a.chave === r.merchant_key &&
          Math.abs(diasEntre(a.data, data)) <= TOLERANCIA_DUPLICATA_DIAS
      );

      if (gemea) {
        gemea.usada = true;
        absorvidas.add(r.display_name);
        continue;
      }

      eventos.push({
        id: r.id,
        data,
        descricao: r.display_name,
        valor: -valor,
        origem: "recorrencia",
      });
    }
  }

  // ---------------------------------------------------------------
  // 4. A linha do tempo
  // ---------------------------------------------------------------
  const porDia = new Map<string, EventoDoFluxo[]>();
  for (const e of eventos) {
    const doDia = porDia.get(e.data);
    if (doDia) doDia.push(e);
    else porDia.set(e.data, [e]);
  }

  const linha: DiaDoFluxo[] = [];
  let saldo = saldoInicial;
  let totalEntra = 0;
  let totalSai = 0;
  let primeiroDiaNegativo: string | null = null;
  let menorSaldo = saldoInicial;
  let diaDoMenorSaldo = hoje;
  const comecaNegativo = saldoInicial < 0;

  for (let i = 0; i < dias; i++) {
    const data = addDays(hoje, i);
    const doDia = porDia.get(data) ?? [];

    let entra = 0;
    let sai = 0;
    for (const e of doDia) {
      if (e.valor >= 0) entra += e.valor;
      else sai += -e.valor;
    }

    // Dentro do dia, o que sai primeiro: a ordem so muda a leitura da lista,
    // nao o saldo do fim do dia. Despesa antes de receita e o lado prudente --
    // e o que a pessoa ve no proprio extrato quando o salario cai a tarde.
    doDia.sort((a, b) => a.valor - b.valor);

    saldo += entra - sai;
    totalEntra += entra;
    totalSai += sai;

    // Armadilha 4: quem ja esta no vermelho nao recebe uma data de mergulho.
    if (!comecaNegativo && primeiroDiaNegativo === null && saldo < 0) {
      primeiroDiaNegativo = data;
    }

    // `<` e nao `<=`: empate fica com o dia MAIS CEDO, que e o que a tela quer
    // mostrar ("o fundo do poco e dia 12", nao "e dia 27, quando repetiu").
    if (saldo < menorSaldo) {
      menorSaldo = saldo;
      diaDoMenorSaldo = data;
    }

    linha.push({ data, entra, sai, saldo, eventos: doDia });
  }

  return {
    de: hoje,
    ate,
    dias,
    saldoInicial,
    comecaNegativo,
    primeiroDiaNegativo,
    saldoFinal: saldo,
    menorSaldo,
    diaDoMenorSaldo,
    totalEntra,
    totalSai,
    absorvidasPelaAgenda: Array.from(absorvidas).sort(),
    linha,
  };
}

/**
 * Os proximos eventos, achatados e em ordem de data.
 *
 * A tela mostra uma lista de "o que vem por ai" com o saldo ao lado de cada
 * linha -- e o saldo CORRENTE, nao o do dia: quem le a lista quer saber quanto
 * sobra depois daquele debito especifico.
 */
export interface EventoComSaldo extends EventoDoFluxo {
  saldoDepois: number;
}

export function proximosEventos(
  fluxo: FluxoDeCaixa,
  limite = 30
): EventoComSaldo[] {
  const out: EventoComSaldo[] = [];
  let saldo = fluxo.saldoInicial;

  for (const dia of fluxo.linha) {
    for (const e of dia.eventos) {
      saldo += e.valor;
      // O corte e por QUANTIDADE, nao por data: um usuario com 40 eventos em
      // duas semanas nao quer rolar a tela inteira, e o total de cada dia
      // continua no grafico.
      if (out.length < limite) out.push({ ...e, saldoDepois: saldo });
    }
    if (out.length >= limite) break;
  }

  return out;
}
