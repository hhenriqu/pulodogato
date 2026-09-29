// O icone de cada tipo.
//
// Fica fora de `lib/contas.ts` de proposito: aquele arquivo e a REGRA (qual
// tipo mora em qual tela, o que entra em cada total, o que vai `null` para o
// banco) e nao importa React. E o que permite ele ser compilado e testado com
// `tsc` puro, sem arrastar um runner de componente atras.

import {
  CreditCard,
  Landmark,
  PiggyBank,
  Smartphone,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { AccountType } from "@/types/financial";

const ICONES: Partial<Record<AccountType, typeof Wallet>> = {
  checking: Landmark,
  savings: PiggyBank,
  credit_card: CreditCard,
  debit_card: CreditCard,
  cash: Wallet,
  digital: Smartphone,
  investment: TrendingUp,
};

/** "Outra" e o tipo desconhecido caem na carteira, como na tela antiga. */
export const iconeDoTipo = (tipo: AccountType) => ICONES[tipo] ?? Wallet;
