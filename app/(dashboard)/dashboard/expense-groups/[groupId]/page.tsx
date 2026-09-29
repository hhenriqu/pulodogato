"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CampoDeValor } from "@/components/ui/campo-de-valor";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { toast } from "sonner";
import {
  ArrowLeft,
  Plus,
  Calendar,
  DollarSign,
  Users,
  TrendingUp,
  ChevronDown,
  ChevronRight,
  Receipt,
  Calculator,
  Crown,
  AlertCircle,
  CheckCircle,
  Clock,
} from "lucide-react";
import SplitSuggestions from "@/components/financial/SplitSuggestions";

interface ExpenseGroup {
  id: string;
  name: string;
  description: string;
  group_code: string;
  group_type: "public" | "private";
  default_split_type: "equal" | "percentage" | "custom" | "proportional";
  photo_url?: string;
  created_at: string;
  creator?: {
    full_name: string;
    avatar_url?: string;
  };
  members?: GroupMember[];
}

interface GroupMember {
  id: string;
  role: "admin" | "member";
  status: "active" | "inactive" | "pending" | "removed";
  percentage: number;
  user: {
    id: string;
    full_name: string;
    avatar_url?: string;
  };
}

interface GroupTransaction {
  id: string;
  description: string;
  amount: number;
  transaction_date: string;
  created_at: string;
  payer: {
    id: string;
    full_name: string;
    avatar_url?: string;
  };
  splits: {
    id: string;
    amount: number;
    percentage: number;
    status: "pending" | "approved" | "rejected";
    member: {
      id: string;
      full_name: string;
      avatar_url?: string;
    };
  }[];
  category?: {
    name: string;
    icon: string;
  };
}

interface BalanceSummary {
  member: {
    id: string;
    full_name: string;
    avatar_url?: string;
  };
  balance: number; // Positivo = a receber, Negativo = deve pagar
  transactions_count: number;
}

interface TransferSuggestion {
  from: {
    id: string;
    full_name: string;
    avatar_url?: string;
  };
  to: {
    id: string;
    full_name: string;
    avatar_url?: string;
  };
  amount: number;
}

/** Um pagamento de um membro para outro, ja registrado (migration 007). */
interface Settlement {
  id: string;
  amount: number;
  settled_on: string;
  note?: string | null;
  from_user: { id: string; full_name: string; avatar_url?: string };
  to_user: { id: string; full_name: string; avatar_url?: string };
  /** A RLS so deixa desfazer quem registrou; a API ja resolve isto. */
  can_delete: boolean;
}

/**
 * Inicial do nome para o avatar.
 *
 * `full_name` e opcional em profiles e chega null para quem nunca preencheu o
 * perfil. `null.charAt(0)` derruba a tela inteira com "Cannot read properties
 * of null" -- e a pessoa sem nome aparece justamente na tela de grupo, que e
 * onde entram os convidados recem-chegados.
 */
const inicial = (nome?: string | null) =>
  nome && nome.length > 0 ? nome.charAt(0).toUpperCase() : "?";

