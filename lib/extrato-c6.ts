// =====================================================
// CSV DO C6 BANK - conta corrente e fatura do cartao
// =====================================================
// Puro como lib/statement.ts: nao fala com o banco, so le texto. O usuario diz
// na tela QUAL arquivo esta mandando (conta ou fatura), porque os dois formatos
// do C6 sao diferentes e um lido como o outro erra em silencio.
//
// CONTA CORRENTE (separador ',', BOM, CRLF)
// -----------------------------------------
//   Extrato personalizado            <- preambulo de ~9 linhas, pulado
//   ...
//   Data Lançamento,Data Contábil,Título,Descrição,Entrada(R$),Saída(R$)
//   13/10/2026,14/10/2026,Pix enviado para X,TRANSF ENVIADA PIX,0.00,87.35
//
//   valor = Entrada - Saida. A data e a de LANCAMENTO (o dia em que o Pix
//   aconteceu), nao a contabil (o dia util seguinte).
//
// FATURA DO CARTAO (separador ';', CRLF)
// --------------------------------------
//   Data de Compra;Nome no Cartão;Final do Cartão;Categoria;Descrição;Parcela;
//     Valor (em US$);Cotação (em R$);Valor (em R$)
//   26/05/2026;FULANO;1111;Servicos;MP *LOJA;6/12;0;0;50.82
//
//   O SINAL E O CONTRARIO DO APP: o C6 grava a compra POSITIVA e o pagamento e
//   o estorno NEGATIVOS. Aqui ele e invertido (compra -> negativo = despesa).
//
//   A DATA DA PARCELA: toda parcela traz a data da compra ORIGINAL. A 6/12 de
//   uma compra de maio vem com 26/05. Gravada assim, cairia na fatura de maio
//   (ja paga) e no relatorio de maio. Da parcela 2 em diante a linha vai para o
//   dia 1 do mes da fatura, com " (k/N)" na descricao -- exatamente como
//   POST /api/financial-installments grava a compra parcelada, e e isso que
//   faz a parcela importada casar com a parcela que o usuario ja tinha criado.
//
//   O FINGERPRINT leva o final do cartao e a parcela: a 5/12 e a 6/12 da mesma
//   compra tem a mesma data de compra, valor e descricao, e sem isso a 6/12
//   seria descartada como repetida.
// =====================================================

import {
  dividirLinha,
  fingerprint,
  lerData,
  lerValor,
  normalizarDescricao,
  type ParseResult,
  type StatementEntry,
} from "@/lib/statement";

export type TipoDoArquivoC6 = "conta" | "cartao";

/** Uma linha do C6, com o que o arquivo traz alem do basico. */
export interface EntradaC6 extends StatementEntry {
  /** k de "k/N". null em "Única" e na conta. */
  installmentNumber: number | null;
  /** N de "k/N". null em "Única" e na conta. */
  installmentTotal: number | null;
  /** a data da compra como o C6 mandou, quando difere de postedAt (parcela 2+). */
  purchaseDate: string | null;
  /** "Final do Cartão". null na conta. */
  cardLast4: string | null;
  /** "Categoria" do C6, so informativa. null quando o C6 manda "-". */
  bankCategory: string | null;
  /** 'ignore' quando a linha ja chega sugerida para cancelar (pagamento da fatura). */
  suggestedAction: "ignore" | null;
}

export interface ResultadoC6 extends ParseResult {
  entries: EntradaC6[];
}

export interface OpcoesC6 {
  tipo: TipoDoArquivoC6;
  /** 'AAAA-MM'. Obrigatorio na fatura: e o mes em que as parcelas 2+ caem. */
  mesDaFatura?: string | null;
}

// =====================================================
// Helpers
// =====================================================

function linhasDe(conteudo: string): string[] {
  return conteudo
    .replace(/^﻿/, "")
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim().length > 0);
}

/** O C6 usa ponto decimal sem milhar ("25328.47"). Fora disso, a regra geral. */
function lerValorC6(bruto: string): number | null {
  const texto = String(bruto ?? "").trim();
  if (/^-?\d+(\.\d+)?$/.test(texto)) return Math.round(Number(texto) * 100) / 100;
  return lerValor(texto);
}

function limpar(texto: string | undefined): string {
  return String(texto ?? "").replace(/\s+/g, " ").trim();
}

function cabecalhoNormalizado(linha: string, separador: string): string[] {
  return dividirLinha(linha, separador).map((c) => normalizarDescricao(c));
}

