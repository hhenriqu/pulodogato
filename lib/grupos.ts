/**
 * O que os grupos somam NAS MINHAS DESPESAS (HMO-175).
 *
 * A tela do grupo ja respondia "quem paga quem" dentro daquele grupo. O que
 * faltava era a pergunta que se faz do outro lado, na tela de Financas
 * Pessoais: *somando todos os meus grupos, eu estou devendo ou me devem?*
 *
 * A CONTA, EM UMA LINHA
 * ---------------------
 *   devo = o que me cabe nos rateios  -  o que eu paguei pelo grupo
 *
 * e os acertos ja registrados entram corrigindo os dois lados: o que eu ja
 * paguei a alguem abate a minha divida, o que eu ja recebi a repoe.
 *
 * O BANCO JA CALCULA ISSO, COM O SINAL INVERTIDO
 * ----------------------------------------------
 * `public.group_member_balances` (migration 007) devolve `net_balance` na
 * convencao do credor: POSITIVO = tenho a receber, NEGATIVO = devo. Esta tela
 * fala na convencao do devedor -- "o valor que EU vou ter que pagar" --, que e
 * o mesmo numero com o sinal trocado.
 *
 * Isso e exatamente o tipo de troca que passa despercebida: com o sinal
 * invertido a tela mostra "voce tem R$ 345 a receber" para quem deve R$ 345, e
 * o numero, o simbolo e a formatacao ficam todos certos. Por isso a inversao
 * mora aqui, em funcao pura com teste, e nao espalhada pelo JSX.
 *
 * TUDO EM CENTAVOS INTEIROS
 * -------------------------
 * Pela mesma razao de `lib/settlement.ts`: a divisao de R$ 100 por tres deixa
 * residuo em ponto flutuante, e um residuo de R$ 0,000001 vira um "voce deve
 * R$ 0,00" que pagamento nenhum zera. A comparacao com zero so e exata em
 * inteiros.
 */

// A conversao para centavos vem de `settlement.ts` de proposito: ela e a UNICA
// definicao de "reais -> centavos" do projeto, e a tolerancia de um centavo
// desta tela tem que bater com a do acerto do grupo. Duas copias divergiriam
// no dia em que uma delas mudasse, e o sintoma seria a tela cobrando uma
// divida que a tela do grupo se recusa a gerar.
import { toCents, toReais } from "@/lib/settlement";

/** Uma linha de `group_member_balances`, ja com o nome do grupo ao lado. */
export interface SaldoDeGrupo {
  group_id: string;
  /** Nome do grupo. `null` quando o grupo sumiu da listagem ativa. */
  nome?: string | null;
  /** Em reais. Convencao do BANCO: positivo = a receber, negativo = devo. */
  net_balance: number;
  /** Quanto eu desembolsei por este grupo, em reais. */
  total_paid?: number;
  /** Quanto me cabe nos rateios deste grupo, em reais. */
  total_owed?: number;
}

/** Um grupo, ja na convencao do devedor. */
export interface GrupoNoResumo {
  group_id: string;
  nome: string;
  /** Em reais, convencao do DEVEDOR: positivo = eu pago, negativo = me pagam. */
  devo: number;
  total_paid: number;
  total_owed: number;
}

export interface ResumoDeGrupos {
  /** Soma dos grupos em que eu devo. Sempre >= 0. */
  aPagar: number;
  /** Soma dos grupos em que tenho a receber. Sempre >= 0. */
  aReceber: number;
  /** `aPagar - aReceber`. Positivo = no total eu pago. */
  liquido: number;
  /** So os grupos com saldo em aberto, do maior debito para o maior credito. */
  grupos: GrupoNoResumo[];
  /** Quantos grupos entraram na conta, inclusive os quitados. */
  totalDeGrupos: number;
}

