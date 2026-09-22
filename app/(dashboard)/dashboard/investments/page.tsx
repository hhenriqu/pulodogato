"use client";

// Ver components/EmDesenvolvimento.tsx para o porque desta tela ter deixado de
// mostrar numeros. Resumo: ela exibia "R$ 0,00 / Valor Total", "0,00% /
// Rentabilidade" e tres botoes sem onClick, e as rotas por tras liam
// `dividends`, `transactions` e `assets` -- tabelas que nunca existiram neste
// banco (HMO-124). Nenhum desses numeros vinha de lugar nenhum.

import { useState, useEffect } from "react";
import { User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";
import { SoftFeatureGuard } from "@/components/subscription/SoftFeatureGuard";
import { EmDesenvolvimento } from "@/components/EmDesenvolvimento";
import { TrendingUp } from "lucide-react";

export default function InvestmentsPage() {
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <SoftFeatureGuard feature="investment_tracking" user={user}>
      <div className="container mx-auto py-6 space-y-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <TrendingUp className="h-8 w-8" />
            Investimentos
          </h1>
        </div>

        <EmDesenvolvimento
          titulo="O acompanhamento de investimentos"
          descricao="A ideia é acompanhar carteira, aportes e rentabilidade aqui. Ainda não há nada construído por trás desta tela — até agora ela mostrava valores de exemplo, o que era pior do que não mostrar nada."
        />
      </div>
    </SoftFeatureGuard>
  );
}
