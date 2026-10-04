// -----------------------------------------------------------------------------
// UMA TELA PARA CADA MOVIMENTACAO (HMO-246)
// -----------------------------------------------------------------------------
// "Financas pessoais deve ser uma grande lista de transacoes e lancamentos
// indiferente do que for. Devemos ter uma tela apenas para receitas, uma apenas
// para despesas e uma para transferencia. Essas telas devem contar apenas com
// Total, Previsto, Realizado e exibir os lancamentos que estiverem naquele
// periodo."
//
// Tres telas, tres numeros cada, e o periodo escolhido na URL. Este arquivo e
// quem decide o que entra em cada numero -- as telas so desenham.
//
// POR QUE A ARITMETICA NAO MORA NA ROTA NEM NO JSX
// -----------------------------------------------
// Porque ela tem cinco armadilhas, e as cinco produzem um numero PLAUSIVEL.
// Nenhuma delas levanta excecao, nenhuma aparece em tsc, e quatro delas deixam a
// lista ao lado do total visivelmente correta -- o que faz a leitura natural ser
// "o total esta certo, eu e que nao entendi".
//
//   1. OS DOIS LADOS TEM SINAL OPOSTO. `financial_transactions.amount` de
//      despesa e NEGATIVO; `scheduled_transactions.amount` tem CHECK (> 0).
//      Somar cru faz a conta prevista de R$ 159,90 CANCELAR a despesa realizada
//      de R$ 159,90, e a tela de Despesas fecha o mes em R$ 0,00 com as duas
//      linhas na lista logo abaixo. `valorEmReais` e o unico lugar que le
//      `amount`, e ele faz `Math.abs` ANTES da cotacao.
//
//   2. A MESMA CONTA CONTADA DUAS VEZES. A conta prevista que recebeu baixa JA
//      virou linha de `financial_transactions` -- ou seja, ela ja esta no lado
//      REALIZADO desta mesma tela. Somar o `paid` do lado previsto dobra o
//      valor. A exclusao mora em `linhaPrevista`, e nao num
//      `.neq("status", "paid")` da consulta, para ter teste: um filtro de
//      consulta trocado numa refatoracao nao quebra assercao nenhuma.
//
//   3. A TRANSFERENCIA TEM DUAS PERNAS. Ela e gravada em DUAS linhas (015):
//      `-total` na conta que paga, `+total` na que recebe, com a MESMA
//      `transaction_date`. Contar as duas faz a tela de Transferencias dizer
//      R$ 2.000 de um Pix de R$ 1.000 -- e o numero continua "fechando" com a
//      lista, porque a lista tambem mostra as duas. `ehPernaDeEntrada` tira uma.
//
//   4. O SINAL NAO PODE SER O CRITERIO DE TIPO. A perna de saida de uma
//      transferencia e negativa e tem categoria de despesa: pelo sinal ela e
//      indistinguivel de um gasto. Quem filtrasse a tela de Despesas por
//      `amount < 0` poria todo Pix entre contas proprias no total de despesas do
//      mes. O tipo sai de `classificarMovimentacao` (lib/movimentacoes.ts) no
//      lado realizado e de `direction` da view no lado previsto -- nunca do
//      sinal, que o `Math.abs` da armadilha 1 apagou.
//
//   5. O GASTO NO CARTAO JA ESTA NA FATURA (HMO-260). O lado PREVISTO desta tela
//      tira a compra no cartao da agenda (`agendaSemCompraNoCartao`) e poe no
//      lugar a FATURA ABERTA inteira (`faturasPrevistasDaJanela`, HMO-227) -- a
//      compra esta DENTRO dela. O lado REALIZADO lia `financial_transactions`
//      sem olhar o tipo da conta, entao a mesma compra de R$ 400 entrava duas
//      vezes no mesmo total: uma solta no Realizado, outra dentro do Previsto.
//      `Total` e `previsto + realizado`, e o mes fechava em R$ 800 de uma compra
//      de R$ 400. Nada disso levanta erro, e as DUAS linhas aparecem na lista
//      logo abaixo -- a soma "fecha" com o que esta na tela, o que faz o defeito
//      se ler como "o cartao conta duas vezes porque eu nao entendi a tela".
//      `ehGastoNoCartao` tira a compra do lado realizado, e so na de Despesas.
//
// O "TOTAL" E PREVISTO + REALIZADO, E ISSO E O PEDIDO
// ---------------------------------------------------
// E a mesma definicao do fechamento do mes do grupo (HMO-245): o que o periodo
// compromete, tenha o dinheiro andado ou nao. E diferente do cartao "Despesas"
// de Financas Pessoais, que soma so o realizado -- e a diferenca e a razao de
// existirem as duas leituras. A legenda de cada tela diz qual e qual; sem ela,
// dois numeros certos por criterios diferentes se leem como um bug.
// -----------------------------------------------------------------------------

