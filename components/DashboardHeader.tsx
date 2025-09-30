"use client";

import { User } from "@supabase/supabase-js";
import { NotificationBell } from "@/components/ui/notifications";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

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
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b shadow-sm">
        <div className="flex items-center justify-between px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? (
              <X className="h-6 w-6" />
            ) : (
              <Menu className="h-6 w-6" />
            )}
          </Button>

          <h1 className="text-lg font-bold text-gray-900">PulodoGato</h1>

          <NotificationBell user={user} />
        </div>
      </div>

      {/* Desktop Header */}
      <div className="hidden lg:block lg:pl-64 fixed top-0 left-0 right-0 z-30">
        <div className="bg-white border-b shadow-sm">
          <div className="flex items-center justify-end px-6 py-3">
            <NotificationBell user={user} />
          </div>
        </div>
      </div>
    </>
  );
}
