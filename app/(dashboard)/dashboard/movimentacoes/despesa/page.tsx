"use client";

// A tela de despesa: a unica que mostra natureza (pontual / cartao / fixa),
// parcelamento e rateio. O mesmo container da receita, com outra prop -- duas
// copias dele divergiriam, e divergir na contabilizacao custa dinheiro.
//
// Desde a HMO-249 ela e exibida como MODAL. A rota continua existindo, e e ela
// que carrega `?id=` (editar), `?cartao=` (lancar gasto num cartao) e `?origem=`
// (de que tela a pessoa veio). Quem monta o modal e `ModalDeLancamento`, chamado
// de dentro do formulario; o porque de nao ser rota interceptada esta no
// cabecalho daquele arquivo.
//
// O `Suspense` existe porque o formulario le esses parametros com
// `useSearchParams`, e o Next exige o limite de suspensao para renderizar a rota
// no servidor.

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
