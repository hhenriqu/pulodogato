"use client";

// A tela de transferencia (HMO-164). Sem categoria, sem natureza, sem
// parcelamento e sem rateio -- e sem `?id=`, porque transferencia nao se edita
// aqui: sao duas linhas, e editar uma delas pela tela de lancamento deixaria a
// outra desencontrada. `tipoDoLancamento` ja devolve `null` para transferencia,
// entao o lapis da lista vem desabilitado.
//
// Desde a HMO-249 ela e exibida como MODAL (ver `ModalDeLancamento`), e o
// `Suspense` passou a ser obrigatorio: o formulario le `?origem=` com
// `useSearchParams` para saber de qual tela a pessoa veio, e o Next exige o
// limite de suspensao para renderizar a rota no servidor. Sem ele o `next build`
// para com "useSearchParams() should be wrapped in a suspense boundary".

import { Suspense } from "react";
import { FormularioDeTransferencia } from "@/components/movimentacoes/FormularioDeTransferencia";

export default function NovaTransferenciaPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      }
    >
      <FormularioDeTransferencia />
    </Suspense>
  );
}
