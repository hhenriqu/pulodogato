// GET /api/cron/cotacoes   busca o preco dos ativos da carteira (uma vez por dia)
//
// HMO-191, entrega 1 da HMO-141. Ate aqui `investment_assets.current_price` so
// tinha uma origem: o usuario digitando o numero. A 021 ja previa este dia --
// "quando houver fonte de cotacao, ela passa a escrever nessa mesma coluna e
// nada mais muda". E isto: nao muda schema de `investment_assets`, nao muda
// tela, muda QUEM preenche as duas colunas.
//
// Agendado em vercel.json para 23:00 UTC de segunda a sexta = 20:00 em
// Brasilia. O plano Hobby tem +-59 min de folga, entao a janela real e
// 19:01-20:59 BRT -- inteira depois do fechamento da B3, que e 17:00 BRT e vai
// a 18:00 BRT quando os EUA estao no horario de verao. Nao ha nenhum ponto da
// janela em que o pregao ainda esteja aberto, e por isso nao importa a ordem
// desta execucao em relacao aos outros quatro jobs (ver o cabecalho da 019).
//
// Segunda a sexta e nao todo dia porque no fim de semana o preco e o mesmo de
// sexta: duas chamadas por ticker por semana sem numero novo, saindo da mesma
// cota de 15.000/mes que limita o tamanho da carteira atendida.
//
// A COTACAO ATRASA ~30 MIN, E TUDO BEM
// ------------------------------------
// O plano gratuito da brapi serve preco com atraso. Para carteira de longo
// prazo -- que e o que esta tela acompanha -- 30 minutos nao mudam decisao
// nenhuma, e rodando depois do fechamento o atraso nem existe: o preco de
// fechamento ja esta consolidado. Nao ha nada a compensar aqui.
//
// POR QUE ESTA ROTA PRECISA DA service_role
// -----------------------------------------
// Mesma razao do bill-alerts: o cron roda sem usuario logado e precisa
// enxergar (e escrever) o ativo de TODOS. Com a chave anon a RLS da 021
// devolveria zero linhas e o job sairia verde sem atualizar ninguem.
//
// O TETO DE CHAMADAS E UMA DECISAO DE ORCAMENTO
// ---------------------------------------------
// 15.000 requisicoes/mes no gratuito, uma por ticker. `TETO_DE_CHAMADAS_POR_
// EXECUCAO` em lib/cotacao-brapi.ts tem a conta. O que nao coube hoje e o
// primeiro da fila amanha, porque a fila e ordenada por quem esta ha mais tempo
// sem preco.
//
// O QUE ESTA ROTA NUNCA FAZ: APAGAR PRECO
// ---------------------------------------
// Ticker que a brapi nao conhece, fonte fora do ar, cota estourada -- nenhum
// desses escreve. A linha fica com o preco antigo e a DATA antiga, e a tela
// mostra de quando e o numero (`current_price_at` existe justamente para isso).
// Preco velho e datado e honesto; preco apagado vira "posicao pelo custo" e
// parece que o usuario perdeu o que tinha lancado.
//
// PROTECAO
// --------
// `CRON_SECRET` no header Authorization, igual aos outros quatro jobs. Sem ele,
// qualquer um na internet queimaria a cota mensal da brapi em uma tarde -- nao
// vaza dado (a resposta e so contagem), mas deixa a carteira de todo mundo sem
// cotacao ate o dia 1.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { comRegistro } from "@/lib/services/cron-ledger";
import {
  atualizacaoDePreco,
  montarFila,
  motivoDoStatus,
  precoDaResposta,
  urlDaCotacao,
  MOEDA_COTADA,
  TETO_DE_CHAMADAS_POR_EXECUCAO,
  TIPOS_COTADOS,
  type AtivoNoBanco,
  type FalhaDaCotacao,
  type SimboloNaFila,
} from "@/lib/cotacao-brapi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Quantas cotacoes em voo ao mesmo tempo. */
const PARALELISMO = 6;

/** Teto por chamada. A brapi normalmente responde em menos de 1s. */
const TIMEOUT_POR_CHAMADA_MS = 8000;

/**
 * Quando parar de abrir chamada nova.
 *
 * `maxDuration` e 60s e a Vercel corta a funcao SEM resposta quando estoura --
 * e uma funcao cortada nao grava a linha do livro-razao, entao a execucao
 * sumiria. Parando aos 40s sobra tempo para escrever o que ja foi cotado, para
 * fechar a conta e para responder. O que nao coube vira `nao_cotados` no
 * resumo, e nao silencio.
 */
const PRAZO_PARA_ABRIR_CHAMADA_MS = 40_000;

