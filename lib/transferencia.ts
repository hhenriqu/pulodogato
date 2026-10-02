// ---------------------------------------------------------------------------
// TRANSFERENCIA ENTRE CONTAS PROPRIAS (HMO-164)
// ---------------------------------------------------------------------------
// O que estava errado: a tela antiga tinha UM seletor de conta. Quem escolhia
// "Transferencia/Balanco" gravava UMA linha -- o dinheiro saia de uma conta e
// nao entrava em nenhuma. Metade de uma transferencia, e o patrimonio
// encolhia pelo valor transferido sem nenhum erro aparecer.
//
// Uma transferencia sao DUAS pernas, e as duas se anulam:
//
//   saida:   -total na conta de origem
//   entrada: +total na conta de destino
//
// `transaction_type = 'transfer'` nas duas e o que faz as views do 008
// fecharem. `category_monthly_totals` e `monthly_cash_flow` filtram
// `transaction_type IN ('expense','income')`, entao nenhuma das pernas entra em
// Receitas nem em Despesas -- transferir R$ 1.000 entre contas proprias nao e
// receita de mil nem gasto de mil, e antes da HMO-162 era as duas coisas ao
// mesmo tempo. `net_worth_history` soma qualquer tipo, espelhando o trigger de
// saldo, e la as duas se anulam: -1.000 + 1.000 = 0.
//
// Este arquivo e o unico lugar que monta as pernas. `lib/card-invoice.ts`
// chama daqui: pagar a fatura E uma transferencia (dinheiro sai da corrente e
// a divida do cartao e quitada), e quando o HMO-149 consertou aquele caminho
// escreveu a logica la dentro. Duplicar em vez de reusar deixaria duas fontes
// para a mesma regra de sinal -- que e exatamente o tipo de divergencia que
// erra dinheiro sem quebrar nada.
// ---------------------------------------------------------------------------

// Os tipos da recorrencia vem de `lib/lancamento.ts` (HMO-172): a pergunta "isto
// se repete todo mes?" tem um dono so, e `lancamento.ts` nao importa nada -- e
// modulo puro de ponta a ponta, entao a dependencia nao arrasta arvore nenhuma.
import {
  MAX_MESES_DE_REPETICAO,
  type DuracaoDaRepeticao,
  type NaturezaDespesa,
} from "@/lib/lancamento";

/**
 * A categoria das duas pernas.
 *
 * `financial_transactions.category_id` e NOT NULL (001_baseline), mas
 * transferencia nao TEM categoria: nao e gasto nem ganho, e obrigar a escolher
 * uma foi justamente o que deixou a perna de saida indistinguivel de uma
 * despesa comum na tela antiga.
 *
 * A saida e uma categoria reservada, criada sob demanda com
 * `is_active = false`. Os dois seletores de categoria do app filtram
 * `is_active = true` (a tela de lancamento e a de personal-finance), entao ela
 * nunca aparece como opcao para o usuario -- e mesmo assim satisfaz o NOT NULL
 * e a FK.
 *
 * Nao e migration: a linha nasce no primeiro transferencia de cada servico. Um
 * seed exigiria um passo em producao para uma tabela que ja se preenche
 * sozinha.
 */
export const NOME_DA_CATEGORIA_DE_TRANSFERENCIA = "Transferência entre contas";

/** Uma das duas linhas que a transferencia grava. */
export interface PernaDeTransferencia {
  account_id: string;
  description: string;
  amount: number;
  transaction_type: "transfer";
}

/**
 * As duas pernas de uma transferencia.
 *
 * O valor entra por `Math.abs` nos dois lados. O input da tela aceita "-500", e
 * sem o abs a saida viraria `-(-500) = +500`: a transferencia andaria para tras
 * e as duas contas ficariam erradas na mesma operacao.
 *
 * `descricaoDaEntrada` existe para o pagamento de fatura, que rotula a perna de
 * entrada de outro jeito ("Pagamento — ..."). Numa transferencia comum as duas
 * pernas contam o mesmo fato e levam a mesma descricao: e assim que a pessoa
 * reconhece o par nas duas contas do extrato.
 */
