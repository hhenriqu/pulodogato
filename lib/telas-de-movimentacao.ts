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
//      lista, porque a lista tambem mostra as duas. `ehPernaDeEntrada` tira uma
//      -- e a armadilha 7 e o caso em que nao ha duas.
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
//   6. A FATURA PAGA NAO ESTAVA EM LADO NENHUM (HMO-264). A armadilha 5 tirou a
//      compra do Realizado contando que a FATURA estivesse no Previsto. Isso
//      vale enquanto ela esta aberta; no mes em que ela e PAGA os dois lados a
//      perdem ao mesmo tempo:
//
//        * sai do PREVISTO -- `status: 'paid'` cai em
//          `STATUS_QUE_SAI_DO_PREVISTO` (armadilha 2), e `faturasPrevistasDaJanela`
//          ja nao a sintetiza porque a chave canonica existe em
//          `scheduled_transactions`;
//        * nao entrava no REALIZADO -- a baixa grava DUAS pernas `transfer`
//          (`pernasDoPagamentoDeFatura`), e o filtro de tipo da armadilha 4
//          mantinha as duas fora da tela de Despesas. E as compras que a fatura
//          contem ja tinham saido pela armadilha 5.
//
//      Resultado: o mes em que se pagou R$ 1.290 de cartao fechava R$ 1.290 mais
//      barato, no Previsto, no Realizado e no Total. E um total MENOR nao parece
//      erro -- parece um mes barato, que e a mesma direcao de falha que
//      `ehGastoNoCartao` evita quando nao da para saber.
//
//      `ehPagamentoDaFatura` traz a PERNA DE SAIDA de volta, e nesta lib so na
//      tela de Despesas -- `tela` e o parametro que decide. A FUNCAO, no
//      entanto, nao e so desta tela: desde a HMO-317 ela e a DONA UNICA da
//      pergunta "esta linha e a perna de saida do pagamento da fatura" e
//      responde tambem pelo Realizado do painel
//      (`realizadoComCartaoPelaFatura`, lib/realizado-do-caixa.ts), que tinha a
//      sua propria copia dos tres criterios. Mexer nela mexe nos dois numeros.
//      O valor sai da PERNA e nunca de `scheduled_transactions.amount`:
//      a baixa aceita valor diferente do previsto e NAO reescreve a agenda, e e
//      a perna que diz quanto saiu de verdade -- com `transaction_date =
//      paid_date`, que e o que poe a fatura no mes em que ela foi PAGA e nao no
//      do vencimento (pagar atrasado contaria no mes errado).
//
//      A MESMA LINHA CONTINUA NA TELA DE TRANSFERENCIAS, e isso nao e contar
//      duas vezes: nenhum total soma as tres telas. Pagar a fatura E um
//      movimento entre duas contas minhas (e e so isso que Transferencias
//      afirma) E o momento em que a despesa do cartao se realiza (e e so isso
//      que Despesas afirma). Por isso o que entra em Despesas e a FATURA,
//      reconhecida pela chave canonica -- `natureza: "fatura"` com o caminho de
//      volta para o cartao e o mes --, e nao uma transferencia reclassificada em
//      despesa. `tela` e o parametro que deixa as duas leituras conviverem.
//
//   7. A PERNA DE ENTRADA SOLTA NAO ESTAVA EM LADO NENHUM (HMO-380). A
//      armadilha 3 tira UMA das duas pernas da transferencia, e o criterio de
//      "qual das duas" tem o sinal como rede (`ehPernaDeEntrada`): sem elo, a
//      positiva e a de entrada e e ela que sai. Isso vale enquanto houver DUAS
//      pernas.
//
//      A parcela do MyBank paga por uma CONEXAO nao tem duas. O dinheiro veio
//      da conta de outra pessoa, e o que o credor grava e UMA linha so --
//      `transfer`, POSITIVA, `counterpart_transaction_id` nulo, com a chave
//      canonica `mybank:<id da parcela>` em `notes`
//      (app/api/mybank/installments/[id]/route.ts -> `pernaDeEntradaDoPagamento`).
//      Pelo criterio do sinal ela e "a perna de entrada de um par", e o
//      `continue` da armadilha 3 a descartava: R$ 100,00 que entraram de
//      verdade na conta de investimento (o saldo subiu, o patrimonio esta
//      certo) liam R$ 0,00 nas TRES abas de Movimentacoes. Zero em Despesas e
//      zero em Receitas estao certos (nao e gasto, e o principal voltando nao e
//      receita nova -- `PARCELA_FORA_DO_REALIZADO`); o zero em Transferencias
//      era a linha inteira sumindo do app. E a direcao barata de novo: um mes
//      MENOR nao parece erro.
//
//      A DECISAO E «ELA VOLTA PARA A ABA TRANSFERENCIAS», e nao «ela e uma
//      quarta natureza de movimento». Duas razoes:
//
//        * o que aquela aba afirma e "dinheiro andou entre contas sem virar
//          receita nem despesa", e e exatamente isso que aconteceu. A conta da
//          outra ponta nao e minha, entao a frase sai "entrou em
//          Investimentos" em vez de "A → B" -- `destinoDoLancamento` ja escolhe
//          por QUAL ponta e conhecida, nao por qual perna e a desenhada;
//        * uma quarta aba (ou uma linha so na tela do MyBank) deixaria o unico
//          lugar onde esse dinheiro aparece FORA das Movimentacoes, que e a tela
//          que a pessoa abre para conferir o mes.
//
//      `ehEntradaSoltaDoMyBank` e quem a traz de volta, e os QUATRO criterios
//      dela estao no cabecalho da funcao. O que importa aqui e o quarto: o elo
//      do 015 NULO. No Caso A (auto-emprestimo) a baixa da previsao grava as
//      DUAS pernas com a MESMA nota `mybank:` (`comum.notes` em
//      app/api/scheduled-transactions/[id]/pay/route.ts, HMO-382) -- lá ha par,
//      e sem esse criterio a armadilha 3 voltaria para o Caso A: R$ 1.000 de
//      parcela virariam R$ 2.000 com as duas linhas na lista ao lado.
//
//   8. A PARCELA PAGA DO CASO A SAIA DE DESPESAS E PERDIA O SELO (HMO-385). A
//      excecao da armadilha 7 e do CASO B (a perna solta). O CASO A -- o
//      auto-emprestimo, cuja baixa grava um par -- tinha excecao so no lado
//      PREVISTO (`ehParcelaDoAutoEmprestimo`, no laco das previstas): enquanto a
//      parcela estava pendente ela aparecia nas duas abas com o selo, e no mes em
//      que era PAGA os dois lados mudavam de resposta ao mesmo tempo:
//
//        * sai do PREVISTO -- `status: 'paid'` cai em
//          `STATUS_QUE_SAI_DO_PREVISTO` (armadilha 2), e a excecao do
//          auto-emprestimo nem e consultada: `linhaPrevista` ja devolveu `null`;
//        * nao entrava no REALIZADO -- a baixa grava DUAS pernas `transfer`
//          (`pernasDaTransferencia`), e o filtro de tipo da armadilha 4 mantinha
//          as duas fora da tela de Despesas.
//
//      Medido em PRODUCAO pela prova da HMO-382 (2026-10-11), conta de teste,
//      sessao real: a mesma parcela de R$ 10,00 aparecia em Despesas com
//      `natureza: "mybank"` enquanto pendente, DESAPARECIA de Despesas depois da
//      baixa, e voltava com o selo depois do estorno. Em Transferencias ela
//      sobrevivia a baixa, mas como `natureza: "despesa"` -- o selo se perdia.
//
//      E a familia "o numero nao fecha" na sua forma mais calada: NAO HA SALDO
//      ERRADO para denunciar. As duas pernas estao certas (foi o que a HMO-382
//      provou), o patrimonio esta certo, e o que falha e so a aba que existe
//      para responder "quanto saiu da minha conta neste mes" -- ela some com o
//      dinheiro que de fato saiu. Um mes MENOR de novo, pela terceira armadilha
//      diferente.
//
//      `ehSaidaDaParcelaDoAutoEmprestimo` e quem a traz de volta, com os TRES
//      criterios no cabecalho da funcao, e o selo passa a valer nas duas abas
//      como o lado previsto sempre prometeu. O que importa aqui e o criterio do
//      SINAL: a perna de entrada do mesmo par carrega a mesma nota e o mesmo
//      tipo, e sem o sinal as DUAS entrariam em Despesas -- R$ 2.000 para uma
//      parcela de R$ 1.000.
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
// `lib/chave-da-fatura.ts` e um arquivo-FOLHA, e e por isso que ESTE import e
// permitido onde o de `lib/card-invoice.ts` nao seria (ver `TIPO_CARTAO` mais
// abaixo, e o cabecalho do proprio chave-da-fatura): ele nao tem import nenhum,
// entao copia-lo para a arvore do mutador e um arquivo, nao uma arvore.
// Acrescentar dependencia aqui obriga a acrescentar em `DEPENDENCIAS` de
// scripts/mutantes-telas-de-movimentacao.mjs -- sem isso TODO mutante deixa de
// compilar e "morre", e o placar vira 100% sem medir nada.
import { faturaDaChave } from "@/lib/chave-da-fatura";
import {
  eloDesfazivel,
  suspeitasDeFaturaRepetida,
  type SuspeitaDeFatura,
} from "@/lib/elo-da-fatura";

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

/**
 * O que a linha E, por tras do valor (HMO-285).
 *
 * CAMPO SEPARADO DE `tipo`, E NAO UM QUARTO VALOR DE `TipoDaTela`. Esticar
 * aquela uniao teria dois efeitos, os dois ruins: `telaDoTipo("fatura")` teria
 * de responder alguma tela (nao existe), e um valor novo chegando em
 * `linhaPrevista` sai pela peneira do `direction` -- a linha DESAPARECERIA da
 * tela, em silencio. `tipo` e o que filtra a tela e o que a rota valida em
 * `?tipo=`; `natureza` e o que a linha diz de si mesma dentro da tela que ja a
 * aceitou.
 *
 * `"despesa"` e o nome do caso COMUM, e nao uma afirmacao de que a linha e um
 * gasto: ela e o valor de `natureza` tambem na tela de Receitas e na de
 * Transferencias, porque o criterio ("nao e fatura e nao vem de regra fixa") e o
 * mesmo nas tres. Quem imprimir isto na tela tem de escolher a palavra pela
 * tela, nao pelo valor -- "Despesa" escrito embaixo de um salario previsto
 * seria um rotulo errado sobre um numero certo.
 *
 * `"mybank"` ENTROU NA HMO-372, e e o SELO que a decisao 1 da HMO-368 pede.
 * Ele existe porque a parcela do auto-emprestimo e a unica linha da aba
 * Despesas que e uma TRANSFERENCIA na coluna do banco: sem o selo, ela se le
 * como uma despesa comum, e quem conferir o extrato vai procurar um gasto de
 * R$ 1.000 que nao existe -- o dinheiro foi para a propria conta de
 * investimento da pessoa. Ver `ehParcelaDoAutoEmprestimo`.
 */
