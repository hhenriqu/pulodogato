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

import { chaveFatura, ehFatura } from "@/lib/card-invoice";

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

// =====================================================
// A FATURA ABERTA ENTRA NA AGENDA SEM SER GRAVADA (HMO-227)
// =====================================================
// "Valor total a ser pago no cartao deve aparecer em contas previstas com a data
// de vencimento do cartao para que o usuario informe que pagou o cartao."
//
// O modelo de dados ja existia inteiro: `POST /api/card-invoices/close` cria a
// `scheduled_transactions` com o total, o `invoice_due_date` e a chave canonica,
// o filtro acima deixa JUSTAMENTE essa linha passar, e a baixa dela ja e a
// transferencia de duas pernas da HMO-149. O defeito era de quem CRIA a linha:
// fechar e manual, e o unico botao "Fechar fatura" do app mora em
// /dashboard/budgets. Quem nunca abre Orcamentos nunca ve a fatura em Contas.
//
// -----------------------------------------------------------------------------
// POR QUE SINTETIZAR, E NAO FECHAR SOZINHO
// -----------------------------------------------------------------------------
// Fechar automaticamente quando o `closing_day` passa cria uma linha REAL e
// pagavel pelo caminho que ja existe -- mas ela e uma FOTO. Uma compra lancada
// depois do fechamento, com `transaction_date` dentro do mes fechado, muda o
// total da fatura; a foto congelada em `amount` continua com o numero velho e
// nada na tela diz que ela envelheceu. Consertar isso exigiria um reconciliador
// que reescreva `amount` enquanto o status for `pending` -- mais um escritor
// sobre a tabela de dinheiro, para manter em sincronia um numero que a view
// `card_invoice_lines` ja responde certo a cada leitura.
//
// A sintese nao tem foto: ela e calculada de `card_invoice_lines` em toda
// leitura. Sempre certa, nunca desatualizada, e honesta sobre ser uma PREVISAO.
// O custo e que a linha sintetizada nao tem `id` -- por isso `id: null` no tipo,
// e nao um id inventado: a tela precisa ser INCAPAZ de montar
// `/api/scheduled-transactions/<id>/pay` com ele. Quem informa que pagou
// materializa primeiro (chama `close`) e paga a linha real em seguida: duas
// escritas atras de um botao so.
//
// -----------------------------------------------------------------------------
// NUNCA AS DUAS AO MESMO TEMPO
// -----------------------------------------------------------------------------
// Se a fatura daquele mes+cartao JA foi fechada, a linha persistida e a verdade
// e a sintetizada nao entra. A juncao e a chave canonica -- a mesma que
// `GET /api/card-invoices` usa para saber que a fatura foi fechada. Sem essa
// de-duplicacao a fatura aparece DUAS VEZES em Contas a Pagar, com o mesmo
// valor e o mesmo vencimento, e o cabecalho cobra o dobro. E o modo de falha
// mais caro desta feature, e e o unico que nao da erro em lugar nenhum: as duas
// linhas sao plausiveis uma ao lado da outra.
//
// -----------------------------------------------------------------------------
// A MESMA FUNCAO PURA PARA A LISTA E PARA O RESUMO
// -----------------------------------------------------------------------------
// Pela razao de sempre neste arquivo: `/api/scheduled-transactions` alimenta as
// linhas e `/api/scheduled-transactions/summary` alimenta o cabecalho da MESMA
// pagina. Sintetizar so na lista faz o "a vencer" discordar das linhas logo
// abaixo dele, lado a lado -- e o cabecalho seria o numero MENOR, o que parece
// certo a quem nao somou na mao.
// =====================================================

/**
 * O que a sintese precisa de uma linha de `card_invoice_lines`.
 *
 * `invoice_amount` ja vem com o sinal invertido pela view (a compra soma, o
 * estorno abate), e aceita `string` porque numeric do Postgres chega como
 * string pelo PostgREST em alguns caminhos.
 *
 * `invoice_due_date` e NULL quando o cartao nao tem `due_day` -- e esse caso
 * tem tratamento proprio, ver `FaturaSemVencimento`.
 */
