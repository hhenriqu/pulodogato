"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { User } from "@supabase/supabase-js";
import { useSubscription } from "@/lib/hooks/useSubscription";
import { FeatureGuard, PlanBadge } from "@/components/subscription/PlanGuards";
import {
  SoftFeatureGuard,
  PremiumBadge,
} from "@/components/subscription/SoftFeatureGuard";
import {
  QuickUsage,
  UsageLimitsCard,
} from "@/components/subscription/UsageLimits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  Wallet,
  Plus,
  TrendingDown,
  TrendingUp,
  Users,
  Calendar,
  Filter,
  Search,
  Receipt,
  DollarSign,
  ArrowUpDown,
  Eye,
  Pencil,
  Trash2,
  Share2,
  Crown,
} from "lucide-react";
import Link from "next/link";

interface FinancialService {
  id: string;
  name: string;
  description: string;
  icon: string;
  color_hex: string;
}

interface TransactionCategory {
  id: string;
  service_id: string;
  name: string;
  description: string;
  icon: string;
  color_hex: string;
  is_expense: boolean;
}

interface FinancialTransaction {
  id: string;
  user_id: string;
  service_id: string;
  category_id: string;
  account_id?: string;
  description: string;
  amount: number;
  transaction_date: string;
  transaction_type?: string;
  attachment_url?: string;
  notes?: string;
  is_shared: boolean;
  group_id?: string;
  created_at: string;
  category?: TransactionCategory;
  expense_splits?: ExpenseSplit[];
}

interface ExpenseSplit {
  id: string;
  participant_id: string;
  percentage: number;
  amount: number;
  status: "pending" | "approved" | "rejected" | "expired";
  participant?: {
    full_name: string;
    avatar_url?: string;
  };
}

interface Connection {
  id: string;
  full_name: string;
  nickname?: string;
  avatar_url?: string;
}

