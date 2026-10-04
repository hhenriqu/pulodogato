import { z } from "zod";

// =====================================================
// SCHEMAS DE VALIDAÇÃO FINANCEIRA
// =====================================================

// Schema base para transação
export const transactionSchema = z.object({
  description: z
    .string()
    .min(3, "Descrição deve ter pelo menos 3 caracteres")
    .max(255, "Descrição deve ter no máximo 255 caracteres"),

  amount: z
    .number()
    .positive("Valor deve ser positivo")
    .max(999999999.99, "Valor muito alto"),

  transaction_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD"),

  category_id: z.string().uuid("Categoria deve ser selecionada"),

  account_id: z
    .string()
    .uuid("Conta deve ser selecionada")
    .optional()
    .or(z.literal(""))
    .nullable(),

  transaction_type: z.enum(["income", "expense", "transfer"]).optional(),

  notes: z
    .string()
    .max(1000, "Observações devem ter no máximo 1000 caracteres")
    .optional(),

  is_shared: z.boolean().default(false),
});

// Schema para nova transação
export const newTransactionSchema = transactionSchema
  .extend({
    is_installment: z.boolean().default(false),

    installment_count: z
      .number()
      .int()
      .min(2, "Mínimo de 2 parcelas")
      .max(48, "Máximo de 48 parcelas")
      .optional(),

    // Para grupos (se is_shared = true)
    group_id: z.string().uuid().optional(),

    split_type: z
      .enum(["equal", "percentage", "custom", "proportional"])
      .optional(),

    participants: z
      .array(
        z.object({
          user_id: z.string().uuid(),
          percentage: z.number().min(0).max(100).optional(),
          amount: z.number().positive().optional(),
        })
      )
      .optional(),
  })
  .refine(
    (data) => {
      // Se é parcelamento, deve ter installment_count
      if (data.is_installment && !data.installment_count) {
        return false;
      }
      return true;
    },
    {
      message: "Quantidade de parcelas é obrigatória para parcelamentos",
      path: ["installment_count"],
    }
  )
  .refine(
    (data) => {
      // Se é compartilhado, deve ter group_id ou participants
      if (
        data.is_shared &&
        !data.group_id &&
        (!data.participants || data.participants.length === 0)
      ) {
        return false;
      }
      return true;
    },
    {
      message:
        "Grupo ou participantes são obrigatórios para gastos compartilhados",
      path: ["group_id"],
    }
  );

// Schema para parcelamento
export const installmentSchema = z.object({
  description: z
    .string()
    .min(3, "Descrição deve ter pelo menos 3 caracteres")
    .max(255, "Descrição deve ter no máximo 255 caracteres"),

  total_amount: z
    .number()
    .positive("Valor total deve ser positivo")
    .max(999999999.99, "Valor muito alto"),

  total_installments: z
    .number()
    .int()
    .min(2, "Mínimo de 2 parcelas")
    .max(48, "Máximo de 48 parcelas"),

  first_due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD"),

  category_id: z.string().uuid("Categoria deve ser selecionada"),

  account_id: z.string().uuid().optional().nullable(),

  transaction_type: z.enum(["income", "expense", "transfer"]),

  notes: z
    .string()
    .max(1000, "Observações devem ter no máximo 1000 caracteres")
    .optional(),

  // Para grupos
  group_id: z.string().uuid().optional(),

  group_split_type: z
    .enum(["equal", "percentage", "custom", "proportional"])
    .optional(),
});

