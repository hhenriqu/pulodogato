"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { PUBLIC_PROFILE_FIELDS } from "@/lib/profile-fields";
import Link from "next/link";
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
import { toast } from "sonner";
import {
  Users,
  UserPlus,
  Search,
  Check,
  X,
  Clock,
  ArrowLeftRight,
  Shield,
} from "lucide-react";

interface Profile {
  id: string;
  full_name: string;
  nickname?: string;
  avatar_url?: string;
  bio?: string;
  is_public: boolean;
  allow_connections: boolean;
}

interface Connection {
  id: string;
  requester_id: string;
  requested_id: string;
  status: "pending" | "accepted" | "blocked";
  message?: string;
  created_at: string;
  responded_at?: string;
  requester?: Profile;
  requested?: Profile;
}

// O grupo desta aba e o MESMO da tela de Grupos: public.expense_groups.
// Ate a HMO-124 esta tela lia uma tabela `user_groups` que nunca existiu no
// banco, com colunas (owner_id, is_private, max_members, invite_code) que sao
// de um esquema que nunca foi criado. As equivalentes reais sao created_by,
// group_type, group_code -- e teto de membros nao existe no produto.
interface Group {
  id: string;
  name: string;
  description?: string;
  created_by: string;
  group_type: string;
  group_code?: string;
  member_count: number;
  user_role?: string;
}

