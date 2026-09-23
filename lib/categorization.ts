// =====================================================
// CATEGORIZACAO AUTOMATICA - quem decide a categoria de uma linha do extrato
// =====================================================
// O trabalho manual que esta feature ataca: `financial_transactions.category_id`
// e NOT NULL e a rota de importacao recusa a linha sem categoria. Hoje o
// usuario escolhe A MAO, uma linha por vez, e o iFood do dia 3 recebe a mesma
// escolha que o iFood do dia 17.
//
// Este arquivo responde uma pergunta so: "dada esta descricao de extrato e
// este valor, qual categoria?" -- sem tocar em banco, sem rede, sem relogio.
// Quem le o banco e grava e lib/services/categorization.ts.
//
// AS DUAS FONTES, E POR QUE A ORDEM IMPORTA
// ------------------------------------------
//   1. REGRA do usuario  -- ele ja disse o que este estabelecimento e
//   2. CATALOGO embutido -- um palpite nosso sobre lojistas conhecidos
//
// Regra sempre vence. Ela e decisao; o catalogo e chute. E por isso que o
// catalogo NUNCA grava sozinho: ele so preenche a sugestao da tela, e a linha
// so nasce categorizada por ele se o usuario aceitar. A regra, sim, aplica
// sozinha na importacao -- porque foi o proprio usuario quem a escreveu.
//
// POR QUE A NORMALIZACAO VEM DO DETECTOR
// ---------------------------------------
// `normalizeMerchant()` mora em lib/recurrence-detector.ts e ja tem 31 testes
// com descricao real de extrato. Importar de la, em vez de copiar, e o que
// garante que "netflix" quer dizer a mesma coisa na tela de assinaturas e na
// de regras. Copiar criaria duas normalizacoes que divergem no primeiro ajuste
// -- e a divergencia apareceria como "a regra parou de pegar", sem erro nenhum.
//
// (Este arquivo IMPORTA outro modulo, entao o teste dele precisa do passo
// `scripts/resolve-aliases.mjs` -- o mesmo do test:reports. Sem o passo, o node
// recebe o literal "@/lib/recurrence-detector" e morre com ERR_MODULE_NOT_FOUND.)
//
// O SINAL DO VALOR
// -----------------
// Despesa e gravada NEGATIVA. `transaction_categories.is_expense` diz de que
// lado a categoria serve. Casar os dois nao e detalhe: sem a conferencia, uma
// regra de "Alimentação" pegaria o estorno do iFood -- um credito -- e o
// lancamento nasceria como despesa de valor positivo. Nenhuma constraint
// reclama, e o relatorio de gastos passa a contar o estorno como gasto.
// =====================================================

import { normalizeMerchant } from "@/lib/recurrence-detector";

/** Categoria do catalogo do app (`transaction_categories`). */
export interface CategoriaConhecida {
  id: string;
  name: string;
  /** true = categoria de despesa. Vem de `is_expense`. */
  isExpense: boolean;
}

/** Uma regra do usuario, ja lida do banco. */
export interface RegraCategorizacao {
  id: string;
  merchantKey: string;
  displayName: string;
  categoryId: string;
  isActive: boolean;
}

export type OrigemSugestao = "rule" | "catalog";

export interface Sugestao {
  categoryId: string;
  categoryName: string;
  origin: OrigemSugestao;
  /** A chave que casou -- e o que a tela mostra como "por que isto". */
  matchedKey: string;
  /** A chave normalizada da descricao inteira. E o que uma regra nova gravaria. */
  merchantKey: string;
  /** Preenchido so quando `origin === "rule"`: qual regra casou. */
  ruleId?: string;
}

