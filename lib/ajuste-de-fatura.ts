// ---------------------------------------------------------------------------
// O AJUSTE DE SALDO DA FATURA DO CARTAO (HMO-253)
// ---------------------------------------------------------------------------
// "Possibilidade de lancar um ajuste de saldo para que a fatura fique igual a
// real sem ter que discriminar o que foi o gasto, no caso entra como ajuste
// mesmo negativo ou positivo, essa opcao fica no cartao."
//
// O CASO REAL: a fatura do app fecha em R$ 1.240 e o aplicativo do banco diz
// R$ 1.290. Pode ser uma compra que nunca foi lancada, um IOF, uma anuidade,
// uma diferenca de cambio. Discriminar os R$ 50 custa meia hora de extrato;
// nao discriminar deixa o cartao mentindo para sempre. Falta um lancamento que
// diga "mais R$ 50 que eu nao detalhei" -- e que SOME na fatura.
//
// ===========================================================================
// POR QUE O AJUSTE E UM LANCAMENTO, E NAO UMA COLUNA
// ===========================================================================
// A tentacao obvia e `financial_accounts.ajuste_da_fatura` ou uma tabela
// `card_invoice_adjustments`. As duas estao erradas pelo mesmo motivo: o total
// da fatura NAO e calculado pelo app. Ele e `SUM(invoice_amount)` da view
// `card_invoice_lines` (006), e essa view le `financial_transactions`. Um
// ajuste gravado em qualquer outro lugar nao mudaria o total em lugar nenhum --
// nem na tela do cartao, nem no painel, nem no fechamento da fatura em conta a
// pagar -- a nao ser que CADA leitor passasse a somar a parte dele. Seria um
// dado gravado sem leitor, que e o pior lugar para um dado estar, e o sintoma
// seria "eu ajustei e a fatura nao mudou".
//
// Entao o ajuste e uma linha de `financial_transactions` na conta do cartao.
// Com isso ele entra de graca em tudo: no total da fatura, no saldo do cartao
// (pelo trigger `update_account_balance`), no fluxo de caixa e no fechamento.
//
// ===========================================================================
// O SINAL: O QUE O USUARIO DIZ E O QUE O BANCO GUARDA
// ===========================================================================
// Sao DUAS convencoes opostas no mesmo numero, e confundi-las inverte o ajuste:
//
//   `valorNaFatura`  o que o usuario quer ver somado NA FATURA.
//                    POSITIVO aumenta o que se deve, negativo abate.
//
//   `amount`         o que vai na coluna de `financial_transactions`.
//                    Despesa e gravada NEGATIVA neste app.
//
// A view faz `(-t.amount) AS invoice_amount`, logo:
//
//       amount = -valorNaFatura
//
// Ajuste de +R$ 50 (a fatura real e MAIOR) vira `amount = -50`, despesa, e a
// fatura sobe 50. Ajuste de -R$ 50 vira `amount = +50`, receita na conta do
// cartao -- o mesmo formato de um estorno, que e exatamente o que ele e.
//
// `transaction_type` nao e decoracao: `card_invoice_lines` filtra
// `transaction_type IN ('expense','income')` e as tres views da 008 descartam
// a linha de tipo NULO (HMO-181). Um ajuste gravado sem tipo apareceria na
// lista de lancamentos e sumiria da fatura -- o defeito exato que esta funcao
// nao pode cometer.
//
// ===========================================================================
// A DATA: POR QUE DIA 1 DO MES DA FATURA
// ===========================================================================
// O usuario escolhe o MES da fatura ("quero que outubro feche em R$ 1.290"),
// nao um dia. Mas a view decide o mes da linha por
// `card_invoice_month(transaction_date, closing_day)`, que e a FONTE UNICA
// dessa regra -- reimplementa-la aqui criaria duas respostas para a mesma
// pergunta, e a divergencia apareceria como "ajustei outubro e mudou
// novembro".
//
// O que esta funcao faz em vez disso e escolher uma data que a regra do banco
// mapeia para o mes pedido SEJA QUAL FOR o `closing_day`, e isso e o dia 1:
//
//   - `closing_day IS NULL`  -> a linha e da fatura do proprio mes. Dia 1 e do
//                               mes pedido. OK.
//   - `closing_day` 1..31    -> a linha e do proprio mes quando
//                               `dia <= LEAST(closing_day, ultimo dia do mes)`.
//                               O CHECK `financial_accounts_closing_day_check`
//                               garante `closing_day >= 1`, e todo mes tem dia
//                               1, entao `1 <= LEAST(...)` e sempre verdade.
//
// Dia 1 e, nao por acaso, a mesma convencao das parcelas futuras no cartao
// (035): `transaction_date` ali tambem e o primeiro dia do mes da fatura, e
// nao um dia que alguem digitou. A prova de que o mapeamento acontece de fato
// esta em `database/tests/ajuste_de_fatura_test.sql`, que insere o ajuste e le
// a view com closing_day 1, 15, 28, 31 e NULL, inclusive em fevereiro -- uma
// afirmacao de TypeScript sobre a aritmetica do Postgres provaria so que eu
// repeti a mesma conta duas vezes.
//
// ===========================================================================
// UM AJUSTE POR CARTAO POR MES
// ===========================================================================
// A chave canonica em `notes` (o mesmo desenho de `chaveFatura`, em
// lib/card-invoice.ts) torna o POST uma troca de valor, e nao um acumulo.
// Clicar "Salvar" duas vezes com R$ 50 deixa a fatura 50 maior, nao 100 --
// porque o segundo pedido ENCONTRA a linha do primeiro e a reescreve.
//
// Um ajuste por mes tambem e o modelo mental certo: a pergunta que o usuario
// responde ("quanto falta para fechar igual ao banco?") tem UMA resposta por
// fatura. Varios ajustes somando as cegas seriam a volta do problema que esta
// issue conserta.
// ---------------------------------------------------------------------------

