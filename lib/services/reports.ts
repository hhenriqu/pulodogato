// =====================================================
// RELATORIOS - regras compartilhadas entre as rotas
// =====================================================
// A janela de meses e a exportacao em CSV. O calculo dos numeros NAO mora
// aqui: ele esta nas views do 008, onde o teste SQL alcanca. O que sobra para
// o TypeScript e recortar o periodo e serializar.
// =====================================================

import { somarMeses, mesCorrente } from "@/lib/services/budget";

/** Quantos meses uma tela pode pedir de uma vez. */
export const MESES_MIN = 1;
export const MESES_MAX = 60;
export const MESES_PADRAO = 12;

/**
 * Traduz `?months=12` numa janela fechada [inicio, fim], em 'YYYY-MM-01'.
 *
 * A janela termina no mes corrente e nao no mes da ultima transacao: um mes
 * sem nenhum lancamento tem que aparecer no grafico como zero, nao sumir. Um
 * grafico que omite o mes vazio desenha uma linha reta entre outubro e
 * dezembro e sugere um gasto constante em novembro, quando o que houve foi
 * nada.
 */
export function janelaDeMeses(monthsParam: string | null): {
  inicio: string;
  fim: string;
  meses: number;
} | null {
  const meses = monthsParam == null ? MESES_PADRAO : Number(monthsParam);

  if (!Number.isInteger(meses) || meses < MESES_MIN || meses > MESES_MAX) {
    return null;
  }

  const fim = mesCorrente();
  // -(meses - 1): uma janela de 12 meses inclui o mes corrente, entao volta 11.
  return { inicio: somarMeses(fim, -(meses - 1)), fim, meses };
}

/** Todos os meses da janela, em ordem, inclusive os que nao tem movimento. */
export function mesesDaJanela(inicio: string, meses: number): string[] {
  return Array.from({ length: meses }, (_, i) => somarMeses(inicio, i));
}

/**
 * Preenche os meses sem linha com zeros, preservando a ordem do calendario.
 *
 * O PostgREST devolve so os meses que tem dado. Sem este passo o grafico pula
 * o mes vazio -- ver a nota em `janelaDeMeses`.
 */
export function completarMeses<T extends { month: string }>(
  linhas: T[],
  inicio: string,
  meses: number,
  vazio: (mes: string) => T,
): T[] {
  const porMes = new Map(linhas.map((l) => [l.month.slice(0, 10), l]));
  return mesesDaJanela(inicio, meses).map((m) => porMes.get(m) ?? vazio(m));
}

// =====================================================
// CSV
// =====================================================

/**
 * Escapa um campo para CSV.
 *
 * As aspas dobradas nao sao decoracao: uma descricao como `Mercado "do Ze"` ou
 * uma que contenha ponto e virgula quebraria a linha em duas colunas e
 * deslocaria todo o resto da planilha em silencio -- o usuario abriria no Excel
 * e leria valores na coluna errada sem nenhum sinal de erro.
 */
export function campoCsv(valor: unknown): string {
  if (valor == null) return "";
  const s = String(valor);
  return /["\n\r;,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Monta um CSV para abrir no Excel em portugues.
 *
 * Duas decisoes que parecem detalhe e nao sao:
 *
 *  - separador `;` e decimal com virgula. No Excel em pt-BR o separador de
 *    lista e o ponto e virgula; um CSV com virgula abre com a planilha inteira
 *    espremida na coluna A, e o usuario conclui que a exportacao esta quebrada.
 *  - BOM na frente. Sem ele o Excel le o arquivo como ANSI e "Alimentação"
 *    vira "AlimentaÃ§Ã£o" em toda a coluna de categorias.
 */
export function montarCsv(
  cabecalho: string[],
  linhas: (string | number | null)[][],
): string {
  const corpo = [cabecalho.map(campoCsv).join(";")];

  for (const linha of linhas) {
    corpo.push(
      linha
        .map((c) => (typeof c === "number" ? formatarNumeroCsv(c) : campoCsv(c)))
        .join(";"),
    );
  }

  return "﻿" + corpo.join("\r\n") + "\r\n";
}

/** Numero com duas casas e virgula decimal, como o Excel pt-BR espera. */
export function formatarNumeroCsv(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

/** Cabecalhos para o browser baixar o arquivo em vez de exibi-lo. */
export function cabecalhosCsv(nomeArquivo: string): HeadersInit {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${nomeArquivo}"`,
    // Relatorio financeiro nao pode ficar em cache de proxy: o proximo usuario
    // na mesma rede receberia o extrato do anterior.
    "Cache-Control": "no-store",
  };
}

/** 'YYYY-MM-01' -> 'MM/AAAA', sem passar por Date (fuso). */
export function rotuloMes(mesIso: string): string {
  const [ano, mes] = mesIso.slice(0, 7).split("-");
  return `${mes}/${ano}`;
}