export function pernasDaTransferencia(params: {
  valor: number;
  origemId: string;
  destinoId: string;
  descricao: string;
  descricaoDaEntrada?: string;
}): { saida: PernaDeTransferencia; entrada: PernaDeTransferencia } {
  const total = Math.abs(params.valor);
  return {
    saida: {
      account_id: params.origemId,
      description: params.descricao,
      amount: -total,
      transaction_type: "transfer",
    },
    entrada: {
      account_id: params.destinoId,
      description: params.descricaoDaEntrada ?? params.descricao,
      amount: total,
      transaction_type: "transfer",
    },
  };
}

/** Por que este par de contas nao serve para uma transferencia. */
export type ProblemaDaTransferencia =
  | "origem_ausente"
  | "destino_ausente"
  | "origem_nao_encontrada"
  | "destino_nao_encontrado"
  | "mesma_conta"
  | "origem_e_cartao";

/** O que a validacao precisa saber de cada conta. */
export interface ContaDaTransferencia {
  id: string;
  account_type?: string | null;
}

/**
 * Este par de contas serve? Devolve `null` quando serve, ou o motivo.
 *
 * `undefined` = o cliente nao mandou a conta. `null` = mandou um id que a busca
 * nao achou (ou que nao e do usuario). Os dois precisam de mensagens
 * diferentes: um e campo em branco, o outro e id invalido -- e no segundo caso
 * confundir os dois esconderia uma tentativa de escrever na conta de outra
 * pessoa atras de "preencha o campo".
 *
 * Nenhuma das recusas e paranoia:
 *
 * - `mesma_conta`: as duas pernas cairiam na mesma conta, -total e +total se
 *   anulariam, e a tela diria "transferido" sem que nada tivesse se movido. E o
 *   bug do HMO-149 com outra roupa: o numero fecha e o fato nao aconteceu.
 * - `origem_e_cartao`: cartao de credito nao tem saldo de onde tirar dinheiro,
 *   tem divida. Uma saida nele criaria divida sem compra nenhuma por tras, e
 *   essa linha entraria na fatura do mes cobrando algo que nao foi comprado.
 *   O caminho certo para mover dinheiro PARA um cartao e o pagamento da
 *   fatura, que ja existe -- e por isso o cartao continua valendo como
 *   DESTINO: quem adianta dinheiro para o cartao esta quitando divida.
 *
 * Conta arquivada (`is_active = false`) nao e recusada, pelo mesmo motivo da
 * `validarContaPagadora`: quem esta movendo dinheiro de uma conta que fechou
 * precisa registrar um fato que aconteceu de verdade.
 */
export function validarContasDaTransferencia(
  origem: ContaDaTransferencia | null | undefined,
  destino: ContaDaTransferencia | null | undefined
): ProblemaDaTransferencia | null {
  if (!origem?.id) {
    return origem === null ? "origem_nao_encontrada" : "origem_ausente";
  }
  if (!destino?.id) {
    return destino === null ? "destino_nao_encontrado" : "destino_ausente";
  }
  if (origem.id === destino.id) return "mesma_conta";
  if (origem.account_type === "credit_card") return "origem_e_cartao";
  return null;
}

