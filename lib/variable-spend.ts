// =====================================================
// GASTO VARIAVEL DO DIA A DIA (HMO-145)
// =====================================================
// O buraco que a previsao de fluxo de caixa deixou aberto de proposito.
//
// O lib/cash-flow-forecast.ts projeta so o que esta COMPROMETIDO -- conta
// prevista e assinatura detectada -- e o rodape da tela diz, em voz alta, que
// mercado, restaurante e posto nao entram. Isso torna a linha honesta e
// OTIMISTA ao mesmo tempo: a data de mergulho que ela anuncia e sempre mais
// tarde que a real, e para quem vive perto do zero a diferenca e o mes inteiro.
//
// Este arquivo calcula a peca que faltava: quanto sai por dia, em media, sem
// que exista uma conta pedindo. Ele NAO decide nada sozinho -- devolve um
// numero com a procedencia junto (quantos meses o sustentam, quais meses sao,
// o que foi descartado), porque a razao original para nao inventar essa media
// continua valendo: uma DATA que nasce de um numero invisivel e uma data que o
// usuario nao tem como conferir nem corrigir. A media so pode entrar na conta
// se ela aparecer na tela e puder ser mudada la.
//
// Tudo aqui e funcao pura: nao le banco, nao pede login, nao grava. Mesmo
// desenho do lib/anomalies.ts e do lib/cash-flow-forecast.ts, e pela mesma
// razao -- e o que permite a prova caber em teste unitario, sem Postgres.
//
// -----------------------------------------------------------------------
// A ARMADILHA CENTRAL: CONTAR A NETFLIX DUAS VEZES
// -----------------------------------------------------------------------
// A media ingenua -- somar toda despesa do mes e dividir por 30 -- inclui a
// Netflix, o aluguel e a academia. Mas essas TRES ja entram na previsao como
// evento datado. Somar as duas coisas cobra a assinatura duas vezes e a linha
// provavel mergulha num dia que nao vai acontecer.
//
// E a mesma familia da armadilha 1 do lib/cash-flow-forecast.ts (a cobranca que
// existe como conta prevista E como recorrencia detectada), com uma diferenca
// que muda o remedio: la as duas fontes tem DATA e da para casar cobranca a
// cobranca; aqui um lado e um agregado mensal, e nao ha cobranca para casar.
// Por isso a exclusao e por CHAVE de estabelecimento, com o mesmo
// `normalizeMerchant` que o detector usa -- e nao por valor ou por data.
//
// -----------------------------------------------------------------------
// E A ARMADILHA DE DENTRO DELA: EXCLUIR DE MAIS
// -----------------------------------------------------------------------
// Excluir uma chave que a previsao NAO projeta e pior que nao excluir nada: o
// gasto some das DUAS metades -- nao esta na media, nao vira evento -- e a
// linha "provavel" fica mais otimista que a "otimista". O erro e invisivel,
// porque o numero continua plausivel.
//
// Dai a regra: `chavesComprometidas` tem que ser exatamente o conjunto que
// vira evento recorrente na previsao. Duas fontes, e so duas:
//
//   * assinaturas detectadas em `DETECTED` ou `CONFIRMED`. `IGNORED` e o
//     usuario dizendo "isto NAO e assinatura" -- aquele gasto e variavel e
//     TEM que continuar na media. `CANCELLED` idem: nao projeta evento, entao
//     nao pode ser descontado da media (o historico dele so sai da janela com
//     o tempo, e ate la e gasto que de fato aconteceu).
//
//   * regras recorrentes ativas (`recurring_rules`), que geram conta prevista
//     todo periodo.
//
// Conta prevista AVULSA fica FORA da exclusao, e essa e a parte contraintuitiva:
// ela tambem vira evento na previsao. Mas ela acontece UMA vez, enquanto a
// media fala de todo mes. Uma conta avulsa "Mercado Extra" cadastrada para o
// dia 20 excluiria todo o historico de supermercado da media -- a maior
// categoria variavel de quase todo mundo -- para compensar um evento unico.
// O erro de nao excluir e cobrar uma vez a mais um valor que o usuario
// digitou; o de excluir e apagar a maior parcela do gasto variavel. Nao sao
// comparaveis.
//
// -----------------------------------------------------------------------
// AS OUTRAS TRES, E ONDE CADA UMA E FECHADA
// -----------------------------------------------------------------------
//
//   1. O SINAL. Despesa e gravada NEGATIVA neste banco, e um `SUM` cru devolve
//      -1.800 para quem gastou 1.800. Aqui ninguem le `amount` direto: quem le
//      e o `gastoDaTransacao` do lib/anomalies.ts, que filtra por
//      `transaction_type` e usa ABS. Importar a funcao em vez de repetir a
//      regra e o ponto -- duas copias dessa decisao e como a segunda erra.
//      O filtro por `transaction_type` tambem e o que descarta as duas pernas
//      `transfer` do pagamento de fatura (HMO-149): o mesmo dinheiro mudando
//      de lugar nao e gasto novo.
//
//   2. O MES CORRENTE. Ele esta pela metade. Entrar na base puxaria a mediana
//      para baixo todo dia 3 e a linha provavel ficaria otimista exatamente no
//      comeco do mes, que e quando ela tem mais dias pela frente para errar.
//      So mes FECHADO entra. (O lib/anomalies.ts resolve o mesmo problema de
//      outro jeito -- corta o historico no mesmo dia do mes -- porque la o mes
//      corrente E o objeto da pergunta. Aqui ele nao e.)
//
//   3. MES SEM MOVIMENTO. Quem importou extrato de marco e de setembro tem
//      cinco meses vazios no meio. Contar zero neles derrubaria a mediana para
//      perto de zero e a "linha provavel" voltaria a ser a otimista com outro
//      nome. Mes vazio e ausencia de DADO, nao um mes barato: sai da base.
//      Mesma decisao do `compararComHistorico`, pela mesma razao.
//
//   4. USUARIO NOVO. Sem meses fechados suficientes nao existe "normal", e o
//      honesto e nao desenhar a segunda linha -- nao desenha-la em zero, que
//      e indistinguivel de "voce nao gasta nada". `temBase` carrega essa
//      diferenca para a tela, e `porDia` fica em zero para quem ignorar a flag
//      errar para o lado de nao mudar nada.
// =====================================================

