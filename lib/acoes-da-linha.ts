// -----------------------------------------------------------------------------
// QUAIS ACOES UMA LINHA DA LISTA GANHA, E PARA ONDE CADA UMA VAI (HMO-301)
// -----------------------------------------------------------------------------
// 10/10 do plano da HMO-279. "E em ambos os modos verificar pois todos
// lancamentos devem ter botoes de editar, excluir ou confirmar pra validar que
// foi pago ou recebido."
//
// Ate esta issue a linha de `components/movimentacoes/SecaoDaTela.tsx` era SO
// LEITURA, nas tres telas (Receitas, Despesas, Transferencias) que os dois
// modos usam -- o completo e o papel de pao. Entao isto nao e "habilitar no
// papel de pao": e a feature nascendo no lugar que serve aos dois.
//
// POR QUE A DECISAO MORA NUM MODULO PURO, E NAO NO JSX
// ---------------------------------------------------
// Porque ela e uma peneira de CINCO regras sobre estado de linha, e as cinco
// falham de forma plausivel: o botao aparece, a pessoa clica, e o que acontece
// e um 404, um 409, ou -- o pior -- um 200 que nao mudou nada. Nenhum desses
// tres estados tem sintoma na tela. Escritas como `&&` dentro do JSX elas nao
// teriam assercao nenhuma por cima; aqui `npm run test:acoes-da-linha` e
// `npm run mutantes:acoes-da-linha` as alcancam sem navegador.
//
// ARQUIVO-FOLHA, DE PROPOSITO: nenhum import de runtime alem de `comOrigem`
// (que tambem e folha -- `lib/retorno-do-lancamento.ts` so importa um TIPO).
// `LinhaDaTela` entra por `import type`, que o emit apaga. Isso e o que deixa
// este modulo barato de compilar na sonda de navegador de
// scripts/test-lista-na-tela.mjs, que concatena os `.js` de producao num script
// classico.
//
// =============================================================================
// AS CINCO REGRAS, E O QUE CADA UMA EVITA
// =============================================================================
//
// 1. "CONFIRMAR" SO EXISTE NO PREVISTO. Em linha realizada nao ha o que
//    confirmar, e um botao que confirmasse o que ja aconteceu gravaria a
//    SEGUNDA PERNA do mesmo dinheiro -- que e exatamente como este app ja
//    contou despesa duas vezes (ver a armadilha 2 do cabecalho de
//    lib/telas-de-movimentacao.ts). `origem` ja distingue, sem campo novo.
//
// 2. "PAGO OU RECEBIDO" E UMA ACAO E TRES ROTULOS. A rota da baixa e a MESMA
//    (`POST /api/scheduled-transactions/{id}/pay`); o texto segue a DIRECAO da
//    linha. Um rotulo so faz duas das tres telas mentir -- "Confirmar
//    pagamento" embaixo de um salario previsto e um verbo errado sobre um
//    numero certo, e e o mesmo defeito que `palavraDaLinha` existe para evitar
//    em `AparenciaDaTela`.
//
// 3. LINHA NAO GRAVADA NAO GANHA BOTAO. `gravada: false` e a fatura aberta
//    sintetizada (HMO-227): ela nao existe em tabela nenhuma e nao tem
//    `scheduled_transactions.id`. A baixa com id inventado responde 404 -- que,
//    para quem clicou, se le como "o app nao conseguiu".
//
// 4. SEM `posso_editar` NAO SAI BOTAO NENHUM. A lista pode conter linha de
//    OUTRO membro do grupo (a policy do 005 libera `group_id IS NOT NULL AND
//    is_group_member(group_id)`), e a RLS recusa a escrita. O modo de falha
//    pior esta medido neste repositorio: **UPDATE filtrado pela RLS volta 200
//    sem alterar nada** -- o app diz "pronto" e a linha fica. Botao que aparece
//    e nao funciona e pior que botao ausente.
//
// 5. A LINHA DE FATURA NAO ENTRA NA BAIXA GENERICA, mesmo GRAVADA -- e sao duas
//    razoes independentes, as duas suficientes:
//
//      * a fatura FECHADA se paga escolhendo A CONTA PAGADORA. O caminho de
//        `pagarFatura` exige `payment_account_id` no corpo
//        (`validarContaPagadora` em lib/card-invoice.ts), e um POST sem ele
//        volta erro. Um "Confirmar pagamento" que sempre falha e o botao da
//        regra 4 com outro nome;
//      * a linha de fatura ERA UM `<a>` para a tela do cartao (ver
//        `LinhaDaSecao` em SecaoDaTela.tsx). Botao dentro de ancora e
//        aninhamento interativo invalido, e o clique navegaria junto.
//
//    E E POR ISSO QUE A FATURA GANHOU DESTINO PROPRIO NA HMO-311 -- `podePagarAFatura`
//    la embaixo --, e nao uma excecao dentro de `podeAgirNaLinha`. As duas
//    razoes acima nao foram revogadas: elas foram ATENDIDAS. O destino e o
//    dialogo que PERGUNTA a conta pagadora
//    (components/fatura/DialogoDePagamentoDaFatura, HMO-310), e a linha deixou
//    de ser `<a>` -- o link virou o NOME DO CARTAO, dentro dela.
//
//    `podeAgirNaLinha` continua recusando a fatura, e o mutante que apaga essa
//    recusa continua tendo de morrer: a baixa generica e justamente a que volta
//    erro sem `payment_account_id`.
// -----------------------------------------------------------------------------

