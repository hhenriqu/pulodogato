// =====================================================
// RESUMO DO MES FECHADO E ANOMALIA DE GASTO - a conversa com o banco
// =====================================================
// Mesmo desenho -- e pela mesma razao -- de lib/services/recurrence-alerts.ts:
// o cliente do Supabase entra como PARAMETRO, para que a sessao do usuario
// (`GET /api/anomalies`) e a service_role (`GET /api/cron/monthly-summary`)
// rodem o MESMO codigo. Copiar a leitura seria criar duas versoes do mesmo
// numero, e o dia em que uma delas fosse ajustada produziria a pior falha
// possivel aqui: a notificacao diz uma coisa, a tela diz outra, e as duas
// parecem certas.
//
// O CALCULO NAO MORA AQUI
// -----------------------
// Quem decide o que e anomalia e o que entra no resumo e lib/anomalies.ts, que
// tem teste proprio (`npm run test:anomalies`, 27 casos e sete mutacoes
// provadas). Aqui mora QUAIS LINHAS entram e a traducao do resumo para a
// linguagem da notificacao (`kind`, `summary_month`, titulo e corpo).
//
// POR QUE A ANOMALIA LE TRANSACAO E O RESUMO LE VIEW
// --------------------------------------------------
// Nao e inconsistencia -- e a mesma regra aplicada duas vezes. Sempre que a
// view do 008 serve, e a view que e usada, porque o tratamento de sinal mora
// la num lugar so. A anomalia do mes CORRENTE precisa cortar o historico no
// mesmo dia do mes em que hoje esta (senao o dia 12 e comparado com meses
// cheios e o app acusa "queda de 90%" todo comeco de mes); o grao daquelas
// views e o MES, e dai nao se extrai um corte por dia. Nesse caso -- e so
// nesse -- a leitura desce para financial_transactions, e a regra de sinal fica
// em `gastoDaTransacao`, que espelha a da view.
// =====================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  detectarAnomalias,
  resumoDoMesFechado,
  mesAnterior,
  type Anomalias,
  type ResumoDoMes,
  type TransacaoParaAnomalia,
  type AssinaturaQueSubiu,
  type ContaVencida,
} from "@/lib/anomalies";
import { lerPreferenciaDeMoeda } from "@/lib/moeda";
import { formatarValor } from "@/lib/dinheiro";

/** O `kind` de bill_notifications, na familia do resumo (migration 017). */
export const KIND_RESUMO = "monthly_summary" as const;

/** Para onde o clique no sino e no push leva. */
export const URL_DO_RESUMO = "/dashboard/reports";

/**
 * Teto de transacoes lidas numa passada.
 *
 * O PostgREST tem limite proprio e devolve a pagina em silencio; pedir o teto
 * explicitamente e o que torna o truncamento VISIVEL (`truncado` na saida) em
 * vez de virar um resumo que simplesmente ignora parte do mes sem avisar.
 */
export const MAX_TRANSACOES = 5000;

/** Quantos meses de historico a anomalia olha para tras. */
export const MESES_DE_HISTORICO = 7;

/** As colunas de financial_transactions que o calculo precisa -- nada alem. */
export const COLUNAS_DA_TRANSACAO =
  "transaction_date, amount, transaction_type, category_id, description";

/** 'YYYY-MM-01' do mes que comeca `meses` antes do mes de `iso`. */
export function inicioDoHistorico(iso: string, meses: number): string {
  let mes = iso.slice(0, 7);
  for (let i = 0; i < meses; i++) mes = mesAnterior(mes);
  return `${mes}-01`;
}

export interface AnomaliasDoUsuario {
  anomalias: Anomalias;
  /** A leitura bateu no teto: o numero da tela pode estar incompleto. */
  truncado: boolean;
}

/**
 * As anomalias do mes corrente de UM usuario.
 *
 * `userId` e obrigatorio mesmo quando o cliente e o da sessao (onde a RLS ja
 * filtraria): com a service_role nao ha RLS nenhuma, e sem o `.eq("user_id")`
 * abaixo esta funcao somaria a despesa de TODO MUNDO no resumo de um. Exigir o
 * parametro nos dois casos e o que impede essa diferenca de passar despercebida.
 * (Ele nao serve para as categorias -- aquilo e catalogo global, ver
 * `nomesDasCategorias`.)
 */