export type NaturezaDaLinha = "despesa" | "fatura" | "fixa" | "mybank";

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
  /**
   * Fatura de cartao, conta que nasceu de regra fixa, ou linha comum.
   *
   * A ORDEM DE AVALIACAO E FATURA PRIMEIRO, FIXA DEPOIS, e isso nao e empate
   * arbitrario. A fatura fechada tem `recurring_rule_id` nulo hoje, mas se um
   * dia ela passasse a nascer de uma regra os dois criterios casariam na mesma
   * linha -- e chama-la de "fixa" tiraria dela a unica coisa que `fatura` existe
   * para dar: o caminho de volta para o cartao e o mes. Uma conta fixa nao tem
   * para onde apontar; uma fatura tem.
   */
  natureza: NaturezaDaLinha;
  /**
   * Quem pode editar / excluir / dar baixa nesta linha -- HMO-301.
   *
   * O MESMO campo, com o MESMO nome e a MESMA regra, de
   * `LinhaDoDetalhe.posso_editar` (lib/pra-quem-pagar.ts, HMO-300): os dois modos
   * leem listas diferentes e precisam da mesma resposta, e dois nomes para a
   * mesma pergunta divergiriam na primeira mudanca.
   *
   * Ele existe porque a lista pode conter linha de OUTRO membro do grupo -- a
   * policy do 005 libera `group_id IS NOT NULL AND is_group_member(group_id)`
   * --, e a escrita ali e recusada pela RLS. O modo de falha pior ja esta
   * medido neste repositorio: `UPDATE` filtrado pela RLS volta **200 sem
   * alterar nada**, ou seja o app diz "pronto" e a linha fica.
   *
   * FALHA FECHADO: sem `user_id` na leitura, ou sem `meuUserId` em
   * `linhasDaTela`, ele e `false` e nenhum botao aparece. Botao ausente e ruim;
   * botao que aparece e nao funciona e pior. Quem o consome e
   * `lib/acoes-da-linha.ts`.
   */
  posso_editar: boolean;
  /**
   * A linha e a MINHA PARTE de uma despesa de grupo -- HMO-303.
   *
   * O MESMO campo, com o MESMO nome, de `LinhaDoDetalhe.de_grupo`
   * (lib/pra-quem-pagar.ts, HMO-300). Os dois modos leem listas diferentes e
   * precisam do mesmo rotulo.
   *
   * ELE NAO E ENFEITE. Desde a HMO-303 esta lista inclui conta de grupo que
   * OUTRO membro lancou (o `OR` na consulta da rota), e `valor` e a minha fracao
   * dela -- nao o valor cheio. Uma conta de R$ 900,00 que a pessoa nunca
   * cadastrou, com um valor que nao bate com nada que ela digitou, e
   * indistinguivel de um bug. O painel do modo ja diz "minha parte do grupo"
   * (`ROTULO_DE_GRUPO`); esta tela precisava do equivalente.
   *
   * FALHA FECHADO: sem `group_id` no `select` da rota ele e `false` em toda
   * linha -- a lista perde o rotulo, e nao ganha um errado. O mesmo `select` e o
   * que alimenta a DIVISAO, entao a perda do rotulo nunca acontece sozinha: ela
   * vem junto com o valor cheio, que e o estado de antes desta issue.
   */
  de_grupo: boolean;
  /**
   * O cartao e o mes desta linha, so quando ela e fatura. `null` nas outras.
   *
   * UM OBJETO, E NAO DOIS CAMPOS SOLTOS: `accountId` sem `mes` monta um link
   * para o mes errado da fatura certa -- um destino plausivel e errado, que e o
   * tipo de defeito que ninguem reporta. Com o objeto, "tem cartao e nao tem
   * mes" e um estado que o tipo nao deixa existir.
   */
  fatura: { accountId: string; mes: string } | null;
  /**
   * ESTA PREVISAO PODE SER A FATURA DE UM CARTAO -- HMO-305.
   *
   * O MESMO campo, com o MESMO nome e o MESMO tipo, de
   * `LinhaDoDetalhe.fatura_suspeita` (lib/pra-quem-pagar.ts): as duas telas
   * mostram a mesma suspeita sobre a mesma linha, e quem decide e a MESMA funcao
   * (`suspeitasDeFaturaRepetida`, lib/elo-da-fatura.ts). Dois criterios para a
   * pergunta "esta previsao e a fatura?" dariam duas respostas na mesma sessao.
   *
   * `null` em toda linha realizada e em quase toda prevista. Ele so e preenchido
   * na previsao DIGITADA A MAO que cita o nome de um cartao com fatura ABERTA no
   * mesmo mes -- a mesma divida somada duas vezes, que e o mecanismo (b) da
   * HMO-298.
   *
   * NENHUM NUMERO DESTA TELA DEPENDE DELE. `resumoDaTela` nao o le; o
   * «Previsto» continua somando as duas linhas ate a PESSOA ligar o elo. A
   * de-duplicacao acontece depois, em `sintetizarFaturasAbertas`, pela chave
   * canonica que a rota gravou -- nao aqui.
   */
  fatura_suspeita: SuspeitaDeFatura | null;
  /**
   * O ELO JA LIGADO, e por isso desfazivel -- HMO-305.
   *
   * O MESMO campo de `LinhaDoDetalhe.elo_da_fatura` (lib/pra-quem-pagar.ts), pelo
   * MESMO criterio (`eloDesfazivel`), que e tambem o do `DELETE` da rota.
   *
   * Ele NAO e o mesmo que `fatura` logo acima, e a diferenca e a que importa:
   * `fatura` esta preenchido em TODA linha que e fatura -- inclusive a aberta
   * sintetizada e a fechada pelo `close` --, e serve para montar o link para a
   * tela do cartao. Este aqui so existe na previsao que uma PESSOA ligou, e e o
   * que poe na tela o caminho de volta. Oferecer o desfazer pelo `fatura` daria
   * um botao que a rota recusa com 409 em cima da fatura fechada.
   */
  elo_da_fatura: { accountId: string; mes: string } | null;
  /**
   * ESTA LINHA ENTRA NOS TOTAIS DE RELATORIO? -- HMO-443 / HMO-452.
   *
   * `false` so em lancamento REALIZADO que a pessoa desmarcou
   * (`financial_transactions.include_in_total = false`, migration 060). E o que
   * poe o selo na linha e o que decide o rotulo da acao -- ver
   * `lib/acoes-da-linha.ts`.
   *
   * POSITIVO E JA NORMALIZADO, e as duas metades sao decisao:
   *
   *   * POSITIVO como a coluna, que e positiva porque todo leitor dela e uma
   *     SOMA e a negacao dupla inverteria o total (o COMMENT da 060 diz isso
   *     com essas palavras). Um `fora_dos_totais` aqui seria a terceira
   *     polaridade da mesma pergunta no mesmo app, e o lugar onde ela se
   *     inverte calada;
   *   * `boolean` e nao `boolean | null | undefined`: quem constroi a linha ja
   *     resolveu o "nao sei" com `!== false` (ver `linhaRealizada`). Deixar o
   *     `undefined` chegar na tela faria cada leitor repetir a decisao, e o
   *     primeiro que escrevesse `!linha.soma_nos_totais` marcaria como fora dos
   *     totais TODA linha vinda do cache offline de antes da 060 -- justamente
   *     quando a tela nao tem rede para conferir.
   *
   * NAO E `include_in_total`, de proposito. Este tipo nao e a tabela: os campos
   * derivados dele se chamam `posso_editar`, `de_grupo`, `fatura_suspeita` --
   * nenhum e nome de coluna. Repetir o nome da coluna aqui convidaria a
   * atravessa-lo direto para um `.select()`, que e exatamente o defeito do #335
   * (PostgREST responde `42703` a select que NOMEIA coluna ausente, e a rota cai
   * em 500 antes da colagem).
   *
   * SEMPRE `true` NO PREVISTO, e nao e esquecimento: a coluna e de
   * `financial_transactions`, e a linha prevista e `scheduled_transactions` --
   * ela nao tem a coluna, nem a fatura sintetizada, que nao esta em tabela
   * nenhuma. Ver `linhaPrevista`.
   */
  soma_nos_totais: boolean;
}

