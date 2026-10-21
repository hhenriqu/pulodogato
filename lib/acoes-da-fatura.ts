// -----------------------------------------------------------------------------
// EDITAR E EXCLUIR UMA LINHA DA FATURA, DA TELA DO CARTAO (HMO-455)
// -----------------------------------------------------------------------------
// "Contas do cartao tambem podem ser editadas, excluidas e desconsideradas do
// saldo."
//
// Ate esta issue a tela de um cartao (`/dashboard/cartoes/[id]`) tinha UM unico
// botao na linha: apagar PARCELA (HMO-228). A compra avulsa -- que e a maioria
// das linhas de qualquer fatura -- nao tinha nem editar nem excluir. Quem
// quisesse corrigir o valor de uma compra de cartao tinha de sair da fatura,
// achar a mesma linha na lista de Despesas e mexer la, numa tela que nao diz em
// que fatura aquela compra caiu.
//
// POR QUE A DECISAO MORA NUM MODULO PURO, E NAO NO JSX
// ---------------------------------------------------
// Mesma razao de `lib/acoes-da-linha.ts`, da qual este arquivo e o irmao do
// lado do cartao: as tres regras abaixo falham de forma PLAUSIVEL -- o botao
// aparece, a pessoa clica, e o que acontece e um 400, um 404, ou um ajuste de
// saldo que vira compra. Nenhum desses tres tem sintoma na tela. Escritas como
// `&&` dentro do JSX elas nao teriam assercao nenhuma por cima.
//
// ARQUIVO-FOLHA, DE PROPOSITO: o unico import de runtime e `comOrigem`
// (`lib/retorno-do-lancamento.ts`, que so importa um TIPO). E por isso que ele
// entra barato no build de `test:tela-do-cartao`.
//
// =============================================================================
// AS TRES REGRAS, E O QUE CADA UMA EVITA
// =============================================================================
//
// 1. A LINHA DO AJUSTE DE SALDO NAO GANHA ACAO NENHUMA.
//
//    O ajuste (HMO-253) ja tem controle proprio, UM BLOCO ACIMA da lista, na
//    mesma tela: "Ajustar saldo" reabre o formulario com a descricao gravada e
//    "Remover" apaga o lancamento. Dar a ele um segundo par de botoes seria o
//    segundo escritor do mesmo dinheiro, e os dois divergem no primeiro
//    conserto.
//
//    E o Editar e pior que redundante ali: o formulario de lancamento deixa
//    TROCAR A CATEGORIA, e e a categoria reservada que faz aquela linha ser um
//    ajuste (`ehLinhaDeAjuste` sai da categoria, nao da descricao -- ver
//    `lib/ajuste-de-fatura.ts`). Uma edicao que mudasse a categoria tiraria o
//    selo "Ajuste" da linha E faria o bloco de cima concluir que esta fatura
//    nao tem ajuste nenhum: o proximo "Ajustar saldo" gravaria um SEGUNDO
//    ajuste, e a fatura passaria a fechar com a diferenca contada duas vezes.
//
//    A RESSALVA MEDIDA: quem decide se a linha e ajuste e `ehLinhaDeAjuste`, e
//    ela devolve `false` quando a categoria reservada NAO PODE ser conferida
//    (`adjustment_category_id` ausente na resposta -- `undefined`, que e
//    diferente de `null`). Nesse estado a linha do ajuste GANHA os botoes. Isso
//    e deliberado e nao um buraco: no mesmo estado a linha tambem fica SEM o
//    selo "Ajuste", entao a tela inteira esta dizendo "nao consegui conferir" de
//    forma uniforme -- e esconder os botoes de TODAS as linhas por causa de uma
//    sub-consulta que falhou desligaria a feature inteira num estado em que ela
//    funciona. O estrago possivel e uma edicao que o usuario pediu, numa linha
//    que e dele.
//
// 2. PARCELA E COMPRA AVULSA SAIEM POR PORTAS DIFERENTES, E E EXCLUDENTE.
//
//    A parcela continua indo para `DELETE /api/financial-installments/serie/
//    {id}`, que PERGUNTA O ALCANCE (so esta, desta em diante, ou todas) -- o
//    caminho da HMO-228, intocado. A compra avulsa vai para
//    `DELETE /api/personal-finance/transactions/{id}`.
//
//    Trocar as duas de lugar nao da erro de compilacao e da erro em tempo de
//    uso nos dois sentidos: a rota de serie responde 400 "nao faz parte de uma
//    compra parcelada" sobre a avulsa, e a rota de lancamento apagaria UMA
//    parcela de dez sem perguntar nada -- nove linhas restantes rotuladas
//    "parcela N de 10" numa serie que agora tem nove.
//
//    O criterio e `installment_number` sozinho, e NAO o par completo: e
//    exatamente o criterio que o botao da HMO-228 ja usa. Exigir o par aqui
//    abriria uma terceira classe (par meio preenchido) que ganharia o botao da
//    avulsa e cairia na rota errada.
//
// 3. NAO HA PENEIRA DE `posso_editar` AQUI, e a ausencia e medida.
//
//    `lib/acoes-da-linha.ts` tem a regra 4 ("sem `posso_editar` nao sai botao")
//    porque a lista de Despesas inclui linha de OUTRO membro do grupo, e UPDATE
//    barrado pela RLS volta 200 sem alterar nada. A lista desta tela nao tem
//    esse sabor: `GET /api/card-invoices` filtra `.eq("user_id", user.id)` antes
//    de devolver as linhas, entao toda linha que chega aqui e do proprio dono.
//    Repetir a peneira seria uma condicao que nunca e falsa -- e um `&&` que
//    nunca e falso nao tem como ser testado.
// -----------------------------------------------------------------------------

