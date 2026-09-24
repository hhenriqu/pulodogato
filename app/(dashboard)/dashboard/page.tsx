"use client";

// -----------------------------------------------------------------------------
// A TELA INICIAL MOSTRAVA A CARTEIRA DE OUTRA PESSOA
// -----------------------------------------------------------------------------
// Ate a HMO-124 este arquivo montava `mockSummary` e `mockPortfolio` em cima de
// um `// TODO: Implementar chamadas para API` e renderizava tudo como se fosse
// real: R$ 55.000 de carteira, R$ 1.200 de dividendos, 100 acoes da PETR4 e um
// grafico de performance com meses de 2024 escritos no codigo. Era a PRIMEIRA
// tela depois do login -- toda pessoa que entrasse no app via o patrimonio de
// ninguem, com dois digitos de rentabilidade, e nao havia nada na tela dizendo
// que aquilo era exemplo.
//
// O conserto nao e "ligar as APIs do portfolio": elas leem `transactions`,
// `dividends` e `assets`, tabelas de um produto de investimentos que nunca
// existiu neste banco. O conserto e a tela inicial mostrar o dinheiro que o
// app de fato administra -- contas, o mes corrente, o que vence e as metas --
// usando as rotas que as fases 1 a 5 construiram.
//
// Nenhum numero aqui e calculado nesta tela: todos vem das mesmas rotas que
// alimentam as telas de detalhe. Recalcular localmente criaria uma segunda
// versao da mesma conta, e as duas telas passariam a discordar.
// -----------------------------------------------------------------------------

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  CalendarClock,
  AlertTriangle,
  Target,
  Plus,
  FileUp,
  Users,
  ArrowRight,
  Coins,
  CreditCard,
} from "lucide-react";

