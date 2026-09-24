// =====================================================
// TIPOS DO SISTEMA FINANCEIRO
// Baseado no schema COMPLETE_SCHEMA.sql
// =====================================================

// Enums do banco de dados
export type TransactionFinancialType = "income" | "expense" | "transfer";
export type AccountType =
  | "checking" // Conta corrente
  | "savings" // Conta poupança
  | "credit_card" // Cartão de crédito
  | "debit_card" // Cartão de débito
  | "cash" // Dinheiro
  | "digital" // PIX/TED/DOC
  | "investment" // Conta investimento
  | "other"; // Outros

export type GroupSplitType = "equal" | "percentage" | "custom" | "proportional";
export type GroupRole = "admin" | "member";
export type GroupMemberStatus = "active" | "inactive" | "pending" | "removed";
export type InviteMethod = "email" | "phone" | "code" | "request";
export type InviteStatus = "pending" | "accepted" | "rejected" | "expired";
export type SplitStatus = "pending" | "approved" | "rejected" | "expired";

// Interfaces principais
export interface Profile {
  id: string;
  full_name?: string;
  email?: string;
  phone?: string;
  avatar_url?: string;
  birth_date?: string;
  preferences: {
    currency: string;
    timezone: string;
    language: string;
    notifications: {
      email: boolean;
      push: boolean;
      financial_alerts: boolean;
    };
  };
  created_at: string;
  updated_at: string;
}

export interface FinancialService {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color_hex: string;
  is_active: boolean;
  created_at: string;
}

export interface TransactionCategory {
  id: string;
  service_id: string;
  name: string;
  description?: string;
  icon?: string;
  color_hex: string;
  is_expense: boolean; // true para despesa, false para receita
  is_active: boolean;
  created_at: string;
  service?: FinancialService;
}

export interface FinancialAccount {
  id: string;
  user_id: string;
  name: string;
  account_type: AccountType;
  bank_name?: string;
  last_four_digits?: string;
  credit_limit?: number;
  current_balance: number;
  is_active: boolean;
  color_hex: string;
  icon: string;
  /** Cartao (migration 006): dia do fechamento da fatura. */
  closing_day?: number;
  /** Cartao (migration 006): dia do vencimento da fatura. */
  due_day?: number;
  created_at: string;
  updated_at: string;
}

export interface FinancialTransaction {
  id: string;
  user_id: string;
  service_id: string;
  category_id: string;
  account_id?: string;
  description: string;
  amount: number;
  transaction_date: string; // Date string
  transaction_type?: TransactionFinancialType;
  attachment_url?: string;
  notes?: string;
  is_shared: boolean;
  installment_parent_id?: string;
  group_id?: string;
  /**
   * A outra perna de uma transferencia entre contas proprias (migration 015).
   * Hoje so o pagamento de fatura usa: a perna que quita o cartao aponta para a
   * que tirou o dinheiro da conta. Ver lib/card-invoice.ts.
   */
  counterpart_transaction_id?: string;
  created_at: string;
  updated_at: string;

  // Relacionamentos
  service?: FinancialService;
  category?: TransactionCategory;
  account?: FinancialAccount;
}

export interface ExpenseGroup {
  id: string;
  name: string;
  description?: string;
  photo_url?: string;
  group_code: string;
  group_type: "public" | "private";
  default_split_type: GroupSplitType;
  created_by: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  role: GroupRole;
  status: GroupMemberStatus;
  percentage: number;
  joined_at: string;
  updated_at: string;

  // Relacionamentos
  user?: Profile;
  group?: ExpenseGroup;
}

export interface TransactionInstallment {
  id: string;
  user_id: string;
  parent_transaction_id?: string;
  account_id?: string;
  category_id: string;
  description: string;
  total_amount: number;
  installment_amount: number;
  installment_number: number;
  total_installments: number;
  due_date: string; // Date string
  paid_date?: string; // Date string
  transaction_type: TransactionFinancialType;
  group_id?: string;
  group_split_type?: GroupSplitType;
  notes?: string;
  attachment_url?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;

  // Relacionamentos
  category?: TransactionCategory;
  account?: FinancialAccount;
  group?: ExpenseGroup;
}

export interface ExpenseSplit {
  id: string;
  transaction_id: string;
  participant_id: string;
  percentage: number;
  amount: number;
  status: SplitStatus;
  approved_at?: string;
  rejection_reason?: string;
  comments?: string;
  created_at: string;
  updated_at: string;

  // Relacionamentos
  transaction?: FinancialTransaction;
  participant?: Profile;
}

export interface UserBalance {
  id: string;
  creditor_id: string; // Quem tem a receber
  debtor_id: string; // Quem deve
  amount: number; // Valor líquido da dívida
  last_updated: string;

