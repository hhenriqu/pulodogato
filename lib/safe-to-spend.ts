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
//   livre = disponivel + receitas previstas
//           - compromissos do mes - divida de cartao - reserva de metas
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
//      usar o cartao. Por isso entra a divida do cartao, e nao so a fatura
//      fechada. O que NAO entra, desde a HMO-290, e a parte dela que so vai ser
//      cobrada depois do fim do mes -- ver a armadilha 10.
//
//  10. PARCELA FUTURA DESCONTADA HOJE (HMO-290, decisao 4.1 do plano da
//      HMO-281). Ate aqui a divida de cartao entrava INTEIRA, e o fim deste
//      cabecalho registrava isso como limitacao conhecida: uma compra de
//      R$ 3.000 em 10x derrubava o "posso gastar" em R$ 3.000 no mes da compra,
//      quando aquele mes cobra R$ 300. O trigger `update_account_balance` soma
//      `NEW.amount` no INSERT sem olhar `transaction_date`, e as 10 parcelas
//      sao gravadas de uma vez.
//
//      A pergunta desta tela e "quanto este mes cobra", entao o que se desconta
//      e a divida MENOS as faturas que so vencem depois do fim do mes:
//
//        divida deste mes = max(0, divida do cartao - faturas futuras)
//
//      POR QUE SUBTRAIR O FUTURO, E NAO SOMAR A FATURA DO MES. Ler o total da
//      fatura do mes na view e usa-lo direto parece mais simples, e reabre duas
//      portas de desconto duplo que `current_balance` mantinha fechadas:
//
//        a. a fatura FECHADA E PAGA pelo fluxo do app. A baixa grava duas
//           pernas `transfer` (HMO-149, migration 015) e `card_invoice_lines`
//           filtra ('expense','income') -- a perna de pagamento NAO abate o
//           total da fatura na view, de proposito. O dinheiro ja saiu do
//           `disponivel` e a fatura continuaria inteira na view: este mes seria
//           cobrado duas vezes.
//        b. a fatura paga POR FORA do app -- a limitacao que o fim deste
//           cabecalho ja registrava. Nao ha conta prevista para dar baixa, e
//           tambem aqui a view nao se mexe.
//
//      Nos dois casos o pagamento credita o CARTAO, e portanto encolhe a divida
//      em `current_balance`. Ancorar no saldo e usar a view SO para a parte
//      diferida faz os dois se resolverem sozinhos, sem o app ter de descobrir
//      qual pagamento pagou qual fatura -- informacao que, no caso (b), nao
//      existe em lugar nenhum.
//
//      E POR ISSO A CONTA PREVISTA DA FATURA FECHADA CONTINUA FORA (`ehFatura`).
//      A exclusao da armadilha 1 segue valendo pela razao original, intacta: a
//      fatura fechada ainda esta dentro do saldo do cartao, que continua sendo a
//      ancora. Reintroduzi-la aqui seria trazer de volta o desconto duplo da
//      armadilha 1. Ha teste e mutante dedicados a este caso exato.
//
//      O PRECO, e ele e real: a compra feita depois do fechamento cai na fatura
//      do mes que vem e deixa de mexer neste numero -- a armadilha 2 ao
//      contrario. A defesa nao e aritmetica, e a tela: `dividaDiferida` sai na
//      resposta para ficar ao lado do numero. Trocar a regua sem mostrar o
//      resto transforma um numero conservador num numero otimista sem a pessoa
//      saber que a regua mudou.
//
//      `lib/net-worth.ts` NAO muda, e a assimetria e proposital (decisao 4.2):
//      dever R$ 3.000 em 10 parcelas e dever R$ 3.000 hoje, e mostrar R$ 300
//      inflaria o patrimonio em R$ 2.700. Patrimonio pergunta "quanto eu devo";
//      o posso-gastar pergunta "quanto este mes cobra".
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
//   7. RESERVA DE META DESCONTADA DUAS VEZES (HMO-155). A quinta parcela, e a
//      unica cujo erro tem a mesma forma do item 1. O aporte lancado no dia 5
//      JA saiu do saldo da conta corrente -- ele e uma transferencia comum, nao
//      um numero guardado a parte. Descontar o alvo mensal CHEIO depois dele
//      desconta o mesmo dinheiro duas vezes, e a tela diz que sobra menos do
//      que sobra. O que se desconta e o que FALTA aportar no mes:
//
//        reserva da meta = max(0, alvo do mes - ja aportado no mes)
//
//      E o alvo do mes nunca passa do que falta para a meta inteira: quem tem
//      alvo de R$ 300 e precisa de R$ 50 para fechar reserva R$ 50, nao 300.
//
//   8. META ENCERRADA QUE CONTINUA RESERVANDO. So meta `active` reserva. Uma
//      meta concluida, pausada ou cancelada com alvo mensal preenchido seria um
//      desconto fantasma -- encolheria o "posso gastar" todo mes, para sempre,
//      e nao apareceria em lugar nenhum da tela de metas, que mostra a meta
//      como encerrada.
//
//   9. PRAZO NO PASSADO. Quando o alvo do mes e derivado do prazo, o divisor e
//      o numero de meses que faltam -- que pode ser zero ou negativo numa meta
//      vencida. Piso de 1 mes, igual ao `GREATEST(d.months_left, 1)` da view
//      goal_progress: sem ele a divisao produz Infinity (ou um valor negativo),
//      e Infinity subtraido do `livre` imprime "-R$ Infinity" na tela.
//
// O que esta conta NAO sabe: fatura paga por fora do app continua `pending` na
// agenda (o saldo do cartao, sim, se corrige -- e e nele que a armadilha 10 se
// ancora justamente por isso). O parcelamento futuro SAIU desta lista na
// HMO-290: ele agora e a armadilha 10, nao uma limitacao.
//
// -----------------------------------------------------------------------
// De onde sai o alvo mensal da meta
// -----------------------------------------------------------------------
// `monthly_contribution` (coluna da 018) e a fonte da verdade. Quando ela e
// NULL e a meta tem prazo, o alvo e DERIVADO -- pela mesma formula que a view
// goal_progress publica em `monthly_required`, que e o numero que a tela de
// metas ja mostra ao usuario. Duas formulas diferentes para o mesmo "voce
// precisa de X por mes" seriam duas versoes da mesma regra. Sem valor e sem
// prazo, a meta reserva zero: nao ha o que inferir, e inventar um alvo
// encolheria o numero sem o usuario ter pedido nada.
//
// Meta de GRUPO fica de fora, e a rota e quem filtra (`group_id IS NULL`): o
// alvo mensal de uma meta de grupo e do grupo, e descontar o valor cheio da
// carteira de cada membro faria tres pessoas reservarem R$ 900 para uma meta de
// R$ 300 por mes. Ver o cabecalho da migration 018.
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
  /**
   * 'expense' | 'income'. Ausente = despesa.
   *
   * QUEM PREENCHE ISTO TEM DE PASSAR POR `direcaoDaAgenda` (HMO-308), que le a
   * coluna `direction` da view `scheduled_transactions_effective`. O default
   * "ausente = despesa" e o lado seguro para uma linha sem direcao, mas foi
   * tambem a porta do defeito da HMO-308: a rota deduzia a direcao do tipo da
   * REGRA, previsao avulsa nao tem regra, e R$ 6.200,00 de receita prevista
   * entravam aqui como `expense`.
   *
   * O ERRO E DUPLO, e e por isso que ele vale ser lido antes de mexer no laco
   * abaixo: `tipo` decide as DUAS somas. Uma receita marcada como despesa soma
   * em `compromissos` E deixa de somar em `receitasPrevistas` -- as duas metades
   * erram para o mesmo lado, e o app diz que sobra menos do que sobra.
   */
  tipo?: string | null;
  notes?: string | null;
}