const CABECALHO_CONTA = ["data lancamento", "data contabil", "titulo", "descricao", "entrada(r$)", "saida(r$)"];
const CABECALHO_CARTAO = [
  "data de compra",
  "nome no cartao",
  "final do cartao",
  "categoria",
  "descricao",
  "parcela",
  "valor (em us$)",
  "cotacao (em r$)",
  "valor (em r$)",
];

function ehCabecalho(linha: string, separador: string, esperado: string[]): boolean {
  const campos = cabecalhoNormalizado(linha, separador);
  return esperado.every((nome, i) => campos[i] === nome);
}

/** Fingerprints com o ordinal entre linhas IDENTICAS, na ordem do arquivo. */
function comFingerprintsC6(
  brutas: Array<Omit<EntradaC6, "fingerprint"> & { chave: string }>
): EntradaC6[] {
  const vistos = new Map<string, number>();
  return brutas.map(({ chave, ...e }) => {
    const base = `${e.postedAt}|${e.amount.toFixed(2)}|${normalizarDescricao(chave)}`;
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    return {
      ...e,
      fingerprint: fingerprint({ fitId: null, postedAt: e.postedAt, amount: e.amount, description: chave }, n),
    };
  });
}

function resultado(entries: EntradaC6[], warnings: string[]): ResultadoC6 {
  const datas = entries.map((e) => e.postedAt).sort();
  return {
    format: "csv",
    entries,
    periodStart: datas[0] ?? null,
    periodEnd: datas[datas.length - 1] ?? null,
    warnings,
  };
}

/** "Fatura_2026-11-20.csv" -> "2026-11". null quando o nome nao diz. */
export function mesDaFaturaPeloNome(nome: string | null | undefined): string | null {
  const m = String(nome ?? "").match(/fatura[_\- ]?(\d{4})-(\d{2})(?:-\d{2})?/i);
  if (!m) return null;
  const mes = Number(m[2]);
  return mes >= 1 && mes <= 12 ? `${m[1]}-${m[2]}` : null;
}

// =====================================================
// Conta corrente
// =====================================================

function lerConta(conteudo: string): ResultadoC6 {
  const linhas = linhasDe(conteudo);
  const iCabecalho = linhas.findIndex((l) => ehCabecalho(l, ",", CABECALHO_CONTA));

  if (iCabecalho === -1) {
    const pareceFatura = linhas.some((l) => ehCabecalho(l, ";", CABECALHO_CARTAO));
    return resultado([], [
      pareceFatura
        ? "Este arquivo é a fatura do cartão do C6, não o extrato da conta. Escolha \"C6 Bank: fatura do cartão\"."
        : "Não reconheci o extrato da conta do C6: falta a linha \"Data Lançamento, Data Contábil, Título, Descrição, Entrada(R$), Saída(R$)\".",
    ]);
  }

  const warnings: string[] = [];
  const brutas: Array<Omit<EntradaC6, "fingerprint"> & { chave: string }> = [];

  for (const linha of linhas.slice(iCabecalho + 1)) {
    const [dataLanc, , tituloBruto, descricaoBruta, entradaBruta, saidaBruta] = dividirLinha(linha, ",");
    const postedAt = lerData(dataLanc ?? "", "dmy");
    const entrada = lerValorC6(entradaBruta ?? "");
    const saida = lerValorC6(saidaBruta ?? "");

    if (!postedAt || entrada === null || saida === null) {
      warnings.push(`Linha ignorada, não consegui ler: ${limpar(linha).slice(0, 80)}`);
      continue;
    }

    const amount = Math.round((entrada - saida) * 100) / 100;
    if (amount === 0) continue;

    const titulo = limpar(tituloBruto);
    const descricao = limpar(descricaoBruta);
    const description = titulo || descricao || "Lançamento sem descrição";

    brutas.push({
      fitId: null,
      postedAt,
      amount,
      description,
      memo: descricao && descricao !== description ? descricao : null,
      installmentNumber: null,
      installmentTotal: null,
      purchaseDate: null,
      cardLast4: null,
      bankCategory: null,
      suggestedAction: null,
      chave: `${description}|${descricao}`,
    });
  }

  return resultado(comFingerprintsC6(brutas), warnings);
}

// =====================================================
// Fatura do cartao
// =====================================================

