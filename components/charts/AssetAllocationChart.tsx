"use client";

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
  type PieLabelRenderProps,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PropsDeTooltip } from "@/types/grafico";

// `type`, e nao `interface`, e nao e estilo: os dois lados precisam encaixar.
// Entra `FatiaAlocacao` (lib/investments.ts), que e uma interface sem index
// signature; sai para o `data` do recharts, que exige `ChartDataInput` -- COM
// index signature. O TypeScript da index signature implicita para alias de tipo
// e nao da para interface, entao o alias atende os dois e o `[key: string]: any`
// que estava aqui (a unica coisa que fazia a passagem compilar) sai de cena.
type AssetAllocationData = {
  name: string;
  value: number;
  percentage: number;
};

interface AssetAllocationChartProps {
  data: AssetAllocationData[];
}

const COLORS = {
  Ações: "#3b82f6", // blue-500
  FIIs: "#10b981", // emerald-500
  "Renda Fixa": "#f59e0b", // amber-500
  Internacional: "#8b5cf6", // violet-500
};

export function AssetAllocationChart({ data }: AssetAllocationChartProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  const CustomTooltip = ({
    active,
    payload,
  }: PropsDeTooltip<AssetAllocationData>) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-card p-3 shadow-lg rounded-lg border">
          <p className="font-medium">{data.name}</p>
          <p className="text-info">{formatCurrency(data.value)}</p>
          <p className="text-muted-foreground">{data.percentage.toFixed(1)}%</p>
        </div>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alocação de Ativos</CardTitle>
        <CardDescription>
          Distribuição da sua carteira por tipo de investimento
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                labelLine={false}
                // O recharts tipa o render do rotulo com as props do SVG da
                // fatia, e espalha os campos do ponto de dados por cima. Dai a
                // assercao: a assinatura tem que aceitar `PieLabelRenderProps`
                // para encaixar em `PieLabel`, e o que a gente le e a fatia.
                label={(props: PieLabelRenderProps) => {
                  const fatia = props as unknown as AssetAllocationData;
                  return `${fatia.name}: ${fatia.percentage.toFixed(1)}%`;
                }}
                // Sem isso o rotulo sai no cinza escuro padrao do recharts e
                // fica ilegivel sobre o card escuro.
                style={{ fill: "hsl(var(--foreground))" }}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {data.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={
                      COLORS[entry.name as keyof typeof COLORS] || "#8884d8"
                    }
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