import { classificarMovimentacao } from "@/lib/movimentacoes";
import {
  contraparteDe,
  destinoDoLancamento,
  indiceDeContraparte,
  type ContaDoLancamento,
  type IndiceDeContraparte,
  type LancamentoComConta,
} from "@/lib/destino-do-lancamento";

/** Qual das tres telas. Sao os mesmos tres valores do ENUM do banco. */
export type TipoDaTela = "income" | "expense" | "transfer";

/** De que lado da conta a linha veio. */
export type OrigemDaLinha = "realizado" | "previsto";

/**
 * O catalogo das tres telas.
 *
 * Existe como dado, e nao como tres arquivos de rota escritos na mao, porque a
 * rota da API valida `?tipo=` contra ELE: uma quarta tela inventada no menu sem
 * passar por aqui responderia 400 em vez de abrir vazia e silenciosa.
 */
export interface TelaDeMovimentacao {
  tipo: TipoDaTela;
  /** O caminho da tela, para o menu e para os links entre elas. */
  rota: string;
  /** O que o `<h1>` diz. */
  titulo: string;
  /** O que o cartao "Previsto" significa NESTA tela, em uma linha. */
  oQueOPrevistoE: string;
  /** O que o cartao "Realizado" significa NESTA tela. */
  oQueORealizadoE: string;
}

export const TELAS_DE_MOVIMENTACAO: readonly TelaDeMovimentacao[] = [
  {
    tipo: "income",
    rota: "/dashboard/receitas",
    titulo: "Receitas",
    oQueOPrevistoE: "o que ainda está previsto entrar no período",
    oQueORealizadoE: "o que você já confirmou que recebeu",
  },
  {
    tipo: "expense",
    rota: "/dashboard/despesas",
    titulo: "Despesas",
    // AS DUAS FRASES DIZEM ONDE O CARTAO ESTA (HMO-260).
    // O cartao entra nesta tela UMA vez, pelo lado previsto, como a fatura
    // inteira; a compra solta nao entra. Sem estas duas frases o Realizado de
    // quem gasta no cartao fica muito menor que a lista de Finanças Pessoais do
    // mesmo mes -- e um valor que falta sem rotulo e indistinguivel de um bug.
    oQueOPrevistoE:
      "o que ainda vence no período e não foi pago, incluindo a fatura do cartão",
    // Sem "acima": este rotulo e impresso no cartao do topo (onde Previsto fica
    // ao LADO, nao em cima) e tambem no cabecalho da secao da lista (onde ele
    // fica em cima). Uma palavra de posicao fica errada em um dos dois lugares.
    oQueORealizadoE: "o que já saiu da sua conta — gasto no cartão vai na fatura",
  },
  {
    tipo: "transfer",
    rota: "/dashboard/transferencias",
    titulo: "Transferências",
    oQueOPrevistoE: "as transferências recorrentes que ainda vão acontecer",
    oQueORealizadoE: "o que já andou entre as suas contas",
  },
] as const;

/**
 * A tela deste tipo, ou `null` quando o valor nao e um dos tres.
 *
 * `null` e nao um padrao, de proposito: numa rota de API, cair em "despesas"
 * porque `?tipo=despeza` veio com typo responde os numeros errados a quem pediu
 * -- e quem pediu nao tem como saber. A rota devolve 400. Na TELA o padrao faz
 * sentido (um link cortado no meio nao pode virar pagina em branco), e e por
 * isso que a escolha fica aqui e nao dentro de um `??` espalhado.
 */
export function telaDoTipo(valor: unknown): TelaDeMovimentacao | null {
  return TELAS_DE_MOVIMENTACAO.find((t) => t.tipo === valor) ?? null;
}

/** Centavos, sem o ruido de ponto flutuante acumulado na soma. */
const centavos = (valor: number) => Number(valor.toFixed(2));

/**
 * O valor de uma linha em reais, SEMPRE POSITIVO.
 *
 * O unico lugar deste modulo que le `amount`. Duas coisas acontecem aqui, e as
 * duas tem de acontecer juntas:
 *
 *   * `Math.abs` ANTES da cotacao. Despesa realizada chega negativa e conta
 *     prevista chega positiva (armadilha 1 do cabecalho). Depois deste abs o
 *     sinal nao existe mais no modulo, e por isso nenhuma decisao de TIPO pode
 *     sair dele -- ver `classificarMovimentacao`.
 *
 *   * cotacao ausente vale 1, nunca 0. `scheduled_transactions` NAO TEM
 *     `exchange_rate` (so `currency`), entao toda conta prevista chega aqui sem
 *     cotacao; tratar isso como 0 apagaria a linha do total sem erro nenhum --
 *     um boleto de R$ 1.200 virando R$ 0,00 e a tela continuando a mostra-lo na
 *     lista. Taxa negativa ou NaN cai no mesmo 1, pelo mesmo motivo.
 */
export function valorEmReais(
  amount: number | string | null | undefined,
  exchange_rate?: number | string | null
): number {
  const bruto = Number(amount ?? 0);
  const quantia = Number.isFinite(bruto) ? Math.abs(bruto) : 0;

  const taxa = Number(exchange_rate ?? 1);
  const cotacao = Number.isFinite(taxa) && taxa > 0 ? taxa : 1;

  return centavos(quantia * cotacao);
}

