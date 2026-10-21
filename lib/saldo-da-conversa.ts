/**
 * OS TRES NUMEROS DA CONVERSA -- HMO-465 (F2 do plano da HMO-462).
 *
 * `Ganhei 2000`, `Gastei 1000`, `Saldo 1000`. Funcoes PURAS sobre linhas de
 * `financial_transactions`, do mesmo jeito e pelo mesmo motivo que
 * `lib/papel-de-pao.ts` o e: a suite roda sem navegador e sem banco, e a rota
 * (F3) autentica, le e delega.
 *
 * ===========================================================================
 * REALIZADO, NAO PREVISTO -- E POR ISSO ESTE ARQUIVO NASCEU
 * ===========================================================================
 * O painel de hoje (`lib/papel-de-pao.ts`) le `scheduled_transactions_effective`
 * -- as contas PREVISTAS. "Gastei 1000" e REALIZADO: `financial_transactions`.
 *
 * As duas tabelas tem convencoes de sinal OPOSTAS (esta escrito no cabecalho de
 * `lib/papel-de-pao.ts`): em `scheduled_transactions` a despesa e POSITIVA e
 * quem diz a direcao e a coluna `direction`; em `financial_transactions` a
 * despesa e NEGATIVA. Entao NENHUMA funcao de `lib/papel-de-pao.ts` e
 * reaproveitada aqui, e isso e decisao, nao duplicacao por descuido.
 *
 * Pendurar os rotulos da conversa nos numeros do painel e a falha que este
 * repositorio ja pagou duas vezes -- "Fatura atual" mostrando a divida inteira
 * do cartao (HMO-290), "a vencer" somando o salario junto com as contas
 * (HMO-187). Nos dois casos o numero saiu plausivel, a tela nao deu erro, e so
 * quem somou na mao descobriu. Aqui o estrago seria pior: debaixo de "Saldo", a
 * Leticia veria uma frase aritmetica que NAO FECHA.
 *
 * ===========================================================================
 * O QUE "SALDO" E -- E O QUE ELE NAO E
 * ===========================================================================
 * Saldo = `ganhei - gastei`, aritmetica, no MES CORRENTE.
 *
 *   * NAO e `financial_accounts.current_balance`. Aquele traz saldo inicial,
 *     ajuste de saldo e fatura de cartao dentro, e a frase da issue deixaria de
 *     fechar: 2000 - 1000 = 1000, e o saldo diria outra coisa.
 *   * NAO e "desde sempre". Saldo sem periodo ela nao confere de cabeca, e saldo
 *     sem recorte cresce para sempre e nunca reinicia. Mes corrente e o periodo
 *     que o resto do app ja usa.
 *   * OS TRES SAEM JUNTOS, nunca o saldo sozinho. E o que deixa a aritmetica
 *     visivel na propria tela, e e a unica defesa real contra o numero plausivel
 *     e errado -- a mesma razao pela qual este arquivo devolve um objeto de tres
 *     campos em vez de tres funcoes que a tela chamaria separadas.
 *
 * ===========================================================================
 * `include_in_total`, E NAO `exclude_from_totals`
 * ===========================================================================
 * A HMO-465 chama a coluna da migration 060 de `exclude_from_totals`. ESSE NOME
 * NAO EXISTE no banco. A coluna e
 *
 *     financial_transactions.include_in_total boolean NOT NULL DEFAULT true
 *
 * -- POSITIVA, homonima da de `financial_accounts` (058), e o COMMENT da 060 diz
 * por que ela e positiva: "todo leitor e uma soma, e a negacao dupla inverteria
 * o total". Com o nome da issue, `exclude_from_totals = false` seria "soma"; com
 * a coluna de verdade, quem soma e `true`. Escrever o filtro pelo nome da issue
 * inverteria o criterio e o numero sairia plausivel.
 *
 * O teste e `!== false`, E NAO `=== true`, pela mesma razao que
 * `contasQueSomam` (lib/contas.ts) usa `!== false`: a coluna e NOT NULL no banco,
 * entao do Postgres so vem `true` ou `false` e os dois seriam equivalentes -- a
 * diferenca aparece na resposta que NAO vem do Postgres. O app e PWA e tem cache
 * offline (`lib/offline-cache.ts`): linha guardada ANTES da 060 chega sem o
 * campo, e `undefined === true` e falso. Com `=== true` toda linha do cache
 * sairia da soma e a conversa mostraria `Saldo 0` para quem abrisse sem rede.
 * `!== false` trata "nao sei" como "soma", que e o default da coluna e o
 * comportamento de antes da feature.
 *
 * ===========================================================================
 * OS FILTROS DE LEITURA -- NENHUM E O PADRAO
 * ===========================================================================
 * 1. `group_id IS NULL`, explicito. "Nada de grupos, nada de contas divididas"
 *    nao e so nao criar linha de grupo: a PERNA DE GRUPO do custo pessoal dela e
 *    uma linha de verdade em `financial_transactions`, com o `user_id` DELA. Sem
 *    o filtro ela entra na soma, calada. (E `amount` negativo COM `group_id` e
 *    rateado por trigger do banco -- a divisao nao depende do app concordar.)
 *
 * 2. `include_in_total !== false` -- a secao acima.
 *
 * 3. O MES CORRENTE, janela fechada.
 *
 * 4. So `transaction_type` 'income' ou 'expense'. 'transfer' fica FORA (dinheiro
 *    andando entre contas dela nao e ganho nem gasto, e contado viraria gasto
 *    fantasma), e `transaction_type` E ANULAVEL na tabela -- linha com tipo nulo
 *    nao e nem receita nem despesa e tambem fica fora. Por isso a soma pergunta
 *    pelos dois nomes, em vez de um `else` que varreria os dois casos para
 *    dentro de `gastei`.
 *
 * O `user_id` NAO entra aqui, e e de proposito: filtro por dono e de CONSULTA,
 * nao de linha -- uma funcao pura sobre linhas nao tem como prova-lo. Quem
 * chama (F3) aplica `.eq("user_id", user.id)`. Vale saber por que a omissao
 * nao vaza dinheiro de outra pessoa para dentro destes numeros: a policy de
 * SELECT do 002 e `user_id = auth.uid() OR (group_id IS NOT NULL AND
 * is_group_member(group_id))`, entao a UNICA linha alheia que a RLS deixa
 * chegar tem `group_id IS NOT NULL` -- e o filtro 1 ja a descarta. E o mesmo
 * raciocinio que a migration 046 escreveu para `personal_monthly_cash_flow`.
 *
 * ===========================================================================
 * O SINAL
 * ===========================================================================
 * `Math.abs()` + `transaction_type`, NUNCA o sinal do numero -- a mesma receita
 * de `category_monthly_totals` (`SUM(ABS(t.amount)) FILTER (WHERE
 * transaction_type = 'expense')`, 022/060). Somar `amount` cru deixaria `gastei`
 * NEGATIVO, e ai `ganhei - gastei` SOMA as duas pernas: 2000 - (-1000) = 3000,
 * com os dois primeiros numeros da tela certos e o terceiro errado.
 */
