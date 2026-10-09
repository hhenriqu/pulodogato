// -----------------------------------------------------------------------------
// COMECAR DO ZERO SEM PERDER A CONTA
// -----------------------------------------------------------------------------
// "Um botao para excluir tudo e comecar do zero como se fosse uma conta nova"
// (HMO-159). Este modulo e o PLANO desse apagamento -- a lista de tabelas, na
// ordem, com o motivo de cada posicao. Quem executa e
// app/api/account/reset/route.ts; aqui nao ha cliente de banco nenhum, de
// proposito: a ordem e a parte que da para provar num teste, e um teste que
// precisasse de Postgres nao rodaria no CI que roda em todo PR.
//
// O QUE ESTE RESET NAO FAZ, E POR QUE
// -----------------------------------
// 1. NAO apaga a conta de acesso (auth.users) nem o perfil. O pedido e
//    "comecar do zero", nao "sumir": a pessoa continua logada, com o mesmo
//    email e a mesma assinatura. Apagar o perfil derrubaria junto a assinatura
//    gratuita, que nasce de um trigger AFTER INSERT ON profiles -- a conta
//    voltaria sem plano, e nada na tela diria por que.
//
// 2. NAO apaga, nem abandona, GRUPO DE DESPESA. Um grupo tem outras pessoas
//    dentro. Apagar um grupo a partir de um botao que diz "limpar MEUS dados"
//    destruiria o historico de quem nunca clicou em nada; sair do grupo
//    calado deixaria uma divida em aberto sem ninguem saber. As duas coisas
//    sao decisoes que tem tela propria, com as consequencias escritas. O reset
//    conta quantos grupos sobraram e manda o usuario para la.
//
//    A consequencia honesta disso -- e ela precisa estar na tela: apagar as
//    transacoes do usuario MUDA o saldo dos grupos em que ele esta, porque a
//    parte dele nas despesas compartilhadas vai junto. O dado e dele, e vai
//    embora; o efeito atravessa para os outros membros.
//
// 3. NAO recria as quatro contas padrao. Nao precisa: `create_default_accounts`
//    ja e chamada pelo GET /api/financial-accounts quando o usuario nao tem
//    conta nenhuma, e ela mesma verifica isso antes de inserir. Depois do
//    reset, a primeira visita ao painel recria Conta Corrente, Cartao de
//    Credito, Dinheiro e PIX zeradas -- literalmente o estado de conta nova.
//    Recriar aqui tambem so criaria um segundo lugar com a mesma regra.
//
// POR QUE O APAGAMENTO USA A SESSAO DO USUARIO, E NAO A CHAVE DE SERVICO
// ----------------------------------------------------------------------
// A chave de servico tem BYPASSRLS. Com ela, um `user_id` errado numa unica
// linha deste plano -- um copiar-e-colar, uma coluna que mudou de nome --
// apaga o dado de OUTRA pessoa, e a operacao termina com sucesso. Com a sessao
// do usuario, a mesma linha errada apaga zero linhas: a policy de DELETE de
// cada tabela ja exige `user_id = auth.uid()`. O pior caso deixa de ser
// "destruiu o banco" e passa a ser "nao apagou tudo", que a propria resposta
// da rota denuncia por contagem.
//
// Todas as tabelas deste plano tem policy de DELETE para `authenticated`
// restrita ao dono (002_rls_lockdown e seguintes). Nenhuma depende de
// service_role.
// -----------------------------------------------------------------------------

/** Um passo do apagamento: uma tabela, filtrada pela coluna do dono. */
export interface PassoDeReset {
  /** Nome da tabela em public. */
  tabela: string;
  /** Coluna que carrega o id do dono. */
  coluna: string;
  /** Como o passo aparece no relatorio devolvido ao usuario. */
  rotulo: string;
  /**
   * Tabelas DESTE plano que esta tabela referencia por chave estrangeira sem
   * ON DELETE CASCADE -- ou seja, as que precisam ser apagadas DEPOIS dela.
   *
   * Este campo nao e documentacao: e o que
   * scripts/test-account-reset.mjs confere. Sem ele, a unica forma de
   * descobrir que a ordem quebrou seria um usuario clicando no botao e
   * recebendo `violates foreign key constraint` no meio do caminho -- com
   * parte do dado ja apagado e parte nao, que e o pior estado possivel para
   * uma operacao destrutiva.
   */
  apontaPara: string[];
}

/**
 * A ordem do apagamento: filhos antes dos pais.
 *
 * A armadilha que fixa esta ordem esta em 001_baseline:
 *
 *   financial_transactions_account_id_fkey
 *     FOREIGN KEY (account_id) REFERENCES financial_accounts(id);
 *
 * Sem `ON DELETE` nenhum -- ou seja, NO ACTION. Apagar `financial_accounts`
 * antes das transacoes nao cascateia: levanta erro. O mesmo vale para
 * recurring_rules e scheduled_transactions, que tambem apontam para contas sem
 * cascata.
 */
