"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";
import Sidebar from "@/components/Sidebar";
import { DashboardHeader } from "@/components/DashboardHeader";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/*
        IMPRESSAO: o "Salvar em PDF" da tela de relatorios e um window.print(),
        entao o que estiver visivel aqui entra no PDF. A navegacao tem que sair,
        e ela NAO pode sair pela pagina: header e sidebar sao renderizados por
        este layout, fora da arvore da pagina, que por isso nao alcanca nenhum
        dos dois. Sem os `print:` abaixo o relatorio sai com o menu do app
        atravessado no meio e recuado 16rem por causa do `lg:pl-64`.

        A ordem do CSS e o que faz o `print:hidden` ganhar do `lg:flex` do
        Sidebar: o Tailwind emite o bloco `@media print` DEPOIS do bloco das
        telas, e com a mesma especificidade quem vem depois vence.
      */}
      <div className="print:hidden">
        <DashboardHeader
          user={user}
          isMobileMenuOpen={isMobileMenuOpen}
          setIsMobileMenuOpen={setIsMobileMenuOpen}
        />

        <Sidebar
          isMobileMenuOpen={isMobileMenuOpen}
          setIsMobileMenuOpen={setIsMobileMenuOpen}
        />
      </div>

      {/* Main content */}
      <div className="lg:pl-64 print:pl-0">
        {/* Espaço para o header fixo -- no papel nao ha header fixo. */}
        <div className="h-16 lg:h-12 print:hidden"></div>
        <main className="py-6 px-4 sm:px-6 lg:px-8 print:p-0">{children}</main>
      </div>
    </div>
  );
}
