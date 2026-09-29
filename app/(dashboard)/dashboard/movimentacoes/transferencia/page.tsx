"use client";

// A tela de transferencia (HMO-164). Sem categoria, sem natureza, sem
// parcelamento e sem rateio -- e sem `?id=`, porque transferencia nao se edita
// aqui: sao duas linhas, e editar uma delas pela tela de lancamento deixaria a
// outra desencontrada. `tipoDoLancamento` ja devolve `null` para transferencia,
// entao o lapis da lista vem desabilitado.

import { FormularioDeTransferencia } from "@/components/movimentacoes/FormularioDeTransferencia";

export default function NovaTransferenciaPage() {
  return <FormularioDeTransferencia />;
}