  // Relacionamentos
  creditor?: Profile;
  debtor?: Profile;
}

// Tipos para formulários
export interface NewTransactionForm {
  description: string;
  amount: number;
  transaction_date: string;
  category_id: string;
  account_id?: string | null;
  transaction_type?: TransactionFinancialType;
  notes?: string;
  is_shared: boolean;

  // Para parcelamento
  is_installment: boolean;
  installment_count?: number;

  // Para grupos (se is_shared = true)
  group_id?: string;
  split_type?: GroupSplitType;
  participants?: Array<{
    user_id: string;
    percentage?: number;
    amount?: number;
  }>;
}

export interface NewInstallmentForm {
  description: string;
  total_amount: number;
  total_installments: number;
  first_due_date: string;
  category_id: string;
  account_id?: string;
  transaction_type: TransactionFinancialType;
  notes?: string;

  // Para grupos
  group_id?: string;
  group_split_type?: GroupSplitType;
}

// Tipos para API responses
export interface CreateTransactionResponse {
  success: boolean;
  transaction?: FinancialTransaction;
  installments?: TransactionInstallment[];
  error?: string;
}

export interface DashboardData {
  total_balance: number;
  monthly_income: number;
  monthly_expenses: number;
  recent_transactions: FinancialTransaction[];
  accounts: FinancialAccount[];
  categories: TransactionCategory[];
  services: FinancialService[];
}

// Tipos utilitários
export interface CategoryWithService extends TransactionCategory {
  service: FinancialService;
}

export interface TransactionWithDetails extends FinancialTransaction {
  category: TransactionCategory;
  account?: FinancialAccount;
  service: FinancialService;
}

export interface GroupWithMembers extends ExpenseGroup {
  members: Array<GroupMember & { user: Profile }>;
  member_count: number;
}

// =====================================================
// GASTOS FIXOS E CONTAS PREVISTAS (migration 005)
// =====================================================
// A regra guarda "aluguel, todo dia 10, R$ 2.500"; a ocorrencia guarda
// "aluguel de outubro, vence 10/10, ainda nao pago". Editar a regra nao
// reescreve o passado, e cada ocorrencia pode ter valor proprio (conta de luz).

export type RecurrenceFrequency =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "bimonthly"
  | "quarterly"
  | "semiannual"
  | "annual";

/** `overdue` nunca e gravado: e derivado de due_date < hoje (view _effective). */
export type ScheduledStatus =
  | "pending"
  | "paid"
  | "overdue"
  | "skipped"
  | "cancelled";

export interface RecurringRule {
  id: string;
  user_id: string;
  category_id: string;
  account_id?: string;
  group_id?: string;
  description: string;
  amount: number;
  transaction_type: TransactionFinancialType;
  frequency: RecurrenceFrequency;
  interval_count: number;
  due_day?: number;
  start_date: string;
  end_date?: string;
  max_occurrences?: number;
  reminder_days: number;
  auto_post: boolean;
  is_active: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;

  // Relacionamentos
  category?: TransactionCategory;
  account?: FinancialAccount;
  group?: ExpenseGroup;
}

export interface ScheduledTransaction {
  id: string;
  user_id: string;
  recurring_rule_id?: string;
  category_id: string;
  account_id?: string;
  group_id?: string;
  description: string;
  amount: number;
  due_date: string;
  status: ScheduledStatus;
  paid_date?: string;
  transaction_id?: string;
  notes?: string;
  created_at: string;
  updated_at: string;

  /** Vem da view scheduled_transactions_effective, calculado na hora. */
  effective_status?: ScheduledStatus;
  /** Negativo = vencida ha N dias. */
  days_until_due?: number;

  // Relacionamentos
  category?: TransactionCategory;
  account?: FinancialAccount;
  group?: ExpenseGroup;
  recurring_rule?: RecurringRule;
}

export interface NewRecurringRuleForm {
  description: string;
  amount: number;
  category_id: string;
  account_id?: string;
  group_id?: string;
  transaction_type?: TransactionFinancialType;
  frequency?: RecurrenceFrequency;
  interval_count?: number;
  due_day?: number;
  start_date?: string;
  end_date?: string;
  max_occurrences?: number;
  reminder_days?: number;
  notes?: string;
}

export interface NewScheduledTransactionForm {
  description: string;
  amount: number;
  category_id: string;
  due_date: string;
  account_id?: string;
  group_id?: string;
  notes?: string;
}

/** Resumo do mes para a tela de contas previstas e o widget do dashboard. */
export interface ScheduledSummary {
  /** 'YYYY-MM' */
  month: string;
  total_pending: number;
  total_overdue: number;
  total_paid: number;
  /** Custo mensal normalizado das regras ativas (anual/12, semanal*52/12...). */
  fixed_monthly_cost: number;
  count_pending: number;
  count_overdue: number;
}

