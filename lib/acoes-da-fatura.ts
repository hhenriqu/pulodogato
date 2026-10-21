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
