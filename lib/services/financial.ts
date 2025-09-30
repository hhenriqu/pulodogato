import { createClient } from "@/utils/supabase/client";
import {
  FinancialTransaction,
  TransactionCategory,
  FinancialAccount,
  FinancialService,
  NewTransactionForm,
  CreateTransactionResponse,
  DashboardData,
  CategoryWithService,
  TransactionWithDetails,
} from "@/types/financial";

const supabase = createClient();

// =====================================================
// SERVIÇOS FINANCEIROS
// =====================================================

export const financialServices = {
  // Buscar todos os serviços ativos
  async getServices(): Promise<FinancialService[]> {
    const { data, error } = await supabase
      .from("financial_services")
      .select("*")
      .eq("is_active", true)
      .order("name");

    if (error) throw new Error(`Erro ao buscar serviços: ${error.message}`);
    return data || [];
  },

  // Buscar categorias por serviço
  async getCategories(serviceId?: string): Promise<CategoryWithService[]> {
    let query = supabase
      .from("transaction_categories")
      .select(
        `
        *,
        service:financial_services(*)
      `
      )
      .eq("is_active", true);

    if (serviceId) {
      query = query.eq("service_id", serviceId);
    }

    const { data, error } = await query.order("name");

    if (error) throw new Error(`Erro ao buscar categorias: ${error.message}`);
    return data || [];
  },

  // Buscar contas do usuário
  async getAccounts(): Promise<FinancialAccount[]> {
    const { data, error } = await supabase
      .from("financial_accounts")
      .select("*")
      .eq("is_active", true)
      .order("name");

    if (error) throw new Error(`Erro ao buscar contas: ${error.message}`);
    return data || [];
  },
};

// =====================================================
// TRANSAÇÕES FINANCEIRAS
// =====================================================

export const transactionServices = {
  // Criar nova transação (usando API HTTP que tem sincronização com grupos)
  async createTransaction(
    transaction: NewTransactionForm
  ): Promise<CreateTransactionResponse> {
    try {
      // Preparar dados para a API
      const requestData = {
        description: transaction.description,
        amount: transaction.amount,
        transaction_date: transaction.transaction_date,
        category_id: transaction.category_id,
        account_id: transaction.account_id || null,
        transaction_type: transaction.transaction_type,
        notes: transaction.notes || null,
        is_shared: transaction.is_shared || false,
        group_id: transaction.group_id || null,
        // Para parcelamento (se implementado na API futuramente)
        is_installment: transaction.is_installment || false,
        installment_count: transaction.installment_count || undefined,
      };

      console.log("🚀 Enviando transação para API:", requestData);

      const response = await fetch("/api/personal-finance/transactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestData),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Erro ao criar transação");
      }

      console.log("✅ Transação criada com sucesso:", result);

      return {
        success: true,
        transaction: result.transaction,
      };
    } catch (error: any) {
      console.error("❌ Erro ao criar transação:", error);
      return {
        success: false,
        error: error.message || "Erro ao criar transação",
      };
    }
  },

  // Buscar transações do usuário (usando API que inclui transações de grupos)
  async getTransactions(limit: number = 50): Promise<TransactionWithDetails[]> {
    try {
      const response = await fetch(
        `/api/personal-finance/transactions?limit=${limit}`
      );

      if (!response.ok) {
        throw new Error("Erro ao buscar transações");
      }

      const result = await response.json();
      return result.transactions || [];
    } catch (error: any) {
      console.error("Erro ao buscar transações:", error);
      throw new Error(`Erro ao buscar transações: ${error.message}`);
    }
  },

  // Buscar transações por período
  async getTransactionsByPeriod(
    startDate: string,
    endDate: string
  ): Promise<TransactionWithDetails[]> {
    const { data, error } = await supabase
      .from("financial_transactions")
      .select(
        `
        *,
        category:transaction_categories(*),
        account:financial_accounts(*),
        service:financial_services(*)
      `
      )
      .gte("transaction_date", startDate)
      .lte("transaction_date", endDate)
      .order("transaction_date", { ascending: false });

    if (error) throw new Error(`Erro ao buscar transações: ${error.message}`);
    return data || [];
  },

  // Deletar transação
  async deleteTransaction(id: string): Promise<void> {
    const { error } = await supabase
      .from("financial_transactions")
      .delete()
      .eq("id", id);

    if (error) throw new Error(`Erro ao deletar transação: ${error.message}`);
  },
};

// =====================================================
// DASHBOARD
// =====================================================

export const dashboardServices = {
  // Buscar dados do dashboard
  async getDashboardData(): Promise<DashboardData> {
    try {
      // Buscar dados em paralelo
      const [
        accountsResult,
        categoriesResult,
        servicesResult,
        transactionsResult,
        monthlyStatsResult,
      ] = await Promise.all([
        supabase.from("financial_accounts").select("*").eq("is_active", true),
        supabase
          .from("transaction_categories")
          .select("*, service:financial_services(*)")
          .eq("is_active", true),
        supabase.from("financial_services").select("*").eq("is_active", true),
        supabase
          .from("financial_transactions")
          .select(
            "*, category:transaction_categories(*), account:financial_accounts(*), service:financial_services(*)"
          )
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("financial_transactions")
          .select("amount, transaction_type")
          .gte(
            "transaction_date",
            new Date(new Date().getFullYear(), new Date().getMonth(), 1)
              .toISOString()
              .split("T")[0]
          ),
      ]);

      // Calcular estatísticas
      const monthlyTransactions = monthlyStatsResult.data || [];
      const monthlyIncome = monthlyTransactions
        .filter((t) => t.amount > 0)
        .reduce((sum, t) => sum + t.amount, 0);
      const monthlyExpenses = Math.abs(
        monthlyTransactions
          .filter((t) => t.amount < 0)
          .reduce((sum, t) => sum + t.amount, 0)
      );

      const totalBalance = (accountsResult.data || []).reduce(
        (sum, account) => sum + (account.current_balance || 0),
        0
      );

      return {
        total_balance: totalBalance,
        monthly_income: monthlyIncome,
        monthly_expenses: monthlyExpenses,
        recent_transactions: transactionsResult.data || [],
        accounts: accountsResult.data || [],
        categories: categoriesResult.data || [],
        services: servicesResult.data || [],
      };
    } catch (error: any) {
      throw new Error(`Erro ao buscar dados do dashboard: ${error.message}`);
    }
  },
};

// =====================================================
// CONTAS FINANCEIRAS
// =====================================================

export const accountServices = {
  // Criar contas padrão para novo usuário
  async createDefaultAccounts(): Promise<void> {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw new Error("Usuário não autenticado");

    const { error } = await supabase.rpc("create_default_accounts", {
      p_user_id: user.user.id,
    });

    if (error) throw new Error(`Erro ao criar contas padrão: ${error.message}`);
  },

  // Criar nova conta
  async createAccount(
    account: Omit<
      FinancialAccount,
      "id" | "user_id" | "created_at" | "updated_at"
    >
  ): Promise<FinancialAccount> {
    const { data, error } = await supabase
      .from("financial_accounts")
      .insert(account)
      .select()
      .single();

    if (error) throw new Error(`Erro ao criar conta: ${error.message}`);
    return data;
  },
};