import { mediana, normalizeMerchant } from "@/lib/recurrence-detector";
import { gastoDaTransacao, mesDe, mesAnterior, type TransacaoParaAnomalia } from "@/lib/anomalies";

/** Quantos meses FECHADOS a janela olha para tras, por padrao. */
export const MESES_JANELA_PADRAO = 6;

/** Teto da janela. Alem disso o "normal" vira arqueologia. */
export const MESES_JANELA_MAX = 24;

/**
 * Meses fechados COM MOVIMENTO exigidos antes de existir uma media.
 *
 * Tres, o mesmo `MIN_MESES_BASE` do lib/anomalies.ts e pelo mesmo motivo: com
 * dois, a mediana e a media dos dois e um unico mes atipico manda na regua.
 */
export const MIN_MESES_JANELA = 3;

/**
 * Dias por mes usados para converter o mensal em diario.
 *
 * 30.44 = 365.25 / 12, e nao 30. Com 30 o valor diario sai 1,5% alto e, num
 * horizonte de 90 dias, isso e mais de um dia de gasto inventado do nada --
 * pequeno, mas e erro em cima do numero pelo qual a tela existe (uma data).
 */
export const DIAS_MEDIOS_DO_MES = 30.44;

/** A transacao que este calculo le -- a mesma forma que o lib/anomalies.ts usa. */
export type TransacaoParaGastoVariavel = TransacaoParaAnomalia;

/** Um mes fechado da base, do jeito que a tela mostra a procedencia. */
export interface MesDaBase {
  /** 'YYYY-MM'. */
  mes: string;
  /** Gasto variavel daquele mes, sempre >= 0. */
  total: number;
}

export interface GastoVariavel {
  /** O que sai por dia, sem que exista uma conta pedindo. Zero quando nao ha base. */
  porDia: number;
  /** A mediana mensal que originou o `porDia`. Zero quando nao ha base. */
  porMes: number;
  /** Quantos meses fechados com movimento sustentam a mediana. */
  mesesBase: number;
  /** Ha base suficiente para desenhar a segunda linha. */
  temBase: boolean;
  /** Os meses usados, do mais antigo para o mais novo. */
  meses: MesDaBase[];
  /**
   * Quanto foi descartado por ja estar comprometido, somado na janela inteira.
   *
   * Vai para a tela junto com o numero: sem isso o usuario compara a media com
   * o proprio extrato, acha a diferenca e conclui que a conta esta errada --
   * quando ela esta certa exatamente por causa dessa diferenca.
   */
  totalComprometidoDescartado: number;
  /** Quantas chaves distintas foram descartadas. */
  chavesDescartadas: number;
}

export interface EntradaDoGastoVariavel {
  /** Transacoes da janela. Receita e `transfer` sao descartadas aqui dentro. */
  transacoes: TransacaoParaGastoVariavel[];
  /**
   * Chaves canonicas (`normalizeMerchant`) que a previsao ja projeta como
   * evento recorrente. Ver a armadilha de "excluir de mais" no cabecalho:
   * assinaturas `DETECTED`/`CONFIRMED` e regras recorrentes ativas, mais nada.
   *
   * OBRIGATORIO, mesmo que vazio: se fosse opcional, uma rota nova que
   * esquecesse de passa-lo devolveria uma media inflada pelas assinaturas --
   * sem erro de compilacao e sem sintoma na tela.
   */
  chavesComprometidas: string[];
  /** 'YYYY-MM-DD'. Injetado para o teste nao depender do calendario. */
  hoje: string;
  /** Meses fechados olhados para tras. Fora de faixa e corrigido, nao rejeitado. */
  meses?: number;
}

