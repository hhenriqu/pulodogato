"use client";

import Link from "next/link";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { User } from "@supabase/supabase-js";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { opcoesDeMoeda } from "@/lib/moeda";
import { MOEDA_PADRAO, moedaPorCodigo } from "@/lib/dinheiro";
import { moedaDaViagem } from "@/lib/moeda-do-grupo";
import {
  Archive,
  Users,
  Plus,
  Share2,
  Crown,
  UserPlus,
  Copy,
  Mail,
  Phone,
  DollarSign,
  Calendar,
  MoreVertical,
  LogIn,
  Calculator,
  TrendingUp,
  Eye,
  Check,
  X,
  Clock,
  AlertCircle,
  Edit,
  Trash2,
  UserMinus,
} from "lucide-react";
import { useGroupInvitations } from "@/lib/hooks/useGroupInvitations";

interface ExpenseGroup {
  id: string;
  name: string;
  description: string;
  group_code: string;
  group_type: "public" | "private";
  default_split_type: "equal" | "percentage" | "custom" | "proportional";
  /**
   * A moeda da viagem (`expense_groups.currency`, migration 026). Opcional no
   * tipo porque uma resposta de API mais antiga que esta tela nao a traz, e
   * `moedaDaViagem` resolve a ausencia em BRL -- que e o DEFAULT da coluna.
   */
  currency?: string | null;
  photo_url?: string;
  created_at: string;
  creator?: {
    full_name: string;
    avatar_url?: string;
  };
  members?: GroupMember[];
  _count?: { count: number };
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

/**
 * Um pedido de entrada por código que ainda espera um administrador (migration
 * 029, via `my_pending_group_requests`).
 *
 * Só tem nome e data de propósito: quem está pendente não é membro, e a RLS
 * não deixa ler nada além disso do grupo. É o bastante para a tela dizer que o
 * pedido existe -- que era exatamente o que faltava na HMO-190, onde digitar o
 * código certo não deixava vestígio nenhum no app.
 */
interface PendingGroupRequest {
  group_id: string;
  group_name: string;
  requested_at: string;
}

// O que `/api/expense-groups/proportions` devolve por membro. Os tres valores
// numericos passam por `Number()` na tela, entao chegam como string: a rota le
// colunas `numeric`, e o JSON do PostgREST entrega `numeric` como texto.
interface ProporcaoDeMembro {
  member_id: string;
  proportion_percentage: number | string;
  total_income: number | string | null;
  calculated_at: string;
}

export default function ExpenseGroupsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [groups, setGroups] = useState<ExpenseGroup[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingGroupRequest[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("my-groups");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [showProportions, setShowProportions] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<ExpenseGroup | null>(null);
  const [proportions, setProportions] = useState<ProporcaoDeMembro[]>([]);
  const [loadingProportions, setLoadingProportions] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    description: "",
    group_type: "private" as "public" | "private",
    default_split_type: "equal" as
      | "equal"
      | "percentage"
      | "custom"
      | "proportional",
    currency: MOEDA_PADRAO,
  });

  // Hook para gerenciar convites.
  //
  // `orphanedCount` e `cleanOrphanedInvitations` sairam na HMO-196: nao existia
  // convite orfao nenhum. Era a RLS escondendo o grupo de quem ainda nao e
  // membro, lida como "o grupo foi deletado" -- e o hook marcava os convites
  // legitimos como expirados por causa disso.
  const {
    invitations,
    loading: invitationsLoading,
    acceptLoading,
    rejectLoading,
    refetch: refetchInvitations,
    acceptInvitation,
    rejectInvitation,
    getTimeRemaining,
  } = useGroupInvitations(user);

  // Form states
  const [createForm, setCreateForm] = useState({
    name: "",
    description: "",
    group_type: "private" as "public" | "private",
    default_split_type: "equal" as
      | "equal"
      | "percentage"
      | "custom"
      | "proportional",
    // A moeda da viagem (026). Nasce em real: e o que 100% dos grupos que ja
    // existem sao, e o que a maioria dos novos sera.
    currency: MOEDA_PADRAO,
  });

  const [joinForm, setJoinForm] = useState({
    group_code: "",
  });

  const [inviteForm, setInviteForm] = useState({
    email_or_phone: "",
    method: "email" as "email" | "phone",
    message: "",
  });

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

      console.log("👤 USUÁRIO ATUAL:", {
        id: user.id,
        email: user.email,
        user_metadata: user.user_metadata,
      });

      // Carregar grupos do usuário
      const response = await fetch("/api/expense-groups");
      const data = await response.json();

      console.log("📋 GRUPOS CARREGADOS:", {
        status: response.status,
        grupos: data.groups,
        quantidade: data.groups?.length || 0,
      });