import { comOrigem } from "@/lib/retorno-do-lancamento";

/**
 * O que uma acao precisa saber da linha da fatura.
 *
 * ESTRUTURAL, e nao a linha inteira de `card_invoice_lines`: assim o caso de
 * teste sao quatro campos em vez de quinze, e a linha de verdade o satisfaz por
 * construcao.
 */
export interface LinhaDaFaturaAcionavel {
  transaction_id: string;
  description: string;
  /** `'expense'` ou `'income'` -- a view nao publica outro valor. */
  transaction_type?: string | null;
  installment_number?: number | null;
  installment_total?: number | null;
  /**
   * O `include_in_total` do proprio lancamento (060), publicado na view pela
   * 061 (HMO-459).
   *
   * **TRES ESTADOS, e o terceiro e a maioria das linhas.** A coluna e
   * `boolean DEFAULT true` ANULAVEL, e `NULL` nao quer dizer "fora": quer dizer
   * "ninguem mexeu no botao", que e o estado de toda compra gravada antes da
   * 060. `undefined` entra pelo mesmo caminho (linha vinda de um cache antigo,
   * ou de uma resposta montada antes da 061 estar colada).
   *
   * Quem le este campo NAO o le direto: le `somaNosTotaisDaFatura`, que resolve
   * os tres estados num booleano com `!== false`. O defeito classico desta
   * coluna e `!linha.include_in_total`, porque **`!null` e `true`** -- ele
   * marcaria como "fora dos totais" toda compra anterior a 060
   * (`coluna-booleana-anulavel-not-is-false`).
   */
  include_in_total?: boolean | null;
}

/**
 * Os rotulos, escritos aqui e nao importados de `lib/acoes-da-linha.ts`.
 *
 * As palavras sao as mesmas de proposito (um app com "Editar" numa tela e
 * "Alterar" na outra tem duas feature para o leitor), mas importar aquele
 * modulo arrastaria `lib/telas-de-movimentacao.ts` para o grafo de compilacao
 * deste build por duas strings.
 */
export const ROTULO_DE_EDITAR_NA_FATURA = "Editar";
export const ROTULO_DE_EXCLUIR_NA_FATURA = "Excluir";

/** Um pedido HTTP pronto: o metodo e o caminho. */
export interface PedidoDaLinhaDaFatura {
  metodo: "DELETE";
  url: string;
}

/**
 * O PATCH que liga ou desliga o flag dos totais.
 *
 * TIPO SEPARADO de `PedidoDaLinhaDaFatura`, e nao um `metodo` alargado para
 * `"DELETE" | "PATCH"` com `corpo` opcional: alargado, o tipo deixaria de
 * recusar o par errado. Um `{ metodo: "DELETE", corpo: {...} }` compilaria, e
 * um PATCH montado SEM corpo tambem -- este ultimo chegaria a rota como pedido
 * vazio, que responde 200 sem gravar nada (o teste estrito da HMO-452 testa
 * `=== true` / `=== false`, e `undefined` nao e nenhum dos dois). O botao
 * mudaria de rotulo na releitura seguinte e voltaria ao que era.
 */
