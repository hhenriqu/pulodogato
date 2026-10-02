"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TrendingUp, TrendingDown, DollarSign, Percent } from "lucide-react";
import { formatCurrency, formatPercentage } from "@/lib/utils";

interface DashboardSummaryProps {
  totalInvested: number;
  currentValue: number;
  totalProfitLoss: number;
  totalProfitLossPercentage: number;
  totalDividends: number;
}

export function DashboardSummary({
  totalInvested,
  currentValue,
  totalProfitLoss,
  totalProfitLossPercentage,
  totalDividends,
}: DashboardSummaryProps) {
  const isProfit = totalProfitLoss >= 0;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Investido</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatCurrency(totalInvested)}
          </div>
          <p className="text-xs text-muted-foreground">Valor total aplicado</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Valor Atual</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatCurrency(currentValue)}
          </div>
          <p className="text-xs text-muted-foreground">
            Valor atual da carteira
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Lucro/Prejuízo</CardTitle>
          {isProfit ? (
            <TrendingUp className="h-4 w-4 text-success" />
          ) : (
            <TrendingDown className="h-4 w-4 text-destructive" />
          )}
        </CardHeader>
        <CardContent>
          <div
            className={`text-2xl font-bold ${
              isProfit ? "text-success" : "text-destructive"
            }`}
          >
            {formatCurrency(totalProfitLoss)}
          </div>
          <p
            className={`text-xs flex items-center ${
              isProfit ? "text-success" : "text-destructive"
            }`}
          >
            {isProfit ? (
              <TrendingUp className="h-3 w-3 mr-1" />
            ) : (
              <TrendingDown className="h-3 w-3 mr-1" />
            )}
            {formatPercentage(totalProfitLossPercentage)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Dividendos</CardTitle>
          <Percent className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-success">
            {formatCurrency(totalDividends)}
          </div>
          <p className="text-xs text-muted-foreground">
            Total de proventos recebidos
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
