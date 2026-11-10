/**
 * ACESSO PELO CLAUDE -- as ferramentas do servidor MCP.
 *
 * Cada ferramenta recebe a sessao DA PROPRIA PESSOA (`sessaoDaPessoa`) e so
 * faz o que a tela faria: le pela RLS, grava pela RLS.
 *
 * DE ONDE VEM CADA REGRA, PARA NAO VIRAR UMA SEGUNDA COPIA
 *   - despesa e receita avulsas: a mesma linha que `FormularioDeLancamento`
 *     grava direto pelo supabase-js, com o sinal de `valorGravado`;
 *   - compra parcelada: chama a PROPRIA rota `POST /api/financial-installments`
 *     com a sessao da pessoa -- a serie, o arredondamento e a fatura de cada
 *     parcela continuam com um dono so (`serieDeParcelas`);
 *   - nome das categorias: `categoriaEfetiva`, que aplica o apelido da pessoa;
 *   - fatura aberta do cartao: a RPC `card_invoice_month`, a mesma da rota.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  acharPorNome,
  dataValida,
  fraseDoNaoAchado,
  hojeEmSaoPaulo,
  normalizarNome,
  valorEmReais,
} from "@/lib/acesso-pelo-claude";
import { categoriaEfetiva, type Categoria, type PreferenciaDeCategoria } from "@/lib/categorias";
import { valorGravado, type TipoLancamento } from "@/lib/lancamento";
import {
  ROTULO_TIPO,
  lancadoEmReais,
  posicoesAbertas,
  projecaoQueVale,
  valorDaCarteiraPorConta,
  type AssetType,
  type Posicao,
} from "@/lib/investments";
import { comporConsolidado, type RendaFixaDaRota } from "@/lib/carteira-na-tela";
import { valorProjetadoPorAtivo } from "@/lib/renda-fixa";
import type { SessaoDaPessoa } from "@/lib/services/mcp-sessao";

export interface ContextoDaFerramenta {
  sessao: SessaoDaPessoa;
  /** `https://<app>`, para chamar as rotas do proprio app. */
  origem: string;
}

export interface ResultadoDaFerramenta {
  texto: string;
  erro?: boolean;
}

type Args = Record<string, unknown>;

export interface Ferramenta {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  executar: (ctx: ContextoDaFerramenta, args: Args) => Promise<ResultadoDaFerramenta>;
}

const erro = (texto: string): ResultadoDaFerramenta => ({ texto, erro: true });

const reais = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

// ---------------------------------------------------------------------------
// Leituras compartilhadas
// ---------------------------------------------------------------------------

interface ContaLida {
  id: string;
  nome: string;
  tipo: string;
  cartao: boolean;
  closing_day: number | null;
  due_day: number | null;
  currency: string | null;
}

async function contasDaPessoa(supabase: SupabaseClient, userId: string): Promise<ContaLida[]> {
  const { data, error } = await supabase
    .from("financial_accounts")
    .select("id, name, account_type, closing_day, due_day, currency")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error("Não consegui ler as contas.");
  return (data ?? []).map((c) => ({
    id: c.id,
    nome: c.name,
    tipo: c.account_type,
    cartao: c.account_type === "credit_card",
    closing_day: c.closing_day ?? null,
    due_day: c.due_day ?? null,
    currency: c.currency ?? null,
  }));
}

interface CategoriaLida {
  id: string;
  nome: string;
  despesa: boolean;
  subcategorias: { id: string; nome: string }[];
}

async function categoriasDaPessoa(supabase: SupabaseClient): Promise<CategoriaLida[]> {
  const { data: servico } = await supabase
    .from("financial_services")
    .select("id")
    .eq("name", "personal_finance")
    .single();
  if (!servico) throw new Error("Serviço de finanças pessoais não encontrado.");

  const [{ data: cats, error }, { data: prefs }, { data: subs }] = await Promise.all([
    supabase
      .from("transaction_categories")
      .select("id, name, is_expense, is_active, user_id, icon, color_hex")
      .eq("service_id", servico.id)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("transaction_category_prefs")
      .select("category_id, name, icon, color_hex, is_hidden"),
    supabase
      .from("transaction_subcategories")
      .select("id, category_id, name")
      .eq("is_active", true)
      .order("name"),
  ]);
  if (error) throw new Error("Não consegui ler as categorias.");

  const porCategoria = new Map(
    ((prefs ?? []) as PreferenciaDeCategoria[]).map((p) => [p.category_id, p])
  );

  return ((cats ?? []) as Categoria[])
    .filter((c) => !porCategoria.get(c.id)?.is_hidden)
    .map((c) => {
      const efetiva = categoriaEfetiva(c, porCategoria.get(c.id));
      return {
        id: c.id,
        nome: efetiva.name,
        despesa: c.is_expense,
        subcategorias: (subs ?? [])
          .filter((s) => s.category_id === c.id)
          .map((s) => ({ id: s.id, nome: s.name })),
      };
    });
}

interface GrupoLido {
  id: string;
  nome: string;
}

