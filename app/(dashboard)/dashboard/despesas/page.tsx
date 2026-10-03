"use client";

// A tela so de despesas (HMO-246). Total, Previsto e Realizado do periodo
// escolhido, e as linhas que compoem cada um.
//
// E a unica das tres em que o Previsto tem uma terceira fonte: a FATURA ABERTA
// do cartao, que nao existe em tabela nenhuma e e, em muitos meses, a maior
// despesa prevista do periodo. Quem decide isso e a rota
// (/api/movimentacoes/resumo), nao este arquivo.
//
// O `Suspense` existe porque o container le `?de=&ate=` com `useSearchParams`,
// e o Next exige o limite de suspensao para renderizar a rota no servidor.

import { Suspense } from "react";
import { TelaDeMovimentacao } from "@/components/movimentacoes/TelaDeMovimentacao";

export default function DespesasPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      }
    >
      <TelaDeMovimentacao tipo="expense" />
    </Suspense>
  );
}