import { comOrigem } from "@/lib/retorno-do-lancamento";
import type { LinhaDaTela, TipoDaTela } from "@/lib/telas-de-movimentacao";

/**
 * O que uma acao precisa saber da linha.
 *
 * ESTRUTURAL E NAO `LinhaDaTela` INTEIRA, para que os casos de teste sejam
 * sete campos em vez de quinze -- e `LinhaDaTela` a satisfaz por construcao
 * (`Pick`), entao um campo renomeado la reprova o `tsc` aqui em vez de passar
 * silenciosamente.
 */
export type LinhaAcionavel = Pick<
  LinhaDaTela,
  | "id"
  | "gravada"
  | "origem"
  | "tipo"
  | "natureza"
  | "posso_editar"
  | "soma_nos_totais"
>;

/** O rotulo fixo dos dois botoes que nao mudam de nome por tela. */
export const ROTULO_DE_EDITAR = "Editar";
export const ROTULO_DE_EXCLUIR = "Excluir";

/**
 * O rotulo do botao da fatura -- "Pagar", e NAO "Confirmar pagamento".
 *
 * Os dois verbos prometem coisas diferentes, e so um deles e verdade aqui:
 * "Confirmar" diz que o clique JA resolveu (e e isso que `rotuloDeConfirmar` faz
 * nas outras linhas, onde a baixa sai no proprio clique). O da fatura ABRE UM
 * DIALOGO e pergunta de qual conta o dinheiro saiu -- quem clica ainda tem uma
 * escolha a fazer, e pode desistir.
 */
export const ROTULO_DE_PAGAR = "Pagar";

/**
 * O verbo da baixa, por direcao da linha -- regra 2.
 *
 * TRES e nao dois: a issue cita "recebimento" e "pagamento", e a tela de
 * Transferencias usa as mesmas linhas previstas (a transferencia recorrente da
 * 038 chega aqui com `direction: "transfer"`). Sem o terceiro caso ela cairia
 * num `??` e diria "pagamento" sobre dinheiro que so trocou de conta.
 */
export function rotuloDeConfirmar(tipo: TipoDaTela): string {
  if (tipo === "income") return "Confirmar recebimento";
  if (tipo === "transfer") return "Confirmar transferência";
  return "Confirmar pagamento";
}

/**
 * A base de todas as acoes: regras 3, 4 e 5 juntas.
 *
 * As tres sao conjuncao e nenhuma e redundante com as outras -- a fatura ABERTA
 * cai pela 3, a fatura FECHADA so pela 5, e a linha de outro membro do grupo so
 * pela 4.
 */
export function podeAgirNaLinha(linha: LinhaAcionavel): boolean {
  if (!linha.gravada) return false;
  if (!linha.posso_editar) return false;
  if (linha.natureza === "fatura") return false;
  return true;
}

/**
 * O DESTINO PROPRIO DA FATURA -- HMO-311 (fase 14).
 *
 * "Precisa colocar o botao de pagar tbm na fatura do cartao em despesas."
 *
 * NAO E `podeAgirNaLinha` COM UMA EXCECAO, e a diferenca nao e estilo: os dois
 * criterios se CONTRADIZEM em `gravada`, e de proposito.
 *
 *   * `podeAgirNaLinha` recusa `gravada: false` (regra 3) porque a baixa
 *     generica monta `/api/scheduled-transactions/{id}/pay` com o id da linha --
 *     e a fatura ABERTA sintetizada nao tem id de banco, so a chave
 *     `fatura:2026-10-01:<uuid>`. Aquela URL responde 404;
 *   * aqui `gravada` NAO E CONDICAO, porque este caminho nao monta aquela URL.
 *     Ele abre o dialogo, e a sequencia de escritas de `pagarAFatura`
 *     (lib/pagamento-da-fatura.ts, HMO-310) MATERIALIZA a fatura aberta pelo
 *     `POST /api/card-invoices/close` antes do `/pay` -- o id sai da resposta do
 *     `close`, nao da linha. A fatura aberta e precisamente o sabor que esta
 *     fase existe para alcancar: ela e a terceira fonte do «Previsto» da tela de
 *     Despesas, e em muitos meses a maior.
 *
 * Por isso este modulo NAO monta `PedidoDaAcao` para a fatura: pagar fatura e
 * uma ou duas escritas, e qual das duas sai de `gravada` -- a decisao e
 * `decisaoDePagamentoDaFatura`, e repetir o galho aqui seria a segunda
 * implementacao da de-duplicacao de fatura. O que esta funcao responde e so
 * "esta linha ganha o botao?".
 *
 * OS TRES CRITERIOS, e nenhum e redundante com os outros:
 *
 *   * `natureza === "fatura"` -- o criterio do botao, dito pela issue. Ele cobre
 *     os TRES sabores (aberta sintetizada, fechada na agenda, e a previsao
 *     digitada que alguem ligou ao elo da HMO-305), que e exatamente o conjunto
 *     que `pagarAFatura` sabe pagar. E e ele que impede o botao de brotar em
 *     Receitas: nenhuma linha de receita carrega a chave canonica da fatura;
 *
 *   * `origem === "previsto"` -- a regra 1 vale para esta baixa tambem. ELE
 *     DEIXOU DE SER SOBRE O AMANHA NA HMO-264. Quando este criterio foi escrito,
 *     `natureza: "fatura"` nao existia no realizado (`linhaRealizada` escrevia
 *     "fixa" ou "despesa", e `fatura` saia sempre `null`); a HMO-264 ("A fatura
 *     PAGA vira Realizado") a faz chegar de verdade -- a perna de SAIDA do
 *     pagamento, reconhecida pela chave canonica em `notes`. Sem este criterio a
 *     tela ofereceria "Pagar" numa fatura JA PAGA, e aquele `/pay` grava a
 *     SEGUNDA perna do mesmo dinheiro, que e como este app ja contou despesa
 *     duas vezes;
 *
 *   * `posso_editar` -- a regra 4, inteira e sem desconto. A lista de Despesas
 *     inclui linha de OUTRO membro do grupo desde a HMO-303, e **UPDATE filtrado
 *     pela RLS volta 200 sem alterar nada**: o dialogo diria "Fatura paga", o
 *     saldo nao mudaria, e a pessoa pagaria de novo pelo banco. Botao que
 *     aparece e nao funciona e pior que botao ausente.
 */