/**
 * Os status de conta prevista que NAO entram no previsto desta tela.
 *
 * Tres, e cada um por uma razao diferente:
 *
 *   * `paid`      -- a baixa JA criou a linha de `financial_transactions`, que
 *                    esta no lado realizado desta mesma tela. Contar aqui dobra
 *                    (armadilha 2 do cabecalho).
 *   * `skipped`   -- "pulei este mes". Nao vai acontecer.
 *   * `cancelled` -- "nao existe mais".
 *
 * `overdue` NAO aparece aqui, e nunca poderia: ele nao e gravado. A view do 005
 * o calcula na hora a partir de `pending` + vencimento passado, e uma conta
 * vencida continua sendo uma conta que o periodo previa -- tirar ela daqui
 * faria o total de Despesas DIMINUIR no dia seguinte ao vencimento, que e
 * exatamente o dia em que a pessoa abre a tela para ver o que esta atrasado.
 *
 * Esta lista e DIFERENTE da `STATUS_FORA_DO_PREVISTO` de
 * lib/previsto-x-realizado.ts, e a diferenca e o `paid` -- de proposito. La a
 * pergunta e "o que o periodo PROMETIA", e uma promessa cumprida continua tendo
 * sido uma promessa, entao `paid` fica dentro. Aqui previsto e realizado somam
 * no MESMO total, entao `paid` dentro dos dois e a mesma conta duas vezes. As
 * duas listas estao certas para a pergunta de cada uma; e por isso que nenhuma
 * das duas importa a outra.
 */
export const STATUS_QUE_SAI_DO_PREVISTO: ReadonlySet<string> = new Set([
  "paid",
  "skipped",
  "cancelled",
]);

/** Uma linha pronta para a lista da tela. */
export interface LinhaDaTela {
  /**
   * A chave da linha na lista.
   *
   * Para a fatura de cartao sintetizada ela NAO e id de banco, e o prefixo
   * `fatura:` esta ali para que nenhum `href` montado com este campo possa
   * passar por um `/api/scheduled-transactions/<uuid>/...` plausivel. Quem
   * precisa saber se a linha existe no banco le `gravada`, nao o formato do id.
   */
  id: string;
  /**
   * `false` quando a linha nao existe em tabela nenhuma.
   *
   * Hoje so a fatura aberta do cartao: ela e calculada de `card_invoice_lines` a
   * cada leitura (HMO-227) e nao tem `scheduled_transactions.id` enquanto nao
   * for fechada. A tela usa isto para nao oferecer acao sobre ela -- uma baixa
   * com id inventado responde 404, que para quem clicou se le como "o app nao
   * conseguiu".
   */
  gravada: boolean;
  descricao: string | null;
  /** SEMPRE positivo, em reais. Ver `valorEmReais`. */
  valor: number;
  /** `transaction_date` no realizado, `due_date` no previsto. */
  data: string;
  origem: OrigemDaLinha;
  tipo: TipoDaTela;
  /** O status GRAVADO da conta prevista. `null` no realizado. */
  status: string | null;
  /** `effective_status` da view -- o unico que sabe dizer 'overdue'. */
  situacao: string | null;
  categoria: string | null;
  /** A frase de conta: "de Itaú", "para Nubank", "Itaú → Nubank". */
  conta: string | null;
  /** A moeda da linha, quando nao e BRL. `null` cala o rotulo. */
  moeda: string | null;
}

/** Uma linha de `financial_transactions`, como a consulta a devolve. */
export interface RealizadaCrua extends LancamentoComConta {
  id: string;
  description?: string | null;
  amount: number;
  exchange_rate?: number | string | null;
  transaction_date?: string | null;
  currency?: string | null;
  category?: {
    name?: string | null;
    is_expense?: boolean;
  } | null;
}

/**
 * Uma linha do lado previsto: de `scheduled_transactions_effective` OU a fatura
 * aberta do cartao, que `sintetizarFaturasAbertas` monta com esta mesma forma.
 *
 * `id` e `string | null` por causa da segunda: a fatura aberta nao existe no
 * banco (HMO-227) e o `id: null` dela e deliberado -- ele obriga quem consome a
 * decidir o que fazer antes de montar uma URL. Aqui a decisao e `gravada:
 * false` + chave sintetica com prefixo.
 */
