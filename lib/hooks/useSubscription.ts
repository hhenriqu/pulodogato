"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { User } from "@supabase/supabase-js";
import {
  UserPlan,
  UserSubscription,
  PlanFeature,
  hasFeature,
  getPlanConfig,
  canExceedLimit,
  PlanLimits,
} from "@/types/subscription";

interface UserUsageLimits {
  user_id: string;
  current_transactions: number;
  current_accounts: number;
  current_categories: number;
  current_portfolios: number;
  current_expense_groups: number;
  max_transactions: number | null;
  max_accounts: number | null;
  max_categories: number | null;
  max_portfolios: number | null;
  max_expense_groups: number | null;
}

interface UseSubscriptionReturn {
  subscription: UserSubscription | null;
  usage: UserUsageLimits | null;
  loading: boolean;
  error: string | null;
  // Verificações de permissão
  hasFeature: (feature: PlanFeature) => boolean;
  canCreateMore: (type: keyof PlanLimits) => boolean;
  // Informações do plano
  planConfig: ReturnType<typeof getPlanConfig> | null;
  isPremium: boolean;
  isAdmin: boolean;
  // Ações
  refreshSubscription: () => Promise<void>;
}

export function useSubscription(user?: User | null): UseSubscriptionReturn {
  const [subscription, setSubscription] = useState<UserSubscription | null>(
    null
  );
  const [usage, setUsage] = useState<UserUsageLimits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  const loadSubscription = async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Buscar assinatura do usuário
      const { data: subData, error: subError } = await supabase
        .from("user_subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (subError && subError.code !== "PGRST116") {
        // PGRST116 = no rows returned
        throw subError;
      }

      // Buscar limites de uso
      const { data: usageData, error: usageError } = await supabase
        .from("user_usage_limits")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (usageError && usageError.code !== "PGRST116") {
        throw usageError;
      }

      setSubscription(subData);
      setUsage(usageData);
    } catch (err) {
      console.error("Error loading subscription:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load subscription"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSubscription();
  }, [user?.id]);

  // Funções auxiliares
  const checkFeature = (feature: PlanFeature): boolean => {
    // Se não tem subscription, assumir plano gratuito para funcionalidades básicas
    if (!subscription) {
      // Funcionalidades básicas disponíveis para todos
      const basicFeatures: PlanFeature[] = [
        "personal_finance",
        "expense_groups",
        "financial_goals",
      ];
      return basicFeatures.includes(feature);
    }
    return hasFeature(subscription.plan, feature);
  };

  const checkCanCreateMore = (type: keyof PlanLimits): boolean => {
    // Se não tem subscription, assumir limites do plano gratuito
    if (!subscription) {
      if (!usage) return true; // Permitir criação se não conseguir verificar uso

      const currentValue = (() => {
        switch (type) {
          case "maxTransactions":
            return usage.current_transactions;
          case "maxAccounts":
            return usage.current_accounts;
          case "maxCategories":
            return usage.current_categories;
          case "maxPortfolios":
            return usage.current_portfolios;
          case "maxExpenseGroups":
            return usage.current_expense_groups;
          default:
            return 0;
        }
      })();

      // Usar limites do plano gratuito
      return canExceedLimit("free", type, currentValue);
    }

    if (!usage) return true; // Permitir se não conseguir verificar uso

    const currentValue = (() => {
      switch (type) {
        case "maxTransactions":
          return usage.current_transactions;
        case "maxAccounts":
          return usage.current_accounts;
        case "maxCategories":
          return usage.current_categories;
        case "maxPortfolios":
          return usage.current_portfolios;
        case "maxExpenseGroups":
          return usage.current_expense_groups;
        default:
          return 0;
      }
    })();

    return canExceedLimit(subscription.plan, type, currentValue);
  };

  const planConfig = subscription
    ? getPlanConfig(subscription.plan)
    : getPlanConfig("free");
  const isPremium = subscription
    ? ["invest", "trader", "admin"].includes(subscription.plan)
    : false;
  const isAdmin = subscription?.plan === "admin";

  return {
    subscription,
    usage,
    loading,
    error,
    hasFeature: checkFeature,
    canCreateMore: checkCanCreateMore,
    planConfig,
    isPremium,
    isAdmin,
    refreshSubscription: loadSubscription,
  };
}

// Hook para verificar uma feature específica
export function useFeature(feature: PlanFeature, user?: User | null): boolean {
  const { hasFeature } = useSubscription(user);
  return hasFeature(feature);
}

// Hook para verificar limites de uso
export function useUsageLimit(
  type: keyof PlanLimits,
  user?: User | null
): {
  current: number;
  max: number | "unlimited";
  canCreateMore: boolean;
  percentUsed: number;
} {
  const { usage, planConfig, canCreateMore } = useSubscription(user);

  if (!usage || !planConfig) {
    return {
      current: 0,
      max: 0,
      canCreateMore: false,
      percentUsed: 0,
    };
  }

  const current = (() => {
    switch (type) {
      case "maxTransactions":
        return usage.current_transactions;
      case "maxAccounts":
        return usage.current_accounts;
      case "maxCategories":
        return usage.current_categories;
      case "maxPortfolios":
        return usage.current_portfolios;
      case "maxExpenseGroups":
        return usage.current_expense_groups;
      default:
        return 0;
    }
  })();

  const max = planConfig.limits[type];
  const percentUsed =
    max === "unlimited" ? 0 : (current / (max as number)) * 100;

  return {
    current,
    max,
    canCreateMore: canCreateMore(type),
    percentUsed,
  };
}
