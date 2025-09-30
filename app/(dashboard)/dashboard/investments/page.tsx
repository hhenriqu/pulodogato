"use client";

import { useState, useEffect } from "react";
import { User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";
import { useSubscription } from "@/lib/hooks/useSubscription";
import {
  SoftFeatureGuard,
  PremiumBadge,
} from "@/components/subscription/SoftFeatureGuard";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Crown, BarChart3, Zap, Target } from "lucide-react";
import Link from "next/link";

export default function InvestmentsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();
  const { hasFeature, isPremium, planConfig } = useSubscription(user);

  useEffect(() => {
    const getUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);
      setLoading(false);
    };
    getUser();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <SoftFeatureGuard feature="investment_tracking" user={user}>
      <div className="container mx-auto py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <TrendingUp className="h-8 w-8" />
              Investimentos
              <PremiumBadge feature="investment_tracking" user={user} />
            </h1>
            <p className="text-muted-foreground">
              Acompanhe seus investimentos e analise performance da carteira
            </p>
          </div>
          {planConfig && (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-blue-50 text-blue-700">
                {planConfig.name}
              </Badge>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Visão Geral da Carteira
                </CardTitle>
                <CardDescription>
                  Acompanhamento completo dos seus investimentos
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="text-center p-4 border rounded-lg">
                      <div className="text-2xl font-bold text-green-600">
                        R$ 0,00
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Valor Total
                      </div>
                    </div>
                    <div className="text-center p-4 border rounded-lg">
                      <div className="text-2xl font-bold text-blue-600">
                        R$ 0,00
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Investido
                      </div>
                    </div>
                    <div className="text-center p-4 border rounded-lg">
                      <div className="text-2xl font-bold">0,00%</div>
                      <div className="text-sm text-muted-foreground">
                        Rentabilidade
                      </div>
                    </div>
                  </div>

                  <div className="text-center py-8">
                    <TrendingUp className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-medium mb-2">
                      Comece a investir
                    </h3>
                    <p className="text-muted-foreground mb-4">
                      Adicione seus primeiro investimento para começar o
                      acompanhamento
                    </p>
                    <Button>
                      <TrendingUp className="h-4 w-4 mr-2" />
                      Adicionar Investimento
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  Funcionalidades Premium
                </CardTitle>
                <CardDescription>
                  Disponível no plano Investidor
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Crown className="h-4 w-4 text-yellow-600" />
                  <span className="text-sm">Análise de performance</span>
                </div>
                <div className="flex items-center gap-2">
                  <Crown className="h-4 w-4 text-yellow-600" />
                  <span className="text-sm">Alertas de mercado</span>
                </div>
                <div className="flex items-center gap-2">
                  <Crown className="h-4 w-4 text-yellow-600" />
                  <span className="text-sm">Relatórios detalhados</span>
                </div>
                <div className="flex items-center gap-2">
                  <Crown className="h-4 w-4 text-yellow-600" />
                  <span className="text-sm">Múltiplas carteiras</span>
                </div>

                {!isPremium && (
                  <Button className="w-full mt-4" asChild>
                    <Link href="/dashboard/plans">
                      <Crown className="h-4 w-4 mr-2" />
                      Upgrade para Premium
                    </Link>
                  </Button>
                )}
              </CardContent>
            </Card>

            {hasFeature("investment_tracking") && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Ações Rápidas</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button variant="outline" className="w-full justify-start">
                    <TrendingUp className="h-4 w-4 mr-2" />
                    Nova Transação
                  </Button>
                  <Button variant="outline" className="w-full justify-start">
                    <BarChart3 className="h-4 w-4 mr-2" />
                    Ver Relatórios
                  </Button>
                  <Button variant="outline" className="w-full justify-start">
                    <Target className="h-4 w-4 mr-2" />
                    Definir Meta
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </SoftFeatureGuard>
  );
}