/** Uma linha de `financial_transactions`, como a consulta a devolve. */
export interface RealizadaCrua extends LancamentoComConta {
  id: string;
  /**
   * De quem e a linha -- o que decide `posso_editar` (HMO-301).
   *
   * OPCIONAL, e a ausencia dele nao e um estado neutro: ela derruba
   * `posso_editar` para `false` e a linha sai sem botao nenhum. E a direcao
   * barata, e e deliberado que o `tsc` nao cobre a rota -- cobrar aqui tornaria
   * obrigatorio um campo que a fatura sintetizada nao tem. Quem cobra a fiacao
   * e a sonda textual de
   * scripts/test-contrato-das-telas-de-movimentacao.mjs.
   */
  user_id?: string | null;
  description?: string | null;
  amount: number;
  exchange_rate?: number | string | null;
  transaction_date?: string | null;
  currency?: string | null;
  /**
   * A linha soma nos totais de relatorio? (migration 060, HMO-443)
   *
   * OPCIONAL, E A AUSENCIA E UM ESTADO LEGITIMO -- nao a direcao barata de
   * sempre, e a diferenca importa: `linhaRealizada` resolve a ausencia com
   * `!== false`, ou seja "nao sei" vira "soma", que e o DEFAULT da coluna e o
   * comportamento de antes da feature. Os dois caminhos em que ela chega
   * ausente de verdade:
   *
   *   * o banco SEM a 060 colada. Ela e colada a mao no SQL Editor, depois do
   *     deploy (`deploy-ships-code-not-schema`), e o `select` da rota nao pode
   *     NOMEAR a coluna antes disso -- o PostgREST responde `42703` e a tela
   *     inteira cai em 500 (o defeito do #335);
   *   * o cache offline do aparelho (`lib/offline-cache.ts`). Linha guardada
   *     antes da 060 nao tem o campo, e e exatamente quando nao ha rede para
   *     conferir que um `=== true` marcaria TODA linha como fora dos totais.
   *
   * O custo da escolha esta nomeado: tirar a coluna do `select` da rota NAO
   * quebra `tsc` nem teste de unidade nenhum -- a tela simplesmente perde o
   * selo e a acao em toda linha, em silencio, e volta ao estado de antes desta
   * issue. Quem impede isso e a sonda textual de
   * scripts/test-contrato-das-telas-de-movimentacao.mjs, como com
   * `recurring_rule_id` e `user_id`.
   */
  include_in_total?: boolean | null;
  /**
   * A chave canonica da fatura, quando esta linha e uma perna do pagamento dela
   * -- HMO-264.
   *
   * `pagarFatura` (app/api/scheduled-transactions/[id]/pay/route.ts) copia
   * `scheduled_transactions.notes` para as DUAS pernas, entao a chave chega
   * aqui de graca: nao foi preciso coluna nova nem migration.
   *
   * OPCIONAL, E E A MESMA FAMILIA DE `account_type` E `recurring_rule_id` -- a
   * ausencia dele e um estado legitimo (quase toda linha realizada nao tem
   * nota), entao o `tsc` nao pode cobrar. Tirar `notes` do `select` da rota
   * numa limpeza de "campos nao usados na tela" nao quebra compilacao nem teste
   * de unidade: `ehPagamentoDaFatura` passa a receber `undefined` em toda linha,
   * para de casar, e a tela de Despesas volta a perder a fatura paga inteira --
   * o defeito desta issue, de volta e em silencio. Quem cobra a fiacao e a sonda
   * textual de scripts/test-contrato-das-telas-de-movimentacao.mjs.
   */
  notes?: string | null;
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
  /**
   * De quem e a conta prevista -- o que decide `posso_editar` (HMO-301).
   *
   * `undefined` na fatura aberta sintetizada, e esta certo: ela ja sai sem
   * botao por `gravada: false`. Ver `RealizadaCrua.user_id` para a direcao do
   * erro.
   */
  user_id?: string | null;
  description?: string | null;
  amount: number | string | null;
  due_date?: string | null;
  /**
   * O ESTADO DA PESSOA QUE ESTA LENDO -- `my_status` da view (HMO-411).
   *
   * ERA `status`, E A TROCA DE NOME E O PONTO. A rota desta tela traz a conta
   * de grupo do OUTRO membro de proposito (o `.or(group_id.not.is.null)` da
   * HMO-303), e `scheduled_transactions.status` e do DONO: a conta que o Helio
   * pagou saia do previsto da Lais no mesmo instante, sem que ela tivesse
   * resolvido a parte dela. A view 055 resolve isso por linha, e para conta
   * que nao e de grupo `my_status = status::text` sempre -- a troca nao muda
   * numero nenhum fora do grupo.
   *
   * OBRIGATORIO, E ISSO TAMBEM MUDOU. O campo antigo era opcional, e um
   * `String(undefined)` nunca cai em `STATUS_QUE_SAI_DO_PREVISTO`: a previsao
   * ja paga ficaria no previsto, inflando o numero, sem erro nenhum. Com o
   * campo obrigatorio o tsc aponta toda fonte que esqueceu de traze-lo -- e as
   * fontes nao sao so a view: a fatura sintetizada e a parcela do MyBank sao
   * montadas em JS, e as duas tiveram de ganhar o campo.
   */
  my_status: string;
  /** `my_effective_status` da view -- o unico que sabe dizer 'overdue' para MIM. */
  my_effective_status?: string | null;
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
  /**
   * O embed da conta, na linha gravada. Mesmas duas formas.
   *
   * `id` ENTROU NA HMO-305, e e o que distingue a previsao DIGITADA que alguem
   * ligou a uma fatura (a conta de onde o dinheiro sai) da fatura FECHADA que o
   * `close` criou (o proprio cartao) -- as duas tem a mesma chave em `notes`.
   * OPCIONAL: sem ele no `select` da rota, `elo_da_fatura` sai `null` e a linha
   * perde o caminho de volta, sem que numero nenhum mude.
   */
  account?:
    | { id?: string | null; name?: string | null }
    | { id?: string | null; name?: string | null }[]
    | null;
  /** O nome do cartao, na fatura sintetizada (ela nao tem embed). */
  account_name?: string | null;
  /**
   * A chave canonica da fatura sintetizada, que vira a chave da lista -- e,
   * desde a HMO-285, tambem o criterio de `natureza: "fatura"`. A fatura
   * FECHADA e uma `scheduled_transaction` com esta mesma chave em `notes`,
   * entao o criterio pega as duas de uma vez.
   */
  notes?: string | null;
  /**
   * A regra recorrente que gerou esta ocorrencia, quando ela veio de uma
   * (coluna `recurring_rule_id` da view, 005/027). `null` na previsao avulsa.
   *
   * A fatura sintetizada nao tem este campo, e esta certo: ela nao nasce de
   * regra nenhuma -- e calculada de `card_invoice_lines` a cada leitura.
   */
  recurring_rule_id?: string | null;
  /**
   * O grupo da despesa, quando ela e de grupo -- HMO-303.
   *
   * De onde sai `LinhaDaTela.de_grupo`, o ROTULO. O `amount` que chega aqui JA e
   * a minha parte: quem divide e `previstasComAMinhaParte`
   * (lib/parte-do-grupo.ts), na rota, antes de `linhasDaTela`.
   *
   * POR QUE A DIVISAO NAO MORA NESTE ARQUIVO: importar `parte-do-grupo` aqui
   * traria `fechamento-do-grupo` + `recurrence` para dentro do grafo que o
   * tsconfig desta suite compila -- e seis outras suites o incluem. A divisao e
   * uma funcao pura com teste proprio do outro lado da fronteira; o que atravessa
   * e um numero.
   *
   * `undefined` na fatura sintetizada, e esta certo: fatura de cartao nao e de
   * grupo.
   */
  group_id?: string | null;
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
 * O MINIMO que "qual das duas pernas e esta" precisa ler -- HMO-317.
 *
 * NAO CONFUNDIR com `PernaDeTransferencia` de lib/transferencia.ts: aquele e a
 * linha a ESCREVER (conta, descricao, valor e tipo que o `insert` monta), este e
 * o pouco que se LE de uma linha ja gravada para saber de que lado ela esta.
 *
 * Ele existe porque `ehPernaDeEntrada` passou a ser consultado tambem por
 * `ehPagamentoDaFatura`, que responde pelos dois leitores do pagamento da fatura
 * e portanto recebe DUAS formas de linha (`RealizadaCrua` aqui,
 * `LinhaDoRealizado` em lib/realizado-do-caixa.ts). Um parametro estrutural
 * minimo e o que deixa a mesma funcao servir as duas sem que nenhuma das duas
 * precise inventar campo que ela nao tem.
 */
export interface PernaDeTransferenciaCrua {
  amount: number | string;
  /** O elo do 015. Preenchido APENAS na perna de entrada. */
  counterpart_transaction_id?: string | null;
}

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
 *
 * ESSA ULTIMA FRASE E SOBRE A TELA DE TRANSFERENCIAS, E SO SOBRE ELA. Quem
 * tambem consulta esta funcao e `ehPagamentoDaFatura`, e la a pergunta e outra
 * ("esta perna e a fatura se realizando?"): um par de zero responde NAO nas
 * duas, por um criterio de sinal proprio escrito la. Nenhuma linha desaparece
 * com isso -- o par de zero continua inteiro AQUI, que e a tela onde ele mora.
 * Ver a decisao do zero no cabecalho de `ehPagamentoDaFatura` (HMO-317).
 *
 * ELA RESPONDE «QUAL DAS DUAS», E NAO «ESTA LINHA DEVE SAIR DA TELA» -- HMO-380.
 * A diferenca entre as duas perguntas so aparece quando nao ha duas: a perna que
 * o MyBank grava quando uma CONEXAO paga e uma linha positiva sem elo e sem par
 * (armadilha 7 do cabecalho), e pelo criterio do sinal ela responde `true` aqui.
 * Isso continua CERTO -- a pergunta desta funcao e sobre o lado da linha --, e
 * por isso a excecao mora em `linhasDaTela`, onde `ehEntradaSoltaDoMyBank`
 * desarma o `continue`. Acrescentar o caso do MyBank AQUI exigiria que os dois
 * leitores da fatura paga passassem a ler a nota so para nao de-duplicar uma
 * linha que nenhum dos dois ve.
 */
export function ehPernaDeEntrada(crua: PernaDeTransferenciaCrua): boolean {
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
 * O `transaction_type` GRAVADO das duas pernas do pagamento da fatura (015).
 *
 * Constante e nao a string solta em `ehPagamentoDaFatura` pelo mesmo motivo de
 * `TIPO_CARTAO`: um typo nao da erro nenhum, so para de casar -- e aqui o filtro
 * que para de casar devolve o defeito desta issue (a fatura paga fora dos dois
 * lados) em vez de um total inflado.
 */
export const TIPO_DA_PERNA_DE_PAGAMENTO = "transfer";

/**
 * O MINIMO que "esta linha e a fatura paga" precisa ler -- HMO-317.
 *
 * ESTE TIPO EXISTE PARA QUE A PERGUNTA TENHA UM DONO SO. `ehPagamentoDaFatura`
 * responde pelos DOIS leitores do pagamento da fatura -- a tela de Despesas
 * (`linhasDaTela`, aqui) e o Realizado do painel
 * (`realizadoComCartaoPelaFatura`, lib/realizado-do-caixa.ts) --, e as duas
 * listas chegam com formas diferentes: `RealizadaCrua` aqui,
 * `LinhaDoRealizado` la.
 *
 * E ESTRUTURAL E MINIMO, E NAO A UNIAO DAS DUAS. Pedir `RealizadaCrua` obrigaria
 * o painel a inventar `id`, `description` e `transaction_date` que ele nao le --
 * e campos inventados num parametro sao exatamente o que faz um chamador passar
 * um objeto plausivel e errado. Pedir a uniao faria o tipo crescer a cada campo
 * novo de qualquer um dos dois lados. Os QUATRO campos -- `amount` e
 * `counterpart_transaction_id` herdados, `transaction_type` e `notes` aqui --
 * sao os que os tres criterios de fato leem, e nada mais entra sem um criterio
 * que o use.
 *
 * `amount` aceita `string` porque o PostgREST devolve `numeric` como string, e e
 * `LinhaDoRealizado` que ja admite as duas formas. Os outros tres sao opcionais
 * porque a ausencia deles e o estado da maioria das linhas -- nao e frouxidao, e
 * o que permite a MESMA funcao receber a parte de grupo convertida por
 * `partesComoTransacoes` (lib/parte-do-grupo-realizada.ts), que nao tem nota nem
 * elo.
 *
 * O NOME FICOU MAIS ESTREITO QUE O USO NA HMO-380, E ISSO E DELIBERADO.
 * `ehEntradaSoltaDoMyBank` le exatamente os MESMOS quatro campos -- chave
 * canonica em `notes`, `transaction_type` cru, elo do 015 e sinal -- porque as
 * duas perguntas sao da mesma familia ("que perna de transferencia e esta, e de
 * que chave canonica ela e"). Um segundo tipo identico com outro nome nao
 * acrescentaria campo nenhum e faria o `tsc` deixar de cobrar que os dois
 * criterios leiam a mesma forma de linha; renomear este para algo neutro
 * custaria o cabecalho acima, que e onde a decisao de NAO pedir `RealizadaCrua`
 * esta escrita. Se um dia uma das duas precisar de um quinto campo, e ai que os
 * tipos se separam.
 */
export interface PernaDoPagamentoDaFatura extends PernaDeTransferenciaCrua {
  transaction_type?: string | null;
  /** A chave canonica (`fatura:...` ou `mybank:...`) que esta linha carrega. */
  notes?: string | null;
}

/**
 * Esta linha realizada e A FATURA PAGA -- a perna de SAIDA do pagamento dela?
 *
 * Armadilha 6 do cabecalho. "Despesas do cartao sao todas previstas e se tornam
 * realizadas para todos os fins apos cartao ser pago."
 *
 * ELA E A DONA UNICA DA PERGUNTA, NOS DOIS LEITORES -- HMO-317
 * -----------------------------------------------------------
 * Dois lugares do app precisam saber se uma linha e a fatura paga, e ate a
 * HMO-317 cada um tinha a sua copia dos criterios:
 *
 *   * a tela de DESPESAS (`linhasDaTela`, logo abaixo), onde a resposta decide
 *     se a linha entra no Realizado e se ela se apresenta como «Fatura»;
 *   * o Realizado do PAINEL (`realizadoComCartaoPelaFatura`,
 *     lib/realizado-do-caixa.ts, HMO-265), onde ela decide se o
 *     `transaction_type` da linha e reescrito para `expense` -- o unico jeito de
 *     a fatura entrar num agregado que deixa `transfer` de fora.
 *
 * A copia de la (`ehSaidaDePagamentoDeFatura`) tinha os mesmos criterios
 * escritos a mao e JA DIVERGIA desta em `amount === 0`. Nenhum total mudava com
 * isso, e era justamente por isso que importava: duas copias de um criterio de
 * DINHEIRO que ninguem compara sao a forma exata do defeito que este
 * repositorio ja pagou caro -- a proxima mudanca em um dos dois lados (um quarto
 * criterio, a chave ganhando um segundo prefixo como o `ajuste-de-fatura:` da
 * HMO-253) entraria em UM deles, e o painel e a tela passariam a discordar sobre
 * o mesmo pagamento sem nada ficar vermelho.
 *
 * O DONO E ESTE ARQUIVO, E NAO O OUTRO, porque a direcao do import ja estava
 * escolhida: `realizado-do-caixa` JA importa `TIPO_CARTAO` e
 * `TIPOS_QUE_ENTRAM_NA_FATURA` daqui (foi para isso que a segunda deixou de ser
 * privada na HMO-265). Inverter fecharia um ciclo e obrigaria a acrescentar
 * `realizado-do-caixa` a `DEPENDENCIAS` de
 * scripts/mutantes-telas-de-movimentacao.mjs, onde ele arrastaria `card-invoice`
 * -> `transferencia` -> `lancamento` atras dele: todo mutante deste modulo
 * deixaria de COMPILAR, "morreria" por motivo errado, e o placar viraria 100%
 * sem medir nada.
 *
 * O CONTROLE QUE PROVA QUE OS DOIS LEITORES CONCORDAM esta em
 * scripts/test-realizado-do-caixa.mjs ("os dois leitores da fatura paga
 * concordam, linha por linha"), que e a UNICA suite cuja arvore compila os dois
 * modulos. Ele passa a MESMA matriz de linhas pelos dois e afirma que a resposta
 * desta funcao e exatamente o que cada leitor faz com a linha -- um controle que
 * nao existia em lugar nenhum enquanto havia duas copias.
 *
 * SAO TRES CRITERIOS, E NENHUM DOS TRES E ZELO -- cada um dos dois ultimos
 * impede uma forma diferente de contar o mesmo dinheiro duas vezes:
 *
 *   * A CHAVE CANONICA em `notes` (`fatura:AAAA-MM-01:<cartao>`). E o unico
 *     criterio que diz "esta linha e uma fatura", e e deliberadamente o MESMO do
 *     lado previsto (`faturaDaChave` em `linhaPrevista`) -- dois criterios para a
 *     mesma pergunta dariam duas respostas na mesma tela. Pelo tipo da CONTA nao
 *     daria: a perna de saida mora na conta CORRENTE, e e a assinatura cobrada
 *     no cartao que tem `account_id` de cartao sem ser fatura (ver o cabecalho de
 *     lib/card-invoice.ts).
 *
 *     `faturaDaChave` E A UNICA LEITURA DA CHAVE, e ela esta ancorada nas duas
 *     pontas (lib/chave-da-fatura.ts): o `ajuste-de-fatura:` da HMO-253 tem
 *     prefixo PROPRIO e nao casa aqui, de proposito. Se um dia a chave ganhar um
 *     segundo prefixo que DEVA casar, ele entra naquele arquivo-folha e os dois
 *     leitores desta funcao mudam juntos -- que e exatamente o que duas copias
 *     do criterio nao davam.
 *
 *   * O `transaction_type` GRAVADO E `transfer`. Quem ele separa e a PREVISAO
 *     DIGITADA que alguem ligou ao elo da fatura (HMO-305): ligar o elo grava a
 *     chave canonica em `scheduled_transactions.notes`, e a baixa comum copia
 *     `notes` para a linha de `financial_transactions` que ela cria -- uma linha
 *     `expense`, negativa, com a chave e sem contraparte, indistinguivel da
 *     perna de saida por tudo menos esta coluna.
 *
 *     Sem este criterio ela NAO seria somada duas vezes (o ramo da fatura em
 *     `linhasDaTela` faz `continue`, entao ela entra uma vez pelo ramo novo em
 *     vez do filtro de tipo) -- e e justamente por isso que o preco e facil de
 *     subestimar. O que ela perde e o resto: `natureza: "fatura"` tira dela o
 *     Editar e o Excluir (`podeAgirNaLinha` recusa toda linha de fatura,
 *     lib/acoes-da-linha.ts) e lhe da um link para um cartao que NAO e o lugar
 *     onde aquela despesa aconteceu. Uma despesa comum da conta corrente que
 *     deixa de ser editavel e se apresenta como fatura de um cartao e um estado
 *     que nao da erro nenhum e que nao tem saida pela tela.
 *
 *     E ele tem um segundo efeito, mais caro e mais raro: o ramo da fatura
 *     passa POR CIMA de `ehGastoNoCartao`. Uma linha `expense` na conta de um
 *     CARTAO que carregue a chave entraria no Realizado sem a peneira da
 *     armadilha 5 -- somada solta ali e dentro da fatura que o Previsto soma, o
 *     defeito da HMO-260 de volta.
 *
 *     A leitura e da coluna CRUA e nao de `classificarMovimentacao`, pela mesma
 *     razao de `ehGastoNoCartao`: aquele deriva o tipo da categoria ou do sinal
 *     quando a coluna e nula, e pelo sinal a perna de saida e uma despesa.
 *
 *     ESTE CRITERIO E INVISIVEL PARA O LEITOR DO PAINEL, e e por isso que o
 *     mutante dele vive so no mutador DESTA lib: la a resposta `true` apenas
 *     reescreve `transaction_type` para `expense`, e a unica linha que o
 *     criterio separa (a despesa do elo da HMO-305) JA e `expense` -- promove-la
 *     nao mudaria um centavo. Do lado de la ele segue sendo invariante
 *     documentado; quem o mede e esta tela, onde ele decide `natureza`.
 *
 *   * E DINHEIRO DE FATO SAIU NESTA PERNA. As duas pernas carregam a MESMA
 *     chave (`pagarFatura` copia `notes` nas duas), a mesma data e o mesmo valor
 *     com sinais opostos. Contar as duas nao daria o dobro -- daria ZERO, porque
 *     `valorEmReais` passa `Math.abs` e as duas somariam +1.290 no Realizado,
 *     ou seja R$ 2.580 de uma fatura de R$ 1.290. E a armadilha 3 do cabecalho
 *     com outra roupa.
 *
 *     SAO DUAS LINHAS PARA ISSO, E A SEGUNDA E QUE DECIDE O ZERO:
 *
 *       1. `ehPernaDeEntrada` -- o dono unico de "qual das duas pernas e esta",
 *          o mesmo que a tela de Transferencias consulta. Ele tem DOIS criterios
 *          (o elo do 015, que e de uma via, e o sinal, que pega a perna cujo elo
 *          a FK `ON DELETE SET NULL` zerou). Uma segunda implementacao de "qual
 *          das duas pernas" divergiria da primeira no dia em que uma das duas
 *          mudasse -- e essa divergencia e o que esta issue existe para fechar.
 *
 *       2. o sinal ESTRITO. `ehPernaDeEntrada` responde `false` para as DUAS
 *          linhas de um par de valor ZERO sem elo, de proposito: na tela de
 *          Transferencias esconder uma delas seria apagar um lancamento que a
 *          pessoa criou. Aqui a pergunta e outra -- "esta perna e a fatura se
 *          realizando?" -- e a resposta para um par de zero e NAO, nas duas.
 *          Ver a decisao do zero logo abaixo.
 *
 *     A GUARDA 1 E REDUNDANTE EM TODO ESTADO QUE O APP ALCANCA, e isto esta
 *     escrito para que ninguem a "cubra" depois forjando estado. Com o sinal
 *     estrito, a unica linha que a guarda 1 pega e a 2 nao e a que tem a chave,
 *     o tipo `transfer`, valor NEGATIVO e o elo preenchido -- e nenhum caminho
 *     de escrita produz isso: `pernasDoPagamentoDeFatura` grava `-total` na
 *     saida SEM elo e `+total` na entrada COM elo (lib/card-invoice.ts ->
 *     `pernasDaTransferencia`, e o `insert` da entrada em
 *     app/api/scheduled-transactions/[id]/pay/route.ts). Um mutante que apagasse
 *     SO a guarda 1 portanto SOBREVIVERIA, e a lista de mutantes nao finge
 *     cobri-la -- o que ela mede e o par das duas linhas removido junto (a
 *     fatura em DOBRO) e a linha 2 sozinha (o zero). A guarda fica porque e
 *     barata e porque o elo e o criterio que continua valendo se um dia o sinal
 *     deixar de valer -- numa perna de cambio, por exemplo. Mesma escolha que o
 *     criterio do `transaction_type` faz do lado do painel.
 *
 * A DECISAO DO `amount === 0`, QUE TINHA DUAS RESPOSTAS E AGORA TEM UMA
 * --------------------------------------------------------------------
 * Um par de pagamento de valor zero (a baixa aceita `valorPago`, e
 * `pernasDoPagamentoDeFatura` faz `Math.abs`, entao as duas pernas saem `0`)
 * ficava FORA no painel (o sinal estrito de `ehSaidaDePagamentoDeFatura`) e
 * ENTRAVA na tela de Despesas (por `ehPernaDeEntrada`, que deixa as duas linhas
 * de zero passarem). As duas justificativas estavam certas para a pergunta de
 * cada arquivo; a decisao unica e FICA FORA, nos dois, por tres razoes:
 *
 *   * NENHUMA LINHA DESAPARECE DO APP. O par de zero continua inteiro na tela de
 *     Transferencias -- quem decide la e `ehPernaDeEntrada`, que nao mudou --, e
 *     e la que uma transferencia de valor zero tem casa. O argumento que
 *     justificava deixa-lo entrar ("esconder seria a tela apagando um lancamento
 *     que a pessoa criou") e sobre a tela de Transferencias, e continua de pe
 *     exatamente onde foi escrito. Aqui ele nunca se aplicou: a linha nao e
 *     escondida, ela so nao e chamada de fatura realizada.
 *
 *   * NO PAINEL O ZERO NAO E INOFENSIVO. Promover as duas pernas soma R$ 0,00 ao
 *     total -- e acrescenta DOIS ao `transaction_count` de `agregarTransacoes`
 *     (lib/periodo-do-painel.ts), que e o tile «Lancamentos». Um total que nao
 *     mudou ao lado de uma contagem que subiu e a forma de erro que este
 *     repositorio mais paga: plausivel, sem excecao e sem log.
 *
 *   * E A RESPOSTA CABE NO NOME DA FUNCAO. Ela pergunta qual perna e a de SAIDA
 *     -- a que diz quanto dinheiro saiu da conta. Num par de zero nao saiu
 *     dinheiro em nenhuma das duas, e eleger uma delas exigiria um criterio
 *     (o elo) que descreve o PAR, nao o movimento.
 *
 * NAO HA CRITERIO DE STATUS AQUI, e nao e esquecimento: a perna SO EXISTE
 * porque a fatura foi paga -- quem a grava e `pagarFatura`, no mesmo pedido que
 * marca `status: 'paid'`. Reler `scheduled_transactions.status` seria uma
 * segunda consulta para confirmar o que a existencia da linha ja afirma, e ela
 * discordaria da primeira no instante entre as duas escritas.
 */
export function ehPagamentoDaFatura(crua: PernaDoPagamentoDaFatura): boolean {
  if (!faturaDaChave(crua.notes)) return false;
  if (String(crua.transaction_type) !== TIPO_DA_PERNA_DE_PAGAMENTO) return false;
  if (ehPernaDeEntrada(crua)) return false;
  return Number(crua.amount) < 0;
}

/**
 * O PREFIXO DO ELO DA PARCELA DO MYBANK -- `chaveDaParcelaDoMyBank` (HMO-370).
 *
 * A string esta REPETIDA aqui, e nao importada, e a razao e a mesma pela qual
 * `TIPO_DA_PERNA_DE_PAGAMENTO` tambem vive neste arquivo: o `tsconfig` das
 * suites que compilam este modulo tem `rootDir: lib`, e `lib/emprestimo-do-mybank.ts`
 * importa `@/lib/lancamento` -- um import a mais na arvore de quem so quer a
 * lista da tela. O que impede as duas copias de divergirem e
 * `scripts/test-leituras-do-mybank.mjs`, que afirma a igualdade entre esta
 * constante e `chaveDaParcelaDoMyBank("x")` -- se o prefixo mudar la, a suite
 * reprova aqui.
 */
const PREFIXO_DA_PARCELA_DO_MYBANK = "mybank:";

/** `transaction_type` com que a parcela do auto-emprestimo e PREVISTA (F2). */
const TIPO_DA_PARCELA_DO_MYBANK = "transfer";

/**
 * A linha carrega o ELO da parcela do MyBank?
 *
 * UMA FUNCAO E NAO DOIS `startsWith`, porque desde a HMO-380 sao DOIS
 * consultores -- `ehParcelaDoAutoEmprestimo` (lado previsto) e
 * `ehEntradaSoltaDoMyBank` (lado realizado) --, e duas copias do criterio de uma
 * chave canonica sao a forma exata do defeito que o cabecalho de
 * `ehPagamentoDaFatura` descreve: a proxima mudanca na chave (um segundo
 * prefixo, como o `ajuste-de-fatura:` da HMO-253) entraria em UM dos dois, e as
 * duas abas passariam a discordar sobre a MESMA parcela sem nada ficar vermelho.
 *
 * `startsWith` e nao `includes`: `guard-de-includes-casa-dentro-de-identificador-maior`
 * -- uma nota que CITE `mybank:` no meio de uma frase ("paguei fora do mybank:
 * dinheiro") nao e o elo, e o elo e sempre o comeco da string porque
 * `chaveDaParcelaDoMyBank` o constroi com template.
 */
const temOEloDaParcelaDoMyBank = (notas: unknown): boolean =>
  String(notas ?? "").startsWith(PREFIXO_DA_PARCELA_DO_MYBANK);

/**
 * Esta previsao e a parcela de um AUTO-EMPRESTIMO do MyBank?
 *
 * POR QUE ELA PRECISA DE UMA EXCECAO (HMO-372, leitura 2 de 7)
 * -----------------------------------------------------------
 * A decisao 1 da HMO-368 diz, aprovada: o auto-emprestimo e GRAVADO como
 * transferencia (e so assim o «Total de contas» fica certo -- o dinheiro vai da
 * minha conta corrente para a minha conta de investimento, e patrimonio nenhum
 * muda) e APARECE em Despesas (porque no dia 10 saem R$ 1.000 da conta
 * corrente, que e a pergunta que a aba Despesas passou a responder na HMO-364:
 * "quanto sai da sua conta", e nao "o que deixou de ser seu").
 *
 * Sem esta excecao as duas metades da decisao se excluem: `linhaPrevista`
 * deriva `tipo` de `direction`, `direction` e `'transfer'`, e a peneira
 * `linha.tipo === tipo` manda a parcela SO para a aba Transferencias. A pessoa
 * abre Despesas no dia 9, nao ve a parcela, e conclui que o MyBank nao cobrou.
 *
 * E A LINHA CONTINUA EM TRANSFERENCIAS, nas duas abas, pelo mesmo mecanismo e
 * pela mesma razao da fatura paga (`ehPagamentoDaFatura`): o «Total» de cada aba
 * e o da propria aba, entao nao ha numero nenhum em que ela entre duas vezes --
 * e tira-la de Transferencias esconderia uma transferencia de verdade, que e o
 * que aquela aba existe para listar.
 *
 * OS DOIS CRITERIOS SAO OBRIGATORIOS, e o `transaction_type` e o que importa:
 * sem ele, qualquer previsao de RECEITA que alguem anotasse com a palavra
 * `mybank:` em `notes` entraria na aba Despesas. Com ele, so a linha que a F2
 * grava casa -- `previsoesDoEmprestimo` e o unico lugar do app que escreve as
 * duas coisas juntas.
 */
export function ehParcelaDoAutoEmprestimo(crua: {
  notes?: string | null;
  direction?: string | null;
}): boolean {
  if (String(crua.direction ?? "") !== TIPO_DA_PARCELA_DO_MYBANK) return false;
  return temOEloDaParcelaDoMyBank(crua.notes);
}

/** O prefixo, para a suite afirmar que ele nao divergiu da F2. */
export const PREFIXO_DO_ELO_DO_MYBANK = PREFIXO_DA_PARCELA_DO_MYBANK;

/**
 * `direction` com que a parcela que o DEVEDOR deve chega na agenda (HMO-372).
 *
 * `'expense'` E NAO `'transfer'`, e a assimetria com `TIPO_DA_PARCELA_DO_MYBANK`
 * logo acima e a decisao de dinheiro escrita no cabecalho de
 * `ParcelaDevidaNaAgenda.direction` (lib/leituras-do-mybank.ts): no
 * auto-emprestimo o dinheiro vai da minha conta corrente para a MINHA conta de
 * investimento (patrimonio nenhum muda, logo `transfer`), enquanto aqui ele sai
 * das contas da devedora para a conta de OUTRA PESSOA -- ele deixa de ser dela.
 *
 * A string esta repetida aqui pela razao de `PREFIXO_DA_PARCELA_DO_MYBANK`: a
 * fonte e `lib/leituras-do-mybank.ts`, que importa `@/lib/emprestimo-do-mybank`
 * -> `@/lib/lancamento`, e esse import nao cabe na arvore que o `rootDir: lib`
 * das suites deste modulo compila.
 */
const DIRECAO_DA_PARCELA_DEVIDA_DO_MYBANK = "expense";

/**
 * Esta previsao e a parcela que EU DEVO a uma conexao do MyBank -- HMO-377?
 *
 * O CASO B, QUE A HMO-372 DEIXOU DE FORA DESTA TELA DE PROPOSITO
 * -------------------------------------------------------------
 * A parcela do devedor NAO esta em `scheduled_transactions`: o credor nao pode
 * gravar linha no meu nome (a RLS daquela tabela e `user_id = auth.uid()`, e
 * deveria recusar). Ela sai da view `mybank_due_entries`, e ate esta issue
 * entrava em DUAS leituras -- Contas a Pagar e o safe-to-spend -- e em nenhuma
 * aba de Movimentacoes. Medido na main 40c7b01, do lado da devedora: Contas a
 * Pagar somava R$ 1.200,00 (R$ 200 de luz + a parcela de R$ 1.000) e a aba
 * Despesas do MESMO periodo respondia R$ 200,00, com uma linha so. Duas telas
 * do mesmo app, dois numeros para a mesma divida, e nada na tela dizendo por
 * que: a familia `despesa-de-grupo-tem-tres-convencoes`, que este repositorio
 * ja pagou quatro vezes.
 *
 * ESTA FUNCAO SO DECIDE O SELO, E NAO SE A LINHA ENTRA
 * ---------------------------------------------------
 * E a diferenca dela para `ehParcelaDoAutoEmprestimo`, e ela vem da `direction`.
 * A linha do Caso A e `transfer` na coluna, entao a peneira `linha.tipo === tipo`
 * de `linhasDaTela` a mandaria SO para a aba Transferencias -- ela precisa de uma
 * excecao para alcancar Despesas. A do Caso B ja chega `expense`
 * (`parcelasDevidasNaAgenda`), entao ela entra em Despesas pelo caminho comum e
 * fica fora das outras duas sem excecao nenhuma. Isso tambem e o que impede ela
 * de aparecer em Transferencias: nada andou entre duas contas MINHAS, e aquela
 * aba afirma exatamente isso.
 *
 * OS DOIS CRITERIOS SAO OBRIGATORIOS, e e o mesmo par de
 * `ehParcelaDoAutoEmprestimo` com a outra direcao -- a chave canonica sai do
 * `temOEloDaParcelaDoMyBank` que as duas chamam, para que o dia em que a chave
 * ganhar um segundo prefixo mude UM lugar e nao dois
 * (`fontes-consistentes-que-discordam`).
 *
 * `direction` E O CRITERIO QUE IMPORTA, pela mesma razao escrita naquele
 * cabecalho: sem ele, qualquer previsao que alguem anotasse com a palavra
 * `mybank:` em `notes` levaria o selo. Com ele, o que sobra e uma previsao de
 * DESPESA digitada a mao cujas notas comecam por `mybank:` -- e o custo desse
 * caso e um ROTULO a mais numa linha, nunca um numero: `natureza` nao entra em
 * soma nenhuma (`resumoDaTela` nao a le) e `gravada` continua decidindo os
 * botoes. E a mesma exposicao que o Caso A aceita desde a HMO-372, e errar para
 * o lado do rotulo e o barato.
 *
 * AS DUAS SAO MUTUAMENTE EXCLUSIVAS PELA `direction`, e e por isso que a ordem
 * entre elas em `linhaPrevista` nao decide nada: `'transfer'` e `'expense'` nao
 * podem ser a mesma string.
 */
export function ehParcelaDevidaDoMyBank(crua: {
  notes?: string | null;
  direction?: string | null;
}): boolean {
  if (String(crua.direction ?? "") !== DIRECAO_DA_PARCELA_DEVIDA_DO_MYBANK) {
    return false;
  }
  return temOEloDaParcelaDoMyBank(crua.notes);
}

/**
 * Esta linha realizada e a perna de entrada SOLTA do pagamento do MyBank?
 *
 * Armadilha 7 do cabecalho, e e lá que esta a decisao de produto ("ela volta
 * para a aba Transferencias"). Aqui estao os criterios.
 *
 * O ESTADO QUE ELA DESCREVE E «ENTROU DINHEIRO E NAO HA PERNA DE SAIDA MINHA».
 * Quem o grava e app/api/mybank/installments/[id]/route.ts quando o CREDOR
 * confirma que recebeu: `pernaDeEntradaDoPagamento` monta so a `entrada` de
 * `pernasDaTransferencia`, porque a saida aconteceu na conta de OUTRA PESSOA e
 * nao existe em `financial_transactions` nenhuma.
 *
 * SAO QUATRO CRITERIOS, E CADA UM SEPARA UMA COISA DIFERENTE:
 *
 *   * o `transaction_type` GRAVADO E `transfer`. Sem ele, qualquer receita que
 *     alguem anotasse com `mybank:` em `notes` deixaria de ser de-duplicada --
 *     e a leitura e da coluna CRUA e nao de `classificarMovimentacao`, pela
 *     mesma razao de `ehGastoNoCartao`: aquele deriva o tipo do sinal quando a
 *     coluna e nula, e pelo sinal esta perna e uma receita.
 *
 *   * a CHAVE CANONICA em `notes` (`mybank:<id da parcela>`). E o unico criterio
 *     que diz "esta linha e uma parcela do MyBank", e e deliberadamente o MESMO
 *     do lado previsto (`ehParcelaDoAutoEmprestimo`, pelo
 *     `temOEloDaParcelaDoMyBank` que os dois chamam).
 *
 *   * O ELO DO 015 ESTA NULO, E E ELE QUE SEPARA O CASO B DO CASO A. E o
 *     criterio que esta funcao existe para ter: no auto-emprestimo (Caso A) a
 *     baixa da previsao grava as DUAS pernas com a MESMA nota `mybank:`
 *     (`comum.notes` em app/api/scheduled-transactions/[id]/pay/route.ts,
 *     HMO-382) e o elo na de entrada. Sem este criterio a armadilha 3 voltaria
 *     para o Caso A inteiro: as duas pernas de uma parcela de R$ 1.000
 *     entrariam na aba, R$ 2.000 no total, com as duas linhas na lista ao lado
 *     dizendo a mesma descricao e a mesma data.
 *
 *     Ele tambem e o criterio que continua valendo se um dia o MyBank passar a
 *     gravar par -- e a perna solta deixar de existir e so o fazer parar de
 *     casar aqui e a direcao barata: a linha volta a ser de-duplicada pela
 *     armadilha 3, que e o certo para um par.
 *
 *   * O SINAL E POSITIVO. Ele e o que faz esta funcao responder sobre a MESMA
 *     linha que `ehPernaDeEntrada` tirou, e so sobre ela. A perna NEGATIVA de
 *     uma parcela do MyBank -- a saida do Caso A, que tem a nota e nao tem elo
 *     -- nunca foi descartada pela armadilha 3, entao um `true` aqui sobre ela
 *     nao mudaria TOTAL nenhum. O que ele decide e o SELO: sem este criterio a
 *     saida de um par viria com `natureza: "mybank"`, que e o rotulo de uma
 *     linha SEM par, dizendo que nao houve contrapartida numa transferencia que
 *     tem as duas pernas gravadas. E ele e tambem o que impede a de-duplicacao
 *     do par de ser desarmada pelo OUTRO lado no estado que
 *     `ON DELETE SET NULL` permite (os dois sem elo).
 *
 * NAO HA CRITERIO DE STATUS DA PARCELA, pela mesma razao de
 * `ehPagamentoDaFatura`: a linha SO EXISTE porque o credor confirmou, no mesmo
 * pedido que leva a parcela a `paid`. Reler `mybank_installments.status` seria
 * uma segunda consulta para confirmar o que a existencia da linha ja afirma.
 */
export function ehEntradaSoltaDoMyBank(crua: PernaDoPagamentoDaFatura): boolean {
  if (String(crua.transaction_type) !== TIPO_DA_PARCELA_DO_MYBANK) return false;
  if (!temOEloDaParcelaDoMyBank(crua.notes)) return false;
  if (texto(crua.counterpart_transaction_id)) return false;
  return Number(crua.amount) > 0;
}

/**
 * Esta linha realizada e a perna de SAIDA da parcela PAGA do auto-emprestimo?
 *
 * Armadilha 8 do cabecalho, e e lá que esta a decisao de produto ("a parcela
 * paga continua em Despesas, e com o selo"). Aqui estao os criterios.
 *
 * O ESTADO QUE ELA DESCREVE E «A PARCELA DO CASO A FOI PAGA». Quem o grava e a
 * baixa da previsao (app/api/scheduled-transactions/[id]/pay/route.ts, HMO-382):
 * `pernasDaTransferencia` monta as DUAS pernas, `comum.notes` leva a MESMA chave
 * `mybank:<id da parcela>` para as duas, e o elo do 015 fica so na de ENTRADA.
 * Esta funcao responde pela de SAIDA -- a que diz quanto saiu da conta corrente,
 * que e a pergunta da aba Despesas desde a HMO-364.
 *
 * SAO TRES CRITERIOS, E CADA UM SEPARA UMA COISA DIFERENTE:
 *
 *   * o `transaction_type` GRAVADO E `transfer`. Sem ele a excecao passa a
 *     engolir linhas que o caminho COMUM deveria peneirar, e a peneira que
 *     importa e `ehGastoNoCartao`: uma compra no cartao cujas notas comecassem
 *     por `mybank:` escaparia da armadilha 5 e contaria duas vezes -- dentro da
 *     fatura e como compra. A leitura e da coluna CRUA e nao de
 *     `classificarMovimentacao`, pela mesma razao de `ehGastoNoCartao`: aquele
 *     deriva o tipo do SINAL quando a coluna e nula, e pelo sinal esta perna e
 *     uma despesa comum.
 *
 *   * a CHAVE CANONICA em `notes` (`mybank:<id da parcela>`), pelo
 *     `temOEloDaParcelaDoMyBank` que os outros tres consultores do MyBank
 *     tambem chamam -- para que o dia em que a chave ganhar um segundo prefixo
 *     mude UM lugar e nao quatro (`fontes-consistentes-que-discordam`).
 *
 *   * O SINAL E NEGATIVO, E E ELE QUE SEPARA ESTA PERNA DA OUTRA DO MESMO PAR.
 *     A de entrada carrega a MESMA nota e o MESMO `transaction_type`
 *     (`chave-mybank-esta-nas-duas-pernas-no-caso-a`): sem o sinal a excecao
 *     promoveria as DUAS para a aba Despesas, e uma parcela de R$ 1.000 entraria
 *     como R$ 2.000 com as duas linhas na lista dizendo a mesma descricao e a
 *     mesma data. E a armadilha 3 por um caminho novo, e no lado em que ela nao
 *     de-duplica nada.
 *
 * NAO HA CRITERIO DE ELO, e e a diferenca desta funcao para
 * `ehEntradaSoltaDoMyBank` -- la o elo NULO e o criterio que existe para separar
 * o Caso B do Caso A. Aqui ele seria redundante hoje e um defeito amanha: a
 * perna de SAIDA de uma transferencia nunca carrega o elo
 * (`elo-de-transferencia-e-de-uma-via` -- o 015 grava so na de entrada), entao
 * exigir `IS NULL` pediria uma coisa que ja e sempre verdade, e no dia em que o
 * elo passasse a ser gravado nas duas pernas a parcela paga sumiria de Despesas
 * outra vez -- que e exatamente o defeito que esta issue conserta.
 *
 * E ELA NAO TORNA `ehEntradaSoltaDoMyBank` MAIS FROUXA, de proposito: aquela
 * continua respondendo so pela perna SOLTA (Caso B), porque o `!` dela na
 * armadilha 3 e o que mantem o Caso A de-duplicado em Transferencias. Duas
 * perguntas, dois donos -- a terceira alternativa (afrouxar o sinal de lá) era
 * o defeito de dinheiro que a HMO-380 documentou.
 *
 * NAO HA CRITERIO DE STATUS DA PARCELA, pela mesma razao de
 * `ehPagamentoDaFatura` e de `ehEntradaSoltaDoMyBank`: a perna SO EXISTE porque
 * a baixa rodou, no mesmo pedido que leva a parcela a `paid`.
 */
export function ehSaidaDaParcelaDoAutoEmprestimo(
  crua: PernaDoPagamentoDaFatura
): boolean {
  if (String(crua.transaction_type) !== TIPO_DA_PARCELA_DO_MYBANK) return false;
  if (!temOEloDaParcelaDoMyBank(crua.notes)) return false;
  return Number(crua.amount) < 0;
}

/**
 * Converte a linha realizada para a lista.
 *
 * O `indice` existe so pela transferencia: a frase "Itaú → Nubank" precisa da
 * OUTRA perna, que esta em outra linha do banco. Ver
 * lib/destino-do-lancamento.ts -- e em particular por que ali sao dois mapas e
 * nao um.
 *
 * `idsDeFixa` E PARAMETRO, E NAO UMA LEITURA DE `crua` (HMO-285), porque o elo
 * nao esta na linha: `financial_transactions` nao tem `recurring_rule_id` nem
 * `scheduled_transaction_id` (001), so o caminho inverso
 * (`scheduled_transactions.transaction_id`) existe. Quem sabe quais realizadas
 * vieram de regra fixa e uma TERCEIRA consulta, na rota -- e e por isso que o
 * conjunto chega por argumento. Vazio significa "nenhuma", nao "nao sei": ver
 * a direcao do erro em `linhasDaTela`.
 *
 * `fatura` DEIXOU DE SER SEMPRE `null` NO REALIZADO -- HMO-264. Ele e preenchido
 * na unica linha realizada que e uma fatura: a perna de SAIDA do pagamento dela
 * (`ehPagamentoDaFatura`). Em toda outra continua `null`, e a razao original
 * segue de pe -- um link para o cartao e o mes montado a partir de uma linha que
 * nao e fatura aponta para um destino plausivel e errado.
 *
 * `tela` E PARAMETRO, E E O QUE DEIXA AS DUAS LEITURAS CONVIVEREM (HMO-264). A
 * perna de saida do pagamento da fatura e `transfer` na coluna e aparece em DUAS
 * telas: na de Transferencias ela e o movimento entre duas contas minhas
 * (`tipo: "transfer"`), e na de Despesas ela e a fatura se realizando
 * (`tipo: "expense"`). `tipo` e o campo que diz A QUE TELA a linha pertence --
 * e nao o que a coluna do banco diz --, entao deixa-lo em `"transfer"` numa
 * linha da lista de Despesas quebraria justamente o invariante pelo qual o lado
 * previsto ja peneira (`linha.tipo === tipo` em `linhasDaTela`): a fatura paga
 * desapareceria de Despesas no dia em que alguem repetisse aquela peneira do
 * lado realizado, sem erro e sem teste vermelho.
 *
 * OBRIGATORIO, pelo mesmo motivo de `idsDeFixa`: opcional, ele cairia num
 * default e a decisao voltaria a ser invisivel.
 */
export function linhaRealizada(
  crua: RealizadaCrua,
  indice: IndiceDeContraparte,
  idsDeFixa: ReadonlySet<string>,
  meuUserId: string | null | undefined,
  tela: TipoDaTela
): LinhaDaTela {
  const destino = destinoDoLancamento(crua, indice);

  // O CARTAO E O MES DA FATURA PAGA, ou `null` em toda outra linha.
  //
  // `ehPagamentoDaFatura` e nao `faturaDaChave(crua.notes)` solto: a chave
  // canonica chega tambem na perna de ENTRADA e na despesa comum que nasceu do
  // elo da HMO-305, e nenhuma das duas e a fatura se realizando. Os tres
  // criterios estao no cabecalho daquela funcao.
  const faturaPaga = ehPagamentoDaFatura(crua) ? faturaDaChave(crua.notes) : null;

  // A PERNA DE SAIDA DA PARCELA PAGA DO CASO A -- HMO-385, armadilha 8.
  //
  // Uma constante e nao duas chamadas porque ela decide DOIS campos abaixo
  // (`tipo` e `natureza`), e os dois tem de concordar: uma linha com
  // `tipo: "expense"` na lista de Despesas e `natureza: "despesa"` seria a
  // parcela entrando no numero certo e sem o selo, que e metade do defeito
  // desta issue.
  const saidaDoAutoEmprestimo = ehSaidaDaParcelaDoAutoEmprestimo(crua);

  return {
    id: crua.id,
    gravada: true,
    posso_editar: ehMinha(crua.user_id, meuUserId),
    descricao: texto(crua.description),
    valor: valorEmReais(crua.amount, crua.exchange_rate),
    data: texto(crua.transaction_date) ?? "",
    origem: "realizado",
    // A FATURA PAGA E `expense` NA TELA DE DESPESAS E `transfer` NA DE
    // TRANSFERENCIAS -- a MESMA linha do banco, duas leituras. Ver `tela` no
    // cabecalho.
    //
    // A PARCELA PAGA DO CASO A ENTROU NA MESMA REGRA (HMO-385): ela e a segunda
    // linha realizada que aparece em DUAS abas, e `tipo` e o campo que diz a
    // qual delas esta instancia pertence. Deixa-la `"transfer"` na lista de
    // Despesas quebraria o invariante pelo qual o lado previsto ja peneira
    // (`linha.tipo === tipo`), do jeito que o cabecalho descreve.
    tipo:
      (faturaPaga || saidaDoAutoEmprestimo) && tela === "expense"
        ? "expense"
        : classificarMovimentacao(crua),
    status: null,
    situacao: null,
    categoria: texto(crua.category?.name),
    // `faltaConta` em vez do texto cru: "Sem conta" dito igual a "Itaú" e um
    // nome de conta inventado. `null` cala a frase na tela.
    conta: destino.faltaConta ? null : destino.texto,
    moeda: moedaDaLinha(crua.currency),
    // FATURA PRIMEIRO, FIXA DEPOIS -- a MESMA ordem de `linhaPrevista`, e pela
    // mesma razao (ver `natureza` em `LinhaDaTela`): chamar de "fixa" a fatura
    // paga tiraria dela a unica coisa que `fatura` existe para dar, o caminho de
    // volta para o cartao e o mes.
    // FATURA, MYBANK, FIXA, DESPESA -- nesta ordem.
    //
    // `"mybank"` ENTROU NO REALIZADO NA HMO-380 (armadilha 7), e e o MESMO selo
    // que o lado previsto ja poe na parcela (`linhasDaTela`): sem ele a MESMA
    // serie se apresenta como "MyBank" nas 24 previsoes e como transferencia
    // comum na unica que foi paga.
    //
    // `faturaPaga` E `ehEntradaSoltaDoMyBank` SAO MUTUAMENTE EXCLUSIVOS pela
    // chave (`fatura:` contra `mybank:`), entao a ordem entre os dois nao
    // decide nada hoje -- ela esta escrita para que o dia em que uma chave
    // ganhe os dois prefixos tenha uma resposta, e a resposta e a fatura, que e
    // a unica natureza que carrega caminho de volta (`fatura`, logo abaixo).
    // Antes de `"fixa"` pela razao de sempre: um rotulo mais informativo sobre a
    // mesma linha.
    // A SEGUNDA PERNA GANHOU O SELO NA HMO-385, E ISSO REVERTE UMA FRASE DA
    // HMO-380 -- de proposito, e o argumento esta aqui.
    //
    // Aquela issue escreveu, no criterio do sinal de `ehEntradaSoltaDoMyBank`,
    // que `natureza: "mybank"` e "o rotulo de uma linha SEM par", e que po-lo na
    // perna de saida de um par diria que nao houve contrapartida. A premissa nao
    // se sustenta por duas medidas:
    //
    //   * o que o selo DESENHA e `{ Icone: Wallet, rotulo: "MyBank" }`
    //     (`marcaDaLinha`, components/movimentacoes/SecaoDaTela.tsx) -- uma
    //     palavra de PROCEDENCIA, que diz onde a linha e operada, e nao uma
    //     afirmacao sobre pernas. O proprio comentario de lá o justifica assim:
    //     "«MyBank» diz onde ela e operada";
    //   * o lado PREVISTO ja poe esse mesmo selo na parcela do Caso A
    //     (`ehParcelaDoAutoEmprestimo`, em `linhasDaTela`) -- e aquela e
    //     exatamente a linha que vira um par de DUAS pernas quando paga. Se o
    //     selo significasse "sem par", ele ja estaria errado nas 24 previsoes.
    //
    // Sem esta reversao a MESMA serie se apresenta como «MyBank» nas 23 parcelas
    // pendentes e como transferencia comum na unica que foi paga, que e o
    // sintoma que a prova em producao mediu (`selo-do-mybank-so-vale-no-previsto`).
    //
    // DOIS RECONHECEDORES NO MESMO RAMO, E NAO UM MAIS FROUXO: cada um responde
    // por um caso que o outro recusa -- `ehEntradaSoltaDoMyBank` pela perna
    // SOLTA do Caso B (positiva, sem elo) e `saidaDoAutoEmprestimo` pela de
    // SAIDA do Caso A (negativa). Afrouxar o sinal do primeiro alcancaria as
    // duas com uma funcao so e desarmaria a de-duplicacao da armadilha 3 para o
    // Caso A inteiro, que e o defeito de dinheiro que a HMO-380 documentou.
    // Cada operando tem mutante proprio: apagar um deles tira o selo de um dos
    // dois casos e deixa o outro de pe.
    //
    // FATURA, MYBANK, FIXA, DESPESA -- nesta ordem, e a ordem segue decidindo o
    // que decidia: ver os dois paragrafos abaixo.
    natureza: faturaPaga
      ? "fatura"
      : ehEntradaSoltaDoMyBank(crua) || saidaDoAutoEmprestimo
        ? "mybank"
        : idsDeFixa.has(crua.id)
          ? "fixa"
          : "despesa",
    // SEMPRE `false` NO REALIZADO, e nao e esquecimento: a minha parte de uma
    // despesa de grupo que outra pessoa PAGOU nao esta em
    // `financial_transactions` -- ela vive em `group_share_entries` (033), que
    // esta tela nao le de proposito (ver o cabecalho da rota). Marcar a linha
    // realizada como "de grupo" com base em `group_id` prometeria uma fracao onde
    // o valor e o que saiu CHEIO da minha conta.
    de_grupo: false,
    fatura: faturaPaga
      ? { accountId: faturaPaga.accountId, mes: faturaPaga.mes }
      : null,
    // SEMPRE `null` NO REALIZADO (HMO-305). A razao que `fatura` tinha caiu com
    // a HMO-264; esta nao: o
    // elo da fatura e uma decisao sobre uma conta A PAGAR -- "esta previsao e a
    // fatura do mes". Uma linha realizada e dinheiro que JA saiu, e nao ha o que
    // de-duplicar contra a fatura ABERTA. A compra no cartao, que seria a
    // candidata obvia, nem chega aqui: `ehGastoNoCartao` a tira da tela de
    // Despesas porque ela esta dentro da fatura.
    fatura_suspeita: null,
    // E `null` pelo mesmo motivo: o elo e sobre uma conta A PAGAR. A chave em
    // `notes` nem existe deste lado -- `financial_transactions` nao tem a
    // coluna.
    elo_da_fatura: null,
    // O UNICO LUGAR DO APP QUE RESOLVE O "NAO SEI" DESTA COLUNA -- HMO-452.
    //
    // `!== false`, E NAO `=== true`, e a razao e a MESMA de `contasQueSomam`
    // (lib/contas.ts) e de `linhasDaConversa` (lib/saldo-da-conversa.ts): a
    // coluna e `NOT NULL` no banco, entao do Postgres so vem `true` ou `false`
    // e os dois testes seriam equivalentes. A diferenca aparece na resposta que
    // NAO vem do Postgres -- o banco sem a 060 colada e o cache offline do
    // aparelho, os dois descritos em `RealizadaCrua.include_in_total`. Com
    // `=== true`, `undefined === true` e falso: TODA linha do cache ganharia o
    // selo "fora dos totais" e a tela diria que nada soma, justamente quando
    // nao ha rede para conferir.
    //
    // `!== false` trata "nao sei" como "soma", que e o DEFAULT da coluna e o
    // comportamento de antes da feature. Errar para o lado do app de ontem.
    soma_nos_totais: crua.include_in_total !== false,
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
/**
 * A linha e de quem esta olhando? -- o unico lugar que decide `posso_editar`.
 *
 * FUNCAO E NAO UMA EXPRESSAO REPETIDA nas duas chamadas, porque ela tem tres
 * jeitos de ficar ERRADA PARA MAIS, e os tres sao plausiveis escritos a mao:
 *
 *   * `==` em vez de `===` faria `undefined == null` ser VERDADE -- a linha sem
 *     `user_id` lida por um visitante sem id viraria editavel;
 *   * `linha.user_id === meuUserId` sem as duas guardas de nulo faz
 *     `undefined === undefined` ser verdade, que e exatamente o caso da rota
 *     que esqueceu o campo no `select`: TODA linha ganharia botao;
 *   * `!!meuUserId` sozinho (sem comparar) aprovaria qualquer linha de qualquer
 *     membro do grupo para qualquer pessoa logada.
 *
 * Os tres erram na direcao CARA: botao que aparece, a RLS recusa, e o `UPDATE`
 * recusado volta 200 sem alterar nada.
 */
function ehMinha(
  daLinha: string | null | undefined,
  meuUserId: string | null | undefined
): boolean {
  if (typeof daLinha !== "string" || daLinha === "") return false;
  if (typeof meuUserId !== "string" || meuUserId === "") return false;
  return daLinha === meuUserId;
}

export function linhaPrevista(
  crua: PrevistaCrua,
  meuUserId: string | null | undefined,
  /**
   * AS SUSPEITAS DE FATURA REPETIDA -- HMO-305, calculadas por `linhasDaTela`
   * sobre a lista INTEIRA e repassadas aqui.
   *
   * Nao sai de `crua`, e nao poderia: a pergunta "esta previsao e a fatura?" so
   * tem resposta olhando as OUTRAS linhas -- ha uma fatura aberta neste mes
   * neste cartao? --, e esta funcao ve uma linha so.
   *
   * OPCIONAL, ao contrario de `idsDeFixa` em `linhasDaTela`, e a diferenca e a
   * direcao do erro: `idsDeFixa` ausente faz toda conta fixa se chamar comum (um
   * rotulo ERRADO), enquanto este mapa ausente faz a linha sair sem rotulo e sem
   * acao -- o estado de antes desta issue, com a divida a vista e o numero
   * inchado. Errar para cima e conferivel; errar para baixo esconde conta.
   */
  suspeitas?: ReadonlyMap<string, SuspeitaDeFatura>
): LinhaDaTela | null {
  if (STATUS_QUE_SAI_DO_PREVISTO.has(String(crua.my_status))) return null;

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

  // A FATURA E RECONHECIDA PELA CHAVE EM `notes`, E ISSO PEGA AS DUAS DE UMA VEZ
  // (HMO-285): a ABERTA, que `faturasPrevistasDaJanela` sintetiza com `id: null`
  // e a chave em `notes`, e a FECHADA, que e uma `scheduled_transaction` de
  // verdade com a MESMA chave. Um criterio por `gravada` daria duas respostas
  // para a mesma pergunta e a fatura fechada perderia o clique -- que e
  // justamente o mes em que ela e a linha que a pessoa vai pagar.
  //
  // O criterio NAO e o tipo da conta: a assinatura cobrada no cartao e cadastrada
  // com o `account_id` do cartao e NAO e fatura (ver o cabecalho de
  // lib/card-invoice.ts). Pelo tipo da conta ela viraria "Fatura" e ganharia um
  // link para um mes de fatura que nao e dela.
  const daFatura = faturaDaChave(crua.notes);

  return {
    id: chave,
    gravada: idGravado !== null,
    posso_editar: ehMinha(crua.user_id, meuUserId),
    descricao: texto(crua.description),
    // Sem cotacao: `scheduled_transactions` nao tem a coluna. Ver
    // `valorEmReais`.
    valor: valorEmReais(crua.amount),
    data: texto(crua.due_date) ?? "",
    origem: "previsto",
    tipo: tela.tipo,
    status: texto(crua.my_status),
    situacao: texto(crua.my_effective_status),
    categoria: texto(umDoEmbed(crua.category)?.name),
    conta: nomeDaConta,
    moeda: moedaDaLinha(crua.currency),
    // FATURA, MYBANK, FIXA, DESPESA -- a MESMA ordem de `linhaRealizada`, e
    // pelas mesmas razoes (ver `natureza` em `LinhaDaTela`).
    //
    // `"mybank"` ENTROU NO PREVISTO AVULSO NA HMO-377. Ele e o selo da parcela
    // que EU DEVO a uma conexao (`ehParcelaDevidaDoMyBank`), que chega aqui pela
    // view `mybank_due_entries` e nao por `scheduled_transactions`. Sem ele a
    // linha se apresenta como despesa comum, e quem for conferir vai procurar
    // em Contas a Pagar uma conta que la aparece com o selo "MyBank" -- duas
    // palavras para a mesma divida nas duas telas que a mostram.
    //
    // ELE NAO COBRE O CASO A: aquela linha e `transfer` na coluna e quem poe o
    // selo nela e `linhasDaTela`, que a sobrescreve ao abrir a excecao de aba.
    // As duas sao mutuamente exclusivas pela `direction`.
    //
    // ANTES DE `"fixa"` pela razao de sempre -- um rotulo mais informativo sobre
    // a mesma linha --, e isto nao e empate hipotetico: `recurring_rule_id` e
    // `null` em `ParcelaDevidaNaAgenda`, entao hoje os dois nao casam juntos.
    natureza: daFatura
      ? "fatura"
      : ehParcelaDevidaDoMyBank(crua)
        ? "mybank"
        : texto(crua.recurring_rule_id)
          ? "fixa"
          : "despesa",
    // `!= null` e nao `texto(...) !== null`: `group_id` e uuid ou nulo, e o que
    // interessa aqui e a PRESENCA do elo, nao o conteudo dele. Ver `de_grupo` em
    // `LinhaDaTela` -- e o mesmo criterio de `LinhaDoDetalhe.de_grupo`.
    de_grupo: crua.group_id != null,
    // `texto()` e nao um `!!`: `recurring_rule_id: ""` -- que o PostgREST pode
    // devolver se a coluna virar texto, e que um mock de teste produz sem
    // esforco -- nao e um elo para regra nenhuma.
    fatura: daFatura
      ? { accountId: daFatura.accountId, mes: daFatura.mes }
      : null,
    // A CHAVE E `idGravado` E NAO `chave`, e a diferenca importa: `chave` cai na
    // chave canonica da fatura quando a linha nao e gravada, e o mapa das
    // suspeitas e indexado pelo `scheduled_transactions.id` -- o mesmo id que a
    // URL da acao usa. Com `chave`, uma fatura sintetizada poderia casar com uma
    // entrada do mapa e a tela mostraria a acao numa linha que nao existe em
    // tabela nenhuma, onde o `PATCH` nao tem o que atualizar.
    //
    // `posso_editar` entra na condicao porque ligar o elo e um `UPDATE`: na
    // linha de outro membro do grupo a RLS recusa e volta 200 sem alterar nada.
    // Rotulo com acao impossivel aponta um problema e nao deixa resolver.
    fatura_suspeita:
      idGravado !== null && ehMinha(crua.user_id, meuUserId) && suspeitas
        ? suspeitas.get(idGravado) ?? null
        : null,
    // O `account_id` sai do EMBED (`account.id`), que e de onde esta tela le a
    // conta -- a `PrevistaCrua` nao tem a coluna solta. Sem `id` no embed do
    // `select` da rota ele chega `undefined`, `eloDesfazivel` responde `null` e a
    // linha perde o caminho de volta sem mudar numero nenhum.
    elo_da_fatura: ehMinha(crua.user_id, meuUserId)
      ? eloDesfazivel(
          crua.notes,
          umDoEmbed(crua.account)?.id,
          idGravado !== null
        )
      : null,
    // SEMPRE `true` NO PREVISTO, E E A AUSENCIA DE ESCOLHA -- HMO-452.
    //
    // A coluna da 060 e de `financial_transactions`. Uma linha prevista e
    // `scheduled_transactions` (pela view `scheduled_transactions_effective`) e
    // a fatura aberta nao esta em tabela nenhuma: nas duas, a pergunta "esta
    // linha soma nos totais?" nao tem onde ser gravada. `true` e o que a tela
    // ja mostra hoje, e e tambem o que `category_monthly_totals` ja faz -- ela
    // nunca viu uma linha prevista, porque le `financial_transactions` direto.
    //
    // E E POR ISSO QUE A ACAO DA LINHA RECUSA O PREVISTO (`podeMudarOsTotais`
    // em lib/acoes-da-linha.ts): o PATCH de uma previsao vai para
    // `/api/scheduled-transactions/{id}`, que NAO conhece este campo -- ele
    // seria descartado em silencio, com 200, e a pessoa veria o selo nao
    // aparecer sem nenhuma explicacao. Hard-coded `true` aqui e o que faz essa
    // recusa ser legivel la em vez de um `undefined` atravessando a tela.
    soma_nos_totais: true,
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
 *
 * A DECISAO 1 TEM UMA EXCECAO, E E UMA SO: a FATURA PAGA (HMO-264, armadilha 6).
 * A perna de saida do pagamento e `transfer` na coluna, entao o filtro de tipo e
 * precisamente quem a mantinha fora da tela de Despesas -- e ela tem de estar
 * la, porque e nela que a despesa do cartao se realiza. A excecao vem ANTES da
 * decisao 1, e o corpo do laco explica por que nenhuma das outras tres peneiras
 * se aplica a ela.
 *
 * `idsDeFixa` E OBRIGATORIO DE PROPOSITO (HMO-285). Ele e o unico jeito de uma
 * linha realizada saber que veio de regra fixa -- o elo em
 * `financial_transactions` nao existe (001) --, e um parametro OPCIONAL teria
 * exatamente o modo de falha que `account_type` no `select` da rota tem: a rota
 * deixa de passar numa refatoracao, `tsc` fica verde, nenhum teste de unidade
 * reprova, e TODA conta fixa volta a se chamar comum na tela. Obrigatorio, o
 * compilador cobra a fiacao.
 *
 * VAZIO SIGNIFICA "NENHUMA", e e a direcao barata do erro: quando a consulta da
 * rota falha o conjunto chega vazio, as linhas caem em `"despesa"` (o estado de
 * antes desta issue) e a leitura inteira continua de pe. A mesma decisao que
 * `faturasPrevistasDaJanela` ja toma.
 */
export function linhasDaTela(
  realizadas: readonly RealizadaCrua[],
  previstas: readonly PrevistaCrua[],
  tipo: TipoDaTela,
  idsDeFixa: ReadonlySet<string>,
  /**
   * QUEM ESTA OLHANDO -- HMO-301. Obrigatorio pelo mesmo motivo de
   * `idsDeFixa`: a rota e quem autentica, entao e dela que o valor sai, e um
   * parametro opcional deixaria o `tsc` verde com a rota tendo parado de
   * passa-lo. Aqui, no entanto, o erro silencioso vai na direcao BARATA --
   * `posso_editar` cai para `false` em toda linha e nenhum botao aparece.
   */
  meuUserId: string | null | undefined
): LinhaDaTela[] {
  // O indice vai sobre TODAS as realizadas, e nao sobre as filtradas: a
  // contraparte de uma transferencia e uma transferencia tambem, mas o indice
  // tambem serve de `porId` para o caso de um elo apontar para linha de outro
  // tipo (uma linha antiga, de antes de `transaction_type` ser gravado).
  const indice = indiceDeContraparte(realizadas as LancamentoComConta[]);

  const linhas: LinhaDaTela[] = [];

  for (const crua of realizadas) {
    // A FATURA PAGA ENTRA EM DESPESAS ANTES DO FILTRO DE TIPO -- HMO-264,
    // armadilha 6. Ela e a UNICA excecao a decisao 1, e tem de ser aqui: a perna
    // de saida do pagamento e `transfer` na coluna, entao o filtro de tipo e
    // exatamente quem a mantinha fora da tela de Despesas.
    //
    // AS TRES PENEIRAS ABAIXO NAO SE APLICAM A ELA, e nenhuma por acaso:
    //
    //   * a de tipo e a que ela existe para contornar;
    //   * a de perna nem seria consultada aqui (a guarda dela e `tipo ===
    //     "transfer"`), e nao faria falta: `ehPagamentoDaFatura` ja consulta
    //     `ehPernaDeEntrada` e o sinal, e so a perna de SAIDA casa;
    //   * `ehGastoNoCartao` nunca casaria: ela exige `transaction_type` em
    //     ('expense','income') e esta linha e `transfer`. A fatura paga nao e
    //     um gasto NO cartao, e o pagamento DELE.
    //
    // E A COMPRA CONTINUA ESCONDIDA pela armadilha 5, o que e o que impede o
    // cartao de contar duas vezes: no mes da fatura paga a tela soma a FATURA
    // (uma linha) e nenhuma das compras que ela contem.
    if (tipo === "expense" && ehPagamentoDaFatura(crua)) {
      linhas.push(linhaRealizada(crua, indice, idsDeFixa, meuUserId, tipo));
      continue;
    }
    // A PARCELA PAGA DO AUTO-EMPRESTIMO ENTRA EM DESPESAS -- HMO-385, armadilha
    // 8. E a MESMA excecao da fatura paga logo acima, e pela mesma razao: a
    // perna de saida e `transfer` na coluna, entao o filtro de tipo da linha
    // abaixo e exatamente quem a mantinha fora da tela de Despesas.
    //
    // ANTES DO FILTRO DE TIPO (como a da fatura) e NAO depois (como a da perna
    // solta, armadilha 7), e a diferenca entre as duas e o que cada uma precisa:
    // aquela linha ja pertencia a aba em que aparece e so tinha de escapar de um
    // `continue`; esta precisa alcancar uma aba que o tipo da coluna lhe nega.
    // A ordem tambem e o que impede a excecao de ter efeito em Receitas -- junto
    // com o sinal negativo, que e criterio da propria funcao.
    //
    // AS TRES PENEIRAS ABAIXO NAO SE APLICAM A ELA, e nenhuma por acaso:
    //
    //   * a de tipo e a que ela existe para contornar;
    //   * a de perna nem seria consultada aqui (a guarda dela e `tipo ===
    //     "transfer"`), e nao faria falta: esta perna e NEGATIVA e sem elo,
    //     entao `ehPernaDeEntrada` responde `false` sobre ela;
    //   * `ehGastoNoCartao` nunca casaria: ela exige `transaction_type` em
    //     ('expense','income') e esta linha e `transfer`. A parcela nao e um
    //     gasto no cartao.
    //
    // E A PREVISAO JA NAO ESTA NA LISTA, que e o que impede a parcela de contar
    // DUAS vezes no mes da baixa (o ponto 2 da issue, que pedia assercao e nao
    // confianca): a baixa leva a conta prevista a `status: 'paid'`, `paid` esta
    // em `STATUS_QUE_SAI_DO_PREVISTO` (armadilha 2), `linhaPrevista` devolve
    // `null`, e o `if (!linha) continue;` do laco de baixo roda ANTES da excecao
    // do auto-emprestimo -- entao a previsao sai sem sequer ser consultada. A
    // rota NAO filtra `status` no SQL, de proposito, justamente para que esta
    // cadeia tenha teste.
    //
    // UMA POR ABA, E NAO DUAS NA MESMA: esta perna continua em Transferencias
    // pelo caminho comum (ela e `transfer` e nao e perna de entrada), e nenhum
    // total soma as duas abas -- a mesma aritmetica da fatura paga e da parcela
    // prevista.
    if (tipo === "expense" && ehSaidaDaParcelaDoAutoEmprestimo(crua)) {
      linhas.push(linhaRealizada(crua, indice, idsDeFixa, meuUserId, tipo));
      continue;
    }
    if (classificarMovimentacao(crua) !== tipo) continue;
    // A PERNA SOLTA DO MYBANK NAO E DE-DUPLICADA -- HMO-380, armadilha 7. Ela
    // casa com `ehPernaDeEntrada` pelo SINAL (positiva, sem elo) e nao ha
    // segunda perna para ela representar: descarta-la tirava do app a unica
    // linha daquele dinheiro.
    //
    // A EXCECAO VEM DEPOIS DO FILTRO DE TIPO, e nao antes como a da fatura paga:
    // esta linha e `transfer` na coluna E pertence a aba de Transferencias, que
    // e a mesma resposta -- nao ha tela a contornar, so o `continue` da
    // armadilha 3 a evitar. A ordem tambem e o que impede a excecao de ter
    // efeito em Receitas (onde o sinal positivo tambem casaria).
    if (
      tipo === "transfer" &&
      ehPernaDeEntrada(crua) &&
      !ehEntradaSoltaDoMyBank(crua)
    ) {
      continue;
    }
    // O gasto no cartao esta DENTRO da fatura, e a fatura inteira ja esta no
    // lado previsto desta mesma tela. Ver armadilha 5 do cabecalho.
    if (tipo === "expense" && ehGastoNoCartao(crua)) continue;
    linhas.push(linhaRealizada(crua, indice, idsDeFixa, meuUserId, tipo));
  }

  // AS SUSPEITAS DE FATURA REPETIDA -- HMO-305, UMA VEZ, SOBRE AS PREVISTAS
  // INTEIRAS.
  //
  // Antes do laco e sobre a lista inteira porque o criterio e RELACIONAL: a
  // previsao digitada a mao so e suspeita se houver uma fatura ABERTA no mesmo
  // mes, e a fatura aberta e outra linha desta mesma lista
  // (`faturasPrevistasDaJanela` a concatena na rota). Calcular dentro do laco
  // custaria a lista toda por linha; calcular DEPOIS do filtro de tipo veria uma
  // lista sem a fatura nos meses em que a tela e a de Receitas.
  //
  // So as PREVISTAS: a lista de realizadas nao tem fatura aberta nenhuma para
  // comparar, e `linhaRealizada` ja devolve `fatura_suspeita: null` sempre.
  const suspeitas = suspeitasDeFaturaRepetida(previstas);

  for (const crua of previstas) {
    const linha = linhaPrevista(crua, meuUserId, suspeitas);
    if (!linha) continue;

    // A PARCELA DO AUTO-EMPRESTIMO ENTRA EM DESPESAS -- HMO-372, leitura 2 de
    // 7, e a decisao 1 da HMO-368. E a MESMA excecao da fatura paga logo acima,
    // do lado previsto: a linha e `transfer` na coluna e tem de aparecer em
    // DUAS abas, e e `tipo` (nao `direction`) que diz a que aba ela pertence.
    //
    // `tipo` SOBRESCRITO AQUI e nao dentro de `linhaPrevista`: aquela funcao ve
    // UMA linha e nao sabe que tela a esta pedindo -- e e exatamente por isso
    // que `linhaRealizada` recebe `tela` como parametro desde a HMO-264. Dar o
    // mesmo parametro a `linhaPrevista` exigiria torna-lo opcional (ha
    // chamadores com dois argumentos), e opcional ele cairia num default e a
    // decisao voltaria a ser invisivel.
    //
    // `natureza: "mybank"` E O SELO, e ele vale nas duas abas: em Despesas
    // porque sem ele a linha se le como gasto comum, e em Transferencias porque
    // "MyBank" e mais informativo que "Despesa" sobre a mesma linha.
    if (ehParcelaDoAutoEmprestimo(crua)) {
      if (tipo === "expense" || linha.tipo === tipo) {
        linhas.push({ ...linha, tipo, natureza: "mybank" });
      }
      continue;
    }

    if (linha.tipo === tipo) linhas.push(linha);
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
 * O REEMBOLSO QUE OS OUTROS ME DEVEM, como ele entra no «Previsto» de Receitas
 * -- HMO-364, fase F3 da HMO-360.
 *
 * Os tres campos sao exatamente os de `notaDoCreditoAReceber`
 * (lib/credito-de-grupo.ts), e isso e deliberado: o calculo do credito por
 * grupo e por devedor ja existe, tem 17 blocos de teste e 12 mutantes, e uma
 * segunda contagem aqui ("quantos devedores?") empataria com a dele na maioria
 * dos meses e divergiria justamente no que dói -- o devedor que aparece em dois
 * meses do periodo e e UMA linha agregada.
 *
 * `quantos` e `grupos` existem porque a frase do cartao concorda em numero com
 * eles. Concordancia calculada no meio do JSX e o que divergiu da conta no
 * cartao de Despesas antes da HMO-275.
 */
export interface ReembolsoPrevisto {
  /** BRL, POSITIVO. A soma das linhas de credito do periodo. */
  total: number;
  /** Quantas pessoas devem -- uma linha por (grupo, devedor). */
  quantos: number;
  /** De quantos grupos. */
  grupos: number;
}

/**
 * O resumo com o reembolso DENTRO do «Previsto» e dito em separado.
 *
 * `reembolso_previsto` nao e enfeite do cartao: sem ele o valor entra no
 * «Previsto» de Receitas e NAO HA como a tela dizer que ele esta ali. Isso
 * fabrica o quinto numero sem rotulo da familia
 * `despesa-de-grupo-tem-tres-convencoes`, que e o defeito que a F5 do plano da
 * HMO-360 existe para nao ter -- e, pior, o valor se le como receita que ja
 * esta garantida.
 */
export interface ResumoComReembolso extends ResumoDaTela {
  /** `null` = nao ha reembolso nenhum, ou esta tela nao e a de Receitas. */
  reembolso_previsto: ReembolsoPrevisto | null;
}

/**
 * O «a receber» do MyBank COMO O CARTAO PRECISA DELE -- HMO-379.
 *
 * Os quatro campos de `AReceberDoMyBank` (lib/leituras-do-mybank.ts), declarados
 * aqui pelo MESMO motivo de `ReembolsoPrevisto` estar aqui e nao em
 * `lib/credito-de-grupo.ts`: importar o tipo de la arrastaria
 * `leituras-do-mybank` -> `emprestimo-do-mybank` -> `lancamento` +
 * `transferencia` para dentro do `rootDir: lib` que as suites e o mutador desta
 * lib usam -- a mesma razao escrita em `TIPO_CARTAO` (HMO-260).
 *
 * E o preco e o mesmo: DUAS declaracoes que podem se separar, com o modo de
 * falha mudo (um campo renomeado de um lado deixa a legenda do cartao com
 * `undefined` onde ia um numero, sem erro). Quem as mantem juntas e a assercao
 * de FORMA que ja existe sobre a rota -- o `deepEqual` dos quatro campos em
 * scripts/test-leituras-do-mybank.mjs --, e nao o `tsc`.
 */
export interface AReceberNoPrevisto {
  /** BRL, POSITIVO. A soma das parcelas em aberto do periodo. */
  total: number;
  /** Quantas parcelas. */
  parcelas: number;
  /** De quantas pessoas. */
  devedores: number;
  /** De quantos emprestimos. */
  emprestimos: number;
}

/**
 * O resumo COMO A TELA O RECEBE: com as duas promessas que moram no «Previsto».
 *
 * Este e o tipo dos cartoes e do estado da lista, e nao `ResumoComReembolso`:
 * a HMO-372 acrescentou `a_receber_do_mybank` a resposta da rota e a tela ficou
 * com o tipo ANTIGO, que nao tem o campo. O efeito foi o defeito da HMO-379 --
 * o campo chegava no corpo e nenhum componente podia sequer mencionar o nome
 * dele sem erro de `tsc`, entao o numero entrava no «Previsto» MUDO.
 *
 * Os dois campos sao `| null` e nao opcionais, como o irmao: uma resposta
 * guardada no aparelho de antes da feature nao os tem, e os leitores usam
 * `resumo?.campo` justamente por isso.
 */
export interface ResumoDoCartao extends ResumoComReembolso {
  /** `null` = nenhuma conexao me deve nada, ou esta tela nao e a de Receitas. */
  a_receber_do_mybank: AReceberNoPrevisto | null;
}

/**
 * Quanto do «Previsto» NAO TEM LINHA na lista da tela -- HMO-379.
 *
 * As duas promessas que `resumoComReembolsoPrevisto` e
 * `resumoComAReceberDoMyBank` somam ao cartao nascem FORA de
 * `scheduled_transactions`, e nenhuma das duas vira linha (a razao inteira esta
 * na rota: fabricar a linha daria Editar/Excluir sobre um id que nao existe em
 * tabela nenhuma, e `UPDATE` recusado pela RLS volta 200 sem alterar nada).
 *
 * Por isso a secao «Previsto no periodo» pode ter ZERO linhas com o cartao
 * «Previsto» em R$ 30,00 -- e era exatamente isso que a tela dizia ao lado da
 * frase "Nada previsto neste periodo.", que e a leitura "o total esta errado"
 * que este app ja produziu quatro vezes.
 *
 * Esta funcao e o que deixa a frase de vazio DISTINGUIR os dois casos. Ela
 * devolve dinheiro, nao booleano, porque a frase diz o VALOR: "nenhum
 * lancamento, e os R$ 30,00 do «Previsto» vem daqui" responde a pergunta que
 * "nada previsto" responde errado.
 */
export function previstoSemLinha(resumo: ResumoDoCartao | null): number {
  if (!resumo) return 0;

  // `?? 0` nos dois, e nao um `if` por campo: os dois sao `| null` quando a
  // tela nao e Receitas, e uma resposta do aparelho de antes da feature nao tem
  // nem a chave.
  return centavos(
    (resumo.reembolso_previsto?.total ?? 0) +
      (resumo.a_receber_do_mybank?.total ?? 0)
  );
}

/**
 * Soma o reembolso de grupo ao «Previsto» -- e SO na tela de Receitas.
 *
 * POR QUE O PREVISTO, E POR QUE NAO O REALIZADO
 * ---------------------------------------------
 * O cabecalho de lib/credito-de-grupo.ts recusa, por escrito, exportar
 * qualquer coisa que some em `receitas`: `fecharMes` mistura previsto com
 * realizado, entao somar o credito no REALIZADO publicaria como recebido um
 * dinheiro que ninguem pagou -- a familia de
 * `a-vencer-soma-receita-prevista-como-conta-a-pagar`. Essa recusa continua de
 * pe, e o que muda e o BALDE: aqui o destino e o previsto, e a simetria e
 * exata, porque a despesa correspondente tambem nao foi paga. A Lais pode nao
 * pagar; a conta do grupo tambem pode nao ser paga.
 *
 * E ELE TEM DE ENTRAR, OU A F1b MENTE
 * -----------------------------------
 * Desde a F1b (HMO-364) a aba Despesas conta a conta de grupo que EU fronto
 * pelo valor CHEIO -- `previstasPelaRegraDoPagador`. Sem esta funcao, o
 * «Previsto» de Despesas sobe R$ 300 num grupo 70/30 de R$ 1.000 e NADA sobe do
 * outro lado: a tela passa a mostrar uma divida que nao e minha. O plano da
 * HMO-360 registra isso como a trava central -- "F1 e F3 vao juntas ou nao
 * vao".
 *
 * O `realizado` NAO E TOCADO, E NEM AS CONTAGENS
 * ---------------------------------------------
 * `quantidadePrevista` conta LINHAS DA LISTA, e o reembolso nao e linha: o
 * credito nasce de `fecharMes`, que neta o mes, e nao de uma previsao gravada
 * que a pessoa possa abrir, editar ou confirmar. Incrementar a contagem
 * prometeria na frase "N lançamento(s)" uma linha que a lista nao tem --
 * `assercao-de-rotulo-casa-com-o-dado-rotulado` do lado da contagem.
 *
 * `total` SOBE JUNTO porque ele e `previsto + realizado` por definicao
 * (`resumoDaTela`); deixa-lo quieto faria o cartao «Total» discordar da soma
 * dos dois cartoes ao lado dele, que e a especie de defeito que esta tela
 * inteira foi escrita para nao ter.
 *
 * REEMBOLSO ZERO E `null`, E NAO UM ZERO: "R$ 0,00 a receber de grupos" na tela
 * de quem nao participa de grupo nenhum e ruido que parece recurso quebrado --
 * a mesma escolha de `notaDoCreditoAReceber` e de `notaDasPartesDeTerceiros`.
 */
export function resumoComReembolsoPrevisto(
  resumo: ResumoDaTela,
  tipo: TipoDaTela,
  reembolso: ReembolsoPrevisto | null
): ResumoComReembolso {
  // SO EM RECEITAS. Em Despesas o mesmo valor seria um abatimento da conta a
  // pagar (o criterio do `safe-to-spend`, que e outra pergunta e outra tela), e
  // em Transferencias ele nao significa nada.
  if (tipo !== "income") return { ...resumo, reembolso_previsto: null };

  // `<= 0` e nao `=== 0`: `creditoAReceber` nunca devolve negativo (ver
  // `creditoSemDevedorCents`), e se um dia devolver, somar isso ao «Previsto»
  // de Receitas DERRUBARIA a receita prevista do mes com um numero que a tela
  // apresentaria como credito a receber.
  if (!reembolso || reembolso.total <= 0) {
    return { ...resumo, reembolso_previsto: null };
  }

  return {
    ...resumo,
    previsto: centavos(resumo.previsto + reembolso.total),
    total: centavos(resumo.total + reembolso.total),
    reembolso_previsto: reembolso,
  };
}

/**
 * O que a conexao ainda me deve no MyBank, no «Previsto» de Receitas -- HMO-372,
 * leitura 2 de 7, e a decisao 2 da HMO-368.
 *
 * CAMPO PROPRIO E NAO DENTRO DE `reembolso_previsto`
 * -------------------------------------------------
 * A issue manda "reusar `lib/services/credito-dos-grupos.ts` como FORMA", e
 * forma e o que se reusa aqui: um resultado que entra no previsto e se diz em
 * separado. O NUMERO e outro balde. Somar o MyBank dentro de
 * `reembolso_previsto` teria dois precos:
 *
 *   * apagaria a medicao do credito de grupo -- a suite daquele modulo afirma
 *     um total, e um segundo somador no mesmo campo faz os dois mutantes
 *     sobreviverem (`unificar-criterio-duplicado-apaga-a-medicao-do-outro-modulo`);
 *   * a tela perderia a frase que diz de onde vem cada parte. "R$ 1.300 a
 *     receber" sem dizer que R$ 300 sao do grupo Casa e R$ 1.000 sao da moto da
 *     Lais e o quinto numero sem rotulo da familia
 *     `despesa-de-grupo-tem-tres-convencoes`.
 *
 * A COMPOSICAO E ASSOCIATIVA, E ISSO E O QUE A PERMITE: a rota chama
 * `resumoComReembolsoPrevisto` e depois esta, e a ordem nao muda o resultado
 * porque as duas somam no MESMO par de campos e nenhuma le o que a outra
 * escreveu. Se um dia uma delas passar a ler `resumo.previsto` para decidir
 * algo, a ordem passa a importar e isto deixa de ser verdade.
 *
 * `<= 0` PELA MESMA RAZAO de `resumoComReembolsoPrevisto`: `aReceberDoMyBank`
 * nunca devolve negativo (o CHECK do banco e `amount > 0` e a funcao usa
 * `Math.abs`), e se um dia devolver, somar isso aqui DERRUBARIA a receita
 * prevista do mes com um numero que a tela apresenta como credito a receber.
 */
export function resumoComAReceberDoMyBank<R extends ResumoDaTela>(
  resumo: R,
  tipo: TipoDaTela,
  aReceber: { total: number } | null
): R & { a_receber_do_mybank: { total: number } | null } {
  // SO EM RECEITAS, e as outras duas abas nao sao simetria vazia:
  //
  //   * em DESPESAS a parcela a receber seria um abatimento da conta a pagar --
  //     o criterio do `safe-to-spend`, que e outra pergunta e outra tela, e que
  //     a HMO-306/308 decidiu NAO reverter;
  //   * em TRANSFERENCIAS ela nao significa nada: o dinheiro da conexao nao se
  //     move entre duas contas minhas.
  if (tipo !== "income") return { ...resumo, a_receber_do_mybank: null };

  if (!aReceber || aReceber.total <= 0) {
    return { ...resumo, a_receber_do_mybank: null };
  }

  return {
    ...resumo,
    previsto: centavos(resumo.previsto + aReceber.total),
    total: centavos(resumo.total + aReceber.total),
    a_receber_do_mybank: aReceber,
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
