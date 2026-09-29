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
 * natureza, parcelamento nem rateio, e carregar os campos mortos so para
 * reaproveitar a forma foi como a tela antiga acabou escondendo tres telas
 * dentro de uma.
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
}

export function valoresIniciaisDeTransferencia(): ValoresDeTransferencia {
  return {
    descricao: "",
    valor: "",
    origemId: "",
    destinoId: "",
    data: new Date().toISOString().split("T")[0],
    notas: "",
  };
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

/** A rota da tela. Existe para que ninguem escreva a string na mao. */
export const ROTA_DA_TRANSFERENCIA = "/dashboard/movimentacoes/transferencia";
