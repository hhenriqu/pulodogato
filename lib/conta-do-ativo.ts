import type { SupabaseClient } from "@supabase/supabase-js";

// =====================================================
// CONTA INVESTIMENTO <-> ATIVO -- o elo, lido do corpo e da query
// (HMO-436, fase 2 de 6 da HMO-432)
// =====================================================
// A migration 059 criou `investment_assets.account_id` com FK para
// `financial_accounts (id)` e uma TRIGGER que exige "a conta e do MESMO dono E
// tem `account_type = 'investment'`". Este arquivo e o lado do app: ele le o
// elo do corpo do pedido, le o recorte da query string, e confere a conta
// ANTES de o INSERT/UPDATE chegar ao banco.
//
// POR QUE CONFERIR AQUI SE A TRIGGER JA CONFERE
// --------------------------------------------
// Pela MENSAGEM, e so por ela. A trigger da 059 levanta `check_violation` com
// um texto que fala de trigger e de nome de constraint; a rota devolveria isso
// como 500 "Erro ao cadastrar ativo: ...". Quem esta olhando o formulario
// escolheu uma conta numa lista e precisa ouvir "essa conta e corrente, escolha
// uma Conta Investimento" -- nao um erro interno.
//
// A trigger continua sendo a ultima linha de defesa, e isso NAO e redundancia
// inutil: a validacao daqui tem uma janela de corrida (a conta pode mudar de
// tipo, ou ser apagada, entre o SELECT e o INSERT) e so o banco fecha essa
// janela. O que muda e quem FALA com o usuario nos casos normais.
//
// POR QUE A VALIDACAO E 400 E NAO 404 QUANDO A CONTA NAO EXISTE
// -------------------------------------------------------------
// O recurso que o pedido cria/edita e o ATIVO, e ele existe (ou vai existir).
// O que esta errado e um CAMPO do corpo -- isso e 400. Um 404 aqui faria o
// cliente concluir que o ativo nao existe e, no PATCH, esconder a linha da
// tela.
//
// E a conta de OUTRO dono cai na mesma mensagem da conta inexistente, de
// proposito: distinguir as duas confirmaria, para quem tem o uuid, que aquela
// conta existe em outra carteira. Nao e o
// `mensagem-de-erro-unica-para-dois-estados` que esconde defeito -- aqui o
// estado que o usuario pode consertar e o mesmo nos dois casos ("essa conta nao
// esta na sua lista"), e a diferenca entre eles nao muda nada que ele possa
// fazer.
// =====================================================

/**
 * O `account_id` de um `uuid` do Postgres, conferido como TEXTO antes de virar
 * filtro.
 *
 * Sem isto, `?account_id=abc` chega ao PostgREST e volta
 * `22P02 invalid input syntax for type uuid` -- que a rota le como erro de
 * banco e devolve 500. Um parametro malformado e 400, nao 500, e a diferenca
 * importa porque 500 manda o cliente tentar de novo.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O valor de `?account_id=` que pede os ativos SOLTOS (`account_id IS NULL`).
 *
 * Ele existe porque a tela da Fase 3 precisa exatamente dessa lista para
 * oferecer "atrelar este ativo a uma conta", e `?account_id=` vazio nao pode
 * servir: string vazia e indistinguivel de parametro ausente na query string, e
 * ausente TEM de significar "sem recorte" (e o comportamento de hoje da rota,
 * que nao pode mudar). O cabecalho da 059 explica por que o indice ficou cheio
 * em vez de parcial -- e por esta leitura.
 */
export const CONTA_SOLTA = "none";

// ---------------------------------------------------------------------------
// O elo no CORPO do pedido (POST e PATCH)
// ---------------------------------------------------------------------------

export type LeituraDoElo =
  /** A chave nao veio. No POST o ativo nasce solto; no PATCH o elo nao muda. */
  | { ok: true; presente: false }
  /** A chave veio. `null` quer dizer "solta este ativo". */
  | { ok: true; presente: true; account_id: string | null }
  | { ok: false; erro: string };

/**
 * Le o elo do corpo aceitando as DUAS grafias: `accountId` (a convencao destas
 * rotas, que recebem `currentPrice` e `indexKind`) e `account_id` (o nome da
 * coluna, que e como a issue e o banco chamam).
 *
 * Aceitar as duas nao e indecisao -- e o conserto de uma falha MUDA. Um
 * formulario que mandasse a grafia que a rota nao le teria o campo IGNORADO:
 * resposta 201, ativo criado, nenhum erro em lugar nenhum, e o ativo fica solto
 * enquanto a pessoa ve a conta selecionada na tela. Dinheiro no lugar errado
 * sem excecao nenhuma -- ver `nome-de-campo-errado-esconde-bug-de-dinheiro`.
 *
 * As duas juntas e DISCORDANDO e 400: nessa altura nao ha como saber qual das
 * duas o cliente queria, e escolher uma calado e escolher errado em metade dos
 * casos.
 */