/**
 * Um centavo de tolerancia, igual ao de `simplifySettlements`.
 *
 * Os dois precisam concordar: se o acerto do grupo considera um saldo de
 * R$ 0,01 "quitado" e nao gera transferencia, mas esta tela o considera uma
 * divida em aberto, a pessoa le "voce deve R$ 0,01 no grupo X", abre o grupo
 * para pagar, e nao encontra pagamento nenhum a registrar.
 */
const TOLERANCIA_EM_CENTAVOS = 1;

/**
 * De N linhas da view para o que a tela de Financas Pessoais mostra.
 *
 * Grupos quitados saem da lista (`grupos`) mas continuam contando em
 * `totalDeGrupos`: a lista e o que exige acao, e o total e o que explica o
 * "participo de 4 grupos e so aparecem 2 aqui".
 *
 * A ordenacao secundaria por `group_id` existe pela mesma razao que a de
 * `simplifySettlements`: com dois grupos devendo exatamente o mesmo valor, a
 * ordem de chegada do banco decidiria qual aparece primeiro, e a lista trocaria
 * de ordem a cada refresh sem nada ter mudado.
 */
export function resumoDosGrupos(linhas: SaldoDeGrupo[]): ResumoDeGrupos {
  let aPagarCents = 0;
  let aReceberCents = 0;
  const grupos: (GrupoNoResumo & { cents: number })[] = [];

  for (const linha of linhas) {
    // A inversao de sinal: a view fala de credito, a tela fala de divida.
    const devoCents = -toCents(linha.net_balance);

    if (devoCents > TOLERANCIA_EM_CENTAVOS) aPagarCents += devoCents;
    else if (devoCents < -TOLERANCIA_EM_CENTAVOS) aReceberCents += -devoCents;
    else continue; // quitado: nao vai para a lista

    grupos.push({
      group_id: linha.group_id,
      // Grupo sem nome ainda e um grupo: sumir com a linha esconderia dinheiro.
      nome: linha.nome || "Grupo sem nome",
      devo: toReais(devoCents),
      total_paid: Number(linha.total_paid) || 0,
      total_owed: Number(linha.total_owed) || 0,
      cents: devoCents,
    });
  }

  grupos.sort((a, b) => b.cents - a.cents || a.group_id.localeCompare(b.group_id));

  return {
    aPagar: toReais(aPagarCents),
    aReceber: toReais(aReceberCents),
    liquido: toReais(aPagarCents - aReceberCents),
    grupos: grupos.map(({ cents, ...g }) => g),
    totalDeGrupos: linhas.length,
  };
}

/**
 * A frase do cartao, decidida FORA do JSX.
 *
 * Tres estados, e o terceiro e o que costuma sumir: sem ele, quem nao deve nada
 * ve o cartao com "R$ 0,00" sob o rotulo "Você deve aos grupos", que parece um
 * erro de carregamento e nao uma conta fechada.
 */
export function rotuloDoResumo(resumo: ResumoDeGrupos): {
  estado: "devo" | "recebo" | "quitado";
  titulo: string;
  valor: number;
} {
  if (resumo.liquido > 0) {
    return {
      estado: "devo",
      titulo: "Você deve aos grupos",
      valor: resumo.liquido,
    };
  }

  if (resumo.liquido < 0) {
    return {
      estado: "recebo",
      titulo: "Os grupos devem a você",
      valor: -resumo.liquido,
    };
  }

  return { estado: "quitado", titulo: "Contas de grupo em dia", valor: 0 };
}

/**
 * `liquido` sozinho MENTE quando ha grupos nos dois sentidos.
 *
 * Devo R$ 500 no grupo da viagem e tenho R$ 500 a receber no grupo da casa: o
 * liquido e zero, e "tudo quitado" e falso -- ninguem paga a viagem com um
 * credito que esta em outro grupo, com outras pessoas. Nesse caso a tela
 * precisa mostrar as duas pontas, e nao o zero.
 */
export function precisaDetalhar(resumo: ResumoDeGrupos): boolean {
  return resumo.aPagar > 0 && resumo.aReceber > 0;
}
