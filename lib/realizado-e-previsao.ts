// -----------------------------------------------------------------------------
// REALIZADO, PREVISAO E TOTAL ESPERADO (HMO-174)
// -----------------------------------------------------------------------------
// A moldura que o Helio pediu em HMO-145: "uma previsao de quanto ainda vou
// gastar ou ganhar esse mes e o quanto ja ganhei e ja gastei". Para o periodo
// escolhido, cada lado -- receita e despesa -- vira TRES numeros:
//
//   Realizado      o que ja aconteceu
//   Previsao       o que ainda vai acontecer ate o fim do periodo
//   Total esperado a soma dos dois
//
// A propriedade que define a feature e uma so: REALIZADO + PREVISAO = TOTAL
// ESPERADO. Se as parcelas nao somam o total, os tres numeros estao errados
// juntos -- e nenhum deles parece errado sozinho.
//
// -----------------------------------------------------------------------------
// ESTE ARQUIVO NAO E O lib/previsto-x-realizado.ts, E A DIFERENCA E TUDO
// -----------------------------------------------------------------------------
// Os dois modulos tem quase o mesmo nome e respondem perguntas OPOSTAS. Quem
// confundir um pelo outro nao recebe erro nenhum: recebe seis numeros
// plausiveis e uma conclusao falsa sobre o proprio dinheiro.
//
//   lib/previsto-x-realizado.ts  -> VARIANCIA. "o mes cumpriu o que prometia?"
//     Os dois lados COBREM O MESMO periodo inteiro e se SOBREPOEM de proposito:
//     a conta de R$ 500 paga no dia 5 esta no previsto (estava na agenda) E no
//     realizado (saiu). Contar nos dois lados e o certo la -- e a definicao de
//     aderencia ao plano.
//
//   este arquivo                 -> MOLDURA. "quanto ainda falta acontecer?"
//     Os dois lados sao DISJUNTOS e somam o total. A mesma conta de R$ 500 paga
//     no dia 5 aparece SO em Realizado. Se ela aparecesse tambem em Previsao, o
//     total esperado sairia R$ 500 alto e o usuario acreditaria ter menos
//     dinheiro do que tem.
//
// A mesma armadilha existe no banco: a view `planned_vs_actual` (008) e a rota
// /api/reports/planned-vs-actual tem o nome exato desta feature e servem a
// OUTRA. `planned_expense` e `SUM(s.amount)` de TODAS as `scheduled_transactions`
// do mes com `status <> 'cancelled'` -- inclui as PAGAS. Verdadeiro para
// variancia, falso aqui. Nada neste arquivo pode sair de la.
//
// -----------------------------------------------------------------------------
// COMO OS DOIS LADOS FICAM DISJUNTOS: POR FONTE, NAO POR DATA
// -----------------------------------------------------------------------------
// As duas janelas se TOCAM em `hoje` (ver `janelaDoRealizado` e
// `janelaDaPrevisao`), e isso nao duplica nada. O que separa as parcelas nao e
// a data, e a FONTE:
//
//   Realizado -> `financial_transactions` (via /api/reports/cash-flow). Existe
//                porque o dinheiro ja se mexeu.
//   Previsao  -> agenda PENDENTE mais recorrencia detectada, deduplicadas pelo
//                lib/cash-flow-forecast.ts. Existe porque o dinheiro ainda NAO
//                se mexeu.
//
// Uma conta prevista paga vira transacao e deixa de ser pendente no mesmo ato:
// ela troca de lado, nunca fica nos dois. Fosse a data o criterio, a conta
// vencida (que o forecast traz para hoje) e a transacao lancada hoje brigariam
// pelo mesmo dia -- e uma das duas teria de sumir.
//
// -----------------------------------------------------------------------------
// "REALIZADO" NAO E O PERIODO INTEIRO
// -----------------------------------------------------------------------------
// `monthly_cash_flow` agrega o mes todo por `transaction_date`, sem comparar
// com hoje. Transacao lancada com data FUTURA dentro do mes corrente -- que a
// materializacao de recorrencia cria exatamente assim (HMO-170, HMO-172) --
// entrava em "ja gastei" antes de acontecer. Dai `janelaDoRealizado` cortar em
// `hoje`: em periodo inteiramente passado o corte e inocuo, e em periodo futuro
// ele zera o Realizado, que e a resposta certa.
//
// -----------------------------------------------------------------------------
// O GASTO VARIAVEL FICA FORA DOS SEIS NUMEROS
// -----------------------------------------------------------------------------
// Decisao de produto do Helio em 2026-09-29 (interaction em HMO-145, opcao
// "separado"): Previsao leva SOMENTE o comprometido -- conta prevista pendente
// e recorrencia detectada, ja deduplicadas. A media de gasto variavel do
// lib/variable-spend.ts entra como LINHA SEPARADA, visivel e editavel, e nunca
// dentro do numero de Previsao.
//
// A garantia disso aqui e estrutural, nao um comentario: `montarPainel` nao
// recebe a estimativa variavel. Nao ha parametro por onde ela entrar. Quem
// quiser soma-la tem que mudar a assinatura, e ai o teste de identidade quebra.
//
// Isso honra o cabecalho do lib/variable-spend.ts -- a media "so pode entrar na
// conta se ela aparecer na tela e puder ser mudada la" -- e mantem a identidade
// calculada apenas sobre valores conferiveis.
//
// -----------------------------------------------------------------------------
// O SINAL, E AS TRES CONVENCOES QUE ALIMENTAM O MESMO TILE
// -----------------------------------------------------------------------------
// Aqui dentro TODO numero e POSITIVO, nos seis. Quem entrega precisa saber de
// qual convencao esta vindo:
//
//   * `financial_transactions.amount`   -> despesa NEGATIVA no banco;
//     `monthly_cash_flow.expense` ja chega POSITIVO (a rota aplica o ABS).
//   * `scheduled_transactions.amount`   -> sempre POSITIVO (CHECK do 005); a
//     direcao vem da coluna `direction` da view do 027, nunca do sinal.
//   * `DiaDoFluxo.entra` / `.sai` do lib/cash-flow-forecast.ts -> os dois
//     POSITIVOS, ja separados por lado.
//
// Transferencia fica fora dos DOIS lados -- ver `direcaoNoPainel`. Mover
// dinheiro entre contas proprias nao e receita nem despesa.
//
// A FATURA DO CARTAO ficava fora dos dois e passou a entrar nos dois (HMO-265):
// como despesa prevista no lado da Previsao, e como despesa realizada no lado do
// Realizado -- la pelo PAGAMENTO dela, nunca pelas compras, que saem. Quem a tira
// de um lado tem de a por no outro no mesmo movimento; nos dois ao mesmo tempo e
// o cartao em dobro, em nenhum e o cartao desaparecido.
//
// Tudo aqui e funcao pura: nao le banco, nao pede login, nao grava. Mesmo
// desenho do lib/previsto-x-realizado.ts e do lib/safe-to-spend.ts.
// -----------------------------------------------------------------------------

