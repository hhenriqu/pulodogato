"use client";

// =====================================================
// `navigator.onLine`, USADO SO PARA O QUE ELE SERVE
// =====================================================
// Este valor e confiavel no NEGATIVO e otimista no positivo: `false` quer
// dizer que o aparelho nao tem interface de rede ativa, e ai nada vai sair
// mesmo; `true` so quer dizer que ha uma interface -- o wi-fi do hotel com
// portal de login diz `true` com o pacote morrendo no primeiro salto.
//
// Por isso ele NAO decide o que a tela mostra: quem decide isso e a evidencia
// da requisicao que ja aconteceu (`lib/offline-leitura.ts`). Aqui ele serve
// para uma coisa so, que usa exatamente o lado confiavel: desabilitar o botao
// que abre um formulario de cadastro. `false` garante que o envio falharia, e
// deixar a pessoa preencher oito campos para perde-los no fim e pior do que
// dizer antes que agora nao da.
//
// Separado do `useOfflineQueue`, que tambem expoe `online`: aquele hook abre o
// IndexedDB e sincroniza a fila. Uma tela de leitura que so precisa saber se
// ha rede nao deve carregar nada disso junto.
// =====================================================

import { useEffect, useState } from "react";

export function useEstaOnline(): boolean {
  // Comeca `true` de proposito, como no `useOfflineQueue`: no servidor nao
  // existe `navigator`, e comecar `false` faria o aviso de offline piscar na
  // primeira pintura de toda visita -- inclusive das visitas com rede.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const atualizar = () => setOnline(navigator.onLine);

    // Antes dos ouvintes: quem abre a tela ja offline nunca recebe o evento
    // `offline`, porque ele ja aconteceu. Sem esta leitura o estado ficaria
    // `true` para sempre exatamente em quem esta sem rede.
    atualizar();

    window.addEventListener("online", atualizar);
    window.addEventListener("offline", atualizar);
    return () => {
      window.removeEventListener("online", atualizar);
      window.removeEventListener("offline", atualizar);
    };
  }, []);

  return online;
}
