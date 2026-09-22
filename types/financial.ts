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