/**
 * Os campos de DESTINO que o INSERT da regra recorrente deve carregar.
 *
 * Devolve `{}` para income/expense e `{ destination_account_id }` para
 * transferencia -- ou seja, a coluna que so a transferencia usa so viaja
 * quando ha transferencia. E a mesma assimetria que `materializarAgenda`
 * (lib/services/scheduled.ts) ja aplicava na ocorrencia; aqui ela passa a
 * valer tambem na REGRA, que e quem a ocorrencia copia.
 *
 * Por que isto e uma funcao, e nao um `...(tipo === "transfer" ? ... : {})`
 * solto dentro da rota: a decisao e testavel sozinha, sem subir Next nem
 * fingir um cliente do Supabase. O `in` sobre o objeto devolvido separa os
 * tres estados que um `?? null` no leitor confundiria -- chave ausente, chave
 * presente com `null`, e chave presente com id.
 *
 * O ganho concreto e desacoplar a criacao de despesa/receita fixa do schema:
 * mandar `destination_account_id` sempre faz o PostgREST recusar o INSERT
 * INTEIRO com PGRST204 ("column not found in schema cache") em qualquer banco
 * onde a 038 nao esteja colada -- e PGRST204 vem antes de permissao e de RLS,
 * entao falharia para os tres tipos, nao so para transferencia.
 *
 * Nao esconde dado: a rota recusa com 400 ("Conta de destino so existe em
 * transferencia") um income/expense que venha com destino preenchido, entao o
 * ramo sem a chave so e alcancado quando o valor seria `null` de qualquer
 * forma. O `|| null` continua no ramo de transferencia porque a coluna e uuid
 * e `""` volta 22P02.
 */
export function camposDeDestinoDaRegra(
  transaction_type: string,
  destination_account_id: unknown
): { destination_account_id?: string | null } {
  if (transaction_type !== "transfer") return {};
  return {
    destination_account_id:
      typeof destination_account_id === "string" && destination_account_id
        ? destination_account_id
        : null,
  };
}

/** Mensagem para o usuario. Nem a rota nem a tela inventam texto proprio. */
export function mensagemDaTransferencia(
  problema: ProblemaDaTransferencia
): string {
  switch (problema) {
    case "origem_ausente":
      return "Escolha de qual conta o dinheiro saiu";
    case "destino_ausente":
      return "Escolha para qual conta o dinheiro foi";
    case "origem_nao_encontrada":
      return "Conta de origem não encontrada";
    case "destino_nao_encontrado":
      return "Conta de destino não encontrada";
    case "mesma_conta":
      return "A conta de destino tem que ser diferente da de origem";
    case "origem_e_cartao":
      return "Cartão de crédito não pode ser a origem. Para quitar a fatura, use Contas Previstas.";
  }
}

/**
 * O estado do formulario de transferencia.
 *
 * Deliberadamente NAO e `ValoresDeLancamento`: transferencia nao tem categoria,
 * parcelamento nem rateio, e carregar os campos mortos so para reaproveitar a
 * forma foi como a tela antiga acabou escondendo tres telas dentro de uma.
 *
 * O que ela PASSA a ter em comum com o lancamento (HMO-172) sao os quatro
 * campos da recorrencia, e eles vem com os TIPOS de `lib/lancamento.ts` em vez
 * de copias locais. A copia seria indistinguivel hoje e divergiria no primeiro
 * conserto que so um dos lados recebesse -- e `duracao` e justamente o campo
 * onde uma divergencia e silenciosa: "indefinida" vira `max_occurrences: null`,
 * e um valor que o outro lado nao conheca cai no mesmo `null` sem erro,
 * transformando "por 12 meses" em "para sempre".
 */
export interface ValoresDeTransferencia {
  descricao: string;
  /** Como veio do input: string, ainda nao numero. */
  valor: string;
  origemId: string;
  destinoId: string;
  /** YYYY-MM-DD */
  data: string;
  notas: string;

  /**
   * Pontual ou "todo mes" (HMO-172).
   *
   * E `NaturezaDespesa` por reuso de tipo, mas so dois dos tres valores cabem
   * aqui -- `naturezasDoTipo("transfer")` e quem diz quais, e "card" nao esta
   * entre eles: mover dinheiro para um cartao e quitar divida, e aquele caminho
   * e o pagamento de fatura.
   */
  natureza: NaturezaDespesa;
  /** Dia do vencimento da regra mensal. So natureza fixa. */
  diaDeVencimento: string;
  /** "Todos os meses" x "por N meses". So natureza fixa. */
  duracao: DuracaoDaRepeticao;
  /** Quantos meses, quando a duracao e contada. */
  mesesDeRepeticao: string;
}