export interface PrevistaCrua {
  id: string | null;
  description?: string | null;
  amount: number | string | null;
  due_date?: string | null;
  status?: string | null;
  effective_status?: string | null;
  currency?: string | null;
  /** A coluna `direction` da view. NUNCA o `transaction_type` cru. */
  direction?: string | null;
  /**
   * O embed da categoria. DUAS FORMAS POSSIVEIS, e nao e paranoia.
   *
   * Embed do PostgREST sobre uma VIEW: o supabase-js nao consegue provar a
   * relacao muitos-para-um e tipa o resultado como ARRAY, enquanto o PostgREST
   * devolve objeto em runtime. Os dois podem estar certos dependendo da versao,
   * e ler a forma errada da `undefined` em TODA linha -- sem erro, sem log.
   * Aqui isso apagaria o nome da categoria da lista inteira. Ver
   * `umDoEmbed`, e HMO-209 para o caso em que o mesmo detalhe fez um filtro
   * parar de filtrar.
   */
  category?: { name?: string | null } | { name?: string | null }[] | null;
  /** O embed da conta, na linha gravada. Mesmas duas formas. */
  account?: { name?: string | null } | { name?: string | null }[] | null;
  /** O nome do cartao, na fatura sintetizada (ela nao tem embed). */
  account_name?: string | null;
  /** A chave canonica da fatura sintetizada, que vira a chave da lista. */
  notes?: string | null;
}

/**
 * O objeto de um embed do PostgREST, venha ele objeto ou array.
 *
 * Sobre TABELA, com a FK visivel, o supabase-js resolve muitos-para-um e da
 * objeto. Sobre VIEW -- e `scheduled_transactions_effective` e uma view -- ele
 * nao consegue provar a relacao e cai no plural, enquanto o PostgREST devolve
 * objeto em runtime. O tipo e o runtime discordam, e qualquer um dos dois pode
 * estar certo dependendo da versao.
 *
 * Ler a forma errada custa: `linha.account.name` sobre um array e `undefined`
 * em TODA linha, sem erro e sem log -- a coluna "conta" da lista inteira em
 * branco, que se le como "o app nao sabe de que conta e". Resolver com um `as`
 * calaria o tsc e manteria o furo de runtime inteiro.
 *
 * Array vazio e `null` sao a mesma ausencia, e os dois dao `null`.
 */
function umDoEmbed<T>(valor: T | T[] | null | undefined): T | null {
  if (!valor) return null;
  if (Array.isArray(valor)) return valor[0] ?? null;
  return valor;
}

const texto = (valor: unknown): string | null => {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo ? limpo : null;
};

/** A moeda, quando ela muda o significado do numero. BRL nao muda, e cala. */
const moedaDaLinha = (valor: unknown): string | null => {
  const nome = texto(valor);
  return nome && nome.toUpperCase() !== "BRL" ? nome.toUpperCase() : null;
};

/**
 * Esta linha de transferencia e a perna de ENTRADA (a que deve ficar FORA)?
 *
 * A transferencia e gravada em duas linhas com a mesma `transaction_date`
 * (`pernasDaTransferencia` + app/api/movimentacoes/transferencia/route.ts),
 * entao as duas caem sempre no mesmo periodo e contar as duas dobra o total
 * (armadilha 3 do cabecalho). A tela mostra a perna de SAIDA, que e a que tem a
 * conta de onde o dinheiro saiu; o nome do destino vem da contraparte, por
 * `destinoDoLancamento`.
 *
 * SAO DOIS CRITERIOS, E OS DOIS PRECISAM ESTAR AQUI:
 *
 *   * `counterpart_transaction_id` preenchido. O elo do 015 e de UMA VIA: quem
 *     o grava e a perna de entrada, apontando para a de saida. Ele e o criterio
 *     mais forte, e e o unico que funciona quando o valor e zero.
 *
 *   * valor positivo. Uma transferencia de antes do 015 -- ou uma cujo par
 *     perdeu o elo, que a FK `ON DELETE SET NULL` permite -- nao tem o elo. Sem
 *     este segundo criterio ela voltaria a ser contada duas vezes, e o valor
 *     dobrado e plausivel.
 *
 * O CASO DO CAMBIO, que torna o sinal insuficiente sozinho e o elo essencial:
 * numa transferencia entre contas de moedas diferentes as duas pernas NAO se
 * anulam (-1.000 BRL e +180 USD), e e a perna de saida que diz quanto saiu em
 * reais. Ficar com ela e a resposta certa para "quanto andou".
 *
 * `amount === 0` com os dois lados sem elo e o unico caso que sobra, e as duas
 * linhas ficam. E deliberado: somar duas linhas de zero continua dando zero, e
 * esconder uma delas seria a tela apagando um lancamento que a pessoa criou.
 */
export function ehPernaDeEntrada(crua: RealizadaCrua): boolean {
  if (texto(crua.counterpart_transaction_id)) return true;
  return Number(crua.amount) > 0;
}

/**
 * O valor de `financial_accounts.account_type` que significa cartao de credito.
 *
 * Declarado aqui, e NAO importado de `TIPO_CARTAO` (lib/agenda-do-cartao.ts),
 * porque este modulo e compilado por um tsconfig com `rootDir: lib` e com
 * apenas duas dependencias copiadas para a arvore do mutador: importar
 * `agenda-do-cartao` arrastaria `card-invoice` -> `transferencia` ->
 * `lancamento` atras dele, e um mutante que nao COMPILA "morre" por motivo
 * errado -- o placar mentiria a favor.
 *
 * Duas constantes com o mesmo valor em dois arquivos e uma fonte de verdade
 * duplicada, e o modo de falha dela e exatamente o que o cabecalho de
 * `agenda-do-cartao` descreve: um typo (`credit-card`) nao da erro nenhum, so
 * para de casar, o filtro passa a nao filtrar nada e a tela volta ao defeito da
 * HMO-260 sem uma mensagem em lugar algum. Quem tranca isso e
 * `test-contrato-das-telas-de-movimentacao.mjs`, que afirma que as duas
 * declaracoes dizem a mesma string.
 */
