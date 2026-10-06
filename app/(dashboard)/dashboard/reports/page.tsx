"use client";

// Relatorios.
//
// Esta tela era um MOCK: quatro cartoes com um botao "Gerar" que nao chamava
// nada. Agora sao quatro relatorios de verdade, lidos das views da migration
// 008 pelas rotas /api/reports/*.
//
// SOBRE O SINAL: as views devolvem `expense` sempre POSITIVO (elas aplicam
// ABS), porque despesa e gravada NEGATIVA no banco. A tela nao inverte nada --
// se algum numero aparecer negativo aqui, o erro esta na view, nao no
// componente.
//
// SOBRE O PDF: nao ha geracao no servidor, e foi decisao. O botao "Salvar em
// PDF" chama window.print(), e as classes `print:` abaixo escondem a navegacao
// e os controles. O usuario escolhe "Salvar como PDF" no dialogo do sistema e
// leva o relatorio COM os graficos -- que um PDF gerado no servidor teria que
// redesenhar do zero. Ver o cabecalho de app/api/reports/export/route.ts.

import { useCallback, useEffect, useMemo, useState } from "react";
import { User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";
import {
  SoftFeatureGuard,
  PremiumBadge,
} from "@/components/subscription/SoftFeatureGuard";
import { AnomaliesCard } from "@/components/financial/AnomaliesCard";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  ComposedChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  Download,
  Loader2,
  Printer,
  TrendingDown,
  TrendingUp,
  Wallet,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import type {
  CashFlowReport,
  CategoryReport,
  PlannedVsActualReport,
  NetWorthReport,
} from "@/types/financial";
import { legendaDoCartao } from "@/lib/criterio-do-cartao";

const moeda = (valor: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    valor
  );

// Valor curto para o eixo: "R$ 12,5 mil" em vez de "R$ 12.500,00", que num
// eixo de 12 meses se sobrepoe e fica ilegivel.
const moedaCurta = (valor: number) => {
  const abs = Math.abs(valor);
  if (abs >= 1000000) return `${(valor / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `${(valor / 1000).toFixed(0)}k`;
  return String(Math.round(valor));
};

const MESES_CURTOS = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

// 'YYYY-MM-01' -> 'set/26', sem passar por new Date(): a string ISO e lida
// como UTC e, no fuso do Brasil, voltaria um mes.
const rotuloMes = (iso: string) => {
  const [ano, mes] = iso.slice(0, 7).split("-");
  return `${MESES_CURTOS[Number(mes) - 1]}/${ano.slice(2)}`;
};

// Paleta das categorias. Ciclica de proposito: com mais categorias do que
// cores, repetir e melhor do que gerar cor aleatoria, que muda a cada render e
// faz a mesma categoria trocar de cor entre a pizza e a barra.
const CORES = [
  "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
];

const JANELAS = [
  { valor: "3", rotulo: "3 meses" },
  { valor: "6", rotulo: "6 meses" },
  { valor: "12", rotulo: "12 meses" },
  { valor: "24", rotulo: "24 meses" },
];

function TooltipMoeda({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card p-3 shadow-lg rounded-lg border text-sm">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color ?? p.fill }}>
          {p.name}: {moeda(Number(p.value))}
        </p>
      ))}
    </div>
  );
}

export default function ReportsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [carregandoUser, setCarregandoUser] = useState(true);
  const [carregando, setCarregando] = useState(true);
  const [meses, setMeses] = useState("12");

  const [fluxo, setFluxo] = useState<CashFlowReport | null>(null);
  const [categorias, setCategorias] = useState<CategoryReport | null>(null);
  const [previsto, setPrevisto] = useState<PlannedVsActualReport | null>(null);
  const [patrimonio, setPatrimonio] = useState<NetWorthReport | null>(null);

  const supabase = createClient();

  useEffect(() => {
    const pegarUsuario = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);
      setCarregandoUser(false);
    };
    pegarUsuario();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const q = `?months=${meses}`;
      const [f, c, p, n] = await Promise.all([
        fetch(`/api/reports/cash-flow${q}`),
        fetch(`/api/reports/categories${q}`),
        fetch(`/api/reports/planned-vs-actual${q}`),
        fetch(`/api/reports/net-worth${q}`),
      ]);

      if (f.ok) setFluxo(await f.json());
      if (c.ok) setCategorias(await c.json());
      if (p.ok) setPrevisto(await p.json());
      if (n.ok) setPatrimonio(await n.json());

      if (!f.ok && !c.ok && !p.ok && !n.ok) {
        toast.error("Não foi possível carregar os relatórios");
      }
    } catch {
      toast.error("Não foi possível carregar os relatórios");
    } finally {
      setCarregando(false);
    }
  }, [meses]);

  useEffect(() => {
    if (user) carregar();
  }, [user, carregar]);

  const exportar = (relatorio: string) => {
    // Navegacao direta em vez de fetch + blob: o Content-Disposition da rota ja
    // faz o browser baixar, e passar pelo JS exigiria carregar o CSV inteiro na
    // memoria da aba so para entrega-lo de volta ao mesmo browser.
    window.location.href = `/api/reports/export?report=${relatorio}&months=${meses}`;
  };

  const dadosFluxo = useMemo(
    () =>
      (fluxo?.months ?? []).map((m) => ({
        mes: rotuloMes(m.month),
        Entradas: m.income,
        Saídas: m.expense,
        Resultado: m.net,
      })),
    [fluxo]
  );

  // A LEGENDA DO CRITERIO DO CARTAO (HMO-266). Uma CHAMADA so, e nao a chamada
  // repetida na condicao e no corpo do JSX: guard textual com dois call sites
  // fica verde depois de alguem matar um deles.
  const legendaDoFluxo = legendaDoCartao(fluxo?.cartao);

  const dadosCategorias = useMemo(
    () =>
      (categorias?.categories ?? [])
        .filter((c) => c.expense > 0)
        .slice(0, 10)
        .map((c, i) => ({
          name: c.category?.name ?? "Sem categoria",
          value: c.expense,
          share: c.share,
          cor: c.category?.color_hex || CORES[i % CORES.length],
        })),
    [categorias]
  );

  const dadosPrevisto = useMemo(
    () =>
      (previsto?.months ?? []).map((m) => ({
        mes: rotuloMes(m.month),
        Previsto: m.planned_expense,
        Realizado: m.actual_expense,
      })),
    [previsto]
  );

  const dadosPatrimonio = useMemo(
    () =>
      (patrimonio?.months ?? []).map((m) => ({
        mes: rotuloMes(m.month),
        Patrimônio: m.net_worth,
        Variação: m.net_change,
      })),
    [patrimonio]
  );

  if (carregandoUser) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <SoftFeatureGuard feature="advanced_reports" user={user}>
      <div className="container mx-auto py-6 space-y-6 print:py-0">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <BarChart3 className="h-8 w-8 print:hidden" />
              Relatórios
              <span className="print:hidden">
                <PremiumBadge feature="advanced_reports" user={user} />
              </span>
            </h1>
            <p className="text-muted-foreground">
              {fluxo
                ? `De ${rotuloMes(fluxo.window.from)} a ${rotuloMes(fluxo.window.to)}`
                : "Análise das suas finanças"}
            </p>
          </div>

          {/*
            O `flex-wrap` aqui e o resto da HMO-168, e ele so apareceu DEPOIS do
            primeiro conserto: com o cabecalho ja quebrando e a barra de abas ja
            rolando, sobraram 6px de vazamento em 320px. O seletor de janela
            (`w-36` = 144px) mais "Salvar em PDF" (158px) mais o gap dao 310px,
            e o container deixa 288px uteis. Um vazamento de 6px nao chama
            atencao de ninguem e mexe a pagina do mesmo jeito.
          */}
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Select value={meses} onValueChange={setMeses}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {JANELAS.map((j) => (
                  <SelectItem key={j.valor} value={j.valor}>
                    {j.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-2" />
              Salvar em PDF
            </Button>
          </div>
        </div>

        {carregando ? (
          <div className="flex items-center justify-center min-h-[300px]">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* Os quatro numeros que resumem a janela inteira. */}
            <div className="grid gap-4 md:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-success" />
                    Entradas
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-success">
                    {moeda(fluxo?.summary.total_income ?? 0)}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-2">
                    <TrendingDown className="h-4 w-4 text-destructive" />
                    Saídas
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-destructive">
                    {moeda(fluxo?.summary.total_expense ?? 0)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    média de {moeda(fluxo?.summary.average_expense ?? 0)}/mês
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Resultado</CardDescription>
                </CardHeader>
                <CardContent>
                  <p
                    className={`text-2xl font-bold ${
                      (fluxo?.summary.net ?? 0) >= 0
                        ? "text-success"
                        : "text-destructive"
                    }`}
                  >
                    {moeda(fluxo?.summary.net ?? 0)}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-2">
                    <Wallet className="h-4 w-4" />
                    Patrimônio hoje
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">
                    {moeda(patrimonio?.summary.current ?? 0)}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Antes das abas de proposito: os relatorios abaixo respondem
                "quanto", e este responde "o que mudou". Quem abre esta tela
                depois de um mes caro procura a segunda resposta, e ela nao
                aparece em nenhum dos quatro graficos. */}
            <AnomaliesCard />

            <Tabs defaultValue="fluxo" className="space-y-4">
              <TabsList className="print:hidden">
                <TabsTrigger value="fluxo">Fluxo de caixa</TabsTrigger>
                <TabsTrigger value="categorias">Categorias</TabsTrigger>
                <TabsTrigger value="previsto">Previsto × realizado</TabsTrigger>
                <TabsTrigger value="patrimonio">Patrimônio</TabsTrigger>
              </TabsList>

              {/* ---------------- Fluxo de caixa ---------------- */}
              <TabsContent
                value="fluxo"
                className="space-y-4 print:block print:!mt-0"
              >
                <Card>
                  <CardHeader className="flex-row items-start justify-between space-y-0">
                    <div>
                      <CardTitle>Entradas e saídas por mês</CardTitle>
                      <CardDescription>
                        Transferências entre suas contas não entram: mover
                        dinheiro não é receita nem gasto
                      </CardDescription>
                      {/* ------------------------------------------------------
                          A LEGENDA DO CRITERIO DO CARTAO (HMO-266)
                          ------------------------------------------------------
                          O custo da decisao do Helio (opcao "consumo"): este
                          grafico e o painel mostram totais diferentes para o
                          MESMO periodo -- medidos R$ 7.545 aqui contra R$ 3.345
                          la, na fixture de 6 meses. Os dois estao certos, e sem
                          esta linha a unica leitura possivel e "um dos dois esta
                          com bug" (que e como a HMO-258 nasceu).

                          O texto sai de `fluxo.cartao`, o campo que a rota
                          devolve, e nao de uma constante local: se o criterio
                          desta tela mudar algum dia, a legenda muda com ele em
                          vez de passar a mentir calada. A outra metade do par
                          esta no painel, e as duas moram em
                          lib/criterio-do-cartao.ts. */}
                      {legendaDoFluxo && (
                        <p className="text-xs text-muted-foreground mt-2 max-w-prose">
                          {legendaDoFluxo}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="print:hidden"
                      onClick={() => exportar("cash-flow")}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      CSV
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={dadosFluxo}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="mes" fontSize={12} />
                          <YAxis tickFormatter={moedaCurta} fontSize={12} />
                          <Tooltip content={<TooltipMoeda />} />
                          <Legend />
                          <Bar dataKey="Entradas" fill="#10b981" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="Saídas" fill="#ef4444" radius={[4, 4, 0, 0]} />
                          <Line
                            type="monotone"
                            dataKey="Resultado"
                            stroke="#3b82f6"
                            strokeWidth={2}
                            dot={false}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                <Card className="print:hidden">
                  <CardHeader>
                    <CardTitle className="text-lg">Extrato completo</CardTitle>
                    <CardDescription>
                      Um lançamento por linha, para conferir qualquer número
                      acima na planilha
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button
                      variant="outline"
                      onClick={() => exportar("transactions")}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Baixar extrato em CSV
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ---------------- Categorias ---------------- */}
              <TabsContent value="categorias" className="space-y-4">
                <Card>
                  <CardHeader className="flex-row items-start justify-between space-y-0">
                    <div>
                      <CardTitle>No que você gastou</CardTitle>
                      <CardDescription>
                        {categorias?.summary.category_count ?? 0} categorias ·{" "}
                        {moeda(categorias?.summary.total_expense ?? 0)} no período
                      </CardDescription>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="print:hidden"
                      onClick={() => exportar("categories")}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      CSV
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {dadosCategorias.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-12 text-center">
                        Nenhum gasto registrado no período.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                        <div className="h-80">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={dadosCategorias}
                                dataKey="value"
                                nameKey="name"
                                cx="50%"
                                cy="50%"
                                outerRadius={110}
                              >
                                {dadosCategorias.map((d) => (
                                  <Cell key={d.name} fill={d.cor} />
                                ))}
                              </Pie>
                              <Tooltip content={<TooltipMoeda />} />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>

                        <div className="space-y-3 self-center">
                          {dadosCategorias.map((d) => (
                            <div key={d.name} className="space-y-1">
                              <div className="flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2">
                                  <span
                                    className="h-3 w-3 rounded-sm"
                                    style={{ backgroundColor: d.cor }}
                                  />
                                  {d.name}
                                </span>
                                <span className="font-medium">
                                  {moeda(d.value)}
                                </span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-muted">
                                <div
                                  className="h-1.5 rounded-full"
                                  style={{
                                    width: `${Math.min(d.share * 100, 100)}%`,
                                    backgroundColor: d.cor,
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ---------------- Previsto x realizado ---------------- */}
              <TabsContent value="previsto" className="space-y-4">
                <Card>
                  <CardHeader className="flex-row items-start justify-between space-y-0">
                    <div>
                      <CardTitle>Previsto × realizado</CardTitle>
                      <CardDescription>
                        O que estava na agenda de contas previstas contra o que
                        de fato saiu da conta
                      </CardDescription>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="print:hidden"
                      onClick={() => exportar("planned")}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      CSV
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {(previsto?.summary.months_with_plan ?? 0) === 0 && (
                      <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
                        <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                        <p>
                          Nenhum mês do período tinha conta prevista cadastrada.
                          Cadastre seus gastos fixos em{" "}
                          <strong>Contas previstas</strong> para este relatório
                          ter com o que comparar.
                        </p>
                      </div>
                    )}

                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dadosPrevisto}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="mes" fontSize={12} />
                          <YAxis tickFormatter={moedaCurta} fontSize={12} />
                          <Tooltip content={<TooltipMoeda />} />
                          <Legend />
                          <Bar dataKey="Previsto" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="Realizado" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3 text-sm">
                      <div>
                        <p className="text-muted-foreground">Previsto no período</p>
                        <p className="text-lg font-semibold">
                          {moeda(previsto?.summary.total_planned_expense ?? 0)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Realizado</p>
                        <p className="text-lg font-semibold">
                          {moeda(previsto?.summary.total_actual_expense ?? 0)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Diferença</p>
                        <p
                          className={`text-lg font-semibold ${
                            (previsto?.summary.variance ?? 0) > 0
                              ? "text-destructive"
                              : "text-success"
                          }`}
                        >
                          {(previsto?.summary.variance ?? 0) > 0 ? "+" : ""}
                          {moeda(previsto?.summary.variance ?? 0)}
                        </p>
                      </div>
                    </div>

                    {(previsto?.summary.overdue_count ?? 0) > 0 && (
                      <Badge className="bg-destructive/10 text-destructive">
                        {previsto?.summary.overdue_count} conta(s) vencida(s)
                        sem baixa
                      </Badge>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ---------------- Patrimônio ---------------- */}
              <TabsContent value="patrimonio" className="space-y-4">
                <Card>
                  <CardHeader className="flex-row items-start justify-between space-y-0">
                    <div>
                      <CardTitle>Evolução do patrimônio</CardTitle>
                      <CardDescription>
                        Soma dos saldos das suas contas, mês a mês
                      </CardDescription>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="print:hidden"
                      onClick={() => exportar("net-worth")}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      CSV
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={dadosPatrimonio}>
                          <defs>
                            <linearGradient id="grad-patrimonio" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="mes" fontSize={12} />
                          <YAxis tickFormatter={moedaCurta} fontSize={12} />
                          <Tooltip content={<TooltipMoeda />} />
                          <Area
                            type="monotone"
                            dataKey="Patrimônio"
                            stroke="#3b82f6"
                            strokeWidth={2}
                            fill="url(#grad-patrimonio)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>

                    {/* O aviso que a rota manda junto. Escondê-lo faria o
                        usuário decidir sobre um número que o próprio app sabe
                        que pode estar deslocado. */}
                    {patrimonio?.caveat && (
                      <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                        <p>{patrimonio.caveat}</p>
                      </div>
                    )}

                    <div className="space-y-2">
                      <p className="text-sm font-medium">Contas hoje</p>
                      {(patrimonio?.accounts ?? []).map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center justify-between text-sm py-1 border-b last:border-0"
                        >
                          <span className="flex items-center gap-2">
                            <span
                              className="h-3 w-3 rounded-sm"
                              style={{ backgroundColor: c.color_hex || "#3b82f6" }}
                            />
                            {c.name}
                            {!c.is_active && (
                              <Badge variant="outline" className="text-xs">
                                inativa
                              </Badge>
                            )}
                          </span>
                          <span
                            className={
                              Number(c.current_balance) < 0
                                ? "text-destructive font-medium"
                                : "font-medium"
                            }
                          >
                            {moeda(Number(c.current_balance ?? 0))}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </SoftFeatureGuard>
  );
}
