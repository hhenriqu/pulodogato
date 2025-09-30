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
import { ArrowLeftRight, Filter, Search, Download } from "lucide-react";

export default function TransactionsPage() {
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
    <SoftFeatureGuard feature="personal_finance" user={user}>
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <ArrowLeftRight className="h-8 w-8" />
              Transações
              <PremiumBadge feature="unlimited_transactions" user={user} />
            </h1>
            <p className="text-muted-foreground">
              Visualize e gerencie todas suas transações financeiras
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline">
              <Filter className="h-4 w-4 mr-2" />
              Filtrar
            </Button>
            <Button variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Exportar
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Todas as Transações</CardTitle>
            <CardDescription>
              Histórico completo de movimentações financeiras
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8">
              <ArrowLeftRight className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">
                Nenhuma transação encontrada
              </h3>
              <p className="text-muted-foreground mb-4">
                Suas transações aparecerão aqui quando você começar a usar o
                sistema
              </p>
              <Button>Ir para Finanças Pessoais</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </SoftFeatureGuard>
  );
}