export interface LinhaDeFaturaAberta {
  account_id: string;
  account_name?: string | null;
  /** 'AAAA-MM-01' -- o mes da fatura, decidido por `card_invoice_month()`. */
  invoice_month: string;
  invoice_due_date?: string | null;
  invoice_amount: number | string;
}

/**
 * A fatura ABERTA como ela aparece na agenda. Nunca existiu no banco.
 *
 * `id: null` e load-bearing, nao cosmetico: toda acao da tela de contas
 * previstas (baixa, edicao, pular, comprovante) monta a URL com o `id` da
 * linha. Um id sintetico -- a propria chave canonica, por exemplo -- compilaria
 * e produziria `POST /api/scheduled-transactions/fatura:2026-10-01:<uuid>/pay`,
 * que responde 404 ou, pior, 400 com uma mensagem sobre outra coisa. Com `null`
 * o `tsc` obriga a tela a decidir o que fazer antes de usar o campo.
 */
export interface FaturaPrevista {
  /** SEMPRE null: esta linha e calculada, nao gravada. */
  id: null;
  /** O discriminante da uniao. Sempre `true`. */
  fatura_prevista: true;
  account_id: string;
  account_name: string | null;
  /** 'AAAA-MM-01'. E o que o botao "informei que paguei" manda para o `close`. */
  invoice_month: string;
  description: string;
  amount: number;
  due_date: string;
  status: "pending";
  effective_status: "pending" | "overdue";
  days_until_due: number;
  direction: "expense";
  /** A chave canonica que o `close` vai gravar -- a mesma que de-duplica aqui. */
  notes: string;
  /** Fatura de cartao nao e de grupo: o rateio e das compras, uma a uma. */
  group_id: null;
  recurring_rule_id: null;
}

/**
 * Cartao com fatura aberta e SEM dia de vencimento configurado.
 *
 * Nao vira linha na agenda, e isso e a decisao: sem `due_day` nao existe data de
 * vencimento, e as duas saidas faceis erram. Cair num padrao ("vence dia 10")
 * poria na tela uma data que o banco nao calculou -- a pessoa pagaria no dia
 * errado por causa de um chute do app. Omitir em silencio e o defeito desta
 * issue de volta, so que agora com o app tendo os dados para avisar e nao
 * avisando. Entao a tela diz o que `POST /api/card-invoices/close` ja responde
 * em 400: configure o vencimento do cartao.
 */
export interface FaturaSemVencimento {
  account_id: string;
  account_name: string | null;
  invoice_month: string;
  total: number;
}

/**
 * Esta linha da agenda e a fatura sintetizada?
 *
 * O parametro e estrutural, e NAO `ScheduledTransaction | FaturaPrevista`, de
 * proposito: este arquivo nao importa `@/types/financial`. O `tsconfig` das
 * suites que o compilam tem `rootDir: lib`, e um import para fora dele faz o
 * `tsc` parar com TS6059 -- o tipo seria apagado no JS emitido, mas o
 * compilador reprova antes. Quem precisa da uniao a declara onde a usa.
 */
export function ehFaturaPrevista(linha: object): linha is FaturaPrevista {
  // `object` e nao `{ fatura_prevista?: unknown }`: um tipo-alvo so com
  // propriedade opcional e um WEAK TYPE para o `tsc`, e passar nele uma
  // `ScheduledTransaction` (que nao tem nenhuma propriedade em comum) reprova
  // com TS2345. O cast fica aqui dentro, num lugar so.
  return (linha as { fatura_prevista?: unknown }).fatura_prevista === true;
}