export default function ConnectionsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [pendingRequests, setPendingRequests] = useState<Connection[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("connections");

  const supabase = createClient();

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (searchQuery.trim().length > 2) {
      searchUsers();
    } else {
      setSearchResults([]);
    }
  }, [searchQuery]);

  const loadData = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      setUser(user);

      // Carregar conexões aceitas
      const { data: connectionsData } = await supabase
        .from("user_connections")
        .select(
          `
          *,
          requester:profiles!user_connections_requester_id_fkey(${PUBLIC_PROFILE_FIELDS}),
          requested:profiles!user_connections_requested_id_fkey(${PUBLIC_PROFILE_FIELDS})
        `
        )
        .or(`requester_id.eq.${user.id},requested_id.eq.${user.id}`)
        .eq("status", "accepted");

      setConnections(connectionsData || []);

      // Carregar solicitações pendentes
      const { data: pendingData } = await supabase
        .from("user_connections")
        .select(
          `
          *,
          requester:profiles!user_connections_requester_id_fkey(${PUBLIC_PROFILE_FIELDS})
        `
        )
        .eq("requested_id", user.id)
        .eq("status", "pending");

      setPendingRequests(pendingData || []);

      // Carregar grupos do usuário
      const { data: groupsData } = await supabase
        .from("group_members")
        .select(
          `
          role,
          expense_groups (
            id,
            name,
            description,
            created_by,
            group_type,
            group_code,
            is_active
          )
        `
        )
        .eq("user_id", user.id)
        .eq("status", "active");

      if (groupsData) {
        const groupsWithCounts = await Promise.all(
          groupsData
            // group_members guarda tambem quem saiu ou foi removido; e o
            // is_active separa o grupo arquivado. Sem os dois filtros, a viagem
            // que acabou e o grupo de que o usuario saiu continuariam nesta
            // lista, e so aqui -- a tela de Grupos ja os esconde.
            .filter((item: any) => item.expense_groups?.is_active !== false)
            .map(async (item: any) => {
              const group = item.expense_groups;
              const { count } = await supabase
                .from("group_members")
                .select("*", { count: "exact", head: true })
                .eq("group_id", group.id)
                .eq("status", "active");

              return {
                id: group.id,
                name: group.name,
                description: group.description,
                created_by: group.created_by,
                group_type: group.group_type,
                group_code: group.group_code,
                member_count: count || 0,
                user_role: item.role,
              } as Group;
            })
        );
        setGroups(groupsWithCounts);
      }
    } catch (error) {
      console.error("Error loading data:", error);
      toast.error("Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  };

  const searchUsers = async () => {
    if (!user) return;

    setSearchLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select(PUBLIC_PROFILE_FIELDS)
        .or(`full_name.ilike.%${searchQuery}%,nickname.ilike.%${searchQuery}%`)
        .eq("is_public", true)
        .eq("allow_connections", true)
        .neq("id", user.id)
        .limit(10);

      if (error) throw error;
      setSearchResults(data || []);
    } catch (error) {
      console.error("Error searching users:", error);
      toast.error("Erro ao buscar usuários");
    } finally {
      setSearchLoading(false);
    }
  };

  const sendConnectionRequest = async (
    targetUserId: string,
    message?: string
  ) => {
    if (!user) return;

    try {
      const { error } = await supabase.from("user_connections").insert({
        requester_id: user.id,
        requested_id: targetUserId,
        status: "pending",
        message,
      });

      if (error) {
        if (error.code === "23505") {
          toast.error("Solicitação já enviada para este usuário");
          return;
        }
        throw error;
      }

      toast.success("Solicitação de conexão enviada!");
      setSearchResults((results) =>
        results.filter((profile) => profile.id !== targetUserId)
      );
    } catch (error) {
      console.error("Error sending connection request:", error);
      toast.error("Erro ao enviar solicitação");
    }
  };

  const respondToRequest = async (connectionId: string, accept: boolean) => {
    try {
      const { error } = await supabase
        .from("user_connections")
        .update({
          status: accept ? "accepted" : "blocked",
          responded_at: new Date().toISOString(),
        })
        .eq("id", connectionId);

      if (error) throw error;

      toast.success(accept ? "Conexão aceita!" : "Solicitação rejeitada");
      loadData(); // Recarregar dados
    } catch (error) {
      console.error("Error responding to request:", error);
      toast.error("Erro ao responder solicitação");
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">Conexões</h1>
          <p className="text-muted-foreground">
            As pessoas com quem você divide despesas fora de um grupo
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {connections.length} conexões
          </Badge>
          {pendingRequests.length > 0 && (
            <Badge variant="destructive" className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {pendingRequests.length} pendentes
            </Badge>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="connections">Conexões</TabsTrigger>
          <TabsTrigger value="requests" className="relative">
            Solicitações
            {pendingRequests.length > 0 && (
              <Badge className="absolute -top-2 -right-2 h-5 w-5 p-0 text-xs">
                {pendingRequests.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="search">Buscar</TabsTrigger>
          <TabsTrigger value="groups">Grupos</TabsTrigger>
        </TabsList>

        <TabsContent value="connections" className="space-y-4">
          {connections.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {connections.map((connection) => {
                const profile =
                  connection.requester_id === user?.id
                    ? connection.requested
                    : connection.requester;

                return (
                  <Card key={connection.id}>
                    <CardContent className="p-6">
                      <div className="flex items-center space-x-4">
                        <Avatar>
                          <AvatarImage src={profile?.avatar_url} />
                          <AvatarFallback>
                            {profile?.full_name?.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">
                            {profile?.full_name}
                          </p>
                          {profile?.nickname && (
                            <p className="text-sm text-muted-foreground">
                              @{profile.nickname}
                            </p>
                          )}
                          {profile?.bio && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {profile.bio}
                            </p>
                          )}
                        </div>
                      </div>
                      {/* Aqui havia dois botoes, "Mensagem" e "Perfil", sem
                          onClick e sem tela do outro lado -- nao existe
                          mensageria nem perfil publico no produto. Um botao
                          que nao faz nada ensina o usuario a nao clicar nos
                          que fazem. No lugar deles fica a acao que a conexao
                          realmente habilita. */}
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full mt-4"
                        asChild
                      >
                        <Link href="/dashboard/personal-finance">
                          <ArrowLeftRight className="h-4 w-4 mr-2" />
                          Dividir uma despesa
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center p-8">
                <Users className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">
                  Nenhuma conexão ainda
                </h3>
                <p className="text-muted-foreground text-center">
                  Busque a pessoa pelo nome na aba Buscar e mande um convite
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="requests" className="space-y-4">
          {pendingRequests.length > 0 ? (
            <div className="space-y-4">
              {pendingRequests.map((request) => (
                <Card key={request.id}>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <Avatar>
                          <AvatarImage src={request.requester?.avatar_url} />
                          <AvatarFallback>
                            {request.requester?.full_name
                              ?.charAt(0)
                              .toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">
                            {request.requester?.full_name}
                          </p>
                          {request.requester?.nickname && (
                            <p className="text-sm text-muted-foreground">
                              @{request.requester.nickname}
                            </p>
                          )}
                          {request.message && (
                            <p className="text-sm mt-2 p-2 bg-muted rounded">
                              "{request.message}"
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => respondToRequest(request.id, true)}
                          className="flex items-center gap-2"
                        >
                          <Check className="h-4 w-4" />
                          Aceitar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => respondToRequest(request.id, false)}
                          className="flex items-center gap-2"
                        >
                          <X className="h-4 w-4" />
                          Rejeitar
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center p-8">
                <Clock className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">
                  Nenhuma solicitação pendente
                </h3>
                <p className="text-muted-foreground text-center">
                  Quando alguém quiser se conectar com você, aparecerá aqui
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="search" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                Buscar pessoas
              </CardTitle>
              <CardDescription>
                Encontre quem já usa o app pelo nome ou pelo apelido. Só aparece
                quem deixou o perfil público.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Input
                placeholder="Busque por nome ou apelido..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="mb-4"
              />

              {searchLoading && (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                </div>
              )}

              {!searchLoading && searchResults.length > 0 && (
                <div className="space-y-4">
                  {searchResults.map((profile) => (
                    <div
                      key={profile.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div className="flex items-center space-x-4">
                        <Avatar>
                          <AvatarImage src={profile.avatar_url} />
                          <AvatarFallback>
                            {profile.full_name?.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{profile.full_name}</p>
                          {profile.nickname && (
                            <p className="text-sm text-muted-foreground">
                              @{profile.nickname}
                            </p>
                          )}
                          {profile.bio && (
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {profile.bio}
                            </p>
                          )}
                        </div>
                      </div>
                      <Button
                        onClick={() => sendConnectionRequest(profile.id)}
                        className="flex items-center gap-2"
                      >
                        <UserPlus className="h-4 w-4" />
                        Conectar
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {!searchLoading &&
                searchQuery.length > 2 &&
                searchResults.length === 0 && (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">
                      Nenhum usuário encontrado
                    </p>
                  </div>
                )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="groups" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Meus Grupos
              </CardTitle>
              <CardDescription>
                Os grupos de que você participa: a viagem, a casa, o que for
              </CardDescription>
            </CardHeader>
            <CardContent>
              {groups.length > 0 ? (
                <div className="space-y-4">
                  {groups.map((group) => (
                    <Link
                      key={group.id}
                      href={`/dashboard/expense-groups/${group.id}`}
                      className="block p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-medium">{group.name}</h3>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={
                              group.user_role === "admin"
                                ? "default"
                                : "secondary"
                            }
                          >
                            {group.user_role === "admin" ? "Admin" : "Membro"}
                          </Badge>
                          {group.group_type === "private" && (
                            <Badge variant="outline">
                              <Shield className="h-3 w-3 mr-1" />
                              Privado
                            </Badge>
                          )}
                        </div>
                      </div>
                      {group.description && (
                        <p className="text-sm text-muted-foreground mb-2">
                          {group.description}
                        </p>
                      )}
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>
                          {group.member_count}{" "}
                          {group.member_count === 1 ? "membro" : "membros"}
                        </span>
                        {group.group_code && (
                          <span>Código: {group.group_code}</span>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">
                    Nenhum grupo ainda
                  </h3>
                  <p className="text-muted-foreground mb-4">
                    Crie um grupo para dividir as contas de uma viagem ou da
                    casa
                  </p>
                  <Button asChild>
                    <Link href="/dashboard/expense-groups">
                      <UserPlus className="h-4 w-4 mr-2" />
                      Criar Grupo
                    </Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