const moeda = (valor: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(valor);

// 'AAAA-MM-DD' -> 'DD/MM'. Fatiando a string, sem passar por Date: um
// `new Date('2026-09-30')` nasce em UTC e, no fuso de Sao Paulo, imprimiria 29.
const diaEMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

interface Conta {
  id: string;
  name: string;
  account_type: string;
  current_balance: number | string;
}

interface ResumoFluxo {
  total_income: number;
  total_expense: number;
  net: number;
}

interface ResumoMesPrevisto {
  month: string;
  total_pending: number;
  total_overdue: number;
  count_pending: number;
  count_overdue: number;
  fixed_monthly_cost: number;
}

interface PossoGastar {
  ate: string;
  diasRestantes: number;
  disponivel: number;
  receitasPrevistas: number;
  compromissos: number;
  compromissosVencidos: number;
  dividaDeCartao: number;
  livre: number;
  porDia: number;
  cartoes: { id: string; name: string; divida: number }[];
}

interface Meta {
  id: string;
  title: string;
  target_amount: number | string;
  saved: number | string;
  progress_ratio: number | string;
  status: string;
}

export default function DashboardPage() {
  const [carregando, setCarregando] = useState(true);
  const [contas, setContas] = useState<Conta[]>([]);
  const [fluxo, setFluxo] = useState<ResumoFluxo | null>(null);
  const [previstas, setPrevistas] = useState<ResumoMesPrevisto | null>(null);
  const [metas, setMetas] = useState<Meta[]>([]);
  const [possoGastar, setPossoGastar] = useState<PossoGastar | null>(null);

  useEffect(() => {
    carregar();
  }, []);

  const carregar = async () => {
    try {
      // Em paralelo de proposito: em serie, a tela inicial esperaria a soma
      // dos tempos de resposta de todas as rotas antes de mostrar qualquer
      // coisa.
      const [rContas, rFluxo, rPrevistas, rMetas, rPossoGastar] =
        await Promise.all([
          fetch("/api/financial-accounts"),
          fetch("/api/reports/cash-flow?months=1"),
          fetch("/api/scheduled-transactions/summary"),
          fetch("/api/goals?status=active"),
          fetch("/api/safe-to-spend"),
        ]);

      if (rContas.ok) {
        const d = await rContas.json();
        setContas(d.accounts ?? []);
      }

      if (rFluxo.ok) {
        const d = await rFluxo.json();
        setFluxo(d.summary ?? null);
      }

      if (rPrevistas.ok) {
        const d = await rPrevistas.json();
        // A rota devolve um resumo POR MES. A tela inicial e sobre o mes
        // corrente: pegar `summary[0]` traria o primeiro mes da janela, que
        // nem sempre e este -- e o numero estaria errado sem parecer errado.
        const mesAtual = new Date().toISOString().slice(0, 7);
        const doMes = (d.summary ?? []).find(
          (m: ResumoMesPrevisto) => m.month === mesAtual
        );
        setPrevistas(
          doMes ?? {
            month: mesAtual,
            total_pending: 0,
            total_overdue: 0,
            count_pending: 0,
            count_overdue: 0,
            fixed_monthly_cost: d.fixed_monthly_cost ?? 0,
          }
        );
      }

      if (rMetas.ok) {
        const d = await rMetas.json();
        setMetas((d.goals ?? []).slice(0, 3));
      }

      if (rPossoGastar.ok) {
        const d = await rPossoGastar.json();
        setPossoGastar(d.safe_to_spend ?? null);
      }
    } catch (erro) {
      console.error("Erro ao carregar o painel:", erro);
    } finally {
      setCarregando(false);
    }
  };

  const saldoTotal = contas.reduce(
    (soma, c) => soma + Number(c.current_balance ?? 0),
    0
  );

  if (carregando) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const semNada = contas.length === 0 && !previstas?.count_pending;

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">Visão geral</h1>
          <p className="text-muted-foreground">
            Onde o seu dinheiro está hoje, e o que vence nos próximos dias
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/personal-finance">
            <Plus className="h-4 w-4 mr-2" />
            Novo lançamento
          </Link>
        </Button>
      </div>

      {semNada && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center p-8 text-center">
            <Wallet className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">
              Ainda não há nada para mostrar
            </h3>
            <p className="text-muted-foreground mb-4 max-w-md">
              Cadastre uma conta e lance o primeiro gasto — ou importe o extrato
              do banco e o app preenche o mês inteiro de uma vez.
            </p>
            <div className="flex gap-2 flex-wrap justify-center">
              <Button asChild>
                <Link href="/dashboard/personal-finance">
                  <Plus className="h-4 w-4 mr-2" />
                  Lançar um gasto
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/dashboard/statements">
                  <FileUp className="h-4 w-4 mr-2" />
                  Importar extrato
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Os quatro numeros                                                 */}
      {/* ---------------------------------------------------------------- */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              Saldo das contas
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                saldoTotal < 0 ? "text-destructive" : ""
              }`}
            >
              {moeda(saldoTotal)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {contas.length}{" "}
              {contas.length === 1 ? "conta ativa" : "contas ativas"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Entrou neste mês
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">
              {moeda(fluxo?.total_income ?? 0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4" />
              Saiu neste mês
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* total_expense ja vem POSITIVO da rota: despesa e gravada
                negativa no banco, e a rota aplica o ABS. Repetir um Math.abs
                aqui seria inofensivo hoje e mentiria no dia em que a rota
                mudasse de convencao -- o numero viraria positivo do mesmo
                jeito e ninguem veria. */}
            <div className="text-2xl font-bold text-destructive">
              {moeda(fluxo?.total_expense ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Saldo do mês: {moeda(fluxo?.net ?? 0)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4" />
              Custo fixo mensal
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {moeda(previstas?.fixed_monthly_cost ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Soma dos gastos fixos cadastrados
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Quanto ainda posso gastar                                         */}
      {/* ---------------------------------------------------------------- */}
      {/* O numero vem inteiro de /api/safe-to-spend, que por sua vez chama
          lib/safe-to-spend.ts. Nenhuma das quatro parcelas e recalculada aqui:
          refazer a subtracao na tela criaria uma segunda versao da mesma conta,
          e no dia em que a definicao mudasse -- o que entra como divida de
          cartao, por exemplo -- o total e as parcelas passariam a discordar
          dentro do mesmo cartao. */}
      {possoGastar && (
        <Card
          className={
            possoGastar.livre < 0 ? "border-destructive/40" : "border-primary/40"
          }
        >
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Coins className="h-5 w-5" />
              Quanto ainda posso gastar
            </CardTitle>
            <CardDescription>
              O que sobra até {diaEMes(possoGastar.ate)} depois de tudo que já
              está comprometido
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end justify-between flex-wrap gap-4">
              <div>
                <div
                  className={`text-3xl font-bold ${
                    possoGastar.livre < 0 ? "text-destructive" : "text-success"
                  }`}
                >
                  {moeda(possoGastar.livre)}
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {possoGastar.livre > 0
                    ? `${moeda(possoGastar.porDia)} por dia nos ${
                        possoGastar.diasRestantes
                      } ${
                        possoGastar.diasRestantes === 1 ? "dia" : "dias"
                      } que faltam`
                    : "O mês já está comprometido além do que existe em conta — não há verba diária"}
                </p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href="/dashboard/bills">
                  Ver compromissos
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg bg-muted p-3">
                <p className="text-xs text-muted-foreground">Em conta</p>
                <p className="font-semibold">{moeda(possoGastar.disponivel)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Sem investimentos
                </p>
              </div>
              <div className="rounded-lg bg-muted p-3">
                <p className="text-xs text-muted-foreground">A receber</p>
                <p className="font-semibold text-success">
                  + {moeda(possoGastar.receitasPrevistas)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Receitas previstas
                </p>
              </div>
              <div className="rounded-lg bg-muted p-3">
                <p className="text-xs text-muted-foreground">A pagar</p>
                <p className="font-semibold text-destructive">
                  − {moeda(possoGastar.compromissos)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {possoGastar.compromissosVencidos > 0
                    ? `${moeda(possoGastar.compromissosVencidos)} em atraso`
                    : "Contas do mês"}
                </p>
              </div>
              <div className="rounded-lg bg-muted p-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <CreditCard className="h-3 w-3" />
                  No cartão
                </p>
                <p className="font-semibold text-destructive">
                  − {moeda(possoGastar.dividaDeCartao)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Fatura e período aberto
                </p>
              </div>
            </div>

            {/* A divida do cartao e a parcela que mais surpreende quem olha:
                ela inclui a compra de ontem, que ainda nao esta em fatura
                nenhuma. Abrir por cartao e o que evita a conclusao de que o
                numero esta errado. */}
            {possoGastar.cartoes.some((c) => c.divida > 0) && (
              <p className="text-xs text-muted-foreground">
                Cartões:{" "}
                {possoGastar.cartoes
                  .filter((c) => c.divida > 0)
                  .map((c) => `${c.name} ${moeda(c.divida)}`)
                  .join(" · ")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* O que vence -- e o que ja venceu                                  */}
      {/* ---------------------------------------------------------------- */}
      {!!previstas?.count_overdue && (
        <Card className="border-destructive/30 bg-destructive/10">
          <CardContent className="flex items-center justify-between p-4 flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
              <div>
                <p className="font-medium text-destructive">
                  {previstas.count_overdue}{" "}
                  {previstas.count_overdue === 1
                    ? "conta vencida"
                    : "contas vencidas"}
                </p>
                <p className="text-sm text-destructive">
                  {moeda(previstas.total_overdue)} em atraso
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/bills">
                Ver contas
                <ArrowRight className="h-4 w-4 ml-2" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <CalendarClock className="h-5 w-5" />
              A vencer neste mês
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold">
                {moeda(previstas?.total_pending ?? 0)}
              </span>
              <Badge variant="secondary">
                {previstas?.count_pending ?? 0}{" "}
                {previstas?.count_pending === 1 ? "conta" : "contas"}
              </Badge>
            </div>
            <Button variant="outline" className="w-full" asChild>
              <Link href="/dashboard/bills">Abrir Contas Previstas</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Target className="h-5 w-5" />
              Metas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {metas.length > 0 ? (
              <>
                {metas.map((meta) => {
                  // progress_ratio vem da view goal_progress (aportes dividido
                  // pelo alvo). O clamp e para a barra: uma meta superada da
                  // ratio acima de 1 e a barra estouraria o card.
                  const pct = Math.min(
                    Math.round(Number(meta.progress_ratio ?? 0) * 100),
                    100
                  );
                  return (
                    <div key={meta.id} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium truncate">
                          {meta.title}
                        </span>
                        <span className="text-muted-foreground shrink-0 ml-2">
                          {pct}%
                        </span>
                      </div>
                      <Progress value={pct} className="h-2" />
                      <p className="text-xs text-muted-foreground">
                        {moeda(Number(meta.saved ?? 0))} de{" "}
                        {moeda(Number(meta.target_amount ?? 0))}
                      </p>
                    </div>
                  );
                })}
                <Button variant="outline" className="w-full" asChild>
                  <Link href="/dashboard/goals">Ver todas</Link>
                </Button>
              </>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground mb-3">
                  Nenhuma meta ativa
                </p>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/dashboard/goals">Criar uma meta</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Contas, uma a uma                                                 */}
      {/* ---------------------------------------------------------------- */}
      {contas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Suas contas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {contas.map((conta) => (
                <div
                  key={conta.id}
                  className="flex items-center justify-between py-2 border-b last:border-0"
                >
                  <span className="text-sm">{conta.name}</span>
                  <span
                    className={`text-sm font-medium ${
                      Number(conta.current_balance) < 0 ? "text-destructive" : ""
                    }`}
                  >
                    {moeda(Number(conta.current_balance ?? 0))}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Atalhos                                                           */}
      {/* ---------------------------------------------------------------- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Button variant="outline" className="h-auto py-4 flex-col" asChild>
          <Link href="/dashboard/statements">
            <FileUp className="h-5 w-5 mb-1" />
            <span className="text-xs">Importar extrato</span>
          </Link>
        </Button>
        <Button variant="outline" className="h-auto py-4 flex-col" asChild>
          <Link href="/dashboard/budgets">
            <Wallet className="h-5 w-5 mb-1" />
            <span className="text-xs">Orçamento</span>
          </Link>
        </Button>
        <Button variant="outline" className="h-auto py-4 flex-col" asChild>
          <Link href="/dashboard/expense-groups">
            <Users className="h-5 w-5 mb-1" />
            <span className="text-xs">Grupos</span>
          </Link>
        </Button>
        <Button variant="outline" className="h-auto py-4 flex-col" asChild>
          <Link href="/dashboard/reports">
            <TrendingUp className="h-5 w-5 mb-1" />
            <span className="text-xs">Relatórios</span>
          </Link>
        </Button>
      </div>
    </div>
  );
}