// A aritmetica de data sai do lib/recurrence-detector.ts, que a resolve em UTC
// puro. Uma segunda implementacao aqui -- `new Date(iso)` no fuso local --
// erraria por um dia na virada do mes em Sao Paulo, que foi o defeito que a
// HMO-173 tirou do painel.
import { addDays, diasEntre } from "@/lib/recurrence-detector";

/** Um intervalo fechado nos dois extremos, em 'AAAA-MM-DD'. */
export interface Janela {
  de: string;
  ate: string;
}

/** O periodo escolhido no painel. Mesmo formato de lib/periodo-do-painel.ts. */
export interface PeriodoEscolhido {
  de: string;
  ate: string;
}

/** Centavos, sem o ruido de ponto flutuante acumulado na soma. */
const centavos = (valor: number) => Number(valor.toFixed(2));

const numero = (valor: number | string | null | undefined): number => {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * A fatia do periodo em que algo pode JA ter acontecido: `[de, min(ate, hoje)]`.
 *
 * `null` quando o periodo inteiro esta no futuro -- e ai Realizado e zero, nao
 * "nao sei". Devolver uma janela invertida (`de > ate`) seria pior que null: a
 * rota de relatorio responde 400 a `de > ate`, e o painel mostraria um tile
 * vazio onde a resposta certa e um zero explicado.
 *
 * O corte e em `hoje` INCLUSIVE porque o que foi lancado hoje ja aconteceu.
 */
export function janelaDoRealizado(
  periodo: PeriodoEscolhido,
  hoje: string
): Janela | null {
  if (periodo.de > hoje) return null;
  const ate = periodo.ate < hoje ? periodo.ate : hoje;
  return { de: periodo.de, ate };
}

/**
 * A fatia do periodo em que algo ainda pode acontecer: `[max(de, hoje), ate]`.
 *
 * `null` quando o periodo inteiro ja passou -- Previsao e zero, e o tile diz
 * isso com todas as letras em vez de esconder a linha.
 *
 * Comeca em `hoje` e nao em amanha porque a conta que vence HOJE e ainda nao
 * foi paga continua sendo dinheiro que vai sair. Ela nao esta no Realizado (nao
 * virou transacao), entao sem este dia inclusive ela sumiria dos dois lados --
 * e o total esperado ficaria menor que a verdade, que e o pior lado do erro.
 */
export function janelaDaPrevisao(
  periodo: PeriodoEscolhido,
  hoje: string
): Janela | null {
  if (periodo.ate < hoje) return null;
  const de = periodo.de > hoje ? periodo.de : hoje;
  return { de, ate: periodo.ate };
}

/**
 * Para que lado do painel uma linha da agenda vai -- ou `null` para ficar fora
 * dos dois.
 *
 * `direction` vem da coluna homonima de `scheduled_transactions_effective`
 * (027), que ja resolveu a precedencia ocorrencia -> regra -> default. O enum
 * `transaction_financial_type` tem TRES valores, e o terceiro e o perigoso:
 *
 *   * 'transfer' fica FORA. Mover dinheiro entre contas proprias nao e receita
 *     nem despesa -- a mesma regra que `category_monthly_totals` aplica do lado
 *     do realizado. Sem esta linha, o lado da Previsao contaria uma
 *     transferencia que o lado do Realizado ignora, e a identidade continuaria
 *     fechando: seriam os DOIS numeros errados de um jeito coerente.
 *
 *   * FATURA DE CARTAO ENTRA, e ate a HMO-265 ela ficava fora.
 *
 * A FATURA TROCOU DE LADO, E O PARAMETRO `ehFatura` SAIU DAQUI (HMO-265)
 * ----------------------------------------------------------------------
 * O argumento antigo era coerente e a premissa dele morreu: "cada compra do
 * cartao JA entrou como despesa no dia em que aconteceu, somar a fatura por
 * cima cobraria as mesmas compras duas vezes". Depois da HMO-265 a compra no
 * cartao NAO entra mais no Realizado do painel -- quem conta e a fatura, pelo
 * valor total do cartao, no periodo em que ela foi paga
 * (lib/realizado-do-caixa.ts). Com a compra fora do Realizado, manter a fatura
 * fora da Previsao faria o cartao desaparecer dos DOIS lados: um mes com
 * R$ 1.290 de fatura a vencer sairia R$ 1.290 mais barato no "Total esperado",
 * e um total menor nao parece erro -- parece um mes barato.
 *
 * A contrapartida obrigatoria mora na rota, nao aqui: ela tem de tirar da agenda
 * as COMPRAS no cartao (`agendaSemCompraNoCartao`) antes de chamar esta funcao.
 * Sem isso a parcela da compra e a fatura que a contem entram as duas, e o
 * cartao volta a contar duas vezes -- agora do lado da Previsao. Ver o cabecalho
 * de app/api/dashboard/previsao/route.ts.
 *
 * O parametro foi REMOVIDO em vez de passar a receber `false`: um booleano que
 * so pode ter um valor e uma guarda inalcancavel, e uma guarda inalcancavel
 * passa em qualquer teste. Quem tentar reviver a exclusao vai ter de mudar a
 * assinatura, e ai o chamador aparece no diff.
 *
 * Direcao desconhecida cai em despesa, o default historico de /api/projection e
 * do lib/safe-to-spend.ts -- ler uma despesa como receita mostraria "vou
 * receber" sobre uma conta a pagar.
 */
export type DirecaoNoPainel = "income" | "expense" | null;

export function direcaoNoPainel(
  direction: string | null | undefined
): DirecaoNoPainel {
  if (direction === "transfer") return null;
  if (direction === "income") return "income";
  return "expense";
}

/**
 * Um dia da linha do tempo do lib/cash-flow-forecast.ts.
 *
 * Estrutural de proposito, em vez de importar `DiaDoFluxo`: o que este modulo
 * precisa saber da previsao sao tres campos, e depender do tipo inteiro
 * arrastaria o forecast para dentro do build do teste sem nenhum ganho.
 * `entra` e `sai` sao os DOIS positivos la.
 */
export interface DiaDaLinha {
  data: string;
  entra: number | string;
  sai: number | string;
}

export interface LadosDoPeriodo {
  receita: number;
  despesa: number;
}

/**
 * Soma a linha do tempo ja deduplicada dentro da janela da Previsao.
 *
 * A deduplicacao -- a mesma cobranca existindo como conta prevista E como
 * recorrencia detectada -- ja aconteceu quando `projetarFluxoDeCaixa` montou
 * esta linha (armadilha 1 do cabecalho dele, com teste proprio). Esta funcao
 * nao pode refazer nenhum `SUM` sobre as fontes cruas: somar as duas cobraria a
 * Netflix duas vezes, e o numero continuaria plausivel.
 *
 * Janela `null` devolve zeros, nao uma soma da linha inteira: periodo passado
 * nao tem previsao, e somar o horizonte inteiro ali colocaria as contas de
 * novembro dentro do total esperado de agosto.
 */
export function somarLinhaNaJanela(
  linha: DiaDaLinha[],
  janela: Janela | null
): LadosDoPeriodo {
  if (!janela) return { receita: 0, despesa: 0 };

  let receita = 0;
  let despesa = 0;

  for (const dia of linha) {
    const data = String(dia.data);
    // Comparacao de string em ISO 'AAAA-MM-DD' ordena como data. Passar por
    // `new Date` aqui reintroduziria o fuso que a HMO-173 tirou do painel.
    if (data < janela.de || data > janela.ate) continue;
    receita += Math.abs(numero(dia.entra));
    despesa += Math.abs(numero(dia.sai));
  }

  return { receita: centavos(receita), despesa: centavos(despesa) };
}

/** Os tres numeros de um lado do painel. Todos POSITIVOS. */
export interface LadoDoPainel {
  realizado: number;
  previsao: number;
  /** `realizado + previsao`. Nunca uma terceira consulta. */
  total: number;
}

/**
 * Os tres numeros de um lado.
 *
 * `total` e a SOMA das duas parcelas, e nao um agregado proprio. Um terceiro
 * numero vindo de outra fonte quebraria a unica propriedade que esta feature
 * promete no dia em que as duas fontes discordassem -- e discordar e o normal:
 * uma delas conta a conta paga, a outra nao.
 *
 * O `Math.abs` nao e paranoia sobre as convencoes de sinal: sao TRES entrando
 * neste mesmo tile (ver o cabecalho), e um negativo escapando aqui viraria uma
 * despesa que DIMINUI o total esperado.
 */
export function montarLado(realizado: number, previsao: number): LadoDoPainel {
  const r = centavos(Math.abs(numero(realizado)));
  const p = centavos(Math.abs(numero(previsao)));
  return { realizado: r, previsao: p, total: centavos(r + p) };
}

export interface PainelDoPeriodo {
  receita: LadoDoPainel;
  despesa: LadoDoPainel;
}

/**
 * Os seis numeros do painel.
 *
 * NAO recebe a estimativa de gasto variavel, e essa ausencia e a feature: e o
 * que impede a media de entrar em Previsao sem ninguem notar. A estimativa
 * viaja ao lado, em `estimativaVariavel`, e a tela a desenha como linha
 * propria.
 */
export function montarPainel(
  realizado: LadosDoPeriodo,
  previsao: LadosDoPeriodo
): PainelDoPeriodo {
  return {
    receita: montarLado(realizado.receita, previsao.receita),
    despesa: montarLado(realizado.despesa, previsao.despesa),
  };
}

/** A linha separada do gasto variavel. Nunca somada nos seis numeros acima. */
export interface EstimativaVariavel {
  /** O valor por dia que a tela mostra e deixa editar. */
  porDia: number;
  /** Quantos dias do periodo ainda estao por vir. */
  dias: number;
  /** `porDia * dias`. O numero que a linha imprime. */
  total: number;
}

/**
 * Quanto de gasto variavel ainda cabe no periodo, como linha separada.
 *
 * Os dias sao os da janela da PREVISAO, nao os do periodo: em agosto de 2026 o
 * gasto variavel que ainda vai acontecer e zero, e multiplicar a media pelos 31
 * dias do mes desenharia uma estimativa sobre um mes que ja aconteceu.
 *
 * O primeiro dia contado e AMANHA. O mesmo criterio do lib/cash-flow-forecast.ts
 * e pela mesma razao: o que a pessoa gastou hoje e lancou ja esta em Realizado,
 * e cobrar o dia cheio de hoje por cima disso conta parte do dia duas vezes.
 * Em periodo FUTURO nao ha o que descontar -- a janela inteira conta.
 *
 * `porDia` negativo vira zero em vez de virar receita: e o mesmo saneamento do
 * `gastoDiarioValido`, e neste repositorio -- onde despesa e gravada NEGATIVA
 * -- um sinal trocado chegando aqui e questao de tempo.
 */
export function estimativaVariavel(
  porDia: number | null | undefined,
  janela: Janela | null,
  hoje: string
): EstimativaVariavel {
  const taxa = numero(porDia);
  const saneado = Number.isFinite(taxa) && taxa > 0 ? taxa : 0;

  if (!janela) return { porDia: saneado, dias: 0, total: 0 };

  // `janela.de` e `max(periodo.de, hoje)`. Quando ele E hoje, o primeiro dia
  // cobrado e o seguinte; quando o periodo comeca no futuro, ele proprio conta.
  const primeiro = janela.de > hoje ? janela.de : addDays(janela.de, 1);
  if (primeiro > janela.ate) {
    return { porDia: saneado, dias: 0, total: 0 };
  }

  const dias = diasEntre(primeiro, janela.ate) + 1;
  return {
    porDia: saneado,
    dias,
    total: centavos(saneado * dias),
  };
}
