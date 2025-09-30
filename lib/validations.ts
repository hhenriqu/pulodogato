import { z } from "zod";

export const TransactionSchema = z.object({
  asset_id: z.string().min(1, "Ativo é obrigatório"),
  type: z.enum(["buy", "sell", "dividend"], {
    message: "Tipo de transação é obrigatório",
  }),
  quantity: z.number().positive("Quantidade deve ser positiva"),
  price: z.number().positive("Preço deve ser positivo"),
  fees: z.number().min(0, "Taxas não podem ser negativas").optional(),
  date: z.string().min(1, "Data é obrigatória"),
  notes: z.string().optional(),
});

export const AssetSchema = z.object({
  symbol: z
    .string()
    .min(1, "Símbolo é obrigatório")
    .max(10, "Símbolo deve ter no máximo 10 caracteres"),
  name: z
    .string()
    .min(1, "Nome é obrigatório")
    .max(100, "Nome deve ter no máximo 100 caracteres"),
  type: z.enum(["stock", "fii", "fixed_income", "international"], {
    message: "Tipo de ativo é obrigatório",
  }),
  currency: z
    .string()
    .min(3, "Moeda deve ter 3 caracteres")
    .max(3, "Moeda deve ter 3 caracteres"),
});

export const DividendSchema = z.object({
  asset_id: z.string().min(1, "Ativo é obrigatório"),
  amount_per_share: z.number().positive("Valor por ação deve ser positivo"),
  quantity: z.number().positive("Quantidade deve ser positiva"),
  payment_date: z.string().min(1, "Data de pagamento é obrigatória"),
});

export type TransactionFormData = z.infer<typeof TransactionSchema>;
export type AssetFormData = z.infer<typeof AssetSchema>;
export type DividendFormData = z.infer<typeof DividendSchema>;
