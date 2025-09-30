"use client";

import { useEffect, useState } from "react";

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
      (window.navigator as any).standalone === true ||
      document.referrer.includes("android-app://");

    // Detectar standalone mode
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;

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

    // CSS customizado para iOS
    if (device.isIOS && device.hasNotch) {
      document.documentElement.style.setProperty(
        "--safe-area-inset-top",
        "env(safe-area-inset-top, 44px)"
      );
      document.documentElement.style.setProperty(
        "--safe-area-inset-bottom",
        "env(safe-area-inset-bottom, 34px)"
      );
    }

    // Prevenir zoom no iOS para inputs
    if (device.isIOS) {
      const meta = document.querySelector(
        'meta[name="viewport"]'
      ) as HTMLMetaElement;
      if (meta) {
        meta.content =
          "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
      }
    }
  }, [device]);

  return <>{children}</>;
}