// ---------------------------------------------------------------------------
// 1. O catalogo embutido
// ---------------------------------------------------------------------------
// Palpite para quem ainda nao tem regra nenhuma -- o usuario novo, cujo
// primeiro extrato e justamente o pior momento para pedir dezenas de escolhas.
//
// Mapeia para o NOME da categoria, nao para o id. Os ids do 001_baseline sao
// fixos, mas gravar uuid literal aqui amarraria este arquivo aquele seed: um
// banco com outras categorias (ou uma categoria recriada) passaria a apontar
// para lugar nenhum e o FK falharia na importacao. O nome e resolvido contra o
// que o banco REALMENTE tem, e o que nao existe simplesmente nao e sugerido.
//
// As chaves sao saida de normalizeMerchant(), nao texto de extrato. O teste
// `catalogo: toda chave e ponto fixo da normalizacao` existe para isso: uma
// chave que nao sobrevive a propria normalizacao nunca casaria com nada, e a
// falha seria invisivel -- o app so deixaria de sugerir, sem erro.
export const CATALOGO_EMBUTIDO: Record<string, string> = {
  // --- Alimentação ---------------------------------------------------------
  "ifood": "Alimentação",
  "uber eats": "Alimentação", // antes de "uber": ver desempate por tamanho
  "rappi": "Alimentação",
  "zedelivery": "Alimentação",
  "ze delivery": "Alimentação",
  "mcdonalds": "Alimentação",
  "burger king": "Alimentação",
  "subway": "Alimentação",
  "starbucks": "Alimentação",
  "outback": "Alimentação",
  "habibs": "Alimentação",
  "girafas": "Alimentação",
  "spoleto": "Alimentação",
  "padaria": "Alimentação",
  "restaurante": "Alimentação",
  "lanchonete": "Alimentação",
  "pizzaria": "Alimentação",
  "hortifruti": "Alimentação",
  "supermercado": "Alimentação",
  "mercado": "Alimentação",
  "carrefour": "Alimentação",
  "pao de acucar": "Alimentação",
  "assai": "Alimentação",
  "atacadao": "Alimentação",
  "sendas": "Alimentação",
  "extra super": "Alimentação",

  // --- Transporte ----------------------------------------------------------
  "uber": "Transporte",
  "cabify": "Transporte",
  "99app": "Transporte",
  "99taxi": "Transporte",
  "posto": "Transporte",
  "posto ipiranga": "Transporte",
  "shell": "Transporte",
  "petrobras": "Transporte",
  "ipiranga": "Transporte",
  "estacionamento": "Transporte",
  "estapar": "Transporte",
  "autopass": "Transporte",
  "sem parar": "Transporte",
  "conectcar": "Transporte",
  "veloe": "Transporte",
  "bilhete unico": "Transporte",
  "localiza": "Transporte",
  "movida": "Transporte",
  "unidas": "Transporte",
  "latam": "Transporte",
  "gol linhas aereas": "Transporte",
  "azul linhas aereas": "Transporte",

  // --- Lazer ---------------------------------------------------------------
  "netflix": "Lazer",
  "spotify": "Lazer",
  "disney plus": "Lazer",
  "disneyplus": "Lazer",
  "hbo": "Lazer",
  "hbo max": "Lazer",
  "prime video": "Lazer",
  "globoplay": "Lazer",
  "deezer": "Lazer",
  "youtube premium": "Lazer",
  "twitch": "Lazer",
  "steam": "Lazer",
  "playstation network": "Lazer",
  "xbox game pass": "Lazer",
  "nintendo": "Lazer",
  "cinemark": "Lazer",
  "cinepolis": "Lazer",
  "uci": "Lazer",
  "ingresso": "Lazer",
  "ticketmaster": "Lazer",
  "sympla": "Lazer",
  "airbnb": "Lazer",
  "booking": "Lazer",
  "decolar": "Lazer",

  // --- Saúde ---------------------------------------------------------------
  "drogasil": "Saúde",
  "droga raia": "Saúde",
  "drogaraia": "Saúde",
  "pacheco": "Saúde",
  "pague menos": "Saúde",
  "farmacia": "Saúde",
  "drogaria": "Saúde",
  "smart fit": "Saúde",
  "smartfit": "Saúde",
  "bluefit": "Saúde",
  "academia": "Saúde",
  "gympass": "Saúde",
  "totalpass": "Saúde",
  "unimed": "Saúde",
  "amil": "Saúde",
  "sulamerica saude": "Saúde",
  "bradesco saude": "Saúde",
  "hapvida": "Saúde",
  "dasa": "Saúde",
  "fleury": "Saúde",
  "laboratorio": "Saúde",

  // --- Moradia -------------------------------------------------------------
  "aluguel": "Moradia",
  "condominio": "Moradia",
  "enel": "Moradia",
  "cemig": "Moradia",
  "copel": "Moradia",
  "light": "Moradia",
  "cpfl": "Moradia",
  "eletropaulo": "Moradia",
  "sabesp": "Moradia",
  "copasa": "Moradia",
  "sanepar": "Moradia",
  "comgas": "Moradia",
  "naturgy": "Moradia",
  "vivo": "Moradia",
  "claro": "Moradia",
  "tim": "Moradia",
  "oi fibra": "Moradia",
  "net virtua": "Moradia",
  "sky": "Moradia",
  "vivo fibra": "Moradia",
  "leroy merlin": "Moradia",
  "telhanorte": "Moradia",

  // --- Educação ------------------------------------------------------------
  "udemy": "Educação",
  "alura": "Educação",
  "coursera": "Educação",
  "duolingo": "Educação",
  "rocketseat": "Educação",
  "kindle": "Educação",
  "amazon kindle": "Educação",
  "livraria": "Educação",
  "estacio": "Educação",
  "anhanguera": "Educação",
  "faculdade": "Educação",
  "escola": "Educação",
  "colegio": "Educação",

  // --- Compras -------------------------------------------------------------
  "mercado livre": "Compras",
  "mercadolivre": "Compras",
  "amazon": "Compras",
  "shopee": "Compras",
  "aliexpress": "Compras",
  "shein": "Compras",
  "magazine luiza": "Compras",
  "magalu": "Compras",
  "americanas": "Compras",
  "casas bahia": "Compras",
  "renner": "Compras",
  "riachuelo": "Compras",
  "c a": "Compras",
  "zara": "Compras",
  "centauro": "Compras",
  "netshoes": "Compras",
  "nike": "Compras",
  "adidas": "Compras",
  "apple": "Compras",
  "applestore": "Compras",

  // --- Serviços ------------------------------------------------------------
  "google one": "Serviços",
  "google storage": "Serviços",
  "icloud": "Serviços",
  "dropbox": "Serviços",
  "microsoft": "Serviços",
  "office": "Serviços",
  "adobe": "Serviços",
  "canva": "Serviços",
  "notion": "Serviços",
  "openai": "Serviços",
  "chatgpt": "Serviços",
  "anthropic": "Serviços",
  "github": "Serviços",
  "figma": "Serviços",
  "linkedin": "Serviços",
  "1password": "Serviços",
  "nordvpn": "Serviços",
  "correios": "Serviços",
  "cartorio": "Serviços",
  "tarifa": "Serviços",
  "anuidade": "Serviços",
  "iof": "Serviços",
  "juros": "Serviços",

  // --- Receita (is_expense = false) ---------------------------------------
  // Existem para que um credito reconhecido nao caia na peneira do sinal e
  // fique sem sugestao nenhuma.
  "salario": "Salário",
  "pagamento salario": "Salário",
  "folha": "Salário",
  "proventos": "Salário",
  "rendimento": "Investimentos",
  "rendimentos": "Investimentos",
  "dividendos": "Investimentos",
  "jcp": "Investimentos",
  "resgate": "Investimentos",
};

