"use client";

import { User } from "@supabase/supabase-js";
import { useSubscription, useUsageLimit } from "@/lib/hooks/useSubscription";
import { PlanLimits } from "@/types/subscription";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Receipt,
  CreditCard,
  Tag,
  TrendingUp,
  Users,
  AlertTriangle,
  CheckCircle,
  Crown,
} from "lucide-react";

interface UsageLimitsCardProps {
  user?: User | null;
}

export function UsageLimitsCard({ user }: UsageLimitsCardProps) {
  const { subscription, usage, planConfig, loading } = useSubscription(user);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <div className="animate-pulse space-y-2">
            <div className="h-4 bg-gray-200 rounded w-1/3"></div>
            <div className="h-3 bg-gray-200 rounded w-2/3"></div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-2">
                <div className="h-3 bg-gray-200 rounded w-1/4"></div>
                <div className="h-2 bg-gray-200 rounded"></div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!subscription || !usage || !planConfig) {
    return null;
  }

  const limits = [
    {
      key: "maxTransactions" as keyof PlanLimits,
      label: "Transações",
      icon: Receipt,
      current: usage.current_transactions,
      max: usage.max_transactions,
    },
    {
      key: "maxAccounts" as keyof PlanLimits,
      label: "Contas",
      icon: CreditCard,
      current: usage.current_accounts,
      max: usage.max_accounts,
    },
    {
      key: "maxCategories" as keyof PlanLimits,
      label: "Categorias",
      icon: Tag,
      current: usage.current_categories,
      max: usage.max_categories,
    },
    {
      key: "maxPortfolios" as keyof PlanLimits,
      label: "Portfólios",
      icon: TrendingUp,
      current: usage.current_portfolios,
      max: usage.max_portfolios,
    },
    {
      key: "maxExpenseGroups" as keyof PlanLimits,
      label: "Grupos de Gastos",
      icon: Users,
      current: usage.current_expense_groups,
      max: usage.max_expense_groups,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Limites de Uso
          <Badge variant="outline" className="ml-auto">
            {planConfig.name}
          </Badge>
        </CardTitle>
        <CardDescription>
          Acompanhe seu uso atual em relação aos limites do seu plano
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {limits.map((limit) => (
          <LimitItem
            key={limit.key}
            label={limit.label}
            icon={limit.icon}
            current={limit.current}
            max={limit.max}
          />
        ))}

        {subscription.plan === "free" && (
          <div className="pt-4 border-t">
            <div className="flex items-center gap-2 mb-2">
              <Crown className="h-4 w-4 text-yellow-600" />
              <span className="text-sm font-medium">Upgrade para Premium</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Remova todos os limites e desbloqueie funcionalidades exclusivas
            </p>
            <Button size="sm" className="w-full">
              Ver Planos Premium
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface LimitItemProps {
  label: string;
  icon: React.ElementType;
  current: number;
  max: number | null;
}

function LimitItem({ label, icon: Icon, current, max }: LimitItemProps) {
  const isUnlimited = max === null;
  const percentage = isUnlimited ? 0 : Math.min((current / max) * 100, 100);
  const isNearLimit = percentage >= 80;
  const isAtLimit = percentage >= 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span>{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs">
            {current}
            {!isUnlimited && ` / ${max}`}
            {isUnlimited && (
              <Badge variant="secondary" className="ml-1">
                ∞
              </Badge>
            )}
          </span>
          {isAtLimit && <AlertTriangle className="h-3 w-3 text-red-500" />}
          {!isAtLimit && !isNearLimit && (
            <CheckCircle className="h-3 w-3 text-green-500" />
          )}
        </div>
      </div>

      {!isUnlimited && (
        <Progress
          value={percentage}
          className={`h-1 ${
            isAtLimit
              ? "bg-red-100"
              : isNearLimit
              ? "bg-yellow-100"
              : "bg-green-100"
          }`}
        />
      )}

      {isAtLimit && (
        <p className="text-xs text-red-600">
          Limite atingido. Faça upgrade para continuar usando esta
          funcionalidade.
        </p>
      )}

      {isNearLimit && !isAtLimit && (
        <p className="text-xs text-yellow-600">
          Você está próximo do limite. Considere fazer upgrade.
        </p>
      )}
    </div>
  );
}

interface QuickUsageProps {
  user?: User | null;
  type: keyof PlanLimits;
  label: string;
  showUpgrade?: boolean;
}

export function QuickUsage({
  user,
  type,
  label,
  showUpgrade = false,
}: QuickUsageProps) {
  const { current, max, canCreateMore, percentUsed } = useUsageLimit(
    type,
    user
  );

  const isUnlimited = max === "unlimited";
  const isAtLimit = !canCreateMore && !isUnlimited;

  if (isUnlimited) {
    return (
      <div className="text-xs text-muted-foreground">
        {current} {label.toLowerCase()}{" "}
        <Badge variant="secondary" className="ml-1">
          ∞
        </Badge>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span
          className={`font-mono ${
            isAtLimit ? "text-red-600" : "text-muted-foreground"
          }`}
        >
          {current} / {max}
        </span>
      </div>

      <Progress value={percentUsed} className="h-1" />

      {isAtLimit && showUpgrade && (
        <div className="flex items-center gap-1 pt-1">
          <AlertTriangle className="h-3 w-3 text-red-500" />
          <Button variant="link" size="sm" className="h-auto p-0 text-xs">
            Fazer upgrade
          </Button>
        </div>
      )}
    </div>
  );
}