async function gruposDaPessoa(supabase: SupabaseClient, userId: string): Promise<GrupoLido[]> {
  const { data, error } = await supabase
    .from("group_members")
    .select("group:expense_groups(id, name, is_active, archived_at)")
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw new Error("Não consegui ler os grupos.");
  const grupos: GrupoLido[] = [];
  for (const linha of data ?? []) {
    const g = (linha as { group: unknown }).group as
      | { id: string; name: string; is_active: boolean | null; archived_at: string | null }
      | null;
    if (g && g.is_active !== false && !g.archived_at) grupos.push({ id: g.id, nome: g.name });
  }
  return grupos.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

async function faturaAberta(
  supabase: SupabaseClient,
  conta: ContaLida,
  dia: string
): Promise<string | null> {
  const { data } = await supabase.rpc("card_invoice_month", {
    p_transaction_date: dia,
    p_closing_day: conta.closing_day,
  });
  return data ? String(data).slice(0, 7) : null;
}

/** Resolve conta, categoria (+ subcategoria) e grupo pedidos pelo nome. */
async function resolverCadastros(
  ctx: ContextoDaFerramenta,
  args: Args,
  tipo: TipoLancamento,
  campoDaConta: "conta" | "cartao"
): Promise<
  | { ok: true; conta: ContaLida; categoria: CategoriaLida; subcategoriaId: string | null; grupo: GrupoLido | null }
  | { ok: false; resultado: ResultadoDaFerramenta }
> {
  const { supabase, userId } = ctx.sessao;
  const falha = (t: string) => ({ ok: false as const, resultado: erro(t) });

  const pedidoDaConta = texto(args[campoDaConta]);
  if (!pedidoDaConta) return falha(`Informe ${campoDaConta === "cartao" ? "o cartão" : "a conta"}.`);
  const contas = await contasDaPessoa(supabase, userId);
  const elegiveis = campoDaConta === "cartao" ? contas.filter((c) => c.cartao) : contas;
  const conta = acharPorNome(elegiveis, pedidoDaConta);
  if (!conta.ok) {
    return falha(fraseDoNaoAchado(campoDaConta === "cartao" ? "cartão" : "conta", pedidoDaConta, conta));
  }

  const pedidoDaCategoria = texto(args.categoria);
  if (!pedidoDaCategoria) return falha("Informe a categoria.");
  const categorias = (await categoriasDaPessoa(supabase)).filter(
    (c) => c.despesa === (tipo === "expense")
  );
  const categoria = acharPorNome(categorias, pedidoDaCategoria);
  if (!categoria.ok) {
    return falha(
      fraseDoNaoAchado(tipo === "expense" ? "categoria de despesa" : "categoria de receita", pedidoDaCategoria, categoria)
    );
  }

  let subcategoriaId: string | null = null;
  const pedidoDaSub = texto(args.subcategoria);
  if (pedidoDaSub) {
    const sub = acharPorNome(categoria.item.subcategorias, pedidoDaSub);
    if (!sub.ok) {
      return falha(fraseDoNaoAchado(`subcategoria de "${categoria.item.nome}"`, pedidoDaSub, sub));
    }
    subcategoriaId = sub.item.id;
  }

  let grupo: GrupoLido | null = null;
  const pedidoDoGrupo = texto(args.grupo);
  if (pedidoDoGrupo) {
    if (tipo !== "expense") return falha("Grupo só vale para despesa.");
    const achado = acharPorNome(await gruposDaPessoa(supabase, userId), pedidoDoGrupo);
    if (!achado.ok) return falha(fraseDoNaoAchado("grupo", pedidoDoGrupo, achado));
    grupo = achado.item;
  }

  return { ok: true, conta: conta.item, categoria: categoria.item, subcategoriaId, grupo };
}

function mesDaFaturaPedido(args: Args): { ok: true; mes: string | null } | { ok: false; texto: string } {
  const bruto = texto(args.mes_da_fatura);
  if (!bruto) return { ok: true, mes: null };
  const m = /^(\d{4})-(\d{2})$/.exec(bruto);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {
    return { ok: false, texto: `mes_da_fatura deve ser 'AAAA-MM' (veio "${bruto}").` };
  }
  return { ok: true, mes: bruto };
}

// ---------------------------------------------------------------------------
// Lancamento avulso (despesa ou receita)
// ---------------------------------------------------------------------------

async function lancar(
  ctx: ContextoDaFerramenta,
  args: Args,
  tipo: TipoLancamento
): Promise<ResultadoDaFerramenta> {
  const { supabase, userId } = ctx.sessao;

  const descricao = texto(args.descricao);
  if (!descricao) return erro("Informe a descrição.");
  const valor = valorEmReais(args.valor);
  if (valor === null) return erro("Informe um valor maior que zero, em reais.");
  const data = texto(args.data) || hojeEmSaoPaulo();
  if (!dataValida(data)) return erro(`A data deve ser 'AAAA-MM-DD' (veio "${data}").`);
  const fatura = mesDaFaturaPedido(args);
  if (!fatura.ok) return erro(fatura.texto);

  const r = await resolverCadastros(ctx, args, tipo, "conta");
  if (!r.ok) return r.resultado;
  const { conta, categoria, subcategoriaId, grupo } = r;

  if (tipo === "income" && conta.cartao) {
    return erro(`"${conta.nome}" é um cartão de crédito. Receita entra numa conta, não no cartão.`);
  }
  if (fatura.mes && !conta.cartao) {
    return erro("mes_da_fatura só vale quando a conta é um cartão de crédito.");
  }

  const { data: servico } = await supabase
    .from("financial_services")
    .select("id")
    .eq("name", "personal_finance")
    .single();
  if (!servico) return erro("Serviço de finanças pessoais não encontrado.");

  // A MESMA linha que `FormularioDeLancamento.gravarTransacao` monta para um
  // lancamento novo em reais, sem divisao com pessoa. O que nao existe na
  // conversa (moeda estrangeira, data prevista, tags) vai com o valor que a
  // tela grava quando o campo fica em branco.
  const { data: criada, error } = await supabase
    .from("financial_transactions")
    .insert({
      user_id: userId,
      service_id: servico.id,
      category_id: categoria.id,
      subcategory_id: subcategoriaId,
      account_id: conta.id,
      description: descricao,
      amount: valorGravado(tipo, valor),
      transaction_date: data,
      transaction_type: tipo,
      notes: texto(args.observacao) || null,
      is_shared: Boolean(grupo),
      group_id: grupo?.id ?? null,
      currency: "BRL",
      exchange_rate: 1,
      launch_date: hojeEmSaoPaulo(),
      expected_date: null,
      invoice_month_override: fatura.mes ? `${fatura.mes}-01` : null,
      include_in_total: true,
      tags: [],
      ignorar_em_orcamentos: false,
    })
    .select("id")
    .single();

  if (error || !criada) {
    console.error("[mcp] erro ao lançar", error);
    return erro(`Não consegui gravar o lançamento${error?.message ? `: ${error.message}` : "."}`);
  }

  let ondeCaiu = conta.nome;
  if (conta.cartao) {
    const mes = fatura.mes ?? (await faturaAberta(supabase, conta, data));
    if (mes) ondeCaiu += `, fatura de ${mes}`;
  }

  const rotulo = tipo === "expense" ? "Despesa" : "Receita";
  return {
    texto:
      `${rotulo} lançada: ${descricao}, ${reais(valor)} em ${data} (${ondeCaiu}), ` +
      `categoria ${categoria.nome}${grupo ? `, no grupo ${grupo.nome}` : ""}. id=${criada.id}`,
  };
}

// ---------------------------------------------------------------------------
// Rotas do proprio app, com a sessao da pessoa
// ---------------------------------------------------------------------------

/**
 * POST numa rota do app com o cookie da sessao da pessoa. Para as regras que
 * ja tem dono numa rota (parcelas, subcategoria), em vez de copia-las aqui.
 */
async function postarNaRota(
  ctx: ContextoDaFerramenta,
  caminho: string,
  corpo: unknown
): Promise<{ ok: boolean; corpo: Record<string, unknown> }> {
  let cookie: string;
  try {
    cookie = await ctx.sessao.cookiesDaSessao();
  } catch {
    return { ok: false, corpo: { error: "Não consegui abrir a sessão para chamar o app." } };
  }
  const resposta = await fetch(`${ctx.origem}${caminho}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(corpo),
    cache: "no-store",
  }).catch(() => null);
  const json = resposta ? ((await resposta.json().catch(() => ({}))) as Record<string, unknown>) : {};
  return { ok: Boolean(resposta?.ok), corpo: json };
}

/** GET numa rota do app com o cookie da sessao da pessoa. */
async function lerDaRota(
  ctx: ContextoDaFerramenta,
  caminho: string
): Promise<{ ok: boolean; corpo: Record<string, unknown> }> {
  let cookie: string;
  try {
    cookie = await ctx.sessao.cookiesDaSessao();
  } catch {
    return { ok: false, corpo: { error: "Não consegui abrir a sessão para chamar o app." } };
  }
  const resposta = await fetch(`${ctx.origem}${caminho}`, {
    headers: { Cookie: cookie },
    cache: "no-store",
  }).catch(() => null);
  const json = resposta ? ((await resposta.json().catch(() => ({}))) as Record<string, unknown>) : {};
  return { ok: Boolean(resposta?.ok), corpo: json };
}

// ---------------------------------------------------------------------------
// Investimentos -- pelas MESMAS rotas da tela de investimentos
// ---------------------------------------------------------------------------

interface AtivoDaRota {
  id: string;
  symbol: string;
  name: string;
  type: AssetType;
  account_id?: string | null;
  index_kind?: string | null;
  index_percentage?: number | string | null;
}

interface CarteiraLida {
  assets: AtivoDaRota[];
  positions: Posicao[];
  rendaFixa: RendaFixaDaRota | null;
}

async function carteiraDaPessoa(ctx: ContextoDaFerramenta): Promise<CarteiraLida | string> {
  const [carteira, rendaFixa] = await Promise.all([
    lerDaRota(ctx, "/api/investments"),
    lerDaRota(ctx, "/api/investments/renda-fixa"),
  ]);
  if (!carteira.ok) return String(carteira.corpo.error ?? "Não consegui ler a carteira.");
  return {
    assets: (carteira.corpo.assets as AtivoDaRota[]) ?? [],
    positions: (carteira.corpo.positions as Posicao[]) ?? [],
    rendaFixa: rendaFixa.ok ? (rendaFixa.corpo as unknown as RendaFixaDaRota) : null,
  };
}

const TIPO_PEDIDO: Record<string, AssetType> = {
  acao: "stock",
  fii: "fii",
  renda_fixa: "fixed_income",
  fundo: "fund",
  internacional: "international",
};

/** Numero com virgula ou ponto; `null` se ausente, NaN se ilegivel. */
function numeroOpcional(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  if (v === 0 || v === "0") return 0;
  return valorEmReais(v) ?? NaN;
}

async function listarInvestimentos(ctx: ContextoDaFerramenta): Promise<ResultadoDaFerramenta> {
  const lida = await carteiraDaPessoa(ctx);
  if (typeof lida === "string") return erro(lida);

  const consolidado = comporConsolidado(lida, lida.rendaFixa);
  if (consolidado.classes.length === 0) return { texto: "Nenhum investimento lançado ainda." };

  const contas = await contasDaPessoa(ctx.sessao.supabase, ctx.sessao.userId);
  const nomeDaConta = new Map(contas.map((c) => [c.id, c.nome]));
  const contaPorAtivo: Record<string, string | null> = {};
  for (const a of lida.assets) contaPorAtivo[a.id] = a.account_id ?? null;
  const projetado = lida.rendaFixa ? valorProjetadoPorAtivo(lida.rendaFixa.projections || []) : null;

  const linhas: string[] = [
    `Total investido hoje: ${reais(consolidado.total)} (aplicado ${reais(consolidado.aplicado)}, rendimento ${reais(consolidado.rendimento)})`,
    "",
    "Por classe:",
    ...consolidado.classes.map(
      (c) => `- ${c.rotulo}: ${reais(c.valor)} (${c.percentual}%; aplicado ${reais(c.aplicado)})`
    ),
    "",
    "Por conta:",
    ...valorDaCarteiraPorConta(lida.positions, contaPorAtivo, projetado).map(
      (l) =>
        `- ${l.account_id ? nomeDaConta.get(l.account_id) ?? "Conta arquivada" : "Sem conta atrelada"}: ${reais(l.valor)} (${l.ativos} ativo(s))`
    ),
    "",
    "Ativos:",
  ];
  const ativoPorId = new Map(lida.assets.map((a) => [a.id, a]));
  for (const p of posicoesAbertas(lida.positions)) {
    const a = ativoPorId.get(p.asset_id);
    const proj = projecaoQueVale(p, projetado);
    const valor = proj ? proj.valor : p.current_value;
    const conta = a?.account_id ? nomeDaConta.get(a.account_id) ?? "conta arquivada" : "sem conta";
    const qtd = lancadoEmReais(p.type) ? "" : ` · ${p.total_quantity} cotas`;
    linhas.push(
      `- ${p.symbol} (${ROTULO_TIPO[p.type] ?? p.type}; ${conta})${qtd}: aplicado ${reais(p.total_invested)}, hoje ${reais(valor)} id=${p.asset_id}`
    );
  }
  if (!lida.rendaFixa) linhas.push("", "Aviso: o rendimento da renda fixa não veio agora; ela aparece pelo valor aplicado.");
  return { texto: linhas.join("\n") };
}

async function criarContaDeInvestimento(ctx: ContextoDaFerramenta, args: Args): Promise<ResultadoDaFerramenta> {
  const nome = texto(args.nome);
  if (!nome) return erro("Informe o nome da conta (ex.: 'C6 Investimentos').");
  const contas = await contasDaPessoa(ctx.sessao.supabase, ctx.sessao.userId);
  const igual = contas.find((c) => normalizarNome(c.nome) === normalizarNome(nome));
  if (igual) return { texto: `A conta "${igual.nome}" já existe (${igual.tipo}). id=${igual.id}` };

  const { ok, corpo } = await postarNaRota(ctx, "/api/financial-accounts", {
    name: nome,
    account_type: "investment",
    bank_name: texto(args.instituicao) || undefined,
    icon: "trending-up",
    color_hex: "#10B981",
  });
  if (!ok) return erro(String(corpo.error ?? "Não consegui criar a conta."));
  const criada = (corpo.account ?? corpo.data) as { id?: string } | undefined;
  return { texto: `Conta de investimento criada: ${nome}.${criada?.id ? ` id=${criada.id}` : ""}` };
}

async function lancarInvestimento(ctx: ContextoDaFerramenta, args: Args): Promise<ResultadoDaFerramenta> {
  const tipo = TIPO_PEDIDO[texto(args.tipo)];
  if (!tipo) return erro(`tipo deve ser um de: ${Object.keys(TIPO_PEDIDO).join(", ")}.`);
  const codigo = texto(args.codigo).toUpperCase();
  if (!codigo || codigo.length > 16) return erro("Informe o código do ativo (até 16 caracteres, ex.: 'CDB-C6' ou 'PETR4').");
  const data = texto(args.data) || hojeEmSaoPaulo();
  if (!dataValida(data)) return erro(`A data deve ser 'AAAA-MM-DD' (veio "${data}").`);
  const emReais = lancadoEmReais(tipo);

  // O par que vai para `investment_transactions` -- a mesma convencao da tela
  // (`lancamentoDeCarteiraParaGravar`): em reais, quantity = valor e preco 1.
  let quantidade: number;
  let preco: number;
  if (emReais) {
    const valor = valorEmReais(args.valor);
    if (valor === null) return erro("Informe o valor aplicado, em reais, maior que zero.");
    quantidade = valor;
    preco = 1;
  } else {
    quantidade = Number(args.quantidade);
    const p = valorEmReais(args.preco);
    if (!Number.isFinite(quantidade) || quantidade <= 0) return erro("Informe a quantidade de cotas, maior que zero.");
    if (p === null) return erro("Informe o preço por cota, em reais.");
    preco = p;
  }
  const taxas = numeroOpcional(args.taxas);
  if (taxas !== null && (!Number.isFinite(taxas) || taxas < 0)) return erro("taxas deve ser um valor em reais.");
  const valorAtual = numeroOpcional(args.valor_atual);
  if (valorAtual !== null && (!Number.isFinite(valorAtual) || valorAtual <= 0)) {
    return erro("valor_atual deve ser um valor em reais maior que zero.");
  }
  if (valorAtual !== null && !emReais) {
    return erro("valor_atual vale só para renda fixa e fundo. Para ação e FII, o preço é cotado todo dia útil.");
  }

  const lida = await carteiraDaPessoa(ctx);
  if (typeof lida === "string") return erro(lida);
  let ativo = lida.assets.find((a) => a.symbol === codigo);
  let criouAtivo = false;
  let contaNome = "sem conta";

  if (ativo) {
    if (ativo.type !== tipo) {
      return erro(`${codigo} já está na carteira como ${ROTULO_TIPO[ativo.type]}, não como ${ROTULO_TIPO[tipo]}.`);
    }
  } else {
    const nome = texto(args.nome);
    if (!nome) return erro(`${codigo} ainda não está na carteira: informe também o nome do ativo.`);

    let accountId: string | null = null;
    const pedidoDaConta = texto(args.conta);
    if (pedidoDaConta) {
      const contas = (await contasDaPessoa(ctx.sessao.supabase, ctx.sessao.userId)).filter((c) => c.tipo === "investment");
      const conta = acharPorNome(contas, pedidoDaConta);
      if (!conta.ok) return erro(fraseDoNaoAchado("conta de investimento", pedidoDaConta, conta));
      accountId = conta.item.id;
      contaNome = conta.item.nome;
    }

    const corpoDoAtivo: Record<string, unknown> = {
      symbol: codigo,
      name: nome,
      type: tipo,
      currency: "BRL",
      account_id: accountId,
    };
    if (valorAtual !== null) {
      corpoDoAtivo.currentPrice = Number((valorAtual / quantidade).toFixed(8));
    }
    if (tipo === "fixed_income") {
      Object.assign(corpoDoAtivo, {
        fixedIncomeProduct: texto(args.produto) || null,
        indexKind: texto(args.indexador) || null,
        indexPercentage: args.percentual ?? null,
        spreadAnnual: args.taxa_ao_ano ?? null,
        appliedDate: data,
        maturityDate: texto(args.vencimento) || null,
      });
    }
    const criado = await postarNaRota(ctx, "/api/investments/assets", corpoDoAtivo);
    if (!criado.ok) return erro(String(criado.corpo.error ?? "Não consegui cadastrar o ativo."));
    ativo = criado.corpo.asset as AtivoDaRota;
    criouAtivo = true;
  }

  const mov = await postarNaRota(ctx, "/api/investments/transactions", {
    assetId: ativo.id,
    kind: "buy",
    quantity: quantidade,
    unitPrice: preco,
    fees: taxas ?? 0,
    tradeDate: data,
    notes: texto(args.observacao) || null,
  });
  if (!mov.ok) {
    return erro(
      `${criouAtivo ? `Cadastrei ${codigo}, mas n` : "N"}ão consegui lançar a aplicação: ${String(mov.corpo.error ?? "erro")}.`
    );
  }

  // Ativo que ja existia e ganhou `valor_atual`: o fator e sobre o aplicado
  // TOTAL depois deste aporte, nao so sobre ele.
  if (!criouAtivo && valorAtual !== null) {
    const anterior = lida.positions.find((p) => p.asset_id === ativo!.id)?.total_invested ?? 0;
    const aplicado = anterior + quantidade * preco + (taxas ?? 0);
    const r = await fetch(`${ctx.origem}/api/investments/assets/${ativo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: await ctx.sessao.cookiesDaSessao() },
      body: JSON.stringify({ currentPrice: Number((valorAtual / aplicado).toFixed(8)) }),
      cache: "no-store",
    }).catch(() => null);
    if (!r?.ok) return { texto: `Aplicação lançada em ${codigo}, mas não consegui gravar o valor atual.` };
  }

  const quanto = emReais ? reais(quantidade) : `${quantidade} cotas a ${reais(preco)}`;
  return {
    texto:
      `${criouAtivo ? `Ativo cadastrado (${ROTULO_TIPO[tipo]}, ${contaNome}) e a` : "A"}plicação lançada: ` +
      `${codigo}, ${quanto} em ${data}${valorAtual !== null ? `, valendo hoje ${reais(valorAtual)}` : ""}. id=${ativo.id}`,
  };
}

