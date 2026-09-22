"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Target,
  Plus,
  Calendar,
  DollarSign,
  CheckCircle,
  Clock,
  AlertCircle,
} from "lucide-react";

interface Goal {
  id: string;
  title: string;
  description: string;
  target_amount: number;
  current_amount: number;
  target_date: string;
  status: "active" | "completed" | "paused";
  created_at: string;
}

export default function GoalsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      setUser(user);

      // TODO: Carregar metas do banco quando implementado
      // Dados de exemplo por enquanto
      setGoals([
        {
          id: "1",
          title: "Reserva de Emergência",
          description: "Juntar 6 meses de despesas",
          target_amount: 15000,
          current_amount: 8500,
          target_date: "2024-12-31",
          status: "active",
          created_at: "2024-01-01",
        },
        {
          id: "2",
          title: "Viagem Europa",
          description: "Economizar para viagem de férias",
          target_amount: 12000,
          current_amount: 4200,
          target_date: "2024-07-15",
          status: "active",
          created_at: "2024-01-15",
        },
      ]);
    } catch (error) {
      console.error("Error loading goals:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  const calculateProgress = (current: number, target: number) => {
    return Math.min((current / target) * 100, 100);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="h-4 w-4 text-success" />;
      case "paused":
        return <AlertCircle className="h-4 w-4 text-warning" />;
      default:
        return <Clock className="h-4 w-4 text-info" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-success/10 text-success";
      case "paused":
        return "bg-warning/10 text-warning";
      default:
        return "bg-info/10 text-info";
    }
  };

  const getDaysRemaining = (targetDate: string) => {
    const now = new Date();
    const target = new Date(targetDate);
    const diffTime = target.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const totalTarget = goals.reduce((sum, goal) => sum + goal.target_amount, 0);
  const totalCurrent = goals.reduce(
    (sum, goal) => sum + goal.current_amount,
    0
  );
  const activeGoals = goals.filter((goal) => goal.status === "active").length;
  const completedGoals = goals.filter(
    (goal) => goal.status === "completed"
  ).length;

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Target className="h-8 w-8" />
            Metas Financeiras
          </h1>
          <p className="text-muted-foreground">
            Defina e acompanhe seus objetivos financeiros
          </p>
        </div>
        <Button className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Nova Meta
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Metas Ativas</CardTitle>
            <Target className="h-4 w-4 text-info" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-info">
              {activeGoals}
            </div>
            <p className="text-xs text-muted-foreground">Em andamento</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Concluídas</CardTitle>
            <CheckCircle className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">
              {completedGoals}
            </div>
            <p className="text-xs text-muted-foreground">
              Objetivos alcançados
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Objetivo
            </CardTitle>
            <DollarSign className="h-4 w-4 text-premium" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-premium">
              {formatCurrency(totalTarget)}
            </div>
            <p className="text-xs text-muted-foreground">
              Soma de todas as metas
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Economizado
            </CardTitle>
            <DollarSign className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">
              {formatCurrency(totalCurrent)}
            </div>
            <p className="text-xs text-muted-foreground">
              {totalTarget > 0
                ? `${((totalCurrent / totalTarget) * 100).toFixed(1)}%`
                : "0%"}{" "}
              do objetivo
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Goals List */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Suas Metas</h2>

        {goals.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {goals.map((goal) => {
              const progress = calculateProgress(
                goal.current_amount,
                goal.target_amount
              );
              const daysRemaining = getDaysRemaining(goal.target_date);

              return (
                <Card key={goal.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{goal.title}</CardTitle>
                      <Badge
                        className={`flex items-center gap-1 ${getStatusColor(
                          goal.status
                        )}`}
                      >
                        {getStatusIcon(goal.status)}
                        {goal.status === "active"
                          ? "Ativa"
                          : goal.status === "completed"
                          ? "Concluída"
                          : "Pausada"}
                      </Badge>
                    </div>
                    <CardDescription>{goal.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Progress */}
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Progresso</span>
                        <span className="font-medium">
                          {progress.toFixed(1)}%
                        </span>
                      </div>
                      <Progress value={progress} className="h-2" />
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>{formatCurrency(goal.current_amount)}</span>
                        <span>{formatCurrency(goal.target_amount)}</span>
                      </div>
                    </div>

                    {/* Details */}
                    <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-muted-foreground">Prazo</p>
                          <p className="font-medium">
                            {new Date(goal.target_date).toLocaleDateString(
                              "pt-BR"
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-muted-foreground">Restam</p>
                          <p className="font-medium">
                            {daysRemaining > 0
                              ? `${daysRemaining} dias`
                              : "Prazo vencido"}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Amount remaining */}
                    {goal.status === "active" && (
                      <div className="bg-info/10 p-3 rounded-lg">
                        <p className="text-sm text-info font-medium">
                          Faltam{" "}
                          {formatCurrency(
                            goal.target_amount - goal.current_amount
                          )}{" "}
                          para atingir a meta
                        </p>
                        {daysRemaining > 0 && (
                          <p className="text-xs text-primary mt-1">
                            Economize cerca de{" "}
                            {formatCurrency(
                              (goal.target_amount - goal.current_amount) /
                                daysRemaining
                            )}{" "}
                            por dia
                          </p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="text-center py-12">
              <Target className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">Nenhuma meta ainda</h3>
              <p className="text-muted-foreground mb-6">
                Comece definindo seus objetivos financeiros
              </p>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Criar Primeira Meta
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