export async function anomaliasDoUsuario(
  client: SupabaseClient,
  userId: string,
  hoje: string
): Promise<AnomaliasDoUsuario> {
  const desde = inicioDoHistorico(hoje, MESES_DE_HISTORICO);

  const { data, error } = await client
    .from("financial_transactions")
    .select(COLUNAS_DA_TRANSACAO)
    .eq("user_id", userId)
    .eq("transaction_type", "expense")
    .gte("transaction_date", desde)
    .lte("transaction_date", hoje)
    .limit(MAX_TRANSACOES);

  if (error) throw error;

  const transacoes = (data ?? []) as unknown as TransacaoParaAnomalia[];

  const nomesDeCategoria = await nomesDasCategorias(client);

  return {
    anomalias: detectarAnomalias({ transacoes, hoje, nomesDeCategoria }),
    truncado: transacoes.length >= MAX_TRANSACOES,
  };
}

/**
 * `category_id` -> nome, para a tela e a notificacao nao mostrarem UUID.
 *
 * `transaction_categories` e CATALOGO GLOBAL, nao tabela de usuario: a chave
 * dela e `service_id` (o servico `personal_finance`) e ela **nunca teve coluna
 * `user_id`** -- ver `001_baseline.sql`, `CREATE TABLE
 * public.transaction_categories`. Nao ha categoria "do usuario" para filtrar, e
 * a RLS de producao (`transaction_categories_read`, `is_active = true`, para
 * `authenticated` e `anon`) ja diz isso: todo mundo le o mesmo catalogo.
 *
 * Por isso NAO ha filtro por dono aqui, e nao e esquecimento. A versao anterior
 * filtrava por `user_id`, o PostgREST devolvia `42703 column ... does not
 * exist`, e o `throw` abaixo virava **500 em producao para todo usuario** em
 * `GET /api/anomalies`. Ver `scripts/check-column-drift.mjs`, que passou a
 * reprovar o build nesse caso.
 */
export async function nomesDasCategorias(
  client: SupabaseClient
): Promise<Record<string, string>> {
  const { data, error } = await client
    .from("transaction_categories")
    .select("id, name");

  if (error) throw error;

  const mapa: Record<string, string> = {};
  for (const linha of (data ?? []) as Array<{ id: string; name: string }>) {
    mapa[linha.id] = linha.name;
  }
  return mapa;
}

/**
 * O resumo do mes fechado de UM usuario, pronto para virar notificacao.
 *
 * As quatro leituras sao independentes e vao juntas: uma viagem sequencial por
 * usuario multiplicaria a latencia do cron pelo numero de pessoas.
 */
export async function resumoDoUsuario(
  client: SupabaseClient,
  userId: string,
  hoje: string
): Promise<ResumoDoMes> {
  const mes = mesAnterior(hoje);
  const primeiroDia = `${mes}-01`;
  const desde = inicioDoHistorico(hoje, MESES_DE_HISTORICO);

  // ESTE RESUMO E DE UMA MOEDA SO, E ISSO E DELIBERADO (HMO-171)
  //
  // `resumoDoMesFechado` soma todas as linhas que casam o mes -- de proposito,
  // porque quem participa de um grupo tem uma linha pessoal e uma por grupo no
  // mesmo mes. Depois da 022 as views tem a moeda no GRAO, entao essa mesma soma
  // passaria a juntar 1000 reais com 180 dolares e o resumo mensal anunciaria
  // "voce gastou 1180" -- numa notificacao, que e o pior lugar para um numero
  // errado: ela chega sozinha, sem tela ao lado para conferir.
  //
  // A escolha aqui e RESTRINGIR a leitura a moeda oficial, e nao somar nem
  // quebrar o resumo em varios blocos. O motivo e o formato: e uma mensagem de
  // texto com um numero, nao um relatorio -- e o resumo de quem movimenta duas
  // moedas passa a cobrir a principal, em vez de inventar um total que nao
  // existe. As telas de relatorio (fluxo de caixa, categorias) mostram TODAS as
  // moedas separadas; esta notificacao e o unico lugar que fica parcial, e fica
  // parcial de um jeito que nao mente sobre a unidade.
  const moedaOficial = lerPreferenciaDeMoeda(
    (
      await client
        .from("profiles")
        .select("preferences")
        .eq("id", userId)
        .maybeSingle()
    ).data?.preferences
  ).oficial;

  const [fluxo, porCategoria, nomesDeCategoria, extras] = await Promise.all([
    lerFluxo(client, userId, desde, moedaOficial),
    lerCategorias(client, userId, desde, moedaOficial),
    nomesDasCategorias(client),
    lerExtras(client, userId, mes, primeiroDia),
  ]);

  return resumoDoMesFechado({
    hoje,
    fluxo,
    porCategoria,
    nomesDeCategoria,
    assinaturasQueSubiram: extras.assinaturas,
    vencidas: extras.vencidas,
    moeda: moedaOficial,
  });
}