export function podePagarAFatura(linha: LinhaAcionavel): boolean {
  if (linha.natureza !== "fatura") return false;
  if (linha.origem !== "previsto") return false;
  if (!linha.posso_editar) return false;
  return true;
}

/**
 * TIRAR (OU DEVOLVER) A LINHA DOS TOTAIS -- HMO-452, F2 da HMO-443.
 *
 * "escolher uma despesa e uma receita pra nao aparecer nos totais, exemplo
 * adicionei um ajuste na minha conta investimento, ela entrou como uma receita
 * de ajuste mas nao quero que ela fique somana nos totais."
 *
 * OS QUATRO CRITERIOS, e nenhum e redundante com os outros:
 *
 *   * `gravada` e `posso_editar` vem da BASE (`podeAgirNaLinha`), e a regra 4
 *     vale aqui inteira e sem desconto -- esta acao e um `UPDATE`, e **UPDATE
 *     filtrado pela RLS volta 200 SEM ALTERAR NADA**. Numa linha de outro
 *     membro do grupo (a policy do 005 libera `group_id IS NOT NULL AND
 *     is_group_member(group_id)`) o botao diria "pronto", o selo nao
 *     apareceria, e o total continuaria igual. E o modo de falha mais caro
 *     desta feature, porque "nao mudou nada" e exatamente o que a tela mostra
 *     quando a acao FUNCIONA do outro lado da aritmetica: o cartao de Receitas
 *     cai, e nada na LINHA muda de numero;
 *
 *   * `natureza !== "fatura"` vem da base tambem, e aqui a razao e OUTRA (nao a
 *     regra 5): a linha de fatura PAGA e uma perna de pagamento, e desmarca-la
 *     tiraria do relatorio metade de um par que se anula -- o mes passaria a
 *     fechar pelo valor da fatura. A fatura ABERTA cai pelo `gravada`;
 *
 *   * `origem === "realizado"` E O CRITERIO PROPRIO DESTA ACAO, e e o unico que
 *     nao vem da base. A coluna da 060 e de `financial_transactions`. Uma linha
 *     PREVISTA e `scheduled_transactions`, e o PATCH dela vai para
 *     `/api/scheduled-transactions/{id}` -- que nao conhece o campo e o
 *     DESCARTARIA em silencio, com 200. O botao apareceria, a pessoa clicaria,
 *     e nada aconteceria nunca: o botao da regra 4 com outro nome. (E nao e
 *     perda nenhuma: a previsao nao esta em `category_monthly_totals`, que le a
 *     tabela realizada direto -- ela nao soma naqueles totais para comecar.)
 *
 * O QUE ESTA FUNCAO **NAO** PERGUNTA, de proposito: se a linha e de GRUPO. A
 * secao 6d do plano da HMO-443 decidiu que lancamento de grupo PODE ser
 * marcado, e o flag vale so para o relatorio PESSOAL -- o rateio, o acerto e o
 * saldo do grupo ignoram a coluna, porque a perna de grupo do custo pessoal sai
 * de `group_share_entries` (033), que nao passa por `category_monthly_totals`.
 * Recusar aqui tiraria a escolha de quem tem grupo sem proteger numero nenhum.
 * O que a linha de grupo ALHEIA perde ja esta coberto pelo `posso_editar`.
 */
export function podeMudarOsTotais(linha: LinhaAcionavel): boolean {
  if (!podeAgirNaLinha(linha)) return false;
  return linha.origem === "realizado";
}

/**
 * O rotulo da acao, pelo estado ATUAL da linha.
 *
 * DUAS FRASES PARA UM BOTAO, e nao um rotulo fixo: a acao e um interruptor, e
 * um nome so (`"Não somar nos totais"`) mentiria exatamente na metade dos casos
 * -- em cima da linha JA desmarcada ele prometeria desmarcar de novo, e quem
 * clicasse por engano nao teria como saber que acabou de RELIGAR a linha nos
 * relatorios. E a mesma razao de `rotuloDeConfirmar` ter tres verbos em vez de
 * um `??`.
 *
 * "NÃO SOMAR NOS TOTAIS" E A FORMA NEGATIVA, e ela e deliberada AQUI, ao
 * contrario do campo da CONTA (058), que usa o rotulo positivo "Somar nos
 * totais" num interruptor. A diferenca nao e descuido: ali o rotulo etiqueta um
 * `Switch`, e um rotulo negativo ao lado de um interruptor cria a dupla negacao
 * ("desligar «Não somar»" passa a querer dizer que soma). Aqui o rotulo e o
 * VERBO DE UM BOTAO -- o que a pessoa esta mandando acontecer --, e e o pedido
 * literal da issue-mae. Botao diz o que faz; etiqueta diz o que a coisa e.
 */