import type { CardInvoice, CardInvoiceLine } from "@/types/financial";

/**
 * O nome da categoria reservada do ajuste.
 *
 * Ela e criada SOB DEMANDA, por usuario (`transaction_categories.user_id`,
 * migration 036), e nasce `is_active = FALSE`:
 *
 *   - a policy `transaction_categories_read_own` (036) nao filtra `is_active`,
 *     entao o dono le a propria linha reservada;
 *   - `GET /api/personal-finance/categories` filtra `is_active = true` no
 *     proprio SELECT, entao ela nao aparece em seletor nenhum nem na tela de
 *     gerenciar categorias.
 *
 * POR QUE NAO UMA CATEGORIA DE CATALOGO, como a 023 fez para a transferencia:
 * aquela precisou de migration porque `transaction_categories` nao tinha
 * `user_id` e a tabela e global -- escrever nela escreve para todo mundo. A 036
 * acrescentou `user_id` e a policy de INSERT para `user_id = auth.uid()`, e com
 * isso a mesma necessidade se resolve sem passo humano no SQL Editor. Uma
 * migration aqui so atrasaria a feature.
 */
export const NOME_DA_CATEGORIA_DE_AJUSTE = "Ajuste de fatura";

/** A descricao da categoria reservada, para quem a encontrar no banco. */
export const DESCRICAO_DA_CATEGORIA_DE_AJUSTE =
  "Reservada para o ajuste de saldo da fatura do cartão. Não aparece nos seletores.";

/** Prefixo da chave canonica que o ajuste grava em `financial_transactions.notes`. */
export const PREFIXO_CHAVE_AJUSTE = "ajuste-de-fatura:";

/**
 * A chave canonica do ajuste daquele mes naquele cartao.
 *
 * E ela que faz o POST trocar o valor em vez de empilhar ajustes.
 *
 * @param mes 'YYYY-MM-01' -- o primeiro dia do mes da fatura
 */
export function chaveAjuste(mes: string, accountId: string): string {
  return `${PREFIXO_CHAVE_AJUSTE}${mes}:${accountId}`;
}

// Ancorada nas duas pontas, pelo mesmo motivo de `RE_CHAVE_FATURA`: sem o `$`,
// uma nota escrita a mao como "ajuste-de-fatura:2026-10-01:xxx conferi no app"
// passaria por chave canonica, e a descricao livre do usuario viraria regra de
// negocio.
const RE_CHAVE_AJUSTE =
  /^ajuste-de-fatura:(\d{4}-\d{2}-\d{2}):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

