"use client";

import { useState, useEffect } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CreditCard,
  TrendingDown,
  TrendingUp,
  ArrowUpDown,
  MoreHorizontal,
  Trash2,
  Edit,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useTransactions } from "@/lib/hooks/useFinancial";
import { TransactionWithDetails } from "@/types/financial";
import { toast } from "sonner";

interface TransactionListProps {
  limit?: number;
  showHeader?: boolean;
}

export function TransactionList({
  limit = 50,
  showHeader = true,
}: TransactionListProps) {
  const { transactions, loading, error, loadTransactions, deleteTransaction } =
    useTransactions();

  useEffect(() => {
    loadTransactions(limit);
  }, [loadTransactions, limit]);

  const handleDeleteTransaction = async (id: string, description: string) => {
    if (!confirm(`Deseja realmente excluir a transação "${description}"?`)) {
      return;
    }

    try {
      await deleteTransaction(id);
      toast.success("Transação excluída com sucesso!");
    } catch (error) {
      toast.error("Erro ao excluir transação");
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  const getTransactionIcon = (type?: string) => {
    switch (type) {
      case "income":
        return <TrendingUp className="h-4 w-4 text-green-600" />;
      case "expense":
        return <TrendingDown className="h-4 w-4 text-red-600" />;
      case "transfer":
        return <ArrowUpDown className="h-4 w-4 text-blue-600" />;
      default:
        return <CreditCard className="h-4 w-4 text-gray-600" />;
    }
  };

  const getTransactionTypeLabel = (type?: string) => {
    switch (type) {
      case "income":
        return "Receita";
      case "expense":
        return "Despesa";
      case "transfer":
        return "Transferência";
      default:
        return "N/A";
    }
  };

  const getTransactionTypeColor = (type?: string) => {
    switch (type) {
      case "income":
        return "bg-green-100 text-green-800 border-green-200";
      case "expense":
        return "bg-red-100 text-red-800 border-red-200";
      case "transfer":
        return "bg-blue-100 text-blue-800 border-blue-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          {showHeader && <CardTitle>Transações Recentes</CardTitle>}
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="text-sm text-muted-foreground">
              Carregando transações...
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          {showHeader && <CardTitle>Transações Recentes</CardTitle>}
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="text-sm text-red-600">
              Erro ao carregar: {error}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (transactions.length === 0) {
    return (
      <Card>
        <CardHeader>
          {showHeader && <CardTitle>Transações Recentes</CardTitle>}
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 space-y-2">
            <CreditCard className="h-8 w-8 text-muted-foreground" />
            <div className="text-sm text-muted-foreground">
              Nenhuma transação encontrada
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        {showHeader && <CardTitle>Transações Recentes</CardTitle>}
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Transação</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Conta</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell>
                    <div className="flex items-center space-x-2">
                      {getTransactionIcon(transaction.transaction_type)}
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {transaction.description}
                        </span>
                        {transaction.notes && (
                          <span className="text-xs text-muted-foreground">
                            {transaction.notes}
                          </span>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center space-x-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{
                          backgroundColor:
                            transaction.category?.color_hex || "#6B7280",
                        }}
                      />
                      <span className="text-sm">
                        {transaction.category?.name}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {transaction.account ? (
                      <div className="flex items-center space-x-2">
                        <CreditCard
                          className="h-4 w-4"
                          style={{ color: transaction.account.color_hex }}
                        />
                        <span className="text-sm">
                          {transaction.account.name}
                        </span>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={getTransactionTypeColor(
                        transaction.transaction_type
                      )}
                    >
                      {getTransactionTypeLabel(transaction.transaction_type)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <span
                      className={
                        transaction.amount >= 0
                          ? "text-green-600"
                          : "text-red-600"
                      }
                    >
                      {formatCurrency(transaction.amount)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {format(
                        new Date(transaction.transaction_date),
                        "dd/MM/yyyy",
                        { locale: ptBR }
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled>
                          <Edit className="h-4 w-4 mr-2" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-red-600"
                          onClick={() =>
                            handleDeleteTransaction(
                              transaction.id,
                              transaction.description
                            )
                          }
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
