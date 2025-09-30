import { useState, useEffect, useCallback } from "react";
import {
  FinancialTransaction,
  TransactionCategory,
  FinancialAccount,
  FinancialService,
  NewTransactionForm,
  DashboardData,
  CategoryWithService,
  TransactionWithDetails,
} from "@/types/financial";
import {
  financialServices,
  transactionServices,
  dashboardServices,
  accountServices,
} from "@/lib/services/financial";

// =====================================================
// HOOK PARA DADOS BÁSICOS
// =====================================================

export function useFinancialData() {
  const [services, setServices] = useState<FinancialService[]>([]);
  const [categories, setCategories] = useState<CategoryWithService[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [servicesData, categoriesData, accountsData] = await Promise.all([
        financialServices.getServices(),
        financialServices.getCategories(),
        financialServices.getAccounts(),
      ]);

      setServices(servicesData);
      setCategories(categoriesData);
      setAccounts(accountsData);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return {
    services,
    categories,
    accounts,
    loading,
    error,
    refetch: loadData,
  };
}

// =====================================================
// HOOK PARA TRANSAÇÕES
// =====================================================

export function useTransactions() {
  const [transactions, setTransactions] = useState<TransactionWithDetails[]>(
    []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTransactions = useCallback(async (limit?: number) => {
    try {
      setLoading(true);
      setError(null);
      const data = await transactionServices.getTransactions(limit);
      setTransactions(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTransactionsByPeriod = useCallback(
    async (startDate: string, endDate: string) => {
      try {
        setLoading(true);
        setError(null);
        const data = await transactionServices.getTransactionsByPeriod(
          startDate,
          endDate
        );
        setTransactions(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const createTransaction = useCallback(
    async (transactionData: NewTransactionForm) => {
      try {
        setError(null);
        console.log("🔗 HOOK recebeu dados:", transactionData);
        console.log("🎯 Group ID no hook:", transactionData.group_id);

        const result = await transactionServices.createTransaction(
          transactionData
        );

        if (!result.success) {
          throw new Error(result.error);
        }

        // Recarregar transações após criar
        await loadTransactions();

        return result;
      } catch (err: any) {
        setError(err.message);
        throw err;
      }
    },
    [loadTransactions]
  );

  const deleteTransaction = useCallback(async (id: string) => {
    try {
      setError(null);
      await transactionServices.deleteTransaction(id);

      // Remover da lista local
      setTransactions((prev) => prev.filter((t) => t.id !== id));
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }, []);

  return {
    transactions,
    loading,
    error,
    loadTransactions,
    loadTransactionsByPeriod,
    createTransaction,
    deleteTransaction,
  };
}

// =====================================================
// HOOK PARA DASHBOARD
// =====================================================

export function useDashboard() {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await dashboardServices.getDashboardData();
      setDashboardData(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  return {
    dashboardData,
    loading,
    error,
    refetch: loadDashboard,
  };
}

// =====================================================
// HOOK PARA CONTAS
// =====================================================

export function useAccounts() {
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await financialServices.getAccounts();
      setAccounts(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const createDefaultAccounts = useCallback(async () => {
    try {
      setError(null);
      await accountServices.createDefaultAccounts();
      await loadAccounts(); // Recarregar após criar
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }, [loadAccounts]);

  const createAccount = useCallback(
    async (
      accountData: Omit<
        FinancialAccount,
        "id" | "user_id" | "created_at" | "updated_at"
      >
    ) => {
      try {
        setError(null);
        const newAccount = await accountServices.createAccount(accountData);
        setAccounts((prev) => [...prev, newAccount]);
        return newAccount;
      } catch (err: any) {
        setError(err.message);
        throw err;
      }
    },
    []
  );

  return {
    accounts,
    loading,
    error,
    loadAccounts,
    createDefaultAccounts,
    createAccount,
  };
}

// =====================================================
// HOOK PARA CATEGORIAS
// =====================================================

export function useCategories(serviceId?: string) {
  const [categories, setCategories] = useState<CategoryWithService[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await financialServices.getCategories(serviceId);
      setCategories(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [serviceId]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  return {
    categories,
    loading,
    error,
    refetch: loadCategories,
    // Separar por tipo
    incomeCategories: categories.filter((c) => !c.is_expense),
    expenseCategories: categories.filter((c) => c.is_expense),
  };
}
