"use client";

import { useEffect, useState } from "react";
import type { NavegadorIOS } from "@/lib/pwa-install";

interface DeviceInfo {
  isIOS: boolean;
  isAndroid: boolean;
  isDesktop: boolean;
  isMobile: boolean;
  isTablet: boolean;
  isPWA: boolean;
  isStandalone: boolean;
  hasNotch: boolean;
  orientation: "portrait" | "landscape";
}

export function useDeviceDetection(): DeviceInfo {
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo>({
    isIOS: false,
    isAndroid: false,
    isDesktop: false,
    isMobile: false,
    isTablet: false,
    isPWA: false,
    isStandalone: false,
    hasNotch: false,
    orientation: "portrait",
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const userAgent = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(userAgent);
    const isAndroid = /Android/.test(userAgent);
    const isMobile = /Mobi|Android/i.test(userAgent);
    const isTablet =
      /iPad/.test(userAgent) ||
      (/Android/.test(userAgent) && !/Mobile/.test(userAgent));
    const isDesktop = !isMobile && !isTablet;

    // Detectar PWA
    const isPWA =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as NavegadorIOS).standalone === true ||
      document.referrer.includes("android-app://");

    // Detectar standalone mode
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as NavegadorIOS).standalone === true;

    // Detectar notch (iPhone X e superior)
    const hasNotch =
      (isIOS && window.screen.height === 812 && window.screen.width === 375) || // iPhone X/XS
      (window.screen.height === 896 && window.screen.width === 414) || // iPhone XR/XS Max
      (window.screen.height === 844 && window.screen.width === 390) || // iPhone 12/13 mini
      (window.screen.height === 926 && window.screen.width === 428) || // iPhone 12/13 Pro Max
      window.CSS?.supports("padding-top: env(safe-area-inset-top)");

    // Detectar orientação
    const getOrientation = (): "portrait" | "landscape" => {
      return window.innerHeight > window.innerWidth ? "portrait" : "landscape";
    };

    const updateDeviceInfo = () => {
      setDeviceInfo({
        isIOS,
        isAndroid,
        isDesktop,
        isMobile,
        isTablet,
        isPWA,
        isStandalone,
        hasNotch,
        orientation: getOrientation(),
      });
    };

    updateDeviceInfo();

    // Listener para mudança de orientação
    window.addEventListener("resize", updateDeviceInfo);
    window.addEventListener("orientationchange", updateDeviceInfo);

    return () => {
      window.removeEventListener("resize", updateDeviceInfo);
      window.removeEventListener("orientationchange", updateDeviceInfo);
    };
  }, []);

  return deviceInfo;
}

interface DeviceAdapterProps {
  children: React.ReactNode;
}

export function DeviceAdapter({ children }: DeviceAdapterProps) {
  const device = useDeviceDetection();

  useEffect(() => {
    // Aplicar classes CSS baseadas no dispositivo
    const classes = [];

    if (device.isIOS) classes.push("device-ios");
    if (device.isAndroid) classes.push("device-android");
    if (device.isDesktop) classes.push("device-desktop");
    if (device.isMobile) classes.push("device-mobile");
    if (device.isTablet) classes.push("device-tablet");
    if (device.isPWA) classes.push("device-pwa");
    if (device.isStandalone) classes.push("device-standalone");
    if (device.hasNotch) classes.push("device-notch");
    classes.push(`device-${device.orientation}`);

    // Remover classes anteriores
    document.body.className = document.body.className
      .split(" ")
      .filter((c) => !c.startsWith("device-"))
      .join(" ");

    // Adicionar novas classes
    document.body.classList.add(...classes);

    // SAIRAM DAQUI DUAS ESCRITAS NO DOM, as duas da HMO-185.
    //
    // 1. `--safe-area-inset-top` / `--safe-area-inset-bottom` no <html>.
    //    Ninguem lia as duas -- nenhuma folha de estilo do repositorio as
    //    mencionava. E elas eram gravadas so quando a deteccao de notch
    //    acertava, isto e, o recorte dependia de adivinhar o aparelho por
    //    User-Agent. Hoje quem declara o recorte e app/globals.css, em
    //    `--safe-top` e irmas, direto de `env()`: o proprio iOS responde, sem
    //    palpite e sem esperar o JS montar.
    //
    // 2. a reescrita da meta viewport para `maximum-scale=1,
    //    user-scalable=no`. Ela apagava, so no iPhone, o que
    //    `export const viewport` de app/layout.tsx declara
    //    (`maximumScale: 5, userScalable: true`) -- duas fontes para o mesmo
    //    valor, e quem vencia era esta, a que nao esta no arquivo onde se vai
    //    procurar. O efeito era proibir o usuario de dar zoom no app
    //    instalado (falha de acessibilidade WCAG 1.4.4).
    //
    //    O objetivo declarado dela, "prevenir zoom no iOS para inputs", ja
    //    era atendido sem custo nenhum por `.device-ios input { font-size:
    //    16px }` em globals.css: o Safari so dá o zoom automatico quando a
    //    fonte do campo e menor que 16px. Proibir o gesto era matar o zoom
    //    inteiro para resolver um caso que ja estava resolvido.
  }, [device]);

  return <>{children}</>;
}
