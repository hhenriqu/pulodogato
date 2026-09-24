"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  CalendarClock,
  LineChart,
  Repeat,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

// =====================================================
// Previsao de fluxo de caixa (HMO-145)
// =====================================================
// A tela existe para UMA resposta: a data em que o saldo fica negativo. Por
// isso o bloco de cima e uma frase com uma data, e nao um grafico -- o grafico
// vem depois, para mostrar o caminho ate ela.
//
// O que ela promete e exatamente o que a conta sabe, e o rodape diz o limite em
// voz alta: gasto do dia a dia (mercado, restaurante, posto) NAO entra. Uma
// data que nasce de uma media invisivel e uma data que o usuario nao tem como
// conferir. Ver o cabecalho do lib/cash-flow-forecast.ts.
//
// Toda cor sai de token (bg-card, text-muted-foreground, text-destructive...).
// Uma classe de paleta fixa do Tailwind passa no build e vira um bloco claro no
// modo noturno -- o `npm run check-color-tokens` reprova, ver HMO-144. O
// grafico usa hsl(var(--token)) pelo mesmo motivo: a cor da linha precisa mudar
// junto com o tema.
// =====================================================

interface EventoDoFluxo {
  id: string;
  data: string;
  descricao: string;
  valor: number;
  origem: "prevista" | "recorrencia";
  vencida?: boolean;
  saldoDepois: number;
}

interface DiaDoFluxo {
  data: string;
  entra: number;
  sai: number;
  saldo: number;
}

interface FluxoDeCaixa {
  de: string;
  ate: string;
  dias: number;
  saldoInicial: number;
  comecaNegativo: boolean;
  primeiroDiaNegativo: string | null;
  saldoFinal: number;
  menorSaldo: number;
  diaDoMenorSaldo: string;
  totalEntra: number;
  totalSai: number;
  absorvidasPelaAgenda: string[];
  linha: DiaDoFluxo[];
}

const HORIZONTES = [30, 60, 90] as const;

