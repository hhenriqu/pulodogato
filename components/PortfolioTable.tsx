"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Plus } from "lucide-react";
import { formatCurrency, formatPercentage } from "@/lib/utils";
import type { Portfolio } from "@/types";

interface PortfolioTableProps {
  data: Portfolio[];
  onAddTransaction?: (assetId: string) => void;
}

const getAssetTypeBadge = (type: string) => {
  const variants = {
    stock: "default",
    fii: "secondary",
    fixed_income: "outline",
    international: "destructive",
  } as const;

  const labels = {
    stock: "Ação",
    fii: "FII",
    fixed_income: "Renda Fixa",
    international: "Internacional",
  } as const;

  return (
    <Badge variant={variants[type as keyof typeof variants] || "default"}>
      {labels[type as keyof typeof labels] || type}
    </Badge>
  );
};

export function PortfolioTable({
  data,
  onAddTransaction,
}: PortfolioTableProps) {
  const [sortField, setSortField] = useState<keyof Portfolio>("current_value");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const sortedData = [...data].sort((a, b) => {
    const aValue = a[sortField] || 0;
    const bValue = b[sortField] || 0;

    if (sortDirection === "asc") {
      return aValue > bValue ? 1 : -1;
    }
    return aValue < bValue ? 1 : -1;
  });

  const handleSort = (field: keyof Portfolio) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Carteira de Investimentos</CardTitle>
        <CardDescription>
          Posições atuais e performance dos seus investimentos
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ativo</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead
                  className="text-right cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort("total_quantity")}
                >
                  Quantidade
                </TableHead>
                <TableHead
                  className="text-right cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort("average_price")}
                >
                  Preço Médio
                </TableHead>
                <TableHead
                  className="text-right cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort("total_invested")}
                >
                  Investido
                </TableHead>
                <TableHead
                  className="text-right cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort("current_value")}
                >
                  Valor Atual
                </TableHead>
                <TableHead
                  className="text-right cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort("profit_loss")}
                >
                  Resultado
                </TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedData.map((item) => {
                const isProfit = (item.profit_loss || 0) >= 0;
                const profitLossPercentage = item.profit_loss_percentage || 0;

                return (
                  <TableRow key={item.asset_id}>
                    <TableCell className="font-medium">
                      <div>
                        <div className="font-semibold">{item.symbol}</div>
                        <div className="text-sm text-gray-500">{item.name}</div>
                      </div>
                    </TableCell>
                    <TableCell>{getAssetTypeBadge(item.type)}</TableCell>
                    <TableCell className="text-right">
                      {item.total_quantity.toLocaleString("pt-BR", {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(item.average_price)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(item.total_invested)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(item.current_value || 0)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div
                        className={`flex items-center justify-end ${
                          isProfit ? "text-green-600" : "text-red-600"
                        }`}
                      >
                        {isProfit ? (
                          <TrendingUp className="h-4 w-4 mr-1" />
                        ) : (
                          <TrendingDown className="h-4 w-4 mr-1" />
                        )}
                        <div>
                          <div>{formatCurrency(item.profit_loss || 0)}</div>
                          <div className="text-xs">
                            {formatPercentage(profitLossPercentage)}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onAddTransaction?.(item.asset_id)}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {data.length === 0 && (
          <div className="text-center py-8">
            <p className="text-gray-500">Nenhum investimento encontrado</p>
            <p className="text-sm text-gray-400 mt-2">
              Comece adicionando sua primeira transação
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