/**
 * Uma fatura daquele cartao, do jeito que a view `card_invoice_lines` agrega.
 *
 * So as faturas que podem ser FUTURAS importam aqui -- a rota filtra por
 * `invoice_month >= mes corrente`, e o filtro e suficiente: o vencimento de uma
 * fatura e, no maximo, no mes seguinte ao dela (`card_invoice_due_date` empurra
 * um mes quando o vencimento vem antes do fechamento), entao fatura de mes
 * passado nunca vence depois do fim deste mes.
 */
export interface FaturaParaGastar {
  /** O cartao. */
  account_id: string;
  /** Primeiro dia do mes da fatura, 'AAAA-MM-01'. */
  invoice_month: string;
  /**
   * Vencimento da fatura, 'AAAA-MM-DD'. `null` quando o cartao nao tem
   * `due_day` -- e `card_invoice_due_date` devolve NULL nesse caso.
   */
  due_date?: string | null;
  /** Soma de `invoice_amount` daquela fatura: compras menos estornos. */
  total: number | string;
}

export interface CartaoNoCalculo {
  id: string;
  name: string;
  /**
   * Quanto ESTE MES cobra deste cartao, sempre >= 0 (armadilha 10).
   *
   * Nao e mais a divida inteira: e `max(0, divida - faturas futuras)`.
   */
  divida: number;
  /**
   * A parte da divida que so sera cobrada depois do fim do mes, sempre >= 0.
   *
   * Existe para a tela poder mostra-la ao lado do numero. Sem ela a troca da
   * armadilha 10 seria so um numero maior, sem a pessoa saber que a regua
   * mudou. `divida + diferida` nunca passa da divida do cartao.
   */
  diferida: number;
}

