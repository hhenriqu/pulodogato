"use client";

// Ver components/EmDesenvolvimento.tsx. Esta tela tinha cartoes de "Sinais de
// Trading", "Performance" com "Sinais hoje:" e botoes sem onClick -- tudo
// escrito no codigo, sem nenhuma fonte de dado por tras (HMO-124). Nao existe
// origem de sinal de trading neste produto, nem tabela, nem rota.

import { useState, useEffect } from "react";
import { User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";
import { SoftFeatureGuard } from "@/components/subscription/SoftFeatureGuard";
import { EmDesenvolvimento } from "@/components/EmDesenvolvimento";
import { Zap } from "lucide-react";

export default function TradingPage() {
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
    <SoftFeatureGuard feature="trading_signals" user={user}>
      <div className="container mx-auto py-6 space-y-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Zap className="h-8 w-8" />
            Trading
          </h1>
        </div>

        <EmDesenvolvimento
          titulo="Trading"
          descricao="Não há nada construído por trás desta tela: nem origem de sinais, nem análise técnica, nem histórico. Até agora ela mostrava cartões e contadores escritos no próprio código."
        />
      </div>
    </SoftFeatureGuard>
  );
}
