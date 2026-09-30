// TIPOS PARA SISTEMA DE PLANOS E ASSINATURAS
// =============================================

export type UserPlan = "admin" | "free" | "invest" | "trader";

export type PlanFeature =
  | "personal_finance" // Finanças pessoais básicas
  | "advanced_reports" // Relatórios avançados
  | "investment_tracking" // Acompanhamento de investimentos
  | "portfolio_analysis" // Análise de portfólio
  | "trading_signals" // Sinais de trading
  | "advanced_charts" // Gráficos avançados
  | "api_access" // Acesso à API
  | "priority_support" // Suporte prioritário
  | "unlimited_transactions" // Transações ilimitadas
  | "expense_groups" // Grupos de gastos
  | "financial_goals" // Metas financeiras
  | "investment_alerts" // Alertas de investimento
  | "tax_reports" // Relatórios fiscais
  | "custom_categories" // Categorias personalizadas
  | "data_export" // Exportação de dados
  | "multiple_portfolios" // Múltiplos portfólios
  | "real_time_data" // Dados em tempo real
  | "advanced_analytics" // Analytics avançados
  | "white_label" // White label (admin)
  | "user_management" // Gerenciamento de usuários (admin)
  | "system_monitoring"; // Monitoramento do sistema (admin)

export interface PlanLimits {
  maxTransactions: number | "unlimited";
  maxAccounts: number | "unlimited";
  maxCategories: number | "unlimited";
  maxPortfolios: number | "unlimited";
  maxExpenseGroups: number | "unlimited";
  dataRetentionMonths: number | "unlimited";
  apiRequestsPerMonth: number | "unlimited";
}

export interface PlanConfig {
  id: UserPlan;
  name: string;
  description: string;
  price: {
    monthly: number;
    yearly: number;
  };
  features: PlanFeature[];
  limits: PlanLimits;
  highlighted?: boolean;
  color: string;
}

// CONFIGURAÇÕES DOS PLANOS
// ========================

export const PLAN_CONFIGS: Record<UserPlan, PlanConfig> = {
  admin: {
    id: "admin",
    name: "Administrador",
    description: "Acesso total ao sistema para testes e desenvolvimento",
    price: { monthly: 0, yearly: 0 },
    features: [
      "personal_finance",
      "advanced_reports",
      "investment_tracking",
      "portfolio_analysis",
      "trading_signals",
      "advanced_charts",
      "api_access",
      "priority_support",
      "unlimited_transactions",
      "expense_groups",
      "financial_goals",
      "investment_alerts",
      "tax_reports",
      "custom_categories",
      "data_export",
      "multiple_portfolios",
      "real_time_data",
      "advanced_analytics",
      "white_label",
      "user_management",
      "system_monitoring",
    ],
    limits: {
      maxTransactions: "unlimited",
      maxAccounts: "unlimited",
      maxCategories: "unlimited",
      maxPortfolios: "unlimited",
      maxExpenseGroups: "unlimited",
      dataRetentionMonths: "unlimited",
      apiRequestsPerMonth: "unlimited",
    },
    color: "#8B5CF6",
  },

  free: {
    id: "free",
    name: "Gratuito",
    description: "Funcionalidades básicas de controle financeiro pessoal",
    price: { monthly: 0, yearly: 0 },
    features: ["personal_finance", "expense_groups", "financial_goals"],
    limits: {
      maxTransactions: 100,
      maxAccounts: 3,
      maxCategories: 20,
      maxPortfolios: 0,
      maxExpenseGroups: 2,
      dataRetentionMonths: 12,
      apiRequestsPerMonth: 0,
    },
    color: "#10B981",
  },

  invest: {
    id: "invest",
    name: "Investidor",
    description:
      "Para investidores que querem acompanhar e analisar seu portfólio",
    price: { monthly: 29.9, yearly: 299.0 },
    features: [
      "personal_finance",
      "advanced_reports",
      "investment_tracking",
      "portfolio_analysis",
      "unlimited_transactions",
      "expense_groups",
      "financial_goals",
      "investment_alerts",
      "tax_reports",
      "custom_categories",
      "data_export",
      "multiple_portfolios",
      "advanced_analytics",
    ],
    limits: {
      maxTransactions: "unlimited",
      maxAccounts: 10,
      maxCategories: 50,
      maxPortfolios: 5,
      maxExpenseGroups: 10,
      dataRetentionMonths: 60,
      apiRequestsPerMonth: 1000,
    },
    highlighted: true,
    color: "#3B82F6",
  },

  trader: {
    id: "trader",
    name: "Trader",
    // Ate a HMO-198 esta linha prometia sinal e dado em tempo real. Ela aparece
    // dentro do cartao, logo acima do preco de R$ 79,90 -- ou seja, anunciava o
    // recurso como pronto no mesmo lugar em que a lista de recursos anunciava.
    // Marcar so a lista teria deixado a promessa de pe duas linhas acima.
    description: "Plano completo para traders profissionais",
    price: { monthly: 79.9, yearly: 799.0 },
    features: [
      "personal_finance",
      "advanced_reports",
      "investment_tracking",
      "portfolio_analysis",
      "trading_signals",
      "advanced_charts",
      "api_access",
      "priority_support",
      "unlimited_transactions",
      "expense_groups",
      "financial_goals",
      "investment_alerts",
      "tax_reports",
      "custom_categories",
      "data_export",
      "multiple_portfolios",
      "real_time_data",
      "advanced_analytics",
    ],
    limits: {
      maxTransactions: "unlimited",
      maxAccounts: "unlimited",
      maxCategories: "unlimited",
      maxPortfolios: "unlimited",
      maxExpenseGroups: "unlimited",
      dataRetentionMonths: "unlimited",
      apiRequestsPerMonth: 10000,
    },
    color: "#F59E0B",
  },
};

// INTERFACE PARA ASSINATURA DO USUÁRIO
// ====================================

export interface UserSubscription {
  id: string;
  user_id: string;
  plan: UserPlan;
  status: "active" | "inactive" | "canceled" | "past_due" | "trialing";
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  trial_end?: string;
  payment_method?: string;
  created_at: string;
  updated_at: string;
}

// UTILITÁRIOS PARA VERIFICAÇÃO DE PERMISSÕES
// ===========================================

export function hasFeature(userPlan: UserPlan, feature: PlanFeature): boolean {
  return PLAN_CONFIGS[userPlan].features.includes(feature);
}

export function getPlanConfig(plan: UserPlan): PlanConfig {
  return PLAN_CONFIGS[plan];
}

export function canExceedLimit(
  userPlan: UserPlan,
  limitType: keyof PlanLimits,
  currentValue: number
): boolean {
  const limit = PLAN_CONFIGS[userPlan].limits[limitType];
  return limit === "unlimited" || currentValue < (limit as number);
}

export function getPlanColor(plan: UserPlan): string {
  return PLAN_CONFIGS[plan].color;
}

export function getPlanName(plan: UserPlan): string {
  return PLAN_CONFIGS[plan].name;
}

export function isPremiumPlan(plan: UserPlan): boolean {
  return plan === "invest" || plan === "trader" || plan === "admin";
}

export function isAdminPlan(plan: UserPlan): boolean {
  return plan === "admin";
}
