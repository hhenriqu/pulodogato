/**
 * A MINHA parte de uma despesa de grupo (HMO-177).
 *
 * O aluguel de R$ 3.000 do grupo Casa, com duas pessoas, aparecia como
 * R$ 3.000 de custo fixo mensal -- para as DUAS. A parte do outro virava sua.
 *
 * POR QUE O NUMERO ESTAVA ERRADO PARA TODO MUNDO, E POR DOIS MOTIVOS
 * ------------------------------------------------------------------
 * `/api/scheduled-transactions/summary` faz duas consultas e nenhuma delas
 * filtra por `user_id` -- de proposito, porque a RLS e quem filtra. Mas as
 * policies do 005 nao sao `user_id = auth.uid()` e mais nada:
 *
 *   recurring_rules_select / scheduled_transactions_select
 *     USING (user_id = auth.uid()
 *            OR (group_id IS NOT NULL AND public.is_group_member(group_id)))
 *
 * O `OR` existe para a tela do grupo funcionar, e o efeito colateral e que a
 * consulta SEM filtro devolve, alem das minhas linhas, as linhas de grupo de
 * todos os outros membros. Medido num Postgres local com as migrations reais
 * (001 -> 025), uma regra de aluguel de R$ 3.000 do Helio no grupo Casa:
 *
 *   quem                      regras   soma      previstas   soma
 *   Helio (dono da regra)          1   3000.00           1   3000.00
 *   Lais  (nao tem regra nenhuma)  1   3000.00           1   3000.00
 *   alguem de fora (controle)      0         0           0         0
 *
 * Entao o Helio via o dobro da parte dele, e a Lais -- que nao cadastrou nada
 * -- via um custo fixo de R$ 3.000 saido de uma regra que nao e dela, e uma
 * conta a pagar no nome do Helio. O controle negativo (quem nao e do grupo ve
 * zero) e o que prova que isso e a RLS falando, e nao superusuario furando ela.
 *
 * A CORRECAO E A MESMA NOS DOIS CASOS
 * -----------------------------------
 * Contar, da linha de grupo, so a parte de um membro. Para o Helio isso da
 * R$ 1.500 e para a Lais tambem R$ 1.500 -- e a soma das duas continua sendo
 * o aluguel inteiro. Nao e coincidencia: e por isso que "a minha parte" e a
 * unica leitura que fecha para os dois lados ao mesmo tempo.
 *
 * POR QUE DIVIDIR POR MEMBROS ATIVOS, E NAO POR `split_type`
 * ----------------------------------------------------------
 * `expense_groups.default_split_type` aceita equal/percentage/custom/
 * proportional, mas quem cria a divisao de verdade e o trigger
 * `auto_create_group_transaction`, e desde a 042 (HMO-304) ele honra
 * `group_members.percentage`: a ligacao nasce `split_type = 'percentage'` e
 * cada parte sai pelo PESO do membro, dividido pela SOMA dos pesos, em
 * centavos inteiros pelo maior resto.
 *
 * O "dia em que o trigger passar a honrar os outros tipos" que este comentario
 * antecipava CHEGOU, e a conta daqui mudou junto -- so nao do jeito que ele
 * esperava: continua sendo "divida por membros ativos", porque o caso que esta
 * funcao atende e o do grupo cuja soma de pesos e ZERO. `percentage` e
 * `numeric(5,2) DEFAULT 0.00` e NULLABLE, e grupo que nunca passou pela tela
 * de divisao (HMO-271) tem soma zero -- a 042 manda esse caso para o
 * `calculate_equal_split`, que divide IGUAL entre os ativos. Que e esta conta.
 *
 * O QUE AINDA FALTA AQUI, E QUE NAO E ESTE MODULO
 * ----------------------------------------------
 * Para o grupo que JA configurou 70/30, esta funcao ainda devolve a parte
 * igual: ela recebe uma contagem de membros (`MembrosAtivosPorGrupo`), nao os
 * pesos, entao nao tem como saber que a parte do Helio e 70%. O lado PREVISTO
 * que le pesos e `ratearPorPeso` (lib/fechamento-do-grupo.ts), usado pelo
 * fechamento do mes; trocar a contagem pelos pesos AQUI e o conserto do
 * previsto nas telas -- a issue irma desta no plano da HMO-302, que mexe em
 * cinco rotas e por isso nao veio junto com a migration.
 * Enquanto isso nao entrar, o grupo 70/30 ve 50/50 nestas leituras e 70/30 na
 * baixa -- a discordancia agora esta num lugar so, e e aqui.
 *
 * TUDO EM CENTAVOS INTEIROS
 * -------------------------
 * Mesma razao de `lib/settlement.ts`, `lib/grupos.ts` e
 * `lib/orcamento-de-grupo.ts`: dividir em ponto flutuante deixa residuo, e o
 * proprio banco arredonda a parte para `numeric(15,2)`. `toCents` vem de
 * settlement.ts porque ela e a UNICA conversao reais -> centavos do projeto.
 */