/** Dias entre `hoje` e `due_date`, negativo quando ja venceu. */
function diasAte(dueDate: string, hoje: string): number {
  const MS_DO_DIA = 86_400_000;
  // Datas ISO puras, lidas as duas como UTC: a diferenca entre elas nao tem
  // fuso. Nao usar `new Date()` do relogio local aqui e o que faz o numero ser
  // o mesmo no CI (UTC) e no aparelho (Sao_Paulo).
  return Math.round(
    (Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) /
      MS_DO_DIA
  );
}

/** "Fatura Nubank 10/2026" -- a MESMA descricao que o `close` grava. */
function descricaoDaFatura(
  nome: string | null | undefined,
  mes: string
): string {
  const [ano, mesNum] = mes.split("-");
  // Sem nome legivel a frase fica "Fatura do cartao 10/2026" em vez de
  // "Fatura undefined 10/2026". O nome vem de `financial_accounts` pela view, e
  // falta dele significa leitura incompleta -- nao e hora de inventar um nome.
  return `Fatura ${nome?.trim() || "do cartão"} ${mesNum}/${ano}`;
}

export interface SinteseDaFatura {
  /** As faturas abertas que entram na agenda, ordenadas por vencimento. */
  previstas: FaturaPrevista[];
  /** Os cartoes cuja fatura aberta nao tem vencimento para calcular. */
  semVencimento: FaturaSemVencimento[];
}

/**
 * As faturas ABERTAS de um periodo, a partir das linhas de `card_invoice_lines`.
 *
 * A ordem das peneiras abaixo nao e arbitraria -- cada uma esta onde esta por um
 * motivo que o teste cobra:
 *
 *   1. de-duplicacao PRIMEIRO. Se a fatura foi fechada, aquela linha e a
 *      verdade e nada mais sobre este mes+cartao tem de sair daqui -- nem a
 *      previsao, nem o aviso de vencimento ausente (o `close` exige `due_day`,
 *      entao quem fechou tinha o dia configurado; apagar o dia depois nao
 *      transforma a conta a pagar real num aviso).
 *   2. total <= 0 depois. Fatura zerada nao e conta a pagar, e fatura negativa
 *      e saldo a favor do usuario -- o `close` recusa as duas com 409, e o
 *      `CHECK (amount > 0)` do 005 recusaria a linha de qualquer forma. Uma
 *      previsao de R$ 0,00 na agenda seria ruido mensal em todo cartao que a
 *      pessoa nao usou no mes.
 *   3. vencimento ausente antes da janela, porque sem data nao da para dizer se
 *      ela cai na janela. Vira aviso.
 *   4. janela por ultimo: `de`/`ate` sao os mesmos limites da consulta da
 *      agenda, senao a fatura apareceria em Contas num mes que a tela nao esta
 *      mostrando.
 */