export const TIPO_CARTAO = "credit_card";

/**
 * A conta da linha realizada, venha o embed objeto ou array de um.
 *
 * `RealizadaCrua.account` e tipado objeto (`financial_transactions` e TABELA, e
 * ali o supabase-js resolve muitos-para-um), mas a rota entrega a resposta com
 * `as unknown as RealizadaCrua[]` -- o `tsc` nao verifica nada nessa fronteira.
 * Se o embed chegasse array, `crua.account.account_type` seria `undefined` em
 * TODA linha, nenhuma casaria com `credit_card`, o filtro de `ehGastoNoCartao`
 * passaria a nao filtrar nada e a tela voltaria ao defeito desta issue -- sem
 * erro, sem log, sem teste vermelho. Ver `umDoEmbed`, que faz o mesmo do lado
 * previsto, e HMO-209.
 */
function contaDaRealizada(crua: RealizadaCrua): ContaDoLancamento | null {
  const bruto = crua.account as
    | ContaDoLancamento
    | ContaDoLancamento[]
    | null
    | undefined;
  if (!bruto) return null;
  if (Array.isArray(bruto)) return bruto[0] ?? null;
  return bruto;
}

/**
 * Os `transaction_type` que a view `card_invoice_lines` deixa entrar na fatura.
 *
 * ESTA LISTA E A COPIA DO `WHERE` DA VIEW (006/035), e nao uma escolha deste
 * arquivo:
 *
 *     WHERE a.account_type = 'credit_card'
 *       AND t.transaction_type IN ('expense', 'income')
 *
 * Ela existe porque `ehGastoNoCartao` so pode esconder a linha que a fatura de
 * fato CONTEM. Ver o paragrafo do `transaction_type` NULO em `ehGastoNoCartao`.
 *
 * EXPORTADA desde a HMO-265, e e por isso que ela nao pode voltar a ser privada:
 * `lib/realizado-do-caixa.ts` aplica a MESMA regra no Realizado do painel e
 * importa esta constante em vez de declarar a sua. Uma segunda copia do `WHERE`
 * da view nao daria erro nenhum -- so deixaria as duas telas discordarem sobre
 * quais linhas a fatura contem, que e o tipo de divergencia que a HMO-258 abriu.
 */
export const TIPOS_QUE_ENTRAM_NA_FATURA: ReadonlySet<string> = new Set([
  "expense",
  "income",
]);

/**
 * Esta linha realizada e um gasto NO CARTAO (e por isso ja esta na fatura)?
 *
 * Armadilha 5 do cabecalho. "Realizado no periodo nunca deve considerar
 * despesas no cartao. Pois ja considera a fatura do cartao pro periodo."
 *
 * SAO DOIS CRITERIOS, e o segundo nao e zelo -- ele e o que impede este conserto
 * de APAGAR dinheiro:
 *
 *   * a conta e um cartao de credito. Nao ha excecao de fatura aqui, ao
 *     contrario de `previsaoApareceNaAgenda`: la a fatura FECHADA e uma
 *     `scheduled_transaction` com o `account_id` do cartao e precisa ficar,
 *     porque e ela que a pessoa paga. Aqui nao existe linha equivalente -- o
 *     pagamento da fatura e uma TRANSFERENCIA de duas pernas
 *     (`pernasDoPagamentoDeFatura`), e as duas pernas sao `transfer`, entao
 *     nenhuma delas chega na tela de Despesas de qualquer forma.
 *
 *   * e o `transaction_type` GRAVADO esta em `TIPOS_QUE_ENTRAM_NA_FATURA`.
 *
 * O SEGUNDO CRITERIO, E POR QUE ELE E SOBRE A COLUNA CRUA E NAO SOBRE
 * `classificarMovimentacao`: a view `card_invoice_lines` filtra
 * `t.transaction_type IN ('expense','income')` pela COLUNA, e ha linha com a
 * coluna NULA em producao (o POST de /api/personal-finance/transactions nao a
 * gravava). Uma compra no cartao com `transaction_type` NULO portanto NAO esta
 * na fatura -- e `classificarMovimentacao` a chama de despesa pela categoria ou
 * pelo sinal. Esconde-la daqui pelo tipo da conta a tiraria da tela de Despesas
 * sem que nada a somasse no lugar: o valor sairia do app, que e pior que
 * conta-lo duas vezes. Com os dois criterios ela FICA no realizado, exatamente
 * como antes desta issue.
 *
 * SEM CONTA (ou sem conseguir ler a conta) A LINHA FICA, pela mesma direcao de
 * erro barato de `previsaoApareceNaAgenda`: a despesa de grupo e gravada SEM
 * `account_id` (ver lib/destino-do-lancamento.ts) e um embed `null` por RLS
 * significa "nao sei", nao "e cartao". Esconder no "nao sei" apagaria despesa
 * legitima do unico total que a pessoa abre para saber quanto gastou no mes --
 * e um total MENOR nao parece um erro, parece um mes barato.
 */
