"use client";

import { useState, useEffect, useCallback } from "react";
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
  RefreshCw,
  Repeat,
  TrendingUp,
  AlertTriangle,
  Check,
  EyeOff,
  Ban,
  CalendarClock,
} from "lucide-react";

// =====================================================
// Assinaturas e cobrancas recorrentes (HMO-145)
// =====================================================
// A tela existe para uma decisao: o que cancelar. Por isso o numero grande no
// topo e o TOTAL MENSAL, e a lista vem da assinatura mais cara para a mais
// barata -- e nao em ordem alfabetica nem por data, que sao as ordens que nao
// ajudam a decidir nada.
//
// Toda cor sai de token (bg-card, text-muted-foreground, bg-warning/10...).
// Uma classe de paleta fixa do Tailwind passa no build e vira um bloco claro
// no modo noturno -- o `npm run check-color-tokens` reprova, ver HMO-144.
//
// (O proprio guard nao mascara comentario: citar aqui o nome de uma dessas
// classes, ainda que para explicar por que nao usa-la, reprova o commit.)
// =====================================================

interface Recurrence {
  id: string;
  merchant_key: string;
  display_name: string;
  avg_amount: number | string;
  last_amount: number | string;
  monthly_cost: number | string;
  frequency: "WEEKLY" | "MONTHLY" | "YEARLY";
  occurrences: number;
  last_charge_date: string;
  next_expected_date: string;
  status: "DETECTED" | "CONFIRMED" | "IGNORED" | "CANCELLED";
}

interface Alerta {
  tipo: "PRICE_INCREASE" | "CHARGED_AFTER_CANCEL";
  merchantKey: string;
  displayName: string;
  mensagem: string;
}

const ROTULO_FREQUENCIA: Record<Recurrence["frequency"], string> = {
  WEEKLY: "Semanal",
  MONTHLY: "Mensal",
  YEARLY: "Anual",
};

const ROTULO_STATUS: Record<Recurrence["status"], string> = {
  DETECTED: "Detectada",
  CONFIRMED: "Confirmada",
  IGNORED: "Ignorada",
  CANCELLED: "Cancelada",
};