function lerParcela(bruto: string): { numero: number; total: number } | null {
  const m = limpar(bruto).match(/^(\d{1,3})\s*\/\s*(\d{1,3})$/);
  if (!m) return null;
  const numero = Number(m[1]);
  const total = Number(m[2]);
  return numero >= 1 && total >= 1 && numero <= total ? { numero, total } : null;
}

const moedaBr = (v: number, casas = 2) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

function lerCartao(conteudo: string, mesDaFatura: string | null | undefined): ResultadoC6 {
  const linhas = linhasDe(conteudo);
  const iCabecalho = linhas.findIndex((l) => ehCabecalho(l, ";", CABECALHO_CARTAO));

  if (iCabecalho === -1) {
    const pareceConta = linhas.some((l) => ehCabecalho(l, ",", CABECALHO_CONTA));
    return resultado([], [
      pareceConta
        ? "Este arquivo é o extrato da conta do C6, não a fatura do cartão. Escolha \"C6 Bank: conta corrente\"."
        : "Não reconheci a fatura do C6: falta a linha \"Data de Compra; Nome no Cartão; Final do Cartão; ...; Valor (em R$)\".",
    ]);
  }

  const warnings: string[] = [];
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(mesDaFatura ?? "")) ? String(mesDaFatura) : null;
  const brutas: Array<Omit<EntradaC6, "fingerprint"> & { chave: string }> = [];

  for (const linha of linhas.slice(iCabecalho + 1)) {
    const [dataBruta, , finalBruto, categoriaBruta, descricaoBruta, parcelaBruta, usdBruto, cotacaoBruta, brlBruto] =
      dividirLinha(linha, ";");

    const dataCompra = lerData(dataBruta ?? "", "dmy");
    const valorC6 = lerValorC6(brlBruto ?? "");

    if (!dataCompra || valorC6 === null) {
      warnings.push(`Linha ignorada, não consegui ler: ${limpar(linha).slice(0, 80)}`);
      continue;
    }
    if (valorC6 === 0) continue;

    // O SINAL: compra positiva no C6 e despesa (negativa) no app.
    const amount = -valorC6;

    const parcela = lerParcela(parcelaBruta ?? "");
    const descricaoBanco = limpar(descricaoBruta) || "Compra no cartão";
    const description = parcela && parcela.total > 1
      ? `${descricaoBanco} (${parcela.numero}/${parcela.total})`
      : descricaoBanco;

    // Parcela 2+ vai para o dia 1 do mes da fatura. Sem o mes, fica na data da
    // compra e a tela avisa -- melhor uma data errada visivel que uma linha perdida.
    const parcelaDeMesAnterior = parcela !== null && parcela.numero > 1;
    const postedAt = parcelaDeMesAnterior && mes ? `${mes}-01` : dataCompra;

    const usd = lerValorC6(usdBruto ?? "");
    const cotacao = lerValorC6(cotacaoBruta ?? "");
    const memo = usd && cotacao ? `US$ ${moedaBr(usd)} × R$ ${moedaBr(cotacao)}` : null;

    const categoria = limpar(categoriaBruta);
    const cardLast4 = limpar(finalBruto) || null;

    brutas.push({
      fitId: null,
      postedAt,
      amount,
      description,
      memo,
      installmentNumber: parcela?.numero ?? null,
      installmentTotal: parcela?.total ?? null,
      purchaseDate: postedAt !== dataCompra ? dataCompra : null,
      cardLast4,
      bankCategory: categoria && categoria !== "-" ? categoria : null,
      // O pagamento da fatura ja aparece no extrato da conta. Confirmado aqui,
      // entraria como receita no cartao E como saida na conta.
      suggestedAction: /^inclusao de pagamento/.test(normalizarDescricao(descricaoBanco)) ? "ignore" : null,
      chave: `${description}|cartao ${cardLast4 ?? "?"}|${limpar(parcelaBruta)}|compra ${dataCompra}`,
    });
  }

  if (!mes && brutas.some((b) => (b.installmentNumber ?? 0) > 1)) {
    warnings.push(
      "Sem o mês da fatura, as parcelas 2 em diante ficaram na data da compra original. Informe o mês da fatura e envie de novo."
    );
  }

  return resultado(comFingerprintsC6(brutas), warnings);
}

// =====================================================
// Entrada
// =====================================================

export function lerExtratoC6(conteudo: string, opcoes: OpcoesC6): ResultadoC6 {
  return opcoes.tipo === "cartao" ? lerCartao(conteudo, opcoes.mesDaFatura) : lerConta(conteudo);
}
