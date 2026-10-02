"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PropsDeTooltip } from "@/types/grafico";

interface PerformanceData {
  date: string;
  portfolio: number;
  /**
   * Opcional desde a HMO-169, e essa é a diferença que importa: não existe fonte
   * de cotação contratada neste app (HMO-141 item 2), então não há série do IBOV
   * para comparar. Enquanto era obrigatório, a única forma de usar o componente
   * era passar zero — e uma linha reta no zero chamada "IBOV" não é um dado
   * faltando, é um dado errado: quem olha lê "o índice não saiu do lugar".
   */
  benchmark?: number;
}

interface PerformanceChartProps {
  data: PerformanceData[];
  title?: string;
  description?: string;
}

export function PerformanceChart({
  data,
  title = "Performance da Carteira",
  description = "Comparação com benchmark ao longo do tempo",
}: PerformanceChartProps) {
  // A linha do benchmark só entra se algum ponto tiver o valor. `?? undefined`
  // não bastaria: o recharts desenha a série declarada de qualquer jeito e ela
  // aparece na legenda, prometendo uma comparação que o gráfico não tem.
  const temBenchmark = data.some(
    (p) => p.benchmark !== undefined && p.benchmark !== null
  );
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("pt-BR", {
      month: "short",
      day: "numeric",
    });
  };

  const CustomTooltip = ({
    active,
    payload,
    label,
  }: PropsDeTooltip<PerformanceData>) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-card p-3 shadow-lg rounded-lg border">
          <p className="font-medium">{formatDate(String(label))}</p>
          {payload.map((entry, index: number) => (
            <p key={index} style={{ color: entry.color }}>
              {entry.name}: {formatCurrency(Number(entry.value))}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              {/* O recharts nao le classe CSS: grade e eixos vem com cinza
                  fixo, que some no tema escuro. Os tokens entram como valor
                  de atributo SVG mesmo. */}
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
              />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                stroke="hsl(var(--border))"
              />
              <YAxis
                tickFormatter={formatCurrency}
                tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                stroke="hsl(var(--border))"
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Line
                type="monotone"
                dataKey="portfolio"
                stroke="#3b82f6"
                strokeWidth={2}
                name="Carteira"
                dot={{ r: 3 }}
              />
              {temBenchmark && (
                <Line
                  type="monotone"
                  dataKey="benchmark"
                  stroke="#10b981"
                  strokeWidth={2}
                  name="IBOV"
                  dot={{ r: 3 }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