      // Debug adicional para verificar membros
      if (data.groups && data.groups.length > 0) {
        data.groups.forEach((group: ExpenseGroup) => {
          console.log(`🔍 GRUPO "${group.name}":`, {
            id: group.id,
            creator: group.creator,
            members: group.members,
            membersCount: group.members?.length || 0,
          });
        });
      }

      if (response.ok) {
        setGroups(data.groups || []);
        setPendingRequests(data.pendingRequests || []);
      } else {
        toast.error(data.error || "Erro ao carregar grupos");
      }
    } catch (error) {
      console.error("Error loading groups:", error);
      toast.error("Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!createForm.name.trim()) {
      toast.error("Nome do grupo é obrigatório");
      return;
    }

    try {
      const response = await fetch("/api/expense-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });

      const data = await response.json();

      if (response.ok) {
        toast.success("Grupo criado com sucesso!");
        setShowCreateForm(false);
        setCreateForm({
          name: "",
          description: "",
          group_type: "private",
          default_split_type: "equal",
          currency: MOEDA_PADRAO,
        });
        loadData();
      } else {
        toast.error(data.error || "Erro ao criar grupo");
      }
    } catch (error) {
      console.error("Create group error:", error);
      toast.error("Erro ao criar grupo");
    }
  };

  const handleJoinGroup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!joinForm.group_code.trim() || joinForm.group_code.length !== 6) {
      toast.error("Código do grupo deve ter 6 caracteres");
      return;
    }

    try {
      const response = await fetch("/api/expense-groups/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_code: joinForm.group_code.toUpperCase() }),
      });

      const data = await response.json();

      if (response.ok) {
        toast.success(data.message);
        setShowJoinForm(false);
        setJoinForm({ group_code: "" });
        loadData();
      } else {
        toast.error(data.error || "Erro ao entrar no grupo");
      }
    } catch (error) {
      console.error("Join group error:", error);
      toast.error("Erro ao entrar no grupo");
    }
  };

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedGroup || !inviteForm.email_or_phone.trim()) {
      toast.error("Preencha o email ou telefone");
      return;
    }

    try {
      const response = await fetch("/api/expense-groups/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group_id: selectedGroup.id,
          ...inviteForm,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        toast.success(data.message);
        setShowInviteForm(false);
        setInviteForm({ email_or_phone: "", method: "email", message: "" });
      } else {
        toast.error(data.error || "Erro ao enviar convite");
      }
    } catch (error) {
      console.error("Send invite error:", error);
      toast.error("Erro ao enviar convite");
    }
  };

  const copyGroupCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success("Código copiado para a área de transferência");
  };

  const getSplitTypeLabel = (type: string) => {
    switch (type) {
      case "equal":
        return "Divisão Igual";
      case "percentage":
        return "Por Percentual";
      case "custom":
        return "Por Despesa";
      case "proportional":
        return "Proporcional à Renda";
      default:
        return type;
    }
  };

  const getGroupTypeLabel = (type: string) => {
    return type === "public" ? "Público" : "Privado";
  };

  const getUserRole = (group: ExpenseGroup) => {
    if (!user) return null;
    const member = group.members?.find((m) => m.user.id === user.id);
    return member?.role || null;
  };

  const handleCalculateProportions = async (group: ExpenseGroup) => {
    setLoadingProportions(true);
    try {
      const response = await fetch("/api/expense-groups/proportions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: group.id }),
      });

      const data = await response.json();

      if (response.ok) {
        toast.success("Proporções calculadas com sucesso!");
        setProportions(data.proportions || []);
        setSelectedGroup(group);
        setShowProportions(true);
      } else {
        toast.error(data.error || "Erro ao calcular proporções");
      }
    } catch (error) {
      console.error("Calculate proportions error:", error);
      toast.error("Erro ao calcular proporções");
    } finally {
      setLoadingProportions(false);
    }
  };

  const handleViewProportions = async (group: ExpenseGroup) => {
    setLoadingProportions(true);
    try {
      const response = await fetch(
        `/api/expense-groups/proportions?group_id=${group.id}`
      );
      const data = await response.json();

      if (response.ok) {
        setProportions(data.proportions || []);
        setSelectedGroup(group);
        setShowProportions(true);

        if (data.needs_recalculation) {
          toast.info("Proporções desatualizadas. Recomendamos recalcular.");
        }
      } else {
        toast.error(data.error || "Erro ao buscar proporções");
      }
    } catch (error) {
      console.error("View proportions error:", error);
      toast.error("Erro ao buscar proporções");
    } finally {
      setLoadingProportions(false);
    }
  };

  const handleAcceptInvitation = async (
    invitationId: string,
    groupName: string
  ) => {
    const result = await acceptInvitation(invitationId);
    if (result.success) {
      toast.success(result.message || `Você entrou no grupo "${groupName}"!`);
      loadData(); // Recarregar lista de grupos
    } else {
      toast.error(result.error || "Erro ao aceitar convite");
    }
  };

  const handleRejectInvitation = async (invitationId: string) => {
    const result = await rejectInvitation(invitationId);
    if (result.success) {
      toast.success("Convite rejeitado");
    } else {
      toast.error(result.error || "Erro ao rejeitar convite");
    }
  };

  const handleEditGroup = (group: ExpenseGroup) => {
    setEditForm({
      name: group.name,
      description: group.description || "",
      group_type: group.group_type,
      default_split_type: group.default_split_type,
      // `moedaDaViagem` e nao `group.currency` direto: grupo criado antes da 026
      // (ou trazido por uma resposta de API sem a coluna) chega `undefined`, e um
      // Select com `value={undefined}` fica DESCONTROLADO -- ele passa a
      // ignorar o estado, e a edicao seguinte enviaria a moeda errada.
      currency: moedaDaViagem(group.currency),
    });
    setSelectedGroup(group);
    setShowEditForm(true);
  };

  const handleUpdateGroup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedGroup) return;

    try {
      const response = await fetch(`/api/expense-groups/${selectedGroup.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });

      const data = await response.json();

      if (response.ok) {
        toast.success("Grupo atualizado com sucesso!");
        setShowEditForm(false);
        setSelectedGroup(null);
        loadData();
      } else {
        toast.error(data.error || "Erro ao atualizar grupo");
      }
    } catch (error) {
      console.error("Update group error:", error);
      toast.error("Erro ao atualizar grupo");
    }
  };

  const handleDeleteGroup = async (group: ExpenseGroup) => {
    if (!confirm(`Tem certeza que deseja excluir o grupo "${group.name}"?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/expense-groups/${group.id}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (response.ok) {
        toast.success("Grupo excluído com sucesso!");
        loadData();
      } else {
        toast.error(data.error || "Erro ao excluir grupo");
      }
    } catch (error) {
      console.error("Delete group error:", error);
      toast.error("Erro ao excluir grupo");
    }
  };

  const handleLeaveGroup = async (group: ExpenseGroup) => {
    // Determinar o papel do usuário no grupo
    const userMember = group.members?.find((m) => m.user?.id === user?.id);
    const isAdmin = userMember?.role === "admin";
    const totalMembers = group.members?.length || 0;
    const adminCount =
      group.members?.filter((m) => m.role === "admin").length || 0;

    let confirmMessage = `Tem certeza que deseja sair do grupo "${group.name}"?`;

    if (totalMembers === 1) {
      confirmMessage = `Você é o único membro do grupo "${group.name}". Ao sair, o grupo será ARQUIVADO (não excluído). Confirma?`;
    } else if (isAdmin && adminCount === 1) {
      confirmMessage = `Você é o único administrador do grupo "${group.name}". Para sair, primeiro promova outro membro a administrador ou arquive o grupo. Esta ação não será permitida.`;
      alert(confirmMessage);
      return;
    }

    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      const response = await fetch(`/api/expense-groups/${group.id}/leave`, {
        method: "POST",
      });

      const data = await response.json();

      if (response.ok) {
        // Mostrar mensagem específica baseada na ação realizada
        if (data.action === "group_archived") {
          toast.success(
            data.message || "Grupo arquivado pois você era o último membro"
          );
        } else if (data.action === "user_left") {
          toast.success(data.message || "Você saiu do grupo com sucesso!");
        } else {
          toast.success(data.message || "Operação realizada com sucesso!");
        }
        loadData();
      } else {
        // Tratar erro específico de admin único
        if (data.action_required === "promote_admin_or_archive") {
          toast.error(data.error, {
            duration: 8000, // Mostrar por mais tempo para dar tempo de ler
          });
        } else {
          toast.error(data.error || "Erro ao sair do grupo");
        }
      }
    } catch (error) {
      console.error("Leave group error:", error);
      toast.error("Erro ao sair do grupo");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header -- empilha no celular (HMO-168): "Entrar no Grupo" + "Criar
          Grupo" somam 312px, quase a largura inteira de um aparelho de 320px,
          e ao lado do titulo davam 193px de scroll horizontal na pagina. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Users className="h-8 w-8" />
            Grupos de Despesas
          </h1>
          <p className="text-muted-foreground">
            Organize gastos compartilhados com amigos, família ou colegas
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => setShowJoinForm(true)}
            variant="outline"
            className="flex items-center gap-2"
          >
            <LogIn className="h-4 w-4" />
            Entrar no Grupo
          </Button>
          {/* O caminho de clique para os grupos arquivados. Sem este botao a
              tela existe e ninguem chega nela -- foi o que aconteceu com a
              tela de assinaturas, que ficou um dia no ar sem entrada no menu. */}
          <Button variant="outline" className="flex items-center gap-2" asChild>
            <Link href="/dashboard/expense-groups/archived">
              <Archive className="h-4 w-4" />
              Arquivados
            </Link>
          </Button>
          <Button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Criar Grupo
          </Button>
        </div>
      </div>

      {/* Create Group Form */}
      {showCreateForm && (
        <Card>
          <CardHeader>
            <CardTitle>Criar Novo Grupo</CardTitle>
            <CardDescription>
              Crie um grupo para organizar despesas compartilhadas
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateGroup} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome do Grupo *</Label>
                  <Input
                    id="name"
                    value={createForm.name}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, name: e.target.value })
                    }
                    placeholder="Ex: Casa Compartilhada"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="group_type">Tipo de Grupo</Label>
                  <Select
                    value={createForm.group_type}
                    onValueChange={(value: "public" | "private") =>
                      setCreateForm({ ...createForm, group_type: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="private">
                        Privado (apenas convite)
                      </SelectItem>
                      <SelectItem value="public">
                        Público (entrada livre)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Descrição</Label>
                <Textarea
                  id="description"
                  value={createForm.description}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      description: e.target.value,
                    })
                  }
                  placeholder="Descreva o propósito do grupo..."
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="split_type">Forma de Divisão Padrão</Label>
                <Select
                  value={createForm.default_split_type}
                  onValueChange={(
                    value: "equal" | "percentage" | "custom" | "proportional"
                  ) =>
                    setCreateForm({ ...createForm, default_split_type: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="equal">
                      <div>
                        <div className="font-medium">Divisão Igual</div>
                        <div className="text-sm text-muted-foreground">
                          Total ÷ número de membros
                        </div>
                      </div>
                    </SelectItem>
                    <SelectItem value="percentage">
                      <div>
                        <div className="font-medium">Por Percentual</div>
                        <div className="text-sm text-muted-foreground">
                          Cada membro tem % fixo
                        </div>
                      </div>
                    </SelectItem>
                    <SelectItem value="custom">
                      <div>
                        <div className="font-medium">Por Despesa</div>
                        <div className="text-sm text-muted-foreground">
                          Definir para cada gasto
                        </div>
                      </div>
                    </SelectItem>
                    <SelectItem value="proportional">
                      <div>
                        <div className="font-medium">Proporcional à Renda</div>
                        <div className="text-sm text-muted-foreground">
                          Automático baseado nas receitas
                        </div>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* A MOEDA DA VIAGEM (HMO-182, item 3)
                  Ela e a moeda SUGERIDA a cada despesa do grupo -- a palavra e do
                  COMMENT da coluna na 026 -- e a moeda em que a tela apresenta o
                  saldo. Nao e o denominador do saldo: a view devolve BRL, com
                  cada despesa convertida pela cotacao congelada do dia dela. */}
              <div className="space-y-2">
                <Label htmlFor="group_currency">Moeda do grupo</Label>
                <Select
                  value={createForm.currency}
                  onValueChange={(value) =>
                    setCreateForm({ ...createForm, currency: value })
                  }
                >
                  <SelectTrigger id="group_currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {opcoesDeMoeda().map((o) => (
                      <SelectItem key={o.codigo} value={o.codigo}>
                        {o.rotulo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Sugerida em cada despesa desta viagem e usada para apresentar o
                  saldo. Cada despesa guarda a cotação do dia em que foi feita, e
                  esse valor não muda depois.
                </p>
              </div>

              <div className="flex gap-2">
                <Button type="submit">Criar Grupo</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCreateForm(false)}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Join Group Form */}
      {showJoinForm && (
        <Card>
          <CardHeader>
            <CardTitle>Entrar em Grupo</CardTitle>
            <CardDescription>
              Digite o código de 6 dígitos do grupo
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleJoinGroup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="group_code">Código do Grupo</Label>
                <Input
                  id="group_code"
                  value={joinForm.group_code}
                  onChange={(e) =>
                    setJoinForm({
                      ...joinForm,
                      group_code: e.target.value.toUpperCase(),
                    })
                  }
                  placeholder="ABC123"
                  maxLength={6}
                  className="font-mono text-center text-lg"
                  required
                />
              </div>

              <div className="flex gap-2">
                <Button type="submit">Entrar</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowJoinForm(false)}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="my-groups">Meus Grupos</TabsTrigger>
          <TabsTrigger value="invitations">Convites</TabsTrigger>
        </TabsList>

        <TabsContent value="my-groups" className="space-y-4">
          {/*
            Pedidos de entrada esperando aprovação.
            Fica ACIMA da grade e fora do `groups.length > 0`, porque o caso que
            abriu a HMO-190 é justamente o de quem não tem grupo nenhum: ela
            digitou o código certo, virou `pending`, e a tela respondia
            "Nenhum grupo ainda" -- sem vestígio do pedido, sem dizer que
            alguém precisa aprovar, sem nada em que clicar. Não há link para o
            grupo de propósito: enquanto o pedido não for aprovado a RLS não
            deixa ler nada lá dentro, e um card clicável levaria a um erro.
          */}
          {pendingRequests.length > 0 && (
            <div className="space-y-3">
              {pendingRequests.map((request) => (
                <Card key={request.group_id} className="border-warning">
                  <CardContent className="flex items-start gap-3 py-4">
                    <Clock className="h-5 w-5 text-warning mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {request.group_name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Aguardando aprovação de um administrador do grupo. Você
                        vai ver as despesas assim que alguém aprovar seu pedido.
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Pedido enviado em{" "}
                        {new Date(request.requested_at).toLocaleDateString(
                          "pt-BR"
                        )}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Groups Grid */}
          {groups.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {groups.map((group) => {
                const userRole = getUserRole(group);
                const isAdmin = userRole === "admin";

                return (
                  <Card
                    key={group.id}
                    className="hover:shadow-md transition-shadow"
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-lg flex items-center gap-2">
                            {group.name}
                            {isAdmin && (
                              <Crown className="h-4 w-4 text-warning" />
                            )}
                          </CardTitle>
                          <CardDescription className="mt-1">
                            {group.description || "Sem descrição"}
                          </CardDescription>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {isAdmin ? (
                              <>
                                <DropdownMenuItem
                                  onClick={() => handleEditGroup(group)}
                                >
                                  <Edit className="h-4 w-4 mr-2" />
                                  Editar Grupo
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedGroup(group);
                                    setShowInviteForm(true);
                                  }}
                                >
                                  <UserPlus className="h-4 w-4 mr-2" />
                                  Convidar Membros
                                </DropdownMenuItem>
                                {group.default_split_type ===
                                  "proportional" && (
                                  <DropdownMenuItem
                                    onClick={() => handleViewProportions(group)}
                                  >
                                    <TrendingUp className="h-4 w-4 mr-2" />
                                    Ver Proporções
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => handleDeleteGroup(group)}
                                  className="text-destructive"
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Excluir Grupo
                                </DropdownMenuItem>
                              </>
                            ) : (
                              <>
                                {group.default_split_type ===
                                  "proportional" && (
                                  <DropdownMenuItem
                                    onClick={() => handleViewProportions(group)}
                                  >
                                    <TrendingUp className="h-4 w-4 mr-2" />
                                    Ver Proporções
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  onClick={() => handleLeaveGroup(group)}
                                  className="text-destructive"
                                >
                                  <UserMinus className="h-4 w-4 mr-2" />
                                  Sair do Grupo
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-4">
                      {/* Group Info */}
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="flex items-center gap-2">
                          <Share2 className="h-4 w-4 text-muted-foreground" />
                          <span>{getGroupTypeLabel(group.group_type)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <DollarSign className="h-4 w-4 text-muted-foreground" />
                          <span>
                            {getSplitTypeLabel(group.default_split_type)}
                          </span>
                        </div>
                        {/* So aparece quando a viagem NAO e em real. Um selo
                            "BRL" em todos os grupos seria ruido em 100% deles:
                            o que precisa chamar atencao e a excecao. */}
                        {moedaDaViagem(group.currency) !== MOEDA_PADRAO && (
                          <div className="col-span-2">
                            <Badge variant="outline">
                              Viagem em{" "}
                              {moedaPorCodigo(moedaDaViagem(group.currency)).nome}
                            </Badge>
                          </div>
                        )}
                      </div>

                      {/* Members */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            Membros ({group.members?.length || 0})
                          </span>
                          <div className="flex gap-1">
                            {group.default_split_type === "proportional" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleViewProportions(group)}
                                disabled={loadingProportions}
                                className="flex items-center gap-1"
                              >
                                <TrendingUp className="h-3 w-3" />
                                {loadingProportions ? "..." : "%"}
                              </Button>
                            )}
                            {isAdmin && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedGroup(group);
                                  setShowInviteForm(true);
                                }}
                              >
                                <UserPlus className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </div>

                        <div className="flex -space-x-2">
                          {group.members?.slice(0, 4).map((member) => (
                            <Avatar
                              key={member.id}
                              className="h-8 w-8 border-2 border-background"
                            >
                              <AvatarImage src={member.user.avatar_url} />
                              <AvatarFallback className="text-xs">
                                {member.user.full_name?.charAt(0)}
                              </AvatarFallback>
                            </Avatar>
                          ))}
                          {(group.members?.length || 0) > 4 && (
                            <div className="h-8 w-8 rounded-full bg-muted border-2 border-background flex items-center justify-center text-xs">
                              +{(group.members?.length || 0) - 4}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Group Code */}
                      <div className="flex items-center justify-between p-2 bg-muted rounded">
                        <span className="font-mono text-sm">
                          {group.group_code}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => copyGroupCode(group.group_code)}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>

                      {/* Created Date */}
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        <span>
                          Criado em{" "}
                          {new Date(group.created_at).toLocaleDateString(
                            "pt-BR"
                          )}
                        </span>
                      </div>

                      {/* Action Button */}
                      <div className="pt-3 border-t">
                        <Button
                          className="w-full"
                          onClick={() =>
                            (window.location.href = `/dashboard/expense-groups/${group.id}`)
                          }
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          Ver Gastos do Grupo
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card>
              <CardContent className="text-center py-12">
                <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">
                  {pendingRequests.length > 0
                    ? "Nenhum grupo liberado ainda"
                    : "Nenhum grupo ainda"}
                </h3>
                {/*
                  Com um pedido na fila, "Nenhum grupo ainda" seria uma segunda
                  meia-verdade logo abaixo do card que acabou de dizer que ela
                  pediu para entrar em um. O convite aqui também muda: mandá-la
                  "entrar em um existente" é o conselho que ela já seguiu.
                */}
                <p className="text-muted-foreground mb-6">
                  {pendingRequests.length > 0
                    ? "Seu pedido acima ainda precisa ser aprovado. Enquanto isso, você pode criar um grupo seu."
                    : "Crie seu primeiro grupo ou entre em um existente"}
                </p>
                <div className="flex gap-2 justify-center">
                  <Button onClick={() => setShowCreateForm(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Criar Grupo
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowJoinForm(true)}
                  >
                    <LogIn className="h-4 w-4 mr-2" />
                    Entrar no Grupo
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="invitations">
          {invitationsLoading ? (
            <div className="flex items-center justify-center min-h-[400px]">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : invitations.length > 0 ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">
                  Convites Pendentes ({invitations.length})
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={refetchInvitations}
                  disabled={invitationsLoading}
                >
                  Atualizar
                </Button>
              </div>

              <div className="grid gap-4">
                {invitations.map((invitation) => (
                  <Card
                    key={invitation.invitation_id}
                    className="hover:shadow-md transition-shadow"
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-10 w-10">
                            <AvatarImage
                              src={invitation.inviter_avatar_url ?? undefined}
                            />
                            {/* `inviter_name` e anulavel: perfil sem nome
                                preenchido e o estado real da conta do relato da
                                HMO-196. Antes isto era
                                `inviter.full_name.charAt(0)` -- um TypeError que
                                derrubaria a aba inteira. */}
                            <AvatarFallback>
                              {invitation.inviter_name?.charAt(0) ?? "?"}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <CardTitle className="text-lg">
                              {invitation.group_name}
                            </CardTitle>
                            <CardDescription>
                              Convite de {invitation.inviter_name ?? "alguém"}
                            </CardDescription>
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className="flex items-center gap-1"
                        >
                          <Clock className="h-3 w-3" />
                          {getTimeRemaining(invitation.expires_at)}
                        </Badge>
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-4">
                      {/* Quando o convite foi feito. O tipo do grupo, a regra de
                          divisao e o CODIGO do grupo sairam daqui na HMO-196:
                          `list_my_group_invitations()` nao devolve nada disso de
                          proposito. Quem ainda nao aceitou nao le o interior do
                          grupo, e quem RECUSA nao precisa sair com a chave de
                          entrada na mao -- os dois botoes abaixo nunca
                          dependeram do codigo. O selo "Convite via Email/
                          Telefone/Código" tambem saiu: agora existe um canal so,
                          o proprio app, e o selo so podia dizer Email. */}
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span>
                          Convite feito em{" "}
                          {new Date(invitation.created_at).toLocaleDateString(
                            "pt-BR"
                          )}
                        </span>
                      </div>

                      {/* Description */}
                      {invitation.group_description && (
                        <div className="p-3 bg-muted rounded-md">
                          <p className="text-sm">
                            {invitation.group_description}
                          </p>
                        </div>
                      )}

                      {/* Personal Message */}
                      {invitation.invite_message && (
                        <div className="p-3 bg-info/10 rounded-md border-l-4 border-info">
                          <p className="text-sm">
                            <strong>Mensagem:</strong>{" "}
                            {invitation.invite_message}
                          </p>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-2 pt-2">
                        <Button
                          onClick={() =>
                            handleAcceptInvitation(
                              invitation.invitation_id,
                              invitation.group_name
                            )
                          }
                          disabled={acceptLoading === invitation.invitation_id}
                          className="flex-1"
                        >
                          {acceptLoading === invitation.invitation_id ? (
                            <div className="flex items-center gap-2">
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                              Entrando...
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Check className="h-4 w-4" />
                              Aceitar Convite
                            </div>
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() =>
                            handleRejectInvitation(invitation.invitation_id)
                          }
                          disabled={rejectLoading === invitation.invitation_id}
                          className="flex-1"
                        >
                          {rejectLoading === invitation.invitation_id ? (
                            <div className="flex items-center gap-2">
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-border"></div>
                              Rejeitando...
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <X className="h-4 w-4" />
                              Recusar
                            </div>
                          )}
                        </Button>
                      </div>

                      {/* Warning about expiration */}
                      {(() => {
                        const timeLeft =
                          new Date(invitation.expires_at).getTime() -
                          new Date().getTime();
                        const hoursLeft = Math.floor(
                          timeLeft / (1000 * 60 * 60)
                        );
                        if (hoursLeft < 24) {
                          return (
                            <div className="flex items-center gap-2 p-3 bg-warning/10 rounded-md border-l-4 border-warning">
                              <AlertCircle className="h-4 w-4 text-warning" />
                              <p className="text-sm text-warning">
                                <strong>Atenção:</strong> Este convite expira em
                                menos de 24 horas!
                              </p>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ) : (
            <Card>
              <CardContent className="text-center py-12">
                <Mail className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">
                  Nenhum convite pendente
                </h3>
                <p className="text-muted-foreground mb-6">
                  Você não possui convites de grupos pendentes no momento
                </p>
                <Button
                  variant="outline"
                  onClick={refetchInvitations}
                  disabled={invitationsLoading}
                >
                  Verificar novamente
                </Button>
              </CardContent>
            </Card>
          )}

          {/*
            O aviso "Convites Órfãos Detectados" ficava aqui, e saiu na HMO-196.
            Ele anunciava "convites para grupos que não existem mais" com um
            botão "Limpar Convites Órfãos", e nenhum daqueles grupos havia sido
            apagado: o grupo era invisível porque a RLS o esconde de quem ainda
            não é membro. O aviso era a conclusão errada exibida com confiança,
            e o botão terminava o serviço marcando como expirados os convites
            legítimos da pessoa. A leitura agora passa por
            list_my_group_invitations(), que enxerga o grupo -- então não há
            órfão a detectar nem nada a limpar.
          */}
        </TabsContent>
      </Tabs>

      {/* Edit Group Form Modal */}
      {showEditForm && selectedGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Editar Grupo</CardTitle>
              <CardDescription>
                Altere as informações do grupo &quot;{selectedGroup.name}&quot;
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpdateGroup} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="edit_name">Nome do Grupo *</Label>
                  <Input
                    id="edit_name"
                    value={editForm.name}
                    onChange={(e) =>
                      setEditForm({ ...editForm, name: e.target.value })
                    }
                    placeholder="Ex: Casa Compartilhada"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit_description">Descrição</Label>
                  <Textarea
                    id="edit_description"
                    value={editForm.description}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        description: e.target.value,
                      })
                    }
                    placeholder="Descreva o propósito do grupo..."
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit_group_type">Tipo de Grupo</Label>
                  <Select
                    value={editForm.group_type}
                    onValueChange={(value: "public" | "private") =>
                      setEditForm({ ...editForm, group_type: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="private">
                        Privado (apenas convite)
                      </SelectItem>
                      <SelectItem value="public">
                        Público (entrada livre)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit_split_type">
                    Forma de Divisão Padrão
                  </Label>
                  <Select
                    value={editForm.default_split_type}
                    onValueChange={(
                      value: "equal" | "percentage" | "custom" | "proportional"
                    ) =>
                      setEditForm({ ...editForm, default_split_type: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="equal">
                        <div>
                          <div className="font-medium">Divisão Igual</div>
                          <div className="text-sm text-muted-foreground">
                            Total ÷ número de membros
                          </div>
                        </div>
                      </SelectItem>
                      <SelectItem value="percentage">
                        <div>
                          <div className="font-medium">Por Percentual</div>
                          <div className="text-sm text-muted-foreground">
                            Cada membro tem % fixo
                          </div>
                        </div>
                      </SelectItem>
                      <SelectItem value="custom">
                        <div>
                          <div className="font-medium">Por Despesa</div>
                          <div className="text-sm text-muted-foreground">
                            Definir para cada gasto
                          </div>
                        </div>
                      </SelectItem>
                      <SelectItem value="proportional">
                        <div>
                          <div className="font-medium">
                            Proporcional à Renda
                          </div>
                          <div className="text-sm text-muted-foreground">
                            Automático baseado nas receitas
                          </div>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Trocar a moeda depois de a viagem comecar e seguro, e vale
                    dizer por que: nenhuma despesa e reescrita. Cada lancamento
                    carrega a propria moeda e a propria cotacao congelada, e o
                    saldo continua saindo em real da view -- o que muda e o que o
                    formulario sugere e a moeda em que a tela escreve o saldo. */}
                <div className="space-y-2">
                  <Label htmlFor="edit_group_currency">Moeda do grupo</Label>
                  <Select
                    value={editForm.currency}
                    onValueChange={(value) =>
                      setEditForm({ ...editForm, currency: value })
                    }
                  >
                    <SelectTrigger id="edit_group_currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {opcoesDeMoeda().map((o) => (
                        <SelectItem key={o.codigo} value={o.codigo}>
                          {o.rotulo}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Trocar a moeda não altera nenhuma despesa já lançada: cada uma
                    guarda a cotação do próprio dia. Muda o que é sugerido nas
                    próximas e a moeda em que o saldo aparece.
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button type="submit">Salvar Alterações</Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowEditForm(false);
                      setSelectedGroup(null);
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Invite Form Modal */}
      {showInviteForm && selectedGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Convidar para {selectedGroup.name}</CardTitle>
              <CardDescription>
                Envie um convite por email ou telefone
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSendInvite} className="space-y-4">
                <div className="space-y-2">
                  <Label>Método de Convite</Label>
                  <Select
                    value={inviteForm.method}
                    onValueChange={(value: "email" | "phone") =>
                      setInviteForm({ ...inviteForm, method: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="email">
                        <div className="flex items-center gap-2">
                          <Mail className="h-4 w-4" />
                          Email
                        </div>
                      </SelectItem>
                      <SelectItem value="phone">
                        <div className="flex items-center gap-2">
                          <Phone className="h-4 w-4" />
                          Telefone
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contact">
                    {inviteForm.method === "email" ? "Email" : "Telefone"}
                  </Label>
                  <Input
                    id="contact"
                    type={inviteForm.method === "email" ? "email" : "tel"}
                    value={inviteForm.email_or_phone}
                    onChange={(e) =>
                      setInviteForm({
                        ...inviteForm,
                        email_or_phone: e.target.value,
                      })
                    }
                    placeholder={
                      inviteForm.method === "email"
                        ? "usuario@exemplo.com"
                        : "(11) 99999-9999"
                    }
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="message">Mensagem (opcional)</Label>
                  <Textarea
                    id="message"
                    value={inviteForm.message}
                    onChange={(e) =>
                      setInviteForm({
                        ...inviteForm,
                        message: e.target.value,
                      })
                    }
                    placeholder="Adicione uma mensagem personalizada..."
                    rows={3}
                  />
                </div>

                <div className="flex gap-2">
                  <Button type="submit">Enviar Convite</Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowInviteForm(false)}
                  >
                    Cancelar
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Proportions Modal */}
      {showProportions && selectedGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Divisão Proporcional - {selectedGroup.name}
              </CardTitle>
              <CardDescription>
                Baseado nas receitas do mês atual (realizadas + previstas)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {proportions.length > 0 ? (
                  <div className="space-y-3">
                    {proportions.map((prop, index) => {
                      // Buscar dados do membro nos dados do grupo
                      const member = selectedGroup.members?.find(
                        (m) => m.id === prop.member_id
                      );
                      return (
                        <div
                          key={prop.member_id || index}
                          className="flex items-center justify-between p-3 bg-muted rounded-lg"
                        >
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={member?.user?.avatar_url} />
                              <AvatarFallback className="text-xs">
                                {member?.user?.full_name?.charAt(0) || "?"}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="font-medium">
                                {member?.user?.full_name ||
                                  "Membro desconhecido"}
                                {member?.role === "admin" && (
                                  <Crown className="h-3 w-3 text-warning inline ml-1" />
                                )}
                              </div>
                              {prop.total_income && (
                                <div className="text-sm text-muted-foreground">
                                  Renda: R${" "}
                                  {Number(prop.total_income).toLocaleString(
                                    "pt-BR",
                                    { minimumFractionDigits: 2 }
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-lg">
                              {Number(prop.proportion_percentage).toFixed(1)}%
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {new Date(prop.calculated_at).toLocaleDateString(
                                "pt-BR"
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    <div className="mt-6 pt-4 border-t">
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>Total de membros ativos:</span>
                        <span>{proportions.length}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>Soma dos percentuais:</span>
                        <span>
                          {proportions
                            .reduce(
                              (sum, p) => sum + Number(p.proportion_percentage),
                              0
                            )
                            .toFixed(1)}
                          %
                        </span>
                      </div>
                    </div>

                    <div className="flex gap-2 pt-4">
                      <Button
                        onClick={() =>
                          handleCalculateProportions(selectedGroup)
                        }
                        disabled={loadingProportions}
                        className="flex items-center gap-2"
                      >
                        <Calculator className="h-4 w-4" />
                        {loadingProportions ? "Calculando..." : "Recalcular"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setShowProportions(false)}
                      >
                        Fechar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Calculator className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-medium mb-2">
                      Nenhuma proporção calculada
                    </h3>
                    <p className="text-muted-foreground mb-6">
                      Calcule as proporções baseadas nas receitas dos membros
                    </p>
                    <div className="flex gap-2 justify-center">
                      <Button
                        onClick={() =>
                          handleCalculateProportions(selectedGroup)
                        }
                        disabled={loadingProportions}
                        className="flex items-center gap-2"
                      >
                        <Calculator className="h-4 w-4" />
                        {loadingProportions
                          ? "Calculando..."
                          : "Calcular Proporções"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setShowProportions(false)}
                      >
                        Fechar
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
