"use client";

// O CUSTO DE VIDA, dentro da tela de Investimentos.
//
// Um grafico de 24 barras -- os 12 ultimos meses fechados (realizado) e os 12
// a partir do mes corrente (previsao) -- cada barra dividida em contas fixas e
// gasto variavel, e ao lado a reserva de emergencia sugerida para 12 meses.
//
// Nenhum numero e calculado aqui: tudo vem de GET /api/investments/custo-de-vida
// (o criterio esta em lib/custo-de-vida.ts). A unica conta da tela e "quantos
// meses a carteira cobre", que divide dois numeros ja prontos.

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dica } from "@/components/ui/dica";
import { formatCurrency } from "@/lib/utils";
import type { PropsDeTooltip } from "@/types/grafico";
import type { CustoDeVida as DadosDoCusto } from "@/lib/custo-de-vida";

interface RespostaDoCusto extends DadosDoCusto {
  hoje: string;
  moeda: string;
}

interface PontoDoGrafico {
  mes: string;
  rotulo: string;
  previsto: boolean;
  realizadoFixo: number;
  realizadoVariavel: number;
  previstoFixo: number;
  previstoVariavel: number;
  total: number;
}

const NOMES_DOS_MESES = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

/** "2026-11" -> "nov/26", sem passar por Date (fuso). */
function rotuloDoMes(mes: string): string {
  const [ano, m] = mes.split("-");
  return `${NOMES_DOS_MESES[Number(m) - 1]}/${ano.slice(2)}`;
}

const COR_FIXO = "hsl(var(--primary))";
const COR_VARIAVEL = "hsl(var(--warning))";

interface Props {
  /** O valor atual da carteira, para dizer quantos meses ela cobre. */
  valorDaCarteira?: number | null;
}