// ---------------------------------------------------------------------------
// 2. Casamento por subsequencia de tokens
// ---------------------------------------------------------------------------
// Igualdade exata nao serve, e este e o ponto que mais custa se estiver errado.
// O adquirente cola coisa no nome que a normalizacao nao tem como saber que e
// ruido: "IFD*IFOOD 3947" vira `ifd ifood`, nao `ifood`. Uma regra gravada como
// `ifood` nunca pegaria essa linha, e o usuario veria a regra existir e nao
// funcionar -- que e pior que nao ter regra.
//
// Entao a chave casa quando seus tokens aparecem EM SEQUENCIA dentro da
// descricao normalizada. `ifood` casa em `ifd ifood`; `uber` casa em
// `uber trip sao paulo`.
//
// Em sequencia, e nao "todos os tokens em qualquer ordem": `gol linhas aereas`
// casando em `linhas de credito aereas gol` seria um acerto por acidente.

function tokens(chave: string): string[] {
  return chave.split(" ").filter(Boolean);
}

/** Os tokens de `agulha` aparecem, em sequencia, dentro de `palheiro`? */
export function casaPorTokens(palheiro: string, agulha: string): boolean {
  const t = tokens(palheiro);
  const a = tokens(agulha);
  if (a.length === 0 || a.length > t.length) return false;

  for (let i = 0; i + a.length <= t.length; i++) {
    let bate = true;
    for (let j = 0; j < a.length; j++) {
      if (t[i + j] !== a[j]) {
        bate = false;
        break;
      }
    }
    if (bate) return true;
  }
  return false;
}