export const PLANO_DE_RESET: PassoDeReset[] = [
  {
    tabela: "receipts",
    coluna: "user_id",
    rotulo: "Comprovantes",
    apontaPara: ["financial_transactions", "scheduled_transactions"],
  },
  {
    tabela: "bill_notifications",
    coluna: "user_id",
    rotulo: "Avisos de conta",
    apontaPara: ["scheduled_transactions", "detected_recurrences"],
  },
  {
    tabela: "goal_contributions",
    coluna: "user_id",
    rotulo: "Aportes em metas",
    apontaPara: ["financial_goals"],
  },
  {
    tabela: "financial_goals",
    coluna: "user_id",
    rotulo: "Metas",
    apontaPara: ["financial_accounts"],
  },
  {
    tabela: "budgets",
    coluna: "user_id",
    rotulo: "Orçamentos",
    apontaPara: [],
  },
  {
    tabela: "scheduled_transactions",
    coluna: "user_id",
    rotulo: "Contas previstas",
    apontaPara: [
      "recurring_rules",
      "financial_accounts",
      "financial_transactions",
    ],
  },
  {
    tabela: "recurring_rules",
    coluna: "user_id",
    rotulo: "Recorrências cadastradas",
    apontaPara: ["financial_accounts"],
  },
  {
    tabela: "detected_recurrences",
    coluna: "user_id",
    rotulo: "Assinaturas detectadas",
    apontaPara: [],
  },
  {
    tabela: "categorization_rules",
    coluna: "user_id",
    rotulo: "Regras de categorização",
    apontaPara: [],
  },
  {
    // payroll_deductions vai junto: FK com ON DELETE CASCADE para
    // payroll_entries. Nao aparece como passo proprio porque um passo que
    // sempre apaga zero linhas (as filhas ja foram) daria um relatorio
    // mentiroso -- "Descontos: 0" com holerite cheio de descontos.
    tabela: "payroll_entries",
    coluna: "user_id",
    rotulo: "Holerites",
    apontaPara: ["financial_accounts", "financial_transactions"],
  },
  {
    // statement_entries vai junto, por CASCADE a partir do import.
    tabela: "statement_imports",
    coluna: "user_id",
    rotulo: "Extratos importados",
    apontaPara: ["financial_accounts"],
  },
  // PARCELAMENTO NAO TEM PASSO PROPRIO, E NAO E ESQUECIMENTO (HMO-225).
  //
  // Ate a HMO-358 havia um passo para `transaction_installments`. A tabela ficou
  // orfa: desde a 035 a serie parcelada e materializada em
  // `financial_transactions` (uma linha por mes de fatura), entao as parcelas de
  // hoje ja sao apagadas no passo de `financial_transactions` abaixo. Um passo
  // proprio para a tabela antiga so produziria "Parcelamentos: 0" num relatorio
  // de quem acabou de apagar uma compra em 10x -- o mesmo relatorio mentiroso
  // que o comentario de `payroll_deductions` acima descreve.
  {
    // group_transactions e expense_splits cascateiam a partir daqui.
    //
    // O apagamento das transacoes dispara os triggers de saldo do baseline,
    // que recalculam financial_accounts.current_balance e os saldos de grupo.
    // Isso e desejado: as contas ficam zeradas ANTES de serem apagadas no
    // passo seguinte, e o saldo dos grupos passa a refletir que a parte deste
    // usuario nao existe mais.
    tabela: "financial_transactions",
    coluna: "user_id",
    rotulo: "Lançamentos",
    apontaPara: ["financial_accounts"],
  },
  {
    tabela: "financial_accounts",
    coluna: "user_id",
    rotulo: "Contas e cartões",
    apontaPara: [],
  },
  {
    tabela: "push_subscriptions",
    coluna: "user_id",
    rotulo: "Dispositivos com notificação",
    apontaPara: [],
  },
  {
    tabela: "notification_preferences",
    coluna: "user_id",
    rotulo: "Preferências de notificação",
    apontaPara: [],
  },
];

/**
 * O que o usuario precisa digitar para o botao funcionar.
 *
 * Um dialogo de "tem certeza?" com um botao vermelho e clicado no automatico
 * -- e esta operacao nao tem desfazer. Digitar a frase e o unico atrito que
 * separa "quero limpar tudo" de "cliquei sem ler". Em portugues e sem acento
 * de proposito: a comparacao ja normaliza, mas a frase que aparece na tela
 * tem que ser digitavel em qualquer teclado, inclusive o do celular.
 */
export const FRASE_DE_CONFIRMACAO = "APAGAR TUDO";

/**
 * Confere a frase digitada.
 *
 * Aceita espaco sobrando nas pontas e qualquer caixa -- teclado de celular
 * capitaliza sozinho, e reprovar "Apagar tudo" seria um atrito sem proposito,
 * que so ensina a pessoa a copiar e colar. O que a frase precisa garantir e
 * INTENCAO, e quem digitou "apagar tudo" teve a intencao.
 */
export function confirmacaoValida(digitado: unknown): boolean {
  if (typeof digitado !== "string") return false;
  return (
    digitado.trim().toLocaleUpperCase("pt-BR") ===
    FRASE_DE_CONFIRMACAO.toLocaleUpperCase("pt-BR")
  );
}

/** O resultado de um passo, como volta para a tela. */
export interface ResultadoDePasso {
  tabela: string;
  rotulo: string;
  /** Linhas apagadas, ou null quando o passo falhou. */
  apagadas: number | null;
  erro?: string;
}

/**
 * Le o relatorio dos passos e diz se o reset terminou inteiro.
 *
 * Separado da rota porque e a pergunta que a TELA faz, e ela nao pode
 * responder "deu certo" so porque a resposta chegou com HTTP 200. Um reset
 * parcial -- tres tabelas apagadas, a quarta recusada pela RLS -- deixa a
 * conta num estado que nao e nem o antigo nem o novo, e e exatamente o estado
 * que precisa aparecer escrito na tela em vez de virar um "pronto!".
 */
export function resetCompleto(passos: ResultadoDePasso[]): boolean {
  return passos.length > 0 && passos.every((p) => p.apagadas !== null);
}

/** Quantas linhas o reset apagou ao todo, ignorando os passos que falharam. */
export function totalApagado(passos: ResultadoDePasso[]): number {
  return passos.reduce((soma, p) => soma + (p.apagadas ?? 0), 0);
}
