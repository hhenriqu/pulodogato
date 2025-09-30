"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { useSubscription } from "@/lib/hooks/useSubscription";
import { PlanFeature, UserPlan } from "@/types/subscription";
import { PlanBadge } from "@/components/subscription/PlanGuards";
import { cn } from "@/lib/utils";
import { User as UserType } from "@supabase/supabase-js";
import {
  LayoutDashboard,
  TrendingUp,
  ArrowLeftRight,
  BarChart3,
  User,
  Users,
  Settings,
  LogOut,
  Menu,
  X,
  Wallet,
  Target,
  Lock,
  Crown,
  Zap,
  Shield,
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
    name: "Investimentos",
    href: "/dashboard/investments",
    icon: TrendingUp,
    requiredFeature: "investment_tracking",
    isPremium: true,
  },
  {
    name: "Metas",
    href: "/dashboard/goals",
    icon: Target,
    requiredFeature: "financial_goals",
  },
  {
    name: "Transações",
    href: "/dashboard/transactions",
    icon: ArrowLeftRight,
    requiredFeature: "personal_finance",
  },
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
        <div className="flex flex-col flex-grow pt-5 bg-white overflow-y-auto border-r">
          <div className="flex flex-col flex-shrink-0 px-6 space-y-4">
            <h1 className="text-xl font-bold text-gray-900">PulodoGato</h1>
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
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
                    "group flex items-center px-3 py-2 text-sm font-medium rounded-l-md transition-colors"
                  )}
                >
                  <item.icon
                    className={cn(
                      isActive
                        ? "text-primary"
                        : "text-gray-400 group-hover:text-gray-500",
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
                            : "text-yellow-500"
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
              className="group flex w-full items-center px-3 py-2 text-sm font-medium text-gray-600 rounded-md hover:bg-gray-50 hover:text-gray-900 transition-colors"
            >
              <LogOut className="mr-3 h-5 w-5 text-gray-400 group-hover:text-gray-500" />
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
            "fixed inset-0 bg-gray-600 bg-opacity-75 transition-opacity",
            isMobileMenuOpen ? "opacity-100" : "opacity-0"
          )}
          onClick={() => setIsMobileMenuOpen(false)}
        />

        <div
          className={cn(
            "relative flex-1 flex flex-col max-w-xs w-full bg-white transition-transform",
            isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="absolute top-0 right-0 -mr-12 pt-2">
            <button
              onClick={() => setIsMobileMenuOpen(false)}
              className="ml-1 flex items-center justify-center h-10 w-10 rounded-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white"
            >
              <X className="h-6 w-6 text-white" />
            </button>
          </div>

          <div className="flex-1 h-0 pt-5 pb-4 overflow-y-auto">
            <div className="flex flex-col flex-shrink-0 px-6 space-y-4">
              <h1 className="text-xl font-bold text-gray-900">PulodoGato</h1>
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
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
                      "group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors"
                    )}
                  >
                    <item.icon
                      className={cn(
                        isActive
                          ? "text-primary"
                          : "text-gray-400 group-hover:text-gray-500",
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
                              : "text-yellow-500"
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
              className="group flex w-full items-center px-3 py-2 text-sm font-medium text-gray-600 rounded-md hover:bg-gray-50 hover:text-gray-900 transition-colors"
            >
              <LogOut className="mr-3 h-5 w-5 text-gray-400 group-hover:text-gray-500" />
              Sair
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