export function ehGastoNoCartao(crua: RealizadaCrua): boolean {
  if (contaDaRealizada(crua)?.account_type !== TIPO_CARTAO) return false;
  return TIPOS_QUE_ENTRAM_NA_FATURA.has(String(crua.transaction_type));
}

/**
 * Converte a linha realizada para a lista.
 *
 * O `indice` existe so pela transferencia: a frase "Itaú → Nubank" precisa da
 * OUTRA perna, que esta em outra linha do banco. Ver
 * lib/destino-do-lancamento.ts -- e em particular por que ali sao dois mapas e
 * nao um.
 */
export function linhaRealizada(
  crua: RealizadaCrua,
  indice: IndiceDeContraparte
): LinhaDaTela {
  const destino = destinoDoLancamento(crua, indice);

  return {
    id: crua.id,
    gravada: true,
    descricao: texto(crua.description),
    valor: valorEmReais(crua.amount, crua.exchange_rate),
    data: texto(crua.transaction_date) ?? "",
    origem: "realizado",
    tipo: classificarMovimentacao(crua),
    status: null,
    situacao: null,
    categoria: texto(crua.category?.name),
    // `faltaConta` em vez do texto cru: "Sem conta" dito igual a "Itaú" e um
    // nome de conta inventado. `null` cala a frase na tela.
    conta: destino.faltaConta ? null : destino.texto,
    moeda: moedaDaLinha(crua.currency),
  };
}

/**
 * Converte a conta prevista para a lista -- ou `null` quando ela nao pode
 * entrar.
 *
 * Os dois `null` possiveis, e por que os dois estao AQUI e nao na consulta:
 *
 *   * status em `STATUS_QUE_SAI_DO_PREVISTO`. A unica defesa contra contar a
 *     mesma conta duas vezes (armadilha 2). Num `.neq()` da consulta ela nao
 *     teria assercao nenhuma por cima.
 *
 *   * `direction` fora dos tres tipos. A view JA resolve a precedencia
 *     (ocorrencia, regra, 'expense') na coluna `direction`; refazer esse
 *     COALESCE aqui e o defeito que a 027 fechou. Um valor novo no ENUM chegaria
 *     aqui como lixo, e um `?? "expense"` o enfiaria na tela de Despesas -- uma
 *     receita prevista virando conta a pagar, que e exatamente o que a 027
 *     descreve. Fora e melhor: a linha falta em UMA tela em vez de aparecer
 *     errada em outra, e o total das tres telas deixa de fechar com o da agenda,
 *     que e um sintoma que da para ver.
 *
 *   * `id` e `notes` os dois nulos. A fatura sintetizada se identifica por
 *     `notes` (a chave canonica `fatura:<mes>:<cartao>`); sem nenhum dos dois
 *     nao ha chave estavel para a lista, e usar o indice do array faria o React
 *     reaproveitar a linha errada quando o periodo mudasse. Uma linha a menos e
 *     melhor que uma linha com o valor de outra.
 */
export function linhaPrevista(crua: PrevistaCrua): LinhaDaTela | null {
  if (STATUS_QUE_SAI_DO_PREVISTO.has(String(crua.status))) return null;

  const tela = telaDoTipo(crua.direction);
  if (!tela) return null;

  // O id do banco, quando existe; a chave canonica da fatura, quando nao.
  //
  // A chave da fatura JA comeca com `fatura:` (`chaveFatura` em
  // lib/card-invoice.ts) e entra crua por isso: prefixar de novo daria
  // `fatura:fatura:...` e perderia a unica coisa que o prefixo garante -- que
  // esta string nao passa por um uuid em URL nenhuma.
  //
  // `?? ` em vez de um ternario sobre `gravada`: assim nao ha `!` nenhum, e um
  // `${chave!}` que imprimisse a string "null" na tela nao e um estado que este
  // arquivo possa alcancar.
  const idGravado = texto(crua.id);
  const chave = idGravado ?? texto(crua.notes);
  if (!chave) return null;

  // O embed na linha gravada, o campo solto na fatura sintetizada.
  const nomeDaConta =
    texto(umDoEmbed(crua.account)?.name) ?? texto(crua.account_name);

  return {
    id: chave,
    gravada: idGravado !== null,
    descricao: texto(crua.description),
    // Sem cotacao: `scheduled_transactions` nao tem a coluna. Ver
    // `valorEmReais`.
    valor: valorEmReais(crua.amount),
    data: texto(crua.due_date) ?? "",
    origem: "previsto",
    tipo: tela.tipo,
    status: texto(crua.status),
    situacao: texto(crua.effective_status),
    categoria: texto(umDoEmbed(crua.category)?.name),
    conta: nomeDaConta,
    moeda: moedaDaLinha(crua.currency),
  };
}

