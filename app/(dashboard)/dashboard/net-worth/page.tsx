"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Landmark,
  TrendingUp,
  TrendingDown,
  CreditCard,
  Wallet,
  AlertTriangle,
  Archive,
  ArrowRight,
  Minus,
} from "lucide-react";

// =====================================================
// Patrimonio liquido consolidado (HMO-145)
// =====================================================
// A tela responde "quanto eu tenho, de verdade" -- o que se tem MENOS o que se
// deve -- e, logo abaixo, DE QUE esse numero e feito.
//
// A abertura em classes e o ponto da tela, nao um enfeite. Neste banco o
// dinheiro e a divida moram na mesma coluna (`current_balance`): o cartao de
// credito vai ficando negativo conforme e usado, entao a soma crua ja e o
// patrimonio liquido. O numero sozinho e facil de calcular e dificil de ler --
// ele cai igual quando o usuario gasta e quando ele so passa a dever, e sao
// duas situacoes completamente diferentes. Separar em liquido / investimento /
// divida e o que torna os dois casos distinguiveis na tela.
//
// A barra de composicao usa como divisor o TOTAL DE ATIVOS, nunca o patrimonio
// liquido. Quem tem R$ 10.000 aplicados e R$ 9.500 de fatura tem patrimonio de
// R$ 500; dividir por ele desenharia "investimentos = 2000% da carteira", e com
// patrimonio negativo a barra inteira apareceria invertida. A regra mora em
// lib/net-worth.ts, com teste proprio.
//
// Toda cor sai de token (bg-card, text-muted-foreground, bg-success/10...).
// Uma classe de paleta fixa do Tailwind passa no build e vira um bloco claro no
// modo noturno -- o `npm run check-color-tokens` reprova, ver HMO-144.
//
// (O guard nao mascara comentario: citar aqui o nome de uma dessas classes,
// ainda que para explicar por que nao usa-la, reprova o commit.)
// =====================================================

type Classe = "liquido" | "investimento" | "divida";

interface ContaConsolidada {
  id: string;
  name: string;
  tipo: string;
  classe: Classe;
  saldo: number;
  ativa: boolean;
  color_hex: string | null;
}

interface TotalDeClasse {
  classe: Classe;
  total: number;
  participacao: number;
  contas: ContaConsolidada[];
}

interface Ponto {
  month: string;
  net_worth: number;
  net_change: number;
  variacao: number | null;
  variacaoRelativa: number | null;
}

interface Patrimonio {
  summary: {
    net_worth: number;
    total_assets: number;
    total_debts: number;
    archived_balance: number;
  };
  classes: TotalDeClasse[];
  months: Ponto[];
  window_summary: {
    inicio: number;
    fim: number;
    variacao: number;
    crescimento: number | null;
    melhorMes: Ponto | null;
    piorMes: Ponto | null;
  };
  history_available: boolean;
  caveat: string;
  window: { from: string; to: string; months: number };
}

const APARENCIA: Record<
  Classe,
  { rotulo: string; descricao: string; icone: typeof Wallet; barra: string; texto: string }
> = {
  liquido: {
    rotulo: "Disponível",
    descricao: "Conta corrente, poupança, dinheiro e carteiras digitais",
    icone: Wallet,
    barra: "bg-primary",
    texto: "text-primary",
  },
  investimento: {
    rotulo: "Investido",
    descricao: "Contas do tipo investimento",
    icone: TrendingUp,
    barra: "bg-success",
    texto: "text-success",
  },
  divida: {
    rotulo: "Dívidas",
    descricao: "Faturas de cartão de crédito em aberto",
    icone: CreditCard,
    barra: "bg-destructive",
    texto: "text-destructive",
  },
};

