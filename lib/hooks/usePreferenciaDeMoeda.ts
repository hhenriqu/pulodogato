"use client";

// -----------------------------------------------------------------------------
// A PREFERENCIA DE MOEDA, PARA AS TELAS (HMO-171, parte 2)
// -----------------------------------------------------------------------------
// Tres telas precisam da mesma resposta -- contas, lancamento e os relatorios de
// periodo -- e precisam dela para decidir se MOSTRAM um campo. Por isso o
// carregamento mora num hook, e nao copiado em cada uma.
//
// POR QUE O PADRAO E "DESLIGADO" ENQUANTO CARREGA
// ----------------------------------------------
// O estado inicial e `porLancamento: false`, e isso e uma escolha. O contrario
// -- assumir ligado e esconder depois -- faria o campo de moeda aparecer e
// desaparecer em toda abertura de formulario, e no caminho de falha da rede ele
// ficaria visivel para quem nunca ligou o recurso. Um campo que pisca e pior que
// um campo que chega um instante depois.
//
// POR QUE ELE NAO DERRUBA A TELA QUANDO A LEITURA FALHA
// ----------------------------------------------------
// A preferencia decide a APARENCIA de um campo opcional. Um erro aqui nao pode
// impedir alguem de lancar uma despesa: o app e um PWA usado no celular, e
// offline esta rota nao responde. Falha cai no padrao em silencio (com log), e a
// pessoa lanca em reais -- que e o que ela faria de qualquer forma se nunca
// tivesse ligado o recurso.
// -----------------------------------------------------------------------------

import { useEffect, useState } from "react";
import {
  PREFERENCIA_DE_MOEDA_PADRAO,
  lerPreferenciaDeMoeda,
  type PreferenciaDeMoeda,
} from "@/lib/moeda";

export function usePreferenciaDeMoeda(): {
  moeda: PreferenciaDeMoeda;
  carregando: boolean;
} {
  const [moeda, setMoeda] = useState<PreferenciaDeMoeda>({
    ...PREFERENCIA_DE_MOEDA_PADRAO,
  });
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const r = await fetch("/api/settings/currency");
        if (r.ok) {
          const d = await r.json();
          if (!ativo) return;
          // Passa por `lerPreferenciaDeMoeda` de novo, apesar de a rota ja
          // normalizar. Esta tela nao pode depender disso: a resposta pode vir
          // do cache offline do service worker (que guarda /api/ por 24h) e ser
          // de uma versao anterior do formato.
          setMoeda(lerPreferenciaDeMoeda({ moeda: d.moeda }));
        }
      } catch (erro) {
        console.error("Erro ao ler a preferência de moeda:", erro);
      } finally {
        if (ativo) setCarregando(false);
      }
    })();
    return () => {
      ativo = false;
    };
  }, []);

  return { moeda, carregando };
}
