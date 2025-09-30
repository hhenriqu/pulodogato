"use client";

import { useEffect, useState } from "react";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { useAppLoading } from "@/lib/hooks/useAppLoading";
import { DeviceAdapter } from "@/lib/hooks/useDeviceDetection";

interface PWAWrapperProps {
  children: React.ReactNode;
}

export function PWAWrapper({ children }: PWAWrapperProps) {
  const { isLoading, hideLoading } = useAppLoading({
    minLoadingTime: 1500,
    enableOnFirstVisit: true,
  });

  const [isInstallable, setIsInstallable] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    // Detectar se o PWA pode ser instalado
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // Detectar quando o PWA é instalado
    window.addEventListener("appinstalled", () => {
      setIsInstallable(false);
      setDeferredPrompt(null);
    });

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
      );
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === "accepted") {
      setDeferredPrompt(null);
      setIsInstallable(false);
    }
  };

  return (
    <DeviceAdapter>
      {isLoading && <LoadingScreen onLoadingComplete={hideLoading} />}

      {/* Install Banner */}
      {isInstallable && (
        <div className="fixed bottom-4 left-4 right-4 z-40 bg-blue-500 text-white p-4 rounded-lg shadow-lg flex items-center justify-between safe-area-padding">
          <div className="flex-1">
            <p className="font-medium">Instalar Pulo do Gato</p>
            <p className="text-sm opacity-90">
              Adicione à tela inicial para acesso rápido
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setIsInstallable(false)}
              className="px-3 py-1 text-sm bg-white/20 rounded hover:bg-white/30 transition-colors"
            >
              Agora não
            </button>
            <button
              onClick={handleInstallClick}
              className="px-3 py-1 text-sm bg-white text-blue-500 rounded hover:bg-gray-100 transition-colors font-medium"
            >
              Instalar
            </button>
          </div>
        </div>
      )}

      {children}
    </DeviceAdapter>
  );
}