interface Desfecho {
  symbol: string;
  atualizacao?: { current_price: number; current_price_at: string };
  falha?: { motivo: FalhaDaCotacao; detalhe: string };
}

export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const brapiToken = process.env.BRAPI_TOKEN;

  const faltando = [
    !segredo && "CRON_SECRET",
    !url && "NEXT_PUBLIC_SUPABASE_URL",
    !serviceRole && "SUPABASE_SERVICE_ROLE_KEY",
    !brapiToken && "BRAPI_TOKEN",
  ].filter(Boolean);

  if (faltando.length) {
    return NextResponse.json(
      {
        error: `Cotacao automatica nao configurada. Faltam: ${faltando.join(", ")}.`,
        hint: "Project Settings → Environment Variables, escopo Production. O BRAPI_TOKEN sai de brapi.dev (plano gratuito).",
      },
      { status: 503 }
    );
  }

  // A Vercel manda `Authorization: Bearer <CRON_SECRET>` nos crons do projeto.
  // Este guard responde ANTES de tocar no banco: um 401 aqui nao diz nada sobre
  // o estado do schema (ver o cabecalho de scripts/verify-crons.sh).
  const enviado = request.headers.get("authorization");
  if (enviado !== `Bearer ${segredo}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const env = { url: url as string, serviceRole: serviceRole as string };
  const token = brapiToken as string;

  const saida = await comRegistro("cotacoes", env, async () => {
    const admin = createClient(env.url, env.serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: ativos, error } = await admin
      .from("investment_assets")
      .select("symbol, type, currency, current_price_at");

    if (error) {
      console.error("Cron cotacoes: erro ao ler investment_assets:", error);
      return { status: 500, body: { error: "Falha ao ler a carteira" } };
    }

    const linhas = (ativos ?? []) as AtivoNoBanco[];
    const fila = montarFila(linhas, TETO_DE_CHAMADAS_POR_EXECUCAO);

    // Quantos simbolos eram elegiveis antes do teto -- sem isso "cotei 300" nao
    // se distingue de "a carteira tem 300".
    const elegiveis = montarFila(linhas, Number.MAX_SAFE_INTEGER).length;

    if (fila.length === 0) {
      return {
        status: 200,
        body: {
          ok: true,
          linhas: linhas.length,
          simbolos: 0,
          cotados: 0,
          atualizados: 0,
          desconhecidos: 0,
          falhas: 0,
          nao_cotados: 0,
        },
      };
    }

    const inicio = Date.now();
    const desfechos = await cotarTudo(fila, token, inicio);
    const cotados = desfechos.filter((d) => d.atualizacao).length;

    const escrita = await gravarPrecos(admin, desfechos);

    const porMotivo: Record<string, number> = {};
    for (const d of desfechos) {
      if (d.falha) porMotivo[d.falha.motivo] = (porMotivo[d.falha.motivo] ?? 0) + 1;
    }

    // QUANDO O JOB TEM QUE SE DECLARAR QUEBRADO
    // -----------------------------------------
    // `cotados === 0` com fila cheia pode ter duas causas de naturezas opostas:
    // ou os tickers que o usuario cadastrou nao existem (dado ruim, ninguem
    // aqui pode consertar), ou a chave venceu / a cota estourou / a brapi caiu
    // (configuracao, e o dono conserta em um minuto).
    //
    // No segundo caso o 200 seria a pior resposta possivel: `cron_runs` gravaria
    // `status = 'ok'` com contadores zerados, que e EXATAMENTE a assinatura do
    // dia ocioso legitimo -- e a 019 existe para que dia ocioso e job quebrado
    // nao se confundam. Entao a causa de infraestrutura devolve 500, o
    // livro-razao grava `error` e a Vercel mostra o job em vermelho.
    const infra =
      (porMotivo["credencial_recusada"] ?? 0) +
      (porMotivo["limite_atingido"] ?? 0) +
      (porMotivo["fonte_indisponivel"] ?? 0);

    if (cotados === 0 && infra > 0) {
      const detalhe = desfechos.find((d) => d.falha?.motivo === "credencial_recusada")
        ? "BRAPI_TOKEN recusado pela brapi (ausente, invalido ou revogado)"
        : porMotivo["limite_atingido"]
          ? "cota mensal da brapi esgotada"
          : "a brapi nao respondeu";

      console.error(`Cron cotacoes: nenhuma cotacao obtida -- ${detalhe}`);
      return {
        status: 500,
        body: {
          error: `Nenhuma cotacao obtida: ${detalhe}`,
          simbolos: fila.length,
          por_motivo: porMotivo,
          // Nada foi escrito, entao nenhum preco antigo foi perdido.
          atualizados: escrita.linhas,
        },
      };
    }

    return {
      status: 200,
      body: {
        ok: true,
        linhas: linhas.length,
        simbolos: fila.length,
        cotados,
        // Linhas de `investment_assets` efetivamente escritas. Este e o numero
        // que prova que o CHECK do par nao recusou nada: `cotados` conta
        // respostas boas da brapi, `atualizados` conta o que o banco aceitou.
        // Os dois divergirem e o sintoma do 23514.
        atualizados: escrita.linhas,
        desconhecidos: porMotivo["desconhecido"] ?? 0,
        falhas: desfechos.length - cotados - (porMotivo["desconhecido"] ?? 0),
        por_motivo: porMotivo,
        nao_cotados: Math.max(0, elegiveis - fila.length),
        erros_de_escrita: escrita.erros,
      },
    };
  });

  return NextResponse.json(saida.body, { status: saida.status });
}

/** Roda a fila com paralelismo limitado, respeitando o prazo da funcao. */
async function cotarTudo(
  fila: readonly SimboloNaFila[],
  token: string,
  inicio: number
): Promise<Desfecho[]> {
  const desfechos: Desfecho[] = [];
  let proximo = 0;

  async function trabalhador() {
    for (;;) {
      const i = proximo++;
      if (i >= fila.length) return;

      if (Date.now() - inicio > PRAZO_PARA_ABRIR_CHAMADA_MS) {
        desfechos.push({
          symbol: fila[i].symbol,
          falha: { motivo: "fonte_indisponivel", detalhe: "prazo da execucao esgotado" },
        });
        continue;
      }

      desfechos.push(await cotarUm(fila[i].symbol, token));
    }
  }

  await Promise.all(Array.from({ length: Math.min(PARALELISMO, fila.length) }, trabalhador));
  return desfechos;
}

/** Uma cotacao. Nunca lanca: a falha de um ticker nao pode derrubar os outros. */
async function cotarUm(symbol: string, token: string): Promise<Desfecho> {
  try {
    const resposta = await fetch(urlDaCotacao(symbol), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_POR_CHAMADA_MS),
      cache: "no-store",
    });

    if (!resposta.ok) {
      return {
        symbol,
        falha: { motivo: motivoDoStatus(resposta.status), detalhe: `HTTP ${resposta.status}` },
      };
    }

    const bruto: unknown = await resposta.json();
    const leitura = precoDaResposta(bruto, symbol);

    if (!leitura.ok) {
      return { symbol, falha: { motivo: leitura.motivo, detalhe: leitura.detalhe } };
    }

    // O par completo nasce aqui e em nenhum outro lugar.
    return { symbol, atualizacao: atualizacaoDePreco(leitura.preco, new Date()) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { symbol, falha: { motivo: "fonte_indisponivel", detalhe: msg } };
  }
}

/**
 * Escreve os precos. Um UPDATE por simbolo, atingindo a linha de todos os
 * usuarios que tem aquele ticker.
 *
 * Os filtros de `type` e `currency` repetem a regra de `montarFila` DE
 * PROPOSITO. A fila foi montada a partir de uma leitura anterior; entre ela e
 * este UPDATE alguem pode ter cadastrado um `international` com o mesmo ticker,
 * e sem o filtro o preco em reais cairia nessa linha. Filtrar na escrita e o
 * que torna isso impossivel, e nao apenas improvavel.
 */
async function gravarPrecos(
  admin: SupabaseClient,
  desfechos: readonly Desfecho[]
): Promise<{ linhas: number; erros: number }> {
  const aGravar = desfechos.filter(
    (d): d is Desfecho & { atualizacao: NonNullable<Desfecho["atualizacao"]> } =>
      d.atualizacao !== undefined
  );

  let linhas = 0;
  let erros = 0;
  let proximo = 0;

  async function trabalhador() {
    for (;;) {
      const i = proximo++;
      if (i >= aGravar.length) return;
      const { symbol, atualizacao } = aGravar[i];

      const { data, error } = await admin
        .from("investment_assets")
        .update(atualizacao)
        .eq("symbol", symbol)
        .eq("currency", MOEDA_COTADA)
        .in("type", Array.from(TIPOS_COTADOS))
        .select("id");

      if (error) {
        // O 23514 cai aqui. Ele nao pode passar em silencio: e a falha que
        // deixa o job devolvendo 200 com a carteira intacta.
        console.error(`Cron cotacoes: UPDATE de ${symbol} recusado:`, error.message);
        erros++;
        continue;
      }

      linhas += (data ?? []).length;
    }
  }

  await Promise.all(Array.from({ length: Math.min(PARALELISMO, aGravar.length) }, trabalhador));
  return { linhas, erros };
}