/**
 * Entre todas as chaves que casam, a de MAIS tokens vence.
 *
 * E o desempate que faz `uber eats` ganhar de `uber` numa linha de delivery --
 * sem ele a ordem de iteracao do objeto decidiria a categoria, e `uber eats`
 * viraria Transporte em metade das vezes, de forma nao reproduzivel.
 *
 * Empate em numero de tokens (duas chaves de 1 token casando na mesma
 * descricao) e resolvido pela ordem alfabetica, so para o resultado ser
 * ESTAVEL. E raro e nenhuma das duas respostas e mais certa que a outra; o que
 * nao pode e a mesma descricao cair em categorias diferentes em duas passadas.
 */
function melhorChave(descricaoNormalizada: string, chaves: string[]): string | null {
  let melhor: string | null = null;
  let melhorTamanho = 0;

  for (const chave of chaves) {
    if (!casaPorTokens(descricaoNormalizada, chave)) continue;
    const tamanho = tokens(chave).length;
    if (tamanho > melhorTamanho || (tamanho === melhorTamanho && melhor !== null && chave < melhor)) {
      melhor = chave;
      melhorTamanho = tamanho;
    }
  }

  return melhor;
}

// ---------------------------------------------------------------------------
// 3. A peneira do sinal
// ---------------------------------------------------------------------------

/**
 * A categoria serve para uma linha deste valor?
 *
 * Despesa e negativa neste banco. Uma categoria de despesa nao pode receber um
 * credito, e vice-versa -- ver o cabecalho. Valor zero nao chega aqui
 * (statement_entries tem CHECK amount <> 0), mas se chegasse nao daria para
 * dizer de que lado e, entao nao ha sugestao.
 */
export function categoriaServeParaValor(categoria: CategoriaConhecida, amount: number): boolean {
  if (!Number.isFinite(amount) || amount === 0) return false;
  return categoria.isExpense ? amount < 0 : amount > 0;
}

// ---------------------------------------------------------------------------
// 4. A sugestao
// ---------------------------------------------------------------------------

/**
 * Qual categoria para esta linha do extrato?
 *
 * Devolve `null` quando nao ha resposta defensavel -- e devolver null e um
 * resultado legitimo, nao uma falha. A tela entao pede a escolha, que e
 * exatamente o comportamento de hoje. O que nao pode acontecer e devolver uma
 * categoria fraca com a mesma cara de uma forte: por isso `origin` sempre
 * acompanha a resposta, e a rota de importacao so aplica sozinha o que vem de
 * `rule`.
 *
 * @param descricao   texto cru do extrato ("IFD*IFOOD 3947")
 * @param amount      valor COM sinal, como o banco grava (negativo = despesa)
 * @param regras      as regras do usuario, ja lidas do banco
 * @param categorias  o que existe em transaction_categories neste banco
 */