export const ROTULO_DE_TIRAR_DOS_TOTAIS = "Não somar nos totais";
export const ROTULO_DE_VOLTAR_AOS_TOTAIS = "Voltar a somar nos totais";

export function rotuloDeMudarOsTotais(linha: LinhaAcionavel): string {
  return linha.soma_nos_totais
    ? ROTULO_DE_TIRAR_DOS_TOTAIS
    : ROTULO_DE_VOLTAR_AOS_TOTAIS;
}

/**
 * O SELO da linha desmarcada, ou `null`.
 *
 * SEM O SELO A LINHA SE LE COMO BUG, e esta e a razao de ele existir -- a mesma
 * da conta fora dos totais na tela de Contas (058): a linha CONTINUA na lista,
 * com o valor dela, e NAO entra no cartao de «Realizado» em cima. Quem somasse
 * as linhas a mao acharia outro numero e concluiria que o total esta errado. O
 * selo e o que torna a diferenca legivel em vez de parecer defeito
 * (`sumido-da-tela-pode-ser-so-indistinguivel`).
 *
 * E A LINHA FICA NA LISTA DE PROPOSITO -- secao 6c do plano, decidida contra o
 * pedido original ("ela nao precisaria nem aparecer"): esconder a linha deixa o
 * dinheiro sem lugar NENHUM no app e o total sem explicacao. Lista limpa, se o
 * Helio quiser depois, e FILTRO da tela -- nao exclusao.
 *
 * `null` e nao `""` quando a linha soma: quem desenha nao pode renderizar um
 * `<span>` vazio, que muda o `gap` da linha sem mostrar nada.
 */
export const SELO_FORA_DOS_TOTAIS = "fora dos totais";

export function seloDaLinha(linha: LinhaAcionavel): string | null {
  return linha.soma_nos_totais ? null : SELO_FORA_DOS_TOTAIS;
}

/**
 * O QUE O FLAG **NAO** FAZ -- e esta frase e requisito, nao enfeite.
 *
 * A linha desmarcada CONTINUA no saldo da conta, no patrimonio e no grafico de
 * patrimonio, de proposito (secao 3c do plano, e o cabecalho da migration 060
 * em extenso): `net_worth_history` (008) le `financial_transactions` DIRETO e
 * nao passa por `category_monthly_totals`, onde o filtro mora. Isso nao e
 * esquecimento -- o dinheiro do ajuste ENTROU mesmo na conta, o
 * `update_account_balance_trigger` ja mexeu no `current_balance`, e tirar a
 * linha do patrimonio faria o saldo da tela de Contas discordar do patrimonio:
 * duas telas, o mesmo dinheiro, dois numeros.
 *
 * SEM A FRASE, ISSO E INDISTINGUIVEL DE UM BUG. A pessoa ve, na MESMA sessao, o
 * saldo da conta incluindo o ajuste e um total de receitas que nao o inclui --
 * e as duas leituras estao certas. Nenhum numero na tela explica a diferenca; a
 * frase e o unico lugar onde ela pode aparecer.
 *
 * UMA LINHA E NAO UM PARAGRAFO: ela mora embaixo da checkbox do formulario, que
 * e onde a decisao e tomada. "Continua" vem primeiro de proposito -- o medo de
 * quem desmarca e perder o lancamento, e a primeira palavra responde isso.
 */
export const AVISO_DO_FLAG_DOS_TOTAIS =
  "Continua no extrato, no saldo da conta e no patrimônio — só sai das somas " +
  "dos relatórios (fluxo de caixa, total por categoria, previsto x realizado " +
  "e os CSVs).";

/**
 * O PATCH que liga ou desliga o flag, ou `null`.
 *
 * O `null` e o contrato, como em `pedidoDeConfirmacao`: quem chama nao repete a
 * peneira, e nao tem como montar este pedido para uma linha PREVISTA -- cuja
 * URL seria `/api/scheduled-transactions/{id}`, onde o campo e descartado em
 * silencio com 200.
 *
 * O CORPO LEVA O BOOLEANO INVERTIDO E NAO UM "alternar", e os dois nao sao a
 * mesma coisa: um toggle calculado no SERVIDOR leria o estado de novo e dois
 * cliques concorrentes (ou um clique numa tela com a lista velha) acabariam no
 * estado oposto ao que a pessoa esta vendo. Mandando o valor explicito, o que
 * chega ao banco e o que estava escrito no botao.
 *
 * E O BOOLEANO VAI LITERAL, nao em string: a rota testa `=== true` / `=== false`
 * ESTRITO de proposito (`app/api/personal-finance/transactions/[id]`), porque a
 * string `"false"` e truthy e um `Boolean(...)` do outro lado gravaria o OPOSTO
 * do pedido. `JSON.stringify` de um booleano devolve `true`/`false` nus, que e
 * o que aquele teste espera -- este comentario existe para que ninguem
 * "conserte" o corpo para `String(...)` numa limpeza de tipos.
 */