/** O mes e o cartao de uma chave de ajuste, ou `null` se `notes` nao for uma. */
export function ajusteDaChave(
  notes: string | null | undefined
): { mes: string; accountId: string } | null {
  if (!notes) return null;
  const casou = RE_CHAVE_AJUSTE.exec(notes);
  if (!casou) return null;
  return { mes: casou[1], accountId: casou[2] };
}

/** Este lancamento e um ajuste de fatura? */
export function ehAjusteDeFatura(notes: string | null | undefined): boolean {
  return ajusteDaChave(notes) !== null;
}

// ---------------------------------------------------------------------------
// O MES E A DATA
// ---------------------------------------------------------------------------

/**
 * 'AAAA-MM' ou 'AAAA-MM-01' -> 'AAAA-MM-01'. `null` para o que nao da para ler.
 *
 * Sem `new Date()` em nenhum ponto: a ISO seria lida como UTC e, no fuso de Sao
 * Paulo, '2026-10-01' voltaria para 30/09 -- o ajuste de outubro gravado em
 * setembro, somando na fatura do mes anterior. Mesma pegadinha de
 * `rotuloDaFatura`.
 */
export function primeiroDiaDoMesDaFatura(
  mes: string | null | undefined
): string | null {
  if (!mes || !/^\d{4}-\d{2}(-\d{2})?$/.test(mes)) return null;

  const numeroDoMes = Number(mes.slice(5, 7));
  if (numeroDoMes < 1 || numeroDoMes > 12) return null;

  return `${mes.slice(0, 7)}-01`;
}

// ---------------------------------------------------------------------------
// O VALOR QUE O USUARIO DIGITOU
// ---------------------------------------------------------------------------

/** Para que lado o ajuste empurra a fatura. */
export type DirecaoDoAjuste = "aumenta" | "abate";

/**
 * O limite de um ajuste, em unidades da moeda.
 *
 * Existe porque `numeric(15,2)` estoura em 10^13 e um estouro de coluna volta
 * como 500 sem explicacao. O teto aqui recusa com mensagem, antes do banco.
 */
export const TETO_DO_AJUSTE = 1_000_000_000;

// A `validarAjuste({ valor, direcao })` QUE MORAVA AQUI FOI APAGADA na 2a volta
// da HMO-253, e nao aposentada. Ela validava "o valor digitado + o lado
// escolhido" -- os dois controles que sairam da tela quando o ajuste passou a
// ser automatico. Depois disso ela nao tinha mais chamador nenhum em producao:
// so os proprios testes.
//
// Mante-la exportada custaria mais que o espaco. Uma funcao sem chamador com
// suite verde atras dela e um placar que mede codigo que nao embarca -- e os
// limites (zero, teto, centavos) ficariam escritos DUAS vezes, uma no caminho
// vivo e outra no morto, livres para divergir sem nada ficar vermelho. Quem
// concentra os limites agora e `ajusteParaFecharEm`, que e por onde o ajuste
// passa de fato; e a conversao de reais para centavos e `centavosDe`, uma so.
//
// ===========================================================================
// O AJUSTE AUTOMATICO: O USUARIO DIZ QUANTO O CARTAO DIZ (HMO-253, 2a volta)
// ===========================================================================
// "Sobre o ajuste de saldo, deve ser automatico. Eu lanco o valor real que esta
// hoje meu cartao e um metodo verifica se e menor ou maior que a fatura, e
// lanca a diferenca somando ou subtraindo."
//
// O que o usuario tem em maos e o numero do aplicativo do banco -- R$ 1.290.
// Pedir a DIFERENCA (R$ 50) e pedir uma subtracao que ele nao precisa fazer, e
// que ele pode fazer errada: digitar 50 olhando para um total que mudou desde
// que a tela carregou deixa a fatura em 1.330 sem nenhum erro aparecer.
//
// ENTAO A DIFERENCA E DERIVADA, E A DIRECAO TAMBEM:
//
//     valorNaFatura = saldoReal - totalSemAjuste
//
// positivo acrescenta, negativo abate, zero nao lanca nada.
//
// AS QUATRO COISAS QUE ESTA CONTA NAO PODE FAZER
// ----------------------------------------------
//   1. SUBTRAIR EM PONTO FLUTUANTE. `1290 - 1240.10` em `number` da
//      `49.899999999999995`, e `numeric(15,2)` arredonda isso para 49.90 -- a
//      fatura fecharia em 1.290,00 por sorte, e um centavo fora no caso
//      seguinte. Pior: `0.1 + 0.2 - 0.3` nao e zero, entao "o cartao bate
//      exato" viraria um ajuste de R$ 0,00 gravado na fatura. TODA a aritmetica
//      aqui e em CENTAVOS INTEIROS, e so o resultado volta para reais.
//
//   2. LER CAMPO VAZIO COMO ZERO. `Number("")` e `0` em JavaScript, e um saldo
//      real de R$ 0,00 e uma afirmacao legitima ("meu cartao esta zerado"), que
//      gera um ajuste de -1.240. Confundir "nao digitou" com "digitou zero"
//      portanto nao da um ajuste vazio: da um estorno do valor da fatura
//      INTEIRA, com a tela mostrando a conta certa para o numero errado.
//
//   3. INVENTAR O TOTAL DA FATURA. `totalSemAjuste` e o outro operando, e se ele
//      nao deu para ler (offline, RLS, erro da view) nao existe diferenca
//      nenhuma a calcular. Um `?? 0` ali transformaria "nao sei quanto e a
//      fatura" em "a fatura e zero", e o ajuste gravado seria o saldo real
//      inteiro -- dobrando a fatura na hora em que a leitura voltasse.
//
//   4. CONFUNDIR "A FATURA JA BATE" COM "NAO DA PARA AJUSTAR". Sao duas
//      respostas boas e diferentes: a primeira e `fecha: true`, e o que ela
//      pede e que o ajuste que estiver gravado seja REMOVIDO (um ajuste velho
//      de +50 que agora sobra e exatamente o que faz a fatura parar de bater).
//      A segunda e `ok: false`. Uma so palavra para as duas deixaria o usuario
//      que digitou o numero certo procurando o que ele errou.
// ===========================================================================

