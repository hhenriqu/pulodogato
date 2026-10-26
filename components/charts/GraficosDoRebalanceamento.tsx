"use client";

// Os tres graficos da aba Graficos da planilha de rebalanceamento: a carteira
// como ela esta ("Tenho"), como a pessoa quer ("Quero") e por setor. Nenhum
// numero e calculado aqui: as fatias vem de lib/rebalanceamento.ts.

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PropsDeTooltip } from "@/types/grafico";
import type { FatiaDoSetor, LinhaDoRebalanceamento } from "@/lib/rebalanceamento";

// O alias e `type` pelo mesmo motivo de AssetAllocationChart: o `data` do
// recharts exige index signature, que so alias de tipo ganha implicita.
type Fatia = { name: string; value: number };

// Paleta de grafico, nao de interface: as fatias sao muitas e precisam se
// distinguir umas das outras, nos dois temas. Ciclica a partir da 12a.
const CORES = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#06b6d4",
  "#84cc16",
  "#ec4899",
  "#f97316",
  "#6366f1",
  "#14b8a6",
  "#a855f7",
];

function percentual(valor: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(valor);
}

function Pizza({
  titulo,
  descricao,
  fatias,
}: {
  titulo: string;
  descricao: string;
  fatias: Fatia[];
}) {
  // A cor sai da posicao na lista INTEIRA, antes de tirar as fatias zeradas:
  // senao o ativo com peso 0 some do "Quero", todos os seguintes trocam de cor,
  // e a comparacao com o "Tenho" ao lado fica errada sem parecer errada.
  const corDe = new Map(fatias.map((f, i) => [f.name, CORES[i % CORES.length]]));
  const visiveis = fatias.filter((f) => f.value > 0);
  const total = visiveis.reduce((s, f) => s + f.value, 0);

  const Dica = ({ active, payload }: PropsDeTooltip<Fatia>) => {
    if (!active || !payload || payload.length === 0) return null;
    const f = payload[0].payload;
    return (
      <div className="rounded-lg border bg-card p-2 text-sm shadow-lg">
        <p className="font-medium">{f.name}</p>
        <p className="text-muted-foreground">{percentual(total > 0 ? f.value / total : 0)}</p>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{titulo}</CardTitle>
        <CardDescription>{descricao}</CardDescription>
      </CardHeader>
      <CardContent>
        {visiveis.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada para mostrar ainda.</p>
        ) : (
          <>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={visiveis}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius="85%"
                    isAnimationActive={false}
                  >
                    {visiveis.map((f) => (
                      <Cell key={f.name} fill={corDe.get(f.name)} />
                    ))}
                  </Pie>
                  <Tooltip content={<Dica />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              {visiveis.map((f) => (
                <li key={f.name} className="flex min-w-0 items-center gap-1">
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: corDe.get(f.name) }}
                  />
                  <span className="truncate">{f.name}</span>
                  <span className="ml-auto text-muted-foreground">
                    {percentual(total > 0 ? f.value / total : 0)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function GraficosDoRebalanceamento({
  linhas,
  setores,
}: {
  linhas: LinhaDoRebalanceamento[];
  setores: FatiaDoSetor[];
}) {
  // Mesma ordem de ativo nos dois primeiros, para a mesma cor cair no mesmo
  // ativo e a comparacao Tenho x Quero ser de olho.
  const ordem = [...linhas].sort((a, b) => a.symbol.localeCompare(b.symbol));

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Pizza
        titulo="Tenho"
        descricao="A carteira como está hoje."
        fatias={ordem.map((l) => ({ name: l.symbol, value: l.valorAtual }))}
      />
      <Pizza
        titulo="Quero"
        descricao="A carteira pelos pesos que você deu."
        fatias={ordem.map((l) => ({ name: l.symbol, value: l.percentualIdeal ?? 0 }))}
      />
      <Pizza
        titulo="Por setor"
        descricao="Quanto você tem em cada setor hoje."
        fatias={setores.map((s) => ({ name: s.setor, value: s.valorAtual }))}
      />
    </div>
  );
}