export function pedidoDeMudarOsTotais(
  linha: LinhaAcionavel
): PedidoDaAcao | null {
  if (!podeMudarOsTotais(linha)) return null;
  return {
    metodo: "PATCH",
    url: `/api/personal-finance/transactions/${encodeURIComponent(linha.id)}`,
    corpo: { include_in_total: !linha.soma_nos_totais },
  };
}

/** Regra 1 por cima da base: a baixa so existe do lado previsto. */
export function podeConfirmar(linha: LinhaAcionavel): boolean {
  return podeAgirNaLinha(linha) && linha.origem === "previsto";
}

export function podeExcluir(linha: LinhaAcionavel): boolean {
  return podeAgirNaLinha(linha);
}

/**
 * Editar, com a UNICA excecao que nao e sobre RLS: a perna de transferencia JA
 * GRAVADA.
 *
 * Abrir uma perna na tela de despesa a transformaria em despesa e deixaria a
 * outra perna ORFA -- o saldo passaria a somar sozinho, pelo valor inteiro, sem
 * nada na tela parecendo errado. E a mesma recusa que a lista de Financas
 * Pessoais ja faz (`tipoDoLancamento` devolve `null` para transferencia), e pelo
 * mesmo motivo.
 *
 * A transferencia PREVISTA nao cai aqui: ela e UMA linha de
 * `scheduled_transactions` com as duas contas dentro, e o PATCH mexe nessa
 * linha so. As duas pernas nascem na baixa, nao na agenda.
 */
export function podeEditar(linha: LinhaAcionavel): boolean {
  if (!podeAgirNaLinha(linha)) return false;
  return !(linha.origem === "realizado" && linha.tipo === "transfer");
}

/**
 * Por que o Editar esta apagado, quando esta -- ou `null` quando ele aparece.
 *
 * Existe para que o botao desabilitado tenha MOTIVO escrito: um Editar cinza
 * sem explicacao e indistinguivel de tela quebrada, e a pessoa tenta de novo.
 */
export function motivoSemEditar(linha: LinhaAcionavel): string | null {
  if (podeEditar(linha)) return null;
  if (linha.origem === "realizado" && linha.tipo === "transfer") {
    return "Transferência não se edita por aqui: são duas pernas, e abrir só uma deixaria a outra órfã.";
  }
  return null;
}

/**
 * POR QUE O BOTAO ESTA CINZA -- HMO-475.
 *
 * Os quatro botoes da linha (Confirmar, Editar, Excluir, Pagar) recebem
 * `disabled` de um unico `travado` em `SecaoDaTela`, e `Button` carrega
 * `disabled:pointer-events-none disabled:opacity-50`: eles ficam meio
 * transparentes e intocaveis. Ate aqui esta CERTO e continua -- escrita sem rede
 * neste caminho nao fica pendente, ela FALHA, e dois cliques na mesma baixa sao
 * duas baixas (a segunda volta 409 depois de a primeira ter dado certo). O
 * defeito que esta funcao conserta e so a falta de EXPLICACAO colada no botao.
 *
 * O QUE ISSO JA CUSTOU, e e por isso que a explicacao vale uma funcao propria:
 * a HMO-457 ("Despesas no iphone") parou 6h esperando a resposta de UMA
 * pergunta -- "os botoes estao cinza ou ausentes?". As duas respostas levam a
 * consertos opostos (cache/cliente vs dado da conta), e cinza-sem-motivo e
 * indistinguivel de nunca-desenhado para quem olha a linha. Com o motivo no
 * botao, o relato ja chega desambiguado.
 *
 * O `agindo` VEM PRIMEIRO, e nao e ordem arbitraria: as duas condicoes podem
 * valer juntas (a rede cai no meio de uma escrita) e a mais imediata e a que
 * esta em curso -- aquele pedido vai terminar ou falhar em segundos, e e o que
 * explica o giro que a linha ja mostra. "Sem rede" sobre um botao que esta
 * girando leria como se nada estivesse acontecendo.
 *
 * DUAS FRASES PARA O `agindo`, e nao uma: `travado` desliga a secao INTEIRA
 * enquanto uma linha age, de proposito (uma segunda acao em paralelo chegaria no
 * meio da releitura da primeira). Uma frase so diria "esta linha está em
 * andamento" sobre as OUTRAS linhas -- que nao estao, e cujo dono nao tem como
 * saber que o motivo esta na linha de cima.
 */
export const MOTIVO_SEM_REDE =
  "Sem rede: esta lista é a do aparelho, e está só para leitura.";
export const MOTIVO_ACAO_NESTA_LINHA =
  "Ação em andamento nesta linha. Aguarde o fim dela.";
export const MOTIVO_ACAO_EM_OUTRA_LINHA =
  "Há uma ação em andamento em outra linha. Aguarde o fim dela.";

/** O estado que trava os botoes -- o mesmo que `AcoesDaLinha` carrega. */
export interface EstadoDoTravamento {
  /** `false` quando a lista veio do cache do aparelho: nenhuma escrita sai. */
  online: boolean;
  /** O id da linha cuja acao esta em curso, ou `null`. */
  agindo: string | null;
  /** O id DESTA linha -- e o que separa as duas frases do `agindo`. */
  idDaLinha: string;
}