/**
 * Reais -> centavos INTEIROS. `null` para o que nao e numero utilizavel.
 *
 * `""` e `null` dao `null`, e nao `0`: ver a armadilha 2 do bloco acima. E o
 * `Math.round` e obrigatorio -- `12.9 * 100` e `1290.0000000000002`, e um
 * `Math.trunc` ali devolveria 1289, perdendo um centavo em um valor que o
 * usuario digitou exato.
 */
export function centavosDe(valor: unknown): number | null {
  const numero =
    typeof valor === "number"
      ? valor
      : typeof valor === "string" && valor.trim() !== ""
        ? Number(valor)
        : Number.NaN;

  if (!Number.isFinite(numero)) return null;
  return Math.round(numero * 100);
}

export type AjusteAutomatico =
  /** A fatura ja fecha no valor informado. Nao ha diferenca a lancar. */
  | { ok: true; fecha: true; valorNaFatura: 0 }
  /** Ha diferenca: `valorNaFatura` positivo acrescenta, negativo abate. */
  | { ok: true; fecha: false; valorNaFatura: number }
  | { ok: false; erro: string };

/**
 * O saldo real informado + o total da fatura -> o ajuste que faz os dois baterem.
 *
 * O `totalSemAjuste` E O TOTAL SEM AJUSTE NENHUM, e nao o total que esta na
 * tela. A diferenca aparece no segundo ajuste do mesmo mes: a fatura mostra
 * R$ 1.290 porque ja tem um ajuste de +50 em cima de R$ 1.240 de compras. Se o
 * banco agora diz R$ 1.300, o ajuste correto e +60 (ele SUBSTITUI o de 50, pela
 * chave canonica em `notes`), e nao +10. Calcular sobre o total da tela
 * acumularia os dois e a fatura fecharia em 1.350 -- com a previa da tela
 * concordando com a conta errada, porque seria a mesma conta.
 */