export interface PedidoDeMudarOsTotaisDaFatura {
  metodo: "PATCH";
  url: string;
  corpo: { include_in_total: boolean };
}

/**
 * A linha e uma PARCELA? -- regra 2.
 *
 * `Boolean(...)` e nao `!= null`: `installment_number: 0` nao existe (a 035
 * grava de 1 a M) e um zero que passasse daqui mandaria a linha para a rota de
 * serie, que responderia 400.
 */
export function ehParcelaDaFatura(linha: LinhaDaFaturaAcionavel): boolean {
  return Boolean(linha.installment_number);
}

/**
 * A base das duas acoes: a regra 1.
 *
 * `ehAjuste` entra por PARAMETRO em vez de ser derivado aqui porque quem sabe
 * dizer e `ehLinhaDeAjuste` (`lib/ajuste-de-fatura.ts`), que precisa da
 * categoria reservada vinda da rota. Derivar aqui seria a segunda definicao de
 * "o que e um ajuste" -- e a que divergisse da outra daria botao a uma linha
 * com selo de Ajuste, ou selo a uma linha com botoes.
 */
export function podeAgirNaLinhaDaFatura(
  linha: LinhaDaFaturaAcionavel,
  ehAjuste: boolean
): boolean {
  if (ehAjuste) return false;
  if (!linha.transaction_id) return false;
  return true;
}

/**
 * Para qual FORMULARIO esta linha abre -- despesa ou receita.
 *
 * `card_invoice_lines` so publica `expense` e `income` (ela filtra os dois no
 * `WHERE`), e a diferenca importa: abrir um estorno no formulario de despesa o
 * reclassificaria como despesa na primeira gravacao, porque a rota de PATCH
 * RE-DERIVA o tipo pela categoria escolhida (ver o bloco "TIPO E SINAL NA
 * EDICAO" de `app/api/personal-finance/transactions/[id]/route.ts`). O estorno
 * de R$ 200 viraria uma compra de R$ 200 e a fatura subiria R$ 400.
 *
 * O default e DESPESA porque e o que a fatura e: compra. Uma linha sem
 * `transaction_type` (coluna nula nas linhas antigas, antes da 037) abre como
 * despesa, que e o que ela quase certamente e.
 */
export function rotaDoFormularioDaLinha(
  linha: LinhaDaFaturaAcionavel
): "/dashboard/movimentacoes/despesa" | "/dashboard/movimentacoes/receita" {
  return linha.transaction_type === "income"
    ? "/dashboard/movimentacoes/receita"
    : "/dashboard/movimentacoes/despesa";
}

/**
 * O caminho do Editar, ou `null` quando a linha nao se edita por aqui.
 *
 * `?id=` e o nome que `FormularioDeLancamento` le, e `origem` e o que faz o
 * Cancelar/Salvar voltarem para A FATURA em vez da lista de Lancamentos -- sem
 * ele, corrigir uma compra joga a pessoa numa tela que ela nao estava olhando
 * (HMO-249).
 */
export function caminhoDeEdicaoDaLinhaDaFatura(
  linha: LinhaDaFaturaAcionavel,
  ehAjuste: boolean,
  origem: string | null | undefined
):
  | `/dashboard/movimentacoes/despesa?${string}`
  | `/dashboard/movimentacoes/receita?${string}`
  | null {
  if (!podeAgirNaLinhaDaFatura(linha, ehAjuste)) return null;

  return comOrigem(
    `${rotaDoFormularioDaLinha(linha)}?id=${encodeURIComponent(
      linha.transaction_id
    )}`,
    origem
  );
}

/**
 * O DELETE da compra AVULSA, ou `null`.
 *
 * `null` para a parcela e o contrato, nao zelo: e o que torna impossivel montar
 * `/api/personal-finance/transactions/{id}` a partir de uma linha que e parte
 * de uma serie. Quem chama nao precisa repetir a peneira -- e se repetisse,
 * seria o segundo lugar que decide o que e parcela.
 */
