import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

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

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat("pt-BR").format(new Date(date));
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
