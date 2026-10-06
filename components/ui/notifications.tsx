"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Bell, Users, Check, X, Clock, CheckCheck } from "lucide-react";
import {
  useNotifications,
  GroupInvitationNotification,
  // Sem este import o nome `Notification` resolve para o tipo do DOM, que tem
  // `body`, `icon` e mais 12 campos -- e o erro aparece no CHAMADOR, nao aqui.
  type Notification,
} from "@/lib/hooks/useNotifications";
import { User } from "@supabase/supabase-js";

interface NotificationsProps {
  user: User | null;
}

export function NotificationBell({ user }: NotificationsProps) {
  const {
    notifications,
    loading,
    unreadCount,
    refetch,
    markAsRead,
    markAllAsRead,
    acceptGroupInvitation,
    rejectGroupInvitation,
  } = useNotifications(user);

  const [isOpen, setIsOpen] = useState(false);

  const handleAcceptInvite = async (notification: Notification) => {
    const invitation = notification.data as GroupInvitationNotification;
    const result = await acceptGroupInvitation(invitation);

    if (result.success) {
      toast.success(`Você entrou no grupo "${invitation.group_name}"!`);
      refetch();
    } else {
      toast.error(result.error || "Erro ao aceitar convite");
    }
  };

  const handleRejectInvite = async (notification: Notification) => {
    const invitation = notification.data as GroupInvitationNotification;
    const result = await rejectGroupInvitation(invitation);

    if (result.success) {
      toast.success("Convite rejeitado");
      refetch();
    } else {
      toast.error(result.error || "Erro ao rejeitar convite");
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const now = new Date();
    const date = new Date(dateString);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "agora";
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    return `${diffDays}d`;
  };

  if (!user) return null;

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-96 p-0">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <DropdownMenuLabel className="p-0">Notificações</DropdownMenuLabel>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={markAllAsRead}
              className="h-6 text-xs"
            >
              <CheckCheck className="h-3 w-3 mr-1" />
              Marcar todas
            </Button>
          )}
        </div>

        {/* Content */}
        <div className="max-h-96 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center px-4">
              <Bell className="h-12 w-12 text-muted-foreground mb-2" />
              <h3 className="font-medium text-sm mb-1">Nenhuma notificação</h3>
              <p className="text-xs text-muted-foreground">
                Você está em dia com tudo!
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notification) => {
                // `data` e `unknown` no tipo da notificacao, porque o conteudo
                // muda conforme o `type`. A forma do convite e afirmada UMA vez
                // aqui, em vez de uma vez por campo lido no JSX abaixo -- que
                // era o que o `any` permitia, sem afirmacao nenhuma.
                const convite =
                  notification.type === "group_invitation"
                    ? (notification.data as
                        | GroupInvitationNotification
                        | undefined)
                    : undefined;

                return (
                  <div
                    key={notification.id}
                    className={`p-4 hover:bg-muted/50 transition-colors ${
                      !notification.read ? "bg-info/5" : ""
                    }`}
                    onClick={() =>
                      !notification.read && markAsRead(notification.id)
                    }
                  >
                    <div className="flex gap-3">
                      {/* Icon */}
                      <div className="mt-1">
                        {notification.type === "group_invitation" && (
                          <div className="h-8 w-8 rounded-full bg-info/10 flex items-center justify-center">
                            <Users className="h-4 w-4 text-info" />
                          </div>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between">
                          <h4 className="text-sm font-medium line-clamp-1">
                            {notification.title}
                          </h4>
                          <div className="flex items-center gap-1 ml-2">
                            <span className="text-xs text-muted-foreground">
                              {formatTimeAgo(notification.created_at)}
                            </span>
                            {!notification.read && (
                              <div className="h-2 w-2 rounded-full bg-primary"></div>
                            )}
                          </div>
                        </div>

                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {notification.message}
                        </p>

                        {/* Actions for Group Invitations */}
                        {notification.type === "group_invitation" && (
                          <div className="flex items-center gap-2 mt-3">
                            <Button
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAcceptInvite(notification);
                              }}
                              className="h-7 text-xs"
                            >
                              <Check className="h-3 w-3 mr-1" />
                              Aceitar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRejectInvite(notification);
                              }}
                              className="h-7 text-xs"
                            >
                              <X className="h-3 w-3 mr-1" />
                              Rejeitar
                            </Button>

                            {/* Quem convidou. O codigo do grupo saiu daqui com a
                                030: quem recusa o convite nao precisa sair com a
                                chave de entrada do grupo na mao, e os dois botoes
                                acima nunca dependeram dele. `inviter_name` pode
                                ser nulo (perfil sem nome preenchido), entao a
                                inicial cai para "?" em vez de sumir. */}
                            <div className="flex items-center gap-1 ml-auto">
                              <Avatar className="h-5 w-5">
                                <AvatarImage
                                  src={convite?.inviter_avatar_url ?? undefined}
                                />
                                <AvatarFallback className="text-xs">
                                  {convite?.inviter_name?.charAt(0) ?? "?"}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-xs text-muted-foreground">
                                {convite?.inviter_name ?? "Alguém"}
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Expiration for invitations */}
                        {convite?.expires_at && (
                          <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            <span>
                              Expira em {formatTimeAgo(convite.expires_at)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {notifications.length > 0 && (
          <>
            <Separator />
            <div className="p-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={refetch}
                className="w-full text-xs"
              >
                Atualizar notificações
              </Button>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
