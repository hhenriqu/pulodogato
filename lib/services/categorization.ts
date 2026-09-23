// =====================================================
// CATEGORIZACAO - a camada que toca o banco
// =====================================================
// lib/categorization.ts decide; este arquivo le e grava. A separacao existe
// pelo mesmo motivo do recurrence-scan: a decisao precisa ser testavel sem
// banco, e o banco precisa de um lugar so.
//
// Os tres consumidores desta camada -- a listagem de linhas do extrato (que
// SUGERE), a importacao de uma linha (que APLICA e APRENDE) e a importacao em
// lote (que aplica muitas) -- tem que concordar sobre o que e uma regra e sobre
// quando uma regra vale. Se cada rota lesse a tabela do seu jeito, a sugestao
// mostrada na tela poderia diferir da categoria efetivamente gravada no clique
// seguinte, e as duas pareceriam certas.
// =====================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  chaveDaDescricao,
  regraQueCobre,
  sugerirCategoria,
  type CategoriaConhecida,
  type RegraCategorizacao,
  type Sugestao,
} from "@/lib/categorization";

/**
 * Teto de regras lidas de uma vez.
 *
 * O PostgREST limita a resposta de qualquer jeito; o numero existe para que
 * isso seja uma decisao escrita e nao um default silencioso. Mil regras e mais
 * estabelecimentos distintos do que um extrato pessoal produz em anos.
 */
export const MAX_REGRAS = 1000;

/** As categorias que existem NESTE banco. */
export async function lerCategorias(
  supabase: SupabaseClient
): Promise<CategoriaConhecida[]> {
  const { data, error } = await supabase
    .from("transaction_categories")
    .select("id, name, is_expense")
    .eq("is_active", true);

  if (error) throw new Error(`Erro ao ler categorias: ${error.message}`);

  return (data || []).map((c) => ({
    id: c.id,
    name: c.name,
    isExpense: Boolean(c.is_expense),
  }));
}

/** As regras do usuario, ativas e desligadas -- o filtro de ativa mora na decisao. */
export async function lerRegras(
  supabase: SupabaseClient,
  userId: string
): Promise<RegraCategorizacao[]> {
  const { data, error } = await supabase
    .from("categorization_rules")
    .select("id, merchant_key, display_name, category_id, is_active")
    .eq("user_id", userId)
    .order("times_applied", { ascending: false })
    .limit(MAX_REGRAS);

  if (error) throw new Error(`Erro ao ler regras: ${error.message}`);

  return (data || []).map((r) => ({
    id: r.id,
    merchantKey: r.merchant_key,
    displayName: r.display_name,
    categoryId: r.category_id,
    isActive: Boolean(r.is_active),
  }));
}

/**
 * O que a camada de decisao precisa, ou o aviso de que ela nao esta disponivel.
 *
 * `disponivel: false` nao e "o usuario nao tem regra" -- e "nao deu para
 * perguntar". Os dois produzem zero sugestoes, e sem o campo a tela contaria a
 * mesma historia nos dois casos.
 */
interface InsumosDaSugestao {
  categorias: CategoriaConhecida[];
  regras: RegraCategorizacao[];
  disponivel: boolean;
}

/**
 * Le categorias e regras SEM LANCAR.
 *
 * A sugestao de categoria decora a tela de extrato; ela nao e a tela. Uma falha
 * aqui -- tabela ausente porque a migration 014 ainda nao rodou naquele banco,
 * RLS, rede -- nao pode derrubar a listagem das linhas nem a conciliacao, que
 * funcionavam antes desta feature existir e nao dependem dela.
 *
 * E a mesma regra que `aprenderRegra` ja seguia do outro lado: o aprendizado
 * nao derruba um lancamento. Faltava aplica-la na LEITURA -- e era por ali que
 * a tela caia inteira, com um 500 generico que nao dizia qual das duas
 * consultas falhou.
 *
 * Degradar nao e engolir: a falha vai para o log com a causa, e quem chama
 * recebe `disponivel: false` para poder dizer isso na resposta.
 */
