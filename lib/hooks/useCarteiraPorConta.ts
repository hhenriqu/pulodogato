"use client";

// ---------------------------------------------------------------------------
// AS DUAS IDAS QUE COMPOEM A CARTEIRA, NUM HOOK (HMO-438, F4 da HMO-432)
// ---------------------------------------------------------------------------
// `GET /api/investments` e `GET /api/investments/renda-fixa` sao duas rotas
// porque a Fase 2 separou quem fala com o Banco Central de quem nao fala. Duas
// telas precisam do par (`/dashboard/investments` e `/dashboard/contas`), e e
// por isso que a fiacao mora aqui: duas copias de um par de `fetch` com
// tratamento de falha ASSIMETRICO divergem na primeira mudanca, e a que
// divergisse seria a menos usada -- a que ninguem confere.
//
// AS DUAS IDAS SAO DISPARADAS JUNTAS E TRATADAS SEPARADO
// -----------------------------------------------------
// Juntas (`Promise.all` sobre as duas) porque em serie a tela esperaria o SGS
// para mostrar a posicao, que nao depende dele. Separado porque a SEGUNDA pode
// falhar sozinha, e a falha dela nao e falha da tela: `rendaFixa` fica `null`,
// `comporCarteiraPorConta` avalia os papeis PELO CUSTO e liga
// `rendimentoIndisponivel`. E o desenho que `/dashboard/investments` ja usava
// para o card de renda fixa desde a HMO-192, agora com o estado nomeado em vez
// de um `catch` vazio.
//
// O `Promise.all` NAO REJEITA: cada ida tem `catch` proprio que devolve `null`.
// Um `Promise.all` de duas promessas onde a segunda rejeita descarta a PRIMEIRA
// tambem -- a posicao, que chegou inteira, seria jogada fora porque o Banco
// Central nao respondeu. E exatamente a falha que a Fase 2 separou as rotas para
// evitar, reintroduzida no cliente.
//
// POR QUE ELE NAO TEM ESTADO DE ERRO
// ----------------------------------
// Nao ha frase de erro aqui porque nenhuma das duas telas tem o que fazer com
// ela: em `/dashboard/contas` a carteira e um ENFEITE do cartao (sem ela o
// cartao e o de antes desta fase, que e correto), e em `/dashboard/investments`
// a carteira inteira falhando ja tem o `setErro` da propria tela. O que as duas
// precisam saber e `rendimentoIndisponivel`, e esse sai da composicao.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import {
  comporCarteiraPorConta,
  type CarteiraDaRota,
  type CarteiraPorConta,
  type RendaFixaDaRota,
} from "@/lib/carteira-na-tela";

/** Le a rota e devolve `null` em qualquer falha -- nunca lanca. */
async function ler<T>(url: string): Promise<T | null> {
  try {
    const resposta = await fetch(url);
    if (!resposta.ok) return null;
    return (await resposta.json()) as T;
  } catch {
    return null;
  }
}

export interface UseCarteiraPorConta {
  /** A composicao. `null` enquanto a primeira ida nao voltou. */
  carteira: CarteiraPorConta | null;
  carregando: boolean;
  recarregar: () => Promise<void>;
}

/**
 * A carteira por conta, composta das duas rotas.
 *
 * `ligado` desliga as duas idas sem o chamador precisar de um `if` em volta do
 * hook -- regra dos hooks. `/dashboard/contas` passa `false` enquanto esta sem
 * rede: ali a leitura viria do catalogo do aparelho, que nao tem carteira, e
 * pedir a rede num estado que a tela ja sabe que nao tem rede e so ruido no
 * console.
 */
export function useCarteiraPorConta(ligado = true): UseCarteiraPorConta {
  const [carteira, setCarteira] = useState<CarteiraPorConta | null>(null);
  const [carregando, setCarregando] = useState(ligado);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [posicao, rendimento] = await Promise.all([
        ler<CarteiraDaRota>("/api/investments"),
        ler<RendaFixaDaRota>("/api/investments/renda-fixa"),
      ]);
      // `posicao` nulo cai no vazio da composicao, e nao em `null`: a tela
      // passa a saber que a pergunta foi feita e nao ha carteira, que e
      // diferente de "ainda nao perguntei".
      setCarteira(comporCarteiraPorConta(posicao, rendimento));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (!ligado) {
      setCarregando(false);
      return;
    }
    recarregar();
  }, [ligado, recarregar]);

  return { carteira, carregando, recarregar };
}