async function lerFluxo(
  client: SupabaseClient,
  userId: string,
  desde: string,
  moeda: string
) {
  const { data, error } = await client
    .from("monthly_cash_flow")
    .select("month, income, expense")
    .eq("user_id", userId)
    .eq("currency", moeda)
    .gte("month", desde);
  if (error) throw error;
  return (data ?? []) as Array<{ month: string; income: number; expense: number }>;
}

async function lerCategorias(
  client: SupabaseClient,
  userId: string,
  desde: string,
  moeda: string
) {
  const { data, error } = await client
    .from("category_monthly_totals")
    .select("month, category_id, expense")
    .eq("user_id", userId)
    .eq("currency", moeda)
    .gte("month", desde);
  if (error) throw error;
  return (data ?? []) as Array<{ month: string; category_id: string | null; expense: number }>;
}

/**
 * As assinaturas que ficaram mais caras e as contas que viraram o mes vencidas.
 *
 * O aumento sai de `detected_recurrences`, que a varredura ja mantem -- nao ha
 * recalculo aqui, pelo mesmo motivo do cabecalho: duas definicoes do mesmo
 * alerta divergem na primeira correcao aplicada em so uma delas.
 */
async function lerExtras(
  client: SupabaseClient,
  userId: string,
  mes: string,
  primeiroDia: string
): Promise<{ assinaturas: AssinaturaQueSubiu[]; vencidas: ContaVencida[] }> {
  const ultimoDia = `${mesSeguinte(mes)}-01`;

  const [recorrencias, contas] = await Promise.all([
    client
      .from("detected_recurrences")
      .select("display_name, avg_amount, last_amount, last_charge_date, status")
      .eq("user_id", userId)
      .neq("status", "IGNORED")
      .gte("last_charge_date", primeiroDia)
      .lt("last_charge_date", ultimoDia),
    client
      .from("scheduled_transactions")
      .select("description, amount, due_date, status")
      .eq("user_id", userId)
      .eq("status", "pending")
      .lt("due_date", ultimoDia)
      // Tudo que virou o mes sem ser pago, inclusive o atrasado de meses
      // anteriores -- e essa e a resposta util a "o que ficou vencido". O teto
      // existe so para a lista nao ser ilimitada; o resumo cita a CONTAGEM e o
      // total, entao o corte aparece nos dois.
      .order("due_date", { ascending: true })
      .limit(200),
  ]);

  if (recorrencias.error) throw recorrencias.error;
  if (contas.error) throw contas.error;

  const assinaturas: AssinaturaQueSubiu[] = [];
  for (const r of (recorrencias.data ?? []) as Array<{
    display_name: string;
    avg_amount: number | string;
    last_amount: number | string | null;
  }>) {
    const media = Math.abs(Number(r.avg_amount ?? 0));
    const ultimo = Math.abs(Number(r.last_amount ?? 0));
    // O mesmo limite do detector (AUMENTO_ALERTA). Nao e recalculo da regra --
    // e o filtro de quais linhas o resumo cita, sobre valores que a varredura
    // ja gravou.
    if (media > 0 && ultimo > media * 1.1) {
      assinaturas.push({ displayName: r.display_name, de: media, para: ultimo });
    }
  }

  const vencidas: ContaVencida[] = (
    (contas.data ?? []) as Array<{ description: string; amount: number | string; due_date: string }>
  ).map((c) => ({
    descricao: c.description,
    valor: Math.abs(Number(c.amount ?? 0)),
    due_date: c.due_date,
  }));

  return { assinaturas, vencidas };
}

