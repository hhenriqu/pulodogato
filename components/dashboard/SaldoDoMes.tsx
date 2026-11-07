"use client";

// ---------------------------------------------------------------------------
// O SALDO DO MES EM TRES PASSOS -- a faixa do topo do Resumo do Minhas Financas
// ---------------------------------------------------------------------------
// Inicial -> Atual -> Previsto, somados das contas que entram no total. Os
// numeros sao os da linha Total da tabela "Mes das contas" (tela Contas): a
// mesma rota, /api/financial-accounts/mes, e a soma de lib/widgets-do-painel.ts.
//
// O MES E UM SO. A rota responde por mes, entao o widget mostra o mes do
// periodo quando o periodo e um mes, e o mes corrente nos outros casos -- e o
// rotulo diz qual, para o numero nunca ficar debaixo de um periodo que nao e o
// dele.
// ---------------------------------------------------------------------------

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";
import { ArrowRight, Landmark } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { NumeroIndisponivel } from "@/components/SemRede";
import { formatarValor } from "@/lib/dinheiro";
import {
  saldoDoMes,
  type ContaQueSoma,
  type LinhaDoMesDaConta,
  type SaldoDoMes as Saldo,
} from "@/lib/widgets-do-painel";

const NOMES_DOS_MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

function nomeDoMes(mes: string): string {
  return `${NOMES_DOS_MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`;
}

export function SaldoDoMes({
  mes,
  contas,
}: {
  /** 'AAAA-MM'. */
  mes: string;
  contas: readonly ContaQueSoma[];
}) {
  const [estado, setEstado] = useState<"carregando" | "pronto" | "erro">(
    "carregando"
  );
  const [linhas, setLinhas] = useState<LinhaDoMesDaConta[]>([]);

  useEffect(() => {
    let vivo = true;
    setEstado("carregando");
    fetch(`/api/financial-accounts/mes?mes=${mes}`)
      .then(async (r) => {
        const dados = await r.json();
        if (!vivo) return;
        if (!r.ok || !Array.isArray(dados.contas)) {
          setEstado("erro");
          return;
        }
        setLinhas(dados.contas as LinhaDoMesDaConta[]);
        setEstado("pronto");
      })
      .catch((erro) => {
        console.error(erro);
        if (vivo) setEstado("erro");
      });
    return () => {
      vivo = false;
    };
  }, [mes]);

  const saldo = estado === "pronto" ? saldoDoMes(linhas, contas) : null;

  // Sem conta que some, o widget nao tem o que dizer -- e nao diz zero.
  if (estado === "pronto" && saldo === null) return null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-4 md:flex-row md:items-center">
        <div className="flex items-center gap-2 md:w-48 md:shrink-0">
          <Landmark className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold">Saldo das contas</p>
            <p className="text-xs text-muted-foreground">{nomeDoMes(mes)}</p>
          </div>
        </div>
        {estado === "carregando" ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : estado === "erro" || saldo === null ? (
          <NumeroIndisponivel />
        ) : (
          <PassosDoSaldo saldo={saldo} />
        )}
        <Link
          href={"/dashboard/contas" as Route}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline hover:text-foreground md:ml-auto"
        >
          Ver contas
          <ArrowRight className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  );
}

/** Os tres numeros com as setas entre eles: props entram, marcacao sai. */
export function PassosDoSaldo({ saldo }: { saldo: Saldo }) {
  const passos: { rotulo: string; valor: number; destaque?: boolean }[] = [
    { rotulo: "Inicial", valor: saldo.inicial },
    { rotulo: "Atual", valor: saldo.atual, destaque: true },
    { rotulo: "Previsto", valor: saldo.previsto },
  ];
  return (
    <ol className="grid flex-1 grid-cols-3 items-center gap-2">
      {passos.map((p, i) => (
        <li key={p.rotulo} className="flex items-center gap-2">
          {i > 0 && (
            <ArrowRight
              aria-hidden="true"
              className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block"
            />
          )}
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{p.rotulo}</p>
            <p
              className={`truncate tabular-nums ${
                p.destaque ? "text-lg font-bold" : "text-sm font-semibold"
              } ${p.valor < 0 ? "text-destructive" : ""}`}
            >
              {formatarValor(p.valor, "BRL")}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
