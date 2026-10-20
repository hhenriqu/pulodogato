// =====================================================
// QUANTO A CARTEIRA ATRELADA VALE, POR CONTA (HMO-437)
// =====================================================
// O patrimonio precisa de um numero que nenhuma tabela guarda: o que a carteira
// atrelada a cada conta de investimento vale HOJE. Montar esse numero exige
// quatro ingredientes que moram em quatro lugares:
//
//   1. os ativos e o elo `account_id` (migration 059);
//   2. os lancamentos, para o custo medio (`lib/investments.ts`);
//   3. a serie diaria do indexador (`lib/cdi.ts`, o unico que fala com o Banco
//      Central);
//   4. a projecao do rendimento (`lib/renda-fixa.ts`).
//
// Este arquivo e o RECORTE -- ele busca e encaminha. Nenhuma aritmetica de
// dinheiro mora aqui: `principal + bruto` e `valorDeMercado`, a soma por conta e
// `valorDaCarteiraPorConta`, e as duas tem suite propria que compara numero com
// numero. Uma terceira implementacao aqui dentro e exatamente como nascem duas
// telas que discordam.
//
// POR QUE ELE NAO DERRUBA A ROTA, NUNCA
// -------------------------------------
// `GET /api/net-worth` responde "quanto eu tenho hoje", e essa pergunta tem
// resposta mesmo sem o Banco Central e mesmo sem a 059 colada. Toda falha aqui
// devolve `{ ok: false }` com o motivo e a rota segue com o patrimonio de antes
// desta fase -- o mesmo desenho que a linha do tempo da rota ja usa (o enfeite
// degrada, a tela nao cai).
//
// Tres falhas distintas, de proposito:
//
//   schema          o `select` nomeia `account_id`, e num banco sem a 059 isso
//                   responde 42703 (`column does not exist`). Deploy publica
//                   codigo, nao schema, e a colagem e a mao -- a janela entre os
//                   dois existe e ja derrubou rota neste repo (HMO-431);
//   leitura         erro de permissao ou de rede nas duas tabelas;
//   vazia           nao ha ativo nenhum. Nao e erro: e o estado de quem nunca
//                   usou a carteira, e a rota tem de responder igual a antes.
//
// A INDISPONIBILIDADE DO SGS NAO E FALHA DESTE MODULO
// ---------------------------------------------------
// Sem boletim, `projetarRendimento` devolve `motivo: "indisponivel"` e
// `valorDeMercado` avalia a posicao PELO CUSTO. O patrimonio continua saindo --
// sem o rendimento do dia, e com `indexadoresSemBoletim` dizendo quais papeis
// estao nessa condicao para a rota avisar. Zerar a carteira nesse caso faria o
// patrimonio desabar porque uma API nao respondeu.
//
// E NAO SE FALA COM O BANCO CENTRAL FORA DE lib/cdi.ts: fim de semana volta 404
// e nao lista vazia (o inverso do PTAX), e preencher o buraco com zero inventa
// dia util. `serieDoPeriodo` sempre pede FAIXA, e e por isso que sabado nao
// aparece como falha.
//
// O PAR DESTE ARQUIVO E app/api/investments/renda-fixa/route.ts
// ------------------------------------------------------------
// Aquela rota faz a mesma busca para montar o card de renda fixa, com um
// recorte a mais (`?account_id=`) e uma resposta por ATIVO em vez de por conta.
// As duas leituras nao podem divergir em dinheiro, e e por isso que as duas
// chamam `projetarRendimento` com os mesmos ingredientes e nenhuma das duas
// soma nada por conta propria. Unificar a BUSCA tambem e trabalho da fase 4,
// que e quando as duas respostas aparecem na mesma tela.
// =====================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calcularPosicoes,
  valorDaCarteiraPorConta,
  type AtivoBruto,
  type CarteiraDaConta,
  type LancamentoBruto,
} from "@/lib/investments";
import {
  indexadorValido,
  primeiraCompraPorAtivo,
  projetarRendimento,
  valorProjetadoPorAtivo,
  type DiaDaSerie,
  type Projecao,
} from "@/lib/renda-fixa";
import { hojeEmBrasilia, serieDoPeriodo } from "@/lib/cdi";

/** Por que a carteira nao entrou no patrimonio. */
export type MotivoSemCarteira = "schema" | "leitura" | "vazia";

export interface CarteiraDoPatrimonio {
  /** Uma linha por conta de investimento com ativo atrelado. */
  porConta: CarteiraDaConta[];
  /** A carteira que nao esta atrelada a conta nenhuma. `null` quando nao ha. */
  solta: CarteiraDaConta | null;
  /** "YYYY-MM-DD" em Brasilia -- o dia em que a projecao parou de contar. */
  hoje: string;
  /** Indexadores cujo boletim nao veio: os papeis deles valem o custo. */
  indexadoresSemBoletim: string[];
  /** Quantas posicoes de renda fixa entraram SEM rendimento. */
  semRendimento: number;
  /** Quantas posicoes de outro tipo entraram avaliadas pelo custo. */
  semPreco: number;
}

export type LeituraDaCarteira =
  | { ok: true; carteira: CarteiraDoPatrimonio }
  | { ok: false; motivo: MotivoSemCarteira };

/**
 * A carteira do usuario somada por conta de investimento.
 *
 * `supabase` e o cliente da REQUISICAO (com a sessao do usuario): o recorte por
 * dono e a RLS mais o `eq("user_id")`, nunca so um dos dois.
 */