/**
 * A frase que explica o cinza, ou `null` quando o botao NAO esta cinza.
 *
 * O `null` e o contrato, igual ao de `motivoSemEditar`: quem chama nao repete a
 * condicao de `travado`, ele pergunta o motivo e recebe `null` quando nao ha.
 */
export function motivoDoBotaoTravado(
  estado: EstadoDoTravamento,
): string | null {
  if (estado.agindo !== null) {
    return estado.agindo === estado.idDaLinha
      ? MOTIVO_ACAO_NESTA_LINHA
      : MOTIVO_ACAO_EM_OUTRA_LINHA;
  }
  if (!estado.online) return MOTIVO_SEM_REDE;
  return null;
}

/**
 * O `title` de um botao da linha: o rotulo, e o motivo quando ha um.
 *
 * O ROTULO CONTINUA NA FRENTE, e nao e enfeite: os tres botoes de icone nao tem
 * texto nenhum na tela, entao um `title` que dissesse so "Sem rede: ..." tiraria
 * do passar-o-mouse a unica forma de saber QUAL botao e aquele. O travessao
 * separa identidade de motivo.
 *
 * O `aria-label` NAO recebe o motivo, de proposito: ele e o nome acessivel do
 * botao e e por ele que as tres suites e as duas sondas acham cada botao
 * (`rotulosDeAcao`, `desabilitados`, `[aria-label="Pagar"]`). Mudar o nome
 * conforme o estado faria cada uma delas procurar uma string que so existe
 * metade do tempo.
 */
export function tituloDoBotao(rotulo: string, motivo: string | null): string {
  return motivo ? `${rotulo} — ${motivo}` : rotulo;
}

/**
 * O MOTIVO VISIVEL de uma linha que nao ganhou acao NENHUMA -- HMO-457.
 *
 * "Despesas no IOs nao esta mostrando opcao de editar, pagar ou excluir."
 *
 * `BotoesDaLinha` devolvia `null` quando as quatro peneiras recusavam, e esse
 * `null` e INDISTINGUIVEL de defeito: a linha desenha sem nada a direita e nada
 * na tela diz por que. Na lista de Despesas isso deixou de ser caso de borda na
 * HMO-303, quando o previsto passou a trazer a linha de OUTRO MEMBRO do grupo
 * (`.or(user_id.eq.<eu>,group_id.not.is.null)` em
 * app/api/movimentacoes/resumo/route.ts): numa conta com grupo, essas linhas
 * aparecem no meio das minhas, sem botao e sem explicacao. Lido da tela, "a
 * linha alheia nao se edita" e "a tela quebrou" sao a mesma imagem.
 *
 * TEXTO VISIVEL, E NAO `title`/`aria-disabled` NUM BOTAO APAGADO -- e as duas
 * metades dessa escolha foram medidas:
 *
 *   * `title` E INVISIVEL NO CELULAR. O tooltip nasce de `:hover`, e no iPhone
 *     nao ha hover -- exatamente o aparelho desta issue. Um motivo escrito so
 *     no `title` nao chega a quem reportou;
 *   * BOTAO APAGADO AQUI SERIA PIOR, e e decisao ja tomada: `motivoSemEditar`
 *     devolve `null` para a linha alheia de proposito ("um botao cinza sobre
 *     linha alheia convidaria a tentar o que a RLS nunca vai deixar", com
 *     assercao por cima em scripts/test-acoes-da-linha.mjs). O `UPDATE`
 *     recusado pela RLS volta 200 SEM ALTERAR NADA, entao o convite seria para
 *     um clique que diz "pronto" e nao fez nada.
 *
 * Dai o texto: ele explica sem oferecer, e aparece sem hover.
 *
 * `null` -- seguir desenhando nada -- nos casos em que a ausencia JA e o que a
 * pessoa espera, e a ordem das guardas e o que separa os dois:
 *
 *   * `!gravada` vem PRIMEIRO porque a linha sintetizada tambem chega aqui com
 *     `posso_editar: false`, e por outro motivo: a parcela devida do MyBank
 *     nasce com `user_id: ""` (ver o `select` de `parcelasDevidas` na rota).
 *     Ela e divida MINHA, nao de outro membro -- sem esta guarda a tela
 *     chamaria a minha parcela de "de outro membro", que e uma frase errada
 *     sobre dinheiro meu, e o erro mais caro que esta funcao poderia cometer;
 *   * a fatura ja PAGA (`natureza: "fatura"` no realizado) nao tem o que
 *     oferecer, e dizer isso seria ruido numa linha que esta certa.
 */