export function ajusteParaFecharEm(params: {
  saldoReal: unknown;
  totalSemAjuste: unknown;
}): AjusteAutomatico {
  const centavosDoSaldo = centavosDe(params.saldoReal);
  if (centavosDoSaldo === null) {
    return { ok: false, erro: "Informe quanto o cartão diz hoje" };
  }

  // Armadilha 3: sem o total da fatura nao ha subtracao possivel, e a recusa
  // aqui e o que impede o ajuste de virar "o saldo real inteiro".
  const centavosDaFatura = centavosDe(params.totalSemAjuste);
  if (centavosDaFatura === null) {
    return {
      ok: false,
      erro: "Não foi possível ler o total desta fatura para comparar",
    };
  }

  // O teto vale para o que foi DIGITADO e tambem para a diferenca: um saldo real
  // dentro do limite subtraido de uma fatura negativa pode estourar a coluna.
  if (Math.abs(centavosDoSaldo) >= TETO_DO_AJUSTE * 100) {
    return { ok: false, erro: "O valor informado é alto demais" };
  }

  const diferenca = centavosDoSaldo - centavosDaFatura;

  // Armadilha 4: zero e uma resposta BOA, com nome proprio.
  if (diferenca === 0) return { ok: true, fecha: true, valorNaFatura: 0 };

  if (Math.abs(diferenca) >= TETO_DO_AJUSTE * 100) {
    return { ok: false, erro: "A diferença é alta demais para um ajuste" };
  }

  return { ok: true, fecha: false, valorNaFatura: diferenca / 100 };
}

/**
 * O total da fatura SEM ajuste nenhum, em centavos, a partir das linhas da view.
 *
 * E a base de `ajusteParaFecharEm` do lado do SERVIDOR -- a rota nao aceita o
 * total que a tela mostra, porque a tela pode estar velha (ver o cabecalho de
 * `/api/card-invoices/ajuste`). Mora aqui, e nao na rota, porque as duas
 * armadilhas dela sao aritmetica pura e nenhuma levanta erro:
 *
 *   O SINAL. `amountDoAjuste` e a COLUNA CRUA de `financial_transactions`, e a
 *   view publica `(-t.amount) AS invoice_amount`. A contribuicao do ajuste para
 *   o total e portanto `-amount`, e tira-la do total e `total - (-amount)`, isto
 *   e, SOMAR o amount. Subtrair aqui erraria a base pelo DOBRO do ajuste
 *   existente, e o sintoma seria o segundo ajuste do mes sempre vir com o dobro
 *   da diferenca -- plausivel, e so no segundo ajuste.
 *
 *   O RESIDUO. Trinta linhas de `numeric(15,2)` somadas em ponto flutuante
 *   acumulam residuo, e o residuo cai exatamente no teste de "a fatura ja bate".
 *   A soma e em centavos inteiros.
 *
 * `null` quando QUALQUER linha veio ilegivel: pula-la deixaria a fatura menor do
 * que ela e, e o ajuste calculado em cima disso acrescentaria o valor da linha
 * pulada -- a fatura fechando no numero do banco por um lancamento duplicado,
 * que e a doenca que esta feature trata. `null` tambem e diferente de ZERO:
 * fatura sem linha nenhuma soma 0 e ajustar isso e legitimo.
 *
 * @param amountDoAjuste `null`/`undefined` significa "nao ha ajuste gravado".
 */
export function centavosDaFaturaSemAjuste(params: {
  invoiceAmounts: readonly unknown[];
  amountDoAjuste: unknown;
}): number | null {
  let centavos = 0;
  for (const bruto of params.invoiceAmounts) {
    const daLinha = centavosDe(bruto);
    if (daLinha === null) return null;
    centavos += daLinha;
  }

  if (params.amountDoAjuste === null || params.amountDoAjuste === undefined) {
    return centavos;
  }

  const doAjuste = centavosDe(params.amountDoAjuste);
  if (doAjuste === null) return null;

  // SOMA, e nao subtrai. Ver "O SINAL" acima.
  return centavos + doAjuste;
}

/**
 * Para que lado uma diferenca ja calculada empurra a fatura.
 *
 * Zero cai em "abate" e isso nunca acontece de proposito -- `ajusteParaFecharEm`
 * devolve `fecha: true` nesse caso e nao chega aqui. O par
 * `>= 0 ? "aumenta" : "abate"` de `direcaoDoAjuste` nao serve: ali o zero vem de
 * um ajuste GRAVADO (que nunca e zero, `lancamentoDoAjuste` recusa) e aqui viria de
 * uma diferenca nula, que e o caso em que nao ha direcao nenhuma a nomear.
 */
