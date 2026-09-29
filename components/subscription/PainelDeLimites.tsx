"use client";

// ---------------------------------------------------------------------------
// PLANO E LIMITES (HMO-162)
// ---------------------------------------------------------------------------
// Este bloco morava numa aba de Financas Pessoais, ao lado de "Lancamentos".
// Ele nao pertence la: a tela de financas responde "quanto entrou e quanto
// saiu", e quantas transacoes o plano ainda permite e uma pergunta sobre a
// CONTA, nao sobre o dinheiro. Enquanto ocupou metade da barra de abas, ela
// tinha duas abas e so uma delas era sobre lancamento -- e nao sobrava lugar
// para o filtro por tipo, que e o que aquela tela de fato precisava.
//
// Ele carrega o proprio usuario em vez de receber por prop. Quem o hospeda hoje
// e a tela de Configuracoes, que nao tem sessao em estado; exigir a prop
// obrigaria aquela tela a montar um cliente do supabase so para repassar o
// usuario adiante. Como o unico consumidor dos dados e este bloco, buscar aqui
// mantem o custo onde esta o uso.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import Link from "next/link";
import { User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";
import { useSubscription } from "@/lib/hooks/useSubscription";
import { QuickUsage, UsageLimitsCard } from "@/components/subscription/UsageLimits";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Crown } from "lucide-react";

export function PainelDeLimites() {
  const [user, setUser] = useState<User | null>(null);
  const { isPremium } = useSubscription(user);

  useEffect(() => {
    let ativo = true;
    const supabase = createClient();

    (async () => {
      // `getUser()` vai na rede e, sem ela, o supabase-js NAO lanca: devolve
      // `user: null` com o erro ao lado. Aqui isso e aceitavel e nao precisa do
      // tratamento offline que `personal-finance` tem -- os cartoes abaixo ja
      // sabem exibir "—" sem usuario, e nao ha nada para lancar nesta tela.
      const { data } = await supabase.auth.getUser();
      if (ativo) setUser(data?.user ?? null);
    })();

    return () => {
      ativo = false;
    };
  }, []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2">
        <UsageLimitsCard user={user} />
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Uso Atual</CardTitle>
            <CardDescription>Resumo do seu uso em tempo real</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <QuickUsage
              user={user}
              type="maxTransactions"
              label="Transações"
              showUpgrade={true}
            />
            <QuickUsage
              user={user}
              type="maxAccounts"
              label="Contas"
              showUpgrade={true}
            />
            <QuickUsage
              user={user}
              type="maxCategories"
              label="Categorias"
              showUpgrade={true}
            />
            <QuickUsage
              user={user}
              type="maxExpenseGroups"
              label="Grupos"
              showUpgrade={true}
            />
          </CardContent>
        </Card>

        {!isPremium && (
          <Card className="border-warning/30 bg-warning/10">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Crown className="h-5 w-5 text-warning" />
                Upgrade Premium
              </CardTitle>
              <CardDescription>
                Desbloqueie funcionalidades avançadas
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="text-sm space-y-1">
                  <p>✨ Transações ilimitadas</p>
                  <p>📈 Análise de investimentos</p>
                  <p>📊 Relatórios avançados</p>
                  <p>🎯 Alertas personalizados</p>
                </div>
                <Button className="w-full" asChild>
                  <Link href="/dashboard/plans">Ver Planos Premium</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