export function pedidoDeExclusaoDaLinhaDaFatura(
  linha: LinhaDaFaturaAcionavel,
  ehAjuste: boolean
): PedidoDaLinhaDaFatura | null {
  if (!podeAgirNaLinhaDaFatura(linha, ehAjuste)) return null;
  if (ehParcelaDaFatura(linha)) return null;

  return {
    metodo: "DELETE",
    url: `/api/personal-finance/transactions/${encodeURIComponent(
      linha.transaction_id
    )}`,
  };
}

/**
 * A pergunta que antecede a exclusao da compra avulsa.
 *
 * TODA ACAO DESTRUTIVA PERGUNTA ANTES DE SAIR, com a mesma forma que a lista de
 * Lancamentos ja usa (`avisoDaExclusao`). A frase DIZ O QUE SAI E O QUE FICA: a
 * compra sai da fatura e o saldo do cartao volta -- quem le "Tem certeza?" nao
 * sabe se vai perder a linha ou a fatura inteira.
 *
 * A descricao entra na frase porque a lista tem muitas linhas parecidas, e
 * confirmar a errada e silencioso: some uma linha de R$ 80 e fica a outra.
 */
export function avisoDaExclusaoDaLinhaDaFatura(
  linha: LinhaDaFaturaAcionavel
): string {
  const nome = linha.description?.trim() || "esta compra";
  return `Excluir "${nome}" desta fatura? A compra sai do app e o saldo do cartão volta. Isso não pode ser desfeito.`;
}

// =============================================================================
// DESCONSIDERAR A COMPRA DO SALDO -- O TERCEIRO VERBO (HMO-461, F2b da HMO-455)
// =============================================================================
//
// "Contas do cartao tambem podem ser editadas, excluidas e DESCONSIDERADAS DO
// SALDO." Editar e excluir sairam na Fase 1; este bloco e o terceiro verbo.
//
// A ESCOLHA DE SEMANTICA FOI DO HELIO -- A **OPCAO A**, no cartao de decisao da
// HMO-455 (interaction `1a40529a`, 2026-10-21): a linha sai dos RELATORIOS e
// **o total da fatura continua inteiro**.
//
// POR QUE A FATURA NAO MUDA, e por que isso nao e esquecimento
// -----------------------------------------------------------
//   * a fatura do app continua batendo com a do banco -- e isso que o Helio
//     confere, com o papel ao lado da tela. Uma fatura que "desconta" uma
//     compra marcada passaria a discordar do extrato do cartao por um valor que
//     nao esta escrito em lugar nenhum;
//   * a soma das linhas continua fechando com o total impresso em cima delas --
//     e o mesmo argumento da linha do Ajuste, que fica na lista por isso
//     (`sumido-da-tela-pode-ser-so-indistinguivel`);
//   * reconciliar diferenca REAL contra o extrato ja tem ferramenta: o **Ajuste
//     de saldo** (HMO-253), um bloco acima nesta mesma tela. Se o flag TAMBEM
//     mexesse na fatura, as duas brigariam pelo mesmo numero, e o proximo
//     conserto de uma apareceria como defeito da outra.
//
// Quem efetivamente tira a linha das somas e a cadeia de
// `category_monthly_totals` (060) -- a view `card_invoice_lines` PUBLICA o flag
// e nao o FILTRA (061). Ver o cabecalho daquela migration em extenso.
//
// E A TELA TEM DE DIZER ISSO EM PALAVRAS -- `AVISO_DA_FATURA_INTEIRA` abaixo.
// Sem a frase, a pessoa marca a linha, ve o total da fatura NAO mudar, e
// conclui que o botao nao funcionou. O selo sozinho nao responde: ele diz *que*
// a linha saiu, nao *de onde*.