export default function PersonalFinancePage() {
  const [user, setUser] = useState<User | null>(null);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [categories, setCategories] = useState<TransactionCategory[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [expenseGroups, setExpenseGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("transactions");

  // Subscription and plan management
  const { canCreateMore, hasFeature, planConfig, isPremium } =
    useSubscription(user);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingTransaction, setEditingTransaction] =
    useState<FinancialTransaction | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    description: "",
    amount: "",
    category_id: "",
    transaction_date: new Date().toISOString().split("T")[0],
    transaction_type: "",
    account_id: "",
    notes: "",

    // Parcelamento
    is_installment: false,
    total_installments: 1,
    installment_amount: "",
    first_due_date: new Date().toISOString().split("T")[0],

    // Divisão/Grupos
    is_shared: false,
    group_id: "",
    splits: [] as { participant_id: string; percentage: number }[],
  });

  // Função para alternar o formulário
  const toggleAddForm = () => {
    if (showAddForm) {
      // Se está fechando, cancelar tudo
      cancelForm();
    } else {
      // Se está abrindo, mostrar formulário
      setShowAddForm(true);
      if (activeTab !== "transactions") {
        setActiveTab("transactions");
      }
    }
  };

  // Função para cancelar o formulário
  const cancelForm = () => {
    setShowAddForm(false);
    setEditingTransaction(null);
    setFormData({
      description: "",
      amount: "",
      category_id: "",
      transaction_date: new Date().toISOString().split("T")[0],
      transaction_type: "",
      account_id: "",
      notes: "",
      is_installment: false,
      total_installments: 1,
      installment_amount: "",
      first_due_date: new Date().toISOString().split("T")[0],
      is_shared: false,
      group_id: "",
      splits: [],
    });
  };

  // Função para iniciar edição de transação
  const startEdit = (transaction: FinancialTransaction) => {
    setEditingTransaction(transaction);
    setShowAddForm(true);

    // Determinar tipo da transação baseado no valor
    let transactionType = "expense";
    if (transaction.amount > 0) {
      transactionType = "income";
    } else if (transaction.category?.is_expense === false) {
      transactionType = "transfer";
    }

    setFormData({
      description: transaction.description,
      amount: Math.abs(transaction.amount).toString(),
      category_id: transaction.category_id,
      transaction_date: transaction.transaction_date,
      transaction_type: transactionType,
      account_id: transaction.account_id || "",
      notes: transaction.notes || "",
      is_installment: false,
      total_installments: 1,
      installment_amount: "",
      first_due_date: new Date().toISOString().split("T")[0],
      is_shared: transaction.is_shared,
      group_id: transaction.group_id || "",
      splits:
        transaction.expense_splits?.map((split) => ({
          participant_id: split.participant_id,
          percentage: split.percentage,
        })) || [],
    });
  };

  // Função para deletar transação
  const deleteTransaction = async (transactionId: string) => {
    if (!confirm("Tem certeza que deseja excluir esta transação?")) {
      return;
    }

    try {
      const { error } = await supabase
        .from("financial_transactions")
        .delete()
        .eq("id", transactionId)
        .eq("user_id", user?.id);

      if (error) throw error;

      toast.success("Transação excluída com sucesso!");
      loadData();
    } catch (error) {
      console.error("Error deleting transaction:", error);
      toast.error("Erro ao excluir transação");
    }
  };

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

      // Carregar categorias de finanças pessoais
      const { data: serviceData } = await supabase
        .from("financial_services")
        .select("id")
        .eq("name", "personal_finance")
        .single();

      if (serviceData) {
        const { data: categoriesData } = await supabase
          .from("transaction_categories")
          .select("*")
          .eq("service_id", serviceData.id)
          .eq("is_active", true)
          .order("name");

        setCategories(categoriesData || []);
      }

      // Carregar transações
      const { data: transactionsData } = await supabase
        .from("financial_transactions")
        .select(
          `
          *,
          category:transaction_categories(*),
          expense_splits(
            *,
            participant:profiles!expense_splits_participant_id_fkey(full_name, avatar_url)
          )
        `
        )
        .eq("user_id", user.id)
        .eq("service_id", serviceData?.id)
        .order("transaction_date", { ascending: false })
        .limit(50);

      setTransactions(transactionsData || []);

      // Carregar conexões para divisão
      // TEMPORÁRIO: Desabilitar user_connections completamente
      const connectionsData = null;
      const connectionsList: any[] = [];

      setConnections(connectionsList);

      // Carregar contas financeiras
      const accountsResponse = await fetch("/api/financial-accounts");
      const accountsData = await accountsResponse.json();
      if (accountsResponse.ok) {
        setAccounts(accountsData.accounts || []);
      }

      // Carregar grupos de despesas do usuário
      const groupsResponse = await fetch("/api/expense-groups");
      const groupsData = await groupsResponse.json();
      if (groupsResponse.ok) {
        setExpenseGroups(groupsData.groups || []);
      }
    } catch (error) {
      console.error("Error loading data:", error);
      toast.error("Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validações básicas
    if (
      !user ||
      !formData.description ||
      !formData.category_id ||
      !formData.transaction_type
    ) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    // Se estiver editando, não permitir parcelamento
    if (editingTransaction && formData.is_installment) {
      toast.error(
        "Não é possível parcelar uma transação existente. Crie uma nova transação."
      );
      return;
    }

    // Validação de valores para parcelamento
    if (formData.is_installment) {
      if (
        !formData.installment_amount ||
        parseFloat(formData.installment_amount) <= 0
      ) {
        toast.error("Valor da parcela deve ser maior que zero");
        return;
      }
      if (formData.total_installments < 2) {
        toast.error("Número de parcelas deve ser maior que 1");
        return;
      }
    } else {
      if (!formData.amount || parseFloat(formData.amount) <= 0) {
        toast.error("Valor deve ser maior que zero");
        return;
      }
    }

    try {
      // Se é parcelamento, criar parcelas
      if (formData.is_installment) {
        const installmentData = {
          account_id: formData.account_id || null,
          category_id: formData.category_id,
          description: formData.description,
          total_amount:
            parseFloat(formData.installment_amount) *
            formData.total_installments,
          total_installments: formData.total_installments,
          first_due_date: formData.first_due_date,
          transaction_type: formData.transaction_type,
          group_id:
            formData.group_id && formData.group_id !== "none"
              ? formData.group_id
              : null,
          group_split_type:
            formData.group_id && formData.group_id !== "none"
              ? expenseGroups.find((g) => g.id === formData.group_id)
                  ?.default_split_type || "equal"
              : null,
          notes: formData.notes,
        };

        const response = await fetch("/api/financial-installments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(installmentData),
        });

        const result = await response.json();

        if (response.ok) {
          toast.success(result.message);
        } else {
          toast.error(result.error || "Erro ao criar parcelas");
          return;
        }
      } else {
        // Transação única (sem parcelamento)
        const amount = parseFloat(formData.amount);
        const selectedCategory = categories.find(
          (c) => c.id === formData.category_id
        );
        const isExpense = selectedCategory?.is_expense;

        // Ajustar sinal do valor
        let finalAmount = amount;
        if (formData.transaction_type === "expense" || isExpense) {
          finalAmount = -Math.abs(amount);
        } else if (formData.transaction_type === "income") {
          finalAmount = Math.abs(amount);
        }

        const { data: serviceData } = await supabase
          .from("financial_services")
          .select("id")
          .eq("name", "personal_finance")
          .single();

        let transaction;

        if (editingTransaction) {
          // Atualizar transação existente
          const { data: updatedTransaction, error } = await supabase
            .from("financial_transactions")
            .update({
              category_id: formData.category_id,
              account_id: formData.account_id || null,
              description: formData.description,
              amount: finalAmount,
              transaction_date: formData.transaction_date,
              transaction_type: formData.transaction_type,
              notes: formData.notes,
              is_shared: Boolean(
                formData.is_shared &&
                  (formData.splits.length > 0 ||
                    (formData.group_id && formData.group_id !== "none"))
              ),
              group_id:
                formData.group_id && formData.group_id !== "none"
                  ? formData.group_id
                  : null,
            })
            .eq("id", editingTransaction.id)
            .eq("user_id", user.id)
            .select()
            .single();

          if (error) throw error;
          transaction = updatedTransaction;

          // Remover splits existentes se estiver editando
          await supabase
            .from("expense_splits")
            .delete()
            .eq("transaction_id", editingTransaction.id);
        } else {
          // Criar nova transação
          const { data: newTransaction, error } = await supabase
            .from("financial_transactions")
            .insert({
              user_id: user.id,
              service_id: serviceData?.id,
              category_id: formData.category_id,
              account_id: formData.account_id || null,
              description: formData.description,
              amount: finalAmount,
              transaction_date: formData.transaction_date,
              transaction_type: formData.transaction_type,
              notes: formData.notes,
              is_shared: Boolean(
                formData.is_shared &&
                  (formData.splits.length > 0 ||
                    (formData.group_id && formData.group_id !== "none"))
              ),
              group_id:
                formData.group_id && formData.group_id !== "none"
                  ? formData.group_id
                  : null,
            })
            .select()
            .single();

          if (error) throw error;
          transaction = newTransaction;
        }

        // SINCRONIZAÇÃO COM GRUPOS - Criar group_transaction se tem group_id
        if (
          formData.group_id &&
          formData.group_id !== "none" &&
          finalAmount < 0
        ) {
          console.log("🔄 Criando sincronização com grupo:", formData.group_id);

          // Criar group_transaction
          const { data: groupTransaction, error: groupTransactionError } =
            await supabase
              .from("group_transactions")
              .insert({
                group_id: formData.group_id,
                transaction_id: transaction.id,
                split_type: "equal",
              })
              .select()
              .single();

          if (groupTransactionError) {
            console.error(
              "Erro ao criar group_transaction:",
              groupTransactionError
            );
          } else {
            console.log("✅ Group transaction criada:", groupTransaction.id);

            // Buscar membros ativos do grupo e criar splits
            const { data: members } = await supabase
              .from("group_members")
              .select("id")
              .eq("group_id", formData.group_id)
              .eq("status", "active");

            if (members && members.length > 0) {
              const splitAmount = Math.abs(finalAmount) / members.length;
              const splitPercentage = 100 / members.length;

              const groupSplitsData = members.map((member: any) => ({
                group_transaction_id: groupTransaction.id,
                member_id: member.id,
                percentage: splitPercentage,
                amount: splitAmount,
                status: "pending",
              }));

              const { error: groupSplitsError } = await supabase
                .from("group_expense_splits")
                .insert(groupSplitsData);

              if (groupSplitsError) {
                console.error("Erro ao criar group splits:", groupSplitsError);
              } else {
                console.log("✅ Group splits criados:", members.length);
              }
            }
          }
        }

        // Se tem divisão por conexões individuais
        if (
          formData.is_shared &&
          formData.splits.length > 0 &&
          (!formData.group_id || formData.group_id === "none")
        ) {
          const splitsData = formData.splits.map((split) => ({
            transaction_id: transaction.id,
            participant_id: split.participant_id,
            percentage: split.percentage,
            amount: Math.abs(finalAmount) * (split.percentage / 100),
            status: "pending",
          }));

          const { error: splitError } = await supabase
            .from("expense_splits")
            .insert(splitsData);

          if (splitError) throw splitError;
        }

        toast.success(
          editingTransaction
            ? "Transação atualizada com sucesso!"
            : "Lançamento criado com sucesso!"
        );
      }

      // Reset formulário e fechar
      setShowAddForm(false);
      setEditingTransaction(null);
      setFormData({
        description: "",
        amount: "",
        category_id: "",
        transaction_date: new Date().toISOString().split("T")[0],
        transaction_type: "",
        account_id: "",
        notes: "",
        is_installment: false,
        total_installments: 1,
        installment_amount: "",
        first_due_date: new Date().toISOString().split("T")[0],
        is_shared: false,
        group_id: "",
        splits: [],
      });
      loadData();
    } catch (error) {
      console.error("Error creating transaction:", error);
      toast.error("Erro ao criar lançamento");
    }
  };

  const addSplit = (participantId: string) => {
    if (formData.splits.find((s) => s.participant_id === participantId)) return;

    const currentTotal = formData.splits.reduce(
      (sum, s) => sum + s.percentage,
      0
    );
    const remainingPercentage = 100 - currentTotal;

    setFormData({
      ...formData,
      splits: [
        ...formData.splits,
        {
          participant_id: participantId,
          percentage: Math.min(remainingPercentage, 50),
        },
      ],
    });
  };

  const updateSplitPercentage = (participantId: string, percentage: number) => {
    setFormData({
      ...formData,
      splits: formData.splits.map((s) =>
        s.participant_id === participantId ? { ...s, percentage } : s
      ),
    });
  };

  const removeSplit = (participantId: string) => {
    setFormData({
      ...formData,
      splits: formData.splits.filter((s) => s.participant_id !== participantId),
    });
  };

  const calculateBalance = () => {
    const income = transactions
      .filter((t) => t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);

    const expenses = transactions
      .filter((t) => t.amount < 0)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    return { income, expenses, balance: income - expenses };
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

  const { income, expenses, balance } = calculateBalance();
  const totalSplitPercentage = formData.splits.reduce(
    (sum, s) => sum + s.percentage,
    0
  );

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Wallet className="h-8 w-8" />
            Finanças Pessoais
          </h1>
          <p className="text-muted-foreground">
            Gerencie seus gastos e receitas com divisão inteligente entre
            conexões
          </p>
        </div>
        <div className="flex items-center gap-2">
          {planConfig && <PlanBadge plan={planConfig.id} size="sm" />}
          <Button
            onClick={toggleAddForm}
            className="flex items-center gap-2"
            disabled={!canCreateMore("maxTransactions") && !editingTransaction}
          >
            <Plus className="h-4 w-4" />
            {showAddForm
              ? editingTransaction
                ? "Cancelar Edição"
                : "Fechar Formulário"
              : "Novo Lançamento"}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Receitas</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(income)}
            </div>
            <p className="text-xs text-muted-foreground">Este mês</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Despesas</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {formatCurrency(expenses)}
            </div>
            <p className="text-xs text-muted-foreground">Este mês</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Saldo</CardTitle>
            <DollarSign className="h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                balance >= 0 ? "text-green-600" : "text-red-600"
              }`}
            >
              {formatCurrency(balance)}
            </div>
            <p className="text-xs text-muted-foreground">Receitas - Despesas</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="transactions">Transações</TabsTrigger>
          <TabsTrigger value="shared">Gastos Compartilhados</TabsTrigger>
          <TabsTrigger value="limits">Limites</TabsTrigger>
        </TabsList>

        <TabsContent value="transactions" className="space-y-4">
          {/* Enhanced Add Transaction Form */}
          {showAddForm && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {editingTransaction
                    ? "Editar Transação"
                    : "Novo Lançamento Financeiro"}
                </CardTitle>
                <CardDescription>
                  {editingTransaction
                    ? "Modifique os dados da transação selecionada"
                    : "Adicione receitas, despesas, balanços com parcelamento e divisão em grupos"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Tipo de Transação */}
                  <div className="space-y-2">
                    <Label>Tipo de Lançamento *</Label>
                    <Select
                      value={formData.transaction_type || ""}
                      onValueChange={(value) =>
                        setFormData({ ...formData, transaction_type: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o tipo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="income">
                          <div className="flex items-center gap-2">
                            <TrendingUp className="h-4 w-4 text-green-600" />
                            <span>Receita</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="expense">
                          <div className="flex items-center gap-2">
                            <TrendingDown className="h-4 w-4 text-red-600" />
                            <span>Despesa</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="transfer">
                          <div className="flex items-center gap-2">
                            <ArrowUpDown className="h-4 w-4 text-blue-600" />
                            <span>Transferência/Balanço</span>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Informações Básicas */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="description">Descrição *</Label>
                      <Input
                        id="description"
                        value={formData.description}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            description: e.target.value,
                          })
                        }
                        placeholder="Ex: Compra no supermercado"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="amount">Valor *</Label>
                      <Input
                        id="amount"
                        type="number"
                        step="0.01"
                        value={formData.amount}
                        onChange={(e) =>
                          setFormData({ ...formData, amount: e.target.value })
                        }
                        placeholder="0,00"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="category">Categoria *</Label>
                      <Select
                        value={formData.category_id}
                        onValueChange={(value: string) =>
                          setFormData({ ...formData, category_id: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione uma categoria" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories
                            .filter((cat) => {
                              if (!formData.transaction_type) return true;
                              return formData.transaction_type === "income"
                                ? !cat.is_expense
                                : cat.is_expense;
                            })
                            .map((category) => (
                              <SelectItem key={category.id} value={category.id}>
                                <div className="flex items-center gap-2">
                                  <div
                                    className="w-3 h-3 rounded-full"
                                    style={{
                                      backgroundColor: category.color_hex,
                                    }}
                                  />
                                  {category.name}
                                </div>
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="account">Conta/Cartão</Label>
                      <Select
                        value={formData.account_id}
                        onValueChange={(value: string) =>
                          setFormData({ ...formData, account_id: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione uma conta" />
                        </SelectTrigger>
                        <SelectContent>
                          {accounts.map((account) => (
                            <SelectItem key={account.id} value={account.id}>
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-3 h-3 rounded-full"
                                  style={{ backgroundColor: account.color_hex }}
                                />
                                {account.name}
                                {account.last_four_digits && (
                                  <span className="text-xs text-muted-foreground">
                                    •••• {account.last_four_digits}
                                  </span>
                                )}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="date">Data da Transação</Label>
                      <Input
                        id="date"
                        type="date"
                        value={formData.transaction_date}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            transaction_date: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>

                  {/* Seção de Parcelamento */}
                  {!editingTransaction && (
                    <div className="space-y-4 p-4 border rounded-lg bg-muted/20">
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="is_installment"
                          checked={formData.is_installment}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              is_installment: e.target.checked,
                            })
                          }
                        />
                        <Label htmlFor="is_installment" className="font-medium">
                          Parcelar este lançamento
                        </Label>
                        <Badge variant="outline" className="text-xs">
                          Apenas para novas transações
                        </Badge>
                      </div>

                      {formData.is_installment && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="total_installments">
                              Número de Parcelas
                            </Label>
                            <Input
                              id="total_installments"
                              type="number"
                              min="2"
                              max="60"
                              value={formData.total_installments}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  total_installments:
                                    parseInt(e.target.value) || 1,
                                })
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="installment_amount">
                              Valor da Parcela
                            </Label>
                            <Input
                              id="installment_amount"
                              type="number"
                              step="0.01"
                              value={formData.installment_amount}
                              onChange={(e) => {
                                const installmentValue =
                                  parseFloat(e.target.value) || 0;
                                setFormData({
                                  ...formData,
                                  installment_amount: e.target.value,
                                  amount: (
                                    installmentValue *
                                    formData.total_installments
                                  ).toFixed(2),
                                });
                              }}
                              placeholder="Valor de cada parcela"
                            />
                            <p className="text-xs text-muted-foreground">
                              Total: R${" "}
                              {(
                                (parseFloat(formData.installment_amount) || 0) *
                                formData.total_installments
                              ).toLocaleString("pt-BR", {
                                minimumFractionDigits: 2,
                              })}
                            </p>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="first_due_date">
                              Primeira Parcela
                            </Label>
                            <Input
                              id="first_due_date"
                              type="date"
                              value={formData.first_due_date}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  first_due_date: e.target.value,
                                })
                              }
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="notes">Observações</Label>
                    <Textarea
                      id="notes"
                      value={formData.notes}
                      onChange={(e) =>
                        setFormData({ ...formData, notes: e.target.value })
                      }
                      placeholder="Informações adicionais..."
                      rows={3}
                    />
                  </div>

                  {/* Seção de Grupos e Divisão */}
                  {formData.transaction_type === "expense" && (
                    <SoftFeatureGuard feature="expense_groups" user={user}>
                      <div className="space-y-4 p-4 border rounded-lg bg-muted/20">
                        <div className="space-y-4">
                          <div className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              id="is_shared"
                              checked={
                                formData.is_shared ||
                                (!!formData.group_id &&
                                  formData.group_id !== "none")
                              }
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  is_shared: e.target.checked,
                                  splits: e.target.checked
                                    ? formData.splits
                                    : [],
                                  group_id: e.target.checked
                                    ? formData.group_id
                                    : "",
                                })
                              }
                            />
                            <Label htmlFor="is_shared" className="font-medium">
                              Dividir esta despesa
                            </Label>
                          </div>

                          {(formData.is_shared ||
                            (formData.group_id &&
                              formData.group_id !== "none")) && (
                            <div className="space-y-4">
                              {/* Seleção entre Grupo ou Conexões */}
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label>Dividir com Grupo</Label>
                                  <Select
                                    value={formData.group_id}
                                    onValueChange={(value: string) =>
                                      setFormData({
                                        ...formData,
                                        group_id: value === "none" ? "" : value,
                                        splits:
                                          value !== "none" && value
                                            ? []
                                            : formData.splits, // Limpar splits se selecionar grupo
                                      })
                                    }
                                  >
                                    <SelectTrigger>
                                      <SelectValue placeholder="Selecione um grupo" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none">
                                        Nenhum grupo
                                      </SelectItem>
                                      {expenseGroups.map((group) => (
                                        <SelectItem
                                          key={group.id}
                                          value={group.id}
                                        >
                                          <div className="flex items-center gap-2">
                                            <Users className="h-4 w-4" />
                                            {group.name}
                                            <span className="text-xs text-muted-foreground">
                                              ({group.members?.length || 0}{" "}
                                              membros)
                                            </span>
                                          </div>
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>

                                {formData.group_id &&
                                  formData.group_id !== "none" && (
                                    <div className="space-y-2">
                                      <Label>Tipo de Divisão do Grupo</Label>
                                      <div className="text-sm text-muted-foreground">
                                        {(() => {
                                          const group = expenseGroups.find(
                                            (g) => g.id === formData.group_id
                                          );
                                          switch (group?.default_split_type) {
                                            case "equal":
                                              return "⚖️ Divisão igual entre membros";
                                            case "percentage":
                                              return "📊 Por percentual fixo";
                                            case "proportional":
                                              return "💰 Proporcional à renda";
                                            case "custom":
                                              return "🎯 Personalizada por despesa";
                                            default:
                                              return "Configuração do grupo";
                                          }
                                        })()}
                                      </div>
                                    </div>
                                  )}
                              </div>
                            </div>
                          )}
                        </div>

                        {formData.is_shared && (
                          <div className="space-y-3">
                            <Label>
                              Divisão com conexões ({totalSplitPercentage}%
                              usado)
                            </Label>

                            {formData.splits.map((split) => {
                              const connection = connections.find(
                                (c) => c.id === split.participant_id
                              );
                              return (
                                <div
                                  key={split.participant_id}
                                  className="flex items-center gap-3 p-3 border rounded"
                                >
                                  <Avatar className="h-8 w-8">
                                    <AvatarImage src={connection?.avatar_url} />
                                    <AvatarFallback>
                                      {connection?.full_name?.charAt(0)}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="flex-1">
                                    {connection?.full_name}
                                  </span>
                                  <Input
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={split.percentage}
                                    onChange={(e) =>
                                      updateSplitPercentage(
                                        split.participant_id,
                                        Number(e.target.value)
                                      )
                                    }
                                    className="w-20"
                                  />
                                  <span>%</span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      removeSplit(split.participant_id)
                                    }
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              );
                            })}

                            {totalSplitPercentage < 100 && (
                              <Select onValueChange={addSplit}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Adicionar pessoa" />
                                </SelectTrigger>
                                <SelectContent>
                                  {connections
                                    .filter(
                                      (c) =>
                                        !formData.splits.find(
                                          (s) => s.participant_id === c.id
                                        )
                                    )
                                    .map((connection) => (
                                      <SelectItem
                                        key={connection.id}
                                        value={connection.id}
                                      >
                                        <div className="flex items-center gap-2">
                                          <Avatar className="h-6 w-6">
                                            <AvatarImage
                                              src={connection.avatar_url}
                                            />
                                            <AvatarFallback>
                                              {connection.full_name?.charAt(0)}
                                            </AvatarFallback>
                                          </Avatar>
                                          {connection.full_name}
                                        </div>
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            )}

                            {totalSplitPercentage !== 100 && (
                              <p className="text-sm text-orange-600">
                                Restam {100 - totalSplitPercentage}% para
                                distribuir
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </SoftFeatureGuard>
                  )}

                  <div className="flex gap-2">
                    <Button type="submit">
                      {editingTransaction ? "Atualizar" : "Salvar"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={cancelForm}
                    >
                      Cancelar
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Transactions List */}
          <Card>
            <CardHeader>
              <CardTitle>Transações Recentes</CardTitle>
              <CardDescription>
                Últimas movimentações financeiras
              </CardDescription>
            </CardHeader>
            <CardContent>
              {transactions.length > 0 ? (
                <div className="space-y-3">
                  {transactions.map((transaction) => (
                    <div
                      key={transaction.id}
                      className={`flex items-center justify-between p-3 border rounded-lg transition-colors ${
                        editingTransaction?.id === transaction.id
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center text-white"
                          style={{
                            backgroundColor: transaction.category?.color_hex,
                          }}
                        >
                          <Receipt className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-medium">
                            {transaction.description}
                          </p>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>{transaction.category?.name}</span>
                            <span>•</span>
                            <span>
                              {new Date(
                                transaction.transaction_date
                              ).toLocaleDateString("pt-BR")}
                            </span>
                            {transaction.is_shared && (
                              <>
                                <span>•</span>
                                <Badge
                                  variant="outline"
                                  className="flex items-center gap-1"
                                >
                                  <Share2 className="h-3 w-3" />
                                  Compartilhado
                                </Badge>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p
                            className={`font-semibold ${
                              transaction.amount >= 0
                                ? "text-green-600"
                                : "text-red-600"
                            }`}
                          >
                            {formatCurrency(Math.abs(transaction.amount))}
                          </p>
                          {transaction.expense_splits &&
                            transaction.expense_splits.length > 0 && (
                              <p className="text-xs text-muted-foreground">
                                {transaction.expense_splits.length} pessoa(s)
                              </p>
                            )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => startEdit(transaction)}
                            className="h-8 w-8 p-0"
                            title="Editar transação"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteTransaction(transaction.id)}
                            className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                            title="Excluir transação"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Receipt className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">
                    Nenhuma transação ainda
                  </h3>
                  <p className="text-muted-foreground">
                    Comece adicionando suas receitas e despesas
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="limits" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Usage Limits Card */}
            <div className="lg:col-span-2">
              <UsageLimitsCard user={user} />
            </div>

            {/* Quick Stats */}
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Uso Atual</CardTitle>
                  <CardDescription>
                    Resumo do seu uso em tempo real
                  </CardDescription>
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
                <Card className="border-yellow-200 bg-yellow-50">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Crown className="h-5 w-5 text-yellow-600" />
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