export function valoresIniciaisDeTransferencia(): ValoresDeTransferencia {
  return {
    descricao: "",
    valor: "",
    origemId: "",
    destinoId: "",
    data: new Date().toISOString().split("T")[0],
    notas: "",
    // Pontual por padrao. A transferencia recorrente e o caso raro, e um default
    // "fixed" faria quem transfere uma vez criar uma regra que volta todo mes.
    natureza: "one_off",
    diaDeVencimento: "",
    duracao: "indefinida",
    mesesDeRepeticao: "",
  };
}

/** Quais blocos do formulario de transferencia existem agora (HMO-172). */
export interface CamposDaTransferencia {
  /** O seletor pontual / todo mes. */
  natureza: boolean;
  /** O dia do vencimento da regra. So natureza fixa. */
  diaDeVencimento: boolean;
  /** "Todos os meses" x "por N meses". So natureza fixa. */
  duracao: boolean;
}

/**
 * Os campos da tela, a partir da natureza.
 *
 * `duracao` anda COLADA em `diaDeVencimento` de proposito, como em
 * `camposDoTipo`: mostrar "por 12 meses" sem o dia do vencimento deixaria a
 * pessoa dizer por quanto tempo repetir sem dizer QUANDO, e a regra nasceria com
 * `due_day` nulo -- uma agenda que nunca gera ocorrencia nenhuma.
 */
export function camposDaTransferencia(
  valores: ValoresDeTransferencia
): CamposDaTransferencia {
  const fixa = valores.natureza === "fixed";
  return { natureza: true, diaDeVencimento: fixa, duracao: fixa };
}

/**
 * Para onde esta transferencia vai.
 *
 *   regra     -> `recurring_rules`, e a agenda gera as ocorrencias mes a mes.
 *   transacao -> as duas pernas em `financial_transactions`, agora.
 *
 * Existe como funcao pura pelo mesmo motivo de `destinoDoLancamento`: o ramo
 * errado nao da erro, da uma gravacao no lugar errado. Uma transferencia fixa
 * que caia em "transacao" move o dinheiro UMA vez e a pessoa acha que agendou;
 * uma pontual que caia em "regra" nao move dinheiro nenhum hoje e comeca a mover
 * todo mes.
 */
export type DestinoDaTransferencia = "regra" | "transacao";

export function destinoDaTransferencia(
  valores: ValoresDeTransferencia
): DestinoDaTransferencia {
  return camposDaTransferencia(valores).diaDeVencimento &&
    valores.natureza === "fixed"
    ? "regra"
    : "transacao";
}

export type ValidacaoDaTransferencia =
  | { ok: true }
  | { ok: false; mensagem: string };

/**
 * A transferencia pode ser enviada?
 *
 * Roda na tela, antes do POST, para que o erro apareca no formulario em vez de
 * voltar do servidor. A rota repete a checagem das contas com os dados do banco
 * -- esta aqui so ve o que o formulario tem, e `account_type` vindo do cliente
 * nao decide regra de dinheiro.
 *
 * A ordem das recusas importa: a mais especifica primeiro, porque a mensagem
 * generica manda a pessoa procurar no campo errado.
 */
