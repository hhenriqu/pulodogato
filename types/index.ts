// Re-export tipos financeiros
export * from "./financial";

export interface User {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
  created_at: string;
}

export interface Asset {
  id: string;
  symbol: string;
  name: string;
  type: "stock" | "fii" | "fixed_income" | "international";
  currency: string;
  created_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  asset_id: string;
  type: "buy" | "sell" | "dividend";
  quantity: number;
  price: number;
  fees?: number;
  date: string;
  notes?: string;
  asset?: Asset;
}

export interface Dividend {
  id: string;
  user_id: string;
  asset_id: string;
  amount_per_share: number;
  quantity: number;
  payment_date: string;
  asset?: Asset;
}

export interface Portfolio {
  asset_id: string;
  symbol: string;
  name: string;
  type: string;
  total_quantity: number;
  average_price: number;
  total_invested: number;
  current_price?: number;
  current_value?: number;
  profit_loss?: number;
  profit_loss_percentage?: number;
}

export interface DashboardSummary {
  total_invested: number;
  current_value: number;
  total_profit_loss: number;
  total_profit_loss_percentage: number;
  total_dividends: number;
  asset_allocation: {
    stock: number;
    fii: number;
    fixed_income: number;
    international: number;
  };
}
