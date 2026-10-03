"use client";

// A tela so de receitas (HMO-246). Total, Previsto e Realizado do periodo
// escolhido, e as linhas que compoem cada um.
//
// O mesmo container das outras duas, com outra prop -- tres copias dele
// divergiriam, e o que divergiria primeiro e a conta dos tres numeros.
//
// O `Suspense` existe porque o container le `?de=&ate=` com `useSearchParams`,
// e o Next exige o limite de suspensao para renderizar a rota no servidor.

import { Suspense } from "react";
import { TelaDeMovimentacao } from "@/components/movimentacoes/TelaDeMovimentacao";

export default function ReceitasPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      }
    >
      <TelaDeMovimentacao tipo="income" />
    </Suspense>
  );
}