export function validarTransferencia(
  valores: ValoresDeTransferencia,
  contas: ContaDaTransferencia[] = []
): ValidacaoDaTransferencia {
  if (!valores.descricao.trim()) {
    return { ok: false, mensagem: "Informe a descrição." };
  }

  const problema = validarContasDaTransferencia(
    valores.origemId
      ? contas.find((c) => c.id === valores.origemId) ?? { id: valores.origemId }
      : undefined,
    valores.destinoId
      ? contas.find((c) => c.id === valores.destinoId) ?? {
          id: valores.destinoId,
        }
      : undefined
  );
  if (problema) {
    return { ok: false, mensagem: mensagemDaTransferencia(problema) };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(valores.data)) {
    return { ok: false, mensagem: "Informe a data." };
  }

  const valor = Number.parseFloat(valores.valor);
  if (!Number.isFinite(valor) || valor <= 0) {
    return { ok: false, mensagem: "Valor deve ser maior que zero." };
  }

  // A RECORRENCIA (HMO-172). As recusas saem de `camposDaTransferencia`, e nao
  // de `natureza === "fixed"` repetido: o que esta na TELA e o que pode ser
  // cobrado. Perguntar pelo dia do vencimento com o campo escondido daria um
  // erro que a pessoa nao tem como consertar.
  const campos = camposDaTransferencia(valores);

  if (campos.diaDeVencimento) {
    const dia = Number(valores.diaDeVencimento);
    // O CHECK da 005 e `due_day >= 1 AND due_day <= 31`. Recusar aqui e o que
    // transforma um 23514 sem traducao numa frase que diz o que fazer.
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
      return { ok: false, mensagem: "Escolha o dia do vencimento, de 1 a 31." };
    }
  }

  if (campos.duracao && valores.duracao === "contada") {
    const meses = Number(valores.mesesDeRepeticao);
    // `max_occurrences` tem `CHECK (> 0)` na 005, entao 0 nao e "sem fim" -- o
    // sem fim e NULL, e quem o escolhe e a duracao "indefinida". Um 0 que
    // chegasse ao banco seria recusado; um 0 aceito aqui viraria uma regra que
    // nunca gera ocorrencia.
    if (!Number.isInteger(meses) || meses < 1 || meses > MAX_MESES_DE_REPETICAO) {
      return {
        ok: false,
        mensagem: `Por quantos meses? Informe de 1 a ${MAX_MESES_DE_REPETICAO}.`,
      };
    }
  }

  return { ok: true };
}

/**
 * As contas que cabem em cada seletor.
 *
 * O cartao sai da ORIGEM e fica no DESTINO. Filtrar na tela e o que evita a
 * recusa depois do envio, mas nao substitui `validarContasDaTransferencia`: o
 * corpo do POST nao vem so da tela.
 */
export function contasDeOrigem<T extends { account_type?: string | null }>(
  contas: T[]
): T[] {
  return contas.filter((c) => c.account_type !== "credit_card");
}

/**
 * O corpo do POST /api/recurring-rules para uma transferencia fixa (HMO-172).
 *
 * Tres coisas que nao podem sair daqui, e o que cada uma custa se sair:
 *
 *   1. `amount` vai POSITIVO. `recurring_rules` tem `CHECK (amount > 0)` (005),
 *      e a regra nao TEM sinal: quem aplica os dois sinais e a baixa, por
 *      `pernasDaTransferencia`. Mandar negativo faria o banco recusar com uma
 *      mensagem que a tela nao sabe traduzir.
 *   2. `account_id` e a ORIGEM e `destination_account_id` e o DESTINO, nessa
 *      ordem. Trocar os dois nao da erro em lugar nenhum -- o CHECK da 038 so
 *      exige que sejam diferentes -- e a transferencia passa a andar para tras
 *      todo mes. E o unico defeito desta funcao que nenhuma trava pega, e por
 *      isso ele tem mutante proprio.
 *   3. `transaction_type: "transfer"` literal, nao um parametro. E ele que faz a
 *      baixa gravar DUAS pernas; uma regra de transferencia que chegue ao banco
 *      como 'expense' materializa uma perna negativa e nada acusa.
 *
 * `max_occurrences` e o numero de MESES porque a frequencia e mensal -- a mesma
 * equivalencia de `regraDeRecorrencia`, e ela deixa de valer no dia em que a
 * tela oferecer outra frequencia.
 */
