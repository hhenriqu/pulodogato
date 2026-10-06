"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { useSubscription } from "@/lib/hooks/useSubscription";
import { PlanGuard } from "@/components/subscription/PlanGuards";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users,
  TrendingUp,
  DollarSign,
  Activity,
  Shield,
  Database,
  Settings,
  Crown,
} from "lucide-react";
import { User } from "@supabase/supabase-js";

interface AdminStats {
  totalUsers: number;
  activeSubscriptions: number;
  monthlyRevenue: number;
  freeUsers: number;
  investUsers: number;
  traderUsers: number;
  adminUsers: number;
}

interface UserData {
  id: string;
  email: string;
  full_name: string;
  plan: string;
  status: string;
  created_at: string;
}

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);

  const { isAdmin, loading: subscriptionLoading } = useSubscription(user);

  useEffect(() => {
    // Dentro do efeito de proposito: fora, `supabase` vira dependencia e
    // acrescenta-la depende de o cliente ser o mesmo objeto a cada render.
    // Aqui a questao nao se coloca, e nada mais nesta tela usa o cliente.
    const getUser = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);
    };
    getUser();
  }, []);

  // O `else` nao e detalhe: sem ele o `<PlanGuard>` la embaixo era codigo
  // morto. `loading` nasce `true` e so `loadAdminData` o desligava, entao o
  // nao-admin -- unico que o guard existe para barrar -- ficava preso no spinner
  // e nunca chegava ao guard. Parecia protecao e era um travamento; o dia em que
  // alguem trocasse o valor inicial por `false`, a tela abriria para todos.
  // Esperar `subscriptionLoading` evita o outro extremo: enquanto o plano nao
  // chegou, `isAdmin` e `false` e o admin de verdade veria "acesso negado"
  // piscar antes dos dados.
  useEffect(() => {
    if (!user || subscriptionLoading) return;

    if (isAdmin) {
      loadAdminData();
    } else {
      setLoading(false);
    }
  }, [user, isAdmin, subscriptionLoading]);

  const loadAdminData = async () => {
    try {
      setLoading(true);

      // Carregar estatísticas básicas (simuladas por enquanto)
      const mockStats: AdminStats = {
        totalUsers: 1247,
        activeSubscriptions: 89,
        monthlyRevenue: 2650.75,
        freeUsers: 1158,
        investUsers: 67,
        traderUsers: 22,
        adminUsers: 1,
      };

      setStats(mockStats);

      // Carregar alguns usuários de exemplo (simulados)
      const mockUsers: UserData[] = [
        {
          id: "1",
          email: "heliohenriquemoraes@gmail.com",
          full_name: "Helio Henrique",
          plan: "admin",
          status: "active",
          created_at: new Date().toISOString(),
        },
        {
          id: "2",
          email: "usuario@exemplo.com",
          full_name: "Usuário Teste",
          plan: "free",
          status: "active",
          created_at: new Date().toISOString(),
        },
      ];

      setUsers(mockUsers);
    } catch (error) {
      console.error("Error loading admin data:", error);
    } finally {
      setLoading(false);
    }
  };

  const getPlanBadgeColor = (plan: string) => {
    switch (plan) {
      case "admin":
        return "bg-premium/10 text-premium";
      case "trader":
        return "bg-warning/10 text-warning";
      case "invest":
        return "bg-info/10 text-info";
      default:
        return "bg-muted text-foreground";
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <PlanGuard allowedPlans={["admin"]} user={user}>
      <div className="container mx-auto py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Shield className="h-8 w-8" />
              Painel de Administração
            </h1>
            <p className="text-muted-foreground">
              Gerencie usuários, planos e monitore o sistema
            </p>
          </div>
          <Badge variant="outline" className="bg-premium/10 text-premium">
            <Crown className="h-3 w-3 mr-1" />
            Administrador
          </Badge>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Total de Usuários
                </CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stats.totalUsers.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground">
                  +12% desde o mês passado
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Assinaturas Ativas
                </CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stats.activeSubscriptions}
                </div>
                <p className="text-xs text-muted-foreground">
                  +5% desde o mês passado
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Receita Mensal
                </CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(stats.monthlyRevenue)}
                </div>
                <p className="text-xs text-muted-foreground">
                  +8% desde o mês passado
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Sistema</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-success">Online</div>
                <p className="text-xs text-muted-foreground">Uptime: 99.9%</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tabs */}
        <Tabs defaultValue="users" className="space-y-4">
          <TabsList>
            <TabsTrigger value="users">Usuários</TabsTrigger>
            <TabsTrigger value="plans">Planos</TabsTrigger>
            <TabsTrigger value="system">Sistema</TabsTrigger>
            <TabsTrigger value="settings">Configurações</TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Usuários Recentes</CardTitle>
                <CardDescription>
                  Lista dos usuários mais recentes do sistema
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {users.map((userData) => (
                    <div
                      key={userData.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div className="space-y-1">
                        <p className="font-medium">
                          {userData.full_name || userData.email}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {userData.email}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={getPlanBadgeColor(userData.plan)}>
                          {userData.plan}
                        </Badge>
                        <Badge
                          variant={
                            userData.status === "active"
                              ? "default"
                              : "secondary"
                          }
                        >
                          {userData.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="plans" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    Gratuito
                    <Badge variant="secondary">{stats?.freeUsers}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{stats?.freeUsers}</p>
                  <p className="text-sm text-muted-foreground">usuários</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    Investidor
                    <Badge className="bg-info/10 text-info">
                      {stats?.investUsers}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{stats?.investUsers}</p>
                  <p className="text-sm text-muted-foreground">assinantes</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    Trader
                    <Badge className="bg-warning/10 text-warning">
                      {stats?.traderUsers}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{stats?.traderUsers}</p>
                  <p className="text-sm text-muted-foreground">assinantes</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    Admin
                    <Badge className="bg-premium/10 text-premium">
                      {stats?.adminUsers}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{stats?.adminUsers}</p>
                  <p className="text-sm text-muted-foreground">
                    administradores
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="system" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5" />
                  Status do Sistema
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span>Banco de Dados</span>
                  <Badge className="bg-success/10 text-success">
                    Conectado
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span>API</span>
                  <Badge className="bg-success/10 text-success">
                    Funcionando
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span>Supabase Auth</span>
                  <Badge className="bg-success/10 text-success">Ativo</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span>Últimas 24h</span>
                  <Badge variant="outline">0 erros</Badge>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Configurações do Sistema
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <h3 className="font-medium">Funcionalidades</h3>
                  <div className="space-y-2">
                    <Button variant="outline" size="sm">
                      Exportar Dados dos Usuários
                    </Button>
                    <Button variant="outline" size="sm">
                      Relatório de Assinaturas
                    </Button>
                    <Button variant="outline" size="sm">
                      Logs do Sistema
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </PlanGuard>
  );
}
