"use client";

import { User } from "@supabase/supabase-js";
import { NotificationBell } from "@/components/ui/notifications";
import { MobileMenuToggle } from "@/components/MobileMenuChrome";
import { ThemeToggle } from "@/components/ThemeToggle";

interface DashboardHeaderProps {
  user: User | null;
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
}

export function DashboardHeader({
  user,
  isMobileMenuOpen,
  setIsMobileMenuOpen,
}: DashboardHeaderProps) {
  return (
    <>
      {/*
        Mobile Header.

        `pt-safe px-safe` e o que impede o conteudo da barra de ir parar
        debaixo do relogio do iPhone (HMO-185): a caixa continua ancorada em
        `top-0` -- e tem que continuar, senao aparece uma faixa transparente
        acima dela -- mas o RECHEIO desce a altura do recorte. O fundo pinta a
        area do notch, o botao e o titulo ficam abaixo dela.

        A barra tem `h-16` declarado no lugar do `py-3` de antes. Com `py-3` a
        altura era 24px mais o que estivesse dentro, e "o que estivesse
        dentro" muda: `.device-mobile button` pede 44px de minimo, um icone
        maior mudaria de novo. O espacador do layout precisa saber essa altura
        de antemao, entao ela passa a ser declarada, nao consequencia.
      */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-card border-b shadow-sm pt-safe px-safe">
        <div className="flex items-center justify-between px-4 h-16">
          <MobileMenuToggle
            aberto={isMobileMenuOpen}
            onToggle={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          />

          <h1 className="text-lg font-bold text-foreground">PulodoGato</h1>

          <div className="flex items-center gap-1">
            <ThemeToggle />
            <NotificationBell user={user} />
          </div>
        </div>
      </div>

      {/*
        Desktop Header. Mesma altura declarada do celular, pelo mesmo motivo:
        os dois compartilham o espacador `--app-header`, e ele nao tem como
        reservar duas alturas diferentes. O iPad deitado cai neste ramo com
        recorte lateral, por isso o `pt-safe px-safe` tambem esta aqui.
      */}
      <div className="hidden lg:block lg:pl-64 fixed top-0 left-0 right-0 z-30 pt-safe px-safe">
        <div className="bg-card border-b shadow-sm">
          <div className="flex items-center justify-end gap-1 px-6 h-16">
            <ThemeToggle />
            <NotificationBell user={user} />
          </div>
        </div>
      </div>
    </>
  );
}