/** Janela efetiva: inteiro dentro de [MIN_MESES_JANELA, MESES_JANELA_MAX]. */
export function janelaValida(meses: number | undefined): number {
  const bruto = Math.floor(Number(meses ?? MESES_JANELA_PADRAO));
  if (!Number.isFinite(bruto) || bruto < MIN_MESES_JANELA) return MESES_JANELA_PADRAO;
  return Math.min(bruto, MESES_JANELA_MAX);
}

/**
 * Os meses FECHADOS da janela, do mais novo para o mais antigo.
 *
 * Comeca no mes anterior ao de `hoje` -- nunca no corrente (armadilha 2).
 * Aritmetica de string via `mesAnterior`, que e o que faz a virada de ano
 * funcionar sem `new Date` e sem fuso no meio.
 */
export function mesesFechados(hoje: string, meses: number): string[] {
  const out: string[] = [];
  let mes = mesAnterior(hoje);
  for (let i = 0; i < meses; i++) {
    out.push(mes);
    mes = mesAnterior(mes);
  }
  return out;
}

/**
 * A primeira data que a janela alcanca, 'YYYY-MM-DD'.
 *
 * E o que a rota manda para o banco como piso do filtro: sem ele a consulta
 * traria a vida inteira de transacoes do usuario para calcular seis meses.
 */
export function inicioDaJanela(hoje: string, meses?: number): string {
  const lista = mesesFechados(hoje, janelaValida(meses));
  return `${lista[lista.length - 1]}-01`;
}

/**
 * Quanto sai por dia sem que exista uma conta pedindo.
 *
 * A mediana, e nao a media, pelo mesmo motivo do lib/anomalies.ts: o mes de
 * ferias nao pode virar o novo normal. Com cinco meses em 1.500 e um em 6.000,
 * a media e 2.250 e a linha provavel passaria a mentir para baixo em todo mes
 * comum; a mediana e 1.500 e nao se move.
 */
export function calcularGastoVariavel(entrada: EntradaDoGastoVariavel): GastoVariavel {
  const { transacoes, hoje } = entrada;
  // `?? []` apesar de o campo ser obrigatorio no tipo: o teste roda o JS
  // emitido, onde o tipo nao existe mais, e um `undefined` aqui viraria
  // TypeError em vez de um numero errado.
  const comprometidas = new Set(entrada.chavesComprometidas ?? []);
  const meses = janelaValida(entrada.meses);

  const naJanela = new Set(mesesFechados(hoje, meses));

  const porMes = new Map<string, number>();
  const descartadas = new Set<string>();
  let totalComprometidoDescartado = 0;

  for (const t of transacoes) {
    // Unico lugar que toca `amount`: filtra `expense` e devolve ABS. Receita,
    // `transfer` e qualquer coisa que nao seja despesa saem com zero aqui.
    const valor = gastoDaTransacao(t);
    if (valor <= 0) continue;

    const mes = mesDe(t.transaction_date);
    // Mes corrente e mes anterior a janela caem fora pelo mesmo teste: a janela
    // so contem mes fechado, por construcao de `mesesFechados`.
    if (!naJanela.has(mes)) continue;

    const chave = normalizeMerchant(t.description ?? "");
    // Chave vazia (descricao sem nada aproveitavel) NAO e descartada: ela nao
    // pode casar com nada comprometido, e aquilo foi dinheiro que saiu. Some-la
    // e o lado certo do erro -- o contrario esconderia gasto de verdade so
    // porque a descricao do extrato veio ruim.
    if (chave && comprometidas.has(chave)) {
      descartadas.add(chave);
      totalComprometidoDescartado += valor;
      continue;
    }

    porMes.set(mes, (porMes.get(mes) ?? 0) + valor);
  }

  // Ordem crescente para a tela ler a procedencia da esquerda para a direita.
  //
  // Nao ha filtro de total zero aqui, e a ausencia e o mecanismo da armadilha 3:
  // um mes so entra no Map quando alguma despesa dele passou pelo `valor <= 0`
  // la em cima, entao mes sem movimento nao esta no Map -- nao ha zero a
  // filtrar. Um `.filter(total > 0)` aqui seria codigo que nenhum teste
  // consegue derrubar, e o proximo leitor acharia que e ELE quem fecha a
  // armadilha.
  const base: MesDaBase[] = Array.from(porMes.entries())
    .map(([mes, total]) => ({ mes, total }))
    .sort((a, b) => a.mes.localeCompare(b.mes));

  const mesesBase = base.length;
  const temBase = mesesBase >= MIN_MESES_JANELA;
  // UM lugar decide que sem base nao ha numero, e o diario deriva do mensal.
  // Repetir o `temBase ?` no `porDia` parecia prudente e nao era: os dois
  // ramos davam o mesmo resultado, entao nenhum teste conseguia derrubar a
  // segunda copia -- e uma guarda que nao pode falhar e uma guarda que o
  // proximo leitor confia a toa.
  const porMesTipico = temBase ? mediana(base.map((m) => m.total)) : 0;

  return {
    porDia: porMesTipico / DIAS_MEDIOS_DO_MES,
    porMes: porMesTipico,
    mesesBase,
    temBase,
    meses: base,
    totalComprometidoDescartado,
    chavesDescartadas: descartadas.size,
  };
}