/** 'YYYY-MM' do mes seguinte. Aritmetica de string, sem fuso no meio. */
export function mesSeguinte(mes: string): string {
  const ano = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  return m === 12 ? `${ano + 1}-01` : `${ano}-${String(m + 1).padStart(2, "0")}`;
}

const NOMES_DOS_MESES = [
  "janeiro", "fevereiro", "marco", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** 'setembro de 2026'. Sem `toLocaleDateString`: no servidor o fuso nao e o do usuario. */
export function rotuloDoMes(mes: string): string {
  const ano = mes.slice(0, 4);
  const i = Number(mes.slice(5, 7)) - 1;
  return `${NOMES_DOS_MESES[i] ?? mes} de ${ano}`;
}

/**
 * O resumo -> o texto que chega no celular.
 *
 * Uma frase de numero e uma de causa. O corpo cita a categoria que mais cresceu
 * em vez das tres: a bandeja de notificacao corta, e uma lista truncada no meio
 * comunica menos que uma frase inteira. As tres aparecem na tela, onde cabem.
 */
export function textoDoResumo(resumo: ResumoDoMes): { title: string; body: string } {
  const title = `Como foi ${rotuloDoMes(resumo.mes)}`;

  // `formatarValor` na moeda do RESUMO, e nao `formatarBRL`. O resumo e gerado
  // sobre a moeda oficial do usuario (ver `resumoDoUsuario`), entao um resumo em
  // dolar com "R$" na frente seria um numero certo com a unidade errada -- numa
  // notificacao, onde nao ha tela ao lado para desconfiar dele.
  const dinheiro = (valor: number) => formatarValor(Math.abs(valor), resumo.moeda);

  const partes: string[] = [
    `Entrou ${dinheiro(resumo.entrou)} e saiu ${dinheiro(resumo.saiu)}.`,
  ];

  const maior = resumo.crescimentos[0];
  if (maior) {
    partes.push(
      `${maior.rotulo} foi ${dinheiro(maior.excesso)} acima do seu normal.`
    );
  }

  if (resumo.assinaturasQueSubiram.length === 1) {
    partes.push(`${resumo.assinaturasQueSubiram[0].displayName} ficou mais cara.`);
  } else if (resumo.assinaturasQueSubiram.length > 1) {
    partes.push(`${resumo.assinaturasQueSubiram.length} assinaturas ficaram mais caras.`);
  }

  if (resumo.vencidas.length > 0) {
    partes.push(
      `${resumo.vencidas.length} conta(s) viraram o mes vencidas, ${dinheiro(resumo.totalVencido)}.`
    );
  }

  return { title, body: partes.join(" ") };
}

/**
 * A linha de bill_notifications que o cron grava.
 *
 * `summary_month` e `reference_date` recebem o MESMO valor -- o primeiro dia do
 * mes fechado. A redundancia e consciente: `reference_date` e NOT NULL desde a
 * 009 e e por ela que a tela ordena o sino; `summary_month` e a coluna que
 * entra no indice unico do 017, e e ela que impede o resumo de sair duas vezes.
 * Ver o cabecalho da 017 para por que a chave nao pode ser `reference_date`.
 */
export function linhaDoResumo(userId: string, resumo: ResumoDoMes) {
  const { title, body } = textoDoResumo(resumo);
  const primeiroDia = `${resumo.mes}-01`;
  return {
    user_id: userId,
    kind: KIND_RESUMO,
    reference_date: primeiroDia,
    summary_month: primeiroDia,
    title,
    body,
    channel: "inapp" as const,
  };
}
