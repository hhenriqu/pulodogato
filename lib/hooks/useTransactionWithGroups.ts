import { useState, useEffect } from "react";
import {
  FinancialTransaction,
  NewTransactionForm,
  ExpenseGroup,
} from "@/types/financial";

interface UseTransactionWithGroupsReturn {
  transactions: FinancialTransaction[];
  groups: ExpenseGroup[];
  loading: boolean;
  error: string | null;
  createTransaction: (
    data: NewTransactionForm
  ) => Promise<FinancialTransaction | null>;
  updateTransaction: (
    id: string,
    data: Partial<NewTransactionForm>
  ) => Promise<FinancialTransaction | null>;
  deleteTransaction: (id: string) => Promise<boolean>;
  addTransactionToGroup: (
    transactionId: string,
    groupId: string
  ) => Promise<boolean>;
  removeTransactionFromGroup: (transactionId: string) => Promise<boolean>;
  refreshTransactions: () => Promise<void>;
}

export function useTransactionWithGroups(): UseTransactionWithGroupsReturn {
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [groups, setGroups] = useState<ExpenseGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Carregar transações
  const fetchTransactions = async () => {
    try {
      const response = await fetch("/api/personal-finance/transactions");
      if (!response.ok) throw new Error("Failed to fetch transactions");

      const data = await response.json();
      setTransactions(data.transactions || []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error loading transactions"
      );
    }
  };

  // Carregar grupos do usuário
  const fetchGroups = async () => {
    try {
      const response = await fetch("/api/expense-groups");
      if (!response.ok) throw new Error("Failed to fetch groups");

      const data = await response.json();
      setGroups(data.groups || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading groups");
    }
  };

  // Refresh completo
  const refreshTransactions = async () => {
    setLoading(true);
    setError(null);

    try {
      await Promise.all([fetchTransactions(), fetchGroups()]);
    } finally {
      setLoading(false);
    }
  };

  // Criar nova transação
  const createTransaction = async (
    data: NewTransactionForm
  ): Promise<FinancialTransaction | null> => {
    try {
      const response = await fetch("/api/personal-finance/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create transaction");
      }

      const result = await response.json();

      // Refresh transactions to get the updated list
      await fetchTransactions();

      return result.transaction;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error creating transaction"
      );
      return null;
    }
  };

  // Atualizar transação existente
  const updateTransaction = async (
    id: string,
    data: Partial<NewTransactionForm>
  ): Promise<FinancialTransaction | null> => {
    try {
      const response = await fetch(`/api/personal-finance/transactions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update transaction");
      }

      const result = await response.json();

      // Refresh transactions to get the updated list
      await fetchTransactions();

      return result.transaction;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error updating transaction"
      );
      return null;
    }
  };

  // Deletar transação
  const deleteTransaction = async (id: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/personal-finance/transactions/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to delete transaction");
      }

      // Refresh transactions to get the updated list
      await fetchTransactions();

      return true;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error deleting transaction"
      );
      return false;
    }
  };

  // Adicionar transação a um grupo
  const addTransactionToGroup = async (
    transactionId: string,
    groupId: string
  ): Promise<boolean> => {
    try {
      const response = await fetch(
        `/api/personal-finance/transactions/${transactionId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ group_id: groupId }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error || "Failed to add transaction to group"
        );
      }

      // Refresh transactions to get the updated list
      await fetchTransactions();

      return true;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error adding transaction to group"
      );
      return false;
    }
  };

  // Remover transação de um grupo
  const removeTransactionFromGroup = async (
    transactionId: string
  ): Promise<boolean> => {
    try {
      const response = await fetch(
        `/api/personal-finance/transactions/${transactionId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ group_id: null }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error || "Failed to remove transaction from group"
        );
      }

      // Refresh transactions to get the updated list
      await fetchTransactions();

      return true;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Error removing transaction from group"
      );
      return false;
    }
  };

  // Carregar dados iniciais
  useEffect(() => {
    refreshTransactions();
  }, []);

  return {
    transactions,
    groups,
    loading,
    error,
    createTransaction,
    updateTransaction,
    deleteTransaction,
    addTransactionToGroup,
    removeTransactionFromGroup,
    refreshTransactions,
  };
}
