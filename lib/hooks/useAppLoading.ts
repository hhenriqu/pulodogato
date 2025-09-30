"use client";

import { useEffect, useState } from "react";

interface UseAppLoadingOptions {
  minLoadingTime?: number;
  enableOnFirstVisit?: boolean;
}

export function useAppLoading({
  minLoadingTime = 2000,
  enableOnFirstVisit = true,
}: UseAppLoadingOptions = {}) {
  const [isLoading, setIsLoading] = useState(false);
  const [isFirstVisit, setIsFirstVisit] = useState(false);

  useEffect(() => {
    // Verificar se é a primeira visita
    const hasVisited = localStorage.getItem("pwa-has-visited");
    const shouldShowLoading = enableOnFirstVisit && !hasVisited;

    if (shouldShowLoading) {
      setIsFirstVisit(true);
      setIsLoading(true);

      // Marcar como visitado
      localStorage.setItem("pwa-has-visited", "true");

      // Tempo mínimo de loading
      const timer = setTimeout(() => {
        setIsLoading(false);
      }, minLoadingTime);

      return () => clearTimeout(timer);
    }
  }, [minLoadingTime, enableOnFirstVisit]);

  const showLoading = () => setIsLoading(true);
  const hideLoading = () => setIsLoading(false);

  return {
    isLoading,
    isFirstVisit,
    showLoading,
    hideLoading,
  };
}