/**
 * As linhas de UMA tela, previsto e realizado juntos, da mais recente para a
 * mais antiga.
 *
 * A ordem das quatro decisoes importa:
 *
 *   1. o TIPO filtra (`classificarMovimentacao` no realizado, `direction` no
 *      previsto). E o que mantem a perna de saida de uma transferencia fora da
 *      tela de Despesas -- pelo sinal e pela categoria ela e um gasto.
 *   2. a perna de ENTRADA sai, so na tela de transferencia.
 *   3. o GASTO NO CARTAO sai, so na tela de Despesas (armadilha 5). Depois do
 *      filtro de tipo e nao antes: a perna de ENTRADA do pagamento da fatura
 *      mora no cartao, e tirar as linhas de cartao antes de classificar
 *      esconderia dela a tela de Transferencias, que e onde o pagamento da
 *      fatura tem de aparecer.
 *   4. so entao a linha e convertida, porque a conversao apaga o sinal.
 *
 * Invertida a 1 com a 4, o filtro de tipo teria de decidir sobre um valor ja
 * absoluto -- e nao ha como. Invertida a 2 com a 4, o mesmo.
 */
export function linhasDaTela(
  realizadas: readonly RealizadaCrua[],
  previstas: readonly PrevistaCrua[],
  tipo: TipoDaTela
): LinhaDaTela[] {
  // O indice vai sobre TODAS as realizadas, e nao sobre as filtradas: a
  // contraparte de uma transferencia e uma transferencia tambem, mas o indice
  // tambem serve de `porId` para o caso de um elo apontar para linha de outro
  // tipo (uma linha antiga, de antes de `transaction_type` ser gravado).
  const indice = indiceDeContraparte(realizadas as LancamentoComConta[]);

  const linhas: LinhaDaTela[] = [];

  for (const crua of realizadas) {
    if (classificarMovimentacao(crua) !== tipo) continue;
    if (tipo === "transfer" && ehPernaDeEntrada(crua)) continue;
    // O gasto no cartao esta DENTRO da fatura, e a fatura inteira ja esta no
    // lado previsto desta mesma tela. Ver armadilha 5 do cabecalho.
    if (tipo === "expense" && ehGastoNoCartao(crua)) continue;
    linhas.push(linhaRealizada(crua, indice));
  }

  for (const crua of previstas) {
    const linha = linhaPrevista(crua);
    if (linha && linha.tipo === tipo) linhas.push(linha);
  }

  // `localeCompare` SOBRE A STRING ISO, e nao `new Date(...)`.
  //
  // Para duas datas bem formadas os dois criterios dao a MESMA ordem (o
  // instante UTC preserva a ordem do texto), e e por isso que a troca passa por
  // inofensiva. O que ela quebra e a linha SEM data: `data` e `""` quando
  // `transaction_date`/`due_date` vem NULL (ver `linhaRealizada`), e
  // `new Date("").getTime()` e NaN. Um NaN no comparador nao poe a linha no
  // lugar errado -- ele EMBARALHA a lista inteira. Medido: com uma linha sem
  // data no meio, `[20/10, 05/10, 01/09, ""]` sai como `[05/10, "", 20/10,
  // 01/09]` pelo criterio de Date, e a ordem da tela deixa de ser ordem.
  //
  // Por string, `""` e menor que qualquer data e cai no fim, sozinha, sem
  // mexer em nenhuma das outras. A ordenacao por texto tambem e o que o recorte
  // de periodo deste app usa em todo lugar.
  return linhas.sort((a, b) => b.data.localeCompare(a.data));
}

/**
 * As duas secoes da lista, cada uma na ORDEM que a sua pergunta pede.
 *
 * Duas secoes e nao uma lista unica, e a razao e a aritmetica: cada cartao do
 * topo passa a ter embaixo dele exatamente as linhas que ele somou. Misturadas
 * por data, "Previsto R$ 2.400" ficaria em cima de uma lista em que as linhas
 * previstas estao espalhadas entre as realizadas, e conferir o numero exigiria
 * somar de cabeca escolhendo quais linhas contar.
 *
 * AS ORDENS SAO OPOSTAS, E ISSO E DELIBERADO:
 *
 *   * previstas em ordem CRESCENTE de vencimento -- a pergunta e "o que vem
 *     agora", e o que vem agora e o que vence primeiro. Decrescente poria a
 *     conta do dia 30 acima da que vence amanha.
 *   * realizadas em ordem DECRESCENTE -- a pergunta e "o que aconteceu", e o
 *     ultimo lancamento e o que a pessoa acabou de fazer e vem conferir.
 *
 * `Array.prototype.sort` ordena NO LUGAR, e ordenar o array que `linhasDaTela`
 * devolveu seria um efeito a distancia que nao apareceria em nenhuma das duas
 * funcoes. Aqui isso nao acontece sem copia nenhuma porque `filter` JA devolve
 * array novo -- os dois `sort` abaixo mexem em arrays que nasceram nesta
 * funcao. Um `[...previstas]` por cima disso seria defesa morta: o mutante que
 * a removia sobreviveu, e a conclusao foi tirar a copia e escrever este
 * paragrafo, nao escrever um teste que nao e capaz de falhar.
 */