/**
 * A linha SOMA nos totais? -- a resolucao dos tres estados, num lugar so.
 *
 * `!== false`, E NAO `=== true`: a coluna da 060 e `boolean DEFAULT true`
 * ANULAVEL, e `NULL` quer dizer "ninguem mexeu no botao" -- ou seja, SOMA. Toda
 * compra gravada antes da 060 esta nesse estado, e um `=== true` aqui poria o
 * selo "fora dos totais" em cima da fatura inteira de qualquer mes antigo.
 *
 * `undefined` cai no mesmo ramo de proposito, e e um estado ALCANCAVEL: a linha
 * pode vir de cache offline gravado antes da 061, ou de uma resposta de rota
 * que nao publicava a coluna. "Nao sei" tem de valer "soma", que e o default da
 * coluna e a leitura conservadora -- a errada por aqui marca como fora do
 * relatorio dinheiro que esta dentro dele.
 *
 * E a MESMA frase de `soma_nos_totais` em `lib/telas-de-movimentacao.ts`
 * (`crua.include_in_total !== false`) e a mesma do `IS NOT FALSE` que a 060
 * usa: as tres nao voltam a divergir em silencio.
 */
export function somaNosTotaisDaFatura(linha: LinhaDaFaturaAcionavel): boolean {
  return linha.include_in_total !== false;
}

/**
 * Esta linha pode ser marcada/desmarcada? -- a regra 1, de novo, e nada mais.
 *
 * A LINHA DO AJUSTE DE SALDO CONTINUA SEM ACAO NENHUMA, pela terceira vez e
 * pelo mesmo motivo da Fase 1: o ajuste ja tem controle proprio um bloco acima,
 * e a categoria reservada e o que faz aquela linha SER um ajuste. Marcar o
 * ajuste "fora dos totais" seria pior que redundante -- ele existe exatamente
 * para reconciliar o total, e tira-lo do relatorio enquanto ele continua na
 * fatura deixaria a diferenca que ele representa sem lugar nenhum.
 *
 * ISSO E SOBRE O BOTAO, E NAO SOBRE O SELO: um ajuste JA marcado por outra tela
 * (a lista de Despesas da HMO-452 nao peneira a categoria reservada) continua
 * mostrando o selo aqui, porque o selo DESCREVE o estado. Ver
 * `seloDaLinhaDaFatura`.
 *
 * A PARCELA, ESSA SIM, PODE -- e aqui esta a diferenca para `excluir`, que a
 * recusa (`pedidoDeExclusaoDaLinhaDaFatura` devolve `null` para parcela).
 * Nao e inconsistencia:
 *
 *   * desde a 035 cada parcela E uma linha de `financial_transactions`, com id
 *     proprio, e `PATCH /api/personal-finance/transactions/{id}` grava nela sem
 *     tocar nas irmas;
 *   * EXCLUIR uma parcela de dez e que estraga a serie -- sobram nove linhas
 *     rotuladas "parcela N de 10". Marcar uma delas fora dos totais nao mexe em
 *     rotulo nenhum: as dez continuam existindo, com os mesmos numeros;
 *   * e recusar aqui tiraria a escolha justamente de quem mais precisa dela --
 *     a parcela de uma compra que a pessoa nao quer no relatorio pessoal (a
 *     compra reembolsada pelo trabalho, o presente rateado) chega em dez
 *     linhas, e nao ha outro caminho para tira-las.
 *
 * NAO HA PENEIRA DE `origem` AQUI, ao contrario de `podeMudarOsTotais` em
 * `lib/acoes-da-linha.ts`, que exige `origem === "realizado"`. Aquela lista
 * mistura previsto e realizado; esta nao: `gastosDaFatura` devolve linhas de
 * `card_invoice_lines`, que e view sobre `financial_transactions` -- toda linha
 * que chega aqui JA e realizada. As contas PREVISTAS do cartao sao outro bloco
 * da tela, com props proprios (HMO-460), e nao passam por esta funcao.
 */
export function podeMudarOsTotaisDaLinhaDaFatura(
  linha: LinhaDaFaturaAcionavel,
  ehAjuste: boolean
): boolean {
  return podeAgirNaLinhaDaFatura(linha, ehAjuste);
}

/**
 * Os rotulos do botao -- DUAS FRASES, pelo estado atual da linha.
 *
 * As palavras sao as de `lib/acoes-da-linha.ts` (HMO-452) de proposito, e nao
 * importadas dali pela razao do cabecalho deste arquivo: aquele modulo arrasta
 * `lib/telas-de-movimentacao.ts` para o grafo de compilacao por duas strings.
 * Um app que diz "Nao somar nos totais" na lista de Despesas e outra coisa na
 * fatura tem duas features para quem le.
 *
 * ROTULO FIXO MENTIRIA EM METADE DOS CLIQUES: em cima da linha JA desmarcada,
 * "Nao somar nos totais" prometeria desmarcar de novo, e quem clicasse por
 * engano nao teria como saber que acabou de RELIGAR a compra nos relatorios.
 */