// ---------------------------------------------------------------------------
// Compra parcelada no cartao
// ---------------------------------------------------------------------------

async function lancarParcelada(ctx: ContextoDaFerramenta, args: Args): Promise<ResultadoDaFerramenta> {
  const descricao = texto(args.descricao);
  if (!descricao) return erro("Informe a descrição.");
  const valor = valorEmReais(args.valor);
  if (valor === null) return erro("Informe um valor maior que zero, em reais.");
  const base = args.base === "parcela" ? "parcela" : args.base === undefined || args.base === "total" ? "total" : null;
  if (!base) return erro("base deve ser 'total' ou 'parcela'.");
  const parcelas = Number(args.parcelas);
  if (!Number.isInteger(parcelas) || parcelas < 2 || parcelas > 72) {
    return erro("parcelas deve ser um número inteiro entre 2 e 72.");
  }
  const parcelaAtual = args.parcela_atual === undefined ? 1 : Number(args.parcela_atual);
  if (!Number.isInteger(parcelaAtual) || parcelaAtual < 1 || parcelaAtual > parcelas) {
    return erro(`parcela_atual deve ser um inteiro entre 1 e ${parcelas}.`);
  }
  const data = texto(args.data) || hojeEmSaoPaulo();
  if (!dataValida(data)) return erro(`A data deve ser 'AAAA-MM-DD' (veio "${data}").`);
  const fatura = mesDaFaturaPedido(args);
  if (!fatura.ok) return erro(fatura.texto);

  const r = await resolverCadastros(ctx, args, "expense", "cartao");
  if (!r.ok) return r.resultado;
  const { conta, categoria, subcategoriaId, grupo } = r;

  // O MESMO corpo que `FormularioDeLancamento.criarParcelas` manda.
  const { ok, corpo } = await postarNaRota(ctx, "/api/financial-installments", {
    account_id: conta.id,
    category_id: categoria.id,
    subcategory_id: subcategoriaId,
    description: descricao,
    valor: String(valor),
    base,
    parcela_atual: parcelaAtual,
    total_parcelas: parcelas,
    vencimento: data,
    mes_da_fatura: fatura.mes,
    group_id: grupo?.id ?? null,
    divisao: [],
    notes: texto(args.observacao) || null,
    currency: "BRL",
    exchange_rate: 1,
  });
  if (!ok) return erro(String(corpo.error ?? "Não consegui criar as parcelas."));

  const primeira = fatura.mes ?? (await faturaAberta(ctx.sessao.supabase, conta, data));
  return {
    texto:
      `Compra parcelada lançada no ${conta.nome}: ${descricao}, ` +
      `${base === "total" ? `${reais(valor)} no total` : `${reais(valor)} por parcela`}, ` +
      `${parcelas}x${primeira ? `, começando na fatura de ${primeira}` : ""}, categoria ${categoria.nome}` +
      `${grupo ? `, no grupo ${grupo.nome}` : ""}. ${corpo.message ?? ""}`.trim(),
  };
}

