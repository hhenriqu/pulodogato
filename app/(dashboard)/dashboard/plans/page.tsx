"use client";

import { useState } from "react";
import { PLAN_CONFIGS, UserPlan, PlanConfig } from "@/types/subscription";
import { listaDeRecursosDoPlano } from "@/lib/planos";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Check, Clock, Crown, Zap, Settings, Star } from "lucide-react";

export default function PlansPage() {
  const [isYearly, setIsYearly] = useState(false);

  const publicPlans = Object.values(PLAN_CONFIGS).filter(
    (plan) => plan.id !== "admin"
  );

  const getPlanIcon = (planId: UserPlan) => {
    switch (planId) {
      case "trader":
        return Zap;
      case "invest":
        return Crown;
      case "admin":
        return Settings;
      default:
        return Star;
    }
  };

  const formatPrice = (plan: PlanConfig) => {
    if (plan.price.monthly === 0) {
      return "Gratuito";
    }

    const price = isYearly ? plan.price.yearly : plan.price.monthly;
    const period = isYearly ? "ano" : "mês";

    return `R$ ${price.toFixed(2).replace(".", ",")}/${period}`;
  };

  const getYearlySavings = (plan: PlanConfig) => {
    if (plan.price.monthly === 0) return 0;

    const yearlyTotal = plan.price.monthly * 12;
    const savings = yearlyTotal - plan.price.yearly;
    const percentSavings = (savings / yearlyTotal) * 100;

    return Math.round(percentSavings);
  };

  return (
    <div className="container mx-auto py-8 px-4">
      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4">
          Escolha o plano ideal para você
        </h1>
        <p className="text-xl text-muted-foreground mb-8">
          Controle suas finanças, invista com inteligência e trade como um
          profissional
        </p>

        {/* Toggle Yearly/Monthly */}
        <div className="flex items-center justify-center gap-4 mb-8">
          <span
            className={`text-sm ${
              !isYearly ? "font-semibold" : "text-muted-foreground"
            }`}
          >
            Mensal
          </span>
          <Switch checked={isYearly} onCheckedChange={setIsYearly} />
          <span
            className={`text-sm ${
              isYearly ? "font-semibold" : "text-muted-foreground"
            }`}
          >
            Anual
          </span>
          {isYearly && (
            <Badge variant="secondary" className="ml-2">
              Economize até 17%
            </Badge>
          )}
        </div>
      </div>

      {/* Plans Grid */}
      <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
        {publicPlans.map((plan) => {
          const Icon = getPlanIcon(plan.id);
          const yearlySavings = getYearlySavings(plan);

          return (
            <Card
              key={plan.id}
              className={`relative ${
                plan.highlighted
                  ? "border-2 border-primary shadow-lg scale-105"
                  : ""
              }`}
            >
              {plan.highlighted && (
                <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                  <Badge className="px-4 py-1 bg-primary text-primary-foreground">
                    Mais Popular
                  </Badge>
                </div>
              )}

              <CardHeader className="text-center pb-4">
                <div
                  className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
                  style={{ backgroundColor: `${plan.color}20` }}
                >
                  <Icon className="h-6 w-6" style={{ color: plan.color }} />
                </div>

                <CardTitle className="text-2xl">{plan.name}</CardTitle>
                <CardDescription className="text-center px-2">
                  {plan.description}
                </CardDescription>

                <div className="mt-4">
                  <div
                    className="text-4xl font-bold"
                    style={{ color: plan.color }}
                  >
                    {formatPrice(plan)}
                  </div>
                  {isYearly && plan.price.monthly > 0 && (
                    <div className="text-sm text-muted-foreground mt-1">
                      Economize {yearlySavings}% no plano anual
                    </div>
                  )}
                </div>
              </CardHeader>

              <CardContent className="space-y-6">
                <Button
                  className={`w-full ${
                    plan.highlighted ? "" : "variant-outline"
                  }`}
                  style={
                    plan.highlighted ? { backgroundColor: plan.color } : {}
                  }
                >
                  {plan.id === "free"
                    ? "Começar Grátis"
                    : `Escolher ${plan.name}`}
                </Button>

                {/* Features List */}
                <div className="space-y-3">
                  <h4 className="font-medium text-sm uppercase tracking-wide text-muted-foreground">
                    Funcionalidades Incluídas
                  </h4>

                  {/*
                    O item que ainda nao existe NAO leva o sinal de "incluido":
                    troca o Check pelo relogio e fica apagado, alem de dizer
                    "(em breve)" no proprio texto. Lista e origem do estado em
                    lib/planos.ts (HMO-198).
                  */}
                  <div className="space-y-2">
                    {listaDeRecursosDoPlano(plan).map((recurso) => (
                      <div
                        key={recurso.feature}
                        className="flex items-start gap-2"
                      >
                        {recurso.disponivel ? (
                          <Check className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                        ) : (
                          <Clock className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        )}
                        <span
                          className={
                            recurso.disponivel
                              ? "text-sm"
                              : "text-sm text-muted-foreground"
                          }
                        >
                          {recurso.rotulo}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Limits */}
                <div className="space-y-3 pt-4 border-t">
                  <h4 className="font-medium text-sm uppercase tracking-wide text-muted-foreground">
                    Limites
                  </h4>

                  <div className="space-y-2 text-sm text-muted-foreground">
                    <div>
                      Transações: {formatLimit(plan.limits.maxTransactions)}
                    </div>
                    <div>Contas: {formatLimit(plan.limits.maxAccounts)}</div>
                    <div>
                      Portfólios: {formatLimit(plan.limits.maxPortfolios)}
                    </div>
                    <div>
                      Grupos: {formatLimit(plan.limits.maxExpenseGroups)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* FAQ or Additional Info */}
      <div className="mt-16 text-center">
        <h3 className="text-2xl font-bold mb-4">Dúvidas sobre os planos?</h3>
        <p className="text-muted-foreground mb-6">
          Entre em contato conosco e tire todas as suas dúvidas
        </p>
        <Button variant="outline">Falar com Suporte</Button>
      </div>
    </div>
  );
}

// O mapa de nomes e o corte de 8 itens sairam daqui para lib/planos.ts na
// HMO-198: o rotulo de recurso "em breve" tem que valer tambem no mapa de
// components/subscription/PlanGuards.tsx, e dois mapas soltos e exatamente como
// este aqui ficou anunciando sinal de trading que nao existe.

function formatLimit(limit: number | "unlimited"): string {
  if (limit === "unlimited") {
    return "Ilimitado";
  }
  return limit.toString();
}