/**
 * Uma meta do jeito que a view `goal_progress` entrega, mais o que o usuario ja
 * aportou nela NESTE mes.
 *
 * `aportadoNoMes` nao vem da view de proposito: a view decidiria "que mes e
 * hoje" com o `CURRENT_DATE` do Postgres, e a rota decide com o `today()` do
 * app. Na virada do mes os dois discordam por algumas horas (o servidor do
 * banco nao esta no fuso de Sao Paulo), e o preco dessa discordancia e
 * exatamente a armadilha 7: a soma viria do mes errado, daria zero, e o alvo
 * cheio seria descontado de novo por cima de um aporte ja feito. Uma fonte so
 * para "que mes e hoje", e ela e a mesma que o resto do calculo usa.
 */
export interface MetaParaGastar {
  id: string;
  title: string;
  /** 'active' | 'completed' | 'paused' | 'cancelled' -- so 'active' reserva. */
  status: string;
  target_amount: number | string;
  /** Soma dos aportes de todos os tempos (coluna `saved` da view). */
  saved?: number | string | null;
  /** 'YYYY-MM-DD' ou null. Usado so quando nao ha alvo explicito. */
  target_date?: string | null;
  /** O alvo escolhido pelo usuario (coluna da 018). NULL = nao escolheu. */
  monthly_contribution?: number | string | null;
  /** Quanto o usuario ja aportou nesta meta dentro do mes corrente. */
  aportadoNoMes?: number | string | null;
}

export interface MetaNoCalculo {
  id: string;
  title: string;
  /** Alvo do mes, ja limitado ao que falta para fechar a meta. */
  alvoMensal: number;
  /** Quanto ja foi aportado neste mes. */
  aportado: number;
  /** O que ainda vai ser separado: max(0, alvoMensal - aportado). */
  reserva: number;
  /** true quando o alvo veio do prazo, nao de um valor escolhido. */
  derivado: boolean;
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
  /**
   * Quanto os cartoes cobram NESTE MES: fatura fechada + periodo aberto que
   * vence ate o fim do mes. Nao inclui parcela futura (armadilha 10).
   */
  dividaDeCartao: number;
  /**
   * A divida de cartao que so vai ser cobrada depois do fim do mes.
   *
   * NAO entra no `livre` -- esta aqui para a tela mostrar ao lado dele.
   */
  dividaDiferida: number;
  /** O que ainda falta separar para as metas ativas neste mes. */
  reservaDeMetas: number;
  /** O numero da tela. Pode ser negativo. */
  livre: number;
  /** Verba diaria. 0 quando `livre` <= 0 -- ver armadilha 6. */
  porDia: number;
  cartoes: CartaoNoCalculo[];
  /** Metas que reservam alguma coisa, da maior reserva para a menor. */
  metas: MetaNoCalculo[];
}