// =====================================================
// ORCAMENTO E FATURA DE CARTAO (migration 006)
// =====================================================
// Mesma logica da Fase 1: uma linha por mes. O teto de dezembro pode ser
// diferente sem reescrever o julgamento de agosto.

/** Derivado na leitura pela view budget_consumption; nunca gravado. */
export type BudgetConsumptionStatus = "ok" | "alert" | "exceeded";

export interface Budget {
  id: string;
  user_id: string;
  category_id: string;
  /** NULL = orcamento pessoal. Preenchido = teto da casa/viagem. */
  group_id?: string;
  /** Sempre o primeiro dia do mes ('YYYY-MM-01'); o banco tem CHECK. */
  month: string;
  amount_limit: number;
  /** Fracao do teto que ja acende o alerta. 0.8 = avisa aos 80%. */
  alert_threshold: number;
  /** Se true, o app recria esta linha no mes seguinte. */
  carry_forward: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;

  // Relacionamentos
  category?: TransactionCategory;
  group?: ExpenseGroup;
}

/**
 * Budget + consumo, vindo da view budget_consumption.
 *
 * `spent` ja vem positivo: despesa e gravada NEGATIVA neste banco e a view
 * aplica ABS. Nao aplique Math.abs de novo em cima.
 */
export interface BudgetWithConsumption extends Budget {
  spent: number;
  /** amount_limit - spent. Negativo quando estourou. */
  remaining: number;
  /** spent / amount_limit, com 4 casas. 1.0 = no limite exato. */
  consumed_ratio: number;
  consumption_status: BudgetConsumptionStatus;
}

export interface NewBudgetForm {
  category_id: string;
  amount_limit: number;
  /** 'YYYY-MM' ou 'YYYY-MM-DD'; a API normaliza para o dia 1. */
  month?: string;
  group_id?: string;
  alert_threshold?: number;
  carry_forward?: boolean;
  notes?: string;
}

/**
 * Uma linha da fatura, vinda da view card_invoice_lines.
 *
 * `amount` e o valor cru (despesa negativa); `invoice_amount` e o valor com o
 * sinal invertido, que e o que se soma para obter o total da fatura -- assim a
 * compra soma e o estorno abate.
 */
export interface CardInvoiceLine {
  transaction_id: string;
  user_id: string;
  account_id: string;
  account_name: string;
  closing_day?: number;
  due_day?: number;
  category_id: string;
  description: string;
  amount: number;
  invoice_amount: number;
  transaction_date: string;
  transaction_type: TransactionFinancialType;
  group_id?: string;
  /** Primeiro dia do mes da fatura em que a compra caiu. */
  invoice_month: string;
  /** NULL quando o cartao nao tem due_day configurado. */
  invoice_due_date?: string;
}

/** Uma fatura fechada: as linhas de um cartao num mes, com o total. */
export interface CardInvoice {
  account_id: string;
  account_name: string;
  closing_day?: number;
  due_day?: number;
  /** 'YYYY-MM-01' */
  invoice_month: string;
  due_date?: string;
  /** Soma de invoice_amount: compras menos estornos. */
  total: number;
  line_count: number;
  lines: CardInvoiceLine[];
  /** Preenchido quando a fatura ja virou conta prevista (scheduled_transactions). */
  scheduled_transaction_id?: string;
}

/**
 * Projecao de saldo: onde a conta chega no fim do periodo se tudo que esta
 * previsto acontecer. E uma leitura -- nao existe tabela para isso.
 */
export interface AccountProjection {
  account_id: string;
  account_name: string;
  account_type: AccountType;
  /** Saldo de hoje, mantido por trigger. */
  current_balance: number;
  /** Contas previstas a pagar ate o fim do periodo (positivo = vai sair). */
  scheduled_out: number;
  /** Receitas previstas a receber ate o fim do periodo. */
  scheduled_in: number;
  /** current_balance - scheduled_out + scheduled_in. */
  projected_balance: number;
  /** True quando a projecao fecha no vermelho e o saldo de hoje nao esta. */
  goes_negative: boolean;
}

export interface ProjectionSummary {
  /** 'YYYY-MM-DD' - ate onde a projecao foi calculada. */
  through: string;
  current_total: number;
  projected_total: number;
  scheduled_out: number;
  scheduled_in: number;
  /** Contas vencidas ainda nao pagas; ja estao "fora" do previsto. */
  overdue_total: number;
  accounts: AccountProjection[];
}

// =====================================================
// METAS E RELATORIOS (008 - HMO-137 Fase 4)
// =====================================================

export type GoalStatus = "active" | "completed" | "paused" | "cancelled";

/**
 * Estado calculado na leitura, separado de `status` (que o usuario controla).
 * 'reached' aparece sozinho quando os aportes alcancam o alvo.
 */
