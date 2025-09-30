"use client";

import { ReactNode } from "react";
import { User } from "@supabase/supabase-js";
import { useSubscription } from "@/lib/hooks/useSubscription";
import {
  PlanFeature,
  UserPlan,
  getPlanName,
  getPlanColor,
} from "@/types/subscription";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lock, Crown, Zap, Settings } from "lucide-react";

interface FeatureGuardProps {
  feature: PlanFeature;
  user?: User | null;
  children: ReactNode;
  fallback?: ReactNode;
  showUpgradePrompt?: boolean;
}

export function FeatureGuard({
  feature,
  user,
  children,
  fallback,
  showUpgradePrompt = true,
}: FeatureGuardProps) {
  const { hasFeature, planConfig, loading } = useSubscription(user);

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
      </div>
    );
  }

  if (hasFeature(feature)) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  if (showUpgradePrompt) {
    return <UpgradePrompt feature={feature} currentPlan={planConfig?.id} />;
  }

  return null;
}

interface PlanGuardProps {
  allowedPlans: UserPlan[];
  user?: User | null;
  children: ReactNode;
  fallback?: ReactNode;
}

export function PlanGuard({
  allowedPlans,
  user,
  children,
  fallback,
}: PlanGuardProps) {
  const { subscription, loading } = useSubscription(user);

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
      </div>
    );
  }

  if (subscription && allowedPlans.includes(subscription.plan)) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return (
    <AccessDenied
      currentPlan={subscription?.plan}
      allowedPlans={allowedPlans}
    />
  );
}

interface UpgradePromptProps {
  feature: PlanFeature;
  currentPlan?: UserPlan;
  size?: "sm" | "md" | "lg";
}

export function UpgradePrompt({
  feature,
  currentPlan,
  size = "md",
}: UpgradePromptProps) {
  const getFeatureName = (feature: PlanFeature): string => {
    const names: Record<PlanFeature, string> = {
      personal_finance: "Finanças Pessoais",
      advanced_reports: "Relatórios Avançados",
      investment_tracking: "Acompanhamento de Investimentos",
      portfolio_analysis: "Análise de Portfólio",
      trading_signals: "Sinais de Trading",
      advanced_charts: "Gráficos Avançados",
      api_access: "Acesso à API",
      priority_support: "Suporte Prioritário",
      unlimited_transactions: "Transações Ilimitadas",
      expense_groups: "Grupos de Gastos",
      financial_goals: "Metas Financeiras",
      investment_alerts: "Alertas de Investimento",
      tax_reports: "Relatórios Fiscais",
      custom_categories: "Categorias Personalizadas",
      data_export: "Exportação de Dados",
      multiple_portfolios: "Múltiplos Portfólios",
      real_time_data: "Dados em Tempo Real",
      advanced_analytics: "Analytics Avançados",
      white_label: "White Label",
      user_management: "Gerenciamento de Usuários",
      system_monitoring: "Monitoramento do Sistema",
    };
    return names[feature] || feature;
  };

  const getRecommendedPlan = (feature: PlanFeature): UserPlan => {
    // Features exclusivas do Trader
    if (["trading_signals", "real_time_data", "api_access"].includes(feature)) {
      return "trader";
    }

    // Features administrativas
    if (
      ["white_label", "user_management", "system_monitoring"].includes(feature)
    ) {
      return "admin";
    }

    // Resto é Investidor
    return "invest";
  };

  const recommendedPlan = getRecommendedPlan(feature);
  const planName = getPlanName(recommendedPlan);
  const planColor = getPlanColor(recommendedPlan);

  const PlanIcon =
    recommendedPlan === "trader"
      ? Zap
      : recommendedPlan === "admin"
      ? Settings
      : Crown;

  if (size === "sm") {
    return (
      <div className="flex items-center gap-2 p-2 bg-muted rounded-lg border">
        <Lock className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          Disponível no plano {planName}
        </span>
        <Button size="sm" variant="outline">
          Upgrade
        </Button>
      </div>
    );
  }

  if (size === "lg") {
    return (
      <Card className="border-dashed">
        <CardHeader className="text-center">
          <div
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
            style={{ backgroundColor: `${planColor}20` }}
          >
            <PlanIcon className="h-6 w-6" style={{ color: planColor }} />
          </div>
          <CardTitle className="text-xl">Feature Premium</CardTitle>
          <CardDescription>
            {getFeatureName(feature)} está disponível no plano {planName}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-sm text-muted-foreground">
            Faça upgrade para desbloquear esta funcionalidade e muito mais!
          </p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline">Ver Planos</Button>
            <Button style={{ backgroundColor: planColor }}>
              Upgrade para {planName}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // size === 'md' (default)
  return (
    <div className="p-4 border rounded-lg bg-muted/30">
      <div className="flex items-center gap-3 mb-3">
        <div
          className="p-2 rounded-full"
          style={{ backgroundColor: `${planColor}20` }}
        >
          <Lock className="h-5 w-5" style={{ color: planColor }} />
        </div>
        <div>
          <h3 className="font-medium">Feature Premium</h3>
          <p className="text-sm text-muted-foreground">
            {getFeatureName(feature)} disponível no plano {planName}
          </p>
        </div>
      </div>
      <Button
        size="sm"
        className="w-full"
        style={{ backgroundColor: planColor }}
      >
        <PlanIcon className="h-4 w-4 mr-2" />
        Upgrade para {planName}
      </Button>
    </div>
  );
}

interface AccessDeniedProps {
  currentPlan?: UserPlan;
  allowedPlans: UserPlan[];
}

export function AccessDenied({ currentPlan, allowedPlans }: AccessDeniedProps) {
  const highestPlan = allowedPlans.includes("trader")
    ? "trader"
    : allowedPlans.includes("invest")
    ? "invest"
    : "free";

  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="mb-4 p-3 rounded-full bg-red-100">
        <Lock className="h-8 w-8 text-red-600" />
      </div>
      <h2 className="text-xl font-semibold mb-2">Acesso Restrito</h2>
      <p className="text-muted-foreground mb-4">
        Esta área está disponível apenas para os planos:{" "}
        {allowedPlans.map((plan) => getPlanName(plan)).join(", ")}
      </p>
      {currentPlan && (
        <p className="text-sm text-muted-foreground mb-4">
          Seu plano atual:{" "}
          <Badge variant="outline">{getPlanName(currentPlan)}</Badge>
        </p>
      )}
      <Button>Fazer Upgrade para {getPlanName(highestPlan)}</Button>
    </div>
  );
}

interface PlanBadgeProps {
  plan: UserPlan;
  showIcon?: boolean;
  size?: "sm" | "md" | "lg";
}

export function PlanBadge({
  plan,
  showIcon = true,
  size = "md",
}: PlanBadgeProps) {
  const planColor = getPlanColor(plan);
  const planName = getPlanName(plan);

  const Icon =
    plan === "admin"
      ? Settings
      : plan === "trader"
      ? Zap
      : plan === "invest"
      ? Crown
      : null;

  const sizeClasses = {
    sm: "text-xs px-2 py-1",
    md: "text-sm px-3 py-1",
    lg: "text-base px-4 py-2",
  };

  return (
    <Badge
      className={`${sizeClasses[size]} font-medium`}
      style={{
        backgroundColor: `${planColor}20`,
        color: planColor,
        borderColor: planColor,
      }}
    >
      {showIcon && Icon && <Icon className="h-3 w-3 mr-1" />}
      {planName}
    </Badge>
  );
}
