"use client";

import { useState, useEffect } from "react";
import { User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";
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
import { BarChart3, Crown, Download, Calendar } from "lucide-react";

export default function ReportsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

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
    <SoftFeatureGuard feature="advanced_reports" user={user}>
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <BarChart3 className="h-8 w-8" />
              Relatórios
              <PremiumBadge feature="advanced_reports" user={user} />
            </h1>
            <p className="text-muted-foreground">
              Análises avançadas e relatórios detalhados das suas finanças
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Relatórios Disponíveis
                  <Crown className="h-4 w-4 text-yellow-600" />
                </CardTitle>
                <CardDescription>
                  Análises detalhadas dos seus dados financeiros
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 border rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <BarChart3 className="h-5 w-5 text-blue-600" />
                      <span className="font-medium">Fluxo de Caixa</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      Análise mensal de receitas vs despesas
                    </p>
                    <Button size="sm" variant="outline">
                      <Download className="h-4 w-4 mr-2" />
                      Gerar
                    </Button>
                  </div>

                  <div className="p-4 border rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <Calendar className="h-5 w-5 text-green-600" />
                      <span className="font-medium">Categorias</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      Breakdown por categoria de gastos
                    </p>
                    <Button size="sm" variant="outline">
                      <Download className="h-4 w-4 mr-2" />
                      Gerar
                    </Button>
                  </div>

                  <div className="p-4 border rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <BarChart3 className="h-5 w-5 text-purple-600" />
                      <span className="font-medium">Investimentos</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      Performance da carteira de investimentos
                    </p>
                    <Button size="sm" variant="outline">
                      <Download className="h-4 w-4 mr-2" />
                      Gerar
                    </Button>
                  </div>

                  <div className="p-4 border rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <Calendar className="h-5 w-5 text-orange-600" />
                      <span className="font-medium">Anual</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      Resumo completo do ano fiscal
                    </p>
                    <Button size="sm" variant="outline">
                      <Download className="h-4 w-4 mr-2" />
                      Gerar
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Crown className="h-5 w-5 text-yellow-600" />
                  Relatórios Premium
                </CardTitle>
                <CardDescription>Funcionalidades avançadas</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Crown className="h-4 w-4 text-yellow-600" />
                  <span className="text-sm">Exportação em Excel/PDF</span>
                </div>
                <div className="flex items-center gap-2">
                  <Crown className="h-4 w-4 text-yellow-600" />
                  <span className="text-sm">Agendamento automático</span>
                </div>
                <div className="flex items-center gap-2">
                  <Crown className="h-4 w-4 text-yellow-600" />
                  <span className="text-sm">Comparativos históricos</span>
                </div>
                <div className="flex items-center gap-2">
                  <Crown className="h-4 w-4 text-yellow-600" />
                  <span className="text-sm">Análises preditivas</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </SoftFeatureGuard>
  );
}
