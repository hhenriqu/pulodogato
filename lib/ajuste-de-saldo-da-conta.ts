// ---------------------------------------------------------------------------
// O AJUSTE DE SALDO DA CONTA (HMO-409)
// ---------------------------------------------------------------------------
// "Ajuste de saldo tambem para contas, nao so para cartao."
//
// O CASO REAL e o mesmo da HMO-253 com outro numero em cima: o app diz que a
// conta corrente tem R$ 2.430,00 e o aplicativo do banco diz R$ 2.380,00.
// Pode ser uma tarifa, um lancamento esquecido, um rendimento da poupanca.
// Discriminar os R$ 50 custa meia hora de extrato; nao discriminar deixa a
// conta mentindo para sempre -- e o saldo da conta corrente e a base do
// safe-to-spend, da projecao e do patrimonio.
//
// A FORMA DO AJUSTE DO CARTAO E A CERTA E SE MANTEM AQUI: a pessoa digita o
// saldo REAL que o banco mostra hoje, o servidor deriva a diferenca e a
// direcao, e salvar duas vezes SUBSTITUI o ajuste em vez de empilhar. A
// aritmetica e literalmente a mesma funcao -- `ajusteParaFecharEm` --, porque
// uma segunda copia da subtracao em centavos divergiria no caso que ninguem
// testa.
//
// ===========================================================================
// OS CINCO PONTOS EM QUE A CONTA NAO E O CARTAO
// ===========================================================================
//
// 1. A BASE E `financial_accounts.current_balance`, E NAO O TOTAL DE UMA VIEW.
//    Ele e mantido pelo trigger `update_account_balance`
//    (001_baseline.sql:833, reescrito em 007:350), que faz
//    `current_balance = current_balance + NEW.amount` em QUALQUER tipo de
//    lancamento. Entao inserir o lancamento do ajuste move o saldo exatamente
//    pela diferenca e a conta fecha sozinha -- sem UPDATE nenhum em
//    `current_balance`.
//
// 2. O AJUSTE E UM LANCAMENTO, NUNCA UM UPDATE NO SALDO. Esta e a decisao que
//    custa dinheiro se for tomada errada, e o motivo nao esta na tela de
//    Contas: e `net_worth_history` (008:455). Aquela view reconstroi o
//    patrimonio DE TRAS PARA FRENTE a partir do saldo de hoje --
//
//        net_worth(mes) = saldo_de_hoje - (tudo que se moveu DEPOIS do mes)
//
//    -- entao corrigir `current_balance` direto somaria a diferenca em TODO
//    mes passado do grafico de patrimonio, sem nenhuma transacao explicando a
//    subida. Com um lancamento datado, as duas pontas andam juntas: o saldo de
//    hoje sobe D e o movimento do mes do ajuste tambem, e a subtracao devolve
//    o mesmo numero de antes para todo mes anterior. A historia fica certa a
//    partir da data do ajuste e intacta antes dela.
//
// 3. A CHAVE CANONICA E POR DATA, e nao por mes de fatura. Conta corrente nao
//    tem fatura; o que ela tem e um dia em que a pessoa conferiu. Uma chave
//    por mes faria o ajuste de hoje APAGAR o ajuste do mes passado quando os
//    dois caem no mesmo mes -- e, pior, faria a conferencia de hoje reescrever
//    a de ontem, perdendo a diferenca que apareceu no meio.
//
// 4. A CATEGORIA RESERVADA E PROPRIA ("Ajuste de saldo"). Reusar "Ajuste de
//    fatura" rotularia o ajuste de uma conta corrente como ajuste de cartao em
//    todo relatorio por categoria -- e o relatorio por categoria e onde se vai
//    procurar justamente o dinheiro que ninguem discriminou. Criada sob
//    demanda, como a do cartao: a 036 deu `user_id` a
//    `transaction_categories`, entao nao precisa de migration.
//
// 5. `group_id` NULO E `is_shared` FALSO, LITERAIS NO INSERT. Um lancamento
//    NEGATIVO com `group_id` preenchido e rateado pelo trigger
//    `auto_create_group_transaction`: um ajuste de -R$ 50 numa conta viraria
//    despesa nova do grupo, dividida com todo mundo, em silencio. Ver a nota
//    no INSERT da rota.
// ---------------------------------------------------------------------------

import {
  ajusteParaFecharEm,
  centavosDe,
  type AjusteAutomatico,
  type TextosDoAjuste,
} from "@/lib/ajuste-de-fatura";