export function regraDeTransferenciaRecorrente(
  valores: ValoresDeTransferencia,
  categoriaId: string
): {
  description: string;
  amount: number;
  category_id: string;
  account_id: string;
  destination_account_id: string;
  transaction_type: "transfer";
  frequency: "monthly";
  due_day: number;
  start_date: string;
  max_occurrences: number | null;
  notes: string | null;
  group_id: null;
} {
  return {
    description: valores.descricao,
    amount: Math.abs(Number.parseFloat(valores.valor)),
    // A categoria reservada do 023, a mesma das pernas de uma transferencia
    // pontual. Ela nao vem da tela porque transferencia nao tem categoria: quem
    // a resolve e a rota, lendo o seed.
    category_id: categoriaId,
    account_id: valores.origemId,
    destination_account_id: valores.destinoId,
    transaction_type: "transfer",
    frequency: "monthly",
    due_day: Number(valores.diaDeVencimento),
    start_date: valores.data,
    max_occurrences:
      valores.duracao === "contada" ? Number(valores.mesesDeRepeticao) : null,
    notes: valores.notas || null,
    // `group_id: null` SEMPRE, como nas pernas da transferencia pontual.
    // Transferencia entre contas proprias nao e despesa compartilhada, e os
    // triggers de grupo criariam rateio para ela -- cobrando dos outros membros
    // um valor que eles ja rateiam nas COMPRAS.
    group_id: null,
  };
}

/** Por que esta ocorrencia prevista nao pode virar transferencia. */
export type ProblemaDaBaixaDeTransferencia =
  | "sem_origem"
  | "sem_destino"
  | "mesma_conta";

/**
 * Esta conta prevista esta em condicao de virar as duas pernas? (HMO-172)
 *
 * POR QUE ISTO E CONFERIDO DE NOVO, SE A 038 JA TEM O CHECK
 * ---------------------------------------------------------
 * Porque a ordem da baixa e "grava a saida, grava a entrada, marca como paga", e
 * nao existe transacao de banco entre os passos (o supabase-js fala PostgREST,
 * uma requisicao por vez). Descobrir no segundo passo que nao ha destino deixaria
 * a perna de SAIDA no saldo da conta -- metade de uma transferencia, que e
 * exatamente o estado que a issue existe para impedir. O CHECK da 038 protege a
 * TABELA da agenda; esta funcao protege a SEQUENCIA da baixa.
 *
 * O caso que o CHECK da 038 nao alcanca e o banco em que ela ainda NAO foi
 * colada. O deploy publica codigo, nao schema -- as duas coisas andam separadas
 * neste projeto --, entao existe uma janela em que a rota nova fala com o banco
 * velho: ali a coluna nem existe, `conta.destination_account_id` chega
 * `undefined`, e sem esta guarda a baixa gravaria a perna de saida sozinha e so
 * falharia no passo seguinte. A recusa com mensagem e o unico comportamento
 * honesto nessa janela.
 */
export function validarBaixaDeTransferencia(conta: {
  account_id?: string | null;
  destination_account_id?: string | null;
}): ProblemaDaBaixaDeTransferencia | null {
  if (!conta.account_id) return "sem_origem";
  if (!conta.destination_account_id) return "sem_destino";
  if (conta.account_id === conta.destination_account_id) return "mesma_conta";
  return null;
}

/**
 * Mensagem da recusa da baixa. Nao reusa `mensagemDaTransferencia` porque a
 * pessoa aqui nao esta preenchendo um formulario -- ela clicou "confirmar" numa
 * conta prevista que o banco ja tem --, e "Escolha de qual conta o dinheiro
 * saiu" mandaria procurar um campo que nao esta na tela.
 */
export function mensagemDaBaixaDeTransferencia(
  problema: ProblemaDaBaixaDeTransferencia
): string {
  switch (problema) {
    case "sem_origem":
      return "Esta transferência prevista não diz de qual conta o dinheiro sai. Edite-a antes de confirmar.";
    case "sem_destino":
      return "Esta transferência prevista não diz para qual conta o dinheiro vai. Edite-a antes de confirmar.";
    case "mesma_conta":
      return "A conta de destino desta transferência é igual à de origem. Edite-a antes de confirmar.";
  }
}

/** A rota da tela. Existe para que ninguem escreva a string na mao. */
export const ROTA_DA_TRANSFERENCIA = "/dashboard/movimentacoes/transferencia";