export function direcaoDaDiferenca(valorNaFatura: number): DirecaoDoAjuste {
  return valorNaFatura > 0 ? "aumenta" : "abate";
}

// ---------------------------------------------------------------------------
// O LANCAMENTO QUE VAI PARA O BANCO
// ---------------------------------------------------------------------------

/** As colunas de `financial_transactions` que o ajuste decide. */
export interface LancamentoDoAjuste {
  /** O valor na coluna: `-valorNaFatura`. Despesa e negativa neste app. */
  amount: number;
  /** 'expense' quando o ajuste aumenta a fatura, 'income' quando abate. */
  transaction_type: "expense" | "income";
  /** Primeiro dia do mes da fatura -- ver o cabecalho. */
  transaction_date: string;
  description: string;
  /** A chave canonica. E ela que faz o proximo POST trocar em vez de somar. */
  notes: string;
}

/**
 * A descricao padrao, quando o usuario nao escreve uma.
 *
 * Ela diz o que a linha E, porque e isso que vai aparecer na fatura, na lista
 * de lancamentos e no relatorio. Uma linha de R$ 50 chamada "Ajuste" sem mais
 * nada, tres meses depois, e indistinguivel de uma compra esquecida.
 */
export function descricaoPadraoDoAjuste(valorNaFatura: number): string {
  return valorNaFatura >= 0
    ? "Ajuste de saldo da fatura (acréscimo)"
    : "Ajuste de saldo da fatura (abatimento)";
}

/**
 * O lancamento do ajuste, ou `null` quando o mes nao da para ler.
 *
 * `null` em vez de um fallback para o mes corrente: gravar dinheiro num mes que
 * o usuario nao escolheu e o tipo de erro que ninguem encontra -- o valor esta
 * certo, a fatura do mes errado fecha, e as duas parecem plausiveis.
 */
export function lancamentoDoAjuste(params: {
  valorNaFatura: number;
  mes: string;
  accountId: string;
  descricao?: string | null;
}): LancamentoDoAjuste | null {
  const primeiroDia = primeiroDiaDoMesDaFatura(params.mes);
  if (!primeiroDia || !params.accountId) return null;
  if (!Number.isFinite(params.valorNaFatura) || params.valorNaFatura === 0) {
    return null;
  }

  const descricao = (params.descricao ?? "").trim();

  return {
    // A INVERSAO. Ver "O SINAL" no cabecalho: a view publica
    // `(-t.amount) AS invoice_amount`, entao gravar `valorNaFatura` cru faria o
    // acrescimo ABATER da fatura e o abatimento somar -- com o numero certo, o
    // sinal certo na tela de lancamentos, e a fatura andando para o lado
    // errado.
    amount: -params.valorNaFatura,
    transaction_type: params.valorNaFatura > 0 ? "expense" : "income",
    transaction_date: primeiroDia,
    description: descricao || descricaoPadraoDoAjuste(params.valorNaFatura),
    notes: chaveAjuste(primeiroDia, params.accountId),
  };
}

// ---------------------------------------------------------------------------
// ACHAR O AJUSTE NA FATURA QUE A ROTA DEVOLVEU
// ---------------------------------------------------------------------------
// A tela nao tem `notes`: `card_invoice_lines` nao publica essa coluna (ver a
// 035). O que ela publica e `category_id`, e e por ele que a linha do ajuste e
// reconhecida -- `GET /api/card-invoices` devolve
// `adjustment_category_id` no topo da resposta, que e a categoria reservada
// DAQUELE usuario.
//
// `undefined` E DIFERENTE DE `null`, e a diferenca nao e estilo:
//
//   `undefined` -> a consulta da categoria reservada falhou. A tela nao sabe
//                  se existe ajuste, e nao pode dizer que nao existe.
//   `null`      -> a consulta foi bem e o usuario nunca ajustou fatura
//                  nenhuma. Nao existe ajuste, com certeza.
//
// Sem essa distincao, a tela ofereceria "Ajustar saldo" sobre uma fatura que ja
// tem ajuste, dizendo por omissao que ela nao tem -- e o usuario somaria o
// mesmo R$ 50 de novo achando que estava criando o primeiro. (O POST nao
// duplicaria, porque a chave canonica em `notes` reescreve a linha; mas a tela
// teria mentido.)

