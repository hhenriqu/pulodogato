"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { useSubscription } from "@/lib/hooks/useSubscription";
import { PlanFeature, UserPlan } from "@/types/subscription";
import { PlanBadge } from "@/components/subscription/PlanGuards";
import {
  ID_MENU_MOBILE,
  MobileMenuClose,
} from "@/components/MobileMenuChrome";
import { cn } from "@/lib/utils";
import { User as UserType } from "@supabase/supabase-js";
import {
  LayoutDashboard,
  TrendingUp,
  BarChart3,
  User,
  Users,
  LogOut,
  Wallet,
  CreditCard,
  Landmark,
  CalendarClock,
  PiggyBank,
  Target,
  Bell,
  FileUp,
  Lock,
  Crown,
  Zap,
  Shield,
  Repeat,
  Tags,
  Calculator,
  LineChart,
  Settings,
} from "lucide-react";

interface SidebarProps {
  isMobileMenuOpen?: boolean;
  setIsMobileMenuOpen?: (open: boolean) => void;
}

interface NavigationItem {
  name: string;
  href: string;
  icon: React.ElementType;
  requiredFeature?: PlanFeature;
  requiredPlans?: UserPlan[];
  isPremium?: boolean;
}

const navigation: NavigationItem[] = [
  {
    name: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    name: "Finanças Pessoais",
    href: "/dashboard/personal-finance",
    icon: Wallet,
    requiredFeature: "personal_finance",
  },
  {
    // Sem `requiredFeature` de proposito: cadastrar a conta e o passo ZERO.
    // Toda tela que pede conta (lancamento, orcamento, fatura, extrato, meta)
    // fica inutil antes disto, e travar o cadastro atras de um plano deixaria o
    // usuario preso numa tela que so sabe dizer "selecione uma conta".
    name: "Contas e Cartões",
    href: "/dashboard/accounts",
    icon: CreditCard,
  },
  {
    name: "Contracheque",
    href: "/dashboard/payroll",
    icon: Landmark,
    requiredFeature: "personal_finance",
  },
  {
    name: "Contas Previstas",
    href: "/dashboard/bills",
    icon: CalendarClock,
    requiredFeature: "personal_finance",
  },
  // "Fluxo de Caixa" entrou na HMO-145, logo abaixo de "Contas Previstas" de
  // propósito: é a mesma agenda, lida no eixo do tempo. Quem acabou de
  // cadastrar uma conta com vencimento tem, uma linha abaixo, a tela que
  // responde o que aquilo faz com o saldo dele.
  //
  // Sem `requiredFeature`, pelo mesmo motivo de "Assinaturas" e "Patrimônio": a
  // previsão só lê o que o usuário já cadastrou e não consome nada além do
  // banco. E a pergunta que ela responde -- "em que dia eu fico no vermelho" --
  // é justamente a que não pode depender de plano para ser respondida.
  {
    name: "Fluxo de Caixa",
    href: "/dashboard/cash-flow",
    icon: LineChart,
  },
  {
    name: "Avisos",
    href: "/dashboard/notifications",
    icon: Bell,
    requiredFeature: "personal_finance",
  },
  {
    name: "Orçamento",
    href: "/dashboard/budgets",
    icon: PiggyBank,
    requiredFeature: "personal_finance",
  },
  {
    name: "Importar Extrato",
    href: "/dashboard/statements",
    icon: FileUp,
    requiredFeature: "personal_finance",
  },
  {
    name: "Investimentos",
    href: "/dashboard/investments",
    icon: TrendingUp,
    requiredFeature: "investment_tracking",
    isPremium: true,
  },
  // "Patrimônio" entrou na HMO-145, logo abaixo de "Investimentos" de
  // propósito: é a tela que responde o que "Investimentos" promete e ainda não
  // entrega -- quanto do que o usuário tem está aplicado.
  //
  // Sem `requiredFeature`, pelo mesmo motivo de "Assinaturas", "Regras" e
  // "Calculadoras": a tela só soma contas que o usuário já cadastrou e não
  // consome nada além do banco. Gatear atrás de plano esconderia do menu
  // justamente o número que dá sentido a todas as outras telas.
  {
    name: "Patrimônio",
    href: "/dashboard/net-worth",
    icon: Landmark,
  },
  // "Assinaturas" entrou na HMO-145. A tela, as rotas e a tabela subiram para
  // produção sem nenhum item de menu apontando para elas: /dashboard/recurrences
  // respondia 200, mas não havia como chegar lá clicando, então a feature
  // existia e ao mesmo tempo não existia para quem usa o app.
  //
  // Vai sem `requiredFeature` de propósito. O detector lê as transações que o
  // usuário já importou e não consome nada além do banco; gatear atrás de um
  // plano repetiria o problema de outra forma -- o item some do menu e a queixa
  // volta a ser "não tem feature nova".
  {
    name: "Assinaturas",
    href: "/dashboard/recurrences",
    icon: Repeat,
  },
  // "Regras" entrou na HMO-145, logo abaixo de "Importar Extrato" e
  // "Assinaturas" de propósito: as três dividem a mesma normalização de
  // descrição, e é importando um extrato que o usuário cria a primeira regra
  // sem perceber.
  //
  // Sem `requiredFeature`, pelo mesmo motivo de "Assinaturas": a regra só lê o
  // que o usuário já digitou e não consome nada além do banco. Gatear atrás de
  // plano esconderia do menu justamente a tela que explica por que a categoria
  // apareceu preenchida.
  {
    name: "Regras",
    href: "/dashboard/categorization",
    icon: Tags,
  },
  {
    name: "Metas",
    href: "/dashboard/goals",
    icon: Target,
    requiredFeature: "financial_goals",
  },
  // "Calculadoras" entrou na HMO-145. Sem `requiredFeature`, e aqui o motivo é
  // mais forte que o de "Assinaturas" e "Regras": a tela não lê o banco nem
  // uma vez. São quatro funções puras rodando no navegador -- não há custo por
  // uso para gatear, e o item some do menu sem contrapartida nenhuma.
  {
    name: "Calculadoras",
    href: "/dashboard/calculators",
    icon: Calculator,
  },
  // "Transações" saiu daqui na HMO-124. O item levava a uma tela que dizia
  // "Nenhuma transação encontrada" mesmo para quem tinha lançamentos -- ela
  // nunca consultou nada. A lista de verdade é "Finanças Pessoais", logo
  // acima; dois itens de menu para a mesma lista só ensinam o usuário a
  // desconfiar do menu. A rota /dashboard/transactions continua existindo e
  // redireciona.
  {
    name: "Relatórios",
    href: "/dashboard/reports",
    icon: BarChart3,
    requiredFeature: "advanced_reports",
    isPremium: true,
  },
  {
    name: "Grupos",
    href: "/dashboard/expense-groups",
    icon: Users,
    requiredFeature: "expense_groups",
  },
  {
    name: "Trading",
    href: "/dashboard/trading",
    icon: Zap,
    requiredFeature: "trading_signals",
    requiredPlans: ["trader", "admin"],
    isPremium: true,
  },
  {
    name: "Perfil",
    href: "/dashboard/profile",
    icon: User,
  },
  {
    name: "Conexões",
    href: "/dashboard/connections",
    icon: Users,
  },
  // "Configurações" saiu daqui na HMO-124 porque /dashboard/settings NÃO
  // EXISTIA: o item dava 404 do Next para todo usuário logado, sem exceção de
  // plano. A HMO-159 criou a tela, e o item volta apontando para ela.
  //
  // Ele NÃO duplica "Perfil", logo acima, e a fronteira é esta: "Perfil" é
  // quem você é (nome, apelido, perfil público, aceitar conexões);
  // "Configurações" é como o app se comporta (o que aparece no painel, em que
  // ordem) e o que fazer com os seus dados (apagar tudo e recomeçar).
  {
    name: "Configurações",
    href: "/dashboard/settings",
    icon: Settings,
  },
  {
    name: "Admin",
    href: "/dashboard/admin",
    icon: Shield,
    requiredPlans: ["admin"],
  },
];