export function secoesDaTela(linhas: readonly LinhaDaTela[]): {
  previstas: LinhaDaTela[];
  realizadas: LinhaDaTela[];
} {
  const previstas = linhas.filter((l) => l.origem === "previsto");
  const realizadas = linhas.filter((l) => l.origem === "realizado");

  return {
    previstas: previstas.sort((a, b) => a.data.localeCompare(b.data)),
    realizadas: realizadas.sort((a, b) => b.data.localeCompare(a.data)),
  };
}

/** Os tres numeros da tela. */
export interface ResumoDaTela {
  /** O que ainda vai acontecer no periodo. */
  previsto: number;
  /** O que ja aconteceu no periodo. */
  realizado: number;
  /** `previsto + realizado` -- o que o periodo compromete. */
  total: number;
  quantidadePrevista: number;
  quantidadeRealizada: number;
  /** Quantas linhas a lista tem. */
  quantidade: number;
}

/**
 * Soma as linhas de uma tela nos tres numeros.
 *
 * `total` e `previsto + realizado` e nao uma terceira varredura: duas somas que
 * deveriam ser iguais e sao calculadas por caminhos diferentes divergem na
 * primeira mudanca, e a divergencia aparece como "as contas nao fecham" sem
 * dizer qual das duas esta errada.
 *
 * `quantidade` TAMBEM e a soma das duas, e aqui a razao e o contrario da de
 * `contarPorFiltro` em lib/movimentacoes.ts: ali o total e contado a parte para
 * que uma quarta classificacao apareca como diferenca. Aqui nao ha quarta
 * origem possivel -- `LinhaDaTela.origem` e uma uniao de dois -- e uma terceira
 * contagem independente so poderia discordar por bug.
 */
export function resumoDaTela(linhas: readonly LinhaDaTela[]): ResumoDaTela {
  let previsto = 0;
  let realizado = 0;
  let quantidadePrevista = 0;
  let quantidadeRealizada = 0;

  for (const linha of linhas) {
    if (linha.origem === "previsto") {
      previsto += linha.valor;
      quantidadePrevista += 1;
    } else {
      realizado += linha.valor;
      quantidadeRealizada += 1;
    }
  }

  return {
    previsto: centavos(previsto),
    realizado: centavos(realizado),
    total: centavos(previsto + realizado),
    quantidadePrevista,
    quantidadeRealizada,
    quantidade: quantidadePrevista + quantidadeRealizada,
  };
}

/**
 * Quanto do previsto desta tela JA VENCEU.
 *
 * Nao e um quarto cartao -- a issue pede tres. E a nota embaixo do cartao
 * "Previsto", e ela existe porque "R$ 2.400 previsto" responde a pergunta
 * errada quando R$ 2.400 venceram ontem. Na tela de Receitas a mesma nota muda
 * de sentido (atraso de quem paga voce, nao divida sua) e por isso a frase mora
 * no componente, nao aqui.
 *
 * `effective_status` e a unica fonte possivel: 'overdue' NUNCA e gravado -- a
 * view o calcula na hora. Comparar `data < hoje` aqui seria uma segunda
 * implementacao da mesma regra, e as duas divergiriam no dia em que a view
 * mudasse (ou no fuso do servidor, que e UTC na Vercel).
 *
 * `situacao === "overdue"` E O CRITERIO UNICO, e nao ha um `origem ===
 * "previsto"` por cima. Ele existiu e saiu: `linhaRealizada` grava
 * `situacao: null` em TODA linha realizada, entao a linha realizada nunca
 * alcanca o `+=` e a segunda guarda era defesa morta. O mutante que a removia
 * sobreviveu, e a conclusao foi apaga-la e escrever o invariante aqui -- o
 * caminho alternativo seria forjar, no teste, uma linha realizada com
 * `situacao: "overdue"`, que e um estado que o modulo nao produz: uma trava
 * provada so por um estado forjado por fora nao prova nada.
 */
export function previstoVencido(linhas: readonly LinhaDaTela[]): {
  total: number;
  quantidade: number;
} {
  let total = 0;
  let quantidade = 0;

  for (const linha of linhas) {
    if (linha.situacao !== "overdue") continue;
    total += linha.valor;
    quantidade += 1;
  }

  return { total: centavos(total), quantidade };
}

/**
 * A outra perna de uma transferencia, para a tela poder dizer o destino.
 *
 * Reexportada daqui para que a tela importe de um lugar so. A implementacao
 * continua em lib/destino-do-lancamento.ts, com os dois mapas que o elo de uma
 * via exige.
 */
export { contraparteDe, indiceDeContraparte };