export type GoalProgressStatus =
  | "on_track"
  | "reached"
  | "overdue"
  | "paused"
  | "cancelled";

export interface FinancialGoal {
  id: string;
  user_id: string;
  /** Meta de grupo (a viagem da familia); null = pessoal. */
  group_id: string | null;
  /** Onde o dinheiro esta guardado. Anotacao: o progresso vem dos aportes. */
  account_id: string | null;
  title: string;
  description: string | null;
  target_amount: number;
  /** 'YYYY-MM-DD'; null = meta sem prazo, que e valida. */
  target_date: string | null;
  status: GoalStatus;
  color_hex: string;
  icon: string;
  created_at: string;
  updated_at: string;
}

/** financial_goals + o progresso que a view goal_progress calcula. */
export interface GoalWithProgress extends FinancialGoal {
  /** Soma dos aportes. NUNCA o saldo da conta vinculada -- ver a migration 008. */
  saved: number;
  /** Nunca negativo: quem passou da meta ve 0, nao um valor negativo. */
  remaining: number;
  /** Fracao com 4 casas (0.1667 = 16,67%). */
  progress_ratio: number;
  contribution_count: number;
  last_contribution_at: string | null;
  /** Meses cheios ate o prazo; null quando a meta nao tem prazo. */
  months_left: number | null;
  /** Quanto por mes para chegar no prazo; null sem prazo, 0 se ja alcancou. */
  monthly_required: number | null;
  progress_status: GoalProgressStatus;
  account?: Pick<
    FinancialAccount,
    "id" | "name" | "account_type" | "color_hex"
  > | null;
}

export interface GoalContribution {
  id: string;
  goal_id: string;
  /** Quem aportou. Numa meta de grupo, cada membro aporta o seu. */
  user_id: string;
  /** Sempre positivo (CHECK do 008). Retirada se faz apagando o aporte. */
  amount: number;
  contributed_at: string;
  notes: string | null;
  created_at: string;
  user?: { id: string; full_name: string | null; avatar_url?: string | null } | null;
  is_mine?: boolean;
}

export interface NewGoalForm {
  title: string;
  description: string;
  target_amount: string;
  target_date: string;
  account_id: string;
  group_id: string;
}

// ---- Relatorios ----

export interface CashFlowMonth {
  /** 'YYYY-MM-01'. */
  month: string;
  income: number;
  /** POSITIVO. A view aplica ABS; despesa e gravada negativa no banco. */
  expense: number;
  net: number;
  transaction_count: number;
}

export interface CashFlowReport {
  months: CashFlowMonth[];
  summary: {
    total_income: number;
    total_expense: number;
    net: number;
    /** Denominador das medias: meses COM movimento, nao a janela inteira. */
    months_with_activity: number;
    average_expense: number;
    average_income: number;
  };
  window: { from: string; to: string; months: number };
}

export interface CategoryTotal {
  category_id: string;
  category: Pick<
    TransactionCategory,
    "id" | "name" | "icon" | "color_hex" | "is_expense"
  > | null;
  expense: number;
  income: number;
  transaction_count: number;
  /** Fatia do gasto total, 0..1. Zero quando nao houve gasto no periodo. */
  share: number;
}

export interface CategoryReport {
  categories: CategoryTotal[];
  by_month: {
    month: string;
    category_id: string;
    category_name: string;
    expense: number;
    income: number;
  }[];
  summary: { total_expense: number; category_count: number };
  window: { from: string; to: string; months: number };
}

export interface PlannedVsActualMonth {
  month: string;
  planned_expense: number;
  planned_income: number;
  actual_expense: number;
  actual_income: number;
  /** Positivo = gastou mais do que tinha previsto. */
  expense_variance: number;
  pending_count: number;
  overdue_count: number;
}

export interface PlannedVsActualReport {
  months: PlannedVsActualMonth[];
  summary: {
    total_planned_expense: number;
    total_actual_expense: number;
    variance: number;
    months_with_plan: number;
    overdue_count: number;
  };
  window: { from: string; to: string; months: number };
}

export interface NetWorthMonth {
  month: string;
  net_change: number;
  /** Patrimonio no fim do mes, reconstruido de tras para frente. */
  net_worth: number;
}

export interface NetWorthReport {
  months: NetWorthMonth[];
  accounts: FinancialAccount[];
  summary: {
    current: number;
    change_in_window: number;
    total_saved: number;
  };
  /**
   * A variacao mes a mes e exata; o NIVEL da curva herda a deriva de
   * current_balance. A tela mostra este texto -- esconde-lo faria o usuario
   * decidir sobre um numero que o proprio app sabe que pode estar errado.
   */
  caveat: string;
  window: { from: string; to: string; months: number };
}
