"use client";

import { ReactNode } from "react";
import { User } from "@supabase/supabase-js";
import { useSubscription } from "@/lib/hooks/useSubscription";
import { PlanFeature } from "@/types/subscription";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Crown, Lock, Zap } from "lucide-react";
import Link from "next/link";

interface SoftFeatureGuardProps {
  children: ReactNode;
  feature?: PlanFeature;
  user: User | null;
  fallback?: ReactNode;
  showUpgradePrompt?: boolean;
}

export function SoftFeatureGuard({
  children,
  feature,
  user,
  fallback,
  showUpgradePrompt = true,
}: SoftFeatureGuardProps) {
  const { hasFeature, isPremium, planConfig } = useSubscription(user);

  // Se não tem usuário, mostrar aviso de login
  if (!user) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-amber-600" />
            Login Necessário
          </CardTitle>
          <CardDescription>
            Você precisa estar logado para acessar esta funcionalidade.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/login">Fazer Login</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Se não tem feature especificada ou tem acesso, mostrar conteúdo
  if (!feature || hasFeature(feature)) {
    return <>{children}</>;
  }

  // Se tem fallback personalizado, usar ele
  if (fallback) {
    return <>{fallback}</>;
  }

  // Mostrar prompt de upgrade se solicitado
  if (showUpgradePrompt) {
    return (
      <div className="space-y-6">
        {/* Mostrar conteúdo com overlay */}
        <div className="relative">
          <div className="pointer-events-none opacity-50 select-none">
            {children}
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-white/90 via-transparent to-transparent pointer-events-none" />
        </div>

        {/* Card de upgrade */}
        <Card className="border-yellow-200 bg-yellow-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-yellow-600" />
              Funcionalidade Premium
            </CardTitle>
            <CardDescription>
              Esta funcionalidade está disponível apenas para usuários premium.
              {planConfig && (
                <span className="block mt-1">
                  Seu plano atual:{" "}
                  <Badge variant="outline">{planConfig.name}</Badge>
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <h4 className="font-medium flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Desbloqueie com Premium:
              </h4>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>✨ Acesso completo a todas as funcionalidades</li>
                <li>📈 Análise avançada de investimentos</li>
                <li>📊 Relatórios detalhados e exportação</li>
                <li>🔄 Sincronização em tempo real</li>
                <li>🎯 Alertas e notificações personalizadas</li>
              </ul>
            </div>
            <div className="flex gap-2">
              <Button asChild>
                <Link href="/dashboard/plans">
                  <Crown className="h-4 w-4 mr-2" />
                  Ver Planos Premium
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/dashboard">Voltar ao Dashboard</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Por padrão, ainda mostrar o conteúdo (modo suave)
  return <>{children}</>;
}

// Versão mais simples para uso inline
export function PremiumBadge({
  feature,
  user,
  className = "",
}: {
  feature?: PlanFeature;
  user: User | null;
  className?: string;
}) {
  const { hasFeature } = useSubscription(user);

  if (!feature || hasFeature(feature)) {
    return null;
  }

  return (
    <Badge
      variant="outline"
      className={`bg-yellow-50 text-yellow-700 border-yellow-200 ${className}`}
    >
      <Crown className="h-3 w-3 mr-1" />
      Premium
    </Badge>
  );
}