// Schema para conta financeira
export const accountSchema = z.object({
  name: z
    .string()
    .min(2, "Nome deve ter pelo menos 2 caracteres")
    .max(100, "Nome deve ter no máximo 100 caracteres"),

  account_type: z.enum([
    "checking",
    "savings",
    "credit_card",
    "debit_card",
    "cash",
    "digital",
    "investment",
    "other",
  ]),

  bank_name: z
    .string()
    .max(100, "Nome do banco deve ter no máximo 100 caracteres")
    .optional(),

  last_four_digits: z
    .string()
    .regex(/^\d{4}$/, "Últimos 4 dígitos devem conter exatamente 4 números")
    .optional(),

  credit_limit: z.number().positive().max(999999999.99).optional(),

  current_balance: z.number().default(0),

  color_hex: z
    .string()
    .regex(/^#[0-9A-F]{6}$/i, "Cor deve estar no formato hexadecimal")
    .default("#3B82F6"),

  icon: z.string().default("credit-card"),

  is_active: z.boolean().default(true),
});

// Schema para grupo de despesas
export const expenseGroupSchema = z.object({
  name: z
    .string()
    .min(2, "Nome deve ter pelo menos 2 caracteres")
    .max(100, "Nome deve ter no máximo 100 caracteres"),

  description: z
    .string()
    .max(500, "Descrição deve ter no máximo 500 caracteres")
    .optional(),

  group_type: z.enum(["public", "private"]).default("private"),

  default_split_type: z
    .enum(["equal", "percentage", "custom", "proportional"])
    .default("equal"),
});

/**
 * O corpo do `PUT /api/expense-groups/{groupId}/split-config` (HMO-245, fase 3).
 *
 * POR QUE `percentage` E CONFERIDO AQUI, E NAO SO POR `dePercentual`
 * ------------------------------------------------------------------
 * `dePercentual` (lib/divisao-configurada.ts) CLAMPA: `-50` vira 0 e `150` vira
 * 10000. Isso e o certo para um numero lido do banco, e e exatamente o errado
 * para um numero que chegou de fora -- um corpo com `[-50, 150]` passaria pelo
 * clamp e sairia somando 100% cravado, gravando uma divisao que ninguem pediu.
 * O `min(0).max(100)` daqui roda ANTES da conversao, entao o clamp nunca e o
 * que decide o resultado.
 *
 * `finite()` nao e decorativo: `Infinity` e `NaN` sao `number` para o
 * TypeScript, viram `null` no JSON de saida e `dePercentual` os devolve como 0
 * -- a mesma classe de pedido que vira uma divisao inventada.
 *
 * A soma NAO e conferida aqui. Ela e uma invariante de CONJUNTO em centesimos
 * inteiros, e um `refine` sobre os floats do corpo responderia sobre numeros
 * diferentes dos que seriam gravados: `33.333` soma 99,999 aqui e grava
 * `33.33`. A rota converte primeiro e confere depois, sobre o inteiro.
 */
export const groupSplitConfigSchema = z.object({
  default_split_type: z.enum(["equal", "percentage", "custom", "proportional"]),

  members: z
    .array(
      z.object({
        member_id: z.string().uuid("member_id precisa ser um UUID"),
        percentage: z
          .number()
          .finite("Percentual inválido")
          .min(0, "Percentual não pode ser negativo")
          .max(100, "Percentual não pode passar de 100"),
      })
    )
    .min(1, "Informe ao menos um membro"),
});

// Schema para filtros de transação
export const transactionFiltersSchema = z
  .object({
    start_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),

    end_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),

    category_id: z.string().uuid().optional(),

    account_id: z.string().uuid().optional(),

    transaction_type: z.enum(["income", "expense", "transfer"]).optional(),

    min_amount: z.number().positive().optional(),

    max_amount: z.number().positive().optional(),

    search: z.string().max(255).optional(),
  })
  .refine(
    (data) => {
      // Se ambas as datas existem, start_date deve ser <= end_date
      if (data.start_date && data.end_date) {
        return new Date(data.start_date) <= new Date(data.end_date);
      }
      return true;
    },
    {
      message: "Data inicial deve ser anterior ou igual à data final",
      path: ["end_date"],
    }
  )
  .refine(
    (data) => {
      // Se ambos os valores existem, min_amount deve ser <= max_amount
      if (data.min_amount && data.max_amount) {
        return data.min_amount <= data.max_amount;
      }
      return true;
    },
    {
      message: "Valor mínimo deve ser menor ou igual ao valor máximo",
      path: ["max_amount"],
    }
  );

// Tipos inferidos dos schemas
export type TransactionFormData = z.infer<typeof newTransactionSchema>;
export type InstallmentFormData = z.infer<typeof installmentSchema>;
export type AccountFormData = z.infer<typeof accountSchema>;
export type ExpenseGroupFormData = z.infer<typeof expenseGroupSchema>;
export type TransactionFilters = z.infer<typeof transactionFiltersSchema>;

// Utilitários de validação
export const validateTransaction = (data: unknown) => {
  return newTransactionSchema.safeParse(data);
};

export const validateInstallment = (data: unknown) => {
  return installmentSchema.safeParse(data);
};

export const validateAccount = (data: unknown) => {
  return accountSchema.safeParse(data);
};

export const validateExpenseGroup = (data: unknown) => {
  return expenseGroupSchema.safeParse(data);
};

export const validateTransactionFilters = (data: unknown) => {
  return transactionFiltersSchema.safeParse(data);
};