/**
 * O nome da categoria reservada do ajuste de saldo de CONTA.
 *
 * Diferente de `NOME_DA_CATEGORIA_DE_AJUSTE` ("Ajuste de fatura") de proposito
 * -- ver o ponto 4 do cabecalho. Ela nasce `is_active = FALSE` pelo mesmo
 * desenho da do cartao: a policy `transaction_categories_read_own` (036) nao
 * filtra `is_active`, entao o dono a le; `GET /api/personal-finance/categories`
 * filtra `is_active = true` no proprio SELECT, entao ela nao aparece em seletor
 * nenhum.
 */
export const NOME_DA_CATEGORIA_DE_AJUSTE_DE_SALDO = "Ajuste de saldo";

/** A descricao da categoria reservada, para quem a encontrar no banco. */
export const DESCRICAO_DA_CATEGORIA_DE_AJUSTE_DE_SALDO =
  "Reservada para o ajuste de saldo das contas. Não aparece nos seletores.";

/** Prefixo da chave canonica que o ajuste grava em `financial_transactions.notes`. */
export const PREFIXO_CHAVE_AJUSTE_DE_SALDO = "ajuste-de-saldo:";

/**
 * As duas recusas da aritmetica, no vocabulario de quem olha uma CONTA.
 *
 * "Informe quanto o cartão diz hoje" numa tela de conta corrente nao e um
 * detalhe de texto: e uma frase que fala de outra coisa, e quem a le conclui
 * que abriu a tela errada.
 */
export const TEXTOS_DO_AJUSTE_DE_SALDO: TextosDoAjuste = {
  semValorDigitado: "Informe quanto a conta mostra hoje",
  semBaseParaComparar: "Não foi possível ler o saldo desta conta para comparar",
};

// ---------------------------------------------------------------------------
// A DATA
// ---------------------------------------------------------------------------

/** Dias de cada mes, indexado por `mes - 1`. Fevereiro comum; o bissexto e tratado. */
const DIAS_DO_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * 'AAAA-MM-DD' que EXISTE no calendario, ou `null`.
 *
 * SEM `new Date()` EM NENHUM PONTO, pelo mesmo motivo de
 * `primeiroDiaDoMesDaFatura`: `new Date('2026-10-01')` e lido como UTC e, no
 * fuso de Sao Paulo, volta para 30/09 -- o ajuste gravado um dia antes do que a
 * pessoa conferiu. E `new Date('2026-02-31')` nao recusa: ele rola para 3 de
 * marco, calado.
 *
 * O DIA E CONFERIDO CONTRA O MES, e nao so contra 31. Sem isso '2026-02-30'
 * passaria daqui e chegaria no `date` do Postgres, que responde 22008 --
 * "Erro interno" na tela, em vez de uma recusa que diz qual campo esta errado.
 */
export function diaDoAjuste(data: string | null | undefined): string | null {
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;

  const ano = Number(data.slice(0, 4));
  const mes = Number(data.slice(5, 7));
  const dia = Number(data.slice(8, 10));

  if (mes < 1 || mes > 12 || dia < 1) return null;

  const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
  const ultimoDia = mes === 2 && bissexto ? 29 : DIAS_DO_MES[mes - 1];
  if (dia > ultimoDia) return null;

  return data;
}

/**
 * O dia de HOJE no fuso do APARELHO, 'AAAA-MM-DD'.
 *
 * Recebe o `Date` em vez de chama-lo, para ter teste: com relogio congelado a
 * assercao e exata, e `new Date()` dentro da funcao so daria para medir por
 * aproximacao (ver `relogio-congelado-em-teste-node`).
 *
 * `getFullYear`/`getMonth`/`getDate` E NAO `toISOString()`. O `hojeISO()` de
 * lib/lancamento.ts corta a ISO, que e UTC: as 21h de Sao Paulo ele ja devolve
 * o dia SEGUINTE. Aqui isso datava o ajuste em amanha -- a chave canonica de um
 * dia que ainda nao chegou, e um ajuste a mais quando a pessoa conferisse de
 * novo pela manha.
 */