/** A categoria reservada do ajuste, como a resposta da rota a entrega. */
export type CategoriaDeAjuste = string | null | undefined;

/** Da para afirmar algo sobre o ajuste desta fatura? */
export function podeConferirAjuste(categoria: CategoriaDeAjuste): boolean {
  return categoria !== undefined;
}

/**
 * A linha de ajuste desta fatura, ou `null` quando nao ha (ou nao da para
 * conferir -- use `podeConferirAjuste` para distinguir).
 *
 * O filtro por `account_id` repete o que a rota ja fez, pelo mesmo motivo de
 * `gastosDaFatura`: e a afirmacao da tela, e nao custa nada.
 */
export function ajusteDaFatura(
  fatura: CardInvoice | null | undefined,
  accountId: string,
  categoria: CategoriaDeAjuste
): CardInvoiceLine | null {
  if (!fatura || !accountId || !categoria) return null;
  return (
    (fatura.lines ?? []).find(
      (linha) =>
        linha.account_id === accountId && linha.category_id === categoria
    ) ?? null
  );
}

/**
 * Esta linha da lista e o ajuste?
 *
 * O AJUSTE CONTINUA NA LISTA, e isso e deliberado. Tira-lo dali deixaria a
 * soma das linhas visiveis diferente do total impresso em cima delas -- tres
 * compras somando R$ 1.240 embaixo de um total de R$ 1.290, as duas corretas, e
 * nada na tela explicando a diferenca. Duas fontes que nao fecham sao piores
 * que uma linha a mais.
 *
 * O que a linha precisa e de ROTULO: um ajuste de R$ 50 sem nada que o
 * identifique e indistinguivel de uma compra de R$ 50 tres meses depois -- e
 * "sumido da tela" e "indistinguivel do vizinho" dao o mesmo prejuizo.
 */
export function ehLinhaDeAjuste(
  linha: CardInvoiceLine,
  categoria: CategoriaDeAjuste
): boolean {
  return Boolean(categoria) && linha.category_id === categoria;
}

/**
 * O total da fatura ANTES do ajuste.
 *
 * E o numero que o bloco do ajuste precisa mostrar ("as compras somam X, o
 * ajuste poe Y, a fatura fecha em Z"): sem ele a pessoa ve o total ja ajustado
 * e nao tem como saber se o ajuste que ela gravou e o que esta valendo.
 *
 * Subtrai `invoice_amount` do ajuste de `fatura.total` em vez de somar as
 * linhas de novo -- `total` e o que a rota publicou, e recalcular aqui criaria
 * uma segunda resposta para o total da mesma fatura.
 */
export function totalSemOAjuste(
  fatura: CardInvoice | null | undefined,
  ajuste: CardInvoiceLine | null
): number {
  const total = Number(fatura?.total ?? 0);
  if (!ajuste) return total;
  return total - Number(ajuste.invoice_amount);
}

/**
 * O valor do ajuste COMO A FATURA O VE (positivo aumenta).
 *
 * `invoice_amount`, nao `amount`: a linha vem da view ja com o sinal invertido,
 * e ler `amount` aqui mostraria "- R$ 50,00" para um ajuste que acrescenta 50.
 */
export function valorDoAjusteNaFatura(ajuste: CardInvoiceLine): number {
  return Number(ajuste.invoice_amount);
}

/** A direcao de um ajuste que ja existe, para o formulario reabrir igual. */
export function direcaoDoAjuste(ajuste: CardInvoiceLine): DirecaoDoAjuste {
  return valorDoAjusteNaFatura(ajuste) >= 0 ? "aumenta" : "abate";
}

/**
 * Onde a fatura fecha se este ajuste for gravado.
 *
 * O `semAjuste` e o total SEM ajuste nenhum, e nao o total da tela: a tela
 * mostra o total COM o ajuste que ja existe, e somar o novo em cima dele
 * acumularia os dois -- a conta da previa discordando do que o POST faz, que e
 * o jeito mais rapido de perder a confianca do usuario no numero.
 */
export function totalComOAjuste(
  semAjuste: number,
  valorNaFatura: number
): number {
  return Number(semAjuste) + Number(valorNaFatura);
}