export const ROTULO_DE_TIRAR_DOS_TOTAIS_NA_FATURA = "Não somar nos totais";
export const ROTULO_DE_VOLTAR_AOS_TOTAIS_NA_FATURA =
  "Voltar a somar nos totais";

export function rotuloDeMudarOsTotaisDaLinhaDaFatura(
  linha: LinhaDaFaturaAcionavel
): string {
  return somaNosTotaisDaFatura(linha)
    ? ROTULO_DE_TIRAR_DOS_TOTAIS_NA_FATURA
    : ROTULO_DE_VOLTAR_AOS_TOTAIS_NA_FATURA;
}

/**
 * O SELO da linha desmarcada, ou `null`.
 *
 * SEM O SELO A LINHA FICA INDISTINGUIVEL DA VIZINHA: ela continua na fatura,
 * com o valor dela, somando no total impresso em cima -- e o unico lugar onde a
 * diferenca existe e num relatorio em OUTRA tela. Nada no pixel diria que
 * aquela compra de R$ 300 nao esta no "total por categoria" do mes.
 *
 * NAO RECEBE `ehAjuste`, e a assimetria com `podeMudarOsTotaisDaLinhaDaFatura`
 * e deliberada: **o selo descreve, o botao decide.** Um ajuste pode chegar aqui
 * marcado -- a lista de Despesas (HMO-452) oferece o toggle em qualquer
 * lancamento realizado e nao peneira a categoria reservada --, e nesse estado o
 * selo esta certo: aquele ajuste de fato saiu dos relatorios. Esconde-lo faria
 * esta tela calar sobre dinheiro que saiu das somas, no unico lugar onde a
 * pessoa teria como notar.
 *
 * As palavras sao as mesmas de `SELO_FORA_DOS_TOTAIS` (HMO-452), pelo mesmo
 * motivo dos rotulos acima.
 *
 * `null` e nao `""` quando a linha soma: quem desenha nao pode renderizar um
 * `<Badge>` vazio, que muda o `gap` da linha sem mostrar nada.
 */
export const SELO_FORA_DOS_TOTAIS_NA_FATURA = "fora dos totais";

export function seloDaLinhaDaFatura(
  linha: LinhaDaFaturaAcionavel
): string | null {
  return somaNosTotaisDaFatura(linha)
    ? null
    : SELO_FORA_DOS_TOTAIS_NA_FATURA;
}

/**
 * A FRASE, e ela e REQUISITO desta issue -- nao enfeite.
 *
 * O item 3 do escopo da HMO-461, em extenso. Sem ela o fluxo inteiro se le como
 * bug: a pessoa clica "Nao somar nos totais", a tela recarrega a fatura, e o
 * total em cima esta IGUAL ao centavo. Nenhum numero na tela explica isso, e o
 * selo na linha nao responde a pergunta que ela acabou de fazer -- ele diz que
 * a linha saiu, nao de onde. A conclusao disponivel e "o botao nao funciona", e
 * o proximo passo do usuario e clicar de novo (religando a linha) ou lancar um
 * ajuste de saldo para "consertar" um total que esta certo.
 *
 * "CONTINUA" VEM PRIMEIRO, como em `AVISO_DO_FLAG_DOS_TOTAIS`: o medo de quem
 * marca e ter mexido na fatura que ele vai pagar, e a primeira palavra responde
 * isso. Depois a frase diz DE ONDE a linha saiu, nomeando os relatorios -- "sai
 * dos totais" sozinho nao e endereco nenhum.
 *
 * E ela NOMEIA O AJUSTE DE SALDO no fim, que e o bloco logo acima nesta mesma
 * tela: quem marcou a linha querendo mudar o valor da fatura estava procurando
 * a outra ferramenta, e esta e a unica frase na tela que pode manda-lo para
 * la. Sem isso a resposta e correta e inutil.
 */
