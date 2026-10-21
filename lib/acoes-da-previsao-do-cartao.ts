// -----------------------------------------------------------------------------
// EDITAR E EXCLUIR UMA CONTA PREVISTA DO CARTAO (HMO-460)
// -----------------------------------------------------------------------------
// Fase F3 da HMO-455. Helio respondeu "sim" a segunda pergunta do cartao de
// decisao: "contas do cartao" INCLUI as contas previstas do cartao.
//
// O BURACO QUE ESTA FASE FECHA E O MAIS FECHADO DOS DOIS
// -----------------------------------------------------
// Na tela `/dashboard/cartoes/[id]`, abaixo da fatura, o bloco "N contas
// previstas neste cartao" (HMO-227) lista a assinatura mensal cadastrada com o
// cartao como CONTA -- linha de `scheduled_transactions`, nao compra de fatura.
// Ate esta issue aquelas linhas:
//
//   * nao tinham botao nenhum aqui, nem editar nem excluir;
//   * nao aparecem em Contas a Pagar -- a HMO-209 as tirou de la DE PROPOSITO,
//     para a mesma despesa nao ser somada ao lado da fatura que ja a contem;
//
// logo, nao se editavam nem se apagavam em lugar NENHUM do app. A compra da
// fatura (fase F1, `lib/acoes-da-fatura.ts`) ao menos se editava pela lista de
// Despesas; esta nao se editava em parte alguma.
//
// E POR ISSO QUE A CORRECAO E AQUI, E NAO DESFAZENDO A HMO-209. Devolve-las a
// Contas a Pagar faria a assinatura de R$ 39,90 ser contada duas vezes no
// «Previsto» -- uma como conta a pagar solta e outra dentro da fatura do cartao.
// O que faltava era a ACAO, nao a listagem.
//
// POR QUE A DECISAO MORA NUM MODULO PURO, E NAO NO JSX
// ---------------------------------------------------
// Mesma razao de `lib/acoes-da-fatura.ts` e de `lib/acoes-da-linha.ts`, dos
// quais este arquivo e o terceiro irmao: as regras abaixo falham de forma
// PLAUSIVEL -- o botao aparece, a pessoa clica, e o que acontece e um 400, uma
// serie inteira apagada, ou uma regra viva que gera a conta de novo tres meses
// depois. Nenhum desses tres tem sintoma na tela no momento do clique.
//
// =============================================================================
// AS QUATRO REGRAS, E O QUE CADA UMA EVITA
// =============================================================================
//
// 1. A EXCLUSAO PERGUNTA O ALCANCE -- MAS SO QUANDO HA SERIE.
//
//    A conta prevista pode ser ocorrencia de um gasto fixo (`recurring_rule_id`
//    preenchido), e ai o alcance decide entre tres coisas DIFERENTES, duas delas
//    silenciosas:
//
//      * `apenas_esta`     -> `skipped` nesta ocorrencia; a regra continua ativa
//                             e traz a conta de volta no mes seguinte;
//      * `esta_e_proximas` -> `skipped` nas futuras E `end_date` na regra;
//      * `todas`           -> `encerrarRegra`, o mesmo caminho de
//                             `DELETE /api/recurring-rules/{id}`.
//
//    Um delete sem a pergunta tem de escolher um dos tres por conta propria, e
//    os dois erros possiveis sao mudos: com `apenas_esta` quem quis cancelar a
//    assinatura perde UM mes e recebe os outros de volta; com `todas` quem quis
//    pular dezembro encerra a assinatura inteira. Nos dois casos a linha SAI da
//    tela no clique -- este bloco le `my_status = pending` --, entao a tela diz
//    a mesma coisa nos tres alcances. A diferenca so aparece no mes seguinte.
//
//    A CONTA AVULSA NAO PERGUNTA, e a assimetria e deliberada: sem regra nao ha
//    "proximas" nem "todas" (`planejarExclusao` devolve `apagarDeVez` nos tres
//    alcances), e perguntar faria a pessoa procurar a diferenca entre tres
//    opcoes que fazem a mesma coisa. E a mesma decisao que `pedirExclusao` de
//    `bills/page.tsx` ja toma, pelo mesmo motivo.
//
// 2. A AVULSA GANHA FRASE DE CONFIRMACAO; A SERIE, NAO.
//
//    E nao e economia de texto: a serie recebe o `DialogoDeAlcance`, cujas tres
//    consequencias (`opcoesDeAlcance`, em `lib/alcance-na-tela.ts`) ja dizem o
//    que cada alcance faz. Um `confirm()` ANTES do dialogo seria a mesma
//    pergunta duas vezes, e a primeira sem a informacao que importa.
//
//    O TEXTO DA AVULSA E `avisoDaExclusao`, reusado -- mas SO o ramo da avulsa,
//    e isso esta medido: o ramo da `fixa` daquela funcao termina em "para
//    encerrar a serie inteira, use Contas a Pagar", e aqui essa frase seria
//    FALSA. A HMO-209 tirou esta linha de Contas a Pagar; mandar a pessoa para
//    uma tela onde a conta nao aparece e pior que nao dizer nada. Quem explica a
//    serie AQUI e o dialogo.
//
// 3. A EDICAO VALE SO PARA A OCORRENCIA, E A TELA TEM DE DIZER ISSO.
//
//    `pedidoDeEdicaoDaPrevista` grava `alcance: "apenas_esta"` -- o menos
//    destrutivo, e o mesmo que o formulario em linha da lista de Lancamentos ja
//    usa. Num gasto fixo isso quer dizer que a assinatura reajustada neste mes
//    VOLTA ao valor antigo no mes seguinte, e sem uma frase na tela ninguem liga
//    uma coisa a outra: a pessoa corrige R$ 39,90 para R$ 44,90, ve o numero
//    novo, e em novembro ve R$ 39,90 de volta sem nada ter dado erro.
//
//    `frasePreservadas` nao cobre isto -- ela conta o que a ROTA preservou, e
//    aqui a rota faz exatamente o que foi pedido. A unica que pode dizer e a
//    tela, antes do clique: `avisoDaEdicaoDaPrevisao`.
//
// 4. NAO HA PENEIRA DE `posso_editar` AQUI, e a ausencia e MEDIDA.
//
//    `lib/acoes-da-linha.ts` tem a regra 4 ("sem `posso_editar` nao sai botao")
//    porque a lista de Despesas inclui linha de OUTRO membro do grupo, e UPDATE
//    barrado pela RLS volta 200 sem alterar nada. Este bloco nao tem esse sabor:
//    `GET /api/card-invoices` monta `scheduled_pending` de
//    `scheduled_transactions_effective` com `.eq("user_id", user.id)` ANTES de
//    filtrar por cartao, entao toda previsao que chega aqui e do proprio dono.
//    Repetir a peneira seria uma condicao que nunca e falsa -- e um `&&` que
//    nunca e falso nao tem como ser testado.
//
//    E a mesma ausencia, pelo mesmo motivo medido, da regra 3 de
//    `lib/acoes-da-fatura.ts`.
// -----------------------------------------------------------------------------

