"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";
import Sidebar from "@/components/Sidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { OfflineBanner } from "@/components/OfflineBanner";
import { PuxarParaAtualizar } from "@/components/PuxarParaAtualizar";

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
      <div className="min-h-app flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    // `min-h-app` e nao `min-h-screen`: no Safari do iPhone `100vh` conta a
    // tela COM a barra de endereco recolhida, uma altura que a pagina so tem
    // depois de rolar (ver app/globals.css).
    <div className="min-h-app bg-background">
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
        {/*
          Espaço para o header fixo -- no papel nao ha header fixo.

          Era `h-16 lg:h-12`: dois numeros escritos a mao, e os dois errados.
          O header mede 65px nos dois tamanhos (medido em producao), entao o
          celular reservava 1px a menos e o DESKTOP 17px a menos -- toda
          pagina do painel comecava debaixo do header. E nenhum dos dois
          somava o recorte do topo do iPhone, que e o que jogava o header por
          cima do relogio.

          `app-header-offset` sai de `--app-header + --safe-top`, a mesma
          variavel que DashboardHeader usa para se medir.
        */}
        <div className="app-header-offset print:hidden"></div>
        {/*
          O aviso de "sem conexao / lancamentos esperando" mora aqui, e nao
          dentro de cada tela, por dois motivos: ele vale para o app inteiro, e
          o layout e o unico lugar que continua montado quando a pessoa navega
          entre as telas -- dentro de uma pagina o aviso sumiria e voltaria a
          cada clique, junto com a releitura da fila.

          Ele se esconde sozinho quando ha rede e a fila esta vazia.
        */}
        <OfflineBanner />
        {/*
          Puxar para atualizar (HMO-201). Mora no layout pela mesma razao do
          OfflineBanner: e o unico lugar que continua montado entre as telas,
          e o gesto tem que valer no app inteiro -- nao numa pagina so.

          Instalado como PWA em tela cheia o iOS nao da barra de endereco,
          botao de recarregar nem gesto nativo: sem isto nao ha NENHUMA forma
          de pedir dados novos.
        */}
        <PuxarParaAtualizar />
        {/*
          O `pb-` soma o recorte de baixo aos 1.5rem originais: no iPhone sem
          botao fisico ha uma barra de gesto de 34px sobre o rodape da pagina,
          e o ultimo botao de cada tela ficava debaixo dela.
        */}
        <main className="pt-6 pb-[calc(1.5rem_+_var(--safe-bottom))] px-4 sm:px-6 lg:px-8 print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