export interface EntradaDoCalculo {
  contas: ContaParaGastar[];
  previstas: PrevistaParaGastar[];
  /**
   * Metas do usuario. OBRIGATORIO, mesmo que vazio: se fosse opcional, uma
   * rota nova que esquecesse de passar as metas devolveria um "posso gastar"
   * maior do que o real, sem erro de compilacao e sem sintoma na tela.
   */
  metas: MetaParaGastar[];
  /**
   * As faturas dos cartoes, para separar o que este mes cobra do que so vence
   * depois (armadilha 10). OBRIGATORIO, mesmo que vazio, pela mesma razao de
   * `metas`: opcional, uma rota que esquecesse de passa-las voltaria a
   * descontar a divida inteira -- sem erro de compilacao e sem sintoma na tela,
   * porque o numero menor tambem e plausivel.
   */
  faturas: FaturaParaGastar[];
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
 * Meses que faltam ate o mes do prazo, com piso de 1.
 *
 * Copia deliberada do `months_left` da view goal_progress combinado com o
 * `GREATEST(d.months_left, 1)` que o `monthly_required` dela aplica na divisao
 * -- e o que faz o desconto bater com o "voce precisa de R$ X por mes" que a
 * tela de metas ja mostra.
 *
 * O grao e MES, nao dia: prazo em 30/11 e prazo em 01/11 dao o mesmo numero,
 * porque a pergunta e "quantas vezes eu ainda separo dinheiro", e se separa uma
 * vez por mes. Prazo no mes corrente ou vencido cai no piso 1 (armadilha 9).
 */
export function mesesAteOAlvo(hoje: string, alvo: string): number {
  const [anoHoje, mesHoje] = hoje.split("-").map(Number);
  const [anoAlvo, mesAlvo] = alvo.split("-").map(Number);
  const cheios = (anoAlvo - anoHoje) * 12 + (mesAlvo - mesHoje);
  return Math.max(1, cheios);
}

/**
 * O dia em que a fatura e cobrada (armadilha 10).
 *
 * `due_date` e a resposta quando ela existe: e a data que o
 * `card_invoice_due_date` (006) calculou, e e a MESMA data que
 * `POST /api/card-invoices/close` grava na conta prevista da fatura. Usar a
 * mesma data dos dois lados e o que mantem a exclusao do `ehFatura` exata.
 *
 * Sem `due_date` o cartao nao tem `due_day` -- ele nao fecha fatura, e a tela
 * de cartoes ja avisa isso numa tarja. O recuo e o ULTIMO dia do mes da fatura.
 * O que importa na escolha e so o MES: quem le isto compara com o fim do mes
 * corrente, e qualquer dia dentro do mes da fatura responde igual. O ultimo dia
 * e o mais tarde que aquela fatura poderia ser cobrada dentro do mes dela, e
 * nenhum teste distingue esse dia do primeiro -- nao ha mutante para essa
 * escolha porque ela nao tem consequencia aqui. O que TERIA consequencia e
 * recuar para o mes seguinte: isso empurraria para "futura" uma fatura que o
 * mes cobra, e esse lado tira dinheiro do desconto.
 *
 * `due_date` ilegivel cai no mesmo recuo, e nao na comparacao direta: a
 * comparacao e de string, entao um texto qualquer ("amanha") sai MAIOR que
 * qualquer data ISO e a fatura viraria "futura" -- deixando de ser descontada
 * por causa de um campo que ninguem conseguiu ler.
 */
export function cobrancaDaFatura(fatura: FaturaParaGastar): string | null {
  if (fatura.due_date && /^\d{4}-\d{2}-\d{2}$/.test(fatura.due_date)) {
    return fatura.due_date;
  }
  if (!/^\d{4}-\d{2}/.test(fatura.invoice_month ?? "")) return null;
  return fimDoMes(`${fatura.invoice_month.slice(0, 7)}-01`);
}

/**
 * Quanto de cada cartao so e cobrado DEPOIS de `ate`, por `account_id`.
 *
 * O estorno de um mes futuro nao abate nada aqui (`total <= 0` sai): uma fatura
 * futura NEGATIVA diminuiria o valor diferido e, por consequencia, aumentaria o
 * que este mes cobra -- descontando hoje um credito que so chega depois. Uma
 * fatura futura so pode ADIAR dinheiro, nunca trazer dinheiro para ca.
 *
 * Fatura sem mes legivel fica de fora: sem saber quando ela e cobrada, trata-la
 * como futura reduziria o desconto por causa de um dado que nao deu para ler.
 */
export function faturasFuturasPorCartao(
  faturas: FaturaParaGastar[],
  ate: string
): Map<string, number> {
  const porCartao = new Map<string, number>();

  for (const fatura of faturas ?? []) {
    if (!fatura?.account_id) continue;

    const cobranca = cobrancaDaFatura(fatura);
    if (!cobranca) continue;
    if (cobranca <= ate) continue;

    const total = numero(fatura.total);
    if (total <= 0) continue;

    porCartao.set(fatura.account_id, (porCartao.get(fatura.account_id) ?? 0) + total);
  }

  return porCartao;
}

/**
 * Quanto esta meta ainda vai consumir do dinheiro deste mes.
 *
 * As armadilhas 7, 8 e 9 do cabecalho moram todas aqui.
 */
export function reservaDaMeta(
  meta: MetaParaGastar,
  hoje: string
): MetaNoCalculo {
  const aportado = Math.max(0, numero(meta.aportadoNoMes));
  const zerada: MetaNoCalculo = {
    id: meta.id,
    title: meta.title,
    alvoMensal: 0,
    aportado,
    reserva: 0,
    derivado: false,
  };

  // Armadilha 8: meta encerrada nao reserva. `status` e o que o usuario
  // controla -- o `progress_status` da view diz 'reached' sozinho quando os
  // aportes alcancam o alvo, e esse caso ja cai no `falta === 0` abaixo.
  if (meta.status !== "active") return zerada;

  const falta = Math.max(0, numero(meta.target_amount) - numero(meta.saved));
  const explicito = numero(meta.monthly_contribution);
  let alvoMensal: number;
  let derivado: boolean;

  if (explicito > 0) {
    alvoMensal = explicito;
    derivado = false;
  } else if (meta.target_date) {
    alvoMensal = falta / mesesAteOAlvo(hoje, meta.target_date);
    derivado = true;
  } else {
    // Sem valor escolhido e sem prazo nao ha o que derivar.
    return zerada;
  }

  // Nunca reservar mais do que falta para fechar a meta: alvo de R$ 300 com
  // R$ 50 faltando reserva R$ 50. Sem este teto o app cobraria do usuario, todo
  // mes, um dinheiro que a meta ja nao precisa.
  //
  // Este teto e TAMBEM o que trata a meta ja atingida (`falta === 0`), e por
  // isso nao existe um `if (falta <= 0)` acima. Havia um: nenhuma mutacao
  // conseguia deixa-lo vermelho, porque `Math.min(alvo, 0)` ja e 0 nos dois
  // caminhos -- explicito e derivado. Guarda que nenhum teste distingue e
  // guarda que apodrece sem ninguem notar.
  alvoMensal = Math.min(alvoMensal, falta);

  // Armadilha 7: o aporte deste mes JA saiu do saldo da conta. Desconta-se o
  // que FALTA aportar, nunca o alvo cheio -- e nunca um numero negativo, que
  // aumentaria o "posso gastar" de quem aportou a mais.
  const reserva = Math.max(0, alvoMensal - aportado);

  return { id: meta.id, title: meta.title, alvoMensal, aportado, reserva, derivado };
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
  // `?? []` apesar de o campo ser obrigatorio no tipo: os testes rodam o JS
  // emitido, onde o tipo nao existe mais, e um `undefined` aqui viraria
  // TypeError em vez de um numero errado.
  const metasDeEntrada = entrada.metas ?? [];
  const ate = fimDoMes(hoje);
  const diasRestantes = diasRestantesNoMes(hoje);

  // Armadilha 10: o que cada cartao so cobra depois do fim do mes.
  const futurasPorCartao = faturasFuturasPorCartao(entrada.faturas ?? [], ate);

  let disponivel = 0;
  const cartoes: CartaoNoCalculo[] = [];

  for (const conta of contas) {
    const classe = classificarConta(String(conta.account_type));
    const saldo = numero(conta.current_balance);

    if (classe === "divida") {
      // Saldo positivo num cartao (estorno maior que as compras) nao e divida
      // negativa: e zero de divida. Somar o positivo aqui aumentaria o "posso
      // gastar" por causa de um credito que so existe dentro do cartao.
      const dividaTotal = saldo < 0 ? -saldo : 0;

      // Armadilha 10. O teto da divida total e o que faz o pagamento da fatura
      // -- pelo app ou por fora dele -- se resolver sozinho: ele credita o
      // cartao, a divida encolhe, e o diferido nao pode comer mais do que ha.
      const diferida = Math.min(
        Math.max(0, futurasPorCartao.get(conta.id) ?? 0),
        dividaTotal
      );

      cartoes.push({
        id: conta.id,
        name: conta.name,
        divida: dividaTotal - diferida,
        diferida,
      });
      continue;
    }

    // Investimento fica fora: nao e dinheiro disponivel (armadilha 3).
    if (classe !== "liquido") continue;

    // Arquivada fica fora: nao e de onde se gasta (armadilha 4).
    if (conta.is_active === false) continue;

    disponivel += saldo;
  }

  const dividaDeCartao = cartoes.reduce((s, c) => s + c.divida, 0);
  const dividaDiferida = cartoes.reduce((s, c) => s + c.diferida, 0);

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

  const metas = metasDeEntrada
    .map((m) => reservaDaMeta(m, hoje))
    .filter((m) => m.reserva > 0)
    .sort((a, b) => b.reserva - a.reserva);

  const reservaDeMetas = metas.reduce((s, m) => s + m.reserva, 0);

  const livre =
    disponivel +
    receitasPrevistas -
    compromissos -
    dividaDeCartao -
    reservaDeMetas;

  cartoes.sort((a, b) => b.divida - a.divida);

  return {
    ate,
    diasRestantes,
    disponivel,
    receitasPrevistas,
    compromissos,
    compromissosVencidos,
    dividaDeCartao,
    dividaDiferida,
    reservaDeMetas,
    livre,
    porDia: livre > 0 ? livre / diasRestantes : 0,
    cartoes,
    metas,
  };
}