export function sintetizarFaturasAbertas(params: {
  linhas: LinhaDeFaturaAberta[];
  /** As `notes` das previsoes que JA existem no banco. */
  chavesPersistidas: Iterable<string>;
  /** A janela da agenda, 'AAAA-MM-DD'. */
  de: string;
  ate: string;
  /** 'AAAA-MM-DD' -- para "vencida" e para `days_until_due`. */
  hoje: string;
}): SinteseDaFatura {
  const { linhas, chavesPersistidas, de, ate, hoje } = params;
  const persistidas = new Set(chavesPersistidas);

  // Agrupa por cartao+mes. O total e SUM(invoice_amount) -- a mesma soma que
  // `GET /api/card-invoices` e o `close` fazem, pela mesma razao: e a view que
  // decide em que fatura cada compra cai, e refazer a regra aqui seria a
  // segunda fonte de verdade sobre o mes de uma compra.
  const porFatura = new Map<
    string,
    { linha: LinhaDeFaturaAberta; total: number }
  >();

  for (const linha of linhas) {
    if (!linha?.account_id || !linha?.invoice_month) continue;
    const id = `${linha.account_id}|${linha.invoice_month}`;
    const atual = porFatura.get(id);
    const valor = Number(linha.invoice_amount);
    if (!Number.isFinite(valor)) continue;

    if (atual) {
      atual.total += valor;
      // O vencimento e o nome do cartao sao os mesmos em todas as linhas da
      // mesma fatura; manter o primeiro NAO-nulo evita que uma linha sem eles
      // apague o que a anterior trouxe.
      if (!atual.linha.invoice_due_date && linha.invoice_due_date) {
        atual.linha = { ...atual.linha, invoice_due_date: linha.invoice_due_date };
      }
      if (!atual.linha.account_name && linha.account_name) {
        atual.linha = { ...atual.linha, account_name: linha.account_name };
      }
    } else {
      porFatura.set(id, { linha, total: valor });
    }
  }

  const previstas: FaturaPrevista[] = [];
  const semVencimento: FaturaSemVencimento[] = [];

  // Array.from e nao spread/for-of sobre o iterador: o tsconfig deste projeto
  // compila para ES5, onde iterar um Map exige --downlevelIteration.
  for (const { linha, total } of Array.from(porFatura.values())) {
    const mes = linha.invoice_month;
    const chave = chaveFatura(mes, linha.account_id);

    // (1) A fatura ja fechada e uma linha real da agenda. Duas nunca.
    if (persistidas.has(chave)) continue;

    // Centavos antes de qualquer comparacao: a soma de floats produz
    // 0.00000000001, que passaria pelo `<= 0` e viraria uma previsao de
    // R$ 0,00 na tela.
    const valor = Number(total.toFixed(2));

    // (2) Nada a pagar.
    if (valor <= 0) continue;

    const nome = linha.account_name?.trim() || null;

    // (3) Sem `due_day` o banco devolve `invoice_due_date` NULL, e nao ha data
    //     para inventar.
    if (!linha.invoice_due_date) {
      semVencimento.push({
        account_id: linha.account_id,
        account_name: nome,
        invoice_month: mes,
        total: valor,
      });
      continue;
    }

    const vencimento = linha.invoice_due_date;

    // (4) A janela da agenda.
    if (vencimento < de || vencimento > ate) continue;

    previstas.push({
      id: null,
      fatura_prevista: true,
      account_id: linha.account_id,
      account_name: nome,
      invoice_month: mes,
      description: descricaoDaFatura(nome, mes),
      amount: valor,
      due_date: vencimento,
      status: "pending",
      effective_status: vencimento < hoje ? "overdue" : "pending",
      days_until_due: diasAte(vencimento, hoje),
      // Fatura e sempre dinheiro saindo. Nao sai de `direction` da view porque
      // nao ha linha na view -- e `expense` e a mesma direcao que o `close`
      // produz (ele nao manda `transaction_type`, e o COALESCE da 027 termina
      // em 'expense').
      direction: "expense",
      notes: chave,
      group_id: null,
      recurring_rule_id: null,
    });
  }

  previstas.sort((a, b) => a.due_date.localeCompare(b.due_date));
  semVencimento.sort((a, b) => a.invoice_month.localeCompare(b.invoice_month));

  return { previstas, semVencimento };
}

/**
 * A agenda com as faturas abertas no meio, ordenada por vencimento.
 *
 * Existe pelo mesmo motivo que `agendaSemCompraNoCartao`: para a lista e o
 * resumo chamarem a MESMA linha de codigo. Concatenar na mao em cada rota
 * funciona nas duas no dia em que e escrito, e e exatamente assim que o
 * cabecalho e as linhas divergem um mes depois.
 */
export function agendaComFaturasAbertas<T extends { due_date: string }>(
  linhas: T[],
  previstas: FaturaPrevista[]
): (T | FaturaPrevista)[] {
  const juntas: (T | FaturaPrevista)[] = [...linhas, ...previstas];
  juntas.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  return juntas;
}
