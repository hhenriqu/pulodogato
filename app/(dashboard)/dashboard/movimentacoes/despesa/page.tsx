"use client";

// A tela de despesa: a unica que mostra natureza (pontual / cartao / fixa),
// parcelamento e rateio. O mesmo container da receita, com outra prop -- duas
// copias dele divergiriam, e divergir na contabilizacao custa dinheiro.
//
// O `Suspense` existe porque o formulario le `?id=` com `useSearchParams`, e o
// Next exige o limite de suspensao para renderizar a rota no servidor.

import { Suspense } from "react";
import { FormularioDeLancamento } from "@/components/movimentacoes/FormularioDeLancamento";

export default function NovaDespesaPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      }
    >
      <FormularioDeLancamento tipo="expense" />
    </Suspense>
  );
}