export function sugerirCategoria(
  descricao: string,
  amount: number,
  regras: RegraCategorizacao[],
  categorias: CategoriaConhecida[]
): Sugestao | null {
  const merchantKey = normalizeMerchant(descricao);
  if (!merchantKey) return null;

  const porId = new Map(categorias.map((c) => [c.id, c]));

  // --- 1. Regra do usuario ------------------------------------------------
  // So as ativas. A regra desligada continua existindo para impedir que o
  // aprendizado a recrie (ver o comentario de `is_active` na migration 014),
  // mas ela nao casa mais.
  const ativas = regras.filter((r) => r.isActive && r.merchantKey);
  const chaveRegra = melhorChave(merchantKey, ativas.map((r) => r.merchantKey));

  if (chaveRegra) {
    // `find` e nao `filter`: se o banco tiver duas regras com a mesma chave (o
    // UNIQUE da 014 impede, mas este modulo tambem roda contra dado de teste),
    // a primeira decide de forma estavel em vez de o comportamento depender da
    // quantidade.
    const regra = ativas.find((r) => r.merchantKey === chaveRegra)!;
    const categoria = porId.get(regra.categoryId);

    // Categoria apagada do banco com a regra sobrevivendo nao deveria existir
    // -- o FK e ON DELETE RESTRICT. Mas este modulo tambem roda sobre dados que
    // vieram de fora, e sugerir um id que nao existe faria a importacao falhar
    // com erro de chave estrangeira em vez de pedir a escolha.
    if (categoria && categoriaServeParaValor(categoria, amount)) {
      return {
        categoryId: categoria.id,
        categoryName: categoria.name,
        origin: "rule",
        matchedKey: chaveRegra,
        merchantKey,
        ruleId: regra.id,
      };
    }

    // A regra casou mas nao serve para este valor (o estorno do iFood). Cai
    // para o catalogo de proposito, em vez de devolver null: o catalogo pode
    // ter uma categoria do lado certo do sinal, e se nao tiver o resultado e
    // null do mesmo jeito.
  }

  // --- 2. Catalogo embutido -----------------------------------------------
  // O nome e resolvido contra o que o banco tem. Categoria do catalogo que nao
  // existe neste banco simplesmente nao vira sugestao.
  const porNome = new Map(categorias.map((c) => [c.name, c]));
  const chaveCatalogo = melhorChave(merchantKey, Object.keys(CATALOGO_EMBUTIDO));

  if (chaveCatalogo) {
    const categoria = porNome.get(CATALOGO_EMBUTIDO[chaveCatalogo]);
    if (categoria && categoriaServeParaValor(categoria, amount)) {
      return {
        categoryId: categoria.id,
        categoryName: categoria.name,
        origin: "catalog",
        matchedKey: chaveCatalogo,
        merchantKey,
      };
    }
  }

  return null;
}

/**
 * A chave que uma regra nova gravaria para esta descricao.
 *
 * Exportada porque a rota de aprendizado precisa dela sem precisar de uma
 * sugestao: quando o usuario escolhe a categoria A MAO, nao houve casamento
 * nenhum, e mesmo assim ha o que gravar.
 */
export function chaveDaDescricao(descricao: string): string {
  return normalizeMerchant(descricao);
}

/**
 * Ja existe regra ATIVA do usuario cobrindo esta descricao?
 *
 * Usada pelo aprendizado para decidir entre criar regra nova e so contar mais
 * uma aplicacao na que ja existe. Sem isto, importar "IFD*IFOOD 3947" e depois
 * "PAG*IFOOD" criaria duas regras (`ifd ifood` e `ifood`) para o mesmo lojista
 * -- as duas certas, as duas na tela, e a lista viraria lixo em um mes.
 */
export function regraQueCobre(
  descricao: string,
  regras: RegraCategorizacao[]
): RegraCategorizacao | null {
  const chave = normalizeMerchant(descricao);
  if (!chave) return null;

  const ativas = regras.filter((r) => r.isActive && r.merchantKey);
  const melhor = melhorChave(chave, ativas.map((r) => r.merchantKey));
  return melhor ? ativas.find((r) => r.merchantKey === melhor) ?? null : null;
}
