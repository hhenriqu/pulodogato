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
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-card border-b shadow-sm">
        <div className="flex items-center justify-between px-4 py-3">
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

      {/* Desktop Header */}
      <div className="hidden lg:block lg:pl-64 fixed top-0 left-0 right-0 z-30">
        <div className="bg-card border-b shadow-sm">
          <div className="flex items-center justify-end gap-1 px-6 py-3">
            <ThemeToggle />
            <NotificationBell user={user} />
          </div>
        </div>
      </div>
    </>
  );
}
