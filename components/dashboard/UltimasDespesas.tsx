"use client";

// ---------------------------------------------------------------------------
// AS ULTIMAS DESPESAS -- o widget do Resumo do Minhas Financas
// ---------------------------------------------------------------------------
// As cinco despesas efetivadas mais recentes do periodo, lidas de
// /api/reports/lancamentos (data de efetivacao, situacao "efetivadas"). O corte
// esta em lib/widgets-do-painel.ts. A compra no cartao entra: e uma despesa
// lancada, como no Minhas Financas; o pagamento da fatura nao, porque e
// transferencia.
// ---------------------------------------------------------------------------

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";
import { ArrowRight, Receipt } from "lucide-react";
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
  ultimasDespesas,
  type LancamentoDoRelatorio,
} from "@/lib/widgets-do-painel";

function dataCurta(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

export function UltimasDespesas({
  de,
  ate,
  rotulo,
  nomesDasContas,
}: {
  de: string;
  ate: string;
  rotulo: string;
  /** id da conta -> nome, das contas que o painel ja carregou. */
  nomesDasContas: Readonly<Record<string, string>>;
}) {
  const [estado, setEstado] = useState<"carregando" | "pronto" | "erro">(
    "carregando"
  );
  const [linhas, setLinhas] = useState<LancamentoDoRelatorio[]>([]);

  useEffect(() => {
    let vivo = true;
    setEstado("carregando");
    const busca = new URLSearchParams({
      de,
      ate,
      referencia: "efetivacao",
      situacao: "efetivadas",
      tipo: "expense",
    });
    fetch(`/api/reports/lancamentos?${busca.toString()}`)
      .then(async (r) => {
        const dados = await r.json();
        if (!vivo) return;
        if (!r.ok || !Array.isArray(dados.linhas)) {
          setEstado("erro");
          return;
        }
        setLinhas(ultimasDespesas(dados.linhas as LancamentoDoRelatorio[]));
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
          <Receipt className="h-5 w-5" />
          Últimas despesas
        </CardTitle>
        <CardDescription>{rotulo}</CardDescription>
      </CardHeader>
      <CardContent>
        {estado === "carregando" ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : estado === "erro" ? (
          <NumeroIndisponivel />
        ) : linhas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma despesa paga neste período.
          </p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {linhas.map((l) => (
              <li key={l.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {l.descricao || "Sem descrição"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {dataCurta(l.data)}
                    {l.conta_id && nomesDasContas[l.conta_id]
                      ? ` · ${nomesDasContas[l.conta_id]}`
                      : ""}
                    {!l.soma ? " · fora dos totais" : ""}
                  </p>
                </div>
                <span className="shrink-0 font-semibold tabular-nums text-destructive">
                  {formatarValor(l.valor, "BRL")}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link
          href={`/dashboard/despesas?de=${de}&ate=${ate}` as Route}
          className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground underline hover:text-foreground"
        >
          Ver todas as despesas
          <ArrowRight className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  );
}