import { periodoCorrente } from "@/lib/periodo-do-painel";

/**
 * O `select` da leitura da conversa (para F3): `*`, e NAO a lista de colunas.
 *
 * Nomear `include_in_total` num `select` faz o PostgREST responder
 *
 *     42703  column financial_transactions.include_in_total does not exist
 *
 * em qualquer banco que ainda nao recebeu a migration 060 -- e a 060 e colada A
 * MAO no SQL Editor, depois do deploy do codigo. Foi exatamente isso que as
 * quatro rotas de patrimonio mediram em producao na HMO-431 com a homonima da
 * 058. `*` nao nomeia coluna nenhuma: traz o campo quando ele existe e nao o
 * traz quando nao existe -- e ai `include_in_total` chega `undefined`, que o
 * `!== false` acima trata como "soma".
 *
 * NAO troque por um FILTRO `.not("include_in_total", "is", false)` tampouco: um
 * filtro tem o mesmo 42703 do select nomeado, e ainda por cima DESCARTARIA a
 * linha em vez de derrubar a rota -- um saldo silenciosamente menor e pior que
 * um 500.
 */
export const COLUNAS_DA_CONVERSA = "*";

/** A janela fechada de datas ISO em que as linhas da conversa contam. */
export interface MesDaConversa {
  de: string;
  ate: string;
}

/**
 * Uma linha realizada, como `financial_transactions` a entrega.
 *
 * `amount` aceita string porque `numeric(15,2)` chega como string pelo
 * PostgREST. `include_in_total` aceita `undefined` porque o cache offline e o
 * banco pre-060 nao o tem -- ver a secao da coluna no cabecalho.
 */
