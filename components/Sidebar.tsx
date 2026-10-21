"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { useSubscription } from "@/lib/hooks/useSubscription";
import { PlanBadge } from "@/components/subscription/PlanGuards";
import {
  ID_MENU_MOBILE,
  MobileMenuClose,
} from "@/components/MobileMenuChrome";
// O array dos itens e o filtro por plano moraram aqui dentro ate a HMO-284; o
// cabecalho daquele arquivo explica por que sairam. O item renderizado abaixo e
// o MESMO objeto dessa lista -- nem o modo papel nem o submenu tem lista
// propria.
import {
  EntradaDoMenu,
  GrupoDeMenu,
  NavigationItem,
  ehGrupo,
  filtrarMenuAgrupado,
  grupoAberto,
  itemAtivoDoMenu,
  menuAgrupado,
  navigation,
  podeVerItem,
} from "@/components/navegacao-do-menu";
import { filtrarMenuDoPapel } from "@/lib/menu-do-papel";
import { useModoPapel } from "@/components/ModoPapelProvider";
import { propsSemPuxao } from "@/lib/puxar-para-atualizar";
import { cn } from "@/lib/utils";
import { User as UserType } from "@supabase/supabase-js";
import { ChevronDown, LogOut, Lock, Crown } from "lucide-react";

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
  // A QUERY STRING, e nao so o caminho (HMO-423): "Contas de Investimento" e
  // `/dashboard/contas?tipo=investment`, a mesma rota de "Contas". Sem ler a
  // query, os dois itens acendem juntos em qualquer uma das duas telas.
  //
  // E por isso que o `<Sidebar />` vive dentro de um `<Suspense>` no layout do
  // painel. Aquela fronteira NAO e exigida hoje (medido: o `next build` passa
  // sem ela, porque o layout nao renderiza nada enquanto a autenticacao
  // carrega); o comentario de la diz por que ela fica.
  const busca = useSearchParams().toString();
  const { hasFeature, subscription, isPremium, planConfig } =
    useSubscription(user);
  const { papel } = useModoPapel();
  // QUAIS GRUPOS O USUARIO ABRIU OU FECHOU A MAO, por nome. O que NAO esta
  // aqui nao e "fechado": e "ainda nao mexi", e ai quem decide e a tela atual
  // (ver `grupoAberto`). Comecar com tudo fechado e um objeto vazio e nao uma
  // lista -- nao ha estado inicial a inventar, e o menu nao precisa de efeito
  // nenhum para se abrir no grupo certo depois de navegar.
  const [gruposMexidos, setGruposMexidos] = useState<Record<string, boolean>>(
    {}
  );

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

  // O MENU TEM DUAS FORMAS (HMO-423), e quem escolhe e o modo papel de pao.
  //
  // DESLIGADO: as 8 entradas de primeiro nivel de `menuAgrupado` -- duas telas
  // soltas e seis grupos que abrem submenu, com as 29 telas dentro.
  //
  // LIGADO: a lista PLANA das 3 telas do modo (eram 8 ate a HMO-466). Submenu
  // num menu de 3 itens seria clique a mais para esconder nada, e o modo promete
  // o contrario. E a lista do modo nao e uma segunda lista: ela sai do mesmo
  // `navigation`, que por sua vez sai do mesmo `menuAgrupado` (ver o cabecalho
  // daquele arquivo).
  //
  // OS DOIS CAMINHOS PASSAM PELO FILTRO DE PLANO, e e o mesmo `podeVerItem` nos
  // dois -- `filtrarMenuAgrupado` o aplica item por item dentro de cada grupo e
  // descarta o grupo que ficou vazio. A ordem entre os dois filtros nao muda o
  // resultado -- os dois so removem -- e esta assim porque le melhor:
  // "do que o plano permite, o que o modo mantem".
  //
  // `papel` e falso enquanto `mounted` for falso, porque e o padrao do
  // provider. Isso e de proposito: o HTML do servidor nao conhece o
  // localStorage, e pintar o menu curto num chute quebraria a hidratacao. Quem
  // usa o modo ve o menu completo por um quadro -- diferente da PELE, que o
  // script inline do `<head>` ja aplicou antes da primeira pintura.
  const entradasDoMenu: readonly EntradaDoMenu[] = papel
    ? filtrarMenuDoPapel(
        navigation.filter((item) => podeVerItem(item, subscription?.plan)),
        papel
      )
    : filtrarMenuAgrupado(menuAgrupado, subscription?.plan);

  // O ITEM ATIVO E UM SO, e ele e o MAIS ESPECIFICO -- `itemAtivoDoMenu` tem a
  // regra e o porque. Calculado UMA vez para o menu inteiro: a decisao depende
  // de todos os `href` juntos (quem ganha de quem), e nao e coisa que cada
  // linha possa responder sozinha olhando so o proprio `href`.
  const hrefAtivo = itemAtivoDoMenu(
    navigation.map((item) => item.href),
    pathname,
    busca
  );

  // ABERTO OU FECHADO e regra PURA, e ela mora em `grupoAberto` (o cabecalho
  // dela tem o porque de cada metade). Aqui fica so a fiacao: o mapa do
  // `useState` e o item ativo entram, e o booleano sai.
  const estaAberto = (grupo: GrupoDeMenu) =>
    grupoAberto(grupo, gruposMexidos, hrefAtivo);

  // O `!grupoAberto(...)` le o mapa que o React entrega ao atualizador, e nao o
  // `gruposMexidos` fechado nesta renderizacao: dois cliques no mesmo quadro
  // (ou em dois grupos diferentes) leriam um mapa velho e um deles se perderia.
  const alternarGrupo = (grupo: GrupoDeMenu) =>
    setGruposMexidos((mexidos) => ({
      ...mexidos,
      [grupo.nome]: !grupoAberto(grupo, mexidos, hrefAtivo),
    }));

  /**
   * UMA LINHA DE TELA, de primeiro nivel ou de dentro de submenu.
   *
   * Esta funcao existe porque o markup do item estava ESCRITO DUAS VEZES neste
   * arquivo (uma no menu de desktop, uma na gaveta do celular) e o submenu
   * acrescentaria uma terceira e uma quarta copia. Duas copias do selo premium
   * e do cadeado divergem na primeira vez que alguem mexer numa delas -- e o
   * celular e o lado que ninguem olha.
   *
   * `recuado` e a unica diferenca entre o item solto e o item de dentro do
   * grupo: ele ganha recuo para a esquerda alinhar com o rotulo do grupo.
   */
  const linhaDoItem = (
    item: NavigationItem,
    { recuado = false, aoClicar }: { recuado?: boolean; aoClicar?: () => void }
  ) => {
    const ativo = item.href === hrefAtivo;
    const semAcesso = isPremiumButNoAccess(item);

    return (
      <Link
        key={item.href}
        href={item.href as Route}
        onClick={aoClicar}
        aria-current={ativo ? "page" : undefined}
        className={cn(
          ativo
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
          "group flex items-center py-2 text-sm font-medium rounded-md transition-colors",
          recuado ? "pl-9 pr-3" : "px-3"
        )}
      >
        <item.icon
          className={cn(
            ativo ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
            "mr-3 flex-shrink-0 h-5 w-5"
          )}
          aria-hidden="true"
        />
        <span className={cn("flex-1", semAcesso && "text-muted-foreground")}>
          {item.name}
        </span>
        <div className="flex items-center gap-1 ml-auto">
          {item.isPremium && (
            <Crown
              className={cn(
                "h-3 w-3",
                semAcesso ? "text-muted-foreground" : "text-warning"
              )}
            />
          )}
          {semAcesso && <Lock className="h-3 w-3 text-muted-foreground" />}
        </div>
      </Link>
    );
  };

  /**
   * O MENU INTEIRO: as entradas de primeiro nivel, com os submenus abertos.
   *
   * O rotulo do grupo e um `<button>`, nao um link: ele nao navega (o grupo nao
   * tem `href` -- ver `GrupoDeMenu`), e por isso tambem nao recebe marcacao de
   * ativo. Quem diz "a tela que voce esta vendo esta aqui dentro" e o item
   * marcado la dentro, com o grupo aberto.
   *
   * O submenu FECHADO nao e renderizado -- nao e `hidden`, nao existe no DOM. Um
   * `hidden` deixaria os 29 links no HTML, e o leitor de tela anunciaria um menu
   * de 29 itens para quem ve 8 (`hidden-no-html-nao-some-do-texto`).
   */
  const menuRenderizado = (aoNavegar?: () => void) =>
    entradasDoMenu.map((entrada) => {
      if (!ehGrupo(entrada)) {
        return linhaDoItem(entrada, { aoClicar: aoNavegar });
      }

      const aberto = estaAberto(entrada);
      const idDoSubmenu = `submenu-${entrada.nome}`;

      return (
        <div key={entrada.nome}>
          <button
            type="button"
            onClick={() => alternarGrupo(entrada)}
            aria-expanded={aberto}
            aria-controls={idDoSubmenu}
            className="group flex w-full items-center px-3 py-2 text-sm font-medium rounded-md transition-colors text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <entrada.icon
              className="mr-3 flex-shrink-0 h-5 w-5 text-muted-foreground group-hover:text-foreground"
              aria-hidden="true"
            />
            <span className="flex-1 text-left">{entrada.nome}</span>
            <ChevronDown
              className={cn(
                "h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform",
                aberto && "rotate-180"
              )}
              aria-hidden="true"
            />
          </button>
          {aberto && (
            <div id={idDoSubmenu} className="mt-1 space-y-1">
              {entrada.itens.map((item) =>
                linhaDoItem(item, { recuado: true, aoClicar: aoNavegar })
              )}
            </div>
          )}
        </div>
      );
    });

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

          {/* O MESMO menu da gaveta do celular, pelo mesmo `menuRenderizado`
              (HMO-423). O markup do item era copiado aqui e la, e o submenu
              dobraria as copias para quatro. */}
          <nav className="mt-8 flex-1 px-3 space-y-1">{menuRenderizado()}</nav>

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

            {/* Aqui o clique no ITEM fecha a gaveta, e o clique no ROTULO do
                grupo NAO: abrir submenu nao e navegar, e fechar a gaveta no
                primeiro clique faria o submenu abrir atras do veu -- o usuario
                tocaria no grupo e a gaveta sumiria sem ele ter ido a lugar
                nenhum. Quem sabe dessa diferenca e o `menuRenderizado`: ele
                passa o `aoNavegar` so para a linha de tela. */}
            <nav className="mt-8 px-3 space-y-1">
              {menuRenderizado(() => setIsMobileMenuOpen(false))}
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