import {
  avisoDaExclusao,
  pedidoDeEdicaoDaPrevista,
  pedidoDeExclusao,
  type EdicaoDaPrevista,
  type LinhaAcionavel,
  type PedidoDaAcao,
} from "@/lib/acoes-da-linha";
import type { Alcance } from "@/lib/alcance-na-tela";

/**
 * O que uma acao precisa saber da conta prevista.
 *
 * ESTRUTURAL, e nao `ScheduledTransaction` inteira: assim o caso de teste sao
 * cinco campos em vez de vinte, e a linha de verdade o satisfaz por construcao.
 */
export interface PrevisaoAcionavel {
  id: string;
  description: string;
  amount: number;
  /** `AAAA-MM-DD`. */
  due_date: string;
  /**
   * Preenchido = esta ocorrencia nasceu de um gasto fixo. E o UNICO criterio de
   * "ha serie", aqui e na rota (`planejarExclusao` le o mesmo campo).
   */
  recurring_rule_id?: string | null;
}

/** Os rotulos dos dois botoes. As palavras sao as da fatura, de proposito. */
export const ROTULO_DE_EDITAR_A_PREVISAO = "Editar esta conta prevista";
export const ROTULO_DE_EXCLUIR_A_PREVISAO = "Excluir esta conta prevista";

/**
 * Esta previsao e ocorrencia de uma SERIE? -- regra 1.
 *
 * `Boolean(...)` e nao `!= null`: a coluna e nulavel E o PostgREST pode devolver
 * string vazia num embed degradado, e uma string vazia que passasse daqui
 * abriria o dialogo do alcance sobre uma linha que a rota vai apagar de vez --
 * a pessoa escolheria "todas as ocorrencias" e apagaria uma linha so, sem nada
 * dizendo que as outras duas opcoes eram a mesma.
 */
export function ehSerieDaPrevisao(previsao: PrevisaoAcionavel): boolean {
  return Boolean(previsao.recurring_rule_id);
}

