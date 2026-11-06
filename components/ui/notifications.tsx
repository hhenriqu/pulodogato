"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
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
import {
  AlertCircle,
  Bell,
  CalendarClock,
  Check,
  CheckCheck,
  Clock,
  CreditCard,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import type { FamiliaDoAviso } from "@/lib/avisos-do-sino";
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

// O icone e a cor de cada familia de aviso. Antes o bloco do icone so tinha o
// caso `group_invitation`, e qualquer outro tipo saia sem icone nenhum.
const ICONE_DA_FAMILIA: Record<
  FamiliaDoAviso,
  { Icone: React.ElementType; fundo: string; cor: string }
> = {
  vencida: { Icone: AlertCircle, fundo: "bg-destructive/10", cor: "text-destructive" },
  vencimento: { Icone: CalendarClock, fundo: "bg-warning/10", cor: "text-warning" },
  cartao: { Icone: CreditCard, fundo: "bg-info/10", cor: "text-info" },
  grupo: { Icone: Users, fundo: "bg-info/10", cor: "text-info" },
  aprovacao: { Icone: UserCheck, fundo: "bg-primary/10", cor: "text-primary" },
};

/**
 * "em 3d" para uma data FUTURA. O `formatTimeAgo` abaixo so sabe o passado:
 * com o prazo do convite (futuro) a diferenca saia negativa e o cartao dizia
 * "Expira em agora" ate o ultimo minuto.
 */
function tempoAte(dataIso: string): string {
  const ms = new Date(dataIso).getTime() - Date.now();
  if (!(ms > 0)) return "instantes";
  const horas = Math.floor(ms / 3_600_000);
  if (horas < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m`;
  if (horas < 24) return `${horas}h`;
  return `${Math.floor(horas / 24)}d`;
}

/** A data do aviso como o usuario fala: "hoje", "05/11". */
function dataDoAviso(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return "";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
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
    responderDivisao,
  } = useNotifications(user);

  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();

  const handleResponderDivisao = async (
    notification: Notification,
    action: "approve" | "reject"
  ) => {
    const result = await responderDivisao(notification, action);
    if (result.success) {
      toast.success(action === "approve" ? "Divisão aprovada" : "Divisão recusada");
      refetch();
    } else {
      toast.error(result.error || "Erro ao responder à divisão");
    }
  };

  const abrirAviso = (notification: Notification) => {
    if (!notification.read) markAsRead(notification.id);
    const href = notification.aviso?.href;
    if (href) {
      setIsOpen(false);
      router.push(href as Route);
    }
  };

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
        <Button
          variant="ghost"
          size="sm"
          className="relative"
          aria-label={
            unreadCount > 0
              ? `Notificações: ${unreadCount} não lida${unreadCount === 1 ? "" : "s"}`
              : "Notificações"
          }
        >
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

      <DropdownMenuContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
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
                      notification.aviso?.href ? "cursor-pointer" : ""
                    } ${!notification.read ? "bg-info/5" : ""}`}
                    onClick={() => abrirAviso(notification)}
                  >
                    <div className="flex gap-3">
                      {/* Icon */}
                      <div className="mt-1">
                        {notification.type === "group_invitation" && (
                          <div className="h-8 w-8 rounded-full bg-info/10 flex items-center justify-center">
                            <Users className="h-4 w-4 text-info" />
                          </div>
                        )}
                        {notification.aviso &&
                          (() => {
                            const { Icone, fundo, cor } =
                              ICONE_DA_FAMILIA[notification.aviso.familia] ??
                              ICONE_DA_FAMILIA.vencimento;
                            return (
                              <div
                                className={`h-8 w-8 rounded-full ${fundo} flex items-center justify-center`}
                              >
                                <Icone className={`h-4 w-4 ${cor}`} />
                              </div>
                            );
                          })()}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between">
                          <h4 className="text-sm font-medium line-clamp-1">
                            {notification.title}
                          </h4>
                          <div className="flex items-center gap-1 ml-2">
                            <span className="text-xs text-muted-foreground">
                              {notification.aviso
                                ? dataDoAviso(notification.aviso.data)
                                : formatTimeAgo(notification.created_at)}
                            </span>
                            {!notification.read && (
                              <div className="h-2 w-2 rounded-full bg-primary"></div>
                            )}
                          </div>
                        </div>

                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {notification.message}
                        </p>

                        {/* Divisao que alguem lancou para eu aprovar */}
                        {notification.aviso?.acao?.tipo === "divisao" && (
                          <div className="flex items-center gap-2 mt-3">
                            <Button
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleResponderDivisao(notification, "approve");
                              }}
                              className="h-7 text-xs"
                            >
                              <Check className="h-3 w-3 mr-1" />
                              Aprovar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleResponderDivisao(notification, "reject");
                              }}
                              className="h-7 text-xs"
                            >
                              <X className="h-3 w-3 mr-1" />
                              Recusar
                            </Button>
                          </div>
                        )}

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
                            <span>Expira em {tempoAte(convite.expires_at)}</span>
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

        {/* Footer. A tela de avisos (configuracao da janela, push, e-mail)
            nao tinha nenhum caminho a partir do sino. */}
        <Separator />
        <div className="flex items-center gap-1 p-2">
          <Button asChild variant="ghost" size="sm" className="flex-1 text-xs">
            <Link href="/dashboard/notifications" onClick={() => setIsOpen(false)}>
              Configurar avisos
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={refetch}
            className="flex-1 text-xs"
          >
            Atualizar
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