export default function GroupDetailPage() {
  const params = useParams();
  const router = useRouter();
  const groupId = params.groupId as string;

  const [user, setUser] = useState<User | null>(null);
  const [group, setGroup] = useState<ExpenseGroup | null>(null);
  const [transactions, setTransactions] = useState<GroupTransaction[]>([]);
  const [balances, setBalances] = useState<BalanceSummary[]>([]);
  const [transfers, setTransfers] = useState<TransferSuggestion[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  // Sobra que nao pertence a ninguem. Zero em grupo saudavel.
  const [residual, setResidual] = useState(0);
  // Chave "pagador->recebedor" da linha em que o botao esta rodando, para nao
  // registrar o mesmo acerto duas vezes num clique duplo -- o banco aceita
  // pagamentos repetidos de proposito (duas parcelas de R$ 50 sao um fato
  // possivel), entao a protecao contra o clique acidental e aqui.
  const [settling, setSettling] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("expenses");

  // Estados do formulário de nova despesa
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    description: "",
    amount: "",
    category_id: "",
    transaction_date: new Date().toISOString().split("T")[0],
    notes: "",
    split_type: "equal" as "equal" | "percentage" | "custom",
  });
  const [selectedSplitSuggestion, setSelectedSplitSuggestion] =
    useState<any>(null);

  // Estados dos accordions
  const [openSections, setOpenSections] = useState<string[]>(["current"]);

  const supabase = createClient();

  useEffect(() => {
    loadData();
  }, [groupId]);

  const loadData = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      setUser(user);

      // Carregar dados do grupo
      await Promise.all([
        loadGroup(),
        loadTransactions(),
        loadBalances(),
        loadTransfers(),
        loadSettlements(),
      ]);
    } catch (error) {
      console.error("Error loading data:", error);
      toast.error("Erro ao carregar dados do grupo");
    } finally {
      setLoading(false);
    }
  };

  const loadGroup = async () => {
    const response = await fetch(`/api/expense-groups/${groupId}`);
    const data = await response.json();

    if (response.ok) {
      setGroup(data.group);
    } else {
      toast.error(data.error || "Erro ao carregar grupo");
      router.push("/dashboard/expense-groups");
    }
  };

  const loadTransactions = async () => {
    const response = await fetch(`/api/expense-groups/${groupId}/transactions`);
    const data = await response.json();

    if (response.ok) {
      setTransactions(data.transactions || []);
    } else {
      console.error("Error loading transactions:", data.error);
    }
  };

  const loadBalances = async () => {
    const response = await fetch(`/api/expense-groups/${groupId}/balances`);
    const data = await response.json();

    if (response.ok) {
      setBalances(data.balances || []);
    } else {
      console.error("Error loading balances:", data.error);
    }
  };

  const loadTransfers = async () => {
    const response = await fetch(`/api/expense-groups/${groupId}/transfers`);
    const data = await response.json();

    if (response.ok) {
      setTransfers(data.transfers || []);
      // Diferente de zero: o grupo nao fecha. Ver a nota de `residual` em
      // lib/settlement.ts -- despesa sem rateio, rateio parcial, ou parte no
      // nome de quem ja saiu. Sem este aviso o usuario tentaria acertar uma
      // conta que nao tem como terminar.
      setResidual(Number(data.residual) || 0);
    } else {
      console.error("Error loading transfers:", data.error);
    }
  };

  const loadSettlements = async () => {
    const response = await fetch(`/api/expense-groups/${groupId}/settlements`);
    const data = await response.json();

    if (response.ok) {
      setSettlements(data.settlements || []);
    } else {
      console.error("Error loading settlements:", data.error);
    }
  };

  /**
   * Registra a transferencia sugerida como paga.
   *
   * Recarrega saldos, sugestoes e historico juntos: os tres derivam do mesmo
   * dado, e atualizar so um deixaria a tela mostrando uma divida que a lista de
   * baixo ja diz estar quitada.
   */
  const handleLiquidar = async (transfer: TransferSuggestion) => {
    setSettling(`${transfer.from.id}->${transfer.to.id}`);
    try {
      const response = await fetch(
        `/api/expense-groups/${groupId}/settlements`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            from_user_id: transfer.from.id,
            to_user_id: transfer.to.id,
            amount: transfer.amount,
          }),
        }
      );
      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Não foi possível registrar o acerto");
        return;
      }

      toast.success("Acerto registrado");
      await Promise.all([loadBalances(), loadTransfers(), loadSettlements()]);
    } catch (error) {
      console.error("Erro ao registrar acerto:", error);
      toast.error("Não foi possível registrar o acerto");
    } finally {
      setSettling(null);
    }
  };

  const handleDesfazerAcerto = async (settlementId: string) => {
    try {
      const response = await fetch(
        `/api/expense-groups/${groupId}/settlements/${settlementId}`,
        { method: "DELETE" }
      );
      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Não foi possível desfazer o acerto");
        return;
      }

      toast.success("Acerto desfeito");
      await Promise.all([loadBalances(), loadTransfers(), loadSettlements()]);
    } catch (error) {
      console.error("Erro ao desfazer acerto:", error);
      toast.error("Não foi possível desfazer o acerto");
    }
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!expenseForm.description.trim() || !expenseForm.amount) {
      toast.error("Preencha descrição e valor");
      return;
    }

    try {
      // Preparar dados da despesa
      const expenseData: any = {
        ...expenseForm,
        amount: parseFloat(expenseForm.amount),
      };

      // Adicionar dados da sugestão selecionada se houver
      if (selectedSplitSuggestion) {
        expenseData.split_type = selectedSplitSuggestion.type;
        expenseData.custom_splits = selectedSplitSuggestion.splits.map(
          (split: any) => ({
            member_id: split.member_id,
            percentage: split.percentage,
            amount: split.amount,
          })
        );
      }

      const response = await fetch(
        `/api/expense-groups/${groupId}/transactions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(expenseData),
        }
      );

      const data = await response.json();

      if (response.ok) {
        toast.success("Despesa adicionada com sucesso!");
        setShowAddExpense(false);
        setExpenseForm({
          description: "",
          amount: "",
          category_id: "",
          transaction_date: new Date().toISOString().split("T")[0],
          notes: "",
          split_type: "equal",
        });
        setSelectedSplitSuggestion(null);
        await loadTransactions();
        await loadBalances();
        await loadTransfers();
      } else {
        toast.error(data.error || "Erro ao adicionar despesa");
      }
    } catch (error) {
      console.error("Error adding expense:", error);
      toast.error("Erro ao adicionar despesa");
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(amount);
  };

  /**
   * `settled_on` e um DATE do Postgres, que chega como "2026-09-22".
   * `new Date("2026-09-22")` e interpretado como MEIA-NOITE UTC e, no fuso de
   * Brasilia, volta como dia 21 -- o pagamento apareceria um dia antes do que
   * foi registrado. Formatando os pedacos direto, sem Date, isso nao acontece.
   */
  const formatDate = (iso: string) => {
    const [ano, mes, dia] = (iso || "").split("-");
    return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "approved":
        return "bg-success/10 text-success";
      case "pending":
        return "bg-warning/10 text-warning";
      case "rejected":
        return "bg-destructive/10 text-destructive";
      default:
        return "bg-muted text-foreground";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "approved":
        return <CheckCircle className="h-3 w-3" />;
      case "pending":
        return <Clock className="h-3 w-3" />;
      case "rejected":
        return <AlertCircle className="h-3 w-3" />;
      default:
        return <Clock className="h-3 w-3" />;
    }
  };

  const toggleSection = (sectionId: string) => {
    setOpenSections((prev) =>
      prev.includes(sectionId)
        ? prev.filter((id) => id !== sectionId)
        : [...prev, sectionId]
    );
  };

  const groupTransactionsByPeriod = () => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const groups = {
      current: transactions.filter((t) => {
        const date = new Date(t.transaction_date);
        return (
          date.getMonth() === currentMonth && date.getFullYear() === currentYear
        );
      }),
      previous: transactions.filter((t) => {
        const date = new Date(t.transaction_date);
        const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
        const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
        return date.getMonth() === prevMonth && date.getFullYear() === prevYear;
      }),
      older: transactions.filter((t) => {
        const date = new Date(t.transaction_date);
        const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
        const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
        return (
          date.getFullYear() < prevYear ||
          (date.getFullYear() === prevYear && date.getMonth() < prevMonth)
        );
      }),
    };

    return groups;
  };

  const getUserRole = () => {
    if (!user || !group) return null;
    const member = group.members?.find((m) => m.user.id === user.id);
    return member?.role || null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="container mx-auto py-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-destructive mb-4">
            Grupo não encontrado
          </h1>
          <Button onClick={() => router.push("/dashboard/expense-groups")}>
            Voltar para Grupos
          </Button>
        </div>
      </div>
    );
  }

  const transactionGroups = groupTransactionsByPeriod();

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/dashboard/expense-groups")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar
          </Button>
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Users className="h-8 w-8" />
              {group.name}
            </h1>
            <p className="text-muted-foreground">
              {group.description || "Sem descrição"} • Código:{" "}
              {group.group_code}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={() => setShowAddExpense(true)}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Adicionar Despesa
          </Button>
        </div>
      </div>

      {/* Group Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Membros</p>
                <p className="text-2xl font-bold">
                  {group.members?.length || 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Despesas</p>
                <p className="text-2xl font-bold">{transactions.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Total Gasto</p>
                <p className="text-2xl font-bold">
                  {formatCurrency(
                    transactions.reduce((sum, t) => sum + t.amount, 0)
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Calculator className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Pendências</p>
                <p className="text-2xl font-bold">
                  {balances.filter((b) => Math.abs(b.balance) > 0.01).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="expenses">Despesas</TabsTrigger>
          <TabsTrigger value="balances">Balanços</TabsTrigger>
          <TabsTrigger value="members">Membros</TabsTrigger>
        </TabsList>

        <TabsContent value="expenses" className="space-y-4">
          {/* Expenses by Period */}
          <div className="space-y-4">
            {/* Current Month */}
            <Card>
              <CardHeader
                className="cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => toggleSection("current")}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="h-5 w-5" />
                      Mês Atual
                      <Badge variant="outline">
                        {transactionGroups.current.length} despesa
                        {transactionGroups.current.length !== 1 ? "s" : ""}
                      </Badge>
                    </CardTitle>
                    <CardDescription>
                      Total:{" "}
                      {formatCurrency(
                        transactionGroups.current.reduce(
                          (sum, t) => sum + t.amount,
                          0
                        )
                      )}
                    </CardDescription>
                  </div>
                  {openSections.includes("current") ? (
                    <ChevronDown className="h-5 w-5" />
                  ) : (
                    <ChevronRight className="h-5 w-5" />
                  )}
                </div>
              </CardHeader>
              {openSections.includes("current") && (
                <CardContent className="space-y-3">
                  {transactionGroups.current.length > 0 ? (
                    transactionGroups.current.map((transaction) => (
                      <div
                        key={transaction.id}
                        className="border rounded-lg p-4"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={transaction.payer.avatar_url} />
                              <AvatarFallback>
                                {inicial(transaction.payer.full_name)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <h4 className="font-medium">
                                {transaction.description}
                              </h4>
                              <p className="text-sm text-muted-foreground">
                                Pago por {transaction.payer.full_name} •{" "}
                                {new Date(
                                  transaction.transaction_date
                                ).toLocaleDateString("pt-BR")}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-lg">
                              {formatCurrency(transaction.amount)}
                            </p>
                            {transaction.category && (
                              <Badge variant="secondary" className="text-xs">
                                {transaction.category.name}
                              </Badge>
                            )}
                          </div>
                        </div>

                        {/* Transaction Splits */}
                        <div className="space-y-2">
                          <p className="text-sm font-medium">Divisão:</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {transaction.splits.map((split) => (
                              <div
                                key={split.id}
                                className="flex items-center justify-between p-2 bg-muted rounded"
                              >
                                <div className="flex items-center gap-2">
                                  <Avatar className="h-6 w-6">
                                    <AvatarImage
                                      src={split.member.avatar_url}
                                    />
                                    <AvatarFallback className="text-xs">
                                      {inicial(split.member.full_name)}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="text-sm">
                                    {split.member.full_name}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium">
                                    {formatCurrency(split.amount)}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className={`text-xs ${getStatusColor(
                                      split.status
                                    )}`}
                                  >
                                    {getStatusIcon(split.status)}
                                  </Badge>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-center text-muted-foreground py-8">
                      Nenhuma despesa neste período
                    </p>
                  )}
                </CardContent>
              )}
            </Card>

            {/* Previous Month */}
            {transactionGroups.previous.length > 0 && (
              <Card>
                <CardHeader
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => toggleSection("previous")}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Calendar className="h-5 w-5" />
                        Mês Anterior
                        <Badge variant="outline">
                          {transactionGroups.previous.length} despesa
                          {transactionGroups.previous.length !== 1 ? "s" : ""}
                        </Badge>
                      </CardTitle>
                      <CardDescription>
                        Total:{" "}
                        {formatCurrency(
                          transactionGroups.previous.reduce(
                            (sum, t) => sum + t.amount,
                            0
                          )
                        )}
                      </CardDescription>
                    </div>
                    {openSections.includes("previous") ? (
                      <ChevronDown className="h-5 w-5" />
                    ) : (
                      <ChevronRight className="h-5 w-5" />
                    )}
                  </div>
                </CardHeader>
                {openSections.includes("previous") && (
                  <CardContent className="space-y-3">
                    {transactionGroups.previous.map((transaction) => (
                      <div
                        key={transaction.id}
                        className="border rounded-lg p-4"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={transaction.payer.avatar_url} />
                              <AvatarFallback>
                                {inicial(transaction.payer.full_name)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <h4 className="font-medium">
                                {transaction.description}
                              </h4>
                              <p className="text-sm text-muted-foreground">
                                Pago por {transaction.payer.full_name} •{" "}
                                {new Date(
                                  transaction.transaction_date
                                ).toLocaleDateString("pt-BR")}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-lg">
                              {formatCurrency(transaction.amount)}
                            </p>
                            {transaction.category && (
                              <Badge variant="secondary" className="text-xs">
                                {transaction.category.name}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                )}
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="balances" className="space-y-4">
          {/* Balance Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5" />
                Resumo de Balanços
              </CardTitle>
              <CardDescription>Quem deve pagar para quem</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Individual Balances */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {balances.map((balance) => (
                    <div
                      key={balance.member.id}
                      className="border rounded-lg p-4"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={balance.member.avatar_url} />
                            <AvatarFallback>
                              {inicial(balance.member.full_name)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <h4 className="font-medium">
                              {balance.member.full_name}
                            </h4>
                            <p className="text-sm text-muted-foreground">
                              {balance.transactions_count} transação
                              {balance.transactions_count !== 1 ? "ões" : ""}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p
                            className={`font-bold text-lg ${
                              balance.balance > 0
                                ? "text-success"
                                : balance.balance < 0
                                ? "text-destructive"
                                : "text-muted-foreground"
                            }`}
                          >
                            {formatCurrency(Math.abs(balance.balance))}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {balance.balance > 0
                              ? "A receber"
                              : balance.balance < 0
                              ? "Deve pagar"
                              : "Quitado"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* O grupo nao fecha: avisa antes de sugerir um acerto que
                    nunca termina. */}
                {Math.abs(residual) >= 0.02 && (
                  <div className="flex items-start gap-3 p-4 bg-warning/10 rounded-lg border border-warning/30">
                    <AlertCircle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-medium text-warning">
                        As contas deste grupo não fecham por{" "}
                        {formatCurrency(Math.abs(residual))}
                      </p>
                      <p className="text-warning">
                        Sobra um valor que não foi atribuído a ninguém.
                        Costuma ser despesa lançada sem divisão, divisão que não
                        cobre o valor inteiro, ou parte no nome de quem já saiu
                        do grupo. Mesmo acertando tudo abaixo, esse valor
                        continuará aparecendo.
                      </p>
                    </div>
                  </div>
                )}

                {/* Transfer Suggestions */}
                {transfers.length > 0 ? (
                  <div className="space-y-3">
                    <h3 className="text-lg font-semibold">
                      Sugestões de Pagamento
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      O menor número de transferências que zera o grupo. Ao
                      registrar, a sugestão sai da lista.
                    </p>
                    <div className="space-y-2">
                      {transfers.map((transfer, index) => {
                        const chave = `${transfer.from.id}->${transfer.to.id}`;
                        // So quem paga ou quem recebe pode registrar: a policy
                        // de INSERT da 007 exige isso, e oferecer o botao a um
                        // terceiro seria prometer uma acao que o banco recusa.
                        const souParte =
                          user?.id === transfer.from.id ||
                          user?.id === transfer.to.id;

                        return (
                          <div
                            key={index}
                            className="flex items-center justify-between p-4 bg-info/10 rounded-lg border border-info/30"
                          >
                            <div className="flex items-center gap-3">
                              <Avatar className="h-8 w-8">
                                <AvatarImage src={transfer.from.avatar_url} />
                                <AvatarFallback>
                                  {inicial(transfer.from.full_name)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="font-medium">
                                {transfer.from.full_name || "Sem nome"}
                              </span>
                              <TrendingUp className="h-4 w-4 text-info" />
                              <Avatar className="h-8 w-8">
                                <AvatarImage src={transfer.to.avatar_url} />
                                <AvatarFallback>
                                  {inicial(transfer.to.full_name)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="font-medium">
                                {transfer.to.full_name || "Sem nome"}
                              </span>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <p className="font-bold text-lg text-info">
                                  {formatCurrency(transfer.amount)}
                                </p>
                                <p className="text-sm text-info">
                                  Pagamento sugerido
                                </p>
                              </div>
                              {souParte && (
                                <Button
                                  size="sm"
                                  onClick={() => handleLiquidar(transfer)}
                                  disabled={settling === chave}
                                >
                                  <CheckCircle className="h-4 w-4 mr-1" />
                                  {settling === chave
                                    ? "Registrando..."
                                    : "Já paguei"}
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  balances.length > 0 && (
                    <div className="flex items-center gap-3 p-4 bg-success/10 rounded-lg border border-success/30">
                      <CheckCircle className="h-5 w-5 text-success" />
                      <p className="text-sm text-success">
                        Tudo acertado. Ninguém deve nada a ninguém neste grupo.
                      </p>
                    </div>
                  )
                )}

                {/* Acertos ja registrados */}
                {settlements.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-lg font-semibold">
                      Pagamentos registrados
                    </h3>
                    <div className="space-y-2">
                      {settlements.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center justify-between p-3 border rounded-lg"
                        >
                          <div className="flex items-center gap-2 text-sm">
                            <Avatar className="h-6 w-6">
                              <AvatarImage src={s.from_user?.avatar_url} />
                              <AvatarFallback>
                                {inicial(s.from_user?.full_name)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium">
                              {s.from_user?.full_name || "Sem nome"}
                            </span>
                            <span className="text-muted-foreground">pagou</span>
                            <Avatar className="h-6 w-6">
                              <AvatarImage src={s.to_user?.avatar_url} />
                              <AvatarFallback>
                                {inicial(s.to_user?.full_name)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium">
                              {s.to_user?.full_name || "Sem nome"}
                            </span>
                            <span className="text-muted-foreground">
                              em {formatDate(s.settled_on)}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-semibold">
                              {formatCurrency(s.amount)}
                            </span>
                            {s.can_delete && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDesfazerAcerto(s.id)}
                              >
                                Desfazer
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="members" className="space-y-4">
          {/* Members List */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Membros do Grupo
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {group.members?.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={member.user.avatar_url} />
                        <AvatarFallback>
                          {inicial(member.user.full_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <h4 className="font-medium flex items-center gap-2">
                          {member.user.full_name}
                          {member.role === "admin" && (
                            <Crown className="h-4 w-4 text-warning" />
                          )}
                        </h4>
                        <p className="text-sm text-muted-foreground capitalize">
                          {member.role} • {member.status}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge
                        variant={
                          member.status === "active" ? "default" : "secondary"
                        }
                      >
                        {member.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Expense Modal */}
      {showAddExpense && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle>Adicionar Nova Despesa</CardTitle>
              <CardDescription>
                Registre uma despesa para o grupo
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAddExpense} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="description">Descrição *</Label>
                  <Input
                    id="description"
                    value={expenseForm.description}
                    onChange={(e) =>
                      setExpenseForm({
                        ...expenseForm,
                        description: e.target.value,
                      })
                    }
                    placeholder="Ex: Jantar no restaurante"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="amount">Valor *</Label>
                  <CampoDeValor
                    id="amount"
                    value={expenseForm.amount}
                    onChange={(amount) =>
                      setExpenseForm({ ...expenseForm, amount })
                    }
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="transaction_date">Data</Label>
                  <Input
                    id="transaction_date"
                    type="date"
                    value={expenseForm.transaction_date}
                    onChange={(e) =>
                      setExpenseForm({
                        ...expenseForm,
                        transaction_date: e.target.value,
                      })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="split_type">Tipo de Divisão</Label>
                  <Select
                    value={expenseForm.split_type}
                    onValueChange={(value: "equal" | "percentage" | "custom") =>
                      setExpenseForm({ ...expenseForm, split_type: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="equal">Divisão Igual</SelectItem>
                      <SelectItem value="percentage">Por Percentual</SelectItem>
                      <SelectItem value="custom">Customizada</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Sugestões de Split */}
                {parseFloat(expenseForm.amount) > 0 && (
                  <div className="space-y-2">
                    <SplitSuggestions
                      groupId={groupId}
                      amount={parseFloat(expenseForm.amount)}
                      onSelectSuggestion={setSelectedSplitSuggestion}
                      selectedSuggestion={selectedSplitSuggestion}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="notes">Observações</Label>
                  <Textarea
                    id="notes"
                    value={expenseForm.notes}
                    onChange={(e) =>
                      setExpenseForm({ ...expenseForm, notes: e.target.value })
                    }
                    placeholder="Observações adicionais..."
                    rows={3}
                  />
                </div>

                <div className="flex gap-2">
                  <Button type="submit">Adicionar Despesa</Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowAddExpense(false)}
                  >
                    Cancelar
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
