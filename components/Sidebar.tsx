"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { useSubscription } from "@/lib/hooks/useSubscription";
import { PlanBadge } from "@/components/subscription/PlanGuards";
import {
  ID_MENU_MOBILE,
  MobileMenuClose,
} from "@/components/MobileMenuChrome";
// O array dos 27 itens e o filtro por plano moraram aqui dentro ate a HMO-284;
// o cabecalho daquele arquivo explica por que sairam. O item renderizado abaixo
// e o MESMO objeto dessa lista -- o modo papel nao tem lista propria.
import {
  NavigationItem,
  navigation,
  podeVerItem,
} from "@/components/navegacao-do-menu";
import { filtrarMenuDoPapel } from "@/lib/menu-do-papel";
import { useModoPapel } from "@/components/ModoPapelProvider";
import { propsSemPuxao } from "@/lib/puxar-para-atualizar";
import { cn } from "@/lib/utils";
import { User as UserType } from "@supabase/supabase-js";
import { LogOut, Lock, Crown } from "lucide-react";

interface SidebarProps {
  isMobileMenuOpen?: boolean;
  setIsMobileMenuOpen?: (open: boolean) => void;
}

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
  const { hasFeature, subscription, isPremium, planConfig } =
    useSubscription(user);
  const { papel } = useModoPapel();

  useEffect(() => {
    // `createClient()` dentro de quem usa, e nao no corpo do componente: assim
    // o efeito nao ganha `supabase` como dependencia. Satisfazer a dependencia
    // sem isto so e seguro porque `utils/supabase/client.ts` reaproveita um
    // cliente por aba -- e esse e um detalhe de OUTRO arquivo, que este efeito
    // nao deveria ter que conhecer para nao entrar em laco.
    const getUser = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);
    };
    getUser();
  }, []);

  const handleLogout = async () => {
    await createClient().auth.signOut();
    window.location.href = "/login";
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

  // OS DOIS FILTROS, sobre o MESMO array, nesta ordem.
  //
  // O primeiro e o plano, que ja existia. O segundo e o modo papel de pao
  // (HMO-284): com ele ligado sobram 8 itens dos 27 -- eram 5 na HMO-284, 7 com
  // a HMO-294 e 8 com a HMO-299, e quem manda e `ROTAS_DO_MENU_DE_PAPEL`, nao
  // este numero. A ordem entre os dois filtros nao muda o resultado -- os dois
  // so removem -- e esta assim porque le melhor:
  // "do que o plano permite, o que o modo mantem".
  //
  // `papel` e falso enquanto `mounted` for falso, porque e o padrao do
  // provider. Isso e de proposito: o HTML do servidor nao conhece o
  // localStorage, e pintar o menu curto num chute quebraria a hidratacao. Quem
  // usa o modo ve o menu completo por um quadro -- diferente da PELE, que o
  // script inline do `<head>` ja aplicou antes da primeira pintura.
  const filteredNavigation = filtrarMenuDoPapel(
    navigation.filter((item) => podeVerItem(item, subscription?.plan)),
    papel
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <div className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 pl-safe">
        <div className="flex flex-col flex-grow pt-[calc(1.25rem_+_var(--safe-top))] pb-[var(--safe-bottom)] bg-card overflow-y-auto border-r">
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
                  href={item.href as Route}
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
        // Puxar para atualizar nao vale aqui dentro (HMO-206). Rolar a lista
        // de itens abaixo era lido como puxao no topo da pagina -- a pagina
        // atras da gaveta esta sempre em scroll 0 -- e recarregava o app no
        // meio da navegacao.
        //
        // O marcador vai na raiz que contem o VEU e o painel, e nao so na
        // lista que rola: o X, o rodape com "Sair" e o proprio veu ficam fora
        // dela, e numa tela alta a lista pode nem transbordar.
        //
        // Com o menu fechado isto nao desliga nada: o `pointer-events-none`
        // abaixo tira esta subarvore inteira do teste de toque, entao ela nem
        // aparece no caminho do gesto.
        {...propsSemPuxao()}
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
            "relative flex-1 flex flex-col max-w-xs w-full bg-card transition-transform pl-safe",
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

          {/* O recorte do topo entra somado aos 1.25rem: a gaveta e `fixed
              inset-0`, entao ela tambem comeca em y=0, debaixo do relogio do
              iPhone -- o "PulodoGato" do menu saia no mesmo lugar em que saia
              o do header (HMO-185). O de baixo afasta o botao "Sair" da barra
              de gesto. */}
          <div className="flex-1 h-0 pt-[calc(1.25rem_+_var(--safe-top))] pb-[calc(1rem_+_var(--safe-bottom))] overflow-y-auto">
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
                    href={item.href as Route}
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
