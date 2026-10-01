// =====================================================
// O QUE DE UM CARTAO APARECE EM CONTAS A PAGAR (HMO-209)
// =====================================================
// Por que este arquivo existe: Contas a Pagar mostrava a compra individual no
// cartao AO LADO da fatura cheia daquele mesmo cartao. A mesma despesa duas
// vezes na mesma tela -- uma solta, outra dentro da fatura --, e o total da
// pagina somava as duas.
//
// O caminho que produzia aquilo: a tela de lancamento oferecia "Ja paguei" no
// gasto no cartao, e desmarcada ela gravava a compra em
// `scheduled_transactions` com o `account_id` do cartao.
// `GET /api/scheduled-transactions` nao olha o tipo da conta, entao a linha
// entrava na agenda como se fosse uma conta a pagar qualquer.
//
// A fonte foi fechada em `lib/lancamento.ts` (o gasto no cartao nao tem mais
// checkbox, e `destinoDoLancamento` nao consegue manda-lo para a agenda). Isto
// aqui e a outra metade: as linhas que JA ESTAO no banco, e qualquer outro
// caminho que grave uma previsao apontada para um cartao.
//
// -----------------------------------------------------------------------------
// A EXCECAO SAI DA CHAVE CANONICA, NAO DO TIPO DA CONTA
// -----------------------------------------------------------------------------
// A fatura fechada TAMBEM e uma `scheduled_transaction` com o `account_id` do
// cartao -- e precisa continuar aparecendo, porque e ela que a pessoa paga. O
// tipo da conta nao distingue uma da outra: as duas sao `credit_card`. Quem
// distingue e a chave `fatura:AAAA-MM-01:<uuid>` que
// `POST /api/card-invoices/close` grava em `notes`, lida aqui por `ehFatura`.
//
// E a mesma decisao que `lib/card-invoice.ts` ja documenta para a BAIXA, pela
// mesma razao: ali, olhar so o `account_type` transformaria toda assinatura
// cobrada no cartao em transferencia e faria a despesa desaparecer do fluxo de
// caixa. Aqui, olhar so o `account_type` esconderia a propria fatura -- a unica
// linha de cartao que tem de ficar.
//
// -----------------------------------------------------------------------------
// O QUE ISTO ESCONDE, E DE PROPOSITO
// -----------------------------------------------------------------------------
// Toda previsao apontada para um cartao que NAO seja fatura sai da agenda,
// inclusive a assinatura que alguem cadastrou com o cartao como conta. Nada e
// apagado: aquelas linhas continuam na tabela e passam a aparecer na tela do
// cartao, junto das compras daquela fatura (HMO-208, fase 3). A alternativa --
// manter a compra na agenda para nao "perder" a assinatura -- e o defeito desta
// issue, e ele erra dinheiro: o "quanto ainda vai sair" do mes soma a compra e
// a fatura que ja a contem.
//
// -----------------------------------------------------------------------------
// FILTRAR AQUI, NAO NA TELA
// -----------------------------------------------------------------------------
// `/api/scheduled-transactions` alimenta a lista e
// `/api/scheduled-transactions/summary` alimenta o cabecalho ("custo fixo", "a
// vencer") da MESMA pagina. Filtrar so na lista faria as linhas e o total
// discordarem lado a lado -- e o total seria o numero errado, porque e o que
// parece certo. Por isso a regra e uma funcao pura, usada pelas duas rotas.
// =====================================================

import { ehFatura } from "@/lib/card-invoice";

/**
 * O valor de `financial_accounts.account_type` que significa cartao de credito.
 *
 * Literal repetido em varios lugares do projeto; nomeado aqui porque a regra
 * abaixo inteira depende dele. Um typo (`credit-card`) nao daria erro nenhum:
 * nenhuma linha casaria, o filtro passaria a nao filtrar nada, e a tela voltaria
 * ao estado desta issue sem uma mensagem em lugar algum.
 */
export const TIPO_CARTAO = "credit_card";

/** A conta como o embed do PostgREST a entrega, nas duas formas possiveis. */
type ContaDoEmbed = { account_type?: string | null };

/**
 * O que a regra precisa saber sobre uma linha da agenda.
 *
 * `account` e o embed do PostgREST (`account:financial_accounts(...)`), que vem
 * `null` quando a previsao nao tem conta -- e tambem quando a RLS nao deixa ler
 * aquela conta.
 *
 * O TIPO ACEITA OBJETO E ARRAY, e isso nao e frouxidao (HMO-209). A fonte das
 * duas rotas e a VIEW `scheduled_transactions_effective`, e o PostgREST decide a
 * forma do embed pela relacao que ele consegue inferir: muitos-para-um devolve
 * objeto, e e isso que acontece aqui (`account_id` -> `financial_accounts.id`).
 * Mas sobre uma view o supabase-js nao consegue provar isso na inferencia e
 * TIPA como array -- foi o `tsc` deste PR que mostrou. Se a inferencia dele
 * estiver certa em algum caminho, `linha.account.account_type` seria `undefined`
 * em TODA linha, nenhuma casaria com `credit_card`, o filtro passaria a nao
 * filtrar nada e a tela voltaria ao defeito desta issue -- sem erro, sem log,
 * sem teste vermelho. Aceitar as duas formas custa quatro linhas e fecha o unico
 * modo de falha silencioso que sobrou aqui.
 */
export interface PrevisaoComConta {
  notes?: string | null;
  account?: ContaDoEmbed | ContaDoEmbed[] | null;
}

/** A conta da linha, seja o embed objeto ou array de um. */
function contaDaLinha(account: PrevisaoComConta["account"]): ContaDoEmbed | null {
  if (!account) return null;
  if (Array.isArray(account)) return account[0] ?? null;
  return account;
}

/**
 * Esta previsao aparece em Contas a Pagar?
 *
 * `true` para tudo que nao e cartao, e para a fatura do cartao. `false` so para
 * a linha de cartao que nao e fatura -- a compra individual.
 *
 * SEM CONTA (ou sem conseguir ler a conta) A LINHA APARECE. Nao e descuido, e a
 * direcao em que o erro e barato: uma previsao sem `account_id` e uma conta a
 * pagar comum, e um embed `null` por RLS significa "nao sei", nao "e cartao".
 * Esconder no "nao sei" faria uma conta legitima desaparecer da agenda sem
 * nenhum erro na tela -- o modo de falha caro, porque a pessoa so descobre no
 * dia em que a conta vence.
 */
export function previsaoApareceNaAgenda(linha: PrevisaoComConta): boolean {
  if (contaDaLinha(linha.account)?.account_type !== TIPO_CARTAO) return true;
  return ehFatura(linha.notes);
}

/**
 * A agenda sem as compras de cartao.
 *
 * Existe para que as duas rotas chamem a MESMA linha de codigo. Repetir o
 * `.filter(...)` em cada uma foi considerado e e exatamente o jeito de a lista e
 * o resumo divergirem depois -- o segundo lugar e o que ninguem atualiza.
 */
export function agendaSemCompraNoCartao<T extends PrevisaoComConta>(
  linhas: T[]
): T[] {
  return linhas.filter(previsaoApareceNaAgenda);
}