export async function lerCarteiraDoPatrimonio(
  supabase: SupabaseClient,
  userId: string,
  hojeISO: string = hojeEmBrasilia()
): Promise<LeituraDaCarteira> {
  // TODOS os tipos de ativo, e nao so `fixed_income`.
  //
  // A conta de investimento com uma PETR4 atrelada deixa de contar o saldo
  // digitado (porque ela TEM ativo atrelado, pela Decisao 1A) -- se a leitura
  // trouxesse so renda fixa, o valor da acao nao entraria em lugar nenhum e o
  // patrimonio cairia pelo valor dela, sem erro e sem linha para auditar.
  //
  // Uma linha so, sem concatenacao: o supabase-js le esta string em tempo de
  // TIPO, e `"a, b" + "c"` nao e literal.
  // prettier-ignore
  const { data: ativos, error: erroAtivos } = await supabase
    .from("investment_assets")
    .select("id, symbol, name, type, currency, current_price, current_price_at, account_id, fixed_income_product, index_kind, index_percentage, spread_annual, applied_date, maturity_date")
    .eq("user_id", userId);

  if (erroAtivos) {
    // 42703 = `column does not exist`: o banco ainda nao recebeu a 059. E o
    // unico erro aqui que NAO e defeito -- e a janela entre o deploy e a
    // colagem, e nela a resposta certa e "sem carteira", nao 500.
    const motivo: MotivoSemCarteira =
      erroAtivos.code === "42703" ? "schema" : "leitura";
    console.error(
      `Patrimônio: carteira indisponível (${motivo}), seguindo só com os saldos:`,
      erroAtivos
    );
    return { ok: false, motivo };
  }

  const listaAtivos = (ativos || []) as Array<
    AtivoBruto & {
      account_id: string | null;
      fixed_income_product: string | null;
      index_kind: string | null;
      index_percentage: number | string | null;
      spread_annual: number | string | null;
      applied_date: string | null;
      maturity_date: string | null;
    }
  >;

  if (listaAtivos.length === 0) return { ok: false, motivo: "vazia" };

  const { data: lancamentos, error: erroLancamentos } = await supabase
    .from("investment_transactions")
    .select("asset_id, kind, quantity, unit_price, fees, trade_date")
    .eq("user_id", userId)
    .in(
      "asset_id",
      listaAtivos.map((a) => a.id)
    )
    .order("trade_date", { ascending: true });

  if (erroLancamentos) {
    console.error(
      "Patrimônio: lançamentos da carteira indisponíveis, seguindo só com os saldos:",
      erroLancamentos
    );
    return { ok: false, motivo: "leitura" };
  }

  const listaLancamentos = (lancamentos || []) as LancamentoBruto[];

  const posicoes = calcularPosicoes(
    listaAtivos as AtivoBruto[],
    listaLancamentos
  );
  const principalPorAtivo: Record<string, number> = {};
  for (const p of posicoes) principalPorAtivo[p.asset_id] = p.total_invested;

  const primeiraCompra = primeiraCompraPorAtivo(
    listaLancamentos as Array<{
      asset_id: string;
      kind: string;
      trade_date: string;
    }>
  );

  const deRendaFixa = listaAtivos.filter((a) => a.type === "fixed_income");

  // Uma requisicao por INDEXADOR, nao por ativo: cinco CDBs de CDI pedem a
  // mesma serie 12, e cinco respostas de instantes diferentes somariam
  // rendimentos de dias diferentes. A borda esquerda da faixa e a aplicacao
  // mais antiga do grupo; `diasNoPeriodo` recorta o resto por ativo.
  const inicioPorIndexador: Record<string, string> = {};
  for (const a of deRendaFixa) {
    const ix = indexadorValido(a.index_kind);
    if (!ix) continue;
    const inicio = a.applied_date || primeiraCompra[a.id] || null;
    if (!inicio) continue;
    const atual = inicioPorIndexador[ix];
    if (!atual || inicio < atual) inicioPorIndexador[ix] = inicio;
  }

  const serieDoIndexador: Record<string, DiaDaSerie[]> = {};
  const indexadoresSemBoletim: string[] = [];
  // `Object.keys` e nao `for...of` em entries: o target do tsconfig deste
  // projeto e anterior ao ES2017.
  for (const ix of Object.keys(inicioPorIndexador)) {
    const r = await serieDoPeriodo(ix, inicioPorIndexador[ix], hojeISO);
    if (r.ok) serieDoIndexador[ix] = r.serie;
    else indexadoresSemBoletim.push(ix);
  }

  const projecoes: Projecao[] = deRendaFixa.map((ativo) => {
    const ix = indexadorValido(ativo.index_kind);
    return projetarRendimento({
      ativo,
      principal: principalPorAtivo[ativo.id] ?? 0,
      serie: ix ? serieDoIndexador[ix] || [] : [],
      primeiraCompra: primeiraCompra[ativo.id] || null,
      hoje: hojeISO,
    });
  });

  const contaPorAtivo: Record<string, string | null> = {};
  for (const a of listaAtivos) contaPorAtivo[a.id] = a.account_id ?? null;

  const linhas = valorDaCarteiraPorConta(
    posicoes,
    contaPorAtivo,
    valorProjetadoPorAtivo(projecoes)
  );

  const porConta = linhas.filter((l) => l.account_id !== null);
  const solta = linhas.filter((l) => l.account_id === null)[0] ?? null;

  const somar = (campo: "semRendimento" | "semPreco") =>
    linhas.reduce((s, l) => s + l[campo], 0);

  return {
    ok: true,
    carteira: {
      porConta,
      solta,
      hoje: hojeISO,
      indexadoresSemBoletim,
      semRendimento: somar("semRendimento"),
      semPreco: somar("semPreco"),
    },
  };
}
