"use client";

import { useCallback, useEffect, useState } from "react";
import { Share, SquarePlus } from "lucide-react";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { useAppLoading } from "@/lib/hooks/useAppLoading";
import { DeviceAdapter } from "@/lib/hooks/useDeviceDetection";
import {
  CHAVE_DISPENSA,
  decidirConvite,
  detectarIOS,
  lerDispensa,
  type ConviteDeInstalacao,
} from "@/lib/pwa-install";

interface PWAWrapperProps {
  children: React.ReactNode;
}

export function PWAWrapper({ children }: PWAWrapperProps) {
  const { isLoading, hideLoading } = useAppLoading({
    minLoadingTime: 1500,
    enableOnFirstVisit: true,
  });

  const [convite, setConvite] = useState<ConviteDeInstalacao>("nenhum");
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    // Recalcula do zero a cada mudanca. Manter dois booleanos separados
    // ("e instalavel" e "e iOS") deixaria os dois banners aparecerem juntos no
    // dia em que um navegador no iOS passar a emitir o evento.
    const recalcular = (prompt: any) => {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as any).standalone === true;

      setConvite(
        decidirConvite({
          standalone,
          ehIOS: detectarIOS(window.navigator),
          temPromptNativo: prompt !== null,
          dispensadoEm: lerDispensa(window.localStorage),
          agora: Date.now(),
        })
      );
    };

    const aoReceberPrompt = (e: Event) => {
      // O preventDefault impede a barra de instalacao propria do Chrome, para
      // ela nao competir com este banner.
      e.preventDefault();
      setDeferredPrompt(e);
      recalcular(e);
    };

    const aoInstalar = () => {
      setDeferredPrompt(null);
      setConvite("nenhum");
    };

    window.addEventListener("beforeinstallprompt", aoReceberPrompt);
    window.addEventListener("appinstalled", aoInstalar);

    // A primeira avaliacao nao pode esperar o evento: no iOS ele nunca chega,
    // e era exatamente ai que o convite se perdia.
    recalcular(null);

    return () => {
      window.removeEventListener("beforeinstallprompt", aoReceberPrompt);
      window.removeEventListener("appinstalled", aoInstalar);
    };
  }, []);

  const dispensar = useCallback(() => {
    setConvite("nenhum");
    try {
      window.localStorage.setItem(CHAVE_DISPENSA, String(Date.now()));
    } catch {
      // Navegacao privada no Safari recusa a escrita. O convite volta na
      // proxima visita, o que e melhor que derrubar a pagina.
    }
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === "accepted") {
      setDeferredPrompt(null);
      setConvite("nenhum");
    }
  };

  return (
    <DeviceAdapter>
      {isLoading && <LoadingScreen onLoadingComplete={hideLoading} />}

      {/* Convite de instalacao. O banner com botao so serve onde o navegador
          entrega o prompt do sistema; no iOS a instalacao e manual, entao la
          o convite vira instrucao. */}
      {convite === "nativo" && (
        <div className="fixed bottom-4 left-4 right-4 z-40 bg-primary text-primary-foreground p-4 rounded-lg shadow-lg flex items-center justify-between safe-area-padding">
          <div className="flex-1">
            <p className="font-medium">Instalar Pulo do Gato</p>
            <p className="text-sm opacity-90">
              Adicione à tela inicial para acesso rápido
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={dispensar}
              className="px-3 py-1 text-sm bg-primary-foreground/20 rounded hover:bg-primary-foreground/30 transition-colors"
            >
              Agora não
            </button>
            <button
              onClick={handleInstallClick}
              className="px-3 py-1 text-sm bg-primary-foreground text-primary rounded hover:bg-primary-foreground/90 transition-colors font-medium"
            >
              Instalar
            </button>
          </div>
        </div>
      )}

      {convite === "ios" && (
        <div className="fixed bottom-4 left-4 right-4 z-40 bg-primary text-primary-foreground p-4 rounded-lg shadow-lg safe-area-padding">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <p className="font-medium">Instalar Pulo do Gato</p>
              {/* Os icones sao os mesmos do Safari, na ordem em que aparecem na
                  tela: sem eles a instrucao vira um texto que o usuario le e
                  nao consegue seguir, porque os botoes do iOS nao tem nome. */}
              <p className="text-sm opacity-90 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span>No Safari, toque em</span>
                <Share className="h-4 w-4 shrink-0" aria-label="Compartilhar" />
                <span>Compartilhar e depois em</span>
                <SquarePlus className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Adicionar à Tela de Início.</span>
              </p>
            </div>
            <button
              onClick={dispensar}
              className="px-3 py-1 text-sm bg-primary-foreground/20 rounded hover:bg-primary-foreground/30 transition-colors shrink-0"
            >
              Agora não
            </button>
          </div>
        </div>
      )}

      {children}
    </DeviceAdapter>
  );
}