export function diaLocalDe(agora: Date): string {
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

// ---------------------------------------------------------------------------
// A CHAVE CANONICA
// ---------------------------------------------------------------------------

/**
 * A chave canonica do ajuste daquele DIA naquela conta.
 *
 * E ela que faz o POST trocar o valor em vez de empilhar ajustes: conferir o
 * saldo duas vezes no mesmo dia deixa UM ajuste, com o ultimo valor.
 *
 * @param dia 'AAAA-MM-DD' -- o dia em que a pessoa conferiu o saldo
 */
export function chaveAjusteDeSaldo(dia: string, accountId: string): string {
  return `${PREFIXO_CHAVE_AJUSTE_DE_SALDO}${dia}:${accountId}`;
}

// Ancorada nas duas pontas, pelo mesmo motivo de `RE_CHAVE_AJUSTE`: sem o `$`,
// uma nota escrita a mao como "ajuste-de-saldo:2026-10-16:xxx conferi no app"
// passaria por chave canonica, e a descricao livre do usuario viraria regra de
// negocio.
const RE_CHAVE_AJUSTE_DE_SALDO =
  /^ajuste-de-saldo:(\d{4}-\d{2}-\d{2}):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

/** O dia e a conta de uma chave de ajuste, ou `null` se `notes` nao for uma. */
export function ajusteDeSaldoDaChave(
  notes: string | null | undefined
): { dia: string; accountId: string } | null {
  if (!notes) return null;
  const casou = RE_CHAVE_AJUSTE_DE_SALDO.exec(notes);
  if (!casou) return null;
  return { dia: casou[1], accountId: casou[2] };
}

/** Este lancamento e um ajuste de saldo de conta? */
export function ehAjusteDeSaldo(notes: string | null | undefined): boolean {
  return ajusteDeSaldoDaChave(notes) !== null;
}

// ---------------------------------------------------------------------------
// A BASE DA CONTA: O SALDO SEM AJUSTE NENHUM
// ---------------------------------------------------------------------------

/**
 * `current_balance` menos o ajuste que ja esta gravado, em CENTAVOS INTEIROS.
 *
 * SUBTRAI O `amount`, E ISSO E O CONTRARIO DO QUE O CARTAO FAZ. A diferenca vem
 * de onde cada base nasce:
 *
 *   no CARTAO, a base e `SUM(invoice_amount)` e a view publica
 *   `(-t.amount) AS invoice_amount`. A contribuicao do ajuste e `-amount`, e
 *   tira-la e `total - (-amount)`, isto e, SOMAR -- por isso
 *   `centavosDaFaturaSemAjuste` soma;
 *
 *   na CONTA, a base e `current_balance` e o trigger soma `NEW.amount` CRU. A
 *   contribuicao do ajuste e `+amount`, e tira-la e SUBTRAIR.
 *
 * Copiar o sinal do cartao para ca erraria a base pelo DOBRO do ajuste
 * existente, e o sintoma seria o SEGUNDO ajuste do mesmo dia vir com o dobro da
 * diferenca -- plausivel, e so no segundo.
 *
 * O RESIDUO. A aritmetica e em centavos inteiros porque `2430.10 - 2380.00` em
 * ponto flutuante nao da `50.1` exato, e o residuo cai exatamente no teste de
 * "a conta ja bate".
 *
 * `null` quando o saldo nao deu para ler, e tambem quando o ajuste existente
 * tem `amount` ilegivel: nesse caso a base seria calculada como se nao houvesse
 * ajuste, e o novo valor somaria em cima do velho -- o acumulo que a chave
 * canonica existe para impedir. `null` E DIFERENTE DE ZERO: conta zerada tem
 * saldo 0 e ajusta-la e legitimo.
 *
 * @param amountDoAjuste `null`/`undefined` significa "nao ha ajuste gravado".
 */
export function centavosDoSaldoSemAjuste(params: {
  saldoAtual: unknown;
  amountDoAjuste: unknown;
}): number | null {
  const centavosDoSaldo = centavosDe(params.saldoAtual);
  if (centavosDoSaldo === null) return null;

  if (params.amountDoAjuste === null || params.amountDoAjuste === undefined) {
    return centavosDoSaldo;
  }

  const doAjuste = centavosDe(params.amountDoAjuste);
  if (doAjuste === null) return null;

  // SUBTRAI, e nao soma. Ver o bloco acima.
  return centavosDoSaldo - doAjuste;
}

// ---------------------------------------------------------------------------
// A DIFERENCA
// ---------------------------------------------------------------------------

/**
 * O saldo real informado + o saldo sem ajuste -> o ajuste que faz os dois
 * baterem.
 *
 * `ajusteParaFecharEm` E A MESMA FUNCAO DO CARTAO, de proposito: a subtracao em
 * centavos, o teto de `numeric(15,2)`, a recusa de campo vazio e o `fecha:
 * true` sao identicos nas duas telas, e e o tipo de aritmetica em que duas
 * copias divergem no caso que ninguem testa. O que muda e o vocabulario das
 * recusas, que entra por `textos`.
 *
 * A direcao sai do SINAL do resultado: positivo quer dizer que a conta tem mais
 * do que o app sabia (entrou dinheiro que nao foi lancado), negativo que tem
 * menos (saiu). Essa e a leitura natural do saldo, e e a oposta da do cartao,
 * onde positivo quer dizer MAIS DIVIDA.
 */
export function ajusteParaOSaldoFicarEm(params: {
  saldoReal: unknown;
  saldoSemAjuste: unknown;
}): AjusteAutomatico {
  return ajusteParaFecharEm({
    saldoReal: params.saldoReal,
    totalSemAjuste: params.saldoSemAjuste,
    textos: TEXTOS_DO_AJUSTE_DE_SALDO,
  });
}

/** Onde o saldo fica se este ajuste for gravado. */
export function saldoComOAjuste(
  semAjuste: number,
  diferenca: number
): number {
  return Number(semAjuste) + Number(diferenca);
}

// ---------------------------------------------------------------------------
// O LANCAMENTO QUE VAI PARA O BANCO
// ---------------------------------------------------------------------------

/** As colunas de `financial_transactions` que o ajuste de saldo decide. */
export interface LancamentoDoAjusteDeSaldo {
  /**
   * O valor na coluna, SEM INVERSAO: a diferenca, como ela e.
   *
   * O trigger soma `amount` cru em `current_balance`, entao o saldo so termina
   * no numero que a pessoa digitou se `amount` for a diferenca com o proprio
   * sinal. Inverter aqui (como o cartao faz, porque a view dele inverte de
   * volta) afastaria o saldo do banco pelo DOBRO da diferenca.
   */
  amount: number;
  /** 'income' quando entrou dinheiro que faltava, 'expense' quando saiu. */
  transaction_type: "expense" | "income";
  /** O dia em que a pessoa conferiu o saldo. */
  transaction_date: string;
  description: string;
  /** A chave canonica. E ela que faz o proximo POST trocar em vez de somar. */
  notes: string;
}

/**
 * A descricao padrao, quando o usuario nao escreve uma.
 *
 * Ela diz o que a linha E, porque e isso que vai aparecer no extrato da conta,
 * na lista de lancamentos e no relatorio. Uma linha de R$ 50 chamada "Ajuste"
 * sem mais nada, tres meses depois, e indistinguivel de uma compra esquecida.
 */
export function descricaoPadraoDoAjusteDeSaldo(diferenca: number): string {
  return diferenca >= 0
    ? "Ajuste de saldo da conta (entrada não detalhada)"
    : "Ajuste de saldo da conta (saída não detalhada)";
}

/**
 * O lancamento do ajuste, ou `null` quando a data nao da para ler.
 *
 * `null` em vez de um fallback para hoje: gravar dinheiro num dia que o usuario
 * nao escolheu e o tipo de erro que ninguem encontra -- o valor esta certo, o
 * saldo fecha, e so o grafico de patrimonio fica com o degrau no mes errado.
 *
 * ZERO TAMBEM E `null`, e nao uma linha de R$ 0,00: ela nao muda saldo nenhum,
 * aparece no extrato com cara de lancamento real, e e exatamente o que a rota
 * gravaria quando a conta JA BATE -- em vez de tirar o ajuste velho que sobrou.
 */
export function lancamentoDoAjusteDeSaldo(params: {
  diferenca: number;
  data: string;
  accountId: string;
  descricao?: string | null;
}): LancamentoDoAjusteDeSaldo | null {
  const dia = diaDoAjuste(params.data);
  if (!dia || !params.accountId) return null;
  if (!Number.isFinite(params.diferenca) || params.diferenca === 0) {
    return null;
  }

  const descricao = (params.descricao ?? "").trim();

  return {
    // SEM INVERSAO. Ver `LancamentoDoAjusteDeSaldo.amount`.
    amount: params.diferenca,
    transaction_type: params.diferenca > 0 ? "income" : "expense",
    transaction_date: dia,
    description: descricao || descricaoPadraoDoAjusteDeSaldo(params.diferenca),
    notes: chaveAjusteDeSaldo(dia, params.accountId),
  };
}
