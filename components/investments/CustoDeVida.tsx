"use client";

// O CUSTO DE VIDA, dentro da tela de Investimentos.
//
// Mora na tela propria /dashboard/investments/custo-de-vida (menu
// Investimentos > Custo de vida). Era uma secao da Carteira ate o pedido do
// Helio de separar e poder desligar o variavel.
//
// Um grafico de 24 barras -- os 12 ultimos meses fechados (realizado) e os 12
// a partir do mes corrente (previsao) -- cada barra dividida em contas fixas e
// gasto variavel, e ao lado a reserva de emergencia sugerida para 12 meses.
//
// Nenhum numero e calculado aqui: tudo vem de GET /api/investments/custo-de-vida
// (o criterio esta em lib/custo-de-vida.ts). A unica conta da tela e "quantos
// meses a carteira cobre", que divide dois numeros ja prontos.
//
// A CHAVE "CONSIDERAR GASTO VARIAVEL": desligada, o grafico mostra so as
// contas fixas e a reserva vira "12 meses de contas fixas"
// (`resumoDoCusto`, lib/custo-de-vida.ts). A escolha fica no navegador, so
// como conveniencia: sem ela a tela abre ligada.

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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatCurrency } from "@/lib/utils";
import type { PropsDeTooltip } from "@/types/grafico";
import { resumoDoCusto, type CustoDeVida as DadosDoCusto } from "@/lib/custo-de-vida";

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

const CHAVE_DO_VARIAVEL = "custo-de-vida:com-variavel";

function lerPreferencia(): boolean {
  try {
    return window.localStorage.getItem(CHAVE_DO_VARIAVEL) !== "nao";
  } catch {
    return true;
  }
}

function gravarPreferencia(comVariavel: boolean) {
  try {
    window.localStorage.setItem(CHAVE_DO_VARIAVEL, comVariavel ? "sim" : "nao");
  } catch {
    // Sem armazenamento (aba privada): a chave so vale ate recarregar.
  }
}

interface Props {
  /** O valor atual da carteira, para dizer quantos meses ela cobre. */
  valorDaCarteira?: number | null;
}

export function CustoDeVida({ valorDaCarteira }: Props) {
  const [dados, setDados] = useState<RespostaDoCusto | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [comVariavel, setComVariavel] = useState(true);

  useEffect(() => {
    setComVariavel(lerPreferencia());
  }, []);

  const mudarVariavel = (valor: boolean) => {
    setComVariavel(valor);
    gravarPreferencia(valor);
  };

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
        realizadoVariavel: comVariavel ? m.variavel : 0,
        previstoFixo: 0,
        previstoVariavel: 0,
        total: comVariavel ? m.total : m.fixo,
      })),
      ...dados.previsao.map((m) => ({
        mes: m.mes,
        rotulo: rotuloDoMes(m.mes),
        previsto: true,
        realizadoFixo: 0,
        realizadoVariavel: 0,
        previstoFixo: m.fixo,
        previstoVariavel: comVariavel ? m.variavel : 0,
        total: comVariavel ? m.total : m.fixo,
      })),
    ];
  }, [dados, comVariavel]);

  if (erro) {
    return (
      <Alert>
        <AlertDescription>{erro}. Tente recarregar a página.</AlertDescription>
      </Alert>
    );
  }
  if (!dados) return null;

  const semHistorico = dados.mesesComGasto === 0;
  const resumo = resumoDoCusto(dados, comVariavel);
  const mesesCobertos =
    valorDaCarteira && valorDaCarteira > 0 && resumo.mediaPrevista > 0
      ? valorDaCarteira / resumo.mediaPrevista
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
        {comVariavel && (
          <p>
            {p.previsto ? "Variável (média)" : "Variável"}: {dinheiro(variavel)}
          </p>
        )}
        <p className="font-semibold">Total: {dinheiro(p.total)}</p>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Mês a mês
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
        <div className="flex items-center gap-3">
          <Switch
            id="custo-com-variavel"
            checked={comVariavel}
            onCheckedChange={mudarVariavel}
          />
          <Label htmlFor="custo-com-variavel" className="cursor-pointer">
            Considerar gasto variável
          </Label>
          {!comVariavel && (
            <span className="text-xs text-muted-foreground">mostrando só as contas fixas</span>
          )}
        </div>

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
            <p className="text-2xl font-bold">{dinheiro(resumo.reserva)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {comVariavel ? "12 meses" : "12 meses de contas fixas"} ·{" "}
              {mesesCobertos !== null
                ? `a carteira lançada aqui equivale a ${mesesCobertos.toLocaleString("pt-BR", {
                    maximumFractionDigits: 1,
                  })} ${mesesCobertos >= 1 && mesesCobertos < 2 ? "mês" : "meses"}`
                : "para 12 meses de custo previsto"}
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">Custo médio previsto</p>
            <p className="text-2xl font-bold">{dinheiro(resumo.mediaPrevista)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {comVariavel
                ? `por mês, dos quais ${dinheiro(dados.mediaVariavel)} de gasto variável`
                : `por mês, só contas fixas (sem ${dinheiro(dados.mediaVariavel)} de variável)`}
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">Custo médio realizado</p>
            <p className="text-2xl font-bold">{dinheiro(resumo.mediaRealizada)}</p>
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
              {comVariavel && (
              <Bar
                dataKey="realizadoVariavel"
                stackId="custo"
                name="Variável (realizado)"
                fill={COR_VARIAVEL}
              />
              )}
              <Bar
                dataKey="previstoFixo"
                stackId="custo"
                name="Fixo (previsto)"
                fill={COR_FIXO}
                fillOpacity={0.4}
              />
              {comVariavel && (
              <Bar
                dataKey="previstoVariavel"
                stackId="custo"
                name="Variável (previsto)"
                fill={COR_VARIAVEL}
                fillOpacity={0.4}
                radius={[2, 2, 0, 0]}
              />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