export function motivoSemAcoes(linha: LinhaAcionavel): string | null {
  // Ha acao: a tela desenha botao, e nao ha nada a explicar.
  //
  // `podePagarAFatura` NAO ENTRA AQUI, E A AUSENCIA E MEDIDA -- o mutante que o
  // acrescenta sobrevive, e sobrevive com razao. Ele EXIGE `posso_editar`
  // (regra 4, la na funcao dele), e a unica frase que esta funcao devolve exige
  // `!posso_editar`: as duas condicoes sao disjuntas, entao o termo nao pode
  // mudar resposta nenhuma. Escreve-lo seria um porteiro inobservavel -- codigo
  // que parece carregar a decisao e nao carrega.
  //
  // O que torna isso SEGURO de omitir e precisamente aquela implicacao, e ela
  // esta presa por assercao em scripts/test-acoes-da-linha.mjs ("o botao Pagar
  // EXIGE posso_editar"). No dia em que `podePagarAFatura` deixar de exigir
  // `posso_editar`, aquele bloco reprova e manda reabrir este `if`.
  //
  // `podeMudarOsTotais` (HMO-452) TAMBEM NAO ENTRA, e por um argumento mais
  // forte que o acima: ele e `podeAgirNaLinha(linha) && origem === "realizado"`,
  // e `podeExcluir` e `podeAgirNaLinha` NU. Entao `podeMudarOsTotais` IMPLICA
  // `podeExcluir`, que ja esta neste `if` -- acrescenta-lo nao poderia mudar
  // resposta nenhuma nem no dia em que o criterio dele mudasse, desde que ele
  // continue saindo da base. Escreve-lo seria um porteiro inobservavel
  // (`filtro-a-jusante-torna-o-porteiro-inobservavel`), e o mutante que o
  // acrescenta sobrevive com razao.
  if (podeEditar(linha) || podeExcluir(linha) || podeConfirmar(linha)) {
    return null;
  }

  // O Editar apagado ja carrega o motivo dele no `title`: repetir aqui diria a
  // mesma coisa duas vezes na mesma linha.
  if (motivoSemEditar(linha)) return null;

  // ANTES de `posso_editar` -- ver o cabecalho. Linha que nao existe em tabela
  // nenhuma nunca prometeu acao.
  if (!linha.gravada) return null;

  if (!linha.posso_editar) return "De outro membro";

  return null;
}

/** Um pedido HTTP pronto: o metodo, o caminho e o corpo (quando ha). */
export interface PedidoDaAcao {
  metodo: "POST" | "PATCH" | "DELETE";
  url: string;
  corpo?: Record<string, unknown>;
}

/**
 * A baixa. `null` quando a linha nao pode receber uma.
 *
 * O `null` E O CONTRATO, e nao zelo: ele e o que torna impossivel montar
 * `/api/scheduled-transactions/fatura:2026-08-01:<uuid>/pay` a partir da chave
 * sintetica da fatura aberta. Quem chama nao precisa repetir a peneira.
 */
export function pedidoDeConfirmacao(linha: LinhaAcionavel): PedidoDaAcao | null {
  if (!podeConfirmar(linha)) return null;
  return {
    metodo: "POST",
    url: `/api/scheduled-transactions/${encodeURIComponent(linha.id)}/pay`,
    // Corpo VAZIO de proposito: a rota usa `today()` do fuso de Sao Paulo
    // quando `paid_date` falta, e `amount` ausente mantem o valor previsto. Um
    // `paid_date` montado aqui seria a data do NAVEGADOR -- e num celular com o
    // fuso errado a baixa cairia no mes vizinho.
    corpo: {},
  };
}

/**
 * A exclusao. Dois destinos, e a escolha nao e cosmetica.
 *
 * A perna de transferencia JA GRAVADA sai por
 * `DELETE /api/movimentacoes/transferencia?id=`, que apaga AS DUAS. Pela rota de
 * lancamento comum a FK `ON DELETE SET NULL` do 015 nao reclama: a outra perna
 * FICA, com o elo zerado, mexendo o saldo de UMA conta. Meia transferencia nao
 * tem sintoma -- o extrato parece completo e o patrimonio esta errado pelo valor
 * inteiro. E a mesma bifurcacao que `deleteTransaction` da lista de Financas
 * Pessoais ja faz.
 */
export function pedidoDeExclusao(linha: LinhaAcionavel): PedidoDaAcao | null {
  if (!podeExcluir(linha)) return null;

  const id = encodeURIComponent(linha.id);

  if (linha.origem === "previsto") {
    return {
      metodo: "DELETE",
      url: `/api/scheduled-transactions/${id}`,
      // `apenas_esta` EXPLICITO, e nao confiando no default da rota: o alcance
      // decide se a serie inteira sai da agenda, e e a unica coisa que esta tela
      // NAO pergunta. Escrito, ele nao muda de significado no dia em que o
      // default da rota mudar. Ver lib/recorrencia-edicao.ts.
      corpo: { alcance: "apenas_esta" },
    };
  }

  if (linha.tipo === "transfer") {
    return {
      metodo: "DELETE",
      url: `/api/movimentacoes/transferencia?id=${id}`,
    };
  }

  return {
    metodo: "DELETE",
    url: `/api/personal-finance/transactions/${id}`,
  };
}

/**
 * O caminho de edicao de uma linha REALIZADA, ou `null`.
 *
 * `rotaDoFormulario` e a rota do FORMULARIO DE LANCAMENTO
 * (`/dashboard/movimentacoes/despesa`), e NAO a da tela
 * (`/dashboard/despesas`). As duas existem, as duas comecam com
 * `/dashboard/` e so uma sabe ler `?id=`: com a da tela, o Editar recarregaria
 * a propria lista com um parametro que ela ignora -- o clique nao faria
 * NADA VISIVEL. Foi exatamente o defeito que a sonda de navegador pegou no
 * codigo intacto desta issue, e nenhuma assercao de unidade o alcancava,
 * porque ela passa a string que ela mesma escolheu.
 *
 * Ela entra por PARAMETRO (vem de `AparenciaDaTela.rotaDeLancar`) para este
 * arquivo continuar folha -- importar `telaDoTipo` arrastaria
 * `telas-de-movimentacao` -> `movimentacoes`, `destino-do-lancamento`,
 * `chave-da-fatura` para dentro do grafo da sonda de navegador, por uma string.
 *
 * `?id=` e o nome que `FormularioDeLancamento` le (`parametros.get("id")`), e
 * `origem` volta para ESTA tela com o `?de=&ate=` dentro -- sem ele, fechar a
 * edicao de uma despesa de janeiro devolveria a pessoa ao mes corrente, onde ela
 * nao esta (HMO-249).
 *
 * A PREVISTA NAO TEM CAMINHO: ela nao e `financial_transactions`, e aquela tela
 * le `?id=` daquela tabela. Ela se edita no formulario em linha desta lista, por
 * `pedidoDeEdicaoDaPrevista`.
 */
