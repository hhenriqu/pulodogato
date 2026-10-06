"use client";

// ---------------------------------------------------------------------------
// "A TELA DA QUAL ESTAVAMOS" (HMO-249)
// ---------------------------------------------------------------------------
// Devolve o endereco da tela atual, para pendurar no `?origem=` do link que
// abre um modal de lancamento. O formulario le aquele parametro e e para la que
// o Salvar, o Cancelar e o X voltam.
//
// POR QUE A QUERY ENTRA, E NAO SO O CAMINHO
// -----------------------------------------
// As telas de movimentacao guardam o periodo escolhido na URL
// (`/dashboard/despesas?de=2026-01-01&ate=2026-01-31`). Voltar so para
// `/dashboard/despesas` jogaria a pessoa no periodo PADRAO -- o mes corrente --
// depois de ela ter lancado uma despesa de janeiro. A despesa estaria gravada e
// fora da tela, que e indistinguivel de nao ter gravado.
//
// POR QUE UM HOOK, E NAO `window.location`
// ----------------------------------------
// `window.location` nao existe no render do servidor, e as telas que chamam isto
// sao renderizadas no servidor antes de hidratar. `usePathname` +
// `useSearchParams` sao os dois unicos que o App Router mantem corretos nos dois
// lados -- com o pedagio de exigir `<Suspense>` na rota, que as telas que usam
// isto ja tem.
// ---------------------------------------------------------------------------

import { usePathname, useSearchParams } from "next/navigation";

export function useOrigemDaTela(): string {
  const caminho = usePathname();
  const busca = useSearchParams().toString();
  return busca ? `${caminho}?${busca}` : caminho;
}