export default function Sidebar({
  isMobileMenuOpen: externalMobileMenuOpen,
  setIsMobileMenuOpen: externalSetIsMobileMenuOpen,
}: SidebarProps = {}) {
  const [internalMobileMenuOpen, setInternalMobileMenuOpen] = useState(false);
  const [user, setUser] = useState<UserType | null>(null);

  // Use external state if provided, otherwise use internal state
  const isMobileMenuOpen = externalMobileMenuOpen ?? internalMobileMenuOpen;
  const setIsMobileMenuOpen =
    externalSetIsMobileMenuOpen ?? setInternalMobileMenuOpen;
  const pathname = usePathname();
  const supabase = createClient();
  const { hasFeature, subscription, isPremium, planConfig } =
    useSubscription(user);

  useEffect(() => {
    const getUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);
    };
    getUser();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  const canAccessItem = (item: NavigationItem): boolean => {
    // Apenas restringir acesso para páginas de admin
    if (item.requiredPlans && item.requiredPlans.includes("admin")) {
      return subscription?.plan === "admin" || false;
    }

    // Para todas as outras páginas, permitir acesso
    return true;
  };

  // Função para verificar se item é premium mas usuário não tem acesso
  const isPremiumButNoAccess = (item: NavigationItem): boolean => {
    if (!item.isPremium && !item.requiredFeature) return false;

    // Se tem feature requerida, verificar se o usuário tem acesso
    if (item.requiredFeature) {
      return !hasFeature(item.requiredFeature);
    }

    // Se é premium mas usuário não é premium
    return !!(item.isPremium && !isPremium);
  };

  const filteredNavigation = navigation.filter(canAccessItem);

  return (
    <>
      {/* Desktop Sidebar */}
      <div className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0">
        <div className="flex flex-col flex-grow pt-5 bg-card overflow-y-auto border-r">
          <div className="flex flex-col flex-shrink-0 px-6 space-y-4">
            <h1 className="text-xl font-bold text-foreground">PulodoGato</h1>
            {planConfig && (
              <div className="flex items-center justify-center">
                <PlanBadge plan={planConfig.id} size="sm" />
              </div>
            )}
          </div>

          <nav className="mt-8 flex-1 px-3 space-y-1">
            {filteredNavigation.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.name}
                  href={item.href as any}
                  className={cn(
                    isActive
                      ? "bg-primary/10 text-primary border-r-2 border-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    "group flex items-center px-3 py-2 text-sm font-medium rounded-l-md transition-colors"
                  )}
                >
                  <item.icon
                    className={cn(
                      isActive
                        ? "text-primary"
                        : "text-muted-foreground group-hover:text-foreground",
                      "mr-3 flex-shrink-0 h-5 w-5"
                    )}
                    aria-hidden="true"
                  />
                  <span
                    className={cn(
                      "flex-1",
                      isPremiumButNoAccess(item) && "text-muted-foreground"
                    )}
                  >
                    {item.name}
                  </span>
                  <div className="flex items-center gap-1 ml-auto">
                    {item.isPremium && (
                      <Crown
                        className={cn(
                          "h-3 w-3",
                          isPremiumButNoAccess(item)
                            ? "text-muted-foreground"
                            : "text-warning"
                        )}
                      />
                    )}
                    {isPremiumButNoAccess(item) && (
                      <Lock className="h-3 w-3 text-muted-foreground" />
                    )}
                  </div>
                </Link>
              );
            })}
          </nav>

          <div className="flex-shrink-0 p-4">
            <button
              onClick={handleLogout}
              className="group flex w-full items-center px-3 py-2 text-sm font-medium text-muted-foreground rounded-md hover:bg-muted hover:text-foreground transition-colors"
            >
              <LogOut className="mr-3 h-5 w-5 text-muted-foreground group-hover:text-foreground" />
              Sair
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Sidebar */}
      <div
        className={cn(
          "lg:hidden fixed inset-0 flex z-40",
          isMobileMenuOpen ? "pointer-events-auto" : "pointer-events-none"
        )}
      >
        <div
          className={cn(
            // Veu do menu mobile: escurece o conteudo atras nos dois temas,
            // entao e preto com opacidade em vez de token.
            "fixed inset-0 bg-black/60 transition-opacity",
            isMobileMenuOpen ? "opacity-100" : "opacity-0"
          )}
          onClick={() => setIsMobileMenuOpen(false)}
        />

        <div
          id={ID_MENU_MOBILE}
          className={cn(
            "relative flex-1 flex flex-col max-w-xs w-full bg-card transition-transform",
            isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          {/*
            O X mora DENTRO do painel (ver components/MobileMenuChrome.tsx). Ele
            ficava fora, empurrado para depois da borda direita por margem
            negativa, e reaparecia sobre o hamburguer do header sempre que a
            gaveta fechava -- a HMO-161.
          */}
          <MobileMenuClose
            aberto={isMobileMenuOpen}
            onClose={() => setIsMobileMenuOpen(false)}
          />

          <div className="flex-1 h-0 pt-5 pb-4 overflow-y-auto">
            <div className="flex flex-col flex-shrink-0 px-6 space-y-4">
              <h1 className="text-xl font-bold text-foreground">PulodoGato</h1>
              {planConfig && (
                <div className="flex items-center justify-center">
                  <PlanBadge plan={planConfig.id} size="sm" />
                </div>
              )}
            </div>

            <nav className="mt-8 px-3 space-y-1">
              {filteredNavigation.map((item) => {
                const isActive =
                  pathname === item.href ||
                  pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.name}
                    href={item.href as any}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={cn(
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      "group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors"
                    )}
                  >
                    <item.icon
                      className={cn(
                        isActive
                          ? "text-primary"
                          : "text-muted-foreground group-hover:text-foreground",
                        "mr-3 flex-shrink-0 h-5 w-5"
                      )}
                      aria-hidden="true"
                    />
                    <span
                      className={cn(
                        "flex-1",
                        isPremiumButNoAccess(item) && "text-muted-foreground"
                      )}
                    >
                      {item.name}
                    </span>
                    <div className="flex items-center gap-1 ml-auto">
                      {item.isPremium && (
                        <Crown
                          className={cn(
                            "h-3 w-3",
                            isPremiumButNoAccess(item)
                              ? "text-muted-foreground"
                              : "text-warning"
                          )}
                        />
                      )}
                      {isPremiumButNoAccess(item) && (
                        <Lock className="h-3 w-3 text-muted-foreground" />
                      )}
                    </div>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex-shrink-0 p-4">
            <button
              onClick={handleLogout}
              className="group flex w-full items-center px-3 py-2 text-sm font-medium text-muted-foreground rounded-md hover:bg-muted hover:text-foreground transition-colors"
            >
              <LogOut className="mr-3 h-5 w-5 text-muted-foreground group-hover:text-foreground" />
              Sair
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