// ---------------------------------------------------------------------------
// A lista que o Claude ve
// ---------------------------------------------------------------------------

const camposComuns = {
  descricao: { type: "string", description: "O que foi, como aparece na lista (ex.: 'Mercado Extra')." },
  valor: {
    type: ["number", "string"],
    description: "Valor em reais, sempre positivo (ex.: 49.9 ou '1.234,56'). O sinal sai do tipo.",
  },
  categoria: {
    type: "string",
    description: "Nome (ou id) da categoria, como em listar_categorias. Aceita sem acento.",
  },
  subcategoria: { type: "string", description: "Opcional. Nome da subcategoria dentro da categoria." },
  data: { type: "string", description: "Opcional. 'AAAA-MM-DD'. Padrão: hoje (horário de Brasília)." },
  observacao: { type: "string", description: "Opcional. Observação livre." },
};

export const FERRAMENTAS: Ferramenta[] = [
  {
    name: "listar_contas",
    title: "Listar contas e cartões",
    description:
      "Lista as contas e cartões de crédito ativos da pessoa, com a fatura aberta de cada cartão. Use antes de lançar para saber os nomes.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    async executar(ctx) {
      const contas = await contasDaPessoa(ctx.sessao.supabase, ctx.sessao.userId);
      if (contas.length === 0) return { texto: "Nenhuma conta ativa cadastrada no Pulo do Gato." };
      const hoje = hojeEmSaoPaulo();
      const linhas = await Promise.all(
        contas.map(async (c) => {
          if (!c.cartao) return `- ${c.nome} (conta: ${c.tipo}) id=${c.id}`;
          const aberta = await faturaAberta(ctx.sessao.supabase, c, hoje);
          return (
            `- ${c.nome} (cartão de crédito; fecha dia ${c.closing_day ?? "?"}, vence dia ${c.due_day ?? "?"}` +
            `${aberta ? `; fatura aberta: ${aberta}` : ""}) id=${c.id}`
          );
        })
      );
      return { texto: linhas.join("\n") };
    },
  },
  {
    name: "listar_categorias",
    title: "Listar categorias",
    description: "Lista as categorias (e subcategorias) de despesa e de receita da pessoa.",
    inputSchema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["despesa", "receita"], description: "Opcional. Filtra por tipo." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async executar(ctx, args) {
      let cats = await categoriasDaPessoa(ctx.sessao.supabase);
      if (args.tipo === "despesa") cats = cats.filter((c) => c.despesa);
      if (args.tipo === "receita") cats = cats.filter((c) => !c.despesa);
      const linhas = cats.map(
        (c) =>
          `- [${c.despesa ? "despesa" : "receita"}] ${c.nome}` +
          (c.subcategorias.length ? ` > ${c.subcategorias.map((s) => s.nome).join(", ")}` : "")
      );
      return { texto: linhas.join("\n") || "Nenhuma categoria." };
    },
  },
  {
    name: "listar_grupos",
    title: "Listar grupos",
    description:
      "Lista os grupos de despesa compartilhada em que a pessoa está ativa (ex.: Casa). Uma despesa lançada num grupo é dividida pela regra do grupo.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    async executar(ctx) {
      const grupos = await gruposDaPessoa(ctx.sessao.supabase, ctx.sessao.userId);
      return { texto: grupos.map((g) => `- ${g.nome} id=${g.id}`).join("\n") || "Nenhum grupo ativo." };
    },
  },
  {
    name: "criar_subcategoria",
    title: "Criar subcategoria",
    description:
      "Cria uma subcategoria dentro de uma categoria existente (ex.: 'Lanche' em 'Alimentação'). Use quando a pessoa pedir uma subcategoria que não existe; confirme o nome antes. Depois, lance usando a subcategoria criada.",
    inputSchema: {
      type: "object",
      properties: {
        categoria: { type: "string", description: "Nome (ou id) da categoria, como em listar_categorias." },
        nome: { type: "string", description: "Nome da subcategoria nova." },
      },
      required: ["categoria", "nome"],
      additionalProperties: false,
    },
    annotations: { destructiveHint: false, idempotentHint: true },
    async executar(ctx, args) {
      const pedido = texto(args.categoria);
      const nome = texto(args.nome);
      if (!pedido) return erro("Informe a categoria.");
      if (!nome) return erro("Informe o nome da subcategoria.");

      const categoria = acharPorNome(await categoriasDaPessoa(ctx.sessao.supabase), pedido);
      if (!categoria.ok) return erro(fraseDoNaoAchado("categoria", pedido, categoria));

      // Ja existe (sem acento e caixa)? Devolve a existente em vez de recusar:
      // o que a pessoa queria era poder lancar nela.
      const existente = acharPorNome(categoria.item.subcategorias, nome);
      if (existente.ok && normalizarNome(existente.item.nome) === normalizarNome(nome)) {
        return { texto: `A subcategoria "${existente.item.nome}" já existe em ${categoria.item.nome}.` };
      }

      // A rota da tela valida o nome e a duplicata (`validarNomeDeCategoria`).
      const { ok, corpo } = await postarNaRota(ctx, "/api/personal-finance/subcategories", {
        category_id: categoria.item.id,
        name: nome,
      });
      if (!ok) return erro(String(corpo.error ?? "Não consegui criar a subcategoria."));
      return { texto: `Subcategoria criada: ${categoria.item.nome} > ${nome}.` };
    },
  },
  {
    name: "listar_lancamentos",
    title: "Listar lançamentos recentes",
    description:
      "Lista os últimos lançamentos da pessoa (para conferir o que já foi lançado e não duplicar).",
    inputSchema: {
      type: "object",
      properties: {
        limite: { type: "integer", minimum: 1, maximum: 50, description: "Quantos (padrão 15)." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async executar(ctx, args) {
      const limite = Math.min(50, Math.max(1, Number(args.limite) || 15));
      const { data, error } = await ctx.sessao.supabase
        .from("financial_transactions")
        .select(
          "id, description, amount, transaction_date, created_at, installment_number, installment_total, category:transaction_categories(name), account:financial_accounts(name)"
        )
        .eq("user_id", ctx.sessao.userId)
        .order("created_at", { ascending: false })
        .limit(limite);
      if (error) return erro("Não consegui ler os lançamentos.");
      const linhas = (data ?? []).map((l) => {
        const cat = (l.category as unknown as { name?: string } | null)?.name ?? "sem categoria";
        const conta = (l.account as unknown as { name?: string } | null)?.name ?? "sem conta";
        return `- ${l.transaction_date} ${l.description}: ${reais(Number(l.amount))} (${cat}; ${conta}) id=${l.id}`;
      });
      return { texto: linhas.join("\n") || "Nenhum lançamento." };
    },
  },
  {
    name: "lancar_despesa",
    title: "Lançar despesa",
    description:
      "Lança uma despesa à vista (débito, Pix, dinheiro, ou uma compra de 1x no cartão de crédito). Para compra parcelada use lancar_compra_parcelada. Confirme com a pessoa conta e categoria quando não estiverem claras.",
    inputSchema: {
      type: "object",
      properties: {
        ...camposComuns,
        conta: { type: "string", description: "Nome (ou id) da conta ou cartão, como em listar_contas." },
        grupo: {
          type: "string",
          description: "Opcional. Nome do grupo (ex.: 'Casa') para a despesa ser dividida pela regra do grupo.",
        },
        mes_da_fatura: {
          type: "string",
          description: "Opcional, só para cartão. 'AAAA-MM' da fatura em que a compra cai. Padrão: pela data da compra.",
        },
      },
      required: ["descricao", "valor", "conta", "categoria"],
      additionalProperties: false,
    },
    annotations: { destructiveHint: false, idempotentHint: false },
    executar: (ctx, args) => lancar(ctx, args, "expense"),
  },
  {
    name: "lancar_receita",
    title: "Lançar receita",
    description: "Lança uma receita (salário, reembolso, venda...) numa conta.",
    inputSchema: {
      type: "object",
      properties: {
        ...camposComuns,
        conta: { type: "string", description: "Nome (ou id) da conta onde o dinheiro entrou." },
      },
      required: ["descricao", "valor", "conta", "categoria"],
      additionalProperties: false,
    },
    annotations: { destructiveHint: false, idempotentHint: false },
    executar: (ctx, args) => lancar(ctx, args, "income"),
  },
  {
    name: "lancar_compra_parcelada",
    title: "Lançar compra parcelada no cartão",
    description:
      "Lança uma compra parcelada no cartão de crédito: cria uma parcela por fatura, a partir da fatura em que a compra cai (ou de mes_da_fatura).",
    inputSchema: {
      type: "object",
      properties: {
        ...camposComuns,
        cartao: { type: "string", description: "Nome (ou id) do cartão de crédito, como em listar_contas." },
        parcelas: { type: "integer", minimum: 2, maximum: 72, description: "Número total de parcelas." },
        base: {
          type: "string",
          enum: ["total", "parcela"],
          description: "Se 'valor' é o total da compra (padrão) ou o valor de cada parcela.",
        },
        parcela_atual: {
          type: "integer",
          minimum: 1,
          description:
            "Opcional. Para uma compra antiga: qual parcela cai na fatura da data informada (as anteriores não são criadas). Padrão: 1.",
        },
        mes_da_fatura: {
          type: "string",
          description: "Opcional. 'AAAA-MM' da fatura da primeira parcela lançada. Padrão: a fatura da data da compra.",
        },
        grupo: { type: "string", description: "Opcional. Grupo para dividir a compra (ex.: 'Casa')." },
      },
      required: ["descricao", "valor", "cartao", "categoria", "parcelas"],
      additionalProperties: false,
    },
    annotations: { destructiveHint: false, idempotentHint: false },
    executar: lancarParcelada,
  },
];

FERRAMENTAS.push(
  {
    name: "listar_investimentos",
    title: "Listar investimentos",
    description:
      "Mostra a carteira de investimentos consolidada: total, por classe (Ações, FIIs, Renda Fixa, Fundos, Internacional), por conta/corretora e cada ativo com o valor de hoje. Use antes de lançar para não duplicar.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    executar: (ctx) => listarInvestimentos(ctx),
  },
  {
    name: "criar_conta_de_investimento",
    title: "Criar conta de investimento",
    description:
      "Cria uma conta do tipo investimento (corretora ou banco, ex.: 'C6 Investimentos'), onde os ativos ficam atrelados. Se já existir uma com o mesmo nome, devolve a existente.",
    inputSchema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome da conta, como vai aparecer no app." },
        instituicao: { type: "string", description: "Opcional. Nome do banco ou corretora." },
      },
      required: ["nome"],
      additionalProperties: false,
    },
    annotations: { destructiveHint: false, idempotentHint: true },
    executar: criarContaDeInvestimento,
  },
  {
    name: "lancar_investimento",
    title: "Lançar aplicação em investimento",
    description:
      "Lança uma aplicação (compra) na carteira de investimentos. Se o código ainda não existe, cadastra o ativo na conta de investimento informada. Renda fixa e fundo são lançados em reais (valor); ação, FII e internacional em cotas (quantidade e preço). Confira antes com listar_investimentos.",
    inputSchema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: Object.keys(TIPO_PEDIDO), description: "Classe do ativo." },
        codigo: { type: "string", description: "Código curto e único do ativo na carteira (ex.: 'PETR4', 'CDB-C6', 'MP-COFRINHO')." },
        nome: { type: "string", description: "Nome do ativo. Obrigatório quando o código é novo." },
        conta: { type: "string", description: "Conta de investimento (corretora/banco) onde o ativo fica, para ativo novo." },
        valor: { type: ["number", "string"], description: "Renda fixa e fundo: valor aplicado em reais." },
        quantidade: { type: "number", description: "Ação, FII, internacional: quantidade de cotas." },
        preco: { type: ["number", "string"], description: "Ação, FII, internacional: preço por cota em reais." },
        taxas: { type: ["number", "string"], description: "Opcional. Corretagem e emolumentos." },
        valor_atual: {
          type: ["number", "string"],
          description: "Opcional, renda fixa sem indexador e fundo: quanto a posição vale hoje (o app guarda o fator sobre o aplicado).",
        },
        produto: { type: "string", description: "Opcional, renda fixa: cdb, rdb, lc, lci, lca, cri, cra, debenture, debenture_incentivada, poupanca, outro." },
        indexador: { type: "string", description: "Opcional, renda fixa: cdi, selic, ipca, igpm, prefixado, poupanca." },
        percentual: { type: "number", description: "Opcional, renda fixa: percentual do indexador (120 = 120% do CDI)." },
        taxa_ao_ano: { type: "number", description: "Opcional, renda fixa: taxa ao ano (IPCA + 6 -> 6; prefixado 13% -> 13)." },
        vencimento: { type: "string", description: "Opcional, renda fixa: 'AAAA-MM-DD'." },
        data: { type: "string", description: "Opcional. 'AAAA-MM-DD' da aplicação. Padrão: hoje." },
        observacao: { type: "string", description: "Opcional." },
      },
      required: ["tipo", "codigo"],
      additionalProperties: false,
    },
    annotations: { destructiveHint: false, idempotentHint: false },
    executar: lancarInvestimento,
  }
);

export function acharFerramenta(nome: unknown): Ferramenta | undefined {
  return FERRAMENTAS.find((f) => f.name === nome);
}
