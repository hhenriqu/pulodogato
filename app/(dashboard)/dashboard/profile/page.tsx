"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { ChavePixDoPerfil } from "@/components/perfil/ChavePixDoPerfil";
import {
  User as UserIcon,
  Shield,
  Users,
  Settings,
  Save,
  Upload,
} from "lucide-react";

interface Profile {
  id: string;
  full_name: string;
  nickname?: string;
  phone?: string;
  avatar_url?: string;
  bio?: string;
  is_public: boolean;
  allow_connections: boolean;
  preferences: {
    notifications: {
      connection_requests: boolean;
      group_invites: boolean;
      dividends: boolean;
      price_alerts: boolean;
      portfolio_summary: boolean;
    };
    privacy: {
      show_portfolio_value: boolean;
      show_transactions: boolean;
      show_performance: boolean;
    };
  };
}

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "profile" | "privacy" | "notifications"
  >("profile");

  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    const getProfile = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          router.push("/login");
          return;
        }

        setUser(user);

        const { data: profileData, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .single();

        if (error && error.code !== "PGRST116") {
          console.error("Error fetching profile:", error);
          toast.error("Erro ao carregar perfil");
          return;
        }

        if (profileData) {
          setProfile(profileData);
        } else {
          // Criar perfil padrão se não existir
          const defaultProfile: Omit<Profile, "id"> = {
            full_name:
              user.user_metadata?.full_name || user.email?.split("@")[0] || "",
            nickname: "",
            phone: "",
            avatar_url: user.user_metadata?.avatar_url || "",
            bio: "",
            is_public: false,
            allow_connections: true,
            preferences: {
              notifications: {
                connection_requests: true,
                group_invites: true,
                dividends: true,
                price_alerts: false,
                portfolio_summary: true,
              },
              privacy: {
                show_portfolio_value: false,
                show_transactions: false,
                show_performance: false,
              },
            },
          };

          const { data: newProfile, error: createError } = await supabase
            .from("profiles")
            .insert({ id: user.id, ...defaultProfile })
            .select()
            .single();

          if (createError) {
            console.error("Error creating profile:", createError);
            toast.error("Erro ao criar perfil");
            return;
          }

          setProfile(newProfile);
        }
      } catch (error) {
        console.error("Error:", error);
        toast.error("Erro inesperado");
      } finally {
        setLoading(false);
      }
    };

    getProfile();
  }, [supabase, router]);

  const handleSave = async () => {
    if (!profile || !user) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: profile.full_name,
          nickname: profile.nickname,
          phone: profile.phone,
          bio: profile.bio,
          is_public: profile.is_public,
          allow_connections: profile.allow_connections,
          preferences: profile.preferences,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (error) throw error;

      toast.success("Perfil atualizado com sucesso!");
    } catch (error) {
      console.error("Error saving profile:", error);
      toast.error("Erro ao salvar perfil");
    } finally {
      setSaving(false);
    }
  };

  const updateProfile = (updates: Partial<Profile>) => {
    if (!profile) return;
    setProfile({ ...profile, ...updates });
  };

  const updatePreferences = (
    section: keyof Profile["preferences"],
    updates: any
  ) => {
    if (!profile) return;
    setProfile({
      ...profile,
      preferences: {
        ...profile.preferences,
        [section]: { ...profile.preferences[section], ...updates },
      },
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!profile || !user) return null;

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">Meu Perfil</h1>
          <p className="text-muted-foreground">
            Gerencie suas informações pessoais, privacidade e notificações
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2"
        >
          <Save className="h-4 w-4" />
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar Navigation */}
        <div className="lg:col-span-1">
          <nav className="space-y-2">
            <Button
              variant={activeTab === "profile" ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => setActiveTab("profile")}
            >
              <UserIcon className="h-4 w-4 mr-2" />
              Perfil
            </Button>
            <Button
              variant={activeTab === "privacy" ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => setActiveTab("privacy")}
            >
              <Shield className="h-4 w-4 mr-2" />
              Privacidade
            </Button>
            <Button
              variant={activeTab === "notifications" ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => setActiveTab("notifications")}
            >
              <Settings className="h-4 w-4 mr-2" />
              Notificações
            </Button>
          </nav>
        </div>

        {/* Main Content */}
        <div className="lg:col-span-3 space-y-6">
          {activeTab === "profile" && (
            <>
              {/* Informações Básicas */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <UserIcon className="h-5 w-5" />
                    Informações Básicas
                  </CardTitle>
                  <CardDescription>
                    Atualize suas informações pessoais e foto de perfil
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Avatar */}
                  <div className="flex items-center gap-4">
                    <Avatar className="h-20 w-20">
                      <AvatarImage src={profile.avatar_url} />
                      <AvatarFallback>
                        {profile.full_name?.charAt(0).toUpperCase() || "U"}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex items-center gap-2"
                      >
                        <Upload className="h-4 w-4" />
                        Alterar Foto
                      </Button>
                      <p className="text-xs text-muted-foreground mt-1">
                        JPG, PNG ou WebP. Máximo 2MB.
                      </p>
                    </div>
                  </div>

                  <Separator />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="full_name">Nome Completo</Label>
                      <Input
                        id="full_name"
                        value={profile.full_name}
                        onChange={(e) =>
                          updateProfile({ full_name: e.target.value })
                        }
                        placeholder="Seu nome completo"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="nickname">Apelido</Label>
                      <Input
                        id="nickname"
                        value={profile.nickname || ""}
                        onChange={(e) =>
                          updateProfile({ nickname: e.target.value })
                        }
                        placeholder="Como quer ser chamado"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        value={user.email}
                        disabled
                        className="bg-muted"
                      />
                      <p className="text-xs text-muted-foreground">
                        Para alterar o email, use as configurações de conta
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="phone">Telefone</Label>
                      <Input
                        id="phone"
                        value={profile.phone || ""}
                        onChange={(e) =>
                          updateProfile({ phone: e.target.value })
                        }
                        placeholder="(11) 99999-9999"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="bio">Biografia</Label>
                    <Textarea
                      id="bio"
                      value={profile.bio || ""}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                        updateProfile({ bio: e.target.value })
                      }
                      placeholder="Conte um pouco sobre você..."
                      rows={3}
                    />
                    <p className="text-xs text-muted-foreground">
                      {(profile.bio || "").length}/500 caracteres
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Chave Pix. Card proprio, e Save proprio: ela grava em
                  `user_pix_keys`, nao em `profiles` -- ver o cabecalho do
                  componente e o da migration 032. */}
              <ChavePixDoPerfil userId={user.id} />

              {/* Configurações Sociais */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Configurações Sociais
                  </CardTitle>
                  <CardDescription>
                    Configure como outros usuários podem encontrar e se conectar
                    com você
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label>Perfil Público</Label>
                      <p className="text-sm text-muted-foreground">
                        Permite que outros usuários vejam suas informações
                        básicas
                      </p>
                    </div>
                    <Switch
                      checked={profile.is_public}
                      onCheckedChange={(checked: boolean) =>
                        updateProfile({ is_public: checked })
                      }
                    />
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label>Permitir Conexões</Label>
                      <p className="text-sm text-muted-foreground">
                        Outros usuários podem enviar solicitações de conexão
                      </p>
                    </div>
                    <Switch
                      checked={profile.allow_connections}
                      onCheckedChange={(checked: boolean) =>
                        updateProfile({ allow_connections: checked })
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {activeTab === "privacy" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Configurações de Privacidade
                </CardTitle>
                <CardDescription>
                  Controle que informações são visíveis para suas conexões
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label>Mostrar Valor do Portfólio</Label>
                    <p className="text-sm text-muted-foreground">
                      Suas conexões podem ver o valor total dos seus
                      investimentos
                    </p>
                  </div>
                  <Switch
                    checked={profile.preferences.privacy.show_portfolio_value}
                    onCheckedChange={(checked: boolean) =>
                      updatePreferences("privacy", {
                        show_portfolio_value: checked,
                      })
                    }
                  />
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label>Mostrar Transações</Label>
                    <p className="text-sm text-muted-foreground">
                      Suas conexões podem ver suas compras e vendas
                    </p>
                  </div>
                  <Switch
                    checked={profile.preferences.privacy.show_transactions}
                    onCheckedChange={(checked: boolean) =>
                      updatePreferences("privacy", {
                        show_transactions: checked,
                      })
                    }
                  />
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label>Mostrar Performance</Label>
                    <p className="text-sm text-muted-foreground">
                      Suas conexões podem ver gráficos de rentabilidade
                    </p>
                  </div>
                  <Switch
                    checked={profile.preferences.privacy.show_performance}
                    onCheckedChange={(checked: boolean) =>
                      updatePreferences("privacy", {
                        show_performance: checked,
                      })
                    }
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === "notifications" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Configurações de Notificações
                </CardTitle>
                <CardDescription>
                  Escolha que tipos de notificações você deseja receber
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-4">
                  <h4 className="font-medium">Sociais</h4>

                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label>Solicitações de Conexão</Label>
                      <p className="text-sm text-muted-foreground">
                        Notificar quando alguém quiser se conectar
                      </p>
                    </div>
                    <Switch
                      checked={
                        profile.preferences.notifications.connection_requests
                      }
                      onCheckedChange={(checked: boolean) =>
                        updatePreferences("notifications", {
                          connection_requests: checked,
                        })
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label>Convites para Grupos</Label>
                      <p className="text-sm text-muted-foreground">
                        Notificar quando for convidado para grupos
                      </p>
                    </div>
                    <Switch
                      checked={profile.preferences.notifications.group_invites}
                      onCheckedChange={(checked: boolean) =>
                        updatePreferences("notifications", {
                          group_invites: checked,
                        })
                      }
                    />
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <h4 className="font-medium">Investimentos</h4>

                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label>Dividendos</Label>
                      <p className="text-sm text-muted-foreground">
                        Notificar sobre recebimento de dividendos
                      </p>
                    </div>
                    <Switch
                      checked={profile.preferences.notifications.dividends}
                      onCheckedChange={(checked: boolean) =>
                        updatePreferences("notifications", {
                          dividends: checked,
                        })
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label>Alertas de Preço</Label>
                      <p className="text-sm text-muted-foreground">
                        Notificar sobre variações significativas de preço
                      </p>
                    </div>
                    <Switch
                      checked={profile.preferences.notifications.price_alerts}
                      onCheckedChange={(checked: boolean) =>
                        updatePreferences("notifications", {
                          price_alerts: checked,
                        })
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label>Resumo do Portfólio</Label>
                      <p className="text-sm text-muted-foreground">
                        Receber resumo semanal por email
                      </p>
                    </div>
                    <Switch
                      checked={
                        profile.preferences.notifications.portfolio_summary
                      }
                      onCheckedChange={(checked: boolean) =>
                        updatePreferences("notifications", {
                          portfolio_summary: checked,
                        })
                      }
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