export interface LinhaDaConversa {
  transaction_type?: "income" | "expense" | "transfer" | null;
  amount: number | string;
  transaction_date: string;
  group_id?: string | null;
  include_in_total?: boolean | null;
}

/** Os tres numeros, em reais, com `saldo = ganhei - gastei` por construcao. */
export interface TresNumerosDaConversa {
  ganhei: number;
  gastei: number;
  saldo: number;
}

/**
 * O mes corrente da conversa.
 *
 * DELEGA para `periodoCorrente` (lib/periodo-do-painel) em vez de recortar o mes
 * aqui. "O mes corrente" e uma definicao com historia neste app e a segunda
 * copia dela e o defeito: `new Date().toISOString()` e UTC, e em
 * America/Sao_Paulo das 21:00 as 23:59 do ultimo dia do mes esse valor ja aponta
 * para o mes SEGUINTE -- foi assim que o painel mostrou as contas de outubro no
 * dia 30 de setembro (HMO-173).
 *
 * Isto NAO e reaproveitar `lib/papel-de-pao.ts`: `periodo-do-painel` e o
 * calendario do app, nao um numero de previsto. O que o plano da HMO-462 proibe
 * e herdar as CONTAS do painel, e nenhuma vem daqui.
 *
 * `hoje` fica como parametro por cima disso porque data lida do relogio nao se
 * congela, e teste de data passa verde em UTC sem ver o bug: a sandbox e Sao
 * Paulo e o CI e UTC. Por isso a suite roda nos dois fusos.
 */
export function mesCorrenteDaConversa(hoje?: string): MesDaConversa {
  const { de, ate } = periodoCorrente(hoje);
  return { de, ate };
}

/** A linha cai dentro do mes? Comparacao de string ISO, que ordena sozinha. */
function dentroDoMes(transaction_date: unknown, mes: MesDaConversa): boolean {
  const dia = String(transaction_date ?? "");
  return dia >= mes.de && dia <= mes.ate;
}

/**
 * AS LINHAS QUE A CONVERSA CONTA -- os filtros 1, 2 e 3 do cabecalho.
 *
 * Existe como funcao propria, e nao como tres `if` dentro da soma, porque quem
 * precisa da resposta nao e so o saldo: a tela (F4) quer saber QUANTAS linhas
 * entraram, e a rota (F3) devolve a lista. Tres copias do criterio divergiriam,
 * e o sintoma seria a lista da tela discordando do total que esta em cima dela
 * -- duas leituras, as duas plausiveis, e nenhum numero que as confronte.
 *
 * Generica no item (so os tres campos interessam) para servir a rota sem que ela
 * precise estreitar o tipo das linhas que leu.
 */
export function linhasDaConversa<
  T extends {
    transaction_date: string;
    group_id?: string | null;
    include_in_total?: boolean | null;
  },
>(linhas: T[], mes: MesDaConversa): T[] {
  return linhas.filter(
    (linha) =>
      (linha.group_id ?? null) === null &&
      linha.include_in_total !== false &&
      dentroDoMes(linha.transaction_date, mes)
  );
}

/**
 * OS TRES NUMEROS.
 *
 * A soma e em CENTAVOS INTEIROS e so divide por 100 no fim. Em float,
 * `0.1 + 0.2` da 0.30000000000000004 e um extrato de 40 linhas chega na tela com
 * centavo de sobra -- debaixo de uma frase que a issue pede que FECHE de cabeca.
 *
 * Linha com `amount` que nao vira numero e DESCARTADA em vez de somada: um
 * `NaN` numa parcela envenena os TRES numeros de uma vez (`NaN - NaN`), e a
 * tela mostraria "R$ NaN" no lugar do dinheiro dela. Do Postgres isso nao vem
 * (`numeric(15,2) NOT NULL`); do cache offline, vem.
 */
export function tresNumerosDaConversa(
  linhas: LinhaDaConversa[],
  mes: MesDaConversa
): TresNumerosDaConversa {
  let ganhei = 0;
  let gastei = 0;

  for (const linha of linhasDaConversa(linhas, mes)) {
    const centavos = Math.round(Math.abs(Number(linha.amount)) * 100);
    if (!Number.isFinite(centavos)) continue;
    if (linha.transaction_type === "income") ganhei += centavos;
    else if (linha.transaction_type === "expense") gastei += centavos;
  }

  return {
    ganhei: ganhei / 100,
    gastei: gastei / 100,
    saldo: (ganhei - gastei) / 100,
  };
}
