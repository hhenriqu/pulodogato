"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

interface LoadingScreenProps {
  onLoadingComplete?: () => void;
}

export function LoadingScreen({ onLoadingComplete }: LoadingScreenProps) {
  const [isVisible, setIsVisible] = useState(true);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Simular progresso de carregamento
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => {
            setIsVisible(false);
            onLoadingComplete?.();
          }, 500);
          return 100;
        }
        return prev + Math.random() * 15;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [onLoadingComplete]);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-background to-muted">
      <div className="flex flex-col items-center space-y-8">
        {/* Logo animado */}
        <div className="relative">
          <div className="animate-pulse">
            <Image
              src="/logo_pulodogato.png"
              alt="Pulo do Gato"
              width={120}
              height={120}
              className="drop-shadow-2xl"
              priority
            />
          </div>

          {/* Círculo de progresso */}
          <div className="absolute -inset-4 rounded-full border-4 border-border">
            <svg
              className="absolute inset-0 -rotate-90 transform"
              width="100%"
              height="100%"
              viewBox="0 0 128 128"
            >
              <circle
                cx="64"
                cy="64"
                r="60"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
                className="text-primary"
                strokeDasharray={377}
                strokeDashoffset={377 - (377 * progress) / 100}
                strokeLinecap="round"
                style={{
                  transition: "stroke-dashoffset 0.3s ease-in-out",
                }}
              />
            </svg>
          </div>
        </div>

        {/* Texto de loading */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-foreground">
            Pulo do Gato
          </h1>
          <p className="text-muted-foreground">
            Carregando seus investimentos...
          </p>

          {/* Barra de progresso */}
          <div className="w-64 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary to-premium rounded-full transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="text-sm text-muted-foreground">
            {Math.round(progress)}%
          </div>
        </div>

        {/* Animação de pontos */}
        <div className="flex space-x-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2 h-2 bg-primary rounded-full animate-bounce"
              style={{
                animationDelay: `${i * 0.2}s`,
                animationDuration: "1s",
              }}
            />
          ))}
        </div>
      </div>

      {/* Overlay com fade */}
      <div
        className={`absolute inset-0 bg-black transition-opacity duration-500 ${
          progress >= 100 ? "opacity-0" : "opacity-0"
        }`}
      />
    </div>
  );
}

export default LoadingScreen;