async function lerInsumos(
  supabase: SupabaseClient,
  userId: string
): Promise<InsumosDaSugestao> {
  try {
    const [categorias, regras] = await Promise.all([
      lerCategorias(supabase),
      lerRegras(supabase, userId),
    ]);
    return { categorias, regras, disponivel: true };
  } catch (erro) {
    console.error(
      "Sugestao de categoria indisponivel (a tela de extrato segue sem ela):",
      erro
    );
    return { categorias: [], regras: [], disponivel: false };
  }
}

export interface SugestoesDasLinhas {
  /** Linha -> sugestao. Vazio quando nao ha o que sugerir OU quando `disponivel` e false. */
  porLinha: Map<string, Sugestao>;
  /** false = nao deu para consultar regras/categorias. Ver `lerInsumos`. */
  disponivel: boolean;
}

/**
 * Sugestao para uma lista de linhas, com UMA leitura de regras e UMA de
 * categorias.
 *
 * Em lote de proposito: a tela de extrato abre com dezenas de linhas
 * pendentes, e uma consulta por linha faria dezenas de viagens ao banco a cada
 * abertura. O custo aparece como lentidao, nao como erro, que e o tipo de
 * problema que ninguem atribui a causa certa.
 *
 * NAO LANCA -- ver `lerInsumos`.
 */
export async function sugerirParaLinhas(
  supabase: SupabaseClient,
  userId: string,
  linhas: Array<{ id: string; description: string; amount: number | string }>
): Promise<SugestoesDasLinhas> {
  if (linhas.length === 0) return { porLinha: new Map(), disponivel: true };

  const { categorias, regras, disponivel } = await lerInsumos(supabase, userId);
  const porLinha = new Map<string, Sugestao>();

  if (!disponivel) return { porLinha, disponivel };

  for (const linha of linhas) {
    // `numeric` chega como STRING no supabase-js. Converter na fronteira, e nao
    // no uso, pelo mesmo motivo do recurrence-scan: a peneira do sinal faz
    // comparacao numerica, e `"-52.90" < 0` so funciona por coercao acidental.
    const s = sugerirCategoria(linha.description, Number(linha.amount), regras, categorias);
    if (s) porLinha.set(linha.id, s);
  }

  return { porLinha, disponivel };
}

/**
 * A regra que decide a categoria de UMA linha na importacao, ou `null`.
 *
 * NAO LANCA, pelo mesmo motivo. Sem regra disponivel a rota cai no 400
 * "escolha uma categoria" -- que e exatamente como a importacao se comportava
 * antes desta feature. Deixar a excecao subir trocaria esse 400 acionavel por
 * um 500 que nao diz o que fazer.
 */
export async function regraParaLinha(
  supabase: SupabaseClient,
  userId: string,
  descricao: string,
  valor: number
): Promise<Sugestao | null> {
  const { categorias, regras, disponivel } = await lerInsumos(supabase, userId);
  if (!disponivel) return null;

  const sugestao = sugerirCategoria(descricao, valor, regras, categorias);

  // So REGRA aplica sozinha. O catalogo embutido e chute nosso e precisa do
  // clique do usuario -- ver o comentario da rota de importacao da linha.
  return sugestao?.origin === "rule" ? sugestao : null;
}

export interface ResultadoAprendizado {
  /** 'created' = nasceu regra nova; 'reused' = ja havia regra cobrindo; 'skipped' = nao deu para gravar. */
  outcome: "created" | "reused" | "skipped";
  ruleId?: string;
  merchantKey?: string;
}

/**
 * Grava (ou reaproveita) a regra que corresponde a uma escolha manual.
 *
 * Chamado quando o usuario importa uma linha escolhendo a categoria. A proxima
 * linha do mesmo estabelecimento ja nasce categorizada -- que e a feature
 * inteira.
 *
 * NAO LANCA. O aprendizado e um efeito secundario da importacao: se ele falhar,
 * o lancamento do usuario ja nasceu e nao pode ser desfeito por causa disso. O
 * pior resultado aceitavel aqui e "a proxima vez ele escolhe de novo".
 *
 * A protecao da escolha manual mora no `ON CONFLICT`: uma regra ja existente
 * com `source = 'manual'` nao e sobrescrita pelo aprendizado. Ver a SECAO 2 da
 * migration 014.
 */