export function caminhoDeEdicao(
  linha: LinhaAcionavel,
  rotaDoFormulario: string,
  origem: string | null | undefined
): string | null {
  if (!podeEditar(linha)) return null;
  if (linha.origem !== "realizado") return null;
  return comOrigem(
    `${rotaDoFormulario}?id=${encodeURIComponent(linha.id)}`,
    origem
  );
}

/** Os campos que o formulario em linha de uma conta prevista edita. */
export interface EdicaoDaPrevista {
  descricao: string;
  /** Em reais, como a pessoa digitou (ja normalizado para ponto). */
  valor: string;
  /** `AAAA-MM-DD`. */
  vencimento: string;
}

/**
 * O PATCH de uma conta prevista, ou a recusa com o motivo.
 *
 * VALIDA ANTES DE SAIR, porque as tres recusas da rota voltam 400 com texto em
 * portugues que a tela mostraria como "erro do servidor" -- e uma delas
 * (`amount <= 0`) e silenciosa de outra forma: um campo vazio vira `Number("")
 * === 0`, que nao e `NaN` e passa por qualquer guarda de `isNaN`.
 */
export function pedidoDeEdicaoDaPrevista(
  linha: LinhaAcionavel,
  edicao: EdicaoDaPrevista
): { pedido: PedidoDaAcao } | { erro: string } {
  if (!podeEditar(linha) || linha.origem !== "previsto") {
    return { erro: "Esta linha não pode ser editada por aqui." };
  }

  const descricao = edicao.descricao.trim();
  if (!descricao) return { erro: "Descrição é obrigatória." };

  // `replace` da virgula ANTES do `Number`: `Number("1.234,56")` e `NaN`, e
  // `type="number"` descarta a virgula no caminho (medido na HMO-271). O campo
  // e `type="text"` por isso.
  const valor = Number(edicao.valor.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(valor) || valor <= 0) {
    return { erro: "Valor deve ser maior que zero." };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(edicao.vencimento)) {
    return { erro: "Vencimento deve estar no formato AAAA-MM-DD." };
  }

  return {
    pedido: {
      metodo: "PATCH",
      url: `/api/scheduled-transactions/${encodeURIComponent(linha.id)}`,
      corpo: {
        description: descricao,
        amount: valor,
        due_date: edicao.vencimento,
        // Mesmo motivo do `apenas_esta` da exclusao: escrito, nao herdado.
        alcance: "apenas_esta",
      },
    },
  };
}

/**
 * O texto da confirmacao de exclusao -- e ele DIZ QUAL DAS DUAS COISAS VAI
 * ACONTECER.
 *
 * "Excluir ocorrencia nao e excluir a regra fixa", e o comportamento da rota
 * depende de a linha ter `recurring_rule_id`:
 *
 *   * linha de REGRA FIXA (`natureza: "fixa"`) -> a ocorrencia vira `skipped`;
 *     a regra continua ativa e segue gerando as proximas;
 *   * conta prevista AVULSA -> `DELETE` de verdade, a linha deixa de existir.
 *
 * As duas respondem 200 e as duas tiram a linha da tela, entao NADA no app
 * distingue uma da outra depois do clique. Quem clicou em "Excluir" num aluguel
 * fixo e viu a linha sumir concluiu que o aluguel acabou -- e ele volta no mes
 * seguinte. A frase e o unico lugar onde essa diferenca pode aparecer.
 *
 * `null` quando a linha nao pode ser excluida: a peneira de novo, para que a
 * tela nao possa perguntar sobre uma acao que nao vai acontecer.
 */
export function avisoDaExclusao(
  linha: LinhaAcionavel,
  nome: string | null
): string | null {
  if (!podeExcluir(linha)) return null;

  const rotulo = nome?.trim() ? `"${nome.trim()}"` : "este lançamento";

  if (linha.origem === "previsto") {
    if (linha.natureza === "fixa") {
      return (
        `Tirar ${rotulo} da agenda.\n\n` +
        "Isto vale SÓ para esta ocorrência. O gasto fixo continua ativo e vai " +
        "gerar as próximas — para encerrar a série inteira, use Contas a Pagar."
      );
    }
    return (
      `Excluir a conta prevista ${rotulo}.\n\n` +
      "Ela não nasceu de um gasto fixo, então é excluída de vez: não volta."
    );
  }

  if (linha.tipo === "transfer") {
    return (
      `Excluir a transferência ${rotulo}.\n\n` +
      "Ela existe nas DUAS contas. As duas pernas vão ser apagadas juntas — " +
      "apagar só uma deixaria o saldo da outra conta errado."
    );
  }

  return `Excluir ${rotulo}.\n\nO lançamento sai da sua conta e não volta.`;
}