function brl(valor: number): string {
  return Number(valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function pct(fracao: number, casas = 1): string {
  return `${(fracao * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })}%`;
}

function rotuloMes(iso: string): string {
  // Sem passar por Date: `new Date('2026-01-01')` e lido como UTC e, no fuso do
  // Brasil, volta para dezembro de 2025 -- a linha inteira sairia um mes
  // atrasada.
  const [ano, mes] = iso.slice(0, 10).split("-");
  return `${mes}/${ano.slice(2)}`;
}

export default function NetWorthPage() {
  const [dados, setDados] = useState<Patrimonio | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [meses, setMeses] = useState("12");

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const resposta = await fetch(`/api/net-worth?months=${meses}`);
      if (!resposta.ok) {
        const corpo = await resposta.json().catch(() => ({}));
        throw new Error(corpo.error ?? "Não foi possível carregar o patrimônio");
      }
      setDados(await resposta.json());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar o patrimônio");
    } finally {
      setCarregando(false);
    }
  }, [meses]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // O grafico e um sparkline em SVG desenhado a mao, e nao uma dependencia de
  // chart: sao 12 pontos de UMA serie. A escala usa min e max REAIS, incluindo
  // negativo -- fixar o piso em zero faria uma curva inteiramente negativa
  // (quem deve mais do que tem) encostar na base e parecer constante.
  const curva = useMemo(() => {
    const pontos = dados?.months ?? [];
    if (pontos.length < 2) return null;

    const valores = pontos.map((p) => p.net_worth);
    const min = Math.min(...valores);
    const max = Math.max(...valores);
    // Faixa zero = linha reta. Sem esta guarda, dividir por (max - min) daria
    // NaN e o caminho do SVG sairia vazio, sem erro nenhum no console.
    const faixa = max - min || 1;

    const largura = 100;
    const altura = 32;
    const coords = pontos.map((p, i) => {
      const x = (i / (pontos.length - 1)) * largura;
      const y = altura - ((p.net_worth - min) / faixa) * altura;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });

    return {
      linha: coords.join(" "),
      area: `0,${altura} ${coords.join(" ")} ${largura},${altura}`,
      zeroAcima: min < 0 && max > 0,
      yZero: min < 0 && max > 0 ? altura - ((0 - min) / faixa) * altura : null,
    };
  }, [dados]);

  const classes = dados?.classes ?? [];
  const temConta = classes.some((c) => c.contas.length > 0);

  if (carregando) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Landmark className="h-8 w-8" />
            Patrimônio
          </h1>
          <p className="text-muted-foreground">
            O que você tem menos o que você deve, e de que esse número é feito
          </p>
        </div>

        <Select value={meses} onValueChange={setMeses}>
          <SelectTrigger className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="6">Últimos 6 meses</SelectItem>
            <SelectItem value="12">Últimos 12 meses</SelectItem>
            <SelectItem value="24">Últimos 24 meses</SelectItem>
            <SelectItem value="36">Últimos 36 meses</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {erro && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <p className="text-sm">{erro}</p>
            <Button size="sm" variant="outline" onClick={carregar}>
              Tentar de novo
            </Button>
          </CardContent>
        </Card>
      )}

      {dados && !temConta && (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <Wallet className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="font-medium">Você ainda não tem contas cadastradas</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              O patrimônio é a soma dos saldos das suas contas. Cadastre ao menos
              uma para o número aparecer aqui.
            </p>
            <Button asChild size="sm">
              <Link href="/dashboard/accounts">
                Cadastrar conta <ArrowRight className="h-4 w-4 ml-2" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {dados && temConta && (
        <>
          {/* ---------------- O número ---------------- */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">
                    Patrimônio líquido hoje
                  </p>
                  <p
                    className={`text-4xl font-bold ${
                      dados.summary.net_worth < 0 ? "text-destructive" : ""
                    }`}
                  >
                    {brl(dados.summary.net_worth)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {brl(dados.summary.total_assets)} em ativos
                    {dados.summary.total_debts > 0 && (
                      <> menos {brl(dados.summary.total_debts)} de dívidas</>
                    )}
                  </p>
                </div>

                {dados.history_available && dados.months.length > 1 && (
                  <div className="space-y-1 text-right">
                    <p className="text-sm text-muted-foreground">
                      Nos últimos {dados.window.months} meses
                    </p>
                    <p
                      className={`text-2xl font-semibold flex items-center justify-end gap-1 ${
                        dados.window_summary.variacao > 0
                          ? "text-success"
                          : dados.window_summary.variacao < 0
                            ? "text-destructive"
                            : ""
                      }`}
                    >
                      {dados.window_summary.variacao > 0 ? (
                        <TrendingUp className="h-5 w-5" />
                      ) : dados.window_summary.variacao < 0 ? (
                        <TrendingDown className="h-5 w-5" />
                      ) : (
                        <Minus className="h-5 w-5" />
                      )}
                      {brl(dados.window_summary.variacao)}
                    </p>
                    {/* `crescimento` vem null quando a janela comeca em zero ou
                        negativo. Nesses casos nao ha percentual honesto: de
                        -1.000 para -500 a situacao MELHOROU, e a divisao
                        devolveria -50%, que le como piora. */}
                    {dados.window_summary.crescimento !== null && (
                      <p className="text-xs text-muted-foreground">
                        {pct(dados.window_summary.crescimento)} desde{" "}
                        {rotuloMes(dados.window.from)}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {curva && (
                <div className="space-y-1">
                  <svg
                    viewBox="0 0 100 32"
                    preserveAspectRatio="none"
                    className="w-full h-24"
                    role="img"
                    aria-label={`Evolução do patrimônio em ${dados.months.length} meses`}
                  >
                    {/* A linha do zero so aparece quando a curva cruza o zero --
                        ela e a diferenca entre "ter pouco" e "dever". */}
                    {curva.yZero !== null && (
                      <line
                        x1="0"
                        x2="100"
                        y1={curva.yZero}
                        y2={curva.yZero}
                        className="stroke-destructive/40"
                        strokeWidth="0.4"
                        strokeDasharray="2 2"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                    <polygon
                      points={curva.area}
                      className="fill-primary/10"
                    />
                    <polyline
                      points={curva.linha}
                      fill="none"
                      className="stroke-primary"
                      strokeWidth="2"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{rotuloMes(dados.months[0].month)}</span>
                    <span>
                      {rotuloMes(dados.months[dados.months.length - 1].month)}
                    </span>
                  </div>
                </div>
              )}

              {!dados.history_available && (
                <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <p>
                    A evolução mês a mês não está disponível agora. O patrimônio
                    de hoje acima continua correto — ele sai direto do saldo das
                    suas contas.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ---------------- Composição ---------------- */}
          <Card>
            <CardHeader>
              <CardTitle>Composição</CardTitle>
              <CardDescription>
                Quanto de cada classe, sobre o total de ativos
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {dados.summary.total_assets > 0 && (
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
                  {classes
                    .filter((c) => c.participacao > 0)
                    .map((c) => (
                      <div
                        key={c.classe}
                        className={APARENCIA[c.classe].barra}
                        style={{ width: `${c.participacao * 100}%` }}
                        title={`${APARENCIA[c.classe].rotulo}: ${pct(c.participacao)}`}
                      />
                    ))}
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-3">
                {classes.map((c) => {
                  const { rotulo, descricao, icone: Icone, texto } =
                    APARENCIA[c.classe];
                  return (
                    <div key={c.classe} className="rounded-lg border p-4 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium flex items-center gap-2">
                          <Icone className={`h-4 w-4 ${texto}`} />
                          {rotulo}
                        </span>
                        {c.classe !== "divida" && dados.summary.total_assets > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {pct(c.participacao)}
                          </Badge>
                        )}
                      </div>
                      <p className={`text-2xl font-semibold ${c.total < 0 ? texto : ""}`}>
                        {brl(c.total)}
                      </p>
                      <p className="text-xs text-muted-foreground">{descricao}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.contas.length === 1
                          ? "1 conta"
                          : `${c.contas.length} contas`}
                      </p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* ---------------- Contas ---------------- */}
          <Card>
            <CardHeader>
              <CardTitle>Contas</CardTitle>
              <CardDescription>
                Agrupadas pela classe que cada uma ocupa no patrimônio
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {classes
                .filter((c) => c.contas.length > 0)
                .map((c) => (
                  <div key={c.classe} className="space-y-2">
                    <div className="flex items-center justify-between text-sm font-medium">
                      <span className="flex items-center gap-2">
                        {APARENCIA[c.classe].rotulo}
                      </span>
                      <span>{brl(c.total)}</span>
                    </div>
                    {c.contas.map((conta) => (
                      <div
                        key={conta.id}
                        className="flex items-center justify-between border-b py-2 text-sm last:border-0"
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className="h-3 w-3 rounded-sm"
                            style={{
                              backgroundColor:
                                conta.color_hex ?? "currentColor",
                            }}
                          />
                          {conta.name}
                          {!conta.ativa && (
                            <Badge variant="outline" className="text-xs gap-1">
                              <Archive className="h-3 w-3" />
                              arquivada
                            </Badge>
                          )}
                        </span>
                        <span
                          className={
                            conta.saldo < 0
                              ? "font-medium text-destructive"
                              : "font-medium"
                          }
                        >
                          {brl(conta.saldo)}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}

              {/* A conta arquivada CONTA no patrimônio, de propósito: dinheiro
                  parado numa conta encerrada continua sendo dinheiro, e tirá-lo
                  faria o patrimônio cair de degrau no mês em que alguém
                  arquivou a conta, sem nenhuma transação explicando a queda.
                  Como isso surpreende, a tela diz quanto é. */}
              {dados.summary.archived_balance !== 0 && (
                <p className="text-xs text-muted-foreground">
                  {brl(dados.summary.archived_balance)} do total está em conta
                  arquivada. Contas arquivadas continuam somando: o saldo
                  residual ainda é seu.
                </p>
              )}
            </CardContent>
          </Card>

          {/* ---------------- O aviso ---------------- */}
          <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>{dados.caveat}</p>
          </div>
        </>
      )}
    </div>
  );
}
