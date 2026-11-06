// ---------------------------------------------------------------------------
// AS TAGS DO LANCAMENTO (083, comparacao com o Minhas Financas)
// ---------------------------------------------------------------------------
// O Minhas Financas tem "Observacoes e hashtags" no lancamento e uma tela de
// Tags. Aqui a etiqueta mora em `financial_transactions.tags`, e esta funcao e
// a UNICA que decide a forma dela: minuscula, sem `#`, sem espaco, sem
// repetir, no maximo 20 (o CHECK da 083) e 30 caracteres cada. Quem digita
// "Viagem, #Natal natal" grava ['viagem', 'natal'].
// ---------------------------------------------------------------------------

export const MAXIMO_DE_TAGS = 20;
export const MAXIMO_DA_TAG = 30;

/** As tags normalizadas a partir do texto digitado. */
export function tagsDoTexto(texto: string | null | undefined): string[] {
  const vistas = new Set<string>();
  for (const pedaco of (texto ?? "").split(/[\s,;]+/)) {
    const tag = pedaco
      .replace(/^#+/, "")
      .toLocaleLowerCase("pt-BR")
      // Letras (com acento), numeros, `_` e `-`. Sem a flag `u`: o tsconfig do
      // app compila para um alvo que nao a aceita.
      .replace(/[^0-9a-z\u00c0-\u024f_-]/g, "")
      .slice(0, MAXIMO_DA_TAG);
    if (!tag || vistas.has(tag)) continue;
    vistas.add(tag);
    if (vistas.size === MAXIMO_DE_TAGS) break;
  }
  return Array.from(vistas);
}

/** O texto do campo a partir da coluna: "#viagem #natal". */
export function textoDasTags(tags: readonly string[] | null | undefined): string {
  return (tags ?? []).map((t) => `#${t}`).join(" ");
}