/**
 * A previsao vista como linha de lista, para os pedidos de `acoes-da-linha.ts`.
 *
 * ESTE ADAPTADOR E O PONTO DA REUSA. Sem ele, esta fase reescreveria a URL da
 * exclusao, a validacao dos tres campos e a frase da avulsa -- tres copias que
 * divergiriam da lista de Lancamentos no primeiro conserto, e divergencia de
 * URL de exclusao nao tem sintoma: ela responde 404 ou apaga a coisa errada.
 *
 * Os quatro campos cravados, e por que cada um e verdade AQUI:
 *
 *   * `gravada: true`  -- toda previsao deste bloco veio de
 *     `scheduled_transactions` com `id` de banco. A fatura ABERTA sintetizada
 *     (que e o caso de `gravada: false`) nao entra em `scheduled_pending`;
 *   * `posso_editar: true` -- a regra 4 do cabecalho: a rota filtra `user_id`;
 *   * `origem: "previsto"` -- e o que escolhe o ramo de
 *     `/api/scheduled-transactions/{id}` nos dois pedidos. Um `"realizado"`
 *     aqui mandaria a assinatura para a rota de lancamento, que responderia 404
 *     sobre um id que existe -- em outra tabela;
 *   * `natureza` -- `"fixa"` so quando ha serie. E ela que faz `avisoDaExclusao`
 *     escolher o texto, e e por isso que esta funcao NAO e usada para o aviso da
 *     serie (regra 2).
 *
 * `tipo` e INERTE nos dois caminhos que este modulo usa e vai cravado em
 * `"expense"` por isso: `pedidoDeExclusao` so le `tipo` no ramo `realizado`, e
 * `podeEditar` so o le com `origem === "realizado"`. Deriva-lo de
 * `transaction_type` sugeriria que ele decide algo aqui; cravado com este
 * comentario, o dia em que alguem acrescentar um ramo por `tipo` encontra o
 * aviso em vez de uma mentira plausivel.
 */
export function linhaAcionavelDaPrevisao(
  previsao: PrevisaoAcionavel
): LinhaAcionavel {
  return {
    id: previsao.id,
    gravada: true,
    posso_editar: true,
    origem: "previsto",
    tipo: "expense",
    natureza: ehSerieDaPrevisao(previsao) ? "fixa" : "despesa",
    // `true`, E A ESCOLHA E A MESMA DE `linhaPrevista` -- HMO-452.
    //
    // `include_in_total` (migration 060) e coluna de `financial_transactions`.
    // Uma previsao do cartao e `scheduled_transactions`: a pergunta "esta linha
    // soma nos totais?" nao tem onde ser gravada nela, e ela nao esta em
    // `category_monthly_totals` para comecar -- aquela view le a tabela
    // realizada direto.
    //
    // INERTE AQUI, pelo mesmo motivo de `tipo` acima, e por isso vai cravado:
    // `podeMudarOsTotais` exige `origem === "realizado"`, e este modulo monta
    // so previsao. O valor nao decide nada nos dois caminhos que ele usa
    // (`pedidoDeExclusao` e `podeEditar`). Deriva-lo de alguma coisa sugeriria
    // que ele pesa; cravado com este comentario, quem acrescentar um ramo que o
    // leia encontra o aviso em vez de uma mentira plausivel.
    soma_nos_totais: true,
  };
}

/**
 * O DELETE da conta prevista, no alcance escolhido -- regra 1.
 *
 * O alcance entra por PARAMETRO e nao e decidido aqui: quem o escolhe e a
 * pessoa, no `DialogoDeAlcance`. O que esta funcao garante e que ele chega no
 * CORPO -- a rota le `alcance` de `request.json()` e cai no default
 * `apenas_esta` quando ele nao vem, entao um pedido montado sem corpo escolhe o
 * alcance mais conservador em silencio, exatamente no caso em que a pessoa
 * acabou de pedir "todas".
 *
 * DELEGA a `pedidoDeExclusao` para que a URL tenha UMA definicao no app, e
 * substitui o corpo: aquela funcao crava `apenas_esta` (ver o comentario dela),
 * que e o certo para a lista de Lancamentos -- onde a pergunta nao e feita -- e
 * o errado aqui, onde ela e.
 */
export function pedidoDeExclusaoDaPrevisaoDoCartao(
  previsao: PrevisaoAcionavel,
  alcance: Alcance
): PedidoDaAcao | null {
  const base = pedidoDeExclusao(linhaAcionavelDaPrevisao(previsao));
  if (!base) return null;

  return { ...base, corpo: { alcance } };
}

/**
 * A frase do `confirm()` da conta AVULSA, ou `null` quando ha serie -- regra 2.
 *
 * O `null` E O CONTRATO: ele e o que impede a tela de perguntar duas vezes pela
 * mesma exclusao, e o que a obriga a abrir o dialogo do alcance quando ha serie.
 * Uma frase devolvida aqui para a serie seria o ramo da `fixa` de
 * `avisoDaExclusao`, que manda usar Contas a Pagar -- a tela de onde a HMO-209
 * tirou esta linha.
 */