function formatarBRL(valor: number): string {
  return Number(valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatarData(iso: string): string {
  if (!iso) return "-";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

function formatarDiaMes(iso: string): string {
  const [, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}`;
}

/**
 * Quantos dias faltam ate `alvo`, contando a partir de `de`.
 *
 * Aritmetica de string convertida em UTC, nunca `new Date(iso)` lido com
 * getDate(): no fuso de Sao Paulo isso devolve o dia anterior, e a tela diria
 * "faltam 11 dias" para quem tem 12.
 */
function diasAte(de: string, alvo: string): number {
  const utc = (iso: string) => {
    const [a, m, d] = iso.split("-").map(Number);
    return Date.UTC(a, m - 1, d);
  };
  return Math.round((utc(alvo) - utc(de)) / 86400000);
}

/**
 * A linha do saldo, em SVG puro.
 *
 * Sem biblioteca de grafico de proposito: sao 30 a 90 pontos de uma serie so, e
 * o que precisa ficar visivel e uma coisa -- onde a linha cruza o zero. Um
 * `<path>` e uma regua no zero fazem isso e carregam nada.
 */
function LinhaDoSaldo({ fluxo }: { fluxo: FluxoDeCaixa }) {
  const pontos = fluxo.linha;
  if (pontos.length < 2) return null;

  const largura = 720;
  const altura = 160;
  const saldos = pontos.map((p) => p.saldo);
  // O zero entra na escala sempre: sem ele uma serie inteiramente positiva
  // desenharia a regua do zero fora do quadro, e a unica coisa que a tela
  // precisa mostrar sumiria.
  const maximo = Math.max(...saldos, 0);
  const minimo = Math.min(...saldos, 0);
  const amplitude = maximo - minimo || 1;

  const x = (i: number) => (i / (pontos.length - 1)) * largura;
  const y = (v: number) => altura - ((v - minimo) / amplitude) * altura;

  const caminho = pontos
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.saldo).toFixed(1)}`)
    .join(" ");

  const yZero = y(0);
  const negativo = fluxo.menorSaldo < 0;

  return (
    <svg
      viewBox={`0 0 ${largura} ${altura}`}
      className="h-40 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Saldo projetado de ${formatarData(fluxo.de)} a ${formatarData(fluxo.ate)}`}
    >
      <line
        x1="0"
        x2={largura}
        y1={yZero}
        y2={yZero}
        stroke="hsl(var(--border))"
        strokeWidth="1"
        strokeDasharray="4 4"
      />
      <path
        d={caminho}
        fill="none"
        stroke={negativo ? "hsl(var(--destructive))" : "hsl(var(--primary))"}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function CashFlowPage() {
  const [fluxo, setFluxo] = useState<FluxoDeCaixa | null>(null);
  const [eventos, setEventos] = useState<EventoDoFluxo[]>([]);
  const [semAssinaturas, setSemAssinaturas] = useState(false);
  const [dias, setDias] = useState<number>(90);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const resp = await fetch(`/api/cash-flow?dias=${dias}`);
      if (!resp.ok) throw new Error("Não foi possível carregar a previsão.");
      const dados = await resp.json();
      setFluxo(dados.cash_flow);
      setEventos(dados.upcoming || []);
      setSemAssinaturas(Boolean(dados.recorrencias_indisponiveis));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado.");
    } finally {
      setCarregando(false);
    }
  }, [dias]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const faltam = fluxo?.primeiroDiaNegativo
    ? diasAte(fluxo.de, fluxo.primeiroDiaNegativo)
    : null;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <LineChart className="h-6 w-6 text-primary" />
            Previsão de fluxo de caixa
          </h1>
          <p className="text-sm text-muted-foreground">
            Como o seu saldo caminha, dia a dia, com o que já está comprometido.
          </p>
        </div>
        <div className="flex gap-1">
          {HORIZONTES.map((h) => (
            <Button
              key={h}
              variant={dias === h ? "default" : "outline"}
              size="sm"
              onClick={() => setDias(h)}
            >
              {h} dias
            </Button>
          ))}
        </div>
      </div>

      {erro && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-2 pt-6 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm">{erro}</span>
          </CardContent>
        </Card>
      )}

      {/* A rota seguiu sem as assinaturas: a linha ficou OTIMISTA e a tela tem
          que dizer isso. Calar aqui seria mostrar uma data de mergulho mais
          tardia do que a real, que e o erro que esta tela existe para evitar. */}
      {semAssinaturas && (
        <div className="flex items-start gap-2 rounded-md border border-warning bg-warning/10 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span className="text-sm text-foreground">
            Não foi possível ler as suas assinaturas agora. A previsão abaixo
            está <strong>otimista</strong>: as cobranças recorrentes não entraram
            na conta.
          </span>
        </div>
      )}

      {carregando ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Calculando...
          </CardContent>
        </Card>
      ) : !fluxo ? null : (
        <>
          {/* A resposta pela qual a tela existe. */}
          <Card
            className={
              fluxo.primeiroDiaNegativo || fluxo.comecaNegativo
                ? "border-destructive"
                : undefined
            }
          >
            <CardHeader className="pb-2">
              <CardDescription>
                {fluxo.comecaNegativo
                  ? "Seu saldo hoje"
                  : fluxo.primeiroDiaNegativo
                    ? "Seu saldo fica negativo em"
                    : `Nos próximos ${fluxo.dias} dias`}
              </CardDescription>
              <CardTitle
                className={
                  fluxo.primeiroDiaNegativo || fluxo.comecaNegativo
                    ? "text-3xl text-destructive"
                    : "text-3xl text-foreground"
                }
              >
                {fluxo.comecaNegativo
                  ? formatarBRL(fluxo.saldoInicial)
                  : fluxo.primeiroDiaNegativo
                    ? formatarData(fluxo.primeiroDiaNegativo)
                    : "O saldo não fica negativo"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {fluxo.comecaNegativo ? (
                  <>
                    Você já está no vermelho. No fundo do período o saldo chega a{" "}
                    <span className="font-medium text-destructive">
                      {formatarBRL(fluxo.menorSaldo)}
                    </span>{" "}
                    em {formatarData(fluxo.diaDoMenorSaldo)}.
                  </>
                ) : fluxo.primeiroDiaNegativo ? (
                  <>
                    {faltam === 0
                      ? "É hoje."
                      : faltam === 1
                        ? "Falta 1 dia."
                        : `Faltam ${faltam} dias.`}{" "}
                    O ponto mais baixo é{" "}
                    <span className="font-medium text-destructive">
                      {formatarBRL(fluxo.menorSaldo)}
                    </span>{" "}
                    em {formatarData(fluxo.diaDoMenorSaldo)}.
                  </>
                ) : (
                  <>
                    O menor saldo do período é{" "}
                    <span className="font-medium text-foreground">
                      {formatarBRL(fluxo.menorSaldo)}
                    </span>
                    , em {formatarData(fluxo.diaDoMenorSaldo)}.
                  </>
                )}
              </p>
              <LinhaDoSaldo fluxo={fluxo} />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{formatarDiaMes(fluxo.de)}</span>
                <span>{formatarDiaMes(fluxo.ate)}</span>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Saldo hoje</CardDescription>
                <CardTitle className="text-xl text-foreground">
                  {formatarBRL(fluxo.saldoInicial)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Contas onde o dinheiro está disponível. Investimento e cartão
                  ficam de fora.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1">
                  <TrendingUp className="h-3 w-3 text-success" />A receber
                </CardDescription>
                <CardTitle className="text-xl text-success">
                  {formatarBRL(fluxo.totalEntra)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Receitas previstas no período.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1">
                  <TrendingDown className="h-3 w-3 text-destructive" />A pagar
                </CardDescription>
                <CardTitle className="text-xl text-destructive">
                  {formatarBRL(fluxo.totalSai)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Contas previstas e assinaturas, somadas uma única vez.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>
                  Saldo em {formatarDiaMes(fluxo.ate)}
                </CardDescription>
                <CardTitle
                  className={
                    fluxo.saldoFinal < 0
                      ? "text-xl text-destructive"
                      : "text-xl text-foreground"
                  }
                >
                  {formatarBRL(fluxo.saldoFinal)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Saldo de hoje mais tudo que está previsto até lá.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Sem isto o usuario procura a Netflix na lista, nao acha, e conclui
              que a previsao esqueceu dela -- quando na verdade ela esta ali,
              como conta prevista. */}
          {fluxo.absorvidasPelaAgenda.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {fluxo.absorvidasPelaAgenda.join(", ")}{" "}
              {fluxo.absorvidasPelaAgenda.length === 1
                ? "já está na lista como conta prevista e por isso não aparece duas vezes."
                : "já estão na lista como contas previstas e por isso não aparecem duas vezes."}
            </p>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base text-foreground">
                O que vem por aí
              </CardTitle>
              <CardDescription>
                Cada linha mostra o saldo que sobra depois dela.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {eventos.length === 0 ? (
                <div className="space-y-2 py-4 text-center">
                  <p className="text-sm text-foreground">
                    Nenhum compromisso previsto para os próximos {fluxo.dias}{" "}
                    dias.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Cadastre suas contas em{" "}
                    <Link href="/dashboard/bills" className="underline">
                      Contas Previstas
                    </Link>{" "}
                    ou importe um extrato para o app encontrar suas assinaturas.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {eventos.map((e, i) => (
                    <div
                      key={`${e.id}-${e.data}-${i}`}
                      className="flex items-center justify-between gap-4 py-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {e.descricao}
                          </span>
                          {e.origem === "recorrencia" && (
                            <Badge variant="secondary" className="gap-1">
                              <Repeat className="h-3 w-3" />
                              Assinatura
                            </Badge>
                          )}
                          {e.vencida && (
                            <Badge variant="outline" className="text-destructive">
                              Vencida
                            </Badge>
                          )}
                        </div>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <CalendarClock className="h-3 w-3" />
                          {formatarData(e.data)}
                        </span>
                      </div>
                      <div className="text-right">
                        <div
                          className={
                            e.valor >= 0
                              ? "text-sm font-semibold text-success"
                              : "text-sm font-semibold text-destructive"
                          }
                        >
                          {e.valor >= 0 ? "+" : "−"}
                          {formatarBRL(Math.abs(e.valor))}
                        </div>
                        <div
                          className={
                            e.saldoDepois < 0
                              ? "text-xs text-destructive"
                              : "text-xs text-muted-foreground"
                          }
                        >
                          saldo {formatarBRL(e.saldoDepois)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* O limite da conta, escrito onde o usuario le -- e nao so no
              comentario do codigo. Ver o cabecalho do lib. */}
          <p className="text-xs text-muted-foreground">
            A previsão considera apenas o que já está comprometido: contas
            previstas e assinaturas detectadas. Gasto do dia a dia (mercado,
            restaurante, combustível) <strong>não entra</strong> — na prática o
            saldo tende a ser menor do que a linha mostra. Compras no cartão
            aparecem quando a fatura fecha e vira conta prevista.
          </p>
        </>
      )}
    </div>
  );
}
