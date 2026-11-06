"use client";

// ---------------------------------------------------------------------------
// DESPESAS POR CATEGORIA, EM ROSCA -- o widget do Resumo do Minhas Financas
// ---------------------------------------------------------------------------
// O numero vem de /api/reports/categories (a mesma rota da tela de Relatorios),
// e o recorte em fatias de lib/widgets-do-painel.ts. Busca os proprios dados,
// como o mapa de calor: o painel so passa o periodo.
// ---------------------------------------------------------------------------

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";
import { PieChart as IconeDaRosca } from "lucide-react";
import { Cell, Pie, PieChart } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NumeroIndisponivel } from "@/components/SemRede";
import { formatarValor } from "@/lib/dinheiro";
import {
  fatiasDaRosca,
  type CategoriaDoRelatorio,
  type FatiaDaRosca,
} from "@/lib/widgets-do-painel";

export function DespesasPorCategoria({
  de,
  ate,
  rotulo,
}: {
  de: string;
  ate: string;
  rotulo: string;
}) {
  const [estado, setEstado] = useState<"carregando" | "pronto" | "erro">(
    "carregando"
  );
  const [fatias, setFatias] = useState<FatiaDaRosca[]>([]);
  const [total, setTotal] = useState(0);
  const [moeda, setMoeda] = useState("BRL");

  useEffect(() => {
    let vivo = true;
    setEstado("carregando");
    fetch(`/api/reports/categories?de=${de}&ate=${ate}`)
      .then(async (r) => {
        const dados = await r.json();
        if (!vivo) return;
        if (!r.ok || !Array.isArray(dados.categories)) {
          setEstado("erro");
          return;
        }
        const rosca = fatiasDaRosca(dados.categories as CategoriaDoRelatorio[]);
        setFatias(rosca.fatias);
        setTotal(rosca.total);
        setMoeda(typeof dados.currency === "string" ? dados.currency : "BRL");
        setEstado("pronto");
      })
      .catch((erro) => {
        console.error(erro);
        if (vivo) setEstado("erro");
      });
    return () => {
      vivo = false;
    };
  }, [de, ate]);

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <IconeDaRosca className="h-5 w-5" />
          Despesas por categoria
        </CardTitle>
        <CardDescription>{rotulo}</CardDescription>
      </CardHeader>
      <CardContent>
        {estado === "carregando" ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : estado === "erro" ? (
          <NumeroIndisponivel />
        ) : fatias.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma despesa neste período.
          </p>
        ) : (
          <RoscaDeDespesas fatias={fatias} total={total} moeda={moeda} />
        )}
        <Link
          href={"/dashboard/reports" as Route}
          className="mt-3 inline-block text-xs text-muted-foreground underline hover:text-foreground"
        >
          Ver relatórios
        </Link>
      </CardContent>
    </Card>
  );
}

/** A rosca e a legenda, sem busca: props entram, marcacao sai. */
export function RoscaDeDespesas({
  fatias,
  total,
  moeda,
}: {
  fatias: FatiaDaRosca[];
  total: number;
  moeda: string;
}) {
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative h-40 w-40 shrink-0">
        {/* Tamanho FIXO, sem ResponsiveContainer: a caixa e sempre de
            160px, e medir o pai so custaria um quadro em branco. */}
        <PieChart width={160} height={160}>
          <Pie
            data={fatias.map((f) => ({ ...f }))}
            dataKey="valor"
            nameKey="nome"
            innerRadius="68%"
            outerRadius="100%"
            stroke="none"
            isAnimationActive={false}
          >
            {fatias.map((f) => (
              <Cell key={f.id} fill={f.cor} />
            ))}
          </Pie>
        </PieChart>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-sm font-semibold tabular-nums">
            {formatarValor(total, moeda)}
          </span>
          <span className="text-xs text-muted-foreground">Total</span>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-2 text-sm">
        {fatias.map((f) => (
          <li key={f.id} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: f.cor }}
            />
            <span className="min-w-0 flex-1 truncate">{f.nome}</span>
            <span className="shrink-0 tabular-nums">
              {formatarValor(f.valor, moeda)}
            </span>
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {Math.round(f.parte * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
