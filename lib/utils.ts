import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

import { dataOuMomentoNaTela } from "@/lib/data-na-tela";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(
  value: number,
  currency: string = "BRL"
): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currency,
  }).format(value);
}

export function formatPercentage(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

/**
 * A data de um VALOR que pode ser um dia do calendario ou um instante.
 *
 * O corpo mora em lib/data-na-tela.ts, e nao aqui, por duas razoes: este arquivo
 * importa `clsx`/`tailwind-merge` e por isso nao cabe num `node --test` barato, e
 * a regra precisava de teste nos dois fusos. O `new Date(date)` que estava aqui
 * recuava UM DIA toda coluna `date` -- `settled_on` e `today_rate_date` chegam
 * como `"2026-10-09"` e saiam como 08/10/2026 em Sao Paulo (HMO-353).
 */
export function formatDate(date: string | Date): string {
  return dataOuMomentoNaTela(date);
}

export function calculateAveragePrice(
  transactions: Array<{ type: string; quantity: number; price: number }>
): number {
  let totalQuantity = 0;
  let totalValue = 0;

  for (const transaction of transactions) {
    if (transaction.type === "buy") {
      totalQuantity += transaction.quantity;
      totalValue += transaction.quantity * transaction.price;
    } else if (transaction.type === "sell") {
      totalQuantity -= transaction.quantity;
      // Proportional reduction in total value
      if (totalQuantity > 0) {
        totalValue =
          (totalValue / (totalQuantity + transaction.quantity)) * totalQuantity;
      } else {
        totalValue = 0;
      }
    }
  }

  return totalQuantity > 0 ? totalValue / totalQuantity : 0;
}