export function CustoDeVida({ valorDaCarteira }: Props) {
  const [dados, setDados] = useState<RespostaDoCusto | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const resposta = await fetch("/api/investments/custo-de-vida");
        if (!resposta.ok) throw new Error(String(resposta.status));
        const corpo = (await resposta.json()) as RespostaDoCusto;
        if (vivo) setDados(corpo);
      } catch {
        if (vivo) setErro("Não foi possível calcular o custo de vida agora");
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const moeda = dados?.moeda || "BRL";
  const dinheiro = (v: number) => formatCurrency(v, moeda);
  const dinheiroCurto = (v: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: moeda,
      maximumFractionDigits: 0,
    }).format(v);

  const pontos = useMemo<PontoDoGrafico[]>(() => {
    if (!dados) return [];
    return [
      ...dados.historico.map((m) => ({
        mes: m.mes,
        rotulo: rotuloDoMes(m.mes),
        previsto: false,
        realizadoFixo: m.fixo,
        realizadoVariavel: m.variavel,
        previstoFixo: 0,
        previstoVariavel: 0,
        total: m.total,
      })),
      ...dados.previsao.map((m) => ({
        mes: m.mes,
        rotulo: rotuloDoMes(m.mes),
        previsto: true,
        realizadoFixo: 0,
        realizadoVariavel: 0,
        previstoFixo: m.fixo,
        previstoVariavel: m.variavel,
        total: m.total,
      })),
    ];
  }, [dados]);

  if (erro) {
    return (
      <Alert>
        <AlertDescription>{erro}. A carteira acima não depende disso.</AlertDescription>
      </Alert>
    );
  }
  if (!dados) return null;

  const semHistorico = dados.mesesComGasto === 0;
  const mesesCobertos =
    valorDaCarteira && valorDaCarteira > 0 && dados.mediaPrevista > 0
      ? valorDaCarteira / dados.mediaPrevista
      : null;
  const primeiroPrevisto = dados.previsao[0]?.mes;

  const TooltipDoCusto = ({ active, payload }: PropsDeTooltip<PontoDoGrafico>) => {
    if (!active || !payload || payload.length === 0) return null;
    const p = payload[0].payload;
    const fixo = p.previsto ? p.previstoFixo : p.realizadoFixo;
    const variavel = p.previsto ? p.previstoVariavel : p.realizadoVariavel;
    return (
      <div className="bg-card p-3 shadow-lg rounded-lg border text-sm space-y-0.5">
        <p className="font-medium">
          {p.rotulo} · {p.previsto ? "previsão" : "realizado"}
        </p>
        <p>Contas fixas: {dinheiro(fixo)}</p>
        <p>
          {p.previsto ? "Variável (média)" : "Variável"}: {dinheiro(variavel)}
        </p>
        <p className="font-semibold">Total: {dinheiro(p.total)}</p>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Custo de vida
          <Dica rotulo="Como o custo de vida é contado">
            Realizado: suas despesas de cada mês, na data da compra (o cartão
            conta pela compra, e o pagamento da fatura não entra de novo), sem
            transferências, e só a sua parte das despesas de grupo. Previsão:
            as contas fixas que vencem em cada mês, pela sua parte, mais a
            média do gasto variável dos últimos meses.
          </Dica>
        </CardTitle>
        <CardDescription>
          Últimos 12 meses fechados e previsão para os próximos 12
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              Reserva de emergência sugerida
              <Dica rotulo="Como a reserva é calculada">
                A soma do custo previsto para os próximos 12 meses: o que você
                precisaria guardado para manter o padrão de vida atual por um
                ano sem renda.
              </Dica>
            </p>
            <p className="text-2xl font-bold">{dinheiro(dados.reservaSugerida)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              12 meses ·{" "}
              {mesesCobertos !== null
                ? `a carteira lançada aqui equivale a ${mesesCobertos.toLocaleString("pt-BR", {
                    maximumFractionDigits: 1,
                  })} ${mesesCobertos >= 1 && mesesCobertos < 2 ? "mês" : "meses"}`
                : "para 12 meses de custo previsto"}
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">Custo médio previsto</p>
            <p className="text-2xl font-bold">{dinheiro(dados.mediaPrevista)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              por mês, dos quais {dinheiro(dados.mediaVariavel)} de gasto variável
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">Custo médio realizado</p>
            <p className="text-2xl font-bold">{dinheiro(dados.mediaRealizada)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {semHistorico
                ? "sem despesas nos últimos 12 meses"
                : `por mês, média de ${dados.mesesComGasto} ${
                    dados.mesesComGasto === 1 ? "mês" : "meses"
                  } com gasto`}
            </p>
          </div>
        </div>

        {semHistorico && (
          <p className="text-sm text-muted-foreground">
            Sem despesas lançadas nos últimos 12 meses, a previsão tem só as
            contas fixas.
          </p>
        )}

        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pontos} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="rotulo"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                stroke="hsl(var(--border))"
                interval="preserveStartEnd"
                minTickGap={8}
              />
              <YAxis
                tickFormatter={dinheiroCurto}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                stroke="hsl(var(--border))"
                width={80}
              />
              <Tooltip content={<TooltipDoCusto />} cursor={{ fill: "hsl(var(--muted))" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {primeiroPrevisto && (
                <ReferenceLine
                  x={rotuloDoMes(primeiroPrevisto)}
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="4 4"
                  label={{
                    value: "previsão",
                    position: "insideTopLeft",
                    fontSize: 11,
                    fill: "hsl(var(--muted-foreground))",
                  }}
                />
              )}
              <Bar dataKey="realizadoFixo" stackId="custo" name="Fixo (realizado)" fill={COR_FIXO} />
              <Bar
                dataKey="realizadoVariavel"
                stackId="custo"
                name="Variável (realizado)"
                fill={COR_VARIAVEL}
              />
              <Bar
                dataKey="previstoFixo"
                stackId="custo"
                name="Fixo (previsto)"
                fill={COR_FIXO}
                fillOpacity={0.4}
              />
              <Bar
                dataKey="previstoVariavel"
                stackId="custo"
                name="Variável (previsto)"
                fill={COR_VARIAVEL}
                fillOpacity={0.4}
                radius={[2, 2, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
