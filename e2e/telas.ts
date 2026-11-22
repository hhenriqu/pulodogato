// =====================================================
// PULODOGATO - E2E: quais telas a varredura visita
// =====================================================
// A lista NAO e escrita a mao: vem do proprio menu (`menuAgrupado`). Tela nova
// que entra no menu entra na varredura no mesmo PR, sem ninguem lembrar.
//
// Fica de fora so o que a conta de teste nao deve ver:
//   /dashboard/admin -- so administrador; para os outros o middleware devolve 404.
// =====================================================

import { menuAgrupado, ehGrupo } from "../components/navegacao-do-menu";

export interface Tela {
  nome: string;
  href: string;
  /** Nome de arquivo estavel para o print: "contas-e-cartoes--cartoes". */
  slug: string;
}

const FORA = new Set(["/dashboard/admin"]);

function slugDe(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function telasDoMenu(): Tela[] {
  const telas: Tela[] = [];
  for (const entrada of menuAgrupado) {
    const itens = ehGrupo(entrada) ? entrada.itens : [entrada];
    const prefixo = ehGrupo(entrada) ? `${slugDe(entrada.nome)}--` : "";
    for (const item of itens) {
      if (FORA.has(item.href)) continue;
      telas.push({ nome: item.name, href: item.href, slug: prefixo + slugDe(item.name) });
    }
  }
  return telas;
}