export async function aprenderRegra(
  supabase: SupabaseClient,
  userId: string,
  descricao: string,
  categoryId: string
): Promise<ResultadoAprendizado> {
  try {
    const merchantKey = chaveDaDescricao(descricao);

    // A migration tem CHECK (length(trim(merchant_key)) > 0) e a chave vazia
    // casaria com tudo. Sem regra, sem problema -- o usuario continua
    // escolhendo a mao para esta descricao.
    if (!merchantKey) return { outcome: "skipped" };

    const regras = await lerRegras(supabase, userId);
    const jaCobre = regraQueCobre(descricao, regras);

    // Ja existe regra ativa cobrindo este lojista.
    if (jaCobre) {
      // Se ela aponta para a MESMA categoria, nao ha o que aprender: so conta
      // mais uma aplicacao. Se aponta para OUTRA, o usuario acabou de
      // contradizer a propria regra nesta linha -- e uma escolha pontual, nao
      // necessariamente uma mudanca de regra, entao a regra fica como esta.
      // Trocar a categoria dela aqui faria uma excecao reescrever o padrao.
      if (jaCobre.categoryId === categoryId) {
        await registrarAplicacao(supabase, jaCobre.id);
      }
      return { outcome: "reused", ruleId: jaCobre.id, merchantKey: jaCobre.merchantKey };
    }

    const { data, error } = await supabase
      .from("categorization_rules")
      .upsert(
        {
          user_id: userId,
          merchant_key: merchantKey,
          // A pessoa reconhece "IFD*IFOOD 3947", nao "ifd ifood". Guardar o
          // texto do extrato e o que torna a tela de regras legivel.
          display_name: descricao.slice(0, 200),
          category_id: categoryId,
          source: "learned",
          times_applied: 1,
          last_applied_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id,merchant_key",
          // A regra existente vence. Chegar aqui significa que ela estava
          // DESLIGADA (senao `regraQueCobre` teria pego): o usuario desligou de
          // proposito, e o aprendizado nao pode religar.
          ignoreDuplicates: true,
        }
      )
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("Aprendizado de regra falhou (o lancamento foi criado assim mesmo):", error);
      return { outcome: "skipped" };
    }

    // `maybeSingle` com ignoreDuplicates devolve null quando o conflito barrou
    // a insercao -- nao e erro, e a regra desligada se defendendo.
    if (!data) return { outcome: "skipped", merchantKey };

    return { outcome: "created", ruleId: data.id, merchantKey };
  } catch (erro) {
    console.error("Aprendizado de regra falhou (o lancamento foi criado assim mesmo):", erro);
    return { outcome: "skipped" };
  }
}

/**
 * Conta mais uma aplicacao de uma regra.
 *
 * Nao lanca, pelo mesmo motivo do aprendizado: o contador e informativo (a tela
 * ordena por ele), e perder uma contagem nao pode derrubar a importacao de um
 * lancamento de verdade.
 *
 * O incremento e lido-e-gravado, e nao um `UPDATE ... SET x = x + 1`: o
 * supabase-js nao expressa incremento atomico sem uma funcao no banco, e criar
 * uma RPC para um contador de tela nao se paga. A corrida possivel (duas
 * importacoes simultaneas do mesmo usuario) perde uma contagem; nenhum dinheiro
 * depende deste numero.
 */
export async function registrarAplicacao(
  supabase: SupabaseClient,
  ruleId: string
): Promise<void> {
  try {
    const { data } = await supabase
      .from("categorization_rules")
      .select("times_applied")
      .eq("id", ruleId)
      .maybeSingle();

    if (!data) return;

    await supabase
      .from("categorization_rules")
      .update({
        times_applied: Number(data.times_applied) + 1,
        last_applied_at: new Date().toISOString(),
      })
      .eq("id", ruleId);
  } catch (erro) {
    console.error("Nao foi possivel contar a aplicacao da regra:", erro);
  }
}
