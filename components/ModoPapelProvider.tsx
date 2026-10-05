"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_MODO_PAPEL,
  MODO_PAPEL_STORAGE_KEY,
  ModoPapel,
  alternarModoPapel,
  aplicarModoPapel,
  gravarModoPapel,
  isModoPapel,
  lerModoPapel,
  papelAtivo,
} from "@/lib/modo-papel";

interface ModoPapelContextValue {
  /** A escolha salva. */
  modo: ModoPapel;
  /** Atalho de leitura: o modo esta ligado? */
  papel: boolean;
  setModo: (modo: ModoPapel) => void;
  /** Liga se estiver desligado, e vice-versa. E o que o papelzinho chama. */
  alternar: () => void;
  /**
   * false ate o primeiro efeito no cliente. Quem pinta algo que depende do modo
   * (o icone do interruptor, o estado do Switch) precisa esperar: no servidor
   * nao da para ler o localStorage, e renderizar um chute quebra a hidratacao.
   */
  mounted: boolean;
}

const ModoPapelContext = createContext<ModoPapelContextValue | null>(null);

export function ModoPapelProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Comeca no padrao para o primeiro render bater com o HTML do servidor, que
  // nao conhece o localStorage. A TELA ja esta certa nesse meio-tempo: quem
  // aplicou a classe `papel` foi o PAPEL_INIT_SCRIPT, antes da primeira
  // pintura. E a mesma divisao de trabalho do ThemeProvider.
  const [modo, setModoState] = useState<ModoPapel>(DEFAULT_MODO_PAPEL);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setModoState(lerModoPapel());
    setMounted(true);
  }, []);

  // Reaplica no <html> a cada mudanca. No primeiro render nao faz nada de novo
  // (o script inline ja deixou o DOM assim), mas mantem o DOM como fonte unica
  // da verdade depois de cada troca -- inclusive quando ela vem de outra aba.
  useEffect(() => {
    if (!mounted) return;
    aplicarModoPapel(modo);
  }, [modo, mounted]);

  // O app e um PWA e costuma ficar aberto em mais de uma aba; ligar o modo em
  // uma delas deve valer nas outras, como ja vale para o tema.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== MODO_PAPEL_STORAGE_KEY) return;
      setModoState(isModoPapel(event.newValue) ? event.newValue : DEFAULT_MODO_PAPEL);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setModo = useCallback((proximo: ModoPapel) => {
    setModoState(proximo);
    // Aplica direto, sem esperar o efeito: a troca precisa ser instantanea no
    // clique, senao a tela fica um quadro inteiro na pele antiga.
    aplicarModoPapel(proximo);
    gravarModoPapel(proximo);
  }, []);

  const alternar = useCallback(() => {
    // Le o estado pelo setter em vez de fechar sobre `modo`: dois cliques
    // rapidos no papelzinho leriam o MESMO valor antigo e o segundo nao faria
    // nada. A classe no <html> e gravada aqui dentro pelo mesmo motivo.
    setModoState((atual) => {
      const proximo = alternarModoPapel(atual);
      aplicarModoPapel(proximo);
      gravarModoPapel(proximo);
      return proximo;
    });
  }, []);

  const value = useMemo<ModoPapelContextValue>(
    () => ({ modo, papel: papelAtivo(modo), setModo, alternar, mounted }),
    [modo, setModo, alternar, mounted]
  );

  return (
    <ModoPapelContext.Provider value={value}>
      {children}
    </ModoPapelContext.Provider>
  );
}

export function useModoPapel(): ModoPapelContextValue {
  const context = useContext(ModoPapelContext);
  if (!context) {
    throw new Error("useModoPapel precisa estar dentro de <ModoPapelProvider>");
  }
  return context;
}