export const AVISO_DA_FATURA_INTEIRA =
  "O total desta fatura continua inteiro — a compra marcada só sai das somas " +
  "dos relatórios (fluxo de caixa, total por categoria, previsto x realizado " +
  "e os CSVs). Para a fatura do app bater com a do banco por outro valor, use " +
  "o Ajuste de saldo acima.";

/**
 * A fatura tem pelo menos uma linha fora dos totais? -- o pedagio da frase.
 *
 * A FRASE E CONDICIONAL, e nao fixa embaixo do total, porque a pergunta que ela
 * responde so existe depois do primeiro clique. Impressa sempre, ela explicaria
 * um flag que a maioria das faturas nao usa -- e aviso permanente que nao se
 * aplica e o tipo de texto que se aprende a nao ler, justamente antes do mes em
 * que ele passa a importar.
 *
 * O CRITERIO PASSA POR `somaNosTotaisDaFatura` PARA TER UMA DEFINICAO SO, e nao
 * porque `=== false` daria outro resultado: `!(x !== false)` E `x === false`
 * sao equivalentes, e o mutante que troca um pelo outro SOBREVIVE com razao
 * (medido -- `mutante-sobrevivente-pode-estar-certo`). O que esta forma
 * previne e a terceira escrita, a unica que erra de verdade:
 * `!linha.include_in_total`, que acende em toda fatura antiga porque **`!null`
 * e `true`** -- esse mutante MORRE em dois testes.
 *
 * NAO filtra ajuste: um ajuste marcado por outra tela conta, e deve contar --
 * a frase explica por que o total nao mudou, e a razao vale igual.
 */
export function faturaTemLinhaForaDosTotais(
  linhas: readonly LinhaDaFaturaAcionavel[] | null | undefined
): boolean {
  if (!linhas) return false;
  return linhas.some((linha) => !somaNosTotaisDaFatura(linha));
}

/**
 * O PATCH que liga ou desliga o flag, ou `null`.
 *
 * `null` e o contrato, como nos dois pedidos da Fase 1: quem chama nao repete a
 * peneira, e nao tem como montar este pedido para a linha do Ajuste.
 *
 * O CORPO LEVA O BOOLEANO INVERTIDO, E NAO UM "alternar". Um toggle resolvido
 * no SERVIDOR leria o estado de novo, e dois cliques concorrentes -- ou um
 * clique numa tela com a fatura velha na memoria -- acabariam no estado OPOSTO
 * ao que a pessoa esta vendo. Mandando o valor explicito, o que chega ao banco e
 * o que estava escrito no botao.
 *
 * E ELE SAI DE `somaNosTotaisDaFatura`, nao de `!linha.include_in_total`: na
 * linha NULL o segundo manda `true` -- a pessoa clica "Nao somar" e a rota
 * recebe "somar", com 200 e sem sintoma. Mutante medido e morto.
 *
 * O BOOLEANO VAI LITERAL, nao em string: a rota da HMO-452 testa
 * `body.include_in_total === true` ESTRITO, porque a string `"false"` e truthy e
 * um `Boolean(...)` do outro lado gravaria o OPOSTO do pedido, com 200 e sem
 * sintoma. `JSON.stringify` de um booleano devolve `true`/`false` nus, que e o
 * que aquele teste espera -- este comentario existe para que ninguem
 * "conserte" o corpo para `String(...)` numa limpeza de tipos.
 *
 * A ROTA E A DA HMO-452, CHAMADA E NAO REIMPLEMENTADA: ela ja grava a coluna
 * com teste estrito e mutantes. Nenhum `.select()` dela nomeia
 * `include_in_total` (o defeito do #335), e por isso esta chamada nao depende
 * da 060 estar colada para nao dar 500 -- mas a LEITURA desta tela depende da
 * 061, que foi medida em prod em 2026-10-21.
 */
export function pedidoDeMudarOsTotaisDaLinhaDaFatura(
  linha: LinhaDaFaturaAcionavel,
  ehAjuste: boolean
): PedidoDeMudarOsTotaisDaFatura | null {
  if (!podeMudarOsTotaisDaLinhaDaFatura(linha, ehAjuste)) return null;

  return {
    metodo: "PATCH",
    url: `/api/personal-finance/transactions/${encodeURIComponent(
      linha.transaction_id
    )}`,
    corpo: { include_in_total: !somaNosTotaisDaFatura(linha) },
  };
}
