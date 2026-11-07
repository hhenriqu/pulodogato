"use client";

// INVESTIMENTOS > CUSTO DE VIDA
//
// Tela propria, a pedido do Helio: o custo de vida (12 meses realizados, 12
// previstos) e a reserva de emergencia sugerida moravam como secao da Carteira
// (#441). Aqui ficam sozinhos, com a chave de considerar ou nao o gasto
// variavel. Os numeros vem de GET /api/investments/custo-de-vida; o valor da
// carteira, so para "quantos meses ela cobre", vem de GET /api/investments e
// e opcional -- sem ele a tela mostra tudo o resto.

import { useEffect, useState } from "react";
import { Umbrella } from "lucide-react";
import { CustoDeVida } from "@/components/investments/CustoDeVida";
import { Dica } from "@/components/ui/dica";

export default function PaginaDoCustoDeVida() {
  const [valorDaCarteira, setValorDaCarteira] = useState<number | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const resposta = await fetch("/api/investments");
        if (!resposta.ok) return;
        const corpo = await resposta.json();
        const valor = Number(corpo?.summary?.currentValue);
        if (vivo && Number.isFinite(valor)) setValorDaCarteira(valor);
      } catch {
        // Sem carteira a tela segue sem o "quantos meses ela cobre".
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Umbrella className="h-8 w-8" />
          Custo de vida
          <Dica rotulo="Sobre o custo de vida">
            Quanto custa o seu mês, nos últimos 12 meses e nos próximos 12, e
            quanto guardar de reserva de emergência para um ano.
          </Dica>
        </h1>
      </div>
      <CustoDeVida valorDaCarteira={valorDaCarteira} />
    </div>
  );
}
