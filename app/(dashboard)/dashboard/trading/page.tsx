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
import { Zap, Crown, TrendingUp, Activity, Bell } from "lucide-react";

export default function TradingPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();
  const { planConfig } = useSubscription(user);

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
    <SoftFeatureGuard
      feature="trading_signals"
      user={user}
      fallback={
        <Card className="border-yellow-200 bg-yellow-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-600" />
              Trading Profissional
              <Badge className="bg-yellow-100 text-yellow-800">
                <Crown className="h-3 w-3 mr-1" />
                Plano Trader
              </Badge>
            </CardTitle>
            <CardDescription>
              Funcionalidades avançadas para traders profissionais
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              O módulo de Trading está disponível apenas para usuários do plano
              Trader ou superior.
            </p>
            <Button>
              <Crown className="h-4 w-4 mr-2" />
              Upgrade para Trader
            </Button>
          </CardContent>
        </Card>
      }
    >
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Zap className="h-8 w-8" />
              Trading
              <PremiumBadge feature="trading_signals" user={user} />
            </h1>
            <p className="text-muted-foreground">
              Sinais de trading, análise técnica e ferramentas profissionais
            </p>
          </div>
          {planConfig && (
            <Badge className="bg-yellow-100 text-yellow-800">
              <Crown className="h-3 w-3 mr-1" />
              {planConfig.name}
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  Sinais de Trading
                </CardTitle>
                <CardDescription>
                  Alertas em tempo real baseados em análise técnica
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8">
                  <Zap className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">
                    Nenhum sinal ativo
                  </h3>
                  <p className="text-muted-foreground mb-4">
                    Configure seus alertas para receber sinais personalizados
                  </p>
                  <Button>
                    <Bell className="h-4 w-4 mr-2" />
                    Configurar Alertas
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Análise de Mercado
                </CardTitle>
                <CardDescription>
                  Insights e tendências do mercado financeiro
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="p-3 border rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium">PETR4</span>
                      <Badge
                        variant="outline"
                        className="bg-green-50 text-green-700"
                      >
                        Compra
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Tendência de alta confirmada, volume acima da média
                    </p>
                  </div>

                  <div className="p-3 border rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium">VALE3</span>
                      <Badge
                        variant="outline"
                        className="bg-red-50 text-red-700"
                      >
                        Venda
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Rompimento de suporte, perspectiva baixista
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Ferramentas Trader</CardTitle>
                <CardDescription>Funcionalidades exclusivas</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-yellow-600" />
                  <span className="text-sm">Sinais em tempo real</span>
                </div>
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-yellow-600" />
                  <span className="text-sm">Análise técnica avançada</span>
                </div>
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-yellow-600" />
                  <span className="text-sm">Alertas personalizados</span>
                </div>
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-yellow-600" />
                  <span className="text-sm">API de dados</span>
                </div>
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-yellow-600" />
                  <span className="text-sm">Backtesting</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Performance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm">Sinais hoje:</span>
                    <span className="text-sm font-medium">12</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Taxa de acerto:</span>
                    <span className="text-sm font-medium text-green-600">
                      73%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Lucro mensal:</span>
                    <span className="text-sm font-medium text-green-600">
                      +8.4%
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </SoftFeatureGuard>
  );
}
