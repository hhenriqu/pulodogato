"use client";

// A tela so de transferencias (HMO-246). Total, Previsto e Realizado do
// periodo escolhido, e as linhas que compoem cada um.
//
// E a unica das tres em que o REALIZADO precisa descartar metade das linhas.
// Uma transferencia e gravada em DUAS pernas (migration 015): `-total` na conta
// que paga e `+total` na que recebe, com a MESMA `transaction_date`. Contar as
// duas faria esta tela anunciar R$ 2.000 de um Pix de R$ 1.000 -- e o numero
// continuaria "fechando" com a lista, porque a lista tambem mostraria as duas.
// Quem descarta e `ehPernaDeEntrada`, em lib/telas-de-movimentacao.ts, com teste
// e mutante.
//
// O `Suspense` existe porque o container le `?de=&ate=` com `useSearchParams`,
// e o Next exige o limite de suspensao para renderizar a rota no servidor.

import { Suspense } from "react";
import { TelaDeMovimentacao } from "@/components/movimentacoes/TelaDeMovimentacao";

export default function TransferenciasPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      }
    >
      <TelaDeMovimentacao tipo="transfer" />
    </Suspense>
  );
}