function formatarBRL(valor: number | string): string {
  // O supabase-js entrega `numeric` como string. Sem o Number aqui o
  // toLocaleString recebe string e devolve o texto cru, sem separador.
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

export default function RecurrencesPage() {
  const [recorrencias, setRecorrencias] = useState<Recurrence[]>([]);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [totalMensal, setTotalMensal] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [varrendo, setVarrendo] = useState(false);
  const [mostrarIgnoradas, setMostrarIgnoradas] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const resp = await fetch(
        `/api/recurrences${mostrarIgnoradas ? "?status=all" : ""}`
      );
      if (!resp.ok) throw new Error("Nao foi possivel carregar as recorrencias.");
      const dados = await resp.json();
      setRecorrencias(dados.recurrences || []);
      setAlertas(dados.alerts || []);
      setTotalMensal(dados.monthlyTotal || 0);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado.");
    } finally {
      setCarregando(false);
    }
  }, [mostrarIgnoradas]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const varrer = async () => {
    setVarrendo(true);
    setErro(null);
    try {
      const resp = await fetch("/api/recurrences/scan", { method: "POST" });
      if (!resp.ok) throw new Error("A varredura falhou.");
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado.");
    } finally {
      setVarrendo(false);
    }
  };

  const decidir = async (id: string, status: Recurrence["status"]) => {
    // Atualizacao otimista: a lista responde na hora e a chamada confirma
    // depois. Se falhar, `carregar()` no catch devolve o estado do servidor --
    // sem isso a tela ficaria mostrando uma decisao que nao foi gravada.
    const anterior = recorrencias;
    setRecorrencias((atual) =>
      atual.map((r) => (r.id === id ? { ...r, status } : r))
    );
    try {
      const resp = await fetch(`/api/recurrences/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!resp.ok) throw new Error("Nao foi possivel salvar a decisao.");
      // Recarrega porque o total mensal e os alertas mudam com o status, e os
      // dois sao calculados no servidor.
      await carregar();
    } catch (e) {
      setRecorrencias(anterior);
      setErro(e instanceof Error ? e.message : "Erro inesperado.");
    }
  };

  const visiveis = mostrarIgnoradas
    ? recorrencias
    : recorrencias.filter((r) => r.status !== "IGNORED");

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Repeat className="h-6 w-6 text-primary" />
            Assinaturas e recorrências
          </h1>
          <p className="text-sm text-muted-foreground">
            Cobranças que se repetem no seu extrato, encontradas automaticamente.
          </p>
        </div>
        <Button onClick={varrer} disabled={varrendo} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${varrendo ? "animate-spin" : ""}`} />
          {varrendo ? "Procurando..." : "Procurar agora"}
        </Button>
      </div>

      {erro && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-2 pt-6 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm">{erro}</span>
          </CardContent>
        </Card>
      )}

      {/* O numero pelo qual a tela existe. */}
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Total por mês</CardDescription>
          <CardTitle className="text-3xl text-foreground">
            {formatarBRL(totalMensal)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Soma do que está detectado e confirmado. O que você ignorou ou
            cancelou não entra na conta.
          </p>
        </CardContent>
      </Card>

      {alertas.length > 0 && (
        <div className="space-y-2">
          {alertas.map((a, i) => (
            <div
              key={`${a.merchantKey}-${a.tipo}-${i}`}
              className="flex items-start gap-2 rounded-md border border-warning bg-warning/10 p-3"
            >
              {a.tipo === "PRICE_INCREASE" ? (
                <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              )}
              <span className="text-sm text-foreground">{a.mensagem}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {visiveis.length} {visiveis.length === 1 ? "cobrança" : "cobranças"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMostrarIgnoradas((v) => !v)}
        >
          {mostrarIgnoradas ? "Esconder ignoradas" : "Mostrar ignoradas"}
        </Button>
      </div>

      {carregando ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Carregando...
          </CardContent>
        </Card>
      ) : visiveis.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 pt-6 text-center">
            <p className="text-sm text-foreground">
              Nenhuma cobrança recorrente encontrada ainda.
            </p>
            <p className="text-xs text-muted-foreground">
              São necessárias pelo menos 3 cobranças do mesmo lugar, em
              intervalo regular e com valor parecido. Importe seu extrato e
              clique em &quot;Procurar agora&quot;.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visiveis.map((r) => (
            <Card
              key={r.id}
              // Ignorada e cancelada continuam na lista, mas apagadas: o
              // usuario precisa conseguir desfazer sem caçar a linha.
              className={
                r.status === "IGNORED" || r.status === "CANCELLED"
                  ? "opacity-60"
                  : undefined
              }
            >
              <CardContent className="flex flex-col gap-4 pt-6 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-foreground">
                      {r.display_name}
                    </span>
                    <Badge variant="secondary">
                      {ROTULO_FREQUENCIA[r.frequency]}
                    </Badge>
                    {r.status !== "DETECTED" && (
                      <Badge variant="outline">{ROTULO_STATUS[r.status]}</Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <CalendarClock className="h-3 w-3" />
                      Próxima: {formatarData(r.next_expected_date)}
                    </span>
                    <span>Última: {formatarData(r.last_charge_date)}</span>
                    <span>{r.occurrences} cobranças</span>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="font-semibold text-foreground">
                      {formatarBRL(r.avg_amount)}
                    </div>
                    {/* Mensal ja e o valor por mes; repetir "/mês" nas outras
                        frequencias e o que deixa comparar anual com semanal. */}
                    {r.frequency !== "MONTHLY" && (
                      <div className="text-xs text-muted-foreground">
                        {formatarBRL(r.monthly_cost)}/mês
                      </div>
                    )}
                  </div>

                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Confirmar que é uma assinatura"
                      disabled={r.status === "CONFIRMED"}
                      onClick={() => decidir(r.id, "CONFIRMED")}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Não é uma assinatura, ignorar"
                      disabled={r.status === "IGNORED"}
                      onClick={() => decidir(r.id, "IGNORED")}
                    >
                      <EyeOff className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Já cancelei esta assinatura"
                      disabled={r.status === "CANCELLED"}
                      onClick={() => decidir(r.id, "CANCELLED")}
                    >
                      <Ban className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
