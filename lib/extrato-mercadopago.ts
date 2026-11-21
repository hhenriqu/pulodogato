// =====================================================
// CSV DO MERCADO PAGO - extrato da conta
// =====================================================
// Puro como lib/statement.ts: nao fala com o banco, so le texto.
//
// FORMATO (separador ';', valores em portugues)
// ---------------------------------------------
//   INITIAL_BALANCE;CREDITS;DEBITS;FINAL_BALANCE      <- resumo do periodo
//   2.923,66;26.445,44;-26.078,12;3.290,98
//
//   RELEASE_DATE;TRANSACTION_TYPE;REFERENCE_ID;TRANSACTION_NET_AMOUNT;PARTIAL_BALANCE
//   01-09-2026;Rendimentos ;1749247481588;1,42;2.912,58
//
//   O valor ja vem com o sinal do app (saida negativa). A data e dd-mm-aaaa.
//
// O REFERENCE_ID e o id do Mercado Pago para a operacao: vira o fitId, e o
// fingerprint sai dele. Reenviar o mesmo extrato, ou um periodo que se
// sobrepoe, reconhece as mesmas linhas pelo id e nao duplica nada.
//
// O RESUMO CONFERE O ARQUIVO: saldo inicial + soma das linhas tem que dar o
// saldo final. Se nao der, alguma linha nao foi lida, e o usuario fica sabendo
// antes de confirmar qualquer coisa.
// =====================================================

import {
  dividirLinha,
  lerData,
  lerValor,
  normalizarDescricao,
  type ParseResult,
  type StatementEntry,
} from "@/lib/statement";

const CABECALHO_RESUMO = ["initial_balance", "credits", "debits", "final_balance"];
const CABECALHO_LINHAS = [
  "release_date",
  "transaction_type",
  "reference_id",
  "transaction_net_amount",
  "partial_balance",
];

function linhasDe(conteudo: string): string[] {
  return conteudo
    .replace(/^﻿/, "")
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim().length > 0);
}

function ehCabecalho(linha: string, esperado: string[]): boolean {
  const campos = dividirLinha(linha, ";").map((c) => normalizarDescricao(c));
  return esperado.every((nome, i) => campos[i] === nome);
}

const moeda = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function lerExtratoMercadoPago(conteudo: string): ParseResult {
  const linhas = linhasDe(conteudo);
  const iCabecalho = linhas.findIndex((l) => ehCabecalho(l, CABECALHO_LINHAS));

  if (iCabecalho === -1) {
    return {
      format: "csv",
      entries: [],
      periodStart: null,
      periodEnd: null,
      warnings: [
        'Não reconheci o extrato do Mercado Pago: falta a linha "RELEASE_DATE;TRANSACTION_TYPE;REFERENCE_ID;TRANSACTION_NET_AMOUNT;PARTIAL_BALANCE".',
      ],
    };
  }

  const warnings: string[] = [];
  const entries: StatementEntry[] = [];
  const idsVistos = new Map<string, number>();

  for (const linha of linhas.slice(iCabecalho + 1)) {
    const [dataBruta, tipoBruto, idBruto, valorBruto] = dividirLinha(linha, ";");
    const postedAt = lerData(dataBruta ?? "", "dmy");
    const amount = lerValor(valorBruto ?? "");

    if (!postedAt || amount === null) {
      warnings.push(`Linha ignorada, não consegui ler: ${linha.replace(/\s+/g, " ").trim().slice(0, 80)}`);
      continue;
    }
    if (amount === 0) continue;

    // O id repetido no mesmo arquivo (nao aconteceu nos extratos vistos, mas
    // nada garante) ganha um ordinal: sem ele, a segunda linha seria
    // descartada como reenvio da primeira.
    const id = String(idBruto ?? "").trim();
    let fitId: string | null = null;
    if (id) {
      const n = (idsVistos.get(id) ?? 0) + 1;
      idsVistos.set(id, n);
      fitId = n === 1 ? `mp:${id}` : `mp:${id}#${n}`;
    }

    const description = String(tipoBruto ?? "").replace(/\s+/g, " ").trim() || "Lançamento sem descrição";

    entries.push({
      fitId,
      fingerprint: fitId
        ? `fitid:${fitId}`
        : ["h", postedAt, amount.toFixed(2), normalizarDescricao(description), `#${entries.length}`].join("|"),
      postedAt,
      amount,
      description,
      memo: null,
    });
  }

  // Conferencia pelo resumo do topo.
  const iResumo = linhas.findIndex((l) => ehCabecalho(l, CABECALHO_RESUMO));
  if (iResumo !== -1 && iResumo + 1 < iCabecalho) {
    const [inicialBruto, , , finalBruto] = dividirLinha(linhas[iResumo + 1], ";");
    const inicial = lerValor(inicialBruto ?? "");
    const final = lerValor(finalBruto ?? "");
    if (inicial !== null && final !== null) {
      const soma = entries.reduce((s, e) => s + Math.round(e.amount * 100), 0);
      const esperado = Math.round(final * 100) - Math.round(inicial * 100);
      if (soma !== esperado) {
        warnings.push(
          `As linhas somam R$ ${moeda(soma / 100)}, mas o resumo do Mercado Pago diz R$ ${moeda(esperado / 100)} no período. Confira se o arquivo está completo.`
        );
      }
    }
  }

  const datas = entries.map((e) => e.postedAt).sort();
  return {
    format: "csv",
    entries,
    periodStart: datas[0] ?? null,
    periodEnd: datas[datas.length - 1] ?? null,
    warnings,
  };
}