export function avisoDaExclusaoDaPrevisaoAvulsa(
  previsao: PrevisaoAcionavel
): string | null {
  if (ehSerieDaPrevisao(previsao)) return null;

  return avisoDaExclusao(
    linhaAcionavelDaPrevisao(previsao),
    previsao.description
  );
}

/**
 * `'2026-10-20'` -> `'20/10/2026'`, para o `ancora` do dialogo e para a frase
 * da edicao.
 *
 * A MAO, e nao `Intl.DateTimeFormat`: ha Node sem full-icu que devolve o
 * formato en-US para qualquer locale pedido, e este texto entra em assercao de
 * teste -- a mesma razao de `moeda` em `DialogoDeAlcance` e de `resumoDaSerie`
 * em `lib/lancamento.ts`. E sem `new Date()`: a ISO seria lida como UTC e, no
 * Brasil, voltaria um dia (`data-renderizada-passa-verde-em-utc`).
 *
 * Devolve a propria string quando ela nao e `AAAA-MM-DD`: um `ancora` vazio
 * deixaria o dialogo com "Apenas esta ()" -- o rotulo que deveria identificar a
 * linha identificando nada.
 */
export function ancoraDaPrevisao(due_date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due_date)) return due_date;
  return `${due_date.slice(8, 10)}/${due_date.slice(5, 7)}/${due_date.slice(0, 4)}`;
}

/**
 * O valor como o CAMPO o recebe: `39.9` -> `"39,90"`.
 *
 * ISTO NAO E COSMETICA, E A DIFERENCA E DE 10x. `pedidoDeEdicaoDaPrevista` le o
 * campo com `replace(/\./g, "")` antes do `Number`, porque no Brasil o ponto e
 * separador de MILHAR. Preencher o campo com `String(39.9)` -> `"39.9"` faria
 * aquele `replace` produzir `"399"`: quem abrisse o Editar e clicasse Salvar
 * sem tocar em nada gravaria R$ 399,00 numa assinatura de R$ 39,90 -- e o PATCH
 * responderia 200.
 *
 * `toFixed(2)` e o par exato daquele parser (e o mesmo `paraOCampo` que
 * `ListaDeMovimentacao` usa), e o teste fecha o ciclo: campo -> pedido -> valor.
 */
export function valorNoCampoDaPrevisao(amount: number): string {
  return Number(amount).toFixed(2).replace(".", ",");
}

/** O formulario aberto com os valores de hoje, para a pessoa corrigir um so. */
export function edicaoInicialDaPrevisao(
  previsao: PrevisaoAcionavel
): EdicaoDaPrevista {
  return {
    descricao: previsao.description ?? "",
    valor: valorNoCampoDaPrevisao(previsao.amount),
    vencimento: previsao.due_date,
  };
}

/**
 * O PATCH da conta prevista, ou a recusa com o motivo -- regra 3.
 *
 * DELEGA a `pedidoDeEdicaoDaPrevista`: as tres validacoes que importam (e a
 * conversao de virgula) ja estao la, com teste e com mutante. A pior delas e
 * silenciosa de um jeito que nenhuma guarda de `isNaN` pega -- campo vazio vira
 * `Number("") === 0`, e `amount: 0` e 400 na rota com texto em portugues que
 * esta tela mostraria como "erro do servidor".
 */
export function pedidoDeEdicaoDaPrevisaoDoCartao(
  previsao: PrevisaoAcionavel,
  edicao: EdicaoDaPrevista
): { pedido: PedidoDaAcao } | { erro: string } {
  return pedidoDeEdicaoDaPrevista(linhaAcionavelDaPrevisao(previsao), edicao);
}

/**
 * O que a edicao alcanca, em frase -- regra 3.
 *
 * SEMPRE diz a ocorrencia, porque `apenas_esta` vale para ela so. A segunda
 * frase, so na serie, e a que impede a leitura "corrigi a assinatura": as
 * proximas continuam com o valor de antes, e a correcao parece ter sido desfeita
 * sozinha no mes seguinte.
 *
 * E ela NAO manda ninguem para Contas a Pagar -- a frase que `avisoDaExclusao`
 * usa no ramo da `fixa`. Esta linha nao aparece la (HMO-209), e nao existe hoje,
 * em nenhuma tela do app, caminho para alterar o VALOR da serie inteira de uma
 * previsao apontada para cartao. Prometer um que nao existe seria pior que
 * calar: a pessoa procuraria.
 */
export function avisoDaEdicaoDaPrevisao(previsao: PrevisaoAcionavel): string {
  const base = `Vale só para a ocorrência de ${ancoraDaPrevisao(
    previsao.due_date
  )}.`;

  if (!ehSerieDaPrevisao(previsao)) return base;

  return `${base} Este é um gasto fixo: as próximas ocorrências continuam com o valor de antes.`;
}