import { toCents, toReais } from "@/lib/settlement";
import { monthlyCost } from "@/lib/recurrence";
import type { RecurrenceFrequency } from "@/types/financial";

/**
 * Quantos membros ATIVOS cada grupo tem, indexado por `group_id`.
 *
 * Grupo ausente do mapa nao e o mesmo que grupo de um membro: ver
 * `parteDoMembro`.
 */
export type MembrosAtivosPorGrupo = ReadonlyMap<string, number>;

/**
 * O minimo que este modulo le de uma regra recorrente.
 *
 * Os numericos chegam do PostgREST como string (`numeric(15,2)` nao cabe em
 * double sem perda, entao o driver nao converte); por isso `number | string`.
 */
export interface RegraParaCusto {
  amount: number | string;
  /**
   * O enum de verdade, e nao `string`: `monthlyCost` trata frequencia
   * desconhecida como SEMANAL (o `?? 7` de DAYS_PER_PERIOD em lib/recurrence),
   * entao um 'yearly' digitado no lugar de 'annual' nao da erro -- transforma
   * R$ 1.200 por ano em R$ 1.738 por mes.
   */
  frequency: RecurrenceFrequency;
  interval_count?: number | null;
  transaction_type?: string | null;
  group_id?: string | null;
}

/**
 * A parte de UM membro num valor.
 *
 * Fora de grupo (`group_id` nulo) a parte e o valor inteiro -- despesa pessoal
 * nao se divide com ninguem.
 *
 * QUANDO A CONTAGEM NAO E CONHECIDA, DEVOLVE O VALOR CHEIO
 * -------------------------------------------------------
 * Um grupo pode faltar no mapa por motivo legitimo: a RLS de `group_members`
 * pode nao me deixar contar os membros de um grupo cuja LINHA de despesa eu
 * enxergo. Nesse caso a escolha e entre errar para cima (valor cheio, que e o
 * que a tela mostrava antes desta correcao) e errar para baixo (dividir por um
 * palpite). Errar para baixo e pior: um custo fixo subestimado alimenta o
 * safe-to-spend e faz o app dizer que sobra dinheiro que nao sobra. Entao aqui
 * o desconhecido mantem o valor cheio, e nao ha divisao por zero possivel.
 */
export function parteDoMembro(
  valorCheio: number | string,
  groupId: string | null | undefined,
  membrosAtivosPorGrupo: MembrosAtivosPorGrupo
): number {
  const cheio = Number(valorCheio) || 0;
  if (!groupId) return cheio;

  const membros = membrosAtivosPorGrupo.get(groupId);
  if (membros === undefined || !Number.isFinite(membros) || membros < 1) {
    return cheio;
  }
  if (membros === 1) return cheio;

  return toReais(Math.round(toCents(cheio) / membros));
}

/**
 * O custo fixo mensal que e MEU: a soma das regras ativas de despesa, cada
 * linha de grupo contando so a minha parte.
 *
 * Receita fica de fora (`transaction_type === "income"`) porque a pergunta que
 * o painel faz e "quanto sai todo mes", e era assim antes desta correcao.
 *
 * A normalizacao para "por mes" continua sendo `monthlyCost` (anual/12,
 * semanal*52/12). Tomar a parte antes ou depois de normalizar da o mesmo
 * numero -- divisao comuta --, e tomar antes deixa explicito que a parte e do
 * valor que o grupo cobra.
 */
export function custoFixoMensalDaMinhaParte(
  regras: readonly RegraParaCusto[],
  membrosAtivosPorGrupo: MembrosAtivosPorGrupo,
  hoje: string
): number {
  const total = regras
    .filter((r) => r.transaction_type !== "income")
    .reduce((soma, r) => {
      const minha = parteDoMembro(r.amount, r.group_id, membrosAtivosPorGrupo);
      return (
        soma +
        monthlyCost(
          {
            frequency: r.frequency,
            interval_count: r.interval_count ?? 1,
            start_date: hoje,
          },
          minha
        )
      );
    }, 0);

  return Number(total.toFixed(2));
}

/**
 * Conta os membros ativos por grupo a partir das linhas cruas de
 * `group_members`.
 *
 * Existe como funcao pura para o teste poder provar a contagem sem banco: um
 * `reduce` dentro da rota passaria verde com `status` errado.
 */
export function contarMembrosAtivos(
  linhas: readonly { group_id: string; status?: string | null }[]
): Map<string, number> {
  const contagem = new Map<string, number>();
  for (const linha of linhas) {
    if (linha.status && linha.status !== "active") continue;
    contagem.set(linha.group_id, (contagem.get(linha.group_id) ?? 0) + 1);
  }
  return contagem;
}
