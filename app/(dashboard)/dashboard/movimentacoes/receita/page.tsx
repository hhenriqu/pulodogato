"use client";

// A tela de receita. Ela nao tem natureza de despesa, nem parcelamento, nem
// rateio -- quem decide isso e `camposDoTipo("income", ...)`, nao este arquivo.
//
// O `Suspense` existe porque o formulario le `?id=` com `useSearchParams`, e o
// Next exige o limite de suspensao para renderizar a rota no servidor.

import { Suspense } from "react";
import { FormularioDeLancamento } from "@/components/movimentacoes/FormularioDeLancamento";

export default function NovaReceitaPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      }
    >
      <FormularioDeLancamento tipo="income" />
    </Suspense>
  );
}