export function lerContaDoCorpo(body: unknown): LeituraDoElo {
  const b = (body ?? {}) as Record<string, unknown>;

  const temCamel = "accountId" in b;
  const temSnake = "account_id" in b;

  if (!temCamel && !temSnake) return { ok: true, presente: false };

  if (temCamel && temSnake) {
    const camel = normalizar(b.accountId);
    const snake = normalizar(b.account_id);
    if (camel.bruto !== snake.bruto) {
      return {
        ok: false,
        erro: "Pedido traz `accountId` e `account_id` com valores diferentes",
      };
    }
  }

  const lido = normalizar(temCamel ? b.accountId : b.account_id);

  if (lido.valor === null) return { ok: true, presente: true, account_id: null };

  if (!UUID.test(lido.valor)) {
    return { ok: false, erro: "Conta invalida" };
  }

  return { ok: true, presente: true, account_id: lido.valor };
}

/**
 * `null`, `undefined` e `""` todos querem dizer "sem conta".
 *
 * A string vazia entra nessa lista porque e o que um `<select>` de HTML manda
 * quando a opcao escolhida e "nenhuma" -- e o mesmo tratamento que
 * `currentPrice` ja da a `""` nestas rotas. `bruto` guarda o que chegou antes
 * do `trim` para a comparacao das duas grafias nao reprovar por espaco.
 */
function normalizar(v: unknown): { valor: string | null; bruto: string } {
  if (v === null || v === undefined) return { valor: null, bruto: "" };
  const texto = String(v).trim();
  return { valor: texto === "" ? null : texto, bruto: texto };
}

// ---------------------------------------------------------------------------
// O recorte na QUERY STRING (os dois GET)
// ---------------------------------------------------------------------------

export type RecorteDeConta =
  | { ok: true; tipo: "sem-recorte" }
  | { ok: true; tipo: "conta"; account_id: string }
  | { ok: true; tipo: "soltos" }
  | { ok: false; erro: string };

/**
 * Le `?account_id=` nos tres estados possiveis.
 *
 * Ausente e "sem recorte", e isso e load-bearing: e o pedido que a tela de
 * investimentos faz hoje, e ela tem de continuar recebendo a carteira inteira
 * byte por byte como antes desta fase.
 */
export function lerRecorteDeConta(valor: string | null): RecorteDeConta {
  if (valor === null) return { ok: true, tipo: "sem-recorte" };

  const texto = valor.trim();

  // `?account_id=` com valor vazio: o cliente TENTOU recortar e nao disse por
  // o que. Cair em "sem recorte" aqui devolveria a carteira inteira para quem
  // pediu um pedaco dela -- a resposta errada mais perigosa desta rota, porque
  // ela parece certa (200, lista cheia) e o numero que a tela soma passa a ser
  // de todas as contas.
  if (texto === "") {
    return {
      ok: false,
      erro: `Informe a conta em account_id (ou "${CONTA_SOLTA}" para os ativos sem conta)`,
    };
  }

  if (texto === CONTA_SOLTA) return { ok: true, tipo: "soltos" };

  if (!UUID.test(texto)) {
    return {
      ok: false,
      erro: `account_id invalido (use o uuid da conta ou "${CONTA_SOLTA}")`,
    };
  }

  return { ok: true, tipo: "conta", account_id: texto };
}

// ---------------------------------------------------------------------------
// A conferencia contra o banco
// ---------------------------------------------------------------------------

export type ContaConferida =
  | { ok: true }
  | { ok: false; status: 400 | 500; erro: string };

/**
 * As duas metades da trava da 059, conferidas aqui pela mensagem: a conta tem
 * de ser do dono do ativo e tem de ser do tipo `investment`.
 *
 * O `.eq("user_id")` e a primeira metade e e redundante com a RLS de proposito
 * -- a mesma razao que o PATCH de `/assets/:assetId` ja documenta. Ele tambem e
 * o que faz a conta de outra pessoa voltar vazia e cair na mensagem de "nao
 * encontrada" em vez de passar para a checagem de tipo.
 *
 * `is_active` NAO entra. A 059 nao exige conta ativa, e inventar a regra aqui
 * faria a rota recusar um elo que o banco aceita -- o usuario veria "escolha uma
 * Conta Investimento" apontando para uma Conta Investimento. Arquivar a conta e
 * esconder a conta, nao desfazer o elo.
 */
export async function conferirContaDeInvestimento(
  supabase: SupabaseClient,
  accountId: string,
  userId: string
): Promise<ContaConferida> {
  // `select` nomeando SO colunas da 001: nomear coluna de migration recente
  // aqui derrubaria esta conferencia com `42703` em qualquer banco que ainda
  // nao a recebeu -- ver
  // `select-que-nomeia-coluna-nova-derruba-a-rota-antes-da-colagem`.
  const { data: conta, error } = await supabase
    .from("financial_accounts")
    .select("id, name, account_type")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();

  // O `error` e LIDO. Nao ler e o defeito da HMO-145: `data` vem `null`, o
  // codigo conclui "nao achei" e devolve uma mensagem de usuario para o que e
  // uma falha de banco.
  if (error) {
    return {
      ok: false,
      status: 500,
      erro: `Erro ao conferir a conta: ${error.message}`,
    };
  }

  if (!conta) {
    return {
      ok: false,
      status: 400,
      erro: "Conta nao encontrada na sua lista de contas",
    };
  }

  if (conta.account_type !== "investment") {
    const nome = typeof conta.name === "string" && conta.name ? conta.name : "A conta escolhida";
    return {
      ok: false,
      status: 400,
      erro: `${nome} nao e uma Conta Investimento. Atrele o ativo a uma conta do tipo Investimento`,
    };
  }

  return { ok: true };
}
